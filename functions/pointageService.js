/* Extrait de pointageService.js — blocs repris VERBATIM.
   Seul ce preambule de require est ajoute. */
'use strict';
const { JOURS_FERIES_FALLBACK, NOT_HANDLED, USE_MIRROR, __actions, _getCueilletteRows, _getPointageRowsForDate, _getPointageRowsForDateRange, _getPointageRowsForPeriode, _getWorkerHistory, buildHalfToPeriode, buildParCulture, campagneOf, computeAllowedMatricules, computeChargCond, consoAccessControl, cors, deriveFerme, filterArchivedParFerme, filterArchivedParJour, filterArchivedRowsByFerme, filterByFermeField, filterMirrorRowsByCulture, filterMirrorRowsByFerme, filterPresenceRowsByAllowed, filterProdRowsByFerme, filterReposWorkersArchived, findJourApres, findJourAvant, functions, getCueilletteRows, getJoursFeries, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getPool, getWorkerHistory, halfKey, invalidateReferentielCache, loadReferentielCache, pointageCacheKey, recomposeArchivedTotals, recomposeProdTotalKg, resolveCallerProfile, resolveHolidayPeriode, resolvePointageRHAccess, verifyAuth } = require("./pointageService.part1");
const { EXEMPT_BUT_SCOPED, GATING_EXEMPT_ACTIONS, SB_REFERENTIEL_PUBLIC_FIELDS, buildCampagneExportXlsx, computeCampagneAnalytiqueDetail, computeCampagneCoutOuvrier, computeRecolteEquipesPayload, createSnapshot, gatingRequiresPerimetre, getSnapshotData, getSubmittedFermes, projectSbReferentielDoc, projectSbReferentielForCaller, shouldCacheRecolteEquipes, warmAllPointageCaches } = require("./pointageService.part2");


// Exports for use by index.js
exports.createSnapshot = createSnapshot;

exports.getSubmittedFermes = getSubmittedFermes;

exports.getSnapshotData = getSnapshotData;

exports.deriveFerme = deriveFerme;

exports.loadReferentielCache = loadReferentielCache;

exports.invalidateReferentielCache = invalidateReferentielCache;

exports.filterMirrorRowsByFerme = filterMirrorRowsByFerme;

exports.buildParCulture = buildParCulture;

exports.filterMirrorRowsByCulture = filterMirrorRowsByCulture;

exports.filterByFermeField = filterByFermeField;

exports.filterArchivedRowsByFerme = filterArchivedRowsByFerme;

exports.filterProdRowsByFerme = filterProdRowsByFerme;

exports.recomposeProdTotalKg = recomposeProdTotalKg;

exports.filterArchivedParFerme = filterArchivedParFerme;

exports.filterArchivedParJour = filterArchivedParJour;

exports.recomposeArchivedTotals = recomposeArchivedTotals;

exports.filterReposWorkersArchived = filterReposWorkersArchived;

exports.computeAllowedMatricules = computeAllowedMatricules;

exports.filterPresenceRowsByAllowed = filterPresenceRowsByAllowed;

exports.pointageCacheKey = pointageCacheKey;

exports.getJoursFeries = getJoursFeries;

exports.JOURS_FERIES_FALLBACK = JOURS_FERIES_FALLBACK;

exports.computeChargCond = computeChargCond;

exports.halfKey = halfKey;

exports.buildHalfToPeriode = buildHalfToPeriode;

exports.resolveHolidayPeriode = resolveHolidayPeriode;

exports.findJourAvant = findJourAvant;

exports.findJourApres = findJourApres;

exports.shouldCacheRecolteEquipes = shouldCacheRecolteEquipes;

exports.computeRecolteEquipesPayload = computeRecolteEquipesPayload;

exports.computeCampagneCoutOuvrier = computeCampagneCoutOuvrier;

exports.computeCampagneAnalytiqueDetail = computeCampagneAnalytiqueDetail;

exports.buildCampagneExportXlsx = buildCampagneExportXlsx;


// Scheduled function — runs every 10 minutes
exports.warmPointageCache = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("every 10 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    await warmAllPointageCaches();
    return null;
  });

