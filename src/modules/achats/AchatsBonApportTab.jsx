/* Module: achats | Déclaration(s): AchatsBonApportTab */
import { PARCELLES_CULTURALES } from '../agronomie/PARCELLES_CULTURALES.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { getActiveMarcheLocalClients } from '../shared/getActiveMarcheLocalClients.jsx';
import { __set_bonsCache, loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: BONS D'APPORT TAB =====================
        function AchatsBonApportTab({ currentProfile, profileData }) {
            const [bonsList, setBonsList] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [filterStatus, setFilterStatus] = useState('');
            const [filterFerme, setFilterFerme] = useState('');
            const [filterDate, setFilterDate] = useState('');
            const [reloadKey, setReloadKey] = useState(0);
            const [bonType, setBonType] = useState('export');
            const [localLignes, setLocalLignes] = useState([{ designation: '', quantiteKg: '' }]);
            const [editingBon, setEditingBon] = useState(null);
            const [saving, setSaving] = useState(false);
            const [selectedBon, setSelectedBon] = useState(null);
            const [selectedIds, setSelectedIds] = useState(new Set());
            const [selectMode, setSelectMode] = useState(false);
            const [scanPreview, setScanPreview] = useState(null);
            const scanFileRef = React.useRef(null);
            const [serialCheck, setSerialCheck] = useState(null);
            const [serialFerme, setSerialFerme] = useState('');
            const [showScanModal, setShowScanModal] = useState(false);
            const [scanQueue, setScanQueue] = useState([]); // [{file, preview, status, analysis, scan_url}]
            const [scanProcessing, setScanProcessing] = useState(false);
            const [zoomImage, setZoomImage] = useState(null); // URL of image to show in lightbox
            const scanDropRef = React.useRef(null);
            const [serialLoading, setSerialLoading] = useState(false);
            const [marcheLocalClients, setMarcheLocalClients] = useState([]);
            const [showCreateClient, setShowCreateClient] = useState(false);
            const [newClientName, setNewClientName] = useState('');
            const [creatingClient, setCreatingClient] = useState(false);

            // Charger les clients marché local depuis Firestore
            const loadMarcheLocalClients = async () => {
                try {
                    const db = firebase.firestore();
                    let fromBons = [];
                    try {
                        const snap = await db.collection('bons_marche_local').orderBy('createdAt', 'desc').limit(500).get();
                        fromBons = snap.docs.map(d => d.data().client).filter(Boolean);
                    } catch(e) {
                        // Fallback without orderBy if index missing
                        try {
                            const snap = await db.collection('bons_marche_local').limit(500).get();
                            fromBons = snap.docs.map(d => d.data().client).filter(Boolean);
                        } catch(e2) {}
                    }
                    let fromCollection = [];
                    let archivedNames = new Set();
                    try {
                        // Lecture centralisée via le helper : exclut les clients archivés
                        // (filtre côté code). Le filtre ne peut plus être oublié ici.
                        const ref = await getActiveMarcheLocalClients(db);
                        fromCollection = ref.active.map(d => d.nom).filter(Boolean);
                        archivedNames = ref.archivedNames;
                    } catch(e) {}
                    // Auto-seed front retiré (étape 2b) : il réintroduisait IMAD/AMIN et
                    // des doublons, divergeant du référentiel canonique. Le seed est
                    // désormais géré exclusivement par le backend tracké
                    // functions/scripts/seedComptesClientsMarcheLocal.js (5 clients).
                    // Les noms issus de l'historique des bons sont aussi filtrés des
                    // clients archivés pour ne jamais réafficher IMAD/AMIN/doublons.
                    const clients = [...new Set([...fromBons, ...fromCollection])]
                        .filter(n => !archivedNames.has(n))
                        .sort();
                    setMarcheLocalClients(clients);
                } catch(e) { console.error('Error loading marché local clients:', e); }
            };
            useEffect(() => { loadMarcheLocalClients(); }, []);

            const handleCreateClient = async () => {
                if (!newClientName.trim()) return alert('Le nom du client est requis');
                setCreatingClient(true);
                try {
                    await firebase.firestore().collection('clients_marche_local').add({
                        nom: newClientName.trim(),
                        createdAt: Date.now(),
                        createdBy: { profileId: currentProfile, name: profileData?.fullName || currentProfile }
                    });
                    await loadMarcheLocalClients();
                    setShowCreateClient(false);
                    setNewClientName('');
                } catch(e) { alert('Erreur lors de la création du client'); }
                setCreatingClient(false);
            };

            const checkSerialNumbers = async (fermeFilter) => {
                setSerialLoading(true);
                try {
                    let allBons = bonsList.length > 0 ? bonsList : [];
                    if (allBons.length === 0) {
                        try { allBons = await loadBonsFromFirestore(); } catch(e) {}
                    }
                    if (fermeFilter) allBons = allBons.filter(b => (b.blocFerme || b.ferme) === fermeFilter);

                    const nums = []; const ignored = []; const seen = {}; const doublons = [];
                    allBons.forEach(b => {
                        const raw = (b.bonApport || b.numeroPiece || '').toString().trim();
                        const n = parseInt(raw, 10);
                        if (!raw || isNaN(n)) { ignored.push(raw || '(vide)'); return; }
                        if (seen[n]) { doublons.push(n); } else { seen[n] = true; }
                        nums.push(n);
                    });
                    const unique = [...new Set(nums)].sort((a, b) => a - b);
                    if (unique.length === 0) { setSerialCheck({ souches: [], ignored, doublons, total: 0, ferme: fermeFilter || 'Toutes' }); setSerialLoading(false); return; }
                    // Regrouper en souches (gap > 50 = nouvelle souche)
                    const souches = [];
                    let current = { nums: [unique[0]] };
                    for (let i = 1; i < unique.length; i++) {
                        if (unique[i] - unique[i - 1] > 50) {
                            souches.push(current);
                            current = { nums: [unique[i]] };
                        } else {
                            current.nums.push(unique[i]);
                        }
                    }
                    souches.push(current);
                    // Analyser chaque souche
                    const result = souches.map((s, idx) => {
                        const min = s.nums[0], max = s.nums[s.nums.length - 1];
                        const set = new Set(s.nums);
                        const missing = [];
                        for (let n = min; n <= max; n++) { if (!set.has(n)) missing.push(n); }
                        // Grouper les manquants en plages
                        const ranges = [];
                        let rStart = null, rEnd = null;
                        missing.forEach((m, i) => {
                            if (rStart === null) { rStart = m; rEnd = m; }
                            else if (m === rEnd + 1) { rEnd = m; }
                            else { ranges.push({ from: rStart, to: rEnd, count: rEnd - rStart + 1 }); rStart = m; rEnd = m; }
                            if (i === missing.length - 1) ranges.push({ from: rStart, to: rEnd, count: rEnd - rStart + 1 });
                        });
                        return { id: idx + 1, min, max, count: s.nums.length, expected: max - min + 1, missing: missing.length, ranges };
                    });
                    setSerialCheck({ souches: result, ignored, doublons: [...new Set(doublons)], total: unique.length, ferme: fermeFilter || 'Toutes' });
                } catch (err) { console.error('Serial check error:', err); alert('Erreur: ' + err.message); }
                setSerialLoading(false);
            };

            const VARIETES = ['Maravilla Green Cane','Maravilla Long Cane','Cascade','Breeze','Corina','Yazmin Cut Back'];

            const DEFAULT_CONFECTIONS = [
                { id: '12x125g', label: '12 x 125g Standard', poidsParColis: 1.5, composition: [
                    { article: 'Carton 12x125g', qte: 1 }, { article: 'Barquette 125g', qte: 12 }, { article: 'Couvercle 125g', qte: 12 },
                ]},
            ];
            const [confectionTypes, setConfectionTypes] = useState(DEFAULT_CONFECTIONS);
            const [showConfectionConfig, setShowConfectionConfig] = useState(false);
            const [editingConfIdx, setEditingConfIdx] = useState(null);
            const [scanCorrections, setScanCorrections] = useState([]);

            useEffect(() => {
                // Charger confection types (Firestore + BEEONE)
                const loadConfections = async () => {
                    try {
                        const doc = await firebase.firestore().collection('app_settings').doc('confection_types').get();
                        const manualTypes = (doc.exists && doc.data().types?.length > 0) ? doc.data().types : DEFAULT_CONFECTIONS;
                        // Charger les confections BEEONE
                        try {
                            const resp = await fetch('/api/pointage-rh?action=confection-types');
                            const json = await resp.json();
                            if (json.success && json.types?.length > 0) {
                                // Merger : BEEONE en premier, puis les types manuels non-dupliqués
                                const beeoneIds = new Set(json.types.map(t => t.id));
                                const merged = [...json.types, ...manualTypes.filter(t => !beeoneIds.has(t.id))];
                                setConfectionTypes(merged);
                                return;
                            }
                        } catch(e) { console.warn('BEEONE confections unavailable:', e); }
                        setConfectionTypes(manualTypes);
                    } catch(e) { console.warn('Confection types load error:', e); }
                };
                loadConfections();
                // Charger les corrections self-learning
                firebase.firestore().collection('scan_corrections')
                    .orderBy('timestamp', 'desc').limit(100).get()
                    .then(snap => {
                        const corrections = [];
                        const seen = new Set();
                        snap.docs.forEach(d => {
                            const data = d.data();
                            const key = data.originalVariete?.toUpperCase();
                            if (key && !seen.has(key)) {
                                seen.add(key);
                                corrections.push(data);
                            }
                        });
                        setScanCorrections(corrections);
                    }).catch(() => {});
            }, []);

            const saveConfTypes = async (types) => {
                setConfectionTypes(types);
                try { await firebase.firestore().collection('app_settings').doc('confection_types').set({ types, updatedAt: new Date().toISOString() }); } catch(e) { console.error(e); }
            };
            // S'assurer que "Vrac 1 kg" existe toujours dans les confection types
            useEffect(() => {
                if (confectionTypes.length > 0 && !confectionTypes.find(c => c.id === 'vrac_1kg')) {
                    saveConfTypes([...confectionTypes, { id: 'vrac_1kg', label: 'Vrac 1 kg', poidsParColis: 1, composition: [] }]);
                }
            }, [confectionTypes.length]);

            const getConfByType = (typeId) => confectionTypes.find(c => c.id === typeId);

            const handleTypeChange = (typeId) => {
                if (typeId === '__add__') {
                    const label = prompt('Nom du nouveau type (ex: 6 x 170g Premium):');
                    if (!label) return;
                    const poids = prompt('Poids par colis en KG (ex: 1.02):');
                    if (!poids || isNaN(parseFloat(poids))) { alert('Poids invalide'); return; }
                    const newType = { id: label.replace(/\s+/g,'_').toLowerCase(), label, poidsParColis: parseFloat(poids), composition: [] };
                    saveConfTypes([...confectionTypes, newType]);
                    setForm(f => ({ ...f, typeUnite: newType.id, qteParUnite: label }));
                    return;
                }
                const conf = getConfByType(typeId);
                setForm(f => {
                    const nbColis = parseInt(f.nombreColis) || 0;
                    const poids = conf ? (nbColis * conf.poidsParColis) : '';
                    return { ...f, typeUnite: typeId, qteParUnite: conf?.label || '', quantiteKg: poids ? poids.toFixed(1) : f.quantiteKg };
                });
            };

            const handleColisChange = (val) => {
                const nbColis = parseInt(val) || 0;
                const conf = getConfByType(form.typeUnite);
                const poids = conf ? (nbColis * conf.poidsParColis) : '';
                setForm(f => ({ ...f, nombreColis: val, quantiteKg: poids ? poids.toFixed(1) : f.quantiteKg }));
            };

            const emptyForm = {
                numeroPiece: '', ferme: 'F1', produit: 'Framboise', parcelle: '', date: '',
                designation: '', client: "Driscoll's",
                typeUnite: '', nombreColis: '', qteParUnite: '', quantiteKg: '',
                prixDH: '', totalDH: '',
            };
            const [form, setForm] = useState({ ...emptyForm });

            const statusLabels = { soumis: 'Soumis', valide_qualite: 'Validé Qualité', rejete_qualite: 'Rejeté Qualité', valide: 'Validé', rejete_chef: 'Rejeté Chef', import_excel: 'Importation Excel', app_created: 'Créés dans l\'app' };
            const statusColors = { soumis: '#f47920', valide_qualite: '#1565C0', rejete_qualite: '#dc2626', valide: '#22c55e', rejete_chef: '#dc2626', import_excel: '#6a1b9a', app_created: '#e65100' };
            const [sortCol, setSortCol] = useState('date');
            const [sortDir, setSortDir] = useState('desc');
            const fStyle = {width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:13};
            const lStyle = {fontSize:11,fontWeight:600,display:'block',marginBottom:4};

            useEffect(() => {
                const load = async () => {
                    setLoading(true);
                    let allBons = [];
                    try {
                        allBons = (await loadBonsFromFirestore()).map(b => {
                            if (b.source === 'bulk_upload' || (!b.source && !b.status)) b.status = 'import_excel';
                            return b;
                        });
                    } catch(e) {
                        console.warn('[BonsApport] Firestore failed:', e);
                    }
                    let filtered = allBons;
                    if (filterDate) filtered = filtered.filter(b => b.date === filterDate);
                    if (filterFerme) filtered = filtered.filter(b => (b.blocFerme || b.ferme) === filterFerme);
                    if (filterStatus === 'app_created') filtered = filtered.filter(b => b.source === 'manual_entry' || b.source === 'scan_ocr');
                    else if (filterStatus) filtered = filtered.filter(b => (b.status || 'import_excel') === filterStatus);
                    setBonsList(filtered);
                    setLoading(false);
                };
                load();
            }, [filterStatus, filterFerme, filterDate, reloadKey]);
            const loadAllBons = () => { setReloadKey(k => k + 1); };

            const handleScanSelect = (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { alert('Fichier trop volumineux (max 5 MB)'); return; }
                const reader = new FileReader();
                reader.onload = (ev) => setScanPreview(ev.target.result);
                reader.readAsDataURL(file);
            };

            const handleSubmit = async () => {
                // Marché Local multi-variété
                if (bonType === 'local' && !editingBon) {
                    const validLignes = localLignes.filter(l => l.designation && parseFloat(l.quantiteKg) > 0);
                    if (!form.numeroPiece || !form.date || !form.ferme || validLignes.length === 0) {
                        alert('Veuillez remplir le N° Bon, la Date, la Ferme et au moins une variété avec un poids.'); return;
                    }
                    setSaving(true);
                    try {
                        const db = firebase.firestore();
                        for (const ligne of validLignes) {
                            const pc = PARCELLES_CULTURALES.find(p => p.designations?.[0] === ligne.designation);
                            const poidsKg = parseFloat(ligne.quantiteKg) || 0;
                            const record = {
                                source: scanPreview ? 'scan_ocr' : 'manual_entry',
                                bonApport: form.numeroPiece,
                                blocFerme: pc ? pc.ferme : form.ferme,
                                produit: pc ? pc.culture : form.produit,
                                bloc: form.parcelle,
                                date: form.date,
                                designation: ligne.designation,
                                blocVariete: ligne.designation,
                                blocLabel: ligne.designation,
                                typeVente: 'Marché Local',
                                client: form.client,
                                typeUnite: form.typeUnite,
                                nombreColis: Math.round(poidsKg / ((getConfByType(form.typeUnite) || {}).poidsParColis || 1)),
                                qteParUnite: form.qteParUnite,
                                poidsLot: poidsKg,
                                prixDH: parseFloat(form.prixDH) || 0,
                                totalDH: form.prixDH ? Math.round(parseFloat(form.prixDH) * poidsKg * 100) / 100 : 0,
                                scanPhoto: scanPreview || null,
                                status: 'soumis',
                                motifRejet: '',
                                createdBy: { profileId: currentProfile, name: profileData?.name || currentProfile },
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                validatedByQualite: null, validatedByChef: null,
                                validatedAtQualite: null, validatedAtChef: null,
                                pfqGlobal: null, barquettes: [], totalFruits: 0,
                                semaine: '', confection: '', controleur: '',
                            };
                            await db.collection('pfq_interne').add(record);
                        }
                        setShowForm(false);
                        setEditingBon(null);
                        setScanPreview(null);
                        setForm({ ...emptyForm });
                        setLocalLignes([{ designation: '', quantiteKg: '' }]);
                        setReloadKey(k => k + 1);
                    } catch (err) { alert('Erreur: ' + err.message); }
                    setSaving(false);
                    return;
                }

                // Export ou édition Marché Local (single)
                if (!form.numeroPiece || !form.designation || !form.quantiteKg || !form.date || !form.ferme) {
                    alert('Veuillez remplir tous les champs obligatoires (N° Bon, Variété, Quantité, Date, Ferme)'); return;
                }
                // Vérification doublon (sauf en mode édition)
                if (!editingBon) {
                    const doublon = bonsList.find(b =>
                        String(b.bonApport || b.numeroPiece) === String(form.numeroPiece) &&
                        (b.designation || '').toUpperCase() === (form.designation || '').toUpperCase()
                    );
                    if (doublon) {
                        const confirmAdd = confirm(`⚠️ Un bon N° ${form.numeroPiece} avec la variété "${form.designation}" existe déjà (${doublon.date}, ${(doublon.poidsLot || doublon.quantiteKg || 0)} kg).\n\nVoulez-vous quand même l'ajouter ?`);
                        if (!confirmAdd) return;
                    }
                }
                setSaving(true);
                try {
                    const db = firebase.firestore();
                    const record = {
                        source: scanPreview ? 'scan_ocr' : 'manual_entry',
                        bonApport: form.numeroPiece,
                        blocFerme: form.ferme,
                        produit: form.produit,
                        bloc: form.parcelle,
                        date: form.date,
                        designation: form.designation,
                        blocVariete: form.designation,
                        blocLabel: form.designation,
                        typeVente: bonType === 'export' ? 'Export' : 'Marché Local',
                        client: form.client,
                        typeUnite: form.typeUnite,
                        nombreColis: parseInt(form.nombreColis) || 0,
                        qteParUnite: form.qteParUnite,
                        poidsLot: parseFloat(form.quantiteKg) || 0,
                        prixDH: bonType === 'local' ? (parseFloat(form.prixDH) || 0) : null,
                        totalDH: bonType === 'local' ? (parseFloat(form.totalDH) || 0) : null,
                        scanPhoto: scanPreview || (editingBon?.scanPhoto || null),
                        status: 'soumis',
                        motifRejet: '',
                        createdBy: { profileId: currentProfile, name: profileData?.name || currentProfile },
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        validatedByQualite: null, validatedByChef: null,
                        validatedAtQualite: null, validatedAtChef: null,
                        pfqGlobal: null, barquettes: [], totalFruits: 0,
                        semaine: '', confection: '', controleur: '',
                    };
                    if (editingBon) {
                        await db.collection('pfq_interne').doc(editingBon.id).update({ ...record, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                    } else {
                        record.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                        await db.collection('pfq_interne').add(record);
                    }
                    setShowForm(false);
                    setEditingBon(null);
                    setScanPreview(null);
                    setForm({ ...emptyForm });
                    // Cache supprimé — Firestore = source de vérité
                    setReloadKey(k => k + 1);
                } catch (err) { alert('Erreur: ' + err.message); }
                setSaving(false);
            };

            const handleEdit = (bon) => {
                setEditingBon(bon);
                setBonType(bon.typeVente === 'Export' ? 'export' : (bon.typeVente === 'Marché Local' ? 'local' : (bon.type || 'export')));
                setScanPreview(bon.scanPhoto || null);
                setForm({
                    numeroPiece: bon.bonApport || bon.numeroPiece || '', ferme: bon.blocFerme || bon.ferme || 'F1', produit: bon.produit || 'Framboise',
                    parcelle: bon.bloc || bon.parcelle || '', date: bon.date || '', designation: bon.designation || '',
                    client: bon.client || '',
                    typeUnite: bon.typeUnite || '', nombreColis: bon.nombreColis || '', qteParUnite: bon.qteParUnite || '',
                    quantiteKg: bon.poidsLot || bon.quantiteKg || '', prixDH: bon.prixDH || '', totalDH: bon.totalDH || '',
                });
                setShowForm(true);
            };

            const handleNewBon = () => {
                setEditingBon(null);
                setBonType('export');
                setScanPreview(null);
                setForm({ ...emptyForm });
                setShowForm(true);
            };

            // ---- SCAN EN VRAC ----
            const handleScanFiles = (files) => {
                const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
                if (validFiles.length === 0) { alert('Veuillez déposer des images (JPG, PNG)'); return; }
                const newQueue = validFiles.map(f => ({
                    file: f,
                    preview: URL.createObjectURL(f),
                    status: 'pending', // pending, processing, done, error
                    analysis: null,
                    scan_url: null,
                }));
                setScanQueue(prev => [...prev, ...newQueue]);
            };

            // Détecter les fichiers partagés via Web Share Target (depuis WhatsApp, etc.)
            useEffect(() => {
                const params = new URLSearchParams(window.location.search);
                if (params.get('share') !== 'bons') return;
                // Nettoyer l'URL
                window.history.replaceState({}, '', window.location.pathname);
                // Récupérer les fichiers depuis IndexedDB
                const loadSharedFiles = async () => {
                    try {
                        const db = await new Promise((resolve, reject) => {
                            const req = indexedDB.open('smart_berry_share', 1);
                            req.onupgradeneeded = () => { req.result.createObjectStore('shared_files', { autoIncrement: true }); };
                            req.onsuccess = () => resolve(req.result);
                            req.onerror = () => reject(req.error);
                        });
                        const tx = db.transaction('shared_files', 'readwrite');
                        const store = tx.objectStore('shared_files');
                        const allFiles = await new Promise((resolve, reject) => {
                            const req = store.getAll();
                            req.onsuccess = () => resolve(req.result);
                            req.onerror = () => reject(req.error);
                        });
                        // Vider le store après lecture
                        store.clear();
                        db.close();
                        if (allFiles.length > 0) {
                            const files = allFiles.map(f => f.file).filter(f => f && f.type && f.type.startsWith('image/'));
                            if (files.length > 0) {
                                handleScanFiles(files);
                            }
                        }
                    } catch(e) { console.warn('Share target: could not load shared files:', e); }
                };
                // Petit délai pour laisser l'app se charger
                setTimeout(loadSharedFiles, 500);
            }, []);

            // Lancer l'analyse automatiquement quand des bons pending arrivent
            useEffect(() => {
                if (scanQueue.some(s => s.status === 'pending') && !scanProcessing) {
                    processScanQueue();
                }
            }, [scanQueue.length]);

            const processScanQueue = async () => {
                setScanProcessing(true);
                const queue = [...scanQueue];
                for (let i = 0; i < queue.length; i++) {
                    if (queue[i].status !== 'pending') continue;
                    setScanQueue(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'processing' } : s));
                    try {
                        const base64 = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(queue[i].file);
                        });
                        const resp = await fetch('/api/stock?action=scan-bon-apport', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ scan_base64: base64, filename: queue[i].file.name }),
                        });
                        const result = await resp.json();
                        if (result.success) {
                            const a = result.analysis;
                            // Sauvegarder l'analyse originale pour le self-learning
                            const originalAnalysis = { ...a };
                            // Corriger ferme/variété via PARCELLES_CULTURALES
                            const scanVar = (a.variete || '').toUpperCase();
                            const matchedPC = PARCELLES_CULTURALES.find(p =>
                                p.cycle === 2 && p.enProduction !== false && (
                                    p.designations.some(d => d.toUpperCase() === scanVar) ||
                                    p.designations.some(d => scanVar.includes(d.toUpperCase())) ||
                                    p.designations.some(d => d.toUpperCase().includes(scanVar)) ||
                                    scanVar.includes(p.variete.toUpperCase())
                                )
                            );
                            if (matchedPC) {
                                a.ferme = matchedPC.ferme;
                                a.variete = matchedPC.designations[0];
                            } else {
                                // Fallback via normalizeParcelle
                                const norm = normalizeParcelle(a.variete);
                                if (norm) a.ferme = norm.ferme;
                            }
                            // Appliquer les corrections self-learning
                            if (scanCorrections.length > 0) {
                                const corr = scanCorrections.find(c => c.originalVariete?.toUpperCase() === scanVar);
                                if (corr) {
                                    if (corr.correctedVariete) a.variete = corr.correctedVariete;
                                    if (corr.correctedFerme) a.ferme = corr.correctedFerme;
                                    if (corr.correctedConfection) a.confection = corr.correctedConfection;
                                }
                            }
                            // Auto-détecter la confection depuis les lignes OCR
                            if (a.lignes?.length > 0 && !a.confection) {
                                const desc = a.lignes.map(l => (l.description || '')).join(' ').toUpperCase();
                                const matchedConf = confectionTypes.find(c => desc.includes(c.label.toUpperCase()));
                                if (matchedConf) a.confection = matchedConf.id;
                            }
                            // Pré-matcher les variétés par ligne pour Marché Local
                            if (a.type_vente === 'Marché Local' && a.lignes?.length > 0) {
                                a.confection = 'vrac_1kg';
                                a.lignes = a.lignes.map(l => {
                                    if (!l.variete) {
                                        const mp = matchVariete(l.description);
                                        if (mp) l.variete = mp.designations[0];
                                    } else {
                                        const mp = matchVariete(l.variete);
                                        if (mp) l.variete = mp.designations[0];
                                    }
                                    return l;
                                });
                            }
                            // Vérifier doublon
                            const isDuplicate = a?.numero_bon && bonsList.some(b =>
                                String(b.bonApport || b.numeroPiece) === String(a.numero_bon)
                            );
                            queue[i] = { ...queue[i], status: 'done', analysis: a, _originalAnalysis: originalAnalysis, scan_url: result.scan_url, isDuplicate };
                        } else {
                            queue[i] = { ...queue[i], status: 'error', error: result.error || 'Erreur inconnue' };
                        }
                    } catch (err) {
                        queue[i] = { ...queue[i], status: 'error', error: err.message };
                    }
                    setScanQueue([...queue]);
                }
                setScanProcessing(false);
            };

            const matchVariete = (rawVar) => {
                const v = (rawVar || '').toUpperCase();
                return PARCELLES_CULTURALES.find(p =>
                    p.cycle === 2 && p.enProduction !== false && (
                        p.designations.some(d => d.toUpperCase() === v) ||
                        p.designations.some(d => v.includes(d.toUpperCase())) ||
                        p.designations.some(d => d.toUpperCase().includes(v)) ||
                        v.includes(p.variete.toUpperCase())
                    )
                );
            };

            const editScanBon = (item) => {
                const a = item.analysis || {};
                const typeVente = (a.type_vente || 'Export');
                const isLocal = typeVente === 'Marché Local';
                setBonType(isLocal ? 'local' : 'export');

                const matchedParcelle = matchVariete(a.variete);
                const designation = matchedParcelle ? matchedParcelle.designations[0] : (a.variete || '');
                const ferme = matchedParcelle ? matchedParcelle.ferme : (a.ferme || 'F5');
                const produit = matchedParcelle ? matchedParcelle.culture : ((a.variete || '').toLowerCase().includes('myrtille') ? 'Myrtille' : 'Framboise');

                if (isLocal) {
                    // Multi-variété : essayer de détecter les variétés depuis les lignes OCR
                    const lignes = (a.lignes || []).filter(l => l.quantite_kg > 0);
                    if (lignes.length > 0) {
                        setLocalLignes(lignes.map(l => {
                            const mp = matchVariete(l.variete || l.description);
                            return { designation: mp ? mp.designations[0] : '', quantiteKg: String(l.quantite_kg || '') };
                        }));
                    } else {
                        setLocalLignes([{ designation, quantiteKg: a.poids_kg ? String(a.poids_kg) : '' }]);
                    }
                    setForm({
                        numeroPiece: a.numero_bon || '', ferme, produit,
                        parcelle: matchedParcelle ? matchedParcelle.id : '',
                        date: a.date || '', designation: '',
                        client: a.client || '',
                        typeUnite: 'vrac_1kg', qteParUnite: 'Vrac 1 kg',
                        nombreColis: '', quantiteKg: '', prixDH: '', totalDH: '',
                    });
                } else {
                    setForm({
                        numeroPiece: a.numero_bon || '', ferme, produit,
                        parcelle: matchedParcelle ? matchedParcelle.id : '',
                        date: a.date || '', designation,
                        client: a.client || "Driscoll's",
                        typeUnite: a.confection || '',
                        nombreColis: a.nombre_colis ? String(a.nombre_colis) : '',
                        qteParUnite: a.confection ? (confectionTypes.find(c => c.id === a.confection)?.label || '') : '',
                        quantiteKg: a.poids_kg ? String(a.poids_kg) : '',
                        prixDH: '', totalDH: '',
                    });
                }
                setScanPreview(item.scan_url || item.preview || null);
                setEditingBon(null);
                setShowForm(true);
                setScanQueue(prev => prev.filter(s => s !== item));
                if (scanQueue.length <= 1) setShowScanModal(false);
            };

            // Soumettre directement un bon scanné sans passer par le formulaire
            const submitScanBon = async (item) => {
                const a = item.analysis || {};
                if (!a.numero_bon) { alert('Numéro de bon manquant'); return; }
                const typeVente = (a.type_vente || 'Export');
                try {
                    const db = firebase.firestore();

                    // Marché Local multi-variété : créer un document par ligne avec variété
                    if (typeVente === 'Marché Local' && a.lignes?.length > 0) {
                        const validLignes = a.lignes.filter(l => (parseFloat(l.quantite_kg) || 0) > 0);
                        for (const ligne of validLignes) {
                            const mp = matchVariete(ligne.variete || ligne.description);
                            const designation = mp ? mp.designations[0] : (ligne.variete || a.variete || '');
                            const ferme = mp ? mp.ferme : (a.ferme || 'F5');
                            const produit = mp ? mp.culture : 'Framboise';
                            const poidsKg = parseFloat(ligne.quantite_kg) || 0;
                            const record = {
                                source: 'scan_ocr',
                                bonApport: a.numero_bon,
                                blocFerme: ferme, produit, bloc: mp ? mp.id : '',
                                date: a.date || '',
                                designation, blocVariete: designation, blocLabel: designation,
                                typeVente: 'Marché Local',
                                client: a.client || '',
                                typeUnite: 'vrac_1kg', qteParUnite: 'Vrac 1 kg',
                                nombreColis: Math.round(poidsKg),
                                poidsLot: poidsKg,
                                prixDH: null, totalDH: null,
                                scanPhoto: item.scan_url || null,
                                lignesDetail: [ligne],
                                status: 'soumis', motifRejet: '',
                                createdBy: { profileId: currentProfile, name: profileData?.name || '' },
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                                validatedByQualite: null, validatedByChef: null,
                                validatedAtQualite: null, validatedAtChef: null,
                                pfqGlobal: null, barquettes: [], totalFruits: 0,
                                semaine: a.semaine || '', confection: 'vrac_1kg', controleur: '',
                            };
                            await db.collection('pfq_interne').add(record);
                        }
                    } else {
                        // Export ou single-variété
                        const mp = matchVariete(a.variete);
                        const designation = mp ? mp.designations[0] : (a.variete || '');
                        const ferme = mp ? mp.ferme : (a.ferme || 'F5');
                        const produit = mp ? mp.culture : ((a.variete || '').toLowerCase().includes('myrtille') ? 'Myrtille' : 'Framboise');
                        const record = {
                            source: 'scan_ocr',
                            bonApport: a.numero_bon,
                            blocFerme: ferme, produit,
                            bloc: mp ? mp.id : '',
                            date: a.date || '',
                            designation, blocVariete: designation, blocLabel: designation,
                            typeVente: typeVente,
                            client: a.client || (typeVente === 'Export' ? "Driscoll's" : ''),
                            typeUnite: '',
                            nombreColis: a.nombre_colis_total || parseInt(a.nombre_colis) || 0,
                            qteParUnite: '',
                            poidsLot: parseFloat(a.poids_kg) || 0,
                            prixDH: null, totalDH: null,
                            scanPhoto: item.scan_url || null,
                            lignesDetail: a.lignes || [],
                            status: 'soumis', motifRejet: '',
                            createdBy: { profileId: currentProfile, name: profileData?.name || '' },
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            validatedByQualite: null, validatedByChef: null,
                            validatedAtQualite: null, validatedAtChef: null,
                            pfqGlobal: null, barquettes: [], totalFruits: 0,
                            semaine: a.semaine || '', confection: a.confection || '', controleur: '',
                        };
                        await db.collection('pfq_interne').add(record);
                    }
                    // Self-learning : sauvegarder les corrections utilisateur
                    if (item._originalAnalysis) {
                        const orig = item._originalAnalysis;
                        const corrections = {};
                        if (orig.variete !== a.variete) corrections.variete = { from: orig.variete, to: a.variete };
                        if (orig.ferme !== a.ferme) corrections.ferme = { from: orig.ferme, to: a.ferme };
                        if (a.confection && !orig.confection) corrections.confection = { from: '', to: a.confection };
                        if (Object.keys(corrections).length > 0) {
                            db.collection('scan_corrections').add({
                                corrections,
                                originalVariete: orig.variete,
                                correctedVariete: a.variete,
                                correctedFerme: a.ferme,
                                correctedConfection: a.confection || '',
                                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                            }).catch(e => console.warn('Self-learning save failed:', e));
                        }
                    }
                    setScanQueue(prev => {
                        const remaining = prev.filter(s => s !== item);
                        if (remaining.filter(s => s.status === 'done').length === 0 && remaining.filter(s => s.status === 'pending' || s.status === 'processing').length === 0) {
                            setShowScanModal(false);
                            setReloadKey(k => k + 1);
                        }
                        return remaining;
                    });
                } catch (err) { alert('Erreur: ' + err.message); }
            };

            // ---- VUE DETAIL ----
            if (selectedBon) {
                const b = selectedBon;
                const isExcelImport = !b.source || b.source === 'bulk_upload' || b.status === 'import_excel';

                return (
                    <div className="fade-in">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                            <button onClick={() => setSelectedBon(null)} style={{padding:'6px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>
                                <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i>Retour à la liste
                            </button>
                            <div style={{display:'flex',gap:8}}>
                                {b.id && b.status === 'soumis' && (
                                    <button onClick={() => {
                                        setEditingBon(b);
                                        setBonType(b.typeVente === 'Marché Local' ? 'local' : 'export');
                                        setForm({
                                            numeroPiece: b.bonApport || b.numeroPiece || '',
                                            ferme: b.blocFerme || b.ferme || 'F5',
                                            produit: b.produit || 'Framboise',
                                            parcelle: b.bloc || b.parcelle || '',
                                            date: b.date || '',
                                            designation: b.designation || '',
                                            client: b.client || '',
                                            typeUnite: b.typeUnite || '',
                                            nombreColis: b.nombreColis ? String(b.nombreColis) : '',
                                            qteParUnite: b.qteParUnite || '',
                                            quantiteKg: b.poidsLot ? String(b.poidsLot) : (b.quantiteKg ? String(b.quantiteKg) : ''),
                                            prixDH: b.prixDH ? String(b.prixDH) : '',
                                            totalDH: b.totalDH ? String(b.totalDH) : '',
                                        });
                                        setScanPreview(b.scanPhoto || null);
                                        setSelectedBon(null);
                                        setShowForm(true);
                                    }} style={{padding:'6px 16px',borderRadius:8,border:'1.5px solid var(--berry)',background:'#fff',color:'var(--berry)',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                        <i className="fa-solid fa-pen" style={{marginRight:6}}></i>Modifier
                                    </button>
                                )}
                                {b.id && (
                                    <button onClick={async () => {
                                        if (!confirm('Supprimer définitivement le bon N° ' + (b.bonApport || b.numeroPiece) + ' ?')) return;
                                        try {
                                            await firebase.firestore().collection('pfq_interne').doc(b.id).delete();
                                            setSelectedBon(null);
                                            setReloadKey(k => k + 1);
                                            alert('Bon supprimé.');
                                        } catch(err) { alert('Erreur: ' + err.message); }
                                    }} style={{padding:'6px 16px',borderRadius:8,border:'none',background:'#dc2626',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                        <i className="fa-solid fa-trash" style={{marginRight:6}}></i>Supprimer
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Bon d'Apport Detail - format papier */}
                        <div className="card" style={{padding:24,marginBottom:16}}>
                            <div style={{border:'2px solid #1a237e', borderRadius:12, overflow:'hidden', fontFamily:'serif'}}>
                                <div style={{background:'#e8eaf6', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'2px solid #1a237e'}}>
                                    <img src="https://www.berrygood.ma/logo.png" alt="Berry Good" style={{height:40, objectFit:'contain'}} />
                                    <div style={{textAlign:'center'}}><div style={{fontWeight:800, fontSize:15, color:'#1a237e'}}>BON D'APPORT</div></div>
                                    <div style={{textAlign:'right'}}><span style={{fontSize:11, color:'#666'}}>N°</span> <span style={{fontWeight:800, fontSize:16, color:'#c62828'}}>{b.bonApport || b.numeroPiece || '-'}</span></div>
                                </div>
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', fontSize:12, borderBottom:'1px solid #c5cae9'}}>
                                    <div style={{padding:'6px 12px', borderRight:'1px solid #c5cae9', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Producteur / Ferme :</span> <strong>Berry Good Farms — {b.blocFerme || b.ferme || '-'}</strong></div>
                                    <div style={{padding:'6px 12px', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Parcelle / Bloc :</span> <strong>{b.bloc || b.designation || '-'}</strong></div>
                                    <div style={{padding:'6px 12px', borderRight:'1px solid #c5cae9', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Produit :</span> <strong>{b.produit || ((b.designation || '').toLowerCase().includes('myrtille') ? 'Myrtille' : 'Framboise')}</strong></div>
                                    <div style={{padding:'6px 12px', borderBottom:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Date de récolte :</span> <strong>{b.date ? (b.date.includes('-') ? b.date.split('-').reverse().join('/') : b.date) : '-'}</strong></div>
                                    <div style={{padding:'6px 12px', borderRight:'1px solid #c5cae9'}}><span style={{color:'#666'}}>Variété :</span> <strong style={{color:'#1a237e'}}>{b.blocVariete || b.designation || '-'}</strong></div>
                                    <div style={{padding:'6px 12px'}}><span style={{color:'#666'}}>Client :</span> <strong>{b.client || '-'}</strong></div>
                                </div>
                                <div style={{padding:'10px 12px', borderBottom:'1px solid #c5cae9'}}>
                                    <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
                                        <thead><tr style={{background:'#e8eaf6'}}>
                                            <th style={{padding:'6px 8px', textAlign:'left', borderBottom:'1px solid #c5cae9'}}>Désignation</th>
                                            <th style={{padding:'6px 8px', textAlign:'left', borderBottom:'1px solid #c5cae9'}}>Type</th>
                                            <th style={{padding:'6px 8px', textAlign:'right', borderBottom:'1px solid #c5cae9'}}>Semaine</th>
                                            <th style={{padding:'6px 8px', textAlign:'right', borderBottom:'1px solid #c5cae9', fontWeight:800, color:'#1a237e'}}>Quantité (kg)</th>
                                        </tr></thead>
                                        <tbody><tr>
                                            <td style={{padding:'8px'}}>{b.designation || b.blocLabel || '-'}</td>
                                            <td style={{padding:'8px'}}><span style={{padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:600, background: b.typeVente === 'Export' ? '#e8f5e9' : '#fff3e0', color: b.typeVente === 'Export' ? '#2e7d32' : '#e65100'}}>{b.typeVente || '-'}</span></td>
                                            <td style={{padding:'8px', textAlign:'right'}}>{b.semaine || '-'}</td>
                                            <td style={{padding:'8px', textAlign:'right', fontWeight:800, fontSize:15, color:'#1a237e'}}>{(b.poidsLot || b.quantiteKg || 0).toLocaleString('fr-FR', {maximumFractionDigits:1})}</td>
                                        </tr></tbody>
                                    </table>
                                </div>
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', fontSize:11, color:'#666'}}>
                                    <div style={{padding:'8px 12px', borderRight:'1px solid #c5cae9'}}><span>Visa producteur</span></div>
                                    <div style={{padding:'8px 12px'}}><span>Agent de réception</span></div>
                                </div>
                            </div>
                            {(b.prixDH > 0 || b.totalDH > 0) && (
                                <div style={{marginTop:12, padding:10, borderRadius:8, background:'#f5f5f5', fontSize:12, display:'flex', gap:16}}>
                                    <div><span style={{color:'var(--gray-400)'}}>Prix DH/kg:</span> <strong>{parseFloat(b.prixDH || 0).toFixed(2)}</strong></div>
                                    <div><span style={{color:'var(--gray-400)'}}>Total DH:</span> <strong style={{color:'#2e7d32'}}>{parseFloat(b.totalDH || 0).toLocaleString('fr-FR', {maximumFractionDigits:2})}</strong></div>
                                </div>
                            )}
                        </div>

                        {/* Source / Workflow */}
                        <div className="card" style={{padding:20,marginBottom:16}}>
                            <h4 style={{margin:'0 0 12px',fontSize:14,color:'var(--berry)'}}><i className="fa-solid fa-stamp" style={{marginRight:6}}></i>{isExcelImport ? 'Source' : 'Validations'}</h4>
                            {isExcelImport ? (
                                <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',background:'rgba(106,27,154,0.05)',borderRadius:10,border:'1px solid rgba(106,27,154,0.15)'}}>
                                    <div style={{width:40,height:40,borderRadius:'50%',background:'rgba(106,27,154,0.1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                        <i className="fa-solid fa-file-excel" style={{fontSize:18,color:'#6a1b9a'}}></i>
                                    </div>
                                    <div>
                                        <div style={{fontSize:13,fontWeight:700,color:'#6a1b9a'}}>Importation Excel</div>
                                        <div style={{fontSize:11,color:'#888'}}>Créé par : Import Situation Production</div>
                                    </div>
                                </div>
                            ) : (
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                                    <div style={{padding:'10px 14px',background:'#f8f9fa',borderRadius:8,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'#888',fontWeight:600}}>Créé par</div>
                                        <div style={{fontSize:12,fontWeight:600,marginTop:4}}>{b.createdBy?.name || '—'}</div>
                                        <div style={{fontSize:10,color:'#aaa'}}>{b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString('fr-FR') : '—'}</div>
                                    </div>
                                    <div style={{padding:'10px 14px',background: b.validatedByQualite ? 'rgba(21,101,192,0.05)' : '#f8f9fa',borderRadius:8,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'#888',fontWeight:600}}>Qualité</div>
                                        <div style={{fontSize:12,fontWeight:600,marginTop:4}}>{b.validatedByQualite?.name || 'En attente'}</div>
                                        <div style={{fontSize:10,color:'#aaa'}}>{b.validatedAtQualite?.toDate ? b.validatedAtQualite.toDate().toLocaleString('fr-FR') : '—'}</div>
                                    </div>
                                    <div style={{padding:'10px 14px',background: b.validatedByChef ? 'rgba(34,197,94,0.05)' : '#f8f9fa',borderRadius:8,textAlign:'center'}}>
                                        <div style={{fontSize:10,color:'#888',fontWeight:600}}>Chef de Ferme</div>
                                        <div style={{fontSize:12,fontWeight:600,marginTop:4}}>{b.validatedByChef?.name || 'En attente'}</div>
                                        <div style={{fontSize:10,color:'#aaa'}}>{b.validatedAtChef?.toDate ? b.validatedAtChef.toDate().toLocaleString('fr-FR') : '—'}</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Scan du bon */}
                        {b.scanPhoto && (
                        <div className="card" style={{padding:20,marginBottom:16}}>
                            <h4 style={{margin:'0 0 12px',fontSize:14,color:'var(--berry)'}}><i className="fa-solid fa-image" style={{marginRight:6}}></i>Scan du Bon d'Apport</h4>
                            <img src={b.scanPhoto} alt="Scan bon d'apport" style={{width:'100%',maxHeight:500,objectFit:'contain',borderRadius:8,border:'1px solid #eee'}} />
                        </div>
                        )}
                    </div>
                );
            }

            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <h3 style={{margin:0}}><i className="fa-solid fa-file-circle-plus" style={{marginRight:8,color:'var(--berry)'}}></i>Bons d'Apport</h3>
                        <div style={{display:'flex',gap:8}}>
                            <button onClick={() => checkSerialNumbers(serialFerme)} disabled={serialLoading} style={{padding:'8px 16px',borderRadius:8,border:'1.5px solid var(--berry)',background:'#fff',color:'var(--berry)',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className={`fa-solid ${serialLoading ? 'fa-spinner fa-spin' : 'fa-list-ol'}`} style={{marginRight:6}}></i>Contrôle N° série
                            </button>
                            <select value={serialFerme} onChange={e => setSerialFerme(e.target.value)} style={{padding:'8px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:13,cursor:'pointer'}}>
                                <option value="">Toutes fermes</option>
                                <option value="F1">F1</option>
                                <option value="F5">F5</option>
                            </select>
                            <button onClick={() => setShowScanModal(true)} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'#e65100',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className="fa-solid fa-camera" style={{marginRight:6}}></i>Scanner des Bons
                            </button>
                            <button data-tour="btn-new-bon-apport" onClick={handleNewBon} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau Bon
                            </button>
                        </div>
                    </div>

                    {/* Modal Scan en vrac */}
                    {showScanModal && (
                        <div className="modal-overlay" onClick={() => { if (!scanProcessing) setShowScanModal(false); }} style={{zIndex:9999}}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:800, maxHeight:'90vh', overflow:'auto', padding:0, borderRadius:16}}>
                                <div style={{background:'linear-gradient(135deg, #bf360c 0%, #e65100 100%)', padding:'24px 28px', color:'#fff', borderRadius:'16px 16px 0 0'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700}}><i className="fa-solid fa-camera" style={{marginRight:8}}></i>Scanner des Bons d'Apport</div>
                                            <div style={{fontSize:12, opacity:0.85, marginTop:4}}>Déposez les photos/scans des bons — l'IA extraira les données automatiquement</div>
                                        </div>
                                        <button onClick={() => { if (!scanProcessing) setShowScanModal(false); }} style={{background:'rgba(255,255,255,0.2)', border:'none', color:'#fff', borderRadius:'50%', width:32, height:32, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center'}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                </div>
                                <div style={{padding:'24px'}}>
                                    {/* Zone de drop — masquée quand des images sont uploadées */}
                                    {scanQueue.length === 0 && (
                                    <div
                                        onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*'; inp.onchange = (e) => handleScanFiles(e.target.files); inp.click(); }}
                                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#e65100'; e.currentTarget.style.background = 'rgba(230,81,0,0.06)'; }}
                                        onDragLeave={(e) => { e.currentTarget.style.borderColor = '#ffccbc'; e.currentTarget.style.background = '#fff8f5'; }}
                                        onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#ffccbc'; e.currentTarget.style.background = '#fff8f5'; handleScanFiles(e.dataTransfer.files); }}
                                        style={{border:'2.5px dashed #ffccbc', borderRadius:14, padding:'36px 24px', textAlign:'center', cursor:'pointer', background:'#fff8f5', transition:'all 0.2s ease', marginBottom:20}}
                                    >
                                        <i className="fa-solid fa-images" style={{fontSize:40, color:'#ff8a65', marginBottom:12}}></i>
                                        <div style={{fontSize:15, fontWeight:600, color:'#bf360c', marginBottom:4}}>Glissez vos photos de bons ici</div>
                                        <div style={{fontSize:13, color:'#888'}}>ou <span style={{color:'#e65100', fontWeight:600, textDecoration:'underline'}}>cliquez pour sélectionner</span> — plusieurs images à la fois</div>
                                        <div style={{fontSize:11, color:'#aaa', marginTop:8}}>JPG, PNG — L'IA va lire et extraire les informations de chaque bon</div>
                                    </div>
                                    )}

                                    {/* Queue */}
                                    {scanQueue.length > 0 && (
                                        <div>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                                                <span style={{fontSize:14, fontWeight:700, color:'#333'}}>
                                                    {scanQueue.length} image{scanQueue.length > 1 ? 's' : ''}
                                                    {scanProcessing && <span style={{marginLeft:8, fontSize:12, color:'#e65100'}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Analyse en cours...</span>}
                                                </span>
                                                <div style={{display:'flex', gap:8}}>
                                                    {false && scanQueue.some(s => s.status === 'pending') && (
                                                        <button onClick={processScanQueue} disabled={scanProcessing} style={{padding:'8px 20px', borderRadius:8, border:'none', background: scanProcessing ? '#bbb' : '#e65100', color:'#fff', cursor: scanProcessing ? 'not-allowed' : 'pointer', fontWeight:600, fontSize:13}}>
                                                            <i className={scanProcessing ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-magic-sparkles'} style={{marginRight:6}}></i>
                                                            {scanProcessing ? 'Analyse en cours...' : 'Lancer l\'analyse IA'}
                                                        </button>
                                                    )}
                                                    {!scanProcessing && (
                                                        <button onClick={() => setScanQueue([])} style={{padding:'8px 16px', borderRadius:8, border:'1.5px solid #ddd', background:'#fff', color:'#666', cursor:'pointer', fontWeight:600, fontSize:12}}>
                                                            Tout effacer
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Navigation un par un pour les bons analysés */}
                                            {(() => {
                                                const doneItems = scanQueue.filter(s => s.status === 'done');
                                                const pendingItems = scanQueue.filter(s => s.status !== 'done');
                                                // Afficher les pending/processing/error en miniature
                                                return (
                                                    <div>
                                                    {pendingItems.map((item, idx) => (
                                                        <div key={'p'+idx} style={{display:'flex', gap:12, alignItems:'center', padding:'10px 16px', border:'1px solid #eee', borderRadius:8, marginBottom:8, background: item.status === 'error' ? '#fbe9e7' : '#fff'}}>
                                                            <img src={item.preview} alt="" style={{width:50, height:50, objectFit:'cover', borderRadius:6, border:'1px solid #eee'}} />
                                                            <span style={{fontSize:12, color:'#888', flex:1}}>{item.file.name}</span>
                                                            <span style={{padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:600,
                                                                background: item.status === 'processing' ? 'rgba(230,81,0,0.1)' : item.status === 'error' ? 'rgba(220,38,38,0.1)' : 'rgba(0,0,0,0.05)',
                                                                color: item.status === 'processing' ? '#e65100' : item.status === 'error' ? '#dc2626' : '#888'
                                                            }}>
                                                                {item.status === 'pending' && 'En attente'}
                                                                {item.status === 'processing' && React.createElement('span', null, React.createElement('i', {className:'fa-solid fa-spinner fa-spin', style:{marginRight:4}}), 'Analyse...')}
                                                                {item.status === 'error' && ('Erreur: ' + (item.error || ''))}
                                                            </span>
                                                        </div>
                                                    ))}
                                                    {/* Bon analysé en cours de revue (1 à la fois) */}
                                                    {doneItems.length > 0 && (() => {
                                                        const currentIdx = 0;
                                                        const item = doneItems[currentIdx];
                                                        const a = item.analysis || {};
                                                        const nbColis = parseFloat(a.nombre_colis) || 0;
                                                        const poidsColis = parseFloat(a.poids_par_colis_kg) || 0;
                                                        const poidsTotal = parseFloat(a.poids_kg) || 0;
                                                        const poidsCalcule = nbColis && poidsColis ? Math.round(nbColis * poidsColis * 10) / 10 : null;
                                                        const hasWeightError = poidsCalcule && Math.abs(poidsCalcule - poidsTotal) > 1;
                                                        const updateField = (field, value) => {
                                                            setScanQueue(prev => prev.map(s => s === item ? { ...s, analysis: { ...s.analysis, [field]: value } } : s));
                                                        };
                                                        const fStyle2 = {width:'100%', padding:'6px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:13, fontWeight:600};
                                                        const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
                                                        const isNotYesterday = a.date !== yesterday.toISOString().slice(0,10);
                                                        return (
                                                            <div style={{border:'2px solid #4caf50', borderRadius:14, overflow:'hidden', marginTop:12}}>
                                                                {/* Header navigation */}
                                                                <div style={{background:'#e8f5e9', padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                                    <span style={{fontSize:13, fontWeight:700, color:'#2e7d32'}}>
                                                                        <i className="fa-solid fa-file-circle-check" style={{marginRight:6}}></i>
                                                                        Bon {1} / {doneItems.length} — {item.file.name}
                                                                    </span>
                                                                    <span style={{padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:600, background:'rgba(76,175,80,0.15)', color:'#2e7d32'}}>Analysé</span>
                                                                </div>

                                                                <div style={{display:'flex', gap:0}}>
                                                                    {/* Gauche : Image cliquable */}
                                                                    <div style={{flex:'0 0 45%', background:'#f5f5f5', display:'flex', alignItems:'center', justifyContent:'center', borderRight:'1px solid #e0e0e0', padding:8, cursor:'pointer', position:'relative'}}
                                                                        onClick={() => {
                                                                            const overlay = document.createElement('div');
                                                                            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:10001;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
                                                                            overlay.onclick = () => overlay.remove();
                                                                            const img = document.createElement('img');
                                                                            img.src = item.preview;
                                                                            img.style.cssText = 'max-width:95vw;max-height:95vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);';
                                                                            overlay.appendChild(img);
                                                                            document.body.appendChild(overlay);
                                                                        }}>
                                                                        <img src={item.preview} alt="" style={{maxWidth:'100%', maxHeight:400, objectFit:'contain', borderRadius:6}} />
                                                                        <div style={{position:'absolute', bottom:12, right:12, background:'rgba(0,0,0,0.6)', color:'#fff', borderRadius:6, padding:'4px 10px', fontSize:11}}>
                                                                            <i className="fa-solid fa-expand" style={{marginRight:4}}></i>Agrandir
                                                                        </div>
                                                                    </div>

                                                                    {/* Droite : Champs éditables */}
                                                                    <div style={{flex:1, padding:16}}>
                                                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12}}>
                                                                            <div><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>N° Bon</div>
                                                                                <input value={a.numero_bon || ''} onChange={e => updateField('numero_bon', e.target.value)} style={fStyle2} /></div>
                                                                            <div><div style={{fontSize:10, color: isNotYesterday ? '#e53935' : '#888', fontWeight:600, marginBottom:2}}>Date {isNotYesterday ? '⚠️' : ''}</div>
                                                                                <input type="date" value={a.date || ''} onChange={e => updateField('date', e.target.value)} style={{...fStyle2, ...(isNotYesterday ? {border:'2px solid #e53935', color:'#e53935', background:'#fff5f5'} : {})}} /></div>
                                                                            <div><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>Ferme</div>
                                                                                <select value={a.ferme || 'F5'} onChange={e => updateField('ferme', e.target.value)} style={fStyle2}>
                                                                                    <option value="F1">F1</option><option value="F5">F5</option>
                                                                                </select></div>
                                                                            {a.type_vente === 'Marché Local' ? (
                                                                            <div><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>Variété / Bloc</div>
                                                                                <div style={{...fStyle2, background:'#fff8f5', color:'#e65100', border:'1px dashed #ffccbc', textAlign:'center', fontSize:11}}>
                                                                                    <i className="fa-solid fa-layer-group" style={{marginRight:4}}></i>Multi-variété — voir tableau ci-dessous
                                                                                </div></div>
                                                                            ) : (
                                                                            <div><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>Variété / Bloc</div>
                                                                                <select value={a.variete || ''} onChange={e => {
                                                                                    const pc = PARCELLES_CULTURALES.find(p => p.designations?.[0] === e.target.value);
                                                                                    updateField('variete', e.target.value);
                                                                                    if (pc) { updateField('ferme', pc.ferme); updateField('parcelle', pc.id); }
                                                                                }} style={fStyle2}>
                                                                                    <option value="">-- Sélectionner --</option>
                                                                                    {PARCELLES_CULTURALES.filter(p => p.cycle === 2 && p.enProduction !== false).map(p => (
                                                                                        <option key={p.id} value={p.designations[0]}>{p.designations[0]} ({p.ferme})</option>
                                                                                    ))}
                                                                                </select></div>
                                                                            )}
                                                                            <div><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>Poids Total (kg)</div>
                                                                                <input type="number" step="0.1" value={a.poids_kg || ''} onChange={e => updateField('poids_kg', e.target.value)} style={{...fStyle2, background: '#f0fdf4', borderColor:'#86efac'}} /></div>
                                                                            <div><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>Type</div>
                                                                                <select value={a.type_vente || 'Export'} onChange={e => updateField('type_vente', e.target.value)} style={fStyle2}>
                                                                                    <option value="Export">Export</option><option value="Marché Local">Marché Local</option>
                                                                                </select></div>
                                                                            <div><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>Client</div>
                                                                                {a.type_vente === 'Marché Local' ? (
                                                                                    <div style={{display:'flex',gap:4}}>
                                                                                        <select value={a.client || ''} onChange={e => { if (e.target.value === '__new__') { setShowCreateClient(true); } else { updateField('client', e.target.value); } }} style={{...fStyle2, flex:1}}>
                                                                                            <option value="">-- Sélectionner --</option>
                                                                                            {marcheLocalClients.map(c => <option key={c} value={c}>{c}</option>)}
                                                                                            <option value="__new__">+ Nouveau client...</option>
                                                                                        </select>
                                                                                    </div>
                                                                                ) : (
                                                                                    <input value={a.client || ''} onChange={e => updateField('client', e.target.value)} style={fStyle2} />
                                                                                )}</div>
                                                                            <div style={{gridColumn:'1 / -1'}}><div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:2}}>Confection</div>
                                                                                <select value={a.confection || ''} onChange={e => {
                                                                                    const confId = e.target.value;
                                                                                    const conf = confectionTypes.find(c => c.id === confId);
                                                                                    const poidsU = conf ? conf.poidsParColis : null;
                                                                                    setScanQueue(prev => prev.map(s => {
                                                                                        if (s !== item) return s;
                                                                                        const updated = { ...s.analysis, confection: confId };
                                                                                        if (poidsU && updated.lignes?.length) {
                                                                                            updated.lignes = updated.lignes.map(l => {
                                                                                                const nb = parseFloat(l.nombre_colis) || 0;
                                                                                                return { ...l, poids_unitaire_kg: poidsU, quantite_kg: Math.round(nb * poidsU * 10) / 10 };
                                                                                            });
                                                                                            updated.poids_kg = String(Math.round(updated.lignes.reduce((s, l) => s + (parseFloat(l.quantite_kg) || 0), 0) * 10) / 10);
                                                                                        }
                                                                                        return { ...s, analysis: updated };
                                                                                    }));
                                                                                }} style={fStyle2}>
                                                                                    <option value="">-- Aucune --</option>
                                                                                    {confectionTypes.map(c => (
                                                                                        <option key={c.id} value={c.id}>{c.label} ({c.poidsParColis} kg/colis)</option>
                                                                                    ))}
                                                                                </select></div>
                                                                        </div>

                                                                        {/* Tableau détail lignes emballage */}
                                                                        {a.lignes && a.lignes.length > 0 && (
                                                                            <div style={{marginBottom:12}}>
                                                                                <div style={{fontSize:10, color:'#888', fontWeight:600, marginBottom:6}}>{a.type_vente === 'Marché Local' ? 'Lignes — variété + poids' : 'Détail emballage / colis'}</div>
                                                                                <table style={{width:'100%', fontSize:12, borderCollapse:'collapse', border:'1px solid #e0e0e0', borderRadius:8}}>
                                                                                    <thead><tr style={{background:'#f5f5f5'}}>
                                                                                        {a.type_vente === 'Marché Local' && (
                                                                                            <th style={{padding:'6px 8px', textAlign:'left', borderBottom:'1px solid #e0e0e0', fontSize:11}}>Variété</th>
                                                                                        )}
                                                                                        <th style={{padding:'6px 8px', textAlign:'left', borderBottom:'1px solid #e0e0e0', fontSize:11}}>Description</th>
                                                                                        <th style={{padding:'6px 8px', textAlign:'center', borderBottom:'1px solid #e0e0e0', fontSize:11, width:70}}>Colis</th>
                                                                                        <th style={{padding:'6px 8px', textAlign:'center', borderBottom:'1px solid #e0e0e0', fontSize:11, width:70}}>Poids/u</th>
                                                                                        <th style={{padding:'6px 8px', textAlign:'right', borderBottom:'1px solid #e0e0e0', fontSize:11, width:80}}>Total kg</th>
                                                                                    </tr></thead>
                                                                                    <tbody>
                                                                                        {a.lignes.map((l, li) => {
                                                                                            const updateLigne = (field, value) => {
                                                                                                setScanQueue(prev => prev.map(s => {
                                                                                                    if (s !== item) return s;
                                                                                                    const updatedLignes = [...s.analysis.lignes];
                                                                                                    const updatedLine = { ...updatedLignes[li], [field]: value };
                                                                                                    if (field === 'nombre_colis' && s.analysis.confection) {
                                                                                                        const poidsU = parseFloat(updatedLine.poids_unitaire_kg) || 0;
                                                                                                        if (poidsU) updatedLine.quantite_kg = Math.round((parseFloat(value) || 0) * poidsU * 10) / 10;
                                                                                                    }
                                                                                                    updatedLignes[li] = updatedLine;
                                                                                                    if (field === 'nombre_colis' || field === 'quantite_kg') {
                                                                                                        const newTotal = Math.round(updatedLignes.reduce((sum, lg) => sum + (parseFloat(lg.quantite_kg) || 0), 0) * 10) / 10;
                                                                                                        return { ...s, analysis: { ...s.analysis, lignes: updatedLignes, poids_kg: String(newTotal) } };
                                                                                                    }
                                                                                                    return { ...s, analysis: { ...s.analysis, lignes: updatedLignes } };
                                                                                                }));
                                                                                            };
                                                                                            return (
                                                                                            <tr key={li}>
                                                                                                {a.type_vente === 'Marché Local' && (
                                                                                                    <td style={{padding:'4px 4px', borderBottom:'1px solid #f0f0f0'}}>
                                                                                                        <select value={l.variete || ''} onChange={e => {
                                                                                                            updateLigne('variete', e.target.value);
                                                                                                        }} style={{width:'100%', padding:'3px 4px', borderRadius:4, border:'1px solid #ddd', fontSize:10}}>
                                                                                                            <option value="">--</option>
                                                                                                            {PARCELLES_CULTURALES.filter(p => p.cycle === 2 && p.enProduction !== false).map(p => (
                                                                                                                <option key={p.id} value={p.designations[0]}>{p.designations[0]}</option>
                                                                                                            ))}
                                                                                                        </select>
                                                                                                    </td>
                                                                                                )}
                                                                                                <td style={{padding:'4px 8px', borderBottom:'1px solid #f0f0f0', fontSize:11}}>{l.description || '—'}</td>
                                                                                                <td style={{padding:'4px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight:600}}>
                                                                                                    <input type="number" step="1" value={l.nombre_colis || ''} onChange={e => updateLigne('nombre_colis', parseFloat(e.target.value) || 0)}
                                                                                                        style={{width:50, padding:'2px 4px', borderRadius:4, border:'1px solid #ddd', fontSize:11, textAlign:'center', fontWeight:600}} />
                                                                                                </td>
                                                                                                <td style={{padding:'4px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'center'}}>{l.poids_unitaire_kg ? l.poids_unitaire_kg + ' kg' : '—'}</td>
                                                                                                <td style={{padding:'4px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right', fontWeight:700}}>
                                                                                                    <input type="number" step="0.1" value={l.quantite_kg || ''} onChange={e => updateLigne('quantite_kg', parseFloat(e.target.value) || 0)}
                                                                                                        style={{width:60, padding:'2px 4px', borderRadius:4, border:'1px solid #ddd', fontSize:11, textAlign:'right', fontWeight:700}} />
                                                                                                </td>
                                                                                            </tr>
                                                                                            );
                                                                                        })}
                                                                                        <tr style={{background:'#f0fdf4'}}>
                                                                                            <td style={{padding:'4px 8px', fontWeight:700, fontSize:11}} colSpan={a.type_vente === 'Marché Local' ? 2 : 1}>TOTAL</td>
                                                                                            <td style={{padding:'4px 8px', textAlign:'center', fontWeight:700}}>{a.lignes.reduce((s, l) => s + (parseFloat(l.nombre_colis) || 0), 0)}</td>
                                                                                            <td></td>
                                                                                            <td style={{padding:'4px 8px', textAlign:'right', fontWeight:700, color: Math.abs(a.lignes.reduce((s, l) => s + (parseFloat(l.quantite_kg) || 0), 0) - parseFloat(a.poids_kg || 0)) > 1 ? '#dc2626' : '#2e7d32'}}>
                                                                                                {a.lignes.reduce((s, l) => s + (parseFloat(l.quantite_kg) || 0), 0).toFixed(1)} kg
                                                                                            </td>
                                                                                        </tr>
                                                                                    </tbody>
                                                                                </table>
                                                                                {Math.abs(a.lignes.reduce((s, l) => s + (parseFloat(l.quantite_kg) || 0), 0) - parseFloat(a.poids_kg || 0)) > 1 && (
                                                                                    <div style={{padding:'6px 10px', background:'rgba(220,38,38,0.06)', borderRadius:6, marginTop:6, fontSize:11, color:'#dc2626'}}>
                                                                                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>
                                                                                        Écart : total lignes = {a.lignes.reduce((s, l) => s + (parseFloat(l.quantite_kg) || 0), 0).toFixed(1)} kg vs poids saisi = {a.poids_kg} kg
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )}

                                                                        {item.isDuplicate && (
                                                                            <div style={{padding:'8px 14px', background:'rgba(220,38,38,0.06)', border:'1px solid rgba(220,38,38,0.2)', borderRadius:8, marginBottom:10, display:'flex', alignItems:'center', gap:8}}>
                                                                                <i className="fa-solid fa-ban" style={{color:'#dc2626', fontSize:14}}></i>
                                                                                <span style={{fontSize:12, color:'#991b1b', fontWeight:600}}>Doublon — le bon N° {a.numero_bon} existe déjà. Modifiez le numéro ou ignorez.</span>
                                                                            </div>
                                                                        )}

                                                                        <div style={{display:'flex', gap:8, marginTop:8, flexWrap:'wrap'}}>
                                                                            {!item.isDuplicate && (
                                                                                <button onClick={() => submitScanBon(item)} style={{padding:'10px 24px', borderRadius:8, border:'none', background:'#4caf50', color:'#fff', cursor:'pointer', fontWeight:600, fontSize:13}}>
                                                                                    <i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>Soumettre à la Qualité{doneItems.length > 1 ? ' →' : ''}
                                                                                </button>
                                                                            )}
                                                                            <button onClick={() => editScanBon(item)} style={{padding:'10px 20px', borderRadius:8, border:'1.5px solid var(--berry)', background:'#fff', color:'var(--berry)', cursor:'pointer', fontWeight:600, fontSize:13}}>
                                                                                <i className="fa-solid fa-pen" style={{marginRight:4}}></i>Modifier
                                                                            </button>
                                                                            <button onClick={() => setScanQueue(prev => prev.filter(s => s !== item))} style={{padding:'10px 20px', borderRadius:8, border:'1px solid #ddd', background:'#fff', color:'#666', cursor:'pointer', fontWeight:600, fontSize:13}}>
                                                                                <i className="fa-solid fa-forward" style={{marginRight:4}}></i>Ignorer{doneItems.length > 1 ? ' →' : ''}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Modal paramétrage confections */}
                    {showConfectionConfig && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => { setShowConfectionConfig(false); setEditingConfIdx(null); }}>
                            <div style={{background:'#fff',borderRadius:16,padding:24,maxWidth:640,width:'100%',maxHeight:'85vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                    <h3 style={{margin:0,fontSize:16}}><i className="fa-solid fa-boxes-stacked" style={{marginRight:8,color:'var(--berry)'}}></i>Paramétrage des Confections</h3>
                                    <button onClick={() => {
                                        const label = prompt('Nom du type (ex: 6 x 170g Premium):');
                                        if (!label) return;
                                        const poids = prompt('Poids par colis en KG:');
                                        if (!poids || isNaN(parseFloat(poids))) return;
                                        saveConfTypes([...confectionTypes, { id: label.replace(/\s+/g,'_').toLowerCase(), label, poidsParColis: parseFloat(poids), composition: [] }]);
                                    }} style={{padding:'6px 14px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:12}}>
                                        <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Nouveau type
                                    </button>
                                </div>

                                {confectionTypes.map((ct, idx) => (
                                    <div key={ct.id} style={{border:'1px solid #eee',borderRadius:12,padding:16,marginBottom:12}}>
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                                            <div>
                                                <span style={{fontWeight:700,fontSize:14}}>{ct.label}</span>
                                                <span style={{marginLeft:8,fontSize:12,color:'#888'}}>{ct.poidsParColis} kg/colis</span>
                                            </div>
                                            <div style={{display:'flex',gap:6}}>
                                                <button onClick={() => setEditingConfIdx(editingConfIdx === idx ? null : idx)} style={{padding:'4px 10px',borderRadius:6,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:11,fontWeight:600}}>
                                                    <i className={`fa-solid ${editingConfIdx === idx ? 'fa-chevron-up' : 'fa-pen'}`} style={{marginRight:4}}></i>{editingConfIdx === idx ? 'Fermer' : 'Éditer'}
                                                </button>
                                                <button onClick={() => {
                                                    const newPoids = prompt('Nouveau poids par colis (KG):', ct.poidsParColis);
                                                    if (newPoids && !isNaN(parseFloat(newPoids))) {
                                                        const updated = [...confectionTypes]; updated[idx] = {...ct, poidsParColis: parseFloat(newPoids)}; saveConfTypes(updated);
                                                    }
                                                }} style={{padding:'4px 10px',borderRadius:6,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:11}} title="Modifier le poids">
                                                    <i className="fa-solid fa-weight-hanging"></i>
                                                </button>
                                                {confectionTypes.length > 1 && (
                                                    <button onClick={() => { if(confirm('Supprimer "' + ct.label + '" ?')) saveConfTypes(confectionTypes.filter((_,i) => i !== idx)); }}
                                                        style={{padding:'4px 10px',borderRadius:6,border:'1px solid #fecaca',background:'#fff',cursor:'pointer',fontSize:11,color:'#dc2626'}}>
                                                        <i className="fa-solid fa-trash"></i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Composition */}
                                        <div style={{fontSize:11,color:'#888',marginBottom:4}}>Composition par colis:</div>
                                        {ct.composition.length === 0 && <div style={{fontSize:12,color:'#bbb',fontStyle:'italic',padding:'4px 0'}}>Aucun article défini</div>}
                                        {ct.composition.map((comp, ci) => (
                                            <div key={ci} style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
                                                <span style={{flex:1,fontSize:12,padding:'4px 8px',background:'#f8f9fa',borderRadius:6}}>{comp.article}</span>
                                                <span style={{fontSize:12,fontWeight:600,minWidth:50,textAlign:'center'}}>x {comp.qte}</span>
                                                {editingConfIdx === idx && (
                                                    <button onClick={() => {
                                                        const updated = [...confectionTypes];
                                                        updated[idx] = {...ct, composition: ct.composition.filter((_,j) => j !== ci)};
                                                        saveConfTypes(updated);
                                                    }} style={{padding:'2px 6px',borderRadius:4,border:'none',background:'#fecaca',color:'#dc2626',cursor:'pointer',fontSize:10}}>
                                                        <i className="fa-solid fa-xmark"></i>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        {editingConfIdx === idx && (
                                            <div style={{display:'flex',gap:6,marginTop:8}}>
                                                <input id={`comp_art_${idx}`} placeholder="Article (ex: Barquette 125g)" style={{flex:1,padding:'6px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                <input id={`comp_qte_${idx}`} type="number" placeholder="Qté" style={{width:60,padding:'6px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                <button onClick={() => {
                                                    const art = document.getElementById(`comp_art_${idx}`).value.trim();
                                                    const qte = parseInt(document.getElementById(`comp_qte_${idx}`).value);
                                                    if (!art || !qte) return;
                                                    const updated = [...confectionTypes];
                                                    updated[idx] = {...ct, composition: [...ct.composition, { article: art, qte }]};
                                                    saveConfTypes(updated);
                                                    document.getElementById(`comp_art_${idx}`).value = '';
                                                    document.getElementById(`comp_qte_${idx}`).value = '';
                                                }} style={{padding:'6px 12px',borderRadius:6,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:600}}>
                                                    <i className="fa-solid fa-plus"></i>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                <div style={{textAlign:'right',marginTop:16}}>
                                    <button onClick={() => { setShowConfectionConfig(false); setEditingConfIdx(null); }} style={{padding:'8px 24px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Fermer</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Modal contrôle numéros de série */}
                    {serialCheck && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setSerialCheck(null)}>
                            <div style={{background:'#fff',borderRadius:16,padding:24,maxWidth:560,width:'100%',maxHeight:'80vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{textAlign:'center',marginBottom:16}}>
                                    <div style={{width:48,height:48,borderRadius:'50%',background:'rgba(108,52,131,0.1)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}>
                                        <i className="fa-solid fa-list-ol" style={{fontSize:22,color:'var(--berry)'}}></i>
                                    </div>
                                    <h3 style={{margin:0,fontSize:16}}>Contrôle des Numéros de Série {serialCheck.ferme && serialCheck.ferme !== 'Toutes' ? '— ' + serialCheck.ferme : ''}</h3>
                                    <p style={{margin:'6px 0 0',color:'var(--gray-500)',fontSize:12}}>{serialCheck.total} bons numériques analysés — {serialCheck.souches.length} souche(s) détectée(s){serialCheck.ferme ? ' — Ferme: ' + serialCheck.ferme : ''}</p>
                                </div>

                                {serialCheck.souches.length === 0 && (
                                    <div style={{textAlign:'center',padding:20,color:'#999'}}><i className="fa-solid fa-inbox" style={{fontSize:32,marginBottom:8,display:'block'}}></i>Aucun bon numérique trouvé</div>
                                )}

                                {serialCheck.souches.map(s => (
                                    <div key={s.id} style={{border:'1px solid #eee',borderRadius:12,padding:16,marginBottom:12}}>
                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                                            <span style={{fontWeight:700,fontSize:14,color:'var(--berry)'}}>Souche {s.id}: {s.min} → {s.max}</span>
                                            {s.missing === 0 ? (
                                                <span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background:'rgba(34,197,94,0.1)',color:'#22c55e'}}>Série complète</span>
                                            ) : (
                                                <span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background:'rgba(220,38,38,0.1)',color:'#dc2626'}}>{s.missing} manquant(s)</span>
                                            )}
                                        </div>
                                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom: s.ranges.length > 0 ? 10 : 0}}>
                                            <div style={{padding:'6px 10px',background:'#f8f9fa',borderRadius:6,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'#888'}}>Bons présents</div>
                                                <div style={{fontSize:14,fontWeight:700}}>{s.count}</div>
                                            </div>
                                            <div style={{padding:'6px 10px',background:'#f8f9fa',borderRadius:6,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'#888'}}>Attendus</div>
                                                <div style={{fontSize:14,fontWeight:700}}>{s.expected}</div>
                                            </div>
                                            <div style={{padding:'6px 10px',background: s.missing > 0 ? 'rgba(220,38,38,0.05)' : '#f8f9fa',borderRadius:6,textAlign:'center'}}>
                                                <div style={{fontSize:10,color:'#888'}}>Manquants</div>
                                                <div style={{fontSize:14,fontWeight:700,color: s.missing > 0 ? '#dc2626' : 'inherit'}}>{s.missing}</div>
                                            </div>
                                        </div>
                                        {s.ranges.length > 0 && (
                                            <div style={{fontSize:12}}>
                                                <div style={{fontWeight:600,fontSize:11,color:'#888',marginBottom:4}}>Discontinuités:</div>
                                                {s.ranges.map((r, i) => (
                                                    <div key={i} style={{padding:'4px 10px',background:'rgba(220,38,38,0.04)',borderRadius:6,marginBottom:3,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                                        <span style={{color:'#dc2626',fontWeight:600}}>
                                                            {r.from === r.to ? `N° ${r.from}` : `N° ${r.from} → ${r.to}`}
                                                        </span>
                                                        <span style={{fontSize:11,color:'#999'}}>{r.count} manquant{r.count > 1 ? 's' : ''}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {serialCheck.doublons.length > 0 && (
                                    <div style={{padding:12,background:'rgba(245,158,11,0.06)',borderRadius:8,marginBottom:12,border:'1px solid rgba(245,158,11,0.15)'}}>
                                        <span style={{fontSize:12,color:'#b45309'}}><i className="fa-solid fa-clone" style={{marginRight:6}}></i><strong>Doublons détectés:</strong> {serialCheck.doublons.join(', ')}</span>
                                    </div>
                                )}

                                {serialCheck.ignored.length > 0 && (
                                    <div style={{padding:12,background:'#f8f9fa',borderRadius:8,marginBottom:12}}>
                                        <span style={{fontSize:11,color:'#888'}}><i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>Numéros non-numériques ignorés: {serialCheck.ignored.join(', ')}</span>
                                    </div>
                                )}

                                <div style={{textAlign:'right',marginTop:16}}>
                                    <button onClick={() => setSerialCheck(null)} style={{padding:'8px 24px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Fermer</button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16,alignItems:'center'}}>
                        {['', 'import_excel', 'app_created', 'soumis', 'valide_qualite', 'rejete_qualite', 'valide', 'rejete_chef'].map(s => (
                            <button key={s} className={`chip c-berry ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}>
                                {s ? statusLabels[s] || s : 'Tous'}
                            </button>
                        ))}
                        <div style={{marginLeft:'auto',display:'flex',gap:4,alignItems:'center'}}>
                            <button onClick={() => setFilterDate('')} style={{padding:'6px 12px',borderRadius:8,border: !filterDate ? '2px solid var(--berry)' : '1.5px solid #ddd',background: !filterDate ? 'var(--berry-pale)' : 'white',cursor:'pointer',fontSize:12,fontWeight:!filterDate?700:400,color:!filterDate?'var(--berry)':'var(--gray-600)'}}>Toutes</button>
                            <button onClick={() => { const d = new Date((filterDate || new Date().toISOString().slice(0,10)) + 'T12:00:00'); d.setDate(d.getDate()-1); setFilterDate(d.toISOString().slice(0,10)); }} style={{padding:'6px 10px',borderRadius:8,border:'1.5px solid #ddd',background:'white',cursor:'pointer',fontSize:13}}><i className="fa-solid fa-chevron-left"></i></button>
                            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:13}} />
                            <button onClick={() => { const d = new Date((filterDate || new Date().toISOString().slice(0,10)) + 'T12:00:00'); d.setDate(d.getDate()+1); setFilterDate(d.toISOString().slice(0,10)); }} style={{padding:'6px 10px',borderRadius:8,border:'1.5px solid #ddd',background:'white',cursor:'pointer',fontSize:13}}><i className="fa-solid fa-chevron-right"></i></button>
                        </div>
                        <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1.5px solid #ddd',fontSize:13,cursor:'pointer'}}>
                            <option value="">Toutes fermes</option>
                            <option value="F1">F1</option>
                            <option value="F5">F5</option>
                        </select>
                    </div>

                    {showForm && (
                        <div className="card" style={{marginBottom:20,padding:0, overflow:'hidden'}}>
                            <div style={{display:'flex', gap:0}}>
                            {/* Colonne gauche : image du scan (si disponible) */}
                            {scanPreview && (
                                <div style={{flex:'0 0 40%', background:'#f5f5f5', borderRight:'1px solid #eee', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:12, position:'sticky', top:0, maxHeight:'85vh', overflow:'auto'}}>
                                    <img src={scanPreview} alt="Scan du bon" style={{width:'100%', objectFit:'contain', borderRadius:8, boxShadow:'0 2px 12px rgba(0,0,0,0.1)'}} />
                                </div>
                            )}
                            {/* Colonne droite (ou pleine largeur) : formulaire */}
                            <div style={{flex:1, padding:20}}>
                            <h4 style={{marginTop:0,marginBottom:16}}><i className="fa-solid fa-file-circle-plus" style={{marginRight:8,color:'var(--berry)'}}></i>{editingBon ? 'Modifier le Bon d\'Apport' : 'Nouveau Bon d\'Apport'}</h4>

                            {/* Type toggle */}
                            <div style={{display:'flex',gap:8,marginBottom:20}}>
                                {['export', 'local'].map(t => (
                                    <button key={t} onClick={() => {
                                        setBonType(t);
                                        if (t === 'local') {
                                            // Auto-select "Vrac 1 kg" confection, create if missing
                                            let vracConf = confectionTypes.find(c => c.id === 'vrac_1kg');
                                            if (!vracConf) {
                                                vracConf = { id: 'vrac_1kg', label: 'Vrac 1 kg', poidsParColis: 1, composition: [] };
                                                saveConfTypes([...confectionTypes, vracConf]);
                                            }
                                            setForm(f => ({...f, client: '', prixDH: '', totalDH: '', typeUnite: 'vrac_1kg', qteParUnite: 'Vrac 1 kg'}));
                                            setLocalLignes([{ designation: '', quantiteKg: '' }]);
                                        } else {
                                            setForm(f => ({...f, client: "Driscoll's", prixDH: '', totalDH: '', typeUnite: '', qteParUnite: ''}));
                                        }
                                    }}
                                        style={{padding:'8px 20px',borderRadius:20,border: bonType === t ? '2px solid' : '1.5px solid var(--gray-200)',
                                            borderColor: bonType === t ? (t === 'export' ? '#1565C0' : '#e65100') : 'var(--gray-200)',
                                            background: bonType === t ? (t === 'export' ? '#1565C0' : '#e65100') : '#fff',
                                            color: bonType === t ? '#fff' : 'var(--gray-600)',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                        {t === 'export' ? 'Export' : 'Marché Local'}
                                    </button>
                                ))}
                            </div>

                            {/* Section 1: Informations */}
                            <div style={{marginBottom:20}}>
                                <div style={{fontSize:12,fontWeight:700,color:'var(--berry)',marginBottom:10,borderBottom:'2px solid var(--berry)',paddingBottom:4}}>
                                    <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>Informations
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12}}>
                                    <div><label style={lStyle}>N° Bon d'Apport *</label>
                                        <input value={form.numeroPiece} onChange={e => setForm(f => ({...f, numeroPiece: e.target.value}))} placeholder="Ex: 0006696" style={fStyle} /></div>
                                    <div><label style={lStyle}>Ferme *</label>
                                        <select value={form.ferme} onChange={e => setForm(f => ({...f, ferme: e.target.value}))} style={fStyle}>
                                            <option value="F1">F1 - Framboise Larache</option><option value="F5">F5 - Myrtille/Framboise</option>
                                        </select></div>
                                    <div><label style={lStyle}>Produit *</label>
                                        <select value={form.produit} onChange={e => setForm(f => ({...f, produit: e.target.value}))} style={fStyle}>
                                            <option value="Framboise">Framboise</option><option value="Myrtille">Myrtille</option>
                                        </select></div>
                                    <div><label style={lStyle}>Parcelle / Bloc</label>
                                        <input value={form.parcelle} onChange={e => setForm(f => ({...f, parcelle: e.target.value}))} placeholder="Ex: S8-2, S10" style={fStyle} /></div>
                                    <div><label style={lStyle}>Date de récolte *</label>
                                        <input type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} style={fStyle} /></div>
                                    {bonType !== 'local' && (
                                    <div data-tour="bon-form-variete"><label style={lStyle}>Variété / Bloc *</label>
                                        <select value={form.designation} onChange={e => {
                                            const pc = PARCELLES_CULTURALES.find(p => p.designations?.[0] === e.target.value);
                                            setForm(f => ({...f, designation: e.target.value, ferme: pc ? pc.ferme : f.ferme, produit: pc ? pc.culture : f.produit}));
                                        }} style={fStyle}>
                                            <option value="">-- Sélectionner --</option>
                                            {PARCELLES_CULTURALES.filter(p => p.cycle === 2 && p.enProduction !== false).map(p => (
                                                <option key={p.id} value={p.designations[0]}>{p.designations[0]} ({p.ferme})</option>
                                            ))}
                                        </select></div>
                                    )}


                                    <div><label style={lStyle}>Client</label>
                                        {bonType === 'local' ? (
                                            <div style={{display:'flex',gap:4}}>
                                                <select value={form.client} onChange={e => { if (e.target.value === '__new__') { setShowCreateClient(true); } else { setForm(f => ({...f, client: e.target.value})); } }} style={{...fStyle, flex:1}}>
                                                    <option value="">-- Sélectionner --</option>
                                                    {marcheLocalClients.map(c => <option key={c} value={c}>{c}</option>)}
                                                    <option value="__new__">+ Nouveau client...</option>
                                                </select>
                                            </div>
                                        ) : (
                                            <input value={form.client} onChange={e => setForm(f => ({...f, client: e.target.value}))} placeholder="Driscoll's" style={fStyle} />
                                        )}</div>
                                </div>
                            </div>

                            {/* Section Variétés Marché Local (multi-ligne) */}
                            {bonType === 'local' && (
                            <div style={{marginBottom:20}}>
                                <div style={{fontSize:12,fontWeight:700,color:'#e65100',marginBottom:10,borderBottom:'2px solid #e65100',paddingBottom:4}}>
                                    <i className="fa-solid fa-layer-group" style={{marginRight:6}}></i>Variétés
                                </div>
                                {localLignes.map((ligne, idx) => (
                                    <div key={idx} style={{display:'flex',gap:8,alignItems:'flex-end',marginBottom:8}}>
                                        <div style={{flex:2}}>{idx === 0 && <label style={lStyle}>Variété *</label>}
                                            <select value={ligne.designation} onChange={e => {
                                                const updated = [...localLignes];
                                                updated[idx] = { ...updated[idx], designation: e.target.value };
                                                setLocalLignes(updated);
                                            }} style={fStyle}>
                                                <option value="">-- Sélectionner --</option>
                                                {PARCELLES_CULTURALES.filter(p => p.cycle === 2 && p.enProduction !== false).map(p => (
                                                    <option key={p.id} value={p.designations[0]}>{p.designations[0]} ({p.ferme})</option>
                                                ))}
                                            </select></div>
                                        <div style={{flex:1}}>{idx === 0 && <label style={lStyle}>Poids (kg) *</label>}
                                            <input type="number" step="0.1" value={ligne.quantiteKg} onChange={e => {
                                                const updated = [...localLignes];
                                                updated[idx] = { ...updated[idx], quantiteKg: e.target.value };
                                                setLocalLignes(updated);
                                            }} placeholder="0" style={fStyle} /></div>
                                        {localLignes.length > 1 && (
                                            <button onClick={() => setLocalLignes(l => l.filter((_, i) => i !== idx))}
                                                style={{padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',color:'#dc2626',fontSize:14,marginBottom:0}}>
                                                <i className="fa-solid fa-trash"></i></button>
                                        )}
                                    </div>
                                ))}
                                <button onClick={() => setLocalLignes(l => [...l, { designation: '', quantiteKg: '' }])}
                                    style={{padding:'6px 14px',borderRadius:8,border:'1px dashed #e65100',background:'rgba(230,81,0,0.04)',cursor:'pointer',color:'#e65100',fontSize:12,fontWeight:600}}>
                                    <i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter une variété
                                </button>
                            </div>
                            )}

                            {/* Section 2: Livraison */}
                            <div style={{marginBottom:20}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,fontWeight:700,color:'var(--berry)',marginBottom:10,borderBottom:'2px solid var(--berry)',paddingBottom:4}}>
                                    <span><i className="fa-solid fa-truck" style={{marginRight:6}}></i>Livraison</span>
                                    <button onClick={() => setShowConfectionConfig(true)} style={{padding:'2px 8px',borderRadius:6,border:'1px solid var(--berry)',background:'#fff',color:'var(--berry)',cursor:'pointer',fontSize:11,fontWeight:600}}>
                                        <i className="fa-solid fa-gear" style={{marginRight:4}}></i>Confections
                                    </button>
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12}}>
                                    <div><label style={lStyle}>Type de confection</label>
                                        <select value={form.typeUnite} onChange={e => handleTypeChange(e.target.value)} style={fStyle}>
                                            <option value="">-- Sélectionner --</option>
                                            {confectionTypes.map(c => <option key={c.id} value={c.id}>{c.label} ({c.poidsParColis} kg/colis)</option>)}
                                            <option value="__add__">+ Ajouter un type...</option>
                                        </select></div>
                                    <div><label style={lStyle}>Nombre de colis</label>
                                        <input type="number" value={form.nombreColis} onChange={e => handleColisChange(e.target.value)} placeholder="0" style={fStyle} /></div>
                                    <div><label style={lStyle}>Détail confection</label>
                                        <input value={form.qteParUnite} readOnly style={{...fStyle,background:'#f9f9f9'}} /></div>
                                    {bonType === 'local' ? (
                                        <div data-tour="bon-form-poids"><label style={lStyle}>Quantité totale (KG)</label>
                                            <input type="number" value={localLignes.reduce((s, l) => s + (parseFloat(l.quantiteKg) || 0), 0).toFixed(1)} readOnly style={{...fStyle,background:'#f9f9f9'}} /></div>
                                    ) : (
                                        <div data-tour="bon-form-poids"><label style={lStyle}>Quantité totale (KG) *</label>
                                            <input type="number" step="0.1" value={form.quantiteKg} onChange={e => setForm(f => ({...f, quantiteKg: e.target.value}))} placeholder="Auto-calculé" style={fStyle} /></div>
                                    )}
                                    {bonType === 'local' && (<>
                                        <div><label style={lStyle}>Prix / KG (DH)</label>
                                            <input type="number" step="0.01" value={form.prixDH} onChange={e => setForm(f => ({...f, prixDH: e.target.value}))} placeholder="0" style={fStyle} /></div>
                                        <div><label style={lStyle}>Total (DH)</label>
                                            <input type="number" value={form.prixDH ? (parseFloat(form.prixDH) * localLignes.reduce((s, l) => s + (parseFloat(l.quantiteKg) || 0), 0)).toFixed(2) : ''} readOnly style={{...fStyle,background:'#f9f9f9'}} /></div>
                                    </>)}
                                </div>
                                {/* Vérification cohérence poids */}
                                {form.typeUnite && parseInt(form.nombreColis) > 0 && parseFloat(form.quantiteKg) > 0 && getConfByType(form.typeUnite) && (() => {
                                    const conf = getConfByType(form.typeUnite);
                                    const nbColis = parseInt(form.nombreColis);
                                    const poidsCalcule = Math.round(nbColis * conf.poidsParColis * 10) / 10;
                                    const poidsSaisi = parseFloat(form.quantiteKg);
                                    const ecart = Math.abs(poidsCalcule - poidsSaisi);
                                    if (ecart <= 1) return null;
                                    return (
                                        <div style={{marginTop:10, padding:'10px 14px', background: ecart > 50 ? 'rgba(220,38,38,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${ecart > 50 ? 'rgba(220,38,38,0.2)' : 'rgba(245,158,11,0.25)'}`, borderRadius:8, display:'flex', alignItems:'center', gap:10}}>
                                            <i className={`fa-solid ${ecart > 50 ? 'fa-triangle-exclamation' : 'fa-circle-info'}`} style={{color: ecart > 50 ? '#dc2626' : '#f59e0b', fontSize:16}}></i>
                                            <div style={{fontSize:12}}>
                                                <strong style={{color: ecart > 50 ? '#991b1b' : '#92400e'}}>
                                                    {ecart > 50 ? 'Incohérence poids' : 'Écart de poids'}:
                                                </strong>{' '}
                                                <span style={{color:'#555'}}>{nbColis} colis × {conf.poidsParColis} kg = <strong>{poidsCalcule} kg</strong> (saisi: {poidsSaisi} kg, écart: {ecart.toFixed(1)} kg)</span>
                                            </div>
                                        </div>
                                    );
                                })()}
                                {form.typeUnite && getConfByType(form.typeUnite)?.composition?.length > 0 && parseInt(form.nombreColis) > 0 && (
                                    <div style={{marginTop:10,padding:'8px 12px',background:'rgba(108,52,131,0.04)',borderRadius:8,border:'1px solid rgba(108,52,131,0.1)'}}>
                                        <div style={{fontSize:10,fontWeight:700,color:'var(--berry)',marginBottom:4}}>Consommation emballage estimée:</div>
                                        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                                            {getConfByType(form.typeUnite).composition.map((c, i) => (
                                                <span key={i} style={{fontSize:12,padding:'2px 8px',background:'#fff',borderRadius:6,border:'1px solid #eee'}}>
                                                    {c.article}: <strong>{c.qte * parseInt(form.nombreColis)}</strong>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Section 3: Scan du bon (masqué si scan déjà affiché à gauche) */}
                            {!scanPreview && (
                            <div style={{marginBottom:20}}>
                                <div style={{fontSize:12,fontWeight:700,color:'var(--berry)',marginBottom:10,borderBottom:'2px solid var(--berry)',paddingBottom:4}}>
                                    <i className="fa-solid fa-camera" style={{marginRight:6}}></i>Scan / Photo du Bon
                                </div>
                                <input type="file" accept="image/*" capture="environment" ref={scanFileRef} onChange={handleScanSelect}
                                    style={{display:'none'}} />
                                <button onClick={() => scanFileRef.current?.click()} style={{padding:'10px 20px',borderRadius:8,border:'2px dashed #ccc',background:'#fafafa',cursor:'pointer',fontSize:13,color:'#666'}}>
                                    <i className="fa-solid fa-camera" style={{marginRight:6}}></i>Prendre / Choisir une photo
                                </button>
                            </div>
                            )}

                            {/* Actions */}
                            <div data-tour="bon-form-submit" style={{display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid #eee',paddingTop:16}}>
                                <button onClick={() => { setShowForm(false); setEditingBon(null); setScanPreview(null); }} style={{padding:'10px 24px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                <button onClick={handleSubmit} disabled={saving} style={{padding:'10px 24px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                    <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`} style={{marginRight:6}}></i>
                                    {saving ? 'Enregistrement...' : (editingBon ? 'Modifier & Resoumettre' : 'Soumettre')}
                                </button>
                            </div>
                        </div>
                        </div>
                        </div>
                    )}

                    {(() => {
                        const toggleSort = (col) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } };
                        const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
                        const sorted = [...bonsList].sort((a, b) => {
                            let va, vb;
                            if (sortCol === 'bon') { va = parseInt(a.bonApport || a.numeroPiece || '0'); vb = parseInt(b.bonApport || b.numeroPiece || '0'); }
                            else if (sortCol === 'date') { va = new Date(a.date?.includes('/') ? a.date.split('/').reverse().join('-') : a.date || '1970').getTime(); vb = new Date(b.date?.includes('/') ? b.date.split('/').reverse().join('-') : b.date || '1970').getTime(); }
                            else if (sortCol === 'qte') { va = parseFloat(a.poidsLot || a.quantiteKg || 0); vb = parseFloat(b.poidsLot || b.quantiteKg || 0); }
                            else if (sortCol === 'ferme') { va = (a.blocFerme || a.ferme || ''); vb = (b.blocFerme || b.ferme || ''); }
                            else if (sortCol === 'variete') { va = (a.designation || ''); vb = (b.designation || ''); }
                            else { va = 0; vb = 0; }
                            if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
                            return sortDir === 'asc' ? va - vb : vb - va;
                        });
                        // Détecter les doublons par (numéro de bon + variété)
                        // Un même bon peut contenir plusieurs variétés — ce n'est pas un doublon.
                        const bonCount = {};
                        const firstBonId = {};
                        const dupKey = (b) => {
                            const num = String(b.bonApport || b.numeroPiece || '').trim();
                            const variete = String(b.designation || '').trim().toUpperCase();
                            return num ? `${num}__${variete}` : '';
                        };
                        sorted.forEach(b => {
                            const key = dupKey(b);
                            if (!key) return;
                            if (!bonCount[key]) { bonCount[key] = 0; firstBonId[key] = b.id; }
                            bonCount[key]++;
                        });
                        const toggleSelect = (id) => {
                            setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
                        };
                        const selectAll = () => {
                            const deletable = sorted.filter(b => b.id && (b.source === 'manual_entry' || b.source === 'scan_ocr'));
                            if (selectedIds.size === deletable.length) setSelectedIds(new Set());
                            else setSelectedIds(new Set(deletable.map(b => b.id)));
                        };
                        const deleteSelected = async () => {
                            if (selectedIds.size === 0) return;
                            if (!confirm(`Supprimer ${selectedIds.size} bon(s) sélectionné(s) ?`)) return;
                            try {
                                const db = firebase.firestore();
                                const batch = db.batch();
                                selectedIds.forEach(id => batch.delete(db.collection('pfq_interne').doc(id)));
                                await batch.commit();
                                setSelectedIds(new Set());
                                setSelectMode(false);
                                __set_bonsCache(null);
                                setReloadKey(k => k + 1);
                            } catch(err) { alert('Erreur: ' + err.message); }
                        };
                        return sorted.length === 0 ? (
                            <div style={{textAlign:'center',padding:60,color:'var(--gray-400)'}}><i className="fa-solid fa-inbox" style={{fontSize:48,marginBottom:16,display:'block'}}></i><p style={{fontSize:16,fontWeight:600}}>Aucun bon d'apport</p></div>
                        ) : (
                            <div>
                            {/* Barre de sélection */}
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                                <button onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }} style={{padding:'6px 14px',borderRadius:8,border: selectMode ? '2px solid #dc2626' : '1.5px solid #ddd',background: selectMode ? 'rgba(220,38,38,0.05)' : '#fff',color: selectMode ? '#dc2626' : '#666',cursor:'pointer',fontWeight:600,fontSize:12}}>
                                    <i className={selectMode ? 'fa-solid fa-xmark' : 'fa-solid fa-check-double'} style={{marginRight:6}}></i>
                                    {selectMode ? 'Annuler sélection' : 'Sélectionner'}
                                </button>
                                {selectMode && selectedIds.size > 0 && (
                                    <button onClick={deleteSelected} style={{padding:'6px 16px',borderRadius:8,border:'none',background:'#dc2626',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:12}}>
                                        <i className="fa-solid fa-trash" style={{marginRight:6}}></i>Supprimer {selectedIds.size} bon(s)
                                    </button>
                                )}
                            </div>
                            <div style={{overflowX:'auto'}}>
                            <table className="data-table">
                                <thead><tr>
                                    {selectMode && <th style={{width:36}}><input type="checkbox" onChange={selectAll} checked={selectedIds.size > 0 && selectedIds.size === sorted.filter(b => b.id && (b.source === 'manual_entry' || b.source === 'scan_ocr')).length} /></th>}
                                    <th onClick={() => toggleSort('bon')} style={{cursor:'pointer',userSelect:'none'}}>N° Bon{sortIcon('bon')}</th>
                                    <th>Type</th>
                                    <th onClick={() => toggleSort('ferme')} style={{cursor:'pointer',userSelect:'none'}}>Ferme{sortIcon('ferme')}</th>
                                    <th onClick={() => toggleSort('date')} style={{cursor:'pointer',userSelect:'none'}}>Date{sortIcon('date')}</th>
                                    <th onClick={() => toggleSort('variete')} style={{cursor:'pointer',userSelect:'none'}}>Variété{sortIcon('variete')}</th>
                                    <th onClick={() => toggleSort('qte')} style={{cursor:'pointer',userSelect:'none'}}>Quantité (KG){sortIcon('qte')}</th>
                                    <th>Status</th><th>Actions</th>
                                </tr></thead>
                                <tbody>{sorted.map(b => {
                                    const key = dupKey(b);
                                    const isDuplicate = !!key && bonCount[key] > 1 && b.id !== firstBonId[key];
                                    const canSelect = b.id && (b.source === 'manual_entry' || b.source === 'scan_ocr');
                                    return (
                                    <React.Fragment key={b.id || b.bonApport + '_' + (b.designation || '') + '_' + Math.random()}>
                                        <tr onClick={() => selectMode ? (canSelect && toggleSelect(b.id)) : setSelectedBon(b)} style={{cursor:'pointer', background: selectedIds.has(b.id) ? 'rgba(220,38,38,0.06)' : isDuplicate ? 'rgba(245,158,11,0.06)' : 'transparent'}}>
                                            {selectMode && <td onClick={e => e.stopPropagation()}>{canSelect && <input type="checkbox" checked={selectedIds.has(b.id)} onChange={() => toggleSelect(b.id)} />}</td>}
                                            <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{b.bonApport || b.numeroPiece}</td>
                                            <td><span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background: b.typeVente === 'Export' ? 'rgba(21,101,192,0.1)' : 'rgba(230,81,0,0.1)',color: b.typeVente === 'Export' ? '#1565C0' : '#e65100'}}>{b.typeVente || (b.type === 'export' ? 'Export' : 'Local')}</span></td>
                                            <td>{b.blocFerme || b.ferme}</td>
                                            <td style={{fontSize:12}}>{b.date || '—'}</td>
                                            <td style={{fontSize:12}}>{b.designation || '—'}</td>
                                            <td style={{fontWeight:600,textAlign:'right'}}>{(b.poidsLot || b.quantiteKg || 0).toLocaleString('fr-FR', {minimumFractionDigits:1})} kg</td>
                                            <td>
                                                {isDuplicate ? (
                                                    <span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background:'rgba(245,158,11,0.15)',color:'#b45309'}}>Doublon</span>
                                                ) : (
                                                    <span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background: `${statusColors[b.status] || '#999'}18`,color: statusColors[b.status] || '#999'}}>{statusLabels[b.status] || b.status || 'Importation Excel'}</span>
                                                )}
                                            </td>
                                            <td onClick={e => e.stopPropagation()}>
                                                {(b.status === 'rejete_qualite' || b.status === 'rejete_chef') && (
                                                    <button onClick={() => handleEdit(b)} style={{padding:'4px 12px',borderRadius:6,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:11}}>
                                                        <i className="fa-solid fa-pen" style={{marginRight:4}}></i>Modifier
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                        {(b.status === 'rejete_qualite' || b.status === 'rejete_chef') && b.motifRejet && (
                                            <tr><td colSpan={selectMode ? 10 : 9} style={{padding:'4px 12px',background:'rgba(220,38,38,0.05)',borderTop:'none'}}>
                                                <span style={{fontSize:11,color:'#dc2626'}}><i className="fa-solid fa-comment-dots" style={{marginRight:6}}></i><strong>Motif du rejet:</strong> {b.motifRejet}</span>
                                            </td></tr>
                                        )}
                                    </React.Fragment>
                                    );
                                })}</tbody>
                            </table>
                            </div>
                            </div>
                        );
                    })()}
                    {/* Modal Créer Client Marché Local */}
                    {showCreateClient && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCreateClient(false); }} style={{zIndex:10001}}>
                            <div className="modal-content" style={{maxWidth:400,width:'90vw'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-user-plus" style={{marginRight:8}}></i>Nouveau Client Marché Local</h3>
                                <div style={{marginBottom:14}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nom du client *</label>
                                    <input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Nom du client" autoFocus style={{width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid #ddd',fontSize:14}} />
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => { setShowCreateClient(false); setNewClientName(''); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreateClient} disabled={creatingClient} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:creatingClient?0.6:1}}>
                                        {creatingClient ? 'Création...' : 'Créer'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsBonApportTab };
