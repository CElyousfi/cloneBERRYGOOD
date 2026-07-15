const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });

// Shared config modules
const { admin, db: db_firestore } = require("./config/firebase");
const sqlConfig = require("./config/sqlConfig");
const { withCache } = require("./middleware/cache");
const { resolveFermeFromParcelle } = require("./lib/pointage/refParcelleFerme");
const {
  aggregateParcellesFromMirror,
  mergeReferentiel,
  isValidCampagneLabel,
} = require("./lib/pointage/parcellesParams");

// =============================================
// Firestore Mirror — reads from synced collections
// =============================================
const {
  getPointageRowsForDate,
  getPointageRowsForDateRange,
  getPointageRowsForPeriode,
  getPointageMeta,
  getAvailableDates,
  getWorkerHistory,
  getCueilletteRows,
  getSyncStatus,
  getConsommationRows,
} = require("./firestoreDataService");

// Aliases bruts (non filtrés) des fetchers de lignes, pour le gating chef
// dans pointageRH : les wrappers filtrés shadowent les noms non préfixés,
// tandis que le reste du fichier continue d'utiliser les fetchers d'origine.
const _getPointageRowsForDate = getPointageRowsForDate;
const _getPointageRowsForDateRange = getPointageRowsForDateRange;
const _getPointageRowsForPeriode = getPointageRowsForPeriode;
const _getWorkerHistory = getWorkerHistory;
const _getCueilletteRows = getCueilletteRows;
const USE_MIRROR = process.env.USE_FIRESTORE_MIRROR !== "false";

// Heures supplémentaires — helpers purs (calcul durée/dépassement + exclusions)
const {
  SEUIL_MINUTES: HS_SEUIL_MINUTES,
  computeDurationOvertime,
  shouldExcludeWorkerDay,
} = require("./lib/heuresSup/heuresSup");

// Pointage — effectifs ouvriers DISTINCTS par (ferme, type).
// Corrige le comptage gonflé (somme des distincts par parcelle → ouvrier multi-parcelles compté N×).
const { countDistinctByFermeType } = require("./lib/pointage/countDistinctByFermeType");
const { dedupeWorkersByMatricule } = require("./lib/pointage/dedupeWorkersByMatricule");
const { defaultPeriodeForCampagne } = require("./lib/pointage/campagnePeriodes");
const { campagneCourante, campagneOf } = require("./lib/mappingConso/campagneUtils");

// Défaut de période = 1re quinzaine de la CAMPAGNE COURANTE (au lieu du plus
// grand numéro toutes campagnes confondues). Fallback gracieux si la campagne
// courante n'a pas encore de quinzaine ou si periodeCampagne est absent du meta
// (période transitoire deploy→1er sync). PUREMENT une couche d'affichage/tri :
// n'ajoute AUCUN paramètre serveur, ne touche à AUCUN cloisonnement ferme.
function defaultPeriode(meta, periodes) {
  return defaultPeriodeForCampagne(
    periodes || (meta && (meta.allPeriodes || meta.periodes)) || [],
    (meta && meta.periodeCampagne) || {},
    campagneCourante()
  );
}

// GATING PAIE (Étape 0) — barrière serveur sur les agrégats RH nominatifs.
// Rôle résolu depuis le token (users/{uid}), jamais depuis le body.
const { verifyAuth } = require("./middleware/requireAuth");
const { resolveCallerProfile } = require("./lib/auth/resolveRole");
const consoAccessControl = require("./lib/valorisation/accessControl");
const { resolvePointageRHAccess } = require("./lib/auth/paieAccess");
const POINTAGE_FERMES = ["F1", "F5", "Avocatier", "BAHIA"];

// SQL — lazy-loaded to avoid loading mssql when USE_MIRROR=true
let sql = null;
let pool = null;
async function getPool() {
  if (!sql) sql = require("mssql");
  if (!pool) pool = await sql.connect(sqlConfig);
  return pool;
}

// =============================================
// Helpers
// =============================================
/**
 * Filtrage ferme PUR des lignes brutes du mirror (Ref_parcelle / Parcelle_Culturale).
 * GATING PAIE (Étape 0) — cloisonnement chef : ne garde que les lignes dont la ferme
 * dérivée === fermeFilter. 'Autre'/indéterminé exclu (fail-closed : jamais dans la
 * ferme d'un chef). fermeFilter falsy (null/'') → passthrough (RH/DG/Finance = toutes
 * fermes, comportement inchangé).
 *
 * @param {Array<{Ref_parcelle?:string, Parcelle_Culturale?:string}>} rows
 * @param {string|null} fermeFilter  'F1'|'F5'|'Avocatier'|'BAHIA' ou null
 * @returns {Array} lignes filtrées
 */
function filterMirrorRowsByFerme(rows, fermeFilter) {
  if (!fermeFilter) return rows || [];
  return (rows || []).filter(r => deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) === fermeFilter);
}

/**
 * Filtrage culture PUR sur les lignes brutes du mirror BR_Pointage.
 * Appliqué APRÈS filterMirrorRowsByFerme pour les chefs ayant un filtre culture
 * additionnel (ex. chef_f5 = Myrtille uniquement dans F5).
 * Fail-closed : si la culture ne peut pas être résolue → exclue.
 * cultureFilter falsy → passthrough (RH/DG/Finance/chef_f1 = toutes cultures).
 *
 * @param {Array} rows          lignes brutes mirror BR_Pointage
 * @param {string|null} cultureFilter  'Myrtille'|'Framboise' ou null
 * @returns {Array}
 */
function filterMirrorRowsByCulture(rows, cultureFilter) {
  if (!cultureFilter) return rows || [];
  var MYRTILLE_VARIETES = ['corina', 'breeze', 'cascade'];
  var FRAMBOISE_VARIETES = ['yazmin', 'maravilla', 'reyna', 'adelita'];
  return (rows || []).filter(function(r) {
    var rawCulture = (r.Culture || r.culture || '').trim();
    if (rawCulture) return rawCulture.toLowerCase() === cultureFilter.toLowerCase();
    // Fallback : résoudre via resolveVariete()
    var resolved = resolveVariete(r.Parcelle_Culturale || r.parcelle || '', r.Ref_parcelle || r.refParcelle || '');
    if (cultureFilter === 'Myrtille') return MYRTILLE_VARIETES.some(function(n) { return (resolved.variete || '').toLowerCase().includes(n); });
    if (cultureFilter === 'Framboise') return FRAMBOISE_VARIETES.some(function(n) { return (resolved.variete || '').toLowerCase().includes(n); });
    return true;
  });
}

/**
 * Filtrage ferme PUR sur un payload DÉJÀ agrégé/enrichi portant un champ `ferme`
 * par élément (ex. snapshots, lignes recolte-equipes enrichies prod). Même règle
 * fail-closed : 'Autre'/mismatch exclu ; fermeFilter falsy → passthrough.
 *
 * @param {Array<{ferme?:string}>} rows
 * @param {string|null} fermeFilter
 * @returns {Array}
 */
function filterByFermeField(rows, fermeFilter) {
  if (!fermeFilter) return rows || [];
  return (rows || []).filter(r => r && r.ferme === fermeFilter);
}

/**
 * Surfaces BR_Parcelle (source authoritative : Sup_Parcelle_Culturale) — même
 * source que le tab Parcelles & Référentiel (action parcelles-campagne-list).
 * Retourne { label Parcelle_Culturale (trim) → hectares > 0 }.
 *
 * RÉSILIENCE (bug « les superficies ont disparu », 2026-07-13) : le serveur
 * BDR est instable ; un simple fallback {} faisait disparaître toutes les
 * surfaces de l'Affectation Analytique pendant 5 min (durée du withCache) à
 * chaque indisponibilité. On persiste donc la dernière carte NON VIDE dans
 * sql_mirror_pointage_meta/br_parcelle_sup et on la sert quand le BDR ne
 * répond pas (mémoire d'instance d'abord, Firestore ensuite, {} en dernier).
 *
 * @returns {Promise<Object<string, number>>}
 */
let _supMapLastGood = null; // cache mémoire d'instance (survit entre requêtes)
async function fetchBrParcelleSupMap() {
  const SUP_DOC = () => db_firestore.collection("sql_mirror_pointage_meta").doc("br_parcelle_sup");
  try {
    const db = await getPool();
    const res = await db.request().query(`
      SELECT Parcelle_Culturale, Sup_Parcelle_Culturale AS Sup
      FROM BR_Parcelle
      WHERE Parcelle_Culturale IS NOT NULL AND Parcelle_Culturale != ''`);
    const supMap = {};
    res.recordset.forEach(r => {
      const lbl = (r.Parcelle_Culturale || "").trim();
      const sup = parseFloat(r.Sup) || 0;
      if (lbl && sup > 0) supMap[lbl] = sup;
    });
    if (Object.keys(supMap).length > 0) {
      _supMapLastGood = supMap;
      // Persistance best-effort (ne bloque pas la réponse)
      SUP_DOC().set({ supMap, updated_at: Date.now() }).catch(() => {});
      return supMap;
    }
    // Requête OK mais vide (table purgée ?) → ne pas écraser le last-known-good
    return _supMapLastGood || {};
  } catch (e) {
    if (_supMapLastGood) return _supMapLastGood;
    try {
      const doc = await SUP_DOC().get();
      if (doc.exists && doc.data().supMap) {
        _supMapLastGood = doc.data().supMap;
        return _supMapLastGood;
      }
    } catch (e2) { /* Firestore aussi KO → dégradé {} */ }
    return {};
  }
}

/**
 * Enrichit des lignes analytique (portant `parcelle`) avec `haRef` = surface
 * BR_Parcelle si connue (0 sinon). PUR — ne mute pas les lignes d'entrée.
 *
 * @param {Array<{parcelle?:string}>} rows
 * @param {Object<string, number>} supMap
 * @returns {Array}
 */
function enrichRowsWithHaRef(rows, supMap) {
  return (rows || []).map(r => ({ ...r, haRef: (supMap && supMap[(r.parcelle || "").trim()]) || 0 }));
}

/**
 * Filtrage ferme PUR sur les lignes ARCHIVÉES (quinzaine_archive → analytique).
 * Ces lignes portent `parcelle` + `refParcelle` (grain parcelle/opération, agrégé
 * par variété en aval) → la ferme est dérivable via deriveFerme(). Même règle
 * fail-closed : ferme dérivée ≠ fermeFilter (ou 'Autre'/indéterminé) → exclu.
 * fermeFilter falsy (null) → passthrough (RH/DG/Finance = toutes fermes, inchangé).
 *
 * Utilisé pour cloisonner le chemin archivé de mo-analytique-variete /
 * campagne-mo-variete : sans ça, un chef verrait les agrégats coût/JH archivés
 * de TOUTES les fermes.
 *
 * @param {Array<{parcelle?:string, refParcelle?:string}>} rows
 * @param {string|null} fermeFilter  'F1'|'F5'|'Avocatier'|'BAHIA' ou null
 * @returns {Array} lignes archivées filtrées
 */
function filterArchivedRowsByFerme(rows, fermeFilter) {
  if (!fermeFilter) return rows || [];
  return (rows || []).filter(r => r && deriveFerme(r.refParcelle, r.parcelle) === fermeFilter);
}

/**
 * Filtrage ferme PUR sur les lignes de PRODUCTION (prod_tracabilite_recolte/{date}.rows
 * et docs de campagne). Ces lignes portent `refParcelle` (pas de parcelle culturale
 * fiable) → la ferme se dérive via deriveFerme(refParcelle, ''). Même règle fail-closed :
 * ferme dérivée ≠ fermeFilter (ou 'Autre'/indéterminé) → exclu. fermeFilter falsy (null)
 * → passthrough STRICT (RH/DG/Finance = toutes fermes, inchangé).
 *
 * ⚠️ Sécurité : prod_tracabilite_recolte contient TOUS les ouvriers de TOUTES les fermes
 * (aucun champ ferme stocké). Sans ce filtre, un chef reçoit matricule+nom+kg d'autres
 * fermes (fuite nominative) via l'enrichissement recolte et le kg de campagne-mo-variete.
 *
 * @param {Array<{refParcelle?:string}>} prodRows
 * @param {string|null} fermeFilter  'F1'|'F5'|'Avocatier'|'BAHIA' ou null
 * @returns {Array} lignes prod filtrées
 */
function filterProdRowsByFerme(prodRows, fermeFilter) {
  if (!fermeFilter) return prodRows || [];
  return (prodRows || []).filter(r => r && deriveFerme(r.refParcelle, '') === fermeFilter);
}

/**
 * Recompose le total kg cueillette (récolte) pour un chef à partir des lignes prod
 * DÉJÀ filtrées par sa ferme. En prod, l'enrichissement recolte remplace le détail
 * BR_Cueillette par un total unique issu de prod_tracabilite_recolte
 * (`prodData.totalKg`), qui est un total TOUTES fermes → il fuiterait à un chef.
 * On resomme donc `totalKg` sur les seules lignes prod de sa ferme.
 * fermeFilter falsy (null) → on retourne le total prod d'origine (comportement inchangé).
 *
 * @param {Array<{totalKg?:number}>} filteredProdRows  lignes prod DÉJÀ filtrées ferme
 * @param {number} originalTotalKg  prodData.totalKg (total toutes fermes)
 * @param {string|null} fermeFilter
 * @returns {number} total kg cloisonné
 */
function recomposeProdTotalKg(filteredProdRows, originalTotalKg, fermeFilter) {
  if (!fermeFilter) return originalTotalKg || 0;
  return (filteredProdRows || []).reduce((s, r) => s + ((r && r.totalKg) || 0), 0);
}

/**
 * Cloisonne l'agrégat archivé `summary.parFerme` (action=quinzaine) pour un chef.
 * `parFerme` est un tableau d'objets `{ferme, journees, cout, ...}` déjà keyé par
 * ferme → on ne garde QUE l'entrée de la ferme du chef. Fail-closed : toute entrée
 * d'une autre ferme (ou 'Autre') est exclue.
 * fermeFilter falsy (null) → passthrough (RH/DG/Finance = toutes fermes, inchangé).
 *
 * @param {Array<{ferme?:string}>} parFerme
 * @param {string|null} fermeFilter
 * @returns {Array}
 */
function filterArchivedParFerme(parFerme, fermeFilter) {
  if (!fermeFilter) return parFerme || [];
  return (parFerme || []).filter(e => e && e.ferme === fermeFilter);
}

/**
 * Cloisonne l'agrégat archivé `summary.parJour` (action=quinzaine) pour un chef.
 * Chaque entrée jour porte une ventilation par ferme (`F1`, `F5`, `Avocatier`,
 * `BAHIA` = nb ouvriers distincts ce jour sur cette ferme) + des totaux tous-fermes
 * (`nbOuv`, `journees`, `cout`). Pour un chef, on ne peut PAS reconstituer ses
 * `journees`/`cout` du jour depuis l'archive (seul le compte d'ouvriers est ventilé
 * par ferme, pas le coût). On recompose donc chaque jour en :
 *   - `nbOuv` = le compte de SA ferme,
 *   - les autres colonnes ferme mises à 0 (ne pas révéler les autres fermes),
 *   - `journees`/`cout` mis à 0 (non ventilables par ferme dans l'archive → fail-closed,
 *     on n'expose pas un total tous-fermes à un chef).
 * fermeFilter falsy (null) → passthrough (inchangé).
 *
 * @param {Array<object>} parJour
 * @param {string|null} fermeFilter
 * @returns {Array}
 */
function filterArchivedParJour(parJour, fermeFilter) {
  if (!fermeFilter) return parJour || [];
  const FERMES = ['F1', 'F5', 'Avocatier', 'BAHIA'];
  return (parJour || []).map(d => {
    const nbOuv = Number((d && d[fermeFilter]) || 0);
    const out = { jour: d.jour, jourLabel: d.jourLabel, nbOuv, journees: 0, cout: 0 };
    for (const f of FERMES) out[f] = f === fermeFilter ? nbOuv : 0;
    return out;
  });
}

/**
 * Recompose totalJournees/totalCout du chef depuis l'agrégat parFerme filtré.
 * L'archive stocke des totaux tous-fermes → un chef ne doit voir QUE la somme de
 * sa ferme. fermeFilter falsy → on retourne les totaux d'origine (inchangé).
 *
 * @param {Array<{journees?:number,cout?:number}>} filteredParFerme parFerme DÉJÀ filtré
 * @param {{totalJournees?:number,totalCout?:number}} originalTotals
 * @param {string|null} fermeFilter
 * @returns {{totalJournees:number, totalCout:number}}
 */
function recomposeArchivedTotals(filteredParFerme, originalTotals, fermeFilter) {
  if (!fermeFilter) {
    return {
      totalJournees: (originalTotals && originalTotals.totalJournees) || 0,
      totalCout: (originalTotals && originalTotals.totalCout) || 0,
    };
  }
  let totalJournees = 0;
  let totalCout = 0;
  for (const e of filteredParFerme || []) {
    totalJournees += (e && e.journees) || 0;
    totalCout += (e && e.cout) || 0;
  }
  return { totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout) };
}

/**
 * Cloisonne les workers repos archivés (action=quinzaine-repos) pour un chef.
 *
 * `reposData.workers` = {matricule, nom, joursPresent} de TOUTES fermes, sans champ
 * ferme ni parcelle exploitable pour dériver la ferme. Contrairement au mirror (où
 * computeAllowedMatricules dérive le set depuis les lignes brutes filtrées), l'archive
 * ne conserve AUCUNE source ferme pour restreindre les workers repos.
 *
 * DÉCISION fail-closed (priorité = zéro fuite nominative) : pour un chef, on n'expose
 * PAS le nominatif repos cross-ferme d'une période archivée → on vide `workers`.
 * fermeFilter falsy (null) → passthrough (RH/DG/Finance, inchangé).
 *
 * @param {Array} workers reposData.workers
 * @param {string|null} fermeFilter
 * @returns {Array} workers (vidé pour un chef, inchangé pour RH/DG/Finance)
 */
function filterReposWorkersArchived(workers, fermeFilter) {
  if (!fermeFilter) return workers || [];
  return [];
}

/**
 * Calcule le set des matricules (UPPERCASE) AUTORISÉS pour un chef à partir des
 * lignes brutes du mirror : ceux ayant ≥1 ligne pointage sur SA ferme.
 * Réutilise la même logique fail-closed que buildHeuresSup — sert à cloisonner
 * prod_presence, qui ne porte pas de parcelle exploitable pour dériver la ferme.
 *
 * @param {Array} mirrorRows lignes brutes du mirror (Personnel_Matricule + parcelle)
 * @param {string|null} fermeFilter ferme du chef, ou null (RH/DG/Finance)
 * @returns {Set<string>|null} set de matricules UPPERCASE, ou null si fermeFilter falsy
 */
function computeAllowedMatricules(mirrorRows, fermeFilter) {
  if (!fermeFilter) return null;
  const allowed = new Set();
  for (const r of filterMirrorRowsByFerme(mirrorRows, fermeFilter)) {
    const m = String(r.Personnel_Matricule || '').trim().toUpperCase();
    if (m) allowed.add(m);
  }
  return allowed;
}

/**
 * Filtrage PUR des lignes prod_presence par set de matricules autorisés.
 * prod_presence n'a pas de parcelle → on restreint aux matricules ayant pointé
 * la ferme du chef (set dérivé du mirror via computeAllowedMatricules).
 * Fail-closed : un ouvrier présent mais jamais pointé sur cette ferme est exclu.
 * allowedMatricules null (RH/DG/Finance) → passthrough (toutes rows, inchangé).
 *
 * @param {Array<{matricule?:string}>} rows lignes prod_presence (champ `matricule`)
 * @param {Set<string>|null} allowedMatricules matricules UPPERCASE autorisés, ou null
 * @returns {Array}
 */
function filterPresenceRowsByAllowed(rows, allowedMatricules) {
  if (!allowedMatricules) return rows || [];
  return (rows || []).filter(r => {
    const m = String((r && r.matricule) || '').trim().toUpperCase();
    return m && allowedMatricules.has(m);
  });
}

/**
 * Construit une clé de cache ferme-aware pour les actions pointageRH nominatives.
 *
 * withCache utilise un cache Firestore PARTAGÉ par clé. Or le payload nominatif
 * est filtré par la ferme de l'appelant (_fermeFilter via le shadow des fetchers).
 * Sans dimension de périmètre dans la clé, un chef-F1 et le RH (scope 'all')
 * partageraient la MÊME entrée → soit une FUITE nominative (payload toutes-fermes
 * servi à un chef), soit une perte de données (payload F1 servi au RH).
 *
 * On suffixe donc la clé par le périmètre : `_all` pour RH/DG/Finance
 * (fermeFilter null), `_<ferme>` pour un chef. Les warm paths (préchauffage)
 * s'alignent sur `_all` pour continuer à réchauffer la vue RH sans polluer les
 * vues chef.
 *
 * @param {string} base clé de base (sans dimension ferme)
 * @param {string|null|undefined} fermeFilter ferme du chef, ou null/undefined = 'all'
 * @returns {string} clé ferme-aware
 */
function pointageCacheKey(base, fermeFilter, cultureFilter) {
  const fermeKey = fermeFilter || 'all';
  const cultureKey = cultureFilter ? `_${cultureFilter.toLowerCase()}` : '';
  return `${base}_${fermeKey}${cultureKey}`;
}

// =============================================
// Référentiel parcelle → ferme (docs/spec-referentiel-parcelle-ferme.md)
// =============================================
// Cache en mémoire du référentiel `parcelle_ferme_referentiel` (clé
// `${campagne}__${ref_parcelle}` → ferme). deriveFerme est appelé
// SYNCHRONEMENT dans des dizaines de map/filter → on ne peut pas lire Firestore
// par ligne. On charge donc le référentiel en mémoire (comme le meta pointage)
// et deriveFerme fait un lookup synchrone, avec fallback règle §3 inline (module
// pur, 100 % iso) si la parcelle n'est pas encore synchro. Zéro régression : tant
// qu'il n'y a pas d'override `manual`, lookup et fallback donnent le même résultat.
let _referentielCache = null; // Map<`${campagne}__${ref}`, ferme> | null
let _referentielLoadedAt = 0;
const REFERENTIEL_TTL_MS = 10 * 60 * 1000; // rechargé au max toutes les 10 min

/**
 * Charge (ou recharge) le cache référentiel depuis Firestore. Tolérant aux
 * erreurs : en cas d'échec, laisse le cache existant (ou null) → deriveFerme
 * retombe sur le fallback règle §3 (fail-safe, jamais de crash).
 * @param {boolean} [force] force le rechargement même si TTL non expiré
 */
async function loadReferentielCache(force) {
  const now = Date.now();
  if (!force && _referentielCache && (now - _referentielLoadedAt) < REFERENTIEL_TTL_MS) {
    return _referentielCache;
  }
  try {
    const snap = await db_firestore.collection("parcelle_ferme_referentiel").get();
    const map = new Map();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      // INCONNU stocké tel quel : le runtime le traite en fail-closed + alerte.
      if (d.ferme) map.set(doc.id, d.ferme);
    });
    _referentielCache = map;
    _referentielLoadedAt = now;
  } catch (e) {
    console.error("[referentiel] chargement cache échec:", e.message);
    if (!_referentielCache) _referentielCache = new Map();
  }
  return _referentielCache;
}

/** Invalide le cache (appelé après une synchro du référentiel). */
function invalidateReferentielCache() {
  _referentielCache = null;
  _referentielLoadedAt = 0;
}

/**
 * Dérive la ferme SB d'une ligne de pointage.
 *
 * Signature RÉTROCOMPATIBLE : `campagne` est optionnel. Quand il est fourni ET
 * que le cache référentiel est chargé, on tente un LOOKUP
 * `parcelle_ferme_referentiel/${campagne}__${ref}`. Sinon (ou si absent du
 * référentiel) → FALLBACK règle §3 inline (module pur), 100 % iso avec l'ancien
 * comportement.
 *
 * Retour : 'F1' | 'F5' | 'Avocatier' | 'BAHIA' | 'Autre'.
 * NOTE : on renvoie toujours 'Autre' (pas 'INCONNU') côté deriveFerme pour ne
 * PAS changer le contrat des dizaines d'appelants (fail-closed inchangé : une
 * parcelle non résolue n'entre dans aucune ferme de chef). La détection des
 * parcelles ACTIVES non résolues + l'alerte se font dans le JOB de synchro
 * (§6), qui a le contexte « parcelle active » et le debounce.
 *
 * @param {*} refParcelle Ref_parcelle
 * @param {*} parcelleCulturale label Parcelle_Culturale
 * @param {string} [campagne] libellé campagne ('2026-2027') pour le lookup
 * @returns {'F1'|'F5'|'Avocatier'|'BAHIA'|'Autre'}
 */
function deriveFerme(refParcelle, parcelleCulturale, campagne) {
  // 1. Lookup référentiel (cache mémoire) si campagne + ref disponibles.
  if (campagne && _referentielCache) {
    const ref = (refParcelle == null ? "" : String(refParcelle)).trim();
    if (ref) {
      const hit = _referentielCache.get(`${campagne}__${ref}`);
      if (hit && hit !== "INCONNU") return hit;
      // hit === 'INCONNU' → on retombe sur le fallback règle (peut avoir été
      // résolu depuis via le label) ; si le fallback ne tranche pas non plus →
      // 'Autre' (fail-closed). hit absent → parcelle hors référentiel → fallback.
    }
  }
  // 2. Fallback règle §3 inline (module pur, 100 % iso avec l'ancienne liste).
  const { ferme } = resolveFermeFromParcelle({
    refParcelle,
    label: parcelleCulturale,
    variete: undefined,
    idFermes: undefined,
  });
  // INCONNU → 'Autre' pour préserver le contrat des appelants (fail-closed).
  return ferme === "INCONNU" ? "Autre" : ferme;
}

