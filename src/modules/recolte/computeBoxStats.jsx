/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): computeBoxStats */


function computeBoxStats(values) {
            const v = values.filter(x => typeof x === 'number' && !isNaN(x)).slice().sort((a, b) => a - b);
            const n = v.length;
            if (n === 0) return null;
            const quantile = (p) => {
                if (n === 1) return v[0];
                const idx = (n - 1) * p;
                const lo = Math.floor(idx), hi = Math.ceil(idx);
                if (lo === hi) return v[lo];
                return v[lo] + (v[hi] - v[lo]) * (idx - lo);
            };
            const min = v[0], max = v[n - 1];
            const mean = v.reduce((s, x) => s + x, 0) / n;
            if (n < 4) {
                const median = quantile(0.5);
                return { min, q1: min, median, q3: max, max, mean, outliers: [], whiskerLow: min, whiskerHigh: max, n };
            }
            const q1 = quantile(0.25), median = quantile(0.5), q3 = quantile(0.75);
            const iqr = q3 - q1;
            const lowFence = q1 - 1.5 * iqr;
            const highFence = q3 + 1.5 * iqr;
            const whiskerLow = v.find(x => x >= lowFence);
            let whiskerHigh = whiskerLow;
            for (let i = n - 1; i >= 0; i--) { if (v[i] <= highFence) { whiskerHigh = v[i]; break; } }
            const outliers = v.filter(x => x < whiskerLow || x > whiskerHigh);
            return { min, q1, median, q3, max, mean, outliers, whiskerLow, whiskerHigh, n };
        }

export { computeBoxStats };
