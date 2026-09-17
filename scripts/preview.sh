#!/usr/bin/env bash
# Point d'entrée unique du canal preview Smart Berry, en utilisant le CI token
# (PAS le login interactif) — même modèle que scripts/deploy.sh.
#
# DEUX MODES, volontairement disjoints :
#
#   1. MODE NORMAL (par défaut) — le preview PRÉCÈDE le merge.
#      Pré-requis : être sur une feature branch non mergée, tree propre, qa vert.
#      Canal = nom de la branche slugifié.
#
#        scripts/preview.sh
#
#   2. MODE POST-MERGE (--post-merge) — le preview SUIT le merge.
#      Pour un lot MIXTE back+front : un canal de preview sert le nouveau
#      frontend mais appelle les Cloud Functions de PRODUCTION. Tant que les
#      functions ne sont pas déployées, le canal ne teste pas le lot. L'ordre
#      correct devient donc : merge → scripts/deploy.sh functions → CE MODE →
#      validation visuelle → scripts/deploy.sh hosting. Le merge précédant le
#      preview, les garde-fous du mode normal (branche ≠ main, branche non
#      mergée) sont inapplicables : ce mode les REMPLACE par les siens, il ne
#      les affaiblit pas.
#      Pré-requis : être SUR main, main == BERRYGOOD/main, tree propre,
#      functions de prod à jour avec HEAD, qa vert.
#      Canal = `qa-test` par défaut, surchargeable.
#
#        scripts/preview.sh --post-merge
#        scripts/preview.sh --post-merge mon-canal
#
# Pré-requis commun :
#   - .env (gitignored) contient FIREBASE_TOKEN=... (généré une fois via `firebase login:ci`).
#
# Séquence : garde-fous → npm run qa → firebase hosting:channel:deploy <canal>.
# Sortie finale : uniquement PREVIEW_URL=<url>, sur une ligne.
#
# Tests : tests/unit/previewExitCode.test.js (propagation du code de sortie) et
# tests/unit/previewPostMerge.test.js (les 4 refus du mode --post-merge + la
# non-régression du mode normal). Les deux pilotent le VRAI script dans un bac à
# sable hermétique, avec `firebase`/`npm`/`gh` stubbés — aucun deploy réel.
set -euo pipefail

PROJECT="berrygood-farms-dashboard"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_REMOTE:-BERRYGOOD}"

# === Arguments ===
POST_MERGE=0
CHANNEL_ARG=""
for arg in "$@"; do
  case "$arg" in
    --post-merge) POST_MERGE=1 ;;
    -*)
      echo "🛑 ERREUR : option inconnue '$arg'." >&2
      echo "   Usage : scripts/preview.sh  |  scripts/preview.sh --post-merge [nom-canal]" >&2
      exit 1
      ;;
    *)
      if [ -n "$CHANNEL_ARG" ]; then
        echo "🛑 ERREUR : un seul nom de canal attendu (reçu '$CHANNEL_ARG' puis '$arg')." >&2
        exit 1
      fi
      CHANNEL_ARG="$arg"
      ;;
  esac
done
if [ "$POST_MERGE" -eq 0 ] && [ -n "$CHANNEL_ARG" ]; then
  echo "🛑 ERREUR : le nom de canal n'est acceptable qu'en mode --post-merge." >&2
  echo "   En mode normal le canal est TOUJOURS la branche slugifiée (évite les" >&2
  echo "   collisions entre tickets parallèles)." >&2
  exit 1
fi

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

if [ "$POST_MERGE" -eq 0 ]; then
  # a) branche != main
  if [ "$BRANCH" = "main" ]; then
    echo "🛑 ERREUR : preview interdit depuis main : le preview précède le merge, pas l'inverse." >&2
    echo "   → bascule sur ta feature branch avant de lancer le preview." >&2
    echo "   → lot MIXTE back+front déjà mergé ? c'est le cas de --post-merge :" >&2
    echo "     scripts/preview.sh --post-merge" >&2
    exit 1
  fi

  # b) branche non déjà mergée dans main
  if [ -n "$(git -C "$ROOT" branch --merged main --list "$BRANCH")" ]; then
    echo "🛑 ERREUR : la branche '$BRANCH' est déjà mergée dans main." >&2
    echo "   → le preview n'a plus de sens une fois le merge fait." >&2
    exit 1
  fi
