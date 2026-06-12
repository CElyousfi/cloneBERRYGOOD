#!/usr/bin/env bash
# ⚠️ DÉPRÉCIÉ — l'ancien script interactif (firebase login + prompt projet) est retiré
# car il contournait les RÈGLES ANTI-DIVERGENCE (cf. CLAUDE.md).
#
# Le SEUL point d'entrée de deploy est scripts/deploy.sh, qui applique les garde-fous :
#   (a) working tree propre  (b) branche = main  (c) main à jour avec le remote.
#
# Ce wrapper redirige pour qu'aucun deploy ne puisse bypasser ces checks.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/scripts/deploy.sh" "$@"
