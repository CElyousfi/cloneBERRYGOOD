# PERMISSIONS.md — Politique de permissions Claude Code (Smart Berry)

> Source de vérité : `.claude/settings.json` (projet). Ce document explique la
> philosophie et chaque catégorie de règle. Toute évolution des permissions doit
> mettre à jour les deux en même temps. Audit périodique : `/permission-audit`
> (`scripts/permission-audit.js` — statistiques d'usage des outils sur les
> transcripts du projet uniquement ; l'analyse des trois `settings.json` reste
> manuelle, cf. commande `/permission-audit`).

## Philosophie

**Révision 2026-07-28 — modèle "2 gates".** Décision explicite d'Omar, après
mise en garde sur les risques (perte de données, action irréversible, ou
instruction injectée dans une sortie de sous-agent — cf. incident constaté
le jour même — exécutée sans confirmation) : au lieu de gater chaque commande
individuellement risquée, on ne garde que **deux points d'arrêt** :

1. **Merge / push vers `main`** — avant toute intégration dans la branche prod.
2. **Déploiement** (`scripts/deploy.sh`, `npm run deploy:functions` /
   `npm run deploy:hosting`) — avant toute mise en prod effective.

Tout le reste (y compris `rm`, `mv`, `sed -i`, `npm install/uninstall/update`,
`gcloud`, `firebase hosting:channel:*`, `git reset/rebase/clean`, suppression
de branches, `git push` hors `main`) est en **allow** — autonomie complète.
**Risque assumé** : ces commandes ne sont plus gatées, y compris si elles sont
déclenchées par une instruction injectée dans le contenu retourné par un
sous-agent ou un outil externe. La seule protection restante contre ce
scénario est le `deny` (irréversible) et la vigilance du modèle lui-même —
plus de garde-fou mécanique intermédiaire. Assumé en connaissance de cause.

Trois niveaux (précédence : **deny > ask > allow**) :

| Niveau | Contenu | Exemples |
|---|---|---|
| **allow** | Tout sauf les 2 gates + irréversible | `git status`, `git commit`, `rm`, `gcloud`, `npm install`, `firebase hosting:channel:*`, `git push` (hors main) |
| **ask** | Les 2 gates uniquement | `git push`/`gh pr merge` vers `main`, `git merge`, `scripts/deploy.sh`, `npm run deploy:functions`/`deploy:hosting` |
| **deny** | Irréversible / interdit | `git push --force[-with-lease]`, `git reset --hard`, `sudo`, `firebase deploy` brut, lecture `.env`/secrets |

Complément clé : **Bash est le dernier recours**. La plupart des prompts
évitables viennent de commandes Bash (`cd … && grep …`) qui auraient dû être
des appels d'outils natifs (Read/Grep/Glob/Write), jamais gatés.

## Règles d'usage des outils (avant toute permission)

1. **Read / Grep / Glob / Write / Edit d'abord.** Avant chaque appel Bash,
   vérifier si un outil natif suffit. `grep`→Grep, `cat`/`head`/`tail`/`sed -n`→Read,
   `find`/`ls` (exploration)→Glob, `cat > fichier`/`echo >`→Write/Edit.
2. **Jamais de `cd … && cmd`.** Le working directory est déjà le repo (ou le
   worktree). Un préfixe `cd` fait prompter toute la chaîne. Pour un autre repo :
   `git -C <chemin>`.
3. **Jamais de chaînes `a && b && c`.** Une commande composée est évaluée comme
   un tout et ne matche plus l'allowlist. Faire des appels séparés.
4. **Scripts one-off** : dans `/tmp` (additionalDirectory), jamais dans le repo.
   Les analyses récurrentes deviennent des scripts versionnés (`scripts/`).

## allow — automatique, sans prompt

