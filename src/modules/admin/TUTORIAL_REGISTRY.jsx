/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: admin | Déclaration(s): TUTORIAL_REGISTRY */


// ===================== TUTORIAL REGISTRY =====================
        const TUTORIAL_REGISTRY = {
            achats: [
                {
                    id: 'creer-da', title: 'Créer une Demande d\'Achat', icon: 'fa-file-pen',
                    description: 'Apprenez à créer et soumettre une demande d\'achat',
                    steps: [
                        { element: '[data-tour="nav-achats-da"]', requiredTab: null, popover: { title: '1. Accéder aux Demandes d\'Achat', description: 'Cliquez sur "Demandes d\'Achat" dans le menu pour accéder à la liste des DA.', side: 'right' }},
                        { element: '[data-tour="btn-new-da"]', requiredTab: 'achats_da', popover: { title: '2. Nouvelle Demande', description: 'Cliquez sur ce bouton pour ouvrir le formulaire de création d\'une nouvelle DA.', side: 'bottom' }},
                        { element: '[data-tour="da-form-ferme"]', requiredTab: 'achats_da', waitForModal: true, popover: { title: '3. Sélectionner la Ferme', description: 'Choisissez la ferme concernée par la demande (F1, F5 ou Avocatier).', side: 'right' }},
                        { element: '[data-tour="da-form-urgence"]', requiredTab: 'achats_da', waitForModal: true, popover: { title: '4. Niveau d\'urgence', description: 'Indiquez le niveau d\'urgence : normale, urgente ou critique.', side: 'right' }},
                        { element: '[data-tour="da-form-items"]', requiredTab: 'achats_da', waitForModal: true, popover: { title: '5. Ajouter les articles', description: 'Ajoutez les articles demandés avec la désignation, quantité et unité. Cliquez "Ajouter une ligne" pour plus d\'articles.', side: 'top' }},
                        { element: '[data-tour="da-form-submit"]', requiredTab: 'achats_da', waitForModal: true, popover: { title: '6. Soumettre la demande', description: 'Cliquez "Soumettre" pour envoyer la DA au responsable achats pour traitement.', side: 'top' }},
                    ]
                },
                {
                    id: 'generer-bdc', title: 'Générer un Bon de Commande', icon: 'fa-file-contract',
                    description: 'Créez un BDC à partir d\'une demande d\'achat validée',
                    steps: [
                        { element: '[data-tour="nav-achats-bdc"]', requiredTab: null, popover: { title: '1. Accéder aux Bons de Commande', description: 'Cliquez sur "Bons de Commande" dans le menu latéral.', side: 'right' }},
                        { element: '[data-tour="btn-new-bdc"]', requiredTab: 'achats_bdc', popover: { title: '2. Nouveau BDC', description: 'Cliquez ici pour créer un nouveau Bon de Commande.', side: 'bottom' }},
                        { element: '[data-tour="bdc-form-supplier"]', requiredTab: 'achats_bdc', waitForModal: true, popover: { title: '3. Sélectionner le fournisseur', description: 'Choisissez un fournisseur existant ou saisissez les informations d\'un nouveau fournisseur.', side: 'right' }},
                        { element: '[data-tour="bdc-form-items"]', requiredTab: 'achats_bdc', waitForModal: true, popover: { title: '4. Articles commandés', description: 'Ajoutez les articles avec désignation, quantité, prix unitaire. Le total se calcule automatiquement.', side: 'top' }},
                        { element: '[data-tour="bdc-form-submit"]', requiredTab: 'achats_bdc', waitForModal: true, popover: { title: '5. Enregistrer le BDC', description: 'Enregistrez le bon en brouillon ou soumettez-le directement pour validation.', side: 'top' }},
                    ]
                },
                {
                    id: 'suivi-paiements', title: 'Suivre les Paiements', icon: 'fa-credit-card',
                    description: 'Consultez et gérez le suivi des paiements fournisseurs',
                    steps: [
                        { element: '[data-tour="nav-achats-paiements"]', requiredTab: null, popover: { title: '1. Accéder aux Paiements', description: 'Cliquez sur "Paiements" pour voir tous les paiements en cours.', side: 'right' }},
                        { element: '[data-tour="paiements-filters"]', requiredTab: 'achats_paiements', popover: { title: '2. Filtrer les paiements', description: 'Utilisez les filtres pour trier par statut (en attente, validé, payé) ou par fournisseur.', side: 'bottom' }},
                        { element: '[data-tour="paiements-list"]', requiredTab: 'achats_paiements', popover: { title: '3. Liste des paiements', description: 'Consultez les détails de chaque paiement : montant, fournisseur, date d\'échéance et statut.', side: 'top' }},
                    ]
                },
            ],
            qualite: [
                {
                    id: 'creer-bon-apport', title: 'Créer un Bon d\'Apport', icon: 'fa-file-invoice',
                    description: 'Enregistrez un nouveau bon d\'apport pour la récolte',
                    steps: [
                        { element: '[data-tour="nav-qualite-bons-apport"]', requiredTab: null, popover: { title: '1. Accéder aux Bons d\'Apport', description: 'Cliquez sur "Bons d\'Apport" dans le menu Qualité.', side: 'right' }},
                        { element: '[data-tour="btn-new-bon-apport"]', requiredTab: 'qualite_bons_apport', popover: { title: '2. Nouveau Bon d\'Apport', description: 'Cliquez sur ce bouton pour créer un nouveau bon d\'apport.', side: 'bottom' }},
                        { element: '[data-tour="bon-form-variete"]', requiredTab: 'qualite_bons_apport', waitForModal: true, popover: { title: '3. Sélectionner la variété', description: 'Choisissez la variété de fruit concernée (framboise, myrtille, etc.).', side: 'right' }},
                        { element: '[data-tour="bon-form-poids"]', requiredTab: 'qualite_bons_apport', waitForModal: true, popover: { title: '4. Saisir le poids', description: 'Entrez le poids total en kg de l\'apport.', side: 'right' }},
                        { element: '[data-tour="bon-form-submit"]', requiredTab: 'qualite_bons_apport', waitForModal: true, popover: { title: '5. Enregistrer le bon', description: 'Validez et enregistrez le bon d\'apport.', side: 'top' }},
                    ]
                },
                {
                    id: 'faire-inspection', title: 'Faire une Inspection', icon: 'fa-clipboard-check',
                    description: 'Réalisez une inspection qualité quotidienne',
                    steps: [
                        { element: '[data-tour="nav-qualite-inspections"]', requiredTab: null, popover: { title: '1. Accéder aux Inspections', description: 'Cliquez sur "Inspections du Jour" dans le menu.', side: 'right' }},
                        { element: '[data-tour="inspections-list"]', requiredTab: 'qualite_inspections', popover: { title: '2. Liste des inspections', description: 'Visualisez les inspections du jour avec leur statut et les parcelles concernées.', side: 'bottom' }},
                        { element: '[data-tour="inspections-detail"]', requiredTab: 'qualite_inspections', popover: { title: '3. Détails d\'une inspection', description: 'Cliquez sur une inspection pour voir les détails : notes qualité, défauts identifiés, photos.', side: 'top' }},
                    ]
                },
                {
                    id: 'dashboard-qualite', title: 'Dashboard Qualité', icon: 'fa-gauge-high',
                    description: 'Consultez les indicateurs qualité en un coup d\'œil',
                    steps: [
                        { element: '[data-tour="nav-qualite-dashboard"]', requiredTab: null, popover: { title: '1. Dashboard Qualité', description: 'Accédez au tableau de bord qualité pour une vue d\'ensemble.', side: 'right' }},
                        { element: '[data-tour="qualite-kpis"]', requiredTab: 'qualite_dashboard', popover: { title: '2. KPIs Qualité', description: 'Consultez les indicateurs clés : taux de conformité, Brix moyen, nombre de défauts.', side: 'bottom' }},
                    ]
                },
            ],
            chef_f1: [
                {
                    id: 'consulter-dashboard', title: 'Consulter le Dashboard', icon: 'fa-gauge-high',
                    description: 'Visualisez les KPIs de votre ferme en temps réel',
                    steps: [
                        { element: '[data-tour="nav-dashboard"]', requiredTab: null, popover: { title: '1. Accéder au Dashboard', description: 'Cliquez sur "Dashboard" pour voir les indicateurs de votre ferme.', side: 'right' }},
                        { element: '[data-tour="dashboard-kpis"]', requiredTab: 'dashboard', popover: { title: '2. KPIs principaux', description: 'Consultez l\'effectif du jour, le rendement récolte, et les opérations hors récolte en cours.', side: 'bottom' }},
                        { element: '[data-tour="dashboard-top5"]', requiredTab: 'dashboard', popover: { title: '3. Top 5 Opérations', description: 'Visualisez les 5 opérations les plus actives et leur progression.', side: 'top' }},
                    ]
                },
                {
                    id: 'valider-bdc', title: 'Valider un Bon de Commande', icon: 'fa-check-circle',
                    description: 'Validez ou rejetez les BDC de votre ferme',
                    steps: [
                        { element: '[data-tour="nav-chef-validations"]', requiredTab: null, popover: { title: '1. Accéder aux Validations', description: 'Cliquez sur "Validations BDC" pour voir les bons en attente de votre validation.', side: 'right' }},
                        { element: '[data-tour="validations-pending"]', requiredTab: 'chef_validations', popover: { title: '2. BDC en attente', description: 'Vous verrez la liste des bons de commande en attente de votre validation avec les détails.', side: 'bottom' }},
                        { element: '[data-tour="validations-actions"]', requiredTab: 'chef_validations', popover: { title: '3. Valider ou Rejeter', description: 'Cliquez sur un BDC pour le consulter, puis validez ou rejetez avec un commentaire.', side: 'top' }},
                    ]
                },
                {
                    id: 'creer-da-chef', title: 'Créer une Demande d\'Achat', icon: 'fa-file-lines',
                    description: 'Soumettez une demande d\'achat pour votre ferme',
                    steps: [
                        { element: '[data-tour="nav-chef-da"]', requiredTab: null, popover: { title: '1. Demande d\'Achat', description: 'Cliquez sur "Demande d\'Achat" dans le menu.', side: 'right' }},
                        { element: '[data-tour="btn-new-chef-da"]', requiredTab: 'chef_da', popover: { title: '2. Nouvelle demande', description: 'Créez une nouvelle demande d\'achat pour votre ferme.', side: 'bottom' }},
                    ]
                },
            ],
            chef_f5: 'chef_f1',
            chef_avo: 'chef_f1',
            caporal_f1: [
                {
                    id: 'saisie-pointage', title: 'Pointage du Jour', icon: 'fa-user-check',
                    description: 'Consultez le pointage quotidien de votre équipe',
                    steps: [
                        { element: '[data-tour="nav-pointage"]', requiredTab: null, popover: { title: '1. Pointage du Jour', description: 'Accédez au pointage pour voir les effectifs présents aujourd\'hui.', side: 'right' }},
                        { element: '[data-tour="pointage-summary"]', requiredTab: 'pointage', popover: { title: '2. Résumé des effectifs', description: 'Consultez le nombre de travailleurs présents, absents, et la comparaison avec la veille.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'suivi-jour', title: 'Suivi du Jour', icon: 'fa-clipboard-list',
                    description: 'Suivez l\'avancement des tâches quotidiennes',
                    steps: [
                        { element: '[data-tour="nav-caporal-suivi"]', requiredTab: null, popover: { title: '1. Suivi du Jour', description: 'Accédez au suivi quotidien pour voir les tâches assignées.', side: 'right' }},
                        { element: '[data-tour="suivi-tasks"]', requiredTab: 'caporal_suivi', popover: { title: '2. Tâches du jour', description: 'Visualisez les tâches à réaliser, en cours et terminées.', side: 'bottom' }},
                    ]
                },
            ],
            caporal_f5: 'caporal_f1',
            caporal_avo: 'caporal_f1',
            magasinier: [
                {
                    id: 'gerer-stock', title: 'Gérer le Stock Emballages', icon: 'fa-boxes-stacked',
                    description: 'Consultez et gérez le stock d\'emballages',
                    steps: [
                        { element: '[data-tour="nav-mag-stock"]', requiredTab: null, popover: { title: '1. Stock Emballages', description: 'Accédez à la gestion du stock emballages.', side: 'right' }},
                        { element: '[data-tour="stock-overview"]', requiredTab: 'mag_stock', popover: { title: '2. Vue d\'ensemble', description: 'Consultez les niveaux de stock par type d\'emballage et les mouvements récents.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'reception-bl', title: 'Réception (Bons de Livraison)', icon: 'fa-truck-ramp-box',
                    description: 'Enregistrez la réception des marchandises',
                    steps: [
                        { element: '[data-tour="nav-mag-reception"]', requiredTab: null, popover: { title: '1. Réception BL', description: 'Cliquez sur "Réception (BL)" pour accéder aux bons de livraison.', side: 'right' }},
                        { element: '[data-tour="reception-list"]', requiredTab: 'mag_reception', popover: { title: '2. Bons à réceptionner', description: 'Consultez les bons de livraison en attente de réception et confirmez la réception.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'bons-conso', title: 'Bons de Consommation', icon: 'fa-flask',
                    description: 'Gérez les bons de consommation engrais et phyto',
                    steps: [
                        { element: '[data-tour="nav-mag-bc-engrais"]', requiredTab: null, popover: { title: '1. Bons Conso. Engrais', description: 'Accédez aux bons de consommation d\'engrais.', side: 'right' }},
                        { element: '[data-tour="bc-list"]', requiredTab: 'mag_bc_engrais', popover: { title: '2. Liste des bons', description: 'Consultez les consommations d\'engrais par parcelle et par date.', side: 'bottom' }},
                    ]
                },
            ],
            finance: [
                {
                    id: 'valider-paiements', title: 'Valider les Paiements', icon: 'fa-check-double',
                    description: 'Validez les paiements fournisseurs en attente',
                    steps: [
                        { element: '[data-tour="nav-fin-paiements"]', requiredTab: null, popover: { title: '1. Validation Paiements', description: 'Accédez à la section "Valid. Paiements".', side: 'right' }},
                        { element: '[data-tour="fin-paiements-list"]', requiredTab: 'fin_paiements', popover: { title: '2. Paiements en attente', description: 'Consultez la liste des paiements en attente de validation avec montants et fournisseurs.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'consulter-cpc', title: 'Consulter le CPC', icon: 'fa-chart-pie',
                    description: 'Analysez le Compte de Produits et Charges',
                    steps: [
                        { element: '[data-tour="nav-fin-dashboard"]', requiredTab: null, popover: { title: '1. CPC / Dashboard', description: 'Accédez au tableau de bord financier CPC.', side: 'right' }},
                        { element: '[data-tour="fin-cpc-kpis"]', requiredTab: 'fin_dashboard', popover: { title: '2. Indicateurs financiers', description: 'Visualisez le chiffre d\'affaires, les charges, et la marge en temps réel.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'suivi-liquidations', title: 'Suivi des Liquidations', icon: 'fa-file-invoice-dollar',
                    description: 'Suivez les liquidations en cours',
                    steps: [
                        { element: '[data-tour="nav-fin-liquidations"]', requiredTab: null, popover: { title: '1. Suivi Liquidations', description: 'Accédez au suivi des liquidations.', side: 'right' }},
                        { element: '[data-tour="liquidations-list"]', requiredTab: 'fin_liquidations', popover: { title: '2. État des liquidations', description: 'Consultez les liquidations par période avec leur statut et montant.', side: 'bottom' }},
                    ]
                },
            ],
            dg: [
                {
                    id: 'dg-validations', title: 'Valider les Demandes', icon: 'fa-check-double',
                    description: 'Validez les BDC et demandes en attente',
                    steps: [
                        { element: '[data-tour="nav-dg-validations"]', requiredTab: null, popover: { title: '1. Validations DG', description: 'Accédez aux demandes en attente de votre validation.', side: 'right' }},
                        { element: '[data-tour="dg-validations-list"]', requiredTab: 'dg_validations', popover: { title: '2. Demandes en attente', description: 'Consultez les BDC et DA soumis par les chefs de ferme et le service achats.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'dg-adoption', title: 'Suivi Adoption', icon: 'fa-users-viewfinder',
                    description: 'Suivez l\'adoption de l\'application par les équipes',
                    steps: [
                        { element: '[data-tour="nav-dg-adoption"]', requiredTab: null, popover: { title: '1. Adoption', description: 'Accédez au tableau de suivi d\'adoption de l\'application.', side: 'right' }},
                        { element: '[data-tour="adoption-stats"]', requiredTab: 'dg_adoption', popover: { title: '2. Statistiques d\'utilisation', description: 'Visualisez le taux d\'adoption par profil, les connexions quotidiennes et les fonctionnalités les plus utilisées.', side: 'bottom' }},
                    ]
                },
            ],
            agronomie: [
                {
                    id: 'programme-fertigation', title: 'Programme Fertigation', icon: 'fa-droplet',
                    description: 'Consultez et gérez le programme de fertigation',
                    steps: [
                        { element: '[data-tour="nav-agro-irrigation"]', requiredTab: null, popover: { title: '1. Programme Fertigation', description: 'Accédez au programme de fertigation dans le menu Agronomie.', side: 'right' }},
                        { element: '[data-tour="fertigation-calendar"]', requiredTab: 'agro_irrigation', popover: { title: '2. Calendrier de fertigation', description: 'Consultez le planning de fertigation par parcelle et par semaine.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'prediction-recolte', title: 'Prédiction Récolte', icon: 'fa-chart-line',
                    description: 'Visualisez les prédictions de rendement',
                    steps: [
                        { element: '[data-tour="nav-agro-harvest"]', requiredTab: null, popover: { title: '1. Prédiction Récolte', description: 'Accédez aux prédictions de récolte.', side: 'right' }},
                        { element: '[data-tour="harvest-predictions"]', requiredTab: 'agro_harvest', popover: { title: '2. Prévisions de rendement', description: 'Visualisez les prédictions de rendement par variété et par parcelle.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'dashboard-agro', title: 'Dashboard Agronomie', icon: 'fa-gauge-high',
                    description: 'Vue d\'ensemble des indicateurs agronomiques',
                    steps: [
                        { element: '[data-tour="nav-agro-dashboard"]', requiredTab: null, popover: { title: '1. Dashboard Agronomie', description: 'Accédez au tableau de bord agronomique.', side: 'right' }},
                        { element: '[data-tour="agro-kpis"]', requiredTab: 'agro_dashboard', popover: { title: '2. KPIs Agronomie', description: 'Consultez les indicateurs : état des cultures, alertes phytosanitaires, suivi irrigation.', side: 'bottom' }},
                    ]
                },
            ],
            rh: [
                {
                    id: 'rh-dashboard', title: 'Dashboard RH', icon: 'fa-gauge-high',
                    description: 'Consultez les indicateurs de gestion des effectifs',
                    steps: [
                        { element: '[data-tour="nav-dashboard"]', requiredTab: null, popover: { title: '1. Dashboard', description: 'Accédez au dashboard pour une vue globale des effectifs.', side: 'right' }},
                        { element: '[data-tour="dashboard-kpis"]', requiredTab: 'dashboard', popover: { title: '2. KPIs Effectifs', description: 'Consultez l\'effectif total, répartition récolte/hors-récolte, et les tendances hebdomadaires.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'rh-pointage', title: 'Pointage du Jour', icon: 'fa-clock',
                    description: 'Suivez le pointage quotidien de toutes les fermes',
                    steps: [
                        { element: '[data-tour="nav-pointage"]', requiredTab: null, popover: { title: '1. Pointage du Jour', description: 'Accédez au pointage pour voir les effectifs de toutes les fermes.', side: 'right' }},
                        { element: '[data-tour="pointage-summary"]', requiredTab: 'pointage', popover: { title: '2. Résumé du pointage', description: 'Consultez les effectifs par ferme, les variations jour/jour et les cumuls de la quinzaine.', side: 'bottom' }},
                    ]
                },
                {
                    id: 'rh-quinzaine', title: 'Quinzaine', icon: 'fa-calendar-days',
                    description: 'Consultez les estimations de la quinzaine en cours',
                    steps: [
                        { element: '[data-tour="nav-quinzaine"]', requiredTab: null, popover: { title: '1. Quinzaine', description: 'Accédez à la vue quinzaine pour les estimations de paie.', side: 'right' }},
                        { element: '[data-tour="quinzaine-summary"]', requiredTab: 'quinzaine', popover: { title: '2. Estimation Quinzaine', description: 'Consultez l\'estimation des coûts, la répartition par ferme et le comparatif avec les quinzaines précédentes.', side: 'bottom' }},
                    ]
                },
            ],
            dt: [
                {
                    id: 'dt-dashboard', title: 'Dashboard Technique', icon: 'fa-gauge-high',
                    description: 'Vue d\'ensemble technique multi-fermes',
                    steps: [
                        { element: '[data-tour="nav-dashboard"]', requiredTab: null, popover: { title: '1. Dashboard', description: 'Accédez au dashboard pour une vue technique de votre ferme.', side: 'right' }},
                        { element: '[data-tour="dt-farm-switcher"]', requiredTab: 'dashboard', popover: { title: '2. Changer de ferme', description: 'Utilisez ce sélecteur pour basculer entre les fermes.', side: 'bottom' }},
                        { element: '[data-tour="dashboard-kpis"]', requiredTab: 'dashboard', popover: { title: '3. KPIs Ferme', description: 'Consultez les effectifs, rendements et opérations de la ferme sélectionnée.', side: 'bottom' }},
                    ]
                },
            ],
        };

export { TUTORIAL_REGISTRY };
