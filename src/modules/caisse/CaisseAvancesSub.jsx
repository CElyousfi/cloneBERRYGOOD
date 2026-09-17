/* Module: caisse | Déclaration(s): CaisseAvancesSub */
import { formatMAD } from '../finance/formatMAD.jsx';
import { useMemo, useState } from '../shared/reactHooks.jsx';

import * as CaisseUtils from '../shared/lib/caisseUtils.js';
// ---- Sprint 3 — Avances Sub ----
        // Vue agrégée par bénéficiaire des avances non régularisées.
        function CaisseAvancesSub({ caisses, isControle }) {
            const [filterCaisse, setFilterCaisse] = useState('');
            const [showSoldees, setShowSoldees] = useState(false);
            const [allAvances, setAllAvances] = useState([]);
            const [loading, setLoading] = useState(true);
            const [openBenef, setOpenBenef] = useState(null); // string clé bénéficiaire
            const [regModal, setRegModal] = useState(null);   // { tx } ou null
            const [regForm, setRegForm] = useState({ montant: '', ref: '', commentaire: '' });
            const [regSaving, setRegSaving] = useState(false);
            const [toast, setToast] = useState(null);

            const load = () => {
                setLoading(true);
                let url = '/api/caisse?action=avances-liste';
                if (filterCaisse) url += '&caisse_id=' + encodeURIComponent(filterCaisse);
                fetch(url).then(r => r.json()).then(json => {
                    if (json.success) setAllAvances(json.transactions || []);
                    else { console.warn('avances-liste:', json.error); setAllAvances([]); }
                }).catch(err => { console.warn('avances-liste:', err); setAllAvances([]); })
                .finally(() => setLoading(false));
            };
            React.useEffect(() => { load(); }, [filterCaisse]);

            const showToast = (msg, kind) => {
                setToast({ msg, kind: kind || 'success' });
                setTimeout(() => setToast((cur) => (cur && cur.msg === msg ? null : cur)), 2500);
            };

            const aggregated = useMemo(() => {
                if (!CaisseUtils || !CaisseUtils.aggregateAvances) {
                    return { byBeneficiaire: new Map(), unidentifiedCount: 0 };
                }
                return CaisseUtils.aggregateAvances(allAvances, new Date(), { showSoldees });
            }, [allAvances, showSoldees]);

            // Tableau trié : par soldeDu DESC, puis par ancienneté DESC
            const rows = useMemo(() => {
                const list = [];
                for (const [benef, agg] of aggregated.byBeneficiaire) list.push({ benef, ...agg });
                list.sort((a, b) => {
                    if (b.soldeDu !== a.soldeDu) return b.soldeDu - a.soldeDu;
                    return (b.ancienneteJours || 0) - (a.ancienneteJours || 0);
                });
                return list;
            }, [aggregated]);

            const colorForAge = (j) => {
                if (j === null || j === undefined) return { bg: 'var(--gray-100)', label: '—', color: 'var(--gray-400)' };
                if (j < 30)  return { bg: 'rgba(45,139,78,0.08)',  label: `${j} j`, color: 'var(--green)' };
                if (j < 60)  return { bg: 'rgba(255,193,7,0.10)',  label: `${j} j`, color: '#92400E' };
                if (j < 90)  return { bg: 'rgba(243,156,18,0.10)', label: `${j} j`, color: '#92400E' };
                return         { bg: 'rgba(231,76,60,0.10)',  label: `${j} j`, color: 'var(--red)' };
            };

            const openRegFor = (tx) => {
                const restant = (Number(tx.montant) || 0) -
                    (Array.isArray(tx.regularisations) ? tx.regularisations : []).reduce((s, r) => s + (Number(r && r.montant) || 0), 0);
                setRegForm({ montant: String(restant > 0 ? restant : ''), ref: '', commentaire: '' });
                setRegModal({ tx, restant });
            };

            const submitReg = async () => {
                if (!regModal) return;
                const m = parseFloat(regForm.montant);
                if (!Number.isFinite(m) || m <= 0) return alert('Montant invalide');
                setRegSaving(true);
                try {
                    const r = await fetch('/api/caisse?action=avance-regulariser', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tx_id: regModal.tx.id, montant: m, ref: regForm.ref, commentaire: regForm.commentaire }),
                    });
                    const json = await r.json();
                    if (json && json.success) {
                        showToast(`Régularisation enregistrée (${m.toFixed(2)} DH)`);
                        setRegModal(null);
                        load();
                    } else {
                        showToast('Erreur : ' + ((json && json.error) || 'inconnue'), 'error');
                    }
                } catch (err) {
                    showToast('Erreur réseau : ' + err.message, 'error');
                } finally {
                    setRegSaving(false);
                }
            };

            return (
                <div className="fade-in">
                    {/* Filtres */}
                    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:14,alignItems:'center'}}>
                        <select value={filterCaisse} onChange={e => setFilterCaisse(e.target.value)}
                            style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="">Toutes les caisses</option>
                            {caisses.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                        </select>
                        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--gray-700)',cursor:'pointer'}}>
                            <input type="checkbox" checked={showSoldees} onChange={e => setShowSoldees(e.target.checked)} />
                            Afficher les avances soldées
                        </label>
                        {aggregated.unidentifiedCount > 0 && (
                            <span style={{padding:'6px 10px',background:'rgba(243,156,18,0.10)',border:'1px solid rgba(243,156,18,0.3)',borderRadius:6,fontSize:11,color:'#92400E'}}>
                                <i className="fa-solid fa-circle-info" style={{marginRight:5}}></i>
                                {aggregated.unidentifiedCount} avance{aggregated.unidentifiedCount > 1 ? 's' : ''} sans bénéficiaire identifiable
                            </span>
                        )}
                        <button onClick={load} disabled={loading}
                            style={{marginLeft:'auto',padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12}}>
                            <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-arrow-rotate-right'}`} style={{marginRight:5}}></i>
                            {loading ? 'Chargement…' : 'Rafraîchir'}
                        </button>
                    </div>

                    {loading ? (
                        <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:20,color:'var(--berry)'}}></i></div>
                    ) : rows.length === 0 ? (
                        <div style={{padding:30,textAlign:'center',color:'var(--gray-400)',fontSize:13,background:'white',borderRadius:10,border:'1px solid var(--gray-200)'}}>
                            <i className="fa-solid fa-circle-check" style={{fontSize:24,color:'var(--green)',display:'block',marginBottom:8}}></i>
                            Aucune avance à régulariser{showSoldees ? '' : ' (les avances soldées sont masquées)'}.
                        </div>
                    ) : (
                        <div style={{background:'white',borderRadius:10,border:'1px solid var(--gray-200)',overflow:'hidden'}}>
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
                                <thead><tr style={{background:'var(--gray-100)'}}>
                                    <th style={{padding:'10px 12px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Bénéficiaire</th>
                                    <th style={{padding:'10px 12px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Nb avances</th>
                                    <th style={{padding:'10px 12px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Total avancé</th>
                                    <th style={{padding:'10px 12px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Total régularisé</th>
                                    <th style={{padding:'10px 12px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Solde dû</th>
                                    <th style={{padding:'10px 12px',textAlign:'center',fontWeight:600,color:'var(--gray-600)'}}>Ancienneté</th>
                                </tr></thead>
                                <tbody>
                                    {rows.map((row, idx) => {
                                        const c = colorForAge(row.ancienneteJours);
                                        const isOpen = openBenef === row.benef;
                                        return (
                                            <React.Fragment key={row.benef}>
                                                <tr onClick={() => setOpenBenef(isOpen ? null : row.benef)}
                                                    style={{cursor:'pointer',borderTop: idx > 0 ? '1px solid var(--gray-200)' : 'none',background:c.bg,transition:'background 0.15s'}}>
                                                    <td style={{padding:'10px 12px',fontWeight:600,color:'var(--gray-800)'}}>
                                                        <i className={`fa-solid ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'}`} style={{marginRight:8,fontSize:10,color:'var(--gray-400)'}}></i>
                                                        {row.benef}
                                                    </td>
                                                    <td style={{padding:'10px 12px',textAlign:'right',color:'var(--gray-600)'}}>{row.avances.length}</td>
                                                    <td style={{padding:'10px 12px',textAlign:'right'}}>{formatMAD(row.totalAvance)}</td>
                                                    <td style={{padding:'10px 12px',textAlign:'right',color:'var(--green)'}}>{formatMAD(row.totalRegularise)}</td>
                                                    <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color: row.soldeDu > 0 ? 'var(--berry)' : 'var(--gray-400)'}}>{formatMAD(row.soldeDu)}</td>
                                                    <td style={{padding:'10px 12px',textAlign:'center'}}>
                                                        <span style={{padding:'3px 10px',borderRadius:12,background:'white',color:c.color,fontSize:11,fontWeight:600,border:`1px solid ${c.color}`}}>{c.label}</span>
                                                        {row.ancienneteDate && (
                                                            <div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>depuis {row.ancienneteDate}</div>
                                                        )}
                                                    </td>
                                                </tr>
                                                {isOpen && (
                                                    <tr style={{background:'#FAFAFA'}}>
                                                        <td colSpan={6} style={{padding:'12px 18px'}}>
                                                            <div style={{fontSize:11.5,fontWeight:600,color:'var(--gray-600)',marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>Détail des avances</div>
                                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:11.5}}>
                                                                <thead><tr style={{background:'#F0F0F0'}}>
                                                                    <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Date</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Réf.</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'left',fontWeight:600,color:'var(--gray-600)'}}>Description</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Montant</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Régularisé</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'var(--gray-600)'}}>Solde</th>
                                                                    {isControle && <th style={{padding:'6px 10px',textAlign:'center',fontWeight:600,color:'var(--gray-600)'}}>Action</th>}
                                                                </tr></thead>
                                                                <tbody>
                                                                    {row.avances.map(tx => {
                                                                        const regs = Array.isArray(tx.regularisations) ? tx.regularisations : [];
                                                                        const regSum = regs.reduce((s, r) => s + (Number(r && r.montant) || 0), 0);
                                                                        const restant = (Number(tx.montant) || 0) - regSum;
                                                                        return (
                                                                            <tr key={tx.id} style={{borderTop:'1px solid var(--gray-200)'}}>
                                                                                <td style={{padding:'6px 10px',whiteSpace:'nowrap'}}>{tx.date}</td>
                                                                                <td style={{padding:'6px 10px',fontFamily:'monospace',fontSize:10.5,color:'var(--gray-600)'}}>{tx.reference}</td>
                                                                                <td style={{padding:'6px 10px',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tx.description}</td>
                                                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{formatMAD(tx.montant)}</td>
                                                                                <td style={{padding:'6px 10px',textAlign:'right',color: regSum > 0 ? 'var(--green)' : 'var(--gray-400)'}}>{formatMAD(regSum)}</td>
                                                                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color: restant > 0 ? 'var(--berry)' : 'var(--gray-400)'}}>{formatMAD(restant)}</td>
                                                                                {isControle && (
                                                                                    <td style={{padding:'6px 10px',textAlign:'center'}}>
                                                                                        {restant > 0 ? (
                                                                                            <button onClick={(e) => { e.stopPropagation(); openRegFor(tx); }}
                                                                                                style={{padding:'4px 10px',borderRadius:6,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:10.5,fontWeight:600}}>
                                                                                                <i className="fa-solid fa-check" style={{marginRight:4}}></i>Régulariser
                                                                                            </button>
                                                                                        ) : (
                                                                                            <span style={{fontSize:10.5,color:'var(--green)'}}><i className="fa-solid fa-circle-check" style={{marginRight:3}}></i>Soldée</span>
                                                                                        )}
                                                                                    </td>
                                                                                )}
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                            {/* Sub-list of regularisations per tx (collapsed display) */}
                                                            {row.avances.some(tx => Array.isArray(tx.regularisations) && tx.regularisations.length > 0) && (
                                                                <div style={{marginTop:10,fontSize:11,color:'var(--gray-600)'}}>
                                                                    <strong>Historique régularisations :</strong>
                                                                    {row.avances.flatMap(tx => (tx.regularisations || []).map((r, i) => ({ tx, r, i }))).map(({ tx, r, i }) => (
                                                                        <div key={tx.id + '-' + i} style={{padding:'3px 0',color:'var(--gray-600)'}}>
                                                                            • {tx.reference} : {formatMAD(r.montant)} {r.ref ? `(${r.ref})` : ''} {r.commentaire ? `— ${r.commentaire}` : ''} {r.regularise_par?.name ? `par ${r.regularise_par.name}` : ''}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Régularisation Dialog */}
                    {regModal && (
                        <div className="modal-overlay" onClick={() => setRegModal(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:500}}>
                                <h3 style={{margin:'0 0 12px',fontSize:15,color:'var(--berry)'}}>
                                    <i className="fa-solid fa-check" style={{marginRight:6}}></i>
                                    Régulariser l'avance
                                </h3>
                                <div style={{fontSize:11.5,color:'var(--gray-600)',marginBottom:14,padding:'8px 10px',background:'var(--gray-100)',borderRadius:6}}>
                                    <div><strong>Réf.</strong> : <span style={{fontFamily:'monospace'}}>{regModal.tx.reference}</span></div>
                                    <div><strong>Description</strong> : {regModal.tx.description}</div>
                                    <div><strong>Montant</strong> : {formatMAD(regModal.tx.montant)} | <strong>Solde restant</strong> : <span style={{color:'var(--berry)',fontWeight:700}}>{formatMAD(regModal.restant)}</span></div>
                                </div>
                                <label style={{fontSize:11.5,fontWeight:600,color:'var(--gray-800)',display:'block',marginBottom:4}}>Montant régularisé (DH) *</label>
                                <input type="number" step="0.01" min="0.01" max={regModal.restant} value={regForm.montant}
                                    onChange={e => setRegForm({ ...regForm, montant: e.target.value })}
                                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,marginBottom:10}} />
                                <label style={{fontSize:11.5,fontWeight:600,color:'var(--gray-800)',display:'block',marginBottom:4}}>Référence transaction de régularisation</label>
                                <input type="text" value={regForm.ref} onChange={e => setRegForm({ ...regForm, ref: e.target.value })}
                                    placeholder="Ex : REG-2026-042"
                                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,marginBottom:10}} />
                                <label style={{fontSize:11.5,fontWeight:600,color:'var(--gray-800)',display:'block',marginBottom:4}}>Commentaire</label>
                                <textarea value={regForm.commentaire} onChange={e => setRegForm({ ...regForm, commentaire: e.target.value })}
                                    rows={2} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,marginBottom:14,fontFamily:'inherit',resize:'vertical'}} />
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => setRegModal(null)} disabled={regSaving}
                                        style={{padding:'8px 14px',borderRadius:8,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12}}>Annuler</button>
                                    <button onClick={submitReg} disabled={regSaving || !regForm.montant}
                                        style={{padding:'8px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'white',cursor:'pointer',fontSize:12,fontWeight:600,opacity:(regSaving || !regForm.montant) ? 0.5 : 1}}>
                                        {regSaving ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Enregistrement…</> : 'Enregistrer'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Toast */}
                    {toast && (
                        <div data-testid="caisse-avances-toast"
                            style={{position:'fixed',right:18,bottom:18,zIndex:1000,padding:'10px 16px',borderRadius:8,background:toast.kind==='error'?'#E74C3C':'#1A7A3F',color:'white',fontSize:12.5,fontWeight:600,boxShadow:'0 4px 14px rgba(0,0,0,0.18)'}}>
                            <i className={`fa-solid ${toast.kind==='error'?'fa-triangle-exclamation':'fa-circle-check'}`} style={{marginRight:6}}></i>
                            {toast.msg}
                        </div>
                    )}
                </div>
            );
        }

export { CaisseAvancesSub };
