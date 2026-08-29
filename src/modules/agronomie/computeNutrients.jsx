/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): computeNutrients */


function computeNutrients(dayData, products) {
            var nutrients = { N: 0, P: 0, K: 0, CaO: 0, MgO: 0 };
            (products || []).forEach(function(p) {
                var qty = (dayData || {})[p.key] || 0;
                if (qty > 0 && p.composition) {
                    nutrients.N   += Math.round(qty * p.composition.N / 100 * 100) / 100;
                    nutrients.P   += Math.round(qty * p.composition.P / 100 * 100) / 100;
                    nutrients.K   += Math.round(qty * p.composition.K / 100 * 100) / 100;
                    nutrients.CaO += Math.round(qty * p.composition.CaO / 100 * 100) / 100;
                    nutrients.MgO += Math.round(qty * p.composition.MgO / 100 * 100) / 100;
                }
            });
            return nutrients;
        }

export { computeNutrients };
