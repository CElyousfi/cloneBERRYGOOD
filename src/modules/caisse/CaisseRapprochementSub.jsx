/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: caisse | Déclaration(s): CaisseRapprochementSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { MOIS_FR } from '../shared/MOIS_FR.jsx';
import { STATUS_LABELS } from '../shared/STATUS_LABELS.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ---- Sprint 3 — Rapprochement Sub (DG/Finance) ----
        // Rapprochement mensuel d'une caisse : solde théorique vs physique, écart, clôture.
        function CaisseRapprochementSub({ caisses }) {
            const today = new Date();
            const [caisseId, setCaisseId] = useState(caisses[0]?.id || '');
            const [mois, setMois] = useState(today.getMonth() + 1);
            const [annee, setAnnee] = useState(today.getFullYear());
            const [loading, setLoading] = useState(false);
            const [data, setData] = useState(null);
            const [soldePhysique, setSoldePhysique] = useState('');
            const [commentaire, setCommentaire] = useState('');
            const [saving, setSaving] = useState(false);
            const [closing, setClosing] = useState(false);
            const [history, setHistory] = useState([]);
            const [toast, setToast] = useState(null);

            React.useEffect(() => {
                if (!caisseId && caisses.length > 0) setCaisseId(caisses[0].id);
            }, [caisses]);

            const showToast = (msg, kind) => {
                setToast({ msg, kind: kind || 'success' });
                setTimeout(() => setToast(c => (c && c.msg === msg ? null : c)), 2500);
            };

            const load = () => {
                if (!caisseId) return;
                setLoading(true);
                const url = `/api/caisse?action=rapprochement-get&caisse_id=${encodeURIComponent(caisseId)}&mois=${mois}&annee=${annee}`;
                fetch(url).then(r => r.json()).then(json => {
                    if (json.success) {
                        setData(json);
                        if (json.rapprochement) {
                            setSoldePhysique(String(json.rapprochement.solde_physique ?? ''));
                            setCommentaire(json.rapprochement.commentaire || '');
                        } else {
                            setSoldePhysique('');
                            setCommentaire('');
                        }
                    } else {
                        showToast('Erreur : ' + (json.error || 'inconnue'), 'error');
                    }
                }).catch(err => showToast('Erreur réseau : ' + err.message, 'error'))
                .finally(() => setLoading(false));
            };

            const loadHistory = () => {
                if (!caisseId) return;
                fetch(`/api/caisse?action=rapprochement-list&caisse_id=${encodeURIComponent(caisseId)}`)
                    .then(r => r.json()).then(json => { if (json.success) setHistory(json.items || []); })
                    .catch(() => {});
            };

            React.useEffect(() => { load(); loadHistory(); /* eslint-disable-next-line */ }, [caisseId, mois, annee]);

            const totals = data?.totals || { solde_initial: 0, total_recettes: 0, total_depenses: 0, solde_theorique: 0 };
            const sp = parseFloat(soldePhysique);
            const ecart = Number.isFinite(sp) ? Number((sp - totals.solde_theorique).toFixed(2)) : null;
            const ecartColor = ecart === null ? 'var(--gray-400)' :
                ecart === 0 ? 'var(--green)' :
                Math.abs(ecart) < 50 ? '#92400E' :
                'var(--red)';
            const isCloture = data?.rapprochement?.statut === 'cloture';
            const blockingCount = data?.blocking_count || 0;
            const blocking = data?.blocking_transactions || [];

            const save = async () => {
                if (!Number.isFinite(sp)) return showToast('Solde physique requis', 'error');
                if (ecart !== 0 && (!commentaire || !commentaire.trim())) {
                    return showToast('Commentaire obligatoire si écart != 0', 'error');
                }
                setSaving(true);
                try {
                    const r = await fetch('/api/caisse?action=rapprochement-save', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ caisse_id: caisseId, mois, annee, solde_physique: sp, commentaire }),
                    });
                    const json = await r.json();
                    if (json && json.success) { showToast('Rapprochement enregistré'); load(); loadHistory(); }
                    else showToast('Erreur : ' + ((json && json.error) || 'inconnue'), 'error');
                } catch (err) { showToast('Erreur réseau : ' + err.message, 'error'); }
                finally { setSaving(false); }
            };

            const cloture = async () => {
                if (blockingCount > 0) return showToast(`Impossible : ${blockingCount} tx non validées`, 'error');
                if (ecart !== 0 && (!commentaire || !commentaire.trim())) {
                    return showToast('Commentaire obligatoire si écart != 0', 'error');
                }
                if (!window.confirm(`Clôturer le rapprochement de ${MOIS_FR[mois - 1]} ${annee} pour ${caisses.find(c => c.id === caisseId)?.nom || caisseId} ?\n\nUne fois clôturée, la période sera verrouillée.`)) return;
                setClosing(true);
                try {
                    const r = await fetch('/api/caisse?action=rapprochement-cloture', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ caisse_id: caisseId, mois, annee }),
                    });
                    const json = await r.json();
                    if (json && json.success) { showToast('Période clôturée'); load(); loadHistory(); }
                    else showToast('Erreur : ' + ((json && json.error) || 'inconnue'), 'error');
                } catch (err) { showToast('Erreur réseau : ' + err.message, 'error'); }
                finally { setClosing(false); }
            };

            const fmtDateFR = (ts) => {
                if (!ts) return '—';
                const d = ts && ts.toMillis ? new Date(ts.toMillis()) : new Date(ts);
                if (isNaN(d.getTime())) return '—';
                return d.toLocaleDateString('fr-FR');
            };

            return (
                <div className="fade-in">
                    {/* Sélecteurs */}
                    <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',marginBottom:14}}>
                        <select value={caisseId} onChange={e => setCaisseId(e.target.value)}
                            style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            {caisses.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                        </select>
                        <select value={mois} onChange={e => setMois(parseInt(e.target.value))}
                            style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            {MOIS_FR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                        </select>
                        <input type="number" min="2020" max="2100" value={annee} onChange={e => setAnnee(parseInt(e.target.value))}
                            style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,width:90}} />
                        <button onClick={() => { load(); loadHistory(); }} disabled={loading}
                            style={{marginLeft:'auto',padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12}}>
                            <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-arrow-rotate-right'}`} style={{marginRight:5}}></i>
                            Rafraîchir
                        </button>
                    </div>

                    {/* Statut clôture */}
                    {isCloture && (
                        <div style={{padding:'10px 14px',marginBottom:14,background:'rgba(45,139,78,0.10)',border:'1px solid var(--green)',borderRadius:8,fontSize:12.5,color:'var(--green)'}}>
                            <i className="fa-solid fa-lock" style={{marginRight:6}}></i>
                            Rapprochement clôturé le {fmtDateFR(data.rapprochement.cloture_at)} par {data.rapprochement.cloture_par?.name || '—'}
                        </div>
                    )}

                    {loading ? (
                        <div style={{textAlign:'center',padding:30}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:18,color:'var(--berry)'}}></i></div>
                    ) : !data ? null : (
                        <>
                            {/* Tableau principal */}
                            <div style={{background:'white',borderRadius:10,border:'1px solid var(--gray-200)',padding:18,marginBottom:14}}>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:14}}>
                                    <div>
                                        <div style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>Solde initial</div>
                                        <div style={{fontSize:18,fontWeight:600}}>{formatMAD(totals.solde_initial)}</div>
                                    </div>
                                    <div>
                                        <div style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>+ Recettes</div>
                                        <div style={{fontSize:18,fontWeight:600,color:'var(--green)'}}>{formatMAD(totals.total_recettes)}</div>
                                    </div>
                                    <div>
                                        <div style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>− Dépenses</div>
                                        <div style={{fontSize:18,fontWeight:600,color:'var(--red)'}}>{formatMAD(totals.total_depenses)}</div>
                                    </div>
                                    <div>
                                        <div style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>= Solde théorique</div>
                                        <div style={{fontSize:18,fontWeight:700,color:'var(--berry)'}}>{formatMAD(totals.solde_theorique)}</div>
                                    </div>
                                </div>
                                <div style={{marginTop:18,borderTop:'1px solid var(--gray-200)',paddingTop:14,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,alignItems:'end'}}>
                                    <div>
                                        <label style={{fontSize:11.5,fontWeight:600,color:'var(--gray-800)',display:'block',marginBottom:4}}>Solde physique (DH) *</label>
                                        <input type="number" step="0.01" value={soldePhysique} disabled={isCloture}
                                            onChange={e => setSoldePhysique(e.target.value)}
                                            style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,background:isCloture?'#F5F5F5':'white'}} />
                                    </div>
                                    <div>
                                        <div style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>Écart</div>
                                        <div style={{fontSize:20,fontWeight:700,color:ecartColor,padding:'7px 0'}}>
                                            {ecart === null ? '—' : (ecart >= 0 ? '+' : '') + formatMAD(ecart)}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{fontSize:10.5,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:4}}>Statut</div>
                                        <span style={{padding:'4px 10px',borderRadius:12,background: isCloture ? 'rgba(45,139,78,0.10)' : 'rgba(243,156,18,0.10)',color: isCloture ? 'var(--green)' : '#92400E',fontSize:11.5,fontWeight:600,display:'inline-block'}}>
                                            <i className={`fa-solid ${isCloture ? 'fa-lock' : 'fa-lock-open'}`} style={{marginRight:4}}></i>
                                            {isCloture ? 'Clôturé' : 'Ouvert'}
                                        </span>
                                    </div>
                                </div>
                                <div style={{marginTop:14}}>
                                    <label style={{fontSize:11.5,fontWeight:600,color:'var(--gray-800)',display:'block',marginBottom:4}}>
                                        Commentaire {ecart !== null && ecart !== 0 && <span style={{color:'var(--red)'}}>(obligatoire si écart ≠ 0)</span>}
                                    </label>
                                    <textarea value={commentaire} onChange={e => setCommentaire(e.target.value)} disabled={isCloture}
                                        rows={2} placeholder="Justification de l'écart, observations…"
                                        style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,fontFamily:'inherit',resize:'vertical',background:isCloture?'#F5F5F5':'white'}} />
                                </div>
                                {!isCloture && (
                                    <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
                                        <button onClick={save} disabled={saving || closing}
                                            style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--berry)',background:'white',color:'var(--berry)',cursor:'pointer',fontSize:12,fontWeight:600}}>
                                            {saving ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Enregistrement…</> : <><i className="fa-solid fa-floppy-disk" style={{marginRight:5}}></i>Enregistrer</>}
                                        </button>
                                        <button onClick={cloture} disabled={closing || saving || blockingCount > 0}
                                            title={blockingCount > 0 ? `Bloqué : ${blockingCount} tx non validées` : 'Clôturer définitivement la période'}
                                            style={{padding:'8px 16px',borderRadius:8,border:'none',background: blockingCount > 0 ? 'var(--gray-400)' : 'var(--berry)',color:'white',cursor: blockingCount > 0 ? 'not-allowed' : 'pointer',fontSize:12,fontWeight:600,opacity:(closing||saving)?0.6:1}}>
                                            {closing ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Clôture…</> : <><i className="fa-solid fa-lock" style={{marginRight:5}}></i>Clôturer la période</>}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Transactions bloquantes */}
                            {blockingCount > 0 && !isCloture && (
                                <div style={{background:'rgba(231,76,60,0.06)',border:'1px solid rgba(231,76,60,0.3)',borderRadius:10,padding:14,marginBottom:14}}>
                                    <div style={{fontSize:12.5,fontWeight:600,color:'var(--red)',marginBottom:10}}>
                                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                        Clôture impossible : {blockingCount} transaction{blockingCount > 1 ? 's' : ''} non validée{blockingCount > 1 ? 's' : ''} dans la période
                                    </div>
                                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:11.5}}>
                                        <thead><tr style={{background:'white'}}>
                                            <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Date</th>
                                            <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Réf.</th>
                                            <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Description</th>
                                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Montant</th>
                                            <th style={{padding:'6px 10px',textAlign:'center',fontWeight:600,color:'var(--gray-600)'}}>Statut</th>
                                        </tr></thead>
                                        <tbody>
                                            {blocking.map(b => (
                                                <tr key={b.id} style={{borderTop:'1px solid var(--gray-200)'}}>
                                                    <td style={{padding:'6px 10px',whiteSpace:'nowrap'}}>{b.date}</td>
                                                    <td style={{padding:'6px 10px',fontFamily:'monospace',fontSize:10.5}}>{b.reference}</td>
                                                    <td style={{padding:'6px 10px',maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.description}</td>
                                                    <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>{formatMAD(b.montant)}</td>
                                                    <td style={{padding:'6px 10px',textAlign:'center'}}>
                                                        {(() => { const s = STATUS_LABELS[b.status] || { label: b.status, bg: 'var(--gray-100)', color: 'var(--gray-600)' };
                                                            return <span style={{padding:'2px 8px',borderRadius:10,background:s.bg,color:s.color,fontSize:10,fontWeight:600}}>{s.label}</span>; })()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Historique des rapprochements */}
                            <div style={{background:'white',borderRadius:10,border:'1px solid var(--gray-200)',padding:14}}>
                                <div style={{fontSize:12.5,fontWeight:600,color:'var(--gray-700)',marginBottom:10}}>
                                    <i className="fa-solid fa-clock-rotate-left" style={{marginRight:6}}></i>
                                    Historique
                                </div>
                                {history.length === 0 ? (
                                    <div style={{fontSize:11.5,color:'var(--gray-400)'}}>Aucun rapprochement enregistré pour cette caisse.</div>
                                ) : (
                                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:11.5}}>
                                        <thead><tr style={{background:'var(--gray-100)'}}>
                                            <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Période</th>
                                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Théorique</th>
                                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Physique</th>
                                            <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Écart</th>
                                            <th style={{padding:'6px 10px',textAlign:'center',fontWeight:600,color:'var(--gray-600)'}}>Statut</th>
                                            <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Clôturé par</th>
                                        </tr></thead>
                                        <tbody>
                                            {history.map(h => {
                                                const ec = Number(h.ecart) || 0;
                                                const ecColor = ec === 0 ? 'var(--green)' : Math.abs(ec) < 50 ? '#92400E' : 'var(--red)';
                                                const isCur = h.periode && h.periode.mois === mois && h.periode.annee === annee;
                                                return (
                                                    <tr key={h.id} onClick={() => { if (h.periode) { setMois(h.periode.mois); setAnnee(h.periode.annee); } }}
                                                        style={{cursor:'pointer',borderTop:'1px solid var(--gray-200)',background:isCur ? 'var(--berry-pale)' : 'transparent'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:isCur?700:500}}>{MOIS_FR[(h.periode?.mois || 1) - 1]} {h.periode?.annee || '—'}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{formatMAD(h.solde_theorique)}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{formatMAD(h.solde_physique)}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right',color:ecColor,fontWeight:600}}>{(ec >= 0 ? '+' : '') + formatMAD(ec)}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'center'}}>
                                                            <span style={{padding:'2px 8px',borderRadius:10,background: h.statut === 'cloture' ? 'rgba(45,139,78,0.10)' : 'rgba(243,156,18,0.10)',color: h.statut === 'cloture' ? 'var(--green)' : '#92400E',fontSize:10,fontWeight:600}}>
                                                                <i className={`fa-solid ${h.statut === 'cloture' ? 'fa-lock' : 'fa-lock-open'}`} style={{marginRight:3}}></i>
                                                                {h.statut === 'cloture' ? 'Clôturé' : 'Ouvert'}
                                                            </span>
                                                        </td>
                                                        <td style={{padding:'6px 10px',color:'var(--gray-600)'}}>{h.cloture_par?.name || '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    )}

                    {/* Toast */}
                    {toast && (
                        <div data-testid="caisse-rapprochement-toast"
                            style={{position:'fixed',right:18,bottom:18,zIndex:1000,padding:'10px 16px',borderRadius:8,background:toast.kind==='error'?'#E74C3C':'#1A7A3F',color:'white',fontSize:12.5,fontWeight:600,boxShadow:'0 4px 14px rgba(0,0,0,0.18)'}}>
                            <i className={`fa-solid ${toast.kind==='error'?'fa-triangle-exclamation':'fa-circle-check'}`} style={{marginRight:6}}></i>
                            {toast.msg}
                        </div>
                    )}
                </div>
            );
        }

export { CaisseRapprochementSub };
