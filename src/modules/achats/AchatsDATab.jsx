/* Module: achats | Déclaration(s): AchatsDATab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: DEMANDES D'ACHAT TAB =====================
        function AchatsDATab({ currentProfile, profileData, onNavigate }) {
            const [daList, setDaList] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [selectedDa, setSelectedDa] = useState(null);
            const [filterStatus, setFilterStatus] = useState('soumise');
            const [catalogueArticles, setCatalogueArticles] = useState([]);
            const [showCreateArticle, setShowCreateArticle] = useState(false);
            const [newArticle, setNewArticle] = useState({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
            const [creatingArt, setCreatingArt] = useState(false);
            const [createArticleLineIdx, setCreateArticleLineIdx] = useState(null);
            const FARMS = ['F1', 'F5', 'Avocatier'];
            const emptyItem = { article: '', categorie: 'engrais', quantite: '', unite: 'kg', note: '' };
            const [form, setForm] = useState({ ferme: 'F1', urgence: 'normale', justification: '', items: [{ ...emptyItem }] });

            const statusLabels = { brouillon: 'Brouillon', soumise: 'Soumise', approuvee: 'Approuvée', rejetee: 'Rejetée' };
            const statusClass = (s) => { if (s === 'soumise') return 'en-attente'; if (s === 'approuvee') return 'valide'; if (s === 'rejetee') return 'rejete'; return 'brouillon'; };
            const urgenceStyle = (u) => { if (u === 'critique') return {background:'rgba(231,76,60,0.12)',color:'var(--red)'}; if (u === 'urgente') return {background:'rgba(243,156,18,0.12)',color:'#E67E22'}; return {background:'#f0f0f0',color:'#666'}; };

            const loadDa = () => {
                const url = '/api/stock?action=list-da' + (filterStatus ? '&status=' + filterStatus : '');
                fetch(url).then(r => r.json()).then(json => { if (json.success) setDaList(json.das || []); })
                    .catch(err => console.warn('DA error:', err)).finally(() => setLoading(false));
            };
            useEffect(() => {
                const saved = localStorage.getItem('achats_da_filter');
                if (saved) { setFilterStatus(saved); localStorage.removeItem('achats_da_filter'); }
            }, []);
            useEffect(() => { loadDa(); }, [filterStatus]);
            useEffect(() => { fetch('/api/stock?action=list-articles').then(r=>r.json()).then(j=>{ if(j.success) { const seen = new Set(); setCatalogueArticles((j.articles||[]).filter(a => { if(seen.has(a.nom)) return false; seen.add(a.nom); return true; })); } }).catch(()=>{}); }, []);

            const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };
            const updateArticle = (idx, val) => {
                const found = catalogueArticles.find(a => a.nom.toLowerCase() === val.toLowerCase());
                const items = [...form.items];
                items[idx] = { ...items[idx], article: val, ...(found ? { categorie: found.categorie || 'autre', unite: (found.unite || 'kg').toLowerCase() } : {}) };
                setForm({ ...form, items });
            };
            const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
            const removeItem = (idx) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_, i) => i !== idx) }); };

            const canCreateArticle = currentProfile === 'achats' || currentProfile === 'dg';
            const suggestRef = (nom) => 'ART-' + (nom || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
            const openCreateArticle = (lineIdx, prefillNom) => {
                const nom = (prefillNom || '').trim();
                setNewArticle({ reference: nom ? suggestRef(nom) : '', nom, unite: 'kg', categorie: 'autre', taux_tva: 20 });
                setCreateArticleLineIdx(typeof lineIdx === 'number' ? lineIdx : null);
                setShowCreateArticle(true);
            };
            const handleCreateArticle = async () => {
                if (!newArticle.nom.trim() || !newArticle.reference.trim()) return alert('Le nom et la référence sont requis');
                setCreatingArt(true);
                try {
                    const r = await fetch('/api/stock?action=create-article', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newArticle, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) });
                    const j = await r.json();
                    if (j.success) {
                        const listR = await fetch('/api/stock?action=list-articles');
                        const listJ = await listR.json();
                        if (listJ.success) { const seen = new Set(); setCatalogueArticles((listJ.articles||[]).filter(a => { if(seen.has(a.nom)) return false; seen.add(a.nom); return true; })); }
                        if (createArticleLineIdx != null) {
                            const items = [...form.items];
                            const li = createArticleLineIdx;
                            items[li] = { ...items[li], article: newArticle.nom, unite: (newArticle.unite || 'kg').toLowerCase(), categorie: newArticle.categorie || 'autre' };
                            setForm(f => ({ ...f, items }));
                        }
                        setShowCreateArticle(false);
                        setCreateArticleLineIdx(null);
                        setNewArticle({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
                    } else { alert(j.error || 'Erreur lors de la création'); }
                } catch (e) { alert('Erreur réseau'); }
                setCreatingArt(false);
            };

            const handleCreate = () => {
                if (!form.items.some(i => i.article && i.quantite)) { alert('Ajoutez au moins un article avec une quantité'); return; }
                const validItems = form.items.filter(i => i.article && i.quantite);
                fetch('/api/stock?action=create-da', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...form, items: validItems, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile, role: 'achats' } }),
                }).then(r => r.json()).then(json => { if (json.success) { alert('Demande ' + json.numero + ' créée'); setShowForm(false); loadDa(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau'));
            };

            const handleApprove = (id) => {
                if (!confirm('Approuver cette demande d\'achat ?')) return;
                fetch('/api/stock?action=update-da', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, status: 'approuvee', updated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        window._refreshNotifications?.();
                        if (json.bdc_created && onNavigate) {
                            onNavigate('achats_bdc', json.bdc_id);
                        } else {
                            alert('DA approuvée');
                            loadDa();
                        }
                    } else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const handleReject = (id) => {
                const reason = prompt('Raison du rejet :');
                if (reason === null) return;
                fetch('/api/stock?action=update-da', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, status: 'rejetee', updated_by: { profileId: currentProfile, name: profileData?.name || currentProfile }, comment: reason }),
                }).then(r => r.json()).then(json => { if (json.success) { loadDa(); window._refreshNotifications?.(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau'));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {['', 'soumise', 'approuvee', 'rejetee'].map(s => (
                                <button key={s} className={`chip c-berry ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}>
                                    {s ? statusLabels[s] || s : 'Toutes'}
                                </button>
                            ))}
                        </div>
                        <button data-tour="btn-new-da" onClick={() => { setForm({ ferme: 'F1', urgence: 'normale', justification: '', items: [{ ...emptyItem }] }); setShowForm(true); }}
                            style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                            <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouvelle demande
                        </button>
                    </div>

                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Date</th><th>Ferme</th><th>Urgence</th><th>Articles</th><th>Demandeur</th><th>Statut</th><th>Actions</th></tr></thead>
                        <tbody>
                            {daList.map((da) => (
                                <tr key={da.id} onClick={() => setSelectedDa(selectedDa === da.id ? null : da.id)} style={{cursor:'pointer'}}>
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{da.numero}</td>
                                    <td style={{fontSize:12}}>{da.created_at ? new Date(da.created_at).toLocaleDateString('fr-FR') : '—'}</td>
                                    <td>{da.ferme}</td>
                                    <td><span className="status-badge" style={urgenceStyle(da.urgence)}>{da.urgence}</span></td>
                                    <td style={{textAlign:'center'}}>{da.items?.length || 0}</td>
                                    <td style={{fontSize:12}}>{da.created_by?.name || '—'}</td>
                                    <td><span className={'status-badge ' + statusClass(da.status)}>{statusLabels[da.status] || da.status}</span></td>
                                    <td onClick={e => e.stopPropagation()}>
                                        {da.status === 'soumise' && (
                                            <div style={{display:'flex',gap:4}}>
                                                <button onClick={() => handleApprove(da.id)} title="Approuver" style={{background:'none',border:'none',cursor:'pointer',color:'var(--green)',fontSize:13}}><i className="fa-solid fa-check"></i></button>
                                                <button onClick={() => handleReject(da.id)} title="Rejeter" style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:13}}><i className="fa-solid fa-xmark"></i></button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {daList.length === 0 && <tr><td colSpan="8" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucune demande d'achat.</td></tr>}
                        </tbody>
                    </table></div>

                    {/* Detail modal */}
                    {selectedDa && (() => { const da = daList.find(d => d.id === selectedDa); if (!da) return null; return (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSelectedDa(null); }}>
                            <div className="modal-content" style={{maxWidth:650,maxHeight:'90vh',overflowY:'auto'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                                    <div>
                                        <h3 style={{margin:0,color:'var(--berry)'}}><i className="fa-solid fa-file-lines" style={{marginRight:8}}></i>{da.numero}</h3>
                                        <div style={{fontSize:12,color:'var(--gray-400)',marginTop:4}}>
                                            {da.created_at ? new Date(da.created_at).toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric'}) : ''}
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedDa(null)} style={{background:'none',border:'none',fontSize:18,color:'var(--gray-400)',cursor:'pointer'}}><i className="fa-solid fa-xmark"></i></button>
                                </div>

                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
                                    <div style={{padding:'10px 14px',background:'var(--gray-50)',borderRadius:10}}>
                                        <div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase'}}>Ferme</div>
                                        <div style={{fontSize:14,fontWeight:700,marginTop:2}}>{da.ferme}</div>
                                    </div>
                                    <div style={{padding:'10px 14px',background:'var(--gray-50)',borderRadius:10}}>
                                        <div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase'}}>Urgence</div>
                                        <div style={{marginTop:4}}><span className="status-badge" style={urgenceStyle(da.urgence)}>{da.urgence}</span></div>
                                    </div>
                                    <div style={{padding:'10px 14px',background:'var(--gray-50)',borderRadius:10}}>
                                        <div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase'}}>Statut</div>
                                        <div style={{marginTop:4}}><span className={'status-badge ' + statusClass(da.status)}>{statusLabels[da.status] || da.status}</span></div>
                                    </div>
                                </div>

                                {da.created_by?.name && <p style={{fontSize:12,color:'#666',margin:'0 0 8px'}}><i className="fa-solid fa-user" style={{marginRight:6,color:'var(--gray-400)'}}></i><strong>Demandeur :</strong> {da.created_by.name}</p>}
                                {da.justification && <p style={{fontSize:12,color:'#666',margin:'0 0 12px',padding:'8px 12px',background:'#fafafa',borderRadius:8,borderLeft:'3px solid var(--berry)'}}><strong>Justification :</strong> {da.justification}</p>}
                                {da.bdc_numero && <p style={{fontSize:13,margin:'0 0 12px'}}><i className="fa-solid fa-file-contract" style={{color:'var(--berry)',marginRight:6}}></i><strong>BDC lié :</strong> <span onClick={() => { setSelectedDa(null); if (da.bdc_id && onNavigate) onNavigate('achats_bdc', da.bdc_id); }} style={{color:'var(--berry)',fontWeight:700,cursor:'pointer',textDecoration:'underline'}}>{da.bdc_numero}</span></p>}

                                <h4 style={{marginBottom:8,fontSize:13}}><i className="fa-solid fa-list" style={{marginRight:6,color:'var(--berry)'}}></i>Articles demandés ({da.items?.length || 0})</h4>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead><tr><th>Article</th><th>Catégorie</th><th>Quantité</th><th>Unité</th><th>Note</th></tr></thead>
                                    <tbody>{(da.items || []).map((it, i) => (<tr key={i}><td style={{fontWeight:600}}>{it.article}</td><td>{it.categorie}</td><td style={{textAlign:'center'}}>{it.quantite}</td><td>{it.unite}</td><td style={{fontSize:11,color:'#999'}}>{it.note || '—'}</td></tr>))}</tbody>
                                </table>

                                {da.history && da.history.length > 0 && (
                                    <div style={{marginTop:16}}>
                                        <h4 style={{marginBottom:8,fontSize:13}}><i className="fa-solid fa-clock-rotate-left" style={{marginRight:6,color:'var(--gray-400)'}}></i>Historique</h4>
                                        <div style={{borderLeft:'2px solid #eee',paddingLeft:12}}>
                                            {da.history.map((h, i) => (
                                                <div key={i} style={{marginBottom:8,fontSize:11}}>
                                                    <span style={{fontWeight:600,textTransform:'capitalize'}}>{h.action.replace(/_/g, ' ')}</span> — {h.by?.name || '—'} — {h.at ? new Date(h.at).toLocaleString('fr-FR') : ''}
                                                    {h.comment && <div style={{fontStyle:'italic',color:'#999'}}>{h.comment}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {da.status === 'soumise' && (
                                    <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16,borderTop:'1px solid #eee',paddingTop:16}}>
                                        <button onClick={() => { handleReject(da.id); setSelectedDa(null); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--red)',background:'#fff',color:'var(--red)',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                            <i className="fa-solid fa-xmark" style={{marginRight:6}}></i>Rejeter
                                        </button>
                                        <button onClick={() => { handleApprove(da.id); setSelectedDa(null); }} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                            <i className="fa-solid fa-check" style={{marginRight:6}}></i>Approuver
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ); })()}

                    {/* Create DA Modal */}
                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:650,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-file-lines" style={{marginRight:8}}></i>Nouvelle Demande d'Achat</h3>
                                <div data-tour="da-form-ferme" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ferme *</label>
                                        <select value={form.ferme} onChange={e => setForm({...form, ferme: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            {FARMS.map(f => <option key={f} value={f}>{f}</option>)}
                                        </select></div>
                                    <div data-tour="da-form-urgence"><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Urgence</label>
                                        <select value={form.urgence} onChange={e => setForm({...form, urgence: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="normale">Normale</option><option value="urgente">Urgente</option><option value="critique">Critique</option>
                                        </select></div>
                                    <div style={{gridColumn:'span 2'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Justification</label>
                                        <textarea value={form.justification} onChange={e => setForm({...form, justification: e.target.value})} rows={2} placeholder="Motif de la demande..."
                                            style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical'}} /></div>
                                </div>
                                <div data-tour="da-form-items" style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                                    <h4 style={{margin:0}}>Articles demandés</h4>
                                    {canCreateArticle && <button type="button" onClick={() => openCreateArticle(null)} style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontSize:11,fontWeight:600}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Nouvel article</button>}
                                </div>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead><tr><th>Article</th><th>Catégorie</th><th>Qté</th><th>Unité</th><th>Note</th><th></th></tr></thead>
                                    <tbody>
                                        {form.items.map((it, idx) => (
                                            <tr key={idx}>
                                                <td>
                                                    <input value={it.article} onChange={e => updateArticle(idx, e.target.value)} placeholder="Nom article" list={'da-articles-achats-'+idx} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                    <datalist id={'da-articles-achats-'+idx}>{catalogueArticles.map(a => <option key={a.id} value={a.nom} />)}</datalist>
                                                    {canCreateArticle && (() => { const v = (it.article || '').trim(); if (!v || catalogueArticles.some(a => a.nom.toLowerCase() === v.toLowerCase())) return null; return (
                                                        <button type="button" onClick={() => openCreateArticle(idx, v)} title="Créer cet article au catalogue" style={{marginTop:3,padding:'2px 6px',borderRadius:5,border:'1px dashed var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
                                                            <i className="fa-solid fa-plus" style={{marginRight:3}}></i>Créer « {v.length > 18 ? v.slice(0,18)+'…' : v} »
                                                        </button>
                                                    ); })()}
                                                </td>
                                                <td><select value={it.categorie} onChange={e => updateItem(idx, 'categorie', e.target.value)} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11, background: (() => { const f = catalogueArticles.find(a => a.nom.toLowerCase()===it.article.toLowerCase()); return f && f.categorie && f.categorie.toLowerCase()===it.categorie ? '#f0faf4' : '#fff'; })() }}>{(() => { const base = ['engrais','phyto','emballage','materiel','autre']; const extra = catalogueArticles.map(a => (a.categorie||'').toLowerCase()).filter(Boolean); const all = [...new Set([...base, ...extra])]; return all.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>); })()}</select></td>
                                                <td><input type="number" value={it.quantite} onChange={e => updateItem(idx, 'quantite', e.target.value)} style={{width:60,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12,textAlign:'right'}} /></td>
                                                <td><select value={it.unite} onChange={e => updateItem(idx, 'unite', e.target.value)} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11}}><option value="kg">kg</option><option value="L">L</option><option value="unité">unité</option><option value="carton">carton</option><option value="sac">sac</option><option value="bidon">bidon</option></select></td>
                                                <td><input value={it.note} onChange={e => updateItem(idx, 'note', e.target.value)} placeholder="Note..." style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><button onClick={() => removeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <button onClick={addItem} style={{marginTop:8,background:'none',border:'1px dashed #ccc',borderRadius:8,padding:'6px 14px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter une ligne</button>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button data-tour="da-form-submit" onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Soumettre la demande</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showCreateArticle && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setShowCreateArticle(false); setCreateArticleLineIdx(null); } }} style={{zIndex:10001}}>
                            <div className="modal-content" style={{maxWidth:500,width:'90vw'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-box" style={{marginRight:8}}></i>Nouvel Article</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Référence *</label>
                                        <input value={newArticle.reference} onChange={e => setNewArticle({...newArticle, reference: e.target.value})} placeholder="REF-001" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nom *</label>
                                        <input value={newArticle.nom} onChange={e => setNewArticle({...newArticle, nom: e.target.value})} placeholder="Nom de l'article" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Unité</label>
                                        <select value={newArticle.unite} onChange={e => setNewArticle({...newArticle, unite: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="kg">kg</option><option value="L">L</option><option value="unité">unité</option><option value="carton">carton</option><option value="sac">sac</option><option value="bidon">bidon</option>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Catégorie</label>
                                        <select value={newArticle.categorie} onChange={e => setNewArticle({...newArticle, categorie: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="autre">Autre</option><option value="engrais">Engrais</option><option value="phyto">Phyto</option><option value="emballage">Emballage</option><option value="materiel">Matériel</option>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>TVA %</label>
                                        <select value={newArticle.taux_tva} onChange={e => setNewArticle({...newArticle, taux_tva: parseFloat(e.target.value)})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value={0}>0%</option><option value={7}>7%</option><option value={10}>10%</option><option value={14}>14%</option><option value={20}>20%</option>
                                        </select></div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => { setShowCreateArticle(false); setCreateArticleLineIdx(null); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreateArticle} disabled={creatingArt} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:creatingArt?0.6:1}}>
                                        {creatingArt ? 'Création...' : 'Créer l\'article'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsDATab };
