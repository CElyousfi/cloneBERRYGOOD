# INVENTORY — Phase 0

Date : 2026-09-03 · Branche : `sync/upstream-2026-09-03`
Upstream lu en lecture seule à `../upstream-readonly`, HEAD figé à `5cd084e`,
`origin/main` = `5f9a586`.

---

## 1. Vérification du verrou lecture seule

| Contrôle | Attendu | Constaté |
|---|---|---|
| `git remote -v` (ce dépôt) | aucun upstream | `myclone` seul ✅ |
| `git -C ../upstream-readonly remote -v` | push `BLOCKED` | `BLOCKED-DO-NOT-PUSH` ✅ |
| `git -C ../upstream-readonly status --short` | vide | vide ✅ |
| hooks `pre-push` / `pre-commit` | présents, exécutables | présents, `exit 1` ✅ |
| `HEAD` upstream | inchangé | `5cd084e…` avant et après `fetch` ✅ |

`/tmp/upstream-head-at-clone.txt` avait été effacé avec le `/tmp` de la session
précédente : ré-enregistré à `5cd084e59eff3f7ec9dbab359cfecf8495529601`, avec une
copie durable dans le scratchpad de session. Seul `git fetch` a été exécuté dans
l'upstream — il met à jour `origin/main` sans toucher au `HEAD` détaché.

---

## 2. Le backend, c'est quoi

**Firebase Cloud Functions**, `functions/`, runtime Node, API `firebase-functions`
v1 avec chaînage de région (`functions.region("europe-west1").https.onRequest(…)`).

- Point d'entrée : `functions/index.js` — **19 359 lignes**, monolithique.
- **105 exports** au runtime (liste figée dans `/tmp/exports-before.txt`).
  - 76 définis en ligne dans `index.js` (`exports.X = functions…`)
  - 10 délégués à un service (`exports.X = syncService.Y`)
  - le reste via d'autres formes
- Surface : **57 `onRequest` HTTP**, **10 tâches planifiées `pubsub.schedule`**,
  **5 déclencheurs Firestore**, 0 `onCall`.
- 60 `require()` de premier niveau — le monolithe est déjà adossé à un
  `functions/lib/` de **44 sous-domaines** (logique pure déjà extraite et testée).
- Autres gros fichiers backend : `pointageService.js` (5 976),
  `emailService.js` (5 043), `sqlSyncService.js` (1 548).
- **`functions/src/` n'existe pas** : la structure en couches demandée est à créer
  intégralement.

Il n'y a pas de serveur Express séparé ; `api/` à la racine est un reliquat.

---

## 3. Fichiers de plus de 2 000 lignes — le périmètre de démonolithisation

**16 fichiers** dans ce dépôt dépassent la limite (hors `node_modules`, `dist*`).

### 3.1 Les deux monolithes réels

| Fichier | Lignes | Statut |
|---|---|---|
| `public/app.jsx` | 69 397 | frontend legacy, **encore servi en production** |
| `functions/index.js` | 19 359 | backend, **intouché** |

`public/app.jsx` ici est **identique octet pour octet** à l'upstream en `5cd084e`
(blob `e89e9cf…`) : la synchro précédente a fusionné le monolithe upstream tel
quel. Le dépôt est un vrai fork, historique partagé compris.

### 3.2 Décharges d'extraction orphelines — 20 622 lignes de code mort

| Fichier | Lignes | Importé par |
|---|---|---|
| `src/features/qualite/index.jsx` | 9 775 | **personne** |
| `src/features/rh/index.jsx` | 5 844 | **personne** |
| `src/features/finance/index.jsx` | 5 003 | **personne** |

Reliquats d'une première passe d'extraction abandonnée, remplacée par
`src/modules/`. Aucun import ne les référence.

### 3.3 Composants legacy `public/components/` (paires `.jsx` + `.js` compilé)

`CampagneAnalytiqueTab` (4 405 / 3 695), `CampagneBudgetTab` (3 190 / 2 815),
`MagBCTab` (3 060), `PrimesFixesTab` (2 142), plus `public/app.js` (3 292, sortie
de build) et `tests/unit/campagneBudgetTab.test.js` (2 207).

### 3.4 Modules déjà migrés mais encore trop gros

`src/modules/rh/QuinzaineTab.jsx` (3 152) — seul fichier de `src/modules/`
au-dessus de 2 000.

---

## 4. Ce qui existe déjà dans l'arbre modulaire

`src/modules/` couvre les **11 domaines métier + `shared`** :

| Module | Fichiers | Lignes |
|---|---|---|
| qualite | 27 | 12 126 |
| agronomie | 50 | 8 044 |
| rh | 24 | 7 996 |
| achats | 16 | 7 263 |
| finance | 35 | 7 193 |
| shared | 74 | 5 949 |
| technique | 25 | 5 545 |
| recolte | 15 | 5 491 |
| admin | 21 | 4 519 |
| caisse | 41 | 4 158 |
| magasin | 12 | 2 836 |
| securite | 6 | 831 |

**Parité frontend mesurée** (`parity_check.py`, upstream `origin/main` →
`src/modules`) : **340 définitions de premier niveau indexées, 339 présentes,
1 manquante** (`canonArt`, apparue dans le nouveau delta).

→ **Le frontend est structurellement migré à ~100 %.** Les 11 modules sont tous
substantiels ; aucun n'est vierge. 126 onglets sont câblés dans
`AuthenticatedApp.jsx` (référence figée dans le scratchpad).

**Parité backend** : **162 définitions indexées, 9 présentes, 153 manquantes.**
Une partie des 153 sont des liaisons `require()` plutôt que de la logique, mais la
conclusion tient : **le backend n'a pas commencé sa modularisation.**

