# SYNC_NOTES — synchro upstream du 2026-09-03

Delta porté : `5cd084e..5f9a586` (5 commits, 24 fichiers, +3 260/−543).
Branche : `sync/upstream-2026-09-03`. Base précédente : `3a6576d..5cd084e` (2026-09-02).

---

## Ce qui a été porté

Thème unique du delta : **heures supplémentaires et émargement par quinzaine**.

| Domaine | Portage |
|---|---|
| Backend | `functions/lib/primes/heuresSupWrite.js`, `emargementWrite.js` (neufs) ; 2 actions ajoutées dans l'export existant `primesManagement` ; `coutOuvrierCampagne.js` suit le changement de clé |
| Règles | `firestore.rules` : `rh_heures_sup` déclaré CF-only ; `storage.rules` : `rh_emargements` create-only client, lecture interdite |
| Frontend modulaire | `src/modules/rh/QuinzaineTab.jsx` — corps repris verbatim de l'amont |
| Composants globaux | `public/components/HsEmargementFooter.{jsx,js}` (neuf) |
| Libs | `public/lib/scanClientUpload.js` — ajout de `uploadDirectToPath` |
| Outillage | `scripts/deploy.sh`, `scripts/build-frontend.js`, `docs/ai/*` |
| Legacy | `public/app.jsx`, `public/app.js` resynchronisés sur l'amont |

**Méthode.** Tous les fichiers du delta sauf `public/index.html` étaient
**identiques à l'upstream au BASE**. La copie verbatim reproduit donc exactement
l'amont — c'est la forme de portage la plus sûre disponible, et elle est
vérifiable par hachage. `public/index.html`, seul fichier divergent, a reçu un
portage ciblé (voir plus bas).

**Routage.** `route_hunks.py` place les 14 hunks de `public/app.jsx` dans une
**unique** définition, `QuinzaineTab` (340 définitions indexées, 0 hunk
orphelin). Notre `QuinzaineTab.jsx` étant encore byte-identical au bloc du BASE,
le bloc amont a été repris tel quel plutôt que de rejouer 14 hunks à la main.

---

## Vérifications de non-régression

| Invariant | Résultat |
|---|---|
| Parité frontend (`src/modules`) | **340/340**, 0 manquante |
| Surface d'export Cloud Functions | **105 noms, diff vide** avant/après |
| Onglets de navigation | **126, diff vide** |
| Build modulaire | OK — 337 modules |
| `migrate:verify` | 355/358 blocs byte-identical, **0 référence non résolue** |
| Tests unitaires | **3 349 passent** |

---

## Corrections faites au passage

### `canonArt` — écrans Magasin cassés dans la version modulaire

`canonArt` est un `const` fléché coincé entre deux `function` de premier niveau
dans `public/app.jsx` (l. 51478). L'extraction modulaire l'a **perdu**, alors que
deux écrans migrés l'appellent : `MagFicheStockTab.jsx:46` et
`InventaireStockView.jsx:48/49/87`. Aucune définition, aucun import, aucune
globale ne le fournissait : **ReferenceError** à l'ouverture de « Fiche de Stock »
et « Inventaire » de la version modulaire.

Rétabli verbatim dans `src/modules/magasin/canonArt.jsx`, comportement vérifié
identique à `functions/lib/stock/articleKey.js` `canon` (la source de vérité
backend) sur les cas qui motivent son existence. Parité passée de 339/340 à 340/340.

---

## Ce qui n'a PAS été porté, et pourquoi

### `public/index.html` — portage ciblé, pas de copie

Seul fichier du delta déjà divergent du BASE. Il porte **nos** ajouts locaux :
`appId`/`messagingSenderId` Firebase, et la garde lecture-seule qui bloque les
écritures Firestore quand l'app tourne sur `localhost`. Une copie verbatim les
aurait effacés.

