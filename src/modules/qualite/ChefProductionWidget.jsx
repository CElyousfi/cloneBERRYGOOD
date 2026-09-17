/* Module: qualite | Déclaration(s): ChefProductionWidget */
import { getCycle } from '../agronomie/getCycle.jsx';
import { getHaByCycle } from '../agronomie/getHaByCycle.jsx';
import { getPlantsByCycle } from '../agronomie/getPlantsByCycle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { BUDGET_BGF } from '../finance/BUDGET_BGF.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

function ChefProductionWidget({ farmFilter }) {
            const [bons, setBons] = useState([]);
            const [loading, setLoading] = useState(true);
            const [chartMode, setChartMode] = useState('kgha');
            const [showEcarts, setShowEcarts] = useState(false);
            const [selectedVariety, setSelectedVariety] = useState('');

            React.useEffect(() => {
                loadBonsFromFirestore()
                    .then(b => setBons(b || []))
                    .catch(e => console.warn('[ChefProd] load:', e))
                    .finally(() => setLoading(false));
            }, []);

            const mapped = React.useMemo(() => {
                return (bons || []).filter(b => b.status !== 'rejete_qualite' && b.status !== 'rejete_chef').map(b => {
                    const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                    const cycle = getCycle(b.date);
                    const variety = resolved
                        ? (resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete)
                        : (b.blocVariete || '?');
                    const ferme = resolved ? resolved.ferme : (b.blocFerme || '').replace('-', '').replace('F 0', 'F').replace('F-0', 'F').replace('F-', 'F');
                    const rawType = b.typeVente || '';
                    const typeVente = (rawType === "Driscoll's" || rawType === 'EXP') ? 'Export'
                        : rawType === 'ECRT' ? 'Marché Local'
                        : rawType || '';
                    return {
                        variety,
                        culture: resolved ? resolved.culture : 'Framboise',
                        ferme, cycle,
                        kg: parseFloat(b.poidsLot) || 0,
                        dateISO: b.date || '',
                        typeVente,
                    };
                }).filter(b => {
                    if (b.kg <= 0) return false;
                    if (b.ferme !== farmFilter) return false;
                    const dUp = (b.variety || '').toUpperCase();
                    const SKIP = ['DECHET','PLASTIQUE','EMBALLAGE','PALETTE','CARTON VIDE','BOIS'];
                    return !SKIP.some(s => dUp.includes(s));
                });
            }, [bons, farmFilter]);

            const cycle2Varieties = ['Maravilla Green Cane', 'Maravilla Long Cane', 'Yazmin Bi Cycle', 'Corina', 'Breeze', 'Cascade'];
            const cycle2Stats = React.useMemo(() => {
                const c2 = mapped.filter(e => e.cycle === 2);
                const acc = {};
                c2.forEach(e => {
                    const v = e.variety;
                    if (!acc[v]) acc[v] = { variety: v, kgExport: 0, kgLocal: 0, kg: 0 };
                    acc[v].kg += e.kg;
                    if (e.typeVente === 'Export') acc[v].kgExport += e.kg;
                    else acc[v].kgLocal += e.kg;
                });
                return cycle2Varieties.filter(v => acc[v]).map(v => {
                    const s = acc[v];
                    const resolved = normalizeParcelle(v);
                    const culture = resolved ? resolved.culture : 'Framboise';
                    let baseV = v, sousV = null;
                    const knownSous = ['Green Cane', 'Long Cane', 'Mow Down', 'Bi Cycle', 'Cut Back'];
                    for (const sv of knownSous) { if (v.endsWith(sv)) { baseV = v.slice(0, -(sv.length + 1)); sousV = sv; break; } }
                    const ha = getHaByCycle(baseV, sousV, farmFilter, 2) || getHaByCycle(baseV, null, farmFilter, 2);
                    const plants = getPlantsByCycle(baseV, sousV, farmFilter, 2) || getPlantsByCycle(baseV, null, farmFilter, 2);
                    const pctLocal = (s.kgLocal + s.kgExport) > 0 ? (s.kgLocal / (s.kgLocal + s.kgExport) * 100).toFixed(1) : '0.0';
                    const kgPerPlant = plants > 0 ? s.kgExport / plants : 0;
                    const rendementMyrtille = plants > 0 ? (kgPerPlant < 1 ? Math.round(kgPerPlant * 1000) : kgPerPlant.toFixed(2)) : '-';
                    const rendementLabelMyrtille = plants > 0 && kgPerPlant < 1 ? 'g/Pl' : 'Kg/Pl';
                    return {
                        ...s, culture, ha, plants, pctLocal,
                        rendement: culture === 'Myrtille' ? rendementMyrtille : (ha > 0 ? (s.kgExport / 1000 / ha).toFixed(2) : '-'),
                        rendementLabel: culture === 'Myrtille' ? rendementLabelMyrtille : 'T/Ha',
                        tonnageExport: (s.kgExport / 1000).toFixed(2),
                    };
                });
            }, [mapped, farmFilter]);

            const last7Days = React.useMemo(() => {
                const today = new Date();
                const days = [];
                for (let i = 6; i >= 0; i--) {
                    const d = new Date(today);
                    d.setDate(today.getDate() - i);
                    const iso = d.toISOString().slice(0, 10);
                    const parts = iso.split('-');
                    days.push({ date: iso, label: parts[2] + '/' + parts[1] });
                }
                const acc = {};
                mapped.filter(e => e.cycle === 2 && (!selectedVariety || e.variety === selectedVariety)).forEach(e => {
                    if (!e.dateISO) return;
                    if (!acc[e.dateISO]) acc[e.dateISO] = { kg: 0, kgExport: 0, kgEcart: 0 };
                    acc[e.dateISO].kg += e.kg;
                    if (e.typeVente === 'Export') acc[e.dateISO].kgExport += e.kg;
                    else acc[e.dateISO].kgEcart += e.kg;
                });
                return days.map(d => ({ ...d, kg: acc[d.date]?.kg || 0, kgExport: acc[d.date]?.kgExport || 0, kgEcart: acc[d.date]?.kgEcart || 0 }));
            }, [mapped, selectedVariety]);

            const totalHa = React.useMemo(() => {
                const list = selectedVariety ? cycle2Stats.filter(c => c.variety === selectedVariety) : cycle2Stats;
                return list.reduce((s, c) => s + (c.ha || 0), 0);
            }, [cycle2Stats, selectedVariety]);
            const totalPlants = React.useMemo(() => {
                const list = selectedVariety ? cycle2Stats.filter(c => c.variety === selectedVariety) : cycle2Stats;
                return list.reduce((s, c) => s + (c.plants || 0), 0);
            }, [cycle2Stats, selectedVariety]);
            const isAllMyrtille = React.useMemo(() => {
                const list = selectedVariety ? cycle2Stats.filter(c => c.variety === selectedVariety) : cycle2Stats;
                return list.length > 0 && list.every(c => c.culture === 'Myrtille');
            }, [cycle2Stats, selectedVariety]);
            const showKgPlant = isAllMyrtille && totalPlants > 0;
            React.useEffect(() => {
                if (chartMode === 'kgplant' && !showKgPlant) setChartMode('kgha');
            }, [chartMode, showKgPlant]);
            const isKgHa = chartMode === 'kgha';
            const isKgPlant = chartMode === 'kgplant';
            const dataPoints = last7Days.map(d => ({
                ...d,
                val: isKgPlant ? (totalPlants > 0 ? d.kg / totalPlants : 0)
                    : isKgHa ? (totalHa > 0 ? d.kg / totalHa : 0)
                    : d.kg,
            }));
            const maxVal = Math.max(isKgPlant ? 0.001 : 1, ...dataPoints.map(d => d.val));
            const kgPlantInGrams = isKgPlant && maxVal < 1;
            const total7DaysVal = dataPoints.reduce((s, d) => s + d.val, 0);
            const total7DaysKg = last7Days.reduce((s, d) => s + (d.kg || 0), 0);
            const total7DaysLabel = isKgPlant
                ? (kgPlantInGrams ? Math.round(total7DaysVal * 1000).toLocaleString() : total7DaysVal.toFixed(2))
                : Math.round(total7DaysVal).toLocaleString();
            const total7DaysUnit = isKgPlant ? (kgPlantInGrams ? 'g/Pl' : 'Kg/Pl') : isKgHa ? 'Kg/Ha' : 'kg';

            const yesterdayStats = React.useMemo(() => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                const yISO = d.toISOString().slice(0, 10);
                const acc = {};
                mapped.forEach(e => {
                    if (e.dateISO !== yISO) return;
                    const v = e.variety;
                    if (!acc[v]) acc[v] = { variety: v, culture: e.culture, cycle: e.cycle, kg: 0, kgExport: 0, kgLocal: 0 };
                    acc[v].kg += e.kg;
                    if (e.typeVente === 'Export') acc[v].kgExport += e.kg;
                    if (e.typeVente === 'Marché Local') acc[v].kgLocal += e.kg;
                });
                const knownSous = ['Green Cane', 'Long Cane', 'Mow Down', 'Bi Cycle', 'Cut Back'];
                return Object.values(acc).map(s => {
                    let baseV = s.variety, sousV = null;
                    for (const sv of knownSous) { if (s.variety.endsWith(sv)) { baseV = s.variety.slice(0, -(sv.length + 1)); sousV = sv; break; } }
                    const ha = getHaByCycle(baseV, sousV, farmFilter, s.cycle) || getHaByCycle(baseV, null, farmFilter, s.cycle);
                    const pctLocal = s.kg > 0 ? (s.kgLocal / s.kg * 100) : 0;
                    const pctEcart = s.kg > 0 ? ((s.kg - s.kgExport) / s.kg * 100) : 0;
                    const kgPerHa = ha > 0 ? s.kg / ha : 0;
                    return { ...s, ha, pctLocal, pctEcart, kgPerHa };
                }).sort((a, b) => b.kg - a.kg);
            }, [mapped, farmFilter]);

            const yesterdayLabel = (() => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                return d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' });
            })();

            if (loading) return <div style={{padding:16, textAlign:'center', color:'var(--gray-400)', fontSize:11}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement production…</div>;

            return (
                <div style={{marginBottom:16, padding:14, borderRadius:12, background:'linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%)', border:'1.5px solid #e0e7ff'}}>
                    <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12}}>
                        <i className="fa-solid fa-chart-column" style={{color:'#5c6bc0'}}></i>
                        <span style={{fontWeight:700, fontSize:13, color:'#283593'}}>Production — {farmFilter} — Cycle 2</span>
                    </div>

                    {cycle2Stats.length > 0 ? (
                        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8, marginBottom:14}}>
                            {cycle2Stats.map((s, i) => {
                                const isMyrt = s.culture === 'Myrtille';
                                const cardBg = isMyrt ? '#e8f5e9' : '#fff3e0';
                                const cardBorder = isMyrt ? '#a5d6a7' : '#ffcc80';
                                const rendColor = isMyrt ? '#2e7d32' : '#e65100';
                                const budgetCfg = BUDGET_BGF[s.variety];
                                const storedTotals = (() => { try { return JSON.parse(localStorage.getItem('budgetBGFTotals') || '{}'); } catch(e) { return {}; } })();
                                const budgetTotal = budgetCfg ? (storedTotals[s.variety] || budgetCfg.total) : 0;
                                const reelKgHa = s.ha > 0 ? s.kgExport / s.ha : 0;
                                const pctBudget = budgetTotal > 0 ? (reelKgHa / budgetTotal * 100).toFixed(0) : null;
                                const pctColor = pctBudget !== null ? (pctBudget >= 100 ? '#22c55e' : pctBudget >= 70 ? '#f59e0b' : '#ef4444') : '#999';
                                const isSelected = selectedVariety === s.variety;
                                return (
                                    <div key={i} onClick={() => setSelectedVariety(isSelected ? '' : s.variety)} style={{padding:10, borderRadius:10, background: isSelected ? '#fff' : cardBg, border: isSelected ? '2px solid #6c5ce7' : `1px solid ${cardBorder}`, position:'relative', cursor:'pointer', transition:'all 0.2s', boxShadow: isSelected ? '0 2px 8px rgba(108,92,231,0.2)' : 'none'}}>
                                        {pctBudget !== null && (
                                            <div style={{position:'absolute', top:6, right:8, fontSize:11, fontWeight:800, color:pctColor}}>
                                                {pctBudget}%
                                                <div style={{fontSize:7, fontWeight:500, color:'#999', textAlign:'right'}}>vs Budget</div>
                                            </div>
                                        )}
                                        <div style={{fontWeight:700, fontSize:11, color:'#1a237e', marginBottom:1}}>{s.variety}</div>
                                        <div style={{fontSize:9, color:'var(--gray-500)', marginBottom:6}}>{isMyrt ? '🫐 Myrtille' : '🍇 Framboise'}</div>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                                            <div>
                                                <div style={{fontSize:16, fontWeight:800, color:rendColor}}>{s.rendement}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>{s.rendementLabel}</div>
                                            </div>
                                            <div style={{textAlign:'right'}}>
                                                <div style={{fontSize:11, fontWeight:700, color:'#e65100'}}>{s.pctLocal}%</div>
                                                <div style={{fontSize:8, color:'var(--gray-400)'}}>% Local</div>
                                            </div>
                                        </div>
                                        <div style={{marginTop:4, fontSize:9, color:'var(--gray-500)'}}>Export: {s.tonnageExport} T{s.plants > 0 && <span style={{marginLeft:6, color:'#283593', fontWeight:600}}>{s.plants.toLocaleString()} pl.</span>}</div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{padding:12, fontSize:11, color:'var(--gray-400)', textAlign:'center', marginBottom:12}}>Aucune donnée Cycle 2 pour {farmFilter}</div>
                    )}

                    <div style={{padding:12, background:'#fff', borderRadius:10}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:8, flexWrap:'wrap'}}>
                            <div style={{fontSize:12, fontWeight:700, color:'#283593'}}>
                                <i className="fa-solid fa-chart-bar" style={{marginRight:6}}></i>Production — 7 derniers jours
                                {selectedVariety && <span style={{marginLeft:8, fontSize:11, fontWeight:600, color:'#6c5ce7'}}>— {selectedVariety} <i className="fa-solid fa-xmark" onClick={() => setSelectedVariety('')} style={{cursor:'pointer', marginLeft:4, color:'#999'}}></i></span>}
                            </div>
                            <div style={{display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:14, background:'rgba(52,152,219,0.1)', border:'1.5px solid rgba(52,152,219,0.3)'}}>
                                <span style={{fontSize:10, fontWeight:600, color:'var(--gray-600)'}}>Total 7 jours</span>
                                <span style={{fontSize:13, fontWeight:800, color:'#3498db'}}>{total7DaysLabel}</span>
                                <span style={{fontSize:10, fontWeight:600, color:'var(--gray-500)'}}>{total7DaysUnit}</span>
                                {!chartMode || chartMode !== 'total' ? (
                                    <span style={{fontSize:10, color:'var(--gray-400)', borderLeft:'1px solid rgba(52,152,219,0.3)', paddingLeft:6, marginLeft:2}}>{total7DaysKg >= 1000 ? (total7DaysKg/1000).toFixed(2) + ' T' : Math.round(total7DaysKg).toLocaleString() + ' kg'}</span>
                                ) : null}
                            </div>
                            <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                <button onClick={() => setChartMode('kgha')} style={{padding:'4px 10px', fontSize:10, fontWeight:600, borderRadius:14, border:'none', cursor:'pointer', background: isKgHa ? 'var(--berry)' : '#f0f0f0', color: isKgHa ? '#fff' : '#666'}}>Kg / Ha</button>
                                {showKgPlant && (
                                    <button onClick={() => setChartMode('kgplant')} style={{padding:'4px 10px', fontSize:10, fontWeight:600, borderRadius:14, border:'none', cursor:'pointer', background: isKgPlant ? 'var(--berry)' : '#f0f0f0', color: isKgPlant ? '#fff' : '#666'}}>{kgPlantInGrams ? 'g / Pl' : 'Kg / Pl'}</button>
                                )}
                                <button onClick={() => setChartMode('total')} style={{padding:'4px 10px', fontSize:10, fontWeight:600, borderRadius:14, border:'none', cursor:'pointer', background: chartMode === 'total' ? 'var(--berry)' : '#f0f0f0', color: chartMode === 'total' ? '#fff' : '#666'}}>Total (kg)</button>
                                <label style={{display:'flex', alignItems:'center', gap:3, fontSize:10, cursor:'pointer', userSelect:'none', marginLeft:6, padding:'3px 8px', borderRadius:14, border: showEcarts ? '2px solid #e67e22' : '1.5px solid var(--gray-200)', background: showEcarts ? 'rgba(230,126,34,0.08)' : '#fff'}}>
                                    <input type="checkbox" checked={showEcarts} onChange={ev => setShowEcarts(ev.target.checked)} style={{accentColor:'#e67e22'}} />
                                    <span style={{fontWeight: showEcarts ? 600 : 500, color: showEcarts ? '#e67e22' : 'var(--gray-600)'}}>Écarts</span>
                                </label>
                            </div>
                        </div>
                        {isKgHa && totalHa <= 0 && (
                            <div style={{padding:6, fontSize:10, color:'#e74c3c', background:'#fdf0ed', borderRadius:6, marginBottom:6}}>
                                Aucune surface (Ha) Cycle 2 disponible pour {farmFilter}.
                            </div>
                        )}
                        {isKgPlant && totalPlants <= 0 && (
                            <div style={{padding:6, fontSize:10, color:'#e74c3c', background:'#fdf0ed', borderRadius:6, marginBottom:6}}>
                                Aucune information de plants disponible.
                            </div>
                        )}
                        <div style={{display:'flex', alignItems:'flex-end', gap:6, minHeight:140, padding:'8px 4px 0'}}>
                            {dataPoints.map((d, i) => {
                                const h = (d.val / maxVal) * 110;
                                const labelVal = isKgPlant
                                    ? (kgPlantInGrams ? Math.round(d.val * 1000).toLocaleString() : d.val.toFixed(2))
                                    : Math.round(d.val).toLocaleString();
                                const ecartPct = (showEcarts && d.kg > 0) ? Math.round(d.kgEcart / d.kg * 100) : 0;
                                return (
                                    <div key={i} style={{display:'flex', flexDirection:'column', alignItems:'center', flex:1, minWidth:0}}>
                                        <div style={{fontSize:9, fontWeight:700, marginBottom: showEcarts ? 1 : 3, color:'var(--gray-600)'}}>{labelVal}</div>
                                        {showEcarts && d.kgEcart > 0 && <div style={{fontSize:8, fontWeight:700, marginBottom:2, color:'#e67e22'}}>{ecartPct}%</div>}
                                        <div style={{width:'100%', maxWidth:36, borderRadius:'4px 4px 0 0', height:Math.max(h, 1), display:'flex', flexDirection:'column', justifyContent:'flex-end', overflow:'hidden'}}>
                                            {showEcarts ? (
                                                <>
                                                    {d.kgExport > 0 && <div style={{width:'100%', height: d.kg > 0 ? (d.kgExport / d.kg * h) : 0, background:'#3498db'}}></div>}
                                                    {d.kgEcart > 0 && <div style={{width:'100%', height: d.kg > 0 ? (d.kgEcart / d.kg * h) : 0, background:'#e67e22'}}></div>}
                                                </>
                                            ) : (
                                                d.val > 0 && <div style={{width:'100%', height:h, background:'#3498db'}}></div>
                                            )}
                                        </div>
                                        <div style={{fontSize:9, fontWeight:700, marginTop:5, color:'var(--berry)'}}>{d.label}</div>
                                    </div>
                                );
                            })}
                        </div>
                        {showEcarts && (
                            <div style={{display:'flex', gap:14, justifyContent:'center', marginTop:8, fontSize:10}}>
                                <div style={{display:'flex', alignItems:'center', gap:4}}>
                                    <span style={{width:10, height:10, borderRadius:2, background:'#3498db', display:'inline-block'}}></span>
                                    <span style={{fontWeight:600}}>Export</span>
                                </div>
                                <div style={{display:'flex', alignItems:'center', gap:4}}>
                                    <span style={{width:10, height:10, borderRadius:2, background:'#e67e22', display:'inline-block'}}></span>
                                    <span style={{fontWeight:600, color:'#e67e22'}}>Écarts (non Export)</span>
                                </div>
                            </div>
                        )}
                        {yesterdayStats.length > 0 && (
                            <div style={{marginTop:14, paddingTop:12, borderTop:'1px dashed var(--gray-200)'}}>
                                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap'}}>
                                    <i className="fa-solid fa-basket-shopping" style={{color:'#283593'}}></i>
                                    <span style={{fontSize:12, fontWeight:700, color:'#283593'}}>Récolte de la veille</span>
                                    <span style={{fontSize:10, color:'var(--gray-500)'}}>— {yesterdayLabel}</span>
                                </div>
                                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:8}}>
                                    {yesterdayStats.map((s, i) => {
                                        const isMyrt = s.culture === 'Myrtille';
                                        const cardBg = isMyrt ? '#e8f5e9' : '#fff3e0';
                                        const cardBorder = isMyrt ? '#a5d6a7' : '#ffcc80';
                                        const mainColor = isMyrt ? '#2e7d32' : '#e65100';
                                        return (
                                            <div key={i} style={{padding:10, borderRadius:10, background:cardBg, border:`1px solid ${cardBorder}`}}>
                                                <div style={{fontWeight:700, fontSize:11, color:'#1a237e'}}>{s.variety}</div>
                                                <div style={{fontSize:9, color:'var(--gray-500)', marginBottom:6}}>
                                                    {isMyrt ? '🫐 Myrtille' : '🍇 Framboise'} · Cycle {s.cycle}
                                                </div>
                                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4}}>
                                                    <div>
                                                        <div style={{fontSize:15, fontWeight:800, color:mainColor}}>
                                                            {s.kg >= 1000 ? (s.kg/1000).toFixed(2) + ' T' : Math.round(s.kg).toLocaleString() + ' kg'}
                                                        </div>
                                                        <div style={{fontSize:9, color:'var(--gray-400)'}}>Total récolté</div>
                                                    </div>
                                                    <div style={{textAlign:'right'}}>
                                                        <div style={{fontSize:13, fontWeight:700, color:mainColor}}>
                                                            {s.ha > 0 ? Math.round(s.kgPerHa).toLocaleString() : '—'}
                                                        </div>
                                                        <div style={{fontSize:9, color:'var(--gray-400)'}}>Kg/Ha</div>
                                                    </div>
                                                </div>
                                                <div style={{display:'flex', gap:8, paddingTop:6, borderTop:'1px solid rgba(0,0,0,0.06)'}}>
                                                    <div style={{flex:1}}>
                                                        <div style={{fontSize:11, fontWeight:700, color:'#e65100'}}>{s.pctLocal.toFixed(1)}%</div>
                                                        <div style={{fontSize:8, color:'var(--gray-400)'}}>Marché Local</div>
                                                    </div>
                                                    <div style={{flex:1, textAlign:'right'}}>
                                                        <div style={{fontSize:11, fontWeight:700, color:'#d35400'}}>{s.pctEcart.toFixed(1)}%</div>
                                                        <div style={{fontSize:8, color:'var(--gray-400)'}}>Écarts</div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

export { ChefProductionWidget };
