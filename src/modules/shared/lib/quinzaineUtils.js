/**
 * quinzaineUtils.js — Pure helpers for the "Quinzaine" transport indemnity.
 *
 * All functions are pure (no DOM, no network, no Firestore, no hardcoded totals).
 *
 * Source of truth for the Transport (indemnité) computation shared by the two
 * screens that used to duplicate it and diverged by 240 DH (Quinzaine 01):
 *   - Écran Quinzaine  (QuinzaineTab, "RECAP QUINZAINE EN COURS")
 *   - Écran Primes     (PrimesRecapSub)
 *
 * Root cause of the 240 DH divergence (spec docs/spec-quinzaine-cout-charge.md §Lot 1):
 *   (a) two divergent local `getEqPrefix` (unknown-matricule fallback 'NV'/'XX' vs null);
 *   (b) an asymmetric ferme/sub filter (Quinzaine filtered, Primes did not).
 * This module encodes ONE deterministic getEqPrefix and ONE compute function so both
 * screens converge, at equal ferme/sub scope, for any real NV status.
 */
// @ts-check

/**
 * Resolve the transport equipe prefix for a worker matricule — SINGLE, deterministic
 * behaviour shared by both screens (replaces the two divergent local implementations).
 *
 * Rules, applied in order:
 *   1. empty/falsy matricule            → null (ignored)
 *   2. first 2 chars ∈ knownPrefixes    → those 2 chars
 *   3. matricule starts with 'HAFI'/'HA' → 'HA'   (El Hafi)
 *   4. matricule starts with 'DD'        → 'NV'   (NV equipe)
 *   5. otherwise (unknown)               → null (ignored)
 *
 * DESIGN DECISION (unknown matricule): a non-mappable matricule returns `null` and is
 * therefore IGNORED by the caller (`if (!eq) continue;`), identically on both screens.
 * The previous Quinzaine fallback ('NV'/'XX') was harmless-but-inconsistent: 'XX' is
 * never in transportEquipes so it summed to 0 anyway, while 'NV' would wrongly attach an
 * unknown worker to the real NV equipe. Returning `null` is the safe, explicit, non-
 * divergent choice: an unknown worker never inflates any equipe on either screen. Note
 * the explicit `DD → 'NV'` rule (step 4) is preserved: 'DD'-prefixed matricules ARE the
 * NV equipe and are still counted — only genuinely unmappable matricules are dropped.
 *
 * @param {string} matricule — worker matricule (case-insensitive, trimmed internally).
 * @param {Array<string>} knownPrefixes — the transport equipe prefixes in play
 *   (e.g. transportEquipes.map(t => t.prefix)). Determines which 2-char prefixes map.
 * @returns {string | null} the equipe prefix, or null when the matricule is unmappable.
 */
function getEqPrefix(matricule, knownPrefixes) {
  if (!matricule) return null;
  const m = String(matricule).toUpperCase().trim();
  if (!m) return null;
  const p2 = m.substring(0, 2);
  const known = Array.isArray(knownPrefixes) ? knownPrefixes : [];
  if (known.indexOf(p2) !== -1) return p2;
  if (m.indexOf('HAFI') === 0 || m.indexOf('HA') === 0) return 'HA';
  if (m.indexOf('DD') === 0) return 'NV';
  return null;
}

/**
 * Compute the total Transport (indemnité) for one quinzaine — SINGLE source, consumed
 * by both the Quinzaine and Primes screens so they converge at equal ferme/sub scope.
 *
 * Rule encoded (NOT the number): an equipe is counted for a given day ssi it has at
 * least one pointage row in `rows` for that (day, equipe) within the selected period
 * (and ferme/sub scope, when provided). The tariff is `coutMap[prefix]` (versioned by
 * quinzaine upstream). The total is:
 *
 *   Σ_day Σ_equipe ( #distinct matricules(day, equipe) × coutMap[equipe] )
 *
 * No total is hardcoded (neither 16 865 nor 16 625): it resolves from `rows`. If the NV
 * equipe has validated pointage rows, it is counted (→ higher total); if not, it is not.
 *
 * @param {Array<{ matricule: string, jour: string, periode: string, ferme?: string,
 *   refParcelle?: string, parcelle?: string }>} rows — pointage rows (transport source).
 * @param {{
 *   periode: string,
 *   transportEquipes: Array<{ prefix: string }>,
 *   coutMap: Object<string, number>,
 *   ferme?: (string | null),
 *   sub?: (string | null),
 *   matchSub?: ((row: object) => boolean)
 * }} opts
 *   - periode: only rows with `row.periode === periode` are considered.
 *   - transportEquipes: the equipes to sum over (only these prefixes contribute).
 *   - coutMap: prefix → tarif (DH per worker-day) for this quinzaine.
 *   - ferme: when truthy, only rows with `row.ferme === ferme` are considered.
 *   - matchSub: optional predicate; when provided, only rows where matchSub(row) is
 *     truthy are considered (sub-farm filter, e.g. Avocatier). `sub` is accepted for
 *     API symmetry/documentation; the actual filtering is delegated to matchSub.
 * @returns {{
 *   total: number,
 *   totalWorkers: number,
 *   dates: Array<string>,
 *   byEquipe: Array<{ prefix: string, totalWorkers: number, total: number }>,
 *   dailyByEquipe: Object<string, Object<string, Set<string>>>
 * }}
 */
function computeTransportQuinzaine(rows, opts) {
  /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
  const o = opts || {};
  const periode = o.periode;
  const transportEquipes = Array.isArray(o.transportEquipes) ? o.transportEquipes : [];
  const coutMap = o.coutMap || {};
  const ferme = o.ferme != null ? o.ferme : null;
  const matchSub = typeof o.matchSub === 'function' ? o.matchSub : null;
  const knownPrefixes = transportEquipes.map(t => t && t.prefix);

  const scoped = (Array.isArray(rows) ? rows : []).filter(r => {
    if (!r || r.periode !== periode) return false;
    if (ferme && r.ferme !== ferme) return false;
    if (matchSub && !matchSub(r)) return false;
    return true;
  });

  // dailyByEquipe[jour][prefix] = Set of distinct matricules that day for that equipe.
  /** @type {Object<string, Object<string, Set<string>>>} */
  const dailyByEquipe = {};
  scoped.forEach(r => {
    const eq = getEqPrefix(r.matricule, knownPrefixes);
    if (!eq) return;
    const d = r.jour;
    if (!dailyByEquipe[d]) dailyByEquipe[d] = {};
    if (!dailyByEquipe[d][eq]) dailyByEquipe[d][eq] = new Set();
    dailyByEquipe[d][eq].add(r.matricule);
  });

  const dates = [...new Set(scoped.map(r => r.jour))].sort();

  let total = 0;
  let totalWorkers = 0;
  /** @type {Array<{ prefix: string, totalWorkers: number, total: number }>} */
  const byEquipe = [];
  transportEquipes.forEach(t => {
    const prefix = t && t.prefix;
    if (!prefix) return;
    const tarif = coutMap[prefix] || 0;
    let eqWorkers = 0;
    dates.forEach(d => {
      const n = (dailyByEquipe[d] && dailyByEquipe[d][prefix]) ? dailyByEquipe[d][prefix].size : 0;
      eqWorkers += n;
    });
    const eqTotal = eqWorkers * tarif;
    total += eqTotal;
    totalWorkers += eqWorkers;
    byEquipe.push({ prefix, totalWorkers: eqWorkers, total: eqTotal });
  });

  return { total, totalWorkers, dates, byEquipe, dailyByEquipe };
}

export { getEqPrefix, computeTransportQuinzaine };
