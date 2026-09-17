/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): sbParcelleNom */


import { sbParcelle } from '../shared/sbParcelleState.js';

function sbParcelleNom(labelBeeOne) {
            const ref = sbParcelle.REF && sbParcelle.REF[(labelBeeOne || '').toUpperCase().trim()];
            return (ref && ref.nom_sb) ? ref.nom_sb : (labelBeeOne || '—');
        }

export { sbParcelleNom };
