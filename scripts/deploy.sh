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

echo "[deploy] branche : $(git -C "$ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$ROOT" rev-parse --short HEAD)"
echo "[deploy] cible : --only $ONLY  projet : $PROJECT  (via CI token)  args : ${*:-aucun}"
firebase deploy --only "$ONLY" --project "$PROJECT" --token "$FIREBASE_TOKEN" --non-interactive "$@"
