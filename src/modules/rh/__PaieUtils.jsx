/* Module: rh | Déclaration(s): __PaieUtils */


// ===================== PAIE — Helpers + Composants =====================
        // Source unique du modèle paie : shared/lib/paieUtils.js (PaieUtils).
        // On référence ici les helpers/const pour éviter toute duplication de logique.
        // Fallback minimal défensif si la lib n'a pas (encore) chargé (ne devrait pas arriver,
        // le module est importé).
import * as PaieUtils from '../shared/lib/paieUtils.js';

        const __PaieUtils = (typeof window !== 'undefined' && PaieUtils) || {};

export { __PaieUtils };
