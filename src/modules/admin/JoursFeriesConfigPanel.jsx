/* Module: admin | Déclaration(s): JoursFeriesConfigPanel */
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

function JoursFeriesConfigPanel() {
            const [holidays, setHolidays] = useState([]);
            const [meta, setMeta] = useState({ lastSyncAt: null, syncSource: null });
            const [editing, setEditing] = useState(null); // {originalDate, date, label, type, status}
            const [loading, setLoading] = useState(true);
            const [syncing, setSyncing] = useState(false);

            const load = () => {
                fetch('/api/validation?action=jours-feries').then(r => r.json())
                    .then(res => { if (res.success) { setHolidays(res.holidays || []); setMeta({ lastSyncAt: res.lastSyncAt, syncSource: res.syncSource }); } })
                    .catch(err => console.warn('Jours fériés load error:', err))
                    .finally(() => setLoading(false));
            };
            React.useEffect(() => { load(); }, []);

            const save = (entry) => {
                if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !entry.label) {
                    alert('Date (AAAA-MM-JJ) et libellé obligatoires.');
                    return;
                }
                fetch('/api/validation?action=jours-feries-save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(entry) })
                    .then(r => r.json()).then(res => { if (res.success) { setEditing(null); load(); } else { alert(res.error || 'Erreur'); } });
            };
            const remove = (date) => {
                if (!confirm('Supprimer ce jour férié ?')) return;
                fetch('/api/validation?action=jours-feries-delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ date }) })
                    .then(r => r.json()).then(res => { if (res.success) load(); });
            };
            const confirmHoliday = (h) => {
                save({ originalDate: h.date, date: h.date, label: h.label, type: h.type, status: 'confirme' });
            };
            const runSyncNow = () => {
                setSyncing(true);
                fetch('/api/run-sync-jours-feries-now').then(r => r.json())
                    .then(res => { if (!res.success) alert(res.error || 'Erreur sync'); load(); })
                    .catch(err => alert('Erreur sync: ' + err.message))
                    .finally(() => setSyncing(false));
            };

            const STATUS_BADGE = {
                fixe: { label: 'Fixe', bg: '#e2e3e5', color: '#41464b' },
                estime: { label: 'Estimé', bg: '#fff3cd', color: '#856404' },
                confirme: { label: 'Confirmé', bg: '#d4edda', color: '#155724' },
            };
            const statusOf = (h) => h.status || (h.type === 'islamique' ? 'estime' : 'fixe');

            const editorRow = (keySuffix) => (
                <tr key={'edit_' + keySuffix} style={{background:'#fffde7'}}>
                    <td><input type="date" value={editing.date} onChange={e => setEditing({...editing, date: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td><input value={editing.label} onChange={e => setEditing({...editing, label: e.target.value})} placeholder="Libellé de la fête" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td>
                        <select value={editing.type} onChange={e => setEditing({...editing, type: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="fixe">Fixe (grégorien)</option>
                            <option value="islamique">Islamique (lunaire)</option>
                        </select>
                    </td>
                    <td>
                        <select value={editing.status} onChange={e => setEditing({...editing, status: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="fixe">Fixe</option>
                            <option value="estime">Estimé</option>
                            <option value="confirme">Confirmé</option>
                        </select>
                    </td>
                    <td style={{textAlign:'center'}}>
                        <button onClick={() => save(editing)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--green)',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-check"></i></button>
                        <button onClick={() => setEditing(null)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--gray-300)',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-times"></i></button>
                    </td>
                </tr>
            );
            const displayRow = (h) => (editing && editing.originalDate === h.date ? editorRow(h.date) : (
                <tr key={h.date}>
                    <td style={{fontWeight:600,fontFamily:'monospace'}}>{h.date}</td>
                    <td>{h.label}{h.manualOverride ? <i className="fa-solid fa-user-pen" title="Modifié par RH (prioritaire sur l'API)" style={{marginLeft:6,color:'var(--berry)',fontSize:10}}></i> : null}</td>
                    <td>{h.type === 'islamique' ? '🌙 Islamique' : '📅 Fixe'}</td>
                    <td>{(() => { const s = STATUS_BADGE[statusOf(h)]; return <span style={{background:s.bg,color:s.color,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600}}>{s.label}</span>; })()}</td>
                    <td style={{textAlign:'center',whiteSpace:'nowrap'}}>
                        {statusOf(h) !== 'confirme' && <button onClick={() => confirmHoliday(h)} title="Confirmer (override RH)" style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--green)',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-circle-check"></i></button>}
                        <button onClick={() => setEditing({ originalDate: h.date, date: h.date, label: h.label, type: h.type, status: statusOf(h) })} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#3498db',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-pen"></i></button>
                        <button onClick={() => remove(h.date)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#e74c3c',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            ));

            const sorted = holidays.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
            const fmtSync = meta.lastSyncAt ? new Date(meta.lastSyncAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';

            return (
                <Panel title="Jours Fériés (Prime Jour Férié)" icon="fa-calendar-star">
                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:10}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>
                        Source unique du calcul de la <strong>Prime Jour Férié</strong> et du calendrier. Les fêtes <strong>islamiques</strong> (lunaires) sont estimées puis confirmées automatiquement à l'approche par un job quotidien (date.nager.at). Une modification RH ici <strong>prime sur l'API</strong>.
                        <span style={{marginLeft:6,color:'var(--gray-400)'}}>Dernière synchro API : {fmtSync}.</span>
                    </div>
                    <div style={{marginBottom:10,display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button onClick={() => setEditing({ originalDate: null, date: '', label: '', type: 'fixe', status: 'fixe' })}
                            style={{padding:'6px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter
                        </button>
                        <button onClick={runSyncNow} disabled={syncing}
                            style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--gray-300)',background:'#fff',color:'var(--gray-600)',fontSize:12,fontWeight:600,cursor:syncing?'default':'pointer',opacity:syncing?0.6:1}}>
                            <i className={'fa-solid ' + (syncing ? 'fa-spinner fa-spin' : 'fa-rotate')} style={{marginRight:4}}></i>{syncing ? 'Synchro…' : 'Synchroniser maintenant'}
                        </button>
                    </div>
                    {loading ? <div style={{padding:16,color:'var(--gray-400)',fontSize:12}}>Chargement…</div> : (
                    <table className="data-table" style={{fontSize:12}}>
                        <thead>
                            <tr>
                                <th style={{width:120}}>Date</th>
                                <th>Fête</th>
                                <th style={{width:140}}>Type</th>
                                <th style={{width:110}}>Statut</th>
                                <th style={{textAlign:'center',width:130}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {editing && !editing.originalDate && editorRow('new')}
                            {sorted.length === 0 ? (
                                <tr><td colSpan="5" style={{textAlign:'center',color:'var(--gray-400)',fontStyle:'italic',padding:12,fontSize:11}}>Aucun jour férié — cliquez sur « Synchroniser maintenant » ou « Ajouter ».</td></tr>
                            ) : sorted.map(displayRow)}
                        </tbody>
                    </table>
                    )}
                </Panel>
            );
        }

export { JoursFeriesConfigPanel };
