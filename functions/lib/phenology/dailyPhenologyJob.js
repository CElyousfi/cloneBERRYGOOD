/**
 * dailyPhenologyJob.js — T6 orchestrateur Sprint 2.
 *
 * Pipeline daily : pour chaque plot avec phenology.enabled=true :
 *   1. resolveStation(plot)                                       T2
 *   2. fetchRadiationDaily({station, plotLocation, date, ratio})  T4
 *   3. loadReference(variety, cycleType)                          T1
 *   4. read previous phenology_daily/{plotId}/{J-1}               (cumul source)
 *   5. calculateDailyGdd({tMin, tMax, tBase, tCap})               Sprint 1
 *   6. estimateMissingRadiation + calculateDailyRadsum            Sprint 1
 *   7. cumuls = previous + day
 *   8. resolveStage(newGddCumul, ref, {precocityCoefficient, customStageThresholds})  Sprint 1
 *   9. evaluateDliVsTarget(dliDay, stage.dli)                     Sprint 1
 *   10. getIrrigationRecipe(stage.code, ref)                       Sprint 1
 *   11. writePhenologyDaily(plotId, date, computed, deps)         T5
 *
 * Gestion d'erreur par plot : si plot X plante, plot Y continue.
 * Erreur capturée dans le résultat, pas re-thrown.
 *
 * Cas spécial dataQuality='unavailable' (FarmRoad + Open-Meteo down) :
 *   - écrire un phenology_daily/{date} minimal avec gddDay=null
 *   - gddCumul reste à valeur J-1 (pas de progression sans data)
 *   - currentStage reste à valeur J-1
 *   - daysInStage incrémente quand même (le temps passe même sans data)
 *
 * Pure orchestrator, DI strict.
 */

const { calculateDailyGdd } = require("./gddCalculator");
const {
  calculateDailyRadsum,
  estimateMissingRadiation,
  evaluateDliVsTarget,
} = require("./radsumCalculator");
const { resolveStage } = require("./stageResolver");
const { getIrrigationRecipe } = require("./irrigationRecipe");
const { isoDateInTz } = require("../dates/isoDateInTz");

/**
 * @typedef {Object} DailyPhenologyJobDeps
 * @property {(...args:any[]) => Promise<Array<object>>} listEnabledPlots
 *   Returns plots where phenology.enabled === true.
 * @property {(plot:object) => Promise<object|null>} resolveStation             T2
 * @property {(params:object) => Promise<object>} fetchRadiationDaily            T4
 * @property {(variety:string, cycleType:string) => Promise<object>} loadReference  T1
 * @property {(plotId:string, date:string) => Promise<object|null>} readPhenologyDaily
 *   Reads plots/{plotId}/phenology_daily/{date}, returns data or null.
 * @property {(plotId:string, date:string, computed:object) => Promise<{written:boolean, transitionDetected:boolean, daysInStage:number}>} writePhenologyDaily  T5
 * @property {(msg:string, ctx?:object) => void} [logger]
 */

/**
 * @typedef {Object} PlotJobResult
 * @property {string} plotId
 * @property {"ok"|"error"} status
 * @property {string} [dataQuality]
 * @property {boolean} [transitionDetected]
 * @property {string} [error]
 */

/**
 * @typedef {Object} JobSummary
 * @property {string} date
 * @property {number} processed       count where status='ok'
 * @property {number} failed           count where status='error'
 * @property {number} skipped          count where status='skipped' (enabled=false at query time excluded; this counts plots that we explicitly skipped post-fetch)
 * @property {PlotJobResult[]} plots
 */