/**
 * Resolve specific myrtille sub-variety from parcelle name.
 * BEE ONE Variete field just says "Myrtille" — the actual sub-variety
 * (Corina, Breeze, Cascade) is encoded in the parcelle designation.
 * This is needed because prime thresholds differ: Corina=30kg, Breeze/Cascade=25kg.
 */
function resolveMyrtilleVariete(variete, parcelle) {
  const v = (variete || "").toLowerCase();
  // If already specific, keep it
  if (/corina|corrina|breeze|cascade/i.test(v)) return variete;
  // Only resolve for generic "myrtille"
  if (!/myrtille|blue/i.test(v)) return variete;
  const p = (parcelle || "").toUpperCase();
  if (p.includes("BREEZE")) return "Breeze";
  if (p.includes("CASCADE")) return "Cascade";
  if (p.includes("CORINA") || p.includes("CORRINA")) return "Corina";
  // S8-2 = Breeze, S8-1 = Cascade, S8 (alone) = Corina
  if (/\bS8[\s-]*2\b/.test(p)) return "Breeze";
  if (/\bS8[\s-]*1\b/.test(p)) return "Cascade";
  if (/\bS8\b/.test(p)) return "Corina";
  // Default to Corina (most common myrtille)
  return "Corina";
}

/**
 * Resolve parcelle name to { variete, culture, ferme } for analytical accounting.
 * Mirrors the frontend normalizeParcelle() logic.
 */
// Detect sub-cycle type from parcelle name.
// 1) Explicit keywords win: "LONG CANE/LC/MT/BI CYCLE" → Long Cane ; "MOW DOWN/MD/GREEN CANE/GC/MOTTE" → Mow Down
// 2) Fallback by sector code (S1-S14) based on cpcVarietes layout:
//    Maravilla: S1,S4 = Mow Down ; S3,S7 = Long Cane
//    Yazmin:    S2,S5,S13 = Mow Down ; S10 = Long Cane
// Returns ' Long Cane', ' Mow Down', or '' (unknown).
function detectFramboiseSubType(parcelle, varieteName) {
  const u = (parcelle || "").toUpperCase();
  if (/\bLONG\s*CANE\b|\bLC\b|\bMT\b|\bBI[\s-]*CYCLE\b/.test(u)) return ' Long Cane';
  if (/\bMOW\s*DOWN\b|\bMD\b|\bGREEN\s*CANE\b|\bGC\b|\bMOTTE\b/.test(u)) return ' Mow Down';
  // Sector-based fallback
  const sMatch = u.match(/\bS(\d{1,2})\b/);
  if (sMatch) {
    const s = parseInt(sMatch[1], 10);
    if (varieteName === 'Maravilla') {
      if (s === 1 || s === 4) return ' Mow Down';
      if (s === 3 || s === 7) return ' Long Cane';
    }
    if (varieteName === 'Yazmin') {
      if (s === 2 || s === 5 || s === 13) return ' Mow Down';
      if (s === 10) return ' Long Cane';
    }
  }
  return '';
}

function resolveVariete(parcelle, refParcelle) {
  const u = (parcelle || "").toUpperCase();
  const ferme = deriveFerme(refParcelle, parcelle);
  if (u.includes('MARAVILLA')) return { variete: 'Maravilla' + detectFramboiseSubType(parcelle, 'Maravilla'), culture: 'Framboise', ferme };
  if (u.includes('YAZMIN') || u.includes('YASMIN')) return { variete: 'Yazmin' + detectFramboiseSubType(parcelle, 'Yazmin'), culture: 'Framboise', ferme };
  if (u.includes('REYNA') || u.includes('REINA')) return { variete: 'Reyna', culture: 'Framboise', ferme };
  if (u.includes('CORINA') || u.includes('CORRINA')) return { variete: 'Corina', culture: 'Myrtille', ferme };
  if (u.includes('CASCADE')) return { variete: 'Cascade', culture: 'Myrtille', ferme };
  if (u.includes('BREEZE')) return { variete: 'Breeze', culture: 'Myrtille', ferme };
  if (u.includes('ADELITA')) return { variete: 'Adelita', culture: 'Framboise', ferme };
  if (u.includes('AVOCAT')) return { variete: 'Avocat', culture: 'Avocat', ferme: 'Avocatier' };
  if (ferme === 'Avocatier') return { variete: 'Avocat', culture: 'Avocat', ferme: 'Avocatier' };
  // Fallback: try sector-based matching
  const sMatch = u.match(/\bS(\d{1,2})\b/);
  if (sMatch) {
    const sNum = parseInt(sMatch[1], 10);
    if (sNum >= 1 && sNum <= 7) return { variete: 'Maravilla', culture: 'Framboise', ferme };
    if (sNum === 8) return { variete: 'Corina', culture: 'Myrtille', ferme };
    if (sNum === 9) return { variete: 'Reyna', culture: 'Framboise', ferme };
    if (sNum === 10) return { variete: 'Yazmin', culture: 'Framboise', ferme };
    if (sNum === 13) return { variete: 'Yazmin', culture: 'Framboise', ferme };
  }
  return { variete: 'Autre', culture: 'Autre', ferme };
}

/**
 * Extract kg from Quantite_unite using the weight per unit from Operation name.
 * Supports: "Récolte Caisse 2.4 kg", "Barquette 2.2 kg", "Seau 5 kg", etc.
 * Returns 0 if no `X kg` pattern is found — the production base
 * (prod_tracabilite_recolte) is the source of truth and overrides this value
 * for real harvesters; non-harvest support roles (Chargement, Conditionnement,
 * Caporal) have Quantite_unite=0 so they correctly produce 0 kg.
 */
const _qtkWarned = new Set();
function quantiteToKg(quantiteUnite, operation) {
  const q = quantiteUnite || 0;
  const op = operation || "";
  const match = op.match(/([\d.]+)\s*kg/i);
  if (!match) {
    if (q > 0 && op && !_qtkWarned.has(op)) {
      console.warn(`[quantiteToKg] No kg pattern in "${op}" with qty=${q} → returning 0`);
      _qtkWarned.add(op);
    }
    return 0;
  }
  return Math.round(q * parseFloat(match[1]) * 10) / 10;
}

// =============================================
// Jours fériés Maroc — source unique
// Vérité = Firestore app_settings/jours_feries (seedé depuis ce fallback).
// Statut: 'fixe' (grégorien sûr) | 'estime' (lunaire, à confirmer) | 'confirme' (RH/API).
// =============================================
const JOURS_FERIES_FALLBACK = [
  { date: '2025-01-01', label: 'Nouvel An', type: 'fixe', status: 'fixe' },
  { date: '2025-01-11', label: "Manifeste de l'Indépendance", type: 'fixe', status: 'fixe' },
  { date: '2025-01-14', label: 'Nouvel An Amazigh', type: 'fixe', status: 'fixe' },
  { date: '2025-05-01', label: 'Fête du Travail', type: 'fixe', status: 'fixe' },
  { date: '2025-07-30', label: 'Fête du Trône', type: 'fixe', status: 'fixe' },
  { date: '2025-08-14', label: 'Oued Ed-Dahab', type: 'fixe', status: 'fixe' },
  { date: '2025-08-20', label: 'Révolution du Roi et du Peuple', type: 'fixe', status: 'fixe' },
  { date: '2025-08-21', label: 'Fête de la Jeunesse', type: 'fixe', status: 'fixe' },
  { date: '2025-11-06', label: 'Marche Verte', type: 'fixe', status: 'fixe' },
  { date: '2025-11-18', label: "Fête de l'Indépendance", type: 'fixe', status: 'fixe' },
  // Islamiques 2025
  { date: '2025-03-30', label: 'Aïd Al Fitr', type: 'islamique', status: 'fixe' },
  { date: '2025-03-31', label: 'Aïd Al Fitr (2e jour)', type: 'islamique', status: 'fixe' },
  { date: '2025-06-06', label: 'Aïd Al Adha', type: 'islamique', status: 'fixe' },
  { date: '2025-06-07', label: 'Aïd Al Adha (2e jour)', type: 'islamique', status: 'fixe' },
  { date: '2025-06-27', label: '1er Moharram', type: 'islamique', status: 'fixe' },
  { date: '2025-09-05', label: 'Aïd Al Mawlid', type: 'islamique', status: 'fixe' },
  { date: '2026-01-01', label: 'Nouvel An', type: 'fixe', status: 'fixe' },
  { date: '2026-01-11', label: "Manifeste de l'Indépendance", type: 'fixe', status: 'fixe' },
  { date: '2026-01-14', label: 'Nouvel An Amazigh', type: 'fixe', status: 'fixe' },
  { date: '2026-05-01', label: 'Fête du Travail', type: 'fixe', status: 'fixe' },
  { date: '2026-07-30', label: 'Fête du Trône', type: 'fixe', status: 'fixe' },
  { date: '2026-08-14', label: 'Oued Ed-Dahab', type: 'fixe', status: 'fixe' },
  { date: '2026-08-20', label: 'Révolution du Roi et du Peuple', type: 'fixe', status: 'fixe' },
  { date: '2026-08-21', label: 'Fête de la Jeunesse', type: 'fixe', status: 'fixe' },
  { date: '2026-11-06', label: 'Marche Verte', type: 'fixe', status: 'fixe' },
  { date: '2026-11-18', label: "Fête de l'Indépendance", type: 'fixe', status: 'fixe' },
  // Islamiques 2026 (estimées via conversion Hijri Umm-al-Qura — à confirmer la veille)
  { date: '2026-03-20', label: 'Aïd Al Fitr', type: 'islamique', status: 'estime' },
  { date: '2026-05-27', label: 'Aïd Al Adha', type: 'islamique', status: 'estime' },
  { date: '2026-06-16', label: '1er Moharram', type: 'islamique', status: 'estime' },
  { date: '2026-08-25', label: 'Aïd Al Mawlid', type: 'islamique', status: 'estime' },
];

/**
 * Charge les jours fériés depuis Firestore (app_settings/jours_feries).
 * Fallback sur la constante JOURS_FERIES_FALLBACK si lecture vide/échoue.
 * @returns {Promise<Array<{date,label,type,status}>>}
 */
async function getJoursFeries() {
  try {
    const snap = await db_firestore.collection("app_settings").doc("jours_feries").get();
    if (snap.exists) {
      const holidays = snap.data().holidays;
      if (Array.isArray(holidays) && holidays.length) return holidays;
    }
  } catch (e) {
    console.error("getJoursFeries: lecture Firestore échouée, fallback constante:", e.message);
  }
  return JOURS_FERIES_FALLBACK;
}

/**
 * Clé de demi-mois calendaire pour une date ISO (YYYY-MM-DD).
 * Jours 1–15 → 1re quinzaine (H1), 16–fin → 2e quinzaine (H2).
 * @param {string} ds - date ISO 'YYYY-MM-DD'
 * @returns {string} ex. '2026-06-H1'
 */
function halfKey(ds) {
  return ds.slice(0, 7) + (parseInt(ds.slice(8, 10), 10) <= 15 ? '-H1' : '-H2');
}

/**
 * Construit la map demi-mois calendaire → période depuis dateToPeriode.
 * Permet de rattacher un férié à la quinzaine qui le CONTIENT au calendrier,
 * sans déborder sur une date voisine d'une autre quinzaine.
 * @param {Object<string,string>} dateToPeriode - { 'YYYY-MM-DD': 'Quinzaine N' }
 * @returns {Object<string,string>} { '2026-06-H1': 'Quinzaine 23', ... }
 */
function buildHalfToPeriode(dateToPeriode) {
  const halfToPeriode = {};
  for (const d of Object.keys(dateToPeriode)) {
    const p = dateToPeriode[d];
    if (!p) continue;
    const k = halfKey(d);
    // 1re période rencontrée pour cette demi-mois (les quinzaines étant calendaires,
    // une demi-mois ne devrait correspondre qu'à une seule période).
    if (!(k in halfToPeriode)) halfToPeriode[k] = p;
  }
  return halfToPeriode;
}

/**
 * Résout la période d'un férié via sa quinzaine calendaire.
 * @param {Object<string,string>} halfToPeriode
 * @param {string} dateStr - date ISO du férié 'YYYY-MM-DD'
 * @returns {string|undefined} période ('Quinzaine N') ou undefined si la quinzaine
 *   du férié n'a pas encore de données.
 */
function resolveHolidayPeriode(halfToPeriode, dateStr) {
  return halfToPeriode[halfKey(dateStr)];
}

/**
 * Compute chargement/conditionnement worker-day details from raw pointage rows.
 * Returns pre-calculated data so frontend doesn't need to filter on Operation.
 * @param {Array} allRows
 * @param {Array} [holidays] - liste fériés (Firestore) ; fallback constante si vide.
 */
function computeChargCond(allRows, holidays) {
  const JOURS_FERIES = (Array.isArray(holidays) && holidays.length) ? holidays : JOURS_FERIES_FALLBACK;
  const chargWorkers = {}; // { "periode|mat" -> { matricule, nom, periode, ferme, jours: Set } }
  const condWorkers = {};
  for (const r of allRows) {
    const mat = (r.Personnel_Matricule || "").trim();
    const nom = (r.Personnel_Nom || "").trim();
    const jour = r.DateStr;
    const op = (r.Operation || "").trim();
    const fam = (r.Operation_Famille || "").trim();
    const periode = (r.Periode_paie || "").trim();
    const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
    if (fam === "8. Récolte" && /^chargement$/i.test(op)) {
      const key = `${periode}|${mat}`;
      if (!chargWorkers[key]) chargWorkers[key] = { matricule: mat, nom, periode, ferme, jours: new Set() };
      chargWorkers[key].jours.add(jour);
    }
    if (fam === "8. Récolte" && /conditionnement/i.test(op)) {
      const key = `${periode}|${mat}`;
      if (!condWorkers[key]) condWorkers[key] = { matricule: mat, nom, periode, ferme, jours: new Set() };
      condWorkers[key].jours.add(jour);
    }
  }
  const toList = (map) => Object.values(map).map(w => ({ matricule: w.matricule, nom: w.nom, periode: w.periode, ferme: w.ferme, jh: w.jours.size, jours: [...w.jours].sort() }));

  // Build date → periode mapping
  const dateToPeriode = {};
  for (const r of allRows) {
    const d = r.DateStr;
    const p = (r.Periode_paie || "").trim();
    if (d && p) dateToPeriode[d] = p;
  }
  // Map demi-mois calendaire → période (rattachement férié par quinzaine, sans débordement voisin).
  const halfToPeriode = buildHalfToPeriode(dateToPeriode);

  // Build worker-per-period map with average daily cost
  const workerPeriod = {}; // "periode|mat" -> { mat, nom, periode, ferme, jours: Set, totalCout, coutCount }
  for (const r of allRows) {
    const mat = (r.Personnel_Matricule || "").trim();
    const nom = (r.Personnel_Nom || "").trim();
    const periode = (r.Periode_paie || "").trim();
    const cout = r.Cout || 0;
    const jour = r.DateStr;
    const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
    const key = `${periode}|${mat}`;
    if (!workerPeriod[key]) workerPeriod[key] = { mat, nom, periode, ferme, jours: new Set(), totalCout: 0, coutCount: 0 };
    if (!workerPeriod[key].jours.has(jour)) {
      workerPeriod[key].jours.add(jour);
      if (cout > 0) { workerPeriod[key].totalCout += cout; workerPeriod[key].coutCount++; }
    }
  }

  // For each jour férié, find its quinzaine and credit all active workers
  const ferieWorkers = {}; // "periode|mat" -> { matricule, nom, periode, details: [] }
  for (const jf of JOURS_FERIES) {
    // Aïd = 2 jours fériés légaux, mais la prime ne compte QUE le 1er jour.
    // On ignore donc les entrées « (2e jour) » (et tout flag compteurPrime:false).
    if (/\(2e\s*jour\)/i.test(jf.label || '') || jf.compteurPrime === false) continue;
    // Rattachement par quinzaine CALENDAIRE (1–15 / 16–fin) : le férié appartient à la
    // quinzaine qui le contient au calendrier. Si cette quinzaine n'a pas encore de
    // données (ex. férié futur), le férié n'est crédité à personne (continue).
    const holidayPeriode = resolveHolidayPeriode(halfToPeriode, jf.date);
    if (!holidayPeriode) continue; // Quinzaine du férié sans données chargées

    // All workers active in this period are eligible for 1 jour sup
    for (const [, wp] of Object.entries(workerPeriod)) {
      if (wp.periode !== holidayPeriode) continue;
      const fKey = `${wp.periode}|${wp.mat}`;
      if (!ferieWorkers[fKey]) ferieWorkers[fKey] = { matricule: wp.mat, nom: wp.nom, periode: wp.periode, ferme: wp.ferme, details: [] };
      const avgCout = wp.coutCount > 0 ? wp.totalCout / wp.coutCount : 0;
      ferieWorkers[fKey].details.push({ date: jf.date, label: jf.label, raison: 'Jour férié dans la quinzaine', cout: avgCout });
    }
  }
  const ferieList = Object.values(ferieWorkers).map(w => ({
    matricule: w.matricule, nom: w.nom, periode: w.periode, ferme: w.ferme,
    jh: w.details.length, details: w.details,
    cout: Math.round(w.details.reduce((s, d) => s + (d.cout || 0), 0) * 100) / 100,
  }));

  return {
    chargementDetail: toList(chargWorkers),
    conditionnementDetail: toList(condWorkers),
    jourFerieDetail: ferieList,
    joursFeries: JOURS_FERIES,
  };
}

const REFERENTIEL_FAMILLES = {
  'GB01': 'Travaux du sol',
  'GB02': 'Ferti-irrigation',
  'GB03': 'Plantation',
  'GB04': 'Mise en valeur',
  'GB05': 'Entretien structure',
  'GB06': 'Traitement phyto',
  'GB07': 'Tuteurage & palissage',
  'GB08': 'Récolte',
  'GB09': 'Taille',
  'GB10': 'Arrachage',
  'GB11': 'Services généraux',
};

// =============================================
// Référentiel tâches — cache Firestore (1h)
// =============================================

// Cache en mémoire — rechargé toutes les heures (pas de hot-reload en prod)
let _refTachesCache = null;
let _refTachesCacheAt = 0;

async function loadReferentielTaches() {
  const now = Date.now();
  if (_refTachesCache && (now - _refTachesCacheAt) < 60 * 60 * 1000) return _refTachesCache;
  try {
    const snap = await db_firestore.collection('referentiel_taches').get();
    const map = {}; // code -> { famille, groupe }
    const ops = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.code && d.famille && !map[d.code]) {
        map[d.code] = { famille: d.famille.trim(), groupe: (d.groupe || '').trim() };
      }
      if (d.famille && d.operation) {
        ops.push({ code: d.code, groupe: (d.groupe || '').trim(), famille: d.famille.trim(), operation: d.operation.trim(), ordre: d.ordre || 0 });
      }
    });
    _refTachesCache = { map, ops };
    _refTachesCacheAt = now;
    return _refTachesCache;
  } catch (e) {
    // Fallback hardcodé si Firestore indisponible
    return { map: {
      GB01: { famille: 'Travaux du sol', groupe: 'M.O Hors récolte' },
      GB02: { famille: 'Ferti-irrigation', groupe: 'M.O Hors récolte' },
      GB03: { famille: 'Plantation', groupe: 'M.O Hors récolte' },
      GB04: { famille: 'Mise en valeur', groupe: 'M.O Hors récolte' },
      GB05: { famille: 'Entretien structure', groupe: 'M.O Hors récolte' },
      GB06: { famille: 'Traitement phyto', groupe: 'M.O Hors récolte' },
      GB07: { famille: 'Tuteurage & palissage', groupe: 'M.O Hors récolte' },
      GB08: { famille: 'Récolte', groupe: 'M.O Récolte' },
      GB09: { famille: 'Taille', groupe: 'M.O Hors récolte' },
      GB10: { famille: 'Arrachage', groupe: 'M.O Hors récolte' },
      GB11: { famille: 'Services généraux', groupe: 'M.O Service générale' },
    }, ops: [] };
  }
}

// _refMap : populé par warmRefTaches() — utilisé de manière synchrone dans resolveFamily
let _refMap = {};

async function warmRefTaches() {
  const ref = await loadReferentielTaches();
  _refMap = ref.map;
}

function resolveFamily(operation_groupe, operation_famille) {
  if (operation_groupe) {
    const key = operation_groupe.trim();
    if (_refMap[key]) return _refMap[key].famille;
    if (REFERENTIEL_FAMILLES[key]) return REFERENTIEL_FAMILLES[key]; // fallback const
  }
  return (operation_famille || 'Autre').replace(/^\d+\.\s*/, '').trim();
}

function classifyType(operationFamille) {
  if (!operationFamille) return "horsRecolte";
  if (operationFamille === "8. Récolte") return "recolte";
  if (operationFamille === "11. Postes fixes") return "postesFixes";
  return "horsRecolte";
}

/**
 * Agrège des rows de pointage par culture (Framboise / Myrtille / Avocat).
 * Utilise resolveVariete pour classifier chaque parcelle.
 * Propriété garantie : Σ(parCulture[i].cout) === Σ(rows[j].Cout) (pas de perte).
 * @param {Array} rows — lignes BEE ONE (Parcelle_Culturale, Ref_parcelle, Nombre_Jr, Cout, Operation_Famille)
 * @returns {Array<{culture, journees, cout, recolte, horsRecolte, postesFixes}>}
 */
function buildParCulture(rows) {
  if (!rows || !rows.length) return [];
  const qCultures = {};
  for (const r of rows) {
    const _rc = resolveVariete(r.Parcelle_Culturale, r.Ref_parcelle);
    const _ferme = _rc.ferme;
    const _culture = (_rc.culture && _rc.culture !== 'Autre') ? _rc.culture
      : (_ferme === 'Avocatier' || _ferme === 'BAHIA') ? 'Avocat' : 'Framboise';
    if (!qCultures[_culture]) qCultures[_culture] = { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 };
    const _type = classifyType(r.Operation_Famille);
    qCultures[_culture].journees += r.Nombre_Jr || 0;
    qCultures[_culture].cout += r.Cout || 0;
    qCultures[_culture][_type] += r.Nombre_Jr || 0;
  }
  return Object.entries(qCultures).map(function(e) {
    const culture = e[0], d = e[1];
    return { culture: culture, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) };
  });
}

// =============================================
// Heures supplémentaires
// =============================================

/**
 * Lit la liste des fonctions exclues (gardiens, etc.) depuis app_settings.
 * @returns {Promise<Array<string>>}
 */
async function getExcludedFonctionsHS() {
  try {
    const doc = await db_firestore.collection("app_settings").doc("heures_sup").get();
    if (!doc.exists) return [];
    const data = doc.data() || {};
    return Array.isArray(data.excludedFonctions) ? data.excludedFonctions : [];
  } catch (e) {
    console.error("getExcludedFonctionsHS error:", e.message);
    return [];
  }
}

/**
 * Construit les lignes heures supplémentaires pour les quinzaines récentes
 * (courante + précédente). Jointure prod_presence (entrée/sortie) ⨯
 * sql_mirror_pointage (fonction pointée) par matricule + jour.
 * Exclut récolte (payée au rendement) et fonctions configurées (gardiens).
 * Un ouvrier présent mais absent du mirror est conservé avec `fonctionMissing`.
 *
 * @param {Object|null} meta - sql_mirror_pointage_meta/config
 * @param {Array<string>} excludedFonctions
 * @param {string|null} [fermeFilter] - GATING PAIE : ferme du chef, ou null
 *        (RH/DG/Finance = toutes fermes, inchangé). Fourni → cloisonnement chef.
 * @returns {Promise<Object>} { success, periodes, excludedFonctions, seuilMinutes, periodeDates, rows }
 */
