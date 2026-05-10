/**
 * Numeric & time helpers — defensive against null/NaN/strings.
 */

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Average of an array, ignoring null/NaN/<=0. Returns null if no positive value.
 * @param {Array<number|null|undefined>} arr
 * @returns {number|null}
 */
function avgPositive(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let sum = 0, n = 0;
  for (const v of arr) {
    if (isPositiveNumber(v)) { sum += v; n++; }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Sum of an array, ignoring null/NaN/<=0. Returns null if no positive value.
 * @param {Array<number|null|undefined>} arr
 * @returns {number|null}
 */
function sumPositive(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let sum = 0, n = 0;
  for (const v of arr) {
    if (isPositiveNumber(v)) { sum += v; n++; }
  }
  return n > 0 ? sum : null;
}

/**
 * Parse "HH:MM" into minutes-from-midnight. null on invalid input.
 * @param {string|null|undefined} s
 * @returns {number|null}
 */
function parseHeure(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mn)) return null;
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
  return h * 60 + mn;
}

/**
 * Format minutes-from-midnight back to "HH:MM". null-safe.
 * @param {number|null} min
 * @returns {string|null}
 */
function formatMinutes(min) {
  if (!Number.isFinite(min) || min < 0 || min > 24 * 60) return null;
  const h = Math.floor(min / 60);
  const mn = Math.floor(min % 60);
  return String(h).padStart(2, '0') + ':' + String(mn).padStart(2, '0');
}

/**
 * Group an array by a key function.
 * @template T
 * @param {T[]} arr
 * @param {(item: T) => string} keyFn
 * @returns {Record<string, T[]>}
 */
function groupBy(arr, keyFn) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    const k = keyFn(item);
    if (k === null || k === undefined) continue;
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

module.exports = {
  isPositiveNumber,
  toNumber,
  avgPositive,
  sumPositive,
  parseHeure,
  formatMinutes,
  groupBy,
};
