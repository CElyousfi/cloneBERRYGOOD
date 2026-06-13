'use strict';
// @ts-check

/**
 * productionEstimation.js — Backend mirror of the frontend Production tab
 * "Estimation" mode for Cycle 2 varieties.
 *
 * Reproduces fidelity-level the logic at:
 *   - public/app.jsx:13899-13927  (mapped: bons d'apport normalization)
 *   - public/app.jsx:13930-14028  (mappedWithEstimation: bons + late expeditions)
 *   - public/app.jsx:14134-14159  (cycle2Stats)
 *   - public/app.jsx:14554-14559  (pctBudget per card)
 *   - public/app.jsx:58114-58121  (applyVarietyMapping)
 *
 * All helpers are pure (no Firestore calls). The Firestore reads happen
 * upstream in dailyProductionReport.js.
 */

const { normalizeParcelle, getHaByCycle, getPlantsByCycle, getCycle } = require('../parcellesCulturales');
const { BUDGET_BGF } = require('./budgetBgf');

/** Fixed 6 cycle-2 varieties shown in the "Rendement Cycle 2" cards. */
const CYCLE2_VARIETIES = [
  'Maravilla Green Cane',
  'Maravilla Long Cane',
  'Yazmin Bi Cycle',
  'Corina',
  'Breeze',
  'Cascade',
];

const KNOWN_SOUS = ['Green Cane', 'Long Cane', 'Mow Down', 'Bi Cycle', 'Cut Back', 'Nouvelle plantation'];
const SKIP_DESIGNATION_TOKENS = ['DECHET', 'PLASTIQUE', 'EMBALLAGE', 'PALETTE', 'CARTON VIDE', 'BOIS'];

/**
 * Split "Maravilla Green Cane" → { baseV: 'Maravilla', sousV: 'Green Cane' }
 * @param {string} variety
 */
function splitVariety(variety) {
  for (const sv of KNOWN_SOUS) {
    if (variety && variety.endsWith(sv)) {
      return { baseV: variety.slice(0, -(sv.length + 1)), sousV: sv };
    }
  }
  return { baseV: variety || '', sousV: null };
}

/**
 * Mirror frontend getHa: try with sousVariete first, then fallback without.
 * @param {string} variety
 * @param {string|null} ferme
 * @param {number} cycle
 */
function getHa(variety, ferme, cycle) {
  const { baseV, sousV } = splitVariety(variety);
  const ha = getHaByCycle(baseV, sousV, ferme, cycle);
  if (ha > 0) return ha;
  return getHaByCycle(baseV, null, ferme, cycle);
}

/**
 * Mirror frontend getPlants: same fallback logic.
 * @param {string} variety
 * @param {string|null} ferme
 * @param {number} cycle
 */
function getPlants(variety, ferme, cycle) {
  const { baseV, sousV } = splitVariety(variety);
  const plants = getPlantsByCycle(baseV, sousV, ferme, cycle);
  if (plants > 0) return plants;
  return getPlantsByCycle(baseV, null, ferme, cycle);
}

/**
 * Frontend applyVarietyMapping (public/app.jsx:58114) — derive variety from
 * the Driscoll's batch number prefix when a mapping override exists.
 * @param {Record<string,string>} mapping
 * @param {string} batchNumber
 * @param {string} originalVariety
 */
function applyVarietyMapping(mapping, batchNumber, originalVariety) {
  if (!batchNumber || !batchNumber.includes('-')) return originalVariety || '-';
  const parts = batchNumber.split('-');
  const code = parts[0].slice(-3) + '-' + parts[1].slice(0, 4);
  const legacyCode = parts[0].slice(-3) + '-' + parts[1].slice(0, 3);
  return mapping[code] || mapping[legacyCode] || originalVariety || '-';
}

/**
 * Frontend `mapped` logic (public/app.jsx:13899).
 * Normalize one raw pfq_interne doc into the unified shape.
 *
 * @param {object} b - Raw pfq_interne doc
 * @returns {object|null} normalized bon, or null if filtered out
 */
