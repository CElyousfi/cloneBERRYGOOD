/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): remapLegacyTab */


// Remap centralisé des tabs legacy retirés du menu (sous-lot 4.4).
        // L'écran « Marché Local / Situation Clients » (fin_marche_local) a été
        // retiré du menu et remplacé par la vue read-only Comptes Clients de la
        // Gestion de Caisse. On bloque TOUT chemin de retour vers le legacy, y
        // compris la restauration du dernier onglet mémorisé : on redirige vers
        // le tab `caisse` et on pose un hint pour ouvrir directement le sous-onglet
        // Comptes Clients. Centraliser ici couvre savedTab + tout futur appel.
        function remapLegacyTab(tab) {
            if (tab === 'fin_marche_local') {
                try { sessionStorage.setItem('caisseInitialSubTab', 'caisse_comptes_clients'); } catch(e) {}
                return 'caisse';
            }
            return tab;
        }

export { remapLegacyTab };
