/* Module: rh | Déclaration(s): PointageDiversTab */
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { FONCTIONS_ENUM } from './FONCTIONS_ENUM.jsx';

import { QuinzaineCampagneSelect } from '../shared/QuinzaineCampagneSelect.jsx';
function PointageDiversTab({ currentProfile }) {
            const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
            const [configItems, setConfigItems] = useState([]);
            const [entries, setEntries] = useState([]);
            const [visaStatus, setVisaStatus] = useState({});
            const [entriesByDate, setEntriesByDate] = useState({}); // cache { [date]: { entries, visa } }
            const [loadingDate, setLoadingDate] = useState(true);   // spinner localisé du tableau des entrées
            const [saving, setSaving] = useState(false);
            const [visaLoading, setVisaLoading] = useState(false);
            const [showSubmitModal, setShowSubmitModal] = useState(false);
            const [showRejectModal, setShowRejectModal] = useState(false);
            const [rejectRole, setRejectRole] = useState('');
            const [rejectComment, setRejectComment] = useState('');
            const [showCaporalModal, setShowCaporalModal] = useState(false);
            const [caporalFile, setCaporalFile] = useState(null);
            const [savedMsg, setSavedMsg] = useState('');
            const [viewMode, setViewMode] = useState('jour'); // 'jour' | 'quinzaine'
            const [qzPeriodes, setQzPeriodes] = useState([]);
            const [qzPeriodeCampagne, setQzPeriodeCampagne] = useState({});
            const [qzSelected, setQzSelected] = useState('');
            const [qzData, setQzData] = useState({ dates: [], byDate: {} });
            const [qzLoading, setQzLoading] = useState(false);

            const isRH = currentProfile === 'rh';
            const isDG = currentProfile === 'dg';
            const isCaporal = currentProfile && currentProfile.startsWith('caporal_');
            const isChef = currentProfile && currentProfile.startsWith('chef_');

            const shiftDate = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

            // Config (transporteurs) : chargée UNE seule fois, indépendante de la date.
            const loadConfig = () => {
                fetch('/api/validation?action=divers-config').then(r => r.json())
                    .then(res => { if (res.success) setConfigItems(res.items || []); })
                    .catch(err => console.warn('Divers config load error:', err));
            };

            // Entrées + visa d'une date → cache. activate=true alimente la vue active.
            const loadDate = (date, opts = {}) => Promise.all([
                fetch('/api/validation?action=divers-entries&date=' + date).then(r => r.json()),
                fetch('/api/validation?action=status&date=' + date + '&ferme=DIVERS').then(r => r.json()),
            ]).then(([entriesRes, visaRes]) => {
                const snap = {
                    entries: entriesRes.success ? (entriesRes.data?.entries || []) : [],
                    visa: visaRes.success ? (visaRes.validation || {}) : {},
                };
                setEntriesByDate(prev => ({ ...prev, [date]: snap }));
                if (opts.activate) { setEntries(snap.entries); setVisaStatus(snap.visa); }
                return snap;
            }).catch(err => { console.warn('Divers loadDate error:', err); return null; });

            const preloadNeighbors = (d) => {
                [shiftDate(d, -1), shiftDate(d, 1)].forEach(nd => { if (!entriesByDate[nd]) loadDate(nd); });
            };
            const refreshActiveDate = () => loadDate(selectedDate, { activate: true });

            React.useEffect(() => {
                loadConfig();
                setLoadingDate(true);
                loadDate(selectedDate, { activate: true }).finally(() => setLoadingDate(false));
                preloadNeighbors(selectedDate);
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);

            // Changement de date : bascule instantanée si en cache (préchargé), sinon spinner localisé.
            const handleDateChange = (d) => {
                setSelectedDate(d); setSavedMsg('');
                const cached = entriesByDate[d];
                if (cached) {
                    setEntries(cached.entries); setVisaStatus(cached.visa); setLoadingDate(false);
                } else {
                    setLoadingDate(true);
                    loadDate(d, { activate: true }).finally(() => setLoadingDate(false));
                }
                preloadNeighbors(d);
            };

            // Vue quinzaine : récap lecture seule de tout le pointage divers d'une quinzaine.
            const loadQuinzaine = (periode) => {
                setQzLoading(true);
                const url = '/api/validation?action=divers-entries-range' + (periode ? '&periode=' + encodeURIComponent(periode) : '&date=' + selectedDate);
                fetch(url).then(r => r.json()).then(json => {
                    if (json && json.success) {
                        setQzPeriodes(json.periodes || []);
                        setQzPeriodeCampagne(json.periodeCampagne || {});
                        setQzSelected(json.periode || '');
                        setQzData({ dates: json.dates || [], byDate: json.byDate || {} });
                    }
                }).catch(err => console.warn('Divers quinzaine load error:', err)).finally(() => setQzLoading(false));
            };
            const enterQuinzaineView = () => { setViewMode('quinzaine'); if (qzData.dates.length === 0) loadQuinzaine(qzSelected || null); };


            // --- Entries ---
            const isLocked = !!visaStatus.locked;
            const hasRH = !!visaStatus.visaRH;
            const hasCap = !!visaStatus.visaCaporal;
            const hasChef = !!visaStatus.visaChef;
            const isRejected = !!visaStatus.rejected;

            const addEntry = () => {
                setSavedMsg('');
                setEntries([...entries, { configId: '', beneficiaire: '', matricule: '', fonction: '', tache: '', quantite: 1, prixUnitaire: 0, unite: '', montant: 0, commentaire: '' }]);
            };
            const updateEntry = (idx, field, value) => {
                setSavedMsg('');
                const newEntries = [...entries];
                if (field === 'configId') {
                    const cfg = configItems.find(c => c.id === value);
                    if (cfg) {
                        newEntries[idx] = { ...newEntries[idx], configId: value, beneficiaire: cfg.beneficiaire, matricule: cfg.matricule || '', fonction: cfg.fonction, tache: cfg.tache, prixUnitaire: cfg.prixUnitaire, unite: cfg.unite, montant: (newEntries[idx].quantite || 1) * cfg.prixUnitaire };
                    }
                } else if (field === 'quantite') {
                    const q = Number(value) || 0;
                    newEntries[idx] = { ...newEntries[idx], quantite: q, montant: Math.round(q * newEntries[idx].prixUnitaire * 100) / 100 };
                } else {
                    newEntries[idx] = { ...newEntries[idx], [field]: value };
                }
                setEntries(newEntries);
            };
            const removeEntry = (idx) => { setSavedMsg(''); setEntries(entries.filter((_, i) => i !== idx)); };

            const saveEntries = () => {
                setSaving(true); setSavedMsg('');
                fetch('/api/validation?action=divers-entries-save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ date: selectedDate, entries, profileId: currentProfile }) })
                    .then(r => r.json()).then(res => { if (!res.success) alert(res.error || 'Erreur'); else { setSavedMsg('✓ Pointage enregistré'); refreshActiveDate(); } })
                    .catch(err => alert('Erreur: ' + err.message))
                    .finally(() => setSaving(false));
            };

            const totalMontant = Math.round(entries.reduce((s, e) => s + ((Number(e.quantite) || 0) * (Number(e.prixUnitaire) || 0)), 0) * 100) / 100;

            // --- Validation ---
            const handleValidate = (role) => {
                setVisaLoading(true);
                const body = { date: selectedDate, ferme: 'DIVERS', role, profileId: currentProfile };
                if (role === 'caporal' && caporalFile) {
                    // Upload file first
                    const formData = new FormData();
                    formData.append('file', caporalFile);
                    formData.append('date', selectedDate);
                    formData.append('ferme', 'DIVERS');
                    fetch('/api/validation?action=upload-attachment', { method: 'POST', body: formData })
                        .then(r => r.json()).then(upRes => {
                            if (upRes.success) {
                                body.pieceJointeUrl = upRes.url;
                                body.pieceJointeFilename = upRes.filename || caporalFile.name;
                                return fetch('/api/validation?action=validate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.json());
                            } else { throw new Error(upRes.error || 'Upload failed'); }
                        }).then(res => { if (res.success) { setShowCaporalModal(false); refreshActiveDate(); } else alert(res.error); })
                        .catch(err => alert('Erreur: ' + err.message)).finally(() => setVisaLoading(false));
                    return;
                }
                fetch('/api/validation?action=validate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
                    .then(r => r.json()).then(res => { if (res.success) refreshActiveDate(); else alert(res.error); })
                    .catch(err => alert('Erreur: ' + err.message)).finally(() => setVisaLoading(false));
            };

            const handleReject = () => {
                if (!rejectComment.trim()) { alert('Commentaire obligatoire'); return; }
                setVisaLoading(true);
                fetch('/api/validation?action=reject', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ date: selectedDate, ferme: 'DIVERS', role: rejectRole, profileId: currentProfile, comment: rejectComment }) })
                    .then(r => r.json()).then(res => { if (res.success) { setShowRejectModal(false); refreshActiveDate(); } else alert(res.error); })
                    .catch(err => alert('Erreur: ' + err.message)).finally(() => setVisaLoading(false));
            };

            const handleUnlock = () => {
                if (!confirm('Déverrouiller le pointage divers ?')) return;
                setVisaLoading(true);
                fetch('/api/validation?action=unlock', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ date: selectedDate, ferme: 'DIVERS', profileId: currentProfile }) })
                    .then(r => r.json()).then(res => { if (res.success) refreshActiveDate(); else alert(res.error); })
                    .catch(err => alert('Erreur: ' + err.message)).finally(() => setVisaLoading(false));
            };

            // En-tête + barre date toujours rendus ; seul le tableau des entrées affiche un spinner localisé (loadingDate).

            return (
                <div className="fade-in">
                    {/* Header + date picker */}
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'var(--berry-pale)',color:'var(--berry)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-truck" style={{marginRight:4}}></i>Pointage Divers
                        </span>
                        {/* Toggle Vue jour / Vue quinzaine */}
                        <div style={{display:'flex',border:'1px solid var(--gray-200)',borderRadius:8,overflow:'hidden'}}>
                            <button onClick={() => setViewMode('jour')} style={{border:'none',padding:'5px 12px',fontSize:11,fontWeight:600,cursor:'pointer',background:viewMode==='jour'?'var(--berry)':'#fff',color:viewMode==='jour'?'#fff':'var(--gray-600)'}}>
                                <i className="fa-solid fa-calendar-day" style={{marginRight:4}}></i>Vue jour
                            </button>
                            <button onClick={enterQuinzaineView} style={{border:'none',padding:'5px 12px',fontSize:11,fontWeight:600,cursor:'pointer',background:viewMode==='quinzaine'?'var(--berry)':'#fff',color:viewMode==='quinzaine'?'#fff':'var(--gray-600)'}}>
                                <i className="fa-solid fa-table-cells" style={{marginRight:4}}></i>Vue quinzaine
                            </button>
                        </div>
                        {viewMode === 'jour' && (
                        <React.Fragment>
                        <span style={{fontSize:11,fontWeight:600,color:'var(--gray-500)'}}>Jour pointé :</span>
                        <div style={{display:'flex',alignItems:'center',gap:4,background:'#fff',border:'1px solid var(--gray-200)',borderRadius:8,padding:'2px 4px'}}>
                            <button onClick={() => { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() - 1); handleDateChange(d.toISOString().slice(0,10)); }}
                                title="Jour précédent" style={{border:'none',background:'none',cursor:'pointer',color:'var(--berry)',padding:'4px 8px',fontSize:13}}><i className="fa-solid fa-chevron-left"></i></button>
                            <input type="date" value={selectedDate} onChange={e => handleDateChange(e.target.value)}
                                style={{padding:'4px 6px',borderRadius:6,border:'none',fontSize:12,fontWeight:600,color:'var(--berry)'}} />
                            <button onClick={() => { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + 1); handleDateChange(d.toISOString().slice(0,10)); }}
                                title="Jour suivant" style={{border:'none',background:'none',cursor:'pointer',color:'var(--berry)',padding:'4px 8px',fontSize:13}}><i className="fa-solid fa-chevron-right"></i></button>
                        </div>
                        <button onClick={() => handleDateChange(new Date().toISOString().slice(0,10))}
                            style={{padding:'5px 12px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',cursor:'pointer',fontSize:11,fontWeight:600,color:'var(--gray-600)'}}>
                            <i className="fa-solid fa-calendar-day" style={{marginRight:4}}></i>Aujourd'hui
                        </button>
                        </React.Fragment>
                        )}
                    </div>

                    {/* Vue quinzaine (récap lecture seule) */}
                    {viewMode === 'quinzaine' && (() => {
                        const dates = qzData.dates || [];
                        const bySt = {};
                        dates.forEach(d => {
                            ((qzData.byDate[d] || {}).entries || []).forEach(e => {
                                const key = (e.matricule || e.beneficiaire || '?') + '|' + (e.fonction || '');
                                if (!bySt[key]) bySt[key] = { matricule: e.matricule || '', beneficiaire: e.beneficiaire || '', fonction: e.fonction || '', unite: e.unite || '', byDay: {}, totQ: 0, totM: 0 };
                                const cur = bySt[key].byDay[d] || { q: 0, m: 0 };
                                cur.q += Number(e.quantite) || 0; cur.m += Number(e.montant) || 0;
                                bySt[key].byDay[d] = cur;
                                bySt[key].totQ += Number(e.quantite) || 0; bySt[key].totM += Number(e.montant) || 0;
                            });
                        });
                        const rows = Object.values(bySt).sort((a, b) => b.totM - a.totM);
                        const dailyTot = dates.map(d => rows.reduce((s, r) => s + ((r.byDay[d] && r.byDay[d].m) || 0), 0));
                        const grandTot = rows.reduce((s, r) => s + r.totM, 0);
                        const fmtD = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
                        return (
                            <Panel title="Récapitulatif quinzaine — Pointage Divers" icon="fa-table-cells">
                                <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                                    <span style={{fontSize:11,fontWeight:600,color:'var(--gray-500)'}}>Quinzaine :</span>
                                    <QuinzaineCampagneSelect periodes={qzPeriodes} periodeCampagne={qzPeriodeCampagne} value={qzSelected} onChange={v => loadQuinzaine(v)} />
                                    {qzLoading && <span style={{fontSize:11,color:'var(--berry)'}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Chargement…</span>}
                                </div>
                                <div className="table-responsive">
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead>
                                        <tr>
                                            <th>Jour</th>
                                            {rows.map((r, i) => (
                                                <th key={i} style={{textAlign:'center'}}>
                                                    {r.beneficiaire || r.matricule || '—'}
                                                    <div style={{fontSize:9,fontWeight:400,color:'var(--gray-400)'}}>{r.fonction || '—'}{r.matricule ? ' · ' + r.matricule : ''}</div>
                                                </th>
                                            ))}
                                            <th style={{textAlign:'center',fontWeight:700}}>Total jour</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {dates.map((d, di) => (
                                            <tr key={d}>
                                                <td style={{fontWeight:600,whiteSpace:'nowrap'}}>{new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</td>
                                                {rows.map((r, i) => {
                                                    const c = r.byDay[d];
                                                    if (!c || (!c.q && !c.m)) return <td key={i} style={{textAlign:'center',color:'var(--gray-200)'}}>-</td>;
                                                    return <td key={i} style={{textAlign:'center',fontSize:10}}><div style={{fontWeight:600}}>{c.q}</div><div style={{fontSize:9,color:'var(--gray-400)'}}>{Math.round(c.m).toLocaleString('fr-FR')} DH</div></td>;
                                                })}
                                                <td style={{textAlign:'center',fontWeight:700,color:dailyTot[di]>0?'var(--berry)':'var(--gray-300)'}}>{dailyTot[di] > 0 ? Math.round(dailyTot[di]).toLocaleString('fr-FR') + ' DH' : '-'}</td>
                                            </tr>
                                        ))}
                                        {rows.length === 0 && <tr><td colSpan={2} style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucun pointage divers sur cette quinzaine.</td></tr>}
                                    </tbody>
                                    {rows.length > 0 && (
                                        <tfoot>
                                            <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                                <td style={{textAlign:'right'}}>Total</td>
                                                {rows.map((r, i) => (
                                                    <td key={i} style={{textAlign:'center',fontSize:10,color:'var(--berry)'}}><div>{Math.round(r.totQ*100)/100}</div><div>{Math.round(r.totM).toLocaleString('fr-FR')} DH</div></td>
                                                ))}
                                                <td style={{textAlign:'center',color:'var(--berry)',fontSize:13}}>{Math.round(grandTot).toLocaleString('fr-FR')} DH</td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                                </div>
                            </Panel>
                        );
                    })()}

                    {viewMode === 'jour' && (
                    <React.Fragment>
                    {/* Validation bar */}
                    <div style={{marginBottom:14,padding:'10px 14px',background:'#f8f9fa',borderRadius:10,border:'1px solid var(--gray-200)'}}>
                        <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--gray-600)'}}>
                            <i className="fa-solid fa-stamp" style={{marginRight:6}}></i>Validation Pointage Divers — {selectedDate}
                        </div>
                        <div style={{background:'#fff',borderRadius:8,padding:'8px 12px',border:isLocked ? '2px solid var(--green)' : isRejected ? '2px solid #e74c3c' : '1px solid var(--gray-200)'}}>
                            <div style={{fontWeight:700,fontSize:12,marginBottom:6}}>DIVERS {isLocked && <i className="fa-solid fa-lock" style={{color:'var(--green)',marginLeft:4}}></i>}</div>
                            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                                <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:hasRH?'#d4edda':'#ffeeba',color:hasRH?'#155724':'#856404'}}>
                                    <i className={`fa-solid ${hasRH?'fa-check':'fa-clock'}`} style={{marginRight:3}}></i>RH
                                </span>
                                <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:hasCap?'#d4edda':'#f8d7da',color:hasCap?'#155724':'#721c24'}}>
                                    <i className={`fa-solid ${hasCap?'fa-check':'fa-clock'}`} style={{marginRight:3}}></i>Caporal
                                </span>
                                <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:hasChef?'#d4edda':'#f8d7da',color:hasChef?'#155724':'#721c24'}}>
                                    <i className={`fa-solid ${hasChef?'fa-check':'fa-clock'}`} style={{marginRight:3}}></i>Chef
                                </span>
                            </div>
                            {isRejected && visaStatus.rejectionComment && (
                                <div style={{fontSize:11,color:'#e74c3c',background:'rgba(231,76,60,0.08)',borderRadius:6,padding:'4px 8px',marginBottom:6}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>
                                    <strong>Rejet {visaStatus.rejectionRole === 'chef' ? 'Chef' : 'Caporal'} :</strong> {visaStatus.rejectionComment}
                                </div>
                            )}
                            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                                {isRH && !hasRH && !isLocked && !isRejected && entries.length > 0 && (
                                    <button onClick={() => setShowSubmitModal(true)} disabled={visaLoading}
                                        style={{padding:'4px 10px',borderRadius:6,border:'none',background:'var(--berry)',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-paper-plane" style={{marginRight:4}}></i>Soumettre
                                    </button>
                                )}
                                {isRH && isRejected && (
                                    <button onClick={() => setShowSubmitModal(true)} disabled={visaLoading}
                                        style={{padding:'4px 10px',borderRadius:6,border:'none',background:'#e67e22',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-rotate" style={{marginRight:4}}></i>Re-soumettre
                                    </button>
                                )}
                                {isCaporal && hasRH && !hasCap && !isLocked && (
                                    <button onClick={() => { setCaporalFile(null); setShowCaporalModal(true); }} disabled={visaLoading}
                                        style={{padding:'4px 10px',borderRadius:6,border:'none',background:'#e67e22',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider Caporal
                                    </button>
                                )}
                                {isCaporal && hasRH && !hasCap && !isLocked && (
                                    <button onClick={() => { setRejectRole('caporal'); setRejectComment(''); setShowRejectModal(true); }} disabled={visaLoading}
                                        style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e74c3c',background:'#fff',color:'#e74c3c',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-times" style={{marginRight:4}}></i>Rejeter
                                    </button>
                                )}
                                {isChef && hasCap && !hasChef && !isLocked && (
                                    <button onClick={() => handleValidate('chef')} disabled={visaLoading}
                                        style={{padding:'4px 10px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-check-double" style={{marginRight:4}}></i>Valider Chef
                                    </button>
                                )}
                                {isChef && hasCap && !hasChef && !isLocked && (
                                    <button onClick={() => { setRejectRole('chef'); setRejectComment(''); setShowRejectModal(true); }} disabled={visaLoading}
                                        style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e74c3c',background:'#fff',color:'#e74c3c',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-times" style={{marginRight:4}}></i>Rejeter
                                    </button>
                                )}
                                {(isRH || isDG) && isLocked && (isRejected || isDG) && (
                                    <button onClick={handleUnlock} disabled={visaLoading}
                                        style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--red)',background:'#fff',color:'var(--red)',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-lock-open" style={{marginRight:4}}></i>Déverrouiller
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Submit confirmation modal */}
                    {showSubmitModal && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={() => setShowSubmitModal(false)}>
                            <div style={{background:'white',borderRadius:16,padding:28,width:400,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <h3 style={{fontSize:16,fontWeight:700,color:'var(--berry)',margin:'0 0 16px'}}>
                                    <i className="fa-solid fa-paper-plane" style={{marginRight:8}}></i>Confirmer la soumission
                                </h3>
                                <div style={{background:'#f8f9fa',borderRadius:10,padding:16,marginBottom:16}}>
                                    <div style={{fontSize:13,marginBottom:6}}><strong>Date :</strong> {selectedDate}</div>
                                    <div style={{fontSize:13,marginBottom:6}}><strong>Entrées :</strong> {entries.length}</div>
                                    <div style={{fontSize:13}}><strong>Total :</strong> {totalMontant.toLocaleString('fr-FR')} DH</div>
                                </div>
                                <div style={{fontSize:12,color:'var(--gray-500)',marginBottom:16}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6,color:'#e67e22'}}></i>
                                    Les données seront figées après soumission.
                                </div>
                                <div style={{display:'flex',gap:10}}>
                                    <button onClick={() => { handleValidate('rh'); setShowSubmitModal(false); }} disabled={visaLoading}
                                        style={{flex:1,padding:12,background:'var(--berry)',color:'white',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:6}}></i>Confirmer
                                    </button>
                                    <button onClick={() => setShowSubmitModal(false)} style={{padding:'12px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>Annuler</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Caporal validation modal (file upload) */}
                    {showCaporalModal && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={() => setShowCaporalModal(false)}>
                            <div style={{background:'white',borderRadius:16,padding:28,width:400,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <h3 style={{fontSize:16,fontWeight:700,color:'#e67e22',margin:'0 0 16px'}}>
                                    <i className="fa-solid fa-camera" style={{marginRight:8}}></i>Validation Caporal — Pièce Jointe
                                </h3>
                                <div style={{marginBottom:16}}>
                                    <input type="file" accept="image/*,.pdf" capture="environment" onChange={e => setCaporalFile(e.target.files[0])}
                                        style={{width:'100%',padding:10,border:'2px dashed var(--gray-300)',borderRadius:10,fontSize:12}} />
                                </div>
                                <div style={{display:'flex',gap:10}}>
                                    <button onClick={() => { if (!caporalFile) { alert('Veuillez joindre le scan du pointage papier'); return; } handleValidate('caporal'); }} disabled={visaLoading || !caporalFile}
                                        style={{flex:1,padding:12,background:caporalFile ? '#e67e22' : 'var(--gray-300)',color:'white',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:caporalFile ? 'pointer' : 'not-allowed'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:6}}></i>Valider
                                    </button>
                                    <button onClick={() => setShowCaporalModal(false)} style={{padding:'12px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>Annuler</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Reject modal */}
                    {showRejectModal && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={() => setShowRejectModal(false)}>
                            <div style={{background:'white',borderRadius:16,padding:28,width:400,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <h3 style={{fontSize:16,fontWeight:700,color:'#e74c3c',margin:'0 0 16px'}}>
                                    <i className="fa-solid fa-times-circle" style={{marginRight:8}}></i>Rejeter le pointage
                                </h3>
                                <textarea value={rejectComment} onChange={e => setRejectComment(e.target.value)} placeholder="Motif du rejet (obligatoire)..."
                                    style={{width:'100%',minHeight:80,padding:10,borderRadius:10,border:'1px solid var(--gray-300)',fontSize:12,marginBottom:16,resize:'vertical'}} />
                                <div style={{display:'flex',gap:10}}>
                                    <button onClick={handleReject} disabled={visaLoading || !rejectComment.trim()}
                                        style={{flex:1,padding:12,background:'#e74c3c',color:'white',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer'}}>
                                        <i className="fa-solid fa-times" style={{marginRight:6}}></i>Rejeter
                                    </button>
                                    <button onClick={() => setShowRejectModal(false)} style={{padding:'12px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>Annuler</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Config transporteurs déplacée dans Paramètres */}
                    {isRH && (
                        <div style={{marginBottom:14,fontSize:11,color:'var(--gray-500)',background:'#f8f9fa',border:'1px solid var(--gray-200)',borderRadius:8,padding:'8px 12px'}}>
                            <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--berry)'}}></i>
                            La création/gestion des transporteurs se fait désormais dans <strong>Paramètres → Configuration Sous-traitants</strong>.
                        </div>
                    )}

                    {/* Daily entries */}
                    <Panel title={`Pointage du ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric'})}`} icon="fa-clipboard-list">
                        {loadingDate && <div style={{padding:'6px 0',fontSize:11,color:'var(--berry)',fontWeight:600}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Chargement du jour…</div>}
                        <table className="data-table" style={{fontSize:12, opacity: loadingDate ? 0.5 : 1}}>
                            <thead>
                                <tr>
                                    <th style={{width:30}}>#</th>
                                    <th>Sous-traitant</th>
                                    <th>Fonction</th>
                                    <th>Tâche</th>
                                    <th style={{textAlign:'center',width:70}}>Qté</th>
                                    <th style={{textAlign:'right',width:80}}>Prix Unit.</th>
                                    <th style={{width:70}}>Unité</th>
                                    <th style={{textAlign:'right',width:90}}>Montant</th>
                                    <th style={{width:120}}>Commentaire</th>
                                    {!isLocked && isRH && <th style={{width:40}}></th>}
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((e, idx) => (
                                    <tr key={idx}>
                                        <td style={{color:'var(--gray-400)'}}>{idx + 1}</td>
                                        {isLocked || !isRH || e.fonction === 'TRANSPORT FRUIT' ? (
                                            <React.Fragment>
                                                <td>
                                                    <strong>{e.beneficiaire || <em style={{color:'var(--gray-400)'}}>(à compléter)</em>}</strong>
                                                    {e.matricule && <span style={{marginLeft:6,fontSize:10,fontFamily:'monospace',color:'var(--gray-500)'}}>[{e.matricule}]</span>}
                                                    {e.fonction === 'TRANSPORT FRUIT' && <span style={{marginLeft:6,fontSize:9,fontWeight:700,color:'#2D8B4E',background:'rgba(45,139,78,0.1)',padding:'1px 6px',borderRadius:8}} title="Alimenté automatiquement depuis les bons d'apport"><i className="fa-solid fa-bolt" style={{marginRight:2}}></i>auto</span>}
                                                </td>
                                                <td>{e.fonction}</td>
                                                <td>{e.tache}</td>
                                                <td style={{textAlign:'center'}}>{e.quantite}</td>
                                                <td style={{textAlign:'right'}}>{Number(e.prixUnitaire).toLocaleString('fr-FR')} DH</td>
                                                <td>{e.unite}</td>
                                            </React.Fragment>
                                        ) : (
                                            <React.Fragment>
                                                <td colSpan="3">
                                                    <select value={e.configId} onChange={ev => updateEntry(idx, 'configId', ev.target.value)}
                                                        style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                                                        <option value="">-- Sélectionner --</option>
                                                        {/* Transport Fruit exclu : alimenté automatiquement par les bons d'apport */}
                                                        {FONCTIONS_ENUM.filter(f => f.key !== 'TRANSPORT FRUIT').map(f => {
                                                            const groupItems = configItems.filter(c => c.fonction === f.key);
                                                            if (groupItems.length === 0) return null;
                                                            return (
                                                                <optgroup key={f.key} label={f.label}>
                                                                    {groupItems.map(c => <option key={c.id} value={c.id}>{c.matricule ? `[${c.matricule}] ` : ''}{c.beneficiaire || '(sans nom)'} — {c.tache} ({c.prixUnitaire} DH/{c.unite})</option>)}
                                                                </optgroup>
                                                            );
                                                        })}
                                                        {configItems.filter(c => !FONCTIONS_ENUM.some(f => f.key === c.fonction)).map(c => (
                                                            <option key={c.id} value={c.id}>{c.matricule ? `[${c.matricule}] ` : ''}{c.beneficiaire || '(sans nom)'} — {c.fonction} — {c.tache} ({c.prixUnitaire} DH/{c.unite})</option>
                                                        ))}
                                                        {/* Fallback : garde la sélection visible si la config n'est pas (encore) chargée ou a été supprimée */}
                                                        {e.configId && !configItems.some(c => c.id === e.configId) && (
                                                            <option value={e.configId}>{e.matricule ? `[${e.matricule}] ` : ''}{e.beneficiaire || '(sous-traitant)'}{e.fonction ? ' — ' + e.fonction : ''}{e.tache ? ' — ' + e.tache : ''}</option>
                                                        )}
                                                    </select>
                                                </td>
                                                <td style={{textAlign:'center'}}>
                                                    <input type="number" min="0" step="0.5" value={e.quantite} onChange={ev => updateEntry(idx, 'quantite', ev.target.value)}
                                                        style={{width:50,padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11,textAlign:'center'}} />
                                                </td>
                                                <td style={{textAlign:'right',color:'var(--gray-500)'}}>{Number(e.prixUnitaire).toLocaleString('fr-FR')} DH</td>
                                                <td style={{color:'var(--gray-500)'}}>{e.unite}</td>
                                            </React.Fragment>
                                        )}
                                        <td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{(Math.round((Number(e.quantite)||0)*(Number(e.prixUnitaire)||0)*100)/100).toLocaleString('fr-FR')} DH</td>
                                        <td>
                                            {isLocked || !isRH || e.fonction === 'TRANSPORT FRUIT' ? (
                                                <span style={{fontSize:11,color:'var(--gray-500)'}}>{e.commentaire}</span>
                                            ) : (
                                                <input value={e.commentaire || ''} onChange={ev => updateEntry(idx, 'commentaire', ev.target.value)} placeholder="..."
                                                    style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} />
                                            )}
                                        </td>
                                        {!isLocked && isRH && (
                                            <td style={{textAlign:'center'}}>
                                                {e.fonction !== 'TRANSPORT FRUIT' && (
                                                    <button onClick={() => removeEntry(idx)} style={{padding:'3px 6px',borderRadius:4,border:'none',background:'#e74c3c',color:'#fff',fontSize:10,cursor:'pointer'}}>
                                                        <i className="fa-solid fa-trash"></i>
                                                    </button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                                {entries.length === 0 && <tr><td colSpan={isLocked || !isRH ? 9 : 10} style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucune entrée pour cette date</td></tr>}
                                {/* Total row */}
                                {entries.length > 0 && (
                                    <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                        <td colSpan={isLocked || !isRH ? 7 : 5} style={{textAlign:'right'}}>TOTAL</td>
                                        {!isLocked && isRH && <td colSpan="2"></td>}
                                        <td style={{textAlign:'right',color:'var(--berry)',fontSize:14}}>{totalMontant.toLocaleString('fr-FR')} DH</td>
                                        <td></td>
                                        {!isLocked && isRH && <td></td>}
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        {!isLocked && isRH && (
                            <div style={{marginTop:12,display:'flex',gap:8,alignItems:'center'}}>
                                <button onClick={addEntry} style={{padding:'8px 16px',borderRadius:8,border:'2px dashed var(--gray-300)',background:'#fff',color:'var(--gray-600)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter une ligne
                                </button>
                                {entries.length > 0 && (
                                    <button onClick={saveEntries} disabled={saving}
                                        style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                        <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} style={{marginRight:4}}></i>
                                        {saving ? 'Enregistrement...' : ((entriesByDate[selectedDate] && (entriesByDate[selectedDate].entries || []).length > 0) ? 'Modifier le pointage' : 'Enregistrer')}
                                    </button>
                                )}
                                {savedMsg && <span style={{color:'var(--green)',fontWeight:600,fontSize:12}}>{savedMsg}</span>}
                            </div>
                        )}
                    </Panel>
                    </React.Fragment>
                    )}
                </div>
            );
        }

export { PointageDiversTab };
