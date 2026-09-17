/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): PointageTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { displayParcelle } from '../agronomie/displayParcelle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { PROFILES } from '../shared/PROFILES.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { deriveSubFerme } from '../shared/deriveSubFerme.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { WorkerLink } from './WorkerLink.jsx';
import { loadPointageDistinctDays } from './loadPointageDistinctDays.jsx';

import * as PaieUtils from '../shared/lib/paieUtils.js';
import * as AnalytiqueUtils from '../shared/lib/analytiqueUtils.js';
import { PointageValidationPanel } from './PointageValidationPanel.jsx';
// ===================== POINTAGE TAB =====================
        function PointageTab({ data, farmFilter, avoSubFilter, currentProfile, isValidation }) {
            // Pretty parcelle label via PARCELLES_CULTURALES.designations
            const prettyParcelle = React.useCallback((raw, ferme) => {
                if (!raw) return raw;
                const lower = String(raw).toLowerCase().trim();
                const pc = PARCELLES_CULTURALES.find(p =>
                    (!ferme || p.ferme === ferme) &&
                    (p.designations || []).some(d => {
                        const dl = d.toLowerCase();
                        return dl === lower || lower.includes(dl) || dl.includes(lower);
                    })
                );
                if (pc) {
                    const sect = (pc.secteurs || []).join('/');
                    return [sect, pc.variete, pc.sousVariete].filter(Boolean).join(' ');
                }
                return String(raw).replace(/\s+F[1-9]\s*$/i, '').replace(/\s+/g, ' ').trim()
                    .toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
            }, []);
            const [apiData, setApiData] = useState(null);
            const [detailRows, setDetailRows] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDate, setSelectedDate] = useState('');
            const [dates, setDates] = useState([]);
            const [expandedEqs, setExpandedEqs] = useState({});
            const toggleEq = (key) => setExpandedEqs(prev => ({...prev, [key]: !prev[key]}));
            const [expandedFermes, setExpandedFermes] = useState({});
            const toggleFerme = (key) => setExpandedFermes(prev => ({...prev, [key]: !prev[key]}));
            const [presenceData, setPresenceData] = useState({ rows: [], syncedAt: null });
            const presenceByMat = React.useMemo(() => Object.fromEntries((presenceData.rows || []).map(r => [(r.matricule || '').toUpperCase().trim(), r])), [presenceData]);
            const lookupPresence = (mat) => presenceByMat[(mat || '').toUpperCase().trim()] || null;
            const [workerPopup, setWorkerPopup] = useState(null);
            // Contexte de navigation de la fiche ouvrier : liste des enregistrements bruts
            // de l'équipe d'où vient le clic + index courant. Permet les flèches ◀/▶ (et
            // les touches clavier) pour passer à l'ouvrier précédent/suivant DE LA MÊME ÉQUIPE.
            // null quand la fiche n'est pas ouverte depuis un breakdown navigable.
            const [workerNav, setWorkerNav] = useState(null); // { list: [rawRecord], index }
            // Ouvre la fiche ouvrier depuis une liste d'équipe (raws) à un index donné.
            // Réutilise le même mécanisme que setWorkerPopup (calcul paie client-side via PaieUtils).
            const openWorkerFromNav = (list, index) => {
                if (!list || !list.length) return;
                const i = ((index % list.length) + list.length) % list.length; // boucle (wrap)
                setWorkerNav({ list, index: i });
                setWorkerPopup(list[i]);
            };
            const closeWorkerPopup = () => { setWorkerPopup(null); setWorkerNav(null); };
            // Navigation clavier dans la fiche ouvrier : ◀/▶ = ouvrier précédent/suivant (boucle),
            // Escape = fermer. Actif uniquement quand la fiche est ouverte.
            React.useEffect(() => {
                if (!workerPopup) return;
                const onKey = (e) => {
                    if (e.key === 'Escape') { closeWorkerPopup(); return; }
                    if (!workerNav || workerNav.list.length <= 1) return;
                    if (e.key === 'ArrowLeft') { e.preventDefault(); openWorkerFromNav(workerNav.list, workerNav.index - 1); }
                    else if (e.key === 'ArrowRight') { e.preventDefault(); openWorkerFromNav(workerNav.list, workerNav.index + 1); }
                };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [workerPopup, workerNav]);
            // Popup breakdown KPI : liste des ouvriers d'une ferme pour un type donné (recolte/horsRecolte/postesFixes).
            const [pointagePopup, setPointagePopup] = useState(null); // { ferme, type, title }
            const [popGroupBy, setPopGroupBy] = useState('equipe');
            React.useEffect(() => {
                if (!pointagePopup) return;
                const onKey = (e) => { if (e.key === 'Escape') setPointagePopup(null); };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [pointagePopup]);
            // Modèle paie unifié pour la popup ouvrier : barèmes + registre + jours pointés distincts.
            const [paieBaremes, setPaieBaremes] = useState((PaieUtils && PaieUtils.PAIE_BAREMES_DEFAULT) || {});
            const [ouvriersRegistry, setOuvriersRegistry] = useState({}); // matricule → {declare, baselineJours, baselineDate, primeFonction}
            const [paieDistinctDays, setPaieDistinctDays] = useState(new Map()); // matricule → {joursPointes:Set, nom}
            const [visaStatus, setVisaStatus] = useState({});
            const [visaLoading, setVisaLoading] = useState(false);
            // Pointage Divers du jour (sous-traitants / transporteurs) — collection globale
            // pointage_divers/{date}, non scindée par ferme. Affiché dans le panneau de validation.
            const [diversEntries, setDiversEntries] = useState([]);
            const [uploadTimes, setUploadTimes] = useState([]);
            const [lastSyncTime, setLastSyncTime] = useState(null);
            const [postesFixes, setPostesFixes] = useState([]);
            const [showPostesFixes, setShowPostesFixes] = useState(false);
            const [expandedPostes, setExpandedPostes] = useState({});
            const isCaporal = currentProfile && currentProfile.startsWith('caporal_');
            // Modal states for double confirmation & rejection
            const [showSubmitModal, setShowSubmitModal] = useState(false);
            const [submitModalFerme, setSubmitModalFerme] = useState(null);
            const [showRejectModal, setShowRejectModal] = useState(false);
            const [rejectModalFerme, setRejectModalFerme] = useState(null);
            const [rejectModalRole, setRejectModalRole] = useState(null);
            const [rejectComment, setRejectComment] = useState('');
            // Caporal upload modal
            const [showCaporalModal, setShowCaporalModal] = useState(false);
            const [caporalModalFerme, setCaporalModalFerme] = useState(null);
            const [caporalFile, setCaporalFile] = useState(null);
            const [caporalUploading, setCaporalUploading] = useState(false);
            const caporalFileRef = React.useRef(null);

            const handleCaporalValidate = async () => {
                if (!caporalFile || !caporalModalFerme) return;
                setCaporalUploading(true);
                try {
                    const dateToUse = selectedDate || (dates[0] && dates[0].date);
                    // Read file as base64
                    const reader = new FileReader();
                    const base64 = await new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(caporalFile);
                    });
                    // Upload attachment
                    const uploadRes = await fetch('/api/validation?action=upload-attachment', {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ date: dateToUse, ferme: caporalModalFerme, file_base64: base64, filename: caporalFile.name, contentType: caporalFile.type })
                    });
                    const uploadJson = await uploadRes.json();
                    if (!uploadJson.success) { alert(uploadJson.error || 'Erreur upload'); setCaporalUploading(false); return; }
                    // Now validate with attachment URL
                    const valRes = await fetch('/api/validation?action=validate', {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ date: dateToUse, ferme: caporalModalFerme, role: 'caporal', profileId: currentProfile, pieceJointeUrl: uploadJson.url, pieceJointeFilename: uploadJson.filename })
                    });
                    const valJson = await valRes.json();
                    if (valJson.success) { loadVisaStatus(dateToUse); setShowCaporalModal(false); setCaporalFile(null); }
                    else alert(valJson.error || 'Erreur validation');
                } catch (e) { alert(e.message); }
                setCaporalUploading(false);
            };

            const calcPrime = (kg, variete, date) => { const k = kg || 0; const isMyr = /corina|corrina|cascade|breeze|myrtille|blue/i.test(variete || ''); if (isMyr) { const seuil = /breeze/i.test(variete || '') ? 25 : /cascade/i.test(variete || '') ? ((date || '') >= '2026-04-25' ? 30 : 25) : 30; return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0; } if (k < 20) return 0; if (k < 25) return 20; if (k < 30) return 40; if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10; return Math.round((90 + (k - 40) * 4) * 10) / 10; };

            const loadVisaStatus = (date) => {
                if (!date) return;
                fetch(`/api/validation?action=status&date=${date}`)
                    .then(r => r.json())
                    .then(json => { if (json.success) setVisaStatus(json.validations || {}); })
                    .catch(() => {});
            };

            const handleValidate = (ferme, role) => {
                setVisaLoading(true);
                const dateToUse = selectedDate || (dates[0] && dates[0].date);
                fetch('/api/validation?action=validate', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ date: dateToUse, ferme, role, profileId: currentProfile })
                }).then(r => r.json()).then(json => {
                    if (json.success) {
                        loadVisaStatus(dateToUse);
                        // Reload data after RH submission (data source switches to snapshot)
                        if (role === 'rh') loadData(dateToUse);
                    }
                    else alert(json.error || 'Erreur');
                }).catch(err => alert(err.message)).finally(() => setVisaLoading(false));
            };

            const handleUnlock = (ferme) => {
                if (!confirm('Déverrouiller le pointage ?')) return;
                setVisaLoading(true);
                const dateToUse = selectedDate || (dates[0] && dates[0].date);
                fetch('/api/validation?action=unlock', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ date: dateToUse, ferme, profileId: currentProfile })
                }).then(r => r.json()).then(json => {
                    if (json.success) { loadVisaStatus(dateToUse); loadData(dateToUse); window._refreshNotifications?.(); }
                }).catch(err => alert(err.message)).finally(() => setVisaLoading(false));
            };

            const handleReject = (ferme, role, comment) => {
                setVisaLoading(true);
                const dateToUse = selectedDate || (dates[0] && dates[0].date);
                fetch('/api/validation?action=reject', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ date: dateToUse, ferme, role, profileId: currentProfile, comment })
                }).then(r => r.json()).then(json => {
                    if (json.success) { loadVisaStatus(dateToUse); loadData(dateToUse); window._refreshNotifications?.(); }
                    else alert(json.error || 'Erreur');
                }).catch(err => alert(err.message)).finally(() => setVisaLoading(false));
            };

            const loadData = (date) => {
                const dateQuery = date ? `&date=${date}` : '';
                Promise.all([
                    fetch(`/api/pointage-rh?action=summary${dateQuery}`).then(r => r.json()),
                    fetch(`/api/pointage-rh?action=detail${dateQuery}`).then(r => r.json()),
                    fetch(`/api/pointage-rh?action=upload-times${dateQuery}`).then(r => r.json()).catch(() => ({ success: false })),
                    fetch(`/api/pointage-rh?action=postes-fixes${dateQuery}`).then(r => r.json()).catch(() => ({ success: false })),
                    fetch(`/api/pointage-rh?action=presence${dateQuery}`).then(r => r.json()).catch(() => ({ success: false })),
                ]).then(([summary, detail, uploads, fixes, presence]) => {
                    if (summary.success) setApiData(summary);
                    if (detail.success) setDetailRows(detail.rows || []);
                    if (uploads.success) {
                        setUploadTimes(uploads.uploads || []);
                        setLastSyncTime(uploads.lastTableWrite || null);
                    }
                    if (fixes.success) setPostesFixes(fixes.rows || []);
                    if (presence && presence.success) setPresenceData({ rows: presence.rows || [], syncedAt: presence.syncedAt || null });
                }).catch(err => console.warn('Pointage error:', err)).finally(() => setLoading(false));
            };

            React.useEffect(() => {
                loadData();
                cachedFetch('/api/pointage-rh?action=dates').then(json => {
                    if (json.success) {
                        setDates(json.dates || []);
                        if (json.dates && json.dates.length > 0) loadVisaStatus(json.dates[0].date);
                    }
                }).catch(() => {});
            }, []);

            // Charge les entrées Pointage Divers du jour (même source que l'onglet Pointage Divers :
            // /api/validation?action=divers-entries). Rafraîchi quand la date effective change.
            const diversDate = selectedDate || (dates[0] && dates[0].date) || '';
            React.useEffect(() => {
                if (!diversDate) { setDiversEntries([]); return; }
                fetch('/api/validation?action=divers-entries&date=' + diversDate)
                    .then(r => r.json())
                    .then(json => { setDiversEntries((json && json.success && json.data && json.data.entries) || []); })
                    .catch(() => setDiversEntries([]));
            }, [diversDate]);

            // Charge barèmes paie (une fois) pour la popup salaire.
            React.useEffect(() => {
                const db = firebase.firestore();
                let cancelled = false;
                db.collection('app_settings').doc('paie_baremes').get()
                    .then(doc => { if (!cancelled && doc.exists) setPaieBaremes(prev => ({ ...prev, ...doc.data() })); })
                    .catch(e => console.warn('paie_baremes load:', e));
                return () => { cancelled = true; };
            }, []);

            // Charge le registre ouvriers via la CF gatée /api/registry (get-registry) —
            // SÉCURITÉ PAIE (Étape 1) : plus de lecture client-direct de ouvriers_registry.
            // - Scope 'all' (RH/DG/Finance) : from/to ignorés côté serveur → registre complet.
            // - Scope CHEF : from/to REQUIS (sinon 400) → ses ouvriers (sa ferme, période).
            //   La popup Pointage est déjà cloisonnée serveur (Étape 0), donc les ouvriers
            //   affichés = son périmètre registry → aucune ligne dégradée.
            // Choix from/to : la quinzaine contenant la date active du tab (paieDateISO).
            //   Un chef ne doit jamais être appelé sans fenêtre ; on la dérive donc de la
            //   période courante de l'écran (jour 1–15 → 01..15 ; jour ≥16 → 16..fin de mois).
            // window.fetch est patché globalement pour injecter le Bearer token sur /api/*.
            const registryDateISO = selectedDate || (dates[0] && dates[0].date) || (apiData && apiData.date) || new Date().toISOString().slice(0, 10);
            React.useEffect(() => {
                if (!registryDateISO) return;
                let cancelled = false;
                const y = registryDateISO.slice(0, 7); // YYYY-MM
                const day = parseInt(registryDateISO.slice(8, 10), 10);
                const from = day <= 15 ? (y + '-01') : (y + '-16');
                // Dernier jour du mois via getDate() (valeur LOCALE) — surtout PAS
                // toISOString() qui décale d'un jour en TZ Africa/Casablanca (UTC+1) :
                // 2026-01-31T00:00 local → 2026-01-30T23:00Z → sliced '2026-01-30'.
                const _lastDay = new Date(parseInt(y.slice(0, 4), 10), parseInt(y.slice(5, 7), 10), 0).getDate();
                const to = day <= 15
                    ? (y + '-15')
                    : (y + '-' + String(_lastDay).padStart(2, '0'));
                const url = '/api/registry?action=get-registry&from=' + from + '&to=' + to;
                fetch(url)
                    .then(r => r.json())
                    .then(resp => {
                        if (cancelled) return;
                        if (!resp || !resp.success) { console.warn('registry load:', resp && resp.error); setOuvriersRegistry({}); return; }
                        const reg = {};
                        (resp.ouvriers || []).forEach(o => { reg[numKey(o.matricule)] = o; });
                        setOuvriersRegistry(reg);
                    })
                    .catch(e => { if (!cancelled) { console.warn('registry load:', e); setOuvriersRegistry({}); } });
                return () => { cancelled = true; };
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [registryDateISO]);

            // Calcule l'ancienneté (jours pointés distincts) pour la date sélectionnée.
            // Plage = de la plus ancienne baselineDate du registre jusqu'à la date sélectionnée.
            // Une seule requête sql_mirror_pointage, mise en cache dans paieDistinctDays.
            const paieDateISO = selectedDate || (dates[0] && dates[0].date) || (apiData && apiData.date) || new Date().toISOString().slice(0, 10);
            React.useEffect(() => {
                if (!paieDateISO) return;
                const regVals = Object.values(ouvriersRegistry);
                if (regVals.length === 0) return;
                const db = firebase.firestore();
                let cancelled = false;
                const minBase = regVals.map(r => r.baselineDate).filter(Boolean).sort()[0];
                const minDate = (minBase && minBase < paieDateISO) ? minBase : paieDateISO;
                loadPointageDistinctDays(db, minDate, paieDateISO)
                    .then(map => { if (!cancelled) setPaieDistinctDays(map); })
                    .catch(e => console.warn('paie distinct days:', e));
                return () => { cancelled = true; };
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [paieDateISO, ouvriersRegistry]);

            // Map prefix équipe → coût transport (remboursement), depuis data.transportConfig (même réf que l'onglet Équipes).
            const getEqPrefixForPaie = (mat) => {
                const m = String(mat || '').toUpperCase().trim();
                if (m.startsWith('HAFI')) return 'HA';
                const p2 = m.substring(0, 2);
                return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF';
            };
            const getTransportForMat = (mat) => {
                const team = (data.transportConfig || []).find(t => t.prefix === getEqPrefixForPaie(mat));
                if (!team) return 0;
                const hist = team.history || [];
                if (!hist.length) return Number(team.coutParOuvrier) || 0;
                // tarif courant (le plus récent) — la popup affiche l'estimation du jour
                const sorted = [...hist].sort((a, b) => (qOrder(b.effectiveFrom) - qOrder(a.effectiveFrom)));
                return Number((sorted[0] && sorted[0].coutParOuvrier) != null ? sorted[0].coutParOuvrier : team.coutParOuvrier) || 0;
            };
            // ordre quinzaine local (préfixe DD/MM/YYYY ou numéro) pour trier l'historique transport
            const qOrder = (s) => {
                if (!s) return 0;
                const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`).getTime();
                const n = String(s).match(/\d+/);
                return n ? parseInt(n[0], 10) : 0;
            };
            // Le registre ouvriers_registry est keyé par matricule NUMÉRIQUE (ex. "10764"),
            // alors que le pointage utilise des matricules À LETTRES (ex. "MMG10764").
            // numKey extrait la partie numérique pour faire correspondre les deux.
            const numKey = (m) => String(m || '').toUpperCase().replace(/[^0-9]/g, '');
            // Statut déclaré d'un matricule (défensif : absent → non déclaré).
            const isDeclareForMat = (mat) => { const r = ouvriersRegistry[numKey(mat)]; return !!(r && r.declare); };

            const handleDateChange = (d) => { setSelectedDate(d); setLoading(true); loadData(d); loadVisaStatus(d); };

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement pointage...</div></div>;
            if (!apiData) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--red)'}}><i className="fa-solid fa-triangle-exclamation fa-2x"></i><div style={{marginTop:12}}>Erreur chargement</div></div>;

            const matchSub = (r) => !avoSubFilter || deriveSubFerme(r.refParcelle, r.parcelle) === avoSubFilter;
            const pointage = farmFilter ? (apiData.pointageJour || []).filter(p => p.ferme === farmFilter) : (apiData.pointageJour || []);
            const weeklyTrend = (apiData.weeklyTrend || []).map(d => ({ ...d, jour: d.jourLabel || d.jour }));
            const filteredDetail = farmFilter ? detailRows.filter(r => r.ferme === farmFilter && matchSub(r)) : detailRows;
            const totalCout = pointage.reduce((s, p) => s + (p.cout || 0), 0);

            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-database" style={{marginRight:4}}></i>Firestore — {apiData.date}
                        </span>
                        <select value={selectedDate} onChange={e => handleDateChange(e.target.value)} style={{padding:'4px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600}}>
                            <option value="">Aujourd'hui</option>
                            {dates.filter(d => d.date !== new Date().toISOString().slice(0,10)).map(d => <option key={d.date} value={d.date}>{new Date(d.date+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})} ({d.nbOuv} ouv.)</option>)}
                        </select>
                    </div>

                    {/* Dernière synchro SQL + effectifs par ferme */}
                    {(lastSyncTime || uploadTimes.length > 0) && (
                        <div style={{marginBottom:14,display:'flex',gap:10,flexWrap:'wrap',alignItems:'stretch'}}>
                            {lastSyncTime && (
                                <div style={{flex:'1 1 160px',background:'#e3f2fd',borderRadius:10,padding:'10px 14px',border:'1px solid #90caf9'}}>
                                    <div style={{fontSize:11,fontWeight:700,color:'#1565c0',marginBottom:4}}>
                                        <i className="fa-solid fa-clock-rotate-left" style={{marginRight:6}}></i>Dernière synchro SQL
                                    </div>
                                    <div style={{fontSize:18,fontWeight:800,color:'#1565c0'}}>
                                        {new Date(lastSyncTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    <div style={{fontSize:10,color:'#1565c0',opacity:0.7,marginTop:2}}>
                                        {new Date(lastSyncTime).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                                    </div>
                                </div>
                            )}
                            {uploadTimes.filter(u => !farmFilter || u.ferme === farmFilter).map(u => {
                                const colorMap = { F1: { bg: '#f3e5f5', color: '#8B2252', border: '#ce93d8' }, F5: { bg: '#e8f5e9', color: '#2D8B4E', border: '#81c784' }, Avocatier: { bg: '#fff8e1', color: '#D4A847', border: '#ffd54f' } };
                                const c = colorMap[u.ferme] || { bg: '#f5f5f5', color: '#666', border: '#ccc' };
                                return (
                                    <div key={u.ferme} style={{flex:'1 1 120px',background:c.bg,borderRadius:10,padding:'10px 14px',border:`1px solid ${c.border}`}}>
                                        <div style={{fontSize:11,fontWeight:700,color:c.color,marginBottom:4}}>
                                            <i className="fa-solid fa-users" style={{marginRight:6}}></i>{u.ferme}
                                        </div>
                                        <div style={{fontSize:18,fontWeight:800,color:c.color}}>{u.nbOuv}</div>
                                        <div style={{fontSize:10,color:c.color,opacity:0.7,marginTop:2}}>ouvriers pointés</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Barre Visa / Validation — masquée pour Dir. Technique */}
                    {currentProfile !== 'dt' && (() => {
                        const fermes = farmFilter ? [farmFilter] : ['F1', 'F5', 'Avocatier'];
                        const dateToUse = selectedDate || (dates[0] && dates[0].date) || apiData.date;
                        const isRH = currentProfile === 'rh';
                        const isCaporal = currentProfile && currentProfile.startsWith('caporal_');
                        const caporalFarm = isCaporal ? (PROFILES.find(p => p.id === currentProfile) || {}).farm : null;
                        const isChef = currentProfile && currentProfile.startsWith('chef_');
                        return (
                        <div style={{marginBottom:14,padding:'10px 14px',background:'#f8f9fa',borderRadius:10,border:'1px solid var(--gray-200)'}}>
                            <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:'var(--gray-600)'}}>
                                <i className="fa-solid fa-stamp" style={{marginRight:6}}></i>Validation Pointage — {dateToUse}
                            </div>
                            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                                {fermes.map(f => {
                                    const v = visaStatus[f] || {};
                                    const hasRH = !!v.visaRH;
                                    const hasCap = !!v.visaCaporal;
                                    const hasChef = !!v.visaChef;
                                    const isLocked = !!v.locked;
                                    const isRejected = !!v.rejected;
                                    const fermeUpload = uploadTimes.find(u => u.ferme === f);
                                    return (
                                    <div key={f} style={{flex:'1 1 200px',background:'#fff',borderRadius:8,padding:'8px 12px',border:isLocked ? '2px solid var(--green)' : isRejected ? '2px solid #e74c3c' : '1px solid var(--gray-200)'}}>
                                        <div style={{fontWeight:700,fontSize:12,marginBottom:6}}>{f} {isLocked && <i className="fa-solid fa-lock" style={{color:'var(--green)',marginLeft:4}}></i>}</div>
                                        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                                            <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:hasRH?'#d4edda':'#ffeeba',color:hasRH?'#155724':'#856404'}}>
                                                <i className={`fa-solid ${hasRH?'fa-check':'fa-clock'}`} style={{marginRight:3}}></i>RH
                                            </span>
                                            <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:hasCap?'#d4edda':'#f8d7da',color:hasCap?'#155724':'#721c24'}}>
                                                <i className={`fa-solid ${hasCap?'fa-check':'fa-clock'}`} style={{marginRight:3}}></i>Caporal
                                            </span>
                                            <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600,background:hasChef?'#d4edda':'#f8d7da',color:hasChef?'#155724':'#721c24'}}>
                                                <i className={`fa-solid ${hasChef?'fa-check':'fa-clock'}`} style={{marginRight:3}}></i>Chef
                                            </span>
                                        </div>
                                        {/* Rejection banner */}
                                        {isRejected && v.rejectionComment && (
                                            <div style={{fontSize:11,color:'#e74c3c',background:'rgba(231,76,60,0.08)',borderRadius:6,padding:'4px 8px',marginBottom:6,lineHeight:1.4}}>
                                                <i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>
                                                <strong>Rejet{v.rejectionRole === 'chef' ? ' Chef' : ' Caporal'} :</strong> {v.rejectionComment}
                                            </div>
                                        )}
                                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                                            {/* RH: Soumettre (opens confirmation modal) */}
                                            {isRH && !hasRH && !isLocked && !isRejected && (
                                                <button onClick={() => { setSubmitModalFerme(f); setShowSubmitModal(true); }} disabled={visaLoading}
                                                    style={{padding:'4px 10px',borderRadius:6,border:'none',background:'var(--berry)',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                    <i className="fa-solid fa-paper-plane" style={{marginRight:4}}></i>Soumettre
                                                </button>
                                            )}
                                            {/* RH: Re-soumettre after rejection (opens confirmation modal) */}
                                            {isRH && isRejected && (
                                                <button onClick={() => { setSubmitModalFerme(f); setShowSubmitModal(true); }} disabled={visaLoading}
                                                    style={{padding:'4px 10px',borderRadius:6,border:'none',background:'#e67e22',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                    <i className="fa-solid fa-rotate" style={{marginRight:4}}></i>Re-soumettre
                                                </button>
                                            )}
                                            {/* Caporal: Valider + Rejeter */}
                                            {isCaporal && caporalFarm === f && hasRH && !hasCap && !isLocked && (
                                                <button onClick={() => { setCaporalModalFerme(f); setCaporalFile(null); setShowCaporalModal(true); }} disabled={visaLoading}
                                                    style={{padding:'4px 10px',borderRadius:6,border:'none',background:'#e67e22',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                    <i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider Caporal
                                                </button>
                                            )}
                                            {isCaporal && caporalFarm === f && hasRH && !hasCap && !isLocked && (
                                                <button onClick={() => { setRejectModalFerme(f); setRejectModalRole('caporal'); setRejectComment(''); setShowRejectModal(true); }} disabled={visaLoading}
                                                    style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e74c3c',background:'#fff',color:'#e74c3c',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                    <i className="fa-solid fa-times" style={{marginRight:4}}></i>Rejeter
                                                </button>
                                            )}
                                            {/* Chef: Valider + Rejeter */}
                                            {isChef && hasCap && !hasChef && !isLocked && (
                                                <button onClick={() => handleValidate(f, 'chef')} disabled={visaLoading}
                                                    style={{padding:'4px 10px',borderRadius:6,border:'none',background:'var(--green)',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                    <i className="fa-solid fa-check-double" style={{marginRight:4}}></i>Valider Chef
                                                </button>
                                            )}
                                            {isChef && hasCap && !hasChef && !isLocked && (
                                                <button onClick={() => { setRejectModalFerme(f); setRejectModalRole('chef'); setRejectComment(''); setShowRejectModal(true); }} disabled={visaLoading}
                                                    style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e74c3c',background:'#fff',color:'#e74c3c',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                    <i className="fa-solid fa-times" style={{marginRight:4}}></i>Rejeter
                                                </button>
                                            )}
                                            {/* RH: Unlock — only if rejected, or DG override */}
                                            {(isRH || currentProfile === 'dg') && isLocked && (isRejected || currentProfile === 'dg') && (
                                                <button onClick={() => handleUnlock(f)} disabled={visaLoading}
                                                    style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--red)',background:'#fff',color:'var(--red)',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                                    <i className="fa-solid fa-lock-open" style={{marginRight:4}}></i>Déverrouiller
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                        );
                    })()}

                    {/* Modal de confirmation soumission RH */}
                    {showSubmitModal && submitModalFerme && (() => {
                        const dateToUse = selectedDate || (dates[0] && dates[0].date) || (apiData && apiData.date);
                        const fermeUpload = uploadTimes.find(u => u.ferme === submitModalFerme);
                        const workerCount = fermeUpload ? fermeUpload.nbOuv : 0;
                        const v = visaStatus[submitModalFerme] || {};
                        const isResubmit = !!v.rejected;
                        return (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
                            onClick={() => setShowSubmitModal(false)}>
                            <div style={{background:'white',borderRadius:16,padding:28,width:420,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
                                    <h3 style={{fontSize:16,fontWeight:700,color:isResubmit ? '#e67e22' : 'var(--berry)',margin:0}}>
                                        <i className={`fa-solid ${isResubmit ? 'fa-rotate' : 'fa-paper-plane'}`} style={{marginRight:8}}></i>
                                        {isResubmit ? 'Confirmer la re-soumission' : 'Confirmer la soumission'}
                                    </h3>
                                    <button onClick={() => setShowSubmitModal(false)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'var(--gray-400)'}}>&times;</button>
                                </div>
                                <div style={{background:'#f8f9fa',borderRadius:10,padding:16,marginBottom:18}}>
                                    <div style={{fontSize:13,marginBottom:8}}><strong>Date :</strong> {dateToUse}</div>
                                    <div style={{fontSize:13,marginBottom:8}}><strong>Ferme :</strong> {submitModalFerme}</div>
                                    <div style={{fontSize:13}}><strong>Ouvriers :</strong> {workerCount}</div>
                                </div>
                                <div style={{fontSize:12,color:'var(--gray-500)',marginBottom:18,lineHeight:1.5}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6,color:'#e67e22'}}></i>
                                    Une fois soumis, les donnees de pointage seront figees. Les modifications SQL ulterieures ne seront pas prises en compte pour cette ferme et cette date.
                                </div>
                                <div style={{display:'flex',gap:10}}>
                                    <button onClick={() => { handleValidate(submitModalFerme, 'rh'); setShowSubmitModal(false); }} disabled={visaLoading}
                                        style={{flex:1,padding:'12px',background:isResubmit ? '#e67e22' : 'var(--berry)',color:'white',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:6}}></i>Confirmer
                                    </button>
                                    <button onClick={() => setShowSubmitModal(false)}
                                        style={{padding:'12px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        </div>
                        );
                    })()}

                    {/* Modal de rejet (Caporal / Chef) */}
                    {showRejectModal && rejectModalFerme && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
                            onClick={() => setShowRejectModal(false)}>
                            <div style={{background:'white',borderRadius:16,padding:28,width:420,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                    <h3 style={{fontSize:16,fontWeight:700,color:'#e74c3c',margin:0}}>
                                        <i className="fa-solid fa-times-circle" style={{marginRight:8}}></i>Rejeter le pointage — {rejectModalFerme}
                                    </h3>
                                    <button onClick={() => setShowRejectModal(false)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'var(--gray-400)'}}>&times;</button>
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:6}}>Motif du rejet *</label>
                                    <textarea value={rejectComment} onChange={e => setRejectComment(e.target.value)}
                                        placeholder="Expliquez la raison du rejet..."
                                        style={{width:'100%',minHeight:80,borderRadius:8,border:'1px solid var(--gray-200)',padding:10,fontSize:13,resize:'vertical',boxSizing:'border-box'}} />
                                </div>
                                <div style={{display:'flex',gap:10}}>
                                    <button onClick={() => { handleReject(rejectModalFerme, rejectModalRole, rejectComment); setShowRejectModal(false); }}
                                        disabled={!rejectComment.trim() || visaLoading}
                                        style={{flex:1,padding:'12px',background:'#e74c3c',color:'white',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',opacity:rejectComment.trim() ? 1 : 0.5}}>
                                        <i className="fa-solid fa-times" style={{marginRight:6}}></i>Confirmer le rejet
                                    </button>
                                    <button onClick={() => setShowRejectModal(false)}
                                        style={{padding:'12px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Caporal validation modal with file upload */}
                    {showCaporalModal && caporalModalFerme && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
                            onClick={() => setShowCaporalModal(false)}>
                            <div style={{background:'white',borderRadius:16,padding:28,width:420,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                    <h3 style={{fontSize:16,fontWeight:700,color:'#e67e22',margin:0}}>
                                        <i className="fa-solid fa-check" style={{marginRight:8}}></i>Valider Caporal — {caporalModalFerme}
                                    </h3>
                                    <button onClick={() => setShowCaporalModal(false)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'var(--gray-400)'}}>&times;</button>
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:6}}>
                                        <i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scan du pointage papier *
                                    </label>
                                    <input type="file" ref={caporalFileRef} accept="image/*,.pdf" onChange={e => setCaporalFile(e.target.files[0] || null)}
                                        style={{width:'100%',fontSize:13,padding:8,border:'1px solid var(--gray-200)',borderRadius:8,boxSizing:'border-box'}} />
                                    {caporalFile && (
                                        <div style={{marginTop:6,fontSize:11,color:'var(--green)',fontWeight:600}}>
                                            <i className="fa-solid fa-file" style={{marginRight:4}}></i>{caporalFile.name} ({(caporalFile.size / 1024).toFixed(0)} Ko)
                                        </div>
                                    )}
                                </div>
                                <div style={{display:'flex',gap:10}}>
                                    <button onClick={handleCaporalValidate}
                                        disabled={!caporalFile || caporalUploading}
                                        style={{flex:1,padding:'12px',background:'#e67e22',color:'white',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',opacity:caporalFile ? 1 : 0.5}}>
                                        {caporalUploading ? (
                                            <span><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Envoi en cours...</span>
                                        ) : (
                                            <span><i className="fa-solid fa-check" style={{marginRight:6}}></i>Valider avec pièce jointe</span>
                                        )}
                                    </button>
                                    <button onClick={() => setShowCaporalModal(false)}
                                        style={{padding:'12px 20px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="kpi-grid">
                        {pointage.map(p => (
                            <KPICard key={p.ferme} icon="fa-user-check" iconClass={p.ferme === 'F1' ? 'berry' : (p.ferme === 'F5' ? 'green' : 'orange')} value={p.total} label={`Pointage ${p.ferme}`} change={p.diff}
                                onClick={() => setPointagePopup({ ferme: p.ferme, type: 'all', title: `Pointage ${p.ferme}` })}
                                subItems={[
                                    { value: p.recolte, label: 'Récolte', onClick: () => setPointagePopup({ ferme: p.ferme, type: 'recolte', title: `Récolte — ${p.ferme}` }) },
                                    { value: p.horsRecolte, label: 'Hors Récolte', onClick: () => setPointagePopup({ ferme: p.ferme, type: 'horsRecolte', title: `Hors Récolte — ${p.ferme}` }) },
                                    { value: p.postesFixes, label: 'Poste fixe', onClick: () => setPointagePopup({ ferme: p.ferme, type: 'postesFixes', title: `Poste fixe — ${p.ferme}` }) }
                                ]}
                            />
                        ))}
                        {!isCaporal && <KPICard icon="fa-coins" iconClass="orange" value={totalCout.toLocaleString('fr-FR')} label="Coût Total (DH)"
                            onClick={() => setPointagePopup({ ferme: farmFilter || null, type: 'all', title: farmFilter ? `Coût Total — ${farmFilter}` : 'Coût Total — Toutes Fermes' })} />}
                    </div>

                    {/* Popup breakdown KPI : ouvriers d'une ferme par type (récolte / hors récolte / poste fixe) */}
                    {pointagePopup && (() => {
                        const popRawRows = detailRows
                            .filter(r => (!pointagePopup.ferme || r.ferme === pointagePopup.ferme) && matchSub(r) && (pointagePopup.type === 'all' || r.type === pointagePopup.type));
                        // Net paie par ouvrier (1 journée) via computePayslip — remplace r.cout (valeur BDP brute).
                        const __PU = PaieUtils;
                        const __popFeries = (data.primesConfig && data.primesConfig.joursFeries) || [];
                        const __popIsFerie = __popFeries.some(jf => jf && jf.date === paieDateISO);
                        const __popSmag = (__PU && __PU.resolveSmagForDate)
                            ? __PU.resolveSmagForDate(paieBaremes, paieDateISO)
                            : { smagBrutJournalier: paieBaremes.smagBrutJournalier || 0, smagNetJournalier: paieBaremes.smagNetJournalier || 0 };
                        const computeNetJour = (mat) => {
                            if (!__PU || !__PU.computePayslip) return 0;
                            const reg = ouvriersRegistry[numKey(mat)] || {};
                            const declare = !!reg.declare;
                            const primeFonctionJour = Number(reg.primeFonctionJournaliere || 0);
                            const baselineDate = reg.baselineDate || '';
                            const baselineJours = Number(reg.baselineJours || 0);
                            const pt = paieDistinctDays.get(mat);
                            let joursDepuisBaseline = 0;
                            if (pt && pt.joursPointes) {
                                pt.joursPointes.forEach(dISO => { if (!baselineDate || dISO >= baselineDate) joursDepuisBaseline++; });
                            }
                            const anciennete = baselineJours + joursDepuisBaseline;
                            const ancienneteTaux = (__PU.trouverPalierAnciennete
                                ? __PU.trouverPalierAnciennete(anciennete, paieBaremes.paliers || [])
                                : { pourcentage: 0 }).pourcentage / 100;
                            const p = __PU.computePayslip({
                                declare,
                                smagBrut: __popSmag.smagBrutJournalier,
                                smagNet: __popSmag.smagNetJournalier,
                                jT: 1,
                                jF: (declare && __popIsFerie) ? 1 : 0,
                                ancienneteTaux,
                                primeFonctionJour,
                                primesOptionnelles: 0,
                                baremes: paieBaremes,
                            });
                            return p.netArrondi != null ? p.netArrondi : (p.net || 0);
                        };
                        const popWorkers = new Set(popRawRows.map(r => r.matricule)).size;
                        // Agrégation par OUVRIER (matricule) : 1 ligne par ouvrier dans le popup.
                        // Heures/opérations/parcelles agrégées ; cout = net paie computePayslip pour 1 journée.
                        const popAggMap = {};
                        popRawRows.forEach(r => {
                            const mat = r.matricule;
                            if (!popAggMap[mat]) {
                                popAggMap[mat] = {
                                    matricule: mat, nom: r.nom, raw: r,
                                    heures: 0, cout: computeNetJour(mat),
                                    operations: new Set(), parcelles: new Set()
                                };
                            }
                            const agg = popAggMap[mat];
                            agg.heures += (r.heures || 0);
                            if (r.operation) agg.operations.add(r.operation);
                            if (r.parcelle) agg.parcelles.add(r.parcelle);
                        });
                        // Total = somme des nets paie par ouvrier unique.
                        const popTotalCout = Object.values(popAggMap).reduce((s, a) => s + (a.cout || 0), 0);
                        // Formatage heures : arrondi 2 décimales, sans zéros inutiles (ex. 8, 8.5, 8.04).
                        const popFmtHeures = (h) => {
                            const v = Math.round((h || 0) * 100) / 100;
                            return Number.isInteger(v) ? String(v) : String(v).replace(/0+$/, '').replace(/\.$/, '');
                        };
                        // Parcelles multiples : au-delà de 3, format compact « P1, P2, P3 +N ».
                        const popFmtParcelles = (set) => {
                            const arr = [...set];
                            if (arr.length === 0) return '—';
                            if (arr.length <= 3) return arr.join(', ');
                            return arr.slice(0, 2).join(', ') + ' +' + (arr.length - 2);
                        };
                        const popRows = Object.values(popAggMap).map(a => ({
                            matricule: a.matricule, nom: a.nom, raw: a.raw,
                            heures: popFmtHeures(a.heures),
                            cout: a.cout,
                            operation: [...a.operations].join(', ') || '—',
                            parcelle: popFmtParcelles(a.parcelles),
                            parcelleTitle: [...a.parcelles].join(', ')
                        })).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
                        // Regroupement par équipe : MÊME logique que « Détail Pointage du Jour » / « Affectation des Équipes »
                        // (référentiel data.transportConfig). Code équipe = 2 LETTRES, HAFI→HA, catch-all « BGF ».
                        const popPrefixToName = {};
                        (data.transportConfig || []).forEach(t => { popPrefixToName[t.prefix] = t.equipe; });
                        const popEqName = (eq) => eq === 'BGF' ? 'BGF' : (popPrefixToName[eq] || `Équipe ${eq}`);
                        const popGetEq = (mat) => { const m = String(mat || '').toUpperCase().trim(); if (m.startsWith('HAFI')) return 'HA'; const p2 = m.substring(0,2); if (p2 === 'BG') return 'BGF'; return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF'; };
                        // Groupes : { prefix, nom, rows[] }. popRows déjà trié par nom → ordre interne conservé.
                        const popGroupsMap = {};
                        popRows.forEach(r => {
                            const eq = popGetEq(r.matricule);
                            if (!popGroupsMap[eq]) popGroupsMap[eq] = { prefix: eq, nom: popEqName(eq), rows: [] };
                            popGroupsMap[eq].rows.push(r);
                        });
                        // Tri des groupes : effectif (ouvriers distincts) décroissant, puis nom d'équipe.
                        const popGroups = Object.values(popGroupsMap).map(g => ({
                            ...g,
                            count: new Set(g.rows.map(r => r.matricule)).size,
                            coutTotal: g.rows.reduce((s, r) => s + (r.cout || 0), 0)
                        })).sort((a, b) => (b.count - a.count) || a.nom.localeCompare(b.nom));

                        // Alternative groupings: par ferme, par parcelle
                        const popFermeMap = {};
                        popRows.forEach(r => {
                            const gk = r.raw?.ferme || '—';
                            if (!popFermeMap[gk]) popFermeMap[gk] = { prefix: gk, nom: gk, rows: [], count: 0, coutTotal: 0 };
                            popFermeMap[gk].rows.push(r);
                            popFermeMap[gk].count++;
                            popFermeMap[gk].coutTotal += (r.cout || 0);
                        });
                        const popFermeGroups = Object.values(popFermeMap).sort((a, b) => b.count - a.count);

                        const popParcMap = {};
                        popRows.forEach(r => {
                            const parcs = r.raw?.parcelle ? [r.raw.parcelle] : (r.parcelle && r.parcelle !== '—' ? [r.parcelle] : []);
                            if (parcs.length === 0) parcs.push('—');
                            parcs.forEach(gk => {
                                if (!popParcMap[gk]) popParcMap[gk] = { prefix: gk, nom: gk, rows: [], count: 0, coutTotal: 0 };
                                if (!popParcMap[gk].rows.find(x => x.matricule === r.matricule)) {
                                    popParcMap[gk].rows.push(r);
                                    popParcMap[gk].count++;
                                    popParcMap[gk].coutTotal += (r.cout || 0);
                                }
                            });
                        });
                        const popParcGroups = Object.values(popParcMap).sort((a, b) => b.count - a.count);

                        const _activeGroups = popGroupBy === 'equipe' ? popGroups
                            : popGroupBy === 'ferme' ? popFermeGroups
                            : popParcGroups;
                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setPointagePopup(null)}>
                                <div style={{background:'#fff',borderRadius:16,maxWidth:900,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                    <div style={{padding:'20px 24px',background:'linear-gradient(135deg, var(--berry) 0%, #6b1a3a 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                                        <div>
                                            <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-user-check" style={{marginRight:8}}></i>{pointagePopup.title}</div>
                                            <div style={{fontSize:12,opacity:0.85,marginTop:4}}>{apiData.date} — {popWorkers} ouvrier{popWorkers > 1 ? 's' : ''}{!isCaporal ? ` — ${Math.round(popTotalCout).toLocaleString('fr-FR')} DH` : ''}</div>
                                        </div>
                                        <button onClick={() => setPointagePopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    <div style={{padding:'12px 24px',borderBottom:'1px solid var(--gray-200)',display:'flex',gap:8,alignItems:'center'}}>
                                        <span style={{fontSize:11,color:'var(--gray-500)',marginRight:4}}>Regrouper par :</span>
                                        {[['equipe','Équipe'],['ferme','Ferme'],['parcelle','Parcelle']].map(([mode, label]) => (
                                            <button key={mode} onClick={() => setPopGroupBy(mode)}
                                                style={{padding:'4px 12px',borderRadius:8,border:`1px solid ${popGroupBy === mode ? 'var(--berry)' : 'var(--gray-300)'}`,fontSize:11,cursor:'pointer',fontWeight:600,
                                                    background: popGroupBy === mode ? 'var(--berry)' : 'transparent',
                                                    color: popGroupBy === mode ? '#fff' : 'var(--gray-600)'}}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{padding:'16px 24px'}}>
                                        {popRows.length === 0 ? (
                                            <div style={{color:'var(--gray-400)',fontSize:13,fontStyle:'italic',textAlign:'center',padding:'24px 0'}}>Aucun ouvrier.</div>
                                        ) : (
                                        <div className="table-responsive">
                                        <table className="data-table" style={{fontSize:12,margin:0}}>
                                            <thead>
                                                <tr style={{background:'var(--gray-50)'}}>
                                                    <th style={{padding:'6px 10px'}}>Matricule</th>
                                                    <th style={{padding:'6px 10px'}}>Nom</th>
                                                    <th style={{padding:'6px 10px'}}>Opération</th>
                                                    <th style={{padding:'6px 10px'}}>Parcelle</th>
                                                    <th style={{padding:'6px 10px',textAlign:'center'}}>Heures</th>
                                                    <th style={{padding:'6px 10px',textAlign:'center'}}>Entrée</th>
                                                    <th style={{padding:'6px 10px',textAlign:'center'}}>Sortie</th>
                                                    {!isCaporal && <th style={{padding:'6px 10px',textAlign:'right'}}>Coût (DH)</th>}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {_activeGroups.map((g) => (
                                                    <React.Fragment key={g.prefix}>
                                                        <tr style={{background:'var(--green-pale, #eef7ef)'}}>
                                                            <td colSpan={isCaporal ? 7 : 6} style={{padding:'8px 10px',fontWeight:700,color:'var(--green, #2e7d32)'}}>
                                                                <span style={{fontFamily:'monospace',fontSize:10,marginRight:6,opacity:0.7}}>{g.prefix}</span>
                                                                {g.nom}
                                                                <span style={{fontWeight:600,color:'var(--gray-500)',marginLeft:8}}>— {g.count} ouvrier{g.count > 1 ? 's' : ''}</span>
                                                            </td>
                                                            {!isCaporal && <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'var(--green, #2e7d32)'}}>{Math.round(g.coutTotal).toLocaleString('fr-FR')}</td>}
                                                        </tr>
                                                        {g.rows.map((r, i) => {
                                                            const pres = lookupPresence(r.matricule);
                                                            const navList = g.rows.map(x => x.raw).filter(Boolean);
                                                            return (
                                                            <tr key={g.prefix + '-' + i}
                                                                style={{cursor:'pointer',transition:'background 0.15s'}}
                                                                onClick={() => r.raw && openWorkerFromNav(navList, navList.indexOf(r.raw))}
                                                                onMouseEnter={e => e.currentTarget.style.background='#f0e6ec'}
                                                                onMouseLeave={e => e.currentTarget.style.background=''}>
                                                                <td style={{fontFamily:'monospace',fontSize:10,padding:'6px 10px',color:'var(--gray-400)'}}>{r.matricule}</td>
                                                                <td style={{fontWeight:600,padding:'6px 10px'}}>
                                                                    <span title={isDeclareForMat(r.matricule) ? 'Déclaré' : 'Non déclaré'} style={{marginRight:6}}>{isDeclareForMat(r.matricule) ? '🟢' : '🔴'}</span>
                                                                    {r.nom}
                                                                </td>
                                                                <td style={{fontSize:11,color:'var(--gray-500)',padding:'6px 10px'}}>{r.operation}</td>
                                                                <td style={{fontSize:10,color:'var(--gray-400)',padding:'6px 10px'}} title={r.parcelleTitle || r.parcelle}>{r.parcelle}</td>
                                                                <td style={{textAlign:'center',padding:'6px 10px'}}>{r.heures}h</td>
                                                                <td style={{textAlign:'center',fontFamily:'monospace',fontSize:11,padding:'6px 10px',color: pres && pres.heureEntree ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureEntree) || '—'}</td>
                                                                <td style={{textAlign:'center',fontFamily:'monospace',fontSize:11,padding:'6px 10px',color: pres && pres.heureSortie ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureSortie) || '—'}</td>
                                                                {!isCaporal && <td style={{fontWeight:700,textAlign:'right',padding:'6px 10px'}}>{Math.round(r.cout || 0).toLocaleString('fr-FR')}</td>}
                                                            </tr>
                                                            );
                                                        })}
                                                    </React.Fragment>
                                                ))}
                                            </tbody>
                                            {!isCaporal && popRows.length > 0 && (
                                            <tfoot>
                                                <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                                    <td colSpan={4} style={{padding:'6px 10px'}}>Total — {popWorkers} ouvrier{popWorkers > 1 ? 's' : ''}</td>
                                                    <td colSpan={3}></td>
                                                    <td style={{textAlign:'right',padding:'6px 10px'}}>{Math.round(popTotalCout).toLocaleString('fr-FR')}</td>
                                                </tr>
                                            </tfoot>
                                            )}
                                        </table>
                                        </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Affectation Ouvriers - Vue Chef de Ferme */}
                    {!isValidation && currentProfile && (currentProfile.startsWith('chef_') || currentProfile.startsWith('caporal_')) && filteredDetail.length > 0 && (() => {
                        // Classement par équipe : MÊME source/logique que l'onglet « Équipes — Primes de transport »
                        // (référentiel data.transportConfig). Code équipe = 2 LETTRES, HAFI→HA, catch-all « BGF ».
                        const transportConfig = data.transportConfig || [];
                        const prefixToName = {};
                        transportConfig.forEach(t => { prefixToName[t.prefix] = t.equipe; });
                        const eqName = (eq) => eq === 'BGF' ? 'BGF' : (prefixToName[eq] || `Équipe ${eq}`);
                        const getEq = (mat) => { const m = String(mat || '').toUpperCase().trim(); if (m.startsWith('HAFI')) return 'HA'; const p2 = m.substring(0,2); if (p2 === 'BG') return 'BGF'; return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF'; };
                        // Group by equipe → parcelles
                        const byEquipe = {};
                        filteredDetail.forEach(r => {
                            const eq = getEq(r.matricule);
                            if (!byEquipe[eq]) byEquipe[eq] = { parcelles: {}, ouvriers: new Set() };
                            byEquipe[eq].ouvriers.add(r.matricule);
                            const parc = r.parcelle || 'N/A';
                            if (!byEquipe[eq].parcelles[parc]) byEquipe[eq].parcelles[parc] = new Set();
                            byEquipe[eq].parcelles[parc].add(r.operationFamille || r.operation);
                        });
                        return (
                        <Panel title="Affectation des Équipes" icon="fa-sitemap">
                            <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8}}>Répartition des équipes sur les parcelles aujourd'hui.</div>
                            <table className="data-table" style={{fontSize:12}}>
                                <thead><tr><th>Équipe</th><th>Nb Ouvriers</th><th>Parcelle(s)</th><th>Opération(s)</th></tr></thead>
                                <tbody>
                                    {Object.entries(byEquipe).sort((a,b) => (a[0] === 'BGF' ? 1 : b[0] === 'BGF' ? -1 : b[1].ouvriers.size - a[1].ouvriers.size)).map(([eq, d]) => (
                                        <tr key={eq}>
                                            <td style={{fontWeight:700}}>{eqName(eq)}</td>
                                            <td style={{textAlign:'center',fontWeight:600}}>{d.ouvriers.size}</td>
                                            <td style={{fontSize:11}} title={Object.keys(d.parcelles).join(', ')}>{Object.keys(d.parcelles).map(p => prettyParcelle(p, farmFilter)).join(', ')}</td>
                                            <td style={{fontSize:10,color:'var(--gray-500)'}}>{[...new Set(Object.values(d.parcelles).flatMap(s => [...s]))].map(op => op.replace(/^\d+\.\s*/, '')).join(', ')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>
                        );
                    })()}

                    {!isValidation && (
                    <Panel title="Détail Pointage du Jour" icon="fa-clipboard-list">
                        <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8}}>
                            <i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>
                            Cliquez sur une ferme pour voir les ouvriers par équipe avec heures d'entrée/sortie.
                        </div>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>Ferme</th>
                                    <th>Récolte</th>
                                    <th>Hors Récolte</th>
                                    <th>Total Ouvriers</th>
                                    <th>Ouvriers Avocatier</th>
                                    <th>Veille</th>
                                    <th>Variation</th>
                                    {!isCaporal && <th>Coût (DH)</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {pointage.map(p => {
                                    const isOpen = !!expandedFermes[p.ferme];
                                    // Classement par équipe : MÊME source/logique que l'onglet « Équipes » (référentiel data.transportConfig).
                                    const eqColors = {'NA':'#8B2252','RE':'#c0392b','CA':'#8B4513','NV':'#6c3483','MM':'#2c3e50','AY':'#d35400','HT':'#16a085','HA':'#2980b9','KR':'#27ae60','JA':'#e74c3c','AZ':'#f39c12','CC':'#7f8c8d','BGF':'#95a5a6'};
                                    const prefixToName = {};
                                    (data.transportConfig || []).forEach(t => { prefixToName[t.prefix] = t.equipe; });
                                    const eqName = (eq) => eq === 'BGF' ? 'BGF' : (prefixToName[eq] || `Équipe ${eq}`);
                                    const getEq = (mat) => { const m = String(mat || '').toUpperCase().trim(); if (m.startsWith('HAFI')) return 'HA'; const p2 = m.substring(0,2); if (p2 === 'BG') return 'BGF'; return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF'; };
                                    const fermeRows = isOpen ? detailRows.filter(r => r.ferme === p.ferme && matchSub(r)) : [];
                                    const byEquipe = {};
                                    fermeRows.forEach(r => {
                                        const eq = getEq(r.matricule);
                                        if (!byEquipe[eq]) byEquipe[eq] = { prefix: eq, nom: eqName(eq), ouvriers: [] };
                                        byEquipe[eq].ouvriers.push(r);
                                    });
                                    const colSpan = isCaporal ? 8 : 9;
                                    return (
                                    <React.Fragment key={p.ferme}>
                                    <tr style={{cursor:'pointer'}} onClick={() => toggleFerme(p.ferme)}
                                        onMouseEnter={e => e.currentTarget.style.background='#fafafa'}
                                        onMouseLeave={e => e.currentTarget.style.background=''}>
                                        <td style={{textAlign:'center',color:'var(--gray-400)',width:24}}>
                                            <i className={`fa-solid fa-chevron-${isOpen ? 'down' : 'right'}`} style={{fontSize:10}}></i>
                                        </td>
                                        <td style={{fontWeight:600}}>{p.ferme}</td>
                                        <td>{p.recolte}</td>
                                        <td>{p.horsRecolte}</td>
                                        <td><strong>{p.total}</strong></td>
                                        <td>{p.postesFixes}</td>
                                        <td style={{color:'var(--gray-400)'}}>{p.veille}</td>
                                        <td>
                                            <span className={`status-badge ${p.diff >= 0 ? 'active' : 'danger'}`}>
                                                {p.diff >= 0 ? '+' : ''}{p.diff}%
                                            </span>
                                        </td>
                                        {!isCaporal && <td>{(p.cout || 0).toLocaleString('fr-FR')}</td>}
                                    </tr>
                                    {isOpen && (
                                    <tr>
                                        <td colSpan={colSpan} style={{background:'#fafafa',padding:'12px 16px'}}>
                                            {Object.values(byEquipe).length === 0 ? (
                                                <div style={{color:'var(--gray-400)',fontSize:12,fontStyle:'italic'}}>Aucun pointage détaillé.</div>
                                            ) : (
                                            <div style={{display:'flex',flexDirection:'column',gap:10}}>
                                                {Object.values(byEquipe).sort((a,b) => new Set(b.ouvriers.map(r=>r.matricule)).size - new Set(a.ouvriers.map(r=>r.matricule)).size).map(eq => {
                                                    const bgColor = eqColors[eq.prefix] || '#95a5a6';
                                                    const eqDistinct = new Set(eq.ouvriers.map(r=>r.matricule)).size;
                                                    return (
                                                    <div key={eq.prefix} style={{background:'#fff',border:'1px solid var(--gray-100)',borderRadius:10,overflow:'hidden'}}>
                                                        <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:'1px solid var(--gray-100)'}}>
                                                            <span style={{background:bgColor,color:'#fff',padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,minWidth:32,textAlign:'center'}}>{eq.prefix}</span>
                                                            <span style={{fontSize:13,fontWeight:600,color:'var(--gray-700)',flex:1}}>{eq.nom}</span>
                                                            <span style={{background:'rgba(52,152,219,0.1)',color:'var(--blue)',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:700}}>{eqDistinct} ouvrier{eqDistinct > 1 ? 's' : ''}</span>
                                                        </div>
                                                        <div className="table-responsive">
                                                        <table className="data-table" style={{fontSize:12,margin:0}}>
                                                            <thead>
                                                                <tr style={{background:'var(--gray-50)'}}>
                                                                    <th style={{padding:'6px 10px'}}>Matricule</th>
                                                                    <th style={{padding:'6px 10px'}}>Nom</th>
                                                                    <th style={{padding:'6px 10px'}}>Opération</th>
                                                                    <th style={{padding:'6px 10px'}}>Parcelle</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'center'}}>Heures</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'center'}}>Entrée</th>
                                                                    <th style={{padding:'6px 10px',textAlign:'center'}}>Sortie</th>
                                                                    {!isCaporal && <th style={{padding:'6px 10px',textAlign:'right'}}>Coût (DH)</th>}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(() => {
                                                                    // Agrégation par OUVRIER (matricule) : 1 ligne/ouvrier au lieu d'1 ligne/parcelle.
                                                                    // MÊME logique que le popup pointagePopup (popAggMap/popFmtParcelles/popFmtHeures, ~6068).
                                                                    // On somme heures + coût (n'altère aucun montant : agrégation d'affichage),
                                                                    // on fusionne opérations/parcelles distinctes. On conserve la 1re ligne brute
                                                                    // (raw) car le popup workerPopup attend un enregistrement complet
                                                                    // (type, ferme, operationFamille, quantite, variete, jour, hs…), absent de l'agrégat.
                                                                    const detailAgg = {};
                                                                    eq.ouvriers.forEach(r => {
                                                                        const mat = r.matricule;
                                                                        if (!detailAgg[mat]) {
                                                                            detailAgg[mat] = {
                                                                                matricule: mat, nom: r.nom, raw: r,
                                                                                heures: 0, cout: 0,
                                                                                operations: new Set(), parcelles: new Set()
                                                                            };
                                                                        }
                                                                        const a = detailAgg[mat];
                                                                        a.heures += (r.heures || 0);
                                                                        a.cout += (r.cout || 0);
                                                                        if (r.operation) a.operations.add(r.operation);
                                                                        if (r.parcelle) a.parcelles.add(r.parcelle);
                                                                    });
                                                                    const fmtHeures = (h) => {
                                                                        const v = Math.round((h || 0) * 100) / 100;
                                                                        return Number.isInteger(v) ? String(v) : String(v).replace(/0+$/, '').replace(/\.$/, '');
                                                                    };
                                                                    const fmtParcelles = (arr) => {
                                                                        if (arr.length === 0) return '—';
                                                                        if (arr.length <= 3) return arr.join(', ');
                                                                        return arr.slice(0, 2).join(', ') + ' +' + (arr.length - 2);
                                                                    };
                                                                    const detailRowsAgg = Object.values(detailAgg).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
                                                                    return detailRowsAgg.map((a, i) => {
                                                                        const pres = lookupPresence(a.matricule);
                                                                        const parcArr = [...a.parcelles];
                                                                        return (
                                                                        <tr key={i} style={{cursor:'pointer'}} onClick={() => openWorkerFromNav(detailRowsAgg.map(x => x.raw).filter(Boolean), i)}
                                                                            onMouseEnter={e => e.currentTarget.style.background='#f0e6ec'}
                                                                            onMouseLeave={e => e.currentTarget.style.background=''}>
                                                                            <td style={{fontFamily:'monospace',fontSize:10,padding:'6px 10px',color:'var(--gray-400)'}}>{a.matricule}</td>
                                                                            <td style={{fontWeight:600,padding:'6px 10px'}}>
                                                                                <span title={isDeclareForMat(a.matricule) ? 'Déclaré' : 'Non déclaré'} style={{marginRight:6}}>{isDeclareForMat(a.matricule) ? '🟢' : '🔴'}</span>
                                                                                {a.nom}
                                                                            </td>
                                                                            <td style={{fontSize:11,color:'var(--gray-500)',padding:'6px 10px'}}>{[...a.operations].join(', ') || '—'}</td>
                                                                            <td style={{fontSize:10,color:'var(--gray-400)',padding:'6px 10px'}} title={parcArr.join(', ')}>{fmtParcelles(parcArr)}</td>
                                                                            <td style={{textAlign:'center',padding:'6px 10px'}}>{fmtHeures(a.heures)}h</td>
                                                                            <td style={{textAlign:'center',fontFamily:'monospace',fontSize:11,padding:'6px 10px',color: pres && pres.heureEntree ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureEntree) || '—'}</td>
                                                                            <td style={{textAlign:'center',fontFamily:'monospace',fontSize:11,padding:'6px 10px',color: pres && pres.heureSortie ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureSortie) || '—'}</td>
                                                                            {!isCaporal && <td style={{fontWeight:700,textAlign:'right',padding:'6px 10px'}}>{Math.round(a.cout || 0).toLocaleString('fr-FR')}</td>}
                                                                        </tr>
                                                                        );
                                                                    });
                                                                })()}
                                                            </tbody>
                                                        </table>
                                                        </div>
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                            )}
                                        </td>
                                    </tr>
                                    )}
                                    </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </Panel>
                    )}

                    {/* Validation du pointage du jour PAR ÉQUIPE / PAR FERME (composant séparé) */}
                    {PointageValidationPanel && (selectedDate || (dates[0] && dates[0].date)) && (() => {
                        // Construit equipesParFerme depuis detailRows (MÊME logique getEq que ci-dessus).
                        const dateToUse = selectedDate || (dates[0] && dates[0].date);
                        const prefixToName = {};
                        const coutMap = {};
                        (data.transportConfig || []).forEach(t => { prefixToName[t.prefix] = t.equipe; coutMap[t.prefix] = (data.getCoutTransport ? data.getCoutTransport(t.prefix, null) : t.coutParOuvrier) || t.coutParOuvrier || 0; });
                        const eqName = (eq) => eq === 'BGF' ? 'BGF' : (prefixToName[eq] || `Équipe ${eq}`);
                        const getEq = (mat) => { const m = String(mat || '').toUpperCase().trim(); if (m.startsWith('HAFI')) return 'HA'; const p2 = m.substring(0, 2); if (p2 === 'BG') return 'BGF'; return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF'; };
                        const equipesParFerme = {};
                        (detailRows || []).filter(r => matchSub(r)).forEach(r => {
                            const ferme = r.ferme;
                            if (!ferme || ['F1', 'F5', 'Avocatier', 'BAHIA'].indexOf(ferme) < 0) return;
                            if (farmFilter && ferme !== farmFilter) return;
                            if (!equipesParFerme[ferme]) equipesParFerme[ferme] = { _eq: {}, diversCount: 0 };
                            const eq = getEq(r.matricule);
                            if (!equipesParFerme[ferme]._eq[eq]) equipesParFerme[ferme]._eq[eq] = { prefix: eq, nom: eqName(eq), _mats: new Set(), ouvriers: [] };
                            const bucket = equipesParFerme[ferme]._eq[eq];
                            if (!bucket._mats.has(r.matricule)) {
                                bucket._mats.add(r.matricule);
                                bucket.ouvriers.push({ matricule: r.matricule, nom: r.nom, operation: r.operation, parcelle: r.parcelle, heures: r.heures });
                            }
                        });
                        // Pointage Divers : collection globale pointage_divers/{date}, non scindée
                        // par ferme → on rattache la MÊME liste d'entrées à chaque ferme pour affichage.
                        const diversList = (diversEntries || []).map(e => ({
                            beneficiaire: e.beneficiaire || '',
                            matricule: e.matricule || '',
                            fonction: e.fonction || '',
                            tache: e.tache || '',
                            montant: Number(e.montant) || 0,
                        }));
                        const result = {};
                        Object.keys(equipesParFerme).forEach(ferme => {
                            const eqs = Object.values(equipesParFerme[ferme]._eq).map(e => ({
                                prefix: e.prefix, nom: e.nom, ouvriers: e.ouvriers,
                                coutTransport: (coutMap[e.prefix] || 0) * e.ouvriers.length,
                            })).sort((a, b) => b.ouvriers.length - a.ouvriers.length);
                            result[ferme] = { equipes: eqs, diversCount: diversList.length, diversEntries: diversList };
                        });
                        if (!Object.keys(result).length) return null;
                        return React.createElement(PointageValidationPanel, {
                            date: dateToUse,
                            currentProfile,
                            equipesParFerme: result,
                        });
                    })()}

                    {/* Pointage par Parcelle → Tâche → Équipe */}
                    {!isValidation && (() => {
                        // Classement par équipe : MÊME source/logique que l'onglet « Équipes » (référentiel data.transportConfig).
                        const eqColors = {
                            'NA': '#8B2252', 'RE': '#c0392b', 'CA': '#8B4513', 'NV': '#6c3483',
                            'MM': '#2c3e50', 'AY': '#d35400', 'HT': '#16a085', 'HA': '#2980b9',
                            'KR': '#27ae60', 'JA': '#e74c3c', 'AZ': '#f39c12', 'CC': '#7f8c8d',
                            'BGF': '#95a5a6'
                        };
                        const prefixToName = {};
                        (data.transportConfig || []).forEach(t => { prefixToName[t.prefix] = t.equipe; });
                        const eqName = (eq) => eq === 'BGF' ? 'BGF' : (prefixToName[eq] || `Équipe ${eq}`);
                        const getEqPrefix = (mat) => {
                            const m = String(mat || '').toUpperCase().trim();
                            if (m.startsWith('HAFI')) return 'HA';
                            const p2 = m.substring(0, 2);
                            if (p2 === 'BG') return 'BGF';
                            return /^[A-Z]{2}$/.test(p2) ? p2 : 'BGF';
                        };

                        // Build hierarchy: parcelle → tâche (operationFamille) → équipe → ouvriers
                        // Effectifs = matricules DISTINCTS à chaque niveau (Set). Coût = SOMME (inchangé).
                        const hierarchy = {};
                        filteredDetail.forEach(r => {
                            const parc = r.parcelle || 'N/A';
                            const tache = r.operationFamille || r.operation || 'Autre';
                            const eq = getEqPrefix(r.matricule);
                            if (!hierarchy[parc]) hierarchy[parc] = { parcelle: parc, displayName: displayParcelle(parc), ferme: r.ferme, culture: (normalizeParcelle(parc) || {}).culture || '', taches: {}, _mats: new Set(), nbOuv: 0, totalCout: 0 };
                            if (!hierarchy[parc].taches[tache]) hierarchy[parc].taches[tache] = { tache, equipes: {}, _mats: new Set(), nbOuv: 0 };
                            if (!hierarchy[parc].taches[tache].equipes[eq]) hierarchy[parc].taches[tache].equipes[eq] = { prefix: eq, nom: eqName(eq), ouvriers: [] };
                            hierarchy[parc].taches[tache].equipes[eq].ouvriers.push(r);
                            hierarchy[parc].taches[tache]._mats.add(r.matricule);
                            hierarchy[parc].taches[tache].nbOuv = hierarchy[parc].taches[tache]._mats.size;
                            hierarchy[parc]._mats.add(r.matricule);
                            hierarchy[parc].nbOuv = hierarchy[parc]._mats.size;
                            hierarchy[parc].totalCout += (r.cout || 0);
                        });

                        const parcelles = Object.values(hierarchy).sort((a, b) => b.nbOuv - a.nbOuv);

                        return parcelles.map(parc => (
                            <Panel key={parc.parcelle} title={parc.displayName} icon="fa-map-location-dot" actions={
                                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                                    {parc.culture && <span style={{fontSize:10,color:'var(--gray-400)',fontStyle:'italic'}}>{parc.culture}</span>}
                                    <span className="status-badge" style={{background: parc.ferme==='F1' ? 'var(--berry-pale)' : (parc.ferme==='F5' ? 'var(--green-pale)' : 'var(--orange-pale)'), color: parc.ferme==='F1' ? 'var(--berry)' : (parc.ferme==='F5' ? 'var(--green)' : 'var(--orange)'), fontSize:10}}>{parc.ferme}</span>
                                    <span style={{fontSize:12,fontWeight:700}}>{parc.nbOuv} ouvriers</span>
                                    {!isCaporal && <span style={{fontSize:11,color:'var(--gray-400)'}}>{Math.round(parc.totalCout).toLocaleString('fr-FR')} DH</span>}
                                </div>
                            }>
                                {Object.values(parc.taches).sort((a, b) => b.nbOuv - a.nbOuv).map(tache => (
                                    <div key={tache.tache} style={{marginBottom:20}}>
                                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,paddingBottom:8,borderBottom:'2px solid var(--gray-100)'}}>
                                            <div style={{width:28,height:28,borderRadius:8,background: tache.tache.includes('Récolte') ? 'rgba(231,76,60,0.1)' : (tache.tache.includes('fixe') ? 'rgba(52,152,219,0.1)' : 'rgba(46,204,113,0.1)'), display:'flex',alignItems:'center',justifyContent:'center'}}>
                                                <i className={`fa-solid ${tache.tache.includes('Récolte') ? 'fa-basket-shopping' : (tache.tache.includes('fixe') ? 'fa-anchor' : 'fa-trowel')}`} style={{color: tache.tache.includes('Récolte') ? '#e74c3c' : (tache.tache.includes('fixe') ? '#3498db' : '#2ecc71'), fontSize:12}}></i>
                                            </div>
                                            <span style={{fontWeight:700,fontSize:14}}>{tache.tache}</span>
                                            <span style={{background:'var(--gray-100)',color:'var(--gray-500)',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:600}}>{tache.nbOuv} ouvrier{tache.nbOuv > 1 ? 's' : ''}</span>
                                        </div>

                                        <div style={{display:'flex',flexDirection:'column',gap:6,marginLeft:4}}>
                                        {Object.values(tache.equipes).sort((a, b) => new Set(b.ouvriers.map(r=>r.matricule)).size - new Set(a.ouvriers.map(r=>r.matricule)).size).map(eq => {
                                            const eqKey = parc.parcelle + '|' + tache.tache + '|' + eq.prefix;
                                            const isOpen = expandedEqs[eqKey];
                                            const bgColor = eqColors[eq.prefix] || '#95a5a6';
                                            const eqDistinct = new Set(eq.ouvriers.map(r=>r.matricule)).size;
                                            return (
                                            <div key={eq.prefix} style={{background: isOpen ? '#fafafa' : '#fff', border:'1px solid var(--gray-100)', borderRadius:10, overflow:'hidden'}}>
                                                <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',cursor:'pointer',userSelect:'none'}} onClick={() => toggleEq(eqKey)}>
                                                    <span style={{background: bgColor, color:'#fff',padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:700,minWidth:32,textAlign:'center'}}>{eq.prefix}</span>
                                                    <span style={{fontSize:13,fontWeight:600,color:'var(--gray-700)',flex:1}}>{eq.nom}</span>
                                                    <span style={{background:'rgba(52,152,219,0.1)',color:'var(--blue)',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:700}}>{eqDistinct}</span>
                                                    <i className={`fa-solid fa-chevron-${isOpen ? 'up' : 'down'}`} style={{fontSize:10,color:'var(--gray-400)'}}></i>
                                                </div>
                                                {isOpen && (
                                                <div style={{borderTop:'1px solid var(--gray-100)',padding:'0 8px 8px'}}>
                                                <div className="table-responsive">
                                                <table className="data-table" style={{fontSize:12,margin:0}}>
                                                    <thead>
                                                        <tr style={{background:'var(--gray-50)'}}>
                                                            <th style={{padding:'8px 10px'}}>Matricule</th>
                                                            <th style={{padding:'8px 10px'}}>Nom</th>
                                                            <th style={{padding:'8px 10px'}}>Opération</th>
                                                            <th style={{padding:'8px 10px',textAlign:'center'}}>Heures</th>
                                                            <th style={{padding:'8px 10px',textAlign:'center'}}>Quantité</th>
                                                            {!isCaporal && <th style={{padding:'8px 10px',textAlign:'right'}}>Coût (DH)</th>}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {eq.ouvriers.sort((a, b) => (a.nom || '').localeCompare(b.nom || '')).map((r, i) => (
                                                            <tr key={i} style={{cursor:'pointer',transition:'background 0.15s'}} onClick={() => openWorkerFromNav(eq.ouvriers.slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || '')), i)}
                                                                onMouseEnter={e => e.currentTarget.style.background='#f0e6ec'}
                                                                onMouseLeave={e => e.currentTarget.style.background=''}>
                                                                <td style={{fontFamily:'monospace',fontSize:10,padding:'6px 10px',color:'var(--gray-400)'}}>{r.matricule}</td>
                                                                <td style={{fontWeight:600,padding:'6px 10px'}}><span title={isDeclareForMat(r.matricule) ? 'Déclaré' : 'Non déclaré'} style={{marginRight:6}}>{isDeclareForMat(r.matricule) ? '🟢' : '🔴'}</span><WorkerLink matricule={r.matricule} nom={r.nom} /></td>
                                                                <td style={{fontSize:11,color:'var(--gray-500)',padding:'6px 10px'}}>{r.operation}</td>
                                                                <td style={{textAlign:'center',padding:'6px 10px'}}>{r.heures}h</td>
                                                                <td style={{textAlign:'center',padding:'6px 10px',fontWeight: r.quantite ? 600 : 400}}>{r.quantite || '—'}</td>
                                                                {!isCaporal && <td style={{fontWeight:700,textAlign:'right',padding:'6px 10px'}}>{Math.round(r.cout || 0).toLocaleString('fr-FR')}</td>}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                </div>
                                                </div>
                                                )}
                                            </div>
                                        );})}
                                        </div>
                                    </div>
                                ))}
                            </Panel>
                        ));
                    })()}

                    {!isValidation && (
                    <Panel title="Évolution Pointage - Semaine" icon="fa-chart-area">
                        <SimpleBarChart data={weeklyTrend} dataKeys={pointage.map(p => p.ferme)} colors={['#8B2252', '#2D8B4E', '#D4A847']} xKey="jour" height={250} />
                        <div style={{display:'flex',gap:16,justifyContent:'center',marginTop:10,flexWrap:'wrap'}}>
                            {[{label:'F1',color:'#8B2252'},{label:'F5',color:'#2D8B4E'},{label:'Avocatier',color:'#D4A847'}].map(l => (
                                <div key={l.label} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600}}>
                                    <span style={{width:14,height:14,borderRadius:3,background:l.color,display:'inline-block'}}></span>
                                    {l.label}
                                </div>
                            ))}
                        </div>
                    </Panel>
                    )}

                    {/* Top 10 Hors Récolte + Postes Fixes */}
                    {!isValidation && (
                    <div className="two-col">
                        {/* Top 10 Hors Récolte */}
                        {(() => {
                            const topOpsRaw = (apiData.topOps || []).filter(o => (!farmFilter || o.ferme === farmFilter) && matchSub(o)).slice(0, 10);
                            if (topOpsRaw.length === 0) return null;
                            return (
                                <Panel title="Top 10 Hors Récolte" icon="fa-ranking-star">
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr><th>#</th><th>Opération</th><th>Parcelle</th><th>Ferme</th><th>Effectif</th><th>Heures</th></tr>
                                        </thead>
                                        <tbody>
                                            {topOpsRaw.map((op, i) => (
                                                <tr key={i}>
                                                    <td><span className={`rank ${i < 3 ? `rank-${i+1}` : 'rank-other'}`}>{i+1}</span></td>
                                                    <td style={{fontWeight:500,fontSize:11}}>{op.operation}</td>
                                                    <td style={{fontSize:10,color:'var(--gray-400)'}}>{op.parcelle}</td>
                                                    <td><span className="status-badge" style={{background:'var(--berry-pale)',color:'var(--berry)',fontSize:10}}>{op.ferme}</span></td>
                                                    <td style={{fontWeight:700,textAlign:'center'}}>{op.effectif}</td>
                                                    <td style={{color:'var(--gray-500)',textAlign:'center'}}>{op.heures ? `${Math.round(op.heures)}h` : '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </Panel>
                            );
                        })()}

                        {/* Postes Fixes */}
                        {(() => {
                            const fixesFiltered = farmFilter ? postesFixes.filter(r => r.ferme === farmFilter && matchSub(r)) : postesFixes;
                            if (fixesFiltered.length === 0) return null;
                            const byOp = {};
                            fixesFiltered.forEach(r => {
                                const op = r.operation || 'Autre';
                                if (!byOp[op]) byOp[op] = { operation: op, ouvriers: [], totalCout: 0 };
                                byOp[op].ouvriers.push(r);
                                byOp[op].totalCout += r.cout;
                            });
                            // Effectif = matricules DISTINCTS (un ouvrier multi-postes compte 1×).
                            // Le COÛT reste la SOMME des lignes (inchangé).
                            const distinctOuv = (rows) => new Set(rows.map(r => r.matricule)).size;
                            const ops = Object.values(byOp).sort((a, b) => distinctOuv(b.ouvriers) - distinctOuv(a.ouvriers));
                            const totalDistinctFixes = new Set(fixesFiltered.map(r => r.matricule)).size;
                            return (
                                <Panel title={`Ouvriers Avocatier (${totalDistinctFixes})`} icon="fa-anchor" actions={
                                    <button onClick={() => setShowPostesFixes(!showPostesFixes)} style={{background:'none',border:'1px solid var(--gray-200)',borderRadius:6,padding:'3px 10px',fontSize:10,fontWeight:600,cursor:'pointer',color:'var(--gray-500)'}}>
                                        <i className={`fa-solid fa-chevron-${showPostesFixes ? 'up' : 'down'}`} style={{marginRight:4}}></i>{showPostesFixes ? 'Réduire' : 'Détail'}
                                    </button>
                                }>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead><tr><th>Poste</th><th>Effectif</th>{!isCaporal && <th>Coût (DH)</th>}<th></th></tr></thead>
                                        <tbody>
                                            {ops.map((o, i) => {
                                                const isExpanded = expandedPostes[o.operation];
                                                return (
                                                <React.Fragment key={i}>
                                                    <tr style={{cursor:'pointer',background:isExpanded?'var(--berry-pale)':''}} onClick={() => setExpandedPostes(prev => ({...prev, [o.operation]: !prev[o.operation]}))}>
                                                        <td style={{fontWeight:500}}>{o.operation}</td>
                                                        <td style={{textAlign:'center',fontWeight:700}}>{distinctOuv(o.ouvriers)}</td>
                                                        {!isCaporal && <td style={{textAlign:'right',color:'var(--gray-500)'}}>{o.totalCout.toLocaleString('fr-FR')}</td>}
                                                        <td style={{textAlign:'center',width:30}}><i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`} style={{fontSize:10,color:'var(--gray-400)'}}></i></td>
                                                    </tr>
                                                    {isExpanded && o.ouvriers.sort((a, b) => (a.nom || '').localeCompare(b.nom || '')).map((r, j) => (
                                                        <tr key={i + '-' + j} style={{background:'var(--gray-50)',fontSize:11}}>
                                                            <td style={{paddingLeft:24}}><span title={isDeclareForMat(r.matricule) ? 'Déclaré' : 'Non déclaré'} style={{marginRight:6}}>{isDeclareForMat(r.matricule) ? '🟢' : '🔴'}</span><span style={{fontFamily:'monospace',fontSize:10,color:'var(--gray-400)',marginRight:6}}>{r.matricule}</span><WorkerLink matricule={r.matricule} nom={r.nom} /></td>
                                                            <td style={{textAlign:'center',color:'var(--gray-500)'}}>{r.heures}h</td>
                                                            {!isCaporal && <td style={{textAlign:'right',fontWeight:600}}>{Math.round(r.cout)}</td>}
                                                            <td></td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                                );
                                            })}
                                            <tr style={{fontWeight:700,borderTop:'2px solid var(--gray-200)'}}>
                                                <td>Total</td>
                                                <td style={{textAlign:'center'}}>{totalDistinctFixes}</td>
                                                {!isCaporal && <td style={{textAlign:'right'}}>{fixesFiltered.reduce((s, r) => s + r.cout, 0).toLocaleString('fr-FR')}</td>}
                                                <td></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </Panel>
                            );
                        })()}
                    </div>
                    )}

                    {/* Popup détail ouvrier */}
                    {workerPopup && (() => {
                        const r = workerPopup;
                        // Heures d'entrée/sortie badgeuse BEE ONE (collection prod_presence,
                        // indexée par matricule via presenceByMat). '—' si absent (fallback gracieux).
                        const pres = lookupPresence(r.matricule);
                        const primeRecolte = r.type === 'recolte' ? calcPrime(r.quantite, r.variete, r.jour) : 0;
                        const hs25 = r.hs25 || 0, hs50 = r.hs50 || 0, hs100 = r.hs100 || 0;
                        // Modèle paie complet (source unique PaieUtils). Cas défensif : ouvrier
                        // absent du registre → non déclaré, ancienneté 0, prime fonction 0 (pas de crash).
                        const reg = ouvriersRegistry[numKey(r.matricule)] || {};
                        const declare = !!reg.declare;
                        const baselineDate = reg.baselineDate || '';
                        const baselineJours = Number(reg.baselineJours || 0);
                        const primeFonctionJour = Number(reg.primeFonctionJournaliere || 0);
                        const pt = paieDistinctDays.get(r.matricule);
                        let joursDepuisBaseline = 0;
                        if (pt && pt.joursPointes) {
                            pt.joursPointes.forEach(dISO => { if (!baselineDate || dISO >= baselineDate) joursDepuisBaseline++; });
                        }
                        const anciennete = baselineJours + joursDepuisBaseline;
                        const joursTravailles = Number(r.jours || 0);
                        const primeTransport = getTransportForMat(r.matricule);
                        // Taux d'ancienneté (palier en %) résolu depuis le registre de jours distincts.
                        const __pal = (PaieUtils && PaieUtils.trouverPalierAnciennete)
                            ? PaieUtils.trouverPalierAnciennete(anciennete, paieBaremes.paliers || [])
                            : { palier: '—', pourcentage: 0 };
                        const ancienneteTaux = (__pal.pourcentage || 0) / 100;
                        // Jours fériés : nombre de jours de la période pointés qui tombent un férié.
                        // Pour la popup quotidienne, jF = 1 si paieDateISO est férié, sinon 0.
                        const __feries = (data.primesConfig && data.primesConfig.joursFeries) || [];
                        const __isFerie = __feries.some(jf => jf && jf.date === paieDateISO);
                        const joursFeries = (declare && __isFerie) ? joursTravailles : 0;
                        // SMAG daté (brut + net) à la date de paie.
                        const __smag = (PaieUtils && PaieUtils.resolveSmagForDate)
                            ? PaieUtils.resolveSmagForDate(paieBaremes, paieDateISO)
                            : { smagBrutJournalier: paieBaremes.smagBrutJournalier || 0, smagNetJournalier: paieBaremes.smagNetJournalier || 0 };
                        // Primes optionnelles soumises au brut (déclaré) : prime de récolte incluse ici.
                        const primesOptionnelles = declare && primeRecolte > 0 ? primeRecolte : 0;
                        const paie = (PaieUtils && PaieUtils.computePayslip)
                            ? PaieUtils.computePayslip({
                                declare,
                                smagBrut: __smag.smagBrutJournalier,
                                smagNet: __smag.smagNetJournalier,
                                jT: declare ? joursTravailles : joursTravailles,
                                jF: joursFeries,
                                ancienneteTaux,
                                primeFonctionJour,
                                primesOptionnelles,
                                baremes: paieBaremes,
                            })
                            : { declare, smagBase: 0, jT: 0, jF: 0, base: 0, feries: 0, ancienneteTaux: 0, anciennete: 0, primeFonctionJour: 0, primeFonction: 0, primesOptionnelles: 0, brut: 0, tauxCnss: 0, cnss: 0, tauxAmo: 0, amo: 0, net: 0, tauxChargesPatronales: 0, chargesPatronales: 0, coutEmployeur: 0, netArrondi: 0 };
                        // Nom d'équipe pour la ligne Transport (même réf que le classement par équipe).
                        const eqPrefix = getEqPrefixForPaie(r.matricule);
                        const eqNamePaie = eqPrefix === 'BGF' ? 'BGF' : (((data.transportConfig || []).find(t => t.prefix === eqPrefix) || {}).equipe || `Équipe ${eqPrefix}`);
                        // Affichage 2 décimales façon FR (virgule). Le helper reste pur (nombres bruts).
                        const f2 = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');
                        // Coût total employeur incluant le transport (séparé du coutEmployeur pur du helper).
                        const coutTotalEmployeur = (paie.coutEmployeur || 0) + (Number(primeTransport) || 0);
                        const navActive = !!(workerNav && workerNav.list && workerNav.list.length > 1);
                        // Résolution GB → Famille / Groupe MO (même référentiel qu'analytiqueUtils.js)
                        var _GB_REF = {
                            'GB01': { famille: 'Travaux du sol', groupe: 'M.O Hors récolte' },
                            'GB02': { famille: 'Ferti-irrigation', groupe: 'M.O Hors récolte' },
                            'GB03': { famille: 'Plantation', groupe: 'M.O Hors récolte' },
                            'GB04': { famille: 'Mise en valeur', groupe: 'M.O Hors récolte' },
                            'GB05': { famille: 'Entretien structure', groupe: 'M.O Hors récolte' },
                            'GB06': { famille: 'Traitement phyto', groupe: 'M.O Hors récolte' },
                            'GB07': { famille: 'Tuteurage & palissage', groupe: 'M.O Hors récolte' },
                            'GB08': { famille: 'Récolte', groupe: 'M.O Récolte' },
                            'GB09': { famille: 'Taille', groupe: 'M.O Hors récolte' },
                            'GB10': { famille: 'Arrachage', groupe: 'M.O Hors récolte' },
                            'GB11': { famille: 'Services généraux', groupe: 'M.O Service générale' },
                        };
                        var _gbRef = _GB_REF[String(r.groupe || '').trim().toUpperCase()] || null;
                        if (!_gbRef && r.operationFamille && AnalytiqueUtils) {
                            var _gbCodeFallback = AnalytiqueUtils.resolveGbCode('', r.operationFamille);
                            if (_gbCodeFallback) _gbRef = _GB_REF[_gbCodeFallback] || null;
                        }
                        return (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => closeWorkerPopup()}>
                            <div style={{background:'#fff',borderRadius:12,maxWidth:480,width:'100%',maxHeight:'80vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 20px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div>
                                        <h3 style={{margin:0,fontSize:16,color:'var(--berry)'}}><i className="fa-solid fa-user" style={{marginRight:8}}></i>{r.nom}</h3>
                                        <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2,fontFamily:'monospace'}}>{r.matricule}</div>
                                        <div style={{marginTop:6}}>
                                            <span style={{display:'inline-block',padding:'2px 10px',borderRadius:12,fontSize:11,fontWeight:700,background: declare ? 'var(--green-pale)' : 'var(--red-pale)', color: declare ? 'var(--green)' : 'var(--red)'}}>
                                                {declare ? '🟢 Déclaré' : '🔴 Non déclaré'}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                                        {navActive && (
                                        <div style={{display:'flex',alignItems:'center',gap:4}}>
                                            <button title="Ouvrier précédent (←)" onClick={() => openWorkerFromNav(workerNav.list, workerNav.index - 1)}
                                                style={{background:'var(--berry-pale)',border:'none',color:'var(--berry)',fontSize:14,cursor:'pointer',borderRadius:8,width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                                <i className="fa-solid fa-chevron-left"></i>
                                            </button>
                                            <span style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',minWidth:42,textAlign:'center'}}>{workerNav.index + 1} / {workerNav.list.length}</span>
                                            <button title="Ouvrier suivant (→)" onClick={() => openWorkerFromNav(workerNav.list, workerNav.index + 1)}
                                                style={{background:'var(--berry-pale)',border:'none',color:'var(--berry)',fontSize:14,cursor:'pointer',borderRadius:8,width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                                <i className="fa-solid fa-chevron-right"></i>
                                            </button>
                                        </div>
                                        )}
                                        <button onClick={() => closeWorkerPopup()} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--gray-400)'}}>&times;</button>
                                    </div>
                                </div>
                                <div style={{padding:'16px 20px'}}>
                                    <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                                        <tbody>
                                            {[
                                                ['Ferme', <span style={{fontWeight:600}}>{r.ferme}</span>],
                                                ['Opération', <span>{r.operationFamille} — {r.operation}</span>],
                                                ...(_gbRef ? [
                                                    ['Famille', _gbRef.famille],
                                                    ['Groupe', _gbRef.groupe],
                                                ] : []),
                                                ['Parcelle', r.parcelle || '-'],
                                                ['Variété', r.variete || '-'],
                                                ['Journées', r.jours],
                                                ['Heures', `${r.heures}h`],
                                                ['Entrée', <span style={{fontFamily:'monospace', color: pres && pres.heureEntree ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureEntree) || '—'}</span>],
                                                ['Sortie', <span style={{fontFamily:'monospace', color: pres && pres.heureSortie ? 'var(--gray-700)' : 'var(--gray-400)'}}>{(pres && pres.heureSortie) || '—'}</span>],
                                                ['Quantité (kg)', r.quantite ? `${r.quantite} kg` : '-'],
                                            ].map(([label, val], i) => (
                                                <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                    <td style={{padding:'8px 4px',color:'var(--gray-500)',fontSize:12,width:'40%'}}>{label}</td>
                                                    <td style={{padding:'8px 4px',fontWeight:500}}>{val}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    {!isCaporal && (
                                    <div style={{marginTop:16,background:'var(--berry-pale)',borderRadius:10,padding:14}}>
                                        <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:10}}>
                                            Estimation paie du {paieDateISO} — modèle complet ({declare ? 'déclaré' : 'non déclaré'}).
                                        </div>

                                        {/* 2 colonnes côte à côte (wrap en mobile) : bulletin ouvrier | coût employeur. */}
                                        <div style={{display:'flex',flexWrap:'wrap',gap:16}}>

                                            {/* ===== Colonne GAUCHE : Bulletin ouvrier ===== */}
                                            <div style={{flex:'1 1 180px',minWidth:180}}>
                                                <div style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>Bulletin ouvrier</div>

                                                {/* SMAG base : XX,XX DH/j × N j = XXX,XX DH */}
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>{declare ? `SMAG base : ${f2(paie.smagBase)} × ${paie.jT}` : `Base net (non déclaré CNSS) : ${f2(paie.smagBase)} × ${paie.jT}`}</span>
                                                    <span style={{fontWeight:600}}>{f2(paie.base)}</span>
                                                </div>
                                                {/* Jours fériés (si déclaré & jF>0) */}
                                                {declare && paie.jF > 0 && (
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Jours fériés : {f2(paie.smagBase)} × {paie.jF}</span>
                                                    <span style={{fontWeight:600,color:'var(--berry)'}}>+{f2(paie.feries)}</span>
                                                </div>
                                                )}
                                                {/* Ancienneté (si déclaré) */}
                                                {declare && (
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Ancienneté {Math.round(paie.ancienneteTaux * 100)}%</span>
                                                    <span style={{fontWeight:600,color: paie.anciennete > 0 ? 'var(--berry)' : 'var(--gray-400)'}}>{paie.anciennete > 0 ? `+${f2(paie.anciennete)}` : '0,00'}</span>
                                                </div>
                                                )}
                                                {/* Prime fonction (si >0) */}
                                                {paie.primeFonction > 0 && (
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Prime fonction</span>
                                                    <span style={{fontWeight:600,color:'var(--berry)'}}>+{f2(paie.primeFonction)}</span>
                                                </div>
                                                )}
                                                {/* Primes optionnelles (récolte / rendement) incluses au brut (déclaré). */}
                                                {declare && paie.primesOptionnelles > 0 && (
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Primes (récolte)</span>
                                                    <span style={{fontWeight:600,color:'var(--green)'}}>+{f2(paie.primesOptionnelles)}</span>
                                                </div>
                                                )}
                                                {/* = Salaire brut (gras) — caché pour les non-déclarés (brut=net par décision DG, évite la confusion) */}
                                                {declare && (
                                                <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid var(--gray-200)',paddingTop:8,marginTop:4,marginBottom:8}}>
                                                    <span style={{fontWeight:700,color:'var(--gray-700)'}}>= Salaire brut</span>
                                                    <span style={{fontWeight:700,fontSize:14,color:'var(--gray-700)'}}>{f2(paie.brut)} DH</span>
                                                </div>
                                                )}

                                                {/* Retenues salariales (déclaré uniquement) */}
                                                {declare && (
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>CNSS ({(paie.tauxCnss * 100).toFixed(2).replace('.', ',')}%)</span>
                                                    <span style={{fontWeight:600,color:'var(--red)'}}>−{f2(paie.cnss)}</span>
                                                </div>
                                                )}
                                                {declare && (
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>AMO ({(paie.tauxAmo * 100).toFixed(2).replace('.', ',')}%)</span>
                                                    <span style={{fontWeight:600,color:'var(--red)'}}>−{f2(paie.amo)}</span>
                                                </div>
                                                )}
                                                {/* = Net à payer (gras vert) — sans transport */}
                                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'2px solid var(--green)',paddingTop:8,marginTop:4}}>
                                                    <span style={{fontWeight:800,color:'var(--green)',fontSize:13}}>= Net à payer</span>
                                                    <span style={{fontWeight:800,fontSize:17,color:'var(--green)'}}>{f2(paie.net)} DH</span>
                                                </div>
                                            </div>

                                            {/* ===== séparateur léger ===== */}
                                            <div style={{width:1,alignSelf:'stretch',background:'var(--gray-200)'}}></div>

                                            {/* ===== Colonne DROITE : Coût employeur ===== */}
                                            <div style={{flex:'1 1 180px',minWidth:180}}>
                                                <div style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>Coût employeur</div>

                                                {/* Salaire brut */}
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Salaire brut</span>
                                                    <span style={{fontWeight:600}}>{f2(paie.brut)}</span>
                                                </div>
                                                {/* Charges patronales (déclaré uniquement) */}
                                                {declare && (
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Charges patronales ({(paie.tauxChargesPatronales * 100).toFixed(2).replace(".", ",")}%)</span>
                                                    <span style={{fontWeight:600,color:'var(--gray-500)'}}>+{f2(paie.chargesPatronales)}</span>
                                                </div>
                                                )}
                                                {/* Transport (séparé, hors brut) */}
                                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                                    <span style={{fontSize:12,color:'var(--gray-500)'}}>Transport{eqNamePaie ? ` (${eqNamePaie})` : ''}</span>
                                                    <span style={{fontWeight:600,color: primeTransport > 0 ? 'var(--blue)' : 'var(--gray-400)'}}>{primeTransport > 0 ? `+${f2(primeTransport)}` : '0,00'}</span>
                                                </div>
                                                {/* = Coût total employeur (gras) — chiffre clé DG. */}
                                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'2px solid var(--berry)',paddingTop:8,marginTop:4}}>
                                                    <span style={{fontWeight:800,color:'var(--berry)',fontSize:13}}>= Coût total employeur</span>
                                                    <span style={{fontWeight:800,fontSize:17,color:'var(--berry)'}}>{f2(coutTotalEmployeur)} DH</span>
                                                </div>
                                            </div>

                                        </div>
                                    </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        );
                    })()}
                </div>
            );
        }

export { PointageTab };
