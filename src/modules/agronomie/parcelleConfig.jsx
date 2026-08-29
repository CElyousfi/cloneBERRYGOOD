/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): parcelleConfig */
import { PARCELLES_CULTURALES } from './PARCELLES_CULTURALES.jsx';
import { getCycle } from './getCycle.jsx';

// Parcelle configuration par ferme — généré depuis PARCELLES_CULTURALES (backward-compat)
        const parcelleConfig = (() => {
            const cfg = {};
            const currentCycle = getCycle(new Date().toISOString());
            PARCELLES_CULTURALES.filter(pc => pc.cycle === currentCycle).forEach(pc => {
                if (!cfg[pc.ferme]) cfg[pc.ferme] = [];
                const label = pc.sousVariete ? `${pc.variete} ${pc.sousVariete}` : pc.variete;
                cfg[pc.ferme].push({
                    id: pc.id, nom: label, culture: pc.culture,
                    variete: pc.variete, sousVariete: pc.sousVariete,
                    superficie: pc.ha, nbTunnels: pc.nbTunnels, nbPlants: pc.nbPlants,
                    tunnels: Array.from({length: pc.nbTunnels}, (_, i) => `T${i+1}`),
                });
            });
            return cfg;
        })();

export { parcelleConfig };
