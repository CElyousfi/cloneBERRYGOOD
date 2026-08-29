/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): formatModePaiement */


// Helper: format mode_paiement (handles legacy values)
        function formatModePaiement(mode) {
            if (mode === 'comptant_virement' || mode === 'virement_bancaire') return 'Comptant – Virement';
            if (mode === 'comptant_especes' || mode === 'caisse') return 'Comptant – Espèces';
            if (mode === 'facilite' || mode === 'comptant') return 'Facilité';
            return mode || '—';
        }

export { formatModePaiement };
