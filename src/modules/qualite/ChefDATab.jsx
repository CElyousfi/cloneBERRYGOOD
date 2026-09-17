/* Module: qualite | Déclaration(s): ChefDATab */
import { PROFILES } from '../shared/PROFILES.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== CHEF: DEMANDE D'ACHAT TAB =====================
        function ChefDATab({ currentProfile, profileData }) {
            const [daList, setDaList] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [showArticles, setShowArticles] = useState(false);
            const [catalogArticles, setCatalogArticles] = useState([]);
            const [articleSearch, setArticleSearch] = useState('');
            const profileObj = PROFILES.find(p => p.id === currentProfile);
            const chefFerme = profileObj?.farm || 'F1';
            const emptyItem = { article: '', categorie: 'autre', quantite: '1', unite: 'unité', note: '' };
            const [form, setForm] = useState({ urgence: 'normale', justification: '', items: [] });

            const statusLabels = { soumise: 'Soumise', approuvee: 'Approuvée', rejetee: 'Rejetée' };
            const statusClass = (s) => { if (s === 'soumise') return 'en-attente'; if (s === 'approuvee') return 'valide'; if (s === 'rejetee') return 'rejete'; return 'brouillon'; };

            const loadDa = () => {
                fetch('/api/stock?action=list-da&ferme=' + chefFerme).then(r => r.json()).then(json => { if (json.success) setDaList(json.das || []); })
                    .catch(err => console.warn('DA error:', err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadDa(); fetch('/api/stock?action=list-articles').then(r=>r.json()).then(j=>{ if(j.success) setCatalogArticles(j.articles||[]); }).catch(()=>{}); }, []);

            const handleCreate = () => {
                if (!form.justification.trim()) { alert('Veuillez saisir la justification de la demande'); return; }
                const items = (showArticles && form.items.length > 0) ? form.items.filter(it => it.article.trim()) : [{ article: form.justification.trim(), categorie: 'autre', quantite: '1', unite: 'unité', note: '' }];
                if (items.length === 0) { alert('Ajoutez au moins un article ou désactivez le détail articles'); return; }
                fetch('/api/stock?action=create-da', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ferme: chefFerme, urgence: form.urgence, justification: form.justification, items, created_by: { profileId: currentProfile, name: profileData?.name || profileObj?.name || '', role: 'chef' } }),
                }).then(r => r.json()).then(json => { if (json.success) { alert('Demande ' + json.numero + ' créée'); setShowForm(false); setShowArticles(false); loadDa(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau'));
            };

            const updateItem = (idx, field, value) => { setForm(f => { const items = [...f.items]; items[idx] = { ...items[idx], [field]: value }; return { ...f, items }; }); };
            const removeItem = (idx) => { setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) })); };
            const addItem = () => { setForm(f => ({ ...f, items: [...f.items, { ...emptyItem }] })); };

            const filteredCatalog = articleSearch.length >= 2 ? catalogArticles.filter(a => a.nom.toLowerCase().includes(articleSearch.toLowerCase())).slice(0, 8) : [];

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <h3 style={{margin:0}}><i className="fa-solid fa-file-lines" style={{marginRight:8,color:'var(--berry)'}}></i>Mes demandes d'achat — {chefFerme}</h3>
                        <button data-tour="btn-new-chef-da" onClick={() => { setForm({ urgence: 'normale', justification: '', items: [] }); setShowArticles(false); setShowForm(true); }}
                            style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                            <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouvelle demande
                        </button>
                    </div>

                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Date</th><th>Urgence</th><th>Justification</th><th>Articles</th><th>Statut</th></tr></thead>
                        <tbody>
                            {daList.map((da) => (
                                <tr key={da.id}>
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{da.numero}</td>
                                    <td style={{fontSize:12}}>{da.created_at ? new Date(da.created_at).toLocaleDateString('fr-FR') : '—'}</td>
                                    <td><span className="status-badge" style={da.urgence === 'critique' ? {background:'rgba(231,76,60,0.12)',color:'var(--red)'} : da.urgence === 'urgente' ? {background:'rgba(243,156,18,0.12)',color:'#E67E22'} : {background:'#f0f0f0',color:'#666'}}>{da.urgence}</span></td>
                                    <td style={{fontSize:12,color:'#444'}}>{da.justification || '—'}</td>
                                    <td style={{fontSize:11,color:'#888'}}>{(da.items||[]).length > 1 ? (da.items.length + ' articles') : '—'}</td>
                                    <td><span className={'status-badge ' + statusClass(da.status)}>{statusLabels[da.status] || da.status}</span>{da.bdc_numero && <div style={{fontSize:10,color:'#27ae60',marginTop:2}}>BDC: {da.bdc_numero}</div>}</td>
                                </tr>
                            ))}
                            {daList.length === 0 && <tr><td colSpan="6" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucune demande pour {chefFerme}.</td></tr>}
                        </tbody>
                    </table></div>

                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:650,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-file-lines" style={{marginRight:8}}></i>Demande d'Achat — {chefFerme}</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Urgence</label>
                                        <select value={form.urgence} onChange={e => setForm({...form, urgence: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="normale">Normale</option><option value="urgente">Urgente</option><option value="critique">Critique</option>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Justification / Besoin *</label>
                                        <textarea value={form.justification} onChange={e => setForm({...form, justification: e.target.value})} rows={3} placeholder="Décrivez votre besoin..."
                                            style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical',boxSizing:'border-box'}} /></div>
                                </div>

                                {/* Toggle articles détaillés */}
                                <div style={{borderTop:'1px solid #eee',paddingTop:12,marginBottom:12}}>
                                    <button onClick={() => { if(!showArticles) { setShowArticles(true); if(form.items.length===0) addItem(); } else setShowArticles(false); }}
                                        style={{background: showArticles?'rgba(155,89,182,0.1)':'#f8f9fa',border: showArticles?'1px solid var(--berry)':'1px dashed #ccc',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontSize:12,fontWeight:600,color: showArticles?'var(--berry)':'#666',display:'flex',alignItems:'center',gap:6}}>
                                        <i className={showArticles?'fa-solid fa-chevron-down':'fa-solid fa-list-check'}></i>
                                        {showArticles ? 'Masquer le détail articles' : 'Détailler les articles (optionnel)'}
                                    </button>
                                </div>

                                {showArticles && (
                                    <div style={{background:'#fafafa',borderRadius:10,padding:14,marginBottom:12}}>
                                        <div style={{fontSize:11,color:'#888',marginBottom:10}}><i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>Ajoutez les articles souhaités. Commencez à taper pour chercher dans le catalogue.</div>
                                        {form.items.map((item, idx) => (
                                            <div key={idx} style={{display:'grid',gridTemplateColumns:'3fr 1fr 1fr auto',gap:6,marginBottom:8,alignItems:'center'}}>
                                                <div style={{position:'relative'}}>
                                                    <input value={item.article} onChange={e => { updateItem(idx, 'article', e.target.value); setArticleSearch(e.target.value); }}
                                                        placeholder="Nom article..." style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12,boxSizing:'border-box'}} />
                                                    {articleSearch.length >= 2 && item.article === articleSearch && filteredCatalog.length > 0 && (
                                                        <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:'1px solid #ddd',borderRadius:6,maxHeight:180,overflowY:'auto',zIndex:10,boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
                                                            {filteredCatalog.map(a => (
                                                                <div key={a.id} onClick={() => { updateItem(idx, 'article', a.nom); updateItem(idx, 'categorie', a.categorie||'autre'); updateItem(idx, 'unite', a.unite||'unité'); setArticleSearch(''); }}
                                                                    style={{padding:'6px 10px',fontSize:11,cursor:'pointer',borderBottom:'1px solid #f0f0f0',display:'flex',justifyContent:'space-between'}}
                                                                    onMouseEnter={e=>e.currentTarget.style.background='#f5f0ff'} onMouseLeave={e=>e.currentTarget.style.background=''}>
                                                                    <span>{a.nom}</span><span style={{color:'#999',fontSize:10}}>{a.categorie}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <input type="number" min="1" value={item.quantite} onChange={e => updateItem(idx, 'quantite', e.target.value)} placeholder="Qté" style={{padding:'6px 10px',borderRadius:6,border:'1px solid #ddd',fontSize:12,textAlign:'right'}} />
                                                <select value={item.unite} onChange={e => updateItem(idx, 'unite', e.target.value)} style={{padding:'6px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>
                                                    <option value="unité">Unité</option><option value="kg">kg</option><option value="L">L</option><option value="sac">Sac</option><option value="bidon">Bidon</option><option value="T">Tonne</option>
                                                </select>
                                                <button onClick={() => removeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:14,padding:4}}>×</button>
                                            </div>
                                        ))}
                                        <button onClick={addItem} style={{fontSize:11,color:'var(--berry)',background:'none',border:'1px dashed var(--berry)',borderRadius:6,padding:'4px 12px',cursor:'pointer',marginTop:4}}>
                                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter article
                                        </button>
                                    </div>
                                )}

                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Soumettre</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { ChefDATab };
