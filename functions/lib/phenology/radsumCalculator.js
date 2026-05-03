/**
 * radsumCalculator.js — Daily RADSUM (MJ/m²) and DLI (mol/m²) integration.
 *
 * Source : phenology-tables.md §2 (RADSUM/DLI)
 *
 * Pure functions. Aucun I/O, aucune dépendance Firebase.
 *
 * Pipeline d'usage typique :
 *
 *   const enriched = estimateMissingRadiation(rawSamples, plot.parToRadiationRatio);
 *   const result   = calculateDailyRadsum(enriched);
 *   const status   = evaluateDliVsTarget(result.dliMolM2, stage.dli);
 *
 * Hypothèses sur les inputs :
 *   - Les samples passés à calculateDailyRadsum sont supposés couvrir une seule
 *     journée cohérente (filtrage par date côté appelant — Sprint 2 fera ça
 *     dans radiationFetcher.js).
 *   - Les samples ne sont pas nécessairement triés ; la fonction trie en interne.
 *   - Les timestamps invalides (NaN, undefined, non parseables) sont filtrés.
 */

/**
 * @typedef {import('./types').RadiationSample} RadiationSample
 * @typedef {import('./types').RadsumDailyResult} RadsumDailyResult
 * @typedef {import('./types').DliConfig} DliConfig
 * @typedef {import('./types').DliStatus} DliStatus
 * @typedef {import('./types').DataQuality} DataQuality
 */

// =====================================================================
// Constantes (pas de magic numbers dispersés)
// =====================================================================

/** Pas standard FarmRoad = 5 min → 288 samples/24h attendus */
const SAMPLES_EXPECTED_PER_DAY = 288;
/** Quality "good" si >= 240 samples valides (>83 % couverture) */
const SAMPLES_GOOD_THRESHOLD = 240;
/** Quality "partial" si >= 120 samples valides */
const SAMPLES_PARTIAL_THRESHOLD = 120;

/**
 * Stratégie de gap (V1) : si l'intervalle entre 2 samples consécutifs > 30 min,
 * on skip l'intervalle (ne contribue pas à l'intégrale). Plus sûr que d'extrapoler.
 * À raffiner Sprint 2+ si nécessaire (ex : interpolation linéaire pour gaps moyens).
 */
const MAX_GAP_MS = 30 * 60 * 1000;

/** Ratio PAR / Radiation totale par défaut (lumière solaire naturelle) */
const PAR_TO_RAD_RATIO_DEFAULT = 0.46;

/** Conversion : 1 W/m² PAR ≈ 4.57 µmol/m²/s (lumière solaire) */
const W_PAR_TO_UMOL = 4.57;

/**
 * Bornes physiques au-delà desquelles on suspecte une défaillance capteur.
 * Stratégie : valeurs négatives → filtrées (sample retiré). Valeurs > max → écrêtées (clamp)
 * pour ne pas perdre la continuité temporelle.
 */
const MAX_RADIATION_WM2 = 1500;        // soleil pic théorique ~1100, marge
const MAX_PAR_UMOL_M2_S = 3000;        // soleil pic théorique ~2300, marge

// =====================================================================
// Helpers internes
// =====================================================================

/**
 * Convertit un timestamp (Date | number | ISO string) en epoch ms.
 * @returns {number|null} ms epoch, ou null si non parseable
 */
