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

echo "QA GATE: OK ✅"