Le diff amont ne contenait qu'une seule vraie nouveauté — la balise
`HsEmargementFooter.js` — le reste n'étant que du re-bump de cache-bust. La
balise a été insérée **à sa position amont** (après `CampagneBudgetTab.js`) :
l'ordre de chargement gouverne l'ordre d'enregistrement des globales. Liste et
ordre des scripts vérifiés identiques à l'amont.

### `--ignore` de `parity_check.py` : aucun

Aucune définition n'a été volontairement écartée. Les deux rapports de parité
atteignent 0 manquante **sans** `--ignore`. Il n'y a donc rien à justifier ici —
et c'est voulu : une entrée `--ignore` non justifiée est un bug caché derrière un
drapeau.

---

## Anomalies constatées — signalées, non corrigées

### 10 tests en échec, antérieurs à cette synchro

Vérifié : ces mêmes 10 échecs existent sur `8a5d4c8`, avant tout portage. Ils ne
sont donc pas des régressions. Conformément au brief, ils sont signalés et **non
corrigés**.

- Jours fériés / primes (4) : « Aïd 2 jours → la prime ne compte QUE le 1er
  jour », « un férié fixe unique compte 1 jour par ouvrier actif »,
  « computeChargCond: férié 16 juin crédité à la Q24… », « cas A/B/C/D du spec §4 »
- `computePointageWindow` / `todayInCasablanca` (6) : fenêtre 7 jours, bascule de
  jour en heure locale Casablanca, traversée de mois, `windowDays` personnalisable
  et invalide, format `YYYY-MM-DD`

Le groupe Casablanca sent le test dépendant de la date courante — à confirmer
avant de conclure à un bug de production.

### Doublons — copies potentiellement divergentes

`parity_check.py` signale 11 noms définis à plusieurs endroits dans
`src/modules`. La plupart sont bénins (`bootstrap.jsx` qui réexpose, ou un `.js`
compilé à côté de son `.jsx`). Trois sont de vraies redéfinitions locales d'une
constante partagée, et méritent d'être unifiées :

- **`FARMS`** — redéfini dans 5 fichiers de `src/modules` en plus de
  `src/modules/shared/FARMS.jsx`
- **`matchCulture`** — `agronomie/` et `recolte/RecolteTab.jsx`
- **`getHa`** — `agronomie/` et `qualite/QualiteProductionTab.jsx`

### 3 blocs non-verbatim signalés par `migrate:verify`

`AchatsBonApportTab.jsx:10`, `CAISSE_EDIT_CONSTS.jsx:11`,
`QualiteProductionTab.jsx:21`. Antérieurs à cette synchro.

---

## Outillage : absent du dépôt, réécrit

`route_hunks.py`, `parity_check.py` et `module_map.json` n'étaient **pas** dans le
dépôt alors que le brief les supposait présents. Réécrits d'après leur
spécification :

- `parity_check.py` — auto-détecte l'indentation de premier niveau du monolithe
  (**8** pour `app.jsx`, enveloppé dans une IIFE ; **0** pour `functions/index.js`),
  rapporte manquants et doublons, sort non-zero pour servir de garde CI.
- `route_hunks.py` — indexe les définitions et leurs plages, rattache chaque hunk
  à son propriétaire côté ancien fichier.
- `module_map.json` — **340 entrées**, généré depuis l'arbre réel puis complété à
  la main pour les 6 cas ambigus. Aucune ambiguïté résiduelle.

---

## État de la mission

- **Frontend : parité atteinte** (340/340) et structure modulaire en place.
- **Backend : modularisation NON COMMENCÉE.** `functions/index.js` fait
  19 359 lignes pour 105 exports. C'est le gros du travail restant, et l'objet de
  la Phase 3 (plan d'architecture à approuver avant tout déplacement de code).
- **`public/app.jsx` toujours présent** (69 799 lignes) : encore servi en
  production via `public/app.js`. Sa suppression est conditionnée au déploiement
  de la version modulaire — décision prise explicitement, pas un oubli.
