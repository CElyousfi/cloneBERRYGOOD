/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: admin | Déclaration(s): getTutorials */
import { TUTORIAL_REGISTRY } from './TUTORIAL_REGISTRY.jsx';

// Resolve profile aliases (chef_f5 → chef_f1, etc.)
        function getTutorials(profileId) {
            let tutorials = TUTORIAL_REGISTRY[profileId];
            if (typeof tutorials === 'string') tutorials = TUTORIAL_REGISTRY[tutorials];
            return tutorials || [];
        }

export { getTutorials };
