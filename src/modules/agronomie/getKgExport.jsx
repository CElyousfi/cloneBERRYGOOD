/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): getKgExport */
import { getParcelleInfo } from './getParcelleInfo.jsx';

const getKgExport = (v, f) => getParcelleInfo(v, f).kgExport;

export { getKgExport };