function toMs(t) {
  if (t == null) return null;
  if (t instanceof Date) {
    const ms = t.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Filtre + clamp + trie les samples par timestamp croissant.
 * - Drop si timestamp non parseable
 * - Drop si les deux mesures sont absentes
 * - Drop si valeurs négatives sur la mesure considérée
 * - Clamp si > borne physique
 */
function sanitize(samples) {
  if (!Array.isArray(samples)) return [];
  const out = [];
  for (const s of samples) {
    if (s == null || typeof s !== 'object') continue;
    const ms = toMs(s.timestamp);
    if (ms == null) continue;

    let rad = s.radiationWm2;
    let par = s.parUmolM2s;

    // Filter negatives (capteur défaillant nuit, etc.)
    if (typeof rad !== 'number' || !Number.isFinite(rad) || rad < 0) rad = null;
    if (typeof par !== 'number' || !Number.isFinite(par) || par < 0) par = null;

    // Clamp aberrants (préserve la continuité temporelle)
    if (rad != null && rad > MAX_RADIATION_WM2) rad = MAX_RADIATION_WM2;
    if (par != null && par > MAX_PAR_UMOL_M2_S) par = MAX_PAR_UMOL_M2_S;

    if (rad == null && par == null) continue; // ni l'un ni l'autre → drop

    out.push({ _ms: ms, radiationWm2: rad, parUmolM2s: par });
  }
  out.sort((a, b) => a._ms - b._ms);
  return out;
}

/**
 * Intégration trapézoïdale : Σ (v_i + v_{i+1})/2 × Δt_seconds
 * Skip les intervalles dont Δt > MAX_GAP_MS (ne contribuent pas).
 * Skip les intervalles où l'une des 2 valeurs est null (mesure absente).
 *
 * @param {Array<{_ms:number, value:number|null}>} pts
 * @returns {number} aire en (unité de value) × secondes
 */
function trapezoidIntegrate(pts) {
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.value == null || b.value == null) continue;
    const dtMs = b._ms - a._ms;
    if (dtMs <= 0 || dtMs > MAX_GAP_MS) continue;
    area += ((a.value + b.value) / 2) * (dtMs / 1000); // value × seconds
  }
  return area;
}

// =====================================================================
// API publique
// =====================================================================

/**
 * Estime la mesure manquante (PAR ou Radiation) sur chaque sample en utilisant
 * le ratio PAR/Radiation. Appliqué AVANT intégration pour préserver la résolution
 * temporelle (cf. phenology-tables.md §2.2).
 *
 * Formules :
 *   Si parUmolM2s manquant : parUmolM2s = radiationWm2 × ratio × W_PAR_TO_UMOL
 *   Si radiationWm2 manquant : radiationWm2 = (parUmolM2s / W_PAR_TO_UMOL) / ratio
 *
 * Ne modifie pas les samples qui ont déjà les 2 mesures (priorité à la mesure
 * réelle). Renvoie un nouveau tableau (immutabilité).
 *
 * @param {RadiationSample[]} samples
 * @param {number} [parToRadRatio=0.46]   Ratio PAR/Radiation par parcelle
 * @returns {RadiationSample[]} samples enrichis (nouveau tableau)
 */
function estimateMissingRadiation(samples, parToRadRatio = PAR_TO_RAD_RATIO_DEFAULT) {
  if (!Array.isArray(samples)) return [];
  if (typeof parToRadRatio !== 'number' || !Number.isFinite(parToRadRatio) || parToRadRatio <= 0) {
    throw new RangeError(`estimateMissingRadiation: parToRadRatio must be > 0, got ${parToRadRatio}`);
  }
  return samples.map((s) => {
    if (s == null || typeof s !== 'object') return s;
    const out = Object.assign({}, s);
    const hasRad = typeof out.radiationWm2 === 'number' && Number.isFinite(out.radiationWm2);
    const hasPar = typeof out.parUmolM2s === 'number' && Number.isFinite(out.parUmolM2s);

    if (!hasRad && hasPar) {
      // PAR (µmol/m²/s) → W/m² PAR (÷ 4.57) → W/m² total (÷ ratio)
      out.radiationWm2 = (out.parUmolM2s / W_PAR_TO_UMOL) / parToRadRatio;
    }
    if (!hasPar && hasRad) {
      // W/m² total → W/m² PAR (× ratio) → µmol/m²/s (× 4.57)
      out.parUmolM2s = out.radiationWm2 * parToRadRatio * W_PAR_TO_UMOL;
    }
    return out;
  });
}

/**
 * Calcule RADSUM (MJ/m²) et DLI (mol/m²) sur les samples d'une journée par
 * intégration trapézoïdale, avec gestion des gaps et scoring qualité.
 *
 * Conversions d'unités :
 *   - Radiation (W/m²) intégrée sur t (s) → W·s/m² ; ÷ 1 000 000 → MJ/m²
 *   - PAR (µmol/m²/s) intégrée sur t (s) → µmol·s/m² ; ÷ 1 000 000 → mol/m²
 *
 * @param {RadiationSample[]} samples
 * @returns {RadsumDailyResult}
 */
