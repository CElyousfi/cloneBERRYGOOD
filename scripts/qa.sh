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
  # Vérifier que les tests n'ont pas modifié le fichier on-disk (working tree propre)
  if ! git -C "$ROOT" diff --quiet HEAD -- docs/ai/module-graph.json 2>/dev/null; then
    echo "DIL: docs/ai/module-graph.json a été modifié par les tests unitaires (working tree sale)."
    echo "  Les tests d'intégration ne doivent PAS écrire dans docs/ai/module-graph.json."
    echo "  Corriger les tests pour écrire dans un répertoire temporaire."
    exit 1
  fi

  CURRENT_FP=$(node "$ROOT/scripts/generate-module-graph.js" --fingerprint-only 2>/dev/null || echo "")

  # Lire le fingerprint depuis le graphe COMMITÉ (pas le fichier on-disk qui peut être régénéré)
  STORED_FP=$(git -C "$ROOT" show HEAD:docs/ai/module-graph.json 2>/dev/null | \
    node --input-type=commonjs -e "
      let d='';
      process.stdin.on('data',function(c){d+=c});
      process.stdin.on('end',function(){
        try{var g=JSON.parse(d);process.stdout.write(g._meta&&g._meta.sourceFingerprint||'')}catch(e){}
        process.exit(0)
      })" 2>/dev/null || echo "")

  if [ -n "$CURRENT_FP" ] && [ -n "$STORED_FP" ] && [ "$CURRENT_FP" != "$STORED_FP" ]; then
    echo "DIL: module-graph.json est stale (fingerprint commité ne correspond pas aux sources actuelles)."
    echo "  Fingerprint commité  : $STORED_FP"
    echo "  Fingerprint actuel   : $CURRENT_FP"
    echo "  Régénérer avec : node scripts/generate-module-graph.js"
    echo "  Puis : git add docs/ai/module-graph.json && git commit"
    exit 1
  elif [ -z "$STORED_FP" ]; then
    echo "DIL: impossible de lire le fingerprint commité (git show HEAD:docs/ai/module-graph.json)"
    echo "  Vérifier que docs/ai/module-graph.json est commité."
  else
    echo "DIL: fingerprint OK ($CURRENT_FP)"
  fi
else
  echo "DIL: module-graph.json absent (premiere fois — generer avec : node scripts/generate-module-graph.js)"
fi

echo "QA GATE: OK"
