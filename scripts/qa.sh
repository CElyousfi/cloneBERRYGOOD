#!/usr/bin/env bash
# Gate QA locale unifiée Smart Berry — la commande unique avant commit/merge.
#   npm run qa   (ou bash scripts/qa.sh)
#
# Enchaîne : tests unitaires frontend → tests backend (tous les modules
# lib/*/__tests__) → build frontend (Babel + sentinelles) → 5 checks de
# fraîcheur des artefacts générés (module-graph, les 3 code-map-*, require-index).
# Échoue au premier problème (set -e). Note : l'étape build régénère
# public/app.js et le cache-bust de public/index.html — un diff ?v=… après
# `npm run qa` est normal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# check_graph_freshness <label> <chemin-relatif> <commande-fingerprint> <mode> <commande-regen>
#   mode = json      → fingerprint lu dans _meta.sourceFingerprint
#   mode = markdown  → fingerprint lu dans le commentaire <!-- sourceFingerprint: … -->
# Échoue si le fichier on-disk est sale (tests qui écrivent dedans) ou si le
# fingerprint commité diverge des sources actuelles. Warning non bloquant si le
# fichier n'est pas encore dans HEAD (première fois).
check_graph_freshness() {
  local label="$1" rel="$2" fp_cmd="$3" mode="$4" regen_cmd="$5"

  if [ ! -f "$ROOT/$rel" ]; then
    echo "$label: $rel absent (premiere fois — generer avec : $regen_cmd)"
    return 0
  fi

  if ! git -C "$ROOT" diff --quiet HEAD -- "$rel" 2>/dev/null; then
    echo "$label: $rel a été modifié par les tests unitaires (working tree sale)."
    echo "  Les tests d'intégration ne doivent PAS écrire dans $rel."
    echo "  Corriger les tests pour écrire dans un répertoire temporaire."
    exit 1
  fi

  local current_fp stored_fp
  current_fp=$(eval "$fp_cmd" 2>/dev/null || echo "")

  # Lire le fingerprint depuis le fichier COMMITÉ (pas le fichier on-disk qui peut être régénéré)
  if [ "$mode" = "markdown" ]; then
    stored_fp=$(git -C "$ROOT" show "HEAD:$rel" 2>/dev/null | \
      sed -n 's/^<!-- sourceFingerprint: \(.*\) -->$/\1/p' | head -1 || echo "")
  else
    stored_fp=$(git -C "$ROOT" show "HEAD:$rel" 2>/dev/null | \
      node --input-type=commonjs -e "
        let d='';
        process.stdin.on('data',function(c){d+=c});
        process.stdin.on('end',function(){
          try{var g=JSON.parse(d);process.stdout.write(g._meta&&g._meta.sourceFingerprint||'')}catch(e){}
          process.exit(0)
        })" 2>/dev/null || echo "")
  fi

  if [ -n "$current_fp" ] && [ -n "$stored_fp" ] && [ "$current_fp" != "$stored_fp" ]; then
    echo "$label: $rel est stale (fingerprint commité ne correspond pas aux sources actuelles)."
    echo "  Fingerprint commité  : $stored_fp"
    echo "  Fingerprint actuel   : $current_fp"
    echo "  Régénérer avec : $regen_cmd"
    echo "  Puis : git add $rel && git commit"
    exit 1
  elif [ -z "$stored_fp" ]; then
    echo "$label: impossible de lire le fingerprint commité (git show HEAD:$rel)"
    echo "  Vérifier que $rel est commité."
  else
    echo "$label: fingerprint OK ($current_fp)"
  fi
}

echo "== QA 1/8 — Tests unitaires frontend (tests/unit) =="
(cd "$ROOT" && npm run test:unit)

echo "== QA 2/8 — Tests backend (functions/{lib,middleware}/*/__tests__) =="
(cd "$ROOT/functions" && npm run test:all)

echo "== QA 3/8 — Build frontend (Babel + sentinelles) =="
(cd "$ROOT" && npm run build:frontend)

echo "== QA 4/8 — DIL fingerprint check (module-graph) =="
check_graph_freshness "DIL" "docs/ai/module-graph.json" \
  "node \"$ROOT/scripts/generate-module-graph.js\" --fingerprint-only" \
  "json" "node scripts/generate-module-graph.js"

echo "== QA 5/8 — Code-index fingerprint check (code-map-actions) =="
check_graph_freshness "CODE-INDEX" "docs/ai/code-map-actions.md" \
  "node \"$ROOT/scripts/generate-code-index.js\" --fingerprint-only=actions" \
  "markdown" "npm run code-index"

echo "== QA 6/8 — Code-index fingerprint check (code-map-components) =="
check_graph_freshness "CODE-INDEX" "docs/ai/code-map-components.md" \
  "node \"$ROOT/scripts/generate-code-index.js\" --fingerprint-only=components" \
  "markdown" "npm run code-index"

echo "== QA 7/8 — Code-index fingerprint check (code-map-modules) =="
check_graph_freshness "CODE-INDEX" "docs/ai/code-map-modules.md" \
  "node \"$ROOT/scripts/generate-code-index.js\" --fingerprint-only=modules" \
  "markdown" "npm run code-index"

echo "== QA 8/8 — Code-index fingerprint check (require-index) =="
check_graph_freshness "CODE-INDEX" "docs/ai/require-index.json" \
  "node \"$ROOT/scripts/generate-code-index.js\" --fingerprint-only=require-index" \
  "json" "npm run code-index"

echo "QA GATE: OK"
