# Smart BERRY — Architecture

Application de gestion agricole de Berry Good Farms (RH / pointage, récolte,
qualité, magasin, achats, caisse, finance, agronomie, sécurité, direction).
Frontend React modulaire servi par Firebase Hosting, backend en Cloud
Functions (Node 20, CommonJS), données dans Firestore + miroir SQL Server
(BEE ONE). Voir [README.md](README.md) pour le fonctionnel, [CLAUDE.md](CLAUDE.md)
pour les règles de travail.

## Structure du dépôt

```
src/modules/                 frontend — 12 modules ES (Vite), 446 fichiers
├── bootstrap.jsx            point d'entrée : effets de bord d'origine, dans l'ordre,
│                            jusqu'à ReactDOM.render(<App/>)
├── index.js                 barrel racine (re-exporte les 12 barrels de module)
├── shared/                  socle : App, AuthenticatedApp (shell + renderTab),
│   │                        ErrorBoundary, PROFILES, hooks, état partagé…
│   └── lib/                 46 helpers PURS (paie, caisse, campagne, stock, scans…)
├── achats/ admin/ agronomie/ caisse/ finance/ magasin/
├── qualite/ recolte/ rh/ securite/ technique/
└── package.json             { "type": "module" } — src/ est ESM
public/                      ce que Firebase Hosting publie
├── index.html               charge les bibliothèques CDN puis <script type="module" src="/app.modular.js">
├── app.modular.js, chunks/  SORTIE DU BUILD (gitignorée, produite par `npm run build`)
├── sw.js, manifest.json, 404.html, app-version.txt, assets/
└── *.json                   données statiques (budget_bgf, catalogue_articles, …)
functions/                   backend Cloud Functions
├── index.js                 BARREL : union des exports des modules — 105 noms figés
├── src/modules/<domaine>/   9 modules métier (admin, agronomie, caisse, finance,
│                            magasin, recolte, rh, securite, technique) : handlers
│                            HTTP / crons / triggers + services du domaine
├── src/shared/              socle backend (core.js, firestoreDataService.js)
├── lib/<domaine>/           47 domaines PURS, injectés (DI), testés avec node:test
├── middleware/              cors, cache, requireAuth
└── config/                  firebase, sqlConfig
tests/unit/                  189 fichiers node:test (frontend + contrats de source)
tests/helpers/, tests/*.js   helpers, smokes Playwright, tests d'intégration HTTP
scripts/                     outillage (build/deploy/QA, code-index, imports) ;
                             scripts/backend-oneoff/ = scripts ponctuels ex-functions/
docs/                        specs, runbooks ; docs/ai/* = index générés (npm run code-index)
types/globals.d.ts           globales CDN pour `npm run typecheck`
```

## Frontend

### Modules ES, un fichier par déclaration

Chaque composant, hook, helper ou constante vit dans son propre fichier
(`src/modules/<module>/<Nom>.jsx`), avec des `import` explicites. Aucun
fichier ne dépasse 2 000 lignes. Les 12 barrels `index.js` re-exportent leur
module ; `src/modules/index.js` les agrège.

Les helpers purs de `src/modules/shared/lib/` sont des modules ES à exports
nommés (`export { a, b }`), consommés en `import * as PaieUtils from
'../shared/lib/paieUtils.js'` puis `PaieUtils.computeWorkerPaie(...)`. Trois
d'entre eux (paieUtils, coutMainOeuvre, lecturePaieExcel) ont une **copie
CommonJS** dans `functions/lib/` — Firebase ne déploie que `functions/`, un
`require('../src/…')` y ferait crasher toutes les Cloud Functions au
chargement. Des tests de parité (`functions/lib/paie/__tests__/*.parite.test.js`)
comparent le code de chaque fonction exportée.

### Ce qui reste global

React, ReactDOM, Firebase (compat), XLSX, jsPDF, pdf-lib, pdf.js, Leaflet et
driver.js sont chargés par CDN dans `public/index.html` et lus comme globales
(`React`, `XLSX`, `typeof PDFLib !== 'undefined'`…). Le bundle ne contient que
le code applicatif. `types/globals.d.ts` les déclare pour le typecheck.

Quelques handles d'exécution de l'application restent sur `window`
(`window.fetch` enveloppé pour injecter le token, `window.firebaseAuth`,
`window.showToast`, `window._refreshNotifications`, `window.__APP_VERSION`) :
ce sont des points de coordination du shell, pas une couche de scripts.

### Rendu des onglets

`AuthenticatedApp.jsx` (shared) porte la navigation : 20 profils, 126 onglets.
Chaque onglet est un `React.lazy(() => import('../<module>/<Tab>.jsx'))` rendu
par `renderTab(id, Component, props, label)` sous un `TabErrorBoundary` qui
enveloppe le `Suspense` : un chunk qui échoue ou un onglet qui plante reste
localisé à cet onglet.

