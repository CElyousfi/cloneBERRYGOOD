/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { METEO_FERMES, admin, bucket, consoAccessControl, db_firestore, demandeCreationArticle, dispatchNotification, downloadUrl, functions, getPool, getSql, invalidateApiCachePrefix, requireAuth, resolveCallerRole, scanAttachment, withCache } = require("../../shared/core");

const nodemailer = require("nodemailer");

// Shared config & middleware
const { validateBdcCore } = require("../../../bdcValidationService");
const { remindBdcCore } = require("../../../bdcReminderService");
const { updateBdcVirementCore, recordVirementAvis } = require("../../../bdcVirementService");
const bdcWorkflow = require("../../../lib/bdc/workflow");
const bdcReceptionGuard = require("../../../lib/bdc/receptionGuard");
const { validateSupplier } = require("../../../lib/suppliers/supplierValidation");
const stockCaneva = require("../../../lib/stockCaneva");
const articleMerge = require("../../../lib/stockMerge/articleMerge");
// LIBELLÉ CANONIQUE d'une catégorie d'article — SEULE règle de normalisation de
// catégorie du dépôt (copie backend verrouillée de public/lib/articleCategories.js).
const articleCategories = require("../../../lib/stockMerge/articleCategories");
// Droits d'écriture sur le catalogue d'articles (règle PURE, cf. lib/stockRoles).
const stockRoles = require("../../../lib/stockRoles");
const stockMovementGuard = require("../../../lib/stock/movementGuard");
const receptionBdc = require("../../../lib/receptionValorisation/receptionBdc");
const { isImpactApplied } = require("../../../lib/stock/movementImpact");
const { checkStockAvailability } = require("../../../lib/stock/stockGuard");
const { buildArticleHistoryIndex, sliceArticleHistory } = require("../../../lib/stock/articleHistoryIndex");
const pmpDetailLib = require("../../../lib/stock/pmpDetail");
const consoValorisationLib = require("../../../lib/valorisation/consoValorisation");
const consoBons = require("../../../lib/consoBons");
const parcelleGroupSplit = require("../../../lib/parcelleGroupes/split");
// Conversion « unité de consommation → unité de stock » (Acide Nitrique acheté
// au KG, dosé au L). Module PUR, fail-closed : jamais de facteur deviné.
const uniteConso = require("../../../lib/uniteConso");
const locationsConfig = require("../../../lib/stock/locationsConfig");
const bcScan = require("../../../lib/stock/bcScan");
// Journal de précision du scan (observation pure — ne change rien au scanner).
const bcScanJournal = require("../../../lib/stock/bcScanJournal");
const bcDate = require("../../../lib/stock/bcDate");
const bcDoublons = require("../../../lib/stock/bcDoublons");
const bcSuppression = require("../../../lib/stock/bcSuppression");
const identiteArticle = require("../../../lib/stock/identiteArticle");
const demandesCreationIO = require("../../../lib/stock/demandesCreationIO");
const stockFilesRecord = require("../../../lib/stockFiles/recordSubmission");
const { STOCK_FILE_ALLOWED_MIME, STOCK_FILE_ALLOWED_FORMATS_LABEL } = require("../../../lib/stockFiles/allowedMime");
const ARTICLE_HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
let _articleHistoryCache = null; // { index, expiresAt }

async function getArticleHistoryIndex(db_firestore) {
  const now = Date.now();
  if (_articleHistoryCache && _articleHistoryCache.expiresAt > now) {
    return _articleHistoryCache.index;
  }
  const snap = await db_firestore.collection("stock_movements").get();
  const index = buildArticleHistoryIndex(snap.docs, stockMovementGuard);
  _articleHistoryCache = { index, expiresAt: now + ARTICLE_HISTORY_CACHE_TTL_MS };
  return index;
}

// --- Index d'IDENTITÉ d'article (résolution libellé -> docId de fiche) ----
// Même mécanisme de cache mémoire que l'index grand-livre ci-dessus, et même
// TTL : `create-bl` et `create-movement` doivent résoudre l'identité de chaque
// ligne AVANT d'écrire un solde, ce qui coûterait sinon une lecture complète
// d'`articles_catalog` par bon saisi.
//
// ⚠️ Le catalogue est lu ENTIER (pas `where active == true`) : suivre une
// chaîne `merged_into` exige de voir les fiches DÉSACTIVÉES par une fusion.
// C'est précisément ce chaînage qui fait qu'un article fusionné écrit dans le
// solde de son MAÎTRE au lieu d'en créer un second à côté.
//
// ⚠️ INVALIDATION EXPLICITE (`invalidateIdentiteArticleIndex`), contrairement à
// l'index grand-livre : depuis le refus fail-closed, un index périmé de 5 min
// signifie qu'un magasinier qui vient de créer un article au catalogue se voit
// REFUSER son bon pendant 5 minutes. Le cache est donc purgé à chaque création
// de fiche, et les appelants réessaient une fois sur un refus.
const IDENTITE_ARTICLE_CACHE_TTL_MS = 5 * 60 * 1000;
let _identiteArticleCache = null; // { index, expiresAt }

function invalidateIdentiteArticleIndex() {
  _identiteArticleCache = null;
}

async function getIdentiteArticleIndex(db_firestore, opts) {
  const now = Date.now();
  if (!(opts && opts.force) && _identiteArticleCache && _identiteArticleCache.expiresAt > now) {
    return _identiteArticleCache.index;
  }
  const snap = await db_firestore.collection("articles_catalog").get();
  const index = identiteArticle.indexerFiches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  _identiteArticleCache = { index, expiresAt: now + IDENTITE_ARTICLE_CACHE_TTL_MS };
  return index;
}

/**
 * Résout les lignes d'un mouvement, FAIL-CLOSED, en rattrapant l'index périmé.
 * Un premier refus déclenche UNE relecture forcée du catalogue : sans elle, un
 * article créé il y a moins de 5 minutes ferait échouer le bon alors qu'il
 * existe. Un vrai article inconnu coûte une lecture de plus, ce qui est le bon
 * arbitrage : ce chemin est rare et il bloque un utilisateur.
 */
async function resoudreLignesStock(db_firestore, lignes) {
  let index = await getIdentiteArticleIndex(db_firestore);
  let resolution = identiteArticle.resoudreLignes(lignes, index);
  if (!resolution.ok) {
    index = await getIdentiteArticleIndex(db_firestore, { force: true });
    resolution = identiteArticle.resoudreLignes(lignes, index);
  }
  return resolution;
}

/**
 * Traite TOUTES les résolutions fautives : demande de création pour ce qui est
 * introuvable, ALERTE pour ce qui ne se crée pas.
 *
 * ⚠️ LA LOGIQUE N'EST PLUS ICI. Elle vit dans `lib/stock/demandesCreationIO`,
 * avec ses dépendances INJECTÉES, parce qu'une fonction enfermée dans ce
 * monolithe n'est gardée que par des assertions de SOURCE — et deux mutants
 * ont prouvé que cela ne suffit pas :
 *   R2 — un `throw` avant les notifications ;
 *   R3 — `if (ecarts.length)` devenu `if (ecarts.length && enregistres.length)`,
 *        qui rendait 0 dispatch sur un article ambigu pendant que le bon
 *        affirmait « Le DG a été alerté », avec 35 tests de câblage VERTS.
 * Ne pas réintroduire de logique ici : elle redeviendrait invérifiable.
 *
 * @param {*} db_firestore
 * @param {Array<Object>} resolutions résolutions fautives
 * @param {*} demandePar {uid, profileId, name}
 * @param {*} contexte {origine, type, numero}
 * @returns {Promise<string[]>} libellés RÉELLEMENT enregistrés
 */
async function enregistrerDemandesCreation(db_firestore, resolutions, demandePar, contexte) {
  return demandesCreationIO.enregistrerDemandesCreation(
    {
      db: db_firestore,
      dispatchNotification,
      increment: (n) => admin.firestore.FieldValue.increment(n),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      logError: (message, e) => console.error(message, e && e.message ? e.message : e),
    },
    resolutions,
    demandePar,
    contexte
  );
}

/**
 * Clôt les demandes que le catalogue satisfait désormais.
 *
 * C'est ce qui remplace un bouton « valider » : le DG crée l'article sur
 * l'écran Catalogue qu'il a déjà, et la demande se ferme d'elle-même. La règle
 * de correspondance est `canon`, la MÊME que l'identité — pas une comparaison
 * de noms réécrite pour l'occasion.
 *
 * @param {*} db_firestore
 * @returns {Promise<number>} nombre de demandes closes
 */
async function cloturerDemandesCreationSatisfaites(db_firestore) {
  const snap = await db_firestore.collection(demandeCreationArticle.COLLECTION)
    .where("statut", "==", demandeCreationArticle.STATUT_EN_ATTENTE).get();
  if (snap.empty) return 0;
  const index = await getIdentiteArticleIndex(db_firestore, { force: true });
  const aClore = demandeCreationArticle.demandesAClore(
    snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    index
  );
  if (!aClore.length) return 0;
  const now = Date.now();
  // Chunks de 400 (limite Firestore 500/batch, marge de 100).
  for (let i = 0; i < aClore.length; i += 400) {
    const batch = db_firestore.batch();
    for (const c of aClore.slice(i, i + 400)) {
      batch.update(db_firestore.collection(demandeCreationArticle.COLLECTION).doc(c.id), {
        statut: demandeCreationArticle.STATUT_CREE,
        cree_at: now,
        cree_article_id: c.article_id,
        updated_at: now,
      });
    }
    await batch.commit();
  }
  return aClore.length;
}

// --- Index facture par article stock (pour get-pmp-detail) ---------------
// Scan UNIQUE des collections `invoices` + `mapping_articles`, mis en cache
// mémoire (même TTL que l'historique). Read-only. Pour chaque item de facture
// (qui stocke la DÉSIGNATION fournisseur, pas le code article stock), on résout
// l'article stock par :
//   1) match direct canon(item.article)
//   2) mapping_articles : canon(designation_fournisseur) → article_stock (+ alias)
// L'index est clé sur canon(article_stock) et accumule les lignes facture.
const PMP_INVOICE_CACHE_TTL_MS = 5 * 60 * 1000;
let _pmpInvoiceCache = null; // { index, expiresAt }

async function getInvoiceByArticleIndex(db_firestore) {
  const now = Date.now();
  if (_pmpInvoiceCache && _pmpInvoiceCache.expiresAt > now) {
    return _pmpInvoiceCache.index;
  }
  const canon = pmpDetailLib.canon;

  // 1) Table de résolution designation → article_stock depuis mapping_articles.
  const desigToArticle = {}; // canon(designation) -> article_stock (nom)
  const mapSnap = await db_firestore.collection("mapping_articles").get();
  mapSnap.forEach((doc) => {
    const m = doc.data() || {};
    const target = m.article_stock || "";
    if (!target) return;
    if (m.designation_fournisseur) desigToArticle[canon(m.designation_fournisseur)] = target;
    const aliases = Array.isArray(m.alias) ? m.alias : (m.alias ? [m.alias] : []);
    for (const al of aliases) {
      if (al) desigToArticle[canon(al)] = target;
    }
    // designation_alias : array de désignations fournisseur alternatives.
    // Même normalisation (canon) que designation_fournisseur pour un matching identique.
    const desigAliases = Array.isArray(m.designation_alias) ? m.designation_alias : [];
    for (const da of desigAliases) {
      if (da) desigToArticle[canon(da)] = target;
    }
  });

  // 2) Scan des factures → lignes par article stock (clé canon).
  const index = {}; // canon(article_stock) -> [{numero_facture, date_facture, designation, quantite, unite, prix_unitaire}]
  const invSnap = await db_firestore.collection("invoices").get();
  invSnap.forEach((doc) => {
    const inv = doc.data() || {};
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const it of items) {
      const desig = it.article || it.article_nom || "";
      if (!desig) continue;
      const cDesig = canon(desig);
      // Résolution : mapping prioritaire, sinon le canon de la désignation lui-même
      // (le match contre l'article demandé se fait en aval sur cette clé).
      const articleStock = desigToArticle[cDesig] || desig;
      const key = canon(articleStock);
      if (!index[key]) index[key] = [];
      index[key].push({
        numero_facture: inv.numero_facture || inv.numero || "",
        date_facture: inv.date_facture || "",
        designation: desig,
        quantite: it.quantite,
        unite: it.unite || "",
        prix_unitaire: it.prix_unitaire,
        fournisseur: (inv.fournisseur && inv.fournisseur.nom) || inv.fournisseur_nom || "",
      });
    }
  });

  _pmpInvoiceCache = { index, expiresAt: now + PMP_INVOICE_CACHE_TTL_MS };
  return index;
}

// Import & re-export sync functions
async function fetchMeteoForecast7d(lat, lon) {
  const https = require("https");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,relative_humidity_2m_mean,et0_fao_evapotranspiration,shortwave_radiation_sum&timezone=Africa/Casablanca&forecast_days=7`;
  return new Promise((resolve) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (!j.daily || !j.daily.time) return resolve([]);
          resolve(j.daily.time.map((d, i) => ({
            date: d,
            tmax: j.daily.temperature_2m_max[i],
            tmin: j.daily.temperature_2m_min[i],
            humidity: j.daily.relative_humidity_2m_mean ? j.daily.relative_humidity_2m_mean[i] : null,
            wind: j.daily.windspeed_10m_max[i],
            precip: j.daily.precipitation_sum[i],
            eto: j.daily.et0_fao_evapotranspiration ? j.daily.et0_fao_evapotranspiration[i] : null,
            radiation: j.daily.shortwave_radiation_sum ? j.daily.shortwave_radiation_sum[i] : null,
          })));
        } catch (e) { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

/**
 * Fetch hourly shortwave radiation + daily sunrise/sunset from Open-Meteo
 * for a date range. Single API call. Returns a map keyed by YYYY-MM-DD:
 *   { date, sunriseMin, sunsetMin, hourlyRadiation: number[24] (W/m²) }
 *
 * Used by the irrigation engine for radiation-driven recommendations and
 * dynamic late-day cutoff. `pastDays` ≤ 92, `forecastDays` ≤ 16.
 */
async function fetchHourlyRadiationByDate(lat, lon, pastDays, forecastDays) {
  const https = require("https");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=shortwave_radiation&daily=sunrise,sunset&timezone=Africa/Casablanca` +
    `&past_days=${pastDays || 7}&forecast_days=${forecastDays || 2}`;
  return new Promise((resolve) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try {
          const j = JSON.parse(data);
          const out = {};
          // Daily sunrise/sunset
          if (j.daily && Array.isArray(j.daily.time)) {
            j.daily.time.forEach((d, i) => {
              const sunriseStr = j.daily.sunrise ? j.daily.sunrise[i] : null;
              const sunsetStr = j.daily.sunset ? j.daily.sunset[i] : null;
              const parseHM = (s) => {
                if (!s || typeof s !== "string") return null;
                const m = /T(\d{2}):(\d{2})/.exec(s);
                return m ? Number(m[1]) * 60 + Number(m[2]) : null;
              };
              out[d] = {
                date: d,
                sunriseMin: parseHM(sunriseStr),
                sunsetMin: parseHM(sunsetStr),
                hourlyRadiation: new Array(24).fill(null),
              };
            });
          }
          // Hourly radiation, bucket into out[date].hourlyRadiation[hour]
          if (j.hourly && Array.isArray(j.hourly.time) && Array.isArray(j.hourly.shortwave_radiation)) {
            for (let i = 0; i < j.hourly.time.length; i++) {
              const t = j.hourly.time[i];
              const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(t);
              if (!m) continue;
              const date = m[1];
              const hour = Number(m[2]);
              if (!out[date]) out[date] = { date, sunriseMin: null, sunsetMin: null, hourlyRadiation: new Array(24).fill(null) };
              out[date].hourlyRadiation[hour] = j.hourly.shortwave_radiation[i];
            }
          }
          resolve(out);
        } catch (e) { resolve({}); }
      });
    }).on("error", () => resolve({}));
  });
}

/**
 * Load FarmRoad indoor hourly radiation per greenhouse type for a list of dates.
 * Reads `farmroad_history/{date}.{ghType}.hourly[].radiation` (already aggregated
 * 15-min → hourly W/m² by farmroadRefresh).
 *
 * @param {string[]} dates  YYYY-MM-DD strings
 * @returns {Promise<{canarienne: Record<string, Array<number|null>>, tunnel: Record<string, Array<number|null>>}>}
 *          Each ghType maps date → 24-element hourly W/m² array (indoor).
 *          Date entry omitted if no FarmRoad data for that day/type.
 */
async function loadIndoorHourlyRadiationByGhType(dates) {
  const out = { canarienne: {}, tunnel: {} };
  if (!Array.isArray(dates) || dates.length === 0) return out;
  const snaps = await Promise.all(
    dates.map(d => db_firestore.collection('farmroad_history').doc(d).get())
  );
  snaps.forEach((snap, i) => {
    const date = dates[i];
    if (!snap.exists) return;
    const data = snap.data() || {};
    for (const ghType of ['canarienne', 'tunnel']) {
      const block = data[ghType];
      const hourly = block && Array.isArray(block.hourly) ? block.hourly : null;
      if (!hourly || hourly.length === 0) continue;
      const arr = new Array(24).fill(null);
      let hits = 0;
      for (const slot of hourly) {
        const hh = typeof slot.hour === 'string' ? parseInt(slot.hour.slice(0, 2), 10) : null;
        if (Number.isFinite(hh) && hh >= 0 && hh < 24 && Number.isFinite(slot.radiation)) {
          arr[hh] = slot.radiation;
          hits++;
        }
      }
      if (hits > 0) out[ghType][date] = arr;
    }
  });
  return out;
}

// Persist outdoor meteo for all farms for a given date
async function getNextNumber(type, prefix) {
  const counterRef = db_firestore.collection("stock_config").doc("counters");
  const year = new Date().getFullYear();
  const result = await db_firestore.runTransaction(async (t) => {
    const snap = await t.get(counterRef);
    const data = snap.exists ? snap.data() : {};
    const current = (data[type] || 0) + 1;
    t.set(counterRef, { ...data, [type]: current }, { merge: true });
    return `${prefix}-${year}-${String(current).padStart(4, "0")}`;
  });
  return result;
}

// =============================================================================
// generateRecoForAnalyse — shared logic used by both the HTTP handler
// (action=generate-reco-foliaire) and the Firestore trigger that auto-runs
// when a new analysis with a PDF is created.
// Returns { success, cached, recommandation, error }. Never throws.
// =============================================================================
async function generateRecoForAnalyse(id, opts = {}) {
  const { force = false, parcelle, ferme, culture, photo_url, scan_url: scanUrlOverride, note_demande } = opts;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false, error: "Clé API Anthropic non configurée" };
  if (!id) return { success: false, error: "id requis" };

  const analyseSnap = await db_firestore.collection("analyses_foliaires").doc(id).get();
  if (!analyseSnap.exists) return { success: false, error: "Analyse introuvable" };
  const analyse = analyseSnap.data();

  const refusalRe = /^\s*(je ne peux pas|je n'ai pas (accès|pu|de)|je ne (vois|dispose)|désolé|sorry|i (cannot|can't|don't|am (unable|not able)))/i;
  const isValidReco = (r) => {
    if (!r || !r.message || r.message.length < 600) return false;
    if (refusalRe.test(r.message)) return false;
    if (r.has_scan === true) return true;
    return Object.keys(analyse.parsed_values || {}).length >= 5;
  };

  if (!force) {
    const existing = (analyse.recommandations_ia || []).slice().sort((a, b) => (b.generated_at || 0) - (a.generated_at || 0));
    const lastValid = existing.find(isValidReco);
    if (lastValid) return { success: true, recommandation: lastValid, cached: true };
  }

  const docRef = db_firestore.collection("analyses_foliaires").doc(id);
  const startedAt = Date.now();
  const writeProgress = async (patch) => {
    try {
      await docRef.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`reco_progress.${k}`, v])));
    } catch (e) { console.warn("reco_progress write failed", e.message); }
  };
  const clearProgress = async () => {
    try {
      await docRef.update({ reco_progress: admin.firestore.FieldValue.delete() });
    } catch (e) { console.warn("reco_progress clear failed", e.message); }
  };
  // Initial state — full reset (not a nested patch) so stale fields from a previous run are gone.
  try {
    await docRef.update({
      reco_progress: {
        state: "loading_pdf",
        started_at: startedAt,
        updated_at: startedAt,
        source: opts.source || "manual",
      },
    });
  } catch (e) { console.warn("reco_progress init failed", e.message); }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const messageContent = [];

  const bucketStoragePath = (url) => {
    if (!url) return null;
    try {
      const bName = bucket.name;
      const gcs = new RegExp("^https?://storage\\.googleapis\\.com/" + bName.replace(/[-.]/g, "\\$&") + "/(.+)$");
      const m1 = url.match(gcs);
      if (m1) return decodeURIComponent(m1[1].split("?")[0]);
      const fb = new RegExp("^https?://firebasestorage\\.googleapis\\.com/v0/b/" + bName.replace(/[-.]/g, "\\$&") + "/o/([^?]+)");
      const m2 = url.match(fb);
      if (m2) return decodeURIComponent(m2[1]);
    } catch (e) { /* ignore */ }
    return null;
  };

  const loadFile = async (url) => {
    if (!url) return null;
    const p = bucketStoragePath(url);
    if (p) {
      try {
        const [buf] = await bucket.file(p).download();
        const [meta] = await bucket.file(p).getMetadata().catch(() => [{}]);
        return { data: buf, type: meta?.contentType || "application/octet-stream" };
      } catch (e) { console.error("bucket download failed", p, e.message); return null; }
    }
    try {
      const https = require("https");
      const http = require("http");
      const mod = url.startsWith("https") ? https : http;
      return await new Promise((resolve) => {
        mod.get(url, (resp) => {
          if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
          const chunks = [];
          resp.on("data", c => chunks.push(c));
          resp.on("end", () => resolve({ data: Buffer.concat(chunks), type: resp.headers["content-type"] || "application/octet-stream" }));
          resp.on("error", () => resolve(null));
        }).on("error", () => resolve(null));
      });
    } catch (e) { console.error("loadFile error:", e.message); return null; }
  };

  const scanUrl = scanUrlOverride || analyse.scan_resultat_url;
  const scanFile = await loadFile(scanUrl);
  if (scanFile) console.log("scan loaded", scanFile.data.length, "bytes", scanFile.type);

  // Load all terrain observation photos for the same ferme+variete (last 3 months).
  let terrainPhotoCount = 0;
  try {
    const THREE_MONTHS = 90 * 86400000;
    const cutoff = Date.now() - THREE_MONTHS;
    const terrainSnap = await db_firestore.collection("analyses_foliaires")
      .where("ferme", "==", analyse.ferme || ferme)
      .where("variete", "==", analyse.variete || parcelle)
      .where("type_analyse", "==", "observation_terrain")
      .get();
    const allPhotoUrls = [];
    terrainSnap.docs.forEach(d => {
      const data = d.data();
      if ((data.date_analyse || data.created_at || 0) < cutoff) return;
      (data.photo_urls || []).forEach(p => { if (p.url) allPhotoUrls.push(p.url); });
    });
    // Also include legacy single photo and photo_urls on the current analyse doc.
    if (photo_url) allPhotoUrls.unshift(photo_url);
    (analyse.photo_urls || []).forEach(p => { if (p.url && !allPhotoUrls.includes(p.url)) allPhotoUrls.push(p.url); });
    // Cap at 6 images to stay within Claude message size limits.
    const toLoad = allPhotoUrls.slice(0, 6);
    const photoFiles = await Promise.all(toLoad.map(url => loadFile(url)));
    photoFiles.filter(Boolean).forEach(img => {
      if (img.type.startsWith("image/")) {
        messageContent.push({ type: "image", source: { type: "base64", media_type: img.type, data: img.data.toString("base64") } });
        terrainPhotoCount++;
      }
    });
    if (terrainPhotoCount) console.log(`terrain photos loaded: ${terrainPhotoCount}`);
  } catch (e) {
    console.warn("terrain photo loading failed, continuing:", e.message);
  }

  let scanPdfSent = false;
  let scanImageSent = false;
  if (scanFile) {
    const looksLikePdf = scanFile.data.length >= 4 && scanFile.data.slice(0, 4).toString("ascii") === "%PDF";
    const mimeIsPdf = scanFile.type.includes("pdf") || (scanUrl && /\.pdf$/i.test(scanUrl));
    if (looksLikePdf && mimeIsPdf) {
      messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: scanFile.data.toString("base64") } });
      scanPdfSent = true;
    } else if (scanFile.type.startsWith("image/")) {
      messageContent.push({ type: "image", source: { type: "base64", media_type: scanFile.type, data: scanFile.data.toString("base64") } });
      scanImageSent = true;
    } else if (mimeIsPdf && !looksLikePdf) {
      console.error("scan url claims pdf but buffer does not start with %PDF-", scanUrl);
    }
  }

  const parsedValuesLines = Object.entries(analyse.parsed_values || {})
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const typeLabel = {
    foliaire: "Analyse foliaire (feuilles)",
    sol: "Analyse de sol",
    eau_irrigation: "Analyse d'eau d'irrigation",
    eau_apport: "Analyse d'eau d'apport",
    eau_du_sol: "Analyse d'eau du sol",
  }[analyse.type_analyse] || analyse.type_analyse || "Analyse foliaire";
  const dateStr = analyse.date_analyse ? new Date(analyse.date_analyse).toLocaleDateString("fr-FR") : "Non précisée";

  // Fetch variety general context
  let contexteGeneral = "";
  try {
    const ctxVariete = (analyse.variete || parcelle || "").toUpperCase().replace(/\s+/g, "_");
    const ctxFerme = analyse.ferme || ferme || "";
    if (ctxVariete && ctxFerme) {
      const ctxDoc = await db_firestore.collection("variete_contextes").doc(`${ctxFerme}_${ctxVariete}`).get();
      if (ctxDoc.exists) contexteGeneral = ctxDoc.data().contexte_general || "";
    }
  } catch (e) { console.warn("variete contexte fetch failed", e.message); }

  const prompt = `Tu es **Ingénieur Agronome Senior**, expert reconnu des petits fruits rouges (myrtille, framboise) et de l'avocatier sous serre dans la région Souss-Massa (Maroc). Tu rédiges un **rapport de consultation agronomique professionnel** destiné au Directeur Technique et au Chef de Ferme de Berry Good Farms. Le ton est celui d'un expert : sobre, précis, chiffré, actionnable — jamais promotionnel, jamais alarmiste sans justification.

Tu disposes du rapport d'analyse complet AGQ Labs en pièce jointe PDF. **Lis-le intégralement** et intègre toutes les données pertinentes (foliaire, eau d'irrigation, SFR, sonde sol, drainage si présents).

## Dossier client
- **Exploitation** : Berry Good Farms — ${ferme || analyse.ferme || "?"}
- **Parcelle / Variété** : ${analyse.variete || parcelle || "Non spécifiée"}
- **Culture** : ${culture || analyse.culture || "?"}
- **Type d'analyse** : ${typeLabel}
- **Date de prélèvement** : ${dateStr}
- **Stade phénologique** : ${analyse.phenologie || "Non précisé"}
- **Laboratoire** : ${analyse.source === "email_agq" ? "AGQ Labs Maroc" : "Analyse manuelle"}
- **Observations terrain** : ${analyse.terrain_raw || analyse.description_raw || "Aucune"}
- **Notes du chef de ferme** : ${note_demande || "Aucune"}
- **Contexte général de la variété** : ${contexteGeneral || "Aucun"}

## Valeurs pré-extraites par notre parseur (à compléter depuis le PDF)
${parsedValuesLines || "(Vide — toutes les valeurs doivent être lues directement depuis le PDF joint.)"}

${scanPdfSent ? "📎 **PDF AGQ joint** — source primaire, à lire intégralement." : ""}
${scanImageSent ? "🖼️ **Scan image joint** — lis les valeurs visibles." : ""}
${terrainPhotoCount ? `📷 **${terrainPhotoCount} photo(s) terrain jointe(s)** (observations récentes de la parcelle) — intègre les symptômes visuels si pertinent (chlorose, nécrose, stress hydrique, état des fruits…).` : ""}
${(!scanPdfSent && !scanImageSent) ? "⚠️ **Aucun rapport scan disponible** — base ton analyse uniquement sur les valeurs pré-extraites ci-dessus et indique clairement les limites." : ""}

---

## Structure obligatoire du rapport

Rédige en **français professionnel**, en markdown strict (pas d'emojis décoratifs, sauf 🟢/🟡/🔴 pour les statuts dans les tableaux). Utilise des **tableaux markdown** pour chaque jeu de données.

### 1. Synthèse exécutive
Un paragraphe de 4-6 lignes : état global de la parcelle, 2-3 points critiques, niveau de priorité (**Faible / Moyen / Élevé / Critique**).

### 2. État nutritionnel détaillé
Pour **chaque matrice présente** (foliaire, eau d'irrigation, SFR, sonde sol, drainage), produis un tableau | Élément | Valeur | Norme | Statut |. Couvre macro + oligos + pH/CE/HCO₃/Cl/Na/ratios. Normes spécifiques à la culture. Statuts 🟢/🟡/🔴.

### 3. Diagnostic agronomique
#### 3.1 Rapports et équilibres ioniques — tableau des ratios critiques (K/Ca, K/Mg, Ca/Mg, N/K, SAR), commentaires.
#### 3.2 Problèmes identifiés (hiérarchisés) — pour chacun : nom court, preuves multi-matrices, mécanisme agronomique, conséquence.
#### 3.3 Niveau de priorité global — **Faible / Moyen / Élevé / Critique** + justification.

### 4. Plan de correction — Fertigation
Tableau | Élément à corriger | Action | Produit commercial (Maroc) | Dose | Fréquence | Durée |. Produits usuels (MAP, MKP, KNO₃, K₂SO₄, Ca(NO₃)₂, MgSO₄, acide nitrique/phosphorique, chélates EDDHA-Fe…). Distingue correction foliaire d'urgence vs ajustement SFR.

### 5. Actions prioritaires à 7 jours
Tableau | # | Action | Quand | Responsable | Critère de réussite | — exactement 3 actions.

### 6. Suivi et KPIs
Indicateurs + prochaine analyse recommandée + seuils de re-alerte.

### 7. Limites et hypothèses
Données manquantes ou incohérentes, explicitement.

---

**Contraintes**
- Unités SI ou horticoles (% MS, mg/kg, meq/L, dS/m).
- Toujours des doses chiffrées.
- Pas d'intro générale, pas de disclaimer.
- Longueur cible : 2000-3500 mots (hors tableaux).
- Signe en bas : "*Rapport généré par l'outil d'aide à la décision Berry Good Farms — À valider par le responsable technique.*"`;

  messageContent.push({ type: "text", text: prompt });

  const modelCandidates = [
    "claude-opus-4-6",
    "claude-sonnet-4-5",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
  ];
  let response = null;
  let lastError = null;
  const claudeStart = Date.now();
  console.log(`generateRecoForAnalyse START id=${id} scanPdf=${scanPdfSent} scanImg=${scanImageSent} photo=${!!photoImg}`);
  await writeProgress({
    state: "calling_llm",
    updated_at: Date.now(),
    detail: scanFile ? `PDF ${Math.round(scanFile.data.length / 1024)} KB` : "Pas de scan",
    model: modelCandidates[0],
  });
  for (const modelId of modelCandidates) {
    try {
      response = await client.messages.create({
        model: modelId,
        max_tokens: 16000,
        messages: [{ role: "user", content: messageContent }],
      });
      console.log(`generateRecoForAnalyse DONE id=${id} model=${modelId} duration=${Date.now() - claudeStart}ms`);
      break;
    } catch (e) {
      lastError = e;
      console.error("Claude model failed", modelId, e.message);
    }
  }
  if (!response) {
    await writeProgress({ state: "error", detail: lastError?.message?.slice(0, 200) || "LLM_UNAVAILABLE", updated_at: Date.now() });
    setTimeout(clearProgress, 10000);
    return { success: false, error: "LLM_UNAVAILABLE", detail: lastError?.message || "Aucun modèle Claude n'a répondu" };
  }

  const message = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const reco = {
    message,
    model: response.model || "claude",
    generated_at: Date.now(),
    has_photo: !!photoImg,
    has_scan: !!(scanPdfSent || scanImageSent),
    scan_format: scanPdfSent ? "pdf" : scanImageSent ? "image" : null,
  };

  if (!isValidReco(reco)) {
    console.error("LLM refusal or too-short reco, not storing:", message.slice(0, 200));
    await writeProgress({ state: "error", detail: "LLM_NO_PDF", updated_at: Date.now() });
    setTimeout(clearProgress, 10000); // leave the error state visible for 10s then clear
    return { success: false, error: "LLM_NO_PDF", preview: message.slice(0, 300) };
  }

  await writeProgress({ state: "saving", updated_at: Date.now() });
  const snap = await docRef.get();
  if (snap.exists) {
    const existing = snap.data().recommandations_ia || [];
    existing.push(reco);
    await docRef.update({ recommandations_ia: existing, updated_at: Date.now() });
  }
  await clearProgress();
  return { success: true, recommandation: reco };
}

