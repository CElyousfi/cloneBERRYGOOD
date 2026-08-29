/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): computeAtterrissage */


function computeAtterrissage(reelByWeek, budgetWeekly, momentum, currentWeek) {
            const lastCompleted = currentWeek - 1;
            let total = 0;
            // Add pre-budget réel production (weeks before budget starts)
            Object.entries(reelByWeek).forEach(([week, val]) => {
                const w = Number(week);
                if (w < currentWeek && !budgetWeekly[w]) {
                    total += val;
                }
            });
            Object.entries(budgetWeekly).forEach(([week, budgetVal]) => {
                const w = Number(week);
                if (w <= lastCompleted && reelByWeek[w] !== undefined) {
                    total += reelByWeek[w];
                } else if (w >= currentWeek) {
                    total += Math.round(budgetVal * momentum);
                }
            });
            return total;
        }

export { computeAtterrissage };
