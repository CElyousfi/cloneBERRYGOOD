/**
 * primesImportParse.js — Pure parser for the Primes Fixes Excel import.
 *
 * Purpose: turn a raw 2D sheet (XLSX.utils.sheet_to_json(ws, {header:1})) into a
 * clean list of {matricule, montant}, tolerating the native "magasin" export
 * format: title rows + blank rows ABOVE the real header line, and header
 * aliases like `MTR` / `Prime dh Brut` with accents/casing/multi-space noise.
 *
 * PURE: receives a 2D array, no XLSX/DOM/network dependency. The downstream
 * CF import-primes (dry-run + numKey collision detection) is UNCHANGED — this
 * module only extracts {matricule, montant}.
 */
// @ts-check

// top-level const/var/function would risk colliding with another lib. Wrapping

// Header aliases (already normalized via normHeader).
var MATRICULE_ALIASES = ['matricule', 'mtr', 'mat', 'matr'];
var PRIME_ALIASES = ['prime', 'montant', 'prime dh brut', 'prime fonction', 'primefonction', 'prime dh'];

/**
 * Normalize a header cell: lower-case, strip accents (NFD), trim, collapse
 * multiple spaces to a single one.
 * @param {*} s raw cell value
 * @returns {string}
 */
function normHeader(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Find the header row and the matricule/prime column indexes in a 2D sheet.
 * Walks rows top-down, returns the FIRST row containing a cell whose
 * normHeader is a matricule alias; within that row, locates the prime column.
 * @param {Array<Array<*>>} rows2d
 * @returns {{headerIndex:number, colMatricule:(number|null), colPrime:(number|null)}}
 */
function findHeaderRow(rows2d) {
    if (!Array.isArray(rows2d)) return { headerIndex: -1, colMatricule: null, colPrime: null };
    for (var i = 0; i < rows2d.length; i++) {
        var row = rows2d[i];
        if (!Array.isArray(row)) continue;
        var colMatricule = null;
        var colPrime = null;
        for (var j = 0; j < row.length; j++) {
            var h = normHeader(row[j]);
            if (!h) continue;
            if (colMatricule === null && MATRICULE_ALIASES.indexOf(h) !== -1) colMatricule = j;
            if (colPrime === null && PRIME_ALIASES.indexOf(h) !== -1) colPrime = j;
        }
        if (colMatricule !== null) {
            return { headerIndex: i, colMatricule: colMatricule, colPrime: colPrime };
        }
    }
    return { headerIndex: -1, colMatricule: null, colPrime: null };
}

/**
 * Extract {matricule, montant} rows from a 2D sheet.
 * @param {Array<Array<*>>} rows2d
 * @returns {{rows:Array<{matricule:string, montant:number}>, headerIndex:number, error?:string}}
 */
function extractPrimesRows(rows2d) {
    var found = findHeaderRow(rows2d);
    if (found.headerIndex === -1 || found.colMatricule === null) {
        return {
            rows: [],
            headerIndex: -1,
            error: 'En-tête Matricule introuvable (colonnes attendues: Matricule/MTR, Prime/Montant)',
        };
    }
    var colMat = found.colMatricule;
    var colPrime = found.colPrime;
    var out = [];
    for (var i = found.headerIndex + 1; i < rows2d.length; i++) {
        var row = rows2d[i];
        if (!Array.isArray(row)) continue;
        var matricule = String(row[colMat] == null ? '' : row[colMat]).trim();
        if (!matricule) continue;
        var montant = (colPrime === null) ? 0 : (Number(row[colPrime]) || 0);
        out.push({ matricule: matricule, montant: montant });
    }
    return { rows: out, headerIndex: found.headerIndex };
}

export { normHeader, MATRICULE_ALIASES, PRIME_ALIASES, findHeaderRow, extractPrimesRows };
