/* Extrait de pointageService.js — blocs repris VERBATIM.
   Seul ce preambule de require est ajoute. */
'use strict';
'use strict';
const { NOT_HANDLED } = require("./pointageService.dispatch");

const __actions = [
  require("./pointageService.actions1"),
  require("./pointageService.actions2"),
  require("./pointageService.actions3"),
  require("./pointageService.actions4"),
];

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

const { syncPointageFromProd } = require("./pointageBdpSync");


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
} = require("./firestoreDataService");


// Coût CHARGÉ d'une journée d'ouvrier (CNSS patronale + transport compris) —
// calcul PUR, testé sans émulateur. Cf. l'action `campagne-cout-ouvrier`.
const coutOuvrier = require("./lib/paie/coutOuvrierCampagne.js");

const coutQuinzaineSnap = require("./lib/paie/coutQuinzaineSnapshot.js");

const fichierPaieStore = require("./lib/paie/fichierPaieStore.js");


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
  isSansEquipe,
} = require("./lib/heuresSup/heuresSup");


// Pointage — effectifs ouvriers DISTINCTS par (ferme, type).
// Corrige le comptage gonflé (somme des distincts par parcelle → ouvrier multi-parcelles compté N×).
const { countDistinctByFermeType } = require("./lib/pointage/countDistinctByFermeType");

const { dedupeWorkersByMatricule } = require("./lib/pointage/dedupeWorkersByMatricule");

const {
  defaultPeriodeForCampagne,
  buildPeriodeCampagne,
  splitCompositeLabel,
  filterRowsByExactDates,
} = require("./lib/pointage/campagnePeriodes");

const { campagneCourante, campagneOf } = require("./lib/mappingConso/campagneUtils");


// Un label de quinzaine désambiguïsé ("Quinzaine 15 (2024-2025)") n'existe QUE
// dans periodeMap/periodeCampagne — `Periode_paie` en SQL/mirror/archive ne
// contient JAMAIS le suffixe de campagne. Toute recherche par label dans ces
// sources doit donc matcher sur le label BRUT (cf. docs/spec fix racine 2026-08,
// "collision de labels Quinzaine N entre campagnes").
function archiveDocRef(label) {
  const { rawLabel } = splitCompositeLabel(label);
  return db_firestore.collection("quinzaine_archive").doc(rawLabel);
}


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

// Groupes de parcelles (raccourci de saisie BC, éclatement au prorata des Ha).
const parcelleGroupSplit = require("./lib/parcelleGroupes/split");

const parcelleGroupValidate = require("./lib/parcelleGroupes/validate");

// Initialisation des Ha manquants du référentiel SB depuis les surfaces BEE ONE.
const parcelleGroupSeedHa = require("./lib/parcelleGroupes/seedHa");

// Budget JH/Ha par parcelle × famille d'opération (validation + merge purs).
const campagneBudget = require("./lib/campagneBudget/validate");

// Consommation depuis les BONS Smart Berry (`consumption_vouchers`) — la source
// BEE ONE `sql_mirror_consommation` est tarie depuis avril 2026.
const consoBons = require("./lib/consoBons");

// Export Excel « Campagne » côté serveur (structure + rendu ExcelJS) — module
// pur : aucune lecture Firestore, tout lui est injecté.
const campagneExport = require("./lib/campagneExport");

// Miroir backend de public/lib/cultureUtils.js — gating avocatier du budget de
// quinzaine (le backend ne peut PAS requérir public/, cf. CLAUDE.md).
const campagneBudgetCulture = require("./lib/campagneBudget/culture");

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
let _supMapLastGood = null;
 // cache mémoire d'instance (survit entre requêtes)
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
let _referentielCache = null;
 // Map<`${campagne}__${ref}`, ferme> | null
let _referentielLoadedAt = 0;

const REFERENTIEL_TTL_MS = 10 * 60 * 1000;
 // rechargé au max toutes les 10 min

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
 * Dernier jour travaillé strictement AVANT ferieDate.
 * @param {string[]} joursTravailles - dates 'YYYY-MM-DD' triées croissant.
 * @param {string} ferieDate - date ISO du férié 'YYYY-MM-DD'.
 * @returns {string|undefined}
 */
