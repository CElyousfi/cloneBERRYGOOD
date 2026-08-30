/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): _origFetch */


// Patch fetch to auto-inject Firebase Auth token on /api/ calls
        const _origFetch = window.fetch;

export { _origFetch };
