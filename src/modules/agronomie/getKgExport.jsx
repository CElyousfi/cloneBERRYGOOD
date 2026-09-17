/* Module: agronomie | Déclaration(s): getKgExport */
import { getParcelleInfo } from './getParcelleInfo.jsx';

const getKgExport = (v, f) => getParcelleInfo(v, f).kgExport;

export { getKgExport };
