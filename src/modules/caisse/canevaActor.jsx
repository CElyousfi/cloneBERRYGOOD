/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): canevaActor */


function canevaActor(currentProfile, profileData) {
            return { profileId: currentProfile, name: (profileData && profileData.name) || currentProfile, userId: (profileData && profileData.userId) || '' };
        }

export { canevaActor };
