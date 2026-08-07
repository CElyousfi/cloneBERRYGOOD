#!/usr/bin/env bash
# Nettoyage des worktrees dont le travail est déjà intégré (PR mergée).
#
# Le dépôt merge en squash via `gh pr merge` : les commits d'une branche
# mergée ne sont PAS forcément des ancêtres de `main` (leurs SHA changent au
# squash). `git log main..<branche>` est donc INUTILISABLE comme critère de
# "déjà intégré" — il liste des commits dont le contenu est en prod depuis
# des mois. Le seul critère fiable ici est l'état de la PR sur GitHub.
#
# Un worktree est supprimé SI ET SEULEMENT SI :
#   a) `gh pr list --head <branche> --state merged` renvoie au moins une PR
#   b) `git -C <chemin> status --porcelain` est vide, OU ne contient QUE des
#      artefacts sans valeur : public/index.html, docs/ai/module-graph.json,
#      ou un fichier verrou Excel `~$*.xlsx`
#   c) le chemin n'est ni le worktree principal, ni le répertoire courant
#
# Ce script supprime UNIQUEMENT le worktree (`git worktree remove`) — il ne
# touche à AUCUNE branche (`git branch -d/-D`). Le nettoyage des branches
# reste une étape manuelle séparée, avec sa propre vérification.
#
# Usage :
#   scripts/worktree-gc.sh              # dry-run (défaut) — ne supprime rien
#   scripts/worktree-gc.sh --dry-run    # idem, explicite
#   scripts/worktree-gc.sh --apply      # suppression réelle
set -uo pipefail

MODE="dry-run"
case "${1:-}" in
  --apply) MODE="apply" ;;
  --dry-run|"") MODE="dry-run" ;;
  *) echo "Usage: $0 [--dry-run|--apply]" >&2; exit 1 ;;
esac

ROOT="$(git rev-parse --show-toplevel)"
CURRENT_DIR="$(pwd -P)"

if ! command -v gh >/dev/null 2>&1; then
  echo "🛑 ERREUR : 'gh' (GitHub CLI) introuvable dans le PATH." >&2
  exit 1
fi

echo "[worktree-gc] mode : $MODE"
echo "[worktree-gc] repo : $ROOT"
echo

# --- Classifie l'état d'un worktree : "ghost" si le dossier est absent /
# `git status` échoue (ex. après un `git worktree repair` qui a réinscrit
# une entrée dont le dossier a été supprimé depuis) ; sinon "clean" (vide ou
# seulement des artefacts sans valeur : public/index.html,
# docs/ai/module-graph.json, verrou Excel ~$*.xlsx) ou "dirty". Le détail va
# sur stderr.
classify_status() {
  local wt_path="$1"
  local status_output status_exit
  status_output="$(git -C "$wt_path" status --porcelain 2>&1)"
  status_exit=$?
  if [ $status_exit -ne 0 ]; then
    echo "ghost"
    echo "  $status_output" >&2
    return
  fi
  echo "$status_output" | python3 -c '
import sys, re

ALLOWED = {"public/index.html", "docs/ai/module-graph.json"}
XLSX_LOCK = re.compile(r"^~\$.*\.xlsx$")

lines = [l for l in sys.stdin.read().split("\n") if l.strip()]
dirty = []
for line in lines:
    # format porcelain: "XY path" ou "XY \"path entre guillemets\""
    rest = line[3:] if len(line) > 3 else ""
    rest = rest.strip()
    if rest.startswith("\"") and rest.endswith("\"") and len(rest) >= 2:
        rest = rest[1:-1]
    basename = rest.rsplit("/", 1)[-1]
    if rest in ALLOWED or XLSX_LOCK.match(basename):
        continue
    dirty.append(line)

if dirty:
    print("dirty")
    for d in dirty:
        print("  " + d, file=sys.stderr)
else:
    print("clean")
'
}

# bash 3.2 (macOS système) n'a pas mapfile/readarray — lecture portable.
WT_LINES=()
while IFS= read -r line; do
  WT_LINES+=("$line")
done < <(git worktree list --porcelain)

# Regroupe les blocs "worktree/branch/detached" du porcelain en paires path|branch.
PATHS=()
BRANCHES=()
cur_path=""
cur_branch=""
for line in "${WT_LINES[@]}"; do
  case "$line" in
    worktree\ *)
      if [ -n "$cur_path" ]; then
        PATHS+=("$cur_path")
        BRANCHES+=("$cur_branch")
      fi
      cur_path="${line#worktree }"
      cur_branch=""
      ;;
    branch\ *)
      cur_branch="${line#branch refs/heads/}"
      ;;
  esac
