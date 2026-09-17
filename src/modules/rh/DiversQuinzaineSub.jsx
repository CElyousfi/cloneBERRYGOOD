/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): DiversQuinzaineSub */
import { Panel } from '../shared/Panel.jsx';
import { useState } from '../shared/reactHooks.jsx';

import { QuinzaineCampagneSelect } from '../shared/QuinzaineCampagneSelect.jsx';
// Sous-onglet Primes : vue quinzaine (récap lecture seule) du Pointage Divers, transposée (jours × sous-traitants).
        function DiversQuinzaineSub({ farmFilter, initialPeriode }) {
            const [periodes, setPeriodes] = useState([]);
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const [dates, setDates] = useState([]);
            const [byDate, setByDate] = useState({});
            const [loading, setLoading] = useState(true);

            const load = (periode) => {
                setLoading(true);
                const url = '/api/validation?action=divers-entries-range' + (periode ? '&periode=' + encodeURIComponent(periode) : '');
                fetch(url).then(r => r.json()).then(json => {
                    if (json && json.success) {
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        setSelectedPeriode(json.periode || '');
                        setDates(json.dates || []);
                        setByDate(json.byDate || {});
                    }
                }).catch(err => console.warn('Divers quinzaine load error:', err)).finally(() => setLoading(false));
            };
            React.useEffect(() => { load(initialPeriode || null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement…</div></div>;

            // Agrégation par sous-traitant
            const bySt = {};
            dates.forEach(d => {
                ((byDate[d] || {}).entries || []).forEach(e => {
                    const key = (e.matricule || e.beneficiaire || '?') + '|' + (e.fonction || '');
                    if (!bySt[key]) bySt[key] = { matricule: e.matricule || '', beneficiaire: e.beneficiaire || '', fonction: e.fonction || '', byDay: {}, totQ: 0, totM: 0 };
                    const cur = bySt[key].byDay[d] || { q: 0, m: 0 };
                    cur.q += Number(e.quantite) || 0; cur.m += Number(e.montant) || 0;
                    bySt[key].byDay[d] = cur;
                    bySt[key].totQ += Number(e.quantite) || 0; bySt[key].totM += Number(e.montant) || 0;
                });
            });
            const rows = Object.values(bySt).sort((a, b) => b.totM - a.totM);
            const dailyTot = dates.map(d => rows.reduce((s, r) => s + ((r.byDay[d] && r.byDay[d].m) || 0), 0));
            const grandTot = rows.reduce((s, r) => s + r.totM, 0);

            return (
                <Panel title="Pointage Divers — Récapitulatif quinzaine" icon="fa-table-cells">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:11,fontWeight:600,color:'var(--gray-500)'}}>Quinzaine :</span>
                        <QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} value={selectedPeriode} onChange={v => load(v)} />
                    </div>
                    <div className="table-responsive">
                    <table className="data-table" style={{fontSize:11}}>
                        <thead>
                            <tr>
                                <th>Jour</th>
                                {rows.map((r, i) => (
                                    <th key={i} style={{textAlign:'center'}}>
                                        {r.beneficiaire || r.matricule || '—'}
                                        <div style={{fontSize:9,fontWeight:400,color:'var(--gray-400)'}}>{r.fonction || '—'}{r.matricule ? ' · ' + r.matricule : ''}</div>
                                    </th>
                                ))}
                                <th style={{textAlign:'center',fontWeight:700}}>Total jour</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dates.map((d, di) => (
                                <tr key={d}>
                                    <td style={{fontWeight:600,whiteSpace:'nowrap'}}>{new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</td>
                                    {rows.map((r, i) => {
                                        const c = r.byDay[d];
                                        if (!c || (!c.q && !c.m)) return <td key={i} style={{textAlign:'center',color:'var(--gray-200)'}}>-</td>;
                                        return <td key={i} style={{textAlign:'center',fontSize:10}}><div style={{fontWeight:600}}>{c.q}</div><div style={{fontSize:9,color:'var(--gray-400)'}}>{Math.round(c.m).toLocaleString('fr-FR')} DH</div></td>;
                                    })}
                                    <td style={{textAlign:'center',fontWeight:700,color:dailyTot[di]>0?'var(--berry)':'var(--gray-300)'}}>{dailyTot[di] > 0 ? Math.round(dailyTot[di]).toLocaleString('fr-FR') + ' DH' : '-'}</td>
                                </tr>
                            ))}
                            {rows.length === 0 && <tr><td colSpan={2} style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucun pointage divers sur cette quinzaine.</td></tr>}
                        </tbody>
                        {rows.length > 0 && (
                            <tfoot>
                                <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                    <td style={{textAlign:'right'}}>Total</td>
                                    {rows.map((r, i) => (
                                        <td key={i} style={{textAlign:'center',fontSize:10,color:'var(--berry)'}}><div>{Math.round(r.totQ*100)/100}</div><div>{Math.round(r.totM).toLocaleString('fr-FR')} DH</div></td>
                                    ))}
                                    <td style={{textAlign:'center',color:'var(--berry)',fontSize:13}}>{Math.round(grandTot).toLocaleString('fr-FR')} DH</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                    </div>
                </Panel>
            );
        }

export { DiversQuinzaineSub };
