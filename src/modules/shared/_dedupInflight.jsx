/* Module: shared | Déclaration(s): _dedupInflight */


import * as InflightDedup from './lib/inflightDedup.js';

const _dedupInflight = (typeof window !== 'undefined' && InflightDedup)
            ? InflightDedup.dedupInflight
            : function(reg, key, fn) { return fn(); };

export { _dedupInflight };