// =============================================================================
// Auto-generate AI recommendation when a new foliar analysis gets a PDF attached.
// Fires on any write to analyses_foliaires/{id}. Triggers generation only when
// scan_resultat_url has just appeared (was null/undefined, now set) AND there
// is no existing valid reco yet. This covers AGQ email imports (where the PDF
// is uploaded right after doc creation via an update).
// =============================================================================
exports.stockManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB", secrets: ["ADMIN_SECRET"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).send("");

    const action = req.query.action || req.body?.action || "stock-dashboard";

    // Admin-only actions (no Firebase Auth, uses env secret)
    const adminSecret = process.env.ADMIN_SECRET;
    if (action === "reset-email-cursor" && req.method === "POST") {
      if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
      const { uid } = req.body;
      if (typeof uid !== "number") return res.status(400).json({ success: false, error: "uid (number) requis" });
      await db_firestore.collection("config").doc("email_fetch").set({ lastPollUid: uid }, { merge: true });
      return res.json({ success: true, message: `lastPollUid reset to ${uid}` });
    }
    if (action === "reprocess-email" && req.method === "POST") {
      if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
      const { uid } = req.body;
      if (!uid) return res.status(400).json({ success: false, error: "uid requis" });
      // Find the email doc by scanning for matching uid
      const snap = await db_firestore.collection("emails").where("uid", "==", uid).limit(1).get();
      if (snap.empty) return res.json({ success: false, error: `No email doc found with uid=${uid}` });
      const docRef = snap.docs[0].ref;
      const docId = snap.docs[0].id;
      const data = snap.docs[0].data();
      // Delete and re-create to trigger analyzeEmail (onCreate)
      await docRef.delete();
      await db_firestore.collection("emails").doc(docId).set({ ...data, status: "pending", reprocessed_at: Date.now() });
      return res.json({ success: true, message: `Email doc ${docId} (uid=${uid}) deleted and re-created with status=pending` });
    }

    // Skip Firebase Auth when admin secret is provided (CLI/scripts)
    let authUser;
    if (req.body?.secret === adminSecret) {
      authUser = { uid: "admin-cli", email: "admin@berrygood.ma" };
    } else {
      authUser = await requireAuth(req, res);
      if (!authUser) return;
    }

    try {
      // ========== SUPPLIERS ==========

      if (action === "list-suppliers") {
        const status = req.query.status; // "valide", "en_attente", "rejete", or empty for all active
        let snap;
        if (status) {
          snap = await db_firestore.collection("suppliers")
            .where("active", "==", true)
            .where("status", "==", status)
            .get();
        } else {
          snap = await db_firestore.collection("suppliers")
            .where("active", "==", true)
            .get();
        }
        const suppliers = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        suppliers.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { sensitivity: "base" }));
        return res.json({ success: true, suppliers });
      }

      if (action === "create-supplier" && req.method === "POST") {
        const { nom, ice, identifiant_fiscal, adresse, ville, tel, email, contact_nom, categorie, created_by } = req.body;
        const validation = validateSupplier({ nom, adresse, identifiant_fiscal, ice, contact_nom, tel });
        if (!validation.valid) {
          return res.status(400).json({ success: false, error: "Champs invalides", errors: validation.errors });
        }
        const now = Date.now();
        const docRef = await db_firestore.collection("suppliers").add({
          nom, ice: ice || "", identifiant_fiscal: identifiant_fiscal || "",
          adresse: adresse || "", ville: ville || "",
          tel: tel || "", email: email || "", contact_nom: contact_nom || "",
          categorie: categorie || "autre",
          status: "valide", // Validation automatique à la création
          validated_at: now, validated_by: created_by || {},
          active: true, created_by: created_by || {},
          history: [
            { action: "creation", by: created_by || {}, at: now, comment: "Fournisseur créé" },
            { action: "validation_auto", by: created_by || {}, at: now, comment: "Validation automatique (champs conformes)" },
          ],
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: docRef.id });
      }

      if (action === "update-supplier" && req.method === "POST") {
        const { id, updated_by, ...updates } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("suppliers").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Fournisseur non trouvé" });
        const current = doc.data();
        // Valider l'état résultant (merge current + updates)
        const merged = { ...current, ...updates };
        const validation = validateSupplier({
          nom: merged.nom, adresse: merged.adresse, identifiant_fiscal: merged.identifiant_fiscal,
          ice: merged.ice, contact_nom: merged.contact_nom, tel: merged.tel,
        });
        if (!validation.valid) {
          return res.status(400).json({ success: false, error: "Champs invalides", errors: validation.errors });
        }
        const now = Date.now();
        await db_firestore.collection("suppliers").doc(id).update({
          ...updates, status: "valide", updated_at: now,
          history: [...(current.history || []), { action: "modification", by: updated_by || {}, at: now, comment: "Fournisseur modifié" }],
        });
        return res.json({ success: true });
      }

      // ========== PURCHASE ORDERS (BDC) ==========

      if (action === "list-bdc") {
        const ferme = req.query.ferme;
        const status = req.query.status;
        const statuses = status ? String(status).split(",").map((s) => s.trim()).filter(Boolean) : [];
        const limit = parseInt(req.query.limit || "200");
        let query = db_firestore.collection("purchase_orders");
        const hasFilter = ferme || statuses.length > 0;
        if (ferme) query = query.where("ferme", "==", ferme);
        if (statuses.length === 1) query = query.where("status", "==", statuses[0]);
        else if (statuses.length > 1) query = query.where("status", "in", statuses);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        let bdc = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        if (hasFilter) bdc.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, bdc });
      }

      if (action === "get-bdc") {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        // Fetch linked delivery notes (no orderBy to avoid composite index requirement)
        const blSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", id).get();
        const bls = blSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '') > (a.created_at || '') ? -1 : 1);
        // Fetch linked invoices
        const facSnap = await db_firestore.collection("invoices").where("bdc_id", "==", id).get();
        const factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '') > (a.created_at || '') ? -1 : 1);
        return res.json({ success: true, bdc: { id: doc.id, ...doc.data() }, bls, factures });
      }

      if (action === "create-bdc" && req.method === "POST") {
        const { supplier_id, fournisseur, ferme, date_livraison_prevue, items, created_by,
          purchase_request_id, consultation_id, code_analytique, mode_paiement } = req.body;
        if (!fournisseur?.nom || !ferme || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: fournisseur.nom, ferme, items[]" });
        }
        const numero = await getNextNumber("purchase_order", "BDC");
        // Compute totals
        let total_ht = 0, total_tva = 0, total_ttc = 0;
        const computedItems = items.map((item) => {
          const montant_ht = (parseFloat(item.quantite) || 0) * (parseFloat(item.prix_unitaire) || 0);
          const taux = item.taux_tva != null && item.taux_tva !== '' ? parseFloat(item.taux_tva) : 20;
          const montant_tva = montant_ht * taux / 100;
          const montant_ttc = montant_ht + montant_tva;
          total_ht += montant_ht;
          total_tva += montant_tva;
          total_ttc += montant_ttc;
          return { ...item, montant_ht: Math.round(montant_ht * 100) / 100, montant_tva: Math.round(montant_tva * 100) / 100, montant_ttc: Math.round(montant_ttc * 100) / 100, taux_tva: taux };
        });
        const bdcData = {
          numero, status: "brouillon",
          purchase_request_id: purchase_request_id || null,
          consultation_id: consultation_id || null,
          supplier_id: supplier_id || null,
          fournisseur, ferme,
          date_livraison_prevue: date_livraison_prevue || "",
          code_analytique: code_analytique || "",
          mode_paiement: mode_paiement || "virement_bancaire",
          items: computedItems,
          total_ht: Math.round(total_ht * 100) / 100,
          total_tva: Math.round(total_tva * 100) / 100,
          total_ttc: Math.round(total_ttc * 100) / 100,
          delivery_status: "non_livre",
          invoice_status: "non_facture",
          created_by: created_by || {},
          validated_by_chef: null,
          validated_by_dg: null,
          history: [{ action: "creation", by: created_by || {}, at: Date.now(), comment: "" }],
          created_at: Date.now(), updated_at: Date.now(),
        };
        const docRef = await db_firestore.collection("purchase_orders").add(bdcData);
        return res.json({ success: true, id: docRef.id, numero });
      }

      if (action === "update-bdc" && req.method === "POST") {
        const { id, items, fournisseur, supplier_id, ferme, date_livraison_prevue, updated_by,
          code_analytique, mode_paiement } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "brouillon" && current.status !== "rejete") {
          return res.status(400).json({ success: false, error: "Le BDC ne peut être modifié que s'il est en brouillon ou rejeté" });
        }
        const updates = { updated_at: Date.now() };
        if (fournisseur) updates.fournisseur = fournisseur;
        if (supplier_id) updates.supplier_id = supplier_id;
        if (ferme) updates.ferme = ferme;
        if (date_livraison_prevue) updates.date_livraison_prevue = date_livraison_prevue;
        if (code_analytique !== undefined) updates.code_analytique = code_analytique;
        if (mode_paiement) updates.mode_paiement = mode_paiement;
        if (items?.length) {
          let total_ht = 0, total_tva = 0, total_ttc = 0;
          updates.items = items.map((item) => {
            const montant_ht = (parseFloat(item.quantite) || 0) * (parseFloat(item.prix_unitaire) || 0);
            const taux = item.taux_tva != null && item.taux_tva !== '' ? parseFloat(item.taux_tva) : 20;
            const montant_tva = montant_ht * taux / 100;
            const montant_ttc = montant_ht + montant_tva;
            total_ht += montant_ht;
            total_tva += montant_tva;
            total_ttc += montant_ttc;
            return { ...item, montant_ht: Math.round(montant_ht * 100) / 100, montant_tva: Math.round(montant_tva * 100) / 100, montant_ttc: Math.round(montant_ttc * 100) / 100, taux_tva: taux };
          });
          updates.total_ht = Math.round(total_ht * 100) / 100;
          updates.total_tva = Math.round(total_tva * 100) / 100;
          updates.total_ttc = Math.round(total_ttc * 100) / 100;
        }
        const history = current.history || [];
        history.push({ action: "modification", by: updated_by || {}, at: Date.now(), comment: "" });
        updates.history = history;
        await db_firestore.collection("purchase_orders").doc(id).update(updates);
        return res.json({ success: true });
      }

      if (action === "submit-bdc" && req.method === "POST") {
        const { id, submitted_by, pdf_url } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "brouillon" && current.status !== "rejete") {
          return res.status(400).json({ success: false, error: "Seul un BDC en brouillon ou rejeté peut être soumis" });
        }
        const history = current.history || [];
        const now = Date.now();
        // Fermes sans chef de ferme (Avocatier, F2, F3, F4, F6, BAHIA) → soumission directe au DG.
        // Source de vérité : functions/lib/bdc/workflow.js (mirror public/lib/bdcWorkflow.js).
        const skipChef = !bdcWorkflow.requiresChefValidation(current.ferme);
        const nextStatus = bdcWorkflow.nextStatusOnSubmit(current.ferme);
        const historyEntry = {
          action: skipChef ? "soumission_directe_dg" : "soumission",
          by: submitted_by || {},
          at: now,
          comment: skipChef ? `Ferme ${current.ferme} sans Chef de Ferme — soumission directe au DG` : "",
        };
        const bypassReason = bdcWorkflow.bypassReason(current.ferme);
        if (bypassReason) historyEntry.bypass_reason = bypassReason;
        history.push(historyEntry);
        const updatePatch = { status: nextStatus, history, updated_at: now };
        if (pdf_url) updatePatch.pdf_url = pdf_url;
        await db_firestore.collection("purchase_orders").doc(id).update(updatePatch);
        // WhatsApp: notify chef de ferme OU DG selon le cas
        const { buildBdcWhatsAppSummary } = require("../../../notificationDispatcher");
        const bdcForSummary = { ...current, id };
        const bdcPdfUrl = pdf_url || current.pdf_url || null;
        const useDocTemplate = !!bdcPdfUrl;
        // Résumé articles sur une ligne (params Meta : pas de saut de ligne ni 4+ espaces).
        const _items = Array.isArray(current.items) ? current.items : [];
        const _clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
        const _itemLabel = (it) => {
          const lib = _clean(it.article || it.designation || "Article");
          const qte = it.quantite != null && it.quantite !== "" ? it.quantite : "?";
          const unite = it.unite ? ` ${_clean(it.unite)}` : "";
          return `${lib} ×${qte}${unite}`;
        };
        const articlesSummary = _items.length
          ? _items.slice(0, 3).map(_itemLabel).join(", ") + (_items.length > 3 ? ` (+${_items.length - 3} autres)` : "")
          : "—";
        const fournisseurNom = _clean((current.fournisseur && current.fournisseur.nom) || "") || "—";
        dispatchNotification({
          type: useDocTemplate ? "bdc_submit_doc" : "bdc_submit",
          profiles: skipChef ? ["dg"] : [bdcWorkflow.chefProfileForFerme(current.ferme)].filter(Boolean),
          ferme: skipChef ? null : current.ferme,
          data: {
            numero: current.numero || id,
            fournisseur: fournisseurNom,
            articles: articlesSummary,
            montant: current.total_ttc ? `${current.total_ttc} MAD` : "Non précisé",
            message: `BDC ${current.numero || id} en attente de validation ${skipChef ? "DG" : "Chef"}`,
            bdc_id: id,
            pdf_url: bdcPdfUrl,
            summary: buildBdcWhatsAppSummary(bdcForSummary),
          },
          relatedDoc: `purchase_orders/${id}`,
          ...(useDocTemplate ? { document: { link: bdcPdfUrl, filename: `BDC_${current.numero || id}.pdf` } } : {}),
        }).catch(err => console.error("WhatsApp dispatch error:", err));
        return res.json({ success: true });
      }

      // One-shot migration: redirige les BdC actuellement en `en_attente_chef` pour
      // des fermes DIRECT_DG_FARMS (Avocatier/F2/F3/F4/F6/BAHIA) vers `en_attente_dg`.
      // Protégé par admin-secret. À lancer une fois après déploiement de la nouvelle règle.
      if (action === "migrate-bdc-direct-dg" && req.method === "POST") {
        if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
        const snap = await db_firestore.collection("purchase_orders")
          .where("status", "==", "en_attente_chef").get();
        const targets = snap.docs.filter(d => !bdcWorkflow.requiresChefValidation(d.data().ferme));
        const now = Date.now();
        const migratedIds = [];
        const unknownFermes = new Set();
        // Firestore batch limit = 500 ; on chunke à 400 par convention CLAUDE.md.
        for (let i = 0; i < targets.length; i += 400) {
          const batch = db_firestore.batch();
          const chunk = targets.slice(i, i + 400);
          for (const d of chunk) {
            const data = d.data();
            const history = (data.history || []).concat([{
              action: "migration_direct_dg",
              by: { profileId: "system", name: "Migration script" },
              at: now,
              comment: `BDC redirigé vers DG (règle DIRECT_DG_FARMS, ferme=${data.ferme})`,
              bypass_reason: "no_chef_de_ferme",
              previous_status: "en_attente_chef",
            }]);
            batch.update(d.ref, { status: "en_attente_dg", history, updated_at: now });
            migratedIds.push(d.id);
          }
          await batch.commit();
        }
        // Data-quality signal : log les fermes inconnues croisées (ni F1/F5 ni 6 fermes ciblées).
        for (const d of snap.docs) {
          const f = d.data().ferme;
          if (!f || (bdcWorkflow.requiresChefValidation(f) && !["F1", "F5"].includes(f))) unknownFermes.add(f || "(empty)");
        }
        return res.json({
          success: true,
          scanned: snap.size,
          migrated: targets.length,
          migrated_ids: migratedIds,
          unknown_fermes: Array.from(unknownFermes),
        });
      }

      if (action === "delete-bdc" && req.method === "POST") {
        const { id, deleted_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const requesterProfile = deleted_by && deleted_by.profileId;
        const canForceDelete = requesterProfile === "achats" || requesterProfile === "admin";
        if (doc.data().status !== "brouillon" && !canForceDelete) {
          return res.status(400).json({ success: false, error: "Seul un BDC en brouillon peut être supprimé" });
        }
        await db_firestore.collection("purchase_orders").doc(id).delete();
        return res.json({ success: true });
      }

      if (action === "validate-bdc" && req.method === "POST") {
        const { id, decision, role, profileId, name, comment, ferme: validatorFerme } = req.body;
        const result = await validateBdcCore({
          id, decision, role, profileId, name, comment, ferme: validatorFerme, via: "dashboard",
        });
        if (!result.success) {
          return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        }
        return res.json({ success: true });
      }

      if (action === "send-bdc" && req.method === "POST") {
        const { id, sent_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        const isVirement = current.mode_paiement === "comptant_virement" || current.mode_paiement === "virement_bancaire";
        if (isVirement) {
          if (current.status !== "virement_signe") {
            return res.status(400).json({ success: false, error: "Le virement doit être signé avant l'envoi au fournisseur" });
          }
        } else {
          if (current.status !== "valide_dg") {
            return res.status(400).json({ success: false, error: "Le BDC doit être validé par le DG avant envoi" });
          }
        }
        const history = current.history || [];
        history.push({ action: "envoi_fournisseur", by: sent_by || {}, at: Date.now(), comment: "" });
        await db_firestore.collection("purchase_orders").doc(id).update({
          status: "envoye", history, updated_at: Date.now(),
        });
        // WhatsApp: notify finance
        dispatchNotification({
          type: "bdc_sent_to_supplier", profiles: ["finance"],
          data: {
            numero: current.numero || id,
            supplier: current.supplier_name || "Fournisseur inconnu",
            message: `BDC ${current.numero || id} envoyé au fournisseur`,
          },
          relatedDoc: `purchase_orders/${id}`,
        }).catch(err => console.error("WhatsApp dispatch error:", err));
        return res.json({ success: true });
      }

      if (action === "update-bdc-virement" && req.method === "POST") {
        const { id, decision, by } = req.body;
        const result = await updateBdcVirementCore({ id, decision, by, via: "dashboard" });
        if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        return res.json({ success: true });
      }

      if (action === "upload-virement-avis" && req.method === "POST") {
        const { id, avis_pdf_url, uploaded_by } = req.body;
        const result = await recordVirementAvis({ id, avis_pdf_url, uploaded_by });
        if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        return res.json({ success: true });
      }

      if (action === "migrate-bdc-mode-paiement" && req.method === "POST") {
        // One-shot migration: virement_bancaire → comptant_virement, caisse → comptant_especes, comptant → facilite
        const snap = await db_firestore.collection("purchase_orders").get();
        const map = { virement_bancaire: "comptant_virement", caisse: "comptant_especes", comptant: "facilite" };
        let updated = 0;
        const batch = db_firestore.batch();
        snap.forEach(doc => {
          const m = doc.data().mode_paiement;
          if (m && map[m]) {
            batch.update(doc.ref, { mode_paiement: map[m] });
            updated++;
          }
        });
        if (updated > 0) await batch.commit();
        return res.json({ success: true, updated, total: snap.size });
      }

      if (action === "remind-bdc" && req.method === "POST") {
        const { id, by } = req.body;
        const result = await remindBdcCore({ id, by, via: "dashboard" });
        if (!result.success) {
          return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        }
        return res.json({ success: true, profiles: result.profiles, duration: result.duration });
      }

      // ---- BDC Change Requests (modification/annulation) ----
      if (action === "request-bdc-change" && req.method === "POST") {
        const { bdc_id, type, motif, requested_by } = req.body;
        if (!bdc_id || !type || !motif) return res.status(400).json({ success: false, error: "bdc_id, type et motif requis" });
        if (!["modification", "annulation"].includes(type)) return res.status(400).json({ success: false, error: "type doit être modification ou annulation" });
        const doc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = doc.data();
        if (!["valide_dg", "envoye", "virement_lance", "virement_signe"].includes(bdc.status)) {
          return res.status(400).json({ success: false, error: "Le BDC doit être validé DG ou au-delà pour demander une modification/annulation" });
        }
        // Check no pending request exists
        const existing = await db_firestore.collection("bdc_change_requests").where("bdc_id", "==", bdc_id).where("status", "==", "en_attente").get();
        if (!existing.empty) return res.status(400).json({ success: false, error: "Une demande est déjà en cours pour ce BDC" });
        const now = Date.now();
        const ref = await db_firestore.collection("bdc_change_requests").add({
          bdc_id, bdc_numero: bdc.numero || "", type, motif, status: "en_attente",
          requested_by: requested_by || {}, created_at: now,
        });
        const history = bdc.history || [];
        history.push({ action: "demande_" + type, by: requested_by || {}, at: now, comment: motif });
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ history, updated_at: now, pending_change_request: ref.id });
        return res.json({ success: true, id: ref.id });
      }

      if (action === "list-bdc-change-requests") {
        const { status } = req.query;
        let q = db_firestore.collection("bdc_change_requests");
        if (status) q = q.where("status", "==", status);
        const snap = await q.get();
        const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        requests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, requests });
      }

      if (action === "approve-bdc-change" && req.method === "POST") {
        const { id, decision, comment, approved_by } = req.body;
        if (!id || !decision) return res.status(400).json({ success: false, error: "id et decision requis" });
        const reqDoc = await db_firestore.collection("bdc_change_requests").doc(id).get();
        if (!reqDoc.exists) return res.status(404).json({ success: false, error: "Demande non trouvée" });
        const request = reqDoc.data();
        if (request.status !== "en_attente") return res.status(400).json({ success: false, error: "Cette demande n'est plus en attente" });
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(request.bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();
        const history = bdc.history || [];
        const now = Date.now();
        if (decision === "approve") {
          if (request.type === "modification") {
            history.push({ action: "retour_brouillon_dg", by: approved_by || {}, at: now, comment: comment || "Modification approuvée par DG" });
            await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({
              status: "brouillon", validated_by_dg: null, validated_by_chef: null, notified_finance: false,
              history, updated_at: now, pending_change_request: null,
            });
          } else {
            history.push({ action: "annulation_dg", by: approved_by || {}, at: now, comment: comment || "Annulation approuvée par DG" });
            await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({
              status: "annule", history, updated_at: now, pending_change_request: null,
            });
          }
          await db_firestore.collection("bdc_change_requests").doc(id).update({ status: "approuve", approved_by: approved_by || {}, approved_at: now, comment: comment || "" });
        } else {
          history.push({ action: "demande_rejetee_dg", by: approved_by || {}, at: now, comment: comment || "Demande refusée" });
          await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({ history, updated_at: now, pending_change_request: null });
          await db_firestore.collection("bdc_change_requests").doc(id).update({ status: "rejete", approved_by: approved_by || {}, approved_at: now, comment: comment || "" });
        }
        return res.json({ success: true });
      }

      if (action === "send-bdc-email" && req.method === "POST") {
        const { bdc_id, to, subject, message, pdf_base64, pdf_filename, sent_by } = req.body;
        if (!bdc_id || !to) return res.status(400).json({ success: false, error: "bdc_id et email destinataire requis" });

        // Load SMTP config from Firestore
        const configDoc = await db_firestore.collection("config").doc("email_smtp").get();
        const smtp = configDoc.exists ? configDoc.data() : {};
        if (!smtp.user || !smtp.pass) return res.status(400).json({ success: false, error: "Configuration SMTP non définie. Créez le document config/email_smtp dans Firestore avec les champs: host, port, user, pass" });

        const transporter = nodemailer.createTransport({
          host: smtp.host || "smtp.gmail.com",
          port: parseInt(smtp.port) || 587,
          secure: (smtp.port === "465" || smtp.port === 465),
          auth: { user: smtp.user, pass: smtp.pass },
        });

        const mailOptions = {
          from: smtp.from || smtp.user,
          to,
          subject: subject || "Bon de Commande - Berry Good Farms",
          text: message || "",
          attachments: pdf_base64 ? [{
            filename: pdf_filename || "BDC.pdf",
            content: Buffer.from(pdf_base64, "base64"),
            contentType: "application/pdf",
          }] : [],
        };

        await transporter.sendMail(mailOptions);

        // Update BDC status to envoye and log history
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (bdcDoc.exists) {
          const current = bdcDoc.data();
          const history = current.history || [];
          history.push({ action: "envoi_email", by: sent_by || {}, at: Date.now(), comment: "Envoyé par email à " + to });
          const updates = { history, updated_at: Date.now(), email_sent_to: to, email_sent_at: Date.now() };
          if (current.status === "valide_dg") updates.status = "envoye";
          await db_firestore.collection("purchase_orders").doc(bdc_id).update(updates);
        }

        return res.json({ success: true });
      }

      // ========== PENDING VALIDATIONS ==========

      if (action === "pending-validations") {
        const role = req.query.role;
        const ferme = req.query.ferme;
        const result = { bdc_chef: 0, bdc_dg: 0, factures_achats: 0, factures_finance: 0, factures_dg: 0 };

        if (role === "chef" && ferme) {
          const snap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef")
            .where("ferme", "==", ferme)
            .get();
          result.bdc_chef = snap.size;
        }
        if (role === "dg") {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get();
          result.bdc_dg = bdcSnap.size;
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_finance").get();
          result.factures_dg = facSnap.size;
        }
        if (role === "finance") {
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_achats").get();
          result.factures_finance = facSnap.size;
        }
        if (role === "achats") {
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "en_validation").get();
          result.factures_achats = facSnap.size;
          // DAs pending approval
          const daSnap = await db_firestore.collection("purchase_requests")
            .where("status", "==", "soumise").get();
          result.da_soumises = daSnap.size;
          result.da_list = daSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          // BDCs en brouillon (created from DA, need completion)
          const bdcBrouillonSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "brouillon").get();
          result.bdc_brouillon = bdcBrouillonSnap.size;
          // BDCs en attente validation chef
          const bdcChefSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef").get();
          result.bdc_attente_chef = bdcChefSnap.size;
          // BDCs en attente validation DG
          const bdcDgSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get();
          result.bdc_attente_dg = bdcDgSnap.size;
        }
        return res.json({ success: true, pending: result });
      }

      // ========== PURCHASE REQUESTS (DA) ==========

      if (action === "list-da") {
        const ferme = req.query.ferme;
        const status = req.query.status;
        const limit = parseInt(req.query.limit || "200");
        let query = db_firestore.collection("purchase_requests");
        const hasFilter = ferme || status;
        if (ferme) query = query.where("ferme", "==", ferme);
        if (status) query = query.where("status", "==", status);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        let das = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        if (hasFilter) das.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, das });
      }

      if (action === "create-da" && req.method === "POST") {
        const { ferme, urgence, justification, items, created_by } = req.body;
        if (!ferme || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: ferme, items[]" });
        }
        const numero = await getNextNumber("purchase_request", "DA");
        const daData = {
          numero, status: "soumise", ferme,
          urgence: urgence || "normale",
          justification: justification || "",
          items: items.map((it) => ({ article: it.article || "", categorie: it.categorie || "autre", quantite: parseFloat(it.quantite) || 0, unite: it.unite || "kg", note: it.note || "" })),
          created_by: created_by || {},
          history: [{ action: "creation", by: created_by || {}, at: Date.now(), comment: "" }],
          created_at: Date.now(), updated_at: Date.now(),
        };
        const docRef = await db_firestore.collection("purchase_requests").add(daData);
        return res.json({ success: true, id: docRef.id, numero });
      }

      if (action === "update-da" && req.method === "POST") {
        const { id, status, items, urgence, justification, updated_by, comment } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_requests").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "DA non trouvée" });
        const current = doc.data();
        const updates = { updated_at: Date.now() };
        if (status) updates.status = status;
        if (items) updates.items = items;
        if (urgence) updates.urgence = urgence;
        if (justification !== undefined) updates.justification = justification;
        const history = current.history || [];
        history.push({ action: status === "approuvee" ? "approbation" : status === "rejetee" ? "rejet" : "modification", by: updated_by || {}, at: Date.now(), comment: comment || "" });
        updates.history = history;
        await db_firestore.collection("purchase_requests").doc(id).update(updates);

        // Auto-create BDC when DA is approved
        if (status === "approuvee") {
          const daData = { ...current, ...updates };
          const bdcNumero = await getNextNumber("purchase_order", "BDC");
          // Load catalogue to auto-fill prices and TVA
          const catalogSnap = await db_firestore.collection("articles_catalog").where("active", "==", true).get();
          const catalogMap = {};
          catalogSnap.docs.forEach(d => { const data = d.data(); catalogMap[(data.nom || "").toLowerCase().trim()] = data; });
          const bdcItems = (daData.items || []).map((item) => {
            const catArticle = catalogMap[(item.article || "").toLowerCase().trim()] || {};
            const pu = catArticle.prix_ht || 0;
            const tva = catArticle.taux_tva != null && catArticle.taux_tva !== '' ? parseFloat(catArticle.taux_tva) : 20;
            const qty = parseFloat(item.quantite) || 1;
            const mht = pu * qty;
            return {
            article: item.article || "",
            categorie: item.categorie || catArticle.categorie || "autre",
            quantite: qty,
            unite: item.unite || catArticle.unite || "unité",
            prix_unitaire: pu,
            taux_tva: tva,
            montant_ht: Math.round(mht * 100) / 100,
            montant_tva: Math.round(mht * tva / 100 * 100) / 100,
            montant_ttc: Math.round(mht * (1 + tva / 100) * 100) / 100,
            note: item.note || "",
          };});
          const bdcData = {
            numero: bdcNumero,
            status: "brouillon",
            purchase_request_id: id,
            consultation_id: null,
            supplier_id: null,
            fournisseur: { nom: "À définir" },
            ferme: daData.ferme || "",
            date_livraison_prevue: "",
            code_analytique: "",
            mode_paiement: "virement_bancaire",
            items: bdcItems,
            total_ht: bdcItems.reduce((s, i) => s + (i.montant_ht || 0), 0),
            total_tva: bdcItems.reduce((s, i) => s + (i.montant_tva || 0), 0),
            total_ttc: bdcItems.reduce((s, i) => s + (i.montant_ttc || 0), 0),
            delivery_status: "non_livre",
            invoice_status: "non_facture",
            created_by: updated_by || {},
            validated_by_chef: null,
            validated_by_dg: null,
            history: [
              { action: "creation", by: updated_by || {}, at: Date.now(), comment: "Créé automatiquement depuis DA " + (daData.numero || id) },
            ],
            created_at: Date.now(), updated_at: Date.now(),
          };
          const bdcRef = await db_firestore.collection("purchase_orders").add(bdcData);
          // Link BDC back to DA
          await db_firestore.collection("purchase_requests").doc(id).update({
            bdc_id: bdcRef.id, bdc_numero: bdcNumero,
          });
          return res.json({ success: true, bdc_created: true, bdc_id: bdcRef.id, bdc_numero: bdcNumero });
        }

        return res.json({ success: true });
      }

      // ========== DELIVERY NOTES (BL) ==========

      if (action === "list-bl") {
        const bdc_id = req.query.bdc_id;
        const limit = parseInt(req.query.limit || "200");
        const hasFilter = !!bdc_id;
        let query = db_firestore.collection("delivery_notes");
        if (bdc_id) query = query.where("bdc_id", "==", bdc_id);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        const bls = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((bl) => !bl.deleted);
        if (hasFilter) bls.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, bls });
      }

      if (action === "create-bl" && req.method === "POST") {
        const { bdc_id, date_reception, numero_bl_fournisseur, items, created_by, scan_url, scan_id } = req.body;
        if (!bdc_id || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: bdc_id, items[]" });
        }
        // Fetch the BDC
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();
        if (!["valide_dg", "envoye", "virement_lance", "virement_signe"].includes(bdc.status)) {
          return res.status(400).json({ success: false, error: "Le BDC doit être validé ou envoyé pour recevoir un BL" });
        }
        if (bdc.delivery_status === "complet") {
          return res.status(400).json({ success: false, error: "Ce BDC est déjà entièrement réceptionné." });
        }

        // Reçu par article (BL existants) + commandé par article — calculés AVANT la création
        // du BL pour pouvoir valider le reliquat par article via functions/lib/bdc/receptionGuard.js.
        // Réutilisés plus bas pour la mise à jour finale de delivery_status (pas de duplication
        // du calcul ni de la requête Firestore).
        const existingBlSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", bdc_id).get();
        const existingBls = existingBlSnap.docs.map((d) => d.data()).filter((bl) => !bl.deleted);
        const received = bdcReceptionGuard.computeReceivedByArticle(existingBls);
        const ordered = bdcReceptionGuard.computeOrderedByArticle(bdc.items || []);

        const reliquatRejection = bdcReceptionGuard.validateReliquat(bdc.items || [], existingBls, items);
        if (reliquatRejection) {
          return res.status(reliquatRejection.status).json({ success: false, error: reliquatRejection.error });
        }

        const blItemsSaisis = items.map((it) => ({
          article: it.article || "",
          quantite_commandee: parseFloat(it.quantite_commandee) || 0,
          quantite_recue: parseFloat(it.quantite_recue) || 0,
          // Pas de « kg » fabriqué : 85,7 % des lignes de BDC n'ont pas d'unité,
          // et l'inventer ici la transformait en critère de refus plus bas.
          unite: it.unite || "",
          ecart: (parseFloat(it.quantite_recue) || 0) - (parseFloat(it.quantite_commandee) || 0),
          note: it.note || "",
        }));

        // --- IDENTITÉ D'ARTICLE (lib/stock/identiteArticle) ----------------
        //
        // ⚠️ LA RÉCEPTION NE BLOQUE JAMAIS — DÉCISION D'OMAR.
        // Une ligne de BL vient d'un BDC déjà validé par le DG : le magasinier
        // n'a pas choisi ce libellé. Le refuser reviendrait à le punir pour une
        // décision d'achat qui n'est pas la sienne, et à retenir une
        // marchandise physiquement livrée. Mesuré : 16 lignes de BDC en attente
        // sont dans ce cas (rouleau adhésif, film, souffleur, substrat) — du
        // matériel qui n'a pas vocation à être tenu en stock.
        //
        // Donc : la réception est ENREGISTRÉE, la ligne non résolue n'entre PAS
        // en stock (écrire un mouvement sous un libellé non résolu recréerait
        // le solde orphelin que tout ce chantier supprime), elle est MARQUÉE
        // sur le BL, et une demande de création part au DG.
        //
        // Seules les lignes RÉELLEMENT reçues sont examinées — filtre exact de
        // `receptionBdc.lignesDepuisBl` : une ligne commandée mais non livrée
        // n'entre pas en stock, elle n'a donc pas besoin d'identité.
        const blIndexIdentite = await getIdentiteArticleIndex(db_firestore);
        const blLignesRecues = blItemsSaisis.filter((it) => it.quantite_recue > 0);
        const blPartition = demandeCreationArticle.partitionnerLignesReception(
          blLignesRecues,
          blIndexIdentite
        );
        const blDemandes = blPartition.ecartees.length
          ? await enregistrerDemandesCreation(
            db_firestore,
            blPartition.resolutions,
            { uid: authUser.uid, profileId: (created_by || {}).profileId || "", name: (created_by || {}).name || "" },
            { origine: "create-bl", type: "reception", numero: bdc.numero || "" }
          )
          : [];
        // Le BL garde TOUTES ses lignes — c'est le document du fournisseur.
        // Les écartées portent seulement la raison de leur absence du stock :
        // sans cette marque, l'écart entre le BL et le mouvement de réception
        // serait invisible et passerait pour une perte.
        const blItems = demandeCreationArticle.marquerLignesEcartees(
          blItemsSaisis,
          blPartition.ecartees,
          // Le motif est DÉRIVÉ de l'issue de chaque ligne : « absent du
          // catalogue » et « en double au catalogue » appellent des gestes
          // opposés (créer / fusionner). Un motif constant en envoyait un seul,
          // et se trompait dans l'autre cas.
          blPartition.resolutions
        );
        // Table libellé -> docId de fiche, pour les seules lignes retenues.
        const blIdentites = new Map(
          blPartition.retenues.map((it) => [
            it.article || "",
            identiteArticle.identiteImpact(it, blIndexIdentite),
          ])
        );

        // Numéro alloué SEULEMENT maintenant : tous les refus de cette action
        // (BDC absent, statut, reliquat) sont derrière nous. Il était pris plus
        // haut, si bien qu'une réception rejetée consommait un numéro de
        // séquence pour rien.
        const numero = await getNextNumber("delivery_note", "BL");
        const blData = {
          numero, bdc_id, bdc_numero: bdc.numero,
          fournisseur_nom: bdc.fournisseur?.nom || "",
          date_reception: date_reception || new Date().toISOString().split("T")[0],
          numero_bl_fournisseur: numero_bl_fournisseur || "",
          items: blItems,
          scan_url: scan_url || null, scan_id: scan_id || null,
          created_by: created_by || {},
          created_at: Date.now(),
        };
        const docRef = await db_firestore.collection("delivery_notes").add(blData);

        // Update scan record if created from scan
        if (scan_id) {
          await db_firestore.collection("bl_scans").doc(scan_id).update({ bl_id: docRef.id, bl_numero: numero }).catch(() => {});
        }

        // Create stock_movement of type reception — valorisé et EN STOCK immédiatement.
        //
        // L'étape de validation Achats est supprimée : le BDC lié est déjà validé
        // par le DG, et personne ne validait plus depuis le 5 juin (62 réceptions
        // bloquées au 27/08/2026 — un compte qui AUGMENTE tant que ceci n'est pas
        // déployé, leur marchandise jamais entrée en stock). Cf.
        // docs/spec-reception-sans-validation-achats.md.
        //
        // Le prix n'est plus recopié du BDC ici : il est choisi par le module PUR
        // receptionValorisation/prixLigne, qui descend la hiérarchie facture > bon_commande
        // > bon_entree, refuse une unité divergente, et ne pose JAMAIS un prix à
        // zéro par défaut — une ligne sans prix entre en stock NON valorisée, avec
        // son motif tracé. Un stock valorisé à zéro ressemble à un vrai chiffre ;
        // une absence assumée se voit et se corrige.
        // Destination vérifiable AVANT d'écrire quoi que ce soit : la règle vit
        // dans le module (resoudreMagasinDestination), on ne fait que refuser tôt
        // avec un message utile plutôt que de laisser le module lever une 500.
        if (!receptionBdc.resoudreMagasinDestination(req.body.magasin, bdc)) {
          return res.status(400).json({
            success: false,
            error: "Magasin de destination introuvable : choisissez un magasin, ou renseignez la ferme du bon de commande.",
            code: "destination_requise",
          });
        }

        // Numéro BR alloué SEULEMENT s'il y a une réception à créer : sans
        // ligne retenue (BDC 100 % hors catalogue), il n'y a pas de mouvement,
        // et prendre un numéro laisserait un trou dans la séquence.
        const brNumero = blPartition.retenues.length
          ? await getNextNumber("stock_reception", "BR")
          : "";
        // Identité créateur du mouvement de réception : userId = uid du TOKEN
        // (anti-spoof), profileId/name conservés. Cf. stockMovementGuard.
        const brCreatedBy = { ...(created_by || {}), userId: authUser.uid };
        // TOUTES les décisions (lignes retenues, prix, statut) sont prises dans le
        // module pur, donc testées. Ici il ne reste que deux gestes : écrire, et
        // appliquer l'impact stock. La source `facture` n'est pas encore branchée
        // sur Firestore (lot suivant) ; le module l'accepte déjà.
        const brMovement = brNumero ? receptionBdc.construireMouvementReception({
          numero: brNumero,
          // ⚠️ Les lignes RETENUES, jamais `blItems` : une ligne écartée ne
          // doit produire AUCUN mouvement de stock. La lui passer ici la
          // ferait entrer en stock sous son libellé — exactement le solde
          // orphelin que ce lot supprime.
          blItems: blPartition.retenues,
          bdc,
          magasinDemande: req.body.magasin,
          bdcId: bdc_id,
          blId: docRef.id,
          date: date_reception,
          refBlFournisseur: numero_bl_fournisseur,
          scanUrl: scan_url,
          createdBy: brCreatedBy,
        }) : null;
        // null = aucune ligne retenue → aucune réception à créer. Le BL, lui,
        // existe : la livraison est enregistrée même si rien n'entre en stock.
        if (brMovement) {
          // `receptionBdc.lignesDepuisBl` recopie le libellé du BL dans
          // `article_ref` — le module est PUR, il n'a pas le catalogue. On
          // substitue ici le docId de la fiche, en gardant le libellé dans
          // `article_nom` (ce que la valorisation lit en priorité).
          brMovement.items = brMovement.items.map((it) => ({
            ...it,
            article_ref: blIdentites.get(it.article_nom || it.article_ref || "") || it.article_ref,
          }));
          await db_firestore.collection("stock_movements").add(brMovement);
          // Entrée en stock immédiate : c'est ce que l'étape Achats retenait.
          await applyStockImpact(brMovement);
        }

        // Update BDC delivery_status — réutilise received/ordered calculés avant la création du
        // BL, en y ajoutant les quantités du nouveau BL (pas de reduplication de la requête/calcul).
        blItems.forEach((it) => { received[it.article] = (received[it.article] || 0) + (it.quantite_recue || 0); });
        const deliveryStatus = bdcReceptionGuard.deriveDeliveryStatus(ordered, received);
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ delivery_status: deliveryStatus, updated_at: Date.now() });

        // `numero` est celui du BL. Le numéro du bon de RÉCEPTION (BR) est distinct :
        // l'exposer séparément évite d'annoncer « Réception BL-0042 créée ».
        return res.json({
          success: true, id: docRef.id, numero, delivery_status: deliveryStatus,
          reception_numero: brMovement ? brMovement.numero : null,
          valorisation: brMovement ? brMovement.valorisation : null,
          // Ce qui N'EST PAS entré en stock, et pourquoi. La réception réussit
          // (statut 200) même si zéro ligne est entrée : sans ces champs, la
          // réponse serait un succès muet, et l'appelant ne pourrait pas
          // distinguer « tout est en stock » de « rien ne l'est ».
          // ⚠️ Aucun écran ne les affiche encore — `public/app.jsx` est gelé.
          // C'est la limite N4 remontée par la QA, à lever au dégel.
          lignes_hors_stock: blPartition.ecartees.length,
          demandes_creation: blDemandes,
        });
      }

      // ========== STOCK LEVELS ==========

      if (action === "stock-levels") {
        const ferme = req.query.ferme;
        const cacheKey = "stock_levels" + (ferme ? "_" + ferme : "_all");
        const result = await withCache(cacheKey, 2 * 60 * 1000, async () => {
          const [blSnap, bcSnap] = await Promise.all([
            db_firestore.collection("delivery_notes").get(),
            db_firestore.collection("consumption_vouchers").get(),
          ]);
          const entries = {};
          blSnap.docs.forEach((doc) => {
            const bl = doc.data();
            (bl.items || []).forEach((it) => {
              const key = it.article;
              if (!entries[key]) entries[key] = { article: key, entrees: 0, sorties: 0, unite: it.unite || "kg" };
              entries[key].entrees += it.quantite_recue || 0;
            });
          });
          bcSnap.docs.forEach((doc) => {
            const bc = doc.data();
            if (ferme && bc.ferme !== ferme) return;
            (bc.items || []).forEach((it) => {
              const key = it.article;
              if (!entries[key]) entries[key] = { article: key, entrees: 0, sorties: 0, unite: it.unite || "kg" };
              entries[key].sorties += it.quantite || 0;
            });
          });
          let stocks = Object.values(entries).map((e) => ({
            article: e.article, unite: e.unite,
            entrees: Math.round(e.entrees * 100) / 100,
            sorties: Math.round(e.sorties * 100) / 100,
            stock: Math.round((e.entrees - e.sorties) * 100) / 100,
          }));
          stocks.sort((a, b) => b.stock - a.stock);
          return { success: true, stocks, count: stocks.length };
        });
        return res.json(result);
      }

      // ========== INVOICES (FACTURES) ==========

      if (action === "list-factures") {
        const limit = parseInt(req.query.limit || "200");
        const status = req.query.payment_status;
        let query = db_firestore.collection("invoices").orderBy("created_at", "desc").limit(limit);
        if (status) query = query.where("payment_status", "==", status);
        const snap = await query.get();
        const factures = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, factures });
      }

      if (action === "create-facture" && req.method === "POST") {
        const { bdc_id, numero_facture, date_facture, items, created_by, ferme, scan_url, scan_id } = req.body;
        if (!bdc_id || !numero_facture || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: bdc_id, numero_facture, items[]" });
        }
        // Fetch BDC for discrepancy detection
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();

        // Build BDC lookup by article
        const bdcLookup = {};
        (bdc.items || []).forEach((it) => {
          bdcLookup[it.article] = { quantite: parseFloat(it.quantite) || 0, prix_unitaire: parseFloat(it.prix_unitaire) || 0 };
        });

        // Process items and detect discrepancies
        const discrepancies = [];
        let total_ht = 0, total_tva = 0;
        const facItems = items.map((it) => {
          const qty = parseFloat(it.quantite) || 0;
          const pu = parseFloat(it.prix_unitaire) || 0;
          const tva_rate = parseFloat(it.taux_tva) || 20;
          const mht = qty * pu;
          const mtva = mht * tva_rate / 100;
          total_ht += mht;
          total_tva += mtva;

          // Check discrepancies vs BDC
          const bdcItem = bdcLookup[it.article];
          if (bdcItem) {
            if (qty !== bdcItem.quantite) {
              discrepancies.push({ article: it.article, type: "quantite", bdc_value: bdcItem.quantite, facture_value: qty, ecart: qty - bdcItem.quantite });
            }
            if (pu !== bdcItem.prix_unitaire) {
              discrepancies.push({ article: it.article, type: "prix", bdc_value: bdcItem.prix_unitaire, facture_value: pu, ecart: pu - bdcItem.prix_unitaire });
            }
          }

          return { article: it.article || "", quantite: qty, unite: it.unite || "kg", prix_unitaire: pu, taux_tva: tva_rate, montant_ht: Math.round(mht * 100) / 100, montant_tva: Math.round(mtva * 100) / 100, montant_ttc: Math.round((mht + mtva) * 100) / 100 };
        });

        const numero = await getNextNumber("invoice", "FAC");
        const now = Date.now();
        const facData = {
          numero, numero_facture, bdc_id, bdc_numero: bdc.numero,
          fournisseur: bdc.fournisseur || {},
          date_facture: date_facture || new Date().toISOString().split("T")[0],
          date_saisie: new Date().toISOString().split("T")[0],
          items: facItems, total_ht: Math.round(total_ht * 100) / 100,
          total_tva: Math.round(total_tva * 100) / 100,
          total_ttc: Math.round((total_ht + total_tva) * 100) / 100,
          discrepancies, has_discrepancies: discrepancies.length > 0,
          payment_status: "non_payee", ferme: ferme || bdc.ferme || "",
          created_by: created_by || {},
          scan_url: scan_url || null, scan_id: scan_id || null,
          history: [{ action: "creation", by: created_by || {}, at: now, comment: scan_id ? "Facture créée depuis scan" : "Facture saisie" }],
          created_at: now, updated_at: now,
        };
        const docRef = await db_firestore.collection("invoices").add(facData);

        // Update scan record if created from scan
        if (scan_id) {
          await db_firestore.collection("invoice_scans").doc(scan_id).update({ invoice_id: docRef.id, invoice_numero: numero, updated_at: now }).catch(() => {});
        }

        // Update BDC invoice_status
        const allFacSnap = await db_firestore.collection("invoices").where("bdc_id", "==", bdc_id).get();
        const totalFactured = allFacSnap.docs.reduce((sum, d) => sum + (d.data().total_ttc || 0), 0);
        const invoiceStatus = totalFactured >= (bdc.total_ttc || 0) ? "complet" : totalFactured > 0 ? "partiel" : "non_facture";
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ invoice_status: invoiceStatus, updated_at: now });

        return res.json({ success: true, id: docRef.id, numero, has_discrepancies: discrepancies.length > 0, discrepancies });
      }

      if (action === "validate-facture" && req.method === "POST") {
        const { id, decision, step, comment, validated_by } = req.body;
        if (!id || !decision || !step) return res.status(400).json({ success: false, error: "ID, décision et étape requis" });

        const doc = await db_firestore.collection("invoices").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Facture non trouvée" });
        const fac = doc.data();

        // Workflow: non_payee -> en_validation -> validee_achats -> validee_finance -> validee_dg -> payee
        const transitions = {
          "submit": { from: "non_payee", to: "en_validation" },
          "achats": { from: "en_validation", to: "validee_achats" },
          "finance": { from: "validee_achats", to: "validee_finance" },
          "dg": { from: "validee_finance", to: "validee_dg" },
          "pay": { from: "validee_dg", to: "payee" },
        };
        const t = transitions[step];
        if (!t) return res.status(400).json({ success: false, error: "Étape invalide" });

        if (decision === "rejete") {
          const now = Date.now();
          await db_firestore.collection("invoices").doc(id).update({
            payment_status: "non_payee", updated_at: now,
            history: [...(fac.history || []), { action: "rejet_" + step, by: validated_by || {}, at: now, comment: comment || "Rejeté" }],
          });
          return res.json({ success: true, status: "non_payee" });
        }

        if (fac.payment_status !== t.from) {
          return res.status(400).json({ success: false, error: `Statut actuel "${fac.payment_status}" incompatible avec l'étape "${step}" (attendu: "${t.from}")` });
        }

        const now = Date.now();
        const updateData = {
          payment_status: t.to, updated_at: now,
          history: [...(fac.history || []), { action: step + "_validation", by: validated_by || {}, at: now, comment: comment || `Validé (${step})` }],
        };
        if (step === "achats") updateData.validated_by_achats = validated_by;
        if (step === "finance") updateData.validated_by_finance = validated_by;
        if (step === "dg") updateData.validated_by_dg = validated_by;
        if (step === "pay") updateData.paid_at = now;

        await db_firestore.collection("invoices").doc(id).update(updateData);
        return res.json({ success: true, status: t.to });
      }

      // ========== CONSUMPTION VOUCHERS (BONS DE CONSOMMATION) ==========

      if (action === "list-bc") {
        const limit = parseInt(req.query.limit || "200");
        const type = req.query.type; // "engrais" or "pesticide"
        const ferme = req.query.ferme;
        let query = db_firestore.collection("consumption_vouchers").orderBy("created_at", "desc").limit(limit);
        if (type) query = query.where("type", "==", type);
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        // Les bons soft-deleted (`delete-bc`) sortent de la liste : sans ce
        // filtre, un doublon supprimé resterait affiché, mouvements annulés.
        const bcs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((bc) => bc.deleted !== true);
        return res.json({ success: true, bcs });
      }

      if (action === "create-bc" && req.method === "POST") {
        const { date, authorized_by, items, scan_url, created_by } = req.body;
        // `type` est une DÉCLARATION D'INTENTION du magasinier : il ne pilote
        // PLUS la classification analytique, qui vient désormais de la fiche
        // catalogue de chaque ARTICLE (functions/lib/consoBons). L'onglet
        // « Tous » n'a pas de type ; plutôt qu'un repli MUET côté client
        // (`type || 'engrais'`, qui a produit 48 bons /48 en engrais et un
        // onglet Pesticides structurellement vide), le défaut est posé ICI,
        // explicitement et en un seul endroit.
        const type = String(req.body.type || "").trim() || "engrais";
        if (!items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: items[]" });
        }
        if (!["engrais", "pesticide"].includes(type)) {
          return res.status(400).json({ success: false, error: "Type invalide (engrais|pesticide)" });
        }
        for (const it of items) {
          if (!it.parcelle) return res.status(400).json({ success: false, error: "Parcelle requise pour chaque article" });
        }

        // --- GROUPES DE PARCELLES : éclatement au prorata des Ha ---
        // Un item saisi sur un « groupe » (parcelle combinée) est remplacé par N
        // lignes de parcelles RÉELLES, quantités au prorata du `ha` de
        // sb_parcelle_referentiel (Σ des parts == quantité saisie, exactement).
        // Le libellé de groupe n'est JAMAIS persisté comme parcelle : toute la
        // jointure aval (analytique, coût/Ha, Mapping Conso) se fait par égalité
        // de chaîne sur le libellé de parcelle réel.
        let bcSourceItems = items;
        if (items.some((it) => it && it.groupe_id)) {
          const [grpSnapBc, refSnapBc] = await Promise.all([
            db_firestore.collection("sb_parcelle_groupes").get(),
            db_firestore.collection("sb_parcelle_referentiel").get(),
          ]);
          const haByLabelBc = {};
          refSnapBc.forEach((doc) => {
            const d = doc.data() || {};
            const lbl = (d.label_bee_one || doc.id || "").toUpperCase().trim();
            if (lbl) haByLabelBc[lbl] = parseFloat(d.ha) || 0;
          });
          const groupesById = {};
          grpSnapBc.forEach((doc) => {
            const d = doc.data() || {};
            if (d.actif === false) return; // soft delete : groupe inutilisable en saisie
            groupesById[doc.id] = {
              id: doc.id,
              label: d.label || doc.id,
              // Ha relus À CHAQUE SAISIE (jamais figés dans le groupe) : une
              // correction de Ha dans le Référentiel se propage immédiatement.
              membres: (d.membres || []).map((lbl) => ({
                label: lbl,
                ha: haByLabelBc[(lbl || "").toUpperCase().trim()] || 0,
              })),
            };
          });
          try {
            bcSourceItems = parcelleGroupSplit.expandItems(items, groupesById);
          } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
          }
        }

        const bcItemsSaisis = bcSourceItems.map((it) => ({
          article: it.article || "", quantite: parseFloat(it.quantite) || 0, unite: it.unite || "kg",
          parcelle: it.parcelle || "", culture: it.culture || "", ferme: it.ferme || "",
          // parcelle_ref : clé stable BEE ONE envoyée par le front, jusqu'ici
          // droppée par ce mapping. groupe_id/groupe_label : traçabilité de la
          // saisie combinée (vides pour une saisie parcelle simple).
          parcelle_ref: it.parcelle_ref || "",
          groupe_id: it.groupe_id || "", groupe_label: it.groupe_label || "",
        }));

        // --- CONVERSION D'UNITÉ (lib/uniteConso) ---------------------------
        // Mesuré en production : 87 lignes sur 648 sont saisies dans une unité
        // qui n'est PAS celle où le stock est tenu (Acide Nitrique acheté au KG,
        // dosé au L). Jusqu'ici le système retirait « 5 L » d'un solde en kilos.
        // La quantité DÉDUITE est donc désormais convertie vers l'unité de
        // stock quand la fiche article porte `unite_consommation` +
        // `stock_par_unite_consommation` (« 1 L = 1,32 KG »).
        //
        // ⚠️ PORTÉE STRICTEMENT LIMITÉE AU SOLDE DE STOCK. La VALORISATION
        // (lib/consoBons/bonsToConsoRows.js → lib/valorisation/consoValorisation.js)
        // lit toujours la quantité SAISIE et la multiplie par un PMP exprimé
        // dans l'unité de stock : pour 5 L d'acide nitrique, le solde est juste
        // mais le coût reste sous-estimé de 32 %. Chantier séparé, au backlog
        // (validé par Omar) — ne pas lire ce bloc comme si le coût suivait.
        //
        // FAIL-CLOSED, et sans blocage (décision d'Omar) : sans conversion
        // exploitable, la ligne est déduite TELLE QUELLE — comportement
        // strictement identique à avant — mais marquée `conversion_manquante`
        // et remontée dans `lignes_non_convertibles`, pour être signalée au
        // magasinier et rester repérable après coup. Aucun facteur n'est
        // deviné : une densité est propre au produit.
        //
        // ⚠️ Le catalogue est désormais lu ENTIER (le `where active == true` a
        // sauté) pour un SEUL usage supplémentaire : l'index d'IDENTITÉ, qui
        // doit voir les fiches désactivées par une fusion pour suivre leur
        // chaîne `merged_into`. Toujours UNE lecture — c'est le branchement le
        // moins coûteux du dépôt, le catalogue était déjà sur ce chemin
        // critique. La conversion d'unité, elle, continue de ne voir QUE les
        // fiches actives : son comportement est strictement inchangé.
        const bcCatalogSnap = await db_firestore.collection("articles_catalog").get();
        const bcCatalogDocs = bcCatalogSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // `active === true` STRICTEMENT, pas `!== false` : la requête d'avant
        // (`where("active","==",true)`) excluait les documents SANS champ
        // `active` — les 5 fantômes de production. Le filtre mémoire doit
        // rendre exactement le même ensemble, sinon ce lot changerait la
        // conversion d'unité par effet de bord.
        const bcIndexUnites = uniteConso.indexerArticles(bcCatalogDocs.filter((a) => a.active === true));
        const bcIndexIdentite = identiteArticle.indexerFiches(bcCatalogDocs);
        const bcConversion = uniteConso.analyserLignes(bcItemsSaisis, bcIndexUnites);
        const bcItems = bcItemsSaisis.map((it, i) => {
          const v = bcConversion.lignes[i];
          // Le bon conserve la saisie du magasinier (`quantite`/`unite`) : c'est
          // ce qui est écrit sur le bon papier. La quantité en unité de stock
          // est AJOUTÉE à côté, jamais substituée.
          return Object.assign({}, it, {
            unite_stock: v.converti ? v.unite_stock : it.unite,
            quantite_stock: v.converti ? v.quantite_stock : it.quantite,
            conversion_facteur: v.facteur,
            conversion_appliquee: v.converti,
            conversion_manquante: !v.convertible,
            conversion_motif: v.convertible ? "" : v.motif,
          });
        });
        // --- IDENTITÉ D'ARTICLE (lib/stock/identiteArticle) ----------------
        // Résolution AVANT `getNextNumber` et avant toute écriture : un bon
        // refusé ne doit consommer ni numéro de séquence, ni document.
        // FAIL-CLOSED (décision d'Omar) : un article inconnu ou ambigu fait
        // échouer le bon, en le nommant.
        //
        // Le BON, lui, garde le libellé dans `items[].article` : c'est ce qui
        // est écrit sur le papier. Seules les LIGNES DE STOCK reçoivent
        // l'identité, via cette table.
        const bcResolution = identiteArticle.resoudreLignes(
          bcItems.map((it) => ({ article: it.article })),
          bcIndexIdentite
        );
        if (!bcResolution.ok) {
          // Même sortie que create-movement : le refus ouvre la demande.
          const bcDemandes = await enregistrerDemandesCreation(
            db_firestore,
            bcResolution.refus.details,
            { uid: authUser.uid, profileId: (created_by || {}).profileId || "", name: (created_by || {}).name || "" },
            { origine: "create-bc", type: type || "", numero: "" }
          );
          return res.status(400).json({
            success: false,
            error: demandeCreationArticle.messageRefus(bcResolution.refus.details, bcDemandes),
            code: bcResolution.refus.code,
            demandes_creation: bcDemandes,
          });
        }
        // Table construite par le CONSTRUCTEUR de Map, jamais par mutation :
        // le cliquet createBcDoublonsWiring interdit toute forme d'écriture
        // avant le refus de doublon, pour prouver qu'un bon refusé n'écrit
        // rien. Il lit le source brut et ne peut pas distinguer une mutation
        // mémoire d'une écriture Firestore — l'affaiblir pour lui plaire serait
        // exactement le mauvais arbitrage.
        const bcFicheParArticle = new Map(
          bcItems.map((it, i) => [it.article || "", bcResolution.lignes[i].article_ref])
        );

        const allParcelles = [...new Set(bcItems.map(i => i.parcelle).filter(Boolean))];
        const allFermes = [...new Set(bcItems.map(i => i.ferme).filter(Boolean))];
        // Date résolue UNE fois : le bon et ses mouvements de stock doivent
        // porter la même (deux `new Date()` peuvent enjamber minuit).
        const bcDateValue = date || new Date().toISOString().split("T")[0];

        // --- GARDE ANTI-DOUBLON (lib/stock/bcDoublons) ---
        // Le magasinier soumet deux fois le même scan : mesuré 2 fois sur 49
        // bons en production (BC-2026-0032/0033, BC-2026-0039/0040), à 23 et 29
        // secondes d'intervalle, avec le MÊME `scan_url`. On bloque, on nomme le
        // bon existant, et le magasinier peut forcer — le forçage est tracé.
        //
        // Fenêtre BORNÉE aux 200 bons les plus récents, comme `scan-bc` : un
        // scan complet de l'historique à chaque création se dégraderait avec le
        // temps. Comparaison faite APRÈS l'éclatement des groupes de parcelles,
        // sur les items tels qu'ils seront persistés, et AVANT `getNextNumber` —
        // un bon refusé ne doit pas consommer de numéro de séquence.
        const bcRecentsSnap = await db_firestore.collection("consumption_vouchers")
          .orderBy("created_at", "desc").limit(200).get();
        const bcRecents = bcRecentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const bcVerdict = bcDoublons.detecterDoublon(
          { scan_url: scan_url || null, date: bcDateValue, items: bcItems },
          bcRecents
        );
        const bcForceDemande = bcDoublons.forcageDemande(req.body && req.body.force_doublon);
        if (bcVerdict.doublon && !bcForceDemande) {
          return res.status(409).json({
            success: false,
            error: bcVerdict.message,
            doublon: {
              motif: bcVerdict.motif,
              bon_id: bcVerdict.bon_id,
              bon_numero: bcVerdict.bon_numero,
            },
          });
        }
        // Trace du forçage : construite SERVEUR à partir du token
        // (resolveCallerRole), JAMAIS d'une identité lue dans le body.
        let bcForceTrace = null;
        if (bcVerdict.doublon && bcForceDemande) {
          const bcForceRole = await resolveCallerRole(authUser);
          bcForceTrace = bcDoublons.construireTraceForcage({
            verdict: bcVerdict,
            by: {
              uid: (authUser && authUser.uid) || "",
              profileId: bcForceRole || "",
              name: (authUser && (authUser.name || authUser.email)) || "",
            },
            at: Date.now(),
          });
        }

        const numero = await getNextNumber("consumption_voucher", "BC");
        const bcData = {
          numero, type,
          parcelle: allParcelles.join(", "), culture: "", ferme: allFermes.join(", "),
          date: bcDateValue,
          // motif : champ « Motif » du bon papier (ex. « Fertigation/Traitement »),
          // lu par le scan et éditable côté front. Ajout PUREMENT ADDITIF et
          // OPTIONNEL : aucune validation, absent du body -> "" (comportement
          // strictement identique à avant pour tous les appelants existants).
          motif: typeof req.body.motif === "string" ? req.body.motif.trim() : "",
          authorized_by: authorized_by || {},
          items: bcItems,
          cpc_categorie: type === "engrais" ? "Engrais" : "Pesticides",
          scan_url: scan_url || null,
          created_by: created_by || {},
          created_at: Date.now(),
          // Trace du forçage d'un doublon détecté (null si aucun forçage) : qui,
          // quand, quel bon était jugé doublon, et pour quel motif.
          // Lignes dont l'unité de saisie diffère de l'unité de stock SANS
          // conversion exploitable sur la fiche : déduites telles quelles, mais
          // consignées ici pour rester repérables après coup (même esprit que
          // les « articles non valorisés » de l'écran Campagne). Vide dans le
          // cas normal.
          lignes_non_convertibles: bcConversion.non_convertibles,
          doublon_force: bcForceTrace,
          history: bcForceTrace
            ? [{ action: bcDoublons.HISTORY_ACTION_FORCAGE, by: bcForceTrace.by, at: bcForceTrace.at, motif: bcForceTrace.motif, bon_doublon_numero: bcForceTrace.bon_doublon_numero }]
            : [],
        };
        const docRef = await db_firestore.collection("consumption_vouchers").add(bcData);

        // Create stock_movements grouped by parcelle + update stock_balances
        // Identité créateur : userId = uid du TOKEN (anti-spoof), profileId/name
        // conservés. Cf. stockMovementGuard.
        const bcCreatedBy = { ...(created_by || {}), userId: authUser.uid };
        const lieuSource = req.body.lieu_source || { type: "magasin", id: allFermes[0] || "F1" };
        const validBcItems = bcItems.filter((it) => it.quantite > 0);
        const itemsByParcelle = {};
        for (const it of validBcItems) {
          const key = it.parcelle || "unknown";
          if (!itemsByParcelle[key]) itemsByParcelle[key] = [];
          itemsByParcelle[key].push(it);
        }
        for (const [parcelle, parcItems] of Object.entries(itemsByParcelle)) {
          const bcsNumero = await getNextNumber("stock_consommation", "BCS");
          // Le MOUVEMENT de stock (et donc le solde) est en unité de STOCK :
          // c'est tout l'objet du ticket. Une ligne sans conversion exploitable
          // garde sa quantité et son unité de saisie — comportement d'avant —
          // et porte `conversion_manquante` pour rester repérable.
          const bcsItems = parcItems.map((it) => ({
            // IDENTITÉ = docId de fiche (résolu plus haut) ; le libellé saisi
            // reste dans `article_nom`.
            article_ref: bcFicheParArticle.get(it.article || "") || "",
            article_nom: it.article || "",
            quantite: it.conversion_appliquee ? it.quantite_stock : (it.quantite || 0),
            unite: it.conversion_appliquee ? it.unite_stock : (it.unite || "kg"),
            quantite_saisie: it.quantite || 0,
            unite_saisie: it.unite || "kg",
            conversion_facteur: it.conversion_facteur === undefined ? null : it.conversion_facteur,
            conversion_appliquee: !!it.conversion_appliquee,
            conversion_manquante: !!it.conversion_manquante,
          }));
          const movData = {
            numero: bcsNumero, type: "consommation",
            date: bcDateValue,
            lieu_source: lieuSource,
            lieu_destination: { type: "parcelle", id: parcelle },
            ferme: parcItems[0]?.ferme || "", items: bcsItems,
            ref_bl_fournisseur: "", bdc_id: null, bl_id: null,
            reception_libre: false, reception_libre_motif: "",
            ref_bon_physique: req.body.ref_bon_physique || "",
            sortie_type: null, scan_url: null,
            status: "valide_mag",
            validations: { magasinier: { by: bcCreatedBy.userId || "", name: bcCreatedBy.name || "", at: Date.now() } },
            rejection: null, created_by: bcCreatedBy,
            created_at: Date.now(), updated_at: Date.now(),
            bc_id: docRef.id, bc_numero: numero,
          };
          await db_firestore.collection("stock_movements").add(movData);
          const balPromises = bcsItems.map((it) =>
            updateStockBalance(lieuSource.type, lieuSource.id, it.article_ref, it.article_nom, it.unite, -it.quantite)
          );
          await Promise.all(balPromises);
        }

        // `lignes_non_convertibles` est renvoyé pour que l'écran de saisie le
        // dise TOUT DE SUITE au magasinier, en nommant l'article et les deux
        // unités : le bon est créé, mais la déduction s'est faite dans l'unité
        // de saisie faute de conversion sur la fiche.
        return res.json({
          success: true, id: docRef.id, numero,
          lignes_non_convertibles: bcConversion.non_convertibles,
        });
      }

      // ========== MODIFICATION DE LA DATE D'UN BON DE CONSOMMATION ==========
      // Périmètre volontairement étroit (ticket sb/bc-modifier-date) : LA DATE,
      // et rien d'autre. Articles/quantités/parcelles restent immuables — les
      // toucher obligerait à recalculer des soldes de stock déjà décrémentés.
      //
      // POINT CRITIQUE : un bon porte une date ET les `stock_movements` créés
      // par `create-bc` (type consommation, BCS-…) en portent une COPIE. Ce sont
      // ces mouvements que lisent les analyses par période. Les deux sont donc
      // mis à jour dans la MÊME transaction — jamais l'un sans l'autre.
      // Logique pure (validation, campagne, patch) : lib/stock/bcDate.js.
      if (action === "update-bc-date" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        const bcDateRole = await resolveCallerRole(authUser);
        if (bcDateRole !== "magasinier" && bcDateRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const bcDateId = req.body && req.body.bc_id;
        const bcNewDate = req.body && req.body.date;
        if (!bcDateId || typeof bcDateId !== "string") {
          return res.status(400).json({ success: false, error: "bc_id requis" });
        }
        // Date du jour calculée SERVEUR (Africa/Casablanca) — jamais l'horloge client.
        const bcDateCheck = bcDate.validateBcDate(bcNewDate, stockFilesRecord.todayInCasablanca());
        if (!bcDateCheck.valid) {
          return res.status(400).json({ success: false, error: bcDateCheck.error });
        }

        const bcDateActor = {
          uid: authUser.uid || "",
          profileId: bcDateRole || "",
          name: authUser.name || authUser.email || "",
        };
        const bcDateRef = db_firestore.collection("consumption_vouchers").doc(bcDateId);
        const bcDateMovQuery = db_firestore.collection("stock_movements").where("bc_id", "==", bcDateId);

        const bcDateResult = await db_firestore.runTransaction(async (tx) => {
          // Toutes les lectures AVANT toute écriture (contrainte Firestore).
          const bcSnap = await tx.get(bcDateRef);
          if (!bcSnap.exists) return { notFound: true };
          const movSnap = await tx.get(bcDateMovQuery);

          const before = bcSnap.data() || {};
          const patch = bcDate.buildDateUpdate({
            bc: before, date: bcNewDate, by: bcDateActor, at: Date.now(),
          });
          tx.update(bcDateRef, patch.bcUpdate);
          movSnap.docs.forEach((d) => tx.update(d.ref, patch.movementUpdate));
          return {
            notFound: false,
            date_avant: before.date || "",
            movements_updated: movSnap.size,
            campagne: bcDate.campagneChange(before.date, bcNewDate),
          };
        });

        if (bcDateResult.notFound) {
          return res.status(404).json({ success: false, error: "Bon de consommation introuvable" });
        }
        return res.json({
          success: true,
          date: bcNewDate,
          date_avant: bcDateResult.date_avant,
          movements_updated: bcDateResult.movements_updated,
          campagne_changed: bcDateResult.campagne.changed,
          campagne_avant: bcDateResult.campagne.from,
          campagne_apres: bcDateResult.campagne.to,
        });
      }

      // ========== SUPPRESSION D'UN BON DE CONSOMMATION ==========
      // Il n'existait AUCUNE suppression de bon de consommation. Une suppression
      // brute serait pire que rien : `create-bc` décrémente `stock_balances` au
      // moment même de la création (mouvements BCS-…, type consommation, en
      // `valide_mag`). Effacer le bon seul laisserait la consommation déduite
      // pour toujours — le bon disparaît, le stock reste amputé.
      //
      // On suit donc la mécanique éprouvée de `delete-movement` : soft-delete
      // (jamais de destruction) + `reverseStockImpact` sur les mouvements dont
      // l'impact était matérialisé. Logique pure : lib/stock/bcSuppression.
      if (action === "delete-bc" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        // `achats`, `dg` ou `magasinier` (stockRoles) : celui qui saisit le bon
        // est celui qui repère son doublon, il doit pouvoir le défaire.
        // Le serveur ne valide QUE le rôle et le motif : la double confirmation
        // du magasinier est une protection d'interface (MagBCTab.jsx), il n'y a
        // volontairement AUCUN drapeau client à vérifier ici.
        const bcDelRole = await resolveCallerRole(authUser);
        const bcDelId = req.body && req.body.bc_id;
        const bcDelRef = bcDelId && typeof bcDelId === "string"
          ? db_firestore.collection("consumption_vouchers").doc(bcDelId) : null;
        const bcDelSnap = bcDelRef ? await bcDelRef.get() : null;
        const bcDelDoc = bcDelSnap && bcDelSnap.exists ? bcDelSnap.data() : null;

        const bcDelCheck = bcSuppression.validerSuppression({
          role: bcDelRole,
          motif: req.body && req.body.motif,
          bc: bcDelDoc,
          exists: !!bcDelDoc,
        });
        if (!bcDelCheck.ok) {
          return res.status(bcDelCheck.code).json({ success: false, error: bcDelCheck.error });
        }

        const bcDelActor = {
          uid: (authUser && authUser.uid) || "",
          profileId: bcDelRole || "",
          name: (authUser && (authUser.name || authUser.email)) || "",
        };
        const bcDelMovSnap = await db_firestore.collection("stock_movements")
          .where("bc_id", "==", bcDelId).get();
        const bcDelMovs = bcDelMovSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
        const bcDelTri = bcSuppression.trierMouvements(bcDelMovs);
        const bcDelPatch = bcSuppression.buildSuppressionUpdate({
          bc: bcDelDoc, motif: bcDelCheck.motif, by: bcDelActor, at: Date.now(),
        });

        // 1) Annuler l'impact stock AVANT le soft-delete (le mouvement est encore
        //    dans son état impactant ; reverseStockImpact applique l'inverse exact
        //    de applyStockImpact). Un mouvement déjà supprimé est ignoré par
        //    trierMouvements : le re-créditer serait un double comptage.
        for (const mov of bcDelTri.aAnnuler) {
          await reverseStockImpact(mov);
        }
        // 2) Puis marquer les mouvements, puis le bon.
        for (const mov of bcDelTri.aMarquer) {
          await mov.ref.update(bcDelPatch.movementUpdate);
        }
        await bcDelRef.update(bcDelPatch.bcUpdate);

        return res.json({
          success: true,
          id: bcDelId,
          numero: (bcDelDoc && bcDelDoc.numero) || "",
          movements_deleted: bcDelTri.aMarquer.length,
          movements_reversed: bcDelTri.aAnnuler.length,
        });
      }

      // ========== STOCK DASHBOARD ==========

      if (action === "stock-dashboard") {
        const result = await withCache("stock_dashboard", 2 * 60 * 1000, async () => {
          const [bdcSnap, facSnap, bcSnap2, blSnap2] = await Promise.all([
            db_firestore.collection("purchase_orders").get(),
            db_firestore.collection("invoices").get(),
            db_firestore.collection("consumption_vouchers").get(),
            db_firestore.collection("delivery_notes").get(),
          ]);

          const bdcs = bdcSnap.docs.map((d) => d.data());
          const factures = facSnap.docs.map((d) => d.data());

          const bdcEnCours = bdcs.filter((b) => !["rejete", "envoye"].includes(b.status)).length;
          const bdcEnAttente = bdcs.filter((b) => b.status?.startsWith("en_attente")).length;
          const totalBdcTTC = bdcs.filter((b) => b.status !== "rejete").reduce((s, b) => s + (b.total_ttc || 0), 0);

          const facturesNonPayees = factures.filter((f) => f.payment_status !== "payee").length;
          const totalFacturesTTC = factures.reduce((s, f) => s + (f.total_ttc || 0), 0);
          const facturesAvecEcarts = factures.filter((f) => f.has_discrepancies).length;

          const pipelinePaiement = {
            non_payee: factures.filter((f) => f.payment_status === "non_payee").length,
            en_validation: factures.filter((f) => f.payment_status === "en_validation").length,
            validee_achats: factures.filter((f) => f.payment_status === "validee_achats").length,
            validee_finance: factures.filter((f) => f.payment_status === "validee_finance").length,
            validee_dg: factures.filter((f) => f.payment_status === "validee_dg").length,
            payee: factures.filter((f) => f.payment_status === "payee").length,
          };

          return {
            success: true,
            kpis: {
              bdc_en_cours: bdcEnCours, bdc_en_attente: bdcEnAttente,
              total_bdc_ttc: Math.round(totalBdcTTC * 100) / 100,
              factures_non_payees: facturesNonPayees,
              total_factures_ttc: Math.round(totalFacturesTTC * 100) / 100,
              factures_avec_ecarts: facturesAvecEcarts,
              pipeline_paiement: pipelinePaiement,
              nb_bl: blSnap2.size, nb_bc: bcSnap2.size,
            },
          };
        });
        return res.json(result);
      }

      if (action === "pending-validations") {
        const role = req.query.role;
        const ferme = req.query.ferme;
        const results = { bdc: [], factures: [] };

        if (role === "chef" && ferme) {
          const snap = await db_firestore.collection("purchase_orders").where("status", "==", "en_attente_chef").where("ferme", "==", ferme).get();
          results.bdc = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "dg") {
          const bdcSnap = await db_firestore.collection("purchase_orders").where("status", "==", "en_attente_dg").get();
          results.bdc = bdcSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "validee_finance").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "finance") {
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "validee_achats").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "achats") {
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "en_validation").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        return res.json({ success: true, ...results });
      }

      // ========== IMPORT FOURNISSEURS DEPUIS SQL ==========

      if (action === "import-fournisseurs-sql" && req.method === "POST") {
        const { imported_by } = req.body || {};
        const db = await getPool();

        // Phase 1 : Découverte des colonnes réelles de BR_Achat
        const schemaRes = await db.request()
          .input("tbl", getSql().NVarChar, "BR_Achat")
          .query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_NAME = @tbl ORDER BY ORDINAL_POSITION`);

        if (schemaRes.recordset.length === 0) {
          return res.status(404).json({ success: false, error: "Table BR_Achat introuvable dans SQL Server" });
        }

        const actualCols = schemaRes.recordset.map(r => r.COLUMN_NAME);
        const colsLower = actualCols.map(c => c.toLowerCase());

        const findCol = (...candidates) => {
          for (const c of candidates) {
            const idx = colsLower.indexOf(c.toLowerCase());
            if (idx !== -1) return actualCols[idx];
          }
          return null;
        };

        // Phase 2 : Mapping colonnes → champs Firestore
        const nomCol       = findCol("Fournisseur", "NomFournisseur", "Nom_Fournisseur", "Nom", "RaisonSociale");
        const iceCol       = findCol("ICE", "Ice", "NumICE", "Num_ICE", "CodeFisc");
        const adresseCol   = findCol("Adresse", "Adress", "Address");
        const villeCol     = findCol("Ville", "City", "Localite");
        const telCol       = findCol("Tel", "Telephone", "Phone", "GSM", "Mobile");
        const emailCol     = findCol("Email", "Mail");
        const contactCol   = findCol("Contact", "NomContact", "Nom_Contact", "Interlocuteur");
        const categorieCol = findCol("Categorie", "TypeFournisseur", "Famille", "Type");

        if (!nomCol) {
          return res.status(422).json({
            success: false,
            error: "Colonne Nom/Fournisseur introuvable dans BR_Achat",
            columns_found: actualCols,
          });
        }

        // Phase 3 : SELECT fournisseurs distincts avec normalisation et exclusions
        // - Exclus : fermes (F-01/F-02/F-05), entrées internes (INVENTAIRE, STOCK INITIAL, INV-*)
        // - Normalisé : variantes HAROUACH → "STE AGRI HAROUACH", AGRIVIVOS → "STÉ AGRIVIVOS", TIMAC → "TIMAC AGRO MAROC"
        // - Catégorie inférée depuis Article_Categorie le plus fréquent
        const hasArchive = colsLower.includes("is_archive");
        const archiveFilter = hasArchive ? "AND is_archive = 0" : "";
        const hasCatCol = colsLower.includes("article_categorie");

        const sqlQuery = `
          WITH normalized AS (
            SELECT
              CASE
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) LIKE '%HAROUACH%' THEN 'STE AGRI HAROUACH'
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) LIKE '%AGRIVIVOS%' THEN 'STÉ AGRIVIVOS'
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) = 'TIMAC' THEN 'TIMAC AGRO MAROC'
                ELSE LTRIM(RTRIM([${nomCol}]))
              END AS nom,
              ${hasCatCol ? "[Article_Categorie]" : "NULL AS Article_Categorie"}
            FROM BR_Achat
            WHERE [${nomCol}] IS NOT NULL
              AND LEN(LTRIM(RTRIM([${nomCol}]))) > 0
              AND UPPER(LTRIM(RTRIM([${nomCol}]))) NOT IN (
                'INVENTAIRE','STOCK INITIAL','INV-291125',
                'F-01','F-02','F-02 AVOCAT','F-05'
              )
              AND UPPER(LTRIM(RTRIM([${nomCol}]))) NOT LIKE 'INV-%'
              ${archiveFilter}
          ),
          ${hasCatCol ? `
          cat_counts AS (
            SELECT nom, Article_Categorie,
              ROW_NUMBER() OVER (PARTITION BY nom ORDER BY COUNT(*) DESC) AS rn
            FROM normalized
            WHERE Article_Categorie IS NOT NULL
            GROUP BY nom, Article_Categorie
          ),` : ""}
          fournisseurs AS (
            SELECT DISTINCT nom FROM normalized
          )
          SELECT
            f.nom,
            NULL AS ice, NULL AS adresse, NULL AS ville,
            NULL AS tel, NULL AS email, NULL AS contact_nom,
            ${hasCatCol ? "cc.Article_Categorie AS categorie" : "NULL AS categorie"}
          FROM fournisseurs f
          ${hasCatCol ? "LEFT JOIN cat_counts cc ON f.nom = cc.nom AND cc.rn = 1" : ""}
          ORDER BY f.nom
        `;
        const sqlRows = (await db.request().query(sqlQuery)).recordset;

        // Phase 4 : Chargement Firestore pour déduplication
        const existingSnap = await db_firestore.collection("suppliers").get();
        const existingByIce = {}, existingByNom = {};
        existingSnap.docs.forEach(doc => {
          const d = doc.data();
          if (d.ice && d.ice.trim()) existingByIce[d.ice.trim().toLowerCase()] = doc.id;
          if (d.nom && d.nom.trim()) existingByNom[d.nom.trim().toLowerCase()] = doc.id;
        });

        // Phase 5 : Normalisation catégorie
        const CATS = ["engrais","phyto","emballage","materiel","semences","autre"];
        const normCat = (raw) => {
          if (!raw) return "autre";
          const v = String(raw).toLowerCase().trim();
          return CATS.find(c => v.includes(c)) || "autre";
        };

        // Phase 6 : Écriture Firestore en batch (chunks de 400)
        const now = Date.now();
        const importedBy = imported_by || { uid: "system", email: "import@sql", name: "Import SQL" };
        let imported = 0, skipped = 0;
        const skippedNames = [];
        let batch = db_firestore.batch(), batchCount = 0;

        for (const row of sqlRows) {
          const nom = (row.nom || "").toString().trim();
          const ice = (row.ice || "").toString().trim();
          if (!nom) { skipped++; continue; }
          const iceKey = ice ? ice.toLowerCase() : null;
          if ((iceKey && existingByIce[iceKey]) || existingByNom[nom.toLowerCase()]) {
            skipped++; skippedNames.push(nom); continue;
          }
          const docRef = db_firestore.collection("suppliers").doc();
          batch.set(docRef, {
            nom, ice: ice || "",
            adresse: (row.adresse || "").toString().trim(),
            ville: (row.ville || "").toString().trim(),
            tel: (row.tel || "").toString().trim(),
            email: (row.email || "").toString().trim(),
            contact_nom: (row.contact_nom || "").toString().trim(),
            categorie: normCat(row.categorie),
            status: "valide",
            active: true,
            created_by: importedBy,
            source: "sql_import",
            history: [{ action: "import_sql", by: importedBy, at: now,
              comment: "Importé automatiquement depuis BR_Achat (SQL Server)" }],
            created_at: now, updated_at: now,
          });
          batchCount++; imported++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();

        await db_firestore.collection("supplier_imports").add({
          type: "sql_import", source: "BR_Achat", imported_by: importedBy, imported_at: now,
          stats: { total_sql: sqlRows.length, imported, skipped },
          columns_mapped: { nomCol, iceCol, adresseCol, villeCol, telCol, emailCol, contactCol, categorieCol },
        });

        return res.json({
          success: true,
          stats: { total_found: sqlRows.length, imported, skipped, skipped_sample: skippedNames.slice(0, 10) },
          columns_mapped: { nomCol, iceCol, adresseCol, villeCol, telCol, emailCol, contactCol, categorieCol },
        });
      }

      // ========== IMPORT FOURNISSEURS DEPUIS EXCEL ==========

      if (action === "import-fournisseurs-xls" && req.method === "POST") {
        const { file_base64, imported_by, dry_run } = req.body || {};
        if (!file_base64) return res.status(400).json({ success: false, error: "Fichier Excel requis (file_base64)" });

        const XLSX = require("xlsx");
        const buffer = Buffer.from(file_base64, "base64");
        const wb = XLSX.read(buffer, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (rows.length < 2) return res.status(400).json({ success: false, error: "Fichier vide ou sans données" });

        // Normalisation des villes
        const VILLE_CORRECTIONS = {
          "CASA BLANCA": "CASABLANCA", "CIDI KACEM": "SIDI KACEM",
          "MOULAY": "MOULAY BOUSELHAM",
        };
        const normalizeVille = (v) => {
          const trimmed = (v || "").toString().trim().toUpperCase();
          return VILLE_CORRECTIONS[trimmed] || trimmed;
        };

        // Parse rows (skip header)
        const parsed = [];
        const warnings = [];
        const seenICE = {};

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const nom = (r[1] || "").toString().trim();
          if (!nom) { warnings.push(`Ligne ${i + 1}: nom vide, ignorée`); continue; }

          const code = (r[0] || "").toString().trim();
          const prenom = (r[3] || "").toString().trim();
          const civilite = (r[4] || "").toString().trim();
          const nomContact = (r[2] || "").toString().trim();
          const contactParts = [civilite, nomContact, prenom].filter(Boolean);
          const contact_nom = contactParts.join(" ");

          const ice = (r[12] || "").toString().trim();
          const identifiant_fiscal = (r[13] || "").toString().trim();
          const tel = (r[8] || "").toString().trim();
          const gsm = (r[9] || "").toString().trim();
          const email = (r[11] || "").toString().trim().toLowerCase();
          const adresse = (r[5] || "").toString().trim();
          const ville = normalizeVille(r[6]);

          // Détection ICE dupliqué dans le fichier
          if (ice) {
            if (seenICE[ice]) {
              warnings.push(`ICE dupliqué "${ice}" : "${nom}" (ligne ${i + 1}) et "${seenICE[ice].nom}" — ICE ignoré pour le second`);
              parsed.push({ code, nom, contact_nom, adresse, ville, tel, gsm, email, ice: "", identifiant_fiscal });
              continue;
            }
            seenICE[ice] = { nom, line: i + 1 };
          }

          parsed.push({ code, nom, contact_nom, adresse, ville, tel, gsm, email, ice, identifiant_fiscal });
        }

        // Déduplication avec Firestore existant
        const existingSnap = await db_firestore.collection("suppliers").get();
        const existingByIce = {}, existingByNom = {};
        existingSnap.docs.forEach(doc => {
          const d = doc.data();
          if (d.ice && d.ice.trim()) existingByIce[d.ice.trim().toLowerCase()] = { id: doc.id, nom: d.nom };
          if (d.nom && d.nom.trim()) existingByNom[d.nom.trim().toLowerCase()] = { id: doc.id, nom: d.nom };
        });

        const toImport = [], duplicates = [], incomplete = [];
        for (const row of parsed) {
          const iceKey = row.ice ? row.ice.toLowerCase() : null;
          const nomKey = row.nom.toLowerCase();
          if (iceKey && existingByIce[iceKey]) {
            duplicates.push({ ...row, reason: `ICE "${row.ice}" existe déjà (${existingByIce[iceKey].nom})` });
          } else if (existingByNom[nomKey]) {
            duplicates.push({ ...row, reason: `Nom "${row.nom}" existe déjà` });
          } else {
            toImport.push(row);
            if (!row.ice && !row.tel && !row.adresse) {
              incomplete.push(row.nom);
            }
          }
        }

        // Dry-run : retourner le rapport sans écrire
        if (dry_run) {
          return res.json({
            success: true, dry_run: true,
            stats: { total_fichier: parsed.length, a_importer: toImport.length, doublons: duplicates.length, incomplets: incomplete.length },
            duplicates: duplicates.map(d => ({ code: d.code, nom: d.nom, reason: d.reason })),
            incomplete,
            warnings,
            preview: toImport.slice(0, 10).map(r => ({ code: r.code, nom: r.nom, ville: r.ville, ice: r.ice })),
          });
        }

        // Écriture Firestore en batch
        const now = Date.now();
        const importedBy = imported_by || { uid: "system", email: "import@xls", name: "Import Excel" };
        let imported = 0;
        let batch = db_firestore.batch(), batchCount = 0;

        for (const row of toImport) {
          const docRef = db_firestore.collection("suppliers").doc();
          batch.set(docRef, {
            nom: row.nom, ice: row.ice, adresse: row.adresse, ville: row.ville,
            tel: row.tel, gsm: row.gsm, email: row.email,
            contact_nom: row.contact_nom,
            code_fournisseur: row.code,
            identifiant_fiscal: row.identifiant_fiscal,
            categorie: "autre",
            status: "valide",
            active: true,
            created_by: importedBy,
            source: "xls_import",
            history: [{ action: "import_xls", by: importedBy, at: now,
              comment: "Importé depuis fichier Excel (Les fournisseurs)" }],
            created_at: now, updated_at: now,
          });
          batchCount++; imported++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();

        await db_firestore.collection("supplier_imports").add({
          type: "xls_import", source: "fichier_excel", imported_by: importedBy, imported_at: now,
          stats: { total_fichier: parsed.length, imported, doublons: duplicates.length, incomplets: incomplete.length },
          warnings,
        });

        return res.json({
          success: true,
          stats: { total_fichier: parsed.length, imported, doublons: duplicates.length, incomplets: incomplete.length },
          duplicates: duplicates.map(d => ({ code: d.code, nom: d.nom, reason: d.reason })),
          warnings,
        });
      }

      // ========== CATALOGUE ARTICLES SQL ==========

      if (action === "import-articles-sql" && req.method === "POST") {
        const db = await getPool();
        const sqlRes = await db.request().query(`
          SELECT LTRIM(RTRIM(Article)) AS nom,
            Article_Categorie AS categorie,
            Article_Sous_Categorie AS sous_categorie,
            UPPER(LTRIM(RTRIM(Unite))) AS unite,
            AVG(NULLIF(Cout,0)/NULLIF(Quantite,0)) AS prix_ref,
            COUNT(*) AS nb_achats
          FROM BR_Achat
          WHERE is_archive=0 AND Article IS NOT NULL AND LEN(LTRIM(RTRIM(Article)))>0
            AND Article NOT IN ('INVENTAIRE','STOCK INITIAL')
            AND Article NOT LIKE 'INV-%'
          GROUP BY LTRIM(RTRIM(Article)), Article_Categorie, Article_Sous_Categorie, UPPER(LTRIM(RTRIM(Unite)))
          ORDER BY Article_Categorie, LTRIM(RTRIM(Article))
        `);
        const rows = sqlRes.recordset;
        const now = Date.now();
        let imported = 0, updated = 0;
        let batch = db_firestore.batch(), batchCount = 0;

        // Index de résolution construit UNE SEULE FOIS avant la boucle.
        // Remplace le get() par ligne qui était fait ici : 1 lecture de collection
        // au lieu de N lectures unitaires (et c'est ce qui rend la résolution par
        // nom possible sans dégrader l'import).
        const sqlCatalogSnap = await db_firestore.collection("articles_catalog").get();
        const sqlIndex = articleMerge.buildArticleIndex(
          sqlCatalogSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        );

        for (const row of rows) {
          const nom = (row.nom || "").trim();
          if (!nom) continue;
          // FORMULE D'IDENTIFIANT INCHANGÉE (categorie brute) : la normaliser ici
          // réétiquetterait toutes les fiches existantes et l'import suivant
          // recréerait une vague de doublons. On corrige la RÉSOLUTION, pas l'id.
          const docId = Buffer.from(`${nom}|${row.categorie || ""}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
          const target = articleMerge.resolveArticleTarget(sqlIndex, docId, nom);
          const data = {
            nom,
            // LIBELLÉ CANONIQUE à l'enregistrement (et NON la minuscule d'avant) :
            // la source SQL renvoie `engrais`/`pesticides`, qui repeuplaient le
            // catalogue de variantes à chaque réimport. La formule du docId,
            // elle, reste sur la catégorie BRUTE (cf. ci-dessus) : le réimport
            // retrouve donc la fiche et se contente de corriger son libellé.
            categorie: articleCategories.categorieCanonique(row.categorie),
            sous_categorie: row.sous_categorie || "",
            unite: row.unite || "KG",
            prix_ref: row.prix_ref ? Math.round(row.prix_ref * 100) / 100 : null,
            nb_achats: row.nb_achats || 0,
            source: "sql_import",
            active: true,
            updated_at: now,
          };
          const docRef = db_firestore.collection("articles_catalog").doc(target.id);
          // Un document EXISTE déjà à cet identifiant sans être résolu ? C'est une
          // fiche désactivée par `validate-delete-article` : ni active (donc hors
          // de byId/byName), ni fusionnée (donc pas de redirection merged_into).
          // Un `set()` la REMPLACERAIT — prix_pmp, nb_achats et created_at perdus,
          // et la valorisation de l'article tomberait à zéro. On met à jour, comme
          // le faisait le code d'origine sur `existSnap.exists`.
          const sqlReactivation = target.isNew && sqlIndex.allIds.has(target.id);
          if (!target.isNew || sqlReactivation) { batch.update(docRef, data); updated++; }
          else {
            batch.set(docRef, { ...data, created_at: now });
            imported++;
          }
          // La fiche écrite entre dans l'index : deux lignes du MÊME import ne
          // différant que par la casse de la catégorie convergent sur elle.
          if (target.isNew) articleMerge.rememberArticle(sqlIndex, target.id, nom);
          batchCount++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, stats: { total: rows.length, imported, updated } });
      }

      if (action === "import-articles-excel" && req.method === "POST") {
        const { articles } = req.body;
        if (!articles || !articles.length) return res.status(400).json({ success: false, error: "articles[] requis" });
        const now = Date.now();
        let imported = 0, updated = 0, skipped = 0;

        // Pre-fetch all existing articles in one query
        const existingSnap = await db_firestore.collection("articles_catalog").get();
        const existingMap = {};
        existingSnap.docs.forEach(d => { existingMap[d.id] = d.data(); });
        // Même index de résolution que l'import SQL : une fiche active de même
        // nom normalisé est MISE À JOUR, jamais dupliquée.
        const xlsIndex = articleMerge.buildArticleIndex(
          existingSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        );

        let batch = db_firestore.batch(), batchCount = 0;
        for (const art of articles) {
          const nom = (art.nom || "").trim();
          if (!nom) { skipped++; continue; }
          const ref = (art.reference || "").trim();
          // FORMULE D'IDENTIFIANT INCHANGÉE — cf. import-articles-sql.
          const docId = ref
            ? ref.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50)
            : Buffer.from(`${nom}|${art.categorie || ""}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
          const target = articleMerge.resolveArticleTarget(xlsIndex, docId, nom);
          const data = {
            nom, reference: ref,
            reference_technique: (art.reference_technique || "").trim(),
            // LIBELLÉ CANONIQUE — cf. import-articles-sql. C'est ce chemin qui a
            // posé `IMMOBILISATIONS` (11 fiches) et `PHYTO-SANITAIRE` (2).
            categorie: articleCategories.categorieCanonique(art.categorie),
            sous_categorie: (art.sous_categorie || "").trim(),
            unite: (art.unite || "U").trim(),
            prix_ht: art.prix_ht || 0, taux_tva: art.taux_tva || 0, prix_ttc: art.prix_ttc || 0,
            prix_ref: art.prix_ht || null,
            type_article: (art.type || "").trim(),
            invisible: art.invisible || 0, multi_ferme: art.multi_ferme || 0,
            source: "excel_import", active: true, updated_at: now,
          };
          // ⚠️ NE PAS écrire `reference` sur une fiche résolue par NOM (ou par
          // redirection) : son docId est celui d'une AUTRE fiche — souvent un
          // base64 issu de l'import SQL — et y poser la référence de la ligne
          // Excel fabriquerait un document où `docId !== reference`. Or
          // `suggest-article-duplicates` renvoie `data.reference || d.id` alors
          // que `merge-articles` résout par `doc(master_ref)` : la fusion depuis
          // l'écran Catalogue partirait en 404. C'est exactement l'invariant que
          // 5 fiches cassent déjà en prod (ex. AZO PRO : ENG0149 / « ENG 0149 »)
          // et que ce lot ne doit surtout pas propager.
          if (target.matchedBy === "nom" || target.matchedBy === "merged_into") delete data.reference;
          const docRef = db_firestore.collection("articles_catalog").doc(target.id);
          const existing = existingMap[target.id];
          // Même garde de résurrection que l'import SQL : un `set()` sur une fiche
          // désactivée la remplacerait (prix_ref, nb_achats, created_at perdus).
          const xlsReactivation = target.isNew && xlsIndex.allIds.has(target.id);
          if (!target.isNew || xlsReactivation) {
            if (data.prix_ht > 0 || !(existing && existing.prix_ref)) data.prix_ref = data.prix_ht || (existing && existing.prix_ref) || null;
            data.nb_achats = (existing && existing.nb_achats) || 0;
            batch.update(docRef, data);
            updated++;
          } else {
            batch.set(docRef, { ...data, nb_achats: 0, created_at: now });
            imported++;
          }
          if (target.isNew) articleMerge.rememberArticle(xlsIndex, target.id, nom);
          batchCount++;
          if (batchCount >= 450) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, stats: { total: articles.length, imported, updated, skipped } });
      }

      if (action === "list-articles") {
        const { categorie, q } = req.query;
        let query = db_firestore.collection("articles_catalog").where("active", "==", true);
        const snap = await query.get();
        let articles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (categorie) {
          const catLower = categorie.toLowerCase();
          articles = articles.filter(a => (a.categorie || "").toLowerCase() === catLower);
        }
        articles.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { sensitivity: "base" }));
        if (q) { const ql = q.toLowerCase(); articles = articles.filter(a => a.nom.toLowerCase().includes(ql)); }
        return res.json({ success: true, articles });
      }

      // --- CONSO VALORISÉE AU PMP (lecture seule) -------------------------
      // État CONSOMMATION par parcelle / Ha / famille (engrais|pesticide|autre),
      // VALORISÉE au PMP grand livre (articles_catalog.prix_pmp), depuis le
      // 01/07/2025. AUCUNE écriture, AUCUN recalcul du PMP : on lit le mirror
      // de conso + le PMP catalogue et on agrège en mémoire (module pur).
      // Périmètre = consommation SAISIE uniquement (plancher) — cf. bandeau UI.
      if (action === "conso-valorisee") {
        const DEFAULT_SINCE = "2025-07-01";
        // 0) CONTRÔLE D'ACCÈS — barrière sécurité. Le périmètre ferme est IMPOSÉ
        //    serveur via le profil de l'appelant (users/{uid}). Un Chef de Ferme
        //    est forcé sur SA ferme : tout param ?ferme= incompatible est ignoré.
        let callerProfile = {};
        if (authUser && authUser.uid && authUser.uid !== "admin-cli") {
          const uDoc = await db_firestore.collection("users").doc(authUser.uid).get();
          callerProfile = uDoc.exists ? (uDoc.data() || {}) : {};
        } else if (authUser && authUser.uid === "admin-cli") {
          // Accès CLI admin-secret : périmètre global.
          callerProfile = { profileId: "dg", role: "admin" };
        }
        const fermeDemandee = req.query.ferme;
        const perim = consoAccessControl.resolvePerimetre(callerProfile, fermeDemandee);
        if (!perim.autorise) {
          return res.status(403).json({ success: false, error: perim.error || "Accès non autorisé" });
        }
        // Périmètre vide (chef sans ferme résolue) : on renvoie un agrégat vide.
        if (perim.ferme_filtre === "__none__") {
          return res.json({
            success: true,
            role: perim.role,
            perimetre_ferme: perim.perimetre_ferme,
            perimetre_culture: perim.culture_filtre || null,
            parcelles_ferme_indeterminee: [],
            since: DEFAULT_SINCE,
            campagne: "2025/2026",
            dateExtraction: new Date().toLocaleDateString("fr-FR"),
            parcelles: [], par_ferme: [], par_culture: [],
            total: { total_engrais_mad: 0, total_pest_mad: 0, total_autre_mad: 0, total_mad: 0, nb_parcelles: 0 },
            couverture: { nb_articles_total: 0, nb_valorises: 0, pct_articles: 0, qte_totale: 0, qte_valorisee: 0, pct_quantite: 0 },
            articles_non_valorises: [],
          });
        }

        // 1) Filtres période + culture (paramètres optionnels).
        const since = (req.query.since && /^\d{4}-\d{2}-\d{2}$/.test(req.query.since)) ? req.query.since : DEFAULT_SINCE;
        const culture = req.query.culture && String(req.query.culture).trim() ? String(req.query.culture).trim() : undefined;
        // NOTE: on ne filtre PAS sur un champ Ferme de la source.
        // Dans le mirror BEE ONE il valait « BERRY GOOD Farms » sur 100 % des
        // lignes ; dans les bons Smart Berry, `item.ferme` porte cette même
        // valeur fourre-tout sur 212 items /500 (mesuré en prod). Inexploitable
        // dans les deux cas : la vraie ferme est encodée dans le libellé de
        // parcelle. Le cloisonnement chef se fait ci-dessous par dérivation
        // en mémoire, fail-closed — inchangé.

        // 2) Lignes de conso depuis les BONS SMART BERRY (`consumption_vouchers`).
        //    Bascule décidée par Omar (ticket sb/conso-campagne-bons) : la source
        //    BEE ONE `sql_mirror_consommation` est TARIE (dernières lignes en
        //    avril 2026), la consommation réelle est saisie dans les bons par le
        //    magasinier. Bons UNIQUEMENT : pas d'union avec BEE ONE, pas de
        //    bascule à une date. Conséquence ASSUMÉE : la période antérieure aux
        //    premiers bons s'affiche vide. Rien n'est supprimé côté BEE ONE, et
        //    `getConsommationRows` reste utilisé par les autres écrans
        //    (fertigation, phytosanitaire, produits, parcelles, dashboard,
        //    agroSummary, exports campagne).
        //    L'adaptateur produit exactement la forme de ligne mirror consommée
        //    par `aggregateConsoValorisee` — aucun changement en aval.
        const [bonsConso, refParcelles, catalogueDocs] = await Promise.all([
          consoBons.fetchBonsConsommation(db_firestore),
          consoBons.fetchReferentielParcelles(db_firestore),
          // UNE SEULE lecture d'`articles_catalog`, pour DEUX usages : le PMP
          // (§3 ci-dessous) et la catégorie par article. Cette lecture existait
          // déjà plus bas ; elle est simplement remontée ici. Ne pas la
          // dédoubler en appelant `consoBons.fetchArticleCategories`.
          db_firestore.collection("articles_catalog").get().then((snap) => {
            const out = [];
            snap.forEach((doc) => out.push(doc.data() || {}));
            return out;
          }),
        ]);
        // Index « nom d'article → catégorie ». La catégorie était jusqu'ici
        // JETÉE à la construction de la map PMP, et `Article_Categorie` valait
        // la catégorie du BON ENTIER — d'où BENEVIA compté en engrais.
        const catByArticle = consoBons.buildArticleCategoryIndex(catalogueDocs);
        let consoRows = consoBons.adaptBonsToConsoRows(bonsConso, {
          since,
          haByLabel: refParcelles.haByLabel,
          sbMap: refParcelles.sbMap,
          catByArticle,
        });
        // Filtre culture optionnel (param client), à l'identique de l'ancien
        // filtre `getConsommationRows({culture})` — mais sur la culture RÉSOLUE
        // (référentiel SB puis repli), et non sur le champ brut du bon, vide ou
        // sale sur la majorité des items.
        if (culture) {
          consoRows = consoRows.filter((r) => r.Culture === culture);
        }

        // Libellés dont la ferme est indéterminable — capturés AVANT tout filtre
        // de périmètre : après filtrage ils ont justement disparu, et la liste
        // serait systématiquement vide pour le seul profil que ça concerne.
        const fermeIndeterminee = consoBons.resolveFermeInconnue(
          consoRows.map((r) => r.Parcelle_Culturale)
        );

        // 2bis) Cloisonnement ferme FAIL-CLOSED pour un périmètre chef.
        //   perimetre_ferme === 'all' (DG/Finance/admin) → aucune restriction,
        //   y compris les parcelles non dérivables. Sinon (chef), on ne garde
        //   QUE les lignes dont la ferme dérivée du libellé == son périmètre.
        //   Une parcelle dérivée à null est EXCLUE (jamais montrée à un chef).
        //   Dérivation = `consoBons.fermeDeParcelle`, RÈGLE UNIQUE partagée avec
        //   l'écran Campagne. Elle compose `deriveFermeFromParcelle` (utilisée
        //   ici jusqu'ici) et le repli SECTEUR : sans ce repli, `chef_f5`
        //   perdait ses 2 parcelles S8 (BREEZE/CASCADE MYRTILLE, 40 lignes),
        //   dérivées à null par la seule règle valorisation.
        if (perim.perimetre_ferme !== 'all') {
          const cible = perim.perimetre_ferme;
          consoRows = consoRows.filter(
            (r) => consoBons.fermeDeParcelle(r.Parcelle_Culturale) === cible
          );
        }
        // 2ter) Cloisonnement CULTURE FAIL-CLOSED — barrière IMPOSÉE serveur.
        //   Sans elle, `chef_f1` (perimetre_ferme 'all' + culture_filtre
        //   'Framboise') échappait à TOUT filtrage : le bloc 2bis est sauté pour
        //   un périmètre 'all', et la culture n'était appliquée nulle part.
        //   Mesuré avant correction : `chef_f1` recevait les 500 lignes, dont 78
        //   d'Avocatier et 125 de F5-Myrtille. `chef_f5` voyait en plus les
        //   parcelles F5-Framboise. Le filtre porte sur la culture RÉSOLUE par
        //   l'adaptateur (référentiel `culture_sb` puis repli), jamais sur le
        //   champ brut du bon. C'est le pendant exact du filtre appliqué dans
        //   `aggregateConsoParcelle` pour l'écran Campagne.
        //   ⚠️ Distinct du `?culture=` client ci-dessus : celui-ci est un confort
        //   d'affichage, celui-là n'est pas négociable.
        if (perim.culture_filtre) {
          consoRows = consoRows.filter((r) => r.Culture === perim.culture_filtre);
        }
        // 3) Map de PMP par canon(nom) depuis articles_catalog, déjà lu ci-dessus.
        const canon = consoValorisationLib.canon;
        const pmpMap = {};
        catalogueDocs.forEach((a) => {
          if (!a.nom) return;
          const p = parseFloat(a.prix_pmp);
          if (!isFinite(p)) return;
          const key = canon(a.nom);
          // Garde l'entrée au prix_pmp le plus élevé si collision sur le canon
          // (préfère un vrai prix à un placeholder <=1).
          if (!pmpMap[key] || p > pmpMap[key].pmp) {
            pmpMap[key] = { pmp: p, source: a.prix_pmp_source || "pmp" };
          }
        });
        // 4) Agrégation pure.
        const agg = consoValorisationLib.aggregateConsoValorisee(consoRows, pmpMap);
        // Liste à plat des articles non valorisés (toutes parcelles), dédoublonnée.
        const nonValMap = {};
        for (const p of agg.parcelles) {
          for (const a of (p.articles_non_valorises || [])) {
            const k = canon(a.article) + "|" + (a.unite || "");
            if (!nonValMap[k]) nonValMap[k] = { article: a.article, unite: a.unite, famille: a.famille, source_prix: a.source_prix, quantite: 0 };
            nonValMap[k].quantite += a.quantite || 0;
          }
        }
        const articles_non_valorises = Object.values(nonValMap);
        return res.json({
          success: true,
          role: perim.role,
          perimetre_ferme: perim.perimetre_ferme,
          // Périmètre cultural IMPOSÉ (chef_f1 → Framboise, chef_f5 → Myrtille).
          // Additif : rend le cloisonnement lisible côté client au lieu de le
          // laisser deviner à partir d'un tableau incomplet.
          perimetre_culture: perim.culture_filtre || null,
          since,
          culture: culture || null,
          campagne: "2025/2026",
          dateExtraction: new Date().toLocaleDateString("fr-FR"),
          // Libellés dont la ferme est indéterminable : ils sont EXCLUS du
          // périmètre d'un chef (fail-closed). Remontés pour que l'écran puisse
          // le dire, plutôt que d'afficher un tableau vide sans explication.
          // Vide sur les 19 libellés réels d'aujourd'hui.
          parcelles_ferme_indeterminee: fermeIndeterminee,
          articles_non_valorises,
          ...agg,
        });
      }

      if (action === "update-article" && req.method === "POST") {
        const { id, updates, updated_by } = req.body;
        // Rôle résolu SERVEUR (jamais depuis le body) — sans cette garde,
        // n'importe quel utilisateur authentifié réécrivait n'importe quelle
        // fiche du catalogue.
        //
        // Périmètre INCHANGÉ : `achats` ou `dg`, accès complet pour les deux.
        // La condition n'a fait que sortir du monolithe vers le module pur
        // `lib/stockRoles` (testable) ; elle n'a été ni élargie ni restreinte.
        // Le message de refus, lui, est corrigé : il disait « Réservé au
        // responsable achats » alors que le DG passait.
        //
        // AJOUT 2026-08-29 (ticket sb/unite-conversion) : le MAGASINIER entre
        // dans cette action, mais sur DEUX CHAMPS SEULEMENT —
        // `unite_consommation` et `stock_par_unite_consommation`. C'est lui qui
        // sait qu'un fût d'acide nitrique de 25 L pèse 33 kg, et c'est lui que
        // la ligne non convertible bloque au quotidien ; il n'a en revanche
        // aucun accès à l'écran Stock › Articles.
        // ⚠️ La décision se prend sur le CONTENU RÉEL de `updates`, jamais sur
        // une déclaration du client : un magasinier qui joindrait `prix_ht` est
        // refusé en bloc. `achats`/`dg` ne sont PAS bridés par champ (cf. le
        // pavé d'en-tête de lib/stockRoles/articlePermissions.js : ce bridage a
        // déjà été tenté et retiré).
        const updateArticleRole = await resolveCallerRole(authUser);
        const updateArticlePerm = stockRoles.peutModifierChampsArticle(updateArticleRole, updates);
        if (!updateArticlePerm.ok) {
          return res.status(403).json({ success: false, error: updateArticlePerm.raison });
        }
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        // `unite_consommation` / `stock_par_unite_consommation` : conversion
        // « unité de consommation → unité de stock » (lib/uniteConso). Le
        // facteur se lit « 1 <unite_consommation> = X <unite> ».
        const allowed = ["nom", "reference", "reference_technique", "unite", "prix_ht", "taux_tva", "prix_ttc", "categorie", "sous_categorie", "type", "multi_ferme", "unite_consommation", "stock_par_unite_consommation"];
        const clean = {};
        for (const k of allowed) { if (updates && updates[k] !== undefined) clean[k] = updates[k]; }
        // La conversion est NORMALISÉE ici, à l'écriture, et une seule fois :
        // un facteur illisible (« abc », 0, négatif) est écrit `null` plutôt
        // que stocké tel quel. Une fiche ne doit jamais porter un facteur que
        // le module de conversion refusera silencieusement à la lecture — sinon
        // l'écran affiche une conversion et le stock en applique une autre.
        if (clean.unite_consommation !== undefined) {
          clean.unite_consommation = clean.unite_consommation === null ? null : String(clean.unite_consommation).trim();
        }
        if (clean.stock_par_unite_consommation !== undefined) {
          clean.stock_par_unite_consommation = uniteConso.lireFacteur(clean.stock_par_unite_consommation);
        }
        clean.updated_at = Date.now();
        // TRAÇABILITÉ : l'identité vient du TOKEN, pas du body. Le client peut
        // enrichir (nom affiché), mais ni se renommer ni s'effacer : sans ces
        // trois champs imposés, un `updated_by: {}` rendait la modification
        // anonyme — y compris un changement de catégorie fait par le DG.
        clean.updated_by = Object.assign({}, updated_by || {}, {
          uid: (authUser && authUser.uid) || null,
          email: (authUser && authUser.email) || null,
          profileId: updateArticleRole || null,
        });
        await db_firestore.collection("articles_catalog").doc(id).update(clean);
        // Une catégorie modifiée change ce que renvoie `campagne-conso-parcelle`
        // (catégorie résolue à la LECTURE) : son cache 30 min doit tomber.
        if (clean.categorie !== undefined) {
          await invalidateApiCachePrefix(consoBons.CONSO_PARCELLE_CACHE_PREFIX);
        }
        return res.json({ success: true });
      }

      // ------ CLASSER-ARTICLE : classer un article PAR SON NOM (bandeau Campagne) ------
      // Le bandeau « articles à classer » de Campagne › Campagne analytique ne
      // connaît que des NOMS d'articles (ceux lus sur les bons), jamais un
      // identifiant de fiche. D'où une action dédiée plutôt qu'un
      // `update-article` tordu : `update-article` écrit UNE fiche désignée par
      // son id, ce qui ne peut pas marcher ici.
      //
      // ⚠️ TOUTES les fiches actives de même nom normalisé sont mises à jour.
      // Le catalogue porte ~105 paires de doublons ; n'en reclasser qu'une rend
      // la clé AMBIGUË pour `lookupArticleCategorie` (fail-closed) et l'article
      // RESTE « à classer » — la correction paraîtrait sans effet.
      if (action === "classer-article" && req.method === "POST") {
        const { article, categorie, updated_by } = req.body || {};
        // MÊME règle de rôle qu'`update-article`, sur le même module pur
        // (`achats` ou `dg`) : classer un article, c'est écrire au catalogue,
        // il n'y a aucune raison que ce soit ouvert plus largement.
        const classerRole = await resolveCallerRole(authUser);
        const classerPerm = stockRoles.peutModifierArticle(classerRole);
        if (!classerPerm.ok) {
          return res.status(403).json({ success: false, error: classerPerm.raison });
        }
        const classerNom = article == null ? "" : String(article).trim();
        if (!classerNom) return res.status(400).json({ success: false, error: "Nom d'article requis" });
        // LIBELLÉ CANONIQUE — la même règle que create-article et les imports.
        // Le bandeau envoie `engrais` / `pesticide` : écrits tels quels, ils
        // fabriquaient une orthographe de plus à chaque classement (`pesticide`
        // au singulier n'existe nulle part ailleurs au catalogue).
        const classerCat = articleCategories.categorieCanonique(categorie);
        // Le classement n'ouvre PAS l'écriture d'une catégorie quelconque : la
        // porte du DG est « ranger dans l'une des deux familles de l'écran ».
        if (consoValorisationLib.familleBucket(classerCat) === "autre") {
          return res.status(400).json({
            success: false,
            error: "Catégorie invalide : seuls « engrais » et « pesticide » sont acceptés ici.",
          });
        }
        const classerSnap = await db_firestore.collection("articles_catalog").get();
        const classerCibles = stockRoles.referencesAClasserParNom(
          classerSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          classerNom
        );
        if (classerCibles.length === 0) {
          // Aucune création implicite : deux articles des bons (GENAKTIS,
          // Maspilan) n'ont pas de fiche, et leur orthographe est à vérifier sur
          // le bon papier avant d'en créer une.
          return res.status(404).json({
            success: false,
            fiches_mises_a_jour: 0,
            error: "Aucune fiche active « " + classerNom + " » au catalogue. "
              + "Créez d'abord l'article dans Stock › Articles (vérifiez l'orthographe du bon).",
          });
        }
        const classerNow = Date.now();
        // Identité imposée par le TOKEN (cf. update-article).
        const classerBy = Object.assign({}, updated_by || {}, {
          uid: (authUser && authUser.uid) || null,
          email: (authUser && authUser.email) || null,
          profileId: classerRole || null,
        });
        // Chunks de 400 (limite Firestore 500/batch, marge de 100).
        for (let i = 0; i < classerCibles.length; i += 400) {
          const classerBatch = db_firestore.batch();
          classerCibles.slice(i, i + 400).forEach((refId) => {
            classerBatch.update(db_firestore.collection("articles_catalog").doc(refId), {
              categorie: classerCat,
              updated_at: classerNow,
              updated_by: classerBy,
            });
          });
          await classerBatch.commit();
        }
        // ⚠️ SANS CETTE PURGE, LA FONCTIONNALITÉ PARAÎT CASSÉE : la réponse de
        // `campagne-conso-parcelle` est cachée 30 min et la catégorie y est
        // résolue à la LECTURE. On classe, on recharge, rien ne bouge.
        // Purge par PRÉFIXE : une entrée existe par périmètre (`_all`, `_f1`,
        // `_f1_framboise`…), les énumérer serait un fail-open.
        const classerPurged = await invalidateApiCachePrefix(consoBons.CONSO_PARCELLE_CACHE_PREFIX);
        return res.json({
          success: true,
          article: classerNom,
          categorie: classerCat,
          fiches_mises_a_jour: classerCibles.length,
          references: classerCibles,
          cache_entrees_purgees: classerPurged,
        });
      }

      if (action === "create-article" && req.method === "POST") {
        const { reference, nom, unite, prix_ht, taux_tva, prix_ttc, categorie, sous_categorie, type, reference_technique, multi_ferme, created_by } = req.body;
        // Rôle résolu SERVEUR : il était lu depuis le body de la requête, donc
        // usurpable (et contournable en omettant simplement le champ).
        const createArticleRole = await resolveCallerRole(authUser);
        if (createArticleRole !== "achats" && createArticleRole !== "dg") {
          return res.status(403).json({ success: false, error: "Seul le responsable achats peut créer des articles" });
        }
        if (!nom || !reference) return res.status(400).json({ success: false, error: "Nom et référence requis" });
        const existing = await db_firestore.collection("articles_catalog").doc(reference).get();
        if (existing.exists && existing.data().active !== false) return res.status(400).json({ success: false, error: "Un article avec cette référence existe déjà" });
        const now = Date.now();
        const createData = {
          reference, nom, unite: unite || "U", prix_ht: prix_ht || 0, taux_tva: taux_tva || 20,
          prix_ttc: prix_ttc || 0, categorie: articleCategories.categorieCanonique(categorie), sous_categorie: sous_categorie || "",
          type: type || "", reference_technique: reference_technique || "", multi_ferme: multi_ferme || false,
          active: true, invisible: false, updated_at: now, created_by: created_by || {}
        };
        // Résolution par NOM NORMALISÉ avant création : une fiche active portant
        // déjà ce nom est MISE À JOUR. Sans cela, créer « Engrais NPK » alors que
        // « ENGRAIS  NPK » existe déjà pose un second docId — le doublon exact
        // que ce ticket ferme. La formule d'identifiant, elle, reste intacte.
        const createCatalogSnap = await db_firestore.collection("articles_catalog").get();
        const createIndex = articleMerge.buildArticleIndex(
          createCatalogSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        );
        const createTarget = articleMerge.resolveArticleTarget(createIndex, reference, nom);
        // Repli limité au match par NOM. La redirection `merged_into` est
        // légitime pour un IMPORT (même article, ancien identifiant) mais PAS
        // pour une saisie libre : une référence tapée qui tombe sur le docId
        // d'un doublon déjà fusionné enverrait l'update sur le MASTER de la
        // fusion et écraserait son nom par celui saisi ici.
        if (createTarget.matchedBy === "nom") {
          // On met à jour une fiche EXISTANTE : ni `nom` ni `reference` ne sont
          // touchés. Les écrire renommerait un autre article et casserait
          // l'invariant docId == reference (cf. import Excel ci-dessus) — le
          // tout sous l'apparence d'une création réussie.
          const createPatch = { ...createData };
          delete createPatch.nom;
          delete createPatch.reference;
          await db_firestore.collection("articles_catalog").doc(createTarget.id).update(createPatch);
          return res.json({
            success: true,
            id: createTarget.id,
            existing_article: true,
            updated_existing: true,
            matched_by: "nom",
            message: "Un article portant ce nom existait déjà : sa fiche a été mise à jour, aucune nouvelle fiche n'a été créée.",
          });
        }
        // La référence saisie est celle d'un doublon ABSORBÉ par une fusion. On
        // refuse plutôt que d'écrire : un `set()` remplacerait la pierre tombale
        // (`active:false` + `merged_into`), donc (a) le pointeur qui redirige les
        // imports futurs vers le master serait perdu, et (b) le doublon
        // RÉAPPARAÎTRAIT ACTIF au catalogue — une fusion annulée en silence.
        // NB : le rollback, lui, ne dépend PAS de cette tombe. Il vit dans le
        // document `article_merges` (master_ref, doublon_refs,
        // doublon_balances_snapshot, reassigned_*_ids) et survit à l'écrasement.
        //
        // La garde s'indexe sur `createIndex.mergedInto`, PAS sur
        // `createTarget.matchedBy` : `resolveArticleTarget` n'émet
        // `matchedBy: 'merged_into'` que si le master est ENCORE ACTIF. Si le
        // master a été désactivé depuis (validate-delete-article), la résolution
        // retombe en 'none' — ni repli par nom, ni refus — et on écrasait la
        // tombe. L'index, lui, est indépendant de l'état du master.
        if (createIndex.mergedInto.has(reference)) {
          return res.status(400).json({ success: false, error: "Cette référence est celle d'un article fusionné dans un autre. Choisir une autre référence." });
        }
        await db_firestore.collection("articles_catalog").doc(reference).set({ ...createData, created_at: now });
        // Purge de l'index d'identité : depuis le refus fail-closed, un index
        // périmé refuserait pendant 5 minutes un bon portant l'article qu'on
        // vient précisément de créer pour pouvoir le saisir. C'est la sortie
        // « Créer cet article au catalogue » — elle doit être immédiate.
        invalidateIdentiteArticleIndex();
        // ── LA VALIDATION DU DG, C'EST LA CRÉATION ELLE-MÊME ────────────────
        // Il n'y a pas de bouton « valider la demande » à cliquer : le DG crée
        // l'article sur l'écran Catalogue qu'il a déjà, et la demande se ferme
        // d'elle-même. La correspondance passe par `canon`, la MÊME règle que
        // l'identité — pas une comparaison de noms réécrite pour l'occasion.
        const demandesClosesCreate = await cloturerDemandesCreationSatisfaites(db_firestore)
          .catch((e) => { console.error("clôture demandes création:", e.message); return 0; });
        return res.json({ success: true, id: reference, demandes_closes: demandesClosesCreate });
      }

      if (action === "request-delete-article" && req.method === "POST") {
        const { article_id, article_nom, requested_by } = req.body;
        if (!article_id) return res.status(400).json({ success: false, error: "article_id requis" });
        const now = Date.now();
        const ref = await db_firestore.collection("article_delete_requests").add({
          article_id, article_nom: article_nom || "", status: "pending",
          requested_by: requested_by || {}, requested_at: now, validated_by: null, validated_at: null
        });
        return res.json({ success: true, id: ref.id });
      }

      if (action === "validate-delete-article" && req.method === "POST") {
        const { request_id, approved, validated_by } = req.body;
        // Rôle résolu SERVEUR : cette action écrit `active:false` sur une fiche
        // catalogue. Sans garde, n'importe quel utilisateur authentifié pouvait
        // désactiver n'importe quel article.
        // PÉRIMÈTRE = l'EXPOSITION RÉELLE de l'écran « Suppr. Articles »
        // (`fin_delete_articles`, NAV_ITEMS_FINANCE) : dg | finance | audit_interne.
        // La garde passe de « tout utilisateur authentifié » à « les profils qui
        // ont légitimement l'écran », rien de plus. Restreindre davantage — par
        // exemple retirer `audit_interne`, profil de lecture — retirerait une
        // capacité existante : c'est une décision PRODUIT, distincte de la
        // fermeture de cette faille, et elle ne se prend pas ici.
        const deleteArticleRole = await resolveCallerRole(authUser);
        if (deleteArticleRole !== "dg" && deleteArticleRole !== "finance" && deleteArticleRole !== "audit_interne") {
          return res.status(403).json({ success: false, error: "Réservé au DG, à la Finance ou à l'audit interne" });
        }
        if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
        const docRef = db_firestore.collection("article_delete_requests").doc(request_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
        const data = snap.data();
        const now = Date.now();
        if (approved) {
          await db_firestore.collection("articles_catalog").doc(data.article_id).update({ active: false, updated_at: now });
          // La fiche n'est plus une identité valide : l'index doit le voir tout
          // de suite, sinon la saisie continuerait 5 min à écrire du stock sous
          // un article supprimé.
          invalidateIdentiteArticleIndex();
          await docRef.update({ status: "approved", validated_by: validated_by || {}, validated_at: now });
        } else {
          await docRef.update({ status: "rejected", validated_by: validated_by || {}, validated_at: now });
        }
        return res.json({ success: true });
      }

      if (action === "list-delete-requests") {
        const { status } = req.query;
        let query = db_firestore.collection("article_delete_requests");
        if (status) query = query.where("status", "==", status);
        const snap = await query.get();
        const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        requests.sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
        return res.json({ success: true, requests });
      }

      // ========== DEMANDES DE CRÉATION D'ARTICLE (magasinier → DG) ==========
      //
      // Bâti sur le patron d'`article_delete_requests`, MAIS SANS SES DEUX
      // DÉFAUTS : ses actions `request-*` / `list-*` n'ont AUCUNE garde de rôle
      // (n'importe quel utilisateur authentifié pouvait demander la suppression
      // de n'importe quel article, et lire toutes les demandes), et elle
      // n'envoie AUCUNE notification — ni au valideur, ni au demandeur. Une
      // demande que personne ne voit n'est pas une demande.

      // --- DEMANDER la création d'un article (saisie explicite) ---
      if (action === "request-article-creation" && req.method === "POST") {
        // Rôle résolu SERVEUR, jamais depuis le body. Périmètre = les profils
        // qui saisissent réellement des bons de stock, plus ceux qui créent
        // l'article au bout de la chaîne.
        const demandeRole = await resolveCallerRole(authUser);
        const DEMANDE_ROLES = ["magasinier", "achats", "dg", "chef_f1", "chef_f5", "chef_avo"];
        if (!DEMANDE_ROLES.includes(demandeRole)) {
          return res.status(403).json({ success: false, error: "Profil non autorisé à demander la création d'un article" });
        }
        const libelleDemande = String((req.body && req.body.libelle) || "").trim();
        if (!libelleDemande) return res.status(400).json({ success: false, error: "libelle requis" });
        // Un article qui EXISTE déjà ne se demande pas : on le dit, plutôt que
        // d'ouvrir une demande que le DG refermerait aussitôt.
        const demandeIndex = await getIdentiteArticleIndex(db_firestore, { force: true });
        const dejaLa = identiteArticle.resoudreIdentite(libelleDemande, demandeIndex);
        if (dejaLa.issue === identiteArticle.ISSUE_RESOLU) {
          return res.json({
            success: true, deja_au_catalogue: true, article_id: dejaLa.ficheId,
            message: "L'article « " + dejaLa.nom + " » existe déjà au catalogue.",
          });
        }
        const demandesFaites = await enregistrerDemandesCreation(
          db_firestore,
          [{ issue: identiteArticle.ISSUE_INTROUVABLE, libelle: libelleDemande }],
          { uid: authUser.uid, profileId: demandeRole, name: (authUser && (authUser.name || authUser.email)) || "" },
          { origine: "request-article-creation", type: (req.body && req.body.origine) || "", numero: (req.body && req.body.numero) || "" }
        );
        return res.json({
          success: true,
          demandes_creation: demandesFaites,
          message: "Demande de création envoyée au DG pour « " + libelleDemande + " ».",
        });
      }

      // --- LISTER les demandes (écran DG / suivi) ---
      if (action === "list-article-creation-requests") {
        // Garde de rôle : lecture d'un flux de travail interne.
        const listeRole = await resolveCallerRole(authUser);
        const LISTE_ROLES = ["dg", "achats", "finance", "audit_interne", "magasinier"];
        if (!LISTE_ROLES.includes(listeRole)) {
          return res.status(403).json({ success: false, error: "Profil non autorisé" });
        }
        // Balayage de clôture AVANT de lister : sans lui, une demande satisfaite
        // par un autre chemin que `create-article` (import CANEVA, fusion)
        // resterait affichée indéfiniment.
        const closes = await cloturerDemandesCreationSatisfaites(db_firestore)
          .catch((e) => { console.error("clôture demandes création:", e.message); return 0; });
        let demandeQuery = db_firestore.collection(demandeCreationArticle.COLLECTION);
        if (req.query && req.query.statut) demandeQuery = demandeQuery.where("statut", "==", req.query.statut);
        const demandeSnap = await demandeQuery.get();
        const demandes = demandeSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        demandes.sort((a, b) => (b.derniere_demande_at || 0) - (a.derniere_demande_at || 0));
        return res.json({ success: true, demandes, demandes_closes: closes });
      }

      // --- CLÔTURER les demandes satisfaites (idempotent, sans effet de bord) ---
      if (action === "close-article-creation-requests" && req.method === "POST") {
        const clotureRole = await resolveCallerRole(authUser);
        if (clotureRole !== "dg" && clotureRole !== "achats") {
          return res.status(403).json({ success: false, error: "Réservé au DG et aux achats" });
        }
        const closes = await cloturerDemandesCreationSatisfaites(db_firestore);
        return res.json({ success: true, demandes_closes: closes });
      }

      // ========== FUSION D'ARTICLES EN DOUBLON ==========

      // --- SUGGEST DUPLICATES (groupes par nom normalisé, active=true, >=2) ---
      if (action === "suggest-article-duplicates") {
        // Rôle résolu SERVEUR (jamais depuis le body), règle PURE partagée avec
        // `merge-articles` : `achats` OU `dg`. La garde était en dur sur
        // `achats`, un profil qu'aucun humain n'utilise — la fusion des ~105
        // paires de doublons n'a donc jamais pu être lancée en production.
        const callerRole = await resolveCallerRole(authUser);
        const suggestDupPerm = stockRoles.peutFusionnerArticles(callerRole);
        if (!suggestDupPerm.ok) {
          return res.status(403).json({ success: false, error: suggestDupPerm.raison });
        }
        const snap = await db_firestore.collection("articles_catalog").where("active", "==", true).get();
        // `prix_pmp`, `prix_ht` et `nb_achats` sont les DONNÉES DE DÉCISION :
        // `merge-articles` ne les transfère PAS du doublon vers le maître, donc
        // retenir la fiche sans prix laisse un article actif non valorisable.
        // Sans elles dans la projection, l'écran ne peut ni les afficher ni
        // suggérer un maître (cf. lib/stockMerge/masterSuggestion.js).
        const articles = snap.docs.map(d => {
          const data = d.data();
          return {
            // `id` = docId : SEULE clé acceptée par `merge-articles`, qui
            // résout par `.doc(<clé>)`. Le champ `reference` diverge du docId
            // sur 92 fiches (« ENG 0149 » vs « ENG0149 ») et 5 documents
            // fantômes existent aux références espacées : l'envoyer comme
            // master_ref ferait fusionner vers un document sans nom.
            id: d.id,
            reference: data.reference || d.id,
            nom: data.nom || "",
            categorie: data.categorie || "",
            unite: data.unite || "",
            prix_pmp: data.prix_pmp === undefined ? null : data.prix_pmp,
            prix_ht: data.prix_ht === undefined ? null : data.prix_ht,
            nb_achats: data.nb_achats === undefined ? null : data.nb_achats,
          };
        });
        const groups = articleMerge.groupDuplicates(articles);
        return res.json({ success: true, groups });
      }

      // --- MERGE ARTICLES (preview | execute) ---
      if (action === "merge-articles" && req.method === "POST") {
        const { master_ref, doublon_refs, mode, by } = req.body || {};
        // Rôle : `achats` OU `dg` — résolu depuis le token Firebase (anti-spoof
        // body), via la MÊME règle pure que `suggest-article-duplicates`. Le
        // message disait « Seul le responsable achats » alors que la fusion est
        // une écriture au catalogue, ouverte au DG comme update-article.
        const callerRole = await resolveCallerRole(authUser);
        const mergeArticlesPerm = stockRoles.peutFusionnerArticles(callerRole);
        if (!mergeArticlesPerm.ok) {
          return res.status(403).json({ success: false, error: mergeArticlesPerm.raison });
        }
        if (!master_ref || !Array.isArray(doublon_refs) || doublon_refs.length === 0) {
          return res.status(400).json({ success: false, error: "master_ref et doublon_refs[] requis" });
        }
        const mergeMode = mode === "execute" ? "execute" : "preview";
        const doublonSet = new Set(doublon_refs);
        if (doublonSet.has(master_ref)) {
          return res.status(400).json({ success: false, error: "Le master ne peut pas être dans les doublons" });
        }

        // Validation existence + INTÉGRITÉ du master.
        // La garde ne testait que `active === false` : un document sans champ
        // `active` passait (`undefined !== false`). Il existe en production 5
        // documents FANTÔMES sans `nom` ni `active` (références espacées dont
        // le docId ne l'est pas) — fusionner vers l'un d'eux réécrit les
        // libellés de mouvements et de BDC avec une chaîne vide. Règle pure
        // partagée avec la validation des doublons ci-dessous.
        const masterSnap = await db_firestore.collection("articles_catalog").doc(master_ref).get();
        if (!masterSnap.exists) {
          return res.status(404).json({ success: false, error: "Article master introuvable: " + master_ref });
        }
        const masterData = masterSnap.data();
        const masterIntegrite = articleMerge.verifierIntegriteFiche(masterData, master_ref, "master");
        if (!masterIntegrite.ok) {
          return res.status(400).json({ success: false, error: masterIntegrite.erreur });
        }
        const masterNom = masterData.nom || "";
        const masterUnite = masterData.unite || "kg";

        // Validation existence des doublons + map ref->nom (pour matcher movements/bdc par nom OU ref)
        const doublonRefs = Array.from(doublonSet);
        const doublonDocs = await Promise.all(doublonRefs.map(r => db_firestore.collection("articles_catalog").doc(r).get()));
        const doublonNoms = {}; // ref -> nom
        for (let i = 0; i < doublonDocs.length; i++) {
          if (!doublonDocs[i].exists) {
            return res.status(404).json({ success: false, error: "Article doublon introuvable: " + doublonRefs[i] });
          }
          const doublonData = doublonDocs[i].data();
          // MÊME garde que le master : un doublon fantôme se ferait désactiver
          // à la place de la vraie fiche — « fusion effectuée » à l'écran, et
          // le doublon toujours là au rechargement (cas réel « ksc 7 perla »).
          const doublonIntegrite = articleMerge.verifierIntegriteFiche(doublonData, doublonRefs[i], "doublon");
          if (!doublonIntegrite.ok) {
            return res.status(400).json({ success: false, error: doublonIntegrite.erreur });
          }
          doublonNoms[doublonRefs[i]] = doublonData.nom || "";
        }
        // Ensembles de valeurs identifiant un doublon dans les docs opérationnels :
        // - stock_movements.items[].article_ref peut contenir la référence OU le nom (legacy)
        // - purchase_orders.items[].article contient le NOM
        // Normalisation IDENTIQUE à la détection (normalizeArticleName : NFD + diacritiques
        // + espaces réduits) pour que les accents/doubles-espaces matchent malgré legacy.
        const doublonKeysNorm = new Set();
        for (const r of doublonRefs) {
          doublonKeysNorm.add(articleMerge.normalizeArticleName(r));
          const nm = doublonNoms[r];
          if (nm) doublonKeysNorm.add(articleMerge.normalizeArticleName(nm));
        }
        doublonKeysNorm.delete("");
        const itemMatchesDoublon = (refOrName) => doublonKeysNorm.has(articleMerge.normalizeArticleName(refOrName));

        // ---------- Collecte des mouvements OUVERTS contenant un doublon ----------
        const movSnap = await db_firestore.collection("stock_movements").get();
        const openMovements = []; // { id, items, ... }
        for (const d of movSnap.docs) {
          const mov = d.data();
          if (!articleMerge.isMovementOpen(mov)) continue;
          const hit = (mov.items || []).some(it => itemMatchesDoublon(it.article_ref) || itemMatchesDoublon(it.article));
          if (hit) openMovements.push({ id: d.id, ref: d.ref, data: mov });
        }

        // ---------- Collecte des BDC OUVERTS contenant un doublon ----------
        const bdcSnap = await db_firestore.collection("purchase_orders").get();
        const openBdc = [];
        for (const d of bdcSnap.docs) {
          const bdc = d.data();
          if (!articleMerge.isBdcOpen(bdc)) continue;
          const hit = (bdc.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) openBdc.push({ id: d.id, ref: d.ref, data: bdc });
        }

        // ---------- Agrégation des stock_balances DOUBLON -> MASTER ----------
        // On somme les soldes des doublons par (lieu_type, lieu_id) sur le master.
        const balSnap = await db_firestore.collection("stock_balances").get();
        const doublonBalances = []; // balances appartenant à un doublon
        for (const d of balSnap.docs) {
          const b = d.data();
          if (itemMatchesDoublon(b.article_ref)) {
            doublonBalances.push({ id: d.id, ref: d.ref, data: b });
          }
        }
        // Solde courant du master par lieu (pour l'affichage preview du solde résultant)
        const masterRefNorm = articleMerge.normalizeArticleName(master_ref);
        const masterBalByLieu = {}; // `${lieu_type}|${lieu_id}` -> { docId, balance }
        for (const d of balSnap.docs) {
          const b = d.data();
          if (articleMerge.normalizeArticleName(b.article_ref) === masterRefNorm) {
            masterBalByLieu[`${b.lieu_type}|${b.lieu_id}`] = { docId: d.id, balance: b.balance || 0 };
          }
        }
        // Calcul des soldes agrégés résultants sur le master
        const aggByLieu = {}; // key -> { lieu_type, lieu_id, unite, doublon_sum, master_current, resulting }
        for (const db of doublonBalances) {
          const b = db.data;
          const key = `${b.lieu_type}|${b.lieu_id}`;
          if (!aggByLieu[key]) {
            aggByLieu[key] = {
              lieu_type: b.lieu_type, lieu_id: b.lieu_id,
              unite: b.unite || masterUnite,
              doublon_sum: 0,
              master_current: masterBalByLieu[key] ? masterBalByLieu[key].balance : 0,
              resulting: 0,
            };
          }
          aggByLieu[key].doublon_sum = Math.round((aggByLieu[key].doublon_sum + (b.balance || 0)) * 100) / 100;
        }
        for (const key of Object.keys(aggByLieu)) {
          const a = aggByLieu[key];
          a.resulting = Math.round((a.master_current + a.doublon_sum) * 100) / 100;
        }
        const aggregatedBalances = Object.values(aggByLieu);

        // ---------- Counts des docs historiques laissés INTACTS ----------
        let historicalMovements = 0, validatedMovements = 0, closedBdc = 0;
        for (const d of movSnap.docs) {
          const mov = d.data();
          if (articleMerge.isMovementOpen(mov)) continue;
          const hit = (mov.items || []).some(it => itemMatchesDoublon(it.article_ref) || itemMatchesDoublon(it.article));
          if (hit) { historicalMovements++; if (mov.status === "valide_chef") validatedMovements++; }
        }
        for (const d of bdcSnap.docs) {
          const bdc = d.data();
          if (articleMerge.isBdcOpen(bdc)) continue;
          const hit = (bdc.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) closedBdc++;
        }
        // delivery_notes + invoices : toujours laissés intacts (historiques/financiers)
        const blSnap = await db_firestore.collection("delivery_notes").get();
        let untouchedBl = 0;
        for (const d of blSnap.docs) {
          const bl = d.data();
          const hit = (bl.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) untouchedBl++;
        }
        const invSnap = await db_firestore.collection("invoices").get();
        let untouchedInvoices = 0;
        for (const d of invSnap.docs) {
          const inv = d.data();
          const hit = (inv.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) untouchedInvoices++;
        }

        const counts = {
          movements: openMovements.length,
          balances: doublonBalances.length,
          bdc: openBdc.length,
        };

        if (mergeMode === "preview") {
          return res.json({
            success: true,
            preview: {
              master: { reference: master_ref, nom: masterNom },
              doublons: doublonRefs.map(r => ({ reference: r, nom: doublonNoms[r] })),
              open_movements: openMovements.length,
              open_bdc: openBdc.length,
              aggregated_balances: aggregatedBalances,
              doublon_balances_count: doublonBalances.length,
              untouched: {
                historical_movements: historicalMovements,
                validated_movements: validatedMovements,
                closed_bdc: closedBdc,
                delivery_notes: untouchedBl,
                invoices: untouchedInvoices,
              },
            },
          });
        }

        // ---------- EXECUTE : fusion atomique (batchs de 400, marge 100) ----------
        const now = Date.now();
        const ops = []; // { type:'set'|'update'|'delete', ref, data, options }

        // 1) Réassigner les items des mouvements ouverts (ref + nom -> master)
        for (const m of openMovements) {
          const newItems = (m.data.items || []).map(it => {
            if (itemMatchesDoublon(it.article_ref) || itemMatchesDoublon(it.article)) {
              return { ...it, article_ref: master_ref, article_nom: masterNom };
            }
            return it;
          });
          ops.push({ type: "update", ref: m.ref, data: { items: newItems, updated_at: now } });
        }

        // 2) Réassigner les items des BDC ouverts (article = nom du master)
        for (const b of openBdc) {
          const newItems = (b.data.items || []).map(it => {
            if (itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref)) {
              const ni = { ...it, article: masterNom };
              if (it.article_ref !== undefined) ni.article_ref = master_ref;
              return ni;
            }
            return it;
          });
          ops.push({ type: "update", ref: b.ref, data: { items: newItems, updated_at: now } });
        }

        // 3) Agréger les balances : INCRÉMENT RELATIF du master par lieu (anti-TOCTOU),
        //    puis neutraliser les doublons (delete). On écrit FieldValue.increment(doublon_sum)
        //    et NON une valeur absolue : une validation de mouvement concurrente qui modifie
        //    la balance master n'est plus écrasée. set(..., {merge:true}) crée le doc (incr depuis 0)
        //    ou l'incrémente s'il existe.
        for (const key of Object.keys(aggByLieu)) {
          const a = aggByLieu[key];
          const balanceId = `${a.lieu_type}_${a.lieu_id}_${master_ref}`.replace(/\s+/g, "_");
          const masterBalRef = db_firestore.collection("stock_balances").doc(balanceId);
          ops.push({
            type: "set",
            ref: masterBalRef,
            data: {
              lieu_type: a.lieu_type, lieu_id: a.lieu_id,
              article_ref: master_ref, article_nom: masterNom,
              unite: a.unite || masterUnite,
              balance: admin.firestore.FieldValue.increment(a.doublon_sum),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            },
            options: { merge: true },
          });
        }
        // Supprimer les balances du doublon APRÈS calcul de doublon_sum (déjà agrégées)
        for (const db of doublonBalances) {
          ops.push({ type: "delete", ref: db.ref });
        }

        // 4) Désactiver les doublons + tracer merged_into
        for (const r of doublonRefs) {
          ops.push({
            type: "update",
            ref: db_firestore.collection("articles_catalog").doc(r),
            data: { active: false, merged_into: master_ref, updated_at: now },
          });
        }

        // 5) Doc d'audit — snapshot pour rollback manuel.
        //    On capture les balances doublon AVANT suppression + les ids réassignés.
        //    Plafond 1000 entrées par liste (flag truncated) pour borner la taille du doc.
        const SNAP_CAP = 1000;
        const capList = (arr) => ({
          list: arr.slice(0, SNAP_CAP),
          truncated: arr.length > SNAP_CAP,
        });
        const doublonBalancesSnapshotFull = doublonBalances.map((db) => ({
          docId: db.id,
          lieu_type: db.data.lieu_type || "",
          lieu_id: db.data.lieu_id || "",
          article_ref: db.data.article_ref || "",
          balance: db.data.balance || 0,
          unite: db.data.unite || "",
        }));
        const reassignedMovementIdsFull = openMovements.map((m) => m.id);
        const reassignedBdcIdsFull = openBdc.map((b) => b.id);
        const snapBalances = capList(doublonBalancesSnapshotFull);
        const snapMovIds = capList(reassignedMovementIdsFull);
        const snapBdcIds = capList(reassignedBdcIdsFull);

        const auditRef = db_firestore.collection("article_merges").doc();
        ops.push({
          type: "set",
          ref: auditRef,
          data: {
            master_ref, master_nom: masterNom,
            doublon_refs: doublonRefs,
            by: {
              uid: authUser.uid || "", profileId: callerRole || "",
              name: (by && by.name) || "", email: authUser.email || "",
            },
            at: admin.firestore.FieldValue.serverTimestamp(),
            counts,
            mode: "execute",
            doublon_balances_snapshot: snapBalances.list,
            doublon_balances_snapshot_truncated: snapBalances.truncated,
            reassigned_movement_ids: snapMovIds.list,
            reassigned_movement_ids_truncated: snapMovIds.truncated,
            reassigned_bdc_ids: snapBdcIds.list,
            reassigned_bdc_ids_truncated: snapBdcIds.truncated,
          },
          options: {},
        });

        // Commit par batchs de 400
        for (let i = 0; i < ops.length; i += 400) {
          const batch = db_firestore.batch();
          for (const op of ops.slice(i, i + 400)) {
            if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
            else if (op.type === "update") batch.update(op.ref, op.data);
            else if (op.type === "delete") batch.delete(op.ref);
          }
          await batch.commit();
        }

        // Une fusion pose `merged_into` et désactive des fiches : l'index
        // d'identité change, la résolution doit le voir tout de suite (sans
        // quoi une saisie continuerait 5 min à viser la fiche absorbée).
        invalidateIdentiteArticleIndex();
        return res.json({ success: true, counts, audit_id: auditRef.id });
      }

      // ========== CODES ANALYTIQUES ==========

      if (action === "list-codes-analytiques") {
        const snap = await db_firestore.collection("config_analytique").where("actif", "==", true).orderBy("code").get();
        return res.json({ success: true, codes: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }

      if (action === "save-code-analytique" && req.method === "POST") {
        const { id, code, libelle, ferme, categorie_achat, nature_cpc, saved_by } = req.body;
        if (!code || !libelle) return res.status(400).json({ success: false, error: "Code et libellé requis" });
        const data = { code, libelle, ferme: ferme || "Toutes", categorie_achat: categorie_achat || "autre",
          nature_cpc: nature_cpc || "621", actif: true, updated_at: Date.now(), updated_by: saved_by || {} };
        if (id) {
          await db_firestore.collection("config_analytique").doc(id).update(data);
          return res.json({ success: true, id });
        } else {
          const ref = await db_firestore.collection("config_analytique").add({ ...data, created_at: Date.now() });
          return res.json({ success: true, id: ref.id });
        }
      }

      if (action === "delete-code-analytique" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        await db_firestore.collection("config_analytique").doc(id).update({ actif: false });
        return res.json({ success: true });
      }

      // ========== CONSULTATIONS (Appels d'offres) ==========

      if (action === "list-consultations") {
        const { ferme, status } = req.query;
        let q = db_firestore.collection("consultations");
        if (ferme) q = q.where("ferme", "==", ferme);
        if (status) q = q.where("status", "==", status);
        const snap = await q.orderBy("created_at", "desc").get();
        return res.json({ success: true, consultations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }

      if (action === "create-consultation" && req.method === "POST") {
        const { ferme, objet, date_limite_reponse, items_demandes, created_by } = req.body;
        if (!ferme || !objet) return res.status(400).json({ success: false, error: "Ferme et objet requis" });
        const numero = await getNextNumber("consultation", "CON");
        const now = Date.now();
        const ref = await db_firestore.collection("consultations").add({
          numero, status: "en_cours", ferme, objet,
          date_limite_reponse: date_limite_reponse || "",
          items_demandes: items_demandes || [],
          offres: [],
          offre_retenue_index: null,
          bdc_id: null,
          created_by: created_by || {},
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: ref.id, numero });
      }

      if (action === "add-offre" && req.method === "POST") {
        const { consultation_id, offre, updated_by } = req.body;
        if (!consultation_id || !offre) return res.status(400).json({ success: false, error: "consultation_id et offre requis" });
        const docRef = db_firestore.collection("consultations").doc(consultation_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Consultation introuvable" });
        const data = snap.data();
        const offres = data.offres || [];
        // Upsert: remplacer si même fournisseur_id, sinon ajouter
        const idx = offres.findIndex(o => o.fournisseur_id === offre.fournisseur_id);
        const newOffre = {
          fournisseur_id: offre.fournisseur_id || "",
          fournisseur_nom: offre.fournisseur_nom || "",
          date_reception: offre.date_reception || "",
          delai_livraison: offre.delai_livraison || 0,
          conditions_paiement: offre.conditions_paiement || "",
          items: offre.items || [],
          total_ht: offre.total_ht || 0,
          justificatif_url: offre.justificatif_url || null,
          retenu: false,
        };
        if (idx >= 0) offres[idx] = newOffre; else offres.push(newOffre);
        await docRef.update({ offres, updated_at: Date.now(), updated_by: updated_by || {} });
        return res.json({ success: true, offre_index: idx >= 0 ? idx : offres.length - 1 });
      }

      if (action === "retenir-offre" && req.method === "POST") {
        const { consultation_id, offre_index, retained_by } = req.body;
        if (consultation_id === undefined || offre_index === undefined) {
          return res.status(400).json({ success: false, error: "consultation_id et offre_index requis" });
        }
        const docRef = db_firestore.collection("consultations").doc(consultation_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Consultation introuvable" });
        const data = snap.data();
        const offres = (data.offres || []).map((o, i) => ({ ...o, retenu: i === offre_index }));
        await docRef.update({
          offres,
          offre_retenue_index: offre_index,
          status: "cloturee",
          retained_by: retained_by || {},
          retained_at: Date.now(),
          updated_at: Date.now(),
        });
        return res.json({ success: true });
      }

      if (action === "link-bdc-consultation" && req.method === "POST") {
        const { consultation_id, bdc_id } = req.body;
        if (!consultation_id || !bdc_id) return res.status(400).json({ success: false, error: "consultation_id et bdc_id requis" });
        await db_firestore.collection("consultations").doc(consultation_id).update({ bdc_id, updated_at: Date.now() });
        return res.json({ success: true });
      }

      // ========== DEMANDES DE VIREMENT ==========

      if (action === "list-demandes-virement") {
        const { status } = req.query;
        let q = db_firestore.collection("demandes_virement");
        if (status) q = q.where("status", "==", status);
        const snap = await q.orderBy("created_at", "desc").get();
        return res.json({ success: true, demandes: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }

      if (action === "create-demande-virement" && req.method === "POST") {
        const { facture_id, bdc_id, fournisseur, montant_ttc, motif, created_by } = req.body;
        if (!facture_id || !montant_ttc) return res.status(400).json({ success: false, error: "facture_id et montant_ttc requis" });
        const numero = await getNextNumber("virement", "VIR");
        const now = Date.now();
        const ref = await db_firestore.collection("demandes_virement").add({
          numero, facture_id, bdc_id: bdc_id || null,
          fournisseur: fournisseur || { nom: "", ice: "", rib: "" },
          montant_ttc: Number(montant_ttc),
          motif: motif || "",
          status: "en_attente",
          created_by: created_by || {},
          approved_by: null, executed_by: null,
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: ref.id, numero });
      }

      if (action === "validate-virement" && req.method === "POST") {
        const { id, decision, rib, date_execution, comment, validated_by } = req.body;
        if (!id || !decision) return res.status(400).json({ success: false, error: "id et decision requis" });
        if (!["approuve", "execute", "rejete"].includes(decision)) {
          return res.status(400).json({ success: false, error: "Decision invalide" });
        }
        const updates = { status: decision, updated_at: Date.now(), validated_by: validated_by || {} };
        if (decision === "approuve") {
          updates.approved_by = validated_by || {};
          updates.approved_at = Date.now();
          if (rib) updates["fournisseur.rib"] = rib;
        } else if (decision === "execute") {
          updates.executed_by = validated_by || {};
          updates.executed_at = date_execution ? new Date(date_execution).getTime() : Date.now();
          if (rib) updates["fournisseur.rib"] = rib;
        } else if (decision === "rejete") {
          updates.rejected_by = validated_by || {};
          updates.rejected_at = Date.now();
          updates.reject_comment = comment || "";
        }
        await db_firestore.collection("demandes_virement").doc(id).update(updates);
        return res.json({ success: true });
      }

      // ========== TRACKING COMMANDES PAR FERME ==========

      if (action === "track-orders") {
        const { ferme } = req.query;
        const now = Date.now();

        // 3 requêtes en parallèle
        const bdcQuery = ferme
          ? db_firestore.collection("purchase_orders").where("ferme", "==", ferme).orderBy("created_at", "desc").limit(100)
          : db_firestore.collection("purchase_orders").orderBy("created_at", "desc").limit(100);

        const [bdcSnap, blSnap, invSnap] = await Promise.all([
          bdcQuery.get(),
          db_firestore.collection("delivery_notes").orderBy("created_at", "desc").limit(500).get(),
          db_firestore.collection("invoices").orderBy("created_at", "desc").limit(500).get(),
        ]);

        // Index BL et factures par bdc_id
        const blsByBdc = {};
        blSnap.docs.forEach(d => {
          const bl = d.data();
          if (bl.bdc_id && !blsByBdc[bl.bdc_id]) blsByBdc[bl.bdc_id] = { id: d.id, ...bl };
        });
        const invsByBdc = {};
        invSnap.docs.forEach(d => {
          const inv = d.data();
          if (inv.bdc_id && !invsByBdc[inv.bdc_id]) invsByBdc[inv.bdc_id] = { id: d.id, ...inv };
        });

        const STEPS = [
          { key: "cree",    label: "BDC Créé",   icon: "📋" },
          { key: "chef",    label: "Chef Ferme",  icon: "✅" },
          { key: "dg",      label: "DG Approuvé", icon: "🔏" },
          { key: "envoye",  label: "Envoyé",      icon: "📤" },
          { key: "livre",   label: "BL Reçu",     icon: "📦" },
          { key: "facture", label: "Facturé",     icon: "🧾" },
          { key: "paye",    label: "Payé",        icon: "💳" },
        ];

        // SLA par étape (en ms) pour détecter les retards
        const SLA = { cree: 2, chef: 3, dg: 3, envoye: 7, livre: 14, facture: 7, paye: 30 };

        const orders = bdcSnap.docs.map(doc => {
          const bdc = { id: doc.id, ...doc.data() };
          const history = bdc.history || [];
          const bl  = blsByBdc[bdc.id];
          const inv = invsByBdc[bdc.id];

          const getHistAt = (actionName) => {
            const e = history.find(h => h.action === actionName);
            return e ? e.at : null;
          };

          const paidAt = inv && inv.payment_status === "payee"
            ? (inv.paid_at || (inv.history || []).find(h => h.action === "paiement")?.at || null)
            : null;

          const stepTimes = {
            cree:    bdc.created_at,
            chef:    getHistAt("validation_chef"),
            dg:      getHistAt("validation_dg"),
            envoye:  getHistAt("envoi_fournisseur"),
            livre:   bl  ? bl.created_at  : null,
            facture: inv ? inv.created_at : null,
            paye:    paidAt,
          };

          // Si BDC rejeté, marquer la dernière étape atteinte comme bloquée
          const isRejected = ["rejete"].includes(bdc.status);

          let lastDoneIdx = -1;
          const steps = STEPS.map((s, i) => {
            const at = stepTimes[s.key];
            const done = at !== null;
            if (done) lastDoneIdx = i;
            return { ...s, at, done };
          });

          const isComplete = lastDoneIdx === STEPS.length - 1;
          const currentStepIdx = isComplete ? STEPS.length - 1 : Math.min(lastDoneIdx + 1, STEPS.length - 1);

          steps.forEach((s, i) => {
            s.isCurrent = !isComplete && i === currentStepIdx;
            s.isBlocked  = isRejected && i === currentStepIdx;
          });

          // Durées entre étapes
          const durations = [];
          for (let i = 1; i < STEPS.length; i++) {
            const prev = steps[i - 1];
            const curr = steps[i];
            if (prev.at && curr.at) {
              durations.push({ from: prev.key, to: curr.key, ms: curr.at - prev.at, pending: false });
            } else if (prev.at && !curr.at && curr.isCurrent) {
              durations.push({ from: prev.key, to: curr.key, ms: now - prev.at, pending: true });
            } else {
              durations.push({ from: prev.key, to: curr.key, ms: null, pending: false });
            }
          }

          // Retard : étape courante dépasse son SLA
          const slaDays = SLA[STEPS[currentStepIdx]?.key] || 7;
          const lastDoneAt = lastDoneIdx >= 0 ? steps[lastDoneIdx].at : bdc.created_at;
          const isLate = !isComplete && !isRejected && lastDoneAt && (now - lastDoneAt) > slaDays * 86400000;

          return {
            id: bdc.id, numero: bdc.numero, ferme: bdc.ferme,
            fournisseur: bdc.fournisseur, total_ttc: bdc.total_ttc,
            code_analytique: bdc.code_analytique, mode_paiement: bdc.mode_paiement,
            status: bdc.status, is_complete: isComplete, is_late: isLate, is_rejected: isRejected,
            current_step: STEPS[currentStepIdx]?.key,
            current_step_label: STEPS[currentStepIdx]?.label,
            steps, durations,
            created_at: bdc.created_at,
            bl_numero: bl?.numero_bl_fournisseur || null,
            facture_numero: inv?.numero_facture || null,
          };
        });

        // KPIs globaux
        const enCours  = orders.filter(o => !o.is_complete && !o.is_rejected);
        const termines = orders.filter(o => o.is_complete);
        const enRetard = orders.filter(o => o.is_late);

        // Délai moyen total (de créé à payé) sur commandes terminées
        let delaiMoyenMs = null;
        const withFullDuration = termines.filter(o => o.steps[0].at && o.steps[STEPS.length - 1].at);
        if (withFullDuration.length) {
          const total = withFullDuration.reduce((sum, o) => sum + (o.steps[STEPS.length - 1].at - o.steps[0].at), 0);
          delaiMoyenMs = Math.round(total / withFullDuration.length);
        }

        // Délai moyen par étape
        const stepAvg = {};
        STEPS.slice(1).forEach((s, idx) => {
          const vals = orders.map(o => o.durations[idx]).filter(d => d && d.ms !== null && !d.pending);
          if (vals.length) stepAvg[s.key] = Math.round(vals.reduce((s, d) => s + d.ms, 0) / vals.length);
        });

        return res.json({ success: true, orders, kpis: {
          en_cours: enCours.length,
          termines: termines.length,
          en_retard: enRetard.length,
          delai_moyen_ms: delaiMoyenMs,
          step_avg_ms: stepAvg,
        }});
      }

      // ========== ANALYSES FOLIAIRES ==========

      if (action === "list-analyses-foliaires") {
        const { ferme, parcelle, statut, type_analyse, variete } = req.query;
        const now = Date.now();
        const PARCELLES_MAP = {
          F1: ["P1-Myrtille A","P2-Myrtille B","P3-Framboise","P4-Myrtille C","P5-Framboise B"],
          F2: [],
          F3: [],
          F4: [],
          F5: ["P1-Myrtille","P2-Framboise A","P3-Framboise B","P4-Myrtille D"],
          F6: [],
          BAHIA: [],
          Avocatier: ["P1-Hass","P2-Hass B","P3-Fuerte"],
        };
        // Variety → canonical ferme overrides. Used to correct historical mis-assignments
        // (e.g. CASCADE is a myrtille cultivar planted only on F5).
        const VARIETE_FERME_OVERRIDE = {
          CASCADE: "F5",
        };

        // We *must* fetch without a ferme filter when an override may apply, otherwise
        // docs stored under the wrong ferme stay hidden forever. Cheap: small collection.
        let q = db_firestore.collection("analyses_foliaires");
        if (parcelle) q = q.where("parcelle", "==", parcelle);
        if (statut) q = q.where("statut", "==", statut);
        if (type_analyse) q = q.where("type_analyse", "==", type_analyse);
        if (variete) q = q.where("variete", "==", variete);
        const snap = await q.get();
        const THREE_DAYS = 3 * 86400000;
        const THIRTY_DAYS = 30 * 86400000;

        // Persist ferme corrections as we see them, so subsequent queries are fast.
        const fixPromises = [];
        let analyses = snap.docs.map(d => {
          const a = { id: d.id, ...d.data() };
          if (!a.type_analyse) a.type_analyse = "foliaire";
          if (!a.source) a.source = "manual";
          a.is_result_late = a.statut === "prelevee" && a.date_prelevement && (now - a.date_prelevement) > THREE_DAYS;
          const canonical = VARIETE_FERME_OVERRIDE[(a.variete || "").toUpperCase()];
          if (canonical && a.ferme !== canonical) {
            console.log(`ferme override: ${d.id} variete=${a.variete} ${a.ferme}→${canonical}`);
            a.ferme = canonical;
            fixPromises.push(d.ref.update({ ferme: canonical, updated_at: Date.now() }).catch(e => console.error("override persist failed", d.id, e.message)));
          }
          return a;
        });
        if (fixPromises.length) await Promise.all(fixPromises);
        if (ferme) analyses = analyses.filter(a => a.ferme === ferme);
        analyses.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // parcelles_overdue was per-parcelle and couldn't credit AGQ imports
        // (which have parcelle: null, classified by ferme+variete instead).
        // The V5 AI panel now surfaces gaps contextually. Field kept for API back-compat.
        const parcelles_overdue = [];

        const counts = {
          demandees: analyses.filter(a => a.statut === "demandee").length,
          commandees: analyses.filter(a => a.statut === "commandee").length,
          prelevees: analyses.filter(a => a.statut === "prelevee").length,
          completees: analyses.filter(a => a.statut === "completee").length,
          en_retard: analyses.filter(a => a.is_result_late).length,
        };
        return res.json({ success: true, analyses, parcelles_overdue, counts });
      }

      if (action === "get-variete-contexte") {
        const { ferme, variete } = req.query;
        if (!ferme || !variete) return res.status(400).json({ success: false, error: "ferme et variete requis" });
        const docId = `${ferme}_${(variete || "").toUpperCase().replace(/\s+/g, "_")}`;
        const doc = await db_firestore.collection("variete_contextes").doc(docId).get();
        return res.json({ success: true, contexte: doc.exists ? doc.data() : null });
      }

      if (action === "save-variete-contexte" && req.method === "POST") {
        const { ferme, variete, contexte_general, updated_by } = req.body;
        if (!ferme || !variete) return res.status(400).json({ success: false, error: "ferme et variete requis" });
        const docId = `${ferme}_${(variete || "").toUpperCase().replace(/\s+/g, "_")}`;
        await db_firestore.collection("variete_contextes").doc(docId).set({
          ferme, variete, contexte_general: contexte_general || "",
          updated_at: Date.now(), updated_by: updated_by || {},
        }, { merge: true });
        return res.json({ success: true });
      }

      if (action === "create-analyse-foliaire" && req.method === "POST") {
        const { ferme, parcelle, culture, type_analyse, variete, phenologie, note_demande, photo_base64, photo_filename, created_by } = req.body;
        if (!ferme) return res.status(400).json({ success: false, error: "ferme requis" });
        const numero = await getNextNumber("analyse_foliaire", "AF");
        const now = Date.now();
        const cultureInferred = culture || (parcelle && (parcelle.toLowerCase().includes("hass") || parcelle.toLowerCase().includes("fuerte")) ? "Avocatier" : parcelle && parcelle.toLowerCase().includes("framboise") ? "Framboise" : parcelle ? "Myrtille" : null);
        const data = {
          numero, ferme,
          parcelle: parcelle || null,
          culture: cultureInferred,
          type_analyse: type_analyse || "foliaire",
          variete: variete || null,
          phenologie: phenologie || null,
          source: "manual",
          statut: "demandee",
          date_demande: now,
          date_prelevement: null,
          date_resultat: null,
          bdc_id: null,
          photo_parcelle_url: null,
          scan_resultat_url: null,
          note_demande: note_demande || "",
          recommandations_ia: [],
          history: [{ action: "creation", by: created_by || {}, at: now, comment: "" }],
          created_by: created_by || {},
          created_at: now, updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(data);

        // Upload photo si fournie
        if (photo_base64) {
          try {
            const buffer = Buffer.from(photo_base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
            const ext = (photo_filename || "photo.jpg").split(".").pop() || "jpg";
            const storagePath = `analyses_foliaires/${ref.id}/photo_parcelle.${ext}`;
            const file = bucket.file(storagePath);
            await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
            const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
            await ref.update({ photo_parcelle_url: url });
            data.photo_parcelle_url = url;
          } catch (e) { console.error("Upload photo AF:", e.message); }
        }

        return res.json({ success: true, id: ref.id, numero });
      }

      if (action === "update-analyse-foliaire" && req.method === "POST") {
        const { id, statut, bdc_id, comment, updated_by } = req.body;
        if (!id || !statut) return res.status(400).json({ success: false, error: "id et statut requis" });
        const VALID = ["demandee","commandee","prelevee","completee"];
        if (!VALID.includes(statut)) return res.status(400).json({ success: false, error: "Statut invalide" });
        const docRef = db_firestore.collection("analyses_foliaires").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Analyse non trouvée" });
        const current = snap.data();
        const updates = { statut, updated_at: Date.now(), updated_by: updated_by || {} };
        if (bdc_id) updates.bdc_id = bdc_id;
        if (statut === "prelevee" && !current.date_prelevement) updates.date_prelevement = Date.now();
        const history = current.history || [];
        history.push({ action: `passage_${statut}`, by: updated_by || {}, at: Date.now(), comment: comment || "" });
        updates.history = history;
        await docRef.update(updates);
        return res.json({ success: true });
      }

      if (action === "upload-scan-analyse" && req.method === "POST") {
        const { id, scan_base64, filename, uploaded_by } = req.body;
        if (!id || !scan_base64) return res.status(400).json({ success: false, error: "id et scan_base64 requis" });
        const docRef = db_firestore.collection("analyses_foliaires").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Analyse non trouvée" });
        const buffer = Buffer.from(scan_base64.replace(/^data:image\/\w+;base64,|^data:application\/pdf;base64,/, ""), "base64");
        const ext = (filename || "scan.pdf").split(".").pop() || "pdf";
        const storagePath = `analyses_foliaires/${id}/scan_resultat.${ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        const current = snap.data();
        const history = current.history || [];
        history.push({ action: "upload_scan", by: uploaded_by || {}, at: Date.now(), comment: "" });
        await docRef.update({ scan_resultat_url: scan_url, date_resultat: Date.now(), statut: "completee", history, updated_at: Date.now() });
        return res.json({ success: true, scan_url });
      }

      // ========== SURVEILLANCE AGRO — observation terrain (photos) ==========

      if (action === "create-observation-terrain" && req.method === "POST") {
        const { ferme, variete, culture, note, photos, created_by } = req.body;
        if (!ferme) return res.status(400).json({ success: false, error: "ferme requis" });
        if (!variete) return res.status(400).json({ success: false, error: "variete requis" });
        if (!photos || !photos.length) return res.status(400).json({ success: false, error: "au moins 1 photo requise" });
        if (photos.length > 5) return res.status(400).json({ success: false, error: "max 5 photos" });

        const now = Date.now();
        const docData = {
          type_analyse: "observation_terrain",
          ferme,
          variete,
          culture: culture || null,
          parcelle: null,
          date_analyse: now,
          statut: "completee",
          source: "manual",
          photo_urls: [],
          note_demande: note || "",
          parsed_values: {},
          recommandations_ia: [],
          terrain_raw: note || "",
          created_by: created_by || { name: "unknown" },
          created_at: now,
          updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(docData);

        const photoUrls = [];
        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];
          const cleanBase64 = (p.base64 || "").replace(/^data:image\/\w+;base64,/, "");
          if (!cleanBase64) continue;
          const buffer = Buffer.from(cleanBase64, "base64");
          const storagePath = `analyses_foliaires/${ref.id}/photos/${now}_${i}.jpg`;
          const file = bucket.file(storagePath);
          await file.save(buffer, { metadata: { contentType: "image/jpeg" } });
          const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
          photoUrls.push({
            url,
            storage_path: storagePath,
            caption: p.caption || "",
            taken_at: now,
            location: p.location || null,
          });
        }

        const firstGeo = photoUrls.find(p => p.location);
        const updateData = { photo_urls: photoUrls, updated_at: Date.now() };
        if (firstGeo) updateData.location = firstGeo.location;
        await ref.update(updateData);
        return res.json({ success: true, id: ref.id, photo_count: photoUrls.length });
      }

      if (action === "import-analyse-agq" && req.method === "POST") {
        const { pdf_base64, filename, source_email, created_by } = req.body;
        if (!pdf_base64) return res.status(400).json({ success: false, error: "pdf_base64 requis" });
        const { parseAgqPdf } = require("../../../agqParser");
        const pdfBuffer = Buffer.from(pdf_base64.replace(/^data:application\/pdf;base64,/, ""), "base64");

        let parsed;
        try {
          parsed = await parseAgqPdf(pdfBuffer, {
            subject: source_email?.subject || "",
            attachmentName: filename || "",
          });
        } catch (e) {
          return res.status(500).json({ success: false, error: "Parse AGQ: " + e.message });
        }

        if (!parsed.ferme) {
          return res.status(422).json({ success: false, error: "Ferme non détectée dans le PDF", parsed });
        }

        // Idempotence: skip if we already imported this exact attachment.
        if (source_email?.messageId && filename) {
          const dup = await db_firestore.collection("analyses_foliaires")
            .where("source_email.messageId", "==", source_email.messageId)
            .where("source_email.attachment_name", "==", filename)
            .limit(1)
            .get();
          if (!dup.empty) {
            return res.json({ success: true, skipped: true, id: dup.docs[0].id, reason: "duplicate" });
          }
        }

        const numero = await getNextNumber("analyse_foliaire", "AF");
        const now = Date.now();
        const receivedAt = source_email?.received_at ? new Date(source_email.received_at).getTime() : now;
        const data = {
          numero,
          ferme: parsed.ferme,
          parcelle: null,
          culture: parsed.culture,
          type_analyse: parsed.type_analyse,
          variete: parsed.variete,
          propriete_raw: parsed.propriete_raw,
          terrain_raw: parsed.terrain_raw,
          client_raw: parsed.client_raw,
          phenologie: parsed.phenologie,
          parsed_values: parsed.parsed_values || {},
          parsed_header_line: parsed.parsed_header_line || null,
          source: "email_agq",
          source_email: {
            messageId: source_email?.messageId || null,
            subject: source_email?.subject || null,
            from: source_email?.from || null,
            received_at: receivedAt,
            attachment_name: filename || null,
          },
          statut: "completee",
          date_demande: receivedAt,
          date_prelevement: parsed.date_analyse || receivedAt,
          date_resultat: receivedAt,
          date_analyse: parsed.date_analyse || null,
          bdc_id: null,
          photo_parcelle_url: null,
          scan_resultat_url: null,
          note_demande: "",
          recommandations_ia: [],
          history: [{ action: "import_email_agq", by: created_by || { name: "system" }, at: now, comment: filename || "" }],
          created_by: created_by || { name: "system" },
          created_at: now,
          updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(data);

        // Upload the PDF as the analysis result scan.
        try {
          const safeName = (filename || "agq_report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `analyses_foliaires/${ref.id}/${safeName}`;
          const file = bucket.file(storagePath);
          await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
          const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
          await ref.update({ scan_resultat_url: url });
          data.scan_resultat_url = url;
        } catch (e) {
          console.error("Upload PDF AGQ:", e.message);
        }

        return res.json({ success: true, id: ref.id, numero, parsed });
      }

      if (action === "generate-reco-foliaire" && req.method === "POST") {
        const result = await generateRecoForAnalyse(req.body.id, req.body);
        if (result.success) return res.json(result);
        return res.json(result);
      }


      // ========== SCAN FACTURES (AI-powered invoice scanning) ==========

      if (action === "scan-facture" && req.method === "POST") {
        const { scan_base64, filename, ferme, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.pdf").split(".").pop().toLowerCase() || "pdf";
        const ts = Date.now();
        const storagePath = `scans/factures/${ts}_${filename || "scan." + ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const messageContent = [];
        const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
        const isPdf = ext === "pdf";

        if (isImage) {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } });
        } else if (isPdf) {
          // Try text extraction first (pdf-parse v2 API via shared helper)
          const pdfText = await scanAttachment.extractPdfText(buffer);

          if (pdfText.length > 50) {
            messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
          } else {
            // Scanned PDF - send as document to Claude
            messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } });
          }
        }

        const currentYear = new Date().getFullYear();
        const FACTURE_PROMPT = `Tu es un assistant spécialisé dans l'analyse de factures fournisseur pour Berry Good Farms.

ÉTAPE 1 - VÉRIFICATION (les 3 conditions doivent être remplies, sinon ACCEPTE):
1. Le nom du client sur la facture contient "BERRY GOOD" ou "BGF" (peu importe la forme juridique ou la ville)
2. Une adresse postale du client est mentionnée (n'importe quelle adresse au Maroc)
3. Un numéro ICE client est présent (nos ICE: 002106859000069 ou 001536944000082)
4. La date de la facture est de l'année ${currentYear}

IMPORTANT: Berry Good Farms a PLUSIEURS sites au Maroc (Agadir, Laarache, etc). Ne rejette PAS à cause de la ville ou l'adresse. Accepte tant que le nom contient "BERRY GOOD" ou "BGF".
Si ce n'est clairement PAS une facture pour Berry Good Farms → REJETTE avec explication.

ÉTAPE 2 - EXTRACTION DES DONNÉES:
Extrais les champs suivants en JSON strict:
{
  "accepted": true/false,
  "rejection_reason": "..." (si rejeté, explique pourquoi),
  "fournisseur": { "nom": "...", "ice": "...", "adresse": "..." },
  "numero_facture": "...",
  "date_facture": "YYYY-MM-DD",
  "date_echeance": "YYYY-MM-DD",
  "items": [
    { "article": "...", "quantite": 0, "unite": "...", "prix_unitaire": 0, "taux_tva": 20, "montant_ht": 0 }
  ],
  "total_ht": 0,
  "total_tva": 0,
  "total_ttc": 0,
  "confidence": 0.0,
  "notes": "..."
}

IMPORTANT: Retourne UNIQUEMENT le JSON, sans texte avant ou après. Les montants sont en MAD (Dirhams marocains). Si un champ n'est pas lisible, mets null.`;

        messageContent.push({ type: "text", text: FACTURE_PROMPT });

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-facture", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          // Try to extract JSON from the response
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        // 4) BDC Matching (if accepted)
        let matched_bdc = null;
        if (analysis.accepted) {
          const fournisseurNom = (analysis.fournisseur?.nom || "").toLowerCase().trim();
          const totalTtc = parseFloat(analysis.total_ttc) || 0;

          // Try matching by fournisseur name
          if (fournisseurNom) {
            const bdcSnap = await db_firestore.collection("purchase_orders")
              .where("status", "in", ["valide_dg", "envoye"])
              .orderBy("created_at", "desc").limit(100).get();

            const candidates = bdcSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(b => {
                const bNom = (b.fournisseur?.nom || "").toLowerCase().trim();
                return bNom.includes(fournisseurNom) || fournisseurNom.includes(bNom);
              });

            if (candidates.length > 0) {
              // Rank by amount proximity
              candidates.sort((a, b) => {
                const aDiff = Math.abs((a.total_ttc || 0) - totalTtc);
                const bDiff = Math.abs((b.total_ttc || 0) - totalTtc);
                return aDiff - bDiff;
              });
              const best = candidates[0];
              const ecartPct = totalTtc > 0 ? Math.abs((best.total_ttc || 0) - totalTtc) / totalTtc * 100 : 100;
              matched_bdc = {
                id: best.id, numero: best.numero,
                fournisseur_nom: best.fournisseur?.nom || "",
                total_ttc: best.total_ttc || 0,
                ecart_pct: Math.round(ecartPct * 10) / 10,
                confidence: ecartPct < 5 ? "high" : ecartPct < 15 ? "medium" : "low",
                all_candidates: candidates.slice(0, 5).map(c => ({ id: c.id, numero: c.numero, total_ttc: c.total_ttc })),
              };
            }
          }
        }

        // 5) Save scan metadata to Firestore
        const scanData = {
          scan_url, scan_filename: filename || "scan." + ext, scan_type: isImage ? "image" : "pdf",
          status: analysis.accepted ? "accepted" : "rejected",
          rejection_reason: analysis.rejection_reason || null,
          analysis, matched_bdc_id: matched_bdc?.id || null, matched_bdc_numero: matched_bdc?.numero || null,
          invoice_id: null, invoice_numero: null, ferme: ferme || "",
          created_by: created_by || {}, created_at: ts, updated_at: ts,
        };
        const scanDocRef = await db_firestore.collection("invoice_scans").add(scanData);

        return res.json({ success: true, scan_id: scanDocRef.id, scan_url, analysis, matched_bdc });
      }

      // ========== SCAN BL (AI-powered delivery note scanning) ==========

      if (action === "scan-bl" && req.method === "POST") {
        const { scan_base64, filename, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.pdf").split(".").pop().toLowerCase() || "pdf";
        const ts = Date.now();
        const storagePath = `scans/bl/${ts}_${filename || "scan." + ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const messageContent = [];
        const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
        const isPdf = ext === "pdf";

        if (isImage) {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } });
        } else if (isPdf) {
          // pdf-parse v2 API via shared helper
          const pdfText = await scanAttachment.extractPdfText(buffer);

          if (pdfText.length > 50) {
            messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
          } else {
            messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } });
          }
        }

        const BL_PROMPT = `Tu es un assistant spécialisé dans l'analyse de bons de livraison (BL) pour Berry Good Farms SARL.

Extrais les données du bon de livraison en JSON strict:
{
  "fournisseur_nom": "...",
  "date_reception": "YYYY-MM-DD",
  "numero_bl_fournisseur": "...",
  "numero_bdc_reference": "..." (si un numéro de bon de commande est mentionné, sinon null),
  "items": [
    { "article": "...", "quantite_recue": 0, "unite": "...", "lot": "..." }
  ],
  "notes": "..."
}

IMPORTANT: Retourne UNIQUEMENT le JSON, sans texte avant ou après. Si un champ n'est pas lisible, mets null.`;

        messageContent.push({ type: "text", text: BL_PROMPT });

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-bl", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        // 4) BDC Matching
        let matched_bdc = null;
        const fournisseurNom = (analysis.fournisseur_nom || "").toLowerCase().trim();
        const bdcRef = analysis.numero_bdc_reference;

        // Try by BDC number reference first
        if (bdcRef) {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("numero", "==", bdcRef).limit(1).get();
          if (!bdcSnap.empty) {
            const d = bdcSnap.docs[0];
            matched_bdc = { id: d.id, numero: d.data().numero, fournisseur_nom: d.data().fournisseur?.nom || "", items: d.data().items || [], confidence: "high" };
          }
        }

        // Fallback: match by fournisseur name
        if (!matched_bdc && fournisseurNom) {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("status", "in", ["valide_dg", "envoye"])
            .orderBy("created_at", "desc").limit(100).get();
          const candidates = bdcSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(b => {
              const bNom = (b.fournisseur?.nom || "").toLowerCase().trim();
              return bNom.includes(fournisseurNom) || fournisseurNom.includes(bNom);
            })
            .filter(b => b.delivery_status !== "complet");

          if (candidates.length > 0) {
            const best = candidates[0];
            matched_bdc = {
              id: best.id, numero: best.numero,
              fournisseur_nom: best.fournisseur?.nom || "",
              items: best.items || [],
              confidence: "medium",
              all_candidates: candidates.slice(0, 5).map(c => ({ id: c.id, numero: c.numero })),
            };
          }
        }

        // 5) Save scan metadata
        const scanData = {
          scan_url, scan_filename: filename || "scan." + ext, scan_type: isImage ? "image" : "pdf",
          analysis, matched_bdc_id: matched_bdc?.id || null, matched_bdc_numero: matched_bdc?.numero || null,
          bl_id: null, bl_numero: null,
          created_by: created_by || {}, created_at: ts,
        };
        const scanDocRef = await db_firestore.collection("bl_scans").add(scanData);

        return res.json({ success: true, scan_id: scanDocRef.id, scan_url, analysis, matched_bdc });
      }

      // ========== UNIFIED ATTACHMENT (client-direct upload model) ==========
      // The file is uploaded DIRECTLY from the client to Firebase Storage
      // (bypasses the 10 MB CF payload limit). This action only records the
      // metadata on the target doc and returns a V4 signed read URL.
      if (action === "upload-attachment" && req.method === "POST") {
        const { entity_type, entity_id, scan_path, filename } = req.body || {};
        const validation = scanAttachment.utils.validateUploadAttachmentParams({ entity_type, entity_id, scan_path, filename });
        if (!validation.valid) return res.status(400).json({ success: false, error: validation.error });

        const collection = scanAttachment.utils.collectionForEntity(entity_type);
        const docRef = db_firestore.collection(collection).doc(entity_id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ success: false, error: "Document cible introuvable" });

        // Confirm the object actually exists in the bucket before recording it.
        let exists = false;
        try { [exists] = await bucket.file(scan_path).exists(); } catch (_) { exists = false; }
        if (!exists) return res.status(400).json({ success: false, error: "Fichier introuvable dans le stockage (upload incomplet ?)" });

        // SERVER-SIDE ENFORCEMENT (replaces the size/MIME constraints removed
        // from the Storage rules — unreliable on resumable/mobile uploads).
        // Read the real object metadata and validate BEFORE writing any link.
        // A rejected object is deleted so no orphan object/link is left behind.
        let objMeta = null;
        try { [objMeta] = await bucket.file(scan_path).getMetadata(); } catch (_) { objMeta = null; }
        if (!objMeta) return res.status(400).json({ success: false, error: "Métadonnées du fichier illisibles" });
        const metaCheck = scanAttachment.validateAttachmentMetadata({ size: objMeta.size, contentType: objMeta.contentType });
        if (!metaCheck.valid) {
          try { await bucket.file(scan_path).delete(); } catch (_) { /* best effort cleanup */ }
          return res.status(400).json({ success: false, error: metaCheck.error });
        }

        const signedUrl = await scanAttachment.generateSignedUrl(bucket, scan_path);
        const now = Date.now();
        const uploadedBy = {
          uid: authUser.uid || null,
          email: authUser.email || null,
          name: (req.body.uploaded_by && req.body.uploaded_by.name) || null,
          profileId: (req.body.uploaded_by && req.body.uploaded_by.profileId) || null,
        };
        await docRef.update({
          scan_url: signedUrl || null,
          scan_path,
          scan_filename: filename || scanAttachment.utils.sanitizeFilename(filename),
          scan_uploaded_at: now,
          scan_uploaded_by: uploadedBy,
          updated_at: now,
        });

        return res.json({ success: true, scan_url: signedUrl, scan_path, scan_uploaded_at: now });
      }

      // Generate (or refresh) a V4 signed read URL for an existing attachment.
      // Used by the list viewers so we never expose a public/no-ACL URL (cause C).
      if (action === "get-attachment-url") {
        const entityType = req.query.entity_type;
        const entityId = req.query.entity_id;
        if (!scanAttachment.utils.isValidEntityType(entityType)) {
          return res.status(400).json({ success: false, error: "entity_type invalide" });
        }
        if (!entityId) return res.status(400).json({ success: false, error: "entity_id requis" });
        const collection = scanAttachment.utils.collectionForEntity(entityType);
        const docSnap = await db_firestore.collection(collection).doc(entityId).get();
        if (!docSnap.exists) return res.status(404).json({ success: false, error: "Document introuvable" });
        const data = docSnap.data();
        const scanPath = data.scan_path || null;
        if (!scanPath) return res.json({ success: true, scan_url: null });
        const signedUrl = await scanAttachment.generateSignedUrl(bucket, scanPath);
        return res.json({ success: true, scan_url: signedUrl, scan_path: scanPath });
      }

      // ========== SOUMISSION FICHIERS STOCK (magasinier) ==========
      // docs/spec-collecte-stock-magasinier.md §4.1. Écriture partagée par les
      // 2 canaux (app + WhatsApp) via functions/lib/stockFiles/recordSubmission.js.
      // Le fichier est uploadé CLIENT-DIRECT vers Storage (même modèle que
      // upload-attachment) ; cette action ne fait que valider + enregistrer.

      if (action === "stock-file-submit" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body — cf.
        // commentaire fonctions/index.js:5121 et CLAUDE.md.
        const callerRole = await resolveCallerRole(authUser);
        if (callerRole !== "magasinier" && callerRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const { farm, storage_path, filename } = req.body || {};
        if (!stockFilesRecord.isValidFarm(farm)) {
          return res.status(400).json({ success: false, error: "farm invalide (attendu: berry_good|bahia)" });
        }
        if (!storage_path) {
          return res.status(400).json({ success: false, error: "storage_path requis" });
        }

        // Confirme que l'objet existe réellement dans le bucket avant de l'enregistrer.
        let exists = false;
        try { [exists] = await bucket.file(storage_path).exists(); } catch (_) { exists = false; }
        if (!exists) return res.status(400).json({ success: false, error: "Fichier introuvable dans le stockage (upload incomplet ?)" });

        // ENFORCEMENT SERVEUR taille/MIME — même fonction que upload-attachment
        // (pas de règle dupliquée entre les flux d'upload). Objet rejeté → suppression
        // best-effort pour ne laisser aucun orphelin.
        let objMeta = null;
        try { [objMeta] = await bucket.file(storage_path).getMetadata(); } catch (_) { objMeta = null; }
        if (!objMeta) return res.status(400).json({ success: false, error: "Métadonnées du fichier illisibles" });
        const metaCheck = scanAttachment.validateAttachmentMetadata({ size: objMeta.size, contentType: objMeta.contentType }, STOCK_FILE_ALLOWED_MIME);
        if (!metaCheck.valid) {
          try { await bucket.file(storage_path).delete(); } catch (_) { /* best effort cleanup */ }
          const error = /non autorisé/.test(metaCheck.error)
            ? `${metaCheck.error} (formats acceptés : ${STOCK_FILE_ALLOWED_FORMATS_LABEL})`
            : metaCheck.error;
          return res.status(400).json({ success: false, error });
        }

        // Date TOUJOURS calculée côté serveur (Africa/Casablanca) — jamais
        // l'horloge client (cf. spec §4.1 et CLAUDE.md).
        const date = stockFilesRecord.todayInCasablanca();
        const submittedBy = {
          uid: authUser.uid || null,
          name: (req.body.submitted_by && req.body.submitted_by.name) || authUser.name || authUser.email || null,
          email: authUser.email || null,
          source: "app",
        };

        const result = await stockFilesRecord.recordSubmission(
          { db: db_firestore, serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp() },
          { date, farm, storagePath: storage_path, filename, submittedBy }
        );
        if (!result.success) return res.status(400).json(result);
        return res.json({ success: true, submitted_at: Date.now() });
      }

      if (action === "stock-file-history") {
        const daysParam = parseInt(req.query.days || "30", 10);
        const days = Math.min(Math.max(Number.isFinite(daysParam) ? daysParam : 30, 1), 90);
        const today = stockFilesRecord.todayInCasablanca();

        const dates = [];
        for (let i = 0; i < days; i++) dates.push(stockFilesRecord.addDaysStr(today, -i));

        const results = await Promise.all(dates.map(async (date) => {
          const snap = await db_firestore.collection(stockFilesRecord.COLLECTION).doc(date).get();
          const doc = snap.exists ? snap.data() : stockFilesRecord.emptySubmissionDoc(date);
          const toMillis = (ts) => (ts && typeof ts.toMillis === "function") ? ts.toMillis() : (ts || null);
          return {
            date,
            berry_good: {
              submitted: !!(doc.berry_good && doc.berry_good.submitted),
              submitted_at: toMillis(doc.berry_good && doc.berry_good.submitted_at),
              submitted_by: (doc.berry_good && doc.berry_good.submitted_by) || null,
            },
            bahia: {
              submitted: !!(doc.bahia && doc.bahia.submitted),
              submitted_at: toMillis(doc.bahia && doc.bahia.submitted_at),
              submitted_by: (doc.bahia && doc.bahia.submitted_by) || null,
            },
          };
        }));
        // Déjà du plus récent au plus ancien (dates construites par soustraction depuis today).
        return res.json({ success: true, days: results });
      }

      // AJOUTÉ le 2026-08-05 (spec §4.1) — consultation/téléchargement d'un
      // fichier stock déjà soumis. Mêmes rôles que stock-file-history, résolus
      // SERVEUR (resolveCallerRole) — jamais depuis le body/query client.
      if (action === "stock-file-download-url") {
        const callerRole = await resolveCallerRole(authUser);
        if (callerRole !== "magasinier" && callerRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const date = req.query.date;
        const farm = req.query.farm;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ success: false, error: "date invalide (YYYY-MM-DD requis)" });
        }
        if (!stockFilesRecord.isValidFarm(farm)) {
          return res.status(400).json({ success: false, error: "farm invalide (attendu: berry_good|bahia)" });
        }

        const snap = await db_firestore.collection(stockFilesRecord.COLLECTION).doc(date).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Aucune soumission pour cette date" });
        const doc = snap.data();
        const filePath = doc[farm] && doc[farm].file_path;
        if (!filePath) return res.status(404).json({ success: false, error: "Aucun fichier soumis pour cette ferme ce jour-là" });

        const downloadUrl = await scanAttachment.generateSignedUrl(bucket, filePath);
        return res.json({ success: true, download_url: downloadUrl, file_name: (doc[farm] && doc[farm].file_name) || null });
      }

      // ========== SCAN HISTORY ==========

      if (action === "list-scan-history") {
        const type = req.query.type || "facture"; // "facture" or "bl"
        const limit = parseInt(req.query.limit || "50");
        const collection = type === "bl" ? "bl_scans" : "invoice_scans";
        const snap = await db_firestore.collection(collection).orderBy("created_at", "desc").limit(limit).get();
        const scans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, scans });
      }

      // ========== SCAN BON D'APPORT (AI-powered production bon scanning) ==========

      if (action === "scan-bon-apport" && req.method === "POST") {
        const { scan_base64, filename, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.jpg").split(".").pop().toLowerCase() || "jpg";
        const ts = Date.now();
        const storagePath = `scans/bons_apport/${ts}_${filename || "scan." + ext}`;
        const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const messageContent = [
          { type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } },
          { type: "text", text: `Tu es un assistant spécialisé dans la lecture de bons d'apport de production agricole pour Berry Good Farms (culture de framboise et myrtille au Maroc).

DATE IMPORTANTE: Nous sommes en ${new Date().toISOString().split('T')[0]}. Les bons scannés datent généralement de J-1 ou J-2 (hier ou avant-hier). L'année est TOUJOURS 2026 (saison 2025-2026). Si tu lis une date ambiguë, utilise 2026 comme année.

Extrais les données du bon d'apport en JSON strict:
{
  "numero_bon": "..." (numéro du bon d'apport, souvent en haut du document en rouge),
  "date": "YYYY-MM-DD" (date de récolte — sur le bon elle est au format français JJ/MM/AAAA, convertis en YYYY-MM-DD. L'année est 2026),
  "ferme": "F1" ou "F5" (IMPORTANT: détermine la ferme par le secteur/parcelle: S1-S7 et GG → F1, S8, S8-1, S8-2, S9, S10, S13 → F5. Aussi par N° Camion: 172 → F1, 195 → F5. Cherche dans "Producteur / Ferme" ou "Parcelle / Bloc"),
  "variete": "..." (désignation EXACTE du bloc — utilise une de ces valeurs: "MARAVILLA GG F1", "S10 YAZMIN CUT BACK F5", "S9 REYNA F5", "CORINA MYRTILLE S8", "BREEZE MYRTILLE S8-2", "CASCADE MYRTILLE S8-1". Identifie la variété et la ferme pour choisir la bonne désignation),
  "parcelle": "..." (parcelle/bloc si mentionné),
  "lignes": [
    {
      "description": "..." (type d'unité de livraison, ex: "Carton Driscoll's Barquette en quarton 10x300g PPE". Pour Marché Local, inclure le nom de la variété si visible),
      "variete": "..." (variété de cette ligne si identifiable — utiliser les mêmes désignations que le champ variete ci-dessus. Important pour les bons Marché Local multi-variétés),
      "nombre_colis": 0 (nombre dans la colonne "Nombre"),
      "poids_unitaire_kg": 0 (quantité de produit par unité de chargement en kg, ex: 3 pour "163 x3"),
      "quantite_kg": 0 (quantité totale en kg pour cette ligne)
    }
  ],
  "poids_kg": 0 (poids TOTAL de toutes les lignes en kg — somme des quantite_kg),
  "nombre_colis_total": 0 (somme de tous les nombre_colis),
  "type_vente": "Export" ou "Marché Local" (si mentionné, sinon "Export"),
  "client": "..." (nom du client si mentionné, sinon "Driscoll's" pour export),
  "semaine": "..." (numéro de semaine si mentionné, sinon null),
  "notes": "..." (informations supplémentaires, traitement phytosanitaire, etc.)
}

IMPORTANT:
- Retourne UNIQUEMENT le JSON, sans texte avant ou après
- Le numéro de bon est crucial — cherche-le attentivement (souvent en rouge en haut)
- Lis CHAQUE ligne du tableau "Type d'unité de livraison" séparément
- Vérifie que la somme des quantite_kg des lignes = poids_kg total
- Pour les bons "Marché Local", un même bon peut contenir PLUSIEURS variétés — identifie la variété de chaque ligne et remplis le champ "variete" de chaque ligne
- Si un champ n'est pas lisible, mets null` }
        ];

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 1500, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-bon-apport", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        return res.json({ success: true, scan_url, analysis });
      }

      // ========== SCAN BON DE CONSOMMATION INTERNE (matrice piles x articles) ==========
      // Toute la logique métier vit dans functions/lib/stock/bcScan.js (module PUR,
      // couvert par tests/unit/bcScan.test.js). Ici : upload + appel vision +
      // rapprochement catalogue/parcelles. AUCUNE écriture métier : le BC n'est
      // créé qu'ensuite, par l'action `create-bc` inchangée.

      if (action === "scan-bc" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body — même
        // garde que save-bc-scan-alias. Sans elle, n'importe quel profil
        // authentifié (chef, RH, ouvrier) pourrait déclencher un appel Opus et
        // un upload Storage, alors que le bouton n'est exposé qu'au magasinier.
        const scanBcRole = await resolveCallerRole(authUser);
        if (scanBcRole !== "magasinier" && scanBcRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const { scan_base64, filename, type } = req.body || {};
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Type MIME RÉEL du scan — déduit du préfixe data-url, PAS de
        //    l'extension du filename : le client ré-encode toujours en JPEG
        //    (public/lib/imageDownscale.js), donc « bon.png » porte des octets
        //    JPEG. Cf. bcScan.resolveScanMedia (module pur, testé). Le même
        //    mediaType sert à l'appel vision ET au contentType Storage.
        const rawName = String(filename || "scan.jpg");
        const media = bcScan.resolveScanMedia(scan_base64, rawName);
        if (!media.ok) return res.status(400).json({ success: false, error: media.error });
        const mediaType = media.mediaType;

        // Taille bornée pour ne pas saturer la mémoire de la function.
        const cleanBase64 = scan_base64.replace(/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+\s*;\s*base64,/i, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const BC_SCAN_MAX_BYTES = 8 * 1024 * 1024;
        if (buffer.length > BC_SCAN_MAX_BYTES) {
          const mo = (buffer.length / (1024 * 1024)).toFixed(1);
          return res.status(400).json({ success: false, error: `Image trop lourde (${mo} Mo) : maximum 8 Mo` });
        }

        // 2) Upload du scan (trace + pièce jointe du futur BC).
        const ts = Date.now();
        const storagePath = `scans/bons_consommation/${ts}_${rawName}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: mediaType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 3) Référentiels — lus AVANT l'appel vision, car ils alimentent
        //    désormais le VOCABULAIRE injecté dans le prompt (et non plus
        //    seulement le rapprochement d'après-coup).
        //    `consumption_vouchers` est borné aux 200 bons les plus récents :
        //    on ne cherche qu'à savoir ce que le magasinier consomme vraiment,
        //    pas à parcourir l'historique complet à chaque photo.
        const [artSnapBc, aliasSnapBc, bonsSnapBc] = await Promise.all([
          db_firestore.collection("articles_catalog").where("active", "==", true).get(),
          db_firestore.collection("bc_scan_aliases").get(),
          db_firestore.collection("consumption_vouchers").orderBy("date", "desc").limit(200).get()
            .catch(() => null),
        ]);
        const catalogueBc = artSnapBc.docs
          .map(d => ({ nom: (d.data() || {}).nom || "", categorie: (d.data() || {}).categorie || "" }))
          .filter(a => a.nom);
        // Noms d'articles vus dans les bons récents. Panne de lecture (index
        // manquant sur `date`) -> liste vide : le vocabulaire retombe sur le
        // seul filtre de catégorie, jamais d'erreur remontée au magasinier.
        const consommesBc = [];
        if (bonsSnapBc) {
          bonsSnapBc.forEach((d) => {
            const items = (d.data() || {}).items;
            if (!Array.isArray(items)) return;
            items.forEach((it) => { if (it && it.article) consommesBc.push(String(it.article)); });
          });
        }

        // 4) Appel vision. `today` est INJECTÉ dans le prompt : aucune année en
        //    dur (défaut du prompt scan-bon-apport, figé sur 2026).
        const today = new Date().toISOString().split("T")[0];
        const Anthropic = require("@anthropic-ai/sdk");
        const bcClient = new Anthropic({ apiKey });
        // VOCABULAIRE injecté dans le prompt (lot B) : ARTICLES UNIQUEMENT.
        //
        // ⚠️ L'absence de vocabulaire de PARCELLES est un RETRAIT MESURÉ, pas un
        // oubli — ne pas le « rétablir » en croyant corriger une omission. Le
        // paramètre `parcelles` de buildBcScanPrompt existe toujours et reste
        // testé : seule l'alimentation depuis cette action a été retirée.
        // Mesuré sur les 7 bons de référence, 4 passages : 29/73 parcelles
        // pré-remplies AVEC la liste, 29/73 SANS. Aucun bénéfice, ~200 tokens
        // par image, et une surface de risque de forçage en plus sur la donnée
        // la plus coûteuse à se tromper (une consommation imputée à la mauvaise
        // parcelle est invisible). Le rapprochement des parcelles se fait côté
        // front (§5) et leur apprentissage par les alias du lot A.
        const bcPrompt = bcScan.buildBcScanPrompt({
          today,
          articles: bcScan.selectVocabArticles(catalogueBc, type || "", consommesBc),
        });
        // Ordre VOLONTAIRE : texte (stable au sein d'un lot) d'abord avec le
        // point de cache, image (variable) ensuite. Inversé, le préfixe ne
        // serait plus cachable. `cache_control` n'engage la mise en cache qu'au
        // delà du minimum de tokens du modèle ; en-dessous, l'appel se comporte
        // exactement comme avant (aucune erreur, aucun surcoût).
        const bcMessageContent = [
          { type: "text", text: bcPrompt, cache_control: { type: "ephemeral" } },
          { type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } },
        ];
        // Modèles — choix issu de la skill `claude-api` (source de vérité des ids
        // de modèles ; à reconsulter AVANT toute modification de cette liste).
        // - claude-opus-5 = modèle par défaut actuel (vision incluse) ;
        //   claude-opus-4-8 = repli d'une génération.
        // - Les ids sont COMPLETS tels quels : ne JAMAIS y ajouter un suffixe de
        //   date. Ne pas régresser vers les snapshots figés de mai 2025 encore
        //   utilisés par les autres actions scan-*.
        // - `budget_tokens` et le prefill de message assistant sont bien rejetés
        //   en 400 sur cette génération. En revanche le sujet du raisonnement
        //   n'est PAS clos : sur claude-opus-5 le raisonnement adaptatif est
        //   ACTIF PAR DÉFAUT (contrairement à opus-4-8), et sa profondeur se
        //   pilote par `output_config.effort` — GA, sans en-tête beta, et
        //   uniquement DANS `output_config`, jamais à la racine du corps.
        // - On demande `effort: "low"` : lire un bon est une TRANSCRIPTION
        //   structurée, pas un problème de raisonnement. Mesuré sur les 7 bons
        //   de référence, 2 balayages entrelacés low/medium/high :
        //   fidélité IDENTIQUE aux trois niveaux (48/73 articles), mais 7,2 s
        //   par bon en `low` contre 11,2 s sans vocabulaire et ~15 s en `high`,
        //   et 460 tokens de sortie contre ~1000. `low` est aussi le SEUL
        //   niveau dont les sommes de quantités sont conformes au papier sur
        //   les 7 bons, aux deux passages.
        //   ⚠️ `output_config` n'est envoyé qu'à claude-opus-5, et la raison
        //   n'est PAS que le repli le refuserait : vérifié par sonde,
        //   claude-opus-4-8 l'accepte sans erreur. La raison est qu'on n'a
        //   mesuré l'effet de `effort` que sur opus-5 (le repli n'a pas de
        //   raisonnement actif par défaut, l'effet y est au mieux nul). Le
        //   repli est le chemin d'urgence : on n'y ajoute pas un paramètre
        //   dont on n'a pas mesuré le comportement.
        const BC_SCAN_MODELS = ["claude-opus-5", "claude-opus-4-8"];
        const BC_SCAN_EFFORT_MODELS = { "claude-opus-5": "low" };
        let bcResponse = null;
        let bcLastError = null;
        for (const modelId of BC_SCAN_MODELS) {
          try {
            const bcBody = {
              model: modelId,
              max_tokens: 3000,
              messages: [{ role: "user", content: bcMessageContent }],
            };
            if (BC_SCAN_EFFORT_MODELS[modelId]) {
              bcBody.output_config = { effort: BC_SCAN_EFFORT_MODELS[modelId] };
            }
            bcResponse = await bcClient.messages.create(bcBody);
            break;
          } catch (e) {
            bcLastError = e;
            console.error("Erreur modèle scan-bc", modelId, e.message);
          }
        }
        if (!bcResponse) {
          return res.json({ success: false, scan_url, error: `Appel IA impossible : ${bcLastError ? bcLastError.message : "erreur inconnue"}` });
        }

        const bcAiText = (bcResponse.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
        const analysis = bcScan.parseAiJson(bcAiText);
        if (!analysis) {
          return res.json({ success: false, scan_url, error: "Analyse IA impossible - réponse non structurée", raw: bcAiText });
        }

        // 5) Rapprochement — ARTICLES UNIQUEMENT (catalogue actif + alias mémorisés).
        //
        // Les PARCELLES ne sont volontairement PAS rapprochées côté serveur : le
        // backend ne peut pas savoir quelle liste le front affiche au magasinier
        // (mode `useConsoSelector` -> `refForCampagne`, sinon `/api/parcelles`,
        // plus les groupes). Et le seul référentiel disponible ici,
        // `sb_parcelle_referentiel` (15 entrées), est bien un SOUS-ENSEMBLE des
        // 43 labels de `sql_mirror_pointage_meta/br_parcelle_sup` qui alimentent
        // `parcelles-campagne-list`, donc le <select> — ses 15 labels y figurent
        // tous, les deux listes ne sont PAS disjointes. Mais c'est un
        // sous-ensemble PARTIEL (15/43) et NON FILTRÉ PAR CAMPAGNE : rapprocher
        // contre lui, c'est (a) ne jamais pouvoir proposer les 28 autres
        // parcelles — dont « S3 - MARAVILLA MOTTE F1 », la plus utilisée des
        // bons — et (b) pouvoir proposer une parcelle hors campagne courante,
        // absente du select, donc rejetée. On renvoie donc `parcelle_lue` brut
        // et un statut `unmatched` franc ; le rapprochement se fait côté front,
        // là où la liste affichée est connue, via bcScan.matchParcelle.
        const flatItems = bcScan.flattenBcScan(analysis);
        // catalogueBc / aliasSnapBc sont déjà lus au §3 (ils servent aussi au
        // vocabulaire du prompt) — pas de seconde lecture Firestore ici.
        // Forme objet {article_nom, count} : le compteur d'usage est remonté au
        // front (article_alias_count) pour distinguer un alias confirmé N fois
        // d'un alias posé une seule fois par un magasinier — un alias reste une
        // saisie humaine, jamais une certitude.
        const aliasesBc = {};
        aliasSnapBc.forEach((d) => {
          const data = d.data() || {};
          if (data.article_nom) {
            aliasesBc[d.id] = { article_nom: data.article_nom, count: parseInt(data.count, 10) || 0 };
          }
        });
        const items = flatItems.map((it) => {
          const am = bcScan.matchArticle(it.article_lu, catalogueBc, aliasesBc);
          return {
            article_lu: it.article_lu,
            article: am.article,
            article_status: am.status,
            article_score: am.score,
            article_alias_count: am.aliasCount,
            // parcelle_lue = texte brut de l'en-tête manuscrit, indispensable au
            // rapprochement front. Les 3 champs suivants gardent la forme du
            // contrat (le front les consomme déjà) mais ne sont plus renseignés
            // ici : c'est le front qui rapproche, avec la liste qu'il affiche.
            parcelle_lue: it.parcelle_lue,
            parcelle: "",
            parcelle_status: "unmatched",
            parcelle_candidats: [],
            quantite: it.quantite,
            unite: it.unite_lue,
            pile: it.pile,
            // barre : la ligne est rayée sur le papier. Elle n'est PLUS filtrée
            // (dernier chemin de perte silencieuse) — le front la grise et
            // laisse l'utilisateur trancher, la détection de rature pouvant
            // se tromper. Champ additif, toujours booléen.
            barre: it.barre === true,
          };
        });

        return res.json({ success: true, scan_url, type: type || null, analysis, items });
      }

      if (action === "list-bc-scan-aliases") {
        const snap = await db_firestore.collection("bc_scan_aliases").get();
        const aliases = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          if (data.article_nom) aliases[d.id] = data.article_nom;
        });
        return res.json({ success: true, aliases });
      }

      if (action === "save-bc-scan-alias" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        const aliasRole = await resolveCallerRole(authUser);
        if (aliasRole !== "magasinier" && aliasRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const { libelle_lu, article_nom, created_by } = req.body || {};
        if (!libelle_lu || !article_nom) {
          return res.status(400).json({ success: false, error: "Champs requis: libelle_lu, article_nom" });
        }
        const aliasId = bcScan.normalizeLabel(libelle_lu);
        if (!aliasId) return res.status(400).json({ success: false, error: "libelle_lu invalide" });

        const aliasRef = db_firestore.collection("bc_scan_aliases").doc(aliasId);
        const count = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(aliasRef);
          const prev = snap.exists ? (snap.data() || {}) : {};
          const nextCount = (parseInt(prev.count, 10) || 0) + 1;
          tx.set(aliasRef, {
            libelle_lu: String(libelle_lu),
            article_nom: String(article_nom),
            count: nextCount,
            created_by: prev.created_by || created_by || {},
            updated_at: Date.now(),
          }, { merge: true });
          return nextCount;
        });
        return res.json({ success: true, id: aliasId, count });
      }

      // ---- Alias de PARCELLE (en-tête de pile manuscrit -> libellé BEE ONE) ----
      // Symétrique des alias d'article, avec UNE différence structurante : la
      // CAMPAGNE fait partie de la clé. Le secteur 9 portait « S9 - REYNA F5 »
      // (3 ha) en 2025-2026 et porte « F5- MYA S9 » + « F5 YAZMIN MT » en
      // 2026-2027 : un alias appris l'an dernier imputerait la consommation à une
      // parcelle qui n'existe plus. Cf. docs/spec-scan-apprentissage.md, risque R1.
      //
      // La valeur mémorisée est le LIBELLÉ BEE ONE, jamais le nom Smart Berry :
      // ce dernier n'est qu'un habillage d'affichage, et un renommage
      // invaliderait silencieusement tous les alias appris.

      if (action === "list-bc-scan-parcelle-aliases") {
        // Rôle résolu SERVEUR, comme save-bc-scan-parcelle-alias : ces alias
        // n'ont d'usage que dans la modale de scan, réservée au magasinier.
        const listParcAliasRole = await resolveCallerRole(authUser);
        if (listParcAliasRole !== "magasinier" && listParcAliasRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const campagneAsked = String((req.query || {}).campagne || "").trim();
        // Sans campagne explicite, on ne renvoie RIEN : renvoyer « tous les alias »
        // reviendrait à laisser le front appliquer une correspondance d'une autre
        // campagne — exactement ce que la clé cherche à empêcher.
        if (!/^\d{4}-\d{4}$/.test(campagneAsked)) {
          return res.json({ success: true, campagne: "", aliases: {} });
        }
        const parcAliasSnap = await db_firestore.collection("bc_scan_parcelle_aliases")
          .where("campagne", "==", campagneAsked).get();
        const parcelleAliases = {};
        parcAliasSnap.forEach((d) => {
          const data = d.data() || {};
          if (data.normalise && data.parcelle) {
            parcelleAliases[data.normalise] = {
              parcelle: data.parcelle,
              count: parseInt(data.count, 10) || 0,
              campagne: data.campagne || campagneAsked,
            };
          }
        });
        return res.json({ success: true, campagne: campagneAsked, aliases: parcelleAliases });
      }

      if (action === "save-bc-scan-parcelle-alias" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        const parcAliasRole = await resolveCallerRole(authUser);
        if (parcAliasRole !== "magasinier" && parcAliasRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const { entete_lu, parcelle, campagne, created_by } = req.body || {};
        // En-tête illisible -> rien à apprendre (risque R6 : clé vide polluante).
        if (!entete_lu || !parcelle || !campagne) {
          return res.status(400).json({ success: false, error: "Champs requis: entete_lu, parcelle, campagne" });
        }
        const parcAliasId = bcScan.parcelleAliasDocId(campagne, entete_lu);
        if (!parcAliasId) {
          return res.status(400).json({ success: false, error: "entete_lu ou campagne invalide" });
        }
        const normalise = bcScan.normalizeLabel(entete_lu);

        const parcAliasRef = db_firestore.collection("bc_scan_parcelle_aliases").doc(parcAliasId);
        const parcCount = await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(parcAliasRef);
          const prev = snap.exists ? (snap.data() || {}) : {};
          // La DERNIÈRE décision humaine fait foi : si le magasinier choisit une
          // AUTRE parcelle pour le même en-tête, on écrase et le compteur repart
          // à 1 (module pur bcScan.nextParcelleAliasCount, testé unitairement).
          const memeParcelle = String(prev.parcelle || "") === String(parcelle);
          const nextCount = bcScan.nextParcelleAliasCount(prev, parcelle);
          tx.set(parcAliasRef, {
            entete_lu: String(entete_lu),
            normalise,
            campagne: String(campagne),
            parcelle: String(parcelle),
            count: nextCount,
            created_by: memeParcelle ? (prev.created_by || created_by || {}) : (created_by || {}),
            updated_by: created_by || {},
            updated_at: Date.now(),
          }, { merge: true });
          return nextCount;
        });
        return res.json({ success: true, id: parcAliasId, count: parcCount });
      }

      // ---- JOURNAL DE PRÉCISION DU SCAN (spec §4.4, lot C) --------------------
      // Un document par ligne ENREGISTRÉE — pas seulement par ligne corrigée.
      // Une proposition conservée est une CONFIRMATION : c'est le dénominateur,
      // sans lui aucun taux n'est calculable. Le journal sert à régler les
      // seuils (SIMILARITY_THRESHOLD / INCLUSION_THRESHOLD) sur des faits, et
      // surtout à faire apparaître les faux positifs avérés : une proposition
      // sortie en `exact` puis corrigée par le magasinier.
      //
      // ⚠️ Cette action est de l'OBSERVATION, jamais du métier. Le front
      // l'appelle APRÈS un `create-bc` réussi, en best effort : un échec ici ne
      // doit jamais faire échouer l'enregistrement du bon. Le contrat de
      // `create-bc` reste inchangé (purement additif).
      if (action === "save-bc-scan-journal" && req.method === "POST") {
        // Rôle résolu SERVEUR, jamais depuis le body — même garde que les alias.
        const journalRole = await resolveCallerRole(authUser);
        if (journalRole !== "magasinier" && journalRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }
        const { date: journalDate, bon_numero: journalBon, lignes: journalLignes } = req.body || {};
        // `corrige_par` est résolu SERVEUR (token + profil), jamais repris du
        // body : c'est une donnée d'audit, elle ne se déclare pas.
        const journalBuilt = bcScanJournal.buildJournalDocs({
          date: journalDate,
          bon_numero: journalBon,
          lignes: journalLignes,
          corrige_par: {
            uid: (authUser && authUser.uid) || "",
            profileId: journalRole,
            name: (authUser && (authUser.name || authUser.email)) || "",
          },
        });
        if (!journalBuilt.ok) {
          return res.status(400).json({ success: false, error: journalBuilt.error });
        }
        // Un bon fait une quinzaine de lignes : un seul batch suffit très
        // largement (plafond du module = 200, limite Firestore = 500).
        const journalBatch = db_firestore.batch();
        journalBuilt.docs.forEach((doc) => {
          journalBatch.set(db_firestore.collection("bc_scan_corrections").doc(), doc);
        });
        await journalBatch.commit();
        return res.json({
          success: true,
          campagne: journalBuilt.campagne,
          enregistrees: journalBuilt.docs.length,
          ignorees: journalBuilt.ignorees,
        });
      }

      // ========== SCAN FICHE IRRIGATION (AI-powered irrigation sheet scanning) ==========

      if (action === "scan-irrigation-sheet" && req.method === "POST") {
        const { scan_base64, filename } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.jpg").split(".").pop().toLowerCase() || "jpg";
        const ts = Date.now();
        const storagePath = `scans/irrigation/${ts}_${filename || "scan." + ext}`;
        const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const messageContent = [
          { type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } },
          { type: "text", text: `Tu es un assistant spécialisé dans la lecture de fiches d'irrigation manuscrites de Berry Good Farms (culture de framboise et myrtille au Maroc).

La fiche contient un tableau avec des lectures d'irrigation relevées par les stationnaires.
L'en-tête indique généralement la ferme (F1 ou F5) et la parcelle (ex: CORINA MYRTILLE S8).
Le tableau contient plusieurs lignes, chaque ligne correspondant à un relevé à une date/heure donnée.

Pour chaque ligne, on trouve :
- Heure de début
- Parcelle / secteur
- Pour chaque POINT d'irrigation (jusqu'à 4 points) : EC (conductivité électrique en mS/cm), pH, Volume (en litres)
- Pour chaque point de DRAINAGE correspondant : EC, pH, Volume (en % ou litres)

Les dates peuvent être inscrites en ligne ou en en-tête de section (ex: "14/03/2026" ou "14/ 03/ 2026").
L'année est TOUJOURS 2025 ou 2026 (saison 2025-2026).

Extrais TOUTES les lignes du tableau. Retourne un JSON strict :
{
  "ferme": "F1" ou "F5",
  "parcelle": "nom exact de la parcelle tel qu'inscrit sur la fiche",
  "lectures": [
    {
      "date": "YYYY-MM-DD",
      "heure": "HH:MM",
      "duree": 0,
      "points": [
        { "ec": 1.8, "ph": 6.2, "volume": 12.5 },
        { "ec": 1.9, "ph": 6.1, "volume": 11.8 }
      ],
      "drainage": [
        { "ec": 2.5, "ph": 5.8, "volume": 22 },
        { "ec": 2.6, "ph": 5.7, "volume": 25 }
      ]
    }
  ]
}

IMPORTANT:
- Retourne UNIQUEMENT le JSON, sans texte avant ou après
- Lis CHAQUE ligne du tableau, même si l'écriture est difficile à lire
- Les valeurs EC sont généralement entre 0.5 et 5.0 mS/cm
- Les valeurs pH sont généralement entre 4.0 et 8.0
- Si la durée n'est pas indiquée, mets 0
- Si une valeur n'est pas lisible, mets null
- Fais attention aux séparateurs décimaux : virgule ou point
- Les dates en en-tête s'appliquent à toutes les lignes en dessous jusqu'à la prochaine date` }
        ];

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 4000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-irrigation", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        return res.json({ success: true, scan_url, analysis });
      }

      // ========== ANALYSE IRRIGATION (AI-powered agronomic analysis) ==========

      if (action === "analyse-irrigation" && req.method === "POST") {
        const { readings, ferme, parcelle } = req.body;
        if (!readings || !readings.length) return res.status(400).json({ success: false, error: "readings requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.json({ success: true, analyse: "⚠️ Clé API Anthropic non configurée." });

        // Build data summary for Claude
        const dataLines = readings.map(r => {
          const ptsEc = (r.points || []).filter(p => p.ec > 0).map(p => p.ec);
          const ptsPh = (r.points || []).filter(p => p.ph > 0).map(p => p.ph);
          const ptsVol = (r.points || []).filter(p => p.volume > 0).map(p => p.volume);
          const drEc = (r.drainage || []).filter(d => d.ec > 0).map(d => d.ec);
          const drPh = (r.drainage || []).filter(d => d.ph > 0).map(d => d.ph);
          const drVol = (r.drainage || []).filter(d => d.volume > 0).map(d => d.volume);
          const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 'N/A';
          return `${r.date} ${r.heure || ''} | Parcelle: ${r.parcelleLabel || r.parcelle} | Durée: ${r.duree || 0}min | Apport EC=${avg(ptsEc)} pH=${avg(ptsPh)} Vol=${avg(ptsVol)}L | Drainage EC=${avg(drEc)} pH=${avg(drPh)} Vol=${avg(drVol)}%`;
        }).join('\n');

        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });

        const prompt = `Tu es un ingénieur agronome spécialisé dans l'irrigation des cultures de framboise et myrtille sous serre au Maroc (Berry Good Farms).

Voici les données d'irrigation des derniers jours pour la ferme ${ferme || 'N/A'}${parcelle ? ', parcelle ' + parcelle : ''} :

${dataLines}

Analyse ces données comme le ferait un expert en irrigation et fournis :

## 1. Diagnostic EC (Conductivité Électrique)
- EC apport vs EC drainage : le ratio est-il dans la norme (drainage/apport < 1.5) ?
- Tendance : l'EC dérive-t-elle ? Accumulation saline ?
- Recommandation : faut-il ajuster la concentration de la solution nutritive ?

## 2. Diagnostic pH
- Le pH est-il dans la plage optimale (5.5-6.5 pour framboise, 4.5-5.5 pour myrtille) ?
- Écart pH apport vs drainage : y a-t-il un problème de tampon du substrat ?
- Recommandation : ajustement acide/base nécessaire ?

## 3. Drainage
- Le % de drainage est-il dans la cible (20-30%) ?
- Est-il régulier ou très variable ?
- Recommandation : ajuster le volume par irrigation ?

## 4. Fréquence & Volume
- Le nombre d'irrigations par jour est-il adapté au stade et à la saison ?
- Le volume par cycle est-il cohérent ?
- Recommandation : modifier la fréquence ou le volume ?

## 5. Actions Prioritaires (3 max)
Liste les 3 actions les plus urgentes à prendre, classées par priorité.

Réponds en français, de manière concise et actionnable. Utilise des émojis pour les niveaux d'alerte :
🟢 = OK, 🟡 = À surveiller, 🔴 = Action urgente`;

        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
            break;
          } catch (e) {
            console.error("Erreur modèle analyse-irrigation", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const analyse = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        return res.json({ success: true, analyse });
      }

      // ========== STOCK MOVEMENTS (Gestion de stock) ==========

      // --- Helper: update stock_balances atomically ---
      //
      // ⚠️ `ficheId` DOIT être une identité DÉJÀ RÉSOLUE (docId d'une fiche
      // active du catalogue), jamais un libellé. C'est la règle que ce lot
      // installe : l'identifiant du document de solde est
      // `${lieu_type}_${lieu_id}_${docId de fiche}`. Passer un libellé ici
      // recrée exactement le défaut d'origine — deux documents de solde pour le
      // même article au même lieu, 47 cas mesurés le 2026-08-31.
      // La résolution se fait chez l'appelant (`resoudreLignesStock`), qui peut
      // REFUSER le bon ; ce helper, lui, ne sait pas refuser : il écrit.
      async function updateStockBalance(lieuType, lieuId, ficheId, articleNom, unite, delta) {
        const balanceId = identiteArticle.identifiantSoldeCanonique(lieuType, lieuId, ficheId);
        const balRef = db_firestore.collection("stock_balances").doc(balanceId);
        await db_firestore.runTransaction(async (t) => {
          const snap = await t.get(balRef);
          const current = snap.exists ? (snap.data().balance || 0) : 0;
          const newBalance = Math.round((current + delta) * 100) / 100;
          t.set(balRef, {
            lieu_type: lieuType, lieu_id: lieuId,
            // `article_ref` porte l'IDENTITÉ (docId de fiche) ; `article_nom`
            // garde le libellé saisi, qui reste ce que le magasinier lit.
            article_ref: ficheId, article_nom: articleNom,
            unite: unite || "kg", balance: newBalance,
            updated_at: Date.now()
          }, { merge: true });
        });
      }

      // --- Helper: apply stock impact for a validated movement ---
      //
      // Le repli `item.article_ref || item.article` A DISPARU : il prenait un
      // LIBELLÉ pour une identité, et c'est lui qui rangeait le solde dans un
      // second document à côté de celui de la fiche. La règle est désormais
      // `identiteArticle.identiteImpact`, module PUR et testé.
      //
      // ⚠️ CE QUE CETTE SYMÉTRIE GARANTIT — ET CE QU'ELLE NE GARANTIT PAS.
      // `apply` et `reverse` partagent la MÊME fonction : pour un mouvement
      // donné, ils calculent forcément la même clé. Mais cela ne vaut que si
      // les deux passent par ce code. Ce n'est PAS le cas des 4 355 mouvements
      // ANTÉRIEURS à ce lot : leur aller a débité la clé BRUTE (le libellé),
      // et leur annulation, elle, visera la clé RÉSOLUE. Le retour tombe donc
      // dans un autre document que l'aller (vérifié sur BCG-5620).
      // Ce n'est pas une perte — la SOMME des deux fragments reste juste, et la
      // re-clé des soldes prévue au déploiement les réunit. Mais tant que cette
      // re-clé n'a pas eu lieu, ne pas lire ce helper comme « l'annulation vise
      // exactement le document que l'application a touché » : c'est vrai des
      // mouvements créés APRÈS ce lot, faux des précédents.
      async function applyStockImpact(movement) {
        const promises = [];
        const identiteIndex = await getIdentiteArticleIndex(db_firestore);
        for (const item of (movement.items || [])) {
          const ref = identiteArticle.identiteImpact(item, identiteIndex);
          const nom = item.article_nom || item.article || "";
          const qty = parseFloat(item.quantite) || 0;
          const unite = item.unite || "kg";
          if (qty <= 0) continue;
          // Decrease source
          if (movement.lieu_source && movement.lieu_source.id) {
            promises.push(updateStockBalance(movement.lieu_source.type, movement.lieu_source.id, ref, nom, unite, -qty));
          }
          // Increase destination (not for parcelles or external)
          if (movement.lieu_destination && movement.lieu_destination.id && movement.lieu_destination.type !== "parcelle") {
            promises.push(updateStockBalance(movement.lieu_destination.type, movement.lieu_destination.id, ref, nom, unite, qty));
          }
        }
        await Promise.all(promises);
      }

      // --- Helper: annule l'impact stock d'un mouvement validé (delta inverse) ---
      // Applique l'opposé exact de applyStockImpact : re-crédite la source et
      // re-débite la destination. À n'appeler QUE si le mouvement avait un impact
      // matérialisé (status === valide_chef), sinon double-comptage.
      async function reverseStockImpact(movement) {
        const promises = [];
        // MÊME résolution que applyStockImpact, par la MÊME fonction pure —
        // avec la réserve documentée là-bas sur les mouvements antérieurs au
        // lot, dont l'aller avait débité la clé brute.
        const identiteIndex = await getIdentiteArticleIndex(db_firestore);
        for (const item of (movement.items || [])) {
          const ref = identiteArticle.identiteImpact(item, identiteIndex);
          const nom = item.article_nom || item.article || "";
          const qty = parseFloat(item.quantite) || 0;
          const unite = item.unite || "kg";
          if (qty <= 0) continue;
          // Inverse de la source : on re-crédite (+qty au lieu de -qty)
          if (movement.lieu_source && movement.lieu_source.id) {
            promises.push(updateStockBalance(movement.lieu_source.type, movement.lieu_source.id, ref, nom, unite, qty));
          }
          // Inverse de la destination : on re-débite (-qty au lieu de +qty)
          if (movement.lieu_destination && movement.lieu_destination.id && movement.lieu_destination.type !== "parcelle") {
            promises.push(updateStockBalance(movement.lieu_destination.type, movement.lieu_destination.id, ref, nom, unite, -qty));
          }
        }
        await Promise.all(promises);
      }

      // --- Helper: determine chef profile for a ferme ---
      function getChefProfileForFerme(ferme) {
        if (ferme === "F1") return "chef_f1";
        if (ferme === "F5") return "chef_f5";
        if (["F2", "F3", "F4", "F6"].includes(ferme)) return "chef_avo";
        return null;
      }

      // `movementNeedsMultiValidation(type)` vivait ici. Supprimée : elle
      // n'était appelée nulle part, et affirmait que les réceptions restent en
      // attente de validation Achats — exactement l'inverse de ce que fait
      // désormais le code. Un helper mort qui contredit le comportement réel est
      // pire qu'absent : il se lit comme une règle.

      // --- UPLOAD SCAN for stock movements ---
      if (action === "upload-scan" && req.method === "POST") {
        const { file_base64, filename, contentType } = req.body || {};
        if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
        const buffer = Buffer.from(file_base64.replace(/^data:[^;]+;base64,/, ""), "base64");
        const ext = (filename || "scan.jpg").split(".").pop() || "jpg";
        const storagePath = `stock_scans/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: contentType || `image/${ext}` } });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        return res.json({ success: true, url: publicUrl });
      }

      // --- IMPORT CANEVA STOCK (workflow Achats → validation Finance) ---
      if (action === "import-caneva-stock" && req.method === "POST") {
        const XLSX = require("xlsx");
        const { mode, file_base64, request_id, motif, requested_by, reviewed_by } = req.body || {};
        const IMPORT_SOURCE = stockCaneva.IMPORT_SOURCE;
        const COL = "stock_caneva_imports";
        const ROLE_CONTROLE = ["finance", "dg"];
        const BATCH = 450;

        const actor = mode === "approve" || mode === "reject" || mode === "restore"
          ? (reviewed_by || {})
          : (requested_by || {});

        // ---- helpers ----
        async function commitOps(ops) {
          for (let i = 0; i < ops.length; i += BATCH) {
            const batch = db_firestore.batch();
            for (const op of ops.slice(i, i + BATCH)) {
              if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
              else if (op.type === "delete") batch.delete(op.ref);
            }
            await batch.commit();
          }
        }
        function decodeB64(b64) {
          return Buffer.from(String(b64 || "").replace(/^data:[^;]+;base64,/, ""), "base64");
        }
        // Load all CANEVA movements once (for shrink count + per-day diff)
        async function loadCaneva() {
          const snap = await db_firestore.collection("stock_movements").where("import_source", "==", IMPORT_SOURCE).get();
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        // Parse + guard + per-day diff against existing CANEVA ledger
        async function analyze(buffer) {
          const plan = stockCaneva.parseWorkbook(buffer, XLSX);
          const allCaneva = await loadCaneva();
          const dates = new Set(plan.movements.map((m) => m.date).filter(Boolean));
          const existing = allCaneva.filter((m) => dates.has(m.date));
          const guard = stockCaneva.evaluateGuard(plan, { currentMovementCount: allCaneva.length });
          const diff = stockCaneva.computeDayDiff(plan, existing);
          const summary = stockCaneva.buildDrySummary(plan, guard, diff);
          return { plan, guard, diff, summary, allCaneva };
        }
        // Build a stored stock_movement doc from a parsed plan movement
        function buildMovementDoc(m) {
          const needsMulti = m.type === "reception" || m.type === "sortie";
          const validations = { magasinier: { by: "import_caneva", name: "Import CANEVA", at: Date.now() } };
          if (needsMulti) {
            validations.achats = { by: "import_caneva", name: "Import CANEVA", at: Date.now() };
            validations.chef = { by: "import_caneva", name: "Import CANEVA", at: Date.now() };
          }
          return {
            numero: m.numero, type: m.type, date: m.date,
            lieu_source: m.lieu_source || null, lieu_destination: m.lieu_destination || null,
            ferme: m.ferme || "", items: m.items || [],
            ref_bl_fournisseur: m.ref_bl_fournisseur || "", fournisseur_nom: m.fournisseur_nom || null,
            reception_libre: !!m.reception_libre, reception_libre_motif: m.reception_libre_motif || "",
            ref_bon_physique: m.ref_bon_physique || "", sortie_type: m.sortie_type || null,
            numero_source: m.numero_source || "", bdc_id: null, bl_id: null, scan_url: null,
            status: needsMulti ? "valide_chef" : "valide_mag",
            validations, rejection: null,
            import_source: IMPORT_SOURCE,
            created_by: { userId: "import_caneva", name: "Import CANEVA" },
            imported_by: { userId: actor.userId || "", name: actor.name || "", profileId: actor.profileId || "" },
            created_at: Date.now(), updated_at: Date.now(),
          };
        }
        // Rebuild ALL stock_balances from inventory baseline + full movement ledger
        async function rebuildBalances(balancesInit) {
          // ⚠️ GÉNÉRATION ET PURGE PARTAGENT LA MÊME RÈGLE DE CLÉ.
          // Ce helper portait sa PROPRE copie de la formule (`keyOf`) et
          // rangeait les soldes sous le LIBELLÉ des mouvements, tandis que la
          // purge supprimait « tout ce qui n'a pas été régénéré ». Un import
          // effaçait donc les soldes rangés sous la référence de la fiche, que
          // la saisie courante recréait aussitôt à côté : c'est l'aggravant qui
          // faisait remonter le compte de fragments après chaque import.
          // Désormais la clé vient d'`identifiantSoldeCanonique`, alimentée par
          // l'identité RÉSOLUE, et la purge est dérivée des clés réellement
          // générées (`docsAPurger`) — la divergence n'est plus exprimable.
          //
          // Les 4 516 mouvements gardent leur libellé (décision d'Omar) : c'est
          // ici, à la lecture, qu'il devient une identité.
          const identiteIndex = await getIdentiteArticleIndex(db_firestore, { force: true });
          /** @type {Array<Object>} */
          const deltas = [];
          const add = (lt, li, ref, nom, unite, delta) => {
            deltas.push({ lieu_type: lt, lieu_id: li, article_ref: ref, article_nom: nom, unite, delta });
          };
          for (const b of balancesInit) add(b.lieu_type, b.lieu_id, b.article_ref, b.article_nom, b.unite, b.balance);
          const allMovSnap = await db_firestore.collection("stock_movements").get();
          for (const doc of allMovSnap.docs) {
            const mData = doc.data();
            // Ne sommer que les mouvements dont l'impact stock est posé en live
            // (status 'valide_chef', ni soft-deleted ni rejete). Exclut les
            // réceptions non encore validées Achats (en_attente_achats / valide_mag)
            // qui sinon gonfleraient les soldes reconstruits. Cf. lib/stock/movementImpact.
            if (!isImpactApplied(mData)) continue;
            for (const d of stockCaneva.movementDelta(mData)) add(d.lieu_type, d.lieu_id, d.article_ref, d.article_nom, d.unite, d.delta);
          }
          // Une SEULE agrégation, une SEULE règle de clé (identité résolue).
          const { soldes, non_resolus } = identiteArticle.agregerSoldes(deltas, identiteIndex);
          if (non_resolus.length) {
            // Repli assumé (cf. identiteArticle.agregerSoldes) : un libellé
            // historique orphelin garde sa clé brute et survit donc à la purge.
            // Tracé, parce qu'un solde qu'aucune fiche ne réclame est du stock
            // que plus personne ne voit.
            console.warn("rebuildBalances : libellés sans fiche au catalogue —", non_resolus.join(", "));
          }
          // Write computed balances; delete stale ones absent from the rebuild
          const existingBalSnap = await db_firestore.collection("stock_balances").get();
          const ops = [];
          for (const [k, v] of soldes) {
            ops.push({ type: "set", ref: db_firestore.collection("stock_balances").doc(k), data: { ...v, updated_at: Date.now() } });
          }
          // La purge est DÉRIVÉE des clés générées, jamais recalculée : un
          // import ne peut plus supprimer un solde qu'il sait régénérer.
          const aPurger = new Set(identiteArticle.docsAPurger(soldes, existingBalSnap.docs.map((d) => d.id)));
          for (const doc of existingBalSnap.docs) {
            if (aPurger.has(doc.id)) ops.push({ type: "delete", ref: doc.ref });
          }
          await commitOps(ops);
        }
        // Execute the per-day import for the impacted dates
        async function executeImport(plan, diff, allCaneva) {
          const impacted = stockCaneva.impactedDates(diff);
          const ops = [];
          // 1. delete impacted-day CANEVA movements (strictly import_source + date)
          for (const m of allCaneva) {
            if (impacted.has(m.date)) ops.push({ type: "delete", ref: db_firestore.collection("stock_movements").doc(m.id) });
          }
          // 2. upsert articles from the workbook
          for (const art of plan.articlesToCreate) {
            ops.push({
              type: "set",
              ref: db_firestore.collection("articles_catalog").doc(art.reference),
              data: {
                reference: art.reference, nom: art.nom, unite: art.unite,
                categorie: art.categorie, type: "Stockable", active: true,
                import_source: IMPORT_SOURCE, updated_at: Date.now(),
              },
              options: { merge: true },
            });
          }
          // 3. create movements for impacted dates
          for (const m of plan.movements) {
            if (impacted.has(m.date)) ops.push({ type: "set", ref: db_firestore.collection("stock_movements").doc(), data: buildMovementDoc(m) });
          }
          await commitOps(ops);
          // 4. replace CANEVA cost docs (derived wholesale from the workbook)
          const costSnap = await db_firestore.collection("consumption_costs_by_variety").where("import_source", "==", IMPORT_SOURCE).get();
          const costOps = costSnap.docs.map((d) => ({ type: "delete", ref: d.ref }));
          for (const [code, agg] of Object.entries(plan.costsByVariety)) {
            costOps.push({ type: "set", ref: db_firestore.collection("consumption_costs_by_variety").doc(code), data: { ...agg, import_source: IMPORT_SOURCE, updated_at: Date.now() } });
          }
          await commitOps(costOps);
          // 5. rebuild balances from full ledger
          await rebuildBalances(plan.balancesInit);
          return { impacted_dates: [...impacted].sort() };
        }
        // Archive uploaded workbook to Storage, keep only the last 7 files
        async function storeFile(buffer) {
          const path = `stock_caneva_imports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.xlsx`;
          await bucket.file(path).save(buffer, { metadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
          return path;
        }
        async function pruneArchive() {
          const snap = await db_firestore.collection(COL).where("file_pruned", "==", false).get();
          const withFile = snap.docs
            .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
            .filter((d) => d.file_path)
            .sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
          for (const d of withFile.slice(7)) {
            try { await bucket.file(d.file_path).delete(); } catch (_) {}
            await d.ref.update({ file_pruned: true });
          }
        }

        try {
          // ===== PREVIEW (achats) — aucune écriture =====
          if (mode === "preview") {
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const { summary } = await analyze(decodeB64(file_base64));
            if (summary.guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: summary.guard.reasons, summary });
            return res.json({ success: true, summary });
          }

          // ===== APPLY (achats) — uniquement si aucun jour modifié =====
          if (mode === "apply") {
            if (actor.profileId !== "achats") return res.status(403).json({ success: false, error: "Réservé au rôle Achats" });
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const buffer = decodeB64(file_base64);
            const { plan, guard, diff, summary, allCaneva } = await analyze(buffer);
            if (guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: guard.reasons, summary });
            if (diff.jours_modifies.length > 0) return res.json({ success: false, error: "Validation Finance requise (jours déjà importés)", summary });
            const exec = await executeImport(plan, diff, allCaneva);
            const file_path = await storeFile(buffer);
            const docRef = await db_firestore.collection(COL).add({
              status: "importe", file_path, file_pruned: false, filename: req.body.filename || "canevas.xlsx",
              summary, jours_nouveaux: diff.jours_nouveaux, jours_modifies: diff.jours_modifies,
              prior_import_existed: allCaneva.length > 0, requested_by: actor, requested_at: Date.now(),
              reviewed_by: null, reviewed_at: null, motif_rejet: null,
              history: [{ action: "apply", by: actor, at: Date.now() }],
            });
            await pruneArchive();
            return res.json({ success: true, request_id: docRef.id, status: "importe", summary, ...exec });
          }

          // ===== REQUEST (achats) — jours modifiés → file d'attente Finance =====
          if (mode === "request") {
            if (actor.profileId !== "achats") return res.status(403).json({ success: false, error: "Réservé au rôle Achats" });
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const buffer = decodeB64(file_base64);
            const { diff, summary, allCaneva } = await analyze(buffer);
            if (summary.guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: summary.guard.reasons, summary });
            if (diff.jours_modifies.length === 0) return res.json({ success: false, error: "Aucun jour modifié — utilisez l'import direct", summary });
            const file_path = await storeFile(buffer);
            const docRef = await db_firestore.collection(COL).add({
              status: "en_attente_finance", file_path, file_pruned: false, filename: req.body.filename || "canevas.xlsx",
              summary, jours_nouveaux: diff.jours_nouveaux, jours_modifies: diff.jours_modifies,
              prior_import_existed: allCaneva.length > 0, requested_by: actor, requested_at: Date.now(),
              reviewed_by: null, reviewed_at: null, motif_rejet: null,
              history: [{ action: "request", by: actor, at: Date.now() }],
            });
            await pruneArchive();
            await dispatchNotification({
              type: "caneva_import_request", profiles: ["finance"], channels: ["in_app"],
              data: { message: `Import canevas Stock à valider — ${diff.jours_modifies.length} jour(s) seront remplacés (demandé par ${actor.name || "Achats"})`, severity: "warning" },
              relatedDoc: `${COL}/${docRef.id}`,
            });
            return res.json({ success: true, request_id: docRef.id, status: "en_attente_finance", summary });
          }

          // ===== APPROVE / RESTORE (finance/dg) =====
          if (mode === "approve" || mode === "restore") {
            if (!ROLE_CONTROLE.includes(actor.profileId)) return res.status(403).json({ success: false, error: "Réservé à Finance/DG" });
            if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
            const docRef = db_firestore.collection(COL).doc(request_id);
            const docSnap = await docRef.get();
            if (!docSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
            const reqDoc = docSnap.data();
            if (mode === "approve" && reqDoc.status !== "en_attente_finance") return res.status(400).json({ success: false, error: `Statut ${reqDoc.status} non approuvable` });
            if (reqDoc.file_pruned || !reqDoc.file_path) return res.status(400).json({ success: false, error: "Fichier archivé indisponible (élagué)" });
            const [buffer] = await bucket.file(reqDoc.file_path).download();
            const { plan, guard, diff, summary, allCaneva } = await analyze(buffer);
            if (guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: guard.reasons, summary });
            const exec = await executeImport(plan, diff, allCaneva);
            const history = (reqDoc.history || []).concat([{ action: mode, by: actor, at: Date.now() }]);
            await docRef.update({ status: "importe", reviewed_by: actor, reviewed_at: Date.now(), summary, history });
            await dispatchNotification({
              type: "caneva_import_approved", profiles: ["achats"], channels: ["in_app"],
              data: { message: `Import canevas Stock ${mode === "restore" ? "restauré" : "approuvé"} par ${actor.name || "Finance"}`, severity: "info" },
              relatedDoc: `${COL}/${request_id}`,
            });
            return res.json({ success: true, status: "importe", summary, ...exec });
          }

          // ===== REJECT (finance/dg) =====
          if (mode === "reject") {
            if (!ROLE_CONTROLE.includes(actor.profileId)) return res.status(403).json({ success: false, error: "Réservé à Finance/DG" });
            if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
            const docRef = db_firestore.collection(COL).doc(request_id);
            const docSnap = await docRef.get();
            if (!docSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
            const reqDoc = docSnap.data();
            if (reqDoc.status !== "en_attente_finance") return res.status(400).json({ success: false, error: `Statut ${reqDoc.status} non rejetable` });
            const history = (reqDoc.history || []).concat([{ action: "reject", by: actor, at: Date.now(), motif: motif || "" }]);
            await docRef.update({ status: "rejete", reviewed_by: actor, reviewed_at: Date.now(), motif_rejet: motif || "", history });
            await dispatchNotification({
              type: "caneva_import_rejected", profiles: ["achats"], channels: ["in_app"],
              data: { message: `Import canevas Stock rejeté par ${actor.name || "Finance"}${motif ? " : " + motif : ""}`, severity: "warning" },
              relatedDoc: `${COL}/${request_id}`,
            });
            return res.json({ success: true, status: "rejete" });
          }

          // ===== LIST (achats/finance) =====
          if (mode === "list") {
            const snap = await db_firestore.collection(COL).orderBy("requested_at", "desc").limit(50).get();
            const requests = snap.docs.map((d) => {
              const x = d.data();
              return {
                id: d.id, status: x.status, filename: x.filename, file_pruned: !!x.file_pruned,
                requested_by: x.requested_by, requested_at: x.requested_at,
                reviewed_by: x.reviewed_by, reviewed_at: x.reviewed_at, motif_rejet: x.motif_rejet,
                jours_nouveaux: x.jours_nouveaux || [], jours_modifies: x.jours_modifies || [],
                summary: x.summary || null,
              };
            });
            const pending = requests.filter((r) => r.status === "en_attente_finance").length;
            return res.json({ success: true, requests, pending });
          }

          return res.status(400).json({ success: false, error: "mode invalide" });
        } catch (e) {
          console.error("import-caneva-stock error:", e);
          return res.status(500).json({ success: false, error: e.message });
        }
      }

      // --- CREATE MOVEMENT ---
      if (action === "create-movement" && req.method === "POST") {
        const { type, date, lieu_source, lieu_destination, ferme, items, ref_bl_fournisseur,
          bdc_id, bl_id, ref_bon_physique,
          sortie_type, scan_url, fournisseur_nom, beneficiaire, created_by,
          motif_rebut, justificatif_url } = req.body;

        if (!type || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: type, items[]" });
        }
        const validTypes = ["reception", "transfert", "consommation", "sortie"];
        if (!validTypes.includes(type)) {
          return res.status(400).json({ success: false, error: "Type invalide. Valeurs: " + validTypes.join(", ") });
        }
        if (type === "sortie" && !["retour_fournisseur", "pret", "rebut"].includes(sortie_type)) {
          return res.status(400).json({ success: false, error: "sortie_type requis: retour_fournisseur, pret, rebut" });
        }
        // La réception libre est SUPPRIMÉE : toute réception doit être rattachée à
        // un bon de commande, comme create-bl l'exige déjà. Sans BDC il n'existe
        // aucune source de prix, donc aucune valorisation possible — la
        // marchandise entrait en stock sans jamais compter dans les coûts.
        //
        // Mesure production avant fermeture : 2 réceptions sans bdc_id créées dans
        // l'application (BR-2026-0003 et BR-2026-0006, du 6 au 11 juin 2026),
        // aucune depuis, contre 64 via bon de commande jusqu'au 24 août.
        //
        // Message actionnable, pas un 400 sec : l'écran vers lequel aller est nommé.
        if (type === "reception" && !bdc_id) {
          return res.status(400).json({
            success: false,
            error: "Une réception doit être rattachée à un bon de commande. Utilisez l'onglet « BDC à réceptionner » pour saisir la livraison à partir du BDC concerné.",
            code: "bdc_requis",
          });
        }

        // Identité créateur : on force userId = uid du TOKEN (anti-spoof), en
        // conservant profileId/name fournis par le body. Le contrôle créateur du
        // guard (stockMovementGuard) s'appuie sur cet uid pour les éditions/suppressions.
        const movCreatedBy = { ...(created_by || {}), userId: authUser.uid };

        const prefixMap = { reception: "BR", transfert: "BT", consommation: "BCS", sortie: "BS" };
        const numType = "stock_" + type;
        const numero = await getNextNumber(numType, prefixMap[type]);

        // ⚠️ GARDE-FOU : ce mapping ne conserve QUE article/quantité/unité. Toute
        // `parcelle` (ou `groupe_id`) envoyée par item est IGNORÉE ici, sans
        // erreur. La SEULE voie d'entrée d'une parcelle dans les données de
        // stock est `create-bc` (qui éclate les groupes au prorata des Ha).
        // Une évolution Réception/Sortie qui enverrait une parcelle par item se
        // croirait fonctionnelle en silence : la propager explicitement ici
        // AVANT de s'appuyer dessus en aval.
        const movItemsSaisis = items.map((it) => ({
          article_ref: it.article_ref || it.article || "",
          article_nom: it.article_nom || it.article || "",
          quantite: parseFloat(it.quantite) || 0,
          // Aucune unité fabriquée — MÊME règle que create-bl. Inventer "kg" ici
          // faisait pire qu'une absence : le module comparait alors deux unités
          // CONNUES et différentes (BDC en L contre "kg" inventé) et refusait le
          // prix pour divergence. Les deux chemins de création d'une réception
          // rendaient des résultats différents pour la MÊME livraison — la
          // divergence silencieuse que ce lot existe pour rendre impossible.
          unite: it.unite || "",
        }));

        // --- IDENTITÉ D'ARTICLE (lib/stock/identiteArticle) ----------------
        // Le front envoie un LIBELLÉ dans `article_ref` (transfert et sortie le
        // remplissent explicitement avec le nom : le champ « référence » existe
        // et il est faux). On le RÉSOUT ici, une fois, vers le docId de la
        // fiche active — avant la garde de stock, avant la valorisation, avant
        // toute écriture.
        //
        // FAIL-CLOSED (décision d'Omar) : un article inconnu ou ambigu fait
        // échouer le bon, en le nommant. Rien n'entre en stock sous une
        // identité inventée.
        const movResolution = await resoudreLignesStock(db_firestore, movItemsSaisis);
        if (!movResolution.ok) {
          // DÉCISION D'OMAR : « on demande au magasinier de demander la
          // création de l'article et de la soumettre au DG ». Le refus n'est
          // donc pas une impasse — il OUVRE la demande lui-même. Ces écrans
          // (transfert, sortie) n'ont pas le bouton « Créer cet article », et
          // `public/app.jsx` est gelé : la sortie ne peut être que serveur.
          const movDemandes = await enregistrerDemandesCreation(
            db_firestore,
            movResolution.refus.details,
            { uid: authUser.uid, profileId: (created_by || {}).profileId || "", name: (created_by || {}).name || "" },
            { origine: "create-movement", type, numero: "" }
          );
          return res.status(400).json({
            success: false,
            // Le message part tel quel dans l'`alert()` existant du front :
            // aucune modification de `public/app.jsx` n'est nécessaire.
            error: demandeCreationArticle.messageRefus(movResolution.refus.details, movDemandes),
            code: movResolution.refus.code,
            demandes_creation: movDemandes,
          });
        }
        // `article_nom` conserve le libellé saisi : la valorisation
        // (prixLigne.valoriserLignes) le lit en priorité, elle voit donc
        // toujours le même article qu'avant ce lot.
        const movItems = movResolution.lignes;

        if (type === "reception") {
          const negativeItem = movItems.find((it) => it.quantite < 0);
          if (negativeItem) {
            return res.status(400).json({ success: false, error: `Quantité reçue négative invalide pour ${negativeItem.article_nom || negativeItem.article_ref}` });
          }
        }

        // --- Contrôle stock avant sortie/transfert ---
        // Bloque la création si le stock disponible au lieu de départ est
        // insuffisant. Réception/consommation hors périmètre (helper exempté).
        // Note: lecture des soldes puis applyStockImpact dans des transactions
        // distinctes → fenêtre de course théorique sous forte concurrence,
        // acceptable ici (peu de magasiniers simultanés).
        // Le helper ne garde que sortie/transfert ; on ne lit les soldes que
        // pour ces types ET quand un lieu de départ est défini.
        const STOCK_GUARDED_TYPES = ["sortie", "transfert"];
        if (STOCK_GUARDED_TYPES.includes(type) && lieu_source && lieu_source.id) {
          //
          // ⚠️ POINT LE PLUS VICIEUX DU CHANTIER. Cette garde reconstruisait
          // l'identifiant du solde AVEC SA PROPRE COPIE de la formule, à partir
          // du libellé. Si elle lit sous une clé que l'écriture n'emploie plus,
          // elle interroge un seau VIDE : elle laisse alors sortir du stock qui
          // n'existe pas, sans la moindre erreur. La clé de LECTURE est donc
          // dérivée de la MÊME fonction que la clé d'ÉCRITURE
          // (`identifiantSoldeCanonique`), à partir des lignes DÉJÀ RÉSOLUES.
          const gardeCles = identiteArticle.identifiantsGardeStock(lieu_source, movItems);
          const availableByRef = {};
          const balSnaps = await Promise.all(
            gardeCles.map((c) => db_firestore.collection("stock_balances").doc(c.balanceId).get())
          );
          gardeCles.forEach((c, idx) => {
            const snap = balSnaps[idx];
            availableByRef[c.ficheId] = snap.exists ? (snap.data().balance || 0) : 0;
          });
          const guardResult = checkStockAvailability({ type, items: movItems }, availableByRef);
          if (!guardResult.allowed) {
            return res.status(400).json({ success: false, error: guardResult.error, code: "insufficient_stock" });
          }
        }

        const singleValidation = !!req.body.single_validation;
        // TOUS les types sont auto-validés, impact stock immédiat à la création.
        //
        // Les réceptions le sont depuis la suppression de l'étape Achats : ce
        // chemin les créait en `en_attente_achats`, c'est-à-dire hors stock tant
        // qu'un profil Achats ne les validait pas — ce que plus personne ne
        // faisait. C'était la même impasse que create-bl, par une autre porte.
        const isReception = type === "reception";

        // Valorisation : MÊME décision que create-bl, même module pur. Une seule
        // règle de prix dans le dépôt, aucune divergence silencieuse possible
        // entre les deux chemins de création d'une réception.
        let receptionItems = movItems;
        let receptionValorisation = null;
        if (isReception) {
          // Source de prix = le BDC lié, s'il y en a un. Une réception sans BDC
          // n'a aucune source : ses lignes entrent en stock NON valorisées, avec
          // leur motif. Jamais un zéro par défaut.
          let bdcSource = null;
          if (bdc_id) {
            const bdcSnapForPrix = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
            if (bdcSnapForPrix.exists) bdcSource = bdcSnapForPrix.data();
          }
          const valoMov = receptionBdc.valoriserItemsReception(movItems, bdcSource);
          receptionItems = valoMov.items;
          receptionValorisation = valoMov.resume;
        }
        // Statut de création d'une réception : la constante testée du module,
        // jamais une chaîne en dur ici.
        const initialStatus = isReception ? receptionBdc.STATUT_RECEPTION_A_LA_CREATION : "valide_chef";

        const movData = {
          numero, type,
          date: date || new Date().toISOString().split("T")[0],
          lieu_source: lieu_source || null,
          lieu_destination: lieu_destination || null,
          ferme: ferme || "",
          items: receptionItems,
          ref_bl_fournisseur: ref_bl_fournisseur || "",
          bdc_id: bdc_id || null,
          bl_id: bl_id || null,
          // `reception_libre` / `reception_libre_motif` ne sont plus écrits : la
          // réception libre est supprimée. Les documents existants les conservent
          // (les effacer serait une migration de données, et ils n'encombrent personne).
          single_validation: singleValidation,
          ref_bon_physique: ref_bon_physique || "",
          sortie_type: sortie_type || null,
          scan_url: scan_url || null,
          fournisseur_nom: fournisseur_nom || null,
          beneficiaire: beneficiaire || null,
          motif_rebut: motif_rebut || null,
          justificatif_url: justificatif_url || null,
          status: initialStatus,
          validations: {
            magasinier: { by: movCreatedBy.userId || "", name: movCreatedBy.name || "", at: Date.now() }
          },
          // Traçabilité de la valorisation automatique (réceptions uniquement).
          valorisation: receptionValorisation,
          rejection: null,
          created_by: movCreatedBy,
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        const docRef = await db_firestore.collection("stock_movements").add(movData);

        // L'impact est appliqué EXACTEMENT quand `isImpactApplied` affirme qu'il
        // l'est — la même fonction pure dont rebuildBalances se sert pour
        // recompter les soldes. Écrire un mouvement que cette fonction déclare
        // impactant sans appliquer l'impact (ou l'inverse) ferait diverger les
        // soldes du grand livre en silence. Ici la question ne se pose plus : le
        // code applique ce que le prédicat dit, il ne le redevine pas.
        if (isImpactApplied(movData)) {
          await applyStockImpact(movData);
        }

        return res.json({ success: true, id: docRef.id, numero, status: initialStatus, valorisation: receptionValorisation });
      }

      // --- LIST MOVEMENTS ---
      if (action === "list-movements") {
        const { type, status, ferme: movFerme, limit: movLimit, deleted } = req.query;
        // deleted=true → renvoie UNIQUEMENT les bons soft-deleted (historique des
        // suppressions). Sinon, comportement par défaut : exclut les supprimés.
        const onlyDeleted = deleted === "true" || deleted === "1";
        const lim = parseInt(movLimit || "200");
        let q = db_firestore.collection("stock_movements").orderBy("created_at", "desc").limit(lim);
        if (type) q = q.where("type", "==", type);
        if (status) q = q.where("status", "==", status);
        if (movFerme) q = q.where("ferme", "==", movFerme);
        const snap = await q.get();
        const movements = snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((m) => onlyDeleted ? stockMovementGuard.isDeletedMovement(m) : !stockMovementGuard.isDeletedMovement(m));
        return res.json({ success: true, movements, count: movements.length });
      }

      // --- GET SINGLE MOVEMENT ---
      if (action === "get-movement") {
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        const snap = await db_firestore.collection("stock_movements").doc(id).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const movData = snap.data();
        if (stockMovementGuard.isDeletedMovement(movData)) {
          return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        }
        return res.json({ success: true, movement: { id: snap.id, ...movData } });
      }

      // --- VALIDATE MOVEMENT ---
      if (action === "validate-movement" && req.method === "POST") {
        const { id, validated_by, items: pricedItems } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });

        // Rôle RÉEL dérivé du token Firebase (anti-spoof body). Jamais req.body.role.
        const callerRole = await resolveCallerRole(authUser);
        if (!callerRole) return res.status(403).json({ success: false, error: "Rôle introuvable pour l'utilisateur authentifié" });

        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const mov = snap.data();

        if (mov.status === "rejete") {
          return res.status(400).json({ success: false, error: "Mouvement rejeté, impossible de valider" });
        }

        // --- CHEMIN DE REPRISE — NE PAS SUPPRIMER ---
        //
        // Plus aucune réception n'est CRÉÉE en `en_attente_achats` (create-bl les
        // crée désormais en `valide_chef`, valorisées, stock appliqué). Mais 59
        // réceptions sont restées dans ce statut en production — 62 au
        // 27/08/2026, depuis le 5 juin, avec leurs 90 lignes TOUTES déjà
        // valorisées et leur marchandise jamais entrée en stock. Le compte
        // continue de monter jusqu'au déploiement : ne pas le lire comme figé.
        //
        // Retirer ce bloc les enfermerait dans un statut mort : plus aucune action
        // ne pourrait les faire entrer en stock, et leur reprise (partie D du
        // spec, GATED car elle modifie le stock réel) deviendrait impossible.
        // À supprimer seulement quand il n'en restera aucune.
        if (mov.status === "en_attente_achats") {
          if (mov.type !== "reception") {
            return res.status(400).json({ success: false, error: "Statut en_attente_achats réservé aux réceptions" });
          }
          if (callerRole !== "achats") {
            return res.status(403).json({ success: false, error: "Seul le profil Achats peut valider une réception" });
          }
          // Valorisation obligatoire : prix_unitaire numérique >= 0 pour chaque item.
          const provided = Array.isArray(pricedItems) ? pricedItems : [];
          const existingItems = mov.items || [];
          const valuedItems = [];
          for (let i = 0; i < existingItems.length; i++) {
            const orig = existingItems[i];
            // Match par index, sinon par ref/nom, sinon fallback au prix porté par l'item existant.
            let priced = provided[i];
            if (!priced) {
              priced = provided.find((p) =>
                (p.article_ref && p.article_ref === orig.article_ref) ||
                (p.article_nom && p.article_nom === orig.article_nom));
            }
            const rawPrice = priced && priced.prix_unitaire !== undefined && priced.prix_unitaire !== null && priced.prix_unitaire !== ""
              ? priced.prix_unitaire
              : orig.prix_unitaire;
            const prix = parseFloat(rawPrice);
            if (!Number.isFinite(prix) || prix < 0) {
              return res.status(400).json({ success: false, error: `Prix unitaire requis (>= 0) pour l'article ${orig.article_nom || orig.article_ref || "#" + (i + 1)}` });
            }
            valuedItems.push({ ...orig, prix_unitaire: prix });
          }

          await docRef.update({
            status: "valide_chef",
            items: valuedItems,
            "validations.achats": {
              by: (validated_by || {}).userId || "",
              name: (validated_by || {}).name || "",
              at: Date.now()
            },
            rejection: null,
            updated_at: Date.now()
          });

          const updatedSnap = await docRef.get();
          await applyStockImpact(updatedSnap.data());

          return res.json({ success: true, status: "valide_chef" });
        }

        // Determine expected validation sequence (chef valide directement depuis valide_mag)
        // Chemin legacy conservé : réceptions/mouvements déjà en valide_mag/valide_achats validés par le chef.
        let nextStatus = null;
        if ((callerRole === "chef_f1" || callerRole === "chef_f5" || callerRole === "chef_avo") && (mov.status === "valide_mag" || mov.status === "valide_achats")) {
          // Verify the chef matches the ferme
          const expectedChef = getChefProfileForFerme(mov.ferme);
          if (expectedChef && callerRole !== expectedChef) {
            return res.status(403).json({ success: false, error: `Seul ${expectedChef} peut valider pour ${mov.ferme}` });
          }
          nextStatus = "valide_chef";
        } else {
          return res.status(400).json({ success: false, error: `Validation ${callerRole} non applicable au statut ${mov.status}` });
        }

        const validationKey = "chef";
        await docRef.update({
          status: nextStatus,
          [`validations.${validationKey}`]: {
            by: (validated_by || {}).userId || "",
            name: (validated_by || {}).name || "",
            at: Date.now()
          },
          rejection: null,
          updated_at: Date.now()
        });

        // If fully validated, apply stock impact
        if (nextStatus === "valide_chef") {
          const updatedSnap = await docRef.get();
          await applyStockImpact(updatedSnap.data());
        }

        return res.json({ success: true, status: nextStatus });
      }

      // --- REJECT MOVEMENT ---
      if (action === "reject-movement" && req.method === "POST") {
        const { id, role, reason, rejected_by } = req.body;
        if (!id || !role || !reason) {
          return res.status(400).json({ success: false, error: "id, role et reason requis" });
        }

        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });

        await docRef.update({
          status: "rejete",
          rejection: {
            by: (rejected_by || {}).userId || "",
            name: (rejected_by || {}).name || "",
            role,
            reason,
            at: Date.now()
          },
          updated_at: Date.now()
        });

        return res.json({ success: true, status: "rejete" });
      }

      // --- Helper: résout l'identité du demandeur depuis le TOKEN (jamais le body) ---
      // Renvoie { profileId, userId } : userId = uid Firebase, profileId tiré de
      // users/{uid}. Le contrôle créateur s'appuie dessus (cf. stockMovementGuard).
      async function resolveRequesterIdentity(au) {
        const uid = (au && au.uid) || "";
        let profileId = "";
        if (uid && uid !== "admin-cli") {
          try {
            const uDoc = await db_firestore.collection("users").doc(uid).get();
            if (uDoc.exists) profileId = uDoc.data().profileId || "";
          } catch (_) { /* ignore */ }
        }
        return { userId: uid, profileId, isAdminCli: uid === "admin-cli" };
      }

      // --- UPDATE MOVEMENT (édition d'un bon non validé, non importé, par son créateur) ---
      if (action === "update-movement" && req.method === "POST") {
        const { id, patch } = req.body || {};
        if (!id || !patch || typeof patch !== "object") {
          return res.status(400).json({ success: false, error: "id et patch requis" });
        }
        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const mov = snap.data();

        const requester = await resolveRequesterIdentity(authUser);
        // admin-cli (script/secret) garde les garde-fous import/validé mais saute le contrôle créateur.
        const evalRes = requester.isAdminCli
          ? (stockMovementGuard.isDeletedMovement(mov) ? { allowed: false, reason: "deleted" }
            : stockMovementGuard.isImportedMovement(mov) ? { allowed: false, reason: "imported" }
              : stockMovementGuard.isValidatedMovement(mov) ? { allowed: false, reason: "validated" }
                : { allowed: true, reason: null })
          : stockMovementGuard.evaluateMutable(mov, requester);
        if (!evalRes.allowed) {
          const code = evalRes.reason === "not_found" ? 404 : 403;
          return res.status(code).json({ success: false, error: stockMovementGuard.refusalMessage(evalRes.reason), reason: evalRes.reason });
        }

        // Champs éditables uniquement (whitelist) — pas de status / created_by / import_source / impact.
        const EDITABLE = [
          "date", "lieu_source", "lieu_destination", "ferme", "ref_bl_fournisseur",
          // `reception_libre_motif` retiré : plus aucun chemin n'écrit ce champ.
          // Les 2 documents historiques qui le portent le gardent tel quel.
          "fournisseur_nom", "ref_bon_physique", "beneficiaire",
          "sortie_type", "motif_rebut", "justificatif_url", "scan_url",
        ];
        const update = { updated_at: Date.now() };
        for (const k of EDITABLE) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) update[k] = patch[k];
        }
        // Items : revalidés / normalisés comme à la création.
        if (Object.prototype.hasOwnProperty.call(patch, "items")) {
          if (!Array.isArray(patch.items) || patch.items.length === 0) {
            return res.status(400).json({ success: false, error: "items[] non vide requis" });
          }
          update.items = patch.items.map((it) => ({
            article_ref: it.article_ref || it.article || "",
            article_nom: it.article_nom || it.article || "",
            quantite: parseFloat(it.quantite) || 0,
            unite: it.unite || "kg",
          }));
        }
        // Bon non validé → aucun impact stock appliqué → pas de recalcul de soldes.
        update.history = (mov.history || []).concat([{
          action: "update", by: { userId: requester.userId, profileId: requester.profileId }, at: Date.now(),
        }]);

        await docRef.update(update);
        return res.json({ success: true, id });
      }

      // --- DELETE MOVEMENT (soft-delete) ---
      // Deux chemins :
      //  - Achats/DG (admin métier) : peut supprimer tout bon SAISI app (non importé),
      //    même validé, même s'il n'en est pas créateur. Si le bon était validé
      //    (impact matérialisé dans stock_balances), on annule l'impact (reverse).
      //  - Autres rôles (chemin historique) : créateur d'un bon non importé / non validé.
      if (action === "delete-movement" && req.method === "POST") {
        const { id, reason } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const mov = snap.data();

        const requester = await resolveRequesterIdentity(authUser);
        const isAdminRole = stockMovementGuard.isAdminDeleter(requester);

        let reverse = false;
        if (isAdminRole) {
          // Chemin Achats/DG : seul garde-fou = bon déjà supprimé OU importé.
          // PAS de restriction validé / créateur (cf. evaluateAdminDelete).
          const adminEval = stockMovementGuard.evaluateAdminDelete(mov, requester);
          if (!adminEval.allowed) {
            const code = adminEval.reason === "deleted" ? 400 : 403;
            const msg = adminEval.reason === "imported"
              ? "Bon importé du grand livre : non supprimable"
              : stockMovementGuard.refusalMessage(adminEval.reason);
            return res.status(code).json({ success: false, error: msg, reason: adminEval.reason });
          }
          // Si le bon était validé, son impact est matérialisé dans stock_balances → on l'annule.
          reverse = stockMovementGuard.isValidatedMovement(mov);
        } else {
          // Chemin historique : créateur, non importé, non validé.
          const evalRes = requester.isAdminCli
            ? (stockMovementGuard.isDeletedMovement(mov) ? { allowed: false, reason: "deleted" }
              : stockMovementGuard.isImportedMovement(mov) ? { allowed: false, reason: "imported" }
                : stockMovementGuard.isValidatedMovement(mov) ? { allowed: false, reason: "validated" }
                  : { allowed: true, reason: null })
            : stockMovementGuard.evaluateMutable(mov, requester);
          if (!evalRes.allowed) {
            const code = evalRes.reason === "not_found" ? 404 : 403;
            return res.status(code).json({ success: false, error: stockMovementGuard.refusalMessage(evalRes.reason), reason: evalRes.reason });
          }
        }

        const cleanReason = typeof reason === "string" ? reason.trim() : "";

        // Annule l'impact stock AVANT le soft-delete (le bon est encore "validé"
        // dans son état courant ; reverseStockImpact applique l'inverse de applyStockImpact).
        if (reverse) {
          await reverseStockImpact(mov);
        }

        await docRef.update({
          deleted: true,
          deleted_by: { userId: requester.userId, profileId: requester.profileId },
          deleted_at: Date.now(),
          deleted_reason: cleanReason || null,
          updated_at: Date.now(),
          history: (mov.history || []).concat([{
            action: "delete",
            by: { userId: requester.userId, profileId: requester.profileId },
            at: Date.now(),
            reason: cleanReason || null,
          }]),
        });

        // Cascade BR → BL → BDC : un BR (reception) supprimé doit aussi neutraliser
        // le BL jumeau (créé ensemble par create-bl) et recalculer delivery_status
        // du BDC parent (calculé uniquement à partir des delivery_notes non supprimés).
        if (mov.type === "reception" && mov.bdc_id) {
          if (mov.bl_id) {
            const blRef = db_firestore.collection("delivery_notes").doc(mov.bl_id);
            const blSnap = await blRef.get();
            if (blSnap.exists && !blSnap.data().deleted) {
              await blRef.update({
                deleted: true,
                deleted_by: { userId: requester.userId, profileId: requester.profileId },
                deleted_at: Date.now(),
              });
            }
          }
          const bdcSnap = await db_firestore.collection("purchase_orders").doc(mov.bdc_id).get();
          if (bdcSnap.exists) {
            const bdc = bdcSnap.data();
            const remainingBlSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", mov.bdc_id).get();
            const remainingBls = remainingBlSnap.docs.map((d) => d.data()).filter((bl) => !bl.deleted);
            const received = bdcReceptionGuard.computeReceivedByArticle(remainingBls);
            const ordered = bdcReceptionGuard.computeOrderedByArticle(bdc.items || []);
            const deliveryStatus = bdcReceptionGuard.deriveDeliveryStatus(ordered, received);
            await db_firestore.collection("purchase_orders").doc(mov.bdc_id).update({ delivery_status: deliveryStatus, updated_at: Date.now() });
          }
        }

        return res.json({ success: true, id, reversed: reverse });
      }

      // --- GET CONSUMPTION COSTS BY VARIETY ---
      if (action === "get-consumption-costs") {
        const snap = await db_firestore.collection("consumption_costs_by_variety").get();
        const data = {};
        snap.docs.forEach(d => { data[d.id] = d.data(); });
        return res.json({ success: true, data });
      }

      // --- GET BALANCES ---
      if (action === "get-balances") {
        const { lieu_type, lieu_id } = req.query;
        let q = db_firestore.collection("stock_balances");
        if (lieu_type) q = q.where("lieu_type", "==", lieu_type);
        if (lieu_id) q = q.where("lieu_id", "==", lieu_id);
        const snap = await q.get();
        const balances = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        balances.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        return res.json({ success: true, balances, count: balances.length });
      }

      // --- GET BALANCES AT DATE (recalcul historique) ---
      if (action === "get-balances-at-date") {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, error: "date requis (YYYY-MM-DD)" });

        const snap = await db_firestore.collection("stock_movements")
          .where("date", "<=", date)
          .get();

        const balMap = {};
        for (const doc of snap.docs) {
          const m = doc.data();
          if (stockMovementGuard.isDeletedMovement(m)) continue; // exclusion défensive soft-delete
          const needsMulti = m.type === "reception" || m.type === "sortie";
          if (needsMulti && m.status !== "valide_chef") continue;
          if (!m.status) continue;

          for (const item of (m.items || [])) {
            const ref = item.article_ref || "";
            const nom = item.article_nom || "";
            const qty = parseFloat(item.quantite) || 0;
            const unite = item.unite || "kg";
            if (qty <= 0 || !ref) continue;

            if (m.lieu_source && m.lieu_source.id) {
              const key = `${m.lieu_source.type}|${m.lieu_source.id}|${ref}`;
              if (!balMap[key]) balMap[key] = { lieu_type: m.lieu_source.type, lieu_id: m.lieu_source.id, article_ref: ref, article_nom: nom, unite, balance: 0 };
              balMap[key].balance -= qty;
            }
            if (m.lieu_destination && m.lieu_destination.id && m.lieu_destination.type !== "parcelle") {
              const key = `${m.lieu_destination.type}|${m.lieu_destination.id}|${ref}`;
              if (!balMap[key]) balMap[key] = { lieu_type: m.lieu_destination.type, lieu_id: m.lieu_destination.id, article_ref: ref, article_nom: nom, unite, balance: 0 };
              balMap[key].balance += qty;
            }
          }
        }

        const balances = Object.values(balMap)
          .map(b => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
          .filter(b => Math.abs(b.balance) >= 0.01)
          .sort((a, b) => (b.balance || 0) - (a.balance || 0));

        return res.json({ success: true, balances, count: balances.length, date });
      }

      // --- GET ARTICLE HISTORY (grand livre de stock par article) ---
      // Lecture seule. Reproduit EXACTEMENT les exclusions de get-balances-at-date
      // pour garantir la cohérence du cumul avec les soldes officiels.
      if (action === "get-article-history") {
        const articleParam = (req.query.article || "").trim();
        const filterLieuId = req.query.lieu_id || null;
        if (!articleParam) return res.status(400).json({ success: false, error: "article requis (article_ref ou article_nom)" });
        // Index grand-livre de TOUS les articles, mis en cache mémoire (TTL 5 min).
        // Le scan + agrégation stock_movements se fait UNE fois ; chaque article
        // est ensuite servi instantanément depuis l'index. Sémantique IDENTIQUE
        // à l'ancienne logique inline (cf. lib/stock/articleHistoryIndex.js).
        const articleIndex = await getArticleHistoryIndex(db_firestore);
        const slice = sliceArticleHistory(articleIndex, articleParam, filterLieuId);

        return res.json({ success: true, ...slice });
      }

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

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur Stock Management:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// AUTH: User management & authentication
// =============================================

// verifyAuth imported from ./middleware/requireAuth (see top of file)

// GET /api/auth?action=me — get current user's profile
// POST /api/auth?action=login-check — same but for POST
