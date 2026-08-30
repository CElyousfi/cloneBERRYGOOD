/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualiteHistoriqueTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { deduplicateExpeditions } from './deduplicateExpeditions.jsx';

// ===================== QUALITE HISTORIQUE TAB =====================
        function QualiteHistoriqueTab({ data, applyVarietyMapping }) {
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDayLots, setSelectedDayLots] = useState(null);
            const [currentLotIndex, setCurrentLotIndex] = useState(0);
            const [visibleSeries, setVisibleSeries] = useState({ Total: true, Condition: true, Apparence: true });
            const [focusSeries, setFocusSeries] = useState('');
            const [periodDays, setPeriodDays] = useState(7);
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => {
                        if (json.success && json.expeditions) setExpeditions(json.expeditions);
                    })
                    .catch(err => console.warn('Could not load expeditions:', err))
                    .finally(() => setLoading(false));
            }, []);

            // Apply variety mapping + exclude REJECT + deduplicate by batchNumber
            const mappedExpeditions = React.useMemo(() =>
                deduplicateExpeditions(expeditions.filter(e => e.overallResult !== 'REJECT')).map(e => ({
                    ...e, variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety
                })),
            [expeditions, applyVarietyMapping]);

            // Ferme filter
            const uniqueFermes = [...new Set(mappedExpeditions.map(e => ranchToFerme[e.ranch] || e.ranch).filter(Boolean))].sort();
            const fermeFiltered = selectedFerme ? mappedExpeditions.filter(e => (ranchToFerme[e.ranch] || e.ranch) === selectedFerme) : mappedExpeditions;

            // Extract unique varieties (depends on ferme filter)
            const varietes = [...new Set(fermeFiltered.map(e => e.variety).filter(Boolean))].sort();
            const activeVariete = selectedVariete || 'Toutes';

            // Aggregate by date for selected variety
            const historique = React.useMemo(() => {
                const filtered = activeVariete === 'Toutes' ? fermeFiltered : fermeFiltered.filter(e => e.variety === activeVariete);
                const byDate = {};
                filtered.forEach(e => {
                    // Normalize date to DD/MM/YYYY
                    const raw = e.date || '';
                    const dateKey = raw.includes('/') ? raw.split(' ')[0] : raw.substring(0, 10);
                    if (!byDate[dateKey]) byDate[dateKey] = [];
                    byDate[dateKey].push(e);
                });
                return Object.entries(byDate)
                    .map(([date, exps]) => {
                        const nb = exps.length;
                        const avgCondition = exps.reduce((s, e) => s + (e.pfqCondition || 0), 0) / nb;
                        const avgApparence = exps.reduce((s, e) => s + (e.pfqApparence || 0), 0) / nb;
                        const brixExps = exps.filter(e => e.pfqBrix != null);
                        const avgPfqBrix = brixExps.length > 0 ? brixExps.reduce((s, e) => s + e.pfqBrix, 0) / brixExps.length : null;
                        const avgPfqTotal = avgPfqBrix != null ? avgCondition + avgApparence + avgPfqBrix : avgCondition + avgApparence;
                        const avgBrix = exps.filter(e => e.brix).length > 0
                            ? exps.reduce((s, e) => s + (e.brix || 0), 0) / exps.filter(e => e.brix).length : null;
                        const passCount = exps.filter(e => e.overallResult === 'PASS').length;
                        const passRate = (passCount / nb) * 100;
                        const varietiesInDay = [...new Set(exps.map(e => e.variety).filter(Boolean))];
                        return { date, nbBatches: nb, avgCondition, avgApparence, avgPfqBrix, avgPfqTotal, avgBrix, passRate, varieties: varietiesInDay, lots: exps };
                    })
                    .sort((a, b) => new Date(b.date) - new Date(a.date));
            }, [fermeFiltered, activeVariete]);

            const displayedHistorique = React.useMemo(() => {
                if (!periodDays) return historique;
                const cutoff = Date.now() - periodDays * 86400000;
                return historique.filter(h => {
                    const d = new Date(h.date);
                    return !isNaN(d) && d.getTime() >= cutoff;
                });
            }, [historique, periodDays]);

            const len = displayedHistorique.length || 1;
            const avgCond = Math.round(displayedHistorique.reduce((s, h) => s + h.avgCondition, 0) / len * 10) / 10;
            const avgApp = Math.round(displayedHistorique.reduce((s, h) => s + h.avgApparence, 0) / len * 10) / 10;
            const avgTotal = Math.round(displayedHistorique.reduce((s, h) => s + h.avgPfqTotal, 0) / len * 10) / 10;
            const avgPass = Math.round(displayedHistorique.reduce((s, h) => s + h.passRate, 0) / len);

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
                        <div className="chip-group">
                            <span className="chip-group-label">Période:</span>
                            {[{l:'7j',v:7},{l:'30j',v:30},{l:'90j',v:90},{l:'180j',v:180},{l:'Tout',v:0}].map(p => (
                                <button key={p.l} className={`chip c-green ${periodDays === p.v ? 'active' : ''}`}
                                    onClick={() => setPeriodDays(p.v)}>
                                    {p.l}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="kpi-grid">
                        <KPICard icon="fa-chart-line" iconClass="berry"
                            value={avgCond}
                            label="PFQ Condition Moy." />
                        <KPICard icon="fa-eye" iconClass="blue"
                            value={avgApp}
                            label="PFQ Apparence Moy." />
                        <KPICard icon="fa-star" iconClass="green"
                            value={avgTotal}
                            label="PFQ Total Moy." />
                        <KPICard icon="fa-percent" iconClass="orange"
                            value={`${avgPass}%`}
                            label="Pass Rate Moy." />
                    </div>

                    <Panel title={`Évolution PFQ - ${activeVariete}`} icon="fa-chart-area">
                        {displayedHistorique.length > 1 ? (
                            <React.Fragment>
                                <SimpleAreaChart
                                    data={[...displayedHistorique].reverse().map(h => ({
                                        date: (() => {
                                            const r = h.date || '';
                                            if (r.includes('/')) return r.substring(0, 5);
                                            const m = r.match(/^(\d{4})-(\d{2})-(\d{2})/);
                                            return m ? `${m[3]}/${m[2]}` : r;
                                        })(),
                                        ...(visibleSeries.Condition ? { Condition: Math.round(h.avgCondition * 10) / 10 } : {}),
                                        ...(visibleSeries.Apparence ? { Apparence: Math.round(h.avgApparence * 10) / 10 } : {}),
                                        ...(visibleSeries.Total ? { Total: Math.round(h.avgPfqTotal * 10) / 10 } : {})
                                    }))}
                                    dataKeys={['Total','Condition','Apparence'].filter(k => visibleSeries[k])}
                                    colors={['Total','Condition','Apparence'].filter(k => visibleSeries[k]).map(k => ({Total:'#8B2252',Condition:'#E74C3C',Apparence:'#3498DB'}[k]))}
                                    xKey="date"
                                    height={270}
                                    showLabelsFor={focusSeries}
                                />
                                <div style={{display:'flex', gap: 6, justifyContent:'center', marginTop: 8}}>
                                    {[{key:'Total',label:'PFQ Total',color:'#8B2252'},{key:'Condition',label:'Condition',color:'#E74C3C'},{key:'Apparence',label:'Apparence',color:'#3498DB'}].map(s => (
                                        <button key={s.key}
                                            onClick={() => { setVisibleSeries(prev => ({...prev, [s.key]: !prev[s.key]})); if(focusSeries===s.key && visibleSeries[s.key]) setFocusSeries(''); }}
                                            onDoubleClick={() => setFocusSeries(s.key)}
                                            style={{
                                                display:'flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:16, fontSize:12, cursor:'pointer',
                                                border: focusSeries===s.key ? `2px solid ${s.color}` : '1.5px solid #e0e0e0',
                                                background: visibleSeries[s.key] ? '#fff' : '#f5f5f5',
                                                opacity: visibleSeries[s.key] ? 1 : 0.4,
                                                fontWeight: focusSeries===s.key ? 700 : 500, color: visibleSeries[s.key] ? '#333' : '#999'
                                            }}>
                                            <span style={{display:'inline-block', width:10, height:10, background: visibleSeries[s.key] ? s.color : '#ccc', borderRadius:3}}></span>
                                            {s.label}
                                        </button>
                                    ))}
                                </div>
                                <div style={{textAlign:'center', fontSize:10, color:'var(--gray-400)', marginTop:4}}>Cliquez pour afficher/masquer — Double-cliquez pour les labels</div>
                            </React.Fragment>
                        ) : (
                            <div style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>Pas assez de données pour afficher le graphique</div>
                        )}
                    </Panel>

                    <Panel title={`Détail Journalier - ${activeVariete}`} icon="fa-table">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Variété</th>
                                    <th>Lots</th>
                                    <th>PFQ Condition</th>
                                    <th>PFQ Apparence</th>
                                    <th>PFQ Brix</th>
                                    <th>PFQ Total</th>
                                    <th>Brix Moy.</th>
                                    <th>Pass Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedHistorique.map((h, i) => (
                                    <tr key={i} onClick={() => { setSelectedDayLots(h.lots); setCurrentLotIndex(0); }}
                                        style={{cursor:'pointer'}}
                                        onMouseOver={e => e.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                        <td style={{fontWeight: 500}}>{h.date}</td>
                                        <td>{activeVariete === 'Toutes' ? h.varieties.join(', ') : activeVariete}</td>
                                        <td>{h.nbBatches}</td>
                                        <td style={{fontWeight: 600}}>{Math.round(h.avgCondition * 10) / 10}</td>
                                        <td style={{fontWeight: 600}}>{Math.round(h.avgApparence * 10) / 10}</td>
                                        <td style={{fontWeight: 600, color: h.avgPfqBrix != null ? '#9C27B0' : 'var(--gray-400)'}}>{h.avgPfqBrix != null ? Math.round(h.avgPfqBrix * 10) / 10 : '-'}</td>
                                        <td><strong>{Math.round(h.avgPfqTotal * 10) / 10}</strong></td>
                                        <td>{h.avgBrix ? Math.round(h.avgBrix * 10) / 10 : '-'}</td>
                                        <td>
                                            <span className={`status-badge ${h.passRate >= 80 ? 'active' : (h.passRate >= 50 ? 'warning' : 'danger')}`}>
                                                {Math.round(h.passRate)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {displayedHistorique.length === 0 && (
                                    <tr><td colSpan="9" style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>
                                        Aucune donnée pour cette période
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                        <div style={{fontSize:11, color:'var(--gray-400)', marginTop:8}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>Cliquez sur une ligne pour voir les rapports qualité du jour</div>
                    </Panel>

                    {/* Modal rapport qualité — navigation flèches */}
                    {selectedDayLots && selectedDayLots.length > 0 && (() => {
                        const lot = selectedDayLots[currentLotIndex];
                        const ferme = ranchToFerme[lot.ranch] || lot.ranch;
                        const _dfr2 = {'Decay':'Pourriture','Decay Mold':'Pourriture','Decay/Mold':'Pourriture','Wet Leaky':'Fruit saignant','Wet/Leaky':'Fruit saignant','Overripe':'Fruit trop mûr','Soft':'Fruit mou','Collapsed':'Fruit mou','Shriveled':'Fruit desséché','Weak Cells':'Cellules blanches','Sooty Mold':'Cladosporium','Yellow Rust':'Rouille jaune','Reversion':'Réversion','Insect/SWD':'Insecte/Drosophile','Wet/Bruising':'Meurtrissure humide','Dry Bruising':'Meurtrissure sèche','Mildew':'Mildiou','Green':'Immature','Size':'Calibre < 3g','Skin Damage':'Dégâts ravageurs','Broken':'Cassé','Malformed':'Déformation','Attached Calyx':'Avec pédoncule','Foreign Bodies':'Corps étrangers','Foreign bodies':'Corps étrangers','Bloom':'Bloom (pruine)','Stem Blossom':'Résidu floral','Condition':'Condition','Appearance':'Apparence'};
                        const trD2 = (n) => _dfr2[n] || n;
                        return (
                            <div className="modal-overlay" onClick={() => setSelectedDayLots(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto', padding:0, borderRadius:12}}>
                                    {/* Header */}
                                    <div style={{background:'linear-gradient(135deg, #2d0a31 0%, #8B2252 100%)', padding:'20px 24px', color:'#fff', borderRadius:'12px 12px 0 0'}}>
                                        <div style={{fontSize:11, opacity:0.7, letterSpacing:1, marginBottom:4}}>DRISCOLL'S</div>
                                        <div style={{fontSize:20, fontWeight:300, fontStyle:'italic', marginBottom:12}}>Rapport d'Inspection Qualité</div>
                                        <div style={{display:'flex', alignItems:'center', gap:12}}>
                                            <span style={{padding:'4px 16px', borderRadius:6, fontSize:14, fontWeight:700,
                                                background: lot.overallResult === 'PASS' ? '#4caf50' : '#e53935', color:'#fff'}}>
                                                {lot.overallResult === 'PASS' ? '\u2714 CONFORME' : '\u2718 NON CONFORME'}
                                            </span>
                                            <span style={{fontSize:12, opacity:0.8}}>Inspection Initiale</span>
                                        </div>
                                    </div>

                                    <div style={{padding:'20px 24px'}}>
                                        {/* Info grid */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                            <div style={{display:'grid', gridTemplateColumns:'auto 1fr'}}>
                                                {[['Fruit', lot.berryTypeFr || lot.berryType],['Variété', lot.variety],['Article', lot.itemDescription || lot.item],['Ferme', `${lot.ranch} — ${ferme}`]].map(([l,v],j) => (
                                                    React.createElement(React.Fragment, {key:j},
                                                        React.createElement('div', {style:{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom: j<3?'1px solid #e0e0e0':'none'}}, l),
                                                        React.createElement('div', {style:{padding:'8px 12px', fontSize:12, borderBottom: j<3?'1px solid #e0e0e0':'none'}}, v || '-')
                                                    )
                                                ))}
                                            </div>
                                            <div style={{display:'grid', gridTemplateColumns:'auto 1fr', borderLeft:'1px solid #e0e0e0'}}>
                                                {[['Reçu', lot.receiptId],['N° Lot', lot.batchNumber],['Licence', lot.license],['Réception', lot.date],['Inspecté', lot.inspectedDate]].map(([l,v],j) => (
                                                    React.createElement(React.Fragment, {key:j},
                                                        React.createElement('div', {style:{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom: j<4?'1px solid #e0e0e0':'none'}}, l),
                                                        React.createElement('div', {style:{padding:'8px 12px', fontSize:12, borderBottom: j<4?'1px solid #e0e0e0':'none'}}, v || '-')
                                                    )
                                                ))}
                                            </div>
                                        </div>

                                        {/* Defects table */}
                                        {lot.conditionDefects && lot.conditionDefects.length > 0 && (
                                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:20}}>
                                                <thead>
                                                    <tr style={{background:'#f5f5f5'}}>
                                                        <th style={{padding:'8px 12px', textAlign:'left', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Attribut / Défaut</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Nb Fruits</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>%</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Points</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {lot.conditionDefects.map((d, j) => {
                                                        const isSummary = d.name === 'Condition' || d.name === 'Appearance';
                                                        return (
                                                            <tr key={j} style={{background: isSummary ? (d.name === 'Condition' ? '#e8f5e9' : '#fce4ec') : 'transparent'}}>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', fontWeight: isSummary ? 700 : 400}}>{trD2(d.name)}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.count || 0}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.percent != null ? d.percent.toFixed(1) + '%' : '0.0%'}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.points || ''}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        )}

                                        {/* Saveur / Brix */}
                                        <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                            <div style={{background:'linear-gradient(135deg, #ce93d8, #ba68c8)', padding:'8px 16px', textAlign:'center', color:'#fff', fontWeight:700, fontSize:13}}>Saveur</div>
                                            <div style={{textAlign:'center', padding:'6px', color:'#888', fontSize:11}}>Degrés Brix</div>
                                            <div style={{textAlign:'center', padding:'8px', fontSize:18, fontWeight:700}}>{lot.brix || '-'}</div>
                                        </div>

                                        {/* Batch details */}
                                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr style={{background:'#f5f5f5'}}>
                                                    {['Poids Lot (kg)','Qté Lot','Échantillon','Moy. Fruits/Barq.','Poids Moy. Barq.','Total Fruits Insp.'].map((h,j) =>
                                                        <th key={j} style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>{h}</th>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    {[lot.batchWeight, lot.batchQuantity, lot.sampleSize, lot.avgFruitsPerPunnet, lot.avgPunnetWeight, lot.totalFruitInspected].map((v,j) =>
                                                        <td key={j} style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{v || '-'}</td>
                                                    )}
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Navigation flèches */}
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:16, paddingTop:16, borderTop:'1px solid #e0e0e0'}}>
                                            <button onClick={() => setCurrentLotIndex(Math.max(0, currentLotIndex - 1))}
                                                disabled={currentLotIndex === 0}
                                                style={{padding:'8px 20px', borderRadius:8, border:'1.5px solid var(--gray-200)', background: currentLotIndex === 0 ? '#f5f5f5' : '#fff',
                                                    color: currentLotIndex === 0 ? '#ccc' : 'var(--berry)', cursor: currentLotIndex === 0 ? 'default' : 'pointer', fontWeight:600, fontSize:13}}>
                                                <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i> Précédent
                                            </button>
                                            <span style={{fontSize:12, fontWeight:600, color:'var(--gray-600)'}}>
                                                Rapport {currentLotIndex + 1} / {selectedDayLots.length}
                                            </span>
                                            <button onClick={() => setCurrentLotIndex(Math.min(selectedDayLots.length - 1, currentLotIndex + 1))}
                                                disabled={currentLotIndex >= selectedDayLots.length - 1}
                                                style={{padding:'8px 20px', borderRadius:8, border:'1.5px solid var(--gray-200)', background: currentLotIndex >= selectedDayLots.length - 1 ? '#f5f5f5' : '#fff',
                                                    color: currentLotIndex >= selectedDayLots.length - 1 ? '#ccc' : 'var(--berry)', cursor: currentLotIndex >= selectedDayLots.length - 1 ? 'default' : 'pointer', fontWeight:600, fontSize:13}}>
                                                Suivant <i className="fa-solid fa-arrow-right" style={{marginLeft:6}}></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

export { QualiteHistoriqueTab };