else
  # a') MODE POST-MERGE : branche = main, exactement l'inverse du mode normal.
  if [ "$BRANCH" != "main" ]; then
    echo "🛑 ERREUR (--post-merge) : ce mode déploie le canal QA depuis 'main', APRÈS le merge." >&2
    echo "   Branche actuelle : '$BRANCH'." >&2
    echo "   → merge d'abord, puis bascule sur main ; ou lance le preview normal" >&2
    echo "     depuis ta feature branch (sans --post-merge)." >&2
    exit 1
  fi

  # b') main à jour avec le remote : rien de local non poussé. Sans ça, le canal
  #     QA servirait un frontend qui n'existe nulle part ailleurs — donc validé
  #     visuellement puis introuvable au moment du deploy prod.
  echo "[preview] fetch $REMOTE pour vérifier la synchro de main avec le remote..."
  if git -C "$ROOT" fetch "$REMOTE" main --quiet 2>/dev/null; then
    LOCAL_SHA="$(git -C "$ROOT" rev-parse main)"
    REMOTE_SHA="$(git -C "$ROOT" rev-parse "$REMOTE/main")"
    if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
      echo "🛑 ERREUR (--post-merge) : main local ($(git -C "$ROOT" rev-parse --short main)) ≠ $REMOTE/main ($(git -C "$ROOT" rev-parse --short "$REMOTE/main"))." >&2
      echo "   → push/pull pour aligner main avec $REMOTE avant de déployer le canal QA." >&2
      exit 1
    fi
  else
    echo "🛑 ERREUR (--post-merge) : impossible de fetch '$REMOTE' (remote injoignable ?). Override : DEPLOY_REMOTE=<nom>." >&2
    exit 1
  fi
fi

# c) working tree propre
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "🛑 ERREUR : working tree NON propre (modifications ou fichiers untracked)." >&2
  echo "   État :" >&2
  git -C "$ROOT" status --short >&2
  exit 1
fi

# c') MODE POST-MERGE : les functions déployées en prod correspondent à HEAD.
#     C'est LE garde-fou qui donne son sens au mode : déployer un canal QA sur un
#     backend périmé reproduit exactement le problème qu'on cherche à éviter (un
#     frontend neuf qui parle à d'anciennes Cloud Functions), en pire — cette fois
#     personne ne s'en méfie, puisque le mode existe pour ce cas.
#     Source de vérité UNIQUE : scripts/deploy-context.js, déjà utilisé par
#     scripts/deploy.sh pour la section « Transparence ». Pas de 2e source.
#     ⚠️ `--last-sha` n'accepte QUE les runs qui ont réellement déployé tout
#     functions/ : un run `--dry-run` (le défaut du workflow) réussit
#     intégralement sans rien déployer, et un `functions:<uneFonction>` ne
#     déploie qu'une function. Les créditer ici donnerait un « ✓ functions prod
#     == HEAD » mensonger — le faux vert que ce mode existe pour empêcher.
if [ "$POST_MERGE" -eq 1 ]; then
  echo "[preview] vérification : les functions de prod correspondent-elles à HEAD ?"
  HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
  # Fail-closed : information indisponible (gh absent/non authentifié, réseau,
  # aucun deploy RÉEL récent) = refus. On ne peut pas PROUVER que le backend est
  # à jour, donc on ne déploie pas.
  LAST_SHA_ERR="$(mktemp)"
  if ! DEPLOYED_SHA="$(node "$ROOT/scripts/deploy-context.js" functions --last-sha 2>"$LAST_SHA_ERR")"; then
    echo "🛑 ERREUR (--post-merge) : impossible de déterminer le dernier deploy functions RÉEL." >&2
    echo "   raison : $(cat "$LAST_SHA_ERR")" >&2
    rm -f "$LAST_SHA_ERR"
    echo "   → 'gh' installé et authentifié ? réseau OK ? un vrai deploy a-t-il eu lieu" >&2
    echo "     (scripts/deploy.sh functions SANS --dry-run, cible 'functions' entière) ?" >&2
    echo "     Sans cette information, rien ne prouve que le canal QA parlera au bon backend." >&2
    exit 1
  fi
  rm -f "$LAST_SHA_ERR"
  DEPLOYED_SHA="$(echo "$DEPLOYED_SHA" | tr -d '[:space:]')"
  if [ "$DEPLOYED_SHA" != "$HEAD_SHA" ]; then
    if ! git -C "$ROOT" cat-file -e "$DEPLOYED_SHA^{commit}" 2>/dev/null; then
      echo "🛑 ERREUR (--post-merge) : le commit functions déployé ($DEPLOYED_SHA) est absent du dépôt local." >&2
      echo "   → git fetch $REMOTE, puis relance." >&2
      exit 1
    fi
    # Deployé ≠ HEAD n'est pas forcément un retard FONCTIONNEL : si aucun commit
    # de l'intervalle ne touche functions/, le backend en prod est le bon code.
    if ! git -C "$ROOT" diff --quiet "$DEPLOYED_SHA" HEAD -- functions/; then
      echo "🛑 ERREUR (--post-merge) : les functions déployées en prod sont EN RETARD sur HEAD." >&2
      echo "   prod  : $(git -C "$ROOT" rev-parse --short "$DEPLOYED_SHA")" >&2
      echo "   HEAD  : $(git -C "$ROOT" rev-parse --short HEAD)" >&2
      echo "   → déploie le backend d'abord, ATTENDS la fin réelle du run, puis relance :" >&2
      echo "       scripts/deploy.sh functions" >&2
      echo "       gh run watch --repo omaaouni/BERRYGOOD" >&2
      exit 1
    fi
    echo "[preview] ✓ functions prod @ $(git -C "$ROOT" rev-parse --short "$DEPLOYED_SHA") — functions/ inchangé jusqu'à HEAD"
  else
    echo "[preview] ✓ functions prod == HEAD ($(git -C "$ROOT" rev-parse --short HEAD))"
  fi
