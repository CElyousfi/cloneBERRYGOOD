#!/usr/bin/env bash
# Deploy Smart Berry depuis main.
#
# Deux chemins, volontairement différents :
#   - functions → déclenche le workflow GitHub `deploy-prod.yml` (Workload Identity
#     Federation, aucun credential local). Le run démarre dès le déclenchement : il n'y a
#     PAS d'approbation de run côté GitHub (les required reviewers d'environment sont
#     réservés au plan Enterprise sur repo privé). Le point d'arrêt humain est en amont —
#     le prompt de permission local sur ce script — et la protection de `main` (PR + CI
#     verte) garantit ce qui peut être déployé. Runbook : docs/deploy-wif-prod.md
#   - hosting   → deploy local via FIREBASE_TOKEN (transitoire, bascule WIF au backlog).
#
# Pré-requis :
#   - Être sur un checkout propre de `main` (règle CLAUDE.md : deploy depuis main uniquement).
#   - Chemin hosting seulement : .env (gitignored) contient FIREBASE_TOKEN=...
#     (généré une fois via `firebase login:ci`).
#   - Chemin functions seulement : `gh` installé et authentifié (`gh auth login`).
#
# Usage :
#   scripts/deploy.sh hosting               # frontend seul (local, token)
#   scripts/deploy.sh functions             # backend seul (déclenche le CI)
#   scripts/deploy.sh functions --dry-run   # simulation CI (dry_run=true)
#   scripts/deploy.sh hosting --dry-run     # validation sans déployer
# Tout argument après la cible est transmis tel quel à `firebase deploy` (chemin hosting).
set -euo pipefail

ONLY="${1:-}"
if [ -z "$ONLY" ]; then
  echo "🛑 ERREUR : cible manquante." >&2
  echo "   Usage : scripts/deploy.sh hosting   |   scripts/deploy.sh functions" >&2
  exit 1
fi
shift || true   # le reste ("$@") est transmis à firebase deploy (ex. --dry-run)
PROJECT="berrygood-farms-dashboard"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

WANTS_FUNCTIONS=0
WANTS_HOSTING=0
case "$ONLY" in *functions*) WANTS_FUNCTIONS=1 ;; esac
case "$ONLY" in *hosting*) WANTS_HOSTING=1 ;; esac

if [ "$WANTS_FUNCTIONS" -eq 0 ] && [ "$WANTS_HOSTING" -eq 0 ]; then
  echo "🛑 ERREUR : cible '$ONLY' non reconnue (attendu : 'hosting' ou 'functions[:nom]')." >&2
  exit 1
fi

# === Cible mixte 'hosting,functions' : REFUS EXPLICITE ===
# Les deux chemins n'ont plus le même modèle d'exécution : hosting est synchrone et local,
# functions est asynchrone : le run vit hors de ce terminal (GitHub Actions), et le script
# rend la main dès le déclenchement, sans savoir quand le backend sera live. Un deploy mixte
# publierait donc le FRONTEND immédiatement, alors que le BACKEND serait encore en train de
# se déployer — soit exactement l'inverse de l'ordre imposé par CLAUDE.md (functions d'abord, hosting
# ensuite, pour que le nouveau frontend ne parle jamais à un ancien backend). Plutôt que de
# masquer ce décalage, on refuse et on impose les deux commandes dans le bon ordre.
if [ "$WANTS_FUNCTIONS" -eq 1 ] && [ "$WANTS_HOSTING" -eq 1 ]; then
  echo "🛑 ERREUR : cible mixte '$ONLY' refusée depuis la bascule du deploy functions vers le CI." >&2
  echo "   functions = run GitHub asynchrone (le deploy se termine hors de ce terminal) ;" >&2
  echo "   hosting   = deploy local synchrone. Les mélanger publierait le frontend AVANT le backend." >&2
  echo "" >&2
  echo "   → Fais les deux séparément, dans cet ordre (CLAUDE.md : functions d'abord) :" >&2
  echo "       scripts/deploy.sh functions      # puis attendre la FIN du run CI" >&2
  echo "       scripts/deploy.sh hosting" >&2
  exit 1
fi

# === RÈGLES ANTI-DIVERGENCE (CLAUDE.md) — garde-fous bloquants avant tout deploy ===
# (a) working tree propre  (b) branche = main  (c) main à jour avec le remote.
# S'exécutent en tête pour LES DEUX chemins : sur le chemin functions ils valident
# exactement ce que le CI va déployer (le workflow tourne sur --ref main).
# Toute condition en échec ARRÊTE le deploy. Pas d'override silencieux.
REMOTE="${DEPLOY_REMOTE:-BERRYGOOD}"
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "🛑 ERREUR (RÈGLE 1) : deploy autorisé UNIQUEMENT depuis 'main'. Branche actuelle : '$BRANCH'." >&2
  echo "   → bascule sur main (ou merge ton travail dans main) avant de déployer." >&2
  exit 1
