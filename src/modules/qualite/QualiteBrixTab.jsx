/* Module: qualite | Déclaration(s): QualiteBrixTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { deduplicateExpeditions } from './deduplicateExpeditions.jsx';

// ===================== QUALITE BRIX TAB =====================
        function QualiteBrixTab({ data, applyVarietyMapping }) {
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => { if (json.success && json.expeditions) setExpeditions(json.expeditions); })
                    .catch(err => console.warn('Could not load expeditions:', err))
                    .finally(() => setLoading(false));
            }, []);

            // Apply variety mapping + deduplicate by batchNumber
            const mappedExpeditions = React.useMemo(() =>
                deduplicateExpeditions(expeditions).map(e => ({
                    ...e, variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety
                })),
            [expeditions, applyVarietyMapping]);

            const uniqueFermes = [...new Set(mappedExpeditions.map(e => ranchToFerme[e.ranch] || e.ranch).filter(Boolean))].sort();
            const fermeFiltered = selectedFerme ? mappedExpeditions.filter(e => (ranchToFerme[e.ranch] || e.ranch) === selectedFerme) : mappedExpeditions;
            const varietes = [...new Set(fermeFiltered.map(e => e.variety).filter(Boolean))].sort();
            const activeVariete = selectedVariete || 'Toutes';
            const varFiltered = activeVariete === 'Toutes' ? fermeFiltered : fermeFiltered.filter(e => e.variety === activeVariete);

            // Aggregate brix by date
            const brixHistory = React.useMemo(() => {
                const byDate = {};
                varFiltered.forEach(e => {
                    if (!e.brix) return;
                    const raw = e.date || '';
                    const dateKey = raw.includes('/') ? raw.split(' ')[0] : raw.substring(0, 10);
                    if (!byDate[dateKey]) byDate[dateKey] = [];
                    byDate[dateKey].push(e.brix);
                });
                return Object.entries(byDate)
                    .map(([date, vals]) => ({ date, avgBrix: vals.reduce((s,v) => s+v, 0) / vals.length, nb: vals.length, min: Math.min(...vals), max: Math.max(...vals) }))
                    .sort((a, b) => a.date > b.date ? 1 : -1);
            }, [varFiltered]);

            const allBrix = varFiltered.filter(e => e.brix).map(e => e.brix);
            const globalAvg = allBrix.length > 0 ? allBrix.reduce((s,v) => s+v, 0) / allBrix.length : 0;
            const minBrix = allBrix.length > 0 ? Math.min(...allBrix) : 0;
            const maxBrix = allBrix.length > 0 ? Math.max(...allBrix) : 0;

            // Count expeditions with PFQ Brix received (from Daily Quality Report emails)
            const nbBrixRecu = varFiltered.filter(e => e.pfqBrix != null || e.status === 'PFQ Brix reçu').length;

            if (loading) return <div style={{textAlign:'center', padding:24, color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div>;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', gap:16, marginBottom:16, flexWrap:'wrap', alignItems:'center'}}>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            {['Toutes', ...uniqueFermes].map(f => (
                                <button key={f} className={`chip c-blue ${(f === 'Toutes' ? !selectedFerme : selectedFerme === f) ? 'active' : ''}`}
                                    onClick={() => { setSelectedFerme(f === 'Toutes' ? '' : f); setSelectedVariete(''); }}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Variété:</span>
                            {['Toutes', ...varietes].map(v => (
                                <button key={v} className={`chip c-berry ${activeVariete === v ? 'active' : ''}`}
                                    onClick={() => setSelectedVariete(v)}>
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="kpi-grid">
                        <KPICard icon="fa-flask" iconClass="berry"
                            value={Math.round(globalAvg * 10) / 10}
                            label="Brix Moyen" />
                        <KPICard icon="fa-arrow-down" iconClass="orange"
                            value={Math.round(minBrix * 10) / 10}
                            label="Brix Min" />
                        <KPICard icon="fa-arrow-up" iconClass="green"
                            value={Math.round(maxBrix * 10) / 10}
                            label="Brix Max" />
                        <KPICard icon="fa-chart-simple" iconClass="blue"
                            value={allBrix.length}
                            label="Nb Mesures" />
                        <KPICard icon="fa-envelope-circle-check" iconClass="green"
                            value={nbBrixRecu}
                            label="PFQ Brix reçus" />
                    </div>

                    <Panel title={`Évolution Brix - ${activeVariete}`} icon="fa-chart-line">
                        {brixHistory.length > 1 ? (
                            <SimpleAreaChart
                                data={brixHistory.map(h => ({
                                    date: h.date.length > 5 ? h.date.substring(0, 5) : h.date,
                                    Brix: Math.round(h.avgBrix * 10) / 10
                                }))}
                                dataKeys={['Brix']}
                                colors={['#9C27B0']}
                                xKey="date"
                                height={250}
                                showLabelsFor="Brix"
                            />
                        ) : (
                            <div style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>Pas assez de données pour afficher le graphique</div>
                        )}
                    </Panel>

                    <Panel title={`Détail Journalier Brix - ${activeVariete}`} icon="fa-table">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Nb Lots</th>
                                    <th>Brix Moy.</th>
                                    <th>Brix Min</th>
                                    <th>Brix Max</th>
                                    <th>Évaluation</th>
                                </tr>
                            </thead>
                            <tbody>
                                {brixHistory.map((h, i) => {
                                    const avg = Math.round(h.avgBrix * 10) / 10;
                                    const evaluation = avg >= 8 ? 'Bon' : (avg >= 7 ? 'Moyen' : 'Faible');
                                    const evalColor = avg >= 8 ? 'var(--green)' : (avg >= 7 ? 'var(--orange)' : 'var(--red)');
                                    return (
                                        <tr key={i}>
                                            <td style={{fontWeight: 500}}>{h.date}</td>
                                            <td>{h.nb}</td>
                                            <td style={{fontWeight: 700}}>{avg}</td>
                                            <td>{Math.round(h.min * 10) / 10}</td>
                                            <td>{Math.round(h.max * 10) / 10}</td>
                                            <td><span className={`status-badge ${avg >= 8 ? 'active' : (avg >= 7 ? 'warning' : 'danger')}`}>{evaluation}</span></td>
                                        </tr>
                                    );
                                })}
                                {brixHistory.length === 0 && (
                                    <tr><td colSpan="6" style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>
                                        Aucune donnée Brix disponible
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </Panel>

                    <div style={{marginTop: 16, padding: 16, background: 'rgba(212,168,71,0.1)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Note:</strong> Le Brix (°Bx) mesure la teneur en sucre du fruit.
                        L'évaluation Brix est réalisée par Driscoll's et le rapport arrive le lendemain (J+1).
                        Seuils: ≥8.0 Bon | 7.0-8.0 Moyen | {'<'}7.0 Faible
                    </div>
                </div>
            );
        }

export { QualiteBrixTab };
