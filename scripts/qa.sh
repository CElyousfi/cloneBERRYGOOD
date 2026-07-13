#!/usr/bin/env bash
# Gate QA locale unifiée Smart Berry — la commande unique avant commit/merge.
#   npm run qa   (ou bash scripts/qa.sh)
#
# Enchaîne : tests unitaires frontend → tests backend (tous les modules
# lib/*/__tests__) → build frontend (Babel + sentinelles).
# Échoue au premier problème (set -e). Note : l'étape build régénère
# public/app.js et le cache-bust de public/index.html — un diff ?v=… après
# `npm run qa` est normal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== QA 1/3 — Tests unitaires frontend (tests/unit) =="
(cd "$ROOT" && npm run test:unit)

echo "== QA 2/3 — Tests backend (functions/lib/*/__tests__) =="
(cd "$ROOT/functions" && npm run test:all)

echo "== QA 3/3 — Build frontend (Babel + sentinelles) =="
(cd "$ROOT" && npm run build:frontend)

echo "== QA 4/4 — DIL fingerprint check =="
DIL_GRAPH="$ROOT/docs/ai/module-graph.json"
if [ -f "$DIL_GRAPH" ]; then
  CURRENT_FP=$(node "$ROOT/scripts/generate-module-graph.js" --fingerprint-only 2>/dev/null || echo "")
  STORED_FP=$(node -e "try{const g=require('$DIL_GRAPH');console.log(g._meta&&g._meta.sourceFingerprint||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
  if [ -n "$CURRENT_FP" ] && [ "$CURRENT_FP" != "$STORED_FP" ]; then
    echo "DIL: module-graph.json est stale (fingerprint ne correspond pas aux sources actuelles)."
    echo "  Régénérer avec : node scripts/generate-module-graph.js"
    echo "  Puis : git add docs/ai/module-graph.json && git commit"
    exit 1
  else
    echo "DIL: fingerprint OK"
  fi
else
  echo "DIL: module-graph.json absent (premiere fois — generer avec : node scripts/generate-module-graph.js)"
fi

echo "QA GATE: OK"
