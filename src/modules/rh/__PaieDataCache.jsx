/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): __PaieDataCache */


// Cache module-level (TTL 5 min) des lectures Firestore lourdes du tab Paie.
        // PaieTab est démonté/remonté à chaque ouverture du tab (renderTab → null
        // quand inactif), donc sans cache chaque ouverture relisait ouvriers_registry
        // (~1636 docs) + sql_mirror_pointage (plage d'historique) → >120s sur Safari.
        // Le cache ne change AUCUNE valeur : il rejoue les mêmes données, juste sans
        // re-fetch. Fallback no-op défensif si le <script> n'est pas chargé.
        const __PaieDataCache = (typeof window !== 'undefined' && window.PaieDataCache) || {
            pointageKey: (a, b) => 'pointage:' + a + '..' + b,
            getOrLoad: (_k, loader) => Promise.resolve().then(loader),
            invalidate: () => {},
        };

export { __PaieDataCache };
