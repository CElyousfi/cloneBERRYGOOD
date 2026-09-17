/* Module: finance | Déclaration(s): FinLiquidationsTab */
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleAreaChart } from '../shared/SimpleAreaChart.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { invalidateCache } from '../shared/invalidateCache.jsx';
import { useState } from '../shared/reactHooks.jsx';
import { buildLiquidationsView } from './buildLiquidationsView.jsx';

function FinLiquidationsTab({ data, currentProfile }) {
            const isAdmin = currentProfile === 'dg' || currentProfile === 'finance';
            const [subTab, setSubTab] = useState('situation');
            const [editingPrix, setEditingPrix] = useState({});
            const [showDeductionModal, setShowDeductionModal] = useState(false);
            const [selectedFacture, setSelectedFacture] = useState(null);
            const [selectedLiquidation, setSelectedLiquidation] = useState(null);
            const [deductionForm, setDeductionForm] = useState({ type: 'plants', semaine: '', montant: '' });
            const [selectedFruit, setSelectedFruit] = useState('');
            const [fetchedDocs, setFetchedDocs] = useState(null);
            const [fetchedExpeditions, setFetchedExpeditions] = useState(null);
            const [plantInvoices, setPlantInvoices] = useState(null);
            const [uploadingInvoice, setUploadingInvoice] = useState(false);
            const [uploadResult, setUploadResult] = useState(null);
            const [uploadProgress, setUploadProgress] = useState(null); // { current, total, currentName }
            // Deduction montants:
            //  - cropAdvance = pot UNIQUE ferme (prêt Driscoll's global, partagé Framboise+Myrtille).
            //  - fruitAdvance = par culture (chaque fruit a son propre montant convenu).
            // Shape: { cropAdvance: number, fruitAdvance: { framboise: number, myrtille: number } }
            const [deductionMontants, setDeductionMontants] = useState({ cropAdvance: 0, fruitAdvance: { framboise: 0, myrtille: 0 } });
            const [editingMontant, setEditingMontant] = useState(null); // 'cropAdvance' | 'fruitAdvance' | null
            const [editMontantValue, setEditMontantValue] = useState('');
            const [editMontantPerCulture, setEditMontantPerCulture] = useState({ framboise: '', myrtille: '' });
            const [invoiceDragOver, setInvoiceDragOver] = useState(false);
            const fileInputRef = React.useRef(null);

            const fetchPlantInvoices = React.useCallback(() => {
                invalidateCache('plant-invoices');
                return fetch('/api/email-analysis?action=plant-invoices')
                    .then(r => r.json())
                    .then(json => { if (json.success) setPlantInvoices(json.invoices || []); })
                    .catch(() => setPlantInvoices([]));
            }, []);

            const handleDeleteInvoice = async (ref) => {
                if (!ref) return;
                if (!window.confirm(`Supprimer toutes les lignes de la facture ${ref} (et son PDF) ?`)) return;
                try {
                    const r = await fetch('/api/email-analysis?action=delete-plant-invoice', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ref, deleteStorage: true }),
                    });
                    const json = await r.json();
                    if (!json.success) { alert('Échec suppression: ' + (json.error || '')); return; }
                    await fetchPlantInvoices();
                    setUploadResult({ ok: true, msg: `Facture ${ref} supprimée` });
                } catch (e) { alert('Erreur réseau: ' + e.message); }
            };

            const handleRescanInvoice = async (ref) => {
                if (!ref) return;
                setUploadingInvoice(true);
                setUploadResult(null);
                setUploadProgress({ current: 1, total: 1, currentName: ref });
                try {
                    const r = await fetch('/api/email-analysis?action=rescan-plant-invoice', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ref }),
                    });
                    const json = await r.json();
                    if (json.success) {
                        await fetchPlantInvoices();
                        setUploadResult({ ok: true, msg: `${ref} re-scannée — ${json.created?.length || 0} ligne(s)` });
                    } else {
                        setUploadResult({ ok: false, msg: 'Échec re-scan: ' + (json.error || '') });
                    }
                } catch (e) {
                    setUploadResult({ ok: false, msg: 'Erreur réseau: ' + e.message });
                } finally {
                    setUploadingInvoice(false);
                    setUploadProgress(null);
                }
            };

            React.useEffect(() => {
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                    fetch('/api/email-analysis?action=plant-invoices').then(r => r.json()).catch(() => ({ success: false })),
                ]).then(([liqJson, expJson, plantJson]) => {
                    if (liqJson.success) setFetchedDocs(liqJson.liquidations || []);
                    else setFetchedDocs([]);
                    if (expJson.success && expJson.expeditions) setFetchedExpeditions(expJson.expeditions);
                    else setFetchedExpeditions([]);
                    if (plantJson && plantJson.success) setPlantInvoices(plantJson.invoices || []);
                    else setPlantInvoices([]);
                }).catch(() => { setFetchedDocs([]); setFetchedExpeditions([]); setPlantInvoices([]); });
                // Load deduction montants from Firestore — migrate older shapes:
                //  - v1 (flat): { cropAdvance, fruitAdvance } → cropAdvance global, fruitAdvance.framboise = old value.
                //  - v2 (per-culture): { framboise:{cA,fA}, myrtille:{cA,fA} } → cropAdvance = max(both), fruitAdvance per-culture.
                //  - v3 (current): { cropAdvance, fruitAdvance:{framboise,myrtille} } → as-is.
                firebase.firestore().collection('app_settings').doc('deduction_montants').get()
                    .then(doc => {
                        if (!doc.exists) return;
                        const data = doc.data() || {};
                        const isV3 = typeof data.fruitAdvance === 'object' && data.fruitAdvance !== null;
                        const isV2 = !isV3 && (data.framboise != null || data.myrtille != null);
                        const isV1 = !isV2 && !isV3 && (data.cropAdvance != null || data.fruitAdvance != null);
                        if (isV3) {
                            setDeductionMontants({
                                cropAdvance: data.cropAdvance || 0,
                                fruitAdvance: { framboise: data.fruitAdvance.framboise || 0, myrtille: data.fruitAdvance.myrtille || 0 },
                            });
                        } else if (isV2) {
                            const f = data.framboise || {}, m = data.myrtille || {};
                            setDeductionMontants({
                                cropAdvance: Math.max(f.cropAdvance || 0, m.cropAdvance || 0),
                                fruitAdvance: { framboise: f.fruitAdvance || 0, myrtille: m.fruitAdvance || 0 },
                            });
                        } else if (isV1) {
                            setDeductionMontants({
                                cropAdvance: data.cropAdvance || 0,
                                fruitAdvance: { framboise: data.fruitAdvance || 0, myrtille: 0 },
                            });
                        }
                    })
                    .catch(() => {});
            }, []);

            // Resolve montants for the current culture filter.
            //  - cropAdvance is GLOBAL → returned as-is regardless of culture.
            //  - fruitAdvance is per-culture; "Toutes" returns the sum.
            const getMontantsForCulture = (culture) => {
                const fA = deductionMontants.fruitAdvance || {};
                const cropAdvance = deductionMontants.cropAdvance || 0;
                if (culture === 'framboise') return { cropAdvance, fruitAdvance: fA.framboise || 0 };
                if (culture === 'myrtille') return { cropAdvance, fruitAdvance: fA.myrtille || 0 };
                return { cropAdvance, fruitAdvance: (fA.framboise || 0) + (fA.myrtille || 0) };
            };

            const saveDeductionMontant = async (type, value) => {
                let updated;
                if (type === 'cropAdvance') {
                    // Always a single global value, no culture distinction.
                    updated = { ...deductionMontants, cropAdvance: parseFloat(value) || 0 };
                } else if (type === 'fruitAdvance') {
                    const fA = { ...(deductionMontants.fruitAdvance || {}) };
                    if (selectedFruit) {
                        fA[selectedFruit] = parseFloat(value) || 0;
                    } else {
                        // "Toutes" mode — value is { framboise, myrtille }
                        const v = value || {};
                        fA.framboise = parseFloat(v.framboise) || 0;
                        fA.myrtille = parseFloat(v.myrtille) || 0;
                    }
                    updated = { ...deductionMontants, fruitAdvance: fA };
                } else {
                    return;
                }
                setDeductionMontants(updated);
                setEditingMontant(null);
                try {
                    await firebase.firestore().collection('app_settings').doc('deduction_montants').set(updated);
                } catch(e) { console.error('Save deduction montant error:', e); }
            };

            const handleUploadInvoices = async (filesIterable) => {
                const files = Array.from(filesIterable || []).filter(Boolean);
                if (files.length === 0) return;
                const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
                const valid = files.filter(f => validTypes.includes(f.type) && f.size <= 10 * 1024 * 1024);
                const skipped = files.length - valid.length;
                if (valid.length === 0) {
                    alert('Aucun fichier valide (PDF/JPG/PNG, max 10 MB)');
                    return;
                }
                setUploadingInvoice(true);
                setUploadResult(null);
                const successes = [];
                const failures = [];
                for (let i = 0; i < valid.length; i++) {
                    const file = valid[i];
                    setUploadProgress({ current: i + 1, total: valid.length, currentName: file.name });
                    try {
                        const base64 = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        const resp = await fetch('/api/email-analysis?action=scan-plant-invoice', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ pdf_base64: base64, filename: file.name }),
                        });
                        const json = await resp.json();
                        if (json.success) successes.push({ file: file.name, ref: json.analysis?.ref, lines: json.created?.length || 0 });
                        else failures.push({ file: file.name, error: json.error || 'Échec' });
                    } catch (e) {
                        failures.push({ file: file.name, error: e.message });
                    }
                }
                setUploadProgress(null);
                setUploadingInvoice(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
                await fetchPlantInvoices();
                setUploadResult({
                    ok: failures.length === 0,
                    msg: `${successes.length}/${valid.length} facture(s) traitée(s)${skipped > 0 ? ` — ${skipped} fichier(s) ignoré(s)` : ''}${failures.length > 0 ? ` — Erreurs: ${failures.map(f => f.file + ': ' + f.error).join(' | ')}` : ''}`,
                    successes,
                    failures,
                });
            };

            // Build live "à venir" list from expeditions (weeks with shipments but no liquidation yet).
            // Uses ISO week; estimates price from last 2 liquidations of the same culture.
            const computeLiveAVenir = () => {
                if (!fetchedExpeditions || !fetchedDocs) return null;
                const getISOWeek = (dateStr) => {
                    if (!dateStr) return null;
                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (!m) return null;
                    const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
                    d.setHours(0, 0, 0, 0);
                    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
                    const week1 = new Date(d.getFullYear(), 0, 4);
                    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
                };
                const getISOYear = (dateStr) => {
                    if (!dateStr) return null;
                    const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (!m) return null;
                    const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
                    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
                    return d.getFullYear();
                };
                const mondayOf = (year, week) => {
                    // ISO week Monday — add 4 weeks for Driscoll's settlement lag
                    const simple = new Date(year, 0, 1 + (week - 1) * 7);
                    const dow = simple.getDay() || 7;
                    const monday = new Date(simple);
                    monday.setDate(simple.getDate() - dow + 1);
                    return monday;
                };
                // Liquidated weeks — key WITHOUT culture (matches QualiteLiquidationsTab:15941).
                // A week is considered liquidated as soon as ANY liquidation exists for it.
                const liquidatedKeys = new Set();
                fetchedDocs.forEach(l => {
                    if (!l.week) return;
                    const m = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                    const y = m ? parseInt(m[1]) : (l.date ? new Date(l.date).getFullYear() : 2025);
                    liquidatedKeys.add(`${y}-W${l.week}`);
                });
                // Classify variety into culture — same regex as QualiteLiquidationsTab
                const varietyToCulture = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v || '') ? 'myrtille' : 'framboise';
                // Aggregate expedition kg by week (no culture), with breakdown by variety
                const agg = {};
                (fetchedExpeditions || []).filter(e => e.overallResult !== 'REJECT').forEach(e => {
                    const w = getISOWeek(e.date || '');
                    const y = getISOYear(e.date || '');
                    if (!w || !y) return;
                    const key = `${y}-W${w}`;
                    if (!agg[key]) agg[key] = { year: y, week: w, totalKg: 0, byVariety: {} };
                    const v = e.variety || '?';
                    agg[key].totalKg += (e.batchWeight || 0);
                    agg[key].byVariety[v] = (agg[key].byVariety[v] || 0) + (e.batchWeight || 0);
                });
                // Average price from last 2 liquidations per culture (matches qualite logic)
                const sortedLiqs = [...fetchedDocs].sort((a, b) => {
                    const ya = (() => { const m = (a.subject || '').match(/week\s*\d+[\/-](\d{4})/i); return m ? parseInt(m[1]) : 2025; })();
                    const yb = (() => { const m = (b.subject || '').match(/week\s*\d+[\/-](\d{4})/i); return m ? parseInt(m[1]) : 2025; })();
                    if (ya !== yb) return yb - ya;
                    return (b.week || 0) - (a.week || 0);
                });
                const priceByCulture = {};
                for (const liq of sortedLiqs) {
                    const culture = (liq.fruit || 'framboise').toLowerCase();
                    if (!priceByCulture[culture]) priceByCulture[culture] = [];
                    if (priceByCulture[culture].length >= 2) continue;
                    const totalKgLiq = (liq.rows || []).reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                    const totalGs = (liq.rows || []).reduce((s, r) => s + (r.gsNet || 0), 0);
                    if (totalKgLiq > 0) priceByCulture[culture].push(totalGs / totalKgLiq);
                }
                const avgPriceFor = (culture) => {
                    const arr = priceByCulture[culture] || [];
                    if (!arr.length) return 55;
                    return arr.reduce((s, p) => s + p, 0) / arr.length;
                };
                // Build aVenir entries — one per week, with variety breakdown and weighted price
                const entries = Object.values(agg)
                    .filter(a => !liquidatedKeys.has(`${a.year}-W${a.week}`))
                    .sort((a, b) => (a.year * 100 + a.week) - (b.year * 100 + b.week))
                    .map(a => {
                        // Filter byVariety by selectedFruit if active
                        const byVarietyFiltered = {};
                        let filteredKg = 0;
                        let weightedCA = 0;
                        const culturesInWeek = new Set();
                        Object.entries(a.byVariety).forEach(([v, kg]) => {
                            const culture = varietyToCulture(v);
                            if (selectedFruit && culture !== selectedFruit) return;
                            byVarietyFiltered[v] = kg;
                            filteredKg += kg;
                            weightedCA += kg * avgPriceFor(culture);
                            culturesInWeek.add(culture);
                        });
                        if (filteredKg === 0) return null;
                        const prixEstime = Math.round((weightedCA / filteredKg) * 100) / 100;
                        const settle = mondayOf(a.year, a.week);
                        settle.setDate(settle.getDate() + 28);
                        return {
                            semaine: `S${String(a.week).padStart(2, '0')}-${a.year}`,
                            year: a.year,
                            week: a.week,
                            qteKg: Math.round(filteredKg * 100) / 100,
                            prixEstime,
                            montantEstime: Math.round(filteredKg * prixEstime * 100) / 100,
                            dateEstimee: settle.toLocaleDateString('fr-FR'),
                            status: 'En attente',
                            byVariety: byVarietyFiltered,
                            cultures: Array.from(culturesInWeek),
                        };
                    })
                    .filter(Boolean);
                return entries;
            };

            // Loading state — show a spinner instead of demo data
            if (!fetchedDocs) {
                return React.createElement('div', { className:'loading', style:{padding:40, textAlign:'center', color:'var(--gray-400)'} },
                    React.createElement('i', { className:'fa-solid fa-spinner fa-spin', style:{fontSize:24, marginBottom:8} }),
                    React.createElement('div', null, 'Chargement des liquidations…')
                );
            }

            // Build the live view from Firestore — no demo fallback
            let liq = buildLiquidationsView(fetchedDocs, selectedFruit);
            const liveAVenir = computeLiveAVenir();
            if (liveAVenir) liq = { ...liq, aVenir: liveAVenir };

            // Inject plant invoices from Firestore if any have been uploaded
            const filteredInvoices = (plantInvoices || []).filter(inv => !selectedFruit || (inv.culture || 'framboise') === selectedFruit);
            if (plantInvoices && plantInvoices.length > 0) {
                const filteredInv = filteredInvoices;
                const sorted = [...filteredInv].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                const totalFacture = sorted.reduce((s, inv) => s + (inv.montant || 0), 0);
                const factures = sorted.map(inv => ({
                    id: inv.id,
                    date: inv.date ? inv.date.split('-').reverse().join('/') : '-',
                    ref: inv.ref || '-',
                    montant: inv.montant || 0,
                    variete: inv.variete || '-',
                    qte: inv.qte || 0,
                    commande: inv.commande,
                    packing: inv.packing,
                    echeance: inv.echeance ? inv.echeance.split('-').reverse().join('/') : '-',
                    livraison: inv.livraison ? inv.livraison.split('-').reverse().join('/') : '-',
                    pdfUrl: inv.pdfUrl,
                }));
                liq = {
                    ...liq,
                    deductions: {
                        ...liq.deductions,
                        plants: {
                            ...liq.deductions.plants,
                            totalFacture,
                            resteADeduire: Math.max(totalFacture - liq.deductions.plants.totalPreleve, 0),
                            factures,
                        },
                    },
                };
            }

            // Inject configured montants:
            //  - Crop Advance: pot UNIQUE — totalMontant + totalPreleve calculés sur TOUTES cultures,
            //    indépendants du filtre. C'est le solde restant du prêt Driscoll's pour la ferme.
            //  - Fruit Advance: par culture (suit le filtre, ou somme en "Toutes").
            const _curMontants = getMontantsForCulture(selectedFruit);
            const cropMontant = _curMontants.cropAdvance || 0;
            const fruitMontant = _curMontants.fruitAdvance || 0;
            const globalCropPreleve = (fetchedDocs || []).reduce((s, d) => s + (d.cropAdvance || 0), 0);
            liq = {
                ...liq,
                deductions: {
                    ...liq.deductions,
                    plants: {
                        ...liq.deductions.plants,
                        designation: selectedFruit === 'myrtille' ? 'Plants Myrtille' : selectedFruit === 'framboise' ? 'Plants Framboise' : 'Plants (Toutes cultures)',
                    },
                    cropAdvance: {
                        ...liq.deductions.cropAdvance,
                        designation: "Prêt Driscoll's (Crop Advance) — global ferme",
                        totalMontant: cropMontant,
                        totalPreleve: globalCropPreleve,
                        resteADeduire: Math.max(cropMontant - globalCropPreleve, 0),
                    },
                    fruitAdvance: {
                        ...liq.deductions.fruitAdvance,
                        totalMontant: fruitMontant,
                        resteADeduire: Math.max(fruitMontant - liq.deductions.fruitAdvance.totalPreleve, 0),
                    },
                },
            };

            const handlePrixChange = (semaine, newPrix) => {
                setEditingPrix(prev => ({ ...prev, [semaine]: parseFloat(newPrix) || 0 }));
            };

            const getEstimePrix = (item) => editingPrix[item.semaine] !== undefined ? editingPrix[item.semaine] : item.prixEstime;
            const getEstimeMontant = (item) => item.qteKg * getEstimePrix(item);

            const totalEncaisseHist = liq.historique.reduce((s, l) => s + l.montantNet, 0);
            const totalAVenir = liq.aVenir.reduce((s, l) => s + l.qteKg * getEstimePrix(l), 0);

            const pctPlants = liq.deductions.plants.totalFacture > 0
                ? (liq.deductions.plants.totalPreleve / liq.deductions.plants.totalFacture * 100)
                : 0;
            const pctPret = liq.deductions.cropAdvance.totalMontant > 0
                ? (liq.deductions.cropAdvance.totalPreleve / liq.deductions.cropAdvance.totalMontant * 100)
                : 0;

            return (
                <div className="fade-in">
                    {/* Culture filter */}
                    <div style={{display:'flex', gap:'8px', marginBottom:'12px', alignItems:'center'}}>
                        <span style={{fontSize:12, color:'var(--gray-500)', fontWeight:600}}>Culture:</span>
                        <button className={`chip c-purple ${!selectedFruit ? 'active' : ''}`} onClick={() => setSelectedFruit('')}>Toutes</button>
                        <button className={`chip c-berry ${selectedFruit === 'framboise' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'framboise' ? '' : 'framboise')}>🍓 Framboise</button>
                        <button className={`chip c-indigo ${selectedFruit === 'myrtille' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'myrtille' ? '' : 'myrtille')}>🫐 Myrtille</button>
                        {fetchedDocs === null && <span style={{fontSize:11, color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin" style={{marginRight:4}}></i>Chargement…</span>}
                        {fetchedDocs !== null && <span style={{fontSize:11, color:'var(--green)'}}><i className="fa-solid fa-check-circle" style={{marginRight:4}}></i>Données en direct ({fetchedDocs.length} liquidations)</span>}
                    </div>
                    {/* Sub-tab navigation */}
                    <div style={{display:'flex', gap:'8px', marginBottom:'20px'}}>
                        {[
                            {id:'situation', label:'Situation Globale', icon:'fa-chart-line'},
                            {id:'deductions', label:'Déductions', icon:'fa-scissors'},
                            {id:'planning', label:'Planning Prélèvements', icon:'fa-calendar-check'}
                        ].map(t => (
                            <button key={t.id} className={`chip c-berry ${subTab===t.id ? 'active' : ''}`} onClick={() => setSubTab(t.id)} style={{padding:'8px 18px',fontSize:12.5}}>
                                <i className={`fa-solid ${t.icon}`} style={{marginRight:4}}></i> {t.label}
                            </button>
                        ))}
                    </div>

                    {subTab === 'situation' && (
                        <div>
                            {/* KPIs */}
                            <div className="kpi-grid">
                                <KPICard icon="fa-weight-scale" iconClass="berry" value={liq.totalKg.toLocaleString('fr-FR')} label="Total Kg Campagne" />
                                <KPICard icon="fa-money-bill-trend-up" iconClass="green" value={`${Math.round(liq.totalBrut/1000).toLocaleString('fr-FR')}K`} label="Montant Brut (DH)" />
                                <KPICard icon="fa-hand-holding-dollar" iconClass="blue" value={`${Math.round(liq.totalEncaisse/1000).toLocaleString('fr-FR')}K`} label="Encaissé (DH)" />
                                <KPICard icon="fa-clock" iconClass="orange" value={`${Math.round(liq.enCours/1000).toLocaleString('fr-FR')}K`} label="En Cours (DH)" />
                            </div>

                            {/* Liquidations à venir */}
                            <Panel title="Liquidations à Venir (décalage 4 semaines)" icon="fa-forward">
                                <p style={{fontSize:'12px', color:'var(--gray-400)', marginBottom:'12px'}}>
                                    <i className="fa-solid fa-info-circle"></i> Prix estimé pondéré par variété (moyenne des 2 dernières liquidations par culture). Modifiable.
                                </p>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Variétés</th>
                                            <th>Quantité (Kg)</th>
                                            <th>Prix Estimé (DH/Kg)</th>
                                            <th>Montant Estimé (DH)</th>
                                            <th>Date Estimée Encaissement</th>
                                            <th>Statut</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {liq.aVenir.map((l, i) => {
                                            const byVar = l.byVariety || {};
                                            const varEntries = Object.entries(byVar).sort((a, b) => b[1] - a[1]);
                                            return (
                                                <tr key={i}>
                                                    <td><strong>{l.semaine}</strong>{l.cultures && l.cultures.length > 1 && <span style={{marginLeft:6, fontSize:10}}>🍓🫐</span>}</td>
                                                    <td style={{fontSize:11, color:'var(--gray-600)'}}>
                                                        {varEntries.length === 0 ? '-' : varEntries.map(([v, kg], j) => (
                                                            <span key={v} style={{display:'inline-block', marginRight:8}}>
                                                                <strong>{v}</strong>: {Math.round(kg).toLocaleString('fr-FR')}{j < varEntries.length - 1 ? ' ·' : ''}
                                                            </span>
                                                        ))}
                                                    </td>
                                                    <td>{l.qteKg.toLocaleString('fr-FR')}</td>
                                                    <td>
                                                        <input type="number" step="0.01" value={getEstimePrix(l)}
                                                            onChange={e => handlePrixChange(l.semaine, e.target.value)}
                                                            style={{width:'90px', padding:'4px 8px', border:'1px solid var(--gold)', borderRadius:'6px', fontSize:'13px', fontWeight:'600', color:'var(--berry)', background:'rgba(212,168,71,0.08)', textAlign:'right'}} />
                                                    </td>
                                                    <td><strong>{Math.round(getEstimeMontant(l)).toLocaleString('fr-FR')}</strong></td>
                                                    <td>{l.dateEstimee}</td>
                                                    <td><span className={`status-badge ${l.status === 'En attente' ? 'orange' : 'blue'}`}>{l.status === 'En attente' ? '⏳' : '🔮'} {l.status}</span></td>
                                                </tr>
                                            );
                                        })}
                                        <tr style={{background:'var(--gray-100)', fontWeight:'700'}}>
                                            <td>TOTAL À VENIR</td>
                                            <td></td>
                                            <td>{liq.aVenir.reduce((s,l) => s+l.qteKg, 0).toLocaleString('fr-FR')}</td>
                                            <td></td>
                                            <td>{Math.round(totalAVenir).toLocaleString('fr-FR')}</td>
                                            <td></td>
                                            <td></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </Panel>

                            {/* Historique Liquidations */}
                            <Panel title="Historique Liquidations Campagne 2025-2026" icon="fa-history">
                                <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:8}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i> Cliquez sur une liquidation pour voir le rapport Driscoll's</div>
                                <div style={{maxHeight:'400px', overflowY:'auto'}}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Qté (Kg)</th>
                                            <th>Prix Moy.</th>
                                            <th>Montant Brut</th>
                                            <th>Prélèv. Plants</th>
                                            <th>Prélèv. Prêt</th>
                                            <th>Montant Net</th>
                                            <th>Encaissement</th>
                                            <th>Statut</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {liq.historique.slice().reverse().map((l, i) => (
                                            <tr key={i} onClick={() => setSelectedLiquidation(l)} style={{cursor:'pointer'}}
                                                onMouseOver={e => e.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                                onMouseOut={e => e.currentTarget.style.background=''}>
                                                <td><strong style={{color:'var(--berry)'}}>{l.semaine}</strong></td>
                                                <td>{l.qteKg.toLocaleString('fr-FR')}</td>
                                                <td>{l.prixMoyen.toFixed(2)}</td>
                                                <td>{Math.round(l.montantBrut).toLocaleString('fr-FR')}</td>
                                                <td style={{color: l.prelevPlants > 0 ? 'var(--red)' : 'var(--gray-400)'}}>{l.prelevPlants > 0 ? `-${Math.round(l.prelevPlants).toLocaleString('fr-FR')}` : '-'}</td>
                                                <td style={{color: l.prelevPret > 0 ? 'var(--red)' : 'var(--gray-400)'}}>{l.prelevPret > 0 ? `-${Math.round(l.prelevPret).toLocaleString('fr-FR')}` : '-'}</td>
                                                <td><strong style={{color:'var(--green)'}}>{Math.round(l.montantNet).toLocaleString('fr-FR')}</strong></td>
                                                <td>{l.dateEncaissement}</td>
                                                <td><span className="status-badge green">✓ {l.status}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    {(() => {
                                        const h = liq.historique;
                                        const totKg = h.reduce((s, l) => s + (l.qteKg || 0), 0);
                                        const totBrut = h.reduce((s, l) => s + (l.montantBrut || 0), 0);
                                        const totPlants = h.reduce((s, l) => s + (l.prelevPlants || 0), 0);
                                        const totPret = h.reduce((s, l) => s + (l.prelevPret || 0), 0);
                                        const totNet = h.reduce((s, l) => s + (l.montantNet || 0), 0);
                                        const avgPrix = totKg > 0 ? totBrut / totKg : 0;
                                        return (
                                            <tfoot>
                                                <tr style={{background:'var(--gray-100)', fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                    <td>TOTAL</td>
                                                    <td>{totKg.toLocaleString('fr-FR', {maximumFractionDigits:1})}</td>
                                                    <td>{avgPrix.toFixed(2)}</td>
                                                    <td>{Math.round(totBrut).toLocaleString('fr-FR')}</td>
                                                    <td style={{color:'var(--red)'}}>{totPlants > 0 ? `-${Math.round(totPlants).toLocaleString('fr-FR')}` : '-'}</td>
                                                    <td style={{color:'var(--red)'}}>{totPret > 0 ? `-${Math.round(totPret).toLocaleString('fr-FR')}` : '-'}</td>
                                                    <td style={{color:'var(--green)'}}>{Math.round(totNet).toLocaleString('fr-FR')}</td>
                                                    <td colSpan="2"></td>
                                                </tr>
                                            </tfoot>
                                        );
                                    })()}
                                </table>
                                </div>
                            </Panel>

                            {/* Evolution chart */}
                            <Panel title="Évolution Prix Moyen par Semaine" icon="fa-chart-line">
                                <SimpleAreaChart
                                    data={liq.historique.map(l => ({ semaine: l.semaine.replace('S','').replace('-2025','').replace('-2026','\'26'), prix: l.prixMoyen, montantK: Math.round(l.montantBrut/1000) }))}
                                    dataKeys={['prix']}
                                    colors={['#8B2252']}
                                    xKey="semaine"
                                    height={220}
                                />
                            </Panel>
                        </div>
                    )}

                    {subTab === 'deductions' && (
                        <div>
                            {/* Summary KPIs */}
                            <div className="kpi-grid">
                                <KPICard icon="fa-seedling" iconClass="green"
                                    value={`${Math.round(liq.deductions.plants.resteADeduire/1000).toLocaleString('fr-FR')}K`}
                                    label="Reste Plants"
                                    subItems={[
                                        {value: `${Math.round(liq.deductions.plants.totalFacture/1000)}K`, label: 'Facturé'},
                                        {value: `${Math.round(liq.deductions.plants.totalPreleve/1000)}K`, label: 'Prélevé'},
                                        {value: `${pctPlants.toFixed(1)}%`, label: 'Avancement'}
                                    ]} />
                                <div onClick={() => {
                                        // Crop Advance is a GLOBAL pot — always single value, no per-culture editor.
                                        setEditingMontant('cropAdvance');
                                        setEditMontantValue(String(deductionMontants.cropAdvance || ''));
                                    }} style={{cursor: 'pointer'}}>
                                <KPICard icon="fa-handshake" iconClass="blue"
                                    value={`${Math.round(liq.deductions.cropAdvance.resteADeduire/1000).toLocaleString('fr-FR')}K`}
                                    label="Reste Crop Advance"
                                    subItems={[
                                        {value: `${Math.round(liq.deductions.cropAdvance.totalMontant/1000)}K`, label: 'Montant'},
                                        {value: `${Math.round(liq.deductions.cropAdvance.totalPreleve/1000)}K`, label: 'Prélevé'},
                                        {value: `${pctPret.toFixed(1)}%`, label: 'Avancement'}
                                    ]} />
                                </div>
                                <div onClick={() => {
                                        setEditingMontant('fruitAdvance');
                                        if (selectedFruit) {
                                            setEditMontantValue(String(getMontantsForCulture(selectedFruit).fruitAdvance || ''));
                                        } else {
                                            const fA = deductionMontants.fruitAdvance || {};
                                            setEditMontantPerCulture({
                                                framboise: String(fA.framboise || ''),
                                                myrtille: String(fA.myrtille || ''),
                                            });
                                        }
                                    }} style={{cursor: 'pointer'}}>
                                <KPICard icon="fa-apple-whole" iconClass="orange"
                                    value={`${Math.round(liq.deductions.fruitAdvance.resteADeduire/1000).toLocaleString('fr-FR')}K`}
                                    label="Reste Fruit Advance"
                                    subItems={[
                                        {value: `${Math.round(liq.deductions.fruitAdvance.totalMontant/1000)}K`, label: 'Montant'},
                                        {value: `${Math.round(liq.deductions.fruitAdvance.totalPreleve/1000)}K`, label: 'Prélevé'}
                                    ]} />
                                </div>
                                <KPICard icon="fa-calculator" iconClass="berry"
                                    value={`${Math.round((liq.deductions.plants.resteADeduire + liq.deductions.cropAdvance.resteADeduire + liq.deductions.fruitAdvance.resteADeduire)/1000).toLocaleString('fr-FR')}K`}
                                    label="Total Reste à Déduire" />
                            </div>

                            {/* Progress bars */}
                            <Panel title="Avancement des Déductions" icon="fa-tasks">
                                {[
                                    { label: liq.deductions.plants.designation, pct: pctPlants, total: liq.deductions.plants.totalFacture, preleve: liq.deductions.plants.totalPreleve, color: 'var(--green)' },
                                    { label: 'Crop Advance (Prêt)', pct: pctPret, total: liq.deductions.cropAdvance.totalMontant, preleve: liq.deductions.cropAdvance.totalPreleve, color: 'var(--blue)' },
                                    { label: 'Fruit Advance', pct: liq.deductions.fruitAdvance.totalMontant > 0 ? (liq.deductions.fruitAdvance.totalPreleve / liq.deductions.fruitAdvance.totalMontant * 100) : 0, total: liq.deductions.fruitAdvance.totalMontant, preleve: liq.deductions.fruitAdvance.totalPreleve, color: 'var(--orange)' },
                                ].map((d, i) => (
                                    <div key={i} style={{marginBottom:'20px'}}>
                                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}>
                                            <span style={{fontWeight:'600', fontSize:'14px'}}>{d.label}</span>
                                            <span style={{fontSize:'13px', color:'var(--gray-600)'}}>
                                                {Math.round(d.preleve).toLocaleString('fr-FR')} / {Math.round(d.total).toLocaleString('fr-FR')} DH ({d.pct.toFixed(1)}%)
                                            </span>
                                        </div>
                                        <div style={{height:'12px', background:'var(--gray-100)', borderRadius:'6px', overflow:'hidden'}}>
                                            <div style={{height:'100%', width:`${Math.min(d.pct, 100)}%`, background:d.color, borderRadius:'6px', transition:'width 0.5s ease'}}></div>
                                        </div>
                                    </div>
                                ))}
                            </Panel>

                            {/* Factures Plants */}
                            <Panel title={`Factures ${liq.deductions.plants.designation}`} icon="fa-file-invoice" actions={
                                plantInvoices !== null && <span style={{fontSize:11, color:'var(--gray-400)'}}>{filteredInvoices.length} facture(s)</span>
                            }>
                                {/* Drop zone — clickable + drag-and-drop, multi-file */}
                                <input type="file" ref={fileInputRef} accept="application/pdf,image/jpeg,image/png,image/webp" multiple style={{display:'none'}}
                                    onChange={e => handleUploadInvoices(e.target.files)} />
                                <div
                                    onClick={() => !uploadingInvoice && fileInputRef.current && fileInputRef.current.click()}
                                    onDragOver={e => { e.preventDefault(); if (!uploadingInvoice) setInvoiceDragOver(true); }}
                                    onDragEnter={e => { e.preventDefault(); if (!uploadingInvoice) setInvoiceDragOver(true); }}
                                    onDragLeave={() => setInvoiceDragOver(false)}
                                    onDrop={e => { e.preventDefault(); setInvoiceDragOver(false); if (!uploadingInvoice) handleUploadInvoices(e.dataTransfer.files); }}
                                    style={{
                                        border: invoiceDragOver ? '2.5px solid var(--berry)' : '2.5px dashed var(--gray-300)',
                                        borderRadius: 12,
                                        padding: '20px 24px',
                                        textAlign: 'center',
                                        cursor: uploadingInvoice ? 'wait' : 'pointer',
                                        background: invoiceDragOver ? 'rgba(139,34,82,0.06)' : 'var(--gray-50)',
                                        transition: 'all 0.2s ease',
                                        marginBottom: 12,
                                    }}>
                                    <i className={`fa-solid ${uploadingInvoice ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`} style={{fontSize:28, color: invoiceDragOver ? 'var(--berry)' : 'var(--gray-400)', marginBottom:8, display:'block'}}></i>
                                    <div style={{fontSize:13, fontWeight:600, color:'var(--dark)'}}>
                                        {uploadingInvoice
                                            ? (uploadProgress ? `Analyse ${uploadProgress.current}/${uploadProgress.total} : ${uploadProgress.currentName}` : 'Analyse en cours…')
                                            : 'Glissez-déposez vos factures plants ici ou cliquez pour parcourir'}
                                    </div>
                                    <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>PDF, JPG, PNG · max 10 MB · multi-fichiers OK</div>
                                </div>

                                {uploadResult && (
                                    <div style={{padding:'10px 14px', marginBottom:10, borderRadius:8, fontSize:12, background: uploadResult.ok ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)', color: uploadResult.ok ? '#2e7d32' : '#c62828', border:`1px solid ${uploadResult.ok ? '#a5d6a7' : '#ef9a9a'}`}}>
                                        <i className={`fa-solid ${uploadResult.ok ? 'fa-check-circle' : 'fa-circle-exclamation'}`} style={{marginRight:6}}></i>
                                        {uploadResult.msg}
                                        <button onClick={() => setUploadResult(null)} style={{float:'right', background:'none', border:'none', cursor:'pointer', color:'inherit'}}>×</button>
                                    </div>
                                )}

                                {liq.deductions.plants.factures.length > 0 && (
                                    <p style={{fontSize:'11px', color:'var(--gray-400)', marginBottom:'10px'}}>
                                        <i className="fa-solid fa-hand-pointer"></i> Cliquez sur une facture pour afficher le détail Driscoll's
                                    </p>
                                )}
                                {liq.deductions.plants.factures.length === 0 ? (
                                    <div style={{textAlign:'center', padding:'24px', color:'var(--gray-400)', fontSize:12}}>
                                        Aucune facture pour l'instant — uploadez vos PDFs Driscoll's via la zone ci-dessus.
                                    </div>
                                ) : (
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th><th>Référence</th><th>Commande</th><th>Variété</th><th>Quantité</th><th>Montant (DH)</th>
                                                {isAdmin && <th style={{textAlign:'center', width:80}}>Actions</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {liq.deductions.plants.factures.map((f, i) => {
                                                // Show admin actions only on the FIRST row of each ref to avoid clutter
                                                const isFirstOfRef = i === 0 || liq.deductions.plants.factures[i - 1].ref !== f.ref;
                                                return (
                                                    <tr key={i} onClick={() => setSelectedFacture(f)} style={{cursor:'pointer', transition:'background 0.15s'}} onMouseOver={e => e.currentTarget.style.background='var(--berry-pale)'} onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td>{f.date}</td>
                                                        <td><strong style={{color:'var(--blue)'}}>{f.ref}</strong></td>
                                                        <td style={{fontFamily:'monospace', fontSize:11, color:'var(--gray-500)'}}>{f.commande || '-'}</td>
                                                        <td style={{fontWeight:500}}>{f.variete}</td>
                                                        <td>{f.qte ? f.qte.toLocaleString('fr-FR') : '-'}</td>
                                                        <td>{Math.round(f.montant).toLocaleString('fr-FR')}</td>
                                                        {isAdmin && (
                                                            <td style={{textAlign:'center'}} onClick={e => e.stopPropagation()}>
                                                                {isFirstOfRef && (
                                                                    <div style={{display:'flex', gap:4, justifyContent:'center'}}>
                                                                        <button onClick={() => handleRescanInvoice(f.ref)} disabled={uploadingInvoice}
                                                                            title="Re-scanner ce PDF"
                                                                            style={{background:'var(--blue)', color:'#fff', border:'none', borderRadius:6, padding:'4px 8px', cursor:uploadingInvoice?'wait':'pointer', fontSize:10}}>
                                                                            <i className="fa-solid fa-arrows-rotate"></i>
                                                                        </button>
                                                                        <button onClick={() => handleDeleteInvoice(f.ref)} disabled={uploadingInvoice}
                                                                            title="Supprimer cette facture"
                                                                            style={{background:'var(--red)', color:'#fff', border:'none', borderRadius:6, padding:'4px 8px', cursor:uploadingInvoice?'wait':'pointer', fontSize:10}}>
                                                                            <i className="fa-solid fa-trash"></i>
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                            <tr style={{background:'var(--gray-100)', fontWeight:'700'}}>
                                                <td colSpan={isAdmin ? 5 : 5}>TOTAL FACTURÉ</td>
                                                <td>{Math.round(liq.deductions.plants.totalFacture).toLocaleString('fr-FR')}</td>
                                                {isAdmin && <td></td>}
                                            </tr>
                                        </tbody>
                                    </table>
                                )}
                            </Panel>

                            {/* ===== FACTURE POPUP ===== */}
                            {selectedFacture && (
                                <div className="modal-overlay" onClick={() => setSelectedFacture(null)}>
                                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'700px', maxHeight:'90vh', overflowY:'auto', padding:0}}>
                                        {/* Driscoll's Invoice Header */}
                                        <div style={{padding:'20px 24px 16px', borderBottom:'3px solid var(--green)'}}>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                                                <div>
                                                    <div style={{fontSize:'11px', color:'var(--gray-400)', fontWeight:600}}>Driscoll's Du Maroc SARL</div>
                                                    <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Douar Dlalha - BP 4422</div>
                                                    <div style={{fontSize:'10px', color:'var(--gray-400)'}}>92003 My Bouselham (Larache), Maroc</div>
                                                </div>
                                                <div style={{textAlign:'right'}}>
                                                    <div style={{fontSize:'22px', fontWeight:'800', color:'var(--green)', fontFamily:'Georgia, serif', letterSpacing:'-0.5px'}}>FACTURE</div>
                                                    <div style={{fontSize:'10px', color:'var(--gray-400)', marginTop:'2px'}}>Driscoll's - Only the Finest Berries</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Address + Invoice Info */}
                                        <div style={{padding:'12px 24px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', borderBottom:'1px solid var(--gray-200)'}}>
                                            <div>
                                                <div style={{fontSize:'10px', fontWeight:'600', color:'var(--gray-400)', textTransform:'uppercase', marginBottom:'4px'}}>Adresse de facturation</div>
                                                <div style={{fontSize:'12px', fontWeight:'600'}}>Berry Good Farms SARL</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>Res Tifaouine Imm E Apt 21 Av Moukawama</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>ICE 002106859000069</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>80020 Agadir, Maroc</div>
                                            </div>
                                            <div>
                                                <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'3px 10px', fontSize:'11px'}}>
                                                    <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Client</span><span>400145</span>
                                                    <span style={{fontWeight:'600', color:'var(--gray-400)'}}>IF N.</span><span>2610702</span>
                                                    <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Notre réf.</span><span>11265</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Commande + Facture ref */}
                                        <div style={{padding:'10px 24px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', borderBottom:'1px solid var(--gray-200)', background:'var(--gray-100)'}}>
                                            <div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)', fontWeight:600}}>Commande</div>
                                                <div style={{fontSize:'12px', fontWeight:700}}>{selectedFacture.commande || '-'}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>{selectedFacture.date}</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)', fontWeight:600}}>Facture</div>
                                                <div style={{fontSize:'12px', fontWeight:700, color:'var(--berry)'}}>{selectedFacture.ref}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>{selectedFacture.date}</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)', fontWeight:600}}>Date de livraison</div>
                                                <div style={{fontSize:'12px', fontWeight:600}}>{selectedFacture.livraison || '-'}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-500)'}}>Conditions: EXW</div>
                                            </div>
                                        </div>

                                        {/* Invoice Lines Table */}
                                        <div style={{padding:'12px 24px'}}>
                                            <table className="data-table" style={{fontSize:'12px'}}>
                                                <thead>
                                                    <tr style={{background:'var(--gray-100)'}}>
                                                        <th>Qté</th><th>Nom du produit</th><th style={{textAlign:'right'}}>Poids net</th><th style={{textAlign:'right'}}>Unité</th><th style={{textAlign:'right'}}>Prix unitaire</th><th style={{textAlign:'right'}}>TVA %</th><th style={{textAlign:'right'}}>Montant</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr style={{fontSize:'11px', color:'var(--gray-400)'}}>
                                                        <td colSpan="7">{selectedFacture.commande || '-'}</td>
                                                    </tr>
                                                    <tr style={{fontSize:'11px', color:'var(--gray-400)'}}>
                                                        <td colSpan="7">Packing slip {selectedFacture.packing || '-'}:</td>
                                                    </tr>
                                                    <tr>
                                                        <td>{selectedFacture.qte ? selectedFacture.qte.toLocaleString('fr-FR') : '-'}</td>
                                                        <td style={{fontWeight:600}}>{selectedFacture.variete}</td>
                                                        <td style={{textAlign:'right'}}>0.00</td>
                                                        <td style={{textAlign:'right'}}>1000 ea</td>
                                                        <td style={{textAlign:'right'}}>MAD {selectedFacture.qte ? (selectedFacture.montant / selectedFacture.qte * 1000).toFixed(2) : '-'}</td>
                                                        <td style={{textAlign:'right'}}>0,00 %</td>
                                                        <td style={{textAlign:'right', fontWeight:700}}>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</td>
                                                    </tr>
                                                    <tr style={{background:'var(--gray-100)', fontWeight:700, borderTop:'2px solid var(--gray-300)'}}>
                                                        <td colSpan="3"></td>
                                                        <td colSpan="3" style={{textAlign:'right'}}>Total before VAT</td>
                                                        <td style={{textAlign:'right'}}>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* TVA + Totals */}
                                        <div style={{padding:'0 24px 12px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px'}}>
                                            <div style={{fontSize:'11px', color:'var(--gray-500)'}}>
                                                <div><strong>Exonerable</strong></div>
                                                <div style={{marginTop:'4px'}}>Conditions de paiement: <strong>90 Jours</strong></div>
                                                <div>Date d'échéance: <strong>{selectedFacture.echeance || '-'}</strong></div>
                                            </div>
                                            <div>
                                                <div style={{background:'var(--gray-100)', borderRadius:'8px', padding:'8px 12px', fontSize:'11px'}}>
                                                    <div style={{fontWeight:600, marginBottom:'4px'}}>TVA - IF N. 04960175</div>
                                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'2px', fontSize:'10px', color:'var(--gray-400)'}}>
                                                        <span>TVA %</span><span>HT</span><span>TVA</span>
                                                        <span>0,00 %</span><span>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</span><span>MAD 0.00</span>
                                                    </div>
                                                    <div style={{borderTop:'1px solid var(--gray-300)', marginTop:'6px', paddingTop:'6px', display:'flex', justifyContent:'space-between'}}>
                                                        <span>Total TVA</span><span>MAD 0.00</span>
                                                    </div>
                                                </div>
                                                <div style={{marginTop:'8px', background:'var(--berry-pale)', borderRadius:'8px', padding:'10px 12px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                    <span style={{fontWeight:700, fontSize:'13px'}}>Total TTC</span>
                                                    <span style={{fontWeight:800, fontSize:'15px', color:'var(--berry)'}}>MAD {selectedFacture.montant.toLocaleString('fr-FR', {minimumFractionDigits:2})}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div style={{padding:'10px 24px', borderTop:'1px solid var(--gray-200)', fontSize:'9px', color:'var(--gray-400)'}}>
                                            <div>Vente Fermée | En cas de retards de paiement une pénalité égale à une fois et demi le taux de l'intérêt légal sera exigible.</div>
                                            <div style={{marginTop:'2px'}}>*R.C. 24587 *T.P. 22211020 * IF 04960175 * CNSS 2258053 * ICE 001536944000082</div>
                                        </div>

                                        {/* Close button */}
                                        <div style={{padding:'12px 24px 16px', textAlign:'center'}}>
                                            <button className="btn-primary" onClick={() => setSelectedFacture(null)} style={{width:'auto', padding:'10px 32px'}}>
                                                <i className="fa-solid fa-times"></i> Fermer
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Historique Prélèvements Plants */}
                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'16px'}}>
                                <Panel title={`Prélèvements ${liq.deductions.plants.designation}`} icon="fa-seedling">
                                    <div style={{maxHeight:'300px', overflowY:'auto'}}>
                                    <table className="data-table">
                                        <thead><tr><th>Semaine</th><th>Montant (DH)</th></tr></thead>
                                        <tbody>
                                            {liq.deductions.plants.prelevements.map((p, i) => {
                                                const matchedLiq = liq.historique.find(h => h.semaine === p.semaine);
                                                return (
                                                    <tr key={i} style={{cursor: matchedLiq ? 'pointer' : 'default'}} onClick={() => matchedLiq && setSelectedLiquidation(matchedLiq)}
                                                        onMouseOver={e => matchedLiq && (e.currentTarget.style.background='rgba(139,34,82,0.04)')}
                                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td><span style={{color: matchedLiq ? 'var(--berry)' : 'inherit', fontWeight: matchedLiq ? 600 : 400}}>{p.semaine}</span></td>
                                                        <td style={{color:'var(--red)'}}>{Math.round(p.montant).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>
                                <Panel title="Prélèvements Crop Advance" icon="fa-handshake">
                                    <div style={{maxHeight:'300px', overflowY:'auto'}}>
                                    <table className="data-table">
                                        <thead><tr><th>Semaine</th><th>Montant (DH)</th></tr></thead>
                                        <tbody>
                                            {liq.deductions.cropAdvance.prelevements.map((p, i) => {
                                                const matchedLiq = liq.historique.find(h => h.semaine === p.semaine);
                                                return (
                                                    <tr key={i} style={{cursor: matchedLiq ? 'pointer' : 'default'}} onClick={() => matchedLiq && setSelectedLiquidation(matchedLiq)}
                                                        onMouseOver={e => matchedLiq && (e.currentTarget.style.background='rgba(139,34,82,0.04)')}
                                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td><span style={{color: matchedLiq ? 'var(--berry)' : 'inherit', fontWeight: matchedLiq ? 600 : 400}}>{p.semaine}</span></td>
                                                        <td style={{color:'var(--red)'}}>{Math.round(p.montant).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>
                                <Panel title="Prélèvements Fruit Advance" icon="fa-apple-whole">
                                    <div style={{maxHeight:'300px', overflowY:'auto'}}>
                                    <table className="data-table">
                                        <thead><tr><th>Semaine</th><th>Montant (DH)</th></tr></thead>
                                        <tbody>
                                            {liq.deductions.fruitAdvance.prelevements.map((p, i) => {
                                                const matchedLiq = liq.historique.find(h => h.semaine === p.semaine);
                                                return (
                                                    <tr key={i} style={{cursor: matchedLiq ? 'pointer' : 'default'}} onClick={() => matchedLiq && setSelectedLiquidation(matchedLiq)}
                                                        onMouseOver={e => matchedLiq && (e.currentTarget.style.background='rgba(139,34,82,0.04)')}
                                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                                        <td><span style={{color: matchedLiq ? 'var(--berry)' : 'inherit', fontWeight: matchedLiq ? 600 : 400}}>{p.semaine}</span></td>
                                                        <td style={{color:'var(--red)'}}>{Math.round(p.montant).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    </div>
                                </Panel>
                            </div>

                            {/* Add deduction button */}
                            <button className="fab-btn" onClick={() => setShowDeductionModal(true)} title="Saisir une déduction">
                                <i className="fa-solid fa-plus"></i>
                            </button>

                            {showDeductionModal && (
                                <div className="modal-overlay" onClick={() => setShowDeductionModal(false)}>
                                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                                        <h2><i className="fa-solid fa-scissors"></i> Saisir Déduction</h2>
                                        <div className="form-group">
                                            <label>Type de Déduction</label>
                                            <select value={deductionForm.type} onChange={e => setDeductionForm(prev => ({...prev, type: e.target.value}))}>
                                                <option value="plants">Plants Framboise</option>
                                                <option value="cropAdvance">Crop Advance (Prêt)</option>
                                                <option value="fruitAdvance">Fruit Advance</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Semaine de Liquidation</label>
                                            <input type="text" placeholder="Ex: S08" value={deductionForm.semaine} onChange={e => setDeductionForm(prev => ({...prev, semaine: e.target.value}))} />
                                        </div>
                                        <div className="form-group">
                                            <label>Montant (DH)</label>
                                            <input type="number" placeholder="0.00" value={deductionForm.montant} onChange={e => setDeductionForm(prev => ({...prev, montant: e.target.value}))} />
                                        </div>
                                        <div className="form-actions">
                                            <button className="btn-secondary" onClick={() => setShowDeductionModal(false)}>Annuler</button>
                                            <button className="btn-primary" onClick={() => { setShowDeductionModal(false); setDeductionForm({type:'plants', semaine:'', montant:''}); }}>
                                                <i className="fa-solid fa-check"></i> Enregistrer
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Modal édition montant Crop Advance / Fruit Advance */}
                            {editingMontant && (
                                <div className="modal-overlay" onClick={() => setEditingMontant(null)}>
                                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:400}}>
                                        <h2><i className="fa-solid fa-pen"></i> {editingMontant === 'cropAdvance'
                                            ? "Montant Crop Advance (prêt — global ferme)"
                                            : `Montant Fruit Advance${selectedFruit ? ` — ${selectedFruit === 'myrtille' ? 'Myrtille' : 'Framboise'}` : ''}`}</h2>
                                        <p style={{fontSize:12, color:'var(--gray-500)', marginBottom:16}}>
                                            {editingMontant === 'cropAdvance'
                                                ? "Le Crop Advance est un prêt unique convenu avec Driscoll's pour l'ensemble de la ferme. Les prélèvements Framboise + Myrtille viennent décompter ce même montant."
                                                : "Saisissez le montant total convenu avec Driscoll's pour cette saison. Cette valeur sera utilisée pour calculer le reste à déduire et l'avancement."}
                                        </p>
                                        {(editingMontant === 'cropAdvance' || selectedFruit) ? (
                                            <>
                                                <div className="form-group">
                                                    <label>Montant total (DH)</label>
                                                    <input type="number" placeholder="Ex: 1200000" value={editMontantValue}
                                                        onChange={e => setEditMontantValue(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveDeductionMontant(editingMontant, parseFloat(editMontantValue) || 0); }}
                                                        autoFocus style={{fontSize:16, fontWeight:700}} />
                                                </div>
                                                <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:16}}>
                                                    Valeur actuelle : <strong>{(editingMontant === 'cropAdvance'
                                                        ? (deductionMontants.cropAdvance || 0)
                                                        : (getMontantsForCulture(selectedFruit).fruitAdvance || 0)
                                                    ).toLocaleString('fr-FR')} DH</strong>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="form-group">
                                                    <label>Framboise (DH)</label>
                                                    <input type="number" placeholder="Ex: 1200000" value={editMontantPerCulture.framboise}
                                                        onChange={e => setEditMontantPerCulture(v => ({ ...v, framboise: e.target.value }))}
                                                        autoFocus style={{fontSize:16, fontWeight:700}} />
                                                </div>
                                                <div className="form-group">
                                                    <label>Myrtille (DH)</label>
                                                    <input type="number" placeholder="Ex: 1200000" value={editMontantPerCulture.myrtille}
                                                        onChange={e => setEditMontantPerCulture(v => ({ ...v, myrtille: e.target.value }))}
                                                        onKeyDown={e => { if (e.key === 'Enter') saveDeductionMontant(editingMontant, editMontantPerCulture); }}
                                                        style={{fontSize:16, fontWeight:700}} />
                                                </div>
                                                <div style={{fontSize:11, color:'var(--gray-400)', marginBottom:16}}>
                                                    Valeurs actuelles : Framboise <strong>{((deductionMontants.fruitAdvance || {}).framboise || 0).toLocaleString('fr-FR')} DH</strong> · Myrtille <strong>{((deductionMontants.fruitAdvance || {}).myrtille || 0).toLocaleString('fr-FR')} DH</strong>
                                                </div>
                                            </>
                                        )}
                                        <div className="form-actions">
                                            <button className="btn-secondary" onClick={() => setEditingMontant(null)}>Annuler</button>
                                            <button className="btn-primary" onClick={() => saveDeductionMontant(editingMontant, (editingMontant === 'cropAdvance' || selectedFruit) ? (parseFloat(editMontantValue) || 0) : editMontantPerCulture)}>
                                                <i className="fa-solid fa-check"></i> Enregistrer
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {subTab === 'planning' && (
                        <div>
                            <Panel title="Planning Prélèvements vs Réel" icon="fa-calendar-check">
                                <p style={{fontSize:'12px', color:'var(--gray-400)', marginBottom:'12px'}}>
                                    <i className="fa-solid fa-info-circle"></i> Comparaison entre les prélèvements planifiés et les prélèvements réels sur chaque liquidation.
                                </p>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Plan Plants (DH)</th>
                                            <th>Plan Prêt (DH)</th>
                                            <th>Réel Plants</th>
                                            <th>Réel Prêt</th>
                                            <th>Écart Plants</th>
                                            <th>Écart Prêt</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {liq.planning.map((p, i) => {
                                            const ecartPlants = p.reelPlants !== null ? p.reelPlants - p.planPlants : null;
                                            const ecartPret = p.reelPret !== null ? p.reelPret - p.planPret : null;
                                            return (
                                                <tr key={i}>
                                                    <td><strong>{p.semaine}</strong></td>
                                                    <td>{Math.round(p.planPlants).toLocaleString('fr-FR')}</td>
                                                    <td>{Math.round(p.planPret).toLocaleString('fr-FR')}</td>
                                                    <td>{p.reelPlants !== null ? Math.round(p.reelPlants).toLocaleString('fr-FR') : <span style={{color:'var(--gray-400)'}}>En attente</span>}</td>
                                                    <td>{p.reelPret !== null ? Math.round(p.reelPret).toLocaleString('fr-FR') : <span style={{color:'var(--gray-400)'}}>En attente</span>}</td>
                                                    <td style={{color: ecartPlants !== null ? (ecartPlants >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--gray-400)'}}>
                                                        {ecartPlants !== null ? `${ecartPlants >= 0 ? '+' : ''}${Math.round(ecartPlants).toLocaleString('fr-FR')}` : '-'}
                                                    </td>
                                                    <td style={{color: ecartPret !== null ? (ecartPret >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--gray-400)'}}>
                                                        {ecartPret !== null ? `${ecartPret >= 0 ? '+' : ''}${Math.round(ecartPret).toLocaleString('fr-FR')}` : '-'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </Panel>

                            {/* Projection de remboursement */}
                            <Panel title="Projection de Remboursement" icon="fa-chart-bar">
                                <SimpleBarChart
                                    data={liq.planning.map(p => ({ semaine: p.semaine, plants: Math.round(p.planPlants/1000), pret: Math.round(p.planPret/1000) }))}
                                    dataKeys={['plants', 'pret']}
                                    colors={['#2D8B4E', '#3498DB']}
                                    xKey="semaine"
                                    height={250}
                                />
                                <div style={{display:'flex', gap:'20px', justifyContent:'center', marginTop:'8px', fontSize:'12px'}}>
                                    <span><span style={{display:'inline-block', width:'12px', height:'12px', borderRadius:'2px', background:'#2D8B4E', marginRight:'4px'}}></span> Plants (K DH)</span>
                                    <span><span style={{display:'inline-block', width:'12px', height:'12px', borderRadius:'2px', background:'#3498DB', marginRight:'4px'}}></span> Prêt (K DH)</span>
                                </div>
                            </Panel>
                        </div>
                    )}

                    {/* ===== LIQUIDATION REPORT POPUP (Driscoll's style) ===== */}
                    {selectedLiquidation && (() => {
                        const l = selectedLiquidation;
                        const semaineNum = l.semaine.replace('S','').split('-')[0];
                        const annee = l.semaine.split('-')[1];
                        const totalDeductions = l.prelevPlants + l.prelevPret + (l.fruitAdvance || 0);
                        const nbColis = Math.round(l.qteKg / 1.5);
                        return (
                            <div className="modal-overlay" onClick={() => setSelectedLiquidation(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'750px', maxHeight:'90vh', overflowY:'auto', padding:0}}>
                                    {/* Header Driscoll's */}
                                    <div style={{background:'linear-gradient(135deg, #1a5e1a 0%, #2d8b4e 100%)', padding:'20px 24px', color:'white'}}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <div>
                                                <div style={{fontSize:10, textTransform:'uppercase', letterSpacing:2, opacity:0.7}}>Driscoll's Du Maroc SARL</div>
                                                <div style={{fontSize:20, fontWeight:700, marginTop:4}}>Rapport de Liquidation</div>
                                                <div style={{fontSize:12, opacity:0.8, marginTop:2}}>Semaine {semaineNum} - {annee}</div>
                                            </div>
                                            <div style={{textAlign:'right'}}>
                                                <div style={{fontSize:28, fontWeight:800, fontFamily:'Georgia, serif'}}>LIQUIDATION</div>
                                                <div style={{fontSize:11, opacity:0.8}}>Driscoll's - Only the Finest Berries</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{padding:'20px 24px'}}>
                                        {/* Info Grid */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20}}>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Producteur</div>
                                                <div style={{fontSize:13, fontWeight:600}}>Berry Good Farms SARL</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>Ranch 200876 / 200742</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>IF: 2610702 | ICE: 002106859000069</div>
                                            </div>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Période de Liquidation</div>
                                                <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'3px 12px', fontSize:12}}>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Semaine</span><span style={{fontWeight:600}}>{l.semaine}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Encaissement</span><span>{l.dateEncaissement}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Statut</span><span style={{color:'var(--green)', fontWeight:600}}>{l.status}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Production Summary */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-boxes-stacked" style={{marginRight:6}}></i>Résumé Production
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr>
                                                    <th>Produit</th>
                                                    <th style={{textAlign:'right'}}>Colis</th>
                                                    <th style={{textAlign:'right'}}>Poids Net (Kg)</th>
                                                    <th style={{textAlign:'right'}}>Prix Moyen (DH/Kg)</th>
                                                    <th style={{textAlign:'right'}}>Montant Brut (DH)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td><strong>Framboises - Toutes variétés</strong></td>
                                                    <td style={{textAlign:'right'}}>{nbColis.toLocaleString('fr-FR')}</td>
                                                    <td style={{textAlign:'right', fontWeight:600}}>{l.qteKg.toLocaleString('fr-FR')}</td>
                                                    <td style={{textAlign:'right', fontWeight:600}}>{l.prixMoyen.toFixed(2)}</td>
                                                    <td style={{textAlign:'right', fontWeight:700, color:'var(--berry)'}}>{Math.round(l.montantBrut).toLocaleString('fr-FR')}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Déductions */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-scissors" style={{marginRight:6}}></i>Déductions
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr><th>Type de Déduction</th><th style={{textAlign:'right'}}>Montant (DH)</th></tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>Prélèvement Plants Framboise</td>
                                                    <td style={{textAlign:'right', color: l.prelevPlants > 0 ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>
                                                        {l.prelevPlants > 0 ? `-${Math.round(l.prelevPlants).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td>Prélèvement Crop Advance (Prêt)</td>
                                                    <td style={{textAlign:'right', color: l.prelevPret > 0 ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>
                                                        {l.prelevPret > 0 ? `-${Math.round(l.prelevPret).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td>Prélèvement Fruit Advance</td>
                                                    <td style={{textAlign:'right', color: (l.fruitAdvance || 0) > 0 ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>
                                                        {(l.fruitAdvance || 0) > 0 ? `-${Math.round(l.fruitAdvance).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                                <tr style={{background:'rgba(231,76,60,0.05)'}}>
                                                    <td style={{fontWeight:700}}>Total Déductions</td>
                                                    <td style={{textAlign:'right', fontWeight:700, color:'var(--red)'}}>
                                                        {totalDeductions > 0 ? `-${Math.round(totalDeductions).toLocaleString('fr-FR')}` : '0'}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Net Payable */}
                                        <div style={{padding:16, background:'linear-gradient(135deg, #2D8B4E10 0%, #2D8B4E20 100%)', borderRadius:10, border:'2px solid var(--green)', marginBottom:16}}>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                <div>
                                                    <div style={{fontSize:11, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase'}}>Montant Net Payable</div>
                                                    <div style={{fontSize:11, color:'var(--gray-400)'}}>Montant brut - Déductions</div>
                                                </div>
                                                <div style={{fontSize:28, fontWeight:800, color:'var(--green)'}}>{Math.round(l.montantNet).toLocaleString('fr-FR')} DH</div>
                                            </div>
                                        </div>

                                        {/* Récapitulatif */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:16}}>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Prix Moyen</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--berry)'}}>{l.prixMoyen.toFixed(2)}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / Kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Tonnage</div>
                                                <div style={{fontSize:16, fontWeight:700}}>{l.qteKg.toLocaleString('fr-FR')}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>Kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>% Retenu</div>
                                                <div style={{fontSize:16, fontWeight:700, color: totalDeductions > 0 ? 'var(--red)' : 'var(--green)'}}>
                                                    {l.montantBrut > 0 ? (totalDeductions/l.montantBrut*100).toFixed(1) : '0'}%
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>déductions</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Net / Kg</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--green)'}}>
                                                    {l.qteKg > 0 ? (l.montantNet/l.qteKg).toFixed(2) : '0'}
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / Kg</div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div style={{fontSize:10, color:'var(--gray-400)', borderTop:'1px solid var(--gray-200)', paddingTop:10, marginBottom:12}}>
                                            <div>Document généré automatiquement | Berry Good Farms SARL</div>
                                            <div>R.C. 24587 | T.P. 22211020 | IF 04960175 | CNSS 2258053 | ICE 002106859000069</div>
                                        </div>

                                        <button onClick={() => setSelectedLiquidation(null)} style={{width:'100%', padding:'10px', background:'var(--berry)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer'}}>
                                            <i className="fa-solid fa-xmark" style={{marginRight:6}}></i> Fermer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

export { FinLiquidationsTab };
