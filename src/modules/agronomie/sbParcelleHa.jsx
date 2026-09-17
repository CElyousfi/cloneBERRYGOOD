/* Module: agronomie | Déclaration(s): sbParcelleHa */


import { sbParcelle } from '../shared/sbParcelleState.js';

function sbParcelleHa(labelBeeOne) {
            const key = (labelBeeOne || '').toUpperCase().trim();
            const ref = sbParcelle.REF && sbParcelle.REF[key];
            if (ref && ref.ha > 0) return ref.ha;
            const campHa = sbParcelle.CAMPAGNE && sbParcelle.CAMPAGNE[key];
            if (campHa > 0) return campHa;
            return 0;
        }

export { sbParcelleHa };
