/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: magasin | Déclaration(s): MagTransfertTab */
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { useStockLocations } from './useStockLocations.jsx';

// ===================== MAGASINIER: TRANSFERT TAB =====================
        function MagTransfertTab({ currentProfile, profileData }) {
            // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
            const MAGASINS = useStockLocations().magasins;
            const STATIONS = ['Station F1', 'Station F2', 'Station F3', 'Station F4', 'Station F5', 'Station F6'];
            const LIEUX_TRANSFERT = [...MAGASINS, ...STATIONS];
            const [transferts, setTransferts] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [articles, setArticles] = useState([]);
            const [query, setQuery] = useState('');
            const [filterSource, setFilterSource] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');
            const [sortField, setSortField] = useState('date');
            const [sortDir, setSortDir] = useState('desc');
            const [detailTransfert, setDetailTransfert] = useState(null);
            const isImportBT = (t) => (t.numero || '').startsWith('IMP-') || t.created_by?.userId === 'import_caneva';
            const emptyItem = { article: '', quantite: '', unite: 'kg' };
            const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], ref_bon_physique: '', magasin_depart: 'F1', magasin_arrivee: 'F5', items: [{ ...emptyItem }] });
            const [scanFile, setScanFile] = useState(null);
            const [scanPreview, setScanPreview] = useState(null);

            useEffect(() => {
                Promise.all([
                    fetch('/api/stock?action=list-movements&type=transfert&limit=1000').then(r => r.json()),
                    cachedFetch('/api/stock?action=list-articles').then(json => json.success ? (json.articles || []) : []).catch(() => []),
                ]).then(([movJson, arts]) => {
                    if (movJson.success) setTransferts(movJson.movements || []);
                    setArticles(arts.filter(a => a.active !== false));
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };
            const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
            const removeItem = (idx) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_, i) => i !== idx) }); };

            const getLieuType = (lieu) => STATIONS.includes(lieu) ? 'station' : 'magasin';

            const uploadScanBT = async (base64) => {
                if (!base64) return null;
                const res = await fetch('/api/stock?action=upload-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_base64: base64, filename: 'scan_bt.jpg', contentType: 'image/jpeg' }) });
                const json = await res.json();
                return json.success ? json.url : null;
            };

            const handleCreate = async () => {
                if (form.magasin_depart === form.magasin_arrivee) { alert('Le lieu de départ et d\'arrivée doivent être différents'); return; }
                const validItems = form.items.filter(i => i.article && i.quantite);
                if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
                let scanUrl = null;
                if (scanFile) { scanUrl = await uploadScanBT(scanFile); }
                fetch('/api/stock?action=create-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'transfert', date: form.date, ref_bon_physique: form.ref_bon_physique,
                        lieu_source: { type: getLieuType(form.magasin_depart), id: form.magasin_depart },
                        lieu_destination: { type: getLieuType(form.magasin_arrivee), id: form.magasin_arrivee },
                        ferme: form.magasin_depart,
                        scan_url: scanUrl,
                        items: validItems.map(i => ({ article_ref: i.article, article_nom: i.article, quantite: parseFloat(i.quantite), unite: i.unite })),
                        created_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' },
                    }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Transfert ' + json.numero + ' créé et validé.'); setShowForm(false); window.location.reload(); }
                    else if (json.code === 'insufficient_stock') alert('⛔ ' + (json.error || 'Stock insuffisant'));
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const matchesBT = (t) => {
                if (dateFrom && t.date && t.date < dateFrom) return false;
                if (dateTo && t.date && t.date > dateTo) return false;
                if (filterSource === 'import' && !isImportBT(t)) return false;
                if (filterSource === 'saisie' && isImportBT(t)) return false;
                if (!query) return true;
                const q = query.toLowerCase();
                return (t.numero||'').toLowerCase().includes(q)
                    || (t.lieu_source?.id||'').toLowerCase().includes(q)
                    || (t.lieu_destination?.id||'').toLowerCase().includes(q)
                    || (t.ref_bon_physique||'').toLowerCase().includes(q)
                    || (t.items||[]).some(i => (i.article_nom||i.article_ref||'').toLowerCase().includes(q));
            };
            const sortValueBT = (t, field) => {
                if (field === 'numero') return t.numero || '';
                if (field === 'date') return t.date || '';
                if (field === 'depart') return t.lieu_source?.id || '';
                if (field === 'arrivee') return t.lieu_destination?.id || '';
                if (field === 'ref_bon') return t.ref_bon_physique || '';
                return '';
            };
            const filteredTransferts = transferts.filter(matchesBT).slice().sort((a, b) => {
                const va = sortValueBT(a, sortField), vb = sortValueBT(b, sortField);
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

            const exportTransfertsExcel = () => {
                if (!filteredTransferts.length) { alert('Aucun bon à exporter'); return; }
                const aoa = [['N° BT', 'Date', 'Départ', 'Arrivée', 'Réf bon', 'Article', 'Quantité', 'Unité', 'Statut', 'Créé par']];
                filteredTransferts.forEach(t => {
                    const base = [
                        t.numero || '',
                        t.date || '',
                        t.lieu_source?.id || '',
                        t.lieu_destination?.id || '',
                        t.ref_bon_physique || '',
                    ];
                    const tail = [isImportBT(t) ? 'Importé' : 'Validé', t.created_by?.name || ''];
                    const items = t.items || [];
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
                XLSX.utils.book_append_sheet(wb, ws, 'Bons de Transfert');
                XLSX.writeFile(wb, `Bons_Transfert_${new Date().toISOString().slice(0, 10)}.xlsx`);
            };

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                            <h3 style={{margin:0}}><i className="fa-solid fa-right-left" style={{marginRight:8,color:'var(--blue)'}}></i>Transferts Inter-Fermes ({filteredTransferts.length})</h3>
                            <button onClick={exportTransfertsExcel} title="Exporter la liste filtrée en Excel"
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
                            {currentProfile === 'magasinier' && <button onClick={() => { setForm({ date: new Date().toISOString().split('T')[0], ref_bon_physique: '', magasin_depart: 'F1', magasin_arrivee: 'F5', items: [{ ...emptyItem }] }); setShowForm(true); }}
                                style={{background:'var(--blue)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau transfert
                            </button>}
                        </div>
                    </div>
                    <div className="table-responsive"><table className="data-table" style={{fontSize:12}}>
                        <thead><tr>
                            <th style={sortThStyle} onClick={() => toggleSort('numero')}>N°{sortArrow('numero')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('depart')}>Départ{sortArrow('depart')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('arrivee')}>Arrivée{sortArrow('arrivee')}</th>
                            <th>Article</th>
                            <th>Unité</th>
                            <th style={{textAlign:'right'}}>Quantité</th>
                        </tr></thead>
                        <tbody>
                            {filteredTransferts.map((t) => {
                                const depart = t.lieu_source?.id || '—';
                                const arrivee = t.lieu_destination?.id || '—';
                                const items = (t.items && t.items.length) ? t.items : [null];
                                return items.map((item, itemIndex) => {
                                    const isFirst = itemIndex === 0;
                                    const rowStyle = {
                                        cursor: 'pointer',
                                        borderTop: isFirst ? '2px solid #e0e0e0' : '1px solid #f3f3f3',
                                    };
                                    return (
                                        <tr key={t.id + '_' + itemIndex} onClick={() => setDetailTransfert(t)} style={rowStyle}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(45,80,139,0.04)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                                            <td style={{fontWeight:700,color:'var(--blue)'}}>{isFirst ? t.numero : ''}</td>
                                            <td>{isFirst ? (t.date || '—') : ''}</td>
                                            <td>{isFirst ? <span className="status-badge" style={{background:'rgba(231,76,60,0.1)',color:'var(--red)',fontSize:10}}>{depart}</span> : ''}</td>
                                            <td>{isFirst ? <span className="status-badge" style={{background:'rgba(45,139,78,0.1)',color:'var(--green)',fontSize:10}}>{arrivee}</span> : ''}</td>
                                            <td style={{fontSize:11}}>{item ? (item.article_nom || item.article_ref || item.article || '—') : '—'}</td>
                                            <td style={{fontSize:11}}>{item ? (item.unite || '—') : '—'}</td>
                                            <td style={{fontSize:11,textAlign:'right'}}>{item && item.quantite != null ? item.quantite : '—'}</td>
                                        </tr>
                                    );
                                });
                            })}
                            {filteredTransferts.length === 0 && <tr><td colSpan="7" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun transfert enregistré.</td></tr>}
                        </tbody>
                    </table></div>

                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:600,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--blue)'}}><i className="fa-solid fa-right-left" style={{marginRight:8}}></i>Nouveau Transfert Inter-Fermes</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date</label>
                                        <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Réf bon physique</label>
                                        <input value={form.ref_bon_physique} onChange={e => setForm({...form, ref_bon_physique: e.target.value})} placeholder="Référence" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Départ *</label>
                                        <select value={form.magasin_depart} onChange={e => setForm({...form, magasin_depart: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <optgroup label="Magasins">{MAGASINS.map(m => <option key={m} value={m}>{m}</option>)}</optgroup>
                                            <optgroup label="Stations">{STATIONS.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Arrivée *</label>
                                        <select value={form.magasin_arrivee} onChange={e => setForm({...form, magasin_arrivee: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <optgroup label="Magasins">{MAGASINS.filter(m => m !== form.magasin_depart).map(m => <option key={m} value={m}>{m}</option>)}</optgroup>
                                            <optgroup label="Stations">{STATIONS.filter(s => s !== form.magasin_depart).map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
                                        </select></div>
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scanner le bon de transfert physique</label>
                                    <input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; if (f) { if (f.size > 10*1024*1024) { alert('Max 10 Mo'); return; } const r = new FileReader(); r.onload = ev => { setScanFile(ev.target.result); setScanPreview(f.type.startsWith('image/') ? ev.target.result : f.name); }; r.readAsDataURL(f); }}} style={{fontSize:12}} />
                                    {scanPreview && (typeof scanPreview === 'string' && scanPreview.startsWith('data:image') ? <img src={scanPreview} alt="Scan" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}
                                </div>
                                <h4 style={{fontSize:13,marginBottom:8}}>Articles à transférer</h4>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',width:80}}>Qté</th><th style={{padding:'6px 8px',width:70}}>Unité</th><th style={{width:30}}></th></tr></thead>
                                    <tbody>
                                        {form.items.map((it, idx) => (
                                            <tr key={idx}>
                                                <td><input list="articles-list-transfert" value={it.article} onChange={e => updateItem(idx, 'article', e.target.value)} placeholder="Article" style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                    <datalist id="articles-list-transfert">{articles.map(a => <option key={a.reference || a.nom} value={a.nom}>{a.nom}</option>)}</datalist></td>
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
                                    <button onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--blue)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Valider le transfert</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {detailTransfert && (() => {
                        const t = detailTransfert;
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
                        const items = t.items || [];
                        const hasParcelle = items.some(i => i.parcelle || i.parcelle_nom);
                        const scan = t.scan_url || '';
                        const isHttpScan = /^https?:\/\//i.test(scan);
                        const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
                        const infoRow = (label, value) => value == null || value === '' ? null : (
                            <div style={{display:'flex',gap:8,padding:'3px 0'}}>
                                <span style={{minWidth:140,color:'var(--gray-400)',fontSize:12}}>{label}</span>
                                <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{value}</span>
                            </div>
                        );
                        return (
                            <div onClick={() => setDetailTransfert(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(2px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                                <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12}}>
                                        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                            <h3 style={{margin:0,color:'var(--blue)'}}><i className="fa-solid fa-right-left" style={{marginRight:8}}></i>Bon de Transfert {t.numero || ''}</h3>
                                            <span className={'status-badge ' + (isImportBT(t) ? 'valide' : 'valide')}>{isImportBT(t) ? 'Importé' : 'Validé'}</span>
                                        </div>
                                        <button onClick={() => setDetailTransfert(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--gray-400)',lineHeight:1}} title="Fermer">✕</button>
                                    </div>

                                    <div style={{marginBottom:16}}>
                                        {infoRow('Date', t.date)}
                                        {infoRow('Départ', t.lieu_source?.id)}
                                        {infoRow('Arrivée', t.lieu_destination?.id)}
                                        {infoRow('Réf bon physique', t.ref_bon_physique)}
                                        {infoRow('Créé par', t.created_by?.name)}
                                        {infoRow('Créé le', fmtTs(t.created_at))}
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

                                    {Array.isArray(t.history) && t.history.length > 0 && (
                                        <div>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Historique</h4>
                                            <ul style={{margin:0,paddingLeft:18,fontSize:12}}>
                                                {t.history.map((h, idx) => (
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

export { MagTransfertTab };
