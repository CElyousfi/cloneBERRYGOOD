/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): RecolteTab */
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { WorkerLink } from '../rh/WorkerLink.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { PROFILES } from '../shared/PROFILES.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { deriveSubFerme } from '../shared/deriveSubFerme.jsx';
import { useState } from '../shared/reactHooks.jsx';

import * as RecolteKpiUtils from '../shared/lib/recolteKpiUtils.js';
// ===================== RECOLTE TAB =====================
        function RecolteTab({ data, farmFilter, avoSubFilter, currentProfile, cultureFilter: propCultureFilter }) {
            const [fermeFilter, setFermeFilter] = useState(farmFilter || '');
            const [cultureFilter, setCultureFilter] = useState(propCultureFilter || '');
            const [workers, setWorkers] = useState([]);
            const [cueillette, setCueillette] = useState([]);
            const [totalKgCueillette, setTotalKgCueillette] = useState(0);
            const [prodSyncedAt, setProdSyncedAt] = useState(null);
            const [loading, setLoading] = useState(true);
            const [selectedDate, setSelectedDate] = useState('');
            const [dates, setDates] = useState([]);
            const [equipeRows, setEquipeRows] = useState([]);
            const [equipePeriodes, setEquipePeriodes] = useState([]);
            const [equipeLoading, setEquipeLoading] = useState(true);
            const [expandedEquipe, setExpandedEquipe] = useState(null);
            const [equipePeriodFilter, setEquipePeriodFilter] = useState('jour');
            const [showKgDetail, setShowKgDetail] = useState(true); // 'jour','semaine','quinzaine','prev'
            const [showPrimeTrendRH, setShowPrimeTrendRH] = useState(false);
            const [primeDetailDay, setPrimeDetailDay] = useState(null);
            const [showLogTrendRH, setShowLogTrendRH] = useState(false);
            const [showRendementTrend, setShowRendementTrend] = useState(false);
            const [historyByDate, setHistoryByDate] = useState({});
            const [equipeSelectedDay, setEquipeSelectedDay] = useState('');
            const [equipeSelectedQuinz, setEquipeSelectedQuinz] = useState('');
            const [showTransportConfig, setShowTransportConfig] = useState(null);
            const [transportForm, setTransportForm] = useState({ equipe: '', caporal: '', coutParOuvrier: 30 });
            const [equipeFermeFilter, setEquipeFermeFilter] = useState('');
            const [equipeCultureFilter, setEquipeCultureFilter] = useState('');
            const [addedTransport, setAddedTransport] = useState([]);
            const [printPopup, setPrintPopup] = useState(null);
            const [presenceData, setPresenceData] = useState({ rows: [], syncedAt: null });
            const presenceByMat = React.useMemo(() => Object.fromEntries((presenceData.rows || []).map(r => [(r.matricule || '').toUpperCase().trim(), r])), [presenceData]);
            const lookupPresence = (mat) => presenceByMat[(mat || '').toUpperCase().trim()] || null;
            const isMyrtille = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v || '');
            const calcPrime = data.calcPrime || ((kg, variete, date) => { const k = kg || 0; if (isMyrtille(variete)) { const seuil = /breeze/i.test(variete || '') ? 25 : /cascade/i.test(variete || '') ? ((date || '') >= '2026-04-25' ? 30 : 25) : 30; return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0; } if (k < 20) return 0; if (k < 25) return 20; if (k < 30) return 40; if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10; return Math.round((90 + (k - 40) * 4) * 10) / 10; });

            // Mapping préfixe matricule → chef d'équipe
            const equipeChefs = {
                'MM': 'Boucharen', 'AY': 'Chelihat', 'HT': 'El Bachir', 'HA': 'El Hafi',
                'KR': 'Farid', 'NA': 'Larache', 'JA': 'Ksr Femme', 'AZ': 'Chahdi',
                'CC': 'Sektoui', 'CA': 'Regragi', 'RE': 'Dechira', 'NV': 'NV'
            };
            // Merge dynamically added transport configs
            addedTransport.forEach(t => { equipeChefs[t.prefix] = t.equipe; });
            const KNOWN_PREFIXES = new Set(Object.keys(equipeChefs));
            const getEquipePrefix = (matricule) => {
                if (!matricule) return 'NV';
                const m = matricule.toUpperCase().trim();
                const p2 = m.substring(0, 2);
                if (equipeChefs[p2]) return p2;
                if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
                if (m.startsWith('DD')) return 'NV';
                // Auto-détection : nouveau préfixe → créer l'équipe dynamiquement
                if (!equipeChefs[p2]) equipeChefs[p2] = 'Équipe ' + p2;
                return p2;
            };
            const getEquipeName = (prefix) => equipeChefs[prefix] || prefix;

            const loadData = (date) => {
                const dq = date ? `&date=${date}` : '';
                fetch(`/api/pointage-rh?action=recolte${dq}`).then(r => r.json()).then(json => {
                    if (json.success) {
                        setWorkers(json.workers || []);
                        setCueillette(json.cueillette || []);
                        setTotalKgCueillette(json.totalKgCueillette || 0);
                        setProdSyncedAt(json.prodSyncedAt || null);
                    }
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            };

            React.useEffect(() => {
                loadData();
                cachedFetch('/api/pointage-rh?action=dates').then(json => { if (json.success) setDates(json.dates || []); }).catch(() => {});
                cachedFetch('/api/pointage-rh?action=recolte-equipes').then(json => {
                    if (json.success) { setEquipeRows(json.rows || []); setEquipePeriodes(json.periodes || []); }
                }).catch(err => console.warn(err)).finally(() => setEquipeLoading(false));
                cachedFetch('/api/pointage-rh?action=presence').then(json => {
                    if (json && json.success) setPresenceData({ rows: json.rows || [], syncedAt: json.syncedAt || null });
                }).catch(() => {});
            }, []);

            // Live listener — same trigger as the DG WhatsApp recap:
            // when prod_tracabilite_recolte/<today> is written, refetch the recolte API.
            React.useEffect(() => {
                if (typeof firebase === 'undefined' || !firebase.firestore) return;
                const today = new Date().toISOString().slice(0, 10);
                const listenDate = selectedDate || today;
                if (listenDate !== today) return; // only live for today
                let firstSnap = true;
                let pending = null;
                const unsub = firebase.firestore()
                    .collection('prod_tracabilite_recolte').doc(today)
                    .onSnapshot(() => {
                        if (firstSnap) { firstSnap = false; return; }
                        if (pending) clearTimeout(pending);
                        pending = setTimeout(() => { loadData(selectedDate); }, 2000);
                    }, err => console.warn('[recolte live] snapshot error:', err.message));
                return () => { if (pending) clearTimeout(pending); unsub(); };
            }, [selectedDate]);

            const handleDateChange = (d) => { setSelectedDate(d); setEquipeSelectedDay(d); setLoading(true); loadData(d); };

            // Fallback historique : quand un trend popup s'ouvre, on fetch action=recolte par date
            // pour les jours où equipeRows n'a pas de kg (BR_Pointage Quantite_unite=0 ET prod_tracabilite absent).
            React.useEffect(() => {
                if (!showRendementTrend && !showPrimeTrendRH) return;
                const todayStr = new Date().toISOString().slice(0, 10);
                const selectedStr = selectedDate || todayStr;
                const logOpsLocal = /caporal|conditionnement|encadrement|chargement/i;
                const allDatesEq = [...new Set((equipeRows || []).map(r => r.jour))];
                const candidates = allDatesEq.sort().reverse().slice(0, 10);
                const datesNeeding = candidates.filter(d => {
                    if (d === selectedStr) return false;
                    if (historyByDate[d]) return false;
                    const dayKg = (equipeRows || [])
                        .filter(r => r.jour === d && !logOpsLocal.test(r.operation || ''))
                        .reduce((s, r) => s + (r.kg || 0), 0);
                    return dayKg === 0;
                });
                if (datesNeeding.length === 0) return;
                Promise.all(datesNeeding.map(d =>
                    fetch(`/api/pointage-rh?action=recolte&date=${d}`)
                        .then(r => r.json())
                        .then(j => ({ date: d, ok: !!j.success, workers: j.workers || [], cueillette: j.cueillette || [], totalKgCueillette: j.totalKgCueillette || 0 }))
                        .catch(() => ({ date: d, ok: false }))
                )).then(results => {
                    setHistoryByDate(prev => {
                        const next = { ...prev };
                        results.forEach(r => { if (r.ok) next[r.date] = r; });
                        return next;
                    });
                });
            }, [showRendementTrend, showPrimeTrendRH, equipeRows.length, selectedDate]);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🍇</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement récolte...</div></div>;

            // Filter: separate récolte ouvriers from logistique (caporal, conditionnement, chargement)
            const logistiqueOps = /caporal|conditionnement|encadrement|chargement/i;
            // Resolve culture from parcelle via parcelleConfig (more reliable than Variete column)
            const resolveCulture = (w) => {
                const parcelle = (w.parcelle || '').toLowerCase();
                const pc = data.parcelleConfig || {};
                for (const farm of Object.keys(pc)) {
                    for (const p of pc[farm]) {
                        if (parcelle && (parcelle.includes(p.nom.toLowerCase()) || parcelle.includes(p.variete.toLowerCase()))) {
                            return p.culture;
                        }
                    }
                }
                // BUG 1 (data dégradée) : variete vide → dériver la culture depuis le TEXTE
                // parcelle via normalizeParcelle (distingue Myrtille vs Framboise) avant fallback.
                if (!w.variete) {
                    const np = normalizeParcelle(w.parcelle || '');
                    if (np && np.culture) return np.culture;
                }
                // Fallback: use variete
                return data.getCultureForVariete(w.variete);
            };
            // BUG 1 : variété robuste — colonne variete sinon dérivée du texte parcelle.
            const resolveVariete = (w) => {
                if (w && w.variete) return w.variete;
                const np = normalizeParcelle((w && w.parcelle) || '');
                return (np && np.variete) || '';
            };
            const allMapped = workers.map(w => {
                const culture = resolveCulture(w);
                const isMyrt = /myrtille/i.test(culture);
                // BUG 1 : variété robuste (texte parcelle en fallback si colonne vide)
                const variete = resolveVariete(w);
                return {
                    ...w, kilos: w.quantite || 0,
                    variete,
                    prime: calcPrime(w.quantite || 0, isMyrt ? 'myrtille' : variete, w.jour),
                    culture,
                    isLogistique: logistiqueOps.test(w.operation),
                    equipe: getEquipeName(getEquipePrefix(w.matricule))
                };
            });
            const matchSub = (r) => !avoSubFilter || deriveSubFerme(r.refParcelle, r.parcelle) === avoSubFilter;
            const matchCulture = (r) => !cultureFilter || /myrtille/i.test(r.culture) === (cultureFilter === 'Myrtille');
            const matchCultureCueillette = (c) => !cultureFilter || /myrtille/i.test(resolveCulture({ parcelle: c.parcelle })) === (cultureFilter === 'Myrtille');
            const allFiltered = (fermeFilter ? allMapped.filter(r => r.ferme === fermeFilter) : allMapped).filter(matchSub).filter(matchCulture);
            const logistiqueWorkers = allFiltered.filter(r => r.isLogistique);
            let recolte = allFiltered.filter(r => !r.isLogistique).sort((a, b) => b.kilos - a.kilos).map((r, i) => ({ ...r, rank: i + 1 }));

            const totalKgPointage = recolte.reduce((s, r) => s + r.kilos, 0);
            // Effectifs = matricules DISTINCTS (un ouvrier multi-parcelles compte 1×).
            // Coûts/Kg/primes restent des SOMMES (inchangé).
            const distinctCount = (rows) => RecolteKpiUtils
                ? RecolteKpiUtils.distinctOuvriersFromRows(rows)
                : new Set(rows.map(r => r.matricule)).size;
            const nbOuvRecolte = distinctCount(recolte);
            const nbOuvLogistique = distinctCount(logistiqueWorkers);
            const nbOuvPrimes = distinctCount(recolte.filter(r => r.prime > 0));
            const filteredCueillette = (fermeFilter ? cueillette.filter(c => c.ferme === fermeFilter) : cueillette).filter(matchSub).filter(matchCultureCueillette);
            const filteredCueilletteKg = filteredCueillette.reduce((s, c) => s + c.totalKg, 0);
            const totalKg = filteredCueilletteKg > 0 ? filteredCueilletteKg : totalKgPointage;
            const totalCout = recolte.reduce((s, r) => s + (r.cout || 0), 0);
            const totalPrimes = recolte.reduce((s, r) => s + r.prime, 0);

            // Stats by parcelle — use BR_Cueillette when available, fallback to BR_Pointage
            let parcStats;
            if (filteredCueillette.length > 0) {
                parcStats = filteredCueillette.map(c => ({
                    parcelle: c.parcelle, ferme: c.ferme, totalKg: c.totalKg, totalCaisses: c.totalCaisses,
                    nbOuv: new Set(recolte.filter(r => r.parcelle === c.parcelle).map(r => r.matricule)).size,
                    totalCout: recolte.filter(r => r.parcelle === c.parcelle).reduce((s, r) => s + (r.cout || 0), 0),
                })).sort((a, b) => b.totalKg - a.totalKg);
            } else {
                const parcelleStats = {};
                recolte.forEach(r => {
                    const key = r.parcelle || 'N/A';
                    if (!parcelleStats[key]) parcelleStats[key] = { parcelle: key, ferme: r.ferme, _mats: new Set(), nbOuv: 0, totalKg: 0, totalCout: 0 };
                    parcelleStats[key]._mats.add(r.matricule);
                    parcelleStats[key].nbOuv = parcelleStats[key]._mats.size;
                    parcelleStats[key].totalKg += r.kilos;
                    parcelleStats[key].totalCout += r.cout || 0;
                });
                parcStats = Object.values(parcelleStats).sort((a, b) => b.totalKg - a.totalKg);
            }

            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-database" style={{marginRight:4}}></i>Firestore — Récolte
                        </span>
                        <select value={selectedDate} onChange={e => handleDateChange(e.target.value)} style={{padding:'4px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600}}>
                            <option value="">Aujourd'hui</option>
                            {dates.filter(d => d.date !== new Date().toISOString().slice(0,10)).map(d => <option key={d.date} value={d.date}>{new Date(d.date+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</option>)}
                        </select>
                        {prodSyncedAt && (
                            <span title={"Dernière synchro Kg BEE ONE : " + new Date(prodSyncedAt).toLocaleString('fr-FR')} style={{background:'#fff3cd',color:'#856404',padding:'4px 10px',borderRadius:12,fontSize:11,fontWeight:600,display:'inline-flex',alignItems:'center',gap:4}}>
                                <i className="fa-solid fa-clock-rotate-left"></i>
                                Kg maj {new Date(prodSyncedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
                            </span>
                        )}
                    </div>

                    {!farmFilter && (
                    <div className="filters-bar">
                        <label style={{fontSize: 12, fontWeight: 500}}>Filtrer par ferme:</label>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            <button className={`chip c-green ${fermeFilter === '' ? 'active' : ''}`} onClick={() => setFermeFilter('')}>Toutes</button>
                            <button className={`chip c-green ${fermeFilter === 'F1' ? 'active' : ''}`} onClick={() => setFermeFilter('F1')}>F1</button>
                            <button className={`chip c-green ${fermeFilter === 'F5' ? 'active' : ''}`} onClick={() => setFermeFilter('F5')}>F5</button>
                            <button className={`chip c-green ${fermeFilter === 'Avocatier' ? 'active' : ''}`} onClick={() => setFermeFilter('Avocatier')}>Avocatier</button>
                        </div>
                        {!propCultureFilter && (<div className="chip-group" style={{marginLeft:8}}>
                            <span className="chip-group-label">Culture:</span>
                            <button className={`chip c-blue ${cultureFilter === '' ? 'active' : ''}`} onClick={() => setCultureFilter('')}>Toutes</button>
                            <button className={`chip c-blue ${cultureFilter === 'Framboise' ? 'active' : ''}`} onClick={() => setCultureFilter('Framboise')}>Framboise</button>
                            <button className={`chip c-blue ${cultureFilter === 'Myrtille' ? 'active' : ''}`} onClick={() => setCultureFilter('Myrtille')}>Myrtille</button>
                        </div>)}
                    </div>
                    )}

                    <div className="kpi-grid">
                        <KPICard icon="fa-basket-shopping" iconClass="berry" value={Math.round(totalKg).toLocaleString('fr-FR')} label="Total Kg (Récolte)" onClick={() => setShowKgDetail(!showKgDetail)} />
                        <KPICard icon="fa-users" iconClass="green" value={nbOuvRecolte} label="Ouvriers Récolte" />
                        <KPICard icon="fa-gauge-high" iconClass="purple" value={nbOuvRecolte > 0 ? Math.round(totalKg / nbOuvRecolte) + ' kg' : '-'} label="Rendement moyen / Ouvrier / Jour" onClick={() => setShowRendementTrend(!showRendementTrend)} />
                        <KPICard icon="fa-truck-loading" iconClass="blue" value={nbOuvLogistique + ' (' + (nbOuvRecolte + nbOuvLogistique > 0 ? Math.round(nbOuvLogistique / (nbOuvRecolte + nbOuvLogistique) * 100) : 0) + '%)'} label="Logistique Récolte" onClick={() => setShowLogTrendRH(!showLogTrendRH)} subItems={(() => {
                            const byOp = {};
                            logistiqueWorkers.forEach(w => { const op = (w.operation || 'Autre').trim(); if (!byOp[op]) byOp[op] = new Set(); byOp[op].add(w.matricule); });
                            return Object.entries(byOp).map(([op, set]) => ({ value: set.size, label: op }));
                        })()} />
                        <KPICard icon="fa-coins" iconClass="orange" value={Math.round(totalCout).toLocaleString('fr-FR')} label="Coût Total (DH)" />
                        <KPICard icon="fa-medal" iconClass="yellow" value={Math.round(totalPrimes).toLocaleString('fr-FR')} label="Primes estimées (DH)" />
                        <KPICard icon="fa-percent" iconClass="green" value={nbOuvRecolte > 0 ? Math.round(nbOuvPrimes / nbOuvRecolte * 100) + '%' : '-'} label="Ouvriers avec Prime" onClick={() => setShowPrimeTrendRH(!showPrimeTrendRH)} />
                    </div>

                    {showPrimeTrendRH && (() => {
                        const allEqRows = (fermeFilter ? equipeRows.filter(r => r.ferme === fermeFilter) : equipeRows).filter(matchSub);
                        const cultureFilteredEq = cultureFilter
                            ? allEqRows.filter(r => /myrtille/i.test(r.culture || resolveCulture({ parcelle: r.parcelle, variete: r.variete })) === (cultureFilter === 'Myrtille'))
                            : allEqRows;
                        const todayStr = new Date().toISOString().slice(0, 10);
                        const recolteDate = selectedDate || todayStr;
                        // Inclure recolteDate (live) même si l'historique ne l'a pas encore
                        const datesSetP = new Set(cultureFilteredEq.map(r => r.jour));
                        datesSetP.add(recolteDate);
                        const allDates = Array.from(datesSetP).sort().reverse().slice(0, 7).reverse();
                        const logOpsPopup = /caporal|conditionnement|encadrement|chargement/i;
                        // Données live pour la date affichée (alignées avec le KPI haut :
                        // matricules DISTINCTS, pas lignes par parcelle).
                        const liveTotal = nbOuvRecolte;
                        const liveWithPrime = nbOuvPrimes;
                        const computePrimeFromBuckets = (workersBucket) => workersBucket.filter(w => {
                            if (w.kg <= 0) return false;
                            const isMyrt = /myrtille/i.test(w.culture || resolveCulture({ parcelle: w.parcelle, variete: w.variete }));
                            return calcPrime(w.kg, isMyrt ? 'myrtille' : w.variete, w.jour) > 0;
                        }).length;
                        const trendData = allDates.map(date => {
                            let total, withPrime;
                            if (date === recolteDate) {
                                total = liveTotal;
                                withPrime = liveWithPrime;
                            } else {
                                // 1) equipeRows
                                const dayRows = cultureFilteredEq.filter(r => r.jour === date && !logOpsPopup.test(r.operation || ''));
                                const byW = {};
                                dayRows.forEach(r => {
                                    const k = r.matricule || r.nom;
                                    if (!byW[k]) byW[k] = { kg: 0, parcelle: r.parcelle, variete: r.variete };
                                    byW[k].kg += r.kg || 0;
                                });
                                const allWorkers = Object.values(byW);
                                total = allWorkers.length;
                                const sumKgEq = allWorkers.reduce((s, w) => s + (w.kg || 0), 0);
                                if (sumKgEq === 0 && historyByDate[date]) {
                                    // 2) fallback action=recolte
                                    const h = historyByDate[date];
                                    const wf = (h.workers || [])
                                        .filter(w => !fermeFilter || w.ferme === fermeFilter)
                                        .filter(w => !avoSubFilter || deriveSubFerme(w.refParcelle, w.parcelle) === avoSubFilter)
                                        .filter(w => !logOpsPopup.test(w.operation || ''))
                                        .filter(w => !cultureFilter || /myrtille/i.test(resolveCulture({ parcelle: w.parcelle, variete: w.variete })) === (cultureFilter === 'Myrtille'))
                                        .map(w => ({ kg: w.quantite || 0, parcelle: w.parcelle, variete: w.variete, jour: date }));
                                    total = wf.length || total;
                                    withPrime = computePrimeFromBuckets(wf);
                                } else {
                                    withPrime = computePrimeFromBuckets(allWorkers.map(w => ({ ...w, jour: date })));
                                }
                            }
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
                                    <button onClick={() => setShowPrimeTrendRH(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:16}}><i className="fa-solid fa-xmark"></i></button>
                                </div>
                                {trendData.length === 0 ? (
                                    <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}>Pas de données disponibles</div>
                                ) : (
                                    <div>
                                        <div style={{display:'flex',alignItems:'flex-end',gap:8,height:180,padding:'0 10px'}}>
                                            {trendData.map((d, i) => {
                                                const isToday = d.date === recolteDate;
                                                const barColor = d.pct >= 50 ? 'var(--green)' : d.pct >= 30 ? 'var(--orange)' : 'var(--red)';
                                                const isSelected = primeDetailDay === d.date;
                                                return (
                                                    <div key={i} onClick={() => setPrimeDetailDay(isSelected ? null : d.date)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'pointer',borderRadius:8,padding:'4px 0',background: isSelected ? 'var(--gray-100)' : 'transparent',transition:'background 0.2s'}}>
                                                        <span style={{fontSize:11,fontWeight:700,color: isToday ? 'var(--berry)' : 'var(--gray-600)'}}>{d.pct}%</span>
                                                        <div style={{width:'100%',maxWidth:50,background:barColor,borderRadius:'6px 6px 0 0',height: Math.max(8, d.pct * 1.4),transition:'height 0.3s',opacity: isSelected ? 1 : isToday ? 1 : 0.75,border: isSelected ? '2px solid var(--berry)' : 'none'}}></div>
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
                                        {primeDetailDay && (() => {
                                            // Si on clique la barre du jour affiché → utiliser la donnée live (recolte), sinon historique
                                            const useLiveDetail = primeDetailDay === recolteDate;
                                            const byW = {};
                                            if (useLiveDetail) {
                                                recolte.forEach(r => {
                                                    const k = r.matricule || r.nom;
                                                    byW[k] = { nom: r.nom, matricule: r.matricule, kg: r.kilos || 0, parcelle: r.parcelle, variete: r.variete };
                                                });
                                            } else {
                                                const dayRows = cultureFilteredEq.filter(r => r.jour === primeDetailDay && !logOpsPopup.test(r.operation || ''));
                                                dayRows.forEach(r => {
                                                    const k = r.matricule || r.nom;
                                                    if (!byW[k]) byW[k] = { nom: r.nom, matricule: r.matricule, kg: 0, parcelle: r.parcelle, variete: r.variete };
                                                    byW[k].kg += r.kg || 0;
                                                    if (r.parcelle) byW[k].parcelle = r.parcelle;
                                                });
                                            }
                                            const dayWorkers = Object.values(byW).filter(w => {
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
                                                w.culture = culture;
                                                const isMyrt = /myrtille/i.test(culture);
                                                w.prime = calcPrime(w.kg, isMyrt ? 'myrtille' : w.variete, w.jour);
                                                w.equipe = getEquipeName(getEquipePrefix(w.matricule));
                                                return w.prime > 0;
                                            });
                                            dayWorkers.sort((a, b) => b.kg - a.kg);
                                            const totalDayWorkers = Object.keys(byW).length;
                                            const dayLabel = new Date(primeDetailDay + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
                                            return (
                                                <div style={{marginTop:12,borderTop:'1px solid var(--gray-200)',paddingTop:12}}>
                                                    <div style={{fontSize:12,fontWeight:700,color:'var(--berry)',marginBottom:8}}>
                                                        <i className="fa-solid fa-medal" style={{marginRight:4}}></i>
                                                        {dayWorkers.length} ouvrier{dayWorkers.length > 1 ? 's' : ''} primé{dayWorkers.length > 1 ? 's' : ''} sur {totalDayWorkers} — {dayLabel}
                                                    </div>
                                                    {dayWorkers.length === 0 ? (
                                                        <div style={{textAlign:'center',padding:12,color:'var(--gray-400)',fontSize:11}}>Aucun ouvrier primé ce jour</div>
                                                    ) : (
                                                        <div style={{maxHeight:250,overflowY:'auto'}}>
                                                            <table className="data-table" style={{fontSize:11}}>
                                                                <thead><tr><th>Nom</th><th>Équipe</th><th>Culture</th><th style={{textAlign:'right'}}>Kg</th><th style={{textAlign:'right'}}>Prime (DH)</th></tr></thead>
                                                                <tbody>
                                                                    {dayWorkers.map((w, i) => (
                                                                        <tr key={i}>
                                                                            <td style={{fontWeight:600}}>{w.nom}</td>
                                                                            <td>{w.equipe}</td>
                                                                            <td>{/myrtille/i.test(w.culture) ? '🫐 Myrtille' : '🍓 Framboise'}</td>
                                                                            <td style={{textAlign:'right',fontWeight:600,color:'var(--green)'}}>{Math.round(w.kg * 10) / 10}</td>
                                                                            <td style={{textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{Math.round(w.prime)} DH</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                                <tfoot><tr style={{fontWeight:700,borderTop:'2px solid var(--gray-200)'}}>
                                                                    <td colSpan="3">Total</td>
                                                                    <td style={{textAlign:'right'}}>{Math.round(dayWorkers.reduce((s,w) => s + w.kg, 0) * 10) / 10} kg</td>
                                                                    <td style={{textAlign:'right',color:'var(--berry)'}}>{Math.round(dayWorkers.reduce((s,w) => s + w.prime, 0))} DH</td>
                                                                </tr></tfoot>
                                                            </table>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {showLogTrendRH && (() => {
                        const allEqRows2 = (fermeFilter ? equipeRows.filter(r => r.ferme === fermeFilter) : equipeRows).filter(matchSub);
                        const logOps2 = /caporal|conditionnement|encadrement|chargement/i;
                        const allDates2 = [...new Set(allEqRows2.map(r => r.jour))].sort().reverse().slice(0, 7).reverse();
                        const todayStr2 = new Date().toISOString().slice(0, 10);
                        const trendData2 = allDates2.map(date => {
                            const dayRows = allEqRows2.filter(r => r.jour === date);
                            const byW = {};
                            dayRows.forEach(r => {
                                const k = r.matricule || r.nom;
                                if (!byW[k]) byW[k] = { isLog: logOps2.test(r.operation || '') };
                                if (logOps2.test(r.operation || '')) byW[k].isLog = true;
                            });
                            const allWorkers = Object.values(byW);
                            const total = allWorkers.length;
                            const logCount = allWorkers.filter(w => w.isLog).length;
                            const pct = total > 0 ? Math.round(logCount / total * 100) : 0;
                            const label = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short', day:'numeric'});
                            return { date, label, pct, logCount, total };
                        });
                        return (
                            <div className="fade-in" style={{background:'var(--gray-50)',borderRadius:12,padding:16,marginBottom:16,border:'1px solid var(--gray-200)'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                                    <h4 style={{margin:0,fontSize:14,fontWeight:700,color:'var(--blue)'}}>
                                        <i className="fa-solid fa-chart-line" style={{marginRight:6}}></i>% Logistique Récolte — 7 derniers jours
                                    </h4>
                                    <button onClick={() => setShowLogTrendRH(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:16}}><i className="fa-solid fa-xmark"></i></button>
                                </div>
                                {trendData2.length === 0 ? (
                                    <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}>Pas de données disponibles</div>
                                ) : (
                                    <div>
                                        <div style={{display:'flex',alignItems:'flex-end',gap:8,height:180,padding:'0 10px'}}>
                                            {trendData2.map((d, i) => {
                                                const isToday = d.date === todayStr2;
                                                const barColor = d.pct <= 20 ? 'var(--green)' : d.pct <= 35 ? 'var(--orange)' : 'var(--red)';
                                                return (
                                                    <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                                                        <span style={{fontSize:11,fontWeight:700,color: isToday ? 'var(--blue)' : 'var(--gray-600)'}}>{d.pct}%</span>
                                                        <div style={{width:'100%',maxWidth:50,background:barColor,borderRadius:'6px 6px 0 0',height: Math.max(8, d.pct * 2.5),transition:'height 0.3s',opacity: isToday ? 1 : 0.75}}></div>
                                                        <span style={{fontSize:9,color: isToday ? 'var(--blue)' : 'var(--gray-400)',fontWeight: isToday ? 700 : 400}}>{d.label}</span>
                                                        <span style={{fontSize:8,color:'var(--gray-400)'}}>{d.logCount}/{d.total}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div style={{display:'flex',justifyContent:'center',gap:16,marginTop:12,fontSize:10,color:'var(--gray-500)'}}>
                                            <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--green)',marginRight:4}}></span>≤ 20%</span>
                                            <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--orange)',marginRight:4}}></span>21-35%</span>
                                            <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--red)',marginRight:4}}></span>&gt; 35%</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {showRendementTrend && (() => {
                        const allEqRowsR = (fermeFilter ? equipeRows.filter(r => r.ferme === fermeFilter) : equipeRows).filter(matchSub);
                        const cultureFilteredR = cultureFilter
                            ? allEqRowsR.filter(r => /myrtille/i.test(r.culture || resolveCulture({ parcelle: r.parcelle, variete: r.variete })) === (cultureFilter === 'Myrtille'))
                            : allEqRowsR;
                        const logOpsR = /caporal|conditionnement|encadrement|chargement/i;
                        const todayStrR = new Date().toISOString().slice(0, 10);
                        const selectedDateStrR = selectedDate || todayStrR;
                        // Pour la date affichée, utiliser la donnée live (alignée avec les KPI haut :
                        // matricules DISTINCTS).
                        const liveBucket = { kg: totalKg, nb: nbOuvRecolte };
                        // Construire la liste de dates : historique + date affichée (au cas où equipeRows ne contient pas encore today)
                        const datesSet = new Set(cultureFilteredR.map(r => r.jour));
                        datesSet.add(selectedDateStrR);
                        const allDatesR = Array.from(datesSet).sort().reverse().slice(0, 10).reverse();
                        const trendDataR = allDatesR.map(date => {
                            let totalKgDay, nb;
                            if (date === selectedDateStrR) {
                                totalKgDay = liveBucket.kg;
                                nb = liveBucket.nb;
                            } else {
                                // 1) Tenter equipeRows
                                const dayRows = cultureFilteredR.filter(r => r.jour === date && !logOpsR.test(r.operation || ''));
                                const byW = {};
                                dayRows.forEach(r => {
                                    const k = r.matricule || r.nom;
                                    if (!byW[k]) byW[k] = { kg: 0 };
                                    byW[k].kg += r.kg || 0;
                                });
                                const workersDay = Object.values(byW);
                                totalKgDay = workersDay.reduce((s, w) => s + w.kg, 0);
                                nb = workersDay.length;
                                // 2) Si kg=0, fallback sur historyByDate (action=recolte) si disponible
                                if (totalKgDay === 0 && historyByDate[date]) {
                                    const h = historyByDate[date];
                                    const wf = (h.workers || [])
                                        .filter(w => !fermeFilter || w.ferme === fermeFilter)
                                        .filter(w => !avoSubFilter || deriveSubFerme(w.refParcelle, w.parcelle) === avoSubFilter)
                                        .filter(w => !logOpsR.test(w.operation || ''))
                                        .filter(w => !cultureFilter || /myrtille/i.test(resolveCulture({ parcelle: w.parcelle, variete: w.variete })) === (cultureFilter === 'Myrtille'));
                                    const cf = (fermeFilter ? (h.cueillette || []).filter(c => c.ferme === fermeFilter) : (h.cueillette || []))
                                        .filter(c => !cultureFilter || /myrtille/i.test(resolveCulture({ parcelle: c.parcelle })) === (cultureFilter === 'Myrtille'));
                                    const cKg = cf.reduce((s, c) => s + (c.totalKg || 0), 0);
                                    const wKg = wf.reduce((s, w) => s + (w.quantite || 0), 0);
                                    totalKgDay = cKg > 0 ? cKg : wKg;
                                    nb = wf.length || nb;
                                }
                            }
                            const rend = nb > 0 ? totalKgDay / nb : 0;
                            const label = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short', day:'numeric'});
                            return { date, label, rend, totalKgDay, nb };
                        });
                        const nonZeroDays = trendDataR.filter(d => d.rend > 0);
                        const maxRend = Math.max(1, ...trendDataR.map(d => d.rend));
                        const avgRend = nonZeroDays.length > 0 ? nonZeroDays.reduce((s, d) => s + d.rend, 0) / nonZeroDays.length : 0;
                        return (
                            <div className="fade-in" style={{background:'var(--gray-50)',borderRadius:12,padding:16,marginBottom:16,border:'1px solid var(--gray-200)'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                                    <h4 style={{margin:0,fontSize:14,fontWeight:700,color:'var(--purple, #7c3aed)'}}>
                                        <i className="fa-solid fa-gauge-high" style={{marginRight:6}}></i>Rendement Kg / Ouvrier / Jour — 10 derniers jours
                                        {cultureFilter && <span style={{marginLeft:8,fontSize:11,fontWeight:500,color:'var(--gray-500)'}}>· {cultureFilter}</span>}
                                        {fermeFilter && <span style={{marginLeft:6,fontSize:11,fontWeight:500,color:'var(--gray-500)'}}>· {fermeFilter}</span>}
                                    </h4>
                                    <button onClick={() => setShowRendementTrend(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:16}}><i className="fa-solid fa-xmark"></i></button>
                                </div>
                                {trendDataR.length === 0 ? (
                                    <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}>Pas de données disponibles</div>
                                ) : (
                                    <div>
                                        <div style={{display:'flex',alignItems:'flex-end',gap:8,height:180,padding:'0 10px'}}>
                                            {trendDataR.map((d, i) => {
                                                const isToday = d.date === todayStrR;
                                                const isSelectedDate = d.date === (selectedDate || todayStrR);
                                                const ratio = d.rend / maxRend;
                                                const barColor = d.rend >= avgRend ? 'var(--green)' : d.rend >= avgRend * 0.7 ? 'var(--orange)' : 'var(--red)';
                                                return (
                                                    <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                                                        <span style={{fontSize:11,fontWeight:700,color: isSelectedDate ? 'var(--berry)' : 'var(--gray-600)'}}>{Math.round(d.rend)} kg</span>
                                                        <div style={{width:'100%',maxWidth:50,background:barColor,borderRadius:'6px 6px 0 0',height: Math.max(8, ratio * 140),transition:'height 0.3s',opacity: isSelectedDate ? 1 : isToday ? 0.9 : 0.7,border: isSelectedDate ? '2px solid var(--berry)' : 'none'}}></div>
                                                        <span style={{fontSize:9,color: isSelectedDate ? 'var(--berry)' : isToday ? 'var(--gray-600)' : 'var(--gray-400)',fontWeight: isSelectedDate ? 700 : 400}}>{d.label}</span>
                                                        <span style={{fontSize:8,color:'var(--gray-400)'}}>{Math.round(d.totalKgDay)}kg / {d.nb}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div style={{display:'flex',justifyContent:'center',gap:16,marginTop:12,fontSize:10,color:'var(--gray-500)'}}>
                                            <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--green)',marginRight:4}}></span>≥ moyenne</span>
                                            <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--orange)',marginRight:4}}></span>70-99%</span>
                                            <span><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'var(--red)',marginRight:4}}></span>&lt; 70%</span>
                                            <span style={{marginLeft:8}}>Moyenne 10j : <b>{Math.round(avgRend)} kg</b></span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {showKgDetail && (
                        <div className="fade-in" style={{background:'var(--gray-50)',borderRadius:12,padding:16,marginBottom:16,border:'1px solid var(--gray-200)'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                                <h4 style={{margin:0,fontSize:14,fontWeight:700,color:'var(--berry)'}}>
                                    <i className="fa-solid fa-chart-pie" style={{marginRight:6}}></i>Détail Récolte par Ferme & Parcelle
                                </h4>
                                <button onClick={() => setShowKgDetail(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:16}}><i className="fa-solid fa-xmark"></i></button>
                            </div>
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:12,marginBottom:16}}>
                                {(() => {
                                    const byF = {};
                                    recolte.forEach(r => {
                                        if (!byF[r.ferme]) byF[r.ferme] = { ferme: r.ferme, kg: 0, ouv: 0, prime: 0 };
                                        byF[r.ferme].kg += r.kilos;
                                        byF[r.ferme].ouv++;
                                        byF[r.ferme].prime += r.prime;
                                    });
                                    if (filteredCueillette.length > 0) {
                                        const cueilByF = {};
                                        filteredCueillette.forEach(c => {
                                            if (!cueilByF[c.ferme]) cueilByF[c.ferme] = 0;
                                            cueilByF[c.ferme] += c.totalKg || 0;
                                        });
                                        Object.entries(cueilByF).forEach(([ferme, kg]) => {
                                            if (!byF[ferme]) byF[ferme] = { ferme, kg: 0, ouv: 0, prime: 0 };
                                            byF[ferme].kg = kg;
                                        });
                                    }
                                    return Object.values(byF).sort((a,b) => b.kg - a.kg).map(f => (
                                        <div key={f.ferme} style={{background:'#fff',borderRadius:10,padding:12,border:'1px solid var(--gray-100)'}}>
                                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                                                <span className="status-badge" style={{background: f.ferme==='F1' ? 'var(--berry-pale)' : f.ferme==='F5' ? 'var(--green-pale)' : 'var(--orange-pale)', color: f.ferme==='F1' ? 'var(--berry)' : f.ferme==='F5' ? 'var(--green)' : 'var(--orange)', fontSize:11}}>{f.ferme}</span>
                                                <span style={{fontSize:9,color:'var(--gray-400)'}}>{f.ouv} ouvriers</span>
                                            </div>
                                            <div style={{fontSize:20,fontWeight:800,color:'var(--berry)'}}>{Math.round(f.kg).toLocaleString('fr-FR')} kg</div>
                                            <div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>Primes: {Math.round(f.prime).toLocaleString('fr-FR')} DH</div>
                                            <div style={{marginTop:6,height:4,background:'var(--gray-100)',borderRadius:2,overflow:'hidden'}}>
                                                <div style={{width:`${totalKg > 0 ? Math.round(f.kg / totalKg * 100) : 0}%`,height:'100%',background: f.ferme==='F1' ? 'var(--berry)' : f.ferme==='F5' ? 'var(--green)' : 'var(--orange)',borderRadius:2}}></div>
                                            </div>
                                            <div style={{fontSize:9,color:'var(--gray-400)',textAlign:'right',marginTop:2}}>{totalKg > 0 ? Math.round(f.kg / totalKg * 100) : 0}%</div>
                                        </div>
                                    ));
                                })()}
                            </div>
                            <div style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:8}}>Par Parcelle</div>
                            <div className="table-responsive">
                            <table className="data-table" style={{fontSize:11}}>
                                <thead><tr><th>Parcelle</th><th>Ferme</th><th>Ouvriers</th><th>Total Kg</th><th>% du Total</th></tr></thead>
                                <tbody>
                                    {parcStats.slice(0, 15).map((p, i) => (
                                        <tr key={i}>
                                            <td style={{fontWeight:500}}>{p.parcelle}</td>
                                            <td><span className="status-badge" style={{background:'var(--berry-pale)',color:'var(--berry)',fontSize:9}}>{p.ferme}</span></td>
                                            <td>{p.nbOuv}</td>
                                            <td><strong>{Math.round(p.totalKg).toLocaleString('fr-FR')}</strong></td>
                                            <td>{totalKg > 0 ? Math.round(p.totalKg / totalKg * 100) : 0}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        </div>
                    )}

                    {/* ===== SUIVI PAR ÉQUIPE ===== */}
                    {equipeLoading ? (
                        <Panel title="Suivi par Équipe" icon="fa-users"><div style={{textAlign:'center',padding:20,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div></Panel>
                    ) : equipeRows.length > 0 && (() => {
                        const today = new Date().toISOString().slice(0, 10);
                        const todayDate = new Date(today + 'T12:00:00');
                        const dow = todayDate.getDay();
                        const mondayOffset = dow === 0 ? 6 : dow - 1;
                        const monday = new Date(todayDate);
                        monday.setDate(monday.getDate() - mondayOffset);
                        const weekStart = monday.toISOString().slice(0, 10);

                        const currentQuinzaine = equipePeriodes[0] || '';
                        const prevQuinzaines = equipePeriodes.slice(1);

                        // Available days from data
                        const allDays = [...new Set(equipeRows.map(r => r.jour))].sort().reverse();

                        // Determine which rows to include based on period filter
                        const activeDay = equipeSelectedDay || today;
                        const activeQuinz = equipeSelectedQuinz || prevQuinzaines[0] || '';

                        const getFilteredPeriodRows = (rows) => {
                            if (equipePeriodFilter === 'jour') return rows.filter(r => r.jour === activeDay);
                            if (equipePeriodFilter === 'semaine') return rows.filter(r => r.jour >= weekStart && r.jour <= today);
                            if (equipePeriodFilter === 'quinzaine') return rows.filter(r => r.periode === currentQuinzaine);
                            if (equipePeriodFilter === 'prev') return rows.filter(r => r.periode === activeQuinz);
                            return rows;
                        };

                        const periodLabel = equipePeriodFilter === 'jour' ? (activeDay === today ? "Aujourd'hui" : new Date(activeDay+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}))
                            : equipePeriodFilter === 'semaine' ? 'Semaine en cours'
                            : equipePeriodFilter === 'quinzaine' ? (currentQuinzaine || 'Quinzaine en cours')
                            : (activeQuinz || 'Quinzaine précédente');

                        // Resolve culture from parcelle via parcelleConfig
                        const resolveRowCulture = (r) => {
                            const parcelle = (r.parcelle || '').toLowerCase();
                            const pc = data.parcelleConfig || {};
                            for (const farm of Object.keys(pc)) {
                                for (const p of pc[farm]) {
                                    if (parcelle && (parcelle.includes(p.nom.toLowerCase()) || parcelle.includes(p.variete.toLowerCase()))) {
                                        return p.culture;
                                    }
                                }
                            }
                            // BUG 1 : variete vide → dériver culture depuis texte parcelle avant fallback.
                            if (!r.variete) {
                                const np = normalizeParcelle(r.parcelle || '');
                                if (np && np.culture) return np.culture;
                            }
                            return data.getCultureForVariete(r.variete);
                        };
                        // BUG 1 : variété robuste pour les lignes equipeRows (colonne variete sinon parcelle).
                        const resolveRowVariete = (r) => {
                            if (r && r.variete) return r.variete;
                            const np = normalizeParcelle((r && r.parcelle) || '');
                            return (np && np.variete) || '';
                        };

                        // For "Jour" mode: use recolte data (same source as KPI) for consistency
                        // recolte is loaded for selectedDate (or today if no selection)
                        const recolteDate = selectedDate || today;
                        const useRecolteForDay = equipePeriodFilter === 'jour' && (!equipeSelectedDay || equipeSelectedDay === today || equipeSelectedDay === recolteDate);
                        let workerStats;

                        if (useRecolteForDay) {
                            // Build from recolte array (same source as KPI)
                            workerStats = recolte.map(r => ({
                                matricule: r.matricule, nom: r.nom, ferme: r.ferme,
                                equipe: getEquipePrefix(r.matricule),
                                totalKg: r.kilos, nbJours: r.kilos > 0 ? 1 : 0,
                                avgKg: r.kilos, primeJour: r.prime,
                                variete: resolveRowVariete(r),
                                culture: r.culture || resolveRowCulture(r),
                            }));
                        } else if (equipePeriodFilter === 'jour') {
                            // Jour mode but for a different date than recolte — group equipeRows for that day
                            // Also merge with recolte-like individual rows to avoid missing workers
                            const dayRows = (fermeFilter ? equipeRows.filter(r => r.ferme === fermeFilter) : equipeRows).filter(r => r.jour === activeDay && matchSub(r));
                            const byWorker = {};
                            dayRows.forEach(r => {
                                const key = r.matricule || r.nom;
                                if (!byWorker[key]) byWorker[key] = { matricule: r.matricule, nom: r.nom, ferme: r.ferme, kg: 0, parcelle: r.parcelle, variete: r.variete };
                                byWorker[key].kg += r.kg || 0;
                                if (r.parcelle) byWorker[key].parcelle = r.parcelle;
                                if (r.variete) byWorker[key].variete = r.variete;
                            });
                            workerStats = Object.values(byWorker).map(w => {
                                const culture = resolveRowCulture(w);
                                const isMyrt = /myrtille/i.test(culture);
                                const kg = Math.round(w.kg * 10) / 10;
                                const variete = resolveRowVariete(w);
                                return {
                                    matricule: w.matricule, nom: w.nom, ferme: w.ferme,
                                    equipe: getEquipePrefix(w.matricule),
                                    totalKg: kg, nbJours: kg > 0 ? 1 : 0, avgKg: kg,
                                    primeJour: calcPrime(kg, isMyrt ? 'myrtille' : variete, w.jour),
                                    variete, culture,
                                };
                            }).filter(w => w.totalKg > 0);
                        } else {
                            // Semaine/Quinzaine modes: group equipeRows by worker over period
                            const byWorker = {};
                            const baseRows = (fermeFilter ? equipeRows.filter(r => r.ferme === fermeFilter) : equipeRows).filter(matchSub);
                            baseRows.forEach(r => {
                                const key = r.matricule || r.nom;
                                if (!byWorker[key]) byWorker[key] = { matricule: r.matricule, nom: r.nom, ferme: r.ferme, days: [] };
                                byWorker[key].days.push({ ...r, resolvedCulture: resolveRowCulture(r) });
                            });
                            workerStats = Object.values(byWorker).map(w => {
                                const prefix = getEquipePrefix(w.matricule);
                                const periodRows = getFilteredPeriodRows(w.days);
                                const totalKg = Math.round(periodRows.reduce((s, r) => s + r.kg, 0) * 10) / 10;
                                const nbJours = periodRows.length;
                                const avgKg = nbJours > 0 ? Math.round(totalKg / nbJours * 10) / 10 : 0;
                                const varCounts = {};
                                const cultCounts = {};
                                periodRows.forEach(r => {
                                    const v = resolveRowVariete(r);
                                    if (v) varCounts[v] = (varCounts[v] || 0) + 1;
                                    const c = r.resolvedCulture;
                                    if (c) cultCounts[c] = (cultCounts[c] || 0) + 1;
                                });
                                const topVariete = Object.entries(varCounts).sort((a,b) => b[1] - a[1])[0];
                                const variete = topVariete ? topVariete[0] : '';
                                const topCulture = Object.entries(cultCounts).sort((a,b) => b[1] - a[1])[0];
                                const culture = topCulture ? topCulture[0] : data.getCultureForVariete(variete);
                                const isMyrt = /myrtille/i.test(culture);
                                const primeJour = calcPrime(avgKg, isMyrt ? 'myrtille' : variete, w.jour);
                                return {
                                    matricule: w.matricule, nom: w.nom, ferme: w.ferme, equipe: prefix,
                                    totalKg, nbJours, avgKg, primeJour, variete, culture,
                                };
                            }).filter(w => w.totalKg > 0 || w.nbJours > 0);
                        }

                        // Extract unique fermes & cultures for filters
                        const allFermes = [...new Set(workerStats.map(w => w.ferme).filter(Boolean))].sort();
                        const allCultures = [...new Set(workerStats.map(w => w.culture).filter(Boolean))].sort();

                        // Chef de ferme: forcer le filtre sur sa ferme
                        const chefFarmEquipe = currentProfile && currentProfile.startsWith('chef_')
                            ? (PROFILES.find(p => p.id === currentProfile) || {}).farm
                            : null;

                        // Apply ferme/culture filters
                        const filteredWorkerStats = workerStats.filter(w => {
                            if (chefFarmEquipe && w.ferme !== chefFarmEquipe) return false;
                            if (equipeFermeFilter && w.ferme !== equipeFermeFilter) return false;
                            if (equipeCultureFilter && w.culture !== equipeCultureFilter) return false;
                            return true;
                        });

                        // Group by equipe
                        const equipes = {};
                        filteredWorkerStats.forEach(w => {
                            if (!equipes[w.equipe]) equipes[w.equipe] = { prefix: w.equipe, nom: getEquipeName(w.equipe), workers: [] };
                            equipes[w.equipe].workers.push(w);
                        });
                        Object.values(equipes).forEach(eq => eq.workers.sort((a, b) => b.avgKg - a.avgKg));

                        const equipeList = Object.values(equipes).map(eq => {
                            const ws = eq.workers;
                            const activeWs = ws.filter(w => w.totalKg > 0);
                            const totalKg = Math.round(ws.reduce((s, w) => s + w.totalKg, 0) * 10) / 10;
                            const avgKg = activeWs.length > 0 ? Math.round(activeWs.reduce((s, w) => s + w.avgKg, 0) / activeWs.length * 10) / 10 : 0;
                            const nbWithPrime = ws.filter(w => w.primeJour > 0).length;
                            // Variétés distinctes de l'équipe
                            const varCounts = {};
                            ws.forEach(w => { if (w.variete) varCounts[w.variete] = (varCounts[w.variete] || 0) + 1; });
                            const varietesEquipe = Object.keys(varCounts).sort((a,b) => varCounts[b] - varCounts[a]);
                            // Cultures distinctes
                            const cultCounts = {};
                            ws.forEach(w => { if (w.culture) cultCounts[w.culture] = (cultCounts[w.culture] || 0) + 1; });
                            const culturesEquipe = Object.keys(cultCounts).sort((a,b) => cultCounts[b] - cultCounts[a]);
                            const totalPrime = Math.round(ws.reduce((s, w) => s + (w.primeJour || 0), 0) * 10) / 10;
                            return { ...eq, totalKg, avgKg, totalPrime, nbWorkers: ws.length, activeWorkers: activeWs.length, nbWithPrime, varietesEquipe, culturesEquipe };
                        }).sort((a, b) => b.avgKg - a.avgKg);

                        return (
                            <Panel title="Suivi Récolte par Équipe" icon="fa-users">
                                {/* Period filter bar */}
                                <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
                                    <div className="chip-group">
                                        <span className="chip-group-label">Période:</span>
                                        {[{k:'jour',l:'Jour'},{k:'quinzaine',l:'Quinzaine en cours'}].map(p => (
                                            <button key={p.k} className={`chip c-berry ${equipePeriodFilter===p.k ? 'active' : ''}`} onClick={() => setEquipePeriodFilter(p.k)}>
                                                {p.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Ferme & Culture filters */}
                                {(allFermes.length > 1 || allCultures.length > 1) && (
                                <div style={{display:'flex',gap:16,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
                                    {allFermes.length > 1 && (
                                    <div className="chip-group">
                                        <span className="chip-group-label">Ferme:</span>
                                        <button className={`chip c-green ${equipeFermeFilter==='' ? 'active' : ''}`} onClick={() => setEquipeFermeFilter('')}>Toutes</button>
                                        {allFermes.map(f => (
                                            <button key={f} className={`chip c-green ${equipeFermeFilter===f ? 'active' : ''}`} onClick={() => setEquipeFermeFilter(equipeFermeFilter === f ? '' : f)}>{f}</button>
                                        ))}
                                    </div>
                                    )}
                                    {allCultures.length > 1 && (
                                    <div className="chip-group">
                                        <span className="chip-group-label">Culture:</span>
                                        <button className={`chip c-purple ${equipeCultureFilter==='' ? 'active' : ''}`} onClick={() => setEquipeCultureFilter('')}>Toutes</button>
                                        {allCultures.map(c => (
                                            <button key={c} className={`chip ${c === 'Myrtille' ? 'c-indigo' : 'c-berry'} ${equipeCultureFilter===c ? 'active' : ''}`} onClick={() => setEquipeCultureFilter(equipeCultureFilter === c ? '' : c)}>
                                                {c === 'Myrtille' ? '🫐' : '🍓'} {c}
                                            </button>
                                        ))}
                                    </div>
                                    )}
                                </div>
                                )}

                                <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:10}}>
                                    Équipe identifiée par les 2 premières lettres du matricule — <strong>{periodLabel}</strong>
                                </div>

                                {/* Alerte nouvelles équipes non-configurées (masqué pour chef de ferme) */}
                                {!(currentProfile && currentProfile.startsWith('chef_')) && (() => {
                                    const newTeams = equipeList.filter(eq => !KNOWN_PREFIXES.has(eq.prefix) && eq.prefix !== 'NV');
                                    if (newTeams.length === 0) return null;
                                    const totalNew = newTeams.reduce((s, eq) => s + eq.nbWorkers, 0);
                                    return (
                                        <div style={{marginBottom:12}}>
                                            {newTeams.map(team => {
                                                const hasConfig = (data.transportConfig || []).find(t => t.prefix === team.prefix);
                                                return (
                                                    <div key={team.prefix} onClick={() => { setShowTransportConfig(team.prefix); setTransportForm({ equipe: team.nom || team.prefix, caporal: '', coutParOuvrier: 30 }); }}
                                                        style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'rgba(243,156,18,0.1)',border:'1px solid rgba(243,156,18,0.3)',borderRadius:8,marginBottom:6,fontSize:12,cursor:'pointer',transition:'all 0.2s'}}>
                                                        <i className="fa-solid fa-triangle-exclamation" style={{color:'#E67E22',fontSize:16}}></i>
                                                        <div style={{flex:1}}>
                                                            <strong style={{color:'#E67E22'}}>Nouvelle équipe détectée : {team.prefix}</strong>
                                                            <span style={{color:'var(--gray-600)',marginLeft:6}}>
                                                                — {team.nbWorkers} ouvrier{team.nbWorkers > 1 ? 's' : ''} — Transport non configuré
                                                            </span>
                                                        </div>
                                                        <span style={{background:'#E67E22',color:'#fff',padding:'4px 12px',borderRadius:6,fontSize:11,fontWeight:600}}>
                                                            <i className="fa-solid fa-gear" style={{marginRight:4}}></i>Configurer
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}

                                {/* Modal configuration transport (RH uniquement) */}
                                {!(currentProfile && currentProfile.startsWith('chef_')) && showTransportConfig && (
                                    <div className="modal-overlay" onClick={() => setShowTransportConfig(null)}>
                                        <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:420}}>
                                            <h3 style={{margin:'0 0 16px',fontSize:16}}>
                                                <i className="fa-solid fa-truck" style={{color:'var(--berry)',marginRight:8}}></i>
                                                Configurer Transport — Équipe {showTransportConfig}
                                            </h3>
                                            <div style={{display:'flex',flexDirection:'column',gap:14}}>
                                                <div>
                                                    <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Nom de l'équipe</label>
                                                    <input type="text" value={transportForm.equipe} onChange={e => setTransportForm({...transportForm, equipe: e.target.value})}
                                                        placeholder="Ex: Nom du chef" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                                </div>
                                                <div>
                                                    <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Caporal / Responsable</label>
                                                    <input type="text" value={transportForm.caporal} onChange={e => setTransportForm({...transportForm, caporal: e.target.value})}
                                                        placeholder="Nom du caporal" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                                </div>
                                                <div>
                                                    <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Coût transport par ouvrier (MAD)</label>
                                                    <input type="number" value={transportForm.coutParOuvrier} onChange={e => setTransportForm({...transportForm, coutParOuvrier: Number(e.target.value)})}
                                                        min={0} step={5} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,boxSizing:'border-box'}} />
                                                </div>
                                            </div>
                                            <div style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:20}}>
                                                <button onClick={() => setShowTransportConfig(null)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid var(--gray-200)',background:'#fff',fontSize:13,cursor:'pointer'}}>Annuler</button>
                                                <button onClick={() => {
                                                    const prefix = showTransportConfig;
                                                    const newEntry = { prefix, equipe: transportForm.equipe, caporal: transportForm.caporal, coutParOuvrier: transportForm.coutParOuvrier };
                                                    (data.transportConfig || []).push(newEntry);
                                                    setAddedTransport(prev => [...prev, newEntry]);
                                                    setShowTransportConfig(null);
                                                }} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                                    Enregistrer
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Résumé par équipe */}
                                <div className="table-responsive">
                                <table className="data-table" style={{marginBottom:16}}>
                                    <thead>
                                        <tr>
                                            <th>Équipe</th>
                                            <th>Chef</th>
                                            <th>Variété</th>
                                            <th>Actifs</th>
                                            <th>Rendement</th>
                                            <th>Total (kg)</th>
                                            <th>Total Prime (DH)</th>
                                            <th>% avec Prime</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {equipeList.map((eq) => {
                                            const isExpanded = expandedEquipe === eq.prefix;
                                            const pctPrime = eq.activeWorkers > 0 ? Math.round(eq.nbWithPrime / eq.activeWorkers * 100) : 0;
                                            return (
                                                <React.Fragment key={eq.prefix}>
                                                    <tr style={{cursor:'pointer',background: isExpanded ? 'var(--berry-pale)' : undefined}} onClick={() => setExpandedEquipe(isExpanded ? null : eq.prefix)}>
                                                        <td>
                                                            <strong style={{fontFamily:'monospace'}}>{eq.prefix}</strong>
                                                            {!KNOWN_PREFIXES.has(eq.prefix) && eq.prefix !== 'NV' && (
                                                                <span style={{marginLeft:6,background:'rgba(243,156,18,0.15)',color:'#E67E22',padding:'1px 6px',borderRadius:8,fontSize:9,fontWeight:700}}>Nouveau</span>
                                                            )}
                                                        </td>
                                                        <td style={{fontWeight:600}}>{eq.nom}</td>
                                                        <td style={{fontSize:10}}>{eq.varietesEquipe.length > 0 ? eq.varietesEquipe.map((v, vi) => <div key={vi} style={{whiteSpace:'nowrap'}}>{v}</div>) : '-'}</td>
                                                        <td>{eq.activeWorkers}/{eq.nbWorkers}</td>
                                                        <td style={{fontWeight:700,color:'var(--berry)'}}>{eq.avgKg > 0 ? eq.avgKg + ' kg' : '-'}</td>
                                                        <td><strong>{eq.totalKg > 0 ? Math.round(eq.totalKg).toLocaleString() + ' kg' : '-'}</strong></td>
                                                        <td style={{color: eq.totalPrime > 0 ? 'var(--green)' : 'var(--gray-400)', fontWeight:700}}>{eq.totalPrime > 0 ? Math.round(eq.totalPrime).toLocaleString('fr-FR') + ' DH' : '-'}</td>
                                                        <td>
                                                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                                                                <div style={{flex:1,background:'var(--gray-100)',borderRadius:4,height:6,maxWidth:60}}>
                                                                    <div style={{width:`${pctPrime}%`,background: pctPrime >= 50 ? 'var(--green)' : 'var(--orange)',borderRadius:4,height:6}}></div>
                                                                </div>
                                                                <span style={{fontSize:11,fontWeight:600}}>{pctPrime}%</span>
                                                            </div>
                                                        </td>
                                                        <td><i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`} style={{fontSize:10,color:'var(--gray-400)'}}></i></td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr>
                                                            <td colSpan={9} style={{padding:0,background:'var(--gray-50)'}}>
                                                                <table className="data-table" style={{margin:0,fontSize:11}}>
                                                                    <thead>
                                                                        <tr style={{background:'var(--gray-100)'}}>
                                                                            <th className="desktop-only-col">Matricule</th>
                                                                            <th>Ouvrier</th>
                                                                            <th className="desktop-only-col">Ferme</th>
                                                                            <th className="desktop-only-col">Variété</th>
                                                                            <th className="desktop-only-col">Culture</th>
                                                                            <th className="desktop-only-col">Jours Récoltés</th>
                                                                            <th className="desktop-only-col">Moy/Jour (kg)</th>
                                                                            <th>Kg</th>
                                                                            <th>Prime</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {eq.workers.map((w, wi) => (
                                                                            <tr key={wi} style={{opacity: w.totalKg > 0 ? 1 : 0.4}}>
                                                                                <td className="desktop-only-col" style={{fontFamily:'monospace',fontSize:10}}>{w.matricule}</td>
                                                                                <td style={{fontWeight:500}}><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                                                                <td className="desktop-only-col"><span className="status-badge" style={{background: w.ferme==='F1' ? 'var(--berry-pale)' : 'var(--green-pale)', color: w.ferme==='F1' ? 'var(--berry)' : 'var(--green)', fontSize:9}}>{w.ferme}</span></td>
                                                                                <td className="desktop-only-col" style={{fontSize:10,fontWeight:500}}>{w.variete || '-'}</td>
                                                                                <td className="desktop-only-col"><span style={{fontSize:10, fontWeight:600, color: w.culture === 'Myrtille' ? '#5B6ABF' : 'var(--berry)'}}>{w.culture === 'Myrtille' ? '🫐' : '🍓'} {w.culture}</span></td>
                                                                                <td className="desktop-only-col">{w.nbJours}</td>
                                                                                <td className="desktop-only-col" style={{fontWeight:700,color:'var(--berry)'}}>{w.avgKg > 0 ? w.avgKg + ' kg' : '-'}</td>
                                                                                <td><strong>{w.totalKg > 0 ? Math.round(w.totalKg) + ' kg' : '-'}</strong></td>
                                                                                <td style={{color: w.primeJour > 0 ? 'var(--green)' : 'var(--gray-400)', fontWeight: w.primeJour > 0 ? 600 : 400}}>
                                                                                    {w.primeJour > 0 ? w.primeJour + ' DH' : '-'}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                    <tfoot>
                                                                        <tr style={{fontWeight:700,background:'var(--gray-100)'}}>
                                                                            <td className="desktop-only-col"></td>
                                                                            <td>Total</td>
                                                                            <td className="desktop-only-col"></td>
                                                                            <td className="desktop-only-col"></td>
                                                                            <td className="desktop-only-col"></td>
                                                                            <td className="desktop-only-col"></td>
                                                                            <td className="desktop-only-col"></td>
                                                                            <td><strong>{Math.round(eq.totalKg).toLocaleString('fr-FR')} kg</strong></td>
                                                                            <td style={{color:'var(--green)',fontWeight:700}}>{Math.round(eq.totalPrime).toLocaleString('fr-FR')} DH</td>
                                                                        </tr>
                                                                    </tfoot>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                </div>
                                {(() => {
                                    const totalKilos = equipeRows.filter(r => r.jour === activeDay && (!chefFarmEquipe || r.ferme === chefFarmEquipe)).reduce((s, r) => s + (r.kg || 0), 0);
                                    const totalWorkers = equipeList.reduce((s, eq) => s + eq.nbWorkers, 0);
                                    const totalActive = equipeList.reduce((s, eq) => s + eq.activeWorkers, 0);
                                    const totalPrimesGlobal = Math.round(equipeList.reduce((s, eq) => s + eq.totalPrime, 0));
                                    const sansKg = totalWorkers - totalActive;
                                    return (
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8,padding:'8px 12px',background:'var(--berry-pale)',borderRadius:8,flexWrap:'wrap',gap:8}}>
                                            <div style={{display:'flex',alignItems:'center',gap:12,fontSize:11}}>
                                                <span style={{color:'var(--gray-600)'}}>
                                                    <i className="fa-solid fa-users" style={{marginRight:4,color:'var(--berry)'}}></i>
                                                    <strong>{totalWorkers}</strong> ouvriers récolte
                                                </span>
                                                <span style={{color:'var(--green)'}}>
                                                    <i className="fa-solid fa-circle-check" style={{marginRight:3}}></i>
                                                    <strong>{totalActive}</strong> actifs avec kg
                                                </span>
                                                {sansKg > 0 && (
                                                    <span style={{color:'#E67E22'}}>
                                                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:3}}></i>
                                                        <strong>{sansKg}</strong> sans suivi de Kg
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{display:'flex',alignItems:'center',gap:16}}>
                                            {totalKilos > 0 ? (
                                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                                    <span style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>Total Kilos :</span>
                                                    <span style={{fontSize:16,fontWeight:800,color:'var(--berry)'}}>{Math.round(totalKilos).toLocaleString()} kg</span>
                                                </div>
                                            ) : null}
                                            {totalPrimesGlobal > 0 && (
                                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                                    <span style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>Total Primes :</span>
                                                    <span style={{fontSize:16,fontWeight:800,color:'var(--green)'}}>{totalPrimesGlobal.toLocaleString('fr-FR')} DH</span>
                                                </div>
                                            )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </Panel>
                        );
                    })()}

                    {(() => {
                        const chefFarm = currentProfile && currentProfile.startsWith('chef_') ? (PROFILES.find(p => p.id === currentProfile) || {}).farm : null;
                        const excelData = chefFarm ? recolte.filter(r => r.ferme === chefFarm) : recolte;
                        const printFarms = chefFarm ? [chefFarm] : ['F1','F5'];
                        return (
                    <Panel title={<span>Classement Récolte du Jour <span style={{background:'var(--berry)',color:'#fff',padding:'3px 10px',borderRadius:12,fontSize:12,fontWeight:700,marginLeft:8}}>{Math.round(recolte.reduce((s,r) => s + r.kilos, 0)).toLocaleString('fr-FR')} kg</span></span>} icon="fa-ranking-star"
                        actions={<div style={{display:'flex',gap:6}}>
                            <button onClick={() => {
                                const dateStr = selectedDate || new Date().toISOString().slice(0,10);
                                const dateLabel = new Date(dateStr+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
                                const totalKgXls = Math.round(excelData.reduce((s,r) => s + r.kilos, 0));
                                const totalCoutXls = Math.round(excelData.reduce((s,r) => s + (r.cout||0), 0));
                                const totalPrimeXls = Math.round(excelData.reduce((s,r) => s + r.prime, 0));

                                // Header rows
                                const header = [
                                    ['Berry Good Farms — Classement Récolte du Jour' + (chefFarm ? ' — ' + chefFarm : '')],
                                    ['Date:', dateLabel, '', 'Total Kg:', totalKgXls, '', 'Total Coût:', totalCoutXls + ' DH', '', 'Total Primes:', totalPrimeXls + ' DH'],
                                    ['Ouvriers:', excelData.length, '', chefFarm ? 'Ferme: ' + chefFarm : (fermeFilter ? 'Ferme: ' + fermeFilter : 'Toutes Fermes')],
                                    []
                                ];
                                const dataRows = excelData.map(r => [r.rank, r.matricule, r.nom, r.operation, r.ferme, r.variete || '', r.kilos, r.heures, Math.round(r.cout || 0), r.prime, r.parcelle]);
                                const cols = ['#', 'Matricule', 'Ouvrier', 'Opération', 'Ferme', 'Variété', 'Quantité (kg)', 'Heures', 'Coût (DH)', 'Prime (DH)', 'Parcelle'];
                                const totalRow = ['', '', '', '', '', 'TOTAL', totalKgXls, '', totalCoutXls, totalPrimeXls, ''];
                                const all = [...header, cols, ...dataRows, totalRow];

                                const ws = XLSX.utils.aoa_to_sheet(all);
                                // Column widths
                                ws['!cols'] = [4,14,28,22,8,18,14,8,12,12,28].map(w => ({ wch: w }));
                                // Merge title row
                                ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:10} }];

                                const wb = XLSX.utils.book_new();
                                XLSX.utils.book_append_sheet(wb, ws, 'Classement Récolte');
                                XLSX.writeFile(wb, `Classement_Recolte_${dateStr}.xlsx`);
                            }} style={{padding:'5px 10px',background:'var(--green)',color:'#fff',border:'none',borderRadius:8,fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                                <i className="fa-solid fa-file-excel"></i> Excel
                            </button>
                            {printFarms.map(pf => {
                                const printFerme = recolte.filter(r => r.ferme === pf).map((r,i) => ({...r, rank: i+1}));
                                const pfColor = pf === 'F1' ? 'var(--berry)' : 'var(--green)';
                                return (
                                <button key={pf} onClick={() => {
                                    const dateStr = selectedDate || new Date().toISOString().slice(0,10);
                                    const dateLabel = new Date(dateStr+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
                                    const list = printFerme;
                                    const totalKgPrint = Math.round(list.reduce((s,r) => s + r.kilos, 0)).toLocaleString('fr-FR');
                                    const totalPrimePrint = Math.round(list.reduce((s,r) => s + r.prime, 0)).toLocaleString('fr-FR');
                                    setPrintPopup({ ferme: pf, dateLabel, list, totalKgPrint, totalPrimePrint, dateStr });
                                }} style={{padding:'5px 10px',background:pfColor,color:'#fff',border:'none',borderRadius:8,fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                                    <i className="fa-solid fa-print"></i> {pf}
                                </button>);
                            })}
                        </div>}>
                        <div className="table-responsive">
                        <table className="data-table">
                            {(() => {
                                const showKgInsteadOfOp = currentProfile === 'rh' || (currentProfile && currentProfile.startsWith('chef_'));
                                return (<React.Fragment>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    {showKgInsteadOfOp && <th className="mobile-only-col">Équipe</th>}
                                    <th className={showKgInsteadOfOp ? 'desktop-only-col' : ''}>Matricule</th>
                                    <th>Ouvrier</th>
                                    {showKgInsteadOfOp ? <th>Kg</th> : <th>Opération</th>}
                                    <th className="desktop-only-col">Ferme</th>
                                    {!showKgInsteadOfOp && <th>Quantité</th>}
                                    <th className="desktop-only-col">Heures</th>
                                    <th className="desktop-only-col" style={{textAlign:'center'}}>Entrée</th>
                                    <th className="desktop-only-col" style={{textAlign:'center'}}>Sortie</th>
                                    <th className="desktop-only-col">Coût (DH)</th>
                                    <th>Prime</th>
                                    <th className="desktop-only-col">Parcelle</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recolte.map((r, i) => { const pres = lookupPresence(r.matricule); return (
                                    <tr key={i}>
                                        <td><span className={`rank ${i < 3 ? `rank-${i+1}` : 'rank-other'}`}>{r.rank}</span></td>
                                        {showKgInsteadOfOp && <td className="mobile-only-col" style={{fontSize:10,fontWeight:600}}>{r.equipe}</td>}
                                        <td className={showKgInsteadOfOp ? 'desktop-only-col' : ''} style={{fontFamily:'monospace',fontSize:11}}>{r.matricule}</td>
                                        <td style={{fontWeight: 500}}><WorkerLink matricule={r.matricule} nom={r.nom} /></td>
                                        {showKgInsteadOfOp ? <td><strong>{r.kilos}</strong></td> : <td style={{fontSize:11}}>{r.operation}</td>}
                                        <td className="desktop-only-col"><span className="status-badge" style={{background: r.ferme==='F1' ? 'var(--berry-pale)' : (r.ferme==='F5' ? 'var(--green-pale)' : 'var(--orange-pale)'), color: r.ferme==='F1' ? 'var(--berry)' : (r.ferme==='F5' ? 'var(--green)' : 'var(--orange)'), fontSize:10}}>{r.ferme}</span></td>
                                        {!showKgInsteadOfOp && <td><strong>{r.kilos}</strong></td>}
                                        <td className="desktop-only-col">{r.heures}h</td>
                                        <td className="desktop-only-col" style={{textAlign:'center',fontFamily:'monospace',fontSize:11,color: pres && pres.heureEntree ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureEntree) || '—'}</td>
                                        <td className="desktop-only-col" style={{textAlign:'center',fontFamily:'monospace',fontSize:11,color: pres && pres.heureSortie ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureSortie) || '—'}</td>
                                        <td className="desktop-only-col">{Math.round(r.cout || 0)}</td>
                                        <td style={{color: r.prime > 0 ? 'var(--green)' : 'var(--gray-400)', fontWeight: r.prime > 0 ? 600 : 400}}>{r.prime > 0 ? r.prime : '-'}</td>
                                        <td className="desktop-only-col" style={{fontSize:10,color:'var(--gray-400)',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.parcelle}</td>
                                    </tr>
                                ); })}
                            </tbody>
                            </React.Fragment>);
                            })()}
                        </table>
                        </div>
                    </Panel>
                    );
                    })()}

                    {parcStats.length > 0 && (
                    <Panel title="Rendement par Parcelle" icon="fa-chart-bar">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Parcelle</th>
                                    <th>Ferme</th>
                                    <th>Nb Ouvriers</th>
                                    <th>Total Quantité</th>
                                    <th>Coût (DH)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parcStats.map((s, i) => (
                                    <tr key={i}>
                                        <td style={{fontWeight:500,fontSize:12}}>{s.parcelle}</td>
                                        <td><span className="status-badge" style={{background:'var(--berry-pale)',color:'var(--berry)',fontSize:10}}>{s.ferme}</span></td>
                                        <td>{s.nbOuv}</td>
                                        <td><strong>{Math.round(s.totalKg)}</strong></td>
                                        <td>{Math.round(s.totalCout).toLocaleString('fr-FR')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Panel>
                    )}

                    {/* Modal Rapport Récolte */}
                    {printPopup && ReactDOM.createPortal(
                        <div id="print-classement" style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:9999,background:'#fff',display:'flex',flexDirection:'column'}}>
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',paddingTop:'calc(14px + env(safe-area-inset-top, 0px))',borderBottom:'2px solid #f0f0f0',background:'#fff',minHeight:50}}>
                                <button onClick={() => setPrintPopup(null)} style={{background:'var(--berry-pale)',border:'none',fontSize:15,cursor:'pointer',display:'flex',alignItems:'center',gap:8,color:'var(--berry)',fontWeight:700,padding:'8px 14px',borderRadius:10}}>
                                    <i className="fa-solid fa-arrow-left"></i> Retour
                                </button>
                                <span style={{fontWeight:700,fontSize:14}}>Classement {printPopup.ferme}</span>
                                {!printPopup.pdfUrl ? (
                                <button onClick={() => {
                                    if (!window.jspdf) return alert('jsPDF non disponible');
                                    const { jsPDF } = window.jspdf;
                                    const doc = new jsPDF('p', 'mm', 'a4');
                                    const W = 210, M = 15;
                                    const list = printPopup.list;
                                    let y = 18;
                                    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(139, 34, 82);
                                    doc.text('Classement Récolte — ' + printPopup.ferme, M, y);
                                    y += 6;
                                    doc.setFontSize(9); doc.setTextColor(100);
                                    doc.text(printPopup.dateLabel + ' — ' + list.length + ' ouvriers', M, y);
                                    y += 8;
                                    const drawHeader = () => {
                                        doc.setFillColor(139, 34, 82); doc.rect(M, y, W - 2 * M, 7, 'F');
                                        doc.setTextColor(255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
                                        doc.text('#', M + 2, y + 5);
                                        doc.text('Ouvrier', M + 14, y + 5);
                                        doc.text('Kg', M + 120, y + 5);
                                        doc.text('Prime', M + 145, y + 5);
                                        y += 7;
                                    };
                                    drawHeader();
                                    doc.setFont('helvetica', 'normal');
                                    list.forEach((r, i) => {
                                        if (y > 272) { doc.addPage(); y = 15; drawHeader(); }
                                        if (i % 2 === 0) { doc.setFillColor(250, 248, 250); doc.rect(M, y, W - 2 * M, 6.5, 'F'); }
                                        if (i === 0) { doc.setFillColor(255, 215, 0); doc.circle(M + 5, y + 3.2, 3, 'F'); doc.setTextColor(255); }
                                        else if (i === 1) { doc.setFillColor(192, 192, 192); doc.circle(M + 5, y + 3.2, 3, 'F'); doc.setTextColor(255); }
                                        else if (i === 2) { doc.setFillColor(205, 127, 50); doc.circle(M + 5, y + 3.2, 3, 'F'); doc.setTextColor(255); }
                                        else { doc.setTextColor(100); }
                                        doc.setFontSize(7); doc.setFont('helvetica', 'bold');
                                        doc.text(String(r.rank), M + 5, y + 4.2, { align: 'center' });
                                        doc.setTextColor(50); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                                        doc.text((r.nom || r.matricule || '').substring(0, 45), M + 14, y + 4.2);
                                        doc.setFont('helvetica', 'bold');
                                        doc.text(String(r.kilos), M + 120, y + 4.2);
                                        doc.setTextColor(r.prime > 0 ? 45 : 180, r.prime > 0 ? 139 : 180, r.prime > 0 ? 78 : 180);
                                        doc.text(r.prime > 0 ? r.prime + ' DH' : '-', M + 145, y + 4.2);
                                        y += 6.5;
                                    });
                                    y += 5;
                                    doc.setFontSize(7); doc.setTextColor(170);
                                    doc.text('Berry Good Farms — Smart BERRY', W / 2, y, { align: 'center' });
                                    const fileName = 'Classement_' + printPopup.ferme + '_' + (printPopup.dateStr || '');
                                    doc.setProperties({ title: fileName, subject: 'Classement Récolte', creator: 'Smart BERRY' });
                                    const blob = doc.output('blob');
                                    const fullName = fileName + '.pdf';
                                    const isMobileDev = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
                                    if (isMobileDev) {
                                        // Mobile browsers don't render blob: PDFs in iframes — share/download directly
                                        const file = new File([blob], fullName, {type:'application/pdf'});
                                        if (navigator.canShare && navigator.canShare({files:[file]})) {
                                            navigator.share({ files:[file], title: fullName }).catch(() => {});
                                        } else {
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a'); a.href = url; a.download = fullName;
                                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                            setTimeout(() => URL.revokeObjectURL(url), 5000);
                                        }
                                    } else {
                                        const url = URL.createObjectURL(blob);
                                        setPrintPopup(prev => ({...prev, pdfUrl: url, pdfFileName: fullName}));
                                    }
                                }} style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                    <i className="fa-solid fa-file-pdf" style={{marginRight:4}}></i> PDF
                                </button>
                                ) : (
                                <div style={{display:'flex',gap:8}}>
                                    <button onClick={() => {
                                        if (navigator.share) {
                                            fetch(printPopup.pdfUrl).then(r => r.blob()).then(blob => {
                                                const file = new File([blob], printPopup.pdfFileName, {type:'application/pdf'});
                                                navigator.share({ files: [file], title: printPopup.pdfFileName });
                                            });
                                        } else {
                                            const a = document.createElement('a'); a.href = printPopup.pdfUrl; a.download = printPopup.pdfFileName;
                                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                        }
                                    }} style={{background:'var(--green)',color:'#fff',border:'none',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                        <i className={'fa-solid ' + (navigator.share ? 'fa-share-nodes' : 'fa-download')} style={{marginRight:4}}></i> {navigator.share ? 'Partager' : 'Télécharger'}
                                    </button>
                                    <button onClick={() => setPrintPopup(prev => ({...prev, pdfUrl: null, pdfFileName: null}))} style={{background:'#eee',color:'#666',border:'none',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                                        <i className="fa-solid fa-list" style={{marginRight:4}}></i> Liste
                                    </button>
                                </div>
                                )}
                            </div>
                            {printPopup.pdfUrl ? (
                                <iframe src={printPopup.pdfUrl} style={{flex:1,border:'none',width:'100%'}} title="PDF Classement"></iframe>
                            ) : (
                            <div style={{flex:1,overflowY:'auto',padding:'16px',WebkitOverflowScrolling:'touch'}}>
                                <h2 style={{fontSize:16,color:'var(--berry)',margin:'0 0 4px'}}>Classement Récolte — {printPopup.ferme} <span style={{background:'var(--berry)',color:'#fff',padding:'2px 10px',borderRadius:12,fontSize:12,fontWeight:700}}>{printPopup.totalKgPrint} kg</span></h2>
                                <div style={{fontSize:11,color:'#666',marginBottom:12}}>{printPopup.dateLabel} — {printPopup.list.length} ouvriers</div>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                    <thead>
                                        <tr style={{background:'#f5f0f2'}}>
                                            <th style={{padding:'8px 6px',textAlign:'left',fontSize:11,color:'var(--berry)',borderBottom:'2px solid var(--berry)'}}>#</th>
                                            <th style={{padding:'8px 6px',textAlign:'left',fontSize:11,color:'var(--berry)',borderBottom:'2px solid var(--berry)'}}>Ouvrier</th>
                                            <th style={{padding:'8px 6px',textAlign:'left',fontSize:11,color:'var(--berry)',borderBottom:'2px solid var(--berry)'}}>Kg</th>
                                            <th style={{padding:'8px 6px',textAlign:'left',fontSize:11,color:'var(--berry)',borderBottom:'2px solid var(--berry)'}}>Prime</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {printPopup.list.map((r, i) => (
                                            <tr key={i} style={{background: i % 2 === 0 ? '#fff' : '#fafafa'}}>
                                                <td style={{padding:'6px',borderBottom:'1px solid #eee'}}>
                                                    <span style={{display:'inline-block',width:22,height:22,lineHeight:'22px',textAlign:'center',borderRadius:'50%',fontSize:10,fontWeight:700,
                                                        background: i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'#eee',
                                                        color: i<3?'#fff':'#666'}}>{r.rank}</span>
                                                </td>
                                                <td style={{padding:'6px',borderBottom:'1px solid #eee',fontWeight:500,fontSize:12}}>{r.nom || r.matricule}</td>
                                                <td style={{padding:'6px',borderBottom:'1px solid #eee',fontWeight:700}}>{r.kilos}</td>
                                                <td style={{padding:'6px',borderBottom:'1px solid #eee',color:r.prime>0?'var(--green)':'#ccc',fontWeight:r.prime>0?600:400}}>{r.prime > 0 ? r.prime + ' DH' : '-'}</td>
                                            </tr>
                                        ))}
                                        <tr style={{background:'#f5f0f2',fontWeight:700}}>
                                            <td colSpan={2} style={{padding:'8px 6px'}}>TOTAL</td>
                                            <td style={{padding:'8px 6px',fontWeight:800}}>{printPopup.totalKgPrint} kg</td>
                                            <td style={{padding:'8px 6px',color:'var(--green)',fontWeight:700}}>{printPopup.totalPrimePrint} DH</td>
                                        </tr>
                                    </tbody>
                                </table>
                                <div style={{textAlign:'center',fontSize:9,color:'#aaa',marginTop:16}}>Berry Good Farms — Smart BERRY</div>
                            </div>
                            )}
                        </div>,
                        document.body
                    )}
                </div>
            );
        }

export { RecolteTab };
