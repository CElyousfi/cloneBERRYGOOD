// @ts-check
/**
 * Global variables initializer for legacy app components.
 * Provides safe stubs for firebase, db, toast, and profile helpers to prevent ReferenceErrors.
 */

if (typeof window !== 'undefined') {
  // Safe Firebase Auth & Firestore stubs
  if (!window.firebase) {
    window.firebase = {
      auth: () => ({
        currentUser: { uid: 'dev-user-001', displayName: 'M. Lazrak', email: 'lazrak@berrygood.farm' },
        onAuthStateChanged: (cb) => cb({ uid: 'dev-user-001', displayName: 'M. Lazrak' })
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ set: async () => {}, get: async () => ({ exists: true, data: () => ({}) }) }),
          where: () => ({ get: async () => ({ docs: [] }), orderBy: () => ({ get: async () => ({ docs: [] }) }) }),
          onSnapshot: (cb) => cb({ docs: [] })
        })
      })
    };
  }

  if (!window.db) {
    window.db = window.firebase.firestore();
  }

  if (!window.toast) {
    window.toast = (msg) => console.log('[TOAST]:', msg);
  }

  if (!window.t) {
    window.t = (key) => key;
  }

  if (!window.FARM_LIST) {
    window.FARM_LIST = ['Ferme 1 - Souss', 'Ferme 2 - Loukkos'];
  }

  if (!window.PROFILES) {
    window.PROFILES = ['dg', 'finance', 'qualite', 'achats', 'rh', 'chef', 'magasinier'];
  }
}
