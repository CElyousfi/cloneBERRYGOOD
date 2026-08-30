/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): deriveSubFerme */


function deriveSubFerme(refParcelle, parcelle) {
            const ref = (refParcelle || '').trim();
            if (/bahia/i.test(ref) || /bahia/i.test(parcelle || '')) return 'BAHIA';
            const m = ref.match(/^(F\d)/i);
            return m ? m[1].toUpperCase() : null;
        }

export { deriveSubFerme };
