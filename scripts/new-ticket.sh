#!/usr/bin/env bash
# Bootstrap un worktree de ticket : sb/<slug>, sibling de la racine du repo,
# .env en lien symbolique, dépendances installées (racine + functions/).
#
# Reproduit exactement la procédure manuelle de CLAUDE.md (§ Discipline
# worktree) : un ticket = un worktree = une branche `sb/<ticket-id>`.
#
# Usage :
#   scripts/new-ticket.sh <slug>
#
# <slug> : minuscules/chiffres/tirets uniquement (ex. mon-ticket).
set -euo pipefail

SLUG="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_REMOTE:-BERRYGOOD}"

if [ -z "$SLUG" ]; then
  echo "🛑 ERREUR : slug manquant." >&2
  echo "   Usage : scripts/new-ticket.sh <slug>" >&2
  exit 1
fi

if [[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "🛑 ERREUR : slug invalide '$SLUG' — attendu : minuscules, chiffres, tirets uniquement ([a-z0-9-]+)." >&2
  exit 1
fi

WT_PATH="$(dirname "$ROOT")/$SLUG"

if [ -e "$WT_PATH" ]; then
  echo "🛑 ERREUR : '$WT_PATH' existe déjà." >&2
  exit 1
fi

if git -C "$ROOT" show-ref --verify --quiet "refs/heads/sb/$SLUG"; then
  echo "🛑 ERREUR : la branche locale 'sb/$SLUG' existe déjà." >&2
  exit 1
fi

if git -C "$ROOT" ls-remote --exit-code --heads "$REMOTE" "sb/$SLUG" >/dev/null 2>&1; then
  echo "🛑 ERREUR : la branche 'sb/$SLUG' existe déjà sur le remote '$REMOTE'." >&2
  exit 1
fi

echo "[new-ticket] fetch $REMOTE main..."
if ! git -C "$ROOT" fetch "$REMOTE" main --quiet; then
  echo "🛑 ERREUR : impossible de fetch '$REMOTE' (remote injoignable ?). Override : DEPLOY_REMOTE=<nom>." >&2
  exit 1
fi

git -C "$ROOT" worktree add "$WT_PATH" -b "sb/$SLUG" "$REMOTE/main"

if [ -f "$ROOT/.env" ]; then
  ln -s "$ROOT/.env" "$WT_PATH/.env"
else
  echo "⚠ [new-ticket] pas de .env à la racine du dépôt principal — worktree créé sans .env." >&2
fi

echo "[new-ticket] npm install (racine)…"
( cd "$WT_PATH" && npm install )
echo "[new-ticket] npm install (functions/)…"
( cd "$WT_PATH/functions" && npm install )

echo "WORKTREE=$WT_PATH"
echo "BRANCH=sb/$SLUG"