async function buildHeuresSup(meta, excludedFonctions, fermeFilter = null) {
  const periodes = (meta && meta.periodes) || [];
  const periodeMap = (meta && meta.periodeMap) || {};
  const targetPeriodes = periodes.slice(0, 2);

  // Jours cibles + map jour→periode + map periode→jours (colonnes complètes,
  // même les jours sans sync, pour rendre les trous visibles côté UI).
  const periodeDates = {};
  const dayToPeriode = {};
  const allDays = [];
  for (const p of targetPeriodes) {
    const days = (periodeMap[p] || []).slice().sort();
    periodeDates[p] = days;
    for (const d of days) {
      if (!(d in dayToPeriode)) { dayToPeriode[d] = p; allDays.push(d); }
    }
  }

  // 1. Présence entrée/sortie par jour → Map(MATUPPER → {matricule,nom,heureEntree,heureSortie,caporal})
  const presenceByDay = {};
  for (let i = 0; i < allDays.length; i += 10) {
    const batch = allDays.slice(i, i + 10);
    const snaps = await Promise.all(batch.map(d => db_firestore.collection("prod_presence").doc(d).get()));
    snaps.forEach((snap, idx) => {
      const d = batch[idx];
      const map = new Map();
      if (snap.exists) {
        const rows = (snap.data().rows) || [];
        for (const r of rows) {
          const mat = String(r.matricule || "").trim();
          if (!mat) continue;
          map.set(mat.toUpperCase(), {
            matricule: mat,
            nom: (r.nom || "").trim(),
            heureEntree: r.heureEntree || null,
            heureSortie: r.heureSortie || null,
            caporal: r.caporal || 0,
          });
        }
      }
      presenceByDay[d] = map;
    });
  }

  // 2. Fonction pointée par jour (mirror) → Map(MATUPPER → fonction représentative)
  //    Représentant = couple (famille|opération) le plus fréquent ce jour-là.
  // GATING PAIE : quand fermeFilter est fourni (chef), on filtre les lignes brutes
  // du mirror sur SA ferme AVANT agrégation. On construit aussi le set des matricules
  // AUTORISÉS (ceux ayant pointé la ferme du chef) — utilisé pour cloisonner
  // prod_presence, qui ne porte pas de parcelle exploitable pour dériver la ferme.
  const fonctionByDay = {};
  const allowedMatricules = fermeFilter ? new Set() : null;
  for (let i = 0; i < allDays.length; i += 10) {
    const batch = allDays.slice(i, i + 10);
    const results = await Promise.all(batch.map(d => getPointageRowsForDate(d)));
    results.forEach((rowsRaw, idx) => {
      const d = batch[idx];
      const rows = filterMirrorRowsByFerme(rowsRaw, fermeFilter);
      if (allowedMatricules) {
        for (const r of rows) {
          const m = String(r.Personnel_Matricule || "").trim().toUpperCase();
          if (m) allowedMatricules.add(m);
        }
      }
      const acc = new Map();
      for (const r of rows) {
        const mat = String(r.Personnel_Matricule || "").trim().toUpperCase();
        if (!mat) continue;
        const fam = (r.Operation_Famille || "").trim();
        const op = (r.Operation || "").trim();
        const key = `${fam}|${op}`;
        let e = acc.get(mat);
        if (!e) { e = { counts: {}, infos: {}, nom: (r.Personnel_Nom || "").trim() }; acc.set(mat, e); }
        e.counts[key] = (e.counts[key] || 0) + 1;
        if (!e.infos[key]) e.infos[key] = { operationFamille: fam, operation: op, ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) };
        if (!e.nom && r.Personnel_Nom) e.nom = (r.Personnel_Nom || "").trim();
      }
      const map = new Map();
      for (const [mat, e] of acc) {
        const bestKey = Object.entries(e.counts).sort((a, b) => b[1] - a[1])[0][0];
        const info = e.infos[bestKey];
        map.set(mat, { operationFamille: info.operationFamille, operation: info.operation, ferme: info.ferme, nom: e.nom });
      }
      fonctionByDay[d] = map;
    });
  }

  // 3. Jointure + calcul durée/dépassement + exclusions
  const rows = [];
  for (const d of allDays) {
    const presence = presenceByDay[d] || new Map();
    const fonctions = fonctionByDay[d] || new Map();
    for (const [matUpper, p] of presence) {
      // GATING PAIE (chef) : prod_presence n'a pas de parcelle → on restreint aux
      // matricules ayant pointé la ferme du chef (set dérivé du mirror ci-dessus).
      // Fail-closed : un ouvrier présent mais jamais pointé sur cette ferme est exclu.
      if (allowedMatricules && !allowedMatricules.has(matUpper)) continue;
      const f = fonctions.get(matUpper) || null;
      const fonctionMissing = !f;
      // Récolte + fonctions configurées exclues. Fonction inconnue → conservée + flag.
      if (f && shouldExcludeWorkerDay(f, excludedFonctions)) continue;
      const { durationMin, overtimeMin, clockedIn } = computeDurationOvertime(p.heureEntree, p.heureSortie);
      rows.push({
        matricule: p.matricule,
        nom: p.nom || (f && f.nom) || "",
        jour: d,
        periode: dayToPeriode[d] || null,
        ferme: (f && f.ferme) || "Autre",
        operationFamille: f ? f.operationFamille : null,
        operation: f ? f.operation : null,
        fonctionMissing,
        caporal: p.caporal || 0,
        heureEntree: p.heureEntree || null,
        heureSortie: p.heureSortie || null,
        durationMin,
        overtimeMin,
        clockedIn,
      });
    }
  }

  const periodeCampagne = (meta && meta.periodeCampagne) || {};
  return { success: true, periodes, periodeCampagne, excludedFonctions, seuilMinutes: HS_SEUIL_MINUTES, periodeDates, rows };
}

// =============================================
// Firestore mirror helpers — same output shape as SQL helpers
// =============================================

function mapMirrorRowToDetail(r) {
  return {
    matricule: (r.Personnel_Matricule || "").trim(),
    nom: (r.Personnel_Nom || "").trim(),
    operationFamille: r.Operation_Famille,
    operation: r.Operation,
    groupe: r.Operation_Groupe,
    jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
    parcelle: (r.Parcelle_Culturale || "").trim(),
    refParcelle: (r.Ref_parcelle || "").trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    variete: r.Variete, culture: r.Culture,
    hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
  };
}

async function fetchDetailFromMirror(dateParam, fermeFilter = null) {
  const dateStr = dateParam || new Date().toISOString().slice(0, 10);
  const rowsRaw = await getPointageRowsForDate(dateStr);
  // GATING PAIE : chef → filtre ferme sur lignes brutes AVANT mapping (fail-closed
  // sur 'Autre'). null → toutes fermes (RH/DG/Finance), inchangé.
  const rows = filterMirrorRowsByFerme(rowsRaw, fermeFilter);
  return rows.map(mapMirrorRowToDetail);
}

async function fetchSummaryFromMirror(dateParam) {
  const dateStr = dateParam || new Date().toISOString().slice(0, 10);
  const rows = await getPointageRowsForDate(dateStr);
  // Effectifs = OUVRIERS DISTINCTS par (ferme, type). On itère les lignes brutes
  // (1 ligne / ouvrier / parcelle / op) et on déduplique les matricules par ferme,type.
  const lines = rows.map(r => ({
    matricule: r.Personnel_Matricule,
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    cout: r.Cout || 0,
  }));
  return countDistinctByFermeType(lines, POINTAGE_FERMES);
}

async function fetchPostesFixesFromMirror(dateParam, fermeFilter = null) {
  const dateStr = dateParam || new Date().toISOString().slice(0, 10);
  const rowsRaw = await getPointageRowsForDate(dateStr);
  // GATING PAIE : chef → filtre ferme sur lignes brutes AVANT agrégation (fail-closed).
  const rows = filterMirrorRowsByFerme(rowsRaw, fermeFilter);
  return rows
    .filter(r => r.Operation_Famille === "11. Postes fixes")
    .map(r => ({
      matricule: (r.Personnel_Matricule || '').trim(),
      nom: (r.Personnel_Nom || '').trim(),
      operation: r.Operation,
      parcelle: (r.Parcelle_Culturale || '').trim(),
      ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
      jours: r.Nombre_Jr,
      heures: r.Nombre_Hr,
      cout: Math.round(r.Cout || 0),
    }));
}

// =============================================
// Internal helpers for snapshot creation
// =============================================

// Fetch detail rows from SQL for a given date, filtered by ferme
async function fetchDetailFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  const result = await db.request().query(`
    SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
      Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture,
      HS_25, HS_50, HS_100, HS_NM
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL}
    ORDER BY Ref_parcelle, Operation_Famille, Personnel_Nom
  `);
  return result.recordset.map(r => ({
    matricule: (r.Personnel_Matricule || "").trim(),
    nom: (r.Personnel_Nom || "").trim(),
    operationFamille: r.Operation_Famille,
    operation: r.Operation,
    groupe: r.Operation_Groupe,
    jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
    parcelle: (r.Parcelle_Culturale || "").trim(),
    refParcelle: (r.Ref_parcelle || "").trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    variete: r.Variete, culture: r.Culture,
    hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
  }));
}

// Fetch summary data from SQL for a given date
async function fetchSummaryFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  // Effectifs = OUVRIERS DISTINCTS par (ferme, type). On récupère le matricule au grain
  // (parcelle, op) puis on déduplique côté JS par (ferme, type) — un ouvrier multi-parcelles
  // ne doit être compté qu'une fois. On agrège le coût au même grain (somme inchangée).
  const todayRes = await db.request().query(`
    SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule,
      SUM(Cout) AS totalCout
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL}
    GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule
  `);
  const lines = todayRes.recordset.map(r => ({
    matricule: r.Personnel_Matricule,
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    cout: r.totalCout || 0,
  }));
  return countDistinctByFermeType(lines, POINTAGE_FERMES);
}

// Fetch postes fixes from SQL for a given date
async function fetchPostesFixesFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  const result = await db.request().query(`
    SELECT Personnel_Matricule, Personnel_Nom, Operation, Ref_parcelle, Parcelle_Culturale,
      Nombre_Jr, Nombre_Hr, Cout
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'11. Postes fixes'
    ORDER BY Ref_parcelle, Operation, Personnel_Nom
  `);
  return result.recordset.map(r => ({
    matricule: (r.Personnel_Matricule || '').trim(),
    nom: (r.Personnel_Nom || '').trim(),
    operation: r.Operation,
    parcelle: (r.Parcelle_Culturale || '').trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    jours: r.Nombre_Jr,
    heures: r.Nombre_Hr,
    cout: Math.round(r.Cout || 0),
  }));
}

// Create a snapshot for a specific date+ferme
async function createSnapshot(dateParam, ferme, profileId) {
  const allDetail = USE_MIRROR ? await fetchDetailFromMirror(dateParam) : await fetchDetailFromSQL(dateParam);
  const fermeDetail = allDetail.filter(r => r.ferme === ferme);
  const allPostes = USE_MIRROR ? await fetchPostesFixesFromMirror(dateParam) : await fetchPostesFixesFromSQL(dateParam);
  const fermePostes = allPostes.filter(r => r.ferme === ferme);
  const summaryData = USE_MIRROR ? await fetchSummaryFromMirror(dateParam) : await fetchSummaryFromSQL(dateParam);
  const fermeSummary = summaryData[ferme] || { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 };

  const docId = `${dateParam}_${ferme}`;
  const snapRef = db_firestore.collection("pointage_snapshots").doc(docId);
  const existing = await snapRef.get();
  const version = existing.exists ? (existing.data().version || 1) + 1 : 1;

  const snapshotData = {
    date: dateParam,
    ferme,
    createdAt: Date.now(),
    createdBy: profileId || "rh",
    version,
    summary: fermeSummary,
    detailRows: fermeDetail,
    postesFixes: fermePostes,
    workerCount: new Set(fermeDetail.map(r => r.matricule)).size,
  };

  await snapRef.set(snapshotData);
  return snapshotData;
}

// Get submitted fermes for a date (those with visaRH or rejected status — i.e. have snapshots)
async function getSubmittedFermes(dateParam) {
  if (!dateParam) return {};
  const snaps = await db_firestore.collection("pointage_validations")
    .where("date", "==", dateParam).get();
  const result = {};
  snaps.forEach(doc => {
    const d = doc.data();
    if (d.visaRH || d.rejected) {
      result[d.ferme] = { snapshotId: doc.id, rejected: !!d.rejected };
    }
  });
  return result;
}

// Get snapshot data for a ferme
async function getSnapshotData(dateParam, ferme) {
  const docId = `${dateParam}_${ferme}`;
  const snap = await db_firestore.collection("pointage_snapshots").doc(docId).get();
  if (!snap.exists) return null;
  return snap.data();
}

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
exports.shouldCacheRecolteEquipes = shouldCacheRecolteEquipes;
exports.computeRecolteEquipesPayload = computeRecolteEquipesPayload;

// =============================================
// Cache Warmer — pre-populates api_cache for pointage endpoints
// Reads from Firestore mirror only (GCP→GCP, zero farm network impact)
// =============================================
// Recolte-equipes — shared compute + cache guard
// =============================================
// shouldCacheRecolteEquipes : refuse le cache si la majorité des dates n'ont aucun kg>0.
// some() était trop laxiste : 5 dates anciennes OK + 25 dates récentes à kg=0 passait → cache servi 5 min avec chart vide.
// Heuristique : >= 70% des dates doivent avoir au moins une ligne kg>0.
function shouldCacheRecolteEquipes(r) {
  if (!r || !r.success || !Array.isArray(r.rows) || r.rows.length === 0) return true;
  const byDate = {};
  r.rows.forEach(row => {
    const d = row.jour;
    if (!byDate[d]) byDate[d] = { total: 0, withKg: 0 };
    byDate[d].total++;
    if ((row.kg || 0) > 0) byDate[d].withKg++;
  });
  const dates = Object.keys(byDate);
  if (dates.length === 0) return true;
  const goodDates = dates.filter(d => byDate[d].withKg > 0).length;
  return (goodDates / dates.length) >= 0.7;
}

