/**
 * dailyProductionReport.js — Build the 20h WhatsApp daily production digest for DG.
 *
 * Aggregates today's expeditions + cycle cumul + team rendement per variety.
 * Sent to all users with profileId='dg' via whatsappService.
 */

const { db } = require("./config/firebase");
const { getCycle } = require("./parcellesCulturales");
const { getTeamNameMap } = require("./equipesConfig");
const whatsappService = require("./whatsappService");
const productionEstimation = require("./lib/productionEstimation");

function todayCasablancaISO() {
  // Casablanca = UTC+1 (no DST since 2018). Compute today's date in that tz.
  const now = new Date();
  const localMs = now.getTime() + 60 * 60 * 1000; // +1h
  return new Date(localMs).toISOString().slice(0, 10);
}

function fmtDateShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

/**
 * Compute team rendement (kg/ouvrier) per variety for today using prod_tracabilite_recolte.
 */
async function aggregateTeamRendementByVariety(todayISO) {
  const [recolteDoc, teamMap] = await Promise.all([
    db.collection("prod_tracabilite_recolte").doc(todayISO).get(),
    getTeamNameMap(db),
  ]);
  if (!recolteDoc.exists) return { byVariete: {}, teamMap };

  const rows = (recolteDoc.data() || {}).rows || [];
  // byVariete[v] = { teams: { prefix: { equipe, totalKg, nbOuvriers } } }
  const byVariete = {};
  for (const r of rows) {
    const v = r.variete || 'Inconnu';
    const prefix = (r.matricule || '').slice(0, 2).toUpperCase();
    if (!prefix) continue;
    if (!byVariete[v]) byVariete[v] = {};
    if (!byVariete[v][prefix]) byVariete[v][prefix] = { equipe: teamMap[prefix] || prefix, totalKg: 0, nbOuvriers: 0 };
    byVariete[v][prefix].totalKg += r.totalKg || 0;
    byVariete[v][prefix].nbOuvriers += 1;
  }
  // Convert to sorted arrays per variety
  const result = {};
  for (const [v, teams] of Object.entries(byVariete)) {
    result[v] = Object.entries(teams)
      .map(([prefix, t]) => ({
        prefix, equipe: t.equipe, totalKg: Math.round(t.totalKg),
        nbOuvriers: t.nbOuvriers,
        kgParOuv: t.nbOuvriers > 0 ? Math.round(t.totalKg / t.nbOuvriers * 10) / 10 : 0,
      }))
      .sort((a, b) => b.kgParOuv - a.kgParOuv);
  }
  return { byVariete: result, teamMap };
}

/**
 * Read pfq_interne, expeditions and the variety mapping, then compute the
 * Cycle 2 cards as displayed in the frontend Production tab with Estimation ON.
 *
 * @param {string} todayISO
 * @returns {Promise<{ stats: Array<object>, cycle: number, asOfDate: string }>}
 */
async function aggregateCycle2Estimation(todayISO, opts = {}) {
  // Read full collections — no limit, no orderBy required. Firestore admin SDK
  // paginates internally. We need all docs because the estimation algorithm
  // depends on the *last bon date per variety* across the full history.
  const [bonsSnap, expSnap, mapSnap] = await Promise.all([
    db.collection("pfq_interne").get(),
    db.collection("expeditions").get(),
    db.collection("email_config").doc("variety_mapping").get(),
  ]);
  const bons = bonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const expeditions = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const varietyMapping = mapSnap.exists ? (mapSnap.data().mapping || {}) : {};

  if (opts.debug) {
    const trace = productionEstimation.buildMappedWithEstimation({
      bons, expeditions, varietyMapping, asOfDate: todayISO, trace: true,
    });
    const stats = productionEstimation.computeCycle2Stats(trace.mapped);
    return {
      mapped: trace.mapped,
      stats,
      cycle: getCycle(todayISO),
      asOfDate: todayISO,
      debug: {
        counts: { bons: bons.length, expeditions: expeditions.length, syntheticBons: trace.syntheticBons.length, varietyMappingKeys: Object.keys(varietyMapping).length },
        lastBonDateByVariety: trace.lastBonDateByVariety,
        lastBonDateByBase: trace.lastBonDateByBase,
        subVarietiesByBase: trace.subVarietiesByBase,
        syntheticBons: trace.syntheticBons,
        skippedExpeditions: trace.skippedExpeditions,
      },
    };
  }

  const mapped = productionEstimation.buildMappedWithEstimation({
    bons, expeditions, varietyMapping, asOfDate: todayISO,
  });
  const stats = productionEstimation.computeCycle2Stats(mapped);
  console.log(`[aggregateCycle2Estimation] bons=${bons.length} expeditions=${expeditions.length} synthetic=${mapped.filter(b => b._isEstimation).length}`);
  return { mapped, stats, cycle: getCycle(todayISO), asOfDate: todayISO };
}

/**
 * Subset the global team rendement aggregate to teams working on varieties
 * planted in the given ferme. Used to filter the team section for chef reports.
 * @param {object} aggTeam - output of aggregateTeamRendementByVariety
 * @param {string|null} ferme - 'F1', 'F5', or null (no filter)
 * @returns {object} same shape as aggTeam.byVariete but filtered
 */
