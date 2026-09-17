/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): TraitementSub */
import { WorkerLink } from '../rh/WorkerLink.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useState } from '../shared/reactHooks.jsx';

import { QuinzaineCampagneSelect } from '../shared/QuinzaineCampagneSelect.jsx';
function TraitementSub({ data, farmFilter, initialPeriode }) {
            const [detailRows, setDetailRows] = useState([]); const [loading, setLoading] = useState(true);
            const [periodes, setPeriodes] = useState([]); const [selectedPeriode, setSelectedPeriode] = useState('');
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const PRIME_TRAITEMENT = 10; // DH par jour

            React.useEffect(() => {
                cachedFetch('/api/pointage-rh?action=transport').then(json => {
                    if (json.success) {
                        setDetailRows(json.rows || []);
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        if (json.periodes?.length > 0) setSelectedPeriode(initialPeriode || json.periodes[0]);
                    }
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement...</div></div>;

            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const periodeRows = detailRows.filter(r => r.periode === currentPeriode && (!farmFilter || r.ferme === farmFilter));

            // Filter traitement rows
            const traitementRows = periodeRows.filter(r => (r.operationFamille || '').toLowerCase().includes('traitement'));

            // Unique worker-days
            const workerDaySet = new Set();
            traitementRows.forEach(r => workerDaySet.add(r.matricule + '|' + r.jour));

            // Build worker detail
            const workerMap = {};
            traitementRows.forEach(r => {
                const key = r.matricule;
                if (!workerMap[key]) workerMap[key] = { matricule: r.matricule, nom: r.nom || r.matricule, jours: new Set() };
                workerMap[key].jours.add(r.jour);
            });
            const workerList = Object.values(workerMap).map(w => ({
                ...w, jh: w.jours.size, prime: w.jours.size * PRIME_TRAITEMENT
            })).sort((a, b) => b.jh - a.jh);

            const totalJH = workerDaySet.size;
            const totalPrime = totalJH * PRIME_TRAITEMENT;

            // Daily breakdown
            const allDates = [...new Set(traitementRows.map(r => r.jour))].sort();
            const dailyData = allDates.map(d => {
                const workers = new Set(traitementRows.filter(r => r.jour === d).map(r => r.matricule));
                return { date: d, workers: workers.size, cout: workers.size * PRIME_TRAITEMENT };
            });

            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'rgba(52,152,219,0.1)',color:'var(--blue)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-spray-can-sparkles" style={{marginRight:4}}></i>Prime Traitement — {currentPeriode}
                        </span>
                        <QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} value={selectedPeriode} onChange={v => setSelectedPeriode(v)} />
                        <span style={{fontSize:11,color:'var(--gray-500)',marginLeft:8}}>
                            <i className="fa-solid fa-info-circle" style={{marginRight:4}}></i>{PRIME_TRAITEMENT} DH / ouvrier / jour
                        </span>
                    </div>

                    <div className="kpi-grid" style={{marginBottom:20}}>
                        <KPICard icon="fa-users" iconClass="blue" value={workerList.length} label="Ouvriers Traitement" />
                        <KPICard icon="fa-calendar-check" iconClass="green" value={totalJH} label="Jours-Hommes" />
                        <KPICard icon="fa-coins" iconClass="orange" value={totalPrime.toLocaleString('fr-FR') + ' DH'} label="Total Prime Traitement" />
                        <KPICard icon="fa-calculator" iconClass="berry" value={workerList.length > 0 ? Math.round(totalPrime / workerList.length) + ' DH' : '-'} label="Moy. Prime / Ouvrier" />
                    </div>

                    {/* Détail par ouvrier */}
                    <Panel title="Détail Prime Traitement par Ouvrier" icon="fa-list">
                        <table className="data-table" style={{fontSize:12}}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Matricule</th>
                                    <th>Ouvrier</th>
                                    <th style={{textAlign:'center'}}>Jours</th>
                                    <th style={{textAlign:'right'}}>Prime (DH)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {workerList.map((w, i) => (
                                    <tr key={w.matricule}>
                                        <td style={{color:'var(--gray-400)'}}>{i + 1}</td>
                                        <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                                        <td><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                        <td style={{textAlign:'center',fontWeight:600}}>{w.jh}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:'var(--blue)'}}>{w.prime.toLocaleString('fr-FR')} DH</td>
                                    </tr>
                                ))}
                                <tr style={{background:'rgba(52,152,219,0.08)',fontWeight:700}}>
                                    <td></td>
                                    <td>TOTAL</td>
                                    <td>{workerList.length} ouvriers</td>
                                    <td style={{textAlign:'center'}}>{totalJH}</td>
                                    <td style={{textAlign:'right',color:'var(--blue)'}}>{totalPrime.toLocaleString('fr-FR')} DH</td>
                                </tr>
                            </tbody>
                        </table>
                    </Panel>

                    {/* Détail par jour */}
                    <Panel title="Prime Traitement par Jour" icon="fa-calendar-day">
                        <table className="data-table" style={{fontSize:12}}>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th style={{textAlign:'center'}}>Nb Ouvriers</th>
                                    <th style={{textAlign:'right'}}>Prime (DH)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dailyData.map(d => (
                                    <tr key={d.date}>
                                        <td>{new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</td>
                                        <td style={{textAlign:'center',fontWeight:600}}>{d.workers}</td>
                                        <td style={{textAlign:'right',fontWeight:600,color:'var(--blue)'}}>{d.cout.toLocaleString('fr-FR')} DH</td>
                                    </tr>
                                ))}
                                <tr style={{background:'rgba(52,152,219,0.08)',fontWeight:700}}>
                                    <td>TOTAL</td>
                                    <td style={{textAlign:'center'}}>{totalJH}</td>
                                    <td style={{textAlign:'right',color:'var(--blue)'}}>{totalPrime.toLocaleString('fr-FR')} DH</td>
                                </tr>
                            </tbody>
                        </table>
                    </Panel>
                </div>
            );
        }

export { TraitementSub };
