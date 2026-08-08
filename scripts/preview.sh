#!/usr/bin/env bash
# Point d'entrée unique du canal preview Smart Berry, en utilisant le CI token
# (PAS le login interactif) — même modèle que scripts/deploy.sh.
#
# Pré-requis :
#   - Être sur une feature branch (jamais main — le preview précède le merge).
#   - .env (gitignored) contient FIREBASE_TOKEN=... (généré une fois via `firebase login:ci`).
#
# Usage :
#   scripts/preview.sh
#
# Séquence : garde-fous → npm run qa → firebase hosting:channel:deploy <branche-slug>.
# Sortie finale : uniquement PREVIEW_URL=<url>, sur une ligne.
set -euo pipefail

PROJECT="berrygood-farms-dashboard"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Charger FIREBASE_TOKEN depuis .env
if [ -f "$ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/.env"; set +a
fi

if [ -z "${FIREBASE_TOKEN:-}" ]; then
  echo "ERREUR : FIREBASE_TOKEN absent de .env." >&2
  echo "Génère-le une fois :  firebase login:ci" >&2
  echo "Puis ajoute dans .env :  FIREBASE_TOKEN=<le_token>" >&2
  exit 1
fi

# === GARDE-FOUS BLOQUANTS, dans cet ordre ===
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"

# a) branche != main
if [ "$BRANCH" = "main" ]; then
  echo "🛑 ERREUR : preview interdit depuis main : le preview précède le merge, pas l'inverse." >&2
  echo "   → bascule sur ta feature branch avant de lancer le preview." >&2
  exit 1
fi

# b) branche non déjà mergée dans main
if [ -n "$(git -C "$ROOT" branch --merged main --list "$BRANCH")" ]; then
  echo "🛑 ERREUR : la branche '$BRANCH' est déjà mergée dans main." >&2
  echo "   → le preview n'a plus de sens une fois le merge fait." >&2
  exit 1
fi

# c) working tree propre
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "🛑 ERREUR : working tree NON propre (modifications ou fichiers untracked)." >&2
  echo "   État :" >&2
  git -C "$ROOT" status --short >&2
  exit 1
fi

# d) npm run qa vert (exécuté par le script, pas avant)
echo "[preview] branche : $BRANCH @ $(git -C "$ROOT" rev-parse --short HEAD)"
echo "[preview] garde-fous OK — lancement de npm run qa..."
if ! (cd "$ROOT" && npm run qa); then
  echo "🛑 ERREUR : npm run qa a échoué. Corrige avant de relancer le preview." >&2
  exit 1
fi
echo "[preview] ✓ npm run qa vert"

# Avertissement (non bloquant) si la branche touche functions/ : le canal preview
# sert le frontend nouveau mais appelle les Cloud Functions déjà en PROD.
if ! git -C "$ROOT" diff --quiet main..."$BRANCH" -- functions/; then
  echo "⚠ Cette branche modifie functions/. Le canal preview appellera les" >&2
  echo "  fonctions de PRODUCTION. Déploie les functions avant, ou sache que" >&2
  echo "  le preview ne teste pas le backend modifié." >&2
fi

# Nom du canal = branche slugifiée (évite les collisions entre tickets parallèles)
CHANNEL="$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+|-+$//g')"
if [ -z "$CHANNEL" ]; then
  echo "🛑 ERREUR : impossible de slugifier la branche '$BRANCH' en nom de canal valide." >&2
  exit 1
fi

echo "[preview] déploiement hosting sur le canal '$CHANNEL' (expire 1d)..."
# --config scope explicitement la commande sur $ROOT, indépendamment du cwd de l'invocateur :
# sans ça, firebase résout firebase.json/public/ depuis le cwd du shell appelant, pas depuis
# ce script — un run depuis un autre dossier (ex. le repo principal en dehors du worktree)
# déploierait le contenu de CE dossier-là, pas celui du worktree/branche qu'on croit tester.
DEPLOY_OUTPUT="$(firebase --config "$ROOT/firebase.json" hosting:channel:deploy "$CHANNEL" --expires 1d --project "$PROJECT" --token "$FIREBASE_TOKEN" --non-interactive)"
echo "$DEPLOY_OUTPUT" >&2

PREVIEW_URL="$(echo "$DEPLOY_OUTPUT" | grep -Eo 'https://[a-zA-Z0-9.-]+\.web\.app[a-zA-Z0-9./_-]*' | tail -1)"
if [ -z "$PREVIEW_URL" ]; then
  echo "🛑 ERREUR : impossible d'extraire l'URL du preview depuis la sortie firebase." >&2
  exit 1
fi

echo "PREVIEW_URL=$PREVIEW_URL"
