/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): TransportSub */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { WorkerLink } from './WorkerLink.jsx';

import { QuinzaineCampagneSelect } from '../shared/QuinzaineCampagneSelect.jsx';
function TransportSub({ data, farmFilter, initialPeriode }) {
            const [transportEquipes, setTransportEquipes] = useState(() =>
                (data.transportConfig || []).map(t => ({...t}))
            );
            const [detailRows, setDetailRows] = useState([]);
            const [loading, setLoading] = useState(true);
            const [periodes, setPeriodes] = useState([]);
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const [workerPopup, setWorkerPopup] = useState(null);

            // Equipe prefix helper
            const getEqPrefix = (mat) => {
                if (!mat) return 'NV';
                const m = mat.toUpperCase().trim();
                const p2 = m.substring(0, 2);
                const known = transportEquipes.map(t => t.prefix);
                if (known.includes(p2)) return p2;
                if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
                if (m.startsWith('DD')) return 'NV';
                return null;
            };

            React.useEffect(() => {
                // Load all workers (all operations) for transport cost
                cachedFetch('/api/pointage-rh?action=transport').then(json => {
                    if (json.success) {
                        setDetailRows(json.rows || []);
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        if (json.periodes && json.periodes.length > 0) setSelectedPeriode(json.periodes[0]);
                    }
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🍇</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement transport...</div></div>;

            // Filter by selected quinzaine
            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const periodeRows = detailRows.filter(r => r.periode === currentPeriode && (!farmFilter || r.ferme === farmFilter));

            // Group by date → equipe → count unique workers
            const dailyByEquipe = {};
            const allDates = [...new Set(periodeRows.map(r => r.jour))].sort();

            periodeRows.forEach(r => {
                const d = r.jour;
                const eq = getEqPrefix(r.matricule);
                if (!eq) return;
                if (!dailyByEquipe[d]) dailyByEquipe[d] = {};
                if (!dailyByEquipe[d][eq]) dailyByEquipe[d][eq] = new Set();
                dailyByEquipe[d][eq].add(r.matricule);
            });

            // Build transport cost per equipe per day
            const coutMap = {};
            transportEquipes.forEach(t => { coutMap[t.prefix] = (data.getCoutTransport ? data.getCoutTransport(t.prefix, currentPeriode) : t.coutParOuvrier) || t.coutParOuvrier || 0; });

            // Build worker-level detail per equipe
            const workersByEquipe = {};
            periodeRows.forEach(r => {
                const eq = getEqPrefix(r.matricule);
                if (!eq) return;
                if (!workersByEquipe[eq]) workersByEquipe[eq] = {};
                const key = r.matricule;
                if (!workersByEquipe[eq][key]) workersByEquipe[eq][key] = { matricule: r.matricule, nom: r.nom || r.matricule, jh: 0 };
                workersByEquipe[eq][key].jh += 1;
            });

            const equipeTransport = transportEquipes.map(t => {
                const dailyCosts = allDates.map(d => {
                    const workers = dailyByEquipe[d]?.[t.prefix]?.size || 0;
                    return { date: d, workers, cout: workers * (coutMap[t.prefix] || 0) };
                });
                const totalWorkerDays = dailyCosts.reduce((s, dc) => s + dc.workers, 0);
                const totalCout = dailyCosts.reduce((s, dc) => s + dc.cout, 0);
                const workerList = Object.values(workersByEquipe[t.prefix] || {}).sort((a, b) => b.jh - a.jh);
                const coutResolu = coutMap[t.prefix] || 0;
                return { ...t, coutResolu, dailyCosts, totalWorkerDays, totalCout, workerList };
            });

            const grandTotalCout = equipeTransport.reduce((s, e) => s + e.totalCout, 0);
            const grandTotalWorkerDays = equipeTransport.reduce((s, e) => s + e.totalWorkerDays, 0);

            // Daily totals
            const dailyTotals = allDates.map(d => {
                const cout = equipeTransport.reduce((s, e) => {
                    const dc = e.dailyCosts.find(dc => dc.date === d);
                    return s + (dc ? dc.cout : 0);
                }, 0);
                const workers = equipeTransport.reduce((s, e) => {
                    const dc = e.dailyCosts.find(dc => dc.date === d);
                    return s + (dc ? dc.workers : 0);
                }, 0);
                return { date: d, cout, workers };
            });

            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-bus" style={{marginRight:4}}></i>Transport — {currentPeriode}
                        </span>
                        <QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} value={selectedPeriode} onChange={v => setSelectedPeriode(v)} />
                    </div>

                    <div className="kpi-grid" style={{marginBottom:20}}>
                        <KPICard icon="fa-bus" iconClass="berry" value={transportEquipes.length} label="Équipes" />
                        <KPICard icon="fa-users" iconClass="green" value={grandTotalWorkerDays} label="Ouvriers-Jours (Quinzaine)" />
                        <KPICard icon="fa-coins" iconClass="orange" value={Math.round(grandTotalCout).toLocaleString('fr-FR') + ' DH'} label="Coût Transport Quinzaine" />
                        <KPICard icon="fa-calculator" iconClass="blue" value={grandTotalWorkerDays > 0 ? Math.round(grandTotalCout / grandTotalWorkerDays) + ' DH' : '-'} label="Coût Moyen / Ouvrier-Jour" />
                    </div>

                    {/* Coût transport par jour */}
                    <Panel title="Coût Transport par Jour" icon="fa-calendar-day">
                        <div className="table-responsive">
                        <table className="data-table" style={{fontSize:11}}>
                            <thead>
                                <tr>
                                    <th>Équipe</th>
                                    <th>Coût/Ouv.</th>
                                    {allDates.map(d => <th key={d} style={{textAlign:'center',fontSize:9,whiteSpace:'nowrap'}}>{new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</th>)}
                                    <th style={{textAlign:'center',fontWeight:700}}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {equipeTransport.map(e => (
                                    <tr key={e.prefix}>
                                        <td><strong style={{color:'var(--blue)',cursor:'pointer',textDecoration:'underline'}}
                                            onClick={() => setWorkerPopup({ equipe: e.equipe, caporal: e.caporal, cout: e.coutResolu, workers: e.workerList || [] })}>{e.equipe}</strong></td>
                                        <td style={{color:'var(--gray-500)'}}>{e.coutResolu}</td>
                                        {e.dailyCosts.map(dc => (
                                            <td key={dc.date} style={{textAlign:'center',fontSize:10}}>
                                                {dc.workers > 0 ? (
                                                    <div>
                                                        <div style={{fontWeight:600}}>{dc.workers}</div>
                                                        <div style={{fontSize:9,color:'var(--gray-400)'}}>{dc.cout} DH</div>
                                                    </div>
                                                ) : <span style={{color:'var(--gray-200)'}}>-</span>}
                                            </td>
                                        ))}
                                        <td style={{textAlign:'center',fontWeight:700,color:'var(--berry)'}}>
                                            <div>{e.totalWorkerDays} ouv.</div>
                                            <div style={{fontSize:10}}>{Math.round(e.totalCout).toLocaleString()} DH</div>
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                    <td>TOTAL</td>
                                    <td></td>
                                    {dailyTotals.map(dt => (
                                        <td key={dt.date} style={{textAlign:'center',fontSize:10}}>
                                            <div>{dt.workers}</div>
                                            <div style={{fontSize:9,color:'var(--berry)'}}>{Math.round(dt.cout).toLocaleString()} DH</div>
                                        </td>
                                    ))}
                                    <td style={{textAlign:'center',color:'var(--berry)',fontSize:13}}>
                                        {Math.round(grandTotalCout).toLocaleString()} DH
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        </div>
                    </Panel>

                    {/* Popup détail ouvriers */}
                    {workerPopup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setWorkerPopup(null)}>
                            <div style={{background:'#fff',borderRadius:12,maxWidth:600,width:'100%',maxHeight:'80vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 20px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div>
                                        <h3 style={{margin:0,fontSize:16,color:'var(--berry)'}}><i className="fa-solid fa-users" style={{marginRight:8}}></i>{workerPopup.equipe}</h3>
                                        <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Caporal: {workerPopup.caporal} — {workerPopup.cout} DH/ouvrier</div>
                                    </div>
                                    <button onClick={() => setWorkerPopup(null)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--gray-400)'}}>&times;</button>
                                </div>
                                <div style={{padding:'12px 20px'}}>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Matricule</th>
                                                <th>Ouvrier</th>
                                                <th style={{textAlign:'center'}}>JH</th>
                                                <th style={{textAlign:'right'}}>Coût (DH)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workerPopup.workers.map((w, i) => (
                                                <tr key={w.matricule}>
                                                    <td style={{color:'var(--gray-400)'}}>{i + 1}</td>
                                                    <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                                                    <td><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                                    <td style={{textAlign:'center'}}>{w.jh}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,color:'var(--berry)'}}>{(w.jh * workerPopup.cout).toLocaleString('fr-FR')} DH</td>
                                                </tr>
                                            ))}
                                            <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                                <td></td>
                                                <td>TOTAL</td>
                                                <td>{workerPopup.workers.length} ouvriers</td>
                                                <td style={{textAlign:'center'}}>{workerPopup.workers.reduce((s, w) => s + w.jh, 0)}</td>
                                                <td style={{textAlign:'right',color:'var(--berry)'}}>{(workerPopup.workers.reduce((s, w) => s + w.jh, 0) * workerPopup.cout).toLocaleString('fr-FR')} DH</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { TransportSub };
