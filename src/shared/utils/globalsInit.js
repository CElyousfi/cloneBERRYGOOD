// @ts-check
/**
 * Global variables & helper initializer for legacy app components.
 * Provides safe stubs for firebase, db, toast, cachedFetch, and profile helpers to prevent ReferenceErrors.
 */

const _apiCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function cachedFetch(url) {
  const now = Date.now();
  if (_apiCache[url] && (now - _apiCache[url].ts < CACHE_TTL)) {
    return Promise.resolve(_apiCache[url].data);
  }
  try {
    const stored = localStorage.getItem('cache_' + url);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (now - parsed.ts < CACHE_TTL) {
        _apiCache[url] = { data: parsed.data, ts: parsed.ts };
        return Promise.resolve(parsed.data);
      }
    }
  } catch (e) {}

  return fetch(url)
    .then(r => r.json())
    .then(data => {
      _apiCache[url] = { data, ts: Date.now() };
      try {
        localStorage.setItem('cache_' + url, JSON.stringify({ data, ts: Date.now() }));
      } catch (e) {}
      return data;
    })
    .catch(() => ({ success: false, data: [] }));
}

export function loadBonsFromFirestore() {
  if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
    return window.firebase.firestore().collection('bons_apport').get()
      .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })))
      .catch(() => []);
  }
  return Promise.resolve([]);
}

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.cachedFetch = cachedFetch;
  // @ts-ignore
  window.loadBonsFromFirestore = loadBonsFromFirestore;

  // Safe Firebase Auth & Firestore stubs
  if (!window.firebase) {
    // @ts-ignore
    window.firebase = {
      auth: () => ({
        currentUser: { uid: 'dev-user-001', displayName: 'M. Lazrak', email: 'lazrak@berrygood.farm' },
        onAuthStateChanged: (cb) => cb({ uid: 'dev-user-001', displayName: 'M. Lazrak' })
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            set: async () => {},
            get: async () => ({ exists: true, data: () => ({}) })
          }),
          where: () => ({
            get: async () => ({ docs: [], forEach: () => {} }),
            orderBy: () => ({ get: async () => ({ docs: [], forEach: () => {} }) })
          }),
          get: async () => ({ docs: [], forEach: () => {} }),
          onSnapshot: (cb) => cb({ docs: [] })
        })
      })
    };
  }

  if (!window.db) {
    // @ts-ignore
    window.db = window.firebase.firestore();
  }

  if (!window.toast) {
    // @ts-ignore
    window.toast = (msg) => console.log('[TOAST]:', msg);
  }

  if (!window.t) {
    // @ts-ignore
    window.t = (key) => key;
  }

  if (!window.FARM_LIST) {
    // @ts-ignore
    window.FARM_LIST = ['Ferme 1 - Souss', 'Ferme 2 - Loukkos'];
  }

  if (!window.PROFILES) {
    // @ts-ignore
    window.PROFILES = ['dg', 'finance', 'qualite', 'achats', 'rh', 'chef', 'magasinier'];
  }
}