function findJourAvant(joursTravailles, ferieDate) {
  let jourAvant;
  for (const d of joursTravailles) { if (d < ferieDate) jourAvant = d; else break; }
  return jourAvant;
}


/**
 * Premier jour travaillé strictement APRÈS ferieDate.
 * @param {string[]} joursTravailles - dates 'YYYY-MM-DD' triées croissant.
 * @param {string} ferieDate - date ISO du férié 'YYYY-MM-DD'.
 * @returns {string|undefined}
 */
function findJourApres(joursTravailles, ferieDate) {
  return joursTravailles.find(d => d > ferieDate);
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

  // Éligibilité "présence réelle le jour J" (cf. docs/spec-jour-ferie-fix.md) :
  // un ouvrier n'est crédité de la prime Jour Férié que s'il a travaillé le jour
  // férié lui-même, OU qu'il a une présence encadrante (jour ouvré avant ET après
  // le férié). Remplace l'ancien forfait "actif quelque part dans la quinzaine".
  const today = require('./lib/dates/isoDateInTz').isoDateInTz(new Date(), 'Africa/Casablanca');
  // Jours où au moins un ouvrier de la ferme a une ligne de pointage (proxy "jour ouvré",
  // sans dépendre d'un calendrier de repos hebdomadaire fixe qui varie selon ferme/équipe).
  const joursTravailles = [...new Set(allRows.map(r => r.DateStr).filter(Boolean))].sort();
  // Présence par ouvrier, globale (toutes périodes confondues) : le jour avant/après
  // un férié peut tomber dans une quinzaine différente de celle où le férié est crédité.
  const workerDaySet = {}; // matricule -> Set(DateStr)
  for (const r of allRows) {
    const mat = (r.Personnel_Matricule || "").trim();
    if (!mat || !r.DateStr) continue;
    if (!workerDaySet[mat]) workerDaySet[mat] = new Set();
    workerDaySet[mat].add(r.DateStr);
  }

  // For each jour férié, find its quinzaine and credit only workers with real presence
  const ferieWorkers = {}; // "periode|mat" -> { matricule, nom, periode, details: [] }
  for (const jf of JOURS_FERIES) {
    // Aïd = 2 jours fériés légaux, mais la prime ne compte QUE le 1er jour.
    // On ignore donc les entrées « (2e jour) » (et tout flag compteurPrime:false).
    if (/\(2e\s*jour\)/i.test(jf.label || '') || jf.compteurPrime === false) continue;
    // Un férié futur (pas encore eu lieu) ne peut être crédité à personne — pas de
    // présence à vérifier tant que la date n'est pas passée.
    if (jf.date > today) continue;
    // Rattachement par quinzaine CALENDAIRE (1–15 / 16–fin) : le férié appartient à la
    // quinzaine qui le contient au calendrier. Si cette quinzaine n'a pas encore de
    // données (ex. férié futur), le férié n'est crédité à personne (continue).
    const holidayPeriode = resolveHolidayPeriode(halfToPeriode, jf.date);
    if (!holidayPeriode) continue; // Quinzaine du férié sans données chargées

    const jourAvant = findJourAvant(joursTravailles, jf.date);
    const jourApres = findJourApres(joursTravailles, jf.date);
    if (!jourAvant || !jourApres) {
      console.warn(`[computeChargCond] Férié ${jf.date} en bordure du dataset chargé (jourAvant=${jourAvant}, jourApres=${jourApres}) — seul le critère "travaillé le jour férié" reste applicable.`);
    }

    for (const [, wp] of Object.entries(workerPeriod)) {
      if (wp.periode !== holidayPeriode) continue;
      const set = workerDaySet[wp.mat];
      if (!set) continue;
      const travaillePendantFerie = set.has(jf.date);
      const presentEncadrant = !!(jourAvant && jourApres && set.has(jourAvant) && set.has(jourApres));
      if (!travaillePendantFerie && !presentEncadrant) continue; // pas de présence réelle → non crédité

      const fKey = `${wp.periode}|${wp.mat}`;
      if (!ferieWorkers[fKey]) ferieWorkers[fKey] = { matricule: wp.mat, nom: wp.nom, periode: wp.periode, ferme: wp.ferme, details: [] };
      const avgCout = wp.coutCount > 0 ? wp.totalCout / wp.coutCount : 0;
      const raison = travaillePendantFerie ? 'Travaillé le jour férié' : 'Présent avant/après le jour férié';
      ferieWorkers[fKey].details.push({ date: jf.date, label: jf.label, raison, cout: avgCout });
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
        // `classe_rythme` (continu | saisonnier | recolte) : dit si une
        // opération se projette au rythme des dernières quinzaines (grille
        // Campagne, lot 3a). Recopié TEL QUEL, y compris vide : une fiche sans
        // classe doit rester sans classe côté client, qui affiche alors « — ».
        // Un défaut posé ici ferait projeter des opérations jamais qualifiées.
        ops.push({ code: d.code, groupe: (d.groupe || '').trim(), famille: d.famille.trim(), operation: d.operation.trim(), ordre: d.ordre || 0, classe_rythme: (d.classe_rythme || '').trim() });
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


/**
 * Triplets (code, famille, opération) du référentiel, la famille étant RÉSOLUE
 * DEPUIS LE CODE — la même règle que `resolveFamily` applique aux lignes de
 * pointage BEE ONE. C'est le référentiel autorisé du budget JH/Ha : sans cette
 * résolution, une fiche dont le champ `famille` diverge de celle que son code
 * résout ferait saisir un budget que le réalisé ne rejoindrait jamais.
 *
 * @param {{map: Object, ops: Array}} ref sortie de loadReferentielTaches().
 * @returns {Array<{code: string, famille: string, operation: string}>}
 */
function referentielOperationsConnues(ref) {
  const map = (ref && ref.map) || {};
  // Une fiche sans code reste admise : sa clé se réduit alors au libellé
  // (cf. campagneBudget.opKey) et sa famille à celle de la fiche — on ne
  // l'exclut pas du budget sous prétexte qu'elle est incomplète.
  return ((ref && ref.ops) || [])
    .filter((o) => o && o.operation)
    .map((o) => ({
      code: String(o.code == null ? '' : o.code).trim(),
      famille: campagneBudget.familleDuCode(o.code, o.famille, map),
      operation: String(o.operation).trim(),
    }))
    .filter((o) => o.famille && o.operation);
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
 * Exclusions appliquées :
 * - récolte (payée au rendement) et fonctions configurées (gardiens), via
 *   shouldExcludeWorkerDay — critère sur la FONCTION pointée ;
 * - ouvriers « sans équipe » : matricule ne contenant aucune lettre, donc aucun
 *   préfixe d'équipe (cf. equipesConfig.js) — critère sur le MATRICULE.
 * Un ouvrier présent mais absent du mirror est conservé avec `fonctionMissing`.
 *
 * @param {Object|null} meta - sql_mirror_pointage_meta/config
 * @param {Array<string>} excludedFonctions
 * @param {string|null} [fermeFilter] - GATING PAIE : ferme du chef, ou null
 *        (RH/DG/Finance = toutes fermes, inchangé). Fourni → cloisonnement chef.
 * @returns {Promise<Object>} { success, periodes, excludedFonctions, seuilMinutes,
 *   periodeDates, rows, excludedSansEquipe } — `excludedSansEquipe` = nombre
 *   d'ouvriers DISTINCTS écartés faute d'équipe sur la fenêtre analysée.
 *   Aucun consommateur front à ce jour (le périmètre du ticket excluait public/) :
 *   c'est de la transparence pour le debug, en attente du ticket UI qui l'affichera
 *   à côté du compteur « ouvrier(s) sans heure de sortie exclu(s) » déjà en place.
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
  // Ouvriers DISTINCTS écartés faute d'équipe (matricule sans lettre), sur toute
  // la fenêtre analysée — dédoublonnés par matricule, pas par couple ouvrier-jour.
  const sansEquipeMatricules = new Set();
  for (const d of allDays) {
    const presence = presenceByDay[d] || new Map();
    const fonctions = fonctionByDay[d] || new Map();
    for (const [matUpper, p] of presence) {
      // GATING PAIE (chef) : prod_presence n'a pas de parcelle → on restreint aux
      // matricules ayant pointé la ferme du chef (set dérivé du mirror ci-dessus).
      // Fail-closed : un ouvrier présent mais jamais pointé sur cette ferme est exclu.
      if (allowedMatricules && !allowedMatricules.has(matUpper)) continue;
      // Ouvrier « sans équipe » : matricule sans aucune lettre → aucun préfixe
      // d'équipe (cf. equipesConfig.js) → hors heures supplémentaires.
      if (isSansEquipe(p.matricule)) { sansEquipeMatricules.add(matUpper); continue; }
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
  return {
    success: true,
    periodes,
    periodeCampagne,
    excludedFonctions,
    seuilMinutes: HS_SEUIL_MINUTES,
    periodeDates,
    rows,
    excludedSansEquipe: sansEquipeMatricules.size,
  };
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
module.exports = { HS_SEUIL_MINUTES, JOURS_FERIES_FALLBACK, NOT_HANDLED, POINTAGE_FERMES, REFERENTIEL_FAMILLES, REFERENTIEL_TTL_MS, USE_MIRROR, __actions, _getCueilletteRows, _getPointageRowsForDate, _getPointageRowsForDateRange, _getPointageRowsForPeriode, _getWorkerHistory, _qtkWarned, _refMap, _refTachesCache, _refTachesCacheAt, _referentielCache, _referentielLoadedAt, _supMapLastGood, admin, aggregateParcellesFromMirror, archiveDocRef, buildHalfToPeriode, buildHeuresSup, buildParCulture, buildPeriodeCampagne, campagneBudget, campagneBudgetCulture, campagneCourante, campagneExport, campagneOf, classifyType, computeAllowedMatricules, computeChargCond, computeDurationOvertime, consoAccessControl, consoBons, cors, countDistinctByFermeType, coutOuvrier, coutQuinzaineSnap, db_firestore, dedupeWorkersByMatricule, defaultPeriode, defaultPeriodeForCampagne, deriveFerme, detectFramboiseSubType, enrichRowsWithHaRef, fetchBrParcelleSupMap, fetchDetailFromMirror, fetchPostesFixesFromMirror, fetchSummaryFromMirror, fichierPaieStore, filterArchivedParFerme, filterArchivedParJour, filterArchivedRowsByFerme, filterByFermeField, filterMirrorRowsByCulture, filterMirrorRowsByFerme, filterPresenceRowsByAllowed, filterProdRowsByFerme, filterReposWorkersArchived, filterRowsByExactDates, findJourApres, findJourAvant, functions, getAvailableDates, getCueilletteRows, getExcludedFonctionsHS, getJoursFeries, getPointageMeta, getPointageRowsForDate, getPointageRowsForDateRange, getPointageRowsForPeriode, getPool, getSyncStatus, getWorkerHistory, halfKey, invalidateReferentielCache, isSansEquipe, isValidCampagneLabel, loadReferentielCache, loadReferentielTaches, mapMirrorRowToDetail, mergeReferentiel, parcelleGroupSeedHa, parcelleGroupSplit, parcelleGroupValidate, pointageCacheKey, pool, quantiteToKg, recomposeArchivedTotals, recomposeProdTotalKg, referentielOperationsConnues, resolveCallerProfile, resolveFamily, resolveFermeFromParcelle, resolveHolidayPeriode, resolveMyrtilleVariete, resolvePointageRHAccess, resolveVariete, shouldExcludeWorkerDay, splitCompositeLabel, sql, sqlConfig, syncPointageFromProd, verifyAuth, warmRefTaches, withCache };