done
if [ -n "$cur_path" ]; then
  PATHS+=("$cur_path")
  BRANCHES+=("$cur_branch")
fi

TOTAL_BEFORE=${#PATHS[@]}
echo "[worktree-gc] worktrees trouvés (avant, tous confondus, principal inclus) : $TOTAL_BEFORE"
echo

REMOVED_COUNT=0
declare -a KEPT_REASONS=()

for i in "${!PATHS[@]}"; do
  wt_path="${PATHS[$i]}"
  branch="${BRANCHES[$i]}"
  wt_real="$(cd "$wt_path" 2>/dev/null && pwd -P || echo "$wt_path")"

  # c) hors principal / hors répertoire courant
  if [ "$wt_real" = "$ROOT" ]; then
    continue
  fi
  if [ "$wt_real" = "$CURRENT_DIR" ]; then
    KEPT_REASONS+=("$wt_path|$branch|chemin = répertoire courant (règle c)")
    continue
  fi

  if [ -z "$branch" ]; then
    KEPT_REASONS+=("$wt_path|(detached HEAD)|pas de branche associée, impossible de vérifier la PR")
    continue
  fi

  # a) PR mergée sur cette branche
  pr_json="$(gh pr list --head "$branch" --state merged --json number 2>&1)"
  gh_exit=$?
  if [ $gh_exit -ne 0 ]; then
    KEPT_REASONS+=("$wt_path|$branch|erreur gh (API/rate-limit) : ${pr_json//$'\n'/ }")
    continue
  fi
  pr_count="$(echo "$pr_json" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null)"
  if [ -z "$pr_count" ]; then
    KEPT_REASONS+=("$wt_path|$branch|erreur gh (réponse JSON illisible) : ${pr_json//$'\n'/ }")
    continue
  fi
  if [ "$pr_count" -lt 1 ]; then
    KEPT_REASONS+=("$wt_path|$branch|aucune PR mergée trouvée")
    continue
  fi

  # b) working tree propre ou artefacts sans valeur uniquement
  status_result="$(classify_status "$wt_path" 2>/tmp/wtgc-dirty-$$.txt)"
  if [ "$status_result" = "ghost" ]; then
    detail="$(cat /tmp/wtgc-dirty-$$.txt 2>/dev/null | tr '\n' ';')"
    rm -f /tmp/wtgc-dirty-$$.txt
    KEPT_REASONS+=("$wt_path|$branch|entrée fantôme (dossier absent) :$detail")
    continue
  fi
  if [ "$status_result" != "clean" ]; then
    detail="$(cat /tmp/wtgc-dirty-$$.txt 2>/dev/null | tr '\n' ';')"
    rm -f /tmp/wtgc-dirty-$$.txt
    KEPT_REASONS+=("$wt_path|$branch|contenu non commité réel :$detail")
    continue
  fi
  rm -f /tmp/wtgc-dirty-$$.txt

  # Toutes les conditions sont réunies → suppression (ou simulation)
  if [ "$MODE" = "apply" ]; then
    if git worktree remove "$wt_path" 2>/tmp/wtgc-err-$$.txt; then
      echo "[SUPPRIMÉ] $wt_path ($branch)"
      REMOVED_COUNT=$((REMOVED_COUNT + 1))
    else
      err="$(cat /tmp/wtgc-err-$$.txt)"
      rm -f /tmp/wtgc-err-$$.txt
      KEPT_REASONS+=("$wt_path|$branch|échec git worktree remove : $err")
    fi
  else
    echo "[DRY-RUN] serait supprimé : $wt_path ($branch) — PR mergée #$pr_count trouvée(s), tree propre"
    REMOVED_COUNT=$((REMOVED_COUNT + 1))
  fi
done

echo
echo "=== Rapport ==="
echo "Worktrees avant : $TOTAL_BEFORE"
if [ "$MODE" = "apply" ]; then
  echo "Worktrees supprimés : $REMOVED_COUNT"
  echo "Worktrees après : $((TOTAL_BEFORE - REMOVED_COUNT))"
else
  echo "Worktrees qui seraient supprimés (--apply) : $REMOVED_COUNT"
  echo "Worktrees après (simulation) : $((TOTAL_BEFORE - REMOVED_COUNT))"
fi
echo
echo "Conservés (${#KEPT_REASONS[@]}) :"
for r in "${KEPT_REASONS[@]}"; do
  IFS='|' read -r p b reason <<< "$r"
  echo "  - $p [$b] : $reason"
done
