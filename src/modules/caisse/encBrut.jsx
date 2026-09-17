/* Module: caisse | Déclaration(s): encBrut */
import { ENC_BRUT_VIDE } from './ENC_BRUT_VIDE.jsx';

function encBrut(item, brutKey, donneesHeader) {
            let v = item && item.brut ? item.brut[brutKey] : undefined;
            if (v == null || v === '') {
                const fb = item && item.donnees ? item.donnees[donneesHeader] : undefined;
                v = (fb == null) ? '' : String(fb);
            }
            v = (v == null) ? '' : String(v).trim();
            return v === '' ? ENC_BRUT_VIDE : v;
        }

export { encBrut };
