/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualiteBonsApportTab */
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== BONS D'APPORT TAB =====================
        function QualiteBonsApportTab({ data, userProfile }) {
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };
            const blocIds = data.blocIds || [];
            const isAdmin = userProfile?.role === 'admin';
            const [bonsApport, setBonsApport] = useState([]);
            const [expeditions, setExpeditions] = useState([]);
            const [selectedBon, setSelectedBon] = useState(null);
            const [loading, setLoading] = useState(true);
            const [filterDate, setFilterDate] = useState('');
            const [filterBloc, setFilterBloc] = useState('');
            const [activeView, setActiveView] = useState('bons'); // 'bons' | 'mapping'
            const [showBulkUpload, setShowBulkUpload] = useState(false);
            const [bulkParsed, setBulkParsed] = useState([]);
            const [deleteReason, setDeleteReason] = useState('');
            const [showDeleteConfirm, setShowDeleteConfirm] = useState(null); // bon to delete
            const [deleteRequests, setDeleteRequests] = useState(() => {
                try { return JSON.parse(localStorage.getItem('pfq_delete_requests') || '[]'); } catch(e) { return []; }
            });
            const [alerts, setAlerts] = useState([]);

            // Load alerts for expedition_manquante
            React.useEffect(() => {
                const loadAlerts = async () => {
                    try {
                        const profile = userProfile?.id || '';
                        const resp = await fetch('/api/alerts?action=list&profile=' + profile);
                        const json = await resp.json();
                        if (json.success) setAlerts(json.alerts || []);
                    } catch(e) { console.warn('Alerts load error:', e); }
                };
                loadAlerts();
            }, [userProfile]);

            const markAlertRead = async (alertId) => {
                const profile = userProfile?.id || '';
                try {
                    await fetch('/api/alerts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'mark-read', alertId, profile })
                    });
                    setAlerts(prev => prev.filter(a => a.id !== alertId));
                    window._refreshNotifications?.();
                } catch(e) { console.warn('Mark alert read error:', e); }
            };

            // Normalize variety name for matching
            const normalizeVariety = (v) => (v || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

            // Parse expedition date (MM/DD/YYYY HH:MM GMT) to YYYY-MM-DD
            const parseExpDate = (raw) => {
                if (!raw) return '';
                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return m[3] + '-' + m[1] + '-' + m[2];
                if (raw.length >= 10 && raw[4] === '-') return raw.slice(0, 10);
                return '';
            };

            // Get next day YYYY-MM-DD
            const nextDay = (dateStr) => {
                if (!dateStr) return '';
                const d = new Date(dateStr + 'T12:00:00');
                if (isNaN(d.getTime())) return '';
                d.setDate(d.getDate() + 1);
                return d.toISOString().split('T')[0];
            };

            // ====== DELETE REQUEST ======
            const requestDelete = (bon) => {
                setShowDeleteConfirm(bon);
            };

            const submitDeleteRequest = (reason) => {
                const req = {
                    id: 'del_' + Date.now(),
                    bonId: showDeleteConfirm.id,
                    bonApport: showDeleteConfirm.bonApport,
                    date: showDeleteConfirm.date,
                    blocVariete: showDeleteConfirm.blocVariete || '',
                    requestedBy: userProfile?.displayName || userProfile?.email || 'unknown',
                    requestedAt: new Date().toISOString(),
                    status: 'pending',
                    reason: reason,
                };
                const updated = [...deleteRequests, req];
                setDeleteRequests(updated);
                localStorage.setItem('pfq_delete_requests', JSON.stringify(updated));
                setShowDeleteConfirm(null);
                alert('Demande de suppression envoyée au DG pour validation.');
            };

            const approveDelete = async (reqId) => {
                const req = deleteRequests.find(r => r.id === reqId);
                if (!req) return;
                try {
                    const localPFQs = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                    localStorage.setItem('pfq_interne_local', JSON.stringify(localPFQs.filter(b => b.id !== req.bonId)));
                } catch(e) {}
                try {
                    if (typeof firebase !== 'undefined' && firebase.firestore && !req.bonId.startsWith('local_') && !req.bonId.startsWith('bulk_')) {
                        await firebase.firestore().collection('pfq_interne').doc(req.bonId).delete();
                    }
                } catch(e) { console.error('Firestore delete error:', e); }
                const updated = deleteRequests.map(r => r.id === reqId ? { ...r, status: 'approved', approvedBy: userProfile?.displayName || userProfile?.email, approvedAt: new Date().toISOString() } : r);
                setDeleteRequests(updated);
                localStorage.setItem('pfq_delete_requests', JSON.stringify(updated));
                setBonsApport(prev => prev.filter(b => b.id !== req.bonId));
            };

            const rejectDelete = (reqId) => {
                const updated = deleteRequests.map(r => r.id === reqId ? { ...r, status: 'rejected', rejectedBy: userProfile?.displayName || userProfile?.email, rejectedAt: new Date().toISOString() } : r);
                setDeleteRequests(updated);
                localStorage.setItem('pfq_delete_requests', JSON.stringify(updated));
            };

            const pendingDeletes = deleteRequests.filter(r => r.status === 'pending');

            // ====== BULK UPLOAD ======
            const bulkFileRef = React.useRef(null);

            const handleBulkFile = (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const wb = XLSX.read(ev.target.result, { type: 'binary' });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        const parsed = rows.map((r, i) => {
                            const bonNum = r['N° Bon'] || r['Bon'] || r['bonApport'] || r['N°'] || r['Numero'] || r['numero'] || '';
                            const date = r['Date'] || r['date'] || '';
                            const variete = r['Variété'] || r['Variete'] || r['variete'] || r['variety'] || '';
                            const ferme = r['Ferme'] || r['ferme'] || r['Farm'] || '';
                            const bloc = r['Bloc'] || r['bloc'] || r['Block'] || '';
                            const poids = parseFloat(r['Poids'] || r['poids'] || r['Poids (kg)'] || r['Weight'] || 0);
                            const confection = r['Confection'] || r['confection'] || '';
                            let dateISO = '';
                            if (typeof date === 'number') {
                                const dt = new Date((date - 25569) * 86400 * 1000);
                                dateISO = dt.toISOString().split('T')[0];
                            } else if (typeof date === 'string') {
                                const dm = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                                if (dm) dateISO = dm[3] + '-' + dm[2] + '-' + dm[1];
                                else if (date.match(/^\d{4}-\d{2}-\d{2}$/)) dateISO = date;
                                else dateISO = date;
                            }
                            return { _row: i + 1, bonApport: String(bonNum).trim(), date: dateISO, blocVariete: variete, blocFerme: ferme, blocLabel: bloc, poidsLot: poids, confection, _valid: !!String(bonNum).trim() };
                        }).filter(r => r._valid);
                        setBulkParsed(parsed);
                    } catch(err) { alert('Erreur de lecture du fichier: ' + err.message); }
                };
                reader.readAsBinaryString(file);
            };

            const saveBulkBons = async () => {
                if (bulkParsed.length === 0) return;
                if (userProfile?.role !== 'admin') { alert('Accès réservé aux administrateurs'); return; }

                // Dédup composite (même logique que handleReimportSituation)
                const seen = new Set();
                const deduped = [];
                let idx = 0;
                for (const b of bulkParsed) {
                    const key = `${b.bonApport}_${b.blocLabel || b.blocVariete}_${b.poidsLot}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    idx++;
                    deduped.push({
                        id: `bulk_prod_${b.bonApport}_${idx}`,
                        bonApport: b.bonApport, date: b.date, blocVariete: b.blocVariete,
                        blocFerme: b.blocFerme, blocLabel: b.blocLabel, poidsLot: b.poidsLot,
                        confection: b.confection, controleur: '', bloc: '',
                        pfqGlobal: null, barquettes: [], totalFruits: 0,
                        source: 'bulk_upload',
                        createdAt: new Date().toISOString(),
                        createdBy: userProfile?.displayName || userProfile?.email || 'unknown',
                    });
                }
                if (deduped.length === 0) { alert('Aucun bon valide à importer.'); return; }

                // Supprimer TOUS les anciens docs bulk_upload (ne touche PAS manual_entry/scan_ocr)
                try {
                    const db = firebase.firestore();
                    let totalDeleted = 0;
                    while (true) {
                        const snap = await db.collection('pfq_interne').where('source', '==', 'bulk_upload').limit(500).get();
                        if (snap.empty) break;
                        const delBatch = db.batch();
                        snap.docs.forEach(doc => delBatch.delete(doc.ref));
                        await delBatch.commit();
                        totalDeleted += snap.size;
                    }
                    console.log(`[Bulk Import] Deleted ${totalDeleted} old bulk_upload docs`);
                } catch(e) { console.error('Delete old bulk:', e); }

                // Batch write avec .set() (idempotent, pas de doublons)
                try {
                    const db = firebase.firestore();
                    let batch = db.batch();
                    let batchCount = 0;
                    for (const bon of deduped) {
                        const { id, _row, _valid, ...rec } = bon;
                        batch.set(db.collection('pfq_interne').doc(id), rec);
                        batchCount++;
                        if (batchCount >= 499) { await batch.commit(); batch = db.batch(); batchCount = 0; }
                    }
                    if (batchCount > 0) await batch.commit();
                } catch(e) { console.error('Bulk save:', e); alert('Erreur Firestore: ' + e.message); return; }

                // Notifier les autres appareils (sync temps réel via onSnapshot)
                try {
                    await firebase.firestore().collection('app_settings').doc('pfq_import_meta').set({
                        lastImportTime: Date.now(),
                        lastImportCount: deduped.length,
                        lastImportBy: userProfile?.displayName || userProfile?.email || 'unknown',
                    });
                } catch(e) { console.warn('Meta update skipped:', e); }

                // Recharger depuis Firestore (source de vérité)
                try {
                    const freshBons = await loadBonsFromFirestore();
                    setBonsApport(freshBons);
                } catch(e) { console.error('Reload after import:', e); }

                setBulkParsed([]);
                setShowBulkUpload(false);
                alert(deduped.length + " bon(s) importé(s) avec succès.");
            };

            useEffect(() => {
                const loadAll = async () => {
                    setLoading(true);
                    let allBons = [];
                    try { allBons = await loadBonsFromFirestore(); } catch(e) { console.error('Error loading bons:', e); }
                    allBons.sort((a, b) => (b.date || b.createdAt || '') > (a.date || a.createdAt || '') ? 1 : -1);
                    setBonsApport(allBons);

                    // Load expeditions
                    try {
                        const json = await cachedFetch('/api/email-analysis?action=expeditions&limit=2000');
                        if (json.success && json.expeditions) {
                            setExpeditions(json.expeditions.map(e => ({
                                ...e,
                                dateISO: parseExpDate(e.date),
                                ferme: ranchToFerme[e.ranch] || e.ranch || '-',
                            })));
                        }
                    } catch(e) { console.error('Error loading expeditions:', e); }
                    setLoading(false);
                };
                loadAll();
            }, []);

            // ====== MAPPING LOGIC ======
            const buildMapping = () => {
                const matched = [];      // { bon, expedition, matchType }
                const unmatchedBons = []; // bons sans expédition
                const unmatchedExps = []; // expéditions sans bon
                const duplicates = [];   // bons matchés à la même expédition

                // Track which expeditions have been matched
                const expMatchedIds = new Set();
                const expMatchCountById = {};

                // Strict matching: exact day + exact variety + quantity ±2%
                // Build index of available expeditions by date+variety for fast lookup
                const expByDateVariety = {};
                expeditions.forEach(exp => {
                    const key = (exp.dateISO || '') + '|' + normalizeVariety(exp.variety);
                    if (!expByDateVariety[key]) expByDateVariety[key] = [];
                    expByDateVariety[key].push(exp);
                });

                // Track which expeditions are already taken (1:1 matching)
                const takenExpIds = new Set();

                bonsApport.forEach(bon => {
                    const bonDate = bon.date || '';
                    const bonVariety = normalizeVariety(bon.blocVariete);
                    const bonWeight = parseFloat(bon.poidsLot) || 0;

                    const key = bonDate + '|' + bonVariety;
                    const candidates = expByDateVariety[key] || [];

                    let bestMatch = null;
                    let bestRatio = 0;

                    candidates.forEach(exp => {
                        if (takenExpIds.has(exp.id)) return;
                        const expWeight = parseFloat(exp.batchWeight) || 0;
                        if (bonWeight <= 0 || expWeight <= 0) return;
                        const ratio = Math.min(bonWeight, expWeight) / Math.max(bonWeight, expWeight);
                        if (ratio >= 0.98 && ratio > bestRatio) {
                            bestRatio = ratio;
                            bestMatch = exp;
                        }
                    });

                    if (bestMatch) {
                        matched.push({
                            bon,
                            expedition: bestMatch,
                            matchType: 'exact',
                            details: ['jour exact', 'variété exacte', 'poids ' + Math.round(bestRatio * 100) + '%']
                        });
                        takenExpIds.add(bestMatch.id);
                        expMatchedIds.add(bestMatch.id);
                        expMatchCountById[bestMatch.id] = (expMatchCountById[bestMatch.id] || 0) + 1;
                    } else {
                        unmatchedBons.push(bon);
                    }
                });

                // Detect duplicates: multiple bons matched to same expedition
                Object.entries(expMatchCountById).forEach(([eid, count]) => {
                    if (count > 1) {
                        const dups = matched.filter(m => m.expedition.id === eid);
                        duplicates.push({ expeditionId: eid, expedition: dups[0].expedition, bons: dups.map(d => d.bon), count });
                    }
                });

                // Unmatched expeditions (only recent ones, last 30 days)
                const cutoff30 = new Date();
                cutoff30.setDate(cutoff30.getDate() - 30);
                const cutoffStr = cutoff30.toISOString().split('T')[0];
                expeditions.forEach(exp => {
                    if (!expMatchedIds.has(exp.id) && exp.dateISO >= cutoffStr) {
                        unmatchedExps.push(exp);
                    }
                });

                return { matched, unmatchedBons, unmatchedExps, duplicates };
            };

            const mapping = React.useMemo(() => {
                if (bonsApport.length === 0 && expeditions.length === 0) return { matched: [], unmatchedBons: [], unmatchedExps: [], duplicates: [] };
                return buildMapping();
            }, [bonsApport, expeditions]);

            const filteredBons = bonsApport.filter(b => {
                if (filterDate && b.date !== filterDate) return false;
                if (filterBloc) {
                    const q = filterBloc.toLowerCase();
                    const matchLabel = (b.blocLabel || '').toLowerCase().includes(q);
                    const matchVariete = (b.blocVariete || '').toLowerCase().includes(q);
                    const matchFerme = (b.blocFerme || '').toLowerCase().includes(q);
                    const matchBon = (b.bonApport || '').toLowerCase().includes(q);
                    if (!matchLabel && !matchVariete && !matchFerme && !matchBon) return false;
                }
                return true;
            });

            const getPFQColor = (val) => {
                if (val == null) return 'var(--gray-400)';
                if (val >= 80) return 'var(--green)';
                if (val >= 60) return 'var(--orange)';
                return 'var(--red)';
            };

            // ====== DETAIL VIEW ======
            if (selectedBon) {
                const bon = selectedBon;
                const validBarq = (bon.barquettes || []).filter(b => b.nbFruits > 0);
                const totalFruits = bon.totalFruits || validBarq.reduce((s, b) => s + (b.nbFruits || 0), 0);
                const avgFruitsPerPunnet = validBarq.length > 0 ? Math.round(totalFruits / validBarq.length * 10) / 10 : 0;
                const avgPunnetWeight = validBarq.length > 0 ? Math.round(validBarq.reduce((s, b) => s + (b.poids || 0), 0) / validBarq.length * 10) / 10 : 0;
                // Find matched expedition for this bon
                const matchedExp = mapping.matched.find(m => m.bon.id === bon.id);

                return (
                    <div className="tab-content fade-in">
                        <Panel title={`Bon d'Apport — ${bon.bonApport}`} icon="fa-file-invoice" actions={
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={() => requestDelete(bon)} style={{padding:'6px 14px',background:'rgba(231,76,60,0.1)',color:'var(--red)',border:'1px solid var(--red)',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                    <i className="fa-solid fa-trash" style={{marginRight:6}}></i>Supprimer
                                </button>
                                <button onClick={() => setSelectedBon(null)} style={{padding:'6px 14px',background:'var(--gray-200)',color:'var(--gray-700)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                    <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i>Retour
                                </button>
                            </div>
                        }>
                            <div style={{padding:20}}>
                                {/* Header */}
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:0,marginBottom:20,border:'1px solid var(--gray-200)',borderRadius:10,overflow:'hidden',fontSize:12}}>
                                    <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:0}}>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Berry</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>RASPBERRY</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Variété</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{bon.blocVariete || '-'}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Bloc</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{bon.blocLabel || '-'}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderRight:'1px solid var(--gray-200)'}}>Ferme</div>
                                        <div style={{padding:'8px 14px',fontWeight:700}}>{bon.blocFerme || '-'}</div>
                                    </div>
                                    <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:0,borderLeft:'1px solid var(--gray-200)'}}>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>N° Bon</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{bon.bonApport}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Confection</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{bon.confection || '-'}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Date</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{bon.date}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderRight:'1px solid var(--gray-200)'}}>Contrôleur</div>
                                        <div style={{padding:'8px 14px',fontWeight:700}}>{bon.controleur || '-'}</div>
                                    </div>
                                </div>

                                {/* Expedition match info */}
                                {matchedExp && (
                                    <div style={{padding:12,background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.3)',borderRadius:10,marginBottom:16,fontSize:12}}>
                                        <div style={{fontWeight:700,color:'var(--blue)',marginBottom:6,display:'flex',alignItems:'center',gap:6}}>
                                            <i className="fa-solid fa-link"></i> Expédition Driscoll's associée
                                            <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'var(--green-pale)',color:'var(--green)'}}>Match exact</span>
                                        </div>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8}}>
                                            <div><span style={{color:'var(--gray-500)'}}>RID:</span> <strong>{matchedExp.expedition.receiptId || '-'}</strong></div>
                                            <div><span style={{color:'var(--gray-500)'}}>Variété:</span> <strong>{matchedExp.expedition.variety || '-'}</strong></div>
                                            <div><span style={{color:'var(--gray-500)'}}>Poids:</span> <strong>{matchedExp.expedition.batchWeight || '-'} kg</strong></div>
                                            <div><span style={{color:'var(--gray-500)'}}>Date:</span> <strong>{matchedExp.expedition.dateISO || '-'}</strong></div>
                                        </div>
                                        <div style={{marginTop:6,fontSize:10,color:'var(--gray-500)'}}>Critères: {matchedExp.details.join(', ')}</div>
                                    </div>
                                )}

                                {/* PFQ Scores */}
                                {bon.pfqGlobal?.rejet && (
                                    <div style={{padding:'10px 14px',background:'rgba(231,76,60,0.1)',border:'2px solid var(--red)',borderRadius:10,marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
                                        <i className="fa-solid fa-triangle-exclamation" style={{fontSize:18,color:'var(--red)'}}></i>
                                        <div style={{fontWeight:700,color:'var(--red)',fontSize:13}}>LOT REJETÉ</div>
                                    </div>
                                )}
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:20}}>
                                    <div style={{textAlign:'center',padding:16,background:'var(--berry-pale)',borderRadius:12}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Condition</div>
                                        <div style={{fontSize:28,fontWeight:800,color:getPFQColor(bon.pfqGlobal?.etat)}}>{bon.pfqGlobal?.etat?.toFixed(1) || '-'}</div>
                                        <div style={{fontSize:11,color:'var(--gray-400)'}}>/70</div>
                                    </div>
                                    <div style={{textAlign:'center',padding:16,background:'var(--blue-pale)',borderRadius:12}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Apparence</div>
                                        <div style={{fontSize:28,fontWeight:800,color:getPFQColor(bon.pfqGlobal?.apparence != null ? bon.pfqGlobal.apparence * 3.5 : null)}}>{bon.pfqGlobal?.apparence?.toFixed(1) || '-'}</div>
                                        <div style={{fontSize:11,color:'var(--gray-400)'}}>/20</div>
                                    </div>
                                    <div style={{textAlign:'center',padding:16,borderRadius:12,border:'2px solid '+getPFQColor(bon.pfqGlobal?.final)}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Final</div>
                                        <div style={{fontSize:32,fontWeight:800,color:getPFQColor(bon.pfqGlobal?.final)}}>{bon.pfqGlobal?.final?.toFixed(1) || '-'}</div>
                                        <div style={{fontSize:11,color:'var(--gray-400)'}}>/90</div>
                                    </div>
                                </div>

                                {/* Détails barquettes */}
                                <table className="data-table" style={{fontSize:12,marginBottom:20}}>
                                    <thead><tr><th>Barq #</th><th style={{textAlign:'center'}}>Poids (g)</th><th style={{textAlign:'center'}}>Nb Fruits</th><th style={{textAlign:'center'}}>Calibre (g)</th></tr></thead>
                                    <tbody>
                                        {(bon.barquettes || []).map((b, i) => (
                                            <tr key={i}><td>Barquette {b.numero || i+1}</td><td style={{textAlign:'center'}}>{b.poids}</td><td style={{textAlign:'center'}}>{b.nbFruits}</td><td style={{textAlign:'center'}}>{b.calibre?.toFixed(2) || '-'}</td></tr>
                                        ))}
                                    </tbody>
                                </table>

                                {/* Résumé */}
                                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginBottom:20}}>
                                    <div style={{textAlign:'center',padding:10,background:'var(--gray-50)',borderRadius:8}}><div style={{fontSize:9,color:'var(--gray-500)'}}>Poids Lot</div><div style={{fontSize:16,fontWeight:700}}>{bon.poidsLot || '-'} kg</div></div>
                                    <div style={{textAlign:'center',padding:10,background:'var(--gray-50)',borderRadius:8}}><div style={{fontSize:9,color:'var(--gray-500)'}}>Barquettes</div><div style={{fontSize:16,fontWeight:700}}>{validBarq.length}</div></div>
                                    <div style={{textAlign:'center',padding:10,background:'var(--gray-50)',borderRadius:8}}><div style={{fontSize:9,color:'var(--gray-500)'}}>Moy Fruits</div><div style={{fontSize:16,fontWeight:700}}>{avgFruitsPerPunnet}</div></div>
                                    <div style={{textAlign:'center',padding:10,background:'var(--gray-50)',borderRadius:8}}><div style={{fontSize:9,color:'var(--gray-500)'}}>Moy Poids</div><div style={{fontSize:16,fontWeight:700}}>{avgPunnetWeight}g</div></div>
                                    <div style={{textAlign:'center',padding:10,background:'var(--gray-50)',borderRadius:8}}><div style={{fontSize:9,color:'var(--gray-500)'}}>Total Fruits</div><div style={{fontSize:16,fontWeight:700}}>{totalFruits}</div></div>
                                </div>

                                {/* Scan photo */}
                                {bon.scanPhoto && (
                                    <div style={{marginBottom:20}}>
                                        <div style={{fontSize:12,fontWeight:700,color:'var(--berry)',marginBottom:8}}>
                                            <i className="fa-solid fa-camera" style={{marginRight:6}}></i>Scan du Bon d'Apport Physique
                                        </div>
                                        <img src={bon.scanPhoto} alt="Scan" style={{width:'100%',maxHeight:500,objectFit:'contain',borderRadius:10,border:'1px solid var(--gray-200)'}} />
                                    </div>
                                )}

                                {/* Signature */}
                                <div style={{padding:14,background:'var(--gray-100)',borderRadius:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div style={{fontSize:12,color:'var(--gray-500)'}}>Contrôleur: <strong>{bon.controleur || '-'}</strong></div>
                                    <div style={{fontFamily:'"Brush Script MT","Segoe Script","Dancing Script",cursive',fontSize:22,color:'var(--berry)',fontWeight:700}}>
                                        {bon.controleur || ''}
                                    </div>
                                </div>
                            </div>
                        </Panel>
                    </div>
                );
            }

            // ====== MAPPING VIEW ======
            const renderMappingView = () => {
                const { matched, unmatchedBons, unmatchedExps, duplicates } = mapping;
                const totalBons = bonsApport.length;
                const matchedCount = matched.length;
                const coverage = totalBons > 0 ? Math.round(matchedCount / totalBons * 100) : 0;
                const exactMatches = matched.length;

                return (
                    <div>
                        {/* KPIs */}
                        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:20}}>
                            <div style={{textAlign:'center',padding:14,background:'var(--berry-pale)',borderRadius:12}}>
                                <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600}}>Bons d'Apport</div>
                                <div style={{fontSize:24,fontWeight:800,color:'var(--berry)'}}>{totalBons}</div>
                            </div>
                            <div style={{textAlign:'center',padding:14,background:'var(--green-pale)',borderRadius:12}}>
                                <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600}}>Matchés</div>
                                <div style={{fontSize:24,fontWeight:800,color:'var(--green)'}}>{matchedCount}</div>
                                <div style={{fontSize:9,color:'var(--gray-400)'}}>exact</div>
                            </div>
                            <div style={{textAlign:'center',padding:14,background: unmatchedBons.length > 0 ? 'rgba(231,76,60,0.08)' : 'var(--gray-50)',borderRadius:12}}>
                                <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600}}>Bons sans expéd.</div>
                                <div style={{fontSize:24,fontWeight:800,color: unmatchedBons.length > 0 ? 'var(--red)' : 'var(--green)'}}>{unmatchedBons.length}</div>
                            </div>
                            <div style={{textAlign:'center',padding:14,background: unmatchedExps.length > 0 ? 'rgba(212,168,71,0.1)' : 'var(--gray-50)',borderRadius:12}}>
                                <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600}}>Expéd. sans bon</div>
                                <div style={{fontSize:24,fontWeight:800,color: unmatchedExps.length > 0 ? '#b8860b' : 'var(--green)'}}>{unmatchedExps.length}</div>
                            </div>
                            <div style={{textAlign:'center',padding:14,background: duplicates.length > 0 ? 'rgba(231,76,60,0.08)' : 'var(--gray-50)',borderRadius:12}}>
                                <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600}}>Doublons</div>
                                <div style={{fontSize:24,fontWeight:800,color: duplicates.length > 0 ? 'var(--red)' : 'var(--green)'}}>{duplicates.length}</div>
                            </div>
                        </div>

                        {/* Couverture bar */}
                        <div style={{marginBottom:20,padding:12,background:'var(--gray-50)',borderRadius:10}}>
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                                <span style={{fontSize:11,fontWeight:600,color:'var(--gray-600)'}}>Couverture PFQ Interne</span>
                                <span style={{fontSize:11,fontWeight:700,color: coverage >= 80 ? 'var(--green)' : coverage >= 50 ? '#b8860b' : 'var(--red)'}}>{coverage}%</span>
                            </div>
                            <div style={{height:8,background:'var(--gray-200)',borderRadius:4,overflow:'hidden'}}>
                                <div style={{height:'100%',width: coverage + '%',background: coverage >= 80 ? 'var(--green)' : coverage >= 50 ? 'var(--gold)' : 'var(--red)',borderRadius:4,transition:'width 0.5s'}}></div>
                            </div>
                        </div>

                        {/* Duplicates alert */}
                        {duplicates.length > 0 && (
                            <div style={{padding:12,background:'rgba(231,76,60,0.08)',border:'1.5px solid var(--red)',borderRadius:10,marginBottom:16}}>
                                <div style={{fontWeight:700,color:'var(--red)',fontSize:12,marginBottom:8}}>
                                    <i className="fa-solid fa-clone" style={{marginRight:6}}></i>Doublons détectés — Plusieurs bons matchés à la même expédition
                                </div>
                                {duplicates.map((dup, i) => (
                                    <div key={i} style={{fontSize:11,padding:'6px 10px',background:'rgba(255,255,255,0.7)',borderRadius:6,marginBottom:4}}>
                                        <strong>{dup.expedition.variety}</strong> — {dup.expedition.dateISO} — {dup.expedition.batchWeight} kg
                                        <span style={{color:'var(--gray-500)'}}> → {dup.count} bons: </span>
                                        {dup.bons.map(b => b.bonApport).join(', ')}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Matched table */}
                        <div style={{fontSize:13,fontWeight:700,color:'var(--berry)',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-link"></i> Correspondances ({matchedCount})
                        </div>
                        <div className="table-responsive">
                        <table className="data-table" style={{fontSize:11,marginBottom:20}}>
                            <thead>
                                <tr>
                                    <th colSpan="4" style={{background:'var(--berry-pale)',color:'var(--berry)',textAlign:'center',fontSize:10}}>Bon d'Apport (Interne)</th>
                                    <th colSpan="4" style={{background:'rgba(52,152,219,0.1)',color:'var(--blue)',textAlign:'center',fontSize:10}}>Expédition Driscoll's</th>
                                    <th style={{textAlign:'center'}}>Match</th>
                                </tr>
                                <tr>
                                    <th>Date</th><th>N° Bon</th><th>Variété</th><th style={{textAlign:'right'}}>Poids (kg)</th>
                                    <th>Date</th><th>RID</th><th>Variété</th><th style={{textAlign:'right'}}>Poids (kg)</th>
                                    <th style={{textAlign:'center'}}>Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {matched.map((m, i) => (
                                    <tr key={i} onClick={() => setSelectedBon(m.bon)} style={{cursor:'pointer'}}>
                                        <td>{m.bon.date}</td>
                                        <td style={{fontWeight:600}}>{m.bon.bonApport}</td>
                                        <td>{m.bon.blocVariete || '-'}</td>
                                        <td style={{textAlign:'right'}}>{m.bon.poidsLot || '-'}</td>
                                        <td>{m.expedition.dateISO}</td>
                                        <td style={{fontWeight:600,fontSize:10}}>{m.expedition.receiptId || (m.expedition.source === 'auto-created' ? <span style={{color:'#f39c12'}}>Provisoire</span> : '-')}</td>
                                        <td>{m.expedition.variety || '-'}</td>
                                        <td style={{textAlign:'right'}}>{m.expedition.batchWeight || '-'}</td>
                                        <td style={{textAlign:'center'}}>
                                            <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,
                                                background:'var(--green-pale)',color:'var(--green)'
                                            }}>
                                                <i className="fa-solid fa-check" style={{marginRight:3,fontSize:8}}></i>Exact
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {matched.length === 0 && <tr><td colSpan="9" style={{textAlign:'center',color:'var(--gray-400)',padding:20}}>Aucune correspondance</td></tr>}
                            </tbody>
                        </table>
                        </div>

                        {/* Unmatched Bons */}
                        {unmatchedBons.length > 0 && (
                            <div>
                                <div style={{fontSize:13,fontWeight:700,color:'var(--red)',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                                    <i className="fa-solid fa-file-circle-exclamation"></i> Bons sans expédition ({unmatchedBons.length})
                                </div>
                                <table className="data-table" style={{fontSize:11,marginBottom:20}}>
                                    <thead><tr><th>Date</th><th>N° Bon</th><th>Variété</th><th>Ferme</th><th style={{textAlign:'right'}}>Poids (kg)</th><th style={{textAlign:'center'}}>PFQ</th></tr></thead>
                                    <tbody>
                                        {unmatchedBons.map((bon, i) => (
                                            <tr key={i} onClick={() => setSelectedBon(bon)} style={{cursor:'pointer',background:'rgba(231,76,60,0.03)'}}>
                                                <td>{bon.date}</td>
                                                <td style={{fontWeight:600}}>{bon.bonApport}</td>
                                                <td>{bon.blocVariete || '-'}</td>
                                                <td>{bon.blocFerme || '-'}</td>
                                                <td style={{textAlign:'right'}}>{bon.poidsLot || '-'}</td>
                                                <td style={{textAlign:'center',fontWeight:700,color:getPFQColor(bon.pfqGlobal?.final)}}>{bon.pfqGlobal?.final?.toFixed(1) || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Unmatched Expeditions — potentially missing bons */}
                        {unmatchedExps.length > 0 && (
                            <div>
                                <div style={{fontSize:13,fontWeight:700,color:'#b8860b',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                                    <i className="fa-solid fa-truck-fast"></i> Expéditions sans bon d'apport ({unmatchedExps.length})
                                    <span style={{fontSize:10,fontWeight:400,color:'var(--gray-500)'}}>— 30 derniers jours</span>
                                </div>
                                <div className="table-responsive">
                                <table className="data-table" style={{fontSize:11,marginBottom:20}}>
                                    <thead><tr><th>Date</th><th>RID</th><th>Variété</th><th>Ferme</th><th style={{textAlign:'right'}}>Poids (kg)</th><th>Confection</th><th style={{textAlign:'center'}}>Résultat</th></tr></thead>
                                    <tbody>
                                        {unmatchedExps.slice(0, 50).map((exp, i) => (
                                            <tr key={i} style={{background:'rgba(212,168,71,0.04)'}}>
                                                <td>{exp.dateISO}</td>
                                                <td style={{fontWeight:600,fontSize:10}}>{exp.receiptId || '-'}</td>
                                                <td>{exp.variety || '-'}</td>
                                                <td>{exp.ferme}</td>
                                                <td style={{textAlign:'right'}}>{exp.batchWeight || '-'}</td>
                                                <td style={{fontSize:10}}>{exp.itemDescription || '-'}</td>
                                                <td style={{textAlign:'center'}}>
                                                    <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,
                                                        background: (exp.overallResult || '').toUpperCase() === 'PASS' ? 'var(--green-pale)' : 'rgba(231,76,60,0.1)',
                                                        color: (exp.overallResult || '').toUpperCase() === 'PASS' ? 'var(--green)' : 'var(--red)'
                                                    }}>{exp.overallResult || '-'}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                                {unmatchedExps.length > 50 && <div style={{fontSize:11,color:'var(--gray-400)',textAlign:'center',marginBottom:16}}>... et {unmatchedExps.length - 50} autres</div>}
                            </div>
                        )}
                    </div>
                );
            };

            // ====== MAIN VIEW ======
            return (
                <div className="tab-content fade-in">
                    {/* View toggle */}
                    <div style={{display:'flex',gap:4,marginBottom:16,background:'var(--gray-100)',borderRadius:10,padding:3}}>
                        <button onClick={() => setActiveView('bons')} style={{flex:1,padding:'8px 16px',borderRadius:8,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',
                            background: activeView === 'bons' ? '#fff' : 'transparent', color: activeView === 'bons' ? 'var(--berry)' : 'var(--gray-500)',
                            boxShadow: activeView === 'bons' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}}>
                            <i className="fa-solid fa-file-invoice" style={{marginRight:6}}></i>Bons d'Apport
                        </button>
                        <button onClick={() => setActiveView('mapping')} style={{flex:1,padding:'8px 16px',borderRadius:8,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',
                            background: activeView === 'mapping' ? '#fff' : 'transparent', color: activeView === 'mapping' ? 'var(--berry)' : 'var(--gray-500)',
                            boxShadow: activeView === 'mapping' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}}>
                            <i className="fa-solid fa-arrows-left-right" style={{marginRight:6}}></i>Mapping Expéditions
                            {mapping.unmatchedExps.length > 0 && <span style={{marginLeft:6,padding:'1px 6px',borderRadius:8,background:'var(--red)',color:'#fff',fontSize:9,fontWeight:700}}>{mapping.unmatchedExps.length}</span>}
                        </button>
                    </div>

                    {/* Pending delete requests — visible by admin/DG */}
                    {isAdmin && pendingDeletes.length > 0 && (
                        <Panel title={`Demandes de suppression (${pendingDeletes.length})`} icon="fa-trash-can">
                            <table className="data-table" style={{fontSize:12}}>
                                <thead><tr><th>N° Bon</th><th>Date</th><th>Variété</th><th>Demandé par</th><th>Raison</th><th>Date demande</th><th style={{textAlign:'center'}}>Actions</th></tr></thead>
                                <tbody>
                                    {pendingDeletes.map(req => (
                                        <tr key={req.id} style={{background:'rgba(231,76,60,0.03)'}}>
                                            <td style={{fontWeight:700}}>{req.bonApport}</td>
                                            <td>{req.date}</td>
                                            <td>{req.blocVariete || '-'}</td>
                                            <td>{req.requestedBy}</td>
                                            <td style={{fontSize:11,maxWidth:200}}>{req.reason || '-'}</td>
                                            <td style={{fontSize:11}}>{new Date(req.requestedAt).toLocaleString('fr-FR')}</td>
                                            <td style={{textAlign:'center'}}>
                                                <div style={{display:'flex',gap:6,justifyContent:'center'}}>
                                                    <button onClick={() => approveDelete(req.id)} style={{padding:'4px 10px',background:'var(--red)',color:'#fff',border:'none',borderRadius:6,fontSize:11,cursor:'pointer',fontWeight:600}}>
                                                        <i className="fa-solid fa-check" style={{marginRight:4}}></i>Approuver
                                                    </button>
                                                    <button onClick={() => rejectDelete(req.id)} style={{padding:'4px 10px',background:'var(--gray-200)',color:'var(--gray-700)',border:'none',borderRadius:6,fontSize:11,cursor:'pointer',fontWeight:600}}>
                                                        <i className="fa-solid fa-xmark" style={{marginRight:4}}></i>Refuser
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>
                    )}

                    {/* ====== ALERTS BANNER ====== */}
                    {alerts.length > 0 && (
                        <div style={{marginBottom:16}}>
                            {alerts.map(alert => (
                                <div key={alert.id} style={{padding:'12px 16px',background: alert.severity === 'critical' ? 'rgba(231,76,60,0.1)' : 'rgba(243,156,18,0.1)',border: '1px solid ' + (alert.severity === 'critical' ? 'rgba(231,76,60,0.3)' : 'rgba(243,156,18,0.3)'),borderRadius:10,marginBottom:8,display:'flex',alignItems:'flex-start',gap:12,fontSize:12}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{fontSize:16,color: alert.severity === 'critical' ? 'var(--red)' : '#f39c12',marginTop:2}}></i>
                                    <div style={{flex:1}}>
                                        <div style={{fontWeight:700,color: alert.severity === 'critical' ? 'var(--red)' : '#856404',marginBottom:4}}>
                                            {alert.type === 'expedition_manquante' ? 'Expéditions manquantes' : 'Alerte'}
                                        </div>
                                        <div style={{color:'var(--gray-700)'}}>{alert.message}</div>
                                        <div style={{marginTop:4,fontSize:10,color:'var(--gray-400)'}}>
                                            {alert.createdAt ? new Date(alert.createdAt).toLocaleString('fr-FR') : ''}
                                            {alert.autoCreatedCount > 0 && <span> — {alert.autoCreatedCount} expédition(s) provisoire(s) créée(s)</span>}
                                        </div>
                                    </div>
                                    <button onClick={() => markAlertRead(alert.id)} style={{padding:'4px 10px',background:'rgba(0,0,0,0.05)',border:'none',borderRadius:6,fontSize:10,cursor:'pointer',color:'var(--gray-500)',fontWeight:600,whiteSpace:'nowrap'}}>
                                        <i className="fa-solid fa-check" style={{marginRight:4}}></i>Lu
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeView === 'mapping' ? (
                        <Panel title="Mapping Bons d'Apport ↔ Expéditions Driscoll's" icon="fa-arrows-left-right">
                            {loading ? (
                                <div style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,marginBottom:8}}></i><div>Chargement...</div></div>
                            ) : renderMappingView()}
                        </Panel>
                    ) : (
                        <Panel title="Bons d'Apport" icon="fa-file-invoice" actions={
                            <div style={{display:'flex',gap:8,alignItems:'center',fontSize:12,flexWrap:'wrap'}}>
                                {userProfile?.role === 'admin' && <button onClick={() => setShowBulkUpload(true)} style={{padding:'5px 12px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,fontSize:11,cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                                    <i className="fa-solid fa-file-arrow-up"></i>Import Excel
                                </button>}
                                <button onClick={() => setFilterDate('')} style={{padding:'4px 10px',borderRadius:6,border: !filterDate ? '2px solid var(--berry)' : '1px solid var(--gray-200)',background: !filterDate ? 'var(--berry-pale)' : 'white',cursor:'pointer',fontSize:11,fontWeight:!filterDate?700:400,color:!filterDate?'var(--berry)':'var(--gray-600)'}}>Toutes</button>
                                <button onClick={() => { const d = new Date((filterDate || new Date().toISOString().slice(0,10)) + 'T12:00:00'); d.setDate(d.getDate()-1); setFilterDate(d.toISOString().slice(0,10)); }} style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12}}><i className="fa-solid fa-chevron-left"></i></button>
                                <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{padding:'4px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12}} />
                                <button onClick={() => { const d = new Date((filterDate || new Date().toISOString().slice(0,10)) + 'T12:00:00'); d.setDate(d.getDate()+1); setFilterDate(d.toISOString().slice(0,10)); }} style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:12}}><i className="fa-solid fa-chevron-right"></i></button>
                                <input placeholder="Filtrer bloc..." value={filterBloc} onChange={e => setFilterBloc(e.target.value)} style={{padding:'4px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontSize:12,width:120}} />
                            </div>
                        }>
                            {loading ? (
                                <div style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}>
                                    <i className="fa-solid fa-spinner fa-spin" style={{fontSize:24,marginBottom:8}}></i>
                                    <div>Chargement...</div>
                                </div>
                            ) : filteredBons.length === 0 ? (
                                <div style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}>
                                    <i className="fa-solid fa-file-circle-xmark" style={{fontSize:32,marginBottom:8}}></i>
                                    <div>Aucun bon d'apport trouvé</div>
                                </div>
                            ) : (
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>N° Bon</th>
                                            <th>Variété</th>
                                            <th>Ferme</th>
                                            <th style={{textAlign:'right'}}>Poids (kg)</th>
                                            <th style={{textAlign:'center'}}>PFQ</th>
                                            <th style={{textAlign:'center'}}>Source</th>
                                            <th style={{textAlign:'center'}}>Expéd.</th>
                                            <th style={{textAlign:'center'}}>Scan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredBons.map((bon, i) => {
                                            const matchInfo = mapping.matched.find(m => m.bon.id === bon.id);
                                            const isPending = deleteRequests.some(r => r.bonId === bon.id && r.status === 'pending');
                                            return (
                                                <tr key={bon.id || i} onClick={() => setSelectedBon(bon)} style={{cursor:'pointer',opacity: isPending ? 0.5 : 1,textDecoration: isPending ? 'line-through' : 'none'}}>
                                                    <td>{bon.date || '-'}</td>
                                                    <td style={{fontWeight:700}}>{bon.bonApport || '-'}</td>
                                                    <td>{bon.blocVariete || '-'}</td>
                                                    <td>{bon.blocFerme || '-'}</td>
                                                    <td style={{textAlign:'right'}}>{bon.poidsLot || '-'}</td>
                                                    <td style={{textAlign:'center',fontWeight:700,color:getPFQColor(bon.pfqGlobal?.final)}}>
                                                        {bon.pfqGlobal ? (bon.pfqGlobal.final?.toFixed(1) || '-') : <span style={{fontSize:10,color:'var(--gray-400)'}}>—</span>}
                                                    </td>
                                                    <td style={{textAlign:'center'}}>
                                                        {bon.source === 'bulk_upload' ? (
                                                            <span style={{padding:'2px 8px',background:'rgba(52,152,219,0.1)',color:'var(--blue)',borderRadius:10,fontSize:10,fontWeight:600}}>Import</span>
                                                        ) : (
                                                            <span style={{padding:'2px 8px',background:'var(--berry-pale)',color:'var(--berry)',borderRadius:10,fontSize:10,fontWeight:600}}>PFQ</span>
                                                        )}
                                                    </td>
                                                    <td style={{textAlign:'center'}}>
                                                        {matchInfo ? (
                                                            <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',background:'rgba(39,174,96,0.1)',borderRadius:10,fontSize:10,fontWeight:600,color:'var(--green)'}}>
                                                                <i className="fa-solid fa-link" style={{fontSize:9}}></i>
                                                                {matchInfo.expedition.receiptId || 'OK'}
                                                            </span>
                                                        ) : (
                                                            <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',background:'rgba(231,76,60,0.1)',borderRadius:10,fontSize:10,fontWeight:600,color:'var(--red)'}}>
                                                                <i className="fa-solid fa-link-slash" style={{fontSize:9}}></i>
                                                                Non apparié
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{textAlign:'center'}}>
                                                        {bon.scanPhoto ? <i className="fa-solid fa-image" style={{color:'var(--green)'}}></i> : <i className="fa-solid fa-minus" style={{color:'var(--gray-300)'}}></i>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </Panel>
                    )}

                    {/* ====== DELETE CONFIRM MODAL ====== */}
                    {showDeleteConfirm && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => { setShowDeleteConfirm(null); setDeleteReason(''); }}>
                            <div style={{background:'#fff',borderRadius:16,padding:24,maxWidth:420,width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{textAlign:'center',marginBottom:16}}>
                                    <div style={{width:48,height:48,borderRadius:'50%',background:'rgba(231,76,60,0.1)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}>
                                        <i className="fa-solid fa-trash" style={{fontSize:22,color:'var(--red)'}}></i>
                                    </div>
                                    <h3 style={{margin:0,color:'var(--red)',fontSize:16}}>Demande de suppression</h3>
                                    <p style={{margin:'6px 0 0',color:'var(--gray-500)',fontSize:12}}>
                                        Bon <strong>{showDeleteConfirm.bonApport}</strong> du {showDeleteConfirm.date}
                                    </p>
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:11,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:4}}>Motif de suppression *</label>
                                    <textarea value={deleteReason} onChange={e => setDeleteReason(e.target.value)} placeholder="Saisir le motif..." rows={3}
                                        style={{width:'100%',padding:'8px 12px',border:'1.5px solid var(--gray-200)',borderRadius:8,fontSize:13,outline:'none',resize:'vertical',fontFamily:'inherit'}} />
                                </div>
                                <div style={{padding:10,background:'rgba(212,168,71,0.1)',borderRadius:8,marginBottom:16,fontSize:11,color:'#856404'}}>
                                    <i className="fa-solid fa-shield-halved" style={{marginRight:6}}></i>
                                    Cette demande sera soumise au DG pour validation avant suppression effective.
                                </div>
                                <div style={{display:'flex',gap:8}}>
                                    <button onClick={() => { setShowDeleteConfirm(null); setDeleteReason(''); }} style={{flex:1,padding:'10px',background:'var(--gray-200)',color:'var(--gray-700)',border:'none',borderRadius:10,fontSize:13,cursor:'pointer',fontWeight:600}}>
                                        Annuler
                                    </button>
                                    <button onClick={() => { if (!deleteReason.trim()) { alert('Veuillez saisir un motif'); return; } submitDeleteRequest(deleteReason.trim()); setDeleteReason(''); }}
                                        style={{flex:1,padding:'10px',background:'var(--red)',color:'#fff',border:'none',borderRadius:10,fontSize:13,cursor:'pointer',fontWeight:600}}>
                                        <i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>Envoyer
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ====== BULK UPLOAD MODAL ====== */}
                    {showBulkUpload && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => { setShowBulkUpload(false); setBulkParsed([]); }}>
                            <div style={{background:'#fff',borderRadius:16,padding:24,maxWidth:700,width:'100%',maxHeight:'80vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                    <h3 style={{margin:0,color:'var(--berry)',fontSize:16}}>
                                        <i className="fa-solid fa-file-arrow-up" style={{marginRight:8}}></i>Import en masse — Bons d'Apport
                                    </h3>
                                    <button onClick={() => { setShowBulkUpload(false); setBulkParsed([]); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--gray-400)'}}><i className="fa-solid fa-xmark"></i></button>
                                </div>

                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,marginBottom:16,fontSize:12,color:'var(--gray-600)'}}>
                                    <div style={{fontWeight:700,marginBottom:6}}>Format du fichier Excel (.xlsx)</div>
                                    <div>Colonnes attendues : <strong>N° Bon</strong>, <strong>Date</strong> (JJ/MM/AAAA), <strong>Variété</strong>, <strong>Ferme</strong>, <strong>Bloc</strong>, <strong>Poids</strong> (kg), <strong>Confection</strong></div>
                                    <div style={{marginTop:4,fontSize:11,color:'var(--gray-400)'}}>Les bons importés n'auront pas de PFQ interne associé. Seul le N° Bon est obligatoire.</div>
                                </div>

                                <div style={{marginBottom:16}}>
                                    <input type="file" accept=".xlsx,.xls,.csv" ref={bulkFileRef} onChange={handleBulkFile} style={{display:'none'}} />
                                    <button onClick={() => bulkFileRef.current?.click()} style={{padding:'10px 20px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:10,fontSize:13,cursor:'pointer',fontWeight:600,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                                        <i className="fa-solid fa-folder-open"></i> Sélectionner un fichier Excel
                                    </button>
                                </div>

                                {bulkParsed.length > 0 && (
                                    <div>
                                        <div style={{fontSize:12,fontWeight:700,color:'var(--green)',marginBottom:8}}>
                                            <i className="fa-solid fa-check-circle" style={{marginRight:6}}></i>{bulkParsed.length} bon(s) détecté(s)
                                        </div>
                                        <div style={{maxHeight:300,overflow:'auto',marginBottom:16}}>
                                            <table className="data-table" style={{fontSize:11}}>
                                                <thead><tr><th>#</th><th>N° Bon</th><th>Date</th><th>Variété</th><th>Ferme</th><th>Bloc</th><th style={{textAlign:'right'}}>Poids</th></tr></thead>
                                                <tbody>
                                                    {bulkParsed.map((b, i) => (
                                                        <tr key={i}>
                                                            <td style={{color:'var(--gray-400)'}}>{b._row}</td>
                                                            <td style={{fontWeight:700}}>{b.bonApport}</td>
                                                            <td>{b.date || '-'}</td>
                                                            <td>{b.blocVariete || '-'}</td>
                                                            <td>{b.blocFerme || '-'}</td>
                                                            <td>{b.blocLabel || '-'}</td>
                                                            <td style={{textAlign:'right'}}>{b.poidsLot || '-'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <button onClick={saveBulkBons} style={{padding:'10px 20px',background:'var(--green)',color:'#fff',border:'none',borderRadius:10,fontSize:13,cursor:'pointer',fontWeight:600,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                                            <i className="fa-solid fa-cloud-arrow-up"></i> Importer {bulkParsed.length} bon(s) d'apport
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { QualiteBonsApportTab };
