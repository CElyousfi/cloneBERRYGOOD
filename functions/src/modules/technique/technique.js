/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { COLLECTION, admin, db_firestore, functions, refreshFarmroadCache, requireAuth, setCors, syncService, whatsappService, withCache } = require("../../shared/core");

const { filterSentinelRecipients } = require("../../../lib/sentinel/sentinelRecipients");
const meteoblueProxy = require("../../../lib/meteo/meteoblueProxy");
const meteogram = require("../../../lib/meteo/meteogram");
const sprayDigest = require("../../../lib/meteo/sprayDigest");
const meteoAlertes = require("../../../lib/meteo/meteoAlertes");

// =============================================
// Firestore Mirror — reads from synced collections
// =============================================
exports.replicationProbe = syncService.replicationProbe;
exports.probeAnalyzer = syncService.probeAnalyzer;
exports.probeAnalysisReport = syncService.probeAnalysisReport;
exports.probeRawData = syncService.probeRawData;

// Import & re-export production DB sync functions
exports.sentinelRecipients = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "GET") {
      return res.status(405).json({ success: false, error: "GET uniquement" });
    }

    // --- Auth par clé partagée (config/sentinel.shared_key vs header x-sentinel-key) ---
    try {
      const cfgDoc = await db_firestore.collection("config").doc("sentinel").get();
      const expectedKey = cfgDoc.exists ? cfgDoc.data().shared_key : null;
      const providedKey = req.get("x-sentinel-key");

      let authorized = false;
      if (expectedKey && providedKey) {
        const a = Buffer.from(String(expectedKey));
        const b = Buffer.from(String(providedKey));
        if (a.length === b.length) {
          const crypto = require("crypto");
          authorized = crypto.timingSafeEqual(a, b);
        } else {
          authorized = false; // length mismatch -> not equal (ne pas logger la clé)
        }
      }
      if (!authorized) {
        return res.status(401).json({ success: false, error: "unauthorized" });
      }
    } catch (err) {
      console.error("sentinelRecipients auth error:", err.message);
      return res.status(401).json({ success: false, error: "unauthorized" });
    }

    // --- Logique : users WhatsApp actifs projetés ---
    try {
      const snap = await db_firestore.collection("users").get();
      const users = snap.docs.map((d) => d.data());
      const recipients = filterSentinelRecipients(users);
      return res.status(200).json({
        success: true,
        recipients,
        count: recipients.length,
      });
    } catch (err) {
      console.error("sentinelRecipients error:", err.message);
      // Endpoint exposé à un tiers : ne pas divulguer le détail interne.
      return res.status(500).json({ success: false, error: "internal_error" });
    }
  });

// =============================================
// API: Signalement de bug in-app (photo + description)
// Route: /api/bug-reports?action=submit-bug
// =============================================
exports.farmroadRefresh = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .pubsub.schedule("every 15 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    console.log("FarmRoad scheduled refresh for " + todayStr);
    try {
      const result = await refreshFarmroadCache(todayStr, null);
      console.log("FarmRoad refresh done: " + (result.totalMeasurements || 0) + " measurements, " + (result.devices ? result.devices.length : 0) + " devices");
    } catch (err) {
      console.error("FarmRoad scheduled refresh error:", err.message);
    }
    return null;
  });

// =============================================
// FarmRoad — HTTP endpoint (reads from cache)
// =============================================
exports.farmroad = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const farmIdFilter = req.query.farmId ? parseInt(req.query.farmId) : null;
      const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
      const result = await refreshFarmroadCache(dateParam, farmIdFilter);
      res.json(result);
    } catch (err) {
      console.error("Erreur FarmRoad:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// METEOBLUE — Cache serveur partagé (weather + spray)
// Le frontend (public/app.jsx: fetchMeteoblueData / fetchSprayData) appelait
// directement my.meteoblue.com avec une clé API en clair, avec pour seule
// protection un cache mémoire local par onglet (15 min TTL) : chaque onglet
// de chaque utilisateur déclenchait son propre appel Meteoblue. Ce cache
// Firestore partagé (TTL 4h) garantit qu'un seul appel réel par
// fenêtre de 4h est fait par (lat, lon arrondis à 2 décimales, package),
// quel que soit le nombre d'onglets/utilisateurs. Pas de bypass "jour passé"
// façon farmroad_cache : ces packages sont toujours "maintenant → avant",
// pas de notion de jour clos.
// =============================================

const METEOBLUE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h

function meteoblueHttpsGet(url) {
  return new Promise((resolve) => {
    const https = require("https");
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (c) => { data += c; });
      resp.on("end", () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
        } else resolve(null);
      });
    }).on("error", () => resolve(null));
  });
}

/**
 * Read-through Firestore cache for a Meteoblue package at a given
 * (lat, lon, altitude). Returns { data, cached } — data has the exact same
 * shape Meteoblue returns today (no transformation), consumed unchanged by
 * transformMeteoblueData/transformSprayData on the frontend.
 */
