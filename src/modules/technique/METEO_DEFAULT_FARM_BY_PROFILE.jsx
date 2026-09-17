/* Module: technique | Déclaration(s): METEO_DEFAULT_FARM_BY_PROFILE */


// Ferme par défaut pour l'affichage du widget météo Dashboard, pour les profils
        // sans `farm` propre (PROFILES) où farmFilter est toujours null (chef_f1, chef_f5, dg).
        // N'affecte QUE MeteoAlertsDashboard, jamais farmFilter lui-même.
        const METEO_DEFAULT_FARM_BY_PROFILE = {
            chef_f1: 'F1',
            chef_f5: 'F5',
            dg: 'F1',
        };

export { METEO_DEFAULT_FARM_BY_PROFILE };
