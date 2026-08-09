# CLAUDE.md — Guide d'agent pour BerryGood / Smart BERRY

> Ce fichier sert de mémoire de projet pour les agents (Claude) qui interviennent sur ce repo. Les conventions ci-dessous priment sur ce que le LLM "pense" être standard ailleurs.

---

## ⛔ RÈGLES ANTI-DIVERGENCE (NON NÉGOCIABLES)

> Problème récurrent : du code tourne en prod mais n'est pas dans le repo (chef-bahia, edits locaux VPS, worktrees pas mergés). Résultat : features qui disparaissent + code fantôme. Ces 3 règles priment sur toute autre considération de workflow.

**RÈGLE 1 — `main` = prod. Toujours.**
- Tout code en production DOIT être sur `main`.
- Aucun deploy depuis une feature branch ou un worktree. On déploie le code de `main`.
- Aucune édition directe sur un serveur de prod (VPS, console Firebase, working tree non committé).
- Fix urgent = `commit → push main → deploy`. Pas de raccourci, même pour un hotfix.

**RÈGLE 2 — Commit avant de changer de contexte.**
- Avant de passer à un autre item/sprint : `commit + push + merge dans main`. Aucun WIP qui traîne dans un worktree ou sur un VPS.
- Avant CHAQUE deploy, vérifier : `git status` propre (rien de non committé) ET branche = `main` ET `main` à jour avec le remote.
- Le script de deploy DOIT vérifier automatiquement (a) working tree propre, (b) branche = `main`, (c) `main` à jour avec le remote. Si une condition échoue → le deploy s'arrête avec un message d'erreur explicite.

**RÈGLE 3 — Pas de code untracked en production.**
- Chaque fichier qui tourne en prod DOIT être dans le repo (tracké + committé sur `main`).
- Interdit de créer un fichier sur le serveur sans le committer.
- Le `docker-compose` (Sentinel) doit builder depuis un `git clone` propre, pas depuis un dossier avec des modifications locales. Côté Smart Berry : le build de prod part d'un checkout `main` propre, jamais d'un working tree avec du WIP.

**IMPLÉMENTATION :**
- **Smart Berry** : checks (a)(b)(c) de la RÈGLE 2 dans `scripts/deploy.sh` (bloque le deploy si tree sale / branche ≠ main / main en retard sur remote `BERRYGOOD`).
- **Sentinel** (`bgf-sentinel`) : GitHub Actions auto-deploy sur push `main` + script pre-deploy avec les 3 vérifications.
- **Les deux** : ces règles dans la section contraintes de leur `CLAUDE.md`.

> **Rétroactif** : réconcilier tout code divergent (VPS Sentinel + worktrees/chef-bahia Smart Berry) dans `main` AVANT tout nouveau développement. Ces règles s'appliquent aux DEUX projets. Toute exception = validée explicitement par Omar et tracée.

---

## Discipline outils & permissions (réduire les prompts)

Politique complète : [docs/ai/PERMISSIONS.md](docs/ai/PERMISSIONS.md). Résumé :
allow = lectures, dev courant (add/commit), gates QA ; ask = écritures
sensibles (push, merge, rm/mv, deploy, gcloud, dépendances) ; deny =
irréversible (push --force[-with-lease], reset --hard, clean -fdx, rm -rf hors
projet, sudo, `firebase deploy` brut, `--project production`, lecture de
`.env`/secrets). Pour ne pas déclencher de confirmations inutiles :

1. **Exploration = outils natifs** : utiliser Read / Grep / Glob, PAS `grep`,
   `cat`, `find`, `sed -n`, `head`, `tail` via Bash. Les outils natifs ne sont
   pas gatés ; les équivalents Bash ne sont volontairement pas allowlistés.
2. **Pas de `cd` préfixé** : ne pas écrire `cd "$CLAUDE_PROJECT_DIR" && cmd`
   quand le working directory est déjà le repo — le segment `cd` force un
   prompt sur toute la commande composée. Utiliser des chemins relatifs
   (autre repo/worktree : `git -C <chemin>`).
3. **Commandes simples** : découper les chaînes `a && b && c` en appels
   séparés compatibles avec l'allowlist (chaque segment est évalué seul).
