/* Module: admin | Déclaration(s): DGValidationsTab */
import { formatModePaiement } from '../caisse/formatModePaiement.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== DG VALIDATIONS TAB =====================
        function DGValidationsTab({ currentProfile, profileData }) {
            const [bdcList, setBdcList] = useState([]);
            const [facturesList, setFacturesList] = useState([]);
            const [prixValidations, setPrixValidations] = useState([]);
            const [virementList, setVirementList] = useState([]);
            const [loading, setLoading] = useState(true);
            const [commentModal, setCommentModal] = useState(null);
            const [comment, setComment] = useState('');
            const [signatureStep, setSignatureStep] = useState(false);
            const [bdcDetail, setBdcDetail] = useState(null);
            const [changeRequests, setChangeRequests] = useState([]);
            const dgName = profileData?.name || 'DG';

            const openBdcDetail = (b) => {
                setBdcDetail(null);
                fetch('/api/stock?action=get-bdc&id=' + b.id).then(r => r.json()).then(json => {
                    if (json.success && json.bdc) setBdcDetail(json.bdc);
                    else setBdcDetail(b);
                }).catch(() => setBdcDetail(b));
            };

            const loadPending = () => {
                const promises = [
                    fetch('/api/stock?action=list-bdc&status=en_attente_dg').then(r => r.json()),
                    fetch('/api/stock?action=list-factures&payment_status=validee_finance').then(r => r.json()),
                    fetch('/api/stock?action=list-bdc&status=virement_lance').then(r => r.json()),
                    fetch('/api/stock?action=list-bdc-change-requests&status=en_attente').then(r => r.json()),
                ];
                // Load prix validations from Firestore
                const loadPrix = async () => {
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const snap = await db.collection('marche_local_prix_validations').where('status', '==', 'en_attente').get();
                            const vals = [];
                            snap.forEach(doc => vals.push({ id: doc.id, ...doc.data() }));
                            setPrixValidations(vals);
                        }
                    } catch(e) { console.warn('Prix validations error:', e); }
                };
                Promise.all(promises).then(([bdcJson, facJson, virJson, crJson]) => {
                    if (bdcJson.success) setBdcList(bdcJson.bdc || []);
                    if (facJson.success) setFacturesList(facJson.factures || []);
                    if (virJson.success) setVirementList(virJson.bdc || []);
                    if (crJson.success) setChangeRequests(crJson.requests || []);
                }).catch(err => console.warn('DG Validation error:', err)).finally(() => setLoading(false));
                loadPrix();
            };
            useEffect(() => { loadPending(); }, []);

            // Handle prix validation (approve/reject)
            const handlePrixDecision = async (validation, decision) => {
                if (decision === 'reject' && !comment.trim()) { alert('Commentaire requis pour le rejet'); return; }
                try {
                    if (typeof firebase !== 'undefined' && firebase.firestore) {
                        const db = firebase.firestore();
                        await db.collection('marche_local_prix_validations').doc(validation.id).update({
                            status: decision === 'approve' ? 'valide_dg' : 'rejete_dg',
                            resolvedBy: dgName,
                            resolvedAt: new Date().toISOString(),
                            comment: comment || '',
                        });
                        // Update the bon status too
                        if (validation.bonId) {
                            await db.collection('bons_marche_local').doc(validation.bonId).update({
                                status: decision === 'approve' ? 'valide' : 'rejete_dg',
                            });
                        }
                        setCommentModal(null); setComment('');
                        loadPending(); window._refreshNotifications?.();
                    }
                } catch(e) { alert('Erreur: ' + e.message); }
            };

            const handleValidate = (id, decision) => {
                fetch('/api/stock?action=validate-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision, role: 'dg', profileId: currentProfile, name: dgName, comment }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { setCommentModal(null); setComment(''); setSignatureStep(false); loadPending(); window._refreshNotifications?.(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur reseau'));
            };

            const handleChangeRequest = (id, decision, type) => {
                const msg = decision === 'approve'
                    ? (type === 'annulation' ? 'Le BDC sera définitivement annulé. Confirmer ?' : 'Le BDC repassera en brouillon. Confirmer ?')
                    : 'Refuser cette demande ?';
                if (!confirm(msg)) return;
                fetch('/api/stock?action=approve-bdc-change', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision, comment: '', approved_by: { profileId: currentProfile, name: dgName } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { loadPending(); window._refreshNotifications?.(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const handleSignVirement = (id) => {
                if (!confirm('Confirmer la signature du virement ?')) return;
                fetch('/api/stock?action=update-bdc-virement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision: 'signer', by: { profileId: currentProfile, name: dgName } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { loadPending(); window._refreshNotifications?.(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const handleValidateFacture = (id, decision) => {
                fetch('/api/stock?action=validate-facture', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, decision: decision === 'approve' ? 'valide' : 'rejete', step: 'dg', comment, validated_by: { profileId: currentProfile, name: dgName } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { setCommentModal(null); setComment(''); setSignatureStep(false); loadPending(); window._refreshNotifications?.(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur reseau'));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const now = new Date();

            return (
                <div className="fade-in">
                    <h3 style={{marginBottom:16}}><i className="fa-solid fa-check-double" style={{marginRight:8,color:'var(--berry)'}}></i>Validations DG ({bdcList.length + facturesList.length + prixValidations.length + virementList.length + changeRequests.length} en attente)</h3>

                    {bdcList.length > 0 && <>
                    <h4 style={{fontSize:13,margin:'0 0 8px',color:'var(--berry)'}}>Bons de Commande en attente DG ({bdcList.length})</h4>
                    <table className="data-table" style={{marginBottom:24}}>
                        <thead><tr><th>N°</th><th>Date</th><th>Fournisseur</th><th>Ferme</th><th>Montant TTC</th><th>Code Analytique</th><th>Actions</th></tr></thead>
                        <tbody>{bdcList.map((b) => (
                            <tr key={b.id} style={{cursor:'pointer'}} onClick={() => openBdcDetail(b)}>
                                <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{b.numero}</td>
                                <td style={{fontSize:12}}>{b.created_at ? new Date(b.created_at).toLocaleDateString('fr-FR') : '—'}</td>
                                <td style={{fontWeight:600}}>{b.fournisseur?.nom || '—'}</td><td>{b.ferme}</td>
                                <td style={{fontWeight:700}}>{(b.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                <td style={{fontSize:11,color:'#555'}}>{b.code_analytique || '—'}</td>
                                <td onClick={e => e.stopPropagation()}><div style={{display:'flex',gap:6}}>
                                    <button onClick={() => { setCommentModal({ id: b.id, decision: 'approve', type: 'bdc' }); setComment(''); setSignatureStep(false); }} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-signature" style={{marginRight:4}}></i>Signer</button>
                                    <button onClick={() => { setCommentModal({ id: b.id, decision: 'reject', type: 'bdc' }); setComment(''); setSignatureStep(false); }} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter</button>
                                </div></td>
                            </tr>
                        ))}</tbody>
                    </table></>}

                    {changeRequests.length > 0 && <>
                    <h4 style={{fontSize:13,margin:'0 0 8px',color:'#e67e22'}}><i className="fa-solid fa-pen-to-square" style={{marginRight:6}}></i>Demandes de modification/annulation BDC ({changeRequests.length})</h4>
                    <table className="data-table" style={{marginBottom:24}}>
                        <thead><tr><th>N° BDC</th><th>Type</th><th>Motif</th><th>Demandé par</th><th>Date</th><th>Actions</th></tr></thead>
                        <tbody>{changeRequests.map((cr) => (
                            <tr key={cr.id}>
                                <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{cr.bdc_numero}</td>
                                <td><span style={{padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:600,background: cr.type === 'annulation' ? '#fef2f2' : '#fffbeb', color: cr.type === 'annulation' ? '#dc2626' : '#d97706'}}>{cr.type === 'annulation' ? 'Annulation' : 'Modification'}</span></td>
                                <td style={{fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cr.motif}</td>
                                <td style={{fontSize:12}}>{cr.requested_by?.name || '—'}</td>
                                <td style={{fontSize:12}}>{cr.created_at ? new Date(cr.created_at).toLocaleDateString('fr-FR') : '—'}</td>
                                <td><div style={{display:'flex',gap:6}}>
                                    <button onClick={() => handleChangeRequest(cr.id, 'approve', cr.type)} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-check" style={{marginRight:4}}></i>Approuver</button>
                                    <button onClick={() => handleChangeRequest(cr.id, 'reject', cr.type)} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Refuser</button>
                                </div></td>
                            </tr>
                        ))}</tbody>
                    </table></>}

                    {facturesList.length > 0 && <>
                    <h4 style={{fontSize:13,margin:'0 0 8px',color:'var(--berry)'}}>Factures en attente validation DG ({facturesList.length})</h4>
                    <table className="data-table" style={{marginBottom:24}}>
                        <thead><tr><th>N°</th><th>Facture</th><th>Fournisseur</th><th>Total TTC</th><th>Ecarts</th><th>Actions</th></tr></thead>
                        <tbody>{facturesList.map((f) => (
                            <tr key={f.id}>
                                <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{f.numero}</td>
                                <td style={{fontSize:12}}>{f.numero_facture}</td>
                                <td style={{fontWeight:600}}>{f.fournisseur?.nom || '—'}</td>
                                <td style={{fontWeight:700}}>{(f.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                <td>{f.has_discrepancies ? <span className="status-badge rejete" style={{fontSize:10}}>{(f.discrepancies||[]).length} ecart(s)</span> : <span style={{color:'var(--green)',fontSize:11}}><i className="fa-solid fa-check"></i></span>}</td>
                                <td><div style={{display:'flex',gap:6}}>
                                    <button onClick={() => { setCommentModal({ id: f.id, decision: 'approve', type: 'facture' }); setComment(''); setSignatureStep(false); }} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider</button>
                                    <button onClick={() => { setCommentModal({ id: f.id, decision: 'reject', type: 'facture' }); setComment(''); setSignatureStep(false); }} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter</button>
                                </div></td>
                            </tr>
                        ))}</tbody>
                    </table></>}

                    {prixValidations.length > 0 && <>
                    <h4 style={{fontSize:13,margin:'0 0 8px',color:'#e65100'}}><i className="fa-solid fa-store" style={{marginRight:6}}></i>Validations Prix Marché Local ({prixValidations.length})</h4>
                    <table className="data-table" style={{marginBottom:24}}>
                        <thead><tr><th>Date</th><th>Client</th><th>Désignation</th><th>Ancien Prix</th><th>Nouveau Prix</th><th>Écart</th><th>Quantité</th><th>Total DH</th><th>Demandé par</th><th>Actions</th></tr></thead>
                        <tbody>{prixValidations.map((v) => {
                            const ecart = v.previousPrix - v.newPrix;
                            const ecartPct = v.previousPrix > 0 ? ((ecart / v.previousPrix) * 100).toFixed(1) : 0;
                            return (
                            <tr key={v.id}>
                                <td style={{fontSize:12}}>{v.date}</td>
                                <td style={{fontWeight:600}}>{v.client}</td>
                                <td style={{fontSize:12}}>{v.designation}</td>
                                <td style={{fontWeight:600}}>{v.previousPrix} DH</td>
                                <td style={{fontWeight:700,color:'#e74c3c'}}>{v.newPrix} DH</td>
                                <td style={{color:'#e74c3c',fontWeight:600}}>-{ecart.toFixed(1)} DH ({ecartPct}%)</td>
                                <td>{v.quantiteKg} kg</td>
                                <td style={{fontWeight:600}}>{Math.round(v.totalDH).toLocaleString()} DH</td>
                                <td style={{fontSize:11}}>{v.requestedBy}</td>
                                <td><div style={{display:'flex',gap:6}}>
                                    <button onClick={() => handlePrixDecision(v, 'approve')} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-check" style={{marginRight:4}}></i>Approuver</button>
                                    <button onClick={() => { setCommentModal({ id: v.id, decision: 'reject', type: 'prix', validation: v }); setComment(''); }} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--red, #e74c3c)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter</button>
                                </div></td>
                            </tr>
                        );})}</tbody>
                    </table></>}

                    {virementList.length > 0 && <>
                    <h4 style={{fontSize:13,margin:'0 0 8px',color:'#0369a1'}}><i className="fa-solid fa-money-bill-transfer" style={{marginRight:6}}></i>Virements à signer ({virementList.length})</h4>
                    <table className="data-table" style={{marginBottom:24}}>
                        <thead><tr><th>N° BDC</th><th>Fournisseur</th><th>Ferme</th><th>Montant TTC</th><th>Lancé par</th><th>Date lancement</th><th>Actions</th></tr></thead>
                        <tbody>{virementList.map((b) => (
                            <tr key={b.id}>
                                <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{b.numero}</td>
                                <td style={{fontWeight:600}}>{b.fournisseur?.nom || '—'}</td>
                                <td>{b.ferme}</td>
                                <td style={{fontWeight:700}}>{(b.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                <td style={{fontSize:12}}>{b.virement_lance_by?.name || '—'}</td>
                                <td style={{fontSize:12}}>{b.virement_lance_at ? new Date(b.virement_lance_at).toLocaleDateString('fr-FR') : '—'}</td>
                                <td>
                                    <button onClick={() => handleSignVirement(b.id)} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'#7c3aed',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}>
                                        <i className="fa-solid fa-signature" style={{marginRight:4}}></i>Signer virement
                                    </button>
                                </td>
                            </tr>
                        ))}</tbody>
                    </table></>}

                    {bdcList.length === 0 && facturesList.length === 0 && prixValidations.length === 0 && virementList.length === 0 && changeRequests.length === 0 && (
                        <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}><i className="fa-solid fa-check-double" style={{fontSize:48,marginBottom:16,display:'block'}}></i><p style={{fontSize:16,fontWeight:600}}>Aucun element en attente</p></div>
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
                                            {bdcDetail.code_analytique && <span><i className="fa-solid fa-barcode" style={{marginRight:4}}></i>{bdcDetail.code_analytique}</span>}
                                            {bdcDetail.mode_paiement && <span style={{background:'#eff6ff', color:'#2563eb', padding:'2px 8px', borderRadius:8, fontWeight:600, fontSize:11}}>{formatModePaiement(bdcDetail.mode_paiement)}</span>}
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
                                {bdcDetail.validated_by_chef && (
                                    <div style={{background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:12}}>
                                        <i className="fa-solid fa-user-check" style={{marginRight:6, color:'#16a34a'}}></i>
                                        Validé par Chef <strong>{bdcDetail.validated_by_chef.name}</strong> le {new Date(bdcDetail.validated_by_chef.at).toLocaleString('fr-FR')}
                                    </div>
                                )}
                                {bdcDetail.purchase_request_id && (
                                    <div style={{background:'#eff6ff', border:'1px solid #93c5fd', borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:12}}>
                                        <i className="fa-solid fa-file-pen" style={{marginRight:6, color:'#2563eb'}}></i>
                                        DA liée : <strong>{bdcDetail.purchase_request_id}</strong>
                                    </div>
                                )}
                                <div style={{display:'flex', gap:10, justifyContent:'flex-end', marginTop:16, paddingTop:16, borderTop:'1px solid #f0f0f0'}}>
                                    <button onClick={() => { setBdcDetail(null); setCommentModal({ id: bdcDetail.id, decision: 'reject', type: 'bdc' }); setComment(''); setSignatureStep(false); }} style={{padding:'9px 20px', borderRadius:8, border:'none', background:'var(--red)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13}}>
                                        <i className="fa-solid fa-xmark" style={{marginRight:6}}></i>Rejeter
                                    </button>
                                    <button onClick={() => { setBdcDetail(null); setCommentModal({ id: bdcDetail.id, decision: 'approve', type: 'bdc' }); setComment(''); setSignatureStep(false); }} style={{padding:'9px 20px', borderRadius:8, border:'none', background:'var(--green)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13}}>
                                        <i className="fa-solid fa-signature" style={{marginRight:6}}></i>Signer
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {commentModal && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setCommentModal(null); setSignatureStep(false); } }}>
                            <div className="modal-content" style={{maxWidth:460}}>
                                {commentModal.decision === 'approve' && commentModal.type === 'bdc' && !signatureStep ? (
                                    <>
                                        <h3 style={{marginTop:0,display:'flex',alignItems:'center',gap:8}}><i className="fa-solid fa-signature" style={{color:'var(--berry)'}}></i>Valider et signer le BDC</h3>
                                        <div style={{marginBottom:12}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Commentaire (optionnel)</label>
                                            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Observations..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical'}} /></div>
                                        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                            <button onClick={() => { setCommentModal(null); setSignatureStep(false); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                            <button onClick={() => setSignatureStep(true)} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-pen-nib" style={{marginRight:6}}></i>Apposer ma signature</button>
                                        </div>
                                    </>
                                ) : commentModal.decision === 'approve' && commentModal.type === 'bdc' && signatureStep ? (
                                    <>
                                        <h3 style={{marginTop:0,display:'flex',alignItems:'center',gap:8}}><i className="fa-solid fa-certificate" style={{color:'var(--green)'}}></i>Signature électronique DG</h3>
                                        <div style={{background:'#f8f4f0',border:'2px solid var(--berry)',borderRadius:12,padding:24,textAlign:'center',margin:'0 0 20px'}}>
                                            <div style={{fontFamily:'Dancing Script,cursive',fontSize:36,color:'#8B2252',fontWeight:700,lineHeight:1.2}}>{dgName}</div>
                                            <div style={{fontSize:11,color:'#666',marginTop:8,fontStyle:'italic'}}>Approuvé et signé électroniquement le {now.toLocaleString('fr-FR')}</div>
                                            <div style={{fontSize:10,color:'#aaa',marginTop:4}}>Bon de Commande — Berry Good Farms</div>
                                        </div>
                                        <p style={{fontSize:12,color:'#555',margin:'0 0 16px'}}>En cliquant sur "Confirmer la signature", vous approuvez ce BDC et apposez votre visa électronique.</p>
                                        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                            <button onClick={() => setSignatureStep(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Retour</button>
                                            <button onClick={() => handleValidate(commentModal.id, 'approve')} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-check" style={{marginRight:6}}></i>Confirmer la signature</button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <h3 style={{marginTop:0}}>{commentModal.decision === 'approve' ? 'Valider' : 'Rejeter'} {commentModal.type === 'bdc' ? 'le BDC' : 'la facture'}</h3>
                                        <div style={{marginBottom:12}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Commentaire {commentModal.decision === 'reject' ? '(obligatoire)' : '(optionnel)'}</label>
                                            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Ajouter un commentaire..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical'}} /></div>
                                        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                            <button onClick={() => { setCommentModal(null); setSignatureStep(false); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                            <button onClick={() => { if (commentModal.decision === 'reject' && !comment.trim()) { alert('Commentaire requis pour le rejet'); return; } if (commentModal.type === 'prix') handlePrixDecision(commentModal.validation, commentModal.decision); else if (commentModal.type === 'facture') handleValidateFacture(commentModal.id, commentModal.decision); else handleValidate(commentModal.id, commentModal.decision); }}
                                                style={{padding:'8px 16px',borderRadius:8,border:'none',background: commentModal.decision === 'approve' ? 'var(--green)' : 'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Confirmer</button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { DGValidationsTab };
