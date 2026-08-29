/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): SuiviPointageTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== SUIVI POINTAGE =====================
        function SuiviPointageTab({ currentProfile, profileData }) {
            const [periodes, setPeriodes] = useState([]);
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const [dates, setDates] = useState([]);
            const [validations, setValidations] = useState({});
            const [comparisons, setComparisons] = useState([]);
            const [loading, setLoading] = useState(true);
            const [loadingComparison, setLoadingComparison] = useState(false);
            const [selectedCell, setSelectedCell] = useState(null);
            const FERMES = ['F1', 'F5', 'Avocatier'];

            const dayNames = { 0: 'Dim', 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam' };

            const loadData = async (periode) => {
                setLoading(true);
                try {
                    const url = '/api/validation?action=quinzaine-status' + (periode ? '&periode=' + encodeURIComponent(periode) : '');
                    const r = await fetch(url);
                    const json = await r.json();
                    if (json.success) {
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        setSelectedPeriode(json.selectedPeriode || '');
                        setDates(json.dates || []);
                        setValidations(json.validations || {});
                    }
                } catch (e) { console.error('Suivi pointage load error', e); }
                setLoading(false);
            };

            const loadComparison = async (periode) => {
                setLoadingComparison(true);
                try {
                    const url = '/api/validation?action=sql-comparison' + (periode ? '&periode=' + encodeURIComponent(periode) : '');
                    const r = await fetch(url);
                    const json = await r.json();
                    if (json.success) setComparisons(json.comparisons || []);
                } catch (e) { console.error('Comparison load error', e); }
                setLoadingComparison(false);
            };

            useEffect(() => { loadData(); }, []);
            useEffect(() => {
                if (selectedPeriode) loadComparison(selectedPeriode);
            }, [selectedPeriode]);

            const handlePeriodeChange = (p) => {
                setSelectedPeriode(p);
                loadData(p);
            };

            const getStatus = (dateStr, ferme) => {
                const v = validations[dateStr] && validations[dateStr][ferme];
                if (!v) return { status: 'attente_rh', label: 'En attente RH', css: 'suivi-cell-red', icon: 'fa-clock' };
                if (v.rejected) return { status: 'rejete', label: 'Refusé (' + (v.rejectionRole || '') + ')', css: 'suivi-cell-rejected', icon: 'fa-times-circle', detail: v.rejectionComment };
                if (v.visaChef && v.locked) return { status: 'valide', label: 'Validé Chef', css: 'suivi-cell-green', icon: 'fa-check-circle' };
                if (v.visaCaporal) return { status: 'attente_chef', label: 'En attente Chef', css: 'suivi-cell-yellow', icon: 'fa-hourglass-half' };
                if (v.visaRH) return { status: 'attente_caporal', label: 'En attente Caporal', css: 'suivi-cell-orange', icon: 'fa-hourglass-start' };
                return { status: 'attente_rh', label: 'En attente RH', css: 'suivi-cell-red', icon: 'fa-clock' };
            };

            const formatDate = (d) => {
                const dt = new Date(d + 'T00:00:00');
                const day = dayNames[dt.getDay()] || '';
                return day + ' ' + dt.getDate().toString().padStart(2, '0') + '/' + (dt.getMonth() + 1).toString().padStart(2, '0');
            };

            // Stats
            const totalCells = dates.length * FERMES.length;
            const greenCount = dates.reduce((s, d) => s + FERMES.filter(f => getStatus(d, f).status === 'valide').length, 0);
            const rejectedCount = dates.reduce((s, d) => s + FERMES.filter(f => getStatus(d, f).status === 'rejete').length, 0);
            const pendingCount = totalCells - greenCount - rejectedCount;
            // Pièces jointes manquantes = validations Caporal sans pieceJointeUrl
            const missingPJ = dates.reduce((s, d) => {
                return s + FERMES.filter(f => {
                    const v = validations[d] && validations[d][f];
                    return v && v.visaCaporal && !v.pieceJointeUrl;
                }).length;
            }, 0);

            return (
                <div className="tab-content">
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:12}}>
                        <h2 style={{margin:0, fontSize:18, fontWeight:700, color:'var(--dark)'}}>
                            <i className="fa-solid fa-clipboard-check" style={{marginRight:8, color:'var(--berry)'}}></i>
                            Suivi Pointage
                        </h2>
                        <div style={{display:'flex', alignItems:'center', gap:8}}>
                            <label style={{fontSize:12, fontWeight:600, color:'var(--gray-600)'}}>Quinzaine:</label>
                            <window.QuinzaineCampagneSelect className="filter-select" periodes={periodes} periodeCampagne={periodeCampagne} value={selectedPeriode} onChange={v => handlePeriodeChange(v)} style={{padding:'6px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:13, fontWeight:600}} />
                            <button onClick={() => loadData(selectedPeriode)} style={{padding:'6px 12px', borderRadius:8, border:'1px solid var(--gray-200)', background:'#fff', cursor:'pointer', fontSize:12}}>
                                <i className="fa-solid fa-refresh"></i>
                            </button>
                        </div>
                    </div>

                    {/* KPI Summary */}
                    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:20}}>
                        <div className="panel" style={{padding:14, textAlign:'center'}}>
                            <div style={{fontSize:24, fontWeight:700, color:'var(--green)'}}>{greenCount}</div>
                            <div style={{fontSize:11, color:'var(--gray-600)', fontWeight:600}}>Validés</div>
                        </div>
                        <div className="panel" style={{padding:14, textAlign:'center'}}>
                            <div style={{fontSize:24, fontWeight:700, color:'var(--orange)'}}>{pendingCount}</div>
                            <div style={{fontSize:11, color:'var(--gray-600)', fontWeight:600}}>En attente</div>
                        </div>
                        <div className="panel" style={{padding:14, textAlign:'center'}}>
                            <div style={{fontSize:24, fontWeight:700, color:'var(--red)'}}>{rejectedCount}</div>
                            <div style={{fontSize:11, color:'var(--gray-600)', fontWeight:600}}>Refusés</div>
                        </div>
                        <div className="panel" style={{padding:14, textAlign:'center'}}>
                            <div style={{fontSize:24, fontWeight:700, color: missingPJ > 0 ? 'var(--orange)' : 'var(--green)'}}>{missingPJ}</div>
                            <div style={{fontSize:11, color:'var(--gray-600)', fontWeight:600}}>PJ manquantes</div>
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="suivi-legend" style={{marginBottom:16}}>
                        <div className="suivi-legend-item"><div className="suivi-legend-dot" style={{background:'rgba(231,76,60,0.3)'}}></div> En attente RH</div>
                        <div className="suivi-legend-item"><div className="suivi-legend-dot" style={{background:'rgba(243,156,18,0.3)'}}></div> En attente Caporal</div>
                        <div className="suivi-legend-item"><div className="suivi-legend-dot" style={{background:'rgba(255,193,7,0.35)'}}></div> En attente Chef</div>
                        <div className="suivi-legend-item"><div className="suivi-legend-dot" style={{background:'rgba(45,139,78,0.3)'}}></div> Validé</div>
                        <div className="suivi-legend-item"><div className="suivi-legend-dot" style={{background:'rgba(231,76,60,0.45)'}}></div> Refusé</div>
                    </div>

                    {/* Validation Grid */}
                    <div className="panel" style={{padding:0, overflow:'hidden', marginBottom:24}}>
                        {loading ? (
                            <div style={{padding:40, textAlign:'center', color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{fontSize:24}}></i>
                                <div style={{marginTop:8, fontSize:13}}>Chargement...</div>
                            </div>
                        ) : dates.length === 0 ? (
                            <div style={{padding:40, textAlign:'center', color:'var(--gray-400)', fontSize:13}}>Aucune donnée pour cette quinzaine</div>
                        ) : (
                            <table className="suivi-grid">
                                <thead>
                                    <tr>
                                        <th style={{textAlign:'left', minWidth:100}}>Date</th>
                                        {FERMES.map(f => <th key={f}>{f}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {dates.map(d => (
                                        <tr key={d}>
                                            <td>{formatDate(d)}</td>
                                            {FERMES.map(f => {
                                                const st = getStatus(d, f);
                                                return (
                                                    <td key={f} className={st.css} onClick={() => setSelectedCell({ date: d, ferme: f })}
                                                        title={st.label + (st.detail ? ' — ' + st.detail : '')}>
                                                        <i className={'fa-solid ' + st.icon} style={{marginRight:4, fontSize:11}}></i>
                                                        {st.label}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Cell Detail Modal */}
                    {selectedCell && (() => {
                        const v = validations[selectedCell.date] && validations[selectedCell.date][selectedCell.ferme];
                        const st = getStatus(selectedCell.date, selectedCell.ferme);
                        const fmtTs = (ts) => ts ? new Date(ts).toLocaleString('fr-FR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.35)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}
                                onClick={() => setSelectedCell(null)}>
                                <div style={{background:'#fff',borderRadius:12,padding:24,maxWidth:420,width:'90%',boxShadow:'0 8px 32px rgba(0,0,0,0.15)'}}
                                    onClick={e => e.stopPropagation()}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                        <h3 style={{margin:0,fontSize:16,fontWeight:700}}>
                                            {formatDate(selectedCell.date)} — {selectedCell.ferme}
                                        </h3>
                                        <span className={'status-badge ' + (st.status === 'valide' ? 'valide' : st.status === 'rejete' ? 'rejete' : 'en-attente')}>
                                            {st.label}
                                        </span>
                                    </div>
                                    <div style={{display:'flex',flexDirection:'column',gap:10}}>
                                        {/* Visa RH */}
                                        <div style={{padding:10,borderRadius:8,background: v && v.visaRH ? 'var(--green-pale)' : 'var(--gray-100)'}}>
                                            <div style={{fontSize:11,fontWeight:700,color:'var(--gray-600)',marginBottom:4}}>
                                                <i className="fa-solid fa-user-tie" style={{marginRight:4}}></i>VISA RH
                                            </div>
                                            {v && v.visaRH ? (
                                                <div style={{fontSize:12}}>
                                                    <div>Par: <strong>{v.visaRH.validatedBy}</strong></div>
                                                    <div>Le: {fmtTs(v.visaRH.validatedAt)}</div>
                                                    {v.visaRH.comment && <div style={{marginTop:4,fontStyle:'italic',color:'var(--gray-600)'}}>"{v.visaRH.comment}"</div>}
                                                    {v.workerCount > 0 && <div style={{marginTop:2}}>Effectif: <strong>{v.workerCount}</strong></div>}
                                                </div>
                                            ) : <div style={{fontSize:12,color:'var(--gray-400)'}}>Non soumis</div>}
                                        </div>
                                        {/* Visa Caporal */}
                                        <div style={{padding:10,borderRadius:8,background: v && v.visaCaporal ? 'var(--green-pale)' : 'var(--gray-100)'}}>
                                            <div style={{fontSize:11,fontWeight:700,color:'var(--gray-600)',marginBottom:4}}>
                                                <i className="fa-solid fa-user-shield" style={{marginRight:4}}></i>VISA CAPORAL
                                            </div>
                                            {v && v.visaCaporal ? (
                                                <div style={{fontSize:12}}>
                                                    <div>Par: <strong>{v.visaCaporal.validatedBy}</strong></div>
                                                    <div>Le: {fmtTs(v.visaCaporal.validatedAt)}</div>
                                                    {v.visaCaporal.comment && <div style={{marginTop:4,fontStyle:'italic',color:'var(--gray-600)'}}>"{v.visaCaporal.comment}"</div>}
                                                    {v.pieceJointeUrl ? (
                                                        <div style={{marginTop:4}}>
                                                            <a href={v.pieceJointeUrl} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)',fontSize:11,fontWeight:600}}>
                                                                <i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>
                                                                {v.pieceJointeFilename || 'Pièce jointe'}
                                                            </a>
                                                        </div>
                                                    ) : (
                                                        <div style={{marginTop:4,color:'var(--orange)',fontSize:11,fontWeight:600}}>
                                                            <i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>PJ manquante
                                                        </div>
                                                    )}
                                                </div>
                                            ) : <div style={{fontSize:12,color:'var(--gray-400)'}}>Non validé</div>}
                                        </div>
                                        {/* Visa Chef */}
                                        <div style={{padding:10,borderRadius:8,background: v && v.visaChef ? 'var(--green-pale)' : 'var(--gray-100)'}}>
                                            <div style={{fontSize:11,fontWeight:700,color:'var(--gray-600)',marginBottom:4}}>
                                                <i className="fa-solid fa-user-check" style={{marginRight:4}}></i>VISA CHEF DE FERME
                                            </div>
                                            {v && v.visaChef ? (
                                                <div style={{fontSize:12}}>
                                                    <div>Par: <strong>{v.visaChef.validatedBy}</strong></div>
                                                    <div>Le: {fmtTs(v.visaChef.validatedAt)}</div>
                                                    {v.visaChef.comment && <div style={{marginTop:4,fontStyle:'italic',color:'var(--gray-600)'}}>"{v.visaChef.comment}"</div>}
                                                </div>
                                            ) : <div style={{fontSize:12,color:'var(--gray-400)'}}>Non validé</div>}
                                        </div>
                                        {/* Rejection info */}
                                        {v && v.rejected && (
                                            <div style={{padding:10,borderRadius:8,background:'var(--red-pale)',border:'1px solid rgba(231,76,60,0.2)'}}>
                                                <div style={{fontSize:11,fontWeight:700,color:'var(--red)',marginBottom:4}}>
                                                    <i className="fa-solid fa-ban" style={{marginRight:4}}></i>REFUS
                                                </div>
                                                <div style={{fontSize:12}}>
                                                    <div>Par: <strong>{v.rejectedBy}</strong> ({v.rejectionRole})</div>
                                                    <div>Le: {fmtTs(v.rejectedAt)}</div>
                                                    <div style={{marginTop:4,fontWeight:600}}>Motif: {v.rejectionComment || '—'}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{marginTop:16,textAlign:'right'}}>
                                        <button onClick={() => setSelectedCell(null)}
                                            style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                            Fermer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* SQL vs Firebase Comparison */}
                    <div style={{marginBottom:8}}>
                        <h3 style={{fontSize:15,fontWeight:700,color:'var(--dark)',margin:'0 0 12px 0'}}>
                            <i className="fa-solid fa-code-compare" style={{marginRight:8,color:'var(--blue)'}}></i>
                            Comparaison SQL vs Snapshot (journées bouclées)
                        </h3>
                    </div>
                    <div className="panel" style={{padding:0, overflow:'hidden'}}>
                        {loadingComparison ? (
                            <div style={{padding:30,textAlign:'center',color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin"></i> Chargement...
                            </div>
                        ) : comparisons.length === 0 ? (
                            <div style={{padding:30,textAlign:'center',color:'var(--gray-400)',fontSize:13}}>
                                Aucune journée bouclée (validée par le Chef) pour cette quinzaine
                            </div>
                        ) : (
                            <table className="data-table" style={{width:'100%'}}>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Ferme</th>
                                        <th>Lignes SQL</th>
                                        <th>Lignes Snapshot</th>
                                        <th>Coût SQL</th>
                                        <th>Coût Snapshot</th>
                                        <th>Statut</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {comparisons.map((c, i) => (
                                        <tr key={i} style={{background: c.match ? undefined : 'var(--red-pale)'}}>
                                            <td>{formatDate(c.date)}</td>
                                            <td><strong>{c.ferme}</strong></td>
                                            <td style={{textAlign:'center'}}>{c.sql.rowCount}</td>
                                            <td style={{textAlign:'center',fontWeight: c.sql.rowCount !== c.snapshot.rowCount ? 700 : 400,
                                                color: c.sql.rowCount !== c.snapshot.rowCount ? 'var(--red)' : undefined}}>
                                                {c.snapshot.rowCount}
                                            </td>
                                            <td style={{textAlign:'right'}}>{c.sql.totalCout.toLocaleString('fr-FR', {minimumFractionDigits:2})} DH</td>
                                            <td style={{textAlign:'right',fontWeight: Math.abs(c.sql.totalCout - c.snapshot.totalCout) >= 1 ? 700 : 400,
                                                color: Math.abs(c.sql.totalCout - c.snapshot.totalCout) >= 1 ? 'var(--red)' : undefined}}>
                                                {c.snapshot.totalCout.toLocaleString('fr-FR', {minimumFractionDigits:2})} DH
                                            </td>
                                            <td style={{textAlign:'center'}}>
                                                {c.match ? (
                                                    <span className="status-badge valide"><i className="fa-solid fa-check" style={{marginRight:4}}></i>OK</span>
                                                ) : (
                                                    <span className="status-badge rejete"><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>Écart</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            );
        }

export { SuiviPointageTab };
