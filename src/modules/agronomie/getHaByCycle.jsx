/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): getHaByCycle */
import { PARCELLES_CULTURALES } from './PARCELLES_CULTURALES.jsx';

// Superficie pour une variété/sous-variété/ferme/cycle
        function getHaByCycle(variete, sousVariete, ferme, cycle) {
            const matches = PARCELLES_CULTURALES.filter(pc =>
                pc.variete === variete && pc.cycle === cycle &&
                pc.enProduction !== false &&
                (!ferme || pc.ferme === ferme) &&
                (sousVariete ? pc.sousVariete === sousVariete : true)
            );
            return matches.reduce((sum, pc) => sum + pc.ha, 0);
        }

export { getHaByCycle };
