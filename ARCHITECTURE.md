# Berry Good Farms Dashboard - Architecture Technique

## Structure du Projet

```
berrygood-dashboard/
├── public/
│   └── index.html          # Application React SPA complète
├── firebase.json            # Configuration Firebase Hosting
├── .firebaserc              # Projet Firebase par défaut
├── deploy.sh                # Script de déploiement
└── ARCHITECTURE.md          # Ce fichier
```

## Profils Utilisateurs

| Profil | Utilisateur | Accès |
|--------|-------------|-------|
| Resp. RH | Responsable RH | Toutes les fermes (F1, F5, Avocatier) |
| Chef de Ferme F1 | Hamid AGOURAM | Ferme F1 uniquement |
| Chef de Ferme F1 | Tarik MAAOUNI | Ferme F1 uniquement |
| Chef de Ferme F5 | Bouchra HABCHANE | Ferme F5 uniquement |
| Chef Avocatier | Azzeddine | Avocatier uniquement |
| Resp. Achats | Achraf EL INAK | À définir |
| Resp. Qualité | FatimZahra | À définir |
| Finance | Resp. Finance | À définir |
| DG | Direction Générale | À définir |

## Onglets Profil RH & Chef de Ferme

1. **Dashboard** - KPIs effectifs par ferme avec split Récolte/Hors Récolte/Postes Fixes, Top 5 opérations, tendance semaine
2. **Pointage du jour** - Effectifs du jour vs veille avec %, cumul quinzaine
3. **Récolte** - Rendement par ouvrier (kg + prime), filtres ferme/parcelle/équipe, heures de relevé (10h-18h)
4. **Hors Récolte** - Détail opérations, avancement, statuts, performance journalière
5. **Quinzaine** - Estimation quinzaine (journées, coûts, répartition par ferme)

## Connexions Backend (À configurer)

### 1. SQL Server - BEE ONE
- **Type** : SQL Server (base de données de reporting)
- **Rafraîchissement** : Toutes les 2 heures
- **Données** : À partir du 1er Juillet 2025
- **Configuration requise** :
  - Adresse IP du serveur
  - Nom du serveur/instance
  - Identifiants de connexion
  - Noms des tables/vues de reporting
- **Implémentation** : Cloud Function Firebase ou backend Node.js avec `mssql` package

### 2. Make.com
- **Scénarios actifs à connecter** :
  - Pointage du jour avec affectations
  - Recap Tâches 10h00
  - Rendement Ouvriers (LIVE) - 10h, 12h, 14h, 16h, 18h
  - Estimation Quinzaine (email HTML)
  - Vitesse de Récolte (Récolteuse Quinzaine)
- **Configuration** : Webhooks Make.com → Firebase Firestore

### 3. Hiérarchie Fermes/Parcelles
- Sera configurée après consultation des données BEE ONE
- Certains noms de parcelles seront modifiés
- Agrégation par ferme

## NDD Suggérés
- `berrygood-dashboard.web.app` (Firebase gratuit)
- `dashboard.berrygood.ma` (domaine personnalisé)
- `app.berrygood.ma` (domaine personnalisé)

## Charte Graphique
- **Couleur primaire** : #8B2252 (Berry/Bordeaux)
- **Secondaire** : #2D8B4E (Vert agriculture)
- **Accent** : #D4A847 (Or)
- **Background** : #FFFDF8 (Crème chaud)
- **Police** : Inter

## Déploiement
```bash
# Installer Firebase CLI
npm install -g firebase-tools

# Se connecter
firebase login

# Créer le projet (console Firebase)
# Puis dans le dossier du projet :
firebase use berrygood-dashboard
firebase deploy --only hosting
```

## Phase Suivante
1. Remplacer les données mock par les données réelles SQL Server
2. Configurer les webhooks Make.com
3. Définir les tableaux de bord des profils restants (Achats, Qualité, Finance, DG)
4. Configurer la hiérarchie Fermes/Parcelles
5. Activer l'authentification Firebase (fin phase test)
