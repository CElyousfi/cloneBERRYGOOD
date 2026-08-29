/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): getVisibleProfiles */
import { PROFILES } from './PROFILES.jsx';

// Profils accessibles dans le sélecteur de profil, selon le profil RÉEL de l'utilisateur.
        // - Audit Interne : accès à tous les profils SAUF le DG.
        // - Le chip "Audit Interne" n'est visible que pour l'admin et l'Audit Interne lui-même
        //   (le profil Finance n'a pas accès au tableau de bord Audit Interne).
        function getVisibleProfiles(userProfile) {
            return PROFILES.filter(p => {
                if (p.id === 'audit_interne') {
                    return userProfile.role === 'admin' || userProfile.profileId === 'audit_interne';
                }
                if (p.id === 'dg') {
                    return userProfile.profileId !== 'audit_interne';
                }
                return true;
            });
        }

export { getVisibleProfiles };
