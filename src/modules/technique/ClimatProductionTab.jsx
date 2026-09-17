/* Module: technique | Déclaration(s): ClimatProductionTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== CLIMAT-PRODUCTION TAB =====================
        function ClimatProductionTab() {
            const [data, setData] = useState(null);
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [variete, setVariete] = useState('');
            const [days, setDays] = useState(7);
            const [activeIndicator, setActiveIndicator] = useState('imc');

            useEffect(() => {
                let cancelled = false;
                async function load() {
                    setLoading(true); setError(null);
                    try {
                        var user = firebase.auth().currentUser;
                        var token = user ? await user.getIdToken() : null;
                        var url = '/api/climat-production?days=' + days;
                        if (variete) url += '&variete=' + encodeURIComponent(variete);
                        var resp = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
                        var json = await resp.json();
                        if (!cancelled) {
                            if (json.success) { setData(json); if (!variete && json.varietesDisponibles && json.varietesDisponibles.length > 0) setVariete(json.varietesDisponibles[0]); }
                            else setError(json.error || 'Erreur inconnue');
                        }
                    } catch(e) { if (!cancelled) setError(e.message); }
                    if (!cancelled) setLoading(false);
                }
                load();
                return () => { cancelled = true; };
            }, [days, variete]);

            if (loading) return React.createElement('div', { style: { textAlign: 'center', padding: 40 } },
                React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24, color: 'var(--berry)' } }),
                React.createElement('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--gray-400)' } }, 'Analyse climat-production...')
            );
            if (error) return React.createElement('div', { className: 'card', style: { padding: 20, color: '#dc2626' } }, 'Erreur: ' + error);
            if (!data || !data.dailyData || data.dailyData.length === 0) return React.createElement('div', { className: 'card', style: { padding: 24, textAlign: 'center' } },
                React.createElement('i', { className: 'fa-solid fa-chart-line', style: { fontSize: 32, color: 'var(--gray-300)', display: 'block', marginBottom: 12 } }),
                React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } }, 'Aucune donn\u00e9e de production disponible'),
                React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-400)', marginTop: 4 } }, 'V\u00e9rifiez que des donn\u00e9es de cueillette existent pour la p\u00e9riode s\u00e9lectionn\u00e9e.')
            );

            // --- Controls ---
            var controls = React.createElement('div', { className: 'card', style: { padding: 16, marginBottom: 16 } },
                React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' } },
                    React.createElement('div', { style: { flex: 1, minWidth: 180 } },
                        React.createElement('label', { style: { fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: 4 } }, 'Vari\u00e9t\u00e9'),
                        React.createElement('select', {
                            value: variete, onChange: function(e) { setVariete(e.target.value); },
                            style: { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff' }
                        },
                            data.varietesDisponibles.map(function(v) { return React.createElement('option', { key: v, value: v }, v); })
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { style: { fontSize: 11, fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: 4 } }, 'P\u00e9riode'),
                        React.createElement('div', { className: 'chip-group' },
                            [7, 15, 30, 45].map(function(d) {
                                return React.createElement('button', {
                                    key: d, onClick: function() { setDays(d); },
                                    className: 'chip c-berry' + (days === d ? ' active' : ''),
                                    style: { padding: '6px 14px', fontSize: 12 }
                                }, d + 'j');
                            })
                        )
                    )
                )
            );

            // --- Dual-axis SVG chart ---
            var daily = data.dailyData.filter(function(d) { return d.production_kg > 0 || d[activeIndicator] !== null; });
            var svgW = 720, svgH = 260, padL = 55, padR = 55, padT = 20, padB = 40;
            var plotW = svgW - padL - padR, plotH = svgH - padT - padB;
            var maxProd = Math.max.apply(null, daily.map(function(d) { return d.production_kg; }).concat([1]));
            var indicatorVals = daily.map(function(d) { return d[activeIndicator]; }).filter(function(v) { return v !== null; });
            var maxInd, minInd;
            if (activeIndicator === 'imc') {
                minInd = 0; maxInd = 100;
            } else {
                maxInd = indicatorVals.length > 0 ? Math.max.apply(null, indicatorVals) : 1;
                minInd = indicatorVals.length > 0 ? Math.min.apply(null, indicatorVals) : 0;
            }
            var indRange = maxInd - minInd || 1;
            var barW = daily.length > 0 ? Math.max(4, Math.min(20, (plotW / daily.length) * 0.6)) : 10;

            var indicatorLabels = { imc: 'Maturit\u00e9 (%)', gdd_cumule: 'GDD cumul\u00e9 (\u00b0Cd)', delta_t: '\u0394T (\u00b0C)', vpd: 'VPD (kPa)', dli: 'DLI (mol)' };
            var indicatorColors = { imc: '#dc2626', gdd_cumule: '#10b981', delta_t: '#f59e0b', vpd: '#8b5cf6', dli: '#3b82f6' };
            var imcAlerteColors = {
                PRECOCE: { bg: '#dbeafe', color: '#1d4ed8', label: 'Pr\u00e9coce' },
                EN_COURS: { bg: '#fef3c7', color: '#b45309', label: 'En cours' },
                SURVEILLER_J3: { bg: '#ffedd5', color: '#c2410c', label: 'Surveiller J-3' },
                RECOLTE_IMMINENTE: { bg: '#fee2e2', color: '#dc2626', label: 'R\u00e9colte imminente !' }
            };
            var imcBands = [
                { from: 0, to: 50, color: '#dbeafe', label: 'Pr\u00e9coce' },
                { from: 50, to: 70, color: '#fef3c7', label: 'En cours' },
                { from: 70, to: 85, color: '#ffedd5', label: 'Surveiller J-3' },
                { from: 85, to: 100, color: '#fee2e2', label: 'R\u00e9colte imminente' }
            ];

            var bars = daily.map(function(d, i) {
                var x = padL + (i + 0.5) * (plotW / daily.length) - barW / 2;
                var h = (d.production_kg / maxProd) * plotH;
                return React.createElement('rect', { key: 'b' + i, x: x, y: padT + plotH - h, width: barW, height: h, fill: 'var(--berry)', opacity: 0.6, rx: 2 },
                    React.createElement('title', null, d.date + ': ' + d.production_kg + ' kg')
                );
            });

            var linePoints = [];
            daily.forEach(function(d, i) {
                if (d[activeIndicator] !== null) {
                    var x = padL + (i + 0.5) * (plotW / daily.length);
                    var y = padT + plotH - ((d[activeIndicator] - minInd) / indRange) * plotH;
                    linePoints.push({ x: x, y: y, val: d[activeIndicator], date: d.date });
                }
            });
            var linePath = linePoints.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');

            var xLabels = daily.map(function(d, i) {
                var step = daily.length > 20 ? 5 : daily.length > 10 ? 3 : 1;
                if (i % step !== 0 && i !== daily.length - 1) return null;
                var x = padL + (i + 0.5) * (plotW / daily.length);
                return React.createElement('text', { key: 'xl' + i, x: x, y: padT + plotH + 16, fontSize: 8.5, fill: '#9ca3af', textAnchor: 'middle', transform: 'rotate(-30,' + x + ',' + (padT + plotH + 16) + ')' }, d.date.slice(5));
            });

            var yTicksProd = [];
            for (var t = 0; t <= 4; t++) {
                var val = Math.round(maxProd * t / 4);
                var yy = padT + plotH - (val / maxProd) * plotH;
                yTicksProd.push(React.createElement('text', { key: 'yp' + t, x: padL - 6, y: yy + 3, fontSize: 9, fill: '#9ca3af', textAnchor: 'end' }, val));
                yTicksProd.push(React.createElement('line', { key: 'ypl' + t, x1: padL, y1: yy, x2: padL + plotW, y2: yy, stroke: '#f3f4f6', strokeWidth: 0.5 }));
            }

            var yTicksInd = [];
            for (var t2 = 0; t2 <= 4; t2++) {
                var val2 = Math.round((minInd + indRange * t2 / 4) * 10) / 10;
                var yy2 = padT + plotH - (t2 / 4) * plotH;
                yTicksInd.push(React.createElement('text', { key: 'yi' + t2, x: padL + plotW + 6, y: yy2 + 3, fontSize: 9, fill: indicatorColors[activeIndicator], textAnchor: 'start' }, val2));
            }

            var chart = React.createElement('div', { className: 'card', style: { padding: 20, marginBottom: 16 } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 } },
                    React.createElement('h4', { style: { margin: 0, fontSize: 14, fontWeight: 600 } }, 'Production vs Maturité'),
                    React.createElement('span', { style: { fontSize: 11, color: 'var(--gray-400)' } }, 'Indice de Maturation Composite (IMC) — 0 à 100%')
                ),
                React.createElement('svg', { viewBox: '0 0 ' + svgW + ' ' + svgH, style: { width: '100%', height: 'auto' } },
                    activeIndicator === 'imc' ? imcBands.map(function(b, i) {
                        var y1 = padT + plotH - (b.to / 100) * plotH;
                        var y2 = padT + plotH - (b.from / 100) * plotH;
                        return React.createElement('rect', { key: 'imcb' + i, x: padL, y: y1, width: plotW, height: y2 - y1, fill: b.color, opacity: 0.45 },
                            React.createElement('title', null, b.label + ' (' + b.from + '–' + b.to + '%)'));
                    }) : null,
                    yTicksProd, yTicksInd, bars, xLabels,
                    linePath && React.createElement('path', { d: linePath, fill: 'none', stroke: indicatorColors[activeIndicator], strokeWidth: 2.5, strokeLinejoin: 'round' }),
                    linePoints.map(function(p, i) {
                        return React.createElement('circle', { key: 'lp' + i, cx: p.x, cy: p.y, r: 2.5, fill: indicatorColors[activeIndicator], stroke: '#fff', strokeWidth: 1 });
                    }),
                    React.createElement('text', { x: 10, y: padT + plotH / 2, fontSize: 9, fill: '#9ca3af', textAnchor: 'middle', transform: 'rotate(-90,10,' + (padT + plotH / 2) + ')' }, 'Production (kg)'),
                    React.createElement('text', { x: svgW - 6, y: padT + plotH / 2, fontSize: 9, fill: indicatorColors[activeIndicator], textAnchor: 'middle', transform: 'rotate(90,' + (svgW - 6) + ',' + (padT + plotH / 2) + ')' }, indicatorLabels[activeIndicator]),
                    React.createElement('line', { x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, stroke: '#e5e7eb', strokeWidth: 1 }),
                    React.createElement('line', { x1: padL, y1: padT, x2: padL, y2: padT + plotH, stroke: '#e5e7eb', strokeWidth: 1 })
                ),
                React.createElement('div', { style: { display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 11, color: 'var(--gray-400)' } },
                    React.createElement('span', null, React.createElement('span', { style: { display: 'inline-block', width: 12, height: 12, background: 'var(--berry)', opacity: 0.6, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' } }), 'Production (kg)'),
                    React.createElement('span', null, React.createElement('span', { style: { display: 'inline-block', width: 12, height: 3, background: indicatorColors[activeIndicator], borderRadius: 2, marginRight: 4, verticalAlign: 'middle' } }), indicatorLabels[activeIndicator])
                )
            );

            // --- Tendance jours actifs (sparkline) ---
            var tend = data.tendance || { jours_actifs: [] };
            var actifs = tend.jours_actifs || [];
            var tendCard = null;
            if (actifs.length >= 2) {
                var maxP = Math.max.apply(null, actifs.map(function(a) { return a.prod || 0; }).concat([1]));
                var spW = 320, spH = 60;
                var spStep = actifs.length > 1 ? spW / (actifs.length - 1) : 0;
                var prodPath = actifs.map(function(a, i) {
                    var x = i * spStep;
                    var y = spH - (a.prod / maxP) * (spH - 6) - 3;
                    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
                }).join(' ');
                var imcPath = actifs.map(function(a, i) {
                    if (a.imc == null) return null;
                    var x = i * spStep;
                    var y = spH - (a.imc / 100) * (spH - 6) - 3;
                    return { x: x, y: y };
                }).filter(Boolean).map(function(p, i) {
                    return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
                }).join(' ');
                var slopeStr = (tend.prod_slope_kg_par_jour >= 0 ? '+' : '') + tend.prod_slope_kg_par_jour + ' kg/j';
                var imcSlopeStr = (tend.imc_slope_par_jour >= 0 ? '+' : '') + tend.imc_slope_par_jour + ' pts/j';
                tendCard = React.createElement('div', { className: 'card', style: { padding: 16, marginBottom: 16 } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 } },
                        React.createElement('h4', { style: { margin: 0, fontSize: 14, fontWeight: 600 } }, 'Tendance ' + actifs.length + ' derniers jours actifs'),
                        React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)' } },
                            React.createElement('span', { style: { color: 'var(--berry)', fontWeight: 700, marginRight: 12 } }, 'Production : ' + slopeStr),
                            React.createElement('span', { style: { color: '#dc2626', fontWeight: 700 } }, 'Maturité : ' + imcSlopeStr)
                        )
                    ),
                    React.createElement('svg', { viewBox: '0 0 ' + spW + ' ' + spH, style: { width: '100%', height: 80 } },
                        prodPath && React.createElement('path', { d: prodPath, fill: 'none', stroke: '#9d174d', strokeWidth: 2.5, strokeLinejoin: 'round' }),
                        imcPath && React.createElement('path', { d: imcPath, fill: 'none', stroke: '#dc2626', strokeWidth: 2, strokeLinejoin: 'round', strokeDasharray: '3,3' })
                    ),
                    React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginTop: 4 } }, 'Trait plein = production (kg) — Pointillé = maturité IMC (%)')
                );
            }

            // Variables conservées vides (anciennes corrélations supprimées) pour ne pas casser le reste du rendu.
            var corrs = [], bestLag = null;
            var corrColors = { 'Forte': '#16a34a', 'Mod\u00e9r\u00e9e': '#f59e0b', 'Mod\u00e9r\u00e9e (inverse)': '#f59e0b', 'Faible': '#9ca3af', 'Non significative': '#d1d5db' };

            var corrTable = React.createElement('div', { className: 'card', style: { padding: 20, marginBottom: 16 } },
                React.createElement('h4', { style: { margin: '0 0 12px 0', fontSize: 14, fontWeight: 600 } }, 'Maturit\u00e9 \u2194 Production : test des d\u00e9calages courts'),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 12 } }, 'Coefficient de Pearson \u2014 quel d\u00e9calage pr\u00e9dit le mieux la r\u00e9colte du jour ? (J = m\u00eame jour, J-1 = veille)'),
                corrs.length === 0 ? React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-400)' } }, 'Pas assez de donn\u00e9es pour calculer les corr\u00e9lations.') :
                React.createElement('div', { style: { overflowX: 'auto' } },
                    React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 } },
                        React.createElement('thead', null,
                            React.createElement('tr', { style: { borderBottom: '2px solid #e5e7eb' } },
                                React.createElement('th', { style: { textAlign: 'left', padding: '8px 6px', fontWeight: 600, color: 'var(--gray-600)' } }, 'Indicateur'),
                                React.createElement('th', { style: { textAlign: 'center', padding: '8px 6px', fontWeight: 600, color: 'var(--gray-600)' } }, 'r'),
                                React.createElement('th', { style: { textAlign: 'center', padding: '8px 6px', fontWeight: 600, color: 'var(--gray-600)' } }, 'D\u00e9calage'),
                                React.createElement('th', { style: { textAlign: 'left', padding: '8px 6px', fontWeight: 600, color: 'var(--gray-600)' } }, 'Force'),
                                React.createElement('th', { style: { textAlign: 'left', padding: '8px 6px', fontWeight: 600, color: 'var(--gray-600)' } }, '')
                            )
                        ),
                        React.createElement('tbody', null,
                            corrs.map(function(entry) {
                                var key = entry[0], c = entry[1];
                                var absR = Math.abs(c.r);
                                var barPct = Math.round(absR * 100);
                                var interpColor = corrColors[c.interpretation] || '#9ca3af';
                                var isBest = bestLag === c.lag_optimal;
                                var lagLabel = c.lag_optimal === 0 ? 'J (jour même)' : 'J-' + c.lag_optimal;
                                return React.createElement('tr', { key: key, style: { borderBottom: '1px solid #f3f4f6', background: isBest ? '#fef2f2' : 'transparent' } },
                                    React.createElement('td', { style: { padding: '10px 6px', fontWeight: 600 } },
                                        React.createElement('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#dc2626', marginRight: 6, verticalAlign: 'middle' } }),
                                        c.label || key,
                                        isBest ? React.createElement('span', { style: { marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 8, background: '#dc2626', color: '#fff', fontWeight: 700 } }, 'meilleur') : null
                                    ),
                                    React.createElement('td', { style: { textAlign: 'center', padding: '10px 6px', fontWeight: 700, color: c.r >= 0 ? '#16a34a' : '#dc2626' } }, (c.r >= 0 ? '+' : '') + c.r.toFixed(2)),
                                    React.createElement('td', { style: { textAlign: 'center', padding: '10px 6px' } },
                                        React.createElement('span', { style: { background: '#f3f4f6', padding: '3px 10px', borderRadius: 12, fontWeight: 600, fontSize: 11 } }, lagLabel)
                                    ),
                                    React.createElement('td', { style: { padding: '10px 6px' } },
                                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                                            React.createElement('div', { style: { width: 80, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' } },
                                                React.createElement('div', { style: { width: barPct + '%', height: '100%', background: interpColor, borderRadius: 4 } })
                                            ),
                                            React.createElement('span', { style: { fontSize: 11, color: interpColor, fontWeight: 600 } }, c.interpretation)
                                        )
                                    ),
                                    React.createElement('td', { style: { padding: '10px 6px', fontSize: 11, color: 'var(--gray-400)' } },
                                        c.r > 0 ? '\u2191 Plus \u00e9lev\u00e9 = plus de kg' : c.r < 0 ? '\u2191 Plus \u00e9lev\u00e9 = moins de kg' : ''
                                    )
                                );
                            })
                        )
                    )
                )
            );

            // --- Pr\u00e9vision demain + recommandation \u00e9quipe (c\u0153ur op\u00e9rationnel) ---
            var pred = data.prediction;
            var reco = data.teamRecommendation;
            var ft = data.forecastTomorrow;
            var predCard;
            if (pred && reco) {
                var ftAlerteKey = (ft && ft.alerte) || pred.alerte_demain || (pred.imc_aujourdhui >= 85 ? 'RECOLTE_IMMINENTE' : pred.imc_aujourdhui >= 70 ? 'SURVEILLER_J3' : pred.imc_aujourdhui >= 50 ? 'EN_COURS' : 'PRECOCE');
                var ftAlerteInfo = imcAlerteColors[ftAlerteKey] || imcAlerteColors.PRECOCE;
                var recoColors = {
                    augmenter: { bg: '#dcfce7', color: '#166534', border: '#16a34a', icon: 'fa-arrow-trend-up', verbe: 'Renforcer' },
                    reduire: { bg: '#fee2e2', color: '#991b1b', border: '#dc2626', icon: 'fa-arrow-trend-down', verbe: 'R\u00e9duire' },
                    stable: { bg: '#f3f4f6', color: '#374151', border: '#9ca3af', icon: 'fa-equals', verbe: 'Maintenir' }
                };
                var rc = recoColors[reco.action] || recoColors.stable;
                var deltaSign = reco.delta_pct > 0 ? '+' : '';
                predCard = React.createElement('div', { className: 'card', style: { padding: 20, marginBottom: 16, border: '2px solid ' + rc.border, background: '#fff' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 } },
                        React.createElement('div', { style: { width: 44, height: 44, borderRadius: 12, background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
                            React.createElement('i', { className: 'fa-solid ' + rc.icon, style: { fontSize: 20, color: rc.color } })
                        ),
                        React.createElement('div', null,
                            React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: 'var(--gray-800)' } }, 'Pr\u00e9vision demain' + (ft ? ' \u2014 ' + ft.date : '')),
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)' } }, pred.source)
                        )
                    ),
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 16 } },
                        React.createElement('div', { style: { padding: 12, background: '#fafafa', borderRadius: 10 } },
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 } }, 'Production estim\u00e9e'),
                            React.createElement('div', { style: { fontSize: 28, fontWeight: 800, color: 'var(--berry)', lineHeight: 1 } }, '~' + pred.kg_estime + ' kg'),
                            React.createElement('div', { style: { fontSize: 10, color: 'var(--gray-400)', marginTop: 4 } }, 'vs base ' + pred.baseline_kg + ' kg')
                        ),
                        React.createElement('div', { style: { padding: 12, background: ftAlerteInfo.bg, borderRadius: 10 } },
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 } }, 'Maturit\u00e9 demain'),
                            React.createElement('div', { style: { fontSize: 28, fontWeight: 800, color: ftAlerteInfo.color, lineHeight: 1 } }, (pred.imc_demain != null ? pred.imc_demain : pred.imc_aujourdhui) + '%'),
                            React.createElement('div', { style: { fontSize: 10, color: ftAlerteInfo.color, marginTop: 4, fontWeight: 600 } }, ftAlerteInfo.label)
                        ),
                        React.createElement('div', { style: { padding: 12, background: rc.bg, borderRadius: 10, border: '1px dashed ' + rc.border } },
                            React.createElement('div', { style: { fontSize: 11, color: rc.color, marginBottom: 4, fontWeight: 600 } }, 'Recommandation \u00e9quipe'),
                            React.createElement('div', { style: { fontSize: 22, fontWeight: 800, color: rc.color, lineHeight: 1.1 } }, rc.verbe + ' ' + (reco.action !== 'stable' ? deltaSign + reco.delta_pct + '%' : '')),
                            React.createElement('div', { style: { fontSize: 10, color: rc.color, marginTop: 4 } }, reco.action === 'stable' ? 'Variation < 15 %' : 'Volume vs moyenne 3 j actifs')
                        )
                    ),
                    React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)', display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid #f3f4f6' } },
                        React.createElement('span', null, 'Tendance prod : \u00d7' + pred.facteur_tendance),
                        React.createElement('span', null, 'Zone maturit\u00e9 : \u00d7' + pred.facteur_zone),
                        React.createElement('span', null, '\u0394 IMC J\u2192J+1 : \u00d7' + pred.facteur_delta_imc),
                        ft ? React.createElement('span', null, 'Tmax demain : ' + ft.tmax + ' \u00b0C') : null,
                        ft ? React.createElement('span', null, 'HR : ' + ft.hr + ' %') : null
                    )
                );
            } else {
                predCard = React.createElement('div', { className: 'card', style: { padding: 20, marginBottom: 16, background: '#fefce8' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                        React.createElement('i', { className: 'fa-solid fa-circle-info', style: { color: '#ca8a04' } }),
                        React.createElement('span', { style: { fontSize: 12, color: '#854d0e' } }, 'Pas encore assez de jours actifs de r\u00e9colte pour g\u00e9n\u00e9rer une pr\u00e9vision (minimum 2 jours avec r\u00e9colte > 0).')
                    )
                );
            }

            // --- Photo placeholder ---
            var photoPlaceholder = React.createElement('div', { className: 'card', style: { padding: 20, background: '#f9fafb', border: '2px dashed #e5e7eb', textAlign: 'center' } },
                React.createElement('i', { className: 'fa-solid fa-camera', style: { fontSize: 28, color: 'var(--gray-300)', marginBottom: 8, display: 'block' } }),
                React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4 } }, 'Photos terrain'),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)' } }, 'Bient\u00f4t disponible \u2014 t\u00e9l\u00e9charger des photos de la parcelle pour affiner les pr\u00e9dictions.')
            );

            // --- Statut maturité aujourd'hui ---
            var lastImcDay = null;
            for (var li = data.dailyData.length - 1; li >= 0; li--) {
                if (data.dailyData[li].imc != null) { lastImcDay = data.dailyData[li]; break; }
            }
            var maturityCard = null;
            if (lastImcDay) {
                var alerteKey = lastImcDay.alerte || (lastImcDay.imc >= 85 ? 'RECOLTE_IMMINENTE' : lastImcDay.imc >= 70 ? 'SURVEILLER_J3' : lastImcDay.imc >= 50 ? 'EN_COURS' : 'PRECOCE');
                var alerteInfo = imcAlerteColors[alerteKey] || imcAlerteColors.PRECOCE;
                var gddCible = 300; // GDD_CIBLE backend
                var gddCum = lastImcDay.gdd_cumule;
                var pctGdd = gddCum != null ? Math.min(100, Math.round((gddCum / gddCible) * 100)) : null;
                maturityCard = React.createElement('div', { className: 'card', style: { padding: 16, marginBottom: 16, borderLeft: '4px solid ' + alerteInfo.color } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' } },
                        React.createElement('div', { style: { flex: '0 0 auto' } },
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 } }, 'Statut maturité — ' + lastImcDay.date),
                            React.createElement('div', { style: { fontSize: 28, fontWeight: 800, color: alerteInfo.color, lineHeight: 1 } }, lastImcDay.imc + '%'),
                            React.createElement('span', { style: { display: 'inline-block', marginTop: 6, padding: '3px 10px', borderRadius: 12, background: alerteInfo.bg, color: alerteInfo.color, fontSize: 11, fontWeight: 700 } }, alerteInfo.label)
                        ),
                        React.createElement('div', { style: { flex: 1, minWidth: 180 } },
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 } }, 'GDD cumulé / cible (' + gddCible + ' °Cd)'),
                            React.createElement('div', { style: { fontSize: 16, fontWeight: 700 } }, (gddCum != null ? gddCum : '—') + ' °Cd' + (pctGdd != null ? '  (' + pctGdd + '%)' : '')),
                            React.createElement('div', { style: { width: '100%', height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden', marginTop: 6 } },
                                React.createElement('div', { style: { width: (pctGdd || 0) + '%', height: '100%', background: alerteInfo.color, borderRadius: 4 } })
                            )
                        ),
                        React.createElement('div', { style: { flex: 1, minWidth: 200, fontSize: 12, color: 'var(--gray-500)' } },
                            React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'Lecture'),
                            alerteKey === 'RECOLTE_IMMINENTE' ? 'Pic de récolte attendu sous 24–72 h. Mobiliser les équipes.' :
                            alerteKey === 'SURVEILLER_J3' ? 'Récolte sous 3 à 5 jours. Préparer la logistique cueillette.' :
                            alerteKey === 'EN_COURS' ? 'Maturation en cours. Continuer le suivi quotidien.' :
                            'Stade précoce. Pas d\'action récolte requise.'
                        )
                    )
                );
            }

            return React.createElement('div', { className: 'fade-in' }, controls, maturityCard, predCard, chart, tendCard, photoPlaceholder);
        }

export { ClimatProductionTab };
