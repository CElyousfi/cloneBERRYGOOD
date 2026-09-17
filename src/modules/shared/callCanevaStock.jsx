/* Module: shared | Déclaration(s): callCanevaStock */


// ===== Import canevas Stock (Achats → validation Finance) =====
        function callCanevaStock(body) {
            return fetch('/api/stock?action=import-caneva-stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
        }

export { callCanevaStock };
