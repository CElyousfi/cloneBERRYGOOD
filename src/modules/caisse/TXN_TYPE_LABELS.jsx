/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): TXN_TYPE_LABELS */


const TXN_TYPE_LABELS = {
            alimentation: { label: 'Alimentation', icon: 'fa-arrow-down', color: 'var(--green)', bg: 'rgba(45,139,78,0.1)' },
            depense: { label: 'Dépense', icon: 'fa-arrow-up', color: 'var(--red)', bg: 'rgba(231,76,60,0.1)' },
            sortie: { label: 'Sortie', icon: 'fa-arrow-right-from-bracket', color: 'var(--orange)', bg: 'rgba(243,156,18,0.1)' },
            paie: { label: 'Paie', icon: 'fa-money-check-dollar', color: '#9b59b6', bg: 'rgba(155,89,182,0.1)' },
            transport: { label: 'Transport', icon: 'fa-truck', color: '#16a085', bg: 'rgba(22,160,133,0.1)' },
            transfer_out: { label: 'Transfert sortant', icon: 'fa-arrow-right', color: 'var(--berry)', bg: 'rgba(139,34,82,0.08)' },
            transfer_in: { label: 'Transfert entrant', icon: 'fa-arrow-left', color: 'var(--blue)', bg: 'rgba(52,152,219,0.1)' },
        };

export { TXN_TYPE_LABELS };
