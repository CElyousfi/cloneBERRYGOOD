/* Module: shared | Déclaration(s): NAV_ITEMS_RH */


const NAV_ITEMS_RH = [
            { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high' },
            { id: 'quinzaine', label: 'Quinzaine', icon: 'fa-calendar-days' },
            { id: 'campagne', label: 'Campagne', icon: 'fa-chart-line' },
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-clock' },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp' },
            { id: 'pointage_divers', label: 'Pointage Divers', icon: 'fa-truck' },
            { id: 'recolte', label: 'Récolte', icon: 'fa-basket-shopping' },
            { id: 'cout_recolte', label: 'Coût Récolte', icon: 'fa-calculator' },
            { id: 'qualite_inspections', label: 'Inspections', icon: 'fa-clipboard-check', chefOnly: true },
            { id: 'productivity_report', label: 'Productivity Driscoll\'s', icon: 'fa-chart-line', chefOnly: true },
            { id: 'hors_recolte', label: 'Hors Récolte', icon: 'fa-trowel' },
            { id: 'hors_recolte_suivi', label: 'Rendement Hors Récolte', icon: 'fa-chart-gantt' },
            { id: 'chef_suivi_caporal', label: 'Suivi Caporal', icon: 'fa-clipboard-list', chefOnly: true },
            { id: 'qualite_production', label: 'Production', icon: 'fa-industry' },
            { id: 'rh_equipes', label: 'Équipes', icon: 'fa-people-group', rhOnly: true },
            { id: 'primes', label: 'Primes', icon: 'fa-award', rhOnly: true },
            { id: 'chef_agronomie', label: 'Agronomie', icon: 'fa-seedling' },
            { id: 'paie', label: 'Paie', icon: 'fa-money-bill-wave', rhOnly: true },
            { id: 'primes_fixes', label: 'Primes Fixes', icon: 'fa-award', rhOnly: true },
            { id: 'parcelles_referentiel', label: 'Parcelles & Référentiel', icon: 'fa-map-location-dot', rhOnly: true },
            { id: 'parametres', label: 'Paramètres', icon: 'fa-sliders', rhOnly: true },
            { id: 'chef_production', label: 'Production', icon: 'fa-industry', chefOnly: true },
            { id: 'chef_tracking', label: 'Suivi Commandes', icon: 'fa-route', chefOnly: true },
            { id: 'chef_da', label: 'Demande d\'Achat', icon: 'fa-file-lines', chefOnly: true },
            { id: 'chef_validations', label: 'Validations BDC', icon: 'fa-check-circle', chefOnly: true },
            { id: 'mag_mouvements', label: 'Validations Stock', icon: 'fa-warehouse', chefOnly: true },
            { id: 'chef_validation_bons', label: 'Valid. Bons Apport', icon: 'fa-clipboard-check', chefOnly: true },
            { id: 'fin_budget', label: 'Budget vs Réel', icon: 'fa-chart-gantt', chefOnly: true },
            { id: 'suivi', label: 'Suivi Modifications', icon: 'fa-clipboard-list', rhOnly: true },
            { id: 'bug_reports', label: 'Bugs signalés', icon: 'fa-bug', rhOnly: true },
        ];

export { NAV_ITEMS_RH };
