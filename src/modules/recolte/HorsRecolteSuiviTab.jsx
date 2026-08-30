/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): HorsRecolteSuiviTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { displayParcelle } from '../agronomie/displayParcelle.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';

function HorsRecolteSuiviTab({ data, farmFilter, avoSubFilter }) {
            const [filterFerme, setFilterFerme] = useState(farmFilter || 'F5');
            const [filterParcelle, setFilterParcelle] = useState('');
            const [tunnelsData, setTunnelsData] = useState({});
            const [progressData, setProgressData] = useState([]);
            const [normesData, setNormesData] = useState([]);
            const [normProposals, setNormProposals] = useState([]);
            const [todaySaisies, setTodaySaisies] = useState([]);
            const [loading, setLoading] = useState(true);
            const [dateStr, setDateStr] = useState('');

            const isAvocatier = filterFerme === 'Avocatier';

            const getNbTotal = (parcelleName) => {
                const norm = normalizeParcelle(parcelleName);
                if (norm) {
                    const pc = PARCELLES_CULTURALES.find(p => p.variete === norm.variete && p.ferme === norm.ferme && p.sousVariete === norm.sousVariete && p.cycle === getCycle(new Date().toISOString().slice(0,10)));
                    if (pc) return isAvocatier ? (pc.nbLignes || 0) : (pc.nbTunnels || 0);
                }
                if (isAvocatier) {
                    const avo = data.avocatierConfig || {};
                    for (const farm of Object.values(avo)) { const found = farm.find(p => p.nom === parcelleName); if (found) return found.nbLignes; }
                    return 0;
                }
                const pc = data.parcelleConfig[filterFerme] || [];
                const found = pc.find(p => p.nom === parcelleName);
                return found ? found.nbTunnels : 0;
            };

            const getNorme = (tache) => {
                const found = normesData.find(n => n.tache === tache);
                return found ? (found.normeParJourParOuvrier || found.normeTunnelsParJourParOuvrier || 0) : 0;
            };

            const loadData = (ferme) => {
                setLoading(true);
                const fq = ferme ? `&ferme=${ferme}` : '';
                Promise.all([
                    cachedFetch(`/api/validation?action=suivi-tunnels${fq}`),
                    fetch(`/api/hors-recolte-suivi?action=get-progress${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-normes${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=detect-norm-adjustments`).then(r => r.json()).catch(() => ({ success: false })),
                    fetch(`/api/hors-recolte-suivi?action=get-saisies-today${fq}`).then(r => r.json()).catch(() => ({ success: false })),
                ]).then(([sqlRes, firestoreRes, normRes, detectRes, saisieRes]) => {
                    if (sqlRes.success) { setTunnelsData(sqlRes.tunnels || {}); setDateStr(sqlRes.date || ''); }
                    if (firestoreRes.success) setProgressData(firestoreRes.progress || []);
                    if (normRes.success) setNormesData(normRes.normes || []);
                    if (detectRes.success) setNormProposals(detectRes.proposals || []);
                    if (saisieRes.success) setTodaySaisies(saisieRes.saisies || []);
                }).catch(() => {}).finally(() => setLoading(false));
            };

            React.useEffect(() => { loadData(filterFerme); }, [filterFerme]);

            const rows = tunnelsData[filterFerme] || [];
            const filteredRows = filterParcelle ? rows.filter(r => r.parcelle === filterParcelle) : rows;
            const parcelles = [...new Set(rows.map(r => r.parcelle))];

            const getCumulFromFirestore = (parcelle, tache) => {
                return progressData.find(p => p.parcelle === parcelle && p.tache === tache)
                    || progressData.find(p => p.parcelle === displayParcelle(parcelle) && p.tache === tache);
            };

            // Get today's saisie from Firestore (what the caporal entered)
            const getSaisieAuj = (parcelle, tache) => {
                const dp = displayParcelle(parcelle);
                const found = todaySaisies.find(s => s.parcelle === parcelle && s.tache === tache)
                    || todaySaisies.find(s => s.parcelle === dp && s.tache === tache);
                return found ? (found.nbRealise || 0) : 0;
            };

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin fa-2x"></i><div style={{marginTop:12}}>Chargement...</div></div>;

            // KPIs
            let totalOps = filteredRows.length, nbTermine = 0, rendSum = 0, rendCount = 0;
            filteredRows.forEach(r => {
                const nbTotal = getNbTotal(r.parcelle);
                const cumul = getCumulFromFirestore(r.parcelle, r.tache);
                const totalR = cumul ? cumul.totalRealise : r.totalRealise;
                if (cumul && cumul.termine) nbTermine++;
                else if (nbTotal > 0 && totalR >= nbTotal) nbTermine++;
                const norme = getNorme(r.tache);
                const attendu = norme > 0 ? r.nbOuvriers * norme : 0;
                const realAuj = getSaisieAuj(r.parcelle, r.tache) || r.realiseAujourdhui;
                if (attendu > 0 && realAuj > 0) { rendSum += (realAuj / attendu) * 100; rendCount++; }
            });
            const avgRend = rendCount > 0 ? Math.round(rendSum / rendCount) : 0;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', gap:12, marginBottom:16, alignItems:'center', flexWrap:'wrap'}}>
                        {!farmFilter && (
                        <select value={filterFerme} onChange={e => {setFilterFerme(e.target.value); setFilterParcelle('');}} style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}>
                            <option value="F1">Ferme F1</option>
                            <option value="F5">Ferme F5</option>
                            <option value="Avocatier">Avocatier</option>
                        </select>
                        )}
                        <select value={filterParcelle} onChange={e => setFilterParcelle(e.target.value)} style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}>
                            <option value="">Toutes parcelles</option>
                            {parcelles.map((p, i) => <option key={i} value={p}>{displayParcelle(p)}</option>)}
                        </select>
                        <span style={{fontSize:11,color:'var(--gray-400)'}}>{dateStr}</span>
                    </div>

                    {/* KPI Cards */}
                    <div className="kpi-grid" style={{marginBottom:20}}>
                        <KPICard icon="fa-list-check" iconClass="berry" value={totalOps} label="Opérations du jour" />
                        <KPICard icon="fa-circle-check" iconClass="green" value={nbTermine} label="Tâches terminées" />
                        <KPICard icon="fa-gauge-high" iconClass={avgRend >= 100 ? 'green' : avgRend >= 60 ? 'gold' : 'red'} value={avgRend > 0 ? `${avgRend}%` : '—'} label="Rendement moyen vs norme" />
                        {normProposals.length > 0 && <KPICard icon="fa-arrow-trend-up" iconClass="blue" value={normProposals.length} label="Normes à réviser" />}
                    </div>

                    {/* Norm proposals alert */}
                    {normProposals.length > 0 && (
                        <Panel title="Propositions de révision de normes" icon="fa-arrow-trend-up">
                            {normProposals.map((p, i) => (
                                <div key={i} style={{padding:10, background:'rgba(52,152,219,0.05)', borderRadius:8, marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                    <div>
                                        <span style={{fontWeight:700, fontSize:12}}>{p.tache}</span>
                                        <span style={{fontSize:10, color:'var(--gray-400)', marginLeft:8}}>{p.ferme}</span>
                                    </div>
                                    <div style={{textAlign:'right'}}>
                                        <span style={{fontSize:11, color:'var(--berry)', fontWeight:700}}>{p.currentNorm} → {p.proposedNorm}</span>
                                        <div style={{fontSize:9, color:'var(--gray-400)'}}>Moy. {p.avgRatio}% sur {p.daysAnalyzed}j ({p.avgWorkers} ouv.)</div>
                                    </div>
                                </div>
                            ))}
                        </Panel>
                    )}

                    <Panel title={`Suivi Hors-Récolte ${filterFerme}`} icon="fa-chart-gantt">
                        {filteredRows.length === 0 ? (
                            <div style={{textAlign:'center',padding:24,color:'var(--gray-400)',fontSize:13}}>
                                <i className="fa-solid fa-inbox" style={{fontSize:24,marginBottom:8,display:'block'}}></i>
                                Aucune opération hors-récolte pour cette date
                            </div>
                        ) : (
                        <table className="data-table" style={{fontSize:11}}>
                            <thead>
                                <tr>
                                    <th>Parcelle</th>
                                    <th>Tâche</th>
                                    <th style={{textAlign:'center'}}>Nb Ouv.</th>
                                    <th style={{textAlign:'right'}}>Réalisé Auj.</th>
                                    <th style={{textAlign:'right'}}>Cumul</th>
                                    <th style={{textAlign:'right'}}>{isAvocatier ? 'Total Lignes' : 'Total Tunnels'}</th>
                                    <th style={{width:140}}>Progression</th>
                                    <th style={{textAlign:'center'}}>Norme</th>
                                    <th style={{textAlign:'center'}}>Rendement</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((r, i) => {
                                    const nbTotal = getNbTotal(r.parcelle);
                                    const firestoreCumul = getCumulFromFirestore(r.parcelle, r.tache);
                                    const totalRealise = firestoreCumul ? firestoreCumul.totalRealise : r.totalRealise;
                                    const pct = nbTotal > 0 ? Math.min(100, Math.round(totalRealise / nbTotal * 100)) : 0;
                                    const norme = getNorme(r.tache);
                                    const attendu = norme > 0 ? r.nbOuvriers * norme : 0;
                                    const realAuj = getSaisieAuj(r.parcelle, r.tache) || r.realiseAujourdhui;
                                    const rendPct = attendu > 0 ? Math.round(realAuj / attendu * 100) : 0;
                                    const isTermine = firestoreCumul ? firestoreCumul.termine : (nbTotal > 0 && totalRealise >= nbTotal);

                                    return (
                                        <tr key={i} style={{background: isTermine ? 'rgba(46,204,113,0.04)' : undefined}}>
                                            <td style={{fontWeight:600}}>{displayParcelle(r.parcelle)}</td>
                                            <td style={{fontSize:10}}>{r.tache}</td>
                                            <td style={{textAlign:'center'}}>{r.nbOuvriers}</td>
                                            <td style={{textAlign:'right', fontWeight:600, color: realAuj > 0 ? 'var(--green)' : 'var(--gray-300)'}}>{realAuj || 0}</td>
                                            <td style={{textAlign:'right', fontWeight:600}}>{totalRealise}</td>
                                            <td style={{textAlign:'right', color:'var(--gray-400)'}}>{nbTotal || '—'}</td>
                                            <td>
                                                {nbTotal > 0 ? (
                                                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                                                        <div style={{flex:1, height:8, background:'var(--gray-200)', borderRadius:4, overflow:'hidden'}}>
                                                            <div style={{width:`${pct}%`, height:'100%', borderRadius:4, transition:'width 0.3s',
                                                                background: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}} />
                                                        </div>
                                                        <span style={{fontSize:9, fontWeight:700, minWidth:28, textAlign:'right',
                                                            color: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}}>{pct}%</span>
                                                    </div>
                                                ) : <span style={{color:'var(--gray-300)', fontSize:10}}>—</span>}
                                            </td>
                                            <td style={{textAlign:'center', fontSize:9, color:'var(--gray-400)'}}>{norme > 0 ? norme : '—'}</td>
                                            <td style={{textAlign:'center'}}>
                                                {attendu > 0 ? (
                                                    <span style={{fontSize:9, padding:'2px 8px', borderRadius:8, fontWeight:700,
                                                        background: rendPct >= 100 ? 'rgba(46,204,113,0.1)' : rendPct >= 80 ? 'rgba(52,152,219,0.1)' : rendPct >= 60 ? 'rgba(243,156,18,0.1)' : 'rgba(231,76,60,0.1)',
                                                        color: rendPct >= 100 ? 'var(--green)' : rendPct >= 80 ? 'var(--blue)' : rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>
                                                        {rendPct}%
                                                    </span>
                                                ) : <span style={{color:'var(--gray-300)', fontSize:10}}>—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        )}
                    </Panel>
                </div>
            );
        }

export { HorsRecolteSuiviTab };