fi
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "🛑 ERREUR (RÈGLE 2/3) : working tree NON propre (modifications ou fichiers untracked)." >&2
  echo "   Rien de non committé ne doit partir en prod. État :" >&2
  git -C "$ROOT" status --short >&2
  exit 1
fi
echo "[deploy] fetch $REMOTE pour vérifier la synchro de main avec le remote..."
if git -C "$ROOT" fetch "$REMOTE" main --quiet 2>/dev/null; then
  LOCAL_SHA="$(git -C "$ROOT" rev-parse main)"
  REMOTE_SHA="$(git -C "$ROOT" rev-parse "$REMOTE/main")"
  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    echo "🛑 ERREUR (RÈGLE 2) : main local ($(git -C "$ROOT" rev-parse --short main)) ≠ $REMOTE/main ($(git -C "$ROOT" rev-parse --short "$REMOTE/main"))." >&2
    echo "   → push/pull pour aligner main avec $REMOTE avant de déployer." >&2
    exit 1
  fi
else
  echo "🛑 ERREUR (RÈGLE 2) : impossible de fetch '$REMOTE' (remote injoignable ?). Override : DEPLOY_REMOTE=<nom>." >&2
  exit 1
fi
echo "[deploy] ✓ garde-fous OK : branche main · tree propre · main == $REMOTE/main"
echo "[deploy] branche : $(git -C "$ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$ROOT" rev-parse --short HEAD)"

# === TRANSPARENCE — qu'est-ce qui est déjà en prod, et qu'est-ce qu'on y ajoute ? ===
# Purement informatif : aucun garde-fou n'en dépend, aucune décision de deploy n'est
# prise ici. Le `|| true` est délibéré — une panne réseau, un `gh` absent ou un ADC
# expiré ne doit JAMAIS empêcher un deploy (le script affiche alors « information
# indisponible »). Détail de la collecte : scripts/deploy-context.js.
node "$ROOT/scripts/deploy-context.js" "$ONLY" || true
echo ""

# ============================================================================
# CHEMIN FUNCTIONS — déclenchement du workflow GitHub (Workload Identity Federation)
# ============================================================================
# Plus AUCUN `firebase deploy --token` ici : le deploy prod des functions s'authentifie
# par OIDC dans GitHub Actions, sans credential local. En cas de problème (gh absent, non
# authentifié) on SORT EN ERREUR — jamais de repli silencieux sur le token.
if [ "$WANTS_FUNCTIONS" -eq 1 ]; then
  # Le workflow ne prend que deux inputs (dry_run, only) : on ne peut pas relayer des
  # arguments firebase arbitraires. Seul `--dry-run` a un équivalent (dry_run=true).
  DRY_RUN_INPUT="false"
  for arg in "$@"; do
    if [ "$arg" = "--dry-run" ]; then
      DRY_RUN_INPUT="true"
    else
      echo "🛑 ERREUR : argument '$arg' non transmissible au workflow CI." >&2
      echo "   Le chemin functions n'accepte que '--dry-run' (→ input dry_run=true)." >&2
      echo "   Pour un besoin ponctuel, lance le workflow à la main :" >&2
      echo "     gh workflow run deploy-prod.yml --ref main -f dry_run=false -f only=\"$ONLY\"" >&2
      exit 1
    fi
  done

  if ! command -v gh >/dev/null 2>&1; then
    echo "🛑 ERREUR : 'gh' (GitHub CLI) introuvable — le deploy functions passe par le CI." >&2
    echo "   → installe-le (brew install gh) puis 'gh auth login'," >&2
    echo "     ou déclenche le run depuis l'interface GitHub :" >&2
    echo "       Actions → « Deploy prod (functions) » → Run workflow (branche main)" >&2
    exit 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "🛑 ERREUR : 'gh' non authentifié." >&2
    echo "   → gh auth login" >&2
    echo "   puis relance :  scripts/deploy.sh $ONLY" >&2
    exit 1
  fi

  echo "[deploy] cible : --only $ONLY  projet : $PROJECT  (via GitHub Actions + WIF, dry_run=$DRY_RUN_INPUT)"
  gh workflow run deploy-prod.yml \
    --repo omaaouni/BERRYGOOD \
    --ref main \
    -f dry_run="$DRY_RUN_INPUT" \
    -f only="$ONLY"

  echo ""
  echo "[deploy] ✅ Run déclenché sur GitHub Actions."
  echo "[deploy] ▶️  Le run DÉMARRE immédiatement : il n'y a aucune approbation à donner"
  echo "         côté GitHub. Le déclenchement que tu viens de confirmer était le point"
  echo "         d'arrêt. Suis le run jusqu'au bout — rien ne t'attendra."
  echo ""
  echo "[deploy] Suivre le run :"
  echo "           gh run watch --repo omaaouni/BERRYGOOD"
  echo "           gh run list --repo omaaouni/BERRYGOOD --workflow deploy-prod.yml --limit 3"
  echo ""
  if [ "$DRY_RUN_INPUT" = "false" ]; then
    # Gate G6 et smoke test ne sont PAS lancés ici : le deploy est asynchrone, ils
    # tourneraient sur l'ancienne version déployée et donneraient un faux vert.
    echo "[deploy] ⚠️  APRÈS la FIN RÉELLE du run (et pas avant), lance ici :"
    echo "           node \"$ROOT/scripts/verify-deploy.js\"        # gate G6"
    echo "           BASE_URL=\"https://berrygood-farms-dashboard.web.app\" node \"$ROOT/tests/smoke-test.js\""
  fi
  exit 0
