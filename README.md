# Smart BERRY — Berry Good Farms Dashboard

Application de gestion agricole (RH, paie, récolte, qualité, achats, magasin,
finance, agronomie) pour Berry Good Farms. SPA React servie par Firebase
Hosting, backend Cloud Functions, données Firestore.

> **Ce dépôt contient DEUX frontends qui rendent la même interface.** Comprendre
> pourquoi est le préalable à tout le reste — voir [Les deux frontends](#les-deux-frontends).

---

## Démarrage rapide

```bash
# Node 20 requis (functions/package.json → engines). Node 22+ fonctionne pour
# le développement, mais les Cloud Functions tournent sur Node 20 en production.
npm ci
npm ci --prefix functions

npm run build      # construit les deux frontends
npm run qa         # la gate complète : 8 étapes, ~3 min
```

Pour servir l'application en local sans backend ni compte :

```bash
npx http-server public -p 8088
# puis ouvrir http://localhost:8088/?testui=1
```

`?testui=1` active `public/lib/local-test-bypass.js` : authentification simulée
et routes `/api/*` interceptées par des réponses factices. **Actif uniquement
sur `localhost` / `127.0.0.1`** — aucun effet en production, aucune écriture
dans la base réelle.

---

## Les deux frontends

L'application existe en deux exemplaires qui affichent exactement la même
interface. C'est délibéré et temporaire : c'est le mécanisme de bascule de la
migration.

| | Fichier servi | Nature |
|---|---|---|
| **Modulaire** *(défaut)* | `public/app.modular.js` + `public/chunks/*` | 357 modules ES, construits par Vite depuis `src/modules/` |
| **Monolithe** *(repli)* | `public/app.js` | build Babel de `public/app.jsx`, 69 800 lignes |

`public/index.html` choisit lequel charger **au démarrage**, selon le drapeau
`MODULAR_FRONTEND` (`public/lib/featureFlags.js`). Ordre de décision :

1. `?modular=1` / `?modular=0` dans l'URL — l'échappatoire manuelle, gagne toujours ;
2. un boot modulaire précédent qui n'a jamais abouti → repli automatique ;
3. la dernière valeur lue depuis Firestore `app_settings/feature_flags` ;
4. défaut : **le modulaire**.

### Le garde-fou de boot

Un drapeau distant ne protège de rien si le bundle plante *avant* d'avoir pu le
relire : l'utilisateur boucle alors sur une application morte, hors d'atteinte
de toute bascule serveur. Le boot est donc marqué « en cours » dans
`localStorage` **avant** d'être tenté, et effacé seulement quand l'interface
s'est rendue (disparition de `#splash-screen`). Un marqueur encore présent au
chargement suivant vaut constat d'échec → repli sur le monolithe, sans réseau.

Ce repli **persiste** (`sb_flag_modular_frontend = '0'`) : sans cela le défaut
modulaire reprendrait la main au rechargement et l'utilisateur alternerait
indéfiniment entre une application morte et le monolithe.

### En cas de problème en production

```
https://…/?modular=0      → force le monolithe, mémorisé pour les navigations suivantes
https://…/legacy.html     → le monolithe, sur le déploiement Vercel
```

Pour basculer **tout le parc** : modifier `app_settings/feature_flags`
(`MODULAR_FRONTEND: false`) dans Firestore. Appliqué au chargement **suivant** de
chaque poste — jamais sous les pieds d'un utilisateur en session.

---

## Architecture

### Frontend — trois emplacements de code

C'est le point le plus contre-intuitif du dépôt.

| Emplacement | Fichiers | Lignes | Forme | Chargé quand ? |
|---|---|---|---|---|
| `src/modules/` | 357 | 73 139 | modules ES (`import`/`export`) | c'est l'application |
| `public/components/` | 33 | 21 109 | scripts classiques, `window.X` | 19 au boot, 14 à la demande |
| `public/lib/` | 47 | 14 240 | UMD (`window.X` + `module.exports`) | au boot |
| `public/app.jsx` | 1 | 69 800 | monolithe | seulement en mode repli |

`src/modules/` est organisé en 12 modules métier : `achats`, `admin`,
`agronomie`, `caisse`, `finance`, `magasin`, `qualite`, `recolte`, `rh`,
`securite`, `shared`, `technique`.

**Pourquoi `public/lib` et `public/components` existent encore :** ce sont des
scripts classiques qui partagent le scope global du navigateur. 80 fichiers de
`src/modules` les lisent encore via `window.PaieUtils`, `window.CaisseUtils`…
Les convertir en modules ES est le dernier gros chantier de la migration
(voir [Reste à faire](#reste-à-faire)).

### Chargement différé

Les 132 onglets (121 dans `src/modules`, 11 dans `public/components`) sont
chargés à la demande, pas au démarrage :

- **onglets modulaires** → `React.lazy` + `Suspense`, un chunk Vite chacun ;
- **onglets legacy** (`public/components/*Tab.js`) → `lazyGlobalComponent`
  (`src/modules/shared/lazyGlobalComponent.jsx`) injecte la balise `<script>` au
  premier rendu.

Dans `renderTab` (`src/modules/shared/AuthenticatedApp.jsx`), la frontière
d'erreur **enveloppe** le `Suspense`, pas l'inverse : un chunk qui échoue à se
charger rejette pendant le rendu, et c'est l'`ErrorBoundary` qui doit l'attraper
— sinon l'onglet resterait bloqué sur « Chargement du module… » indéfiniment.

Charge initiale actuelle : **1 273 Ko** (entrée 270 Ko + 1 004 Ko de scripts
legacy), contre 4 718 Ko avant le découpage.

### Backend

`functions/index.js` est un **barrel de 34 lignes** qui ré-exporte 105 Cloud
Functions depuis 9 modules métier (`functions/src/modules/`) et 44 domaines
(`functions/lib/`). Aucun fichier backend ne dépasse 2 000 lignes.

> ⚠️ **Une Cloud Function est adressée par son nom d'export.** Le renommer
> supprime l'ancienne fonction et en crée une neuve : URL HTTP changée,
> déclencheur Firestore détaché, cron perdu, clients en vol cassés. Les 105 noms
> sont **figés** et verrouillés par `tests/unit/backendExportSurface.test.js`.

54 routes `/api/*` sont mappées dans `firebase.json` vers ces functions, région
`europe-west1`. Les 51 autres exports sont des déclencheurs Firestore, crons et
pub/sub sans route HTTP.

### Firebase

| | |
|---|---|
| Projet | `berrygood-farms-dashboard` |
| Région | `europe-west1` |
| Auth | e-mail/mot de passe + Google (popup) |
| Bucket Storage | `berrygood-farms-photos` *(pas le bucket par défaut — cf. `.firebaserc`)* |
| SDK | **compat**, chargé par CDN dans `index.html` (pas de bundler côté auth) |

Le SDK est initialisé en clair dans `public/index.html`. La `apiKey` d'une
application web Firebase est publique par conception : la sécurité repose sur
`firestore.rules` et `storage.rules`, pas sur le secret de cette clé.

---

## Commandes

### Construire

| Commande | Effet |
|---|---|
| `npm run build` | les deux frontends (Babel + Vite + publication des chunks) |
| `npm run build:frontend` | `public/app.jsx` → `public/app.js`, sentinelles, cache-bust |
| `npm run migrate:build` | `src/modules/` → `dist-migrated/` (Vite) |
| `npm run migrate:publish` | copie le bundle et les 133 chunks dans `public/` |
| `npm run build:vercel` | assemble `dist-vercel/` (site statique déployable) |

> Le build réécrit le cache-bust `?v=…` de `public/index.html`. **Un diff
> `?v=…` seul après un build est un artefact — ne pas le committer.**

### Vérifier

| Commande | Effet |
|---|---|
| **`npm run qa`** | **la gate — à lancer avant tout commit** |
| `npm run test:unit` | 187 fichiers de test frontend (`node:test`) |
| `npm run test:all --prefix functions` | 109 fichiers de test backend |
| `npm run lint` | analyse syntaxique de tous les fichiers suivis |
| `npm run typecheck` | `tsc` sur les fichiers annotés `// @ts-check` |
| `npm run migrate:verify` | toute référence libre de `src/modules` se résout |
| `npm run smoke:boot` | sélecteur d'entrée, dans un vrai navigateur |
| `npm run migrate:parity` | **compare les deux frontends écran par écran** |

`npm run qa` enchaîne 8 étapes : tests frontend → tests backend → build →
5 contrôles de fraîcheur des artefacts générés (`docs/ai/*`). Elle échoue à la
première anomalie.

> **Definition of done :** si un ticket touche `functions/` ou `public/app.jsx`,
> lancer `npm run code-index` et committer les `docs/ai/*` régénérés — sinon la
> gate échoue sur l'obsolescence des empreintes.

### La preuve de non-régression

`npm run migrate:parity` pilote les **deux** frontends dans un vrai navigateur
(Chromium), parcourt 20 profils × 350 rendus d'onglet de chaque côté, et compare
population d'onglets, plantages et volume de rendu. Durée : ~35 min.

C'est ce qui a remplacé la comparaison octet-pour-octet avec le monolithe, trop
rigide pour laisser le tree modulaire évoluer. **À lancer après tout changement
structurel.** Un écart est un échec ; les écrans où le monolithe plante et le
modulaire rend sont listés à part comme améliorations.

---

## Déploiement

### Règle absolue

**Tout déploiement part de `main`**, jamais d'une branche. `scripts/deploy.sh`
refuse si l'arbre de travail est sale, si la branche n'est pas `main`, ou si
`main` n'est pas à jour avec son remote.

### Frontend (Firebase Hosting)

```bash
scripts/preview.sh --post-merge   # canal de préversion, validation visuelle
scripts/deploy.sh hosting         # production, après validation
```

`firebase.json` sert `public/` avec `npm run build:frontend` en `predeploy`.

### Backend (Cloud Functions)

```bash
scripts/deploy.sh functions --dry-run   # simulation
scripts/deploy.sh functions             # déclenche le CI
```

**Asynchrone** : la commande déclenche un run GitHub Actions
(`deploy-prod.yml`) et rend la main immédiatement. Le nouveau backend n'est
*pas* live quand le script se termine — suivre avec
`gh run watch`. Lancer les smokes trop tôt teste l'ancienne version.

L'authentification passe par Workload Identity Federation : aucune clé de
service account, aucun token, ni en local ni sur le VPS.

> ⚠️ **Le provider WIF est verrouillé sur `omaaouni/BERRYGOOD`**
> (`attribute-condition`, cf. `docs/deploy-wif-prod.md`). Un déploiement des
> functions depuis ce dépôt échouera : GCP n'émettra pas de jeton. Pour y
> remédier, il faut ajouter ce dépôt à la condition du provider et poser
> `WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT` en variables de dépôt, avec un
> environment `production`.

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

## Notifications WhatsApp

Envoyées **par le backend**, jamais par le frontend. Trois conditions doivent
être réunies, et le code les échoue silencieusement :

1. **Destinataire** — `resolveRecipientsForProfile` (`functions/whatsappService.js`)
   ne retient un utilisateur que si `profileId` correspond, `whatsappEnabled ===
   true` **et** `whatsappPhone` est renseigné en E.164 (`+2126…`). Un champ
   manquant → zéro destinataire, aucune erreur.
2. **Config** — document Firestore `config/whatsapp` : `enabled`,
   `phone_number_id`, `access_token`. Un token Meta temporaire expire en 24 h ;
   seul un token System User est permanent.
3. **Template Meta** — approuvé, langue `fr`, nombre de paramètres exact.
   Ex. `bdc_validation_needed_v2` (4 params) et `bdc_validation_needed_doc`
   (idem + en-tête document PDF).

**Diagnostic :** chaque tentative est journalisée dans la collection Firestore
`whatsapp_logs` (`templateName`, `status`, `error`). Aucune entrée = zéro
destinataire résolu. Codes Meta utiles : `132001` template introuvable ou non
approuvé, `132007` rejeté, `132012`/`132018` paramètres non conformes, `131008`
paramètre invalide (saut de ligne ou 4 espaces consécutifs).

**Tester sans déployer :** `POST /api/whatsapp-admin?action=test-message`
(`{phone}`) ou `action=simulate-template` (`{template_name, phone, params}`).

---

## Conventions

- **CommonJS** côté backend et `public/lib`. **Modules ES** dans `src/modules`.
- Composants React **fonctionnels** uniquement, CSS inline via `style={{…}}`,
  variables CSS `var(--berry)` définies dans `index.html`. Pas de Tailwind ni
  de librairie de composants.
- Tests en **`node:test`** natif. Pas de Jest, pas de Vitest, pas de RTL.
- `public/lib/*.js` : JSDoc strict avec `// @ts-check`.
- Champs Firestore en `snake_case` ASCII. Ne jamais renommer un champ existant
  (`caisse_id`, `status`…) : toute la stack les consomme.
- Statuts caisse : `brouillon | soumis | a_revoir | valide | rejete` — les
  libellés capitalisés sont un affichage, pas la valeur stockée.

### Scripts classiques et scope global

Les fichiers de `public/lib` et `public/components` s'exécutent dans le scope
global du navigateur. **Tout est enveloppé dans une IIFE, aucun identifiant
top-level ne fuit** : un nom dupliqué entre deux fichiers casse le boot React
(erreur #200, incidents #75/#77). Un seul global exposé par fichier.

---

## Reste à faire

| Objectif du plan client v1.1 | Cible | État |
|---|---|---|
| Nombre de modules | 11+ | ✅ 12 |
| Non-régression des écrans | 100 % | ✅ 0 écart |
| Dual mode, repli < 1 min | oui | ✅ |
| Code splitting | par module | ✅ 133 chunks |
| Lignes max par fichier | < 2 000 | ✅ (`src/modules`) |
| CI lint → typage → tests → build | complète | ✅ |
| TypeScript | JSDoc → `.tsx` → strict | ⚠️ étape 1/3 |
| Tests E2E, parcours métier | 5–10 | ⚠️ `tests/e2e-visual.js` non câblé en CI |
| Taille du fichier principal | < 200 Ko | ❌ 270 Ko |
| Chargement initial | < 500 Ko | ❌ 1 273 Ko |
| Structure `pages/`/`components/`/`hooks/` | par taille | ❌ 0 / 12 |
| Couverture de composants | > 60 % | ❌ ni Vitest ni RTL |
| Lighthouse | > 90 | ❌ non mesuré |
| Monitoring Sentry | actif | ❌ absent |
| Ancien code supprimé | oui | ❌ volontaire (filet de repli) |

**Le chantier suivant, et le plus lourd :** convertir `public/lib` (47 fichiers)
et `public/components` (33 fichiers) en modules ES, et recâbler les 80 fichiers
de `src/modules` qui les lisent via `window.*`. C'est le préalable aux deux
cibles de poids restantes. L'interopérabilité CommonJS de Vite a été vérifiée
sur ces fichiers — elle fonctionne — mais seules 18 bibliothèques peuvent partir
avant que les composants ne soient convertis, les 24 autres étant lues par ces
mêmes composants.

**`public/app.jsx` ne sera supprimé qu'en dernier**, après validation en
production : il est à la fois le filet de repli du sélecteur et la référence de
`migrate:parity`.

---

## Où trouver quoi

| | |
|---|---|
| Guide agent / conventions détaillées | [`CLAUDE.md`](CLAUDE.md) |
| Rapport de migration | [`MIGRATION_REPORT.md`](MIGRATION_REPORT.md) |
| Architecture cible | [`ARCHITECTURE_v2.md`](ARCHITECTURE_v2.md), [`ARCHITECTURE_BACKEND.md`](ARCHITECTURE_BACKEND.md) |
| Runbook déploiement WIF | [`docs/deploy-wif-prod.md`](docs/deploy-wif-prod.md) |
| Index de code généré | `docs/ai/code-map-*.md`, `docs/ai/module-graph.json` |
| Backlog | [`docs/backlog.md`](docs/backlog.md) |
| Règles Firestore / Storage | `firestore.rules`, `storage.rules` |
| Rapports de parité upstream | `sync-report/` |
