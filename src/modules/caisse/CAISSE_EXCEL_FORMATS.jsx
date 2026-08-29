/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CAISSE_EXCEL_FORMATS */


// ---- Import Excel Sub (Achats/DG/Finance) ----
        // Mapping caisse_id → format Excel attendu (doit correspondre au backend)
        const CAISSE_EXCEL_FORMATS = {
            caisse_depenses: { format: 'depenses_monthly', label: 'Multi-feuilles mensuelles', hint: 'Une feuille par mois (JANVIER 2025, FEVRIER 2025…) avec entêtes ligne 7' },
            caisse_paie: { format: 'paie_recap', label: 'Feuille Récap quinzaines', hint: 'Feuille "Récap" avec une ligne par quinzaine (1Q07/2025, 2Q07/2025…)' },
            caisse_depenses_bahia: { format: 'bahia_single', label: 'Feuille unique "Les dépenses"', hint: 'Feuille "Les dépenses" avec codes analytiques 1 et 2' },
        };

export { CAISSE_EXCEL_FORMATS };
