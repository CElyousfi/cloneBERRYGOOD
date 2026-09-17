/* Module: agronomie | Déclaration(s): getParcelleInfo */
import { CAMPAGNE_PARCELLE_MAP } from './CAMPAGNE_PARCELLE_MAP.jsx';

const getParcelleInfo = (v, f) => CAMPAGNE_PARCELLE_MAP[`${v}|${f}`] || { ha: 0, kgExport: 0, parcelles: [] };

export { getParcelleInfo };
