/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): _dedupInflight */


const _dedupInflight = (typeof window !== 'undefined' && window.InflightDedup)
            ? window.InflightDedup.dedupInflight
            : function(reg, key, fn) { return fn(); };

export { _dedupInflight };
