# HANDOVER — chantier « monolithe supprimé » (2026-09-17)

Branche `chantier/monolithe-supprime` (depuis `main` @ `3f81e97`), 18 commits,
un par étape ou lot. L'état antérieur reste sur le tag `legacy-final` et la
branche `legacy` (non recréés, non touchés).

**Résultat** : le dépôt ne contient plus que l'application Smart BERRY
modulaire — frontend `src/modules/` (Vite), backend `functions/index.js`
(barrel) + `functions/src/modules` + `functions/lib`. Aucun `window.<Majuscule>`
dans `src/`, `public/lib` et `public/components` n'existent plus, `functions/`
n'a plus qu'`index.js` à sa racine.

## Invariants (vérifiés avant chaque commit)

| Invariant | État |
|---|---|
| `functions/index.js` exporte les mêmes 105 noms (`backendExportSurface.test.js`) | ✅ 105, test vert |
| Aucun nouveau `process.env.*` sous `functions/` | ✅ (le diff `main..HEAD` ne montre que des noms *retirés*, ceux des scripts one-off déplacés) |
| `firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `.firebaserc` | ✅ untouched (`git diff main -- …` vide) |
| Runtime identique : mêmes onglets pour les mêmes profils | ✅ parcours navigateur `?testui=1` de 20 profils × 350 rendus d'onglet (126 libellés distincts) avant/après le lot 8 : même population, mêmes 12 crashs préexistants (écrans qui exigent Firestore), mêmes erreurs console |

## Tests — avant / après

| Suite | Avant (`main`) | Après |
|---|---|---|
| `npm run test:unit` | 3 376 tests / 190 fichiers | 3 354 tests / 189 fichiers |
| `npm run test:all --prefix functions` | 1 619 tests / 109 fichiers | 1 619 tests / 109 fichiers |
| `npm run lint`, `typecheck`, `build`, `verify:refs`, `npm run qa` | — | tous verts |

Les 22 tests en moins : `featureFlags.test.js` (drapeau supprimé, 12 tests),
et 10 scénarios « script `<script>` non chargé » devenus impossibles avec des
imports (détail plus bas). Aucune assertion métier n'a été retirée.

## Ce qui a été supprimé

- **Monolithe frontend** : `public/app.jsx`, `public/app.js`,
  `scripts/build-frontend.js`, devDependency `@babel/cli`, scripts npm
  `build:frontend`, `migrate:*`, `smoke:boot`.
- **Double mode** : `public/lib/featureFlags.js`, son test,
  `tests/smoke-boot-selector.js`, le sélecteur d'entrée / `window.__SB_MODULAR__` /
  `document.write` conditionnels de `public/index.html`, `index.migrated.html`,
  l'`index.html` racine mort, le job CI `boot-selector`.
- **Outillage de migration** : `scripts/migrate/{extract-modules,module-map,
  verify-fidelity,compare-frontends,walk-tabs,verify-globals,publish-modular}.cjs`,
  `module_map.json`, `parity_check.py`, `route_hunks.py`,
  `Plan_Migration_SmartBERRY_v4 (2).pdf`, `ARCHITECTURE_v2.md`,
  `ARCHITECTURE_BACKEND_PROPOSAL.md`, `.upstream-sync`, `sync-report/`.
- **Couche de scripts globaux** : les 46 fichiers de `public/lib/` et les 33
  `public/components/*.jsx` (+ leurs 33 twins compilés `.js`), le pont
  `lazyGlobalComponent.jsx`, les expositions `window.*` de `bootstrap.jsx` et
  du barrel caisse, `types/globals.d.ts` réduit aux globales CDN.
- **Backend** : `functions/=`, `functions/.DS_Store`, `api/server.js.bak`, tous
  les `.DS_Store` suivis.
- **Données et docs** : 23 classeurs/PDF à la racine (dont
  `~$Berrygood Canevas .xlsx`), 14 captures `data/*.png|html`,
  `docs/EXEMPLE-Export-Factures-*.xlsx`, `docs/BACKUP-*.json`, contenu des
  sprints caisse de `ROADMAP.md`, §1–§2 de `TODO_REFACTO.md`.
  Le PDF **non suivi** `Smart BERRY - Architecture.pdf` (présent dans le
  working tree, jamais commité) a été déplacé hors du dépôt, pas détruit :
  `/tmp/claude-1000/…/scratchpad/removed-untracked/`.

## Ce qui a été déplacé où

### Frontend (`src/modules/`)

| Origine | Destination |
|---|---|
| `public/lib/*.js` (46) | `src/modules/shared/lib/*.js`, exports ES nommés (`local-test-bypass.js` → `localTestBypass.js`, module à effet de bord importé en premier par `bootstrap.jsx`) |
| `CaisseDetailPopup`, `CaisseParametresSub`, `CaisseRevueValidation`, `CaisseSaisieSub` | `src/modules/caisse/` |
| `ArticleConversionFields`, `BCDoublonDialog`, `MagBCScanModal`, `MagBCTab` (+ `MagBCEngraisTab`, `MagBCPhytoTab`), `MagBdcReceptionTab`, `MagBonsCommandeTab`, `MagMappingConsoTab`, `MagStockFilesTab`, `InventaireMouvementsPopup`, `PmpDetailPopup`, `ConsoValoriseeTab` | `src/modules/magasin/` |
| `PivotAnalytiqueGrid`, `AffectationAnalytiqueTable`, `CampagneBudgetTab`, `CampagneAnalytiqueTab` | `src/modules/finance/` |
| `FactureDetailPopup`, `ScanAttachmentButton` | `src/modules/achats/` |
| `PrimesFixesTab`, `HsEmargementFooter`, `RapprochementPaiePopup`, `PointageValidationPanel`, `PointageValidationView`, `QuinzaineRecapCards` | `src/modules/rh/` |
| `ParcellesGroupesPanel`, `ParcellesParamsTab`, `ParcellesReferentielTab` | `src/modules/agronomie/` |
| `BugReportsAdmin` | `src/modules/admin/` |
| `BugReportButton`, `QuinzaineCampagneSelect` | `src/modules/shared/` |
| `window.SB_PARCELLE_REF` / `SB_PARCELLE_CAMPAGNE` | `src/modules/shared/sbParcelleState.js` (`sbParcelle.REF` / `.CAMPAGNE`) |

Découpages (déplacement de code, sans modification) :
`CampagneBudgetTab.jsx` (2 818 l.) → `CampagneBudgetTab.jsx` (1 480) +
`campagneBudgetRules.jsx` (1 354) ; `CampagneAnalytiqueTab.jsx` (3 707 l.) →
`CampagneAnalytiqueTab.jsx` (490) + `campagneAnalytiqueHelpers.jsx` (339) +
`campagneAnalytiqueExport.jsx` (402) + `CampagneVarieteView.jsx` (487) +
`CampagnePivotView.jsx` (1 637) + `CampagneConsoView.jsx` (441).
`MagBCTab.jsx` (1 544 l.) et `PrimesFixesTab.jsx` (1 081 l.) étaient déjà sous
2 000 lignes : non découpés.

Les 10 onglets qui passaient par `lazyGlobalComponent` sont désormais des
`React.lazy(() => import(...))` comme les autres (mêmes chunks, même
chargement différé).

### Backend (`functions/`)

| Origine (`functions/*.js`) | Destination |
|---|---|
| `pointageService*.js` (8), `pointageBdpSync`, `rhBdpService`, `sqlSyncService`, `ojraParser`, `equipesConfig` | `functions/src/modules/rh/` |
| `emailService*.js` (7) | `functions/src/modules/finance/` |
| `bdcMirrorService`, `bdcReminderService`, `bdcValidationService`, `bdcVirementService`, `magasinierBot`, `chefBdcBot` | `functions/src/modules/magasin/` |
| `whatsappService`, `whatsappProcessor`, `notificationDispatcher`, `backupService`, `bdpIntrospectService`, `dgBot`, `dgAgent`, `audioService` | `functions/src/modules/admin/` |
| `dailyProductionReport`, `recolteWhatsAppNotifier`, `prodSyncService`, `forecastService` | `functions/src/modules/recolte/` |
| `agqParser`, `parcellesCulturales` | `functions/src/modules/agronomie/` |
| `securityBot` | `functions/src/modules/securite/` |
| `firestoreDataService` | `functions/src/shared/` |
| 28 scripts ponctuels (`backfill-*`, `cleanup-*`, `check_*`, `diag-*`, `import-*`, `reprocess-*`, `fix-*`, `seed_*`, `audit-*`, `seedJoursFeries`, `setup-whatsapp-profile`, `create-whatsapp-templates`, `update-bdc-validation-template`, `add-url-buttons`, `refetch-liquidations-local`) | `scripts/backend-oneoff/` (README : `NODE_PATH=functions/node_modules node scripts/backend-oneoff/<x>.js`, dotenv sur `functions/.env`) |

### Outillage

| Origine | Destination |
|---|---|
| `scripts/migrate/verify-references.cjs` | `scripts/verify-references.cjs` (`npm run verify:refs`, couvre `.js` et `.jsx`, sortie ≠ 0 sur référence non résolue) |
| `scripts/migrate/assemble-vercel.cjs`, `gen-vercel-config.cjs` | `scripts/` (`build:vercel`, `vercel:config`) |
| sortie Vite `dist-migrated/` + `publish-modular` | Vite écrit **directement dans `public/`** (`vite.config.js`, `emptyOutDir: false`, purge de `public/chunks/`) ; `public/app.modular.js` et `public/chunks/` sont gitignorés et reconstruits par `scripts/deploy.sh hosting`, `scripts/preview.sh` (via `npm run qa`) et le CI |

## Décisions à connaître

- **Chargement des modules ES dans les tests** : `tests/unit/_esm.js`
  (`loadEsm`, Babel ESM+JSX → CJS à la volée, récursif ; `loadComponent`
  exécute un composant dans un contexte vm et sert aux imports les doubles
  que le test pose sur `sandbox.window.*`, ancien contrat des scripts
  classiques). `src/package.json` déclare `"type": "module"` ; les 3 tests de
  parité backend (`functions/lib/paie/__tests__/*.parite.test.js`) chargent le
  module ES frontend par `require(esm)` natif (Node ≥ 20.19 / 22.12 — le CI
  utilise `node-version: '20'`, donc 20.19+).
- **Parité des copies backend** (`coutMainOeuvre`, `lecturePaieExcel`) : la
  comparaison octet-pour-octet est impossible entre un module ES et sa copie
  CommonJS ; elle compare désormais le **code de chaque fonction exportée**
  (`Function.prototype.toString`, espaces normalisés) — un token qui change
  d'un côté fait tomber le test.
- **Ligne « Kg / JH » de l'écran Campagne** : `CampagneAnalytiqueTab` lisait
  `window.loadBonsFromFirestore`, que le monolithe exposait (fonction
  top-level) mais que le bundle modulaire n'exposait plus — la ligne était
  donc silencieusement absente en mode modulaire. Elle importe maintenant
  `shared/loadBonsFromFirestore.jsx`, ce qui restaure le comportement du
  monolithe. Seul écart assumé par rapport au bundle modulaire d'avant
  chantier ; invisible dans le parcours `?testui=1` (les bons viennent de
  Firestore).
- **Mode démo Vercel** (`DEMO_NO_AUTH=1 npm run build:vercel`) : la
  neutralisation des gardes de `localTestBypass` se fait à la compilation
  (define Vite `__SB_DEMO_NO_AUTH__`) au lieu d'une réécriture textuelle du
  fichier buildé par `assemble-vercel.cjs`.
- **Tests « script non chargé » retirés** (scénario impossible avec des
  imports, la garde correspondante dans le code reste inerte) :
  `campagneAnalytiquePivot` (budget idéal sans CampagneUtils, module manquant
  CultureUtils, cadence sans CampagneProduction, rapprochement sans module,
  pop-up quinzaine sans module — 5), `campagneBudgetTab` (parcelleAffichable
  sans CultureUtils), `bcScanMatch` (CultureUtils absent), `magBCScanModal`
  (BcScanMatch absent), `uniteConsoUtils` et `bcScanMatch` (contrat UMD/IIFE
  remplacé par un contrat « export ES, rien sur window »),
  `magBCUniteConversion` (ordre des `<script>` → imports présents).
- **Générateurs `docs/ai`** (`generate-code-index.js`,
  `generate-module-graph.js`) scannent `src/modules` (exports ES, arêtes
  `loadEsm`) et `functions/src` ; la colonne « Export global » et
  `parseWindowExports`/`parsePublicLibExports` ont disparu ; `monolithIndex`
  devient `tabIndex` (fichier + ligne de chaque `function XxxTab`).
- Les tests de contrat qui lisaient `public/app.jsx` lisent la concaténation
  de `src/modules` (`tests/unit/_sources.js`) ou le fichier extrait concerné.
- `functions/lib/marcheLocalCaisse/__tests__/fixtures/ml_snapshot.json`
  (fixture de test, 7 408 lignes en JSON indenté) a été re-sérialisé une
  entrée par ligne (826 lignes, contenu identique) pour satisfaire le
  contrôle de taille de la DEFINITION OF DONE, dont le motif `*.js*` attrape
  les `.json`.
- Douze copies CommonJS de `functions/lib/` (paieUtils, plafondDeclaration,
  coutMainOeuvre, lecturePaieExcel, campagneUtils, cultureUtils,
  analytiqueUtils, campagneExportUtils, bdcWorkflow, scanAttachmentUtils,
  movementGuard, stockGuard) gardent leur shim
  `if (typeof window !== 'undefined') window.X = …`, inerte sous Node : ce sont
  des copies déployées, non touchées par le chantier ; `types/globals.d.ts`
  les déclare pour le typecheck.

## Exceptions / non fait

- Aucune étape laissée de côté. Rien n'a nécessité de changer un
  comportement, un nom de function, une variable d'environnement ou un champ
  Firestore.
- Non demandé mais à noter : `MIGRATION_REPORT.md` et `SYNC_NOTES.md` sont
  conservés comme documents historiques (le second porte une note d'en-tête
  signalant que l'outillage qu'il décrit a été retiré) ; les specs `docs/spec-*`
  mentionnent encore d'anciens chemins dans leur contexte historique.
- Les scripts d'import ponctuels (`scripts/import-*.js`,
  `scripts/backend-oneoff/*`) attendent leurs classeurs d'entrée, désormais
  hors dépôt.

## DEFINITION OF DONE

Sortie du script fourni (voir fin du rapport de session) : toutes les lignes
`OK`, `npm run qa` vert.
