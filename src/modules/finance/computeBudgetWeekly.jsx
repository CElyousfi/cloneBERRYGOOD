/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): computeBudgetWeekly */


function computeBudgetWeekly(total, distribution) {
            const result = {};
            Object.entries(distribution).forEach(([week, pct]) => {
                result[Number(week)] = Math.round(total * pct);
            });
            return result;
        }

export { computeBudgetWeekly };