exports.GATING_EXEMPT_ACTIONS = GATING_EXEMPT_ACTIONS;

exports.EXEMPT_BUT_SCOPED = EXEMPT_BUT_SCOPED;

exports.SB_REFERENTIEL_PUBLIC_FIELDS = SB_REFERENTIEL_PUBLIC_FIELDS;

exports.projectSbReferentielDoc = projectSbReferentielDoc;

exports.projectSbReferentielForCaller = projectSbReferentielForCaller;

exports.gatingRequiresPerimetre = gatingRequiresPerimetre;


/**
 * Décision de gating pour une action dont le périmètre A ÉTÉ résolu. PURE.
 *
 * - non autorisé + action NON exemptée      → denied (403).
 * - non autorisé + action exemptée (scoped) → autorisé SANS filtre : la donnée
 *   est non nominative, il n'y a aucun périmètre légitime à appliquer
 *   (cas du magasinier sur le popup Bon de Consommation).
 * - autorisé                                → filtres du périmètre (chef : SA
 *   ferme / SA culture ; dg-finance-rh-admin : null = toutes fermes).
 *
 * @param {string} action
 * @param {{autorise?:boolean, perimetre_ferme?:string, culture_filtre?:(null|string)}|null} perim
 * @returns {{denied: boolean, fermeFilter: (null|string), cultureFilter: (null|string)}}
 */
function resolveGatingFilters(action, perim) {
  const access = resolvePointageRHAccess(perim);
  if (!access.allowed) {
    if (!GATING_EXEMPT_ACTIONS[action]) {
      return { denied: true, fermeFilter: null, cultureFilter: null };
    }
    return { denied: false, fermeFilter: null, cultureFilter: null };
  }
  return {
    denied: false,
    fermeFilter: access.fermeFilter,
    cultureFilter: (perim && perim.culture_filtre) || null,
  };
}

exports.resolveGatingFilters = resolveGatingFilters;