function normalizeBon(b) {
  if (!b) return null;
  if (b.status === 'rejete_qualite' || b.status === 'rejete_chef') return null;
  const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
  const cycle = getCycle(b.date);
  const variety = resolved
    ? (resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete)
    : (b.blocVariete || '?');
  const rawType = b.typeVente || '';
  const typeVente = (rawType === "Driscoll's" || rawType === 'EXP') ? 'Export'
    : rawType === 'ECRT' ? 'Marché Local'
    : rawType || '';
  const ferme = resolved
    ? resolved.ferme
    : String(b.blocFerme || '').replace('-', '').replace('F 0', 'F').replace('F-0', 'F').replace('F-', 'F');
  const kg = parseFloat(b.poidsLot) || 0;
  if (kg <= 0) return null;
  const designationUp = [b.designation, variety, b.blocVariete, b.blocLabel]
    .filter(Boolean).join(' ').toUpperCase();
  if (SKIP_DESIGNATION_TOKENS.some(t => designationUp.includes(t))) return null;
  return {
    id: b.id || null,
    variety,
    baseVariety: resolved ? resolved.variete : (b.blocVariete || '?'),
    ferme,
    culture: resolved ? resolved.culture : 'Framboise',
    cycle,
    kg,
    dateISO: b.date || '',
    typeVente,
    client: b.client || '',
    createdAt: b.createdAt || null,
  };
}

/**
 * Map a raw pfq_interne `typeVente` to the unified canonical value.
 * Mirrors `normalizeBon` (Driscoll's / EXP → Export, ECRT → Marché Local).
 * @param {string} rawType
 * @returns {string}
 */
function canonicalTypeVente(rawType) {
  const t = rawType || '';
  return (t === "Driscoll's" || t === 'EXP') ? 'Export'
    : t === 'ECRT' ? 'Marché Local'
    : t || '';
}

/**
 * Pure helper: sum the exported kg (poidsLot) across raw pfq_interne docs.
 * Only docs whose canonical typeVente === 'Export' are counted. Rejected bons
 * (status rejete_qualite / rejete_chef) are excluded. Missing/invalid poidsLot
 * counts as 0.
 * @param {Array<object>} docs - Raw pfq_interne docs
 * @returns {number} total exported kg
 */
