#!/usr/bin/env bash
# Mesure la durée d'un ticket : de la création du worktree à l'ouverture de sa PR.
#
# Lit le `.ticket-meta` déposé par scripts/new-ticket.sh (start=<epoch>), prend le
# createdAt de la PR via `gh` (fallback : date du dernier commit), et append une
# ligne `branche;start;end;duree_minutes` dans docs/ai/ticket-times.csv.
#
# Le CSV est écrit dans le dépôt PRINCIPAL, pas dans le worktree mesuré : le
# worktree est supprimé après merge, une mesure qui y resterait serait perdue.
#
# Idempotent : si une ligne existe déjà pour la branche, rien n'est réécrit.
#
# Usage :
#   scripts/ticket-time.sh [<chemin_du_worktree>]   # défaut : répertoire courant
set -uo pipefail

TARGET="${1:-$PWD}"

WT_ROOT="$(git -C "$TARGET" rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$WT_ROOT" ]; then
  echo "🛑 ERREUR : '$TARGET' n'est pas dans un dépôt git." >&2
  exit 1
fi

META="$WT_ROOT/.ticket-meta"
if [ ! -f "$META" ]; then
  echo "🛑 ERREUR : '$META' introuvable — worktree créé sans scripts/new-ticket.sh ?" >&2
  exit 1
fi

START="$(sed -n 's/^start=//p' "$META" | head -n 1)"
BRANCH="$(sed -n 's/^branch=//p' "$META" | head -n 1)"
[ -n "$BRANCH" ] || BRANCH="$(git -C "$WT_ROOT" branch --show-current)"

if ! [[ "$START" =~ ^[0-9]+$ ]]; then
  echo "🛑 ERREUR : 'start' absent ou illisible dans $META." >&2
  exit 1
fi
if [ -z "$BRANCH" ]; then
  echo "🛑 ERREUR : branche indéterminable pour '$WT_ROOT'." >&2
  exit 1
fi

# --- CSV dans le dépôt principal (parent du --git-common-dir).
COMMON_DIR="$(git -C "$WT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -n "$COMMON_DIR" ]; then
  MAIN_ROOT="$(dirname "$COMMON_DIR")"
else
  MAIN_ROOT="$WT_ROOT"
fi
CSV="$MAIN_ROOT/docs/ai/ticket-times.csv"

# --- Idempotence : une branche = une ligne. worktree-gc peut repasser.
if [ -f "$CSV" ] && awk -F';' -v b="$BRANCH" 'NR>1 && $1==b {found=1} END {exit !found}' "$CSV"; then
  echo "[ticket-time] $BRANCH : déjà mesuré, ligne conservée."
  exit 0
fi

# --- ISO 8601 UTC -> epoch, portable GNU (date -d) puis BSD/macOS (date -j -u -f).
iso_to_epoch() {
  local iso="$1"
  date -u -d "$iso" +%s 2>/dev/null && return 0
  date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null && return 0
  return 1
}

epoch_to_iso() {
  date -u -d "@$1" +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null && return 0
  date -j -u -r "$1" +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null && return 0
  echo "$1"
}

# `gh` résout le dépôt depuis le répertoire courant — or on peut être appelé
# depuis ailleurs (worktree-gc). On le lui passe explicitement via --repo,
# dérivé de l'URL du remote du worktree mesuré.
gh_repo_slug() {
  local url="" remote
  for remote in "${DEPLOY_REMOTE:-BERRYGOOD}" origin; do
    url="$(git -C "$WT_ROOT" remote get-url "$remote" 2>/dev/null)"
    [ -n "$url" ] && break
  done
  [ -n "$url" ] || return 1
  # https://github.com/<slug>.git et git@github.com:<slug>.git -> <slug>
  url="${url%.git}"
  url="${url#*github.com[:/]}"
  case "$url" in
    */*) echo "$url" ;;
    *) return 1 ;;
  esac
}

# --- end = createdAt de la PR ; fallback = date du dernier commit.
END=""
SOURCE="pr"
if command -v gh >/dev/null 2>&1; then
  SLUG="$(gh_repo_slug)"
  if [ -n "$SLUG" ]; then
    CREATED_AT="$(gh pr list --repo "$SLUG" --head "$BRANCH" --state all \
      --json createdAt --jq '.[0].createdAt' 2>/dev/null)"
    if [ -n "$CREATED_AT" ] && [ "$CREATED_AT" != "null" ]; then
      END="$(iso_to_epoch "$CREATED_AT")"
    fi
  fi
fi
if ! [[ "${END:-}" =~ ^[0-9]+$ ]]; then
  END="$(git -C "$WT_ROOT" log -1 --format=%ct 2>/dev/null)"
  SOURCE="commit"
fi
if ! [[ "${END:-}" =~ ^[0-9]+$ ]]; then
  echo "🛑 ERREUR : impossible de déterminer la fin du ticket (ni PR, ni commit)." >&2
  exit 1
fi

# Durée en minutes. Une valeur négative (horloge, PR d'une autre branche) est
# écrite telle quelle : mieux vaut une anomalie visible qu'une mesure maquillée.
DURATION=$(( (END - START) / 60 ))

if [ ! -f "$CSV" ]; then
  echo 'branche;start;end;duree_minutes' > "$CSV"
fi
printf '%s;%s;%s;%s\n' \
  "$BRANCH" "$(epoch_to_iso "$START")" "$(epoch_to_iso "$END")" "$DURATION" >> "$CSV"

echo "[ticket-time] $BRANCH : $DURATION min (fin = $SOURCE) -> $CSV"