fi

# ============================================================================
# CHEMIN HOSTING — inchangé (deploy local via FIREBASE_TOKEN)
# ============================================================================
# Le token CI évite l'expiration du token de session interactif. Transitoire : la bascule
# du hosting vers WIF est un follow-up au backlog (cf. docs/deploy-wif-prod.md §7).

# Charger FIREBASE_TOKEN depuis .env
if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/.env"; set +a
fi

# Check conditionnel à la cible hosting : un deploy functions n'a plus besoin de token,
# il échouerait ici pour rien.
if [ -z "${FIREBASE_TOKEN:-}" ]; then
  echo "ERREUR : FIREBASE_TOKEN absent de .env (requis pour le deploy hosting)."
  echo "Génère-le une fois :  firebase login:ci"
  echo "Puis ajoute dans .env :  FIREBASE_TOKEN=<le_token>"
  exit 1
fi

echo "[deploy] cible : --only $ONLY  projet : $PROJECT  (via CI token)  args : ${*:-aucun}"
# Message de release Hosting = « <sha> <sujet du commit> ». C'est la SEULE trace
# consultable d'un deploy frontend : firebase-tools n'expose pas les releases du canal
# live, on les relit via l'API Hosting (cf. scripts/deploy-context.js). Sans ce message,
# il faut deviner ce qui est en ligne en comparant des numéros de cache-bust.
RELEASE_MESSAGE="$(node "$ROOT/scripts/deploy-context.js" hosting --release-message 2>/dev/null || true)"
if [ -n "$RELEASE_MESSAGE" ]; then
  set -- -m "$RELEASE_MESSAGE" "$@"
fi
# --config scope explicitement la commande sur $ROOT (même raison que preview.sh) : sans ça,
# firebase résout firebase.json/public/functions depuis le cwd du shell appelant, pas depuis
# ce script — risque de déployer le contenu d'un autre dossier que le checkout main vérifié
# ci-dessus par les garde-fous.
firebase --config "$ROOT/firebase.json" deploy --only "$ONLY" --project "$PROJECT" --token "$FIREBASE_TOKEN" --non-interactive "$@"

# Smoke test post-déploiement — vérifie le comportement de l'app en prod.
# (La gate G6 / verify-deploy.js ne concerne que les functions : sur un deploy hosting seul,
# l'updateTime des Cloud Functions n'a aucun sens. Sur le chemin functions, elle est
# annoncée à l'utilisateur pour être jouée après la fin du run CI.)
echo "[deploy] Smoke test post-déploiement (tests/smoke-test.js)..."
SMOKE_ATTEMPTS=2
SMOKE_DELAY=15
smoke_ok=1
for attempt in $(seq 1 "$SMOKE_ATTEMPTS"); do
  echo "[deploy] Smoke test — tentative $attempt/$SMOKE_ATTEMPTS (attente ${SMOKE_DELAY}s propagation)..."
  sleep "$SMOKE_DELAY"
  if BASE_URL="https://berrygood-farms-dashboard.web.app" node "$ROOT/tests/smoke-test.js"; then
    smoke_ok=0
    break
  fi
done
if [ "$smoke_ok" -ne 0 ]; then
  echo "⚠️  Smoke test post-déploiement KO après $SMOKE_ATTEMPTS tentative(s) — non bloquant, vérifier manuellement."
fi