// =============================================
// API: pointageRH
// =============================================
exports.pointageRH = functions.region("europe-west1").runWith({ timeoutSeconds: 180, memory: "512MB" }).https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {

      const action = req.query.action || "summary";

      const dateParam = req.query.date;
 // YYYY-MM-DD

      // Référentiel parcelle→ferme : charge le cache mémoire (best-effort) pour
      // que deriveFerme puisse faire un lookup campagne-aware. Non bloquant : en
      // cas d'échec, deriveFerme retombe sur le fallback règle §3 (100 % iso).
      await loadReferentielCache();


      // ===== GATING PAIE (Étape 0) — barrière serveur sur le nominatif RH =====
      // pointageRH agrège sql_mirror_pointage (nominatif). Rôle résolu SERVEUR
      // depuis users/{uid} (token Firebase), JAMAIS depuis le body/query.
      //  - dg/finance/rh/admin (perimetre_ferme 'all') → toutes fermes (inchangé).
      //  - chef (perimetre_ferme = SA ferme) → lignes filtrées sur sa ferme.
      //  - autres profils / non authentifié → 403 AVANT toute lecture.
      // NB : pointageRH est atteint via /api/pointage-rh (pointageV3) ET la
      // délégation de /api/validation ; les deux passent déjà requireAuth. Le
      // gating est ici pour couvrir les deux points d'entrée en un seul endroit.
      //
      // EXCEPTION — actions OPÉRATIONNELLES non nominatives (caporal, magasinier).
      // Les tables GATING_EXEMPT_ACTIONS et EXEMPT_BUT_SCOPED sont déclarées et
      // justifiées action par action au niveau module (juste au-dessus de cet
      // export), et exportées pour être verrouillées par un test unitaire.
      //
      // Trois régimes :
      //  - action NON exemptée            → périmètre résolu + 403 si non autorisé
      //                                     (comportement d'origine).
      //  - action exemptée ET « scoped »  → périmètre résolu, PAS de 403 : l'exemption
      //                                     lève la barrière SANS lever le cloisonnement.
      //                                     Un chef reste filtré sur SA ferme/culture ;
      //                                     un profil non autorisé (magasinier) passe
      //                                     sans filtre.
      //  - action exemptée « nue »        → bloc entièrement sauté (aucun verifyAuth
      //                                     réintroduit) : comportement historique
      //                                     de l'écran caporal, inchangé.
      // La décision elle-même vit dans gatingRequiresPerimetre / resolveGatingFilters
      // (pures, exportées, verrouillées par tests/unit/pointageGatingExempt.test.js).
      let _fermeFilter = null;
 // null = accès global (all), non autorisé exempté, ou action exemptée nue
      let _cultureFilter = null;
 // null = pas de filtre culture additionnel
      if (gatingRequiresPerimetre(action)) {
        const _authUser = await verifyAuth(req);
        const _callerProfile = await resolveCallerProfile(_authUser);
        const _perim = consoAccessControl.resolvePerimetre(_callerProfile, req.query.ferme);
        const _gate = resolveGatingFilters(action, _perim);
        if (_gate.denied) {
          return res.status(403).json({ success: false, error: "Accès non autorisé" });
        }
        _fermeFilter = _gate.fermeFilter; // null (all / exempté non autorisé) ou 'F1'|'F5'|'Avocatier'|'BAHIA'
        _cultureFilter = _gate.cultureFilter; // null ou 'Myrtille' (chef_f5) / 'Framboise' (chef_f1)
      }

      // Chef : filtre ferme appliqué AU NIVEAU DES LIGNES BRUTES, avant toute
      // agrégation, en shadowant les fetchers. deriveFerme retourne 'Autre' si
      // indéterminé → exclu (fail-closed : jamais dans la ferme d'un chef).
      // Chef Myrtille (chef_f5) : filtre culture additionnel appliqué en plus du filtre ferme.
      const _keepPointage = _fermeFilter
        ? (r) => deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale, campagneOf(r.DateStr) || undefined) === _fermeFilter
        : () => true;

      const _keepCulture = _cultureFilter
        ? (r) => filterMirrorRowsByCulture([r], _cultureFilter).length > 0
        : () => true;

      const _keepCueillette = _fermeFilter
        ? (r) => deriveFerme(r.Reference_Technique, r.Parcelle_Culturale, campagneOf(r.DateStr) || undefined) === _fermeFilter
        : () => true;

      const getPointageRowsForDate = (_fermeFilter || _cultureFilter)
        ? async (...a) => (await _getPointageRowsForDate(...a)).filter(r => _keepPointage(r) && _keepCulture(r))
        : _getPointageRowsForDate;

      const getPointageRowsForDateRange = (_fermeFilter || _cultureFilter)
        ? async (...a) => (await _getPointageRowsForDateRange(...a)).filter(r => _keepPointage(r) && _keepCulture(r))
        : _getPointageRowsForDateRange;

      const getPointageRowsForPeriode = (_fermeFilter || _cultureFilter)
        ? async (...a) => (await _getPointageRowsForPeriode(...a)).filter(r => _keepPointage(r) && _keepCulture(r))
        : _getPointageRowsForPeriode;

      const getWorkerHistory = (_fermeFilter || _cultureFilter)
        ? async (...a) => (await _getWorkerHistory(...a)).filter(r => _keepPointage(r) && _keepCulture(r))
        : _getWorkerHistory;

      const getCueilletteRows = _fermeFilter
        ? async (...a) => (await _getCueilletteRows(...a)).filter(_keepCueillette)
        : _getCueilletteRows;

      // ===== FIN GATING =====

      const db = USE_MIRROR ? null : await getPool();


      return res.status(400).json({ success: false, error: "Unknown action: " + action });

      const __ctx = { req, res, action, dateParam, _fermeFilter, _cultureFilter, _keepPointage, _keepCulture, _keepCueillette, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getWorkerHistory, getCueilletteRows, db };
      for (const __handle of __actions) {
        const __r = await __handle(__ctx);
        if (__r !== NOT_HANDLED) return __r;
      }

    } catch (err) {
      console.error("Erreur pointageRH:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});
