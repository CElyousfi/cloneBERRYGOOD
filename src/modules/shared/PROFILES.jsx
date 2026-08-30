/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): PROFILES */


// ===================== CONFIGURATION =====================
        const PROFILES = [
            { id: 'rh', label: 'Resp. RH', name: 'Responsable RH', icon: 'fa-users-gear', fullName: 'Responsable RH' },
            { id: 'chef_f1', label: 'Chef Framboise', name: 'Hamid AGOURAM', icon: 'fa-seedling', farmLabel: 'Framboise', cultureFilter: 'Framboise', fullName: 'Hamid AGOURAM' },
            { id: 'chef_f5', label: 'Chef Myrtille', name: 'Bouchra HABCHANE', icon: 'fa-seedling', farmLabel: 'Myrtille', cultureFilter: 'Myrtille', fullName: 'Bouchra HABCHANE' },
            { id: 'chef_avo', label: 'Chef Avocatier', name: 'Azzeddine', icon: 'fa-tree', farm: 'Avocatier', fullName: 'Azzeddine' },
            { id: 'chef_bahia', label: 'Chef BAHIA', name: 'Chef BAHIA', icon: 'fa-tree', farm: 'BAHIA', fullName: 'Chef de ferme BAHIA' },
            { id: 'caporal_f1', label: 'Caporal F1', name: 'Caporal F1', icon: 'fa-hard-hat', farm: 'F1', fullName: 'Caporal F1' },
            { id: 'caporal_f5', label: 'Caporal F5', name: 'Caporal F5', icon: 'fa-hard-hat', farm: 'F5', fullName: 'Caporal F5' },
            { id: 'caporal_avo', label: 'Caporal Avo.', name: 'Caporal Avocatier', icon: 'fa-hard-hat', farm: 'Avocatier', fullName: 'Caporal Avocatier' },
            { id: 'achats', label: 'Achats', name: 'Achraf EL INAK', icon: 'fa-cart-shopping', fullName: 'Achraf EL INAK' },
            { id: 'qualite', label: 'Qualité F1', name: 'FatimZahra', icon: 'fa-clipboard-check', farm: 'F1', fullName: 'FatimZahra' },
            { id: 'magasinier', label: 'Magasinier', name: 'Resp. Magasin', icon: 'fa-warehouse', fullName: 'Resp. Magasin' },
            { id: 'finance', label: 'Finance', name: 'Resp. Finance', icon: 'fa-chart-pie', fullName: 'Resp. Finance' },
            { id: 'dg', label: 'DG', name: 'Direction Générale', icon: 'fa-building', fullName: 'Direction Générale' },
            { id: 'audit_interne', label: 'Audit Interne', name: 'Audit Interne', icon: 'fa-magnifying-glass-chart', fullName: 'Audit Interne' },
            { id: 'agronomie', label: 'Agronomie', name: 'Resp. Agronomie', icon: 'fa-seedling', fullName: 'Resp. Technique Agronomie' },
            { id: 'dt', label: 'Dir. Technique', name: 'Directeur Technique', icon: 'fa-helmet-safety', farm: 'F1', fullName: 'Directeur Technique', switchableFarms: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'] },
            { id: 'stationnaire_f1', label: 'Station. F1', name: 'Stationnaire F1', icon: 'fa-faucet-drip', farm: 'F1', fullName: 'Stationnaire Irrigation F1' },
            { id: 'stationnaire_f5', label: 'Station. F5', name: 'Stationnaire F5', icon: 'fa-faucet-drip', farm: 'F5', fullName: 'Stationnaire Irrigation F5' },
            { id: 'stationnaire_avo', label: 'Station. Avo.', name: 'Stationnaire Avocatier', icon: 'fa-faucet-drip', farm: 'F2', fullName: 'Stationnaire Irrigation Avocatier', switchableFarms: ['F2', 'F3', 'F4', 'F6', 'BAHIA'] },
            { id: 'securite', label: 'Sécurité', name: 'BSNL Sécurité', icon: 'fa-shield-halved', farm: 'F1', fullName: 'BSNL Sécurité', switchableFarms: ['F1', 'F5'] },
        ];

export { PROFILES };
