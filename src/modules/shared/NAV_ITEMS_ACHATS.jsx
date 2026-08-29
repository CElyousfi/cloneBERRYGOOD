/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): NAV_ITEMS_ACHATS */


const NAV_ITEMS_ACHATS = [
            { id: 'achats_dashboard', label: 'Dashboard Achats', icon: 'fa-gauge-high' },
            { id: 'achats_da', label: 'Demandes d\'Achat', icon: 'fa-file-pen' },
            { id: 'achats_consultation', label: 'Consultations', icon: 'fa-scale-balanced' },
            { id: 'achats_bdc', label: 'Bons de Commande', icon: 'fa-file-contract' },
            { id: 'achats_receptions_valoriser', label: 'Réceptions à valoriser', icon: 'fa-tags' },
            { id: 'achats_factures', label: 'Factures', icon: 'fa-file-invoice-dollar' },
            { id: 'achats_paiements', label: 'Paiements', icon: 'fa-credit-card' },
            { id: 'achats_fournisseurs', label: 'Fournisseurs', icon: 'fa-building' },
            { id: 'achats_catalogue', label: 'Catalogue Produits', icon: 'fa-boxes-stacked' },
            { id: 'achats_analyses_foliaires', label: 'Analyses Foliaires', icon: 'fa-flask-vial' },
            { id: 'achats_scan_factures', label: 'Scan Factures', icon: 'fa-file-import' },
            { id: 'achats_scan_bl', label: 'Scan BL', icon: 'fa-truck-ramp-box' },
            { id: 'achats_bon_apport', label: 'Bons d\'Apport', icon: 'fa-file-circle-plus' },
            { id: 'achats_rapprochement', label: 'Rapprochement', icon: 'fa-code-compare' },
            { id: 'qualite_expeditions', label: 'Expéditions', icon: 'fa-truck' },
            // Legacy « Marché Local / Situation Clients » (fin_marche_local) retiré du menu
            // (sous-lot 4.4). Remplacé par la vue compte-client read-only de la Gestion de
            // Caisse (CaisseComptesClientsSub). Composant et statiques conservés (no-delete).
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
            { id: 'achats_vente_plastique', label: 'Vente Plastique', icon: 'fa-recycle' },
            { id: 'mag_stock_intrants', label: 'Soldes Stock', icon: 'fa-warehouse' },
            { id: 'mag_inventaire', label: 'Inventaire', icon: 'fa-clipboard-list' },
            { id: 'mag_fiche_stock', label: 'Fiche de Stock', icon: 'fa-file-invoice' },
            { id: 'mag_bdc_reception', label: 'BDC à réceptionner', icon: 'fa-clipboard-check' },
            { id: 'mag_reception', label: 'Bons de Réception', icon: 'fa-truck-ramp-box' },
            { id: 'dqr_daily', label: 'DQR Journalier', icon: 'fa-clipboard-list' },
            { id: 'caisse', label: 'Gestion de Caisse', icon: 'fa-cash-register' },
        ];

export { NAV_ITEMS_ACHATS };
