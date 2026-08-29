/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: qualite | Déclaration(s): QualitePFQInterneTab */
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';

// ===================== PFQ INTERNE TAB =====================
        function QualitePFQInterneTab({ data, userProfile }) {
            // Charger la config PFQ depuis localStorage (définie dans Paramètres)
            // Config par défaut — calquée sur le fichier Excel Driscoll's
            // Chaque défaut a sa propre pénalité (multiplier appliqué à la fraction %)
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
            const pfqConfig = useMemo(() => {
                try {
                    const saved = localStorage.getItem('pfqPenaltyConfig');
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        // Merge: garder les nouvelles clés/défauts par défaut si absent du saved
                        return {
                            ...defaultPFQConfig,
                            ...parsed,
                            defautsCondition: parsed.defautsCondition || defaultPFQConfig.defautsCondition,
                            defautsApparence: parsed.defautsApparence || defaultPFQConfig.defautsApparence,
                        };
                    }
                } catch (e) { console.error('Error reading pfqPenaltyConfig:', e); }
                return defaultPFQConfig;
            }, []);

            const DEFAUTS_CONDITION = pfqConfig.defautsCondition.filter(d => d.enabled !== false);
            const DEFAUTS_APPARENCE = pfqConfig.defautsApparence.filter(d => d.enabled !== false);
            const CONDITION_MAX = pfqConfig.conditionMax;
            const APPARENCE_MAX = pfqConfig.apparenceMax;
            const CONDITION_MIN = pfqConfig.conditionMin != null ? pfqConfig.conditionMin : 60;
            const APPARENCE_MIN = pfqConfig.apparenceMin != null ? pfqConfig.apparenceMin : 10;

            const blocIds = data.blocIds || [];

            const emptyBarquette = () => ({
                poids: '',
                poidsEmballage: '',
                nbFruits: '',
                defauts: Object.fromEntries([...DEFAUTS_CONDITION, ...DEFAUTS_APPARENCE].map(d => [d.key, 0])),
            });

            // Calcul du nombre de barquettes selon le poids du lot
            // Basé sur analyse de 358 expéditions Driscoll's (moy. 0.81% inspecté)
            // On applique un taux interne plus élevé (~3-5%) pour un meilleur contrôle
            const POIDS_BARQUETTE_G = 150; // poids moyen d'une barquette en grammes
            const getNbBarquettesRecommande = (poidsLotKg) => {
                if (!poidsLotKg || poidsLotKg <= 0) return 3;
                if (poidsLotKg <= 20) return 3;
                if (poidsLotKg <= 50) return 5;
                if (poidsLotKg <= 100) return 7;
                if (poidsLotKg <= 200) return 10;
                return 12;
            };

            const getTauxInspection = (poidsLotKg, nbBarq) => {
                if (!poidsLotKg || poidsLotKg <= 0) return null;
                return (nbBarq * POIDS_BARQUETTE_G / 1000) / poidsLotKg * 100;
            };

            // Restaurer saisie en cours depuis sessionStorage
            const PFQ_DRAFT_KEY = 'pfq_interne_draft';
            const getSavedDraft = () => {
                try { const s = sessionStorage.getItem(PFQ_DRAFT_KEY); if (s) return JSON.parse(s); } catch(e) {}
                return null;
            };
            const draft = getSavedDraft();

            const userName = userProfile?.displayName || userProfile?.email || '';
            const [formData, setFormData] = useState(draft?.formData || {
                date: new Date().toISOString().split('T')[0],
                bloc: '',
                bonApport: '',
                confection: '',
                controleur: userName,
                poidsLot: '',
            });
            // Auto-fill controleur if empty when userProfile loads
            useEffect(() => {
                if (!formData.controleur && userName) {
                    setFormData(p => ({ ...p, controleur: userName }));
                }
            }, [userName]);

            // Signature state
            const [signed, setSigned] = useState(false);
            const [signatureTimestamp, setSignatureTimestamp] = useState(null);

            // Scan bon d'apport
            const [showScanPopup, setShowScanPopup] = useState(false);
            const [scanPhoto, setScanPhoto] = useState(null);
            const fileInputRef = React.useRef(null);

            const nbBarqRecommande = getNbBarquettesRecommande(parseFloat(formData.poidsLot));
            const [barquettes, setBarquettes] = useState(draft?.barquettes || [emptyBarquette(), emptyBarquette(), emptyBarquette()]);
            // Wizard step: 0 = infos bon d'apport, 1..N = barquettes, N+1 = résultat
            const [wizardStep, setWizardStep] = useState(draft?.wizardStep || 0);

            // Sauvegarde auto dans sessionStorage à chaque modification
            useEffect(() => {
                sessionStorage.setItem(PFQ_DRAFT_KEY, JSON.stringify({ formData, barquettes, wizardStep }));
            }, [formData, barquettes, wizardStep]);

            // Ajuster le nombre de barquettes quand le poids du lot change
            const handlePoidsLotChange = (value) => {
                setFormData(p => ({ ...p, poidsLot: value }));
                const poids = parseFloat(value);
                if (poids > 0) {
                    const nbRecommande = getNbBarquettesRecommande(poids);
                    setBarquettes(prev => {
                        if (prev.length === nbRecommande) return prev;
                        if (prev.length < nbRecommande) {
                            return [...prev, ...Array(nbRecommande - prev.length).fill(null).map(() => emptyBarquette())];
                        }
                        // Réduire seulement les barquettes vides à la fin
                        const trimmed = [...prev];
                        while (trimmed.length > nbRecommande && trimmed.length > 3) {
                            const last = trimmed[trimmed.length - 1];
                            if (!last.poids && !last.nbFruits) trimmed.pop();
                            else break;
                        }
                        return trimmed;
                    });
                }
            };
            const [historique, setHistorique] = useState([]);
            const [saving, setSaving] = useState(false);
            const [showBonApport, setShowBonApport] = useState(false);
            const [savedPFQ, setSavedPFQ] = useState(null);
            const totalSteps = barquettes.length + 2;

            // Confection types: chargées depuis localStorage (configurable dans Paramètres) + expéditions Driscoll's
            const defaultConfections = ['RASP Conv Drisc 12x125', 'RASP Conv Drisc 6x170', 'RASP Conv Drisc 12x170'];
            const [confectionTypes, setConfectionTypes] = useState(() => {
                try {
                    const saved = localStorage.getItem('confectionTypes');
                    if (saved) { const parsed = JSON.parse(saved); if (parsed.length > 0) return parsed; }
                } catch(e) {}
                return defaultConfections;
            });

            // Load historique + confection types from expeditions
            useEffect(() => {
                // Charger confections depuis expéditions Driscoll's
                const loadConfections = async () => {
                    try {
                        const json = await cachedFetch('/api/email-analysis?action=expeditions&limit=2000');
                        if (json.success && json.expeditions) {
                            const items = new Set();
                            json.expeditions.forEach(e => {
                                if (e.itemDescription) items.add(e.itemDescription.trim());
                            });
                            const fromApi = Array.from(items).sort();
                            // Merge avec config sauvegardée
                            const saved = (() => { try { const s = localStorage.getItem('confectionTypes'); return s ? JSON.parse(s) : []; } catch(e) { return []; } })();
                            const merged = Array.from(new Set([...saved, ...fromApi])).sort();
                            setConfectionTypes(merged);
                            localStorage.setItem('confectionTypes', JSON.stringify(merged));
                        }
                    } catch(e) { console.error('Error loading confection types:', e); }
                };
                loadConfections();
            }, []);

            useEffect(() => {
                const loadHistorique = async () => {
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const snap = await db.collection('pfq_interne')
                                .orderBy('createdAt', 'desc').limit(20).get();
                            const firestoreData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                            const localData = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                            setHistorique([...localData, ...firestoreData].slice(0, 20));
                        } else {
                            const localData = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                            setHistorique(localData);
                        }
                    } catch (e) {
                        console.error('Error loading PFQ historique:', e);
                        const localData = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                        setHistorique(localData);
                    }
                };
                loadHistorique();
            }, []);

            const updateBarquette = (idx, field, value) => {
                setBarquettes(prev => {
                    const updated = [...prev];
                    updated[idx] = { ...updated[idx], [field]: value };
                    return updated;
                });
            };

            const updateDefaut = (idx, key, value) => {
                setBarquettes(prev => {
                    const updated = [...prev];
                    updated[idx] = {
                        ...updated[idx],
                        defauts: { ...updated[idx].defauts, [key]: Math.max(0, parseInt(value) || 0) }
                    };
                    return updated;
                });
            };

            // Calcul du calibre: (poids avec emballage - poids emballage) / nb_fruits
            const getCalibre = (b) => {
                const p = parseFloat(b.poids);
                const n = parseInt(b.nbFruits);
                if (!p || !n) return null;
                const tare = parseFloat(b.poidsEmballage);
                const tareValue = isNaN(tare) ? 7 : tare;
                return Math.round(((p - tareValue) / n) * 100) / 100;
            };

            // Calcul PFQ GLOBAL — méthode Excel Driscoll's:
            // Chaque défaut a sa propre pénalité (penalty). fraction = count / totalFruits.
            // PFQ Etat = ((100 - Σ(fraction_i × penalty_i)) / 100) × CONDITION_MAX
            const getPFQGlobal = () => {
                const valid = barquettes.filter(b => parseInt(b.nbFruits) > 0);
                if (valid.length === 0) return { etat: null, apparence: null, final: null, condDetail: [], appDetail: [], totalFruits: 0 };

                const totalFruits = valid.reduce((s, b) => s + parseInt(b.nbFruits), 0);

                // Condition: pénalité individuelle par défaut
                const condDetail = DEFAUTS_CONDITION.map(d => {
                    const count = valid.reduce((s, b) => s + (b.defauts[d.key] || 0), 0);
                    const pct = totalFruits > 0 ? count / totalFruits * 100 : 0;
                    const fraction = totalFruits > 0 ? count / totalFruits : 0;
                    const pen = d.penalty || 700;
                    return { ...d, count, pct, points: Math.round(fraction * pen * 100) / 100, penalty: pen };
                });
                const totalCondPenalty = condDetail.reduce((s, d) => s + d.points, 0);
                const condTotalCount = condDetail.reduce((s, d) => s + d.count, 0);
                const condTotalPct = totalFruits > 0 ? condTotalCount / totalFruits * 100 : 0;

                // Apparence: pénalité individuelle par défaut
                const appDetail = DEFAUTS_APPARENCE.map(d => {
                    const count = valid.reduce((s, b) => s + (b.defauts[d.key] || 0), 0);
                    const pct = totalFruits > 0 ? count / totalFruits * 100 : 0;
                    const fraction = totalFruits > 0 ? count / totalFruits : 0;
                    const pen = d.penalty || 400;
                    return { ...d, count, pct, points: Math.round(fraction * pen * 100) / 100, penalty: pen };
                });
                const totalAppPenalty = appDetail.reduce((s, d) => s + d.points, 0);
                const appTotalCount = appDetail.reduce((s, d) => s + d.count, 0);
                const appTotalPct = totalFruits > 0 ? appTotalCount / totalFruits * 100 : 0;

                const pfqEtat = Math.max(0, (100 - totalCondPenalty) / 100 * CONDITION_MAX);
                const pfqApparence = Math.max(0, (100 - totalAppPenalty) / 100 * APPARENCE_MAX);
                const pfqFinal = Math.round((pfqEtat + pfqApparence) * 100) / 100;

                const rejetCondition = pfqEtat < CONDITION_MIN;
                const rejetApparence = pfqApparence < APPARENCE_MIN;
                const rejet = rejetCondition || rejetApparence;

                return {
                    etat: Math.round(pfqEtat * 100) / 100,
                    apparence: Math.round(pfqApparence * 100) / 100,
                    final: pfqFinal,
                    condDetail, appDetail, totalFruits,
                    condTotalCount, condTotalPct: Math.round(condTotalPct * 100) / 100,
                    appTotalCount, appTotalPct: Math.round(appTotalPct * 100) / 100,
                    rejet, rejetCondition, rejetApparence,
                };
            };

            const pfqGlobal = getPFQGlobal();

            const handleSave = async () => {
                if (!formData.bloc) { alert('Veuillez sélectionner le Bloc / Parcelle'); return; }
                if (!formData.bonApport) { alert('Veuillez saisir le N° Bon d\'Apport (champ obligatoire)'); return; }
                const valid = barquettes.filter(b => parseInt(b.nbFruits) > 0);
                if (valid.length === 0) { alert('Veuillez saisir au moins une barquette'); return; }

                setSaving(true);
                try {
                    const selectedBloc = blocIds.find(b => b.id === formData.bloc);
                    const record = {
                        ...formData,
                        blocLabel: selectedBloc ? selectedBloc.label : formData.bloc,
                        blocVariete: selectedBloc ? selectedBloc.variete : '',
                        blocFerme: selectedBloc ? selectedBloc.ferme : '',
                        poidsLot: parseFloat(formData.poidsLot) || 0,
                        nbBarquettesRecommande: nbBarqRecommande,
                        tauxInspection: getTauxInspection(parseFloat(formData.poidsLot), valid.length),
                        barquettes: barquettes.map((b, i) => ({
                            numero: i + 1,
                            poids: parseFloat(b.poids) || 0,
                            poidsEmballage: parseFloat(b.poidsEmballage) || 0,
                            nbFruits: parseInt(b.nbFruits) || 0,
                            calibre: getCalibre(b),
                            defauts: b.defauts,
                        })),
                        pfqGlobal: { etat: pfqGlobal.etat, apparence: pfqGlobal.apparence, final: pfqGlobal.final, rejet: pfqGlobal.rejet, rejetCondition: pfqGlobal.rejetCondition, rejetApparence: pfqGlobal.rejetApparence },
                        condDetail: pfqGlobal.condDetail,
                        appDetail: pfqGlobal.appDetail,
                        totalFruits: pfqGlobal.totalFruits,
                        createdAt: new Date().toISOString(),
                        createdBy: (firebaseAuth && firebaseAuth.currentUser) ? firebaseAuth.currentUser.email : 'unknown',
                    };

                    let docId = 'local_' + Date.now();
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const docRef = await db.collection('pfq_interne').add(record);
                            docId = docRef.id;
                        }
                    } catch (firestoreErr) {
                        console.warn('Firestore save failed, saving locally:', firestoreErr);
                        const localPFQs = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                        localPFQs.unshift({ id: docId, ...record });
                        localStorage.setItem('pfq_interne_local', JSON.stringify(localPFQs));
                    }
                    setSavedPFQ({ id: docId, ...record });
                    setHistorique(prev => [{ id: docId, ...record, createdAt: new Date() }, ...prev]);
                    setShowBonApport(true);
                    sessionStorage.removeItem(PFQ_DRAFT_KEY);
                } catch (e) {
                    console.error('Error saving PFQ:', e);
                    alert('Erreur lors de la sauvegarde: ' + e.message);
                } finally {
                    setSaving(false);
                }
            };

            const handleReset = () => {
                sessionStorage.removeItem(PFQ_DRAFT_KEY);
                setBarquettes([emptyBarquette(), emptyBarquette(), emptyBarquette()]);
                setFormData(prev => ({ ...prev, bloc: '', bonApport: '', confection: '', poidsLot: '' }));
                setShowBonApport(false);
                setSavedPFQ(null);
                setSigned(false);
                setSignatureTimestamp(null);
                setScanPhoto(null);
                setWizardStep(0);
            };

            const getPFQColor = (val) => {
                if (val == null) return 'var(--gray-400)';
                if (val >= 80) return 'var(--green)';
                if (val >= 60) return 'var(--orange)';
                return 'var(--red)';
            };

            const inputStyle = { width:'100%', padding:'8px 10px', border:'1.5px solid var(--gray-200)', borderRadius:8, fontSize:13, outline:'none', transition:'border 0.2s' };
            const defautInputStyle = { width:50, padding:'4px 6px', border:'1.5px solid var(--gray-200)', borderRadius:6, fontSize:12, textAlign:'center', outline:'none' };
            const labelStyle = { fontSize:11, fontWeight:600, color:'var(--gray-600)', marginBottom:4, display:'block' };
            const sectionHeaderStyle = { fontSize:13, fontWeight:700, color:'var(--berry)', marginBottom:10, paddingBottom:6, borderBottom:'2px solid var(--berry-pale)', display:'flex', alignItems:'center', gap:8 };

            // Bon d'Apport modal — format Driscoll's
            if (showBonApport && savedPFQ) {
                const selectedBloc = blocIds.find(b => b.id === savedPFQ.bloc);
                const blocLabel = savedPFQ.blocLabel || (selectedBloc ? selectedBloc.label : savedPFQ.bloc);
                const blocVariete = savedPFQ.blocVariete || (selectedBloc ? selectedBloc.variete : '');
                const blocFerme = savedPFQ.blocFerme || (selectedBloc ? selectedBloc.ferme : '');
                const validBarq = (savedPFQ.barquettes || []).filter(b => b.nbFruits > 0);
                const totalFruits = savedPFQ.totalFruits || validBarq.reduce((s, b) => s + (b.nbFruits || 0), 0);
                const avgFruitsPerPunnet = validBarq.length > 0 ? Math.round(totalFruits / validBarq.length * 10) / 10 : 0;
                const avgPunnetWeight = validBarq.length > 0 ? Math.round(validBarq.reduce((s, b) => s + (b.poids || 0), 0) / validBarq.length * 10) / 10 : 0;

                // Rebuild detail from saved data or compute
                const sCondDetail = savedPFQ.condDetail || DEFAUTS_CONDITION.map(d => {
                    const count = validBarq.reduce((s, b) => s + ((b.defauts || b.defautsCondition || {})[d.key] || 0), 0);
                    const pct = totalFruits > 0 ? count / totalFruits * 100 : 0;
                    const fraction = totalFruits > 0 ? count / totalFruits : 0;
                    return { ...d, count, pct, points: Math.round(fraction * (d.penalty || 700) * 100) / 100 };
                });
                const sAppDetail = savedPFQ.appDetail || DEFAUTS_APPARENCE.map(d => {
                    const count = validBarq.reduce((s, b) => s + ((b.defauts || b.defautsApparence || {})[d.key] || 0), 0);
                    const pct = totalFruits > 0 ? count / totalFruits * 100 : 0;
                    const fraction = totalFruits > 0 ? count / totalFruits : 0;
                    return { ...d, count, pct, points: Math.round(fraction * (d.penalty || 400) * 100) / 100 };
                });
                const condTotalCount = sCondDetail.reduce((s, d) => s + (d.count || 0), 0);
                const condTotalPct = totalFruits > 0 ? condTotalCount / totalFruits * 100 : 0;
                const appTotalCount = sAppDetail.reduce((s, d) => s + (d.count || 0), 0);
                const appTotalPct = totalFruits > 0 ? appTotalCount / totalFruits * 100 : 0;
                const condPoints = savedPFQ.pfqGlobal?.etat != null ? Math.round((70 - savedPFQ.pfqGlobal.etat) / 70 * 100) : 0;
                const appPoints = savedPFQ.pfqGlobal?.apparence != null ? Math.round((20 - savedPFQ.pfqGlobal.apparence) / 20 * 100) : 0;

                const handlePrint = () => {
                    const controleurName = savedPFQ.controleur || '-';
                    const signedText = signed ? `<div style="display:flex;flex-direction:column;align-items:flex-end"><div style="font-family:'Dancing Script',cursive;font-size:28px;color:#8B2252;font-weight:700">${controleurName}</div><div style="font-size:9px;color:#999;margin-top:2px">Signé le ${signatureTimestamp || new Date().toLocaleString('fr-FR')}</div></div>` : 'Signature: _______________';
                    const rejetHtml = savedPFQ.pfqGlobal?.rejet ? `<div style="padding:10px 14px;background:rgba(231,76,60,0.1);border:2px solid #e74c3c;border-radius:10px;margin-bottom:12px;display:flex;align-items:center;gap:10px"><span style="font-size:18px;color:#e74c3c">⚠</span><div><div style="font-weight:700;color:#e74c3c;font-size:13px">LOT REJETÉ</div><div style="font-size:10px;color:#666">${savedPFQ.pfqGlobal?.rejetCondition ? 'Condition < ' + CONDITION_MIN + '. ' : ''}${savedPFQ.pfqGlobal?.rejetApparence ? 'Apparence < ' + APPARENCE_MIN + '.' : ''}</div></div></div>` : '';
                    const w = window.open('', '_blank', 'width=900,height=700');
                    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>PFQ Interne — Bon ${savedPFQ.bonApport}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Dancing+Script:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;padding:30px;color:#333;font-size:12px}
h2{text-align:center;color:#8B2252;font-size:20px;margin-bottom:4px}
.subtitle{text-align:center;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:2px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #ddd;border-radius:8px;overflow:hidden;margin-bottom:20px;font-size:12px}
.grid-inner{display:grid;grid-template-columns:auto 1fr}
.gl{padding:8px 14px;background:#f9f9f9;font-weight:600;color:#666;border-bottom:1px solid #eee;border-right:1px solid #eee}
.gv{padding:8px 14px;font-weight:700;border-bottom:1px solid #eee}
table{width:100%;border-collapse:collapse;margin-bottom:20px}th{text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;font-size:11px;color:#888;text-transform:uppercase}
td{padding:5px 10px;border-bottom:1px solid #f0f0f0}
.total-row{font-weight:700;background:#f9f9f9}
.scores{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px}
.score-box{text-align:center;padding:16px;border-radius:12px}
.score-label{font-size:11px;color:#666;margin-bottom:4px;font-weight:600}
.score-val{font-size:28px;font-weight:800}
.score-max{font-size:11px;color:#999}
.footer{padding:14px;background:#f5f5f5;border-radius:12px;display:flex;justify-content:space-between;align-items:center;margin-top:20px}
.green{color:#2D8B4E}.orange{color:#D4A847}.red{color:#e74c3c}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{margin:15mm}}
</style></head><body>
<div class="subtitle">PFQ Interne — Berry Good Farms</div>
<h2>Rapport d'Inspection Qualité</h2>
<div style="height:20px"></div>
<div class="grid">
<div class="grid-inner"><div class="gl">Berry</div><div class="gv">RASPBERRY</div><div class="gl">Variété</div><div class="gv">${blocVariete || '-'}</div><div class="gl">Bloc</div><div class="gv">${blocLabel}</div><div class="gl">Ferme</div><div class="gv">${blocFerme || '-'}</div></div>
<div class="grid-inner" style="border-left:1px solid #ddd"><div class="gl">N° Bon d'Apport</div><div class="gv">${savedPFQ.bonApport}</div><div class="gl">Confection</div><div class="gv">${savedPFQ.confection || '-'}</div><div class="gl">Date</div><div class="gv">${savedPFQ.date}</div><div class="gl">Contrôleur</div><div class="gv">${controleurName}</div></div>
</div>
<table><thead><tr><th>Attribut / Défaut</th><th style="text-align:right"># Fruits</th><th style="text-align:right">%</th></tr></thead><tbody>
${sCondDetail.map(d => `<tr><td>${d.label}</td><td style="text-align:right">${d.count}</td><td style="text-align:right">${d.pct.toFixed(1)}%</td></tr>`).join('')}
<tr class="total-row"><td>Condition</td><td style="text-align:right">${condTotalCount}</td><td style="text-align:right">${condTotalPct.toFixed(1)}%</td></tr>
${sAppDetail.map(d => `<tr><td>${d.label}</td><td style="text-align:right">${d.count}</td><td style="text-align:right">${d.pct.toFixed(1)}%</td></tr>`).join('')}
<tr class="total-row"><td>Apparence</td><td style="text-align:right">${appTotalCount}</td><td style="text-align:right">${appTotalPct.toFixed(1)}%</td></tr>
</tbody></table>
<table><thead><tr><th style="text-align:center">Poids Lot (kg)</th><th style="text-align:center">Nb Barquettes</th><th style="text-align:center">Moy Fruits/Barq</th><th style="text-align:center">Moy Poids Barq (g)</th><th style="text-align:center">Total Fruits</th></tr></thead>
<tbody><tr style="text-align:center;font-weight:600"><td>${savedPFQ.poidsLot || '-'}</td><td>${validBarq.length}</td><td>${avgFruitsPerPunnet}</td><td>${avgPunnetWeight}</td><td>${totalFruits}</td></tr></tbody></table>
${rejetHtml}
<div class="scores">
<div class="score-box" style="background:rgba(139,34,82,0.08)"><div class="score-label">PFQ Condition</div><div class="score-val ${savedPFQ.pfqGlobal?.etat >= 60 ? 'green' : 'red'}">${savedPFQ.pfqGlobal?.etat?.toFixed(1) || '-'}</div><div class="score-max">/${CONDITION_MAX} (min ${CONDITION_MIN})</div></div>
<div class="score-box" style="background:rgba(52,152,219,0.08)"><div class="score-label">PFQ Apparence</div><div class="score-val ${savedPFQ.pfqGlobal?.apparence >= 10 ? 'green' : 'red'}">${savedPFQ.pfqGlobal?.apparence?.toFixed(1) || '-'}</div><div class="score-max">/${APPARENCE_MAX} (min ${APPARENCE_MIN})</div></div>
<div class="score-box" style="border:2px solid ${savedPFQ.pfqGlobal?.final >= 80 ? '#2D8B4E' : savedPFQ.pfqGlobal?.final >= 60 ? '#D4A847' : '#e74c3c'}"><div class="score-label">PFQ Final</div><div class="score-val" style="font-size:32px;color:${savedPFQ.pfqGlobal?.final >= 80 ? '#2D8B4E' : savedPFQ.pfqGlobal?.final >= 60 ? '#D4A847' : '#e74c3c'}">${savedPFQ.pfqGlobal?.final?.toFixed(1) || '-'}</div><div class="score-max">/${CONDITION_MAX + APPARENCE_MAX}</div>${savedPFQ.pfqGlobal?.rejet ? '<div style="font-size:10px;font-weight:700;color:#e74c3c;margin-top:4px">REJETÉ</div>' : ''}</div>
</div>
<div class="footer"><div style="color:#666">Contrôleur: <strong>${controleurName}</strong></div><div>${signedText}</div></div>
<div style="text-align:center;margin-top:20px;font-size:9px;color:#ccc">Berry Good Farms — Smart BERRY — Imprimé le ${new Date().toLocaleDateString('fr-FR')}</div>
</body></html>`);
                    w.document.close();
                    setTimeout(() => w.print(), 400);
                };

                return (
                    <div className="tab-content fade-in">
                        <Panel title="PFQ Interne — Rapport d'Inspection" icon="fa-file-invoice" actions={
                            <div style={{display:'flex',gap:8}}>
                                <button onClick={() => setShowBonApport(false)} style={{padding:'6px 14px',background:'var(--gray-100)',color:'var(--gray-700)',border:'1px solid var(--gray-300)',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                    <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i>Retour
                                </button>
                                <button onClick={handlePrint} style={{padding:'6px 14px',background:'var(--blue)',color:'#fff',border:'none',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                    <i className="fa-solid fa-print" style={{marginRight:6}}></i>Imprimer
                                </button>
                                <button onClick={handleReset} style={{padding:'6px 14px',background:'var(--green)',color:'#fff',border:'none',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                    <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau sondage
                                </button>
                            </div>
                        }>
                            <div style={{padding:20}}>
                                <div style={{textAlign:'center',marginBottom:20}}>
                                    <div style={{fontSize:10,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:2,marginBottom:4}}>PFQ Interne — Berry Good Farms</div>
                                    <h2 style={{margin:0,color:'var(--berry)',fontSize:20}}>Rapport d'Inspection Qualité</h2>
                                </div>

                                {/* Header Driscoll's style */}
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:0,marginBottom:20,border:'1px solid var(--gray-200)',borderRadius:10,overflow:'hidden',fontSize:12}}>
                                    <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:0}}>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Berry</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>RASPBERRY</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Variété</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{blocVariete || '-'}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Bloc</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{blocLabel}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderRight:'1px solid var(--gray-200)'}}>Ferme</div>
                                        <div style={{padding:'8px 14px',fontWeight:700}}>{blocFerme || '-'}</div>
                                    </div>
                                    <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:0,borderLeft:'1px solid var(--gray-200)'}}>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>N° Bon d'Apport</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{savedPFQ.bonApport}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Confection</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{savedPFQ.confection || '-'}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderBottom:'1px solid var(--gray-200)',borderRight:'1px solid var(--gray-200)'}}>Date</div>
                                        <div style={{padding:'8px 14px',fontWeight:700,borderBottom:'1px solid var(--gray-200)'}}>{savedPFQ.date}</div>
                                        <div style={{padding:'8px 14px',background:'var(--gray-50)',fontWeight:600,color:'var(--gray-500)',borderRight:'1px solid var(--gray-200)'}}>Contrôleur</div>
                                        <div style={{padding:'8px 14px',fontWeight:700}}>{savedPFQ.controleur || '-'}</div>
                                    </div>
                                </div>

                                {/* Tableau défauts — format Driscoll's */}
                                <table className="data-table" style={{fontSize:12,marginBottom:20}}>
                                    <thead>
                                        <tr><th>Attribut / Défaut</th><th style={{textAlign:'right'}}># de Fruits</th><th style={{textAlign:'right'}}>%</th><th style={{textAlign:'right'}}>Points</th></tr>
                                    </thead>
                                    <tbody>
                                        {sCondDetail.map((d, i) => (
                                            <tr key={i}><td>{d.label}</td><td style={{textAlign:'right'}}>{d.count}</td><td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td><td style={{textAlign:'right',color:'var(--gray-300)'}}></td></tr>
                                        ))}
                                        <tr style={{fontWeight:700,background:'var(--gray-50)'}}>
                                            <td>Condition</td>
                                            <td style={{textAlign:'right'}}>{condTotalCount}</td>
                                            <td style={{textAlign:'right'}}>{condTotalPct.toFixed(1)}%</td>
                                            <td style={{textAlign:'right',color:getPFQColor(savedPFQ.pfqGlobal?.etat)}}>{savedPFQ.pfqGlobal?.etat?.toFixed(0)}</td>
                                        </tr>
                                        {sAppDetail.map((d, i) => (
                                            <tr key={'a'+i}><td>{d.label}</td><td style={{textAlign:'right'}}>{d.count}</td><td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td><td style={{textAlign:'right',color:'var(--gray-300)'}}></td></tr>
                                        ))}
                                        <tr style={{fontWeight:700,background:'var(--gray-50)'}}>
                                            <td>Apparence</td>
                                            <td style={{textAlign:'right'}}>{appTotalCount}</td>
                                            <td style={{textAlign:'right'}}>{appTotalPct.toFixed(1)}%</td>
                                            <td style={{textAlign:'right',color:getPFQColor(savedPFQ.pfqGlobal?.apparence != null ? savedPFQ.pfqGlobal.apparence * 4.5 : null)}}>{savedPFQ.pfqGlobal?.apparence?.toFixed(0)}</td>
                                        </tr>
                                    </tbody>
                                </table>

                                {/* Résumé échantillonnage */}
                                <table className="data-table" style={{fontSize:12,marginBottom:20}}>
                                    <thead>
                                        <tr>
                                            <th style={{textAlign:'center'}}>Poids Lot (kg)</th>
                                            <th style={{textAlign:'center'}}>Nb Barquettes</th>
                                            <th style={{textAlign:'center'}}>Moy Fruits / Barq</th>
                                            <th style={{textAlign:'center'}}>Moy Poids Barq (g)</th>
                                            <th style={{textAlign:'center'}}>Total Fruits Inspectés</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr style={{textAlign:'center',fontWeight:600}}>
                                            <td>{savedPFQ.poidsLot || '-'}</td>
                                            <td>{validBarq.length}</td>
                                            <td>{avgFruitsPerPunnet}</td>
                                            <td>{avgPunnetWeight}</td>
                                            <td>{totalFruits}</td>
                                        </tr>
                                    </tbody>
                                </table>

                                {/* Score PFQ Final */}
                                {savedPFQ.pfqGlobal?.rejet && (
                                    <div style={{padding:'10px 14px',background:'rgba(231,76,60,0.1)',border:'2px solid var(--red)',borderRadius:10,marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
                                        <i className="fa-solid fa-triangle-exclamation" style={{fontSize:18,color:'var(--red)'}}></i>
                                        <div>
                                            <div style={{fontWeight:700,color:'var(--red)',fontSize:13}}>LOT REJETÉ</div>
                                            <div style={{fontSize:10,color:'var(--gray-600)'}}>
                                                {savedPFQ.pfqGlobal?.rejetCondition && <span>Condition &lt; {CONDITION_MIN}. </span>}
                                                {savedPFQ.pfqGlobal?.rejetApparence && <span>Apparence &lt; {APPARENCE_MIN}.</span>}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:20}}>
                                    <div style={{textAlign:'center',padding:16,background: savedPFQ.pfqGlobal?.rejetCondition ? 'rgba(231,76,60,0.08)' : 'var(--berry-pale)',borderRadius:12,border: savedPFQ.pfqGlobal?.rejetCondition ? '2px solid var(--red)' : 'none'}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Condition</div>
                                        <div style={{fontSize:28,fontWeight:800,color: savedPFQ.pfqGlobal?.rejetCondition ? 'var(--red)' : getPFQColor(savedPFQ.pfqGlobal?.etat)}}>{savedPFQ.pfqGlobal?.etat?.toFixed(1)}</div>
                                        <div style={{fontSize:11,color:'var(--gray-400)'}}>/{CONDITION_MAX} (min {CONDITION_MIN})</div>
                                    </div>
                                    <div style={{textAlign:'center',padding:16,background: savedPFQ.pfqGlobal?.rejetApparence ? 'rgba(231,76,60,0.08)' : 'var(--blue-pale)',borderRadius:12,border: savedPFQ.pfqGlobal?.rejetApparence ? '2px solid var(--red)' : 'none'}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Apparence</div>
                                        <div style={{fontSize:28,fontWeight:800,color: savedPFQ.pfqGlobal?.rejetApparence ? 'var(--red)' : getPFQColor(savedPFQ.pfqGlobal?.apparence != null ? savedPFQ.pfqGlobal.apparence * (CONDITION_MAX / APPARENCE_MAX) : null)}}>{savedPFQ.pfqGlobal?.apparence?.toFixed(1)}</div>
                                        <div style={{fontSize:11,color:'var(--gray-400)'}}>/{APPARENCE_MAX} (min {APPARENCE_MIN})</div>
                                    </div>
                                    <div style={{textAlign:'center',padding:16,background: savedPFQ.pfqGlobal?.rejet ? 'rgba(231,76,60,0.1)' : getPFQColor(savedPFQ.pfqGlobal?.final)+'15',borderRadius:12,border: savedPFQ.pfqGlobal?.rejet ? '2px solid var(--red)' : '2px solid '+getPFQColor(savedPFQ.pfqGlobal?.final)}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Final</div>
                                        <div style={{fontSize:32,fontWeight:800,color: savedPFQ.pfqGlobal?.rejet ? 'var(--red)' : getPFQColor(savedPFQ.pfqGlobal?.final)}}>{savedPFQ.pfqGlobal?.final?.toFixed(1)}</div>
                                        <div style={{fontSize:11,color:'var(--gray-400)'}}>/{CONDITION_MAX + APPARENCE_MAX}</div>
                                        {savedPFQ.pfqGlobal?.rejet && <div style={{fontSize:10,fontWeight:700,color:'var(--red)',marginTop:4}}>REJETÉ</div>}
                                    </div>
                                </div>

                                <div style={{padding:14,background:'var(--gray-100)',borderRadius:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div style={{fontSize:12,color:'var(--gray-500)'}}>
                                        Contrôleur: <strong>{savedPFQ.controleur || '-'}</strong>
                                    </div>
                                    <div style={{fontSize:12,color:'var(--gray-500)',display:'flex',alignItems:'center',gap:8}}>
                                        {signed ? (
                                            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
                                                <div style={{fontFamily:'\"Brush Script MT\", \"Segoe Script\", \"Dancing Script\", cursive',fontSize:24,color:'var(--berry)',fontWeight:700,lineHeight:1}}>
                                                    {savedPFQ.controleur || 'Contrôleur'}
                                                </div>
                                                <div style={{fontSize:9,color:'var(--gray-400)',marginTop:2}}>
                                                    Signé le {signatureTimestamp || new Date().toLocaleString('fr-FR')}
                                                </div>
                                            </div>
                                        ) : (
                                            <button onClick={() => { setSigned(true); setSignatureTimestamp(new Date().toLocaleString('fr-FR')); setShowScanPopup(true); }}
                                                style={{padding:'8px 20px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,fontSize:13,cursor:'pointer',fontWeight:600,display:'flex',alignItems:'center',gap:8}}>
                                                <i className="fa-solid fa-signature"></i> Signer
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Scan du bon d'apport physique */}
                                {scanPhoto && (
                                    <div style={{marginTop:16,padding:14,background:'var(--green-pale)',borderRadius:12,border:'1px solid var(--green)'}}>
                                        <div style={{fontSize:11,fontWeight:600,color:'var(--green)',marginBottom:8}}>
                                            <i className="fa-solid fa-camera" style={{marginRight:6}}></i>Scan du Bon d'Apport
                                        </div>
                                        <img src={scanPhoto} alt="Scan bon d'apport" style={{width:'100%',maxHeight:400,objectFit:'contain',borderRadius:8,border:'1px solid var(--gray-200)'}} />
                                    </div>
                                )}
                            </div>
                        </Panel>

                        {/* Popup de validation après signature */}
                        {showScanPopup && (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setShowScanPopup(false)}>
                                <div style={{background:'#fff',borderRadius:16,padding:24,maxWidth:420,width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                    <div style={{textAlign:'center',marginBottom:20}}>
                                        <div style={{width:56,height:56,borderRadius:'50%',background:'var(--green-pale)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px'}}>
                                            <i className="fa-solid fa-circle-check" style={{fontSize:28,color:'var(--green)'}}></i>
                                        </div>
                                        <h3 style={{margin:0,color:'var(--berry)',fontSize:18}}>Bon d'Apport Créé</h3>
                                        <p style={{margin:'8px 0 0',color:'var(--gray-500)',fontSize:13}}>
                                            N° <strong>{savedPFQ.bonApport}</strong> — PFQ Final: <strong style={{color:getPFQColor(savedPFQ.pfqGlobal?.final)}}>{savedPFQ.pfqGlobal?.final?.toFixed(1)}</strong>
                                            {savedPFQ.pfqGlobal?.rejet && <span style={{color:'var(--red)',fontWeight:700}}> (REJETÉ)</span>}
                                        </p>
                                    </div>

                                    <div style={{background:'var(--gray-50)',borderRadius:12,padding:16,marginBottom:16,textAlign:'center'}}>
                                        <div style={{fontSize:12,color:'var(--gray-600)',marginBottom:12}}>
                                            <i className="fa-solid fa-camera" style={{marginRight:6}}></i>
                                            Scanner le bon d'apport physique
                                        </div>
                                        <input type="file" accept="image/*" capture="environment" ref={fileInputRef}
                                            style={{display:'none'}}
                                            onChange={e => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = ev => {
                                                        setScanPhoto(ev.target.result);
                                                        // Save scan with PFQ record
                                                        const localPFQs = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                                                        const idx = localPFQs.findIndex(p => p.id === savedPFQ.id);
                                                        if (idx >= 0) { localPFQs[idx].scanPhoto = ev.target.result; }
                                                        else { localPFQs.unshift({ ...savedPFQ, scanPhoto: ev.target.result }); }
                                                        localStorage.setItem('pfq_interne_local', JSON.stringify(localPFQs));
                                                        setShowScanPopup(false);
                                                    };
                                                    reader.readAsDataURL(file);
                                                }
                                            }} />
                                        <button onClick={() => fileInputRef.current?.click()}
                                            style={{padding:'12px 24px',background:'var(--berry)',color:'#fff',border:'none',borderRadius:10,fontSize:14,cursor:'pointer',fontWeight:600,width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                                            <i className="fa-solid fa-camera"></i> Prendre une photo
                                        </button>
                                    </div>

                                    <button onClick={() => setShowScanPopup(false)}
                                        style={{padding:'10px 20px',background:'var(--gray-200)',color:'var(--gray-700)',border:'none',borderRadius:10,fontSize:13,cursor:'pointer',fontWeight:600,width:'100%'}}>
                                        Passer cette étape
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            }

            // Wizard navigation helpers
            const isStep0Valid = formData.bloc && formData.bonApport;
            const barqIdx = wizardStep - 1; // index de la barquette courante (step 1 = barquette 0)
            const isBarqStep = wizardStep >= 1 && wizardStep <= barquettes.length;
            const isFinalStep = wizardStep === barquettes.length + 1;
            const currentBarq = isBarqStep ? barquettes[barqIdx] : null;
            const isBarqValid = currentBarq ? (parseInt(currentBarq.nbFruits) > 0) : false;

            // Stepper bar component
            const renderStepper = () => (
                <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:20,padding:'0 4px',overflowX:'auto'}}>
                    {/* Step 0: Info */}
                    <div onClick={() => setWizardStep(0)} style={{cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',minWidth:48}}>
                        <div style={{width:32,height:32,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,
                            background: wizardStep === 0 ? 'var(--berry)' : (isStep0Valid ? 'var(--green)' : 'var(--gray-200)'),
                            color: wizardStep === 0 || isStep0Valid ? '#fff' : 'var(--gray-500)'}}>
                            {isStep0Valid && wizardStep !== 0 ? <i className="fa-solid fa-check" style={{fontSize:12}}></i> : <i className="fa-solid fa-file-lines" style={{fontSize:12}}></i>}
                        </div>
                        <div style={{fontSize:9,color: wizardStep === 0 ? 'var(--berry)' : 'var(--gray-500)',marginTop:3,fontWeight:600,whiteSpace:'nowrap'}}>Info</div>
                    </div>
                    {/* Barquette steps */}
                    {barquettes.map((b, i) => {
                        const stepNum = i + 1;
                        const filled = parseInt(b.nbFruits) > 0;
                        return (
                            <React.Fragment key={i}>
                                <div style={{flex:'0 0 20px',height:2,background: filled ? 'var(--green)' : 'var(--gray-200)'}}></div>
                                <div onClick={() => { if (isStep0Valid) setWizardStep(stepNum); }} style={{cursor: isStep0Valid ? 'pointer' : 'default',display:'flex',flexDirection:'column',alignItems:'center',minWidth:40}}>
                                    <div style={{width:32,height:32,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,
                                        background: wizardStep === stepNum ? 'var(--berry)' : (filled ? 'var(--green)' : 'var(--gray-200)'),
                                        color: wizardStep === stepNum || filled ? '#fff' : 'var(--gray-500)'}}>
                                        {filled && wizardStep !== stepNum ? <i className="fa-solid fa-check" style={{fontSize:12}}></i> : (i + 1)}
                                    </div>
                                    <div style={{fontSize:9,color: wizardStep === stepNum ? 'var(--berry)' : 'var(--gray-500)',marginTop:3,fontWeight:600,whiteSpace:'nowrap'}}>B{i+1}</div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                    {/* Final step */}
                    <React.Fragment>
                        <div style={{flex:'0 0 20px',height:2,background: pfqGlobal.final != null ? 'var(--green)' : 'var(--gray-200)'}}></div>
                        <div onClick={() => { if (pfqGlobal.final != null) setWizardStep(barquettes.length + 1); }} style={{cursor: pfqGlobal.final != null ? 'pointer' : 'default',display:'flex',flexDirection:'column',alignItems:'center',minWidth:48}}>
                            <div style={{width:32,height:32,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,
                                background: isFinalStep ? 'var(--berry)' : (pfqGlobal.final != null ? 'var(--blue)' : 'var(--gray-200)'),
                                color: isFinalStep || pfqGlobal.final != null ? '#fff' : 'var(--gray-500)'}}>
                                <i className="fa-solid fa-flag-checkered" style={{fontSize:12}}></i>
                            </div>
                            <div style={{fontSize:9,color: isFinalStep ? 'var(--berry)' : 'var(--gray-500)',marginTop:3,fontWeight:600,whiteSpace:'nowrap'}}>PFQ</div>
                        </div>
                    </React.Fragment>
                </div>
            );

            // Navigation buttons
            const renderNav = (canNext, onNext) => (
                <div style={{position:'fixed',bottom:'calc(56px + env(safe-area-inset-bottom, 0px))',left:0,right:0,zIndex:999,background:'#fff',borderTop:'1px solid var(--gray-200)',padding:'10px 16px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 -2px 8px rgba(0,0,0,0.06)'}}>
                    <button onClick={() => setWizardStep(Math.max(0, wizardStep - 1))} disabled={wizardStep === 0}
                        style={{padding:'14px 16px',background: wizardStep > 0 ? 'var(--gray-200)' : 'var(--gray-100)',color:'var(--dark)',border:'none',borderRadius:10,fontSize:14,cursor: wizardStep > 0 ? 'pointer' : 'not-allowed',fontWeight:600,flex:1,opacity: wizardStep === 0 ? 0.5 : 1}}>
                        <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i>Préc.
                    </button>
                    <div style={{fontSize:12,color:'var(--gray-400)',fontWeight:600,whiteSpace:'nowrap'}}>
                        {wizardStep + 1}/{totalSteps}
                    </div>
                    <button onClick={onNext} disabled={!canNext}
                        style={{padding:'14px 16px',background: canNext ? 'var(--berry)' : 'var(--gray-300)',color:'#fff',border:'none',borderRadius:10,fontSize:14,cursor: canNext ? 'pointer' : 'not-allowed',fontWeight:700,flex:2}}>
                        {isBarqStep && barqIdx === barquettes.length - 1 ? <><i className="fa-solid fa-chart-simple" style={{marginRight:8}}></i>Voir résultat</> :
                         <><span>Suivant</span><i className="fa-solid fa-arrow-right" style={{marginLeft:8}}></i></>}
                    </button>
                </div>
            );

            return (
                <div className="tab-content fade-in">
                    <Panel title="PFQ Interne — Sondage Qualité" icon="fa-vial" actions={
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                            <span style={{fontSize:10,color:'var(--gray-400)',padding:'4px 10px',background:'var(--gray-50)',borderRadius:8}}>Format Driscoll's</span>
                            <button onClick={() => { handleReset(); setWizardStep(0); }} style={{padding:'6px 14px',background:'var(--gray-200)',color:'var(--dark)',border:'none',borderRadius:8,fontSize:12,cursor:'pointer',fontWeight:600}}>
                                <i className="fa-solid fa-rotate-right" style={{marginRight:6}}></i>Réinitialiser
                            </button>
                        </div>
                    }>
                        {renderStepper()}

                        {/* ===== STEP 0: Infos Bon d'Apport ===== */}
                        {wizardStep === 0 && (
                            <div className="fade-in">
                                <div style={{textAlign:'center',marginBottom:20}}>
                                    <div style={{fontSize:40,marginBottom:8}}><i className="fa-solid fa-file-lines" style={{color:'var(--berry)'}}></i></div>
                                    <h3 style={{margin:0,color:'var(--berry)'}}>Informations du Bon d'Apport</h3>
                                    <div style={{fontSize:12,color:'var(--gray-400)',marginTop:4}}>Renseignez les informations du lot avant de commencer l'inspection</div>
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
                                    <div>
                                        <label style={labelStyle}>Date</label>
                                        <input type="date" value={formData.date} onChange={e => setFormData(p => ({...p, date: e.target.value}))} style={inputStyle} />
                                    </div>
                                    <div>
                                        <label style={{...labelStyle, color:'var(--red)'}}>N° Bon d'Apport *</label>
                                        <input placeholder="Ex: BA-001" value={formData.bonApport} onChange={e => setFormData(p => ({...p, bonApport: e.target.value}))} style={{...inputStyle, borderColor: !formData.bonApport ? 'var(--red)' : 'var(--gray-200)'}} />
                                    </div>
                                    <div style={{gridColumn:'1 / -1'}}>
                                        <label style={labelStyle}>Bloc / Parcelle *</label>
                                        <select value={formData.bloc} onChange={e => setFormData(p => ({...p, bloc: e.target.value}))} style={{...inputStyle, cursor:'pointer'}}>
                                            <option value="">-- Sélectionner un bloc --</option>
                                            {blocIds.map(b => (
                                                <option key={b.id} value={b.id}>{b.ferme} — {b.label} ({b.variete})</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Confection</label>
                                        <select value={formData.confection} onChange={e => setFormData(p => ({...p, confection: e.target.value}))} style={{...inputStyle, cursor:'pointer'}}>
                                            <option value="">-- Sélectionner --</option>
                                            {confectionTypes.map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={labelStyle}>Contrôleur Qualité</label>
                                        <input placeholder="Nom du contrôleur" value={formData.controleur} readOnly style={{...inputStyle, background:'var(--gray-50)', color:'var(--gray-700)', fontWeight:600}} />
                                    </div>
                                </div>

                                {/* Poids du lot */}
                                <div style={{padding:16,background:'var(--blue-pale)',borderRadius:12,marginBottom:8}}>
                                    <label style={{...labelStyle,fontSize:12}}>Poids du lot (kg) *</label>
                                    <input type="number" placeholder="Ex: 75" value={formData.poidsLot}
                                        onChange={e => handlePoidsLotChange(e.target.value)}
                                        style={{...inputStyle, background:'#fff', fontWeight:700, fontSize:18, textAlign:'center', marginBottom:12}} />
                                    <div style={{display:'flex',justifyContent:'space-around',textAlign:'center'}}>
                                        <div>
                                            <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600}}>Barquettes</div>
                                            <div style={{fontSize:24,fontWeight:800,color:'var(--berry)'}}>{nbBarqRecommande}</div>
                                        </div>
                                        <div>
                                            <div style={{fontSize:10,color:'var(--gray-500)',fontWeight:600}}>Taux inspection</div>
                                            <div style={{fontSize:18,fontWeight:700,color:'var(--blue)'}}>
                                                {(() => { const t = getTauxInspection(parseFloat(formData.poidsLot), nbBarqRecommande); return t ? t.toFixed(1)+'%' : '-%'; })()}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div style={{height:70}}></div>
                                {renderNav(isStep0Valid, () => setWizardStep(1))}
                            </div>
                        )}

                        {/* ===== STEPS 1..N: Barquettes une par une ===== */}
                        {isBarqStep && (() => {
                            const barq = barquettes[barqIdx];
                            const calibre = getCalibre(barq);
                            const nbFruits = parseInt(barq.nbFruits) || 0;
                            const totalDefCond = DEFAUTS_CONDITION.reduce((s, d) => s + (barq.defauts[d.key] || 0), 0);
                            const totalDefApp = DEFAUTS_APPARENCE.reduce((s, d) => s + (barq.defauts[d.key] || 0), 0);
                            return (
                                <div className="fade-in" key={'barq-'+barqIdx}>
                                    <div style={{textAlign:'center',marginBottom:16}}>
                                        <div style={{fontSize:40,marginBottom:4}}><i className="fa-solid fa-box" style={{color:'var(--berry)'}}></i></div>
                                        <h3 style={{margin:0,color:'var(--berry)'}}>Barquette {barqIdx + 1} / {barquettes.length}</h3>
                                        {nbFruits > 0 && (
                                            <div style={{display:'flex',justifyContent:'center',gap:10,marginTop:8,fontSize:12}}>
                                                <span style={{padding:'3px 12px',background:'rgba(231,76,60,0.1)',color:'var(--red)',borderRadius:8,fontWeight:600}}>Cond: {totalDefCond}/{nbFruits}</span>
                                                <span style={{padding:'3px 12px',background:'rgba(243,156,18,0.1)',color:'var(--orange)',borderRadius:8,fontWeight:600}}>App: {totalDefApp}/{nbFruits}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Poids avec emballage, Poids emballage, Nb Fruits */}
                                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
                                        <div>
                                            <label style={labelStyle}>Poids avec Emballage (g)</label>
                                            <input type="number" placeholder="142" value={barq.poids}
                                                onChange={e => updateBarquette(barqIdx, 'poids', e.target.value)} style={{...inputStyle,fontSize:16,fontWeight:600}} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Poids Emballage (g)</label>
                                            <input type="number" placeholder="7" value={barq.poidsEmballage}
                                                onChange={e => updateBarquette(barqIdx, 'poidsEmballage', e.target.value)} style={{...inputStyle,fontSize:16,fontWeight:600}} />
                                        </div>
                                        <div>
                                            <label style={labelStyle}>Nombre de fruits *</label>
                                            <input type="number" placeholder="30" value={barq.nbFruits}
                                                onChange={e => updateBarquette(barqIdx, 'nbFruits', e.target.value)} style={{...inputStyle,fontSize:16,fontWeight:600,borderColor: !barq.nbFruits ? 'var(--orange)' : 'var(--gray-200)'}} />
                                        </div>
                                    </div>
                                    {calibre && (
                                        <div style={{textAlign:'center',padding:'8px 16px',background:'var(--gray-100)',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,color:'var(--berry)'}}>
                                            Calibre: {calibre.toFixed(2)} g/fruit
                                        </div>
                                    )}

                                    {/* Défauts Condition */}
                                    <div style={{marginBottom:16}}>
                                        <div style={sectionHeaderStyle}>
                                            <i className="fa-solid fa-heart-pulse"></i>Défauts Condition
                                        </div>
                                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(100px, 1fr))',gap:8}}>
                                            {DEFAUTS_CONDITION.map(d => (
                                                <div key={d.key} style={{textAlign:'center',padding:'10px 4px',background: (barq.defauts[d.key] || 0) > 0 ? 'rgba(231,76,60,0.08)' : 'var(--gray-50)',borderRadius:10,border: (barq.defauts[d.key] || 0) > 0 ? '1.5px solid var(--red)' : '1px solid transparent'}}>
                                                    <label style={{fontSize:10,color:'var(--gray-600)',display:'block',marginBottom:6,lineHeight:1.3}}>{d.label}</label>
                                                    <input type="number" min="0" value={barq.defauts[d.key] || ''}
                                                        onChange={e => updateDefaut(barqIdx, d.key, e.target.value)}
                                                        placeholder="0" style={{...defautInputStyle,fontSize:16,width:56,padding:'6px 8px'}} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Défauts Apparence */}
                                    <div style={{marginBottom:8}}>
                                        <div style={sectionHeaderStyle}>
                                            <i className="fa-solid fa-eye"></i>Défauts Apparence
                                        </div>
                                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(100px, 1fr))',gap:8}}>
                                            {DEFAUTS_APPARENCE.map(d => (
                                                <div key={d.key} style={{textAlign:'center',padding:'10px 4px',background: (barq.defauts[d.key] || 0) > 0 ? 'rgba(243,156,18,0.08)' : 'var(--gray-50)',borderRadius:10,border: (barq.defauts[d.key] || 0) > 0 ? '1.5px solid var(--orange)' : '1px solid transparent'}}>
                                                    <label style={{fontSize:10,color:'var(--gray-600)',display:'block',marginBottom:6,lineHeight:1.3}}>{d.label}</label>
                                                    <input type="number" min="0" value={barq.defauts[d.key] || ''}
                                                        onChange={e => updateDefaut(barqIdx, d.key, e.target.value)}
                                                        placeholder="0" style={{...defautInputStyle,fontSize:16,width:56,padding:'6px 8px'}} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div style={{height:70}}></div>
                                    {renderNav(isBarqValid, () => setWizardStep(wizardStep + 1))}
                                </div>
                            );
                        })()}

                        {/* ===== STEP FINAL: Résultat PFQ ===== */}
                        {isFinalStep && (
                            <div className="fade-in">
                                <div style={{textAlign:'center',marginBottom:16}}>
                                    <div style={{fontSize:40,marginBottom:4}}><i className="fa-solid fa-chart-simple" style={{color:'var(--berry)'}}></i></div>
                                    <h3 style={{margin:0,color:'var(--berry)'}}>Résultat PFQ Interne</h3>
                                    <div style={{fontSize:12,color:'var(--gray-400)',marginTop:4}}>{barquettes.filter(b => parseInt(b.nbFruits) > 0).length} barquettes inspectées — {pfqGlobal.totalFruits} fruits</div>
                                </div>

                                {/* Tableau récapitulatif des défauts */}
                                {pfqGlobal.condDetail && (
                                <table className="data-table" style={{fontSize:12,marginBottom:16}}>
                                    <thead>
                                        <tr><th>Défaut</th><th style={{textAlign:'right'}}>#</th><th style={{textAlign:'right'}}>%</th></tr>
                                    </thead>
                                    <tbody>
                                        {pfqGlobal.condDetail.map((d, i) => (
                                            <tr key={i} style={{color: d.count > 0 ? 'var(--dark)' : 'var(--gray-300)'}}>
                                                <td>{d.label}</td>
                                                <td style={{textAlign:'right'}}>{d.count}</td>
                                                <td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td>
                                            </tr>
                                        ))}
                                        <tr style={{fontWeight:700,background:'rgba(231,76,60,0.05)'}}>
                                            <td>Condition</td>
                                            <td style={{textAlign:'right'}}>{pfqGlobal.condTotalCount}</td>
                                            <td style={{textAlign:'right',color:getPFQColor(pfqGlobal.etat)}}>{pfqGlobal.condTotalPct}% → {pfqGlobal.etat?.toFixed(1)}/{CONDITION_MAX}</td>
                                        </tr>
                                        {pfqGlobal.appDetail.map((d, i) => (
                                            <tr key={'a'+i} style={{color: d.count > 0 ? 'var(--dark)' : 'var(--gray-300)'}}>
                                                <td>{d.label}</td>
                                                <td style={{textAlign:'right'}}>{d.count}</td>
                                                <td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td>
                                            </tr>
                                        ))}
                                        <tr style={{fontWeight:700,background:'rgba(243,156,18,0.05)'}}>
                                            <td>Apparence</td>
                                            <td style={{textAlign:'right'}}>{pfqGlobal.appTotalCount}</td>
                                            <td style={{textAlign:'right',color:getPFQColor(pfqGlobal.apparence != null ? pfqGlobal.apparence * (CONDITION_MAX / APPARENCE_MAX) : null)}}>{pfqGlobal.appTotalPct}% → {pfqGlobal.apparence?.toFixed(1)}/{APPARENCE_MAX}</td>
                                        </tr>
                                    </tbody>
                                </table>
                                )}

                                {/* Alerte rejet */}
                                {pfqGlobal.rejet && pfqGlobal.final != null && (
                                    <div style={{padding:'12px 16px',background:'rgba(231,76,60,0.1)',border:'2px solid var(--red)',borderRadius:10,marginBottom:12,display:'flex',alignItems:'center',gap:12}}>
                                        <i className="fa-solid fa-triangle-exclamation" style={{fontSize:20,color:'var(--red)'}}></i>
                                        <div>
                                            <div style={{fontWeight:700,color:'var(--red)',fontSize:14}}>LOT REJETÉ</div>
                                            <div style={{fontSize:11,color:'var(--gray-600)',marginTop:2}}>
                                                {pfqGlobal.rejetCondition && <span>PFQ Condition ({pfqGlobal.etat?.toFixed(1)}) &lt; min ({CONDITION_MIN}). </span>}
                                                {pfqGlobal.rejetApparence && <span>PFQ Apparence ({pfqGlobal.apparence?.toFixed(1)}) &lt; min ({APPARENCE_MIN}).</span>}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Scores */}
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
                                    <div style={{textAlign:'center',padding:16,background: pfqGlobal.rejetCondition ? 'rgba(231,76,60,0.08)' : 'var(--berry-pale)',borderRadius:12,border: pfqGlobal.rejetCondition ? '2px solid var(--red)' : 'none'}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Condition</div>
                                        <div style={{fontSize:28,fontWeight:800,color: pfqGlobal.rejetCondition ? 'var(--red)' : getPFQColor(pfqGlobal.etat)}}>{pfqGlobal.etat != null ? pfqGlobal.etat.toFixed(1) : '-'}</div>
                                        <div style={{fontSize:10,color:'var(--gray-400)'}}>/{CONDITION_MAX} (min {CONDITION_MIN})</div>
                                    </div>
                                    <div style={{textAlign:'center',padding:16,background: pfqGlobal.rejetApparence ? 'rgba(231,76,60,0.08)' : 'var(--blue-pale)',borderRadius:12,border: pfqGlobal.rejetApparence ? '2px solid var(--red)' : 'none'}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Apparence</div>
                                        <div style={{fontSize:28,fontWeight:800,color: pfqGlobal.rejetApparence ? 'var(--red)' : getPFQColor(pfqGlobal.apparence != null ? pfqGlobal.apparence * (CONDITION_MAX / APPARENCE_MAX) : null)}}>{pfqGlobal.apparence != null ? pfqGlobal.apparence.toFixed(1) : '-'}</div>
                                        <div style={{fontSize:10,color:'var(--gray-400)'}}>/{APPARENCE_MAX} (min {APPARENCE_MIN})</div>
                                    </div>
                                    <div style={{textAlign:'center',padding:16,background: pfqGlobal.rejet ? 'rgba(231,76,60,0.1)' : (pfqGlobal.final != null ? getPFQColor(pfqGlobal.final)+'15' : 'var(--gray-50)'),borderRadius:12,border: pfqGlobal.rejet ? '2px solid var(--red)' : (pfqGlobal.final != null ? '2px solid '+getPFQColor(pfqGlobal.final) : '1px solid var(--gray-200)')}}>
                                        <div style={{fontSize:11,color:'var(--gray-600)',marginBottom:4,fontWeight:600}}>PFQ Final</div>
                                        <div style={{fontSize:32,fontWeight:800,color: pfqGlobal.rejet ? 'var(--red)' : getPFQColor(pfqGlobal.final)}}>{pfqGlobal.final != null ? pfqGlobal.final.toFixed(1) : '-'}</div>
                                        <div style={{fontSize:10,color:'var(--gray-400)'}}>/{CONDITION_MAX + APPARENCE_MAX}</div>
                                        {pfqGlobal.rejet && <div style={{fontSize:10,fontWeight:700,color:'var(--red)',marginTop:4}}>REJETÉ</div>}
                                    </div>
                                </div>

                                {/* Actions */}
                                {/* Barre fixe en bas pour valider */}
                                <div style={{position:'fixed',bottom:'calc(56px + env(safe-area-inset-bottom, 0px))',left:0,right:0,zIndex:999,background:'#fff',borderTop:'1px solid var(--gray-200)',padding:'10px 16px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 -2px 8px rgba(0,0,0,0.06)'}}>
                                    <button onClick={() => setWizardStep(wizardStep - 1)}
                                        style={{flex:1,padding:'14px 16px',background:'var(--gray-200)',color:'var(--dark)',border:'none',borderRadius:10,fontSize:14,cursor:'pointer',fontWeight:600}}>
                                        <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i>Préc.
                                    </button>
                                    <button onClick={handleSave} disabled={saving || pfqGlobal.final == null}
                                        style={{flex:2,padding:'14px 16px',background: pfqGlobal.final != null ? 'var(--berry)' : 'var(--gray-300)',color:'#fff',border:'none',borderRadius:10,fontSize:15,cursor: pfqGlobal.final != null ? 'pointer' : 'not-allowed',fontWeight:700}}>
                                        {saving ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}></i>Sauvegarde...</>
                                            : <><i className="fa-solid fa-check-circle" style={{marginRight:8}}></i>Valider</>}
                                    </button>
                                </div>
                                <div style={{fontSize:10,color:'var(--gray-400)',padding:'8px 12px',background:'var(--gray-50)',borderRadius:8,textAlign:'center',marginBottom:70}}>
                                    Pénalités par défaut (voir Paramètres). Formule Excel Driscoll's.
                                </div>
                            </div>
                        )}
                    </Panel>

                    {/* Historique des sondages */}
                    {historique.length > 0 && (
                        <Panel title="Historique PFQ Interne" icon="fa-clock-rotate-left">
                            <table className="data-table" style={{fontSize:12}}>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Bloc</th>
                                        <th>N° BA</th>
                                        <th style={{textAlign:'right'}}>Cond.</th>
                                        <th style={{textAlign:'right'}}>App.</th>
                                        <th style={{textAlign:'right'}}>Final</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {historique.map((h, i) => (
                                        <tr key={i} style={{cursor:'pointer'}} onClick={() => { setSavedPFQ(h); setShowBonApport(true); }}>
                                            <td style={{fontWeight:500}}>{h.date}</td>
                                            <td>{h.blocLabel || h.bloc}</td>
                                            <td style={{fontWeight:600}}>{h.bonApport || '-'}</td>
                                            <td style={{textAlign:'right',color:getPFQColor(h.pfqGlobal?.etat)}}>{h.pfqGlobal?.etat?.toFixed(1) || '-'}</td>
                                            <td style={{textAlign:'right',color:getPFQColor(h.pfqGlobal?.apparence != null ? h.pfqGlobal.apparence * (CONDITION_MAX / APPARENCE_MAX) : null)}}>{h.pfqGlobal?.apparence?.toFixed(1) || '-'}</td>
                                            <td style={{textAlign:'right',fontWeight:700,color:getPFQColor(h.pfqGlobal?.final)}}>{h.pfqGlobal?.final?.toFixed(1) || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Panel>
                    )}
                </div>
            );
        }

export { QualitePFQInterneTab };
