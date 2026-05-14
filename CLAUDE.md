# CLAUDE.md — Guide d'agent pour BerryGood / Smart BERRY

> Ce fichier sert de mémoire de projet pour les agents (Claude) qui interviennent sur ce repo. Les conventions ci-dessous priment sur ce que le LLM "pense" être standard ailleurs.

---

## Scope actif

**Sprint 2 — Contrôle & actions groupées 🚧** sur l'écran Gestion de Caisse > Transactions. Suit le Sprint 1 (ergonomie) déjà mergé. Voir [ROADMAP.md](ROADMAP.md) pour l'historique et la suite.

---

## Architecture en bref

### Frontend
- **Monolithe `public/app.jsx`** (~53 k lignes), React via CDN dans `public/index.html` (pas d'imports ES, pas de bundler).
- Build : `@babel/preset-react` direct → `public/app.js`. Script : `npm run build:frontend` (scripts/build-frontend.js — vérifie des sentinelles + cache-bust HTML).
- **Pas de TypeScript.** JSDoc strict (`// @ts-check`) attendu pour les modules dans `public/lib/`.
- État global : aucun framework (Redux/Zustand/Context formel). `useState` locaux + props héritées du root.
- Helpers caisse purs : `public/lib/caisseUtils.js` — exposé en `window.CaisseUtils` ET `module.exports` (UMD bricolé). Source de vérité pour la détection d'anomalies, recherche, totaux, filtres rapides.

### Backend
- **Cloud Functions** dans `functions/index.js` (monolithe ~12 k lignes) — voir [TODO_REFACTO.md](TODO_REFACTO.md) §2.
- Firebase project : `berrygood-farms-dashboard`. Région : `europe-west1`. Runtime Node 20 CommonJS.
- Firestore : règles `firestore.rules` — la plupart des collections sont read-only client, writes via Cloud Functions uniquement (cf. `caisse_transactions`, `caisse_definitions`, `stock_movements`, …).
- API : routes `/api/<service>` mappées dans `firebase.json` vers des `exports.<serviceName>`.
- Module propre = `functions/lib/irrigation/` (pure functions + DI + `node:test`). Pattern à dupliquer pour les futurs domaines.

### Tests
- **`node:test` natif** (Node 20+). Pas de Jest, pas de Vitest.
- Tests unitaires : `tests/unit/*.test.js` — script `npm run test:unit`.
- Tests d'intégration HTTP : `tests/test-workflows.js`, `tests/test-chef-bdc-bot.js`.
- Smokes Playwright : `tests/smoke-test.js` (prod), `tests/smoke-sprint-1.js` (local public/ sans auth).
- Tests fonctionnels de modules backend : `functions/lib/irrigation/__tests__/*.test.js` (Node natif).
- **Pas de RTL** : impossibles sans bundler. Limitation documentée, à lever dans le Sprint 0 de refonte.

---

## Conventions de code

### JavaScript
- CommonJS partout (`require` / `module.exports`). Pas d'ESM.
- Strings : `'simple quotes'`. Templates uniquement pour interpolation.
- Pas de point-virgule final sur la ligne d'export (cf. style backend existant) — mais `'use strict'` en tête des fichiers `lib/`.
- Pas d'optional chaining inutile (`a && a.b` reste OK).
- Pour les nouveaux modules dans `lib/` : JSDoc strict + `// @ts-check`.

### React (dans `app.jsx`)
- Composants fonctionnels uniquement (pas de class).
- Hooks via `React.useState` ou destructuration en tête de fichier (`const { useState, useEffect, useMemo } = React`).
- Inline CSS via `style={{…}}`. Variables CSS via `var(--berry)` etc. (définies dans `index.html`).
- Pas de Tailwind, Chakra, MUI.

### Firestore — noms de champs (caisse_transactions)
Snake_case ASCII partout :
- `caisse_id`, `reference`, `code_analytique`, `status`, `montant`, `date`, `description`, `fournisseur`
- `saisie_by`, `soumis_par`, `valide_par`, `rejete_par` — **objets `{uid, profileId, name, email}`**, pas des string userId
- `created_at`, `updated_at`, `soumis_at`, `valide_at` — `serverTimestamp()`
- `history: Array<{action, by, at, …}>`
- Statuts : `brouillon | soumis | a_revoir | valide | rejete` — libellés UI capitalisés (`Brouillon | Saisi | À revoir | Validé | Rejeté`) via `STATUS_LABELS` dans `app.jsx`

### Cloud Function caisse — actions
Pattern d'action sur `/api/caisse?action=<name>` (POST/GET selon) :
- Auth Firebase requise (sauf actions admin-secret comme `bulk-import-transactions`)
- Rôles : `achats` (saisie), `dg | finance` (contrôle)
- Toujours retourner `{success: bool, …}` ou `{success: false, error: string}`
- Mutations atomiques via `db.runTransaction()` pour les actions affectant les soldes
- Batch writes : chunks de 400 (Firestore limit = 500/batch, marge de 100)

---

## Workflow agent

1. **Avant de coder** :
   - Lire ce fichier
   - Lire le `Scope actif`
   - Vérifier la branche : pas de commit direct sur `main`, toujours feature branch
   - Annoncer un plan en début de session (mode "plan" si tâche non triviale)

2. **Pendant** :
   - Commits atomiques 1 feature = 1 commit minimum
   - Push après chaque commit (le user veut suivre push par push)
   - Tests unitaires sur les helpers purs obligatoires (cf. `caisseUtils.test.js`)

3. **Avant merge** :
   - `npm run test:unit` doit être vert
   - `npm run build:frontend` doit passer (sentinelles)
   - PR draft via `gh pr create --draft` avec body structuré (résumé, features, critères, limitations, commits)

---

## Choses à NE PAS faire

- Toucher au backend (Cloud Functions) sans nécessité explicite du sprint.
- Ouvrir les Firestore rules en écriture client-side. Tout passe par Cloud Functions.
- Renommer les champs Firestore existants (`caisse_id`, `status`, etc.) — ils sont consommés par toute la stack.
- Renommer `soumis` en `saisi` côté DB — c'est un alias UI uniquement. Le workflow `submit-transaction` / `validate-transaction` dépend du code `soumis`.
- Réécrire `caisseUtils.js` Sprint 1 — extend only.
- Skipper hooks (`--no-verify`) ou signing (`--no-gpg-sign`).
- Commit direct sur `main` sauf fichiers de gouvernance (CLAUDE.md, ROADMAP.md, TODO_REFACTO.md).

---

## Pointeurs utiles

- Routes API : [firebase.json](firebase.json) (`rewrites`)
- Règles : [firestore.rules](firestore.rules)
- Build front : [scripts/build-frontend.js](scripts/build-frontend.js)
- Dette technique : [TODO_REFACTO.md](TODO_REFACTO.md)
- Roadmap sprints : [ROADMAP.md](ROADMAP.md)
- Composant caisse principal : `public/app.jsx` — chercher `function CaisseTransactionsSub` (≈ ligne 50 800).
- Cloud Function caisse : `functions/index.js` — chercher `exports.caisseManagement` (≈ ligne 11 100).
