/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): NAV_ITEMS_CHEF_BAHIA */


// Chef de ferme BAHIA — accès restreint : DA + suivi, météo, pointage & quinzaine BAHIA (consultation).
        const NAV_ITEMS_CHEF_BAHIA = [
            { id: 'pointage', label: 'Pointage Quotidien', icon: 'fa-clock' },
            { id: 'validation_pointage', label: 'Validation du pointage', icon: 'fa-stamp' },
            { id: 'quinzaine', label: 'Quinzaine', icon: 'fa-calendar-days' },
            { id: 'station_meteo', label: 'Météo', icon: 'fa-cloud-sun' },
            { id: 'chef_da', label: 'Demande d\'Achat', icon: 'fa-file-lines' },
            { id: 'chef_tracking', label: 'Suivi Commandes', icon: 'fa-route' },
        ];

export { NAV_ITEMS_CHEF_BAHIA };