function calculateDailyRadsum(samples) {
  const clean = sanitize(samples);
  const samplesUsed = clean.length;

  if (samplesUsed === 0) {
    return {
      radsumMjM2: 0,
      dliMolM2: 0,
      dataQuality: 'interpolated',
      samplesUsed: 0,
      samplesExpected: SAMPLES_EXPECTED_PER_DAY,
    };
  }

  const radPts = clean.map((s) => ({ _ms: s._ms, value: s.radiationWm2 }));
  const parPts = clean.map((s) => ({ _ms: s._ms, value: s.parUmolM2s }));

  const radWsPerM2 = trapezoidIntegrate(radPts);  // W·s/m²
  const parUmolSPerM2 = trapezoidIntegrate(parPts); // µmol·s/m²

  const radsumMjM2 = radWsPerM2 / 1_000_000;        // → MJ/m²
  const dliMolM2 = parUmolSPerM2 / 1_000_000;        // → mol/m²

  let dataQuality;
  if (samplesUsed >= SAMPLES_GOOD_THRESHOLD) dataQuality = 'good';
  else if (samplesUsed >= SAMPLES_PARTIAL_THRESHOLD) dataQuality = 'partial';
  else dataQuality = 'interpolated';

  return {
    radsumMjM2,
    dliMolM2,
    dataQuality,
    samplesUsed,
    samplesExpected: SAMPLES_EXPECTED_PER_DAY,
  };
}

/**
 * Évalue un DLI quotidien par rapport aux 4 seuils du stade phénologique.
 *
 *   below_critical : dli < critical_min
 *   below_target   : critical_min <= dli < target_min
 *   in_target      : target_min <= dli <= target_max
 *   above_target   : target_max < dli <= critical_max
 *   above_critical : dli > critical_max
 *
 * @param {number} dliDay
 * @param {DliConfig} dliConfig
 * @returns {DliStatus}
 */
function evaluateDliVsTarget(dliDay, dliConfig) {
  if (typeof dliDay !== 'number' || !Number.isFinite(dliDay)) {
    throw new TypeError(`evaluateDliVsTarget: dliDay must be a finite number, got ${dliDay}`);
  }
  if (dliConfig == null || typeof dliConfig !== 'object') {
    throw new TypeError('evaluateDliVsTarget: dliConfig is required');
  }
  const { target_min, target_max, critical_min, critical_max } = dliConfig;
  for (const [name, v] of [['target_min', target_min], ['target_max', target_max], ['critical_min', critical_min], ['critical_max', critical_max]]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`evaluateDliVsTarget: dliConfig.${name} must be a finite number`);
    }
  }
  if (!(critical_min <= target_min && target_min <= target_max && target_max <= critical_max)) {
    throw new RangeError('evaluateDliVsTarget: dliConfig must satisfy critical_min <= target_min <= target_max <= critical_max');
  }

  let status;
  if (dliDay < critical_min) status = 'below_critical';
  else if (dliDay < target_min) status = 'below_target';
  else if (dliDay <= target_max) status = 'in_target';
  else if (dliDay <= critical_max) status = 'above_target';
  else status = 'above_critical';

  return { status, stageMin: target_min, stageMax: target_max };
}

module.exports = {
  calculateDailyRadsum,
  estimateMissingRadiation,
  evaluateDliVsTarget,
  // exposés pour les tests (constantes documentées)
  __internals: {
    SAMPLES_EXPECTED_PER_DAY,
    SAMPLES_GOOD_THRESHOLD,
    SAMPLES_PARTIAL_THRESHOLD,
    MAX_GAP_MS,
    PAR_TO_RAD_RATIO_DEFAULT,
    W_PAR_TO_UMOL,
    MAX_RADIATION_WM2,
    MAX_PAR_UMOL_M2_S,
  },
};
