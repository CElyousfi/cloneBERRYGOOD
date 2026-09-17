/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): HeuresSupSub */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { invalidateCache } from '../shared/invalidateCache.jsx';
import { useState } from '../shared/reactHooks.jsx';

import { QuinzaineCampagneSelect } from '../shared/QuinzaineCampagneSelect.jsx';
// ===================== HEURES SUPPLÉMENTAIRES TAB =====================
        // Durée travaillée (entrée/sortie BEE ONE via prod_presence) + dépassement
        // au-delà de 8h30, par quinzaine. Récolte (rendement) et gardiens exclus.
        function HeuresSupSub({ data, farmFilter, initialPeriode }) {
            const [rows, setRows] = useState([]);
            const [periodes, setPeriodes] = useState([]);
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const [periodeDates, setPeriodeDates] = useState({});
            const [excludedFonctions, setExcludedFonctions] = useState([]);
            const [seuilMinutes, setSeuilMinutes] = useState(510);
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const [onlyOvertime, setOnlyOvertime] = useState(false);
            const [loading, setLoading] = useState(true);
            const [backfilling, setBackfilling] = useState(false);
            const [backfillMsg, setBackfillMsg] = useState('');
            const [selectedWorkerMat, setSelectedWorkerMat] = useState(null);

            const loadHS = (keepPeriode) => {
                invalidateCache('heures-sup');
                return cachedFetch('/api/pointage-rh?action=heures-sup').then(json => {
                    if (json && json.success) {
                        setRows(json.rows || []);
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        setPeriodeDates(json.periodeDates || {});
                        if (typeof json.seuilMinutes === 'number') setSeuilMinutes(json.seuilMinutes);
                        setExcludedFonctions(json.excludedFonctions || []);
                        const ps = json.periodes || [];
                        if (ps.length > 0) setSelectedPeriode(prev => (keepPeriode && prev) ? prev : (initialPeriode && ps.includes(initialPeriode) ? initialPeriode : ps[0]));
                    }
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            };

            React.useEffect(() => { loadHS(false); }, []);

            // Backfill des heures de sortie depuis BEE ONE Production pour la quinzaine
            // sélectionnée (rattrape les sorties saisies tardivement). Ne touche pas au pointage.
            const handleBackfill = async () => {
                const cur = selectedPeriode || (periodes[0] || '');
                const dts = (periodeDates[cur] && periodeDates[cur].length > 0) ? [...periodeDates[cur]].sort() : [...new Set((rows || []).filter(r => r.periode === cur).map(r => r.jour))].sort();
                if (dts.length === 0) { alert('Aucune date pour cette quinzaine.'); return; }
                const startDate = dts[0], endDate = dts[dts.length - 1];
                if (!confirm(`Mettre à jour les heures d'entrée/sortie depuis BEE ONE pour ${cur} (${startDate} → ${endDate}) ?\n\nLe pointage analytique n'est pas modifié.`)) return;
                setBackfilling(true); setBackfillMsg('');
                try {
                    const token = (firebaseAuth && firebaseAuth.currentUser) ? await firebaseAuth.currentUser.getIdToken() : null;
                    const resp = await fetch('/api/backfill-presence', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
                        body: JSON.stringify({ startDate, endDate }),
                    });
                    const json = await resp.json();
                    if (json && json.success) {
                        setBackfillMsg(`✓ ${json.daysWritten} jour(s) · ${json.totalRows} ouvriers · ${json.withSortie} avec sortie`);
                        await loadHS(true);
                    } else {
                        setBackfillMsg('Erreur : ' + ((json && json.error) || 'inconnue'));
                    }
                } catch (e) {
                    setBackfillMsg('Erreur : ' + e.message);
                } finally {
                    setBackfilling(false);
                }
            };

            const formatDuration = (min) => {
                if (min == null || !isFinite(min)) return '—';
                const abs = Math.abs(Math.round(min));
                const h = Math.floor(abs / 60), m = abs % 60;
                return `${min < 0 ? '-' : ''}${h}h ${String(m).padStart(2, '0')}`;
            };
            const seuilLabel = formatDuration(seuilMinutes);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🍇</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement heures supp...</div></div>;

            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const periodeRows = rows.filter(r => r.periode === currentPeriode && (!farmFilter || r.ferme === farmFilter));

            // Colonnes = tous les jours de la quinzaine (même sans sync, pour voir les trous)
            const allDates = (periodeDates[currentPeriode] && periodeDates[currentPeriode].length > 0)
                ? [...periodeDates[currentPeriode]].sort()
                : [...new Set(periodeRows.map(r => r.jour))].sort();

            // Regroupement par ouvrier
            const byWorker = {};
            periodeRows.forEach(r => {
                let w = byWorker[r.matricule];
                if (!w) {
                    w = { matricule: r.matricule, nom: r.nom || r.matricule, ferme: r.ferme,
                          fonctionCounts: {}, fonctionInfo: {}, fonctionMissing: true,
                          byDay: {}, totalOvertime: 0, joursPresents: 0, joursAvecSortie: 0 };
                    byWorker[r.matricule] = w;
                }
                w.byDay[r.jour] = { durationMin: r.durationMin, overtimeMin: r.overtimeMin || 0, clockedIn: r.clockedIn, heureEntree: r.heureEntree, heureSortie: r.heureSortie };
                w.totalOvertime += r.overtimeMin || 0;
                if (r.durationMin != null || r.clockedIn) w.joursPresents += 1;
                if (r.durationMin != null) w.joursAvecSortie += 1;
                if (!r.fonctionMissing) {
                    w.fonctionMissing = false;
                    const key = `${r.operationFamille || ''}|${r.operation || ''}`;
                    w.fonctionCounts[key] = (w.fonctionCounts[key] || 0) + 1;
                    if (!w.fonctionInfo[key]) w.fonctionInfo[key] = { operationFamille: r.operationFamille, operation: r.operation };
                }
            });

            let allWorkers = Object.values(byWorker).map(w => {
                const bestKey = Object.entries(w.fonctionCounts).sort((a, b) => b[1] - a[1])[0];
                const info = bestKey ? w.fonctionInfo[bestKey[0]] : null;
                return { ...w, fonctionFamille: info ? info.operationFamille : null, fonctionOp: info ? info.operation : null };
            });
            // Exclure les ouvriers sans aucune heure de sortie sur la quinzaine
            // (HS non calculable). Compteur conservé pour transparence.
            const nbSansSortie = allWorkers.filter(w => w.joursAvecSortie === 0).length;
            let workerList = allWorkers.filter(w => w.joursAvecSortie > 0);
            workerList.sort((a, b) => b.totalOvertime - a.totalOvertime || a.matricule.localeCompare(b.matricule));
            const displayWorkers = onlyOvertime ? workerList.filter(w => w.totalOvertime > 0) : workerList;

            // Totaux
            const totalOvertimeMin = workerList.reduce((s, w) => s + w.totalOvertime, 0);
            const nbEnDepassement = workerList.filter(w => w.totalOvertime > 0).length;
            const totalWorkerDays = workerList.reduce((s, w) => s + w.joursPresents, 0);
            const dailyOvertime = allDates.map(d => ({
                date: d,
                overtimeMin: workerList.reduce((s, w) => s + ((w.byDay[d] && w.byDay[d].overtimeMin) || 0), 0),
            }));

            const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
            const fmtDateLong = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
            const selWorkerIdx = selectedWorkerMat ? displayWorkers.findIndex(w => w.matricule === selectedWorkerMat) : -1;
            const selWorker = selWorkerIdx >= 0 ? displayWorkers[selWorkerIdx] : null;

            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#e8d5e8',color:'var(--berry)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-clock" style={{marginRight:4}}></i>Heures Supp. — {currentPeriode}
                        </span>
                        <QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} periodeDates={periodeDates} value={selectedPeriode} onChange={v => setSelectedPeriode(v)} />
                        <label style={{fontSize:11,display:'flex',alignItems:'center',gap:5,cursor:'pointer',color:'var(--gray-600)'}}>
                            <input type="checkbox" checked={onlyOvertime} onChange={e => setOnlyOvertime(e.target.checked)} />
                            Seulement les dépassements
                        </label>
                        <button onClick={handleBackfill} disabled={backfilling} title="Recharge les heures d'entrée/sortie depuis BEE ONE pour cette quinzaine (rattrape les sorties saisies tardivement). Ne modifie pas le pointage."
                            style={{marginLeft:'auto',padding:'5px 12px',background:backfilling?'var(--gray-200)':'var(--berry)',color:backfilling?'var(--gray-500)':'#fff',border:'none',borderRadius:8,fontSize:11,fontWeight:600,cursor:backfilling?'default':'pointer',display:'flex',alignItems:'center',gap:6}}>
                            <i className={`fa-solid ${backfilling?'fa-spinner fa-spin':'fa-rotate'}`}></i>
                            {backfilling ? 'Mise à jour…' : 'Mettre à jour les heures de sortie'}
                        </button>
                    </div>
                    {backfillMsg && <div style={{marginBottom:12,fontSize:11,color:backfillMsg.startsWith('✓')?'var(--green)':'var(--red)',fontWeight:600}}>{backfillMsg}</div>}

                    <div className="kpi-grid" style={{marginBottom:16}}>
                        <KPICard icon="fa-users" iconClass="berry" value={workerList.length} label="Ouvriers éligibles" />
                        <KPICard icon="fa-user-clock" iconClass="orange" value={nbEnDepassement} label="Ouvriers en dépassement" />
                        <KPICard icon="fa-clock" iconClass="green" value={formatDuration(totalOvertimeMin)} label="Total Heures Supp. Quinzaine" />
                        <KPICard icon="fa-calculator" iconClass="blue" value={nbEnDepassement > 0 ? formatDuration(totalOvertimeMin / nbEnDepassement) : '-'} label="Dépassement moyen / ouvrier" />
                    </div>

                    <div style={{fontSize:10,color:'var(--gray-500)',marginBottom:10,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                        <span style={{background:'rgba(139,34,82,0.08)',padding:'3px 8px',borderRadius:8}}>
                            <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>
                            Dépassement compté au-delà de {seuilLabel} (durée brute entrée→sortie). Récolte exclue automatiquement (payée au rendement).
                        </span>
                        {excludedFonctions.length > 0
                            ? <span style={{background:'rgba(231,76,60,0.08)',color:'#c0392b',padding:'3px 8px',borderRadius:8}}><i className="fa-solid fa-ban" style={{marginRight:4}}></i>Fonctions exclues : {excludedFonctions.join(', ')}</span>
                            : <span style={{background:'rgba(243,156,18,0.1)',color:'#b9770e',padding:'3px 8px',borderRadius:8}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>Aucune fonction exclue configurée (gardiens non filtrés)</span>}
                    </div>

                    <Panel title="Heures supplémentaires par ouvrier et par jour" icon="fa-calendar-day">
                        <div className="table-responsive">
                        <table className="data-table" style={{fontSize:11,whiteSpace:'nowrap'}}>
                            <thead>
                                <tr>
                                    <th>Matricule</th>
                                    <th>Nom Prénom</th>
                                    <th>Fonction pointée</th>
                                    {allDates.map(d => <th key={d} style={{textAlign:'center',fontSize:9,whiteSpace:'nowrap'}}>{fmtDate(d)}</th>)}
                                    <th style={{textAlign:'center',fontWeight:700}}>Total HS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayWorkers.map(w => (
                                    <tr key={w.matricule} onClick={() => setSelectedWorkerMat(w.matricule)} style={{cursor:'pointer', ...(w.fonctionMissing ? {background:'rgba(243,156,18,0.06)'} : {})}} title="Voir le détail entrée/sortie">
                                        <td style={{fontFamily:'monospace',fontWeight:600,color:'var(--berry)'}}>{w.matricule}</td>
                                        <td>{w.nom || '—'}</td>
                                        <td style={{fontSize:10}}>
                                            {w.fonctionMissing
                                                ? <span style={{color:'#b9770e'}} title="Présent au pointage entrée/sortie mais absent du pointage analytique — fonction inconnue"><i className="fa-solid fa-triangle-exclamation" style={{marginRight:3}}></i>—</span>
                                                : <span>{w.fonctionFamille || '—'}{w.fonctionOp ? <span style={{color:'var(--gray-400)',marginLeft:4}}>· {w.fonctionOp}</span> : null}</span>}
                                        </td>
                                        {allDates.map(d => {
                                            const c = w.byDay[d];
                                            if (!c || (c.durationMin == null && !c.clockedIn)) return <td key={d} style={{textAlign:'center',color:'var(--gray-200)'}}>-</td>;
                                            if (c.overtimeMin > 0) return <td key={d} style={{textAlign:'center',fontSize:11,fontWeight:700,color:'#27ae60',background:'rgba(46,204,113,0.10)'}} title={`${c.heureEntree || '?'} → ${c.heureSortie || '?'}`}>{formatDuration(c.overtimeMin)}</td>;
                                            if (c.clockedIn) return <td key={d} style={{textAlign:'center',color:'#e67e22'}} title="Entré, pas encore sorti"><i className="fa-solid fa-hourglass-half" style={{fontSize:9}}></i></td>;
                                            return <td key={d} style={{textAlign:'center',color:'var(--gray-300)'}} title={`${c.heureEntree || '?'} → ${c.heureSortie || '?'} · pas de dépassement`}>-</td>;
                                        })}
                                        <td style={{textAlign:'center',fontWeight:700,color:w.totalOvertime>0?'var(--berry)':'var(--gray-300)'}}>
                                            {w.totalOvertime > 0 ? formatDuration(w.totalOvertime) : '—'}
                                        </td>
                                    </tr>
                                ))}
                                {displayWorkers.length === 0 && (
                                    <tr><td colSpan={allDates.length + 4} style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucun ouvrier {onlyOvertime ? 'en dépassement ' : ''}pour cette quinzaine / ce filtre.</td></tr>
                                )}
                            </tbody>
                            {displayWorkers.length > 0 && (
                                <tfoot>
                                    <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                        <td colSpan={3} style={{textAlign:'right'}}>Total dépassement / jour</td>
                                        {dailyOvertime.map(dt => (
                                            <td key={dt.date} style={{textAlign:'center',fontSize:10,color:dt.overtimeMin>0?'var(--berry)':'var(--gray-300)'}}>
                                                {dt.overtimeMin > 0 ? formatDuration(dt.overtimeMin) : '-'}
                                            </td>
                                        ))}
                                        <td style={{textAlign:'center',color:'var(--berry)',fontSize:12}}>{formatDuration(totalOvertimeMin)}</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                        </div>
                        <div style={{marginTop:10,fontSize:10,color:'var(--gray-400)'}}>
                            {workerList.length} ouvrier(s) éligible(s) · {totalWorkerDays} jour(s)-ouvrier pointé(s) · source : pointage entrée/sortie BEE ONE.
                            {nbSansSortie > 0 && <span style={{color:'#b9770e',marginLeft:6}}><i className="fa-solid fa-user-slash" style={{marginRight:3}}></i>{nbSansSortie} ouvrier(s) sans heure de sortie exclu(s) — à régulariser via « Mettre à jour les heures de sortie ».</span>}
                        </div>
                    </Panel>

                    {selWorker && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setSelectedWorkerMat(null)}>
                            <div style={{background:'#fff',borderRadius:12,maxWidth:560,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{padding:'14px 18px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
                                    <div>
                                        <h3 style={{margin:0,fontSize:15,color:'var(--berry)'}}><i className="fa-solid fa-user-clock" style={{marginRight:8}}></i>{selWorker.nom || selWorker.matricule}</h3>
                                        <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2,fontFamily:'monospace'}}>{selWorker.matricule} · {selWorker.fonctionFamille || '—'}{selWorker.fonctionOp ? ' · ' + selWorker.fonctionOp : ''}</div>
                                    </div>
                                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                                        <button onClick={() => selWorkerIdx > 0 && setSelectedWorkerMat(displayWorkers[selWorkerIdx - 1].matricule)} disabled={selWorkerIdx <= 0}
                                            style={{background:'none',border:'1px solid '+(selWorkerIdx>0?'var(--berry)':'#ddd'),borderRadius:8,width:32,height:32,cursor:selWorkerIdx>0?'pointer':'default',color:selWorkerIdx>0?'var(--berry)':'#ccc',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className="fa-solid fa-chevron-left"></i>
                                        </button>
                                        <span style={{fontSize:12,fontWeight:600,color:'var(--gray-500)',whiteSpace:'nowrap'}}>{selWorkerIdx + 1} / {displayWorkers.length}</span>
                                        <button onClick={() => selWorkerIdx < displayWorkers.length - 1 && setSelectedWorkerMat(displayWorkers[selWorkerIdx + 1].matricule)} disabled={selWorkerIdx >= displayWorkers.length - 1}
                                            style={{background:'none',border:'1px solid '+(selWorkerIdx<displayWorkers.length-1?'var(--berry)':'#ddd'),borderRadius:8,width:32,height:32,cursor:selWorkerIdx<displayWorkers.length-1?'pointer':'default',color:selWorkerIdx<displayWorkers.length-1?'var(--berry)':'#ccc',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className="fa-solid fa-chevron-right"></i>
                                        </button>
                                        <button onClick={() => setSelectedWorkerMat(null)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--gray-400)'}}>&times;</button>
                                    </div>
                                </div>
                                <div style={{padding:'8px 18px 16px'}}>
                                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'8px 0 12px',fontSize:12}}>
                                        <span style={{color:'var(--gray-500)'}}>Quinzaine : <strong>{currentPeriode}</strong></span>
                                        <span style={{background:'var(--berry-pale)',color:'var(--berry)',padding:'3px 10px',borderRadius:8,fontWeight:700}}>Total HS : {selWorker.totalOvertime > 0 ? formatDuration(selWorker.totalOvertime) : '—'}</span>
                                    </div>
                                    <table className="data-table" style={{fontSize:12,width:'100%'}}>
                                        <thead>
                                            <tr>
                                                <th>Jour</th>
                                                <th style={{textAlign:'center'}}>Entrée</th>
                                                <th style={{textAlign:'center'}}>Sortie</th>
                                                <th style={{textAlign:'center'}}>Durée</th>
                                                <th style={{textAlign:'center'}}>Heures supp.</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {allDates.map(d => {
                                                const c = selWorker.byDay[d];
                                                if (!c) return (
                                                    <tr key={d} style={{color:'var(--gray-300)'}}>
                                                        <td>{fmtDateLong(d)}</td>
                                                        <td colSpan={4} style={{textAlign:'center'}}>absent</td>
                                                    </tr>
                                                );
                                                const hasOT = c.overtimeMin > 0;
                                                return (
                                                    <tr key={d} style={hasOT ? {background:'rgba(46,204,113,0.08)'} : null}>
                                                        <td style={{fontWeight:500}}>{fmtDateLong(d)}</td>
                                                        <td style={{textAlign:'center',fontFamily:'monospace'}}>{c.heureEntree || '—'}</td>
                                                        <td style={{textAlign:'center',fontFamily:'monospace',color:c.heureSortie?'inherit':'#e67e22'}}>{c.heureSortie || (c.clockedIn ? 'en cours' : '—')}</td>
                                                        <td style={{textAlign:'center'}}>{c.durationMin != null ? formatDuration(c.durationMin) : '—'}</td>
                                                        <td style={{textAlign:'center',fontWeight:hasOT?700:400,color:hasOT?'#27ae60':'var(--gray-300)'}}>{hasOT ? formatDuration(c.overtimeMin) : '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { HeuresSupSub };
