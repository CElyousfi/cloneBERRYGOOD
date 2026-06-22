# Plan — Bloc « Prévision extérieure » : faire fonctionner « Hier »

## Context

Le bloc `MeteoPrevisionExterieure` ([public/app.jsx](public/app.jsx)) permet de basculer entre **Hier / Aujourd'hui / Demain**. Aujourd'hui et Demain fonctionnent ; **Hier ne renvoie rien** parce que les packages Meteoblue utilisés (`basic-day_agro-day_basic-1h` + `agro-1h`) ne renvoient que « aujourd'hui + N jours forward ». Quand l'utilisateur clique Hier, `todayIdx - 1 = -1` → `targetDay = null` → fallback « Données indisponibles ».

**Objectif** : afficher les courbes horaires de la veille (T°, VPD, ETo, radiation cumulée) sans dépenser de crédits Meteoblue supplémentaires ni attendre un snapshot.

## Approche : on-demand fetch Open-Meteo avec `past_days=1`

Open-Meteo est :
- **Gratuit**, sans clé API, CORS ouvert (fetch direct depuis le navigateur OK)
- **Déjà utilisé côté backend** ([functions/index.js:~2595](functions/index.js#L2595) `persistMeteoOutdoor` via `gddNightlyJob`), donc source connue dans le projet
- Fournit les mêmes données horaires que Meteoblue agro-1h : `temperature_2m`, `relative_humidity_2m`, `shortwave_radiation`, `et0_fao_evapotranspiration`
- Supporte le paramètre `past_days` (1–92) → on récupère hier en un seul appel

Endpoint :
```
https://api.open-meteo.com/v1/forecast
  ?latitude={lat}&longitude={lon}
  &hourly=temperature_2m,relative_humidity_2m,shortwave_radiation,et0_fao_evapotranspiration
  &past_days=1&forecast_days=1
  &timezone=Africa/Casablanca
```

Réponse : `hourly.time[]`, `hourly.temperature_2m[]`, etc. — 48 entrées (24 hier + 24 aujourd'hui). On extrait les 24 entrées du `dateISO` cible.

## Implémentation

### 1. Helper `fetchOpenMeteoHourly(ferme, dateISO)` ([public/app.jsx](public/app.jsx))

À placer juste sous `fetchMeteoblueData` (~ligne 878), même style :
- Lookup coords dans `meteoFermes` (déjà défini ligne 824)
- Cache mémoire 30 min keyed par `ferme+dateISO`
- Retourne un tableau d'objets `{hour, heure, tempRaw, humidityRaw, radiation, eto, …}` au **même schéma** que les entrées actuelles de `horaire24ParJour` pour que le composant n'ait pas à différencier les sources.
- Sur erreur réseau → return `null` (et `MeteoPrevisionExterieure` retombe sur le message « Données indisponibles »)

### 2. Adaptation dans `MeteoPrevisionExterieure` ([public/app.jsx:23598](public/app.jsx#L23598))

Actuellement (~ligne 23615) :
```js
const horaire24 = meteoResult.horaire24ParJour || {};
...
const hours = (horaire24[targetDay.dateISO] || []).slice().sort(...);
```

Modif :
- Ajouter un `useState` `[yesterdayHours, setYesterdayHours] = useState(null)` + `useEffect` qui déclenche le fetch Open-Meteo quand `day === 'yesterday'` ET `yesterdayHours == null`
- Calculer un `dateISO` de la veille à partir de `previsions[todayIdx].dateISO` (parser, soustraire 1 jour, formatter `YYYY-MM-DD`) **même si `targetIdx === -1`** (sortir cette logique du early-return)
- Construire un `targetDay` synthétique pour hier : `{ dateISO, eto: null, isToday: false }` (suffit pour l'affichage du titre et fallback ETo daily)
- `hours` = `yesterdayHours` quand `day === 'yesterday'`, sinon `horaire24[targetDay.dateISO]` comme avant
- Loader pendant le fetch (réutiliser le pattern spinner existant ailleurs dans `MeteoTab`)

### 3. Cards / deltas

Le calcul `prevDay`/`prevHours` (delta vs jour précédent) ne fonctionne pas pour « Hier » (il faudrait avant-hier, hors-scope). Lorsque `day === 'yesterday'` → masquer les pastilles de delta (rendre `delta: null` dans `cards`).

### 4. Bench credits

Open-Meteo n'a pas de quota strict (« fair-use 10 000 calls/jour/IP »). Le composant fait un seul fetch quand on clique Hier, mis en cache 30 min côté client. Conso négligeable.

## Fichiers modifiés

- [public/app.jsx](public/app.jsx) — un nouveau helper `fetchOpenMeteoHourly` (~30 lignes) + ~25 lignes dans `MeteoPrevisionExterieure` pour le useEffect, le calcul du dateISO de la veille, et le masquage des deltas.

**Aucune modif backend, aucune nouvelle collection Firestore, aucune règle.**

## Workflow git (rappel mémoire)

1. Branche `feat/meteo-prevision-yesterday`
2. Commit atomique, push
3. PR draft + preview channel Firebase
4. URL preview envoyée au user
5. Validation → merge + deploy prod

## Vérification end-to-end

1. Sur la preview, ouvrir Agronomie > Météo F1.
2. Cliquer **Hier** : courbes T°, VPD, ETo s'affichent pour la date d'hier ; pas de message d'erreur.
3. Vérifier qu'il n'y a **pas de delta** affiché dans les cartes pour Hier (pas de référence avant-hier).
4. Onglet Network : 1 seul appel vers `api.open-meteo.com` la première fois ; rebascule Hier → cache HIT (rien dans Network).
5. Aujourd'hui / Demain inchangés (toujours via Meteoblue).
6. Tester sur F1, F5, F6, BAHIA pour vérifier que `meteoFermes` couvre tout.

## Limites / hors-scope

- **Pas de delta vs avant-hier** sur les cartes en mode Hier (refusé : nécessiterait `past_days=2`, double la conso, peu d'intérêt agronomique).
- **Pas de mix backend** : Open-Meteo est appelé direct depuis le navigateur. Si on voulait passer par une Cloud Function (cache mutualisé), c'est une V2.
- **Discontinuité de source** : Hier vient d'Open-Meteo, Aujourd'hui/Demain de Meteoblue. Les valeurs peuvent légèrement diverger (modèles différents). Acceptable pour usage agronomique qualitatif.
- **Pas de fallback offline** : sans réseau, Hier reste vide (idem aujourd'hui actuellement).
