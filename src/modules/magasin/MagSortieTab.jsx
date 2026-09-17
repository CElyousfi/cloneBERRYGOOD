/* Module: magasin | Déclaration(s): MagSortieTab */
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { useStockLocations } from './useStockLocations.jsx';

// ===================== MAGASINIER: SORTIE TAB =====================
        function MagSortieTab({ currentProfile, profileData }) {
            // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
            const MAGASINS = useStockLocations().magasins;
            const STATIONS = ['Station F1', 'Station F2', 'Station F3', 'Station F4', 'Station F5', 'Station F6'];
            const SORTIE_TYPES = [{ id: 'retour_fournisseur', label: 'Retour fournisseur' }, { id: 'pret', label: 'Prêt' }, { id: 'rebut', label: 'Rebut' }];
            const [sorties, setSorties] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [articles, setArticles] = useState([]);
            const [suppliers, setSuppliers] = useState([]);
            const [query, setQuery] = useState('');
            const [filterSource, setFilterSource] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');
            const [sortField, setSortField] = useState('date');
            const [sortDir, setSortDir] = useState('desc');
            const [detailSortie, setDetailSortie] = useState(null);
            const isImportBS = (m) => (m.numero || '').startsWith('IMP-') || m.created_by?.userId === 'import_caneva';
            const emptyItem = { article: '', quantite: '', unite: 'kg' };
            const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], lieu_depart_type: 'magasin', lieu_depart_id: 'F1', lieu_destination: '', sortie_type: 'retour_fournisseur', beneficiaire: '', motif_rebut: '', items: [{ ...emptyItem }] });
            const [scanFileBS, setScanFileBS] = useState(null);
            const [scanPreviewBS, setScanPreviewBS] = useState(null);
            const [justificatifFile, setJustificatifFile] = useState(null);
            const [justificatifPreview, setJustificatifPreview] = useState(null);

            useEffect(() => {
                Promise.all([
                    fetch('/api/stock?action=list-movements&type=sortie&limit=500').then(r => r.json()),
                    cachedFetch('/api/stock?action=list-articles').then(json => json.success ? (json.articles || []) : []).catch(() => []),
                    cachedFetch('/api/stock?action=list-suppliers&status=valide').then(json => json.success ? (json.suppliers || []) : []).catch(() => []),
                ]).then(([movJson, arts, supps]) => {
                    if (movJson.success) setSorties(movJson.movements || []);
                    setArticles(arts.filter(a => a.active !== false));
                    setSuppliers(supps);
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };
            const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
            const removeItem = (idx) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_, i) => i !== idx) }); };

            const uploadScanBS = async (base64) => {
                if (!base64) return null;
                const res = await fetch('/api/stock?action=upload-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_base64: base64, filename: 'scan_bs.jpg', contentType: 'image/jpeg' }) });
                const json = await res.json();
                return json.success ? json.url : null;
            };

            const handleCreate = async () => {
                const validItems = form.items.filter(i => i.article && i.quantite);
                if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
                if (form.sortie_type === 'rebut' && !form.motif_rebut) { alert('Motif requis pour le rebut'); return; }
                if (form.sortie_type === 'retour_fournisseur' && !form.lieu_destination) { alert('Sélectionnez un fournisseur'); return; }
                if (form.sortie_type === 'pret' && !form.lieu_destination) { alert('Sélectionnez un lieu de destination'); return; }
                let scanUrl = null;
                if (scanFileBS) { scanUrl = await uploadScanBS(scanFileBS); }
                let justificatifUrl = null;
                if (form.sortie_type === 'rebut' && justificatifFile) { justificatifUrl = await uploadScanBS(justificatifFile); }
                const payload = {
                    type: 'sortie', date: form.date, sortie_type: form.sortie_type,
                    lieu_source: { type: form.lieu_depart_type, id: form.lieu_depart_id },
                    lieu_destination: form.lieu_destination || null,
                    ferme: form.lieu_depart_id,
                    scan_url: scanUrl,
                    items: validItems.map(i => ({ article_ref: i.article, article_nom: i.article, quantite: parseFloat(i.quantite), unite: i.unite })),
                    created_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' },
                };
                if (form.sortie_type === 'rebut') {
                    payload.motif_rebut = form.motif_rebut;
                    payload.justificatif_url = justificatifUrl;
                } else {
                    payload.beneficiaire = form.beneficiaire || null;
                }
                fetch('/api/stock?action=create-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Bon de sortie ' + json.numero + ' créé et validé.'); setShowForm(false); window.location.reload(); }
                    else if (json.code === 'insufficient_stock') alert('⛔ ' + (json.error || 'Stock insuffisant'));
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const statusLabel = (s) => s === 'valide_chef' ? 'Validé' : s === 'en_attente_achats' ? 'À valoriser par Achats' : s === 'valide_mag' ? 'À valider par Achats' : s === 'valide_achats' ? 'À valider par Chef' : s === 'rejete' ? 'Rejeté' : s;
            const statusClass = (s) => s === 'valide_chef' ? 'valide' : s === 'rejete' ? 'rejete' : 'en-attente';
            const sortieTypeLabel = (t) => SORTIE_TYPES.find(s => s.id === t)?.label || t;

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const matchesBS = (s) => {
                if (dateFrom && s.date && s.date < dateFrom) return false;
                if (dateTo && s.date && s.date > dateTo) return false;
                if (filterSource === 'import' && !isImportBS(s)) return false;
                if (filterSource === 'saisie' && isImportBS(s)) return false;
                if (!query) return true;
                const q = query.toLowerCase();
                return (s.numero||'').toLowerCase().includes(q)
                    || (s.lieu_source?.id||'').toLowerCase().includes(q)
                    || (typeof s.lieu_destination === 'string' ? s.lieu_destination : (s.lieu_destination?.id||'')).toLowerCase().includes(q)
                    || (s.items||[]).some(i => (i.article_nom||i.article_ref||'').toLowerCase().includes(q));
            };
            const sortValueBS = (s, field) => {
                if (field === 'numero') return s.numero || '';
                if (field === 'date') return s.date || '';
                if (field === 'depart') return s.lieu_source?.id || s.ferme || '';
                if (field === 'destination') return typeof s.lieu_destination === 'string' ? s.lieu_destination : (s.lieu_destination?.id || '');
                if (field === 'type') return s.sortie_type || '';
                if (field === 'statut') return s.status || '';
                return '';
            };
            const filteredSorties = sorties.filter(matchesBS).slice().sort((a, b) => {
                const va = sortValueBS(a, sortField), vb = sortValueBS(b, sortField);
                if (va < vb) return sortDir === 'asc' ? -1 : 1;
                if (va > vb) return sortDir === 'asc' ? 1 : -1;
                // Tie-break par numéro pour garder les lignes d'un même bon groupées
                const na = a.numero || '', nb = b.numero || '';
                if (na < nb) return sortDir === 'asc' ? -1 : 1;
                if (na > nb) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
            const toggleSort = (field) => {
                if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                else { setSortField(field); setSortDir('asc'); }
            };
            const sortArrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            const sortThStyle = { cursor: 'pointer', userSelect: 'none' };
            const bsDestination = (s) => typeof s.lieu_destination === 'string' ? s.lieu_destination : (s.lieu_destination && s.lieu_destination.id) || '';

            const exportSortiesExcel = () => {
                if (!filteredSorties.length) { alert('Aucun bon à exporter'); return; }
                const aoa = [['N° BS', 'Date', 'Départ', 'Type sortie', 'Destination', 'Bénéficiaire', 'Motif', 'Article', 'Quantité', 'Unité', 'Statut', 'Créé par']];
                filteredSorties.forEach(s => {
                    const base = [
                        s.numero || '',
                        s.date || '',
                        s.lieu_source?.id || s.ferme || '',
                        sortieTypeLabel(s.sortie_type),
                        bsDestination(s),
                        s.beneficiaire || '',
                        s.motif_rebut || '',
                    ];
                    const tail = [statusLabel(s.status), s.created_by?.name || ''];
                    const items = s.items || [];
                    if (!items.length) {
                        aoa.push([...base, '', '', '', ...tail]);
                    } else {
                        items.forEach(i => {
                            aoa.push([...base, i.article_nom || i.article_ref || '', i.quantite != null ? i.quantite : '', i.unite || '', ...tail]);
                        });
                    }
                });
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Bons de Sortie');
                XLSX.writeFile(wb, `Bons_Sortie_${new Date().toISOString().slice(0, 10)}.xlsx`);
            };

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                            <h3 style={{margin:0}}><i className="fa-solid fa-arrow-right-from-bracket" style={{marginRight:8,color:'var(--red)'}}></i>Sorties de Stock ({filteredSorties.length})</h3>
                            <button onClick={exportSortiesExcel} title="Exporter la liste filtrée en Excel"
                                style={{background:'#1d6f42',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontWeight:600,fontSize:12}}>
                                <i className="fa-solid fa-file-excel" style={{marginRight:6}}></i>Export Excel
                            </button>
                        </div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <input type="search" placeholder="Rechercher (n°, article, lieu…)" value={query} onChange={e => setQuery(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,minWidth:240}} />
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Date début" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <span style={{fontSize:11,color:'var(--gray-400)'}}>→</span>
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Date fin" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} title="Source" style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Toutes sources</option>
                                <option value="saisie">Saisie</option>
                                <option value="import">Import</option>
                            </select>
                            {currentProfile === 'magasinier' && <button onClick={() => { setForm({ date: new Date().toISOString().split('T')[0], lieu_depart_type: 'magasin', lieu_depart_id: 'F1', lieu_destination: '', sortie_type: 'retour_fournisseur', beneficiaire: '', motif_rebut: '', items: [{ ...emptyItem }] }); setJustificatifFile(null); setJustificatifPreview(null); setShowForm(true); }}
                                style={{background:'var(--red)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouvelle sortie
                            </button>}
                        </div>
                    </div>
                    <div className="table-responsive"><table className="data-table" style={{fontSize:12}}>
                        <thead><tr>
                            <th style={sortThStyle} onClick={() => toggleSort('numero')}>N°{sortArrow('numero')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('depart')}>Départ{sortArrow('depart')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('destination')}>Destination{sortArrow('destination')}</th>
                            <th>Article</th>
                            <th>Unité</th>
                            <th style={{textAlign:'right'}}>Quantité</th>
                        </tr></thead>
                        <tbody>
                            {filteredSorties.map((s) => {
                                const depart = s.lieu_source?.id || s.ferme || '—';
                                const destination = (typeof s.lieu_destination === 'string' ? s.lieu_destination : (s.lieu_destination?.id || s.beneficiaire)) || '—';
                                const items = (s.items && s.items.length) ? s.items : [null];
                                return items.map((item, itemIndex) => {
                                    const isFirst = itemIndex === 0;
                                    const rowStyle = {
                                        cursor: 'pointer',
                                        borderTop: isFirst ? '2px solid #e0e0e0' : '1px solid #f3f3f3',
                                    };
                                    return (
                                        <tr key={s.id + '_' + itemIndex} onClick={() => setDetailSortie(s)} style={rowStyle}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(231,76,60,0.04)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                                            <td style={{fontWeight:700,color:'var(--red)'}}>{isFirst ? s.numero : ''}</td>
                                            <td>{isFirst ? (s.date || '—') : ''}</td>
                                            <td>{isFirst ? <span className="status-badge" style={{background:'rgba(139,34,82,0.1)',color:'var(--berry)',fontSize:10}}>{depart}</span> : ''}</td>
                                            <td style={{fontSize:11}}>{isFirst ? destination : ''}</td>
                                            <td style={{fontSize:11}}>{item ? (item.article_nom || item.article_ref || item.article || '—') : '—'}</td>
                                            <td style={{fontSize:11}}>{item ? (item.unite || '—') : '—'}</td>
                                            <td style={{fontSize:11,textAlign:'right'}}>{item && item.quantite != null ? item.quantite : '—'}</td>
                                        </tr>
                                    );
                                });
                            })}
                            {filteredSorties.length === 0 && <tr><td colSpan="7" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucune sortie enregistrée.</td></tr>}
                        </tbody>
                    </table></div>

                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:600,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--red)'}}><i className="fa-solid fa-arrow-right-from-bracket" style={{marginRight:8}}></i>Nouvelle Sortie de Stock</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date</label>
                                        <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Lieu de départ *</label>
                                        <div style={{display:'flex',gap:6}}>
                                            <select value={form.lieu_depart_type} onChange={e => setForm({...form, lieu_depart_type: e.target.value, lieu_depart_id: e.target.value === 'magasin' ? MAGASINS[0] : STATIONS[0]})} style={{padding:'8px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                                <option value="magasin">Magasin</option><option value="station">Station</option>
                                            </select>
                                            <select value={form.lieu_depart_id} onChange={e => setForm({...form, lieu_depart_id: e.target.value})} style={{flex:1,padding:'8px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                                {(form.lieu_depart_type === 'magasin' ? MAGASINS : STATIONS).map(l => <option key={l} value={l}>{l}</option>)}
                                            </select>
                                        </div></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Type de sortie *</label>
                                        <select value={form.sortie_type} onChange={e => setForm({...form, sortie_type: e.target.value, lieu_destination: '', beneficiaire: ''})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            {SORTIE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                        </select></div>
                                    {form.sortie_type === 'retour_fournisseur' && (
                                        <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Lieu de destination *</label>
                                            <select value={form.lieu_destination} onChange={e => setForm({...form, lieu_destination: e.target.value, beneficiaire: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                                <option value="">-- Sélectionner un fournisseur --</option>
                                                {suppliers.map(s => <option key={s.id} value={s.nom}>{s.nom}{s.ville ? ' ('+s.ville+')' : ''}</option>)}
                                            </select></div>
                                    )}
                                    {form.sortie_type === 'pret' && (
                                        <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Lieu de destination *</label>
                                            <select value={form.lieu_destination} onChange={e => setForm({...form, lieu_destination: e.target.value, beneficiaire: ''})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                                <option value="">-- Sélectionner un lieu --</option>
                                                <optgroup label="Magasins">{MAGASINS.map(m => <option key={m} value={m}>{m}</option>)}</optgroup>
                                                <optgroup label="Stations">{STATIONS.map(st => <option key={st} value={st}>{st}</option>)}</optgroup>
                                            </select></div>
                                    )}
                                    {form.sortie_type === 'rebut' && (
                                        <div style={{gridColumn:'1 / -1'}}>
                                            <div style={{marginBottom:8}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Lieu de destination (optionnel)</label>
                                                <input value={form.lieu_destination} onChange={e => setForm({...form, lieu_destination: e.target.value})} placeholder="Ex: Décharge publique..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                            <div style={{marginBottom:8}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Motif *</label>
                                                <textarea value={form.motif_rebut} onChange={e => setForm({...form, motif_rebut: e.target.value})} placeholder="Saisir le motif du rebut..." rows={2} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical'}} /></div>
                                            <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Justificatif</label>
                                                <input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; if (f) { if (f.size > 10*1024*1024) { alert('Max 10 Mo'); return; } const r = new FileReader(); r.onload = ev => { setJustificatifFile(ev.target.result); setJustificatifPreview(f.type.startsWith('image/') ? ev.target.result : f.name); }; r.readAsDataURL(f); }}} style={{fontSize:12}} />
                                                {justificatifPreview && (typeof justificatifPreview === 'string' && justificatifPreview.startsWith('data:image') ? <img src={justificatifPreview} alt="Justificatif" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}</div>
                                        </div>
                                    )}
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scanner le bon de sortie</label>
                                    <input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; if (f) { if (f.size > 10*1024*1024) { alert('Max 10 Mo'); return; } const r = new FileReader(); r.onload = ev => { setScanFileBS(ev.target.result); setScanPreviewBS(f.type.startsWith('image/') ? ev.target.result : f.name); }; r.readAsDataURL(f); }}} style={{fontSize:12}} />
                                    {scanPreviewBS && (typeof scanPreviewBS === 'string' && scanPreviewBS.startsWith('data:image') ? <img src={scanPreviewBS} alt="Scan" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}
                                </div>
                                <h4 style={{fontSize:13,marginBottom:8}}>Articles à sortir</h4>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',width:80}}>Qté</th><th style={{padding:'6px 8px',width:70}}>Unité</th><th style={{width:30}}></th></tr></thead>
                                    <tbody>
                                        {form.items.map((it, idx) => (
                                            <tr key={idx}>
                                                <td><input list="articles-list-sortie" value={it.article} onChange={e => updateItem(idx, 'article', e.target.value)} placeholder="Article" style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                    <datalist id="articles-list-sortie">{articles.map(a => <option key={a.reference || a.nom} value={a.nom}>{a.nom}</option>)}</datalist></td>
                                                <td><input type="number" value={it.quantite} onChange={e => updateItem(idx, 'quantite', e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><select value={it.unite} onChange={e => updateItem(idx, 'unite', e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>{['kg', 'L', 'unité', 'carton', 'sac', 'bidon'].map(u => <option key={u} value={u}>{u}</option>)}</select></td>
                                                <td><button onClick={() => removeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <button onClick={addItem} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter article</button>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Créer la sortie</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {detailSortie && (() => {
                        const s = detailSortie;
                        const fmtTs = (v) => {
                            if (!v) return null;
                            try {
                                if (typeof v === 'string') return v.length > 10 ? new Date(v).toLocaleString('fr-FR') : v;
                                if (v.seconds != null) return new Date(v.seconds * 1000).toLocaleString('fr-FR');
                                if (v._seconds != null) return new Date(v._seconds * 1000).toLocaleString('fr-FR');
                                if (v instanceof Date) return v.toLocaleString('fr-FR');
                            } catch (e) { return null; }
                            return null;
                        };
                        const items = s.items || [];
                        const hasParcelle = items.some(i => i.parcelle || i.parcelle_nom);
                        const scan = s.scan_url || '';
                        const isHttpScan = /^https?:\/\//i.test(scan);
                        const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
                        const justif = s.justificatif_url || '';
                        const isHttpJustif = /^https?:\/\//i.test(justif);
                        const isImgJustif = isHttpJustif && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(justif);
                        const infoRow = (label, value) => value == null || value === '' ? null : (
                            <div style={{display:'flex',gap:8,padding:'3px 0'}}>
                                <span style={{minWidth:140,color:'var(--gray-400)',fontSize:12}}>{label}</span>
                                <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{value}</span>
                            </div>
                        );
                        return (
                            <div onClick={() => setDetailSortie(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(2px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                                <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12}}>
                                        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                            <h3 style={{margin:0,color:'var(--red)'}}><i className="fa-solid fa-arrow-right-from-bracket" style={{marginRight:8}}></i>Bon de Sortie {s.numero || ''}</h3>
                                            <span className={'status-badge ' + statusClass(s.status)}>{statusLabel(s.status)}</span>
                                        </div>
                                        <button onClick={() => setDetailSortie(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--gray-400)',lineHeight:1}} title="Fermer">✕</button>
                                    </div>

                                    <div style={{marginBottom:16}}>
                                        {infoRow('Date', s.date)}
                                        {infoRow('Départ', s.lieu_source?.id || s.ferme)}
                                        {infoRow('Type de sortie', sortieTypeLabel(s.sortie_type))}
                                        {infoRow('Destination', bsDestination(s))}
                                        {infoRow('Bénéficiaire', s.beneficiaire)}
                                        {infoRow('Motif', s.motif_rebut)}
                                        {infoRow('Créé par', s.created_by?.name)}
                                        {infoRow('Créé le', fmtTs(s.created_at))}
                                    </div>

                                    {items.length > 0 && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Articles</h4>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                <thead><tr style={{background:'#f8f8f8',textAlign:'left'}}>
                                                    <th style={{padding:'6px 8px'}}>Article</th>
                                                    <th style={{padding:'6px 8px',textAlign:'right'}}>Quantité</th>
                                                    <th style={{padding:'6px 8px'}}>Unité</th>
                                                    {hasParcelle && <th style={{padding:'6px 8px'}}>Parcelle</th>}
                                                </tr></thead>
                                                <tbody>
                                                    {items.map((i, idx) => (
                                                        <tr key={idx} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                            <td style={{padding:'6px 8px'}}>{i.article_nom || i.article_ref || '—'}</td>
                                                            <td style={{padding:'6px 8px',textAlign:'right'}}>{i.quantite != null ? i.quantite : '—'}</td>
                                                            <td style={{padding:'6px 8px'}}>{i.unite || '—'}</td>
                                                            {hasParcelle && <td style={{padding:'6px 8px'}}>{i.parcelle_nom || i.parcelle || '—'}</td>}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {scan && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Scan du bon</h4>
                                            {isImgScan ? (
                                                <a href={scan} target="_blank" rel="noopener noreferrer">
                                                    <img src={scan} alt="Scan du bon" style={{maxWidth:'100%',maxHeight:280,borderRadius:8,border:'1px solid #eee',cursor:'zoom-in'}} />
                                                </a>
                                            ) : isHttpScan ? (
                                                <a href={scan} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)',fontSize:12}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Voir le scan</a>
                                            ) : (
                                                <span style={{fontSize:12,color:'var(--gray-400)'}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Scan disponible (stockage interne)</span>
                                            )}
                                        </div>
                                    )}

                                    {justif && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Justificatif</h4>
                                            {isImgJustif ? (
                                                <a href={justif} target="_blank" rel="noopener noreferrer">
                                                    <img src={justif} alt="Justificatif" style={{maxWidth:'100%',maxHeight:280,borderRadius:8,border:'1px solid #eee',cursor:'zoom-in'}} />
                                                </a>
                                            ) : isHttpJustif ? (
                                                <a href={justif} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)',fontSize:12}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Voir le justificatif</a>
                                            ) : (
                                                <span style={{fontSize:12,color:'var(--gray-400)'}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Justificatif disponible (stockage interne)</span>
                                            )}
                                        </div>
                                    )}

                                    {Array.isArray(s.history) && s.history.length > 0 && (
                                        <div>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Historique</h4>
                                            <ul style={{margin:0,paddingLeft:18,fontSize:12}}>
                                                {s.history.map((h, idx) => (
                                                    <li key={idx} style={{padding:'2px 0'}}>
                                                        {h.action || '—'}{(h.by && (h.by.name || h.by)) ? ' — ' + (h.by.name || h.by) : ''}{fmtTs(h.at) ? ' — ' + fmtTs(h.at) : ''}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

export { MagSortieTab };
