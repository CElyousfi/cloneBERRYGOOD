/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: admin | Déclaration(s): DGMeetingCRTab */
import { PROFILES } from '../shared/PROFILES.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';
import { useToast } from '../shared/useToast.jsx';

// ========== DG MEETING CR TAB ==========
        function DGMeetingCRTab({ currentProfile, profileData }) {
            const [crs, setCrs] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showModal, setShowModal] = useState(false);
            const [viewCr, setViewCr] = useState(null);
            const [saving, setSaving] = useState(false);
            const [editingCr, setEditingCr] = useState(null);
            const [crTasks, setCrTasks] = useState({});
            const { showToast } = useToast();
            const [formData, setFormData] = useState({
                title: '', date: new Date().toISOString().split('T')[0], participants: [], notes: '',
                actionItems: [{ title: '', assignedTo: '', deadline: '' }]
            });

            const loadCRs = async () => {
                try {
                    setLoading(true);
                    const r = await fetch('/api/meeting-cr?action=list');
                    const json = await r.json();
                    if (json.success) {
                        setCrs(json.crs || []);
                        setCrTasks(json.crTasks || {});
                    } else {
                        showToast('Erreur chargement des CR: ' + (json.error || 'Echec'), 'error');
                    }
                } catch (e) {
                    console.warn('Error loading CRs:', e);
                    showToast('Erreur réseau lors du chargement des CR', 'error');
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => { loadCRs(); }, []);

            const openCreate = () => {
                setEditingCr(null);
                setFormData({
                    title: '', date: new Date().toISOString().split('T')[0], participants: [], notes: '',
                    actionItems: [{ title: '', assignedTo: '', deadline: '' }]
                });
                setShowModal(true);
            };

            const openEdit = (cr) => {
                setEditingCr(cr);
                setFormData({
                    title: cr.title, date: cr.date, participants: cr.participants || [], notes: cr.notes || '',
                    actionItems: (cr.actionItems && cr.actionItems.length > 0) ? cr.actionItems.map(a => ({ title: a.title, assignedTo: a.assignedTo, deadline: a.deadline })) : [{ title: '', assignedTo: '', deadline: '' }]
                });
                setShowModal(true);
            };

            const toggleParticipant = (profileId) => {
                setFormData(prev => ({
                    ...prev,
                    participants: prev.participants.includes(profileId)
                        ? prev.participants.filter(p => p !== profileId)
                        : [...prev.participants, profileId]
                }));
            };

            const updateActionItem = (idx, field, value) => {
                setFormData(prev => {
                    const items = [...prev.actionItems];
                    items[idx] = { ...items[idx], [field]: value };
                    return { ...prev, actionItems: items };
                });
            };

            const addActionItem = () => {
                setFormData(prev => ({ ...prev, actionItems: [...prev.actionItems, { title: '', assignedTo: '', deadline: '' }] }));
            };

            const removeActionItem = (idx) => {
                setFormData(prev => ({ ...prev, actionItems: prev.actionItems.filter((_, i) => i !== idx) }));
            };

            const handleSave = async () => {
                if (!formData.title.trim() || !formData.date) return;
                setSaving(true);
                try {
                    const validActions = formData.actionItems.filter(a => a.title.trim() && a.assignedTo && a.deadline).map(a => {
                        const profile = PROFILES.find(p => p.id === a.assignedTo);
                        return { ...a, assignedToName: profile ? profile.fullName || profile.name : a.assignedTo };
                    });

                    const body = {
                        title: formData.title.trim(),
                        date: formData.date,
                        participants: formData.participants,
                        notes: formData.notes.trim(),
                        actionItems: validActions,
                        createdBy: currentProfile,
                    };
                    if (editingCr) body.id = editingCr.id;

                    const r = await fetch('/api/meeting-cr?action=save', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    const json = await r.json();
                    if (json.success) {
                        setShowModal(false);
                        showToast(editingCr ? 'CR modifié avec succès' : 'CR créé avec succès — les tâches ont été assignées', 'success');
                        await loadCRs();
                    } else {
                        showToast('Erreur lors de la sauvegarde : ' + (json.error || 'Echec'), 'error');
                    }
                } catch (e) {
                    console.warn('Error saving CR:', e);
                    showToast('Erreur réseau lors de la sauvegarde', 'error');
                } finally {
                    setSaving(false);
                }
            };

            const handleDeleteCr = async (crId) => {
                if (!confirm('Supprimer ce CR et toutes ses tâches associées ?')) return;
                try {
                    const r = await fetch('/api/meeting-cr?action=delete', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: crId }),
                    });
                    const json = await r.json();
                    if (json.success) {
                        setViewCr(null);
                        showToast('CR supprimé avec succès', 'success');
                        await loadCRs();
                    } else {
                        showToast('Erreur suppression : ' + (json.error || 'Echec'), 'error');
                    }
                } catch (e) {
                    console.warn('Error deleting CR:', e);
                    showToast('Erreur réseau lors de la suppression', 'error');
                }
            };

            const formatDate = (d) => {
                if (!d) return '—';
                const parts = d.split('-');
                return parts[2] + '/' + parts[1] + '/' + parts[0];
            };

            const today = new Date().toISOString().split('T')[0];

            if (loading) return (
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',padding:60}}>
                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:28,color:'var(--berry)'}}></i>
                </div>
            );

            return (
                <div style={{padding:'0 0 40px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                        <h3 style={{margin:0,fontSize:18,color:'var(--gray-800)'}}>
                            <i className="fa-solid fa-file-pen" style={{color:'var(--berry)',marginRight:8}}></i>
                            Comptes-Rendus de Réunions
                        </h3>
                        <button onClick={openCreate} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-plus"></i> Nouveau CR
                        </button>
                    </div>

                    {/* KPI summary */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:12,marginBottom:20}}>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'var(--berry)'}}>{crs.length}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>Total CR</div>
                        </div>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'var(--blue)'}}>{Object.values(crTasks).flat().length}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>Actions créées</div>
                        </div>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'var(--green)'}}>{Object.values(crTasks).flat().filter(t => t.status === 'termine').length}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>Actions terminées</div>
                        </div>
                    </div>

                    {/* CR List */}
                    {crs.length === 0 ? (
                        <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-file-pen" style={{fontSize:40,marginBottom:12,display:'block',opacity:0.3}}></i>
                            Aucun compte-rendu. Créez votre premier CR de réunion.
                        </div>
                    ) : crs.map(cr => {
                        const linkedTasks = crTasks[cr.id] || [];
                        const done = linkedTasks.filter(t => t.status === 'termine').length;
                        const total = linkedTasks.length;
                        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                        return (
                            <div className="cr-card" key={cr.id} onClick={() => setViewCr(cr)}>
                                <div className="cr-header">
                                    <div className="cr-title">
                                        <i className="fa-solid fa-file-pen" style={{color:'var(--berry)',marginRight:8}}></i>
                                        {cr.title}
                                    </div>
                                    <div className="cr-date">
                                        <i className="fa-regular fa-calendar" style={{marginRight:4}}></i>
                                        {formatDate(cr.date)}
                                    </div>
                                </div>
                                <div className="cr-participants">
                                    {(cr.participants || []).map(pid => {
                                        const p = PROFILES.find(pr => pr.id === pid);
                                        return <span className="participant-chip" key={pid}>{p ? p.label : pid}</span>;
                                    })}
                                </div>
                                {cr.notes && <div style={{fontSize:12,color:'var(--gray-600)',marginBottom:8,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'100%'}}>{cr.notes.substring(0, 120)}{cr.notes.length > 120 ? '...' : ''}</div>}
                                <div className="cr-stats">
                                    <span><i className="fa-solid fa-list-check" style={{marginRight:4}}></i>{total} action{total > 1 ? 's' : ''}</span>
                                    <span><i className="fa-solid fa-circle-check" style={{marginRight:4,color:'var(--green)'}}></i>{done} terminée{done > 1 ? 's' : ''}</span>
                                    <span style={{color: pct === 100 ? 'var(--green)' : 'var(--gray-400)'}}>{pct}%</span>
                                </div>
                                {total > 0 && (
                                    <div className="cr-progress"><div className="cr-progress-fill" style={{width: pct + '%'}}></div></div>
                                )}
                            </div>
                        );
                    })}

                    {/* View CR Detail Modal */}
                    {viewCr && (
                        <div className="modal-overlay" onClick={() => setViewCr(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:700}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
                                    <div>
                                        <h3 style={{margin:'0 0 4px',fontSize:18}}>
                                            <i className="fa-solid fa-file-pen" style={{color:'var(--berry)',marginRight:8}}></i>
                                            {viewCr.title}
                                        </h3>
                                        <div style={{fontSize:12,color:'var(--gray-400)'}}>
                                            <i className="fa-regular fa-calendar" style={{marginRight:4}}></i>{formatDate(viewCr.date)}
                                        </div>
                                    </div>
                                    <div style={{display:'flex',gap:6}}>
                                        <button onClick={(e) => { e.stopPropagation(); openEdit(viewCr); setViewCr(null); }} style={{background:'none',border:'1px solid var(--gray-200)',borderRadius:6,padding:'6px 12px',cursor:'pointer',fontSize:12}}>
                                            <i className="fa-solid fa-pen" style={{color:'var(--blue)',marginRight:4}}></i>Modifier
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteCr(viewCr.id); }} style={{background:'none',border:'1px solid var(--gray-200)',borderRadius:6,padding:'6px 12px',cursor:'pointer',fontSize:12}}>
                                            <i className="fa-solid fa-trash" style={{color:'var(--red)',marginRight:4}}></i>Supprimer
                                        </button>
                                        <button onClick={() => setViewCr(null)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'var(--gray-400)'}}>×</button>
                                    </div>
                                </div>

                                {/* Participants */}
                                <div style={{marginBottom:16}}>
                                    <div style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6}}>Participants</div>
                                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                                        {(viewCr.participants || []).map(pid => {
                                            const p = PROFILES.find(pr => pr.id === pid);
                                            return <span key={pid} style={{background:'var(--berry-pale)',color:'var(--berry)',padding:'4px 12px',borderRadius:16,fontSize:12,fontWeight:600}}>{p ? p.label + ' — ' + p.name : pid}</span>;
                                        })}
                                    </div>
                                </div>

                                {/* Notes */}
                                {viewCr.notes && (
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6}}>Notes</div>
                                        <div style={{background:'var(--gray-100)',borderRadius:8,padding:14,fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{viewCr.notes}</div>
                                    </div>
                                )}

                                {/* Action Items with live status */}
                                <div>
                                    <div style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6}}>Plan d'Action</div>
                                    {(crTasks[viewCr.id] || []).length === 0 ? (
                                        <div style={{fontSize:12,color:'var(--gray-400)',padding:12}}>Aucune action définie</div>
                                    ) : (
                                        <table className="data-table" style={{fontSize:12}}>
                                            <thead>
                                                <tr><th>Action</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr>
                                            </thead>
                                            <tbody>
                                                {(crTasks[viewCr.id] || []).map(task => {
                                                    const cs = task.status === 'termine' ? 'termine' : (task.deadline && task.deadline < today ? 'en_retard' : task.status);
                                                    const assignee = PROFILES.find(p => p.id === task.assignedTo);
                                                    return (
                                                        <tr key={task.id}>
                                                            <td style={{fontWeight:600}}>{task.title}</td>
                                                            <td><span style={{background:'var(--berry-pale)',color:'var(--berry)',padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600}}>{assignee ? assignee.label : task.assignedTo}</span></td>
                                                            <td style={{color: cs === 'en_retard' ? 'var(--red)' : 'inherit'}}>{formatDate(task.deadline)}</td>
                                                            <td><span className={`status-badge ${cs}`}>{{ a_faire: 'À faire', en_cours: 'En cours', termine: 'Terminé', en_retard: 'En retard' }[cs]}</span></td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Create/Edit CR Modal */}
                    {showModal && (
                        <div className="modal-overlay" onClick={() => setShowModal(false)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:720}}>
                                <h3 style={{margin:'0 0 20px',fontSize:16}}>
                                    <i className="fa-solid fa-file-pen" style={{color:'var(--berry)',marginRight:8}}></i>
                                    {editingCr ? 'Modifier le CR' : 'Nouveau Compte-Rendu'}
                                </h3>

                                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                                    {/* Info */}
                                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                                        <div>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Titre *</label>
                                            <input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="Titre de la réunion" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                        </div>
                                        <div>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Date *</label>
                                            <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                        </div>
                                    </div>

                                    {/* Participants */}
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:6}}>Participants</label>
                                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))',gap:6}}>
                                            {PROFILES.map(p => (
                                                <label key={p.id} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',borderRadius:8,border:'1px solid ' + (formData.participants.includes(p.id) ? 'var(--berry)' : 'var(--gray-200)'),background: formData.participants.includes(p.id) ? 'var(--berry-pale)' : '#fff',cursor:'pointer',fontSize:12,transition:'all 0.15s'}}>
                                                    <input type="checkbox" checked={formData.participants.includes(p.id)} onChange={() => toggleParticipant(p.id)} style={{display:'none'}} />
                                                    <i className={`fa-solid ${p.icon}`} style={{color: formData.participants.includes(p.id) ? 'var(--berry)' : 'var(--gray-400)',fontSize:12}}></i>
                                                    <span style={{fontWeight:600}}>{p.label}</span>
                                                    <span style={{color:'var(--gray-400)',fontSize:10}}>{p.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Notes / Résumé</label>
                                        <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Résumé de la réunion, points abordés, décisions prises..." rows={6} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,resize:'vertical',boxSizing:'border-box',lineHeight:1.6}} />
                                    </div>

                                    {/* Action Items */}
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:6}}>Plan d'Action</label>
                                        <div style={{display:'flex',flexDirection:'column',gap:8}}>
                                            {formData.actionItems.map((item, idx) => (
                                                <div key={idx} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr auto',gap:8,alignItems:'center'}}>
                                                    <input type="text" value={item.title} onChange={e => updateActionItem(idx, 'title', e.target.value)} placeholder="Action à réaliser" style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                                    <select value={item.assignedTo} onChange={e => updateActionItem(idx, 'assignedTo', e.target.value)} style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                                                        <option value="">Responsable</option>
                                                        {PROFILES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                                    </select>
                                                    <input type="date" value={item.deadline} onChange={e => updateActionItem(idx, 'deadline', e.target.value)} style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}} />
                                                    {formData.actionItems.length > 1 && (
                                                        <button onClick={() => removeActionItem(idx)} style={{background:'none',border:'none',cursor:'pointer',padding:4}}>
                                                            <i className="fa-solid fa-xmark" style={{color:'var(--red)',fontSize:14}}></i>
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <button onClick={addActionItem} style={{marginTop:8,background:'none',border:'1px dashed var(--gray-200)',borderRadius:8,padding:'8px 16px',fontSize:12,color:'var(--berry)',cursor:'pointer',fontWeight:600}}>
                                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i> Ajouter une action
                                        </button>
                                    </div>
                                </div>

                                <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:20}}>
                                    <button onClick={() => setShowModal(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',fontSize:13,cursor:'pointer'}}>Annuler</button>
                                    <button onClick={handleSave} disabled={saving || !formData.title.trim() || !formData.date} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',opacity:(saving || !formData.title.trim() || !formData.date) ? 0.5 : 1}}>
                                        {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Enregistrement...</> : (editingCr ? 'Modifier' : 'Enregistrer & Créer les tâches')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { DGMeetingCRTab };
