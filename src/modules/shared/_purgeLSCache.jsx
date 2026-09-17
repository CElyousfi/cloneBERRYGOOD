/* Module: shared | Déclaration(s): _purgeLSCache */


// max localStorage cache_ entries before LRU trim
        function _purgeLSCache() {
            try {
                Object.keys(localStorage).forEach(function(k) { if (k.startsWith('cache_')) localStorage.removeItem(k); });
            } catch(e) {}
        }

export { _purgeLSCache };
