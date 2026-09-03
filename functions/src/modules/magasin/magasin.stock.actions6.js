/* Actions 6/6 de stockManagement — corps repris VERBATIM.
   Le contexte du handler (req, res, action, helpers) arrive par `ctx` ; la
   destructuration ci-dessous recree exactement les liaisons d'origine, si bien
   que les corps n'ont pas ete touches. */
'use strict';
const { NOT_HANDLED } = require("./_dispatch");
const { METEO_FERMES, db_firestore, functions, resolveCallerRole, stockMovementGuard, sliceArticleHistory, pmpDetailLib, locationsConfig, getArticleHistoryIndex, getInvoiceByArticleIndex, fetchMeteoForecast7d, fetchHourlyRadiationByDate, loadIndoorHourlyRadiationByGhType } = require("./magasin.stock.deps");

module.exports = async function stockActions6(ctx) {
  const { req, res, action, adminSecret, authUser, updateStockBalance, applyStockImpact, reverseStockImpact, getChefProfileForFerme, resolveRequesterIdentity } = ctx;



      // --- GET PMP DETAIL (popup read-only : grand livre vs prix facturé) ---
      // Lecture seule, AUCUNE écriture, AUCUNE re-valorisation. Affiche le détail
      // du coût PMP de l'écran Inventaire en 2 colonnes :
      //   (1) PMP grand livre  = articles_catalog.prix_pmp (valeur affichée, source
      //       de vérité — cf. valuationPMP.js). Les prix par LIGNE du grand livre ne
      //       sont PAS persistés en Firestore (seul le PMP final l'est) : on liste
      //       donc les bons d'entrée + inventaire d'ouverture (qté/unité/date/lieu)
      //       depuis l'index grand livre, sans prix par ligne fabriqué.
      //   (2) PMP au prix facturé = pondéré sur les lignes facture TIMAC cohérentes
      //       en unité (Tonne→KG normalisée), null si unité divergente (cf. pmpDetail).
      if (action === "get-pmp-detail") {
        const articleRef = (req.query.article_ref || "").trim();
        const articleNom = (req.query.article_nom || "").trim();
        const filterLieuId = req.query.lieu || req.query.magasin || null;
        const articleParam = articleNom || articleRef;
        if (!articleParam) {
          return res.status(400).json({ success: false, error: "article_ref ou article_nom requis" });
        }

        const canon = pmpDetailLib.canon;
        const keyCanon = canon(articleParam);

        // -- Article + unité stock (depuis articles_catalog : prix_pmp + unite) --
        let prix_pmp = null;
        let prix_pmp_source = null;
        let unite_stock = "";
        let articleNomResolu = articleParam;
        const catSnap = await db_firestore.collection("articles_catalog").get();
        catSnap.forEach((doc) => {
          const a = doc.data() || {};
          if (!a.nom) return;
          const matchNom = canon(a.nom) === keyCanon;
          const matchRef = a.reference && canon(a.reference) === keyCanon;
          if (!matchNom && !matchRef) return;
          // Garde l'entrée avec un prix_pmp > 0 si plusieurs docs collisionnent sur le canon.
          const p = parseFloat(a.prix_pmp);
          if (prix_pmp == null || (!(prix_pmp > 0) && p > 0)) {
            prix_pmp = isFinite(p) ? p : prix_pmp;
            prix_pmp_source = a.prix_pmp_source || prix_pmp_source;
            unite_stock = a.unite || unite_stock;
            articleNomResolu = a.nom || articleNomResolu;
          }
        });

        // -- Lignes grand livre (entrées + inventaire ouverture) depuis l'index --
        const articleIndex = await getArticleHistoryIndex(db_firestore);
        const slice = sliceArticleHistory(articleIndex, articleParam, filterLieuId);
        if (!unite_stock) unite_stock = (slice.article && slice.article.unite) || "";
        const glLignes = (slice.entries || [])
          .filter((e) => e.sens === "entree" && e.type === "reception")
          .map((e) => ({
            date: e.date,
            lieu: `${e.lieu_type}|${e.lieu_id}`,
            numero: e.numero,
            qte: e.quantite,
            unite: e.unite,
            // Les prix par ligne du grand livre ne sont pas stockés en Firestore.
            prix_brut: null,
            prix_normalise: null,
          }));

        // -- Lignes facture rattachées à cet article stock --
        const invoiceIndex = await getInvoiceByArticleIndex(db_firestore);
        const factureLignesRaw = invoiceIndex[keyCanon] || [];
        const factureCalc = pmpDetailLib.computeFacturePMP(factureLignesRaw, unite_stock);

        return res.json({
          success: true,
          article: articleNomResolu,
          unite_stock,
          grand_livre: {
            prix_pmp,
            prix_pmp_source,
            lignes: glLignes,
            // PMP pondéré du grand livre = la valeur affichée (articles_catalog.prix_pmp).
            // Non recalculé ici : les prix par ligne ne sont pas persistés en Firestore
            // (seul le PMP final l'est, cf. apply-pmp-catalogue.js / valuationPMP.js).
            pmp_pondere: prix_pmp,
          },
          facture: {
            lignes: factureCalc.lignes.map((l) => ({
              numero_facture: l.numero_facture,
              date_facture: l.date_facture,
              designation: l.designation,
              qte: l.qte,
              unite: l.unite,
              prix_unitaire: l.prix_unitaire,
            })),
            unite_dominante: factureCalc.unite_dominante,
            coherence_unite: factureCalc.coherence_unite,
            pmp_pondere: factureCalc.pmp_pondere,
            note: factureCalc.note,
          },
        });
      }


      // --- GET STOCK LOCATIONS CONFIG ---
      if (action === "get-locations") {
        const snap = await db_firestore.collection("stock_config").doc("locations").get();
        if (!snap.exists) {
          // Initialize default locations
          const defaultLocations = {
            magasins: ["F1", "F2", "F5", "F6"],
            stations: ["Station F1", "Station F2", "Station F3", "Station F4", "Station F5", "Station F6"],
            parcelles: {
              "F1": ["S1 Maravilla", "S2 Yazmin", "S3 Maravilla Motte", "S4 Maravilla", "S5 Yazmin", "S7 Maravilla Motte", "P3-Framboise", "P5-Framboise B"],
              "F5": ["S8 Corina", "S9 Reyna", "S10 Yazmin", "S13 Yazmin", "P2-Framboise A", "P3-Framboise B"],
              "Avocatier": ["Avocat F2", "Avocat F4", "Avocat F5"]
            }
          };
          await db_firestore.collection("stock_config").doc("locations").set(defaultLocations);
          return res.json({ success: true, locations: defaultLocations });
        }
        return res.json({ success: true, locations: snap.data() });
      }


      // --- SET STOCK LOCATIONS CONFIG (update ciblé, write via CF, rôles dg|finance) ---
      // Met à jour UNIQUEMENT les champs fournis (magasins / stations / parcelles).
      // N'écrase jamais les champs non fournis (merge). Idempotent : réécrire la même
      // liste ne change rien. Le rôle est dérivé du TOKEN (resolveCallerRole), jamais du body.
      if (action === "set-locations" && req.method === "POST") {
        // Rôle RÉEL dérivé du token Firebase (anti-spoof body). Jamais req.body.role.
        const callerRole = await resolveCallerRole(authUser);
        const auth = locationsConfig.authorizeSetLocations(callerRole);
        if (!auth.allowed) {
          return res.status(auth.status).json({ success: false, error: auth.error });
        }

        const built = locationsConfig.buildLocationsPatch(req.body);
        if (!built.ok) {
          return res.status(built.status).json({ success: false, error: built.error });
        }

        const ref = db_firestore.collection("stock_config").doc("locations");
        // merge:true → update CIBLÉ, ne touche pas aux champs absents du patch (idempotent).
        await ref.set(built.patch, { merge: true });
        const after = await ref.get();
        return res.json({ success: true, locations: after.data() });
      }


      // --- MIGRATE: auto-validate transfert/consommation stuck in valide_mag ---
      if (action === "migrate-auto-validate" && req.method === "POST") {
        const dryRun = req.body?.dry_run === true;
        const snap = await db_firestore.collection("stock_movements")
          .where("status", "==", "valide_mag")
          .get();
        const sampleByType = { transfert: [], consommation: [], reception: [], sortie: [] };
        const counts = { transfert: 0, consommation: 0, reception: 0, sortie: 0, autre: 0 };
        const toUpdate = [];
        for (const doc of snap.docs) {
          const m = doc.data();
          counts[m.type] = (counts[m.type] || 0) + 1;
          if (m.type === "transfert" || m.type === "consommation") {
            toUpdate.push(doc);
            if (sampleByType[m.type].length < 3) sampleByType[m.type].push({ numero: m.numero, date: m.date, ferme: m.ferme });
          }
        }
        if (dryRun) {
          return res.json({ success: true, dry_run: true, total_scanned: snap.size, counts, would_update: toUpdate.length, sample: sampleByType });
        }
        // Real apply
        let updated = 0;
        let batch = db_firestore.batch();
        let batchCount = 0;
        for (const doc of toUpdate) {
          batch.update(doc.ref, { status: "valide_chef", updated_at: Date.now() });
          updated++;
          batchCount++;
          if (batchCount >= 400) {
            await batch.commit();
            batch = db_firestore.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, updated, total_scanned: snap.size });
      }


      // --- GET PRICE HISTORY FOR AN ARTICLE ---
      if (action === "get-price-history") {
        const { article, date_from, date_to } = req.query;
        if (!article) return res.status(400).json({ success: false, error: "article requis" });

        let q = db_firestore.collection("stock_movements")
          .where("type", "==", "reception");
        if (date_from) q = q.where("date", ">=", date_from);
        if (date_to) q = q.where("date", "<=", date_to);
        const snap = await q.get();

        const articleLower = article.toLowerCase();
        const history = [];
        const bdcCache = {};

        for (const doc of snap.docs) {
          const mov = doc.data();
          if (mov.status === "rejete") continue;
          if (stockMovementGuard.isDeletedMovement(mov)) continue; // exclusion défensive soft-delete

          const item = (mov.items || []).find(i =>
            (i.article_nom || "").toLowerCase() === articleLower ||
            (i.article_ref || "").toLowerCase() === articleLower
          );
          if (!item) continue;

          // Try multiple price field names (legacy/import data uses prix_unitaire_ttc)
          let prix = parseFloat(item.prix_unitaire) || parseFloat(item.prix_unitaire_ttc) || parseFloat(item.prix_unitaire_ht) || null;
          let fournisseur = mov.fournisseur_nom || mov.fourn || null;
          let bdc_numero = null;

          if (!prix && mov.bdc_id) {
            if (!bdcCache[mov.bdc_id]) {
              const bdcSnap = await db_firestore.collection("purchase_orders").doc(mov.bdc_id).get();
              bdcCache[mov.bdc_id] = bdcSnap.exists ? bdcSnap.data() : null;
            }
            const bdc = bdcCache[mov.bdc_id];
            if (bdc) {
              const bdcItem = (bdc.items || []).find(i =>
                (i.article || "").toLowerCase() === articleLower
              );
              if (bdcItem) prix = parseFloat(bdcItem.prix_unitaire) || null;
              fournisseur = fournisseur || (bdc.fournisseur || {}).nom || null;
              bdc_numero = bdc.numero || null;
            }
          }

          if (prix && prix > 0) {
            history.push({
              date: mov.date, prix_unitaire: prix, quantite: item.quantite,
              unite: item.unite || "kg", fournisseur, bdc_numero, numero: mov.numero
            });
          }
        }

        history.sort((a, b) => a.date.localeCompare(b.date));
        return res.json({ success: true, article, history, count: history.length });
      }


      // --- PENDING VALIDATIONS (for chef badges) ---
      if (action === "pending-validations") {
        const { role: pendingRole } = req.query;
        let targetStatus = null;
        if (pendingRole === "achats") targetStatus = "en_attente_achats";
        else if (["chef_f1", "chef_f5", "chef_avo"].includes(pendingRole)) targetStatus = "valide_mag";
        else return res.status(400).json({ success: false, error: "Role invalide" });

        let q = db_firestore.collection("stock_movements").where("status", "==", targetStatus);
        // For chef, filter by ferme
        if (pendingRole === "chef_f1") q = q.where("ferme", "==", "F1");
        else if (pendingRole === "chef_f5") q = q.where("ferme", "==", "F5");
        else if (pendingRole === "chef_avo") q = q.where("ferme", "in", ["F2", "F3", "F4", "F6"]);

        const snap = await q.get();
        const pending = snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((m) => !stockMovementGuard.isDeletedMovement(m));
        return res.json({ success: true, pending, count: pending.length });
      }


      // =============================================
      // IRRIGATION CONFIG & FORECAST
      // =============================================
      if (action === "get-irrigation-config") {
        const ferme = req.query.ferme || "F1";
        const doc = await db_firestore.collection("config_irrigation").doc(ferme).get();
        return res.json({ success: true, config: doc.exists ? doc.data() : null });
      }


      if (action === "save-irrigation-config" && req.method === "POST") {
        const { ferme, parcelles, updated_by } = req.body;
        if (!ferme || !parcelles) return res.status(400).json({ success: false, error: "ferme et parcelles requis" });
        await db_firestore.collection("config_irrigation").doc(ferme).set({
          ferme, parcelles, updated_by: updated_by || "unknown", updated_at: Date.now(),
        }, { merge: true });
        return res.json({ success: true });
      }


      if (action === "get-irrigation-forecast") {
        const ferme = req.query.ferme || "F1";
        const coords = METEO_FERMES[ferme] || METEO_FERMES.F1;

        // 1. Get irrigation config
        const configDoc = await db_firestore.collection("config_irrigation").doc(ferme).get();
        const irriConfig = configDoc.exists ? configDoc.data() : null;

        // 2. Get 7-day outdoor forecast
        const forecast = await fetchMeteoForecast7d(coords.lat, coords.lon);

        // 3. Get climat model (indoor prediction)
        const modelDoc = await db_firestore.collection("climat_models").doc(ferme + "_tunnel").get();
        const model = modelDoc.exists ? modelDoc.data() : null;

        // 4. Get latest soil analyses for this farm
        const soilSnap = await db_firestore.collection("analyses_foliaires")
          .where("ferme", "==", ferme)
          .where("type_analyse", "==", "sol")
          .where("statut", "==", "completee")
          .orderBy("date_resultat", "desc").limit(3).get();
        const soilAnalyses = soilSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 5. Build indoor forecast using model
        let indoorForecast = [];
        if (model && model.coefficients && forecast.length > 0) {
          const c = model.coefficients;
          indoorForecast = forecast.map(day => {
            const tmaxIn = c.tmax ? Math.round((c.tmax.a * day.tmax + c.tmax.b) * 10) / 10 : day.tmax;
            const tminIn = c.tmin ? Math.round((c.tmin.a * day.tmin + c.tmin.b) * 10) / 10 : day.tmin;
            const hrIn = c.hr ? Math.min(100, Math.max(20, Math.round(c.hr.a * (day.humidity || 60) + c.hr.b))) : day.humidity || 60;
            const tMean = (tmaxIn + tminIn) / 2;
            const esat = 0.6108 * Math.exp((17.27 * tMean) / (tMean + 237.3));
            const vpd = Math.round(esat * (1 - hrIn / 100) * 100) / 100;
            return { date: day.date, tmax: tmaxIn, tmin: tminIn, hr: hrIn, vpd, eto_outdoor: day.eto, precip: day.precip, radiation: day.radiation };
          });
        }

        // 6. Compute irrigation recommendations per parcelle
        const parcelles = irriConfig ? irriConfig.parcelles || {} : {};
        const recommendations = {};
        const todayForecast = forecast.length > 0 ? forecast[0] : null;

        let soilCE = null;
        if (soilAnalyses.length > 0 && soilAnalyses[0].parsed_values) {
          const ce = soilAnalyses[0].parsed_values.CE || soilAnalyses[0].parsed_values["C.E."];
          if (ce) soilCE = parseFloat(ce);
        }

        for (const [parcName, parcConfig] of Object.entries(parcelles)) {
          if (!todayForecast) continue;
          const eto = todayForecast.eto || 4;
          const kc = parcConfig.kc || 0.85;
          const coeffTunnel = parcConfig.coeff_tunnel || (parcConfig.type_abri === "plein_champ" ? 1.0 : 0.7);
          const efficacite = parcConfig.efficacite || 0.90;
          const surfaceHa = parcConfig.surface_ha || 1;
          const debitPompe = parcConfig.debit_pompe || 10;
          const ru = parcConfig.reserve_utile || 120;
          const profondeur = parcConfig.profondeur_racinaire || 0.4;
          const seuil = parcConfig.seuil_declenchement || 0.4;

          const etc = eto * kc * coeffTunnel;
          let besoinNet = etc - Math.max(0, (todayForecast.precip || 0) * (parcConfig.type_abri === "plein_champ" ? 0.8 : 0));
          if (besoinNet < 0) besoinNet = 0;
          let besoinBrut = besoinNet / efficacite;
          if (soilCE && soilCE > 2.5) besoinBrut *= 1.15;

          const ruTotale = ru * profondeur;
          const doseMax = ruTotale * seuil;
          const nbTours = besoinBrut > 0 ? Math.max(1, Math.ceil(besoinBrut / doseMax)) : 0;
          const doseParTour = nbTours > 0 ? besoinBrut / nbTours : 0;
          const volumeM3 = doseParTour * surfaceHa * 10;
          const dureeH = debitPompe > 0 ? volumeM3 / debitPompe : 0;

          recommendations[parcName] = {
            eto, kc, coeff_tunnel: coeffTunnel, etc: Math.round(etc * 10) / 10,
            besoin_net: Math.round(besoinNet * 10) / 10,
            besoin_brut: Math.round(besoinBrut * 10) / 10,
            ru_totale: Math.round(ruTotale),
            dose_max: Math.round(doseMax * 10) / 10,
            nb_tours: nbTours,
            dose_par_tour: Math.round(doseParTour * 10) / 10,
            volume_m3: Math.round(volumeM3 * 10) / 10,
            duree_h: Math.round(dureeH * 100) / 100,
            duree_label: Math.floor(dureeH) + "h" + String(Math.round((dureeH % 1) * 60)).padStart(2, "0"),
            alerte_ce: soilCE && soilCE > 2.5 ? "CE élevée (" + soilCE + " dS/m) — +15% lessivage" : null,
            culture: parcConfig.culture, type_abri: parcConfig.type_abri,
          };
        }

        // 7. Build 7-day irrigation plan
        const plan7j = forecast.map((day, i) => {
          let totalDuree = 0;
          for (const [, parcConfig] of Object.entries(parcelles)) {
            const eto = day.eto || 4;
            const kc = parcConfig.kc || 0.85;
            const coeffT = parcConfig.coeff_tunnel || 0.7;
            const eff = parcConfig.efficacite || 0.90;
            const surf = parcConfig.surface_ha || 1;
            const debit = parcConfig.debit_pompe || 10;
            let besoin = (eto * kc * coeffT) / eff;
            if (parcConfig.type_abri === "plein_champ") besoin -= Math.max(0, (day.precip || 0) * 0.8) / eff;
            if (besoin < 0) besoin = 0;
            totalDuree += (besoin * surf * 10) / debit;
          }
          return {
            date: day.date, eto: day.eto, precip: day.precip,
            duree_totale_h: Math.round(totalDuree * 100) / 100,
            indoor: indoorForecast[i] || null,
          };
        });

        return res.json({
          success: true, ferme, forecast, indoorForecast,
          model: model ? { coefficients: model.coefficients, training_days: model.training_days, r2_tmax: model.coefficients.tmax?.r2, daily_errors: (model.daily_errors || []).slice(-7) } : null,
          recommendations, plan7j,
          soilAnalyses: soilAnalyses.map(a => ({ id: a.id, date: a.date_resultat, parsed_values: a.parsed_values, ferme: a.ferme })),
          config: irriConfig,
        });
      }


      // ========== IRRIGATION META — dynamic per-parcelle config ==========
      // GET  ?action=irrigation-meta-list                → all parcelle meta
      // POST ?action=irrigation-meta-save  body={id, meta} → upsert one
      // POST ?action=irrigation-meta-seed                → seed Firestore from static
      if (action === "irrigation-meta-list") {
        const II = require("../../../lib/irrigation");
        const snap = await db_firestore.collection(II.FIRESTORE_COLLECTION).get();
        const fromDb = {};
        snap.docs.forEach(d => { fromDb[d.id] = d.data(); });
        // Merge with static fallback so caller sees the union
        const merged = { ...II.PARCELLE_META, ...fromDb };
        return res.json({ success: true, meta: merged, source: { hardcoded: Object.keys(II.PARCELLE_META).length, firestore: Object.keys(fromDb).length } });
      }

      if (action === "irrigation-meta-save" && req.method === "POST") {
        const { id, meta } = req.body || {};
        if (!id || !meta) return res.status(400).json({ success: false, error: "id et meta requis" });
        const II = require("../../../lib/irrigation");
        await db_firestore.collection(II.FIRESTORE_COLLECTION).doc(id).set({
          ...meta,
          updated_at: Date.now(),
        }, { merge: true });
        II.clearParcelleMetaCache();
        return res.json({ success: true, id });
      }

      if (action === "irrigation-meta-seed" && req.method === "POST") {
        const II = require("../../../lib/irrigation");
        const batch = db_firestore.batch();
        const ids = Object.keys(II.PARCELLE_META);
        for (const id of ids) {
          const ref = db_firestore.collection(II.FIRESTORE_COLLECTION).doc(id);
          batch.set(ref, { ...II.PARCELLE_META[id], seeded_at: Date.now() }, { merge: true });
        }
        await batch.commit();
        II.clearParcelleMetaCache();
        return res.json({ success: true, seeded: ids.length });
      }


      // ========== IRRIGATION NEXT-PULSE — operator feedback ==========
      // Returns a single concise recommendation for the stationnaire who
      // just saved a pulse: continue / shorter / longer / wait / stop.
      // Includes radiation-driven "next pulse at HH:MM" prediction.
      if (action === "irrigation-intelligence-next-pulse") {
        const ferme = req.query.ferme;
        const parcelle = req.query.parcelle;
        // "Now" in Africa/Casablanca local time — heure de pulse stockée en local
        const _nowParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Casablanca",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(new Date());
        const _np = {};
        _nowParts.forEach(p => { _np[p.type] = p.value; });
        const todayDate = `${_np.year}-${_np.month}-${_np.day}`;
        const nowMin = Number(_np.hour) * 60 + Number(_np.minute);
        const date = req.query.date || todayDate;
        if (!ferme || !parcelle) {
          return res.status(400).json({ success: false, error: "ferme et parcelle requis" });
        }
        const II = require("../../../lib/irrigation");
        const raws = await II.fetchIrrigationReadings(db_firestore, {
          ferme, dateFrom: date, dateTo: date, parcelle,
        });
        let weatherToday = null;
        let weatherByDate = {};
        try {
          const coords = METEO_FERMES[ferme] || METEO_FERMES.F1;
          const [fc, hourlyByDate] = await Promise.all([
            fetchMeteoForecast7d(coords.lat, coords.lon),
            fetchHourlyRadiationByDate(coords.lat, coords.lon, 1, 2),
          ]);
          weatherToday = fc && fc[0];
          weatherByDate = hourlyByDate || {};
          // Augment weatherToday with today's hourly radiation + sunrise/sunset
          if (weatherToday && weatherByDate[date]) {
            weatherToday = { ...weatherToday, ...weatherByDate[date] };
          }
        } catch (e) { /* best effort, ignore */ }
        const parcelleMetaById = await II.loadParcelleMetaFromFirestore(db_firestore, [parcelle]);
        const meta = parcelleMetaById[parcelle] || II.getParcelleMeta(parcelle);
        const indoorRadByGhType = await loadIndoorHourlyRadiationByGhType(Object.keys(weatherByDate));
        const { summaries } = II.analyseReadings(raws, undefined, undefined, { weatherByDate, parcelleMetaById, indoorRadByGhType, todayDate, nowMin });
        const todaysSummary = summaries[0] || null;
        const advice = II.recommendNextPulse(todaysSummary, weatherToday, undefined, meta);

        // F3 live data — RadSum since last pulse to "now".
        // Prefer FarmRoad indoor radiation; fallback to Open-Meteo × transmittance
        // for the live ETA (UX: don't leave the ops user without a prediction
        // when today's FarmRoad doc isn't yet populated).
        let radSumSinceLastPulseNow = null;
        let radTargetJPerCm2 = II.getRadiationTarget((meta && meta.culture) || null, II.DEFAULT_THRESHOLDS);
        let radEtaMin = null;
        let radEtaTime = null;
        let radDataSource = null;
        const ghTypeF3 = meta && meta.greenhouseType;
        const indoorHourlyF3 = ghTypeF3 && indoorRadByGhType && indoorRadByGhType[ghTypeF3]
          ? (indoorRadByGhType[ghTypeF3][date] || null)
          : null;
        const outdoorHourlyF3 = (weatherByDate && weatherByDate[date] && Array.isArray(weatherByDate[date].hourlyRadiation))
          ? weatherByDate[date].hourlyRadiation : null;
        const useIndoorF3 = Array.isArray(indoorHourlyF3);
        const liveSource = useIndoorF3 ? indoorHourlyF3 : outdoorHourlyF3;
        const liveScale = useIndoorF3 ? 1 : II.getTransmittance(ghTypeF3, II.DEFAULT_THRESHOLDS);
        if (liveSource) radDataSource = useIndoorF3 ? 'farmroad' : 'openmeteo';
        if (date === todayDate && Array.isArray(liveSource)) {
          const sunriseMin = weatherByDate[date] && Number.isFinite(weatherByDate[date].sunriseMin) ? weatherByDate[date].sunriseMin : 6 * 60;
          const lastPulseMin = (todaysSummary && todaysSummary.pulses && todaysSummary.pulses.length > 0)
            ? todaysSummary.pulses[todaysSummary.pulses.length - 1].minutesFromMidnight
            : null;
          const fromMin = Number.isFinite(lastPulseMin) ? lastPulseMin : sunriseMin;
          if (nowMin > fromMin) {
            radSumSinceLastPulseNow = Math.round(II.integrateRadiation(liveSource, fromMin, nowMin) * liveScale * 100) / 100;
          } else {
            radSumSinceLastPulseNow = 0;
          }
          const remaining = Math.max(0, radTargetJPerCm2 - radSumSinceLastPulseNow);
          if (remaining > 0) {
            // predictNextPulseTime walks outdoor/indoor and looks for total target
            // (in raw integrated units). If using outdoor with transmittance, scale target up.
            const targetForPredict = useIndoorF3 ? radTargetJPerCm2 : radTargetJPerCm2 / Math.max(0.1, liveScale);
            const eta = II.predictNextPulseTime(liveSource, fromMin, targetForPredict);
            if (eta && eta.etaMin !== null) {
              radEtaMin = Math.max(0, eta.etaMin - nowMin);
              radEtaTime = eta.etaTime;
            }
          } else {
            radEtaMin = 0;
            radEtaTime = String(Math.floor(nowMin / 60)).padStart(2, "0") + ":" + String(nowMin % 60).padStart(2, "0");
          }
        }

        return res.json({
          success: true, ferme, parcelle, date,
          weatherToday, ...advice,
          radSumSinceLastPulseNow, radTargetJPerCm2, radEtaMin, radEtaTime, radDataSource,
          lastPulseHeure: (todaysSummary && todaysSummary.pulses && todaysSummary.pulses.length > 0)
            ? todaysSummary.pulses[todaysSummary.pulses.length - 1].heure
            : null,
        });
      }


      // ========== IRRIGATION INTELLIGENCE — analytics engine ==========
      // Pulls raw irrigation_readings, runs the domain pipeline, and returns
      // daily summaries + actionable recommendations + per-parcelle comparison.
      // Backed by functions/lib/irrigation/ — UI must stay logic-free.
      if (action === "irrigation-intelligence") {
        const ferme = req.query.ferme;
        const dateFrom = req.query.dateFrom;
        const dateTo = req.query.dateTo;
        const parcelle = req.query.parcelle || null;
        if (!ferme || !dateFrom || !dateTo) {
          return res.status(400).json({ success: false, error: "ferme, dateFrom, dateTo requis" });
        }
        // "Now" in Africa/Casablanca local time
        const _nowParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Casablanca",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(new Date());
        const _np = {};
        _nowParts.forEach(p => { _np[p.type] = p.value; });
        const todayDate = `${_np.year}-${_np.month}-${_np.day}`;
        const nowMin = Number(_np.hour) * 60 + Number(_np.minute);
        const II = require("../../../lib/irrigation");
        const raws = await II.fetchIrrigationReadings(db_firestore, { ferme, dateFrom, dateTo, parcelle });
        // Build parcelle metadata map: Firestore overrides static, falls back if absent
        const parcelleIds = Array.from(new Set(raws.map(r => r.parcelle).filter(Boolean)));
        const parcelleMetaById = await II.loadParcelleMetaFromFirestore(db_firestore, parcelleIds);

        // Best-effort weather fetch (Open-Meteo). Never blocks the analysis.
        let weatherForecast = null;
        let weatherByDate = {};
        try {
          const coords = METEO_FERMES[ferme] || METEO_FERMES.F1;
          // Span enough past_days to cover the requested range
          const daysSpan = Math.max(1, Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24)));
          const pastDays = Math.min(60, daysSpan + 1);
          const [fc, hourlyByDate] = await Promise.all([
            fetchMeteoForecast7d(coords.lat, coords.lon),
            fetchHourlyRadiationByDate(coords.lat, coords.lon, pastDays, 2),
          ]);
          weatherForecast = fc;
          weatherByDate = hourlyByDate || {};
        } catch (e) {
          console.warn("irrigation-intelligence: weather fetch failed:", e.message);
        }

        const indoorRadByGhType = await loadIndoorHourlyRadiationByGhType(Object.keys(weatherByDate));
        const {
          summaries,
          recommendationsByKey,
          radiationRecommendationsByKey,
          pulseTrailByKey,
          periodTrendsByParcelle,
          periodRecommendationsByParcelle,
          weatherToday: weatherTodayRaw,
          weatherRecommendationsByParcelle,
        } = II.analyseReadings(raws, undefined, weatherForecast, { weatherByDate, parcelleMetaById, indoorRadByGhType, todayDate, nowMin });

        // F4 — enrich weatherToday with farm-level outdoor RadSum (no transmittance)
        let weatherToday = weatherTodayRaw;
        if (weatherToday && weatherByDate[todayDate] && Array.isArray(weatherByDate[todayDate].hourlyRadiation)) {
          const ctx = weatherByDate[todayDate];
          const sunriseMin = Number.isFinite(ctx.sunriseMin) ? ctx.sunriseMin : 6 * 60;
          const sunsetMin = Number.isFinite(ctx.sunsetMin) ? ctx.sunsetMin : 19 * 60;
          const upTo = Math.min(sunsetMin, Math.max(sunriseMin, nowMin));
          const outdoorRadSumSoFarJPerCm2 = Math.round(II.integrateRadiation(ctx.hourlyRadiation, sunriseMin, upTo) * 100) / 100;
          const outdoorDailyRadJPerCm2 = Math.round(II.dailyRadiationTotal(ctx.hourlyRadiation, sunriseMin, sunsetMin) * 100) / 100;
          weatherToday = { ...weatherToday, outdoorRadSumSoFarJPerCm2, outdoorDailyRadJPerCm2, sunriseMin, sunsetMin };
        }

        // Per-parcelle aggregates for the comparison view
        const byParcelle = {};
        for (const s of summaries) {
          const key = s.parcelle;
          if (!byParcelle[key]) {
            byParcelle[key] = {
              parcelle: key, parcelleLabel: s.parcelleLabel,
              days: 0, totalInputMl: 0, totalDrainMl: 0,
              sumDrainPct: 0, drainPctSamples: 0,
              pulseCount: 0, highDrainPulseCount: 0, lowDrainPulseCount: 0,
              ecPtsValues: [], phPtsValues: [], diagnosesCounts: {},
            };
          }
          const agg = byParcelle[key];
          agg.days++;
          agg.totalInputMl += s.totalInputMl || 0;
          agg.totalDrainMl += s.totalDrainMl || 0;
          if (s.totalDrainPct !== null) { agg.sumDrainPct += s.totalDrainPct; agg.drainPctSamples++; }
          agg.pulseCount += s.pulseCount;
          agg.highDrainPulseCount += s.highDrainPulseCount;
          agg.lowDrainPulseCount += s.lowDrainPulseCount;
          if (s.avgEcPts) agg.ecPtsValues.push(s.avgEcPts);
          if (s.avgPhPts) agg.phPtsValues.push(s.avgPhPts);
          agg.diagnosesCounts[s.diagnosis] = (agg.diagnosesCounts[s.diagnosis] || 0) + 1;
        }
        const stddev = (arr) => {
          if (!arr.length) return null;
          const m = arr.reduce((a, b) => a + b, 0) / arr.length;
          return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
        };
        const comparison = Object.values(byParcelle).map(agg => ({
          parcelle: agg.parcelle,
          parcelleLabel: agg.parcelleLabel,
          days: agg.days,
          avgDrainPct: agg.drainPctSamples > 0 ? agg.sumDrainPct / agg.drainPctSamples : null,
          totalInputMl: agg.totalInputMl,
          totalDrainMl: agg.totalDrainMl,
          pulseCount: agg.pulseCount,
          highDrainPulseCount: agg.highDrainPulseCount,
          lowDrainPulseCount: agg.lowDrainPulseCount,
          problemRatio: agg.pulseCount > 0
            ? (agg.highDrainPulseCount + agg.lowDrainPulseCount) / agg.pulseCount
            : null,
          ecStability: stddev(agg.ecPtsValues),
          phStability: stddev(agg.phPtsValues),
          diagnosesCounts: agg.diagnosesCounts,
        }));

        return res.json({
          success: true,
          ferme, dateFrom, dateTo, parcelle,
          summaries,
          recommendationsByKey,
          radiationRecommendationsByKey,
          pulseTrailByKey,
          periodTrendsByParcelle,
          periodRecommendationsByParcelle,
          weatherForecast,
          weatherToday,
          weatherRecommendationsByParcelle,
          comparison,
          generatedAt: Date.now(),
          todayDate, nowMin,
        });
      }

  return NOT_HANDLED;
};
