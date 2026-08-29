/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): computeMomentum */


function computeMomentum(reelByWeek, budgetByWeek, currentWeek) {
            // Exclude current week (incomplete) — only use fully completed weeks
            const lastCompleted = currentWeek - 1;
            const weights = [0.5, 0.3, 0.2];
            const ratios = [];
            const weeks = Object.keys(budgetByWeek).map(Number).sort((a, b) => a - b);
            for (let i = weeks.length - 1; i >= 0 && ratios.length < 3; i--) {
                const w = weeks[i];
                if (w > lastCompleted) continue;
                const r = reelByWeek[w] || 0;
                const b = budgetByWeek[w] || 0;
                if (b > 0 && r > 0) ratios.push(r / b);
            }
            if (ratios.length === 0) return 1;
            let totalWeight = 0, weightedSum = 0;
            ratios.forEach((ratio, i) => {
                weightedSum += ratio * weights[i];
                totalWeight += weights[i];
            });
            return weightedSum / totalWeight;
        }

export { computeMomentum };
