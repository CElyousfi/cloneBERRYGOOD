#!/bin/bash
# ==============================================
# Berry Good Farms Dashboard - Deployment Script
# ==============================================
#
# Prérequis :
#   1. Node.js installé (https://nodejs.org/)
#   2. Firebase CLI : npm install -g firebase-tools
#   3. Être connecté : firebase login
#
# NDD suggéré : berrygood-dashboard.web.app
# Alternatives : berrygood-farms-app.web.app, berrygood-reporting.web.app
#
# Usage : ./deploy.sh
# ==============================================

echo "🫐 Berry Good Farms Dashboard - Déploiement"
echo "============================================="

# Vérifier Firebase CLI
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI non trouvé. Installation..."
    npm install -g firebase-tools
fi

# Login si nécessaire
firebase login --no-localhost 2>/dev/null

# Créer le projet Firebase (à faire une seule fois)
echo ""
echo "📋 Pour créer un nouveau projet Firebase :"
echo "   1. Allez sur https://console.firebase.google.com"
echo "   2. Créez un projet 'berrygood-dashboard'"
echo "   3. Activez Hosting dans la console"
echo ""

# Configurer le projet
read -p "ID du projet Firebase (ex: berrygood-dashboard): " PROJECT_ID
firebase use $PROJECT_ID

# Déployer
echo "🚀 Déploiement en cours..."
firebase deploy --only hosting

echo ""
echo "✅ Déploiement terminé !"
echo "🌐 URL: https://$PROJECT_ID.web.app"
echo ""
echo "📌 Prochaines étapes :"
echo "   - Configurer le domaine personnalisé (NDD)"
echo "   - Connecter la base SQL Server BEE ONE"
echo "   - Configurer les webhooks Make.com"
echo "   - Activer l'authentification Firebase"
