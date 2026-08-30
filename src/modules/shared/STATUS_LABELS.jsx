/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): STATUS_LABELS */


// Sprint 2 — statuts enrichis. Codes DB inchangés (rétro-compat avec le
        // workflow submit-transaction / validate-transaction). 'soumis' affiché
        // 'Saisi' (alias UI uniquement). Nouveau statut 'a_revoir'.
        const STATUS_LABELS = {
            brouillon: { label: 'Brouillon', color: '#6B7280', bg: '#F3F4F6' },
            soumis:    { label: 'Saisi',     color: '#1A56DB', bg: '#E8F0FE' },
            a_revoir:  { label: 'À revoir',  color: '#92400E', bg: '#FEF3C7' },
            valide:    { label: 'Validé',    color: '#1A7A3F', bg: '#DCF5E7' },
            rejete:    { label: 'Rejeté',    color: '#991B1B', bg: '#FEE2E2' },
        };

export { STATUS_LABELS };
