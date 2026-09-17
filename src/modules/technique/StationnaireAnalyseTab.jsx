/* Module: technique | Déclaration(s): StationnaireAnalyseTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { fetchMeteoblueData } from './fetchMeteoblueData.jsx';
import { transformMeteoblueData } from './transformMeteoblueData.jsx';

function StationnaireAnalyseTab({ farmFilter, currentProfile }) {
            const [readings, setReadings] = useState([]);
            const [loading, setLoading] = useState(true);
            const [analyse, setAnalyse] = useState('');
            const [analyseLoading, setAnalyseLoading] = useState(false);
            const [filterParcelle, setFilterParcelle] = useState('');
            const [meteoData, setMeteoData] = useState(null);

            // Fetch weather
            useEffect(() => {
                fetchMeteoblueData(farmFilter || 'F1').then(data => {
                    if (data) setMeteoData(transformMeteoblueData(data, farmFilter || 'F1'));
                });
            }, [farmFilter]);

            const currentCycle = getCycle(new Date().toISOString());
            const parcelleOptions = React.useMemo(() => {
                return PARCELLES_CULTURALES
                    .filter(pc => pc.ferme === farmFilter && (pc.culture === 'Avocatier' || pc.cycle === currentCycle) && pc.enProduction !== false)
                    .map(pc => ({ value: pc.id, label: pc.secteurs.join('/') + ' ' + pc.variete + (pc.sousVariete ? ' ' + pc.sousVariete : '') }));
            }, [farmFilter, currentCycle]);

            // Load last 7 days of readings
            useEffect(() => {
                const load = async () => {
                    setLoading(true);
                    try {
                        const today = new Date();
                        const days = [];
                        for (let i = 0; i < 7; i++) {
                            const d = new Date(today);
                            d.setDate(d.getDate() - i);
                            days.push(d.toISOString().slice(0, 10));
                        }
                        const allReadings = [];
                        for (const day of days) {
                            const snap = await firebase.firestore().collection('irrigation_readings')
                                .where('ferme', '==', farmFilter)
                                .where('date', '==', day)
                                .orderBy('createdAt', 'desc')
                                .get();
                            snap.docs.forEach(d => allReadings.push({ id: d.id, ...d.data() }));
                        }
                        setReadings(allReadings);
                    } catch (e) { console.error('Erreur chargement analyse:', e); }
                    setLoading(false);
                };
                load();
            }, [farmFilter]);

            // Filter readings
            const filtered = filterParcelle ? readings.filter(r => r.parcelle === filterParcelle) : readings;

            // Compute KPIs
            const kpis = React.useMemo(() => {
                if (!filtered.length) return null;
                const allPtsEc = [], allPtsPh = [], allPtsVol = [];
                const allDrEc = [], allDrPh = [], allDrVol = [];
                const byDate = {};

                filtered.forEach(r => {
                    if (!byDate[r.date]) byDate[r.date] = [];
                    byDate[r.date].push(r);
                    (r.points || []).forEach(p => {
                        if (p.ec > 0) allPtsEc.push(p.ec);
                        if (p.ph > 0) allPtsPh.push(p.ph);
                        if (p.volume > 0) allPtsVol.push(p.volume);
                    });
                    (r.drainage || []).forEach(d => {
                        if (d.ec > 0) allDrEc.push(d.ec);
                        if (d.ph > 0) allDrPh.push(d.ph);
                        if (d.volume > 0) allDrVol.push(d.volume);
                    });
                });

                const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
                const ecApport = avg(allPtsEc);
                const ecDrain = avg(allDrEc);
                const phApport = avg(allPtsPh);
                // % Drainage = (moy V drainage / moy V point) × 100
                const avgVolPt = avg(allPtsVol);
                const avgVolDr = avg(allDrVol);
                const drainPct = avgVolPt > 0 ? (avgVolDr / avgVolPt) * 100 : 0;
                const volTotal = allPtsVol.reduce((a, b) => a + b, 0);
                const nbDays = Object.keys(byDate).length;
                const nbIrrigations = filtered.length;
                const freqJour = nbDays > 0 ? nbIrrigations / nbDays : 0;

                // Par variété
                const byVariete = {};
                filtered.forEach(r => {
                    const pc = PARCELLES_CULTURALES.find(p => p.id === r.parcelle);
                    const vKey = pc ? (pc.variete + (pc.sousVariete ? ' ' + pc.sousVariete : '')) : (r.parcelleLabel || r.parcelle || 'Inconnu');
                    if (!byVariete[vKey]) byVariete[vKey] = { readings: [], ptsEc: [], ptsPh: [], ptsVol: [], drEc: [], drPh: [], drVol: [] };
                    byVariete[vKey].readings.push(r);
                    (r.points || []).forEach(p => { if (p.ec > 0) byVariete[vKey].ptsEc.push(p.ec); if (p.ph > 0) byVariete[vKey].ptsPh.push(p.ph); if (p.volume > 0) byVariete[vKey].ptsVol.push(p.volume); });
                    (r.drainage || []).forEach(d => { if (d.ec > 0) byVariete[vKey].drEc.push(d.ec); if (d.ph > 0) byVariete[vKey].drPh.push(d.ph); if (d.volume > 0) byVariete[vKey].drVol.push(d.volume); });
                });

                return { ecApport, ecDrain, phApport, drainPct, volTotal, freqJour, nbIrrigations, nbDays, byDate, byVariete };
            }, [filtered]);

            // Chart data (by date)
            const chartData = React.useMemo(() => {
                if (!kpis || !kpis.byDate) return [];
                const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
                return Object.keys(kpis.byDate).sort().map(date => {
                    const dayReadings = kpis.byDate[date];
                    const ptsEc = [], ptsPh = [], ptsVol = [], drEc = [], drPh = [], drVol = [];
                    dayReadings.forEach(r => {
                        (r.points || []).forEach(p => { if (p.ec > 0) ptsEc.push(p.ec); if (p.ph > 0) ptsPh.push(p.ph); if (p.volume > 0) ptsVol.push(p.volume); });
                        (r.drainage || []).forEach(d => { if (d.ec > 0) drEc.push(d.ec); if (d.ph > 0) drPh.push(d.ph); if (d.volume > 0) drVol.push(d.volume); });
                    });
                    const avgPtV = avg(ptsVol), avgDrV = avg(drVol);
                    return {
                        jour: date.slice(5),
                        ecApport: +avg(ptsEc).toFixed(2),
                        ecDrain: +avg(drEc).toFixed(2),
                        phApport: +avg(ptsPh).toFixed(2),
                        phDrain: +avg(drPh).toFixed(2),
                        drainPct: avgPtV > 0 ? +((avgDrV / avgPtV) * 100).toFixed(1) : 0,
                        nbIrrig: dayReadings.length,
                    };
                });
            }, [kpis]);

            // Generate AI analysis
            const generateAnalyse = async () => {
                if (!filtered.length) return alert('Aucune donnée à analyser');
                setAnalyseLoading(true);
                try {
                    const resp = await fetch('/api/stock?action=analyse-irrigation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ readings: filtered, ferme: farmFilter, parcelle: filterParcelle }),
                    });
                    const json = await resp.json();
                    if (json.success) {
                        setAnalyse(json.analyse);
                    } else {
                        alert('Erreur: ' + (json.error || 'Erreur inconnue'));
                    }
                } catch (e) { alert('Erreur: ' + e.message); }
                setAnalyseLoading(false);
            };

            // Simple markdown renderer
            const renderMarkdown = (text) => {
                if (!text) return null;
                return text.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) return React.createElement('h3', { key: i, style: { fontSize: '1rem', color: 'var(--berry)', margin: '16px 0 6px', borderBottom: '1px solid #eee', paddingBottom: 4 } }, line.slice(3));
                    if (line.startsWith('### ')) return React.createElement('h4', { key: i, style: { fontSize: '0.9rem', color: '#333', margin: '10px 0 4px' } }, line.slice(4));
                    if (line.startsWith('- ')) return React.createElement('div', { key: i, style: { paddingLeft: 12, margin: '3px 0', fontSize: '0.85rem', lineHeight: 1.5 } }, '• ' + line.slice(2));
                    if (line.match(/^\d+\./)) return React.createElement('div', { key: i, style: { paddingLeft: 8, margin: '3px 0', fontSize: '0.85rem', lineHeight: 1.5, fontWeight: 600 } }, line);
                    if (line.trim() === '') return React.createElement('div', { key: i, style: { height: 6 } });
                    const bold = line.replace(/\*\*(.+?)\*\*/g, '§BOLD§$1§/BOLD§');
                    if (bold.includes('§BOLD§')) {
                        const parts = bold.split(/§\/?BOLD§/).filter(Boolean);
                        return React.createElement('p', { key: i, style: { margin: '3px 0', fontSize: '0.85rem', lineHeight: 1.5 } },
                            parts.map((part, j) => j % 2 === 1 ? React.createElement('strong', { key: j }, part) : part)
                        );
                    }
                    return React.createElement('p', { key: i, style: { margin: '3px 0', fontSize: '0.85rem', lineHeight: 1.5 } }, line);
                });
            };

            if (loading) return React.createElement('div', { style: { padding: 32, textAlign: 'center' } }, 'Chargement des données...');

            const ecStatus = kpis && kpis.ecDrain > 0 && kpis.ecApport > 0 ? (kpis.ecDrain / kpis.ecApport) : 0;
            const phOk = kpis ? (kpis.phApport >= 5.0 && kpis.phApport <= 6.5) : true;
            const drainOk = kpis ? (kpis.drainPct >= 20 && kpis.drainPct <= 30) : true;

            return React.createElement('div', { style: { padding: 16 } },
                React.createElement('h2', { style: { fontSize: '1.2rem', marginBottom: 12, color: 'var(--berry)' } },
                    React.createElement('i', { className: 'fa-solid fa-chart-line', style: { marginRight: 8 } }),
                    'Analyse Irrigation — ', farmFilter
                ),

                // Parcelle filter
                React.createElement('div', { style: { marginBottom: 16 } },
                    React.createElement('select', { value: filterParcelle, onChange: e => setFilterParcelle(e.target.value), style: { padding: 8, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff' } },
                        React.createElement('option', { value: '' }, 'Toutes les parcelles'),
                        parcelleOptions.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))
                    )
                ),

                // KPI Cards
                !kpis || !filtered.length ?
                React.createElement('div', { style: { textAlign: 'center', padding: 40, color: '#999' } },
                    React.createElement('i', { className: 'fa-solid fa-droplet', style: { fontSize: 48, marginBottom: 12, opacity: 0.3 } }),
                    React.createElement('p', null, 'Aucune donnée d\'irrigation sur les 7 derniers jours')
                ) :
                React.createElement('div', null,
                    // KPI Grid
                    React.createElement('div', { className: 'kpi-grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 20 } },
                        React.createElement('div', { className: 'kpi-card' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: 'rgba(52,152,219,0.12)', color: 'var(--blue)' } }, React.createElement('i', { className: 'fa-solid fa-bolt' })),
                            React.createElement('div', { className: 'kpi-value' }, kpis.ecApport.toFixed(2)),
                            React.createElement('div', { className: 'kpi-label' }, 'EC Apport (mS/cm)')
                        ),
                        React.createElement('div', { className: 'kpi-card' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: ecStatus > 1.5 ? 'rgba(231,76,60,0.12)' : 'rgba(46,204,113,0.12)', color: ecStatus > 1.5 ? 'var(--red)' : 'var(--green)' } }, React.createElement('i', { className: 'fa-solid fa-bolt' })),
                            React.createElement('div', { className: 'kpi-value' }, kpis.ecDrain.toFixed(2)),
                            React.createElement('div', { className: 'kpi-label' }, 'EC Drainage'),
                            React.createElement('div', { className: 'kpi-sub' },
                                React.createElement('div', { className: 'kpi-sub-item', style: { color: ecStatus > 1.5 ? 'var(--red)' : 'var(--green)' } }, 'Ratio: ', ecStatus.toFixed(2), ecStatus > 1.5 ? ' 🔴' : ' 🟢')
                            )
                        ),
                        React.createElement('div', { className: 'kpi-card' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: phOk ? 'rgba(46,204,113,0.12)' : 'rgba(243,156,18,0.12)', color: phOk ? 'var(--green)' : '#f39c12' } }, React.createElement('i', { className: 'fa-solid fa-flask' })),
                            React.createElement('div', { className: 'kpi-value' }, kpis.phApport.toFixed(1)),
                            React.createElement('div', { className: 'kpi-label' }, 'pH moyen'),
                            React.createElement('div', { className: 'kpi-sub' },
                                React.createElement('div', { className: 'kpi-sub-item', style: { color: phOk ? 'var(--green)' : '#f39c12' } }, phOk ? '🟢 OK' : '🟡 Hors plage')
                            )
                        ),
                        React.createElement('div', { className: 'kpi-card' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: drainOk ? 'rgba(46,204,113,0.12)' : 'rgba(231,76,60,0.12)', color: drainOk ? 'var(--green)' : 'var(--red)' } }, React.createElement('i', { className: 'fa-solid fa-arrow-down' })),
                            React.createElement('div', { className: 'kpi-value' }, kpis.drainPct.toFixed(1) + '%'),
                            React.createElement('div', { className: 'kpi-label' }, '% Drainage'),
                            React.createElement('div', { className: 'kpi-sub' },
                                React.createElement('div', { className: 'kpi-sub-item', style: { color: drainOk ? 'var(--green)' : 'var(--red)' } }, drainOk ? '🟢 Cible 20-30%' : (kpis.drainPct < 20 ? '🔴 Trop faible' : '🔴 Trop élevé'))
                            )
                        ),
                        React.createElement('div', { className: 'kpi-card' },
                            React.createElement('div', { className: 'kpi-icon berry' }, React.createElement('i', { className: 'fa-solid fa-repeat' })),
                            React.createElement('div', { className: 'kpi-value' }, kpis.freqJour.toFixed(1)),
                            React.createElement('div', { className: 'kpi-label' }, 'Irrigations / jour')
                        ),
                        React.createElement('div', { className: 'kpi-card' },
                            React.createElement('div', { className: 'kpi-icon', style: { background: 'rgba(52,152,219,0.12)', color: 'var(--blue)' } }, React.createElement('i', { className: 'fa-solid fa-droplet' })),
                            React.createElement('div', { className: 'kpi-value' }, kpis.volTotal.toFixed(0) + ' mL'),
                            React.createElement('div', { className: 'kpi-label' }, 'Vol apport total (7j)')
                        )
                    ),

                    // Charts
                    chartData.length > 1 && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 } },
                        // EC Evolution
                        React.createElement('div', { className: 'panel', style: { padding: 12 } },
                            React.createElement('div', { className: 'panel-header', style: { fontSize: '0.9rem', marginBottom: 8 } }, 'Évolution EC (7 jours)'),
                            React.createElement('div', { style: { display: 'flex', gap: 12, fontSize: '0.7rem', marginBottom: 4 } },
                                React.createElement('span', null, React.createElement('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#3498db', marginRight: 4 } }), 'Apport'),
                                React.createElement('span', null, React.createElement('span', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#e74c3c', marginRight: 4 } }), 'Drainage')
                            ),
                            React.createElement(SimpleAreaChart, { data: chartData, dataKeys: ['ecApport', 'ecDrain'], colors: ['#3498db', '#e74c3c'], xKey: 'jour', height: 180 })
                        ),
                        // pH Evolution
                        React.createElement('div', { className: 'panel', style: { padding: 12 } },
                            React.createElement('div', { className: 'panel-header', style: { fontSize: '0.9rem', marginBottom: 8 } }, 'Évolution pH (7 jours)'),
                            React.createElement(SimpleAreaChart, { data: chartData, dataKeys: ['phApport', 'phDrain'], colors: ['#2ecc71', '#f39c12'], xKey: 'jour', height: 180 })
                        ),
                        // Drainage %
                        React.createElement('div', { className: 'panel', style: { padding: 12 } },
                            React.createElement('div', { className: 'panel-header', style: { fontSize: '0.9rem', marginBottom: 8 } }, '% Drainage par jour'),
                            React.createElement(SimpleBarChart, { data: chartData, dataKeys: ['drainPct'], colors: ['#3498db'], xKey: 'jour', height: 180 })
                        ),
                        // Nb irrigations
                        React.createElement('div', { className: 'panel', style: { padding: 12 } },
                            React.createElement('div', { className: 'panel-header', style: { fontSize: '0.9rem', marginBottom: 8 } }, 'Irrigations par jour'),
                            React.createElement(SimpleBarChart, { data: chartData, dataKeys: ['nbIrrig'], colors: ['var(--berry)'], xKey: 'jour', height: 180 })
                        )
                    ),

                    // Per-variety recommendations
                    kpis.byVariete && Object.keys(kpis.byVariete).length > 0 && React.createElement('div', { className: 'panel', style: { padding: 16, marginBottom: 20 } },
                        React.createElement('h3', { style: { fontSize: '1rem', color: 'var(--berry)', margin: '0 0 4px' } },
                            React.createElement('i', { className: 'fa-solid fa-seedling', style: { marginRight: 6 } }),
                            'Recommandations par Variété'
                        ),
                        meteoData && meteoData.previsions && (() => {
                            var today = meteoData.previsions.find(p => p.isToday) || meteoData.previsions[0];
                            return today ? React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
                                React.createElement('span', { style: { fontSize: 10, padding: '3px 8px', borderRadius: 8, background: 'rgba(26,115,232,0.08)', color: '#1a73e8', fontWeight: 600 } },
                                    React.createElement('i', { className: 'fa-solid fa-cloud-sun', style: { marginRight: 3 } }), today.tMax + '°C / ' + today.tMin + '°C'),
                                React.createElement('span', { style: { fontSize: 10, padding: '3px 8px', borderRadius: 8, background: 'rgba(52,152,219,0.08)', color: 'var(--blue)', fontWeight: 600 } },
                                    React.createElement('i', { className: 'fa-solid fa-droplet', style: { marginRight: 3 } }), 'Humidité ' + today.humidity + '%'),
                                React.createElement('span', { style: { fontSize: 10, padding: '3px 8px', borderRadius: 8, background: 'rgba(46,204,113,0.08)', color: 'var(--green)', fontWeight: 600 } },
                                    React.createElement('i', { className: 'fa-solid fa-water', style: { marginRight: 3 } }), 'ETo ' + today.eto + ' mm/j'),
                                today.vent >= 20 && React.createElement('span', { style: { fontSize: 10, padding: '3px 8px', borderRadius: 8, background: 'rgba(243,156,18,0.08)', color: 'var(--orange)', fontWeight: 600 } },
                                    React.createElement('i', { className: 'fa-solid fa-wind', style: { marginRight: 3 } }), 'Vent ' + today.vent + ' km/h')
                            ) : null;
                        })(),
                        Object.entries(kpis.byVariete).map(function(entry) {
                            var vName = entry[0], vData = entry[1];
                            var avgFn = function(arr) { return arr.length ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0; };
                            var ec = avgFn(vData.ptsEc);
                            var ph = avgFn(vData.ptsPh);
                            var ecDr = avgFn(vData.drEc);
                            var volPt = avgFn(vData.ptsVol);
                            var volDr = avgFn(vData.drVol);
                            var pctDrain = volPt > 0 ? (volDr / volPt) * 100 : 0;
                            var nbLectures = vData.readings.length;

                            // Generate recommendations
                            var recos = [];
                            if (ec < 1.0) recos.push({ type: 'warning', icon: 'fa-bolt', text: 'EC apport faible (' + ec.toFixed(2) + ') — Augmenter la concentration en engrais' });
                            if (ec > 2.5) recos.push({ type: 'danger', icon: 'fa-bolt', text: 'EC apport élevé (' + ec.toFixed(2) + ') — Risque de salinité, diluer la solution' });
                            if (ecDr > 0 && ec > 0 && ecDr / ec > 1.5) recos.push({ type: 'danger', icon: 'fa-arrow-trend-up', text: 'Ratio EC drain/apport élevé (' + (ecDr / ec).toFixed(2) + ') — Accumulation de sels, augmenter le lessivage' });
                            if (ph < 5.0) recos.push({ type: 'warning', icon: 'fa-flask', text: 'pH trop acide (' + ph.toFixed(1) + ') — Réduire l\'acide, risque de toxicité' });
                            if (ph > 6.5) recos.push({ type: 'warning', icon: 'fa-flask', text: 'pH trop alcalin (' + ph.toFixed(1) + ') — Augmenter l\'acide, mauvaise absorption' });
                            if (pctDrain > 0 && pctDrain < 10) recos.push({ type: 'danger', icon: 'fa-arrow-down', text: 'Drainage insuffisant (' + pctDrain.toFixed(1) + '%) — Augmenter la durée ou fréquence d\'irrigation' });
                            if (pctDrain > 35) recos.push({ type: 'warning', icon: 'fa-arrow-up', text: 'Drainage excessif (' + pctDrain.toFixed(1) + '%) — Réduire la durée d\'irrigation, gaspillage d\'eau' });

                            // Weather-based recommendations
                            if (meteoData && meteoData.previsions) {
                                var today = meteoData.previsions.find(function(p) { return p.isToday; }) || meteoData.previsions[0];
                                if (today) {
                                    if (today.tMax >= 32) recos.push({ type: 'warning', icon: 'fa-temperature-high', text: 'Forte chaleur prévue (' + today.tMax + '°C) — Augmenter les irrigations, fractionner' });
                                    if (today.eto >= 5) recos.push({ type: 'warning', icon: 'fa-sun', text: 'ETo élevée (' + today.eto + ' mm/j) — Compenser par un apport supplémentaire' });
                                    if (today.precip >= 5) recos.push({ type: 'info', icon: 'fa-cloud-rain', text: 'Pluie prévue (' + today.precip + ' mm) — Réduire l\'irrigation aujourd\'hui' });
                                    if (today.humidity < 30) recos.push({ type: 'warning', icon: 'fa-droplet', text: 'Air très sec (' + today.humidity + '%) — Stress hydrique possible, surveiller le substrat' });
                                }
                            }

                            if (recos.length === 0) recos.push({ type: 'ok', icon: 'fa-circle-check', text: 'Paramètres dans les normes — Continuer le programme actuel' });

                            var statusColor = recos.some(function(r) { return r.type === 'danger'; }) ? 'var(--red)' : recos.some(function(r) { return r.type === 'warning'; }) ? 'var(--orange)' : 'var(--green)';

                            return React.createElement('div', { key: vName, style: { marginBottom: 14, borderRadius: 12, border: '1px solid ' + statusColor + '33', background: statusColor === 'var(--green)' ? 'rgba(46,204,113,0.03)' : statusColor === 'var(--orange)' ? 'rgba(243,156,18,0.03)' : 'rgba(231,76,60,0.03)', overflow: 'hidden' } },
                                // Header
                                React.createElement('div', { style: { padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid ' + statusColor + '22' } },
                                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                                        React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: statusColor } }),
                                        React.createElement('span', { style: { fontWeight: 700, fontSize: 13, color: 'var(--dark)' } }, vName),
                                        React.createElement('span', { style: { fontSize: 10, color: 'var(--gray-400)' } }, nbLectures + ' lectures / 7j')
                                    ),
                                    React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                                        React.createElement('span', { style: { fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, background: 'rgba(52,152,219,0.08)', color: 'var(--blue)' } }, 'EC ' + ec.toFixed(2)),
                                        React.createElement('span', { style: { fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, background: 'rgba(46,204,113,0.08)', color: 'var(--green)' } }, 'pH ' + ph.toFixed(1)),
                                        pctDrain > 0 && React.createElement('span', { style: { fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 600, background: pctDrain >= 10 && pctDrain <= 30 ? 'rgba(46,204,113,0.08)' : 'rgba(231,76,60,0.08)', color: pctDrain >= 10 && pctDrain <= 30 ? 'var(--green)' : 'var(--red)' } }, 'Drain ' + pctDrain.toFixed(1) + '%')
                                    )
                                ),
                                // Recommendations
                                React.createElement('div', { style: { padding: '8px 14px' } },
                                    recos.map(function(reco, i) {
                                        var recoColor = reco.type === 'danger' ? 'var(--red)' : reco.type === 'warning' ? 'var(--orange)' : reco.type === 'ok' ? 'var(--green)' : 'var(--blue)';
                                        return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', fontSize: 12, lineHeight: 1.5 } },
                                            React.createElement('i', { className: 'fa-solid ' + reco.icon, style: { color: recoColor, marginTop: 2, flexShrink: 0 } }),
                                            React.createElement('span', { style: { color: 'var(--gray-700)' } }, reco.text)
                                        );
                                    })
                                )
                            );
                        })
                    ),

                    // AI Recommendations
                    React.createElement('div', { className: 'panel', style: { padding: 16, marginBottom: 20 } },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
                            React.createElement('h3', { style: { fontSize: '1rem', color: 'var(--berry)', margin: 0 } },
                                React.createElement('i', { className: 'fa-solid fa-robot', style: { marginRight: 6 } }),
                                'Recommandations Agronomiques'
                            ),
                            React.createElement('button', {
                                className: 'btn-primary',
                                onClick: generateAnalyse,
                                disabled: analyseLoading,
                                style: { padding: '8px 16px', fontSize: '0.85rem', borderRadius: 8 }
                            }, analyseLoading ?
                                React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-spinner fa-spin', style: { marginRight: 6 } }), 'Analyse en cours...') :
                                React.createElement('span', null, React.createElement('i', { className: 'fa-solid fa-wand-magic-sparkles', style: { marginRight: 6 } }), 'Générer analyse')
                            )
                        ),
                        analyse ?
                            React.createElement('div', { style: { background: '#fafafa', borderRadius: 10, padding: 16, border: '1px solid #eee' } }, renderMarkdown(analyse)) :
                            React.createElement('div', { style: { textAlign: 'center', padding: 24, color: '#bbb' } },
                                React.createElement('i', { className: 'fa-solid fa-wand-magic-sparkles', style: { fontSize: 28, marginBottom: 8 } }),
                                React.createElement('p', { style: { margin: 0 } }, 'Cliquez sur "Générer analyse" pour obtenir les recommandations d\'un expert irrigation')
                            )
                    )
                )
            );
        }

export { StationnaireAnalyseTab };
