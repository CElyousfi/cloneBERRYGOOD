/* Module: rh | Déclaration(s): JourFerieSub */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { invalidateCache } from '../shared/invalidateCache.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { WorkerLink } from './WorkerLink.jsx';

import { QuinzaineCampagneSelect } from '../shared/QuinzaineCampagneSelect.jsx';
function JourFerieSub({ data, farmFilter, initialPeriode }) {
            const [serverData, setServerData] = useState(null); const [loading, setLoading] = useState(true); const [periodes, setPeriodes] = useState([]); const [selectedPeriode, setSelectedPeriode] = useState('');
            React.useEffect(() => { invalidateCache('transport'); cachedFetch('/api/pointage-rh?action=transport').then(json => { if (json.success) { setServerData(json); setPeriodes(json.periodes || []); if (json.periodes?.length > 0) setSelectedPeriode(initialPeriode || json.periodes[0]); } }).catch(err => console.warn(err)).finally(() => setLoading(false)); }, []);
            if (loading) return <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i></div>;
            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const ferieDetail = (serverData?.jourFerieDetail || []).filter(w => w.periode === currentPeriode);
            const joursFeries = serverData?.joursFeries || data.primesConfig?.joursFeries || [];
            const wList = ferieDetail.map(w => ({ ...w })).sort((a, b) => (b.cout || 0) - (a.cout || 0));
            const totalJH = wList.reduce((s, w) => s + w.jh, 0);
            const totalCout = Math.round(wList.reduce((s, w) => s + (w.cout || 0), 0));

            // Group by jour férié
            const byFerie = {};
            wList.forEach(w => { (w.details || []).forEach(d => { if (!byFerie[d.date]) byFerie[d.date] = { date: d.date, label: d.label, workers: new Set() }; byFerie[d.date].workers.add(w.matricule); }); });
            const ferieList = Object.values(byFerie).sort((a, b) => a.date.localeCompare(b.date));

            // Calendar: build 12 months
            const ferieByDate = {};
            joursFeries.forEach(jf => { ferieByDate[jf.date] = jf; });

            // Date d'un férié → quinzaine (toutes périodes chargées, pas seulement la courante)
            const ferieDateToPeriode = {};
            (serverData?.jourFerieDetail || []).forEach(w => { (w.details || []).forEach(d => { if (d.date && !ferieDateToPeriode[d.date]) ferieDateToPeriode[d.date] = w.periode; }); });
            // Clic sur un férié → sélectionne sa quinzaine (si chargée) et remonte en haut
            const selectFerie = (dateStr) => {
                const p = ferieDateToPeriode[dateStr];
                if (p) { setSelectedPeriode(p); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {} }
            };

            const renderCalendar = () => {
                const year = 2026;
                const months = [];
                for (let m = 0; m < 12; m++) {
                    const firstDay = new Date(year, m, 1);
                    const daysInMonth = new Date(year, m + 1, 0).getDate();
                    const startDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday=0
                    const monthName = firstDay.toLocaleDateString('fr-FR', { month: 'long' });
                    const cells = [];
                    for (let i = 0; i < startDay; i++) cells.push(<td key={'e'+i}></td>);
                    for (let d = 1; d <= daysInMonth; d++) {
                        const dateStr = `${year}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                        const jf = ferieByDate[dateStr];
                        const estime = jf && jf.type === 'islamique' && jf.status !== 'confirme';
                        const bg = jf ? (estime ? '#fff3cd' : '#d4edda') : 'transparent';
                        const suffix = !jf ? '' : (jf.status === 'confirme' ? ' (confirmé)' : (estime ? ' (à confirmer)' : ''));
                        const clickable = jf && ferieDateToPeriode[dateStr];
                        const title = jf ? `${jf.label}${suffix}${clickable ? ' — cliquer pour voir la quinzaine' : ''}` : '';
                        cells.push(<td key={d} title={title} onClick={jf ? () => selectFerie(dateStr) : undefined} style={{textAlign:'center',padding:2,fontSize:10,background:bg,borderRadius:4,fontWeight:jf?700:400,color:jf?'#000':'var(--gray-500)',cursor:clickable?'pointer':(jf?'help':'default')}}>{d}</td>);
                    }
                    const rows = [];
                    for (let i = 0; i < cells.length; i += 7) rows.push(<tr key={i}>{cells.slice(i, i + 7)}</tr>);
                    months.push(
                        <div key={m} style={{minWidth:160}}>
                            <div style={{fontSize:11,fontWeight:700,textAlign:'center',marginBottom:4,textTransform:'capitalize'}}>{monthName}</div>
                            <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{'LMMJVSD'.split('').map((d,i) => <th key={i} style={{fontSize:9,color:'var(--gray-400)',textAlign:'center',padding:1}}>{d}</th>)}</tr></thead><tbody>{rows}</tbody></table>
                        </div>
                    );
                }
                return months;
            };

            return (<div className="fade-in">
                <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{background:'rgba(192,57,43,0.1)',color:'#c0392b',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}><i className="fa-solid fa-star" style={{marginRight:4}}></i>Prime Jour Férié — {currentPeriode}</span>
                    <QuinzaineCampagneSelect periodes={periodes} periodeCampagne={serverData && serverData.periodeCampagne} value={selectedPeriode} onChange={v => setSelectedPeriode(v)} />
                </div>
                <div className="kpi-grid" style={{marginBottom:20}}>
                    <KPICard icon="fa-users" iconClass="orange" value={wList.length} label="Ouvriers éligibles" />
                    <KPICard icon="fa-star" iconClass="berry" value={ferieList.length} label="Jours fériés (quinzaine)" />
                    <KPICard icon="fa-calendar-plus" iconClass="green" value={totalJH} label="Total jours supplémentaires" />
                    <KPICard icon="fa-coins" iconClass="orange" value={totalCout.toLocaleString('fr-FR') + ' DH'} label="Montant Total" />
                </div>

                {ferieList.length > 0 && <Panel title="Jours Fériés de la Quinzaine" icon="fa-star">
                    <table className="data-table" style={{fontSize:12}}>
                        <thead><tr><th>Date</th><th>Fête</th><th style={{textAlign:'center'}}>Ouvriers éligibles</th></tr></thead>
                        <tbody>
                            {ferieList.map(f => (<tr key={f.date}><td style={{fontWeight:600}}>{new Date(f.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</td><td>{f.label}</td><td style={{textAlign:'center',fontWeight:600}}>{f.workers.size}</td></tr>))}
                        </tbody>
                    </table>
                </Panel>}

                <Panel title="Détail par Ouvrier" icon="fa-list">
                    <table className="data-table" style={{fontSize:12}}>
                        <thead><tr><th>#</th><th>Matricule</th><th>Ouvrier</th><th>Détail</th><th style={{textAlign:'center'}}>Jours sup.</th><th style={{textAlign:'right'}}>Montant (DH)</th></tr></thead>
                        <tbody>
                            {wList.map((w, i) => (<tr key={w.matricule}>
                                <td style={{color:'var(--gray-400)'}}>{i+1}</td>
                                <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                                <td><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                <td style={{fontSize:10}}>{(w.details||[]).map(d => <div key={d.date+d.raison}><span style={{color:'#c0392b',fontWeight:600}}>{d.label}</span> — {d.raison}</div>)}</td>
                                <td style={{textAlign:'center',fontWeight:700,color:'#c0392b'}}>{w.jh}</td>
                                <td style={{textAlign:'right',fontWeight:700,color:'#c0392b'}}>{(w.cout || 0).toLocaleString('fr-FR')} DH</td>
                            </tr>))}
                            {wList.length === 0 && <tr><td colSpan={6} style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucun jour férié dans cette quinzaine</td></tr>}
                            {wList.length > 0 && <tr style={{background:'rgba(192,57,43,0.08)',fontWeight:700}}><td></td><td>TOTAL</td><td>{wList.length} ouvriers</td><td></td><td style={{textAlign:'center',color:'#c0392b'}}>{totalJH}</td><td style={{textAlign:'right',color:'#c0392b'}}>{totalCout.toLocaleString('fr-FR')} DH</td></tr>}
                        </tbody>
                    </table>
                </Panel>

                <Panel title="Calendrier des Jours Fériés — 2026" icon="fa-calendar">
                    <div style={{display:'flex',gap:4,marginBottom:12,fontSize:10}}>
                        <span><span style={{display:'inline-block',width:12,height:12,background:'#d4edda',borderRadius:3,marginRight:4,verticalAlign:'middle'}}></span>Fixe / confirmé</span>
                        <span style={{marginLeft:12}}><span style={{display:'inline-block',width:12,height:12,background:'#fff3cd',borderRadius:3,marginRight:4,verticalAlign:'middle'}}></span>Islamique (à confirmer)</span>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(155px, 1fr))',gap:12}}>
                        {renderCalendar()}
                    </div>

                    <div style={{marginTop:18}}>
                        <div style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',marginBottom:8}}>Liste des jours fériés 2026</div>
                        <table className="data-table" style={{fontSize:12}}>
                            <thead><tr><th style={{width:160}}>Date</th><th>Fête</th><th style={{width:130}}>Type</th><th style={{width:120}}>Statut</th><th style={{width:150}}>Quinzaine</th></tr></thead>
                            <tbody>
                                {joursFeries.slice().filter(jf => (jf.date || '').slice(0,4) === '2026').sort((a,b) => a.date.localeCompare(b.date)).map(jf => {
                                    const st = jf.status || (jf.type === 'islamique' ? 'estime' : 'fixe');
                                    const badge = st === 'confirme' ? { t:'Confirmé', bg:'#d4edda', c:'#155724' } : (st === 'estime' ? { t:'Estimé', bg:'#fff3cd', c:'#856404' } : { t:'Fixe', bg:'#e2e3e5', c:'#41464b' });
                                    const periode = ferieDateToPeriode[jf.date];
                                    const isCurrent = periode && periode === currentPeriode;
                                    return (
                                        <tr key={jf.date} onClick={() => selectFerie(jf.date)}
                                            title={periode ? 'Voir la quinzaine ' + periode : 'Quinzaine non chargée'}
                                            style={{cursor: periode ? 'pointer' : 'default', background: isCurrent ? 'rgba(192,57,43,0.06)' : 'transparent'}}>
                                            <td style={{fontWeight:600}}>{new Date(jf.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'long'})}</td>
                                            <td>{jf.label}{periode ? <i className="fa-solid fa-arrow-right" style={{marginLeft:8,fontSize:9,color:'var(--berry)'}}></i> : null}</td>
                                            <td>{jf.type === 'islamique' ? '🌙 Islamique' : '📅 Fixe'}</td>
                                            <td><span style={{background:badge.bg,color:badge.c,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600}}>{badge.t}</span></td>
                                            <td style={{color: periode ? 'var(--berry)' : 'var(--gray-300)', fontWeight: periode ? 600 : 400}}>{periode || '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Panel>
            </div>);
        }

export { JourFerieSub };