function filterTeamByFerme(aggTeam, ferme) {
  if (!ferme) return aggTeam;
  const { normalizeParcelle } = require('./parcellesCulturales');
  const filtered = {};
  Object.entries(aggTeam.byVariete || {}).forEach(([variete, teams]) => {
    const resolved = normalizeParcelle(variete);
    const v_ferme = resolved ? resolved.ferme : null;
    if (v_ferme === ferme) filtered[variete] = teams;
  });
  return { ...aggTeam, byVariete: filtered };
}

/**
 * Build the body section of the report (used as the {{2}} template parameter
 * and as the text preview). Does NOT include the date header line — that line
 * is the {{1}} template parameter / template static prefix.
 */
function formatMessageBody(aggTeam, cycle2) {
  const lines = [];
  lines.push(productionEstimation.formatCycle2Section(cycle2.stats));

  const varietiesWithTeams = Object.keys(aggTeam.byVariete);
  if (varietiesWithTeams.length) {
    lines.push('');
    lines.push('👷 *Rendement équipes (Kg/ouvrier)*');
    varietiesWithTeams.forEach(v => {
      const top = aggTeam.byVariete[v].slice(0, 3);
      const fmt = top.map(t => `${t.equipe} ${t.kgParOuv}`).join(' · ');
      lines.push(`• ${v}: ${fmt}`);
    });
  } else {
    lines.push('');
    lines.push('_Aucun rendement équipe disponible (sync prod pas encore terminé)._');
  }

  return lines.join('\n');
}

function formatMessage(todayISO, aggTeam, cycle2) {
  return `📊 *Production ${fmtDateShort(todayISO)}* (Cycle ${cycle2.cycle})\n\n${formatMessageBody(aggTeam, cycle2)}`;
}

/**
 * Generate the report and send via WhatsApp to all DG users.
 * @param {string} [dateISO] - YYYY-MM-DD. Defaults to today (Casablanca).
 * @returns {Promise<{ sent: number, recipientsCount: number, todayISO: string }>}
 */
async function sendDailyProductionReport(dateISO, opts = {}) {
  const todayISO = dateISO || todayCasablancaISO();
  const [aggTeam, cycle2] = await Promise.all([
    aggregateTeamRendementByVariety(todayISO),
    aggregateCycle2Estimation(todayISO, { debug: !!opts.debug }),
  ]);
  const dateShort = fmtDateShort(todayISO);

  // Build per-audience views: DG (all), chef F1 (F1 only), chef F5 (F5 only).
  const buildAudience = (fermeFilter, profileId, labelPrefix) => {
    const stats = fermeFilter
      ? productionEstimation.computeCycle2Stats(cycle2.mapped, { ferme: fermeFilter })
      : cycle2.stats;
    const team = filterTeamByFerme(aggTeam, fermeFilter);
    const body = formatMessageBody(team, { ...cycle2, stats });
    const dateParam = labelPrefix ? `${labelPrefix} ${dateShort}` : dateShort;
    const message = `📊 *Production ${dateParam}* (Cycle ${cycle2.cycle})\n\n${body}`;
    return { fermeFilter, profileId, labelPrefix, dateParam, body, message };
  };
  // Audience tuples : (ferme filter for stats, profileId in users collection,
  // label prefix for the WhatsApp date param).
  const audiences = [
    buildAudience(null, 'dg',      null),
    buildAudience('F1', 'chef_f1', 'F1'),
    buildAudience('F5', 'chef_f5', 'F5'),
  ];

  if (opts.debug) {
    return {
      debug: true, todayISO,
      audiences: audiences.map(a => ({ profileId: a.profileId, ferme: a.fermeFilter, message: a.message })),
      stats: cycle2.stats,
      diagnostic: cycle2.debug,
    };
  }
  if (opts.preview) {
    return {
      preview: true, todayISO,
      audiences: audiences.map(a => ({ profileId: a.profileId, ferme: a.fermeFilter, message: a.message })),
    };
  }

  // Send to each audience. Uses Meta-approved template "production_digest_v2"
  // (v1 "production_digest_dg" was approved with a single-line example and
  // rejected our multi-line body with #132018 — v2 has a rich multi-line
  // example matching the actual digest format).
  const allResults = [];
  for (const a of audiences) {
    const recipients = await whatsappService.resolveRecipientsForProfile(a.profileId, a.fermeFilter);
    if (!recipients.length) {
      console.warn(`[dailyProductionReport] No recipients for profile=${a.profileId} ferme=${a.fermeFilter || '-'}`);
      allResults.push({ profileId: a.profileId, ferme: a.fermeFilter, sent: 0, recipientsCount: 0 });
      continue;
    }
    const results = await Promise.allSettled(
      recipients.map(r => whatsappService.sendTemplateMessage(
        r.phone, 'production_digest_v2', [a.dateParam, a.body], undefined, r.displayName
      ))
    );
    const sent = results.filter(r => r.status === 'fulfilled' && r.value && r.value.success).length;
    console.log(`[dailyProductionReport] ${todayISO} profile=${a.profileId} ferme=${a.fermeFilter || '-'}: sent=${sent}/${recipients.length}`);
    allResults.push({ profileId: a.profileId, ferme: a.fermeFilter, sent, recipientsCount: recipients.length });
  }
  const totalSent = allResults.reduce((s, r) => s + r.sent, 0);
  return { todayISO, sent: totalSent, audiences: allResults };
}

module.exports = {
  todayCasablancaISO,
  aggregateCycle2Estimation,
  aggregateTeamRendementByVariety,
  formatMessage,
  sendDailyProductionReport,
};
