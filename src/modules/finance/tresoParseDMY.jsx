/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): tresoParseDMY */


function tresoParseDMY(s) {
            if (!s) return null;
            const parts = String(s).split('/');
            if (parts.length !== 3) return null;
            const [d, m, y] = parts.map(Number);
            if (!d || !m || !y) return null;
            return new Date(y, m - 1, d);
        }

export { tresoParseDMY };
