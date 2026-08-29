/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: magasin | Déclaration(s): MagReceptionTab */
import { CanevaImportSub } from '../caisse/CanevaImportSub.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== MAGASINIER: BONS DE RÉCEPTION (LISTE BR SAISIS) =====================
        function MagReceptionTab({ currentProfile, profileData }) {
            const [receptions, setReceptions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [query, setQuery] = useState('');
            const [filterFerme, setFilterFerme] = useState('');
            const [filterStatus, setFilterStatus] = useState('');
            const [filterSource, setFilterSource] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');
            const [sortField, setSortField] = useState('date');
            const [sortDir, setSortDir] = useState('desc');
            const [subTab, setSubTab] = useState('liste');
            const [canevaPending, setCanevaPending] = useState(0);
            const [detailReception, setDetailReception] = useState(null);
            // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
            const MAGASINS_BR = useStockLocations().magasins;
            const UNITES_BR = ['kg', 'L', 'unité', 'carton', 'sac', 'bidon'];
            const MOTIFS_RECEPTION = ['Livraison urgente', 'Don', 'Retour client', 'Échantillon', 'Régularisation stock'];

            // Garde-fou destination : une valeur hors config stock (ex. BAHIA sur un bon
            // en cours d'édition) reste proposée dans le select, avec avertissement —
            // sinon le select contrôlé se désynchronise sans rien dire au magasinier.
            // Pas de fallback si lib/stockDestinations.js manque : un échec visible vaut
            // mieux qu'une destination hors config imputée silencieusement au 1er magasin.
            const resolveDestBR = window.StockDestinations.resolveDestinationOptions;
            const emptyForm = { date: '', ref_bl_fournisseur: '', magasin: MAGASINS_BR[0] || '', motif: '', motif_autre: '', fournisseur_nom: '', items: [{ article: '', quantite: '', unite: 'kg' }], scan_file: null, scan_preview: null };
            const [showForm, setShowForm] = useState(false);
            const [form, setForm] = useState(emptyForm);
            const [submitting, setSubmitting] = useState(false);
            const [articles, setArticles] = useState([]);
            const [suppliers, setSuppliers] = useState([]);
            // Identité du demandeur pour le contrôle créateur (profileId = identité effective).
            const requester = { profileId: currentProfile, userId: (profileData && profileData.userId) || '' };
            const Guard = (typeof window !== 'undefined' && window.StockMovementGuard) || null;
            const canMutate = (mov) => Guard ? Guard.canEditMovement(mov, requester) : false;
            const isAdminDeleter = Guard ? Guard.isAdminDeleter(requester) : (currentProfile === 'achats' || currentProfile === 'dg');
            const canAdminDelete = (mov) => Guard ? Guard.canAdminDeleteMovement(mov, requester) : false;
            const [delMov, setDelMov] = useState(null);
            const [delReason, setDelReason] = useState('');
            const [delSaving, setDelSaving] = useState(false);

            const loadReceptions = () => {
                setLoading(true);
                let url = '/api/stock?action=list-movements&type=reception&limit=500';
                if (filterFerme) url += '&ferme=' + filterFerme;
                if (filterStatus) url += '&status=' + filterStatus;
                fetch(url).then(r => r.json())
                    .then(json => { if (json.success) setReceptions(json.movements || []); })
                    .catch(err => console.warn(err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadReceptions(); }, [filterFerme, filterStatus]);
            useEffect(() => {
                cachedFetch('/api/stock?action=list-articles').then(json => { if (json.success) setArticles((json.articles || []).filter(a => a.active !== false)); }).catch(() => {});
                cachedFetch('/api/stock?action=list-suppliers&status=valide').then(json => { if (json.success) setSuppliers(json.suppliers || []); }).catch(() => {});
            }, []);

            const updateItem = (idx, field, value) => {
                const items = [...form.items]; items[idx] = { ...items[idx], [field]: value };
                setForm({ ...form, items });
            };
            const addItem = () => setForm({ ...form, items: [...form.items, { article: '', quantite: '', unite: 'kg' }] });
            const removeItem = (idx) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_, i) => i !== idx) }); };

            const handleScanFile = (file) => {
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) { alert('Fichier trop volumineux (max 10 Mo)'); return; }
                const reader = new FileReader();
                reader.onload = (e) => setForm(prev => ({ ...prev, scan_file: e.target.result, scan_preview: file.type.startsWith('image/') ? e.target.result : file.name }));
                reader.readAsDataURL(file);
            };
            const uploadScan = async (base64) => {
                if (!base64) return null;
                const res = await fetch('/api/stock?action=upload-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_base64: base64, filename: 'scan_bl.jpg', contentType: 'image/jpeg' }) });
                const json = await res.json();
                return json.success ? json.url : null;
            };

            const handleCreate = async () => {
                const motifFinal = form.motif === 'Autre' ? (form.motif_autre || '').trim() : form.motif;
                if (!motifFinal) { alert('Motif obligatoire'); return; }
                if (!form.magasin) { alert('Magasin requis'); return; }
                const validItems = form.items.filter(i => i.article && i.quantite);
                if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
                const negative = validItems.find(i => parseFloat(i.quantite) < 0);
                if (negative) { alert('Quantité invalide pour ' + negative.article + ' (doit être ≥ 0)'); return; }
                setSubmitting(true);
                try {
                    const scanUrl = form.scan_file ? await uploadScan(form.scan_file) : null;
                    const res = await fetch('/api/stock?action=create-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'reception',
                            date: form.date || new Date().toISOString().split('T')[0],
                            lieu_destination: { type: 'magasin', id: form.magasin },
                            ferme: form.magasin,
                            ref_bl_fournisseur: form.ref_bl_fournisseur,
                            reception_libre: true, reception_libre_motif: motifFinal,
                            fournisseur_nom: form.fournisseur_nom || null,
                            scan_url: scanUrl,
                            items: validItems.map(i => ({ article_ref: i.article, article_nom: i.article, quantite: parseFloat(i.quantite), unite: i.unite })),
                            created_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' },
                        }),
                    });
                    const json = await res.json();
                    if (json.success) {
                        alert('Réception ' + json.numero + ' créée. En attente de valorisation Achats.');
                        setShowForm(false); setForm(emptyForm); loadReceptions();
                    } else {
                        alert('Erreur: ' + (json.error || 'Echec'));
                    }
                } catch (e) {
                    alert('Erreur réseau');
                } finally {
                    setSubmitting(false);
                }
            };

            const handleDelete = (mov) => {
                if (!confirm('Supprimer le bon ' + mov.numero + ' ? Cette action est irréversible (le bon sera retiré des listes).')) return;
                fetch('/api/stock?action=delete-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: mov.id }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Bon supprimé.'); setDetailReception(null); loadReceptions(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const openDelete = (mov) => { setDelMov(mov); setDelReason(''); };
            const closeDelete = () => { setDelMov(null); setDelReason(''); };
            const submitAdminDelete = async () => {
                const reason = (delReason || '').trim();
                if (!reason) { alert('Le motif de suppression est obligatoire.'); return; }
                setDelSaving(true);
                try {
                    const res = await fetch('/api/stock?action=delete-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: delMov.id, reason }) });
                    const json = await res.json();
                    if (json.success) {
                        const msg = 'Bon ' + delMov.numero + ' supprimé' + (json.reversed ? ' (impact stock annulé)' : '') + '.';
                        if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(msg);
                        else alert(msg);
                        closeDelete();
                        setDetailReception(null);
                        loadReceptions();
                    } else { alert('Erreur: ' + (json.error || 'Echec')); }
                } catch (e) { alert('Erreur réseau'); }
                finally { setDelSaving(false); }
            };

            const isImport = (m) => (m.numero || '').startsWith('IMP-') || m.created_by?.userId === 'import_caneva';
            const statusLabel = (s, m) => {
                if (m && isImport(m)) return 'Importé';
                if (s === 'valide_chef') return 'Validé';
                if (s === 'rejete') return 'Rejeté';
                if (s === 'en_attente_achats') return 'À valoriser par Achats';
                if (s === 'valide_mag') return 'À valider par Achats';
                if (s === 'valide_achats') return 'À valider par Chef';
                return s || '—';
            };
            const statusClass = (s, m) => {
                if (s === 'rejete') return 'rejete';
                if ((m && isImport(m)) || s === 'valide_chef') return 'valide';
                return 'en-attente';
            };

            const matches = (r) => {
                if (dateFrom && r.date && r.date < dateFrom) return false;
                if (dateTo && r.date && r.date > dateTo) return false;
                if (filterSource === 'import' && !isImport(r)) return false;
                if (filterSource === 'saisie' && isImport(r)) return false;
                if (!query) return true;
                const q = query.toLowerCase();
                if ((r.numero || '').toLowerCase().includes(q)) return true;
                if ((r.ref_bl_fournisseur || '').toLowerCase().includes(q)) return true;
                if ((r.fournisseur_nom || '').toLowerCase().includes(q)) return true;
                if ((r.lieu_destination?.id || '').toLowerCase().includes(q)) return true;
                if ((r.reception_libre_motif || '').toLowerCase().includes(q)) return true;
                return (r.items || []).some(i => ((i.article_nom || i.article_ref || '').toLowerCase().includes(q)));
            };
            const sortValue = (r, field) => {
                if (field === 'numero') return r.numero || '';
                if (field === 'date') return r.date || '';
                if (field === 'magasin') return r.lieu_destination?.id || r.ferme || '';
                if (field === 'ref_bl') return r.ref_bl_fournisseur || '';
                if (field === 'type') return isImport(r) ? 'Import' : (r.reception_libre ? 'Libre' : 'BDC');
                if (field === 'statut') return r.status || '';
                if (field === 'cree_par') return r.created_by?.name || '';
                return '';
            };
            const filtered = receptions.filter(matches).slice().sort((a, b) => {
                const va = sortValue(a, sortField), vb = sortValue(b, sortField);
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

            const exportReceptionsExcel = () => {
                if (!filtered.length) { alert('Aucun bon à exporter'); return; }
                const aoa = [['N° BR', 'Date', 'Magasin', 'Réf BL', 'Type', 'Article', 'Quantité', 'Unité', 'Statut', 'Créé par']];
                filtered.forEach(r => {
                    const base = [
                        r.numero || '',
                        r.date || '',
                        r.lieu_destination?.id || r.ferme || '',
                        r.ref_bl_fournisseur || '',
                        typeLabel(r),
                    ];
                    const tail = [statusLabel(r.status, r), r.created_by?.name || ''];
                    const items = r.items || [];
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
                XLSX.utils.book_append_sheet(wb, ws, 'Bons de Réception');
                XLSX.writeFile(wb, `Bons_Reception_${new Date().toISOString().slice(0, 10)}.xlsx`);
            };

            const typeLabel = (r) => {
                if (isImport(r)) return 'Import';
                if (r.reception_libre && r.single_validation) return 'Entrée libre';
                if (r.reception_libre) return 'Libre';
                return 'BDC';
            };

            const canImportCaneva = ['achats', 'finance', 'dg'].includes(currentProfile);
            useEffect(() => {
                if (!canImportCaneva) return;
                fetch('/api/stock?action=import-caneva-stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'list' }) })
                    .then(r => r.json()).then(j => { if (j.success) setCanevaPending(j.pending || 0); }).catch(() => {});
            }, [canImportCaneva, subTab]);
            const tabBar = canImportCaneva ? (
                <div style={{display:'flex',gap:8,marginBottom:16}}>
                    {[{id:'liste',label:'Bons de Réception',icon:'fa-truck-ramp-box'},{id:'import',label:'Import canevas',icon:'fa-file-import'}].map(t => (
                        <button key={t.id} onClick={() => setSubTab(t.id)}
                            style={{padding:'7px 14px',borderRadius:20,border: subTab===t.id?'2px solid var(--berry)':'1px solid #ddd',background: subTab===t.id?'rgba(139,34,82,0.08)':'#fff',color: subTab===t.id?'var(--berry)':'#666',fontWeight: subTab===t.id?700:500,fontSize:12,cursor:'pointer'}}>
                            <i className={'fa-solid '+t.icon} style={{marginRight:6}}></i>{t.label}
                            {t.id==='import' && canevaPending>0 && <span style={{marginLeft:6,background:'var(--red)',color:'#fff',borderRadius:10,padding:'1px 7px',fontSize:10}}>{canevaPending}</span>}
                        </button>
                    ))}
                </div>
            ) : null;

            if (subTab === 'import' && canImportCaneva) {
                return (<div className="fade-in">{tabBar}<CanevaImportSub currentProfile={currentProfile} profileData={profileData} onDone={() => loadReceptions()} /></div>);
            }

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    {tabBar}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                            <h3 style={{margin:0}}><i className="fa-solid fa-truck-ramp-box" style={{marginRight:8,color:'var(--berry)'}}></i>Bons de Réception ({filtered.length})</h3>
                            <button onClick={exportReceptionsExcel} title="Exporter la liste filtrée en Excel"
                                style={{background:'#1d6f42',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontWeight:600,fontSize:12}}>
                                <i className="fa-solid fa-file-excel" style={{marginRight:6}}></i>Export Excel
                            </button>
                        </div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <input type="search" placeholder="Rechercher (n°, article, fournisseur, motif…)" value={query} onChange={e => setQuery(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,minWidth:240}} />
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Date début" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <span style={{fontSize:11,color:'var(--gray-400)'}}>→</span>
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Date fin" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                            <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Toutes fermes</option>
                                {MAGASINS_BR.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Tous statuts</option>
                                <option value="valide_mag">À valider par Achats</option>
                                <option value="valide_achats">À valider par Chef</option>
                                <option value="valide_chef">Validé</option>
                                <option value="rejete">Rejeté</option>
                            </select>
                            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} title="Source" style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Toutes sources</option>
                                <option value="saisie">Saisie</option>
                                <option value="import">Import</option>
                            </select>
                            {currentProfile === 'magasinier' && (
                                <button onClick={() => { setForm({ ...emptyForm, date: new Date().toISOString().split('T')[0] }); setShowForm(true); }}
                                    style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                    <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau bon d'entrée
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="table-responsive"><table className="data-table" style={{fontSize:12}}>
                        <thead><tr>
                            <th style={sortThStyle} onClick={() => toggleSort('numero')}>N° BR{sortArrow('numero')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
                            <th style={sortThStyle} onClick={() => toggleSort('magasin')}>Lieu (dest.){sortArrow('magasin')}</th>
                            <th>Fournisseur</th>
                            <th>Article</th>
                            <th>Unité</th>
                            <th style={{textAlign:'right'}}>Quantité</th>
                        </tr></thead>
                        <tbody>
                            {filtered.map((r) => {
                                const lieuDest = r.lieu_destination?.id || r.ferme || '—';
                                const fournisseur = r.fournisseur_nom || '—';
                                const items = (r.items && r.items.length) ? r.items : [null];
                                return items.map((item, itemIndex) => {
                                    const isFirst = itemIndex === 0;
                                    const rowStyle = {
                                        cursor: 'pointer',
                                        borderTop: isFirst ? '2px solid #e0e0e0' : '1px solid #f3f3f3',
                                    };
                                    return (
                                        <tr key={r.id + '_' + itemIndex} onClick={() => setDetailReception(r)} style={rowStyle}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,34,82,0.04)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                                            <td style={{fontWeight:700,color:'var(--berry)'}}>{isFirst ? r.numero : ''}</td>
                                            <td>{isFirst ? (r.date || '—') : ''}</td>
                                            <td>{isFirst ? <span className="status-badge" style={{background:'rgba(139,34,82,0.1)',color:'var(--berry)',fontSize:10}}>{lieuDest}</span> : ''}</td>
                                            <td style={{fontSize:11}}>{isFirst ? fournisseur : ''}</td>
                                            <td style={{fontSize:11}}>{item ? (item.article_nom || item.article_ref || item.article || '—') : '—'}</td>
                                            <td style={{fontSize:11}}>{item ? (item.unite || '—') : '—'}</td>
                                            <td style={{fontSize:11,textAlign:'right'}}>{item && item.quantite != null ? item.quantite : '—'}</td>
                                        </tr>
                                    );
                                });
                            })}
                            {filtered.length === 0 && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun bon de réception trouvé.</td></tr>}
                        </tbody>
                    </table></div>

                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
                            <div className="modal-content" style={{maxWidth:650,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-plus-circle" style={{marginRight:8}}></i>Nouveau bon d'entrée</h3>
                                <div style={{background:'#e8f5e9',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#1b5e20'}}>
                                    <i className="fa-solid fa-info-circle" style={{marginRight:6}}></i>Saisie directe d'une entrée en stock. Sera validée immédiatement et impactera les soldes.
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date</label>
                                        <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    {(() => {
                                        const destBR = resolveDestBR(MAGASINS_BR, form.magasin);
                                        const warnBR = destBR.warning && (destBR.options.find(o => o.value === form.magasin) || {}).horsConfig;
                                        return (
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Magasin destination *</label>
                                        <select value={form.magasin} onChange={e => setForm({...form, magasin: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid ' + (warnBR ? '#b45309' : '#ddd'),fontSize:13}}>
                                            {destBR.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                        {warnBR && <div style={{marginTop:4,fontSize:11,color:'#b45309',lineHeight:1.4}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>{destBR.warning}</div>}
                                    </div>
                                        );
                                    })()}
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Fournisseur</label>
                                        <select value={form.fournisseur_nom} onChange={e => setForm({...form, fournisseur_nom: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="">-- Sélectionner --</option>
                                            {suppliers.map(s => <option key={s.id} value={s.nom}>{s.nom}{s.ville ? ' ('+s.ville+')' : ''}</option>)}
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Réf BL Fournisseur</label>
                                        <input value={form.ref_bl_fournisseur} onChange={e => setForm({...form, ref_bl_fournisseur: e.target.value})} placeholder="Référence" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Motif / Justification *</label>
                                        <select value={form.motif} onChange={e => setForm({...form, motif: e.target.value, motif_autre: ''})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="">-- Sélectionner --</option>
                                            {MOTIFS_RECEPTION.map(m => <option key={m} value={m}>{m}</option>)}
                                            <option value="Autre">Autre (à préciser)</option>
                                        </select></div>
                                    {form.motif === 'Autre' && (
                                        <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Préciser le motif *</label>
                                            <input value={form.motif_autre} onChange={e => setForm({...form, motif_autre: e.target.value})} placeholder="Précisez..." style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    )}
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scanner le BL fournisseur</label>
                                    <input type="file" accept="image/*,application/pdf" onChange={e => handleScanFile(e.target.files[0])} style={{fontSize:12}} />
                                    {form.scan_preview && (typeof form.scan_preview === 'string' && form.scan_preview.startsWith('data:image') ? <img src={form.scan_preview} alt="Scan" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}
                                </div>
                                <h4 style={{fontSize:13,marginBottom:8}}>Articles reçus</h4>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',width:80}}>Qté</th><th style={{padding:'6px 8px',width:70}}>Unité</th><th style={{width:30}}></th></tr></thead>
                                    <tbody>
                                        {form.items.map((it, idx) => (
                                            <tr key={idx}>
                                                <td><input list="articles-list-bon-entree" value={it.article} onChange={e => updateItem(idx, 'article', e.target.value)} placeholder="Article" style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                    <datalist id="articles-list-bon-entree">{articles.map(a => <option key={a.reference || a.nom} value={a.nom}>{a.nom}</option>)}</datalist></td>
                                                <td><input type="number" value={it.quantite} min="0" onChange={e => updateItem(idx, 'quantite', e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><select value={it.unite} onChange={e => updateItem(idx, 'unite', e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>{UNITES_BR.map(u => <option key={u} value={u}>{u}</option>)}</select></td>
                                                <td><button onClick={() => removeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <button onClick={addItem} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--berry)'}}>+ Ajouter article</button>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowForm(false)} disabled={submitting} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:submitting?'not-allowed':'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreate} disabled={submitting} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:submitting?'not-allowed':'pointer',fontWeight:600,fontSize:13,opacity:submitting?0.6:1}}>
                                        {submitting ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Création...</> : 'Créer le bon d\'entrée'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {detailReception && (() => {
                        const r = detailReception;
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
                        const items = r.items || [];
                        const hasPrix = items.some(i => i.prix_unitaire != null);
                        const hasMontant = items.some(i => i.montant_ttc != null);
                        const totalTtc = items.reduce((s, i) => s + (typeof i.montant_ttc === 'number' ? i.montant_ttc : 0), 0);
                        const valEntries = r.validations && typeof r.validations === 'object' ? Object.entries(r.validations) : [];
                        const scan = r.scan_url || '';
                        const isHttpScan = /^https?:\/\//i.test(scan);
                        const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
                        const infoRow = (label, value) => value == null || value === '' ? null : (
                            <div style={{display:'flex',gap:8,padding:'3px 0'}}>
                                <span style={{minWidth:140,color:'var(--gray-400)',fontSize:12}}>{label}</span>
                                <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{value}</span>
                            </div>
                        );
                        return (
                            <div onClick={() => setDetailReception(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(2px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                                <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12}}>
                                        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                            <h3 style={{margin:0,color:'var(--berry)'}}><i className="fa-solid fa-truck-ramp-box" style={{marginRight:8}}></i>Bon de Réception {r.numero || ''}</h3>
                                            <span className={'status-badge ' + statusClass(r.status, r)}>{statusLabel(r.status, r)}</span>
                                        </div>
                                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                                            {(canMutate(r) || (isAdminDeleter && canAdminDelete(r))) && (
                                                <button onClick={() => canMutate(r) ? handleDelete(r) : openDelete(r)} style={{background:'none',border:'1px solid var(--red)',color:'var(--red)',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,fontWeight:600}} title="Supprimer">
                                                    <i className="fa-solid fa-trash" style={{marginRight:4}}></i>Supprimer
                                                </button>
                                            )}
                                            <button onClick={() => setDetailReception(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--gray-400)',lineHeight:1}} title="Fermer">✕</button>
                                        </div>
                                    </div>

                                    <div style={{marginBottom:16}}>
                                        {infoRow('Date', r.date)}
                                        {infoRow('Magasin', r.lieu_destination?.id || r.ferme)}
                                        {infoRow('Type', typeLabel(r))}
                                        {infoRow('Réf BL fournisseur', r.ref_bl_fournisseur)}
                                        {infoRow('Fournisseur', r.fournisseur_nom)}
                                        {infoRow('Motif', r.reception_libre_motif || r.motif)}
                                        {infoRow('Créé par', r.created_by?.name)}
                                        {infoRow('Créé le', fmtTs(r.created_at))}
                                    </div>

                                    {items.length > 0 && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Articles</h4>
                                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                                <thead><tr style={{background:'#f8f8f8',textAlign:'left'}}>
                                                    <th style={{padding:'6px 8px'}}>Article</th>
                                                    <th style={{padding:'6px 8px',textAlign:'right'}}>Quantité</th>
                                                    <th style={{padding:'6px 8px'}}>Unité</th>
                                                    {hasPrix && <th style={{padding:'6px 8px',textAlign:'right'}}>Prix unit.</th>}
                                                    {hasMontant && <th style={{padding:'6px 8px',textAlign:'right'}}>Montant TTC</th>}
                                                </tr></thead>
                                                <tbody>
                                                    {items.map((i, idx) => (
                                                        <tr key={idx} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                            <td style={{padding:'6px 8px'}}>{i.article_nom || i.article_ref || '—'}</td>
                                                            <td style={{padding:'6px 8px',textAlign:'right'}}>{i.quantite != null ? i.quantite : '—'}</td>
                                                            <td style={{padding:'6px 8px'}}>{i.unite || '—'}</td>
                                                            {hasPrix && <td style={{padding:'6px 8px',textAlign:'right'}}>{i.prix_unitaire != null ? i.prix_unitaire : '—'}</td>}
                                                            {hasMontant && <td style={{padding:'6px 8px',textAlign:'right'}}>{i.montant_ttc != null ? i.montant_ttc : '—'}</td>}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                {hasMontant && (
                                                    <tfoot><tr style={{fontWeight:700}}>
                                                        <td style={{padding:'6px 8px'}} colSpan={hasPrix ? 4 : 3}>Total</td>
                                                        <td style={{padding:'6px 8px',textAlign:'right'}}>{totalTtc.toLocaleString('fr-FR')}</td>
                                                    </tr></tfoot>
                                                )}
                                            </table>
                                        </div>
                                    )}

                                    {valEntries.length > 0 && (
                                        <div style={{marginBottom:16}}>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Validations</h4>
                                            <ul style={{margin:0,paddingLeft:18,fontSize:12}}>
                                                {valEntries.map(([role, v]) => (
                                                    <li key={role} style={{padding:'2px 0'}}>
                                                        <strong>{role}</strong> : {(v && v.name) || (v && v.by) || '—'}{v && fmtTs(v.at) ? ' le ' + fmtTs(v.at) : ''}
                                                    </li>
                                                ))}
                                            </ul>
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

                                    {Array.isArray(r.history) && r.history.length > 0 && (
                                        <div>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Historique</h4>
                                            <ul style={{margin:0,paddingLeft:18,fontSize:12}}>
                                                {r.history.map((h, idx) => (
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

                    {delMov && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !delSaving) closeDelete(); }}>
                            <div className="modal-content" style={{maxWidth:480}}>
                                <h3 style={{marginTop:0,color:'var(--red)'}}><i className="fa-solid fa-trash" style={{marginRight:8}}></i>Supprimer le bon {delMov.numero}</h3>
                                <div style={{background:'#fff3f3',borderRadius:8,padding:10,marginBottom:14,fontSize:12,color:'#a11'}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                    {Guard && Guard.isValidatedMovement(delMov)
                                        ? 'Ce bon est validé : sa suppression annulera son impact sur les soldes de stock.'
                                        : 'Le bon sera retiré des listes (soft-delete, traçabilité conservée).'}
                                </div>
                                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Motif de suppression <span style={{color:'var(--red)'}}>*</span></label>
                                <textarea value={delReason} onChange={e => setDelReason(e.target.value)} placeholder="Obligatoire — ex. doublon, erreur de saisie…" rows={3} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical'}} />
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={closeDelete} disabled={delSaving} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={submitAdminDelete} disabled={delSaving || !delReason.trim()} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',cursor: delSaving || !delReason.trim() ? 'not-allowed' : 'pointer',opacity: delSaving || !delReason.trim() ? 0.6 : 1,fontWeight:600,fontSize:13}}>{delSaving ? 'Suppression…' : 'Confirmer la suppression'}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { MagReceptionTab };
