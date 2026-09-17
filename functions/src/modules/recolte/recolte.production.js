/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { admin, calcGDD, calcIMC, calcVPDFromTH, db_firestore, functions, getCueilletteRows, getPointageRowsForDate, localDateStr, prodSync, requireAuth, setCors, whatsappService } = require("../../shared/core");

exports.syncRecolteFromProd = functions.region("europe-west1").pubsub
  .schedule("*/15 11-20 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => prodSync.syncTracabiliteRecolte());

// Daily production digest @ 20h30 Casablanca — DG (global) + Chef F1 + Chef F5.
exports.dailyProductionDigest = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .pubsub.schedule("30 20 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    try {
      const dailyProductionReport = require("./dailyProductionReport");
      const result = await dailyProductionReport.sendDailyProductionReport();
      console.log("[dailyProductionDigest]", result);
    } catch (err) {
      console.error("[dailyProductionDigest] error:", err);
    }
    return null;
  });

// Manual trigger for daily production report — ?date=YYYY-MM-DD (default: today Casablanca).
exports.dailyProductionReportTrigger = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    // List configured recipients for the 3 audiences via ?checkRecipients=1.
    if (req.query.checkRecipients === '1') {
      try {
        const whatsapp = require('../admin/whatsappService');
        const [dg, chefF1, chefF5] = await Promise.all([
          whatsapp.resolveRecipientsForProfile('dg', null),
          whatsapp.resolveRecipientsForProfile('chef_f1', null),
          whatsapp.resolveRecipientsForProfile('chef_f5', null),
        ]);
        const mask = (p) => p ? p.slice(0, 4) + '***' + p.slice(-3) : null;
        const fmt = (arr) => arr.map(r => ({ uid: r.uid, displayName: r.displayName, ferme: r.ferme, phone: mask(r.phone) }));

        // Broader scan: any user with profileId containing "chef" and any user
        // with whatsappEnabled=true, to spot misconfigurations.
        const allChefSnap = await db_firestore.collection('users').get();
        const candidates = [];
        allChefSnap.docs.forEach(d => {
          const u = d.data() || {};
          const pid = String(u.profileId || '');
          if (pid.includes('chef') || pid === 'dg') {
            candidates.push({
              uid: d.id,
              profileId: pid,
              displayName: u.displayName || null,
              ferme: u.ferme || null,
              whatsappEnabled: !!u.whatsappEnabled,
              hasPhone: !!u.whatsappPhone,
              disabled: !!u.disabled,
            });
          }
        });
        return res.json({
          dg: { count: dg.length, recipients: fmt(dg) },
          chefF1: { count: chefF1.length, recipients: fmt(chefF1) },
          chefF5: { count: chefF5.length, recipients: fmt(chefF5) },
          allCandidates: candidates,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // One-shot: submit Meta template via ?submitTemplate=1 (uses Firestore token).
    if (req.query.submitTemplate === '1') {
      try {
        const cfgDoc = await db_firestore.collection("config").doc("whatsapp").get();
        if (!cfgDoc.exists) return res.status(500).json({ error: "config/whatsapp missing" });
        const cfg = cfgDoc.data();
        const token = cfg.access_token;
        const wabaId = cfg.waba_id || "1435674314903560";
        if (!token) return res.status(500).json({ error: "access_token missing" });
        const payload = {
          name: "production_digest_dg",
          language: "fr",
          category: "UTILITY",
          components: [{
            type: "BODY",
            text: "Bonjour, voici le récap de production SmartBerry pour {{1}} :\n\n{{2}}\n\nConsultez votre tableau de bord pour le détail complet et l'historique.",
            example: { body_text: [[
              "17/05",
              "Estimation Cycle 2 : Maravilla GC 9.37 T/Ha (Budget 72%), Corina 3.48 Kg/Pl (Budget 87%).",
            ]] },
          }],
        };
        const r = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        return res.status(r.ok ? 200 : 500).json({ ok: r.ok, status: r.status, data });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : undefined;
    const preview = req.query.preview === '1' || req.query.preview === 'true';
    const debug = req.query.debug === '1' || req.query.debug === 'true';
    try {
      const dailyProductionReport = require("./dailyProductionReport");
      const result = await dailyProductionReport.sendDailyProductionReport(date, { preview, debug });
      console.log("[dailyProductionReportTrigger]", { ...result, message: undefined, stats: undefined, diagnostic: undefined });
      res.json({ success: true, ...result, dateRequested: date || null });
    } catch (err) {
      console.error("[dailyProductionReportTrigger] error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// One-shot helper to submit the `production_digest_dg` template to Meta
// using the access token stored in Firestore (config/whatsapp). Hit once
// and watch the response, then wait for Meta to approve.
exports.submitProductionDigestTemplate = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    try {
      const cfgDoc = await db_firestore.collection("config").doc("whatsapp").get();
      if (!cfgDoc.exists) return res.status(500).json({ error: "config/whatsapp missing" });
      const cfg = cfgDoc.data();
      const token = cfg.access_token;
      const wabaId = cfg.waba_id || "1435674314903560";
      if (!token) return res.status(500).json({ error: "access_token missing in config/whatsapp" });

      const tpl = {
        name: "production_digest_dg",
        body: "SmartBerry — Production {{1}}\n\n{{2}}",
        examples: [
          "17/05",
          "🎯 Estimation Cycle 2\n🍇 Framboise\n• Maravilla Green Cane — 9.37 T/Ha (Budget 72%, Local 12.0%, Export 37.47 T)\n🫐 Myrtille\n• Corina — 3.48 Kg/Pl (Budget 87%, Local 2.8%, Export 28.72 T)",
        ],
      };
      const payload = {
        name: tpl.name,
        language: "fr",
        category: "UTILITY",
        components: [{
          type: "BODY",
          text: tpl.body,
          example: { body_text: [tpl.examples] },
        }],
      };
      const r = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      res.status(r.ok ? 200 : 500).json({ ok: r.ok, status: r.status, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// WhatsApp recap to DG when today's harvest totalKg jumps by ≥100 kg.
// See functions/src/modules/recolte/recolteWhatsAppNotifier.js for the threshold logic.
const recolteWhatsAppNotifier = require("./recolteWhatsAppNotifier");
const { invalidateCache: invalidateApiCache } = require("../../../middleware/cache");
exports.onProdRecolteWriteNotify = functions
  .region("europe-west1")
  .firestore.document("prod_tracabilite_recolte/{date}")
  .onWrite(async (change, context) => {
    try {
      const result = await recolteWhatsAppNotifier.handleProdRecolteWrite(
        { db: db_firestore, whatsapp: whatsappService, admin, invalidateCache: invalidateApiCache },
        change,
        context
      );
      if (result && (result.sent || result.skipped)) {
        console.log("[onProdRecolteWriteNotify]", context.params.date, result);
      }
      return null;
    } catch (err) {
      console.error("[onProdRecolteWriteNotify] error:", err.message);
      return null;
    }
  });

// Sync présence entrée — retry toutes les 15min de 9h à 11h (résilience si BDP injoignable)
exports.syncProdTrigger = functions.region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(async (req, res) => {
  const action = req.query.action || "recolte";
  let result;
  if (action === "recolte") result = await prodSync.syncTracabiliteRecolte(req.query.since || undefined);
  else if (action === "presence") result = await prodSync.syncPresence(req.query.mode || "entree");
  else result = { error: "Unknown action. Use ?action=recolte&since=2025-07-01 or ?action=presence&mode=entree|sortie" };
  res.json(result);
});

// Backfill prod_presence sur une plage (heures entrée/sortie BEE ONE Production)
// — déclenché manuellement (bouton RH dans Heures Supp.) en fin de quinzaine pour
// rattraper les sorties saisies tardivement. Ne touche pas au pointage analytique.
function normalizeVarieteSousVariete(parcelleCulturale) {
  if (!parcelleCulturale) return null;
  const u = parcelleCulturale.trim().toUpperCase();
  if (u.includes('MARAVILLA')) {
    if (u.includes('GG') || u.includes('GREEN') || /\bGC\b/.test(u)) return 'Maravilla Green Cane';
    if (u.includes('MOTTE') || u.includes('LONG') || /\bLG\b/.test(u)) return 'Maravilla Long Cane';
    if (u.includes('MOW')) return 'Maravilla Mow Down';
    return 'Maravilla';
  }
  if (u.includes('YAZMIN') || u.includes('YASMIN')) {
    if (u.includes('MOTTE') || u.includes('BI')) return 'Yazmin Bi Cycle';
    if (u.includes('MOW')) return 'Yazmin Mow Down';
    if (u.includes('CUT')) return 'Yazmin Bi Cycle';
    return 'Yazmin';
  }
  if (u.includes('REYNA') || u.includes('REINA')) return 'Reyna';
  if (u.includes('CORINA') || u.includes('CORRINA')) return 'Corina';
  if (u.includes('CASCADE')) return 'Cascade';
  if (u.includes('BREEZE')) return 'Breeze';
  if (u.includes('ADELITA')) return 'Adelita';
  return null;
}

exports.climatProduction = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const days = Math.min(parseInt(req.query.days) || 7, 60);
      const varieteFilter = req.query.variete || null;

      // Date range
      const endDate = localDateStr();
      const startD = new Date(endDate + "T12:00:00");
      startD.setDate(startD.getDate() - days - 5); // extra 5 days for lag
      const startDate = startD.toISOString().slice(0, 10);

      // 1. Get production data
      const cueilletteRows = await getCueilletteRows(startDate, endDate);

      // Enrich each row with normalized sub-variety name
      cueilletteRows.forEach(r => {
        r._displayVariete = normalizeVarieteSousVariete(r.Parcelle_Culturale) || r.Variete || null;
      });

      // Get available varieties (with sub-varieties)
      const varietesSet = new Set();
      cueilletteRows.forEach(r => { if (r._displayVariete) varietesSet.add(r._displayVariete); });
      const varietesDisponibles = Array.from(varietesSet).sort();

      // Aggregate production by date and variety
      const prodByDate = {};
      cueilletteRows.forEach(r => {
        if (varieteFilter && r._displayVariete !== varieteFilter) return;
        if (!prodByDate[r.DateStr]) prodByDate[r.DateStr] = 0;
        prodByDate[r.DateStr] += r.Poids_total_kg || 0;
      });

      // 2. Get serre data for each date
      const allDates = [];
      const d = new Date(startDate + "T12:00:00");
      const endD = new Date(endDate + "T12:00:00");
      while (d <= endD) {
        allDates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }

      // Batch read serre_data
      const serreRefs = allDates.map(ds => db_firestore.collection("farms").doc("larache").collection("serre_data").doc(ds));
      const serreDocs = [];
      // Read in chunks of 10
      for (let i = 0; i < serreRefs.length; i += 10) {
        const chunk = serreRefs.slice(i, i + 10);
        const snaps = await Promise.all(chunk.map(ref => ref.get()));
        serreDocs.push(...snaps);
      }

      const serreByDate = {};
      serreDocs.forEach(snap => {
        if (snap.exists) {
          const data = snap.data();
          serreByDate[data.date || snap.id] = data;
        }
      });

      // 2b. Fallback: batch read gdd_tracking for dates missing from serre_data
      const gddRefs = allDates.map(ds => db_firestore.collection("gdd_tracking").doc(ds));
      const gddDocs = [];
      for (let i = 0; i < gddRefs.length; i += 10) {
        const chunk = gddRefs.slice(i, i + 10);
        const snaps = await Promise.all(chunk.map(ref => ref.get()));
        gddDocs.push(...snaps);
      }
      const gddByDate = {};
      gddDocs.forEach(snap => {
        if (snap.exists) gddByDate[snap.id] = snap.data();
      });

      // 3. Build daily data array (serre_data preferred, gdd_tracking as fallback)
      // Also walk gdd_tracking in date order to obtain a running cumulative GDD when not stored.
      const dailyData = [];
      let runningGddCumule = 0;
      let lastStoredCumule = null;
      for (const date of allDates) {
        const serre = serreByDate[date];
        const gdd = gddByDate[date];
        const prodKg = prodByDate[date] || 0;
        const tmax = serre ? serre.T_max_serre : (gdd ? gdd.tmax : null);
        const tmin = serre ? serre.T_min_serre : (gdd ? gdd.tmin : null);
        const hr = serre ? serre.HR_moyenne : (gdd ? gdd.hr_moyenne : null);
        const dli = serre ? serre.PAR_sum : (gdd ? gdd.dli : null);

        const dailyGdd = tmax != null && tmin != null ? calcGDD(tmax, tmin) : null;
        // Prefer stored cumulative; otherwise accumulate from previous stored value.
        let gddCumule = null;
        if (gdd && typeof gdd.gdd_cumule === "number") {
          gddCumule = gdd.gdd_cumule;
          lastStoredCumule = gddCumule;
          runningGddCumule = gddCumule;
        } else if (dailyGdd != null) {
          if (lastStoredCumule != null) runningGddCumule = runningGddCumule + dailyGdd;
          else runningGddCumule = runningGddCumule + dailyGdd;
          gddCumule = runningGddCumule;
        }

        // IMC: prefer stored; else compute on the fly when we have all inputs.
        let imcPourcentage = null;
        let alerte = null;
        if (gdd && typeof gdd.imc_pourcentage === "number") {
          imcPourcentage = gdd.imc_pourcentage;
          alerte = gdd.alerte || null;
        } else if (gddCumule != null && tmax != null && tmin != null && hr != null && dli != null) {
          const imcRes = calcIMC({ gddCumule, tmax, tmin, hr, dli });
          imcPourcentage = imcRes.pourcentage;
          alerte = imcRes.alerte;
        }

        dailyData.push({
          date,
          production_kg: Math.round(prodKg * 10) / 10,
          tmax: tmax != null ? Math.round(tmax * 10) / 10 : null,
          tmin: tmin != null ? Math.round(tmin * 10) / 10 : null,
          delta_t: tmax != null && tmin != null ? Math.round((tmax - tmin) * 10) / 10 : null,
          gdd: dailyGdd != null ? Math.round(dailyGdd * 10) / 10 : null,
          gdd_cumule: gddCumule != null ? Math.round(gddCumule * 10) / 10 : null,
          imc: imcPourcentage,
          alerte,
          vpd: tmax != null && tmin != null && hr != null ? Math.round(calcVPDFromTH((tmax + tmin) / 2, hr) * 100) / 100 : null,
          dli: dli != null ? Math.round(dli * 10) / 10 : null,
          hr: hr != null ? Math.round(hr) : null,
        });
      }

      // 4. Tendance récente — uniquement les jours actifs de récolte (>0 kg).
      // L'objectif opérationnel : prédire les kg de demain pour dimensionner l'équipe.
      // On exclut explicitement les jours sans récolte (pré-saison) qui pollueraient la baseline.
      const activeDays = dailyData.filter(d => d.production_kg > 0);
      const recentActive = activeDays.slice(-5);
      const ma3Prod = recentActive.length >= 2
        ? recentActive.slice(-3).reduce((s, d) => s + d.production_kg, 0) / Math.min(3, recentActive.length)
        : null;

      // Tendance IMC : pente sur les 3 derniers jours actifs (pts par jour).
      let imcSlope = 0;
      const imcRecent = recentActive.filter(d => d.imc != null).slice(-3);
      if (imcRecent.length >= 2) {
        imcSlope = (imcRecent[imcRecent.length - 1].imc - imcRecent[0].imc) / (imcRecent.length - 1);
      }
      // Tendance production : pente sur les 3 derniers jours actifs (kg par jour).
      let prodSlope = 0;
      if (recentActive.length >= 2) {
        const tail = recentActive.slice(-3);
        prodSlope = (tail[tail.length - 1].production_kg - tail[0].production_kg) / (tail.length - 1);
      }

      // lastDay = dernière entrée avec IMC populé (le doc gdd_tracking du jour
      // n'est écrit qu'à 23h00, donc l'entrée pour "aujourd'hui" peut être nulle).
      let lastDay = null;
      for (let li = dailyData.length - 1; li >= 0; li--) {
        if (dailyData[li].imc != null && dailyData[li].gdd_cumule != null) { lastDay = dailyData[li]; break; }
      }
      if (!lastDay) lastDay = dailyData[dailyData.length - 1];
      const todayImc = lastDay && lastDay.imc != null ? lastDay.imc : null;
      const todayAlerte = lastDay ? lastDay.alerte : null;

      // 6. Forecast demain via indoor_forecasts (météo intérieure prédite)
      // NB: les docs sont stockés sous la date UTC alors qu'ici endDate est en heure locale
      // → on récupère le doc le plus récent au lieu de deviner la clé.
      let forecastTomorrow = null;
      let imcTomorrow = null;
      let tomorrowFcMeta = null;
      try {
        const fcSnap = await db_firestore.collection("indoor_forecasts").orderBy("date", "desc").limit(1).get();
        if (!fcSnap.empty) {
          const fc = fcSnap.docs[0].data();
          const tomorrowDate = new Date(endDate + "T12:00:00");
          tomorrowDate.setDate(tomorrowDate.getDate() + 1);
          const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);
          const tunnelDays = fc.tunnel || [];
          let tomorrowFc = tunnelDays.find(d => d.date === tomorrowStr);
          if (!tomorrowFc) tomorrowFc = tunnelDays.find(d => d.date > endDate);
          const todayCum = lastDay && lastDay.gdd_cumule != null ? lastDay.gdd_cumule : null;
          if (tomorrowFc && tomorrowFc.tMax != null && tomorrowFc.tMin != null && todayCum != null) {
            const gddCumTomorrow = todayCum + calcGDD(tomorrowFc.tMax, tomorrowFc.tMin);
            const dliTomorrow = tomorrowFc.par != null ? tomorrowFc.par : (tomorrowFc.radiation != null ? tomorrowFc.radiation : null);
            const hrTomorrow = tomorrowFc.hr != null ? tomorrowFc.hr : 70;
            const imcRes = calcIMC({
              gddCumule: gddCumTomorrow,
              tmax: tomorrowFc.tMax,
              tmin: tomorrowFc.tMin,
              hr: hrTomorrow,
              dli: dliTomorrow != null ? dliTomorrow : 18,
            });
            imcTomorrow = imcRes;
            tomorrowFcMeta = {
              date: tomorrowFc.date,
              tmax: tomorrowFc.tMax,
              tmin: tomorrowFc.tMin,
              hr: hrTomorrow,
              dli: dliTomorrow,
              gdd_cumule: Math.round(gddCumTomorrow * 10) / 10,
            };
          }
        }
      } catch (fcErr) {
        console.warn("Climat-Production forecast tomorrow failed:", fcErr.message);
      }

      // 6. Prédiction opérationnelle — pilotée par maturité, ancrée sur jours actifs uniquement.
      // Logique :
      //   baseline = MA3 des derniers jours actifs (>0 kg)
      //   facteur tendance prod : extrapolation linéaire de la pente (amortie)
      //   facteur maturité : zone IMC + variation IMC aujourd'hui→demain
      //   prédiction = baseline × facteur_tendance × facteur_maturité (borné [0.6, 1.5])
      let prediction = null;
      let teamRecommendation = null;
      if (ma3Prod) {
        // Facteur tendance prod (extrapolation de la pente sur 1 jour, amortie 50%)
        const trendFactor = ma3Prod > 0 ? 1 + (prodSlope / ma3Prod) * 0.5 : 1;

        // Facteur maturité : combine zone IMC (niveau) + variation IMC aujourd'hui→demain
        const imcRef = imcTomorrow ? imcTomorrow.pourcentage : todayImc;
        let zoneFactor = 1;
        if (imcRef != null) {
          if (imcRef >= 85) zoneFactor = 1.15;       // RECOLTE_IMMINENTE → pic
          else if (imcRef >= 70) zoneFactor = 1.05;  // SURVEILLER_J3 → ramp-up
          else if (imcRef >= 50) zoneFactor = 0.95;  // EN_COURS → maturation
          else zoneFactor = 0.5;                      // PRECOCE → quasi nul
        }
        // Variation IMC : si IMC monte vers la zone récolte, anticiper +5-10%
        let deltaFactor = 1;
        if (imcTomorrow && todayImc != null) {
          const dImc = imcTomorrow.pourcentage - todayImc;
          deltaFactor = 1 + Math.max(-0.10, Math.min(0.10, dImc / 100));
        } else if (imcSlope) {
          deltaFactor = 1 + Math.max(-0.10, Math.min(0.10, imcSlope / 100));
        }

        let combined = trendFactor * zoneFactor * deltaFactor;
        combined = Math.max(0.6, Math.min(1.5, combined));
        const predKg = Math.round(ma3Prod * combined);

        // Recommandation équipe : seuil 15% pour éviter micro-ajustements
        const ratio = ma3Prod > 0 ? predKg / ma3Prod : 1;
        const deltaPct = Math.round((ratio - 1) * 100);
        let action = "stable";
        let actionLabel = "Maintenir l'équipe actuelle";
        if (deltaPct >= 15) { action = "augmenter"; actionLabel = "Renforcer l'équipe (+" + deltaPct + "%)"; }
        else if (deltaPct <= -15) { action = "reduire"; actionLabel = "Réduire l'équipe (" + deltaPct + "%)"; }

        teamRecommendation = {
          action,
          label: actionLabel,
          delta_pct: deltaPct,
          baseline_kg: Math.round(ma3Prod),
          predicted_kg: predKg,
          n_jours_actifs: recentActive.length,
        };

        prediction = {
          kg_estime: predKg,
          baseline_kg: Math.round(ma3Prod),
          facteur_tendance: Math.round(trendFactor * 100) / 100,
          facteur_zone: Math.round(zoneFactor * 100) / 100,
          facteur_delta_imc: Math.round(deltaFactor * 100) / 100,
          imc_aujourdhui: todayImc,
          imc_demain: imcTomorrow ? imcTomorrow.pourcentage : null,
          alerte_demain: imcTomorrow ? imcTomorrow.alerte : todayAlerte,
          source: imcTomorrow ? "baseline + maturité + forecast intérieur" : "baseline + maturité (sans forecast)",
        };
      }

      if (tomorrowFcMeta && imcTomorrow) {
        forecastTomorrow = {
          date: tomorrowFcMeta.date,
          imc: imcTomorrow.pourcentage,
          alerte: imcTomorrow.alerte,
          gdd_cumule: tomorrowFcMeta.gdd_cumule,
          tmax: tomorrowFcMeta.tmax,
          tmin: tomorrowFcMeta.tmin,
          hr: tomorrowFcMeta.hr,
          dli: tomorrowFcMeta.dli,
          prod_estime: prediction ? prediction.kg_estime : null,
          source: "indoor_forecast",
        };
      }

      // Tendance pour le frontend (sparkline)
      const tendance = {
        jours_actifs: recentActive.map(d => ({ date: d.date, prod: d.production_kg, imc: d.imc })),
        imc_slope_par_jour: Math.round(imcSlope * 100) / 100,
        prod_slope_kg_par_jour: Math.round(prodSlope),
      };

      const cutoffDate = new Date(endDate + "T12:00:00");
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoff = cutoffDate.toISOString().slice(0, 10);
      const filteredDaily = dailyData.filter(d => d.date >= cutoff);

      res.json({
        success: true,
        variete: varieteFilter || "Toutes",
        varietesDisponibles,
        dailyData: filteredDaily,
        prediction,
        teamRecommendation,
        forecastTomorrow,
        tendance,
        periode: { start: cutoff, end: endDate, jours: filteredDaily.length },
      });
    } catch (err) {
      console.error("Climat-Production error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Harvest Prediction — Helpers
// =============================================

// Helper: Open-Meteo forecast for Laouamra (35.08°N, 6.14°W)
function setCorsHR(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

exports.horsRecolteService = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCorsHR(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action || (req.body && req.body.action);

      // ---- SAISIE: caporal enregistre le réel du jour ----
      if (action === "saisie" && req.method === "POST") {
        const { ferme, parcelle, tache, nbRealise, nbOuvriers, caporal, nbTotal } = req.body;
        if (!ferme || !parcelle || !tache || nbRealise === undefined || !caporal) {
          return res.status(400).json({ success: false, error: "ferme, parcelle, tache, nbRealise, caporal requis" });
        }

        const today = new Date().toISOString().slice(0, 10);
        const cumulId = `${ferme}_${parcelle}_${tache}`.replace(/\s+/g, "_");
        const saisieId = `${cumulId}_${caporal}`;

        // Upsert today's saisie
        const saisieRef = db_firestore.collection("suivi-hors-recolte").doc(today).collection("saisies").doc(saisieId);
        await saisieRef.set({
          ferme, parcelle, tache,
          nbRealise: Number(nbRealise),
          nbOuvriers: Number(nbOuvriers) || 0,
          caporal,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Update cumul
        const cumulRef = db_firestore.collection("suivi-hors-recolte-cumul").doc(cumulId);
        const cumulSnap = await cumulRef.get();
        const cumulData = cumulSnap.exists ? cumulSnap.data() : { ferme, parcelle, tache, totalRealise: 0, termine: false, historique: [] };

        // Check if we already have a saisie for today in historique
        const existingIdx = (cumulData.historique || []).findIndex(h => h.date === today && h.caporal === caporal);
        let oldNb = 0;
        if (existingIdx >= 0) {
          oldNb = cumulData.historique[existingIdx].nb;
          cumulData.historique[existingIdx].nb = Number(nbRealise);
        } else {
          cumulData.historique.push({ date: today, nb: Number(nbRealise), caporal });
        }

        const newTotal = (cumulData.totalRealise || 0) - oldNb + Number(nbRealise);
        const termine = nbTotal ? newTotal >= Number(nbTotal) : false;

        await cumulRef.set({
          ferme, parcelle, tache,
          totalRealise: newTotal,
          termine,
          derniereMaj: admin.firestore.FieldValue.serverTimestamp(),
          historique: cumulData.historique,
        });

        // ---- Compute daily rendement snapshot for norm detection ----
        try {
          const allSaisiesSnap = await db_firestore.collection("suivi-hors-recolte").doc(today).collection("saisies").get();
          let totalRealiseTask = 0, totalOuvriersTask = 0;
          allSaisiesSnap.forEach(doc => {
            const d = doc.data();
            if (d.ferme === ferme && d.tache === tache) {
              totalRealiseTask += d.nbRealise || 0;
              totalOuvriersTask += d.nbOuvriers || 0;
            }
          });
          const rendementParOuvrier = totalOuvriersTask > 0
            ? Math.round(totalRealiseTask / totalOuvriersTask * 100) / 100
            : 0;

          // Get current norm from Firestore (fallback to hardcoded)
          let normeVal = 0;
          const normeId = `${tache}_${ferme}`.replace(/\s+/g, "_");
          const normeSnap = await db_firestore.collection("normes-productivite").doc(normeId).get();
          if (normeSnap.exists && normeSnap.data().actif) {
            normeVal = normeSnap.data().normeParJourParOuvrier || 0;
          } else {
            // Fallback: try generic norm (no ferme)
            const normeGenSnap = await db_firestore.collection("normes-productivite").doc(tache.replace(/\s+/g, "_")).get();
            if (normeGenSnap.exists && normeGenSnap.data().actif) {
              normeVal = normeGenSnap.data().normeParJourParOuvrier || 0;
            }
          }

          const rendementId = `${ferme}_${tache}`.replace(/\s+/g, "_");
          await db_firestore.collection("suivi-hors-recolte").doc(today).collection("rendements").doc(rendementId).set({
            ferme, tache,
            nbOuvriers: totalOuvriersTask,
            nbRealise: totalRealiseTask,
            rendementParOuvrier,
            normeEnVigueur: normeVal,
            ratioVsNorme: normeVal > 0 ? Math.round(rendementParOuvrier / normeVal * 10000) / 100 : 0,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (rendErr) {
          console.error("Erreur calcul rendement snapshot:", rendErr);
        }

        return res.json({ success: true, totalRealise: newTotal, termine });
      }

      // ---- GET-PROGRESS: récupère la progression par ferme ----
      if (action === "get-progress") {
        const ferme = req.query.ferme;
        let query = db_firestore.collection("suivi-hors-recolte-cumul");
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const progress = [];
        snap.forEach(doc => {
          const d = doc.data();
          progress.push({
            id: doc.id,
            ferme: d.ferme,
            parcelle: d.parcelle,
            tache: d.tache,
            totalRealise: d.totalRealise || 0,
            termine: d.termine || false,
            derniereMaj: d.derniereMaj ? d.derniereMaj.toDate().toISOString() : null,
            historique: d.historique || [],
          });
        });
        return res.json({ success: true, progress });
      }

      // ---- GET-SAISIES-TODAY: récupère les saisies du jour ----
      if (action === "get-saisies-today") {
        const ferme = req.query.ferme;
        const today = new Date().toISOString().slice(0, 10);
        const snap = await db_firestore.collection("suivi-hors-recolte").doc(today).collection("saisies").get();
        const saisies = [];
        snap.forEach(doc => {
          const d = doc.data();
          if (!ferme || d.ferme === ferme) {
            saisies.push({ id: doc.id, ...d, timestamp: d.timestamp ? d.timestamp.toDate().toISOString() : null });
          }
        });
        return res.json({ success: true, date: today, saisies });
      }

      // ---- DEMANDE-REEXECUTION: caporal demande à refaire une tâche terminée ----
      if (action === "demande-reexecution" && req.method === "POST") {
        const { ferme, parcelle, tache, justification, nbTunnels, caporal } = req.body;
        if (!ferme || !parcelle || !tache || !justification || !caporal) {
          return res.status(400).json({ success: false, error: "ferme, parcelle, tache, justification, caporal requis" });
        }

        const docRef = await db_firestore.collection("suivi-hors-recolte-demandes").add({
          ferme, parcelle, tache,
          justification,
          nbTunnels: Number(nbTunnels) || 0,
          caporal,
          statut: "en_attente",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.json({ success: true, id: docRef.id });
      }

      // ---- VALIDER-REEXECUTION: chef valide ou refuse ----
      if (action === "valider-reexecution" && req.method === "POST") {
        const { demandeId, decision, chef } = req.body;
        if (!demandeId || decision === undefined || !chef) {
          return res.status(400).json({ success: false, error: "demandeId, decision, chef requis" });
        }

        const demandeRef = db_firestore.collection("suivi-hors-recolte-demandes").doc(demandeId);
        const demandeSnap = await demandeRef.get();
        if (!demandeSnap.exists) return res.status(404).json({ success: false, error: "Demande non trouvée" });

        const demande = demandeSnap.data();
        await demandeRef.update({
          statut: decision ? "validee" : "refusee",
          validePar: chef,
          valideAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If approved, reset cumul for this task to allow re-execution
        if (decision) {
          const cumulId = `${demande.ferme}_${demande.parcelle}_${demande.tache}`.replace(/\s+/g, "_");
          const cumulRef = db_firestore.collection("suivi-hors-recolte-cumul").doc(cumulId);
          await cumulRef.update({
            totalRealise: 0,
            termine: false,
            historique: admin.firestore.FieldValue.arrayUnion({ date: new Date().toISOString().slice(0, 10), action: "reset", chef, reason: demande.justification }),
          });
        }

        return res.json({ success: true, statut: decision ? "validee" : "refusee" });
      }

      // ---- GET-DEMANDES: récupère les demandes en attente pour une ferme ----
      if (action === "get-demandes") {
        const ferme = req.query.ferme;
        let query = db_firestore.collection("suivi-hors-recolte-demandes").where("statut", "==", "en_attente");
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const demandes = [];
        snap.forEach(doc => {
          const d = doc.data();
          demandes.push({
            id: doc.id,
            ...d,
            createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
          });
        });
        return res.json({ success: true, demandes });
      }

      // ---- GET-NORMES: retourne les normes actives ----
      if (action === "get-normes") {
        const ferme = req.query.ferme;
        const HARDCODED_NORMES = [
          { tache: 'Désherbage', normeParJourParOuvrier: 4, unite: 'tunnels' },
          { tache: 'Nettoyage', normeParJourParOuvrier: 5, unite: 'tunnels' },
          { tache: 'Aération', normeParJourParOuvrier: 8, unite: 'tunnels' },
          { tache: 'Désherbage à sape', normeParJourParOuvrier: 3, unite: 'tunnels' },
          { tache: 'Nivellement des pots', normeParJourParOuvrier: 2, unite: 'tunnels' },
          { tache: 'Nivellement des sol', normeParJourParOuvrier: 3, unite: 'tunnels' },
          { tache: 'Palissage', normeParJourParOuvrier: 2, unite: 'tunnels' },
          { tache: 'Feuille du sol', normeParJourParOuvrier: 3, unite: 'tunnels' },
          { tache: 'Palissage Pots', normeParJourParOuvrier: 5, unite: 'tunnels' },
          { tache: 'Ramassage Ficelle', normeParJourParOuvrier: 6, unite: 'tunnels' },
        ];
        const snap = await db_firestore.collection("normes-productivite").where("actif", "==", true).get();
        if (snap.empty) {
          return res.json({ success: true, source: "hardcoded", normes: HARDCODED_NORMES });
        }
        const normes = [];
        snap.forEach(doc => {
          const d = doc.data();
          if (!ferme || !d.ferme || d.ferme === ferme) {
            normes.push({ id: doc.id, ...d });
          }
        });
        return res.json({ success: true, source: "firestore", normes });
      }

      // ---- UPDATE-NORME: chef modifie une norme ----
      if (action === "update-norme" && req.method === "POST") {
        const { tache, ferme, nouvelleValeur, raison, modifiePar } = req.body;
        if (!tache || nouvelleValeur === undefined || !modifiePar) {
          return res.status(400).json({ success: false, error: "tache, nouvelleValeur, modifiePar requis" });
        }
        const normeId = ferme ? `${tache}_${ferme}`.replace(/\s+/g, "_") : tache.replace(/\s+/g, "_");
        const normeRef = db_firestore.collection("normes-productivite").doc(normeId);
        const normeSnap = await normeRef.get();
        const ancienneValeur = normeSnap.exists ? (normeSnap.data().normeParJourParOuvrier || 0) : 0;

        await normeRef.set({
          tache, ferme: ferme || null,
          unite: "tunnels",
          normeParJourParOuvrier: Number(nouvelleValeur),
          actif: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        await db_firestore.collection("normes-historique").add({
          tache, ferme: ferme || null,
          ancienneValeur, nouvelleValeur: Number(nouvelleValeur),
          raison: raison || "manual",
          proposePar: modifiePar,
          validePar: modifiePar,
          statut: "validee",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.json({ success: true, normeId, ancienneValeur, nouvelleValeur: Number(nouvelleValeur) });
      }

      // ---- GET-PARCELLES-CONFIG: retourne la config parcelles par ferme ----
      if (action === "get-parcelles-config") {
        const ferme = req.query.ferme;
        const HARDCODED_PARCELLES = {
          F5: [
            { parcelle: 'Corina', variete: 'Corina', nbTunnels: 64, unite: 'tunnels' },
            { parcelle: 'Cascade', variete: 'Cascade', nbTunnels: 34, unite: 'tunnels' },
            { parcelle: 'Breeze', variete: 'Breeze', nbTunnels: 16, unite: 'tunnels' },
            { parcelle: 'Reina S9', variete: 'Reyna', nbTunnels: 66, unite: 'tunnels' },
          ],
          F1: [
            { parcelle: 'Maravilla Green Cane', variete: 'Maravilla', nbTunnels: 72, unite: 'tunnels' },
            { parcelle: 'Yazmin Cut Back', variete: 'Yazmin', nbTunnels: 43, unite: 'tunnels' },
          ],
        };
        let query = db_firestore.collection("parcelles-config").where("actif", "==", true);
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        if (snap.empty) {
          if (ferme && HARDCODED_PARCELLES[ferme]) {
            return res.json({ success: true, source: "hardcoded", parcelles: HARDCODED_PARCELLES[ferme] });
          }
          return res.json({ success: true, source: "hardcoded", parcelles: ferme ? [] : HARDCODED_PARCELLES });
        }
        const parcelles = [];
        snap.forEach(doc => parcelles.push({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, source: "firestore", parcelles });
      }

      // ---- UPDATE-PARCELLE-CONFIG: modifie la config d'une parcelle ----
      if (action === "update-parcelle-config" && req.method === "POST") {
        const { ferme, parcelle, variete, nbTunnels, unite } = req.body;
        if (!ferme || !parcelle || nbTunnels === undefined) {
          return res.status(400).json({ success: false, error: "ferme, parcelle, nbTunnels requis" });
        }
        const docId = `${ferme}_${parcelle}`.replace(/\s+/g, "_");
        await db_firestore.collection("parcelles-config").doc(docId).set({
          ferme, parcelle,
          variete: variete || "",
          nbTunnels: Number(nbTunnels),
          unite: unite || "tunnels",
          actif: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return res.json({ success: true, id: docId });
      }

      // ---- DETECT-NORM-ADJUSTMENTS: analyse rendements et propose des ajustements ----
      if (action === "detect-norm-adjustments") {
        const DAYS_LOOKBACK = 14;
        const MIN_DAYS = 7;
        const MIN_WORKERS_PER_DAY = 3;
        const THRESHOLD_PCT = 120;

        const dates = [];
        for (let i = 0; i < DAYS_LOOKBACK; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          dates.push(d.toISOString().slice(0, 10));
        }

        const taskStats = {};
        for (const date of dates) {
          const snap = await db_firestore.collection("suivi-hors-recolte").doc(date).collection("rendements").get();
          snap.forEach(doc => {
            const d = doc.data();
            const key = `${d.ferme}_${d.tache}`;
            if (!taskStats[key]) taskStats[key] = { ferme: d.ferme, tache: d.tache, ratios: [], totalWorkers: 0, normeEnVigueur: d.normeEnVigueur };
            if (d.nbOuvriers >= MIN_WORKERS_PER_DAY) {
              taskStats[key].ratios.push(d.ratioVsNorme);
              taskStats[key].totalWorkers += d.nbOuvriers;
              taskStats[key].normeEnVigueur = d.normeEnVigueur;
            }
          });
        }

        const proposals = [];
        for (const [, stats] of Object.entries(taskStats)) {
          if (stats.ratios.length < MIN_DAYS || stats.normeEnVigueur <= 0) continue;
          const avgRatio = stats.ratios.reduce((a, b) => a + b, 0) / stats.ratios.length;
          if (avgRatio >= THRESHOLD_PCT) {
            const rawNorm = stats.normeEnVigueur * avgRatio / 100;
            const proposedNorm = Math.round(rawNorm * 2) / 2; // arrondi à 0.5
            proposals.push({
              ferme: stats.ferme,
              tache: stats.tache,
              currentNorm: stats.normeEnVigueur,
              proposedNorm,
              avgRatio: Math.round(avgRatio),
              daysAnalyzed: stats.ratios.length,
              avgWorkers: Math.round(stats.totalWorkers / stats.ratios.length),
            });
          }
        }

        return res.json({ success: true, proposals, analyzedDays: DAYS_LOOKBACK, threshold: THRESHOLD_PCT });
      }

      // ---- PROPOSE-NORM-CHANGE: crée une proposition de changement de norme ----
      if (action === "propose-norm-change" && req.method === "POST") {
        const { ferme, tache, currentNorm, proposedNorm, avgRatio, daysAnalyzed, avgWorkers, proposePar } = req.body;
        if (!tache || proposedNorm === undefined) {
          return res.status(400).json({ success: false, error: "tache, proposedNorm requis" });
        }
        const docRef = await db_firestore.collection("normes-historique").add({
          tache, ferme: ferme || null,
          ancienneValeur: Number(currentNorm) || 0,
          nouvelleValeur: Number(proposedNorm),
          raison: "auto-detection",
          detailsDetection: {
            nbJours: daysAnalyzed || 0,
            rendementMoyen: avgRatio || 0,
            nbOuvriers: avgWorkers || 0,
            periode: { debut: null, fin: new Date().toISOString().slice(0, 10) },
          },
          proposePar: proposePar || "system",
          validePar: null,
          statut: "proposee",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true, id: docRef.id });
      }

      // ---- VALIDATE-NORM-CHANGE: chef valide ou refuse une proposition ----
      if (action === "validate-norm-change" && req.method === "POST") {
        const { proposalId, decision, chef } = req.body;
        if (!proposalId || decision === undefined || !chef) {
          return res.status(400).json({ success: false, error: "proposalId, decision, chef requis" });
        }
        const propRef = db_firestore.collection("normes-historique").doc(proposalId);
        const propSnap = await propRef.get();
        if (!propSnap.exists) return res.status(404).json({ success: false, error: "Proposition non trouvée" });

        const prop = propSnap.data();
        const newStatut = decision ? "validee" : "refusee";

        await propRef.update({
          statut: newStatut,
          validePar: chef,
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If approved, update the active norm
        if (decision) {
          const normeId = prop.ferme
            ? `${prop.tache}_${prop.ferme}`.replace(/\s+/g, "_")
            : prop.tache.replace(/\s+/g, "_");
          await db_firestore.collection("normes-productivite").doc(normeId).set({
            tache: prop.tache,
            ferme: prop.ferme || null,
            unite: "tunnels",
            normeParJourParOuvrier: prop.nouvelleValeur,
            actif: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        return res.json({ success: true, statut: newStatut });
      }

      // ---- GET-NORM-PROPOSALS: récupère les propositions en attente ----
      if (action === "get-norm-proposals") {
        const ferme = req.query.ferme;
        let query = db_firestore.collection("normes-historique").where("statut", "==", "proposee");
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const proposals = [];
        snap.forEach(doc => {
          const d = doc.data();
          proposals.push({
            id: doc.id, ...d,
            createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
          });
        });
        return res.json({ success: true, proposals });
      }

      // ---- GET-POINTAGE-WORKERS: nb ouvriers hors-récolte par parcelle/tâche depuis pointage du jour ----
      if (action === "get-pointage-workers") {
        const ferme = req.query.ferme;
        const today = new Date().toISOString().slice(0, 10);
        const rows = await getPointageRowsForDate(today);

        // deriveFerme inline (same logic as pointageService.js)
        function deriveFermeLocal(refParcelle, parcelleCulturale) {
          const ref = (refParcelle || "").trim();
          if (ref) {
            if (ref.startsWith("F1") || ref === "0032" || ref === "0035" || ref === "0036") return "F1";
            if (ref.startsWith("F5") || ref === "0037" || ref === "0038" || ref === "0039") return "F5";
            if (ref.startsWith("F2") || ref.startsWith("F3") || ref.startsWith("F4") || ref.startsWith("F6") || ref === "0031" || ref === "0033") return "Avocatier";
          }
          if (parcelleCulturale) {
            if (/F1/i.test(parcelleCulturale)) return "F1";
            if (/F5/i.test(parcelleCulturale)) return "F5";
            if (/avocat/i.test(parcelleCulturale)) return "Avocatier";
            const sMatch = parcelleCulturale.match(/\bS(\d{1,2})\b/i);
            if (sMatch) { const sNum = parseInt(sMatch[1], 10); if (sNum >= 1 && sNum <= 7) return "F1"; if (sNum >= 8 && sNum <= 14) return "F5"; }
          }
          return "Autre";
        }

        // Filter hors-récolte only, group by parcelle × operation
        const groups = {};
        for (const r of rows) {
          const opFamille = r.Operation_Famille || "";
          if (opFamille === "8. Récolte" || opFamille === "11. Postes fixes") continue;
          const rowFerme = deriveFermeLocal(r.Ref_parcelle, r.Parcelle_Culturale);
          if (ferme && rowFerme !== ferme) continue;

          const parcelle = (r.Parcelle_Culturale || "").trim();
          const operation = (r.Operation || "").trim();
          const key = `${parcelle}|${operation}`;
          if (!groups[key]) groups[key] = { parcelle, tache: operation, ferme: rowFerme, workers: new Set() };
          if (r.Personnel_Matricule) groups[key].workers.add(r.Personnel_Matricule);
        }

        const result = Object.values(groups).map(g => ({
          parcelle: g.parcelle,
          tache: g.tache,
          ferme: g.ferme,
          nbOuvriers: g.workers.size,
        }));

        return res.json({ success: true, date: today, workers: result });
      }

      // ---- MIGRATE-CONFIG: migration one-shot des données hardcodées vers Firestore ----
      if (action === "migrate-config" && req.method === "POST") {
        const batch = db_firestore.batch();
        let count = 0;

        // Migrate normes
        const normesHardcoded = [
          { tache: 'Désherbage', normeParJourParOuvrier: 4 },
          { tache: 'Nettoyage', normeParJourParOuvrier: 5 },
          { tache: 'Aération', normeParJourParOuvrier: 8 },
          { tache: 'Désherbage à sape', normeParJourParOuvrier: 3 },
          { tache: 'Nivellement des pots', normeParJourParOuvrier: 2 },
          { tache: 'Nivellement des sol', normeParJourParOuvrier: 3 },
          { tache: 'Palissage', normeParJourParOuvrier: 2 },
          { tache: 'Feuille du sol', normeParJourParOuvrier: 3 },
          { tache: 'Palissage Pots', normeParJourParOuvrier: 5 },
          { tache: 'Ramassage Ficelle', normeParJourParOuvrier: 6 },
        ];
        for (const n of normesHardcoded) {
          const docId = n.tache.replace(/\s+/g, "_");
          batch.set(db_firestore.collection("normes-productivite").doc(docId), {
            tache: n.tache, ferme: null, unite: "tunnels",
            normeParJourParOuvrier: n.normeParJourParOuvrier,
            actif: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          count++;
        }

        // Migrate parcelles config
        const parcConfig = {
          F5: [
            { parcelle: 'Corina', variete: 'Corina', nbTunnels: 64 },
            { parcelle: 'Cascade', variete: 'Cascade', nbTunnels: 34 },
            { parcelle: 'Breeze', variete: 'Breeze', nbTunnels: 16 },
            { parcelle: 'Reina S9', variete: 'Reyna', nbTunnels: 66 },
          ],
          F1: [
            { parcelle: 'Maravilla Green Cane', variete: 'Maravilla', nbTunnels: 72 },
            { parcelle: 'Yazmin Cut Back', variete: 'Yazmin', nbTunnels: 43 },
          ],
        };
        for (const [ferme, parcelles] of Object.entries(parcConfig)) {
          for (const p of parcelles) {
            const docId = `${ferme}_${p.parcelle}`.replace(/\s+/g, "_");
            batch.set(db_firestore.collection("parcelles-config").doc(docId), {
              ferme, parcelle: p.parcelle, variete: p.variete,
              nbTunnels: p.nbTunnels, unite: "tunnels", actif: true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            count++;
          }
        }

        await batch.commit();
        return res.json({ success: true, migrated: count });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur horsRecolteService:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Budget vs Réel — Suivi budgétaire
// =============================================
