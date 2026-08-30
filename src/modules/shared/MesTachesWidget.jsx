/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): MesTachesWidget */
import { useEffect, useState } from './reactHooks.jsx';

// ========== MES TACHES WIDGET (cross-profile) ==========
        function MesTachesWidget({ currentProfile }) {
            const [tasks, setTasks] = useState([]);
            const [expanded, setExpanded] = useState(false);
            const [loading, setLoading] = useState(true);

            const today = new Date().toISOString().split('T')[0];

            const loadMyTasks = async () => {
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    const r = await fetch('/api/tasks?action=my-tasks&profile=' + encodeURIComponent(currentProfile), { headers: { 'Authorization': 'Bearer ' + token } });
                    const json = await r.json();
                    if (json.success) {
                        const list = (json.tasks || [])
                            .filter(t => t.status !== 'termine')
                            .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
                        setTasks(list);
                    }
                } catch (e) {
                    console.warn('Error loading my tasks:', e);
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => { loadMyTasks(); }, [currentProfile]);

            const handleStatusChange = async (taskId, newStatus) => {
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    await fetch('/api/tasks?action=update-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ id: taskId, status: newStatus }),
                    });
                    await loadMyTasks();
                } catch (e) {
                    console.warn('Error updating task:', e);
                }
            };

            const formatDate = (d) => {
                if (!d) return '—';
                const parts = d.split('-');
                return parts[2] + '/' + parts[1] + '/' + parts[0];
            };

            if (loading || tasks.length === 0) return null;

            return (
                <div className="mes-taches-widget">
                    <div className="widget-header" onClick={() => setExpanded(!expanded)}>
                        <i className="fa-solid fa-clipboard-list" style={{color:'var(--gold)',fontSize:16}}></i>
                        <span style={{fontWeight:700,fontSize:14,color:'var(--gray-800)'}}>Mes Tâches</span>
                        <span className="badge-count">{tasks.length}</span>
                        <span style={{fontSize:12,color:'var(--gray-400)',flex:1}}>{tasks.length} tâche{tasks.length > 1 ? 's' : ''} en attente</span>
                        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'}`} style={{color:'var(--gray-400)',fontSize:12}}></i>
                    </div>
                    {expanded && (
                        <div className="task-list">
                            {tasks.map(task => {
                                const isOverdue = task.deadline && task.deadline < today;
                                return (
                                    <div className="task-item" key={task.id}>
                                        <div className="task-info">
                                            <div className="task-title">{task.title}</div>
                                            <div className="task-meta">
                                                <i className="fa-regular fa-calendar" style={{marginRight:4}}></i>
                                                <span style={{color: isOverdue ? 'var(--red)' : 'inherit', fontWeight: isOverdue ? 700 : 400}}>
                                                    {formatDate(task.deadline)}
                                                </span>
                                                {isOverdue && <span style={{color:'var(--red)',marginLeft:6,fontWeight:700}}>En retard</span>}
                                                {task.sourceType === 'cr' && (
                                                    <span style={{marginLeft:8}}><i className="fa-solid fa-file-pen" style={{marginRight:3}}></i>{task.sourceCrTitle || 'CR'}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="task-actions">
                                            {task.status === 'a_faire' && (
                                                <button className="btn-en-cours" onClick={() => handleStatusChange(task.id, 'en_cours')}>
                                                    <i className="fa-solid fa-play" style={{marginRight:3}}></i>En cours
                                                </button>
                                            )}
                                            <button className="btn-termine" onClick={() => handleStatusChange(task.id, 'termine')}>
                                                <i className="fa-solid fa-check" style={{marginRight:3}}></i>Terminé
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

export { MesTachesWidget };
