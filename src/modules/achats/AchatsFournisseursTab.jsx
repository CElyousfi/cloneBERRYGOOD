/* Module: achats | Déclaration(s): AchatsFournisseursTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: FOURNISSEURS TAB =====================
        function AchatsFournisseursTab({ currentProfile, profileData }) {
            const [suppliers, setSuppliers] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [editingId, setEditingId] = useState(null);
            const [errors, setErrors] = useState({});
            const [form, setForm] = useState({ nom: '', ice: '', adresse: '', ville: '', tel: '', email: '', contact_nom: '', identifiant_fiscal: '', categorie: 'autre' });
            const [importing, setImporting] = useState(false);
            const [importResult, setImportResult] = useState(null);
            const [importXlsState, setImportXlsState] = useState(null); // null | { phase: 'preview' | 'importing' | 'done', data: ... }
            const fileInputRef = React.useRef(null);
            const categories = ['engrais', 'phyto', 'emballage', 'materiel', 'autre'];

            const loadSuppliers = () => {
                fetch('/api/stock?action=list-suppliers').then(r => r.json())
                    .then(json => { if (json.success) setSuppliers(json.suppliers || []); })
                    .catch(err => console.warn('Suppliers error:', err))
                    .finally(() => setLoading(false));
            };
            useEffect(() => { loadSuppliers(); }, []);

            const handleSave = () => {
                if (!form.nom.trim()) { setErrors({ nom: 'Le nom du fournisseur est requis' }); return; }
                const wasEditing = !!editingId;
                const action = editingId ? 'update-supplier' : 'create-supplier';
                const profileInfo = { profileId: currentProfile, name: profileData?.name || currentProfile };
                const body = editingId
                    ? { ...form, id: editingId, updated_by: profileInfo }
                    : { ...form, created_by: profileInfo };
                fetch('/api/stock?action=' + action, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        setErrors({});
                        setShowForm(false); setEditingId(null);
                        setForm({ nom: '', ice: '', adresse: '', ville: '', tel: '', email: '', contact_nom: '', identifiant_fiscal: '', categorie: 'autre' });
                        loadSuppliers();
                        if (!wasEditing) alert('Fournisseur créé et validé.');
                    } else if (json.errors) {
                        setErrors(json.errors);
                    } else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const startEdit = (s) => {
                setErrors({});
                setForm({ nom: s.nom || '', ice: s.ice || '', adresse: s.adresse || '', ville: s.ville || '', tel: s.tel || '', email: s.email || '', contact_nom: s.contact_nom || '', identifiant_fiscal: s.identifiant_fiscal || '', categorie: s.categorie || 'autre' });
                setEditingId(s.id); setShowForm(true);
            };

            const handleImportSQL = () => {
                if (!confirm('Importer les fournisseurs depuis BEE ONE ?\nLes doublons (même ICE ou même nom) seront ignorés.')) return;
                setImporting(true); setImportResult(null);
                const profileInfo = { uid: currentProfile, name: profileData?.name || currentProfile };
                fetch('/api/stock?action=import-fournisseurs-sql', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imported_by: profileInfo }),
                })
                .then(r => r.json())
                .then(json => {
                    if (json.success) { setImportResult({ type: 'success', stats: json.stats, cols: json.columns_mapped }); loadSuppliers(); }
                    else setImportResult({ type: 'error', message: json.error });
                })
                .catch(err => setImportResult({ type: 'error', message: err.message }))
                .finally(() => setImporting(false));
            };

            const handleFileSelect = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                e.target.value = '';
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const base64 = ev.target.result.split(',')[1];
                    setImportXlsState({ phase: 'loading', base64 });
                    const profileInfo = { uid: currentProfile, name: profileData?.name || currentProfile };
                    fetch('/api/stock?action=import-fournisseurs-xls', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file_base64: base64, imported_by: profileInfo, dry_run: true }),
                    }).then(r => r.json()).then(json => {
                        if (json.success) setImportXlsState({ phase: 'preview', base64, data: json, profileInfo });
                        else { alert('Erreur: ' + (json.error || 'Echec')); setImportXlsState(null); }
                    }).catch(err => { alert('Erreur réseau: ' + err.message); setImportXlsState(null); });
                };
                reader.readAsDataURL(file);
            };

            const handleConfirmImportXls = () => {
                if (!importXlsState || !importXlsState.base64) return;
                setImportXlsState(prev => ({ ...prev, phase: 'importing' }));
                fetch('/api/stock?action=import-fournisseurs-xls', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_base64: importXlsState.base64, imported_by: importXlsState.profileInfo, dry_run: false }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { setImportXlsState({ phase: 'done', data: json }); loadSuppliers(); }
                    else { alert('Erreur: ' + (json.error || 'Echec')); setImportXlsState(prev => ({ ...prev, phase: 'preview' })); }
                }).catch(err => { alert('Erreur réseau: ' + err.message); setImportXlsState(prev => ({ ...prev, phase: 'preview' })); });
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}},
                React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                            <span style={{fontSize:13,fontWeight:600,color:'#2c3e50'}}>{suppliers.length} fournisseur(s)</span>
                        </div>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                            <input type="file" accept=".xls,.xlsx" ref={fileInputRef} onChange={handleFileSelect} style={{display:'none'}} />
                            <button onClick={() => fileInputRef.current && fileInputRef.current.click()}
                                style={{background:'#2980b9', color:'#fff', border:'none',
                                    borderRadius:8, padding:'8px 16px', cursor:'pointer',
                                    fontWeight:600, fontSize:13, display:'flex', alignItems:'center', gap:6}}>
                                <i className="fa-solid fa-file-excel"></i>
                                Importer Excel
                            </button>
                            <button onClick={handleImportSQL} disabled={importing}
                                style={{background: importing ? '#95a5a6' : '#27ae60', color:'#fff', border:'none',
                                    borderRadius:8, padding:'8px 16px', cursor: importing ? 'not-allowed' : 'pointer',
                                    fontWeight:600, fontSize:13, display:'flex', alignItems:'center', gap:6}}>
                                <i className={importing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-database'}></i>
                                {importing ? 'Import en cours...' : 'Importer depuis BEE ONE'}
                            </button>
                            <button onClick={() => { setEditingId(null); setErrors({}); setForm({ nom: '', ice: '', adresse: '', ville: '', tel: '', email: '', contact_nom: '', identifiant_fiscal: '', categorie: 'autre' }); setShowForm(true); }}
                                style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau fournisseur
                            </button>
                        </div>
                    </div>

                    <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#2c3e50'}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--blue)'}}></i>
                        Un fournisseur est <strong>validé automatiquement à la création</strong> si les 6 champs obligatoires (Nom, Adresse, IF, ICE, Contact, Téléphone) sont valides.
                    </div>

                    {importResult && (
                        <div style={{background: importResult.type==='success' ? 'rgba(39,174,96,0.1)' : 'rgba(231,76,60,0.1)',
                            border: `1px solid ${importResult.type==='success' ? 'rgba(39,174,96,0.3)' : 'rgba(231,76,60,0.3)'}`,
                            borderRadius:8, padding:'12px 16px', marginBottom:16, fontSize:12}}>
                            {importResult.type === 'success' ? (
                                <span>
                                    <i className="fa-solid fa-circle-check" style={{marginRight:8,color:'#27ae60'}}></i>
                                    <strong>Import terminé :</strong> {importResult.stats.imported} importé(s),{' '}
                                    {importResult.stats.skipped} ignoré(s) (doublons). Total SQL : {importResult.stats.total_found}.
                                    {importResult.stats.skipped_sample && importResult.stats.skipped_sample.length > 0 &&
                                        <span style={{color:'#7f8c8d',display:'block',marginTop:4}}>
                                            Ignorés ex. : {importResult.stats.skipped_sample.join(', ')}
                                        </span>}
                                </span>
                            ) : (
                                <span>
                                    <i className="fa-solid fa-circle-xmark" style={{marginRight:8,color:'#e74c3c'}}></i>
                                    <strong>Erreur :</strong> {importResult.message}
                                </span>
                            )}
                            <button onClick={() => setImportResult(null)}
                                style={{float:'right',background:'none',border:'none',cursor:'pointer',color:'#7f8c8d',fontSize:14}}>×</button>
                        </div>
                    )}

                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>Nom</th><th>IF</th><th>ICE</th><th>Ville</th><th>Catégorie</th><th>Tél</th><th>Contact</th><th>Statut</th><th></th></tr></thead>
                        <tbody>
                            {suppliers.map((s) => (
                                <tr key={s.id}>
                                    <td style={{fontWeight:600}}>{s.nom}</td>
                                    <td style={{fontSize:11,fontFamily:'monospace'}}>{s.identifiant_fiscal || '—'}</td>
                                    <td style={{fontSize:11,fontFamily:'monospace'}}>{s.ice || '—'}</td>
                                    <td>{s.ville || '—'}</td>
                                    <td><span className="status-badge" style={{background:'rgba(52,152,219,0.1)',color:'var(--blue)',textTransform:'capitalize'}}>{s.categorie}</span></td>
                                    <td style={{fontSize:12}}>{s.tel || '—'}</td>
                                    <td>{s.contact_nom || '—'}</td>
                                    <td><span className="status-badge valide">Validé</span></td>
                                    <td>
                                        <button onClick={() => startEdit(s)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--blue)',fontSize:13}} title="Modifier"><i className="fa-solid fa-pen-to-square"></i></button>
                                    </td>
                                </tr>
                            ))}
                            {suppliers.length === 0 && <tr><td colSpan="9" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun fournisseur.</td></tr>}
                        </tbody>
                    </table></div>

                    {importXlsState && importXlsState.phase !== 'loading' && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && importXlsState.phase !== 'importing') setImportXlsState(null); }}>
                            <div className="modal-content" style={{maxWidth:680}}>
                                {importXlsState.phase === 'preview' && (() => {
                                    const d = importXlsState.data;
                                    return (<div>
                                        <h3 style={{marginTop:0}}><i className="fa-solid fa-file-excel" style={{marginRight:8,color:'#27ae60'}}></i>Rapport de pré-import Excel</h3>
                                        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
                                            {[{l:'Total fichier',v:d.stats.total_fichier,c:'#2c3e50'},{l:'A importer',v:d.stats.a_importer,c:'#27ae60'},{l:'Doublons',v:d.stats.doublons,c:'#e67e22'},{l:'Incomplets',v:d.stats.incomplets,c:'#3498db'}].map(s => (
                                                <div key={s.l} style={{background:'#f8f9fa',borderRadius:8,padding:'12px 10px',textAlign:'center'}}>
                                                    <div style={{fontSize:24,fontWeight:700,color:s.c}}>{s.v}</div>
                                                    <div style={{fontSize:11,color:'#7f8c8d',marginTop:2}}>{s.l}</div>
                                                </div>
                                            ))}
                                        </div>
                                        {d.warnings && d.warnings.length > 0 && (
                                            <div style={{background:'rgba(241,196,15,0.1)',border:'1px solid rgba(241,196,15,0.3)',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:11}}>
                                                <strong><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4,color:'#f39c12'}}></i>Alertes :</strong>
                                                <ul style={{margin:'4px 0 0',paddingLeft:16}}>{d.warnings.map((w,i) => <li key={i}>{w}</li>)}</ul>
                                            </div>
                                        )}
                                        {d.duplicates && d.duplicates.length > 0 && (
                                            <div style={{marginBottom:12}}>
                                                <strong style={{fontSize:12}}>Doublons détectés ({d.duplicates.length}) :</strong>
                                                <div style={{maxHeight:120,overflow:'auto',marginTop:4,fontSize:11,background:'#f8f9fa',borderRadius:6,padding:8}}>
                                                    {d.duplicates.map((dup,i) => <div key={i} style={{padding:'2px 0'}}><span style={{color:'#e67e22',fontWeight:600}}>{dup.code}</span> {dup.nom} — <span style={{color:'#95a5a6'}}>{dup.reason}</span></div>)}
                                                </div>
                                            </div>
                                        )}
                                        {d.preview && d.preview.length > 0 && (
                                            <div style={{marginBottom:12}}>
                                                <strong style={{fontSize:12}}>Apercu (premiers {d.preview.length}) :</strong>
                                                <div style={{maxHeight:150,overflow:'auto',marginTop:4}}>
                                                    <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                                                        <thead><tr style={{background:'#f1f1f1'}}><th style={{padding:'4px 8px',textAlign:'left'}}>Code</th><th style={{padding:'4px 8px',textAlign:'left'}}>Nom</th><th style={{padding:'4px 8px',textAlign:'left'}}>Ville</th><th style={{padding:'4px 8px',textAlign:'left'}}>ICE</th></tr></thead>
                                                        <tbody>{d.preview.map((r,i) => <tr key={i} style={{borderBottom:'1px solid #eee'}}><td style={{padding:'4px 8px',fontFamily:'monospace'}}>{r.code}</td><td style={{padding:'4px 8px'}}>{r.nom}</td><td style={{padding:'4px 8px'}}>{r.ville || '—'}</td><td style={{padding:'4px 8px',fontFamily:'monospace',fontSize:10}}>{r.ice || '—'}</td></tr>)}</tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                            <button onClick={() => setImportXlsState(null)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                            <button onClick={handleConfirmImportXls} disabled={d.stats.a_importer === 0}
                                                style={{padding:'8px 16px',borderRadius:8,border:'none',background: d.stats.a_importer > 0 ? '#27ae60' : '#95a5a6',color:'#fff',cursor: d.stats.a_importer > 0 ? 'pointer' : 'not-allowed',fontWeight:600,fontSize:13}}>
                                                <i className="fa-solid fa-check" style={{marginRight:6}}></i>Confirmer l'import ({d.stats.a_importer})
                                            </button>
                                        </div>
                                    </div>);
                                })()}
                                {importXlsState.phase === 'importing' && (
                                    <div style={{textAlign:'center',padding:40}}>
                                        <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:'var(--berry)',marginBottom:12}}></i>
                                        <div style={{fontSize:14,color:'#2c3e50'}}>Import en cours...</div>
                                    </div>
                                )}
                                {importXlsState.phase === 'done' && (() => {
                                    const d = importXlsState.data;
                                    return (<div style={{textAlign:'center',padding:'20px 0'}}>
                                        <i className="fa-solid fa-circle-check" style={{fontSize:48,color:'#27ae60',marginBottom:12}}></i>
                                        <h3 style={{color:'#27ae60'}}>Import terminé</h3>
                                        <div style={{fontSize:14,marginBottom:16}}>
                                            <strong>{d.stats.imported}</strong> fournisseur(s) importé(s), <strong>{d.stats.doublons}</strong> doublon(s) ignoré(s)
                                        </div>
                                        <div style={{background:'rgba(39,174,96,0.08)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#2c3e50',marginBottom:16}}>
                                            <i className="fa-solid fa-circle-check" style={{marginRight:6,color:'#27ae60'}}></i>
                                            Les fournisseurs importés sont en statut <strong>"Validé"</strong>.
                                        </div>
                                        <button onClick={() => setImportXlsState(null)} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Fermer</button>
                                    </div>);
                                })()}
                            </div>
                        </div>
                    )}

                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:560}}>
                                <h3 style={{marginTop:0}}><i className="fa-solid fa-building" style={{marginRight:8}}></i>{editingId ? 'Modifier' : 'Nouveau'} fournisseur</h3>
                                {(() => {
                                    const inStyle = (field) => ({width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid ' + (errors[field] ? '#e74c3c' : '#ddd'),fontSize:13});
                                    const errMsg = (field) => errors[field] ? <div style={{fontSize:11,color:'#e74c3c',marginTop:3}}>{errors[field]}</div> : null;
                                    return (
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                                    <div style={{gridColumn:'span 2'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nom *</label><input value={form.nom} onChange={e => setForm({...form, nom: e.target.value})} placeholder="Nom du fournisseur" style={inStyle('nom')} />{errMsg('nom')}</div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>IF (Identifiant Fiscal) *</label><input value={form.identifiant_fiscal} onChange={e => setForm({...form, identifiant_fiscal: e.target.value})} placeholder="7-8 chiffres" style={inStyle('identifiant_fiscal')} />{errMsg('identifiant_fiscal')}</div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>ICE *</label><input value={form.ice} onChange={e => setForm({...form, ice: e.target.value})} placeholder="15 chiffres" style={inStyle('ice')} />{errMsg('ice')}</div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Catégorie</label><select value={form.categorie} onChange={e => setForm({...form, categorie: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>{categories.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}</select></div>
                                    <div style={{gridColumn:'span 2'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Adresse *</label><input value={form.adresse} onChange={e => setForm({...form, adresse: e.target.value})} placeholder="Adresse" style={inStyle('adresse')} />{errMsg('adresse')}</div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ville</label><input value={form.ville} onChange={e => setForm({...form, ville: e.target.value})} placeholder="Ville" style={inStyle('ville')} />{errMsg('ville')}</div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Téléphone *</label><input value={form.tel} onChange={e => setForm({...form, tel: e.target.value})} placeholder="0XXXXXXXXX" style={inStyle('tel')} />{errMsg('tel')}</div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Email</label><input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="Email" style={inStyle('email')} />{errMsg('email')}</div>
                                    <div style={{gridColumn:'span 2'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Personne de contact *</label><input value={form.contact_nom} onChange={e => setForm({...form, contact_nom: e.target.value})} placeholder="Nom du contact" style={inStyle('contact_nom')} />{errMsg('contact_nom')}</div>
                                </div>
                                    );
                                })()}
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleSave} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>{editingId ? 'Enregistrer' : 'Créer'}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsFournisseursTab };
