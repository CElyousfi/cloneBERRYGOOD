/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): ConditionnementSub */
import { WorkerLink } from '../rh/WorkerLink.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { invalidateCache } from '../shared/invalidateCache.jsx';
import { useState } from '../shared/reactHooks.jsx';

function ConditionnementSub({ data, farmFilter, initialPeriode }) {
            const [serverData, setServerData] = useState(null); const [loading, setLoading] = useState(true); const [periodes, setPeriodes] = useState([]); const [selectedPeriode, setSelectedPeriode] = useState(''); const PRIME_COND = 10;
            React.useEffect(() => { invalidateCache('transport'); cachedFetch('/api/pointage-rh?action=transport').then(json => { if (json.success) { setServerData(json); setPeriodes(json.periodes || []); if (json.periodes?.length > 0) setSelectedPeriode(initialPeriode || json.periodes[0]); } }).catch(err => console.warn(err)).finally(() => setLoading(false)); }, []);
            if (loading) return <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i></div>;
            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const wList = (serverData?.conditionnementDetail || []).filter(w => w.periode === currentPeriode).map(w => ({ ...w, prime: w.jh * PRIME_COND })).sort((a, b) => b.jh - a.jh);
            const totalJH = wList.reduce((s, w) => s + w.jh, 0); const totalPrime = totalJH * PRIME_COND;
            const allDates = [...new Set(wList.flatMap(w => w.jours))].sort();
            const dailyData = allDates.map(d => { const ws = wList.filter(w => w.jours.includes(d)).length; return { date: d, workers: ws, cout: ws * PRIME_COND }; });
            return (<div className="fade-in">
                <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{background:'rgba(230,126,34,0.1)',color:'#e67e22',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}><i className="fa-solid fa-box-open" style={{marginRight:4}}></i>Prime Conditionnement — {currentPeriode}</span>
                    <window.QuinzaineCampagneSelect periodes={periodes} periodeCampagne={serverData && serverData.periodeCampagne} value={selectedPeriode} onChange={v => setSelectedPeriode(v)} />
                    <span style={{fontSize:11,color:'var(--gray-500)',marginLeft:8}}><i className="fa-solid fa-info-circle" style={{marginRight:4}}></i>{PRIME_COND} DH / ouvrier / jour</span>
                </div>
                <div className="kpi-grid" style={{marginBottom:20}}>
                    <KPICard icon="fa-users" iconClass="orange" value={wList.length} label="Ouvriers Conditionnement" />
                    <KPICard icon="fa-calendar-check" iconClass="green" value={totalJH} label="Jours-Hommes" />
                    <KPICard icon="fa-coins" iconClass="orange" value={totalPrime.toLocaleString('fr-FR') + ' DH'} label="Total Prime Conditionnement" />
                    <KPICard icon="fa-calculator" iconClass="berry" value={wList.length > 0 ? Math.round(totalPrime / wList.length) + ' DH' : '-'} label="Moy. Prime / Ouvrier" />
                </div>
                <Panel title="Détail Prime Conditionnement par Ouvrier" icon="fa-list">
                    <table className="data-table" style={{fontSize:12}}>
                        <thead><tr><th>#</th><th>Matricule</th><th>Ouvrier</th><th style={{textAlign:'center'}}>Jours</th><th style={{textAlign:'right'}}>Prime (DH)</th></tr></thead>
                        <tbody>
                            {wList.map((w, i) => (<tr key={w.matricule}><td style={{color:'var(--gray-400)'}}>{i+1}</td><td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td><td><WorkerLink matricule={w.matricule} nom={w.nom} /></td><td style={{textAlign:'center',fontWeight:600}}>{w.jh}</td><td style={{textAlign:'right',fontWeight:700,color:'#e67e22'}}>{w.prime.toLocaleString('fr-FR')} DH</td></tr>))}
                            <tr style={{background:'rgba(230,126,34,0.08)',fontWeight:700}}><td></td><td>TOTAL</td><td>{wList.length} ouvriers</td><td style={{textAlign:'center'}}>{totalJH}</td><td style={{textAlign:'right',color:'#e67e22'}}>{totalPrime.toLocaleString('fr-FR')} DH</td></tr>
                        </tbody>
                    </table>
                </Panel>
                <Panel title="Prime Conditionnement par Jour" icon="fa-calendar-day">
                    <table className="data-table" style={{fontSize:12}}>
                        <thead><tr><th>Date</th><th style={{textAlign:'center'}}>Nb Ouvriers</th><th style={{textAlign:'right'}}>Prime (DH)</th></tr></thead>
                        <tbody>
                            {dailyData.map(d => (<tr key={d.date}><td>{new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</td><td style={{textAlign:'center',fontWeight:600}}>{d.workers}</td><td style={{textAlign:'right',fontWeight:600,color:'#e67e22'}}>{d.cout.toLocaleString('fr-FR')} DH</td></tr>))}
                            <tr style={{background:'rgba(230,126,34,0.08)',fontWeight:700}}><td>TOTAL</td><td style={{textAlign:'center'}}>{totalJH}</td><td style={{textAlign:'right',color:'#e67e22'}}>{totalPrime.toLocaleString('fr-FR')} DH</td></tr>
                        </tbody>
                    </table>
                </Panel>
            </div>);
        }

export { ConditionnementSub };
