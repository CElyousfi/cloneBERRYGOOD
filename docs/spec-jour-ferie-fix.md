# Spec — Fix prime "Jour Férié" (crédit forfaitaire buggé)

> Statut : **implémenté et déployé en prod (functions, `main @ 0fbc3ee`, 2026-07-30) — validé par Omar**
> Item backlog : bug prime Jour Férié (remonté hors triage bug_reports,
> diagnostiqué en session read-only le 2026-07-28).
> Ce fichier est autosuffisant : une session qui reçoit "GO spec-jour-ferie-fix"
> peut implémenter directement à partir d'ici, sans ré-analyser le code.

---

## 1. Contexte / problème

Le calcul de la prime "Jour Férié" (affichée dans le récap Paie de la
quinzaine, la popup "Autres Primes", et l'onglet "Calendrier des Jours
Fériés") est actuellement **forfaitaire par quinzaine calendaire**, et buggé :
tout ouvrier ayant ne serait-ce qu'**un seul pointage n'importe où** dans la
quinzaine calendaire (1–15 ou 16–fin de mois) qui contient un jour férié
touche la prime pour ce férié — **même si le férié n'a pas encore eu lieu**,
et **sans vérifier une présence réelle autour de la date du férié**.

Exemple concret : le 30/07/2026 (Fête du Trône) est dans la quinzaine
2026-07-H2 (16→31 juillet). Dès qu'un seul pointage existe pour cette
quinzaine (ex. un pointage le 16 juillet), TOUS les ouvriers actifs dans
cette quinzaine sont crédités de la prime "Jour Férié" pour le 30 juillet —
alors qu'on est encore avant le 30 et que rien ne garantit leur présence ce
jour-là.

Le montant crédité est lui aussi une estimation (`avgCout` = moyenne du coût
journalier déjà pointé par l'ouvrier sur la quinzaine), pas un coût réel —
**ce point n'est PAS dans le scope de ce fix** (voir §6 Limitations connues).

### Root cause — code actuel

Fichier : `functions/src/modules/rh/pointageService.js`, fonction `computeChargCond()`
(lignes 717-802). Cœur du bug : lignes 769-789.

```js
// For each jour férié, find its quinzaine and credit all active workers
const ferieWorkers = {};
for (const jf of JOURS_FERIES) {
  if (/\(2e\s*jour\)/i.test(jf.label || '') || jf.compteurPrime === false) continue;
  const holidayPeriode = resolveHolidayPeriode(halfToPeriode, jf.date);
  if (!holidayPeriode) continue; // Quinzaine du férié sans données chargées

  // All workers active in this period are eligible for 1 jour sup
  for (const [, wp] of Object.entries(workerPeriod)) {
    if (wp.periode !== holidayPeriode) continue;
    const fKey = `${wp.periode}|${wp.mat}`;
    if (!ferieWorkers[fKey]) ferieWorkers[fKey] = { matricule: wp.mat, nom: wp.nom, periode: wp.periode, ferme: wp.ferme, details: [] };
    const avgCout = wp.coutCount > 0 ? wp.totalCout / wp.coutCount : 0;
    ferieWorkers[fKey].details.push({ date: jf.date, label: jf.label, raison: 'Jour férié dans la quinzaine', cout: avgCout });
  }
}
```

Deux bugs cumulés :
1. Aucun filtre `jf.date <= aujourd'hui` → un férié futur est crédité dès que
   la quinzaine qui le contient a des données (même une seule journée avant
   le férié).
2. `resolveHolidayPeriode` détermine seulement QUELLE quinzaine reçoit la
   ligne de coût — mais l'éligibilité individuelle credit ENSUITE "tout
   ouvrier actif dans cette quinzaine" (`workerPeriod`), sans regarder si cet
   ouvrier a une présence quelconque autour de la date précise du férié.

### Chaîne d'appel (inchangée par ce fix)

- Fériés : `getJoursFeries()` (`functions/src/modules/rh/pointageService.js:657-668`,
  Firestore `app_settings/jours_feries`, fallback
  `JOURS_FERIES_FALLBACK` ligne 617-650).
- Calcul : `computeChargCond(allRows, holidays)` → `jourFerieDetail`.
- Appelé dans le warm-cache `pointage_transport`
  (`functions/src/modules/rh/pointageService.js:1707-1728`, et un appel similaire `:2827` —
  **vérifier au moment de l'implémentation si ce 2e appel existe toujours et
  utilise la même signature**, le code peut avoir bougé entre le diagnostic
  et l'implémentation).
- TTL du cache = `0` (recalcul forcé à chaque exécution du warm-cache, donc
  le fix s'applique automatiquement à la prochaine exécution après deploy,
  sans invalidation manuelle nécessaire). Le warm-cache ne recharge que
  `periodes.slice(0, 2)` (2 dernières quinzaines) → **le recalcul rétroactif
  induit par ce fix est borné aux 2 dernières quinzaines**, pas à tout
  l'historique.
- Frontend (aucune logique d'éligibilité côté front — affichage seul,
  **rien à modifier ici**) :
  - Récap quinzaine : `public/app.jsx:4703-4824` (filtre `jourFerieDetail`
    par `periode === currentQuinz`, somme `cout`).
  - Popup "Autres Primes" (table détaillée) : `public/app.jsx:11990-12046`.
  - Onglet "Calendrier des Jours Fériés" (`JourFerieSub`) :
    `public/app.jsx:24392-24528` — KPI "Ouvriers éligibles" = `wList.length`
    (aucune logique d'éligibilité propre, juste `.length` de ce que le
    backend a renvoyé) ; colonne "Détail" affiche `d.label` + `d.raison`
    (texte libre, pas de recalcul).

---

## 2. Décision métier (validée par Omar)

Règle cible : **"présence réelle le jour J"**, pas un forfait borné dans le
temps. Un ouvrier ne doit toucher la prime "Jour Férié" que s'il a une
présence réelle et vérifiable autour de la date du férié — pas simplement
parce qu'il a travaillé un jour quelconque de la quinzaine.

Recherche complémentaire (codebase, lecture seule) ayant informé
l'algorithme ci-dessous :
- **Aucune ligne de pointage ne porte de flag Férié/Congé/Absence.** Une
  ligne de pointage (`allRows`) n'existe QUE si l'ouvrier a réellement pointé
  ce jour-là. L'absence n'est jamais un flag — c'est l'absence de ligne pour
  ce matricule/cette date. Confirmé sur `functions/src/modules/rh/pointageService.js`,
  `functions/src/shared/firestoreDataService.js`, `functions/src/modules/rh/sqlSyncService.js`
  (schéma source SQL : `functions/src/modules/rh/sqlSyncService.js:680-711`).
- **Aucun helper existant ne calcule une présence J-1/J+1 par ouvrier.** Le
  seul mécanisme voisin est un détecteur de séries d'absences **par équipe**
  (`presenceMap[prefix]`, `functions/src/modules/rh/pointageService.js:1668-1695` et
  duplicata `:3081-3150`) qui alerte sur ≥5 jours consécutifs sans pointage
  — granularité équipe, pas ouvrier, et pas lié aux fériés. **Ce fix doit
  construire sa propre logique de présence par ouvrier**, il n'y a rien à
  réutiliser tel quel.
- **Un jour férié peut être un jour travaillé.** Rien dans le code ne
  distingue "férié travaillé" (récolte ne s'arrête pas pour un jour férié)
  de "férié chômé". Une ligne de pointage à `DateStr === jf.date` est
  possible et doit compter comme présence (voire comme cas le plus fort
  d'éligibilité).
- **Le front n'a aucune logique d'éligibilité à modifier** — confirmé ci-dessus
  (§1), tout est dérivé de `jourFerieDetail` renvoyé tel quel par le backend.

---

## 3. Algorithme cible

Remplacer la boucle `ferieWorkers` (lignes 769-789 actuelles) par la logique
suivante, à l'intérieur de `computeChargCond(allRows, holidays)` (même
signature, mêmes données d'entrée — pas de nouveau paramètre nécessaire) :

### 3.1 Filtre temporel

Ignorer tout `jf` où `jf.date > aujourd'hui` (comparaison de strings ISO
`YYYY-MM-DD` suffit, pas besoin de parser en `Date` — attention au fuseau :
utiliser la date du jour en Africa/Casablanca, pas UTC brut, pour éviter un
décalage de ±1h autour de minuit). Combiné avec les filtres existants
(`(2e jour)`, `compteurPrime === false`).

### 3.2 Jours ouvrés globaux (proxy sans calendrier de repos fixe)

```js
const joursTravailles = [...new Set(allRows.map(r => r.DateStr).filter(Boolean))].sort();
```

Représente les jours où AU MOINS UN ouvrier de la ferme a une activité
enregistrée — sert de proxy de "jour ouvré" sans dépendre d'un calendrier de
repos hebdomadaire fixe (vendredi/dimanche variable selon ferme/équipe).

### 3.3 Jour ouvré avant / après le férié

```js
function findJourAvant(joursTravailles, ferieDate) {
  let jourAvant;
  for (const d of joursTravailles) { if (d < ferieDate) jourAvant = d; else break; }
  return jourAvant; // dernier jour < ferieDate (joursTravailles est trié croissant)
}
function findJourApres(joursTravailles, ferieDate) {
  return joursTravailles.find(d => d > ferieDate); // premier jour > ferieDate
}
```

Si `jourAvant` ou `jourApres` est `undefined` (férié en bordure du dataset
chargé, ex. tout début de l'historique disponible) → aucun ouvrier ne peut
être crédité via le critère "présence encadrante" pour ce férié (seul le
critère "a travaillé le jour férié lui-même", §3.5 cas a, reste possible).
Documenter ce cas dans les logs (`console.warn`) plutôt que de planter.

### 3.4 Présence par ouvrier (tous jours, toutes opérations, toutes périodes)

```js
const workerDaySet = {}; // matricule -> Set(DateStr)
for (const r of allRows) {
  const mat = (r.Personnel_Matricule || '').trim();
  if (!mat || !r.DateStr) continue;
  if (!workerDaySet[mat]) workerDaySet[mat] = new Set();
  workerDaySet[mat].add(r.DateStr);
}
```

Contrairement à `workerPeriod` (existant, scindé par `periode|mat`), ce set
est **global par matricule**, car le jour avant/après un férié peut tomber
dans une quinzaine différente de celle où le férié est crédité.

### 3.5 Éligibilité

Pour chaque `jf` retenu (après §3.1) et chaque matricule présent dans
`workerDaySet` :

```js
const set = workerDaySet[mat];
const travaillePendantFerie = set.has(jf.date);          // cas a
const presentEncadrant = jourAvant && jourApres && set.has(jourAvant) && set.has(jourApres); // cas b
const eligible = travaillePendantFerie || presentEncadrant;
```

- Cas a → `raison: 'Travaillé le jour férié'`
- Cas b → `raison: 'Présent avant/après le jour férié'`
- Sinon → non crédité (remplace le forfait "actif quelque part dans la
  quinzaine" actuel).

### 3.6 Rattachement quinzaine (inchangé)

La ligne de coût reste rattachée à `holidayPeriode` via
`resolveHolidayPeriode(halfToPeriode, jf.date)` — même comportement
qu'aujourd'hui, pour ne pas changer la structure du récap (une seule ligne
"Jour Férié" par quinzaine dans les totaux).

### 3.7 Montant (inchangé — hors scope, voir §6)

`avgCout` reste calculé comme aujourd'hui : moyenne du coût journalier
pointé par l'ouvrier **sur la quinzaine `holidayPeriode`** (utiliser
`workerPeriod[`${holidayPeriode}|${mat}`]` comme aujourd'hui pour ce calcul,
même si l'éligibilité, elle, utilise `workerDaySet` global).

### Pseudo-code complet de remplacement

```js
const today = /* date du jour, Africa/Casablanca, format 'YYYY-MM-DD' */;
const joursTravailles = [...new Set(allRows.map(r => r.DateStr).filter(Boolean))].sort();
const workerDaySet = {};
for (const r of allRows) {
  const mat = (r.Personnel_Matricule || '').trim();
  if (!mat || !r.DateStr) continue;
  if (!workerDaySet[mat]) workerDaySet[mat] = new Set();
  workerDaySet[mat].add(r.DateStr);
}

const ferieWorkers = {};
for (const jf of JOURS_FERIES) {
  if (/\(2e\s*jour\)/i.test(jf.label || '') || jf.compteurPrime === false) continue;
  if (jf.date > today) continue; // NOUVEAU — fixe la fuite "férié futur"
  const holidayPeriode = resolveHolidayPeriode(halfToPeriode, jf.date);
  if (!holidayPeriode) continue;

  const jourAvant = findJourAvant(joursTravailles, jf.date);
  const jourApres = findJourApres(joursTravailles, jf.date);

  for (const [, wp] of Object.entries(workerPeriod)) {
    if (wp.periode !== holidayPeriode) continue;
    const set = workerDaySet[wp.mat];
    if (!set) continue;
    const travaillePendantFerie = set.has(jf.date);
    const presentEncadrant = !!(jourAvant && jourApres && set.has(jourAvant) && set.has(jourApres));
    if (!travaillePendantFerie && !presentEncadrant) continue; // NOUVEAU — plus de forfait

    const fKey = `${wp.periode}|${wp.mat}`;
    if (!ferieWorkers[fKey]) ferieWorkers[fKey] = { matricule: wp.mat, nom: wp.nom, periode: wp.periode, ferme: wp.ferme, details: [] };
    const avgCout = wp.coutCount > 0 ? wp.totalCout / wp.coutCount : 0;
    const raison = travaillePendantFerie ? 'Travaillé le jour férié' : 'Présent avant/après le jour férié';
    ferieWorkers[fKey].details.push({ date: jf.date, label: jf.label, raison, cout: avgCout });
  }
}
```

`findJourAvant`/`findJourApres` définis en §3.3, à ajouter comme fonctions
privées du module (même style que `buildHalfToPeriode`/`resolveHolidayPeriode`
juste au-dessus dans le fichier).

---

## 4. Exemples chiffrés

Hypothèses : férié `2026-07-30` (Fête du Trône), quinzaine `2026-07-H2`
contient les dates 16→31 juillet. `today = '2026-08-05'` (le férié est donc
passé, filtre §3.1 passe).

`joursTravailles` (globaux, tous ouvriers) contient au moins : `2026-07-29`,
`2026-07-31` (pas de pointage le 30, férié chômé pour la ferme dans cet
exemple) → `jourAvant = '2026-07-29'`, `jourApres = '2026-07-31'`.

| Ouvrier | Pointages autour du 30/07 | Résultat | Raison |
|---|---|---|---|
| A | 29/07 ✅, 31/07 ✅ (pas le 30) | **Crédité** | Présent avant/après le jour férié |
| B | 29/07 ✅, 30/07 ✅ (a travaillé le férié, récolte) | **Crédité** | Travaillé le jour férié |
| C | 29/07 ✅, absent 31/07 (revenu seulement le 03/08) | **Non crédité** | — (pas de présence encadrante ni travail le jour férié) |
| D | Nouvel ouvrier, premier pointage le 01/08 | **Non crédité** | — (n'a pas travaillé le 29/07, donc pas de présence encadrante ; n'a pas travaillé le 30/07) |
| E (comportement actuel, AVANT fix) | Un seul pointage le 16/07, rien ensuite | Crédité (bug) | "Jour férié dans la quinzaine" — **ce cas ne doit plus être crédité après le fix** |

---

## 5. Fichiers à modifier (implémentation future, sur GO)

| Fichier | Changement |
|---|---|
| `functions/src/modules/rh/pointageService.js` | Remplacer boucle `ferieWorkers` (769-789) par l'algorithme §3 ; ajouter `findJourAvant`/`findJourApres` près de `buildHalfToPeriode`/`resolveHolidayPeriode` (687-709) |
| `functions/src/modules/rh/pointageService.js:1707-1728` (et `:2827` si toujours présent — **vérifier au moment de l'implémentation**) | Aucun changement de signature attendu, `computeChargCond(allRows, holidays)` reste identique |
| Tests | Vérifier s'il existe déjà un test unitaire pour `computeChargCond` (chercher dans `functions/lib/**/__tests__` ou `tests/unit/`). **Probable qu'il n'en existe pas** (fonction historiquement dans le monolithe `pointageService.js`, pas dans `functions/lib/`) — créer un test ciblé couvrant les 4 cas du tableau §4 avec un jeu de lignes `allRows` simulé minimal. |

Aucun changement frontend (`public/app.jsx`) requis — le front affiche
`jourFerieDetail` tel quel.

---

## 6. Limitations connues (hors scope de ce fix)

- **Montant estimé, pas réel** : `avgCout` reste une moyenne du coût
  journalier de l'ouvrier sur la quinzaine, pas le coût réel du jour férié.
  Ce fix corrige QUI est crédité, pas COMBIEN. À traiter dans un item séparé
  si Omar le souhaite.
- **"Jour ouvré" dérivé des données, pas d'un vrai calendrier de repos** :
  `joursTravailles` (§3.2) est un proxy (jours où AU MOINS UN ouvrier de la
  ferme a une ligne) — si toute la ferme est arrêtée un jour donné pour une
  raison non-fériée (panne, intempérie), ce jour n'apparaît dans aucun
  `DateStr` et ne perturbe donc pas le calcul (il ne devient simplement pas
  un "jour ouvré" candidat pour jourAvant/jourApres). Cas jugé acceptable,
  à surveiller si des faux-négatifs apparaissent en usage réel.
- **Nouvel ouvrier embauché juste après un férié, ou juste avant, sans
  chevauchement** : non crédité (cas D §4) — comportement voulu par la règle
  "présence réelle", mais représente un changement par rapport au forfait
  actuel. À signaler explicitement à Omar comme impact attendu du fix (des
  ouvriers qui touchaient la prime avant ne la toucheront plus si leur
  présence ne l'entoure pas).
- **Recalcul rétroactif borné** : le warm-cache (TTL=0) ne recharge que les
  2 dernières quinzaines (`periodes.slice(0, 2)`) — l'historique plus ancien
  déjà servi/caché ailleurs n'est pas retouché par ce fix tant qu'il n'est
  pas explicitement recalculé.

---

## 7. Vérification avant déploiement (sur GO)

1. Test unitaire ciblé sur `computeChargCond` (voir §5) couvrant les 4 cas
   du tableau §4 — doit passer avant tout commit.
2. `npm run qa` (gate unique du projet) doit être 100% vert.
3. Avant deploy prod : comparer manuellement (log ou export) le
   `jourFerieDetail` avant/après sur au moins une quinzaine réelle passée
   contenant un férié, pour quantifier combien d'ouvriers perdent
   l'éligibilité — partager ce chiffre à Omar avant le deploy hosting/functions
   (pas seulement la QA visuelle Playwright générique, qui ne couvre pas la
   justesse métier du montant).
4. Déploiement : `scripts/deploy.sh functions` d'abord (backend uniquement,
   pas de changement frontend), pas de preview hosting nécessaire pour ce
   fix — mais respecter quand même la validation Omar avant deploy prod
   (changement de logique de calcul de paie = sensible même sans UI à
   valider visuellement).