function _previousDayString(date) {
  const d = new Date(date + "T12:00:00Z"); // noon UTC to avoid DST edge cases
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function _safeMax(samples, key) {
  let m = -Infinity;
  for (const s of samples) {
    if (typeof s[key] === "number" && Number.isFinite(s[key]) && s[key] > m) m = s[key];
  }
  return m === -Infinity ? null : m;
}

async function _processPlot(plot, date, deps, logger) {
  // 1. Station
  const station = await deps.resolveStation(plot);

  // 1b. Localisation défensive : plot.location peut manquer (plots seedés avant
  // l'ajout du champ). On retombe sur station.location, puis on skippe proprement
  // si rien n'est résolvable (jamais de crash sur plot.location.latitude).
  const loc = (plot.location && typeof plot.location === "object" && plot.location)
    || (station && station.location)
    || null;
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
    logger(`[plot=${plot.id}] step=SKIP reason=no_location WARN: ni plot.location ni station.location exploitables`);
    return { plotId: plot.id, status: "skipped", reason: "no_location" };
  }

  // 2. Radiation + temperature
  const ratio = (plot.phenology && plot.phenology.parToRadiationRatio) || 0.46;
  const env = await deps.fetchRadiationDaily({
    station,
    plotLocation: { latitude: loc.latitude, longitude: loc.longitude },
    date,
    parToRadiationRatio: ratio,
  });
  logger(`[plot=${plot.id}] step=fetch_radiation quality=${env.dataQuality} samples=${env.samples.length} tMin=${env.tMin} tMax=${env.tMax}`);

  // 3. Reference
  const ref = await deps.loadReference(plot.phenology.variety, plot.phenology.cycleType);

  // 4. Previous day cumuls / stage / daysInStage
  const previousDate = _previousDayString(date);
  const previousDaily = await deps.readPhenologyDaily(plot.id, previousDate);
  const previousGddCumul = previousDaily ? (previousDaily.gddCumul || 0) : 0;
  const previousRadsumCumul = previousDaily ? (previousDaily.radsumCumulMjM2 || 0) : 0;
  const previousDliCumul = previousDaily ? (previousDaily.dliCumulMolM2 || 0) : 0;
  const previousStage = previousDaily && previousDaily.stage ? previousDaily.stage.code : (plot.phenology.currentStage || null);
  const previousDaysInStage = previousDaily ? (previousDaily.daysInStage || 0) : 0;

  // Cas spécial : data indisponible
  if (env.dataQuality === "unavailable") {
    logger(`[plot=${plot.id}] step=done dataQuality=UNAVAILABLE gddDay=null gddCumul=${previousGddCumul}(preserved) WARN: both FarmRoad and Open-Meteo down`);
    const placeholderStage = ref.stages.find((s) => s.code === previousStage) || ref.stages[0];
    const write = await deps.writePhenologyDaily(plot.id, date, {
      gddDay: null,
      gddCumul: previousGddCumul,
      radsumDay: null,
      radsumCumul: previousRadsumCumul,
      dliDay: null,
      dliCumul: previousDliCumul,
      currentStage: { code: placeholderStage.code, name: placeholderStage.name, criticalStage: placeholderStage.criticalStage },
      previousStage,
      previousDaysInStage,
      tMin: null, tMax: null, tMaxCapped: null,
      radiationMaxWm2: null, parMaxUmolM2s: null,
      irrigationRecipe: null,
      dliVsTarget: null,
      dataQuality: "unavailable",
      dataSources: env.dataSources,
    }, deps);
    return { plotId: plot.id, status: "ok", dataQuality: "unavailable", transitionDetected: write.transitionDetected };
  }

  // 5-6. Compute Sprint 1 modules
  const gddRes = calculateDailyGdd({
    tMin: env.tMin, tMax: env.tMax, tBase: ref.tBase, tCap: ref.tCap,
  });
  const enriched = estimateMissingRadiation(env.samples, ratio);
  const radsumRes = calculateDailyRadsum(enriched);

  // 7. Cumuls
  const newGddCumul = previousGddCumul + gddRes.gddDay;
  const newRadsumCumul = previousRadsumCumul + radsumRes.radsumMjM2;
  const newDliCumul = previousDliCumul + radsumRes.dliMolM2;

  // 8. Stage
  const stage = resolveStage(newGddCumul, ref, {
    precocityCoefficient: plot.phenology.precocityCoefficient,
    customStageThresholds: plot.phenology.customStageThresholds,
  });

  // 9. DLI vs target
  const dliVsTarget = evaluateDliVsTarget(radsumRes.dliMolM2, stage.dli);

  // 10. Recipe
  const recipe = getIrrigationRecipe(stage.code, ref);

  // 11. Write
  const write = await deps.writePhenologyDaily(plot.id, date, {
    gddDay: gddRes.gddDay,
    gddCumul: newGddCumul,
    radsumDay: radsumRes.radsumMjM2,
    radsumCumul: newRadsumCumul,
    dliDay: radsumRes.dliMolM2,
    dliCumul: newDliCumul,
    currentStage: { code: stage.code, name: stage.name, criticalStage: stage.criticalStage },
    previousStage,
    previousDaysInStage,
    tMin: env.tMin, tMax: env.tMax, tMaxCapped: gddRes.tMaxCapped,
    radiationMaxWm2: _safeMax(enriched, "radiationWm2"),
    parMaxUmolM2s: _safeMax(enriched, "parUmolM2s"),
    irrigationRecipe: recipe,
    dliVsTarget,
    dataQuality: env.dataQuality,
    dataSources: env.dataSources,
  }, deps);

  logger(`[plot=${plot.id}] step=done gddDay=${gddRes.gddDay} gddCumul=${newGddCumul.toFixed(2)} stage=${stage.code} daysInStage=${write.daysInStage} transition=${write.transitionDetected}`);

  return {
    plotId: plot.id,
    status: "ok",
    dataQuality: env.dataQuality,
    transitionDetected: write.transitionDetected,
  };
}

