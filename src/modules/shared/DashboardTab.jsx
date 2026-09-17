/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): DashboardTab */
import { AnalysesFoliairesAlertDashboard } from '../agronomie/AnalysesFoliairesAlertDashboard.jsx';
import { displayParcelle } from '../agronomie/displayParcelle.jsx';
import { matchCulture } from '../agronomie/matchCulture.jsx';
import { ChefBlocPerformancePanel } from '../qualite/ChefBlocPerformancePanel.jsx';
import { ChefHorsRecoltePanel } from '../qualite/ChefHorsRecoltePanel.jsx';
import { ChefInspectionsPanel } from '../qualite/ChefInspectionsPanel.jsx';
import { ChefProductionWidget } from '../qualite/ChefProductionWidget.jsx';
import { WorkerLink } from '../rh/WorkerLink.jsx';
import { METEO_DEFAULT_FARM_BY_PROFILE } from '../technique/METEO_DEFAULT_FARM_BY_PROFILE.jsx';
import { MeteoAlertsDashboard } from '../technique/MeteoAlertsDashboard.jsx';
import { FARMS } from './FARMS.jsx';
import { FarmBanner } from './FarmBanner.jsx';
import { KPICard } from './KPICard.jsx';
import { PROFILES } from './PROFILES.jsx';
import { Panel } from './Panel.jsx';
import { SimpleAreaChart } from './SimpleAreaChart.jsx';
import { SimplePieChart } from './SimplePieChart.jsx';
import { cachedFetch } from './cachedFetch.jsx';
import { deriveSubFerme } from './deriveSubFerme.jsx';
import { invalidateCache } from './invalidateCache.jsx';
import { useState } from './reactHooks.jsx';

