#!/usr/bin/env bash
# Deploy hosting sur un preview channel Firebase (pas prod), via le CI token.
#
# Usage :
#   scripts/deploy-preview.sh [channel] [expires]
#   scripts/deploy-preview.sh qa-test 1d   (défaut)
#
# Mêmes garde-fous que scripts/deploy.sh (main propre, à jour) SAUF que le
# preview n'écrit rien en prod — la branche courante n'a donc pas besoin
# d'être main. Le token est chargé depuis .env, jamais affiché.
set -euo pipefail

CHANNEL="${1:-qa-test}"
EXPIRES="${2:-1d}"
PROJECT="berrygood-farms-dashboard"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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

echo "[deploy-preview] branche : $(git -C "$ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$ROOT" rev-parse --short HEAD)"
echo "[deploy-preview] channel : $CHANNEL  expires : $EXPIRES  projet : $PROJECT (via CI token)"
firebase hosting:channel:deploy "$CHANNEL" --expires "$EXPIRES" --project "$PROJECT" --token "$FIREBASE_TOKEN" --non-interactive
