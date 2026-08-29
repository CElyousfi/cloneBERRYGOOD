/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): matchCulture */


// Helper partagé : filtre par culture pour les profils chef-culture (ex. chef_f5=Myrtille).
        // Si cultureFilter est null/vide → passthrough (aucun filtre culture).
        // Fallback via variété si le champ Culture est absent de la ligne.
        function matchCulture(row, cf) {
            if (!cf) return true;
            // 1. Champ culture explicite (peuplé par le backend pour toutes les lignes transport/MO)
            var rawC = (row.culture || row.Culture || '').trim();
            if (rawC) return rawC.toLowerCase() === cf.toLowerCase();
            // 2. Variete directe (lignes Récolte — pas de champ culture côté recolte-equipes)
            var MYRTILLE_V = ['corina', 'breeze', 'cascade'];
            var FRAMBOISE_V = ['yazmin', 'maravilla', 'reyna', 'adelita'];
            var v = (row.variete || row.Variete || row.varieteLabel || '').toLowerCase();
            if (v) {
                if (cf === 'Myrtille') return MYRTILLE_V.some(function(n) { return v.includes(n); });
                if (cf === 'Framboise') return FRAMBOISE_V.some(function(n) { return v.includes(n); });
                return true;
            }
            // 3. Fallback : nom de variété dans la parcelle ou secteur (récolte sans variete explicite)
            var p = (row.parcelle || row.Parcelle_Culturale || '').toUpperCase();
            if (MYRTILLE_V.some(function(n) { return p.includes(n.toUpperCase()); })) return cf === 'Myrtille';
            if (FRAMBOISE_V.some(function(n) { return p.includes(n.toUpperCase()); })) return cf === 'Framboise';
            var sM = p.match(/\bS(\d{1,2})\b/);
            if (sM) {
                var sN = parseInt(sM[1], 10);
                if (sN === 8) return cf === 'Myrtille';
                if ([1,2,3,4,5,6,7,9,10,13].indexOf(sN) >= 0) return cf === 'Framboise';
            }
            return true;
        }

export { matchCulture };
