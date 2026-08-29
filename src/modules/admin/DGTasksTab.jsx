/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: admin | Déclaration(s): DGTasksTab */
import { FarmTodoSection } from '../shared/FarmTodoSection.jsx';
import { PROFILES } from '../shared/PROFILES.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

function DGTasksTab({ currentProfile, profileData }) {
            const [tasks, setTasks] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showModal, setShowModal] = useState(false);
            const [editingTask, setEditingTask] = useState(null);
            const [saving, setSaving] = useState(false);
            const [filterAssignee, setFilterAssignee] = useState('all');
            const [filterStatus, setFilterStatus] = useState('all');
            const [filterPriority, setFilterPriority] = useState('all');
            const [formData, setFormData] = useState({ title: '', description: '', assignedTo: '', priority: 'moyenne', deadline: '' });
            const [confirmDelete, setConfirmDelete] = useState(null);

            const today = new Date().toISOString().split('T')[0];

            const loadTasks = async () => {
                try {
                    setLoading(true);
                    const token = await firebaseAuth.currentUser.getIdToken();
                    const r = await fetch('/api/tasks?action=list', { headers: { 'Authorization': 'Bearer ' + token } });
                    const json = await r.json();
                    if (json.success) setTasks(json.tasks || []);
                } catch (e) {
                    console.warn('Error loading tasks:', e);
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => { loadTasks(); }, []);

            const getComputedStatus = (task) => {
                if (task.status === 'termine') return 'termine';
                if (task.deadline && task.deadline < today) return 'en_retard';
                return task.status;
            };

            const statusLabel = (s) => ({ a_faire: 'À faire', en_cours: 'En cours', termine: 'Terminé', en_retard: 'En retard' }[s] || s);
            const priorityLabel = (p) => ({ haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' }[p] || p);

            const filteredTasks = tasks.filter(t => {
                if (filterAssignee !== 'all' && t.assignedTo !== filterAssignee) return false;
                if (filterStatus !== 'all') {
                    const cs = getComputedStatus(t);
                    if (filterStatus === 'en_retard' && cs !== 'en_retard') return false;
                    if (filterStatus !== 'en_retard' && t.status !== filterStatus) return false;
                }
                if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
                return true;
            });

            const kpis = {
                total: tasks.length,
                a_faire: tasks.filter(t => t.status === 'a_faire' && !(t.deadline && t.deadline < today)).length,
                en_cours: tasks.filter(t => t.status === 'en_cours' && !(t.deadline && t.deadline < today)).length,
                en_retard: tasks.filter(t => t.status !== 'termine' && t.deadline && t.deadline < today).length,
                termine: tasks.filter(t => t.status === 'termine').length,
            };

            const openCreate = () => {
                setEditingTask(null);
                setFormData({ title: '', description: '', assignedTo: '', priority: 'moyenne', deadline: '' });
                setShowModal(true);
            };

            const openEdit = (task) => {
                setEditingTask(task);
                setFormData({ title: task.title, description: task.description || '', assignedTo: task.assignedTo, priority: task.priority || 'moyenne', deadline: task.deadline || '' });
                setShowModal(true);
            };

            const handleSave = async () => {
                if (!formData.title.trim() || !formData.assignedTo || !formData.deadline) return;
                setSaving(true);
                try {
                    const profile = PROFILES.find(p => p.id === formData.assignedTo);
                    const taskData = {
                        title: formData.title.trim(),
                        description: (formData.description || '').trim(),
                        assignedTo: formData.assignedTo,
                        assignedToName: profile ? profile.fullName || profile.name : formData.assignedTo,
                        priority: formData.priority,
                        deadline: formData.deadline,
                    };
                    if (editingTask) {
                        taskData.id = editingTask.id;
                    } else {
                        taskData.createdBy = currentProfile;
                    }
                    const token = await firebaseAuth.currentUser.getIdToken();
                    const r = await fetch('/api/tasks?action=' + (editingTask ? 'update' : 'create'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify(taskData),
                    });
                    const json = await r.json();
                    if (!json.success) throw new Error(json.error || 'Erreur serveur');
                    setShowModal(false);
                    await loadTasks();
                } catch (e) {
                    console.error('Error saving task:', e);
                    alert('Erreur: ' + (e.message || 'Impossible de sauvegarder'));
                } finally {
                    setSaving(false);
                }
            };

            const handleStatusChange = async (taskId, newStatus) => {
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    await fetch('/api/tasks?action=update-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ id: taskId, status: newStatus }),
                    });
                    await loadTasks();
                } catch (e) {
                    console.warn('Error updating status:', e);
                }
            };

            const handleDelete = async (taskId) => {
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    await fetch('/api/tasks?action=delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ id: taskId }),
                    });
                    setConfirmDelete(null);
                    await loadTasks();
                } catch (e) {
                    console.warn('Error deleting task:', e);
                }
            };

            const formatDate = (d) => {
                if (!d) return '—';
                const parts = d.split('-');
                return parts[2] + '/' + parts[1] + '/' + parts[0];
            };

            if (loading) return (
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',padding:60}}>
                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:28,color:'var(--berry)'}}></i>
                </div>
            );

            return (
                <div style={{padding:'0 0 40px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                        <h3 style={{margin:0,fontSize:18,color:'var(--gray-800)'}}>
                            <i className="fa-solid fa-list-check" style={{color:'var(--berry)',marginRight:8}}></i>
                            Gestion des Tâches
                        </h3>
                        <button onClick={openCreate} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-plus"></i> Nouvelle Tâche
                        </button>
                    </div>

                    {/* KPI Cards */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))',gap:12,marginBottom:20}}>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'var(--berry)'}}>{kpis.total}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>Total</div>
                        </div>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'#E67E22'}}>{kpis.a_faire}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>À faire</div>
                        </div>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'var(--blue)'}}>{kpis.en_cours}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>En cours</div>
                        </div>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'var(--red)'}}>{kpis.en_retard}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>En retard</div>
                        </div>
                        <div className="kpi-card" style={{textAlign:'center',padding:16}}>
                            <div style={{fontSize:24,fontWeight:800,color:'var(--green)'}}>{kpis.termine}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>Terminé</div>
                        </div>
                    </div>

                    {/* Filters */}
                    <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
                        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="all">Tous les assignés</option>
                            {PROFILES.map(p => <option key={p.id} value={p.id}>{p.label} — {p.name}</option>)}
                        </select>
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="all">Tous les statuts</option>
                            <option value="a_faire">À faire</option>
                            <option value="en_cours">En cours</option>
                            <option value="en_retard">En retard</option>
                            <option value="termine">Terminé</option>
                        </select>
                        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12}}>
                            <option value="all">Toutes les priorités</option>
                            <option value="haute">Haute</option>
                            <option value="moyenne">Moyenne</option>
                            <option value="basse">Basse</option>
                        </select>
                    </div>

                    {/* Tasks Table */}
                    <Panel title={`Tâches (${filteredTasks.length})`} icon="fa-tasks">
                        {filteredTasks.length === 0 ? (
                            <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-clipboard-list" style={{fontSize:36,marginBottom:12,display:'block',opacity:0.3}}></i>
                                Aucune tâche trouvée
                            </div>
                        ) : (
                            <div style={{overflowX:'auto'}}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Tâche</th>
                                            <th>Assigné à</th>
                                            <th>Échéance</th>
                                            <th>Priorité</th>
                                            <th>Statut</th>
                                            <th>Source</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTasks.map(task => {
                                            const cs = getComputedStatus(task);
                                            const assignee = PROFILES.find(p => p.id === task.assignedTo);
                                            return (
                                                <tr key={task.id}>
                                                    <td>
                                                        <div style={{fontWeight:600,fontSize:13}}>{task.title}</div>
                                                        {task.description && <div style={{fontSize:11,color:'var(--gray-400)',marginTop:2,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{task.description}</div>}
                                                    </td>
                                                    <td>
                                                        <span style={{background:'var(--berry-pale)',color:'var(--berry)',padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600}}>
                                                            {assignee ? assignee.label : task.assignedTo}
                                                        </span>
                                                    </td>
                                                    <td style={{color: cs === 'en_retard' ? 'var(--red)' : 'inherit', fontWeight: cs === 'en_retard' ? 700 : 400}}>
                                                        {formatDate(task.deadline)}
                                                    </td>
                                                    <td><span className={`priority-badge ${task.priority}`}>{priorityLabel(task.priority)}</span></td>
                                                    <td><span className={`status-badge ${cs}`}>{statusLabel(cs)}</span></td>
                                                    <td style={{fontSize:11,color:'var(--gray-400)'}}>
                                                        {task.sourceType === 'cr' ? (
                                                            <span><i className="fa-solid fa-file-pen" style={{marginRight:4}}></i>{task.sourceCrTitle || 'CR'}</span>
                                                        ) : 'Manuel'}
                                                    </td>
                                                    <td>
                                                        <div style={{display:'flex',gap:4}}>
                                                            {task.status !== 'termine' && (
                                                                <select value={task.status} onChange={e => handleStatusChange(task.id, e.target.value)} style={{padding:'3px 6px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,cursor:'pointer'}}>
                                                                    <option value="a_faire">À faire</option>
                                                                    <option value="en_cours">En cours</option>
                                                                    <option value="termine">Terminé</option>
                                                                </select>
                                                            )}
                                                            {task.status === 'termine' && (
                                                                <span className="status-badge termine" style={{fontSize:10}}>✓</span>
                                                            )}
                                                            <button onClick={() => openEdit(task)} style={{background:'none',border:'1px solid var(--gray-200)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:12}} title="Modifier">
                                                                <i className="fa-solid fa-pen" style={{color:'var(--blue)'}}></i>
                                                            </button>
                                                            <button onClick={() => setConfirmDelete(task.id)} style={{background:'none',border:'1px solid var(--gray-200)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:12}} title="Supprimer">
                                                                <i className="fa-solid fa-trash" style={{color:'var(--red)'}}></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Panel>

                    {/* Create/Edit Modal */}
                    {showModal && (
                        <div className="modal-overlay" onClick={() => setShowModal(false)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:520}}>
                                <h3 style={{margin:'0 0 20px',fontSize:16}}>
                                    <i className="fa-solid fa-list-check" style={{color:'var(--berry)',marginRight:8}}></i>
                                    {editingTask ? 'Modifier la tâche' : 'Nouvelle tâche'}
                                </h3>
                                <div style={{display:'flex',flexDirection:'column',gap:14}}>
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Titre *</label>
                                        <input type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="Titre de la tâche" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                    </div>
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Description</label>
                                        <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Description détaillée (optionnel)" rows={3} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,resize:'vertical',boxSizing:'border-box'}} />
                                    </div>
                                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                                        <div>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Assigné à *</label>
                                            <select value={formData.assignedTo} onChange={e => setFormData({...formData, assignedTo: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                                <option value="">— Choisir —</option>
                                                {PROFILES.map(p => <option key={p.id} value={p.id}>{p.label} — {p.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Priorité</label>
                                            <select value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                                <option value="haute">Haute</option>
                                                <option value="moyenne">Moyenne</option>
                                                <option value="basse">Basse</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Échéance *</label>
                                        <input type="date" value={formData.deadline} onChange={e => setFormData({...formData, deadline: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                    </div>
                                </div>
                                <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:20}}>
                                    <button onClick={() => setShowModal(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',fontSize:13,cursor:'pointer'}}>Annuler</button>
                                    <button onClick={handleSave} disabled={saving || !formData.title.trim() || !formData.assignedTo || !formData.deadline} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',opacity:(saving || !formData.title.trim() || !formData.assignedTo || !formData.deadline) ? 0.5 : 1}}>
                                        {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Enregistrement...</> : 'Enregistrer'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Delete Confirmation */}
                    {confirmDelete && (
                        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:380,textAlign:'center'}}>
                                <i className="fa-solid fa-triangle-exclamation" style={{fontSize:36,color:'var(--red)',marginBottom:12}}></i>
                                <h4 style={{margin:'0 0 8px'}}>Supprimer cette tâche ?</h4>
                                <p style={{fontSize:13,color:'var(--gray-400)',margin:'0 0 20px'}}>Cette action est irréversible.</p>
                                <div style={{display:'flex',justifyContent:'center',gap:10}}>
                                    <button onClick={() => setConfirmDelete(null)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',fontSize:13,cursor:'pointer'}}>Annuler</button>
                                    <button onClick={() => handleDelete(confirmDelete)} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Supprimer</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Separator */}
                    <div style={{borderTop:'2px solid var(--gray-100)',margin:'30px 0'}}></div>

                    {/* Farm TODO Lists */}
                    <FarmTodoSection />
                </div>
            );
        }

export { DGTasksTab };
