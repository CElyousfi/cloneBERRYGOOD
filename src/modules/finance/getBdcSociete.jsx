/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): getBdcSociete */
import { BDC_SOCIETES } from './BDC_SOCIETES.jsx';
import { BDC_SOCIETE_DEFAULT } from './BDC_SOCIETE_DEFAULT.jsx';

const getBdcSociete = (ferme) => BDC_SOCIETES[ferme] || BDC_SOCIETE_DEFAULT;

export { getBdcSociete };
