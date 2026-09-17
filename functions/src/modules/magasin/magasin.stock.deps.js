/* Preambule du domaine magasin — requires et helpers de premier niveau,
   repris VERBATIM de magasin.stock.js. Partage par le handler et par les
   fichiers d'actions. */
/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { METEO_FERMES, admin, bucket, consoAccessControl, db_firestore, demandeCreationArticle, dispatchNotification, downloadUrl, functions, getPool, getSql, invalidateApiCachePrefix, requireAuth, resolveCallerRole, scanAttachment, withCache } = require("../../shared/core");

const nodemailer = require("nodemailer");

// Shared config & middleware
const { validateBdcCore } = require("./bdcValidationService");
const { remindBdcCore } = require("./bdcReminderService");
const { updateBdcVirementCore, recordVirementAvis } = require("./bdcVirementService");
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
  // 2026-09-14 (production readiness) : `photoImg` n'a jamais existé dans cette
  // version — nom laissé par un refactor antérieur qui a généralisé un flag
  // photo unique en compteur multi-photos (terrainPhotoCount, cf. ligne 499).
  // ReferenceError SYSTÉMATIQUE ici → generateRecoForAnalyse ne générait plus
  // AUCUNE recommandation IA depuis le 2026-09-03 (le contrat "never throws"
  // de la fonction avalait l'erreur et renvoyait success:false), pour ses DEUX
  // appelants (BDC magasin ET, une fois câblé, analyses foliaires agronomie).
  console.log(`generateRecoForAnalyse START id=${id} scanPdf=${scanPdfSent} scanImg=${scanImageSent} photo=${!!terrainPhotoCount}`);
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
    has_photo: !!terrainPhotoCount,
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

module.exports = { METEO_FERMES, admin, bucket, consoAccessControl, db_firestore, demandeCreationArticle, dispatchNotification, downloadUrl, functions, getPool, getSql, invalidateApiCachePrefix, requireAuth, resolveCallerRole, scanAttachment, withCache, nodemailer, validateBdcCore, remindBdcCore, updateBdcVirementCore, recordVirementAvis, bdcWorkflow, bdcReceptionGuard, validateSupplier, stockCaneva, articleMerge, articleCategories, stockRoles, stockMovementGuard, receptionBdc, isImpactApplied, checkStockAvailability, buildArticleHistoryIndex, sliceArticleHistory, pmpDetailLib, consoValorisationLib, consoBons, parcelleGroupSplit, uniteConso, locationsConfig, bcScan, bcScanJournal, bcDate, bcDoublons, bcSuppression, identiteArticle, demandesCreationIO, stockFilesRecord, STOCK_FILE_ALLOWED_MIME, STOCK_FILE_ALLOWED_FORMATS_LABEL, ARTICLE_HISTORY_CACHE_TTL_MS, _articleHistoryCache, getArticleHistoryIndex, IDENTITE_ARTICLE_CACHE_TTL_MS, _identiteArticleCache, invalidateIdentiteArticleIndex, getIdentiteArticleIndex, resoudreLignesStock, enregistrerDemandesCreation, cloturerDemandesCreationSatisfaites, PMP_INVOICE_CACHE_TTL_MS, _pmpInvoiceCache, getInvoiceByArticleIndex, fetchMeteoForecast7d, fetchHourlyRadiationByDate, loadIndoorHourlyRadiationByGhType, getNextNumber, generateRecoForAnalyse };
