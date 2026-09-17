/* Module: agronomie | Déclaration(s): AgroHarvestPredictionTab */
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';

// ===================== HARVEST PREDICTION TAB =====================
        function AgroHarvestPredictionTab() {
            const [predData, setPredData] = React.useState(null);
            const [loading, setLoading] = React.useState(true);
            const [showDetails, setShowDetails] = React.useState(false);
            const [selectedVariety, setSelectedVariety] = React.useState('');

            const fetchPrediction = React.useCallback((variety) => {
                setLoading(true);
                const url = variety ? '/api/harvest-prediction?variete=' + encodeURIComponent(variety) : '/api/harvest-prediction';
                fetch(url)
                    .then(r => r.json())
                    .then(data => { if (data.success) setPredData(data); })
                    .catch(err => console.error('Harvest prediction error:', err))
                    .finally(() => setLoading(false));
            }, []);

            React.useEffect(() => {
                fetchPrediction(selectedVariety);
                const interval = setInterval(() => fetchPrediction(selectedVariety), 5 * 60 * 1000);
                return () => clearInterval(interval);
            }, [fetchPrediction, selectedVariety]);

            if (loading && !predData) {
                return React.createElement('div', { style: { textAlign: 'center', padding: '60px 20px' } },
                    React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 32, color: 'var(--berry)' } }),
                    React.createElement('p', { style: { marginTop: 16, color: '#999' } }, 'Chargement des prédictions...')
                );
            }
            if (!predData) {
                return React.createElement('div', { style: { textAlign: 'center', padding: '60px 20px', color: '#999' } }, 'Impossible de charger les prédictions.');
            }

            const { varieties, lastActual, todayPartial, todayIsComplete, prediction, history, alerts, confidence, mape, gddRef, calibrationOffset, correlationTable, serreCurrent, weatherJ1, weatherJ2, weatherJ3, ma5 } = predData;
            // Même garde que `!predData` ci-dessus, un niveau plus bas. Un payload
            // sans `prediction` complète (modèle sans données du jour, calcul en
            // cours) faisait tomber l'onglet en ErrorBoundary sur `prediction.today`
            // au lieu d'afficher le message prévu pour ce cas.
            if (!prediction || !prediction.today || !prediction.tomorrow || !prediction.j2) {
                return React.createElement('div', { style: { textAlign: 'center', padding: '60px 20px', color: '#999' } }, 'Prédictions indisponibles pour le moment.');
            }


            // Helper: format kg
            const fmtKg = (v) => v != null ? v.toLocaleString('fr-FR') + ' kg' : '—';
            const fmtPct = (v) => v != null ? Math.round(v * 100) + '%' : '—';

            // Compute changes (all vs last actual — no chaining)
            const changeToday = lastActual && prediction.today.kg ? Math.round(((prediction.today.kg - lastActual.kg) / lastActual.kg) * 100) : null;
            const changeTomorrow = lastActual && prediction.tomorrow.kg ? Math.round(((prediction.tomorrow.kg - lastActual.kg) / lastActual.kg) * 100) : null;
            const changeJ2 = lastActual && prediction.j2 && prediction.j2.kg ? Math.round(((prediction.j2.kg - lastActual.kg) / lastActual.kg) * 100) : null;
            const changeJ3 = lastActual && prediction.j3 && prediction.j3.kg ? Math.round(((prediction.j3.kg - lastActual.kg) / lastActual.kg) * 100) : null;

            // Confidence color
            const confColor = confidence >= 0.8 ? 'var(--green)' : confidence >= 0.6 ? 'var(--gold)' : '#E53935';

            return React.createElement('div', { className: 'fade-in' },
                // Title
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 } },
                    React.createElement('h2', { style: { margin: 0, color: 'var(--berry-dark)', fontSize: 20 } },
                        React.createElement('i', { className: 'fa-solid fa-chart-line', style: { marginRight: 8 } }),
                        'Prédiction Récolte Export', predData.varietyFilter && predData.varietyFilter !== 'TOUTES' ? ' — ' + predData.varietyFilter : ''
                    ),
                    React.createElement('select', {
                        value: selectedVariety,
                        onChange: (e) => setSelectedVariety(e.target.value),
                        style: { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#333', cursor: 'pointer' }
                    },
                        React.createElement('option', { value: '' }, 'Toutes variétés'),
                        React.createElement('option', { value: 'MARAVILLA' }, 'Maravilla'),
                        React.createElement('option', { value: 'CORINA' }, 'Corina'),
                        React.createElement('option', { value: 'REYNA' }, 'Reyna')
                    ),
                    React.createElement('button', {
                        onClick: () => fetchPrediction(selectedVariety),
                        style: { background: 'var(--berry)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, opacity: loading ? 0.6 : 1 }
                    }, React.createElement('i', { className: 'fa-solid fa-sync-alt', style: { marginRight: 6 } }), 'Actualiser'),
                ),

                // Alerts
                alerts && alerts.length > 0 && React.createElement('div', { style: { marginBottom: 20 } },
                    alerts.map((a, i) => React.createElement('div', {
                        key: i,
                        style: {
                            background: a.severity === 'danger' ? '#FFF3F3' : '#FFF8E1',
                            border: '1px solid ' + (a.severity === 'danger' ? '#FFCDD2' : '#FFE082'),
                            borderLeft: '4px solid ' + (a.severity === 'danger' ? '#E53935' : '#FFA000'),
                            borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10
                        }
                    },
                        React.createElement('i', { className: 'fa-solid ' + a.icon, style: { fontSize: 18, color: a.severity === 'danger' ? '#E53935' : '#FFA000' } }),
                        React.createElement('span', { style: { fontSize: 14, fontWeight: 500 } }, a.message)
                    ))
                ),

                // KPI Cards row
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 } },
                    // Helper: variety breakdown sub-items
                    ...(() => {
                        const varSub = (byVar) => byVar && Object.keys(byVar).length > 0 ? React.createElement('div', { className: 'kpi-sub' },
                            Object.entries(byVar).sort((a,b) => b[1] - a[1]).map(([v, kg], i) =>
                                React.createElement('div', { className: 'kpi-sub-item', key: i },
                                    React.createElement('strong', null, Math.round(kg) + ' kg'), ' ' + v
                                )
                            )
                        ) : null;
                        return [
                    // Card 1: Last actual
                    React.createElement('div', { className: 'kpi-card fade-in' },
                        React.createElement('div', { className: 'kpi-header' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: '#E8F5E9' } },
                                React.createElement('i', { className: 'fa-solid fa-scale-balanced', style: { color: 'var(--green)' } })
                            ),
                            React.createElement('span', { style: { fontSize: 11, color: '#999', fontWeight: 500 } }, lastActual ? lastActual.date : '—')
                        ),
                        React.createElement('div', { className: 'kpi-value', style: { color: 'var(--green)' } }, lastActual ? fmtKg(lastActual.kg) : '—'),
                        React.createElement('div', { className: 'kpi-label' }, 'Dernière récolte export'),
                        lastActual && varSub(lastActual.byVariety)
                    ),

                    // Card 2: Today — actual or prediction
                    React.createElement('div', { className: 'kpi-card fade-in' },
                        React.createElement('div', { className: 'kpi-header' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: prediction.today.isActual ? '#E8F5E9' : '#F3E5F5' } },
                                React.createElement('i', { className: 'fa-solid ' + (prediction.today.isActual ? 'fa-check-circle' : 'fa-chart-line'), style: { color: prediction.today.isActual ? 'var(--green)' : 'var(--berry)' } })
                            ),
                            changeToday !== null && React.createElement('span', { className: 'kpi-change ' + (changeToday >= 0 ? 'up' : 'down') },
                                React.createElement('i', { className: 'fa-solid ' + (changeToday >= 0 ? 'fa-arrow-up' : 'fa-arrow-down') }), ' ', Math.abs(changeToday), '%'
                            )
                        ),
                        React.createElement('div', { className: 'kpi-value', style: { color: prediction.today.isActual ? 'var(--green)' : 'var(--berry)' } }, fmtKg(prediction.today.kg)),
                        React.createElement('div', { className: 'kpi-label' }, prediction.today.isActual ? "Aujourd'hui (final)" : "Aujourd'hui (prédit)"),
                        varSub(prediction.today.byVariety),
                        todayPartial && !todayIsComplete && React.createElement('div', { style: { marginTop: 8, padding: '8px 0', borderTop: '1px solid #f0f0f0' } },
                            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 } },
                                React.createElement('span', { style: { color: '#999' } }, 'Expédié en cours'),
                                React.createElement('span', { style: { fontWeight: 600, color: '#E65100' } }, fmtKg(todayPartial.kg))
                            ),
                            prediction.today.kg && React.createElement('div', { style: { height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' } },
                                React.createElement('div', { style: { height: '100%', width: Math.min(100, Math.round((todayPartial.kg / prediction.today.kg) * 100)) + '%', background: '#E65100', borderRadius: 3, transition: 'width 0.5s' } })
                            ),
                            todayPartial.byVariety && React.createElement('div', { style: { marginTop: 6, fontSize: 11, color: '#999' } },
                                Object.entries(todayPartial.byVariety).map(([v, kg]) => v + ': ' + Math.round(kg) + ' kg').join(' | ')
                            )
                        )
                    ),

                    // Card 3: Tomorrow (J+1)
                    React.createElement('div', { className: 'kpi-card fade-in' },
                        React.createElement('div', { className: 'kpi-header' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: '#FFF3E0' } },
                                React.createElement('i', { className: 'fa-solid fa-forward', style: { color: 'var(--gold)' } })
                            ),
                            changeTomorrow !== null && React.createElement('span', { className: 'kpi-change ' + (changeTomorrow >= 0 ? 'up' : 'down') },
                                React.createElement('i', { className: 'fa-solid ' + (changeTomorrow >= 0 ? 'fa-arrow-up' : 'fa-arrow-down') }), ' ', Math.abs(changeTomorrow), '%'
                            )
                        ),
                        React.createElement('div', { className: 'kpi-value', style: { color: '#E65100' } }, fmtKg(prediction.tomorrow.kg)),
                        React.createElement('div', { className: 'kpi-label' }, 'Demain J+1'),
                        varSub(prediction.tomorrow.byVariety)
                    ),

                    // Card 4: J+2
                    prediction.j2 && React.createElement('div', { className: 'kpi-card fade-in' },
                        React.createElement('div', { className: 'kpi-header' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: '#E3F2FD' } },
                                React.createElement('i', { className: 'fa-solid fa-forward-fast', style: { color: '#1565C0' } })
                            ),
                            changeJ2 !== null && React.createElement('span', { className: 'kpi-change ' + (changeJ2 >= 0 ? 'up' : 'down') },
                                React.createElement('i', { className: 'fa-solid ' + (changeJ2 >= 0 ? 'fa-arrow-up' : 'fa-arrow-down') }), ' ', Math.abs(changeJ2), '%'
                            )
                        ),
                        React.createElement('div', { className: 'kpi-value', style: { color: '#1565C0' } }, fmtKg(prediction.j2.kg)),
                        React.createElement('div', { className: 'kpi-label' }, prediction.j2.date ? new Date(prediction.j2.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long' }) + ' J+2' : 'J+2'),
                        varSub(prediction.j2.byVariety)
                    ),

                    // Card 5: J+3
                    prediction.j3 && React.createElement('div', { className: 'kpi-card fade-in' },
                        React.createElement('div', { className: 'kpi-header' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: '#F3E5F5' } },
                                React.createElement('i', { className: 'fa-solid fa-calendar-days', style: { color: '#7B1FA2' } })
                            ),
                            changeJ3 !== null && React.createElement('span', { className: 'kpi-change ' + (changeJ3 >= 0 ? 'up' : 'down') },
                                React.createElement('i', { className: 'fa-solid ' + (changeJ3 >= 0 ? 'fa-arrow-up' : 'fa-arrow-down') }), ' ', Math.abs(changeJ3), '%'
                            )
                        ),
                        React.createElement('div', { className: 'kpi-value', style: { color: '#7B1FA2' } }, fmtKg(prediction.j3.kg)),
                        React.createElement('div', { className: 'kpi-label' }, prediction.j3.date ? new Date(prediction.j3.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long' }) + ' J+3' : 'J+3'),
                        varSub(prediction.j3.byVariety)
                    )
                        ];
                    })()
                ),

                // Explanation blocks — why production goes up or down
                prediction.today.explanation && React.createElement('div', { style: { marginBottom: 16, background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' } },
                    React.createElement('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#333' } },
                        React.createElement('i', { className: 'fa-solid fa-lightbulb', style: { marginRight: 8, color: 'var(--gold)' } }),
                        'Analyse de la prédiction'
                    ),
                    // Today explanation
                    React.createElement('div', { style: { marginBottom: 12 } },
                        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: prediction.today.kg > (lastActual ? lastActual.kg : 0) ? 'var(--green)' : '#E53935', marginBottom: 4 } },
                            React.createElement('i', { className: 'fa-solid ' + (prediction.today.kg > (lastActual ? lastActual.kg : 0) ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'), style: { marginRight: 6 } }),
                            prediction.today.explanation.summary
                        ),
                        React.createElement('ul', { style: { margin: '4px 0 0', paddingLeft: 20, fontSize: 13, color: '#555', lineHeight: 1.7 } },
                            prediction.today.explanation.reasons.map((r, i) =>
                                React.createElement('li', { key: i }, r)
                            )
                        )
                    ),
                    // Tomorrow explanation
                    prediction.tomorrow.explanation && React.createElement('div', { style: { paddingTop: 12, borderTop: '1px solid #f0f0f0' } },
                        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: prediction.tomorrow.kg > (lastActual ? lastActual.kg : 0) ? 'var(--green)' : '#E53935', marginBottom: 4 } },
                            React.createElement('i', { className: 'fa-solid ' + (prediction.tomorrow.kg > (lastActual ? lastActual.kg : 0) ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'), style: { marginRight: 6 } }),
                            prediction.tomorrow.explanation.summary
                        ),
                        React.createElement('ul', { style: { margin: '4px 0 0', paddingLeft: 20, fontSize: 13, color: '#555', lineHeight: 1.7 } },
                            prediction.tomorrow.explanation.reasons.map((r, i) =>
                                React.createElement('li', { key: i }, r)
                            )
                        )
                    ),
                    // J+2 explanation
                    prediction.j2 && prediction.j2.explanation && React.createElement('div', { style: { paddingTop: 12, borderTop: '1px solid #f0f0f0' } },
                        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: prediction.j2.kg > (lastActual ? lastActual.kg : 0) ? 'var(--green)' : '#E53935', marginBottom: 4 } },
                            React.createElement('i', { className: 'fa-solid ' + (prediction.j2.kg > (lastActual ? lastActual.kg : 0) ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'), style: { marginRight: 6 } }),
                            prediction.j2.explanation.summary
                        ),
                        React.createElement('ul', { style: { margin: '4px 0 0', paddingLeft: 20, fontSize: 13, color: '#555', lineHeight: 1.7 } },
                            prediction.j2.explanation.reasons.map((r, i) =>
                                React.createElement('li', { key: i }, r)
                            )
                        )
                    ),
                    // J+3 explanation
                    prediction.j3 && prediction.j3.explanation && React.createElement('div', { style: { paddingTop: 12, borderTop: '1px solid #f0f0f0' } },
                        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: prediction.j3.kg > (lastActual ? lastActual.kg : 0) ? 'var(--green)' : '#E53935', marginBottom: 4 } },
                            React.createElement('i', { className: 'fa-solid ' + (prediction.j3.kg > (lastActual ? lastActual.kg : 0) ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'), style: { marginRight: 6 } }),
                            prediction.j3.explanation.summary
                        ),
                        React.createElement('ul', { style: { margin: '4px 0 0', paddingLeft: 20, fontSize: 13, color: '#555', lineHeight: 1.7 } },
                            prediction.j3.explanation.reasons.map((r, i) =>
                                React.createElement('li', { key: i }, r)
                            )
                        )
                    )
                ),

                // Confidence bar
                React.createElement('div', { style: { marginBottom: 24, background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
                        React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#555' } }, 'Confiance du modèle'),
                        React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: confColor } }, Math.round(confidence * 100) + '%')
                    ),
                    React.createElement('div', { style: { height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' } },
                        React.createElement('div', { style: { height: '100%', width: Math.round(confidence * 100) + '%', background: confColor, borderRadius: 4, transition: 'width 0.5s' } })
                    )
                ),

                // 7-day chart
                React.createElement('div', { style: { background: '#fff', borderRadius: 12, padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 24 } },
                    React.createElement('h3', { style: { margin: '0 0 16px', fontSize: 15, color: '#333' } },
                        React.createElement('i', { className: 'fa-solid fa-chart-area', style: { marginRight: 8, color: 'var(--berry)' } }),
                        'Historique 7 jours — Réel vs Prédit'
                    ),
                    React.createElement('div', { style: { display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 } },
                        React.createElement('span', null, React.createElement('span', { style: { display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: 'var(--green)', marginRight: 4, verticalAlign: 'middle' } }), 'Réel'),
                        React.createElement('span', null, React.createElement('span', { style: { display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: 'var(--berry)', marginRight: 4, verticalAlign: 'middle' } }), 'Prédit')
                    ),
                    (() => {
                        const chartData = (history || []).map(h => ({
                            jour: h.label,
                            reel: h.actual || 0,
                            predit: h.predicted || 0,
                        }));
                        return React.createElement(SimpleAreaChart, { data: chartData, dataKeys: ['reel', 'predit'], colors: ['#2D8B4E', '#8B2252'], xKey: 'jour', height: 260, showLabelsFor: 'reel' });
                    })()
                ),

                // Correlation table: 7-day sensor data vs production
                React.createElement('div', { style: { background: '#fff', borderRadius: 12, padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 24, overflowX: 'auto' } },
                    React.createElement('h3', { style: { margin: '0 0 16px', fontSize: 15, color: '#333' } },
                        React.createElement('i', { className: 'fa-solid fa-table', style: { marginRight: 8, color: 'var(--berry)' } }),
                        'Corrélation Capteurs / Production — 7 jours'
                    ),
                    React.createElement('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'center' } },
                        React.createElement('thead', null,
                            React.createElement('tr', { style: { background: '#FAFAFA' } },
                                ['Jour', 'Réel', 'Estimé', 'Erreur', 'T° min', 'T° max', 'HR%', 'PAR', 'GDD'].map((h, i) =>
                                    React.createElement('th', { key: i, style: { padding: '8px 5px', fontWeight: 600, color: '#555', borderBottom: '2px solid #eee', whiteSpace: 'nowrap', fontSize: 11 } }, h)
                                )
                            )
                        ),
                        React.createElement('tbody', null,
                            (history || []).map((h, i) => {
                                const s = h.serre;
                                const kg = h.actual || h.partial;
                                const est = h.predicted;
                                const err = h.error;
                                const errColor = err != null ? (Math.abs(err) <= 10 ? 'var(--green)' : Math.abs(err) <= 20 ? '#E65100' : '#E53935') : '#999';
                                return React.createElement('tr', { key: i, style: { borderBottom: '1px solid #f5f5f5', background: h.date === predData.today ? '#FFF8E1' : 'transparent' } },
                                    React.createElement('td', { style: { padding: '6px 5px', fontWeight: 600, fontSize: 11, color: '#777' } }, h.label),
                                    React.createElement('td', { style: { padding: '6px 5px', fontWeight: 700, color: 'var(--green)' } },
                                        kg ? Math.round(kg) : '—',
                                        h.partial ? React.createElement('span', { style: { fontSize: 9, color: '#E65100', marginLeft: 2 } }, '*') : null
                                    ),
                                    React.createElement('td', { style: { padding: '6px 5px', fontWeight: 600, color: 'var(--berry)' } },
                                        est ? Math.round(est) : '—'
                                    ),
                                    React.createElement('td', { style: { padding: '6px 5px', fontWeight: 600, color: errColor, fontSize: 11 } },
                                        err != null ? (err > 0 ? '+' : '') + err + '%' : '—'
                                    ),
                                    React.createElement('td', { style: { padding: '6px 5px' } }, s ? s.T_min + '°' : '—'),
                                    React.createElement('td', { style: { padding: '6px 5px', color: s && s.T_max > 28 ? '#E53935' : 'inherit', fontWeight: s && s.T_max > 28 ? 700 : 400 } }, s ? s.T_max + '°' : '—'),
                                    React.createElement('td', { style: { padding: '6px 5px', color: s && s.HR > 90 ? '#E53935' : s && s.HR > 85 ? '#E65100' : 'inherit' } }, s ? Math.round(s.HR) + '%' : '—'),
                                    React.createElement('td', { style: { padding: '6px 5px' } }, s ? s.PAR : '—'),
                                    React.createElement('td', { style: { padding: '6px 5px', fontWeight: 600 } }, s ? s.GDD : '—')
                                );
                            })
                        )
                    )
                ),

                // Live serre + weather badges
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 } },
                    // Serre badges
                    React.createElement('div', { style: { background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' } },
                        React.createElement('h4', { style: { margin: '0 0 12px', fontSize: 14, color: '#555' } },
                            React.createElement('i', { className: 'fa-solid fa-tower-broadcast', style: { marginRight: 6, color: 'var(--berry)' } }),
                            'Conditions serre (live)'
                        ),
                        serreCurrent ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
                            [
                                { label: 'Température', value: serreCurrent.temperature ? serreCurrent.temperature + '°C' : '—', icon: 'fa-temperature-half', color: '#E53935' },
                                { label: 'Humidité', value: serreCurrent.humidity ? serreCurrent.humidity + '%' : '—', icon: 'fa-droplet', color: '#1E88E5' },
                                { label: 'PAR', value: serreCurrent.PAR ? serreCurrent.PAR + ' mol/m²/j' : '—', icon: 'fa-sun', color: '#FDD835' },
                                { label: 'Source', value: serreCurrent.source === 'farmroad' ? 'FarmRoad' : 'Météo (fallback)', icon: 'fa-satellite-dish', color: '#7CB342' },
                            ].map((b, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#FAFAFA', borderRadius: 8 } },
                                React.createElement('i', { className: 'fa-solid ' + b.icon, style: { color: b.color, fontSize: 16, width: 20, textAlign: 'center' } }),
                                React.createElement('div', null,
                                    React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } }, b.value),
                                    React.createElement('div', { style: { fontSize: 11, color: '#999' } }, b.label)
                                )
                            ))
                        ) : React.createElement('div', { style: { color: '#999', fontSize: 13 } }, 'Données serre non disponibles')
                    ),

                    // Weather badges
                    React.createElement('div', { style: { background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' } },
                        React.createElement('h4', { style: { margin: '0 0 12px', fontSize: 14, color: '#555' } },
                            React.createElement('i', { className: 'fa-solid fa-cloud-sun', style: { marginRight: 6, color: '#1E88E5' } }),
                            'Météo extérieure Laouamra'
                        ),
                        React.createElement('div', { style: { display: 'grid', gap: 10 } },
                            [weatherJ1, weatherJ2].filter(Boolean).map((w, i) =>
                                React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#FAFAFA', borderRadius: 8 } },
                                    React.createElement('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--berry)', minWidth: 40 } }, i === 0 ? 'J+1' : 'J+2'),
                                    React.createElement('div', { style: { display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' } },
                                        React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-temperature-half', style: { color: '#E53935', marginRight: 4 } }), w.T_min + '–' + w.T_max + '°C'),
                                        React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-cloud-rain', style: { color: '#1E88E5', marginRight: 4 } }), w.precipitation + 'mm'),
                                        React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-droplet', style: { color: '#7CB342', marginRight: 4 } }), w.humidity + '%')
                                    )
                                )
                            )
                        )
                    )
                ),

                // Correlation Table — Réel vs Estimé
                correlationTable && correlationTable.length > 0 && React.createElement('div', { style: { background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px', marginBottom: 16 } },
                    React.createElement('h3', { style: { fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 12 } },
                        React.createElement('i', { className: 'fa-solid fa-table', style: { marginRight: 8, color: 'var(--berry)' } }),
                        'Corrélation Réel vs Estimé (', correlationTable.length, ' jours)'
                    ),
                    React.createElement('div', { style: { overflowX: 'auto' } },
                        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
                            React.createElement('thead', null,
                                React.createElement('tr', { style: { borderBottom: '2px solid #eee' } },
                                    ['Jour', 'Réel (kg)', 'Estimé (kg)', 'Erreur %', 'T°min', 'T°max', 'HR %', 'PAR', 'GDD'].map((h, i) =>
                                        React.createElement('th', { key: i, style: { padding: '8px 6px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' } }, h)
                                    )
                                )
                            ),
                            React.createElement('tbody', null,
                                correlationTable.map((row, idx) => {
                                    const errColor = row.error_pct == null ? '#999' : Math.abs(row.error_pct) <= 10 ? 'var(--green)' : Math.abs(row.error_pct) <= 20 ? 'var(--gold)' : '#E53935';
                                    return React.createElement('tr', { key: idx, style: { borderBottom: '1px solid #f0f0f0', background: idx % 2 === 0 ? '#fafafa' : '#fff' } },
                                        React.createElement('td', { style: { padding: '8px 6px', fontWeight: 500 } }, row.date ? new Date(row.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: 'var(--green)' } }, row.actual_kg != null ? Math.round(row.actual_kg) : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: 'var(--berry)' } }, row.predicted_kg != null ? Math.round(row.predicted_kg) : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: errColor } }, row.error_pct != null ? (row.error_pct > 0 ? '+' : '') + row.error_pct + '%' : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', color: '#666' } }, row.T_min != null ? row.T_min.toFixed(1) + '°' : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', color: '#666' } }, row.T_max != null ? row.T_max.toFixed(1) + '°' : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', color: '#666' } }, row.HR != null ? Math.round(row.HR) + '%' : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', color: '#666' } }, row.PAR != null ? row.PAR.toFixed(1) : '—'),
                                        React.createElement('td', { style: { padding: '8px 6px', textAlign: 'right', color: '#666' } }, row.GDD != null ? row.GDD.toFixed(1) : '—')
                                    );
                                })
                            )
                        )
                    ),
                    // MAPE summary
                    mape != null && React.createElement('div', { style: { marginTop: 12, padding: '8px 12px', background: '#f8f9fa', borderRadius: 8, fontSize: 12, color: '#666' } },
                        React.createElement('strong', null, 'MAPE (erreur moyenne absolue) : '),
                        React.createElement('span', { style: { color: mape <= 0.15 ? 'var(--green)' : mape <= 0.25 ? 'var(--gold)' : '#E53935', fontWeight: 600 } }, Math.round(mape * 100) + '%'),
                        ' — ', mape <= 0.15 ? 'Excellent' : mape <= 0.25 ? 'Acceptable, en amélioration' : 'En apprentissage, le modèle s\'affine avec plus de données'
                    )
                ),

                // Model details (collapsible)
                React.createElement('div', { style: { background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' } },
                    React.createElement('button', {
                        onClick: () => setShowDetails(!showDetails),
                        style: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#555' }
                    },
                        React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-gear', style: { marginRight: 8 } }), 'Détails du modèle'),
                        React.createElement('i', { className: 'fa-solid ' + (showDetails ? 'fa-chevron-up' : 'fa-chevron-down') })
                    ),
                    showDetails && React.createElement('div', { style: { padding: '0 20px 16px', borderTop: '1px solid #f0f0f0' } },
                        // Explanation block
                        React.createElement('div', { style: { background: '#FAFAFA', borderRadius: 8, padding: '14px 16px', marginTop: 12, marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: '#555' } },
                            React.createElement('div', { style: { fontWeight: 700, marginBottom: 6, color: '#333' } },
                                React.createElement('i', { className: 'fa-solid fa-circle-info', style: { marginRight: 6, color: 'var(--berry)' } }),
                                'Comment fonctionne la prédiction ?'
                            ),
                            React.createElement('p', { style: { margin: '0 0 8px' } },
                                'Le modèle estime la récolte de demain en appliquant un ', React.createElement('strong', null, 'coefficient de maturation'), ' à la dernière récolte réelle complète',
                                lastActual ? ' (' + lastActual.date + ' : ' + fmtKg(lastActual.kg) + ').' : '.'
                            ),
                            React.createElement('p', { style: { margin: '0 0 8px' } }, 'Ce coefficient combine 3 facteurs mesurés dans la serre :'),
                            React.createElement('ul', { style: { margin: '0 0 8px', paddingLeft: 20 } },
                                React.createElement('li', null, React.createElement('strong', null, 'GDD (Growing Degree Days)'), ' : accumulation thermique au-dessus de 7°C — plus il fait chaud, plus les fruits mûrissent vite. Ratio vs moyenne 7j : ', React.createElement('strong', null, prediction.today.coefficients.gddRatio)),
                                React.createElement('li', null, React.createElement('strong', null, 'Humidité relative'), ' : au-delà de 85% le facteur baisse (risque botrytis). Facteur : ', React.createElement('strong', null, prediction.today.coefficients.facteur_HR)),
                                React.createElement('li', null, React.createElement('strong', null, 'Lumière PAR'), ' : plus de lumière = meilleure photosynthèse. Facteur : ', React.createElement('strong', null, prediction.today.coefficients.facteur_PAR))
                            ),
                            React.createElement('p', { style: { margin: '0 0 8px' } },
                                'Formule : ', React.createElement('code', { style: { background: '#EEE', padding: '2px 6px', borderRadius: 4 } }, 'récolte prévue = récolte J-1 × coeff × (1 + calibration)'),
                                calibrationOffset != null ? ', calibration EMA : ' + (calibrationOffset > 0 ? '+' : '') + Math.round(calibrationOffset * 100) + '%.' : '.'
                            ),
                            !todayIsComplete && todayPartial && React.createElement('p', { style: { margin: '0', fontStyle: 'italic', color: '#999' } },
                                'Le tonnage du jour (' + fmtKg(todayPartial.kg) + ' expédiés) est partiel — il ne sera pris en compte comme récolte définitive qu\'après 20h.'
                            )
                        ),
                        React.createElement('table', { style: { width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 12 } },
                            React.createElement('tbody', null,
                                [
                                    ['GDD référence (7j)', gddRef],
                                    ['GDD aujourd\'hui', prediction.today.coefficients.GDD],
                                    ['Ratio GDD (base)', prediction.today.coefficients.gddRatio],
                                    ['Facteur HR (base)', prediction.today.coefficients.facteur_HR],
                                    ['Facteur PAR (base)', prediction.today.coefficients.facteur_PAR],
                                    ['Coeff brut (GDD×HR×PAR)', prediction.today.coefficients.rawCoeff],
                                    ['Calibration EMA', calibrationOffset != null ? (calibrationOffset > 0 ? '+' : '') + Math.round(calibrationOffset * 100) + '%' : '0%'],
                                    ['Coeff final', prediction.today.coefficients.coeff],
                                    null, // separator
                                    ['MAPE (erreur moyenne)', mape != null ? Math.round(mape * 100) + '%' : '—'],
                                    ['Confiance', fmtPct(confidence)],
                                ].filter(Boolean).map(([label, value], i) =>
                                    React.createElement('tr', { key: i, style: { borderBottom: '1px solid #f5f5f5' } },
                                        React.createElement('td', { style: { padding: '8px 0', color: '#777' } }, label),
                                        React.createElement('td', { style: { padding: '8px 0', fontWeight: 600, textAlign: 'right' } }, value)
                                    )
                                )
                            )
                        )
                    )
                )
            );
        }

export { AgroHarvestPredictionTab };
