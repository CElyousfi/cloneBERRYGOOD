---
description: Charger le périmètre probable d'un ticket Smart Berry depuis le graphe DIL
---

# /load-context — Périmètre probable pour ticket

**Ticket :** $ARGUMENTS

## Processus

### Étape 1 — Lire le graphe DIL

Lire `docs/ai/module-graph.json` (Read tool). Si le fichier est absent, afficher :
```
⛔ BROKEN — docs/ai/module-graph.json introuvable.
Générer : node scripts/generate-module-graph.js
```
et arrêter.

Extraire `_meta.sourceFingerprint` et `_meta.healthScore.total`.

### Étape 2 — Vérifier la fraîcheur

Exécuter : `node scripts/generate-module-graph.js --fingerprint-only`

- Si la sortie diffère du `sourceFingerprint` stocké → afficher un bandeau **⚠️ STALE** et régénérer (`node scripts/generate-module-graph.js`) avant de continuer.
- Si la commande échoue → mentionner le risque mais continuer avec le graphe existant.

### Étape 3 — Détecter le(s) domaine(s)

Lire `docs/ai/domains.json` (Read tool). Pour chaque domaine, calculer un score en comptant les keywords présents dans le ticket (insensible à la casse). Le domaine avec le plus haut score est le **domaine principal**.

Règles :
- Score 0 partout → **aucun domaine détecté** (voir Étape 4b).
- **Score gagnant < 6** (un seul keyword court ≤ 5 chars) → probable faux positif (ex : "stockée" → "stock", "log" → "admin") — traiter comme **aucun domaine détecté** et aller en Étape 4b.
- Score gagnant ≥ 6 ET ex-aequo entre ≥ 2 domaines → les mentionner tous les deux, confidence = **medium**.
- Score ≥ 6 avec un seul keyword long (≥ 6 chars) → confidence **high**.
- Score ≥ 6 avec plusieurs keywords courts → confidence **medium**.

Domaines disponibles (10) : `pointage`, `paie`, `recolte`, `qualite`, `stock`, `caisse`, `achats`, `agro`, `referentiel`, `admin`.

### Étape 4a — Domaine détecté : sortie structurée

Extraire depuis `domains.<domaine>` les sections `frontend`, `backend`, `firestore`, `tests`, `gitCoupling`.

Lire `monolithIndex` du graphe JSON. Filtrer les entrées dont `domain` correspond
au domaine principal détecté. Trier alphabétiquement par nom. Si `monolithIndex`
est absent du graphe (graphe ancien), ignorer cette section.

**Notes cross-domaine obligatoires selon le domaine principal :**

- **`referentiel`** : `ParcellesReferentielTab.jsx` appelle aussi `/api/pointage-rh` (CF `pointageV3`, domaine `pointage`). Compléter avec une exploration minimale sur le composant principal pour détecter les routes additionnelles :
  ```
  grep -n "api/" public/components/ParcellesReferentielTab.jsx
  ```
  Si la route `/api/pointage-rh` est présente, inclure dans le périmètre :
  - Service : `functions/pointageService.js` (domaine pointage, heatmap #7)
  - CF : `pointageV3` → `/api/pointage-rh`
  - Collections : `sql_mirror_pointage`, `sql_mirror_pointage_workers`

- **`paie`** : toutes les Cloud Functions paie passent par les guards auth. Inclure systématiquement :
  - `functions/lib/auth/paieAccess.js` — gate accès paie (domaine admin)
  - `functions/lib/auth/registryAccess.js` — gate accès registre ouvriers (domaine admin)
  - `functions/lib/auth/resolveRole.js` — résolution de rôle (domaine admin)
  - CFs affectées : `primesManagement`, `fonctionsManagement` (et toute nouvelle CF paie)

- **`pointage`** : vérifier aussi `functions/pointageBdpSync.js` (heatmap #4) et `functions/pointageService.js` (heatmap #7) — fichiers racine hors lib/ exclus du graphe par défaut mais critiques.

- **`stock`** : mutations de stock passent par `stockMovementGuard` — inclure `public/lib/stockMovementGuard.js` même si non listé dans les libs du domaine.

Afficher la sortie au format suivant :

---
## Périmètre probable — `<label domaine>` (confidence: high/medium/low)

> ⚠️ Il s'agit d'un périmètre **probable**, pas exhaustif. Le graphe DIL couvre ~58% des fichiers. Toujours vérifier par Read/Grep si un comportement inattendu apparaît.

### Frontend
- **Tabs** : `<liste>`
- **Composants** : `<liste>`
- **Libs** : `<liste>`

### Backend
- **Cloud Functions** : `<liste CF>` (routes : `/api/<route>`)
- **Modules lib** : `<liste functions/lib/<module>>`
- **Services racine** : `<liste functions/*.js>` _(hors lib — heatmap si présents)_

### Firestore
- Collections : `<liste>`
- ⚠️ Collections protégées implicitement par CF (non déclarées dans `firestore.rules`) peuvent être absentes de cette liste — vérifier les `db.collection()` dans les CFs concernées.

### Tests existants
- Unitaires : `<liste tests/unit/*.test.js>`
- Backend : `<liste functions/lib/.../__tests__/*.test.js>`

### Couplage git (probabiliste, 90 jours)
- `<fichiers co-commités fréquemment>` — modifier l'un implique souvent de vérifier l'autre.

### Notes cross-domaine
- `<notes selon le domaine, voir règles ci-dessus>`

### Exploration complémentaire recommandée
Si le ticket touche un composant spécifique non listé ci-dessus :
```
grep -n "api/" public/components/<Composant>.jsx
```
Pour vérifier les routes API appelées et les cross-dépendances non capturées par le graphe.
---

### Étape 4b — Aucun domaine détecté : clarification

Si le score est 0 pour tous les domaines, NE PAS choisir un domaine arbitrairement.

Afficher :

---
## /load-context — Clarification nécessaire

Le ticket **"$ARGUMENTS"** ne contient pas de signal domaine reconnu par le graphe DIL.

Pour fournir un périmètre ciblé, préciser **lequel** de ces domaines est concerné :

| # | Domaine | Signaux typiques |
|---|---------|-----------------|
| 1 | **Pointage & Présence** | pointage, présence, équipe, BDP, BDG, journée, validation chef |
| 2 | **Paie & RH** | paie, salaire, primes, quinzaine, SMAG, bulletin, ouvrier |
| 3 | **Récolte & Production** | récolte, cueillette, variété, rendement, croissance |
| 4 | **Qualité** | qualité, calibre, PFQ, inspection |
| 5 | **Stock & Magasin** | stock, mouvement, inventaire, PMP, magasin, bon de commande |
| 6 | **Caisse & Finance** | caisse, transaction, dépense, avance, rapprochement |
| 7 | **Achats & Fournisseurs** | achat, BDC, commande, fournisseur, facture |
| 8 | **Agro & Environnement** | agro, météo, irrigation, Netafim, fertigation |
| 9 | **Référentiel & Analytique** | parcelle, ferme, campagne, analytique, référentiel |
| 10 | **Administration** | auth, backup, logs, admin, bug report |

> Pour une feature générique (nouveau Tab + CF + Firestore sans domaine métier),
> indiquer quel **périmètre fonctionnel** elle couvre — ex. "stock" ou "caisse".
> Le graphe chargera alors les conventions de ce domaine (collections existantes,
> pattern CF, tests unitaires de référence).
---
