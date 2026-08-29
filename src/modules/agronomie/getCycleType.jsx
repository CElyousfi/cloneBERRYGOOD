/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): getCycleType */
import { VARIETE_CYCLE_CONFIG } from './VARIETE_CYCLE_CONFIG.jsx';

const getCycleType = (variete) => VARIETE_CYCLE_CONFIG[variete] || 'bi';

export { getCycleType };