function sumExportKgForDocs(docs) {
  if (!Array.isArray(docs)) return 0;
  let sum = 0;
  for (const b of docs) {
    if (!b) continue;
    if (b.status === 'rejete_qualite' || b.status === 'rejete_chef') continue;
    if (canonicalTypeVente(b.typeVente) !== 'Export') continue;
    const kg = parseFloat(b.poidsLot);
    if (Number.isFinite(kg) && kg > 0) sum += kg;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Parse an expedition's date string (MM/DD/YYYY — Driscoll's US format — or
 * YYYY-MM-DD ISO) to YYYY-MM-DD.
 * Mirrors the frontend parser at public/app.jsx:13975 which does
 * `m[3] + '-' + m[1] + '-' + m[2]` = year-month-day from MM/DD/YYYY.
 * @param {string} raw
 * @returns {string} YYYY-MM-DD or ''
 */
function parseExpDateISO(raw) {
  if (!raw) return '';
  const s = String(raw);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  if (s.length >= 10 && s[4] === '-') return s.slice(0, 10);
  return '';
}

/**
 * Frontend mappedWithEstimation (public/app.jsx:13930) — produce a unified
 * list of bons d'apport augmented by synthetic bons built from expeditions
 * received AFTER the last bon date per variety.
 *
 * @param {object} opts
 * @param {Array} opts.bons          - Raw pfq_interne docs
 * @param {Array} opts.expeditions   - Raw expedition docs
 * @param {Record<string,string>} [opts.varietyMapping]
 * @param {string} [opts.asOfDate]   - YYYY-MM-DD upper bound (default: today UTC)
 * @param {boolean} [opts.trace]     - if true, returns a diagnostic object instead of array
 * @returns {Array|object} when !trace: mapped + syntheticBons. when trace: full diag.
 */
function buildMappedWithEstimation({ bons, expeditions, varietyMapping = {}, asOfDate, trace = false } = {}) {
  const mapped = (bons || []).map(normalizeBon).filter(Boolean);
  const today = asOfDate || new Date().toISOString().slice(0, 10);

  // Filter `mapped` to <= asOfDate so estimation is reproducible for any date.
  const mappedFiltered = mapped.filter(b => !b.dateISO || b.dateISO <= today);

  if (!expeditions || expeditions.length === 0) {
    return trace
      ? { mapped: mappedFiltered, lastBonDateByVariety: {}, lastBonDateByBase: {}, subVarietiesByBase: {}, syntheticBons: [], skippedExpeditions: [] }
      : mappedFiltered;
  }

  // 1) Build lastBonDateByVariety / lastBonDateByBase / kgByVariety
  const lastBonDateByVariety = {};
  const lastBonDateByBase = {};
  const kgByVariety = {};
  mappedFiltered.forEach(b => {
    if (!b.dateISO || !b.variety) return;
    if (!lastBonDateByVariety[b.variety] || b.dateISO > lastBonDateByVariety[b.variety]) {
      lastBonDateByVariety[b.variety] = b.dateISO;
    }
    const base = b.baseVariety || b.variety;
    if (!lastBonDateByBase[base] || b.dateISO > lastBonDateByBase[base]) {
      lastBonDateByBase[base] = b.dateISO;
    }
    kgByVariety[b.variety] = (kgByVariety[b.variety] || 0) + b.kg;
  });

  // 2) Build subVarietiesByBase: pick the most-recent sub-variety as the
  //    100% receiver for any expedition that lacks an exact variety match.
  const subVarietiesByBase = {};
  Object.entries(kgByVariety).forEach(([variety]) => {
    const resolved = normalizeParcelle(variety);
    const base = resolved ? resolved.variete : variety;
    if (!subVarietiesByBase[base]) subVarietiesByBase[base] = [];
    subVarietiesByBase[base].push({ variety, share: 0 });
  });
  Object.entries(subVarietiesByBase).forEach(([, subs]) => {
    let mostRecent = null;
    let mostRecentDate = '';
    subs.forEach(v => {
      const d = lastBonDateByVariety[v.variety] || '';
      if (d > mostRecentDate) { mostRecentDate = d; mostRecent = v; }
    });
    subs.forEach(v => { v.share = v === mostRecent ? 1 : 0; });
  });

  // 3) For each expedition, build a synthetic bon if applicable.
  const syntheticBons = [];
  const skippedExpeditions = trace ? [] : null;
  const seenBatches = new Set();
  const skip = (exp, reason, extra) => {
    if (!trace) return;
    skippedExpeditions.push({
      batchNumber: exp && exp.batchNumber || null,
      date: exp && (exp.date || exp.inspectedDate) || null,
      variety: exp && exp.variety || null,
      batchWeight: exp && exp.batchWeight || null,
      reason,
      ...(extra || {}),
    });
  };
  (expeditions || []).forEach((exp, idx) => {
    if (!exp) return;
    if (exp.batchNumber && seenBatches.has(exp.batchNumber)) { skip(exp, 'duplicate-batch'); return; }
    if (exp.batchNumber) seenBatches.add(exp.batchNumber);
    // Skip ghost PFQ expeditions (source=email with no receiptId/variety).
    if (exp.source === 'email' && !exp.receiptId && !exp.variety) { skip(exp, 'ghost-pfq'); return; }
    if ((exp.overallResult || '').toUpperCase() === 'REJECT') { skip(exp, 'rejected'); return; }
    if (typeof exp.status === 'string' && exp.status.includes('Annulée')) { skip(exp, 'cancelled'); return; }

    const dateISO = parseExpDateISO(exp.date || exp.inspectedDate || '');
    if (!dateISO) { skip(exp, 'no-date'); return; }
    if (dateISO > today) { skip(exp, 'future-date', { dateISO, asOfDate: today }); return; }

    const rawVariety = applyVarietyMapping(varietyMapping, exp.batchNumber, exp.variety);
    if (!rawVariety || rawVariety === '-') { skip(exp, 'no-variety', { rawVariety }); return; }
    const resolved = normalizeParcelle(rawVariety);
    const variety = resolved
      ? (resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete)
      : rawVariety;
    const baseVar = resolved ? resolved.variete : variety;
    const expKg = parseFloat(exp.batchWeight) || 0;
    if (expKg <= 0) { skip(exp, 'no-weight'); return; }
    const cycle = getCycle(dateISO);

    const lastBonDate = lastBonDateByVariety[variety];
    if (lastBonDate) {
      if (dateISO <= lastBonDate) { skip(exp, 'before-last-bon', { variety, dateISO, lastBonDate }); return; }
      const bon = {
        id: `est_${idx}`,
        variety,
        baseVariety: baseVar,
        ferme: resolved ? resolved.ferme : '',
        culture: resolved ? resolved.culture : 'Framboise',
        cycle,
        kg: expKg,
        dateISO,
        typeVente: 'Export',
        client: '',
        _isEstimation: true,
      };
      if (trace) bon._reason = 'exact-match';
      syntheticBons.push(bon);
    } else if (subVarietiesByBase[baseVar]) {
      const fallbackDate = lastBonDateByBase[baseVar];
      if (!fallbackDate || dateISO <= fallbackDate) { skip(exp, 'fallback-before-last-bon', { baseVar, dateISO, fallbackDate }); return; }
      subVarietiesByBase[baseVar].forEach((sub, subIdx) => {
        if (sub.share <= 0) return;
        const bon = {
          id: `est_${idx}_${subIdx}`,
          variety: sub.variety,
          baseVariety: baseVar,
          ferme: resolved ? resolved.ferme : '',
          culture: resolved ? resolved.culture : 'Framboise',
          cycle,
          kg: expKg * sub.share,
          dateISO,
          typeVente: 'Export',
          client: '',
          _isEstimation: true,
        };
        if (trace) bon._reason = 'fallback-most-recent-sub';
        syntheticBons.push(bon);
      });
    } else {
      skip(exp, 'no-matching-variety', { variety, baseVar, rawVariety });
    }
  });

  if (trace) {
    return { mapped: [...mappedFiltered, ...syntheticBons], lastBonDateByVariety, lastBonDateByBase, subVarietiesByBase, syntheticBons, skippedExpeditions };
  }
  return [...mappedFiltered, ...syntheticBons];
}

/**
 * Frontend cycle2Stats (public/app.jsx:14134) + budget % from card render
 * (public/app.jsx:14554-14559).
 *
 * @param {Array} mapped
 * @returns {Array<{
 *   variety: string,
 *   culture: 'Framboise'|'Myrtille',
 *   kgExport: number, kgLocal: number, kg: number,
 *   ha: number, plants: number,
 *   pctLocal: string,            // formatted with 1 decimal, '0.0' if no data
 *   rendement: string,           // formatted T/Ha or Kg/Pl (or g/Pl)
 *   rendementLabel: 'T/Ha'|'Kg/Pl'|'g/Pl',
 *   tonnageExport: string,       // 2-decimal "37.47"
 *   budgetTotal: number,         // raw target (kg/ha)
 *   pctBudget: string|null,      // integer percent string or null
 * }>}
 */
function computeCycle2Stats(mapped, opts = {}) {
  const fermeFilter = opts.ferme || null;
  // Filter by cycle, variety list, and (optionally) by ferme.
  const c2 = (mapped || []).filter(e =>
    e.cycle === 2 &&
    CYCLE2_VARIETIES.includes(e.variety) &&
    (!fermeFilter || e.ferme === fermeFilter)
  );
  const acc = {};
  c2.forEach(e => {
    const v = e.variety;
    if (!acc[v]) acc[v] = { variety: v, kgExport: 0, kgLocal: 0, kg: 0 };
    acc[v].kg += e.kg;
    if (e.typeVente === 'Export') acc[v].kgExport += e.kg;
    else acc[v].kgLocal += e.kg;
  });
  // When a ferme is requested, only return varieties present in that ferme
  // (others would all show zero — pollution).
  const varieties = fermeFilter
    ? CYCLE2_VARIETIES.filter(v => getHa(v, fermeFilter, 2) > 0)
    : CYCLE2_VARIETIES;
  return varieties.map(v => acc[v] || { variety: v, kgExport: 0, kgLocal: 0, kg: 0 }).map(s => {
    const resolved = normalizeParcelle(s.variety);
    const culture = resolved ? resolved.culture : 'Framboise';
    const ha = getHa(s.variety, fermeFilter, 2);
    const plants = getPlants(s.variety, fermeFilter, 2);
    const pctLoc = (s.kgLocal + s.kgExport) > 0
      ? (s.kgLocal / (s.kgLocal + s.kgExport) * 100).toFixed(1)
      : '0.0';
    const kgPerPlant = plants > 0 ? s.kgExport / plants : 0;
    let rendement = '-';
    let rendementLabel = culture === 'Myrtille' ? 'Kg/Pl' : 'T/Ha';
    if (culture === 'Myrtille') {
      if (plants > 0) {
        if (kgPerPlant < 1) {
          rendement = String(Math.round(kgPerPlant * 1000));
          rendementLabel = 'g/Pl';
        } else {
          rendement = kgPerPlant.toFixed(2);
          rendementLabel = 'Kg/Pl';
        }
      }
    } else if (ha > 0) {
      rendement = (s.kgExport / 1000 / ha).toFixed(2);
    }
    const tonnageExport = (s.kgExport / 1000).toFixed(2);

    const budgetCfg = BUDGET_BGF[s.variety];
    const budgetTotal = budgetCfg ? budgetCfg.total : 0;
    const reelKgHa = ha > 0 ? s.kgExport / ha : 0;
    const pctBudget = budgetTotal > 0 ? (reelKgHa / budgetTotal * 100).toFixed(0) : null;

    return {
      ...s, culture, ha, plants,
      pctLocal: pctLoc,
      rendement, rendementLabel,
      tonnageExport,
      budgetTotal,
      pctBudget,
    };
  });
}

/**
 * Build the WhatsApp text block for the Cycle 2 estimation cards.
 * @param {ReturnType<typeof computeCycle2Stats>} stats
 * @returns {string}
 */
function formatCycle2Section(stats) {
  const lines = [];
  lines.push('🎯 *Estimation Cycle 2*');
  lines.push('_(bons + expéditions après dernier bon)_');

  const framboises = stats.filter(s => s.culture !== 'Myrtille');
  const myrtilles  = stats.filter(s => s.culture === 'Myrtille');

  const renderCard = (s) => {
    const head = `• *${s.variety}* — ${s.rendement} ${s.rendementLabel}`;
    const budget = s.pctBudget !== null ? `Budget: ${s.pctBudget}%` : 'Budget: —';
    const local = `Local: ${s.pctLocal}%`;
    const plants = s.plants > 0 ? ` · ${s.plants.toLocaleString('fr-FR')} pl.` : '';
    const exp = `Export: ${s.tonnageExport} T${plants}`;
    return `${head}\n  ${budget} · ${local}\n  ${exp}`;
  };

  if (framboises.length) {
    lines.push('');
    lines.push('🍇 *Framboise*');
    framboises.forEach(s => lines.push(renderCard(s)));
  }
  if (myrtilles.length) {
    lines.push('');
    lines.push('🫐 *Myrtille*');
    myrtilles.forEach(s => lines.push(renderCard(s)));
  }
  return lines.join('\n');
}

module.exports = {
  CYCLE2_VARIETIES,
  splitVariety,
  applyVarietyMapping,
  parseExpDateISO,
  canonicalTypeVente,
  sumExportKgForDocs,
  normalizeBon,
  buildMappedWithEstimation,
  computeCycle2Stats,
  formatCycle2Section,
  getHa,
  getPlants,
};
