/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualiteProductionTab */
import { computeMomentum } from '../agronomie/computeMomentum.jsx';
import { getCycle } from '../agronomie/getCycle.jsx';
import { getHaByCycle } from '../agronomie/getHaByCycle.jsx';
import { getPlantsByCycle } from '../agronomie/getPlantsByCycle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { BUDGET_BGF } from '../finance/BUDGET_BGF.jsx';
import { computeAtterrissage } from '../finance/computeAtterrissage.jsx';
import { computeBudgetWeekly } from '../finance/computeBudgetWeekly.jsx';
import { computeProjection } from '../finance/computeProjection.jsx';
import { importBudgetExcel } from '../finance/importBudgetExcel.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { getCurrentWeekNumber } from '../shared/getCurrentWeekNumber.jsx';
import { __set_bonsCache, loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useState } from '../shared/reactHooks.jsx';

// ===================== QUALITE PRODUCTION TAB =====================
        function QualiteProductionTab({ data, applyVarietyMapping, forceFerme, hideCycle1, userProfile, cycle2OnlyView }) {
            const [bonsApport, setBonsApport] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedFerme, setSelectedFerme] = useState(forceFerme || '');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [selectedCycle, setSelectedCycle] = useState(hideCycle1 ? 2 : 0); // 0=Tous, 1=Cycle1, 2=Cycle2
            const [selectedTypeVente, setSelectedTypeVente] = useState('Export'); // '', 'Export', 'Marché Local'
            const [selectedClient, setSelectedClient] = useState(''); // '' or client name
            const [kpiPopup, setKpiPopup] = useState(null); // null or 'tonnage'|'tha'|'bons'|'varietes'|'jours'
            const [selectedBon, setSelectedBon] = useState(null); // bon d'apport detail view
            const [popupBonsFilter, setPopupBonsFilter] = useState(null); // { type:'variety'|'day'|'week', value:... }
            const [chartMode, setChartMode] = useState('total'); // 'total' or 'tha'
            const [weekChartMode, setWeekChartMode] = useState('kgha'); // 'total' or 'kgha'
            const [showEcarts, setShowEcarts] = useState(false);
            const [importing, setImporting] = useState(false);
            const [showImportModal, setShowImportModal] = useState(false);
            const [dragOver, setDragOver] = useState(false);
            const reimportFileRef = React.useRef(null);
            const budgetFileRef = React.useRef(null);
            const dayChartScrollRef = React.useRef(null);
            const weekChartScrollRef = React.useRef(null);
            const [budgetImportMsg, setBudgetImportMsg] = useState(null);
            const [estimationMode, setEstimationMode] = useState(false);
            const [expeditionsEst, setExpeditionsEst] = useState([]);
            const [expeditionsLoading, setExpeditionsLoading] = useState(false);
            const [selectedDate, setSelectedDate] = useState('');

            // Handler: Réimporter Situation Production (Excel)
            const handleReimportSituation = async (eOrFile) => {
                const file = eOrFile instanceof File ? eOrFile : eOrFile.target.files?.[0];
                if (!file) return;
                setShowImportModal(false);
                setImporting(true);
                try {
                    const data = await file.arrayBuffer();
                    const wb = XLSX.read(data, { type: 'array' });
                    const SHEETS_CFG = [
                        { name: 'SITUATION EXPORT 2025-2026', defaultTypeVente: 'Export' },
                        { name: 'SITUATION LOCAL 2025-2026 ', defaultTypeVente: null },
                    ];
                    const allParsed = [];
                    const transportRows = []; // {date, matricule, voyage} captured from SITUATION EXPORT
                    for (const sheetCfg of SHEETS_CFG) {
                        let ws = wb.Sheets[sheetCfg.name];
                        if (!ws) ws = wb.Sheets[sheetCfg.name.trim()];
                        if (!ws) {
                            const target = sheetCfg.name.trim().toUpperCase();
                            const match = Object.entries(wb.Sheets).find(([k]) => k.trim().toUpperCase() === target);
                            if (match) ws = match[1];
                        }
                        if (!ws) {
                            alert(`ATTENTION: Feuille "${sheetCfg.name.trim()}" introuvable dans le fichier Excel.\nFeuilles disponibles: ${wb.SheetNames.join(', ')}\nLes données de cette feuille ne seront PAS importées.`);
                            continue;
                        }
                        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                        for (const row of rows) {
                            const bonNum = String(row[6] || '').trim();
                            if (!bonNum || isNaN(parseInt(bonNum))) continue;
                            const rowType = String(row[1] || '').trim();
                            if (rowType === 'ENC' || rowType === 'DÉC') continue;
                            const semaine = String(row[0] || '').trim();
                            const sousType = String(row[2] || '').trim();
                            const client = String(row[3] || '').trim();
                            const rawFerme = String(row[4] || '').replace('F-0', 'F').replace('F-', 'F').trim();
                            const rawDate = row[5];
                            let dateISO = '';
                            if (typeof rawDate === 'number') { dateISO = new Date((rawDate - 25569) * 86400 * 1000).toISOString().split('T')[0]; }
                            else if (typeof rawDate === 'string') { const dm = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); dateISO = dm ? dm[3]+'-'+dm[2]+'-'+dm[1] : rawDate; }
                            const designation = String(row[7] || '').trim();
                            const poids = parseFloat(row[8]) || 0;
                            const prixDH = parseFloat(row[9]) || 0;
                            const totalDH = parseFloat(row[10]) || 0;
                            // Capture transport fruit info (matricule + N-V) from SITUATION EXPORT only
                            if (sheetCfg.name === 'SITUATION EXPORT 2025-2026') {
                                const matricule = String(row[11] || '').trim().toUpperCase();
                                const voyage = String(row[12] || '').trim().toUpperCase();
                                if (matricule && voyage && dateISO) {
                                    transportRows.push({ date: dateISO, matricule, voyage });
                                }
                            }
                            // Extract variety
                            const dUp = designation.toUpperCase();
                            // Skip non-fruit rows (déchets, emballages, etc.)
                            const SKIP_DESIGNATIONS = ['DECHET','PLASTIQUE','EMBALLAGE','PALETTE','CARTON VIDE','BOIS'];
                            if (SKIP_DESIGNATIONS.some(s => dUp.includes(s))) continue;
                            const varNames = ['YAZMIN','REYNA','MARAVILLA','AITANA','ADELITA','ROCIERA','BREEZE','CORINA','HASS','FUERTE','CASCADE'];
                            let variete = '';
                            for (const v of varNames) { if (dUp.includes(v)) { variete = v.charAt(0) + v.slice(1).toLowerCase(); break; } }
                            if (!variete) { const p = designation.trim().split(/\s+/); variete = p.length >= 2 ? p[1].charAt(0).toUpperCase()+p[1].slice(1).toLowerCase() : designation; }
                            // Determine typeVente
                            let typeVente;
                            if (sheetCfg.defaultTypeVente) { typeVente = sheetCfg.defaultTypeVente; }
                            else { typeVente = rowType === 'ECRT' ? 'Marché Local' : rowType === 'EXP' ? 'Export' : rowType || 'LOCAL'; }
                            allParsed.push({
                                bonApport: bonNum, date: dateISO, blocVariete: variete, blocFerme: rawFerme,
                                blocLabel: designation, poidsLot: poids, prixDH, totalDH, sousType, confection: '',
                                controleur: '', bloc: '', semaine: semaine, client, designation, typeVente,
                                pfqGlobal: null, barquettes: [], totalFruits: 0, source: 'bulk_upload',
                                createdBy: 'Import Situation Production',
                            });
                        }
                    }
                    // Dedup by bonApport_designation
                    const seen = new Set();
                    const deduped = [];
                    let idx = 0;
                    for (const bon of allParsed) {
                        const key = `${bon.bonApport}_${bon.designation}_${bon.poidsLot}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        idx++;
                        deduped.push({ id: `bulk_prod_${bon.bonApport.replace(/\//g, '-')}_${idx}`, ...bon, createdAt: new Date().toISOString() });
                    }
                    // Save to localStorage
                    try { localStorage.setItem('pfq_interne_local', JSON.stringify(deduped)); } catch(err) {}
                    // Save to Firestore (replace ALL pfq_interne bulk_upload docs)
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            // Delete ALL existing bulk_upload docs (loop until empty)
                            let totalDeleted = 0;
                            while (true) {
                                const snap = await db.collection('pfq_interne').where('source', '==', 'bulk_upload').limit(500).get();
                                if (snap.empty) break;
                                const delBatch = db.batch();
                                snap.docs.forEach(doc => delBatch.delete(doc.ref));
                                await delBatch.commit();
                                totalDeleted += snap.size;
                            }
                            // Note: on ne supprime PAS les docs manual_entry/scan_ocr pour ne pas perdre les saisies manuelles
                            console.log(`Deleted ${totalDeleted} old docs`);
                            // Write ALL new docs in batches of 499
                            let batch = db.batch();
                            let batchCount = 0;
                            let totalWritten = 0;
                            for (let i = 0; i < deduped.length; i++) {
                                const { id, ...rec } = deduped[i];
                                batch.set(db.collection('pfq_interne').doc(id), rec);
                                batchCount++;
                                if (batchCount >= 499) { await batch.commit(); batch = db.batch(); totalWritten += batchCount; batchCount = 0; }
                            }
                            if (batchCount > 0) { await batch.commit(); totalWritten += batchCount; }
                            console.log(`Written ${totalWritten} docs to Firestore`);
                        }
                    } catch(err) {
                        console.error('Firestore reimport:', err);
                        alert(`Erreur Firestore: ${err.message}\n\nLes données sont sauvegardées localement mais peuvent ne pas être synchronisées.`);
                    }
                    // Sauvegarder le fichier Excel + JSON dans Firebase Storage (fallback)
                    try {
                        const storageRef = firebase.storage().ref();
                        // Upload Excel original
                        const excelRef = storageRef.child('data/situation_production_latest.xlsx');
                        await excelRef.put(file);
                        // Upload JSON parsé comme fallback
                        const jsonBlob = new Blob([JSON.stringify(deduped)], { type: 'application/json' });
                        const jsonRef = storageRef.child('data/bons_apport_latest.json');
                        await jsonRef.put(jsonBlob);
                        console.log('Excel + JSON sauvegardés dans Storage');
                    } catch(err) { console.warn('Storage upload skipped:', err.message); }
                    // 2026-09-14 (production readiness) : `_lastImportTs` n'était jamais déclarée
                    // (même dans le monolithe public/app.jsx:18645 — inoffensif là-bas car un
                    // script classique en mode non-strict crée juste une variable globale
                    // implicite). Un module ES est TOUJOURS en mode strict : cette même ligne y
                    // levait un ReferenceError à CHAQUE import PFQ réussi, empêchant la mise à
                    // jour de app_settings/pfq_import_meta et tout le bloc "Transport Fruit" qui
                    // suit de s'exécuter. Variable jamais relue ailleurs (write-only, ici comme
                    // dans le monolithe) — déclarée localement, comportement net inchangé.
                    let _lastImportTs = Date.now();
                    try {
                        await firebase.firestore().collection('app_settings').doc('pfq_import_meta').set({
                            lastImportTime: Date.now(),
                            lastImportCount: deduped.length,
                            lastImportFile: file.name,
                            // profileData/currentProfile n'existent pas dans ce composant (props
                            // réelles : userProfile) -- même régression, corrigée avec le champ
                            // réel (cf. AuthenticatedApp.jsx : userProfile.displayName/.profileId).
                            lastImportBy: userProfile?.displayName || userProfile?.profileId || 'unknown',
                        });
                    } catch(e) { console.warn('Meta update skipped:', e); }
                    // --- Transport Fruit : auto-incrémenter Pointage Divers depuis (date, matricule, N-V) ---
                    let transportReport = null;
                    try {
                        if (transportRows.length > 0 && typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            // Agrégation : Map<date, Map<matricule, Set<voyage>>>
                            const byDate = new Map();
                            for (const r of transportRows) {
                                if (!byDate.has(r.date)) byDate.set(r.date, new Map());
                                const m = byDate.get(r.date);
                                if (!m.has(r.matricule)) m.set(r.matricule, new Set());
                                m.get(r.matricule).add(r.voyage);
                            }
                            // Charger configs TRANSPORT FRUIT existants → index par matricule (nouveau schéma)
                            // Fallback : si pas de matricule, utiliser beneficiaire (compat configs legacy)
                            const cfgSnap = await db.collection('pointage_divers_config').where('fonction', '==', 'TRANSPORT FRUIT').get();
                            const cfgByMat = new Map();
                            cfgSnap.docs.forEach(d => {
                                const v = d.data();
                                if (v.active === false) return;
                                const key = String(v.matricule || v.beneficiaire || '').trim().toUpperCase();
                                if (key) cfgByMat.set(key, { id: d.id, ...v });
                            });
                            // Auto-create configs pour matricules inconnus (nom vide, à compléter par RH)
                            const allMatricules = new Set();
                            for (const m of byDate.values()) for (const k of m.keys()) allMatricules.add(k);
                            const missingPrices = [];
                            for (const mat of allMatricules) {
                                if (!cfgByMat.has(mat)) {
                                    const docData = {
                                        beneficiaire: '',
                                        matricule: mat,
                                        fonction: 'TRANSPORT FRUIT',
                                        tache: 'Transport fruit',
                                        prixUnitaire: 0,
                                        unite: 'VOYAGES',
                                        active: true,
                                        createdAt: Date.now(),
                                        updatedAt: Date.now(),
                                    };
                                    const ref = await db.collection('pointage_divers_config').add(docData);
                                    cfgByMat.set(mat, { id: ref.id, ...docData });
                                    missingPrices.push(mat);
                                } else if (!Number(cfgByMat.get(mat).prixUnitaire)) {
                                    missingPrices.push(mat);
                                }
                            }
                            // Upsert pointage_divers/{date} pour chaque date
                            const lockedDates = [];
                            let totalVoyages = 0;
                            const sortedDates = [...byDate.keys()].sort();
                            for (const date of sortedDates) {
                                // Check validation lock
                                let isLocked = false;
                                try {
                                    const vDoc = await db.collection('pointage_validations').doc(date + '_DIVERS').get();
                                    if (vDoc.exists && vDoc.data().locked === true) isLocked = true;
                                } catch (_) {}
                                if (isLocked) { lockedDates.push(date); continue; }
                                // Charger entries existantes, filtrer out TRANSPORT FRUIT
                                let existingEntries = [];
                                try {
                                    const dDoc = await db.collection('pointage_divers').doc(date).get();
                                    if (dDoc.exists) existingEntries = (dDoc.data().entries || []).filter(e => e.fonction !== 'TRANSPORT FRUIT');
                                } catch (_) {}
                                // Push 1 entry par matricule
                                const matMap = byDate.get(date);
                                for (const [mat, voyageSet] of matMap.entries()) {
                                    const cfg = cfgByMat.get(mat);
                                    const nbVoyages = voyageSet.size;
                                    const prixUnitaire = Number(cfg.prixUnitaire) || 0;
                                    existingEntries.push({
                                        configId: cfg.id,
                                        beneficiaire: cfg.beneficiaire || '',
                                        matricule: mat,
                                        fonction: 'TRANSPORT FRUIT',
                                        tache: 'Transport fruit',
                                        quantite: nbVoyages,
                                        prixUnitaire,
                                        unite: 'VOYAGES',
                                        montant: Math.round(nbVoyages * prixUnitaire * 100) / 100,
                                        commentaire: 'Auto-import situation production',
                                    });
                                    totalVoyages += nbVoyages;
                                }
                                const totalMontant = Math.round(existingEntries.reduce((s, e) => s + ((Number(e.quantite) || 0) * (Number(e.prixUnitaire) || 0)), 0) * 100) / 100;
                                await db.collection('pointage_divers').doc(date).set({
                                    date,
                                    entries: existingEntries,
                                    totalMontant,
                                    createdBy: 'Import Situation Production',
                                    updatedAt: Date.now(),
                                });
                            }
                            transportReport = {
                                nbVoyages: totalVoyages,
                                nbDates: sortedDates.length - lockedDates.length,
                                nbMatricules: allMatricules.size,
                                missingPrices,
                                lockedDates,
                            };
                        }
                    } catch (err) {
                        console.error('Transport fruit auto-import:', err);
                    }
                    // Utiliser directement les bons parsés + les bons manuels/scannés existants
                    __set_bonsCache(null); // Invalider le cache
                    // Recharger TOUS les bons (bulk_upload + manual_entry + scan_ocr) depuis Firestore
                    try {
                        const allBons = await loadBonsFromFirestore(true);
                        setBonsApport(allBons);
                    } catch(e) {
                        console.warn('Could not reload from Firestore, using deduped only:', e);
                        setBonsApport(deduped);
                    }
                    const countExport = deduped.filter(b => b.typeVente === 'Export').length;
                    const countLocal = deduped.filter(b => b.typeVente === 'Marché Local').length;
                    const countOther = deduped.length - countExport - countLocal;
                    let importMsg = `${deduped.length} bons importés depuis "${file.name}".\n\n  - Export: ${countExport} bons\n  - Marché Local: ${countLocal} bons`;
                    if (countOther > 0) importMsg += `\n  - Autres: ${countOther} bons`;
                    if (countLocal === 0) importMsg += '\n\n⚠️ ATTENTION: Aucun bon Marché Local importé ! Vérifiez la feuille LOCAL dans le fichier Excel.';
                    if (transportReport) {
                        importMsg += `\n\n🚚 Transport Fruit: ${transportReport.nbVoyages} voyages sur ${transportReport.nbDates} date(s) pour ${transportReport.nbMatricules} matricule(s).`;
                        if (transportReport.missingPrices.length > 0) {
                            importMsg += `\n\n⚠️ Matricules à tarifer (prix=0 DH/voyage) :\n  - ${transportReport.missingPrices.join('\n  - ')}\n→ Renseigner le prix dans Pointage Divers › Config Sous-traitants.`;
                        }
                        if (transportReport.lockedDates.length > 0) {
                            importMsg += `\n\n🔒 Dates ignorées (Pointage Divers verrouillé) :\n  - ${transportReport.lockedDates.join('\n  - ')}`;
                        }
                    }
                    alert(importMsg);
                } catch(err) {
                    alert('Erreur de lecture du fichier: ' + err.message);
                    console.error(err);
                } finally {
                    setImporting(false);
                    if (reimportFileRef.current) reimportFileRef.current.value = '';
                }
            };

            // Load bons d'apport — Firestore paginé (source unique)
            React.useEffect(() => {
                const loadBons = async () => {
                    setLoading(true);
                    try {
                        setBonsApport(await loadBonsFromFirestore());
                    } catch(e) { console.warn('Firestore failed:', e); }
                    setLoading(false);
                };
                loadBons();
                // Écouter les changements d'import en temps réel (sync mobile ↔ PC)
                let lastImportTime = null;
                const unsub = firebase.firestore().collection('app_settings').doc('pfq_import_meta')
                    .onSnapshot(doc => {
                        if (!doc.exists) return;
                        const meta = doc.data();
                        if (lastImportTime === null) { lastImportTime = meta.lastImportTime; return; }
                        if (meta.lastImportTime !== lastImportTime) {
                            lastImportTime = meta.lastImportTime;
                            console.log('[Sync] Import détecté, rechargement des bons...');
                            loadBonsFromFirestore().then(bons => setBonsApport(bons)).catch(console.error);
                        }
                    });
                return () => unsub();
            }, []);

            // Lazy-load expeditions when estimation mode is activated
            React.useEffect(() => {
                if (!estimationMode || expeditionsEst.length > 0) return;
                setExpeditionsLoading(true);
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => { if (json.success && json.expeditions) setExpeditionsEst(json.expeditions); })
                    .catch(err => console.warn('Could not load expeditions for estimation:', err))
                    .finally(() => setExpeditionsLoading(false));
            }, [estimationMode]);

            // Map bons to unified format using normalizeParcelle (exclure les rejetés)
            const mapped = React.useMemo(() => bonsApport.filter(b => b.status !== 'rejete_qualite' && b.status !== 'rejete_chef').map(b => {
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                const cycle = getCycle(b.date);
                const variety = resolved
                    ? (resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete)
                    : (b.blocVariete || '?');
                // Normalize typeVente: Driscoll's + EXP → Export, ECRT → Marché Local
                const rawType = b.typeVente || '';
                const typeVente = (rawType === "Driscoll's" || rawType === 'EXP') ? 'Export'
                    : rawType === 'ECRT' ? 'Marché Local'
                    : rawType || '';
                return {
                    ...b,
                    variety,
                    baseVariety: resolved ? resolved.variete : (b.blocVariete || '?'),
                    ferme: resolved ? resolved.ferme : (b.blocFerme || '').replace('-', '').replace('F 0', 'F').replace('F-0', 'F').replace('F-', 'F'),
                    culture: resolved ? resolved.culture : 'Framboise',
                    cycle,
                    kg: parseFloat(b.poidsLot) || 0,
                    dateISO: b.date || '',
                    typeVente,
                    client: b.client || '',
                };
            }).filter(b => {
                if (b.kg <= 0) return false;
                const dUp = [b.designation, b.variety, b.blocVariete, b.blocLabel].filter(Boolean).join(' ').toUpperCase();
                const SKIP = ['DECHET','PLASTIQUE','EMBALLAGE','PALETTE','CARTON VIDE','BOIS'];
                return !SKIP.some(s => dUp.includes(s));
            }), [bonsApport]);

            // Augment mapped with estimated expeditions when estimation mode is ON
            const mappedWithEstimation = React.useMemo(() => {
                if (!estimationMode || expeditionsEst.length === 0) return mapped;
                // Find last bon date per variety AND per base variety (for fallback)
                const lastBonDateByVariety = {};
                const lastBonDateByBase = {};
                // Also track which full variety name to use per base variety (pick the one with most kg)
                const kgByVariety = {};
                mapped.forEach(b => {
                    if (!b.dateISO || !b.variety) return;
                    if (!lastBonDateByVariety[b.variety] || b.dateISO > lastBonDateByVariety[b.variety])
                        lastBonDateByVariety[b.variety] = b.dateISO;
                    const base = b.baseVariety || b.variety;
                    if (!lastBonDateByBase[base] || b.dateISO > lastBonDateByBase[base])
                        lastBonDateByBase[base] = b.dateISO;
                    kgByVariety[b.variety] = (kgByVariety[b.variety] || 0) + b.kg;
                });
                // For each base variety, build proportional shares across sub-varieties
                const subVarietiesByBase = {};
                Object.entries(kgByVariety).forEach(([variety, kg]) => {
                    const resolved = normalizeParcelle(variety);
                    const base = resolved ? resolved.variete : variety;
                    if (!subVarietiesByBase[base]) subVarietiesByBase[base] = [];
                    subVarietiesByBase[base].push({ variety, kg });
                });
                Object.entries(subVarietiesByBase).forEach(([base, subs]) => {
                    // Assign 100% to the most recently active sub-variety (by lastBonDate)
                    let mostRecent = null, mostRecentDate = '';
                    subs.forEach(v => {
                        const d = lastBonDateByVariety[v.variety] || '';
                        if (d > mostRecentDate) { mostRecentDate = d; mostRecent = v; }
                    });
                    subs.forEach(v => { v.share = v === mostRecent ? 1 : 0; });
                });
                const today = new Date().toISOString().slice(0, 10);
                const syntheticBons = [];
                const seenBatches = new Set();
                expeditionsEst.forEach((exp, idx) => {
                    // Deduplicate by batchNumber
                    if (exp.batchNumber && seenBatches.has(exp.batchNumber)) return;
                    if (exp.batchNumber) seenBatches.add(exp.batchNumber);
                    if ((exp.overallResult || '').toUpperCase() === 'REJECT') return;
                    if ((exp.status || '').includes('Annulée')) return;
                    // Parse date
                    const raw = exp.date || exp.inspectedDate || '';
                    let dateISO = '';
                    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (m) dateISO = m[3] + '-' + m[1] + '-' + m[2];
                    else if (raw.length >= 10 && raw[4] === '-') dateISO = raw.slice(0, 10);
                    if (!dateISO || dateISO > today) return;
                    // Map variety
                    const rawVariety = applyVarietyMapping ? applyVarietyMapping(exp.batchNumber, exp.variety) : exp.variety;
                    if (!rawVariety) return;
                    const resolved = normalizeParcelle(rawVariety);
                    let variety = resolved ? (resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete) : rawVariety;
                    const baseVar = resolved ? resolved.variete : variety;
                    const expKg = parseFloat(exp.batchWeight) || 0;
                    if (expKg <= 0) return;
                    const cycle = getCycle(dateISO);
                    // Try exact variety match first
                    let lastBonDate = lastBonDateByVariety[variety];
                    if (lastBonDate) {
                        if (dateISO <= lastBonDate) return;
                        syntheticBons.push({
                            id: `est_${idx}`,
                            variety,
                            baseVariety: baseVar,
                            ferme: resolved ? resolved.ferme : '',
                            culture: resolved ? resolved.culture : 'Framboise',
                            cycle,
                            kg: expKg,
                            dateISO,
                            typeVente: 'Export',
                            client: '',
                            _isEstimation: true,
                        });
                    } else if (subVarietiesByBase[baseVar]) {
                        // No exact match → assign to most recently active sub-variety
                        const fallbackDate = lastBonDateByBase[baseVar];
                        if (!fallbackDate || dateISO <= fallbackDate) return;
                        subVarietiesByBase[baseVar].forEach((sub, subIdx) => {
                            if (sub.share <= 0) return;
                            syntheticBons.push({
                                id: `est_${idx}_${subIdx}`,
                                variety: sub.variety,
                                baseVariety: baseVar,
                                ferme: resolved ? resolved.ferme : '',
                                culture: resolved ? resolved.culture : 'Framboise',
                                cycle,
                                kg: expKg * sub.share,
                                dateISO,
                                typeVente: 'Export',
                                client: '',
                                _isEstimation: true,
                            });
                        });
                    }
                });
                return [...mapped, ...syntheticBons];
            }, [mapped, estimationMode, expeditionsEst, applyVarietyMapping]);

            // Ha lookup using PARCELLES_CULTURALES
            const getHa = (variety, ferme, cycle) => {
                // Try exact match (variety = "Maravilla Green Cane")
                const parts = variety.split(' ');
                let baseV = variety, sousV = null;
                // Check if last words form a known sous-variete
                const knownSous = ['Green Cane', 'Long Cane', 'Mow Down', 'Bi Cycle', 'Cut Back', 'Nouvelle plantation'];
                for (const sv of knownSous) {
                    if (variety.endsWith(sv)) { baseV = variety.slice(0, -(sv.length + 1)); sousV = sv; break; }
                }
                const ha = getHaByCycle(baseV, sousV, ferme, cycle);
                if (ha > 0) return ha;
                // Fallback: try without sous-variete
                return getHaByCycle(baseV, null, ferme, cycle);
            };

            // Plants lookup for myrtille
            const getPlants = (variety, ferme, cycle) => {
                const parts = variety.split(' ');
                let baseV = variety, sousV = null;
                const knownSous = ['Green Cane', 'Long Cane', 'Mow Down', 'Bi Cycle', 'Cut Back', 'Nouvelle plantation'];
                for (const sv of knownSous) {
                    if (variety.endsWith(sv)) { baseV = variety.slice(0, -(sv.length + 1)); sousV = sv; break; }
                }
                const plants = getPlantsByCycle(baseV, sousV, ferme, cycle);
                if (plants > 0) return plants;
                return getPlantsByCycle(baseV, null, ferme, cycle);
            };

            const uniqueFermes = [...new Set(mappedWithEstimation.map(e => e.ferme).filter(f => f && f !== '-' && f !== ''))].sort();
            const cycleFiltered = selectedCycle > 0 ? mappedWithEstimation.filter(e => e.cycle === selectedCycle) : mappedWithEstimation;
            const fermeFiltered = selectedFerme ? cycleFiltered.filter(e => e.ferme === selectedFerme) : cycleFiltered;
            const uniqueVarietes = [...new Set(fermeFiltered.map(e => e.variety).filter(Boolean))].sort();
            const activeVariete = selectedVariete || 'Toutes';
            const varieteFiltered = activeVariete !== 'Toutes' ? fermeFiltered.filter(e => e.variety === activeVariete) : fermeFiltered;
            const uniqueTypeVentes = [...new Set(varieteFiltered.map(e => e.typeVente).filter(Boolean))].sort();
            const typeFiltered = selectedTypeVente ? varieteFiltered.filter(e => e.typeVente === selectedTypeVente) : varieteFiltered;
            const dateFiltered = selectedDate ? typeFiltered.filter(e => e.dateISO === selectedDate || e.date === selectedDate) : typeFiltered;
            const uniqueClients = [...new Set(dateFiltered.map(e => e.client).filter(Boolean))].sort();
            const filtered = selectedClient ? dateFiltered.filter(e => e.client === selectedClient) : dateFiltered;
            // When Écarts is on, bypass the typeVente filter (default 'Export') so Marché Local bons are included.
            const chartSource = React.useMemo(() => {
                if (!showEcarts || !selectedTypeVente) return filtered;
                let s = varieteFiltered;
                if (selectedDate) s = s.filter(e => e.dateISO === selectedDate || e.date === selectedDate);
                if (selectedClient) s = s.filter(e => e.client === selectedClient);
                return s;
            }, [showEcarts, selectedTypeVente, filtered, varieteFiltered, selectedDate, selectedClient]);
            const activeCycleForHa = selectedCycle || getCycle(new Date().toISOString());

            // Week number: Sat-Fri weeks (calendrier Driscoll's)
            const getWeekNum = (dateStr) => {
                if (!dateStr) return null;
                let d;
                if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                    const parts = dateStr.split('-');
                    d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
                } else {
                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (!m) return null;
                    d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]), 12, 0, 0);
                }
                const jan1 = new Date(d.getFullYear(), 0, 1, 12, 0, 0);
                const days = Math.floor((d - jan1) / 86400000);
                const jan1Dow = (jan1.getDay() + 1) % 7; // Sat=0, Sun=1, ..., Fri=6
                return Math.ceil((days + jan1Dow + 1) / 7);
            };

            // Tri saison: semaines > 26 = annee precedente (Sep-Dec), viennent en premier
            const weekOrder = (w) => w > 26 ? w - 100 : w;

            // Week date range helper (Sat-Fri, Driscoll's)
            const weekRange = (w) => {
                const year = w > 26 ? 2025 : 2026;
                const jan1 = new Date(year, 0, 1, 12, 0, 0);
                const jan1Dow = (jan1.getDay() + 1) % 7;
                const firstSat = new Date(jan1);
                firstSat.setDate(firstSat.getDate() - jan1Dow);
                const start = new Date(firstSat);
                start.setDate(start.getDate() + (w - 1) * 7);
                const end = new Date(start);
                end.setDate(end.getDate() + 6);
                const fmt = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
                return `${fmt(start)} - ${fmt(end)}`;
            };

            // Production by variety
            const byVariety = React.useMemo(() => {
                const acc = {};
                filtered.forEach(e => {
                    const v = e.variety || '?';
                    if (!acc[v]) acc[v] = { variety: v, kg: 0, lots: 0 };
                    acc[v].kg += e.kg;
                    acc[v].lots += 1;
                });
                return Object.values(acc).sort((a, b) => b.kg - a.kg);
            }, [filtered]);

            const totalKg = byVariety.reduce((s, v) => s + v.kg, 0);
            const totalKgLocal = React.useMemo(() => filtered.filter(e => e.typeVente === 'Marché Local').reduce((s, e) => s + e.kg, 0), [filtered]);
            const pctLocal = totalKg > 0 ? (totalKgLocal / totalKg * 100).toFixed(1) : '0.0';

            // Cycle 2 rendement (non filtré — utilise mapped)
            const cycle2Varieties = ['Maravilla Green Cane', 'Maravilla Long Cane', 'Yazmin Bi Cycle', 'Corina', 'Breeze', 'Cascade'];
            const cycle2Stats = React.useMemo(() => {
                const c2 = mappedWithEstimation.filter(e => e.cycle === 2 && cycle2Varieties.includes(e.variety));
                const acc = {};
                c2.forEach(e => {
                    const v = e.variety;
                    if (!acc[v]) acc[v] = { variety: v, kgExport: 0, kgLocal: 0, kg: 0 };
                    acc[v].kg += e.kg;
                    if (e.typeVente === 'Export') acc[v].kgExport += e.kg;
                    else acc[v].kgLocal += e.kg;
                });
                return cycle2Varieties.map(v => acc[v] || { variety: v, kgExport: 0, kgLocal: 0, kg: 0 }).map(s => {
                    const resolved = normalizeParcelle(s.variety);
                    const culture = resolved ? resolved.culture : 'Framboise';
                    const ha = getHa(s.variety, null, 2);
                    const plants = getPlants(s.variety, null, 2);
                    const pctLoc = (s.kgLocal + s.kgExport) > 0 ? (s.kgLocal / (s.kgLocal + s.kgExport) * 100).toFixed(1) : '0.0';
                    const kgPerPlant = plants > 0 ? s.kgExport / plants : 0;
                    const rendementMyrtille = plants > 0 ? (kgPerPlant < 1 ? Math.round(kgPerPlant * 1000) : kgPerPlant.toFixed(2)) : '-';
                    const rendementLabelMyrtille = plants > 0 && kgPerPlant < 1 ? 'g/Pl' : 'Kg/Pl';
                    return { ...s, culture, ha, plants, pctLocal: pctLoc,
                        rendement: culture === 'Myrtille' ? rendementMyrtille : (ha > 0 ? (s.kgExport / 1000 / ha).toFixed(2) : '-'),
                        rendementLabel: culture === 'Myrtille' ? rendementLabelMyrtille : 'T/Ha',
                        tonnageExport: (s.kgExport / 1000).toFixed(2),
                    };
                });
            }, [mappedWithEstimation]);

            // Production by week
            const byWeek = React.useMemo(() => {
                const acc = {};
                chartSource.forEach(e => {
                    const w = getWeekNum(e.dateISO);
                    if (!w) return;
                    if (!acc[w]) acc[w] = { week: w, kg: 0, lots: 0, byVar: {}, byVarEst: {}, kgExport: 0, kgEcart: 0 };
                    acc[w].kg += e.kg;
                    acc[w].lots += 1;
                    if (e.typeVente === 'Export') acc[w].kgExport += e.kg; else acc[w].kgEcart += e.kg;
                    const v = e.variety || '?';
                    if (!acc[w].byVar[v]) acc[w].byVar[v] = 0;
                    acc[w].byVar[v] += e.kg;
                    if (e._isEstimation) {
                        if (!acc[w].byVarEst[v]) acc[w].byVarEst[v] = 0;
                        acc[w].byVarEst[v] += e.kg;
                    }
                });
                return Object.values(acc).sort((a, b) => weekOrder(a.week) - weekOrder(b.week));
            }, [chartSource]);

            // Production by day
            const byDay = React.useMemo(() => {
                const acc = {};
                chartSource.forEach(e => {
                    const dateISO = e.dateISO;
                    if (!dateISO) return;
                    // Format label DD/MM from YYYY-MM-DD
                    const parts = dateISO.split('-');
                    const label = parts.length === 3 ? parts[2] + '/' + parts[1] : dateISO;
                    if (!acc[dateISO]) acc[dateISO] = { date: dateISO, label, kg: 0, lots: 0, byVar: {}, byVarEst: {}, kgExport: 0, kgEcart: 0 };
                    acc[dateISO].kg += e.kg;
                    acc[dateISO].lots += 1;
                    if (e.typeVente === 'Export') acc[dateISO].kgExport += e.kg; else acc[dateISO].kgEcart += e.kg;
                    const v = e.variety || '?';
                    if (!acc[dateISO].byVar[v]) acc[dateISO].byVar[v] = 0;
                    acc[dateISO].byVar[v] += e.kg;
                    if (e._isEstimation) {
                        if (!acc[dateISO].byVarEst[v]) acc[dateISO].byVarEst[v] = 0;
                        acc[dateISO].byVarEst[v] += e.kg;
                    }
                });
                return Object.values(acc).sort((a, b) => a.date.localeCompare(b.date));
            }, [chartSource]);

            const allVarieties = [...new Set(filtered.map(e => e.variety).filter(Boolean))].sort();
            const varColors = { 'Reyna': '#8B2252', 'Maravilla': '#3498db', 'Maravilla Long Cane': '#2980b9', 'Maravilla Green Cane': '#5dade2', 'Yazmin Sol': '#f39c12', 'Yazmin': '#f39c12', 'Yazmin Bi Cycle': '#e67e22', 'Yazmin Mow Down': '#f1c40f', 'Corrina': '#27ae60', 'Corina': '#27ae60', 'Corina (Myrtille)': '#27ae60', 'Cascade': '#9b59b6', 'Breeze': '#1abc9c' };

            // Auto-scroll charts to show most recent data (rightmost)
            React.useEffect(() => {
                if (loading) return;
                const t = setTimeout(() => {
                    if (dayChartScrollRef.current) {
                        dayChartScrollRef.current.scrollLeft = dayChartScrollRef.current.scrollWidth;
                    }
                    if (weekChartScrollRef.current) {
                        weekChartScrollRef.current.scrollLeft = weekChartScrollRef.current.scrollWidth;
                    }
                }, 300);
                return () => clearTimeout(t);
            }, [loading]);

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement...</div></div>;

            // Chart: T/Ha computation
            const chartTotalHa = (() => {
                const varieties = [...new Set(filtered.map(e => e.variety).filter(Boolean))];
                return varieties.reduce((s, v) => s + getHa(v, selectedFerme || null, activeCycleForHa), 0);
            })();
            const chartVarieties = [...new Set(filtered.map(e => e.variety).filter(Boolean))];
            const isAllMyrtilleChart = chartVarieties.length > 0 && chartVarieties.every(v => {
                const r = normalizeParcelle(v);
                return r && r.culture === 'Myrtille';
            });
            const chartTotalPlants = isAllMyrtilleChart
                ? chartVarieties.reduce((s, v) => s + getPlants(v, selectedFerme || null, activeCycleForHa), 0)
                : 0;
            const showKgPlantChart = isAllMyrtilleChart && chartTotalPlants > 0;
            const byDayKgHa = byDay.map(d => ({
                ...d,
                kgha: chartTotalHa > 0 ? (d.kg / chartTotalHa) : 0,
                kgplant: chartTotalPlants > 0 ? (d.kg / chartTotalPlants) : 0,
                byVarKgHa: Object.fromEntries(Object.entries(d.byVar).map(([v, kg]) => [v, chartTotalHa > 0 ? (kg / chartTotalHa) : 0])),
                byVarKgPlant: Object.fromEntries(Object.entries(d.byVar).map(([v, kg]) => [v, chartTotalPlants > 0 ? (kg / chartTotalPlants) : 0]))
            }));
            const isKgHaModeChart = chartMode === 'kgha';
            const isKgPlantModeChart = chartMode === 'kgplant';

            // Weekly Kg/Ha computation
            const byWeekKgHa = byWeek.map(w => ({
                ...w,
                kgha: chartTotalHa > 0 ? (w.kg / chartTotalHa) : 0,
                kgplant: chartTotalPlants > 0 ? (w.kg / chartTotalPlants) : 0,
            }));

            // Chart: max for scaling
            const maxWeekKg = byWeek.length > 0 ? Math.max(...byWeek.map(w => w.kg)) : 1;
            const maxWeekKgHa = byWeekKgHa.length > 0 ? Math.max(...byWeekKgHa.map(w => w.kgha)) : 1;
            const maxWeekKgPlant = byWeekKgHa.length > 0 ? Math.max(...byWeekKgHa.map(w => w.kgplant)) : 0.001;
            const maxDayKg = byDay.length > 0 ? Math.max(...byDay.map(d => d.kg)) : 1;
            const maxDayKgHa = byDayKgHa.length > 0 ? Math.max(...byDayKgHa.map(d => d.kgha)) : 1;
            const maxDayKgPlant = byDayKgHa.length > 0 ? Math.max(...byDayKgHa.map(d => d.kgplant)) : 0.001;
            const dayKgPlantInGrams = isKgPlantModeChart && maxDayKgPlant < 1;
            const weekKgPlantInGrams = isKgPlantModeChart && maxWeekKgPlant < 1;

            if (cycle2OnlyView) {
                if (loading) return <div className="loading"><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div>;
                if (cycle2Stats.length === 0) return <div style={{padding:20, color:'var(--gray-400)'}}>Aucune donnée Cycle 2.</div>;
                return (
                    <div className="fade-in" style={{padding:16, borderRadius:14, background:'linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%)', border:'1.5px solid #e0e7ff'}}>
                        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14}}>
                            <i className="fa-solid fa-chart-column" style={{color:'#5c6bc0'}}></i>
                            <span style={{fontWeight:700, fontSize:14, color:'#283593'}}>Rendement Cycle 2 — Toutes variétés</span>
                        </div>
                        <div className="variety-cards-grid" style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10}}>
                            {cycle2Stats.map((s, i) => {
                                const isMyrt = s.culture === 'Myrtille';
                                const cardBg = isMyrt ? '#e8f5e9' : '#fff3e0';
                                const cardBorder = isMyrt ? '#a5d6a7' : '#ffcc80';
                                const rendColor = isMyrt ? '#2e7d32' : '#e65100';
                                const budgetCfg = BUDGET_BGF[s.variety];
                                const storedTotals = (() => { try { const st = localStorage.getItem('budgetBGFTotals'); return st ? JSON.parse(st) : {}; } catch(e) { return {}; } })();
                                const budgetTotal = budgetCfg ? (storedTotals[s.variety] || budgetCfg.total) : 0;
                                const reelKgHa = s.ha > 0 ? s.kgExport / s.ha : 0;
                                const pctBudget = budgetTotal > 0 ? (reelKgHa / budgetTotal * 100).toFixed(0) : null;
                                const pctColor = pctBudget !== null ? (pctBudget >= 100 ? '#22c55e' : pctBudget >= 70 ? '#f59e0b' : '#ef4444') : '#999';
                                return (
                                    <div key={i} style={{padding:12, borderRadius:10, background:cardBg, border:`1px solid ${cardBorder}`, position:'relative'}}>
                                        {pctBudget !== null && (
                                            <div style={{position:'absolute', top:8, right:10, fontSize:12, fontWeight:800, color:pctColor}}>
                                                {pctBudget}%
                                                <div style={{fontSize:8, fontWeight:500, color:'#999', textAlign:'right'}}>vs Budget</div>
                                            </div>
                                        )}
                                        <div style={{fontWeight:700, fontSize:12, color:'#1a237e', marginBottom:2}}>{s.variety}</div>
                                        <div style={{fontSize:10, color:'var(--gray-500)', marginBottom:8}}>{isMyrt ? '🫐 Myrtille' : '🍇 Framboise'}</div>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                                            <div>
                                                <div style={{fontSize:18, fontWeight:800, color:rendColor}}>{s.rendement}</div>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>{s.rendementLabel}</div>
                                            </div>
                                            <div style={{textAlign:'right'}}>
                                                <div style={{fontSize:13, fontWeight:700, color:'#e65100'}}>{s.pctLocal}%</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>% Local</div>
                                            </div>
                                        </div>
                                        <div style={{marginTop:6, fontSize:10, color:'var(--gray-500)'}}>Export: {s.tonnageExport} T{s.plants > 0 && <span style={{marginLeft:8, color:'#283593', fontWeight:600}}>{s.plants.toLocaleString()} plants</span>}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            }

            return (
                <div className="fade-in">
                    {hideCycle1 && (
                        <div style={{display:'flex', alignItems:'center', gap:8, padding:'10px 16px', marginBottom:16, borderRadius:10, background:'rgba(225,112,85,0.08)', border:'1.5px solid rgba(225,112,85,0.25)'}}>
                            <i className="fa-solid fa-circle-info" style={{color:'#e17055', fontSize:15}}></i>
                            <span style={{fontSize:13, fontWeight:600, color:'#e17055'}}>2ème cycle seulement</span>
                            <span style={{fontSize:12, color:'var(--gray-500)', marginLeft:4}}>— Les données du 1er cycle (Sep–Déc) sont masquées par le DG</span>
                        </div>
                    )}
                    {/* Réimporter Excel — admin + profil Achats */}
                    {(userProfile?.role === 'admin' || userProfile?.profileId === 'achats') && (
                    <div style={{display:'flex', justifyContent:'flex-end', marginBottom:12}}>
                        <input type="file" accept=".xlsx,.xls" ref={reimportFileRef} onChange={handleReimportSituation} style={{display:'none'}} />
                        <button onClick={() => setShowImportModal(true)} disabled={importing}
                            style={{background: importing?'#95a5a6':'#27ae60', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', cursor: importing?'not-allowed':'pointer', fontWeight:600, fontSize:12, display:'flex', alignItems:'center', gap:6}}>
                            <i className={importing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-excel'}></i>
                            {importing ? 'Import en cours...' : 'Réimporter Situation Production'}
                        </button>
                        <input type="file" accept=".xlsx,.xls" ref={budgetFileRef} onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                                const result = await importBudgetExcel(file);
                                const count = Object.keys(result).length;
                                setBudgetImportMsg(`${count} variété(s) importée(s)`);
                                setTimeout(() => setBudgetImportMsg(null), 4000);
                            } catch(err) { setBudgetImportMsg('Erreur: ' + err.message); setTimeout(() => setBudgetImportMsg(null), 5000); }
                            if (budgetFileRef.current) budgetFileRef.current.value = '';
                        }} style={{display:'none'}} />
                        <button onClick={() => budgetFileRef.current?.click()}
                            style={{background:'#283593', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', cursor:'pointer', fontWeight:600, fontSize:12, display:'flex', alignItems:'center', gap:6}}>
                            <i className="fa-solid fa-bullseye"></i>
                            Importer Budget
                        </button>
                        {budgetImportMsg && <span style={{fontSize:11, color:'#27ae60', fontWeight:600}}>{budgetImportMsg}</span>}
                        <button onClick={() => {
                            const rows = [['Date', 'N° Bon', 'Ferme', 'Variété', 'Désignation', 'Poids (kg)', 'Type', 'Client', 'Prix DH/kg', 'Total DH']];
                            filtered.forEach(b => {
                                rows.push([b.dateISO || b.date || '', b.numeroPiece || '', b.ferme || '', b.variety || '', b.designation || b.blocLabel || '', b.kg || 0, b.typeVente || '', b.client || '', b.prixDH || '', b.totalDH || '']);
                            });
                            const ws = XLSX.utils.aoa_to_sheet(rows);
                            ws['!cols'] = [{wch:12},{wch:10},{wch:6},{wch:25},{wch:30},{wch:12},{wch:14},{wch:15},{wch:12},{wch:14}];
                            const wb = XLSX.utils.book_new();
                            XLSX.utils.book_append_sheet(wb, ws, 'Bons Apport');
                            const dateTag = selectedDate || new Date().toISOString().slice(0,10);
                            XLSX.writeFile(wb, `Bons_Apport_${dateTag}.xlsx`);
                        }}
                            style={{background:'#1565C0', color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', cursor:'pointer', fontWeight:600, fontSize:12, display:'flex', alignItems:'center', gap:6, marginLeft:8}}>
                            <i className="fa-solid fa-download"></i>
                            Export Excel
                        </button>
                    </div>
                    )}

                    {/* Modal Import Situation Production */}
                    {showImportModal && (
                        <div className="modal-overlay" onClick={() => setShowImportModal(false)} style={{zIndex:9999}}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:520, padding:0, borderRadius:16, overflow:'hidden'}}>
                                <div style={{background:'linear-gradient(135deg, #1b5e20 0%, #43a047 100%)', padding:'24px 28px', color:'#fff'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700}}>Importer Situation Production</div>
                                            <div style={{fontSize:12, opacity:0.85, marginTop:4}}>Fichier Excel (.xlsx ou .xls)</div>
                                        </div>
                                        <button onClick={() => setShowImportModal(false)} style={{background:'rgba(255,255,255,0.2)', border:'none', color:'#fff', borderRadius:'50%', width:32, height:32, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center'}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                </div>
                                <div style={{padding:'28px'}}>
                                    <div
                                        onClick={() => reimportFileRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                                        onDragLeave={() => setDragOver(false)}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            setDragOver(false);
                                            const droppedFile = e.dataTransfer.files?.[0];
                                            if (droppedFile && /\.(xlsx|xls)$/i.test(droppedFile.name)) {
                                                handleReimportSituation(droppedFile);
                                            } else {
                                                alert('Veuillez déposer un fichier Excel (.xlsx ou .xls)');
                                            }
                                        }}
                                        style={{
                                            border: dragOver ? '2.5px solid #27ae60' : '2.5px dashed #c8e6c9',
                                            borderRadius:14,
                                            padding:'48px 24px',
                                            textAlign:'center',
                                            cursor:'pointer',
                                            background: dragOver ? 'rgba(39,174,96,0.08)' : '#fafff9',
                                            transition:'all 0.2s ease'
                                        }}
                                    >
                                        <i className="fa-solid fa-file-excel" style={{fontSize:48, color: dragOver ? '#27ae60' : '#a5d6a7', marginBottom:16}}></i>
                                        <div style={{fontSize:15, fontWeight:600, color:'#2e7d32', marginBottom:6}}>
                                            Glissez votre fichier Excel ici
                                        </div>
                                        <div style={{fontSize:13, color:'#888'}}>
                                            ou <span style={{color:'#27ae60', fontWeight:600, textDecoration:'underline'}}>cliquez pour sélectionner</span>
                                        </div>
                                        <div style={{fontSize:11, color:'#aaa', marginTop:12}}>
                                            Formats acceptés : .xlsx, .xls
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div style={{display:'flex', gap: 8, marginBottom: 12, alignItems:'center', flexWrap:'wrap'}}>
                        <label style={{fontSize: 12, fontWeight: 600}}>Production:</label>
                        <button onClick={() => setEstimationMode(!estimationMode)} disabled={expeditionsLoading}
                            style={{padding:'6px 16px', borderRadius:20, fontSize:12, fontWeight:700, cursor: expeditionsLoading ? 'not-allowed' : 'pointer',
                                border: estimationMode ? '2px solid #8e24aa' : '1.5px solid var(--gray-200)',
                                background: estimationMode ? '#8e24aa' : '#fff', color: estimationMode ? '#fff' : 'var(--gray-600)',
                                transition:'all 0.2s', display:'flex', alignItems:'center', gap:6}}>
                            <i className={expeditionsLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-chart-line'}></i>
                            {expeditionsLoading ? 'Chargement...' : 'Estimation'}
                        </button>
                        {estimationMode && <span style={{fontSize:10, color:'#8e24aa', fontWeight:500, fontStyle:'italic'}}>+ expéditions après dernier bon</span>}
                        <span style={{flex:1}}></span>
                        {['Toutes', 'Export', 'Marché Local'].map(t => {
                            const filterVal = t === 'Toutes' ? '' : t;
                            const active = selectedTypeVente === filterVal;
                            const tColor = t === 'Export' ? '#1565C0' : t === 'Marché Local' ? '#e65100' : 'var(--berry)';
                            return (
                                <button key={t}
                                    onClick={() => { setSelectedTypeVente(filterVal); setSelectedClient(''); }}
                                    style={{
                                        padding:'6px 16px', borderRadius:20, fontSize:12, fontWeight: active ? 700 : 500,
                                        cursor:'pointer', border: active ? `2px solid ${tColor}` : '1.5px solid var(--gray-200)',
                                        background: active ? tColor : '#fff',
                                        color: active ? '#fff' : 'var(--gray-600)',
                                        transition:'all 0.2s'
                                    }}>
                                    {t}
                                </button>
                            );
                        })}
                        <span style={{width:1, height:20, background:'var(--gray-200)', margin:'0 4px'}}></span>
                        {selectedDate && (
                            <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().slice(0,10)); setSelectedClient(''); }}
                                style={{width:30, height:30, borderRadius:'50%', border:'1.5px solid var(--gray-200)', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'var(--gray-600)', flexShrink:0}}>
                                <i className="fa-solid fa-chevron-left"></i>
                            </button>
                        )}
                        <input type="date" value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setSelectedClient(''); }}
                            style={{padding:'5px 10px', borderRadius:20, border: selectedDate ? '2px solid var(--berry)' : '1.5px solid var(--gray-200)', fontSize:12, fontWeight: selectedDate ? 700 : 500, color: selectedDate ? 'var(--berry)' : 'var(--gray-600)', background: selectedDate ? 'rgba(139,34,82,0.06)' : '#fff', cursor:'pointer'}} />
                        {selectedDate && (
                            <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().slice(0,10)); setSelectedClient(''); }}
                                style={{width:30, height:30, borderRadius:'50%', border:'1.5px solid var(--gray-200)', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'var(--gray-600)', flexShrink:0}}>
                                <i className="fa-solid fa-chevron-right"></i>
                            </button>
                        )}
                        {selectedDate && (
                            <button onClick={() => setSelectedDate('')}
                                style={{padding:'5px 10px', borderRadius:20, border:'none', background:'rgba(220,38,38,0.08)', color:'#dc2626', fontSize:11, fontWeight:600, cursor:'pointer'}}>
                                <i className="fa-solid fa-xmark" style={{marginRight:3}}></i>Reset
                            </button>
                        )}
                    </div>
                    {/* Client filter masqué */}

                    {/* Date/heure du dernier bon d'apport + (en mode estimation) dernière expédition */}
                    {(() => {
                        const parseDateISO = (s) => {
                            if (!s) return null;
                            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
                            const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                            return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
                        };
                        // Last bon: max by dateISO, tiebreak by createdAt
                        let lastBon = null;
                        for (const b of mapped) {
                            if (!b.dateISO) continue;
                            if (!lastBon || b.dateISO > lastBon.dateISO || (b.dateISO === lastBon.dateISO && (b.createdAt || '') > (lastBon.createdAt || ''))) {
                                lastBon = b;
                            }
                        }
                        // Last expedition actually taken into consideration in the stats:
                        // iterate mappedWithEstimation synthetic bons (same filters as the display).
                        let lastExp = null;
                        if (estimationMode) {
                            for (const b of mappedWithEstimation) {
                                if (!b._isEstimation || !b.dateISO) continue;
                                if (!lastExp || b.dateISO > lastExp.dateISO) lastExp = { dateISO: b.dateISO };
                            }
                        }
                        const fmtFr = (iso) => {
                            if (!iso) return '-';
                            const [y, m, d] = iso.split('-');
                            return `${d}/${m}/${y}`;
                        };
                        const fmtDateTime = (createdAt) => {
                            if (!createdAt) return null;
                            try {
                                const d = new Date(createdAt);
                                if (isNaN(d)) return null;
                                return d.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
                            } catch (e) { return null; }
                        };
                        if (!lastBon && !lastExp) return null;
                        return (
                            <div style={{display:'flex', gap:12, flexWrap:'wrap', marginBottom:12, fontSize:11, color:'var(--gray-500)'}}>
                                {lastBon && (
                                    <div style={{padding:'6px 12px', background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:8}}>
                                        <i className="fa-solid fa-file-invoice" style={{color:'var(--blue)', marginRight:6}}></i>
                                        <strong style={{color:'var(--dark)'}}>Dernier bon d'apport:</strong> {fmtFr(lastBon.dateISO)}
                                        {fmtDateTime(lastBon.createdAt) && <span style={{marginLeft:6, color:'var(--gray-400)'}}>(importé le {fmtDateTime(lastBon.createdAt)})</span>}
                                    </div>
                                )}
                                {estimationMode && lastExp && (
                                    <div style={{padding:'6px 12px', background:'#f3e5f5', border:'1px solid #ce93d8', borderRadius:8}}>
                                        <i className="fa-solid fa-truck-fast" style={{color:'#8e24aa', marginRight:6}}></i>
                                        <strong style={{color:'#6a1b9a'}}>Dernière expédition prise en compte:</strong> {fmtFr(lastExp.dateISO)}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Rendement Cycle 2 — NON filtré */}
                    {cycle2Stats.length > 0 && (
                        <div className="variety-sticky-section" style={{marginBottom:20, padding:16, borderRadius:14, background:'linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%)', border:'1.5px solid #e0e7ff', position:'sticky', top:0, zIndex:10}}>
                            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14}}>
                                <i className="fa-solid fa-chart-column" style={{color:'#5c6bc0'}}></i>
                                <span style={{fontWeight:700, fontSize:14, color:'#283593'}}>Rendement Cycle 2 — Toutes variétés</span>
                                <span style={{fontSize:11, color:'var(--gray-400)', marginLeft:'auto'}}>Non filtré</span>
                            </div>
                            <div className="variety-cards-grid" style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10}}>
                                {cycle2Stats.map((s, i) => {
                                    const isMyrt = s.culture === 'Myrtille';
                                    const cardBg = isMyrt ? '#e8f5e9' : '#fff3e0';
                                    const cardBorder = isMyrt ? '#a5d6a7' : '#ffcc80';
                                    const rendColor = isMyrt ? '#2e7d32' : '#e65100';
                                    // % vs budget
                                    const budgetCfg = BUDGET_BGF[s.variety];
                                    const storedTotals = (() => { try { const st = localStorage.getItem('budgetBGFTotals'); return st ? JSON.parse(st) : {}; } catch(e) { return {}; } })();
                                    const budgetTotal = budgetCfg ? (storedTotals[s.variety] || budgetCfg.total) : 0;
                                    const reelKgHa = s.ha > 0 ? s.kgExport / s.ha : 0;
                                    const pctBudget = budgetTotal > 0 ? (reelKgHa / budgetTotal * 100).toFixed(0) : null;
                                    const pctColor = pctBudget !== null ? (pctBudget >= 100 ? '#22c55e' : pctBudget >= 70 ? '#f59e0b' : '#ef4444') : '#999';
                                    return (
                                        <div key={i} style={{padding:12, borderRadius:10, background: selectedVariete === s.variety ? '#fff' : cardBg, border: selectedVariete === s.variety ? `2px solid #6c5ce7` : `1px solid ${cardBorder}`, position:'relative', cursor:'pointer', transition:'all 0.2s', boxShadow: selectedVariete === s.variety ? '0 2px 8px rgba(108,92,231,0.2)' : 'none'}} onClick={() => { setSelectedVariete(selectedVariete === s.variety ? '' : s.variety); setSelectedCycle(2); if (selectedVariete !== s.variety) setSelectedTypeVente('Export'); }}>
                                            {pctBudget !== null && (
                                                <div style={{position:'absolute', top:8, right:10, fontSize:12, fontWeight:800, color:pctColor}}>
                                                    {pctBudget}%
                                                    <div style={{fontSize:8, fontWeight:500, color:'#999', textAlign:'right'}}>vs Budget</div>
                                                </div>
                                            )}
                                            <div style={{fontWeight:700, fontSize:12, color:'#1a237e', marginBottom:2}}>{s.variety}</div>
                                            <div style={{fontSize:10, color:'var(--gray-500)', marginBottom:8}}>{isMyrt ? '🫐 Myrtille' : '🍇 Framboise'}</div>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                                                <div>
                                                    <div style={{fontSize:18, fontWeight:800, color:rendColor}}>{s.rendement}</div>
                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>{s.rendementLabel}</div>
                                                </div>
                                                <div style={{textAlign:'right'}}>
                                                    <div style={{fontSize:13, fontWeight:700, color:'#e65100'}}>{s.pctLocal}%</div>
                                                    <div style={{fontSize:9, color:'var(--gray-400)'}}>% Local</div>
                                                </div>
                                            </div>
                                            <div style={{marginTop:6, fontSize:10, color:'var(--gray-500)'}}>Export: {s.tonnageExport} T{s.plants > 0 && <span style={{marginLeft:8, color:'#283593', fontWeight:600}}>{s.plants.toLocaleString()} plants</span>}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="kpi-grid" style={{marginBottom:20}}>
                        <KPICard icon="fa-weight-scale" iconClass="berry" value={`${(totalKg / 1000).toFixed(2)} T`} label="Tonnage Total Production" onClick={() => setKpiPopup('tonnage')} />
                        <KPICard icon="fa-chart-line" iconClass="green" value={`${(() => { const h = byVariety.reduce((s, v) => s + getHa(v.variety, selectedFerme || null, activeCycleForHa), 0); return h > 0 ? (totalKg / 1000 / h).toFixed(2) : '-'; })()} T/Ha`} label="Tonnage / Ha" onClick={() => setKpiPopup('tha')} />
                        <KPICard icon="fa-file-invoice" iconClass="blue" value={filtered.length} label="Bons d'Apport" onClick={() => setKpiPopup('bons')} />
                        <KPICard icon="fa-seedling" iconClass="green" value={byVariety.length} label="Variétés" onClick={() => setKpiPopup('varietes')} />
                        <KPICard icon="fa-calendar-day" iconClass="purple" value={byDay.length} label="Jours actifs" onClick={() => setKpiPopup('jours')} />
                        <KPICard icon="fa-shop" iconClass="berry" value={`${pctLocal}%`} label="% Marché Local" />
                    </div>

                    {/* KPI Detail Popup */}
                    {kpiPopup && (() => {
                        const totalHaAll = byVariety.reduce((s, v) => s + getHa(v.variety, selectedFerme || null, activeCycleForHa), 0);
                        let title = '', content = null;
                        if (kpiPopup === 'tonnage') {
                            const allSortedBons = [...filtered].sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || '') || b.kg - a.kg);
                            // Apply filter if set
                            const sortedBons = popupBonsFilter ? allSortedBons.filter(b => {
                                if (popupBonsFilter.type === 'variety') return b.variety === popupBonsFilter.value;
                                if (popupBonsFilter.type === 'day') return b.dateISO === popupBonsFilter.value;
                                if (popupBonsFilter.type === 'week') return getWeekNum(b.dateISO) === popupBonsFilter.value;
                                return true;
                            }) : allSortedBons;
                            const filterLabel = popupBonsFilter ? (popupBonsFilter.type === 'variety' ? popupBonsFilter.value : popupBonsFilter.type === 'day' ? popupBonsFilter.value.split('-').reverse().join('/') : 'Semaine ' + popupBonsFilter.value) : null;
                            title = `${sortedBons.length} Bons d'Apport` + (filterLabel ? ` — ${filterLabel}` : ' — Détail Production');
                            const filteredTotalKg = sortedBons.reduce((s, b) => s + (b.kg || 0), 0);
                            const showPrix = ['admin', 'finance'].includes(userProfile?.role) || ['achats', 'finance', 'dg'].includes(userProfile?.profileId);
                            const bonCurrentIndex = selectedBon ? sortedBons.findIndex(b => b.bonApport === selectedBon.bonApport && b.dateISO === selectedBon.dateISO && b.designation === selectedBon.designation) : -1;
                            const canPrev = bonCurrentIndex > 0;
                            const canNext = bonCurrentIndex >= 0 && bonCurrentIndex < sortedBons.length - 1;
                            content = selectedBon ? (
                                <div>
                                    {/* Navigation bar */}
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:8}}>
                                        <button onClick={() => setSelectedBon(null)} style={{background:'none', border:'none', color:'var(--berry)', cursor:'pointer', fontSize:12, padding:0}}>
                                            <i className="fas fa-arrow-left" style={{marginRight:4}}></i> Liste
                                        </button>
                                        <div style={{display:'flex', alignItems:'center', gap:12}}>
                                            <button onClick={() => canPrev && setSelectedBon(sortedBons[bonCurrentIndex - 1])} disabled={!canPrev} style={{background:'none', border:'1px solid ' + (canPrev ? '#1a237e' : '#ddd'), borderRadius:8, width:34, height:34, cursor:canPrev?'pointer':'default', color:canPrev?'#1a237e':'#ccc', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center'}}>
                                                <i className="fas fa-chevron-left"></i>
                                            </button>
                                            <span style={{fontSize:12, fontWeight:600, color:'#666'}}>{bonCurrentIndex + 1} / {sortedBons.length}</span>
                                            <button onClick={() => canNext && setSelectedBon(sortedBons[bonCurrentIndex + 1])} disabled={!canNext} style={{background:'none', border:'1px solid ' + (canNext ? '#1a237e' : '#ddd'), borderRadius:8, width:34, height:34, cursor:canNext?'pointer':'default', color:canNext?'#1a237e':'#ccc', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center'}}>
                                                <i className="fas fa-chevron-right"></i>
                                            </button>
                                            {(userProfile?.profileId === 'achats' || userProfile?.role === 'admin') && selectedBon.id && (
                                                <button onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (!confirm('Supprimer définitivement le bon N° ' + (selectedBon.bonApport || '-') + ' ?')) return;
                                                    try {
                                                        await firebase.firestore().collection('pfq_interne').doc(selectedBon.id).delete();
                                                        setBonsApport(prev => prev.filter(b => b.id !== selectedBon.id));
                                                        setSelectedBon(null);
                                                        alert('Bon supprimé.');
                                                    } catch(err) { alert('Erreur: ' + err.message); }
                                                }} style={{padding:'6px 14px',borderRadius:8,border:'none',background:'#dc2626',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:12,display:'flex',alignItems:'center',gap:6}}>
                                                    <i className="fa-solid fa-trash"></i> Supprimer
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {/* Bon d'Apport Detail - format papier */}
                                    <div style={{border:'2px solid #1a237e', borderRadius:12, overflow:'hidden', fontFamily:'serif'}}>
                                        {/* Header */}
                                        <div style={{background:'#e8eaf6', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'2px solid #1a237e'}}>
                                            <img src="https://www.berrygood.ma/logo.png" alt="Berry Good" style={{height:40, objectFit:'contain'}} />
                                            <div style={{textAlign:'center'}}><div style={{fontWeight:800, fontSize:15, color:'#1a237e'}}>BON D'APPORT</div></div>
                                            <div style={{textAlign:'right'}}><span style={{fontSize:11, color:'#666'}}>N°</span> <span style={{fontWeight:800, fontSize:16, color:'#c62828'}}>{selectedBon.bonApport || '-'}</span></div>
                                        </div>
                                        {/* Info grid */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', fontSize:12, borderBottom:'1px solid #c5cae9'}}>
                                            <div style={{padding:'6px 12px', borderRight:'1px solid #c5cae9', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Producteur / Ferme :</span> <strong>Berry Good Farms — {selectedBon.ferme || selectedBon.blocFerme || '-'}</strong></div>
                                            <div style={{padding:'6px 12px', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Parcelle / Bloc :</span> <strong>{selectedBon.bloc || selectedBon.designation || '-'}</strong></div>
                                            <div style={{padding:'6px 12px', borderRight:'1px solid #c5cae9', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Produit :</span> <strong>{selectedBon.culture || 'Framboise'}</strong></div>
                                            <div style={{padding:'6px 12px', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Date de récolte :</span> <strong>{selectedBon.dateISO ? selectedBon.dateISO.split('-').reverse().join('/') : '-'}</strong></div>
                                            <div style={{padding:'6px 12px', borderRight:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Variété :</span> <strong style={{color:'#1a237e'}}>{selectedBon.variety || selectedBon.blocVariete || '-'}</strong></div>
                                            <div style={{padding:'6px 12px'}}><span style={{color:'#666'}}>Client :</span> <strong>{selectedBon.client || '-'}</strong></div>
                                        </div>
                                        {/* Quantités */}
                                        <div style={{padding:'10px 12px', borderBottom:'1px solid #c5cae9'}}>
                                            <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
                                                <thead><tr style={{background:'#e8eaf6'}}>
                                                    <th style={{padding:'6px 8px', textAlign:'left', borderBottom:'1px solid #c5cae9'}}>Désignation</th>
                                                    <th style={{padding:'6px 8px', textAlign:'left', borderBottom:'1px solid #c5cae9'}}>Type</th>
                                                    <th style={{padding:'6px 8px', textAlign:'right', borderBottom:'1px solid #c5cae9'}}>Semaine</th>
                                                    <th style={{padding:'6px 8px', textAlign:'right', borderBottom:'1px solid #c5cae9', fontWeight:800, color:'#1a237e'}}>Quantité (kg)</th>
                                                </tr></thead>
                                                <tbody><tr>
                                                    <td style={{padding:'8px'}}>{selectedBon.designation || selectedBon.blocLabel || '-'}</td>
                                                    <td style={{padding:'8px'}}><span style={{padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, background: selectedBon.typeVente === 'Export' ? '#e8f5e9' : '#fff3e0', color: selectedBon.typeVente === 'Export' ? '#2e7d32' : '#e65100'}}>{selectedBon.typeVente || '-'}</span></td>
                                                    <td style={{padding:'8px', textAlign:'right'}}>{selectedBon.semaine || '-'}</td>
                                                    <td style={{padding:'8px', textAlign:'right', fontWeight:800, fontSize:15, color:'#1a237e'}}>{selectedBon.kg ? selectedBon.kg.toLocaleString('fr-FR', {maximumFractionDigits:1}) : '0'}</td>
                                                </tr></tbody>
                                            </table>
                                        </div>
                                        {/* Footer */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', fontSize:11, color:'#666'}}>
                                            <div style={{padding:'8px 12px', borderRight:'1px solid #c5cae9'}}><span>Visa producteur</span></div>
                                            <div style={{padding:'8px 12px'}}><span>Agent de réception</span></div>
                                        </div>
                                    </div>
                                    {selectedBon.prixDH > 0 && (
                                        <div style={{marginTop:12, padding:10, borderRadius:8, background:'#f5f5f5', fontSize:12, display:'flex', gap:16}}>
                                            <div><span style={{color:'var(--gray-400)'}}>Prix DH/kg:</span> <strong>{selectedBon.prixDH?.toFixed(2)}</strong></div>
                                            <div><span style={{color:'var(--gray-400)'}}>Total DH:</span> <strong style={{color:'#2e7d32'}}>{selectedBon.totalDH?.toLocaleString('fr-FR', {maximumFractionDigits:2})}</strong></div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div>
                                    {/* Filter badge */}
                                    {popupBonsFilter && (
                                        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12}}>
                                            <span style={{padding:'4px 12px', borderRadius:16, background:'#eff6ff', color:'#1565C0', fontSize:12, fontWeight:600}}>
                                                <i className="fas fa-filter" style={{marginRight:4, fontSize:10}}></i>{filterLabel}
                                            </span>
                                            <button onClick={() => setPopupBonsFilter(null)} style={{background:'none', border:'none', cursor:'pointer', color:'var(--berry)', fontSize:12, fontWeight:500}}>Voir tous les bons</button>
                                        </div>
                                    )}
                                    {/* Résumé par variété */}
                                    {!popupBonsFilter && (
                                        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:14}}>
                                            {byVariety.map((v, i) => (
                                                <div key={i} style={{padding:'4px 10px', borderRadius:6, background:'var(--gray-50)', fontSize:11}}>
                                                    <strong>{v.variety}</strong> <span style={{color:'var(--gray-400)'}}>{(v.kg/1000).toFixed(2)}T ({v.lots})</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {/* Liste des bons */}
                                    <table className="data-table" style={{fontSize:11}}>
                                        <thead><tr style={{background:'#f1f5f9'}}><th style={{padding:'8px 6px'}}>N° Bon</th><th style={{padding:'8px 6px'}}>Date</th><th style={{padding:'8px 6px'}}>Variété</th><th style={{padding:'8px 6px'}}>Ferme</th><th style={{padding:'8px 6px'}}>Parcelle</th><th style={{padding:'8px 6px'}}>Type</th><th style={{padding:'8px 6px'}}>Sem.</th><th style={{padding:'8px 6px', textAlign:'right'}}>Kg</th>{showPrix && <th style={{padding:'8px 6px'}}>Client</th>}{showPrix && <th style={{padding:'8px 6px', textAlign:'right'}}>Prix DH</th>}<th></th></tr></thead>
                                        <tbody>
                                            {sortedBons.map((b, i) => (
                                                <tr key={i} style={{cursor:'pointer', background: i % 2 === 0 ? '#fff' : '#f8fafc', transition:'background 0.15s'}} onClick={() => setSelectedBon(b)} onMouseEnter={e => e.currentTarget.style.background='#e8eaf6'} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#f8fafc'}>
                                                    <td style={{fontWeight:600, color:'#1a237e', padding:'6px'}}>{b.bonApport || '-'}</td>
                                                    <td style={{padding:'6px'}}>{b.dateISO ? b.dateISO.split('-').reverse().join('/') : '-'}</td>
                                                    <td style={{padding:'6px', fontWeight:500}}>{b.variety}</td>
                                                    <td style={{padding:'6px'}}>{b.ferme || '-'}</td>
                                                    <td style={{padding:'6px', fontSize:10, color:'#666'}}>{b.bloc || b.designation || '-'}</td>
                                                    <td style={{padding:'6px'}}><span style={{padding:'1px 6px', borderRadius:4, fontSize:10, fontWeight:600, background: b.typeVente === 'Export' ? '#e8f5e9' : '#fff3e0', color: b.typeVente === 'Export' ? '#2e7d32' : '#e65100'}}>{b.typeVente}</span></td>
                                                    <td style={{padding:'6px', textAlign:'center', fontSize:10}}>S{b.semaine || '-'}</td>
                                                    <td style={{textAlign:'right', fontWeight:700, padding:'6px'}}>{b.kg.toLocaleString('fr-FR', {maximumFractionDigits:1})}</td>
                                                    {showPrix && <td style={{padding:'6px', fontSize:10}}>{b.client || '-'}</td>}
                                                    {showPrix && <td style={{padding:'6px', textAlign:'right', fontSize:10, color:'#2e7d32', fontWeight:600}}>{b.client === "Driscoll's" ? '-' : (b.prixDH > 0 ? b.prixDH.toFixed(2) : '-')}</td>}
                                                    <td style={{textAlign:'center', padding:'6px'}}><i className="fas fa-eye" style={{color:'var(--gray-300)', fontSize:10}}></i></td>
                                                </tr>
                                            ))}
                                            <tr style={{background:'#e8eaf6', fontWeight:700}}>
                                                <td style={{padding:'8px 6px'}}>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td></td>
                                                <td style={{textAlign:'right', padding:'8px 6px', color:'#1a237e'}}>{(filteredTotalKg/1000).toFixed(2)} T</td>{showPrix && <td></td>}{showPrix && <td style={{textAlign:'right', padding:'8px 6px', color:'#2e7d32'}}>{sortedBons.filter(b => b.client !== "Driscoll's" && b.totalDH > 0).reduce((s,b) => s + b.totalDH, 0).toLocaleString('fr-FR', {maximumFractionDigits:0})} DH</td>}<td></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            );
                        } else if (kpiPopup === 'tha') {
                            title = 'Rendement T/Ha par Variété';
                            content = (
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead><tr><th>Variété</th><th style={{textAlign:'right'}}>Tonnes</th><th style={{textAlign:'right'}}>Ha</th><th style={{textAlign:'right'}}>T/Ha</th><th style={{textAlign:'right'}}>kg/plant</th></tr></thead>
                                    <tbody>
                                        {byVariety.map((v, i) => {
                                            const ha = getHa(v.variety, selectedFerme || null, activeCycleForHa);
                                            const plants = getPlants(v.variety, selectedFerme || null, activeCycleForHa);
                                            return (<tr key={i}><td><strong>{v.variety}</strong></td><td style={{textAlign:'right'}}>{(v.kg/1000).toFixed(2)}</td><td style={{textAlign:'right'}}>{ha || '-'}</td><td style={{textAlign:'right', fontWeight:700, color:'var(--green)'}}>{ha > 0 ? (v.kg/1000/ha).toFixed(2) : '-'}</td><td style={{textAlign:'right', color: plants > 0 ? '#283593' : 'var(--gray-300)'}}>{plants > 0 ? (v.kg/plants).toFixed(2) : '-'}</td></tr>);
                                        })}
                                        <tr style={{background:'var(--gray-100)', fontWeight:700}}><td>TOTAL</td><td style={{textAlign:'right'}}>{(totalKg/1000).toFixed(2)}</td><td style={{textAlign:'right'}}>{totalHaAll || '-'}</td><td style={{textAlign:'right', color:'var(--green)'}}>{totalHaAll > 0 ? (totalKg/1000/totalHaAll).toFixed(2) : '-'}</td><td></td></tr>
                                    </tbody>
                                </table>
                            );
                        } else if (kpiPopup === 'bons') {
                            title = `Détail ${filtered.length} Bons d'Apport`;
                            const byTypeV = {};
                            filtered.forEach(b => { const t = b.typeVente || 'Autre'; if (!byTypeV[t]) byTypeV[t] = { count: 0, kg: 0 }; byTypeV[t].count++; byTypeV[t].kg += b.kg; });
                            content = (
                                <div>
                                    <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                        <thead><tr><th>Type de Vente</th><th style={{textAlign:'right'}}>Bons</th><th style={{textAlign:'right'}}>Kg</th><th style={{textAlign:'right'}}>% Bons</th></tr></thead>
                                        <tbody>
                                            {Object.entries(byTypeV).sort((a,b) => b[1].kg - a[1].kg).map(([t, d]) => (
                                                <tr key={t}><td><strong>{t}</strong></td><td style={{textAlign:'right'}}>{d.count}</td><td style={{textAlign:'right'}}>{Math.round(d.kg).toLocaleString('fr-FR')}</td><td style={{textAlign:'right', color:'var(--berry)'}}>{(d.count/filtered.length*100).toFixed(1)}%</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <div style={{fontSize:11, color:'var(--gray-500)'}}>Répartition par variété :</div>
                                    <table className="data-table" style={{fontSize:12, marginTop:8}}>
                                        <thead><tr><th>Variété</th><th style={{textAlign:'right'}}>Bons</th><th style={{textAlign:'right'}}>Kg</th></tr></thead>
                                        <tbody>
                                            {byVariety.map((v, i) => (<tr key={i}><td>{v.variety}</td><td style={{textAlign:'right'}}>{v.lots}</td><td style={{textAlign:'right'}}>{Math.round(v.kg).toLocaleString('fr-FR')}</td></tr>))}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        } else if (kpiPopup === 'varietes') {
                            title = `${byVariety.length} Variétés en Production`;
                            content = (
                                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12}}>
                                    {byVariety.map((v, i) => {
                                        const ha = getHa(v.variety, selectedFerme || null, activeCycleForHa);
                                        const plants = getPlants(v.variety, selectedFerme || null, activeCycleForHa);
                                        const r = normalizeParcelle(v.variety);
                                        const isMyrt = r && r.culture === 'Myrtille';
                                        return (
                                            <div key={i} style={{padding:14, borderRadius:12, border:'1px solid var(--gray-200)', background:'white'}}>
                                                <div style={{fontWeight:700, color:'var(--berry)', marginBottom:4}}>{v.variety}</div>
                                                <div style={{fontSize:11, color:'var(--gray-500)', marginBottom:8}}>{selectedFerme || (r ? r.ferme : '')} {ha ? `| ${ha} Ha` : ''} {isMyrt ? '| Myrtille' : '| Framboise'}</div>
                                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, fontSize:12}}>
                                                    <div><span style={{color:'var(--gray-400)'}}>Bons:</span> <strong>{v.lots}</strong></div>
                                                    <div><span style={{color:'var(--gray-400)'}}>Kg:</span> <strong>{Math.round(v.kg).toLocaleString('fr-FR')}</strong></div>
                                                    <div><span style={{color:'var(--gray-400)'}}>T/Ha:</span> <strong style={{color:'var(--green)'}}>{ha > 0 ? (v.kg/1000/ha).toFixed(2) : '-'}</strong></div>
                                                    {plants > 0 && <div><span style={{color:'var(--gray-400)'}}>kg/pl:</span> <strong style={{color:'#283593'}}>{(v.kg/plants).toFixed(2)}</strong></div>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        } else if (kpiPopup === 'jours') {
                            title = `${byDay.length} Jours Actifs de Production`;
                            const sorted = [...byDay].sort((a,b) => b.kg - a.kg);
                            const avgKg = byDay.length > 0 ? totalKg / byDay.length : 0;
                            content = (
                                <div>
                                    <div style={{display:'flex', gap:16, marginBottom:16, flexWrap:'wrap'}}>
                                        <div style={{padding:'8px 14px', borderRadius:8, background:'var(--gray-50)', fontSize:12}}><span style={{color:'var(--gray-400)'}}>Moy/jour:</span> <strong>{Math.round(avgKg).toLocaleString('fr-FR')} kg</strong></div>
                                        <div style={{padding:'8px 14px', borderRadius:8, background:'#e8f5e9', fontSize:12}}><span style={{color:'var(--gray-400)'}}>Meilleur:</span> <strong style={{color:'#2e7d32'}}>{sorted[0] ? Math.round(sorted[0].kg).toLocaleString('fr-FR') + ' kg (' + sorted[0].label + ')' : '-'}</strong></div>
                                        <div style={{padding:'8px 14px', borderRadius:8, background:'#fce4ec', fontSize:12}}><span style={{color:'var(--gray-400)'}}>Plus bas:</span> <strong style={{color:'#c62828'}}>{sorted.length > 0 ? Math.round(sorted[sorted.length-1].kg).toLocaleString('fr-FR') + ' kg (' + sorted[sorted.length-1].label + ')' : '-'}</strong></div>
                                    </div>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead><tr><th>Date</th><th style={{textAlign:'right'}}>Kg</th><th style={{textAlign:'right'}}>Bons</th><th>Top variété</th></tr></thead>
                                        <tbody>
                                            {sorted.slice(0, 15).map((d, i) => {
                                                const topVar = Object.entries(d.byVar).sort((a,b) => b[1] - a[1])[0];
                                                return (<tr key={i}><td style={{fontWeight:600}}>{d.label}</td><td style={{textAlign:'right', fontWeight:700}}>{Math.round(d.kg).toLocaleString('fr-FR')}</td><td style={{textAlign:'right'}}>{d.lots}</td><td style={{fontSize:11}}>{topVar ? topVar[0] + ' (' + Math.round(topVar[1]) + ' kg)' : '-'}</td></tr>);
                                            })}
                                        </tbody>
                                    </table>
                                    {sorted.length > 15 && <div style={{fontSize:11, color:'var(--gray-400)', marginTop:8, textAlign:'center'}}>... et {sorted.length - 15} autres jours</div>}
                                </div>
                            );
                        }
                        return (
                            <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center'}} onClick={() => { setKpiPopup(null); setSelectedBon(null); setPopupBonsFilter(null); }}>
                                <div style={{background:'#fff', borderRadius:16, maxWidth:700, width:'95%', maxHeight:'85vh', overflow:'auto', padding:28, boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                                        <h3 style={{margin:0, fontSize:16, color:'var(--berry)'}}>{title}</h3>
                                        <button onClick={() => { setKpiPopup(null); setSelectedBon(null); setPopupBonsFilter(null); }} style={{background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--gray-400)'}}>&times;</button>
                                    </div>
                                    {content}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Production par Variété */}
                    <Panel title="Production par Variété" icon="fa-chart-pie">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Variété</th>
                                    <th>Ferme</th>
                                    <th>Bons</th>
                                    <th>Production (T)</th>
                                    <th>% du Total</th>
                                    <th>Superficie (Ha)</th>
                                    <th>T/Ha</th>
                                    <th>kg/plant</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {byVariety.map((v, i) => {
                                    const ha = getHa(v.variety, selectedFerme || null, activeCycleForHa);
                                    const plants = getPlants(v.variety, selectedFerme || null, activeCycleForHa);
                                    const tonnes = (v.kg / 1000).toFixed(2);
                                    const tonnesHa = ha > 0 ? (v.kg / 1000 / ha).toFixed(2) : '-';
                                    const kgPlant = plants > 0 ? (v.kg / plants).toFixed(2) : '-';
                                    const pct = totalKg > 0 ? (v.kg / totalKg * 100).toFixed(1) : 0;
                                    const barColor = varColors[v.variety] || 'var(--gray-400)';
                                    const resolved = normalizeParcelle(v.variety);
                                    const fermeDisplay = selectedFerme || (resolved ? resolved.ferme : '-');
                                    return (
                                        <tr key={i} style={{cursor:'pointer', transition:'background 0.15s'}} onClick={() => { setPopupBonsFilter({type:'variety', value:v.variety}); setKpiPopup('tonnage'); }} onMouseEnter={e => e.currentTarget.style.background='#e8eaf6'} onMouseLeave={e => e.currentTarget.style.background=''}>
                                            <td><strong>{v.variety}</strong></td>
                                            <td>{fermeDisplay}</td>
                                            <td>{v.lots}</td>
                                            <td><strong>{tonnes} T</strong></td>
                                            <td>
                                                <div style={{display:'flex', alignItems:'center', gap:8}}>
                                                    <div style={{flex:1, background:'var(--gray-100)', borderRadius:4, height:8, maxWidth:100}}>
                                                        <div style={{width:`${pct}%`, background:barColor, borderRadius:4, height:8}}></div>
                                                    </div>
                                                    <span style={{fontSize:12, fontWeight:600}}>{pct}%</span>
                                                </div>
                                            </td>
                                            <td>{ha > 0 ? ha + ' Ha' : '-'}</td>
                                            <td style={{fontWeight:700, color: ha > 0 ? 'var(--berry)' : 'var(--gray-400)'}}>{ha > 0 ? tonnesHa + ' T/Ha' : '-'}</td>
                                            <td style={{fontWeight:600, color: plants > 0 ? '#27ae60' : 'var(--gray-300)'}}>{plants > 0 ? kgPlant + ' kg' : '-'}</td>
                                            <td><span style={{display:'inline-block', width:12, height:12, borderRadius:3, background:barColor}}></span> <i className="fas fa-eye" style={{color:'var(--gray-300)', fontSize:10, marginLeft:4}}></i></td>
                                        </tr>
                                    );
                                })}
                                {(() => {
                                    const totalHa = byVariety.reduce((s, v) => s + getHa(v.variety, selectedFerme || null, activeCycleForHa), 0);
                                    const totalPlants = byVariety.reduce((s, v) => s + getPlants(v.variety, selectedFerme || null, activeCycleForHa), 0);
                                    const totalTonnes = (totalKg / 1000).toFixed(2);
                                    const totalTonnesHa = totalHa > 0 ? (totalKg / 1000 / totalHa).toFixed(2) : '-';
                                    const totalKgPlant = totalPlants > 0 ? (totalKg / totalPlants).toFixed(2) : '-';
                                    return (
                                        <tr style={{background:'var(--gray-50)', fontWeight:700}}>
                                            <td>TOTAL</td>
                                            <td></td>
                                            <td>{filtered.length}</td>
                                            <td>{totalTonnes} T</td>
                                            <td>100%</td>
                                            <td>{totalHa > 0 ? totalHa + ' Ha' : '-'}</td>
                                            <td style={{color:'var(--berry)'}}>{totalHa > 0 ? totalTonnesHa + ' T/Ha' : '-'}</td>
                                            <td style={{color:'#27ae60'}}>{totalPlants > 0 ? totalKgPlant + ' kg' : '-'}</td>
                                            <td></td>
                                        </tr>
                                    );
                                })()}
                            </tbody>
                        </table>
                    </Panel>

                    {/* Production par Jour — histogramme */}
                    <Panel title="Production par Jour" icon="fa-chart-bar">
                        <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', marginBottom:8, gap:8}}>
                            <div className="chip-group" style={{marginBottom:0}}>
                                {[
                                    {v:'total', l:'Total (kg)'},
                                    {v:'kgha', l:'Kg / Ha'},
                                    ...(showKgPlantChart ? [{v:'kgplant', l: dayKgPlantInGrams ? 'g / Pl' : 'Kg / Pl'}] : [])
                                ].map(m => (
                                    <button key={m.v} className={`chip c-berry ${chartMode === m.v ? 'active' : ''}`} onClick={() => setChartMode(m.v)} style={{padding:'4px 12px',fontSize:11}}>{m.l}</button>
                                ))}
                            </div>
                            <label style={{display:'flex', alignItems:'center', gap:4, fontSize:11, cursor:'pointer', userSelect:'none', marginLeft:8, padding:'4px 10px', borderRadius:16, border: showEcarts ? '2px solid #e67e22' : '1.5px solid var(--gray-200)', background: showEcarts ? 'rgba(230,126,34,0.08)' : '#fff', transition:'all 0.2s'}}>
                                <input type="checkbox" checked={showEcarts} onChange={ev => setShowEcarts(ev.target.checked)} style={{accentColor:'#e67e22'}} />
                                <span style={{fontWeight: showEcarts ? 600 : 500, color: showEcarts ? '#e67e22' : 'var(--gray-600)'}}>Écarts</span>
                            </label>
                        </div>
                        {isKgHaModeChart && chartTotalHa <= 0 && (
                            <div style={{padding:8, fontSize:11, color:'#e74c3c', background:'#fdf0ed', borderRadius:6, marginBottom:8}}>
                                Aucune surface (Ha) disponible pour le filtre actuel. Sélectionnez une ferme ou variété.
                            </div>
                        )}
                        {isKgPlantModeChart && chartTotalPlants <= 0 && (
                            <div style={{padding:8, fontSize:11, color:'#e74c3c', background:'#fdf0ed', borderRadius:6, marginBottom:8}}>
                                Aucune information de plants disponible pour le filtre actuel.
                            </div>
                        )}
                        <div ref={dayChartScrollRef} style={{overflowX:'auto'}}>
                            <div style={{display:'flex', alignItems:'flex-end', gap:2, minHeight:220, padding:'16px 8px 0'}}>
                                {byDayKgHa.map((d, i) => {
                                    const val = isKgPlantModeChart ? d.kgplant : isKgHaModeChart ? d.kgha : d.kg;
                                    const maxVal = isKgPlantModeChart ? maxDayKgPlant : isKgHaModeChart ? maxDayKgHa : maxDayKg;
                                    const h = maxVal > 0 ? (val / maxVal * 180) : 0;
                                    const labelVal = isKgPlantModeChart
                                        ? (dayKgPlantInGrams ? Math.round(d.kgplant * 1000).toLocaleString() : d.kgplant.toFixed(2))
                                        : isKgHaModeChart ? Math.round(d.kgha).toLocaleString() : Math.round(d.kg).toLocaleString();
                                    const ecartPct = (showEcarts && d.kg > 0) ? Math.round(d.kgEcart / d.kg * 100) : 0;
                                    return (
                                        <div key={i} style={{display:'flex', flexDirection:'column', alignItems:'center', flex:'1 0 32px', minWidth:32, cursor:'pointer'}} onClick={() => { setPopupBonsFilter({type:'day', value:d.date}); setKpiPopup('tonnage'); }}>
                                            <div style={{fontSize:9, fontWeight:700, marginBottom: showEcarts ? 1 : 3, color:'var(--gray-600)'}}>{labelVal}</div>
                                            {showEcarts && d.kgEcart > 0 && <div style={{fontSize:8, fontWeight:700, marginBottom:2, color:'#e67e22'}}>{ecartPct}%</div>}
                                            <div style={{width:'100%', maxWidth:28, borderRadius:'4px 4px 0 0', position:'relative', height:h, display:'flex', flexDirection:'column', justifyContent:'flex-end', overflow:'hidden'}}>
                                                {showEcarts ? (
                                                    <>
                                                        {d.kgExport > 0 && <div style={{width:'100%', height: d.kg > 0 ? (d.kgExport / d.kg * h) : 0, background:'#3498db'}}></div>}
                                                        {d.kgEcart > 0 && <div style={{width:'100%', height: d.kg > 0 ? (d.kgEcart / d.kg * h) : 0, background:'#e67e22'}}></div>}
                                                    </>
                                                ) : (
                                                    allVarieties.map((v, vi) => {
                                                        const vVal = isKgPlantModeChart ? (d.byVarKgPlant[v] || 0) : isKgHaModeChart ? (d.byVarKgHa[v] || 0) : (d.byVar[v] || 0);
                                                        const estVal = isKgPlantModeChart ? ((d.byVarEst?.[v] || 0) / (chartTotalPlants || 1)) : isKgHaModeChart ? ((d.byVarEst?.[v] || 0) / (chartTotalHa || 1)) : (d.byVarEst?.[v] || 0);
                                                        const realVal = vVal - estVal;
                                                        const realH = val > 0 ? (realVal / val * h) : 0;
                                                        const estH = val > 0 ? (estVal / val * h) : 0;
                                                        const color = varColors[v] || '#999';
                                                        return <React.Fragment key={vi}>
                                                            {realH > 0 && <div style={{width:'100%', height:realH, background:color}}></div>}
                                                            {estH > 0 && <div style={{width:'100%', height:estH, background:`repeating-linear-gradient(45deg, ${color}, ${color} 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 5px)`}}></div>}
                                                        </React.Fragment>;
                                                    })
                                                )}
                                            </div>
                                            <div style={{fontSize:9, fontWeight:700, marginTop:5, color:'var(--berry)', whiteSpace:'nowrap'}}>{d.label}</div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Legend */}
                            <div style={{display:'flex', gap:16, justifyContent:'center', marginTop:12, paddingBottom:8}}>
                                {showEcarts ? (
                                    <>
                                        <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                            <span style={{width:10, height:10, borderRadius:2, background:'#3498db', display:'inline-block'}}></span>
                                            <span style={{fontWeight:600}}>Export</span>
                                        </div>
                                        <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                            <span style={{width:10, height:10, borderRadius:2, background:'#e67e22', display:'inline-block'}}></span>
                                            <span style={{fontWeight:600, color:'#e67e22'}}>Écarts (non Export)</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {allVarieties.map(v => (
                                            <div key={v} style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                <span style={{width:10, height:10, borderRadius:2, background:varColors[v] || '#999', display:'inline-block'}}></span>
                                                {v}
                                            </div>
                                        ))}
                                        {estimationMode && (
                                            <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                <span style={{width:10, height:10, borderRadius:2, background:'repeating-linear-gradient(45deg, #8e24aa, #8e24aa 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 5px)', display:'inline-block'}}></span>
                                                <span style={{fontWeight:600, color:'#8e24aa'}}>Estimation</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </Panel>

                    {/* Production par Semaine — histogramme Kg/Ha + Forecast + Budget */}
                    <Panel title="Production par Semaine" icon="fa-chart-column">
                        <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', marginBottom:8, gap:8}}>
                            <div className="chip-group" style={{marginBottom:0}}>
                                {[
                                    {v:'total', l:'Total (kg)'},
                                    {v:'kgha', l:'Kg / Ha'},
                                    ...(showKgPlantChart ? [{v:'kgplant', l: weekKgPlantInGrams ? 'g / Pl' : 'Kg / Pl'}] : [])
                                ].map(m => (
                                    <button key={m.v} className={`chip c-berry ${weekChartMode === m.v ? 'active' : ''}`} onClick={() => setWeekChartMode(m.v)} style={{padding:'4px 12px',fontSize:11}}>{m.l}</button>
                                ))}
                            </div>
                            <label style={{display:'flex', alignItems:'center', gap:4, fontSize:11, cursor:'pointer', userSelect:'none', padding:'4px 10px', borderRadius:16, border: showEcarts ? '2px solid #e67e22' : '1.5px solid var(--gray-200)', background: showEcarts ? 'rgba(230,126,34,0.08)' : '#fff', transition:'all 0.2s'}}>
                                <input type="checkbox" checked={showEcarts} onChange={ev => setShowEcarts(ev.target.checked)} style={{accentColor:'#e67e22'}} />
                                <span style={{fontWeight: showEcarts ? 600 : 500, color: showEcarts ? '#e67e22' : 'var(--gray-600)'}}>Écarts</span>
                            </label>
                        </div>
                        {weekChartMode === 'kgha' && chartTotalHa <= 0 && (
                            <div style={{padding:8, fontSize:11, color:'#e74c3c', background:'#fdf0ed', borderRadius:6, marginBottom:8}}>
                                Aucune surface (Ha) disponible pour le filtre actuel. Sélectionnez une ferme ou variété.
                            </div>
                        )}
                        {weekChartMode === 'kgplant' && chartTotalPlants <= 0 && (
                            <div style={{padding:8, fontSize:11, color:'#e74c3c', background:'#fdf0ed', borderRadius:6, marginBottom:8}}>
                                Aucune information de plants disponible pour le filtre actuel.
                            </div>
                        )}
                        {(weekChartMode === 'total' || (weekChartMode === 'kgha' && chartTotalHa > 0) || (weekChartMode === 'kgplant' && chartTotalPlants > 0)) && (() => {
                            // Budget BGF — detect active variety budget
                            const budgetTotalStored = localStorage.getItem('budgetBGFTotals');
                            const budgetTotals = budgetTotalStored ? JSON.parse(budgetTotalStored) : {};
                            const matchedVariety = activeVariete !== 'Toutes' ? Object.keys(BUDGET_BGF).find(v => activeVariete === v) : null;
                            const budgetConfig = matchedVariety ? BUDGET_BGF[matchedVariety] : null;
                            const bgfTotal = budgetConfig ? (budgetTotals[matchedVariety] || budgetConfig.total) : 0;
                            const budgetWeekly = budgetConfig ? computeBudgetWeekly(bgfTotal, budgetConfig.distribution) : {};
                            const curWeek = getCurrentWeekNumber();

                            // Réel export Kg/Ha by week
                            const reelExportByWeek = {};
                            byWeekKgHa.forEach(w => { reelExportByWeek[w.week] = chartTotalHa > 0 ? (w.kgExport / chartTotalHa) : 0; });

                            // Momentum & projection
                            const momentum = budgetConfig ? computeMomentum(reelExportByWeek, budgetWeekly, curWeek) : 1;
                            const projection = budgetConfig ? computeProjection(reelExportByWeek, budgetWeekly, momentum, curWeek) : {};
                            const atterrissage = budgetConfig ? computeAtterrissage(reelExportByWeek, budgetWeekly, momentum, curWeek) : 0;

                            // Merge budget weeks into display weeks
                            const budgetWeeks = Object.keys(budgetWeekly).map(Number);
                            const allWeekNums = [...new Set([...byWeekKgHa.map(w => w.week), ...budgetWeeks])].sort((a, b) => weekOrder(a) - weekOrder(b));
                            const displayWeeks = allWeekNums.map(wn => {
                                const existing = byWeekKgHa.find(w => w.week === wn);
                                return existing || { week: wn, kg: 0, lots: 0, byVar: {}, byVarEst: {}, kgExport: 0, kgEcart: 0, kgha: 0 };
                            });

                            const budgetValsArr = displayWeeks.map(w => budgetWeekly[w.week] || 0);
                            const projValsArr = displayWeeks.map(w => projection[w.week] || 0);
                            const isWeekKgHa = weekChartMode === 'kgha';
                            const isWeekKgPlant = weekChartMode === 'kgplant';
                            const weekBarVals = displayWeeks.map(w => isWeekKgPlant ? w.kgplant : isWeekKgHa ? w.kgha : w.kg);
                            const allVals = [...weekBarVals, ...(isWeekKgHa ? [...budgetValsArr, ...projValsArr] : [])].filter(v => v > 0);
                            const maxVal = allVals.length > 0 ? Math.max(...allVals) : (isWeekKgPlant ? 0.001 : 1);
                            const barH = 200;
                            const barW = Math.max(32, Math.min(50, 600 / (displayWeeks.length || 1)));
                            const hasBudget = budgetValsArr.some(v => v > 0);
                            // Myrtille: compute kg/plant equivalents
                            const resolvedBudgetVar = matchedVariety ? normalizeParcelle(matchedVariety) : null;
                            const isBudgetMyrtille = resolvedBudgetVar && resolvedBudgetVar.culture === 'Myrtille';
                            const budgetPlants = isBudgetMyrtille ? getPlants(matchedVariety, null, 2) : 0;
                            const objectifKgPlant = isBudgetMyrtille && budgetPlants > 0 ? (bgfTotal * chartTotalHa / budgetPlants) : 0;
                            const atterrissageKgPlant = isBudgetMyrtille && budgetPlants > 0 ? (atterrissage * chartTotalHa / budgetPlants) : 0;
                            const fmtPlant = (v) => v < 1 ? Math.round(v * 1000) + ' g/pl' : v.toFixed(2) + ' kg/pl';

                            return (
                                <div ref={weekChartScrollRef} style={{overflowX:'auto'}}>
                                    {/* Atterrissage KPI */}
                                    {isWeekKgHa && hasBudget && (
                                        <div style={{display:'flex', gap:12, marginBottom:12, flexWrap:'wrap'}}>
                                            <div style={{background:'#fdf2f8', borderRadius:10, padding:'8px 14px', display:'flex', gap:8, alignItems:'center'}}>
                                                <i className="fas fa-bullseye" style={{color:'#e91e8f', fontSize:13}}></i>
                                                <div><div style={{fontSize:9, color:'#999', fontWeight:600}}>OBJECTIF BGF</div><div style={{fontSize:14, fontWeight:700}}>{bgfTotal.toLocaleString()} kg/ha</div>{isBudgetMyrtille && budgetPlants > 0 && <div style={{fontSize:11, color:'#e91e8f', fontWeight:600}}>{fmtPlant(objectifKgPlant)}</div>}</div>
                                            </div>
                                            <div style={{background:'#f0fdf4', borderRadius:10, padding:'8px 14px', display:'flex', gap:8, alignItems:'center'}}>
                                                <i className="fas fa-plane-arrival" style={{color:'#22c55e', fontSize:13}}></i>
                                                <div><div style={{fontSize:9, color:'#999', fontWeight:600}}>ATTERRISSAGE</div><div style={{fontSize:14, fontWeight:700}}>{atterrissage.toLocaleString()} kg/ha</div>{isBudgetMyrtille && budgetPlants > 0 && <div style={{fontSize:11, color:'#22c55e', fontWeight:600}}>{fmtPlant(atterrissageKgPlant)}</div>}</div>
                                            </div>
                                            <div style={{background: momentum >= 1 ? '#f0fdf4' : '#fef2f2', borderRadius:10, padding:'8px 14px', display:'flex', gap:8, alignItems:'center'}}>
                                                <i className="fas fa-gauge-high" style={{color: momentum >= 1 ? '#22c55e' : '#ef4444', fontSize:13}}></i>
                                                <div><div style={{fontSize:9, color:'#999', fontWeight:600}}>MOMENTUM</div><div style={{fontSize:14, fontWeight:700, color: momentum >= 1 ? '#22c55e' : '#ef4444'}}>{(momentum * 100).toFixed(0)}%</div></div>
                                            </div>
                                            <div style={{background:'#eff6ff', borderRadius:10, padding:'8px 14px', display:'flex', gap:8, alignItems:'center'}}>
                                                <i className="fas fa-leaf" style={{color:'#3b82f6', fontSize:13}}></i>
                                                <div><div style={{fontSize:9, color:'#999', fontWeight:600}}>VARIÉTÉ</div><div style={{fontSize:14, fontWeight:700}}>{matchedVariety}</div></div>
                                            </div>
                                        </div>
                                    )}
                                    {/* Y-axis scale */}
                                    {(() => {
                                        const yAxisLeft = 40;
                                        const ticks = 5;
                                        const fmtAxis = (v) => isWeekKgPlant
                                            ? (weekKgPlantInGrams ? Math.round(v * 1000).toLocaleString() : v.toFixed(2))
                                            : Math.round(v).toLocaleString();
                                        const yLabels = Array.from({length: ticks + 1}, (_, i) => maxVal / ticks * (ticks - i));
                                        return (
                                            <div style={{display:'flex', padding:'16px 0 0'}}>
                                                {/* Y axis labels */}
                                                <div style={{width: yAxisLeft, display:'flex', flexDirection:'column', justifyContent:'space-between', height: barH, paddingRight:4, flexShrink:0}}>
                                                    {yLabels.map((v, i) => (
                                                        <div key={i} style={{fontSize:8, color:'var(--gray-400)', textAlign:'right', lineHeight:'1', fontWeight:600}}>{fmtAxis(v)}</div>
                                                    ))}
                                                </div>
                                                {/* Chart area with fixed height container */}
                                                <div style={{position:'relative', flex:1, minWidth:0}}>
                                                    {/* Grid lines */}
                                                    <svg style={{position:'absolute', top:0, left:0, width:'100%', height: barH, pointerEvents:'none'}}>
                                                        {yLabels.map((_, i) => {
                                                            const y = (barH / ticks) * i;
                                                            return <line key={i} x1="0" y1={y} x2="100%" y2={y} stroke="var(--gray-200)" strokeWidth="0.5" strokeDasharray="4,4" />;
                                                        })}
                                                    </svg>
                                                    {/* Bars — labels outside, bars inside fixed-height area */}
                                                    <div style={{display:'flex', alignItems:'flex-end', gap:4, height: barH}}>
                                                        {displayWeeks.map((w, i) => {
                                                            const wVal = isWeekKgPlant ? w.kgplant : isWeekKgHa ? w.kgha : w.kg;
                                                            const h = maxVal > 0 ? (wVal / maxVal * barH) : 0;
                                                            const ecartPct = (showEcarts && w.kg > 0) ? Math.round(w.kgEcart / w.kg * 100) : 0;
                                                            return (
                                                                <div key={i} style={{display:'flex', flexDirection:'column', alignItems:'center', flex:`0 0 ${barW}px`, position:'relative', height:'100%', justifyContent:'flex-end', cursor:'pointer'}} onClick={() => { setPopupBonsFilter({type:'week', value:w.week}); setKpiPopup('tonnage'); }}>
                                                                    <div style={{width:barW * 0.7, borderRadius:'4px 4px 0 0', height:h, display:'flex', flexDirection:'column', justifyContent:'flex-end', overflow:'hidden', position:'relative'}}>
                                                                        {showEcarts ? (
                                                                            <>
                                                                                {w.kgExport > 0 && <div style={{width:'100%', height: w.kg > 0 ? (w.kgExport / w.kg * h) : 0, background:'#3498db'}}></div>}
                                                                                {w.kgEcart > 0 && <div style={{width:'100%', height: w.kg > 0 ? (w.kgEcart / w.kg * h) : 0, background:'#e67e22'}}></div>}
                                                                            </>
                                                                        ) : (
                                                                            allVarieties.map((v, vi) => {
                                                                                const vKg = w.byVar[v] || 0;
                                                                                const estKg = w.byVarEst?.[v] || 0;
                                                                                const realKg = vKg - estKg;
                                                                                const realH = w.kg > 0 ? (realKg / w.kg * h) : 0;
                                                                                const estH = w.kg > 0 ? (estKg / w.kg * h) : 0;
                                                                                const color = varColors[v] || '#999';
                                                                                return <React.Fragment key={vi}>
                                                                                    {realH > 0 && <div style={{width:'100%', height:realH, background:color}}></div>}
                                                                                    {estH > 0 && <div style={{width:'100%', height:estH, background:`repeating-linear-gradient(45deg, ${color}, ${color} 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 5px)`}}></div>}
                                                                                </React.Fragment>;
                                                                            })
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {/* Bar labels (above bars, positioned absolutely to not affect bar alignment) */}
                                                    <div style={{position:'absolute', top:0, left:0, display:'flex', gap:4, width:'100%', height: barH, pointerEvents:'none'}}>
                                                        {displayWeeks.map((w, i) => {
                                                            const wVal = isWeekKgPlant ? w.kgplant : isWeekKgHa ? w.kgha : w.kg;
                                                            const h = maxVal > 0 ? (wVal / maxVal * barH) : 0;
                                                            const ecartPct = (showEcarts && w.kg > 0) ? Math.round(w.kgEcart / w.kg * 100) : 0;
                                                            const lbl = isWeekKgPlant
                                                                ? (weekKgPlantInGrams ? Math.round(wVal * 1000).toLocaleString() : wVal.toFixed(2))
                                                                : Math.round(wVal).toLocaleString();
                                                            return (
                                                                <div key={i} style={{flex:`0 0 ${barW}px`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', height: barH - h, overflow:'visible'}}>
                                                                    {showEcarts && w.kgEcart > 0 && <div style={{fontSize:8, fontWeight:700, color:'#e67e22'}}>{ecartPct}%</div>}
                                                                    <div style={{fontSize:9, fontWeight:700, color:'var(--gray-600)'}}>{wVal > 0 ? lbl : ''}</div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {/* SVG overlay: Budget BGF curve + Projection curve */}
                                                    {isWeekKgHa && hasBudget && (
                                                        <svg style={{position:'absolute', top:0, left:0, width: displayWeeks.length * (barW + 4), height: barH, pointerEvents:'none'}}>
                                                {/* Budget BGF — rose solid */}
                                                <polyline
                                                    points={displayWeeks.reduce((pts, w, i) => {
                                                        if ((budgetWeekly[w.week] || 0) > 0) {
                                                            const x = i * (barW + 4) + barW * 0.35;
                                                            const y = barH - (budgetWeekly[w.week] / maxVal * barH);
                                                            pts.push(`${x},${y}`);
                                                        }
                                                        return pts;
                                                    }, []).join(' ')}
                                                    fill="none" stroke="#e91e8f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                                />
                                                {/* Projection — solid for past, dashed for future */}
                                                {(() => {
                                                    const pastPoints = [];
                                                    const futurePoints = [];
                                                    displayWeeks.forEach((w, i) => {
                                                        const val = projection[w.week];
                                                        if (val === undefined || val <= 0) return;
                                                        const x = i * (barW + 4) + barW * 0.35;
                                                        const y = barH - (val / maxVal * barH);
                                                        if (weekOrder(w.week) < weekOrder(curWeek)) pastPoints.push(`${x},${y}`);
                                                        else futurePoints.push(`${x},${y}`);
                                                    });
                                                    // Connect: last past point is also first of future
                                                    const bridgePoint = pastPoints.length > 0 ? pastPoints[pastPoints.length - 1] : null;
                                                    return (
                                                        <>
                                                            {pastPoints.length > 0 && (
                                                                <polyline points={pastPoints.join(' ')} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                                            )}
                                                            {futurePoints.length > 0 && (
                                                                <polyline points={[bridgePoint, ...futurePoints].filter(Boolean).join(' ')} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6,4" />
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                                {/* Dots */}
                                                {displayWeeks.map((w, i) => {
                                                    const x = i * (barW + 4) + barW * 0.35;
                                                    const bv = budgetWeekly[w.week] || 0;
                                                    const pv = projection[w.week] || 0;
                                                    return (
                                                        <React.Fragment key={i}>
                                                            {bv > 0 && <circle cx={x} cy={barH - (bv / maxVal * barH)} r="3" fill="#e91e8f" />}
                                                            {pv > 0 && <circle cx={x} cy={barH - (pv / maxVal * barH)} r="3" fill="#22c55e" opacity={w.week > curWeek ? 0.6 : 1} />}
                                                        </React.Fragment>
                                                    );
                                                })}
                                                        </svg>
                                                    )}
                                                    {/* X-axis week labels */}
                                                    <div style={{display:'flex', gap:4, marginTop:5}}>
                                                        {displayWeeks.map((w, i) => (
                                                            <div key={i} style={{flex:`0 0 ${barW}px`, textAlign:'center', fontSize:9, fontWeight:700, color:'var(--berry)', whiteSpace:'nowrap', cursor:'pointer'}} onClick={() => { setPopupBonsFilter({type:'week', value:w.week}); setKpiPopup('tonnage'); }}>W{w.week}</div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    {/* Legend */}
                                    <div style={{display:'flex', gap:16, justifyContent:'center', marginTop:8, paddingBottom:8, flexWrap:'wrap'}}>
                                        {showEcarts ? (
                                            <>
                                                <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                    <span style={{width:10, height:10, borderRadius:2, background:'#3498db', display:'inline-block'}}></span>
                                                    <span style={{fontWeight:600}}>Export</span>
                                                </div>
                                                <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                    <span style={{width:10, height:10, borderRadius:2, background:'#e67e22', display:'inline-block'}}></span>
                                                    <span style={{fontWeight:600, color:'#e67e22'}}>Écarts (non Export)</span>
                                                </div>
                                            </>
                                        ) : (
                                            allVarieties.map(v => (
                                                <div key={v} style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                    <span style={{width:10, height:10, borderRadius:2, background:varColors[v] || '#999', display:'inline-block'}}></span>
                                                    {v}
                                                </div>
                                            ))
                                        )}
                                        {hasBudget && (
                                            <>
                                                <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                    <span style={{width:16, height:3, background:'#e91e8f', borderRadius:2, display:'inline-block'}}></span>
                                                    <span style={{fontWeight:600, color:'#e91e8f'}}>Budget BGF</span>
                                                </div>
                                                <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                    <span style={{width:16, height:3, background:'#22c55e', borderRadius:2, display:'inline-block'}}></span>
                                                    <span style={{fontWeight:600, color:'#22c55e'}}>Réel Export</span>
                                                </div>
                                                <div style={{display:'flex', alignItems:'center', gap:4, fontSize:11}}>
                                                    <span style={{width:16, height:3, background:'#22c55e', borderRadius:2, display:'inline-block', borderTop:'2px dashed #22c55e'}}></span>
                                                    <span style={{fontWeight:600, color:'#22c55e', opacity:0.7}}>Projection</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                    </Panel>

                    {/* Tableau détaillé par semaine */}
                    <Panel title="Détail Hebdomadaire" icon="fa-table">
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Semaine</th>
                                    <th>Période</th>
                                    <th>Bons</th>
                                    <th>Production (kg)</th>
                                    {allVarieties.map(v => <th key={v}>{v}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {byWeek.map((w, i) => (
                                    <tr key={i} style={{cursor:'pointer', transition:'background 0.15s'}} onClick={() => { setPopupBonsFilter({type:'week', value:w.week}); setKpiPopup('tonnage'); }} onMouseEnter={e => e.currentTarget.style.background='#e8eaf6'} onMouseLeave={e => e.currentTarget.style.background=''}>
                                        <td><strong style={{color:'var(--berry)'}}>W{w.week}</strong></td>
                                        <td style={{fontSize:11, color:'var(--gray-500)'}}>{weekRange(w.week)}</td>
                                        <td>{w.lots}</td>
                                        <td><strong>{Math.round(w.kg).toLocaleString()} kg</strong></td>
                                        {allVarieties.map(v => (
                                            <td key={v} style={{fontWeight: (w.byVar[v] || 0) > 0 ? 600 : 400, color: (w.byVar[v] || 0) > 0 ? 'var(--gray-800)' : 'var(--gray-300)'}}>
                                                {(w.byVar[v] || 0) > 0 ? Math.round(w.byVar[v]).toLocaleString() + ' kg' : '-'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                                <tr style={{background:'var(--gray-50)', fontWeight:700}}>
                                    <td>TOTAL</td>
                                    <td></td>
                                    <td>{filtered.length}</td>
                                    <td>{Math.round(totalKg).toLocaleString()} kg</td>
                                    {allVarieties.map(v => {
                                        const vTotal = byWeek.reduce((s, w) => s + (w.byVar[v] || 0), 0);
                                        return <td key={v}>{vTotal > 0 ? Math.round(vTotal).toLocaleString() + ' kg' : '-'}</td>;
                                    })}
                                </tr>
                            </tbody>
                        </table>
                        </div>
                    </Panel>

                    {/* Tableau détaillé par jour */}
                    <Panel title="Détail Journalier" icon="fa-calendar-day">
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Bons</th>
                                    <th>Production (kg)</th>
                                    {allVarieties.map(v => <th key={v}>{v}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {byDay.map((d, i) => (
                                    <tr key={i}>
                                        <td><strong style={{color:'var(--berry)'}}>{d.label}</strong></td>
                                        <td>{d.lots}</td>
                                        <td><strong>{Math.round(d.kg).toLocaleString()} kg</strong></td>
                                        {allVarieties.map(v => (
                                            <td key={v} style={{fontWeight: (d.byVar[v] || 0) > 0 ? 600 : 400, color: (d.byVar[v] || 0) > 0 ? 'var(--gray-800)' : 'var(--gray-300)'}}>
                                                {(d.byVar[v] || 0) > 0 ? Math.round(d.byVar[v]).toLocaleString() + ' kg' : '-'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                                <tr style={{background:'var(--gray-50)', fontWeight:700}}>
                                    <td>TOTAL</td>
                                    <td>{filtered.length}</td>
                                    <td>{Math.round(totalKg).toLocaleString()} kg</td>
                                    {allVarieties.map(v => {
                                        const vTotal = byDay.reduce((s, d) => s + (d.byVar[v] || 0), 0);
                                        return <td key={v}>{vTotal > 0 ? Math.round(vTotal).toLocaleString() + ' kg' : '-'}</td>;
                                    })}
                                </tr>
                            </tbody>
                        </table>
                        </div>
                    </Panel>
                </div>
            );
        }

export { QualiteProductionTab };
