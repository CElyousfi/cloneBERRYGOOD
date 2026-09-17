/* Module: caisse | Déclaration(s): isModeComptant */
import { isModeEspeces } from './isModeEspeces.jsx';
import { isModeVirement } from './isModeVirement.jsx';

function isModeComptant(mode) { return isModeVirement(mode) || isModeEspeces(mode); }

export { isModeComptant };
