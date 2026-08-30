/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): getCaisseColor */
import { CAISSE_COLORS } from './CAISSE_COLORS.jsx';

function getCaisseColor(id) { return CAISSE_COLORS[id] || CAISSE_COLORS._default; }

export { getCaisseColor };
