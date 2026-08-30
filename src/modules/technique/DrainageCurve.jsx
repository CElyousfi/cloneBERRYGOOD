/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): DrainageCurve */


function DrainageCurve({ group, drainPctFn, sunriseMin, sunsetMin }) {
            var W = 1000, H = 180;
            var padL = 56, padR = 20, padT = 30, padB = 24;
            var innerW = W - padL - padR;
            var innerH = H - padT - padB;
            // Fenêtre = sunrise/sunset Meteoblue (arrondi 30 min, marge 30 min), fallback 06:00–20:00
            var startMin = (sunriseMin != null) ? Math.max(0, Math.floor((sunriseMin - 30) / 30) * 30) : 6 * 60;
            var endMin = (sunsetMin != null) ? Math.min(24 * 60, Math.ceil((sunsetMin + 30) / 30) * 30) : 20 * 60;
            var totalMin = endMin - startMin;
            var pctMax = 40; // Y axis: 0% (bottom) -> 40% (top)

            var minToX = function(m) {
                var clamped = Math.max(startMin, Math.min(endMin, m));
                return padL + ((clamped - startMin) / totalMin) * innerW;
            };
            var pctToY = function(p) {
                var clamped = Math.max(0, Math.min(pctMax, p));
                return padT + innerH - (clamped / pctMax) * innerH;
            };

            var hhmmToMin = function(s) {
                if (!s || typeof s !== 'string' || s.indexOf(':') < 0) return null;
                var parts = s.split(':');
                var h = parseInt(parts[0], 10), mn = parseInt(parts[1], 10);
                if (isNaN(h) || isNaN(mn)) return null;
                return h * 60 + mn;
            };

            var avgField = function(arr, field) {
                var vals = (arr || []).filter(function(x){ return x[field] > 0; });
                if (vals.length === 0) return null;
                return vals.reduce(function(s,x){ return s + x[field]; }, 0) / vals.length;
            };
            var reconColor = function(rc) {
                if (rc == null) return 'var(--gray-400)';
                if (rc < 1.1) return 'var(--blue)';     // besoin de réduire l'irrigation
                if (rc <= 1.2) return 'var(--green)';   // optimal
                return '#F1C40F';                        // besoin d'eau (flush) — jaune
            };

            // Build event list (sorted by time)
            var events = (group.readings || [])
                .map(function(r) {
                    var m = hhmmToMin(r.heure);
                    if (m == null) return null;
                    var pctStr = drainPctFn(r);
                    var pct = pctStr === '-' ? null : parseFloat(pctStr);
                    var vDrain = (r.drainage || []).filter(function(d){return d.volume>0;});
                    var avgVDrain = vDrain.length ? (vDrain.reduce(function(s,d){return s+d.volume;},0) / vDrain.length).toFixed(0) : '-';
                    var ecPts = avgField(r.points, 'ec');
                    var ecDr = avgField(r.drainage, 'ec');
                    var recon = (ecPts && ecDr && ecPts > 0) ? (ecDr / ecPts) : null;
                    var color = reconColor(recon);
                    return { heure: r.heure, m: m, pct: pct, color: color, vDrain: avgVDrain, ecPts: ecPts, ecDr: ecDr, recon: recon };
                })
                .filter(function(e){ return e != null; })
                .sort(function(a,b){ return a.m - b.m; });

            // First Drain = first event with pct > 0
            var firstDrainIdx = -1;
            for (var i = 0; i < events.length; i++) {
                if (events[i].pct != null && events[i].pct > 0) { firstDrainIdx = i; break; }
            }
            var finalIdx = events.length > 0 ? events.length - 1 : -1;

            // Trend line connecting droplets (drainage progression)
            var trendPts = events
                .filter(function(ev){ return ev.pct != null; })
                .map(function(ev){ return minToX(ev.m).toFixed(1) + ',' + pctToY(ev.pct).toFixed(1); });
            var trendPath = trendPts.length > 1 ? 'M ' + trendPts.join(' L ') : null;

            // Hour ticks
            // Ticks horaires dynamiques toutes les 3h dans la fenêtre + extrémités
            var ticks = (function() {
                var arr = [], h0 = Math.ceil(startMin / 60), h1 = Math.floor(endMin / 60);
                arr.push(h0);
                for (var h = Math.ceil(h0 / 3) * 3; h < h1; h += 3) if (h > h0) arr.push(h);
                if (h1 !== arr[arr.length - 1]) arr.push(h1);
                return arr;
            })();
            // Drainage Y-axis ticks
            var pctTicks = [0, 10, 20, 30, 40];

            return React.createElement('svg', {
                viewBox: '0 0 ' + W + ' ' + H,
                preserveAspectRatio: 'xMidYMid meet',
                style: { width: '100%', height: 'auto', display: 'block' }
            },
                // Drainage threshold zones: 0-10% orange (faible), 10-30% green (optimal), 30-40% red (excès)
                React.createElement('rect', { x: padL, y: pctToY(10), width: innerW, height: pctToY(0) - pctToY(10), fill: 'rgba(243,156,18,0.12)' }),
                React.createElement('rect', { x: padL, y: pctToY(30), width: innerW, height: pctToY(10) - pctToY(30), fill: 'rgba(46,204,113,0.12)' }),
                React.createElement('rect', { x: padL, y: pctToY(pctMax), width: innerW, height: pctToY(30) - pctToY(pctMax), fill: 'rgba(231,76,60,0.12)' }),

                // Y-axis grid + labels (drainage %)
                pctTicks.map(function(p) {
                    var y = pctToY(p);
                    return React.createElement('g', { key: 'py' + p },
                        React.createElement('line', { x1: padL, y1: y, x2: padL + innerW, y2: y, stroke: 'var(--gray-400)', strokeWidth: 0.5, strokeDasharray: '2,3', opacity: 0.5 }),
                        React.createElement('text', { x: padL - 6, y: y + 3, fontSize: 10, fill: 'var(--gray-600)', textAnchor: 'end' }, p + '%')
                    );
                }),
                React.createElement('text', { x: 12, y: padT + innerH / 2, fontSize: 10, fill: 'var(--gray-600)', fontWeight: 600, textAnchor: 'middle', transform: 'rotate(-90, 12, ' + (padT + innerH / 2) + ')' }, 'Drainage'),

                // Hour ticks + labels
                ticks.map(function(h) {
                    var x = minToX(h * 60);
                    return React.createElement('g', { key: 't' + h },
                        React.createElement('line', { x1: x, y1: padT + innerH, x2: x, y2: padT + innerH + 4, stroke: 'var(--gray-400)', strokeWidth: 1 }),
                        React.createElement('text', { x: x, y: H - 6, fontSize: 10, fill: 'var(--gray-600)', textAnchor: 'middle' }, (h < 10 ? '0' : '') + h + ':00')
                    );
                }),

                // Sunrise / Sunset arrows
                (function() {
                    var fmt = function(m) { var h = Math.floor(m/60), mn = Math.round(m%60); return (h<10?'0':'')+h+':'+(mn<10?'0':'')+mn; };
                    var srX = (sunriseMin != null) ? minToX(sunriseMin) : padL;
                    var ssX = (sunsetMin != null) ? minToX(sunsetMin) : padL + innerW;
                    var srLabel = (sunriseMin != null) ? '☀ Sunrise ' + fmt(sunriseMin) : '☀ Sunrise';
                    var ssLabel = (sunsetMin != null) ? fmt(sunsetMin) + ' Sunset ☽' : 'Sunset ☽';
                    return React.createElement(React.Fragment, null,
                        React.createElement('text', { x: padL, y: padT - 12, fontSize: 10, fill: 'var(--gray-600)' }, srLabel),
                        React.createElement('text', { x: padL + innerW, y: padT - 12, fontSize: 10, fill: 'var(--gray-600)', textAnchor: 'end' }, ssLabel),
                        sunriseMin != null && React.createElement('line', { x1: srX, y1: padT, x2: srX, y2: padT + innerH, stroke: '#F39C12', strokeWidth: 1, strokeDasharray: '3,3', opacity: 0.5 }),
                        sunsetMin != null && React.createElement('line', { x1: ssX, y1: padT, x2: ssX, y2: padT + innerH, stroke: '#8E44AD', strokeWidth: 1, strokeDasharray: '3,3', opacity: 0.5 })
                    );
                })(),

                // Trend line (drainage progression)
                trendPath && React.createElement('path', { d: trendPath, fill: 'none', stroke: '#C2185B', strokeWidth: 2, strokeDasharray: '4,3', opacity: 0.6 }),

                // First Drain marker
                firstDrainIdx >= 0 && React.createElement('g', { key: 'fd' },
                    React.createElement('line', { x1: minToX(events[firstDrainIdx].m), y1: padT, x2: minToX(events[firstDrainIdx].m), y2: padT + innerH, stroke: 'var(--blue)', strokeWidth: 1, strokeDasharray: '2,3', opacity: 0.6 }),
                    React.createElement('text', { x: minToX(events[firstDrainIdx].m), y: padT - 2, fontSize: 9, fill: 'var(--blue)', textAnchor: 'middle', fontWeight: 600 }, 'First Drain')
                ),

                // Final Irrigation marker
                finalIdx >= 0 && finalIdx !== firstDrainIdx && React.createElement('g', { key: 'fi' },
                    React.createElement('line', { x1: minToX(events[finalIdx].m), y1: padT, x2: minToX(events[finalIdx].m), y2: padT + innerH, stroke: 'var(--berry)', strokeWidth: 1, strokeDasharray: '2,3', opacity: 0.6 }),
                    React.createElement('text', { x: minToX(events[finalIdx].m), y: padT - 2, fontSize: 9, fill: 'var(--berry)', textAnchor: 'middle', fontWeight: 600 }, 'Final Irrigation')
                ),

                // Droplets
                events.map(function(ev, idx) {
                    var x = minToX(ev.m), y = ev.pct == null ? pctToY(0) : pctToY(ev.pct);
                    var pctLabel = ev.pct == null ? '-' : ev.pct.toFixed(1) + '%';
                    var reconLabel = ev.recon == null ? '-' : ev.recon.toFixed(2) + 'x';
                    var tip = ev.heure + ' — Drainage ' + pctLabel + ' — V drain ' + ev.vDrain + ' mL — Recon ' + reconLabel + (ev.ecPts && ev.ecDr ? ' (EC ' + ev.ecPts.toFixed(1) + '→' + ev.ecDr.toFixed(1) + ')' : '');
                    return React.createElement('g', { key: 'd' + idx },
                        React.createElement('title', null, tip),
                        // droplet shape: circle + small triangle on top
                        React.createElement('path', {
                            d: 'M ' + x + ' ' + (y - 10) + ' Q ' + (x + 6) + ' ' + (y - 2) + ' ' + (x + 6) + ' ' + (y + 2) + ' A 6 6 0 1 1 ' + (x - 6) + ' ' + (y + 2) + ' Q ' + (x - 6) + ' ' + (y - 2) + ' ' + x + ' ' + (y - 10) + ' Z',
                            fill: ev.color, stroke: '#fff', strokeWidth: 1.2
                        }),
                        // reconcentration label below droplet
                        ev.recon != null && React.createElement('text', {
                            x: x, y: y + 16, fontSize: 9, fontWeight: 700, textAnchor: 'middle', fill: reconColor(ev.recon)
                        }, reconLabel),
                        // arrow indicator: ↑ if recon > 1.2 (need more water), ↓ if recon < 1.1 (too much water)
                        ev.recon != null && (ev.recon > 1.2 || ev.recon < 1.1) && React.createElement('text', {
                            x: x + 10, y: y + 2, fontSize: 14, fontWeight: 900, textAnchor: 'start', fill: reconColor(ev.recon)
                        }, ev.recon > 1.2 ? '↑' : '↓')
                    );
                })
            );
        }

export { DrainageCurve };
