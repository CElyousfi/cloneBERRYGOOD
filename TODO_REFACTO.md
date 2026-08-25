# TODO Refacto — Dette technique trackée

Ce fichier liste les chantiers de refacto identifiés. Mis à jour à chaque sprint qui révèle un nouveau hotspot. Chaque entrée précise : ce qui pose problème, l'impact, et la piste de solution prévue.

---

## 🔴 Critique — blocage architectural

### 1. Monolithe `public/app.jsx` (≈53 250 lignes)

**État** : SPA React entière dans un seul fichier JSX, compilé en `public/app.js` (~3,4 Mo) via `@babel/preset-react` sans bundler. Aucune scission en modules ES, aucun import nommé. Tous les composants, hooks, helpers et constantes vivent côte à côte dans un IIFE géant.

**Impacts** :
- Aucun test unitaire de composant possible (rien à importer)
- Tout helper réutilisable doit être extrait dans un fichier séparé (`public/lib/*.js`) avec un format UMD bricolé pour fonctionner à la fois en navigateur et en `node:test`
- Recherche / navigation dans le fichier coûteuse (le « cherche-remplace » devient le seul outil)
- Tout changement dans `app.jsx` produit un diff énorme dans les PR
- Le cache du navigateur est invalidé en bloc dès qu'on touche une ligne
- Hot reload impossible
- Risque de régression élevé : on ne sait jamais quel composant on casse en touchant un autre

**Solution prévue** : **Sprint 0 (Refonte build & scission monolithe)**. Tâches :
1. Introduire Vite (ou esbuild) comme bundler frontend
2. Découper `app.jsx` en modules par domaine fonctionnel (`src/modules/agronomie/`, `src/modules/caisse/`, `src/modules/rh/`, …) en respectant les frontières entre profils utilisateurs
3. Migrer la conf Babel actuelle vers le bundler
4. Ajouter un setup React Testing Library + Vitest pour les tests de composants
5. Migration progressive : extraire un module à la fois, en gardant l'ancien path fonctionnel jusqu'à parité confirmée
6. Cible : aucun fichier > 2 000 lignes après refonte

**Coût estimé** : 3-4 sprints. Non bloquant pour Sprint 1-5 mais devient incontournable au Sprint 6+ si on veut tester proprement les nouvelles features.

---

### 2. Monolithe `functions/index.js` (≈12 000 lignes)

**État** : 48+ exports de Cloud Functions HTTP / cron / triggers dans un seul fichier. Mix de logique métier, accès Firestore, parsing Excel, dispatch d'actions, etc.

**Impacts** :
- Idem app.jsx côté backend, en pire car déployé tel quel sur Firebase Functions
- Cold start gonflé inutilement (toutes les fonctions partagent le même bundle)
- Couplage caché entre fonctions via constantes top-level
- Tests d'intégration uniquement (cf. `tests/test-workflows.js`), aucun unitaire en place sauf pour `functions/lib/irrigation/`

