/* Module: magasin | Déclaration(s): MagMouvementsTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { useStockLocations } from './useStockLocations.jsx';

import * as StockMovementGuard from '../shared/lib/stockMovementGuard.js';
// ===================== MAGASINIER: MOUVEMENTS HISTORIQUE TAB =====================
        function MagMouvementsTab({ currentProfile, profileData }) {
            const [movements, setMovements] = useState([]);
            const [loading, setLoading] = useState(true);
            // Pre-filter: chef sees "Att. Chef"
            const defaultStatus = ['chef_f1', 'chef_f5', 'chef_avo'].includes(currentProfile) ? 'valide_mag'
                : '';
            const [filterType, setFilterType] = useState('');
            const [filterStatus, setFilterStatus] = useState(defaultStatus);
            const [filterFerme, setFilterFerme] = useState('');
            // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
            const MAGASINS = useStockLocations().magasins;

            const [hideImports, setHideImports] = useState(false);
            const [filterSource, setFilterSource] = useState(''); // '' tous | 'import' | 'saisi'
            const [viewDeleted, setViewDeleted] = useState(false); // vue historique des suppressions
            const [delMov, setDelMov] = useState(null); // bon en cours de suppression (modal motif)
            const [delReason, setDelReason] = useState('');
            const [delSaving, setDelSaving] = useState(false);
            const [query, setQuery] = useState('');
            const [sortField, setSortField] = useState('date');
            const [sortDir, setSortDir] = useState('desc');
            const [editMov, setEditMov] = useState(null); // mouvement en cours d'édition
            const [detailMouvement, setDetailMouvement] = useState(null); // mouvement affiché en lecture seule (popup détail)
            const [editItems, setEditItems] = useState([]);
            const [editDate, setEditDate] = useState('');
            const [editSaving, setEditSaving] = useState(false);
            // Identité du demandeur pour le contrôle créateur (profileId = identité effective).
            const requester = { profileId: currentProfile, userId: (profileData && profileData.userId) || '' };
            const Guard = (typeof window !== 'undefined' && StockMovementGuard) || null;
            const loadMovements = () => {
                setLoading(true);
                let url = '/api/stock?action=list-movements&limit=500';
                if (viewDeleted) url += '&deleted=true';
                if (filterType) url += '&type=' + filterType;
                if (filterStatus && !viewDeleted) url += '&status=' + filterStatus;
                if (filterFerme) url += '&ferme=' + filterFerme;
                fetch(url).then(r => r.json())
                    .then(json => {
                        let movs = json.success ? (json.movements || []) : [];
                        // For chef validation view: only show reception+sortie, exclude imports
                        if (defaultStatus && !filterType && !viewDeleted) {
                            movs = movs.filter(m => (m.type === 'reception' || m.type === 'sortie') && !(m.numero||'').startsWith('IMP-'));
                        }
                        setMovements(movs);
                    })
                    .catch(err => console.warn(err)).finally(() => setLoading(false));
            };
            useEffect(() => { loadMovements(); }, [filterType, filterStatus, filterFerme, viewDeleted]);

            const typeLabels = { reception: 'Réception', transfert: 'Transfert', consommation: 'Consommation', sortie: 'Sortie' };
            const typeColors = { reception: 'var(--green)', transfert: 'var(--blue)', consommation: 'var(--gold)', sortie: 'var(--red)' };
            // Transfert/consommation: stock impact applied immediately, valide_mag = auto-validated
            const needsMultiValid = (t) => t === 'reception' || t === 'sortie';
            const isImport = (m) => (m.numero || '').startsWith('IMP-') || m.created_by?.userId === 'import_caneva';
            // Bon importé du grand livre (insupprimable). Aligné sur le garde-fou backend
            // stockMovementGuard.isImportedMovement : import_source présent / tag CANEVA / IMP-.
            const isImported = (m) => Guard ? Guard.isImportedMovement(m) : (!!m.import_source || isImport(m));
            const isSaisiApp = (m) => !isImported(m);
            const statusLabel = (s, t, m) => {
                if (m && isImport(m)) return 'Importé';
                if (s === 'valide_chef') return 'Validé';
                if (s === 'rejete') return 'Rejeté';
                if (!needsMultiValid(t)) return 'Validé';
                if (s === 'valide_mag') return 'À valider par Achats';
                if (s === 'valide_achats') return 'À valider par Chef';
                return s;
            };
            const statusClass = (s, t, m) => {
                if (s === 'rejete') return 'rejete';
                if ((m && isImport(m)) || s === 'valide_chef' || !needsMultiValid(t)) return 'valide';
                return 'en-attente';
            };

            // Validate/Reject handlers for achats/chef profiles
            const handleValidate = (mov) => {
                if (!confirm('Valider le mouvement ' + mov.numero + ' ?')) return;
                fetch('/api/stock?action=validate-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: mov.id, role: currentProfile, validated_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Mouvement validé (statut: ' + json.status + ')'); loadMovements(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };
            const handleReject = (mov) => {
                const reason = prompt('Motif du rejet :');
                if (!reason) return;
                fetch('/api/stock?action=reject-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: mov.id, role: currentProfile, reason, rejected_by: { profileId: currentProfile, name: profileData?.name || currentProfile, userId: profileData?.userId || '' } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Mouvement rejeté.'); loadMovements(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const canValidate = (mov) => {
                if (isImport(mov)) return false;
                if (!needsMultiValid(mov.type)) return false;
                if (['chef_f1', 'chef_f5', 'chef_avo'].includes(currentProfile) && (mov.status === 'valide_mag' || mov.status === 'valide_achats')) return true;
                return false;
            };

            // Édition/suppression : créateur, bon non importé et non validé (cf. stockMovementGuard).
            const canMutate = (mov) => Guard ? Guard.canEditMovement(mov, requester) : false;
            // Suppression admin Achats/DG : tout bon SAISI app (jamais importé), même validé.
            const isAdminDeleter = Guard ? Guard.isAdminDeleter(requester) : (currentProfile === 'achats' || currentProfile === 'dg');
            const canAdminDelete = (mov) => Guard ? Guard.canAdminDeleteMovement(mov, requester) : false;
            // La colonne Actions s'affiche pour les valideurs (achats/chef) OU dès qu'au
            // moins un bon est mutable par le demandeur courant (son créateur).
            const isValidatorProfile = currentProfile === 'achats' || (currentProfile && currentProfile.startsWith('chef_'));
            const anyMutable = movements.some(canMutate);
            const anyAdminDeletable = isAdminDeleter && movements.some(canAdminDelete);
            const showActionsCol = !viewDeleted && (isValidatorProfile || anyMutable || anyAdminDeletable);

            const openEdit = (mov) => {
                setEditMov(mov);
                setEditDate(mov.date || '');
                setEditItems((mov.items || []).map(i => ({
                    article: i.article_nom || i.article_ref || '',
                    quantite: i.quantite != null ? String(i.quantite) : '',
                    unite: i.unite || 'kg',
                })));
            };
            const closeEdit = () => { setEditMov(null); setEditItems([]); setEditDate(''); };
            const editAddItem = () => setEditItems(its => [...its, { article: '', quantite: '', unite: 'kg' }]);
            const editRemoveItem = (idx) => setEditItems(its => its.filter((_, i) => i !== idx));
            const editSetItem = (idx, field, val) => setEditItems(its => its.map((it, i) => i === idx ? { ...it, [field]: val } : it));

            const handleSaveEdit = async () => {
                const validItems = editItems.filter(i => i.article && i.quantite);
                if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
                setEditSaving(true);
                try {
                    const res = await fetch('/api/stock?action=update-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: editMov.id,
                            patch: {
                                date: editDate || editMov.date,
                                items: validItems.map(i => ({ article_ref: i.article, article_nom: i.article, quantite: parseFloat(i.quantite), unite: i.unite })),
                            },
                        }),
                    });
                    const json = await res.json();
                    if (json.success) { closeEdit(); loadMovements(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                } catch (e) { alert('Erreur réseau'); }
                finally { setEditSaving(false); }
            };

            const handleDelete = (mov) => {
                if (!confirm('Supprimer le bon ' + mov.numero + ' ? Cette action est irréversible (le bon sera retiré des listes).')) return;
                fetch('/api/stock?action=delete-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: mov.id }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Bon supprimé.'); loadMovements(); }
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
                        setMovements(movs => movs.filter(x => x.id !== delMov.id));
                        const msg = 'Bon ' + delMov.numero + ' supprimé' + (json.reversed ? ' (impact stock annulé)' : '') + '.';
                        if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(msg);
                        else alert(msg);
                        closeDelete();
                    } else { alert('Erreur: ' + (json.error || 'Echec')); }
                } catch (e) { alert('Erreur réseau'); }
                finally { setDelSaving(false); }
            };

            const toggleSort = (field) => {
                if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                else { setSortField(field); setSortDir('asc'); }
            };
            const sortArrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            const sortThStyle = { cursor: 'pointer', userSelect: 'none' };
            const getSortVal = (m) => {
                switch (sortField) {
                    case 'numero': return (m.numero || '').toLowerCase();
                    case 'type': return (m.type || '').toLowerCase();
                    case 'source': return (m.lieu_source?.id || '').toLowerCase();
                    case 'destination': return (m.lieu_destination?.id || '').toLowerCase();
                    case 'article': return ((m.items && m.items[0] && (m.items[0].article_nom || m.items[0].article_ref)) || '').toLowerCase();
                    case 'statut': return (m.status || '').toLowerCase();
                    case 'cree_par': return (m.created_by?.name || '').toLowerCase();
                    case 'date':
                    default: return m.date || '';
                }
            };

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0}}><i className={`fa-solid ${defaultStatus ? 'fa-clipboard-check' : 'fa-clock-rotate-left'}`} style={{marginRight:8,color:'var(--berry)'}}></i>{defaultStatus ? 'Validations Stock' : 'Historique Mouvements'} ({movements.length})</h3>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                            <select value={filterType} onChange={e => { setFilterType(e.target.value); setLoading(true); }} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Tous types</option>
                                <option value="reception">Réception</option>
                                <option value="transfert">Transfert</option>
                                <option value="consommation">Consommation</option>
                                <option value="sortie">Sortie</option>
                            </select>
                            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setLoading(true); }} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Tous statuts</option>
                                <option value="valide_mag">À valider par Achats</option>
                                <option value="valide_achats">À valider par Chef</option>
                                <option value="valide_chef">Validé</option>
                                <option value="rejete">Rejeté</option>
                            </select>
                            <input type="search" placeholder="Rechercher (n°, article, lieu…)" value={query} onChange={e => setQuery(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,minWidth:240}} />
                            <select value={filterFerme} onChange={e => { setFilterFerme(e.target.value); setLoading(true); }} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Toutes fermes</option>
                                {MAGASINS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                <option value="">Toutes sources</option>
                                <option value="import">Importé</option>
                                <option value="saisi">Saisi app</option>
                            </select>
                            {!defaultStatus && (
                                <label style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,cursor:'pointer',background: hideImports ? 'rgba(139,34,82,0.08)' : '#fff'}}>
                                    <input type="checkbox" checked={hideImports} onChange={e => setHideImports(e.target.checked)} />
                                    Masquer imports
                                </label>
                            )}
                            {!defaultStatus && (
                                <button onClick={() => setViewDeleted(v => !v)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid '+(viewDeleted?'var(--red)':'#ddd'),fontSize:12,cursor:'pointer',fontWeight:600,background: viewDeleted ? 'rgba(220,53,69,0.1)' : '#fff',color: viewDeleted ? 'var(--red)' : '#444'}}>
                                    <i className="fa-solid fa-trash-can-arrow-up" style={{marginRight:6}}></i>{viewDeleted ? 'Bons actifs' : 'Bons supprimés'}
                                </button>
                            )}
                        </div>
                    </div>

                    {!viewDeleted && (<div className="table-responsive"><table className="data-table" style={{fontSize:12}}>
                        <thead><tr><th style={sortThStyle} onClick={() => toggleSort('numero')}>N°{sortArrow('numero')}</th><th>Source</th><th style={sortThStyle} onClick={() => toggleSort('type')}>Type{sortArrow('type')}</th><th style={sortThStyle} onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th><th style={sortThStyle} onClick={() => toggleSort('source')}>Lieu source{sortArrow('source')}</th><th style={sortThStyle} onClick={() => toggleSort('destination')}>Destination{sortArrow('destination')}</th><th style={sortThStyle} onClick={() => toggleSort('article')}>Articles{sortArrow('article')}</th><th style={sortThStyle} onClick={() => toggleSort('statut')}>Statut{sortArrow('statut')}</th><th style={sortThStyle} onClick={() => toggleSort('cree_par')}>Créé par{sortArrow('cree_par')}</th>{showActionsCol && <th>Actions</th>}</tr></thead>
                        <tbody>
                            {movements.filter(m => !hideImports || !isImport(m)).filter(m => filterSource === 'import' ? isImported(m) : filterSource === 'saisi' ? isSaisiApp(m) : true).filter(m => { if (!query) return true; const q = query.toLowerCase(); return (m.numero||'').toLowerCase().includes(q) || (m.lieu_source?.id||'').toLowerCase().includes(q) || (m.lieu_destination?.id||'').toLowerCase().includes(q) || (m.created_by?.name||'').toLowerCase().includes(q) || (m.items||[]).some(i => (i.article_nom||i.article_ref||'').toLowerCase().includes(q)); }).slice().sort((a, b) => { const va = getSortVal(a), vb = getSortVal(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return sortDir === 'asc' ? c : -c; }).map((m) => (
                                <tr key={m.id} onClick={() => setDetailMouvement(m)} style={{cursor:'pointer'}} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,34,82,0.04)'; }} onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                                    <td style={{fontWeight:700,color: typeColors[m.type] || '#666'}}>{m.numero}</td>
                                    <td>{isImported(m)
                                        ? <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:10,background:'#eee',color:'#777'}}>Importé</span>
                                        : <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:10,background:'rgba(139,34,82,0.12)',color:'var(--berry)'}}>Saisi app</span>}</td>
                                    <td><span style={{color: typeColors[m.type] || '#666',fontWeight:600,fontSize:11}}>{typeLabels[m.type] || m.type}</span></td>
                                    <td>{m.date}</td>
                                    <td style={{fontSize:11}}>{m.lieu_source ? m.lieu_source.id : '—'}</td>
                                    <td style={{fontSize:11}}>{m.lieu_destination ? m.lieu_destination.id : '—'}</td>
                                    <td style={{fontSize:11}}>{(m.items||[]).map(i => (i.article_nom||i.article_ref) + ' (' + i.quantite + ')').join(', ')}</td>
                                    <td><span className={'status-badge ' + statusClass(m.status, m.type, m)}>{statusLabel(m.status, m.type, m)}</span>
                                        {m.rejection && <div style={{fontSize:10,color:'var(--red)',marginTop:2}}>Motif: {m.rejection.reason}</div>}
                                    </td>
                                    <td style={{fontSize:11}}>{m.created_by?.name || '—'}</td>
                                    {showActionsCol && (
                                        <td onClick={e => e.stopPropagation()}>
                                            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                                                {canValidate(m) && (<>
                                                    <button onClick={e => { e.stopPropagation(); handleValidate(m); }} style={{padding:'3px 8px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontSize:10,fontWeight:600}}>Valider</button>
                                                    <button onClick={e => { e.stopPropagation(); handleReject(m); }} style={{padding:'3px 8px',borderRadius:6,border:'none',background:'var(--red)',color:'#fff',cursor:'pointer',fontSize:10,fontWeight:600}}>Rejeter</button>
                                                </>)}
                                                {canMutate(m) && (
                                                    <button onClick={e => { e.stopPropagation(); openEdit(m); }} title="Modifier" style={{padding:'3px 8px',borderRadius:6,border:'1px solid var(--blue)',background:'#fff',color:'var(--blue)',cursor:'pointer',fontSize:10,fontWeight:600}}><i className="fa-solid fa-pen" style={{marginRight:3}}></i>Modifier</button>
                                                )}
                                                {canMutate(m) && !isAdminDeleter && (
                                                    <button onClick={e => { e.stopPropagation(); handleDelete(m); }} title="Supprimer" style={{padding:'3px 8px',borderRadius:6,border:'1px solid var(--red)',background:'#fff',color:'var(--red)',cursor:'pointer',fontSize:10,fontWeight:600}}><i className="fa-solid fa-trash" style={{marginRight:3}}></i>Supprimer</button>
                                                )}
                                                {canAdminDelete(m) && (
                                                    <button onClick={e => { e.stopPropagation(); openDelete(m); }} title="Supprimer (Achats/DG)" style={{padding:'3px 8px',borderRadius:6,border:'1px solid var(--red)',background:'#fff',color:'var(--red)',cursor:'pointer',fontSize:10,fontWeight:600}}><i className="fa-solid fa-trash" style={{marginRight:3}}></i>Supprimer</button>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {movements.length === 0 && <tr><td colSpan={showActionsCol ? 10 : 9} style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun mouvement trouvé.</td></tr>}
                        </tbody>
                    </table></div>)}

                    {viewDeleted && (<div className="table-responsive"><table className="data-table" style={{fontSize:12}}>
                        <thead><tr><th>N°</th><th>Type</th><th>Date</th><th>Articles</th><th>Supprimé par</th><th>Date suppression</th><th>Motif</th></tr></thead>
                        <tbody>
                            {movements.filter(m => filterSource === 'import' ? isImported(m) : filterSource === 'saisi' ? isSaisiApp(m) : true).filter(m => { if (!query) return true; const q = query.toLowerCase(); return (m.numero||'').toLowerCase().includes(q) || (m.created_by?.name||'').toLowerCase().includes(q) || (m.items||[]).some(i => (i.article_nom||i.article_ref||'').toLowerCase().includes(q)); }).map((m) => {
                                const delBy = m.deleted_by ? (m.deleted_by.profileId || m.deleted_by.userId || '—') : '—';
                                let delAt = '—';
                                if (m.deleted_at) { try { delAt = new Date(typeof m.deleted_at === 'number' ? m.deleted_at : (m.deleted_at.seconds ? m.deleted_at.seconds * 1000 : m.deleted_at)).toLocaleString('fr-FR'); } catch (e) { delAt = '—'; } }
                                return (
                                    <tr key={m.id}>
                                        <td style={{fontWeight:700,color: typeColors[m.type] || '#666'}}>{m.numero}</td>
                                        <td><span style={{color: typeColors[m.type] || '#666',fontWeight:600,fontSize:11}}>{typeLabels[m.type] || m.type}</span></td>
                                        <td>{m.date}</td>
                                        <td style={{fontSize:11}}>{(m.items||[]).map(i => (i.article_nom||i.article_ref) + ' (' + i.quantite + ')').join(', ')}</td>
                                        <td style={{fontSize:11}}>{delBy}</td>
                                        <td style={{fontSize:11}}>{delAt}</td>
                                        <td style={{fontSize:11,color:'#555'}}>{m.deleted_reason || '—'}</td>
                                    </tr>
                                );
                            })}
                            {movements.length === 0 && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun bon supprimé.</td></tr>}
                        </tbody>
                    </table></div>)}

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

                    {editMov && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
                            <div className="modal-content" style={{maxWidth:600,maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-pen" style={{marginRight:8}}></i>Modifier le bon {editMov.numero}</h3>
                                <div style={{background:'#fff8e1',borderRadius:8,padding:10,marginBottom:16,fontSize:12,color:'#8a6d00'}}>
                                    <i className="fa-solid fa-info-circle" style={{marginRight:6}}></i>Bon non validé : aucun impact stock n'a encore été appliqué. Vous pouvez l'ajuster avant validation.
                                </div>
                                <div style={{marginBottom:14}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date</label>
                                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} />
                                </div>
                                <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:6}}>Articles</label>
                                <table className="data-table" style={{fontSize:12,marginBottom:8}}>
                                    <thead><tr><th>Article</th><th style={{width:90}}>Quantité</th><th style={{width:80}}>Unité</th><th style={{width:36}}></th></tr></thead>
                                    <tbody>
                                        {editItems.map((it, idx) => (
                                            <tr key={idx}>
                                                <td><input value={it.article} onChange={e => editSetItem(idx, 'article', e.target.value)} style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><input type="number" value={it.quantite} onChange={e => editSetItem(idx, 'quantite', e.target.value)} style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><input value={it.unite} onChange={e => editSetItem(idx, 'unite', e.target.value)} style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} /></td>
                                                <td><button onClick={() => editRemoveItem(idx)} title="Retirer" style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:13}}><i className="fa-solid fa-xmark"></i></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <button onClick={editAddItem} style={{background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter article</button>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={closeEdit} disabled={editSaving} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleSaveEdit} disabled={editSaving} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>{editSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {detailMouvement && (() => {
                        const m = detailMouvement;
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
                        const items = m.items || [];
                        const hasParcelle = items.some(i => i.parcelle != null && i.parcelle !== '');
                        const hasPrix = items.some(i => i.prix_unitaire != null);
                        const hasMontant = items.some(i => i.montant_ttc != null);
                        const totalTtc = items.reduce((s, i) => s + (typeof i.montant_ttc === 'number' ? i.montant_ttc : 0), 0);
                        const valEntries = m.validations && typeof m.validations === 'object' ? Object.entries(m.validations) : [];
                        const scan = m.scan_url || '';
                        const isHttpScan = /^https?:\/\//i.test(scan);
                        const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
                        const infoRow = (label, value) => value == null || value === '' ? null : (
                            <div style={{display:'flex',gap:8,padding:'3px 0'}}>
                                <span style={{minWidth:140,color:'var(--gray-400)',fontSize:12}}>{label}</span>
                                <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{value}</span>
                            </div>
                        );
                        return (
                            <div onClick={() => setDetailMouvement(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(2px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                                <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12}}>
                                        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                            <h3 style={{margin:0,color:'var(--berry)'}}><i className="fa-solid fa-clock-rotate-left" style={{marginRight:8}}></i>{typeLabels[m.type] || m.type} {m.numero || ''}</h3>
                                            <span className={'status-badge ' + statusClass(m.status, m.type, m)}>{statusLabel(m.status, m.type, m)}</span>
                                        </div>
                                        <button onClick={() => setDetailMouvement(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--gray-400)',lineHeight:1}} title="Fermer">✕</button>
                                    </div>

                                    <div style={{marginBottom:16}}>
                                        {infoRow('Type', typeLabels[m.type] || m.type)}
                                        {infoRow('Date', m.date)}
                                        {infoRow('Source', m.lieu_source ? m.lieu_source.id : null)}
                                        {infoRow('Destination', m.lieu_destination ? m.lieu_destination.id : null)}
                                        {infoRow('Réf BL fournisseur', m.ref_bl_fournisseur)}
                                        {infoRow('Fournisseur', m.fournisseur_nom)}
                                        {infoRow('Type de sortie', m.sortie_type)}
                                        {infoRow('Bénéficiaire', m.beneficiaire)}
                                        {infoRow('Motif', m.motif_rebut)}
                                        {infoRow('Créé par', m.created_by?.name)}
                                        {infoRow('Créé le', fmtTs(m.created_at))}
                                        {m.rejection && infoRow('Motif rejet', m.rejection.reason)}
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
                                                    {hasPrix && <th style={{padding:'6px 8px',textAlign:'right'}}>Prix unit.</th>}
                                                    {hasMontant && <th style={{padding:'6px 8px',textAlign:'right'}}>Montant TTC</th>}
                                                </tr></thead>
                                                <tbody>
                                                    {items.map((i, idx) => (
                                                        <tr key={idx} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                            <td style={{padding:'6px 8px'}}>{i.article_nom || i.article_ref || '—'}</td>
                                                            <td style={{padding:'6px 8px',textAlign:'right'}}>{i.quantite != null ? i.quantite : '—'}</td>
                                                            <td style={{padding:'6px 8px'}}>{i.unite || '—'}</td>
                                                            {hasParcelle && <td style={{padding:'6px 8px'}}>{i.parcelle || '—'}</td>}
                                                            {hasPrix && <td style={{padding:'6px 8px',textAlign:'right'}}>{i.prix_unitaire != null ? i.prix_unitaire : '—'}</td>}
                                                            {hasMontant && <td style={{padding:'6px 8px',textAlign:'right'}}>{i.montant_ttc != null ? i.montant_ttc : '—'}</td>}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                {hasMontant && (
                                                    <tfoot><tr style={{fontWeight:700}}>
                                                        <td style={{padding:'6px 8px'}} colSpan={(hasParcelle ? 1 : 0) + (hasPrix ? 1 : 0) + 3}>Total</td>
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

                                    {Array.isArray(m.history) && m.history.length > 0 && (
                                        <div>
                                            <h4 style={{fontSize:13,margin:'0 0 8px'}}>Historique</h4>
                                            <ul style={{margin:0,paddingLeft:18,fontSize:12}}>
                                                {m.history.map((h, idx) => (
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

export { MagMouvementsTab };