import * as RecolteKpiUtils from './lib/recolteKpiUtils.js';
import * as QuinzaineUtils from './lib/quinzaineUtils.js';
import { QuinzaineRecapCards } from '../rh/QuinzaineRecapCards.jsx';
function DashboardTab({ data, farmFilter, avoSubFilter, onNavigateMeteo, currentProfile, cultureFilter }) {
            const [apiData, setApiData] = useState(null);
            const [nouveauxData, setNouveauxData] = useState(null);
            const [detailRows, setDetailRows] = useState([]);
            const [recolteWorkers, setRecolteWorkers] = useState([]);
            const [recolteCueillette, setRecolteCueillette] = useState([]);
            const [transportRows, setTransportRows] = useState([]);
            const [transportFullData, setTransportFullData] = useState({});
            const [transportPeriodes, setTransportPeriodes] = useState([]);
            const [recolteEquipeRows, setRecolteEquipeRows] = useState([]);
            const [recolteEquipePeriodes, setRecolteEquipePeriodes] = useState([]);
            const [quinzaineData, setQuinzaineData] = useState(null);
            const [presenceData, setPresenceData] = useState({ rows: [], syncedAt: null });
            const [presenceQData, setPresenceQData] = useState(null);
            const [sansSortiePopup, setSansSortiePopup] = useState(null); // {date, jourLabel, equipeNom, workers}
            const [backfilling, setBackfilling] = useState(false);
            const [backfillMsg, setBackfillMsg] = useState('');
            // Ferme pour le filtre "sans entrée/sortie" : chef_f1/chef_f5 n'ont pas farm dans PROFILES
            const presenceFerme = farmFilter ||
                (currentProfile === 'chef_f1' ? 'F1' :
                 currentProfile === 'chef_f5' ? 'F5' : null);
            const [workerPopup, setWorkerPopup] = useState(null);
            const [workerLoading, setWorkerLoading] = useState(false);
            const [kpiPopup, setKpiPopup] = useState(null); // { title, ferme, type }
            const [showPrimeTrend, setShowPrimeTrend] = useState(false);
            const [quinzainePopup, setQuinzainePopup] = useState(null); // 'mo' | 'recolte' | 'transport' | 'traitement'
            const [nouveauxExpanded, setNouveauxExpanded] = useState(false);
            const [loading, setLoading] = useState(true);
            const COLORS = ['#8B2252', '#2D8B4E', '#D4A847'];
            const presenceByMat = React.useMemo(() => Object.fromEntries((presenceData.rows || []).map(r => [(r.matricule || '').toUpperCase().trim(), r])), [presenceData]);
            const lookupPresence = (mat) => presenceByMat[(mat || '').toUpperCase().trim()] || null;
            const eqNames = {'MM':'Boucharen','AY':'Chelihat','HT':'El Bachir','HA':'El Hafi','KR':'Farid','NA':'Larache','JA':'Ksr Femme','AZ':'Chahdi','CC':'Sektoui','CA':'Regragi','RE':'Dechira','NV':'NV','XX':'Sans Équipe','MU':'Sans Équipe'};
            const getEqPrefix = (mat) => { if (!mat) return 'NV'; const m = mat.toUpperCase().trim(); const p2 = m.substring(0,2); if (eqNames[p2]) return p2; if (m.startsWith('HAFI')||m.startsWith('HA')) return 'HA'; if (m.startsWith('DD')) return 'NV'; return 'XX'; };
            const calcPrime = (kg, variete, date) => { const k = kg || 0; const isMyr = /corina|corrina|cascade|breeze|myrtille|blue/i.test(variete || ''); if (isMyr) { const seuil = /breeze/i.test(variete || '') ? 25 : /cascade/i.test(variete || '') ? ((date || '') >= '2026-04-25' ? 30 : 25) : 30; return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0; } if (k < 20) return 0; if (k < 25) return 20; if (k < 30) return 40; if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10; return Math.round((90 + (k - 40) * 4) * 10) / 10; };

            React.useEffect(() => {
                // Invalidate stale transport cache missing new fields
                // Force invalidate transport cache to ensure fresh jour férié data
                invalidateCache('transport');
                Promise.all([
                    cachedFetch('/api/pointage-rh?action=summary'),
                    cachedFetch('/api/pointage-rh?action=nouveaux-ouvriers'),
                    cachedFetch('/api/pointage-rh?action=detail'),
                    cachedFetch('/api/pointage-rh?action=recolte'),
                    cachedFetch('/api/pointage-rh?action=transport'),
                    cachedFetch('/api/pointage-rh?action=recolte-equipes'),
                    cachedFetch('/api/pointage-rh?action=quinzaine'),
                    cachedFetch('/api/pointage-rh?action=presence'),
                    cachedFetch('/api/pointage-rh?action=presence-quinzaine'),
                ]).then(([summary, nouveaux, detail, recolte, transport, recolteEq, quinz, presence, presenceQ]) => {
                    if (summary.success) setApiData(summary);
                    if (nouveaux.success) setNouveauxData(nouveaux);
                    if (detail.success) setDetailRows(detail.rows || []);
                    if (recolte.success) { setRecolteWorkers(recolte.workers || []); setRecolteCueillette(recolte.cueillette || []); }
                    if (transport.success) { setTransportRows(transport.rows || []); setTransportFullData(transport); setTransportPeriodes(transport.periodes || []); }
                    if (recolteEq.success) { setRecolteEquipeRows(recolteEq.rows || []); setRecolteEquipePeriodes(recolteEq.periodes || []); }
                    if (quinz.success) setQuinzaineData(quinz);
                    if (presence && presence.success) setPresenceData({ rows: presence.rows || [], syncedAt: presence.syncedAt || null });
                    if (presenceQ && presenceQ.success) setPresenceQData(presenceQ);
                }).catch(err => console.warn('Pointage API error:', err))
                  .finally(() => setLoading(false));
            }, []);

            const openWorkerDetail = (matricule) => {
                setWorkerLoading(true);
                fetch(`/api/pointage-rh?action=worker-detail&matricule=${encodeURIComponent(matricule)}`)
                    .then(r => r.json())
                    .then(json => { if (json.success && json.worker) setWorkerPopup(json.worker); })
                    .catch(err => console.warn(err))
                    .finally(() => setWorkerLoading(false));
            };

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🍇</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement pointage...</div></div>;
            if (!apiData) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--red)'}}><i className="fa-solid fa-triangle-exclamation fa-2x"></i><div style={{marginTop:12}}>Impossible de charger les données</div></div>;

            const effectif = apiData.effectif || {};
            const farms = farmFilter ? [farmFilter] : FARMS;

            // Sub-farm filtering helper for Avocatier
            const matchSub = (r) => !avoSubFilter || deriveSubFerme(r.refParcelle, r.parcelle) === avoSubFilter;

            // When a sub-farm is selected, recompute effectif from detailRows
            const effectifOverride = avoSubFilter ? (() => {
                const filtered = detailRows.filter(r => r.ferme === 'Avocatier' && matchSub(r));
                const byType = (type) => new Set(filtered.filter(r => r.type === type).map(r => r.matricule)).size;
                // total = matricules DISTINCTS tous types confondus (un ouvrier multi-types compte 1×)
                const total = new Set(filtered.map(r => r.matricule)).size;
                return { recolte: byType('recolte'), horsRecolte: byType('horsRecolte'), postesFixes: byType('postesFixes'), total: total, cout: filtered.reduce((s, r) => s + (r.cout || 0), 0) };
            })() : null;
            const eff = avoSubFilter ? { [farmFilter]: effectifOverride } : effectif;

            // Effectif total = matricules DISTINCTS (backend renvoie déjà e.total distinct via
            // countDistinctByFermeType). Fallback sur la somme des types si total absent.
            const effTotal = (e) => (e && e.total != null) ? e.total : ((e.recolte||0) + (e.horsRecolte||0) + (e.postesFixes||0));
            const totalEffectif = farms.reduce((s, f) => s + effTotal(eff[f] || {}), 0);
            const totalRecolte = farms.reduce((s, f) => s + ((eff[f]||{}).recolte||0), 0);
            const totalHorsRecolte = farms.reduce((s, f) => s + ((eff[f]||{}).horsRecolte||0), 0);
            const totalFixes = farms.reduce((s, f) => s + ((eff[f]||{}).postesFixes||0), 0);
            const totalCout = farms.reduce((s, f) => s + ((eff[f]||{}).cout||0), 0);

            const pieData = farms.map(f => {
                const e = eff[f] || {};
                return { name: f, value: effTotal(e) };
            });

            const pointageJour = apiData.pointageJour || [];
            const weeklyTrend = (apiData.weeklyTrend || []).map(d => ({ ...d, jour: d.jourLabel || d.jour }));

            // Logistique récolte stats
            const logOps = /caporal|conditionnement|encadrement|chargement/i;
            const rwFiltered = farmFilter ? recolteWorkers.filter(w => {
                const ferme = w.ferme || (w.refParcelle && w.refParcelle.startsWith('F5') ? 'F5' : 'F1');
                return ferme === farmFilter && matchSub(w);
            }) : recolteWorkers;
            const logCount = rwFiltered.filter(w => logOps.test(w.operation)).length;
            const recCount = rwFiltered.filter(w => !logOps.test(w.operation)).length;
            const logPct = recCount > 0 ? Math.round(logCount / recCount * 100) : 0;
            const topOpsRaw = (apiData.topOps || []).filter(o => (!farmFilter || o.ferme === farmFilter) && (!avoSubFilter || deriveSubFerme(o.refParcelle, o.parcelle) === avoSubFilter)).slice(0, 5);
            // Enrich with equipes + parcelle refs from detailRows
            const topOps = topOpsRaw.map(op => {
                const matchingWorkers = detailRows.filter(r => r.operation === op.operation && (r.parcelle || '').trim() === (op.parcelle || '').trim() && r.type !== 'recolte' && r.type !== 'postesFixes');
                const eqSet = new Set(matchingWorkers.map(r => eqNames[getEqPrefix(r.matricule)] || getEqPrefix(r.matricule)));
                // Extract parcelle ref prefixes for Avocatier (F2, F3, F4, F5, F6, BAHIA)
                const refSet = new Set(matchingWorkers.map(r => {
                    const ref = (r.refParcelle || '').trim();
                    if (/bahia/i.test(ref) || /bahia/i.test(r.parcelle)) return 'BAHIA';
                    const m = ref.match(/^(F\d)/i);
                    return m ? m[1].toUpperCase() : ref;
                }).filter(Boolean));
                return { ...op, equipes: [...eqSet], parcRefs: [...refSet] };
            });

            // Ferme utilisée UNIQUEMENT pour le widget météo : farmFilter/avoSubFilter
            // si présents, sinon défaut par profil (chef_f1/chef_f5/dg). Ne touche pas à
            // farmFilter lui-même, utilisé par les autres widgets du Dashboard.
            const meteoFarmFilter = avoSubFilter || farmFilter || METEO_DEFAULT_FARM_BY_PROFILE[currentProfile];

            // Backfill des heures d'entrée/sortie depuis BEE ONE Production pour la quinzaine
            // en cours (rattrape les sorties saisies tardivement). Ne touche pas au pointage.
            const handleBackfillPresence = async () => {
                const dts = [...new Set((presenceQData.days || []).map(d => d.date))].sort();
                if (dts.length === 0) { alert('Aucune date pour cette quinzaine.'); return; }
                const startDate = dts[0], endDate = dts[dts.length - 1];
                if (!confirm(`Mettre à jour les heures d'entrée/sortie depuis BEE ONE pour la quinzaine en cours (${startDate} → ${endDate}) ?\n\nLe pointage analytique n'est pas modifié.`)) return;
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
                        invalidateCache('presence-quinzaine');
                        const fresh = await cachedFetch('/api/pointage-rh?action=presence-quinzaine');
                        if (fresh && fresh.success) setPresenceQData(fresh);
                    } else {
                        setBackfillMsg('Erreur : ' + ((json && json.error) || 'inconnue'));
                    }
                } catch (e) {
                    setBackfillMsg('Erreur : ' + e.message);
                } finally {
                    setBackfilling(false);
                }
            };

            return (
                <div className="fade-in">
                    {farmFilter && (
                        <FarmBanner farm={avoSubFilter || farmFilter} chefName={PROFILES.find(p => p.farm === farmFilter)?.fullName || 'Chef'} effectifData={eff[farmFilter]} />
                    )}

                    {/* Alertes Météo Dashboard (Chef uniquement, + défaut pour chef_f1/chef_f5/dg sans farmFilter) */}
                    {meteoFarmFilter && <MeteoAlertsDashboard farmFilter={meteoFarmFilter} onNavigateMeteo={onNavigateMeteo} />}

                    {/* Alertes Analyses Foliaires (Chef uniquement) */}
                    {farmFilter && <AnalysesFoliairesAlertDashboard ferme={avoSubFilter || farmFilter} onNavigate={onNavigateMeteo} />}

                    {/* Production Cycle 2 — Chef F1 / Chef F5 uniquement */}
                    {(currentProfile === 'chef_f1' || currentProfile === 'chef_f5') && farmFilter && (
                        <ChefProductionWidget farmFilter={farmFilter} />
                    )}

                    {/* Équipes sans entrée/sortie — Chef F1/F5 uniquement */}
                    {(currentProfile === 'chef_f1' || currentProfile === 'chef_f5') && presenceFerme && presenceQData && (() => {
                        // Per day: find workers missing entry or exit
                        const daysWithIssues = (presenceQData.days || [])
                            .map(d => {
                                // Workers who worked in THIS farm on THIS specific day (not the whole quinzaine)
                                const allowedMatsForDay = new Set(
                                    transportRows
                                        .filter(r => r.ferme === presenceFerme && r.jour === d.date)
                                        .map(r => (r.matricule || '').toUpperCase().trim())
                                );
                                if (allowedMatsForDay.size === 0) return null;
                                const filtered = d.rows.filter(r => {
                                    const mat = (r.matricule || '').toUpperCase().trim();
                                    if (!allowedMatsForDay.has(mat)) return false;
                                    return !r.heureEntree || !r.heureSortie;
                                });
                                if (!filtered.length) return null;
                                // Group by équipe — store individual worker rows for popup
                                const byEq = {};
                                filtered.forEach(r => {
                                    const prefix = getEqPrefix(r.matricule);
                                    if (!byEq[prefix]) byEq[prefix] = { nom: eqNames[prefix] || prefix, count: 0, missing: new Set(), workers: [] };
                                    byEq[prefix].count++;
                                    if (!r.heureEntree) byEq[prefix].missing.add('entrée');
                                    if (!r.heureSortie) byEq[prefix].missing.add('sortie');
                                    byEq[prefix].workers.push(r);
                                });
                                const dt2 = new Date(d.date + 'T00:00:00');
                                const jourLabel2 = dt2.toLocaleDateString('fr-FR', {weekday:'short',day:'numeric',month:'short'});
                                return { date: d.date, jourLabel: jourLabel2, equipes: Object.values(byEq).sort((a,b) => b.count - a.count) };
                            })
                            .filter(Boolean);
                        if (!daysWithIssues.length) return null;
                        return (
                            <div style={{marginBottom:16,borderRadius:12,border:'1.5px solid rgba(231,76,60,0.25)',overflow:'hidden'}}>
                                <div style={{padding:'10px 16px',background:'rgba(231,76,60,0.06)',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgba(231,76,60,0.15)'}}>
                                    <i className="fa-solid fa-clock-rotate-left" style={{color:'#e74c3c',fontSize:14}}></i>
                                    <span style={{fontWeight:700,fontSize:13,color:'#e74c3c'}}>Équipes sans entrée/sortie</span>
                                    <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:'auto'}}>Quinzaine en cours — {daysWithIssues.length} jour{daysWithIssues.length > 1 ? 's' : ''}</span>
                                    <button onClick={handleBackfillPresence} disabled={backfilling}
                                        title="Recharge les heures d'entrée/sortie depuis BEE ONE pour la quinzaine en cours. Ne modifie pas le pointage."
                                        style={{padding:'4px 10px',background:backfilling?'var(--gray-200)':'#e74c3c',color:backfilling?'var(--gray-500)':'#fff',border:'none',borderRadius:8,fontSize:10,fontWeight:600,cursor:backfilling?'default':'pointer',display:'flex',alignItems:'center',gap:5}}>
                                        <i className={`fa-solid ${backfilling?'fa-spinner fa-spin':'fa-rotate'}`}></i>
                                        {backfilling ? 'Mise à jour…' : 'Mettre à jour les heures de sortie'}
                                    </button>
                                </div>
                                {backfillMsg && <div style={{padding:'4px 16px',fontSize:10,color:'var(--gray-500)',background:'#fff',borderBottom:'1px solid var(--gray-100)'}}>{backfillMsg}</div>}
                                <div style={{padding:'8px 12px',background:'#fff'}}>
                                    {daysWithIssues.map((d, di) => (
                                        <div key={di} style={{display:'flex',alignItems:'center',gap:10,padding:'5px 4px',borderBottom: di < daysWithIssues.length - 1 ? '1px solid var(--gray-100)' : 'none',flexWrap:'wrap'}}>
                                            <span style={{fontSize:11,fontWeight:700,color:'var(--dark)',minWidth:80}}>{d.jourLabel}</span>
                                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                                                {d.equipes.map((eq, ei) => (
                                                    <span key={ei} onClick={() => setSansSortiePopup({ date: d.date, jourLabel: d.jourLabel, equipeNom: eq.nom, workers: eq.workers.sort((a,b) => (a.nom||'').localeCompare(b.nom||'')) })}
                                                        style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(231,76,60,0.08)',color:'#c0392b',fontWeight:600,cursor:'pointer',transition:'background 0.15s'}}
                                                        onMouseEnter={e => e.currentTarget.style.background='rgba(231,76,60,0.18)'}
                                                        onMouseLeave={e => e.currentTarget.style.background='rgba(231,76,60,0.08)'}>
                                                        {eq.nom} <span style={{opacity:0.6}}>({eq.count} — {[...eq.missing].join('/')})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Équipes sans entrée/sortie — RH : toutes fermes */}
                    {currentProfile === 'rh' && presenceQData && (() => {
                        const daysWithIssues = (presenceQData.days || [])
                            .map(d => {
                                const allowedMatsForDay = new Set(
                                    transportRows
                                        .filter(r => r.jour === d.date)
                                        .map(r => (r.matricule || '').toUpperCase().trim())
                                );
                                if (allowedMatsForDay.size === 0) return null;
                                const filtered = d.rows.filter(r => {
                                    const mat = (r.matricule || '').toUpperCase().trim();
                                    return allowedMatsForDay.has(mat) && (!r.heureEntree || !r.heureSortie);
                                });
                                if (!filtered.length) return null;
                                const byEq = {};
                                filtered.forEach(r => {
                                    const prefix = getEqPrefix(r.matricule);
                                    if (!byEq[prefix]) byEq[prefix] = { nom: eqNames[prefix] || prefix, count: 0, missing: new Set(), workers: [] };
                                    byEq[prefix].count++;
                                    if (!r.heureEntree) byEq[prefix].missing.add('entrée');
                                    if (!r.heureSortie) byEq[prefix].missing.add('sortie');
                                    byEq[prefix].workers.push(r);
                                });
                                const dt2 = new Date(d.date + 'T00:00:00');
                                const jourLabel2 = dt2.toLocaleDateString('fr-FR', {weekday:'short',day:'numeric',month:'short'});
                                return { date: d.date, jourLabel: jourLabel2, equipes: Object.values(byEq).sort((a,b) => b.count - a.count) };
                            })
                            .filter(Boolean);
                        if (!daysWithIssues.length) return null;
                        return (
                            <div style={{marginBottom:16,borderRadius:12,border:'1.5px solid rgba(231,76,60,0.25)',overflow:'hidden'}}>
                                <div style={{padding:'10px 16px',background:'rgba(231,76,60,0.06)',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgba(231,76,60,0.15)'}}>
                                    <i className="fa-solid fa-clock-rotate-left" style={{color:'#e74c3c',fontSize:14}}></i>
                                    <span style={{fontWeight:700,fontSize:13,color:'#e74c3c'}}>Équipes sans entrée/sortie</span>
                                    <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:8,opacity:0.7}}>— Toutes fermes</span>
                                    <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:'auto'}}>Quinzaine en cours — {daysWithIssues.length} jour{daysWithIssues.length > 1 ? 's' : ''}</span>
                                    <button onClick={handleBackfillPresence} disabled={backfilling}
                                        title="Recharge les heures d'entrée/sortie depuis BEE ONE pour la quinzaine en cours. Ne modifie pas le pointage."
                                        style={{padding:'4px 10px',background:backfilling?'var(--gray-200)':'#e74c3c',color:backfilling?'var(--gray-500)':'#fff',border:'none',borderRadius:8,fontSize:10,fontWeight:600,cursor:backfilling?'default':'pointer',display:'flex',alignItems:'center',gap:5}}>
                                        <i className={`fa-solid ${backfilling?'fa-spinner fa-spin':'fa-rotate'}`}></i>
                                        {backfilling ? 'Mise à jour…' : 'Mettre à jour les heures de sortie'}
                                    </button>
                                </div>
                                {backfillMsg && <div style={{padding:'4px 16px',fontSize:10,color:'var(--gray-500)',background:'#fff',borderBottom:'1px solid var(--gray-100)'}}>{backfillMsg}</div>}
                                <div style={{padding:'8px 12px',background:'#fff'}}>
                                    {daysWithIssues.map((d, di) => (
                                        <div key={di} style={{display:'flex',alignItems:'center',gap:10,padding:'5px 4px',borderBottom: di < daysWithIssues.length - 1 ? '1px solid var(--gray-100)' : 'none',flexWrap:'wrap'}}>
                                            <span style={{fontSize:11,fontWeight:700,color:'var(--dark)',minWidth:80}}>{d.jourLabel}</span>
                                            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                                                {d.equipes.map((eq, ei) => (
                                                    <span key={ei} onClick={() => setSansSortiePopup({ date: d.date, jourLabel: d.jourLabel, equipeNom: eq.nom, workers: eq.workers.sort((a,b) => (a.nom||'').localeCompare(b.nom||'')) })}
                                                        style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(231,76,60,0.08)',color:'#c0392b',fontWeight:600,cursor:'pointer',transition:'background 0.15s'}}
                                                        onMouseEnter={e => e.currentTarget.style.background='rgba(231,76,60,0.18)'}
                                                        onMouseLeave={e => e.currentTarget.style.background='rgba(231,76,60,0.08)'}>
                                                        {eq.nom} <span style={{opacity:0.6}}>({eq.count} — {[...eq.missing].join('/')})</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Popup détail équipe sans entrée/sortie */}
                    {sansSortiePopup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
                            onClick={() => setSansSortiePopup(null)}>
                            <div style={{background:'#fff',borderRadius:16,maxWidth:700,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                                onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 20px',background:'linear-gradient(135deg, #c0392b 0%, #922b21 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                                    <div>
                                        <div style={{fontSize:16,fontWeight:700}}><i className="fa-solid fa-clock-rotate-left" style={{marginRight:8}}></i>{sansSortiePopup.equipeNom} — {sansSortiePopup.jourLabel}</div>
                                        <div style={{fontSize:11,opacity:0.85,marginTop:2}}>{(sansSortiePopup.workers || []).length} ouvrier{(sansSortiePopup.workers || []).length !== 1 ? 's' : ''} sans entrée/sortie complète</div>
                                    </div>
                                    <button onClick={() => setSansSortiePopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                                <div style={{padding:'16px 20px'}}>
                                    <table className="data-table" style={{fontSize:12,margin:0}}>
                                        <thead>
                                            <tr style={{background:'var(--gray-50)'}}>
                                                <th style={{padding:'6px 10px'}}>Matricule</th>
                                                <th style={{padding:'6px 10px'}}>Nom</th>
                                                <th style={{padding:'6px 10px',textAlign:'center'}}>Heure Entrée</th>
                                                <th style={{padding:'6px 10px',textAlign:'center'}}>Heure Sortie</th>
                                                <th style={{padding:'6px 10px',textAlign:'center'}}>Manque</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(sansSortiePopup.workers || []).map((w, wi) => (
                                                <tr key={wi} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                    <td style={{fontFamily:'monospace',fontSize:10,padding:'7px 10px',color:'var(--gray-400)'}}>{w.matricule}</td>
                                                    <td style={{fontWeight:600,padding:'7px 10px'}}>{w.nom || w.matricule}</td>
                                                    <td style={{textAlign:'center',padding:'7px 10px',color: w.heureEntree ? 'var(--green,#2e7d32)' : '#e74c3c',fontWeight:600}}>
                                                        {w.heureEntree || <span style={{opacity:0.5}}>—</span>}
                                                    </td>
                                                    <td style={{textAlign:'center',padding:'7px 10px',color: w.heureSortie ? 'var(--green,#2e7d32)' : '#e74c3c',fontWeight:600}}>
                                                        {w.heureSortie || <span style={{opacity:0.5}}>—</span>}
                                                    </td>
                                                    <td style={{textAlign:'center',padding:'7px 10px'}}>
                                                        {!w.heureEntree && !w.heureSortie
                                                            ? <span style={{fontSize:10,padding:'2px 6px',borderRadius:8,background:'rgba(231,76,60,0.1)',color:'#c0392b',fontWeight:600}}>entrée + sortie</span>
                                                            : !w.heureEntree
                                                            ? <span style={{fontSize:10,padding:'2px 6px',borderRadius:8,background:'rgba(231,76,60,0.1)',color:'#c0392b',fontWeight:600}}>entrée</span>
                                                            : <span style={{fontSize:10,padding:'2px 6px',borderRadius:8,background:'rgba(231,76,60,0.1)',color:'#c0392b',fontWeight:600}}>sortie</span>
                                                        }
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    <div style={{marginBottom:16,padding:'16px 20px',background:'linear-gradient(135deg, var(--berry) 0%, #6b1a3a 100%)',borderRadius:12,color:'white',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
                        <div style={{display:'flex',alignItems:'center',gap:12}}>
                            <i className="fa-solid fa-clock" style={{fontSize:24,opacity:0.9}}></i>
                            <div>
                                <div style={{fontSize:16,fontWeight:700}}>Pointage du Jour</div>
                                <div style={{fontSize:12,opacity:0.85}}>{apiData.date ? new Date(apiData.date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}) : apiData.date}</div>
                            </div>
                        </div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                            <span style={{background:'rgba(255,255,255,0.2)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                                <i className="fa-solid fa-database" style={{marginRight:4}}></i>Firestore Cache
                            </span>
                            {apiData.lastSaisie && <span style={{background:'rgba(255,255,255,0.2)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                                <i className="fa-solid fa-pen" style={{marginRight:4}}></i>Dernière saisie: {new Date(apiData.lastSaisie).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
                            </span>}
                            <span style={{background:'rgba(255,255,255,0.2)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                                <i className="fa-solid fa-coins" style={{marginRight:4}}></i>Coût jour: {totalCout.toLocaleString('fr-FR')} DH
                            </span>
                            <span style={{background:'rgba(255,255,255,0.2)',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                                <i className="fa-solid fa-users" style={{marginRight:4}}></i>Effectif: {totalEffectif}
                            </span>
                        </div>
                    </div>

                    {farmFilter ? (
                        <div className="kpi-grid">
                            <KPICard icon={farmFilter === 'Avocatier' ? 'fa-tree' : 'fa-leaf'} iconClass={farmFilter === 'F1' ? 'berry' : (farmFilter === 'F5' ? 'green' : 'orange')} value={effTotal(eff[farmFilter]||{})} label={avoSubFilter ? `Effectif ${avoSubFilter}` : "Effectif Total"}
                                onClick={() => setKpiPopup({ title: `Effectif Total — ${avoSubFilter || farmFilter}`, ferme: farmFilter, type: 'all', icon: 'fa-users' })} />
                            <KPICard icon="fa-basket-shopping" iconClass={farmFilter === 'F1' ? 'berry' : (farmFilter === 'F5' ? 'green' : 'orange')} value={(eff[farmFilter]||{}).recolte || 0} label="Effectif Récolte"
                                onClick={() => setKpiPopup({ title: `Récolte — ${avoSubFilter || farmFilter}`, ferme: farmFilter, type: 'recolte', icon: 'fa-basket-shopping' })}
                                subItems={[{ value: logCount, label: 'Logistique' }, { value: logPct + '%', label: 'Log/Récolte' }]} />
                            <KPICard icon="fa-trowel" iconClass={farmFilter === 'F1' ? 'berry' : (farmFilter === 'F5' ? 'green' : 'orange')} value={(eff[farmFilter]||{}).horsRecolte || 0} label="Effectif Hors Récolte"
                                onClick={() => setKpiPopup({ title: `Hors Récolte — ${avoSubFilter || farmFilter}`, ferme: farmFilter, type: 'horsRecolte', icon: 'fa-trowel' })} />
                            <KPICard icon="fa-diagram-next" iconClass={farmFilter === 'F1' ? 'berry' : (farmFilter === 'F5' ? 'green' : 'orange')} value={(eff[farmFilter]||{}).postesFixes || 0} label="Ouvrier Avocatier"
                                onClick={() => setKpiPopup({ title: `Ouvrier Avocatier — ${avoSubFilter || farmFilter}`, ferme: farmFilter, type: 'postesFixes', icon: 'fa-diagram-next' })} />
                        </div>
                    ) : (
                        <div className="kpi-grid">
                            {farms.map(f => {
                                const e = effectif[f] || {};
                                const total = effTotal(e);
                                const pj = pointageJour.find(p => p.ferme === f) || {};
                                const fRw = recolteWorkers.filter(w => (w.ferme || '') === f);
                                const fLog = fRw.filter(w => logOps.test(w.operation)).length;
                                const fRec = fRw.filter(w => !logOps.test(w.operation)).length;
                                const fLogPct = fRec > 0 ? Math.round(fLog / fRec * 100) : 0;
                                return (
                                    <KPICard key={f} icon={f === 'Avocatier' ? 'fa-tree' : 'fa-leaf'} iconClass={f === 'F1' ? 'berry' : (f === 'F5' ? 'green' : 'orange')} value={total} label={`Effectif ${f}`} change={pj.diff || 0}
                                        onClick={() => setKpiPopup({ title: `Effectif ${f}`, ferme: f, type: 'all', icon: f === 'Avocatier' ? 'fa-tree' : 'fa-leaf' })}
                                        subItems={[
                                            { value: e.recolte||0, label: 'Récolte' },
                                            { value: e.horsRecolte||0, label: 'Hors Récolte' },
                                            { value: fLog + ' (' + fLogPct + '%)', label: 'Logistique' }
                                        ]}
                                    />
                                );
                            })}
                            <KPICard icon="fa-users" iconClass="blue" value={totalEffectif} label="Effectif Total"
                                onClick={() => setKpiPopup({ title: 'Effectif Total — Toutes Fermes', ferme: null, type: 'all', icon: 'fa-users' })}
                                subItems={[
                                    { value: totalRecolte, label: 'Récolte' },
                                    { value: totalHorsRecolte, label: 'Hors Récolte' },
                                    { value: logCount + ' (' + logPct + '%)', label: 'Logistique' }
                                ]}
                            />
                        </div>
                    )}

                    {/* ===== RECAP QUINZAINE EN COURS ===== */}
                    {(() => {
                        const transportEquipes = data.transportConfig || [];
                        const currentQuinz = transportPeriodes[0] || recolteEquipePeriodes[0] || '';
                        if (!currentQuinz) return null;

                        // Transport quinzaine — tarif effectif à la quinzaine (versionné).
                        // Fonction Transport UNIFIÉE (Lot 1 spec-quinzaine-cout-charge) :
                        // QuinzaineUtils.computeTransportQuinzaine — même source que
                        // l'écran Primes → mêmes totaux à périmètre ferme/sub égal. Encode la
                        // règle (Set ouvriers distincts par jour/équipe × tarif, filtré
                        // periode + ferme/sub), aucun total hardcodé.
                        const coutMap = {};
                        transportEquipes.forEach(t => { coutMap[t.prefix] = data.getCoutTransport ? data.getCoutTransport(t.prefix, currentQuinz) : t.coutParOuvrier; });
                        const qTransportRows = transportRows.filter(r => r.periode === currentQuinz && (!farmFilter || r.ferme === farmFilter) && matchSub(r));
                        const transportResult = (QuinzaineUtils && QuinzaineUtils.computeTransportQuinzaine)
                            ? QuinzaineUtils.computeTransportQuinzaine(transportRows, {
                                periode: currentQuinz,
                                transportEquipes,
                                coutMap,
                                ferme: farmFilter || null,
                                matchSub,
                            })
                            : { total: 0, totalWorkers: 0, dates: [], byEquipe: [], dailyByEquipe: {} };
                        const totalTransport = transportResult.total;
                        const tDates = transportResult.dates;

                        // Traitement quinzaine: 10 DH per worker-day
                        const traitRows = qTransportRows.filter(r => (r.operationFamille || '').toLowerCase().includes('traitement'));
                        const traitWD = new Set();
                        traitRows.forEach(r => traitWD.add(r.matricule + '|' + r.jour));
                        const totalTraitement = traitWD.size * 10;

                        // Conditionnement, Chargement, Jour Férié: from server pre-calculated data
                        const condDetailQ = (transportFullData?.conditionnementDetail || []).filter(w => w.periode === currentQuinz);
                        const totalConditionnement = condDetailQ.reduce((s, w) => s + w.jh, 0) * 10;
                        const chargDetailQ = (transportFullData?.chargementDetail || []).filter(w => w.periode === currentQuinz);
                        const totalChargement = chargDetailQ.reduce((s, w) => s + w.jh, 0) * (data.primesConfig?.primeChargement?.coutParJour || 10);
                        const ferieDetailQ = (transportFullData?.jourFerieDetail || []).filter(w => w.periode === currentQuinz);
                        const totalJourFerie = Math.round(ferieDetailQ.reduce((s, w) => s + (w.cout || 0), 0));

                        const totalAutresPrimes = totalTraitement + totalConditionnement + totalChargement + totalJourFerie;

                        // Prime récolte quinzaine
                        const qRecolteRows = recolteEquipeRows.filter(r => r.periode === currentQuinz && (!farmFilter || r.ferme === farmFilter) && matchSub(r) && matchCulture(r, cultureFilter));
                        const totalPrimeRecolte = qRecolteRows.reduce((s, r) => s + calcPrime(r.kg || 0, r.variete, r.jour), 0);

                        // Cout main d'oeuvre from quinzaine API (totalCout = Coût M.O DH)
                        const quinzParFerme = quinzaineData?.parFerme || [];
                        const totalMainOeuvre = farmFilter
                            ? quinzParFerme.filter(f => f.ferme === farmFilter).reduce((s, f) => s + (f.cout || 0), 0)
                            : (quinzaineData?.totalCout || 0);

                        const nbJours = Math.max(tDates.length, [...new Set(qRecolteRows.map(r => r.jour))].length, quinzaineData?.parJour?.length || 0);
                        const totalGlobal = totalMainOeuvre + totalTransport + totalPrimeRecolte + totalAutresPrimes;

                        // Detail data for popups — dérivé de la MÊME source unifiée
                        // (transportResult.dailyByEquipe, clé [jour][prefix]) pour rester
                        // strictement cohérent avec le total. On ré-indexe en [prefix][jour].
                        const transportByEqDay = {};
                        Object.keys(transportResult.dailyByEquipe).forEach(d => {
                            const perEq = transportResult.dailyByEquipe[d];
                            Object.keys(perEq).forEach(eq => {
                                if (!transportByEqDay[eq]) transportByEqDay[eq] = {};
                                transportByEqDay[eq][d] = perEq[eq];
                            });
                        });
                        const transportDetail = transportEquipes.filter(t => transportByEqDay[t.prefix]).map(t => {
                            let total = 0, totalWorkers = 0;
                            tDates.forEach(d => {
                                const n = transportByEqDay[t.prefix]?.[d]?.size || 0;
                                total += n * (coutMap[t.prefix] || 0);
                                totalWorkers += n;
                            });
                            return { equipe: t.equipe, prefix: t.prefix, caporal: t.caporal, cout: (coutMap[t.prefix] || 0), totalWorkers, total };
                        });

                        // Traitement par jour
                        const traitByDay = {};
                        traitRows.forEach(r => {
                            if (!traitByDay[r.jour]) traitByDay[r.jour] = new Set();
                            traitByDay[r.jour].add(r.matricule);
                        });
                        const traitDetail = Object.keys(traitByDay).sort().map(d => ({
                            jour: d,
                            jourLabel: new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'}),
                            nb: traitByDay[d].size,
                            montant: traitByDay[d].size * 10
                        }));

                        // Récolte par ouvrier (top)
                        const recolteByWorker = {};
                        qRecolteRows.forEach(r => {
                            if (!recolteByWorker[r.matricule]) recolteByWorker[r.matricule] = { matricule: r.matricule, nom: r.nom, ferme: r.ferme, totalKg: 0, jours: 0, prime: 0 };
                            recolteByWorker[r.matricule].totalKg += (r.kg || 0);
                            recolteByWorker[r.matricule].jours += 1;
                            recolteByWorker[r.matricule].prime += calcPrime(r.kg || 0, r.variete, r.jour);
                        });
                        const recolteTopWorkers = Object.values(recolteByWorker).sort((a,b) => b.prime - a.prime).slice(0, 20);

                        // MO par jour
                        const moParJour = quinzaineData?.parJour || [];

                        const recapItems = [
                            { label: 'Main d\'Oeuvre', icon: 'fa-users', color: 'var(--berry)', montant: totalMainOeuvre, popupKey: 'mo' },
                            { label: 'Prime Récolte', icon: 'fa-coins', color: 'var(--orange)', montant: totalPrimeRecolte, popupKey: 'recolte' },
                            { label: 'Prime Transport', icon: 'fa-bus', color: 'var(--green)', montant: totalTransport, popupKey: 'transport' },
                            { label: 'Autres Primes', icon: 'fa-layer-group', color: '#8e44ad', montant: totalAutresPrimes, popupKey: 'autres_primes',
                              subItems: [
                                { label: 'Traitement', montant: totalTraitement },
                                { label: 'Conditionnement', montant: totalConditionnement },
                                { label: 'Chargement', montant: totalChargement },
                                { label: 'Jour Férié', montant: totalJourFerie },
                              ]
                            },
                        ];

                        return (
                            <React.Fragment>
                            <Panel title={'Récap Quinzaine en Cours — ' + currentQuinz + (farmFilter ? ' — ' + farmFilter : '')} icon="fa-calendar-days">
                                <QuinzaineRecapCards
                                    recapItems={recapItems}
                                    totalGlobal={totalGlobal}
                                    nbJours={nbJours}
                                    badges={[
                                        { bg: 'var(--berry-pale)', color: 'var(--berry)', icon: 'fa-calendar', text: nbJours + ' jours' },
                                        { bg: '#e8f4fd', color: '#1565C0', icon: 'fa-calculator', text: 'Total: ' + Math.round(totalGlobal).toLocaleString('fr-FR') + ' DH' },
                                        ...(nbJours > 0 ? [{ bg: '#fff3e0', color: '#e65100', icon: 'fa-chart-simple', text: 'Moy/jour: ' + Math.round(totalGlobal / nbJours).toLocaleString('fr-FR') + ' DH' }] : []),
                                    ]}
                                    clickable={true}
                                    popup={{
                                        current: quinzainePopup,
                                        setCurrent: setQuinzainePopup,
                                        data: {
                                            currentQuinz: currentQuinz,
                                            farmFilter: farmFilter,
                                            nbJours: nbJours,
                                            quinzaineData: quinzaineData,
                                            quinzParFerme: quinzParFerme,
                                            moParJour: moParJour,
                                            qRecolteRows: qRecolteRows,
                                            recolteByWorker: recolteByWorker,
                                            recolteTopWorkers: recolteTopWorkers,
                                            tDates: tDates,
                                            qTransportRows: qTransportRows,
                                            transportDetail: transportDetail,
                                            traitWD: traitWD,
                                            traitDetail: traitDetail,
                                            condDetailQ: condDetailQ,
                                            chargDetailQ: chargDetailQ,
                                            ferieDetailQ: ferieDetailQ,
                                            totalTraitement: totalTraitement,
                                            totalConditionnement: totalConditionnement,
                                            totalChargement: totalChargement,
                                            totalJourFerie: totalJourFerie,
                                            openWorkerDetail: openWorkerDetail,
                                        },
                                    }}
                                />
                            </Panel>
                        </React.Fragment>
                        );
                    })()}

                    {(() => {
                        if (!nouveauxData) return null;
                        const filteredWorkers = farmFilter ? (nouveauxData.workers || []).filter(w => w.ferme === farmFilter && matchSub(w)) : (nouveauxData.workers || []);
                        if (filteredWorkers.length === 0) return null;
                        const today = new Date().toISOString().slice(0, 10);
                        const filteredToday = filteredWorkers.filter(w => w.firstDate === today).length;
                        const filteredByFarm = {};
                        filteredWorkers.forEach(w => { filteredByFarm[w.ferme] = (filteredByFarm[w.ferme] || 0) + 1; });
                        return (
                            <div style={{marginBottom:16}}>
                                <div className="kpi-grid" style={{marginBottom:12}}>
                                    <KPICard icon="fa-user-plus" iconClass="green" value={filteredToday} label="Nouveaux Aujourd'hui" />
                                    <KPICard icon="fa-user-group" iconClass="blue" value={filteredWorkers.length} label={'Nouveaux ' + nouveauxData.periode}
                                        subItems={Object.entries(filteredByFarm).map(([f, v]) => ({ value: v, label: f }))}
                                    />
                                </div>
                                <Panel title={'Nouveaux Ouvriers — ' + nouveauxData.periode + (farmFilter ? ' — ' + farmFilter : '')} icon="fa-user-plus"
                                    actions={<button onClick={() => setNouveauxExpanded(!nouveauxExpanded)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:14,padding:'4px 8px'}}>
                                        <i className={`fa-solid ${nouveauxExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                                    </button>}>
                                    {nouveauxExpanded && <React.Fragment>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Matricule</th>
                                                <th>Nom</th>
                                                <th>Date Arrivée</th>
                                                <th>Ferme</th>
                                                <th>Équipe</th>
                                                <th>Opération</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredWorkers.map((w, i) => (
                                                <tr key={i} style={{cursor:'pointer',transition:'background 0.15s'}}
                                                    onMouseEnter={e => e.currentTarget.style.background='#f0e6ec'}
                                                    onMouseLeave={e => e.currentTarget.style.background=''}
                                                    onClick={() => openWorkerDetail(w.matricule)}>
                                                    <td style={{fontFamily:'monospace',fontWeight:600}}>{w.matricule}</td>
                                                    <td style={{fontWeight:500}}><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                                    <td>{new Date(w.firstDate).toLocaleDateString('fr-FR')}</td>
                                                    <td><span className="status-badge" style={{background: w.ferme==='F1' ? 'rgba(139,34,82,0.1)' : w.ferme==='F5' ? 'rgba(45,139,78,0.1)' : 'rgba(212,168,71,0.1)', color: w.ferme==='F1' ? 'var(--berry)' : w.ferme==='F5' ? 'var(--green)' : 'var(--gold)', fontSize:10}}>{w.ferme}</span></td>
                                                    <td style={{fontSize:11,color:'var(--gray-600)'}}>{w.equipe}</td>
                                                    <td style={{fontSize:11,color:'var(--gray-400)'}}>{w.operationFamille}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <div style={{fontSize:10,color:'var(--gray-400)',marginTop:6,textAlign:'center'}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>Cliquez sur un ouvrier pour voir le détail BEE ONE</div>
                                    </React.Fragment>}
                                </Panel>
                            </div>
                        );
                    })()}

                    <div className="two-col">
                        <Panel title="Top Opérations Hors Récolte" icon="fa-ranking-star">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Opération</th>
                                        <th>Parcelle</th>
                                        <th>{farmFilter === 'Avocatier' ? 'Parcelle' : farmFilter ? 'Équipe(s)' : 'Ferme'}</th>
                                        <th>Effectif</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topOps.map((op, i) => (
                                        <tr key={i}>
                                            <td><span className={`rank ${i < 3 ? `rank-${i+1}` : 'rank-other'}`}>{i+1}</span></td>
                                            <td style={{fontWeight: 500}}>{op.operation}</td>
                                            <td style={{fontSize:'11px', color:'var(--gray-400)'}}>{displayParcelle(op.parcelle)}</td>
                                            <td>{farmFilter === 'Avocatier' && op.parcRefs && op.parcRefs.length > 0
                                                ? <span style={{fontSize:11,fontWeight:600,color:'var(--green)'}}>{op.parcRefs.join(', ')}</span>
                                                : farmFilter && op.equipes && op.equipes.length > 0
                                                ? <span style={{fontSize:11,fontWeight:600,color:'var(--blue)'}}>{op.equipes.join(', ')}</span>
                                                : <span className="status-badge" style={{background:'var(--berry-pale)',color:'var(--berry)',fontSize:10}}>{op.ferme}</span>
                                            }</td>
                                            <td><strong>{op.effectif}</strong></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>

                        <Panel title="Tendance Effectif Semaine" icon="fa-chart-line">
                            <SimpleAreaChart data={weeklyTrend} dataKeys={farms} colors={COLORS} xKey="jour" height={220} />
                        </Panel>
                    </div>

                    {!farmFilter && (
                        <Panel title="Répartition par Ferme" icon="fa-chart-pie">
                            <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'40px', flexWrap:'wrap'}}>
                                <SimplePieChart data={pieData} colors={COLORS} size={200} />
                                <div>
                                    {pieData.map((d, i) => (
                                        <div key={i} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px'}}>
                                            <div style={{width:12, height:12, borderRadius:3, background:COLORS[i]}}></div>
                                            <span style={{fontSize:13}}><strong>{d.name}</strong>: {d.value} ouvriers</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Panel>
                    )}

                    {/* ===== INSPECTIONS QUALITÉ (Chef de Ferme F1/F5) ===== */}
                    {farmFilter && farmFilter !== 'Avocatier' && <ChefInspectionsPanel farmFilter={farmFilter} />}

                    {/* ===== PERFORMANCE PAR BLOC ID (Chef de Ferme F1/F5) ===== */}
                    {farmFilter && farmFilter !== 'Avocatier' && <ChefBlocPerformancePanel data={data} farmFilter={farmFilter} />}

                    {/* ===== AVANCEMENT HORS RÉCOLTE (Chef de Ferme) ===== */}
                    {farmFilter && farmFilter !== 'Avocatier' && <ChefHorsRecoltePanel data={data} farmFilter={farmFilter} />}

                    {/* ===== PERFORMANCE HORS RÉCOLTE (Chef de Ferme) ===== */}
                    {farmFilter && (() => {
                        const hrRows = detailRows.filter(r => r.type === 'horsRecolte' && r.ferme === farmFilter && matchSub(r));
                        if (hrRows.length === 0) return null;
                        const normesArr = data.normesProductivite || [];
                        const byOpParc = {};
                        hrRows.forEach(r => {
                            const op = r.operation || 'Autre';
                            const parc = (r.parcelle || '').trim();
                            const key = `${op}__${parc}`;
                            if (!byOpParc[key]) byOpParc[key] = { operation: op, parcelle: parc, ferme: r.ferme, workers: new Set(), heures: 0, quantite: 0, cout: 0 };
                            byOpParc[key].workers.add(r.matricule);
                            byOpParc[key].heures += (r.heures || 0);
                            byOpParc[key].quantite += (r.quantite || 0);
                            byOpParc[key].cout += (r.cout || 0);
                        });
                        const hrStats = Object.values(byOpParc).map(o => ({ ...o, nbOuvriers: o.workers.size })).sort((a, b) => b.nbOuvriers - a.nbOuvriers);
                        const hrWithNorme = hrStats.map(row => {
                            const norme = normesArr.find(n => n.tache === row.operation);
                            const normeVal = norme ? norme.normeTunnelsParJourParOuvrier : 0;
                            const attendu = normeVal * row.nbOuvriers;
                            const realise = row.quantite;
                            const rendPct = attendu > 0 ? Math.round(realise / attendu * 100) : 0;
                            return { ...row, normeVal, attendu, realise, rendPct };
                        });
                        const totalOuv = new Set(hrRows.map(r => r.matricule)).size;
                        const totalCoutHR = hrRows.reduce((s, r) => s + (r.cout || 0), 0);
                        return (
                            <Panel title="Performance Hors Récolte" icon="fa-trowel">
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:10,marginBottom:16}}>
                                    <div style={{background:'var(--berry-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Effectif</div>
                                        <div style={{fontSize:20,fontWeight:800,color:'var(--berry)'}}>{totalOuv}</div>
                                    </div>
                                    <div style={{background:'#fff3e0',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Opérations</div>
                                        <div style={{fontSize:20,fontWeight:800,color:'#e65100'}}>{hrStats.length}</div>
                                    </div>
                                    <div style={{background:'#e8f4fd',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Coût Total</div>
                                        <div style={{fontSize:20,fontWeight:800,color:'#1565C0'}}>{Math.round(totalCoutHR).toLocaleString('fr-FR')} DH</div>
                                    </div>
                                </div>
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead><tr><th>Opération</th><th>Parcelle</th><th style={{textAlign:'center'}}>Ouv.</th><th style={{textAlign:'right'}}>Réalisé</th><th style={{textAlign:'right'}}>Norme</th><th style={{textAlign:'right'}}>Attendu</th><th style={{width:130}}>Rendement</th></tr></thead>
                                    <tbody>
                                        {hrWithNorme.map((r, i) => {
                                            const barPct = Math.min(100, r.rendPct);
                                            return (
                                                <tr key={i}>
                                                    <td style={{fontWeight:600}}>{r.operation}</td>
                                                    <td style={{fontSize:10,color:'var(--gray-500)'}}>{displayParcelle(r.parcelle) || '—'}</td>
                                                    <td style={{textAlign:'center'}}><span className="status-badge" style={{fontSize:10}}>{r.nbOuvriers}</span></td>
                                                    <td style={{textAlign:'right',fontWeight:700,color:'var(--orange)'}}>{Math.round(r.realise)}</td>
                                                    <td style={{textAlign:'right',color:'var(--gray-400)'}}>{r.normeVal || '—'}</td>
                                                    <td style={{textAlign:'right',color:'var(--gray-500)'}}>{r.attendu > 0 ? Math.round(r.attendu) : '—'}</td>
                                                    <td style={{width:130}}>
                                                        {r.attendu > 0 ? (
                                                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                                                                <div style={{flex:1,position:'relative',height:10}}>
                                                                    <div style={{position:'absolute',top:1,left:0,right:0,height:8,background:'var(--gray-100)',borderRadius:4}}></div>
                                                                    <div style={{position:'absolute',top:1,left:0,width:`${barPct}%`,height:8,borderRadius:4,transition:'width 0.3s',
                                                                        background: r.rendPct >= 100 ? 'var(--green)' : r.rendPct >= 80 ? 'var(--blue)' : r.rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}></div>
                                                                </div>
                                                                <span style={{fontSize:10,fontWeight:700,minWidth:32,textAlign:'right',
                                                                    color: r.rendPct >= 100 ? 'var(--green)' : r.rendPct >= 80 ? 'var(--blue)' : r.rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>{r.rendPct}%</span>
                                                            </div>
                                                        ) : <span style={{color:'var(--gray-300)',fontSize:10}}>—</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </Panel>
                        );
                    })()}

                    {/* ===== RENDEMENTS RÉCOLTE ===== */}
                    {(() => {
                        if (recolteWorkers.length === 0) return null;
                        const resolveCultureChef = (w) => {
                            const parcelle = (w.parcelle || '').toLowerCase();
                            const pc = data.parcelleConfig || {};
                            for (const farm of Object.keys(pc)) {
                                for (const p of pc[farm]) {
                                    if (parcelle && (parcelle.includes(p.nom.toLowerCase()) || parcelle.includes(p.variete.toLowerCase()))) return p.culture;
                                }
                            }
                            return data.getCultureForVariete(w.variete);
                        };
                        const rw = recolteWorkers.map(w => {
                            const culture = resolveCultureChef(w);
                            const isMyrt = /myrtille/i.test(culture);
                            return { ...w, kilos: w.quantite || 0, prime: calcPrime(w.quantite || 0, isMyrt ? 'myrtille' : w.variete, w.jour), culture, equipe: getEqPrefix(w.matricule) };
                        });
                        // Filter out Maravilla Long Cane from 1st cycle (Sep-Dec) for F1
                        const isLongCaneCycle1 = (r) => {
                            if (farmFilter !== 'F1') return false;
                            if (!(r.variete || '').includes('Long Cane') && !(r.variete || '').includes('MOTTE')) return false;
                            const month = new Date().getMonth(); // 0-indexed
                            return month >= 8 && month <= 11; // Sep(8) to Dec(11)
                        };
                        const filtered = (farmFilter ? rw.filter(r => r.ferme === farmFilter && matchSub(r) && matchCulture(r, cultureFilter)) : rw).filter(r => !isLongCaneCycle1(r));
                        const filteredCu = (farmFilter ? recolteCueillette.filter(c => c.ferme === farmFilter && matchSub(c) && matchCulture(c, cultureFilter)) : recolteCueillette).filter(c => !isLongCaneCycle1(c));
                        const isChefDash = currentProfile && currentProfile.startsWith('chef_');
                        const totalKg = isChefDash
                            ? recolteEquipeRows.filter(r => r.ferme === farmFilter && matchSub(r) && matchCulture(r, cultureFilter) && r.jour === new Date().toISOString().slice(0,10)).reduce((s, r) => s + (r.kg || 0), 0)
                            : (filteredCu.length > 0 ? filteredCu.reduce((s, c) => s + c.totalKg, 0) : filtered.reduce((s, r) => s + r.kilos, 0));
                        const totalPrimes = filtered.reduce((s, r) => s + r.prime, 0);
                        // Ouvriers primés = matricules DISTINCTS ayant au moins une prime > 0
                        // (cohérent avec le dénominateur distinct ci-dessous).
                        const nbPrimes = new Set(filtered.filter(r => r.prime > 0).map(r => r.matricule)).size;

                        // Effectif récolte = matricules DISTINCTS (un ouvrier multi-parcelles compte 1×).
                        // Kg/prime restent des SOMMES (inchangé).
                        const distinctOuvFiltered = RecolteKpiUtils
                            ? RecolteKpiUtils.distinctOuvriersFromRows(filtered)
                            : new Set(filtered.map(r => r.matricule)).size;

                        // By Ferme + Variété
                        const byFermeVar = {};
                        filtered.forEach(r => {
                            const v = (r.variete || 'N/A').trim();
                            const key = r.ferme + '|' + v;
                            if (!byFermeVar[key]) byFermeVar[key] = { ferme: r.ferme, variete: v, _mats: new Set(), nbOuv: 0, totalKg: 0, totalPrime: 0 };
                            byFermeVar[key]._mats.add(r.matricule);
                            byFermeVar[key].nbOuv = byFermeVar[key]._mats.size;
                            byFermeVar[key].totalKg += r.kilos;
                            byFermeVar[key].totalPrime += r.prime;
                        });
                        if (filteredCu.length > 0) {
                            filteredCu.forEach(c => {
                                const v = (c.variete || 'N/A').trim();
                                const key = c.ferme + '|' + v;
                                if (byFermeVar[key]) byFermeVar[key].totalKg = c.totalKg;
                            });
                        }
                        const fermeStats = Object.values(byFermeVar).sort((a, b) => a.ferme.localeCompare(b.ferme) || b.totalKg - a.totalKg);

                        // By Équipe — nbOuv = matricules DISTINCTS (kg/prime = sommes inchangées)
                        const byEquipe = {};
                        filtered.forEach(r => {
                            const eq = r.equipe || 'NV';
                            if (!byEquipe[eq]) byEquipe[eq] = { prefix: eq, nom: eqNames[eq] || eq, _mats: new Set(), nbOuv: 0, totalKg: 0, totalPrime: 0 };
                            byEquipe[eq]._mats.add(r.matricule);
                            byEquipe[eq].nbOuv = byEquipe[eq]._mats.size;
                            byEquipe[eq].totalKg += r.kilos;
                            byEquipe[eq].totalPrime += r.prime;
                        });
                        const equipeStats = Object.values(byEquipe).sort((a, b) => b.totalKg - a.totalKg);

                        // By Parcelle (from cueillette if available)
                        let parcStats;
                        if (filteredCu.length > 0) {
                            parcStats = filteredCu.map(c => ({
                                parcelle: c.parcelle, ferme: c.ferme, totalKg: c.totalKg, totalCaisses: c.totalCaisses,
                                nbOuv: new Set(filtered.filter(r => r.parcelle === c.parcelle).map(r => r.matricule)).size,
                            })).sort((a, b) => b.totalKg - a.totalKg);
                        } else {
                            const pMap = {};
                            filtered.forEach(r => {
                                const key = r.parcelle || 'N/A';
                                if (!pMap[key]) pMap[key] = { parcelle: key, ferme: r.ferme, _mats: new Set(), nbOuv: 0, totalKg: 0 };
                                pMap[key]._mats.add(r.matricule);
                                pMap[key].nbOuv = pMap[key]._mats.size;
                                pMap[key].totalKg += r.kilos;
                            });
                            parcStats = Object.values(pMap).sort((a, b) => b.totalKg - a.totalKg);
                        }
                        const maxKgEquipe = equipeStats.length > 0 ? equipeStats[0].totalKg : 1;

                        return (
                            <div>
                                <div className="kpi-grid" style={{marginBottom:16}}>
                                    <KPICard icon="fa-basket-shopping" iconClass="berry" value={Math.round(totalKg).toLocaleString('fr-FR')} label="Total Kg Récolte" />
                                    <KPICard icon="fa-users" iconClass="green" value={distinctOuvFiltered} label="Ouvriers Récolte" />
                                    <KPICard icon="fa-coins" iconClass="orange" value={Math.round(totalPrimes).toLocaleString('fr-FR')} label="Primes Récolte (DH)" />
                                    <KPICard icon="fa-medal" iconClass="yellow" value={nbPrimes + '/' + distinctOuvFiltered} label="Ouvriers Primés" onClick={() => setShowPrimeTrend(!showPrimeTrend)} />
                                </div>

                                {showPrimeTrend && (() => {
                                    // Compute % ouvriers avec prime per day — last 7 available days from data
                                    const allEqRows = farmFilter ? recolteEquipeRows.filter(r => r.ferme === farmFilter && matchSub(r) && matchCulture(r, cultureFilter)) : recolteEquipeRows;
                                    const allDates = [...new Set(allEqRows.map(r => r.jour))].sort().reverse().slice(0, 7).reverse();
                                    const todayStr = new Date().toISOString().slice(0, 10);

                                    // Use consistent source (equipeRows) for all days, exclude logistics
                                    const logOpsChef = /caporal|conditionnement|encadrement|chargement/i;
                                    const trendData = allDates.map(date => {
                                        const dayRows = allEqRows.filter(r => r.jour === date && !logOpsChef.test(r.operation || ''));
                                        const byW = {};
                                        dayRows.forEach(r => {
                                            const k = r.matricule || r.nom;
                                            if (!byW[k]) byW[k] = { kg: 0, parcelle: r.parcelle, variete: r.variete };
                                            byW[k].kg += r.kg || 0;
                                        });
                                        const allWorkers = Object.values(byW);
                                        const total = allWorkers.length;
                                        const withPrime = allWorkers.filter(w => {
                                            if (w.kg <= 0) return false;
                                            const parcelle = (w.parcelle || '').toLowerCase();
                                            const pc = data.parcelleConfig || {};
                                            let culture = null;
                                            for (const farm of Object.keys(pc)) {
                                                for (const p of pc[farm]) {
                                                    if (parcelle && (parcelle.includes(p.nom.toLowerCase()) || parcelle.includes(p.variete.toLowerCase()))) { culture = p.culture; break; }
                                                }
                                                if (culture) break;
                                            }
                                            if (!culture) culture = data.getCultureForVariete(w.variete);
                                            const isMyrt = /myrtille/i.test(culture);
                                            return calcPrime(w.kg, isMyrt ? 'myrtille' : w.variete, w.jour) > 0;
                                        }).length;
                                        const pct = total > 0 ? Math.round(withPrime / total * 100) : 0;
                                        const label = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short', day:'numeric'});
                                        return { date, label, pct, withPrime, total };
                                    });

                                    return (
                                        <div className="fade-in" style={{background:'var(--gray-50)',borderRadius:12,padding:16,marginBottom:16,border:'1px solid var(--gray-200)'}}>
                                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                                                <h4 style={{margin:0,fontSize:14,fontWeight:700,color:'var(--berry)'}}>
                                                    <i className="fa-solid fa-chart-line" style={{marginRight:6}}></i>% Ouvriers avec Prime — 7 derniers jours
                                                </h4>
                                                <button onClick={() => setShowPrimeTrend(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:16}}><i className="fa-solid fa-xmark"></i></button>
                                            </div>
                                            {trendData.length === 0 ? (
                                                <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}>Pas de données disponibles</div>
                                            ) : (
                                                <div>
                                                    <div style={{display:'flex',alignItems:'flex-end',gap:8,height:180,padding:'0 10px'}}>
                                                        {trendData.map((d, i) => {
                                                            const isToday = d.date === todayStr;
                                                            const barColor = d.pct >= 50 ? 'var(--green)' : d.pct >= 30 ? 'var(--orange)' : 'var(--red)';
                                                            return (
                                                                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                                                                    <span style={{fontSize:11,fontWeight:700,color: isToday ? 'var(--berry)' : 'var(--gray-600)'}}>{d.pct}%</span>
                                                                    <div style={{width:'100%',maxWidth:50,background:barColor,borderRadius:'6px 6px 0 0',height: Math.max(8, d.pct * 1.4),transition:'height 0.3s',opacity: isToday ? 1 : 0.75}}></div>
                                                                    <span style={{fontSize:9,color: isToday ? 'var(--berry)' : 'var(--gray-400)',fontWeight: isToday ? 700 : 400}}>{d.label}</span>
                                                                    <span style={{fontSize:8,color:'var(--gray-400)'}}>{d.withPrime}/{d.total}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <div style={{display:'flex',justifyContent:'center',gap:16,marginTop:12,fontSize:10,color:'var(--gray-500)'}}>
                                                        <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--green)',marginRight:4}}></span>≥ 50%</span>
                                                        <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--orange)',marginRight:4}}></span>30-49%</span>
                                                        <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--red)',marginRight:4}}></span>&lt; 30%</span>
                                                        <span style={{marginLeft:8}}>Seuil: 🍓 20 kg | 🫐 30 kg</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="two-col">
                                    <Panel title="Rendement par Équipe" icon="fa-users">
                                        <table className="data-table">
                                            <thead><tr><th>Équipe</th><th>Chef</th><th>Ouvriers</th><th>Total Kg</th><th>Moy/Ouv</th><th style={{width:160}}>Rendement</th></tr></thead>
                                            <tbody>
                                                {equipeStats.map((eq, i) => {
                                                    const avg = eq.nbOuv > 0 ? Math.round(eq.totalKg / eq.nbOuv * 10) / 10 : 0;
                                                    const maxScale = 35;
                                                    const barPct = Math.min(100, Math.round(avg / maxScale * 100));
                                                    const mark20 = Math.round(20 / maxScale * 100);
                                                    const mark25 = Math.round(25 / maxScale * 100);
                                                    const mark30 = Math.round(30 / maxScale * 100);
                                                    const barColor = avg >= 30 ? 'var(--green)' : avg >= 25 ? '#2ecc71' : avg >= 20 ? 'var(--orange)' : 'var(--red)';
                                                    return (
                                                        <tr key={i}>
                                                            <td><strong style={{fontFamily:'monospace'}}>{eq.prefix}</strong></td>
                                                            <td style={{fontWeight:600,fontSize:12}}>{eq.nom}</td>
                                                            <td>{eq.nbOuv}</td>
                                                            <td><strong>{Math.round(eq.totalKg)}</strong></td>
                                                            <td style={{color:'var(--berry)',fontWeight:700}}>{avg} kg</td>
                                                            <td style={{width:160}}>
                                                                <div style={{position:'relative',height:20}}>
                                                                    {/* Background track */}
                                                                    <div style={{position:'absolute',top:6,left:0,right:0,height:8,background:'var(--gray-100)',borderRadius:4}}></div>
                                                                    {/* Filled bar */}
                                                                    <div style={{position:'absolute',top:6,left:0,width:`${barPct}%`,height:8,background:barColor,borderRadius:4,transition:'width 0.3s'}}></div>
                                                                    {/* 20kg marker */}
                                                                    <div style={{position:'absolute',left:`${mark20}%`,top:0,height:20,width:1,background:'var(--orange)',opacity:0.6}}></div>
                                                                    <div style={{position:'absolute',left:`${mark20}%`,top:-1,fontSize:7,color:'var(--orange)',fontWeight:700,transform:'translateX(-50%)'}}>20</div>
                                                                    {/* 25kg marker */}
                                                                    <div style={{position:'absolute',left:`${mark25}%`,top:4,height:12,width:1,background:'var(--gray-300)',opacity:0.5}}></div>
                                                                    {/* 30kg marker */}
                                                                    <div style={{position:'absolute',left:`${mark30}%`,top:0,height:20,width:1,background:'var(--green)',opacity:0.6}}></div>
                                                                    <div style={{position:'absolute',left:`${mark30}%`,top:-1,fontSize:7,color:'var(--green)',fontWeight:700,transform:'translateX(-50%)'}}>30</div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </Panel>

                                    <Panel title="Rendement par Ferme" icon="fa-leaf">
                                        <table className="data-table">
                                            <thead><tr><th>Ferme</th><th>Variété</th><th>Culture</th><th>Ouvriers</th><th>Total Kg</th><th>Moy/Ouv</th><th>Primes (DH)</th></tr></thead>
                                            <tbody>
                                                {fermeStats.map((f, i) => {
                                                    const avg = f.nbOuv > 0 ? Math.round(f.totalKg / f.nbOuv * 10) / 10 : 0;
                                                    return (
                                                        <tr key={i}>
                                                            <td><span className="status-badge" style={{background: f.ferme==='F1' ? 'var(--berry-pale)' : (f.ferme==='F5' ? 'var(--green-pale)' : 'var(--orange-pale)'), color: f.ferme==='F1' ? 'var(--berry)' : (f.ferme==='F5' ? 'var(--green)' : 'var(--orange)'), fontSize:11}}>{f.ferme}</span></td>
                                                            <td style={{fontSize:11,fontWeight:500}}>{f.variete}</td>
                                                            <td>{(() => { const c = data.getCultureForVariete(f.variete); return <span style={{fontSize:10, fontWeight:600, color: c === 'Myrtille' ? '#5B6ABF' : 'var(--berry)'}}>{c === 'Myrtille' ? '🫐' : '🍓'} {c}</span>; })()}</td>
                                                            <td>{f.nbOuv}</td>
                                                            <td><strong>{Math.round(f.totalKg)}</strong></td>
                                                            <td style={{color:'var(--berry)',fontWeight:700}}>{avg} kg</td>
                                                            <td style={{color:'var(--green)',fontWeight:600}}>{Math.round(f.totalPrime).toLocaleString('fr-FR')}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </Panel>
                                </div>

                                {parcStats.length > 0 && (
                                <Panel title="Rendement par Parcelle" icon="fa-chart-bar">
                                    <div className="table-responsive">
                                    <table className="data-table">
                                        <thead><tr><th>Parcelle</th><th>Ferme</th><th>Ouvriers</th><th>Total Kg</th><th>Moy/Ouv</th><th style={{width:160}}>Rendement</th></tr></thead>
                                        <tbody>
                                            {parcStats.slice(0, 15).map((p, i) => {
                                                const avg = p.nbOuv > 0 ? Math.round(p.totalKg / p.nbOuv * 10) / 10 : 0;
                                                const maxScale = 35;
                                                const barPct = Math.min(100, Math.round(avg / maxScale * 100));
                                                const mark20 = Math.round(20 / maxScale * 100);
                                                const mark25 = Math.round(25 / maxScale * 100);
                                                const mark30 = Math.round(30 / maxScale * 100);
                                                const barColor = avg >= 30 ? 'var(--green)' : avg >= 25 ? '#2ecc71' : avg >= 20 ? 'var(--orange)' : 'var(--red)';
                                                return (
                                                    <tr key={i}>
                                                        <td style={{fontWeight:500,fontSize:12}}>{p.parcelle}</td>
                                                        <td><span className="status-badge" style={{background: p.ferme==='F1' ? 'var(--berry-pale)' : (p.ferme==='F5' ? 'var(--green-pale)' : 'var(--orange-pale)'), color: p.ferme==='F1' ? 'var(--berry)' : (p.ferme==='F5' ? 'var(--green)' : 'var(--orange)'), fontSize:10}}>{p.ferme}</span></td>
                                                        <td>{p.nbOuv}</td>
                                                        <td><strong>{Math.round(p.totalKg)}</strong></td>
                                                        <td style={{color:'var(--berry)',fontWeight:700}}>{avg} kg</td>
                                                        <td style={{width:160}}>
                                                            <div style={{position:'relative',height:20}}>
                                                                <div style={{position:'absolute',top:6,left:0,right:0,height:8,background:'var(--gray-100)',borderRadius:4}}></div>
                                                                <div style={{position:'absolute',top:6,left:0,width:`${barPct}%`,height:8,background:barColor,borderRadius:4,transition:'width 0.3s'}}></div>
                                                                <div style={{position:'absolute',left:`${mark20}%`,top:0,height:20,width:1,background:'var(--orange)',opacity:0.6}}></div>
                                                                <div style={{position:'absolute',left:`${mark20}%`,top:-1,fontSize:7,color:'var(--orange)',fontWeight:700,transform:'translateX(-50%)'}}>20</div>
                                                                <div style={{position:'absolute',left:`${mark25}%`,top:4,height:12,width:1,background:'var(--gray-300)',opacity:0.5}}></div>
                                                                <div style={{position:'absolute',left:`${mark30}%`,top:0,height:20,width:1,background:'var(--green)',opacity:0.6}}></div>
                                                                <div style={{position:'absolute',left:`${mark30}%`,top:-1,fontSize:7,color:'var(--green)',fontWeight:700,transform:'translateX(-50%)'}}>30</div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>
                                )}
                            </div>
                        );
                    })()}

                    {/* ===== PERFORMANCE HORS RÉCOLTE ===== */}
                    {(() => {
                        // Filter hors-récolte workers from detailRows
                        const hrRows = detailRows.filter(r => r.type === 'horsRecolte' && (!farmFilter || r.ferme === farmFilter) && matchSub(r));
                        if (hrRows.length === 0) return null;

                        const normesArr = data.normesProductivite || [];
                        const pcConfig = data.parcelleConfig || {};

                        // Group by operation + parcelle
                        const byOpParc = {};
                        hrRows.forEach(r => {
                            const op = r.operation || 'Autre';
                            const parc = (r.parcelle || '').trim();
                            const key = `${op}__${parc}`;
                            if (!byOpParc[key]) byOpParc[key] = { operation: op, parcelle: parc, ferme: r.ferme, workers: new Set(), heures: 0, quantite: 0, cout: 0 };
                            byOpParc[key].workers.add(r.matricule);
                            byOpParc[key].heures += (r.heures || 0);
                            byOpParc[key].quantite += (r.quantite || 0);
                            byOpParc[key].cout += (r.cout || 0);
                        });
                        const hrStats = Object.values(byOpParc).map(o => ({
                            ...o,
                            nbOuvriers: o.workers.size,
                        })).sort((a, b) => b.nbOuvriers - a.nbOuvriers);

                        // Compute norme-based performance
                        const hrWithNorme = hrStats.map(row => {
                            const norme = normesArr.find(n => n.tache === row.operation);
                            const normeVal = norme ? norme.normeTunnelsParJourParOuvrier : 0;
                            const attendu = normeVal * row.nbOuvriers;
                            const realise = row.quantite;
                            const rendPct = attendu > 0 ? Math.round(realise / attendu * 100) : 0;
                            return { ...row, normeVal, attendu, realise, rendPct };
                        });

                        const totalOuv = new Set(hrRows.map(r => r.matricule)).size;
                        const totalCoutHR = hrRows.reduce((s, r) => s + (r.cout || 0), 0);

                        return (
                            <Panel title="Performance Hors Récolte" icon="fa-trowel">
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:10,marginBottom:16}}>
                                    <div style={{background:'var(--berry-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Effectif</div>
                                        <div style={{fontSize:20,fontWeight:800,color:'var(--berry)'}}>{totalOuv}</div>
                                    </div>
                                    <div style={{background:'#fff3e0',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Opérations</div>
                                        <div style={{fontSize:20,fontWeight:800,color:'#e65100'}}>{hrStats.length}</div>
                                    </div>
                                    <div style={{background:'#e8f4fd',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Coût Total</div>
                                        <div style={{fontSize:20,fontWeight:800,color:'#1565C0'}}>{Math.round(totalCoutHR).toLocaleString('fr-FR')} DH</div>
                                    </div>
                                </div>
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead>
                                        <tr>
                                            <th>Opération</th>
                                            <th>Parcelle</th>
                                            <th style={{textAlign:'center'}}>Ouv.</th>
                                            <th style={{textAlign:'right'}}>Réalisé</th>
                                            <th style={{textAlign:'right'}}>Norme</th>
                                            <th style={{textAlign:'right'}}>Attendu</th>
                                            <th style={{width:130}}>Rendement</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {hrWithNorme.map((r, i) => {
                                            const barPct = Math.min(100, r.rendPct);
                                            return (
                                                <tr key={i}>
                                                    <td style={{fontWeight:600}}>{r.operation}</td>
                                                    <td style={{fontSize:10,color:'var(--gray-500)'}}>{displayParcelle(r.parcelle) || '—'}</td>
                                                    <td style={{textAlign:'center'}}><span className="status-badge" style={{fontSize:10}}>{r.nbOuvriers}</span></td>
                                                    <td style={{textAlign:'right',fontWeight:700,color:'var(--orange)'}}>{Math.round(r.realise)}</td>
                                                    <td style={{textAlign:'right',color:'var(--gray-400)'}}>{r.normeVal || '—'}</td>
                                                    <td style={{textAlign:'right',color:'var(--gray-500)'}}>{r.attendu > 0 ? Math.round(r.attendu) : '—'}</td>
                                                    <td style={{width:130}}>
                                                        {r.attendu > 0 ? (
                                                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                                                                <div style={{flex:1,position:'relative',height:10}}>
                                                                    <div style={{position:'absolute',top:1,left:0,right:0,height:8,background:'var(--gray-100)',borderRadius:4}}></div>
                                                                    <div style={{position:'absolute',top:1,left:0,width:`${barPct}%`,height:8,borderRadius:4,transition:'width 0.3s',
                                                                        background: r.rendPct >= 100 ? 'var(--green)' : r.rendPct >= 80 ? 'var(--blue)' : r.rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}></div>
                                                                </div>
                                                                <span style={{fontSize:10,fontWeight:700,minWidth:32,textAlign:'right',
                                                                    color: r.rendPct >= 100 ? 'var(--green)' : r.rendPct >= 80 ? 'var(--blue)' : r.rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>{r.rendPct}%</span>
                                                            </div>
                                                        ) : <span style={{color:'var(--gray-300)',fontSize:10}}>—</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </Panel>
                        );
                    })()}

                    {/* Worker loading indicator */}
                    {workerLoading && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.3)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
                            <div style={{background:'#fff',borderRadius:12,padding:30,textAlign:'center',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                <i className="fa-solid fa-spinner fa-spin fa-2x" style={{color:'var(--berry)'}}></i>
                                <div style={{marginTop:12,fontWeight:600}}>Chargement fiche ouvrier...</div>
                            </div>
                        </div>
                    )}

                    {/* KPI Detail Popup */}
                    {kpiPopup && (() => {
                        const rows = detailRows.filter(r => {
                            if (kpiPopup.ferme && r.ferme !== kpiPopup.ferme) return false;
                            if (kpiPopup.type === 'recolte') return r.type === 'recolte';
                            if (kpiPopup.type === 'horsRecolte') return r.type === 'horsRecolte';
                            if (kpiPopup.type === 'postesFixes') return r.type === 'postesFixes';
                            return true; // 'all'
                        });

                        // Group by operation
                        const byOp = {};
                        rows.forEach(r => {
                            const op = r.operation || 'Autre';
                            if (!byOp[op]) byOp[op] = { operation: op, effectif: new Set(), heures: 0, cout: 0, parcelles: new Set() };
                            byOp[op].effectif.add(r.matricule);
                            byOp[op].heures += (r.heures || 0);
                            byOp[op].cout += (r.cout || 0);
                            if (r.parcelle) byOp[op].parcelles.add(r.parcelle.trim());
                        });
                        const opRows = Object.values(byOp).map(o => ({ ...o, effectif: o.effectif.size, parcelles: [...o.parcelles] })).sort((a, b) => b.effectif - a.effectif);

                        // Group by equipe
                        const byEq = {};
                        rows.forEach(r => {
                            const eq = eqNames[getEqPrefix(r.matricule)] || getEqPrefix(r.matricule) || 'Autre';
                            if (!byEq[eq]) byEq[eq] = { equipe: eq, effectif: new Set(), heures: 0, cout: 0 };
                            byEq[eq].effectif.add(r.matricule);
                            byEq[eq].heures += (r.heures || 0);
                            byEq[eq].cout += (r.cout || 0);
                        });
                        const eqRows = Object.values(byEq).map(o => ({ ...o, effectif: o.effectif.size })).sort((a, b) => b.effectif - a.effectif);

                        const totalCoutPopup = rows.reduce((s, r) => s + (r.cout || 0), 0);
                        const totalHeuresPopup = rows.reduce((s, r) => s + (r.heures || 0), 0);
                        const uniqueWorkers = new Set(rows.map(r => r.matricule)).size;

                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setKpiPopup(null)}>
                                <div style={{background:'#fff',borderRadius:16,maxWidth:750,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                    <div style={{padding:'20px 24px',background:'linear-gradient(135deg, var(--berry) 0%, #6b1a3a 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                        <div>
                                            <div style={{fontSize:18,fontWeight:700}}><i className={`fa-solid ${kpiPopup.icon || 'fa-users'}`} style={{marginRight:8}}></i>{kpiPopup.title}</div>
                                            <div style={{fontSize:12,opacity:0.85,marginTop:4}}>{apiData.date} — {uniqueWorkers} ouvriers</div>
                                        </div>
                                        <button onClick={() => setKpiPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>

                                    <div style={{padding:'16px 24px',display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:12}}>
                                        <div style={{background:'var(--berry-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                            <div style={{fontSize:10,color:'var(--gray-500)'}}>Effectif</div>
                                            <div style={{fontSize:20,fontWeight:800,color:'var(--berry)'}}>{uniqueWorkers}</div>
                                        </div>
                                        <div style={{background:'#e8f4fd',borderRadius:10,padding:12,textAlign:'center'}}>
                                            <div style={{fontSize:10,color:'var(--gray-500)'}}>Total Heures</div>
                                            <div style={{fontSize:20,fontWeight:800,color:'#1565C0'}}>{Math.round(totalHeuresPopup)}h</div>
                                        </div>
                                        <div style={{background:'#fff3e0',borderRadius:10,padding:12,textAlign:'center'}}>
                                            <div style={{fontSize:10,color:'var(--gray-500)'}}>Coût Total</div>
                                            <div style={{fontSize:20,fontWeight:800,color:'#e65100'}}>{Math.round(totalCoutPopup).toLocaleString('fr-FR')} DH</div>
                                        </div>
                                    </div>

                                    <div style={{padding:'0 24px 16px'}}>
                                        <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:'var(--dark)'}}>
                                            <i className="fa-solid fa-list-check" style={{marginRight:6,color:'var(--berry)'}}></i>Détail par Opération
                                        </div>
                                        <table className="data-table" style={{fontSize:11}}>
                                            <thead>
                                                <tr>
                                                    <th>Opération</th>
                                                    <th style={{textAlign:'center'}}>Effectif</th>
                                                    <th style={{textAlign:'right'}}>Heures</th>
                                                    <th style={{textAlign:'right'}}>Coût (DH)</th>
                                                    <th>Parcelles</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {opRows.map((r, i) => (
                                                    <tr key={i}>
                                                        <td style={{fontWeight:600}}>{r.operation}</td>
                                                        <td style={{textAlign:'center'}}><span className="status-badge" style={{fontSize:10}}>{r.effectif}</span></td>
                                                        <td style={{textAlign:'right'}}>{Math.round(r.heures)}</td>
                                                        <td style={{textAlign:'right',fontWeight:600}}>{Math.round(r.cout).toLocaleString('fr-FR')}</td>
                                                        <td style={{fontSize:9,color:'var(--gray-400)',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.parcelles.map(displayParcelle).join(', ')}>{r.parcelles.slice(0,3).map(displayParcelle).join(', ')}{r.parcelles.length > 3 ? '...' : ''}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div style={{padding:'0 24px 20px'}}>
                                        <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:'var(--dark)'}}>
                                            <i className="fa-solid fa-users" style={{marginRight:6,color:'var(--blue)'}}></i>Répartition par Équipe
                                        </div>
                                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                            {eqRows.map((eq, i) => (
                                                <div key={i} style={{padding:'8px 14px',background:'var(--gray-50)',borderRadius:10,border:'1px solid var(--gray-100)',textAlign:'center',minWidth:80}}>
                                                    <div style={{fontSize:12,fontWeight:700,color:'var(--berry)'}}>{eq.effectif}</div>
                                                    <div style={{fontSize:9,color:'var(--gray-500)',marginTop:2}}>{eq.equipe}</div>
                                                    <div style={{fontSize:9,color:'var(--gray-400)'}}>{Math.round(eq.cout).toLocaleString('fr-FR')} DH</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Worker detail popup */}
                    {workerPopup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setWorkerPopup(null)}>
                            <div style={{background:'#fff',borderRadius:16,maxWidth:700,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                {/* Header */}
                                <div style={{padding:'20px 24px',background:'linear-gradient(135deg, var(--berry) 0%, #6b1a3a 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                                    <div>
                                        <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-user" style={{marginRight:8}}></i>{workerPopup.nom}</div>
                                        <div style={{fontSize:13,opacity:0.85,marginTop:4}}>
                                            <span style={{fontFamily:'monospace',background:'rgba(255,255,255,0.2)',padding:'2px 8px',borderRadius:6,marginRight:8}}>{workerPopup.matricule}</span>
                                            Équipe: {workerPopup.equipe} — {workerPopup.ferme}
                                        </div>
                                    </div>
                                    <button onClick={() => setWorkerPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>

                                {/* KPIs */}
                                <div style={{padding:'16px 24px',display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:12}}>
                                    <div style={{background:'var(--berry-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Premier jour</div>
                                        <div style={{fontSize:13,fontWeight:700,color:'var(--berry)'}}>{new Date(workerPopup.premierJour+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</div>
                                    </div>
                                    <div style={{background:'var(--green-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Dernier jour</div>
                                        <div style={{fontSize:13,fontWeight:700,color:'var(--green)'}}>{new Date(workerPopup.dernierJour+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</div>
                                    </div>
                                    <div style={{background:'#e8f4fd',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Jours pointés</div>
                                        <div style={{fontSize:13,fontWeight:700,color:'#1565C0'}}>{workerPopup.nbJoursDistincts}</div>
                                    </div>
                                    <div style={{background:'#fff3e0',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Total Heures</div>
                                        <div style={{fontSize:13,fontWeight:700,color:'#e65100'}}>{workerPopup.totalHeures}h</div>
                                    </div>
                                    <div style={{background:'var(--berry-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Coût Total</div>
                                        <div style={{fontSize:13,fontWeight:700,color:'var(--berry)'}}>{workerPopup.totalCout.toLocaleString('fr-FR')} DH</div>
                                    </div>
                                    {workerPopup.totalQuantite > 0 && (
                                    <div style={{background:'var(--green-pale)',borderRadius:10,padding:12,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'var(--gray-500)'}}>Total Quantité</div>
                                        <div style={{fontSize:13,fontWeight:700,color:'var(--green)'}}>{workerPopup.totalQuantite}</div>
                                    </div>
                                    )}
                                </div>

                                {/* Info cards */}
                                <div style={{padding:'0 24px 12px',display:'flex',gap:8,flexWrap:'wrap'}}>
                                    {workerPopup.operations.map((op, i) => (
                                        <span key={i} style={{background:'var(--gray-100)',padding:'3px 10px',borderRadius:8,fontSize:10,fontWeight:600,color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-briefcase" style={{marginRight:4}}></i>{op}
                                        </span>
                                    ))}
                                    {workerPopup.parcelles.slice(0, 8).map((p, i) => (
                                        <span key={i} style={{background:'#e8f4fd',padding:'3px 10px',borderRadius:8,fontSize:10,fontWeight:600,color:'#1565C0'}}>
                                            <i className="fa-solid fa-map-pin" style={{marginRight:4}}></i>{p}
                                        </span>
                                    ))}
                                    <span style={{background:'var(--berry-pale)',padding:'3px 10px',borderRadius:8,fontSize:10,fontWeight:600,color:'var(--berry)'}}>
                                        <i className="fa-solid fa-calendar-days" style={{marginRight:4}}></i>{workerPopup.nbPeriodes} quinzaine{workerPopup.nbPeriodes > 1 ? 's' : ''}
                                    </span>
                                </div>

                                {/* Historique */}
                                <div style={{padding:'0 24px 20px'}}>
                                    <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:'var(--gray-700)'}}>
                                        <i className="fa-solid fa-clock-rotate-left" style={{marginRight:6}}></i>Historique Pointage (derniers 30 jours)
                                    </div>
                                    <div className="table-responsive">
                                    <table className="data-table" style={{fontSize:11}}>
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Période</th>
                                                <th>Opération</th>
                                                <th>Parcelle</th>
                                                <th>Heures</th>
                                                <th>Qté</th>
                                                <th>Coût</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {workerPopup.historique.map((h, i) => (
                                                <tr key={i}>
                                                    <td style={{whiteSpace:'nowrap'}}>{new Date(h.jour+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})}</td>
                                                    <td style={{fontSize:10,color:'var(--gray-400)'}}>{h.periode}</td>
                                                    <td style={{fontWeight:500}}>{h.operation}{h.operationDetail && h.operationDetail !== h.operation ? <span style={{fontSize:9,color:'var(--gray-400)',display:'block'}}>{h.operationDetail}</span> : ''}</td>
                                                    <td style={{fontSize:10}}>{h.parcelle}</td>
                                                    <td>{h.heures || '-'}</td>
                                                    <td>{h.quantite || '-'}</td>
                                                    <td style={{fontWeight:600}}>{Math.round(h.cout || 0)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { DashboardTab };
