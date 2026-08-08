#!/usr/bin/env bash
# Deploy Smart Berry depuis main, en utilisant le CI token (PAS le login interactif).
#
# Pré-requis :
#   - Être sur un checkout propre de `main` (règle CLAUDE.md : deploy depuis main uniquement).
#   - .env (gitignored) contient FIREBASE_TOKEN=... (généré une fois via `firebase login:ci`).
#
# Usage :
#   scripts/deploy.sh hosting,functions     # deploy ciblé
#   scripts/deploy.sh hosting               # frontend seul
#   scripts/deploy.sh functions             # backend seul
#   scripts/deploy.sh hosting --dry-run     # validation sans déployer
# Tout argument après la cible est transmis tel quel à `firebase deploy`.
#
# Le token CI évite l'expiration du token de session interactif.
set -euo pipefail

ONLY="${1:-hosting,functions}"
shift || true   # le reste ("$@") est transmis à firebase deploy (ex. --dry-run)
PROJECT="berrygood-farms-dashboard"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Charger FIREBASE_TOKEN depuis .env
if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/.env"; set +a
fi

if [ -z "${FIREBASE_TOKEN:-}" ]; then
  echo "ERREUR : FIREBASE_TOKEN absent de .env."
  echo "Génère-le une fois :  firebase login:ci"
  echo "Puis ajoute dans .env :  FIREBASE_TOKEN=<le_token>"
  exit 1
fi

# === RÈGLES ANTI-DIVERGENCE (CLAUDE.md) — garde-fous bloquants avant tout deploy ===
# (a) working tree propre  (b) branche = main  (c) main à jour avec le remote.
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
echo "[deploy] cible : --only $ONLY  projet : $PROJECT  (via CI token)  args : ${*:-aucun}"
# --config scope explicitement la commande sur $ROOT (même raison que preview.sh) : sans ça,
# firebase résout firebase.json/public/functions depuis le cwd du shell appelant, pas depuis
# ce script — risque de déployer le contenu d'un autre dossier que le checkout main vérifié
# ci-dessus par les garde-fous.
firebase --config "$ROOT/firebase.json" deploy --only "$ONLY" --project "$PROJECT" --token "$FIREBASE_TOKEN" --non-interactive "$@"

# Gate G6 — vérification post-déploiement (avertissement uniquement tant que
# DEPLOY_VERIFY_STRICT n'est pas activé). Ne bloque jamais deploy.sh par défaut.
case "$ONLY" in
  *functions*)
    echo "[deploy] Gate G6 — vérification post-déploiement functions..."
    node "$ROOT/scripts/verify-deploy.js" || true

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
    ;;
esac
