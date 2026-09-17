/* Module: agronomie | Déclaration(s): PlanificationTab */
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

function PlanificationTab({ data }) {
            const [filterFerme, setFilterFerme] = useState('F1');
            const [selectedTache, setSelectedTache] = useState('');
            const [priority, setPriority] = useState('Normale');
            const [assignedTeam, setAssignedTeam] = useState('');

            const parcelles = data.parcelleConfig[filterFerme] || [];
            const taches = data.normesProductivite.map(n => n.tache);

            return (
                <div className="fade-in">
                    <div style={{display:'flex', gap:12, marginBottom:16, alignItems:'center', flexWrap:'wrap'}}>
                        <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}>
                            <option value="F1">Ferme F1</option>
                            <option value="F5">Ferme F5</option>
                        </select>
                        <select value={selectedTache} onChange={e => setSelectedTache(e.target.value)} style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}>
                            <option value="">Sélectionner tâche</option>
                            {taches.map((t, i) => (
                                <option key={i} value={t}>{t}</option>
                            ))}
                        </select>
                        <select value={priority} onChange={e => setPriority(e.target.value)} style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}>
                            <option value="Urgente">🔴 Urgente</option>
                            <option value="Normale">🟡 Normale</option>
                        </select>
                        <input type="text" value={assignedTeam} onChange={e => setAssignedTeam(e.target.value)} placeholder="Équipe assignée..." style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}/>
                    </div>

                    <Panel title={`Planification ${filterFerme} - Quinzaine 01-15/03/2026`} icon="fa-calendar-check">
                        <div style={{display:'grid', gridTemplateColumns:'auto repeat(15, 1fr)', gap:'2px', fontSize:9, overflowX:'auto'}}>
                            <div style={{fontWeight:700, padding:6, textAlign:'center', background:'var(--gray-100)'}}>Tâche</div>
                            {Array.from({length:15}, (_, i) => (
                                <div key={i} style={{fontWeight:700, padding:6, textAlign:'center', background:'var(--gray-100)', transform:'rotate(-45deg)', transformOrigin:'center', height:40, display:'flex', alignItems:'center', justifyContent:'center', fontSize:8}}>
                                    {i+1}
                                </div>
                            ))}
                            {taches.map((t, ti) => (
                                <React.Fragment key={ti}>
                                    <div style={{fontWeight:600, padding:8, fontSize:10, textAlign:'left', background:'var(--gray-50)'}}>{t.substring(0, 12)}</div>
                                    {Array.from({length:15}, (_, di) => (
                                        <div key={di} style={{
                                            padding:8,
                                            background: (ti + di) % 3 === 0 ? 'var(--berry-pale)' : 'var(--gray-100)',
                                            border:'1px solid var(--gray-200)',
                                            borderRadius:3,
                                            minHeight:25
                                        }}></div>
                                    ))}
                                </React.Fragment>
                            ))}
                        </div>
                    </Panel>
                </div>
            );
        }

export { PlanificationTab };
