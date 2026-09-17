/* Module: qualite | Déclaration(s): ChefValidationsTab */
import { PROFILES } from '../shared/PROFILES.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== CHEF VALIDATIONS TAB =====================
        function ChefValidationsTab({ currentProfile, profileData }) {
            const [bdcList, setBdcList] = useState([]);
            const [loading, setLoading] = useState(true);
            const [commentModal, setCommentModal] = useState(null); // { id, decision }
            const [comment, setComment] = useState('');
            const [rejectReason, setRejectReason] = useState('');
            const [rejectCustom, setRejectCustom] = useState('');
            const [bdcDetail, setBdcDetail] = useState(null); // BDC object for detail modal
            const profileObj = PROFILES.find(p => p.id === currentProfile);
            const chefFerme = profileObj?.farm || '';

            const REJECT_REASONS = ['Non demandé', 'Changement qté', 'Autre fournisseur', 'Erreur produit', 'Autre'];

            const loadPending = () => {
                fetch('/api/stock?action=list-bdc&status=en_attente_chef').then(r => r.json()).then(json => {
                    if (json.success) { const filtered = chefFerme ? (json.bdc || []).filter(b => b.ferme === chefFerme) : (json.bdc || []); setBdcList(filtered); }
                }).catch(err => console.warn('Validation error:', err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadPending(); }, []);

            const openDetail = (b) => {
                setBdcDetail(null);
                fetch('/api/stock?action=get-bdc&id=' + b.id).then(r => r.json()).then(json => {
                    if (json.success && json.bdc) setBdcDetail(json.bdc);
                    else setBdcDetail(b);
                }).catch(() => setBdcDetail(b));
            };

            const openRejectModal = (id) => { setCommentModal({ id, decision: 'reject' }); setRejectReason(''); setRejectCustom(''); setBdcDetail(null); };
            const openApproveModal = (id) => { setCommentModal({ id, decision: 'approve' }); setComment(''); setBdcDetail(null); };

            const handleValidate = (id, decision) => {
                const finalComment = decision === 'reject'
                    ? (rejectReason === 'Autre' ? rejectCustom.trim() : rejectReason)
                    : comment;
                fetch('/api/stock?action=validate-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision, role: 'chef', profileId: currentProfile, name: profileData?.name || profileObj?.name || '', comment: finalComment, ferme: chefFerme }),
                }).then(r => r.json()).then(json => { if (json.success) { setCommentModal(null); setRejectReason(''); setRejectCustom(''); setComment(''); loadPending(); window._refreshNotifications?.(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau'));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <h3 style={{marginBottom:16}}><i className="fa-solid fa-check-circle" style={{marginRight:8,color:'var(--berry)'}}></i>BDC en attente de validation{chefFerme ? ' — ' + chefFerme : ''}</h3>
                    {bdcList.length === 0 ? (
                        <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}><i className="fa-solid fa-check-double" style={{fontSize:48,marginBottom:16,display:'block'}}></i><p style={{fontSize:16,fontWeight:600}}>Aucun BDC en attente</p></div>
                    ) : (
                        <table className="data-table">
                            <thead><tr><th>N°</th><th>Date</th><th>Fournisseur</th><th>Ferme</th><th>Articles</th><th>Total TTC</th><th>Actions</th></tr></thead>
                            <tbody>{bdcList.map((b) => (
                                <tr key={b.id} style={{cursor:'pointer'}} onClick={() => openDetail(b)}>
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{b.numero}</td>
                                    <td style={{fontSize:12}}>{b.created_at ? new Date(b.created_at).toLocaleDateString('fr-FR') : '—'}</td>
                                    <td style={{fontWeight:600}}>{b.fournisseur?.nom || '—'}</td><td>{b.ferme}</td>
                                    <td style={{textAlign:'center'}}>{b.items?.length || 0}</td>
                                    <td style={{fontWeight:700}}>{(b.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                    <td onClick={e => e.stopPropagation()}><div style={{display:'flex',gap:6}}>
                                        <button onClick={() => openApproveModal(b.id)} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider</button>
                                        <button onClick={() => openRejectModal(b.id)} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter</button>
                                    </div></td>
                                </tr>
                            ))}</tbody>
                        </table>
                    )}

                    {/* BDC Detail Modal */}
                    {bdcDetail && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBdcDetail(null); }}>
                            <div className="modal-content" style={{maxWidth:680, maxHeight:'90vh', overflowY:'auto'}}>
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16}}>
                                    <div>
                                        <div style={{fontWeight:900, fontSize:18, color:'var(--berry)'}}>{bdcDetail.numero}</div>
                                        <div style={{fontSize:12, color:'#666', marginTop:4, display:'flex', gap:12, flexWrap:'wrap'}}>
                                            <span><i className="fa-solid fa-building" style={{marginRight:4}}></i>{bdcDetail.fournisseur?.nom || '—'}</span>
                                            <span><i className="fa-solid fa-warehouse" style={{marginRight:4}}></i>{bdcDetail.ferme}</span>
                                            <span><i className="fa-regular fa-calendar" style={{marginRight:4}}></i>{bdcDetail.created_at ? new Date(bdcDetail.created_at).toLocaleDateString('fr-FR') : '—'}</span>
                                            <span style={{background:'rgba(230,126,34,0.12)', color:'#e67e22', padding:'2px 8px', borderRadius:8, fontWeight:700}}>En attente validation</span>
                                        </div>
                                    </div>
                                    <button onClick={() => setBdcDetail(null)} style={{background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#999', padding:'0 4px', lineHeight:1}}>×</button>
                                </div>
                                {(bdcDetail.items || []).length > 0 && (
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:11, fontWeight:700, color:'#999', textTransform:'uppercase', letterSpacing:1, marginBottom:8}}>Articles</div>
                                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
                                            <thead><tr style={{background:'#f8f8f8'}}>
                                                <th style={{padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#555', borderBottom:'1px solid #eee'}}>Article</th>
                                                <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#555', borderBottom:'1px solid #eee'}}>Qté</th>
                                                <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#555', borderBottom:'1px solid #eee'}}>PU (MAD)</th>
                                                <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#555', borderBottom:'1px solid #eee'}}>TVA</th>
                                                <th style={{padding:'8px 10px', textAlign:'right', fontWeight:600, color:'#555', borderBottom:'1px solid #eee'}}>Total TTC</th>
                                            </tr></thead>
                                            <tbody>{bdcDetail.items.map((it, i) => (
                                                <tr key={i} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                    <td style={{padding:'8px 10px', fontWeight:600}}>{it.article}</td>
                                                    <td style={{padding:'8px 10px', textAlign:'right', color:'#555'}}>{it.quantite} {it.unite}</td>
                                                    <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace'}}>{it.prix_unitaire ? Number(it.prix_unitaire).toLocaleString('fr-FR') : '—'}</td>
                                                    <td style={{padding:'8px 10px', textAlign:'right', color:'#888'}}>{it.taux_tva}%</td>
                                                    <td style={{padding:'8px 10px', textAlign:'right', fontWeight:700, color:'var(--berry)'}}>{it.montant_ttc ? Number(it.montant_ttc).toLocaleString('fr-FR') : '—'}</td>
                                                </tr>
                                            ))}</tbody>
                                        </table>
                                        <div style={{textAlign:'right', marginTop:10, fontSize:13, color:'#555'}}>
                                            <span style={{marginRight:16}}>HT: <strong>{(bdcDetail.total_ht||0).toLocaleString('fr-FR')} MAD</strong></span>
                                            <span style={{marginRight:16}}>TVA: <strong>{(bdcDetail.total_tva||0).toLocaleString('fr-FR')} MAD</strong></span>
                                            <span style={{fontSize:16, color:'var(--berry)', fontWeight:800}}>TTC: {(bdcDetail.total_ttc||0).toLocaleString('fr-FR')} MAD</span>
                                        </div>
                                    </div>
                                )}
                                <div style={{display:'flex', gap:10, justifyContent:'flex-end', marginTop:16, paddingTop:16, borderTop:'1px solid #f0f0f0'}}>
                                    <button onClick={() => openRejectModal(bdcDetail.id)} style={{padding:'9px 20px', borderRadius:8, border:'none', background:'var(--red)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13}}>
                                        <i className="fa-solid fa-xmark" style={{marginRight:6}}></i>Rejeter
                                    </button>
                                    <button onClick={() => openApproveModal(bdcDetail.id)} style={{padding:'9px 20px', borderRadius:8, border:'none', background:'var(--green)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13}}>
                                        <i className="fa-solid fa-check" style={{marginRight:6}}></i>Valider
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Approve / Reject Modal */}
                    {commentModal && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCommentModal(null); }}>
                            <div className="modal-content" style={{maxWidth:420}}>
                                <h3 style={{marginTop:0, color: commentModal.decision === 'approve' ? 'var(--green)' : 'var(--red)'}}>
                                    <i className={commentModal.decision === 'approve' ? 'fa-solid fa-check-circle' : 'fa-solid fa-circle-xmark'} style={{marginRight:8}}></i>
                                    {commentModal.decision === 'approve' ? 'Valider le BDC' : 'Rejeter le BDC'}
                                </h3>
                                {commentModal.decision === 'reject' ? (
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:12, fontWeight:700, color:'#555', marginBottom:10}}>Raison du rejet <span style={{color:'var(--red)'}}>*</span></div>
                                        {REJECT_REASONS.map(r => (
                                            <label key={r} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:8, marginBottom:6, background: rejectReason === r ? 'rgba(231,76,60,0.08)' : '#f8f8f8', border: rejectReason === r ? '1px solid rgba(231,76,60,0.3)' : '1px solid transparent', cursor:'pointer'}}>
                                                <input type="radio" name="rejectReason" value={r} checked={rejectReason === r} onChange={() => setRejectReason(r)} />
                                                <span style={{fontSize:13, fontWeight: rejectReason === r ? 600 : 400}}>{r}</span>
                                            </label>
                                        ))}
                                        {rejectReason === 'Autre' && (
                                            <textarea value={rejectCustom} onChange={e => setRejectCustom(e.target.value)} rows={2} placeholder="Précisez la raison..." style={{width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #ddd', fontSize:13, resize:'vertical', marginTop:4, boxSizing:'border-box'}} />
                                        )}
                                    </div>
                                ) : (
                                    <div style={{marginBottom:16}}>
                                        <label style={{fontSize:12, fontWeight:600, display:'block', marginBottom:4, color:'#555'}}>Commentaire (optionnel)</label>
                                        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Ajouter un commentaire..." style={{width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #ddd', fontSize:13, resize:'vertical'}} />
                                    </div>
                                )}
                                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                    <button onClick={() => setCommentModal(null)} style={{padding:'8px 16px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer', fontSize:13}}>Annuler</button>
                                    <button onClick={() => {
                                        if (commentModal.decision === 'reject') {
                                            if (!rejectReason) { alert('Sélectionnez une raison de rejet'); return; }
                                            if (rejectReason === 'Autre' && !rejectCustom.trim()) { alert('Précisez la raison'); return; }
                                        }
                                        handleValidate(commentModal.id, commentModal.decision);
                                    }} style={{padding:'8px 20px', borderRadius:8, border:'none', background: commentModal.decision === 'approve' ? 'var(--green)' : 'var(--red)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13}}>
                                        Confirmer
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { ChefValidationsTab };
