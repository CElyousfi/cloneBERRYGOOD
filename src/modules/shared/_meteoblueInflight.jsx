/* Module: shared | Déclaration(s): _meteoblueInflight */


// 15 min
        // In-flight dedup registry: concurrent callers on the SAME cacheKey reuse
        // the running promise instead of firing a redundant meteoblue request.
        // Cleared on settle by dedupInflight (helper: shared/lib/inflightDedup.js).
        const _meteoblueInflight = {};

export { _meteoblueInflight };
