/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualiteDashboardTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { PFQEvolutionChart } from './PFQEvolutionChart.jsx';

// ===================== QUALITE DASHBOARD TAB =====================
        function QualiteDashboardTab({ data, weeklyBerryFilter, setWeeklyBerryFilter }) {
            const [selectedLot, setSelectedLot] = useState(null);
            const [selectedBloc, setSelectedBloc] = useState('');
            const [selectedWeekReport, setSelectedWeekReport] = useState(null);
            const [expeditions, setExpeditions] = useState([]);
            const [bonsApport, setBonsApport] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDay, setSelectedDay] = useState('');

            React.useEffect(() => {
                const loadAll = async () => {
                    // Load expeditions
                    try {
                        const json = await cachedFetch('/api/email-analysis?action=expeditions&limit=2000');
                        if (json.success && json.expeditions) {
                            const cutoff = '2026-01-01';
                            const filtered = json.expeditions.filter(e => {
                                if (e.overallResult === 'REJECT') return false;
                                const raw = e.date || e.createdAt || '';
                                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                                const d = m ? m[3] + '-' + m[1] + '-' + m[2] : (raw.length >= 10 && raw[4] === '-' ? raw.slice(0, 10) : '');
                                return d >= cutoff;
                            });
                            setExpeditions(filtered);
                        }
                    } catch(err) { console.warn('Could not load expeditions:', err); }
                    // Load bons d'apport (production data)
                    try {
                        const prodBons = await loadBonsFromFirestore();
                        setBonsApport(prodBons.filter(b => b.typeVente === 'Export'));
                    } catch(err) { console.warn('Could not load bons apport:', err); }
                    setLoading(false);
                };
                loadAll();
            }, []);

            // Map real expeditions to inspection format for the dashboard
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };
            const blocIdsRef = data.blocIds;

            const inspections = React.useMemo(() => {
                // Known condition defect names vs appearance defect names
                const condDefectNames = ['Decay', 'Wet Leaky', 'Overripe', 'Collapsed', 'Weak Cells', 'Sooty Mold', 'Yellow Rust'];
                const appDefectNames = ['Broken', 'Green', 'Size', 'Skin Damage', 'Malformed', 'Attached Calyx', 'Foreign bodies'];
                return expeditions.map(e => {
                    // conditionDefects from API contains ALL defects mixed together
                    // Split them into condition vs appearance using known names
                    const allDefects = e.conditionDefects || [];
                    const condDetail = allDefects.filter(d => condDefectNames.includes(d.name));
                    const appDetail = allDefects.filter(d => appDefectNames.includes(d.name));
                    // Get totals from summary rows
                    const condSummary = allDefects.find(d => d.name === 'Condition');
                    const appSummary = allDefects.find(d => d.name === 'Appearance');
                    const condPct = condDetail.reduce((s, d) => s + (d.percent || 0), 0);
                    const appPct = appDetail.reduce((s, d) => s + (d.percent || 0), 0);
                    const result = (e.overallResult || '').toUpperCase() === 'PASS' ? 'Pass' : 'Fail';
                    const pqScore = e.enrichedPqScore || e.pqScore || e.pfqTotal || 0;
                    const brix = e.brix || e.brixFromDQR || 0;
                    const conditionPoints = e.pfqCondition || (condSummary ? condSummary.points : 0) || 0;
                    const appearancePoints = e.pfqApparence || (appSummary ? appSummary.points : 0) || 0;
                    const brixReceived = e.pfqBrix != null;
                    // Derive blocId from variety + ranch
                    const variety = (e.variety || '').toLowerCase();
                    const ranch = e.ranch || '';
                    const ferme = ranchToFerme[ranch] || '';
                    let blocId = '';
                    // Try to match via batch number pattern (e.g. 195252195-R07103 → blockId 195-R071)
                    if (e.batchNumber) {
                        for (const b of blocIdsRef) {
                            if (b.ferme && b.ferme !== ferme) continue;
                            const blockCode = b.blockId.replace('-', '');
                            if (e.batchNumber.includes(blockCode)) {
                                blocId = b.id;
                                break;
                            }
                        }
                    }
                    // Fallback: match by variety + ranch
                    if (!blocId) {
                        const match = blocIdsRef.find(b => b.ranch === ranch && (b.variete?.toLowerCase() === variety || b.label?.toLowerCase() === variety));
                        if (match) blocId = match.id;
                    }
                    // If still no match, create a dynamic blocId by variety+ferme
                    if (!blocId) blocId = 'DYN-' + ferme + '-' + (e.variety || 'Inconnu').replace(/\s+/g, '');

                    return {
                        receiptId: e.receiptId || '',
                        batchNumber: e.batchNumber || '',
                        variete: e.variety || '',
                        blocId,
                        qty: e.batchQuantity || 0,
                        weight: e.batchWeight || 0,
                        brix,
                        pqScore,
                        result,
                        condPct: Math.round(condPct * 100) / 100,
                        appPct: Math.round(appPct * 100) / 100,
                        fruitInspected: e.totalFruitInspected || 0,
                        sampleSize: e.sampleSize || 0,
                        avgFruitPerPunnet: e.avgFruitsPerPunnet || 0,
                        avgPunnetWeight: e.avgPunnetWeight || 0,
                        item: e.item ? (e.itemDescription ? e.item + ' ' + e.itemDescription : e.item) : '',
                        warehouse: e.warehouse || '',
                        license: e.license || '',
                        received: e.date || '',
                        inspected: e.inspectedDate || '',
                        conditionDetail: condDetail.map(d => ({ defect: d.name, count: d.count || 0, pct: d.percent || 0 })),
                        conditionPoints,
                        appearanceDetail: appDetail.map(d => ({ defect: d.name, count: d.count || 0, pct: d.percent || 0, points: d.points || 0 })),
                        appearancePoints,
                        brixReceived,
                        date: e.date || '',
                        type: 'Initial Inspection',
                        ranch,
                        ranchName: e.ranchName && !e.ranchName.startsWith('Receipt') ? e.ranchName : (ranchToFerme[ranch] === 'F1' ? 'R-Berry Good Farms SARL' : 'Berry Good Farms SARL 3'),
                        ferme,
                    };
                });
            }, [expeditions, blocIdsRef]);

            // Parse date from "MM/DD/YYYY HH:MM GMT" or ISO format to YYYY-MM-DD
            const parseDay = (raw) => {
                if (!raw) return '';
                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return `${m[3]}-${m[1]}-${m[2]}`;
                if (raw.length >= 10 && raw[4] === '-') return raw.slice(0, 10);
                return '';
            };

            // Add parsed day to each inspection
            const inspectionsWithDay = React.useMemo(() =>
                inspections.map(i => ({ ...i, _day: parseDay(i.date || i.received) })),
            [inspections]);

            // Get unique dates sorted descending, auto-select most recent
            const uniqueDates = React.useMemo(() =>
                [...new Set(inspectionsWithDay.map(i => i._day).filter(Boolean))].sort().reverse(),
            [inspectionsWithDay]);

            React.useEffect(() => {
                if (!selectedDay && uniqueDates.length > 0) {
                    const today = new Date().toISOString().slice(0, 10);
                    setSelectedDay(uniqueDates.includes(today) ? today : uniqueDates[0]);
                }
            }, [uniqueDates]);

            // Today's lots = filtered by selected day
            const todayLots = React.useMemo(() =>
                inspectionsWithDay.filter(i => i._day === selectedDay),
            [inspectionsWithDay, selectedDay]);

            // KPIs based on today's lots
            const totalBatches = todayLots.length;
            const passCount = todayLots.filter(i => i.result === 'Pass').length;
            const failCount = totalBatches - passCount;
            const avgPQ = totalBatches > 0 ? Math.round(todayLots.reduce((s, i) => s + i.pqScore, 0) / totalBatches * 10) / 10 : 0;
            const avgCond = totalBatches > 0 ? Math.round(todayLots.reduce((s, i) => s + i.condPct, 0) / totalBatches * 100) / 100 : 0;
            const avgApp = totalBatches > 0 ? Math.round(todayLots.reduce((s, i) => s + i.appPct, 0) / totalBatches * 100) / 100 : 0;

            // Build blocs dynamically from inspections
            const blocsMap = {};
            inspections.forEach(insp => {
                if (!blocsMap[insp.blocId]) {
                    const ref = blocIdsRef.find(b => b.id === insp.blocId);
                    blocsMap[insp.blocId] = {
                        id: insp.blocId,
                        label: ref ? ref.label : insp.variete,
                        parcelle: ref ? ref.parcelle : '',
                        ferme: ref ? ref.ferme : insp.ferme,
                        ranch: ref ? ref.ranch : insp.ranch,
                        ranchName: ref ? ref.ranchName : '',
                        ha: ref ? ref.ha : 0,
                    };
                }
            });
            const blocs = Object.values(blocsMap);

            // Aggregate by bloc (using ALL inspections, not just today)
            const blocStats = {};
            blocs.forEach(b => { blocStats[b.id] = { bloc: b, lots: [], pass: 0, totalPQ: 0, totalCond: 0, totalApp: 0, totalKg: 0, totalKgProd: 0, totalBrix: 0 }; });
            inspectionsWithDay.forEach(i => {
                const bs = blocStats[i.blocId];
                if (bs) {
                    bs.lots.push(i);
                    if (i.result === 'Pass') bs.pass++;
                    bs.totalPQ += i.pqScore;
                    bs.totalCond += i.condPct;
                    bs.totalApp += i.appPct;
                    bs.totalKg += i.weight;
                    bs.totalBrix += i.brix;
                }
            });
            // Aggregate production Kg from bons d'apport
            bonsApport.forEach(bon => {
                const variety = (bon.blocVariete || '').toLowerCase();
                const ferme = bon.blocFerme || '';
                const match = blocIdsRef.find(b => b.variete?.toLowerCase() === variety && b.ferme === ferme);
                if (match && blocStats[match.id]) {
                    blocStats[match.id].totalKgProd += parseFloat(bon.poidsLot) || 0;
                }
            });

            const filteredInspections = selectedBloc ? todayLots.filter(i => i.blocId === selectedBloc) : todayLots;

            if (loading) return <div style={{padding:40, textAlign:'center'}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24, color:'var(--berry)'}}></i><div style={{marginTop:12, color:'var(--gray-400)'}}>Chargement des inspections...</div></div>;

            return (
                <div className="fade-in">
                    {/* Global KPIs */}
                    <div className="kpi-grid">
                        <KPICard icon="fa-clipboard-check" iconClass="green" value={`${totalBatches > 0 ? Math.round(passCount/totalBatches*100) : 0}%`} label="Taux de Pass" subItems={[{value: passCount, label:'Pass'}, {value: failCount, label:'Fail'}]} />
                        <KPICard icon="fa-star" iconClass="berry" value={avgPQ} label="PQ Score Moyen" />
                        <KPICard icon="fa-triangle-exclamation" iconClass="orange" value={`${avgCond}%`} label="Condition Defects" />
                        <KPICard icon="fa-eye" iconClass="blue" value={`${avgApp}%`} label="Appearance Defects" />
                    </div>

                    {/* KPIs par Bloc ID */}
                    <Panel title="Performance par Bloc ID" icon="fa-cubes">
                        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'16px'}}>
                            {Object.values(blocStats).filter(bs => bs.lots.length > 0).map((bs, i) => {
                                const n = bs.lots.length;
                                const passRate = Math.round(bs.pass/n*100);
                                const avgPQBloc = Math.round(bs.totalPQ/n*10)/10;
                                const avgBrix = Math.round(bs.totalBrix/n*10)/10;
                                return (
                                    <div key={i} style={{padding:'16px', border:'1px solid var(--gray-200)', borderRadius:'12px', background: selectedBloc === bs.bloc.id ? 'var(--berry-pale)' : 'white', cursor:'pointer', transition:'all 0.2s', borderColor: selectedBloc === bs.bloc.id ? 'var(--berry)' : 'var(--gray-200)'}} onClick={() => setSelectedBloc(selectedBloc === bs.bloc.id ? '' : bs.bloc.id)}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
                                            <div>
                                                <div style={{fontSize:'15px', fontWeight:'700', color:'var(--berry)'}}>{bs.bloc.label}</div>
                                                <div style={{fontSize:'11px', color:'var(--gray-400)'}}>Parcelle {bs.bloc.parcelle} | {bs.bloc.ferme}{bs.bloc.ha ? ` | ${bs.bloc.ha} Ha` : ''}</div>
                                            </div>
                                            <span className={`status-badge ${passRate >= 80 ? 'green' : (passRate >= 50 ? 'orange' : 'red')}`}>{passRate}% Pass</span>
                                        </div>
                                        <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:'8px', textAlign:'center'}}>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700'}}>{n}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Lots</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--berry)'}}>{avgPQBloc}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>PQ Score</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700'}}>{Math.round(bs.totalKgProd).toLocaleString()}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Kg Prod</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--gray-500)'}}>{Math.round(bs.totalKg).toLocaleString()}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Kg Exp</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--green)'}}>{bs.bloc.ha > 0 ? Math.round(bs.totalKgProd / bs.bloc.ha).toLocaleString() : '-'}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Kg/Ha</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--blue)'}}>{avgBrix}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Brix</div>
                                            </div>
                                        </div>
                                        <div style={{marginTop:'8px'}}>
                                            <div style={{height:'6px', background:'var(--gray-200)', borderRadius:'3px'}}>
                                                <div style={{height:'100%', width:`${Math.min(avgPQBloc, 100)}%`, background: avgPQBloc >= 80 ? 'var(--green)' : (avgPQBloc >= 60 ? 'var(--orange)' : 'var(--red)'), borderRadius:'3px'}}></div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Panel>

                    {/* Lots du jour - clickable */}
                    <Panel title={selectedBloc ? `Lots - ${blocs.find(b=>b.id===selectedBloc)?.label || ''}` : `Lots du ${selectedDay ? new Date(selectedDay + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'}) : 'Jour'}`} icon="fa-list">
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px', flexWrap:'wrap', gap:8}}>
                            <p style={{fontSize:'11px', color:'var(--gray-400)', margin:0}}>
                                <i className="fa-solid fa-hand-pointer"></i> Cliquez sur un lot pour voir le rapport d'inspection complet
                            </p>
                            <select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} style={{padding:'4px 10px', fontSize:12, borderRadius:6, border:'1px solid var(--gray-200)', background:'white'}}>
                                {uniqueDates.map(d => <option key={d} value={d}>{new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit', year:'numeric'})}</option>)}
                            </select>
                        </div>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Receipt ID</th>
                                    <th>Variété</th>
                                    <th>Batch</th>
                                    <th>Colis</th>
                                    <th>Poids (kg)</th>
                                    <th>PFQ Condition</th>
                                    <th>PFQ Apparence</th>
                                    <th>PFQ Brix</th>
                                    <th>PFQ Total</th>
                                    <th>Résultat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredInspections.map((lot, i) => {
                                    const brixPFQValue = lot.brixReceived ? Math.round((lot.brix / 8) * 10) : null;
                                    const totalPFQ = lot.brixReceived ? (lot.conditionPoints + lot.appearancePoints + brixPFQValue) : null;
                                    return (
                                        <tr key={i} onClick={() => setSelectedLot(lot)} style={{cursor:'pointer', transition:'background 0.15s'}} onMouseOver={e => e.currentTarget.style.background='var(--berry-pale)'} onMouseOut={e => e.currentTarget.style.background=''}>
                                            <td><strong style={{color:'var(--blue)'}}>{lot.receiptId}</strong></td>
                                            <td>{lot.variete}</td>
                                            <td style={{fontSize:'11px'}}>{lot.batchNumber}</td>
                                            <td>{lot.qty}</td>
                                            <td>{lot.weight}</td>
                                            <td style={{fontWeight:600, color:'var(--red)'}}>{lot.conditionPoints}/70</td>
                                            <td style={{fontWeight:600, color:'var(--orange)'}}>{lot.appearancePoints}/20</td>
                                            <td style={{fontWeight:600, color:'#9C27B0'}}>
                                                {lot.brixReceived ? `${brixPFQValue}/10` : 'En attente'}
                                            </td>
                                            <td style={{fontWeight:600, color:totalPFQ >= 70 ? 'var(--green)' : (totalPFQ ? 'var(--orange)' : 'var(--gray-400)')}}>
                                                {totalPFQ ? `${totalPFQ}/100` : 'En attente'}
                                            </td>
                                            <td><span className={`status-badge ${lot.result === 'Pass' ? 'green' : 'red'}`}>{lot.result === 'Pass' ? '✓ PASS' : '✗ FAIL'}</span></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </Panel>

                    {/* Brix par Variété */}
                    <Panel title="Brix par Variété" icon="fa-flask">
                        <table className="data-table">
                            <thead><tr><th>Variété</th><th>Ranch Avg Brix</th><th>Pool Avg Brix</th><th>Écart</th><th>PFQ Brix</th><th>Évaluation</th></tr></thead>
                            <tbody>
                                {data.qualiteBrix.map((b, i) => {
                                    const ecart = Math.round((b.ranchAvg - b.poolAvg) * 100) / 100;
                                    return (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{b.variete}</td>
                                            <td><strong>{Math.round(b.ranchAvg*10)/10}</strong></td>
                                            <td style={{color:'var(--gray-400)'}}>{Math.round(b.poolAvg*10)/10}</td>
                                            <td style={{color: ecart >= 0 ? 'var(--green)' : 'var(--red)', fontWeight:600}}>{ecart >= 0 ? '+' : ''}{ecart}</td>
                                            <td style={{fontWeight:600, color:'#9C27B0'}}>{b.brixPFQ}/10</td>
                                            <td><span className={`status-badge ${b.ranchAvg >= 8 ? 'green' : (b.ranchAvg >= 7 ? 'orange' : 'red')}`}>{b.ranchAvg >= 8 ? '✓ Bon' : (b.ranchAvg >= 7 ? '⚠ Moyen' : '✗ Faible')}</span></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{marginTop:8, fontSize:11, color:'var(--gray-400)', fontStyle:'italic'}}>Source: Rapport Brix Driscoll's (J+1) | Pool = moyenne tous producteurs Driscoll's</div>
                    </Panel>

                    {/* Evolution PFQ par Bloc ID */}
                    <Panel title="Évolution PFQ par Bloc ID (7 derniers jours)" icon="fa-chart-line">
                        <div style={{display:'flex', gap:12, marginBottom:16, alignItems:'center', flexWrap:'wrap'}}>
                            <label style={{fontSize:12, fontWeight:600}}>Bloc:</label>
                            <select value={selectedBloc} onChange={(e) => setSelectedBloc(e.target.value)} style={{padding:'6px 12px', fontSize:12, borderRadius:6, border:'1px solid var(--gray-200)'}}>
                                <option value="">Tous les blocs</option>
                                {blocs.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                            </select>
                        </div>
                        {selectedBloc && data.pfqHistory[selectedBloc] ? (
                            <PFQEvolutionChart data={data.pfqHistory[selectedBloc]} blocLabel={blocs.find(b=>b.id===selectedBloc)?.label} />
                        ) : (
                            <div style={{padding:'20px', textAlign:'center', color:'var(--gray-400)'}}>
                                Sélectionnez un bloc pour voir l'évolution PFQ
                            </div>
                        )}
                    </Panel>

                    {/* Toggle Framboise / Myrtille */}
                    <div style={{display:'flex', alignItems:'center', gap:8, margin:'16px 0 8px'}}>
                        <span style={{fontSize:13, fontWeight:600, color:'var(--gray-500)'}}>Culture :</span>
                        {['framboise', 'myrtille'].map(b => (
                            <button key={b} onClick={() => setWeeklyBerryFilter(b)} style={{
                                padding:'6px 16px', borderRadius:20, border: weeklyBerryFilter === b ? '2px solid var(--berry)' : '1px solid var(--gray-200)',
                                background: weeklyBerryFilter === b ? 'var(--berry-pale)' : 'white', color: weeklyBerryFilter === b ? 'var(--berry)' : 'var(--gray-500)',
                                fontWeight: weeklyBerryFilter === b ? 700 : 400, fontSize:13, cursor:'pointer', transition:'all 0.2s'
                            }}>
                                {b === 'framboise' ? 'Framboise' : 'Myrtille'}
                            </button>
                        ))}
                    </div>

                    {/* Evolution Qualité par Semaine par Ferme */}
                    <Panel title="Évolution Qualité Hebdomadaire par Ferme" icon="fa-chart-column">
                        {(() => {
                            const hist = [...data.weeklyRanking.history].reverse();
                            const chartW = 780, chartH = 260, padL = 50, padR = 20, padT = 20, padB = 40;
                            const plotW = chartW - padL - padR;
                            const plotH = chartH - padT - padB;
                            const allVals = hist.flatMap(h => [h.highest, h.lowest, h.f1Score, h.f5Score, h.avg].filter(v => v != null && !isNaN(v)));
                            if (allVals.length === 0) return <div style={{padding:20, textAlign:'center', color:'var(--gray-400)'}}>Pas encore assez de données hebdomadaires</div>;
                            const minVal = Math.floor(Math.min(...allVals) - 1);
                            const maxVal = Math.ceil(Math.max(...allVals) + 1);
                            const range = maxVal - minVal;
                            const yScale = v => padT + plotH - ((v - minVal) / range) * plotH;
                            const groupW = plotW / hist.length;
                            const barW = 14;

                            return (
                                <div>
                                    <div style={{display:'flex', gap:16, marginBottom:12, flexWrap:'wrap', fontSize:11}}>
                                        <span><span style={{display:'inline-block',width:12,height:12,background:'#E8E8E8',borderRadius:2,marginRight:4,verticalAlign:'middle'}}></span> Range (Lowest - Highest)</span>
                                        <span><span style={{display:'inline-block',width:12,height:12,background:'var(--berry)',borderRadius:2,marginRight:4,verticalAlign:'middle'}}></span> Ferme 172 (F1)</span>
                                        <span><span style={{display:'inline-block',width:12,height:12,background:'var(--green)',borderRadius:2,marginRight:4,verticalAlign:'middle'}}></span> Ferme 195 (F5)</span>
                                        <span><span style={{display:'inline-block',width:12,height:2,background:'var(--orange)',marginRight:4,verticalAlign:'middle'}}></span> Moyenne Pool</span>
                                        <span style={{marginLeft:'auto', fontSize:10, color:'var(--gray-400)'}}>Objectif: Top 5</span>
                                    </div>
                                    <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width:'100%', maxWidth:chartW}}>
                                        {/* Grid lines */}
                                        {[0,1,2,3,4].map(i => {
                                            const val = minVal + (range * i / 4);
                                            const y = yScale(val);
                                            return (
                                                <g key={i}>
                                                    <line x1={padL} y1={y} x2={chartW-padR} y2={y} stroke="#eee" strokeWidth="1"/>
                                                    <text x={padL-5} y={y+3} textAnchor="end" fontSize="9" fill="#999">{val.toFixed(1)}</text>
                                                </g>
                                            );
                                        })}

                                        {/* Top 5 threshold line */}
                                        {(() => {
                                            const top5Score = data.weeklyRanking.ranches.find(r => r.rank === 5)?.pqWeightedAvg;
                                            if (!top5Score) return null;
                                            const y5 = yScale(top5Score);
                                            return (
                                                <g>
                                                    <line x1={padL} y1={y5} x2={chartW-padR} y2={y5} stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="6,3"/>
                                                    <text x={chartW-padR+2} y={y5+3} fontSize="8" fill="var(--gold)" fontWeight="600">Top 5</text>
                                                </g>
                                            );
                                        })()}

                                        {/* Bars per week */}
                                        {hist.map((h, i) => {
                                            const cx = padL + groupW * i + groupW / 2;
                                            const hHigh = h.highest || h.f5Score || h.f1Score || 80;
                                            const hLow = h.lowest || h.f1Score || h.f5Score || 40;
                                            const hAvg = h.avg || ((hHigh + hLow) / 2);
                                            const rangeTop = yScale(hHigh);
                                            const rangeBot = yScale(hLow);
                                            const avgY = yScale(hAvg);
                                            const weekNum = parseInt(h.week.replace('WK',''));
                                            const matchReport = (data.weeklyRanking.weeklyQRReports || []).find(r => r.week === weekNum);

                                            return (
                                                <g key={i} style={{cursor: matchReport ? 'pointer' : 'default'}} onClick={() => matchReport && setSelectedWeekReport(matchReport)}>
                                                    {/* Invisible hit area */}
                                                    <rect x={cx - groupW/2} y={padT} width={groupW} height={plotH + padB} fill="transparent"/>
                                                    {/* Range bar (highest-lowest) */}
                                                    <rect x={cx - barW*1.2} y={rangeTop} width={barW*2.4} height={Math.max(rangeBot - rangeTop, 2)} rx={3} fill="#E8E8E8" opacity="0.7"/>

                                                    {/* Avg line */}
                                                    <line x1={cx - barW*1.2} y1={avgY} x2={cx + barW*1.2} y2={avgY} stroke="var(--orange)" strokeWidth="2" strokeDasharray="3,2"/>

                                                    {/* F1 bar */}
                                                    {h.f1Score ? (
                                                        <g>
                                                            <rect x={cx - barW - 2} y={yScale(h.f1Score)} width={barW} height={Math.max(rangeBot - yScale(h.f1Score), 2)} rx={2} fill="var(--berry)" opacity="0.85"/>
                                                            <text x={cx - barW/2 - 2} y={yScale(h.f1Score) - 4} textAnchor="middle" fontSize="7" fill="var(--berry)" fontWeight="600">{h.f1Score.toFixed(1)}</text>
                                                        </g>
                                                    ) : (
                                                        <text x={cx - barW/2 - 2} y={rangeBot + 10} textAnchor="middle" fontSize="7" fill="var(--gray-400)">-</text>
                                                    )}

                                                    {/* F5 bar */}
                                                    {h.f5Score ? (
                                                        <g>
                                                            <rect x={cx + 2} y={yScale(h.f5Score)} width={barW} height={Math.max(rangeBot - yScale(h.f5Score), 2)} rx={2} fill="var(--green)" opacity="0.85"/>
                                                            <text x={cx + barW/2 + 2} y={yScale(h.f5Score) - 4} textAnchor="middle" fontSize="7" fill="var(--green)" fontWeight="600">{h.f5Score.toFixed(1)}</text>
                                                        </g>
                                                    ) : null}

                                                    {/* Highest / Lowest labels */}
                                                    <text x={cx} y={rangeTop - 4} textAnchor="middle" fontSize="7" fill="var(--gray-400)">{hHigh.toFixed(1)}</text>
                                                    <text x={cx} y={rangeBot + 10} textAnchor="middle" fontSize="7" fill="var(--gray-400)">{hLow.toFixed(1)}</text>

                                                    {/* Week label */}
                                                    <text x={cx} y={chartH - 5} textAnchor="middle" fontSize="10" fill={matchReport ? 'var(--berry)' : 'var(--gray-600)'} fontWeight={matchReport ? '700' : '500'} textDecoration={matchReport ? 'underline' : 'none'}>{h.week}</text>
                                                </g>
                                            );
                                        })}
                                    </svg>
                                    <div style={{fontSize:10, color:'var(--gray-400)', marginTop:8}}>
                                        Source: Weekly Quality Report Driscoll's | PQ Weighted Avg Score par semaine — <span style={{color:'var(--berry)'}}>Cliquez sur une semaine pour voir le rapport complet</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </Panel>

                    {/* Weekly Ranking Driscoll's */}
                    <Panel title={`Weekly Ranking Driscoll's - ${data.weeklyRanking.currentWeek}`} icon="fa-ranking-star">
                        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(380px, 1fr))', gap:16, marginBottom:20}}>
                            {data.weeklyRanking.ranches.filter(r => r.ourFarm).map((r, i) => {
                                const passRate = r.totalWeight > 0 ? Math.round(r.passWeight / r.totalWeight * 100) : 0;
                                const topDefects = r.defects ? Object.entries(r.defects).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]) : [];
                                return (
                                <div key={i} style={{padding:16, border:'2px solid var(--berry)', borderRadius:12, background:'rgba(139,34,82,0.05)'}}>
                                    <div style={{fontSize:14, fontWeight:600, marginBottom:10}}>{r.name}</div>
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, marginBottom:12, textAlign:'center'}}>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700, color: r.rank <= 10 ? 'var(--green)' : (r.rank <= 25 ? 'var(--orange)' : 'var(--red)')}}>{r.rank}/{data.weeklyRanking.totalRanches}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Rang</div>
                                        </div>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700}}>{r.pqWeightedAvg?.toFixed(1) || '-'}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>PQ Score</div>
                                        </div>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700, color:'var(--blue)'}}>{r.totalWeight ? `${(r.totalWeight/1000).toFixed(1)}T` : '-'}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Volume</div>
                                        </div>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700, color: passRate >= 50 ? 'var(--green)' : 'var(--red)'}}>{passRate}%</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Taux Pass</div>
                                        </div>
                                    </div>
                                    {/* Pass/Fail breakdown */}
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
                                        <div style={{padding:'6px 10px', background:'rgba(76,175,80,0.1)', borderRadius:8, fontSize:11}}>
                                            <span style={{color:'var(--green)', fontWeight:600}}>Pass:</span> {r.passWeight} kg | Brix {r.passBrix?.toFixed(1) || '-'}
                                        </div>
                                        <div style={{padding:'6px 10px', background:'rgba(244,67,54,0.1)', borderRadius:8, fontSize:11}}>
                                            <span style={{color:'var(--red)', fontWeight:600}}>Fail:</span> {r.failWeight} kg | Brix {r.failBrix?.toFixed(1) || '-'}
                                        </div>
                                    </div>
                                    {/* Top defects */}
                                    {topDefects.length > 0 && (
                                        <div style={{fontSize:11, color:'var(--gray-600)'}}>
                                            <span style={{fontWeight:600}}>Principaux défauts:</span>{' '}
                                            {topDefects.slice(0, 3).map(([name, val]) => `${name} ${val}%`).join(' | ')}
                                        </div>
                                    )}
                                    {/* PQ bar */}
                                    <div style={{height:6, background:'var(--gray-200)', borderRadius:3, marginTop:8}}>
                                        <div style={{height:'100%', width:`${Math.min((r.pqWeightedAvg || 0), 100)}%`, background: r.rank <= 10 ? 'var(--green)' : (r.rank <= 25 ? 'var(--orange)' : 'var(--berry)'), borderRadius:3}}></div>
                                    </div>
                                </div>
                                );
                            })}
                        </div>

                        {/* Brix Summary */}
                        {data.weeklyRanking.brixSummary && Object.keys(data.weeklyRanking.brixSummary).length > 0 && (
                            <div style={{marginBottom:16}}>
                                <div style={{fontSize:13, fontWeight:600, marginBottom:8}}>Brix Summary par Variété — Pool Driscoll's</div>
                                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8}}>
                                    {Object.entries(data.weeklyRanking.brixSummary).map(([variety, vals]) => (
                                        <div key={variety} style={{padding:'10px', background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                            <div style={{fontSize:12, fontWeight:600, color:'var(--berry)', marginBottom:4}}>{variety}</div>
                                            <div style={{fontSize:16, fontWeight:700}}>{vals.avg?.toFixed(2) || '-'}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Min {vals.min?.toFixed(1) || '-'} | Max {vals.max?.toFixed(1) || '-'}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* PQ Summary */}
                        {data.weeklyRanking.pqSummary && (
                            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:16}}>
                                <div style={{padding:'12px', textAlign:'center', background:'rgba(76,175,80,0.1)', borderRadius:8}}>
                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MAX PQ</div>
                                    <div style={{fontSize:20, fontWeight:700, color:'var(--green)'}}>{data.weeklyRanking.pqSummary.max?.toFixed(1) || '-'}</div>
                                </div>
                                <div style={{padding:'12px', textAlign:'center', background:'rgba(139,34,82,0.1)', borderRadius:8}}>
                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MOY PQ Pool</div>
                                    <div style={{fontSize:20, fontWeight:700, color:'var(--berry)'}}>{data.weeklyRanking.pqSummary.avg?.toFixed(1) || '-'}</div>
                                </div>
                                <div style={{padding:'12px', textAlign:'center', background:'rgba(244,67,54,0.1)', borderRadius:8}}>
                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MIN PQ</div>
                                    <div style={{fontSize:20, fontWeight:700, color:'var(--red)'}}>{data.weeklyRanking.pqSummary.min?.toFixed(1) || '-'}</div>
                                </div>
                            </div>
                        )}

                        {data.weeklyRanking.totalVolume && (
                            <div style={{fontSize:12, color:'var(--gray-400)', textAlign:'right', marginBottom:8}}>
                                Volume total pool: <strong>{(data.weeklyRanking.totalVolume / 1000).toFixed(1)} T</strong> | {data.weeklyRanking.totalRanches} ranches
                            </div>
                        )}
                    </Panel>

                    {/* ===== WEEKLY QUALITY REPORT POPUP ===== */}
                    {selectedWeekReport && (() => {
                        const rpt = selectedWeekReport;
                        const f1 = (rpt.ourRanches || []).find(r => r.ranchId === '200742');
                        const f5 = (rpt.ourRanches || []).find(r => r.ranchId === '200876');
                        const defectNames = ["Decay","Wet/Leaky","Reversion","Insect/SWD","Decay/Mold","Soft","Shriveled","Overripe","Collapsed","Weak Cells","Sooty Mold","Yellow Rust","Wet/Bruising","Dry Bruising","Mildew"];
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedWeekReport(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'820px', maxHeight:'92vh', overflowY:'auto', padding:0}}>
                                {/* Header - Driscoll's style */}
                                <div style={{background:'linear-gradient(135deg, #1a5632 0%, #2D8B4E 100%)', color:'#fff', padding:'20px 28px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                    <div>
                                        <div style={{fontSize:11, opacity:0.8, letterSpacing:1, textTransform:'uppercase'}}>Driscoll's Weekly Quality Report</div>
                                        <div style={{fontSize:22, fontWeight:700, marginTop:4}}>Settlement Week {rpt.week} — {rpt.year}</div>
                                        <div style={{fontSize:12, opacity:0.7, marginTop:2}}>{rpt.berry === 'myrtille' ? 'Blueberry' : 'Raspberry'}</div>
                                    </div>
                                    <button onClick={() => setSelectedWeekReport(null)} style={{background:'rgba(255,255,255,0.2)', border:'none', color:'#fff', width:32, height:32, borderRadius:'50%', cursor:'pointer', fontSize:16}}>&times;</button>
                                </div>

                                <div style={{padding:'20px 28px'}}>
                                    {/* PW Results */}
                                    {rpt.pwResults && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--green)', paddingBottom:4}}>PW Results</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12}}>
                                                <div style={{padding:12, background:'rgba(76,175,80,0.08)', borderRadius:10, textAlign:'center'}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>Inspection Pass Rate</div>
                                                    <div style={{fontSize:22, fontWeight:700, color:'var(--green)'}}>{rpt.pwResults.inspectionPassRate != null ? rpt.pwResults.inspectionPassRate + '%' : '-'}</div>
                                                </div>
                                                <div style={{padding:12, background:'rgba(255,152,0,0.08)', borderRadius:10, textAlign:'center'}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>Pre-Insp Reject Rate</div>
                                                    <div style={{fontSize:22, fontWeight:700, color:'var(--orange)'}}>{rpt.pwResults.preInspRejectRate != null ? rpt.pwResults.preInspRejectRate + '%' : '-'}</div>
                                                </div>
                                                <div style={{padding:12, background:'rgba(244,67,54,0.08)', borderRadius:10, textAlign:'center'}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>Re-Insp Reject Rate</div>
                                                    <div style={{fontSize:22, fontWeight:700, color:'var(--red)'}}>{rpt.pwResults.reInspRejectRate != null ? rpt.pwResults.reInspRejectRate + '%' : '-'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* YTD Results */}
                                    {rpt.ytdResults && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--berry)', paddingBottom:4}}>YTD Results</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10}}>
                                                {[{label:'Insp Pass Rate', val:rpt.ytdResults.inspPassRate}, {label:'Re-Insp Pass Rate', val:rpt.ytdResults.reInspPassRate}, {label:'Pre-Insp Reject', val:rpt.ytdResults.preInspRejectRate}, {label:'Re-Insp Reject', val:rpt.ytdResults.reInspRejectRate}].map((item,i) => (
                                                    <div key={i} style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                        <div style={{fontSize:9, color:'var(--gray-400)', fontWeight:600}}>{item.label}</div>
                                                        <div style={{fontSize:18, fontWeight:700}}>{item.val != null ? item.val + '%' : '-'}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* PQ Summary */}
                                    {rpt.pqSummary && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--gold)', paddingBottom:4}}>PQ Summary (Pool)</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12}}>
                                                <div style={{padding:14, textAlign:'center', background:'rgba(76,175,80,0.1)', borderRadius:10}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MAX PQ</div>
                                                    <div style={{fontSize:24, fontWeight:700, color:'var(--green)'}}>{rpt.pqSummary.max?.toFixed(1) || '-'}</div>
                                                </div>
                                                <div style={{padding:14, textAlign:'center', background:'rgba(139,34,82,0.1)', borderRadius:10}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>PQ Weighted Avg</div>
                                                    <div style={{fontSize:24, fontWeight:700, color:'var(--berry)'}}>{rpt.pqSummary.avg?.toFixed(1) || '-'}</div>
                                                </div>
                                                <div style={{padding:14, textAlign:'center', background:'rgba(244,67,54,0.1)', borderRadius:10}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MIN PQ</div>
                                                    <div style={{fontSize:24, fontWeight:700, color:'var(--red)'}}>{rpt.pqSummary.min?.toFixed(1) || '-'}</div>
                                                </div>
                                            </div>
                                            {rpt.totalVolume && (
                                                <div style={{fontSize:12, color:'var(--gray-400)', textAlign:'right', marginTop:8}}>
                                                    Volume total pool: <strong>{(rpt.totalVolume / 1000).toFixed(1)} T</strong> | {rpt.allRanchCount} ranches
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Brix Summary par Variété — Pool Driscoll's */}
                                    {rpt.brixSummary && Object.keys(rpt.brixSummary).length > 0 && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid #9C27B0', paddingBottom:4}}>Brix Summary par Variété — Pool Driscoll's</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10}}>
                                                {Object.entries(rpt.brixSummary).map(([variety, vals]) => (
                                                    <div key={variety} style={{padding:12, background:'rgba(156,39,176,0.06)', borderRadius:10, textAlign:'center'}}>
                                                        <div style={{fontSize:12, fontWeight:700, color:'#9C27B0', marginBottom:4}}>{variety}</div>
                                                        <div style={{fontSize:20, fontWeight:700}}>{vals.avg?.toFixed(2) || '-'}</div>
                                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Min {vals.min?.toFixed(1) || '-'} | Max {vals.max?.toFixed(1) || '-'}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Our Ranches Detail */}
                                    {(f1 || f5) && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--berry)', paddingBottom:4}}>Nos Fermes — Détail</div>
                                            <div style={{display:'grid', gridTemplateColumns: f1 && f5 ? '1fr 1fr' : '1fr', gap:16}}>
                                                {[f5, f1].filter(Boolean).map((ranch, ri) => {
                                                    const passRate = ranch.totalWeight > 0 ? Math.round(ranch.passWeight / ranch.totalWeight * 100) : 0;
                                                    const topDefects = ranch.defects ? Object.entries(ranch.defects).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]) : [];
                                                    return (
                                                        <div key={ri} style={{padding:16, border:'2px solid var(--berry)', borderRadius:12, background:'rgba(139,34,82,0.03)'}}>
                                                            <div style={{fontSize:14, fontWeight:700, marginBottom:12, color:'var(--berry)'}}>
                                                                {ranch.farmName === 'F1' ? 'Ferme 172 (F1)' : 'Ferme 195 (F5)'} — Ranch {ranch.ranchId}
                                                            </div>
                                                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, marginBottom:12, textAlign:'center'}}>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700, color: ranch.rank <= 10 ? 'var(--green)' : (ranch.rank <= 25 ? 'var(--orange)' : 'var(--red)')}}>{ranch.rank || '-'}/{ranch.totalRanches || rpt.allRanchCount || '-'}</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>Rang</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700}}>{ranch.pqWeightedAvg?.toFixed(1) || '-'}</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>PQ Score</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700, color:'var(--blue)'}}>{ranch.totalWeight ? `${(ranch.totalWeight/1000).toFixed(1)}T` : '-'}</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>Volume</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700, color: passRate >= 50 ? 'var(--green)' : 'var(--red)'}}>{passRate}%</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>Taux Pass</div>
                                                                </div>
                                                            </div>
                                                            {/* Pass / Fail breakdown */}
                                                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
                                                                <div style={{padding:'8px 10px', background:'rgba(76,175,80,0.1)', borderRadius:8, fontSize:11}}>
                                                                    <span style={{color:'var(--green)', fontWeight:700}}>Pass:</span> {ranch.passWeight} kg | Brix {ranch.passBrix?.toFixed(1) || '-'}
                                                                </div>
                                                                <div style={{padding:'8px 10px', background:'rgba(244,67,54,0.1)', borderRadius:8, fontSize:11}}>
                                                                    <span style={{color:'var(--red)', fontWeight:700}}>Fail:</span> {ranch.failWeight} kg | Brix {ranch.failBrix?.toFixed(1) || '-'}
                                                                </div>
                                                            </div>
                                                            {/* Defects */}
                                                            {topDefects.length > 0 && (
                                                                <div>
                                                                    <div style={{fontSize:11, fontWeight:600, marginBottom:6}}>Défauts (%)</div>
                                                                    <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                                                                        {topDefects.slice(0, 6).map(([name, val]) => (
                                                                            <span key={name} style={{padding:'3px 8px', background: val > 5 ? 'rgba(244,67,54,0.12)' : 'var(--gray-100)', borderRadius:12, fontSize:10, fontWeight:500}}>
                                                                                {name} <strong>{val}%</strong>
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {/* PQ bar */}
                                                            <div style={{height:6, background:'var(--gray-200)', borderRadius:3, marginTop:10}}>
                                                                <div style={{height:'100%', width:`${Math.min(ranch.pqWeightedAvg || 0, 100)}%`, background: ranch.rank <= 10 ? 'var(--green)' : (ranch.rank <= 25 ? 'var(--orange)' : 'var(--berry)'), borderRadius:3}}></div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div style={{fontSize:10, color:'var(--gray-400)', textAlign:'center', padding:'8px 0', borderTop:'1px solid var(--gray-200)'}}>
                                        Source: Weekly Quality Report — Driscoll's | WK{rpt.week}-{rpt.year}
                                    </div>
                                </div>
                            </div>
                        </div>
                        );
                    })()}

                    {/* ===== RAPPORT D'INSPECTION PFQ ===== */}
                    {selectedLot && (() => {
                        const defectFr = {
                            'Decay': 'Pourriture', 'Decay Mold': 'Pourriture', 'Decay/Mold': 'Pourriture',
                            'Wet Leaky': 'Fruit saignant', 'Wet/Leaky': 'Fruit saignant',
                            'Overripe': 'Fruit trop mûr', 'Soft': 'Fruit mou',
                            'Collapsed': 'Fruit mou', 'Shriveled': 'Fruit desséché',
                            'Weak Cells': 'Cellules blanches', 'Sooty Mold': 'Cladosporium',
                            'Yellow Rust': 'Rouille jaune', 'Reversion': 'Réversion',
                            'Insect/SWD': 'Insecte/Drosophile', 'Wet/Bruising': 'Meurtrissure humide',
                            'Dry Bruising': 'Meurtrissure sèche', 'Mildew': 'Mildiou',
                            'Green': 'Immature', 'Size': 'Calibre < 3g',
                            'Skin Damage': 'Dégâts ravageurs', 'Broken': 'Cassé',
                            'Malformed': 'Déformation', 'Attached Calyx': 'Avec pédoncule',
                            'Foreign Bodies': 'Corps étrangers', 'Foreign bodies': 'Corps étrangers',
                            'Bloom': 'Bloom (pruine)', 'Stem Blossom': 'Résidu floral',
                        };
                        const trDefect = (name) => defectFr[name] || name;
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedLot(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'650px', maxHeight:'90vh', overflowY:'auto'}}>
                                {/* En-tête */}
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px', paddingBottom:'12px', borderBottom:'2px solid var(--green)'}}>
                                    <div>
                                        <div style={{fontSize:'18px', fontWeight:'700', fontFamily:'Georgia, serif', color:'var(--dark)'}}>Rapport d'Inspection Qualité</div>
                                        <div style={{fontSize:'12px', color:'var(--gray-400)', marginTop:'2px'}}>Driscoll's — Inspection Initiale</div>
                                    </div>
                                    <span className={`status-badge ${selectedLot.result === 'Pass' ? 'green' : 'red'}`} style={{fontSize:'14px', padding:'6px 16px'}}>
                                        {selectedLot.result === 'Pass' ? '✓ CONFORME' : '✗ NON CONFORME'}
                                    </span>
                                </div>

                                {/* Infos Lot */}
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'16px'}}>
                                    <div style={{padding:'10px', background:'var(--gray-100)', borderRadius:'8px'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'4px 12px', fontSize:'12px'}}>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Fruit</span><span>🫐 Myrtille</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Variété</span><span style={{fontWeight:'600'}}>{selectedLot.variete}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Article</span><span>{selectedLot.item}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Ferme</span><span>{selectedLot.ranchName || '-'}</span>
                                        </div>
                                    </div>
                                    <div style={{padding:'10px', background:'var(--gray-100)', borderRadius:'8px'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'4px 12px', fontSize:'12px'}}>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Reçu</span><span style={{fontWeight:'700', color:'var(--berry)'}}>{selectedLot.receiptId}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>N° Lot</span><span>{selectedLot.batchNumber}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Licence</span><span>{selectedLot.license}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Entrepôt</span><span>{selectedLot.warehouse}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Tableau Défauts */}
                                <div style={{marginBottom:'16px'}}>
                                    <table className="data-table" style={{fontSize:'12px'}}>
                                        <thead>
                                            <tr style={{background:'var(--gray-100)'}}>
                                                <th>Attribut / Défaut</th><th style={{textAlign:'right'}}>Nb Fruits</th><th style={{textAlign:'right'}}>%</th><th style={{textAlign:'right'}}>Points</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedLot.conditionDetail && selectedLot.conditionDetail.map((d, i) => (
                                                <tr key={i}><td>{trDefect(d.defect)}</td><td style={{textAlign:'right'}}>{d.count}</td><td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td><td></td></tr>
                                            ))}
                                            <tr style={{background:'rgba(76,175,80,0.08)', fontWeight:'700'}}>
                                                <td>Condition</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.conditionDetail ? selectedLot.conditionDetail.reduce((s,d)=>s+d.count,0) : 0}</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.condPct}%</td>
                                                <td style={{textAlign:'right', color:'var(--berry)'}}>{selectedLot.conditionPoints}</td>
                                            </tr>
                                            {selectedLot.appearanceDetail && selectedLot.appearanceDetail.map((d, i) => (
                                                <tr key={`a${i}`}><td>{trDefect(d.defect)}</td><td style={{textAlign:'right'}}>{d.count}</td><td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td><td style={{textAlign:'right', color:'var(--gray-400)'}}>{d.points || ''}</td></tr>
                                            ))}
                                            <tr style={{background:'rgba(233,30,99,0.08)', fontWeight:'700'}}>
                                                <td>Apparence</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.appearanceDetail ? selectedLot.appearanceDetail.reduce((s,d)=>s+d.count,0) : 0}</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.appPct}%</td>
                                                <td style={{textAlign:'right', color:'var(--berry)'}}>{selectedLot.appearancePoints}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Saveur + Infos Lot */}
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                                    <div style={{padding:'12px', background:'rgba(156,39,176,0.08)', borderRadius:'8px', textAlign:'center'}}>
                                        <div style={{fontSize:'11px', fontWeight:'600', color:'#9C27B0', textTransform:'uppercase'}}>Saveur</div>
                                        <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Degrés Brix</div>
                                        <div style={{fontSize:'28px', fontWeight:'700', color:'#9C27B0', marginTop:'4px'}}>{selectedLot.brix}</div>
                                    </div>
                                    <div style={{padding:'12px', background:'var(--gray-100)', borderRadius:'8px'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', textAlign:'center', fontSize:'11px'}}>
                                            <div><div style={{fontWeight:'700', fontSize:'16px'}}>{selectedLot.weight}</div><div style={{color:'var(--gray-400)'}}>Poids (kg)</div></div>
                                            <div><div style={{fontWeight:'700', fontSize:'16px'}}>{selectedLot.qty}</div><div style={{color:'var(--gray-400)'}}>Qté Lot</div></div>
                                            <div><div style={{fontWeight:'700', fontSize:'16px'}}>{selectedLot.sampleSize}</div><div style={{color:'var(--gray-400)'}}>Échantillon</div></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Bouton fermer */}
                                <div style={{marginTop:'16px', textAlign:'center'}}>
                                    <button className="btn-primary" onClick={() => setSelectedLot(null)} style={{width:'auto', padding:'10px 32px'}}>
                                        <i className="fa-solid fa-times"></i> Fermer
                                    </button>
                                </div>
                            </div>
                        </div>
                    );})()}
                </div>
            );
        }

export { QualiteDashboardTab };