**Solution prévue** :
- Suivre le pattern déjà éprouvé de `functions/lib/irrigation/` (pure functions + DI + `node:test` + barrel `index.js`)
- Extraire un domaine par sprint : `lib/caisse/`, `lib/budget/`, `lib/quality/`, `lib/pointage/`, etc.
- Chaque action HTTP de `index.js` devient un mince orchestrateur qui délègue à `lib/<domain>/`
- Cible : `functions/index.js` < 1 500 lignes (juste de l'orchestration)

**Coût estimé** : 4-5 sprints en parallèle de Sprint 0.

---

## 🟡 Important — à planifier

### 3. `CaisseTransactionsSub` (composant Sprint 1)

**État** : composant inline dans `app.jsx:50784-50961`, mélange logique métier + rendering + état local + récupération réseau. Sprint 1 ajoute filtres avancés, totaux, recherche, détection anomalies — la complexité grossit.

**Pourquoi ici et pas critique** : tant que Sprint 0 (build moderne) n'est pas livré, on ne peut de toute façon pas extraire le composant proprement. Sprint 1 a extrait la **logique pure** dans `public/lib/caisseUtils.js` (testable, swappable). Le composant lui-même reste inline en attendant Sprint 0.

**Solution prévue** :
- Une fois Sprint 0 livré : extraire `<CaisseTransactions />` dans `src/modules/caisse/pages/CaisseTransactions.jsx`
- Découper ses sous-éléments : `<FilterChips>`, `<SearchBar>`, `<TableFooterTotals>`, `<AnomalyBadge>` (cf. spec Sprint 1 originale, abandonnée pour cause de monolithe)
- Couvrir avec React Testing Library

---

### 4. Absence de typage

**État** : JS pur partout, pas de TypeScript, pas de JSDoc strict (sauf dans `functions/lib/irrigation/` et désormais `public/lib/caisseUtils.js`). Les contrats entre composants reposent sur la mémoire des devs.

**Solution prévue** :
- Étape intermédiaire avant TS complet : forcer JSDoc strict sur tous les helpers extraits dans `lib/`
- Activer `// @ts-check` dans les nouveaux fichiers
- Sprint 0 décidera entre rester en JSDoc strict ou bascule TS complète

---

### 5. Harnais de test des composants : états adressés par INDEX POSITIONNEL

**État** : faute de React Testing Library (impossible sans bundler, cf. §1), les tests de composants stubent `React.useState` et adressent chaque état par son **rang d'appel** — `load([undefined, queue, 0, true, false, 0, {done,total}])` dans `tests/unit/magBCScanModal.test.js`, `tests/unit/affectationAnalytiqueTable.test.js`, etc.

**Risque (une phrase)** : insérer ou réordonner un `useState` décale silencieusement tous les suivants, si bien que les tests **continuent de passer en vérifiant le mauvais état** — un vert mensonger, pire qu'un échec, puisque rien ne signale la dérive.

**Contournement actuel** : commentaire « ce `useState` est volontairement le DERNIER » dans `MagBCScanModal.jsx`. Discipline humaine, pas un garde-fou.

**Solution prévue** : après Sprint 0 / migration Vite, remplacer le stub positionnel par RTL (`render` + interactions réelles). Palliatif possible avant : stub `useState` acceptant une **clé nommée** (via un `useState` enveloppé maison ou l'ordre déclaré explicitement dans un manifeste vérifié par un test).

---

### 6. Stubs de réponse HTTP incomplets dans les tests front

**État** : les tests fabriquent des objets « Response » minimalistes. Exemple : `scan429()` dans `tests/unit/magBCScanModal.test.js` renvoie `{ status: 429, headers }` **sans méthode `json()`**, parce que le code sous test n'appelle pas `json()` sur un statut transitoire.

**Risque (une phrase)** : ces stubs ne modélisent pas assez fidèlement un `Response` pour **tuer les mutations qu'ils devraient tuer** — un code muté qui lirait le corps avant de classer le statut planterait sur un `TypeError` au lieu d'être correctement diagnostiqué, et un stub trop pauvre peut laisser passer une régression de classification.

**Solution prévue** : une fabrique partagée `fakeResponse({ status, headers, body })` exposant toujours `status`, `ok`, `headers.get()`, `json()` et `text()`, réutilisée par tous les tests front qui stubent `fetch`.

---

## 🟢 Améliorations long terme

- **Lint / format** : aucun `.eslintrc` ni `.prettierrc` à la racine. À ajouter dès Sprint 0.
- **CI** : pas de GitHub Actions visibles sur les tests. À ajouter dès qu'on a un test suite significative.
- **Code coverage** : non mesurée. Pertinent une fois Sprint 0 + tests de composants en place.
- **Dépendances** : peu de packages racine, ce qui simplifie. Veiller à ne pas ajouter de dépendances « lourdes » avant Sprint 0 (chaque ajout doit aujourd'hui être chargé via CDN dans `index.html`).

---

*Dernière mise à jour : Sprint 1 — création du fichier, première entrée 🔴 sur le monolithe `app.jsx`.*
