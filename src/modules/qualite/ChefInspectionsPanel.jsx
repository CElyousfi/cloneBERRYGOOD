/* Module: qualite | Déclaration(s): ChefInspectionsPanel */
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';

function ChefInspectionsPanel({ farmFilter }) {
            const [inspections, setInspections] = useState([]);
            const [loading, setLoading] = useState(true);

            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=200')
                    .then(json => {
                        if (json.success && json.expeditions) {
                            const today = new Date().toISOString().slice(0, 10);
                            const mapped = json.expeditions.map(e => {
                                const raw = e.date || e.createdAt || '';
                                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                                const d = m ? m[3] + '-' + m[1] + '-' + m[2] : (raw.length >= 10 && raw[4] === '-' ? raw.slice(0, 10) : '');
                                const ferme = ranchToFerme[e.ranch] || '';
                                const result = (e.overallResult || '').toUpperCase() === 'PASS' ? 'Pass' : 'Fail';
                                const pq = e.enrichedPqScore || e.pqScore || e.pfqTotal || 0;
                                const brix = e.brix || e.brixFromDQR || 0;
                                return { ...e, dateISO: d, ferme, result, pq: Math.round(pq), brix: Math.round(brix * 100) / 100 };
                            }).filter(e => e.ferme === farmFilter);
                            // Show today and yesterday
                            const recent = mapped.filter(e => e.dateISO >= today.slice(0, 8) + '01').sort((a, b) => b.dateISO.localeCompare(a.dateISO));
                            setInspections(recent.slice(0, 20));
                        }
                    }).catch(() => {}).finally(() => setLoading(false));
            }, [farmFilter]);

            if (loading) return <Panel title="Inspections Qualité" icon="fa-clipboard-check"><div style={{textAlign:'center',padding:20,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin"></i></div></Panel>;
            if (inspections.length === 0) return null;

            const today = new Date().toISOString().slice(0, 10);
            const todayInsp = inspections.filter(i => i.dateISO === today);
            const nbPass = todayInsp.filter(i => i.result === 'Pass').length;
            const nbFail = todayInsp.filter(i => i.result === 'Fail').length;
            const avgPQ = todayInsp.length > 0 ? Math.round(todayInsp.reduce((s, i) => s + i.pq, 0) / todayInsp.length) : 0;
            const avgBrix = todayInsp.length > 0 ? (todayInsp.reduce((s, i) => s + i.brix, 0) / todayInsp.length).toFixed(2) : '0.00';

            return (
                <Panel title={`Inspections Qualité — ${farmFilter}`} icon="fa-clipboard-check">
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:8,marginBottom:14}}>
                        <div style={{background:'#e8f5e9',borderRadius:10,padding:10,textAlign:'center'}}>
                            <div style={{fontSize:10,color:'var(--gray-500)'}}>Pass</div>
                            <div style={{fontSize:20,fontWeight:800,color:'#2e7d32'}}>{nbPass}</div>
                        </div>
                        <div style={{background:'#fce4ec',borderRadius:10,padding:10,textAlign:'center'}}>
                            <div style={{fontSize:10,color:'var(--gray-500)'}}>Fail</div>
                            <div style={{fontSize:20,fontWeight:800,color:'#c62828'}}>{nbFail}</div>
                        </div>
                        <div style={{background:'#fff3e0',borderRadius:10,padding:10,textAlign:'center'}}>
                            <div style={{fontSize:10,color:'var(--gray-500)'}}>PFQ moy.</div>
                            <div style={{fontSize:20,fontWeight:800,color:'#e65100'}}>{avgPQ}</div>
                        </div>
                        <div style={{background:'#e8f4fd',borderRadius:10,padding:10,textAlign:'center'}}>
                            <div style={{fontSize:10,color:'var(--gray-500)'}}>Brix moy.</div>
                            <div style={{fontSize:20,fontWeight:800,color:'#1565C0'}}>{avgBrix}</div>
                        </div>
                    </div>
                    <table className="data-table" style={{fontSize:11}}>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Lot</th>
                                <th>Variété</th>
                                <th style={{textAlign:'center'}}>Résultat</th>
                                <th style={{textAlign:'right'}}>PFQ</th>
                                <th style={{textAlign:'right'}}>Brix</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inspections.map((insp, i) => (
                                <tr key={i}>
                                    <td style={{fontSize:10,color:'var(--gray-500)'}}>{insp.dateISO === today ? "Aujourd'hui" : new Date(insp.dateISO+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</td>
                                    <td style={{fontWeight:600,fontSize:10}}>{insp.batchNumber || insp.lotNumber || '—'}</td>
                                    <td>{insp.variety || '—'}</td>
                                    <td style={{textAlign:'center'}}>
                                        <span style={{padding:'3px 10px',borderRadius:12,fontSize:10,fontWeight:700,
                                            background: insp.result === 'Pass' ? '#e8f5e9' : '#fce4ec',
                                            color: insp.result === 'Pass' ? '#2e7d32' : '#c62828'}}>{insp.result}</span>
                                    </td>
                                    <td style={{textAlign:'right',fontWeight:600}}>{insp.pq}</td>
                                    <td style={{textAlign:'right'}}>{insp.brix ? insp.brix.toFixed(2) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Panel>
            );
        }

export { ChefInspectionsPanel };