/**
 * Exécute le job daily phenology sur toutes les parcelles enabled.
 *
 * @param {string} date  "YYYY-MM-DD"
 * @param {DailyPhenologyJobDeps} deps
 * @returns {Promise<JobSummary>}
 */
async function runDailyPhenologyJob(date, deps) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError("runDailyPhenologyJob: date must be YYYY-MM-DD");
  }
  if (!deps || typeof deps.listEnabledPlots !== "function" ||
      typeof deps.resolveStation !== "function" ||
      typeof deps.fetchRadiationDaily !== "function" ||
      typeof deps.loadReference !== "function" ||
      typeof deps.readPhenologyDaily !== "function" ||
      typeof deps.writePhenologyDaily !== "function") {
    throw new TypeError("runDailyPhenologyJob: deps incomplete");
  }
  const logger = deps.logger || ((msg, ctx) => console.log(msg, ctx || ""));

  logger(`[job] runDailyPhenologyJob start date=${date}`);
  const plots = await deps.listEnabledPlots();
  logger(`[job] ${plots.length} enabled plot(s) found`);

  const results = [];
  for (const plot of plots) {
    try {
      const r = await _processPlot(plot, date, deps, logger);
      results.push(r);
    } catch (err) {
      logger(`[plot=${plot.id}] step=ERROR ${err.message}`);
      results.push({ plotId: plot.id, status: "error", error: err.message });
    }
  }

  const processed = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  logger(`[job] done date=${date} processed=${processed} failed=${failed} skipped=${skipped}`);

  return { date, processed, failed, skipped, plots: results };
}

// =====================================================================
// Sprint 2 T7 — Cron + HTTP trigger configuration (source of truth)
// =====================================================================
//
// Constantes consommées par functions/index.js pour wirer les 2 exports.
// Test verification via P3 mini-tests (cf. dailyPhenologyJob.test.js).

const CRON_CONFIG = Object.freeze({
  schedule: "0 23 * * *",        // 23:00 chaque jour
  timeZone: "Africa/Casablanca",  // identique gddNightlyJob legacy (cohabitation)
  region: "europe-west1",
  timeoutSeconds: 540,
  memorySize: "512MB",
});

const HTTP_CONFIG = Object.freeze({
  region: "europe-west1",
  timeoutSeconds: 540,
  memorySize: "512MB",
  rewritePath: "/api/run-daily-phenology-job-now",
});

/**
 * Construit le handler HTTP `(req, res) => Promise<void>` avec DI complète.
 * Utilisé par index.js pour wirer `runDailyPhenologyJobNow` en prod,
 * et par les tests P3 pour vérifier le comportement (auth gating, date
 * parsing, warning P4, error 500).
 *
 * @param {Object} deps
 * @param {(req, res) => Promise<object|null>} deps.requireAuth
 *   Middleware async qui retourne l'user authentifié ou null (et a déjà
 *   répondu 401 sur res). Si null, le handler return immédiatement.
 * @param {(date, runJobDeps) => Promise<JobSummary>} deps.runJob
 *   Pré-bind sur runDailyPhenologyJob + deps de production.
 * @param {() => string} [deps.todayISO]
 *   Fournit la date par défaut (YYYY-MM-DD). Default = today in Africa/Casablanca.
 * @param {(res, req) => void} [deps.setCors] CORS helper (legacy parity).
 * @param {(msg:string, ctx?:object) => void} [deps.logger]
 */
function buildHttpHandler(deps) {
  if (!deps || typeof deps.requireAuth !== "function" || typeof deps.runJob !== "function") {
    throw new TypeError("buildHttpHandler: deps.requireAuth + deps.runJob required");
  }
  const todayISO = deps.todayISO || (() => isoDateInTz(new Date(), "Africa/Casablanca"));
  const setCors = deps.setCors || (() => {});
  const logger = deps.logger || (() => {});

  return async function runDailyPhenologyJobHttpHandler(req, res) {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await deps.requireAuth(req, res);
    if (!authUser) return; // requireAuth déjà répondu 401

    const dateParam = req.query && req.query.date;
    const today = todayISO();
    let date = dateParam || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "date must be YYYY-MM-DD" });
    }

    try {
      const summary = await deps.runJob(date);
      const body = { success: true, ...summary };
      if (date !== today) {
        body.warning = `⚠️ Replayed ${date}. Downstream cumuls (J+1 to today) may need replay too. Use ?date=YYYY-MM-DD&cascade=true to propagate (NOT IMPLEMENTED in Sprint 2).`;
      }
      return res.status(200).json(body);
    } catch (err) {
      logger("runDailyPhenologyJobHttpHandler error:", { err: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

module.exports = {
  runDailyPhenologyJob,
  buildHttpHandler,
  CRON_CONFIG,
  HTTP_CONFIG,
  // exposed for unit tests
  __internals: { _previousDayString, _processPlot },
};
