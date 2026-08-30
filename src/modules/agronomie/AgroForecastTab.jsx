/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): AgroForecastTab */


// ===================== FORECAST MÉTÉO INTÉRIEURE TAB =====================
        function AgroForecastTab() {
            var _fcData = React.useState(null);
            var fcData = _fcData[0], setFcData = _fcData[1];
            var _fcLoading = React.useState(true);
            var fcLoading = _fcLoading[0], setFcLoading = _fcLoading[1];
            var _viewMode = React.useState('daily');
            var viewMode = _viewMode[0], setViewMode = _viewMode[1];
            var _selectedDay = React.useState(null);
            var selectedDay = _selectedDay[0], setSelectedDay = _selectedDay[1];
            var _selectedType = React.useState('canarienne');
            var selectedType = _selectedType[0], setSelectedType = _selectedType[1];

            var todayStr = new Date().toISOString().slice(0, 10);
            var fcJours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
            var formatFcDate = function(ds) {
                var d = new Date(ds + 'T12:00:00');
                return fcJours[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
            };

            React.useEffect(function() {
                setFcLoading(true);
                fetch('/api/indoor-forecast?hourly=true')
                    .then(function(r) { return r.json(); })
                    .then(function(json) { setFcData(json); setFcLoading(false); })
                    .catch(function() { setFcLoading(false); });
            }, []);

            if (fcLoading && !fcData) return React.createElement('div', { className: 'panel', style: { textAlign: 'center', padding: 40 } },
                React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24, color: 'var(--berry)' } })
            );
            if (!fcData || !fcData.forecast) return React.createElement('div', { className: 'panel', style: { textAlign: 'center', padding: 40, color: 'var(--gray-400)' } },
                React.createElement('i', { className: 'fa-solid fa-cloud-bolt', style: { fontSize: 32, marginBottom: 12, display: 'block' } }),
                'Aucune donnée forecast disponible'
            );

            var fc = fcData.forecast;
            var accHistory = fcData.accuracyHistory || [];
            var globalMape = fcData.globalMape;

            // ---- CSV export of accuracy history ----
            var exportAccHistoryCSV = function(rows) {
                var metrics = ['tMax', 'tMin', 'hr', 'co2', 'vpd', 'par', 'radiation', 'substrate', 'dewpoint', 'pressure'];
                var types = ['canarienne', 'tunnel'];
                var headers = ['date'];
                types.forEach(function(t) {
                    headers.push(t + '_mape');
                    metrics.forEach(function(m) {
                        headers.push(t + '_' + m + '_error');
                        headers.push(t + '_' + m + '_pct');
                    });
                });
                var esc = function(v) {
                    if (v == null) return '';
                    var s = String(v);
                    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
                };
                var lines = [headers.join(',')];
                // Sort ascending by date for ML study
                var sorted = rows.slice().sort(function(a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
                sorted.forEach(function(r) {
                    var row = [esc(r.date)];
                    types.forEach(function(t) {
                        var d = r[t] || {};
                        row.push(esc(d.mape));
                        metrics.forEach(function(m) {
                            row.push(esc(d[m + '_error']));
                            row.push(esc(d[m + '_pct']));
                        });
                    });
                    lines.push(row.join(','));
                });
                var csv = '﻿' + lines.join('\n');
                var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'forecast-interieur-historique-' + new Date().toISOString().slice(0, 10) + '.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            };

            // ---- FORECAST PARAMS CONFIG ----
            var FC_PARAMS = [
                { key: 'tMax', label: 'T. max', unit: '\u00B0C', icon: 'fa-temperature-high', color: '#E53935', actualKey: 'tMax' },
                { key: 'tMin', label: 'T. min', unit: '\u00B0C', icon: 'fa-temperature-low', color: '#1E88E5', actualKey: 'tMin' },
                { key: 'hr', label: 'HR', unit: '%', icon: 'fa-droplet', color: '#00ACC1', actualKey: 'hr' },
                { key: 'co2', label: 'CO\u2082', unit: 'ppm', icon: 'fa-wind', color: '#7CB342', actualKey: 'co2' },
                { key: 'vpd', label: 'VPD', unit: 'kPa', icon: 'fa-gauge', color: '#D81B60', actualKey: 'vpd' },
                { key: 'par', label: 'PAR', unit: '\u00B5mol/m\u00B2/s', icon: 'fa-sun', color: '#FDD835', actualKey: 'par' },
                { key: 'radiation', label: 'Radiation', unit: 'W/m\u00B2', icon: 'fa-bolt', color: '#FF8F00', actualKey: 'radiation' },
                { key: 'substrate', label: 'Substrat', unit: '%', icon: 'fa-water', color: '#00ACC1', actualKey: 'substrate' },
                { key: 'dewpoint', label: 'Pt. ros\u00E9e', unit: '\u00B0C', icon: 'fa-temperature-arrow-down', color: '#5E35B1', actualKey: 'dewpoint' },
                { key: 'pressure', label: 'Pression', unit: 'kPa', icon: 'fa-compass', color: '#546E7A', actualKey: 'pressure' },
            ];

            // Outdoor reference rows
            var FC_OUTDOOR = [
                { key: 'ext', label: 'Ext.', icon: 'fa-cloud-sun', render: function(p) { return p.outdoor ? p.outdoor.tmin + '\u00B0/' + p.outdoor.tmax + '\u00B0' : '\u2014'; } },
                { key: 'eto', label: 'ETo', icon: 'fa-water', render: function(p) { return p.outdoor && p.outdoor.eto != null ? (Math.round(p.outdoor.eto * 10) / 10) + ' mm' : '\u2014'; } },
            ];

            // ---- LIVE SCORING ----
            var liveScore = function(type) {
                var act = fcData.todayActual && fcData.todayActual[type];
                var tp = (fc[type] || []).find(function(p) { return p.date === todayStr; });
                if (!act || !tp) return null;
                var ms = [];
                FC_PARAMS.forEach(function(pm) {
                    var pv = tp[pm.key], av = act[pm.actualKey];
                    if (pv == null || av == null) return;
                    var e = Math.round((pv - av) * 10) / 10;
                    var pc = av !== 0 ? Math.round(Math.abs(e / av) * 1000) / 10 : 0;
                    ms.push({ lb: pm.label, pv: pv, av: Math.round(av * 10) / 10, e: e, pc: pc, u: pm.unit, co: pm.color });
                });
                var av2 = ms.length > 0 ? Math.round(ms.reduce(function(s, m) { return s + m.pc; }, 0) / ms.length * 10) / 10 : null;
                return { ms: ms, av: av2, sc: av2 != null ? Math.max(0, Math.round(100 - av2)) : null };
            };

            var Gauge = function(pr) {
                var s = pr.score, sz = 70, sw = 6, r2 = (sz - sw) / 2, ci = 2 * Math.PI * r2, of2 = ci * (1 - (s != null ? s / 100 : 0));
                var co = s >= 90 ? '#4CAF50' : (s >= 75 ? '#8BC34A' : (s >= 60 ? '#FF8F00' : '#E53935'));
                return React.createElement('svg', { width: sz, height: sz },
                    React.createElement('circle', { cx: sz / 2, cy: sz / 2, r: r2, fill: 'none', stroke: '#f0f0f0', strokeWidth: sw }),
                    React.createElement('circle', { cx: sz / 2, cy: sz / 2, r: r2, fill: 'none', stroke: co, strokeWidth: sw, strokeDasharray: ci, strokeDashoffset: of2, strokeLinecap: 'round', transform: 'rotate(-90 ' + sz / 2 + ' ' + sz / 2 + ')' }),
                    React.createElement('text', { x: sz / 2, y: sz / 2 + 1, textAnchor: 'middle', dominantBaseline: 'middle', fontSize: 16, fontWeight: 700, fill: co }, s != null ? s + '%' : '\u2014'));
            };

            // ---- RENDER DAILY FORECAST TABLE ----
            var renderSerreFC = function(type, label) {
                var preds = fc[type] || [];
                if (preds.length === 0) return null;
                var actual = fcData.todayActual && fcData.todayActual[type];

                return React.createElement('div', { className: 'panel', style: { overflow: 'hidden' } },
                    React.createElement('div', { style: { padding: '14px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 } },
                        React.createElement('i', { className: 'fa-solid fa-chart-line', style: { color: 'var(--berry)', fontSize: 16 } }),
                        React.createElement('h3', { style: { margin: 0, fontSize: 16, color: 'var(--gray-800)' } }, label)
                    ),
                    React.createElement('div', { style: { padding: 16, overflowX: 'auto' } },
                        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 } },
                            React.createElement('thead', null,
                                React.createElement('tr', { style: { borderBottom: '2px solid var(--gray-200)' } },
                                    React.createElement('th', { style: { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--gray-500)' } }, ''),
                                    preds.map(function(p) {
                                        var isToday = p.date === todayStr;
                                        return React.createElement('th', { key: p.date, style: { textAlign: 'center', padding: '6px 8px', fontSize: 11, color: isToday ? 'var(--berry)' : 'var(--gray-500)', fontWeight: isToday ? 700 : 600, cursor: 'pointer' }, onClick: function() { setViewMode('hourly'); setSelectedDay(p.date); setSelectedType(type === 'tunnel' ? 'tunnel' : 'canarienne'); } },
                                            isToday ? "Auj." : formatFcDate(p.date),
                                            React.createElement('div', { style: { fontSize: 9, color: 'var(--gray-400)' } }, '\u25B6 horaire')
                                        );
                                    })
                                )
                            ),
                            React.createElement('tbody', null,
                                FC_PARAMS.map(function(pm) {
                                    return React.createElement('tr', { key: pm.key, style: { borderBottom: '1px solid var(--gray-100)' } },
                                        React.createElement('td', { style: { padding: '6px 8px', fontWeight: 600, color: pm.color, fontSize: 12 } },
                                            React.createElement('i', { className: 'fa-solid ' + pm.icon, style: { marginRight: 4 } }), pm.label),
                                        preds.map(function(p) {
                                            var isToday = p.date === todayStr;
                                            var val = p[pm.key];
                                            var actVal = isToday && actual ? actual[pm.actualKey] : null;
                                            return React.createElement('td', { key: p.date, style: { textAlign: 'center', padding: '6px 8px', fontWeight: isToday ? 700 : 400 } },
                                                val != null ? val + ' ' + pm.unit : '\u2014',
                                                actVal != null ? React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)' } }, 'reel: ' + (Math.round(actVal * 10) / 10) + ' ' + pm.unit) : null
                                            );
                                        })
                                    );
                                }),
                                // Outdoor reference rows
                                FC_OUTDOOR.map(function(o) {
                                    return React.createElement('tr', { key: o.key, style: { background: 'var(--gray-50)' } },
                                        React.createElement('td', { style: { padding: '6px 8px', fontWeight: 600, color: 'var(--gray-400)', fontSize: 12 } },
                                            React.createElement('i', { className: 'fa-solid ' + o.icon, style: { marginRight: 4 } }), o.label),
                                        preds.map(function(p) {
                                            return React.createElement('td', { key: p.date, style: { textAlign: 'center', padding: '6px 8px', fontSize: 11, color: 'var(--gray-400)' } }, o.render(p));
                                        })
                                    );
                                })
                            )
                        )
                    )
                );
            };

            // ---- RENDER HOURLY VIEW ----
            var renderHourlyView = function() {
                var preds = fc[selectedType] || [];
                var dayPred = preds.find(function(p) { return p.date === selectedDay; });
                if (!dayPred || !dayPred.hourly || dayPred.hourly.length === 0) {
                    return React.createElement('div', { className: 'panel', style: { textAlign: 'center', padding: 40, color: 'var(--gray-400)' } },
                        'Pas de donn\u00E9es horaires pour cette journ\u00E9e'
                    );
                }

                var hourlyPreds = dayPred.hourly;
                var actualHourly = selectedDay === todayStr && fcData.todayActual && fcData.todayActual[selectedType] && fcData.todayActual[selectedType].hourly ? fcData.todayActual[selectedType].hourly : [];
                var actualMap = {};
                actualHourly.forEach(function(h) { actualMap[h.hour] = h; });

                // Hourly param config
                var HOURLY_PARAMS = [
                    { key: 'temp', label: 'Temp.', unit: '\u00B0C', color: '#E53935', icon: 'fa-temperature-half' },
                    { key: 'hr', label: 'HR', unit: '%', color: '#1E88E5', icon: 'fa-droplet' },
                    { key: 'co2', label: 'CO\u2082', unit: 'ppm', color: '#7CB342', icon: 'fa-wind' },
                    { key: 'vpd', label: 'VPD', unit: 'kPa', color: '#D81B60', icon: 'fa-gauge' },
                    { key: 'par', label: 'PAR', unit: '\u00B5mol', color: '#FDD835', icon: 'fa-sun' },
                    { key: 'radiation', label: 'Rad.', unit: 'W/m\u00B2', color: '#FF8F00', icon: 'fa-bolt' },
                    { key: 'dewpoint', label: 'Ros\u00E9e', unit: '\u00B0C', color: '#5E35B1', icon: 'fa-temperature-arrow-down' },
                    { key: 'substrate', label: 'Subst.', unit: '%', color: '#00ACC1', icon: 'fa-water' },
                    { key: 'pressure', label: 'Press.', unit: 'kPa', color: '#546E7A', icon: 'fa-compass' },
                ];

                // Filter to relevant hours (6h-22h)
                var filteredHours = hourlyPreds.filter(function(h) {
                    if (!h.time) return false;
                    var hh = parseInt(h.time.slice(11, 13));
                    return hh >= 5 && hh <= 22;
                });

                // ---- Sparkline charts per parameter ----
                var renderSparkline = function(param) {
                    var vals = filteredHours.map(function(h) { return h[param.key]; }).filter(function(v) { return v != null; });
                    if (vals.length === 0) return null;
                    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
                    var range = maxV - minV || 1;
                    var w = 560, h2 = 60, pad = 4;

                    // Predicted line
                    var points = filteredHours.map(function(hr, i) {
                        var v = hr[param.key];
                        if (v == null) return null;
                        var x = pad + (i / (filteredHours.length - 1)) * (w - 2 * pad);
                        var y = h2 - pad - ((v - minV) / range) * (h2 - 2 * pad);
                        return x + ',' + y;
                    }).filter(Boolean).join(' ');

                    // Actual dots
                    var actualDots = [];
                    filteredHours.forEach(function(hr, i) {
                        var hh = hr.time ? hr.time.slice(11, 13) + ':00' : null;
                        var act = hh ? actualMap[hh] : null;
                        if (act && act[param.key] != null) {
                            var x = pad + (i / (filteredHours.length - 1)) * (w - 2 * pad);
                            var y = h2 - pad - ((act[param.key] - minV) / range) * (h2 - 2 * pad);
                            actualDots.push({ x: x, y: y, v: act[param.key] });
                        }
                    });

                    return React.createElement('div', { key: param.key, style: { background: 'white', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--gray-100)' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
                            React.createElement('i', { className: 'fa-solid ' + param.icon, style: { color: param.color, fontSize: 12 } }),
                            React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' } }, param.label),
                            React.createElement('span', { style: { fontSize: 10, color: 'var(--gray-400)', marginLeft: 'auto' } }, Math.round(minV * 10) / 10 + ' - ' + Math.round(maxV * 10) / 10 + ' ' + param.unit)
                        ),
                        React.createElement('svg', { width: w, height: h2, viewBox: '0 0 ' + w + ' ' + h2, style: { width: '100%', height: h2 } },
                            React.createElement('polyline', { points: points, fill: 'none', stroke: param.color, strokeWidth: 2, strokeLinejoin: 'round' }),
                            actualDots.map(function(d, di) {
                                return React.createElement('circle', { key: di, cx: d.x, cy: d.y, r: 3, fill: '#333', stroke: 'white', strokeWidth: 1 });
                            })
                        )
                    );
                };

                // ---- Hourly detail table ----
                var renderHourlyTable = function() {
                    return React.createElement('div', { className: 'panel', style: { overflow: 'hidden', marginTop: 16 } },
                        React.createElement('div', { style: { padding: '12px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 8 } },
                            React.createElement('i', { className: 'fa-solid fa-table', style: { color: 'var(--berry)', fontSize: 14 } }),
                            React.createElement('h3', { style: { margin: 0, fontSize: 14 } }, 'D\u00E9tail horaire')
                        ),
                        React.createElement('div', { style: { padding: 12, overflowX: 'auto' } },
                            React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 700 } },
                                React.createElement('thead', null,
                                    React.createElement('tr', { style: { borderBottom: '2px solid var(--gray-200)' } },
                                        React.createElement('th', { style: { textAlign: 'left', padding: '5px 6px', fontSize: 10, color: 'var(--gray-500)' } }, 'Heure'),
                                        HOURLY_PARAMS.map(function(pm) {
                                            return React.createElement('th', { key: pm.key, style: { textAlign: 'center', padding: '5px 6px', fontSize: 10, color: pm.color, fontWeight: 700 } },
                                                React.createElement('i', { className: 'fa-solid ' + pm.icon, style: { marginRight: 2 } }), ' ', pm.label
                                            );
                                        })
                                    )
                                ),
                                React.createElement('tbody', null,
                                    filteredHours.map(function(hr) {
                                        var hh = hr.time ? hr.time.slice(11, 13) + ':00' : '??';
                                        var act = actualMap[hh];
                                        var nowHour = new Date().getHours();
                                        var isPast = selectedDay === todayStr && parseInt(hh) < nowHour;
                                        return React.createElement('tr', { key: hr.time, style: { borderBottom: '1px solid var(--gray-50)', background: isPast ? '#fafafa' : 'white' } },
                                            React.createElement('td', { style: { padding: '5px 6px', fontWeight: 700, fontSize: 11, color: 'var(--gray-600)' } }, hh),
                                            HOURLY_PARAMS.map(function(pm) {
                                                var pv = hr[pm.key];
                                                var av = act ? act[pm.key] : null;
                                                var errColor = null;
                                                if (pv != null && av != null && av !== 0) {
                                                    var pct = Math.abs((pv - av) / av) * 100;
                                                    errColor = pct < 5 ? '#4CAF50' : (pct < 15 ? '#FF8F00' : '#E53935');
                                                }
                                                return React.createElement('td', { key: pm.key, style: { textAlign: 'center', padding: '5px 6px', borderLeft: '1px solid var(--gray-50)' } },
                                                    React.createElement('div', { style: { fontWeight: 600, color: errColor || 'var(--gray-700)' } }, pv != null ? (Math.round(pv * 10) / 10) : '\u2014'),
                                                    av != null ? React.createElement('div', { style: { fontSize: 9, color: 'var(--gray-400)' } }, '\u2192 ' + (Math.round(av * 10) / 10)) : null
                                                );
                                            })
                                        );
                                    })
                                )
                            )
                        )
                    );
                };

                // ---- Hourly MAPE scoring ----
                var hourlyMape = null;
                if (selectedDay === todayStr && actualHourly.length > 0) {
                    var totalErr = 0, count = 0;
                    filteredHours.forEach(function(hr) {
                        var hh = hr.time ? hr.time.slice(11, 13) + ':00' : null;
                        var act = hh ? actualMap[hh] : null;
                        if (!act) return;
                        HOURLY_PARAMS.forEach(function(pm) {
                            var pv = hr[pm.key], av = act[pm.key];
                            if (pv != null && av != null && av !== 0) {
                                totalErr += Math.abs((pv - av) / av) * 100;
                                count++;
                            }
                        });
                    });
                    if (count > 0) hourlyMape = Math.round(totalErr / count * 10) / 10;
                }

                return React.createElement('div', null,
                    // Day selector chips
                    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 } },
                        preds.map(function(p) {
                            var isActive = p.date === selectedDay;
                            var isToday = p.date === todayStr;
                            return React.createElement('button', { key: p.date, onClick: function() { setSelectedDay(p.date); }, style: { padding: '6px 14px', borderRadius: 20, border: isActive ? '2px solid var(--berry)' : '1px solid var(--gray-200)', background: isActive ? 'var(--berry)' : 'white', color: isActive ? 'white' : 'var(--gray-600)', fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: 'pointer' } },
                                isToday ? "Aujourd'hui" : formatFcDate(p.date)
                            );
                        })
                    ),
                    // Type selector
                    React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 16 } },
                        ['canarienne', 'tunnel'].map(function(t) {
                            var isActive = t === selectedType;
                            return React.createElement('button', { key: t, onClick: function() { setSelectedType(t); }, style: { padding: '6px 16px', borderRadius: 20, border: isActive ? '2px solid var(--berry)' : '1px solid var(--gray-200)', background: isActive ? 'var(--berry-light, #FFF0F5)' : 'white', color: isActive ? 'var(--berry)' : 'var(--gray-600)', fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: 'pointer' } },
                                t.charAt(0).toUpperCase() + t.slice(1)
                            );
                        })
                    ),
                    // Hourly MAPE badge
                    hourlyMape != null ? React.createElement('div', { style: { marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 } },
                        React.createElement('span', { style: { fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 12, background: hourlyMape < 10 ? '#4CAF5018' : (hourlyMape < 20 ? '#FF8F0018' : '#E5393518'), color: hourlyMape < 10 ? '#4CAF50' : (hourlyMape < 20 ? '#FF8F00' : '#E53935') } }, 'MAPE horaire: ' + hourlyMape + '%'),
                        React.createElement('span', { style: { fontSize: 11, color: 'var(--gray-400)' } }, 'Score: ' + Math.max(0, Math.round(100 - hourlyMape)) + '%')
                    ) : null,
                    // Sparkline charts grid
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 16 } },
                        HOURLY_PARAMS.map(function(pm) { return renderSparkline(pm); })
                    ),
                    // Hourly detail table
                    renderHourlyTable()
                );
            };

            var csL = liveScore('canarienne'), tsL = liveScore('tunnel');

            return React.createElement('div', { className: 'fade-in' },
                // Header
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' } },
                    React.createElement('i', { className: 'fa-solid fa-wand-magic-sparkles', style: { color: 'var(--berry)', fontSize: 20 } }),
                    React.createElement('h2', { style: { margin: 0, fontSize: 20, color: 'var(--gray-800)' } }, 'Forecast M\u00E9t\u00E9o Int\u00E9rieure \u2014 ML'),
                    globalMape != null && React.createElement('span', { style: { fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 700, background: globalMape < 10 ? '#4CAF5018' : (globalMape < 20 ? '#FF8F0018' : '#E5393518'), color: globalMape < 10 ? '#4CAF50' : (globalMape < 20 ? '#FF8F00' : '#E53935') } }, 'MAPE: ' + globalMape + '%'),
                    React.createElement('span', { style: { fontSize: 11, color: 'var(--gray-400)' } }, 'v' + (fcData.modelVersion || 1) + ' | Calibration auto'),
                    // View mode toggle
                    React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
                        React.createElement('button', { onClick: function() { setViewMode('daily'); }, style: { padding: '6px 14px', borderRadius: '8px 0 0 8px', border: '1px solid var(--gray-200)', background: viewMode === 'daily' ? 'var(--berry)' : 'white', color: viewMode === 'daily' ? 'white' : 'var(--gray-600)', fontSize: 12, fontWeight: 600, cursor: 'pointer' } },
                            React.createElement('i', { className: 'fa-solid fa-calendar-days', style: { marginRight: 4 } }), 'Journalier'),
                        React.createElement('button', { onClick: function() { setViewMode('hourly'); if (!selectedDay) setSelectedDay(todayStr); }, style: { padding: '6px 14px', borderRadius: '0 8px 8px 0', border: '1px solid var(--gray-200)', borderLeft: 'none', background: viewMode === 'hourly' ? 'var(--berry)' : 'white', color: viewMode === 'hourly' ? 'white' : 'var(--gray-600)', fontSize: 12, fontWeight: 600, cursor: 'pointer' } },
                            React.createElement('i', { className: 'fa-solid fa-clock', style: { marginRight: 4 } }), 'Horaire')
                    )
                ),

                viewMode === 'daily' ? React.createElement('div', null,
                    // Live scoring panel
                    (csL || tsL) && React.createElement('div', { className: 'panel', style: { marginBottom: 16, overflow: 'hidden' } },
                        React.createElement('div', { style: { padding: '12px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 } },
                            React.createElement('i', { className: 'fa-solid fa-bullseye', style: { color: 'var(--berry)', fontSize: 16 } }),
                            React.createElement('h3', { style: { margin: 0, fontSize: 15 } }, 'Score du jour \u2014 Predit vs Reel'),
                            React.createElement('span', { style: { fontSize: 10, color: 'var(--gray-400)', fontStyle: 'italic', marginLeft: 'auto' } }, 'Temps reel')
                        ),
                        React.createElement('div', { style: { padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 } },
                            [{ k: 'canarienne', n: 'Canarienne', d: csL }, { k: 'tunnel', n: 'Tunnel', d: tsL }].map(function(it) {
                                if (!it.d) return null;
                                return React.createElement('div', { key: it.k, style: { background: 'var(--gray-50)', borderRadius: 12, padding: 14 } },
                                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 } },
                                        React.createElement(Gauge, { score: it.d.sc }),
                                        React.createElement('div', null,
                                            React.createElement('div', { style: { fontSize: 14, fontWeight: 700 } }, it.n),
                                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)' } }, 'Erreur moy: ' + (it.d.av != null ? it.d.av + '%' : '\u2014')),
                                            React.createElement('div', { style: { fontSize: 11, fontWeight: 600, color: it.d.sc >= 80 ? '#4CAF50' : (it.d.sc >= 60 ? '#FF8F00' : '#E53935') } }, it.d.sc >= 90 ? 'Excellent' : (it.d.sc >= 80 ? 'Bon' : (it.d.sc >= 60 ? 'Acceptable' : 'A ameliorer')))
                                        )
                                    ),
                                    it.d.ms.map(function(m) {
                                        var bw = Math.min(100, m.pc), bc = m.pc < 5 ? '#4CAF50' : (m.pc < 15 ? '#FF8F00' : '#E53935');
                                        return React.createElement('div', { key: m.lb, style: { marginBottom: 5 } },
                                            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 } },
                                                React.createElement('span', { style: { fontWeight: 600, color: m.co } }, m.lb),
                                                React.createElement('span', { style: { color: 'var(--gray-500)' } }, 'P:' + m.pv + ' R:' + m.av + ' ' + m.u),
                                                React.createElement('span', { style: { fontWeight: 600, color: bc } }, (m.e > 0 ? '+' : '') + m.e + ' (' + m.pc + '%)')
                                            ),
                                            React.createElement('div', { style: { height: 4, background: '#e0e0e0', borderRadius: 2, overflow: 'hidden' } },
                                                React.createElement('div', { style: { height: '100%', width: bw + '%', background: bc, borderRadius: 2 } }))
                                        );
                                    })
                                );
                            })
                        )
                    ),
                    // Forecast grids
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 } },
                        renderSerreFC('canarienne', 'Canarienne \u2014 Pr\u00E9visions'),
                        renderSerreFC('tunnel', 'Tunnel \u2014 Pr\u00E9visions')
                    ),
                    // Accuracy history
                    React.createElement('div', { className: 'panel', style: { marginTop: 16, overflow: 'hidden' } },
                        React.createElement('div', { style: { padding: '12px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 } },
                            React.createElement('i', { className: 'fa-solid fa-chart-line', style: { color: 'var(--berry)', fontSize: 16 } }),
                            React.createElement('h3', { style: { margin: 0, fontSize: 15 } }, 'Historique Precision'),
                            accHistory.length > 0 && React.createElement('span', { style: { fontSize: 10, color: 'var(--gray-400)', marginLeft: 'auto' } }, accHistory.length + ' jours'),
                            accHistory.length > 0 && React.createElement('button', {
                                onClick: function() { exportAccHistoryCSV(accHistory); },
                                title: 'Exporter l\'historique en CSV',
                                style: { marginLeft: accHistory.length > 0 ? 8 : 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'white', color: 'var(--berry)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
                            },
                                React.createElement('i', { className: 'fa-solid fa-file-csv' }),
                                'Export CSV'
                            )
                        ),
                        React.createElement('div', { style: { padding: 16, overflowX: 'auto' } },
                            accHistory.length > 0 ? React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 } },
                                React.createElement('thead', null,
                                    React.createElement('tr', { style: { borderBottom: '2px solid var(--gray-200)' } },
                                        React.createElement('th', { style: { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, 'Date'),
                                        React.createElement('th', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)', borderLeft: '1px solid var(--gray-200)' } }, 'Canarienne'),
                                        React.createElement('th', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, '\u0394T.max'),
                                        React.createElement('th', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, '\u0394HR'),
                                        React.createElement('th', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)', borderLeft: '1px solid var(--gray-200)' } }, 'Tunnel'),
                                        React.createElement('th', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, '\u0394T.max'),
                                        React.createElement('th', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, '\u0394HR')
                                    )
                                ),
                                React.createElement('tbody', null,
                                    accHistory.map(function(a) {
                                        var sF = function(mp) { return mp != null ? Math.max(0, Math.round(100 - mp)) + '%' : '\u2014'; };
                                        var cF = function(mp) { return mp != null ? (mp < 5 ? '#4CAF50' : (mp < 10 ? '#8BC34A' : (mp < 20 ? '#FF8F00' : '#E53935'))) : 'var(--gray-400)'; };
                                        return React.createElement('tr', { key: a.date, style: { borderBottom: '1px solid var(--gray-100)' } },
                                            React.createElement('td', { style: { padding: '5px 8px', fontWeight: 600, fontSize: 11 } }, formatFcDate(a.date)),
                                            React.createElement('td', { style: { textAlign: 'center', padding: '5px 8px', fontWeight: 700, color: cF(a.canarienne ? a.canarienne.mape : null), borderLeft: '1px solid var(--gray-100)' } }, sF(a.canarienne ? a.canarienne.mape : null)),
                                            React.createElement('td', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, a.canarienne && a.canarienne.tMax_error != null ? (a.canarienne.tMax_error > 0 ? '+' : '') + a.canarienne.tMax_error + '\u00B0' : '\u2014'),
                                            React.createElement('td', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, a.canarienne && a.canarienne.hr_error != null ? (a.canarienne.hr_error > 0 ? '+' : '') + a.canarienne.hr_error + '%' : '\u2014'),
                                            React.createElement('td', { style: { textAlign: 'center', padding: '5px 8px', fontWeight: 700, color: cF(a.tunnel ? a.tunnel.mape : null), borderLeft: '1px solid var(--gray-100)' } }, sF(a.tunnel ? a.tunnel.mape : null)),
                                            React.createElement('td', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, a.tunnel && a.tunnel.tMax_error != null ? (a.tunnel.tMax_error > 0 ? '+' : '') + a.tunnel.tMax_error + '\u00B0' : '\u2014'),
                                            React.createElement('td', { style: { textAlign: 'center', padding: '5px 8px', fontSize: 11, color: 'var(--gray-500)' } }, a.tunnel && a.tunnel.hr_error != null ? (a.tunnel.hr_error > 0 ? '+' : '') + a.tunnel.hr_error + '%' : '\u2014')
                                        );
                                    })
                                )
                            ) : React.createElement('div', { style: { textAlign: 'center', padding: 24, color: 'var(--gray-400)', fontSize: 13 } },
                                React.createElement('i', { className: 'fa-solid fa-hourglass-half', style: { fontSize: 20, marginBottom: 8, display: 'block' } }),
                                'Le scoring historique demarre demain. Le modele compare chaque jour ses previsions avec les mesures reelles FarmRoad.')
                        )
                    )
                ) : renderHourlyView()
            );
        }

export { AgroForecastTab };
