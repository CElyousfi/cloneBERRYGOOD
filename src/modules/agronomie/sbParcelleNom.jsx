/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): sbParcelleNom */


function sbParcelleNom(labelBeeOne) {
            const ref = window.SB_PARCELLE_REF && window.SB_PARCELLE_REF[(labelBeeOne || '').toUpperCase().trim()];
            return (ref && ref.nom_sb) ? ref.nom_sb : (labelBeeOne || '—');
        }

export { sbParcelleNom };