fi

# d) npm run qa vert (exécuté par le script, pas avant). La gate inclut
#    `npm run build` : public/app.modular.js et public/chunks/ (gitignorés) sont
#    régénérés ici, avant le deploy du canal — jamais repris d'un build antérieur.
echo "[preview] branche : $BRANCH @ $(git -C "$ROOT" rev-parse --short HEAD)"
echo "[preview] garde-fous OK — lancement de npm run qa..."
if ! (cd "$ROOT" && npm run qa); then
  echo "🛑 ERREUR : npm run qa a échoué. Corrige avant de relancer le preview." >&2
  exit 1
fi
echo "[preview] ✓ npm run qa vert"

# Avertissement (non bloquant) si la branche touche functions/ : le canal preview
# sert le frontend nouveau mais appelle les Cloud Functions déjà en PROD.
# Inutile en --post-merge : le garde-fou (c') l'a déjà VÉRIFIÉ, en bloquant.
if [ "$POST_MERGE" -eq 0 ] && ! git -C "$ROOT" diff --quiet main..."$BRANCH" -- functions/; then
  echo "⚠ Cette branche modifie functions/. Le canal preview appellera les" >&2
  echo "  fonctions de PRODUCTION. Déploie les functions avant, ou sache que" >&2
  echo "  le preview ne teste pas le backend modifié." >&2
fi

# Nom du canal :
#   - mode normal    : branche slugifiée (évite les collisions entre tickets parallèles) ;
#   - mode post-merge: 'qa-test' par défaut (la branche vaut 'main' — un canal
#     nommé 'main' serait trompeur), surchargeable en argument.
# Slugification et validation identiques dans les deux cas.
if [ "$POST_MERGE" -eq 1 ]; then
  CHANNEL_SOURCE="${CHANNEL_ARG:-qa-test}"
else
  CHANNEL_SOURCE="$BRANCH"
fi
CHANNEL="$(echo "$CHANNEL_SOURCE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+|-+$//g')"
if [ -z "$CHANNEL" ]; then
  echo "🛑 ERREUR : impossible de slugifier '$CHANNEL_SOURCE' en nom de canal valide." >&2
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
