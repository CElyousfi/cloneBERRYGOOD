/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): transformSprayData */


function transformSprayData(apiData) {
            if (!apiData || !apiData.data_1h) return null;
            const times = apiData.data_1h.time || [];
            const spray = apiData.data_1h.spraywindow || [];
            // Group by day
            var parJour = {};
            times.forEach(function(t, i) {
                var dateKey = t.split(' ')[0];
                var h = parseInt(t.split(' ')[1]);
                if (!parJour[dateKey]) parJour[dateKey] = [];
                parJour[dateKey].push({ heure: h, value: spray[i] });
            });
            // Build daily summaries
            var jours = Object.keys(parJour).sort().map(function(dateKey) {
                var entries = parJour[dateKey];
                var workHours = entries.filter(function(e) { return e.heure >= 6 && e.heure <= 20; });
                var bonCount = workHours.filter(function(e) { return e.value === 1; }).length;
                var moyenCount = workHours.filter(function(e) { return e.value === 2; }).length;
                var mauvaisCount = workHours.filter(function(e) { return e.value === 0; }).length;
                // Find best spray windows (consecutive good hours)
                var fenetres = [];
                var start = null;
                workHours.forEach(function(e, idx) {
                    if (e.value === 1) {
                        if (start === null) start = e.heure;
                    } else {
                        if (start !== null) {
                            fenetres.push({ de: start, a: workHours[idx - 1].heure + 1 });
                            start = null;
                        }
                    }
                });
                if (start !== null) fenetres.push({ de: start, a: workHours[workHours.length - 1].heure + 1 });

                var d = new Date(dateKey + 'T12:00:00');
                var jourNoms = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
                return {
                    dateISO: dateKey,
                    date: String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'),
                    jourNom: jourNoms[d.getDay()],
                    isToday: dateKey === (function(){ var n=new Date(); return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); })(),
                    heures: entries,
                    bonCount: bonCount,
                    moyenCount: moyenCount,
                    mauvaisCount: mauvaisCount,
                    totalWork: workHours.length,
                    score: workHours.length > 0 ? Math.round((bonCount + moyenCount * 0.5) / workHours.length * 100) : 0,
                    fenetres: fenetres
                };
            });
            return { jours: jours };
        }

export { transformSprayData };
