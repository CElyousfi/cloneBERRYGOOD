/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): getPlantsByCycle */
import { PARCELLES_CULTURALES } from './PARCELLES_CULTURALES.jsx';

// Nb plants pour myrtilles
        function getPlantsByCycle(variete, sousVariete, ferme, cycle) {
            const matches = PARCELLES_CULTURALES.filter(pc =>
                pc.variete === variete && pc.cycle === cycle &&
                (!ferme || pc.ferme === ferme) &&
                (sousVariete ? pc.sousVariete === sousVariete : true) &&
                pc.sousVariete !== 'Nouvelle plantation' &&
                pc.nbPlants > 0
            );
            return matches.reduce((sum, pc) => sum + pc.nbPlants, 0);
        }

export { getPlantsByCycle };
