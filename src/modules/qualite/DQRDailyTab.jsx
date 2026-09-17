/* Module: qualite | Déclaration(s): DQRDailyTab */
import { KPICard } from '../shared/KPICard.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';

// ===================== DQR DAILY QUALITY REPORT TAB =====================
        function DQRDailyTab({ currentProfile, profileData }) {
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDate, setSelectedDate] = useState('');
            const [filterFerme, setFilterFerme] = useState('');
            const [filterVariety, setFilterVariety] = useState('');
            const [expandedDates, setExpandedDates] = useState({});

            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => {
                        if (json.success && json.expeditions) {
                            const dqrOnly = json.expeditions.filter(e => e.source === 'dqr-auto-created');
                            setExpeditions(dqrOnly);
                        }
                    })
                    .catch(err => console.warn('DQR fetch error:', err))
                    .finally(() => setLoading(false));
            }, []);

            const parseExpDate = (e) => {
                const raw = e.dateISO || e.date || '';
                if (!raw) return '';
                const iso = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
                const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
                return '';
            };

            const withDates = useMemo(() => expeditions.map(e => ({ ...e, _day: parseExpDate(e) })).filter(e => e._day), [expeditions]);
            const uniqueDates = useMemo(() => [...new Set(withDates.map(e => e._day))].sort().reverse(), [withDates]);

            useEffect(() => {
                if (uniqueDates.length > 0 && !selectedDate) {
                    setSelectedDate(uniqueDates[0]);
                }
            }, [uniqueDates]);

            const prevDay = () => { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate()-1); setSelectedDate(d.toISOString().slice(0,10)); };
            const nextDay = () => { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate()+1); setSelectedDate(d.toISOString().slice(0,10)); };

            const dayData = useMemo(() => {
                let items = withDates.filter(e => e._day === selectedDate);
                if (filterFerme) items = items.filter(e => (ranchToFerme[e.ranch] || e.ranch) === filterFerme);
                if (filterVariety) items = items.filter(e => e.variety === filterVariety);
                return items;
            }, [withDates, selectedDate, filterFerme, filterVariety]);

            const uniqueFermes = useMemo(() => [...new Set(withDates.filter(e => e._day === selectedDate).map(e => ranchToFerme[e.ranch] || e.ranch).filter(Boolean))].sort(), [withDates, selectedDate]);
            const uniqueVarieties = useMemo(() => [...new Set(withDates.filter(e => e._day === selectedDate).map(e => e.variety).filter(Boolean))].sort(), [withDates, selectedDate]);

            const totalKg = dayData.reduce((s, e) => s + (parseFloat(e.batchWeight) || 0), 0);
            const totalColis = dayData.reduce((s, e) => s + (parseInt(e.batchQuantity) || 0), 0);
            const passCount = dayData.filter(e => (e.overallResult || '').toUpperCase() === 'PASS').length;
            const failCount = dayData.filter(e => (e.overallResult || '').toUpperCase() === 'FAIL' || (e.overallResult || '').toUpperCase() === 'REJECT').length;
            const passRate = dayData.length > 0 ? Math.round(passCount / dayData.length * 100) : 0;

            // Multi-day summary
            const allDaysSummary = useMemo(() => {
                return uniqueDates.map(date => {
                    let items = withDates.filter(e => e._day === date);
                    if (filterFerme) items = items.filter(e => (ranchToFerme[e.ranch] || e.ranch) === filterFerme);
                    if (filterVariety) items = items.filter(e => e.variety === filterVariety);
                    const kg = items.reduce((s, e) => s + (parseFloat(e.batchWeight) || 0), 0);
                    const pass = items.filter(e => (e.overallResult || '').toUpperCase() === 'PASS').length;
                    return { date, count: items.length, kg, pass, fail: items.length - pass, passRate: items.length > 0 ? Math.round(pass / items.length * 100) : 0, items };
                }).filter(d => d.count > 0);
            }, [uniqueDates, withDates, filterFerme, filterVariety]);

            if (loading) {
                return React.createElement('div', { className: 'fade-in', style: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 } },
                    React.createElement('div', { style: { textAlign: 'center' } },
                        React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { fontSize: 32, color: 'var(--berry)', marginBottom: 12 } }),
                        React.createElement('div', { style: { color: 'var(--gray-500)', fontSize: 14 } }, 'Chargement des DQR...')
                    )
                );
            }

            if (expeditions.length === 0) {
                return React.createElement('div', { className: 'fade-in', style: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 } },
                    React.createElement('div', { style: { textAlign: 'center', color: 'var(--gray-400)' } },
                        React.createElement('i', { className: 'fa-solid fa-clipboard', style: { fontSize: 48, marginBottom: 12 } }),
                        React.createElement('div', { style: { fontSize: 16 } }, 'Aucune donnée DQR disponible')
                    )
                );
            }

            const formatDateFr = (iso) => {
                try {
                    const d = new Date(iso + 'T12:00:00');
                    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                } catch { return iso; }
            };

            const renderDqrTable = (rows) => React.createElement('table', { className: 'data-table', style: { fontSize: 12, width: '100%' } },
                React.createElement('thead', null,
                    React.createElement('tr', null,
                        React.createElement('th', null, 'Receipt ID'),
                        React.createElement('th', null, 'Variété'),
                        React.createElement('th', null, 'Type'),
                        React.createElement('th', { style: { textAlign: 'right' } }, 'Poids (kg)'),
                        React.createElement('th', { style: { textAlign: 'right' } }, 'Colis'),
                        React.createElement('th', { style: { textAlign: 'right' } }, 'Brix'),
                        React.createElement('th', { style: { textAlign: 'right' } }, 'PQ Score'),
                        React.createElement('th', null, 'Résultat'),
                        React.createElement('th', null, 'Ferme')
                    )
                ),
                React.createElement('tbody', null,
                    rows.length === 0
                        ? React.createElement('tr', null, React.createElement('td', { colSpan: 9, style: { textAlign: 'center', padding: 30, color: '#999' } }, 'Aucune donnée DQR pour cette date'))
                        : rows.map((e, i) => React.createElement('tr', { key: i },
                            React.createElement('td', { style: { fontFamily: 'monospace', fontSize: 11 } }, e.receiptId || '-'),
                            React.createElement('td', null, e.variety || '-'),
                            React.createElement('td', null, e.berryTypeFr || e.berryType || '-'),
                            React.createElement('td', { style: { textAlign: 'right', fontWeight: 600 } }, (parseFloat(e.batchWeight) || 0).toFixed(1)),
                            React.createElement('td', { style: { textAlign: 'right' } }, e.batchQuantity || '-'),
                            React.createElement('td', { style: { textAlign: 'right', fontWeight: 600, color: (parseFloat(e.brixFromDQR || e.brix) || 0) >= 10 ? 'var(--green)' : 'var(--orange)' } }, (parseFloat(e.brixFromDQR || e.brix) || 0).toFixed(1)),
                            React.createElement('td', { style: { textAlign: 'right' } }, e.enrichedPqScore != null ? parseFloat(e.enrichedPqScore).toFixed(1) : (e.pqScore != null ? parseFloat(e.pqScore).toFixed(1) : '-')),
                            React.createElement('td', null, React.createElement('span', { className: 'status-badge ' + ((e.overallResult || '').toUpperCase() === 'PASS' ? 'active' : 'danger') }, e.overallResult || '-')),
                            React.createElement('td', null, ranchToFerme[e.ranch] || e.ranchName || e.ranch || '-')
                        )),
                    rows.length > 0 && React.createElement('tr', { style: { fontWeight: 700, background: '#f8f9fa', borderTop: '2px solid #dee2e6' } },
                        React.createElement('td', { colSpan: 3, style: { textAlign: 'right' } }, 'TOTAL'),
                        React.createElement('td', { style: { textAlign: 'right' } }, rows.reduce((s, e) => s + (parseFloat(e.batchWeight) || 0), 0).toFixed(1)),
                        React.createElement('td', { style: { textAlign: 'right' } }, rows.reduce((s, e) => s + (parseInt(e.batchQuantity) || 0), 0)),
                        React.createElement('td', { colSpan: 4 })
                    )
                )
            );

            const pillStyle = (active) => ({
                padding: '6px 14px', borderRadius: 20, border: active ? 'none' : '1px solid #ddd',
                background: active ? 'var(--berry)' : 'white', color: active ? 'white' : 'var(--dark)',
                cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 500, transition: 'all 0.2s'
            });

            return React.createElement('div', { className: 'fade-in' },
                // KPI Cards
                React.createElement('div', { className: 'kpi-grid' },
                    React.createElement(KPICard, { icon: 'fa-clipboard-list', iconClass: 'berry', value: dayData.length, label: 'DQR du jour' }),
                    React.createElement(KPICard, { icon: 'fa-weight-hanging', iconClass: 'purple', value: totalKg.toFixed(1) + ' kg', label: 'Poids total' }),
                    React.createElement(KPICard, { icon: 'fa-circle-check', iconClass: 'green', value: passRate + '%', label: 'Taux Pass' }),
                    failCount > 0 && React.createElement(KPICard, { icon: 'fa-circle-xmark', iconClass: 'red', value: failCount, label: 'Fail / Reject' })
                ),

                // Date navigation
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, margin: '16px 0', flexWrap: 'wrap' } },
                    React.createElement('button', { onClick: prevDay, style: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: 'white', cursor: 'pointer', fontSize: 16 } }, React.createElement('i', { className: 'fa-solid fa-chevron-left' })),
                    React.createElement('div', { style: { textAlign: 'center', minWidth: 220 } },
                        React.createElement('div', { style: { fontSize: 16, fontWeight: 700, color: 'var(--dark)' } }, formatDateFr(selectedDate)),
                        React.createElement('div', { style: { fontSize: 11, color: 'var(--gray-500)' } }, selectedDate)
                    ),
                    React.createElement('button', { onClick: nextDay, style: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: 'white', cursor: 'pointer', fontSize: 16 } }, React.createElement('i', { className: 'fa-solid fa-chevron-right' })),
                    React.createElement('select', {
                        value: selectedDate,
                        onChange: (ev) => setSelectedDate(ev.target.value),
                        style: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, cursor: 'pointer' }
                    }, uniqueDates.map(d => React.createElement('option', { key: d, value: d }, d)))
                ),

                // Filter pills
                React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' } },
                    React.createElement('button', { onClick: () => setFilterFerme(''), style: pillStyle(!filterFerme) }, 'Toutes fermes'),
                    uniqueFermes.map(f => React.createElement('button', { key: f, onClick: () => setFilterFerme(filterFerme === f ? '' : f), style: pillStyle(filterFerme === f) }, f))
                ),
                uniqueVarieties.length > 1 && React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 } },
                    React.createElement('button', { onClick: () => setFilterVariety(''), style: pillStyle(!filterVariety) }, 'Toutes variétés'),
                    uniqueVarieties.map(v => React.createElement('button', { key: v, onClick: () => setFilterVariety(filterVariety === v ? '' : v), style: pillStyle(filterVariety === v) }, v))
                ),

                // Day detail table
                React.createElement('div', { className: 'panel', style: { marginTop: 8 } },
                    React.createElement('h3', { style: { margin: '0 0 12px', fontSize: 15, color: 'var(--dark)' } },
                        React.createElement('i', { className: 'fa-solid fa-table', style: { marginRight: 8, color: 'var(--berry)' } }),
                        'Détail DQR — ', formatDateFr(selectedDate)
                    ),
                    renderDqrTable(dayData)
                ),

                // Multi-day summary
                React.createElement('div', { className: 'panel', style: { marginTop: 16 } },
                    React.createElement('h3', { style: { margin: '0 0 12px', fontSize: 15, color: 'var(--dark)' } },
                        React.createElement('i', { className: 'fa-solid fa-calendar-days', style: { marginRight: 8, color: '#6366f1' } }),
                        'Historique par jour'
                    ),
                    React.createElement('table', { className: 'data-table', style: { fontSize: 12, width: '100%' } },
                        React.createElement('thead', null,
                            React.createElement('tr', null,
                                React.createElement('th', null, 'Date'),
                                React.createElement('th', { style: { textAlign: 'right' } }, 'Nb DQR'),
                                React.createElement('th', { style: { textAlign: 'right' } }, 'Poids (kg)'),
                                React.createElement('th', { style: { textAlign: 'right' } }, 'Pass'),
                                React.createElement('th', { style: { textAlign: 'right' } }, 'Fail'),
                                React.createElement('th', { style: { textAlign: 'right' } }, 'Taux Pass'),
                                React.createElement('th', null, '')
                            )
                        ),
                        React.createElement('tbody', null,
                            allDaysSummary.map(day => React.createElement(React.Fragment, { key: day.date },
                                React.createElement('tr', {
                                    style: { cursor: 'pointer', background: day.date === selectedDate ? '#f0f4ff' : 'transparent' },
                                    onClick: () => { setSelectedDate(day.date); setExpandedDates(prev => ({ ...prev, [day.date]: !prev[day.date] })); }
                                },
                                    React.createElement('td', { style: { fontWeight: 600 } },
                                        React.createElement('i', { className: 'fa-solid fa-' + (expandedDates[day.date] ? 'chevron-down' : 'chevron-right'), style: { marginRight: 8, fontSize: 10, color: 'var(--gray-400)' } }),
                                        day.date
                                    ),
                                    React.createElement('td', { style: { textAlign: 'right' } }, day.count),
                                    React.createElement('td', { style: { textAlign: 'right', fontWeight: 600 } }, day.kg.toFixed(1)),
                                    React.createElement('td', { style: { textAlign: 'right', color: 'var(--green)' } }, day.pass),
                                    React.createElement('td', { style: { textAlign: 'right', color: day.fail > 0 ? 'var(--red)' : 'var(--gray-400)' } }, day.fail),
                                    React.createElement('td', { style: { textAlign: 'right' } },
                                        React.createElement('span', { className: 'status-badge ' + (day.passRate >= 80 ? 'active' : 'danger') }, day.passRate + '%')
                                    ),
                                    React.createElement('td', null,
                                        React.createElement('i', { className: 'fa-solid fa-eye', style: { color: 'var(--berry)', cursor: 'pointer' } })
                                    )
                                ),
                                expandedDates[day.date] && React.createElement('tr', null,
                                    React.createElement('td', { colSpan: 7, style: { padding: 0 } },
                                        React.createElement('div', { style: { padding: '8px 16px', background: '#fafbfc' } },
                                            renderDqrTable(day.items)
                                        )
                                    )
                                )
                            ))
                        )
                    )
                )
            );
        }

export { DQRDailyTab };
