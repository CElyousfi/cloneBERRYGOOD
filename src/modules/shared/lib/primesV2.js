/**
 * primesV2.js — Pure helpers for Primes Fixes V2 (Phase 1, frontend only).
 *
 * Two features, both PURE (no DOM / network / Firestore):
 *   A) searchWorkers  — search the FULL registry (all workers already in memory)
 *      by matricule OR nom, IGNORING the prime>0 display filter. Used by the
 *      « + Ajouter / initier une prime » modal so a worker at 0 can be found.
 *   B) buildHistoryView — read-only view of prime_history: sorted by changedAt
 *      DESCENDING and normalized for display. Empty/absent → [].
 *
 * NO WRITE. The actual write stays on the gated CF callPrimesCF('save-prime').
 */
// @ts-check

// top-level const/var/function would risk colliding with another lib. Wrapping

/**
 * Tolerant text match: lower-case, strip accents (NFD), substring.
 * @param {*} text
 * @param {*} query
 * @returns {boolean}
 */
function matches(text, query) {
    var q = norm(query);
    if (!q) return true;
    return norm(text).indexOf(q) !== -1;
}

/**
 * Normalize for comparison: string, lower-case, accents stripped, trimmed.
 * @param {*} s
 * @returns {string}
 */
function norm(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
}

/**
 * Search the full worker list (all registry docs already in memory) by
 * matricule OR nom. IGNORES the prime>0 display filter on purpose so a
 * worker currently at 0 can be found and initiated.
 *
 * @param {Array<{matricule?:*, docId?:*, nom?:*, prime?:*}>} rows
 * @param {*} query
 * @param {number} [limit] max results (default 50)
 * @returns {Array<{docId:string, matricule:string, nom:string, prime:number}>}
 */
function searchWorkers(rows, query, limit) {
    var max = (typeof limit === 'number' && limit > 0) ? limit : 50;
    var q = norm(query);
    if (!q) return [];
    var list = Array.isArray(rows) ? rows : [];
    var out = [];
    for (var i = 0; i < list.length && out.length < max; i++) {
        var r = list[i] || {};
        var docId = String(r.docId != null ? r.docId : (r.matricule != null ? r.matricule : ''));
        var mat = String(r.matricule != null ? r.matricule : docId);
        var nom = String(r.nom == null ? '' : r.nom);
        if (matches(mat, query) || matches(nom, query)) {
            out.push({ docId: docId, matricule: mat, nom: nom, prime: Number(r.prime) || 0 });
        }
    }
    return out;
}

/**
 * Build a read-only, display-ready view of a worker's prime_history:
 * sorted by changedAt DESCENDING, each entry normalized. Absent/empty
 * history → []. NO write, NO mutation of the input.
 *
 * @param {Array<{montant?:*, previousMontant?:*, effectiveFrom?:*, changedBy?:*, changedAt?:*}>} history
 * @returns {Array<{montant:number, previousMontant:number, effectiveFrom:string, author:string, changedAt:(number|null)}>}
 */
function buildHistoryView(history) {
    if (!Array.isArray(history) || history.length === 0) return [];
    var copy = history.slice();
    copy.sort(function (a, b) {
        var ta = Number((a && a.changedAt) || 0);
        var tb = Number((b && b.changedAt) || 0);
        return tb - ta;
    });
    return copy.map(function (e) {
        e = e || {};
        var by = e.changedBy || {};
        var author = String(by.name || by.profileId || '—');
        var at = (e.changedAt == null || e.changedAt === '') ? null : Number(e.changedAt);
        return {
            montant: Number(e.montant) || 0,
            previousMontant: Number(e.previousMontant) || 0,
            effectiveFrom: String(e.effectiveFrom == null ? '' : e.effectiveFrom),
            author: author,
            changedAt: (at != null && !isNaN(at)) ? at : null,
        };
    });
}

export { norm, matches, searchWorkers, buildHistoryView };
