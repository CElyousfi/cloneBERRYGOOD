# PERMISSIONS.md — Politique de permissions Claude Code (Smart Berry)

> Source de vérité : `.claude/settings.json` (projet). Ce document explique la
> philosophie et chaque catégorie de règle. Toute évolution des permissions doit
> mettre à jour les deux en même temps. Audit périodique : `/permission-audit`
> (`scripts/permission-audit.js` — statistiques d'usage des outils sur les
> transcripts du projet uniquement ; l'analyse des trois `settings.json` reste
> manuelle, cf. commande `/permission-audit`).

## Philosophie

Pendant un ticket normal, Claude ne doit **pratiquement jamais** demander de
permission. Les seules confirmations acceptables concernent les opérations
**destructives**, **de production**, ou qui **réécrivent l'historique git**.

Trois niveaux (précédence : **deny > ask > allow**) :

| Niveau | Contenu | Exemples |
|---|---|---|
| **allow** | Lecture, dev courant, QA locale | `git status`, `git commit`, `npm run qa`, `gh pr view` |
| **ask** | Destructif, prod, dépendances, réécriture d'historique | `git push`, `git merge`, `rm`, `firebase hosting:channel:*`, `scripts/deploy.sh`, `git commit --amend` |
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
| Git écriture locale | `git add:*`, `git commit:*` | Dev courant autonome (cf. garde-fous commit dans CLAUDE.md) ; le push reste en ask ; amend/fixup/squash sont en ask |
| Git checkout | `git checkout:*` | Risque connu accepté par Omar (2026-07-28) : une session parallèle peut changer de branche sous les pieds d'une autre dans le working dir partagé (cf. incident 2026-07-12, [[session-parallele-vole-la-branche]]) — `git switch` reste en ask |
| GitHub lecture | `gh pr view/list/diff/checks`, `gh run list/view` | Lecture seule |
| npm scripts QA | `npm run qa/test:unit/build:frontend/typecheck`, `npm ls` | Scripts `package.json` non destructifs — PAS `npm run:*` (le `package.json` contient un script `deploy`). Pas de `lint` (script inexistant à ce jour — arrivera au Chantier D) |
| Node ciblé | `node --version/--check/--test`, `node tests/smoke-test.js`, `node tests/smoke-sprint-1.js`, `node tests/test-workflows.js`, `node tests/test-chef-bdc-bot.js`, `node scripts/build-frontend.js`, `node scripts/permission-audit.js` (forme exacte, lecture seule) | Scripts QA nommément reconnus — PAS `node:*` ni `node scripts/*` (deploy/migration/seed restent gatés) |
| Python ciblé | `python3 -m json.tool` | Validation JSON pure — PAS `python3 -c` (exécution arbitraire) |
| Firebase lecture | `firebase functions:log` | Lecture logs |
| Web | `WebSearch`, `WebFetch` domaines FarmRoad/WayBeyond | Doc fournisseur |

**Preview staging (Chantier B) — volontairement absent.** Le brief demande un
`allow` sur `firebase hosting:channel:deploy sb-* --project staging`. La
syntaxe de permission Claude Code ne supporte que le préfixe exact ou un
wildcard **final** (`Bash(git *)` matche tout ce qui commence par `git `) —
elle ne peut **pas** exiger la présence d'un flag (`--project staging`) à un
endroit arbitraire de la commande. Autoriser `firebase hosting:channel:deploy
sb-*` sans pouvoir vérifier `--project staging` ferait courir un risque réel :
une commande lancée sans ce flag cible l'alias `default` de `.firebaserc`,
qui est **la prod** aujourd'hui. Tant que le Chantier B n'a pas livré un
wrapper (`scripts/deploy-preview-staging.sh` ou équivalent, qui fixe le
`--project` en dur), ce déploiement reste en `ask` via `firebase
hosting:channel:*`. À corriger explicitement dans le Chantier B.

## ask — confirmation Omar obligatoire

| Groupe | Règles | Raison |
|---|---|---|
| Publication | `git push:*`, `gh pr merge:*` | Sort du poste local |
| Navigation branches | `git switch` | Une session parallèle peut voler la branche du working dir partagé (`git checkout` est passé en allow le 2026-07-28, risque accepté par Omar) |
| Historique | `git reset`, `git commit --amend/--fixup/--squash`, `git rebase`, `git merge` | Réécriture / intégration d'historique |
| Working tree | `git clean`, `git stash push/pop/apply/drop/clear/branch` | Peut perdre du travail non committé |
| Branches | `git branch -d/-D/-f/--delete` | Suppression de branches |
| Config | `git config` | Modifie le comportement git |
| Fichiers | `rm`, `mv`, `sed -i` | Destructif / écriture in-place opaque |
| Dépendances | `npm install/uninstall/update` | Modifie package-lock, surface d'attaque supply chain |
| Production — déploiement supervisé | `firebase hosting:channel:*`, `gcloud`, `scripts/deploy.sh` (4 variantes), `npm run deploy` | Le déploiement prod (`scripts/deploy.sh`, avec ses 3 checks anti-divergence RULE 1/2/3) reste possible mais **jamais autonome** — confirmation Omar à chaque exécution. `firebase deploy` brut, lui, est en `deny` (voir plus bas) : impossible de bypasser le script. |

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