| Groupe | Règles | Raison |
|---|---|---|
| Outils natifs | `Read`, `Grep`, `Glob` | Lecture seule, cœur du workflow |
| Shell lecture | `pwd`, `ls` | Sans effet |
| Git lecture | `git status/diff/log/show`, `git remote -v`, `git stash list` | Sans effet |
| Git branch lecture | `--show-current`, `--list`, `--contains`, `--merged`, `-vv` | Variantes lecture uniquement — PAS `git branch:*` (couvrirait `-D`) |
| Git fetch ciblé | `git fetch`, `git fetch BERRYGOOD:*`, `git fetch --prune BERRYGOOD:*` | Remote du projet uniquement — pas de fetch d'URL/remote arbitraire |
| Git écriture locale | `git add:*`, `git commit:*` (+ `--amend/--fixup/--squash`) | Dev courant autonome (cf. garde-fous commit dans CLAUDE.md) |
| Git checkout/switch | `git checkout:*`, `git switch:*` | Risque connu accepté par Omar (2026-07-28) : une session parallèle peut changer de branche sous les pieds d'une autre dans le working dir partagé (cf. incident 2026-07-12, [[session-parallele-vole-la-branche]]) |
| Git historique/working tree | `git reset:*`, `git rebase:*`, `git clean:*`, `git config:*`, `git stash push/pop/apply/drop/clear/branch:*` | Passé en allow le 2026-07-28 (modèle "2 gates", risque assumé — voir Philosophie) |
| Git branches | `git branch -d/-D/-f/--delete:*` | Idem — suppression de branche locale, pas `main` |
| Git push | `git push:*` (sauf vers `main`, cf. section ask) | Idem |
| GitHub lecture | `gh pr view/list/diff/checks`, `gh run list/view/watch` | Lecture seule |
| Fichiers | `rm:*`, `mv:*`, `sed -i:*` | Passé en allow le 2026-07-28 (modèle "2 gates") — le `deny` garde les cas `rm -rf` les plus destructeurs |
| Dépendances | `npm install/uninstall/update:*` | Idem |
| npm scripts | `npm run qa/test:unit/build:frontend/typecheck`, `npm ls` | Scripts `package.json` non destructifs — `npm run deploy:functions` / `npm run deploy:hosting` restent en ask (gate 2) |
| Node ciblé | `node --version/--check/--test`, `node tests/smoke-test.js`, `node tests/smoke-sprint-1.js`, `node tests/test-workflows.js`, `node tests/test-chef-bdc-bot.js`, `node scripts/build-frontend.js`, `node scripts/permission-audit.js`, `node scripts/diag-readonly.js:*` | Scripts QA/diagnostic nommément reconnus — le diagnostic Firestore/Meta lecture seule passe par `diag-readonly.js` (masque les secrets), pas par des `node -e`/`python3 -c` one-off qui restent hors allowlist (exécution arbitraire) |
| Python ciblé | `python3 -m json.tool` | Validation JSON pure — PAS `python3 -c` (exécution arbitraire) |
| Firebase | `firebase functions:log`, `firebase projects:list:*`, `firebase hosting:channel:*` | Le preview channel est passé en allow le 2026-07-28 (pas de risque prod direct — un channel n'affecte pas `default`/live) ; `firebase deploy` brut reste en `deny` |
| Cloud | `gcloud:*` | Passé en allow le 2026-07-28 (modèle "2 gates", risque assumé) |
| Web | `WebSearch`, `WebFetch` domaines FarmRoad/WayBeyond | Doc fournisseur |

**Preview staging (Chantier B) — note obsolète depuis le 2026-07-28.** Avant
le modèle "2 gates", `firebase hosting:channel:*` était en `ask` précisément
parce que la syntaxe de permission Claude Code ne supporte que le préfixe
exact ou un wildcard **final**, donc impossible de vérifier qu'un
`--project staging` explicite est bien présent (sans lui, une commande
`hosting:channel:deploy` cible l'alias `default` de `.firebaserc`, qui est la
prod). Ce risque n'a pas disparu — il est simplement **assumé** maintenant
que `firebase hosting:channel:*` est en `allow` (décision Omar 2026-07-28,
modèle "2 gates"). Le wrapper qui fixerait `--project` en dur reste une bonne
idée pour le Chantier B, mais n'est plus un prérequis bloquant pour l'allow.

## ask — confirmation Omar obligatoire (les 2 gates)

Depuis le 2026-07-28, ce ne sont plus des catégories de risque mais
**exactement deux moments** du cycle de vie du code :

| Groupe | Règles | Raison |
|---|---|---|
| Gate 1 — Merge/push vers `main` | `git push BERRYGOOD main:*`, `git push origin main:*`, `git merge:*`, `gh pr merge:*` | `main` = prod (RÈGLE 1 CLAUDE.md) — dernier point d'arrêt avant que du code entre dans la branche qui sera déployée |
| Gate 2 — Déploiement | `scripts/deploy.sh` (2 cibles : `functions`, `hosting`, chacune avec ou sans `--dry-run` ; la cible mixte `hosting,functions` est refusée par le script), `npm run deploy:*`, `gh workflow run:*` | Déploiement prod effectif (avec ses 3 checks anti-divergence RULE 1/2/3 dans le script). `firebase deploy` brut reste en `deny` (voir plus bas) : impossible de bypasser le script. Le déclenchement direct d'un workflow — `gh workflow run` comme `gh api …/actions/workflows/…/dispatches` — est refusé par le hook `scripts/bash-discipline-gate.js`, et pas seulement par la règle `ask` : le matching `ask` étant un préfixe, `GH_REPO=x gh workflow run` ou un double espace y échapperaient. L'entrée `gh workflow run:*` en `ask` reste comme documentation d'intention ; c'est le hook qui applique. La lecture (`gh run list/watch/view`) reste libre. |

**Nuance depuis la bascule WIF (ticket `sb/deploy-wif-prod`)** : sur la cible
`functions`, `scripts/deploy.sh` ne déploie plus rien lui-même — il déclenche
un run GitHub Actions (`deploy-prod.yml`). Le prompt de la gate 2 autorise donc
le *déclenchement*, pas le déploiement — et ce déclenchement est **le dernier
point d'arrêt** : le run démarre immédiatement, GitHub ne met rien en pause
(les required reviewers d'environment exigent le plan Enterprise sur repo
privé ; l'org est en Team). La gate réelle est **en amont** : branch protection
sur `main` (PR obligatoire + status check `test` vert) pour qu'un commit entre
dans `main`, et deployment branch policy sur l'environment `production` pour que
seul `main` puisse déployer. Côté déclenchement, `npm run deploy:*` et
`gh workflow run:*` ont été ajoutés à `ask`, mais l'application réelle vient du
hook `scripts/bash-discipline-gate.js` : il refuse **tout** déclenchement direct
de workflow (`gh workflow run` comme `gh api …/dispatches`), parce que le
matching `ask` est un préfixe et laisserait passer `GH_REPO=x gh workflow run`.
Le seul chemin restant est `scripts/deploy.sh`, lui-même en `ask`. Voir
`docs/deploy-wif-prod.md` (section « Modèle de sécurité »).

**Incertitude de matching signalée** : `git push:*` est en `allow` (branches
non-`main`) alors que `git push BERRYGOOD main:*` / `git push origin main:*`
sont en `ask` — la précédence exacte entre un `allow` large et un `ask` plus
spécifique sur une commande qui matche les deux n'est pas documentée
publiquement pour Claude Code. Le principe annoncé est **deny > ask > allow**,
ce qui suggère que l'entrée `ask` l'emporte, mais **à vérifier en conditions
réelles** (tenter un `git push BERRYGOOD main` doit produire un prompt) avant
de s'y fier comme seule barrière.

## deny — bloqué, pas de confirmation possible

- `git push --force / -f / --force-with-lease`, `git reset --hard`,
  `git clean -fd/-fdx/-xfd`, `rm -rf /|~|..|.`, `sudo` — irréversibles.
- `firebase deploy:*` (commande brute) — **deny**, pas ask. Force tout
  déploiement à passer par `scripts/deploy.sh`, seul point d'entrée qui
  vérifie working tree propre / branche `main` / `main` à jour avec le remote
  (RULE 1/2/3 de CLAUDE.md) avant de déployer. `scripts/deploy.sh` reste en
  `ask` (confirmation à chaque fois), volontairement **pas** en `deny` : c'est
  le mécanisme légitime par lequel Omar autorise un déploiement prod.
- Lecture de secrets : `Read(./.env)`, `Read(./.env.*)`, `Read(**/.env)`,
  `Read(**/.env.*)`. **Incertitude signalée** : la portée exacte du matching
  glob de `Read(...)` dans Claude Code n'est pas entièrement documentée
  publiquement ; ces règles sont la meilleure tentative disponible. À vérifier
  concrètement (tenter une lecture de `.env` doit produire un refus) avant de
  s'y fier comme seule barrière — la discipline « ne jamais committer `.env`,
  ne jamais le stager » (garde-fous commit ci-dessous) reste la protection
  primaire, cette règle est une deuxième ligne de défense.

**Non résolu / hors syntaxe supportée** : un `deny` générique sur toute
commande contenant `--project production` (n'importe où dans la commande,
n'importe quel outil) n'est **pas** possible avec la syntaxe actuelle
(préfixe exact ou wildcard final uniquement, pas de matching de flag en
position arbitraire). Ce garde-fou reste donc une **règle de discipline**
(ne jamais passer `--project production` explicitement — le projet par
défaut de `.firebaserc` est prod, `scripts/deploy.sh` ne prend pas ce flag en
paramètre libre), pas une barrière technique. Documenté ici pour qu'aucune
fausse confiance ne s'installe.

## Exemples

```
# ❌ MAUVAIS (prompt inutile — commande composée + grep Bash)
Bash: cd "/Users/…/berrygood-dashboard" && grep -n 'CaisseTransactionsSub' public/app.jsx
# ✅ BON (aucun prompt)
Grep: pattern="CaisseTransactionsSub", path=public/app.jsx, -n

# ❌ MAUVAIS
Bash: cat public/lib/caisseUtils.js | head -50
# ✅ BON
Read: public/lib/caisseUtils.js (limit=50)

# ❌ MAUVAIS (fetch d'un remote arbitraire → prompt, voulu)
Bash: git fetch https://example.com/repo.git
# ✅ BON (auto-autorisé)
Bash: git fetch BERRYGOOD
```

## Garde-fous commit (git add/commit étant en allow)

Avant CHAQUE commit :
1. `git branch --show-current` — bonne branche (jamais `main` sauf gouvernance).
2. `git status` — état complet du working tree.
3. Staging **ciblé** : fichiers nommés explicitement. Jamais `git add .` ni
   `git add -A` par défaut.
4. `git diff --cached` relu avant le commit.
5. Aucun secret stagé : `.env`, tokens, credentials, `*.bak` de config.

## Portée des fichiers

- `.claude/settings.json` (projet, versionné) : politique canonique — ce document.
- `.claude/settings.local.json` (non versionné) : ajustements locaux minimes
  (additionalDirectories). Ne pas y accumuler de règles.
- `~/.claude/settings.json` (global) : garder un allow minimal (lecture git) +
  ask/deny filet pour les autres projets. **Ne jamais** y laisser s'accumuler
  les "Always allow" one-off (deploys, credentials, scripts /tmp).

## Risques résiduels assumés

- `git commit:*` en allow → un commit sur une mauvaise branche reste possible ;
  mitigé par les garde-fous ci-dessus et la vérification de branche systématique.
- **Bypass par réordonnancement de flags** : le matching des règles est un match
  de préfixe. `git commit --amend` matche l'ask dédié, mais `git commit -a --amend`
  ou `git commit -m "x" --amend` matchent `git commit:*` (allow) — idem
  `git commit --no-verify` (interdit par CLAUDE.md). L'interdiction de réécrire
  l'historique ou de skipper les hooks reste donc une règle de **discipline**
  (toujours mettre `--amend` en premier flag si demandé explicitement par Omar),
  pas une barrière technique. Le même défaut de matching s'applique à
  `--project production` (cf. section deny ci-dessus).
- Scripts node QA allowlistés par chemin → à re-auditer si un script est renommé
  ou change de rôle (`/permission-audit` les détecte).
- `git add *` en allow global → le staging ciblé est une règle de discipline
  (CLAUDE.md), pas une barrière technique.
- Deny `.env` sur l'outil Read : syntaxe glob non vérifiée en conditions
  réelles dans ce chantier (voir section deny) — à confirmer.

## Ajouter / modifier une règle

1. Se demander : lecture ? dev courant ? → allow. Destructif / prod / historique ?
   → ask (ou deny si irréversible).
2. Préférer les préfixes précis (`git branch --list:*`) aux wildcards larges
   (`git branch:*`).
3. Vérifier les collisions : un `ask X:*` peut écraser un `allow X sub` selon la
   précédence — tester.
4. Mettre à jour ce document + lancer `/permission-audit`.
5. Ne **jamais** répondre "Always allow" sur un one-off deploy/credentials — c'est
  exactement ce qui a pollué le fichier global par le passé.
