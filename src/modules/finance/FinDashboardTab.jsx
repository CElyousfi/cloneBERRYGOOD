/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): FinDashboardTab */
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { WorkerLink } from '../rh/WorkerLink.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

function FinDashboardTab({ data, farmFilter, onNavigateMeteo }) {
            const [viewMode, setViewMode] = useState('global');
            const [selectedCharge, setSelectedCharge] = useState(null);
            const [nouveauxData, setNouveauxData] = useState(null);
            const [showNouveaux, setShowNouveaux] = useState(false);
            const [alertesAbsence, setAlertesAbsence] = useState(null);
            const [showAlertes, setShowAlertes] = useState(false);
            const [pendingTransportChanges, setPendingTransportChanges] = useState([]);
            const [showTransportChanges, setShowTransportChanges] = useState(false);
            const [validatingChange, setValidatingChange] = useState(null);
            const [moAnalytique, setMoAnalytique] = useState(null);
            const [consumptionCosts, setConsumptionCosts] = useState(null);
            const [fuelData, setFuelData] = useState(null);
            const [liqData, setLiqData] = useState(null);
            const [marcheLocalBons, setMarcheLocalBons] = useState(null);
            const [cpcMode, setCpcMode] = useState('total');

            // Map prefix to equipe name
            const prefixToName = {};
            (data.transportConfig || []).forEach(t => { prefixToName[t.prefix] = t.equipe; });

            React.useEffect(() => {
                cachedFetch('/api/pointage-rh?action=nouveaux-ouvriers')
                    .then(json => { if (json.success) setNouveauxData(json); })
                    .catch(() => {});
                cachedFetch('/api/pointage-rh?action=quinzaine-alertes')
                    .then(json => { if (json.success) setAlertesAbsence(json); })
                    .catch(() => {});
                cachedFetch('/api/pointage-rh?action=mo-analytique-variete')
                    .then(json => { if (json.success) setMoAnalytique(json); })
                    .catch(() => {});
                cachedFetch('/api/stock?action=get-consumption-costs')
                    .then(json => { if (json.success) setConsumptionCosts(json.data); })
                    .catch(() => {});
                // Fuel CPC: read snapshot from Firestore (fast, always available)
                if (typeof firebase !== 'undefined' && firebase.firestore) {
                    firebase.firestore().collection('cpc_snapshots').doc('fuel').get()
                        .then(doc => { if (doc.exists) setFuelData(doc.data()); })
                        .catch(() => {});
                }
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                ]).then(([liqJson, expJson]) => {
                    if (liqJson.success && expJson.success) setLiqData({ liquidations: liqJson.liquidations || [], expeditions: expJson.expeditions || [] });
                }).catch(() => {});
                // Load ALL marché local bons: pfq_interne (typeVente=Marché Local) + bons_marche_local
                (async () => {
                    const allBons = [];
                    try {
                        const prodBons = await loadBonsFromFirestore();
                        prodBons.filter(b => b.typeVente === 'Marché Local').forEach(b => allBons.push(b));
                    } catch(e) {}
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const snap = await firebase.firestore().collection('bons_marche_local').get();
                            snap.forEach(d => allBons.push({ id: d.id, ...d.data(), source: 'firestore' }));
                        }
                    } catch(e) {}
                    setMarcheLocalBons(allBons);
                })();
                fetch('/api/validation?action=transport-config')
                    .then(r => r.json())
                    .then(json => { if (json.success) setPendingTransportChanges(json.pendingChanges || []); })
                    .catch(() => {});
            }, []);

            const handleValidateTransportChange = (changeId, decision) => {
                setValidatingChange(changeId);
                fetch('/api/validation?action=transport-config-validate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ changeId, decision, validatedBy: 'Finance' }),
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        setPendingTransportChanges(prev => prev.filter(c => c.id !== changeId));
                    }
                }).catch(err => alert('Erreur: ' + err.message)).finally(() => setValidatingChange(null));
            };

            const charges = data.cpcCharges;
            const varietes = data.cpcVarietes;
            const ccSummary = consumptionCosts && consumptionCosts['_summary'];

            // Campagne Jul→Juin : map mois → [année, mois 1-12]
            const MOIS_CAMPAGNE = { 'Jul':[2025,7],'Aoû':[2025,8],'Sep':[2025,9],'Oct':[2025,10],'Nov':[2025,11],'Déc':[2025,12],'Jan':[2026,1],'Fév':[2026,2],'Mar':[2026,3],'Avr':[2026,4],'Mai':[2026,5],'Jui':[2026,6] };
            const _today = new Date();
            const _todayY = _today.getFullYear();
            const _todayM = _today.getMonth() + 1;
            const _todayD = _today.getDate();
            // État d'un mois par rapport à aujourd'hui : 'past' | 'current' | 'future'
            const moisStatus = (label) => {
                const ym = MOIS_CAMPAGNE[label]; if (!ym) return 'past';
                const [y,mo] = ym;
                if (y < _todayY || (y === _todayY && mo < _todayM)) return 'past';
                if (y === _todayY && mo === _todayM) return 'current';
                return 'future';
            };
            // Total écoulé à date avec pro-rata du mois courant
            const elapsedTotal = (parMois) => {
                if (!Array.isArray(parMois)) return 0;
                let t = 0;
                for (const { m, v } of parMois) {
                    const s = moisStatus(m);
                    if (s === 'past') t += v;
                    else if (s === 'current') {
                        const [y, mo] = MOIS_CAMPAGNE[m];
                        const daysInMonth = new Date(y, mo, 0).getDate();
                        t += v * (_todayD / daysInMonth);
                    }
                }
                return Math.round(t);
            };
            // Nombre de mois écoulés (avec fraction pour le mois courant) sur la campagne
            const elapsedMonthsCount = (() => {
                let n = 0;
                for (const label of Object.keys(MOIS_CAMPAGNE)) {
                    const s = moisStatus(label);
                    if (s === 'past') n += 1;
                    else if (s === 'current') {
                        const [y, mo] = MOIS_CAMPAGNE[label];
                        n += _todayD / new Date(y, mo, 0).getDate();
                    }
                }
                return n;
            })();
            // Pour les charges dont parMois s'arrête à Déc (variables Jul-Déc), elapsed = total
            const chargeElapsed = (c) => {
                if (!c.parMois || c.parMois.length === 0) return c.total;
                const sumParMois = c.parMois.reduce((s, x) => s + (x.v || 0), 0);
                // si parMois ne couvre que les mois passés réalisés (ex: 6 mois Jul-Déc), total = somme parMois
                if (Math.abs(sumParMois - c.total) < 1) return elapsedTotal(c.parMois);
                // sinon (cas mixte) : prorata sur le total
                return Math.round(c.total * elapsedTotal(c.parMois) / sumParMois);
            };

            // --- Live KPI totals ---
            // CA Live from liquidations
            const liveCAExport = liqData ? (() => {
                let total = 0;
                (liqData.liquidations || []).forEach(liq => {
                    (liq.rows || []).forEach(row => { total += row.gsNet || 0; });
                });
                return total;
            })() : null;
            const liveCALocal = marcheLocalBons ? marcheLocalBons.reduce((s, b) => s + (parseFloat(b.totalDH) || ((parseFloat(b.poidsLot)||0) * (parseFloat(b.prixDH)||0))), 0) : null;
            const liveMO = moAnalytique ? moAnalytique.totaux.total : null;
            const liveEngrais = ccSummary ? ccSummary.total_engrais_ttc : null;
            const livePesticides = ccSummary ? ccSummary.total_pesticides_ttc : null;

            // Use live values when available, otherwise hardcoded
            const totalCAExportDisplay = liveCAExport !== null ? liveCAExport : data.totalCAExport;
            const totalCALocalDisplay = liveCALocal !== null ? liveCALocal : data.totalCALocal;
            const totalCADisplay = totalCAExportDisplay + totalCALocalDisplay;

            // Charges: MO live + intrants live + structure hardcodée
            const moCharges = liveMO !== null ? liveMO : charges.filter(c => ['M.O Récolte','M.O Hors Récolte','STC Ouvriers'].includes(c.poste)).reduce((s,c) => s+chargeElapsed(c), 0);
            const intrantsCharges = charges.filter(c => ['Plants','Engrais','Pesticides','Eau ORMVAL','Autres Intrants'].includes(c.poste)).reduce((s,c) => {
                if (ccSummary && c.poste === 'Engrais') return s + ccSummary.total_engrais_ttc;
                if (ccSummary && c.poste === 'Pesticides') return s + ccSummary.total_pesticides_ttc;
                return s + chargeElapsed(c);
            }, 0);
            const structureCharges = charges.filter(c => ['Encadrement','CNSS','IR','Frais Généraux','Loyer Terrains','Électricité','Gasoil & Gaz','Transport & Divers','Amortissement & Frais Financiers'].includes(c.poste)).reduce((s,c) => s+chargeElapsed(c), 0);
            const totalChargesDisplay = moCharges + intrantsCharges + structureCharges;
            const resultatDisplay = totalCADisplay - totalChargesDisplay;

            // Charges par poste — override live values
            const liveChargeOverrides = {};
            if (liveEngrais !== null) liveChargeOverrides['Engrais'] = liveEngrais;
            if (livePesticides !== null) liveChargeOverrides['Pesticides'] = livePesticides;
            if (liveMO !== null) {
                const moTotaux = moAnalytique.totaux;
                liveChargeOverrides['M.O Récolte'] = moTotaux.recolte;
                liveChargeOverrides['M.O Hors Récolte'] = moTotaux.horsRecolte;
            }

            // Safety: ensure critical data fields are primitives
            if (!charges || !Array.isArray(charges)) return <div style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}>Chargement des données...</div>;

            return (
                <div className="fade-in">
                    {/* Header band */}
                    <div style={{padding:'20px 24px', background:'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', borderRadius:'12px', marginBottom:'20px', color:'white'}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'12px'}}>
                            <div>
                                <div style={{fontSize:'11px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6, marginBottom:'4px'}}>CPC Campagne</div>
                                <div style={{fontSize:'22px', fontWeight:'700'}}>2025-2026</div>
                                <div style={{fontSize:'12px', opacity:0.7}}>{liveCAExport !== null ? 'Données LIVE' : `À date ${_today.toLocaleDateString('fr-FR')} · ${elapsedMonthsCount.toFixed(1)}/12 mois`} | {data.totalHa} Ha cultivés</div>
                            </div>
                            <div style={{display:'flex', gap:'24px', textAlign:'center'}}>
                                <div>
                                    <div style={{fontSize:'10px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6}}>CA Total</div>
                                    <div style={{fontSize:'20px', fontWeight:'700', color:'#D4A847'}}>{(totalCADisplay/1000000).toFixed(1)}M DH</div>
                                </div>
                                <div>
                                    <div style={{fontSize:'10px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6}}>Charges</div>
                                    <div style={{fontSize:'20px', fontWeight:'700', color:'#E74C3C'}}>{(totalChargesDisplay/1000000).toFixed(1)}M DH</div>
                                </div>
                                <div>
                                    <div style={{fontSize:'10px', textTransform:'uppercase', letterSpacing:'1px', opacity:0.6}}>Résultat</div>
                                    <div style={{fontSize:'20px', fontWeight:'700', color: resultatDisplay >= 0 ? '#2D8B4E' : '#E74C3C'}}>{(resultatDisplay/1000000).toFixed(1)}M DH</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Météo Dashboard (DG) — temporarily disabled for debugging */}
                    {/* <MeteoAlertsDashboard farmFilter={farmFilter || 'F1'} onNavigateMeteo={onNavigateMeteo} /> */}

                    {/* Alerte Équipes Absentes - Finance Dashboard */}
                    {alertesAbsence && alertesAbsence.alertes && alertesAbsence.alertes.length > 0 && (
                        <div style={{marginBottom:16}}>
                            <div onClick={() => setShowAlertes(!showAlertes)} style={{padding:'12px 20px', background:'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)', borderRadius: showAlertes ? '10px 10px 0 0' : '10px', color:'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                <div style={{display:'flex', alignItems:'center', gap:12}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{fontSize:16}}></i>
                                    <span style={{fontWeight:600, fontSize:13}}>
                                        {alertesAbsence.alertes.length} alerte{alertesAbsence.alertes.length > 1 ? 's' : ''} — Équipe{alertesAbsence.alertes.length > 1 ? 's' : ''} absente{alertesAbsence.alertes.length > 1 ? 's' : ''} depuis plus de 5 jours
                                    </span>
                                    <span style={{fontSize:10, opacity:0.7, background:'rgba(255,255,255,0.2)', padding:'2px 8px', borderRadius:8}}>{alertesAbsence.periode}</span>
                                </div>
                                <i className={`fa-solid fa-chevron-${showAlertes ? 'up' : 'down'}`} style={{fontSize:12, opacity:0.8}}></i>
                            </div>
                            {showAlertes && (
                                <div style={{background:'white', border:'1px solid #e74c3c', borderTop:'none', borderRadius:'0 0 10px 10px', padding:16}}>
                                    {alertesAbsence.alertes.map((a, i) => (
                                        <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'rgba(231,76,60,0.06)',borderRadius:8,marginBottom:i < alertesAbsence.alertes.length - 1 ? 6 : 0}}>
                                            <i className="fa-solid fa-users-slash" style={{fontSize:14,color:'#e74c3c'}}></i>
                                            <div>
                                                <strong style={{color:'#e74c3c'}}>{prefixToName[a.equipePrefix] || a.equipePrefix}</strong> — {a.joursAbsents} jours consécutifs d'absence
                                                <div style={{fontSize:10,color:'var(--gray-500)'}}>Du {new Date(a.dateDebut).toLocaleDateString('fr-FR')} au {new Date(a.dateFin).toLocaleDateString('fr-FR')}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Demandes Transport en attente de validation Finance */}
                    {pendingTransportChanges.length > 0 && (
                        <div style={{marginBottom:16}}>
                            <div onClick={() => setShowTransportChanges(!showTransportChanges)} style={{padding:'12px 20px', background:'linear-gradient(135deg, #e67e22 0%, #d35400 100%)', borderRadius: showTransportChanges ? '10px 10px 0 0' : '10px', color:'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                <div style={{display:'flex', alignItems:'center', gap:12}}>
                                    <i className="fa-solid fa-bus" style={{fontSize:16}}></i>
                                    <span style={{fontWeight:600, fontSize:13}}>
                                        {pendingTransportChanges.length} modification{pendingTransportChanges.length > 1 ? 's' : ''} transport en attente de validation
                                    </span>
                                </div>
                                <i className={`fa-solid fa-chevron-${showTransportChanges ? 'up' : 'down'}`} style={{fontSize:12, opacity:0.8}}></i>
                            </div>
                            {showTransportChanges && (
                                <div style={{background:'white', border:'1px solid #e67e22', borderTop:'none', borderRadius:'0 0 10px 10px', padding:16}}>
                                    {pendingTransportChanges.map((ch, ci) => (
                                        <div key={ch.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'rgba(230,126,34,0.06)',borderRadius:8,marginBottom:ci < pendingTransportChanges.length - 1 ? 6 : 0}}>
                                            <div style={{fontSize:12}}>
                                                {ch.changeType === 'modifier_prix' && (
                                                    <span><i className="fa-solid fa-edit" style={{marginRight:6,color:'#e67e22'}}></i><strong>{ch.data.equipe}</strong> — Prix: {ch.data.oldCout} DH → <strong style={{color:'var(--berry)'}}>{ch.data.newCout} DH</strong></span>
                                                )}
                                                {ch.changeType === 'ajouter_equipe' && (
                                                    <span><i className="fa-solid fa-plus-circle" style={{marginRight:6,color:'#e67e22'}}></i>Ajout: <strong>{ch.data.equipe}</strong> ({ch.data.prefix}) — {ch.data.coutParOuvrier} DH/ouv. — Caporal: {ch.data.caporal}</span>
                                                )}
                                                {ch.changeType === 'supprimer_equipe' && (
                                                    <span><i className="fa-solid fa-trash" style={{marginRight:6,color:'#e74c3c'}}></i>Suppression: <strong>{ch.data.equipe}</strong></span>
                                                )}
                                                <div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>Soumis par {ch.submittedBy} le {new Date(ch.createdAt).toLocaleDateString('fr-FR')}</div>
                                            </div>
                                            <div style={{display:'flex',gap:6}}>
                                                <button onClick={() => handleValidateTransportChange(ch.id, 'approuver')} disabled={validatingChange === ch.id}
                                                    style={{padding:'5px 12px',background:'var(--green)',color:'#fff',border:'none',borderRadius:6,fontSize:11,fontWeight:600,cursor: validatingChange === ch.id ? 'wait' : 'pointer'}}>
                                                    <i className={`fa-solid ${validatingChange === ch.id ? 'fa-spinner fa-spin' : 'fa-check'}`} style={{marginRight:4}}></i>Approuver
                                                </button>
                                                <button onClick={() => handleValidateTransportChange(ch.id, 'rejeter')} disabled={validatingChange === ch.id}
                                                    style={{padding:'5px 12px',background:'#e74c3c',color:'#fff',border:'none',borderRadius:6,fontSize:11,fontWeight:600,cursor: validatingChange === ch.id ? 'wait' : 'pointer'}}>
                                                    <i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Rejeter
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Nouveaux Ouvriers Banner */}
                    {nouveauxData && nouveauxData.summary.totalQuinzaine > 0 && (
                        <div style={{marginBottom:16}}>
                            <div onClick={() => setShowNouveaux(!showNouveaux)} style={{padding:'12px 20px', background:'linear-gradient(135deg, #2D8B4E 0%, #1a6b35 100%)', borderRadius: showNouveaux ? '10px 10px 0 0' : '10px', color:'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                <div style={{display:'flex', alignItems:'center', gap:12}}>
                                    <i className="fa-solid fa-user-plus" style={{fontSize:16}}></i>
                                    <span style={{fontWeight:600, fontSize:13}}>
                                        {nouveauxData.summary.totalQuinzaine} nouveaux ouvriers cette quinzaine
                                        {nouveauxData.summary.totalToday > 0 && <span style={{opacity:0.8, fontWeight:400}}> ({nouveauxData.summary.totalToday} aujourd'hui)</span>}
                                    </span>
                                    <span style={{fontSize:10, opacity:0.7, background:'rgba(255,255,255,0.2)', padding:'2px 8px', borderRadius:8}}>{nouveauxData.periode}</span>
                                </div>
                                <i className={`fa-solid fa-chevron-${showNouveaux ? 'up' : 'down'}`} style={{fontSize:12, opacity:0.8}}></i>
                            </div>
                            {showNouveaux && (
                                <div style={{background:'white', border:'1px solid var(--gray-200)', borderTop:'none', borderRadius:'0 0 10px 10px', padding:16}}>
                                    <div style={{display:'flex', gap:12, marginBottom:12, flexWrap:'wrap'}}>
                                        {Object.entries(nouveauxData.summary.byFarm).map(([f, v]) => (
                                            <span key={f} className="status-badge" style={{background: f==='F1' ? 'rgba(139,34,82,0.1)' : f==='F5' ? 'rgba(45,139,78,0.1)' : 'rgba(212,168,71,0.1)', color: f==='F1' ? 'var(--berry)' : f==='F5' ? 'var(--green)' : 'var(--gold)', fontSize:11, padding:'4px 10px'}}>{f}: {typeof v === 'object' ? JSON.stringify(v) : v}</span>
                                        ))}
                                    </div>
                                    <table className="data-table">
                                        <thead>
                                            <tr><th>Matricule</th><th>Nom</th><th>Date Arrivée</th><th>Ferme</th><th>Équipe</th></tr>
                                        </thead>
                                        <tbody>
                                            {nouveauxData.workers.map((w, i) => (
                                                <tr key={i}>
                                                    <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                                                    <td style={{fontWeight:500}}><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                                    <td>{new Date(w.firstDate).toLocaleDateString('fr-FR')}</td>
                                                    <td><span className="status-badge" style={{background: w.ferme==='F1' ? 'rgba(139,34,82,0.1)' : w.ferme==='F5' ? 'rgba(45,139,78,0.1)' : 'rgba(212,168,71,0.1)', color: w.ferme==='F1' ? 'var(--berry)' : w.ferme==='F5' ? 'var(--green)' : 'var(--gold)', fontSize:10}}>{w.ferme}</span></td>
                                                    <td style={{fontSize:11,color:'var(--gray-600)'}}>{w.equipe}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* KPI Row */}
                    <div className="kpi-grid">
                        <KPICard icon="fa-money-bill-wave" iconClass="green" value={`${(totalCAExportDisplay/1000).toFixed(0)}K`} label={liveCAExport !== null ? "CA Liquidé Driscoll's" : "CA Export Driscoll's"} subItems={[{value: liveCAExport !== null ? 'LIVE' : `${data.totalKgExport.toLocaleString('fr-FR')} kg`, label: liveCAExport !== null ? '' : 'Tonnage'}]} />
                        <KPICard icon="fa-store" iconClass="blue" value={`${(totalCALocalDisplay/1000).toFixed(0)}K`} label="CA Local" subItems={liveCALocal !== null ? [{value:'LIVE', label:''}] : []} />
                        <KPICard icon="fa-users" iconClass="red" value={`${(moCharges/1000).toFixed(0)}K`} label="Main d'Oeuvre" subItems={[{value:`${totalChargesDisplay > 0 ? Math.round(moCharges/totalChargesDisplay*100) : 0}%`, label:'du total'}, ...(liveMO !== null ? [{value:'LIVE', label:''}] : [])]} />
                        <KPICard icon="fa-chart-line" iconClass="berry" value={`${(resultatDisplay/1000).toFixed(0)}K`} label="Résultat Net" />
                    </div>

                    {/* Répartition des charges */}
                    <Panel title="Structure des Charges par Poste" icon="fa-layer-group">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:10}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i> Cliquez sur un poste pour voir le détail</div>
                        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'10px'}}>
                            {charges.map((c, i) => {
                                const liveVal = liveChargeOverrides[c.poste];
                                const displayTotal = liveVal !== undefined ? liveVal : chargeElapsed(c);
                                const pct = totalChargesDisplay > 0 ? (displayTotal / totalChargesDisplay * 100).toFixed(1) : '0';
                                const isLive = liveVal !== undefined;
                                return (
                                    <div key={i} onClick={() => setSelectedCharge(c)} style={{padding:'12px', background:'var(--gray-100)', borderRadius:'10px', borderLeft:`4px solid ${c.color}`, cursor:'pointer', transition:'all 0.2s'}}
                                        onMouseOver={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'; }}
                                        onMouseOut={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; }}>
                                        <div style={{display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px'}}>
                                            <i className={`fa-solid ${c.icon}`} style={{fontSize:'11px', color:c.color}}></i>
                                            <span style={{fontSize:'11px', fontWeight:'600', color:'var(--gray-600)'}}>{c.poste}</span>
                                            {isLive && <span style={{fontSize:7,padding:'1px 4px',borderRadius:3,background:'#d4edda',color:'#155724',fontWeight:700}}>LIVE</span>}
                                        </div>
                                        <div style={{fontSize:'16px', fontWeight:'700'}}>{(displayTotal/1000).toFixed(0)}K</div>
                                        <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{pct}% des charges</div>
                                        <div style={{height:'4px', background:'var(--gray-200)', borderRadius:'2px', marginTop:'6px'}}>
                                            <div style={{height:'100%', width:`${Math.min(parseFloat(pct)*2, 100)}%`, background:c.color, borderRadius:'2px'}}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{display:'flex', gap:'16px', marginTop:'16px', padding:'12px', background:'var(--berry-pale)', borderRadius:'8px'}}>
                            <div style={{flex:1, textAlign:'center'}}>
                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase'}}>Intrants & Terrain</div>
                                <div style={{fontSize:'16px', fontWeight:'700', color:'var(--green)'}}>{(intrantsCharges/1000).toFixed(0)}K DH</div>
                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{Math.round(intrantsCharges/totalChargesDisplay*100)}%</div>
                            </div>
                            <div style={{flex:1, textAlign:'center'}}>
                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase'}}>Main d'Oeuvre</div>
                                <div style={{fontSize:'16px', fontWeight:'700', color:'var(--red)'}}>{(moCharges/1000).toFixed(0)}K DH</div>
                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{Math.round(moCharges/totalChargesDisplay*100)}%</div>
                            </div>
                            <div style={{flex:1, textAlign:'center'}}>
                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase'}}>Structure & Frais</div>
                                <div style={{fontSize:'16px', fontWeight:'700', color:'var(--blue)'}}>{(structureCharges/1000).toFixed(0)}K DH</div>
                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>{Math.round(structureCharges/totalChargesDisplay*100)}%</div>
                            </div>
                        </div>
                    </Panel>

                    {/* Comptabilité Analytique M.O par Variété */}
                    <Panel title="Comptabilité Analytique M.O par Variété" icon="fa-users-gear">
                        {!moAnalytique ? (
                            <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}></i>Chargement données M.O...
                            </div>
                        ) : (() => {
                            const rows = (moAnalytique.parVariete || []).filter(v => !farmFilter || v.ferme === farmFilter);
                            const tot = rows.reduce((a, v) => ({ recolte: a.recolte + v.recolte.cout, horsRecolte: a.horsRecolte + v.horsRecolte.cout, postesFixes: a.postesFixes + v.postesFixes.cout, total: a.total + v.total.cout }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0 });
                            const COLORS_MO = ['#8B2252','#2D8B4E','#D4A847','#3498DB','#E67E22','#9B59B6','#E74C3C','#1ABC9C'];
                            return React.createElement('div', null,
                                React.createElement('div', {style:{display:'flex',gap:16,marginBottom:16,flexWrap:'wrap'}},
                                    [{label:'Récolte',val:tot.recolte,color:'#E74C3C'},{label:'Hors Récolte',val:tot.horsRecolte,color:'#3498DB'},{label:'Ouvriers Avocatier',val:tot.postesFixes,color:'#95A5A6'},{label:'Total M.O',val:tot.total,color:'#8B2252'}].map((s,i) =>
                                        React.createElement('div', {key:i, style:{flex:1,minWidth:120,background:'#f8f9fa',borderRadius:10,padding:'12px 16px',textAlign:'center'}},
                                            React.createElement('div', {style:{fontSize:10,textTransform:'uppercase',letterSpacing:'0.5px',color:'#888',marginBottom:4}}, s.label),
                                            React.createElement('div', {style:{fontSize:18,fontWeight:700,color:s.color}}, (s.val/1000).toFixed(0) + 'k')
                                        )
                                    )
                                ),
                                React.createElement('table', {className:'data-table'},
                                    React.createElement('thead', null,
                                        React.createElement('tr', null,
                                            React.createElement('th', null, 'Variété'),
                                            React.createElement('th', null, 'Culture'),
                                            React.createElement('th', null, 'Ferme'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Récolte (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Hors Récolte (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Ouvrier Avocatier (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, 'Total (DH)'),
                                            React.createElement('th', {style:{textAlign:'right'}}, '%')
                                        )
                                    ),
                                    React.createElement('tbody', null,
                                        rows.map((v, i) =>
                                            React.createElement('tr', {key:i},
                                                React.createElement('td', null, React.createElement('strong', null, v.variete)),
                                                React.createElement('td', null, React.createElement('span', {style:{fontSize:11,padding:'2px 8px',borderRadius:12,background: v.culture==='Framboise'?'rgba(139,34,82,0.1)':v.culture==='Myrtille'?'rgba(52,152,219,0.1)':'rgba(45,139,78,0.1)',color: v.culture==='Framboise'?'#8B2252':v.culture==='Myrtille'?'#3498DB':'#2D8B4E',fontWeight:600}}, v.culture)),
                                                React.createElement('td', null, v.ferme),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, v.recolte.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, v.horsRecolte.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, v.postesFixes.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',fontWeight:700,fontFamily:'monospace'}}, v.total.cout.toLocaleString('fr-FR')),
                                                React.createElement('td', {style:{textAlign:'right',color:'#888'}}, tot.total > 0 ? Math.round(v.total.cout / tot.total * 100) + '%' : '-')
                                            )
                                        ),
                                        React.createElement('tr', {style:{background:'var(--berry-pale)',fontWeight:700}},
                                            React.createElement('td', {colSpan:3}, 'TOTAL'),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.recolte.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.horsRecolte.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.postesFixes.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace'}}, tot.total.toLocaleString('fr-FR')),
                                            React.createElement('td', {style:{textAlign:'right'}}, '100%')
                                        )
                                    )
                                ),
                                React.createElement('div', {style:{marginTop:16}},
                                    rows.map((v, i) => {
                                        const pct = tot.total > 0 ? (v.total.cout / tot.total * 100) : 0;
                                        return React.createElement('div', {key:i, style:{display:'flex',alignItems:'center',gap:8,marginBottom:6}},
                                            React.createElement('div', {style:{width:90,fontSize:11,fontWeight:600,textAlign:'right',color:'#555'}}, v.variete),
                                            React.createElement('div', {style:{flex:1,height:18,background:'#f0f0f0',borderRadius:4,overflow:'hidden'}},
                                                React.createElement('div', {style:{width:pct+'%',height:'100%',background:COLORS_MO[i % COLORS_MO.length],borderRadius:4,transition:'width 0.5s',minWidth: pct > 0 ? 2 : 0}})
                                            ),
                                            React.createElement('div', {style:{width:45,fontSize:11,color:'#888',textAlign:'right'}}, Math.round(pct)+'%')
                                        );
                                    })
                                )
                            );
                        })()}
                    </Panel>

                    {/* CPC par Variété */}
                    <Panel title="CPC par Variété — Total & par Ha" icon="fa-table-columns">
                        {!moAnalytique ? (
                            <div style={{textAlign:'center',padding:30,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}></i>Chargement...
                            </div>
                        ) : (() => {
                            // Aggregate cpcVarietes by variete+ferme — Maravilla séparée en Green Cane / Long Cane
                            const vaMap = {};
                            (data.cpcVarietes || []).forEach(v => {
                                const vn = v.code === 'AVOCAT' ? 'Avocat' : v.code === 'S1S4_MAR_MD' ? 'Maravilla GC' : v.code === 'S3S7_MAR_MT' ? 'Maravilla LC' : v.label.includes('Yazmin') ? 'Yazmin' : v.label.includes('Reyna') ? 'Reyna' : v.label.includes('Corina') ? 'Corina' : v.label.includes('Cascade') ? 'Cascade' : v.label.includes('Breeze') ? 'Breeze' : 'Autre';
                                const ferme = v.code === 'AVOCAT' ? 'Avocatier' : v.code.includes('S10') || v.code.includes('S13') || v.code.includes('S9') || v.code === 'CORINA' ? 'F5' : v.code === 'CASCADE' || v.code === 'BREEZE' ? 'F5' : v.ferme;
                                const key = vn + '|' + ferme;
                                if (!vaMap[key]) vaMap[key] = { variete: vn, ferme, ha: 0, caExport: 0, caLocal: 0, culture: v.code === 'AVOCAT' ? 'Avocat' : ['Corina','Cascade','Breeze'].includes(vn) ? 'Myrtille' : 'Framboise' };
                                vaMap[key].ha += v.ha;
                                vaMap[key].caExport += v.caExport;
                                vaMap[key].caLocal += v.caLocal;
                            });

                            // Build CPC rows per variety
                            const moRows = moAnalytique.parVariete || [];
                            const varieties = Object.values(vaMap).filter(v => !farmFilter || v.ferme === farmFilter).sort((a, b) => (b.caExport + b.caLocal) - (a.caExport + a.caLocal));
                            const totalHaFiltered = varieties.reduce((s, v) => s + v.ha, 0);

                            // Get MO data for each variety (Maravilla GC/LC both map to "Maravilla" in BEE ONE — split by Ha ratio)
                            const getMo = (variete, ferme) => {
                                const isMarGC = variete === 'Maravilla GC';
                                const isMarLC = variete === 'Maravilla LC';
                                const moVariete = (isMarGC || isMarLC) ? 'Maravilla' : variete;
                                const raw = moRows.find(m => m.variete === moVariete && m.ferme === ferme) || { recolte: {cout:0}, horsRecolte: {cout:0}, horsRecolteDetail: {}, postesFixes: {cout:0}, total: {cout:0} };
                                if (!isMarGC && !isMarLC) return raw;
                                // Split Maravilla MO by Ha ratio: GC=4.2Ha, LC=5.2Ha
                                const haGC = 4.2, haLC = 5.2, haTotal = haGC + haLC;
                                const ratio = isMarGC ? haGC / haTotal : haLC / haTotal;
                                const scale = (obj) => ({ jh: Math.round((obj.jh || 0) * ratio * 100) / 100, cout: Math.round((obj.cout || 0) * ratio) });
                                const hrDetail = {};
                                for (const [op, val] of Object.entries(raw.horsRecolteDetail || {})) { hrDetail[op] = scale(val); }
                                return { recolte: scale(raw.recolte), horsRecolte: scale(raw.horsRecolte), horsRecolteDetail: hrDetail, postesFixes: scale(raw.postesFixes), total: scale(raw.total) };
                            };

                            // === Modes d'affectation selon SOURCE CPC BGF.xlsx ===
                            const charges = data.cpcCharges || [];
                            const haByFerme = {};
                            varieties.forEach(v => { haByFerme[v.ferme] = (haByFerme[v.ferme] || 0) + v.ha; });
                            const totalHaAll = Object.values(haByFerme).reduce((s, h) => s + h, 0);

                            // S.C/S.C.F — surface cultivée / surface cultivée par ferme
                            const allocateSCSCF = (total, fermeCharge, v) => {
                                if (fermeCharge && fermeCharge !== 'Toutes' && !fermeCharge.includes('+')) {
                                    if (v.ferme !== fermeCharge) return 0;
                                    return haByFerme[v.ferme] > 0 ? total * (v.ha / haByFerme[v.ferme]) : 0;
                                }
                                return totalHaAll > 0 ? total * (v.ha / totalHaAll) : 0;
                            };
                            // S.C/S.C.T — surface cultivée / surface cultivée totale
                            const allocateSCSCT = (total, v) => totalHaAll > 0 ? total * (v.ha / totalHaAll) : 0;
                            // C.R.M.O — clé de répartition M.O (proportionnel au coût M.O réel)
                            const totalMO = varieties.reduce((s, v) => s + getMo(v.variete, v.ferme).total.cout, 0);
                            const allocateCRMO = (total, v) => {
                                const moVar = getMo(v.variete, v.ferme).total.cout;
                                return totalMO > 0 ? total * (moVar / totalMO) : 0;
                            };

                            // Consumption costs by variety (Engrais / Pesticides)
                            const VARIETY_CPC_CODES = {
                                'Maravilla GC|F1': ['S1S4_MAR_MD'],
                                'Maravilla LC|F1': ['S3S7_MAR_MT'],
                                'Yazmin|F1': ['S2S5_YAZ_MD'],
                                'Yazmin|F5': ['S10_YAZ_MT', 'S13_YAZ_MD'],
                                'Reyna|F5': ['S9_REYNA'],
                                'Corina|F5': ['CORINA'],
                                'Avocat|Avocatier': ['AVOCAT'],
                                'Cascade|F5': ['CASCADE'],
                                'Breeze|F5': ['BREEZE'],
                            };
                            const getConsumptionCost = (variete, ferme, bucket) => {
                                if (!consumptionCosts) return null;
                                const codes = VARIETY_CPC_CODES[variete + '|' + ferme];
                                if (!codes) return null;
                                let total = 0;
                                for (const code of codes) {
                                    const cc = consumptionCosts[code];
                                    if (cc) total += (bucket === 'engrais' ? cc.engrais_ttc : cc.pesticides_ttc) || 0;
                                }
                                return total;
                            };
                            const hasLiveCosts = !!consumptionCosts;

                            // Helper: get charge total by poste name
                            const chargeTotal = (poste) => (charges.find(c => c.poste === poste) || {}).total || 0;
                            const chargeOf = (poste) => charges.find(c => c.poste === poste) || {};

                            // --- CA Live from liquidations ---
                            const liqCAByVariety = {};
                            if (liqData) {
                                const expByReceipt = {};
                                (liqData.expeditions || []).forEach(exp => {
                                    const rid = (exp.receiptId || '').trim();
                                    if (rid) expByReceipt[rid] = exp;
                                });
                                const addLiqCA = (variete, ferme, kg, montant) => {
                                    const key = variete + '|' + ferme;
                                    if (!liqCAByVariety[key]) liqCAByVariety[key] = { kg: 0, montant: 0 };
                                    liqCAByVariety[key].kg += kg;
                                    liqCAByVariety[key].montant += montant;
                                };
                                (liqData.liquidations || []).forEach(liq => {
                                    (liq.rows || []).forEach(row => {
                                        const kg = row.receiptQtyKg || 0;
                                        const gs = row.gsNet || 0;
                                        if (kg <= 0 && gs <= 0) return;
                                        const vName = row.variety || row.varietyCode || '';
                                        const norm = normalizeParcelle(vName);
                                        let variete = norm ? norm.variete : vName;
                                        let ferme = norm ? norm.ferme : null;

                                        // Try to resolve ferme/sous-variete from expedition match
                                        const rid = (row.receiptId || '').trim();
                                        const matchedExp = rid ? expByReceipt[rid] : null;
                                        if (matchedExp) {
                                            if (!ferme) ferme = matchedExp.ferme;
                                            // Try to get GC/LC from expedition variety
                                            if (variete === 'Maravilla' && (!norm || !norm.sousVariete)) {
                                                const expNorm = normalizeParcelle(matchedExp.variety);
                                                if (expNorm && expNorm.sousVariete === 'Green Cane') variete = 'Maravilla GC';
                                                else if (expNorm && expNorm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                                else if (expNorm && expNorm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                            }
                                        }

                                        // Separate Maravilla GC / LC from normalization
                                        if (variete === 'Maravilla' && norm && norm.sousVariete) {
                                            if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                            else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                        }

                                        // Maravilla without GC/LC distinction → split by Ha ratio
                                        if (variete === 'Maravilla') {
                                            const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                                            addLiqCA('Maravilla GC', 'F1', kg * haGC / haT, gs * haGC / haT);
                                            addLiqCA('Maravilla LC', 'F1', kg * haLC / haT, gs * haLC / haT);
                                            return;
                                        }
                                        // Yazmin without ferme → split by Ha ratio F1(2Ha) / F5(4.7Ha)
                                        if (variete === 'Yazmin' && !matchedExp) {
                                            const haF1 = 2.0, haF5 = 4.7, haT = haF1 + haF5;
                                            addLiqCA('Yazmin', 'F1', kg * haF1 / haT, gs * haF1 / haT);
                                            addLiqCA('Yazmin', 'F5', kg * haF5 / haT, gs * haF5 / haT);
                                            return;
                                        }
                                        if (!ferme) ferme = 'F1';
                                        addLiqCA(variete, ferme, kg, gs);
                                    });
                                });
                            }
                            const hasLiqData = Object.keys(liqCAByVariety).length > 0;

                            // --- CA Prévisionnel: expeditions de semaines non liquidées × prix moyen ---
                            const prevCAByVariety = {};
                            if (liqData && hasLiqData) {
                                // Build set of liquidated WEEKS (same logic as Liquidations Qualité tab)
                                const liquidatedWeeks = new Set();
                                (liqData.liquidations || []).forEach(liq => {
                                    if (!liq.week) return;
                                    const m = (liq.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                                    const y = m ? parseInt(m[1]) : (liq.date ? new Date(liq.date).getFullYear() : 2025);
                                    liquidatedWeeks.add(`${y}-W${liq.week}`);
                                });
                                // ISO week helpers
                                const getExpWeek = (dateStr) => {
                                    if (!dateStr) return null;
                                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                                    if (!m) { const m2 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m2) return null; const d = new Date(parseInt(m2[1]), parseInt(m2[2])-1, parseInt(m2[3])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); const w1 = new Date(d.getFullYear(),0,4); return 1+Math.round(((d.getTime()-w1.getTime())/86400000-3+(w1.getDay()+6)%7)/7); }
                                    const d = new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); const w1 = new Date(d.getFullYear(),0,4); return 1+Math.round(((d.getTime()-w1.getTime())/86400000-3+(w1.getDay()+6)%7)/7);
                                };
                                const getExpYear = (dateStr) => {
                                    if (!dateStr) return null;
                                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                                    if (!m) { const m2 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m2) return null; const d = new Date(parseInt(m2[1]), parseInt(m2[2])-1, parseInt(m2[3])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); return d.getFullYear(); }
                                    const d = new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2])); d.setDate(d.getDate()+3-(d.getDay()+6)%7); return d.getFullYear();
                                };
                                // Average price per variety from liquidations
                                const avgPriceByVar = {};
                                Object.entries(liqCAByVariety).forEach(([key, val]) => {
                                    if (val.kg > 0) avgPriceByVar[key] = val.montant / val.kg;
                                });
                                const globalAvgPrice = Object.values(liqCAByVariety).reduce((s, v) => s + v.montant, 0) / Math.max(Object.values(liqCAByVariety).reduce((s, v) => s + v.kg, 0), 1);
                                // Non-liquidated expeditions (by WEEK, not receiptId)
                                const addPrevCA = (variete, ferme, amount) => {
                                    const key = variete + '|' + ferme;
                                    if (!prevCAByVariety[key]) prevCAByVariety[key] = 0;
                                    prevCAByVariety[key] += amount;
                                };
                                (liqData.expeditions || []).filter(e => e.overallResult !== 'REJECT').forEach(exp => {
                                    const w = getExpWeek(exp.date || '');
                                    const y = getExpYear(exp.date || '');
                                    if (!w || !y) return;
                                    if (liquidatedWeeks.has(`${y}-W${w}`)) return; // week already liquidated
                                    const kg = exp.batchWeight || 0;
                                    if (kg <= 0) return;
                                    const norm = normalizeParcelle(exp.variety);
                                    let variete = norm ? norm.variete : (exp.variety || '');
                                    let ferme = exp.ferme || (norm ? norm.ferme : 'F1');
                                    if (variete === 'Maravilla' && norm && norm.sousVariete) {
                                        if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                        else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                    }
                                    // Maravilla without GC/LC → split by Ha
                                    if (variete === 'Maravilla') {
                                        const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                                        const priceGC = avgPriceByVar['Maravilla GC|F1'] || globalAvgPrice;
                                        const priceLC = avgPriceByVar['Maravilla LC|F1'] || globalAvgPrice;
                                        addPrevCA('Maravilla GC', 'F1', kg * haGC / haT * priceGC);
                                        addPrevCA('Maravilla LC', 'F1', kg * haLC / haT * priceLC);
                                        return;
                                    }
                                    // Yazmin without expedition ferme → split F1/F5
                                    if (variete === 'Yazmin' && !exp.ferme) {
                                        const haF1 = 2.0, haF5 = 4.7, haT = haF1 + haF5;
                                        const priceF1 = avgPriceByVar['Yazmin|F1'] || globalAvgPrice;
                                        const priceF5 = avgPriceByVar['Yazmin|F5'] || globalAvgPrice;
                                        addPrevCA('Yazmin', 'F1', kg * haF1 / haT * priceF1);
                                        addPrevCA('Yazmin', 'F5', kg * haF5 / haT * priceF5);
                                        return;
                                    }
                                    const key = variete + '|' + ferme;
                                    const price = avgPriceByVar[key] || globalAvgPrice;
                                    if (!prevCAByVariety[key]) prevCAByVariety[key] = 0;
                                    prevCAByVariety[key] += kg * price;
                                });
                            }
                            const hasPrevCA = Object.keys(prevCAByVariety).length > 0;

                            // --- CA Marché Local par variété (pfq_interne + bons_marche_local) ---
                            const localCAByVariety = {};
                            if (marcheLocalBons && marcheLocalBons.length > 0) {
                                marcheLocalBons.forEach(bon => {
                                    const rawVariete = bon.variete || bon.blocVariete || bon.designation || '';
                                    const norm = normalizeParcelle(rawVariete);
                                    let variete = norm ? norm.variete : (rawVariete || 'Autre');
                                    let ferme = bon.ferme || bon.blocFerme || (norm ? norm.ferme : 'F1');
                                    if (variete === 'Maravilla' && norm && norm.sousVariete) {
                                        if (norm.sousVariete === 'Green Cane' || norm.sousVariete === 'Mow Down') variete = 'Maravilla GC';
                                        else if (norm.sousVariete === 'Long Cane') variete = 'Maravilla LC';
                                    }
                                    // Maravilla sans GC/LC → split par Ha
                                    if (variete === 'Maravilla') {
                                        const montant = parseFloat(bon.totalDH) || 0;
                                        const haGC = 4.2, haLC = 5.2, haT = haGC + haLC;
                                        const kGC = 'Maravilla GC|F1', kLC = 'Maravilla LC|F1';
                                        if (!localCAByVariety[kGC]) localCAByVariety[kGC] = 0;
                                        if (!localCAByVariety[kLC]) localCAByVariety[kLC] = 0;
                                        localCAByVariety[kGC] += montant * haGC / haT;
                                        localCAByVariety[kLC] += montant * haLC / haT;
                                        return;
                                    }
                                    const key = variete + '|' + ferme;
                                    if (!localCAByVariety[key]) localCAByVariety[key] = 0;
                                    const montant = parseFloat(bon.totalDH) || ((parseFloat(bon.poidsLot) || 0) * (parseFloat(bon.prixDH) || 0));
                                    localCAByVariety[key] += montant;
                                });
                            }
                            const hasLocalCA = Object.keys(localCAByVariety).length > 0;

                            const getCA = (v) => {
                                if (hasLiqData) {
                                    const lv = liqCAByVariety[v.variete + '|' + v.ferme];
                                    return lv ? lv.montant : 0;
                                }
                                return v.caExport + v.caLocal;
                            };
                            const getPrevCA = (v) => prevCAByVariety[v.variete + '|' + v.ferme] || 0;
                            const getLocalCA = (v) => {
                                if (hasLocalCA) return localCAByVariety[v.variete + '|' + v.ferme] || 0;
                                return v.caLocal || 0;
                            };
                            const getTotalCA = (v) => getCA(v) + getPrevCA(v) + getLocalCA(v);

                            // --- HR sub-lines: collect top 6 operation families ---
                            const hrOpTotals = {};
                            moRows.forEach(m => {
                                Object.entries(m.horsRecolteDetail || {}).forEach(([op, val]) => {
                                    if (!hrOpTotals[op]) hrOpTotals[op] = 0;
                                    hrOpTotals[op] += val.cout || 0;
                                });
                            });
                            const sortedHrOps = Object.entries(hrOpTotals).sort((a, b) => b[1] - a[1]);
                            const topHrOps = sortedHrOps.slice(0, 6).map(([op]) => op);
                            const otherHrOps = sortedHrOps.slice(6).map(([op]) => op);
                            const HR_ICONS = { '1. Taille': 'fa-scissors', '2. Entretien': 'fa-broom', '3. Paillage': 'fa-layer-group', '4. Palissage': 'fa-grip-lines-vertical', '5. Traitement': 'fa-spray-can', '6. Fertigation': 'fa-droplet', '7. Plantation': 'fa-seedling', '9. Irrigation': 'fa-faucet-drip', '10. Tuteurage': 'fa-arrows-up-down' };

                            // CPC lines — modes d'affectation selon SOURCE CPC BGF.xlsx
                            const cpcLines = [
                                // --- PRODUITS ---
                                { label: hasLiqData ? 'CA Liquidé' : 'CA Export', icon: 'fa-plane-departure', color: '#2D8B4E', getValue: (v) => getCA(v), source: hasLiqData ? 'live' : 'hardcode' },
                                ...(hasPrevCA ? [{ label: 'CA Prévisionnel', icon: 'fa-clock', color: '#F39C12', getValue: (v) => getPrevCA(v), source: 'live' }] : []),
                                { label: 'CA Marché Local', icon: 'fa-store', color: '#8B6914', getValue: (v) => getLocalCA(v), source: hasLocalCA ? 'live' : 'hardcode' },
                                { label: 'CA Total', icon: 'fa-coins', color: '#D4A847', getValue: (v) => getTotalCA(v), bold: true, source: hasLiqData ? 'live' : 'hardcode' },
                                { label: '─', separator: true },
                                // --- M.O (REEL — LIVE BEE ONE) ---
                                { label: 'M.O Récolte', icon: 'fa-people-carry-box', color: '#E74C3C', getValue: (v) => getMo(v.variete, v.ferme).recolte.cout, isCharge: true, source: 'live' },
                                { label: 'M.O Hors Récolte', icon: 'fa-users', color: '#C0392B', getValue: (v) => getMo(v.variete, v.ferme).horsRecolte.cout, isCharge: true, source: 'live', bold: true },
                                // HR sub-lines (top 6 + autres)
                                ...topHrOps.map(op => ({
                                    label: op.replace(/^\d+\.\s*/, ''), icon: HR_ICONS[op] || 'fa-circle', color: '#C0392B', isCharge: true, subLine: true, source: 'live', indent: true,
                                    getValue: (v) => (getMo(v.variete, v.ferme).horsRecolteDetail || {})[op]?.cout || 0,
                                })),
                                ...(otherHrOps.length > 0 ? [{
                                    label: 'Autres HR', icon: 'fa-ellipsis', color: '#C0392B', isCharge: true, subLine: true, source: 'live', indent: true,
                                    getValue: (v) => { const d = getMo(v.variete, v.ferme).horsRecolteDetail || {}; return otherHrOps.reduce((s, op) => s + (d[op]?.cout || 0), 0); },
                                }] : []),
                                { label: 'M.O Ouvrier Avocatier', icon: 'fa-user-clock', color: '#95A5A6', getValue: (v) => getMo(v.variete, v.ferme).postesFixes.cout, isCharge: true, source: 'live' },
                                { label: 'Total M.O', icon: 'fa-users-gear', color: '#8B2252', getValue: (v) => getMo(v.variete, v.ferme).total.cout, isCharge: true, bold: true, source: 'live' },
                                { label: '─', separator: true },
                                // --- REEL (hardcodé, à connecter) ---
                                { label: 'Plants', icon: 'fa-seedling', color: 'var(--green)', getValue: (v) => allocateSCSCF(chargeTotal('Plants'), chargeOf('Plants').ferme, v), isCharge: true, source: 'hardcode' },
                                // --- REEL (Engrais/Pesticides — LIVE si consumptionCosts) ---
                                { label: 'Engrais', icon: 'fa-flask', color: '#27AE60', isCharge: true, source: hasLiveCosts ? 'live' : 'hardcode',
                                  getValue: (v) => { const lv = getConsumptionCost(v.variete, v.ferme, 'engrais'); return lv !== null ? lv : allocateSCSCF(chargeTotal('Engrais'), chargeOf('Engrais').ferme, v); } },
                                { label: 'Pesticides', icon: 'fa-spray-can-sparkles', color: '#E67E22', isCharge: true, source: hasLiveCosts ? 'live' : 'hardcode',
                                  getValue: (v) => { const lv = getConsumptionCost(v.variete, v.ferme, 'pesticides'); return lv !== null ? lv : allocateSCSCF(chargeTotal('Pesticides'), chargeOf('Pesticides').ferme, v); } },
                                { label: '─', separator: true },
                                // --- S.C/S.C.F (surface cultivée / surface par ferme) ---
                                { label: 'Loyer Terrains', icon: 'fa-land-mine-on', color: '#8B6914', getValue: (v) => allocateSCSCF(chargeTotal('Loyer Terrains'), chargeOf('Loyer Terrains').ferme, v), isCharge: true, source: 'S.C/S.C.F' },
                                { label: 'Électricité', icon: 'fa-bolt', color: '#F1C40F', getValue: (v) => allocateSCSCF(chargeTotal('Électricité'), chargeOf('Électricité').ferme, v), isCharge: true, source: 'S.C/S.C.F' },
                                { label: 'Autres Intrants', icon: 'fa-box', color: '#9B59B6', getValue: (v) => allocateSCSCF(chargeTotal('Autres Intrants'), chargeOf('Autres Intrants').ferme, v), isCharge: true, source: 'S.C/S.C.F' },
                                // --- S.C/S.C.T (surface cultivée / surface totale) ---
                                { label: 'Eau ORMVAL', icon: 'fa-droplet', color: '#3498DB', getValue: (v) => allocateSCSCT(chargeTotal('Eau ORMVAL'), v), isCharge: true, source: 'S.C/S.C.T' },
                                { label: '─', separator: true },
                                // --- C.R.M.O (clé de répartition M.O) ---
                                { label: 'Gasoil & Gaz', icon: 'fa-gas-pump', color: '#95A5A6', getValue: (v) => allocateCRMO(fuelData ? (fuelData.totalCampagne || 0) + (fuelData.totalPeages || 0) : chargeTotal('Gasoil & Gaz'), v), isCharge: true, source: fuelData ? 'live' : 'C.R.M.O' },
                                { label: 'Transport & Divers', icon: 'fa-truck', color: '#7F8C8D', getValue: (v) => allocateCRMO(chargeTotal('Transport & Divers'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'STC Ouvriers', icon: 'fa-money-check', color: '#2C3E50', getValue: (v) => allocateCRMO(chargeTotal('STC Ouvriers'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'Encadrement', icon: 'fa-user-tie', color: '#8E44AD', getValue: (v) => allocateCRMO(chargeTotal('Encadrement'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'CNSS', icon: 'fa-shield-halved', color: '#16A085', getValue: (v) => allocateCRMO(chargeTotal('CNSS'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'IR', icon: 'fa-receipt', color: '#D35400', getValue: (v) => allocateCRMO(chargeTotal('IR'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: 'Frais Généraux', icon: 'fa-building', color: '#34495E', getValue: (v) => allocateCRMO(chargeTotal('Frais Généraux'), v), isCharge: true, source: 'C.R.M.O' },
                                { label: '─', separator: true },
                            ];

                            // Compute totals
                            const getTotalCharges = (v) => {
                                return cpcLines.filter(l => l.isCharge && !l.bold && !l.subLine).reduce((s, l) => s + l.getValue(v), 0);
                            };
                            const getResultat = (v) => getTotalCA(v) - getTotalCharges(v);

                            const fmt = (val, ha) => {
                                const v = cpcMode === 'ha' && ha > 0 ? val / ha : val;
                                if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + 'M';
                                if (Math.abs(v) >= 1000) return Math.round(v / 1000) + 'k';
                                return Math.round(v).toLocaleString('fr-FR');
                            };

                            return React.createElement('div', null,
                                // Toggle
                                React.createElement('div', {style:{display:'flex',gap:8,marginBottom:16,justifyContent:'flex-end'}},
                                    ['total','ha'].map(m => React.createElement('button', {key:m, onClick:()=>setCpcMode(m), style:{padding:'6px 16px',borderRadius:8,border: cpcMode===m?'2px solid var(--berry)':'1px solid #ddd',background: cpcMode===m?'var(--berry-pale)':'#fff',color: cpcMode===m?'var(--berry)':'#666',fontWeight:cpcMode===m?700:500,fontSize:12,cursor:'pointer'}}, m === 'total' ? 'Total (DH)' : 'Par Hectare (DH/Ha)'))
                                ),
                                // Table
                                React.createElement('div', {style:{overflowX:'auto'}},
                                    React.createElement('table', {className:'data-table', style:{fontSize:11,whiteSpace:'nowrap'}},
                                        React.createElement('thead', null,
                                            React.createElement('tr', null,
                                                React.createElement('th', {style:{position:'sticky',left:0,background:'#fff',zIndex:2,minWidth:140}}, 'Poste'),
                                                ...varieties.map(v => React.createElement('th', {key:v.variete+v.ferme, style:{textAlign:'right',minWidth:90}},
                                                    React.createElement('div', null, v.variete),
                                                    React.createElement('div', {style:{fontSize:9,color:'#888',fontWeight:400}}, v.ferme + ' · ' + v.ha + ' Ha')
                                                )),
                                                React.createElement('th', {style:{textAlign:'right',minWidth:100,background:'var(--gray-100)'}}, 'TOTAL')
                                            )
                                        ),
                                        React.createElement('tbody', null,
                                            // CPC lines
                                            ...cpcLines.map((line, i) => {
                                                if (line.separator) return React.createElement('tr', {key:'sep'+i}, React.createElement('td', {colSpan:varieties.length+2, style:{padding:2,background:'var(--gray-100)'}}));
                                                const lineTotal = varieties.reduce((s, v) => s + line.getValue(v), 0);
                                                return React.createElement('tr', {key:i, style: line.bold ? {background:'var(--gray-50)',fontWeight:700} : line.indent ? {opacity:0.85} : {}},
                                                    React.createElement('td', {style:{position:'sticky',left:0,background: line.bold?'var(--gray-50)':'#fff',zIndex:1}},
                                                        React.createElement('div', {style:{display:'flex',alignItems:'center',gap:6, ...(line.indent ? {paddingLeft:22,fontSize:11} : {})}},
                                                            line.icon && React.createElement('i', {className:'fa-solid '+line.icon, style:{color:line.color,fontSize: line.indent ? 9 : 10,width:14,textAlign:'center', opacity: line.indent ? 0.6 : 1}}),
                                                            React.createElement('span', null, line.label),
                                                            line.source === 'live' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d4edda',color:'#155724',fontWeight:700,letterSpacing:'0.5px'}}, 'LIVE'),
                                                            line.source === 'hardcode' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#fff3cd',color:'#856404',fontWeight:700,letterSpacing:'0.5px'}}, 'HARDCODÉ'),
                                                            line.source === 'S.C/S.C.F' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d1ecf1',color:'#0c5460',fontWeight:700,letterSpacing:'0.5px'}}, 'S.C/S.C.F'),
                                                            line.source === 'S.C/S.C.T' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#cce5ff',color:'#004085',fontWeight:700,letterSpacing:'0.5px'}}, 'S.C/S.C.T'),
                                                            line.source === 'C.R.M.O' && React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#e8daef',color:'#6c3483',fontWeight:700,letterSpacing:'0.5px'}}, 'C.R.M.O')
                                                        )
                                                    ),
                                                    ...varieties.map(v => {
                                                        const val = line.getValue(v);
                                                        const displayVal = cpcMode === 'ha' && v.ha > 0 ? val / v.ha : val;
                                                        return React.createElement('td', {key:v.variete+v.ferme, style:{textAlign:'right',fontFamily:'monospace',color: line.isCharge ? '#c0392b' : val > 0 ? '#2D8B4E' : '#888'}}, fmt(val, v.ha));
                                                    }),
                                                    React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace',fontWeight:700,background:'var(--gray-100)',color: line.isCharge ? '#c0392b' : lineTotal > 0 ? '#2D8B4E' : '#888'}}, fmt(lineTotal, totalHaFiltered))
                                                );
                                            }),
                                            // Total Charges
                                            React.createElement('tr', {style:{background:'#fef0f0',fontWeight:700}},
                                                React.createElement('td', {style:{position:'sticky',left:0,background:'#fef0f0',zIndex:1}}, React.createElement('span', null, React.createElement('i', {className:'fa-solid fa-minus-circle', style:{marginRight:6,color:'#c0392b',fontSize:10}}), 'Total Charges')),
                                                ...varieties.map(v => {
                                                    const val = getTotalCharges(v);
                                                    return React.createElement('td', {key:v.variete+v.ferme, style:{textAlign:'right',fontFamily:'monospace',color:'#c0392b'}}, fmt(val, v.ha));
                                                }),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace',fontWeight:700,background:'var(--gray-100)',color:'#c0392b'}}, fmt(varieties.reduce((s,v) => s+getTotalCharges(v),0), totalHaFiltered))
                                            ),
                                            // Résultat
                                            React.createElement('tr', {style:{fontWeight:700,fontSize:12}},
                                                React.createElement('td', {style:{position:'sticky',left:0,background:'#fff',zIndex:1}}, React.createElement('span', null, React.createElement('i', {className:'fa-solid fa-equals', style:{marginRight:6,color:'#8B2252',fontSize:10}}), 'Résultat')),
                                                ...varieties.map(v => {
                                                    const val = getResultat(v);
                                                    return React.createElement('td', {key:v.variete+v.ferme, style:{textAlign:'right',fontFamily:'monospace',color: val >= 0 ? '#2D8B4E' : '#c0392b'}}, fmt(val, v.ha));
                                                }),
                                                React.createElement('td', {style:{textAlign:'right',fontFamily:'monospace',fontWeight:700,background:'var(--gray-100)',color: varieties.reduce((s,v) => s+getResultat(v),0) >= 0 ? '#2D8B4E' : '#c0392b'}}, fmt(varieties.reduce((s,v) => s+getResultat(v),0), totalHaFiltered))
                                            )
                                        )
                                    )
                                ),
                                React.createElement('div', {style:{marginTop:12,display:'flex',gap:12,fontSize:10,color:'#666',flexWrap:'wrap',alignItems:'center'}},
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d4edda',color:'#155724',fontWeight:700}}, 'LIVE'), 'Réel BEE ONE'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#fff3cd',color:'#856404',fontWeight:700}}, 'HARDCODÉ'), 'À vérifier'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#d1ecf1',color:'#0c5460',fontWeight:700}}, 'S.C/S.C.F'), 'Surface/Ferme'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#cce5ff',color:'#004085',fontWeight:700}}, 'S.C/S.C.T'), 'Surface/Total'),
                                    React.createElement('span', {style:{display:'flex',alignItems:'center',gap:4}}, React.createElement('span', {style:{fontSize:8,padding:'1px 5px',borderRadius:4,background:'#e8daef',color:'#6c3483',fontWeight:700}}, 'C.R.M.O'), 'Clé M.O'),
                                    fuelData && fuelData.updatedAt && React.createElement('span', {style:{marginLeft:'auto',color:'#999',fontStyle:'italic'}},
                                        React.createElement('i', {className:'fa-solid fa-gas-pump', style:{marginRight:4}}),
                                        'Fuel MAJ: ', fuelData.updatedAt.toDate ? fuelData.updatedAt.toDate().toLocaleDateString('fr-FR') : new Date(fuelData.updatedAt).toLocaleDateString('fr-FR')
                                    )
                                )
                            );
                        })()}
                    </Panel>

                    {/* EBE par variété */}
                    <Panel title="EBE par Variété Framboise" icon="fa-chart-bar">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Variété</th>
                                    <th style={{textAlign:'right'}}>EBE Total (DH)</th>
                                    <th style={{textAlign:'right'}}>EBE / Ha (DH)</th>
                                    <th style={{textAlign:'right'}}>% Prix Vente</th>
                                    <th>Rentabilité</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.ebeParVariete.map((v, i) => (
                                    <tr key={i}>
                                        <td><strong>{v.variete}</strong></td>
                                        <td style={{textAlign:'right', fontWeight:'600', color: v.ebe >= 0 ? 'var(--green)' : 'var(--red)'}}>{Math.round(v.ebe).toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', color: v.ebeHa >= 0 ? 'var(--green)' : 'var(--red)'}}>{Math.round(v.ebeHa).toLocaleString('fr-FR')}</td>
                                        <td style={{textAlign:'right', color: v.pctCA >= 0 ? 'var(--green)' : 'var(--red)'}}>{v.pctCA}%</td>
                                        <td>
                                            <span className={`status-badge ${v.ebe >= 0 ? 'green' : 'red'}`}>
                                                {v.ebe >= 0 ? '✓ Rentable' : '✗ Déficitaire'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{background:'var(--red-pale)', fontWeight:'700'}}>
                                    <td>TOTAL EBE FRAMBOISE</td>
                                    <td style={{textAlign:'right', color:'var(--red)'}}>{Math.round(data.ebeFramboise).toLocaleString('fr-FR')}</td>
                                    <td></td>
                                    <td></td>
                                    <td><span className="status-badge red">Déficitaire</span></td>
                                </tr>
                            </tbody>
                        </table>
                        <SimpleBarChart
                            data={data.ebeParVariete.map(v => ({variete: v.variete.replace('S','').substring(0, 12), ebe: Math.round(v.ebe/1000)}))}
                            dataKeys={['ebe']}
                            colors={['#8B2252']}
                            xKey="variete"
                            height={200}
                        />
                    </Panel>

                    {/* Résultat par mois */}
                    <Panel title="Évolution Résultat Cumulé" icon="fa-chart-line">
                        <SimpleAreaChart
                            data={data.resultatParMois}
                            dataKeys={['resultat']}
                            colors={['#E74C3C']}
                            xKey="mois"
                            height={200}
                        />
                        <div style={{marginTop:'12px', padding:'12px', background:'var(--red-pale)', borderRadius:'8px', textAlign:'center'}}>
                            <div style={{fontSize:'11px', fontWeight:'600', color:'var(--gray-600)'}}>Résultat Avant Impôt (C.F & DEA inclus: {(data.cfDea/1000).toFixed(0)}K DH)</div>
                            <div style={{fontSize:'24px', fontWeight:'700', color:'var(--red)'}}>{(data.resultatAvantImpot/1000).toFixed(0)}K DH</div>
                            <div style={{fontSize:'11px', color:'var(--gray-400)'}}>Tonnage d'équilibre: 4 604 kg</div>
                        </div>
                    </Panel>

                    {/* ===== CHARGE DETAIL POPUP ===== */}
                    {selectedCharge && (
                        <div className="modal-overlay" onClick={() => setSelectedCharge(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'700px', maxHeight:'90vh', overflowY:'auto'}}>
                                {/* Header */}
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:`3px solid ${selectedCharge.color}`}}>
                                    <div style={{display:'flex', alignItems:'center', gap:10}}>
                                        <div style={{width:40, height:40, borderRadius:10, background:selectedCharge.color+'20', display:'flex', alignItems:'center', justifyContent:'center'}}>
                                            <i className={`fa-solid ${selectedCharge.icon}`} style={{fontSize:18, color:selectedCharge.color}}></i>
                                        </div>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700}}>{selectedCharge.poste}</div>
                                            <div style={{fontSize:11, color:'var(--gray-400)'}}>{selectedCharge.fournisseur} | {selectedCharge.ferme}</div>
                                        </div>
                                    </div>
                                    <div style={{textAlign:'right'}}>
                                        <div style={{fontSize:22, fontWeight:700, color:selectedCharge.color}}>{(chargeElapsed(selectedCharge)/1000).toFixed(0)}K DH <span style={{fontSize:10, opacity:0.6, fontWeight:500}}>/ {(selectedCharge.total/1000).toFixed(0)}K</span></div>
                                        <div style={{fontSize:11, color:'var(--gray-400)'}}>{totalChargesDisplay > 0 ? (chargeElapsed(selectedCharge) / totalChargesDisplay * 100).toFixed(1) : '0'}% du total charges à date</div>
                                    </div>
                                </div>

                                {/* Détail par ligne */}
                                <div style={{marginBottom:16}}>
                                    <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-list" style={{marginRight:6}}></i>Détail des dépenses
                                    </div>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr><th>Description</th><th style={{textAlign:'right', width:120}}>Montant (DH)</th><th style={{textAlign:'right', width:60}}>%</th></tr>
                                        </thead>
                                        <tbody>
                                            {selectedCharge.detail.map((d, i) => (
                                                <tr key={i}>
                                                    <td>{d.desc}</td>
                                                    <td style={{textAlign:'right', fontWeight:600}}>{d.montant.toLocaleString('fr-FR')}</td>
                                                    <td style={{textAlign:'right', color:'var(--gray-400)'}}>{(d.montant/selectedCharge.total*100).toFixed(0)}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Évolution par mois */}
                                <div style={{marginBottom:16}}>
                                    <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-chart-bar" style={{marginRight:6}}></i>Évolution mensuelle
                                    </div>
                                    {(() => {
                                        const mois = selectedCharge.parMois;
                                        const maxV = Math.max(...mois.map(m => m.v));
                                        return (
                                            <div style={{display:'flex', alignItems:'flex-end', gap:6, height:120, padding:'0 10px'}}>
                                                {mois.map((m, i) => {
                                                    const st = moisStatus(m.m);
                                                    const [yy, mm] = MOIS_CAMPAGNE[m.m] || [0,0];
                                                    const displayV = st === 'current' ? Math.round(m.v * (_todayD / new Date(yy, mm, 0).getDate())) : (st === 'past' ? m.v : 0);
                                                    const barColor = st === 'future' ? 'var(--gray-200)' : (st === 'current' ? '#D4A847' : selectedCharge.color);
                                                    const labelColor = st === 'future' ? 'var(--gray-300)' : (st === 'current' ? '#D4A847' : selectedCharge.color);
                                                    return (
                                                        <div key={i} style={{flex:1, textAlign:'center'}}>
                                                            <div style={{fontSize:9, fontWeight:600, color:labelColor, marginBottom:2}}>
                                                                {displayV > 0 ? `${(displayV/1000).toFixed(0)}K` : '-'}
                                                            </div>
                                                            <div style={{height: maxV > 0 ? Math.max(m.v / maxV * 80, 2) : 2, background: barColor, borderRadius:'3px 3px 0 0', opacity: st === 'future' ? 0.35 : 0.85, transition:'height 0.3s'}}></div>
                                                            <div style={{fontSize:9, color: st === 'future' ? 'var(--gray-300)' : 'var(--gray-400)', marginTop:4, fontWeight: st === 'current' ? 700 : 400}}>{m.m}</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* KPIs */}
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16}}>
                                    <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Moyenne / Mois écoulé</div>
                                        <div style={{fontSize:16, fontWeight:700}}>{elapsedMonthsCount > 0 ? (chargeElapsed(selectedCharge)/elapsedMonthsCount/1000).toFixed(0) : '0'}K DH</div>
                                    </div>
                                    <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Par Hectare</div>
                                        <div style={{fontSize:16, fontWeight:700}}>{(selectedCharge.total/data.totalHa/1000).toFixed(0)}K DH</div>
                                    </div>
                                    <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Par Kg produit</div>
                                        <div style={{fontSize:16, fontWeight:700}}>{(selectedCharge.total/data.totalKgExport).toFixed(1)} DH</div>
                                    </div>
                                </div>

                                <button onClick={() => setSelectedCharge(null)} style={{width:'100%', padding:'10px', background:'var(--berry)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer'}}>
                                    <i className="fa-solid fa-xmark" style={{marginRight:6}}></i> Fermer
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { FinDashboardTab };
