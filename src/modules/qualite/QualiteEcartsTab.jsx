/* Module: qualite | Déclaration(s): QualiteEcartsTab */
import { Panel } from '../shared/Panel.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';

// ===================== QUALITÉ ÉCARTS TAB =====================
        function QualiteEcartsTab({ data }) {
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filterVariete, setFilterVariete] = useState('');
            const [filterFerme, setFilterFerme] = useState('');
            const [filterBerry, setFilterBerry] = useState('');
            const today = new Date();
            const defaultFrom = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
            const defaultTo = today.toISOString().slice(0, 10);
            const [dateFrom, setDateFrom] = useState(defaultFrom);
            const [dateTo, setDateTo] = useState(defaultTo);
            const [viewMode, setViewMode] = useState('top');
            const [evolKey, setEvolKey] = useState('avgPfqTotal');

            useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=5000').then(json => {
                    if (json && json.success && Array.isArray(json.expeditions)) {
                        setExpeditions(json.expeditions);
                    } else {
                        setExpeditions([]);
                    }
                }).catch(err => {
                    console.warn('Erreur chargement expeditions:', err);
                    setExpeditions([]);
                }).finally(() => setLoading(false));
            }, []);

            // Helpers
            const getDateISO = (e) => {
                const d = e.dateISO || e.receiptDate || e.date;
                if (!d) return null;
                return String(d).slice(0, 10);
            };

            // Driscoll's Sat-Fri week key — anchor: a known Saturday
            const SAT_ANCHOR = new Date('2024-01-06T00:00:00Z'); // Saturday
            const getSatFriWeekKey = (dateISO) => {
                if (!dateISO) return null;
                const d = new Date(dateISO + 'T00:00:00Z');
                const diffDays = Math.floor((d - SAT_ANCHOR) / 86400000);
                const weekIdx = Math.floor(diffDays / 7);
                const satDate = new Date(SAT_ANCHOR.getTime() + weekIdx * 7 * 86400000);
                const friDate = new Date(satDate.getTime() + 6 * 86400000);
                const year = satDate.getUTCFullYear();
                // Compute week-of-year approx: week number = floor((satDate - firstSatOfYear)/7)+1
                const yearStart = new Date(Date.UTC(year, 0, 1));
                const dayOfWeek = yearStart.getUTCDay();
                const firstSatOffset = (6 - dayOfWeek + 7) % 7;
                const firstSat = new Date(yearStart.getTime() + firstSatOffset * 86400000);
                let weekNum = Math.floor((satDate - firstSat) / (7 * 86400000)) + 1;
                if (weekNum < 1) weekNum = 1;
                const fmt = (dt) => String(dt.getUTCDate()).padStart(2, '0') + '/' + String(dt.getUTCMonth() + 1).padStart(2, '0');
                return {
                    key: year + '-W' + String(weekNum).padStart(2, '0'),
                    label: 'S' + String(weekNum).padStart(2, '0') + ' (' + fmt(satDate) + '-' + fmt(friDate) + ')',
                    weekNum,
                    satDate: satDate.toISOString().slice(0, 10),
                };
            };

            const inferFerme = (e) => {
                if (e.ferme) return e.ferme;
                if (e.ranchName) {
                    if (/200742|F1/i.test(e.ranchName)) return 'F1';
                    if (/200876|F5/i.test(e.ranchName)) return 'F5';
                }
                return '';
            };

            // Filter expéditions
            const filtered = useMemo(() => {
                return expeditions.filter(e => {
                    const d = getDateISO(e);
                    if (!d) return false;
                    if (dateFrom && d < dateFrom) return false;
                    if (dateTo && d > dateTo) return false;
                    if (filterVariete && e.variety !== filterVariete) return false;
                    if (filterBerry && e.berryType !== filterBerry) return false;
                    if (filterFerme && inferFerme(e) !== filterFerme) return false;
                    const hasDefects = (Array.isArray(e.conditionDefects) && e.conditionDefects.length) || (Array.isArray(e.appearanceDefects) && e.appearanceDefects.length);
                    const hasPfq = e.pfqTotal != null || e.pfqCondition != null || e.pfqApparence != null;
                    return hasDefects || hasPfq;
                });
            }, [expeditions, filterVariete, filterFerme, filterBerry, dateFrom, dateTo]);

            // Lists for filter dropdowns
            const varietes = useMemo(() => Array.from(new Set(expeditions.map(e => e.variety).filter(Boolean))).sort(), [expeditions]);
            const fermes = useMemo(() => Array.from(new Set(expeditions.map(inferFerme).filter(Boolean))).sort(), [expeditions]);
            const berryTypes = useMemo(() => Array.from(new Set(expeditions.map(e => e.berryType).filter(Boolean))).sort(), [expeditions]);

            // KPIs
            const kpi = useMemo(() => {
                const n = filtered.length;
                if (n === 0) return { n: 0, avgPfq: 0, avgCond: 0, avgApp: 0, passRate: 0 };
                const sumPfq = filtered.reduce((s, e) => s + (parseFloat(e.pfqTotal) || 0), 0);
                const sumCond = filtered.reduce((s, e) => s + (parseFloat(e.pfqCondition) || 0), 0);
                const sumApp = filtered.reduce((s, e) => s + (parseFloat(e.pfqApparence) || 0), 0);
                const nPass = filtered.filter(e => String(e.overallResult).toUpperCase() === 'PASS').length;
                return {
                    n,
                    avgPfq: Math.round(sumPfq / n * 10) / 10,
                    avgCond: Math.round(sumCond / n * 10) / 10,
                    avgApp: Math.round(sumApp / n * 10) / 10,
                    passRate: Math.round(nPass / n * 100),
                };
            }, [filtered]);

            // Top défauts cumulés
            const topDefauts = useMemo(() => {
                const map = {};
                filtered.forEach(e => {
                    const v = e.variety || '?';
                    (e.conditionDefects || []).forEach(d => {
                        const key = 'C|' + d.name;
                        if (!map[key]) map[key] = { name: d.name, cat: 'Condition', occurrences: 0, sumPct: 0, sumPoints: 0, varieties: new Set() };
                        map[key].occurrences += 1;
                        map[key].sumPct += parseFloat(d.percent) || 0;
                        map[key].sumPoints += parseFloat(d.points) || 0;
                        map[key].varieties.add(v);
                    });
                    (e.appearanceDefects || []).forEach(d => {
                        const key = 'A|' + d.name;
                        if (!map[key]) map[key] = { name: d.name, cat: 'Apparence', occurrences: 0, sumPct: 0, sumPoints: 0, varieties: new Set() };
                        map[key].occurrences += 1;
                        map[key].sumPct += parseFloat(d.percent) || 0;
                        map[key].sumPoints += parseFloat(d.points) || 0;
                        map[key].varieties.add(v);
                    });
                });
                return Object.values(map).map(o => ({
                    name: o.name,
                    cat: o.cat,
                    occurrences: o.occurrences,
                    avgPct: o.occurrences > 0 ? Math.round(o.sumPct / o.occurrences * 10) / 10 : 0,
                    avgPoints: o.occurrences > 0 ? Math.round(o.sumPoints / o.occurrences * 10) / 10 : 0,
                    totalPoints: Math.round(o.sumPoints * 10) / 10,
                    varieties: Array.from(o.varieties).sort(),
                })).sort((a, b) => b.totalPoints - a.totalPoints);
            }, [filtered]);

            // Daily aggregation (for evolution chart + tableau journalier)
            const dailyAgg = useMemo(() => {
                const map = {};
                filtered.forEach(e => {
                    const d = getDateISO(e);
                    if (!map[d]) map[d] = { date: d, sumPfq: 0, sumCond: 0, sumApp: 0, n: 0 };
                    map[d].sumPfq += parseFloat(e.pfqTotal) || 0;
                    map[d].sumCond += parseFloat(e.pfqCondition) || 0;
                    map[d].sumApp += parseFloat(e.pfqApparence) || 0;
                    map[d].n += 1;
                });
                return Object.values(map).map(o => ({
                    date: o.date,
                    avgPfqTotal: Math.round(o.sumPfq / o.n * 10) / 10,
                    avgCondition: Math.round(o.sumCond / o.n * 10) / 10,
                    avgApparence: Math.round(o.sumApp / o.n * 10) / 10,
                    nbLots: o.n,
                })).sort((a, b) => a.date.localeCompare(b.date));
            }, [filtered]);

            // Weekly aggregation per variety
            const weeklyPivot = useMemo(() => {
                const weekSet = {};
                const map = {};
                filtered.forEach(e => {
                    const d = getDateISO(e);
                    const w = getSatFriWeekKey(d);
                    if (!w) return;
                    weekSet[w.key] = w;
                    const v = e.variety || '?';
                    if (!map[v]) map[v] = {};
                    if (!map[v][w.key]) map[v][w.key] = { sumPfq: 0, n: 0 };
                    map[v][w.key].sumPfq += parseFloat(e.pfqTotal) || 0;
                    map[v][w.key].n += 1;
                });
                const weeks = Object.values(weekSet).sort((a, b) => a.satDate.localeCompare(b.satDate));
                const varieties = Object.keys(map).sort();
                return { weeks, varieties, map };
            }, [filtered]);

            // Daily pivot per variety (last 14 days within range)
            const dailyPivot = useMemo(() => {
                const dateSet = {};
                const map = {};
                filtered.forEach(e => {
                    const d = getDateISO(e);
                    dateSet[d] = true;
                    const v = e.variety || '?';
                    if (!map[v]) map[v] = {};
                    if (!map[v][d]) map[v][d] = { sumPfq: 0, n: 0 };
                    map[v][d].sumPfq += parseFloat(e.pfqTotal) || 0;
                    map[v][d].n += 1;
                });
                const dates = Object.keys(dateSet).sort().slice(-14);
                const varieties = Object.keys(map).sort();
                return { dates, varieties, map };
            }, [filtered]);

            // Détail défauts par variété
            const varieteBreakdown = useMemo(() => {
                const map = {};
                filtered.forEach(e => {
                    const v = e.variety || '?';
                    if (!map[v]) map[v] = { variete: v, n: 0, sumPfq: 0, defauts: {} };
                    map[v].n += 1;
                    map[v].sumPfq += parseFloat(e.pfqTotal) || 0;
                    [...(e.conditionDefects || []).map(d => ({ ...d, cat: 'C' })), ...(e.appearanceDefects || []).map(d => ({ ...d, cat: 'A' }))].forEach(d => {
                        const k = d.cat + '|' + d.name;
                        if (!map[v].defauts[k]) map[v].defauts[k] = { name: d.name, cat: d.cat === 'C' ? 'Condition' : 'Apparence', occurrences: 0, sumPct: 0, sumPoints: 0 };
                        map[v].defauts[k].occurrences += 1;
                        map[v].defauts[k].sumPct += parseFloat(d.percent) || 0;
                        map[v].defauts[k].sumPoints += parseFloat(d.points) || 0;
                    });
                });
                return Object.values(map).map(o => ({
                    variete: o.variete,
                    n: o.n,
                    avgPfq: o.n > 0 ? Math.round(o.sumPfq / o.n * 10) / 10 : 0,
                    topDefauts: Object.values(o.defauts).map(d => ({
                        name: d.name,
                        cat: d.cat,
                        occurrences: d.occurrences,
                        avgPct: d.occurrences > 0 ? Math.round(d.sumPct / d.occurrences * 10) / 10 : 0,
                        avgPoints: d.occurrences > 0 ? Math.round(d.sumPoints / d.occurrences * 10) / 10 : 0,
                        totalPoints: Math.round(d.sumPoints * 10) / 10,
                    })).sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 5),
                })).sort((a, b) => a.avgPfq - b.avgPfq); // pires PFQ en premier
            }, [filtered]);

            const pfqColor = (v) => v >= 85 ? 'var(--green)' : v >= 70 ? 'var(--blue)' : v >= 55 ? 'var(--orange)' : 'var(--red)';

            if (loading) {
                return <div className="tab-content fade-in"><Panel title="Écarts & Défauts — DQR Driscoll's" icon="fa-triangle-exclamation"><div style={{padding:40,textAlign:'center',color:'var(--gray-500)'}}>Chargement des DQR…</div></Panel></div>;
            }

            const views = [
                { id: 'top', label: 'Top Défauts', icon: 'fa-ranking-star' },
                { id: 'evolution', label: 'Évolution', icon: 'fa-chart-line' },
                { id: 'weekly', label: 'Hebdo Sat-Fri', icon: 'fa-calendar-week' },
                { id: 'daily', label: 'Journalier', icon: 'fa-calendar-day' },
                { id: 'variete', label: 'Par Variété', icon: 'fa-seedling' },
            ];

            const inputStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--gray-200)', fontSize: 13 };

            return (
                <div className="tab-content fade-in">
                    <Panel title="Écarts & Défauts — DQR Driscoll's" icon="fa-triangle-exclamation">
                        <div style={{padding:16}}>
                            {/* Filtres */}
                            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
                                <select value={filterVariete} onChange={e => setFilterVariete(e.target.value)} style={inputStyle}>
                                    <option value="">Toutes variétés</option>
                                    {varietes.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <select value={filterBerry} onChange={e => setFilterBerry(e.target.value)} style={inputStyle}>
                                    <option value="">Tous types</option>
                                    {berryTypes.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                                <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={inputStyle}>
                                    <option value="">Toutes fermes</option>
                                    {fermes.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
                                <button onClick={() => { setFilterVariete(''); setFilterBerry(''); setFilterFerme(''); setDateFrom(defaultFrom); setDateTo(defaultTo); }} style={{...inputStyle,cursor:'pointer',background:'var(--gray-50)'}}>Réinitialiser</button>
                            </div>

                            {/* KPI */}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))',gap:12,marginBottom:20}}>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Lots</div>
                                    <div style={{fontSize:26,fontWeight:700,marginTop:4}}>{kpi.n}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>PFQ moyen</div>
                                    <div style={{fontSize:26,fontWeight:700,color:pfqColor(kpi.avgPfq),marginTop:4}}>{kpi.avgPfq}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Condition</div>
                                    <div style={{fontSize:22,fontWeight:700,marginTop:4}}>{kpi.avgCond}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Apparence</div>
                                    <div style={{fontSize:22,fontWeight:700,marginTop:4}}>{kpi.avgApp}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Pass rate</div>
                                    <div style={{fontSize:22,fontWeight:700,color:kpi.passRate >= 80 ? 'var(--green)' : 'var(--orange)',marginTop:4}}>{kpi.passRate}%</div>
                                </div>
                            </div>

                            {/* Onglets internes */}
                            <div style={{display:'flex',gap:6,marginBottom:16,borderBottom:'1px solid var(--gray-200)',flexWrap:'wrap'}}>
                                {views.map(v => (
                                    <button key={v.id} onClick={() => setViewMode(v.id)} style={{padding:'8px 14px',background:viewMode===v.id?'var(--berry)':'transparent',color:viewMode===v.id?'#fff':'var(--gray-600)',border:'none',borderRadius:'8px 8px 0 0',cursor:'pointer',fontSize:13,fontWeight:600}}>
                                        <i className={'fa-solid '+v.icon} style={{marginRight:6}}></i>{v.label}
                                    </button>
                                ))}
                            </div>

                            {/* Vue Top Défauts */}
                            {viewMode === 'top' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Top défauts cumulés ({topDefauts.length})</h3>
                                    <div style={{maxHeight:600,overflowY:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                        <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                                            <thead style={{position:'sticky',top:0,background:'var(--gray-50)'}}>
                                                <tr>
                                                    <th style={{textAlign:'left',padding:'8px 10px'}}>Défaut</th>
                                                    <th style={{textAlign:'left',padding:'8px 10px'}}>Catégorie</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>Occurr.</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>% moyen</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>Points moy.</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>Points cumul.</th>
                                                    <th style={{textAlign:'left',padding:'8px 10px'}}>Variétés</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {topDefauts.map((d, i) => (
                                                    <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:600}}>{d.name}</td>
                                                        <td style={{padding:'6px 10px'}}><span style={{padding:'2px 8px',borderRadius:10,fontSize:11,background:d.cat==='Condition'?'rgba(244,67,54,0.1)':'rgba(33,150,243,0.1)',color:d.cat==='Condition'?'var(--red)':'var(--blue)'}}>{d.cat}</span></td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{d.occurrences}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{d.avgPct}%</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{d.avgPoints}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{d.totalPoints}</td>
                                                        <td style={{padding:'6px 10px',fontSize:11}}>{d.varieties.slice(0, 4).join(', ')}{d.varieties.length > 4 ? '…' : ''}</td>
                                                    </tr>
                                                ))}
                                                {topDefauts.length === 0 && <tr><td colSpan={7} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucun défaut sur la période</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Vue Évolution */}
                            {viewMode === 'evolution' && (
                                <div>
                                    <div style={{display:'flex',gap:6,marginBottom:12}}>
                                        <button onClick={() => setEvolKey('avgPfqTotal')} style={{padding:'6px 12px',background:evolKey==='avgPfqTotal'?'var(--berry)':'var(--gray-50)',color:evolKey==='avgPfqTotal'?'#fff':'var(--gray-600)',border:'1px solid var(--gray-200)',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>PFQ Total</button>
                                        <button onClick={() => setEvolKey('split')} style={{padding:'6px 12px',background:evolKey==='split'?'var(--berry)':'var(--gray-50)',color:evolKey==='split'?'#fff':'var(--gray-600)',border:'1px solid var(--gray-200)',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>Condition vs Apparence</button>
                                    </div>
                                    {dailyAgg.length > 0 ? (
                                        evolKey === 'avgPfqTotal' ? (
                                            <SimpleAreaChart data={dailyAgg} dataKeys={['avgPfqTotal']} colors={['#9C27B0']} xKey="date" height={280} />
                                        ) : (
                                            <SimpleAreaChart data={dailyAgg} dataKeys={['avgCondition','avgApparence']} colors={['#F44336','#2196F3']} xKey="date" height={280} />
                                        )
                                    ) : (
                                        <div style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée pour la période</div>
                                    )}
                                    <div style={{display:'flex',gap:16,marginTop:12,fontSize:12,color:'var(--gray-600)',justifyContent:'center'}}>
                                        {evolKey === 'split' ? (
                                            <>
                                                <span><span style={{display:'inline-block',width:10,height:10,background:'#F44336',borderRadius:2,marginRight:4}}></span>Condition</span>
                                                <span><span style={{display:'inline-block',width:10,height:10,background:'#2196F3',borderRadius:2,marginRight:4}}></span>Apparence</span>
                                            </>
                                        ) : (
                                            <span><span style={{display:'inline-block',width:10,height:10,background:'#9C27B0',borderRadius:2,marginRight:4}}></span>PFQ Total</span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Vue Hebdo Sat-Fri */}
                            {viewMode === 'weekly' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>PFQ moyen par variété et semaine (Samedi → Vendredi)</h3>
                                    <div style={{overflowX:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                        <table style={{width:'100%',fontSize:12,borderCollapse:'collapse',minWidth:600}}>
                                            <thead style={{background:'var(--gray-50)'}}>
                                                <tr>
                                                    <th style={{textAlign:'left',padding:'8px 10px',position:'sticky',left:0,background:'var(--gray-50)',zIndex:1}}>Variété</th>
                                                    {weeklyPivot.weeks.map(w => <th key={w.key} style={{textAlign:'center',padding:'8px 6px',whiteSpace:'nowrap'}}>{w.label}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {weeklyPivot.varieties.map(v => (
                                                    <tr key={v} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:600,position:'sticky',left:0,background:'#fff',zIndex:1}}>{v}</td>
                                                        {weeklyPivot.weeks.map(w => {
                                                            const cell = weeklyPivot.map[v] && weeklyPivot.map[v][w.key];
                                                            if (!cell) return <td key={w.key} style={{padding:'6px',textAlign:'center',color:'var(--gray-300)'}}>—</td>;
                                                            const avg = Math.round(cell.sumPfq / cell.n * 10) / 10;
                                                            return <td key={w.key} style={{padding:'6px',textAlign:'center'}}>
                                                                <div style={{fontWeight:700,color:pfqColor(avg)}}>{avg}</div>
                                                                <div style={{fontSize:10,color:'var(--gray-400)'}}>{cell.n} lot{cell.n>1?'s':''}</div>
                                                            </td>;
                                                        })}
                                                    </tr>
                                                ))}
                                                {weeklyPivot.varieties.length === 0 && <tr><td colSpan={(weeklyPivot.weeks.length||0)+1} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Vue Journalier */}
                            {viewMode === 'daily' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>PFQ moyen par variété et jour (14 derniers jours dans la plage)</h3>
                                    <div style={{overflowX:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                        <table style={{width:'100%',fontSize:12,borderCollapse:'collapse',minWidth:600}}>
                                            <thead style={{background:'var(--gray-50)'}}>
                                                <tr>
                                                    <th style={{textAlign:'left',padding:'8px 10px',position:'sticky',left:0,background:'var(--gray-50)',zIndex:1}}>Variété</th>
                                                    {dailyPivot.dates.map(d => <th key={d} style={{textAlign:'center',padding:'8px 6px',whiteSpace:'nowrap'}}>{d.slice(5)}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dailyPivot.varieties.map(v => (
                                                    <tr key={v} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:600,position:'sticky',left:0,background:'#fff',zIndex:1}}>{v}</td>
                                                        {dailyPivot.dates.map(d => {
                                                            const cell = dailyPivot.map[v] && dailyPivot.map[v][d];
                                                            if (!cell) return <td key={d} style={{padding:'6px',textAlign:'center',color:'var(--gray-300)'}}>—</td>;
                                                            const avg = Math.round(cell.sumPfq / cell.n * 10) / 10;
                                                            return <td key={d} style={{padding:'6px',textAlign:'center'}}>
                                                                <div style={{fontWeight:700,color:pfqColor(avg)}}>{avg}</div>
                                                                <div style={{fontSize:10,color:'var(--gray-400)'}}>{cell.n}</div>
                                                            </td>;
                                                        })}
                                                    </tr>
                                                ))}
                                                {dailyPivot.varieties.length === 0 && <tr><td colSpan={(dailyPivot.dates.length||0)+1} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Vue Par variété */}
                            {viewMode === 'variete' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Détail par variété (triées du pire PFQ au meilleur)</h3>
                                    <div style={{display:'grid',gap:12}}>
                                        {varieteBreakdown.map(v => (
                                            <div key={v.variete} style={{border:'1px solid var(--gray-200)',borderRadius:10,padding:14,background:'#fff'}}>
                                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                                                    <div style={{fontWeight:700,fontSize:14}}>{v.variete}</div>
                                                    <div style={{display:'flex',gap:14,fontSize:12,color:'var(--gray-600)'}}>
                                                        <div>Lots: <strong>{v.n}</strong></div>
                                                        <div>PFQ moyen: <strong style={{color:pfqColor(v.avgPfq)}}>{v.avgPfq}</strong></div>
                                                    </div>
                                                </div>
                                                {v.topDefauts.length > 0 ? (
                                                    <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                                        <thead><tr style={{background:'var(--gray-50)'}}>
                                                            <th style={{textAlign:'left',padding:'6px 10px'}}>Défaut</th>
                                                            <th style={{textAlign:'left',padding:'6px 10px'}}>Catégorie</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>Occurr.</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>% moyen</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>Pts moy.</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>Pts cumul.</th>
                                                        </tr></thead>
                                                        <tbody>
                                                            {v.topDefauts.map((d, i) => (
                                                                <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                                    <td style={{padding:'5px 10px'}}>{d.name}</td>
                                                                    <td style={{padding:'5px 10px',fontSize:11,color:d.cat==='Condition'?'var(--red)':'var(--blue)'}}>{d.cat}</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{d.occurrences}</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{d.avgPct}%</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{d.avgPoints}</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{d.totalPoints}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                ) : (
                                                    <div style={{fontSize:12,color:'var(--gray-400)',padding:8}}>Aucun défaut détaillé</div>
                                                )}
                                            </div>
                                        ))}
                                        {varieteBreakdown.length === 0 && <div style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune variété sur la période</div>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </Panel>
                </div>
            );
        }

export { QualiteEcartsTab };
