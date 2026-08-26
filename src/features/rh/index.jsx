
// Global helper fallbacks
const cachedFetch = (typeof window !== 'undefined' && window.cachedFetch) ? window.cachedFetch : (url => fetch(url).then(r => r.json()).catch(() => ({ success: false })));
const loadBonsFromFirestore = (typeof window !== 'undefined' && window.loadBonsFromFirestore) ? window.loadBonsFromFirestore : (() => Promise.resolve([]));
// @ts-check
/**
 * Extracted feature module
 * Compiled by Vite (src/) as ES modules.
 * // TODO: import from @shared when Step 5 runs
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

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
            const [paieBaremes, setPaieBaremes] = useState((window.PaieUtils && window.PaieUtils.PAIE_BAREMES_DEFAULT) || {});
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
                        const __PU = window.PaieUtils;
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
                    {window.PointageValidationPanel && (selectedDate || (dates[0] && dates[0].date)) && (() => {
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
                        return React.createElement(window.PointageValidationPanel, {
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
                        // Modèle paie complet (source unique window.PaieUtils). Cas défensif : ouvrier
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
                        const __pal = (window.PaieUtils && window.PaieUtils.trouverPalierAnciennete)
                            ? window.PaieUtils.trouverPalierAnciennete(anciennete, paieBaremes.paliers || [])
                            : { palier: '—', pourcentage: 0 };
                        const ancienneteTaux = (__pal.pourcentage || 0) / 100;
                        // Jours fériés : nombre de jours de la période pointés qui tombent un férié.
                        // Pour la popup quotidienne, jF = 1 si paieDateISO est férié, sinon 0.
                        const __feries = (data.primesConfig && data.primesConfig.joursFeries) || [];
                        const __isFerie = __feries.some(jf => jf && jf.date === paieDateISO);
                        const joursFeries = (declare && __isFerie) ? joursTravailles : 0;
                        // SMAG daté (brut + net) à la date de paie.
                        const __smag = (window.PaieUtils && window.PaieUtils.resolveSmagForDate)
                            ? window.PaieUtils.resolveSmagForDate(paieBaremes, paieDateISO)
                            : { smagBrutJournalier: paieBaremes.smagBrutJournalier || 0, smagNetJournalier: paieBaremes.smagNetJournalier || 0 };
                        // Primes optionnelles soumises au brut (déclaré) : prime de récolte incluse ici.
                        const primesOptionnelles = declare && primeRecolte > 0 ? primeRecolte : 0;
                        const paie = (window.PaieUtils && window.PaieUtils.computePayslip)
                            ? window.PaieUtils.computePayslip({
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
                        if (!_gbRef && r.operationFamille && window.AnalytiqueUtils) {
                            var _gbCodeFallback = window.AnalytiqueUtils.resolveGbCode('', r.operationFamille);
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
        // Exposé pour PointageValidationView (composant séparé) qui rend
        // PointageTab en mode validation, scopé à la ferme du profil.
        window.PointageTab = PointageTab;

        // Adaptateur app-scope → composant séparé window.PointageValidationView.
        // Le menu « Validation du pointage » rend ceci (nouveau workflow), plus
        // PointageTab(isValidation) directement.
        function PointageValidationViewWrapper(props) {
            const View = window.PointageValidationView;
            if (!View) {
                return <div style={{padding:24,color:'var(--red)'}}>Module Validation du pointage indisponible.</div>;
            }
            return <View {...props} />;
        }

        // ===================== COUT RECOLTE TAB =====================
        function CoutRecolteTab({ data, farmFilter, avoSubFilter, currentProfile }) {
            const CHARGES_SOCIALES = 40;
            const DEFAULT_TRANSPORT = 30;

            const [fermeFilter, setFermeFilter] = useState(farmFilter || '');
            const [cultureFilter, setCultureFilter] = useState('');
            const [workers, setWorkers] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDate, setSelectedDate] = useState('');
            const [dates, setDates] = useState([]);
            const [equipeRows, setEquipeRows] = useState([]);
            const [equipePeriodes, setEquipePeriodes] = useState([]);
            const [equipePeriodeCampagne, setEquipePeriodeCampagne] = useState({});
            const [equipeLoading, setEquipeLoading] = useState(true);
            const [expandedEquipe, setExpandedEquipe] = useState(null);
            const [viewMode, setViewMode] = useState('jour'); // 'jour' or 'quinzaine'
            const [selectedQuinz, setSelectedQuinz] = useState('');
            const [showTrend, setShowTrend] = useState(true);
            const [histRange, setHistRange] = useState(30); // 7 / 30 / 60 / 90 jours
            const [histOffset, setHistOffset] = useState(0); // 0 = fenêtre la plus récente
            const [varieteFilter, setVarieteFilter] = useState('');
            const [cycleSelected, setCycleSelected] = useState(getCycle(new Date().toISOString().slice(0, 10)));
            // Modèle paie unifié : registre ouvriers + barèmes (lecture seule client, même source que PaieTab).
            // Sert à remplacer le forfait charges 40 DH par le COÛT TOTAL EMPLOYEUR réel
            // (brut + 26% charges patronales pour les déclarés) via window.PaieUtils.computePayslip.
            const [ouvriersRegistry, setOuvriersRegistry] = useState({}); // numKey(matricule) → {declare, baselineJours, primeFonctionJournaliere, ...}
            const [paieBaremes, setPaieBaremes] = useState((window.PaieUtils && window.PaieUtils.PAIE_BAREMES_DEFAULT) || {});
            // Transport Fruits (pointage_divers, fonction === 'TRANSPORT FRUIT') par date.
            // Map { dateISO → montant total TRANSPORT FRUIT }. Chargé pour les dates affichées.
            const [transportFruitByDate, setTransportFruitByDate] = useState({});

            const isMyrtille = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v || '');
            const calcPrime = data.calcPrime || ((kg, variete, date) => { const k = kg || 0; if (isMyrtille(variete)) { const seuil = /breeze/i.test(variete || '') ? 25 : /cascade/i.test(variete || '') ? ((date || '') >= '2026-04-25' ? 30 : 25) : 30; return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0; } if (k < 20) return 0; if (k < 25) return 20; if (k < 30) return 40; if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10; return Math.round((90 + (k - 40) * 4) * 10) / 10; });

            const equipeChefs = { 'MM': 'Boucharen', 'AY': 'Chelihat', 'HT': 'El Bachir', 'HA': 'El Hafi', 'KR': 'Farid', 'NA': 'Larache', 'JA': 'Ksr Femme', 'AZ': 'Chahdi', 'CC': 'Sektoui', 'CA': 'Regragi', 'RE': 'Dechira', 'NV': 'NV' };
            const getEquipePrefix = (matricule) => {
                if (!matricule) return 'NV';
                const m = matricule.toUpperCase().trim();
                const p2 = m.substring(0, 2);
                if (equipeChefs[p2]) return p2;
                if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
                if (m.startsWith('DD')) return 'NV';
                if (!equipeChefs[p2]) equipeChefs[p2] = 'Équipe ' + p2;
                return p2;
            };
            const getEquipeName = (prefix) => equipeChefs[prefix] || prefix;

            const transportConfig = data.transportConfig || [];
            // getTransport(prefix, periode) : tarif effectif à la quinzaine (versionné)
            // Si periode fournie, utilise getCoutTransport (history-aware) ; sinon fallback courant
            const transportMap = {};
            transportConfig.forEach(t => { transportMap[t.prefix] = t.coutParOuvrier; });
            const getTransport = (prefix, periode) => {
                if (periode && data.getCoutTransport) {
                    const v = data.getCoutTransport(prefix, periode);
                    if (v !== undefined && v !== null) return v;
                }
                return transportMap[prefix] !== undefined ? transportMap[prefix] : DEFAULT_TRANSPORT;
            };

            const logistiqueOps = /caporal|conditionnement|encadrement|chargement/i;
            const resolveCulture = (w) => {
                const parcelle = (w.parcelle || '').toLowerCase();
                const pc = data.parcelleConfig || {};
                for (const farm of Object.keys(pc)) {
                    for (const p of pc[farm]) {
                        if (parcelle && (parcelle.includes(p.nom.toLowerCase()) || parcelle.includes(p.variete.toLowerCase()))) return p.culture;
                    }
                }
                // BUG 1 (data dégradée) : si la colonne variete est vide, dériver la culture
                // depuis le TEXTE parcelle via normalizeParcelle (distingue Myrtille vs Framboise)
                // AVANT le fallback générique 'Framboise'.
                if (!w.variete) {
                    const np = normalizeParcelle(w.parcelle || '');
                    if (np && np.culture) return np.culture;
                }
                return data.getCultureForVariete ? data.getCultureForVariete(w.variete) : 'Framboise';
            };
            // BUG 1 : variété robuste — colonne variete sinon dérivée du texte parcelle.
            const resolveVariete = (w) => {
                if (w && w.variete) return w.variete;
                const np = normalizeParcelle((w && w.parcelle) || '');
                return (np && np.variete) || '';
            };

            // ouvriers_registry est keyé par matricule NUMÉRIQUE (ex. "10764") alors que le
            // pointage récolte utilise des matricules À LETTRES (ex. "MMG10764"). numKey extrait
            // la clé numérique canonique pour faire correspondre les deux (même logique que PaieTab).
            const numKey = (m) => String(m || '').toUpperCase().replace(/[^0-9]/g, '');

            // DÉCOMPOSITION COÛT (décision Omar 2026-06) — modèle SMAG théorique, source = computePayslip.
            // Pour UN ouvrier-JOUR de récolte, retourne la décomposition AFFICHÉE { salaire, prime, charges }
            // dérivée du modèle unifié window.PaieUtils.computePayslip. r.cout (BEE ONE) n'est PLUS la base
            // du coût (il s'annulait dans l'ancienne astuce, ce qui rendait la barre « Salaire » trompeuse).
            //
            // Mapping composantes (déclaré) :
            //   salaire  = paie.base + paie.anciennete           (SMAG brut journalier + montant ancienneté)
            //   prime    = paie.primeFonction + primeRécolteDuJour
            //   charges  = paie.chargesPatronales                (26% patronaux réels)
            //   → salaire + prime + charges = base + anciennete + primeFonction + primeRécolte + chargesPat
            //     = brut + chargesPat = coutEmployeur  (feries=0, primesOpt=primeRécolte). Le TOTAL
            //     (avec transport ajouté par l'appelant) = coutEmployeur + transport, INCHANGÉ.
            //
            // Non-déclaré : pas de CNSS patronale ni d'ancienneté ; la prime de récolte n'entre PAS dans
            //   coutEmployeur (modèle paie). Pour garder la somme = coutEmployeur (= base + primeFonction) :
            //     salaire = paie.base ; prime = paie.primeFonction ; charges = 0.
            //   HYPOTHÈSE : la prime de récolte des non-déclarés n'est pas valorisée dans le coût employeur
            //   (cohérent avec le modèle paie et l'ancien total où r.cout s'annulait). À revoir si Omar
            //   veut compter la prime récolte des non-déclarés.
            //
            // Fallback gracieux (AUCUN NaN) : si computePayslip absent OU ouvrier sans registre → ancien
            //   calcul (salaire = r.cout legacy, prime récolte, charges = forfait CHARGES_SOCIALES 40 DH).
            // Granularité : appelé par ouvrier-JOUR (jT:1). En mode période/quinzaine, on somme jour par jour.
            const decomposeCoutJour = (matricule, salaireLegacy, primeRecolte, jourISO) => {
                const PU = (typeof window !== 'undefined' && window.PaieUtils) ? window.PaieUtils : null;
                const reg = ouvriersRegistry[numKey(matricule)];
                const sal = Number(salaireLegacy) || 0;
                const pr = Number(primeRecolte) || 0;
                if (!PU || !PU.computePayslip || !reg) {
                    // Fallback historique : r.cout en base, prime récolte, charges forfaitaires.
                    return { salaire: sal, prime: pr, charges: CHARGES_SOCIALES };
                }
                const declare = !!reg.declare;
                const primeFonctionJour = Number(reg.primeFonctionJournaliere || 0);
                // Ancienneté : on utilise baselineJours du registre (sans scan pointage distinct —
                // hypothèse documentée : CoutRecolteTab n'effectue pas le scan sql_mirror_pointage
                // coûteux de PaieTab). Taux de palier résolu via trouverPalierAnciennete.
                const anciennete = Number(reg.baselineJours || 0);
                const __pal = (PU.trouverPalierAnciennete)
                    ? PU.trouverPalierAnciennete(anciennete, paieBaremes.paliers || [])
                    : { pourcentage: 0 };
                const ancienneteTaux = declare ? ((__pal.pourcentage || 0) / 100) : 0;
                const __smag = (PU.resolveSmagForDate)
                    ? PU.resolveSmagForDate(paieBaremes, jourISO)
                    : { smagBrutJournalier: paieBaremes.smagBrutJournalier || 0, smagNetJournalier: paieBaremes.smagNetJournalier || 0 };
                // Prime récolte intégrée au brut imposable (primesOptionnelles) pour les déclarés
                // (cohérent avec la popup PaieTab) ; hors brut pour les non-déclarés.
                const primesOptionnelles = declare && pr > 0 ? pr : 0;
                const paie = PU.computePayslip({
                    declare,
                    smagBrut: __smag.smagBrutJournalier,
                    smagNet: __smag.smagNetJournalier,
                    jT: 1, jF: 0,
                    ancienneteTaux,
                    primeFonctionJour,
                    primesOptionnelles,
                    baremes: paieBaremes,
                });
                const base = Number(paie && paie.base) || 0;
                const anc = Number(paie && paie.anciennete) || 0;
                const primeFonction = Number(paie && paie.primeFonction) || 0;
                const chargesPat = Number(paie && paie.chargesPatronales) || 0;
                // primeRécolte comptée dans le coût uniquement pour les déclarés (intégrée au brut →
                // coutEmployeur). Pour les non-déclarés, elle est hors coutEmployeur (charges=0).
                const primeAffichee = declare ? (primeFonction + pr) : primeFonction;
                return { salaire: base + anc, prime: primeAffichee, charges: chargesPat };
            };

            const loadData = (date) => {
                const dq = date ? `&date=${date}` : '';
                fetch(`/api/pointage-rh?action=recolte${dq}`).then(r => r.json()).then(json => {
                    if (json.success) setWorkers(json.workers || []);
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            };

            React.useEffect(() => {
                loadData();
                cachedFetch('/api/pointage-rh?action=dates').then(json => { if (json.success) setDates(json.dates || []); }).catch(() => {});
                // Bypass localStorage cache pour recolte-equipes (données fréquemment mises à jour, évite chart vide sur stale cache)
                invalidateCache('recolte-equipes');
                cachedFetch('/api/pointage-rh?action=recolte-equipes').then(json => {
                    if (json.success) { setEquipeRows(json.rows || []); setEquipePeriodes(json.periodes || []); setEquipePeriodeCampagne(json.periodeCampagne || {}); }
                }).catch(err => console.warn(err)).finally(() => setEquipeLoading(false));
            }, []);

            // Charge (une fois) les barèmes paie pour le COÛT TOTAL EMPLOYEUR.
            // Même source que PaieTab : app_settings/paie_baremes (lecture seule client).
            React.useEffect(() => {
                if (typeof firebase === 'undefined' || !firebase.firestore) return;
                const db = firebase.firestore();
                let cancelled = false;
                db.collection('app_settings').doc('paie_baremes').get()
                    .then(doc => { if (!cancelled && doc.exists) setPaieBaremes(prev => ({ ...prev, ...doc.data() })); })
                    .catch(e => console.warn('cout-recolte paie_baremes load:', e));
                return () => { cancelled = true; };
            }, []);

            // Charge le registre ouvriers via la CF gatée /api/registry (get-registry) —
            // SÉCURITÉ PAIE (Étape 1) : plus de lecture client-direct de ouvriers_registry.
            // - Scope 'all' (RH/DG/Finance) : from/to ignorés côté serveur → registre complet
            //   → coût employeur IDENTIQUE à avant.
            // - Scope CHEF : from/to REQUIS (sinon 400) → ses ouvriers (sa ferme, période).
            //   Les ouvriers récolte affichés sont déjà cloisonnés serveur (Étape 0) ; le
            //   fallback gracieux `ouvriersRegistry[numKey()] || {}` (forfait 40 DH) est conservé.
            // Choix from/to : la fenêtre DOIT couvrir la PÉRIODE RÉELLEMENT AFFICHÉE,
            //   sinon (scope CHEF) les ouvriers hors fenêtre tombent hors du set autorisé →
            //   fallback forfait 40 DH = coût faux (régression QA 2026-07). Deux cas :
            //   - Mode JOUR : quinzaine calendaire contenant la date active du tab
            //       (jour 1–15 → 01..15 ; jour ≥16 → 16..fin de mois).
            //   - Mode QUINZAINE : bornes de la quinzaine sélectionnée (effectiveQuinz),
            //       dérivées de la string periode 'DD/MM/YYYY - DD/MM/YYYY' → PAS de selectedDate,
            //       sinon un CHEF qui change de quinzaine dans le dropdown garde l'ancienne fenêtre.
            // window.fetch est patché globalement pour injecter le Bearer token sur /api/*.
            const registryDateISO = selectedDate || (dates[0] && dates[0].date) || new Date().toISOString().slice(0, 10);
            // Quinzaine effective pour la fenêtre registre — même logique que l'affichage
            //   (periodesAvecDonnees + effectiveQuinz plus bas), mais calculée ICI car ces
            //   const vivent après l'early-return `if (loading)`, hors de portée du hook.
            // Calcul léger (filter/Set sur equipeRows) ; mémoïsé pour stabiliser la dépendance.
            const registryQuinz = React.useMemo(() => {
                if (viewMode !== 'quinzaine') return '';
                const periodesDispo = (equipePeriodes.length > 0)
                    ? equipePeriodes.filter(p => equipeRows.some(r => r.periode === p))
                    : [...new Set(equipeRows.map(r => r.periode).filter(Boolean))].sort().reverse();
                return (selectedQuinz && periodesDispo.includes(selectedQuinz))
                    ? selectedQuinz
                    : (periodesDispo[0] || '');
            }, [viewMode, selectedQuinz, equipeRows, equipePeriodes]);
            // Fenêtre from/to (YYYY-MM-DD) selon le mode. Toutes les bornes sont construites
            //   par formatage manuel — JAMAIS toISOString() (décale d'un jour en TZ
            //   Africa/Casablanca, UTC+1). En mode quinzaine on lit directement la string
            //   'DD/MM/YYYY - DD/MM/YYYY' et on réordonne les composants (aucun objet Date).
            const registryWindow = React.useMemo(() => {
                if (viewMode === 'quinzaine' && registryQuinz) {
                    const m = String(registryQuinz).match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
                    if (m) {
                        return { from: `${m[3]}-${m[2]}-${m[1]}`, to: `${m[6]}-${m[5]}-${m[4]}` };
                    }
                    // Format inattendu : pas de fenêtre → on ne fetch pas (évite un 400 chef).
                    return { from: '', to: '' };
                }
                // Mode JOUR : quinzaine calendaire de la date active.
                if (!registryDateISO) return { from: '', to: '' };
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
                return { from, to };
            }, [viewMode, registryQuinz, registryDateISO]);
            React.useEffect(() => {
                const { from, to } = registryWindow;
                if (!from || !to) return;
                let cancelled = false;
                const url = '/api/registry?action=get-registry&from=' + from + '&to=' + to;
                fetch(url)
                    .then(r => r.json())
                    .then(resp => {
                        if (cancelled) return;
                        if (!resp || !resp.success) { console.warn('cout-recolte registry load:', resp && resp.error); setOuvriersRegistry({}); return; }
                        const reg = {};
                        (resp.ouvriers || []).forEach(o => { reg[numKey(o.matricule)] = o; });
                        setOuvriersRegistry(reg);
                    })
                    .catch(e => { if (!cancelled) { console.warn('cout-recolte registry load:', e); setOuvriersRegistry({}); } });
                return () => { cancelled = true; };
            }, [registryWindow.from, registryWindow.to]);

            const handleDateChange = (d) => { setSelectedDate(d); setLoading(true); loadData(d); };

            // ── KPI Transport fruits / kg récolté ─────────────────────────────────────
            // Source coût : pointage_divers/{date}.entries où fonction === 'TRANSPORT FRUIT'
            //   via /api/validation?action=divers-entries&date=<d> (même endpoint que PaieTab).
            // On charge les dates affichables (fenêtre la plus large : histRange jours récoltés
            // les plus récents + la date sélectionnée), puis on somme côté KPI selon le mode.
            // Dénominateur = kg RÉCOLTÉ de la même fenêtre (déjà calculé dans le composant),
            //   PAS le kg exporté (redéfinition DG 2026-06).
            // NB : la déclaration tfDatesKey (useMemo) + son useEffect sont placés APRÈS
            //   recolteDatesDispo (ci-dessous) pour éviter une TDZ (lecture d'une const non
            //   encore initialisée pendant le render). Voir bloc « tfDatesKey » plus bas.

            // La récolte du jour est souvent saisie/synchronisée avec 1 à 2 jours de retard.
            // "Aujourd'hui" renvoie alors 0 ouvrier récolte → KPIs et tableau vides (faux "écran cassé").
            // Parade : si "Aujourd'hui" n'a aucune récolte, basculer auto sur la dernière date qui en a
            // (déduite d'equipeRows = jours réellement récoltés). L'utilisateur peut re-choisir Aujourd'hui.
            const recolteDatesDispo = React.useMemo(
                () => [...new Set((equipeRows || []).map(r => r.jour).filter(Boolean))].sort().reverse(),
                [equipeRows]
            );
            const [autoFellBack, setAutoFellBack] = useState(false);
            React.useEffect(() => {
                if (viewMode === 'quinzaine') return;            // mode quinzaine = source equipeRows, non concerné
                if (selectedDate || autoFellBack) return;        // l'utilisateur a déjà une date / déjà basculé
                if (loading || equipeLoading) return;            // attendre les 2 fetchs (recolte + recolte-equipes)
                if (workers.length > 0) return;                  // récolte présente aujourd'hui → garder Aujourd'hui
                const today = new Date().toISOString().slice(0, 10);
                const latest = recolteDatesDispo.find(d => d !== today);
                if (latest) { setAutoFellBack(true); handleDateChange(latest); }
            }, [viewMode, loading, equipeLoading, workers, recolteDatesDispo, selectedDate, autoFellBack]);

            // ── KPI Transport fruits : dates à charger (placé APRÈS recolteDatesDispo — TDZ) ──
            // tfDatesKey lit recolteDatesDispo : déclaré ici (et non plus haut) car le useMemo
            // s'exécute pendant le render ; placé avant recolteDatesDispo il levait
            // ReferenceError « Cannot access 'recolteDatesDispo' before initialization ».
            const tfDatesKey = React.useMemo(() => {
                const recent = recolteDatesDispo.slice(0, Math.max(90, histRange));
                const set = new Set(recent);
                if (selectedDate) set.add(selectedDate);
                return [...set].sort().join(',');
            }, [recolteDatesDispo, histRange, selectedDate]);
            React.useEffect(() => {
                const dates = tfDatesKey ? tfDatesKey.split(',').filter(Boolean) : [];
                if (!dates.length) { setTransportFruitByDate({}); return; }
                let cancelled = false;
                // Ne (re)fetch que les dates absentes du cache pour limiter les requêtes.
                const missing = dates.filter(d => transportFruitByDate[d] === undefined);
                if (!missing.length) return;
                Promise.all(missing.map(d =>
                    fetch('/api/validation?action=divers-entries&date=' + d)
                        .then(r => r.json())
                        .then(json => {
                            const entries = (json && json.success && json.data && json.data.entries) || [];
                            const total = entries
                                .filter(e => String(e.fonction || '').toUpperCase().trim() === 'TRANSPORT FRUIT')
                                .reduce((s, e) => s + (Number(e.montant) || 0), 0);
                            return { d, total };
                        })
                        .catch(() => ({ d, total: 0 }))
                )).then(results => {
                    if (cancelled) return;
                    setTransportFruitByDate(prev => {
                        const next = { ...prev };
                        results.forEach(({ d, total }) => { next[d] = total; });
                        return next;
                    });
                });
                return () => { cancelled = true; };
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [tfDatesKey]);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement coût récolte...</div></div>;

            // ---- JOUR mode: use workers from recolte API ----
            const enrichWorker = (w) => {
                const culture = resolveCulture(w);
                const isMyrt = /myrtille/i.test(culture);
                const kg = w.quantite || 0;
                const prefix = getEquipePrefix(w.matricule);
                const transport = getTransport(prefix, w.periode);
                const primeRecolte = calcPrime(kg, isMyrt ? 'myrtille' : w.variete, w.jour);
                // Décomposition SMAG théorique (computePayslip) — r.cout (BEE ONE) n'est plus la base.
                const dec = decomposeCoutJour(w.matricule, w.cout || 0, primeRecolte, w.jour);
                const salaire = dec.salaire;
                const prime = dec.prime;
                const charges = dec.charges;
                const coutTotal = salaire + transport + prime + charges;
                const dhParKg = kg > 0 ? Math.round(coutTotal / kg * 100) / 100 : null;
                return { ...w, culture, kg, salaire, transport, prime, charges, coutTotal, dhParKg, prefix, equipe: getEquipeName(prefix), isLogistique: logistiqueOps.test(w.operation), jours: 1 };
            };

            let enriched;
            let isQuinzaineMode = viewMode === 'quinzaine';

            // [DG fix] Le backend recolte-equipes ne charge que ~3 quinzaines, mais
            // equipePeriodes (meta.periodes) les liste TOUTES. Sélectionner une quinzaine
            // sans données ne changeait rien (aucune ligne). On ne propose donc QUE les
            // quinzaines réellement présentes dans equipeRows.
            // Calcul direct (PAS de hook) : placé après le early-return `if (loading)`.
            // Un useMemo ici violerait les Rules of Hooks (crash au passage loading→false).
            // Le calcul est léger (filter/Set sur equipeRows).
            const periodesAvecDonnees = (equipePeriodes.length > 0)
                ? equipePeriodes.filter(p => equipeRows.some(r => r.periode === p))
                // Fallback : equipePeriodes vide mais des lignes existent → dériver l'ordre
                // des periodes distinctes depuis equipeRows triées desc.
                : [...new Set(equipeRows.map(r => r.periode).filter(Boolean))].sort().reverse();
            // Quinzaine effective = selectedQuinz si elle a des données, sinon la 1re dispo.
            // Ne touche pas le state selectedQuinz, juste l'effectif d'affichage/calcul.
            const effectiveQuinz = (selectedQuinz && periodesAvecDonnees.includes(selectedQuinz))
                ? selectedQuinz
                : (periodesAvecDonnees[0] || '');

            if (isQuinzaineMode && equipeRows.length > 0) {
                // Quinzaine mode: aggregate equipeRows by worker, compute primes per day then sum
                const qFilter = effectiveQuinz;
                const filteredRows = equipeRows.filter(r => r.periode === qFilter && !logistiqueOps.test(r.operation));
                // Group by matricule+jour to compute daily prime
                const byWorkerDay = {};
                filteredRows.forEach(r => {
                    const key = `${r.matricule}|${r.jour}`;
                    if (!byWorkerDay[key]) byWorkerDay[key] = { matricule: r.matricule, nom: r.nom, ferme: r.ferme, variete: r.variete, parcelle: r.parcelle, culture: r.culture, jour: r.jour, kg: 0, salaire: 0 };
                    byWorkerDay[key].kg += (r.kg || 0);
                    byWorkerDay[key].salaire += (r.cout || 0);
                });
                // Now compute per day costs
                const dailyEntries = Object.values(byWorkerDay).map(d => {
                    const culture = d.culture || resolveCulture(d);
                    const isMyrt = /myrtille/i.test(culture);
                    const prefix = getEquipePrefix(d.matricule);
                    const primeRecolte = calcPrime(d.kg, isMyrt ? 'myrtille' : d.variete, d.jour);
                    const dec = decomposeCoutJour(d.matricule, d.salaire, primeRecolte, d.jour);
                    return { ...d, culture, prefix, transport: getTransport(prefix, qFilter), salaire: dec.salaire, prime: dec.prime, charges: dec.charges };
                });
                // Aggregate by worker across days
                const byWorker = {};
                dailyEntries.forEach(d => {
                    if (!byWorker[d.matricule]) byWorker[d.matricule] = { matricule: d.matricule, nom: d.nom, ferme: d.ferme, culture: d.culture, parcelle: d.parcelle, prefix: d.prefix, equipe: getEquipeName(d.prefix), kg: 0, salaire: 0, transport: 0, prime: 0, charges: 0, jours: 0, isLogistique: false };
                    byWorker[d.matricule].kg += d.kg;
                    byWorker[d.matricule].salaire += d.salaire;
                    byWorker[d.matricule].transport += d.transport;
                    byWorker[d.matricule].prime += d.prime;
                    byWorker[d.matricule].charges += d.charges;
                    byWorker[d.matricule].jours++;
                });
                enriched = Object.values(byWorker).map(w => {
                    const coutTotal = w.salaire + w.transport + w.prime + w.charges;
                    const dhParKg = w.kg > 0 ? Math.round(coutTotal / w.kg * 100) / 100 : null;
                    return { ...w, coutTotal, dhParKg };
                });
            } else {
                enriched = workers.map(enrichWorker);
            }

            // Filter logistique out
            const allFiltered0 = enriched.filter(r => !r.isLogistique);
            // Apply ferme filter + avo sub-farm
            const matchSub = (r) => !avoSubFilter || deriveSubFerme(r.refParcelle, r.parcelle) === avoSubFilter;
            const allFiltered1 = (fermeFilter ? allFiltered0.filter(r => r.ferme === fermeFilter) : allFiltered0).filter(matchSub);
            // Apply culture filter
            const allFiltered2 = cultureFilter ? allFiltered1.filter(r => /myrtille/i.test(r.culture) === (cultureFilter === 'Myrtille')) : allFiltered1;
            // Available varietes (dynamic based on ferme + culture filters)
            // BUG 1 : si r.variete est vide (data dégradée), dériver depuis le texte parcelle
            // via normalizeParcelle pour réalimenter le dropdown (Maravilla/Yazmin/Corina/...).
            const availableVarietes = [...new Set(allFiltered2.map(resolveVariete).filter(Boolean))].sort();
            // Apply variete filter
            const allFiltered = varieteFilter ? allFiltered2.filter(r => resolveVariete(r) === varieteFilter) : allFiltered2;

            // ---- Logistique (parallel pipeline) — conditionnement / chargement / encadrement / caporal ----
            // Réutilise les mêmes filtres ferme/culture/variété sur les lignes logistique pour calculer le coût logistique/Kg récolté.
            let logEnriched;
            if (isQuinzaineMode && equipeRows.length > 0) {
                const qFilterLog = effectiveQuinz;
                const filteredLogRows = equipeRows.filter(r => r.periode === qFilterLog && logistiqueOps.test(r.operation || ''));
                const logByWorkerDay = {};
                filteredLogRows.forEach(r => {
                    const key = `${r.matricule}|${r.jour}`;
                    if (!logByWorkerDay[key]) logByWorkerDay[key] = { matricule: r.matricule, nom: r.nom, ferme: r.ferme, variete: r.variete, parcelle: r.parcelle, culture: r.culture, jour: r.jour, kg: 0, salaire: 0 };
                    logByWorkerDay[key].kg += (r.kg || 0);
                    logByWorkerDay[key].salaire += (r.cout || 0);
                });
                const logDaily = Object.values(logByWorkerDay).map(d => {
                    const culture = d.culture || resolveCulture(d);
                    const isMyrt = /myrtille/i.test(culture);
                    const prefix = getEquipePrefix(d.matricule);
                    const primeRecolte = calcPrime(d.kg, isMyrt ? 'myrtille' : d.variete, d.jour);
                    const dec = decomposeCoutJour(d.matricule, d.salaire, primeRecolte, d.jour);
                    return { ...d, culture, prefix, transport: getTransport(prefix, qFilterLog), salaire: dec.salaire, prime: dec.prime, charges: dec.charges };
                });
                const logByWorker = {};
                logDaily.forEach(d => {
                    if (!logByWorker[d.matricule]) logByWorker[d.matricule] = { matricule: d.matricule, nom: d.nom, ferme: d.ferme, culture: d.culture, variete: d.variete, parcelle: d.parcelle, prefix: d.prefix, kg: 0, salaire: 0, transport: 0, prime: 0, charges: 0, jours: 0 };
                    logByWorker[d.matricule].kg += d.kg;
                    logByWorker[d.matricule].salaire += d.salaire;
                    logByWorker[d.matricule].transport += d.transport;
                    logByWorker[d.matricule].prime += d.prime;
                    logByWorker[d.matricule].charges += d.charges;
                    logByWorker[d.matricule].jours++;
                });
                logEnriched = Object.values(logByWorker);
            } else {
                logEnriched = workers.map(enrichWorker).filter(w => w.isLogistique);
            }
            const logFiltered0 = (fermeFilter ? logEnriched.filter(r => r.ferme === fermeFilter) : logEnriched).filter(matchSub);
            const logFiltered1 = cultureFilter ? logFiltered0.filter(r => /myrtille/i.test(r.culture || '') === (cultureFilter === 'Myrtille')) : logFiltered0;
            const logFiltered = varieteFilter ? logFiltered1.filter(r => r.variete === varieteFilter) : logFiltered1;

            // Logistique agrégée par dimension : chaque ligne de tableau attribue SA part de logistique (pas un ratio global).
            // Évite la divergence Net Framboise selon filtre Toutes vs Framboise.
            const coutOfLog = (r) => (r.salaire || 0) + (r.transport || 0) + (r.prime || 0) + (r.charges || 0);
            const logByCulture = {};
            const logByEquipe = {};
            const logByParcelle = {};
            logFiltered.forEach(r => {
                const c = r.culture || 'Autre';
                logByCulture[c] = (logByCulture[c] || 0) + coutOfLog(r);
                const ek = r.prefix;
                if (ek) logByEquipe[ek] = (logByEquipe[ek] || 0) + coutOfLog(r);
                const pk = r.parcelle || 'N/A';
                logByParcelle[pk] = (logByParcelle[pk] || 0) + coutOfLog(r);
            });

            // Sort by DH/Kg ascending (most efficient first), nulls last
            const sorted = [...allFiltered].sort((a, b) => {
                if (a.dhParKg === null && b.dhParKg === null) return 0;
                if (a.dhParKg === null) return 1;
                if (b.dhParKg === null) return -1;
                return a.dhParKg - b.dhParKg;
            }).map((r, i) => ({ ...r, rank: i + 1 }));

            // KPI computations
            const totalKg = allFiltered.reduce((s, r) => s + r.kg, 0);
            const totalSalaire = allFiltered.reduce((s, r) => s + r.salaire, 0);
            const totalTransport = allFiltered.reduce((s, r) => s + r.transport, 0);
            const totalPrime = allFiltered.reduce((s, r) => s + r.prime, 0);
            const totalCharges = allFiltered.reduce((s, r) => s + r.charges, 0);
            const totalCout = totalSalaire + totalTransport + totalPrime + totalCharges;
            const dhParKgGlobal = totalKg > 0 ? Math.round(totalCout / totalKg * 100) / 100 : null;
            // Effectif = matricules DISTINCTS (défensif : si le backend recolte ne déduplique
            // pas les workers — pas de scan prod — allFiltered peut avoir 1 ligne/parcelle).
            // Les coûts/jours ci-dessous restent des SOMMES sur toutes les lignes (inchangé).
            const nbOuvriers = window.RecolteKpiUtils
                ? window.RecolteKpiUtils.distinctOuvriersFromRows(allFiltered)
                : new Set(allFiltered.map(r => r.matricule)).size;
            const totalJoursOuvriers = allFiltered.reduce((s, r) => s + (r.jours || 1), 0);
            const coutMoyenOuvrierJour = totalJoursOuvriers > 0 ? Math.round(totalCout / totalJoursOuvriers) : 0;
            const pctSalaire = totalCout > 0 ? Math.round(totalSalaire / totalCout * 100) : 0;

            // Logistique KPI : coût main d'oeuvre conditionnement/chargement/encadrement/caporal, divisé par kg récoltés filtrés
            const logSalaire   = logFiltered.reduce((s, r) => s + (r.salaire || 0), 0);
            const logTransport = logFiltered.reduce((s, r) => s + (r.transport || 0), 0);
            const logPrime     = logFiltered.reduce((s, r) => s + (r.prime || 0), 0);
            const logCharges   = logFiltered.reduce((s, r) => s + (r.charges || 0), 0);
            const totalLogCout = logSalaire + logTransport + logPrime + logCharges;
            const dhParKgLog = totalKg > 0 ? Math.round(totalLogCout / totalKg * 100) / 100 : null;
            const dhParKgNet = totalKg > 0 ? Math.round((totalCout + totalLogCout) / totalKg * 100) / 100 : null;

            // ---- KPI agrégés sur la PLAGE du graphe (BUG 2) ------------------------------
            // Les KPI cards doivent suivre la fenêtre 7/30/60/90j sélectionnée pour le graphe
            // « Historique DH/Kg », pas seulement le jour courant. On réutilise EXACTEMENT
            // la même série par jour que le graphe (mêmes filtres ferme/sous-ferme/culture/variété,
            // même fenêtre de jours-avec-données décalée par histOffset, même agrégation par jour),
            // puis on agrège via RecolteKpiUtils.aggregatePeriodKpis (somme + moyenne pondérée).
            // Sémantique :
            //  - Coût Net/Brut/Total, Total Kg = SOMME sur la plage.
            //  - « Ouvriers Récolte » (libellé sans /jour) = ouvriers DISTINCTS sur la plage.
            //  - « Coût Moyen/Ouvrier/Jour » = moyenne PONDÉRÉE (somme coûts / somme ouvrier-jours).
            // Le jour sélectionné/aujourd'hui (mode Jour) reprend les totaux du KPI jour
            // (source recolte, dédupliquée) pour rester aligné avec la barre « jour » du graphe.
            // NB : calcul direct (pas de React.useMemo) car ce bloc est APRÈS le early-return
            // `if (loading)` — un hook conditionnel violerait les Rules of Hooks. Le coût reste
            // négligeable (même ordre de grandeur que le graphe qui recalcule déjà par render).
            const periodKpi = (() => {
                const RK = (typeof window !== 'undefined' && window.RecolteKpiUtils) ? window.RecolteKpiUtils : null;
                if (!RK) return null; // fallback : KPI jour (lib non chargée)
                const logOps = logistiqueOps;
                // Filtres identiques au graphe
                const baseRows = (fermeFilter ? equipeRows.filter(r => r.ferme === fermeFilter) : equipeRows).filter(matchSub);
                const cultRows = cultureFilter ? baseRows.filter(r => /myrtille/i.test(r.culture || resolveCulture(r)) === (cultureFilter === 'Myrtille')) : baseRows;
                const varRows = varieteFilter ? cultRows.filter(r => resolveVariete(r) === varieteFilter) : cultRows;
                // Fenêtre = histRange jours-avec-données, décalée par histOffset (comme le graphe)
                const allDatesDesc = [...new Set(varRows.map(r => r.jour))].sort().reverse();
                const winStart = histOffset * histRange;
                const windowDates = allDatesDesc.slice(winStart, winStart + histRange);
                const todayStr = new Date().toISOString().slice(0, 10);
                const recolteDate = selectedDate || todayStr;
                // Agrégation d'un jour (récolte OU logistique) : dédup par matricule, recalcul prime/transport
                const aggregateRows = (rows) => {
                    const byW = {};
                    rows.forEach(r => {
                        const k = r.matricule;
                        if (!byW[k]) byW[k] = { matricule: r.matricule, kg: 0, salaire: 0, variete: r.variete, parcelle: r.parcelle, culture: r.culture, jour: r.jour };
                        byW[k].kg += (r.kg || 0);
                        byW[k].salaire += (r.cout || 0);
                    });
                    const wList = Object.values(byW);
                    const dayPeriode = (rows.find(r => r.periode) || {}).periode || '';
                    let tSalaire = 0, tTransport = 0, tPrime = 0, tCharges = 0, tKg = 0;
                    wList.forEach(w => {
                        const culture = w.culture || resolveCulture(w);
                        const isMyrt = /myrtille/i.test(culture);
                        const prefix = getEquipePrefix(w.matricule);
                        const wPrime = calcPrime(w.kg, isMyrt ? 'myrtille' : w.variete, w.jour);
                        const dec = decomposeCoutJour(w.matricule, w.salaire, wPrime, w.jour);
                        tSalaire += dec.salaire;
                        tTransport += getTransport(prefix, dayPeriode);
                        tPrime += dec.prime;
                        tCharges += dec.charges;
                        tKg += w.kg;
                    });
                    return { salaire: tSalaire, transport: tTransport, prime: tPrime, charges: tCharges, kg: tKg, nbOuvJour: wList.length, matricules: wList.map(w => w.matricule) };
                };
                const recSeries = [];
                const logSeries = [];
                const ouvKeys = {};
                // kgByDate : dateISO → kg récolté du jour. Sert à restreindre le coût
                // Transport fruits aux JOURS DE PRODUCTION (kg>0) pour aligner numérateur
                // et dénominateur du KPI « Transport fruits / kg récolté ».
                const kgByDate = {};
                windowDates.forEach(date => {
                    // Jour sélectionné/aujourd'hui en mode Jour → reprendre les totaux du KPI jour
                    if (!isQuinzaineMode && date === recolteDate) {
                        // Exclure un « aujourd'hui » incomplet/vide (pas encore de récolte saisie :
                        // kg=0 ET aucun coût) : il ne doit ni tirer les moyennes vers le bas ni
                        // forcer le Total Kg à 0. On saute simplement ce jour de la fenêtre.
                        const todayEmpty = (totalKg || 0) <= 0 && (totalCout || 0) <= 0;
                        if (todayEmpty) return;
                        recSeries.push({ salaire: totalSalaire, transport: totalTransport, prime: totalPrime, charges: totalCharges, kg: totalKg, nbOuvJour: nbOuvriers });
                        logSeries.push({ salaire: logSalaire, transport: logTransport, prime: logPrime, charges: logCharges, kg: 0, nbOuvJour: 0 });
                        kgByDate[date] = totalKg;
                        allFiltered.forEach(r => { const key = (r.matricule || r.nom || '').toString().toUpperCase().trim(); if (key) ouvKeys[key] = true; });
                        return;
                    }
                    const dayRec = varRows.filter(r => r.jour === date && !logOps.test(r.operation || ''));
                    const dayLog = varRows.filter(r => r.jour === date && logOps.test(r.operation || ''));
                    const aRec = aggregateRows(dayRec);
                    const aLog = aggregateRows(dayLog);
                    recSeries.push(aRec);
                    logSeries.push(aLog);
                    kgByDate[date] = aRec.kg;
                    aRec.matricules.forEach(m => { const key = (m || '').toString().toUpperCase().trim(); if (key) ouvKeys[key] = true; });
                });
                const recAgg = RK.aggregatePeriodKpis(recSeries);
                const logAgg = RK.aggregatePeriodKpis(logSeries);
                // BUG #pMBZlx03 : DH/kg de période = moyenne sur les JOURS DE
                // PRODUCTION (kg récolté > 0) uniquement. On exclut les journées
                // « cost-only » (ouvriers payés un jour sans récolte enrichie)
                // qui, sinon, gonflent le numérateur sans kg au dénominateur et
                // font exploser le ratio (~190 DH absurde). Le coût logistique
                // est aligné par index sur les mêmes jours de production récolte.
                const net = RK.computeNetDhParKgProd(recSeries, logSeries);
                const pctSal = recAgg.totalCout > 0 ? Math.round(recAgg.totalSalaire / recAgg.totalCout * 100) : 0;
                return {
                    // Sommes (conservées pour info / cohérence interne)
                    totalSalaire: recAgg.totalSalaire, totalTransport: recAgg.totalTransport,
                    totalPrime: recAgg.totalPrime, totalCharges: recAgg.totalCharges,
                    totalCout: recAgg.totalCout, totalKg: recAgg.totalKg,
                    // Moyennes / jour (vue période) : somme ÷ jours-avec-données
                    coutMoyenJour: recAgg.coutMoyenJour, kgMoyenJour: recAgg.kgMoyenJour,
                    salaireMoyenJour: recAgg.salaireMoyenJour, transportMoyenJour: recAgg.transportMoyenJour,
                    primeMoyenJour: recAgg.primeMoyenJour, chargesMoyenJour: recAgg.chargesMoyenJour,
                    // DH/kg = moyennes PONDÉRÉES sur les JOURS DE PRODUCTION (kg>0)
                    // uniquement (BUG #pMBZlx03) : les journées cost-only sans kg
                    // sont exclues du numérateur ET du dénominateur.
                    dhParKgGlobal: recAgg.dhParKgBrutProd,
                    dhParKgLog: net.dhParKgLog, dhParKgNet: net.dhParKgNet,
                    nbOuvriers: Object.keys(ouvKeys).length,
                    coutMoyenOuvrierJour: recAgg.coutMoyenOuvrierJour,
                    pctSalaire: pctSal,
                    // Dénominateur réel des moyennes/jour (exclut un aujourd'hui vide)
                    nbJours: recAgg.nbJoursAvecDonnees,
                    // Dates de la fenêtre (pour sommer le coût Transport fruits sur la même plage)
                    windowDates: windowDates,
                    // Kg récolté par jour (dateISO → kg) : restreint le coût Transport fruits
                    // aux jours de production (kg>0) pour aligner numérateur et dénominateur.
                    kgByDate: kgByDate,
                };
            })();

            // Valeurs affichées par les KPI cards : période quand le graphe (et son sélecteur
            // 7/30/60/90j) est visible, sinon retour aux KPI du jour. Garde la cohérence
            // graphe/KPI : tant que le sélecteur de période est affiché, KPI = même plage.
            const userPeriodKpi = periodKpi && showTrend;
            // En vue PÉRIODE (30/7/60/90 j) le DG veut des MOYENNES / jour (pas des
            // sommes cumulées qui exagèrent). En mode Jour, on garde les totaux du jour.
            const kpiSalaire = userPeriodKpi ? periodKpi.salaireMoyenJour : totalSalaire;
            const kpiTransport = userPeriodKpi ? periodKpi.transportMoyenJour : totalTransport;
            const kpiPrime = userPeriodKpi ? periodKpi.primeMoyenJour : totalPrime;
            const kpiCharges = userPeriodKpi ? periodKpi.chargesMoyenJour : totalCharges;
            const kpiCout = userPeriodKpi ? periodKpi.coutMoyenJour : totalCout;
            const kpiTotalKg = userPeriodKpi ? periodKpi.kgMoyenJour : totalKg;
            const kpiDhParKgGlobal = userPeriodKpi ? periodKpi.dhParKgGlobal : dhParKgGlobal;
            const kpiDhParKgLog = userPeriodKpi ? periodKpi.dhParKgLog : dhParKgLog;
            const kpiDhParKgNet = userPeriodKpi ? periodKpi.dhParKgNet : dhParKgNet;
            const kpiNbOuvriers = userPeriodKpi ? periodKpi.nbOuvriers : nbOuvriers;
            const kpiCoutMoyenOuvrierJour = userPeriodKpi ? periodKpi.coutMoyenOuvrierJour : coutMoyenOuvrierJour;
            const kpiPctSalaire = userPeriodKpi ? periodKpi.pctSalaire : pctSalaire;
            const kpiPeriodLabel = userPeriodKpi ? (histOffset === 0 ? `${histRange} derniers jours` : `${histRange}j (fenêtre -${histOffset})`) : 'Aujourd\'hui';
            // Libellés des cartes : en vue période ils deviennent des « moyennes / jour ».
            const kpiCoutLabel = userPeriodKpi ? 'Coût moyen / jour' : 'Coût Total (DH)';
            const kpiKgLabel = userPeriodKpi ? 'Kg moyen / jour' : 'Total Kg';

            // ── Mode QUINZAINE : Coût Total + Total Kg en MOYENNE / jour ──────────────────
            // Demande DG : « quand on clique sur une quinzaine, afficher la moyenne des KPIs ».
            // On ne touche QUE les 2 cartes Coût Total et Total Kg (les autres KPI — DH/kg,
            // coût moyen/ouvrier, %, ouvriers — sont déjà des moyennes/ratios corrects).
            // nbJoursQuinz = nombre de JOURS DISTINCTS avec données (kg>0 OU coût>0) dans la
            // quinzaine sélectionnée, en réappliquant EXACTEMENT les mêmes filtres que `enriched`
            // (ferme/sous-ferme/culture/variété, lignes récolte non logistiques). Calculé sur
            // les lignes brutes `equipeRows` car `allFiltered` est agrégé par ouvrier (perd `jour`).
            let nbJoursQuinz = 0;
            if (isQuinzaineMode) {
                const qFilterKpi = effectiveQuinz;
                const quinzDays = new Set();
                equipeRows.forEach(r => {
                    if (r.periode !== qFilterKpi) return;
                    if (logistiqueOps.test(r.operation || '')) return;
                    if (fermeFilter && r.ferme !== fermeFilter) return;
                    if (avoSubFilter && deriveSubFerme(r.refParcelle, r.parcelle) !== avoSubFilter) return;
                    if (cultureFilter && (/myrtille/i.test(r.culture || resolveCulture(r)) !== (cultureFilter === 'Myrtille'))) return;
                    if (varieteFilter && resolveVariete(r) !== varieteFilter) return;
                    if ((r.kg || 0) > 0 || (r.cout || 0) > 0) quinzDays.add(r.jour);
                });
                nbJoursQuinz = quinzDays.size;
            }
            // Valeurs/labels d'AFFICHAGE des 2 cartes. Dérivées (ne remplacent pas kpiCout/kpiTotalKg
            // utilisés ailleurs : recolteKgEnAttente, graphe). En mode jour ou si nbJoursQuinz===0
            // (garde-fou division par zéro) → comportement inchangé.
            const kpiCoutDisplay = (isQuinzaineMode && nbJoursQuinz > 0) ? Math.round(totalCout / nbJoursQuinz) : kpiCout;
            const kpiTotalKgDisplay = (isQuinzaineMode && nbJoursQuinz > 0) ? Math.round(totalKg / nbJoursQuinz * 10) / 10 : kpiTotalKg;
            const kpiCoutLabelDisplay = (isQuinzaineMode && nbJoursQuinz > 0) ? 'Coût moyen / jour' : kpiCoutLabel;
            const kpiKgLabelDisplay = (isQuinzaineMode && nbJoursQuinz > 0) ? 'Kg moyen / jour' : kpiKgLabel;
            // Le kg de récolte provient UNIQUEMENT de l'enrichissement prod (Traçabilité récolte) :
            // le pointage seul ne porte pas le poids (quantiteToKg=0 sur l'opération « Récolte »).
            // Quand la prod n'est pas encore synchronisée (J+1/J+2) pour les jours affichés, on a
            // des coûts mais kg=0 → DH/kg en tirets + graphe vide = faux « écran cassé ». On le
            // signale explicitement au lieu de laisser des tirets muets.
            const recolteKgEnAttente = (kpiCout || 0) > 0 && (kpiTotalKg || 0) <= 0;

            // ── KPI Transport fruits / kg récolté ─────────────────────────────────────
            // Coût Transport fruits = somme des montants pointage_divers (fonction TRANSPORT FRUIT)
            // sur la plage affichée : fenêtre période (windowDates) quand le graphe est visible,
            // sinon la date sélectionnée/repli du jour. Le coût est en DH (TOTAL sur la plage).
            // Dénominateur = kg RÉCOLTÉ de la même fenêtre (redéfinition DG 2026-06) :
            //   en vue période, periodKpi.totalKg (somme récolté sur windowDates = recAgg.totalKg) ;
            //   en mode jour, totalKg (récolté du jour). Aligné sur tfDates par construction.
            const tfDates = (userPeriodKpi && periodKpi && Array.isArray(periodKpi.windowDates))
                ? periodKpi.windowDates
                : [selectedDate || new Date().toISOString().slice(0, 10)];
            // Jour de production = jour où du kg a été récolté (kg>0). On ne somme le
            // transport fruit QUE sur ces jours, pour aligner exactement le numérateur sur
            // le dénominateur tfKgRecolte (qui ne compte que le kg). Sinon, additionner le
            // transport sur ~30 j (presque chaque jour) face à un kg figé sur 1 seul jour
            // gonflait le ratio (ex. 19 600/590 = 33,25 au lieu de 750/590 = 1,27).
            const isProductionDay = (d) => userPeriodKpi && periodKpi
                ? (periodKpi.kgByDate[d] || 0) > 0   // vue période : kg récolté du jour
                : (totalKg || 0) > 0;                // mode jour : kg récolté du jour sélectionné
            const tfTotalCost = (() => {
                let sum = 0;
                let anyLoaded = false;
                tfDates.forEach(d => {
                    if (!isProductionDay(d)) return; // ignorer les jours sans récolte (kg=0)
                    if (transportFruitByDate[d] !== undefined) { anyLoaded = true; sum += transportFruitByDate[d]; }
                });
                return anyLoaded ? sum : null; // null = données pas (encore) chargées
            })();
            const tfKgRecolte = (userPeriodKpi && periodKpi) ? periodKpi.totalKg : totalKg;
            const tfDhParKg = (tfTotalCost !== null && tfKgRecolte > 0)
                ? Math.round(tfTotalCost / tfKgRecolte * 100) / 100
                : null;

            // Aggregation par équipe
            const equipeAgg = {};
            allFiltered.forEach(r => {
                const key = r.prefix;
                if (!equipeAgg[key]) equipeAgg[key] = { prefix: key, equipe: r.equipe, _mats: new Set(), effectif: 0, kg: 0, salaire: 0, transport: 0, prime: 0, charges: 0, workers: [] };
                equipeAgg[key]._mats.add(r.matricule);
                equipeAgg[key].effectif = equipeAgg[key]._mats.size;
                equipeAgg[key].kg += r.kg;
                equipeAgg[key].salaire += r.salaire;
                equipeAgg[key].transport += r.transport;
                equipeAgg[key].prime += r.prime;
                equipeAgg[key].charges += r.charges;
                equipeAgg[key].workers.push(r);
            });
            const equipeStats = Object.values(equipeAgg).map(e => ({ ...e, coutTotal: e.salaire + e.transport + e.prime + e.charges, dhParKg: e.kg > 0 ? Math.round((e.salaire + e.transport + e.prime + e.charges) / e.kg * 100) / 100 : null })).sort((a, b) => {
                if (a.dhParKg === null) return 1; if (b.dhParKg === null) return -1; return a.dhParKg - b.dhParKg;
            });

            // Aggregation par parcelle
            const parcAgg = {};
            allFiltered.forEach(r => {
                const key = r.parcelle || 'N/A';
                if (!parcAgg[key]) parcAgg[key] = { parcelle: key, ferme: r.ferme, culture: r.culture, _mats: new Set(), nbOuv: 0, kg: 0, salaire: 0, transport: 0, prime: 0, charges: 0 };
                parcAgg[key]._mats.add(r.matricule);
                parcAgg[key].nbOuv = parcAgg[key]._mats.size;
                parcAgg[key].kg += r.kg;
                parcAgg[key].salaire += r.salaire;
                parcAgg[key].transport += r.transport;
                parcAgg[key].prime += r.prime;
                parcAgg[key].charges += r.charges;
            });
            const parcStats = Object.values(parcAgg).map(p => ({ ...p, coutTotal: p.salaire + p.transport + p.prime + p.charges, dhParKg: p.kg > 0 ? Math.round((p.salaire + p.transport + p.prime + p.charges) / p.kg * 100) / 100 : null })).sort((a, b) => {
                if (a.dhParKg === null) return 1; if (b.dhParKg === null) return -1; return a.dhParKg - b.dhParKg;
            });

            // Aggregation par culture
            const cultAgg = {};
            allFiltered.forEach(r => {
                // BUG 1 : reventiler Framboise/Myrtille même si r.culture vide (data dégradée).
                const key = r.culture || (normalizeParcelle(r.parcelle || '') || {}).culture || 'Autre';
                if (!cultAgg[key]) cultAgg[key] = { culture: key, _mats: new Set(), nbOuv: 0, kg: 0, salaire: 0, transport: 0, prime: 0, charges: 0 };
                cultAgg[key]._mats.add(r.matricule);
                cultAgg[key].nbOuv = cultAgg[key]._mats.size;
                cultAgg[key].kg += r.kg;
                cultAgg[key].salaire += r.salaire;
                cultAgg[key].transport += r.transport;
                cultAgg[key].prime += r.prime;
                cultAgg[key].charges += r.charges;
            });
            const cultStats = Object.values(cultAgg).map(c => ({ ...c, coutTotal: c.salaire + c.transport + c.prime + c.charges, dhParKg: c.kg > 0 ? Math.round((c.salaire + c.transport + c.prime + c.charges) / c.kg * 100) / 100 : null }));

            // Synthèse par Variété — Cycle Complet (basée sur equipeRows, ignore filtre date/quinzaine)
            const cycleRecordsRaw = (equipeRows || []).filter(r => {
                if (!r || logistiqueOps.test(r.operation || '')) return false;
                if (fermeFilter && r.ferme !== fermeFilter) return false;
                if (avoSubFilter && deriveSubFerme(r.refParcelle, r.parcelle) !== avoSubFilter) return false;
                if (cultureFilter) {
                    const cult = r.culture || '';
                    if (/myrtille/i.test(cult) !== (cultureFilter === 'Myrtille')) return false;
                }
                if (cycleSelected && getCycle(r.jour) !== cycleSelected) return false;
                return true;
            });
            // Agréger par matricule+jour pour obtenir kg/jour (et appliquer prime quotidienne)
            const cycleByWorkerDay = {};
            cycleRecordsRaw.forEach(r => {
                const key = `${r.matricule}|${r.jour}`;
                if (!cycleByWorkerDay[key]) cycleByWorkerDay[key] = { matricule: r.matricule, jour: r.jour, variete: r.variete, kg: 0, salaire: 0 };
                cycleByWorkerDay[key].kg += (r.kg || 0);
                cycleByWorkerDay[key].salaire += (r.cout || 0);
            });
            const cycleVarAgg = {};
            Object.values(cycleByWorkerDay).forEach(d => {
                const key = d.variete || 'N/A';
                if (!cycleVarAgg[key]) cycleVarAgg[key] = { variete: key, kg: 0, joursOuv: 0, salaire: 0, transport: 0, prime: 0, charges: 0 };
                cycleVarAgg[key].kg += d.kg;
                cycleVarAgg[key].joursOuv += 1;
                const prefix = getEquipePrefix(d.matricule);
                cycleVarAgg[key].transport += getTransport(prefix);
                const isMyrt = isMyrtille(d.variete);
                const dPrime = calcPrime(d.kg, isMyrt ? 'myrtille' : d.variete, d.jour);
                const dec = decomposeCoutJour(d.matricule, d.salaire, dPrime, d.jour);
                cycleVarAgg[key].salaire += dec.salaire;
                cycleVarAgg[key].prime += dec.prime;
                cycleVarAgg[key].charges += dec.charges;
            });
            const cycleVarStats = Object.values(cycleVarAgg).map(v => {
                const coutTotal = v.salaire + v.transport + v.prime + v.charges;
                return {
                    ...v,
                    coutTotal,
                    kgParOuvJour: v.joursOuv > 0 ? +(v.kg / v.joursOuv).toFixed(1) : 0,
                    dhParKg: v.kg > 0 ? +(coutTotal / v.kg).toFixed(2) : null,
                    dhParOuvJour: v.joursOuv > 0 ? Math.round(coutTotal / v.joursOuv) : 0,
                };
            }).sort((a, b) => b.kgParOuvJour - a.kgParOuvJour);
            const cycleTotalKg = cycleVarStats.reduce((s, v) => s + v.kg, 0);
            const cycleTotalJours = cycleVarStats.reduce((s, v) => s + v.joursOuv, 0);
            const cycleTotalCout = cycleVarStats.reduce((s, v) => s + v.coutTotal, 0);
            const cycleAvgKgJ = cycleTotalJours > 0 ? +(cycleTotalKg / cycleTotalJours).toFixed(1) : 0;
            const cycleAvgDhKg = cycleTotalKg > 0 ? +(cycleTotalCout / cycleTotalKg).toFixed(2) : null;
            const cycleAvgDhJ = cycleTotalJours > 0 ? Math.round(cycleTotalCout / cycleTotalJours) : 0;

            // ---- Logistique pour le Cycle Complet (mêmes filtres ferme/culture, cycle) ----
            const cycleLogRecordsRaw = (equipeRows || []).filter(r => {
                if (!r || !logistiqueOps.test(r.operation || '')) return false;
                if (fermeFilter && r.ferme !== fermeFilter) return false;
                if (avoSubFilter && deriveSubFerme(r.refParcelle, r.parcelle) !== avoSubFilter) return false;
                if (cultureFilter) {
                    const cult = r.culture || '';
                    if (/myrtille/i.test(cult) !== (cultureFilter === 'Myrtille')) return false;
                }
                if (cycleSelected && getCycle(r.jour) !== cycleSelected) return false;
                return true;
            });
            // Garde la variété par worker-day pour pouvoir attribuer la logistique par variété
            const cycleLogByWD = {};
            cycleLogRecordsRaw.forEach(r => {
                const key = `${r.matricule}|${r.jour}`;
                if (!cycleLogByWD[key]) cycleLogByWD[key] = { matricule: r.matricule, jour: r.jour, variete: r.variete, salaire: 0 };
                cycleLogByWD[key].salaire += (r.cout || 0);
            });
            const cycleLogByVariete = {};
            let cycleLogSalaire = 0, cycleLogTransport = 0, cycleLogCharges = 0;
            Object.values(cycleLogByWD).forEach(d => {
                const t = getTransport(getEquipePrefix(d.matricule));
                // Logistique : pas de prime de récolte (primeRecolte=0). La décomposition SMAG
                // donne salaire = base+ancienneté, prime = primeFonction, charges = chargesPat.
                // On regroupe salaire+prime(fonction) dans la composante « salaire » logistique pour
                // conserver le total = coutEmployeur (cette vue n'expose pas de colonne « prime »).
                const dec = decomposeCoutJour(d.matricule, d.salaire, 0, d.jour);
                const dSalaire = dec.salaire + dec.prime;
                const dCharges = dec.charges;
                cycleLogSalaire += dSalaire;
                cycleLogTransport += t;
                cycleLogCharges += dCharges;
                const v = d.variete || 'N/A';
                cycleLogByVariete[v] = (cycleLogByVariete[v] || 0) + dSalaire + t + dCharges;
            });
            const cycleLogCout = cycleLogSalaire + cycleLogTransport + cycleLogCharges;
            const cycleDhParKgLog = cycleTotalKg > 0 ? +(cycleLogCout / cycleTotalKg).toFixed(2) : 0;
            const cycleAvgDhKgNet = cycleTotalKg > 0 ? +((cycleTotalCout + cycleLogCout) / cycleTotalKg).toFixed(2) : null;

            const dhColor = (val) => {
                if (val === null) return 'var(--gray-400)';
                if (val <= 5) return '#059669';
                if (val <= 8) return '#16a34a';
                if (val <= 12) return '#d97706';
                return '#dc2626';
            };

            const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
            const fmt2 = (n) => n !== null ? n.toFixed(2) : '-';

            return (
                <div className="fade-in">
                    <div style={{position:'sticky',top:0,zIndex:5,background:'var(--berry-bg)',paddingTop:4,paddingBottom:8,marginBottom:8,boxShadow:'0 4px 6px -4px rgba(0,0,0,0.08)'}}>
                    <div style={{marginBottom:8,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#fef3c7',color:'#92400e',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-calculator" style={{marginRight:4}}></i>Coût Récolte — DH/Kg
                        </span>
                        {!isQuinzaineMode && (
                        <select value={selectedDate} onChange={e => handleDateChange(e.target.value)} style={{padding:'4px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600}}>
                            <option value="">Aujourd'hui</option>
                            {dates.filter(d => d.date !== new Date().toISOString().slice(0,10)).map(d => <option key={d.date} value={d.date}>{new Date(d.date+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</option>)}
                        </select>
                        )}
                        {!isQuinzaineMode && autoFellBack && selectedDate && (
                        <span title="La récolte du jour n'est pas encore saisie (synchronisation J+1/J+2)." style={{background:'#e0f2fe',color:'#075985',padding:'4px 10px',borderRadius:10,fontSize:10.5,fontWeight:600,display:'inline-flex',alignItems:'center',gap:4}}>
                            <i className="fa-solid fa-circle-info"></i>Récolte du jour pas encore saisie — dernière journée affichée
                        </span>
                        )}
                        {isQuinzaineMode && periodesAvecDonnees.length > 0 && (
                        <window.QuinzaineCampagneSelect periodes={periodesAvecDonnees} periodeCampagne={equipePeriodeCampagne} value={effectiveQuinz} onChange={v => setSelectedQuinz(v)} />
                        )}
                        <div style={{display:'flex',gap:4}}>
                            <button onClick={() => setViewMode('jour')} style={{padding:'4px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600,background:viewMode==='jour'?'var(--berry)':'white',color:viewMode==='jour'?'white':'var(--gray-600)',cursor:'pointer'}}>Jour</button>
                            <button onClick={() => setViewMode('quinzaine')} style={{padding:'4px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600,background:viewMode==='quinzaine'?'var(--berry)':'white',color:viewMode==='quinzaine'?'white':'var(--gray-600)',cursor:'pointer'}}>Quinzaine</button>
                        </div>
                    </div>

                    {!farmFilter && (
                    <div className="filters-bar">
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            <button className={`chip c-green ${fermeFilter === '' ? 'active' : ''}`} onClick={() => setFermeFilter('')}>Toutes</button>
                            <button className={`chip c-green ${fermeFilter === 'F1' ? 'active' : ''}`} onClick={() => setFermeFilter('F1')}>F1</button>
                            <button className={`chip c-green ${fermeFilter === 'F5' ? 'active' : ''}`} onClick={() => setFermeFilter('F5')}>F5</button>
                            <button className={`chip c-green ${fermeFilter === 'Avocatier' ? 'active' : ''}`} onClick={() => setFermeFilter('Avocatier')}>Avocatier</button>
                        </div>
                        <div className="chip-group" style={{marginLeft:8}}>
                            <span className="chip-group-label">Culture:</span>
                            <button className={`chip c-blue ${cultureFilter === '' ? 'active' : ''}`} onClick={() => { setCultureFilter(''); setVarieteFilter(''); }}>Toutes</button>
                            <button className={`chip c-blue ${cultureFilter === 'Framboise' ? 'active' : ''}`} onClick={() => { setCultureFilter('Framboise'); setVarieteFilter(''); }}>Framboise</button>
                            <button className={`chip c-blue ${cultureFilter === 'Myrtille' ? 'active' : ''}`} onClick={() => { setCultureFilter('Myrtille'); setVarieteFilter(''); }}>Myrtille</button>
                        </div>
                        {availableVarietes.length > 1 && (
                        <div style={{marginLeft:8,display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontSize:12,fontWeight:500,color:'var(--gray-600)'}}>Variété:</span>
                            <select value={varieteFilter} onChange={e => setVarieteFilter(e.target.value)} style={{padding:'5px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600,background:'white',color:'var(--gray-700)'}}>
                                <option value="">Toutes ({availableVarietes.length})</option>
                                {availableVarietes.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                        )}
                    </div>
                    )}
                    </div>

                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                        <span style={{fontSize:10,fontWeight:600,color:userPeriodKpi?'var(--berry)':'var(--gray-500)',background:userPeriodKpi?'var(--berry-pale)':'var(--gray-100)',padding:'2px 10px',borderRadius:10}}>
                            <i className="fa-solid fa-calendar-day" style={{marginRight:4}}></i>Indicateurs : {kpiPeriodLabel}
                        </span>
                    </div>
                    {recolteKgEnAttente && (
                    <div style={{display:'flex',alignItems:'flex-start',gap:8,background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:10,padding:'10px 12px',marginBottom:10,color:'#92400e',fontSize:12,lineHeight:1.4}}>
                        <i className="fa-solid fa-clock-rotate-left" style={{marginTop:2}}></i>
                        <span>Les <b>kg de récolte</b> ne sont pas encore synchronisés pour cette période (données de traçabilité prod en J+1/J+2). Les <b>coûts</b> sont disponibles ; les ratios <b>DH/kg</b> et le graphique s'afficheront dès la synchronisation. Sélectionne une journée plus ancienne pour voir le détail déjà consolidé.</span>
                    </div>
                    )}
                    <div className="kpi-grid">
                        <KPICard icon="fa-coins" iconClass="purple" value={kpiDhParKgNet !== null ? kpiDhParKgNet.toFixed(2) + ' DH' : '-'} label="Coût Net (Récolte + Logistique)" subItems={[{value: kpiDhParKgGlobal !== null ? kpiDhParKgGlobal.toFixed(2) : '-', label: 'Récolte'}, {value: kpiDhParKgLog !== null ? kpiDhParKgLog.toFixed(2) : '-', label: 'Logistique'}]} />
                        <KPICard icon="fa-divide" iconClass="berry" value={kpiDhParKgGlobal !== null ? kpiDhParKgGlobal.toFixed(2) + ' DH' : '-'} label="Coût Brut (Hors logistique)" />
                        <KPICard icon="fa-coins" iconClass="orange" value={fmt(kpiCoutDisplay)} label={kpiCoutLabelDisplay} subItems={[{value: fmt(kpiSalaire), label: 'Salaire de base'}, {value: fmt(kpiTransport), label: 'Transport'}, {value: fmt(kpiPrime), label: 'Prime'}, {value: fmt(kpiCharges), label: 'Charges patronales'}]} />
                        <KPICard icon="fa-basket-shopping" iconClass="green" value={fmt(kpiTotalKgDisplay)} label={kpiKgLabelDisplay} />
                        <KPICard icon="fa-user" iconClass="blue" value={fmt(kpiCoutMoyenOuvrierJour) + ' DH'} label="Coût Moyen / Ouvrier / Jour" />
                        <KPICard icon="fa-users" iconClass="green" value={kpiNbOuvriers} label="Ouvriers Récolte" />
                        <KPICard icon="fa-chart-pie" iconClass="purple" value={kpiPctSalaire + '%'} label="Salaire dans Coût" />
                        <KPICard icon="fa-truck-fast" iconClass="orange"
                            value={tfDhParKg !== null ? tfDhParKg.toFixed(2).replace('.', ',') + ' DH' : '—'}
                            label="Transport fruits / kg récolté"
                            subItems={[
                                {value: tfTotalCost !== null ? fmt(tfTotalCost) : '—', label: 'Coût transport'},
                                {value: tfKgRecolte ? fmt(tfKgRecolte) : '—', label: 'Kg récolté'}
                            ]} />
                    </div>

                    {showTrend && (() => {
                        const allEqRows = (fermeFilter ? equipeRows.filter(r => r.ferme === fermeFilter) : equipeRows).filter(matchSub);
                        const cultureFilteredEq = cultureFilter ? allEqRows.filter(r => /myrtille/i.test(r.culture || resolveCulture(r)) === (cultureFilter === 'Myrtille')) : allEqRows;
                        // BUG 1 : filtre variété robuste (texte parcelle en fallback si colonne vide),
                        // aligné avec le calcul des KPI période (resolveVariete).
                        const varieteFilteredEq = varieteFilter ? cultureFilteredEq.filter(r => resolveVariete(r) === varieteFilter) : cultureFilteredEq;
                        // Pagination : fenêtre de histRange JOURS DE DONNÉES, décalée par histOffset.
                        // La pagination s'appuie sur les jours réellement présents (évite des pages vides),
                        // mais l'axe X affiché est rendu CONTINU (jours sans récolte inclus à 0) pour ne
                        // laisser aucun trou dans la fenêtre — cf. point "vérifier données" du backlog.
                        const allDatesDesc = [...new Set(varieteFilteredEq.map(r => r.jour))].sort().reverse();
                        const winStart = histOffset * histRange;
                        const dataDates = allDatesDesc.slice(winStart, winStart + histRange).reverse(); // jours avec données, asc
                        // Remplir les jours calendaires manquants entre le premier et le dernier jour de données de la fenêtre.
                        const fillCalendarGaps = (sortedAsc) => {
                            if (sortedAsc.length < 2) return sortedAsc.slice();
                            const out = [];
                            const start = new Date(sortedAsc[0] + 'T12:00:00');
                            const end = new Date(sortedAsc[sortedAsc.length - 1] + 'T12:00:00');
                            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                out.push(d.toISOString().slice(0, 10));
                            }
                            return out;
                        };
                        const allDates = fillCalendarGaps(dataDates);
                        const hasOlder = allDatesDesc.length > winStart + histRange;
                        const hasNewer = histOffset > 0;
                        const logOps = /caporal|conditionnement|encadrement|chargement/i;
                        const aggregateRows = (rows) => {
                            const byW = {};
                            rows.forEach(r => {
                                const k = r.matricule;
                                if (!byW[k]) byW[k] = { matricule: r.matricule, kg: 0, salaire: 0, variete: r.variete, parcelle: r.parcelle, culture: r.culture };
                                byW[k].kg += (r.kg || 0);
                                byW[k].salaire += (r.cout || 0);
                            });
                            const wList = Object.values(byW);
                            const dayPeriode = (rows.find(r => r.periode) || {}).periode || '';
                            let tSalaire = 0, tTransport = 0, tPrime = 0, tCharges = 0, tKg = 0;
                            wList.forEach(w => {
                                const culture = w.culture || resolveCulture(w);
                                const isMyrt = /myrtille/i.test(culture);
                                const prefix = getEquipePrefix(w.matricule);
                                const wPrime = calcPrime(w.kg, isMyrt ? 'myrtille' : w.variete, w.jour);
                                const dec = decomposeCoutJour(w.matricule, w.salaire, wPrime, w.jour);
                                tSalaire += dec.salaire;
                                tTransport += getTransport(prefix, dayPeriode);
                                tPrime += dec.prime;
                                tCharges += dec.charges;
                                tKg += w.kg;
                            });
                            return { salaire: tSalaire, transport: tTransport, prime: tPrime, charges: tCharges, cout: tSalaire + tTransport + tPrime + tCharges, kg: tKg, nb: wList.length };
                        };
                        // Surface (ha) couverte par la sélection un jour donné.
                        // Hypothèse : on somme les ha des parcelles (variété × ferme) réellement
                        // récoltées ce jour, pour le cycle du jour (getHaByCycle agrège les parcelles
                        // d'une variété). Sous-variété ignorée car les lignes récolte ne portent que
                        // la variété de base (Maravilla/Yazmin/Corina/…), pas LC/MD.
                        // Garde-fous : ha >= 0, pas de double comptage (clé variete|ferme unique).
                        const haForDay = (rows, date) => {
                            const cyc = getCycle(date);
                            const seen = {};
                            let ha = 0;
                            rows.forEach(r => {
                                const v = r.variete;
                                const f = r.ferme || '';
                                if (!v) return;
                                const key = `${v}|${f}`;
                                if (seen[key]) return;
                                seen[key] = true;
                                const h = getHaByCycle(v, null, f || null, cyc) || 0;
                                if (h > 0) ha += h;
                            });
                            return ha;
                        };
                        const todayStrEarly = new Date().toISOString().slice(0, 10);
                        const recolteDateEarly = selectedDate || todayStrEarly;
                        const trendData = allDates.map(date => {
                            // Pour la date sélectionnée en Jour mode : reprendre EXACTEMENT les valeurs du KPI
                            // (source recolte plus complète & dédupliquée). Évite divergence visuelle entre Coût Net KPI et barre du jour.
                            if (!isQuinzaineMode && date === recolteDateEarly) {
                                const dhKg = totalKg > 0 ? Math.round(totalCout / totalKg * 100) / 100 : null;
                                const dhKgLog = totalKg > 0 ? Math.round(totalLogCout / totalKg * 100) / 100 : null;
                                const label = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short', day:'numeric'});
                                const haDay = haForDay(allFiltered, date);
                                const kgHa = haDay > 0 ? Math.round(totalKg / haDay * 10) / 10 : 0;
                                return { date, label, salaire: totalSalaire, transport: totalTransport, prime: totalPrime, charges: totalCharges, cout: totalCout, kg: totalKg, dhKg, dhKgLog, nb: nbOuvriers, ha: haDay, kgHa };
                            }
                            const dayRows = varieteFilteredEq.filter(r => r.jour === date && !logOps.test(r.operation || ''));
                            const logRows = varieteFilteredEq.filter(r => r.jour === date && logOps.test(r.operation || ''));
                            const agg = aggregateRows(dayRows);
                            const logAgg = aggregateRows(logRows);
                            const dhKg = agg.kg > 0 ? Math.round(agg.cout / agg.kg * 100) / 100 : null;
                            // Logistique DH/Kg : coût logistique du jour divisé par les kg RÉCOLTÉS du jour
                            const dhKgLog = agg.kg > 0 ? Math.round(logAgg.cout / agg.kg * 100) / 100 : null;
                            const label = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'short', day:'numeric'});
                            const haDay = haForDay(dayRows, date);
                            const kgHa = haDay > 0 ? Math.round(agg.kg / haDay * 10) / 10 : 0;
                            return { date, label, salaire: agg.salaire, transport: agg.transport, prime: agg.prime, charges: agg.charges, cout: agg.cout, kg: agg.kg, dhKg, dhKgLog, nb: agg.nb, ha: haDay, kgHa };
                        });
                        // Échelle Y stable : calculée sur TOUTES les dates disponibles, pas seulement la fenêtre.
                        // Évite que les barres "grandissent" ou "rétrécissent" en navigant entre fenêtres.
                        const allDhKgNet = allDatesDesc.map(date => {
                            // Date sélectionnée en mode Jour : aligner l'échelle sur la valeur KPI
                            // (même source que trendData), sinon maxDhKg ignore ce jour (lignes kg=0)
                            // et la barre logistique déborde le graphe.
                            if (!isQuinzaineMode && date === recolteDateEarly) {
                                return totalKg > 0 ? (totalCout + totalLogCout) / totalKg : 0;
                            }
                            const dRecRows = varieteFilteredEq.filter(r => r.jour === date && !logOps.test(r.operation || ''));
                            const dLogRows = varieteFilteredEq.filter(r => r.jour === date && logOps.test(r.operation || ''));
                            const a = aggregateRows(dRecRows);
                            const lA = aggregateRows(dLogRows);
                            if (a.kg <= 0) return 0;
                            return (a.cout + lA.cout) / a.kg;
                        });
                        // Échelle Y ROBUSTE aux outliers : un jour à très faible kg (coût/kg
                        // énorme, ex. 1 ouvrier 0,5 kg → 200 DH/kg) ne doit pas écraser toutes les
                        // autres barres. Avec plusieurs quinzaines chargées, ces jours dégénérés
                        // sont plus fréquents → on plafonne maxDhKg à 3× la médiane des DH/kg>0
                        // (échelle stable, les rares jours extrêmes clippent en haut, acceptable).
                        const __dhPos = allDhKgNet.filter(v => v > 0).sort((a, b) => a - b);
                        const __dhMed = __dhPos.length ? __dhPos[Math.floor(__dhPos.length / 2)] : 1;
                        const maxDhKg = Math.max(1, Math.min(Math.max(...allDhKgNet, 1), __dhMed * 3));
                        const BAR_H = 200;
                        // Axe Y secondaire (droite) pour la courbe Kg/ha. Échelle calculée sur la fenêtre affichée.
                        // Garde-fou : min 1 pour éviter division par 0 / NaN.
                        const maxKgHa = Math.max(1, ...trendData.map(d => d.kgHa || 0)) * 1.1;
                        const KGHA_COLOR = '#059669';
                        // Points de la courbe (coordonnées en % via preserveAspectRatio:none) : x = centre de colonne, y = band BAR_H.
                        const nTrend = trendData.length;
                        const kgHaPoints = trendData.map((d, i) => ({
                            x: nTrend === 1 ? 50 : (i / (nTrend - 1)) * 100,
                            y: BAR_H - Math.max(0, Math.min(BAR_H, ((d.kgHa || 0) / maxKgHa) * BAR_H)),
                            kgHa: d.kgHa || 0,
                            ha: d.ha || 0
                        }));
                        const hasKgHa = kgHaPoints.some(p => p.kgHa > 0);
                        const kgHaPathD = kgHaPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                        const todayStr = new Date().toISOString().slice(0, 10);
                        const recolteDate = selectedDate || todayStr;
                        const COLORS = { salaire: '#7c3aed', transport: '#0ea5e9', prime: '#f59e0b', charges: '#f87171', logistique: '#475569' };
                        const LOG_HATCH = `repeating-linear-gradient(45deg, ${COLORS.logistique}, ${COLORS.logistique} 4px, rgba(71,85,105,0.45) 4px, rgba(71,85,105,0.45) 8px)`;
                        return (
                            <div className="fade-in" style={{background:'var(--gray-50)',borderRadius:12,padding:16,marginBottom:16,border:'1px solid var(--gray-200)'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                                    <h4 style={{margin:0,fontSize:14,fontWeight:700,color:'var(--berry)'}}>
                                        <i className="fa-solid fa-chart-bar" style={{marginRight:6}}></i>
                                        Historique DH/Kg — {histOffset === 0 ? `${histRange} derniers jours` : (allDates.length > 0 ? `du ${new Date(allDates[0]+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} au ${new Date(allDates[allDates.length-1]+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}` : 'aucune donnée')}
                                    </h4>
                                    <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                                        <button onClick={() => setHistOffset(o => o + 1)} disabled={!hasOlder} title="Fenêtre précédente" style={{background:hasOlder?'white':'var(--gray-100)',border:'1px solid var(--gray-200)',borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:600,color:hasOlder?'var(--gray-700)':'var(--gray-400)',cursor:hasOlder?'pointer':'not-allowed'}}>
                                            <i className="fa-solid fa-chevron-left"></i>
                                        </button>
                                        <button onClick={() => setHistOffset(o => Math.max(0, o - 1))} disabled={!hasNewer} title="Fenêtre suivante" style={{background:hasNewer?'white':'var(--gray-100)',border:'1px solid var(--gray-200)',borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:600,color:hasNewer?'var(--gray-700)':'var(--gray-400)',cursor:hasNewer?'pointer':'not-allowed'}}>
                                            <i className="fa-solid fa-chevron-right"></i>
                                        </button>
                                        <div style={{display:'flex',gap:0,marginLeft:6}}>
                                            {[7, 30, 60, 90].map((r, ri, arr) => (
                                                <button key={r} onClick={() => { setHistRange(r); setHistOffset(0); }} style={{padding:'4px 10px',border:'1px solid var(--gray-200)',borderLeft:ri===0?'1px solid var(--gray-200)':'none',borderRadius:ri===0?'6px 0 0 6px':(ri===arr.length-1?'0 6px 6px 0':0),fontSize:11,fontWeight:600,background:histRange===r?'var(--berry)':'white',color:histRange===r?'white':'var(--gray-600)',cursor:'pointer'}}>{r} j</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                {trendData.length === 0 ? (
                                    <div style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:12}}>Pas de données disponibles</div>
                                ) : (
                                    <div style={{position:'relative'}}>
                                        {/* Axe Y secondaire (Kg/ha) — graduations à droite */}
                                        {hasKgHa && (
                                        <div style={{position:'absolute',right:0,top:18,height:BAR_H,width:34,pointerEvents:'none',zIndex:1}}>
                                            {[0,0.25,0.5,0.75,1].map((t,ti) => (
                                                <span key={ti} style={{position:'absolute',right:0,top:`${(1-t)*BAR_H-6}px`,fontSize:8,color:KGHA_COLOR,fontWeight:600}}>{Math.round(maxKgHa*t)}</span>
                                            ))}
                                        </div>
                                        )}
                                        <div style={{display:'flex',alignItems:'flex-end',gap:6,padding:'0 4px'}}>
                                            {trendData.map((d, i) => {
                                                const isToday = d.date === recolteDate;
                                                const dhKgNet = (d.dhKg || 0) + (d.dhKgLog || 0);
                                                // Clamp défensif : aucune barre (récolte ou logistique) ne doit dépasser BAR_H,
                                                // et leur somme empilée non plus — garde-fou contre toute désync d'échelle.
                                                const rawTotalBarH = d.dhKg !== null ? (d.dhKg / maxDhKg) * BAR_H : 0;
                                                const totalBarH = Math.min(rawTotalBarH, BAR_H);
                                                const rawHLog = d.dhKgLog > 0 ? (d.dhKgLog / maxDhKg) * BAR_H : 0;
                                                const hLog = Math.min(rawHLog, Math.max(0, BAR_H - totalBarH));
                                                const pSal = d.cout > 0 ? d.salaire / d.cout : 0;
                                                const pTra = d.cout > 0 ? d.transport / d.cout : 0;
                                                const pPri = d.cout > 0 ? d.prime / d.cout : 0;
                                                const pCha = d.cout > 0 ? d.charges / d.cout : 0;
                                                const hSal = totalBarH * pSal;
                                                const hTra = totalBarH * pTra;
                                                const hPri = totalBarH * pPri;
                                                const hCha = totalBarH * pCha;
                                                return (
                                                    <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                                                        <span style={{fontSize:11,fontWeight:700,color:dhColor(dhKgNet || null),height:14,lineHeight:'14px',whiteSpace:'nowrap'}}>{dhKgNet > 0 ? dhKgNet.toFixed(1) : '-'}</span>
                                                        {/* Bande de tracé fixe (BAR_H) — la barre s'aligne en bas, partagée avec l'overlay courbe Kg/ha */}
                                                        <div style={{width:'100%',height:BAR_H,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
                                                            <div style={{width:'100%',maxWidth:48,display:'flex',flexDirection:'column',justifyContent:'flex-end',borderRadius:'6px 6px 0 0',overflow:'hidden',border:isToday?'2px solid var(--berry)':'none'}}>
                                                                <div style={{height:hCha,background:COLORS.charges,transition:'height 0.3s'}} title={`Charges: ${fmt(d.charges)} DH`}></div>
                                                                <div style={{height:hPri,background:COLORS.prime,transition:'height 0.3s'}} title={`Prime: ${fmt(d.prime)} DH`}></div>
                                                                <div style={{height:hTra,background:COLORS.transport,transition:'height 0.3s'}} title={`Transport: ${fmt(d.transport)} DH`}></div>
                                                                <div style={{height:hSal,background:COLORS.salaire,transition:'height 0.3s'}} title={`Salaire: ${fmt(d.salaire)} DH`}></div>
                                                                {hLog > 0 && (
                                                                    <div style={{height:hLog,background:LOG_HATCH,transition:'height 0.3s'}} title={`Logistique: ${d.dhKgLog.toFixed(2)} DH/Kg`}></div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <span style={{fontSize:8,color:'var(--gray-400)',height:11,lineHeight:'11px',whiteSpace:'nowrap'}}>{d.kg > 0 ? fmt(d.kg) + ' kg' : ''}</span>
                                                        <span style={{fontSize:9,color:isToday?'var(--berry)':'var(--gray-500)',fontWeight:isToday?700:400,height:13,lineHeight:'13px',whiteSpace:'nowrap'}}>{d.label}</span>
                                                        <span style={{fontSize:8,color:'var(--gray-400)',height:11,lineHeight:'11px',whiteSpace:'nowrap'}}>{d.nb} ouv.</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* Overlay SVG courbe Kg/ha (axe Y secondaire à droite). preserveAspectRatio:none → coords directes. */}
                                        {hasKgHa && (
                                        <svg width="100%" height={BAR_H} viewBox={`0 0 100 ${BAR_H}`} preserveAspectRatio="none" style={{position:'absolute',left:0,top:18,pointerEvents:'none',overflow:'visible',zIndex:2}}>
                                            <path d={kgHaPathD} fill="none" stroke={KGHA_COLOR} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                                        </svg>
                                        )}
                                        {/* Pastilles + valeurs Kg/ha alignées par colonne (hors SVG pour rester lisibles à l'échelle) */}
                                        {hasKgHa && (
                                        <div style={{position:'absolute',left:4,right:4,top:18,height:BAR_H,display:'flex',gap:6,pointerEvents:'none',zIndex:3}}>
                                            {kgHaPoints.map((p, i) => (
                                                <div key={i} style={{flex:1,position:'relative'}}>
                                                    {p.kgHa > 0 && (
                                                    <span style={{position:'absolute',left:'50%',top:`${p.y}px`,transform:'translate(-50%,-130%)',fontSize:8,fontWeight:700,color:KGHA_COLOR,whiteSpace:'nowrap'}}>{p.kgHa}</span>
                                                    )}
                                                    {p.kgHa > 0 && (
                                                    <span style={{position:'absolute',left:'50%',top:`${p.y}px`,transform:'translate(-50%,-50%)',width:5,height:5,borderRadius:'50%',background:KGHA_COLOR}}></span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        )}
                                        <div style={{display:'flex',justifyContent:'center',gap:16,marginTop:14,fontSize:10,color:'var(--gray-600)',flexWrap:'wrap'}}>
                                            <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:COLORS.salaire,marginRight:4,verticalAlign:'middle'}}></span>Salaire de base (SMAG + ancienneté)</span>
                                            <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:COLORS.transport,marginRight:4,verticalAlign:'middle'}}></span>Transport</span>
                                            <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:COLORS.prime,marginRight:4,verticalAlign:'middle'}}></span>Prime (fonction + récolte)</span>
                                            <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:COLORS.charges,marginRight:4,verticalAlign:'middle'}}></span>Charges patronales (19,26%)</span>
                                            <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:LOG_HATCH,marginRight:4,verticalAlign:'middle'}}></span>Part Logistique</span>
                                            {hasKgHa && <span><span style={{display:'inline-block',width:14,height:3,borderRadius:2,background:KGHA_COLOR,marginRight:4,verticalAlign:'middle'}}></span>Volume Kg/ha (axe droit)</span>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* ---- Par Culture ---- */}
                    <Panel title="Coût par Culture" icon="fa-seedling" defaultOpen={true}>
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table" style={{fontSize:11}}>
                            <thead><tr><th>Culture</th><th>Effectif</th><th style={{textAlign:'right'}}>Kg</th><th style={{textAlign:'right'}}>Salaire</th><th style={{textAlign:'right'}}>Transport</th><th style={{textAlign:'right'}}>Prime</th><th style={{textAlign:'right'}}>Charges</th><th style={{textAlign:'right'}}>Coût Total</th><th style={{textAlign:'right',fontWeight:700}}>DH/Kg Brut</th><th style={{textAlign:'right',fontWeight:700,background:'#f3e8ff'}}>DH/Kg Net</th></tr></thead>
                            <tbody>
                                {cultStats.map(c => {
                                    const logShareC = logByCulture[c.culture] || 0;
                                    const netVal = c.kg > 0 ? +((c.coutTotal + logShareC) / c.kg).toFixed(2) : null;
                                    return (
                                    <tr key={c.culture}>
                                        <td><span style={{fontWeight:600}}>{c.culture}</span></td>
                                        <td>{c.nbOuv}</td>
                                        <td style={{textAlign:'right'}}>{fmt(c.kg)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(c.salaire)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(c.transport)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(c.prime)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(c.charges)}</td>
                                        <td style={{textAlign:'right',fontWeight:600}}>{fmt(c.coutTotal)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(c.dhParKg),fontSize:13}}>{fmt2(c.dhParKg)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(netVal),fontSize:13,background:'#faf5ff'}}>{fmt2(netVal)}</td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot><tr style={{fontWeight:700,background:'var(--gray-50)'}}><td>Total</td><td>{nbOuvriers}</td><td style={{textAlign:'right'}}>{fmt(totalKg)}</td><td style={{textAlign:'right'}}>{fmt(totalSalaire)}</td><td style={{textAlign:'right'}}>{fmt(totalTransport)}</td><td style={{textAlign:'right'}}>{fmt(totalPrime)}</td><td style={{textAlign:'right'}}>{fmt(totalCharges)}</td><td style={{textAlign:'right'}}>{fmt(totalCout)}</td><td style={{textAlign:'right',color:dhColor(dhParKgGlobal),fontSize:13}}>{fmt2(dhParKgGlobal)}</td><td style={{textAlign:'right',color:dhColor(dhParKgNet),fontSize:13,background:'#faf5ff'}}>{fmt2(dhParKgNet)}</td></tr></tfoot>
                        </table>
                        </div>
                    </Panel>

                    {/* ---- Par Équipe ---- */}
                    <Panel title="Coût par Équipe" icon="fa-users" defaultOpen={true}>
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table" style={{fontSize:11}}>
                            <thead><tr><th>Équipe</th><th>Effectif</th><th style={{textAlign:'right'}}>Kg</th><th style={{textAlign:'right'}}>Salaire</th><th style={{textAlign:'right'}}>Transport</th><th style={{textAlign:'right'}}>Prime</th><th style={{textAlign:'right'}}>Charges</th><th style={{textAlign:'right'}}>Coût Total</th><th style={{textAlign:'right',fontWeight:700}}>DH/Kg Brut</th><th style={{textAlign:'right',fontWeight:700,background:'#f3e8ff'}}>DH/Kg Net</th></tr></thead>
                            <tbody>
                                {equipeStats.map(e => {
                                    const logShareE = logByEquipe[e.prefix] || 0;
                                    const netE = e.kg > 0 ? +((e.coutTotal + logShareE) / e.kg).toFixed(2) : null;
                                    const equipeLogPerKg = e.kg > 0 ? logShareE / e.kg : 0;
                                    return (
                                    <React.Fragment key={e.prefix}>
                                    <tr style={{cursor:'pointer',background:expandedEquipe===e.prefix?'var(--gray-50)':'white'}} onClick={() => setExpandedEquipe(expandedEquipe===e.prefix?null:e.prefix)}>
                                        <td><i className={`fa-solid ${expandedEquipe===e.prefix?'fa-chevron-down':'fa-chevron-right'}`} style={{fontSize:9,marginRight:6,color:'var(--gray-400)'}}></i><span style={{fontWeight:600}}>{e.equipe}</span></td>
                                        <td>{e.effectif}</td>
                                        <td style={{textAlign:'right'}}>{fmt(e.kg)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(e.salaire)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(e.transport)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(e.prime)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(e.charges)}</td>
                                        <td style={{textAlign:'right',fontWeight:600}}>{fmt(e.coutTotal)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(e.dhParKg),fontSize:13}}>{fmt2(e.dhParKg)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(netE),fontSize:13,background:'#faf5ff'}}>{fmt2(netE)}</td>
                                    </tr>
                                    {expandedEquipe===e.prefix && e.workers.sort((a,b) => { if(a.dhParKg===null) return 1; if(b.dhParKg===null) return -1; return a.dhParKg-b.dhParKg; }).map((w,i) => {
                                        const netW = w.dhParKg !== null ? +(w.dhParKg + equipeLogPerKg).toFixed(2) : null;
                                        return (
                                        <tr key={w.matricule+i} style={{background:'var(--gray-25)',fontSize:10}}>
                                            <td style={{paddingLeft:28}}>{w.matricule} — {w.nom}</td>
                                            <td></td>
                                            <td style={{textAlign:'right'}}>{fmt(w.kg)}</td>
                                            <td style={{textAlign:'right'}}>{fmt(w.salaire)}</td>
                                            <td style={{textAlign:'right'}}>{fmt(w.transport)}</td>
                                            <td style={{textAlign:'right'}}>{fmt(w.prime)}</td>
                                            <td style={{textAlign:'right'}}>{fmt(w.charges)}</td>
                                            <td style={{textAlign:'right',fontWeight:600}}>{fmt(w.coutTotal)}</td>
                                            <td style={{textAlign:'right',fontWeight:700,color:dhColor(w.dhParKg)}}>{fmt2(w.dhParKg)}</td>
                                            <td style={{textAlign:'right',fontWeight:700,color:dhColor(netW),background:'#faf5ff'}}>{fmt2(netW)}</td>
                                        </tr>
                                        );
                                    })}
                                    </React.Fragment>
                                    );
                                })}
                            </tbody>
                            <tfoot><tr style={{fontWeight:700,background:'var(--gray-50)'}}><td>Total</td><td>{nbOuvriers}</td><td style={{textAlign:'right'}}>{fmt(totalKg)}</td><td style={{textAlign:'right'}}>{fmt(totalSalaire)}</td><td style={{textAlign:'right'}}>{fmt(totalTransport)}</td><td style={{textAlign:'right'}}>{fmt(totalPrime)}</td><td style={{textAlign:'right'}}>{fmt(totalCharges)}</td><td style={{textAlign:'right'}}>{fmt(totalCout)}</td><td style={{textAlign:'right',color:dhColor(dhParKgGlobal),fontSize:13}}>{fmt2(dhParKgGlobal)}</td><td style={{textAlign:'right',color:dhColor(dhParKgNet),fontSize:13,background:'#faf5ff'}}>{fmt2(dhParKgNet)}</td></tr></tfoot>
                        </table>
                        </div>
                    </Panel>

                    {/* ---- Par Parcelle ---- */}
                    <Panel title="Coût par Parcelle" icon="fa-map" defaultOpen={false}>
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table" style={{fontSize:11}}>
                            <thead><tr><th>Parcelle</th><th>Ferme</th><th>Culture</th><th>Ouvriers</th><th style={{textAlign:'right'}}>Kg</th><th style={{textAlign:'right'}}>Coût Total</th><th style={{textAlign:'right',fontWeight:700}}>DH/Kg Brut</th><th style={{textAlign:'right',fontWeight:700,background:'#f3e8ff'}}>DH/Kg Net</th></tr></thead>
                            <tbody>
                                {parcStats.map(p => {
                                    const logShareP = logByParcelle[p.parcelle] || 0;
                                    const netP = p.kg > 0 ? +((p.coutTotal + logShareP) / p.kg).toFixed(2) : null;
                                    return (
                                    <tr key={p.parcelle}>
                                        <td style={{fontWeight:600}}>{p.parcelle}</td>
                                        <td>{p.ferme}</td>
                                        <td>{p.culture}</td>
                                        <td>{p.nbOuv}</td>
                                        <td style={{textAlign:'right'}}>{fmt(p.kg)}</td>
                                        <td style={{textAlign:'right',fontWeight:600}}>{fmt(p.coutTotal)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(p.dhParKg),fontSize:13}}>{fmt2(p.dhParKg)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(netP),fontSize:13,background:'#faf5ff'}}>{fmt2(netP)}</td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        </div>
                    </Panel>

                    {/* ---- Synthèse par Variété — Cycle Complet (déplacée en bas) ---- */}
                    <Panel title="Synthèse par Variété — Cycle Complet" icon="fa-chart-line" defaultOpen={true}>
                        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10,flexWrap:'wrap'}}>
                            <span style={{fontSize:11,color:'var(--gray-600)',fontWeight:600}}>Cycle :</span>
                            {[{v:1,l:'Cycle 1 (Sep–Déc)'},{v:2,l:'Cycle 2 (Jan–Juin)'},{v:0,l:'Les deux'}].map(o => (
                                <button key={o.v} onClick={() => setCycleSelected(o.v)} style={{padding:'4px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600,background:cycleSelected===o.v?'var(--berry)':'white',color:cycleSelected===o.v?'white':'var(--gray-600)',cursor:'pointer'}}>{o.l}</button>
                            ))}
                            <span style={{marginLeft:'auto',fontSize:10,color:'var(--gray-500)',fontStyle:'italic'}}>
                                <i className="fa-solid fa-info-circle" style={{marginRight:4}}></i>
                                Cumul sur le cycle entier — indépendant du filtre date/quinzaine
                            </span>
                        </div>
                        {cycleVarStats.length === 0 ? (
                            <div style={{padding:20,textAlign:'center',color:'var(--gray-400)',fontSize:12}}>Aucune donnée pour ce cycle.</div>
                        ) : (
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table" style={{fontSize:11}}>
                            <thead><tr>
                                <th>Variété</th>
                                <th style={{textAlign:'right'}}>Kg total</th>
                                <th style={{textAlign:'right'}}>J-Ouvriers</th>
                                <th style={{textAlign:'right',fontWeight:700,background:'#fef3c7'}}>Kg/ouv/j</th>
                                <th style={{textAlign:'right'}}>Coût total (DH)</th>
                                <th style={{textAlign:'right',fontWeight:700}}>DH/Kg Brut</th>
                                <th style={{textAlign:'right',fontWeight:700,background:'#f3e8ff'}}>DH/Kg Net</th>
                                <th style={{textAlign:'right',fontWeight:700,background:'#fef3c7'}}>DH/ouv/j</th>
                            </tr></thead>
                            <tbody>
                                {cycleVarStats.map(v => {
                                    const logShareV = cycleLogByVariete[v.variete] || 0;
                                    const netV = v.kg > 0 ? +((v.coutTotal + logShareV) / v.kg).toFixed(2) : null;
                                    return (
                                    <tr key={v.variete}>
                                        <td><span style={{fontWeight:600}}>{v.variete}</span></td>
                                        <td style={{textAlign:'right'}}>{fmt(v.kg)}</td>
                                        <td style={{textAlign:'right'}}>{fmt(v.joursOuv)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,fontSize:13,background:'#fffbeb'}}>{v.kgParOuvJour}</td>
                                        <td style={{textAlign:'right'}}>{fmt(v.coutTotal)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(v.dhParKg),fontSize:13}}>{fmt2(v.dhParKg)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,color:dhColor(netV),fontSize:13,background:'#faf5ff'}}>{fmt2(netV)}</td>
                                        <td style={{textAlign:'right',fontWeight:700,fontSize:13,background:'#fffbeb'}}>{fmt(v.dhParOuvJour)}</td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot><tr style={{fontWeight:700,background:'var(--gray-50)'}}>
                                <td>Total</td>
                                <td style={{textAlign:'right'}}>{fmt(cycleTotalKg)}</td>
                                <td style={{textAlign:'right'}}>{fmt(cycleTotalJours)}</td>
                                <td style={{textAlign:'right',fontSize:13}}>{cycleAvgKgJ}</td>
                                <td style={{textAlign:'right'}}>{fmt(cycleTotalCout)}</td>
                                <td style={{textAlign:'right',color:dhColor(cycleAvgDhKg),fontSize:13}}>{fmt2(cycleAvgDhKg)}</td>
                                <td style={{textAlign:'right',color:dhColor(cycleAvgDhKgNet),fontSize:13,background:'#faf5ff'}}>{fmt2(cycleAvgDhKgNet)}</td>
                                <td style={{textAlign:'right',fontSize:13}}>{fmt(cycleAvgDhJ)}</td>
                            </tr></tfoot>
                        </table>
                        </div>
                        )}
                    </Panel>

                </div>
            );
        }

        // ===================== PRIMES RECOLTE TAB =====================
        function PrimesRecolteTab({ data, farmFilter, initialPeriode }) {
            const [fermeFilter, setFermeFilter] = useState(farmFilter || '');
            const [cultureFilter, setCultureFilter] = useState('');
            const [varieteFilter, setVarieteFilter] = useState('');
            const [showPrintModal, setShowPrintModal] = useState(false);
            const [printFerme, setPrintFerme] = useState('F1');
            const [printShowNoms, setPrintShowNoms] = useState(true);
            const [rawRows, setRawRows] = useState([]);
            const [periodes, setPeriodes] = useState([]);
            const [periodeCampagne, setPeriodeCampagne] = useState({});
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const [loading, setLoading] = useState(true);
            const [selectedJourIdx, setSelectedJourIdx] = useState(null);
            const [excelCompare, setExcelCompare] = useState(null); // { workers: Map<matricule, {nom, variete, kgParJour: {day: kg}, primeParJour: {day: dh}, totalKg, totalPrime}>, jours: [16..30] }
            const [showCompare, setShowCompare] = useState(false);
            const excelFileRef = React.useRef(null);

            // Parse Excel file for comparison — reads F1+f5 sheets if available, else first sheet
            const handleExcelCompare = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (evt) => {
                    try {
                        const wb = XLSX.read(evt.target.result, { type: 'array' });
                        // Use F1 + f5 sheets if they exist, otherwise fall back to first sheet
                        const targetSheets = ['F1', 'f5', 'F5'].filter(s => wb.Sheets[s]);
                        const sheetsToRead = targetSheets.length > 0 ? targetSheets : [wb.SheetNames[0]];
                        const workers = new Map();
                        let dayNumbers = [];
                        for (const sheetName of sheetsToRead) {
                            const ws = wb.Sheets[sheetName];
                            if (!ws) continue;
                            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                            const header = rows[0];
                            // Auto-detect: find two groups of consecutive day numbers (1-31) in header
                            // First group = kilos, second group = primes
                            const dayGroups = [];
                            let curGroup = null;
                            for (let c = 0; c < header.length; c++) {
                                const d = parseInt(header[c]);
                                if (!isNaN(d) && d >= 1 && d <= 31) {
                                    if (!curGroup) curGroup = { startCol: c, days: [] };
                                    curGroup.days.push(d);
                                } else if (curGroup) {
                                    dayGroups.push(curGroup);
                                    curGroup = null;
                                }
                            }
                            if (curGroup) dayGroups.push(curGroup);
                            const kgStartCol = dayGroups.length > 0 ? dayGroups[0].startCol : 3;
                            const primeStartCol = dayGroups.length > 1 ? dayGroups[1].startCol : kgStartCol + 20;
                            const sheetDays = dayGroups.length > 0 ? dayGroups[0].days : [];
                            if (sheetDays.length > dayNumbers.length) dayNumbers = sheetDays;
                            for (let i = 1; i < rows.length; i++) {
                                const row = rows[i];
                                const mat = (row[0] || '').toString().trim().toUpperCase();
                                if (!mat || mat === '') continue;
                                // Skip total row
                                if (row[1] === '' && row[2] === '') continue;
                                const nom = row[1] || row[21] || '';
                                const variete = (row[2] || row[22] || '').toString().trim();
                                const kgParJour = {};
                                const primeParJour = {};
                                let totalKg = 0, totalPrime = 0;
                                sheetDays.forEach((day, idx) => {
                                    const kg = parseFloat(row[kgStartCol + idx]) || 0;
                                    const prime = parseFloat(row[primeStartCol + idx]) || 0;
                                    kgParJour[day] = kg;
                                    primeParJour[day] = prime;
                                    totalKg += kg;
                                    totalPrime += prime;
                                });
                                // A worker may appear multiple times (different sheets/variétés) — aggregate
                                if (workers.has(mat)) {
                                    const existing = workers.get(mat);
                                    sheetDays.forEach(day => {
                                        existing.kgParJour[day] = (existing.kgParJour[day] || 0) + (kgParJour[day] || 0);
                                        existing.primeParJour[day] = (existing.primeParJour[day] || 0) + (primeParJour[day] || 0);
                                    });
                                    existing.totalKg += totalKg;
                                    existing.totalPrime += totalPrime;
                                    if (variete && !existing.variete.includes(variete)) existing.variete += ', ' + variete;
                                } else {
                                    workers.set(mat, { nom, variete, kgParJour, primeParJour, totalKg: Math.round(totalKg * 10) / 10, totalPrime: Math.round(totalPrime * 10) / 10 });
                                }
                            }
                        }
                        setExcelCompare({ workers, jours: dayNumbers });
                        setShowCompare(true);
                    } catch (err) {
                        alert('Erreur lecture Excel: ' + err.message);
                    }
                    e.target.value = '';
                };
                reader.readAsArrayBuffer(file);
            };

            // Calculate prime from kilos
            const isMyrtille = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v || '');
            const calcPrime = (kg, variete, date) => {
                const k = kg || 0;
                if (isMyrtille(variete)) {
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
                cachedFetch('/api/pointage-rh?action=recolte-equipes').then(json => {
                    if (json.success) {
                        setRawRows(json.rows || []);
                        setPeriodes(json.periodes || []);
                        setPeriodeCampagne(json.periodeCampagne || {});
                        if (json.periodes?.length > 0) setSelectedPeriode(initialPeriode || json.periodes[0]);
                    }
                }).catch(err => console.warn(err)).finally(() => setLoading(false));
            }, []);

            // Derive equipeCode from matricule prefix
            const transportEquipes = data.transportConfig || [];
            const getEqPrefix = (mat) => {
                if (!mat) return '';
                const m = mat.toUpperCase().trim();
                const p2 = m.substring(0, 2);
                const known = transportEquipes.map(t => t.prefix);
                if (known.includes(p2)) return p2;
                if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
                if (m.startsWith('DD')) return 'NV';
                return p2;
            };

            // Filter by selected period
            const currentPeriode = selectedPeriode || (periodes[0] || '');
            const periodeRows = rawRows.filter(r => r.periode === currentPeriode);

            // Aggregate kg per worker per day (a worker may have multiple rows per day if multiple parcelles)
            const workerDayMap = {};
            periodeRows.forEach(r => {
                const key = (r.matricule || '') + '|' + (r.jour || '');
                if (!workerDayMap[key]) workerDayMap[key] = { matricule: r.matricule, nom: r.nom, jour: r.jour, kg: 0, variete: r.variete, ferme: r.ferme, culture: isMyrtille(r.variete) ? 'Myrtille' : 'Framboise' };
                workerDayMap[key].kg += (r.kg || 0);
            });
            const workerDayEntries = Object.values(workerDayMap);
            workerDayEntries.forEach(e => {
                e.kg = Math.round(e.kg * 10) / 10;
                e.prime = calcPrime(e.kg, e.variete, e.jour);
                e.equipeCode = getEqPrefix(e.matricule);
            });

            // Build joursLabels from data (sorted chronologically)
            const joursLabels = [...new Set(workerDayEntries.map(e => e.jour))].sort();
            const activeJourIdx = selectedJourIdx !== null && selectedJourIdx < joursLabels.length ? selectedJourIdx : joursLabels.length - 1;

            // Build recolteParJour structure: array of arrays indexed by day
            const recolteParJour = joursLabels.map(jour => workerDayEntries.filter(e => e.jour === jour));

            // Get data for selected day
            const jourData = recolteParJour[activeJourIdx] || [];
            // Filter chain: ferme → culture → variété
            let ouvriersFiltered = fermeFilter ? jourData.filter(o => o.ferme === fermeFilter) : jourData;
            ouvriersFiltered = cultureFilter ? ouvriersFiltered.filter(o => o.culture === cultureFilter) : ouvriersFiltered;
            const availableVarietes = [...new Set(ouvriersFiltered.map(o => o.variete).filter(Boolean))].sort();
            const ouvriersJour = varieteFilter ? ouvriersFiltered.filter(o => o.variete === varieteFilter) : ouvriersFiltered;

            // KPI calculations — exclude workers with 0 kg (pointés en récolte mais sans production)
            const ouvriersAvecKg = ouvriersJour.filter(o => o.kg > 0);
            const totalPrimesJour = ouvriersAvecKg.reduce((s, o) => s + o.prime, 0);
            const moyPrimeOuvrier = ouvriersAvecKg.length > 0 ? Math.round((totalPrimesJour / ouvriersAvecKg.length) * 10) / 10 : 0;
            const nbPrimes = ouvriersAvecKg.filter(o => o.prime > 0).length;
            const meilleurePrime = ouvriersAvecKg.length > 0 ? Math.max(...ouvriersAvecKg.map(o => o.prime)) : 0;

            // Recap quinzaine - for each worker, sum across all days (filtered by ferme/culture/variete)
            const nbJoursQuinzaine = joursLabels.length;
            const recapQuinzaine = {};
            recolteParJour.forEach((jourWorkers, dayIdx) => {
                const filtered = jourWorkers
                    .filter(w => !fermeFilter || w.ferme === fermeFilter)
                    .filter(w => !cultureFilter || w.culture === cultureFilter)
                    .filter(w => !varieteFilter || w.variete === varieteFilter);
                filtered.forEach(worker => {
                    const key = worker.matricule || worker.nom;
                    if (!recapQuinzaine[key]) {
                        recapQuinzaine[key] = {
                            matricule: worker.matricule,
                            nom: worker.nom,
                            equipeCode: worker.equipeCode,
                            ferme: worker.ferme,
                            variete: worker.variete,
                            culture: worker.culture,
                            jours: Array(nbJoursQuinzaine).fill(null),
                            primes: Array(nbJoursQuinzaine).fill(0),
                            totalKg: 0,
                            totalPrime: 0
                        };
                    }
                    recapQuinzaine[key].jours[dayIdx] = worker.kg;
                    recapQuinzaine[key].primes[dayIdx] = worker.prime;
                    recapQuinzaine[key].totalKg = Math.round((recapQuinzaine[key].totalKg + worker.kg) * 10) / 10;
                    recapQuinzaine[key].totalPrime += worker.prime;
                });
            });

            const recapList = Object.values(recapQuinzaine)
                .sort((a, b) => b.totalKg - a.totalKg);

            // Print function
            const handlePrint = () => {
                const ferme = printFerme;
                const showNoms = printShowNoms;
                const fermeLabel = ferme === 'F1' ? 'Ferme 172 (F1)' : 'Ferme 195 (F5)';

                // Build recap for this farm
                const printRecap = {};
                recolteParJour.forEach((jourWorkers, dayIdx) => {
                    jourWorkers.forEach(worker => {
                        if (worker.ferme !== ferme) return;
                        const key = worker.matricule || worker.nom;
                        if (!printRecap[key]) {
                            printRecap[key] = { matricule: worker.matricule, nom: worker.nom, equipeCode: worker.equipeCode, jours: Array(joursLabels.length).fill(null), primes: Array(joursLabels.length).fill(0), totalKg: 0, totalPrime: 0 };
                        }
                        printRecap[key].jours[dayIdx] = worker.kg;
                        printRecap[key].primes[dayIdx] = worker.prime;
                        printRecap[key].totalKg = Math.round((printRecap[key].totalKg + worker.kg) * 10) / 10;
                        printRecap[key].totalPrime += worker.prime;
                    });
                });
                const printList = Object.values(printRecap).sort((a, b) => b.totalKg - a.totalKg);

                const totalPrimesOuvriers = Math.round(printList.reduce((s, r) => s + r.totalPrime, 0));

                const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Primes Quinzaine - ${fermeLabel}</title>
<style>
@page { size: landscape; margin: 10mm; }
body { font-family: Arial, sans-serif; font-size: 10px; color: #333; margin: 0; padding: 10px; }
.header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #8B2252; padding-bottom: 8px; margin-bottom: 12px; }
.header h1 { font-size: 16px; color: #8B2252; margin: 0; }
.header .info { text-align: right; font-size: 10px; color: #666; }
.summary { display: flex; gap: 20px; margin-bottom: 12px; }
.summary-box { border: 1px solid #ddd; border-radius: 6px; padding: 8px 14px; text-align: center; }
.summary-box .val { font-size: 16px; font-weight: 700; color: #8B2252; }
.summary-box .lbl { font-size: 9px; color: #888; }
table { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 14px; }
th { background: #8B2252; color: white; padding: 4px 6px; text-align: left; font-size: 9px; }
td { padding: 3px 6px; border-bottom: 1px solid #eee; }
tr:nth-child(even) { background: #fafafa; }
.section-title { font-size: 12px; font-weight: 700; color: #8B2252; margin: 12px 0 6px; border-left: 3px solid #8B2252; padding-left: 8px; }
.prime-pos { color: #2D8B4E; font-weight: 600; }
.prime-zero { color: #ccc; }
.total-row { background: #f5f0f2 !important; font-weight: 700; }
.footer { margin-top: 10px; text-align: center; font-size: 8px; color: #aaa; border-top: 1px solid #ddd; padding-top: 6px; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
    <h1>Berry Good Farms - Primes de Récolte Quinzaine</h1>
    <div class="info"><strong>${fermeLabel}</strong><br/>Période: ${currentPeriode}<br/>Imprimé le: ${new Date().toLocaleDateString('fr-FR')}</div>
</div>
<div class="summary">
    <div class="summary-box"><div class="val">${printList.length}</div><div class="lbl">Ouvriers</div></div>
    <div class="summary-box"><div class="val">${totalPrimesOuvriers.toLocaleString('fr-FR')} DH</div><div class="lbl">Total Primes Ouvriers</div></div>
</div>
<div class="section-title">Primes Ouvriers - Détail par Jour</div>
<table>
<thead><tr><th>Matricule</th>${showNoms ? '<th>Nom</th>' : ''}<th>Équipe</th>${joursLabels.map(j => '<th style="text-align:center">' + formatJour(j) + '</th>').join('')}<th style="text-align:right">Total Kg</th><th style="text-align:right">Total Prime</th></tr></thead>
<tbody>
${printList.map(r => `<tr><td style="font-family:monospace;font-weight:600">${r.matricule}</td>${showNoms ? '<td>' + r.nom + '</td>' : ''}<td>${r.equipeCode}</td>${r.jours.map((kg, di) => '<td style="text-align:center">' + (kg !== null ? '<div>' + kg + ' kg</div><div class="' + (r.primes[di] > 0 ? 'prime-pos' : 'prime-zero') + '">' + Math.round(r.primes[di]) + ' DH</div>' : '-') + '</td>').join('')}<td style="text-align:right;font-weight:600">${Math.round(r.totalKg * 10) / 10} kg</td><td style="text-align:right;font-weight:700;color:#2D8B4E">${Math.round(r.totalPrime)} DH</td></tr>`).join('')}
<tr class="total-row"><td colspan="${showNoms ? 3 : 2}">TOTAL</td>${joursLabels.map((_, di) => { const dPrime = printList.reduce((s, r) => s + r.primes[di], 0); return '<td style="text-align:center;font-weight:700">' + Math.round(dPrime) + ' DH</td>'; }).join('')}<td style="text-align:right;font-weight:700">${Math.round(printList.reduce((s,r) => s + r.totalKg, 0))} kg</td><td style="text-align:right;font-weight:700;color:#2D8B4E">${totalPrimesOuvriers} DH</td></tr>
</tbody></table>
<div class="footer">Berry Good Farms - Document généré automatiquement - ${currentPeriode}</div>
</body></html>`;

                const printWindow = window.open('', '_blank', 'width=1200,height=800');
                printWindow.document.write(html);
                printWindow.document.close();
                setTimeout(() => printWindow.print(), 500);
                setShowPrintModal(false);
            };

            if (loading) return <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement des primes de récolte...</div></div>;

            // Format jour label for display (YYYY-MM-DD -> DD/MM)
            const formatJour = (j) => {
                if (!j) return '';
                if (j.includes('-')) { const p = j.split('-'); return p[2] + '/' + p[1]; }
                return j;
            };

            return (
                <div className="fade-in">
                    {/* Print Modal */}
                    {showPrintModal && (
                        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center'}}
                            onClick={() => setShowPrintModal(false)}>
                            <div style={{background:'white', borderRadius:16, padding:28, width:420, boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                                    <h3 style={{fontSize:16, fontWeight:700, color:'var(--berry)', margin:0}}>
                                        <i className="fa-solid fa-print" style={{marginRight:8}}></i>Imprimer Primes Quinzaine
                                    </h3>
                                    <button onClick={() => setShowPrintModal(false)} style={{background:'none', border:'none', fontSize:18, cursor:'pointer', color:'var(--gray-400)'}}>&times;</button>
                                </div>

                                <div style={{marginBottom:18}}>
                                    <label style={{fontSize:12, fontWeight:600, display:'block', marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-tractor" style={{marginRight:6}}></i>Sélectionner la ferme
                                    </label>
                                    <div style={{display:'flex', gap:8}}>
                                        <button onClick={() => setPrintFerme('F1')}
                                            style={{flex:1, padding:'12px', borderRadius:10, border: printFerme==='F1' ? '2px solid var(--berry)' : '2px solid var(--gray-200)',
                                            background: printFerme==='F1' ? 'rgba(139,34,82,0.08)' : 'white', cursor:'pointer', fontWeight:600, fontSize:13, color: printFerme==='F1' ? 'var(--berry)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-seedling" style={{marginRight:6}}></i>Ferme F1
                                        </button>
                                        <button onClick={() => setPrintFerme('F5')}
                                            style={{flex:1, padding:'12px', borderRadius:10, border: printFerme==='F5' ? '2px solid var(--blue)' : '2px solid var(--gray-200)',
                                            background: printFerme==='F5' ? 'rgba(52,152,219,0.08)' : 'white', cursor:'pointer', fontWeight:600, fontSize:13, color: printFerme==='F5' ? 'var(--blue)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-leaf" style={{marginRight:6}}></i>Ferme F5
                                        </button>
                                    </div>
                                </div>

                                <div style={{marginBottom:22}}>
                                    <label style={{fontSize:12, fontWeight:600, display:'block', marginBottom:8, color:'var(--gray-600)'}}>
                                        <i className="fa-solid fa-eye" style={{marginRight:6}}></i>Affichage des ouvriers
                                    </label>
                                    <div style={{display:'flex', gap:8}}>
                                        <button onClick={() => setPrintShowNoms(true)}
                                            style={{flex:1, padding:'10px', borderRadius:10, border: printShowNoms ? '2px solid var(--green)' : '2px solid var(--gray-200)',
                                            background: printShowNoms ? 'rgba(45,139,78,0.08)' : 'white', cursor:'pointer', fontSize:12, fontWeight:600, color: printShowNoms ? 'var(--green)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-user" style={{marginRight:6}}></i>Matricule + Nom
                                        </button>
                                        <button onClick={() => setPrintShowNoms(false)}
                                            style={{flex:1, padding:'10px', borderRadius:10, border: !printShowNoms ? '2px solid var(--orange)' : '2px solid var(--gray-200)',
                                            background: !printShowNoms ? 'rgba(230,126,34,0.08)' : 'white', cursor:'pointer', fontSize:12, fontWeight:600, color: !printShowNoms ? 'var(--orange)' : 'var(--gray-500)'}}>
                                            <i className="fa-solid fa-hashtag" style={{marginRight:6}}></i>Matricule uniquement
                                        </button>
                                    </div>
                                </div>

                                <div style={{display:'flex', gap:10}}>
                                    <button onClick={handlePrint}
                                        style={{flex:1, padding:'12px', background:'var(--berry)', color:'white', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow:'0 2px 10px rgba(139,34,82,0.3)'}}>
                                        <i className="fa-solid fa-print"></i> Imprimer
                                    </button>
                                    <button onClick={() => setShowPrintModal(false)}
                                        style={{padding:'12px 20px', background:'var(--gray-200)', color:'var(--gray-600)', border:'none', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer'}}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-database" style={{marginRight:4}}></i>Données live
                        </span>
                        <window.QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} value={selectedPeriode} onChange={v => { setSelectedPeriode(v); setSelectedJourIdx(null); setCultureFilter(''); setVarieteFilter(''); }} />
                    </div>

                    <div className="filters-bar" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        {!farmFilter && (
                        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                            <div className="chip-group">
                                <span className="chip-group-label">Ferme:</span>
                                <button className={`chip c-green ${fermeFilter === '' ? 'active' : ''}`} onClick={() => { setFermeFilter(''); setCultureFilter(''); setVarieteFilter(''); }}>Toutes</button>
                                <button className={`chip c-green ${fermeFilter === 'F1' ? 'active' : ''}`} onClick={() => { setFermeFilter('F1'); setCultureFilter(''); setVarieteFilter(''); }}>F1</button>
                                <button className={`chip c-green ${fermeFilter === 'F5' ? 'active' : ''}`} onClick={() => { setFermeFilter('F5'); setCultureFilter(''); setVarieteFilter(''); }}>F5</button>
                                <button className={`chip c-green ${fermeFilter === 'Avocatier' ? 'active' : ''}`} onClick={() => { setFermeFilter('Avocatier'); setCultureFilter(''); setVarieteFilter(''); }}>Avocatier</button>
                            </div>
                            <div className="chip-group" style={{marginLeft:8}}>
                                <span className="chip-group-label">Culture:</span>
                                <button className={`chip c-blue ${cultureFilter === '' ? 'active' : ''}`} onClick={() => { setCultureFilter(''); setVarieteFilter(''); }}>Toutes</button>
                                <button className={`chip c-blue ${cultureFilter === 'Framboise' ? 'active' : ''}`} onClick={() => { setCultureFilter('Framboise'); setVarieteFilter(''); }}>Framboise</button>
                                <button className={`chip c-blue ${cultureFilter === 'Myrtille' ? 'active' : ''}`} onClick={() => { setCultureFilter('Myrtille'); setVarieteFilter(''); }}>Myrtille</button>
                            </div>
                            {availableVarietes.length > 1 && (
                            <div style={{marginLeft:8,display:'flex',alignItems:'center',gap:6}}>
                                <span style={{fontSize:12,fontWeight:500,color:'var(--gray-600)'}}>Variété:</span>
                                <select value={varieteFilter} onChange={e => setVarieteFilter(e.target.value)} style={{padding:'5px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:11,fontWeight:600,background:'white',color:'var(--gray-700)'}}>
                                    <option value="">Toutes ({availableVarietes.length})</option>
                                    {availableVarietes.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                            </div>
                            )}
                        </div>
                        )}
                        <div style={{display:'flex',gap:8}}>
                            <input type="file" accept=".xlsx,.xls" ref={excelFileRef} onChange={handleExcelCompare} style={{display:'none'}} />
                            {showCompare && <button onClick={() => excelFileRef.current?.click()} style={{padding:'8px 18px', background:'#27ae60', color:'white', border:'none', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, boxShadow:'0 2px 8px rgba(39,174,96,0.3)'}}>
                                <i className="fa-solid fa-file-excel"></i> Recharger Excel
                            </button>}
                            <button onClick={() => showCompare ? setShowCompare(false) : excelFileRef.current?.click()} style={{padding:'8px 18px', background: showCompare ? 'var(--orange)' : '#27ae60', color:'white', border:'none', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, boxShadow: showCompare ? '0 2px 8px rgba(230,126,34,0.3)' : '0 2px 8px rgba(39,174,96,0.3)'}}>
                                <i className={showCompare ? 'fa-solid fa-times' : 'fa-solid fa-file-excel'}></i> {showCompare ? 'Fermer Comparaison' : 'Comparer Excel'}
                            </button>
                            <button onClick={() => setShowPrintModal(true)} style={{padding:'8px 18px', background:'var(--berry)', color:'white', border:'none', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, boxShadow:'0 2px 8px rgba(139,34,82,0.3)'}}>
                                <i className="fa-solid fa-print"></i> Imprimer Quinzaine
                            </button>
                        </div>
                    </div>

                    <div className="chip-group" style={{marginTop:10, marginBottom:20}}>
                        <span className="chip-group-label">Jour:</span>
                        {joursLabels.map((jour, idx) => (
                            <button key={idx} className={`chip c-berry ${activeJourIdx === idx ? 'active' : ''}`} onClick={() => setSelectedJourIdx(idx)}
                                style={{minWidth:44, fontSize:11, padding:'4px 8px'}}>
                                {formatJour(jour)}{idx === joursLabels.length - 1 ? ' ★' : ''}
                            </button>
                        ))}
                    </div>

                    <div className="kpi-grid">
                        <KPICard
                            icon="fa-coins"
                            iconClass="gold"
                            value={Math.round(totalPrimesJour).toLocaleString('fr-FR')}
                            label="Primes du Jour"
                        />
                        <KPICard
                            icon="fa-user-check"
                            iconClass="green"
                            value={Math.round(moyPrimeOuvrier).toLocaleString('fr-FR')}
                            label="Moy Prime/Ouvrier"
                        />
                        <KPICard
                            icon="fa-users"
                            iconClass="blue"
                            value={nbPrimes}
                            label="Nb Primés (>20kg)"
                        />
                        <KPICard
                            icon="fa-trophy"
                            iconClass="orange"
                            value={Math.round(meilleurePrime).toLocaleString('fr-FR')}
                            label="Meilleure Prime"
                        />
                    </div>

                    <Panel title={`Primes Ouvriers - ${formatJour(joursLabels[activeJourIdx])}`} icon="fa-ranking-star">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Matricule</th>
                                    <th>Nom</th>
                                    <th>Équipe</th>
                                    <th>Variété</th>
                                    <th>Kg Récoltés</th>
                                    <th>Prime (DH)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ouvriersJour.sort((a, b) => b.prime - a.prime).map((o, i) => (
                                    <tr key={i}>
                                        <td style={{fontSize: '12px', color: 'var(--gray-400)'}}>{o.matricule}</td>
                                        <td style={{fontWeight: 500}}>{o.nom}</td>
                                        <td>{o.equipeCode}</td>
                                        <td style={{fontSize: 11, color: 'var(--gray-500)'}}>{o.variete || '-'}</td>
                                        <td><strong>{o.kg} kg</strong></td>
                                        <td style={{color: o.prime > 0 ? 'var(--green)' : 'var(--gray-400)', fontWeight: 600}}>
                                            {Math.round(o.prime)} DH
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Panel>

                    <Panel title={`Récap Période — ${currentPeriode}`} icon="fa-calendar">
                        <div style={{overflowX: 'auto'}}>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th style={{position:'sticky', left:0, background:'var(--berry)', zIndex:1}}>Matricule</th>
                                        <th>Nom</th>
                                        <th>Éq.</th>
                                        {joursLabels.map((jour, i) => (
                                            <th key={i} style={{fontSize:10, textAlign:'center', minWidth:50}}>{formatJour(jour)}</th>
                                        ))}
                                        <th style={{textAlign:'right'}}>Total Kg</th>
                                        <th style={{textAlign:'right'}}>Total Prime</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recapList.map((r, i) => (
                                        <tr key={i}>
                                            <td style={{fontSize:10, color:'var(--gray-500)', fontFamily:'monospace', fontWeight:600, position:'sticky', left:0, background:'white', zIndex:1}}>{r.matricule}</td>
                                            <td style={{fontWeight:500, whiteSpace:'nowrap'}}><WorkerLink matricule={r.matricule} nom={r.nom} /></td>
                                            <td style={{fontSize:10}}>{r.equipeCode}</td>
                                            {r.jours.map((kg, dayIdx) => (
                                                <td key={dayIdx} style={{fontSize:11, textAlign:'center', color: kg !== null && kg > 0 ? 'var(--green)' : 'var(--gray-300)'}}>
                                                    {kg !== null && kg > 0 ? Math.round(kg * 10) / 10 : '-'}
                                                </td>
                                            ))}
                                            <td style={{fontWeight:700, textAlign:'right'}}>{r.totalKg} kg</td>
                                            <td style={{color:'var(--gold)', fontWeight:700, textAlign:'right'}}>{Math.round(r.totalPrime)} DH</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                    {/* ===== COMPARAISON EXCEL BEE ONE ===== */}
                    {showCompare && excelCompare && (() => {
                        const excelJours = excelCompare.jours; // [16, 17, ..., 30]
                        // Build Firebase data map: matricule -> { kgParJour, primeParJour, totalKg, totalPrime }
                        const fbMap = {};
                        // Determine the month/year from joursLabels (e.g. "2026-04-16")
                        const periodeMonth = joursLabels.length > 0 ? joursLabels[0].substring(0, 8) : '2026-04-'; // "YYYY-MM-"
                        const moisLabel = periodeMonth.substring(5, 7); // "04"
                        workerDayEntries.forEach(e => {
                            const mat = (e.matricule || '').toUpperCase().trim();
                            if (!mat) return;
                            const dayNum = parseInt(e.jour.split('-')[2]);
                            if (!fbMap[mat]) fbMap[mat] = { nom: e.nom, variete: e.variete, kgParJour: {}, primeParJour: {}, totalKg: 0, totalPrime: 0 };
                            fbMap[mat].kgParJour[dayNum] = (fbMap[mat].kgParJour[dayNum] || 0) + (e.kg || 0);
                            fbMap[mat].primeParJour[dayNum] = (fbMap[mat].primeParJour[dayNum] || 0) + (e.prime || 0);
                            fbMap[mat].totalKg += (e.kg || 0);
                            fbMap[mat].totalPrime += (e.prime || 0);
                        });
                        // Merge all matricules
                        const allMats = new Set([...Object.keys(fbMap), ...excelCompare.workers.keys()]);
                        let rows = [];
                        let totFb = 0, totXl = 0, nbEcarts = 0;
                        const totParJourFb = {}, totParJourXl = {};
                        excelJours.forEach(d => { totParJourFb[d] = 0; totParJourXl[d] = 0; });

                        let totPrimeFb = 0, totPrimeXl = 0;
                        allMats.forEach(mat => {
                            const fb = fbMap[mat] || { nom: '', kgParJour: {}, primeParJour: {}, totalKg: 0, totalPrime: 0, variete: '' };
                            const xl = excelCompare.workers.get(mat) || { nom: '', kgParJour: {}, primeParJour: {}, totalKg: 0, totalPrime: 0, variete: '' };
                            const source = fbMap[mat] && excelCompare.workers.has(mat) ? 'both' : (fbMap[mat] ? 'fb_only' : 'xl_only');
                            const jours = excelJours.map(d => {
                                const kgFb = Math.round((fb.kgParJour[d] || 0) * 10) / 10;
                                const kgXl = Math.round((xl.kgParJour[d] || 0) * 10) / 10;
                                // Totaux par jour : uniquement ouvriers présents dans l'Excel
                                if (source !== 'fb_only') {
                                    totParJourFb[d] += kgFb;
                                    totParJourXl[d] += kgXl;
                                }
                                return { day: d, kgFb, kgXl, diff: Math.round((kgFb - kgXl) * 10) / 10 };
                            });
                            const totalFb = Math.round(jours.reduce((s, j) => s + j.kgFb, 0) * 10) / 10;
                            const totalXl = Math.round(jours.reduce((s, j) => s + j.kgXl, 0) * 10) / 10;
                            const totalDiff = Math.round((totalFb - totalXl) * 10) / 10;
                            if (source !== 'fb_only') { totFb += totalFb; totXl += totalXl; }
                            if (Math.abs(totalDiff) > 0.5) nbEcarts++;
                            const nom = fb.nom || xl.nom || '';
                            // Primes
                            const primeFb = Math.round((fb.totalPrime || 0) * 10) / 10;
                            const primeXl = Math.round((xl.totalPrime || 0) * 10) / 10;
                            const primeDiff = Math.round((primeFb - primeXl) * 10) / 10;
                            if (source !== 'fb_only') { totPrimeFb += primeFb; totPrimeXl += primeXl; }
                            rows.push({ mat, nom, variete: xl.variete || fb.variete || '', jours, totalFb, totalXl, totalDiff, primeFb, primeXl, primeDiff, source });
                        });
                        rows.sort((a, b) => Math.abs(b.primeDiff) - Math.abs(a.primeDiff));
                        const totalDiffGlobal = Math.round((totFb - totXl) * 10) / 10;
                        const totalPrimeDiffGlobal = Math.round((totPrimeFb - totPrimeXl) * 10) / 10;
                        const nbEcartsPrime = rows.filter(r => Math.abs(r.primeDiff) > 0.5 && r.source !== 'fb_only').length;

                        return (
                            <Panel title="Comparaison Firebase vs Excel — Kilos & Primes" icon="fa-scale-balanced" style={{border:'2px solid var(--orange)', background:'rgba(230,126,34,0.03)'}}>
                                <div className="kpi-grid" style={{marginBottom:16}}>
                                    <KPICard icon="fa-database" iconClass="blue" value={Math.round(totFb).toLocaleString('fr-FR') + ' kg'} label="Total Kg SmartBerry" />
                                    <KPICard icon="fa-file-excel" iconClass="green" value={Math.round(totXl).toLocaleString('fr-FR') + ' kg'} label="Total Kg Excel" />
                                    <KPICard icon="fa-arrows-left-right" iconClass={totalDiffGlobal > 0 ? 'green' : totalDiffGlobal < 0 ? 'orange' : 'blue'} value={(totalDiffGlobal > 0 ? '+' : '') + totalDiffGlobal.toLocaleString('fr-FR') + ' kg'} label="Écart Kg" />
                                    <KPICard icon="fa-triangle-exclamation" iconClass="orange" value={nbEcarts} label="Ouvriers Écart Kg" />
                                </div>
                                <div className="kpi-grid" style={{marginBottom:16}}>
                                    <KPICard icon="fa-coins" iconClass="blue" value={Math.round(totPrimeFb).toLocaleString('fr-FR') + ' DH'} label="Prime SmartBerry" />
                                    <KPICard icon="fa-coins" iconClass="green" value={Math.round(totPrimeXl).toLocaleString('fr-FR') + ' DH'} label="Prime Excel" />
                                    <KPICard icon="fa-arrows-left-right" iconClass={totalPrimeDiffGlobal > 0 ? 'green' : totalPrimeDiffGlobal < 0 ? 'orange' : 'blue'} value={(totalPrimeDiffGlobal > 0 ? '+' : '') + totalPrimeDiffGlobal.toLocaleString('fr-FR') + ' DH'} label="Écart Prime" />
                                    <KPICard icon="fa-triangle-exclamation" iconClass={nbEcartsPrime > 0 ? 'orange' : 'green'} value={nbEcartsPrime} label="Ouvriers Écart Prime" />
                                </div>

                                {/* Résumé par jour */}
                                <div style={{overflowX:'auto', marginBottom:16}}>
                                    <table className="data-table" style={{fontSize:11}}>
                                        <thead>
                                            <tr>
                                                <th style={{background:'var(--orange)',color:'white'}}>Source</th>
                                                {excelJours.map(d => <th key={d} style={{textAlign:'center', background:'var(--orange)',color:'white', minWidth:55}}>{d}/{moisLabel}</th>)}
                                                <th style={{textAlign:'right', background:'var(--orange)',color:'white'}}>Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{fontWeight:600}}><i className="fa-solid fa-database" style={{marginRight:4,color:'var(--blue)'}}></i>Firebase</td>
                                                {excelJours.map(d => <td key={d} style={{textAlign:'center'}}>{Math.round(totParJourFb[d])}</td>)}
                                                <td style={{textAlign:'right',fontWeight:700}}>{Math.round(totFb)}</td>
                                            </tr>
                                            <tr>
                                                <td style={{fontWeight:600}}><i className="fa-solid fa-file-excel" style={{marginRight:4,color:'#27ae60'}}></i>Excel</td>
                                                {excelJours.map(d => <td key={d} style={{textAlign:'center'}}>{Math.round(totParJourXl[d])}</td>)}
                                                <td style={{textAlign:'right',fontWeight:700}}>{Math.round(totXl)}</td>
                                            </tr>
                                            <tr style={{background:'#fff3e0'}}>
                                                <td style={{fontWeight:700,color:'var(--orange)'}}><i className="fa-solid fa-arrows-left-right" style={{marginRight:4}}></i>Écart</td>
                                                {excelJours.map(d => {
                                                    const diff = Math.round((totParJourFb[d] - totParJourXl[d]) * 10) / 10;
                                                    return <td key={d} style={{textAlign:'center', fontWeight:600, color: diff > 0 ? 'var(--green)' : diff < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{diff > 0 ? '+' : ''}{diff}</td>;
                                                })}
                                                <td style={{textAlign:'right',fontWeight:700,color: totalDiffGlobal > 0 ? 'var(--green)' : totalDiffGlobal < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{totalDiffGlobal > 0 ? '+' : ''}{totalDiffGlobal}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Légende */}
                                <div style={{display:'flex', gap:16, marginBottom:12, fontSize:10, color:'var(--gray-500)'}}>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#e8f5e9',marginRight:4}}></span>Firebase &gt; Excel</span>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#ffebee',marginRight:4}}></span>Firebase &lt; Excel</span>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#e3f2fd',marginRight:4}}></span>Uniquement Firebase</span>
                                    <span><span style={{display:'inline-block',width:10,height:10,borderRadius:3,background:'#fff3e0',marginRight:4}}></span>Uniquement Excel</span>
                                </div>

                                {/* Détail par ouvrier */}
                                <div style={{overflowX:'auto', maxHeight:600, overflowY:'auto'}}>
                                    <table className="data-table" style={{fontSize:10}}>
                                        <thead>
                                            <tr>
                                                <th style={{position:'sticky',left:0,background:'var(--berry)',zIndex:2,minWidth:80}}>Matricule</th>
                                                <th style={{minWidth:120}}>Nom</th>
                                                <th>Variété</th>
                                                {excelJours.map(d => (
                                                    <th key={d} style={{textAlign:'center', minWidth:80}}>{d}/{moisLabel}</th>
                                                ))}
                                                <th style={{textAlign:'right',minWidth:55}}>Kg SB</th>
                                                <th style={{textAlign:'right',minWidth:55}}>Kg XL</th>
                                                <th style={{textAlign:'right',minWidth:55}}>Écart Kg</th>
                                                <th style={{textAlign:'right',minWidth:55,background:'#fff3e0'}}>Prime SB</th>
                                                <th style={{textAlign:'right',minWidth:55,background:'#fff3e0'}}>Prime XL</th>
                                                <th style={{textAlign:'right',minWidth:55,background:'#fff3e0'}}>Écart Prime</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((r, i) => (
                                                <tr key={i} style={{background: r.source === 'fb_only' ? '#e3f2fd' : r.source === 'xl_only' ? '#fff3e0' : undefined}}>
                                                    <td style={{fontSize:9,fontFamily:'monospace',fontWeight:600,position:'sticky',left:0,background: r.source === 'fb_only' ? '#e3f2fd' : r.source === 'xl_only' ? '#fff3e0' : 'white',zIndex:1}}>{r.mat}</td>
                                                    <td style={{fontWeight:500,whiteSpace:'nowrap',fontSize:10}}>{r.nom}</td>
                                                    <td style={{fontSize:9,color:'var(--gray-400)'}}>{r.variete}</td>
                                                    {r.jours.map((j, ji) => (
                                                        <td key={ji} style={{textAlign:'center', padding:'2px 4px'}}>
                                                            {(j.kgFb > 0 || j.kgXl > 0) ? (
                                                                <div>
                                                                    <div style={{fontSize:9,color:'var(--blue)'}}>{j.kgFb || '-'}</div>
                                                                    <div style={{fontSize:9,color:'#27ae60'}}>{j.kgXl || '-'}</div>
                                                                    {j.diff !== 0 && <div style={{fontSize:9,fontWeight:700,color: j.diff > 0 ? 'var(--green)' : '#e74c3c'}}>{j.diff > 0 ? '+' : ''}{j.diff}</div>}
                                                                </div>
                                                            ) : <span style={{color:'var(--gray-300)'}}>-</span>}
                                                        </td>
                                                    ))}
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10}}>{r.totalFb}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10,color:'#27ae60'}}>{r.totalXl}</td>
                                                    <td style={{textAlign:'right',fontWeight:700,fontSize:10,color: r.totalDiff > 0 ? 'var(--green)' : r.totalDiff < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{r.totalDiff > 0 ? '+' : ''}{r.totalDiff}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10,color:'var(--blue)',background:'#fffbf0'}}>{r.primeFb}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,fontSize:10,color:'#27ae60',background:'#fffbf0'}}>{r.primeXl}</td>
                                                    <td style={{textAlign:'right',fontWeight:700,fontSize:10,background:'#fffbf0',color: r.primeDiff > 0 ? 'var(--green)' : r.primeDiff < 0 ? '#e74c3c' : 'var(--gray-400)'}}>{r.primeDiff > 0 ? '+' : ''}{r.primeDiff}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{fontSize:10,color:'var(--gray-400)',marginTop:8,textAlign:'right'}}>
                                    {rows.length} ouvriers — {rows.filter(r=>r.source==='both').length} matchés, {rows.filter(r=>r.source==='fb_only').length} uniquement Firebase, {rows.filter(r=>r.source==='xl_only').length} uniquement Excel
                                </div>
                            </Panel>
                        );
                    })()}
                </div>
            );
        }

        // ===================== PAIE — Helpers + Composants =====================
        // Source unique du modèle paie : public/lib/paieUtils.js (window.PaieUtils).
        // On référence ici les helpers/const pour éviter toute duplication de logique.
        // Fallback minimal défensif si la lib n'a pas (encore) chargé (ne devrait pas arriver,
        // le <script> est chargé avant app.js).
        const __PaieUtils = (typeof window !== 'undefined' && window.PaieUtils) || {};
        const PAIE_BAREMES_DEFAULT = __PaieUtils.PAIE_BAREMES_DEFAULT || {
            smagBrutJournalier: 88.58,
            smagNetJournalier: 82.61,
            joursParMois: 26,
            tauxChargesPatronales: 0.1926,
            tauxCotisationsSalariales: 0.0674,
            paliers: [
                { seuilJours: 624,  pourcentage: 5,  label: '≥ 2 ans' },
                { seuilJours: 1560, pourcentage: 10, label: '≥ 5 ans' },
                { seuilJours: 3120, pourcentage: 15, label: '≥ 10 ans' },
            ],
        };
        const trouverPalierAnciennete = (anciennete, paliers) =>
            window.PaieUtils.trouverPalierAnciennete(anciennete, paliers);
        const calculerPaieOuvrier = (args) => window.PaieUtils.calculerPaieOuvrier(args);

        // Cache module-level (TTL 5 min) des lectures Firestore lourdes du tab Paie.
        // PaieTab est démonté/remonté à chaque ouverture du tab (renderTab → null
        // quand inactif), donc sans cache chaque ouverture relisait ouvriers_registry
        // (~1636 docs) + sql_mirror_pointage (plage d'historique) → >120s sur Safari.
        // Le cache ne change AUCUNE valeur : il rejoue les mêmes données, juste sans
        // re-fetch. Fallback no-op défensif si le <script> n'est pas chargé.
        const __PaieDataCache = (typeof window !== 'undefined' && window.PaieDataCache) || {
            pointageKey: (a, b) => 'pointage:' + a + '..' + b,
            getOrLoad: (_k, loader) => Promise.resolve().then(loader),
            invalidate: () => {},
        };

        // Lit sql_mirror_pointage entre minDate et maxDate (IDs YYYY-MM-DD)
        // → Map<matricule, { joursPointes:Set<dateISO>, nom }>
        async function loadPointageDistinctDays(db, minDate, maxDate) {
            const out = new Map();
            if (!minDate) return out;
            const max = maxDate || new Date().toISOString().slice(0, 10);
            const snap = await db.collection('sql_mirror_pointage')
                .where(firebase.firestore.FieldPath.documentId(), '>=', minDate)
                .where(firebase.firestore.FieldPath.documentId(), '<=', max)
                .get();
            snap.forEach(d => {
                const dateISO = d.id;
                const docData = d.data() || {};
                const rows = docData.rows || [];
                rows.forEach(r => {
                    const mat = String(r.Personnel_Matricule || '').trim();
                    if (!mat) return;
                    const nom = (r.Personnel_Nom || '').trim();
                    const entry = out.get(mat) || { joursPointes: new Set(), nom };
                    entry.joursPointes.add(dateISO);
                    if (!entry.nom && nom) entry.nom = nom;
                    out.set(mat, entry);
                });
            });
            return out;
        }

        function BaremesPaiePanel() {
            const [baremes, setBaremes] = useState(PAIE_BAREMES_DEFAULT);
            const [loaded, setLoaded] = useState(false);
            const [saving, setSaving] = useState(false);
            const [saveMsg, setSaveMsg] = useState('');
            useEffect(() => {
                firebase.firestore().collection('app_settings').doc('paie_baremes').get()
                    .then(doc => { if (doc.exists) setBaremes({ ...PAIE_BAREMES_DEFAULT, ...doc.data() }); })
                    .catch(() => {})
                    .finally(() => setLoaded(true));
            }, []);
            const setNum = (k, v) => setBaremes(b => ({ ...b, [k]: Number(v) }));
            const setPalier = (i, k, v) => setBaremes(b => {
                const arr = [...(b.paliers || [])];
                arr[i] = { ...arr[i], [k]: k === 'label' ? v : Number(v) };
                return { ...b, paliers: arr };
            });
            const addPalier = () => setBaremes(b => ({ ...b, paliers: [...(b.paliers || []), { seuilJours: 0, pourcentage: 0, label: '' }] }));
            const removePalier = (i) => setBaremes(b => ({ ...b, paliers: (b.paliers || []).filter((_, idx) => idx !== i) }));
            // SMAG daté (smagHistory) : entrées [{dateFrom:'YYYY-MM-DD', smagBrutJournalier, smagNetJournalier}]
            const setSmagHist = (i, k, v) => setBaremes(b => {
                const arr = [...(b.smagHistory || [])];
                arr[i] = { ...arr[i], [k]: k === 'dateFrom' ? v : Number(v) };
                return { ...b, smagHistory: arr };
            });
            const addSmagHist = () => setBaremes(b => ({ ...b, smagHistory: [...(b.smagHistory || []), { dateFrom: new Date().toISOString().slice(0, 10), smagBrutJournalier: b.smagBrutJournalier || 0, smagNetJournalier: b.smagNetJournalier || 0 }] }));
            const removeSmagHist = (i) => setBaremes(b => ({ ...b, smagHistory: (b.smagHistory || []).filter((_, idx) => idx !== i) }));
            const sortSmagHist = () => setBaremes(b => ({ ...b, smagHistory: [...(b.smagHistory || [])].sort((a, c) => (a.dateFrom < c.dateFrom ? -1 : a.dateFrom > c.dateFrom ? 1 : 0)) }));
            const save = async () => {
                setSaving(true); setSaveMsg('');
                try {
                    await firebase.firestore().collection('app_settings').doc('paie_baremes').set({
                        ...baremes, updatedAt: Date.now(),
                    }, { merge: true });
                    setSaveMsg('Enregistré ✓');
                    setTimeout(() => setSaveMsg(''), 2500);
                } catch (e) { setSaveMsg('Erreur: ' + e.message); }
                finally { setSaving(false); }
            };
            if (!loaded) return null;
            const inputStyle = { padding: '4px 6px', borderRadius: 6, border: '1px solid var(--gray-300)', fontSize: 11, width: 100 };
            return (
                <Panel title="Barèmes Paie (SMAG, charges, ancienneté)" icon="fa-money-bill-wave">
                    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:16}}>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>SMAG brut journalier (DH)</span>
                            <input type="number" step="0.01" value={baremes.smagBrutJournalier} onChange={e => setNum('smagBrutJournalier', e.target.value)} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>SMAG net journalier (DH)</span>
                            <input type="number" step="0.01" value={baremes.smagNetJournalier} onChange={e => setNum('smagNetJournalier', e.target.value)} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>Jours / mois</span>
                            <input type="number" step="1" value={baremes.joursParMois} onChange={e => setNum('joursParMois', e.target.value)} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>Charges patronales (%)</span>
                            <input type="number" step="0.01" value={(baremes.tauxChargesPatronales * 100).toFixed(2)}
                                onChange={e => setBaremes(b => ({...b, tauxChargesPatronales: Number(e.target.value) / 100}))} style={inputStyle} />
                        </label>
                        <label style={{fontSize:11, display:'flex', flexDirection:'column', gap:4}}>
                            <span style={{fontWeight:600, color:'var(--gray-500)'}}>Cotisations salariales (%)</span>
                            <input type="number" step="0.01" value={(baremes.tauxCotisationsSalariales * 100).toFixed(2)}
                                onChange={e => setBaremes(b => ({...b, tauxCotisationsSalariales: Number(e.target.value) / 100}))} style={inputStyle} />
                        </label>
                    </div>
                    <h4 style={{fontSize:12, fontWeight:700, marginBottom:8, color:'var(--berry)'}}>Paliers prime d'ancienneté</h4>
                    <table className="data-table" style={{fontSize:11, marginBottom:12}}>
                        <thead><tr>
                            <th>Label</th>
                            <th style={{textAlign:'right'}}>Seuil (jours travaillés)</th>
                            <th style={{textAlign:'right'}}>Prime (%)</th>
                            <th style={{width:40}}></th>
                        </tr></thead>
                        <tbody>
                            {(baremes.paliers || []).map((p, i) => (
                                <tr key={i}>
                                    <td><input value={p.label || ''} onChange={e => setPalier(i, 'label', e.target.value)} style={{...inputStyle, width:'90%'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" value={p.seuilJours} onChange={e => setPalier(i, 'seuilJours', e.target.value)} style={{...inputStyle, textAlign:'right'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" step="0.5" value={p.pourcentage} onChange={e => setPalier(i, 'pourcentage', e.target.value)} style={{...inputStyle, textAlign:'right', width:70}} /></td>
                                    <td><button onClick={() => removePalier(i)} style={{background:'transparent', border:'none', color:'var(--red)', cursor:'pointer'}} title="Supprimer"><i className="fa-solid fa-trash"></i></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <h4 style={{fontSize:12, fontWeight:700, marginTop:16, marginBottom:4, color:'var(--berry)'}}>SMAG daté (historique)</h4>
                    <div style={{fontSize:10, color:'var(--gray-400)', marginBottom:8}}>
                        Le SMAG applicable à une date est l'entrée datée la plus récente ≤ cette date. En l'absence d'entrée applicable, les champs plats ci-dessus servent de défaut.
                    </div>
                    <table className="data-table" style={{fontSize:11, marginBottom:12}}>
                        <thead><tr>
                            <th>Applicable à partir du</th>
                            <th style={{textAlign:'right'}}>SMAG brut/j (DH)</th>
                            <th style={{textAlign:'right'}}>SMAG net/j (DH)</th>
                            <th style={{width:40}}></th>
                        </tr></thead>
                        <tbody>
                            {(baremes.smagHistory || []).map((h, i) => (
                                <tr key={i}>
                                    <td><input type="date" value={h.dateFrom || ''} onChange={e => setSmagHist(i, 'dateFrom', e.target.value)} style={{...inputStyle, width:'90%'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" step="0.01" value={h.smagBrutJournalier} onChange={e => setSmagHist(i, 'smagBrutJournalier', e.target.value)} style={{...inputStyle, textAlign:'right'}} /></td>
                                    <td style={{textAlign:'right'}}><input type="number" step="0.01" value={h.smagNetJournalier} onChange={e => setSmagHist(i, 'smagNetJournalier', e.target.value)} style={{...inputStyle, textAlign:'right'}} /></td>
                                    <td><button onClick={() => removeSmagHist(i)} style={{background:'transparent', border:'none', color:'var(--red)', cursor:'pointer'}} title="Supprimer"><i className="fa-solid fa-trash"></i></button></td>
                                </tr>
                            ))}
                            {(!baremes.smagHistory || baremes.smagHistory.length === 0) && (
                                <tr><td colSpan={4} style={{color:'var(--gray-400)', fontStyle:'italic', padding:'8px 4px'}}>Aucune entrée datée — le SMAG plat ci-dessus s'applique partout.</td></tr>
                            )}
                        </tbody>
                    </table>
                    <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:12}}>
                        <button onClick={addSmagHist} style={{padding:'6px 12px', background:'var(--gray-100)', color:'var(--gray-500)', border:'1px solid var(--gray-300)', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i> Ajouter une période SMAG
                        </button>
                        <button onClick={sortSmagHist} style={{padding:'6px 12px', background:'var(--gray-100)', color:'var(--gray-500)', border:'1px solid var(--gray-300)', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                            <i className="fa-solid fa-arrow-down-1-9" style={{marginRight:4}}></i> Trier par date
                        </button>
                    </div>

                    <div style={{display:'flex', gap:8, alignItems:'center'}}>
                        <button onClick={addPalier} style={{padding:'6px 12px', background:'var(--gray-100)', color:'var(--gray-500)', border:'1px solid var(--gray-300)', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i> Ajouter un palier
                        </button>
                        <button onClick={save} disabled={saving} style={{padding:'6px 16px', background:'var(--berry)', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor: saving ? 'wait' : 'pointer'}}>
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        {saveMsg && <span style={{fontSize:11, color: saveMsg.startsWith('Erreur') ? 'var(--red)' : 'var(--green)', fontWeight:600}}>{saveMsg}</span>}
                    </div>
                </Panel>
            );
        }

        function PaieTab({ data, currentProfile }) {
            const [registry, setRegistry] = useState({});
            const [pointageMap, setPointageMap] = useState(new Map());
            const [baremes, setBaremes] = useState(PAIE_BAREMES_DEFAULT);
            const [meta, setMeta] = useState(null);
            const [loading, setLoading] = useState(true);
            const [filter, setFilter] = useState('all');
            const [search, setSearch] = useState('');
            const [periodStart, setPeriodStart] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
            const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
            const [defaultBaselineDate, setDefaultBaselineDate] = useState(() => new Date().toISOString().slice(0, 10));
            const declareFileRef = React.useRef(null);
            const baselineFileRef = React.useRef(null);
            const [registryError, setRegistryError] = useState(false);
            const [reloadRegistryTick, setReloadRegistryTick] = useState(0);
            const [syncingIdentite, setSyncingIdentite] = useState(false);

            // Live subscription on barèmes
            useEffect(() => {
                const unsub = firebase.firestore().collection('app_settings').doc('paie_baremes')
                    .onSnapshot(doc => { if (doc.exists) setBaremes({ ...PAIE_BAREMES_DEFAULT, ...doc.data() }); });
                return () => unsub && unsub();
            }, []);

            // Initial load — registre + meta + pointage, servis depuis le cache
            // module-level (TTL 5 min) quand ils sont frais. Mêmes données, juste
            // sans re-fetch Firestore à chaque ré-ouverture du tab.
            useEffect(() => {
                const db = firebase.firestore();
                let cancelled = false;
                (async () => {
                    try {
                        setRegistryError(false);
                        const [reg, metaData] = await Promise.all([
                            // Lecture GATÉE : le registre ouvrier (nominatif, sensible) passe
                            // par la CF /api/registry — plus de lecture Firestore directe.
                            // PaieTab est rhOnly → scope 'all' (RH/DG/Finance) : le serveur
                            // renvoie le registre COMPLET tous champs, from/to ignorés (donc
                            // non passés ici, contrairement aux écrans chef-visibles).
                            __PaieDataCache.getOrLoad('paie:registry', async () => {
                                const resp = await fetch('/api/registry?action=get-registry').then(r => r.json());
                                if (!resp || !resp.success) {
                                    throw new Error((resp && resp.error) || 'Échec du chargement du registre');
                                }
                                // Reconstruit la MAP à forme STRICTEMENT IDENTIQUE à l'ancienne
                                // (clé numérique canonique → objet ouvrier avec matricule).
                                const numKey = (m) => String(m || '').toUpperCase().replace(/[^0-9]/g, '');
                                const out = {};
                                (resp.ouvriers || []).forEach(o => { out[numKey(o.matricule)] = o; });
                                return out;
                            }),
                            __PaieDataCache.getOrLoad('paie:import_meta', async () => {
                                const metaDoc = await db.collection('app_settings').doc('paie_import_meta').get();
                                return metaDoc.exists ? metaDoc.data() : null;
                            }),
                        ]);
                        if (cancelled) return;
                        setRegistry(reg);
                        if (metaData) setMeta(metaData);
                        const minBase = Object.values(reg).map(r => r.baselineDate).filter(Boolean).sort()[0];
                        const minDate = (minBase && minBase < periodStart) ? minBase : periodStart;
                        const map = await __PaieDataCache.getOrLoad(
                            __PaieDataCache.pointageKey(minDate, periodEnd),
                            () => loadPointageDistinctDays(db, minDate, periodEnd)
                        );
                        if (cancelled) return;
                        setPointageMap(map);
                    } catch (e) { console.error('Paie load:', e); if (!cancelled) setRegistryError(true); }
                    finally { if (!cancelled) setLoading(false); }
                })();
                return () => { cancelled = true; };
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [reloadRegistryTick]);

            // Reload pointage when period bounds change — même cache (clé = plage).
            useEffect(() => {
                if (loading) return;
                const db = firebase.firestore();
                const minBase = Object.values(registry).map(r => r.baselineDate).filter(Boolean).sort()[0];
                const minDate = (minBase && minBase < periodStart) ? minBase : periodStart;
                __PaieDataCache.getOrLoad(
                    __PaieDataCache.pointageKey(minDate, periodEnd),
                    () => loadPointageDistinctDays(db, minDate, periodEnd)
                ).then(setPointageMap).catch(e => console.error('reload pointage:', e));
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [periodStart, periodEnd]);

            const rows = useMemo(() => {
                // ouvriers_registry est keyé NUMÉRIQUE (doc.id) alors que le pointage
                // (pointageMap) est keyé par matricule À LETTRES (ex. "MMG10764").
                // numKey extrait la partie numérique → clé canonique commune. On
                // dédoublonne la liste sur cette clé : un même ouvrier présent dans les
                // deux keyspaces (registre numérique + pointage à lettres) ne doit
                // apparaître qu'une seule fois. On garde le matricule de POINTAGE pour
                // l'affichage quand il existe (lisible), sinon la clé numérique.
                const numKey = (m) => String(m || '').toUpperCase().replace(/[^0-9]/g, '');
                // canon → { registryKey, displayMat, pt }
                const byCanon = new Map();
                const ensure = (canon) => {
                    let e = byCanon.get(canon);
                    if (!e) { e = { registryKey: null, displayMat: null, pt: null }; byCanon.set(canon, e); }
                    return e;
                };
                // Registre : clés numériques.
                Object.keys(registry).forEach(k => {
                    const canon = numKey(k);
                    if (!canon) return;
                    const e = ensure(canon);
                    e.registryKey = k;
                    if (!e.displayMat) e.displayMat = k;
                });
                // Pointage : matricules à lettres → on privilégie ce matricule pour l'affichage.
                pointageMap.forEach((pt, mat) => {
                    const canon = numKey(mat);
                    if (!canon) return;
                    const e = ensure(canon);
                    e.pt = pt;
                    e.displayMat = mat; // matricule pointage lisible prioritaire
                    if (e.registryKey == null && registry[canon]) e.registryKey = canon;
                });
                // Jours fériés de la config primes (mêmes données que la popup ouvrier).
                // Set des dates fériées ISO pour compter, par ouvrier, les jours pointés
                // tombant un férié SUR LA PÉRIODE.
                const feriesSet = new Set(
                    (((data && data.primesConfig && data.primesConfig.joursFeries) || [])
                        .map(jf => jf && jf.date)
                        .filter(Boolean))
                );
                // SMAG daté résolu à la fin de période (borne la plus représentative de la
                // quinzaine). Cohérent avec computeWorkerPaie qui résout le SMAG par date.
                const smag = (window.PaieUtils && window.PaieUtils.resolveSmagForDate)
                    ? window.PaieUtils.resolveSmagForDate(baremes, periodEnd)
                    : { smagBrutJournalier: baremes.smagBrutJournalier || 0, smagNetJournalier: baremes.smagNetJournalier || 0 };
                // Fallback gracieux si window.PaieUtils.computePayslip absent : on retombe
                // sur l'ancien modèle simplifié (net = brut, sans retenue) plutôt qu'un crash.
                const computePaie = (args) => {
                    if (window.PaieUtils && window.PaieUtils.computePayslip) {
                        const p = window.PaieUtils.computePayslip(args);
                        return {
                            brut: p.brut, net: p.net, netArrondi: p.netArrondi,
                            cnss: p.cnss, amo: p.amo, retenues: (p.cnss || 0) + (p.amo || 0),
                            prime: p.anciennete, primeFonction: p.primeFonction,
                            chargesPatronales: p.chargesPatronales, coutEmployeur: p.coutEmployeur,
                            palier: args.__palier, pourcentage: args.__pourcentage,
                        };
                    }
                    const legacy = calculerPaieOuvrier({ declare: args.declare, joursTravailles: args.jT,
                        anciennete: args.__anciennete, baremes: args.baremes, primeFonctionJour: args.primeFonctionJour });
                    return {
                        brut: legacy.brut, net: legacy.net, netArrondi: Math.round(legacy.net || 0),
                        cnss: 0, amo: 0, retenues: 0,
                        prime: legacy.prime, primeFonction: 0,
                        chargesPatronales: legacy.chargesPatronales, coutEmployeur: legacy.coutEmployeur,
                        palier: legacy.palier, pourcentage: legacy.pourcentage,
                    };
                };
                const list = [];
                byCanon.forEach((e, canon) => {
                    // Lookup registre normalisé : la clé registre est numérique (canon).
                    const r = registry[e.registryKey != null ? e.registryKey : canon] || {};
                    const pt = e.pt || { joursPointes: new Set(), nom: '' };
                    const matricule = e.displayMat || canon;
                    const baselineDate = r.baselineDate || '';
                    const baselineJours = Number(r.baselineJours || 0);
                    let joursDepuisBaseline = 0;
                    let joursPeriode = 0;
                    let joursFeriesPeriode = 0;
                    pt.joursPointes.forEach(dISO => {
                        if (!baselineDate || dISO >= baselineDate) joursDepuisBaseline++;
                        if (dISO >= periodStart && dISO <= periodEnd) {
                            joursPeriode++;
                            if (feriesSet.has(dISO)) joursFeriesPeriode++;
                        }
                    });
                    const anciennete = baselineJours + joursDepuisBaseline;
                    const declare = !!r.declare;
                    // Taux d'ancienneté (palier %) résolu pour le nouveau modèle computePayslip,
                    // qui attend ancienneteTaux (fraction), pas le nombre de jours.
                    const __pal = (window.PaieUtils && window.PaieUtils.trouverPalierAnciennete)
                        ? window.PaieUtils.trouverPalierAnciennete(anciennete, baremes.paliers || [])
                        : { palier: '—', pourcentage: 0 };
                    const ancienneteTaux = declare ? ((__pal.pourcentage || 0) / 100) : 0;
                    const primeFonctionJour = Number(r.primeFonctionJournaliere || 0);
                    // jF = jours fériés pointés (déclarés uniquement) — le férié majore la base
                    // SMAG et l'ancienneté dans computePayslip. Les jT excluent ces jours fériés
                    // (jours ordinaires) pour ne pas les compter deux fois.
                    const jF = declare ? joursFeriesPeriode : 0;
                    const jT = joursPeriode - jF;
                    const paie = computePaie({
                        declare,
                        smagBrut: smag.smagBrutJournalier,
                        smagNet: smag.smagNetJournalier,
                        jT, jF, ancienneteTaux, primeFonctionJour,
                        baremes,
                        __anciennete: anciennete,
                        __palier: declare ? __pal.palier : '—',
                        __pourcentage: declare ? (__pal.pourcentage || 0) : 0,
                    });
                    list.push({ matricule, nom: r.nom || pt.nom || '', prenom: r.prenom || '', declare,
                        primeFonctionJournaliere: primeFonctionJour,
                        baselineJours, baselineDate, joursDepuisBaseline, anciennete,
                        joursPeriode, joursFeriesPeriode, paie });
                });
                list.sort((a, b) => (b.paie.coutEmployeur || 0) - (a.paie.coutEmployeur || 0));
                return list;
            }, [registry, pointageMap, baremes, periodStart, periodEnd, data]);

            const filteredRows = useMemo(() => {
                const q = search.trim().toLowerCase();
                return rows.filter(r => {
                    if (filter === 'declared' && !r.declare) return false;
                    if (filter === 'undeclared' && r.declare) return false;
                    if (q && !((r.nom || '').toLowerCase().includes(q) || r.matricule.toLowerCase().includes(q))) return false;
                    return true;
                });
            }, [rows, filter, search]);

            const totals = useMemo(() => filteredRows.reduce((acc, r) => {
                acc.net += r.paie.net || 0;
                acc.netArrondi += r.paie.netArrondi || 0;
                acc.brut += r.paie.brut || 0;
                acc.prime += r.paie.prime || 0;
                acc.retenues += r.paie.retenues || 0;
                acc.charges += r.paie.chargesPatronales || 0;
                acc.cout += r.paie.coutEmployeur || 0;
                return acc;
            }, { net: 0, netArrondi: 0, brut: 0, prime: 0, retenues: 0, charges: 0, cout: 0 }), [filteredRows]);

            // ouvriers_registry est keyé NUMÉRIQUE (doc.id) alors que les matricules de
            // pointage sont À LETTRES. numKey extrait la clé numérique canonique : on
            // l'utilise pour TOUTES les écritures registre (doc id) afin de ne pas créer
            // de doc parasite à lettres en doublon. Idempotent sur une clé déjà numérique.
            const numKey = (m) => String(m || '').toUpperCase().replace(/[^0-9]/g, '');

            // SÉCURITÉ PAIE : toutes les écritures vers ouvriers_registry passent
            // EXCLUSIVEMENT par la Cloud Function gated /api/primes (rôle RH/DG
            // vérifié côté serveur). Aucune écriture Firestore directe côté client.
            const callPrimesCF = async (action, body) => {
                const token = (firebaseAuth && firebaseAuth.currentUser) ? await firebaseAuth.currentUser.getIdToken() : null;
                const resp = await fetch('/api/primes?action=' + action, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
                    body: JSON.stringify(body || {}),
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || !data.success) {
                    throw new Error(data.error || ('Erreur ' + resp.status));
                }
                return data;
            };

            const toggleDeclare = async (matricule, nextVal) => {
                const docId = numKey(matricule);
                const prev = registry[docId] || { matricule: docId };
                setRegistry(prevReg => ({ ...prevReg, [docId]: { ...prev, declare: nextVal, declareSource: 'manual' } }));
                try {
                    // Écriture via Cloud Function gated (RH/DG), jamais Firestore direct.
                    await callPrimesCF('set-declare', {
                        matricule: docId, declare: nextVal, declareSource: 'manual',
                        nom: prev.nom || pointageMap.get(matricule)?.nom || '',
                    });
                    // Cache devenu obsolète → la prochaine ouverture relira le registre.
                    __PaieDataCache.invalidate('paie:registry');
                } catch (e) {
                    console.error('toggleDeclare:', e);
                    setRegistry(prevReg => ({ ...prevReg, [docId]: prev }));
                    alert('Erreur enregistrement: ' + e.message);
                }
            };

            // Prime de fonction (DH/jour) par ouvrier — persistée dans ouvriers_registry
            // sous le champ primeFonctionJournaliere (relu par le calcul de paie).
            const savePrimeFonction = async (matricule, val) => {
                const docId = numKey(matricule);
                const prev = registry[docId] || { matricule: docId };
                const num = Number(val) || 0;
                setRegistry(prevReg => ({ ...prevReg, [docId]: { ...prev, primeFonctionJournaliere: num } }));
                try {
                    // Écriture via Cloud Function gated (RH/DG) : audit + historisation serveur.
                    await callPrimesCF('save-prime', {
                        matricule: docId, montant: num,
                        effectiveFrom: new Date().toISOString().slice(0, 10),
                        nom: prev.nom || pointageMap.get(matricule)?.nom || '',
                    });
                    __PaieDataCache.invalidate('paie:registry');
                } catch (e) {
                    console.error('savePrimeFonction:', e);
                    setRegistry(prevReg => ({ ...prevReg, [docId]: prev }));
                    alert('Erreur enregistrement: ' + e.message);
                }
            };

            // Correction manuelle du prénom (ouvriers non déclarés sans CNSS, donc absents
            // du référentiel BDP Personnel — aucun backfill automatique possible).
            // Refs non contrôlées (comme les inputs de prime) : le bouton "Enregistrer"
            // lit la valeur courante au clic, jamais de re-render à chaque frappe.
            const prenomRefs = React.useRef({});
            const saveIdentite = async (matricule) => {
                const docId = numKey(matricule);
                const prev = registry[docId] || { matricule: docId };
                const inputEl = prenomRefs.current[docId];
                const prenom = ((inputEl && inputEl.value) || '').trim();
                if (!prenom) { alert('Prénom vide.'); return; }
                const prevPrenom = prev.prenom || '';
                setRegistry(prevReg => ({ ...prevReg, [docId]: { ...prev, prenom } }));
                try {
                    // Écriture via Cloud Function gated (RH/DG), jamais Firestore direct.
                    await callPrimesCF('update-identite', { matricule: docId, prenom });
                    __PaieDataCache.invalidate('paie:registry');
                } catch (e) {
                    console.error('saveIdentite:', e);
                    setRegistry(prevReg => ({ ...prevReg, [docId]: { ...prev, prenom: prevPrenom } }));
                    alert('Erreur enregistrement: ' + e.message);
                }
            };

            // Backfill AUTO des prénoms/noms manquants depuis BEE ONE (rh|dg).
            // Complète saveIdentite (saisie manuelle) : ne modifie que les
            // ouvriers dont le prenom Firestore est vide ET résolu côté BEE ONE.
            // Le champ manuel reste le filet de sécurité pour les notFoundInBdp.
            const handleSyncIdentiteBdp = async () => {
                if (syncingIdentite) return;
                setSyncingIdentite(true);
                try {
                    const res = await callPrimesCF('sync-identite-bdp', {});
                    const nbUpdated = res.updated || 0;
                    const nbNotFound = (res.notFoundInBdp || []).length;
                    alert(`Synchronisation prénoms BEE ONE terminée : ${nbUpdated} prénom(s) mis à jour, ${nbNotFound} non trouvé(s) dans BEE ONE (à saisir manuellement).`);
                    __PaieDataCache.invalidate('paie:registry');
                    setLoading(true);
                    setReloadRegistryTick(t => t + 1);
                } catch (e) {
                    console.error('handleSyncIdentiteBdp:', e);
                    alert('Erreur synchronisation : ' + e.message);
                } finally {
                    setSyncingIdentite(false);
                }
            };

            const parseDateCell = (raw, fallback) => {
                if (raw == null || raw === '') return fallback;
                if (typeof raw === 'number') {
                    const dt = new Date((raw - 25569) * 86400 * 1000);
                    return dt.toISOString().slice(0, 10);
                }
                const s = String(raw).trim();
                const dm = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                if (dm) return `${dm[3]}-${dm[2]}-${dm[1]}`;
                if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
                return fallback;
            };

            const handleImportDeclares = (file) => {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const wb = XLSX.read(ev.target.result, { type: 'binary' });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const xlsxRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        const db = firebase.firestore();
                        const newRegistry = { ...registry };
                        // Construit les rows à envoyer à la Cloud Function gated (RH/DG).
                        const rows = [];
                        for (const row of xlsxRows) {
                            const mat = String(row['Matricule'] || row['matricule'] || row['MATRICULE'] || '').trim();
                            if (!mat) continue;
                            const nom = String(row['Nom'] || row['NOM'] || row['nom'] || '').trim();
                            // Doc id NUMÉRIQUE (collection keyée numérique) : évite un doc à lettres en doublon.
                            const docId = numKey(mat);
                            rows.push({ matricule: mat, nom });
                            const payload = { matricule: docId, declare: true, declareSource: 'import', updatedAt: Date.now() };
                            if (nom) payload.nom = nom;
                            newRegistry[docId] = { ...(newRegistry[docId] || {}), ...payload };
                        }
                        // Écriture registre via Cloud Function uniquement.
                        const res = await callPrimesCF('import-declares', { rows });
                        const ok = res.imported || 0;
                        const metaPayload = { lastDeclaresImportAt: Date.now(), lastDeclaresImportCount: ok, lastDeclaresImportFile: file.name };
                        await db.collection('app_settings').doc('paie_import_meta').set(metaPayload, { merge: true });
                        __PaieDataCache.invalidate('paie:registry');
                        __PaieDataCache.invalidate('paie:import_meta');
                        setRegistry(newRegistry);
                        setMeta(prev => ({ ...(prev || {}), ...metaPayload }));
                        alert(`Import OK : ${ok} ouvrier(s) marqué(s) déclaré(s).`);
                    } catch (e) {
                        console.error('Import déclarés:', e);
                        alert('Erreur import : ' + e.message);
                    }
                };
                reader.readAsBinaryString(file);
            };

            const handleImportBaseline = (file) => {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const wb = XLSX.read(ev.target.result, { type: 'binary' });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const xlsxRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        const db = firebase.firestore();
                        const newRegistry = { ...registry };
                        // Construit les rows à envoyer à la Cloud Function gated (RH/DG).
                        const rows = [];
                        for (const row of xlsxRows) {
                            const mat = String(row['Matricule'] || row['matricule'] || '').trim();
                            if (!mat) continue;
                            const jours = Number(row['JoursTravailles'] || row['Jours'] || row['joursTravailles'] || row['jours'] || 0);
                            const cutoff = parseDateCell(row['DateCoupure'] || row['dateCoupure'] || row['Date'] || '', defaultBaselineDate);
                            const nom = String(row['Nom'] || row['nom'] || '').trim();
                            // Doc id NUMÉRIQUE (collection keyée numérique) : évite un doc à lettres en doublon.
                            const docId = numKey(mat);
                            rows.push({ matricule: mat, baselineJours: jours, baselineDate: cutoff, nom });
                            const payload = { matricule: docId, baselineJours: jours, baselineDate: cutoff, updatedAt: Date.now() };
                            if (nom) payload.nom = nom;
                            newRegistry[docId] = { ...(newRegistry[docId] || {}), ...payload };
                        }
                        // Écriture registre via Cloud Function uniquement.
                        const res = await callPrimesCF('import-baseline', { rows });
                        const ok = res.imported || 0;
                        const metaPayload = { lastBaselineImportAt: Date.now(), lastBaselineImportCount: ok, lastBaselineImportFile: file.name };
                        await db.collection('app_settings').doc('paie_import_meta').set(metaPayload, { merge: true });
                        // Baseline touche les bornes d'ancienneté → invalider aussi le pointage en cache.
                        __PaieDataCache.invalidate('paie:registry');
                        __PaieDataCache.invalidate('paie:import_meta');
                        __PaieDataCache.invalidate('pointage:');
                        setRegistry(newRegistry);
                        setMeta(prev => ({ ...(prev || {}), ...metaPayload }));
                        alert(`Import baseline OK : ${ok} ligne(s).`);
                    } catch (e) {
                        console.error('Import baseline:', e);
                        alert('Erreur import : ' + e.message);
                    }
                };
                reader.readAsBinaryString(file);
            };

            const fmt = (n) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const fmtInt = (n) => (n || 0).toLocaleString('fr-FR');

            return (
                <div className="fade-in">
                    {registryError && (
                        <div style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', marginBottom:12, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, color:'#b91c1c', fontSize:12}}>
                            <i className="fa-solid fa-triangle-exclamation"></i>
                            <span style={{flex:1}}>Échec du chargement du registre — le tableau peut être incomplet.</span>
                            <button onClick={() => { setLoading(true); setReloadRegistryTick(t => t + 1); }} style={{padding:'4px 10px', background:'#b91c1c', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                Réessayer
                            </button>
                        </div>
                    )}
                    <Panel title="Paie — Ouvriers, ancienneté, prime" icon="fa-money-bill-wave"
                        actions={
                            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                                <input type="file" accept=".xlsx,.xls,.csv" ref={declareFileRef} style={{display:'none'}}
                                    onChange={e => { handleImportDeclares(e.target.files?.[0]); if (e.target) e.target.value = ''; }} />
                                <input type="file" accept=".xlsx,.xls,.csv" ref={baselineFileRef} style={{display:'none'}}
                                    onChange={e => { handleImportBaseline(e.target.files?.[0]); if (e.target) e.target.value = ''; }} />
                                <button onClick={() => declareFileRef.current?.click()} style={{padding:'6px 12px', background:'var(--berry)', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                    <i className="fa-solid fa-file-import" style={{marginRight:4}}></i> Importer liste déclarés
                                </button>
                                <button onClick={() => baselineFileRef.current?.click()} style={{padding:'6px 12px', background:'var(--orange)', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                    <i className="fa-solid fa-file-import" style={{marginRight:4}}></i> Importer baseline ancienneté
                                </button>
                                {(currentProfile === 'dg' || currentProfile === 'rh') && (
                                    <button onClick={handleSyncIdentiteBdp} disabled={syncingIdentite}
                                        style={{padding:'6px 12px', background:syncingIdentite ? '#ccc' : '#1565C0', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor:syncingIdentite ? 'wait' : 'pointer'}}>
                                        {syncingIdentite ? '⏳ Synchro en cours…' : '🔄 Synchroniser prénoms (BEE ONE)'}
                                    </button>
                                )}
                            </div>
                        }
                    >
                        <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end', marginBottom:12, fontSize:11}}>
                            <label style={{display:'flex', flexDirection:'column', gap:4}}>
                                <span style={{color:'var(--gray-500)', fontWeight:600}}>Période — début</span>
                                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={{padding:'4px 6px', borderRadius:6, border:'1px solid var(--gray-300)'}} />
                            </label>
                            <label style={{display:'flex', flexDirection:'column', gap:4}}>
                                <span style={{color:'var(--gray-500)', fontWeight:600}}>Période — fin</span>
                                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={{padding:'4px 6px', borderRadius:6, border:'1px solid var(--gray-300)'}} />
                            </label>
                            <label style={{display:'flex', flexDirection:'column', gap:4}}>
                                <span style={{color:'var(--gray-500)', fontWeight:600}}>Date coupure par défaut</span>
                                <input type="date" value={defaultBaselineDate} onChange={e => setDefaultBaselineDate(e.target.value)} style={{padding:'4px 6px', borderRadius:6, border:'1px solid var(--gray-300)'}} />
                            </label>
                            <label style={{display:'flex', flexDirection:'column', gap:4}}>
                                <span style={{color:'var(--gray-500)', fontWeight:600}}>Filtre</span>
                                <select value={filter} onChange={e => setFilter(e.target.value)} style={{padding:'4px 6px', borderRadius:6, border:'1px solid var(--gray-300)'}}>
                                    <option value="all">Tous</option>
                                    <option value="declared">Déclarés</option>
                                    <option value="undeclared">Non déclarés</option>
                                </select>
                            </label>
                            <label style={{display:'flex', flexDirection:'column', gap:4, flex:1, minWidth:160}}>
                                <span style={{color:'var(--gray-500)', fontWeight:600}}>Recherche</span>
                                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Matricule, nom ou opération…" style={{padding:'4px 6px', borderRadius:6, border:'1px solid var(--gray-300)'}} />
                            </label>
                        </div>

                        {meta && (
                            <div style={{fontSize:10, color:'var(--gray-400)', marginBottom:10}}>
                                {meta.lastDeclaresImportAt && <span style={{marginRight:14}}><i className="fa-solid fa-clock"></i> Déclarés : {new Date(meta.lastDeclaresImportAt).toLocaleString('fr-FR')} — {meta.lastDeclaresImportCount} ligne(s){meta.lastDeclaresImportFile ? ` (${meta.lastDeclaresImportFile})` : ''}</span>}
                                {meta.lastBaselineImportAt && <span><i className="fa-solid fa-clock"></i> Baseline : {new Date(meta.lastBaselineImportAt).toLocaleString('fr-FR')} — {meta.lastBaselineImportCount} ligne(s){meta.lastBaselineImportFile ? ` (${meta.lastBaselineImportFile})` : ''}</span>}
                            </div>
                        )}

                        {loading ? (
                            <div style={{padding:20, textAlign:'center', color:'var(--gray-400)'}}>Chargement…</div>
                        ) : (
                            <div style={{overflowX:'auto'}}>
                                <table className="data-table" style={{fontSize:10, whiteSpace:'nowrap'}}>
                                    <thead>
                                        <tr>
                                            <th>Matricule</th>
                                            <th>Nom</th>
                                            <th>Prénom</th>
                                            <th style={{textAlign:'center'}}>Déclaré</th>
                                            <th style={{textAlign:'right'}}>Prime fct (DH/j)</th>
                                            <th style={{textAlign:'right'}}>Baseline (j)</th>
                                            <th style={{textAlign:'center'}}>Date coupure</th>
                                            <th style={{textAlign:'right'}}>Depuis (j)</th>
                                            <th style={{textAlign:'right'}}>Ancienneté (j)</th>
                                            <th>Palier</th>
                                            <th style={{textAlign:'right'}}>Jours période</th>
                                            <th style={{textAlign:'right'}}>Brut</th>
                                            <th style={{textAlign:'right'}}>Prime anc.</th>
                                            <th style={{textAlign:'right'}}>Retenues (CNSS+AMO)</th>
                                            <th style={{textAlign:'right', background:'rgba(46,204,113,0.08)'}}>Net à payer</th>
                                            <th style={{textAlign:'right'}}>Charges patr.</th>
                                            <th style={{textAlign:'right', background:'rgba(139,34,82,0.08)'}}>Coût employeur</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredRows.map(r => (
                                            <tr key={r.matricule}>
                                                <td style={{fontWeight:600, color:'var(--gray-500)'}}>{r.matricule}</td>
                                                <td>{r.nom || <span style={{color:'var(--gray-300)'}}>—</span>}</td>
                                                <td>
                                                    <div style={{display:'flex', gap:4, alignItems:'center'}}>
                                                        <input type="text" defaultValue={r.prenom} placeholder="Prénom"
                                                            ref={el => { prenomRefs.current[numKey(r.matricule)] = el; }}
                                                            style={{width:80, padding:'2px 4px', borderRadius:4, border:'1px solid var(--gray-200)', fontSize:10}} />
                                                        <button onClick={() => saveIdentite(r.matricule)} title="Enregistrer le prénom"
                                                            style={{padding:'2px 6px', background:'var(--berry)', color:'white', border:'none', borderRadius:4, fontSize:9, cursor:'pointer'}}>
                                                            <i className="fa-solid fa-check"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                                <td style={{textAlign:'center'}}>
                                                    <input type="checkbox" checked={r.declare} onChange={e => toggleDeclare(r.matricule, e.target.checked)} />
                                                </td>
                                                <td style={{textAlign:'right'}}>
                                                    <input type="number" step="0.5" min="0" defaultValue={r.primeFonctionJournaliere || 0}
                                                        onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (r.primeFonctionJournaliere || 0)) savePrimeFonction(r.matricule, v); }}
                                                        style={{width:60, textAlign:'right', padding:'2px 4px', borderRadius:4, border:'1px solid var(--gray-200)', fontSize:10}} />
                                                </td>
                                                <td style={{textAlign:'right'}}>{fmtInt(r.baselineJours)}</td>
                                                <td style={{textAlign:'center', color:'var(--gray-400)'}}>{r.baselineDate || '—'}</td>
                                                <td style={{textAlign:'right'}}>{fmtInt(r.joursDepuisBaseline)}</td>
                                                <td style={{textAlign:'right', fontWeight:700}}>{fmtInt(r.anciennete)}</td>
                                                <td style={{fontSize:9}}>{r.declare ? `${r.paie.palier} (${r.paie.pourcentage}%)` : '—'}</td>
                                                <td style={{textAlign:'right'}}>{fmtInt(r.joursPeriode)}</td>
                                                <td style={{textAlign:'right'}}>{fmt(r.paie.brut)}</td>
                                                <td style={{textAlign:'right', color: r.paie.prime > 0 ? 'var(--berry)' : 'var(--gray-300)'}}>{fmt(r.paie.prime)}</td>
                                                <td style={{textAlign:'right', color: r.paie.retenues > 0 ? 'var(--red)' : 'var(--gray-300)'}}>{r.paie.retenues > 0 ? '-' : ''}{fmt(r.paie.retenues)}</td>
                                                <td style={{textAlign:'right', fontWeight:700, background:'rgba(46,204,113,0.08)'}} title={`Net exact : ${fmt(r.paie.net)} DH`}>{fmtInt(r.paie.netArrondi)}</td>
                                                <td style={{textAlign:'right', color:'var(--gray-500)'}}>{fmt(r.paie.chargesPatronales)}</td>
                                                <td style={{textAlign:'right', fontWeight:700, background:'rgba(139,34,82,0.08)'}}>{fmt(r.paie.coutEmployeur)}</td>
                                            </tr>
                                        ))}
                                        {filteredRows.length === 0 && (
                                            <tr><td colSpan={17} style={{textAlign:'center', color:'var(--gray-400)', padding:20}}>Aucun ouvrier trouvé pour cette période / ce filtre.</td></tr>
                                        )}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{fontWeight:700, background:'var(--gray-50)'}}>
                                            <td colSpan={11} style={{textAlign:'right'}}>Totaux ({filteredRows.length} ouvrier{filteredRows.length > 1 ? 's' : ''})</td>
                                            <td style={{textAlign:'right'}}>{fmt(totals.brut)}</td>
                                            <td style={{textAlign:'right'}}>{fmt(totals.prime)}</td>
                                            <td style={{textAlign:'right', color: totals.retenues > 0 ? 'var(--red)' : 'inherit'}}>{totals.retenues > 0 ? '-' : ''}{fmt(totals.retenues)}</td>
                                            <td style={{textAlign:'right', background:'rgba(46,204,113,0.15)'}} title={`Net exact : ${fmt(totals.net)} DH`}>{fmtInt(totals.netArrondi)}</td>
                                            <td style={{textAlign:'right'}}>{fmt(totals.charges)}</td>
                                            <td style={{textAlign:'right', background:'rgba(139,34,82,0.15)'}}>{fmt(totals.cout)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}

                        <div style={{marginTop:10, fontSize:10, color:'var(--gray-400)', lineHeight:1.5}}>
                            <i className="fa-solid fa-info-circle" style={{marginRight:4}}></i>
                            <strong>Non déclarés</strong> : Brut = SMAG net × jours pointés (+ prime fonction) — aucune retenue, aucune charge, pas de prime d'ancienneté. Net à payer = Brut. Coût employeur = Brut.
                            <br />
                            <strong>Déclarés</strong> : Brut = SMAG brut × (jours + fériés) + prime ancienneté + prime fonction ; Retenues = CNSS (4,48 %) + AMO (2,26 %) sur le brut ; Net à payer = Brut − retenues (arrondi au plus proche) ; Coût employeur = Brut + charges patronales (26 %), transport exclu.
                            <br />
                            SMAG résolu à la <strong>date de fin de période</strong> (barème daté). Jours fériés comptés sur la période depuis la config des primes. Les barèmes (SMAG, taux, paliers) sont éditables dans <em>Paramètres</em> et appliqués en temps réel.
                        </div>
                    </Panel>
                </div>
            );
        }

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
                        <window.QuinzaineCampagneSelect periodes={periodes} periodeCampagne={periodeCampagne} periodeDates={periodeDates} value={selectedPeriode} onChange={v => setSelectedPeriode(v)} />
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

        // Configuration des sous-traitants / transporteurs (déplacée du Pointage Divers vers Paramètres).
        // Autonome : charge sa propre liste et la recharge après chaque save/delete.
        function SousTraitantsConfigPanel() {
            const [configItems, setConfigItems] = useState([]);
            const [editingItem, setEditingItem] = useState(null);
            const [loadingCfg, setLoadingCfg] = useState(true);

            const loadConfig = () => {
                fetch('/api/validation?action=divers-config').then(r => r.json())
                    .then(res => { if (res.success) setConfigItems(res.items || []); })
                    .catch(err => console.warn('Sous-traitants config load error:', err))
                    .finally(() => setLoadingCfg(false));
            };
            React.useEffect(() => { loadConfig(); }, []);

            const saveConfigItem = () => {
                if (!editingItem || !editingItem.beneficiaire || !editingItem.matricule || !editingItem.fonction || !editingItem.tache || editingItem.prixUnitaire === '' || editingItem.prixUnitaire === undefined || !editingItem.unite) {
                    alert('Tous les champs sont obligatoires (Nom, Matricule, Fonction, Tâche, Prix, Unité).');
                    return;
                }
                const matNorm = String(editingItem.matricule).trim().toUpperCase();
                if (!matNorm) { alert('Matricule obligatoire.'); return; }
                const dup = configItems.find(c => c.id !== editingItem.id && String(c.matricule || '').trim().toUpperCase() === matNorm);
                if (dup) { alert(`Matricule ${matNorm} déjà utilisé par "${dup.beneficiaire}".`); return; }
                const payload = { ...editingItem, matricule: matNorm, beneficiaire: String(editingItem.beneficiaire).trim() };
                fetch('/api/validation?action=divers-config-save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
                    .then(r => r.json()).then(res => { if (res.success) { setEditingItem(null); loadConfig(); } else { alert(res.error || 'Erreur'); } });
            };
            const deleteConfigItem = (id) => {
                if (!confirm('Supprimer ce sous-traitant ?')) return;
                fetch('/api/validation?action=divers-config-delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
                    .then(r => r.json()).then(res => { if (res.success) loadConfig(); });
            };

            const renderEditorRow = (keySuffix) => (
                <tr key={'edit_' + keySuffix} style={{background:'#fffde7'}}>
                    <td><input value={editingItem.beneficiaire} onChange={e => setEditingItem({...editingItem, beneficiaire: e.target.value})} placeholder="Nom transporteur" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td><input value={editingItem.matricule} onChange={e => setEditingItem({...editingItem, matricule: e.target.value.toUpperCase()})} placeholder="7071H1" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11,fontWeight:600,fontFamily:'monospace'}} /></td>
                    <td>
                        <select value={editingItem.fonction} onChange={e => {
                            const f = FONCTIONS_ENUM.find(x => x.key === e.target.value);
                            setEditingItem({...editingItem, fonction: e.target.value, unite: editingItem.unite || (f ? f.defaultUnite : 'JOUR')});
                        }} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="">-- Choisir --</option>
                            {FONCTIONS_ENUM.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                    </td>
                    <td><input value={editingItem.tache} onChange={e => setEditingItem({...editingItem, tache: e.target.value})} placeholder="Tâche" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td><input type="number" value={editingItem.prixUnitaire} onChange={e => setEditingItem({...editingItem, prixUnitaire: e.target.value})} placeholder="0" style={{width:70,padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11,textAlign:'right'}} /></td>
                    <td>
                        <select value={editingItem.unite} onChange={e => setEditingItem({...editingItem, unite: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="JOUR">JOUR</option><option value="HEURE">HEURE</option><option value="VOYAGES">VOYAGES</option>
                        </select>
                    </td>
                    <td style={{textAlign:'center'}}>
                        <button onClick={saveConfigItem} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--green)',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-check"></i></button>
                        <button onClick={() => setEditingItem(null)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--gray-300)',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-times"></i></button>
                    </td>
                </tr>
            );
            const renderRow = (c) => (editingItem && editingItem.id === c.id ? renderEditorRow(c.id) : (
                <tr key={c.id}>
                    <td><strong>{c.beneficiaire || <em style={{color:'var(--gray-400)'}}>(à compléter)</em>}</strong></td>
                    <td style={{fontFamily:'monospace',fontWeight:600}}>{c.matricule || <em style={{color:'#e74c3c'}}>—</em>}</td>
                    <td>{c.fonction}</td>
                    <td>{c.tache}</td>
                    <td style={{textAlign:'right',fontWeight:600}}>{Number(c.prixUnitaire).toLocaleString('fr-FR')} DH</td>
                    <td>{c.unite}</td>
                    <td style={{textAlign:'center'}}>
                        <button onClick={() => setEditingItem({ id: c.id, beneficiaire: c.beneficiaire || '', matricule: c.matricule || '', fonction: c.fonction, tache: c.tache, prixUnitaire: c.prixUnitaire, unite: c.unite })} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#3498db',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-pen"></i></button>
                        <button onClick={() => deleteConfigItem(c.id)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#e74c3c',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            ));
            const groups = FONCTIONS_ENUM.map(f => ({ ...f, items: configItems.filter(c => c.fonction === f.key) }));
            const legacyItems = configItems.filter(c => !FONCTIONS_ENUM.some(f => f.key === c.fonction));
            if (legacyItems.length > 0) groups.push({ key: '__LEGACY__', label: '⚠️ Anciens (à reclasser)', items: legacyItems });

            return (
                <Panel title="Configuration Sous-traitants (Pointage Divers)" icon="fa-truck">
                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:10}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>
                        Transporteurs / engins / tracteurs utilisés dans <strong>Pointage Divers</strong>. Le Transport Fruit est alimenté automatiquement par les bons d'apport.
                    </div>
                    <div style={{marginBottom:10}}>
                        <button onClick={() => setEditingItem({ beneficiaire: '', matricule: '', fonction: '', tache: '', prixUnitaire: '', unite: 'JOUR' })}
                            style={{padding:'6px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter
                        </button>
                    </div>
                    {loadingCfg ? <div style={{padding:16,color:'var(--gray-400)',fontSize:12}}>Chargement…</div> : (
                    <table className="data-table" style={{fontSize:12}}>
                        <thead>
                            <tr>
                                <th>Bénéficiaire (Nom)</th>
                                <th style={{width:110}}>Matricule</th>
                                <th style={{width:170}}>Fonction</th>
                                <th>Tâche</th>
                                <th style={{textAlign:'right',width:110}}>Prix Unitaire</th>
                                <th style={{width:80}}>Unité</th>
                                <th style={{textAlign:'center',width:90}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {editingItem && !editingItem.id && renderEditorRow('new')}
                            {groups.map(g => (
                                <React.Fragment key={g.key}>
                                    <tr style={{background:'var(--gray-100)'}}>
                                        <td colSpan="7" style={{fontWeight:700,fontSize:11,color:'var(--gray-600)',padding:'6px 8px'}}>
                                            {g.label} <span style={{color:'var(--gray-400)',fontWeight:400}}>({g.items.length})</span>
                                        </td>
                                    </tr>
                                    {g.items.length === 0 ? (
                                        <tr><td colSpan="7" style={{textAlign:'center',color:'var(--gray-400)',fontStyle:'italic',padding:8,fontSize:11}}>— aucun —</td></tr>
                                    ) : g.items.map(renderRow)}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                    )}
                </Panel>
            );
        }

        function JoursFeriesConfigPanel() {
            const [holidays, setHolidays] = useState([]);
            const [meta, setMeta] = useState({ lastSyncAt: null, syncSource: null });
            const [editing, setEditing] = useState(null); // {originalDate, date, label, type, status}
            const [loading, setLoading] = useState(true);
            const [syncing, setSyncing] = useState(false);

            const load = () => {
                fetch('/api/validation?action=jours-feries').then(r => r.json())
                    .then(res => { if (res.success) { setHolidays(res.holidays || []); setMeta({ lastSyncAt: res.lastSyncAt, syncSource: res.syncSource }); } })
                    .catch(err => console.warn('Jours fériés load error:', err))
                    .finally(() => setLoading(false));
            };
            React.useEffect(() => { load(); }, []);

            const save = (entry) => {
                if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !entry.label) {
                    alert('Date (AAAA-MM-JJ) et libellé obligatoires.');
                    return;
                }
                fetch('/api/validation?action=jours-feries-save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(entry) })
                    .then(r => r.json()).then(res => { if (res.success) { setEditing(null); load(); } else { alert(res.error || 'Erreur'); } });
            };
            const remove = (date) => {
                if (!confirm('Supprimer ce jour férié ?')) return;
                fetch('/api/validation?action=jours-feries-delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ date }) })
                    .then(r => r.json()).then(res => { if (res.success) load(); });
            };
            const confirmHoliday = (h) => {
                save({ originalDate: h.date, date: h.date, label: h.label, type: h.type, status: 'confirme' });
            };
            const runSyncNow = () => {
                setSyncing(true);
                fetch('/api/run-sync-jours-feries-now').then(r => r.json())
                    .then(res => { if (!res.success) alert(res.error || 'Erreur sync'); load(); })
                    .catch(err => alert('Erreur sync: ' + err.message))
                    .finally(() => setSyncing(false));
            };

            const STATUS_BADGE = {
                fixe: { label: 'Fixe', bg: '#e2e3e5', color: '#41464b' },
                estime: { label: 'Estimé', bg: '#fff3cd', color: '#856404' },
                confirme: { label: 'Confirmé', bg: '#d4edda', color: '#155724' },
            };
            const statusOf = (h) => h.status || (h.type === 'islamique' ? 'estime' : 'fixe');

            const editorRow = (keySuffix) => (
                <tr key={'edit_' + keySuffix} style={{background:'#fffde7'}}>
                    <td><input type="date" value={editing.date} onChange={e => setEditing({...editing, date: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td><input value={editing.label} onChange={e => setEditing({...editing, label: e.target.value})} placeholder="Libellé de la fête" style={{width:'100%',padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}} /></td>
                    <td>
                        <select value={editing.type} onChange={e => setEditing({...editing, type: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="fixe">Fixe (grégorien)</option>
                            <option value="islamique">Islamique (lunaire)</option>
                        </select>
                    </td>
                    <td>
                        <select value={editing.status} onChange={e => setEditing({...editing, status: e.target.value})} style={{padding:4,borderRadius:4,border:'1px solid var(--gray-300)',fontSize:11}}>
                            <option value="fixe">Fixe</option>
                            <option value="estime">Estimé</option>
                            <option value="confirme">Confirmé</option>
                        </select>
                    </td>
                    <td style={{textAlign:'center'}}>
                        <button onClick={() => save(editing)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--green)',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-check"></i></button>
                        <button onClick={() => setEditing(null)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--gray-300)',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-times"></i></button>
                    </td>
                </tr>
            );
            const displayRow = (h) => (editing && editing.originalDate === h.date ? editorRow(h.date) : (
                <tr key={h.date}>
                    <td style={{fontWeight:600,fontFamily:'monospace'}}>{h.date}</td>
                    <td>{h.label}{h.manualOverride ? <i className="fa-solid fa-user-pen" title="Modifié par RH (prioritaire sur l'API)" style={{marginLeft:6,color:'var(--berry)',fontSize:10}}></i> : null}</td>
                    <td>{h.type === 'islamique' ? '🌙 Islamique' : '📅 Fixe'}</td>
                    <td>{(() => { const s = STATUS_BADGE[statusOf(h)]; return <span style={{background:s.bg,color:s.color,padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:600}}>{s.label}</span>; })()}</td>
                    <td style={{textAlign:'center',whiteSpace:'nowrap'}}>
                        {statusOf(h) !== 'confirme' && <button onClick={() => confirmHoliday(h)} title="Confirmer (override RH)" style={{padding:'3px 8px',borderRadius:4,border:'none',background:'var(--green)',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-circle-check"></i></button>}
                        <button onClick={() => setEditing({ originalDate: h.date, date: h.date, label: h.label, type: h.type, status: statusOf(h) })} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#3498db',color:'#fff',fontSize:10,cursor:'pointer',marginRight:4}}><i className="fa-solid fa-pen"></i></button>
                        <button onClick={() => remove(h.date)} style={{padding:'3px 8px',borderRadius:4,border:'none',background:'#e74c3c',color:'#fff',fontSize:10,cursor:'pointer'}}><i className="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            ));

            const sorted = holidays.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
            const fmtSync = meta.lastSyncAt ? new Date(meta.lastSyncAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';

            return (
                <Panel title="Jours Fériés (Prime Jour Férié)" icon="fa-calendar-star">
                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:10}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:4}}></i>
                        Source unique du calcul de la <strong>Prime Jour Férié</strong> et du calendrier. Les fêtes <strong>islamiques</strong> (lunaires) sont estimées puis confirmées automatiquement à l'approche par un job quotidien (date.nager.at). Une modification RH ici <strong>prime sur l'API</strong>.
                        <span style={{marginLeft:6,color:'var(--gray-400)'}}>Dernière synchro API : {fmtSync}.</span>
                    </div>
                    <div style={{marginBottom:10,display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button onClick={() => setEditing({ originalDate: null, date: '', label: '', type: 'fixe', status: 'fixe' })}
                            style={{padding:'6px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                            <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter
                        </button>
                        <button onClick={runSyncNow} disabled={syncing}
                            style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--gray-300)',background:'#fff',color:'var(--gray-600)',fontSize:12,fontWeight:600,cursor:syncing?'default':'pointer',opacity:syncing?0.6:1}}>
                            <i className={'fa-solid ' + (syncing ? 'fa-spinner fa-spin' : 'fa-rotate')} style={{marginRight:4}}></i>{syncing ? 'Synchro…' : 'Synchroniser maintenant'}
                        </button>
                    </div>
                    {loading ? <div style={{padding:16,color:'var(--gray-400)',fontSize:12}}>Chargement…</div> : (
                    <table className="data-table" style={{fontSize:12}}>
                        <thead>
                            <tr>
                                <th style={{width:120}}>Date</th>
                                <th>Fête</th>
                                <th style={{width:140}}>Type</th>
                                <th style={{width:110}}>Statut</th>
                                <th style={{textAlign:'center',width:130}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {editing && !editing.originalDate && editorRow('new')}
                            {sorted.length === 0 ? (
                                <tr><td colSpan="5" style={{textAlign:'center',color:'var(--gray-400)',fontStyle:'italic',padding:12,fontSize:11}}>Aucun jour férié — cliquez sur « Synchroniser maintenant » ou « Ajouter ».</td></tr>
                            ) : sorted.map(displayRow)}
                        </tbody>
                    </table>
                    )}
                </Panel>
            );
        }

        function ParametresTab({ data }) {
            const [parcelles, setParcelles] = useState(() => {
                const copy = {};
                Object.keys(data.parcelleConfig).forEach(f => { copy[f] = data.parcelleConfig[f].map(p => ({...p})); });
                return copy;
            });
            const [normes, setNormes] = useState(() => undefined(n => ({...n})));
            const [editingCell, setEditingCell] = useState(null); // {farm, idx, field}
            const [editVal, setEditVal] = useState('');
            const [showAddTache, setShowAddTache] = useState(false);
            const [newTache, setNewTache] = useState('');
            const [newNorme, setNewNorme] = useState('');

            const startEdit = (farm, idx, field, currentVal) => { setEditingCell({farm, idx, field}); setEditVal(String(currentVal)); };
            const saveEdit = () => {
                if (!editingCell) return;
                const {farm, idx, field} = editingCell;
                setParcelles(prev => {
                    const copy = {...prev};
                    copy[farm] = [...copy[farm]];
                    copy[farm][idx] = {...copy[farm][idx], [field]: field === 'nbTunnels' ? parseInt(editVal)||0 : field === 'superficie' ? parseFloat(editVal)||0 : editVal};
                    return copy;
                });
                setEditingCell(null);
            };
            const isEditing = (farm, idx, field) => editingCell && editingCell.farm===farm && editingCell.idx===idx && editingCell.field===field;

            const editableCell = (farm, idx, field, val, opts={}) => {
                if (isEditing(farm, idx, field)) {
                    return <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key==='Enter' && saveEdit()}
                        style={{width: opts.width||'100%', padding:'4px 6px', borderRadius:6, border:'2px solid var(--berry)', fontSize:11, textAlign: opts.align||'left', fontWeight:600, background:'rgba(139,34,82,0.05)'}} />;
                }
                return <span onClick={() => startEdit(farm, idx, field, val)} style={{cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', ...opts.style}}
                    title="Cliquez pour modifier">{val}</span>;
            };

            const handleAddTache = () => {
                if (newTache.trim() && newNorme) {
                    setNormes([...normes, { tache: newTache.trim(), normeTunnelsParJourParOuvrier: parseFloat(newNorme)||1, unite: 'tunnels/jour/ouvrier' }]);
                    setNewTache(''); setNewNorme(''); setShowAddTache(false);
                }
            };

            const [editingNormeIdx, setEditingNormeIdx] = useState(null);
            const [normeEditVal, setNormeEditVal] = useState('');

            // Avocatier config state
            const [avoConfig, setAvoConfig] = useState(() => {
                const copy = {};
                Object.keys(data.avocatierConfig).forEach(f => { copy[f] = data.avocatierConfig[f].map(p => ({...p})); });
                return copy;
            });
            const [editingAvoCell, setEditingAvoCell] = useState(null);
            const [avoEditVal, setAvoEditVal] = useState('');
            const startAvoEdit = (farm, idx, field, val) => { setEditingAvoCell({farm, idx, field}); setAvoEditVal(String(val)); };
            const saveAvoEdit = () => {
                if (!editingAvoCell) return;
                const {farm, idx, field} = editingAvoCell;
                setAvoConfig(prev => {
                    const copy = {...prev};
                    copy[farm] = [...copy[farm]];
                    copy[farm][idx] = {...copy[farm][idx], [field]: field === 'nbLignes' ? parseInt(avoEditVal)||0 : avoEditVal};
                    return copy;
                });
                setEditingAvoCell(null);
            };
            const isAvoEditing = (farm, idx, field) => editingAvoCell && editingAvoCell.farm===farm && editingAvoCell.idx===idx && editingAvoCell.field===field;
            const avoEditableCell = (farm, idx, field, val, opts={}) => {
                if (isAvoEditing(farm, idx, field)) {
                    return <input autoFocus value={avoEditVal} onChange={e => setAvoEditVal(e.target.value)} onBlur={saveAvoEdit} onKeyDown={e => e.key==='Enter' && saveAvoEdit()}
                        style={{width: opts.width||'100%', padding:'4px 6px', borderRadius:6, border:'2px solid var(--orange)', fontSize:11, textAlign: opts.align||'left', fontWeight:600, background:'rgba(230,126,34,0.05)'}} />;
                }
                return <span onClick={() => startAvoEdit(farm, idx, field, val)} style={{cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', ...opts.style}}
                    title="Cliquez pour modifier">{val}</span>;
            };

            // Primes config state - par culture
            const [primesFramboise, setPrimesFramboise] = useState(() => (data.primesConfig.framboise?.tranches || []).map(t => ({...t})));
            const [primesMyrtille, setPrimesMyrtille] = useState(() => (data.primesConfig.myrtille?.tranches || []).map(t => ({...t})));
            const [primeCaporal, setPrimeCaporal] = useState(() => ({...data.primesConfig.primeCaporal}));
            const [editingPrimeIdx, setEditingPrimeIdx] = useState(null);
            const [primeEditField, setPrimeEditField] = useState(null);
            const [primeEditVal, setPrimeEditVal] = useState('');
            const [primeEditCulture, setPrimeEditCulture] = useState('framboise');

            return (
                <div className="fade-in">
                    <Panel title="Configuration Parcelles par Ferme" icon="fa-leaf">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:12}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i> Cliquez sur une cellule pour la modifier</div>
                        {['F1', 'F5'].map(farm => (
                            <div key={farm} style={{marginBottom:24}}>
                                <h3 style={{fontSize:14, fontWeight:700, marginBottom:12, color:'var(--berry)'}}>
                                    <i className={`fa-solid ${farm==='F1'?'fa-seedling':'fa-leaf'}`} style={{marginRight:6}}></i>
                                    {farm === 'F1' ? 'Ferme 172 (F1)' : 'Ferme 195 (F5)'}
                                    <span style={{fontSize:11, fontWeight:400, color:'var(--gray-400)', marginLeft:8}}>
                                        {parcelles[farm].reduce((s,p) => s+p.nbTunnels, 0)} tunnels | {parcelles[farm].reduce((s,p) => s+p.superficie, 0).toFixed(1)} ha
                                    </span>
                                </h3>
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nom Parcelle</th>
                                            <th>Culture</th>
                                            <th>Variété</th>
                                            <th style={{textAlign:'right'}}>Superficie (ha)</th>
                                            <th style={{textAlign:'right'}}>Nb Tunnels</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parcelles[farm].map((p, i) => (
                                            <tr key={i}>
                                                <td style={{color:'var(--gray-400)', fontSize:10}}>{p.id}</td>
                                                <td style={{fontWeight:600}}>{editableCell(farm, i, 'nom', p.nom)}</td>
                                                <td>{editableCell(farm, i, 'culture', p.culture)}</td>
                                                <td>{editableCell(farm, i, 'variete', p.variete)}</td>
                                                <td style={{textAlign:'right'}}>{editableCell(farm, i, 'superficie', p.superficie, {align:'right', width:'60px'})}</td>
                                                <td style={{textAlign:'right', fontWeight:700, color:'var(--berry)'}}>{editableCell(farm, i, 'nbTunnels', p.nbTunnels, {align:'right', width:'50px', style:{fontWeight:700, color:'var(--berry)'}})}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </Panel>

                    <Panel title="Configuration Avocatier (Lignes)" icon="fa-tree">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:12}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i> Cliquez sur une cellule pour la modifier</div>
                        {Object.keys(avoConfig).map(farm => (
                            <div key={farm} style={{marginBottom:20}}>
                                <h3 style={{fontSize:14, fontWeight:700, marginBottom:10, color:'var(--orange)'}}>
                                    <i className="fa-solid fa-tree" style={{marginRight:6}}></i>
                                    Parcelle {farm}
                                    <span style={{fontSize:11, fontWeight:400, color:'var(--gray-400)', marginLeft:8}}>
                                        {avoConfig[farm].reduce((s,p) => s+p.nbLignes, 0)} lignes
                                    </span>
                                </h3>
                                <table className="data-table" style={{fontSize:11}}>
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nom</th>
                                            <th>Culture</th>
                                            <th>Variété</th>
                                            <th style={{textAlign:'right'}}>Nb Lignes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {avoConfig[farm].map((p, i) => (
                                            <tr key={i}>
                                                <td style={{color:'var(--gray-400)', fontSize:10}}>{p.id}</td>
                                                <td style={{fontWeight:600}}>{avoEditableCell(farm, i, 'nom', p.nom)}</td>
                                                <td>{avoEditableCell(farm, i, 'culture', p.culture)}</td>
                                                <td>{avoEditableCell(farm, i, 'variete', p.variete)}</td>
                                                <td style={{textAlign:'right', fontWeight:700, color:'var(--orange)'}}>{avoEditableCell(farm, i, 'nbLignes', p.nbLignes, {align:'right', width:'50px', style:{fontWeight:700, color:'var(--orange)'}})}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </Panel>

                    <Panel title="Normes de Productivité" icon="fa-gear">
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                            <div style={{fontSize:11, color:'var(--gray-400)'}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i> Cliquez sur une norme pour la modifier</div>
                            <button onClick={() => setShowAddTache(true)} style={{padding:'6px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
                                <i className="fa-solid fa-plus"></i> Nouvelle Tâche
                            </button>
                        </div>
                        <table className="data-table" style={{fontSize:11}}>
                            <thead>
                                <tr>
                                    <th>Tâche</th>
                                    <th style={{textAlign:'center', width:180}}>Norme (tunnels/jour/ouvrier)</th>
                                    <th>Unité</th>
                                    <th style={{width:40}}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {normes.map((n, i) => (
                                    <tr key={i}>
                                        <td style={{fontWeight:600}}><i className="fa-solid fa-wrench" style={{marginRight:6, color:'var(--gray-300)', fontSize:10}}></i>{n.tache}</td>
                                        <td style={{textAlign:'center'}}>
                                            {editingNormeIdx === i ? (
                                                <input autoFocus type="number" step="0.5" min="0.5" value={normeEditVal}
                                                    onChange={e => setNormeEditVal(e.target.value)}
                                                    onBlur={() => { setNormes(prev => { const c=[...prev]; c[i]={...c[i], normeTunnelsParJourParOuvrier: parseFloat(normeEditVal)||1}; return c; }); setEditingNormeIdx(null); }}
                                                    onKeyDown={e => { if(e.key==='Enter') e.target.blur(); }}
                                                    style={{width:60, padding:'4px 6px', borderRadius:6, border:'2px solid var(--berry)', fontSize:12, textAlign:'center', fontWeight:700}}/>
                                            ) : (
                                                <span onClick={() => { setEditingNormeIdx(i); setNormeEditVal(String(n.normeTunnelsParJourParOuvrier)); }}
                                                    style={{fontWeight:700, color:'var(--berry)', cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', padding:'2px 8px'}}
                                                    title="Cliquez pour modifier">{n.normeTunnelsParJourParOuvrier}</span>
                                            )}
                                        </td>
                                        <td style={{color:'var(--gray-600)', fontSize:10}}>{n.unite}</td>
                                        <td>
                                            <button onClick={() => setNormes(normes.filter((_,j) => j!==i))} style={{background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:12, opacity:0.5}} title="Supprimer">
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {showAddTache && (
                            <div style={{marginTop:12, padding:16, background:'var(--green-pale)', borderRadius:10, border:'1px solid var(--green)'}}>
                                <div style={{fontSize:13, fontWeight:600, marginBottom:10}}>
                                    <i className="fa-solid fa-plus-circle" style={{marginRight:6, color:'var(--green)'}}></i>Ajouter une nouvelle tâche
                                </div>
                                <div style={{display:'flex', gap:10, alignItems:'flex-end'}}>
                                    <div style={{flex:1}}>
                                        <label style={{fontSize:10, fontWeight:600, display:'block', marginBottom:4}}>Nom de la tâche</label>
                                        <input type="text" value={newTache} onChange={e => setNewTache(e.target.value)} placeholder="Ex: Taille de formation"
                                            style={{width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}/>
                                    </div>
                                    <div style={{width:120}}>
                                        <label style={{fontSize:10, fontWeight:600, display:'block', marginBottom:4}}>Norme</label>
                                        <input type="number" step="0.5" min="0.5" value={newNorme} onChange={e => setNewNorme(e.target.value)} placeholder="Ex: 4"
                                            style={{width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, textAlign:'center'}}/>
                                    </div>
                                    <button onClick={handleAddTache} style={{padding:'8px 16px', background:'var(--green)', color:'white', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:4}}></i> Ajouter
                                    </button>
                                    <button onClick={() => {setShowAddTache(false); setNewTache(''); setNewNorme('');}} style={{padding:'8px 12px', background:'var(--gray-200)', color:'var(--gray-600)', border:'none', borderRadius:8, fontSize:12, cursor:'pointer'}}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        )}
                    </Panel>

                    <SousTraitantsConfigPanel />

                    <JoursFeriesConfigPanel />

                    <Panel title="Barèmes des Primes de Récolte" icon="fa-coins">
                        <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:16}}>
                            <i className="fa-solid fa-info-circle" style={{marginRight:4}}></i> Deux barèmes différents selon la culture. Les primes sont calculées automatiquement en fonction de la variété de l'ouvrier.
                        </div>

                        {/* Framboise */}
                        <div style={{marginBottom:20}}>
                            <h4 style={{fontSize:13, fontWeight:700, color:'var(--berry)', marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                                <span style={{fontSize:16}}>🍓</span> Framboise
                                <span style={{fontSize:10, fontWeight:400, color:'var(--gray-400)'}}>(Maravilla, Reyna, Yazmin...)</span>
                            </h4>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th style={{width:80}}>Seuil (Kg)</th>
                                        <th style={{width:80}}>Prime (DH)</th>
                                        <th style={{width:100}}>Bonus/Kg</th>
                                        <th style={{width:100}}>Base Bonus</th>
                                        <th>Description</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {primesFramboise.map((tranche, i) => (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{tranche.seuil} Kg</td>
                                            <td style={{fontWeight:700, color:'var(--gold)'}}>{tranche.prime} DH</td>
                                            <td style={{color: tranche.bonusParKg ? 'var(--blue)' : 'var(--gray-300)'}}>{tranche.bonusParKg ? tranche.bonusParKg + ' DH/Kg' : '-'}</td>
                                            <td style={{color: tranche.bonusBase ? 'var(--orange)' : 'var(--gray-300)'}}>{tranche.bonusBase ? '>' + tranche.bonusBase + ' Kg' : '-'}</td>
                                            <td style={{color:'var(--gray-600)'}}>{tranche.label}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{marginTop:8, padding:'8px 12px', background:'rgba(139,34,82,0.04)', borderRadius:8, fontSize:11, color:'var(--gray-600)'}}>
                                <b>Exemple :</b> 35 Kg → 60 DH + (35-30) × 3 = <b>75 DH</b> | 45 Kg → 100 DH + (45-40) × 4 = <b>120 DH</b>
                            </div>
                        </div>

                        {/* Myrtille */}
                        <div style={{marginBottom:20}}>
                            <h4 style={{fontSize:13, fontWeight:700, color:'#5B6ABF', marginBottom:8, display:'flex', alignItems:'center', gap:8}}>
                                <span style={{fontSize:16}}>🫐</span> Myrtille
                                <span style={{fontSize:10, fontWeight:400, color:'var(--gray-400)'}}>(Corina, Corrina...)</span>
                            </h4>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead>
                                    <tr>
                                        <th style={{width:80}}>Seuil (Kg)</th>
                                        <th style={{width:120}}>Prime</th>
                                        <th>Description</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {primesMyrtille.map((tranche, i) => (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{tranche.seuil} Kg</td>
                                            <td style={{fontWeight:700, color:'#5B6ABF'}}>{tranche.bonusParKg} DH/Kg au-delà de {tranche.bonusBase} Kg</td>
                                            <td style={{color:'var(--gray-600)'}}>{tranche.label}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{marginTop:8, padding:'8px 12px', background:'rgba(91,106,191,0.04)', borderRadius:8, fontSize:11, color:'var(--gray-600)'}}>
                                <b>Exemple :</b> 35 Kg → (35-30) × 2 = <b>10 DH</b> | 50 Kg → (50-30) × 2 = <b>40 DH</b> | ≤30 Kg → <b>0 DH</b>
                            </div>
                        </div>

                        {/* Prime Caporal */}
                        <div style={{padding:'12px 16px', background:'rgba(230,126,34,0.05)', borderRadius:10, border:'1px solid rgba(230,126,34,0.15)'}}>
                            <h4 style={{fontSize:12, fontWeight:700, color:'var(--orange)', marginBottom:6, display:'flex', alignItems:'center', gap:6}}>
                                <i className="fa-solid fa-user-tie"></i> Prime Caporal (Chef d'équipe)
                            </h4>
                            <div style={{fontSize:11, color:'var(--gray-600)', display:'flex', gap:24, flexWrap:'wrap'}}>
                                <div>Moyenne équipe ≥ 25 Kg/j → <b style={{color:'var(--orange)'}}>{primeCaporal.base} DH</b></div>
                                <div>Moyenne équipe ≥ 30 Kg/j → <b style={{color:'var(--orange)'}}>{primeCaporal.base + primeCaporal.bonusSiEquipeSup30} DH</b> (+{primeCaporal.bonusSiEquipeSup30} DH bonus)</div>
                            </div>
                        </div>

                        {/* Poids par Caisse */}
                        <div style={{padding:'12px 16px', background:'rgba(142,68,173,0.05)', borderRadius:10, border:'1px solid rgba(142,68,173,0.15)'}}>
                            <h4 style={{fontSize:12, fontWeight:700, color:'#8e44ad', marginBottom:6, display:'flex', alignItems:'center', gap:6}}>
                                <i className="fa-solid fa-weight-hanging"></i> Poids par Caisse (extrait automatiquement de BEE ONE)
                            </h4>
                            <table className="data-table" style={{fontSize:11}}>
                                <thead><tr><th>Opération</th><th style={{textAlign:'right'}}>Kg / Caisse</th></tr></thead>
                                <tbody>
                                    <tr><td>Récolte Caisse 1.5 KG</td><td style={{textAlign:'right', fontWeight:700, color:'#8e44ad'}}>1.5 kg</td></tr>
                                    <tr><td>Récolte Caisse 2.4 kg</td><td style={{textAlign:'right', fontWeight:700, color:'#8e44ad'}}>2.4 kg</td></tr>
                                </tbody>
                            </table>
                            <div style={{marginTop:8, padding:'8px 12px', background:'rgba(142,68,173,0.04)', borderRadius:8, fontSize:11, color:'var(--gray-600)'}}>
                                Le poids par caisse est extrait du nom de l'opération dans BEE ONE (ex: "Récolte Caisse 2.4 kg"). Si aucun poids n'est détecté, le défaut est 1.5 kg.
                            </div>
                        </div>
                    </Panel>

                    {/* ===== Blocs Qualité Driscoll's ===== */}
                    <Panel title="Blocs Qualité Driscoll's" icon="fa-cubes">
                        <p style={{fontSize:'11px', color:'var(--gray-400)', marginBottom:'10px'}}>
                            <i className="fa-solid fa-pen"></i> Cliquez sur une valeur pour la modifier. Les blocs sont utilisés dans le Dashboard Qualité pour le calcul Kg/Ha.
                        </p>
                        {(() => {
                            const [blocsConf, setBlocsConf] = useState(() => {
                                try { const s = localStorage.getItem('blocIdsConfig'); return s ? JSON.parse(s) : undefined(b => ({...b})); } catch(e) { return undefined(b => ({...b})); }
                            });
                            const [editBlocCell, setEditBlocCell] = useState(null);
                            const [blocEditVal, setBlocEditVal] = useState('');
                            const [showAddBloc, setShowAddBloc] = useState(false);
                            const [newBloc, setNewBloc] = useState({label:'', parcelle:'', variete:'', ferme:'F1', ranch:'200742', blockId:'', ha:0});

                            const saveBlocsToStorage = (updated) => { localStorage.setItem('blocIdsConfig', JSON.stringify(updated)); };

                            const startBlocEdit = (idx, field, val) => { setEditBlocCell({idx, field}); setBlocEditVal(String(val)); };
                            const saveBlocEdit = () => {
                                if (!editBlocCell) return;
                                const {idx, field} = editBlocCell;
                                setBlocsConf(prev => {
                                    const copy = prev.map(b => ({...b}));
                                    copy[idx][field] = field === 'ha' ? parseFloat(blocEditVal) || 0 : blocEditVal;
                                    saveBlocsToStorage(copy);
                                    return copy;
                                });
                                setEditBlocCell(null);
                            };
                            const isBlocEditing = (idx, field) => editBlocCell && editBlocCell.idx === idx && editBlocCell.field === field;

                            const blocCell = (idx, field, val, opts={}) => {
                                if (isBlocEditing(idx, field)) {
                                    return <input autoFocus value={blocEditVal} onChange={e => setBlocEditVal(e.target.value)}
                                        onBlur={saveBlocEdit} onKeyDown={e => e.key === 'Enter' && saveBlocEdit()}
                                        type={opts.type || 'text'}
                                        style={{width: opts.width || '100%', padding:'4px 6px', borderRadius:6, border:'2px solid var(--berry)', fontSize:11, textAlign: opts.align || 'left', fontWeight:600}} />;
                                }
                                return <span onClick={() => startBlocEdit(idx, field, val)}
                                    style={{cursor:'pointer', borderBottom:'1px dashed var(--gray-300)', ...opts.style}}
                                    title="Cliquez pour modifier">{val}</span>;
                            };

                            const addBloc = () => {
                                if (!newBloc.label.trim()) return;
                                const id = 'BLOC-' + newBloc.parcelle + '-' + newBloc.variete.replace(/\s+/g,'').substring(0,3).toUpperCase();
                                const ranchName = newBloc.ranch === '200742' ? 'R-Berry Good Farms SARL' : 'Berry Good Farms SARL 3';
                                const bloc = { ...newBloc, id, ranchName, treatment: '', treatmentWeek: '' };
                                setBlocsConf(prev => {
                                    const updated = [...prev, bloc];
                                    saveBlocsToStorage(updated);
                                    return updated;
                                });
                                setNewBloc({label:'', parcelle:'', variete:'', ferme:'F1', ranch:'200742', blockId:'', ha:0});
                                setShowAddBloc(false);
                            };

                            const removeBloc = (idx) => {
                                setBlocsConf(prev => {
                                    const updated = prev.filter((_, i) => i !== idx);
                                    saveBlocsToStorage(updated);
                                    return updated;
                                });
                            };

                            return (
                                <div>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Label</th>
                                                <th>Parcelle</th>
                                                <th>Variété</th>
                                                <th>Ferme</th>
                                                <th>Block ID</th>
                                                <th>Ha</th>
                                                <th>Ranch</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {blocsConf.map((b, i) => (
                                                <tr key={i}>
                                                    <td style={{fontWeight:600, color:'var(--berry)'}}>{blocCell(i, 'label', b.label)}</td>
                                                    <td>{blocCell(i, 'parcelle', b.parcelle, {width:'50px'})}</td>
                                                    <td>{blocCell(i, 'variete', b.variete)}</td>
                                                    <td>{blocCell(i, 'ferme', b.ferme, {width:'40px'})}</td>
                                                    <td style={{fontSize:10}}>{blocCell(i, 'blockId', b.blockId, {width:'80px'})}</td>
                                                    <td style={{fontWeight:700, color:'var(--green)'}}>{blocCell(i, 'ha', b.ha, {width:'50px', type:'number', align:'center'})}</td>
                                                    <td style={{fontSize:10, color:'var(--gray-400)'}}>{b.ranch === '200742' ? 'F1' : 'F5'} ({b.ranch})</td>
                                                    <td><button onClick={() => removeBloc(i)} style={{background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:12}} title="Supprimer"><i className="fa-solid fa-trash"></i></button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {showAddBloc ? (
                                        <div style={{marginTop:12, padding:12, background:'var(--gray-100)', borderRadius:8, display:'grid', gridTemplateColumns:'1fr 80px 1fr 60px 100px 60px 100px auto', gap:8, alignItems:'center', fontSize:11}}>
                                            <input placeholder="Label" value={newBloc.label} onChange={e => setNewBloc({...newBloc, label: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <input placeholder="Parc." value={newBloc.parcelle} onChange={e => setNewBloc({...newBloc, parcelle: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <input placeholder="Variété" value={newBloc.variete} onChange={e => setNewBloc({...newBloc, variete: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <select value={newBloc.ferme} onChange={e => setNewBloc({...newBloc, ferme: e.target.value, ranch: e.target.value === 'F1' ? '200742' : '200876'})} style={{padding:'6px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}}>
                                                <option value="F1">F1</option><option value="F5">F5</option>
                                            </select>
                                            <input placeholder="Block ID" value={newBloc.blockId} onChange={e => setNewBloc({...newBloc, blockId: e.target.value})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}} />
                                            <input placeholder="Ha" type="number" step="0.1" value={newBloc.ha || ''} onChange={e => setNewBloc({...newBloc, ha: parseFloat(e.target.value) || 0})} style={{padding:'6px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11, textAlign:'center'}} />
                                            <button className="btn-primary" onClick={addBloc} style={{padding:'6px 12px', fontSize:11}}>Ajouter</button>
                                            <button onClick={() => setShowAddBloc(false)} style={{background:'none', border:'none', color:'var(--gray-400)', cursor:'pointer'}}>✕</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setShowAddBloc(true)} style={{marginTop:10, padding:'8px 16px', background:'var(--berry-pale)', color:'var(--berry)', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
                                            <i className="fa-solid fa-plus"></i> Ajouter un bloc
                                        </button>
                                    )}
                                </div>
                            );
                        })()}
                    </Panel>

                    {/* Configuration Pénalités PFQ Interne */}
                    <Panel title="Pénalités PFQ Interne" icon="fa-vial">
                        <p style={{fontSize:'11px', color:'var(--gray-400)', marginBottom:'10px'}}>
                            <i className="fa-solid fa-pen"></i> Configurez les pénalités appliquées au calcul du PFQ Interne. Modifiez les valeurs puis cliquez Sauvegarder.
                        </p>
                        {(() => {
                            const defaultPFQConfig = {
                                conditionMax: 70,
                                apparenceMax: 20,
                                conditionMin: 60,
                                apparenceMin: 10,
                                defautsCondition: [
                                    { key: 'overripe', label: 'Fruit trop mûr (Overripe)', enabled: true, penalty: 700 },
                                    { key: 'wetLeaky', label: 'Fruit saignant (Wet Leaky)', enabled: true, penalty: 700 },
                                    { key: 'collapsed', label: 'Fruit mou (Collapsed)', enabled: true, penalty: 700 },
                                    { key: 'sootyMold', label: 'Cladosporium (Sooty Mold)', enabled: true, penalty: 500 },
                                    { key: 'yellowRust', label: 'Rouille jaune (Yellow Rust)', enabled: true, penalty: 500 },
                                ],
                                defautsApparence: [
                                    { key: 'size', label: 'Calibre < 3g (Size)', enabled: true, penalty: 400 },
                                    { key: 'pestDamage', label: 'Dégâts ravageurs (Pest Damage)', enabled: true, penalty: 400 },
                                    { key: 'windHeat', label: 'Dégâts vent/chaleur (Wind/Heat)', enabled: true, penalty: 400 },
                                    { key: 'whiteCells', label: 'Cellules blanches/sèches', enabled: true, penalty: 400 },
                                    { key: 'green', label: 'Immature (Green)', enabled: true, penalty: 700 },
                                    { key: 'broken', label: 'Cassé (Broken)', enabled: true, penalty: 400 },
                                    { key: 'malformed', label: 'Déformation (Malformed)', enabled: true, penalty: 400 },
                                    { key: 'windDamage', label: 'Dégâts du vent (Wind Damage)', enabled: true, penalty: 400 },
                                    { key: 'attachedCalyx', label: 'Avec pédoncule (Attached Calyx)', enabled: true, penalty: 400 },
                                    { key: 'decay', label: 'Pourriture (Decay)', enabled: true, penalty: 100000 },
                                    { key: 'drosophila', label: 'Larves drosophile (Fruit Fly)', enabled: true, penalty: 100000 },
                                ],
                            };
                            const [pfqConf, setPfqConf] = useState(() => {
                                try { const s = localStorage.getItem('pfqPenaltyConfig'); return s ? JSON.parse(s) : {...defaultPFQConfig}; } catch(e) { return {...defaultPFQConfig}; }
                            });
                            const [pfqSaved, setPfqSaved] = useState(false);

                            const savePfqConfig = () => {
                                localStorage.setItem('pfqPenaltyConfig', JSON.stringify(pfqConf));
                                setPfqSaved(true);
                                setTimeout(() => setPfqSaved(false), 2000);
                            };
                            const resetPfqConfig = () => {
                                setPfqConf({...defaultPFQConfig});
                                localStorage.removeItem('pfqPenaltyConfig');
                            };

                            const inputSt = { width:80, padding:'6px 8px', border:'1.5px solid var(--gray-200)', borderRadius:6, fontSize:13, textAlign:'center', fontWeight:700 };

                            return (
                                <div>
                                    {/* Scores Max / Min */}
                                    <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:16,marginBottom:20}}>
                                        <div style={{padding:14,background:'var(--berry-pale)',borderRadius:10,border:'1px solid rgba(139,34,82,0.2)'}}>
                                            <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600,marginBottom:6}}>PFQ Condition Max / Min</div>
                                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                                <input type="number" value={pfqConf.conditionMax} onChange={e => setPfqConf(p => ({...p, conditionMax: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--berry)'}} />
                                                <span style={{fontSize:11,color:'var(--gray-400)'}}>/</span>
                                                <input type="number" value={pfqConf.conditionMin != null ? pfqConf.conditionMin : 60} onChange={e => setPfqConf(p => ({...p, conditionMin: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--red)'}} />
                                            </div>
                                            <div style={{fontSize:9,color:'var(--gray-400)',marginTop:4}}>Max: /70 — Min: 60 (rejet)</div>
                                        </div>
                                        <div style={{padding:14,background:'var(--blue-pale)',borderRadius:10,border:'1px solid rgba(52,152,219,0.2)'}}>
                                            <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600,marginBottom:6}}>PFQ Apparence Max / Min</div>
                                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                                <input type="number" value={pfqConf.apparenceMax} onChange={e => setPfqConf(p => ({...p, apparenceMax: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--blue)'}} />
                                                <span style={{fontSize:11,color:'var(--gray-400)'}}>/</span>
                                                <input type="number" value={pfqConf.apparenceMin != null ? pfqConf.apparenceMin : 10} onChange={e => setPfqConf(p => ({...p, apparenceMin: parseInt(e.target.value)||0}))} style={{...inputSt,color:'var(--orange)'}} />
                                            </div>
                                            <div style={{fontSize:9,color:'var(--gray-400)',marginTop:4}}>Max: /20 — Min: 10 (rejet)</div>
                                        </div>
                                    </div>

                                    {/* Formule */}
                                    <div style={{padding:12,background:'var(--gray-50)',borderRadius:8,marginBottom:16,fontSize:11,color:'var(--gray-600)',lineHeight:1.6}}>
                                        <strong>Formule Excel Driscoll's:</strong><br/>
                                        PFQ = ((100 - Σ(fraction_i × pénalité_i)) / 100) × Max<br/>
                                        Chaque défaut a sa propre pénalité (modifiable ci-dessous).<br/>
                                        <span style={{color:'var(--red)',fontWeight:700}}>Rejet si</span>: Condition &lt; <span style={{fontWeight:700}}>{pfqConf.conditionMin || 60}</span> ou Apparence &lt; <span style={{fontWeight:700}}>{pfqConf.apparenceMin || 10}</span>
                                    </div>

                                    {/* Défauts avec pénalités individuelles */}
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:12,fontWeight:700,color:'var(--red)',marginBottom:8}}><i className="fa-solid fa-heart-pulse" style={{marginRight:6}}></i>Défauts Condition</div>
                                        {(pfqConf.defautsCondition || defaultPFQConfig.defautsCondition).map((d, i) => (
                                            <div key={d.key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid var(--gray-100)'}}>
                                                <input type="checkbox" checked={d.enabled !== false}
                                                    onChange={e => setPfqConf(p => {
                                                        const updated = {...p, defautsCondition: [...(p.defautsCondition || defaultPFQConfig.defautsCondition)]};
                                                        updated.defautsCondition[i] = {...updated.defautsCondition[i], enabled: e.target.checked};
                                                        return updated;
                                                    })} />
                                                <input value={d.label} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsCondition: [...(p.defautsCondition || defaultPFQConfig.defautsCondition)]};
                                                    updated.defautsCondition[i] = {...updated.defautsCondition[i], label: e.target.value};
                                                    return updated;
                                                })} style={{flex:1,padding:'4px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12}} />
                                                <input type="number" value={d.penalty || 700} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsCondition: [...(p.defautsCondition || defaultPFQConfig.defautsCondition)]};
                                                    updated.defautsCondition[i] = {...updated.defautsCondition[i], penalty: parseInt(e.target.value)||0};
                                                    return updated;
                                                })} style={{width:70,padding:'4px 6px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12,textAlign:'center',fontWeight:700,color:'var(--red)'}} />
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{marginBottom:16}}>
                                        <div style={{fontSize:12,fontWeight:700,color:'var(--orange)',marginBottom:8}}><i className="fa-solid fa-eye" style={{marginRight:6}}></i>Défauts Apparence</div>
                                        {(pfqConf.defautsApparence || defaultPFQConfig.defautsApparence).map((d, i) => (
                                            <div key={d.key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid var(--gray-100)'}}>
                                                <input type="checkbox" checked={d.enabled !== false}
                                                    onChange={e => setPfqConf(p => {
                                                        const updated = {...p, defautsApparence: [...(p.defautsApparence || defaultPFQConfig.defautsApparence)]};
                                                        updated.defautsApparence[i] = {...updated.defautsApparence[i], enabled: e.target.checked};
                                                        return updated;
                                                    })} />
                                                <input value={d.label} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsApparence: [...(p.defautsApparence || defaultPFQConfig.defautsApparence)]};
                                                    updated.defautsApparence[i] = {...updated.defautsApparence[i], label: e.target.value};
                                                    return updated;
                                                })} style={{flex:1,padding:'4px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12}} />
                                                <input type="number" value={d.penalty || 400} onChange={e => setPfqConf(p => {
                                                    const updated = {...p, defautsApparence: [...(p.defautsApparence || defaultPFQConfig.defautsApparence)]};
                                                    updated.defautsApparence[i] = {...updated.defautsApparence[i], penalty: parseInt(e.target.value)||0};
                                                    return updated;
                                                })} style={{width:70,padding:'4px 6px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12,textAlign:'center',fontWeight:700,color: (d.penalty||400) >= 100000 ? 'var(--red)' : 'var(--orange)'}} />
                                            </div>
                                        ))}
                                    </div>

                                    {/* Confections */}
                                    {(() => {
                                        const [confList, setConfList] = useState(() => {
                                            try { const s = localStorage.getItem('confectionTypes'); return s ? JSON.parse(s) : []; } catch(e) { return []; }
                                        });
                                        const [newConf, setNewConf] = useState('');
                                        const [confSaved, setConfSaved] = useState(false);
                                        return (
                                            <div style={{marginBottom:16,padding:14,background:'var(--gray-50)',borderRadius:10}}>
                                                <div style={{fontSize:12,fontWeight:700,color:'var(--berry)',marginBottom:8}}><i className="fa-solid fa-box" style={{marginRight:6}}></i>Types de Confection (dropdown PFQ)</div>
                                                <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8}}>Prérempli depuis les expéditions Driscoll's. Ajoutez/supprimez manuellement.</div>
                                                <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
                                                    {confList.map((c, i) => (
                                                        <span key={i} style={{padding:'4px 10px',background:'#fff',border:'1px solid var(--gray-200)',borderRadius:20,fontSize:11,display:'flex',alignItems:'center',gap:6}}>
                                                            {c}
                                                            <i className="fa-solid fa-xmark" style={{cursor:'pointer',color:'var(--red)',fontSize:10}} onClick={() => {
                                                                const updated = confList.filter((_,j) => j !== i);
                                                                setConfList(updated);
                                                                localStorage.setItem('confectionTypes', JSON.stringify(updated));
                                                            }}></i>
                                                        </span>
                                                    ))}
                                                </div>
                                                <div style={{display:'flex',gap:8}}>
                                                    <input placeholder="Nouvelle confection..." value={newConf} onChange={e => setNewConf(e.target.value)}
                                                        style={{flex:1,padding:'6px 10px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12}}
                                                        onKeyDown={e => { if (e.key === 'Enter' && newConf.trim()) { const updated = [...confList, newConf.trim()]; setConfList(updated); localStorage.setItem('confectionTypes', JSON.stringify(updated)); setNewConf(''); }}} />
                                                    <button onClick={() => { if (newConf.trim()) { const updated = [...confList, newConf.trim()]; setConfList(updated); localStorage.setItem('confectionTypes', JSON.stringify(updated)); setNewConf(''); }}}
                                                        style={{padding:'6px 14px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:6,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                                        <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Boutons */}
                                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                                        <button onClick={savePfqConfig} style={{padding:'10px 24px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer'}}>
                                            <i className="fa-solid fa-save" style={{marginRight:6}}></i>Sauvegarder PFQ
                                        </button>
                                        <button onClick={resetPfqConfig} style={{padding:'10px 24px',background:'var(--gray-200)',color:'var(--gray-600)',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
                                            <i className="fa-solid fa-rotate-right" style={{marginRight:6}}></i>Réinitialiser (Excel)
                                        </button>
                                        {pfqSaved && <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}><i className="fa-solid fa-check-circle" style={{marginRight:4}}></i>Sauvegardé !</span>}
                                    </div>
                                </div>
                            );
                        })()}
                    </Panel>

                    <BaremesPaiePanel />
                </div>
            );
        }

        function HorsRecolteSuiviTab({ data, farmFilter, avoSubFilter }) {
            const [filterFerme, setFilterFerme] = useState(farmFilter || 'F5');
            const [filterParcelle, setFilterParcelle] = useState('');
            const [tunnelsData, setTunnelsData] = useState({});
            const [progressData, setProgressData] = useState([]);
            const [normesData, setNormesData] = useState([]);
            const [normProposals, setNormProposals] = useState([]);
            const [todaySaisies, setTodaySaisies] = useState([]);
            const [loading, setLoading] = useState(true);
            const [dateStr, setDateStr] = useState('');

            const isAvocatier = filterFerme === 'Avocatier';

            const getNbTotal = (parcelleName) => {
                const norm = normalizeParcelle(parcelleName);
                if (norm) {
                    const pc = PARCELLES_CULTURALES.find(p => p.variete === norm.variete && p.ferme === norm.ferme && p.sousVariete === norm.sousVariete && p.cycle === getCycle(new Date().toISOString().slice(0,10)));
                    if (pc) return isAvocatier ? (pc.nbLignes || 0) : (pc.nbTunnels || 0);
                }
                if (isAvocatier) {
                    const avo = data.avocatierConfig || {};
                    for (const farm of Object.values(avo)) { const found = farm.find(p => p.nom === parcelleName); if (found) return found.nbLignes; }
                    return 0;
                }
                const pc = data.parcelleConfig[filterFerme] || [];
                const found = pc.find(p => p.nom === parcelleName);
                return found ? found.nbTunnels : 0;
            };

            const getNorme = (tache) => {
                const found = normesData.find(n => n.tache === tache);
                return found ? (found.normeParJourParOuvrier || found.normeTunnelsParJourParOuvrier || 0) : 0;
            };

            const loadData = (ferme) => {
                setLoading(true);
                const fq = ferme ? `&ferme=${ferme}` : '';
                Promise.all([
                    cachedFetch(`/api/validation?action=suivi-tunnels${fq}`),
                    fetch(`/api/hors-recolte-suivi?action=get-progress${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=get-normes${fq}`).then(r => r.json()),
                    fetch(`/api/hors-recolte-suivi?action=detect-norm-adjustments`).then(r => r.json()).catch(() => ({ success: false })),
                    fetch(`/api/hors-recolte-suivi?action=get-saisies-today${fq}`).then(r => r.json()).catch(() => ({ success: false })),
                ]).then(([sqlRes, firestoreRes, normRes, detectRes, saisieRes]) => {
                    if (sqlRes.success) { setTunnelsData(sqlRes.tunnels || {}); setDateStr(sqlRes.date || ''); }
                    if (firestoreRes.success) setProgressData(firestoreRes.progress || []);
                    if (normRes.success) setNormesData(normRes.normes || []);
                    if (detectRes.success) setNormProposals(detectRes.proposals || []);
                    if (saisieRes.success) setTodaySaisies(saisieRes.saisies || []);
                }).catch(() => {}).finally(() => setLoading(false));
            };

            React.useEffect(() => { loadData(filterFerme); }, [filterFerme]);

            const rows = tunnelsData[filterFerme] || [];
            const filteredRows = filterParcelle ? rows.filter(r => r.parcelle === filterParcelle) : rows;
            const parcelles = [...new Set(rows.map(r => r.parcelle))];

            const getCumulFromFirestore = (parcelle, tache) => {
                return progressData.find(p => p.parcelle === parcelle && p.tache === tache)
                    || progressData.find(p => p.parcelle === displayParcelle(parcelle) && p.tache === tache);
            };

            // Get today's saisie from Firestore (what the caporal entered)
            const getSaisieAuj = (parcelle, tache) => {
                const dp = displayParcelle(parcelle);
                const found = todaySaisies.find(s => s.parcelle === parcelle && s.tache === tache)
                    || todaySaisies.find(s => s.parcelle === dp && s.tache === tache);
                return found ? (found.nbRealise || 0) : 0;
            };

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin fa-2x"></i><div style={{marginTop:12}}>Chargement...</div></div>;

            // KPIs
            let totalOps = filteredRows.length, nbTermine = 0, rendSum = 0, rendCount = 0;
            filteredRows.forEach(r => {
                const nbTotal = getNbTotal(r.parcelle);
                const cumul = getCumulFromFirestore(r.parcelle, r.tache);
                const totalR = cumul ? cumul.totalRealise : r.totalRealise;
                if (cumul && cumul.termine) nbTermine++;
                else if (nbTotal > 0 && totalR >= nbTotal) nbTermine++;
                const norme = getNorme(r.tache);
                const attendu = norme > 0 ? r.nbOuvriers * norme : 0;
                const realAuj = getSaisieAuj(r.parcelle, r.tache) || r.realiseAujourdhui;
                if (attendu > 0 && realAuj > 0) { rendSum += (realAuj / attendu) * 100; rendCount++; }
            });
            const avgRend = rendCount > 0 ? Math.round(rendSum / rendCount) : 0;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', gap:12, marginBottom:16, alignItems:'center', flexWrap:'wrap'}}>
                        {!farmFilter && (
                        <select value={filterFerme} onChange={e => {setFilterFerme(e.target.value); setFilterParcelle('');}} style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}>
                            <option value="F1">Ferme F1</option>
                            <option value="F5">Ferme F5</option>
                            <option value="Avocatier">Avocatier</option>
                        </select>
                        )}
                        <select value={filterParcelle} onChange={e => setFilterParcelle(e.target.value)} style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12}}>
                            <option value="">Toutes parcelles</option>
                            {parcelles.map((p, i) => <option key={i} value={p}>{displayParcelle(p)}</option>)}
                        </select>
                        <span style={{fontSize:11,color:'var(--gray-400)'}}>{dateStr}</span>
                    </div>

                    {/* KPI Cards */}
                    <div className="kpi-grid" style={{marginBottom:20}}>
                        <KPICard icon="fa-list-check" iconClass="berry" value={totalOps} label="Opérations du jour" />
                        <KPICard icon="fa-circle-check" iconClass="green" value={nbTermine} label="Tâches terminées" />
                        <KPICard icon="fa-gauge-high" iconClass={avgRend >= 100 ? 'green' : avgRend >= 60 ? 'gold' : 'red'} value={avgRend > 0 ? `${avgRend}%` : '—'} label="Rendement moyen vs norme" />
                        {normProposals.length > 0 && <KPICard icon="fa-arrow-trend-up" iconClass="blue" value={normProposals.length} label="Normes à réviser" />}
                    </div>

                    {/* Norm proposals alert */}
                    {normProposals.length > 0 && (
                        <Panel title="Propositions de révision de normes" icon="fa-arrow-trend-up">
                            {normProposals.map((p, i) => (
                                <div key={i} style={{padding:10, background:'rgba(52,152,219,0.05)', borderRadius:8, marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                    <div>
                                        <span style={{fontWeight:700, fontSize:12}}>{p.tache}</span>
                                        <span style={{fontSize:10, color:'var(--gray-400)', marginLeft:8}}>{p.ferme}</span>
                                    </div>
                                    <div style={{textAlign:'right'}}>
                                        <span style={{fontSize:11, color:'var(--berry)', fontWeight:700}}>{p.currentNorm} → {p.proposedNorm}</span>
                                        <div style={{fontSize:9, color:'var(--gray-400)'}}>Moy. {p.avgRatio}% sur {p.daysAnalyzed}j ({p.avgWorkers} ouv.)</div>
                                    </div>
                                </div>
                            ))}
                        </Panel>
                    )}

                    <Panel title={`Suivi Hors-Récolte ${filterFerme}`} icon="fa-chart-gantt">
                        {filteredRows.length === 0 ? (
                            <div style={{textAlign:'center',padding:24,color:'var(--gray-400)',fontSize:13}}>
                                <i className="fa-solid fa-inbox" style={{fontSize:24,marginBottom:8,display:'block'}}></i>
                                Aucune opération hors-récolte pour cette date
                            </div>
                        ) : (
                        <table className="data-table" style={{fontSize:11}}>
                            <thead>
                                <tr>
                                    <th>Parcelle</th>
                                    <th>Tâche</th>
                                    <th style={{textAlign:'center'}}>Nb Ouv.</th>
                                    <th style={{textAlign:'right'}}>Réalisé Auj.</th>
                                    <th style={{textAlign:'right'}}>Cumul</th>
                                    <th style={{textAlign:'right'}}>{isAvocatier ? 'Total Lignes' : 'Total Tunnels'}</th>
                                    <th style={{width:140}}>Progression</th>
                                    <th style={{textAlign:'center'}}>Norme</th>
                                    <th style={{textAlign:'center'}}>Rendement</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((r, i) => {
                                    const nbTotal = getNbTotal(r.parcelle);
                                    const firestoreCumul = getCumulFromFirestore(r.parcelle, r.tache);
                                    const totalRealise = firestoreCumul ? firestoreCumul.totalRealise : r.totalRealise;
                                    const pct = nbTotal > 0 ? Math.min(100, Math.round(totalRealise / nbTotal * 100)) : 0;
                                    const norme = getNorme(r.tache);
                                    const attendu = norme > 0 ? r.nbOuvriers * norme : 0;
                                    const realAuj = getSaisieAuj(r.parcelle, r.tache) || r.realiseAujourdhui;
                                    const rendPct = attendu > 0 ? Math.round(realAuj / attendu * 100) : 0;
                                    const isTermine = firestoreCumul ? firestoreCumul.termine : (nbTotal > 0 && totalRealise >= nbTotal);

                                    return (
                                        <tr key={i} style={{background: isTermine ? 'rgba(46,204,113,0.04)' : undefined}}>
                                            <td style={{fontWeight:600}}>{displayParcelle(r.parcelle)}</td>
                                            <td style={{fontSize:10}}>{r.tache}</td>
                                            <td style={{textAlign:'center'}}>{r.nbOuvriers}</td>
                                            <td style={{textAlign:'right', fontWeight:600, color: realAuj > 0 ? 'var(--green)' : 'var(--gray-300)'}}>{realAuj || 0}</td>
                                            <td style={{textAlign:'right', fontWeight:600}}>{totalRealise}</td>
                                            <td style={{textAlign:'right', color:'var(--gray-400)'}}>{nbTotal || '—'}</td>
                                            <td>
                                                {nbTotal > 0 ? (
                                                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                                                        <div style={{flex:1, height:8, background:'var(--gray-200)', borderRadius:4, overflow:'hidden'}}>
                                                            <div style={{width:`${pct}%`, height:'100%', borderRadius:4, transition:'width 0.3s',
                                                                background: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}} />
                                                        </div>
                                                        <span style={{fontSize:9, fontWeight:700, minWidth:28, textAlign:'right',
                                                            color: pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--berry)'}}>{pct}%</span>
                                                    </div>
                                                ) : <span style={{color:'var(--gray-300)', fontSize:10}}>—</span>}
                                            </td>
                                            <td style={{textAlign:'center', fontSize:9, color:'var(--gray-400)'}}>{norme > 0 ? norme : '—'}</td>
                                            <td style={{textAlign:'center'}}>
                                                {attendu > 0 ? (
                                                    <span style={{fontSize:9, padding:'2px 8px', borderRadius:8, fontWeight:700,
                                                        background: rendPct >= 100 ? 'rgba(46,204,113,0.1)' : rendPct >= 80 ? 'rgba(52,152,219,0.1)' : rendPct >= 60 ? 'rgba(243,156,18,0.1)' : 'rgba(231,76,60,0.1)',
                                                        color: rendPct >= 100 ? 'var(--green)' : rendPct >= 80 ? 'var(--blue)' : rendPct >= 60 ? 'var(--orange)' : 'var(--red)'}}>
                                                        {rendPct}%
                                                    </span>
                                                ) : <span style={{color:'var(--gray-300)', fontSize:10}}>—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        )}
                    </Panel>
                </div>
            );
        }


export {
  PointageTab,
  PointageValidationViewWrapper,
  CoutRecolteTab,
  PrimesRecolteTab,
  loadPointageDistinctDays,
  BaremesPaiePanel,
  PaieTab,
  HeuresSupSub,
  SousTraitantsConfigPanel,
  JoursFeriesConfigPanel,
  ParametresTab,
  HorsRecolteSuiviTab
};
