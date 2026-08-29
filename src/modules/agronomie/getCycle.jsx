/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): getCycle */


// Détecte le cycle à partir d'une date
        function getCycle(dateStr) {
            if (!dateStr) return 2;
            const m = new Date(dateStr).getMonth();
            return (m >= 8 && m <= 11) ? 1 : 2; // Sep-Déc=1, Jan-Juin=2
        }

export { getCycle };
