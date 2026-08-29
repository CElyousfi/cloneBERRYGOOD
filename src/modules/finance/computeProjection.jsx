/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): computeProjection */


function computeProjection(reelByWeek, budgetWeekly, momentum, currentWeek) {
            // Past completed weeks: use réel. Current + future weeks: project with momentum.
            const lastCompleted = currentWeek - 1;
            const result = {};
            // Include pre-budget weeks with réel data (production started before budget)
            Object.entries(reelByWeek).forEach(([week, val]) => {
                const w = Number(week);
                if (w < currentWeek && !budgetWeekly[w]) {
                    result[w] = val;
                }
            });
            Object.entries(budgetWeekly).forEach(([week, budgetVal]) => {
                const w = Number(week);
                if (w <= lastCompleted && reelByWeek[w] !== undefined) {
                    result[w] = reelByWeek[w];
                } else if (w >= currentWeek) {
                    result[w] = Math.round(budgetVal * momentum);
                }
            });
            return result;
        }

export { computeProjection };
