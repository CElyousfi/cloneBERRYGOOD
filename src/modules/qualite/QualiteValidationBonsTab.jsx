/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualiteValidationBonsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== QUALITE: VALIDATION BONS APPORT TAB =====================
        function QualiteValidationBonsTab({ currentProfile, profileData }) {
            const [bonsList, setBonsList] = useState([]);
            const [loading, setLoading] = useState(true);
            const [viewMode, setViewMode] = useState('pending');
            const [commentModal, setCommentModal] = useState(null);
            const [comment, setComment] = useState('');
            const [selectedBon, setSelectedBon] = useState(null);

            const statusLabels = { soumis: 'Soumis', valide_qualite: 'Validé Qualité', rejete_qualite: 'Rejeté Qualité', valide: 'Validé', rejete_chef: 'Rejeté Chef' };
            const statusColors = { soumis: '#f47920', valide_qualite: '#1565C0', rejete_qualite: '#dc2626', valide: '#22c55e', rejete_chef: '#dc2626' };

            const loadBons = async () => {
                setLoading(true);
                try {
                    const db = firebase.firestore();
                    const list = [];
                    // Charger bons manuels + scannés (les 2 sources qui passent par le workflow)
                    for (const src of ['manual_entry', 'scan_ocr']) {
                        let query;
                        if (viewMode === 'pending') {
                            query = db.collection('pfq_interne').where('source', '==', src).where('status', '==', 'soumis');
                        } else {
                            query = db.collection('pfq_interne').where('source', '==', src);
                        }
                        const snap = await query.limit(500).get();
                        snap.forEach(doc => {
                            const d = { id: doc.id, ...doc.data() };
                            if (viewMode === 'history' && d.status === 'soumis') return;
                            list.push(d);
                        });
                    }
                    list.sort((a, b) => {
                        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 0);
                        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 0);
                        return tb - ta;
                    });
                    setBonsList(list);
                } catch (err) { console.error('Load validation bons error:', err); }
                setLoading(false);
            };
            useEffect(() => { loadBons(); }, [viewMode]);

            const handleValidate = async (id) => {
                try {
                    const db = firebase.firestore();
                    await db.collection('pfq_interne').doc(id).update({
                        status: 'valide_qualite',
                        validatedByQualite: { profileId: currentProfile, name: profileData?.name || currentProfile },
                        validatedAtQualite: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    loadBons();
                } catch (err) { alert('Erreur: ' + err.message); }
            };

            const handleReject = async (id) => {
                if (!comment.trim()) { alert('Le motif de rejet est obligatoire'); return; }
                try {
                    const db = firebase.firestore();
                    await db.collection('pfq_interne').doc(id).update({
                        status: 'rejete_qualite',
                        motifRejet: comment.trim(),
                        validatedByQualite: { profileId: currentProfile, name: profileData?.name || currentProfile },
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    setCommentModal(null);
                    setComment('');
                    loadBons();
                } catch (err) { alert('Erreur: ' + err.message); }
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            // Vue détail d'un bon
            if (selectedBon) {
                const b = selectedBon;
                return (
                    <div className="fade-in">
                        <button onClick={() => setSelectedBon(null)} style={{marginBottom:16,padding:'6px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>
                            <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i>Retour
                        </button>
                        <div className="card" style={{padding:0,overflow:'hidden',marginBottom:16}}>
                            <div style={{display:'flex',gap:0}}>
                                {b.scanPhoto && (
                                    <div style={{flex:'0 0 45%',background:'#f5f5f5',display:'flex',alignItems:'center',justifyContent:'center',padding:12,borderRight:'1px solid #eee'}}>
                                        <img src={b.scanPhoto} alt="Scan" style={{maxWidth:'100%',maxHeight:500,objectFit:'contain',borderRadius:8}} />
                                    </div>
                                )}
                                <div style={{flex:1,padding:24}}>
                                    <div style={{border:'2px solid #1a237e',borderRadius:12,overflow:'hidden',fontFamily:'serif',marginBottom:16}}>
                                        <div style={{background:'#e8eaf6',padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'2px solid #1a237e'}}>
                                            <img src="https://www.berrygood.ma/logo.png" alt="Berry Good" style={{height:36,objectFit:'contain'}} />
                                            <div style={{fontWeight:800,fontSize:14,color:'#1a237e'}}>BON D'APPORT</div>
                                            <div><span style={{fontSize:11,color:'#666'}}>N°</span> <span style={{fontWeight:800,fontSize:16,color:'#c62828'}}>{b.bonApport || b.numeroPiece}</span></div>
                                        </div>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',fontSize:12}}>
                                            <div style={{padding:'6px 12px',borderRight:'1px solid #c5cae9',borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Ferme :</span> <strong>{b.blocFerme || b.ferme}</strong></div>
                                            <div style={{padding:'6px 12px',borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Date :</span> <strong>{b.date ? (b.date.includes('-') ? b.date.split('-').reverse().join('/') : b.date) : '-'}</strong></div>
                                            <div style={{padding:'6px 12px',borderRight:'1px solid #c5cae9',borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Variété :</span> <strong style={{color:'#1a237e'}}>{b.designation || b.blocVariete}</strong></div>
                                            <div style={{padding:'6px 12px',borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Client :</span> <strong>{b.client}</strong></div>
                                            <div style={{padding:'6px 12px',borderRight:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Type :</span> <strong>{b.typeVente}</strong></div>
                                            <div style={{padding:'6px 12px'}}><span style={{color:'#666'}}>Poids :</span> <strong style={{color:'#1a237e',fontSize:15}}>{(b.poidsLot || b.quantiteKg || 0).toLocaleString('fr-FR',{maximumFractionDigits:1})} kg</strong></div>
                                        </div>
                                    </div>
                                    {viewMode === 'pending' && (
                                        <div style={{display:'flex',gap:8,marginTop:16}}>
                                            <button onClick={() => { handleValidate(b.id); setSelectedBon(null); }} style={{padding:'10px 24px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-check" style={{marginRight:6}}></i>Valider</button>
                                            <button onClick={() => { setCommentModal(b.id); setComment(''); }} style={{padding:'10px 24px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-xmark" style={{marginRight:6}}></i>Rejeter</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            }

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0}}><i className="fa-solid fa-clipboard-check" style={{marginRight:8,color:'var(--berry)'}}></i>Validation Bons d'Apport — Qualité</h3>
                        <div style={{display:'flex',gap:6}}>
                            {['pending', 'history'].map(m => (
                                <button key={m} className={`chip c-berry ${viewMode === m ? 'active' : ''}`} onClick={() => setViewMode(m)}>
                                    {m === 'pending' ? 'En attente' : 'Historique'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {bonsList.length === 0 ? (
                        <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-check-double" style={{fontSize:48,marginBottom:16,display:'block'}}></i>
                            <p style={{fontSize:16,fontWeight:600}}>{viewMode === 'pending' ? 'Aucun bon en attente de validation' : 'Aucun historique'}</p>
                        </div>
                    ) : (
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table">
                            <thead><tr><th>N° Bon</th><th>Type</th><th>Ferme</th><th>Date</th><th>Client</th><th>Désignation</th><th>Quantité (KG)</th>{viewMode === 'pending' && <th>Actions</th>}{viewMode === 'history' && <th>Status</th>}</tr></thead>
                            <tbody>{bonsList.map(b => (
                                <React.Fragment key={b.id}>
                                    <tr onClick={() => setSelectedBon(b)} style={{cursor:'pointer'}}>
                                        <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{b.bonApport || b.numeroPiece}</td>
                                        <td><span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background: b.typeVente === 'Export' ? 'rgba(21,101,192,0.1)' : 'rgba(230,81,0,0.1)',color: b.typeVente === 'Export' ? '#1565C0' : '#e65100'}}>{b.typeVente || 'Export'}</span></td>
                                        <td>{b.blocFerme || b.ferme}</td>
                                        <td style={{fontSize:12}}>{b.date || '—'}</td>
                                        <td>{b.client || '—'}</td>
                                        <td style={{fontSize:12}}>{b.designation}</td>
                                        <td style={{fontWeight:600,textAlign:'right'}}>{(b.poidsLot || b.quantiteKg || 0).toLocaleString('fr-FR', {minimumFractionDigits:1})} kg</td>
                                        {viewMode === 'pending' && <td onClick={e => e.stopPropagation()}><div style={{display:'flex',gap:6}}>
                                            <button onClick={() => handleValidate(b.id)} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider</button>
                                            <button onClick={() => { setCommentModal(b.id); setComment(''); }} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}><i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter</button>
                                        </div></td>}
                                        {viewMode === 'history' && <td><span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background: `${statusColors[b.status] || '#999'}18`,color: statusColors[b.status] || '#999'}}>{statusLabels[b.status] || b.status}</span></td>}
                                    </tr>
                                    {b.motifRejet && (
                                        <tr><td colSpan={8} style={{padding:'4px 12px',background:'rgba(220,38,38,0.05)',borderTop:'none'}}>
                                            <span style={{fontSize:11,color:'#dc2626'}}><i className="fa-solid fa-comment-dots" style={{marginRight:6}}></i><strong>Motif:</strong> {b.motifRejet}</span>
                                        </td></tr>
                                    )}
                                </React.Fragment>
                            ))}</tbody>
                        </table>
                        </div>
                    )}

                    {commentModal && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCommentModal(null); }}>
                            <div className="modal-content" style={{maxWidth:400}}>
                                <h3 style={{marginTop:0}}>Rejeter le Bon d'Apport</h3>
                                <div style={{marginBottom:12}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Motif du rejet (obligatoire)</label>
                                    <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Indiquez la raison du rejet..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical'}} />
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => setCommentModal(null)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={() => handleReject(commentModal)} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Confirmer le rejet</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { QualiteValidationBonsTab };