async function getMeteoblueCached(lat, lon, altitude, pkg) {
  const rLat = meteoblueProxy.roundCoord(lat);
  const rLon = meteoblueProxy.roundCoord(lon);
  const docId = rLat + "_" + rLon + "_" + pkg;
  const cacheRef = db_firestore.collection("meteoblue_cache").doc(docId);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const cData = cached.data();
    const age = Date.now() - (cData.fetched_at || 0);
    const isValid = pkg === "spray"
      ? meteoblueProxy.isValidSprayPayload
      : meteoblueProxy.isValidWeatherPayload;
    if (age < METEOBLUE_CACHE_TTL_MS && isValid(cData.data)) {
      return { data: cData.data, cached: true };
    }
    // TTL expiré OU payload creux (quota Meteoblue dépassé côté fournisseur) →
    // on tombe dans le refetch ci-dessous. Ne PAS toucher Firestore ici (pas
    // de delete) — le prochain succès écrasera naturellement le doc via
    // cacheRef.set() plus bas.
  }

  const deps = { fetchJson: meteoblueHttpsGet, apiKey: METEOBLUE_API_KEY };
  const coords = { lat: rLat, lon: rLon, altitude };
  const data = pkg === "spray"
    ? await meteoblueProxy.fetchSpray(coords, deps)
    : await meteoblueProxy.fetchWeather(coords, deps);

  if (data) {
    await cacheRef.set({
      lat: rLat, lon: rLon, altitude, package: pkg, data, fetched_at: Date.now(),
    }).catch((e) => console.error("Meteoblue cache write error:", e.message));
  }
  return { data, cached: false };
}

