/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): CACHED_PROFILE_KEY */


// CORRECTIF (a) — cache du dernier profil connu (localStorage).
        // Permet de restaurer le profil après un reload alors que `me` échoue
        // transitoirement (réseau/5xx) tout en restant connecté côté Firebase.
        const CACHED_PROFILE_KEY = 'cachedUserProfile';

export { CACHED_PROFILE_KEY };
