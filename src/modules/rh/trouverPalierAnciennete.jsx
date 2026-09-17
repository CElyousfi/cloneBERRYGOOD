/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): trouverPalierAnciennete */


import * as PaieUtils from '../shared/lib/paieUtils.js';

const trouverPalierAnciennete = (anciennete, paliers) =>
            PaieUtils.trouverPalierAnciennete(anciennete, paliers);

export { trouverPalierAnciennete };