### Build

`npm run build` = `vite build` (config : [vite.config.js](vite.config.js)).
Entrée `src/modules/bootstrap.jsx`, sortie **directement dans `public/`** :
`app.modular.js` (≈240 Ko) + `chunks/*.js` (166 chunks, noms stables sans
empreinte — `firebase.json` sert le JS en `no-cache`). `public/chunks/` est
vidé avant chaque build. La sortie est gitignorée : `scripts/deploy.sh hosting`,
`scripts/preview.sh` (via `npm run qa`) et le CI la reconstruisent avant tout
deploy ou smoke.

Le contournement local `?testui=1` (`src/modules/shared/lib/localTestBypass.js`,
importé en premier par `bootstrap.jsx`) mocke l'auth et `/api/*` sur
localhost ; `DEMO_NO_AUTH=1 npm run build:vercel` neutralise ses gardes à la
compilation (define `__SB_DEMO_NO_AUTH__`) pour la préversion Vercel.

## Backend

### Le barrel et les 105 noms

`functions/index.js` itère sur les modules de `functions/src/modules/` et
fusionne leurs exports. **Une Cloud Function est adressée par son nom
d'export** : le renommer supprime l'ancienne et en crée une neuve (URL HTTP,
déclencheur, cron). Les 105 noms sont verrouillés par
`tests/unit/backendExportSurface.test.js`.

| Type | Nombre | Rôle |
|---|---|---|
| `onRequest` (HTTP) | 57 | routes `/api/*` (rewrites dans `firebase.json`) |
| Crons (`pubsub.schedule`) | 17 | synchronisations BEE ONE, digests, rappels |
| Déclencheurs Firestore | 9 | `onWrite` / `onCreate` / `onUpdate` |

### Modules et services

`functions/src/modules/<domaine>/` contient les handlers (actions
`?action=…` d'une route) et les services du domaine (par ex.
`rh/pointageService*.js`, `finance/emailService*.js`,
`admin/whatsappService.js`, `magasin/bdc*Service.js`,
`recolte/dailyProductionReport.js`). `functions/src/shared/core.js` est le
socle commun (auth, cache, dispatch de notifications).

`functions/lib/<domaine>/` regroupe 47 domaines **purs et injectés** : ils ne
touchent ni Firestore ni le réseau, ce qui les rend testables sans émulateur
(`__tests__/` dans chaque dossier, `npm run test:all --prefix functions`).
C'est le pattern à dupliquer pour tout nouveau domaine.

### Données

- Firestore (projet `berrygood-farms-dashboard`, région `europe-west1`) :
  la plupart des collections sont en lecture seule côté client, les écritures
  passent par les Cloud Functions (`firestore.rules`).
- SQL Server BEE ONE : miroir tiré par crons (`rh/sqlSyncService.js`,
  `rh/pointageBdpSync.js`, `recolte/prodSyncService.js`).
- WhatsApp Business (Meta) : `admin/whatsappService.js`, bots
  `admin/dgBot.js`, `magasin/chefBdcBot.js`, `magasin/magasinierBot.js`,
  `securite/securityBot.js`, entrée `whatsappProcessor.js`.

## Tests et gates

- `npm run test:unit` — `tests/unit/*.test.js` (node:test). Les modules ES
  sont chargés depuis CommonJS via `tests/unit/_esm.js` (`loadEsm`, et
  `loadComponent` pour un composant dans un contexte vm avec React factice).
  `tests/unit/_sources.js` sert le source concaténé de `src/modules` aux
  tests de contrat.
- `npm run test:all --prefix functions` — tests des domaines purs backend.
- `npm run lint` (syntaxe de tous les fichiers suivis), `npm run typecheck`
  (fichiers `// @ts-check`), `npm run verify:refs` (toute référence libre de
  `src/modules` se résout), `npm run build`.
- `npm run qa` enchaîne tests, build et la fraîcheur des index `docs/ai/*`.
- CI : [.github/workflows/test.yml](.github/workflows/test.yml).

## Déploiement

`scripts/deploy.sh functions` déclenche le workflow GitHub `deploy-prod.yml`
(Workload Identity Federation, asynchrone) ; `scripts/deploy.sh hosting`
reconstruit le bundle puis publie `public/` (token, synchrone) ;
`scripts/preview.sh` publie un canal de préversion après `npm run qa`.
Séquence, garde-fous et runbook : [CLAUDE.md](CLAUDE.md) et
[docs/deploy-wif-prod.md](docs/deploy-wif-prod.md).
