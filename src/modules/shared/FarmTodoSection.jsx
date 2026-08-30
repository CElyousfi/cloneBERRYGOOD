/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): FarmTodoSection */
import { DG_FARMS } from '../admin/DG_FARMS.jsx';
import { useEffect, useState } from './reactHooks.jsx';

function FarmTodoSection() {
            const [selectedFarm, setSelectedFarm] = useState('F1');
            const [todos, setTodos] = useState({});
            const [loading, setLoading] = useState(true);
            const [newText, setNewText] = useState('');
            const [saving, setSaving] = useState(false);
            const [editingId, setEditingId] = useState(null);
            const [editText, setEditText] = useState('');

            const loadTodos = async () => {
                try {
                    setLoading(true);
                    const token = await firebaseAuth.currentUser.getIdToken();
                    const r = await fetch('/api/tasks?action=farm-todos', { headers: { 'Authorization': 'Bearer ' + token } });
                    const json = await r.json();
                    if (json.success) {
                        const byFarm = {};
                        DG_FARMS.forEach(f => { byFarm[f.id] = []; });
                        (json.todos || []).forEach(item => {
                            if (byFarm[item.farm]) byFarm[item.farm].push(item);
                        });
                        setTodos(byFarm);
                    }
                } catch (e) {
                    console.warn('Error loading farm todos:', e);
                } finally {
                    setLoading(false);
                }
            };

            useEffect(() => { loadTodos(); }, []);

            const handleAdd = async () => {
                if (!newText.trim()) return;
                setSaving(true);
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    await fetch('/api/tasks?action=farm-todo-add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ farm: selectedFarm, text: newText.trim() }),
                    });
                    setNewText('');
                    await loadTodos();
                } catch (e) {
                    console.warn('Error adding farm todo:', e);
                } finally {
                    setSaving(false);
                }
            };

            const toggleDone = async (item) => {
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    await fetch('/api/tasks?action=farm-todo-toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ id: item.id, done: !item.done }),
                    });
                    await loadTodos();
                } catch (e) {
                    console.warn('Error toggling farm todo:', e);
                }
            };

            const handleDelete = async (id) => {
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    await fetch('/api/tasks?action=farm-todo-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ id }),
                    });
                    await loadTodos();
                } catch (e) {
                    console.warn('Error deleting farm todo:', e);
                }
            };

            const handleEditSave = async (id) => {
                if (!editText.trim()) return;
                try {
                    const token = await firebaseAuth.currentUser.getIdToken();
                    await fetch('/api/tasks?action=farm-todo-edit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ id, text: editText.trim() }),
                    });
                    setEditingId(null);
                    await loadTodos();
                } catch (e) {
                    console.warn('Error editing farm todo:', e);
                }
            };

            const farmObj = DG_FARMS.find(f => f.id === selectedFarm);
            const farmColor = selectedFarm === 'all' ? 'var(--berry)' : (farmObj ? farmObj.color : 'var(--berry)');
            const allTodos = Object.values(todos).flat();
            const currentTodos = selectedFarm === 'all' ? allTodos : (todos[selectedFarm] || []);
            const doneCount = currentTodos.filter(t => t.done).length;
            const pendingCount = currentTodos.filter(t => !t.done).length;

            // Count per farm for badges
            const farmCounts = { all: { total: allTodos.length, pending: allTodos.filter(t => !t.done).length } };
            DG_FARMS.forEach(f => {
                const items = todos[f.id] || [];
                farmCounts[f.id] = { total: items.length, pending: items.filter(t => !t.done).length };
            });

            return (
                <div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                        <h3 style={{margin:0,fontSize:18,color:'var(--gray-800)'}}>
                            <i className="fa-solid fa-clipboard-list" style={{color:'var(--berry)',marginRight:8}}></i>
                            To Do par Ferme
                        </h3>
                    </div>

                    {/* Farm selector tabs */}
                    <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
                        <button onClick={() => setSelectedFarm('all')}
                            style={{
                                padding:'8px 16px', borderRadius:10, border: selectedFarm === 'all' ? '2px solid var(--berry)' : '1.5px solid var(--gray-200)',
                                background: selectedFarm === 'all' ? 'rgba(139,34,82,0.08)' : 'white',
                                color: selectedFarm === 'all' ? 'var(--berry)' : 'var(--gray-600)',
                                fontSize:13, fontWeight: selectedFarm === 'all' ? 700 : 500, cursor:'pointer',
                                display:'flex', alignItems:'center', gap:6, transition:'all 0.15s'
                            }}
                        >
                            Toutes
                            {farmCounts.all && farmCounts.all.pending > 0 && (
                                <span style={{
                                    background: selectedFarm === 'all' ? 'var(--berry)' : 'var(--gray-300)',
                                    color:'white', borderRadius:10, padding:'1px 7px', fontSize:10, fontWeight:700, minWidth:16, textAlign:'center'
                                }}>{farmCounts.all.pending}</span>
                            )}
                        </button>
                        {DG_FARMS.map(f => (
                            <button key={f.id} onClick={() => setSelectedFarm(f.id)}
                                style={{
                                    padding:'8px 16px', borderRadius:10, border: selectedFarm === f.id ? `2px solid ${f.color}` : '1.5px solid var(--gray-200)',
                                    background: selectedFarm === f.id ? `${f.color}12` : 'white',
                                    color: selectedFarm === f.id ? f.color : 'var(--gray-600)',
                                    fontSize:13, fontWeight: selectedFarm === f.id ? 700 : 500, cursor:'pointer',
                                    display:'flex', alignItems:'center', gap:6, transition:'all 0.15s'
                                }}
                            >
                                {f.label}
                                {farmCounts[f.id] && farmCounts[f.id].pending > 0 && (
                                    <span style={{
                                        background: selectedFarm === f.id ? f.color : 'var(--gray-300)',
                                        color:'white', borderRadius:10, padding:'1px 7px', fontSize:10, fontWeight:700, minWidth:16, textAlign:'center'
                                    }}>{farmCounts[f.id].pending}</span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* KPIs for selected farm */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
                        <div style={{background:'white',borderRadius:10,padding:14,textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.06)',borderTop:`3px solid ${farmColor}`}}>
                            <div style={{fontSize:22,fontWeight:800,color:farmColor}}>{currentTodos.length}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}>Total</div>
                        </div>
                        <div style={{background:'white',borderRadius:10,padding:14,textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.06)',borderTop:'3px solid #E67E22'}}>
                            <div style={{fontSize:22,fontWeight:800,color:'#E67E22'}}>{pendingCount}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}>En attente</div>
                        </div>
                        <div style={{background:'white',borderRadius:10,padding:14,textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,0.06)',borderTop:'3px solid var(--green)'}}>
                            <div style={{fontSize:22,fontWeight:800,color:'var(--green)'}}>{doneCount}</div>
                            <div style={{fontSize:11,color:'var(--gray-400)'}}>Fait</div>
                        </div>
                    </div>

                    {/* Add new todo */}
                    {selectedFarm !== 'all' && (
                    <div style={{display:'flex',gap:8,marginBottom:16}}>
                        <input type="text" value={newText} onChange={e => setNewText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                            placeholder={`Ajouter une tâche pour ${selectedFarm}...`}
                            style={{flex:1, padding:'10px 14px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:13, outline:'none'}}
                        />
                        <button onClick={handleAdd} disabled={saving || !newText.trim()}
                            style={{padding:'10px 18px', borderRadius:8, background:farmColor, color:'white', border:'none', fontSize:13, fontWeight:600, cursor:'pointer', opacity: saving || !newText.trim() ? 0.5 : 1, whiteSpace:'nowrap'}}>
                            {saving ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter</>}
                        </button>
                    </div>
                    )}

                    {/* Todo list */}
                    {loading ? (
                        <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-spinner fa-spin" style={{fontSize:20}}></i>
                        </div>
                    ) : currentTodos.length === 0 ? (
                        <div style={{textAlign:'center',padding:30,color:'var(--gray-400)',background:'white',borderRadius:10}}>
                            <i className="fa-solid fa-check-circle" style={{fontSize:28,marginBottom:8,display:'block',opacity:0.3}}></i>
                            <div style={{fontSize:13}}>Aucune tâche{selectedFarm !== 'all' ? ` pour ${selectedFarm}` : ''}</div>
                        </div>
                    ) : (
                        <div style={{display:'flex',flexDirection:'column',gap:6}}>
                            {currentTodos.map(item => (
                                <div key={item.id} style={{
                                    background:'white', borderRadius:10, padding:'12px 14px',
                                    boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
                                    borderLeft: `4px solid ${item.done ? 'var(--green)' : (selectedFarm === 'all' ? (DG_FARMS.find(ff => ff.id === item.farm)?.color || 'var(--berry)') : farmColor)}`,
                                    opacity: item.done ? 0.6 : 1,
                                    display:'flex', alignItems:'center', gap:10
                                }}>
                                    <button onClick={() => toggleDone(item)}
                                        style={{
                                            width:22, height:22, borderRadius:6,
                                            border: item.done ? 'none' : `2px solid ${farmColor}`,
                                            background: item.done ? 'var(--green)' : 'white',
                                            color:'white', cursor:'pointer',
                                            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:11
                                        }}>
                                        {item.done && <i className="fa-solid fa-check"></i>}
                                    </button>
                                    <div style={{flex:1, minWidth:0}}>
                                        {editingId === item.id ? (
                                            <div style={{display:'flex',gap:6}}>
                                                <input type="text" value={editText} onChange={e => setEditText(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') handleEditSave(item.id); if (e.key === 'Escape') setEditingId(null); }}
                                                    style={{flex:1, padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:13}} autoFocus
                                                />
                                                <button onClick={() => handleEditSave(item.id)} style={{padding:'5px 10px',borderRadius:6,background:farmColor,color:'white',border:'none',fontSize:11,cursor:'pointer'}}>OK</button>
                                                <button onClick={() => setEditingId(null)} style={{padding:'5px 10px',borderRadius:6,background:'var(--gray-100)',border:'none',fontSize:11,cursor:'pointer'}}>X</button>
                                            </div>
                                        ) : (
                                            <span style={{fontSize:13, textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--gray-400)' : 'var(--gray-800)'}}>
                                                {selectedFarm === 'all' && (() => { const fc = DG_FARMS.find(ff => ff.id === item.farm); return fc ? <span style={{display:'inline-block',background:fc.color,color:'#fff',borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:700,marginRight:6}}>{fc.label}</span> : null; })()}
                                                {item.text}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{display:'flex',gap:4,flexShrink:0}}>
                                        {!item.done && (
                                            <button onClick={() => { setEditingId(item.id); setEditText(item.text); }}
                                                style={{width:28,height:28,borderRadius:6,border:'none',background:'var(--gray-100)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                                <i className="fa-solid fa-pen" style={{fontSize:10,color:'var(--gray-500)'}}></i>
                                            </button>
                                        )}
                                        <button onClick={() => handleDelete(item.id)}
                                            style={{width:28,height:28,borderRadius:6,border:'none',background:'rgba(220,53,69,0.08)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className="fa-solid fa-trash" style={{fontSize:10,color:'var(--red)'}}></i>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

export { FarmTodoSection };