---

## 5. Trois applications cohabitent dans ce dépôt

C'est le point le plus important de cet inventaire, et il n'est pas décrit dans le
document de migration.

| # | Application | Entrée | Données | Statut |
|---|---|---|---|---|
| 1 | Smart BERRY legacy | `index.html` → `public/app.jsx` | Firebase | **production** |
| 2 | Smart BERRY modulaire | `index.migrated.html` → `src/modules/` | Firebase | cible de la migration, pas encore live |
| 3 | Prototype « Bonsai » | `src/main.jsx` → `src/App.jsx` → `src/features/*/XxxDomainView.jsx` | **Supabase PostgreSQL + données mock** | prototype de refonte UI, hors périmètre parité |

L'application 3 est un chantier distinct : autre socle de données, autre esthétique,
`appDataMock.js` en dur. Elle n'a aucun rapport avec l'objectif de parité — mais
elle vit dans `src/`, et ses décharges orphelines (§3.2) pèsent 3 des 16 fichiers
hors limite.

---

## 6. Assets non-code : ce qui diffère de l'upstream

| Fichier | État |
|---|---|
| `firestore.indexes.json` | identique |
| `firebase.json` | identique |
| `firestore.rules` | **DIFFÈRE** — bloc `rh_heures_sup` upstream absent ici (14 lignes) |
| `storage.rules` | **DIFFÈRE** — bloc `rh_emargements` upstream absent ici (22 lignes) |
| `public/index.html` | DIFFÈRE — nouveaux `<script>` du delta |
| `package.json` | DIFFÈRE — divergence assumée (Vite/Vitest de la migration) |
| `functions/package.json` | DIFFÈRE — à vérifier lors du portage backend |
| `.github/workflows` | DIFFÈRE — à examiner |

---

## 7. Le nouveau delta upstream : `5cd084e..5f9a586`

5 commits, 24 fichiers, +3 260 / −543. Thème unique : **heures supplémentaires et
émargement par quinzaine**.

```
5f9a586 feat(quinzaine): joindre l'état d'émargement signé par ferme, et tracer les saisies (#381)
a4222b0 chore(deploy): rendre les règles Firestore et Storage déployables par le chemin sanctionné (#382)
010ab64 feat(quinzaine): ajouter à la main un ouvrier dans les heures sup (#380)
57f94d1 fix(quinzaine): les pop-ups nomment l'ouvrier meme sans fiche de paie (#379)
bd8bea0 fix(quinzaine): les heures sup accordées appartiennent à une quinzaine, pas à l'écran (#378)
```

- `public/app.jsx` : **14 hunks** (+492/−…)
- `functions/index.js` : **3 hunks** (+116)
- Nouveaux fichiers : `public/components/HsEmargementFooter.{jsx,js}`,
  `functions/lib/primes/emargementWrite.js`, `functions/lib/primes/heuresSupWrite.js`,
  `public/lib/scanClientUpload.js`, + 4 fichiers de tests
- Règles : `firestore.rules` (+14), `storage.rules` (+22)
- Outillage : `scripts/deploy.sh` (+135), `scripts/build-frontend.js`

Périmètre modeste et cohérent — il touche surtout **RH/Paie** et **Magasin (scan)**.

---

## 8. Doublons détectés — copies potentiellement divergentes

`parity_check.py` signale 15 noms définis à plusieurs endroits. La plupart sont
bénins (`.js` compilé à côté de son `.jsx`, ou `bootstrap.jsx` qui réexpose).
Trois méritent un examen, car ce sont des redéfinitions locales d'une constante
partagée :

- **`FARMS`** — redéfini dans 5 fichiers de `src/modules/` en plus de
  `src/modules/shared/FARMS.jsx`
- **`matchCulture`** — `src/modules/agronomie/` et `src/modules/recolte/RecolteTab.jsx`
- **`getHa`** — `src/modules/agronomie/` et `src/modules/qualite/QualiteProductionTab.jsx`

---

## 9. Outillage : absent, réécrit

`route_hunks.py`, `parity_check.py` et `module_map.json` **n'étaient pas dans le
dépôt** — jamais déposés. Le PDF de migration est présent (non suivi).

`parity_check.py` a été réécrit d'après la spécification du brief et fonctionne
(§4). Il auto-détecte l'indentation de premier niveau du monolithe : **8 espaces**
pour `app.jsx` (enveloppé dans une IIFE), 0 pour `functions/index.js`.
`route_hunks.py` et `module_map.json` restent à produire (Phase 2).

---

## 10. Bilan et conséquence sur le plan

Le travail restant n'est **pas** réparti comme le brief le suppose :

1. **Frontend — quasiment fait.** 339/340 définitions présentes. Reste : porter le
   delta des 5 commits, et faire descendre `QuinzaineTab.jsx` sous 2 000 lignes.
2. **Backend — tout est à faire.** `functions/index.js` (19 359 lignes, 105 exports)
   n'a pas bougé. C'est l'essentiel de l'effort, et c'est la partie où le risque
   est maximal : renommer un export casse une URL, détache un déclencheur ou perd
   une planification.
3. **Ménage.** `public/app.jsx` doit disparaître d'ici — mais il est **encore
   servi en production**. On ne peut pas le supprimer avant que la version
   modulaire soit la version déployée.
4. **Question ouverte : le prototype Supabase.** Il est hors parité, mais dans
   `src/`, et ses décharges orphelines violent la règle des 2 000 lignes.

Points à trancher avant d'écrire du code : voir le message qui accompagne ce
rapport.
