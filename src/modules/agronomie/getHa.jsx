/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): getHa */
import { getParcelleInfo } from './getParcelleInfo.jsx';

const getHa = (v, f) => getParcelleInfo(v, f).ha;

export { getHa };
