/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: agronomie | Déclaration(s): EvolutionTab */
import { PROFILES } from '../shared/PROFILES.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== EVOLUTION TAB (DG ONLY) =====================
        function EvolutionTab({ currentProfile, profileData, userProfile, isDG }) {
            const [items, setItems] = useState([]);
            const [loading, setLoading] = useState(true);
            const [newText, setNewText] = useState('');
            const [newPriority, setNewPriority] = useState('normale');
            const [saving, setSaving] = useState(false);
            const [filterStatus, setFilterStatus] = useState('all');
            const [editingId, setEditingId] = useState(null);
            const [editText, setEditText] = useState('');
            const [allItems, setAllItems] = useState([]);
            const [expandedProfiles, setExpandedProfiles] = useState({});
            const [validatingId, setValidatingId] = useState(null);
            const [remarqueText, setRemarqueText] = useState('');
            const [addForProfile, setAddForProfile] = useState(() => {
                const first = PROFILES.find(p => p.id !== 'dg');
                return first ? first.id : '';
            });

            const profileLabel = (PROFILES.find(p => p.id === currentProfile) || {}).fullName || currentProfile;

            const loadItems = async () => {
                try {
                    setLoading(true);
                    const db = firebase.firestore();
                    if (isDG) {
                        const snap = await db.collection('evolution_requests')
                            .orderBy('createdAt', 'desc')
                            .get();
                        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        setAllItems(all);
                        setItems(all);
                    } else {
                        const snap = await db.collection('evolution_requests')
                            .where('profileId', '==', currentProfile)
                            .orderBy('createdAt', 'desc')
                            .get();
                        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                    }
                } catch (e) {
                    console.warn('Error loading evolution items:', e);
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => { loadItems(); }, [currentProfile]);

            const handleAdd = async () => {
                if (!newText.trim()) return;
                setSaving(true);
                try {
                    const db = firebase.firestore();
                    await db.collection('evolution_requests').add({
                        profileId: isDG ? addForProfile : currentProfile,
                        text: newText.trim(),
                        priority: newPriority,
                        done: false,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: userProfile.displayName || userProfile.email || 'DG',
                        deliveredAt: null,
                    });
                    setNewText('');
                    setNewPriority('normale');
                    await loadItems();
                } catch (e) {
                    console.warn('Error adding evolution item:', e);
                    alert('Erreur lors de l\'ajout');
                } finally {
                    setSaving(false);
                }
            };

            const toggleDone = async (item) => {
                if (isDG && !item.done) {
                    setValidatingId(item.id);
                    setRemarqueText(item.remarqueDG || '');
                    return;
                }
                try {
                    const db = firebase.firestore();
                    if (item.done) {
                        await db.collection('evolution_requests').doc(item.id).update({
                            done: false,
                            deliveredAt: null,
                            remarqueDG: null,
                        });
                    } else {
                        await db.collection('evolution_requests').doc(item.id).update({
                            done: true,
                            deliveredAt: firebase.firestore.FieldValue.serverTimestamp(),
                        });
                    }
                    await loadItems();
                } catch (e) {
                    console.warn('Error toggling item:', e);
                }
            };

            const confirmValidation = async (itemId) => {
                try {
                    const db = firebase.firestore();
                    await db.collection('evolution_requests').doc(itemId).update({
                        done: true,
                        deliveredAt: firebase.firestore.FieldValue.serverTimestamp(),
                        remarqueDG: remarqueText.trim() || null,
                    });
                    setValidatingId(null);
                    setRemarqueText('');
                    await loadItems();
                } catch (e) {
                    console.warn('Error validating item:', e);
                }
            };

            const handleDelete = async (id) => {
                if (!confirm('Supprimer cette demande ?')) return;
                try {
                    const db = firebase.firestore();
                    await db.collection('evolution_requests').doc(id).delete();
                    await loadItems();
                } catch (e) {
                    console.warn('Error deleting item:', e);
                }
            };

            const handleEditSave = async (id) => {
                if (!editText.trim()) return;
                try {
                    const db = firebase.firestore();
                    await db.collection('evolution_requests').doc(id).update({ text: editText.trim() });
                    setEditingId(null);
                    await loadItems();
                } catch (e) {
                    console.warn('Error editing item:', e);
                }
            };

            const filtered = items.filter(i => {
                if (filterStatus === 'pending') return !i.done;
                if (filterStatus === 'done') return i.done;
                return true;
            });

            const kpis = {
                total: items.length,
                pending: items.filter(i => !i.done).length,
                done: items.filter(i => i.done).length,
            };

            const priorityColor = (p) => ({ haute: 'var(--red)', normale: 'var(--blue)', basse: 'var(--gray-400)' }[p] || 'var(--blue)');
            const priorityLabel = (p) => ({ haute: 'Haute', normale: 'Normale', basse: 'Basse' }[p] || p);

            const formatDate = (ts) => {
                if (!ts) return '—';
                const d = ts.toDate ? ts.toDate() : new Date(ts);
                return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
            };

            const groupedByProfile = isDG ? PROFILES.map(profile => {
                const pItems = allItems.filter(i => i.profileId === profile.id);
                const filteredPItems = pItems.filter(i => {
                    if (filterStatus === 'pending') return !i.done;
                    if (filterStatus === 'done') return i.done;
                    return true;
                });
                return {
                    profile,
                    items: filteredPItems,
                    total: pItems.length,
                    pending: pItems.filter(i => !i.done).length,
                    done: pItems.filter(i => i.done).length,
                };
            }).filter(g => g.total > 0) : [];

            const toggleProfile = (pid) => setExpandedProfiles(prev => ({ ...prev, [pid]: !prev[pid] }));

            const renderItem = (item) => (
                <div key={item.id} style={{
                    background:'white', borderRadius:12, padding:'14px 16px',
                    boxShadow:'0 1px 3px rgba(0,0,0,0.08)',
                    borderLeft: `4px solid ${item.done ? 'var(--green)' : priorityColor(item.priority)}`,
                    opacity: item.done ? 0.7 : 1,
                    display:'flex', alignItems:'flex-start', gap:12
                }}>
                    {isDG && <button
                        onClick={() => toggleDone(item)}
                        title={item.done ? 'Marquer comme non livré' : 'Marquer comme livré'}
                        style={{
                            marginTop:2, width:24, height:24, borderRadius:6, border: item.done ? 'none' : '2px solid #888',
                            background: item.done ? 'var(--green)' : '#d5d5d5', color: item.done ? 'white' : 'transparent', cursor:'pointer',
                            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:12
                        }}
                    >
                        {item.done && <i className="fa-solid fa-check"></i>}
                    </button>}
                    <div style={{flex:1, minWidth:0}}>
                        {editingId === item.id ? (
                            <div style={{display:'flex', gap:8}}>
                                <input type="text" value={editText} onChange={e => setEditText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleEditSave(item.id); if (e.key === 'Escape') setEditingId(null); }}
                                    style={{flex:1, padding:'6px 10px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:14}}
                                    autoFocus
                                />
                                <button onClick={() => handleEditSave(item.id)} style={{padding:'6px 12px', borderRadius:6, background:'var(--berry)', color:'white', border:'none', fontSize:12, cursor:'pointer'}}>OK</button>
                                <button onClick={() => setEditingId(null)} style={{padding:'6px 12px', borderRadius:6, background:'var(--gray-100)', border:'none', fontSize:12, cursor:'pointer'}}>Annuler</button>
                            </div>
                        ) : (
                            <div style={{fontSize:14, textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--gray-400)' : 'var(--gray-800)', lineHeight:1.4}}>
                                {item.text}
                            </div>
                        )}
                        <div style={{display:'flex', gap:10, marginTop:6, fontSize:11, color:'var(--gray-400)', flexWrap:'wrap', alignItems:'center'}}>
                            <span style={{background: `${priorityColor(item.priority)}18`, color: priorityColor(item.priority), padding:'2px 8px', borderRadius:10, fontWeight:600, fontSize:10}}>
                                {priorityLabel(item.priority)}
                            </span>
                            <span><i className="fa-regular fa-calendar" style={{marginRight:3}}></i>{formatDate(item.createdAt)}</span>
                            {item.done && item.deliveredAt && (
                                <span style={{color:'var(--green)'}}><i className="fa-solid fa-check-circle" style={{marginRight:3}}></i>Livré le {formatDate(item.deliveredAt)}</span>
                            )}
                        </div>
                        {item.remarqueDG && (
                            <div style={{marginTop:6, padding:'6px 10px', background:'rgba(59,130,246,0.06)', borderRadius:8, fontSize:12, color:'var(--gray-600)', fontStyle:'italic'}}>
                                <i className="fa-solid fa-comment-dots" style={{marginRight:4, color:'var(--blue)'}}></i>
                                Remarque DG : {item.remarqueDG}
                            </div>
                        )}
                        {validatingId === item.id && (
                            <div style={{marginTop:8, padding:10, background:'rgba(139,34,82,0.04)', borderRadius:8, border:'1px solid rgba(139,34,82,0.12)'}}>
                                <div style={{fontSize:12, fontWeight:600, marginBottom:6, color:'var(--berry)'}}>
                                    <i className="fa-solid fa-pen-to-square" style={{marginRight:4}}></i>Remarque (optionnelle)
                                </div>
                                <textarea
                                    value={remarqueText}
                                    onChange={e => setRemarqueText(e.target.value)}
                                    placeholder="Ajouter une remarque..."
                                    rows={2}
                                    style={{width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:13, resize:'vertical', outline:'none', boxSizing:'border-box'}}
                                    autoFocus
                                />
                                <div style={{display:'flex', gap:8, marginTop:6}}>
                                    <button onClick={() => confirmValidation(item.id)} style={{padding:'6px 16px', borderRadius:6, background:'var(--green)', color:'white', border:'none', fontSize:12, fontWeight:600, cursor:'pointer'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider
                                    </button>
                                    <button onClick={() => { setValidatingId(null); setRemarqueText(''); }} style={{padding:'6px 16px', borderRadius:6, background:'var(--gray-100)', border:'none', fontSize:12, cursor:'pointer'}}>Annuler</button>
                                </div>
                            </div>
                        )}
                    </div>
                    {isDG && <div style={{display:'flex', gap:4, flexShrink:0}}>
                        {!item.done && (
                            <button onClick={() => { setEditingId(item.id); setEditText(item.text); }}
                                style={{width:30, height:30, borderRadius:6, border:'none', background:'var(--gray-100)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center'}}>
                                <i className="fa-solid fa-pen" style={{fontSize:11, color:'var(--gray-500)'}}></i>
                            </button>
                        )}
                        <button onClick={() => handleDelete(item.id)}
                            style={{width:30, height:30, borderRadius:6, border:'none', background:'rgba(220,53,69,0.08)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center'}}>
                            <i className="fa-solid fa-trash" style={{fontSize:11, color:'var(--red)'}}></i>
                        </button>
                    </div>}
                </div>
            );

            if (isDG) {
                return (
                    <div style={{padding: '20px', maxWidth: 1000, margin: '0 auto'}}>
                        <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:20}}>
                            <i className="fa-solid fa-rocket" style={{fontSize:24, color:'var(--berry)'}}></i>
                            <div>
                                <h2 style={{margin:0, fontSize:20}}>Évolutions — Vue globale</h2>
                                <p style={{margin:0, fontSize:13, color:'var(--gray-500)'}}>Suivi des demandes d'améliorations de tous les profils</p>
                            </div>
                        </div>

                        {/* KPIs globaux */}
                        <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:20}}>
                            <div style={{background:'white', borderRadius:12, padding:'16px', textAlign:'center', boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                                <div style={{fontSize:24, fontWeight:700, color:'var(--berry)'}}>{kpis.total}</div>
                                <div style={{fontSize:12, color:'var(--gray-500)'}}>Total demandes</div>
                            </div>
                            <div style={{background:'white', borderRadius:12, padding:'16px', textAlign:'center', boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                                <div style={{fontSize:24, fontWeight:700, color:'var(--gold)'}}>{kpis.pending}</div>
                                <div style={{fontSize:12, color:'var(--gray-500)'}}>En attente</div>
                            </div>
                            <div style={{background:'white', borderRadius:12, padding:'16px', textAlign:'center', boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                                <div style={{fontSize:24, fontWeight:700, color:'var(--green)'}}>{kpis.done}</div>
                                <div style={{fontSize:12, color:'var(--gray-500)'}}>Livrées</div>
                            </div>
                        </div>

                        {/* Add new with profile selector */}
                        <div style={{background:'white', borderRadius:12, padding:16, marginBottom:20, boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                            <div style={{fontSize:14, fontWeight:600, marginBottom:10}}>
                                <i className="fa-solid fa-plus-circle" style={{marginRight:6, color:'var(--berry)'}}></i>
                                Nouvelle demande
                            </div>
                            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                                <select
                                    value={addForProfile}
                                    onChange={e => setAddForProfile(e.target.value)}
                                    style={{padding:'10px 14px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:13, background:'white', minWidth:160}}
                                >
                                    {PROFILES.map(p => (
                                        <option key={p.id} value={p.id}>{p.fullName || p.label}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    value={newText}
                                    onChange={e => setNewText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                                    placeholder="Décrire l'amélioration souhaitée..."
                                    style={{flex:1, minWidth:200, padding:'10px 14px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:14, outline:'none'}}
                                />
                                <select
                                    value={newPriority}
                                    onChange={e => setNewPriority(e.target.value)}
                                    style={{padding:'10px 14px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:13, background:'white'}}
                                >
                                    <option value="haute">Haute</option>
                                    <option value="normale">Normale</option>
                                    <option value="basse">Basse</option>
                                </select>
                                <button
                                    onClick={handleAdd}
                                    disabled={saving || !newText.trim()}
                                    style={{padding:'10px 20px', borderRadius:8, background:'var(--berry)', color:'white', border:'none', fontSize:14, fontWeight:600, cursor:'pointer', opacity: saving || !newText.trim() ? 0.5 : 1}}
                                >
                                    {saving ? 'Ajout...' : 'Ajouter'}
                                </button>
                            </div>
                        </div>

                        {/* Filter */}
                        <div style={{display:'flex', gap:8, marginBottom:16}}>
                            {[{v:'all',l:'Toutes'},{v:'pending',l:'En attente'},{v:'done',l:'Livrées'}].map(f => (
                                <button key={f.v} onClick={() => setFilterStatus(f.v)}
                                    style={{padding:'6px 14px', borderRadius:20, border: filterStatus === f.v ? '2px solid var(--berry)' : '1px solid var(--gray-200)', background: filterStatus === f.v ? 'rgba(139,34,82,0.08)' : 'white', color: filterStatus === f.v ? 'var(--berry)' : 'var(--gray-600)', fontSize:13, fontWeight: filterStatus === f.v ? 600 : 400, cursor:'pointer'}}
                                >{f.l}</button>
                            ))}
                        </div>

                        {/* Grouped by profile */}
                        {loading ? (
                            <div style={{textAlign:'center', padding:40, color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{fontSize:24}}></i>
                                <p>Chargement...</p>
                            </div>
                        ) : groupedByProfile.length === 0 ? (
                            <div style={{textAlign:'center', padding:40, color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-clipboard-list" style={{fontSize:32, marginBottom:8}}></i>
                                <p>Aucune demande d'évolution</p>
                            </div>
                        ) : (
                            <div style={{display:'flex', flexDirection:'column', gap:12}}>
                                {groupedByProfile.map(g => (
                                    <div key={g.profile.id} style={{background:'white', borderRadius:12, boxShadow:'0 1px 3px rgba(0,0,0,0.08)', overflow:'hidden'}}>
                                        <div
                                            onClick={() => toggleProfile(g.profile.id)}
                                            style={{padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:12, background: expandedProfiles[g.profile.id] ? 'rgba(139,34,82,0.03)' : 'white', borderBottom: expandedProfiles[g.profile.id] ? '1px solid var(--gray-100)' : 'none'}}
                                        >
                                            <i className={g.profile.icon || 'fa-solid fa-user'} style={{fontSize:16, color:'var(--berry)', width:20, textAlign:'center'}}></i>
                                            <div style={{flex:1}}>
                                                <span style={{fontWeight:600, fontSize:14}}>{g.profile.fullName || g.profile.label}</span>
                                            </div>
                                            <div style={{display:'flex', gap:8, alignItems:'center', fontSize:11}}>
                                                {g.pending > 0 && <span style={{background:'rgba(255,193,7,0.12)', color:'var(--gold)', padding:'2px 8px', borderRadius:10, fontWeight:600}}>{g.pending} en attente</span>}
                                                {g.done > 0 && <span style={{background:'rgba(40,167,69,0.1)', color:'var(--green)', padding:'2px 8px', borderRadius:10, fontWeight:600}}>{g.done} livrée{g.done > 1 ? 's' : ''}</span>}
                                                <span style={{background:'var(--gray-100)', padding:'2px 8px', borderRadius:10, fontWeight:600, color:'var(--gray-500)'}}>{g.total}</span>
                                            </div>
                                            <i className={`fa-solid fa-chevron-${expandedProfiles[g.profile.id] ? 'up' : 'down'}`} style={{fontSize:12, color:'var(--gray-400)'}}></i>
                                        </div>
                                        {expandedProfiles[g.profile.id] && (
                                            <div style={{padding:'12px 16px', display:'flex', flexDirection:'column', gap:8}}>
                                                {g.items.length === 0 ? (
                                                    <div style={{textAlign:'center', padding:16, color:'var(--gray-400)', fontSize:13}}>Aucune demande pour ce filtre</div>
                                                ) : g.items.map(item => renderItem(item))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            }

            // Non-DG view
            return (
                <div style={{padding: '20px', maxWidth: 900, margin: '0 auto'}}>
                    <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:20}}>
                        <i className="fa-solid fa-rocket" style={{fontSize:24, color:'var(--berry)'}}></i>
                        <div>
                            <h2 style={{margin:0, fontSize:20}}>Évolutions — {profileLabel}</h2>
                            <p style={{margin:0, fontSize:13, color:'var(--gray-500)'}}>Demandes d'améliorations et suivi de livraison</p>
                        </div>
                    </div>

                    {/* KPIs */}
                    <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:20}}>
                        <div style={{background:'white', borderRadius:12, padding:'16px', textAlign:'center', boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                            <div style={{fontSize:24, fontWeight:700, color:'var(--berry)'}}>{kpis.total}</div>
                            <div style={{fontSize:12, color:'var(--gray-500)'}}>Total demandes</div>
                        </div>
                        <div style={{background:'white', borderRadius:12, padding:'16px', textAlign:'center', boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                            <div style={{fontSize:24, fontWeight:700, color:'var(--gold)'}}>{kpis.pending}</div>
                            <div style={{fontSize:12, color:'var(--gray-500)'}}>En attente</div>
                        </div>
                        <div style={{background:'white', borderRadius:12, padding:'16px', textAlign:'center', boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                            <div style={{fontSize:24, fontWeight:700, color:'var(--green)'}}>{kpis.done}</div>
                            <div style={{fontSize:12, color:'var(--gray-500)'}}>Livrées</div>
                        </div>
                    </div>

                    {/* Filter */}
                    <div style={{display:'flex', gap:8, marginBottom:16}}>
                        {[{v:'all',l:'Toutes'},{v:'pending',l:'En attente'},{v:'done',l:'Livrées'}].map(f => (
                            <button key={f.v} onClick={() => setFilterStatus(f.v)}
                                style={{padding:'6px 14px', borderRadius:20, border: filterStatus === f.v ? '2px solid var(--berry)' : '1px solid var(--gray-200)', background: filterStatus === f.v ? 'rgba(139,34,82,0.08)' : 'white', color: filterStatus === f.v ? 'var(--berry)' : 'var(--gray-600)', fontSize:13, fontWeight: filterStatus === f.v ? 600 : 400, cursor:'pointer'}}
                            >{f.l}</button>
                        ))}
                    </div>

                    {/* List */}
                    {loading ? (
                        <div style={{textAlign:'center', padding:40, color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-spinner fa-spin" style={{fontSize:24}}></i>
                            <p>Chargement...</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div style={{textAlign:'center', padding:40, color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-clipboard-list" style={{fontSize:32, marginBottom:8}}></i>
                            <p>Aucune demande d'évolution</p>
                        </div>
                    ) : (
                        <div style={{display:'flex', flexDirection:'column', gap:8}}>
                            {filtered.map(item => (
                                <div key={item.id} style={{
                                    background:'white', borderRadius:12, padding:'14px 16px',
                                    boxShadow:'0 1px 3px rgba(0,0,0,0.08)',
                                    borderLeft: `4px solid ${item.done ? 'var(--green)' : priorityColor(item.priority)}`,
                                    opacity: item.done ? 0.7 : 1,
                                }}>
                                    <div style={{fontSize:14, color: item.done ? 'var(--gray-400)' : 'var(--gray-800)', lineHeight:1.4, textDecoration: item.done ? 'line-through' : 'none'}}>
                                        {item.text}
                                    </div>
                                    <div style={{display:'flex', gap:10, marginTop:6, fontSize:11, color:'var(--gray-400)', flexWrap:'wrap', alignItems:'center'}}>
                                        <span style={{background: `${priorityColor(item.priority)}18`, color: priorityColor(item.priority), padding:'2px 8px', borderRadius:10, fontWeight:600, fontSize:10}}>
                                            {priorityLabel(item.priority)}
                                        </span>
                                        <span><i className="fa-regular fa-calendar" style={{marginRight:3}}></i>{formatDate(item.createdAt)}</span>
                                        {item.done && item.deliveredAt && (
                                            <span style={{color:'var(--green)'}}><i className="fa-solid fa-check-circle" style={{marginRight:3}}></i>Livré le {formatDate(item.deliveredAt)}</span>
                                        )}
                                    </div>
                                    {item.remarqueDG && (
                                        <div style={{marginTop:6, padding:'6px 10px', background:'rgba(59,130,246,0.06)', borderRadius:8, fontSize:12, color:'var(--gray-600)', fontStyle:'italic'}}>
                                            <i className="fa-solid fa-comment-dots" style={{marginRight:4, color:'var(--blue)'}}></i>
                                            Remarque DG : {item.remarqueDG}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

export { EvolutionTab };
