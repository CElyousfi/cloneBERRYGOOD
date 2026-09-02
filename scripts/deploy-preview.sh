#!/usr/bin/env bash
# ⛔ CHEMIN RETIRÉ — utiliser scripts/preview.sh.
#
# POURQUOI CE SCRIPT NE DÉPLOIE PLUS RIEN
# ---------------------------------------
# Il déployait le canal `qa-test` SANS AUCUN garde-fou : ni working tree propre,
# ni `npm run qa`, ni `--config` (donc firebase résolvait firebase.json depuis le
# cwd de l'appelant, pas depuis le checkout), ni la moindre vérification que les
# Cloud Functions de PROD correspondent au code testé. C'était un chemin parallèle
# vers exactement le même canal que scripts/preview.sh : tous les garde-fous de
# preview.sh étaient contournables en une commande, y compris le mode
# --post-merge qui existe précisément pour empêcher qu'un frontend neuf soit
# validé contre un ancien backend.
#
# Il n'était référencé nulle part (ni script, ni doc, ni package.json) : seul un
# appel à la main pouvait l'emprunter. On refuse plutôt que de supprimer, pour
# que cet appel-là reçoive une redirection explicite au lieu d'un « command not
# found » silencieux.
#
# ÉQUIVALENTS
#   - preview d'une feature branch (avant merge) :  scripts/preview.sh
#   - canal QA après merge d'un lot mixte back+front :
#         scripts/deploy.sh functions        # puis attendre la FIN du run CI
#         scripts/preview.sh --post-merge [nom-canal]
set -euo pipefail

echo "🛑 scripts/deploy-preview.sh est retiré : il déployait un canal de preview" >&2
echo "   SANS garde-fou (tree propre, npm run qa, --config, backend à jour)." >&2
echo "" >&2
echo "   → preview d'une feature branch (avant le merge) :" >&2
echo "       scripts/preview.sh" >&2
echo "" >&2
echo "   → canal QA après le merge d'un lot mixte back+front :" >&2
echo "       scripts/deploy.sh functions        # puis attendre la FIN du run CI" >&2
echo "       scripts/preview.sh --post-merge ${1:+$1}" >&2
exit 1
