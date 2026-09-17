/* Module: shared | Déclaration(s): NAV_ITEMS_FINANCE */


const NAV_ITEMS_FINANCE = [
            { id: 'dashboard', label: 'Dashboard Pointage', icon: 'fa-gauge-high', dgOnly: true },
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-clock', dgOnly: true },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp', dgOnly: true },
            { id: 'recolte', label: 'Dashboard Récolte', icon: 'fa-basket-shopping', dgOnly: true },
            { id: 'cout_recolte', label: 'Coût Récolte', icon: 'fa-calculator' },
            { id: 'quinzaine', label: 'Dashboard Quinzaine', icon: 'fa-calendar-days', dgOnly: true },
            { id: 'fin_dashboard', label: 'CPC / Dashboard', icon: 'fa-chart-pie' },
            { id: 'fin_tresorerie', label: 'Trésorerie', icon: 'fa-vault' },
            { id: 'fin_ca', label: 'Chiffre d\'Affaires', icon: 'fa-coins' },
            { id: 'fin_carburant', label: 'Carburant', icon: 'fa-gas-pump' },
            { id: 'fin_plants', label: 'Plants', icon: 'fa-seedling', dgOnly: true },
            { id: 'fin_telecom', label: 'Maroc Télécom', icon: 'fa-phone' },
            { id: 'fin_ojra', label: 'OJRA (Paie)', icon: 'fa-file-invoice-dollar' },
            { id: 'fin_stock', label: 'Gestion de Stock', icon: 'fa-boxes-stacked' },
            { id: 'mag_bdc_reception', label: 'BDC à réceptionner', icon: 'fa-clipboard-check' },
            { id: 'mag_reception', label: 'Bons de Réception', icon: 'fa-truck-ramp-box' },
            { id: 'mag_inventaire', label: 'Inventaire', icon: 'fa-clipboard-list' },
            { id: 'fin_liquidations', label: 'Suivi Liquidations', icon: 'fa-file-invoice-dollar' },
            { id: 'productivity_report', label: 'Productivity Driscoll\'s', icon: 'fa-chart-line' },
            { id: 'qualite_liquidations', label: 'Liquidations Qualité', icon: 'fa-coins' },
            { id: 'qualite_reconciliation', label: 'Réconciliation', icon: 'fa-scale-balanced' },
            { id: 'fin_bdc', label: 'Suivi BDC', icon: 'fa-file-contract' },
            { id: 'fin_factures', label: 'Factures Fournisseurs', icon: 'fa-file-invoice' },
            { id: 'fin_paiements', label: 'Valid. Paiements', icon: 'fa-check-double' },
            { id: 'fin_virements', label: 'Virements', icon: 'fa-money-bill-transfer' },
            { id: 'fin_codes_analytiques', label: 'Codes Analytiques', icon: 'fa-tags' },
            { id: 'fin_delete_articles', label: 'Suppr. Articles', icon: 'fa-trash-can' },
            // Legacy « Marché Local / Situation Clients » (fin_marche_local) retiré du menu
            // (sous-lot 4.4). Remplacé par la vue compte-client read-only de la Gestion de
            // Caisse (CaisseComptesClientsSub). Composant FinanceMarcheLocalTab et statiques
            // conservés (no-delete) mais inatteignables.
            { id: 'dg_validations', label: 'Validations', icon: 'fa-check-double' },
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
            { id: 'fin_budget', label: 'Budget vs Réel', icon: 'fa-chart-gantt' },
            { id: 'caisse', label: 'Gestion de Caisse', icon: 'fa-cash-register' },
            { id: 'dg_adoption', label: 'Adoption', icon: 'fa-users-viewfinder' },
            { id: 'dg_tasks', label: 'Tâches', icon: 'fa-list-check' },
            { id: 'dg_cr_reunions', label: 'CR Réunions', icon: 'fa-file-pen' },
            { id: 'suivi_pointage', label: 'Suivi Pointage', icon: 'fa-clipboard-check' },
            { id: 'pointage_divers', label: 'Pointage Divers', icon: 'fa-truck' },
            { id: 'dqr_daily', label: 'DQR Journalier', icon: 'fa-clipboard-list' },
            { id: 'dg_signature', label: 'Signature & Cachet', icon: 'fa-stamp', dgOnly: true },
            { id: 'dg_parametres', label: 'Paramètres', icon: 'fa-gear', dgOnly: true },
            { id: 'bug_reports', label: 'Bugs signalés', icon: 'fa-bug', dgOnly: true },
        ];

export { NAV_ITEMS_FINANCE };
