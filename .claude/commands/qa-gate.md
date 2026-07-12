---
description: Lancer la gate QA locale unifiée Smart Berry et interpréter le résultat
---

Lance la gate QA locale unifiée et rapporte le résultat.

## Étapes

1. Lancer `npm run qa` depuis la racine du repo (ou du worktree courant).
   La gate enchaîne, dans l'ordre, en échouant au premier problème :
   1. `npm run test:unit` — tests unitaires frontend (`tests/unit/`)
   2. `npm run test:all` (dans `functions/`) — TOUS les modules `lib/*/__tests__`
   3. `npm run build:frontend` — Babel + sentinelles + cache-bust

2. Interpréter les échecs :
   - **Échec étape 1 ou 2** : lire le nom du test en échec, corriger le code ou le test selon la cause réelle (ne jamais skipper un test pour « faire passer »).
   - **Échec étape 3, exit 1** : erreur Babel — syntaxe JSX invalide.
   - **Échec étape 3, exit 2** : sentinelle manquante dans `app.js` ou un composant — build tronqué ou export global (`window.X`) retiré. Vérifier `scripts/build-frontend.js` (listes de sentinelles) si un composant a été ajouté/renommé.
   - **Échec étape 3, exit 3** : `index.html` ne référence plus `app.js`.

3. Vérifier le diff post-gate : `git status` — le seul diff attendu produit par la gate est le cache-bust `?v=…` de `public/index.html` (et `public/app.js`/`public/components/*.js` régénérés à l'identique si rien n'a changé). Tout autre diff inattendu doit être investigué.

4. Optionnel, informatif : `npm run typecheck` — non bloquant (erreurs historiques connues) ; signaler uniquement les NOUVELLES erreurs introduites par les changements en cours.

5. Rapporter : totaux de tests (frontend + backend), statut build, et le verdict — la gate doit être 100 % verte avant tout merge (cf. CLAUDE.md § Workflow agent).
