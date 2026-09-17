/**
 * useStockLocations.js — Hook React partagé pour la config des emplacements stock.
 *
 * Fetch UNE fois /api/stock?action=get-locations et expose la liste dérivée des
 * magasins / stations / parcelles. Source de vérité unique pour supprimer la
 * divergence des `const MAGASINS = ['F1','F2','F5','F6']` hardcodés dans les écrans magasin.
 *
 * Tant que le fetch n'a pas répondu, retourne un FALLBACK
 * (magasins = ['F1','F2','F5','F6']) afin de ne pas casser le 1er render.
 * Dès que la config arrive, F3/F4 (ou tout magasin ajouté côté config) apparaissent.
 *
 *     (la dérivation pure deriveStockLocations est testable sans React/DOM).
 *
 * 2026-06 — feat/magasins-f3f4-alignement.
 */
// @ts-check

// Fallback figé : comportement identique à l'ancien hardcode tant que le fetch
// n'a pas répondu (1er render) ou en cas d'échec réseau.
var USL_FALLBACK_MAGASINS = ['F1', 'F2', 'F5', 'F6'];

/**
 * Dérive l'état exposé à partir du payload get-locations (ou null si pas encore reçu).
 * Pur : pas de réseau, pas de DOM. Le fallback magasins garantit un 1er render sûr.
 * @param {{magasins?: string[], stations?: string[], parcelles?: Record<string, string[]>}|null|undefined} locations
 * @param {boolean} loading
 * @returns {{magasins: string[], stations: string[], parcelles: Record<string, string[]>, loading: boolean}}
 */
function deriveStockLocations(locations, loading) {
  var loc = locations || {};
  var magasins = Array.isArray(loc.magasins) && loc.magasins.length
    ? loc.magasins
    : USL_FALLBACK_MAGASINS;
  var stations = Array.isArray(loc.stations) ? loc.stations : [];
  var parcelles = (loc.parcelles && typeof loc.parcelles === 'object' && !Array.isArray(loc.parcelles))
    ? loc.parcelles
    : {};
  return { magasins: magasins, stations: stations, parcelles: parcelles, loading: !!loading };
}

// Cache module-level : un seul fetch partagé entre tous les consommateurs du hook.
var USL_cache = null;        // dernier payload locations reçu
var USL_inflight = null;     // promesse en cours (évite les fetch concurrents)
var USL_subscribers = [];    // setters React à notifier quand le cache se remplit

function USL_notify() {
  for (var i = 0; i < USL_subscribers.length; i++) {
    try { USL_subscribers[i](USL_cache); } catch (e) { /* ignore */ }
  }
}

function USL_fetchOnce() {
  if (USL_cache) return Promise.resolve(USL_cache);
  if (USL_inflight) return USL_inflight;
  USL_inflight = fetch('/api/stock?action=get-locations')
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (json && json.success && json.locations) {
        USL_cache = json.locations;
        USL_notify();
      }
      return USL_cache;
    })
    .catch(function () { return null; })
    .then(function (res) { USL_inflight = null; return res; });
  return USL_inflight;
}

/**
 * Hook React : { magasins, stations, parcelles, loading }.
 * @returns {{magasins: string[], stations: string[], parcelles: Record<string, string[]>, loading: boolean}}
 */
function useStockLocations() {
  // React est une globale (CDN, cf. public/index.html) ; hors navigateur (tests) elle est absente.
  var R = (typeof React !== 'undefined' && React) ? React : null;
  if (!R) {
    // Hors React (ex. tests) : renvoie le fallback dérivé.
    return deriveStockLocations(USL_cache, !USL_cache);
  }
  var stateArr = React.useState(USL_cache);
  var locations = stateArr[0];
  var setLocations = stateArr[1];

  React.useEffect(function () {
    var mounted = true;
    var onUpdate = function (loc) { if (mounted) setLocations(loc); };
    USL_subscribers.push(onUpdate);
    USL_fetchOnce().then(function (loc) { if (mounted && loc) setLocations(loc); });
    return function () {
      mounted = false;
      var idx = USL_subscribers.indexOf(onUpdate);
      if (idx >= 0) USL_subscribers.splice(idx, 1);
    };
  }, []);

  return deriveStockLocations(locations, !locations);
}


export { useStockLocations, deriveStockLocations, USL_FALLBACK_MAGASINS };
