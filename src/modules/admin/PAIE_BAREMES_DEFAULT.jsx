/* Module: admin | Déclaration(s): PAIE_BAREMES_DEFAULT */
import { __PaieUtils } from '../rh/__PaieUtils.jsx';

const PAIE_BAREMES_DEFAULT = __PaieUtils.PAIE_BAREMES_DEFAULT || {
            smagBrutJournalier: 88.58,
            smagNetJournalier: 82.61,
            joursParMois: 26,
            tauxChargesPatronales: 0.1926,
            tauxCotisationsSalariales: 0.0674,
            paliers: [
                { seuilJours: 624,  pourcentage: 5,  label: '≥ 2 ans' },
                { seuilJours: 1560, pourcentage: 10, label: '≥ 5 ans' },
                { seuilJours: 3120, pourcentage: 15, label: '≥ 10 ans' },
            ],
        };

export { PAIE_BAREMES_DEFAULT };
