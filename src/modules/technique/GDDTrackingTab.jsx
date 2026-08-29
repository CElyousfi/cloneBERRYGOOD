/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): GDDTrackingTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== GDD TRACKING WIDGET =====================
        function GDDTrackingTab() {
            const [data, setData] = useState(null);
            const [loading, setLoading] = useState(true);
            const [error, setError] = useState(null);
            const [backfilling, setBackfilling] = useState(false);
            const [backfillMsg, setBackfillMsg] = useState('');

            useEffect(() => {
                async function fetchGDD() {
                    try {
                        const user = firebase.auth().currentUser;
                        const token = user ? await user.getIdToken() : null;
                        const resp = await fetch('/api/gdd-tracking', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
                        const json = await resp.json();
                        if (json.success) setData(json);
                        else setError(json.error || 'Erreur');
                    } catch (e) { setError(e.message); }
                    finally { setLoading(false); }
                }
                fetchGDD();
            }, []);

            if (loading) return React.createElement('div', { style: { textAlign: 'center', padding: 40 } },
                React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 24, color: 'var(--berry)' } })
            );
            if (error) return React.createElement('div', { className: 'card', style: { padding: 20, color: '#dc2626' } }, 'Erreur: ' + error);
            async function doBackfill() {
                setBackfilling(true); setBackfillMsg('Calcul en cours...');
                try {
                    var user = firebase.auth().currentUser;
                    var token = user ? await user.getIdToken() : null;
                    var resp = await fetch('/api/gdd-tracking?action=backfill', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {} });
                    var json = await resp.json();
                    if (json.success) {
                        setBackfillMsg('OK ! ' + json.backfilled + ' jour(s) calcul\u00e9(s). Rechargement...');
                        setTimeout(function() { window.location.reload(); }, 1500);
                    } else {
                        setBackfillMsg('Erreur: ' + (json.error || JSON.stringify(json)));
                        setBackfilling(false);
                    }
                } catch(e) { setBackfillMsg('Erreur: ' + e.message); setBackfilling(false); }
            }

            if (!data || data.data.length === 0) {
                return React.createElement('div', { className: 'card', style: { padding: 24, textAlign: 'center' } },
                    React.createElement('i', { className: 'fa-solid fa-seedling', style: { fontSize: 32, color: 'var(--green)', marginBottom: 12, display: 'block' } }),
                    React.createElement('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 8 } }, 'Suivi GDD \u2014 ' + (data && data.config ? data.config.variete : 'Maravilla Long Cane')),
                    React.createElement('div', { style: { fontSize: 12, color: 'var(--gray-400)', marginBottom: 16 } }, 'J0 : ' + (data && data.config ? data.config.j0 : '2026-03-29') + ' \u2022 Aucune donn\u00e9e calcul\u00e9e'),
                    React.createElement('button', {
                        onClick: doBackfill, disabled: backfilling,
                        className: 'chip c-berry active',
                        style: { padding: '10px 24px', fontSize: 13, cursor: backfilling ? 'wait' : 'pointer' }
                    }, backfilling ? React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { marginRight: 6 } }) : React.createElement('i', { className: 'fa-solid fa-play', style: { marginRight: 6 } }), backfilling ? 'Calcul...' : 'Initialiser le suivi GDD'),
                    backfillMsg && React.createElement('div', { style: { marginTop: 12, fontSize: 12, color: backfillMsg.startsWith('Erreur') ? '#dc2626' : 'var(--green)' } }, backfillMsg)
                );
            }

            const latest = data.data[data.data.length - 1];
            const gddPct = Math.min(100, Math.round((data.gddCumule / data.config.gddCible) * 100));
            const alerteColors = {
                PRECOCE: { bg: '#dbeafe', color: '#1d4ed8', label: 'Pr\u00e9coce' },
                EN_COURS: { bg: '#fef3c7', color: '#b45309', label: 'En cours' },
                SURVEILLER_J3: { bg: '#ffedd5', color: '#c2410c', label: 'Surveiller J-3' },
                RECOLTE_IMMINENTE: { bg: '#fee2e2', color: '#dc2626', label: 'R\u00e9colte imminente !' },
            };
            const alerte = alerteColors[latest.alerte] || alerteColors.PRECOCE;
            const chartData = data.data;
            const svgW = 700, svgH = 220, padL = 50, padR = 20, padT = 20, padB = 35;
            const plotW = svgW - padL - padR, plotH = svgH - padT - padB;
            const maxGDD = Math.max(data.config.gddCible, data.gddCumule + 20);
            const xScale = chartData.length > 1 ? plotW / (chartData.length - 1) : plotW;
            const yScale = plotH / maxGDD;
            const points = chartData.map(function(d, i) {
                var x = padL + i * xScale;
                var y = padT + plotH - d.gdd_cumule * yScale;
                return { x: x, y: y, d: d };
            });
            const linePath = points.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
            const y250 = padT + plotH - 250 * yScale;
            const y350 = padT + plotH - 350 * yScale;
            const dif = latest.tmax - latest.tmin;

            return React.createElement('div', { className: 'fade-in' },
                React.createElement('div', { className: 'card', style: { padding: 24, marginBottom: 16 } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
                        React.createElement('div', null,
                            React.createElement('h3', { style: { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--gray-800)' } }, 'Suivi Maturation \u2014 ' + data.config.variete),
                            React.createElement('span', { style: { fontSize: 12, color: 'var(--gray-400)' } }, 'J0 : ' + data.config.j0 + ' \u2022 Jour ' + data.joursDepuisJ0)
                        ),
                        React.createElement('span', { style: { background: alerte.bg, color: alerte.color, padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600 } }, alerte.label)
                    ),
                    React.createElement('div', { style: { marginBottom: 12 } },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 } },
                            React.createElement('span', { style: { fontWeight: 600 } }, 'GDD Cumul\u00e9s'),
                            React.createElement('span', { style: { fontWeight: 700, color: 'var(--berry)' } }, data.gddCumule + ' / ' + data.config.gddCible + ' \u00b0Cd')
                        ),
                        React.createElement('div', { className: 'progress-bar', style: { height: 10, borderRadius: 5 } },
                            React.createElement('div', { className: 'fill berry', style: { width: gddPct + '%', borderRadius: 5 } })
                        ),
                        React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginTop: 4, textAlign: 'right' } }, gddPct + '%')
                    ),
                    React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
                        React.createElement('div', { style: { flex: 1, minWidth: 140, background: 'var(--gray-50)', borderRadius: 10, padding: 14, textAlign: 'center' } },
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 } }, 'IMC (Indice Maturation)'),
                            React.createElement('div', { style: { fontSize: 28, fontWeight: 700, color: 'var(--berry)' } }, latest.imc_pourcentage + '%')
                        ),
                        data.jourRecolteEstime && React.createElement('div', { style: { flex: 1, minWidth: 140, background: 'var(--gray-50)', borderRadius: 10, padding: 14, textAlign: 'center' } },
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 } }, 'R\u00e9colte estim\u00e9e'),
                            React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--green)' } }, new Date(data.jourRecolteEstime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })),
                            React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-400)' } }, 'GDD moy/jour: ' + data.gddMoyenJour + ' \u00b0Cd')
                        )
                    )
                ),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 } },
                    React.createElement('div', { className: 'kpi-card', style: { padding: 14 } },
                        React.createElement('div', { className: 'kpi-icon berry', style: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 } },
                            React.createElement('i', { className: 'fa-solid fa-temperature-high', style: { fontSize: 14 } })
                        ),
                        React.createElement('div', { style: { fontSize: 22, fontWeight: 700 } }, latest.gdd_jour + ' \u00b0Cd'),
                        React.createElement('div', { className: 'kpi-label' }, 'GDD Jour')
                    ),
                    React.createElement('div', { className: 'kpi-card', style: { padding: 14 } },
                        React.createElement('div', { className: 'kpi-icon green', style: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 } },
                            React.createElement('i', { className: 'fa-solid fa-arrows-up-down', style: { fontSize: 14 } })
                        ),
                        React.createElement('div', { style: { fontSize: 22, fontWeight: 700 } }, (Math.round(dif * 10) / 10) + ' \u00b0C'),
                        React.createElement('div', { className: 'kpi-label' }, '\u0394T (DIF)')
                    ),
                    React.createElement('div', { className: 'kpi-card', style: { padding: 14 } },
                        React.createElement('div', { className: 'kpi-icon blue', style: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 } },
                            React.createElement('i', { className: 'fa-solid fa-wind', style: { fontSize: 14 } })
                        ),
                        React.createElement('div', { style: { fontSize: 22, fontWeight: 700 } }, latest.vpd + ' kPa'),
                        React.createElement('div', { className: 'kpi-label' }, 'VPD')
                    ),
                    React.createElement('div', { className: 'kpi-card', style: { padding: 14 } },
                        React.createElement('div', { className: 'kpi-icon', style: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, background: latest.stress_vpd > 0 || latest.stress_thermal > 0 ? '#fee2e2' : '#dcfce7', color: latest.stress_vpd > 0 || latest.stress_thermal > 0 ? '#dc2626' : '#16a34a' } },
                            React.createElement('i', { className: latest.stress_vpd > 0 || latest.stress_thermal > 0 ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check', style: { fontSize: 14 } })
                        ),
                        React.createElement('div', { style: { fontSize: 22, fontWeight: 700, color: latest.stress_vpd > 0 || latest.stress_thermal > 0 ? '#dc2626' : '#16a34a' } },
                            latest.stress_vpd > 0 || latest.stress_thermal > 0 ? 'Oui' : 'Aucun'
                        ),
                        React.createElement('div', { className: 'kpi-label' }, 'Stress')
                    )
                ),
                React.createElement('div', { className: 'card', style: { padding: 20 } },
                    React.createElement('h4', { style: { margin: '0 0 12px 0', fontSize: 14, fontWeight: 600 } }, 'Courbe GDD Cumul\u00e9s'),
                    React.createElement('svg', { viewBox: '0 0 ' + svgW + ' ' + svgH, style: { width: '100%', height: 'auto' } },
                        React.createElement('rect', { x: padL, y: y350, width: plotW, height: y250 - y350, fill: '#dcfce7', opacity: 0.5 }),
                        React.createElement('line', { x1: padL, y1: y250, x2: padL + plotW, y2: y250, stroke: '#16a34a', strokeDasharray: '4,4', strokeWidth: 1 }),
                        React.createElement('line', { x1: padL, y1: y350, x2: padL + plotW, y2: y350, stroke: '#16a34a', strokeDasharray: '4,4', strokeWidth: 1 }),
                        React.createElement('text', { x: padL + plotW + 2, y: y250 + 4, fontSize: 9, fill: '#16a34a' }, '250'),
                        React.createElement('text', { x: padL + plotW + 2, y: y350 + 4, fontSize: 9, fill: '#16a34a' }, '350'),
                        React.createElement('line', { x1: padL, y1: padT, x2: padL, y2: padT + plotH, stroke: '#e5e7eb', strokeWidth: 1 }),
                        React.createElement('line', { x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, stroke: '#e5e7eb', strokeWidth: 1 }),
                        [0, 100, 200, 300].filter(function(v) { return v <= maxGDD; }).map(function(v) {
                            return React.createElement('text', { key: 'y' + v, x: padL - 6, y: padT + plotH - v * yScale + 3, fontSize: 9, fill: '#9ca3af', textAnchor: 'end' }, v);
                        }),
                        React.createElement('path', { d: linePath, fill: 'none', stroke: 'var(--berry)', strokeWidth: 2.5, strokeLinejoin: 'round' }),
                        React.createElement('path', {
                            d: linePath + ' L' + points[points.length - 1].x.toFixed(1) + ',' + (padT + plotH) + ' L' + points[0].x.toFixed(1) + ',' + (padT + plotH) + ' Z',
                            fill: 'var(--berry)', opacity: 0.08
                        }),
                        points.map(function(p, i) {
                            var a = alerteColors[p.d.alerte] || alerteColors.PRECOCE;
                            return React.createElement('circle', { key: i, cx: p.x, cy: p.y, r: 3.5, fill: a.color, stroke: '#fff', strokeWidth: 1.5 });
                        }),
                        chartData.map(function(d, i) {
                            if (i !== 0 && i !== chartData.length - 1 && i % 5 !== 0) return null;
                            var x = padL + i * xScale;
                            var label = d.date.slice(5).replace('-', '/');
                            return React.createElement('text', { key: 'x' + i, x: x, y: padT + plotH + 14, fontSize: 9, fill: '#9ca3af', textAnchor: 'middle' }, label);
                        }),
                        React.createElement('text', { x: 10, y: padT + plotH / 2, fontSize: 9, fill: '#9ca3af', textAnchor: 'middle', transform: 'rotate(-90,10,' + (padT + plotH / 2) + ')' }, 'GDD cumul\u00e9s (\u00b0Cd)')
                    )
                )
            );
        }

export { GDDTrackingTab };
