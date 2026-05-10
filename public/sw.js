// Smart BERRY Service Worker — Share Target uniquement (ZERO cache)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Intercepter UNIQUEMENT /share-target POST — tout le reste passe au réseau
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/share-target') && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
  }
  // Ne PAS appeler event.respondWith pour les autres requêtes = comportement réseau normal
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('images');
    if (files.length > 0) {
      const db = await openShareDB();
      const tx = db.transaction('shared_files', 'readwrite');
      const store = tx.objectStore('shared_files');
      store.clear();
      for (const file of files) {
        store.put({ file, timestamp: Date.now() });
      }
    }
  } catch(e) { console.warn('Share target error:', e); }
  return Response.redirect('/?share=bons', 303);
}

function openShareDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('smart_berry_share', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('shared_files')) {
        req.result.createObjectStore('shared_files', { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