// computeRecolteEquipesPayload : calcul COMPLET du payload recolte-equipes.
// Lignes brutes du mirror (8. Récolte) → groupement matricule/jour → variété dominante
// → ENRICHISSEMENT kg depuis prod_tracabilite_recolte (getAll chunké, 3 retries) → ajout
// des ouvriers prod manquants. Le kg de récolte vient UNIQUEMENT de l'enrichissement prod
// (quantiteToKg=0 sur l'opération « Récolte »). Source de vérité unique partagée entre le
// serving path et le warm path → plus de divergence (warm cachait un payload kg=0).
// nQuinz : nombre de quinzaines chargées depuis meta.periodes (slice(0, nQuinz)). 3 partout.
// fermeFilter : GATING PAIE — chef → agrégat cloisonné sur SA ferme ; null → toutes fermes
// (RH/DG/Finance, inchangé). Filtre appliqué sur les lignes brutes du mirror AVANT
// agrégation, ET sur les ouvriers prod ajoutés (fail-closed sur 'Autre').
async function computeRecolteEquipesPayload(nQuinz, fermeFilter = null) {
  if (USE_MIRROR) {
    const meta = await getPointageMeta();
    const periodes = meta?.periodes || [];
    // Charger nQuinz quinzaines (~45 jours pour 3) : couvre la fenêtre 30j par défaut du chart
    // Coût Récolte avec buffer. ⚠️ Borné depuis que meta.periodes liste TOUTES les quinzaines
    // du mirror (fix quinzaines 21/22) : slice(0,6) chargeait ~6 quinzaines (~12k lignes)
    // → recolte-equipes lent (~10s) et Coût Récolte dégradé.
    const targetPeriodes = periodes.slice(0, nQuinz);
    const allRows = [];
    for (const p of targetPeriodes) {
      const pRows = await getPointageRowsForPeriode(p);
      // GATING PAIE : chef → filtre ferme sur lignes brutes AVANT agrégation.
      allRows.push(...filterMirrorRowsByFerme(pRows, fermeFilter));
    }
    const recolteRows = allRows.filter(r => r.Operation_Famille === "8. Récolte");
    const rawRows = recolteRows.map(r => ({
      matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
      jour: r.DateStr, periode: r.Periode_paie,
      kg: quantiteToKg(r.Quantite_unite, r.Operation),
      heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0),
      ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
      variete: resolveMyrtilleVariete((r.Variete || "").trim(), r.Parcelle_Culturale),
      culture: (r.Culture || "").trim(),
      parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim(),
    }));
    // Agréger par ouvrier+jour (un ouvrier peut avoir plusieurs variétés/parcelles le même jour)
    const grouped = {};
    for (const r of rawRows) {
      const key = `${r.matricule}|${r.jour}`;
      if (!grouped[key]) {
        grouped[key] = { ...r, kgByVariete: { [r.variete]: r.kg } };
      } else {
        grouped[key].kg += r.kg;
        grouped[key].heures += r.heures;
        grouped[key].cout += r.cout;
        const v = r.variete || 'Autre';
        grouped[key].kgByVariete[v] = (grouped[key].kgByVariete[v] || 0) + r.kg;
      }
    }
    // Déterminer variété dominante pour chaque jour
    let rows = Object.values(grouped).map(r => {
      const bestVariete = Object.entries(r.kgByVariete)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || r.variete;
      delete r.kgByVariete;
      return { ...r, variete: bestVariete, kg: Math.round(r.kg * 10) / 10 };
    });

    // Enrich with production data (Tracabilite_recolte) — more accurate kg.
    // Le kg de récolte vient UNIQUEMENT d'ici (quantiteToKg=0 sur l'opération « Récolte »).
    // ⚠️ Historique : on lisait les ~60-90 docs prod SÉQUENTIELLEMENT (un get() par date). Un échec
    // transitoire Firestore faisait sauter l'enrichissement → kg=0 sur TOUTES les dates → payload
    // dégradée servie au DG. Parade : getAll() chunké en lots de 10 (+ 3 retries/lot).
    const prodDates = [...new Set(rows.map(r => r.jour))].sort();
    let enrichedCount = 0, addedCount = 0;
    const perDateStats = [];
    const prodByDate = {};
    let getAllFailedChunks = 0;
    if (prodDates.length > 0) {
      const CHUNK = 10;
      for (let i = 0; i < prodDates.length; i += CHUNK) {
        const chunkRefs = prodDates.slice(i, i + CHUNK)
          .map(d => db_firestore.collection("prod_tracabilite_recolte").doc(d));
        let docs = null;
        for (let attempt = 0; attempt < 3 && docs === null; attempt++) {
          try {
            docs = await db_firestore.getAll(...chunkRefs);
          } catch (chunkErr) {
            if (attempt === 2) {
              getAllFailedChunks++;
              console.error(`[recolte-equipes] getAll lot ${i / CHUNK} échoué 3x (${chunkErr.message})`);
              docs = [];
            }
          }
        }
        docs.forEach(doc => { if (doc && doc.exists) prodByDate[doc.id] = doc.data(); });
      }
      if (getAllFailedChunks > 0) console.warn(`[recolte-equipes] ${getAllFailedChunks} lot(s) getAll en échec → enrichissement partiel`);
    }
    for (const date of prodDates) {
      try {
        const prodData = prodByDate[date];
        if (!prodData) { perDateStats.push(`${date}:noDoc`); continue; }
        const prodRows = prodData.rows || [];
        if (prodRows.length === 0) { perDateStats.push(`${date}:emptyRows`); continue; }
        const prodMap = {};
        prodRows.forEach(r => { prodMap[(r.matricule || "").toUpperCase()] = r; });
        // Override kg for existing worker-days
        let perDateEnriched = 0;
        rows.forEach(r => {
          if (r.jour !== date) return;
          const prod = prodMap[(r.matricule || "").toUpperCase()];
          if (prod) {
            r.kg = prod.totalKg;
            r.variete = prod.variete || r.variete;
            enrichedCount++;
            perDateEnriched++;
          }
        });
        // Add workers in prod but missing from pointage for this date
        const existingMats = new Set(rows.filter(r => r.jour === date).map(r => (r.matricule || "").toUpperCase()));
        const periode = rows.find(r => r.jour === date)?.periode || (targetPeriodes && targetPeriodes[0]) || "";
        let perDateAdded = 0;
        prodRows.forEach(pr => {
          if (!existingMats.has((pr.matricule || "").toUpperCase()) && pr.totalKg > 0) {
            // GATING PAIE : ouvrier prod ajouté → n'entre QUE s'il appartient à la
            // ferme du chef (fail-closed : ferme dérivée 'Autre'/autre ferme exclue).
            const prFerme = deriveFerme(pr.refParcelle, "");
            if (fermeFilter && prFerme !== fermeFilter) return;
            rows.push({
              matricule: pr.matricule, nom: pr.nom, jour: date, periode,
              kg: pr.totalKg, heures: 0, cout: 0,
              ferme: prFerme, variete: pr.variete || "",
              culture: "", parcelle: pr.refParcelle || "", operation: "Récolte (prod)",
            });
            addedCount++;
            perDateAdded++;
          }
        });
        perDateStats.push(`${date}:e${perDateEnriched}/a${perDateAdded}/prodRows${prodRows.length}`);
      } catch (dateErr) {
        perDateStats.push(`${date}:ERR(${dateErr.message})`);
        console.warn(`[recolte-equipes] enrichment failed for ${date}:`, dateErr.message);
      }
    }
    console.log(`[recolte-equipes] Prod enrichment: ${enrichedCount} overridden, ${addedCount} added, ${prodDates.length} dates checked. Per-date: ${perDateStats.join(' | ')}`);

    const periodeCampagne = (meta && meta.periodeCampagne) || {};
    return { success: true, periodes, periodeCampagne, rows };
  }
  // SQL fallback
  const db = await getPool();
  const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
  const periodes = periodesRes.recordset.map(r => r.Periode_paie);
  const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, Quantite_unite, Nombre_Hr, Cout, Ref_parcelle, Parcelle_Culturale, Variete, Culture, Operation FROM BR_Pointage WHERE Operation_Famille = N'8. Récolte' ORDER BY jour DESC`);
  const sqlRawRowsAll = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, kg: quantiteToKg(r.Quantite_unite, r.Operation), heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: resolveMyrtilleVariete((r.Variete || "").trim(), r.Parcelle_Culturale), culture: (r.Culture || "").trim(), parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim() }));
  // GATING PAIE : chef → cloisonnement sur la ferme dérivée (fail-closed).
  const sqlRawRows = filterByFermeField(sqlRawRowsAll, fermeFilter);
  // Agréger par ouvrier+jour
  const sqlGrouped = {};
  for (const r of sqlRawRows) {
    const key = `${r.matricule}|${r.jour}`;
    if (!sqlGrouped[key]) {
      sqlGrouped[key] = { ...r, kgByVariete: { [r.variete]: r.kg } };
    } else {
      sqlGrouped[key].kg += r.kg;
      sqlGrouped[key].heures += r.heures;
      sqlGrouped[key].cout += r.cout;
      const v = r.variete || 'Autre';
      sqlGrouped[key].kgByVariete[v] = (sqlGrouped[key].kgByVariete[v] || 0) + r.kg;
    }
  }
  const rows = Object.values(sqlGrouped).map(r => {
    const bestVariete = Object.entries(r.kgByVariete)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || r.variete;
    delete r.kgByVariete;
    return { ...r, variete: bestVariete, kg: Math.round(r.kg * 10) / 10 };
  });
  return { success: true, periodes, rows };
}

// =============================================
async function warmAllPointageCaches() {
  if (!USE_MIRROR) {
    console.log("[cacheWarmer] Skipping — USE_MIRROR is false");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const meta = await getPointageMeta();
  const periodes = meta?.periodes || [];
  const results = [];

  // 1. Summary
  try {
    await withCache(pointageCacheKey(`pointage_summary_${today}`, null), 0, async () => {
      const submittedFermes = await getSubmittedFermes(today);
      const yesterdayStr = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
      const weekStartStr = new Date(new Date(today).getTime() - 6 * 86400000).toISOString().slice(0, 10);
      const [todayRows, yesterdayRows, weekRows] = await Promise.all([
        getPointageRowsForDate(today),
        getPointageRowsForDate(yesterdayStr),
        getPointageRowsForDateRange(weekStartStr, today),
      ]);
      // Effectifs = OUVRIERS DISTINCTS par (ferme, type), dédupliqués sur les lignes brutes.
      const fermes = countDistinctByFermeType(todayRows.map(r => ({
        matricule: r.Personnel_Matricule,
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        type: classifyType(r.Operation_Famille),
        cout: r.Cout || 0,
      })), POINTAGE_FERMES);
      // Veille = même méthode distincte (sinon variation faussée : distinct vs gonflé).
      const veilleEffectif = countDistinctByFermeType(yesterdayRows.map(r => ({
        matricule: r.Personnel_Matricule,
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        type: classifyType(r.Operation_Famille),
        cout: r.Cout || 0,
      })), POINTAGE_FERMES);
      const fermesYesterday = { F1: { total: veilleEffectif.F1.total }, F5: { total: veilleEffectif.F5.total }, Avocatier: { total: veilleEffectif.Avocatier.total }, BAHIA: { total: veilleEffectif.BAHIA.total } };
      for (const f of Object.keys(submittedFermes)) {
        const snapData = await getSnapshotData(today, f);
        if (snapData && snapData.summary && fermes[f]) fermes[f] = snapData.summary;
      }
      const pointageJour = Object.keys(fermes).map(f => {
        const e = fermes[f];
        // total = ouvriers DISTINCTS de la ferme tous types (Set ferme global) ; fallback
        // sur la somme pour les snapshots sans champ `total` (ancien format).
        const total = (typeof e.total === 'number') ? e.total : (e.recolte + e.horsRecolte + e.postesFixes);
        const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
        return { ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes, cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0 };
      });
      const trendMap = {};
      for (const r of weekRows) {
        const key = r.DateStr;
        if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
        const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
        if (trendMap[key][ferme]) trendMap[key][ferme].add(r.Personnel_Matricule);
      }
      const weeklyTrend = Object.values(trendMap).map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size, BAHIA: t.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
      const recolteRows = todayRows.filter(r => r.Operation_Famille === "8. Récolte");
      const recolteWorkers = new Set(recolteRows.map(r => r.Personnel_Matricule));
      const recolteQty = recolteRows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
      const recolteCout = recolteRows.reduce((s, r) => s + (r.Cout || 0), 0);
      const syncStatus = await getSyncStatus();
      return { success: true, date: today, effectif: fermes, pointageJour, weeklyTrend, topOps: [], recolteTotal: { qty: recolteQty, nbOuv: recolteWorkers.size, cout: Math.round(recolteCout) }, lastSaisie: syncStatus?.lastSuccessAt || null, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null };
    });
    results.push("summary:ok");
  } catch (e) { results.push(`summary:${e.message}`); }

  // 2. Detail
  try {
    await withCache(`pointage_detail_${today}_all`, 0, async () => {
      const rows = await fetchDetailFromMirror(today);
      return { success: true, date: today, rows, count: rows.length };
    });
    results.push("detail:ok");
  } catch (e) { results.push(`detail:${e.message}`); }

  // 3. Recolte
  try {
    await withCache(pointageCacheKey(`pointage_recolte_${today}`, null), 0, async () => {
      const [pointageRows, cueilletteRows] = await Promise.all([
        getPointageRowsForDate(today),
        getCueilletteRows(today, today),
      ]);
      const cGroups = {};
      for (const r of cueilletteRows.filter(r => r.Operation_Famille === "8. Récolte")) {
        const key = `${r.Parcelle_Culturale}|${r.Variete}`;
        if (!cGroups[key]) cGroups[key] = { parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, refTech: (r.Reference_Technique || "").trim(), totalKg: 0, totalCaisses: 0 };
        cGroups[key].totalKg += r.Poids_total_kg || 0;
        cGroups[key].totalCaisses += r.Nbre_Caisse || 0;
      }
      const cueillette = Object.values(cGroups).map(c => ({ ...c, ferme: deriveFerme(c.refTech || null, c.parcelle) })).sort((a, b) => b.totalKg - a.totalKg);
      const workers = pointageRows.filter(r => r.Operation_Famille === "8. Récolte").map((r, i) => ({
        rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
        operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation),
        heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(),
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete,
      })).sort((a, b) => b.quantite - a.quantite || a.nom.localeCompare(b.nom));
      workers.forEach((w, i) => { w.rank = i + 1; });
      const totalKgCueillette = cueillette.reduce((s, c) => s + c.totalKg, 0);
      return { success: true, date: today, workers, cueillette, totalKgCueillette, count: workers.length };
    });
    results.push("recolte:ok");
  } catch (e) { results.push(`recolte:${e.message}`); }

  // 4. Quinzaine (latest)
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, periodes, totalJournees: 0, totalCout: 0, parFerme: [], parJour: [] };
      const rows = await getPointageRowsForPeriode(selectedPeriode);
      const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, BAHIA: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
      for (const r of rows) { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); const type = classifyType(r.Operation_Famille); if (qFermes[ferme]) { qFermes[ferme].journees += r.Nombre_Jr || 0; qFermes[ferme].cout += r.Cout || 0; qFermes[ferme][type] += r.Nombre_Jr || 0; } }
      const dayMap = {};
      for (const r of rows) {
        const key = r.DateStr;
        if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: new Set(), journees: 0, cout: 0, F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
        dayMap[key].nbOuv.add(r.Personnel_Matricule); dayMap[key].journees += r.Nombre_Jr || 0; dayMap[key].cout += r.Cout || 0;
        const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
        if (dayMap[key][ferme]) dayMap[key][ferme].add(r.Personnel_Matricule);
      }
      const perDay = Object.values(dayMap).map(d => ({ jour: d.jour, jourLabel: d.jourLabel, nbOuv: d.nbOuv.size, journees: d.journees, cout: d.cout, F1: d.F1.size, F5: d.F5.size, Avocatier: d.Avocatier.size, BAHIA: d.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
      const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
      const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
      return { success: true, periode: selectedPeriode, periodes, totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay };
    });
    results.push("quinzaine:ok");
  } catch (e) { results.push(`quinzaine:${e.message}`); }

  // 4b. Quinzaine-analytique (latest)
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_analytique_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, periodes, rows: [] };
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const groups = {};
      for (const r of rawRows) {
        const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}|${r.Operation}`;
        if (!groups[key]) groups[key] = { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Operation_Famille: r.Operation_Famille, Operation_Groupe: r.Operation_Groupe, Operation: r.Operation, workers: new Set(), JH: 0, Cout: 0 };
        groups[key].workers.add(r.Personnel_Matricule);
        groups[key].JH += r.Nombre_Jr || 0;
        groups[key].Cout += r.Cout || 0;
      }
      const rows = Object.values(groups).map(g => ({ parcelle: (g.Parcelle_Culturale || '').trim(), refParcelle: (g.Ref_parcelle || '').trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale), operationFamille: g.Operation_Famille, operationGroupe: g.Operation_Groupe || '', operation: g.Operation, nbOuv: g.workers.size, jh: Math.round(g.JH * 100) / 100, cout: Math.round(g.Cout) }));
      return { success: true, periode: selectedPeriode, periodes, rows };
    });
    results.push("quinzaine-analytique:ok");
  } catch (e) { results.push(`quinzaine-analytique:${e.message}`); }

  // 4c. Quinzaine-repos (latest)
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_repos_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
      const quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const nbJoursQuinzaine = quinzaineDates.length;
      const equipeMap = {};
      for (const row of rawRows) {
        const mat = (row.Personnel_Matricule || '').trim();
        const prefix = mat.substring(0, 2).toUpperCase();
        const jour = row.DateStr || new Date(row.jour).toISOString().slice(0, 10);
        if (!equipeMap[prefix]) equipeMap[prefix] = {};
        if (!equipeMap[prefix][mat]) equipeMap[prefix][mat] = { matricule: mat, nom: (row.Personnel_Nom || '').trim(), joursPresent: new Set() };
        equipeMap[prefix][mat].joursPresent.add(jour);
      }
      const equipes = Object.entries(equipeMap).map(([prefix, workers]) => {
        const workerList = Object.values(workers).map(w => { const nbPresent = w.joursPresent.size; const nbRepos = nbJoursQuinzaine - nbPresent; return { matricule: w.matricule, nom: w.nom, nbPresent, nbRepos, nbJoursQuinzaine }; });
        const totalRepos = workerList.reduce((s, w) => s + w.nbRepos, 0);
        const moyRepos = workerList.length > 0 ? Math.round((totalRepos / workerList.length) * 10) / 10 : 0;
        return { prefix, nbOuvriers: workerList.length, moyRepos, nbJoursQuinzaine, workers: workerList.sort((a, b) => b.nbRepos - a.nbRepos) };
      }).sort((a, b) => a.prefix.localeCompare(b.prefix));
      return { success: true, periode: selectedPeriode, periodes, nbJoursQuinzaine, quinzaineDates, equipes };
    });
    results.push("quinzaine-repos:ok");
  } catch (e) { results.push(`quinzaine-repos:${e.message}`); }

  // 4d. Quinzaine-alertes (latest)
  try {
    await withCache(pointageCacheKey("pointage_quinzaine_alertes_latest", null), 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
      const quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const presenceMap = {};
      for (const r of rawRows) {
        const prefix = (r.Personnel_Matricule || '').trim().substring(0, 2).toUpperCase();
        if (!presenceMap[prefix]) presenceMap[prefix] = new Set();
        presenceMap[prefix].add(r.DateStr);
      }
      const alertes = [];
      Object.entries(presenceMap).forEach(([prefix, presentDays]) => {
        let streak = 0, streakStart = null;
        for (let i = 0; i < quinzaineDates.length; i++) {
          const d = quinzaineDates[i];
          if (!presentDays.has(d)) { if (streak === 0) streakStart = d; streak++; }
          else { if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[i - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[i - 1]})` }); streak = 0; streakStart = null; }
        }
        if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[quinzaineDates.length - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[quinzaineDates.length - 1]})` });
      });
      alertes.sort((a, b) => b.joursAbsents - a.joursAbsents);
      return { success: true, periode: selectedPeriode, periodes, quinzaineDates, alertes };
    });
    results.push("quinzaine-alertes:ok");
  } catch (e) { results.push(`quinzaine-alertes:${e.message}`); }

  // 5. Recolte-equipes
  // ⚠️ Anti-divergence (régression rCbmEuXS) : le warm DOIT enrichir kg depuis prod_tracabilite_recolte
  // ET appliquer shouldCacheRecolteEquipes, comme le serving. Auparavant le warm cachait un payload
  // brut (kg=0 car quantiteToKg=0 sur « Récolte ») sans garde-fou → graphe Coût Récolte vide servi 5 min.
  // TTL=0 force le recalcul ; shouldCacheRecolteEquipes empêche d'écrire un payload dégradé.
  try {
    await withCache("pointage_recolte_equipes_all", 0, () => computeRecolteEquipesPayload(3), shouldCacheRecolteEquipes);
    results.push("recolte-equipes:ok");
  } catch (e) { results.push(`recolte-equipes:${e.message}`); }

  // 6. Transport
  try {
    await withCache(pointageCacheKey("pointage_transport", null), 0, async () => {
      const targetPeriodes = periodes.slice(0, 2);
      const allRows = [];
      for (const p of targetPeriodes) { allRows.push(...await getPointageRowsForPeriode(p)); }
      const groups = {};
      for (const r of allRows) {
        const key = `${r.Personnel_Matricule}|${r.DateStr}|${r.Periode_paie}|${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}`;
        if (!groups[key]) {
          groups[key] = { Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: r.DateStr, Periode_paie: r.Periode_paie, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Nombre_Hr: 0, Cout: 0 };
        }
        groups[key].Nombre_Hr += r.Nombre_Hr || 0;
        groups[key].Cout += r.Cout || 0;
      }
      const rows = Object.values(groups).map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: r.DateStr, periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim(), heures: r.Nombre_Hr || 0, cout: Math.round(r.Cout || 0) }));
      const holidays = await getJoursFeries();
      const extras = computeChargCond(allRows, holidays);
      return { success: true, periodes, rows, ...extras };
    });
    results.push("transport:ok");
  } catch (e) { results.push(`transport:${e.message}`); }

  // 6b. Heures supplémentaires
  try {
    await withCache("pointage_heures_sup_all", 0, async () => {
      const excludedFonctions = await getExcludedFonctionsHS();
      return await buildHeuresSup(meta, excludedFonctions);
    });
    results.push("heures-sup:ok");
  } catch (e) { results.push(`heures-sup:${e.message}`); }

  // 7. Nouveaux ouvriers
  try {
    await withCache(pointageCacheKey("pointage_nouveaux_ouvriers", null), 0, async () => {
      const currentPeriode = periodes[0];
      if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
      const periodeDates = meta?.periodeMap?.[currentPeriode] || [];
      const qStart = periodeDates[0] || null;
      const qEnd = periodeDates[periodeDates.length - 1] || null;
      const targetPeriodes = periodes.slice(0, 2);
      const firstAppearance = {};
      for (const p of [...targetPeriodes].reverse()) {
        const pRows = await getPointageRowsForPeriode(p);
        for (const r of pRows) {
          const mat = (r.Personnel_Matricule || "").trim();
          if (!firstAppearance[mat]) firstAppearance[mat] = { date: r.DateStr, nom: (r.Personnel_Nom || "").trim(), Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille };
        }
      }
      const byFarm = {}; const byDayMap = {};
      const workers = Object.entries(firstAppearance)
        .filter(([_, info]) => qStart && info.date >= qStart)
        .map(([mat, info]) => {
          const ferme = deriveFerme(info.Ref_parcelle, info.Parcelle_Culturale);
          byFarm[ferme] = (byFarm[ferme] || 0) + 1;
          byDayMap[info.date] = (byDayMap[info.date] || 0) + 1;
          return { matricule: mat, nom: info.nom, firstDate: info.date, ferme, equipe: mat.substring(0, 2), operationFamille: info.Operation_Famille || "" };
        })
        .sort((a, b) => b.firstDate.localeCompare(a.firstDate) || a.nom.localeCompare(b.nom));
      const totalToday = workers.filter(w => w.firstDate === today).length;
      const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
      return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
    });
    results.push("nouveaux-ouvriers:ok");
  } catch (e) { results.push(`nouveaux-ouvriers:${e.message}`); }

  // 8. Hors-récolte
  try {
    await withCache(pointageCacheKey(`pointage_hors_recolte_${today}`, null), 0, async () => {
      const rawRows = await getPointageRowsForDate(today);
      const filtered = rawRows.filter(r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes");
      const groups = {};
      for (const r of filtered) {
        const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
        if (!groups[key]) groups[key] = { Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, workers: new Set(), totalHr: 0, totalJr: 0, totalCout: 0 };
        groups[key].workers.add(r.Personnel_Matricule);
        groups[key].totalHr += r.Nombre_Hr || 0;
        groups[key].totalJr += r.Nombre_Jr || 0;
        groups[key].totalCout += r.Cout || 0;
      }
      const ops = Object.values(groups).map(g => ({ operationFamille: g.Operation_Famille, operation: g.Operation, effectif: g.workers.size, heures: g.totalHr, journees: g.totalJr, cout: Math.round(g.totalCout), parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif);
      return { success: true, date: today, operations: ops };
    });
    results.push("hors-recolte:ok");
  } catch (e) { results.push(`hors-recolte:${e.message}`); }

  // 9. Suivi-tunnels (per ferme)
  try {
    for (const ferme of ['F1', 'F5', 'Avocatier']) {
      await withCache(`pointage_suivi_tunnels_${today}_${ferme}`, 0, async () => {
        const yesterdayStr = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
        const thirtyDaysAgo = new Date(new Date(today).getTime() - 30 * 86400000).toISOString().slice(0, 10);
        const [todayRows, cumulRows] = await Promise.all([
          getPointageRowsForDate(today),
          getPointageRowsForDateRange(thirtyDaysAgo, yesterdayStr),
        ]);
        const filterHR = r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes";
        const todayGroups = {};
        for (const r of todayRows.filter(filterHR)) {
          const key = `${r.Operation}|${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Variete}`;
          if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), quantiteRealisee: 0, totalHr: 0, totalJr: 0, totalCout: 0 };
          todayGroups[key].workers.add(r.Personnel_Matricule);
          todayGroups[key].quantiteRealisee += r.Quantite_unite || 0;
          todayGroups[key].totalHr += r.Nombre_Hr || 0;
          todayGroups[key].totalCout += r.Cout || 0;
        }
        const cumulMap = {};
        for (const r of cumulRows.filter(filterHR)) {
          const key = `${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`;
          if (!cumulMap[key]) cumulMap[key] = { quantiteCumul: 0, joursCumul: 0 };
          cumulMap[key].quantiteCumul += r.Quantite_unite || 0;
          cumulMap[key].joursCumul += r.Nombre_Jr || 0;
        }
        const byFerme = {};
        for (const g of Object.values(todayGroups)) {
          const f = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
          if (f !== ferme) continue;
          if (!byFerme[f]) byFerme[f] = [];
          const parcelle = (g.Parcelle_Culturale || '').trim();
          const cumul = cumulMap[`${parcelle}_${g.Operation}`] || { quantiteCumul: 0 };
          byFerme[f].push({ parcelle, variete: g.Variete || parcelle, tache: g.Operation, nbOuvriers: g.workers.size, realiseAujourdhui: Math.round(g.quantiteRealisee), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + g.quantiteRealisee), heures: g.totalHr, cout: Math.round(g.totalCout), ferme: f });
        }
        return { success: true, date: today, tunnels: byFerme };
      });
    }
    results.push("suivi-tunnels:ok");
  } catch (e) { results.push(`suivi-tunnels:${e.message}`); }

  console.log(`[cacheWarmer] Results: ${results.join(", ")}`);
  return results;
}

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

