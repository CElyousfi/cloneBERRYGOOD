/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): isMonoCycle */
import { getCycleType } from './getCycleType.jsx';

const isMonoCycle = (variete) => getCycleType(variete) === 'mono';

export { isMonoCycle };
