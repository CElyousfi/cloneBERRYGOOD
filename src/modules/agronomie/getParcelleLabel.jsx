/* Module: agronomie | Déclaration(s): getParcelleLabel */
import { getParcelleInfo } from './getParcelleInfo.jsx';

const getParcelleLabel = (v, f) => getParcelleInfo(v, f).parcelles.join(' + ') || `${v}`;

export { getParcelleLabel };
