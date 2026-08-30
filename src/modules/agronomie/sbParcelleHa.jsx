/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): sbParcelleHa */


function sbParcelleHa(labelBeeOne) {
            const key = (labelBeeOne || '').toUpperCase().trim();
            const ref = window.SB_PARCELLE_REF && window.SB_PARCELLE_REF[key];
            if (ref && ref.ha > 0) return ref.ha;
            const campHa = window.SB_PARCELLE_CAMPAGNE && window.SB_PARCELLE_CAMPAGNE[key];
            if (campHa > 0) return campHa;
            return 0;
        }

export { sbParcelleHa };