// =============================================
// METEOBLUE — HTTP endpoint (lit/écrit le cache)
// =============================================
exports.meteoblue = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const lat = parseFloat(req.query.lat);
      const lon = parseFloat(req.query.lon);
      const altitude = req.query.altitude !== undefined ? parseFloat(req.query.altitude) : 0;
      const pkg = req.query.package === "spray" ? "spray" : "weather";
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({ success: false, error: "lat/lon requis (nombres)" });
      }
      const { data, cached } = await getMeteoblueCached(lat, lon, altitude, pkg);
      if (!data) {
        return res.status(502).json({ success: false, error: "Meteoblue indisponible" });
      }
      res.json({ success: true, data, cached });
    } catch (err) {
      console.error("Erreur Meteoblue:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// METEO SPRAY DIGEST — WhatsApp 6h (DG + chef F1 + chef F5)
// Température du jour + fenêtres de traitement phyto.
// =============================================

/** Dépendances de prod du job digest (cache Meteoblue partagé + WhatsApp). */
function buildMeteoSprayDigestDeps() {
  return {
    getMeteoblue: (coords, pkg) =>
      getMeteoblueCached(coords.lat, coords.lon, coords.altitude, pkg).then((r) => r.data),
    whatsapp: whatsappService,
    now: () => new Date(),
  };
}

/**
 * GET binaire, utilisé pour le meteogram (image PNG). Distinct de
 * meteoblueHttpsGet, qui concatène en STRING et détruirait les octets d'un PNG.
 * Résout null sur non-2xx ou erreur réseau — jamais de throw.
 * @param {string} url
 * @returns {Promise<Buffer|null>}
 */
function meteoblueHttpsGetBuffer(url) {
  return new Promise((resolve) => {
    const https = require("https");
    https.get(url, (resp) => {
      const chunks = [];
      resp.on("data", (c) => { chunks.push(c); });
      resp.on("end", () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(Buffer.concat(chunks));
        else resolve(null);
      });
    }).on("error", () => resolve(null));
  });
}

/**
 * Dépendances de prod du job d'alertes 7 jours : idem digest + Firestore +
 * le meteogram Meteoblue en header IMAGE. `fetchMeteogram` valide le PNG et
 * rend null au moindre doute — l'alerte texte part alors quand même.
 */
function buildMeteoAlertesDeps() {
  return {
    ...buildMeteoSprayDigestDeps(),
    db: db_firestore,
    fetchMeteogram: (coords) => meteogram.fetchMeteogram(coords, {
      fetchBuffer: meteoblueHttpsGetBuffer,
      apiKey: METEOBLUE_API_KEY,
    }),
  };
}

exports.meteoSprayDigest = functions
  .region(sprayDigest.CRON_CONFIG.region)
  .runWith({
    timeoutSeconds: sprayDigest.CRON_CONFIG.timeoutSeconds,
    memory: sprayDigest.CRON_CONFIG.memorySize,
  })
  .pubsub.schedule(sprayDigest.CRON_CONFIG.schedule)
  .timeZone(sprayDigest.CRON_CONFIG.timeZone)
  .onRun(async () => {
    try {
      const job = sprayDigest.createMeteoDigestJob(buildMeteoSprayDigestDeps());
      const summary = await job.run();
      console.log("[meteoSprayDigest] cron done", JSON.stringify(summary));
    } catch (err) {
      console.error("[meteoSprayDigest] cron error:", err.message);
    }
    // Second message : alertes météo à 7 jours. try/catch SÉPARÉ — le digest est
    // déjà parti à ce stade, une panne du job d'alertes ne doit ni l'annuler ni
    // faire échouer l'exécution du cron.
    try {
      const alertesJob = meteoAlertes.createMeteoAlertesJob(buildMeteoAlertesDeps());
      const alertesSummary = await alertesJob.run();
      console.log("[meteoAlertes] cron done", JSON.stringify(alertesSummary));
    } catch (err) {
      console.error("[meteoAlertes] cron error (digest non impacté):", err.message);
    }
    return null;
  });

// Trigger manuel — ?date=YYYY-MM-DD, ?preview=1 (aucun envoi), ?checkRecipients=1,
// ?alertes=1 (exécute UNIQUEMENT le job d'alertes 7 jours),
// ?only=<profileId> (RESTREINT l'envoi à ce seul profil de l'audience :
//   dg | chef_f1 | chef_f5 — permet de tester sur un numéro sans réveiller les
//   chefs). Exemples : ?only=dg, ?alertes=1&only=dg.
//   ⚠️ ?only= ne contourne AUCUNE gate : c'est un envoi RÉEL, soumis à la même
//   vérification isRealSend + TRIGGER_SEND_ROLES que l'envoi complet. Une
//   valeur hors liste blanche → 400.
//   ⚠️ Côté ALERTES, un envoi restreint n'écrit PAS l'état anti-répétition et
//   ne purge rien : un test ne doit jamais rendre muette la vraie alerte du
//   lendemain pour les chefs. Il CONTOURNE aussi le filtre anti-répétition
//   (réponse : dedupBypassed: true) — sinon un test lancé après le cron de 6h
//   répondrait « aucune alerte » alors que tout fonctionne. Ce contournement
//   est strictement local au mode ?only= : le cron et l'envoi complet manuel
//   gardent le filtrage STRICT.
exports.meteoSprayDigestTrigger = functions
  .region(sprayDigest.HTTP_CONFIG.region)
  .runWith({
    timeoutSeconds: sprayDigest.HTTP_CONFIG.timeoutSeconds,
    memory: sprayDigest.HTTP_CONFIG.memorySize,
  })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : undefined;
    const preview = req.query.preview === "1" || req.query.preview === "true";
    const checkRecipients = req.query.checkRecipients === "1" || req.query.checkRecipients === "true";
    const alertesOnly = req.query.alertes === "1" || req.query.alertes === "true";

    // INVARIANT : toute combinaison de query qui peut atteindre un
    // sendTemplateMessage passe par la gate de rôle ci-dessous. La condition
    // est calculée une seule fois par sprayDigest.isRealSend (testé) — ne PAS
    // la réinliner : c'est en supposant que ?checkRecipients=1 n'envoyait rien
    // que ?alertes=1&checkRecipients=1 échappait à la gate.
    const isRealSend = sprayDigest.isRealSend({ preview, checkRecipients, alertesOnly });
    if (isRealSend) {
      let callerProfileId = null;
      let callerRole = null;
      try {
        const uSnap = await db_firestore.collection("users").doc(authUser.uid).get();
        if (uSnap.exists) {
          const u = uSnap.data() || {};
          callerProfileId = u.profileId || null;
          callerRole = u.role || null;
        }
      } catch (e) {
        console.warn("[meteoSprayDigestTrigger] résolution profil appelant échouée:", e.message);
      }
      const allowed = sprayDigest.TRIGGER_SEND_ROLES.includes(callerProfileId) || callerRole === "admin";
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: "Envoi réservé aux profils DG/DT/admin — utilisez ?preview=1 pour visualiser le digest.",
        });
      }
    }

    // Validé APRÈS la gate de rôle : un appelant non autorisé n'apprend rien de
    // la liste blanche. Liste blanche stricte (dérivée d'AUDIENCE) — aucun
    // profil arbitraire venu de la query n'atteint resolveRecipientsForProfile.
    const onlyParsed = sprayDigest.parseOnlyProfile(req.query.only);
    if (!onlyParsed.ok) {
      return res.status(400).json({ success: false, error: onlyParsed.error });
    }
    const only = onlyParsed.only;

    // Même convention que dailyProductionReportTrigger : numéros masqués.
    const maskRecipients = (result) => {
      if (!result.recipients) return result;
      const mask = (p) => (p ? p.slice(0, 4) + "***" + p.slice(-3) : null);
      result.recipients = result.recipients.map((r) => ({ ...r, phone: mask(r.phone) }));
      return result;
    };

    try {
      // ?alertes=1 : on court-circuite le digest pour ne jouer que les alertes.
      if (alertesOnly) {
        const alertesJob = meteoAlertes.createMeteoAlertesJob(buildMeteoAlertesDeps());
        const alertesResult = await alertesJob.run(date, { preview, checkRecipients, only });
        return res.json({
          success: true, ...maskRecipients(alertesResult), dateRequested: date || null,
        });
      }

      const job = sprayDigest.createMeteoDigestJob(buildMeteoSprayDigestDeps());
      const result = await job.run(date, { preview, checkRecipients, only });
      // En preview, on joint les alertes détectées : un seul appel suffit à
      // visualiser les DEUX messages du matin.
      if (preview) {
        const alertesJob = meteoAlertes.createMeteoAlertesJob(buildMeteoAlertesDeps());
        const apercu = await alertesJob.run(date, { preview: true });
        result.alertes = apercu.alertes;
        result.alertesTitreParam = apercu.titreParam;
        result.alertesBody = apercu.body;
      }
      return res.json({ success: true, ...maskRecipients(result), dateRequested: date || null });
    } catch (err) {
      console.error("[meteoSprayDigestTrigger] error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// INDOOR FORECAST — Prévisions météo intérieure
// Modèle ML: outdoor → indoor avec calibration auto
// =============================================

// 2026-09-14 (production readiness) : sorti du code vers une variable d'env,
// comme les autres clés externes de l'app (WA_TOKEN, NETAFIM_ADMIN_SECRET,
// FARMROAD_API_KEY...). Provisionner en prod :
//   firebase functions:secrets:set METEOBLUE_API_KEY
const METEOBLUE_API_KEY = process.env.METEOBLUE_API_KEY;
exports.fuel = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const action = req.query.action || "summary";
    // Import action uses API key auth (for CI/GitHub Actions)
    if (action === "import" && req.method === "POST") {
      const apiKey = req.headers["x-api-key"] || req.query.key;
      const expectedKey = process.env.FUEL_IMPORT_KEY;
      if (!expectedKey || apiKey !== expectedKey) {
        return res.status(401).json({ success: false, error: "Clé API invalide" });
      }
    } else {
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
    }
    try {
      const COLLECTION = "fuel_transactions";

      // Campaign starts in July
      const now = new Date();
      const campagneYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const campagneStart = new Date(campagneYear, 6, 1); // July 1st
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      if (action === "summary") {
        const cacheKey = `fuel_summary_${now.getFullYear()}_${now.getMonth()}`;
        const cached = await withCache(cacheKey, 15 * 60 * 1000, async () => {
          // Fetch all transactions and filter in memory
          const snap = await db_firestore.collection(COLLECTION)
            .orderBy("date", "desc")
            .get();

          const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          const transactions = allDocs.filter(t => {
            const tDate = t.date && t.date.toDate ? t.date.toDate() : new Date(t.date);
            return tDate >= campagneStart;
          });

          // Aggregate
          let totalMoisCarburant = 0, totalMoisPeages = 0;
          let totalCampagneCarburant = 0, totalCampagnePeages = 0;
          let totalLitres = 0, totalMontantCarburant = 0;
          const parCarteMap = {};
          const evolutionMap = {};
          const stationMap = {};

          for (const t of transactions) {
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const isCurrentMonth = tDate >= currentMonthStart;
            const montant = t.montant || 0;
            const litres = t.quantite || 0;

            if (t.isPeage) {
              totalCampagnePeages += montant;
              if (isCurrentMonth) totalMoisPeages += montant;
            } else {
              totalCampagneCarburant += montant;
              totalLitres += litres;
              totalMontantCarburant += montant;
              if (isCurrentMonth) totalMoisCarburant += montant;
            }

            // Par carte
            if (!parCarteMap[t.carte]) {
              parCarteMap[t.carte] = { carte: t.carte, montant: 0, litres: 0, peages: 0, count: 0 };
            }
            if (t.isPeage) {
              parCarteMap[t.carte].peages += montant;
            } else {
              parCarteMap[t.carte].montant += montant;
              parCarteMap[t.carte].litres += litres;
            }
            parCarteMap[t.carte].count++;

            // Evolution par mois
            const moisKey = t.mois || `${tDate.getFullYear()}-${String(tDate.getMonth() + 1).padStart(2, "0")}`;
            if (!evolutionMap[moisKey]) {
              evolutionMap[moisKey] = { mois: moisKey, carburant: 0, peages: 0 };
            }
            if (t.isPeage) {
              evolutionMap[moisKey].peages += montant;
            } else {
              evolutionMap[moisKey].carburant += montant;
            }

            // Top stations (only carburant, not péages)
            if (!t.isPeage && t.lieu) {
              if (!stationMap[t.lieu]) {
                stationMap[t.lieu] = { station: t.lieu, count: 0, montant: 0 };
              }
              stationMap[t.lieu].count++;
              stationMap[t.lieu].montant += montant;
            }
          }

          // Format evolution with month labels
          const moisLabels = { "01": "Jan", "02": "Fév", "03": "Mars", "04": "Avr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc" };
          const evolution = Object.values(evolutionMap)
            .sort((a, b) => a.mois.localeCompare(b.mois))
            .map(e => ({
              ...e,
              label: moisLabels[e.mois.split("-")[1]] || e.mois,
              carburant: Math.round(e.carburant),
              peages: Math.round(e.peages),
            }));

          const parCarte = Object.values(parCarteMap)
            .sort((a, b) => b.montant - a.montant)
            .map(c => ({
              ...c,
              montant: Math.round(c.montant),
              litres: Math.round(c.litres * 100) / 100,
              peages: Math.round(c.peages),
            }));

          const topStations = Object.values(stationMap)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(s => ({ ...s, montant: Math.round(s.montant) }));

          // 20 dernières transactions
          const dernieres = transactions.slice(0, 20).map(t => ({
            carte: t.carte,
            date: t.dateStr,
            lieu: t.lieu,
            produit: t.produit,
            quantite: t.quantite,
            montant: t.montant,
          }));

          const prixMoyenLitre = totalLitres > 0 ? Math.round(totalMontantCarburant / totalLitres * 100) / 100 : 0;

          // ===== PRIX MOYEN PAR SEMAINE =====
          function getISOWeekForPrice(d) {
            const date = new Date(d.getTime());
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
            const week1 = new Date(date.getFullYear(), 0, 4);
            const weekNum = 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
            return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
          }
          const prixWeeklyMap = {};
          for (const t of transactions) {
            if (t.isPeage || !t.quantite || t.quantite <= 0) continue;
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const week = getISOWeekForPrice(tDate);
            if (!prixWeeklyMap[week]) prixWeeklyMap[week] = { montant: 0, litres: 0 };
            prixWeeklyMap[week].montant += t.montant || 0;
            prixWeeklyMap[week].litres += t.quantite || 0;
          }
          const prixMoyenParSemaine = Object.entries(prixWeeklyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([semaine, v]) => ({
              semaine,
              prixMoyen: Math.round(v.montant / v.litres * 100) / 100,
            }));

          // ===== ANOMALIES DETECTION =====
          const anomalies = [];

          // 1. Multi-pleins: >3 fills per card per day
          const dailyFills = {};
          const dailyTxMap = {}; // carte_day → transactions list
          for (const t of transactions) {
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const dayKey = `${t.carte}_${tDate.getFullYear()}-${String(tDate.getMonth()+1).padStart(2,"0")}-${String(tDate.getDate()).padStart(2,"0")}`;
            if (!dailyFills[dayKey]) dailyFills[dayKey] = { carte: t.carte, date: t.dateStr ? t.dateStr.split(" ")[0] : "", count: 0, montant: 0 };
            dailyFills[dayKey].count++;
            dailyFills[dayKey].montant += t.montant || 0;
            if (!dailyTxMap[dayKey]) dailyTxMap[dayKey] = [];
            dailyTxMap[dayKey].push({ heure: (t.dateStr || "").split(" ")[1] || "", lieu: t.lieu || "", produit: t.produit || "", quantite: t.quantite || 0, montant: t.montant || 0 });
          }

          // Build daily distribution per card (for histogram)
          const cardDailyDist = {};
          for (const [key, d] of Object.entries(dailyFills)) {
            if (!cardDailyDist[d.carte]) cardDailyDist[d.carte] = {};
            const cnt = d.count;
            cardDailyDist[d.carte][cnt] = (cardDailyDist[d.carte][cnt] || 0) + 1;
          }

          for (const [key, d] of Object.entries(dailyFills)) {
            if (d.count > 3) {
              anomalies.push({
                type: "multi_fill", carte: d.carte, date: d.date, count: d.count, montant: Math.round(d.montant),
                transactions: (dailyTxMap[key] || []).sort((a, b) => (a.heure || "").localeCompare(b.heure || "")),
                dailyDistribution: cardDailyDist[d.carte] || {},
              });
            }
          }

          // 2. High amount: >2.5x median for the card
          const cardMontants = {};
          for (const t of transactions) {
            if (t.isPeage) continue;
            if (!cardMontants[t.carte]) cardMontants[t.carte] = [];
            cardMontants[t.carte].push({ montant: t.montant || 0, date: t.dateStr || "", lieu: t.lieu || "", produit: t.produit || "", quantite: t.quantite || 0 });
          }
          for (const [carte, arr] of Object.entries(cardMontants)) {
            if (arr.length < 5) continue;
            const sorted = arr.map(a => a.montant).sort((a, b) => a - b);
            const mediane = sorted[Math.floor(sorted.length / 2)];
            if (mediane <= 0) continue;

            // Build amount distribution in 6 ranges for histogram
            const maxMontant = sorted[sorted.length - 1];
            const step = Math.ceil(maxMontant / 6 / 50) * 50; // round to nearest 50
            const distRanges = [];
            for (let r = 0; r < 6; r++) {
              const lo = r * step;
              const hi = (r + 1) * step;
              const cnt = arr.filter(a => a.montant >= lo && a.montant < hi).length;
              distRanges.push({ range: `${lo}-${hi}`, lo, hi, count: cnt });
            }

            for (const a of arr) {
              if (a.montant > mediane * 2.5 && a.montant > 500) {
                anomalies.push({
                  type: "high_amount", carte, date: a.date, lieu: a.lieu, montant: Math.round(a.montant), mediane: Math.round(mediane),
                  produit: a.produit, quantite: a.quantite,
                  historique: { min: Math.round(sorted[0]), max: Math.round(maxMontant), mediane: Math.round(mediane), distribution: distRanges },
                });
              }
            }
          }

          // Sort anomalies: multi_fill first, then by montant desc
          anomalies.sort((a, b) => {
            if (a.type !== b.type) return a.type === "multi_fill" ? -1 : 1;
            return (b.montant || 0) - (a.montant || 0);
          });

          // ===== SUIVI KILOMETRIQUE (L/100km) =====
          let suiviKm = null;
          const kmTransactions = transactions
            .filter(t => t.carte === "476452" && (t.kms || 0) > 200000 && !t.isPeage)
            .map(t => ({
              date: t.dateStr || "",
              kms: t.kms,
              litres: t.quantite || 0,
              dateObj: t.date.toDate ? t.date.toDate() : new Date(t.date),
            }))
            .sort((a, b) => a.dateObj - b.dateObj);

          if (kmTransactions.length >= 3) {
            const points = [];
            for (let i = 1; i < kmTransactions.length; i++) {
              const deltaKm = kmTransactions[i].kms - kmTransactions[i - 1].kms;
              const litres = kmTransactions[i].litres;
              if (deltaKm > 10 && deltaKm < 3000 && litres > 5) {
                const l100 = Math.round((litres / deltaKm) * 100 * 10) / 10;
                if (l100 >= 3 && l100 <= 50) {
                  points.push({ date: kmTransactions[i].date, kms: kmTransactions[i].kms, litres, l100km: l100 });
                }
              }
            }
            if (points.length > 0) {
              const kmTotal = kmTransactions[kmTransactions.length - 1].kms - kmTransactions[0].kms;
              const moyL100 = Math.round(points.reduce((s, p) => s + p.l100km, 0) / points.length * 10) / 10;
              suiviKm = { carte: "476452", kmTotal, moyenneL100: moyL100, points };
            }
          }

          // ===== TENDANCE LITRES/SEMAINE PAR CARTE =====
          // ISO week helper
          function getISOWeek(d) {
            const date = new Date(d.getTime());
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
            const week1 = new Date(date.getFullYear(), 0, 4);
            const weekNum = 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
            return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
          }

          // Find top 5 cards by total litres
          const cardLitresTotal = {};
          for (const t of transactions) {
            if (t.isPeage) continue;
            cardLitresTotal[t.carte] = (cardLitresTotal[t.carte] || 0) + (t.quantite || 0);
          }
          const top5Cards = Object.entries(cardLitresTotal)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(e => e[0]);

          // Build weekly data per card
          const weeklyMap = {};
          const allWeeks = new Set();
          for (const t of transactions) {
            if (t.isPeage || !top5Cards.includes(t.carte)) continue;
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const week = getISOWeek(tDate);
            allWeeks.add(week);
            if (!weeklyMap[t.carte]) weeklyMap[t.carte] = {};
            weeklyMap[t.carte][week] = (weeklyMap[t.carte][week] || 0) + (t.quantite || 0);
          }

          const sortedWeeks = [...allWeeks].sort();
          const consumptionWeekly = top5Cards.map(carte => ({
            carte,
            semaines: sortedWeeks.map(w => ({
              semaine: w,
              litres: Math.round((weeklyMap[carte]?.[w] || 0) * 10) / 10,
            })),
          }));

          const summaryResult = {
            success: true,
            totalMois: Math.round(totalMoisCarburant),
            totalCampagne: Math.round(totalCampagneCarburant),
            totalPeages: Math.round(totalCampagnePeages),
            totalPeagesMois: Math.round(totalMoisPeages),
            prixMoyenLitre,
            parCarte,
            evolution,
            topStations,
            dernieresTransactions: dernieres,
            anomalies,
            suiviKm,
            consumptionWeekly,
            prixMoyenParSemaine,
            nbTransactions: transactions.length,
            campagne: `${campagneYear}-${campagneYear + 1}`,
          };

          // Persist CPC snapshot for fast reads (no API call needed)
          try {
            await db_firestore.collection("cpc_snapshots").doc("fuel").set({
              totalCampagne: summaryResult.totalCampagne,
              totalPeages: summaryResult.totalPeages,
              campagne: summaryResult.campagne,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (e) { console.warn("[Fuel] CPC snapshot save failed:", e.message); }

          return summaryResult;
        });
        return res.json(cached);
      }

      if (action === "import" && req.method === "POST") {
        const transactions = req.body.transactions || [];
        if (!Array.isArray(transactions) || transactions.length === 0) {
          return res.status(400).json({ success: false, error: "transactions array requis" });
        }

        let imported = 0;
        const BATCH_SIZE = 400;
        let batch = db_firestore.batch();
        let batchCount = 0;

        for (const t of transactions) {
          // Parse montant: "620.04 MAD" → 620.04
          const montant = parseFloat((t.montant || "0").replace(/\s*MAD\s*/i, "").replace(",", ".")) || 0;
          const quantite = parseFloat((t.quantite || "0").replace(",", ".")) || 0;
          const kms = parseInt(t.kms || "0", 10) || 0;
          // Parse date
          const [datePart, timePart] = (t.date || "").split(" ");
          const [day, month, year] = (datePart || "").split("/");
          const [hour, minute] = (timePart || "00:00").split(":");
          const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
          const isPeage = (t.produit || "").toLowerCase().includes("badge") || (t.produit || "").toLowerCase().includes("peage");

          const docId = `${t.carte}_${t.ticket}_${(t.date || "").replace(/[\/\s:]/g, "-")}`;
          const ref = db_firestore.collection(COLLECTION).doc(docId);
          batch.set(ref, {
            carte: t.carte || "",
            date: admin.firestore.Timestamp.fromDate(dateObj),
            dateStr: t.date || "",
            ticket: t.ticket || "",
            lieu: t.lieu || "",
            produit: t.produit || "",
            kms, quantite, montant, isPeage,
            dateFacture: t.dateFacture || "",
            numFacture: t.numFacture || "",
            mois: `${year}-${month}`,
            annee: parseInt(year, 10),
          }, { merge: true });
          batchCount++;
          imported++;

          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = db_firestore.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();

        // Invalidate cache
        const now = new Date();
        const cacheKey = `fuel_summary_${now.getFullYear()}_${now.getMonth()}`;
        await db_firestore.collection("api_cache").doc(cacheKey.replace(/[\/\.\s#\[\]*]/g, "_").slice(0, 200)).delete().catch(() => {});

        return res.json({ success: true, imported });
      }

      if (action === "transactions") {
        const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
        const snap = await db_firestore.collection(COLLECTION).limit(limit).get();
        const data = snap.docs.map(d => {
          const t = d.data();
          const dateType = t.date ? (t.date.toDate ? "Timestamp" : typeof t.date) : "missing";
          return { id: d.id, carte: t.carte, date: t.dateStr, lieu: t.lieu, produit: t.produit, quantite: t.quantite, montant: t.montant, kms: t.kms, dateType };
        });
        return res.json({ success: true, data, count: data.length });
      }

      if (action === "count") {
        const snap = await db_firestore.collection(COLLECTION).count().get();
        return res.json({ success: true, total: snap.data().count });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur fuel:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Telecom — Maroc Télécom (IAM) billing data
// =============================================
exports.telecom = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const action = req.query.action || "summary";
    // Import action uses API key auth (for CI/GitHub Actions)
    if (action === "import" && req.method === "POST") {
      const apiKey = req.headers["x-api-key"] || req.query.key;
      const expectedKey = process.env.TELECOM_IMPORT_KEY;
      if (!expectedKey || apiKey !== expectedKey) {
        return res.status(401).json({ success: false, error: "Clé API invalide" });
      }
    } else {
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
    }
    try {
      const COLLECTION = "telecom_bills";

      // Campaign starts in July
      const now = new Date();
      const campagneYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const campagneStart = new Date(campagneYear, 6, 1); // July 1st
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      if (action === "summary") {
        const cacheKey = `telecom_summary_${now.getFullYear()}_${now.getMonth()}`;
        const cached = await withCache(cacheKey, 15 * 60 * 1000, async () => {
          const snap = await db_firestore.collection(COLLECTION).get();

          if (snap.empty) {
            return {
              success: true,
              totalMois: 0, totalCampagne: 0, nbLignes: 0, coutMoyenLigne: 0,
              parLigne: [], evolution: [], dernieresFactures: [], anomalies: [],
              nbFactures: 0, campagne: `${campagneYear}-${campagneYear + 1}`,
            };
          }

          const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
              const da = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date || 0);
              const db2 = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date || 0);
              return db2 - da;
            });
          const bills = allDocs.filter(b => {
            const bDate = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
            return bDate >= campagneStart;
          });

          // Aggregate
          let totalMois = 0, totalCampagne = 0;
          const parLigneMap = {};
          const evolutionMap = {};
          const lignesSet = new Set();

          for (const b of bills) {
            const bDate = b.date.toDate ? b.date.toDate() : new Date(b.date);
            const isCurrentMonth = bDate >= currentMonthStart;
            const montant = b.montant || 0;

            totalCampagne += montant;
            if (isCurrentMonth) totalMois += montant;
            lignesSet.add(b.ligne);

            // Par ligne
            if (!parLigneMap[b.ligne]) {
              parLigneMap[b.ligne] = { ligne: b.ligne, montant: 0, count: 0, forfait: b.forfait || "" };
            }
            parLigneMap[b.ligne].montant += montant;
            parLigneMap[b.ligne].count++;
            if (b.forfait) parLigneMap[b.ligne].forfait = b.forfait;

            // Evolution par mois
            const moisKey = b.mois || `${bDate.getFullYear()}-${String(bDate.getMonth() + 1).padStart(2, "0")}`;
            if (!evolutionMap[moisKey]) {
              evolutionMap[moisKey] = { mois: moisKey, montant: 0, appels: 0, sms: 0, data: 0 };
            }
            evolutionMap[moisKey].montant += montant;
            evolutionMap[moisKey].appels += (b.appels || 0);
            evolutionMap[moisKey].sms += (b.sms || 0);
            evolutionMap[moisKey].data += (b.data || 0);
          }

          // Format evolution with month labels
          const moisLabels = { "01": "Jan", "02": "Fév", "03": "Mars", "04": "Avr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc" };
          const evolution = Object.values(evolutionMap)
            .sort((a, b) => a.mois.localeCompare(b.mois))
            .map(e => ({
              ...e,
              label: moisLabels[e.mois.split("-")[1]] || e.mois,
              montant: Math.round(e.montant),
              appels: Math.round(e.appels),
              sms: Math.round(e.sms),
              data: Math.round(e.data),
            }));

          const nbLignes = lignesSet.size;
          const parLigne = Object.values(parLigneMap)
            .sort((a, b) => b.montant - a.montant)
            .map(l => ({
              ...l,
              montant: Math.round(l.montant),
            }));

          const coutMoyenLigne = nbLignes > 0 ? Math.round(totalCampagne / nbLignes) : 0;

          // 20 dernières factures
          const dernieres = bills.slice(0, 20).map(b => ({
            ligne: b.ligne,
            periode: b.periode,
            montant: b.montant,
            forfait: b.forfait || "",
            dateFacture: b.dateFacture || "",
          }));

          // Anomalies: lignes avec montant dernier mois > 2× leur moyenne
          const anomalies = [];
          for (const [ligne, info] of Object.entries(parLigneMap)) {
            if (info.count < 3) continue;
            const moyenne = info.montant / info.count;
            const ligneBills = bills.filter(b => b.ligne === ligne);
            // Check last bill
            if (ligneBills.length > 0) {
              const lastBill = ligneBills[0]; // already sorted desc
              if (lastBill.montant > moyenne * 2 && lastBill.montant > 200) {
                anomalies.push({
                  type: "spike",
                  ligne,
                  periode: lastBill.periode,
                  montant: Math.round(lastBill.montant),
                  moyenne: Math.round(moyenne),
                  ratio: Math.round(lastBill.montant / moyenne * 10) / 10,
                });
              }
            }
          }
          anomalies.sort((a, b) => b.montant - a.montant);

          // Récupérer la date de dernière synchro depuis api_metadata
          let lastSyncAt = null;
          try {
            const metaSnap = await db_firestore.collection("api_metadata").doc("telecom").get();
            if (metaSnap.exists) {
              const m = metaSnap.data();
              if (m.lastSyncAt && m.lastSyncAt.toDate) lastSyncAt = m.lastSyncAt.toDate().toISOString();
              else if (m.lastSyncAt) lastSyncAt = new Date(m.lastSyncAt).toISOString();
            }
          } catch (_) { /* ignore */ }

          return {
            success: true,
            totalMois: Math.round(totalMois),
            totalCampagne: Math.round(totalCampagne),
            nbLignes,
            coutMoyenLigne,
            parLigne,
            evolution,
            dernieresFactures: dernieres,
            anomalies,
            nbFactures: bills.length,
            campagne: `${campagneYear}-${campagneYear + 1}`,
            lastSyncAt,
          };
        });
        return res.json(cached);
      }

      if (action === "import" && req.method === "POST") {
        const bills = req.body.bills || [];
        if (!Array.isArray(bills) || bills.length === 0) {
          return res.status(400).json({ success: false, error: "bills array requis" });
        }

        let imported = 0;
        const BATCH_SIZE = 400;
        let batch = db_firestore.batch();
        let batchCount = 0;

        for (const b of bills) {
          const montant = parseFloat(b.montant) || 0;
          const appels = parseFloat(b.appels) || 0;
          const sms = parseFloat(b.sms) || 0;
          const dataVal = parseFloat(b.data) || 0;
          const roaming = parseFloat(b.roaming) || 0;

          // Parse periode to date (YYYY-MM → 1st of month)
          const [year, month] = (b.periode || "").split("-");
          const dateObj = year && month ? new Date(parseInt(year), parseInt(month) - 1, 1) : new Date();

          const docId = `${(b.ligne || "").replace(/\s/g, "")}_${b.periode || "unknown"}`;
          const ref = db_firestore.collection(COLLECTION).doc(docId);
          batch.set(ref, {
            ligne: b.ligne || "",
            periode: b.periode || "",
            montant, appels, sms, data: dataVal, roaming,
            forfait: b.forfait || "",
            dateFacture: b.dateFacture || "",
            numFacture: b.numFacture || "",
            mois: b.periode || "",
            annee: parseInt(year, 10) || dateObj.getFullYear(),
            date: admin.firestore.Timestamp.fromDate(dateObj),
          }, { merge: true });
          batchCount++;
          imported++;

          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = db_firestore.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();

        // Track last sync timestamp
        await db_firestore.collection("api_metadata").doc("telecom").set({
          lastSyncAt: admin.firestore.Timestamp.fromDate(new Date()),
          lastImportCount: imported,
        }, { merge: true }).catch(() => {});

        // Invalidate cache
        const cacheKey = `telecom_summary_${now.getFullYear()}_${now.getMonth()}`;
        await db_firestore.collection("api_cache").doc(cacheKey.replace(/[\/\.\s#\[\]*]/g, "_").slice(0, 200)).delete().catch(() => {});

        return res.json({ success: true, imported });
      }

      if (action === "bills") {
        const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
        const snap = await db_firestore.collection(COLLECTION).limit(limit).get();
        const data = snap.docs.map(d => {
          const b = d.data();
          return { id: d.id, ligne: b.ligne, periode: b.periode, montant: b.montant, forfait: b.forfait, dateFacture: b.dateFacture };
        });
        return res.json({ success: true, data, count: data.length });
      }

      if (action === "count") {
        const snap = await db_firestore.collection(COLLECTION).count().get();
        return res.json({ success: true, total: snap.data().count });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur telecom:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: OJRA — Payroll & social charges (manual Excel upload)
// =============================================
// Phase 1 (RDP discovery) is pending; in the meantime users export the OJRA
// payroll Excel via Remote Desktop and upload it through the OJRA tab.
// The parser (./ojraParser.js) detects columns heuristically — when the OJRA
// schema is fixed, tighten its COLUMN_PATTERNS.
