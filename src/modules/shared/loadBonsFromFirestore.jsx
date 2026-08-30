/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): _bonsCache, _bonsCacheTime, loadBonsFromFirestore */


// Fonction utilitaire : charger TOUS les bons depuis Firestore
        let _bonsCache = null;

let _bonsCacheTime = 0;

async function loadBonsFromFirestore(forceRefresh) {
            // Cache mémoire 2min — empêche les requêtes répétées dans la même session
            if (!forceRefresh && _bonsCache && (Date.now() - _bonsCacheTime < 120000)) return _bonsCache;
            const db = firebase.firestore();
            // Vérifier le compteur serveur pour détecter si les données ont changé
            try {
                const meta = await db.collection('app_settings').doc('pfq_import_meta').get();
                const serverCount = meta.exists ? (meta.data().lastImportCount || 0) : 0;
                if (_bonsCache && _bonsCache.length === serverCount && (Date.now() - _bonsCacheTime < 300000)) {
                    console.log('[Firestore] Cache valid, count matches server:', serverCount);
                    return _bonsCache;
                }
            } catch(e) {}
            // Charger depuis Firestore
            const snap = await db.collection('pfq_interne').get();
            const allBons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            _bonsCache = allBons;
            _bonsCacheTime = Date.now();
            console.log('[Firestore] Loaded', allBons.length, 'bons from', snap.metadata.fromCache ? 'CACHE' : 'SERVER');
            // Si les données viennent du cache et ne matchent pas le compteur serveur, forcer un refresh
            if (snap.metadata.fromCache) {
                try {
                    const meta = await db.collection('app_settings').doc('pfq_import_meta').get();
                    const serverCount = meta.exists ? (meta.data().lastImportCount || 0) : 0;
                    if (serverCount > 0 && allBons.length < serverCount * 0.95) {
                        console.log('[Firestore] Cache stale! Got', allBons.length, 'expected ~', serverCount, '- waiting for server...');
                        // Attendre que Firestore synchro avec le serveur
                        await db.waitForPendingWrites();
                        const snap2 = await db.collection('pfq_interne').get();
                        const freshBons = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
                        if (freshBons.length > allBons.length) {
                            _bonsCache = freshBons;
                            _bonsCacheTime = Date.now();
                            console.log('[Firestore] Refreshed to', freshBons.length, 'bons');
                            return freshBons;
                        }
                    }
                } catch(e) {}
            }
            return allBons;
        }

export function __set_bonsCache(v){ _bonsCache = v; }
export { _bonsCache, _bonsCacheTime, loadBonsFromFirestore };
