# Smart BERRY — Berry Good Farms Dashboard

Application de gestion d'exploitation agricole pour **Berry Good Farms**
(fruits rouges et avocats, Maroc). Elle couvre le cycle complet : pointage des
ouvriers, paie à la quinzaine, récolte et primes, qualité et expéditions,
achats et magasin, trésorerie, agronomie et irrigation.

**126 écrans, 20 profils utilisateurs, 105 Cloud Functions, 63 collections
Firestore.**

---

## Sommaire

1. [Ce qu'il faut comprendre en premier](#1-ce-quil-faut-comprendre-en-premier)
2. [Démarrage rapide](#2-démarrage-rapide)
3. [Vocabulaire métier](#3-vocabulaire-métier)
4. [Les 12 modules métier](#4-les-12-modules-métier)
5. [Profils et cloisonnement](#5-profils-et-cloisonnement)
6. [Architecture frontend](#6-architecture-frontend)
7. [Architecture backend](#7-architecture-backend)
8. [Données et intégrations](#8-données-et-intégrations)
9. [Workflows métier](#9-workflows-métier)
10. [Commandes](#10-commandes)
11. [Tests et qualité](#11-tests-et-qualité)
12. [Déploiement](#12-déploiement)
13. [Notifications WhatsApp](#13-notifications-whatsapp)
14. [Conventions de code](#14-conventions-de-code)
15. [Historique de la migration](#15-historique-de-la-migration)
16. [Pièges connus](#16-pièges-connus)
17. [Où trouver quoi](#17-où-trouver-quoi)

---

## 1. Ce qu'il faut comprendre en premier

**Le frontend est une application React modulaire** : 446 modules ES dans
`src/modules/` (12 modules métier + `shared`), construits par Vite en un bundle
d'entrée + un chunk par onglet, publiés par Firebase Hosting depuis `public/`.
Le backend est un ensemble de 105 Cloud Functions (`functions/`) dont
`index.js` n'est qu'un barrel : la logique vit dans `functions/src/modules/`
(handlers et services par domaine) et `functions/lib/` (47 domaines purs,
testés sans émulateur).

La sortie du build (`public/app.modular.js`, `public/chunks/`) n'est **pas**
commitée : `npm run build` la produit, et les scripts de deploy la
reconstruisent depuis un checkout propre de `main`.

> Si vous ne lisez qu'une section de ce README, lisez celle-ci et
> [§6 Architecture frontend](#6-architecture-frontend).

---

## 2. Démarrage rapide

### Prérequis

- **Node 20** (`functions/package.json` → `engines`). Node 22+ marche pour le
  développement, mais les Cloud Functions tournent sur Node 20 en production —
  les tests doivent passer sur cette version.
- Un navigateur Chromium pour les smokes Playwright.

### Installation

```bash
npm ci
npm ci --prefix functions
```

### Construire

```bash
npm run build      # Vite → public/app.modular.js + public/chunks/
```

### Lancer en local, sans backend ni compte

```bash
npx http-server public -p 8088
# → http://localhost:8088/?testui=1
```

`?testui=1` active `src/modules/shared/lib/localTestBypass.js` : authentification simulée
et routes `/api/*` interceptées par des réponses factices. **Le garde-fou est en
première instruction du module** — actif uniquement sur `localhost`,
`127.0.0.1` et `0.0.0.0`. Aucun effet en production, aucune écriture dans la
base réelle.

### Avant tout commit

```bash
npm run qa         # 8 étapes, ~3 min, échoue à la première anomalie
```

---

## 3. Vocabulaire métier

Sans ces termes, le code est illisible. Ils viennent de l'exploitation, pas de
l'informatique.

| Terme | Sens |
|---|---|
| **Quinzaine** | Période de paie de 15 jours (deux par mois). Unité de référence de la paie, des primes et du coût de main-d'œuvre. Beaucoup d'écrans s'agrègent par quinzaine, pas par mois. |
| **Pointage** | Relevé de présence journalier des ouvriers, par parcelle et par opération. Source de la paie. |
| **Ferme** | `F1` `F2` `F3` `F4` `F5` `F6` `BAHIA` `Avocatier`. F1 = framboise, F5 = myrtille, Avocatier = avocats. |
| **Parcelle** | Unité de culture. Porte deux identités : le **libellé BEE ONE** (système historique) et le **nom Smart BERRY** — d'où le référentiel de correspondance (voir §16). |
| **Caporal** | Chef d'équipe terrain, saisit la récolte de son équipe. |
| **BDC** | Bon de Commande — achat fournisseur, soumis à un circuit de validation. |
| **DA** | Demande d'Achat — précède le BDC, exprime le besoin. |
| **BL** | Bon de Livraison — accompagne la marchandise reçue. |
| **Bon d'apport** | Livraison de fruits d'un producteur tiers vers la station. |
| **PFQ** | Contrôle qualité interne sur un lot (défauts, calibre, Brix). |
| **Brix** | Taux de sucre du fruit, mesuré au réfractomètre. |
| **Écart** | Fruit déclassé, sorti du circuit export. |
| **Liquidation** | Règlement final d'une expédition, une fois le prix de vente connu. |
| **Marché local** | Vente hors export, sur le marché national. |
| **Ojra** | Main-d'œuvre journalière externe (terme marocain). |
| **GDD** | *Growing Degree Days* — cumul thermique pilotant la phénologie. |
| **Fertigation** | Apport d'engrais via l'eau d'irrigation. |
| **DQR** | *Daily Quality Report* — rapport qualité quotidien. |
| **CPC** | Coût de Production Comparé — tableau de bord financier par culture. |

---

## 4. Les 12 modules métier

`src/modules/` est découpé par domaine. Chaque module expose ses écrans via un
barrel `index.js`.

### `achats` — 15 fichiers, 15 écrans
Cycle d'achat complet : demandes d'achat, consultations fournisseurs, bons de
commande, réceptions, factures, paiements, rapprochement. Inclut le scan de BL
et de factures (OCR assisté par IA) et le catalogue produits.

### `agronomie` — 49 fichiers, 17 écrans
Le plus gros module. Parcelles, fertilisation, phytosanitaire, analyses
foliaires, irrigation, croissance, prévision de récolte, avancement des travaux,
planification, campagne. C'est le cœur technique de l'exploitation.

### `qualite` — 26 fichiers, 20 écrans
Contrôle qualité (PFQ interne, inspections, Brix, calibres), bons d'apport,
expéditions, écarts, liquidations, marché local, réconciliation. Contient aussi
les écrans de validation des chefs de ferme.

### `finance` — 34 fichiers, 17 écrans
Trésorerie, chiffre d'affaires, budget vs réel, codes analytiques, factures,
paiements, virements, carburant, télécom, plants, stock valorisé, liquidations.

### `rh` — 30 fichiers, 7 écrans
Pointage, quinzaine, paie, équipes, suivi. `QuinzaineTab` est l'écran le plus
dense de l'application (calcul du coût chargé, heures supplémentaires,
émargement, rapprochement au fichier de paie).

### `magasin` — 12 fichiers, 9 écrans
Stock d'intrants : réceptions, sorties, transferts, inventaire, mouvements,
fiche article, parc matériel.

### `recolte` — 14 fichiers, 9 écrans
Saisie de récolte par les caporaux, suivi, coût de récolte, hors-récolte,
primes de rendement.

### `technique` — 24 fichiers, 9 écrans
Météo, irrigation intelligente, GDD, climat/production, écrans stationnaires
(postes de terrain).

### `admin` — 20 fichiers, 8 écrans
Console d'administration, paramètres, validations DG, tâches, comptes rendus de
réunion, signature, adoption.

### `caisse` — 40 fichiers, 1 écran
Un seul onglet mais 40 fichiers : la caisse est un écran unique très riche
(transactions, sous-vues saisie/paramètres/revue, popups de détail).

### `securite` — 5 fichiers, 5 écrans
Registre d'entrées/sorties, incidents, tunnels, scan de registre, envois
WhatsApp.

### `shared` — 74 fichiers
Socle commun : `App`, `AuthenticatedApp` (le routeur d'onglets), `LoginScreen`,
composants graphiques, hooks, helpers. Aucun écran métier.

---

## 5. Profils et cloisonnement

L'application ne connaît pas de « rôles » abstraits mais **20 profils** nommés,
chacun avec son propre jeu d'onglets :

| Profil | Libellé |
|---|---|
| `dg` | Direction Générale |
| `rh` | Responsable RH |
| `achats` | Achats |
| `finance` | Responsable Finance |
| `qualite` | Qualité |
| `magasinier` | Responsable Magasin |
| `agronomie` | Responsable Agronomie |
| `dt` | Directeur Technique |
| `audit_interne` | Audit Interne |
| `securite` | BSNL Sécurité |
| `chef_f1` `chef_f5` `chef_avo` `chef_bahia` | Chefs de ferme |
| `caporal_f1` `caporal_f5` `caporal_avo` | Caporaux |
| `stationnaire_f1` `stationnaire_f5` `stationnaire_avo` | Stationnaires |

Les profils `dg`, `finance`, `admin` et `audit_interne` ont un accès transverse
et peuvent basculer de profil depuis la barre supérieure. Les chefs et caporaux
sont **cloisonnés à leur ferme** — le backend applique ce cloisonnement, pas
seulement l'interface (`resolvePointageRHAccess`).

Le profil courant est mémorisé dans `localStorage` (`lastProfile`, `lastTab`) et
détermine quels `renderTab(...)` sont évalués dans
`src/modules/shared/AuthenticatedApp.jsx`.

---

## 6. Architecture frontend

### Un fichier par déclaration

`src/modules/` est l'application : 446 fichiers, 106 900 lignes, aucun
au-dessus de 2 000 lignes.

| Module | Fichiers | Module | Fichiers |
|---|---|---|---|
| shared | 123 (dont 46 helpers purs dans `shared/lib/`) | rh | 37 |
| agronomie | 54 | qualite | 27 |
| finance | 46 | magasin | 25 |
| caisse | 45 | technique | 25 |
| admin | 22 | achats | 18 |
| recolte | 15 | securite | 6 |

Chaque composant, hook, helper ou constante vit dans son propre fichier avec
des `import` explicites ; chaque module a un barrel `index.js`.
`src/modules/bootstrap.jsx` est le point d'entrée : les effets de bord du
démarrage, dans l'ordre, jusqu'au `ReactDOM.render(<App/>)`.

Les helpers purs de `src/modules/shared/lib/` (paie, caisse, campagne, stock,
scans…) sont des modules ES à exports nommés, consommés en
`import * as PaieUtils from '../shared/lib/paieUtils.js'`. Trois d'entre eux
(`paieUtils`, `coutMainOeuvre`, `lecturePaieExcel`) ont une copie CommonJS
dans `functions/lib/` — Firebase ne déploie que `functions/` — et des tests de
parité comparent le code de chaque fonction exportée.

### Chargement différé des onglets

Les 126 onglets sont chargés au premier affichage, pas au démarrage :
`React.lazy(() => import('../<module>/<Tab>.jsx'))`, un chunk Vite chacun.

Dans `renderTab` (`src/modules/shared/AuthenticatedApp.jsx`), la frontière
d'erreur **enveloppe** le `Suspense`, pas l'inverse : un chunk qui échoue à se
charger rejette pendant le rendu, et c'est l'`ErrorBoundary` qui doit
l'attraper — sinon l'onglet resterait bloqué sur « Chargement du module… »
indéfiniment.

### Poids

| | |
|---|---|
| Entrée (`app.modular.js`) | **≈ 240 Ko** |
| Chargé à la demande | 166 chunks |

### Pas de bundler pour React

React, ReactDOM, Firebase (compat), XLSX, jsPDF, pdf-lib, pdf.js, Leaflet et
driver.js sont chargés **par CDN** dans `index.html`. Le bundle Vite ne
contient que le code applicatif. C'est pourquoi `React` et `XLSX` sont des
globales et non des imports (déclarées dans `types/globals.d.ts`).

### Build

`npm run build` = `vite build` ([vite.config.js](vite.config.js)) : entrée
`src/modules/bootstrap.jsx`, sortie **directement dans `public/`**
(`app.modular.js` + `chunks/`, noms stables — `firebase.json` sert le JS en
`no-cache`). `public/chunks/` est vidé avant chaque build. La sortie est
gitignorée : `scripts/deploy.sh hosting`, `scripts/preview.sh` (via
`npm run qa`) et le CI la reconstruisent avant tout deploy ou smoke.

---

## 7. Architecture backend

### Le barrel

`functions/index.js` fait **34 lignes**. Il itère sur les modules et fusionne
leurs exports — aucune logique métier :

```
functions/
├── index.js              34 lignes, 105 exports
├── src/modules/          9 modules métier (admin, agronomie, caisse, finance,
│                         magasin, recolte, rh, securite, technique) : handlers
│                         des routes + services du domaine (pointageService,
│                         emailService, whatsappService, dgBot, bdc*Service…)
├── src/shared/           socle commun backend (core, firestoreDataService)
├── lib/                  44 domaines purs et testables
├── middleware/           cors, cache, requireAuth
└── config/               firebase, sqlConfig
```

**Aucun fichier au-dessus de 2 000 lignes ; `functions/` ne contient à sa
racine que `index.js`.** Les scripts d'exploitation ponctuels vivent dans
`scripts/backend-oneoff/`.

> ⚠️ **Une Cloud Function est adressée PAR SON NOM D'EXPORT.** Le renommer
> supprime l'ancienne fonction et en crée une neuve : URL HTTP changée,
> déclencheur Firestore détaché, cron perdu, clients en vol cassés. Les 105 noms
> sont **figés** et verrouillés par diff dans
> `tests/unit/backendExportSurface.test.js`.

### Les 44 domaines de `lib/`

`achats` `auth` `bdc` `bugReports` `caisse` `caisseImport` `campagneBudget`
`campagneExport` `campagneRapportHebdo` `consoBons` `dates` `finance`
`fonctions` `heuresSup` `irrigation` `joursFeries` `mappingConso`
`marcheLocalCaisse` `meteo` `netafim` `paie` `parcelleGroupes` `phenology`
`phone` `pointage` `pointageBdp` `pointageValidation` `primes`
`probeStaleness` `productivity` `qualite` `receptionValorisation` `rh`
`sentinel` `stock` `stockCaneva` `stockFiles` `stockMerge` `stockRoles`
`suppliers` `triage` `uniteConso` `validation` `valorisation`

Ces modules sont **purs et injectés** (dependency injection) : ils ne touchent
ni Firestore ni le réseau directement, ce qui les rend testables sans émulateur.
Chacun a son dossier `__tests__/`. C'est le pattern à dupliquer pour tout
nouveau domaine.

### Types de functions

| Type | Nombre | Rôle |
|---|---|---|
| `onRequest` (HTTP) | 57 | routes `/api/*` |
| Crons (`pubsub.schedule`) | 17 | synchronisations, digests, rappels |
| Déclencheurs Firestore | 9 | `onWrite` / `onCreate` / `onUpdate` |

54 routes `/api/*` sont mappées dans `firebase.json` vers ces functions, région
`europe-west1`. Les autres exports sont des crons et déclencheurs sans route.

Exemples de crons : `5 * * * *` (pull horaire du pointage depuis la BDP),
`*/15 9-11 * * *` et `*/15 19-21 * * *` (rappels aux fermes), `0 4 * * *`
(sauvegarde), `30 20 * * *` (rapport quotidien).

---

## 8. Données et intégrations

### Firebase

| | |
|---|---|
| Projet | `berrygood-farms-dashboard` |
| Région | `europe-west1` |
| Auth | e-mail/mot de passe + Google (popup) |
| Bucket Storage | `berrygood-farms-photos` *(pas le bucket par défaut — cf. `.firebaserc`)* |
| SDK client | **compat**, chargé par CDN dans `index.html` |

Le SDK est initialisé en clair dans `public/index.html`. **La `apiKey` d'une
application web Firebase est publique par conception** : la sécurité repose sur
`firestore.rules` et `storage.rules`, pas sur le secret de cette clé.

### Firestore — 63 collections

Principales familles :

- **RH / paie** — `sql_mirror_pointage`, `sql_mirror_pointage_workers`,
  `ouvriers_registry`, `rh_config`, `rh_heures_sup`, `quinzaine_archive`,
  `pointage_validations_equipe`
- **Récolte / qualité** — `prod_tracabilite_recolte`, `sql_mirror_cueillette`,
  `pfq_interne`, `expeditions`, `liquidations`, `liquidation_forecasts`,
  `bons_apport_saisie`, `clients_marche_local`
- **Achats / magasin** — `stock_movements`, `stock_balances`, `stock_requests`,
  `sql_mirror_consommation`, `parcelles_consommation`, `bc_scan_*`
- **Finance** — `caisse_transactions`, `caisse_definitions`, `tresorerie_items`,
  `budgets`, `cpc_snapshots`, `consumption_costs_by_variety`
- **Agronomie** — `irrigation_readings`, `growth_measurements`,
  `growth_plot_config`, `netafim_parcelles_bahia`, `parcelle_ferme_referentiel`
- **Système** — `users`, `config`, `app_settings`, `notifications`,
  `whatsapp_logs`, `whatsapp_sessions`, `bug_reports`, `api_cache`,
  `sql_sync_status`, `connection_logs`

> La plupart des collections sont **en lecture seule côté client** ; les
> écritures passent par les Cloud Functions. C'est une règle de sécurité
> délibérée : ne pas l'assouplir.

### Miroir SQL (BDP)

Le pointage provient d'un **SQL Server externe** (BEE ONE / « BDP »,
port 1433), synchronisé toutes les heures vers les collections
`sql_mirror_*`. L'application lit le miroir Firestore, jamais SQL directement.

`GET /api/health` renvoie l'état de cette synchronisation (`rowCounts`,
`lastSuccessAt`, `consecutiveFailures`, `error`). **C'est le premier endroit à
regarder si le pointage semble figé.**

### Intégrations externes

| Service | Usage |
|---|---|
| **Meta / WhatsApp Cloud API** (`graph.facebook.com`) | notifications, bots de validation, rappels |
| **Netafim** (`apim.netafim.com`) | relevés d'irrigation de la ferme BAHIA |
| **Meteoblue** (`my.meteoblue.com`) | météo et fenêtres de traitement, avec cache Firestore partagé |
| **Open-Meteo** | source météo de secours |
| **Anthropic / OpenAI** | triage de bugs, agent DG, analyse d'e-mails, bot sécurité, prévisions |
| **Aladhan** | horaires de prière (organisation des équipes) |

---

## 9. Workflows métier

### Bon de Commande (BDC)

```
brouillon ──soumission──▶ en_attente_chef ──▶ en_attente_dg ──▶ valide_dg
     ▲                                                              │
     └──────────────── rejete ◀─────────────────┘                   ▼
                                                        envoye ▶ virement_lance
                                                                ▶ virement_signe
```

**Les fermes sans chef de ferme** (`Avocatier`, `F2`, `F3`, `F4`, `F6`,
`BAHIA`, et les BDC mutualisés `Toutes`) sautent l'étape chef et partent
directement au DG — `DIRECT_DG_FARMS` dans `functions/lib/bdc/workflow.js`.
L'interface l'annonce dans le formulaire de création.

À chaque transition, une notification WhatsApp part vers le profil concerné,
avec le PDF du BDC en pièce jointe quand il a pu être généré.

### Pointage → paie

```
SQL Server (BDP)  ──cron horaire──▶  sql_mirror_pointage  ──▶  écran Pointage
                                              │
                                              ▼
                              validation par équipe (chef de ferme)
                                              │
                                              ▼
                          Quinzaine : coût chargé, heures sup, primes
                                              │
                                              ▼
                             émargement + rapprochement fichier de paie
```

Le calcul du coût employeur combine : SMAG daté (salaire minimum agricole,
historisé), ancienneté par paliers, primes de fonction, charges patronales et
salariales, jours fériés et heures supplémentaires **accordées** (une décision
de la paie, pas une conversion des minutes badgées).

### Récolte → qualité → liquidation

Saisie caporal → traçabilité récolte → contrôle PFQ (défauts, calibre, Brix) →
expédition ou marché local ou écart → liquidation une fois le prix de vente
connu.

---

## 10. Commandes

### Construire

| Commande | Effet |
|---|---|
| `npm run build` | `vite build` → `public/app.modular.js` + `public/chunks/` (gitignorés) |
| `npm run build:vercel` | build puis assemblage de `dist-vercel/` (site statique déployable) |
| `npm run build:vercel:demo` | idem, sans authentification (define `__SB_DEMO_NO_AUTH__`) |

### Vérifier

| Commande | Effet |
|---|---|
| **`npm run qa`** | **la gate — à lancer avant tout commit** |
| `npm run test:unit` | 189 fichiers de test frontend |
| `npm run test:all --prefix functions` | 109 fichiers de test backend |
| `npm run lint` | analyse syntaxique de tous les fichiers suivis |
| `npm run typecheck` | `tsc` sur les fichiers annotés `// @ts-check` |
| `npm run verify:refs` | toute référence libre de `src/modules` se résout |
| `npm run code-index` | régénère `docs/ai/*` |

### Déployer

| Commande | Effet |
|---|---|
| `scripts/preview.sh --post-merge` | canal de préversion Firebase |
| `scripts/deploy.sh hosting` | frontend en production |
| `scripts/deploy.sh functions` | backend (déclenche le CI, **asynchrone**) |

---

## 11. Tests et qualité

### La gate : `npm run qa`

Huit étapes, échec à la première anomalie :

1. tests unitaires frontend (`tests/unit`)
2. tests backend (`functions/{lib,middleware}/*/__tests__`)
3. build frontend (Vite)
4-8. fraîcheur des cinq artefacts générés (`docs/ai/module-graph.json`,
   `code-map-actions`, `code-map-components`, `code-map-modules`,
   `require-index`)

> **Definition of done :** si un ticket touche `functions/` ou `src/modules/`,
> lancer `npm run code-index` et committer les `docs/ai/*` régénérés — sinon la
> gate échoue sur l'obsolescence des empreintes.

### Outillage

- **`node:test` natif** — pas de Jest, pas de Vitest, pas de React Testing
  Library. Les modules ES sont chargés depuis CommonJS par
  `tests/unit/_esm.js` (`loadEsm`) ; les tests « composant » les évaluent
  dans `node:vm` avec un `createElement` factice (`loadComponent`) et
  inspectent l'arbre rendu sans DOM. C'est une limitation documentée, pas un
  oubli.
- **Playwright** pour les smokes navigateur (`tests/smoke-*.js`) et
  `tests/e2e-visual.js`, qui se connecte avec un vrai compte
  (`QA_TEST_EMAIL` / `QA_TEST_PASSWORD`) et parcourt douze écrans réels sur
  Chromium et WebKit. **Non câblé en CI faute de compte de test.**
- **CI** (`.github/workflows/test.yml`) sur chaque push et PR : lint →
  typecheck → tests front → tests back → build → `verify:refs`.

---

## 12. Déploiement

### Règle absolue

**Tout déploiement part de `main`**, jamais d'une branche. `scripts/deploy.sh`
refuse si l'arbre est sale, si la branche n'est pas `main`, ou si `main` n'est
pas à jour avec son remote.

### Séquence

1. **Backend d'abord** — `scripts/deploy.sh functions`. **Asynchrone** : la
   commande déclenche un run GitHub Actions et rend la main immédiatement. Le
   nouveau backend n'est *pas* live quand le script se termine. Suivre avec
   `gh run watch`. Lancer les smokes trop tôt teste l'ancienne version.
2. **Préversion** — `scripts/preview.sh --post-merge`, validation visuelle.
3. **Frontend** — `scripts/deploy.sh hosting`, après validation.

### Workload Identity Federation

Le déploiement des functions passe par WIF : aucune clé de service account,
aucun token, ni en local ni sur le VPS. Le runner échange son jeton OIDC contre
une impersonation du service account `sb-deployer`.

> ⚠️ **Le provider WIF est verrouillé sur un dépôt précis**
> (`attribute-condition="assertion.repository=='omaaouni/BERRYGOOD'"`, cf.
> `docs/deploy-wif-prod.md`). Un déploiement des functions depuis un autre
> dépôt **échouera** : GCP n'émettra pas de jeton. Pour y remédier, ajouter le
> dépôt à la condition du provider et poser `WIF_PROVIDER` /
> `WIF_SERVICE_ACCOUNT` en variables de dépôt, avec un environment
> `production`.

### Vercel

`vercel.json` déclare tout : `buildCommand`, `outputDirectory: dist-vercel`,
54 proxys `/api/*` vers les Cloud Functions de production, et un catch-all SPA.
Rien à configurer à la main.

Les proxys sont des réécritures **côté serveur** : le navigateur voit des
requêtes de même origine, donc pas de préflight CORS.

> **Sur un domaine Vercel, « Se connecter avec Google » échoue en
> `auth/unauthorized-domain`** tant que le domaine n'est pas ajouté dans
> Firebase Console → Authentication → Settings → Domaines autorisés. La
> connexion e-mail/mot de passe fonctionne depuis n'importe quel domaine.

---

## 13. Notifications WhatsApp

Envoyées **par le backend**, jamais par le frontend. Trois conditions doivent
être réunies, et le code les échoue **silencieusement** :

1. **Destinataire** — `resolveRecipientsForProfile`
   (`functions/src/modules/admin/whatsappService.js`) ne retient un utilisateur que si `profileId`
   correspond, `whatsappEnabled === true` **et** `whatsappPhone` est renseigné
   en E.164 (`+2126…`). Un champ manquant → zéro destinataire, aucune erreur.
2. **Config** — document Firestore `config/whatsapp` : `enabled`,
   `phone_number_id`, `access_token`. Un token Meta temporaire expire en 24 h ;
   seul un token System User est permanent.
3. **Template Meta** — approuvé, langue `fr`, nombre de paramètres exact.
   Ex. `bdc_validation_needed_v2` (4 params) et `bdc_validation_needed_doc`
   (idem + en-tête document PDF).

**Toute notification proactive doit être un template.** Un message *free-form*
est rejeté silencieusement par Meta hors de la fenêtre de 24 h.

**Diagnostic :** chaque tentative est journalisée dans `whatsapp_logs`
(`templateName`, `status`, `error`). Aucune entrée = zéro destinataire résolu.
Codes Meta utiles : `132001` template introuvable ou non approuvé, `132007`
rejeté, `132012`/`132018` paramètres non conformes, `131008` paramètre invalide
(saut de ligne ou 4 espaces consécutifs).

**Tester sans déployer :** `POST /api/whatsapp-admin?action=test-message`
(`{phone}`) ou `action=simulate-template` (`{template_name, phone, params}`).

---

## 14. Conventions de code

- **CommonJS** côté backend (`functions/`). **Modules ES** dans `src/` (`src/package.json` : `"type": "module"`).
- Composants React **fonctionnels** uniquement. CSS inline via `style={{…}}`,
  variables CSS `var(--berry)` définies dans `index.html`. **Pas de Tailwind**,
  pas de librairie de composants.
- Tests en **`node:test`** natif.
- `src/modules/shared/lib/*.js` et `functions/lib/**` : JSDoc strict avec `// @ts-check`.
- Champs Firestore en `snake_case` ASCII. **Ne jamais renommer un champ
  existant** (`caisse_id`, `status`…) : toute la stack les consomme.
- Statuts caisse : `brouillon | soumis | a_revoir | valide | rejete`. Les
  libellés capitalisés (`Saisi`, `À revoir`) sont un affichage, pas la valeur
  stockée.
- Dates : toujours passer par `functions/lib/dates/isoDateInTz.js`. **Jamais**
  un motif de locale (voir §16).

### Globales

Seules les bibliothèques CDN (`React`, `XLSX`, `firebase`…) sont des globales.
Tout ce qui vient du dépôt s'importe : **aucun `window.X` applicatif**, ni en
écriture ni en lecture (les handles du shell — `window.fetch` enveloppé,
`window.firebaseAuth`, `window.showToast` — sont l'exception assumée).

---

## 15. Historique de la migration

Le frontend et le backend étaient deux monolithes d'environ 70 000 et 12 000
lignes. La migration s'est faite en trois temps, chacun vérifié à
comportement identique : extraction mécanique du frontend vers `src/modules/`
(353/355 instructions octet-pour-octet, détail dans
[MIGRATION_REPORT.md](MIGRATION_REPORT.md)), découpage du backend en
`functions/src/modules/` + `functions/lib/` derrière un barrel, puis
suppression du legacy en septembre 2026 (monolithe, ancien build, couche de
scripts globaux convertie en modules ES importés, services backend rangés par
domaine — parcours navigateur de 20 profils × 350 rendus identique
avant/après). L'état antérieur est conservé sur le tag `legacy-final` et la
branche `legacy`.

| Objectif du plan client v1.1 | Cible | État |
|---|---|---|
| Nombre de modules | 11+ | ✅ 12 |
| Non-régression des écrans | 100 % | ✅ 0 écart |
| Code splitting | par module | ✅ 166 chunks |
| Lignes max par fichier | < 2 000 | ✅ (`src/` et `functions/`) |
| Ancien code supprimé | oui | ✅ |
| CI lint → typage → tests → build | complète | ✅ |
| TypeScript | JSDoc → `.tsx` → strict | ⚠️ étape 1/3 (`typecheck` à 0 erreur) |
| Tests E2E, parcours métier | 5–10 | ⚠️ écrits, non câblés en CI |
| Taille du fichier principal | < 200 Ko | ❌ ≈ 240 Ko |
| Couverture de composants | > 60 % | ❌ ni Vitest ni RTL |
| Lighthouse | > 90 | ❌ non mesuré |
| Monitoring Sentry | actif | ❌ absent |

---

## 16. Pièges connus

Leçons durement apprises. Les ignorer coûte cher.

**Smoke-load navigateur avant toute préversion.** Un bundle qui échoue au
boot ne se voit dans aucun test node ; charger la page dans un vrai navigateur
(`?testui=1` en local) avant de déclarer une préversion prête.

**Le backend ne peut pas `require('../src/…')`.** Firebase ne déploie que
`functions/` : un tel require donne `Cannot find module` et **toutes** les
Cloud Functions crashent au chargement. Les tests locaux ne le voient pas.
Dupliquer le helper dans `functions/lib/` (les tests de parité surveillent les
copies existantes).

**Dates et locales.** `new Intl.DateTimeFormat('en-CA', …).format(d)` ne rend
**pas** `YYYY-MM-DD` de façon fiable : le motif de date courte vient du CLDR et
change entre versions d'ICU — sur ICU 72, `en-CA` rend `08/15/2026`. Toujours
assembler les champs via `formatToParts` — c'est ce que fait
`functions/lib/dates/isoDateInTz.js`.

**Le référentiel Smart BERRY est chargé après connexion.**
`sb-referentiel-list` exige un jeton. Chargé trop tôt (avant session), il
renvoie 401 et `sbParcelle.REF` (`shared/sbParcelleState.js`) reste vide : les parcelles s'affichent
alors sous leur libellé BEE ONE brut, et une parcelle dont `culture_sb` diverge
devient invisible sous un filtre Culture. `sbLoad()` est rejoué dans
`onAuthStateChanged`.

**Un payload API partiel ne doit jamais faire tomber un écran.** Les lectures
profondes (`data.summary.total`, `carb.prixMoyenLitre.toFixed()`) doivent être
gardées : un mois vide ou une API dégradée renvoie un objet incomplet, et
l'onglet entier disparaît derrière « Erreur d'affichage ».

**WhatsApp proactif = template uniquement.** Un message free-form est droppé
silencieusement par Meta hors de la fenêtre de 24 h.

**Ne jamais committer la sortie du build.** `public/app.modular.js` et
`public/chunks/` sont gitignorés : ils se reconstruisent au deploy.

---

## 17. Où trouver quoi

| | |
|---|---|
| Guide agent, conventions détaillées, règles de gouvernance | [`CLAUDE.md`](CLAUDE.md) |
| Rapport de migration (livrable client) | [`MIGRATION_REPORT.md`](MIGRATION_REPORT.md) |
| Architecture | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`ARCHITECTURE_BACKEND.md`](ARCHITECTURE_BACKEND.md) |
| Runbook déploiement WIF | [`docs/deploy-wif-prod.md`](docs/deploy-wif-prod.md) |
| Backlog et décisions en attente | [`docs/backlog.md`](docs/backlog.md) |
| Spécifications fonctionnelles | `docs/spec-*.md` (24 documents) |
| Index de code généré | `docs/ai/code-map-actions.md` (backend), `docs/ai/code-map-components.md` (frontend), `docs/ai/module-graph.json` |
| Règles de sécurité | `firestore.rules`, `storage.rules` |
| Tables métier de référence | `kpi-tables.md`, `phenology-tables.md`, `phyto-taxonomy.md` |

> **Avant de chercher dans le code**, lire `docs/ai/code-map-actions.md`
> (backend) ou `docs/ai/code-map-components.md` (frontend) : ce sont des index
> générés qui pointent directement au bon endroit.
