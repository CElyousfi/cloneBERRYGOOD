# SYNC_NOTES — synchro upstream du 2026-09-03

> Note historique. L'outillage de synchro amont qu'il décrit (`route_hunks.py`,
> `parity_check.py`, `module_map.json`, `sync-report/`) a été retiré avec le
> monolithe le 2026-09-17 ; le portage d'un delta amont se fait désormais
> directement dans `src/modules/` et `functions/src/`.

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

## Modularisation du backend

`functions/index.js` est passé de **19 463 lignes à un barrel de 114 lignes**,
sans logique métier. Détail complet dans [ARCHITECTURE_BACKEND.md].

| | avant | après |
|---|---|---|
| `functions/index.js` | 19 463 | **114** |
| `functions/pointageService.js` | 5 976 | 248 + 6 fichiers |
| `functions/emailService.js` | 5 043 | 1 400 + 5 fichiers |
| plus gros fichier backend | 19 463 | **1 629** |

Trois routeurs d'actions ont été éclatés : `stockManagement` (118 actions),
`pointageRH` (48) et `emailAnalysis` (40). Les corps sont **verbatim** ; le
contexte du handler passe par `ctx` et est re-destructuré en tête de module.

**Vérifié** : 105 exports (diff vide) · métadonnées de déploiement 0/105
différence · texte des 206 handlers identique · séquence des actions identique ·
`parity_check.py` backend **162/162** · émulateur Firebase : action inconnue →
400 après traversée des 6 modules, `pointageRH` → 403 (garde avant dispatch).

**Non fait, et pourquoi** : la séparation service/repository *à l'intérieur* de
chaque domaine demanderait de réécrire le corps des 206 handlers pour en
extraire les accès Firestore — ce que le brief interdit, et sans filet de test
par handler. Le découpage livré atteint les objectifs vérifiables et laisse la
mise en couches à un travail ultérieur, tests de comportement d'abord.

---

## Fichiers encore au-dessus de 2 000 lignes

Cinq fichiers restent hors limite. Aucun n'est un oubli.

| Fichier | Lignes | Raison |
|---|---|---|
| `public/app.jsx` | 69 799 | **décision explicite** : encore servi en production ; sa suppression est conditionnée au déploiement de la version modulaire |
| `public/components/CampagneAnalytiqueTab.jsx` | 3 695 | composant React — voir ci-dessous |
| `src/modules/rh/QuinzaineTab.jsx` | 3 554 | idem |
| `public/components/CampagneBudgetTab.jsx` | 2 815 | idem |
| `tests/unit/campagneBudgetTab.test.js` | 2 207 | fichier de test venu de l'amont |

Les sorties de build (`public/app.js`, `public/components/*.js`) sont exclues de
la règle : elles sont régénérées par `scripts/build-frontend.js`.

**Pourquoi les composants React n'ont pas été découpés.** `QuinzaineTab` compte
**52 appels de hooks** au premier niveau et seulement ~298 lignes de fonctions
internes sans hook. Les ~3 200 lignes restantes sont du JSX qui ferme sur cet
état. Descendre sous 2 000 exigerait d'extraire des sous-composants en faisant
passer des dizaines de variables d'état en props — une reformulation, pas un
déplacement, avec un risque réel sur l'ordre des hooks, et **aucun test** ne
couvre ce composant.

S'y ajoute un coût de maintenance : `QuinzaineTab.jsx` est aujourd'hui
**byte-identical** au bloc correspondant du monolithe amont. C'est précisément
ce qui a rendu la synchro de ce jour sûre — le bloc amont a pu être repris tel
quel. Le découper romprait cette correspondance pour toutes les synchros à
venir, sans rapprocher du seuil tant que `public/app.jsx` reste là.

Le brief tranche ce cas : « quand les deux objectifs s'opposent, la parité
gagne — livrer la structure qu'on peut en gardant le comportement identique, et
signaler le reste plutôt que remodeler du code qu'on ne comprend pas
entièrement. » C'est ce qui a été fait.

---

## Cibles npm ajoutées

`npm run build` et `npm run lint` n'existaient pas alors que le brief les exige.

- **build** : `build:frontend` (monolithe legacy) puis `migrate:build` (bundle
  modulaire).
- **lint** : garde de syntaxe sur les 1 164 fichiers JS/JSX versionnés, via
  `@babel/parser` dans le dialecte de chaque fichier. Pas d'ESLint — le brancher
  sur ~70 000 lignes gelées pour non-régression produirait des milliers
  d'avertissements de style sans rapport avec le travail.
- **typecheck** : cible distincte, **jamais verte dans ce dépôt**. Elle échouait
  d'abord sur la configuration (`baseUrl`, supprimé par TypeScript 7) ; ce point
  corrigé, elle expose **1 403 erreurs de types préexistantes** (`@ts-check` sur
  167 fichiers). Chantier séparé, non entrepris ici.

---

## Anomalie amont supplémentaire — signalée, non corrigée

`scriptable/BGF-PFQ.js:117` contient un **chemin de capture d'écran macOS collé
par accident** au milieu du code : le fichier ne peut pas être analysé, et le
widget est cassé. Présent en amont depuis `9dfc88a` (2026-03-28).

Trouvé par la garde de syntaxe nouvellement ajoutée. Conformément au brief, il
est **signalé et non corrigé** : il figure dans la liste d'exceptions justifiées
de `scripts/lint.cjs`, affichée à chaque exécution du lint.

---

## État de la mission

- **Frontend : parité atteinte** — `parity_check.py` 340/340, delta amont porté.
- **Backend : modularisé** — `functions/index.js` réduit à un barrel de 114
  lignes, `parity_check.py` 162/162, plus aucun fichier backend hors limite.
- **Prototype Supabase retiré** — 27 489 lignes qui ne servaient à rien.
- **Reste ouvert** : `public/app.jsx`, par décision explicite, tant que la
  version modulaire n'est pas déployée ; et les trois composants React ci-dessus.