4. Les scripts one-off d'analyse vont dans `/tmp` (déjà en
   additionalDirectories), pas dans le repo.

**Bash Discipline Gate** (hook PreToolUse) : `scripts/bash-discipline-gate.js` — bloque
grep/rg/cat/find/ls/head/tail/wc/sed-n/cd-chain/pipes vers grep-head-tail. Périmètre V1.

**Garde-fous commit** (`git add`/`git commit` sont en allow) — avant CHAQUE commit :
- `git branch --show-current` : bonne branche (jamais `main` sauf gouvernance) ;
- `git status` : état complet du working tree ;
- staging **ciblé** (fichiers nommés) — jamais `git add .` ni `git add -A` par défaut ;
- relire `git diff --cached` ;
- vérifier qu'aucun secret n'est stagé (`.env`, tokens, credentials).

---

## Règles de compatibilité Vite (A1 — Pipeline IA Phase 1)

> S'appliquent à TOUT nouveau code et TOUTE extraction depuis `public/app.jsx`.
> **Aucune extraction du monolithe n'est faite en Phase 1** (contrainte de
> périmètre explicite) — ces règles posent la convention à l'avance pour ne
> pas diverger le jour où l'extraction démarre. `src/` n'existe pas encore.

- **ESM uniquement** : `import`/`export` explicites, jamais `require`, jamais
  de globale implicite (`window.X = ...`) sauf couche de compatibilité UMD
  documentée (comme `public/lib/caisseUtils.js` aujourd'hui).
- **Aucun import à effet de bord** : un import ne doit rien exécuter, seulement
  exposer.
- **Un point d'entrée `index.js` par feature**, exportant l'API publique du
  module.
- **Alias de chemins** déclarés dès maintenant dans `jsconfig.json` :
  `@features/*`, `@shared/*`, `@app/*` — identiques à la future config Vite.
- **Structure cible** pour toute extraction future :
  `src/features/<domaine>/{components,api,hooks,tests,index.js}` et
  `src/shared/{components,hooks,api,utils}`.

---

## Autonomie de l'agent — ce qui nécessite validation Omar

Vocabulaire (brief Pipeline IA Phase 1, A2) : **autonome** = jamais de demande
d'autorisation ; **approbation humaine obligatoire** = STOP, attendre le GO
explicite d'Omar. Correspond exactement aux deux catégories ci-dessous.

### ✅ AUTONOME — exécuter sans demander

**Exploration lecture seule** (jamais interrompre Omar) :
- `grep`, `rg`, `find`, `fd`, `ls`, `tree`, `cat`, `head`, `tail`, `sed`, `awk`, `jq`
- `git status`, `git diff`, `git log`, `git show`
- `npm list`, lecture de fichiers, inspection de code

**Développement courant** :
- Écrire / éditer du code, créer des fichiers
- Création de branche/worktree dédiée à un ticket
- `npm run build:frontend`, `npm run test:unit`, `npm run qa`, lint (à venir Chantier D)
- Commits, push sur feature branch
- Deploy functions (backend) — changement non-régressif
- Deploy hosting sur **preview channel** (pas prod)
- Deploy preview channel sur le **projet Firebase staging** — *actif seulement
  à partir du Chantier B (Isolation staging) ; l'alias `staging` n'existe pas
  encore dans `.firebaserc` à ce jour, cette ligne est donc inerte tant que B
  n'est pas livré*
- Lancer Playwright / smoke tests, captures d'écran
- Corrections de bugs (crash, NaN, affichage cassé)

### 🛑 GATED — STOP, attendre validation explicite Omar

| Action | Raison |
|---|---|
| **Merge + deploy prod** (hosting live) | Visible par tous les utilisateurs |
| **Changement de comportement produit** | Risque de régression métier |
| **Migration / suppression de données Firestore** | Irréversible |
| **Refonte architecturale** | Impact large |
| **Suppression de données de production** | Irréversible |
| **Modification de `firestore.rules` en prod** | Sécurité/accès données |
| **Force push, secrets, modification hors scope du ticket** | Irréversible / dérive de scope |

**Règle résumée** : Omar valide le **preview visuel** → l'agent merge dans main et déploie en prod. Pas de deuxième prompt pour les fonctions.

---

## Discipline worktree + verrous fichier (A3 — Pipeline IA Phase 1)

> Convention posée pour le futur système de tickets (Chantier C, pas encore
> livré). S'applique dès maintenant à tout travail organisé "par ticket".

- **Un ticket = un worktree = une branche `sb/<ticket-id>`.**
- Avant de commencer un ticket : acquérir un verrou par fichier modifié dans
  la collection Firestore `ai_locks` (TTL 4h, renouvelable). **Cette
  collection n'existe pas encore — elle arrive au Chantier C.** Cette section
  documente la règle en amont pour que C n'ait qu'à câbler le mécanisme
  technique ; en attendant, la coordination inter-tickets reste manuelle
  (coordination via Omar / un seul ticket actif à la fois sur les ressources
  exclusives ci-dessous).
- **Ressources exclusives** (un seul ticket à la fois, quel que soit le diff) :
  `public/app.jsx`, `package.json`, `firebase.json`, `firestore.rules`,
  `CLAUDE.md`, `.claude/**`.
- **Limites par ticket** : max 2 tentatives d'implémentation, max 2
  corrections post-QA, max 8 fichiers modifiés. Dépassement d'une limite →
  statut `NEEDS_HUMAN`, on s'arrête et on remonte à Omar.

---

## Scope actif

**Sprint 3 — Rapprochement & Avances 🚧** sur l'écran Gestion de Caisse. Sprint 2 livré et déployé en prod le 2026-05-18 (PR #17, merge commit `6e00e4d`). Voir [ROADMAP.md](ROADMAP.md) pour l'historique et la suite.

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

**Isolation sessions parallèles** : toute session travaillant en parallèle
d'une autre DOIT opérer dans un worktree dédié. Jamais deux sessions dans le
même dossier : les commits se mélangent sur la branche courante, et un
ticket peut être mergé avec le travail d'un autre.

Vérification obligatoire avant de créer une branche : lancer
`git worktree list`. Si un autre worktree existe déjà sur ce dépôt,
travailler dans un worktree dédié, sans exception :

```
scripts/new-ticket.sh <slug-du-ticket>
```

**Toujours `scripts/new-ticket.sh <nom>`, jamais `git worktree add` brut** — le
script fait le `npm install` racine + `functions/` et le lien `.env`. Sans lui,
la suite de tests part rouge sur des « Cannot find module ».

Supprimer le worktree après merge.

1. **Avant de coder** :
   - Lire ce fichier
   - Lire docs/ai/code-map-actions.md (backend) ou docs/ai/code-map-components.md (frontend) avant toute recherche dans app.jsx ou functions/index.js
   - Lire le `Scope actif`
   - Vérifier la branche : pas de commit direct sur `main`, toujours feature branch
   - Annoncer un plan en début de session (mode "plan" si tâche non triviale)
   - **Tout plan se termine par « Fini quand : <une phrase vérifiable> ».** Si ça ne tient pas en une phrase, proposer le découpage.
   - **Bug** : lis le code et formule une hypothèse (`fichier:ligne`) AVANT de lancer quoi que ce soit. Un script ou serveur de test ne s'écrit que si la lecture ne tranche pas — et tu dis pourquoi.

2. **Pendant** :
   - Commits atomiques 1 feature = 1 commit minimum
   - Push après chaque commit (le user veut suivre push par push)
   - Tests unitaires sur les helpers purs obligatoires (cf. `caisseUtils.test.js`)

3. **Avant merge** :
   - **Rebase obligatoire avant merge** : avant tout merge, vérifier
     `git log HEAD..main --oneline`. Si main a avancé depuis la création de
     la branche, rebaser sur main et relancer npm run qa avant de merger.
     public/app.jsx étant un monolithe, deux branches frontend touchent
     presque toujours le même fichier — merger sans rebase écrase
     silencieusement le travail de l'autre.
   - **Gate unique : `npm run qa`** — enchaîne `test:unit` (frontend), `test:all` (tous les modules `functions/lib/*/__tests__`) et `build:frontend` (sentinelles). Doit être 100 % vert. L'étape build laisse un diff cache-bust `?v=…` sur `index.html` — normal.
   - `npm run typecheck` : informatif, NON bloquant (erreurs historiques dans les fichiers `@ts-check`, ≈271 au 2026-07-12) — la règle est de ne pas en introduire de NOUVELLES.
   - **Definition of done** : si le ticket touche `functions/` ou `public/app.jsx`, lancer `npm run code-index` puis committer les `docs/ai/*` régénérés — sinon `npm run qa` échoue sur la gate d'obsolescence. Ces fichiers générés ne comptent pas dans la limite de fichiers du périmètre.
   - PR draft via `gh pr create --draft` avec body structuré (résumé, features, critères, limitations, commits)

4. **Pilotage auto jusqu'au preview** :
   - Sur un ticket de correction ou de fonctionnalité, l'agent va de bout en
     bout sans demander de GO : branche → implémentation → tests → QA → push
     → PR draft → `scripts/preview.sh`. Il présente l'URL de preview et
     s'arrête là.
   - Ne JAMAIS demander « veux-tu que je pousse / merge / déploie » avant le
     preview. Le merge n'intervient qu'après validation visuelle explicite.
   - Le seul point d'arrêt technique restant est `scripts/deploy.sh` (prod).

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

## Pièges connus (mémoire consolidée)

> Leçons durement apprises, consolidées depuis la mémoire projet. Détail complet dans `~/.claude/projects/…/memory/` (fichier indiqué entre parenthèses).

- **Collisions UMD scope global** : les scripts classiques de `public/lib/` partagent le scope global du navigateur — un nom top-level dupliqué crashe le boot React (erreur #200). Toujours faire un smoke-load navigateur réel avant de déclarer un preview prêt. (`umd-global-collision-smoke-load`)
- **Backend jamais `require('../public/…')`** : Firebase ne déploie QUE `functions/` → `Cannot find module` → TOUTES les CF crashent au load, et les tests locaux ne le voient pas. Utiliser une copie backend dans `functions/lib/`. (`backend-jamais-require-public`)
- **Tab bare global ref** : `renderTab(tabId, <ComponentGlobal>, …)` avec une référence nue crashe GLOBALEMENT si `window.X` n'est pas posé. Fix = `window.X` + garde `!Component`. (`tab-bare-global-ref-crash`)
- **Specs/docs jamais untracked** : un fichier untracked est emporté quand une session parallèle change de branche dans le working dir partagé. Committer immédiatement. (`commit-specs-jamais-untracked`)
- **WhatsApp proactif = template only** : toute notification proactive passe par `sendTemplateMessage` (ex. `general_alert`) — un message free-form est droppé silencieusement par Meta hors fenêtre de 24 h. (`whatsapp-proactif-doit-etre-template`)
- **GO frais à chaque gate** : aucun write/deploy prod sans un GO explicite et récent à LA gate concernée — une autorisation large antérieure ne vaut pas GO permanent. (`gate-fresh-go-each-write`)

---

## Pointeurs utiles

- Politique de permissions : [docs/ai/PERMISSIONS.md](docs/ai/PERMISSIONS.md) — audit : `/permission-audit` ([scripts/permission-audit.js](scripts/permission-audit.js))
- Routes API : [firebase.json](firebase.json) (`rewrites`)
- Règles : [firestore.rules](firestore.rules)
- Build front : [scripts/build-frontend.js](scripts/build-frontend.js)
- Gate QA locale : [scripts/qa.sh](scripts/qa.sh) (`npm run qa`) — tests front + back + build
- Typecheck opt-in : [jsconfig.json](jsconfig.json) (`npm run typecheck`, non bloquant) — seuls les fichiers `// @ts-check` sont vérifiés ; monolithes exclus
- Pre-commit (opt-in) : [scripts/git-hooks/pre-commit](scripts/git-hooks/pre-commit) — activation : `git config core.hooksPath scripts/git-hooks` (config locale, partagée par tous les worktrees ; à refaire après clone)
- CI de test : [.github/workflows/test.yml](.github/workflows/test.yml) (push + PR)
- `.claude/settings.json.bak` : backup historique de la config Claude — ne pas charger, ne pas supprimer sans accord Omar
- Dette technique : [TODO_REFACTO.md](TODO_REFACTO.md)
- Roadmap sprints : [ROADMAP.md](ROADMAP.md)
- Composant caisse principal : `public/app.jsx` — chercher `function CaisseTransactionsSub` (≈ ligne 50 800).
- Cloud Function caisse : `functions/index.js` — chercher `exports.caisseManagement` (≈ ligne 11 100).


## Contrat d'orchestration multi-couches

La session principale = ARCHITECTE / chef de projet. Seul point de contact avec Omar.
Elle ne code PAS elle-même : elle planifie et délègue.

Pour CHAQUE item de docs/backlog.md, dans l'ordre :
1. PLAN — lire le contexte, établir un plan court de l'item.
2. DÉLÉGATION DEV — invoquer EXPLICITEMENT l'agent "developer" (ne pas coder dans la
   session principale).
3. DÉLÉGATION QA — une fois le dev rendu, invoquer EXPLICITEMENT l'agent "qa-reviewer".
   Verdict "À CORRIGER" -> renvoyer au developer jusqu'à APPROUVÉ.
4. RAPPORT — résumer à Omar : fait, statut tests, URL preview si déployée, hypothèses.
5. ITEM SUIVANT — uniquement après APPROUVÉ.

POINTS GATED — STOP et demander Omar avant :
- Toute migration / réécriture / suppression de données Firestore.
- Deploy prod hosting (merge main + scripts/deploy.sh hosting) — Omar valide via preview visuel.
- Changement de comportement produit ou logique métier existante.

La délégation auto aux subagents n'étant pas fiable, l'architecte les invoque
EXPLICITEMENT par leur nom à chaque étape. Ne jamais fusionner les trois rôles.
À chaque fin d'item et au démarrage de session, afficher un résumé du backlog :
items terminés [x], item en cours, items restants.
OVERLAP PIPELINE
Quand un item est en statut "preview prêt, en attente de validation Omar" :
- Ne pas attendre le deploy pour passer à la suite.
- Créer un nouveau worktree depuis main pour l'item suivant et commencer
  immédiatement (plan → developer → QA).
- Omar valide et déploie les items dans l'ordre, à son rythme.
- Si un merge sur main crée un conflit avec l'item en cours, le signaler
  et rebaser avant de continuer.

## Stratégie de deploy et QA visuelle

**RÈGLE ABSOLUE — deploy uniquement depuis `main`.** Plus jamais de deploy
(hosting ou functions) depuis une feature branch. Tout passe par main :
feature branch → PR → merge sur main → build → QA Playwright depuis main →
deploy depuis un checkout propre de main. La branche `feat/chef-bahia` est
**ABANDONNÉE** (périmée, ne contient pas les features déployées — ne jamais la merger).

Chaque deploy suit cette séquence en 2 temps :

1. DEPLOY FUNCTIONS d'abord (backend) :
   scripts/deploy.sh functions
   ⚠️ ASYNCHRONE depuis la bascule WIF : cette commande ne déploie rien
   elle-même, elle DÉCLENCHE un run GitHub Actions qui reste EN PAUSE tant
   qu'Omar n'a pas approuvé l'environment « production ».
   → Quand le script rend la main, le nouveau backend n'est PAS live.
   → Attendre la FIN RÉELLE du run (`gh run watch --repo omaaouni/BERRYGOOD`)
     avant de passer à l'étape 2, avant `node scripts/verify-deploy.js` et
     avant tout smoke : lancés trop tôt, ils testent l'ANCIENNE version
     déployée et donnent un faux vert.
   → Une fois le run terminé : le nouveau backend est live, l'ancien frontend
     fonctionne toujours.
   Détail (gate, inputs, WIF) : section « Deploy non-interactif » ci-dessous
   et docs/deploy-wif-prod.md.

2. DEPLOY HOSTING sur un PREVIEW (pas en prod) :
   firebase hosting:channel:deploy qa-test --expires 1d
   → Le preview a le nouveau frontend + le nouveau backend = app complète.

3. QA VISUELLE (Playwright) contre le preview :
   → Le qa-reviewer lance la suite Playwright contre l'URL qa-test.
   → Navigue chaque écran clé, clique les boutons, vérifie pas de crash.
   → Prend des screenshots, poste le rapport avec ✅/🔴 par écran.
   → Omar valide visuellement depuis le téléphone.

4. SI OK → DEPLOY HOSTING en live :
   scripts/deploy.sh hosting
   → Le frontend rejoint le backend déjà en prod.

5. SMOKE POST-DEPLOY contre la prod :
   → Playwright re-vérifie les écrans critiques sur la vraie URL prod.
   → Si crash détecté → alerte immédiate + rollback si nécessaire.

6. NETTOYAGE POST-DEPLOY (immédiatement après, avant de passer à l'item
   suivant — ne pas laisser traîner) :
   → `git checkout main` + `git pull` : confirmer que main == remote.
   → `git status` : le working tree doit être strictement propre. Si un
     diff résiduel de cache-bust traîne sur `public/index.html`/`public/app.js`
     (artefact non fonctionnel d'un `npm run qa`/build), le discard
     (`git checkout -- <fichier>`) — ne jamais le committer.
   → Supprimer la branche feature locale déjà mergée du chantier qui vient
     d'être déployé (`git branch -d <branche>`) ; la branche remote est déjà
     supprimée par `gh pr merge --delete-branch`.
   → Si `git status` révèle un fichier modifié qui n'a AUCUN rapport avec le
     chantier en cours (ex. `public/app.jsx` avec un diff qui ne correspond à
     rien de ce qu'on vient de faire) : ne JAMAIS le stash/discard
     silencieusement en supposant que c'est un résidu — c'est probablement le
     WIP d'une session parallèle sur le même dossier partagé. Le signaler à
     Omar explicitement et attendre confirmation avant tout `git stash` ou
     `git checkout --` dessus (cf. pièges connus : session parallèle vole la
     branche / absorbe le working tree).

Règle : JAMAIS de deploy hosting en prod sans QA visuelle sur le
preview d'abord (sauf hotfix critique avec accord Omar explicite).

### Deploy non-interactif — OBLIGATOIRE

**TOUS les deploys passent par `scripts/deploy.sh`**, jamais par un `firebase deploy`
à la main. Depuis la bascule Workload Identity Federation, le script a **deux
chemins distincts** — runbook complet : [docs/deploy-wif-prod.md](docs/deploy-wif-prod.md).

```
scripts/deploy.sh functions             # backend  → déclenche le CI (WIF)
scripts/deploy.sh functions --dry-run   # simulation CI
scripts/deploy.sh hosting               # frontend → deploy local (token)
```

⚠️ La cible mixte `hosting,functions` est **refusée** : functions est asynchrone
(attend l'approbation d'Omar), hosting est synchrone — les mélanger publierait le
frontend AVANT le backend. Les deux commandes, dans cet ordre (functions d'abord).

**Functions (prod) = GitHub Actions + WIF, aucun credential local.**
`scripts/deploy.sh functions` lance
`gh workflow run deploy-prod.yml --ref main -f dry_run=false -f only=functions`.
Le runner échange son jeton OIDC contre une impersonation du SA `sb-deployer` :
ni token, ni clé de service account, ni en local ni sur le VPS.
- **La gate = l'approbation de l'environment `production`** sur GitHub (required
  reviewer : Omar). Tant qu'elle n'est pas donnée, le run reste en pause.
- Suivre : `gh run watch --repo omaaouni/BERRYGOOD`.
- La gate G6 (`scripts/verify-deploy.js`) et le smoke test se lancent **après la fin
  réelle du run** — le script rappelle les commandes exactes. Les lancer avant donne
  un faux vert (l'ancienne version est encore déployée).
- **Ni `--token`, ni `--force`** dans le workflow (`--force` fait passer
  silencieusement la suppression de functions).
- Aucun secret n'entre dans GitHub : sans `functions/.env` sur le runner,
  firebase-tools réinjecte les variables d'environnement **déjà déployées**.
  ⚠️ Corollaire : une function **créée** après la bascule naît **sans env vars** et
  échoue au runtime, pas au deploy — cf. docs/deploy-wif-prod.md §8.

**Hosting (prod) = encore `FIREBASE_TOKEN`, transitoire.**
`firebase --config … deploy --only hosting --token "$FIREBASE_TOKEN" --non-interactive`
- `FIREBASE_TOKEN` est chargé depuis `.env` (gitignored). **Ne jamais le committer.**
- Génération du token (une fois, par Omar — flux navigateur interactif que
  l'agent ne peut pas faire) : `firebase login:ci` → copier le token →
  l'ajouter dans `.env` sous `FIREBASE_TOKEN=...`.
- Google déprécie ce mécanisme : la bascule du hosting vers WIF est au backlog.
  Le jour de cette bascule → retirer la ligne de `.env` **et** révoquer le token.

## Autorisation de deploy par validation visuelle

Une fois la QA Playwright opérationnelle :
- Quand Omar valide les screenshots QA ("OK deploy", "go", "approved",
  ou équivalent), le deploy hosting ET functions en prod est autorisé.
- L'approbation visuelle vaut autorisation de deploy — pas besoin
  d'attendre un second prompt firebase.
- En l'absence de validation explicite d'Omar, NE PAS déployer.
- Exception : hotfix critique avec crash prod avéré → deploy immédiat
  + notification Omar après.

Cette règle s'active UNIQUEMENT quand la suite Playwright est
opérationnelle et tourne sur chaque preview. Tant que Playwright
n'est pas en place, le prompt firebase reste actif.

## Process QA visuelle (mis à jour)

1. Playwright tourne après chaque preview (Chromium + WebKit).
2. SI Playwright détecte des bugs (crash, NaN, élément manquant,
   graphe cassé) → l'architecte corrige SANS consulter Omar,
   relance Playwright, et recommence jusqu'à 0 bug détecté.
   (L'architecte distingue un vrai bug applicatif d'un artefact de
   test/données : un sélecteur fragile ou un écran légitimement vide
   se corrige dans la suite, pas dans l'app.)
3. QUAND Playwright passe au vert sur tous les écrans (0 bug) →
   l'architecte poste les screenshots des 12 écrans (Chromium +
   WebKit) dans la conversation pour validation visuelle par Omar.
4. Omar valide ("OK deploy") ou demande des corrections.
5. Deploy prod uniquement après validation Omar.

Résumé : l'architecte est autonome pour corriger les bugs détectés
automatiquement. Omar ne voit que le résultat final propre.

## Modularisation progressive (règle permanente)

Objectif : supprimer progressivement le risque lié au monolithe public/app.jsx,
afin qu'un bug dans un module/tab ne bloque plus toute l'application.

### Règles permanentes

1. Tout nouveau code doit aller dans un fichier séparé.
   Ne plus ajouter de nouveau composant, popup, tab, helper ou logique métier
   directement dans public/app.jsx.
   Exemples : public/components/MagSortieTab.jsx, PaiePopup.jsx, PointageTab.jsx

2. À chaque item du backlog, si un bloc existant de app.jsx est touché, il doit
   être extrait dans son propre fichier en même temps.

3. L'extraction doit d'abord être faite à comportement identique.
   Ne pas mélanger refactor profond et changement fonctionnel.
   Étapes : déplacer → vérifier l'import → vérifier l'UI identique → puis
   seulement appliquer la modification demandée.

4. Implémenter progressivement le code splitting (après migration Vite).
   Chaque module/tab important sera chargé séparément avec React.lazy() + Suspense.

5. Chaque module/tab lazy-loaded doit être protégé par un TabErrorBoundary.
   Si un module crashe → message d'erreur localisé sur ce tab, sans bloquer
   le reste de l'application.

6. public/app.jsx doit devenir progressivement un routeur/layout contenant
   uniquement : layout général, navigation, imports lazy, routes/tabs,
   Error Boundaries, logique minimale de coordination globale.

### Pattern cible (après migration Vite)

const MagSortieTab = React.lazy(() => import('./components/MagSortieTab.jsx'));
<TabErrorBoundary tabName="Sortie magasin">
  <Suspense fallback={<div>Chargement du module...</div>}>
    <MagSortieTab />
  </Suspense>
</TabErrorBoundary>

### Interdiction

Ne plus ajouter de gros blocs de code directement dans public/app.jsx.
Toute exception doit être justifiée explicitement.

### Note importante sur le code splitting

Le build actuel (node scripts/build-frontend.js + Babel) produit un seul fichier
app.js. L'extraction des composants en fichiers séparés est possible immédiatement,
mais le vrai code splitting avec chunks séparés ne sera disponible qu'après migration
vers Vite.

- Phase 1 : extraction des composants en fichiers séparés (build Babel actuel).
- Phase 2 : migration du build vers Vite.
- Phase 3 : activation de React.lazy() + Suspense + TabErrorBoundary.

Ne PAS implémenter React.lazy() tant que Vite n'est pas en place — le build
actuel ne sait pas produire les chunks nécessaires.

  ## Notifications WhatsApp

À chaque événement clé, envoyer un message WhatsApp à Omar via l'API Cloud
existante (voir functions/ pour le endpoint et le token) :

1. BACKLOG MIS À JOUR → envoyer la liste numérotée des items avec leur statut
   (✅ terminé / 🔄 en cours / ⏳ à faire).
2. PREVIEW PRÊT → envoyer l'URL du preview + la checklist de tests manuels
   rédigée par le qa-reviewer (écrans à ouvrir, actions à tester, résultats
   attendus).
3. DEPLOY PROD EFFECTUÉ → confirmer le deploy avec un résumé de ce qui a changé.

Format : messages courts, lisibles sur mobile, en français.
Le numéro d'Omar et la config WhatsApp sont dans le projet (phone number ID
1040240149168335). Si le token/endpoint n'est pas trouvé, demander à Omar.

## Règle bug reports automatiques

Au début de chaque session, vérifier Firestore bug_reports où status="qualified"
ET severity in ["critical","high"]. Les traiter AVANT les autres items du backlog.
Quand le fix est déployé : status="resolved" + noter le commit/PR. Les bugs
"medium"/"low" sont traités quand le backlog haute priorité est vide.

## Gouvernance bug reports — actions autorisées vs gated

Les bug reports qualifiés par le triage IA suivent ces règles.

**AUTORISÉ (autonome, pas besoin de GO Omar) :**
- Correction de bugs (crash, erreur d'affichage, données incorrectes, comportement cassé)
- Fix de performance (écran lent, timeout)
- Fix de compatibilité (Safari, mobile)

**INTERDIT sans accord admin (GATED) :**
- Modification de fonctionnalité (changer un comportement existant)
- Suppression de fonctionnalité ou de données
- Ajout de nouvelle fonctionnalité demandée par un utilisateur
- Changement de logique métier (calculs paie, règles de validation)

Si un bug report contient une demande de modification/suppression :
1. Le triage qualifie comme `type: "feature_request"` (pas `"bug"`)
2. L'architecte ne traite PAS — il ajoute au backlog gated
3. WhatsApp Omar : « Demande de modification reçue de [reporter] : [description].
   Ajoutée au backlog, en attente de ta validation. »

Le triage IA doit distinguer :
- « Le bouton X ne marche pas » → bug → autonome
- « Je voudrais que le bouton X fasse Y » → feature → gated
- « Supprime l'onglet Z » → suppression → gated

⚠️ Un **renommage de label** demandé par un utilisateur ou déduit du backlog reste
une **modification de fonctionnalité** (gated) : valider avec Omar AVANT, ne pas
l'appliquer en autonome (cf. revert du rename « Poste Fixe → Ouvrier Avocatier »
le 2026-06-12, refusé par Omar).
## Workflow GATED révisé (specs async) — les items gated ne bloquent JAMAIS l'archi

Un item GATED ne met plus l'archi en attente. Nouveau cycle :

1. **QUALIFICATION (autonome)** : l'archi analyse et écrit un spec complet dans
   `docs/spec-<item>.md`. Le fichier DOIT être AUTOSUFFISANT : contexte, analyse,
   plan d'implémentation détaillé, validation croisée (ex. exemples chiffrés),
   risques, edge cases, fichiers/fonctions concernés. Un autre archi — ou le même
   dans une nouvelle session — doit pouvoir implémenter SANS re-analyser.
2. **NOTIFICATION** : signaler à Omar « Spec prêt : `docs/spec-<item>.md` », puis
   passer immédiatement à l'item suivant (ne pas attendre).
3. **IMPLÉMENTATION** : quand Omar dit « GO spec-<item> » → lire le fichier, coder,
   déployer. Le spec a déjà toutes les réponses (pas de nouvelle question).

Principe : **l'archi ne s'arrête jamais**. Les specs `docs/spec-*.md` sont la file
d'attente asynchrone d'Omar — il valide quand il veut, dans l'ordre qu'il veut.
S'applique aux points GATED (migration/suppression Firestore, déploiement prod,
changement de logique métier, nouvelle feature) : produire le spec d'abord, exécuter
sur GO.
