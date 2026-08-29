/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): PrimesRecapSub */
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { invalidateCache } from '../shared/invalidateCache.jsx';
import { useState } from '../shared/reactHooks.jsx';

function PrimesRecapSub({ data, onNavigate, farmFilter, initialPeriode }) {
            const [detailRows, setDetailRows] = useState([]);
            const [transportData, setTransportData] = useState({});
            const [recolteRows, setRecolteRows] = useState([]);
            const [hsRows, setHsRows] = useState([]);
            const [diversByPeriode, setDiversByPeriode] = useState({}); // { periode: {total, count} }
            const [loading, setLoading] = useState(true);
            const [periodes, setPeriodes] = useState([]);
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const transportEquipes = data.transportConfig || [];
            const fmtDuree = (min) => { if (min == null || !isFinite(min)) return '—'; const a = Math.abs(Math.round(min)); return `${Math.floor(a/60)}h ${String(a%60).padStart(2,'0')}`; };

            // getEqPrefix UNIFIÉ (Lot 1 spec-quinzaine-cout-charge) : même comportement
            // déterministe que l'écran Quinzaine via window.QuinzaineUtils. L'ancien
            // getEqPrefix local retournait null pour un préfixe inconnu, ce qui divergeait
            // de l'écran Quinzaine (cause du bug 240 DH sur l'équipe NV).

            const isMyrtilleVar = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v || '');
            const calcPrimeLocal = (kg, variete, date) => {
                const k = kg || 0;
                if (isMyrtilleVar(variete)) {
                    const seuil = /breeze/i.test(variete || '') ? 25 : /cascade/i.test(variete || '') ? ((date || '') >= '2026-04-25' ? 30 : 25) : 30;
                    return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0;
                }
                if (k < 20) return 0;
                if (k < 25) return 20;
                if (k < 30) return 40;
                if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10;
                return Math.round((90 + (k - 40) * 4) * 10) / 10;
            };

            React.useEffect(() => {
                // Invalidate stale transport cache (operation field was added)
                invalidateCache('transport');
                let pending = 3;
                const done = () => { pending--; if (pending <= 0) setLoading(false); };
                cachedFetch('/api/pointage-rh?action=transport').then(json => {
                    if (json.success) {
                        setDetailRows(json.rows || []);
                        setTransportData(json);
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        if (json.periodes?.length > 0) setSelectedPeriode(initialPeriode || json.periodes[0]);
                    }
                }).catch(err => console.warn(err)).finally(done);
                cachedFetch('/api/pointage-rh?action=recolte-equipes').then(json => {
                    if (json.success) setRecolteRows(json.rows || []);
                }).catch(err => console.warn(err)).finally(done);
                cachedFetch('/api/pointage-rh?action=heures-sup').then(json => {
                    if (json.success) setHsRows(json.rows || []);
                }).catch(err => console.warn(err)).finally(done);
            }, []);

            // Pointage Divers : total montant + nb lignes pour la quinzaine courante (par quinzaine, mis en cache).
            React.useEffect(() => {
                const p = selectedPeriode || periodes[0];
                if (!p || diversByPeriode[p]) return;
                fetch('/api/validation?action=divers-entries-range&periode=' + encodeURIComponent(p)).then(r => r.json()).then(j => {
                    if (j && j.success) {
                        let total = 0, count = 0;
                        (j.dates || []).forEach(d => { const x = j.byDate[d]; if (x) { total += x.totalMontant || 0; count += (x.entries || []).length; } });
                        setDiversByPeriode(prev => ({ ...prev, [p]: { total: Math.round(total), count } }));
                    }
                }).catch(() => {});
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [selectedPeriode, periodes]);

            if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement...</div></div>;

            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const periodeRows = detailRows.filter(r => r.periode === currentPeriode);

            // Transport summary — fonction Transport UNIFIÉE (Lot 1
            // spec-quinzaine-cout-charge) : même source que l'écran Quinzaine
            // (window.QuinzaineUtils.computeTransportQuinzaine) → mêmes totaux à
            // périmètre ferme égal. Corrige le bug 240 DH : getEqPrefix déterministe
            // (DD→NV compté des deux côtés) + filtre ferme aligné sur Quinzaine.
            const coutMap = {};
            transportEquipes.forEach(t => { coutMap[t.prefix] = (data.getCoutTransport ? data.getCoutTransport(t.prefix, currentPeriode) : t.coutParOuvrier) || t.coutParOuvrier || 0; });
            const transportSummary = (window.QuinzaineUtils && window.QuinzaineUtils.computeTransportQuinzaine)
                ? window.QuinzaineUtils.computeTransportQuinzaine(detailRows, {
                    periode: currentPeriode,
                    transportEquipes,
                    coutMap,
                    ferme: farmFilter || null,
                })
                : { total: 0, totalWorkers: 0, dates: [], byEquipe: [], dailyByEquipe: {} };
            const totalTransportCout = transportSummary.total;
            const totalTransportJH = transportSummary.totalWorkers;

            // Traitement summary: 10 DH per worker-day for workers with operationFamille containing "Traitement"
            const traitementRows = periodeRows.filter(r => (r.operationFamille || '').toLowerCase().includes('traitement'));
            const traitementWorkerDays = new Set();
            traitementRows.forEach(r => traitementWorkerDays.add(r.matricule + '|' + r.jour));
            const totalTraitementJH = traitementWorkerDays.size;
            const totalTraitementCout = totalTraitementJH * 10;

            // Conditionnement & Chargement: use server-side pre-calculated data
            const condDetail = (transportData?.conditionnementDetail || []).filter(w => w.periode === currentPeriode);
            const totalConditionnementJH = condDetail.reduce((s, w) => s + w.jh, 0);
            const totalConditionnementCout = totalConditionnementJH * 10;

            const chargementCoutParJour = data.primesConfig?.primeChargement?.coutParJour || 10;
            const chargDetail = (transportData?.chargementDetail || []).filter(w => w.periode === currentPeriode);
            const totalChargementJH = chargDetail.reduce((s, w) => s + w.jh, 0);
            const totalChargementCout = totalChargementJH * chargementCoutParJour;

            // Jour Férié: server-side pre-calculated
            const ferieDetail = (transportData?.jourFerieDetail || []).filter(w => w.periode === currentPeriode);
            const totalFerieJH = ferieDetail.reduce((s, w) => s + w.jh, 0);
            const totalFerieCout = Math.round(ferieDetail.reduce((s, w) => s + (w.cout || 0), 0));
            const totalFerieOuvriers = ferieDetail.length;

            // Récolte summary from live recolte-equipes data
            const recolteFiltered = recolteRows.filter(r => r.periode === currentPeriode);
            // Aggregate kg per worker per day, then calculate primes
            const recolteWorkerDay = {};
            recolteFiltered.forEach(r => {
                const key = (r.matricule || '') + '|' + (r.jour || '');
                if (!recolteWorkerDay[key]) recolteWorkerDay[key] = { matricule: r.matricule, nom: r.nom, jour: r.jour, kg: 0, variete: r.variete, ferme: r.ferme };
                recolteWorkerDay[key].kg += (r.kg || 0);
            });
            const recolteEntries = Object.values(recolteWorkerDay);
            recolteEntries.forEach(e => { e.prime = calcPrimeLocal(e.kg, e.variete, e.jour); });
            const totalRecoltePrime = recolteEntries.reduce((s, e) => s + e.prime, 0);
            const nbRecolteurs = new Set(recolteEntries.filter(e => e.prime > 0).map(e => e.matricule)).size;
            const totalRecolteJH = new Set(recolteEntries.map(e => e.matricule + '|' + e.jour)).size;

            // Heures Supp. : total dépassement (heures, pas de DH) + nb ouvriers en dépassement, pour la quinzaine.
            const hsFiltered = hsRows.filter(r => r.periode === currentPeriode);
            const hsTotalOvertime = hsFiltered.reduce((s, r) => s + (r.overtimeMin || 0), 0);
            const hsNbDep = new Set(hsFiltered.filter(r => (r.overtimeMin || 0) > 0).map(r => r.matricule)).size;

            // Pointage Divers : montant + nb lignes (depuis le cache par quinzaine)
            const diversInfo = diversByPeriode[currentPeriode] || { total: 0, count: 0 };

            const primeCards = [
                { id: 'recolte', label: 'Récolte', icon: 'fa-coins', color: 'var(--orange)', montant: Math.round(totalRecoltePrime), jh: totalRecolteJH, jhLabel: 'ouvriers-jours / ' + nbRecolteurs + ' primés', active: true },
                { id: 'transport', label: 'Transport', icon: 'fa-bus', color: 'var(--green)', montant: Math.round(totalTransportCout), jh: totalTransportJH, active: true },
                { id: 'traitement', label: 'Traitement', icon: 'fa-spray-can-sparkles', color: 'var(--blue)', montant: totalTraitementCout, jh: totalTraitementJH, active: true },
                { id: 'conditionnement', label: 'Conditionnement', icon: 'fa-box-open', color: '#e67e22', montant: totalConditionnementCout, jh: totalConditionnementJH, active: true },
                { id: 'chargement', label: 'Chargement', icon: 'fa-truck-loading', color: '#8e44ad', montant: totalChargementCout, jh: totalChargementJH, active: true },
                { id: 'jour_ferie', label: 'Jour Férié', icon: 'fa-star', color: '#c0392b', montant: totalFerieCout, jh: totalFerieJH, jhLabel: totalFerieOuvriers + ' ouvriers / ' + totalFerieJH + ' jours sup.', active: true },
                { id: 'pointage_divers', label: 'Pointage Divers', icon: 'fa-truck', color: '#16a085', montant: diversInfo.total, jh: diversInfo.count, jhLabel: 'ligne(s)', active: true },
                { id: 'heures_sup', label: 'Heures Supp.', icon: 'fa-clock', color: 'var(--berry)', noDH: true, valueText: fmtDuree(hsTotalOvertime), jh: hsNbDep, jhLabel: 'ouvriers en dépassement', active: true },
            ];

            return (
                <div>
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'var(--berry-pale)',color:'var(--berry)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-award" style={{marginRight:4}}></i>Récapitulatif Primes — {currentPeriode}
                        </span>
                        <window.QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} value={selectedPeriode} onChange={v => setSelectedPeriode(v)} />
                    </div>

                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:16,marginBottom:24}}>
                        {primeCards.map(pc => (
                            <div key={pc.id} onClick={() => pc.active && onNavigate(pc.id, currentPeriode)}
                                style={{background:'#fff',borderRadius:12,padding:20,border: pc.active ? `2px solid ${pc.color}` : '1px solid var(--gray-200)',
                                    cursor: pc.active ? 'pointer' : 'default',opacity: pc.active ? 1 : 0.6,
                                    boxShadow: pc.active ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',transition:'all 0.2s'}}>
                                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                                    <div style={{width:40,height:40,borderRadius:10,background: pc.active ? pc.color : 'var(--gray-200)',
                                        display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:16}}>
                                        <i className={`fa-solid ${pc.icon}`}></i>
                                    </div>
                                    <div style={{fontSize:14,fontWeight:700,color: pc.active ? 'var(--gray-800)' : 'var(--gray-400)'}}>{pc.label}</div>
                                </div>
                                {pc.active ? (
                                    <div>
                                        <div style={{fontSize:22,fontWeight:800,color:pc.color}}>{pc.noDH ? pc.valueText : (pc.montant?.toLocaleString('fr-FR') + ' DH')}</div>
                                        <div style={{fontSize:11,color:'var(--gray-500)',marginTop:4}}>{pc.jh?.toLocaleString('fr-FR')} {pc.jhLabel || 'ouvriers-jours'}</div>
                                        <div style={{fontSize:10,color:pc.color,marginTop:8,fontWeight:600}}>
                                            Voir le détail <i className="fa-solid fa-arrow-right" style={{marginLeft:4}}></i>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{fontSize:12,color:'var(--gray-400)',fontStyle:'italic'}}>Bientôt disponible</div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Tableau récap */}
                    <Panel title="Synthèse des Primes" icon="fa-table">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Type de Prime</th>
                                    <th style={{textAlign:'center'}}>Ouvriers-Jours</th>
                                    <th style={{textAlign:'right'}}>Montant (DH)</th>
                                    <th style={{textAlign:'center'}}>Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {primeCards.map(pc => (
                                    <tr key={pc.id} style={{opacity: pc.active ? 1 : 0.5}}>
                                        <td><i className={`fa-solid ${pc.icon}`} style={{marginRight:8,color: pc.active ? pc.color : 'var(--gray-300)'}}></i><strong>{pc.label}</strong></td>
                                        <td style={{textAlign:'center',fontWeight:600}}>{pc.active ? pc.jh?.toLocaleString('fr-FR') : '-'}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color: pc.active ? pc.color : 'var(--gray-400)'}}>{pc.active ? (pc.noDH ? pc.valueText : pc.montant?.toLocaleString('fr-FR') + ' DH') : '-'}</td>
                                        <td style={{textAlign:'center'}}>
                                            {pc.active ? (
                                                <span className="status-badge" style={{background:'rgba(40,167,69,0.1)',color:'#28a745',fontSize:10}}>
                                                    <i className="fa-solid fa-circle-check" style={{marginRight:4}}></i>Actif
                                                </span>
                                            ) : (
                                                <span className="status-badge" style={{background:'var(--gray-100)',color:'var(--gray-400)',fontSize:10}}>
                                                    <i className="fa-solid fa-hourglass-half" style={{marginRight:4}}></i>À venir
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                    <td>TOTAL</td>
                                    <td style={{textAlign:'center'}}>{(totalRecolteJH + totalTransportJH + totalTraitementJH).toLocaleString('fr-FR')}</td>
                                    <td style={{textAlign:'right',color:'var(--berry)'}}>{Math.round(totalRecoltePrime + totalTransportCout + totalTraitementCout + diversInfo.total).toLocaleString('fr-FR')} DH</td>
                                    <td></td>
                                </tr>
                            </tbody>
                        </table>
                    </Panel>
                </div>
            );
        }

export { PrimesRecapSub };
