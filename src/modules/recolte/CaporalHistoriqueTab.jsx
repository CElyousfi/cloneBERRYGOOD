/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): CaporalHistoriqueTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== CAPORAL HISTORIQUE TAB =====================
        function CaporalHistoriqueTab({ data, farmFilter, avoSubFilter }) {
            const [loading, setLoading] = useState(true);
            const [progressData, setProgressData] = useState([]);
            const [normesData, setNormesData] = useState([]);
            const [selectedDate, setSelectedDate] = useState('');
            const [daySaisies, setDaySaisies] = useState([]);

            // Load cumul progress + normes
            React.useEffect(() => {
                const fq = farmFilter ? `&ferme=${farmFilter}` : '';
                Promise.all([
                    fetch(`/api/hors-recolte-suivi?action=get-progress${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-normes${fq}`).then(r => r.json()),
                ]).then(([progRes, normRes]) => {
                    if (progRes.success) setProgressData(progRes.progress || []);
                    if (normRes.success) setNormesData(normRes.normes || []);
                }).catch(() => {}).finally(() => setLoading(false));
            }, [farmFilter]);

            const getNorme = (tache) => {
                const found = normesData.find(n => n.tache === tache);
                return found ? (found.normeParJourParOuvrier || found.normeTunnelsParJourParOuvrier || 0) : 0;
            };

            // Build history from progress.historique
            const allDates = React.useMemo(() => {
                const dateSet = new Set();
                progressData.forEach(p => {
                    (p.historique || []).forEach(h => { if (h.date) dateSet.add(h.date); });
                });
                return [...dateSet].sort().reverse();
            }, [progressData]);

            // When a date is selected, show that day's saisies from historique
            React.useEffect(() => {
                if (!selectedDate) {
                    setDaySaisies([]);
                    return;
                }
                const saisies = [];
                progressData.forEach(p => {
                    const dayEntries = (p.historique || []).filter(h => h.date === selectedDate && h.nb > 0);
                    dayEntries.forEach(h => {
                        const norm = normalizeParcelle(p.parcelle);
                        const displayName = norm ? (norm.sousVariete ? `${norm.variete} ${norm.sousVariete}` : norm.variete) : p.parcelle;
                        const normeVal = getNorme(p.tache);
                        const nbOuv = h.nbOuvriers || 0;
                        const attendu = nbOuv * normeVal;
                        saisies.push({
                            parcelle: displayName,
                            tache: p.tache,
                            ferme: p.ferme,
                            nbRealise: h.nb,
                            nbOuvriers: nbOuv,
                            caporal: h.caporal || '',
                            normeVal,
                            rendPct: attendu > 0 ? Math.round(h.nb / attendu * 100) : 0,
                        });
                    });
                });
                setDaySaisies(saisies);
            }, [selectedDate, progressData, normesData]);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin fa-2x"></i><div style={{marginTop:12}}>Chargement historique...</div></div>;

            // Summary: per-task cumul
            const taskSummary = {};
            progressData.forEach(p => {
                const norm = normalizeParcelle(p.parcelle);
                const displayName = norm ? (norm.sousVariete ? `${norm.variete} ${norm.sousVariete}` : norm.variete) : p.parcelle;
                const pc = norm ? PARCELLES_CULTURALES.find(c => c.variete === norm.variete && c.ferme === norm.ferme && c.sousVariete === norm.sousVariete && c.cycle === getCycle(new Date().toISOString().slice(0,10))) : null;
                const nbTotal = pc ? pc.nbTunnels : 0;
                const key = `${displayName}__${p.tache}`;
                if (!taskSummary[key]) taskSummary[key] = { parcelle: displayName, tache: p.tache, totalRealise: 0, nbTotal, termine: false, nbJours: 0 };
                taskSummary[key].totalRealise += p.totalRealise || 0;
                taskSummary[key].termine = taskSummary[key].termine || p.termine;
                taskSummary[key].nbJours += (p.historique || []).filter(h => h.nb > 0).length;
            });

            return (
                <div className="fade-in">
                    <h2 style={{fontSize:16, fontWeight:800, color:'var(--dark)', margin:'0 0 16px 0'}}>
                        <i className="fa-solid fa-clock-rotate-left" style={{marginRight:8, color:'var(--berry)'}}></i>
                        Historique Hors Récolte — {farmFilter}
                    </h2>

                    {/* Cumul summary */}
                    <Panel title="Progression cumulée par tâche" icon="fa-chart-gantt">
                        {Object.keys(taskSummary).length === 0 ? (
                            <div style={{textAlign:'center',padding:24,color:'var(--gray-400)',fontSize:13}}>Aucune donnée enregistrée</div>
                        ) : (
                        <table className="data-table" style={{fontSize:11}}>
                            <thead>
                                <tr>
                                    <th>Parcelle</th>
                                    <th>Tâche</th>
                                    <th style={{textAlign:'right'}}>Réalisé</th>
                                    <th style={{textAlign:'right'}}>Total</th>
                                    <th style={{width:120}}>Progression</th>
                                    <th style={{textAlign:'center'}}>Jours</th>
                                    <th style={{textAlign:'center'}}>Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.values(taskSummary).map((r, i) => {
                                    const pct = r.nbTotal > 0 ? Math.min(100, Math.round(r.totalRealise / r.nbTotal * 100)) : 0;
                                    return (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{r.parcelle}</td>
                                            <td>{r.tache}</td>
                                            <td style={{textAlign:'right', fontWeight:600}}>{r.totalRealise}</td>
                                            <td style={{textAlign:'right', color:'var(--gray-400)'}}>{r.nbTotal || '—'}</td>
                                            <td>
                                                {r.nbTotal > 0 ? (
                                                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                                                        <div style={{flex:1, height:6, background:'var(--gray-200)', borderRadius:3, overflow:'hidden'}}>
                                                            <div style={{width:`${pct}%`, height:'100%', borderRadius:3, background: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}} />
                                                        </div>
                                                        <span style={{fontSize:9, fontWeight:700, color: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}}>{pct}%</span>
                                                    </div>
                                                ) : '—'}
                                            </td>
                                            <td style={{textAlign:'center', fontSize:10, color:'var(--gray-500)'}}>{r.nbJours}j</td>
                                            <td style={{textAlign:'center'}}>
                                                {r.termine
                                                    ? <span style={{fontSize:9, padding:'2px 8px', borderRadius:10, background:'var(--green)', color:'white', fontWeight:700}}>Terminée</span>
                                                    : <span style={{fontSize:9, padding:'2px 8px', borderRadius:10, background:'rgba(243,156,18,0.1)', color:'var(--orange)', fontWeight:700}}>En cours</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        )}
                    </Panel>

                    {/* Day picker */}
                    <Panel title="Détail par jour" icon="fa-calendar-day">
                        <div style={{display:'flex', gap:8, marginBottom:16, flexWrap:'wrap'}}>
                            {allDates.length === 0 ? (
                                <span style={{fontSize:12, color:'var(--gray-400)'}}>Aucun jour enregistré</span>
                            ) : allDates.slice(0, 14).map(d => (
                                <button key={d} onClick={() => setSelectedDate(selectedDate === d ? '' : d)}
                                    style={{padding:'6px 12px', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer',
                                        background: selectedDate === d ? 'var(--berry)' : 'var(--gray-100)',
                                        color: selectedDate === d ? 'white' : 'var(--gray-600)',
                                        border: selectedDate === d ? '1px solid var(--berry)' : '1px solid var(--gray-200)'}}>
                                    {new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' })}
                                </button>
                            ))}
                        </div>

                        {selectedDate && daySaisies.length > 0 && (
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th>Parcelle</th>
                                        <th>Tâche</th>
                                        <th style={{textAlign:'center'}}>Ouvriers</th>
                                        <th style={{textAlign:'right'}}>Réalisé</th>
                                        <th style={{textAlign:'center'}}>Norme</th>
                                        <th style={{textAlign:'center'}}>Rendement</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {daySaisies.map((s, i) => (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{s.parcelle}</td>
                                            <td>{s.tache}</td>
                                            <td style={{textAlign:'center'}}>{s.nbOuvriers || '—'}</td>
                                            <td style={{textAlign:'right', fontWeight:600, color:'var(--orange)'}}>{s.nbRealise}</td>
                                            <td style={{textAlign:'center', fontSize:10, color:'var(--gray-400)'}}>{s.normeVal || '—'}</td>
                                            <td style={{textAlign:'center'}}>
                                                {s.rendPct > 0 ? (
                                                    <span style={{fontSize:9, padding:'2px 8px', borderRadius:8, fontWeight:700,
                                                        background: s.rendPct >= 100 ? 'rgba(46,204,113,0.1)' : s.rendPct >= 80 ? 'rgba(52,152,219,0.1)' : s.rendPct >= 60 ? 'rgba(243,156,18,0.1)' : 'rgba(231,76,60,0.1)',
                                                        color: s.rendPct >= 100 ? 'var(--green)' : s.rendPct >= 80 ? 'var(--blue)' : s.rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>
                                                        {s.rendPct}%
                                                    </span>
                                                ) : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        {selectedDate && daySaisies.length === 0 && (
                            <div style={{textAlign:'center', padding:16, color:'var(--gray-400)', fontSize:12}}>Aucune saisie pour cette date</div>
                        )}
                    </Panel>
                </div>
            );
        }

export { CaporalHistoriqueTab };