// =============================================
// API: pointageRH
// =============================================
exports.pointageRH = functions.region("europe-west1").https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const action = req.query.action || "summary";
      const dateParam = req.query.date; // YYYY-MM-DD

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
      // EXCEPTION — actions OPÉRATIONNELLES légitimement utilisées par le caporal
      // (écran « Tunnels » : HorsRecolteSuiviTab → action=suivi-tunnels). Ce sont
      // des agrégats de PROGRESSION par parcelle/tâche (effectifs, quantités),
      // PAS un listing paie nominatif ; déjà cloisonnés côté client par ?ferme=.
      // On les exclut du gating paie pour ne pas casser l'écran caporal.
      // 'confection-types' = simple référentiel d'ops (non nominatif), laissé libre.
      const GATING_EXEMPT_ACTIONS = { "suivi-tunnels": true, "confection-types": true, "referentiel-taches-list": true };
      let _fermeFilter = null; // null = accès global (all) ou action exemptée
      let _cultureFilter = null; // null = pas de filtre culture additionnel
      if (!GATING_EXEMPT_ACTIONS[action]) {
        const _authUser = await verifyAuth(req);
        const _callerProfile = await resolveCallerProfile(_authUser);
        const _perim = consoAccessControl.resolvePerimetre(_callerProfile, req.query.ferme);
        const _access = resolvePointageRHAccess(_perim);
        if (!_access.allowed) {
          return res.status(403).json({ success: false, error: "Accès non autorisé" });
        }
        _fermeFilter = _access.fermeFilter; // null (all) ou 'F1'|'F5'|'Avocatier'|'BAHIA'
        _cultureFilter = _perim.culture_filtre || null; // null ou 'Myrtille' (chef_f5)
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

      // ------ CONFECTION-TYPES: extract distinct confection types from BR_Pointage ------
      if (action === "confection-types") {
        try {
          let operations = [];
          if (USE_MIRROR) {
            // Lire depuis le mirror Firestore
            const dates = await getAvailableDates();
            const recentDates = dates.slice(0, 10);
            const opsSet = new Set();
            for (const d of recentDates) {
              const rows = await getPointageRowsForDate(d);
              rows.filter(r => r.Operation_Famille === "8. Récolte" && /caisse/i.test(r.Operation || ""))
                  .forEach(r => opsSet.add((r.Operation || "").trim()));
            }
            operations = [...opsSet];
          } else {
            const result = await db.request().query(`
              SELECT DISTINCT Operation FROM BR_Pointage
              WHERE Operation_Famille = N'8. Récolte'
              AND Operation LIKE N'%Caisse%kg%'
            `);
            operations = result.recordset.map(r => (r.Operation || "").trim()).filter(Boolean);
          }
          // Extraire le poids par colis depuis le nom de l'opération (caisse, barquette, seau, etc.)
          const types = operations.map(op => {
            const match = op.match(/([\d.]+)\s*kg/i);
            const poidsParColis = match ? parseFloat(match[1]) : 1.5;
            return { id: op.replace(/\s+/g, '_').toLowerCase(), label: op, poidsParColis, composition: [], source: 'beeone' };
          }).sort((a, b) => a.poidsParColis - b.poidsParColis);
          return res.json({ success: true, types });
        } catch(e) {
          console.error('confection-types error:', e);
          return res.json({ success: true, types: [] });
        }
      }

      // ------ PRESENCE: heures entrée/sortie depuis BEE_BERRY_GOOD (mirror prod_presence) ------
      if (action === "presence") {
        const date = dateParam || new Date().toISOString().slice(0, 10);
        const snap = await db_firestore.collection("prod_presence").doc(date).get();
        if (!snap.exists) {
          return res.json({ success: true, date, rows: [], rowCount: 0, syncedAt: null });
        }
        const data = snap.data();
        let rows = data.rows || [];
        // GATING PAIE (chef) : prod_presence est NOMINATIF et ne porte pas de parcelle
        // exploitable pour dériver la ferme. Même approche que buildHeuresSup : on
        // dérive le set des matricules ayant pointé la ferme du chef (via le mirror
        // du même jour), puis on ne renvoie que ces rows. Fail-closed : un ouvrier
        // présent mais jamais pointé sur la ferme du chef est exclu.
        // _fermeFilter null (RH/DG/Finance) → passthrough (toutes rows, inchangé).
        if (_fermeFilter) {
          // getPointageRowsForDate est shadowé (filtré ferme) → computeAllowedMatricules
          // re-filtre sans effet, restant correct.
          const mirrorRows = await getPointageRowsForDate(date);
          const allowed = computeAllowedMatricules(mirrorRows, _fermeFilter);
          rows = filterPresenceRowsByAllowed(rows, allowed);
        }
        return res.json({
          success: true,
          date,
          rows,
          rowCount: rows.length,
          syncedAt: data.syncedAt || null,
        });
      }

      // ------ PRESENCE-QUINZAINE: résumé absence entrée/sortie pour toute la quinzaine ------
      if (action === "presence-quinzaine") {
        const meta = await getPointageMeta();
        const periodes = (meta && meta.periodes) || [];
        const periodeMap = (meta && meta.periodeMap) || {};
        const targetPeriode = periodes[0];
        if (!targetPeriode) return res.json({ success: true, periode: null, days: [] });
        const days = (periodeMap[targetPeriode] || []).slice().sort();
        const dayResults = [];
        for (let i = 0; i < days.length; i += 10) {
          const batch = days.slice(i, i + 10);
          const snaps = await Promise.all(batch.map(d => db_firestore.collection('prod_presence').doc(d).get()));
          snaps.forEach((snap, idx) => {
            const d = batch[idx];
            let rows = snap.exists ? (snap.data().rows || []) : [];
            // fermeFilter skipped: prod_presence n'a pas de parcelle exploitable.
            // Le frontend filtre via transportRows (ferme dérivée de la parcelle BDP).
            dayResults.push({
              date: d,
              rows: rows.map(r => ({
                matricule: (r.matricule || '').trim(),
                nom: (r.nom || '').trim(),
                heureEntree: r.heureEntree || null,
                heureSortie: r.heureSortie || null,
              })),
            });
          });
        }
        return res.json({ success: true, periode: targetPeriode, days: dayResults });
      }

      // ------ SUMMARY: effectif today + yesterday + weekly trend + top ops ------
      if (action === "summary") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // Clé ferme-aware : le payload est filtré par _fermeFilter (shadow des fetchers).
        const cacheKey = pointageCacheKey(`pointage_summary_${dateForCheck}`, _fermeFilter, _cultureFilter);
        const cached = await withCache(cacheKey, 2 * 60 * 1000, async () => {
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        if (USE_MIRROR) {
          // === MIRROR PATH ===
          const yesterdayStr = new Date(new Date(dateForCheck).getTime() - 86400000).toISOString().slice(0, 10);
          const weekStartStr = new Date(new Date(dateForCheck).getTime() - 6 * 86400000).toISOString().slice(0, 10);
          const [todayRows, yesterdayRows, weekRows] = await Promise.all([
            getPointageRowsForDate(dateForCheck),
            getPointageRowsForDate(yesterdayStr),
            getPointageRowsForDateRange(weekStartStr, dateForCheck),
          ]);
          // Effectifs = OUVRIERS DISTINCTS par (ferme, type), dédupliqués sur les lignes brutes
          // (un ouvrier multi-parcelles compté 1×, cohérent avec le popup détail).
          const fermes = countDistinctByFermeType(todayRows.map(r => ({
            matricule: r.Personnel_Matricule,
            ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
            type: classifyType(r.Operation_Famille),
            cout: r.Cout || 0,
          })), POINTAGE_FERMES);
          // Veille = même méthode distincte (sinon variation faussée : distinct vs gonflé).
          const veilleEffectif = countDistinctByFermeType(yesterdayRows.map(r => ({
            matricule: r.Personnel_Matricule,
            ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
            type: classifyType(r.Operation_Famille),
            cout: r.Cout || 0,
          })), POINTAGE_FERMES);
          const fermesYesterday = { F1: { total: veilleEffectif.F1.total }, F5: { total: veilleEffectif.F5.total }, Avocatier: { total: veilleEffectif.Avocatier.total }, BAHIA: { total: veilleEffectif.BAHIA.total } };
          // Override with snapshot data.
          // GATING PAIE (fail-closed) : snapData.summary est le résumé effectif/coût
          // d'UNE ferme soumise. Pour un chef, on ne réinjecte QUE le snapshot de SA
          // ferme — sinon pointageJour émettrait l'effectif/coût des autres fermes
          // soumises. Les live counts (fermes[f]) des autres fermes sont déjà zérotés
          // par le shadow des fetchers (todayRows filtré). _fermeFilter null
          // (RH/DG/Finance) → override de toutes les fermes soumises (inchangé).
          for (const f of Object.keys(submittedFermes)) {
            if (_fermeFilter && f !== _fermeFilter) continue;
            const snapData = await getSnapshotData(dateForCheck, f);
            if (snapData && snapData.summary && fermes[f]) fermes[f] = snapData.summary;
          }
          const pointageJour = Object.keys(fermes).map(f => {
            const e = fermes[f];
            // total = ouvriers DISTINCTS ferme tous types ; fallback somme pour snapshots ancien format.
            const total = (typeof e.total === 'number') ? e.total : (e.recolte + e.horsRecolte + e.postesFixes);
            const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
            return { ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes, cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0 };
          });
          // Weekly trend
          const trendMap = {};
          for (const r of weekRows) {
            const key = r.DateStr;
            if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (trendMap[key][ferme]) trendMap[key][ferme].add(r.Personnel_Matricule);
          }
          const weeklyTrend = Object.values(trendMap).map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size, BAHIA: t.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
          // Top ops
          const opsGroups = {};
          for (const r of todayRows) {
            if (r.Operation_Famille === "8. Récolte" || r.Operation_Famille === "11. Postes fixes") continue;
            const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
            if (!opsGroups[key]) opsGroups[key] = { ...r, workers: new Set(), totalHr: 0 };
            opsGroups[key].workers.add(r.Personnel_Matricule);
            opsGroups[key].totalHr += r.Nombre_Hr || 0;
          }
          const topOps = Object.values(opsGroups).map(g => ({ operation: g.Operation || g.Operation_Famille, operationFamille: g.Operation_Famille, effectif: g.workers.size, heures: g.totalHr, parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif).slice(0, 10);
          // Recolte kg
          const recolteRows = todayRows.filter(r => r.Operation_Famille === "8. Récolte");
          const recolteWorkers = new Set(recolteRows.map(r => r.Personnel_Matricule));
          const recolteQty = recolteRows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
          const recolteCout = recolteRows.reduce((s, r) => s + (r.Cout || 0), 0);
          const syncStatus = await getSyncStatus();
          return { success: true, date: dateForCheck, effectif: fermes, pointageJour, weeklyTrend, topOps, recolteTotal: { qty: recolteQty, nbOuv: recolteWorkers.size, cout: Math.round(recolteCout) }, lastSaisie: syncStatus?.lastSuccessAt || null, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null };
        }

        // === FALLBACK SQL PATH ===
        const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";

        // Effectifs = OUVRIERS DISTINCTS par (ferme, type). On descend le matricule au grain
        // (parcelle, op) afin de dédupliquer côté JS par (ferme, type) — un ouvrier multi-parcelles
        // ne doit compter qu'une fois. Le coût reste une SOMME (inchangé). Idem veille + trend.
        const [todayRes, yesterdayRes, trendRes, topOpsRes, recolteKgRes, lastSaisieRes] = await Promise.all([
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule`),
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = DATEADD(day, -1, ${dateSQL}) GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille, Personnel_Matricule`),
          db.request().query(`SELECT CONVERT(date, Periode_Date) AS jour, Ref_parcelle, Parcelle_Culturale, Personnel_Matricule FROM BR_Pointage WHERE Periode_Date >= DATEADD(day, -6, ${dateSQL}) AND CONVERT(date, Periode_Date) <= ${dateSQL} GROUP BY CONVERT(date, Periode_Date), Ref_parcelle, Parcelle_Culturale, Personnel_Matricule ORDER BY jour`),
          db.request().query(`SELECT Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Hr) AS totalHr FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes' GROUP BY Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale ORDER BY nbOuv DESC`),
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Quantite_unite, Personnel_Matricule, Cout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = '8. Récolte'`),
          db.request().query(`SELECT TOP 1 Periode_Date FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} ORDER BY Periode_Date DESC`),
        ]);

        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false, filet de sécurité). Ces
        // recordsets portent Ref_parcelle/Parcelle_Culturale → ferme dérivable. On filtre
        // CHAQUE recordset par la ferme du chef AVANT agrégation (effectifs/trend/topOps/
        // récolte), comme le chemin mirror via les fetchers shadowés. Fail-closed.
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
        const todayRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(todayRes.recordset, _fermeFilter), _cultureFilter);
        const yesterdayRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(yesterdayRes.recordset, _fermeFilter), _cultureFilter);
        const trendRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(trendRes.recordset, _fermeFilter), _cultureFilter);
        const topOpsRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(topOpsRes.recordset, _fermeFilter), _cultureFilter);
        const recolteRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(recolteKgRes.recordset, _fermeFilter), _cultureFilter);

        const fermes = countDistinctByFermeType(todayRows.map(row => ({
          matricule: row.Personnel_Matricule,
          ferme: deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale),
          type: classifyType(row.Operation_Famille),
          cout: row.totalCout || 0,
        })), POINTAGE_FERMES);
        const veilleEffectif = countDistinctByFermeType(yesterdayRows.map(row => ({
          matricule: row.Personnel_Matricule,
          ferme: deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale),
          type: classifyType(row.Operation_Famille),
        })), POINTAGE_FERMES);
        const fermesYesterday = { F1: { total: veilleEffectif.F1.total }, F5: { total: veilleEffectif.F5.total }, Avocatier: { total: veilleEffectif.Avocatier.total }, BAHIA: { total: veilleEffectif.BAHIA.total } };

        // Override with snapshot data for submitted fermes.
        // GATING PAIE (fail-closed) : même garde ferme que le chemin mirror (l.1726).
        // Pour un chef, ne réinjecter QUE le snapshot de SA ferme — sinon le résumé
        // effectif/coût des autres fermes soumises fuiterait. _fermeFilter null
        // (RH/DG/Finance) → override de toutes les fermes soumises (inchangé).
        for (const f of Object.keys(submittedFermes)) {
          if (_fermeFilter && f !== _fermeFilter) continue;
          const snapData = await getSnapshotData(dateForCheck, f);
          if (snapData && snapData.summary && fermes[f]) {
            fermes[f] = snapData.summary;
          }
        }

        // Build pointageJour array
        const pointageJour = Object.keys(fermes).map(f => {
          const e = fermes[f];
          // total = ouvriers DISTINCTS ferme tous types ; fallback somme pour snapshots ancien format.
          const total = (typeof e.total === 'number') ? e.total : (e.recolte + e.horsRecolte + e.postesFixes);
          const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
          return {
            ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes,
            cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0,
          };
        });

        // Weekly trend — ouvriers distincts par (jour, ferme), dédupliqués via Set.
        const trendMap = {};
        for (const row of trendRows) {
          const d = new Date(row.jour);
          const key = d.toISOString().slice(0, 10);
          if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: d.toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
          const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
          if (trendMap[key][ferme]) trendMap[key][ferme].add(row.Personnel_Matricule);
        }
        const weeklyTrend = Object.values(trendMap)
          .map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size, BAHIA: t.BAHIA.size }))
          .sort((a, b) => a.jour.localeCompare(b.jour));

        // Top ops
        const topOps = topOpsRows.slice(0, 10).map(r => ({
          operation: r.Operation || r.Operation_Famille,
          operationFamille: r.Operation_Famille,
          effectif: r.nbOuv,
          heures: r.totalHr,
          parcelle: (r.Parcelle_Culturale || "").trim(),
          ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        }));

        // Récolte : agrégé en JS depuis les lignes filtrées par ferme (la requête ne
        // pré-agrège plus, pour rester cloisonnable). nbOuv = matricules distincts.
        const recolteMatricules = new Set();
        let recolteTotalQty = 0;
        let recolteTotalCout = 0;
        for (const r of recolteRows) {
          if (r.Personnel_Matricule) recolteMatricules.add(r.Personnel_Matricule);
          recolteTotalQty += r.Quantite_unite || 0;
          recolteTotalCout += r.Cout || 0;
        }
        const recolteKg = { totalQty: recolteTotalQty, nbOuv: recolteMatricules.size, totalCout: recolteTotalCout };
        const lastSaisieRow = lastSaisieRes.recordset[0];
        const lastSaisie = lastSaisieRow ? new Date(lastSaisieRow.Periode_Date).toISOString() : null;

        return {
          success: true, date: dateParam || new Date().toISOString().slice(0, 10),
          effectif: fermes, pointageJour, weeklyTrend, topOps,
          recolteTotal: { qty: recolteKg.totalQty || 0, nbOuv: recolteKg.nbOuv || 0, cout: Math.round(recolteKg.totalCout || 0) },
          lastSaisie,
        };
        }); // end withCache
        return res.json(cached);
      }

      // ------ DETAIL: detailed pointage for a date ------
      if (action === "detail") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // GATING PAIE : la clé de cache inclut la ferme du chef (_fermeFilter) pour
        // qu'un payload cloisonné ne soit jamais servi à un autre profil ni ne pollue
        // le cache global RH ('all' → suffixe 'all', comportement inchangé).
        const cacheSuffix = _fermeFilter || 'all';
        const cached = await withCache(`pointage_detail_${dateForCheck}_${cacheSuffix}`, 2 * 60 * 1000, async () => {
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        let rows;
        if (USE_MIRROR) {
          rows = await fetchDetailFromMirror(dateForCheck, _fermeFilter);
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`
            SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
              Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture,
              HS_25, HS_50, HS_100, HS_NM
            FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL}
            ORDER BY Ref_parcelle, Operation_Famille, Personnel_Nom`);
          rows = result.recordset.map(r => ({
            matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
            operationFamille: r.Operation_Famille, operation: r.Operation, groupe: r.Operation_Groupe,
            jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
            parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim(),
            ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), type: classifyType(r.Operation_Famille),
            variete: r.Variete, culture: r.Culture, hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
          }));
          // GATING PAIE : chef → cloisonnement sur la ferme dérivée (fail-closed).
          rows = filterByFermeField(rows, _fermeFilter);
        }

        if (Object.keys(submittedFermes).length > 0) {
          const liveRows = rows.filter(r => !submittedFermes[r.ferme]);
          let snapshotRows = [];
          for (const f of Object.keys(submittedFermes)) {
            const snapData = await getSnapshotData(dateForCheck, f);
            if (snapData && snapData.detailRows) snapshotRows = snapshotRows.concat(snapData.detailRows);
          }
          // GATING PAIE : les snapshots agrègent TOUTES les fermes → filtrer sur la
          // ferme du chef avant renvoi (fail-closed sur 'Autre'/autre ferme).
          rows = filterByFermeField([...liveRows, ...snapshotRows], _fermeFilter);
        }

        return { success: true, date: dateForCheck, rows, count: rows.length };
        }); // end withCache
        return res.json(cached);
      }

      // ------ RECOLTE: harvest workers for a date ------
      if (action === "recolte") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // Clé ferme-aware : le payload est filtré par _fermeFilter (shadow des fetchers).
        const cached = await withCache(pointageCacheKey(`pointage_recolte_${dateForCheck}`, _fermeFilter, _cultureFilter), 2 * 60 * 1000, async () => {
        let workers, cueillette;

        if (USE_MIRROR) {
          const [pointageRows, cueilletteRows] = await Promise.all([
            getPointageRowsForDate(dateForCheck),
            getCueilletteRows(dateForCheck, dateForCheck),
          ]);
          // Cueillette
          const cGroups = {};
          for (const r of cueilletteRows.filter(r => r.Operation_Famille === "8. Récolte")) {
            const key = `${r.Parcelle_Culturale}|${r.Variete}`;
            if (!cGroups[key]) cGroups[key] = { parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, refTech: (r.Reference_Technique || "").trim(), totalKg: 0, totalCaisses: 0 };
            cGroups[key].totalKg += r.Poids_total_kg || 0;
            cGroups[key].totalCaisses += r.Nbre_Caisse || 0;
          }
          cueillette = Object.values(cGroups).map(c => ({ ...c, ferme: deriveFerme(c.refTech || null, c.parcelle) })).sort((a, b) => b.totalKg - a.totalKg);
          // Workers from pointage
          workers = pointageRows
            .filter(r => r.Operation_Famille === "8. Récolte")
            .map((r, i) => ({
              rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
              operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation),
              heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(),
              ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete,
            }));
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const [pointageRes, cueilletteRes] = await Promise.all([
            db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation, Quantite_unite, Nombre_Hr, Cout, Parcelle_Culturale, Ref_parcelle, Variete FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'8. Récolte' ORDER BY Quantite_unite DESC, Personnel_Nom`),
            db.request().query(`SELECT Parcelle_Culturale, Variete, Reference_Technique, SUM(Poids_total_kg) AS totalKg, SUM(Nbre_Caisse) AS totalCaisses FROM BR_Cueillette WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'8. Récolte' GROUP BY Parcelle_Culturale, Variete, Reference_Technique ORDER BY totalKg DESC`),
          ]);
          cueillette = cueilletteRes.recordset.map(r => ({ parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, ferme: deriveFerme(r.Reference_Technique, r.Parcelle_Culturale), totalKg: r.totalKg || 0, totalCaisses: r.totalCaisses || 0 }));
          workers = pointageRes.recordset.map((r, i) => ({ rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation), heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete }));
          // Fail-closed : cohérence avec detail/postes-fixes. En prod USE_MIRROR=true
          // (le shadow filtre déjà), mais on filtre aussi cette branche SQL fallback.
          workers = filterByFermeField(workers, _fermeFilter);
          cueillette = filterByFermeField(cueillette, _fermeFilter);
        }

        // Dédup SYSTÉMATIQUE par matricule : 1 ligne BR_Pointage par (ouvrier × parcelle),
        // donc un ouvrier multi-parcelles était compté N fois (count gonflé). On regroupe
        // par matricule en SOMMANT heures/cout/quantite (somme totale inchangée — rien perdu).
        // Auparavant ce regroupement n'avait lieu que dans la branche scan prod ci-dessous.
        workers = dedupeWorkersByMatricule(workers);

        // Enrich with production data (Tracabilite_recolte) if available
        let prodSyncedAt = null;
        try {
          const prodDoc = await db_firestore.collection("prod_tracabilite_recolte").doc(dateForCheck).get();
          if (prodDoc.exists) {
            const prodData = prodDoc.data();
            if (prodData.syncedAt && typeof prodData.syncedAt.toMillis === "function") {
              prodSyncedAt = prodData.syncedAt.toMillis();
            }
          }
          // Fallback: if no doc for this date (no scans yet), use the global last-run timestamp
          if (!prodSyncedAt) {
            const statusDoc = await db_firestore.collection("prod_tracabilite_recolte").doc("_status").get();
            if (statusDoc.exists) {
              const s = statusDoc.data();
              if (s.lastRunAt && typeof s.lastRunAt.toMillis === "function") {
                prodSyncedAt = s.lastRunAt.toMillis();
              }
            }
          }
          if (prodDoc.exists) {
            const prodData = prodDoc.data();
            // GATING PAIE (fail-closed) : prod_tracabilite_recolte contient TOUS les
            // ouvriers de TOUTES les fermes (aucun champ ferme). Pour un chef, on filtre
            // les lignes prod sur sa ferme AVANT tout enrichissement — sinon la boucle
            // « add workers missing from pointage » injecterait matricule+nom+kg d'autres
            // fermes, et cueillette/totalKg (prodData.totalKg) seraient tous-fermes.
            // _fermeFilter null (RH/DG/Finance) → passthrough STRICT (inchangé).
            const prodRows = filterProdRowsByFerme(prodData.rows || [], _fermeFilter);
            if (prodRows.length > 0) {
              // workers est déjà dédupliqué par matricule (cf. dedupeWorkersByMatricule
              // appelé plus haut, systématiquement). Idempotent par sécurité.
              workers = dedupeWorkersByMatricule(workers);

              const prodMap = {};
              prodRows.forEach(r => { prodMap[(r.matricule || "").toUpperCase()] = r; });
              // Override kg for existing workers — prod is the source of truth for kg
              workers.forEach(w => {
                const prod = prodMap[(w.matricule || "").toUpperCase()];
                if (prod) {
                  w.quantite = prod.totalKg;
                  w.variete = prod.variete || w.variete;
                } else {
                  w.quantite = 0;
                }
              });
              // Add workers in prod but missing from pointage
              prodRows.forEach(r => {
                const matUp = (r.matricule || "").toUpperCase();
                if (!workers.find(w => (w.matricule || "").toUpperCase() === matUp)) {
                  workers.push({
                    rank: 0, matricule: r.matricule, nom: r.nom,
                    operation: "Récolte (prod)", quantite: r.totalKg,
                    heures: 0, cout: 0, parcelle: r.refParcelle || "",
                    ferme: deriveFerme(r.refParcelle, ""), variete: r.variete,
                  });
                }
              });
              // Use prod totalKg instead of BR_Cueillette. Pour un chef, prodData.totalKg
              // est un total TOUTES fermes → on resomme sur les seules lignes prod de sa
              // ferme (déjà filtrées ci-dessus). _fermeFilter null → total prod d'origine.
              const prodTotalKg = recomposeProdTotalKg(prodRows, prodData.totalKg || 0, _fermeFilter);
              cueillette = [{ parcelle: "Total (prod)", variete: "", ferme: _fermeFilter || "", totalKg: prodTotalKg, totalCaisses: 0 }];
            }
          }
        } catch (prodErr) {
          console.warn("[recolte] Prod data unavailable, using reporting:", prodErr.message);
        }

        workers.sort((a, b) => b.quantite - a.quantite || a.nom.localeCompare(b.nom));
        workers.forEach((w, i) => { w.rank = i + 1; });
        const totalKgCueillette = cueillette.reduce((s, c) => s + c.totalKg, 0);
        return { success: true, date: dateForCheck, workers, cueillette, totalKgCueillette, count: workers.length, prodSyncedAt };
        }); // end withCache
        return res.json(cached);
      }

      // ------ QUINZAINE: bi-weekly summary ------
      if (action === "quinzaine") {
        const periodeParam = req.query.periode;
        // Clé ferme-aware : le payload (parFerme/parJour) dépend de _fermeFilter.
        const cacheKey = pointageCacheKey(`pointage_quinzaine_${periodeParam || "latest"}`, _fermeFilter, _cultureFilter);
        const cached = await withCache(cacheKey, 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.allPeriodes || meta?.periodes || [];
          const periodeCampagne = (meta && meta.periodeCampagne) || {};
          const mirrorPeriodes = meta?.periodes || [];
          const selectedPeriode = periodeParam || defaultPeriode(meta, periodes);
          if (!selectedPeriode) return { success: true, periode: null, periodes, periodeCampagne, totalJournees: 0, totalCout: 0, parFerme: [], parJour: [] };

          // If selected period has mirror data, use Firestore; otherwise fallback to SQL
          let rows;
          if (mirrorPeriodes.includes(selectedPeriode) && meta?.periodeMap?.[selectedPeriode]) {
            rows = await getPointageRowsForPeriode(selectedPeriode);
          } else {
            // Check Firestore archive first
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().summary) {
              const arch = archiveDoc.data().summary;
              // GATING PAIE (chef) : l'archive stocke des agrégats TOUTES fermes
              // (parFerme keyé par ferme, parJour ventilé par ferme, totaux tous-fermes).
              // Sans cloisonnement, un chef verrait toutes les fermes. On ne garde que
              // sa ferme et on recompose ses totaux (fail-closed sur journees/cout du jour,
              // non ventilables par ferme dans l'archive).
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              const parFerme = filterArchivedParFerme(arch.parFerme, _fermeFilter);
              const parJour = filterArchivedParJour(arch.parJour, _fermeFilter);
              const totals = recomposeArchivedTotals(parFerme, arch, _fermeFilter);
              // parCulture : présent dans les nouvelles archives, null dans les anciennes
              // (le frontend dégrade gracieusement si null — bouton Rafraîchir Firestore Cache)
              const parCulture = arch.parCulture || null;
              return {
                success: true, periode: selectedPeriode, periodes, periodeCampagne,
                totalJournees: totals.totalJournees, totalCout: totals.totalCout,
                parFerme, parJour, parCulture,
              };
            }
            // Fallback: fetch directly from SQL for older quinzaines
            const sqlDb = await getPool();
            const sqlResult = await sqlDb.request().input('periode', selectedPeriode).query(`
              SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
                Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle,
                Variete, Culture, Periode_paie,
                CONVERT(varchar(10), Periode_Date, 23) AS DateStr,
                HS_25, HS_50, HS_100, HS_NM
              FROM BR_Pointage
              WHERE Periode_paie = @periode
              ORDER BY Periode_Date, Personnel_Nom
            `);
            rows = sqlResult.recordset.map(r => ({
              Personnel_Matricule: (r.Personnel_Matricule || "").trim(),
              Personnel_Nom: (r.Personnel_Nom || "").trim(),
              Operation_Famille: r.Operation_Famille,
              Operation: r.Operation,
              Operation_Groupe: r.Operation_Groupe,
              Nombre_Jr: r.Nombre_Jr,
              Nombre_Hr: r.Nombre_Hr,
              Quantite_unite: r.Quantite_unite,
              Cout: r.Cout,
              Parcelle_Culturale: (r.Parcelle_Culturale || "").trim(),
              Ref_parcelle: (r.Ref_parcelle || "").trim(),
              Variete: (r.Variete || "").trim(),
              Culture: (r.Culture || "").trim(),
              Periode_paie: (r.Periode_paie || "").trim(),
              DateStr: r.DateStr,
              HS_25: r.HS_25 || 0, HS_50: r.HS_50 || 0, HS_100: r.HS_100 || 0, HS_NM: r.HS_NM || 0,
            }));
            // GATING PAIE (chef) : ce fallback SQL lit le raw recordset SANS passer par
            // le fetcher shadowé (getPointageRowsForPeriode). On filtre donc les LIGNES
            // BRUTES par la ferme du chef AVANT toute agrégation (qFermes/parJour/totaux),
            // exactement comme le chemin mirror. Sans ça, un chef verrait toutes les fermes.
            // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
            // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
            rows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(rows, _fermeFilter), _cultureFilter);
          }
          // Summary per ferme
          const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, BAHIA: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
          for (const r of rows) {
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            const type = classifyType(r.Operation_Famille);
            if (qFermes[ferme]) { qFermes[ferme].journees += r.Nombre_Jr || 0; qFermes[ferme].cout += r.Cout || 0; qFermes[ferme][type] += r.Nombre_Jr || 0; }
          }
          // Per day
          const dayMap = {};
          for (const r of rows) {
            const key = r.DateStr;
            if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: new Set(), journees: 0, cout: 0, F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
            dayMap[key].nbOuv.add(r.Personnel_Matricule);
            dayMap[key].journees += r.Nombre_Jr || 0;
            dayMap[key].cout += r.Cout || 0;
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (dayMap[key][ferme]) dayMap[key][ferme].add(r.Personnel_Matricule);
          }
          const perDay = Object.values(dayMap).map(d => ({ jour: d.jour, jourLabel: d.jourLabel, nbOuv: d.nbOuv.size, journees: d.journees, cout: d.cout, F1: d.F1.size, F5: d.F5.size, Avocatier: d.Avocatier.size, BAHIA: d.BAHIA.size })).sort((a, b) => a.jour.localeCompare(b.jour));
          const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
          const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
          const parCulture = buildParCulture(rows);
          return { success: true, periode: selectedPeriode, periodes, periodeCampagne, totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay, parCulture: parCulture };
        }

        // === FALLBACK SQL PATH ===
        let periodeFilter = "";
        if (periodeParam) { periodeFilter = `AND Periode_paie = '${periodeParam}'`; }
        else { const latest = await db.request().query(`SELECT TOP 1 Periode_paie FROM BR_Pointage ORDER BY Periode_Date DESC`); const latestPeriode = latest.recordset[0]?.Periode_paie || ""; periodeFilter = latestPeriode ? `AND Periode_paie = '${latestPeriode}'` : ""; }
        const [summaryRes, perDayRes, perDayMatRes, periodesRes] = await Promise.all([
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout, SUM(Quantite_unite) AS totalQty FROM BR_Pointage WHERE 1=1 ${periodeFilter} GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille`),
          db.request().query(`SELECT CONVERT(date, Periode_Date) AS jour, Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE 1=1 ${periodeFilter} GROUP BY CONVERT(date, Periode_Date), Ref_parcelle, Parcelle_Culturale, Operation_Famille ORDER BY jour`),
          // Lignes (jour, matricule, parcelle) pour compter des matricules DISTINCTS par jour
          // et par (jour, ferme) en JS — la ferme est dérivée en JS, pas une colonne SQL,
          // donc un GROUP BY ferme côté SQL n'est pas possible. Mirroir du chemin MIRROR.
          db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour, Personnel_Matricule, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE 1=1 ${periodeFilter}`),
          db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`),
        ]);
        // GATING PAIE (chef) : ce fallback SQL externe (USE_MIRROR=false, filet de
        // sécurité) agrège des recordsets bruts portant Ref_parcelle/Parcelle_Culturale
        // → ferme dérivable. On filtre CHAQUE recordset par la ferme du chef AVANT
        // agrégation (qFermes/parJour/totaux) pour cloisonner, cohérence fail-closed.
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
        const summaryRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(summaryRes.recordset, _fermeFilter), _cultureFilter);
        const perDayRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(perDayRes.recordset, _fermeFilter), _cultureFilter);
        const perDayMatRows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(perDayMatRes.recordset, _fermeFilter), _cultureFilter);
        const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, BAHIA: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
        for (const row of summaryRows) { const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale); const type = classifyType(row.Operation_Famille); if (qFermes[ferme]) { qFermes[ferme].journees += row.totalJr || 0; qFermes[ferme].cout += row.totalCout || 0; qFermes[ferme][type] += row.totalJr || 0; } }
        // journees/cout = SOMMES sur les groupes (parcelle × op-famille) — INCHANGÉ.
        const dayMap = {};
        for (const row of perDayRows) { const d = new Date(row.jour); const key = d.toISOString().slice(0, 10); if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: 0, journees: 0, cout: 0, F1: 0, F5: 0, Avocatier: 0, BAHIA: 0 }; dayMap[key].journees += row.totalJr || 0; dayMap[key].cout += row.totalCout || 0; }
        // nbOuv (jour + par ferme) = matricules DISTINCTS via Set (corrige le gonflage :
        // on ne somme plus des COUNT(DISTINCT) par parcelle/op). Mirroir du chemin MIRROR.
        const daySets = {};
        for (const row of perDayMatRows) {
          const d = new Date(row.jour); const key = d.toISOString().slice(0, 10);
          if (!daySets[key]) daySets[key] = { nbOuv: new Set(), F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
          const mat = row.Personnel_Matricule;
          daySets[key].nbOuv.add(mat);
          const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
          if (daySets[key][ferme]) daySets[key][ferme].add(mat);
        }
        for (const key of Object.keys(daySets)) {
          if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: 0, journees: 0, cout: 0, F1: 0, F5: 0, Avocatier: 0, BAHIA: 0 };
          const s = daySets[key];
          dayMap[key].nbOuv = s.nbOuv.size;
          dayMap[key].F1 = s.F1.size; dayMap[key].F5 = s.F5.size; dayMap[key].Avocatier = s.Avocatier.size; dayMap[key].BAHIA = s.BAHIA.size;
        }
        const perDay = Object.values(dayMap).sort((a, b) => a.jour.localeCompare(b.jour));
        const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
        const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
        // summaryRows champs: totalJr / totalCout (SQL agrégé) → mapper pour buildParCulture
        const parCulture = buildParCulture(summaryRows.map(function(r) { return { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Nombre_Jr: r.totalJr, Cout: r.totalCout, Operation_Famille: r.Operation_Famille }; }));
        return { success: true, periode: periodeParam || "latest", periodes: periodesRes.recordset.map(r => r.Periode_paie), totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay, parCulture: parCulture };
        }); // end withCache
        return res.json(cached);
      }

      // ------ QUINZAINE-ANALYTIQUE: pivot parcelle x operation ------
      if (action === "quinzaine-analytique") {
        const periodeParam = req.query.periode;
        // Clé ferme-aware : les rows par parcelle/op dépendent de _fermeFilter.
        const cacheKey = pointageCacheKey(`pointage_quinzaine_analytique_${periodeParam || "latest"}`, _fermeFilter, _cultureFilter);
        const cached = await withCache(cacheKey, 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const periodeCampagne = (meta && meta.periodeCampagne) || {};
          const selectedPeriode = periodeParam || defaultPeriode(meta, periodes);
          if (!selectedPeriode) return { success: true, periode: null, periodes, periodeCampagne, rows: [] };
          // Surfaces BR_Parcelle en parallèle des rows (fallback {} si BDR down)
          const [rawRows, supMap] = await Promise.all([
            getPointageRowsForPeriode(selectedPeriode),
            fetchBrParcelleSupMap(),
          ]);
          if (rawRows.length === 0) {
            // Check Firestore archive
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().analytique) {
              // GATING PAIE (chef) : les rows archivées portent parcelle/refParcelle
              // → ferme dérivable. Sans filtrage, un chef verrait les parcelles/coûts
              // de toutes les fermes. Fail-closed : ferme dérivée ≠ _fermeFilter → exclue.
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              return { success: true, periode: selectedPeriode, periodes, periodeCampagne, rows: enrichRowsWithHaRef(filterArchivedRowsByFerme(archiveDoc.data().analytique, _fermeFilter), supMap) };
            }
          }
          // Group by parcelle+ref+opFamille+operation
          const groups = {};
          for (const r of rawRows) {
            const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}|${r.Operation}`;
            if (!groups[key]) groups[key] = { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Operation_Famille: r.Operation_Famille, Operation_Groupe: r.Operation_Groupe, Operation: r.Operation, workers: new Set(), JH: 0, Cout: 0 };
            groups[key].workers.add(r.Personnel_Matricule);
            groups[key].JH += r.Nombre_Jr || 0;
            groups[key].Cout += r.Cout || 0;
          }
          const rows = Object.values(groups).map(g => ({ parcelle: (g.Parcelle_Culturale || '').trim(), refParcelle: (g.Ref_parcelle || '').trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale), operationFamille: g.Operation_Famille, operationGroupe: g.Operation_Groupe || '', operation: g.Operation, nbOuv: g.workers.size, jh: Math.round(g.JH * 100) / 100, cout: Math.round(g.Cout) }));
          return { success: true, periode: selectedPeriode, periodes, periodeCampagne, rows: enrichRowsWithHaRef(rows, supMap) };
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const selectedPeriode = periodeParam || periodes[0];
        const result = await db.request().query(`SELECT Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation_Groupe, Operation, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS JH, SUM(Cout) AS Cout FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' GROUP BY Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation_Groupe, Operation ORDER BY Parcelle_Culturale, Operation_Famille`);
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Les rows portent un champ
        // `ferme` dérivé → on cloisonne sur la ferme du chef (fail-closed), cohérence avec
        // le chemin mirror/archive. _fermeFilter null (RH/DG/Finance) → passthrough.
        const rows = filterByFermeField(result.recordset.map(r => ({ parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), operationFamille: r.Operation_Famille, operationGroupe: r.Operation_Groupe || '', operation: r.Operation, nbOuv: r.nbOuv, jh: Math.round((r.JH || 0) * 100) / 100, cout: Math.round(r.Cout || 0) })), _fermeFilter);
        return { success: true, periode: selectedPeriode, periodes, rows: enrichRowsWithHaRef(rows, await fetchBrParcelleSupMap()) };
        }); // end withCache
        return res.json(cached);
      }

      // ------ HORS-RECOLTE: operations breakdown ------
      if (action === "hors-recolte") {
        // Charger le référentiel Firestore avant de construire les opérations
        await warmRefTaches();
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        // Clé ferme-aware : operations/effectifs dépendent de _fermeFilter.
        const cached = await withCache(pointageCacheKey(`pointage_hors_recolte_${dateForCheck}`, _fermeFilter), 10 * 60 * 1000, async () => {
          if (USE_MIRROR) {
            const rawRows = await getPointageRowsForDate(dateForCheck);
            const filtered = rawRows.filter(r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes");
            const groups = {};
            for (const r of filtered) {
              const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
              if (!groups[key]) groups[key] = { Operation_Famille: r.Operation_Famille, Operation_Groupe: r.Operation_Groupe, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, workers: new Set(), totalHr: 0, totalJr: 0, totalCout: 0 };
              groups[key].workers.add(r.Personnel_Matricule);
              groups[key].totalHr += r.Nombre_Hr || 0;
              groups[key].totalJr += r.Nombre_Jr || 0;
              groups[key].totalCout += r.Cout || 0;
            }
            const ops = Object.values(groups).map(g => ({ operationFamille: g.Operation_Famille, famille: resolveFamily(g.Operation_Groupe, g.Operation_Famille), groupe: (_refMap[g.Operation_Groupe && g.Operation_Groupe.trim()] || {}).groupe || '', operation: g.Operation, effectif: g.workers.size, heures: g.totalHr, journees: g.totalJr, cout: Math.round(g.totalCout), parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif);
            // Effectifs DISTINCTS (Set de matricules) — le front ne peut pas dédupliquer car
            // operations[].effectif est par (op×parcelle). On expose ici l'effectif distinct
            // global, par operationFamille, et par (ferme, famille) pour les vues filtrées.
            // heures/journees/cout restent des sommes côté front.
            const globalSet = new Set();
            const familleSets = {};
            const fermeSets = {};       // ferme -> Set global de la ferme
            const fermeFamilleSets = {}; // ferme -> famille -> Set
            for (const r of filtered) {
              const mat = r.Personnel_Matricule;
              const f = resolveFamily(r.Operation_Groupe, r.Operation_Famille);
              const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
              globalSet.add(mat);
              if (!familleSets[f]) familleSets[f] = new Set();
              familleSets[f].add(mat);
              if (!fermeSets[ferme]) fermeSets[ferme] = new Set();
              fermeSets[ferme].add(mat);
              if (!fermeFamilleSets[ferme]) fermeFamilleSets[ferme] = {};
              if (!fermeFamilleSets[ferme][f]) fermeFamilleSets[ferme][f] = new Set();
              fermeFamilleSets[ferme][f].add(mat);
            }
            const effectifParFamille = {};
            for (const f of Object.keys(familleSets)) effectifParFamille[f] = familleSets[f].size;
            const effectifDistinctParFerme = {};
            for (const ferme of Object.keys(fermeSets)) effectifDistinctParFerme[ferme] = fermeSets[ferme].size;
            const effectifFamilleParFerme = {};
            for (const ferme of Object.keys(fermeFamilleSets)) {
              effectifFamilleParFerme[ferme] = {};
              for (const f of Object.keys(fermeFamilleSets[ferme])) effectifFamilleParFerme[ferme][f] = fermeFamilleSets[ferme][f].size;
            }
            return { success: true, date: dateForCheck, operations: ops, effectifDistinct: globalSet.size, effectifParFamille, effectifDistinctParFerme, effectifFamilleParFerme };
          }
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Operation_Famille, Operation_Groupe, Operation, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Hr) AS totalHr, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes' GROUP BY Operation_Famille, Operation_Groupe, Operation, Ref_parcelle, Parcelle_Culturale ORDER BY Operation_Famille, nbOuv DESC`);
          // Fail-closed : cohérence avec le shadow. En prod USE_MIRROR=true, mais on
          // filtre aussi cette branche SQL fallback par la ferme du chef.
          const ops = filterByFermeField(result.recordset.map(r => ({ operationFamille: r.Operation_Famille, famille: resolveFamily(r.Operation_Groupe, r.Operation_Famille), groupe: (_refMap[r.Operation_Groupe && r.Operation_Groupe.trim()] || {}).groupe || '', operation: r.Operation, effectif: r.nbOuv, heures: r.totalHr, journees: r.totalJr, cout: Math.round(r.totalCout || 0), parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) })), _fermeFilter);
          // Effectifs DISTINCTS : on ramène les couples DISTINCTS (matricule, famille, parcelle)
          // pour dériver la ferme en JS et compter via Set (global / par famille / par ferme).
          const matRes = await db.request().query(`SELECT DISTINCT Personnel_Matricule, Operation_Famille, Operation_Groupe, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes'`);
          const globalSet = new Set();
          const familleSets = {};
          const fermeSets = {};
          const fermeFamilleSets = {};
          for (const r of matRes.recordset) {
            const mat = r.Personnel_Matricule;
            const f = resolveFamily(r.Operation_Groupe, r.Operation_Famille);
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            // Fail-closed : un chef ne voit que sa ferme dans les effectifs distincts.
            if (_fermeFilter && ferme !== _fermeFilter) continue;
            globalSet.add(mat);
            if (!familleSets[f]) familleSets[f] = new Set();
            familleSets[f].add(mat);
            if (!fermeSets[ferme]) fermeSets[ferme] = new Set();
            fermeSets[ferme].add(mat);
            if (!fermeFamilleSets[ferme]) fermeFamilleSets[ferme] = {};
            if (!fermeFamilleSets[ferme][f]) fermeFamilleSets[ferme][f] = new Set();
            fermeFamilleSets[ferme][f].add(mat);
          }
          const effectifParFamille = {};
          for (const f of Object.keys(familleSets)) effectifParFamille[f] = familleSets[f].size;
          const effectifDistinctParFerme = {};
          for (const ferme of Object.keys(fermeSets)) effectifDistinctParFerme[ferme] = fermeSets[ferme].size;
          const effectifFamilleParFerme = {};
          for (const ferme of Object.keys(fermeFamilleSets)) {
            effectifFamilleParFerme[ferme] = {};
            for (const f of Object.keys(fermeFamilleSets[ferme])) effectifFamilleParFerme[ferme][f] = fermeFamilleSets[ferme][f].size;
          }
          return { success: true, date: dateForCheck, operations: ops, effectifDistinct: globalSet.size, effectifParFamille, effectifDistinctParFerme, effectifFamilleParFerme };
        });
        return res.json(cached);
      }

      // ------ REFERENTIEL-TACHES-LIST: liste complète des opérations du référentiel ------
      if (action === 'referentiel-taches-list') {
        const ref = await loadReferentielTaches();
        return res.json({ success: true, operations: ref.ops.sort((a, b) => a.ordre - b.ordre) });
      }

      // ------ SUIVI-TUNNELS: hors-récolte progress by parcelle/tâche for caporal screens ------
      if (action === "suivi-tunnels") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const fermeParam = req.query.ferme;
        const cacheKey = `pointage_suivi_tunnels_${dateForCheck}_${fermeParam || 'all'}`;
        const cached = await withCache(cacheKey, 10 * 60 * 1000, async () => {
          if (USE_MIRROR) {
            const meta = await getPointageMeta();
            const earliestDate = meta?.availableDates?.[meta.availableDates.length - 1] || dateForCheck;
            const yesterdayStr = new Date(new Date(dateForCheck).getTime() - 86400000).toISOString().slice(0, 10);
            // Limit cumul range to 30 days max to avoid loading entire history
            const thirtyDaysAgo = new Date(new Date(dateForCheck).getTime() - 30 * 86400000).toISOString().slice(0, 10);
            const startDate = earliestDate > thirtyDaysAgo ? earliestDate : thirtyDaysAgo;
            const [todayRows, cumulRows] = await Promise.all([
              getPointageRowsForDate(dateForCheck),
              getPointageRowsForDateRange(startDate, yesterdayStr),
            ]);
            const filterHR = r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes";
            // Today groups
            const todayGroups = {};
            for (const r of todayRows.filter(filterHR)) {
              const key = `${r.Operation}|${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Variete}`;
              if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), quantiteRealisee: 0, totalHr: 0, totalJr: 0, totalCout: 0 };
              todayGroups[key].workers.add(r.Personnel_Matricule);
              todayGroups[key].quantiteRealisee += r.Quantite_unite || 0;
              todayGroups[key].totalHr += r.Nombre_Hr || 0;
              todayGroups[key].totalCout += r.Cout || 0;
            }
            // Cumul
            const cumulMap = {};
            for (const r of cumulRows.filter(filterHR)) {
              const key = `${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`;
              if (!cumulMap[key]) cumulMap[key] = { quantiteCumul: 0, joursCumul: 0 };
              cumulMap[key].quantiteCumul += r.Quantite_unite || 0;
              cumulMap[key].joursCumul += r.Nombre_Jr || 0;
            }
            const byFerme = {};
            for (const g of Object.values(todayGroups)) {
              const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
              if (fermeParam && ferme !== fermeParam) continue;
              if (!byFerme[ferme]) byFerme[ferme] = [];
              const parcelle = (g.Parcelle_Culturale || '').trim();
              const cumul = cumulMap[`${parcelle}_${g.Operation}`] || { quantiteCumul: 0 };
              byFerme[ferme].push({ parcelle, variete: g.Variete || parcelle, tache: g.Operation, nbOuvriers: g.workers.size, realiseAujourdhui: Math.round(g.quantiteRealisee), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + g.quantiteRealisee), heures: g.totalHr, cout: Math.round(g.totalCout), ferme });
            }
            return { success: true, date: dateForCheck, tunnels: byFerme };
          }

          // SQL fallback
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Operation, Parcelle_Culturale, Ref_parcelle, Variete, COUNT(DISTINCT Personnel_Matricule) AS nbOuvriers, SUM(Quantite_unite) AS quantiteRealisee, SUM(Nombre_Hr) AS totalHr, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != N'8. Récolte' AND Operation_Famille != N'11. Postes fixes' GROUP BY Operation, Parcelle_Culturale, Ref_parcelle, Variete ORDER BY Parcelle_Culturale, Operation`);
          const cumulResult = await db.request().query(`SELECT Operation, Parcelle_Culturale, Ref_parcelle, SUM(Quantite_unite) AS quantiteCumul, SUM(Nombre_Jr) AS joursCumul FROM BR_Pointage WHERE CONVERT(date, Periode_Date) < ${dateSQL} AND Operation_Famille != N'8. Récolte' AND Operation_Famille != N'11. Postes fixes' GROUP BY Operation, Parcelle_Culturale, Ref_parcelle`);
          const cumulMap = {};
          for (const r of cumulResult.recordset) { cumulMap[`${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`] = { quantiteCumul: r.quantiteCumul || 0, joursCumul: r.joursCumul || 0 }; }
          const byFerme = {};
          for (const r of result.recordset) {
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (fermeParam && ferme !== fermeParam) continue;
            if (!byFerme[ferme]) byFerme[ferme] = [];
            const parcelle = (r.Parcelle_Culturale || '').trim();
            const cumul = cumulMap[`${parcelle}_${r.Operation}`] || { quantiteCumul: 0 };
            byFerme[ferme].push({ parcelle, variete: r.Variete || parcelle, tache: r.Operation, nbOuvriers: r.nbOuvriers, realiseAujourdhui: Math.round(r.quantiteRealisee || 0), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + (r.quantiteRealisee || 0)), heures: r.totalHr, cout: Math.round(r.totalCout || 0), ferme });
          }
          return { success: true, date: dateForCheck, tunnels: byFerme };
        });
        return res.json(cached);
      }

      // ------ RECOLTE-EQUIPES: harvest per worker per day for team tracking ------
      if (action === "recolte-equipes") {
        // Calcul + cache via la fonction partagée (même logique serving + warm).
        // 3 quinzaines, enrichissement prod, garde-fou shouldCacheRecolteEquipes.
        // GATING PAIE : clé de cache + payload cloisonnés par ferme du chef
        // (_fermeFilter). 'all' → clé/comportement inchangés (RH/DG/Finance).
        const reCacheSuffix = _fermeFilter || 'all';
        const cached = await withCache(
          `pointage_recolte_equipes_${reCacheSuffix}`,
          5 * 60 * 1000,
          () => computeRecolteEquipesPayload(3, _fermeFilter),
          shouldCacheRecolteEquipes
        );
        return res.json(cached);
      }

      // ------ TRANSPORT: all workers per day for transport cost calculation ------
      if (action === "transport") {
        // Clé ferme-aware : les rows nominatives (matricule/nom) dépendent de _fermeFilter.
        const cached = await withCache(pointageCacheKey("pointage_transport", _fermeFilter), 0, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const periodeCampagne = (meta && meta.periodeCampagne) || {};
          // Only load current + previous periode (not ALL dates)
          const targetPeriodes = periodes.slice(0, 2);
          const allRows = [];
          for (const p of targetPeriodes) {
            const pRows = await getPointageRowsForPeriode(p);
            allRows.push(...pRows);
          }
          // Group by matricule+day+periode+operation+parcelle (include parcelle in key to preserve all parcelles)
          const groups = {};
          for (const r of allRows) {
            const key = `${r.Personnel_Matricule}|${r.DateStr}|${r.Periode_paie}|${r.Operation_Famille}|${r.Operation}|${r.Parcelle_Culturale||''}`;
            if (!groups[key]) groups[key] = { Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: r.DateStr, Periode_paie: r.Periode_paie, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale };
          }
          const rows = Object.values(groups).map(r => {
            const _ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            const _resolved = resolveVariete(r.Parcelle_Culturale, r.Ref_parcelle);
            // Décision métier : parcelle non identifiable sur F1/F5 → Framboise (cf. réaffectation Yasmin/Maravilla F5→F1)
            const _culture = (_resolved.culture && _resolved.culture !== 'Autre') ? _resolved.culture
              : (_ferme === 'Avocatier' || _ferme === 'BAHIA') ? 'Avocat' : 'Framboise';
            return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: r.DateStr, periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: _ferme, culture: _culture, parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim() };
          });
          const holidays = await getJoursFeries();
          const extras = computeChargCond(allRows, holidays);
          return { success: true, periodes, periodeCampagne, rows, ...extras };
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const result = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, Operation_Famille, Operation, MIN(Ref_parcelle) AS Ref_parcelle, MIN(Parcelle_Culturale) AS Parcelle_Culturale FROM BR_Pointage GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date), Periode_paie, Operation_Famille, Operation ORDER BY jour DESC`);
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Rows NOMINATIVES avec
        // ferme dérivée → cloisonnement sur la ferme du chef (fail-closed), cohérence
        // avec le chemin mirror shadowé. _fermeFilter null (RH/DG/Finance) → passthrough.
        const rows = filterByFermeField(result.recordset.map(r => {
          const _ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
          const _resolved = resolveVariete(r.Parcelle_Culturale, r.Ref_parcelle);
          const _culture = (_resolved.culture && _resolved.culture !== 'Autre') ? _resolved.culture
            : (_ferme === 'Avocatier' || _ferme === 'BAHIA') ? 'Avocat' : 'Framboise';
          return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: _ferme, culture: _culture, parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim() };
        }), _fermeFilter);
        return { success: true, periodes, rows };
        }); // end withCache
        return res.json(cached);
      }

      // ------ HEURES-SUP: durée travaillée + dépassement 8h30 par quinzaine ------
      if (action === "heures-sup") {
        // GATING PAIE : clé de cache + payload cloisonnés par ferme du chef.
        const hsCacheSuffix = _fermeFilter || 'all';
        const cached = await withCache(`pointage_heures_sup_${hsCacheSuffix}`, 0, async () => {
          const metaHS = await getPointageMeta();
          const excludedFonctions = await getExcludedFonctionsHS();
          return await buildHeuresSup(metaHS, excludedFonctions, _fermeFilter);
        });
        return res.json(cached);
      }

      // ------ DATES: available dates ------
      if (action === "dates") {
        if (USE_MIRROR) {
          const availDates = await getAvailableDates(30);
          // For each date, we need nbOuv — read from mirror docs
          const dates = [];
          for (let i = 0; i < availDates.length; i += 10) {
            const batch = availDates.slice(i, i + 10);
            const results = await Promise.all(batch.map(async d => {
              const rows = await getPointageRowsForDate(d);
              const workers = new Set(rows.map(r => r.Personnel_Matricule));
              return { date: d, nbOuv: workers.size };
            }));
            dates.push(...results);
          }
          return res.json({ success: true, dates });
        }
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Le chemin mirror compte
        // nbOuv via getPointageRowsForDate shadowé (déjà filtré ferme). Pour rester
        // cloisonnable, on ramène les couples DISTINCTS (jour, matricule, parcelle),
        // on filtre par la ferme du chef, puis on compte les matricules DISTINCTS par
        // jour en JS. _fermeFilter null (RH/DG/Finance) → passthrough (tous comptés).
        const result = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour, Personnel_Matricule, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE CONVERT(date, Periode_Date) >= DATEADD(day, -60, CONVERT(date, GETDATE()))`);
        const dateSets = {};
        for (const r of filterMirrorRowsByCulture(filterMirrorRowsByFerme(result.recordset, _fermeFilter), _cultureFilter)) {
          const key = new Date(r.jour).toISOString().slice(0, 10);
          if (!dateSets[key]) dateSets[key] = new Set();
          if (r.Personnel_Matricule) dateSets[key].add(r.Personnel_Matricule);
        }
        const dates = Object.entries(dateSets)
          .map(([date, workers]) => ({ date, nbOuv: workers.size }))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 30);
        return res.json({ success: true, dates });
      }

      // ------ NOUVEAUX OUVRIERS: new workers detected in current quinzaine ------
      if (action === "nouveaux-ouvriers") {
        // Clé ferme-aware : la liste nominative des nouveaux ouvriers dépend de
        // _fermeFilter. La période est toujours la quinzaine courante (meta.periodes[0]).
        const cached = await withCache(pointageCacheKey("pointage_nouveaux_ouvriers", _fermeFilter), 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const currentPeriode = meta?.periodes?.[0];
          if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
          const periodeDates = meta?.periodeMap?.[currentPeriode] || [];
          const qStart = periodeDates[0] || null;
          const qEnd = periodeDates[periodeDates.length - 1] || null;
          // Load only current + previous periode to find first appearances (not ALL dates)
          const targetPeriodes = (meta?.periodes || []).slice(0, 2);
          const firstAppearance = {}; // matricule → first date
          for (const p of targetPeriodes.reverse()) { // oldest first
            const pRows = await getPointageRowsForPeriode(p);
            for (const r of pRows) {
              const mat = (r.Personnel_Matricule || "").trim();
              if (!firstAppearance[mat]) firstAppearance[mat] = { date: r.DateStr, nom: (r.Personnel_Nom || "").trim(), Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille };
            }
          }
          // Filter workers whose first appearance >= qStart
          const today = new Date().toISOString().slice(0, 10);
          const byFarm = {}; const byDayMap = {};
          const workers = Object.entries(firstAppearance)
            .filter(([_, info]) => qStart && info.date >= qStart)
            .map(([mat, info]) => {
              const ferme = deriveFerme(info.Ref_parcelle, info.Parcelle_Culturale);
              byFarm[ferme] = (byFarm[ferme] || 0) + 1;
              byDayMap[info.date] = (byDayMap[info.date] || 0) + 1;
              return { matricule: mat, nom: info.nom, firstDate: info.date, ferme, equipe: mat.substring(0, 2), operationFamille: info.Operation_Famille || "" };
            })
            .sort((a, b) => b.firstDate.localeCompare(a.firstDate) || a.nom.localeCompare(b.nom));
          const totalToday = workers.filter(w => w.firstDate === today).length;
          const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
          return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
        }
        // SQL fallback
        const periodeRes = await db.request().query(`SELECT TOP 1 Periode_paie FROM BR_Pointage ORDER BY Periode_Date DESC`);
        const currentPeriode = (periodeRes.recordset[0] || {}).Periode_paie;
        if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
        const result = await db.request().query(`WITH QuinzaineBounds AS (SELECT MIN(CONVERT(date, Periode_Date)) AS q_start, MAX(CONVERT(date, Periode_Date)) AS q_end FROM BR_Pointage WHERE Periode_paie = N'${currentPeriode.replace(/'/g, "''")}'), WorkerFirst AS (SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, MIN(CONVERT(date, Periode_Date)) AS first_date FROM BR_Pointage GROUP BY Personnel_Matricule HAVING MIN(CONVERT(date, Periode_Date)) >= (SELECT q_start FROM QuinzaineBounds)), WorkerFirstDetail AS (SELECT w.Personnel_Matricule, w.Personnel_Nom, w.first_date, p.Ref_parcelle, p.Parcelle_Culturale, p.Operation_Famille FROM WorkerFirst w OUTER APPLY (SELECT TOP 1 Ref_parcelle, Parcelle_Culturale, Operation_Famille FROM BR_Pointage WHERE Personnel_Matricule = w.Personnel_Matricule AND CONVERT(date, Periode_Date) = w.first_date) p) SELECT *, (SELECT q_start FROM QuinzaineBounds) AS q_start, (SELECT q_end FROM QuinzaineBounds) AS q_end FROM WorkerFirstDetail ORDER BY first_date DESC, Personnel_Nom`);
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Chaque worker porte
        // Ref_parcelle/Parcelle_Culturale (première apparition) → ferme dérivable. On
        // filtre les LIGNES BRUTES par la ferme du chef AVANT agrégation (byFarm/byDay/
        // workers nominatifs). Fail-closed : ferme dérivée ≠ _fermeFilter → exclue.
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        // _cultureFilter non null (chef_f5) → filtre culture additionnel après ferme.
        const rows = filterMirrorRowsByCulture(filterMirrorRowsByFerme(result.recordset, _fermeFilter), _cultureFilter);
        const today = new Date().toISOString().slice(0, 10);
        const qStart = rows.length > 0 ? new Date(rows[0].q_start).toISOString().slice(0, 10) : null;
        const qEnd = rows.length > 0 ? new Date(rows[0].q_end).toISOString().slice(0, 10) : null;
        const byFarm = {}; const byDayMap = {};
        const workers = rows.map(r => { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); const fd = new Date(r.first_date).toISOString().slice(0, 10); byFarm[ferme] = (byFarm[ferme] || 0) + 1; byDayMap[fd] = (byDayMap[fd] || 0) + 1; return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), firstDate: fd, ferme, equipe: (r.Personnel_Matricule || "").trim().substring(0, 2), operationFamille: r.Operation_Famille || "" }; });
        const totalToday = workers.filter(w => w.firstDate === today).length;
        const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
        return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
        }); // end withCache
        return res.json(cached);
      }

      // ------ WORKER-DETAIL: full BEE ONE info for a worker ------
      if (action === "worker-detail") {
        const matricule = req.query.matricule;
        if (!matricule) return res.status(400).json({ success: false, error: "matricule required" });

        let rows;
        if (USE_MIRROR) {
          const mirrorRows = await getWorkerHistory(matricule);
          rows = mirrorRows.sort((a, b) => (b.DateStr || "").localeCompare(a.DateStr || ""));
          // Map to expected shape
          rows = rows.map(r => ({ Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Operation_Groupe: r.Operation_Groupe, Nombre_Jr: r.Nombre_Jr, Nombre_Hr: r.Nombre_Hr, Quantite_unite: r.Quantite_unite, Cout: r.Cout, Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Variete: r.Variete, Culture: r.Culture, Periode_paie: r.Periode_paie, jour: r.DateStr, HS_25: r.HS_25, HS_50: r.HS_50, HS_100: r.HS_100 }));
        } else {
          const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe, Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture, Periode_paie, CONVERT(date, Periode_Date) AS jour, HS_25, HS_50, HS_100, HS_NM FROM BR_Pointage WHERE Personnel_Matricule = N'${(matricule || '').replace(/'/g, "''")}' ORDER BY Periode_Date DESC`);
          // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). L'historique complet
          // d'un ouvrier peut couvrir plusieurs fermes. On ne garde que les LIGNES de la
          // ferme du chef (ferme dérivable via parcelle), comme le chemin mirror via
          // getWorkerHistory shadowé → si l'ouvrier n'a jamais pointé la ferme du chef,
          // rows vide → worker: null. _fermeFilter null (RH/DG/Finance) → passthrough.
          rows = filterMirrorRowsByFerme(result.recordset, _fermeFilter);
        }

        if (rows.length === 0) return res.json({ success: true, worker: null });
        const first = rows[rows.length - 1]; const last = rows[0];
        const totalJours = rows.reduce((s, r) => s + (r.Nombre_Jr || 0), 0);
        const totalHeures = rows.reduce((s, r) => s + (r.Nombre_Hr || 0), 0);
        const totalCout = rows.reduce((s, r) => s + (r.Cout || 0), 0);
        const totalQte = rows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
        const periodes = [...new Set(rows.map(r => r.Periode_paie))];
        const operations = [...new Set(rows.map(r => r.Operation_Famille).filter(Boolean))];
        const parcelles = [...new Set(rows.map(r => r.Ref_parcelle).filter(Boolean))];
        const jourStr = r => typeof r.jour === 'string' ? r.jour.slice(0, 10) : new Date(r.jour).toISOString().slice(0, 10);
        const jours = [...new Set(rows.map(r => jourStr(r)))].sort();
        return res.json({ success: true, worker: {
          matricule: (first.Personnel_Matricule || '').trim(), nom: (first.Personnel_Nom || '').trim(),
          premierJour: jourStr(first), dernierJour: jourStr(last),
          ferme: deriveFerme(first.Ref_parcelle, first.Parcelle_Culturale),
          equipe: (first.Personnel_Matricule || '').trim().substring(0, 2),
          totalJours: Math.round(totalJours * 10) / 10, totalHeures: Math.round(totalHeures * 10) / 10,
          totalCout: Math.round(totalCout), totalQuantite: Math.round(totalQte * 10) / 10,
          nbPeriodes: periodes.length, periodes, operations, parcelles, nbJoursDistincts: jours.length,
          historique: rows.slice(0, 30).map(r => ({ jour: jourStr(r), periode: r.Periode_paie, operation: r.Operation_Famille, operationDetail: r.Operation, parcelle: r.Ref_parcelle, culture: r.Culture, variete: r.Variete, heures: r.Nombre_Hr, jours: r.Nombre_Jr, quantite: r.Quantite_unite, cout: r.Cout })),
        }});
      }

      // ------ QUINZAINE-REPOS: average rest days per team per quinzaine ------
      if (action === "quinzaine-repos") {
        const periodeParamR = req.query.periode;
        // Clé ferme-aware : les équipes/ouvriers nominatifs dépendent de _fermeFilter.
        const cacheKeyR = pointageCacheKey(`pointage_quinzaine_repos_${periodeParamR || "latest"}`, _fermeFilter);
        const cachedR = await withCache(cacheKeyR, 5 * 60 * 1000, async () => {
        let periodes, selectedPeriode, quinzaineDates, rawRows;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          selectedPeriode = periodeParamR || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
          quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
          rawRows = await getPointageRowsForPeriode(selectedPeriode);
          // If mirror has no data, check archive
          if (rawRows.length === 0 && quinzaineDates.length === 0) {
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().reposData) {
              const rd = archiveDoc.data().reposData;
              quinzaineDates = rd.quinzaineDates;
              rawRows = [];
              // GATING PAIE (chef) : reposData.workers = matricule+nom TOUTES fermes,
              // NOMINATIF, sans champ ferme ni parcelle exploitable. L'archive ne conserve
              // AUCUNE source ferme pour restreindre ces workers (contrairement au mirror).
              // DÉCISION fail-closed (zéro fuite nominative) : un chef ne voit PAS le
              // nominatif repos cross-ferme d'une période archivée → workers vidé.
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              for (const w of filterReposWorkersArchived(rd.workers, _fermeFilter)) {
                for (const d of w.joursPresent) {
                  rawRows.push({ Personnel_Matricule: w.matricule, Personnel_Nom: w.nom, DateStr: d });
                }
              }
            }
          }
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          selectedPeriode = periodeParamR || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10));
          const workersRes = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date) ORDER BY Personnel_Matricule`);
          // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Cette requête N'inclut
          // PAS de parcelle/refParcelle → la ferme n'est PAS dérivable pour ces lignes
          // repos nominatives. DÉCISION fail-closed (zéro fuite nominative), cohérente
          // avec filterReposWorkersArchived : un chef ne voit PAS le nominatif repos
          // cross-ferme (rawRows vidé). _fermeFilter null (RH/DG/Finance) → passthrough.
          rawRows = _fermeFilter
            ? []
            : workersRes.recordset.map(r => ({ Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: new Date(r.jour).toISOString().slice(0, 10) }));
        }
        const nbJoursQuinzaine = quinzaineDates.length;
        const equipeMap = {};
        for (const row of rawRows) {
          const mat = (row.Personnel_Matricule || '').trim();
          const prefix = mat.substring(0, 2).toUpperCase();
          const jour = row.DateStr || new Date(row.jour).toISOString().slice(0, 10);
          if (!equipeMap[prefix]) equipeMap[prefix] = {};
          if (!equipeMap[prefix][mat]) equipeMap[prefix][mat] = { matricule: mat, nom: (row.Personnel_Nom || '').trim(), joursPresent: new Set() };
          equipeMap[prefix][mat].joursPresent.add(jour);
        }
        const equipes = Object.entries(equipeMap).map(([prefix, workers]) => {
          const workerList = Object.values(workers).map(w => { const nbPresent = w.joursPresent.size; const nbRepos = nbJoursQuinzaine - nbPresent; return { matricule: w.matricule, nom: w.nom, nbPresent, nbRepos, nbJoursQuinzaine }; });
          const totalRepos = workerList.reduce((s, w) => s + w.nbRepos, 0);
          const moyRepos = workerList.length > 0 ? Math.round((totalRepos / workerList.length) * 10) / 10 : 0;
          return { prefix, nbOuvriers: workerList.length, moyRepos, nbJoursQuinzaine, workers: workerList.sort((a, b) => b.nbRepos - a.nbRepos) };
        }).sort((a, b) => a.prefix.localeCompare(b.prefix));
        return { success: true, periode: selectedPeriode, periodes, nbJoursQuinzaine, quinzaineDates, equipes };
        }); // end withCache
        return res.json(cachedR);
      }

      // ------ QUINZAINE-ALERTES: teams absent 5+ consecutive days ------
      if (action === "quinzaine-alertes") {
        const periodeParamA = req.query.periode;
        // Clé ferme-aware : les alertes d'équipe dépendent des lignes filtrées par _fermeFilter.
        const cacheKeyA = pointageCacheKey(`pointage_quinzaine_alertes_${periodeParamA || "latest"}`, _fermeFilter);
        const cachedA = await withCache(cacheKeyA, 5 * 60 * 1000, async () => {
        let periodes, selectedPeriode, quinzaineDates, presenceMap;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          selectedPeriode = periodeParamA || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
          quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
          const rawRows = await getPointageRowsForPeriode(selectedPeriode);
          if (rawRows.length > 0) {
            presenceMap = {};
            for (const r of rawRows) {
              const prefix = (r.Personnel_Matricule || '').trim().substring(0, 2).toUpperCase();
              if (!presenceMap[prefix]) presenceMap[prefix] = new Set();
              presenceMap[prefix].add(r.DateStr);
            }
          } else {
            // Check Firestore archive
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().alertesData) {
              const ad = archiveDoc.data().alertesData;
              quinzaineDates = ad.quinzaineDates;
              presenceMap = {};
              // GATING PAIE (chef) : presenceByPrefix est keyé par préfixe d'équipe
              // (2 premiers caractères du matricule). Un préfixe d'équipe n'est PAS
              // cloisonné par ferme et AUCUN mapping préfixe→ferme n'existe côté serveur
              // (le mirror dérive la ferme via la PARCELLE, absente de l'archive alertes).
              // Un préfixe peut donc révéler l'activité d'une équipe d'une autre ferme.
              // DÉCISION fail-closed : pour un chef, on n'expose PAS les alertes d'équipe
              // d'une période archivée (presenceMap vidé → aucune alerte).
              // _fermeFilter null (RH/DG/Finance) → tous les préfixes (inchangé).
              if (!_fermeFilter) {
                for (const [prefix, days] of Object.entries(ad.presenceByPrefix)) {
                  presenceMap[prefix] = new Set(days);
                }
              }
            } else {
              presenceMap = {};
            }
          }
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          selectedPeriode = periodeParamA || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10)).sort();
          const presenceRes = await db.request().query(`SELECT SUBSTRING(LTRIM(Personnel_Matricule), 1, 2) AS equipe_prefix, CONVERT(date, Periode_Date) AS jour, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' GROUP BY SUBSTRING(LTRIM(Personnel_Matricule), 1, 2), CONVERT(date, Periode_Date)`);
          presenceMap = {};
          // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). Les alertes sont keyées
          // par préfixe d'équipe (2 premiers car. du matricule) ; AUCUN mapping
          // préfixe→ferme n'existe (la ferme se dérive via la parcelle, absente ici).
          // DÉCISION fail-closed, cohérente avec le chemin archive : un chef ne voit PAS
          // les alertes d'équipe cross-ferme (presenceMap vidé → aucune alerte).
          // _fermeFilter null (RH/DG/Finance) → tous les préfixes (inchangé).
          if (!_fermeFilter) {
            for (const row of presenceRes.recordset) { const prefix = (row.equipe_prefix || '').toUpperCase(); if (!presenceMap[prefix]) presenceMap[prefix] = new Set(); presenceMap[prefix].add(new Date(row.jour).toISOString().slice(0, 10)); }
          }
        }
        // Find consecutive absent streaks >= 5 days
        const alertes = [];
        Object.entries(presenceMap).forEach(([prefix, presentDays]) => {
          let streak = 0, streakStart = null;
          for (let i = 0; i < quinzaineDates.length; i++) {
            const d = quinzaineDates[i];
            if (!presentDays.has(d)) { if (streak === 0) streakStart = d; streak++; }
            else { if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[i - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[i - 1]})` }); streak = 0; streakStart = null; }
          }
          if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[quinzaineDates.length - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[quinzaineDates.length - 1]})` });
        });
        alertes.sort((a, b) => b.joursAbsents - a.joursAbsents);
        return { success: true, periode: selectedPeriode, periodes, quinzaineDates, alertes };
        }); // end withCache
        return res.json(cachedA);
      }

      // ------ MO-ANALYTIQUE-VARIETE: labor cost breakdown by variety across all quinzaines ------
      if (action === "mo-analytique-variete") {
        // Clé ferme-aware : les rows (jh/cout par parcelle) dépendent de _fermeFilter
        // via le shadow de getPointageRowsForPeriode.
        const cached = await withCache(pointageCacheKey("mo_analytique_variete", _fermeFilter), 30 * 60 * 1000, async () => {
          const meta = await getPointageMeta();
          const allPeriodes = meta?.allPeriodes || [];
          const mirrorPeriodes = meta?.periodes || [];

          // Accumulate analytique rows from all quinzaines (parallel reads)
          const allRows = [];

          // Split: mirror vs archived
          const mirrorPeriodesList = allPeriodes.filter(p => mirrorPeriodes.includes(p) && meta?.periodeMap?.[p]);
          const archivedPeriodesList = allPeriodes.filter(p => !mirrorPeriodes.includes(p) || !meta?.periodeMap?.[p]);

          // Read all archives in parallel
          const [mirrorResults, archiveDocs] = await Promise.all([
            Promise.all(mirrorPeriodesList.map(async (periode) => {
              const rawRows = await getPointageRowsForPeriode(periode);
              const groups = {};
              for (const r of rawRows) {
                const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}`;
                if (!groups[key]) groups[key] = { parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), operationFamille: r.Operation_Famille, jh: 0, cout: 0 };
                groups[key].jh += r.Nombre_Jr || 0;
                groups[key].cout += r.Cout || 0;
              }
              return { periode, groups: Object.values(groups) };
            })),
            Promise.all(archivedPeriodesList.map(async (periode) => {
              const doc = await db_firestore.collection("quinzaine_archive").doc(periode).get();
              return { periode, data: doc.exists ? doc.data().analytique : null };
            })),
          ]);

          for (const { periode, groups } of mirrorResults) {
            for (const g of groups) {
              allRows.push({ parcelle: g.parcelle, refParcelle: g.refParcelle, operationFamille: g.operationFamille, jh: g.jh, cout: g.cout, periode });
            }
          }
          for (const { periode, data } of archiveDocs) {
            if (data) {
              // GATING PAIE (chef) : le chemin archivé pousse toutes les fermes. Les
              // lignes archivées portent parcelle/refParcelle → ferme dérivable, donc
              // cloisonnable. Fail-closed : ferme dérivée ≠ _fermeFilter → exclue.
              // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
              for (const row of filterArchivedRowsByFerme(data, _fermeFilter)) {
                allRows.push({ parcelle: row.parcelle, refParcelle: row.refParcelle, operationFamille: row.operationFamille, jh: row.jh, cout: row.cout, periode });
              }
            }
          }

          // Aggregate by variete
          const byVariete = {};
          const byQuinzaine = {};
          for (const row of allRows) {
            const resolved = resolveVariete(row.parcelle, row.refParcelle);
            const key = `${resolved.variete}|${resolved.ferme}`;
            const type = classifyType(row.operationFamille);

            if (!byVariete[key]) {
              byVariete[key] = {
                variete: resolved.variete, culture: resolved.culture, ferme: resolved.ferme,
                recolte: { jh: 0, cout: 0 }, horsRecolte: { jh: 0, cout: 0 }, postesFixes: { jh: 0, cout: 0 },
                total: { jh: 0, cout: 0 }, horsRecolteDetail: {},
              };
            }
            byVariete[key][type].jh += row.jh || 0;
            byVariete[key][type].cout += row.cout || 0;
            byVariete[key].total.jh += row.jh || 0;
            byVariete[key].total.cout += row.cout || 0;

            // Accumulate horsRecolte breakdown by operation family
            if (type === 'horsRecolte') {
              const opFam = row.operationFamille || 'Autre';
              if (!byVariete[key].horsRecolteDetail[opFam]) byVariete[key].horsRecolteDetail[opFam] = { jh: 0, cout: 0 };
              byVariete[key].horsRecolteDetail[opFam].jh += row.jh || 0;
              byVariete[key].horsRecolteDetail[opFam].cout += row.cout || 0;
            }

            // Par quinzaine
            if (!byQuinzaine[row.periode]) byQuinzaine[row.periode] = {};
            if (!byQuinzaine[row.periode][resolved.variete]) byQuinzaine[row.periode][resolved.variete] = 0;
            byQuinzaine[row.periode][resolved.variete] += row.cout || 0;
          }

          const parVariete = Object.values(byVariete)
            .map(v => {
              const hrDetail = {};
              for (const [op, val] of Object.entries(v.horsRecolteDetail || {})) {
                hrDetail[op] = { jh: Math.round(val.jh * 100) / 100, cout: Math.round(val.cout) };
              }
              return { ...v, recolte: { jh: Math.round(v.recolte.jh * 100) / 100, cout: Math.round(v.recolte.cout) }, horsRecolte: { jh: Math.round(v.horsRecolte.jh * 100) / 100, cout: Math.round(v.horsRecolte.cout) }, postesFixes: { jh: Math.round(v.postesFixes.jh * 100) / 100, cout: Math.round(v.postesFixes.cout) }, total: { jh: Math.round(v.total.jh * 100) / 100, cout: Math.round(v.total.cout) }, horsRecolteDetail: hrDetail };
            })
            .sort((a, b) => b.total.cout - a.total.cout);

          const totaux = parVariete.reduce((acc, v) => ({
            recolte: acc.recolte + v.recolte.cout, horsRecolte: acc.horsRecolte + v.horsRecolte.cout,
            postesFixes: acc.postesFixes + v.postesFixes.cout, total: acc.total + v.total.cout,
          }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0 });

          const parQuinzaine = allPeriodes.slice().reverse().map(p => ({
            periode: p, parVariete: byQuinzaine[p] || {},
          }));

          const periodeCampagne = (meta && meta.periodeCampagne) || {};
          return { success: true, parVariete, parQuinzaine, totaux, periodes: allPeriodes, periodeCampagne };
        });
        return res.json(cached);
      }

      // ------ CAMPAGNE-MO-VARIETE: cumulative labor cost by variety for current fiscal year (Jul→Jun) ------
      if (action === "campagne-mo-variete") {
        const today = new Date();
        const y = today.getFullYear();
        const startYear = today.getMonth() >= 6 ? y : y - 1;
        const campagne = {
          start: `${startYear}-07-01`,
          end: `${startYear + 1}-06-30`,
          label: `${startYear}-${startYear + 1} (Jul-Jun)`,
        };

        const cycle1End = `${startYear}-12-31`;
        const cycle2Start = `${startYear + 1}-01-01`;

        // Clé ferme-aware : les rows (jh/cout par parcelle) dépendent de _fermeFilter
        // via le shadow de getPointageRowsForDate/Periode.
        const cached = await withCache(pointageCacheKey(`campagne_mo_variete_v4_${campagne.start}`, _fermeFilter), 30 * 60 * 1000, async () => {
          const meta = await getPointageMeta();
          const allPeriodes = meta?.allPeriodes || [];
          const mirrorPeriodes = meta?.periodes || [];

          const mirrorPeriodesList = allPeriodes.filter(p => mirrorPeriodes.includes(p) && meta?.periodeMap?.[p]);
          const archivedPeriodesList = allPeriodes.filter(p => !mirrorPeriodes.includes(p) || !meta?.periodeMap?.[p]);

          // segments: each row tagged with cycle1Weight / cycle2Weight / annuelWeight
          // mirror rows: weight = 1 for the cycle the date belongs to, 0 for the other; 1 for annuel
          // archive rows: prorated by fraction of dates in each cycle within campagne range
          const taggedRows = []; // { parcelle, refParcelle, operationFamille, jh, cout, w1, w2, wA }

          // 1. Mirror periodes
          const mirrorResults = await Promise.all(mirrorPeriodesList.map(async (periode) => {
            const dates = (meta.periodeMap[periode] || []).filter(d => d >= campagne.start && d <= campagne.end);
            const out = [];
            for (let i = 0; i < dates.length; i += 10) {
              const batch = dates.slice(i, i + 10);
              const batchResults = await Promise.all(batch.map(d => getPointageRowsForDate(d).then(rows => ({ d, rows }))));
              for (const { d, rows: rawRows } of batchResults) {
                const inCycle1 = d <= cycle1End ? 1 : 0;
                const inCycle2 = d >= cycle2Start ? 1 : 0;
                // group per-date to reduce row count
                const groups = {};
                for (const r of rawRows) {
                  const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}`;
                  if (!groups[key]) groups[key] = { parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), operationFamille: r.Operation_Famille, jh: 0, cout: 0 };
                  groups[key].jh += r.Nombre_Jr || 0;
                  groups[key].cout += r.Cout || 0;
                }
                for (const g of Object.values(groups)) {
                  out.push({ ...g, w1: inCycle1, w2: inCycle2, wA: 1 });
                }
              }
            }
            return out;
          }));
          for (const arr of mirrorResults) for (const r of arr) taggedRows.push(r);

          // 2. Archive periodes — prorate per cycle
          const archiveDocs = await Promise.all(archivedPeriodesList.map(async (periode) => {
            const doc = await db_firestore.collection("quinzaine_archive").doc(periode).get();
            if (!doc.exists) return null;
            const d = doc.data();
            const analytique = d.analytique;
            if (!analytique) return null;
            const allDates = (d.reposData && d.reposData.quinzaineDates) || (d.alertesData && d.alertesData.quinzaineDates) || (meta?.periodeMap?.[periode]) || [];
            const datesInCampagne = allDates.filter(dt => dt >= campagne.start && dt <= campagne.end);
            const datesInCycle1 = datesInCampagne.filter(dt => dt <= cycle1End);
            const datesInCycle2 = datesInCampagne.filter(dt => dt >= cycle2Start);
            const total = allDates.length || datesInCampagne.length || 1;
            const fA = datesInCampagne.length / total;
            const f1 = datesInCycle1.length / total;
            const f2 = datesInCycle2.length / total;
            if (fA === 0) return null;
            return { f1, f2, fA, analytique };
          }));
          for (const result of archiveDocs) {
            if (!result) continue;
            // GATING PAIE (chef) : même cloisonnement fail-closed que mo-analytique-variete
            // sur le chemin archivé (ferme dérivée via parcelle/refParcelle).
            // _fermeFilter null (RH/DG/Finance) → passthrough (inchangé).
            for (const row of filterArchivedRowsByFerme(result.analytique, _fermeFilter)) {
              taggedRows.push({
                parcelle: row.parcelle,
                refParcelle: row.refParcelle,
                operationFamille: row.operationFamille,
                jh: row.jh || 0,
                cout: row.cout || 0,
                w1: result.f1,
                w2: result.f2,
                wA: result.fA,
              });
            }
          }

          // 3. Aggregate per segment per variete
          function emptyBucket(resolved) {
            return {
              variete: resolved.variete, culture: resolved.culture, ferme: resolved.ferme,
              recolte: { jh: 0, cout: 0 }, horsRecolte: { jh: 0, cout: 0 }, postesFixes: { jh: 0, cout: 0 },
              total: { jh: 0, cout: 0 }, kgRecolte: 0,
            };
          }
          const seg = { cycle1: {}, cycle2: {}, annuel: {} };
          for (const row of taggedRows) {
            const resolved = resolveVariete(row.parcelle, row.refParcelle);
            const key = `${resolved.variete}|${resolved.ferme}`;
            const type = classifyType(row.operationFamille);
            for (const [segName, w] of [['cycle1', row.w1], ['cycle2', row.w2], ['annuel', row.wA]]) {
              if (!w) continue;
              if (!seg[segName][key]) seg[segName][key] = emptyBucket(resolved);
              const b = seg[segName][key];
              const jhW = row.jh * w;
              const coutW = row.cout * w;
              b[type].jh += jhW;
              b[type].cout += coutW;
              b.total.jh += jhW;
              b.total.cout += coutW;
            }
          }

          // 4. Kg récolté par variété (from prod_tracabilite_recolte) per segment
          //    Doc IDs are YYYY-MM-DD. Query the campagne range.
          const prodSnap = await db_firestore.collection("prod_tracabilite_recolte")
            .where(admin.firestore.FieldPath.documentId(), ">=", campagne.start)
            .where(admin.firestore.FieldPath.documentId(), "<=", campagne.end)
            .get();
          for (const docSnap of prodSnap.docs) {
            const dateStr = docSnap.id;
            const inCycle1 = dateStr <= cycle1End;
            const inCycle2 = dateStr >= cycle2Start;
            // GATING PAIE (fail-closed) : prod_tracabilite_recolte agrège TOUTES les
            // fermes → pour un chef, on ne garde que les lignes prod de sa ferme, sinon
            // des buckets (variété|ferme) d'autres fermes gonfleraient kgRecolte/totaux.
            // _fermeFilter null (RH/DG/Finance) → passthrough STRICT (inchangé).
            const rows = filterProdRowsByFerme(docSnap.data().rows || [], _fermeFilter);
            for (const r of rows) {
              const resolved = resolveVariete(r.variete || r.parcelle || '', r.refParcelle || '');
              const key = `${resolved.variete}|${resolved.ferme}`;
              const kg = r.totalKg || 0;
              if (!seg.annuel[key]) seg.annuel[key] = emptyBucket(resolved);
              seg.annuel[key].kgRecolte += kg;
              if (inCycle1) {
                if (!seg.cycle1[key]) seg.cycle1[key] = emptyBucket(resolved);
                seg.cycle1[key].kgRecolte += kg;
              }
              if (inCycle2) {
                if (!seg.cycle2[key]) seg.cycle2[key] = emptyBucket(resolved);
                seg.cycle2[key].kgRecolte += kg;
              }
            }
          }

          function finalizeSegment(byVariete) {
            const parVariete = Object.values(byVariete).map(v => ({
              ...v,
              recolte: { jh: Math.round(v.recolte.jh * 100) / 100, cout: Math.round(v.recolte.cout) },
              horsRecolte: { jh: Math.round(v.horsRecolte.jh * 100) / 100, cout: Math.round(v.horsRecolte.cout) },
              postesFixes: { jh: Math.round(v.postesFixes.jh * 100) / 100, cout: Math.round(v.postesFixes.cout) },
              total: { jh: Math.round(v.total.jh * 100) / 100, cout: Math.round(v.total.cout) },
              kgRecolte: Math.round(v.kgRecolte),
            })).sort((a, b) => b.total.cout - a.total.cout);
            const totaux = parVariete.reduce((acc, v) => ({
              recolte: acc.recolte + v.recolte.cout, horsRecolte: acc.horsRecolte + v.horsRecolte.cout,
              postesFixes: acc.postesFixes + v.postesFixes.cout, total: acc.total + v.total.cout,
              kgRecolte: acc.kgRecolte + v.kgRecolte,
            }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0, kgRecolte: 0 });
            return { parVariete, totaux };
          }

          const result = {
            success: true,
            campagne,
            cycle1: { ...finalizeSegment(seg.cycle1), start: campagne.start, end: cycle1End, label: `Cycle 1 (Juil ${startYear} → Déc ${startYear})` },
            cycle2: { ...finalizeSegment(seg.cycle2), start: cycle2Start, end: campagne.end, label: `Cycle 2 (Jan ${startYear + 1} → Juin ${startYear + 1})` },
            annuel: { ...finalizeSegment(seg.annuel), start: campagne.start, end: campagne.end, label: `Cumul annuel ${campagne.label}` },
          };
          // Back-compat with v1 shape (parVariete + totaux at root = annuel)
          result.parVariete = result.annuel.parVariete;
          result.totaux = result.annuel.totaux;
          return result;
        });
        return res.json(cached);
      }

      // ------ CAMPAGNE-ANALYTIQUE-DETAIL : granularité parcelle × quinzaine × opération ------
      // Aggrège les données du miroir Firestore en gardant la granularité fine.
      // Utilisé par CampagneAnalytiqueTab (Vue "Affectation par Ha" + "Par Variété").
      // NE modifie PAS campagne-mo-variete.
      if (action === "campagne-analytique-detail") {
        const today = new Date();
        const y = today.getFullYear();
        const startYear = today.getMonth() >= 6 ? y : y - 1;
        const campagne = {
          start: `${startYear}-07-01`,
          end: `${startYear + 1}-06-30`,
          label: `${startYear}/${startYear + 1}`,
        };

        await warmRefTaches();

        const cached = await withCache(
          pointageCacheKey(`campagne_analytique_detail_v1_${campagne.start}`, _fermeFilter),
          30 * 60 * 1000,
          async () => {
            const meta = await getPointageMeta();
            const allPeriodes = (meta?.allPeriodes || []).filter(p => {
              const dates = (meta?.periodeMap?.[p] || []);
              return dates.some(d => d >= campagne.start && d <= campagne.end);
            });

            // Lire toutes les rows miroir de la campagne — granularité parcelle×quinzaine×opération
            const rows = [];

            for (const periode of allPeriodes) {
              const dates = (meta?.periodeMap?.[periode] || []).filter(d => d >= campagne.start && d <= campagne.end);
              for (let i = 0; i < dates.length; i += 10) {
                const batch = dates.slice(i, i + 10);
                const batchResults = await Promise.all(batch.map(d => getPointageRowsForDate(d)));
                for (const dayRows of batchResults) {
                  // Grouper par (parcelle, periode, operation, groupe) pour réduire le volume
                  const groups = {};
                  for (const r of dayRows) {
                    const famille = resolveFamily(r.Operation_Groupe, r.Operation_Famille);
                    const key = `${(r.Parcelle_Culturale || '').trim()}|${(r.Ref_parcelle || '').trim()}|${periode}|${(r.Operation || '').trim()}|${(r.Operation_Groupe || '').trim()}`;
                    if (!groups[key]) groups[key] = {
                      parcelle: (r.Parcelle_Culturale || '').trim(),
                      refParcelle: (r.Ref_parcelle || '').trim(),
                      ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
                      periode,
                      operation: (r.Operation || '').trim(),
                      groupe: (_refMap[r.Operation_Groupe] || {}).groupe || '',
                      famille,
                      code: (r.Operation_Groupe || '').trim(),
                      jh: 0,
                      cout: 0,
                    };
                    groups[key].jh += r.Nombre_Jr || 0;
                    groups[key].cout += r.Cout || 0;
                  }
                  for (const g of Object.values(groups)) rows.push(g);
                }
              }
            }

            // Enrichir avec Ha depuis sb_parcelle_referentiel
            const refSnap = await db_firestore.collection('sb_parcelle_referentiel').get();
            const haByRef = {};
            refSnap.forEach(doc => {
              const d = doc.data();
              if (d.label_bee_one && d.ha) haByRef[d.label_bee_one.trim().toUpperCase()] = d.ha;
            });

            // Liste triée des périodes présentes
            const periodeSet = new Set(rows.map(r => r.periode));
            const periodes = [...periodeSet].sort();

            // Liste des familles depuis référentiel complet
            const refData = await loadReferentielTaches();
            const famillesOrdered = [...new Set(refData.ops.map(o => o.famille))];

            return {
              success: true,
              campagne: campagne.label,
              periodes,
              famillesOrdered,
              haByRef,
              rows: rows.filter(r => r.jh > 0 || r.cout > 0),
            };
          }
        );
        return res.json(cached);
      }

      // ------ CAMPAGNE-CONSO-PARCELLE : consommation Engrais+Pesticides par parcelle ------
      // Lit sql_mirror_consommation, agrège par parcelle × article, enrichit avec Ha.
      // Note: les lignes miroir n'ont pas de champ Cout — seules les quantités sont disponibles.
      if (action === "campagne-conso-parcelle") {
        const today = new Date();
        const y = today.getFullYear();
        const startYear = today.getMonth() >= 6 ? y : y - 1;
        const campagne = {
          start: `${startYear}-07-01`,
          end: `${startYear + 1}-06-30`,
          label: `${startYear}/${startYear + 1}`,
        };

        const cached = await withCache(
          pointageCacheKey(`campagne_conso_parcelle_v1_${campagne.start}`, _fermeFilter),
          30 * 60 * 1000,
          async () => {
            // Lire toutes les lignes conso de la collection miroir (toutes catégories)
            const allRows = await getConsommationRows({});

            // Filtrer sur la campagne (champ Date : YYYY-MM-DD)
            const campagneRows = allRows.filter(r => r.Date >= campagne.start && r.Date <= campagne.end);

            // Enrichir avec Ha depuis sb_parcelle_referentiel
            const refSnap = await db_firestore.collection('sb_parcelle_referentiel').get();
            const haByRef = {};
            refSnap.forEach(doc => {
              const d = doc.data();
              if (d.label_bee_one && d.ha) haByRef[d.label_bee_one.trim().toUpperCase()] = d.ha;
            });

            // Grouper par parcelle
            const byParcelle = {};
            for (const r of campagneRows) {
              const parcelle = (r.Parcelle_Culturale || '').trim();
              if (!parcelle) continue;
              // Dériver la ferme : les lignes conso ont un champ Ferme (ex. 'F1', 'F5', 'BAHIA')
              // On s'appuie sur deriveFerme via Parcelle_Culturale comme fallback
              const ferme = deriveFerme(null, parcelle);
              if (!byParcelle[parcelle]) {
                const haKey = parcelle.toUpperCase();
                byParcelle[parcelle] = {
                  parcelle,
                  ferme,
                  ha: haByRef[haKey] || 0,
                  engraisMap: {},
                  pesticidesMap: {},
                };
              }
              const art = (r.Article || '').trim();
              const cat = (r.Article_Categorie || '').trim();
              const qty = r.Quantite || 0;
              const unite = (r.Article_unite || '').trim();
              if (cat === 'Engrais') {
                if (!byParcelle[parcelle].engraisMap[art]) {
                  byParcelle[parcelle].engraisMap[art] = { article: art, qty: 0, unite, coutTotal: 0 };
                }
                byParcelle[parcelle].engraisMap[art].qty += qty;
              } else if (cat === 'Pesticides') {
                if (!byParcelle[parcelle].pesticidesMap[art]) {
                  byParcelle[parcelle].pesticidesMap[art] = { article: art, qty: 0, unite, coutTotal: 0 };
                }
                byParcelle[parcelle].pesticidesMap[art].qty += qty;
              }
            }

            const parcelles = Object.values(byParcelle)
              .map(p => {
                const engrais = Object.values(p.engraisMap).sort((a, b) => a.article.localeCompare(b.article));
                const pesticides = Object.values(p.pesticidesMap).sort((a, b) => a.article.localeCompare(b.article));
                return {
                  parcelle: p.parcelle,
                  ferme: p.ferme,
                  ha: p.ha,
                  engrais,
                  pesticides,
                  totalEngraisCout: 0,
                  totalPesticidesCout: 0,
                };
              })
              .filter(p => p.engrais.length > 0 || p.pesticides.length > 0)
              .sort((a, b) => a.parcelle.localeCompare(b.parcelle));

            return {
              success: true,
              campagne: campagne.label,
              parcelles,
            };
          }
        );
        return res.json(cached);
      }

      // ------ UPLOAD-TIMES: when was pointage uploaded to SQL per farm ------
      if (action === "upload-times") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        if (USE_MIRROR) {
          const [rows, syncStatus] = await Promise.all([getPointageRowsForDate(dateForCheck), getSyncStatus()]);
          const farmData = { F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
          for (const r of rows) { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); if (farmData[ferme]) farmData[ferme].add(r.Personnel_Matricule); }
          const uploads = Object.entries(farmData).map(([ferme, workers]) => ({ ferme, nbOuv: workers.size }));
          const lastSync = syncStatus?.lastSuccessAt;
          const lastTableWrite = lastSync ? (lastSync.toDate ? lastSync.toDate().toISOString() : new Date(lastSync).toISOString()) : null;
          return res.json({ success: true, date: dateForCheck, lastTableWrite, uploads });
        }
        const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
        const statsRes = await db.request().query(`SELECT MAX(last_user_update) AS lastWrite FROM sys.dm_db_index_usage_stats WHERE database_id = DB_ID() AND object_id = OBJECT_ID('BR_Pointage')`);
        const lastTableWrite = statsRes.recordset[0]?.lastWrite || null;
        // nbOuv par ferme = matricules DISTINCTS. La ferme est dérivée en JS (pas une
        // colonne SQL) → on ramène les couples DISTINCTS (matricule, parcelle) et on
        // déduplique via un Set par ferme. Auparavant on sommait des COUNT(DISTINCT) par
        // parcelle → un ouvrier multi-parcelles était compté N fois. Mirroir du chemin MIRROR.
        const result = await db.request().query(`SELECT DISTINCT Personnel_Matricule, Ref_parcelle, Parcelle_Culturale FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL}`);
        const farmData = { F1: new Set(), F5: new Set(), Avocatier: new Set(), BAHIA: new Set() };
        // GATING PAIE (chef) : fallback SQL (USE_MIRROR=false). On filtre les lignes brutes
        // par la ferme du chef AVANT de peupler farmData → un chef ne voit que le nbOuv de
        // sa ferme (autres fermes = 0), comme le chemin mirror shadowé (fail-closed).
        // _fermeFilter null (RH/DG/Finance) → passthrough strict (inchangé).
        for (const row of filterMirrorRowsByCulture(filterMirrorRowsByFerme(result.recordset, _fermeFilter), _cultureFilter)) { const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale); if (farmData[ferme]) farmData[ferme].add(row.Personnel_Matricule); }
        const uploads = Object.entries(farmData).map(([ferme, workers]) => ({ ferme, nbOuv: workers.size }));
        return res.json({ success: true, date: dateForCheck, lastTableWrite: lastTableWrite ? new Date(lastTableWrite).toISOString() : null, uploads });
      }

      // ------ POSTES-FIXES: postes fixes detail for a date ------
      if (action === "postes-fixes") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        let rows;
        if (USE_MIRROR) {
          rows = await fetchPostesFixesFromMirror(dateForCheck, _fermeFilter);
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation, Ref_parcelle, Parcelle_Culturale, Nombre_Jr, Nombre_Hr, Cout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'11. Postes fixes' ORDER BY Ref_parcelle, Operation, Personnel_Nom`);
          rows = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || '').trim(), nom: (r.Personnel_Nom || '').trim(), operation: r.Operation, parcelle: (r.Parcelle_Culturale || '').trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), jours: r.Nombre_Jr, heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0) }));
          // GATING PAIE : chef → cloisonnement sur la ferme dérivée (fail-closed).
          rows = filterByFermeField(rows, _fermeFilter);
        }

        if (Object.keys(submittedFermes).length > 0) {
          const liveRows = rows.filter(r => !submittedFermes[r.ferme]);
          let snapshotRows = [];
          for (const f of Object.keys(submittedFermes)) { const snapData = await getSnapshotData(dateForCheck, f); if (snapData && snapData.postesFixes) snapshotRows = snapshotRows.concat(snapData.postesFixes); }
          // GATING PAIE : snapshots (toutes fermes) → filtrer sur la ferme du chef.
          rows = filterByFermeField([...liveRows, ...snapshotRows], _fermeFilter);
        }

        return res.json({ success: true, date: dateForCheck, rows, count: rows.length });
      }

      // ------ PARCELLES-PARAMS-LIST : écran « Paramètres Parcelles » (liste) ------
      // Source MAINTENANT : parcelles distinctes du mirror sql_mirror_pointage sur
      // ---- parcelles-campagne-list : parcelles BR_Pointage classées par campagne ----
      // Source : BR_Pointage (base de production JH), pas BR_Consommation.
      // Campagne 2026/2027 : dates >= 2026-07-01 (parcelles actives campagne courante).
      // Campagne 2025/2026 : dates 2025-07-01..2026-06-30 non présentes en 2026/2027.
      if (action === "parcelles-campagne-list") {
        const today = new Date().toISOString().slice(0, 10);
        const CUT = "2026-07-01";
        const PREV_START = "2025-07-01";
        const PREV_END = "2026-06-30";

        let rows2627 = [], rowsPrev = [];

        if (!USE_MIRROR) {
          const db = await getPool();
          // Surfaces depuis BR_Parcelle (table de référence, champ Sup_Parcelle_Culturale)
          const [r1, r2, rSup] = await Promise.all([
            db.request().query(`
              SELECT Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme,
                MIN(CONVERT(date, Periode_Date)) AS Debut,
                MAX(CONVERT(date, Periode_Date)) AS Fin
              FROM BR_Pointage
              WHERE CONVERT(date, Periode_Date) >= '${CUT}'
                AND Parcelle_Culturale IS NOT NULL AND Parcelle_Culturale != ''
              GROUP BY Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme
              ORDER BY Parcelle_Culturale`),
            db.request().query(`
              SELECT Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme,
                MIN(CONVERT(date, Periode_Date)) AS Debut,
                MAX(CONVERT(date, Periode_Date)) AS Fin
              FROM BR_Pointage
              WHERE CONVERT(date, Periode_Date) >= '${PREV_START}'
                AND CONVERT(date, Periode_Date) <= '${PREV_END}'
                AND Parcelle_Culturale IS NOT NULL AND Parcelle_Culturale != ''
              GROUP BY Ref_parcelle, Parcelle_Culturale, Culture, Variete, Ferme
              ORDER BY Parcelle_Culturale`),
            // Surfaces depuis BR_Parcelle (source authoritative : Sup_Parcelle_Culturale)
            db.request().query(`
              SELECT Parcelle_Culturale, Sup_Parcelle_Culturale AS Sup
              FROM BR_Parcelle
              WHERE Parcelle_Culturale IS NOT NULL AND Parcelle_Culturale != ''`),
          ]);
          // Map label → sup pour le join
          const supMap = {};
          rSup.recordset.forEach(r => { supMap[(r.Parcelle_Culturale || "").trim()] = parseFloat(r.Sup) || 0; });
          const toRow = (r) => {
            const lbl = (r.Parcelle_Culturale || "").trim();
            return {
              ref: (r.Ref_parcelle || "").trim(),
              label: lbl,
              culture: (r.Culture || "").trim(),
              variete: (r.Variete || "").trim(),
              ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
              sup: supMap[lbl] || 0,
              debut: r.Debut ? String(r.Debut).slice(0, 10) : null,
              fin: r.Fin ? String(r.Fin).slice(0, 10) : null,
            };
          };
          rows2627 = r1.recordset.map(toRow);
          rowsPrev = r2.recordset.map(toRow);
        } else {
          // Mirror path — Firestore sql_mirror_pointage
          // Surfaces via fetchBrParcelleSupMap (résilient : last-known-good si BDR down)
          const [raw2627, rawPrev, supMap] = await Promise.all([
            getPointageRowsForDateRange(CUT, today),
            getPointageRowsForDateRange(PREV_START, PREV_END),
            fetchBrParcelleSupMap(),
          ]);
          const agg = (rows) => {
            const m = {};
            for (const r of rows) {
              const lbl = (r.Parcelle_Culturale || "").trim();
              if (!lbl) continue;
              if (!m[lbl]) m[lbl] = {
                ref: (r.Ref_parcelle || "").trim(),
                label: lbl,
                culture: (r.Culture || r.culture || "").trim(),
                variete: (r.Variete || r.variete || "").trim(),
                ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
                sup: supMap[lbl] || 0, debut: null, fin: null,
              };
              const d = r.DateStr || (r.jour ? String(r.jour).slice(0, 10) : null);
              if (d) {
                if (!m[lbl].debut || d < m[lbl].debut) m[lbl].debut = d;
                if (!m[lbl].fin || d > m[lbl].fin) m[lbl].fin = d;
              }
            }
            return Object.values(m).sort((a, b) => a.label.localeCompare(b.label));
          };
          rows2627 = agg(raw2627);
          rowsPrev = agg(rawPrev);
        }

        // Exclure de 2025/2026 les parcelles déjà dans 2026/2027 (label match)
        const labels2627 = new Set(rows2627.map(r => r.label));
        rowsPrev = rowsPrev.filter(r => !labels2627.has(r.label));

        return res.json({ success: true, campagne_courante: rows2627, campagne_precedente: rowsPrev });
      }

      // ===== RÉFÉRENTIEL PARCELLES SMART BERRY =====
      // Lecture du référentiel (noms SB + surfaces éditables)
      if (action === "sb-referentiel-list") {
        const snap = await db_firestore.collection("sb_parcelle_referentiel").get();
        const parcelles = [];
        snap.forEach(doc => parcelles.push({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, parcelles });
      }

      // Sauvegarde d'une entrée du référentiel (DG/RH uniquement)
      if (action === "sb-referentiel-save" && req.method === "POST") {
        const _authUser = await verifyAuth(req);
        const callerProfile = await resolveCallerProfile(_authUser);
        if (!callerProfile || !["dg", "rh"].includes(callerProfile.role)) {
          return res.status(403).json({ success: false, error: "Accès refusé — DG/RH requis" });
        }
        const { label_bee_one, nom_sb, ha } = req.body || {};
        if (!label_bee_one || typeof label_bee_one !== "string") {
          return res.status(400).json({ success: false, error: "label_bee_one requis" });
        }
        const key = label_bee_one.trim().toUpperCase();
        const haNum = parseFloat(ha) || 0;
        const docRef = db_firestore.collection("sb_parcelle_referentiel").doc(key);
        await docRef.set({
          label_bee_one: label_bee_one.trim(),
          nom_sb: (nom_sb || "").trim(),
          ha: haNum,
          updated_by: { uid: callerProfile.uid, name: callerProfile.name || "", role: callerProfile.role },
          updated_at: require("firebase-admin").firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return res.json({ success: true, key });
      }

      // la campagne sélectionnée (référentiel parcelle_ferme_referentiel encore vide,
      // serveur BEE ONE down). LEFT-JOIN référentiel pour enrichir surface_ha /
      // campagne_assignee — surface « manquante » tant que le pull BEE ONE n'a pas
      // tourné (dégradé gracieux voulu, spec §7.2).
      // Cloisonnement : _fermeFilter (chef → ses parcelles) déjà appliqué via le
      // shadow de getPointageRowsForDate (fail-closed). DG/RH → toutes.
      if (action === "parcelles-params-list") {
        const campagne = req.query.campagne || campagneCourante();
        if (!isValidCampagneLabel(campagne)) {
          return res.status(400).json({ success: false, error: "Campagne invalide" });
        }
        // Toutes les dates de la campagne (année fiscale 1er juil → 30 juin).
        const start = `${campagne.slice(0, 4)}-07-01`;
        const end = `${campagne.slice(5, 9)}-06-30`;
        // getPointageRowsForDateRange est shadowé (filtré ferme) quand _fermeFilter.
        const rawRows = await getPointageRowsForDateRange(start, end);
        const parcelles = aggregateParcellesFromMirror(rawRows, deriveFerme, campagne);
        // LEFT-JOIN référentiel : lire les docs de la campagne (clé `${campagne}__${ref}`).
        const refByKey = new Map();
        try {
          const refSnap = await db_firestore.collection("parcelle_ferme_referentiel")
            .where("campagne", "==", campagne).get();
          refSnap.forEach((doc) => { refByKey.set(doc.id, doc.data() || {}); });
        } catch (e) {
          // Référentiel illisible → toutes surfaces « manquantes » (dégradé gracieux).
          console.error("[parcelles-params-list] référentiel illisible:", e.message);
        }
        const merged = mergeReferentiel(parcelles, refByKey, campagne);
        return res.json({ success: true, campagne, parcelles: merged, count: merged.length });
      }

      // ------ ASSIGN-CAMPAGNE-PARCELLE : assignation campagne (ÉCRITURE, gatée DG/admin) ------
      // SEULE saisie SB de l'écran (spec §4/§7.1). Rôle : DG + admin uniquement
      // (chef/RH/finance → 403). Upsert merge dans parcelle_ferme_referentiel
      // (source:'manual' protège d'un écrasement au sync). Ne touche PAS surface_ha
      // (authoritative BEE ONE).
      if (action === "assign-campagne-parcelle") {
        // Re-résout le profil du caller (le _callerProfile du bloc de gating est
        // hors scope). Auth déjà exigée en amont (action non exemptée).
        const _wu = await verifyAuth(req);
        const _wProfile = await resolveCallerProfile(_wu);
        const _isDG = _wProfile && (_wProfile.profileId === "dg" || _wProfile.role === "admin");
        if (!_isDG) {
          return res.status(403).json({ success: false, error: "Réservé DG/admin" });
        }
        const body = req.body || {};
        const ref = (body.ref == null ? "" : String(body.ref)).trim();
        const campagneCible = (body.campagne == null ? "" : String(body.campagne)).trim();
        if (!ref) return res.status(400).json({ success: false, error: "ref manquant" });
        if (!isValidCampagneLabel(campagneCible)) {
          return res.status(400).json({ success: false, error: "Campagne cible invalide" });
        }
        // La clé du doc utilise la campagne D'ORIGINE (où la parcelle est listée),
        // pas la cible : c'est le doc de CETTE parcelle-campagne que l'on annote.
        const campagneOrigine = (body.campagne_origine == null ? campagneCible : String(body.campagne_origine)).trim();
        if (!isValidCampagneLabel(campagneOrigine)) {
          return res.status(400).json({ success: false, error: "Campagne d'origine invalide" });
        }
        const docId = `${campagneOrigine}__${ref}`;
        try {
          await db_firestore.collection("parcelle_ferme_referentiel").doc(docId).set({
            campagne: campagneOrigine,
            ref_parcelle: ref,
            campagne_assignee: campagneCible,
            campagne_assignee_by: {
              uid: (_wu && _wu.uid) || null,
              name: (_wProfile && _wProfile.profileId) || null,
            },
            campagne_assignee_at: admin.firestore.FieldValue.serverTimestamp(),
            source: "manual",
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error("[assign-campagne-parcelle] échec écriture:", e.message);
          return res.status(500).json({ success: false, error: "Échec de l'écriture" });
        }
        // Invalide le cache référentiel mémoire (l'override manual peut changer un rattachement futur).
        invalidateReferentielCache();
        return res.json({ success: true, ref, campagne_assignee: campagneCible });
      }

      return res.status(400).json({ success: false, error: "Unknown action: " + action });
    } catch (err) {
      console.error("Erreur pointageRH:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});
