
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

        // ===================== SUIVI CALIBRE TAB =====================
        function QualiteSuiviCalibreTab({ data }) {
            const [records, setRecords] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filterFerme, setFilterFerme] = useState('');
            const [filterVariete, setFilterVariete] = useState('');
            const [filterBloc, setFilterBloc] = useState('');
            const [dateFrom, setDateFrom] = useState('');
            const [dateTo, setDateTo] = useState('');

            useEffect(() => {
                const load = async () => {
                    setLoading(true);
                    try {
                        let firestoreData = [];
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const snap = await db.collection('pfq_interne')
                                .orderBy('createdAt', 'desc').limit(500).get();
                            firestoreData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        }
                        const localData = JSON.parse(localStorage.getItem('pfq_interne_local') || '[]');
                        setRecords([...localData, ...firestoreData]);
                    } catch (e) {
                        console.error('Error loading suivi calibre:', e);
                        setRecords(JSON.parse(localStorage.getItem('pfq_interne_local') || '[]'));
                    } finally {
                        setLoading(false);
                    }
                };
                load();
            }, []);

            // Aplatir: une ligne par barquette avec calibre
            const rows = useMemo(() => {
                const out = [];
                records.forEach(r => {
                    (r.barquettes || []).forEach(b => {
                        const cal = b.calibre != null ? b.calibre : (b.poids > 0 && b.nbFruits > 0 ? Math.round(((b.poids - (b.poidsEmballage || 7)) / b.nbFruits) * 100) / 100 : null);
                        if (cal == null) return;
                        out.push({
                            date: r.date || (r.createdAt ? String(r.createdAt).slice(0, 10) : ''),
                            ferme: r.blocFerme || '',
                            variete: r.blocVariete || '',
                            bloc: r.blocLabel || r.bloc || '',
                            bonApport: r.bonApport || '',
                            numero: b.numero,
                            poids: b.poids,
                            poidsEmballage: b.poidsEmballage || 0,
                            nbFruits: b.nbFruits,
                            calibre: cal,
                        });
                    });
                });
                return out;
            }, [records]);

            const fermes = useMemo(() => Array.from(new Set(rows.map(r => r.ferme).filter(Boolean))).sort(), [rows]);
            const varietes = useMemo(() => Array.from(new Set(rows.map(r => r.variete).filter(Boolean))).sort(), [rows]);
            const blocs = useMemo(() => Array.from(new Set(rows.map(r => r.bloc).filter(Boolean))).sort(), [rows]);

            const filtered = useMemo(() => rows.filter(r => {
                if (filterFerme && r.ferme !== filterFerme) return false;
                if (filterVariete && r.variete !== filterVariete) return false;
                if (filterBloc && r.bloc !== filterBloc) return false;
                if (dateFrom && r.date < dateFrom) return false;
                if (dateTo && r.date > dateTo) return false;
                return true;
            }), [rows, filterFerme, filterVariete, filterBloc, dateFrom, dateTo]);

            // Moyennes par bloc/variete
            const aggByBloc = useMemo(() => {
                const map = {};
                filtered.forEach(r => {
                    const key = r.bloc;
                    if (!map[key]) map[key] = { bloc: r.bloc, ferme: r.ferme, variete: r.variete, sum: 0, n: 0, min: Infinity, max: -Infinity };
                    map[key].sum += r.calibre;
                    map[key].n += 1;
                    map[key].min = Math.min(map[key].min, r.calibre);
                    map[key].max = Math.max(map[key].max, r.calibre);
                });
                return Object.values(map).map(o => ({ ...o, avg: o.n > 0 ? o.sum / o.n : 0 })).sort((a, b) => b.avg - a.avg);
            }, [filtered]);

            const aggByVariete = useMemo(() => {
                const map = {};
                filtered.forEach(r => {
                    const key = r.variete;
                    if (!map[key]) map[key] = { variete: r.variete, sum: 0, n: 0 };
                    map[key].sum += r.calibre;
                    map[key].n += 1;
                });
                return Object.values(map).map(o => ({ ...o, avg: o.n > 0 ? o.sum / o.n : 0 })).sort((a, b) => b.avg - a.avg);
            }, [filtered]);

            const globalAvg = filtered.length > 0 ? filtered.reduce((s, r) => s + r.calibre, 0) / filtered.length : 0;

            const calColor = (c) => c >= 4 ? 'var(--green)' : c >= 3 ? 'var(--blue)' : c >= 2 ? 'var(--orange)' : 'var(--red)';

            if (loading) return <div className="tab-content fade-in"><Panel title="Suivi Calibre" icon="fa-ruler-combined"><div style={{padding:40,textAlign:'center',color:'var(--gray-500)'}}>Chargement…</div></Panel></div>;

            return (
                <div className="tab-content fade-in">
                    <Panel title="Suivi Calibre — PFQ Interne" icon="fa-ruler-combined">
                        <div style={{padding:16}}>
                            {/* Filtres */}
                            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
                                <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                    <option value="">Toutes fermes</option>
                                    {fermes.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                                <select value={filterVariete} onChange={e => setFilterVariete(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                    <option value="">Toutes variétés</option>
                                    {varietes.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <select value={filterBloc} onChange={e => setFilterBloc(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}}>
                                    <option value="">Tous blocs</option>
                                    {blocs.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}} />
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13}} />
                            </div>

                            {/* KPI globaux */}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))',gap:12,marginBottom:20}}>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Calibre moyen</div>
                                    <div style={{fontSize:26,fontWeight:700,color:calColor(globalAvg),marginTop:4}}>{globalAvg.toFixed(2)} g</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Barquettes</div>
                                    <div style={{fontSize:26,fontWeight:700,marginTop:4}}>{filtered.length}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Blocs suivis</div>
                                    <div style={{fontSize:26,fontWeight:700,marginTop:4}}>{aggByBloc.length}</div>
                                </div>
                            </div>

                            {/* Calibre moyen par variété */}
                            <div style={{marginBottom:24}}>
                                <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Calibre moyen par variété</h3>
                                <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                                    <thead><tr style={{background:'var(--gray-50)'}}><th style={{textAlign:'left',padding:'8px 10px'}}>Variété</th><th style={{textAlign:'right',padding:'8px 10px'}}>Barquettes</th><th style={{textAlign:'right',padding:'8px 10px'}}>Calibre moyen (g)</th></tr></thead>
                                    <tbody>
                                        {aggByVariete.map(v => (
                                            <tr key={v.variete} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'6px 10px',fontWeight:600}}>{v.variete}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{v.n}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:calColor(v.avg)}}>{v.avg.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                        {aggByVariete.length === 0 && <tr><td colSpan={3} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                    </tbody>
                                </table>
                            </div>

                            {/* Calibre par bloc */}
                            <div style={{marginBottom:24}}>
                                <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Calibre moyen par bloc</h3>
                                <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                                    <thead><tr style={{background:'var(--gray-50)'}}><th style={{textAlign:'left',padding:'8px 10px'}}>Bloc</th><th style={{textAlign:'left',padding:'8px 10px'}}>Ferme</th><th style={{textAlign:'left',padding:'8px 10px'}}>Variété</th><th style={{textAlign:'right',padding:'8px 10px'}}>Barq.</th><th style={{textAlign:'right',padding:'8px 10px'}}>Min</th><th style={{textAlign:'right',padding:'8px 10px'}}>Moyen</th><th style={{textAlign:'right',padding:'8px 10px'}}>Max</th></tr></thead>
                                    <tbody>
                                        {aggByBloc.map(b => (
                                            <tr key={b.bloc} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                <td style={{padding:'6px 10px',fontWeight:600}}>{b.bloc}</td>
                                                <td style={{padding:'6px 10px'}}>{b.ferme}</td>
                                                <td style={{padding:'6px 10px'}}>{b.variete}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{b.n}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{b.min.toFixed(2)}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:calColor(b.avg)}}>{b.avg.toFixed(2)}</td>
                                                <td style={{padding:'6px 10px',textAlign:'right'}}>{b.max.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                        {aggByBloc.length === 0 && <tr><td colSpan={7} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                    </tbody>
                                </table>
                            </div>

                            {/* Détail par barquette */}
                            <div>
                                <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Détail des barquettes ({filtered.length})</h3>
                                <div style={{maxHeight:400,overflowY:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                    <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                        <thead style={{position:'sticky',top:0,background:'var(--gray-50)'}}><tr><th style={{textAlign:'left',padding:'6px 10px'}}>Date</th><th style={{textAlign:'left',padding:'6px 10px'}}>Bloc</th><th style={{textAlign:'left',padding:'6px 10px'}}>Variété</th><th style={{textAlign:'right',padding:'6px 10px'}}>BA</th><th style={{textAlign:'right',padding:'6px 10px'}}>Barq.</th><th style={{textAlign:'right',padding:'6px 10px'}}>P. avec emb.</th><th style={{textAlign:'right',padding:'6px 10px'}}>P. emb.</th><th style={{textAlign:'right',padding:'6px 10px'}}>Nb fruits</th><th style={{textAlign:'right',padding:'6px 10px'}}>Calibre</th></tr></thead>
                                        <tbody>
                                            {filtered.slice(0, 500).map((r, i) => (
                                                <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                    <td style={{padding:'5px 10px'}}>{r.date}</td>
                                                    <td style={{padding:'5px 10px'}}>{r.bloc}</td>
                                                    <td style={{padding:'5px 10px'}}>{r.variete}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.bonApport}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.numero}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.poids}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.poidsEmballage}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{r.nbFruits}</td>
                                                    <td style={{padding:'5px 10px',textAlign:'right',fontWeight:700,color:calColor(r.calibre)}}>{r.calibre.toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </Panel>
                </div>
            );
        }

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

        // ===================== QUALITE DASHBOARD TAB =====================
        function QualiteDashboardTab({ data, weeklyBerryFilter, setWeeklyBerryFilter }) {
            const [selectedLot, setSelectedLot] = useState(null);
            const [selectedBloc, setSelectedBloc] = useState('');
            const [selectedWeekReport, setSelectedWeekReport] = useState(null);
            const [expeditions, setExpeditions] = useState([]);
            const [bonsApport, setBonsApport] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDay, setSelectedDay] = useState('');

            React.useEffect(() => {
                const loadAll = async () => {
                    // Load expeditions
                    try {
                        const json = await cachedFetch('/api/email-analysis?action=expeditions&limit=2000');
                        if (json.success && json.expeditions) {
                            const cutoff = '2026-01-01';
                            const filtered = json.expeditions.filter(e => {
                                if (e.overallResult === 'REJECT') return false;
                                const raw = e.date || e.createdAt || '';
                                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                                const d = m ? m[3] + '-' + m[1] + '-' + m[2] : (raw.length >= 10 && raw[4] === '-' ? raw.slice(0, 10) : '');
                                return d >= cutoff;
                            });
                            setExpeditions(filtered);
                        }
                    } catch(err) { console.warn('Could not load expeditions:', err); }
                    // Load bons d'apport (production data)
                    try {
                        const prodBons = await loadBonsFromFirestore();
                        setBonsApport(prodBons.filter(b => b.typeVente === 'Export'));
                    } catch(err) { console.warn('Could not load bons apport:', err); }
                    setLoading(false);
                };
                loadAll();
            }, []);

            // Map real expeditions to inspection format for the dashboard
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };
            const blocIdsRef = data.blocIds;

            const inspections = React.useMemo(() => {
                // Known condition defect names vs appearance defect names
                const condDefectNames = ['Decay', 'Wet Leaky', 'Overripe', 'Collapsed', 'Weak Cells', 'Sooty Mold', 'Yellow Rust'];
                const appDefectNames = ['Broken', 'Green', 'Size', 'Skin Damage', 'Malformed', 'Attached Calyx', 'Foreign bodies'];
                return expeditions.map(e => {
                    // conditionDefects from API contains ALL defects mixed together
                    // Split them into condition vs appearance using known names
                    const allDefects = e.conditionDefects || [];
                    const condDetail = allDefects.filter(d => condDefectNames.includes(d.name));
                    const appDetail = allDefects.filter(d => appDefectNames.includes(d.name));
                    // Get totals from summary rows
                    const condSummary = allDefects.find(d => d.name === 'Condition');
                    const appSummary = allDefects.find(d => d.name === 'Appearance');
                    const condPct = condDetail.reduce((s, d) => s + (d.percent || 0), 0);
                    const appPct = appDetail.reduce((s, d) => s + (d.percent || 0), 0);
                    const result = (e.overallResult || '').toUpperCase() === 'PASS' ? 'Pass' : 'Fail';
                    const pqScore = e.enrichedPqScore || e.pqScore || e.pfqTotal || 0;
                    const brix = e.brix || e.brixFromDQR || 0;
                    const conditionPoints = e.pfqCondition || (condSummary ? condSummary.points : 0) || 0;
                    const appearancePoints = e.pfqApparence || (appSummary ? appSummary.points : 0) || 0;
                    const brixReceived = e.pfqBrix != null;
                    // Derive blocId from variety + ranch
                    const variety = (e.variety || '').toLowerCase();
                    const ranch = e.ranch || '';
                    const ferme = ranchToFerme[ranch] || '';
                    let blocId = '';
                    // Try to match via batch number pattern (e.g. 195252195-R07103 → blockId 195-R071)
                    if (e.batchNumber) {
                        for (const b of blocIdsRef) {
                            if (b.ferme && b.ferme !== ferme) continue;
                            const blockCode = b.blockId.replace('-', '');
                            if (e.batchNumber.includes(blockCode)) {
                                blocId = b.id;
                                break;
                            }
                        }
                    }
                    // Fallback: match by variety + ranch
                    if (!blocId) {
                        const match = blocIdsRef.find(b => b.ranch === ranch && (b.variete?.toLowerCase() === variety || b.label?.toLowerCase() === variety));
                        if (match) blocId = match.id;
                    }
                    // If still no match, create a dynamic blocId by variety+ferme
                    if (!blocId) blocId = 'DYN-' + ferme + '-' + (e.variety || 'Inconnu').replace(/\s+/g, '');

                    return {
                        receiptId: e.receiptId || '',
                        batchNumber: e.batchNumber || '',
                        variete: e.variety || '',
                        blocId,
                        qty: e.batchQuantity || 0,
                        weight: e.batchWeight || 0,
                        brix,
                        pqScore,
                        result,
                        condPct: Math.round(condPct * 100) / 100,
                        appPct: Math.round(appPct * 100) / 100,
                        fruitInspected: e.totalFruitInspected || 0,
                        sampleSize: e.sampleSize || 0,
                        avgFruitPerPunnet: e.avgFruitsPerPunnet || 0,
                        avgPunnetWeight: e.avgPunnetWeight || 0,
                        item: e.item ? (e.itemDescription ? e.item + ' ' + e.itemDescription : e.item) : '',
                        warehouse: e.warehouse || '',
                        license: e.license || '',
                        received: e.date || '',
                        inspected: e.inspectedDate || '',
                        conditionDetail: condDetail.map(d => ({ defect: d.name, count: d.count || 0, pct: d.percent || 0 })),
                        conditionPoints,
                        appearanceDetail: appDetail.map(d => ({ defect: d.name, count: d.count || 0, pct: d.percent || 0, points: d.points || 0 })),
                        appearancePoints,
                        brixReceived,
                        date: e.date || '',
                        type: 'Initial Inspection',
                        ranch,
                        ranchName: e.ranchName && !e.ranchName.startsWith('Receipt') ? e.ranchName : (ranchToFerme[ranch] === 'F1' ? 'R-Berry Good Farms SARL' : 'Berry Good Farms SARL 3'),
                        ferme,
                    };
                });
            }, [expeditions, blocIdsRef]);

            // Parse date from "MM/DD/YYYY HH:MM GMT" or ISO format to YYYY-MM-DD
            const parseDay = (raw) => {
                if (!raw) return '';
                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return `${m[3]}-${m[1]}-${m[2]}`;
                if (raw.length >= 10 && raw[4] === '-') return raw.slice(0, 10);
                return '';
            };

            // Add parsed day to each inspection
            const inspectionsWithDay = React.useMemo(() =>
                inspections.map(i => ({ ...i, _day: parseDay(i.date || i.received) })),
            [inspections]);

            // Get unique dates sorted descending, auto-select most recent
            const uniqueDates = React.useMemo(() =>
                [...new Set(inspectionsWithDay.map(i => i._day).filter(Boolean))].sort().reverse(),
            [inspectionsWithDay]);

            React.useEffect(() => {
                if (!selectedDay && uniqueDates.length > 0) {
                    const today = new Date().toISOString().slice(0, 10);
                    setSelectedDay(uniqueDates.includes(today) ? today : uniqueDates[0]);
                }
            }, [uniqueDates]);

            // Today's lots = filtered by selected day
            const todayLots = React.useMemo(() =>
                inspectionsWithDay.filter(i => i._day === selectedDay),
            [inspectionsWithDay, selectedDay]);

            // KPIs based on today's lots
            const totalBatches = todayLots.length;
            const passCount = todayLots.filter(i => i.result === 'Pass').length;
            const failCount = totalBatches - passCount;
            const avgPQ = totalBatches > 0 ? Math.round(todayLots.reduce((s, i) => s + i.pqScore, 0) / totalBatches * 10) / 10 : 0;
            const avgCond = totalBatches > 0 ? Math.round(todayLots.reduce((s, i) => s + i.condPct, 0) / totalBatches * 100) / 100 : 0;
            const avgApp = totalBatches > 0 ? Math.round(todayLots.reduce((s, i) => s + i.appPct, 0) / totalBatches * 100) / 100 : 0;

            // Build blocs dynamically from inspections
            const blocsMap = {};
            inspections.forEach(insp => {
                if (!blocsMap[insp.blocId]) {
                    const ref = blocIdsRef.find(b => b.id === insp.blocId);
                    blocsMap[insp.blocId] = {
                        id: insp.blocId,
                        label: ref ? ref.label : insp.variete,
                        parcelle: ref ? ref.parcelle : '',
                        ferme: ref ? ref.ferme : insp.ferme,
                        ranch: ref ? ref.ranch : insp.ranch,
                        ranchName: ref ? ref.ranchName : '',
                        ha: ref ? ref.ha : 0,
                    };
                }
            });
            const blocs = Object.values(blocsMap);

            // Aggregate by bloc (using ALL inspections, not just today)
            const blocStats = {};
            blocs.forEach(b => { blocStats[b.id] = { bloc: b, lots: [], pass: 0, totalPQ: 0, totalCond: 0, totalApp: 0, totalKg: 0, totalKgProd: 0, totalBrix: 0 }; });
            inspectionsWithDay.forEach(i => {
                const bs = blocStats[i.blocId];
                if (bs) {
                    bs.lots.push(i);
                    if (i.result === 'Pass') bs.pass++;
                    bs.totalPQ += i.pqScore;
                    bs.totalCond += i.condPct;
                    bs.totalApp += i.appPct;
                    bs.totalKg += i.weight;
                    bs.totalBrix += i.brix;
                }
            });
            // Aggregate production Kg from bons d'apport
            bonsApport.forEach(bon => {
                const variety = (bon.blocVariete || '').toLowerCase();
                const ferme = bon.blocFerme || '';
                const match = blocIdsRef.find(b => b.variete?.toLowerCase() === variety && b.ferme === ferme);
                if (match && blocStats[match.id]) {
                    blocStats[match.id].totalKgProd += parseFloat(bon.poidsLot) || 0;
                }
            });

            const filteredInspections = selectedBloc ? todayLots.filter(i => i.blocId === selectedBloc) : todayLots;

            if (loading) return <div style={{padding:40, textAlign:'center'}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:24, color:'var(--berry)'}}></i><div style={{marginTop:12, color:'var(--gray-400)'}}>Chargement des inspections...</div></div>;

            return (
                <div className="fade-in">
                    {/* Global KPIs */}
                    <div className="kpi-grid">
                        <KPICard icon="fa-clipboard-check" iconClass="green" value={`${totalBatches > 0 ? Math.round(passCount/totalBatches*100) : 0}%`} label="Taux de Pass" subItems={[{value: passCount, label:'Pass'}, {value: failCount, label:'Fail'}]} />
                        <KPICard icon="fa-star" iconClass="berry" value={avgPQ} label="PQ Score Moyen" />
                        <KPICard icon="fa-triangle-exclamation" iconClass="orange" value={`${avgCond}%`} label="Condition Defects" />
                        <KPICard icon="fa-eye" iconClass="blue" value={`${avgApp}%`} label="Appearance Defects" />
                    </div>

                    {/* KPIs par Bloc ID */}
                    <Panel title="Performance par Bloc ID" icon="fa-cubes">
                        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:'16px'}}>
                            {Object.values(blocStats).filter(bs => bs.lots.length > 0).map((bs, i) => {
                                const n = bs.lots.length;
                                const passRate = Math.round(bs.pass/n*100);
                                const avgPQBloc = Math.round(bs.totalPQ/n*10)/10;
                                const avgBrix = Math.round(bs.totalBrix/n*10)/10;
                                return (
                                    <div key={i} style={{padding:'16px', border:'1px solid var(--gray-200)', borderRadius:'12px', background: selectedBloc === bs.bloc.id ? 'var(--berry-pale)' : 'white', cursor:'pointer', transition:'all 0.2s', borderColor: selectedBloc === bs.bloc.id ? 'var(--berry)' : 'var(--gray-200)'}} onClick={() => setSelectedBloc(selectedBloc === bs.bloc.id ? '' : bs.bloc.id)}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
                                            <div>
                                                <div style={{fontSize:'15px', fontWeight:'700', color:'var(--berry)'}}>{bs.bloc.label}</div>
                                                <div style={{fontSize:'11px', color:'var(--gray-400)'}}>Parcelle {bs.bloc.parcelle} | {bs.bloc.ferme}{bs.bloc.ha ? ` | ${bs.bloc.ha} Ha` : ''}</div>
                                            </div>
                                            <span className={`status-badge ${passRate >= 80 ? 'green' : (passRate >= 50 ? 'orange' : 'red')}`}>{passRate}% Pass</span>
                                        </div>
                                        <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:'8px', textAlign:'center'}}>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700'}}>{n}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Lots</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--berry)'}}>{avgPQBloc}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>PQ Score</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700'}}>{Math.round(bs.totalKgProd).toLocaleString()}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Kg Prod</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--gray-500)'}}>{Math.round(bs.totalKg).toLocaleString()}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Kg Exp</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--green)'}}>{bs.bloc.ha > 0 ? Math.round(bs.totalKgProd / bs.bloc.ha).toLocaleString() : '-'}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Kg/Ha</div>
                                            </div>
                                            <div>
                                                <div style={{fontSize:'18px', fontWeight:'700', color:'var(--blue)'}}>{avgBrix}</div>
                                                <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Brix</div>
                                            </div>
                                        </div>
                                        <div style={{marginTop:'8px'}}>
                                            <div style={{height:'6px', background:'var(--gray-200)', borderRadius:'3px'}}>
                                                <div style={{height:'100%', width:`${Math.min(avgPQBloc, 100)}%`, background: avgPQBloc >= 80 ? 'var(--green)' : (avgPQBloc >= 60 ? 'var(--orange)' : 'var(--red)'), borderRadius:'3px'}}></div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Panel>

                    {/* Lots du jour - clickable */}
                    <Panel title={selectedBloc ? `Lots - ${blocs.find(b=>b.id===selectedBloc)?.label || ''}` : `Lots du ${selectedDay ? new Date(selectedDay + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'}) : 'Jour'}`} icon="fa-list">
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px', flexWrap:'wrap', gap:8}}>
                            <p style={{fontSize:'11px', color:'var(--gray-400)', margin:0}}>
                                <i className="fa-solid fa-hand-pointer"></i> Cliquez sur un lot pour voir le rapport d'inspection complet
                            </p>
                            <select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} style={{padding:'4px 10px', fontSize:12, borderRadius:6, border:'1px solid var(--gray-200)', background:'white'}}>
                                {uniqueDates.map(d => <option key={d} value={d}>{new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit', year:'numeric'})}</option>)}
                            </select>
                        </div>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Receipt ID</th>
                                    <th>Variété</th>
                                    <th>Batch</th>
                                    <th>Colis</th>
                                    <th>Poids (kg)</th>
                                    <th>PFQ Condition</th>
                                    <th>PFQ Apparence</th>
                                    <th>PFQ Brix</th>
                                    <th>PFQ Total</th>
                                    <th>Résultat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredInspections.map((lot, i) => {
                                    const brixPFQValue = lot.brixReceived ? Math.round((lot.brix / 8) * 10) : null;
                                    const totalPFQ = lot.brixReceived ? (lot.conditionPoints + lot.appearancePoints + brixPFQValue) : null;
                                    return (
                                        <tr key={i} onClick={() => setSelectedLot(lot)} style={{cursor:'pointer', transition:'background 0.15s'}} onMouseOver={e => e.currentTarget.style.background='var(--berry-pale)'} onMouseOut={e => e.currentTarget.style.background=''}>
                                            <td><strong style={{color:'var(--blue)'}}>{lot.receiptId}</strong></td>
                                            <td>{lot.variete}</td>
                                            <td style={{fontSize:'11px'}}>{lot.batchNumber}</td>
                                            <td>{lot.qty}</td>
                                            <td>{lot.weight}</td>
                                            <td style={{fontWeight:600, color:'var(--red)'}}>{lot.conditionPoints}/70</td>
                                            <td style={{fontWeight:600, color:'var(--orange)'}}>{lot.appearancePoints}/20</td>
                                            <td style={{fontWeight:600, color:'#9C27B0'}}>
                                                {lot.brixReceived ? `${brixPFQValue}/10` : 'En attente'}
                                            </td>
                                            <td style={{fontWeight:600, color:totalPFQ >= 70 ? 'var(--green)' : (totalPFQ ? 'var(--orange)' : 'var(--gray-400)')}}>
                                                {totalPFQ ? `${totalPFQ}/100` : 'En attente'}
                                            </td>
                                            <td><span className={`status-badge ${lot.result === 'Pass' ? 'green' : 'red'}`}>{lot.result === 'Pass' ? '✓ PASS' : '✗ FAIL'}</span></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </Panel>

                    {/* Brix par Variété */}
                    <Panel title="Brix par Variété" icon="fa-flask">
                        <table className="data-table">
                            <thead><tr><th>Variété</th><th>Ranch Avg Brix</th><th>Pool Avg Brix</th><th>Écart</th><th>PFQ Brix</th><th>Évaluation</th></tr></thead>
                            <tbody>
                                {undefined((b, i) => {
                                    const ecart = Math.round((b.ranchAvg - b.poolAvg) * 100) / 100;
                                    return (
                                        <tr key={i}>
                                            <td style={{fontWeight:600}}>{b.variete}</td>
                                            <td><strong>{Math.round(b.ranchAvg*10)/10}</strong></td>
                                            <td style={{color:'var(--gray-400)'}}>{Math.round(b.poolAvg*10)/10}</td>
                                            <td style={{color: ecart >= 0 ? 'var(--green)' : 'var(--red)', fontWeight:600}}>{ecart >= 0 ? '+' : ''}{ecart}</td>
                                            <td style={{fontWeight:600, color:'#9C27B0'}}>{b.brixPFQ}/10</td>
                                            <td><span className={`status-badge ${b.ranchAvg >= 8 ? 'green' : (b.ranchAvg >= 7 ? 'orange' : 'red')}`}>{b.ranchAvg >= 8 ? '✓ Bon' : (b.ranchAvg >= 7 ? '⚠ Moyen' : '✗ Faible')}</span></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{marginTop:8, fontSize:11, color:'var(--gray-400)', fontStyle:'italic'}}>Source: Rapport Brix Driscoll's (J+1) | Pool = moyenne tous producteurs Driscoll's</div>
                    </Panel>

                    {/* Evolution PFQ par Bloc ID */}
                    <Panel title="Évolution PFQ par Bloc ID (7 derniers jours)" icon="fa-chart-line">
                        <div style={{display:'flex', gap:12, marginBottom:16, alignItems:'center', flexWrap:'wrap'}}>
                            <label style={{fontSize:12, fontWeight:600}}>Bloc:</label>
                            <select value={selectedBloc} onChange={(e) => setSelectedBloc(e.target.value)} style={{padding:'6px 12px', fontSize:12, borderRadius:6, border:'1px solid var(--gray-200)'}}>
                                <option value="">Tous les blocs</option>
                                {blocs.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                            </select>
                        </div>
                        {selectedBloc && data.pfqHistory[selectedBloc] ? (
                            <PFQEvolutionChart data={data.pfqHistory[selectedBloc]} blocLabel={blocs.find(b=>b.id===selectedBloc)?.label} />
                        ) : (
                            <div style={{padding:'20px', textAlign:'center', color:'var(--gray-400)'}}>
                                Sélectionnez un bloc pour voir l'évolution PFQ
                            </div>
                        )}
                    </Panel>

                    {/* Toggle Framboise / Myrtille */}
                    <div style={{display:'flex', alignItems:'center', gap:8, margin:'16px 0 8px'}}>
                        <span style={{fontSize:13, fontWeight:600, color:'var(--gray-500)'}}>Culture :</span>
                        {['framboise', 'myrtille'].map(b => (
                            <button key={b} onClick={() => setWeeklyBerryFilter(b)} style={{
                                padding:'6px 16px', borderRadius:20, border: weeklyBerryFilter === b ? '2px solid var(--berry)' : '1px solid var(--gray-200)',
                                background: weeklyBerryFilter === b ? 'var(--berry-pale)' : 'white', color: weeklyBerryFilter === b ? 'var(--berry)' : 'var(--gray-500)',
                                fontWeight: weeklyBerryFilter === b ? 700 : 400, fontSize:13, cursor:'pointer', transition:'all 0.2s'
                            }}>
                                {b === 'framboise' ? 'Framboise' : 'Myrtille'}
                            </button>
                        ))}
                    </div>

                    {/* Evolution Qualité par Semaine par Ferme */}
                    <Panel title="Évolution Qualité Hebdomadaire par Ferme" icon="fa-chart-column">
                        {(() => {
                            const hist = [...data.weeklyRanking.history].reverse();
                            const chartW = 780, chartH = 260, padL = 50, padR = 20, padT = 20, padB = 40;
                            const plotW = chartW - padL - padR;
                            const plotH = chartH - padT - padB;
                            const allVals = hist.flatMap(h => [h.highest, h.lowest, h.f1Score, h.f5Score, h.avg].filter(v => v != null && !isNaN(v)));
                            if (allVals.length === 0) return <div style={{padding:20, textAlign:'center', color:'var(--gray-400)'}}>Pas encore assez de données hebdomadaires</div>;
                            const minVal = Math.floor(Math.min(...allVals) - 1);
                            const maxVal = Math.ceil(Math.max(...allVals) + 1);
                            const range = maxVal - minVal;
                            const yScale = v => padT + plotH - ((v - minVal) / range) * plotH;
                            const groupW = plotW / hist.length;
                            const barW = 14;

                            return (
                                <div>
                                    <div style={{display:'flex', gap:16, marginBottom:12, flexWrap:'wrap', fontSize:11}}>
                                        <span><span style={{display:'inline-block',width:12,height:12,background:'#E8E8E8',borderRadius:2,marginRight:4,verticalAlign:'middle'}}></span> Range (Lowest - Highest)</span>
                                        <span><span style={{display:'inline-block',width:12,height:12,background:'var(--berry)',borderRadius:2,marginRight:4,verticalAlign:'middle'}}></span> Ferme 172 (F1)</span>
                                        <span><span style={{display:'inline-block',width:12,height:12,background:'var(--green)',borderRadius:2,marginRight:4,verticalAlign:'middle'}}></span> Ferme 195 (F5)</span>
                                        <span><span style={{display:'inline-block',width:12,height:2,background:'var(--orange)',marginRight:4,verticalAlign:'middle'}}></span> Moyenne Pool</span>
                                        <span style={{marginLeft:'auto', fontSize:10, color:'var(--gray-400)'}}>Objectif: Top 5</span>
                                    </div>
                                    <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width:'100%', maxWidth:chartW}}>
                                        {/* Grid lines */}
                                        {[0,1,2,3,4].map(i => {
                                            const val = minVal + (range * i / 4);
                                            const y = yScale(val);
                                            return (
                                                <g key={i}>
                                                    <line x1={padL} y1={y} x2={chartW-padR} y2={y} stroke="#eee" strokeWidth="1"/>
                                                    <text x={padL-5} y={y+3} textAnchor="end" fontSize="9" fill="#999">{val.toFixed(1)}</text>
                                                </g>
                                            );
                                        })}

                                        {/* Top 5 threshold line */}
                                        {(() => {
                                            const top5Score = data.weeklyRanking.ranches.find(r => r.rank === 5)?.pqWeightedAvg;
                                            if (!top5Score) return null;
                                            const y5 = yScale(top5Score);
                                            return (
                                                <g>
                                                    <line x1={padL} y1={y5} x2={chartW-padR} y2={y5} stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="6,3"/>
                                                    <text x={chartW-padR+2} y={y5+3} fontSize="8" fill="var(--gold)" fontWeight="600">Top 5</text>
                                                </g>
                                            );
                                        })()}

                                        {/* Bars per week */}
                                        {hist.map((h, i) => {
                                            const cx = padL + groupW * i + groupW / 2;
                                            const hHigh = h.highest || h.f5Score || h.f1Score || 80;
                                            const hLow = h.lowest || h.f1Score || h.f5Score || 40;
                                            const hAvg = h.avg || ((hHigh + hLow) / 2);
                                            const rangeTop = yScale(hHigh);
                                            const rangeBot = yScale(hLow);
                                            const avgY = yScale(hAvg);
                                            const weekNum = parseInt(h.week.replace('WK',''));
                                            const matchReport = (data.weeklyRanking.weeklyQRReports || []).find(r => r.week === weekNum);

                                            return (
                                                <g key={i} style={{cursor: matchReport ? 'pointer' : 'default'}} onClick={() => matchReport && setSelectedWeekReport(matchReport)}>
                                                    {/* Invisible hit area */}
                                                    <rect x={cx - groupW/2} y={padT} width={groupW} height={plotH + padB} fill="transparent"/>
                                                    {/* Range bar (highest-lowest) */}
                                                    <rect x={cx - barW*1.2} y={rangeTop} width={barW*2.4} height={Math.max(rangeBot - rangeTop, 2)} rx={3} fill="#E8E8E8" opacity="0.7"/>

                                                    {/* Avg line */}
                                                    <line x1={cx - barW*1.2} y1={avgY} x2={cx + barW*1.2} y2={avgY} stroke="var(--orange)" strokeWidth="2" strokeDasharray="3,2"/>

                                                    {/* F1 bar */}
                                                    {h.f1Score ? (
                                                        <g>
                                                            <rect x={cx - barW - 2} y={yScale(h.f1Score)} width={barW} height={Math.max(rangeBot - yScale(h.f1Score), 2)} rx={2} fill="var(--berry)" opacity="0.85"/>
                                                            <text x={cx - barW/2 - 2} y={yScale(h.f1Score) - 4} textAnchor="middle" fontSize="7" fill="var(--berry)" fontWeight="600">{h.f1Score.toFixed(1)}</text>
                                                        </g>
                                                    ) : (
                                                        <text x={cx - barW/2 - 2} y={rangeBot + 10} textAnchor="middle" fontSize="7" fill="var(--gray-400)">-</text>
                                                    )}

                                                    {/* F5 bar */}
                                                    {h.f5Score ? (
                                                        <g>
                                                            <rect x={cx + 2} y={yScale(h.f5Score)} width={barW} height={Math.max(rangeBot - yScale(h.f5Score), 2)} rx={2} fill="var(--green)" opacity="0.85"/>
                                                            <text x={cx + barW/2 + 2} y={yScale(h.f5Score) - 4} textAnchor="middle" fontSize="7" fill="var(--green)" fontWeight="600">{h.f5Score.toFixed(1)}</text>
                                                        </g>
                                                    ) : null}

                                                    {/* Highest / Lowest labels */}
                                                    <text x={cx} y={rangeTop - 4} textAnchor="middle" fontSize="7" fill="var(--gray-400)">{hHigh.toFixed(1)}</text>
                                                    <text x={cx} y={rangeBot + 10} textAnchor="middle" fontSize="7" fill="var(--gray-400)">{hLow.toFixed(1)}</text>

                                                    {/* Week label */}
                                                    <text x={cx} y={chartH - 5} textAnchor="middle" fontSize="10" fill={matchReport ? 'var(--berry)' : 'var(--gray-600)'} fontWeight={matchReport ? '700' : '500'} textDecoration={matchReport ? 'underline' : 'none'}>{h.week}</text>
                                                </g>
                                            );
                                        })}
                                    </svg>
                                    <div style={{fontSize:10, color:'var(--gray-400)', marginTop:8}}>
                                        Source: Weekly Quality Report Driscoll's | PQ Weighted Avg Score par semaine — <span style={{color:'var(--berry)'}}>Cliquez sur une semaine pour voir le rapport complet</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </Panel>

                    {/* Weekly Ranking Driscoll's */}
                    <Panel title={`Weekly Ranking Driscoll's - ${data.weeklyRanking.currentWeek}`} icon="fa-ranking-star">
                        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(380px, 1fr))', gap:16, marginBottom:20}}>
                            {data.weeklyRanking.ranches.filter(r => r.ourFarm).map((r, i) => {
                                const passRate = r.totalWeight > 0 ? Math.round(r.passWeight / r.totalWeight * 100) : 0;
                                const topDefects = r.defects ? Object.entries(r.defects).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]) : [];
                                return (
                                <div key={i} style={{padding:16, border:'2px solid var(--berry)', borderRadius:12, background:'rgba(139,34,82,0.05)'}}>
                                    <div style={{fontSize:14, fontWeight:600, marginBottom:10}}>{r.name}</div>
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, marginBottom:12, textAlign:'center'}}>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700, color: r.rank <= 10 ? 'var(--green)' : (r.rank <= 25 ? 'var(--orange)' : 'var(--red)')}}>{r.rank}/{data.weeklyRanking.totalRanches}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Rang</div>
                                        </div>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700}}>{r.pqWeightedAvg?.toFixed(1) || '-'}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>PQ Score</div>
                                        </div>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700, color:'var(--blue)'}}>{r.totalWeight ? `${(r.totalWeight/1000).toFixed(1)}T` : '-'}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Volume</div>
                                        </div>
                                        <div>
                                            <div style={{fontSize:20, fontWeight:700, color: passRate >= 50 ? 'var(--green)' : 'var(--red)'}}>{passRate}%</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Taux Pass</div>
                                        </div>
                                    </div>
                                    {/* Pass/Fail breakdown */}
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
                                        <div style={{padding:'6px 10px', background:'rgba(76,175,80,0.1)', borderRadius:8, fontSize:11}}>
                                            <span style={{color:'var(--green)', fontWeight:600}}>Pass:</span> {r.passWeight} kg | Brix {r.passBrix?.toFixed(1) || '-'}
                                        </div>
                                        <div style={{padding:'6px 10px', background:'rgba(244,67,54,0.1)', borderRadius:8, fontSize:11}}>
                                            <span style={{color:'var(--red)', fontWeight:600}}>Fail:</span> {r.failWeight} kg | Brix {r.failBrix?.toFixed(1) || '-'}
                                        </div>
                                    </div>
                                    {/* Top defects */}
                                    {topDefects.length > 0 && (
                                        <div style={{fontSize:11, color:'var(--gray-600)'}}>
                                            <span style={{fontWeight:600}}>Principaux défauts:</span>{' '}
                                            {topDefects.slice(0, 3).map(([name, val]) => `${name} ${val}%`).join(' | ')}
                                        </div>
                                    )}
                                    {/* PQ bar */}
                                    <div style={{height:6, background:'var(--gray-200)', borderRadius:3, marginTop:8}}>
                                        <div style={{height:'100%', width:`${Math.min((r.pqWeightedAvg || 0), 100)}%`, background: r.rank <= 10 ? 'var(--green)' : (r.rank <= 25 ? 'var(--orange)' : 'var(--berry)'), borderRadius:3}}></div>
                                    </div>
                                </div>
                                );
                            })}
                        </div>

                        {/* Brix Summary */}
                        {data.weeklyRanking.brixSummary && Object.keys(data.weeklyRanking.brixSummary).length > 0 && (
                            <div style={{marginBottom:16}}>
                                <div style={{fontSize:13, fontWeight:600, marginBottom:8}}>Brix Summary par Variété — Pool Driscoll's</div>
                                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8}}>
                                    {Object.entries(data.weeklyRanking.brixSummary).map(([variety, vals]) => (
                                        <div key={variety} style={{padding:'10px', background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                            <div style={{fontSize:12, fontWeight:600, color:'var(--berry)', marginBottom:4}}>{variety}</div>
                                            <div style={{fontSize:16, fontWeight:700}}>{vals.avg?.toFixed(2) || '-'}</div>
                                            <div style={{fontSize:10, color:'var(--gray-400)'}}>Min {vals.min?.toFixed(1) || '-'} | Max {vals.max?.toFixed(1) || '-'}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* PQ Summary */}
                        {data.weeklyRanking.pqSummary && (
                            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:16}}>
                                <div style={{padding:'12px', textAlign:'center', background:'rgba(76,175,80,0.1)', borderRadius:8}}>
                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MAX PQ</div>
                                    <div style={{fontSize:20, fontWeight:700, color:'var(--green)'}}>{data.weeklyRanking.pqSummary.max?.toFixed(1) || '-'}</div>
                                </div>
                                <div style={{padding:'12px', textAlign:'center', background:'rgba(139,34,82,0.1)', borderRadius:8}}>
                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MOY PQ Pool</div>
                                    <div style={{fontSize:20, fontWeight:700, color:'var(--berry)'}}>{data.weeklyRanking.pqSummary.avg?.toFixed(1) || '-'}</div>
                                </div>
                                <div style={{padding:'12px', textAlign:'center', background:'rgba(244,67,54,0.1)', borderRadius:8}}>
                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MIN PQ</div>
                                    <div style={{fontSize:20, fontWeight:700, color:'var(--red)'}}>{data.weeklyRanking.pqSummary.min?.toFixed(1) || '-'}</div>
                                </div>
                            </div>
                        )}

                        {data.weeklyRanking.totalVolume && (
                            <div style={{fontSize:12, color:'var(--gray-400)', textAlign:'right', marginBottom:8}}>
                                Volume total pool: <strong>{(data.weeklyRanking.totalVolume / 1000).toFixed(1)} T</strong> | {data.weeklyRanking.totalRanches} ranches
                            </div>
                        )}
                    </Panel>

                    {/* ===== WEEKLY QUALITY REPORT POPUP ===== */}
                    {selectedWeekReport && (() => {
                        const rpt = selectedWeekReport;
                        const f1 = (rpt.ourRanches || []).find(r => r.ranchId === '200742');
                        const f5 = (rpt.ourRanches || []).find(r => r.ranchId === '200876');
                        const defectNames = ["Decay","Wet/Leaky","Reversion","Insect/SWD","Decay/Mold","Soft","Shriveled","Overripe","Collapsed","Weak Cells","Sooty Mold","Yellow Rust","Wet/Bruising","Dry Bruising","Mildew"];
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedWeekReport(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'820px', maxHeight:'92vh', overflowY:'auto', padding:0}}>
                                {/* Header - Driscoll's style */}
                                <div style={{background:'linear-gradient(135deg, #1a5632 0%, #2D8B4E 100%)', color:'#fff', padding:'20px 28px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                    <div>
                                        <div style={{fontSize:11, opacity:0.8, letterSpacing:1, textTransform:'uppercase'}}>Driscoll's Weekly Quality Report</div>
                                        <div style={{fontSize:22, fontWeight:700, marginTop:4}}>Settlement Week {rpt.week} — {rpt.year}</div>
                                        <div style={{fontSize:12, opacity:0.7, marginTop:2}}>{rpt.berry === 'myrtille' ? 'Blueberry' : 'Raspberry'}</div>
                                    </div>
                                    <button onClick={() => setSelectedWeekReport(null)} style={{background:'rgba(255,255,255,0.2)', border:'none', color:'#fff', width:32, height:32, borderRadius:'50%', cursor:'pointer', fontSize:16}}>&times;</button>
                                </div>

                                <div style={{padding:'20px 28px'}}>
                                    {/* PW Results */}
                                    {rpt.pwResults && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--green)', paddingBottom:4}}>PW Results</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12}}>
                                                <div style={{padding:12, background:'rgba(76,175,80,0.08)', borderRadius:10, textAlign:'center'}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>Inspection Pass Rate</div>
                                                    <div style={{fontSize:22, fontWeight:700, color:'var(--green)'}}>{rpt.pwResults.inspectionPassRate != null ? rpt.pwResults.inspectionPassRate + '%' : '-'}</div>
                                                </div>
                                                <div style={{padding:12, background:'rgba(255,152,0,0.08)', borderRadius:10, textAlign:'center'}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>Pre-Insp Reject Rate</div>
                                                    <div style={{fontSize:22, fontWeight:700, color:'var(--orange)'}}>{rpt.pwResults.preInspRejectRate != null ? rpt.pwResults.preInspRejectRate + '%' : '-'}</div>
                                                </div>
                                                <div style={{padding:12, background:'rgba(244,67,54,0.08)', borderRadius:10, textAlign:'center'}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>Re-Insp Reject Rate</div>
                                                    <div style={{fontSize:22, fontWeight:700, color:'var(--red)'}}>{rpt.pwResults.reInspRejectRate != null ? rpt.pwResults.reInspRejectRate + '%' : '-'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* YTD Results */}
                                    {rpt.ytdResults && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--berry)', paddingBottom:4}}>YTD Results</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10}}>
                                                {[{label:'Insp Pass Rate', val:rpt.ytdResults.inspPassRate}, {label:'Re-Insp Pass Rate', val:rpt.ytdResults.reInspPassRate}, {label:'Pre-Insp Reject', val:rpt.ytdResults.preInspRejectRate}, {label:'Re-Insp Reject', val:rpt.ytdResults.reInspRejectRate}].map((item,i) => (
                                                    <div key={i} style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                        <div style={{fontSize:9, color:'var(--gray-400)', fontWeight:600}}>{item.label}</div>
                                                        <div style={{fontSize:18, fontWeight:700}}>{item.val != null ? item.val + '%' : '-'}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* PQ Summary */}
                                    {rpt.pqSummary && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--gold)', paddingBottom:4}}>PQ Summary (Pool)</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12}}>
                                                <div style={{padding:14, textAlign:'center', background:'rgba(76,175,80,0.1)', borderRadius:10}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MAX PQ</div>
                                                    <div style={{fontSize:24, fontWeight:700, color:'var(--green)'}}>{rpt.pqSummary.max?.toFixed(1) || '-'}</div>
                                                </div>
                                                <div style={{padding:14, textAlign:'center', background:'rgba(139,34,82,0.1)', borderRadius:10}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>PQ Weighted Avg</div>
                                                    <div style={{fontSize:24, fontWeight:700, color:'var(--berry)'}}>{rpt.pqSummary.avg?.toFixed(1) || '-'}</div>
                                                </div>
                                                <div style={{padding:14, textAlign:'center', background:'rgba(244,67,54,0.1)', borderRadius:10}}>
                                                    <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600}}>MIN PQ</div>
                                                    <div style={{fontSize:24, fontWeight:700, color:'var(--red)'}}>{rpt.pqSummary.min?.toFixed(1) || '-'}</div>
                                                </div>
                                            </div>
                                            {rpt.totalVolume && (
                                                <div style={{fontSize:12, color:'var(--gray-400)', textAlign:'right', marginTop:8}}>
                                                    Volume total pool: <strong>{(rpt.totalVolume / 1000).toFixed(1)} T</strong> | {rpt.allRanchCount} ranches
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Brix Summary par Variété — Pool Driscoll's */}
                                    {rpt.brixSummary && Object.keys(rpt.brixSummary).length > 0 && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid #9C27B0', paddingBottom:4}}>Brix Summary par Variété — Pool Driscoll's</div>
                                            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10}}>
                                                {Object.entries(rpt.brixSummary).map(([variety, vals]) => (
                                                    <div key={variety} style={{padding:12, background:'rgba(156,39,176,0.06)', borderRadius:10, textAlign:'center'}}>
                                                        <div style={{fontSize:12, fontWeight:700, color:'#9C27B0', marginBottom:4}}>{variety}</div>
                                                        <div style={{fontSize:20, fontWeight:700}}>{vals.avg?.toFixed(2) || '-'}</div>
                                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>Min {vals.min?.toFixed(1) || '-'} | Max {vals.max?.toFixed(1) || '-'}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Our Ranches Detail */}
                                    {(f1 || f5) && (
                                        <div style={{marginBottom:20}}>
                                            <div style={{fontSize:13, fontWeight:700, color:'var(--dark)', marginBottom:10, borderBottom:'2px solid var(--berry)', paddingBottom:4}}>Nos Fermes — Détail</div>
                                            <div style={{display:'grid', gridTemplateColumns: f1 && f5 ? '1fr 1fr' : '1fr', gap:16}}>
                                                {[f5, f1].filter(Boolean).map((ranch, ri) => {
                                                    const passRate = ranch.totalWeight > 0 ? Math.round(ranch.passWeight / ranch.totalWeight * 100) : 0;
                                                    const topDefects = ranch.defects ? Object.entries(ranch.defects).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]) : [];
                                                    return (
                                                        <div key={ri} style={{padding:16, border:'2px solid var(--berry)', borderRadius:12, background:'rgba(139,34,82,0.03)'}}>
                                                            <div style={{fontSize:14, fontWeight:700, marginBottom:12, color:'var(--berry)'}}>
                                                                {ranch.farmName === 'F1' ? 'Ferme 172 (F1)' : 'Ferme 195 (F5)'} — Ranch {ranch.ranchId}
                                                            </div>
                                                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, marginBottom:12, textAlign:'center'}}>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700, color: ranch.rank <= 10 ? 'var(--green)' : (ranch.rank <= 25 ? 'var(--orange)' : 'var(--red)')}}>{ranch.rank || '-'}/{ranch.totalRanches || rpt.allRanchCount || '-'}</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>Rang</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700}}>{ranch.pqWeightedAvg?.toFixed(1) || '-'}</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>PQ Score</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700, color:'var(--blue)'}}>{ranch.totalWeight ? `${(ranch.totalWeight/1000).toFixed(1)}T` : '-'}</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>Volume</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{fontSize:20, fontWeight:700, color: passRate >= 50 ? 'var(--green)' : 'var(--red)'}}>{passRate}%</div>
                                                                    <div style={{fontSize:10, color:'var(--gray-400)'}}>Taux Pass</div>
                                                                </div>
                                                            </div>
                                                            {/* Pass / Fail breakdown */}
                                                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
                                                                <div style={{padding:'8px 10px', background:'rgba(76,175,80,0.1)', borderRadius:8, fontSize:11}}>
                                                                    <span style={{color:'var(--green)', fontWeight:700}}>Pass:</span> {ranch.passWeight} kg | Brix {ranch.passBrix?.toFixed(1) || '-'}
                                                                </div>
                                                                <div style={{padding:'8px 10px', background:'rgba(244,67,54,0.1)', borderRadius:8, fontSize:11}}>
                                                                    <span style={{color:'var(--red)', fontWeight:700}}>Fail:</span> {ranch.failWeight} kg | Brix {ranch.failBrix?.toFixed(1) || '-'}
                                                                </div>
                                                            </div>
                                                            {/* Defects */}
                                                            {topDefects.length > 0 && (
                                                                <div>
                                                                    <div style={{fontSize:11, fontWeight:600, marginBottom:6}}>Défauts (%)</div>
                                                                    <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                                                                        {topDefects.slice(0, 6).map(([name, val]) => (
                                                                            <span key={name} style={{padding:'3px 8px', background: val > 5 ? 'rgba(244,67,54,0.12)' : 'var(--gray-100)', borderRadius:12, fontSize:10, fontWeight:500}}>
                                                                                {name} <strong>{val}%</strong>
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {/* PQ bar */}
                                                            <div style={{height:6, background:'var(--gray-200)', borderRadius:3, marginTop:10}}>
                                                                <div style={{height:'100%', width:`${Math.min(ranch.pqWeightedAvg || 0, 100)}%`, background: ranch.rank <= 10 ? 'var(--green)' : (ranch.rank <= 25 ? 'var(--orange)' : 'var(--berry)'), borderRadius:3}}></div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div style={{fontSize:10, color:'var(--gray-400)', textAlign:'center', padding:'8px 0', borderTop:'1px solid var(--gray-200)'}}>
                                        Source: Weekly Quality Report — Driscoll's | WK{rpt.week}-{rpt.year}
                                    </div>
                                </div>
                            </div>
                        </div>
                        );
                    })()}

                    {/* ===== RAPPORT D'INSPECTION PFQ ===== */}
                    {selectedLot && (() => {
                        const defectFr = {
                            'Decay': 'Pourriture', 'Decay Mold': 'Pourriture', 'Decay/Mold': 'Pourriture',
                            'Wet Leaky': 'Fruit saignant', 'Wet/Leaky': 'Fruit saignant',
                            'Overripe': 'Fruit trop mûr', 'Soft': 'Fruit mou',
                            'Collapsed': 'Fruit mou', 'Shriveled': 'Fruit desséché',
                            'Weak Cells': 'Cellules blanches', 'Sooty Mold': 'Cladosporium',
                            'Yellow Rust': 'Rouille jaune', 'Reversion': 'Réversion',
                            'Insect/SWD': 'Insecte/Drosophile', 'Wet/Bruising': 'Meurtrissure humide',
                            'Dry Bruising': 'Meurtrissure sèche', 'Mildew': 'Mildiou',
                            'Green': 'Immature', 'Size': 'Calibre < 3g',
                            'Skin Damage': 'Dégâts ravageurs', 'Broken': 'Cassé',
                            'Malformed': 'Déformation', 'Attached Calyx': 'Avec pédoncule',
                            'Foreign Bodies': 'Corps étrangers', 'Foreign bodies': 'Corps étrangers',
                            'Bloom': 'Bloom (pruine)', 'Stem Blossom': 'Résidu floral',
                        };
                        const trDefect = (name) => defectFr[name] || name;
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedLot(null)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:'650px', maxHeight:'90vh', overflowY:'auto'}}>
                                {/* En-tête */}
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px', paddingBottom:'12px', borderBottom:'2px solid var(--green)'}}>
                                    <div>
                                        <div style={{fontSize:'18px', fontWeight:'700', fontFamily:'Georgia, serif', color:'var(--dark)'}}>Rapport d'Inspection Qualité</div>
                                        <div style={{fontSize:'12px', color:'var(--gray-400)', marginTop:'2px'}}>Driscoll's — Inspection Initiale</div>
                                    </div>
                                    <span className={`status-badge ${selectedLot.result === 'Pass' ? 'green' : 'red'}`} style={{fontSize:'14px', padding:'6px 16px'}}>
                                        {selectedLot.result === 'Pass' ? '✓ CONFORME' : '✗ NON CONFORME'}
                                    </span>
                                </div>

                                {/* Infos Lot */}
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'16px'}}>
                                    <div style={{padding:'10px', background:'var(--gray-100)', borderRadius:'8px'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'4px 12px', fontSize:'12px'}}>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Fruit</span><span>🫐 Myrtille</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Variété</span><span style={{fontWeight:'600'}}>{selectedLot.variete}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Article</span><span>{selectedLot.item}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Ferme</span><span>{selectedLot.ranchName || '-'}</span>
                                        </div>
                                    </div>
                                    <div style={{padding:'10px', background:'var(--gray-100)', borderRadius:'8px'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'4px 12px', fontSize:'12px'}}>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Reçu</span><span style={{fontWeight:'700', color:'var(--berry)'}}>{selectedLot.receiptId}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>N° Lot</span><span>{selectedLot.batchNumber}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Licence</span><span>{selectedLot.license}</span>
                                            <span style={{fontWeight:'600', color:'var(--gray-400)'}}>Entrepôt</span><span>{selectedLot.warehouse}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Tableau Défauts */}
                                <div style={{marginBottom:'16px'}}>
                                    <table className="data-table" style={{fontSize:'12px'}}>
                                        <thead>
                                            <tr style={{background:'var(--gray-100)'}}>
                                                <th>Attribut / Défaut</th><th style={{textAlign:'right'}}>Nb Fruits</th><th style={{textAlign:'right'}}>%</th><th style={{textAlign:'right'}}>Points</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedLot.conditionDetail && selectedLot.conditionDetail.map((d, i) => (
                                                <tr key={i}><td>{trDefect(d.defect)}</td><td style={{textAlign:'right'}}>{d.count}</td><td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td><td></td></tr>
                                            ))}
                                            <tr style={{background:'rgba(76,175,80,0.08)', fontWeight:'700'}}>
                                                <td>Condition</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.conditionDetail ? selectedLot.conditionDetail.reduce((s,d)=>s+d.count,0) : 0}</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.condPct}%</td>
                                                <td style={{textAlign:'right', color:'var(--berry)'}}>{selectedLot.conditionPoints}</td>
                                            </tr>
                                            {selectedLot.appearanceDetail && selectedLot.appearanceDetail.map((d, i) => (
                                                <tr key={`a${i}`}><td>{trDefect(d.defect)}</td><td style={{textAlign:'right'}}>{d.count}</td><td style={{textAlign:'right'}}>{d.pct.toFixed(1)}%</td><td style={{textAlign:'right', color:'var(--gray-400)'}}>{d.points || ''}</td></tr>
                                            ))}
                                            <tr style={{background:'rgba(233,30,99,0.08)', fontWeight:'700'}}>
                                                <td>Apparence</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.appearanceDetail ? selectedLot.appearanceDetail.reduce((s,d)=>s+d.count,0) : 0}</td>
                                                <td style={{textAlign:'right'}}>{selectedLot.appPct}%</td>
                                                <td style={{textAlign:'right', color:'var(--berry)'}}>{selectedLot.appearancePoints}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Saveur + Infos Lot */}
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                                    <div style={{padding:'12px', background:'rgba(156,39,176,0.08)', borderRadius:'8px', textAlign:'center'}}>
                                        <div style={{fontSize:'11px', fontWeight:'600', color:'#9C27B0', textTransform:'uppercase'}}>Saveur</div>
                                        <div style={{fontSize:'10px', color:'var(--gray-400)'}}>Degrés Brix</div>
                                        <div style={{fontSize:'28px', fontWeight:'700', color:'#9C27B0', marginTop:'4px'}}>{selectedLot.brix}</div>
                                    </div>
                                    <div style={{padding:'12px', background:'var(--gray-100)', borderRadius:'8px'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', textAlign:'center', fontSize:'11px'}}>
                                            <div><div style={{fontWeight:'700', fontSize:'16px'}}>{selectedLot.weight}</div><div style={{color:'var(--gray-400)'}}>Poids (kg)</div></div>
                                            <div><div style={{fontWeight:'700', fontSize:'16px'}}>{selectedLot.qty}</div><div style={{color:'var(--gray-400)'}}>Qté Lot</div></div>
                                            <div><div style={{fontWeight:'700', fontSize:'16px'}}>{selectedLot.sampleSize}</div><div style={{color:'var(--gray-400)'}}>Échantillon</div></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Bouton fermer */}
                                <div style={{marginTop:'16px', textAlign:'center'}}>
                                    <button className="btn-primary" onClick={() => setSelectedLot(null)} style={{width:'auto', padding:'10px 32px'}}>
                                        <i className="fa-solid fa-times"></i> Fermer
                                    </button>
                                </div>
                            </div>
                        </div>
                    );})()}
                </div>
            );
        }

        // ===================== QUALITE INSPECTIONS TAB =====================
        // Deduplicate expeditions by batchNumber, merging fields from all records
        function deduplicateExpeditions(expeditions) {
            const byBatch = {};
            expeditions.forEach(e => {
                if (!e.batchNumber) return;
                if (!byBatch[e.batchNumber]) { byBatch[e.batchNumber] = { ...e }; return; }
                // Merge: prefer non-null/non-zero values from each record
                const existing = byBatch[e.batchNumber];
                Object.entries(e).forEach(([k, v]) => {
                    if (v != null && v !== '' && v !== 0 && (existing[k] == null || existing[k] === '' || existing[k] === 0)) {
                        existing[k] = v;
                    }
                });
            });
            // Also include expeditions without batchNumber
            const noBatch = expeditions.filter(e => !e.batchNumber);
            return [...Object.values(byBatch), ...noBatch];
        }

        function QualiteInspectionsTab({ data, applyVarietyMapping, farmFilter }) {
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDate, setSelectedDate] = useState('');
            const [selectedExp, setSelectedExp] = useState(null);
            const [refreshing, setRefreshing] = useState(false);
            const [refreshMsg, setRefreshMsg] = useState('');
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            const loadExpeditions = () => {
                setLoading(true);
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => {
                        if (json.success && json.expeditions) setExpeditions(json.expeditions);
                    })
                    .catch(err => console.warn('Could not load expeditions:', err))
                    .finally(() => setLoading(false));
            };

            React.useEffect(() => { loadExpeditions(); }, []);

            const handleBulkBrixRefresh = async () => {
                setRefreshing(true);
                setRefreshMsg('Relecture DQR/Brix en cours...');
                try {
                    const res = await fetch('/api/email-analysis?action=refetch-dqr');
                    const json = await res.json();
                    setRefreshMsg(`${json.processed || 0} emails DQR re-traités. Traitement Brix en cours...`);
                    // Wait a bit for triggers to process, then reload
                    setTimeout(() => {
                        loadExpeditions();
                        setRefreshMsg('');
                        setRefreshing(false);
                    }, 15000);
                } catch (err) {
                    setRefreshMsg('Erreur: ' + err.message);
                    setRefreshing(false);
                }
            };

            const mappedExpeditions = React.useMemo(() =>
                deduplicateExpeditions(expeditions).map(e => ({
                    ...e, variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety
                })),
            [expeditions, applyVarietyMapping]);

            // Parse date from "MM/DD/YYYY HH:MM GMT" or ISO format to YYYY-MM-DD
            const parseExpDate = (e) => {
                const raw = e.date || e.inspectedDate || e.createdAt || '';
                if (!raw) return '';
                // Try MM/DD/YYYY format
                const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                if (m) return `${m[3]}-${m[1]}-${m[2]}`;
                // Try ISO format
                if (raw.length >= 10 && raw[4] === '-') return raw.slice(0, 10);
                return '';
            };

            const withDates = React.useMemo(() =>
                mappedExpeditions.map(e => ({ ...e, _day: parseExpDate(e) })),
            [mappedExpeditions]);

            // Get unique dates sorted descending
            const uniqueDates = React.useMemo(() => {
                return [...new Set(withDates.map(e => e._day).filter(Boolean))].sort().reverse();
            }, [withDates]);

            // Auto-select today, or most recent date
            React.useEffect(() => {
                if (!selectedDate && uniqueDates.length > 0) {
                    const today = new Date().toISOString().slice(0, 10);
                    setSelectedDate(uniqueDates.includes(today) ? today : uniqueDates[0]);
                }
            }, [uniqueDates]);

            const dayExpeditions = React.useMemo(() =>
                withDates.filter(e => e._day === selectedDate && (!farmFilter || ranchToFerme[e.ranch] === farmFilter)),
            [withDates, selectedDate, farmFilter]);

            // KPIs
            const nbLots = dayExpeditions.length;
            const nbPass = dayExpeditions.filter(e => (e.overallResult || '').toUpperCase() === 'PASS').length;
            const nbFail = dayExpeditions.filter(e => { const r = (e.overallResult || '').toUpperCase(); return r === 'FAIL' || r === 'REJECT'; }).length;
            const nonRejectExpeditions = dayExpeditions.filter(e => (e.overallResult || '').toUpperCase() !== 'REJECT');
            const avgPfq = nonRejectExpeditions.length > 0 ? (nonRejectExpeditions.reduce((s, e) => s + (e.pfqTotal || 0), 0) / nonRejectExpeditions.length).toFixed(1) : '-';
            const avgBrix = (() => {
                const withBrix = dayExpeditions.filter(e => e.brixFromDQR != null);
                return withBrix.length > 0 ? (withBrix.reduce((s, e) => s + e.brixFromDQR, 0) / withBrix.length).toFixed(1) : '-';
            })();

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🫐</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement des inspections...</div></div>;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8}}>
                        <div></div>
                        <div style={{display:'flex', gap:8, alignItems:'center'}}>
                            {refreshMsg && <span style={{fontSize:11, color:'var(--blue)'}}>{refreshMsg}</span>}
                            <button onClick={handleBulkBrixRefresh} disabled={refreshing}
                                style={{padding:'6px 14px', fontSize:11, fontWeight:600, border:'1px solid #9C27B0', background: refreshing ? '#f3e5f5' : 'white', color:'#9C27B0', borderRadius:8, cursor: refreshing ? 'wait' : 'pointer', display:'flex', alignItems:'center', gap:6}}>
                                <i className={`fa-solid ${refreshing ? 'fa-spinner fa-spin' : 'fa-flask'}`}></i>
                                Relecture Brix (Bulk)
                            </button>
                            <button onClick={loadExpeditions} disabled={loading}
                                style={{padding:'6px 14px', fontSize:11, fontWeight:600, border:'1px solid var(--gray-300)', background:'white', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', gap:6}}>
                                <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-refresh'}`}></i>
                                Rafraîchir
                            </button>
                        </div>
                    </div>
                    <div className="kpi-grid" style={{marginBottom: 16}}>
                        <KPICard icon="fa-calendar-day" iconClass="blue" value={selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {day:'numeric',month:'short',year:'numeric'}) : '-'} label="Date sélectionnée" />
                        <KPICard icon="fa-boxes-stacked" iconClass="purple" value={nbLots} label="Lots inspectés" />
                        <KPICard icon="fa-circle-check" iconClass="green" value={nbPass} label="Pass" />
                        <KPICard icon="fa-circle-xmark" iconClass="red" value={nbFail} label="Fail / Reject" />
                        <KPICard icon="fa-star" iconClass="orange" value={avgPfq} label="PFQ moyen" />
                        <KPICard icon="fa-lemon" iconClass="yellow" value={avgBrix} label="Brix moyen" />
                    </div>

                    <Panel title="Inspections du Jour - Détail par Lot" icon="fa-list-check" actions={
                        <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                            style={{padding:'6px 12px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:12,fontWeight:600}}>
                            {uniqueDates.map(d => <option key={d} value={d}>{new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {weekday:'short',day:'numeric',month:'short',year:'numeric'})}</option>)}
                        </select>
                    }>
                        {dayExpeditions.length === 0 ? (
                            <div style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}>
                                <i className="fa-solid fa-inbox fa-2x" style={{marginBottom:12,display:'block'}}></i>
                                Aucune inspection pour cette date
                            </div>
                        ) : (
                        <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Heure</th>
                                    <th>Receipt ID</th>
                                    <th>Batch Number</th>
                                    <th>Variété</th>
                                    <th>Ferme</th>
                                    <th>Qty</th>
                                    <th>Poids (kg)</th>
                                    <th>Brix</th>
                                    <th>Brix (Pts)</th>
                                    <th>PFQ Total</th>
                                    <th>Condition</th>
                                    <th>Apparence</th>
                                    <th>Résultat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dayExpeditions.map((e, i) => {
                                    const isByPass = (e.inspectionType || '').toLowerCase().includes('by') && (e.inspectionType || '').toLowerCase().includes('pass');
                                    const condPct = (e.conditionDefects || []).reduce((s, d) => s + (d.percent || 0), 0);
                                    const appPct = (e.appearanceDefects || []).reduce((s, d) => s + (d.percent || 0), 0);
                                    const pfqTotal = e.pfqBrix != null ? (e.pfqCondition || 0) + (e.pfqApparence || 0) + (e.pfqBrix || 0) : (e.pfqTotal != null ? e.pfqTotal : null);
                                    const ferme = ranchToFerme[e.ranch] || e.ranch || '-';
                                    const byPassBadge = <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:'#e0f2f1',color:'#00695c'}}>By-Pass</span>;
                                    return (
                                    <tr key={i} onClick={() => setSelectedExp(e)} style={{cursor:'pointer'}}
                                        onMouseOver={ev => ev.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                        onMouseOut={ev => ev.currentTarget.style.background=''}>
                                        <td style={{fontFamily:'monospace',fontSize:12,fontWeight:600,color:'var(--blue)'}}>{(() => { const raw = e.date || ''; const tm = raw.match(/(\d{2}:\d{2})/); return tm ? tm[1] : '-'; })()}</td>
                                        <td style={{fontFamily:'monospace',fontSize:12}}>{e.receiptId || '-'}</td>
                                        <td style={{fontFamily:'monospace',fontSize:11,color:'var(--gray-500)'}}>{e.batchNumber || '-'}</td>
                                        <td style={{fontWeight:500}}>{e.variety || '-'}</td>
                                        <td><span className="status-badge" style={{background:'var(--berry-pale)',color:'var(--berry)'}}>{ferme}</span></td>
                                        <td>{e.batchQuantity || '-'}</td>
                                        <td>{e.batchWeight ? e.batchWeight.toFixed(2) : '-'}</td>
                                        <td style={{fontWeight:600,color: (e.brixFromDQR || e.brix || 0) >= 8 ? 'var(--green)' : 'var(--orange)'}}>{isByPass ? byPassBadge : (e.brixFromDQR != null ? e.brixFromDQR : (e.brix || '-'))}</td>
                                        <td style={{fontWeight:600}}>{isByPass ? byPassBadge : (e.pfqBrix != null ? e.pfqBrix.toFixed(1) : '-')}</td>
                                        <td><strong>{isByPass ? byPassBadge : (pfqTotal != null ? pfqTotal.toFixed(1) : '-')}</strong></td>
                                        <td style={{color: condPct > 3 ? 'var(--red)' : 'var(--green)'}}>{isByPass ? byPassBadge : (e.pfqCondition != null ? e.pfqCondition.toFixed(1) : '-')}</td>
                                        <td style={{color: appPct > 5 ? 'var(--red)' : 'var(--green)'}}>{isByPass ? byPassBadge : (e.pfqApparence != null ? e.pfqApparence.toFixed(1) : '-')}</td>
                                        <td>
                                            <span className={`status-badge ${(e.overallResult || '').toUpperCase() === 'PASS' ? 'active' : 'danger'}`}
                                                style={(e.overallResult || '').toUpperCase() === 'REJECT' ? {background:'#e53935',color:'#fff',fontWeight:700} : {}}>
                                                {(e.overallResult || '').toUpperCase() === 'PASS' ? '✓ Pass' : ((e.overallResult || '').toUpperCase() === 'REJECT' ? '✕ REJECT' : '✕ Fail')}
                                            </span>
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{background:'#f8f9fa',fontWeight:700}}>
                                    <td colSpan={5} style={{textAlign:'right',padding:'10px 8px',fontSize:13}}>Total</td>
                                    <td style={{padding:'10px 8px',fontSize:13}}>{dayExpeditions.filter(e => (e.overallResult||'').toUpperCase() !== 'REJECT').reduce((s,e) => s + (e.batchQuantity || 0), 0)}</td>
                                    <td style={{padding:'10px 8px',fontSize:13,color:'var(--berry)'}}>{dayExpeditions.filter(e => (e.overallResult||'').toUpperCase() !== 'REJECT').reduce((s,e) => s + (e.batchWeight || 0), 0).toFixed(1)} kg</td>
                                    <td colSpan={6}></td>
                                </tr>
                            </tfoot>
                        </table>
                        </div>
                        )}
                    </Panel>

                    {dayExpeditions.length > 0 && (() => {
                        // Build PFQ by variety per reception hour
                        const varietyColors = { 'Reyna': '#8B2252', 'Maravilla': '#2D8B4E', 'Maravilla Long Cane': '#1B6B3E', 'Adelita': '#D4A847', 'Kwanza': '#2196F3', 'Cadence': '#9C27B0', 'Grandeur': '#FF5722' };
                        const defaultColors = ['#8B2252', '#2D8B4E', '#D4A847', '#2196F3', '#9C27B0', '#FF5722', '#607D8B', '#E91E63'];
                        const parseHeure = (raw) => { const m = (raw || '').match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : null; };
                        const allVarieties = [...new Set(dayExpeditions.map(e => e.variety).filter(Boolean))].sort();
                        // Group by hour, then by variety
                        const byHour = {};
                        dayExpeditions.forEach(e => {
                            const h = parseHeure(e.date);
                            if (!h) return;
                            if (!byHour[h]) byHour[h] = {};
                            const pfq = e.pfqBrix != null ? (e.pfqCondition || 0) + (e.pfqApparence || 0) + (e.pfqBrix || 0) : (e.pfqTotal || null);
                            if (pfq == null) return;
                            const v = e.variety || 'Inconnu';
                            if (!byHour[h][v]) byHour[h][v] = [];
                            byHour[h][v].push(pfq);
                        });
                        const hours = Object.keys(byHour).sort();
                        if (hours.length < 1) return null;
                        // Compute averages
                        const seriesData = {};
                        allVarieties.forEach(v => {
                            seriesData[v] = hours.map(h => {
                                const vals = (byHour[h] || {})[v];
                                return vals ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
                            });
                        });
                        const width = 700;
                        const height = 280;
                        const pad = { top: 30, right: 20, bottom: 40, left: 50 };
                        const pw = width - pad.left - pad.right;
                        const ph = height - pad.top - pad.bottom;
                        const allVals = Object.values(seriesData).flat().filter(v => v != null);
                        const minV = Math.max(0, Math.floor((Math.min(...allVals) - 5) / 10) * 10);
                        const maxV = Math.min(100, Math.ceil((Math.max(...allVals) + 5) / 10) * 10);
                        const range = maxV - minV || 1;
                        const getX = (i) => pad.left + (hours.length === 1 ? pw / 2 : i * pw / (hours.length - 1));
                        const getY = (val) => pad.top + ph - ((val - minV) / range) * ph;
                        return (
                            <Panel title="Évolution PFQ par Variété — par Heure de Réception" icon="fa-chart-line">
                                <div style={{display:'flex', gap:12, marginBottom:12, flexWrap:'wrap'}}>
                                    {allVarieties.map((v, vi) => {
                                        const color = varietyColors[v] || defaultColors[vi % defaultColors.length];
                                        return <span key={v} style={{display:'flex', alignItems:'center', gap:4, fontSize:12, fontWeight:600}}>
                                            <span style={{display:'inline-block', width:12, height:12, borderRadius:3, background:color}}></span>
                                            {v}
                                        </span>;
                                    })}
                                </div>
                                <svg viewBox={`0 0 ${width} ${height}`} style={{width:'100%', maxWidth:width, border:'1px solid var(--gray-200)', borderRadius:8, background:'#fafafa'}}>
                                    {/* Grid */}
                                    {Array.from({length: Math.floor(range / 10) + 1}, (_, i) => minV + i * 10).map(val => {
                                        const y = getY(val);
                                        return <g key={val}>
                                            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="var(--gray-200)" strokeDasharray="4,4" />
                                            <text x={pad.left - 8} y={y + 4} fontSize="10" textAnchor="end" fill="var(--gray-400)">{val}</text>
                                        </g>;
                                    })}
                                    {/* Axes */}
                                    <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="var(--gray-300)" />
                                    <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="var(--gray-300)" />
                                    {/* Lines per variety */}
                                    {allVarieties.map((v, vi) => {
                                        const color = varietyColors[v] || defaultColors[vi % defaultColors.length];
                                        const points = seriesData[v].map((val, i) => val != null ? { x: getX(i), y: getY(val), val } : null);
                                        const segments = points.filter(p => p != null);
                                        const linePath = segments.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                                        return <g key={v}>
                                            {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />}
                                            {segments.map((p, i) => <g key={i}>
                                                <circle cx={p.x} cy={p.y} r="5" fill="#fff" stroke={color} strokeWidth="2" />
                                                <text x={p.x} y={p.y - 10} fontSize="10" textAnchor="middle" fill={color} fontWeight="700">{p.val.toFixed(1)}</text>
                                            </g>)}
                                        </g>;
                                    })}
                                    {/* X-axis labels (hours) */}
                                    {hours.map((h, i) => <text key={h} x={getX(i)} y={height - pad.bottom + 18} fontSize="11" textAnchor="middle" fill="var(--gray-600)" fontWeight="600">{h}</text>)}
                                    {/* Axis titles */}
                                    <text x={pad.left + 4} y={pad.top - 10} fontSize="11" fill="var(--gray-500)" fontWeight="600">PFQ Score</text>
                                    <text x={width / 2} y={height - 4} fontSize="11" textAnchor="middle" fill="var(--gray-500)" fontWeight="600">Heure de réception</text>
                                </svg>
                            </Panel>
                        );
                    })()}

                    <div style={{marginTop: 16, padding: 16, background: 'var(--berry-pale)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Légende PFQ:</strong> Condition = Decay, Wet/Leaky, Overripe, Collapsed, Weak Cells, Sooty Mold, Yellow Rust |
                        Apparence = Broken, Green, Size, Skin Damage, Malformed, Attached Calyx, Foreign Bodies |
                        Seuils: Condition {'<'} 3% ✓ | Apparence {'<'} 5% ✓
                    </div>

                    {/* Quality Inspection Detail Modal */}
                    {selectedExp && (() => {
                        const _dfr = {'Decay':'Pourriture','Decay Mold':'Pourriture','Decay/Mold':'Pourriture','Wet Leaky':'Fruit saignant','Wet/Leaky':'Fruit saignant','Overripe':'Fruit trop mûr','Soft':'Fruit mou','Collapsed':'Fruit mou','Shriveled':'Fruit desséché','Weak Cells':'Cellules blanches','Sooty Mold':'Cladosporium','Yellow Rust':'Rouille jaune','Reversion':'Réversion','Insect/SWD':'Insecte/Drosophile','Wet/Bruising':'Meurtrissure humide','Dry Bruising':'Meurtrissure sèche','Mildew':'Mildiou','Green':'Immature','Size':'Calibre < 3g','Skin Damage':'Dégâts ravageurs','Broken':'Cassé','Malformed':'Déformation','Attached Calyx':'Avec pédoncule','Foreign Bodies':'Corps étrangers','Foreign bodies':'Corps étrangers','Bloom':'Bloom (pruine)','Stem Blossom':'Résidu floral','Condition':'Condition','Appearance':'Apparence'};
                        const trD = (n) => _dfr[n] || n;
                        const _bfr = {'BLUE':'Myrtille','RASP':'Framboise','STRAW':'Fraise','BLACK':'Mûre'};
                        const berryFr = (t) => { if (!t) return '-'; for (const [k,v] of Object.entries(_bfr)) if (t.toUpperCase().includes(k)) return v; return t; };
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedExp(null)}>
                            <div className="modal-content" onClick={ev => ev.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto', padding:0, borderRadius:12}}>
                                <div style={{background:'linear-gradient(135deg, #2d0a31 0%, #8B2252 100%)', padding:'20px 24px', color:'#fff', borderRadius:'12px 12px 0 0'}}>
                                    <div style={{fontSize:11, opacity:0.7, letterSpacing:1, marginBottom:4}}>DRISCOLL'S</div>
                                    <div style={{fontSize:20, fontWeight:300, fontStyle:'italic', marginBottom:12}}>Rapport d'Inspection Qualité</div>
                                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                                        <span style={{padding:'4px 16px', borderRadius:6, fontSize:14, fontWeight:700,
                                            background: (selectedExp.overallResult || '').toUpperCase() === 'PASS' ? '#4caf50' : '#e53935',
                                            color:'#fff'}}>
                                            {(selectedExp.overallResult || '').toUpperCase() === 'PASS' ? '\u2714 CONFORME' : '\u2718 NON CONFORME'}
                                        </span>
                                        <span style={{fontSize:12, opacity:0.8}}>Inspection Initiale</span>
                                    </div>
                                </div>
                                <div style={{padding:'20px 24px'}}>
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Fruit</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{berryFr(selectedExp.berryType || selectedExp.berryTypeFr)}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Variété</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.variety || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Article</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.itemDescription || selectedExp.item || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Ferme</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{ranchToFerme[selectedExp.ranch] || selectedExp.ranch || '-'}{selectedExp.ranchName ? ` — ${selectedExp.ranchName}` : ''}</div>
                                        </div>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', borderLeft:'1px solid #e0e0e0'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Reçu</div>
                                            <div style={{padding:'8px 12px', fontSize:12, fontWeight:600, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.receiptId || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>N° Lot</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.batchNumber || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Licence</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.license || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Réception</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.date || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Inspecté</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{selectedExp.inspectedDate || '-'}</div>
                                        </div>
                                    </div>

                                    {selectedExp.conditionDefects && selectedExp.conditionDefects.length > 0 && (
                                        <div style={{marginBottom:20}}>
                                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                                                <thead>
                                                    <tr style={{background:'#f5f5f5'}}>
                                                        <th style={{padding:'8px 12px', textAlign:'left', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Attribut / Défaut</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Nb Fruits</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>%</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Points</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedExp.conditionDefects.map((d, j) => {
                                                        const isSummary = d.name === 'Condition' || d.name === 'Appearance';
                                                        return (
                                                            <tr key={j} style={{background: isSummary ? (d.name === 'Condition' ? '#e8f5e9' : '#fce4ec') : 'transparent'}}>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', fontWeight: isSummary ? 700 : 400}}>{trD(d.name)}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.count || 0}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.percent != null ? d.percent.toFixed(1) + '%' : '0.0%'}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.points || ''}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{background:'linear-gradient(135deg, #ce93d8, #ba68c8)', padding:'8px 16px', textAlign:'center', color:'#fff', fontWeight:700, fontSize:13}}>Saveur & Score PFQ</div>
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:0}}>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Degrés Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'#9C27B0'}}>{selectedExp.brixFromDQR != null ? selectedExp.brixFromDQR : (selectedExp.brix || '-')}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Points Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color: selectedExp.pfqBrix != null ? '#9C27B0' : '#ccc'}}>{selectedExp.pfqBrix != null ? selectedExp.pfqBrix.toFixed(1) : 'En attente'}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Condition + Apparence</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'var(--dark)'}}>{((selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0)).toFixed(1)}</div>
                                                <div style={{fontSize:9, color:'#aaa'}}>{selectedExp.pfqCondition || 0} + {selectedExp.pfqApparence || 0}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', background: selectedExp.pfqBrix != null ? 'rgba(76,175,80,0.08)' : 'rgba(255,152,0,0.06)'}}>
                                                <div style={{fontSize:10, color:'#888'}}>PFQ Total</div>
                                                {(() => {
                                                    const total = selectedExp.pfqBrix != null
                                                        ? (selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0) + (selectedExp.pfqBrix || 0)
                                                        : (selectedExp.pfqTotal || null);
                                                    return <div style={{fontSize:20, fontWeight:700, color: total != null ? (total >= 70 ? '#4caf50' : '#e53935') : '#ccc'}}>{total != null ? total.toFixed(1) : '-'}</div>;
                                                })()}
                                                <div style={{fontSize:9, color: selectedExp.pfqBrix != null ? '#4caf50' : '#ff9800'}}>{selectedExp.pfqBrix != null ? 'Brix inclus' : 'Brix en attente'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                                        <thead>
                                            <tr style={{background:'#f5f5f5'}}>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Lot (kg)</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Qté Lot</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Échantillon</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Moy. Fruits/Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Moy. Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Total Fruits Insp.</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.batchWeight ? selectedExp.batchWeight.toFixed(2) : '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.batchQuantity || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.sampleSize || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgFruitsPerPunnet || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgPunnetWeight || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.totalFruitInspected || '-'}</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    <div style={{textAlign:'right'}}>
                                        <button className="btn-secondary" onClick={() => setSelectedExp(null)}>Fermer</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );})()}
                </div>
            );
        }

        // ===================== QUALITE HISTORIQUE TAB =====================
        function QualiteHistoriqueTab({ data, applyVarietyMapping }) {
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedDayLots, setSelectedDayLots] = useState(null);
            const [currentLotIndex, setCurrentLotIndex] = useState(0);
            const [visibleSeries, setVisibleSeries] = useState({ Total: true, Condition: true, Apparence: true });
            const [focusSeries, setFocusSeries] = useState('');
            const [periodDays, setPeriodDays] = useState(7);
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => {
                        if (json.success && json.expeditions) setExpeditions(json.expeditions);
                    })
                    .catch(err => console.warn('Could not load expeditions:', err))
                    .finally(() => setLoading(false));
            }, []);

            // Apply variety mapping + exclude REJECT + deduplicate by batchNumber
            const mappedExpeditions = React.useMemo(() =>
                deduplicateExpeditions(expeditions.filter(e => e.overallResult !== 'REJECT')).map(e => ({
                    ...e, variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety
                })),
            [expeditions, applyVarietyMapping]);

            // Ferme filter
            const uniqueFermes = [...new Set(mappedExpeditions.map(e => ranchToFerme[e.ranch] || e.ranch).filter(Boolean))].sort();
            const fermeFiltered = selectedFerme ? mappedExpeditions.filter(e => (ranchToFerme[e.ranch] || e.ranch) === selectedFerme) : mappedExpeditions;

            // Extract unique varieties (depends on ferme filter)
            const varietes = [...new Set(fermeFiltered.map(e => e.variety).filter(Boolean))].sort();
            const activeVariete = selectedVariete || 'Toutes';

            // Aggregate by date for selected variety
            const historique = React.useMemo(() => {
                const filtered = activeVariete === 'Toutes' ? fermeFiltered : fermeFiltered.filter(e => e.variety === activeVariete);
                const byDate = {};
                filtered.forEach(e => {
                    // Normalize date to DD/MM/YYYY
                    const raw = e.date || '';
                    const dateKey = raw.includes('/') ? raw.split(' ')[0] : raw.substring(0, 10);
                    if (!byDate[dateKey]) byDate[dateKey] = [];
                    byDate[dateKey].push(e);
                });
                return Object.entries(byDate)
                    .map(([date, exps]) => {
                        const nb = exps.length;
                        const avgCondition = exps.reduce((s, e) => s + (e.pfqCondition || 0), 0) / nb;
                        const avgApparence = exps.reduce((s, e) => s + (e.pfqApparence || 0), 0) / nb;
                        const brixExps = exps.filter(e => e.pfqBrix != null);
                        const avgPfqBrix = brixExps.length > 0 ? brixExps.reduce((s, e) => s + e.pfqBrix, 0) / brixExps.length : null;
                        const avgPfqTotal = avgPfqBrix != null ? avgCondition + avgApparence + avgPfqBrix : avgCondition + avgApparence;
                        const avgBrix = exps.filter(e => e.brix).length > 0
                            ? exps.reduce((s, e) => s + (e.brix || 0), 0) / exps.filter(e => e.brix).length : null;
                        const passCount = exps.filter(e => e.overallResult === 'PASS').length;
                        const passRate = (passCount / nb) * 100;
                        const varietiesInDay = [...new Set(exps.map(e => e.variety).filter(Boolean))];
                        return { date, nbBatches: nb, avgCondition, avgApparence, avgPfqBrix, avgPfqTotal, avgBrix, passRate, varieties: varietiesInDay, lots: exps };
                    })
                    .sort((a, b) => new Date(b.date) - new Date(a.date));
            }, [fermeFiltered, activeVariete]);

            const displayedHistorique = React.useMemo(() => {
                if (!periodDays) return historique;
                const cutoff = Date.now() - periodDays * 86400000;
                return historique.filter(h => {
                    const d = new Date(h.date);
                    return !isNaN(d) && d.getTime() >= cutoff;
                });
            }, [historique, periodDays]);

            const len = displayedHistorique.length || 1;
            const avgCond = Math.round(displayedHistorique.reduce((s, h) => s + h.avgCondition, 0) / len * 10) / 10;
            const avgApp = Math.round(displayedHistorique.reduce((s, h) => s + h.avgApparence, 0) / len * 10) / 10;
            const avgTotal = Math.round(displayedHistorique.reduce((s, h) => s + h.avgPfqTotal, 0) / len * 10) / 10;
            const avgPass = Math.round(displayedHistorique.reduce((s, h) => s + h.passRate, 0) / len);

            if (loading) return <div style={{textAlign:'center', padding:24, color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div>;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', gap:16, marginBottom:16, flexWrap:'wrap', alignItems:'center'}}>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            {['Toutes', ...uniqueFermes].map(f => (
                                <button key={f} className={`chip c-blue ${(f === 'Toutes' ? !selectedFerme : selectedFerme === f) ? 'active' : ''}`}
                                    onClick={() => { setSelectedFerme(f === 'Toutes' ? '' : f); setSelectedVariete(''); }}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Variété:</span>
                            {['Toutes', ...varietes].map(v => (
                                <button key={v} className={`chip c-berry ${activeVariete === v ? 'active' : ''}`}
                                    onClick={() => setSelectedVariete(v)}>
                                    {v}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Période:</span>
                            {[{l:'7j',v:7},{l:'30j',v:30},{l:'90j',v:90},{l:'180j',v:180},{l:'Tout',v:0}].map(p => (
                                <button key={p.l} className={`chip c-green ${periodDays === p.v ? 'active' : ''}`}
                                    onClick={() => setPeriodDays(p.v)}>
                                    {p.l}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="kpi-grid">
                        <KPICard icon="fa-chart-line" iconClass="berry"
                            value={avgCond}
                            label="PFQ Condition Moy." />
                        <KPICard icon="fa-eye" iconClass="blue"
                            value={avgApp}
                            label="PFQ Apparence Moy." />
                        <KPICard icon="fa-star" iconClass="green"
                            value={avgTotal}
                            label="PFQ Total Moy." />
                        <KPICard icon="fa-percent" iconClass="orange"
                            value={`${avgPass}%`}
                            label="Pass Rate Moy." />
                    </div>

                    <Panel title={`Évolution PFQ - ${activeVariete}`} icon="fa-chart-area">
                        {displayedHistorique.length > 1 ? (
                            <React.Fragment>
                                <SimpleAreaChart
                                    data={[...displayedHistorique].reverse().map(h => ({
                                        date: (() => {
                                            const r = h.date || '';
                                            if (r.includes('/')) return r.substring(0, 5);
                                            const m = r.match(/^(\d{4})-(\d{2})-(\d{2})/);
                                            return m ? `${m[3]}/${m[2]}` : r;
                                        })(),
                                        ...(visibleSeries.Condition ? { Condition: Math.round(h.avgCondition * 10) / 10 } : {}),
                                        ...(visibleSeries.Apparence ? { Apparence: Math.round(h.avgApparence * 10) / 10 } : {}),
                                        ...(visibleSeries.Total ? { Total: Math.round(h.avgPfqTotal * 10) / 10 } : {})
                                    }))}
                                    dataKeys={['Total','Condition','Apparence'].filter(k => visibleSeries[k])}
                                    colors={['Total','Condition','Apparence'].filter(k => visibleSeries[k]).map(k => ({Total:'#8B2252',Condition:'#E74C3C',Apparence:'#3498DB'}[k]))}
                                    xKey="date"
                                    height={270}
                                    showLabelsFor={focusSeries}
                                />
                                <div style={{display:'flex', gap: 6, justifyContent:'center', marginTop: 8}}>
                                    {[{key:'Total',label:'PFQ Total',color:'#8B2252'},{key:'Condition',label:'Condition',color:'#E74C3C'},{key:'Apparence',label:'Apparence',color:'#3498DB'}].map(s => (
                                        <button key={s.key}
                                            onClick={() => { setVisibleSeries(prev => ({...prev, [s.key]: !prev[s.key]})); if(focusSeries===s.key && visibleSeries[s.key]) setFocusSeries(''); }}
                                            onDoubleClick={() => setFocusSeries(s.key)}
                                            style={{
                                                display:'flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:16, fontSize:12, cursor:'pointer',
                                                border: focusSeries===s.key ? `2px solid ${s.color}` : '1.5px solid #e0e0e0',
                                                background: visibleSeries[s.key] ? '#fff' : '#f5f5f5',
                                                opacity: visibleSeries[s.key] ? 1 : 0.4,
                                                fontWeight: focusSeries===s.key ? 700 : 500, color: visibleSeries[s.key] ? '#333' : '#999'
                                            }}>
                                            <span style={{display:'inline-block', width:10, height:10, background: visibleSeries[s.key] ? s.color : '#ccc', borderRadius:3}}></span>
                                            {s.label}
                                        </button>
                                    ))}
                                </div>
                                <div style={{textAlign:'center', fontSize:10, color:'var(--gray-400)', marginTop:4}}>Cliquez pour afficher/masquer — Double-cliquez pour les labels</div>
                            </React.Fragment>
                        ) : (
                            <div style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>Pas assez de données pour afficher le graphique</div>
                        )}
                    </Panel>

                    <Panel title={`Détail Journalier - ${activeVariete}`} icon="fa-table">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Variété</th>
                                    <th>Lots</th>
                                    <th>PFQ Condition</th>
                                    <th>PFQ Apparence</th>
                                    <th>PFQ Brix</th>
                                    <th>PFQ Total</th>
                                    <th>Brix Moy.</th>
                                    <th>Pass Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedHistorique.map((h, i) => (
                                    <tr key={i} onClick={() => { setSelectedDayLots(h.lots); setCurrentLotIndex(0); }}
                                        style={{cursor:'pointer'}}
                                        onMouseOver={e => e.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                        onMouseOut={e => e.currentTarget.style.background=''}>
                                        <td style={{fontWeight: 500}}>{h.date}</td>
                                        <td>{activeVariete === 'Toutes' ? h.varieties.join(', ') : activeVariete}</td>
                                        <td>{h.nbBatches}</td>
                                        <td style={{fontWeight: 600}}>{Math.round(h.avgCondition * 10) / 10}</td>
                                        <td style={{fontWeight: 600}}>{Math.round(h.avgApparence * 10) / 10}</td>
                                        <td style={{fontWeight: 600, color: h.avgPfqBrix != null ? '#9C27B0' : 'var(--gray-400)'}}>{h.avgPfqBrix != null ? Math.round(h.avgPfqBrix * 10) / 10 : '-'}</td>
                                        <td><strong>{Math.round(h.avgPfqTotal * 10) / 10}</strong></td>
                                        <td>{h.avgBrix ? Math.round(h.avgBrix * 10) / 10 : '-'}</td>
                                        <td>
                                            <span className={`status-badge ${h.passRate >= 80 ? 'active' : (h.passRate >= 50 ? 'warning' : 'danger')}`}>
                                                {Math.round(h.passRate)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {displayedHistorique.length === 0 && (
                                    <tr><td colSpan="9" style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>
                                        Aucune donnée pour cette période
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                        <div style={{fontSize:11, color:'var(--gray-400)', marginTop:8}}><i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>Cliquez sur une ligne pour voir les rapports qualité du jour</div>
                    </Panel>

                    {/* Modal rapport qualité — navigation flèches */}
                    {selectedDayLots && selectedDayLots.length > 0 && (() => {
                        const lot = selectedDayLots[currentLotIndex];
                        const ferme = ranchToFerme[lot.ranch] || lot.ranch;
                        const _dfr2 = {'Decay':'Pourriture','Decay Mold':'Pourriture','Decay/Mold':'Pourriture','Wet Leaky':'Fruit saignant','Wet/Leaky':'Fruit saignant','Overripe':'Fruit trop mûr','Soft':'Fruit mou','Collapsed':'Fruit mou','Shriveled':'Fruit desséché','Weak Cells':'Cellules blanches','Sooty Mold':'Cladosporium','Yellow Rust':'Rouille jaune','Reversion':'Réversion','Insect/SWD':'Insecte/Drosophile','Wet/Bruising':'Meurtrissure humide','Dry Bruising':'Meurtrissure sèche','Mildew':'Mildiou','Green':'Immature','Size':'Calibre < 3g','Skin Damage':'Dégâts ravageurs','Broken':'Cassé','Malformed':'Déformation','Attached Calyx':'Avec pédoncule','Foreign Bodies':'Corps étrangers','Foreign bodies':'Corps étrangers','Bloom':'Bloom (pruine)','Stem Blossom':'Résidu floral','Condition':'Condition','Appearance':'Apparence'};
                        const trD2 = (n) => _dfr2[n] || n;
                        return (
                            <div className="modal-overlay" onClick={() => setSelectedDayLots(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto', padding:0, borderRadius:12}}>
                                    {/* Header */}
                                    <div style={{background:'linear-gradient(135deg, #2d0a31 0%, #8B2252 100%)', padding:'20px 24px', color:'#fff', borderRadius:'12px 12px 0 0'}}>
                                        <div style={{fontSize:11, opacity:0.7, letterSpacing:1, marginBottom:4}}>DRISCOLL'S</div>
                                        <div style={{fontSize:20, fontWeight:300, fontStyle:'italic', marginBottom:12}}>Rapport d'Inspection Qualité</div>
                                        <div style={{display:'flex', alignItems:'center', gap:12}}>
                                            <span style={{padding:'4px 16px', borderRadius:6, fontSize:14, fontWeight:700,
                                                background: lot.overallResult === 'PASS' ? '#4caf50' : '#e53935', color:'#fff'}}>
                                                {lot.overallResult === 'PASS' ? '\u2714 CONFORME' : '\u2718 NON CONFORME'}
                                            </span>
                                            <span style={{fontSize:12, opacity:0.8}}>Inspection Initiale</span>
                                        </div>
                                    </div>

                                    <div style={{padding:'20px 24px'}}>
                                        {/* Info grid */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                            <div style={{display:'grid', gridTemplateColumns:'auto 1fr'}}>
                                                {[['Fruit', lot.berryTypeFr || lot.berryType],['Variété', lot.variety],['Article', lot.itemDescription || lot.item],['Ferme', `${lot.ranch} — ${ferme}`]].map(([l,v],j) => (
                                                    React.createElement(React.Fragment, {key:j},
                                                        React.createElement('div', {style:{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom: j<3?'1px solid #e0e0e0':'none'}}, l),
                                                        React.createElement('div', {style:{padding:'8px 12px', fontSize:12, borderBottom: j<3?'1px solid #e0e0e0':'none'}}, v || '-')
                                                    )
                                                ))}
                                            </div>
                                            <div style={{display:'grid', gridTemplateColumns:'auto 1fr', borderLeft:'1px solid #e0e0e0'}}>
                                                {[['Reçu', lot.receiptId],['N° Lot', lot.batchNumber],['Licence', lot.license],['Réception', lot.date],['Inspecté', lot.inspectedDate]].map(([l,v],j) => (
                                                    React.createElement(React.Fragment, {key:j},
                                                        React.createElement('div', {style:{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom: j<4?'1px solid #e0e0e0':'none'}}, l),
                                                        React.createElement('div', {style:{padding:'8px 12px', fontSize:12, borderBottom: j<4?'1px solid #e0e0e0':'none'}}, v || '-')
                                                    )
                                                ))}
                                            </div>
                                        </div>

                                        {/* Defects table */}
                                        {lot.conditionDefects && lot.conditionDefects.length > 0 && (
                                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:20}}>
                                                <thead>
                                                    <tr style={{background:'#f5f5f5'}}>
                                                        <th style={{padding:'8px 12px', textAlign:'left', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Attribut / Défaut</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Nb Fruits</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>%</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Points</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {lot.conditionDefects.map((d, j) => {
                                                        const isSummary = d.name === 'Condition' || d.name === 'Appearance';
                                                        return (
                                                            <tr key={j} style={{background: isSummary ? (d.name === 'Condition' ? '#e8f5e9' : '#fce4ec') : 'transparent'}}>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', fontWeight: isSummary ? 700 : 400}}>{trD2(d.name)}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.count || 0}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.percent != null ? d.percent.toFixed(1) + '%' : '0.0%'}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.points || ''}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        )}

                                        {/* Saveur / Brix */}
                                        <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                            <div style={{background:'linear-gradient(135deg, #ce93d8, #ba68c8)', padding:'8px 16px', textAlign:'center', color:'#fff', fontWeight:700, fontSize:13}}>Saveur</div>
                                            <div style={{textAlign:'center', padding:'6px', color:'#888', fontSize:11}}>Degrés Brix</div>
                                            <div style={{textAlign:'center', padding:'8px', fontSize:18, fontWeight:700}}>{lot.brix || '-'}</div>
                                        </div>

                                        {/* Batch details */}
                                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr style={{background:'#f5f5f5'}}>
                                                    {['Poids Lot (kg)','Qté Lot','Échantillon','Moy. Fruits/Barq.','Poids Moy. Barq.','Total Fruits Insp.'].map((h,j) =>
                                                        <th key={j} style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>{h}</th>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    {[lot.batchWeight, lot.batchQuantity, lot.sampleSize, lot.avgFruitsPerPunnet, lot.avgPunnetWeight, lot.totalFruitInspected].map((v,j) =>
                                                        <td key={j} style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{v || '-'}</td>
                                                    )}
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Navigation flèches */}
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:16, paddingTop:16, borderTop:'1px solid #e0e0e0'}}>
                                            <button onClick={() => setCurrentLotIndex(Math.max(0, currentLotIndex - 1))}
                                                disabled={currentLotIndex === 0}
                                                style={{padding:'8px 20px', borderRadius:8, border:'1.5px solid var(--gray-200)', background: currentLotIndex === 0 ? '#f5f5f5' : '#fff',
                                                    color: currentLotIndex === 0 ? '#ccc' : 'var(--berry)', cursor: currentLotIndex === 0 ? 'default' : 'pointer', fontWeight:600, fontSize:13}}>
                                                <i className="fa-solid fa-arrow-left" style={{marginRight:6}}></i> Précédent
                                            </button>
                                            <span style={{fontSize:12, fontWeight:600, color:'var(--gray-600)'}}>
                                                Rapport {currentLotIndex + 1} / {selectedDayLots.length}
                                            </span>
                                            <button onClick={() => setCurrentLotIndex(Math.min(selectedDayLots.length - 1, currentLotIndex + 1))}
                                                disabled={currentLotIndex >= selectedDayLots.length - 1}
                                                style={{padding:'8px 20px', borderRadius:8, border:'1.5px solid var(--gray-200)', background: currentLotIndex >= selectedDayLots.length - 1 ? '#f5f5f5' : '#fff',
                                                    color: currentLotIndex >= selectedDayLots.length - 1 ? '#ccc' : 'var(--berry)', cursor: currentLotIndex >= selectedDayLots.length - 1 ? 'default' : 'pointer', fontWeight:600, fontSize:13}}>
                                                Suivant <i className="fa-solid fa-arrow-right" style={{marginLeft:6}}></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            );
        }

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
                    _lastImportTs = Date.now();
                    try {
                        await firebase.firestore().collection('app_settings').doc('pfq_import_meta').set({
                            lastImportTime: Date.now(),
                            lastImportCount: deduped.length,
                            lastImportFile: file.name,
                            lastImportBy: profileData?.name || currentProfile || 'unknown',
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
                    _bonsCache = null; // Invalider le cache
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

        // ===================== QUALITE BRIX TAB =====================
        function QualiteBrixTab({ data, applyVarietyMapping }) {
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => { if (json.success && json.expeditions) setExpeditions(json.expeditions); })
                    .catch(err => console.warn('Could not load expeditions:', err))
                    .finally(() => setLoading(false));
            }, []);

            // Apply variety mapping + deduplicate by batchNumber
            const mappedExpeditions = React.useMemo(() =>
                deduplicateExpeditions(expeditions).map(e => ({
                    ...e, variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety
                })),
            [expeditions, applyVarietyMapping]);

            const uniqueFermes = [...new Set(mappedExpeditions.map(e => ranchToFerme[e.ranch] || e.ranch).filter(Boolean))].sort();
            const fermeFiltered = selectedFerme ? mappedExpeditions.filter(e => (ranchToFerme[e.ranch] || e.ranch) === selectedFerme) : mappedExpeditions;
            const varietes = [...new Set(fermeFiltered.map(e => e.variety).filter(Boolean))].sort();
            const activeVariete = selectedVariete || 'Toutes';
            const varFiltered = activeVariete === 'Toutes' ? fermeFiltered : fermeFiltered.filter(e => e.variety === activeVariete);

            // Aggregate brix by date
            const brixHistory = React.useMemo(() => {
                const byDate = {};
                varFiltered.forEach(e => {
                    if (!e.brix) return;
                    const raw = e.date || '';
                    const dateKey = raw.includes('/') ? raw.split(' ')[0] : raw.substring(0, 10);
                    if (!byDate[dateKey]) byDate[dateKey] = [];
                    byDate[dateKey].push(e.brix);
                });
                return Object.entries(byDate)
                    .map(([date, vals]) => ({ date, avgBrix: vals.reduce((s,v) => s+v, 0) / vals.length, nb: vals.length, min: Math.min(...vals), max: Math.max(...vals) }))
                    .sort((a, b) => a.date > b.date ? 1 : -1);
            }, [varFiltered]);

            const allBrix = varFiltered.filter(e => e.brix).map(e => e.brix);
            const globalAvg = allBrix.length > 0 ? allBrix.reduce((s,v) => s+v, 0) / allBrix.length : 0;
            const minBrix = allBrix.length > 0 ? Math.min(...allBrix) : 0;
            const maxBrix = allBrix.length > 0 ? Math.max(...allBrix) : 0;

            // Count expeditions with PFQ Brix received (from Daily Quality Report emails)
            const nbBrixRecu = varFiltered.filter(e => e.pfqBrix != null || e.status === 'PFQ Brix reçu').length;

            if (loading) return <div style={{textAlign:'center', padding:24, color:'var(--gray-400)'}}><i className="fa-solid fa-spinner fa-spin"></i> Chargement...</div>;

            return (
                <div className="fade-in">
                    <div style={{display:'flex', gap:16, marginBottom:16, flexWrap:'wrap', alignItems:'center'}}>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            {['Toutes', ...uniqueFermes].map(f => (
                                <button key={f} className={`chip c-blue ${(f === 'Toutes' ? !selectedFerme : selectedFerme === f) ? 'active' : ''}`}
                                    onClick={() => { setSelectedFerme(f === 'Toutes' ? '' : f); setSelectedVariete(''); }}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Variété:</span>
                            {['Toutes', ...varietes].map(v => (
                                <button key={v} className={`chip c-berry ${activeVariete === v ? 'active' : ''}`}
                                    onClick={() => setSelectedVariete(v)}>
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="kpi-grid">
                        <KPICard icon="fa-flask" iconClass="berry"
                            value={Math.round(globalAvg * 10) / 10}
                            label="Brix Moyen" />
                        <KPICard icon="fa-arrow-down" iconClass="orange"
                            value={Math.round(minBrix * 10) / 10}
                            label="Brix Min" />
                        <KPICard icon="fa-arrow-up" iconClass="green"
                            value={Math.round(maxBrix * 10) / 10}
                            label="Brix Max" />
                        <KPICard icon="fa-chart-simple" iconClass="blue"
                            value={allBrix.length}
                            label="Nb Mesures" />
                        <KPICard icon="fa-envelope-circle-check" iconClass="green"
                            value={nbBrixRecu}
                            label="PFQ Brix reçus" />
                    </div>

                    <Panel title={`Évolution Brix - ${activeVariete}`} icon="fa-chart-line">
                        {brixHistory.length > 1 ? (
                            <SimpleAreaChart
                                data={brixHistory.map(h => ({
                                    date: h.date.length > 5 ? h.date.substring(0, 5) : h.date,
                                    Brix: Math.round(h.avgBrix * 10) / 10
                                }))}
                                dataKeys={['Brix']}
                                colors={['#9C27B0']}
                                xKey="date"
                                height={250}
                                showLabelsFor="Brix"
                            />
                        ) : (
                            <div style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>Pas assez de données pour afficher le graphique</div>
                        )}
                    </Panel>

                    <Panel title={`Détail Journalier Brix - ${activeVariete}`} icon="fa-table">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Nb Lots</th>
                                    <th>Brix Moy.</th>
                                    <th>Brix Min</th>
                                    <th>Brix Max</th>
                                    <th>Évaluation</th>
                                </tr>
                            </thead>
                            <tbody>
                                {brixHistory.map((h, i) => {
                                    const avg = Math.round(h.avgBrix * 10) / 10;
                                    const evaluation = avg >= 8 ? 'Bon' : (avg >= 7 ? 'Moyen' : 'Faible');
                                    const evalColor = avg >= 8 ? 'var(--green)' : (avg >= 7 ? 'var(--orange)' : 'var(--red)');
                                    return (
                                        <tr key={i}>
                                            <td style={{fontWeight: 500}}>{h.date}</td>
                                            <td>{h.nb}</td>
                                            <td style={{fontWeight: 700}}>{avg}</td>
                                            <td>{Math.round(h.min * 10) / 10}</td>
                                            <td>{Math.round(h.max * 10) / 10}</td>
                                            <td><span className={`status-badge ${avg >= 8 ? 'active' : (avg >= 7 ? 'warning' : 'danger')}`}>{evaluation}</span></td>
                                        </tr>
                                    );
                                })}
                                {brixHistory.length === 0 && (
                                    <tr><td colSpan="6" style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>
                                        Aucune donnée Brix disponible
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </Panel>

                    <div style={{marginTop: 16, padding: 16, background: 'rgba(212,168,71,0.1)', borderRadius: 12, fontSize: 12, color: 'var(--gray-600)'}}>
                        <strong><i className="fa-solid fa-circle-info" style={{marginRight: 6}}></i>Note:</strong> Le Brix (°Bx) mesure la teneur en sucre du fruit.
                        L'évaluation Brix est réalisée par Driscoll's et le rapport arrive le lendemain (J+1).
                        Seuils: ≥8.0 Bon | 7.0-8.0 Moyen | {'<'}7.0 Faible
                    </div>
                </div>
            );
        }

        // ===================== QUALITE MARCHE LOCAL TAB (Bons + Nouveau Bon only) =====================
        function QualiteMarcheLocalTab({ data, userProfile }) {
            const [bons, setBons] = useState([]);
            const [loading, setLoading] = useState(true);
            const [view, setView] = useState('bons'); // 'bons', 'nouveau'
            const [selectedClient, setSelectedClient] = useState('');
            // Nouveau bon form
            const [newBon, setNewBon] = useState({ date: new Date().toISOString().split('T')[0], client: '', ferme: 'F5', designation: '', variete: '', quantiteKg: '', prixDH: '' });
            const [savingBon, setSavingBon] = useState(false);

            // Load bons only
            React.useEffect(() => {
                const loadAll = async () => {
                    setLoading(true);
                    let allBons = [];
                    try {
                        const prodBons = await loadBonsFromFirestore();
                        allBons = prodBons.filter(b => b.typeVente === 'Marché Local');
                    } catch(e) {}
                    try {
                        if (typeof firebase !== 'undefined' && firebase.firestore) {
                            const db = firebase.firestore();
                            const snap = await db.collection('bons_marche_local').orderBy('createdAt', 'desc').limit(500).get();
                            snap.forEach(doc => allBons.push({ id: doc.id, ...doc.data(), source: 'firestore' }));
                        }
                    } catch(e) {}
                    setBons(allBons);
                    setLoading(false);
                };
                loadAll();
            }, []);

            const allClients = [...new Set(bons.map(b => b.client).filter(Boolean))].sort();
            const filteredBons = selectedClient ? bons.filter(b => b.client === selectedClient) : bons;

            // Save new bon
            const handleSaveBon = async () => {
                const { date, client, ferme, designation, variete, quantiteKg, prixDH } = newBon;
                if (!client || !quantiteKg || !prixDH) { alert('Client, Quantité et Prix sont requis'); return; }
                setSavingBon(true);
                const kg = parseFloat(quantiteKg) || 0;
                const prix = parseFloat(prixDH) || 0;
                const total = Math.round(kg * prix * 100) / 100;

                // Check price decrease vs last bon for same client+designation
                const prevBons = bons.filter(b => b.client === client && (b.designation || '') === designation).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                const prevPrix = prevBons.length > 0 ? (parseFloat(prevBons[0].prixDH) || 0) : 0;
                const needsDGValidation = prevPrix > 0 && prix < prevPrix;

                const bonData = {
                    date, client, ferme, designation, variete,
                    poidsLot: kg, prixDH: prix, totalDH: total,
                    typeVente: 'Marché Local',
                    sousType: 'ECRT Vrac',
                    status: needsDGValidation ? 'en_attente_prix_dg' : 'valide',
                    source: 'manual',
                    createdBy: userProfile?.name || 'Qualité',
                    createdAt: new Date().toISOString(),
                };

                try {
                    if (typeof firebase !== 'undefined' && firebase.firestore) {
                        const db = firebase.firestore();
                        const docRef = await db.collection('bons_marche_local').add(bonData);
                        bonData.id = docRef.id;

                        // Create DG validation request if price decreased
                        if (needsDGValidation) {
                            await db.collection('marche_local_prix_validations').add({
                                bonId: docRef.id,
                                client, designation, date, ferme,
                                quantiteKg: kg,
                                newPrix: prix,
                                previousPrix: prevPrix,
                                totalDH: total,
                                status: 'en_attente',
                                requestedBy: userProfile?.name || 'Qualité',
                                requestedAt: new Date().toISOString(),
                                resolvedBy: null, resolvedAt: null, comment: '',
                            });
                            alert(`Prix en baisse (${prevPrix} → ${prix} DH). Demande de validation envoyée au DG.`);
                        }
                    }
                } catch(e) { console.error('Save bon:', e); }
                setBons(prev => [bonData, ...prev]);
                setNewBon({ date: new Date().toISOString().split('T')[0], client: '', ferme: 'F5', designation: '', variete: '', quantiteKg: '', prixDH: '' });
                setSavingBon(false);
                if (!needsDGValidation) setView('bons');
            };


            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement Marché Local...</div></div>;

            return (
                <div className="fade-in">
                    {/* Sub-nav */}
                    <div className="chip-group" style={{marginBottom:16}}>
                        {[
                            {v:'bons', l:'Liste Bons', icon:'fa-list'},
                            {v:'nouveau', l:'Nouveau Bon', icon:'fa-plus-circle'},
                        ].map(tab => (
                            <button key={tab.v} className={`chip c-berry ${view === tab.v ? 'active' : ''}`} onClick={() => setView(tab.v)} style={{padding:'7px 16px',fontSize:12}}>
                                <i className={`fa-solid ${tab.icon}`} style={{fontSize:11}}></i> {tab.l}
                            </button>
                        ))}
                    </div>

                    {/* ===== LISTE BONS ===== */}
                    {view === 'bons' && (
                        <div>
                            <div className="chip-group" style={{marginBottom:12}}>
                                <span className="chip-group-label">Client:</span>
                                {['Tous', ...allClients].map(c => (
                                    <button key={c} className={`chip c-berry ${(c === 'Tous' ? !selectedClient : selectedClient === c) ? 'active' : ''}`}
                                        onClick={() => setSelectedClient(c === 'Tous' ? '' : c)}>{c}</button>
                                ))}
                            </div>
                            <Panel title={`Bons Marché Local (${filteredBons.length})`} icon="fa-list">
                                <div style={{overflowX:'auto'}}>
                                <table className="data-table">
                                    <thead>
                                        <tr><th>Date</th><th>N° Bon</th><th>Client</th><th>Désignation</th><th>Kg</th><th>Prix (DH/kg)</th><th>Total (DH)</th><th>Statut</th></tr>
                                    </thead>
                                    <tbody>
                                        {filteredBons.sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 200).map((b, i) => (
                                            <tr key={i}>
                                                <td style={{whiteSpace:'nowrap'}}>{b.date}</td>
                                                <td>{b.bonApport || '-'}</td>
                                                <td style={{fontWeight:600}}>{b.client}</td>
                                                <td>{b.designation || b.blocLabel || '-'}</td>
                                                <td>{b.poidsLot}</td>
                                                <td style={{fontWeight:600, color:'var(--berry)'}}>{b.prixDH || '-'}</td>
                                                <td style={{fontWeight:700}}>{b.totalDH ? Math.round(b.totalDH).toLocaleString() : '-'}</td>
                                                <td>{b.status === 'en_attente_prix_dg' ? <span style={{background:'#fff3cd', color:'#856404', padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:600}}>En attente DG</span>
                                                   : b.status === 'rejete_dg' ? <span style={{background:'#f8d7da', color:'#721c24', padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:600}}>Rejeté</span>
                                                   : <span style={{background:'#d4edda', color:'#155724', padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:600}}>Validé</span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </Panel>
                        </div>
                    )}

                    {/* ===== NOUVEAU BON ===== */}
                    {view === 'nouveau' && (
                        <Panel title="Nouveau Bon Marché Local" icon="fa-plus-circle">
                            <div style={{maxWidth:600}}>
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16}}>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Date</label>
                                        <input type="date" value={newBon.date} onChange={e => setNewBon({...newBon, date: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Client</label>
                                        <select value={newBon.client} onChange={e => setNewBon({...newBon, client: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}}>
                                            <option value="">— Sélectionner —</option>
                                            {allClients.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Ferme</label>
                                        <select value={newBon.ferme} onChange={e => setNewBon({...newBon, ferme: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}}>
                                            <option value="F1">F1</option>
                                            <option value="F5">F5</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Variété</label>
                                        <input type="text" placeholder="Yazmin, Maravilla..." value={newBon.variete} onChange={e => setNewBon({...newBon, variete: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div style={{gridColumn:'span 2'}}>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Désignation</label>
                                        <input type="text" placeholder="S10 YAZMIN MOTTE F5..." value={newBon.designation} onChange={e => setNewBon({...newBon, designation: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Quantité (kg)</label>
                                        <input type="number" step="0.1" value={newBon.quantiteKg} onChange={e => setNewBon({...newBon, quantiteKg: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                    <div>
                                        <label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:4}}>Prix (DH/kg)</label>
                                        <input type="number" step="0.5" value={newBon.prixDH} onChange={e => setNewBon({...newBon, prixDH: e.target.value})} style={{width:'100%', padding:8, borderRadius:8, border:'1.5px solid var(--gray-200)', fontSize:13}} />
                                    </div>
                                </div>
                                {newBon.quantiteKg && newBon.prixDH && (
                                    <div style={{padding:12, background:'var(--gray-50)', borderRadius:10, marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                        <span style={{fontSize:13, fontWeight:600}}>Total:</span>
                                        <span style={{fontSize:20, fontWeight:800, color:'var(--berry)'}}>{(parseFloat(newBon.quantiteKg) * parseFloat(newBon.prixDH)).toFixed(2)} DH</span>
                                    </div>
                                )}
                                {(() => {
                                    if (newBon.client && newBon.designation && newBon.prixDH) {
                                        const prev = bons.filter(b => b.client === newBon.client && (b.designation || '') === newBon.designation).sort((a,b) => (b.date||'').localeCompare(a.date||''));
                                        if (prev.length > 0) {
                                            const prevPrix = parseFloat(prev[0].prixDH) || 0;
                                            const newPrix = parseFloat(newBon.prixDH) || 0;
                                            if (prevPrix > 0 && newPrix < prevPrix) {
                                                return <div style={{padding:10, background:'#fff3cd', borderRadius:8, marginBottom:12, fontSize:12, color:'#856404', border:'1px solid #ffc107'}}>
                                                    <i className="fa-solid fa-triangle-exclamation"></i> <strong>Baisse de prix détectée :</strong> {prevPrix} DH → {newPrix} DH. Ce bon nécessitera la validation du DG.
                                                </div>;
                                            }
                                        }
                                    }
                                    return null;
                                })()}
                                <button onClick={handleSaveBon} disabled={savingBon} style={{padding:'10px 28px', borderRadius:22, background:'var(--berry)', color:'#fff', border:'none', fontWeight:700, fontSize:14, cursor:'pointer', opacity: savingBon ? 0.6 : 1}}>
                                    {savingBon ? 'Enregistrement...' : 'Enregistrer le Bon'}
                                </button>
                            </div>
                        </Panel>
                    )}

                </div>
            );
        }

        // ===================== QUALITE EXPEDITIONS TAB =====================
        function QualiteExpeditionsTab({ data, applyVarietyMapping, varietyMapping, saveVarietyMapping, userProfile, currentProfile }) {
            const canSeeFinancials = ['finance', 'dg'].includes(currentProfile);
            const [showModal, setShowModal] = useState(false);
            const [showVarietySettings, setShowVarietySettings] = useState(false);
            const [filterStatus, setFilterStatus] = useState('');
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [expeditionList, setExpeditionList] = useState(data.expeditions);
            const [firebaseExpeditions, setFirebaseExpeditions] = useState([]);
            const [loadingFb, setLoadingFb] = useState(true);
            const [selectedExp, setSelectedExp] = useState(null);
            const [formData, setFormData] = useState({ ferme: 'F1', parcelle: '', variete: '', conditionnement: '', colis: '', bonApport: '' });

            // Fetch expeditions from Firebase API
            React.useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=2000')
                    .then(json => {
                        if (json.success && json.expeditions) {
                            setFirebaseExpeditions(json.expeditions);
                        }
                    })
                    .catch(err => console.warn('Could not load Firebase expeditions:', err))
                    .finally(() => setLoadingFb(false));
            }, []);

            const parcelleVarieteMap = {
                '172': 'Maravilla',
                '195': 'Reyna',
                'P1-Hass': 'Hass',
            };

            const parcelles = {
                'F1': ['172-R-01', '172-R-02', '172-R-03'],
                'F5': ['195-R-01', '195-R-02', '195-R-03'],
                'Avocatier': ['P1-Hass', 'P2-Hass B', 'P3-Fuerte']
            };

            const handleParcelleChange = (parcelle) => {
                const prefix = parcelle.substring(0, 3);
                const variete = parcelleVarieteMap[prefix] || 'Adelita';
                setFormData(prev => ({ ...prev, parcelle, variete }));
            };

            const handleSubmit = () => {
                if (!formData.colis || !formData.bonApport) {
                    alert('Veuillez remplir tous les champs');
                    return;
                }
                const newExp = {
                    id: `EXP-000${6578 + expeditionList.length}`,
                    date: new Date().toLocaleDateString('fr-FR'),
                    ferme: formData.ferme,
                    parcelle: formData.parcelle,
                    variete: formData.variete,
                    conditionnement: formData.conditionnement,
                    colis: parseInt(formData.colis),
                    poids: parseInt(formData.colis) * 1.5,
                    bonApport: formData.bonApport,
                    receiptId: null,
                    status: 'En cours de livraison',
                    pqScore: null,
                    ppFruit: null,
                    netPayable: null
                };
                setExpeditionList([newExp, ...expeditionList]);
                setShowModal(false);
                setFormData({ ferme: 'F1', parcelle: '', variete: '', conditionnement: '', colis: '', bonApport: '' });
            };

            // Ranch ID → Ferme mapping
            const ranchToFerme = { '200742': 'F1', '200876': 'F5' };

            // Merge: Firebase expeditions (from email) + local hardcoded ones
            const allExpeditions = React.useMemo(() => {
                const fbMapped = firebaseExpeditions.map(fb => ({
                    id: fb.id,
                    date: fb.date || fb.receivedDate || '',
                    ferme: ranchToFerme[fb.ranch] || fb.ranch || '-',
                    ranchName: fb.ranchName || '',
                    variete: applyVarietyMapping(fb.batchNumber, fb.variety),
                    originalVariety: fb.variety || '-',
                    item: fb.itemDescription || fb.item || '-',
                    colis: fb.batchQuantity || 0,
                    poids: fb.batchWeight || 0,
                    receiptId: fb.receiptId || '-',
                    batchNumber: fb.batchNumber || '-',
                    license: fb.license || '-',
                    inspectedDate: fb.inspectedDate || '',
                    status: fb.status || 'PFQ Reçu. Attente Brix',
                    pqScore: fb.pqScore || null,
                    pfqCondition: fb.pfqCondition != null ? fb.pfqCondition : null,
                    pfqApparence: fb.pfqApparence != null ? fb.pfqApparence : null,
                    pfqBrix: fb.pfqBrix != null ? fb.pfqBrix : null,
                    pfqTotal: fb.pfqBrix != null ? (fb.pfqCondition || 0) + (fb.pfqApparence || 0) + (fb.pfqBrix || 0) : (fb.pfqTotal != null ? fb.pfqTotal : null),
                    brix: fb.brix || null,
                    overallResult: fb.overallResult || null,
                    berryType: fb.berryTypeFr || fb.berryType || null,
                    conditionDefects: fb.conditionDefects || [],
                    appearanceDefects: fb.appearanceDefects || [],
                    totalDefectPoints: fb.totalDefectPoints || 0,
                    sampleSize: fb.sampleSize || null,
                    avgFruitsPerPunnet: fb.avgFruitsPerPunnet || null,
                    avgPunnetWeight: fb.avgPunnetWeight || null,
                    totalFruitInspected: fb.totalFruitInspected || null,
                    gsNet: fb.gsNet || null,
                    ppFruit: fb.ppFruit || null,
                    pricePerKg: fb.pricePerKg || null,
                    liquidationNumber: fb.liquidationNumber || null,
                    liquidationWeek: fb.liquidationWeek || null,
                    source: 'firebase',
                }));
                return [...fbMapped, ...expeditionList];
            }, [firebaseExpeditions, expeditionList]);

            // Ferme/Variété pill filters
            const ranchToFermeMap = { '200742': 'F1', '200876': 'F5' };
            const uniqueFermes = [...new Set(allExpeditions.map(e => e.ferme).filter(f => f && f !== '-'))].sort();
            const fermeFiltered = selectedFerme ? allExpeditions.filter(e => e.ferme === selectedFerme) : allExpeditions;
            const uniqueVarietes = [...new Set(fermeFiltered.map(e => e.variete).filter(v => v && v !== '-'))].sort();
            const activeVariete = selectedVariete || 'Toutes';

            let filtered = activeVariete !== 'Toutes' ? fermeFiltered.filter(e => e.variete === activeVariete) : fermeFiltered;
            if (filterStatus) filtered = filtered.filter(e => e.status === filterStatus);
            filtered = [...filtered].sort((a, b) => {
                const parseD = (d) => { const m = (d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/); return m ? new Date(m[3], m[1]-1, m[2], m[4], m[5]).getTime() : 0; };
                return parseD(b.date) - parseD(a.date);
            });

            const statCounts = {
                total: filtered.length,
                enCours: filtered.filter(e => e.status === 'En cours de livraison').length,
                pfqRecu: filtered.filter(e => e.status === 'PFQ Reçu. Attente Brix' || e.status === 'PFQ reçu').length,
                liquidee: filtered.filter(e => e.status === 'Liquidée').length
            };

            const fbFiltered = filtered.filter(e => e.source === 'firebase');
            const fbCount = fbFiltered.length;
            const passCount = fbFiltered.filter(e => e.overallResult === 'PASS').length;
            const failCount = fbFiltered.filter(e => e.overallResult === 'FAIL' || e.overallResult === 'REJECT').length;

            return (
                <div className="fade-in">
                    <div className="kpi-grid">
                        <KPICard icon="fa-truck" iconClass="berry" value={statCounts.total} label="Total Expéditions" />
                        <KPICard icon="fa-clipboard-check" iconClass="orange" value={statCounts.pfqRecu} label="Attente Brix" />
                        <KPICard icon="fa-coins" iconClass="silver" value={statCounts.liquidee} label="Liquidées" />
                        <KPICard icon="fa-weight-scale" iconClass="green" value={`${Math.round(filtered.filter(e => e.overallResult !== 'REJECT').reduce((s,e) => s + (e.poids || 0), 0))} kg`} label="Production (hors rejet)" />
                        {failCount > 0 && <KPICard icon="fa-ban" iconClass="red" value={`${failCount} (${Math.round(filtered.filter(e => e.overallResult === 'REJECT' || e.overallResult === 'FAIL').reduce((s,e) => s + (e.poids || 0), 0))} kg)`} label="Fail / Reject" />}
                    </div>

                    {fbCount > 0 && (
                        <div style={{background:'var(--blue-pale)', border:'1px solid rgba(52,152,219,0.2)', borderRadius:10, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                            <i className="fa-solid fa-envelope-open-text" style={{color:'var(--blue)', fontSize:16}}></i>
                            <span style={{fontSize:13, fontWeight:600, color:'var(--blue)'}}>{fbCount} rapport(s) qualité Driscoll's reçu(s) par email</span>
                            <span style={{fontSize:12, color:'var(--green)', fontWeight:600}}><i className="fa-solid fa-check-circle"></i> {passCount} PASS</span>
                            {failCount > 0 && <span style={{fontSize:12, color:'var(--red)', fontWeight:600}}><i className="fa-solid fa-times-circle"></i> {failCount} FAIL/REJECT</span>}
                        </div>
                    )}

                    {loadingFb && (
                        <div style={{textAlign:'center', padding:12, color:'var(--gray-400)', fontSize:12}}>
                            <i className="fa-solid fa-spinner fa-spin"></i> Chargement des rapports qualité...
                        </div>
                    )}

                    <div style={{display:'flex', gap:16, marginBottom:16, flexWrap:'wrap', alignItems:'center'}}>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            {['Toutes', ...uniqueFermes].map(f => (
                                <button key={f} className={`chip c-blue ${(f === 'Toutes' ? !selectedFerme : selectedFerme === f) ? 'active' : ''}`}
                                    onClick={() => { setSelectedFerme(f === 'Toutes' ? '' : f); setSelectedVariete(''); }}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Variété:</span>
                            {['Toutes', ...uniqueVarietes].map(v => (
                                <button key={v} className={`chip c-berry ${(v === 'Toutes' ? activeVariete === 'Toutes' : selectedVariete === v) ? 'active' : ''}`}
                                    onClick={() => setSelectedVariete(v === 'Toutes' ? '' : v)}>
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Variety mapping settings modal */}
                    {showVarietySettings && (() => {
                        // Extract unique batch codes from all expeditions
                        const batchCodes = {};
                        const codeToFerme = (code) => { const prefix = code.split('-')[0]; return prefix === '172' ? 'F1' : prefix === '195' ? 'F5' : '-'; };
                        allExpeditions.forEach(e => {
                            const bn = e.batchNumber || '';
                            if (!bn.includes('-')) return;
                            const parts = bn.split('-');
                            const code = parts[0].slice(-3) + '-' + parts[1].slice(0, 4);
                            if (!batchCodes[code]) batchCodes[code] = { code, originalVariety: e.originalVariety || e.variete, count: 0, examples: [], ferme: codeToFerme(code) };
                            batchCodes[code].count++;
                            if (batchCodes[code].examples.length < 2) batchCodes[code].examples.push(bn);
                        });
                        const codes = Object.values(batchCodes).sort((a, b) => a.code.localeCompare(b.code));

                        return (
                            <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', justifyContent:'center', alignItems:'center'}}
                                onClick={(e) => { if (e.target === e.currentTarget) setShowVarietySettings(false); }}>
                                <div style={{background:'#fff', borderRadius:16, padding:24, width:'90%', maxWidth:720, maxHeight:'80vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                                        <h3 style={{margin:0, fontSize:16}}><i className="fa-solid fa-tags" style={{marginRight:8, color:'var(--berry)'}}></i>Paramétrage des Variétés</h3>
                                        <button onClick={() => setShowVarietySettings(false)} style={{background:'none', border:'none', fontSize:18, cursor:'pointer', color:'var(--gray-400)'}}><i className="fa-solid fa-times"></i></button>
                                    </div>
                                    <p style={{fontSize:12, color:'var(--gray-500)', marginBottom:16}}>
                                        Associez un nom de variété à chaque code batch. Le code est extrait des 3 caractères avant et 4 après le tiret du Batch Number.
                                        Le nom sera appliqué à tous les onglets Qualité.
                                    </p>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>Code Batch</th>
                                                <th>Ferme</th>
                                                <th>Exemple</th>
                                                <th>Nb</th>
                                                <th>Nom Variété</th>
                                                <th>Superficie (ha)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {codes.map(c => (
                                                <tr key={c.code}>
                                                    <td style={{fontWeight:700, fontFamily:'monospace'}}>{c.code}</td>
                                                    <td><span className={`status-badge ${c.ferme==='F1'?'berry':'green'}`} style={{fontSize:10}}>{c.ferme}</span></td>
                                                    <td style={{fontSize:10, color:'var(--gray-400)'}}>{c.examples[0]}</td>
                                                    <td>{c.count}</td>
                                                    <td>
                                                        <input type="text"
                                                            defaultValue={varietyMapping[c.code] || c.originalVariety}
                                                            onBlur={(e) => {
                                                                const val = e.target.value.trim();
                                                                if (val && val !== c.originalVariety) {
                                                                    saveVarietyMapping({ ...varietyMapping, [c.code]: val });
                                                                } else if (!val || val === c.originalVariety) {
                                                                    const next = { ...varietyMapping };
                                                                    delete next[c.code];
                                                                    saveVarietyMapping(next);
                                                                }
                                                            }}
                                                            style={{width:'100%', padding:'4px 8px', borderRadius:6, border:'1.5px solid var(--gray-200)', fontSize:12, fontWeight:500}}
                                                        />
                                                    </td>
                                                    <td>
                                                        <input type="number" step="0.01" min="0"
                                                            defaultValue={varietyMapping[c.code + '_ha'] || ''}
                                                            placeholder="ha"
                                                            onBlur={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                const next = { ...varietyMapping };
                                                                if (!isNaN(val) && val > 0) {
                                                                    next[c.code + '_ha'] = val;
                                                                } else {
                                                                    delete next[c.code + '_ha'];
                                                                }
                                                                saveVarietyMapping(next);
                                                            }}
                                                            style={{width:70, padding:'4px 8px', borderRadius:6, border:'1.5px solid var(--gray-200)', fontSize:12, textAlign:'right'}}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                            {codes.length === 0 && (
                                                <tr><td colSpan="6" style={{textAlign:'center', padding:16, color:'var(--gray-400)'}}>Aucun code batch trouvé</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    <Panel title="Expéditions" icon="fa-truck" actions={
                        <button onClick={() => setShowVarietySettings(true)}
                            style={{background:'none', border:'1.5px solid var(--gray-200)', borderRadius:8, padding:'4px 12px', fontSize:11, cursor:'pointer', color:'var(--gray-500)', display:'flex', alignItems:'center', gap:6}}>
                            <i className="fa-solid fa-tags"></i> Variétés
                        </button>
                    }>
                        <div style={{overflowX:'auto'}}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Statut</th>
                                    <th>Date</th>
                                    <th>Receipt ID</th>
                                    <th>Batch Number</th>
                                    <th>Variété</th>
                                    <th>Item</th>
                                    <th>Ferme</th>
                                    <th>Colis</th>
                                    <th>Poids (kg)</th>
                                    <th>PFQ Total</th>
                                    <th>Condition</th>
                                    <th>Apparence</th>
                                    <th>Brix (Pts)</th>
                                    <th>Brix</th>
                                    {canSeeFinancials && <th>PP Fruit</th>}
                                    {canSeeFinancials && <th>GS Net</th>}
                                    <th>Résultat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((exp, i) => (
                                    <tr key={i} onClick={() => exp.source === 'firebase' ? setSelectedExp(exp) : null}
                                        style={{cursor: exp.source === 'firebase' ? 'pointer' : 'default', ...(exp.overallResult === 'REJECT' ? {background:'rgba(229,57,53,0.06)'} : {})}}
                                        onMouseOver={e => { if(exp.source === 'firebase') e.currentTarget.style.background= exp.overallResult === 'REJECT' ? 'rgba(229,57,53,0.12)' : 'rgba(139,34,82,0.04)'; }}
                                        onMouseOut={e => e.currentTarget.style.background= exp.overallResult === 'REJECT' ? 'rgba(229,57,53,0.06)' : ''}>
                                        <td>
                                            <span className={`status-badge ${exp.status === 'Liquidée' ? '' : exp.status === 'PFQ Brix reçu' ? 'active' : (exp.status === 'PFQ Reçu. Attente Brix' || exp.status === 'PFQ reçu') ? 'warning' : exp.status === 'Saisie manuelle' ? 'blue' : 'danger'}`} style={exp.status === 'Rejeté' || exp.overallResult === 'REJECT' ? {background:'#e53935',color:'#fff',fontWeight:700} : exp.status === 'Liquidée' ? {background:'linear-gradient(135deg, #9e9e9e, #bdbdbd)',color:'#fff',fontWeight:700} : exp.status === 'Annulée (doublon)' ? {background:'#757575',color:'#fff',fontWeight:700,textDecoration:'line-through'} : exp.status === 'Saisie manuelle' ? {background:'#e3f2fd',color:'#1565c0',fontWeight:700} : {}}>
                                                {exp.status === 'Rejeté' ? '✕ REJETÉ' : exp.status}
                                            </span>
                                        </td>
                                        <td>{exp.date}</td>
                                        <td style={{fontSize:11}}>{exp.receiptId || '-'}</td>
                                        <td style={{fontSize:11}}>{exp.batchNumber || '-'}</td>
                                        <td><strong>{exp.variete}</strong></td>
                                        <td>{exp.item || '-'}</td>
                                        <td><span style={{padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:'var(--berry-pale)', color:'var(--berry)'}}>{exp.ferme}</span></td>
                                        <td><strong>{exp.colis}</strong></td>
                                        <td>{exp.poids}</td>
                                        <td style={{fontWeight:700}}>{exp.pfqTotal != null ? Math.round(exp.pfqTotal * 100) / 100 : '-'}</td>
                                        <td>{exp.pfqCondition != null ? exp.pfqCondition : '-'}</td>
                                        <td>{exp.pfqApparence != null ? exp.pfqApparence : '-'}</td>
                                        <td>{exp.pfqBrix != null ? Math.round(exp.pfqBrix * 100) / 100 : '-'}</td>
                                        <td>{exp.brix || '-'}</td>
                                        {canSeeFinancials && <td style={{fontWeight:600, color: exp.ppFruit ? 'var(--gray-800)' : 'var(--gray-300)'}}>{exp.ppFruit ? exp.ppFruit.toFixed(2) : '-'}</td>}
                                        {canSeeFinancials && <td style={{fontWeight:700, color: exp.gsNet ? 'var(--green)' : 'var(--gray-300)'}}>{exp.gsNet ? Math.round(exp.gsNet).toLocaleString() : '-'}</td>}
                                        <td>
                                            {exp.overallResult ? (
                                                <span style={{padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:700, display:'inline-block', whiteSpace:'nowrap',
                                                    background: exp.overallResult === 'PASS' ? 'var(--green-pale)' : (exp.overallResult === 'REJECT' ? '#e53935' : 'var(--red-pale)'),
                                                    color: exp.overallResult === 'PASS' ? 'var(--green)' : (exp.overallResult === 'REJECT' ? '#fff' : 'var(--red)')}}>
                                                    {exp.overallResult === 'REJECT' ? '✕ REJECT' : exp.overallResult}
                                                </span>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && !loadingFb && (
                                    <tr><td colSpan={canSeeFinancials ? 16 : 14} style={{textAlign:'center', padding:24, color:'var(--gray-400)', fontSize:13}}>
                                        <i className="fa-solid fa-inbox" style={{fontSize:24, display:'block', marginBottom:8}}></i>
                                        Aucune expédition. Les rapports qualité Driscoll's reçus par email apparaîtront ici automatiquement.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                        </div>
                    </Panel>

                    {/* Rapport Inspection Qualité — style Driscoll's */}
                    {selectedExp && selectedExp.source === 'firebase' && (() => {
                        const _dfr3 = {'Decay':'Pourriture','Decay Mold':'Pourriture','Decay/Mold':'Pourriture','Wet Leaky':'Fruit saignant','Wet/Leaky':'Fruit saignant','Overripe':'Fruit trop mûr','Soft':'Fruit mou','Collapsed':'Fruit mou','Shriveled':'Fruit desséché','Weak Cells':'Cellules blanches','Sooty Mold':'Cladosporium','Yellow Rust':'Rouille jaune','Reversion':'Réversion','Insect/SWD':'Insecte/Drosophile','Wet/Bruising':'Meurtrissure humide','Dry Bruising':'Meurtrissure sèche','Mildew':'Mildiou','Green':'Immature','Size':'Calibre < 3g','Skin Damage':'Dégâts ravageurs','Broken':'Cassé','Malformed':'Déformation','Attached Calyx':'Avec pédoncule','Foreign Bodies':'Corps étrangers','Foreign bodies':'Corps étrangers','Bloom':'Bloom (pruine)','Stem Blossom':'Résidu floral','Condition':'Condition','Appearance':'Apparence'};
                        const trD3 = (n) => _dfr3[n] || n;
                        const _bfr3 = {'BLUE':'Myrtille','RASP':'Framboise','STRAW':'Fraise','BLACK':'Mûre'};
                        const berryFr3 = (t) => { if (!t) return '-'; for (const [k,v] of Object.entries(_bfr3)) if (t.toUpperCase().includes(k)) return v; return t; };
                        return (
                        <div className="modal-overlay" onClick={() => setSelectedExp(null)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto', padding:0, borderRadius:12}}>
                                <div style={{background:'linear-gradient(135deg, #2d0a31 0%, #8B2252 100%)', padding:'20px 24px', color:'#fff', borderRadius:'12px 12px 0 0'}}>
                                    <div style={{fontSize:11, opacity:0.7, letterSpacing:1, marginBottom:4}}>DRISCOLL'S</div>
                                    <div style={{fontSize:20, fontWeight:300, fontStyle:'italic', marginBottom:12}}>Rapport d'Inspection Qualité</div>
                                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                                        <span style={{padding:'4px 16px', borderRadius:6, fontSize:14, fontWeight:700,
                                            background: selectedExp.overallResult === 'PASS' ? '#4caf50' : '#e53935',
                                            color:'#fff'}}>
                                            {selectedExp.overallResult === 'PASS' ? '\u2714 CONFORME' : '\u2718 NON CONFORME'}
                                        </span>
                                        <span style={{fontSize:12, opacity:0.8}}>Inspection Initiale</span>
                                    </div>
                                </div>

                                <div style={{padding:'20px 24px'}}>
                                    {/* Info grid — 2 columns like the report */}
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:0, marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Fruit</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{berryFr3(selectedExp.berryType)}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Variété</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.variete}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Article</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.item || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Ferme</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{selectedExp.ferme}{selectedExp.ranchName ? ` — ${selectedExp.ranchName}` : ''}</div>
                                        </div>
                                        <div style={{display:'grid', gridTemplateColumns:'auto 1fr', borderLeft:'1px solid #e0e0e0'}}>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Reçu</div>
                                            <div style={{padding:'8px 12px', fontSize:12, fontWeight:600, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.receiptId || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>N° Lot</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.batchNumber || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Licence</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.license || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12, borderBottom:'1px solid #e0e0e0'}}>Réception</div>
                                            <div style={{padding:'8px 12px', fontSize:12, borderBottom:'1px solid #e0e0e0'}}>{selectedExp.date || '-'}</div>
                                            <div style={{padding:'8px 12px', background:'#f5f5f5', fontWeight:600, fontSize:12}}>Inspecté</div>
                                            <div style={{padding:'8px 12px', fontSize:12}}>{selectedExp.inspectedDate || '-'}</div>
                                        </div>
                                    </div>

                                    {/* Tableau défauts */}
                                    {selectedExp.conditionDefects && selectedExp.conditionDefects.length > 0 && (
                                        <div style={{marginBottom:20}}>
                                            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                                                <thead>
                                                    <tr style={{background:'#f5f5f5'}}>
                                                        <th style={{padding:'8px 12px', textAlign:'left', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Attribut / Défaut</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Nb Fruits</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>%</th>
                                                        <th style={{padding:'8px 12px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666'}}>Points</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedExp.conditionDefects.map((d, j) => {
                                                        const isSummary = d.name === 'Condition' || d.name === 'Appearance';
                                                        return (
                                                            <tr key={j} style={{background: isSummary ? (d.name === 'Condition' ? '#e8f5e9' : '#fce4ec') : 'transparent'}}>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', fontWeight: isSummary ? 700 : 400}}>{trD3(d.name)}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.count || 0}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.percent != null ? d.percent.toFixed(1) + '%' : '0.0%'}</td>
                                                                <td style={{padding:'6px 12px', borderBottom:'1px solid #f0f0f0', textAlign:'center', fontWeight: isSummary ? 700 : 400}}>{d.points || ''}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* Saveur & Score PFQ */}
                                    <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{background:'linear-gradient(135deg, #ce93d8, #ba68c8)', padding:'8px 16px', textAlign:'center', color:'#fff', fontWeight:700, fontSize:13}}>Saveur & Score PFQ</div>
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:0}}>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Degrés Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'#9C27B0'}}>{selectedExp.brixFromDQR != null ? selectedExp.brixFromDQR : (selectedExp.brix || '-')}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Points Brix</div>
                                                <div style={{fontSize:20, fontWeight:700, color: selectedExp.pfqBrix != null ? '#9C27B0' : '#ccc'}}>{selectedExp.pfqBrix != null ? selectedExp.pfqBrix.toFixed(1) : 'En attente'}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', borderRight:'1px solid #e0e0e0'}}>
                                                <div style={{fontSize:10, color:'#888'}}>Condition + Apparence</div>
                                                <div style={{fontSize:20, fontWeight:700, color:'var(--dark)'}}>{((selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0)).toFixed(1)}</div>
                                                <div style={{fontSize:9, color:'#aaa'}}>{selectedExp.pfqCondition || 0} + {selectedExp.pfqApparence || 0}</div>
                                            </div>
                                            <div style={{textAlign:'center', padding:'10px 6px', background: selectedExp.pfqBrix != null ? 'rgba(76,175,80,0.08)' : 'rgba(255,152,0,0.06)'}}>
                                                <div style={{fontSize:10, color:'#888'}}>PFQ Total</div>
                                                {(() => {
                                                    const total = selectedExp.pfqBrix != null
                                                        ? (selectedExp.pfqCondition || 0) + (selectedExp.pfqApparence || 0) + (selectedExp.pfqBrix || 0)
                                                        : (selectedExp.pfqTotal || null);
                                                    return <div style={{fontSize:20, fontWeight:700, color: total != null ? (total >= 70 ? '#4caf50' : '#e53935') : '#ccc'}}>{total != null ? total.toFixed(1) : '-'}</div>;
                                                })()}
                                                <div style={{fontSize:9, color: selectedExp.pfqBrix != null ? '#4caf50' : '#ff9800'}}>{selectedExp.pfqBrix != null ? 'Brix inclus' : 'Brix en attente'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Batch details table */}
                                    <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:16}}>
                                        <thead>
                                            <tr style={{background:'#f5f5f5'}}>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Lot (kg)</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Qté Lot</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Échantillon</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Moy. Fruits/Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Poids Moy. Barq.</th>
                                                <th style={{padding:'8px 6px', textAlign:'center', borderBottom:'2px solid #e0e0e0', color:'#666', fontSize:11}}>Total Fruits Insp.</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.poids || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.colis || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.sampleSize || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgFruitsPerPunnet || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.avgPunnetWeight || '-'}</td>
                                                <td style={{padding:'10px 6px', textAlign:'center', fontWeight:600}}>{selectedExp.totalFruitInspected || '-'}</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    {/* Bon d'Apport — Photo upload */}
                                    <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                        <div style={{background:'linear-gradient(135deg, #1565c0, #1976d2)', padding:'10px 16px', color:'#fff', fontWeight:700, fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <span><i className="fa-solid fa-file-image" style={{marginRight:8}}></i>Bon d'Apport</span>
                                            <label style={{cursor:'pointer', background:'rgba(255,255,255,0.2)', padding:'4px 12px', borderRadius:6, fontSize:11}}>
                                                <i className="fa-solid fa-camera" style={{marginRight:4}}></i>Ajouter photo
                                                <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={(e) => {
                                                    const file = e.target.files[0];
                                                    if (!file || !selectedExp.id) return;
                                                    const reader = new FileReader();
                                                    reader.onload = () => {
                                                        fetch('/api/email-analysis?action=upload-expedition-photo', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ expeditionId: selectedExp.id, image: reader.result, filename: file.name })
                                                        })
                                                        .then(r => r.json())
                                                        .then(json => {
                                                            if (json.success) {
                                                                alert('Photo uploadée !');
                                                                // Refresh expedition data
                                                                const updatedPhotos = [...(selectedExp.bonApportPhotos || []), { url: json.url, uploadedAt: new Date().toISOString(), filename: file.name }];
                                                                setSelectedExp(prev => ({...prev, bonApportPhotos: updatedPhotos}));
                                                            } else {
                                                                alert('Erreur: ' + (json.error || 'Upload échoué'));
                                                            }
                                                        })
                                                        .catch(err => alert('Erreur upload: ' + err.message));
                                                    };
                                                    reader.readAsDataURL(file);
                                                    e.target.value = '';
                                                }} />
                                            </label>
                                        </div>
                                        {selectedExp.bonApportPhotos && selectedExp.bonApportPhotos.length > 0 ? (
                                            <div style={{display:'flex', flexWrap:'wrap', gap:8, padding:12}}>
                                                {selectedExp.bonApportPhotos.map((photo, idx) => (
                                                    <a key={idx} href={photo.url} target="_blank" rel="noopener noreferrer" style={{display:'block', width:120, height:90, borderRadius:6, overflow:'hidden', border:'1px solid #e0e0e0'}}>
                                                        <img src={photo.url} alt={`Bon d'apport ${idx+1}`} style={{width:'100%', height:'100%', objectFit:'cover'}} />
                                                    </a>
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{padding:'16px', textAlign:'center', color:'#999', fontSize:12}}>
                                                <i className="fa-solid fa-image" style={{fontSize:24, display:'block', marginBottom:6, opacity:0.3}}></i>
                                                Aucune photo. Cliquez sur "Ajouter photo" pour scanner le bon d'apport.
                                            </div>
                                        )}
                                    </div>

                                    {/* Duplicate management */}
                                    {!selectedExp.manualImport && (
                                        <div style={{marginBottom:16, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                            {!selectedExp.duplicateFlag ? (
                                                <button style={{background:'#fff3e0', color:'#e65100', border:'1px solid #ffcc80', padding:'6px 14px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}
                                                    onClick={() => {
                                                        const reason = prompt('Raison du signalement doublon :');
                                                        if (!reason) return;
                                                        fetch('/api/email-analysis?action=update-expedition', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                expeditionId: selectedExp.id,
                                                                updates: {
                                                                    duplicateFlag: true,
                                                                    duplicateRequestedBy: 'Qualité',
                                                                    duplicateRequestedAt: new Date().toISOString(),
                                                                    duplicateReason: reason,
                                                                }
                                                            })
                                                        }).then(r => r.json()).then(json => {
                                                            if (json.success) {
                                                                setSelectedExp(prev => ({...prev, duplicateFlag: true, duplicateReason: reason, duplicateRequestedBy: 'Qualité', duplicateRequestedAt: new Date().toISOString()}));
                                                            }
                                                        });
                                                    }}>
                                                    <i className="fa-solid fa-copy" style={{marginRight:4}}></i>Signaler doublon
                                                </button>
                                            ) : (
                                                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                                                    <span style={{background:'#fff3e0', color:'#e65100', padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:700}}>
                                                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>
                                                        Doublon signalé par {selectedExp.duplicateRequestedBy || 'Qualité'}
                                                    </span>
                                                    <span style={{fontSize:10, color:'#999'}}>{selectedExp.duplicateReason}</span>
                                                    {!selectedExp.duplicateCancelled && (
                                                        <button style={{background:'#e53935', color:'#fff', border:'none', padding:'6px 14px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer'}}
                                                            onClick={() => {
                                                                if (!confirm('Valider l\'annulation de cette expédition (doublon) ? Action DG.')) return;
                                                                fetch('/api/email-analysis?action=update-expedition', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        expeditionId: selectedExp.id,
                                                                        updates: {
                                                                            duplicateCancelled: true,
                                                                            duplicateValidatedBy: 'DG',
                                                                            duplicateValidatedAt: new Date().toISOString(),
                                                                            status: 'Annulée (doublon)',
                                                                        }
                                                                    })
                                                                }).then(r => r.json()).then(json => {
                                                                    if (json.success) {
                                                                        setSelectedExp(prev => ({...prev, duplicateCancelled: true, duplicateValidatedBy: 'DG', status: 'Annulée (doublon)'}));
                                                                    }
                                                                });
                                                            }}>
                                                            <i className="fa-solid fa-check" style={{marginRight:4}}></i>Valider annulation (DG)
                                                        </button>
                                                    )}
                                                    {selectedExp.duplicateCancelled && (
                                                        <span style={{background:'#e53935', color:'#fff', padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:700}}>
                                                            <i className="fa-solid fa-ban" style={{marginRight:4}}></i>Annulée — validé par {selectedExp.duplicateValidatedBy || 'DG'}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Liquidation section — confidentiel: Finance/DG/Admin uniquement */}
                                    {selectedExp.status === 'Liquidée' && canSeeFinancials && (
                                        <div style={{marginBottom:20, border:'1px solid #e0e0e0', borderRadius:8, overflow:'hidden'}}>
                                            <div style={{background:'linear-gradient(135deg, #2e7d32, #43a047)', padding:'10px 16px', color:'#fff', fontWeight:700, fontSize:13, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                <span><i className="fa-solid fa-coins" style={{marginRight:8}}></i>Liquidation{selectedExp.liquidationWeek ? ` — W${selectedExp.liquidationWeek}` : ''}</span>
                                                {selectedExp.liquidationNumber && <span style={{fontSize:11, opacity:0.8}}>{selectedExp.liquidationNumber}</span>}
                                            </div>
                                            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:0}}>
                                                <div style={{padding:'12px 16px', textAlign:'center', borderRight:'1px solid #e0e0e0', borderBottom:'1px solid #e0e0e0'}}>
                                                    <div style={{fontSize:10, color:'#888', marginBottom:2}}>PP Fruit (DH/kg)</div>
                                                    <div style={{fontSize:18, fontWeight:700, color:'var(--gray-800)'}}>{selectedExp.ppFruit ? selectedExp.ppFruit.toFixed(2) : '-'}</div>
                                                </div>
                                                <div style={{padding:'12px 16px', textAlign:'center', borderRight:'1px solid #e0e0e0', borderBottom:'1px solid #e0e0e0'}}>
                                                    <div style={{fontSize:10, color:'#888', marginBottom:2}}>GS Net (DH)</div>
                                                    <div style={{fontSize:18, fontWeight:700, color:'var(--green)'}}>{selectedExp.gsNet ? Math.round(selectedExp.gsNet).toLocaleString() : '-'}</div>
                                                </div>
                                                <div style={{padding:'12px 16px', textAlign:'center', borderBottom:'1px solid #e0e0e0'}}>
                                                    <div style={{fontSize:10, color:'#888', marginBottom:2}}>Prix/kg (DH)</div>
                                                    <div style={{fontSize:18, fontWeight:700, color:'var(--berry)'}}>{selectedExp.pricePerKg ? selectedExp.pricePerKg.toFixed(2) : (selectedExp.gsNet && selectedExp.poids ? (selectedExp.gsNet / selectedExp.poids).toFixed(2) : '-')}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{textAlign:'right'}}>
                                        <button className="btn-secondary" onClick={() => setSelectedExp(null)}>Fermer</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );})()}

                    <button className="fab-btn" onClick={() => setShowModal(true)} title="Nouvelle Expédition">
                        <i className="fa-solid fa-plus"></i>
                    </button>

                    {showModal && (
                        <div className="modal-overlay" onClick={() => setShowModal(false)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                <h2>Nouvelle Expédition</h2>
                                <div className="form-group">
                                    <label>Ferme</label>
                                    <select value={formData.ferme} onChange={(e) => { setFormData(prev => ({...prev, ferme: e.target.value, parcelle: '', variete: ''})); }}>
                                        <option value="F1">F1</option>
                                        <option value="F5">F5</option>
                                        <option value="Avocatier">Avocatier</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Parcelle</label>
                                    <select value={formData.parcelle} onChange={(e) => handleParcelleChange(e.target.value)}>
                                        <option value="">Sélectionner...</option>
                                        {(parcelles[formData.ferme] || []).map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Variété</label>
                                    <input type="text" value={formData.variete} readOnly />
                                </div>
                                <div className="form-group">
                                    <label>Conditionnement</label>
                                    <select value={formData.conditionnement} onChange={(e) => setFormData(prev => ({...prev, conditionnement: e.target.value}))}>
                                        <option value="">Sélectionner...</option>
                                        <option value="12x125g">12x125g</option>
                                        <option value="6x170g">6x170g</option>
                                        <option value="12x170g">12x170g</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>N° Colis</label>
                                    <input type="number" value={formData.colis} onChange={(e) => setFormData(prev => ({...prev, colis: e.target.value}))} />
                                </div>
                                <div className="form-group">
                                    <label>N° Bon d'Apport</label>
                                    <input type="text" value={formData.bonApport} onChange={(e) => setFormData(prev => ({...prev, bonApport: e.target.value}))} />
                                </div>
                                <div className="form-actions">
                                    <button className="btn-primary" onClick={handleSubmit}>Soumettre</button>
                                    <button className="btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        // ===================== QUALITÉ RÉCONCILIATION TAB =====================
        function QualiteReconciliationTab({ data, applyVarietyMapping }) {
            const [liquidations, setLiquidations] = useState([]);
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedFruit, setSelectedFruit] = useState('');

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

            React.useEffect(() => {
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                ]).then(([liqJson, expJson]) => {
                    if (liqJson.success) setLiquidations(liqJson.liquidations.filter(l => l.rows && l.rows.length > 0));
                    if (expJson.success && expJson.expeditions) setExpeditions(expJson.expeditions);
                }).catch(() => {}).finally(() => setLoading(false));
            }, []);

            if (loading) return <div style={{textAlign:'center', padding:60}}><div className="spinner"></div><div style={{marginTop:12, color:'var(--gray-400)'}}>Chargement réconciliation...</div></div>;

            // --- Reconciliation algorithm ---
            const normalizeRid = (rid) => {
                if (!rid) return '';
                let s = String(rid).trim().toUpperCase();
                const m = s.match(/^RID-0*(\d+)$/);
                return m ? m[1] : s;
            };

            // --- Fuzzy matching helpers ---
            const normalizeVariety = (v) => {
                if (!v) return '';
                return String(v).toLowerCase().replace(/[™®\s]/g, '').replace(/sol$/, '');
            };
            const parseDate = (d) => {
                if (!d) return null;
                // Handle MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD, and "MM/DD/YYYY HH:MM GMT"
                const m1 = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (m1) return new Date(parseInt(m1[3]), parseInt(m1[1]) - 1, parseInt(m1[2]));
                const m2 = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
                return null;
            };
            const daysDiff = (d1, d2) => {
                if (!d1 || !d2) return 999;
                return Math.abs(Math.round((d1 - d2) / 86400000));
            };
            const computeFuzzyScore = (liqRow, expRow) => {
                let score = 0;
                const breakdown = { variety: 0, date: 0, pfq: 0, kg: 0 };
                // Variety (40 pts)
                const lv = normalizeVariety(liqRow.variety || liqRow.varietyCode);
                const ev = normalizeVariety(expRow.variety);
                if (lv && ev && (lv === ev || lv.includes(ev) || ev.includes(lv))) {
                    breakdown.variety = 40;
                }
                score += breakdown.variety;
                // Date proximity (25 pts)
                const dd = daysDiff(parseDate(liqRow.date), parseDate(expRow.date));
                breakdown.date = dd === 0 ? 25 : dd <= 1 ? 20 : dd <= 3 ? 15 : dd <= 7 ? 8 : 0;
                score += breakdown.date;
                // PFQ proximity (20 pts) — liq scale ~0-100, exp scale ~0-90
                const lPfq = liqRow.pfqScore;
                const ePfq = expRow.pfq;
                if (lPfq && ePfq) {
                    const lNorm = lPfq / 100;
                    const eNorm = ePfq / 90;
                    breakdown.pfq = Math.round(20 * (1 - Math.abs(lNorm - eNorm)));
                } else {
                    breakdown.pfq = 5; // neutral when missing
                }
                score += breakdown.pfq;
                // Kg proximity (15 pts)
                const lKg = liqRow.receiptQtyKg || 0;
                const eKg = expRow.kg || 0;
                if (lKg > 0 && eKg > 0) {
                    const ratio = Math.min(lKg, eKg) / Math.max(lKg, eKg);
                    breakdown.kg = Math.round(15 * ratio);
                } else {
                    breakdown.kg = 3; // neutral
                }
                score += breakdown.kg;
                return { score, breakdown };
            };
            const fuzzyMatchUnmatched = (unmatchedLiq, unmatchedExp) => {
                if (!unmatchedLiq.length || !unmatchedExp.length) return [];
                // Build all candidate pairs
                const candidates = [];
                unmatchedLiq.forEach((liq, li) => {
                    unmatchedExp.forEach((exp, ei) => {
                        const { score, breakdown } = computeFuzzyScore(liq.row || liq, exp);
                        if (score >= 55) candidates.push({ li, ei, liq, exp, score, breakdown });
                    });
                });
                // Greedy best-first matching
                candidates.sort((a, b) => b.score - a.score);
                const usedLiq = new Set();
                const usedExp = new Set();
                const matches = [];
                candidates.forEach(c => {
                    if (usedLiq.has(c.li) || usedExp.has(c.ei)) return;
                    usedLiq.add(c.li);
                    usedExp.add(c.ei);
                    matches.push(c);
                });
                return matches;
            };

            // Build GLOBAL set of all liquidation receipt IDs
            // First deduplicate liquidations by week (same logic as liquidation tab)
            const liqDedup = {};
            liquidations.forEach(l => {
                if (!l.week) return;
                const fruit = (l.fruit || l.fruitCode || '').toLowerCase();
                if (selectedFruit === 'framboise' && /myrtille|blue/i.test(fruit)) return;
                if (selectedFruit === 'myrtille' && /framboise|rasp/i.test(fruit)) return;
                const ywMatch = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                const year = ywMatch ? parseInt(ywMatch[1]) : 2025;
                const key = `${year}-W${l.week}`;
                const hasFruit = l.fruit && l.fruit !== '?';
                if (!liqDedup[key]) {
                    liqDedup[key] = { l, year };
                } else {
                    const ex = liqDedup[key].l;
                    const exHasFruit = ex.fruit && ex.fruit !== '?';
                    if (hasFruit && !exHasFruit) liqDedup[key] = { l, year };
                    else if (hasFruit === exHasFruit && (l.rows || []).length > (ex.rows || []).length) liqDedup[key] = { l, year };
                }
            });
            const allLiqRidsNorm = new Map();
            const liqByWeek = {};
            Object.entries(liqDedup).forEach(([key, { l, year }]) => {
                if (!liqByWeek[key]) liqByWeek[key] = { week: l.week, year, receiptIds: new Set(), receiptIdsNorm: new Set(), rows: [] };
                (l.rows || []).forEach(r => {
                    if (r.receiptId) {
                        liqByWeek[key].receiptIds.add(r.receiptId);
                        const norm = normalizeRid(r.receiptId);
                        liqByWeek[key].receiptIdsNorm.add(norm);
                        allLiqRidsNorm.set(norm, { originalId: r.receiptId, week: l.week, year });
                    }
                    liqByWeek[key].rows.push(r);
                });
            });

            // Build GLOBAL set of all expedition receipt IDs
            const allExpRidsNorm = new Map();
            const expByWeekRec = {};
            expeditions.filter(e => e.overallResult !== 'REJECT' && e.status !== 'Annulée (doublon)').forEach(e => {
                const w = getISOWeek(e.date);
                const y = getISOYear(e.date);
                if (!w || !y) return;
                const key = `${y}-W${w}`;
                if (!expByWeekRec[key]) expByWeekRec[key] = [];
                const pfqCond = e.conditionPoints || 0;
                const pfqApp = e.appearancePoints || 0;
                const pfqTotal = (pfqCond + pfqApp) || null;
                const exp = {
                    receiptId: e.receiptId,
                    receiptIdNorm: normalizeRid(e.receiptId),
                    variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety,
                    kg: e.batchWeight || 0,
                    date: e.date,
                    ferme: e.ranch === '200742' ? 'F1' : e.ranch === '200876' ? 'F5' : e.ranch || '-',
                    status: e.status,
                    id: e.id,
                    pfq: pfqTotal,
                    brix: e.brixValue || null,
                    overallResult: e.overallResult,
                };
                expByWeekRec[key].push(exp);
                allExpRidsNorm.set(exp.receiptIdNorm, { exp, week: w, year: y });
            });

            // Smart bidirectional matching per liquidated week
            const reconciliation = Object.entries(liqByWeek).map(([key, liq]) => {
                const [yearStr, weekStr] = key.split('-W');
                const yr = parseInt(yearStr);
                const wk = parseInt(weekStr);

                // Pool: same week + adjacent weeks expeditions for display
                const adjacentKeys = [
                    key,
                    `${wk === 1 ? yr - 1 : yr}-W${wk === 1 ? 52 : wk - 1}`,
                    `${wk === 52 ? yr + 1 : yr}-W${wk === 52 ? 1 : wk + 1}`,
                ];
                const poolExps = adjacentKeys.flatMap(k => expByWeekRec[k] || []);
                const sameWeekExps = expByWeekRec[key] || [];

                // === LIQ PERSPECTIVE: for each liq receipt ID, find matching expedition GLOBALLY ===
                const liqMatchResults = [...liq.receiptIdsNorm].map(norm => {
                    const expMatch = allExpRidsNorm.get(norm);
                    const orig = [...liq.receiptIds].find(r => normalizeRid(r) === norm);
                    const row = liq.rows.find(r => normalizeRid(r.receiptId) === norm);
                    return { norm, orig: orig || norm, row, matched: !!expMatch, expMatch };
                });
                const liqMatched = liqMatchResults.filter(r => r.matched).length;
                const liqUnmatched = liqMatchResults.filter(r => !r.matched);

                // === EXP PERSPECTIVE: for each same-week expedition, check if in ANY liquidation ===
                const expMatchResults = sameWeekExps.map(e => ({
                    ...e,
                    matchedInThisLiq: liq.receiptIdsNorm.has(e.receiptIdNorm),
                    matchedInAnyLiq: allLiqRidsNorm.has(e.receiptIdNorm),
                }));
                const expNotInAnyLiq = expMatchResults.filter(e => !e.matchedInAnyLiq);

                // === KG TOTALS for matched receipts ===
                // Aggregate liq kg per unique receipt ID (sum grade splits)
                const liqKgByRid = {};
                (liq.rows || []).forEach(r => {
                    if (!r.receiptId) return;
                    const norm = normalizeRid(r.receiptId);
                    if (!liqKgByRid[norm]) liqKgByRid[norm] = 0;
                    liqKgByRid[norm] += (r.receiptQtyKg || 0);
                });

                // === FUZZY MATCHING for unmatched items ===
                const fuzzyMatches = fuzzyMatchUnmatched(liqUnmatched, expNotInAnyLiq);
                const fuzzyMatchedLiqNorms = new Set(fuzzyMatches.map(fm => fm.liq.norm));
                const fuzzyMatchedExpNorms = new Set(fuzzyMatches.map(fm => fm.exp.receiptIdNorm));

                // === SCORE: based on liq coverage (exact + fuzzy) ===
                const totalLiq = liq.receiptIdsNorm.size;
                const totalExp = sameWeekExps.length;
                const matchScore = totalLiq > 0 ? Math.round((liqMatched + fuzzyMatches.length) / totalLiq * 100) : (totalExp > 0 ? 0 : null);

                // Extra in liq = liq RIDs with NO matching expedition (excluding fuzzy matches)
                const extraInLiq = liqUnmatched.filter(u => !fuzzyMatchedLiqNorms.has(u.norm)).map(u => ({
                    receiptId: u.orig,
                    variety: u.row ? u.row.variety : 'Inconnue',
                    kg: liqKgByRid[u.norm] || (u.row ? (u.row.receiptQtyKg || 0) : 0),
                    week: liq.week, year: liq.year,
                }));

                // Missing from liq = same-week expeditions not in ANY liquidation (excluding fuzzy matches)
                const missingFromLiq = expNotInAnyLiq.filter(e => !fuzzyMatchedExpNorms.has(e.receiptIdNorm)).map(e => ({
                    receiptId: e.receiptId, variety: e.variety, kg: e.kg,
                    ferme: e.ferme, date: e.date, id: e.id,
                }));
                let matchedLiqKg = 0, matchedExpKg = 0, totalLiqKg = 0;
                Object.entries(liqKgByRid).forEach(([norm, kg]) => {
                    totalLiqKg += kg;
                    const expMatch = allExpRidsNorm.get(norm);
                    if (expMatch) {
                        matchedLiqKg += kg;
                        matchedExpKg += (expMatch.exp.kg || 0);
                    }
                });
                const totalExpKg = sameWeekExps.reduce((s, e) => s + (e.kg || 0), 0);

                // Add fuzzy-matched kg to totals
                fuzzyMatches.forEach(fm => {
                    const lKg = liqKgByRid[fm.liq.norm] || (fm.liq.row ? fm.liq.row.receiptQtyKg || 0 : 0);
                    matchedLiqKg += lKg;
                    matchedExpKg += (fm.exp.kg || 0);
                });

                return {
                    key, week: liq.week, year: liq.year,
                    totalExp, totalLiq, liqMatched,
                    missingFromLiq, extraInLiq, fuzzyMatches,
                    matchScore, missingKg: missingFromLiq.reduce((s, e) => s + e.kg, 0),
                    sameWeekExps: poolExps, liqRows: liq.rows,
                    liqMatchResults, expMatchResults,
                    matchedLiqKg, matchedExpKg, totalLiqKg, totalExpKg,
                };
            }).filter(r => r.matchScore !== null).sort((a, b) => {
                if (b.year !== a.year) return b.year - a.year;
                return b.week - a.week;
            });

            const totalMissing = reconciliation.reduce((s, r) => s + r.missingFromLiq.length, 0);
            const totalExtra = reconciliation.reduce((s, r) => s + r.extraInLiq.length, 0);
            const totalFuzzy = reconciliation.reduce((s, r) => s + r.fuzzyMatches.length, 0);
            const avgScore = reconciliation.length > 0 ? Math.round(reconciliation.reduce((s, r) => s + (r.matchScore || 0), 0) / reconciliation.length) : 0;
            const grandMatchedLiqKg = reconciliation.reduce((s, r) => s + (r.matchedLiqKg || 0), 0);
            const grandMatchedExpKg = reconciliation.reduce((s, r) => s + (r.matchedExpKg || 0), 0);
            const grandTotalLiqKg = reconciliation.reduce((s, r) => s + (r.totalLiqKg || 0), 0);
            const grandTotalExpKg = reconciliation.reduce((s, r) => s + (r.totalExpKg || 0), 0);
            // True total of ALL expeditions (including weeks without liquidation)
            const allExpKgTotal = Object.values(expByWeekRec).flat().reduce((s, e) => s + (e.kg || 0), 0);
            const expKgHorsRecon = allExpKgTotal - grandTotalExpKg;
            const kgRatio = grandMatchedExpKg > 0 ? (grandMatchedLiqKg / grandMatchedExpKg) : 0;

            // Non-liquidated weeks
            const allExpWeeks = Object.keys(expByWeekRec);
            const allLiqWeeks = new Set(Object.keys(liqByWeek));
            const nonLiquidatedWeeks = allExpWeeks.filter(k => !allLiqWeeks.has(k)).sort((a, b) => {
                const [ya, wa] = a.split('-W').map(Number);
                const [yb, wb] = b.split('-W').map(Number);
                return yb !== ya ? yb - ya : wb - wa;
            });

            return (
                <div>
                    {/* Header stats */}
                    <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:16, marginBottom:16}}>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color:'var(--green)'}}>{avgScore}%</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Score moyen</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color:'var(--dark)'}}>{reconciliation.length}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Semaines liquidées</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color: totalFuzzy > 0 ? '#7b1fa2' : '#4caf50'}}>{totalFuzzy}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Matchs fuzzy</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color: totalMissing > 0 ? '#e65100' : '#4caf50'}}>{totalMissing}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Expéd. non liquidées</div>
                        </div>
                        <div style={{background:'var(--card-bg)', borderRadius:12, padding:20, textAlign:'center', boxShadow:'var(--shadow-sm)'}}>
                            <div style={{fontSize:28, fontWeight:700, color: totalExtra > 0 ? '#1565c0' : '#4caf50'}}>{totalExtra}</div>
                            <div style={{fontSize:11, color:'var(--gray-400)', marginTop:4}}>Liq. sans expédition</div>
                        </div>
                    </div>
                    {/* Kg comparison panel */}
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:24}}>
                        <div style={{background:'linear-gradient(135deg, #e3f2fd, #bbdefb)', borderRadius:12, padding:20, textAlign:'center'}}>
                            <div style={{fontSize:11, fontWeight:600, color:'#1565c0', textTransform:'uppercase', marginBottom:6}}>Liquidation (Receipt Qty)</div>
                            <div style={{fontSize:24, fontWeight:700, color:'#0d47a1'}}>{Math.round(grandMatchedLiqKg).toLocaleString('fr-FR')} kg</div>
                            <div style={{fontSize:11, color:'#1976d2', marginTop:4}}>Total sem. liquidées: {Math.round(grandTotalLiqKg).toLocaleString('fr-FR')} kg</div>
                        </div>
                        <div style={{background:'linear-gradient(135deg, #e8f5e9, #c8e6c9)', borderRadius:12, padding:20, textAlign:'center'}}>
                            <div style={{fontSize:11, fontWeight:600, color:'#2e7d32', textTransform:'uppercase', marginBottom:6}}>Expédition (Batch Weight)</div>
                            <div style={{fontSize:24, fontWeight:700, color:'#1b5e20'}}>{Math.round(grandMatchedExpKg).toLocaleString('fr-FR')} kg</div>
                            <div style={{fontSize:11, color:'#388e3c', marginTop:4}}>Total toutes exp: {Math.round(allExpKgTotal).toLocaleString('fr-FR')} kg</div>
                            {expKgHorsRecon > 0 && <div style={{fontSize:10, color:'#e65100', marginTop:2}}>{Math.round(expKgHorsRecon).toLocaleString('fr-FR')} kg hors réconciliation (sem. sans liquidation)</div>}
                        </div>
                        <div style={{background:'linear-gradient(135deg, #fff3e0, #ffe0b2)', borderRadius:12, padding:20, textAlign:'center'}}>
                            <div style={{fontSize:11, fontWeight:600, color:'#e65100', textTransform:'uppercase', marginBottom:6}}>Écart (matchés)</div>
                            <div style={{fontSize:24, fontWeight:700, color:'#bf360c'}}>{Math.round(grandMatchedLiqKg - grandMatchedExpKg).toLocaleString('fr-FR')} kg</div>
                            <div style={{fontSize:11, color:'#e65100', marginTop:4}}>Ratio Liq/Exp: {kgRatio.toFixed(2)}x</div>
                        </div>
                    </div>

                    {/* Culture filter */}
                    <div className="chip-group" style={{marginBottom:20}}>
                        <span className="chip-group-label">Culture :</span>
                        {['', 'framboise', 'myrtille'].map(f => (
                            <button key={f} className={`chip ${f === 'myrtille' ? 'c-indigo' : 'c-berry'} ${selectedFruit === f ? 'active' : ''}`} onClick={() => setSelectedFruit(f)}>
                                {f === '' ? 'Toutes' : f === 'framboise' ? '🍓 Framboise' : '🫐 Myrtille'}
                            </button>
                        ))}
                    </div>

                    {/* Main reconciliation table */}
                    <Panel title="Réconciliation par semaine" icon="fa-scale-balanced" actions={
                        totalMissing > 0 ? <span style={{background:'#fff3e0', color:'#e65100', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>
                            {totalMissing} expédition{totalMissing > 1 ? 's' : ''} non liquidée{totalMissing > 1 ? 's' : ''}
                        </span> : <span style={{background:'rgba(76,175,80,0.1)', color:'#2e7d32', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>Tout est réconcilié</span>
                    }>
                        <table className="data-table" style={{fontSize:12}}>
                            <thead>
                                <tr>
                                    <th>Semaine</th>
                                    <th>Expéd.</th>
                                    <th>Liq. RIDs</th>
                                    <th>Exact</th>
                                    <th>Fuzzy</th>
                                    <th>Score</th>
                                    <th style={{textAlign:'right'}}>Liq kg</th>
                                    <th style={{textAlign:'right'}}>Exp kg</th>
                                    <th style={{textAlign:'right'}}>Écart kg</th>
                                    <th>Non liquidées</th>
                                    <th>Sans expédition</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reconciliation.map(r => {
                                    const scoreColor = r.matchScore >= 100 ? '#4caf50' : r.matchScore >= 90 ? '#ff9800' : '#e53935';
                                    return (
                                        <React.Fragment key={r.key}>
                                        <tr style={r.missingFromLiq.length > 0 || r.extraInLiq.length > 0 ? {background:'rgba(255,152,0,0.04)'} : {}}>
                                            <td><span style={{fontWeight:700}}>W{r.week}-{String(r.year).slice(-2)}</span></td>
                                            <td>{r.totalExp}</td>
                                            <td>{r.totalLiq}</td>
                                            <td>{r.liqMatched}/{r.totalLiq}</td>
                                            <td>
                                                {r.fuzzyMatches.length > 0 ? (
                                                    <span style={{background:'rgba(156,39,176,0.1)', color:'#7b1fa2', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                        {r.fuzzyMatches.length} <i className="fa-solid fa-link" style={{fontSize:9}}></i>
                                                    </span>
                                                ) : <span style={{color:'var(--gray-400)', fontSize:11}}>-</span>}
                                            </td>
                                            <td>
                                                <div style={{display:'flex', alignItems:'center', gap:6}}>
                                                    <div style={{width:60, height:8, background:'#e0e0e0', borderRadius:4, overflow:'hidden', display:'flex'}}>
                                                        <div style={{width:`${r.totalLiq > 0 ? Math.min(r.liqMatched / r.totalLiq * 100, 100) : 0}%`, height:'100%', background:'#4caf50'}}></div>
                                                        <div style={{width:`${r.totalLiq > 0 ? Math.min(r.fuzzyMatches.length / r.totalLiq * 100, 100) : 0}%`, height:'100%', background:'#9c27b0'}}></div>
                                                    </div>
                                                    <span style={{fontWeight:700, color:scoreColor, fontSize:12}}>{r.matchScore}%</span>
                                                </div>
                                            </td>
                                            <td style={{textAlign:'right', fontWeight:600, color:'#1565c0'}}>{Math.round(r.matchedLiqKg).toLocaleString('fr-FR')}</td>
                                            <td style={{textAlign:'right', fontWeight:600, color:'#2e7d32'}}>{Math.round(r.matchedExpKg).toLocaleString('fr-FR')}</td>
                                            <td style={{textAlign:'right', fontWeight:700, color: (r.matchedLiqKg - r.matchedExpKg) > 0 ? '#e65100' : '#2e7d32'}}>
                                                {Math.round(r.matchedLiqKg - r.matchedExpKg).toLocaleString('fr-FR')}
                                                {r.matchedExpKg > 0 && <span style={{fontSize:10, fontWeight:400, color:'var(--gray-400)', marginLeft:4}}>({(r.matchedLiqKg / r.matchedExpKg).toFixed(1)}x)</span>}
                                            </td>
                                            <td>
                                                {r.missingFromLiq.length > 0 ? (
                                                    <span style={{background:'#fff3e0', color:'#e65100', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                        {r.missingFromLiq.length} ({Math.round(r.missingKg)} kg)
                                                    </span>
                                                ) : <span style={{color:'#4caf50', fontWeight:600}}>OK</span>}
                                            </td>
                                            <td>
                                                {r.extraInLiq.length > 0 ? (
                                                    <span style={{background:'rgba(33,150,243,0.1)', color:'#1565c0', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                        {r.extraInLiq.length}
                                                    </span>
                                                ) : <span style={{color:'#4caf50', fontWeight:600}}>OK</span>}
                                            </td>
                                        </tr>
                                        {/* Detail rows for issues and fuzzy matches */}
                                        {(r.missingFromLiq.length > 0 || r.extraInLiq.length > 0 || r.fuzzyMatches.length > 0) && (
                                            <tr style={{background:'rgba(0,0,0,0.02)'}}>
                                                <td colSpan={11} style={{padding:'8px 16px'}}>
                                                    <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                                                        {r.fuzzyMatches.map((fm, i) => (
                                                            <span key={'fm'+i} style={{display:'inline-flex', alignItems:'center', gap:4, background:'rgba(156,39,176,0.1)', padding:'3px 8px', borderRadius:6, fontSize:11, color:'#7b1fa2', fontWeight:600}}>
                                                                <i className="fa-solid fa-link" style={{marginRight:2, fontSize:9}}></i>
                                                                {fm.liq.orig} ↔ {fm.exp.receiptId}
                                                                <span style={{fontSize:10, opacity:0.8}}>({fm.liq.row ? fm.liq.row.variety : '?'} / {fm.exp.variety})</span>
                                                                <span style={{background:'#7b1fa2', color:'#fff', borderRadius:4, padding:'1px 5px', fontSize:9, fontWeight:700}}>{fm.score}%</span>
                                                                <span style={{fontSize:9, color:'#9c27b0', opacity:0.7}} title={`Variété:${fm.breakdown.variety} Date:${fm.breakdown.date} PFQ:${fm.breakdown.pfq} Kg:${fm.breakdown.kg}`}>
                                                                    V{fm.breakdown.variety} D{fm.breakdown.date} P{fm.breakdown.pfq} K{fm.breakdown.kg}
                                                                </span>
                                                            </span>
                                                        ))}
                                                        {r.missingFromLiq.map((e, i) => (
                                                            <span key={i} style={{display:'inline-block', background:'rgba(255,152,0,0.12)', padding:'3px 8px', borderRadius:6, fontSize:11, color:'#e65100', fontWeight:600}}>
                                                                <i className="fa-solid fa-triangle-exclamation" style={{marginRight:3, fontSize:9}}></i>
                                                                {e.receiptId} — {e.variety} — {Math.round(e.kg)}kg
                                                            </span>
                                                        ))}
                                                        {r.extraInLiq.map((extra, i) => (
                                                            <span key={'x'+i} style={{display:'inline-flex', alignItems:'center', gap:4, background:'rgba(33,150,243,0.1)', padding:'3px 8px', borderRadius:6, fontSize:11, color:'#1565c0', fontWeight:600}}>
                                                                <i className="fa-solid fa-circle-question" style={{marginRight:3, fontSize:9}}></i>
                                                                {extra.receiptId} — {extra.variety} — {Math.round(extra.kg)}kg
                                                                <button style={{background:'#1976d2', color:'#fff', border:'none', borderRadius:4, padding:'2px 8px', fontSize:10, cursor:'pointer', fontWeight:700, marginLeft:4}}
                                                                    onClick={() => {
                                                                        if (!confirm(`Importer l'expédition ${extra.receiptId} (${extra.variety}, ${Math.round(extra.kg)}kg) ?`)) return;
                                                                        fetch('/api/email-analysis?action=create-manual-expedition', {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ receiptId: extra.receiptId, variety: extra.variety, kg: extra.kg, week: extra.week, year: extra.year, fruit: selectedFruit || 'framboise', source: 'import-liquidation' })
                                                                        }).then(r2 => r2.json()).then(json => {
                                                                            if (json.success) { alert(`Expédition ${extra.receiptId} importée !`); window.location.reload(); }
                                                                            else alert('Erreur: ' + (json.error || 'Echec'));
                                                                        }).catch(err => alert('Erreur: ' + err.message));
                                                                    }}>
                                                                    <i className="fa-solid fa-plus" style={{marginRight:2}}></i>Importer
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{marginTop:8, fontSize:10, color:'var(--gray-400)', fontStyle:'italic'}}>
                            Matching intelligent : comparaison normalisée des Receipt IDs + semaines adjacentes + global. Expéditions REJECT et annulées exclues.
                        </div>
                    </Panel>

                    {/* Non-liquidated weeks overview */}
                    {nonLiquidatedWeeks.length > 0 && (
                        <Panel title={`Semaines non liquidées (${nonLiquidatedWeeks.length})`} icon="fa-hourglass-half">
                            <table className="data-table" style={{fontSize:12}}>
                                <thead>
                                    <tr>
                                        <th>Semaine</th>
                                        <th>Expéditions</th>
                                        <th>Total kg</th>
                                        <th>Variétés</th>
                                        <th>Statut</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {nonLiquidatedWeeks.map(wKey => {
                                        const exps = expByWeekRec[wKey] || [];
                                        const totalKg = exps.reduce((s, e) => s + e.kg, 0);
                                        const varieties = [...new Set(exps.map(e => e.variety))].join(', ');
                                        const [y, w] = wKey.split('-W');
                                        return (
                                            <tr key={wKey}>
                                                <td><span style={{fontWeight:700}}>W{w}-{String(y).slice(-2)}</span></td>
                                                <td>{exps.length}</td>
                                                <td>{Math.round(totalKg).toLocaleString()} kg</td>
                                                <td style={{fontSize:11}}>{varieties}</td>
                                                <td><span style={{background:'#fff3e0', color:'#e65100', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>En attente</span></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </Panel>
                    )}

                    {/* Detailed reconciliation per week */}
                    {reconciliation.length > 0 && (
                        <Panel title="Détail des écarts" icon="fa-magnifying-glass-chart">
                            {reconciliation.map(r => {
                                // Detect likely duplicates in expeditions:
                                // Same variety + same kg appearing 2+ times, but liquidation has only 1 match
                                const expDupMap = {};
                                r.sameWeekExps.forEach(e => {
                                    const dupKey = `${e.variety}_${Math.round(e.kg)}`;
                                    if (!expDupMap[dupKey]) expDupMap[dupKey] = [];
                                    expDupMap[dupKey].push(e);
                                });
                                const likelyDuplicates = new Set();
                                Object.values(expDupMap).forEach(group => {
                                    if (group.length >= 2) {
                                        // Count how many times this RID appears in liquidation
                                        const liqCount = group.filter(e => r.liqMatchResults.some(m => m.norm === e.receiptIdNorm)).length;
                                        // If liquidation has fewer matches than expeditions with same kg+variety, flag extras
                                        if (liqCount < group.length) {
                                            group.slice(liqCount || 1).forEach(e => likelyDuplicates.add(e.id));
                                        }
                                    }
                                });

                                // Aggregate liquidation rows by receiptId (sum kg for same RID)
                                const liqAggregated = {};
                                r.liqRows.filter(row => row.receiptId).forEach(row => {
                                    const norm = normalizeRid(row.receiptId);
                                    if (!liqAggregated[norm]) {
                                        liqAggregated[norm] = { ...row, receiptQtyKg: row.receiptQtyKg || 0, pfqScore: row.pfqScore || null, count: 1 };
                                    } else {
                                        liqAggregated[norm].receiptQtyKg += (row.receiptQtyKg || 0);
                                        if (row.pfqScore && !liqAggregated[norm].pfqScore) liqAggregated[norm].pfqScore = row.pfqScore;
                                        liqAggregated[norm].count++;
                                    }
                                });
                                const liqRowsAgg = Object.values(liqAggregated);

                                return (
                                <div key={r.key} style={{marginBottom:24}}>
                                    <h4 style={{margin:'0 0 8px', fontSize:14, color:'var(--dark)'}}>
                                        <span style={{fontWeight:700}}>W{r.week}-{String(r.year).slice(-2)}</span>
                                        <span style={{fontSize:11, color: r.matchScore >= 100 ? '#4caf50' : r.matchScore >= 90 ? '#ff9800' : '#e53935', marginLeft:8}}>Score: {r.matchScore}%</span>
                                    </h4>
                                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
                                        {/* Expeditions (same week + adjacent) */}
                                        <div>
                                            <div style={{fontSize:11, fontWeight:700, color:'var(--gray-500)', marginBottom:6}}>Expéditions (W{r.week} ± 1)</div>
                                            <table style={{width:'100%', fontSize:11, borderCollapse:'collapse'}}>
                                                <thead><tr style={{background:'#f5f5f5'}}>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Receipt ID</th>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Variété</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>Kg</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>PFQ</th>
                                                    <th style={{padding:'4px 8px', textAlign:'center'}}>Dans Liq</th>
                                                </tr></thead>
                                                <tbody>
                                                    {r.sameWeekExps.map((e, i) => {
                                                        const inThisLiq = r.liqMatchResults.some(m => m.norm === e.receiptIdNorm);
                                                        const inAnyLiq = allLiqRidsNorm.has(e.receiptIdNorm);
                                                        const isDup = likelyDuplicates.has(e.id);
                                                        return (
                                                            <tr key={i} style={{background: isDup ? 'rgba(255,152,0,0.12)' : inThisLiq ? 'rgba(76,175,80,0.05)' : inAnyLiq ? 'rgba(33,150,243,0.05)' : 'rgba(255,152,0,0.05)'}}>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', fontWeight:600}}>
                                                                    {e.receiptId}
                                                                    {isDup && <span style={{color:'#ff9800', fontSize:9, marginLeft:4}} title="Doublon probable: même variété et même poids qu'une autre expédition">DOUBLON?</span>}
                                                                </td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0'}}>{e.variety}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right'}}>{Math.round(e.kg)}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right', color: e.pfq ? (e.pfq >= 70 ? '#4caf50' : '#ff9800') : 'var(--gray-400)'}}>
                                                                    {e.pfq ? e.pfq + '/90' : '-'}
                                                                    {e.brix ? <span style={{fontSize:9, color:'#9C27B0', marginLeft:2}}>B{e.brix}</span> : ''}
                                                                </td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'center'}}>
                                                                    {inThisLiq ? <i className="fa-solid fa-check" style={{color:'#4caf50'}}></i> : inAnyLiq ? <span style={{fontSize:9, color:'#1976d2'}}>autre sem.</span> : <i className="fa-solid fa-xmark" style={{color:'#e53935'}}></i>}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        {/* Liquidation rows (aggregated by receipt ID) */}
                                        <div>
                                            <div style={{fontSize:11, fontWeight:700, color:'var(--gray-500)', marginBottom:6}}>Liquidation (semaine {r.week})</div>
                                            <table style={{width:'100%', fontSize:11, borderCollapse:'collapse'}}>
                                                <thead><tr style={{background:'#f5f5f5'}}>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Receipt ID</th>
                                                    <th style={{padding:'4px 8px', textAlign:'left'}}>Variété</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>Kg</th>
                                                    <th style={{padding:'4px 8px', textAlign:'right'}}>PFQ</th>
                                                    <th style={{padding:'4px 8px', textAlign:'center'}}>Match</th>
                                                </tr></thead>
                                                <tbody>
                                                    {liqRowsAgg.map((row, i) => {
                                                        const norm = normalizeRid(row.receiptId);
                                                        const isMatched = allExpRidsNorm.has(norm);
                                                        return (
                                                            <tr key={i} style={{background: isMatched ? 'rgba(76,175,80,0.05)' : 'rgba(33,150,243,0.05)'}}>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', fontWeight:600}}>{row.receiptId}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0'}}>{row.variety || '-'}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right'}}>{Math.round(row.receiptQtyKg)}</td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'right', color: row.pfqScore ? (row.pfqScore >= 70 ? '#4caf50' : '#ff9800') : 'var(--gray-400)'}}>
                                                                    {row.pfqScore ? row.pfqScore.toFixed(1) : '-'}
                                                                </td>
                                                                <td style={{padding:'3px 8px', borderBottom:'1px solid #f0f0f0', textAlign:'center'}}>
                                                                    {isMatched ? <i className="fa-solid fa-check" style={{color:'#4caf50'}}></i> : <i className="fa-solid fa-xmark" style={{color:'#1565c0'}}></i>}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                                );
                            })}
                        </Panel>
                    )}
                </div>
            );
        }

        // ===================== QUALITÉ LIQUIDATIONS TAB =====================
        function QualiteLiquidationsTab({ data, applyVarietyMapping, compactView }) {
            const [liquidations, setLiquidations] = useState([]);
            const [expeditions, setExpeditions] = useState([]);
            const [bonsApport, setBonsApport] = useState([]);
            const [loading, setLoading] = useState(true);
            const [selectedLiq, setSelectedLiq] = useState(null);
            const [selectedFerme, setSelectedFerme] = useState('');
            const [selectedVariete, setSelectedVariete] = useState('');
            const [selectedFruit, setSelectedFruit] = useState('');
            const [chartVariete, setChartVariete] = useState('');
            const [popupWeek, setPopupWeek] = useState(null); // { week, year }
            const [kpiDetailPopup, setKpiDetailPopup] = useState(null); // 'gsnet' | 'qty' | null
            const [forecastsByFruit, setForecastsByFruit] = useState({ framboise: {}, myrtille: {} }); // { framboise: { week: {minMad,maxMad,avgMad,year,updatedAt} } }
            const [forecastModal, setForecastModal] = useState(null); // { fruitCode, year, step, file, imageB64, mediaType, weeks, loading, error }
            const [privateMode, setPrivateMode] = useState(false); // Masque toutes les valeurs monétaires (CA, GS Net, commissions) pour démos partenaires

            // ISO week number helper
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

            React.useEffect(() => {
                const yr = new Date().getFullYear();
                Promise.all([
                    cachedFetch('/api/email-analysis?action=liquidations'),
                    cachedFetch('/api/email-analysis?action=expeditions&limit=2000'),
                    cachedFetch('/api/email-analysis?action=liquidation-forecast-list&year=' + yr),
                ]).then(([liqJson, expJson, fcJson]) => {
                    if (liqJson.success) setLiquidations(liqJson.liquidations.filter(l => l.rows && l.rows.length > 0));
                    if (expJson.success && expJson.expeditions) setExpeditions(expJson.expeditions);
                    if (fcJson && fcJson.success) {
                        const byFruit = { framboise: {}, myrtille: {} };
                        (fcJson.forecasts || []).forEach(f => {
                            const k = f.fruit;
                            if (!byFruit[k]) byFruit[k] = {};
                            Object.entries(f.weeks || {}).forEach(([w, v]) => {
                                byFruit[k][w] = { ...v, year: f.year, updatedAt: f.updatedAt };
                            });
                        });
                        setForecastsByFruit(byFruit);
                    }
                }).catch(() => {}).finally(() => setLoading(false));
                loadBonsFromFirestore().then(bons => setBonsApport(bons)).catch(() => {});
            }, []);

            // Forecast lookup helper: returns avg MAD/kg for (fruit, week) or null
            const getForecastPrice = (fruit, week) => {
                const f = (fruit || '').toLowerCase();
                const w = String(week);
                const entry = forecastsByFruit?.[f]?.[w];
                return entry && Number.isFinite(entry.avgMad) ? entry.avgMad : null;
            };

            // File → base64 helper
            const fileToBase64 = (file) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const openForecastImport = (fruitCode) => {
                setForecastModal({ fruitCode: fruitCode || 'RASP', year: new Date().getFullYear(), step: 'pick', file: null, imageB64: null, mediaType: null, weeks: [], loading: false, error: null });
            };

            const handleForecastFile = async (file) => {
                if (!file) return;
                setForecastModal(m => ({ ...m, file, loading: true, error: null }));
                try {
                    const dataUrl = await fileToBase64(file);
                    const mediaType = file.type || 'image/png';
                    setForecastModal(m => ({ ...m, imageB64: dataUrl, mediaType, loading: false, step: 'ready' }));
                } catch (e) {
                    setForecastModal(m => ({ ...m, loading: false, error: 'Lecture du fichier impossible' }));
                }
            };

            const runForecastExtract = async () => {
                setForecastModal(m => ({ ...m, loading: true, error: null }));
                try {
                    const m0 = forecastModal;
                    const resp = await fetch('/api/email-analysis?action=liquidation-forecast-extract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fruitCode: m0.fruitCode, imageBase64: m0.imageB64, mediaType: m0.mediaType }),
                    });
                    const j = await resp.json();
                    if (!j.success) throw new Error(j.error || 'Extraction échouée');
                    const yr = (j.weeks && j.weeks[0] && j.weeks[0].year) || m0.year;
                    setForecastModal(m => ({ ...m, loading: false, step: 'review', weeks: j.weeks || [], year: yr }));
                } catch (e) {
                    setForecastModal(m => ({ ...m, loading: false, error: e.message || 'Erreur extraction' }));
                }
            };

            const saveForecast = async () => {
                setForecastModal(m => ({ ...m, loading: true, error: null }));
                try {
                    const m0 = forecastModal;
                    const cleanWeeks = (m0.weeks || [])
                        .map(w => ({ week: parseInt(w.week), minMad: parseFloat(w.minMad), maxMad: parseFloat(w.maxMad) }))
                        .filter(w => Number.isFinite(w.week) && Number.isFinite(w.minMad) && Number.isFinite(w.maxMad));
                    if (cleanWeeks.length === 0) throw new Error('Aucune semaine valide à enregistrer');
                    const resp = await fetch('/api/email-analysis?action=liquidation-forecast-save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fruitCode: m0.fruitCode, year: m0.year, weeks: cleanWeeks, imageBase64: m0.imageB64, mediaType: m0.mediaType }),
                    });
                    const j = await resp.json();
                    if (!j.success) throw new Error(j.error || 'Sauvegarde échouée');
                    // Reload forecasts (bypass cache)
                    try { invalidateCache('/api/email-analysis?action=liquidation-forecast-list'); } catch(_) {}
                    const fcResp = await fetch('/api/email-analysis?action=liquidation-forecast-list&year=' + m0.year);
                    const fcJson = await fcResp.json();
                    if (fcJson && fcJson.success) {
                        const byFruit = { framboise: {}, myrtille: {} };
                        (fcJson.forecasts || []).forEach(f => {
                            const k = f.fruit;
                            if (!byFruit[k]) byFruit[k] = {};
                            Object.entries(f.weeks || {}).forEach(([w, v]) => {
                                byFruit[k][w] = { ...v, year: f.year, updatedAt: f.updatedAt };
                            });
                        });
                        setForecastsByFruit(byFruit);
                    }
                    setForecastModal(null);
                } catch (e) {
                    setForecastModal(m => ({ ...m, loading: false, error: e.message || 'Erreur sauvegarde' }));
                }
            };

            // Sat-Fri week number (calendrier Driscoll's)
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
                const jan1Dow = (jan1.getDay() + 1) % 7;
                return Math.ceil((days + jan1Dow + 1) / 7);
            };
            const getWeekYear = (dateStr) => {
                if (!dateStr) return null;
                if (dateStr.match(/^\d{4}-/)) return parseInt(dateStr.split('-')[0]);
                const m = dateStr.match(/(\d{4})/);
                return m ? parseInt(m[1]) : null;
            };

            // Map liquidation week to year-week key (e.g. "2025-W42")
            const liqYearWeek = (l) => {
                if (!l.rows || l.rows.length === 0 || !l.date) return null;
                // Try to get year from subject "WEEK XX-YYYY"
                const ywMatch = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                const year = ywMatch ? parseInt(ywMatch[1]) : (l.date ? new Date(l.date).getFullYear() : 2025);
                return `${year}-W${l.week}`;
            };

            // Previously had only liquidations fetch (now merged above):
            // React.useEffect(() => {
            //     fetch('/api/email-analysis?action=liquidations')
            //         .then(r => r.json())
            //         .then(d => { if (d.success) setLiquidations(d.liquidations.filter(l => l.rows && l.rows.length > 0)); })
            //         .catch(() => {})
            //         .finally(() => setLoading(false));
            // }, []);

            // Maravilla LC detection: bons d'apport tagués sur parcelle LAR-01 → receipt → liquidation row
            const normalizeRidLiq = (rid) => {
                if (!rid) return '';
                const s = String(rid).trim().toUpperCase();
                const m = s.match(/^RID-0*(\d+)$/);
                return m ? m[1] : s;
            };
            const lcBatchNumbers = new Set();
            bonsApport.forEach(b => {
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                if (resolved && resolved.variete === 'Maravilla' && resolved.sousVariete === 'Long Cane' && b.bonApport) {
                    lcBatchNumbers.add(String(b.bonApport).trim());
                }
            });
            const lcReceiptIds = new Set();
            expeditions.forEach(e => {
                if (e.batchNumber && lcBatchNumbers.has(String(e.batchNumber).trim()) && e.receiptId) {
                    lcReceiptIds.add(normalizeRidLiq(e.receiptId));
                }
            });

            // Variety display mapping — uses normalizeParcelle for unified naming
            // Maravilla split en GC (Grande Culture, défaut) et LC (Long Cane, parcelle ML-T-LAR-01)
            const liqVarietyMap = (v, receiptId) => {
                const r = normalizeParcelle(v);
                if (!r) return v;
                if (r.variete === 'Maravilla') {
                    if (receiptId && lcReceiptIds.has(normalizeRidLiq(receiptId))) return 'Maravilla LC';
                    return 'Maravilla GC';
                }
                return r.variete;
            };
            const varietyToCulture = (v) => /myrtille|blue|corina|corrina|cascade|breeze/i.test(v) ? 'myrtille' : 'framboise';

            // Extract year from subject "WEEK XX-YYYY"
            const extractYear = (subject, date) => {
                const m = (subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                if (m) return parseInt(m[1]);
                if (date) return new Date(date).getFullYear();
                return 2025;
            };

            // Deduplicate liquidations by (year, week, fruit) — framboise and myrtille coexist on the same week
            const liqByWeekDedup = {};
            liquidations.forEach(l => {
                const w = l.week || '?';
                const year = extractYear(l.subject, l.date);
                const fruitKey = (l.fruit && l.fruit !== '?') ? l.fruit : 'framboise';
                const key = `${year}-W${w}-${fruitKey}`;
                if (!liqByWeekDedup[key]) {
                    liqByWeekDedup[key] = l;
                } else {
                    // Same (year, week, fruit) → keep the one with more rows
                    const existing = liqByWeekDedup[key];
                    if ((l.rows || []).length > (existing.rows || []).length) {
                        liqByWeekDedup[key] = l;
                    }
                }
            });
            const dedupedLiquidations = Object.values(liqByWeekDedup);

            // Flatten all rows with week info (from deduplicated liquidations)
            const allRows = dedupedLiquidations.flatMap(l => {
                const year = extractYear(l.subject, l.date);
                return (l.rows || []).map(r => ({
                    ...r,
                    variety: liqVarietyMap(r.variety, r.receiptId),
                    week: l.week,
                    year,
                    liqId: l.id,
                    subject: l.subject,
                    liqDate: l.date,
                    fruit: l.fruit || 'framboise',
                    fruitCode: l.fruitCode || 'RASP',
                    netPayable: l.netPayable,
                    fruitAdvance: l.fruitAdvance,
                    dedRasp: l.dedRasp,
                    cropAdvance: l.cropAdvance,
                    dexAdjustment: l.dexAdjustment,
                    pkgDeduction: l.pkgDeduction,
                    commissionPct: l.commissionPct,
                    netSalesEurKg: l.netSalesEurKg,
                    commissionEurKg: l.commissionEurKg,
                    rebateEurKg: l.rebateEurKg,
                }));
            });
            const fruits = [...new Set(allRows.map(r => r.fruit).filter(Boolean))].sort();

            // Ferme from variety — uses normalizeParcelle
            const fermeOf = (v) => { const r = normalizeParcelle(v); return r ? r.ferme : ''; };
            const fermes = [...new Set(allRows.map(r => fermeOf(r.variety)).filter(Boolean))].sort();
            // Variétés depuis bonsApport (saisie interne) — pour faire apparaître chips même sans liquidation Driscoll's
            const bonsVarieties = new Set();
            bonsApport.forEach(b => {
                if (b.status === 'rejete_qualite' || b.status === 'rejete_chef') return;
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                if (!resolved) return;
                let v;
                if (resolved.variete === 'Maravilla') {
                    if (resolved.sousVariete === 'Long Cane') v = 'Maravilla LC';
                    else if (resolved.sousVariete === 'Green Cane') v = 'Maravilla GC';
                    else v = 'Maravilla GC';
                } else {
                    v = resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete;
                }
                bonsVarieties.add(v);
            });
            const varietes = [...new Set([...allRows.map(r => r.variety).filter(Boolean), ...bonsVarieties])].sort();

            let filtered = allRows;
            if (selectedFruit) filtered = filtered.filter(r => r.fruit === selectedFruit);
            if (selectedFerme) filtered = filtered.filter(r => fermeOf(r.variety) === selectedFerme);
            if (selectedVariete) filtered = filtered.filter(r => r.variety === selectedVariete);

            // KPIs — aggregate by unique receipt ID to avoid double-counting grade splits
            const byReceiptId = {};
            filtered.forEach(r => {
                const baseRid = r.receiptId || ('row_' + Math.random());
                const rid = `${r.fruit || 'framboise'}__${baseRid}`;
                if (!byReceiptId[rid]) byReceiptId[rid] = { kg: 0, gsNet: 0 };
                byReceiptId[rid].kg += (r.receiptQtyKg || 0);
                byReceiptId[rid].gsNet += (r.gsNet || 0);
            });
            const totalKg = Object.values(byReceiptId).reduce((s, r) => s + r.kg, 0);
            const totalGsNet = Object.values(byReceiptId).reduce((s, r) => s + r.gsNet, 0);
            const avgPriceKg = totalKg > 0 ? totalGsNet / totalKg : 0;
            const nbLots = Object.keys(byReceiptId).length;

            // === CA Estimation for non-liquidated weeks (used by KPIs) ===
            const extractYearNonLiq = (subject, date) => {
                const m = (subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                if (m) return parseInt(m[1]);
                if (date) return new Date(date).getFullYear();
                return new Date().getFullYear();
            };
            const liquidatedWeeks = new Set();
            liquidations.forEach(l => {
                if (!l.week) return;
                const year = extractYearNonLiq(l.subject, l.date);
                const culture = (l.fruit || 'framboise').toLowerCase();
                liquidatedWeeks.add(`${year}-W${l.week}-${culture}`);
            });
            const prodByWeek = {};
            bonsApport.filter(b => b.status !== 'rejete_qualite' && b.status !== 'rejete_chef').forEach(b => {
                const kg = parseFloat(b.poidsLot) || 0;
                if (kg <= 0) return;
                const rawType = b.typeVente || '';
                const typeVente = (rawType === "Driscoll's" || rawType === 'EXP') ? 'Export'
                    : rawType === 'ECRT' ? 'Marché Local' : rawType || '';
                if (typeVente !== 'Export') return;
                const dateStr = b.date || '';
                const w = getWeekNum(dateStr);
                const y = getWeekYear(dateStr);
                if (!w || !y) return;
                const resolved = normalizeParcelle(b.designation || b.blocLabel || b.blocVariete);
                let variety;
                if (resolved && resolved.variete === 'Maravilla') {
                    if (resolved.sousVariete === 'Long Cane') variety = 'Maravilla LC';
                    else if (resolved.sousVariete === 'Green Cane') variety = 'Maravilla GC';
                    else variety = 'Maravilla GC';
                } else if (resolved) {
                    variety = resolved.sousVariete ? `${resolved.variete} ${resolved.sousVariete}` : resolved.variete;
                } else {
                    variety = b.blocVariete || '?';
                }
                const culture = resolved ? resolved.culture.toLowerCase() : 'framboise';
                const ferme = resolved ? resolved.ferme : '';
                if (selectedFruit && culture !== selectedFruit) return;
                if (selectedFerme && ferme !== selectedFerme) return;
                if (selectedVariete && variety !== selectedVariete) return;
                const key = `${y}-W${w}-${culture}`;
                if (!prodByWeek[key]) prodByWeek[key] = { week: w, year: y, culture, byVariety: {}, totalKg: 0, lots: 0 };
                prodByWeek[key].totalKg += kg;
                prodByWeek[key].lots += 1;
                if (!prodByWeek[key].byVariety[variety]) prodByWeek[key].byVariety[variety] = 0;
                prodByWeek[key].byVariety[variety] += kg;
            });
            const nonLiquidated = Object.entries(prodByWeek)
                .filter(([key]) => !liquidatedWeeks.has(key))
                .map(([key, d]) => ({ key, ...d }))
                .sort((a, b) => { if (b.year !== a.year) return b.year - a.year; return b.week - a.week; });
            const priceHistoryByCulture = {};
            const sortedLiqs = [...liquidations].sort((a, b) => {
                const yearA = extractYearNonLiq(a.subject, a.date);
                const yearB = extractYearNonLiq(b.subject, b.date);
                if (yearA !== yearB) return yearB - yearA;
                return (b.week || 0) - (a.week || 0);
            });
            for (const liq of sortedLiqs) {
                const liqYear = extractYearNonLiq(liq.subject, liq.date);
                const culture = (liq.fruit || 'framboise').toLowerCase();
                let liqTotalGs = 0, liqTotalKg = 0;
                for (const r of (liq.rows || [])) {
                    if (r.receiptQtyKg > 0 && r.gsNet > 0) {
                        liqTotalGs += r.gsNet;
                        liqTotalKg += r.receiptQtyKg;
                    }
                }
                if (liqTotalKg > 0) {
                    if (!priceHistoryByCulture[culture]) priceHistoryByCulture[culture] = [];
                    if (priceHistoryByCulture[culture].length < 2) {
                        const key = liqYear + '-W' + liq.week;
                        const alreadyHas = priceHistoryByCulture[culture].some(p => p.key === key);
                        if (!alreadyHas) {
                            priceHistoryByCulture[culture].push({
                                price: Math.round(liqTotalGs / liqTotalKg * 100) / 100,
                                week: liq.week, year: liqYear, key
                            });
                        }
                    }
                }
            }
            const priceByCulture = {};
            for (const [c, history] of Object.entries(priceHistoryByCulture)) {
                const avgPrice = history.reduce((s, p) => s + p.price, 0) / history.length;
                const weeks = history.map(p => 'W' + p.week + '-' + String(p.year).slice(-2)).join(' + ');
                priceByCulture[c] = {
                    price: Math.round(avgPrice * 100) / 100, weeks,
                    count: history.length,
                    detail: history.map(p => p.price.toFixed(2) + ' DH/kg (W' + p.week + '-' + String(p.year).slice(-2) + ')').join(' | ')
                };
            }
            const getPriceForVariety = (v) => {
                const culture = varietyToCulture(v);
                return priceByCulture[culture] || { price: 0, weeks: '?', count: 0, detail: '-' };
            };
            // Per-week forecast estimation: prefer Driscoll's forecast over historical avg.
            const getEstForWeek = (variety, week) => {
                const culture = varietyToCulture(variety);
                const fc = getForecastPrice(culture, week);
                if (fc != null && fc > 0) {
                    return { price: fc, weeks: 'Forecast Driscoll\'s W' + week, count: 1, detail: fc.toFixed(2) + ' DH/kg (Driscoll\'s)', source: 'forecast' };
                }
                const hist = getPriceForVariety(variety);
                if (hist.price > 0) return { ...hist, source: 'history' };
                return { price: globalAvgPrice, weeks: '?', count: 0, detail: '-', source: 'global' };
            };
            const globalAvgPrice = allRows.length > 0 ? totalGsNet / totalKg : 0;
            let totalEstCA = 0;
            let totalNonLiqKg = 0;
            const totalEstByCulture = {};
            nonLiquidated.forEach(d => {
                Object.entries(d.byVariety).forEach(([v, kg]) => {
                    const est = getEstForWeek(v, d.week);
                    const culture = varietyToCulture(v);
                    if (!totalEstByCulture[culture]) totalEstByCulture[culture] = { kg: 0, ca: 0 };
                    totalEstByCulture[culture].kg += kg;
                    totalEstByCulture[culture].ca += kg * est.price;
                    totalEstCA += kg * est.price;
                    totalNonLiqKg += kg;
                });
            });
            // === End CA Estimation ===

            // Commission % KPI — weighted average across weeks with data
            const commByWeek = {};
            filtered.forEach(r => {
                const key = `${r.year}-W${r.week}`;
                if (!commByWeek[key]) commByWeek[key] = { week: r.week, year: r.year, kg: 0, commPct: r.commissionPct, netSalesEurKg: r.netSalesEurKg, commissionEurKg: r.commissionEurKg, rebateEurKg: r.rebateEurKg };
                commByWeek[key].kg += (r.receiptQtyKg || 0);
            });
            const commWeeks = Object.values(commByWeek).filter(w => w.commPct != null && w.kg > 0);
            const totalCommKg = commWeeks.reduce((s, w) => s + w.kg, 0);
            const avgCommPct = totalCommKg > 0
                ? commWeeks.reduce((s, w) => s + w.commPct * w.kg, 0) / totalCommKg
                : null;

            const weeks = [...new Set(filtered.map(r => r.week).filter(Boolean))].sort((a,b) => a - b);

            // Group by year + week + fruit (same week can have framboise and myrtille)
            const byWeek = {};
            filtered.forEach(r => {
                const w = r.week || '?';
                const y = r.year || 2025;
                const f = r.fruit || 'framboise';
                const key = `${y}-${w}__${f}`;
                if (!byWeek[key]) byWeek[key] = { week: w, year: y, fruit: f, rows: [] };
                byWeek[key].rows.push(r);
            });
            const weekKeys = Object.keys(byWeek).sort((a, b) => {
                const gA = byWeek[a], gB = byWeek[b];
                // Sort by year desc, then week desc, then fruit
                if (gB.year !== gA.year) return gB.year - gA.year;
                const wA = Number(gA.week) || 0, wB = Number(gB.week) || 0;
                if (wB !== wA) return wB - wA;
                return gA.fruit.localeCompare(gB.fruit);
            });

            if (loading) return React.createElement('div', {className:'loading'}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin'}), ' Chargement des liquidations...');

            return (
                <div className="fade-in">
                    {/* Filters */}
                    <div style={{display:'flex', gap:16, flexWrap:'wrap', marginBottom:16, alignItems:'center'}}>
                        <div className="chip-group">
                            <span className="chip-group-label">Culture:</span>
                            <button className={`chip c-purple ${!selectedFruit ? 'active' : ''}`} onClick={() => setSelectedFruit('')}>Toutes</button>
                            <button className={`chip c-berry ${selectedFruit === 'framboise' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'framboise' ? '' : 'framboise')}>🍓 Framboise</button>
                            <button className={`chip c-indigo ${selectedFruit === 'myrtille' ? 'active' : ''}`} onClick={() => setSelectedFruit(selectedFruit === 'myrtille' ? '' : 'myrtille')}>🫐 Myrtille</button>
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Ferme:</span>
                            <button className={`chip c-green ${!selectedFerme ? 'active' : ''}`} onClick={() => { setSelectedFerme(''); setSelectedVariete(''); }}>Toutes</button>
                            {fermes.map(f => <button key={f} className={`chip c-green ${selectedFerme === f ? 'active' : ''}`} onClick={() => { setSelectedFerme(f); setSelectedVariete(''); }}>{f}</button>)}
                        </div>
                        <div className="chip-group">
                            <span className="chip-group-label">Variété:</span>
                            <button className={`chip c-dark ${!selectedVariete ? 'active' : ''}`} onClick={() => setSelectedVariete('')}>Toutes</button>
                            {varietes.filter(v => !selectedFerme || fermeOf(v) === selectedFerme).map(v => <button key={v} className={`chip c-dark ${selectedVariete === v ? 'active' : ''}`} onClick={() => setSelectedVariete(v)}>{v}</button>)}
                        </div>
                        <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                            <button
                                onClick={() => setPrivateMode(!privateMode)}
                                title={privateMode ? "Mode privé actif — valeurs monétaires masquées. Cliquer pour réafficher." : "Activer le mode privé pour masquer CA / GS Net / Commission (démos partenaires)"}
                                style={{fontSize:12, padding:'6px 12px', borderRadius:6, border:'1px solid ' + (privateMode ? 'var(--berry)' : 'var(--gray-200)'), background: privateMode ? 'var(--berry)' : '#fff', color: privateMode ? '#fff' : 'var(--gray-600)', cursor:'pointer', fontWeight:600}}>
                                <i className={`fa-solid ${privateMode ? 'fa-eye-slash' : 'fa-eye'}`} style={{marginRight:6}}></i>Mode privé {privateMode ? 'ON' : 'OFF'}
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() => openForecastImport('RASP')}
                                title="Importer un slide Driscoll's de prévision Framboise"
                                style={{fontSize:12, padding:'6px 12px'}}>
                                <i className="fa-solid fa-camera" style={{marginRight:6}}></i>📸 Prévision 🍓
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() => openForecastImport('BLUE')}
                                title="Importer un slide Driscoll's de prévision Myrtille"
                                style={{fontSize:12, padding:'6px 12px'}}>
                                <i className="fa-solid fa-camera" style={{marginRight:6}}></i>📸 Prévision 🫐
                            </button>
                        </div>
                    </div>

                    {/* KPIs — 3 lignes (Qté / Prix / CA) × 3 colonnes (Liquidé / Prév / Campagne) + Commission */}
                    <style>{`
                        .kpi-grid-compact .kpi-card { padding: 10px 14px; }
                        .kpi-grid-compact .kpi-card .kpi-header { margin-bottom: 4px; }
                        .kpi-grid-compact .kpi-card .kpi-icon { width: 28px; height: 28px; font-size: 12px; border-radius: 8px; }
                        .kpi-grid-compact .kpi-card .kpi-value { font-size: 18px; line-height: 1.2; }
                        .kpi-grid-compact .kpi-card .kpi-label { font-size: 11px; }
                        .kpi-col-prev .kpi-value { color: var(--blue); }
                        .kpi-col-campagne .kpi-value { color: #757575; }
                    `}</style>
                    <div className="kpi-grid kpi-grid-compact" style={{gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10}}>
                        {/* === COLONNE 1 : LIQUIDÉ (couleurs métriques) === */}
                        {!compactView && !privateMode && (
                            <div style={{gridColumn: 1, gridRow: 1, cursor:'pointer'}} onClick={() => setKpiDetailPopup('qty')}>
                                <KPICard icon="fa-weight-scale" iconClass="green" value={`${(totalKg / 1000).toFixed(2)} T`} label="Qté Liquidée ⓘ" />
                            </div>
                        )}
                        <div style={{gridColumn: 1, gridRow: 2}}>
                            <KPICard icon="fa-tags" iconClass="berry" value={avgPriceKg.toFixed(2)} label="Prix Moyen Liquidé (DH/kg)" />
                        </div>
                        {!compactView && !privateMode && (
                            <div style={{gridColumn: 1, gridRow: 3, cursor:'pointer'}} onClick={() => setKpiDetailPopup('gsnet')}>
                                <KPICard icon="fa-money-bill-wave" iconClass="blue" value={`${(totalGsNet / 1000000).toFixed(2)} m DH`} label="CA Liquidé ⓘ" />
                            </div>
                        )}

                        {/* === COLONNE 2 : PRÉVISIONNEL (bleu) === */}
                        {!compactView && !privateMode && totalNonLiqKg > 0 && (
                            <div className="kpi-col-prev" style={{gridColumn: 2, gridRow: 1}}>
                                <KPICard icon="fa-scale-balanced" iconClass="blue" value={`${(totalNonLiqKg / 1000).toFixed(2)} T`} label="Qté Prév" />
                            </div>
                        )}
                        {!compactView && totalNonLiqKg > 0 && (
                            <div className="kpi-col-prev" style={{gridColumn: 2, gridRow: 2}}>
                                <KPICard icon="fa-tag" iconClass="blue" value={(totalEstCA / totalNonLiqKg).toFixed(2)} label="Prix Prév (DH/kg)" />
                            </div>
                        )}
                        {!compactView && !privateMode && (
                            <div className="kpi-col-prev" style={{gridColumn: 2, gridRow: 3}}>
                                <KPICard icon="fa-hourglass-half" iconClass="blue" value={`${(totalEstCA / 1000000).toFixed(2)} m DH`} label="CA Prév" />
                            </div>
                        )}

                        {/* === COLONNE 3 : CAMPAGNE (gris) === */}
                        {!compactView && !privateMode && (totalKg + totalNonLiqKg) > 0 && (
                            <div className="kpi-col-campagne" style={{gridColumn: 3, gridRow: 1}}>
                                <KPICard icon="fa-boxes-stacked" iconClass="silver" value={`${((totalKg + totalNonLiqKg) / 1000).toFixed(2)} T`} label="Qté Campagne" />
                            </div>
                        )}
                        {!compactView && (totalKg + totalNonLiqKg) > 0 && (
                            <div className="kpi-col-campagne" style={{gridColumn: 3, gridRow: 2}}>
                                <KPICard icon="fa-chart-line" iconClass="silver" value={((totalGsNet + totalEstCA) / (totalKg + totalNonLiqKg)).toFixed(2)} label="Prix Moyen Campagne (DH/kg)" />
                            </div>
                        )}
                        {!compactView && !privateMode && (
                            <div className="kpi-col-campagne" style={{gridColumn: 3, gridRow: 3}}>
                                <KPICard icon="fa-calculator" iconClass="silver" value={`${((totalGsNet + totalEstCA) / 1000000).toFixed(2)} m DH`} label="CA Campagne" />
                            </div>
                        )}

                        {/* === COLONNE 4 : COMMISSION === */}
                        <div style={{gridColumn: 4, gridRow: 2, cursor:'pointer'}} onClick={() => setKpiDetailPopup('commission')}>
                            <KPICard icon="fa-percent" iconClass="orange" value={avgCommPct != null ? `${avgCommPct.toFixed(1)}%` : '-'} label="Commission Driscoll's ⓘ" />
                        </div>
                    </div>

                    {/* KPI Detail Popup */}
                    {kpiDetailPopup && (() => {
                        if (kpiDetailPopup === 'commission') {
                            const commChartData = Object.keys(commByWeek)
                                .filter(k => commByWeek[k].commPct != null)
                                .map(k => ({ ...commByWeek[k], key: k }))
                                .sort((a, b) => {
                                    if (a.year !== b.year) return a.year - b.year;
                                    return a.week - b.week;
                                });
                            const cChartW = 700, cChartH = 220, cPadL = 50, cPadR = 20, cPadT = 25, cPadB = 35;
                            const cInnerW = cChartW - cPadL - cPadR, cInnerH = cChartH - cPadT - cPadB;
                            const maxComm = commChartData.length > 0 ? Math.max(...commChartData.map(d => d.commPct), 1) : 50;
                            const cBarW = commChartData.length > 0 ? Math.min(cInnerW / commChartData.length * 0.7, 30) : 20;
                            const cGap = commChartData.length > 0 ? cInnerW / commChartData.length : 20;
                            // Average line Y
                            const avgLineY = avgCommPct != null ? cPadT + cInnerH * (1 - avgCommPct / maxComm) : null;
                            return (
                                <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center'}} onClick={() => setKpiDetailPopup(null)}>
                                    <div style={{background:'#fff', borderRadius:16, padding:24, maxWidth:800, width:'92%', maxHeight:'85vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
                                            <h3 style={{margin:0, fontSize:16}}>Commission Driscoll's par semaine</h3>
                                            <button onClick={() => setKpiDetailPopup(null)} style={{background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#999'}}>×</button>
                                        </div>
                                        {commChartData.length === 0 ? (
                                            <p style={{color:'var(--gray-400)', textAlign:'center', padding:20}}>Aucune donnée de commission disponible. Relancez un refetch des liquidations.</p>
                                        ) : (
                                            <div>
                                                <svg viewBox={`0 0 ${cChartW} ${cChartH}`} style={{width:'100%', maxHeight:240}}>
                                                    {[0, 0.25, 0.5, 0.75, 1].map(p => {
                                                        const y = cPadT + cInnerH * (1 - p);
                                                        return <g key={p}><line x1={cPadL} y1={y} x2={cChartW-cPadR} y2={y} stroke="#f0f0f0" /><text x={cPadL-4} y={y+4} textAnchor="end" fontSize={9} fill="#999">{(maxComm * p).toFixed(0)}%</text></g>;
                                                    })}
                                                    {avgLineY != null && (
                                                        <g>
                                                            <line x1={cPadL} y1={avgLineY} x2={cChartW-cPadR} y2={avgLineY} stroke="var(--orange)" strokeDasharray="6,3" strokeWidth={1.5} />
                                                            <text x={cChartW-cPadR+2} y={avgLineY+3} fontSize={9} fontWeight={700} fill="var(--orange)">moy {avgCommPct.toFixed(1)}%</text>
                                                        </g>
                                                    )}
                                                    {commChartData.map((d, i) => {
                                                        const x = cPadL + i * cGap + cGap / 2;
                                                        const h = Math.max((d.commPct / maxComm) * cInnerH, 0);
                                                        const y = cPadT + cInnerH - h;
                                                        return <g key={i}>
                                                            <rect x={x - cBarW/2} y={y} width={cBarW} height={h} fill="var(--orange)" rx={3} opacity={0.85} />
                                                            <text x={x} y={y - 4} textAnchor="middle" fontSize={8} fontWeight={600} fill="var(--orange)">{d.commPct.toFixed(1)}%</text>
                                                            <text x={x} y={cChartH - 4} textAnchor="middle" fontSize={8} fill="#666">W{d.week}</text>
                                                        </g>;
                                                    })}
                                                </svg>
                                                <table className="data-table" style={{fontSize:11, marginTop:12}}>
                                                    <thead>
                                                        <tr>
                                                            <th>Semaine</th>
                                                            <th style={{textAlign:'right'}}>Kg</th>
                                                            <th style={{textAlign:'right'}}>Net Sales (€/kg)</th>
                                                            <th style={{textAlign:'right'}}>Commission (€/kg)</th>
                                                            <th style={{textAlign:'right'}}>Rebate (€/kg)</th>
                                                            <th style={{textAlign:'right'}}>Commission %</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {commChartData.map((d, i) => (
                                                            <tr key={i}>
                                                                <td style={{fontWeight:700}}>W{d.week}-{String(d.year).slice(-2)}</td>
                                                                <td style={{textAlign:'right'}}>{Math.round(d.kg).toLocaleString('fr-FR')}</td>
                                                                <td style={{textAlign:'right'}}>{d.netSalesEurKg != null ? d.netSalesEurKg.toFixed(2) : '-'}</td>
                                                                <td style={{textAlign:'right', color:'var(--red)'}}>{d.commissionEurKg != null ? d.commissionEurKg.toFixed(2) : '-'}</td>
                                                                <td style={{textAlign:'right', color:'var(--green)'}}>{d.rebateEurKg != null ? d.rebateEurKg.toFixed(2) : '-'}</td>
                                                                <td style={{textAlign:'right', fontWeight:600}}>{d.commPct.toFixed(1)}%</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr style={{fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                            <td>MOYENNE</td>
                                                            <td style={{textAlign:'right'}}>{Math.round(totalCommKg).toLocaleString('fr-FR')}</td>
                                                            <td style={{textAlign:'right'}}>{commWeeks.length > 0 ? (commWeeks.reduce((s,w) => s + (w.netSalesEurKg || 0) * w.kg, 0) / totalCommKg).toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', color:'var(--red)'}}>{commWeeks.length > 0 ? (commWeeks.reduce((s,w) => s + (w.commissionEurKg || 0) * w.kg, 0) / totalCommKg).toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', color:'var(--green)'}}>{commWeeks.length > 0 ? (commWeeks.reduce((s,w) => s + (w.rebateEurKg || 0) * w.kg, 0) / totalCommKg).toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', fontWeight:700}}>{avgCommPct != null ? `${avgCommPct.toFixed(1)}%` : '-'}</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        }
                        const isGsNet = kpiDetailPopup === 'gsnet';
                        const title = isGsNet ? 'Détail GS Net par semaine' : 'Détail Quantité par semaine';
                        const byWeekDetail = {};
                        filtered.forEach(r => {
                            const key = `W${r.week}-${String(r.year).slice(-2)}`;
                            if (!byWeekDetail[key]) byWeekDetail[key] = { week: r.week, year: r.year, kg: 0, gsNet: 0, rids: new Set() };
                            byWeekDetail[key].kg += (r.receiptQtyKg || 0);
                            byWeekDetail[key].gsNet += (r.gsNet || 0);
                            byWeekDetail[key].rids.add(r.receiptId || ('row_' + Math.random()));
                        });
                        const detailKeys = Object.keys(byWeekDetail).sort((a, b) => {
                            const da = byWeekDetail[a], db = byWeekDetail[b];
                            if (db.year !== da.year) return db.year - da.year;
                            return db.week - da.week;
                        });
                        const grandTotal = isGsNet ? filtered.reduce((s, r) => s + (r.gsNet || 0), 0) : filtered.reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                        return (
                            <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center'}} onClick={() => setKpiDetailPopup(null)}>
                                <div style={{background:'#fff', borderRadius:16, padding:24, maxWidth:600, width:'90%', maxHeight:'80vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
                                        <h3 style={{margin:0, fontSize:16}}>{title}</h3>
                                        <button onClick={() => setKpiDetailPopup(null)} style={{background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#999'}}>×</button>
                                    </div>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>Semaine</th>
                                                <th style={{textAlign:'right'}}>Lots</th>
                                                <th style={{textAlign:'right'}}>Quantité (kg)</th>
                                                {!privateMode && <th style={{textAlign:'right'}}>GS Net (DH)</th>}
                                                <th style={{textAlign:'right'}}>Prix/kg</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detailKeys.map(k => {
                                                const d = byWeekDetail[k];
                                                return (
                                                    <tr key={k}>
                                                        <td style={{fontWeight:700}}>{k}</td>
                                                        <td style={{textAlign:'right'}}>{d.rids.size}</td>
                                                        <td style={{textAlign:'right'}}>{Math.round(d.kg).toLocaleString('fr-FR')}</td>
                                                        {!privateMode && <td style={{textAlign:'right', fontWeight:600}}>{Math.round(d.gsNet).toLocaleString('fr-FR')}</td>}
                                                        <td style={{textAlign:'right'}}>{d.kg > 0 ? (d.gsNet / d.kg).toFixed(2) : '-'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                <td>TOTAL</td>
                                                <td style={{textAlign:'right'}}>{nbLots}</td>
                                                <td style={{textAlign:'right'}}>{Math.round(totalKg).toLocaleString('fr-FR')}</td>
                                                {!privateMode && <td style={{textAlign:'right'}}>{Math.round(totalGsNet).toLocaleString('fr-FR')}</td>}
                                                <td style={{textAlign:'right'}}>{avgPriceKg.toFixed(2)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                    {!isGsNet && (() => {
                                        const liquidatedKeysSet = new Set(detailKeys);
                                        const pendingRows = [];
                                        Object.values(prodByWeek).forEach(d => {
                                            const k = `W${d.week}-${String(d.year).slice(-2)}`;
                                            if (liquidatedKeysSet.has(k)) return;
                                            const kg = selectedVariete ? (d.byVariety[selectedVariete] || 0) : d.totalKg;
                                            if (kg <= 0) return;
                                            pendingRows.push({ key: k, week: d.week, year: d.year, kg, lots: d.lots });
                                        });
                                        pendingRows.sort((a, b) => { if (b.year !== a.year) return b.year - a.year; return b.week - a.week; });
                                        if (pendingRows.length === 0) return null;
                                        const totPendKg = pendingRows.reduce((s, r) => s + r.kg, 0);
                                        const totPendLots = pendingRows.reduce((s, r) => s + r.lots, 0);
                                        return (
                                            <div style={{marginTop:24}}>
                                                <h4 style={{margin:'0 0 8px 0', fontSize:13, color:'var(--gray-600)'}}>En attente de liquidation Driscoll's</h4>
                                                <table className="data-table" style={{fontSize:12}}>
                                                    <thead>
                                                        <tr>
                                                            <th>Semaine</th>
                                                            <th style={{textAlign:'right'}}>Lots</th>
                                                            <th style={{textAlign:'right'}}>Quantité (kg)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pendingRows.map(r => (
                                                            <tr key={r.key}>
                                                                <td style={{fontWeight:700}}>{r.key}</td>
                                                                <td style={{textAlign:'right'}}>{r.lots}</td>
                                                                <td style={{textAlign:'right'}}>{Math.round(r.kg).toLocaleString('fr-FR')}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr style={{fontWeight:700, borderTop:'2px solid var(--dark)'}}>
                                                            <td>TOTAL EN ATTENTE</td>
                                                            <td style={{textAlign:'right'}}>{totPendLots}</td>
                                                            <td style={{textAlign:'right'}}>{Math.round(totPendKg).toLocaleString('fr-FR')}</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        );
                    })()}

                    {liquidations.length === 0 && (
                        <div className="panel" style={{textAlign:'center', padding:40, color:'var(--gray-400)'}}>
                            <i className="fa-solid fa-file-invoice-dollar" style={{fontSize:40, marginBottom:12}}></i>
                            <p>Aucune liquidation reçue. Les liquidations Driscoll's apparaîtront ici automatiquement.</p>
                        </div>
                    )}

                    {/* ===== CHART: Prix moyen par semaine ===== */}
                    {(filtered.length > 0 || Object.keys(prodByWeek).length > 0) && (() => {
                        const chartFiltered = chartVariete ? filtered.filter(r => r.variety === chartVariete) : filtered;
                        const priceByWeek = {};
                        chartFiltered.forEach(r => {
                            const w = r.week || '?';
                            const y = r.year || 2025;
                            const key = `${y}-${w}`;
                            if (!priceByWeek[key]) priceByWeek[key] = { kg: 0, gsNet: 0, week: w, year: y };
                            priceByWeek[key].kg += r.receiptQtyKg || 0;
                            priceByWeek[key].gsNet += r.gsNet || 0;
                        });
                        const rawData = Object.values(priceByWeek)
                            .map(d => ({ week: d.week, year: d.year, sortKey: d.year * 100 + d.week, label: `${d.week}`, price: d.kg > 0 ? Math.round(d.gsNet / d.kg * 100) / 100 : 0, kg: Math.round(d.kg) }))
                            .filter(d => d.price > 0)
                            .sort((a, b) => a.sortKey - b.sortKey);
                        // Pending = bonsApport (saisie interne, Sat-Fri week) sur semaines non encore liquidées.
                        // Source plus fiable que expeditions Driscoll's qui peuvent manquer/arriver tard.
                        const pendingByWeek = {};
                        if (chartVariete || selectedFruit || selectedVariete) {
                            const liquidatedKeys = new Set(Object.keys(priceByWeek));
                            Object.values(prodByWeek).forEach(d => {
                                const eKey = `${d.year}-${d.week}`;
                                if (liquidatedKeys.has(eKey)) return;
                                const kg = chartVariete ? (d.byVariety[chartVariete] || 0) : d.totalKg;
                                if (kg <= 0) return;
                                if (!pendingByWeek[eKey]) pendingByWeek[eKey] = { kg: 0, week: d.week, year: d.year };
                                pendingByWeek[eKey].kg += kg;
                            });
                        }
                        const pendingData = Object.values(pendingByWeek)
                            .map(d => ({ week: d.week, year: d.year, sortKey: d.year * 100 + d.week, label: `${d.week}`, price: 0, kg: Math.round(d.kg), pending: true }))
                            .sort((a, b) => a.sortKey - b.sortKey);

                        // Fill missing weeks between first and last (including pending)
                        const allPoints = [...rawData, ...pendingData].sort((a, b) => a.sortKey - b.sortKey);
                        const chartData = (() => {
                            if (allPoints.length < 2) return allPoints;
                            const filled = [];
                            let y = allPoints[0].year, w = allPoints[0].week;
                            const lastKey = allPoints[allPoints.length - 1].sortKey;
                            const dataMap = {};
                            allPoints.forEach(d => dataMap[d.sortKey] = d);
                            while (y * 100 + w <= lastKey) {
                                const key = y * 100 + w;
                                filled.push(dataMap[key] || { week: w, year: y, sortKey: key, label: `${w}`, price: 0, kg: 0 });
                                w++;
                                if (w > 52) { w = 1; y++; }
                            }
                            return filled;
                        })();
                        // Forecast par fruit : visible si chart filtré par variété, variété globale, OU fruit global
                        const chartFruit = (() => {
                            const v = chartVariete || selectedVariete;
                            if (v) {
                                const resolved = normalizeParcelle(v);
                                if (resolved && resolved.culture) return resolved.culture.toLowerCase();
                            }
                            if (selectedFruit) return selectedFruit.toLowerCase();
                            return null;
                        })();
                        const forecastByWeek = {};
                        if (chartFruit && (chartFruit === 'framboise' || chartFruit === 'myrtille')) {
                            Object.entries(forecastsByFruit[chartFruit] || {}).forEach(([w, v]) => {
                                if (v && Number.isFinite(v.avgMad)) forecastByWeek[String(w)] = v.avgMad;
                            });
                        }
                        const showForecast = Object.keys(forecastByWeek).length > 0;
                        const forecastUpdatedAt = (() => {
                            if (!showForecast) return null;
                            const entries = Object.values(forecastsByFruit[chartFruit] || {});
                            for (const e of entries) { if (e && e.updatedAt) return e.updatedAt; }
                            return null;
                        })();
                        const formatForecastDate = (ua) => {
                            if (!ua) return '';
                            let d = null;
                            if (typeof ua === 'string') d = new Date(ua);
                            else if (typeof ua === 'number') d = new Date(ua);
                            else if (ua._seconds) d = new Date(ua._seconds * 1000);
                            else if (ua.seconds) d = new Date(ua.seconds * 1000);
                            else if (ua.toDate) { try { d = ua.toDate(); } catch {} }
                            if (!d || isNaN(d.getTime())) return '';
                            const dd = String(d.getDate()).padStart(2, '0');
                            const mm = String(d.getMonth() + 1).padStart(2, '0');
                            return `${dd}/${mm}/${d.getFullYear()}`;
                        };
                        // Ajouter les semaines forecastées absentes de chartData pour qu'elles soient visibles
                        if (showForecast && chartData.length > 0) {
                            const presentKeys = new Set(chartData.map(d => d.year * 100 + d.week));
                            const baseYear = chartData[chartData.length - 1].year;
                            Object.keys(forecastByWeek).forEach(wStr => {
                                const w = parseInt(wStr, 10);
                                if (!w) return;
                                const k = baseYear * 100 + w;
                                if (!presentKeys.has(k)) {
                                    chartData.push({ week: w, year: baseYear, sortKey: k, label: `${w}`, price: 0, kg: 0, forecastOnly: true });
                                }
                            });
                            chartData.sort((a, b) => a.sortKey - b.sortKey);
                        }
                        const maxPrice = Math.max(
                            ...chartData.map(d => d.price),
                            ...(showForecast ? Object.values(forecastByWeek) : []),
                            1
                        );
                        const showVolumeLine = !!(chartVariete || selectedFruit || selectedVariete);
                        const maxKg = showVolumeLine ? Math.max(...chartData.map(d => d.kg), 1) : 1;
                        const baseChartW = 700;
                        const chartW = Math.max(baseChartW, 50 + (showVolumeLine ? 55 : 20) + chartData.length * 32);
                        const chartH = showVolumeLine ? 220 : 200, padL = 50, padR = showVolumeLine ? 55 : 20, padT = 20, padB = 30;
                        const needsScroll = chartW > baseChartW + 20;
                        const innerW = chartW - padL - padR, innerH = chartH - padT - padB;
                        const barW = chartData.length > 0 ? Math.min(innerW / chartData.length * 0.7, 30) : 20;
                        const gap = chartData.length > 0 ? innerW / chartData.length : 20;

                        return (
                            <Panel title="Prix Moyen par Semaine (DH/kg)" icon="fa-chart-bar" actions={
                                <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                    <select value={chartVariete} onChange={e => setChartVariete(e.target.value)}
                                        style={{padding:'4px 8px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:11}}>
                                        <option value="">Toutes variétés</option>
                                        {varietes.map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                </div>
                            }>
                                <div style={{overflowX: needsScroll ? 'auto' : 'visible', width:'100%'}}>
                                <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{width: needsScroll ? `${chartW}px` : '100%', maxHeight: showVolumeLine ? 240 : 220, display:'block'}}>
                                    {[0, 0.25, 0.5, 0.75, 1].map(p => {
                                        const y = padT + innerH * (1 - p);
                                        return <g key={p}><line x1={padL} y1={y} x2={chartW-padR} y2={y} stroke="#f0f0f0" /><text x={padL-4} y={y+4} textAnchor="end" fontSize={9} fill="#999">{Math.round(maxPrice * p)}</text></g>;
                                    })}
                                    {showVolumeLine && [0, 0.25, 0.5, 0.75, 1].map(p => {
                                        const y = padT + innerH * (1 - p);
                                        return <text key={'rax-'+p} x={chartW-padR+4} y={y+4} textAnchor="start" fontSize={9} fill="var(--blue)">{Math.round(maxKg * p).toLocaleString('fr-FR')}</text>;
                                    })}
                                    {showVolumeLine && <text x={chartW-padR+4} y={padT-6} textAnchor="start" fontSize={8} fill="var(--blue)" fontWeight={600}>kg</text>}
                                    {chartData.map((d, i) => {
                                        const x = padL + i * gap + gap / 2;
                                        const realW = showForecast ? barW * 0.5 : barW;
                                        const realX = showForecast ? x - barW/2 : x - barW/2;
                                        const h = d.price > 0 ? Math.max((d.price / maxPrice) * innerH, 0) : 0;
                                        const y = padT + innerH - h;
                                        const fc = showForecast ? forecastByWeek[String(d.week)] : null;
                                        const fcH = fc ? Math.max((fc / maxPrice) * innerH, 0) : 0;
                                        const fcY = padT + innerH - fcH;
                                        const fcW = barW * 0.5;
                                        const fcX = x + 1;
                                        return <g key={i} style={{cursor:'pointer'}} onClick={() => setPopupWeek({ week: d.week, year: d.year })}>
                                            <rect x={x - barW/2 - 4} y={padT} width={barW + 8} height={innerH + padB} fill="transparent" />
                                            {d.price > 0 && <rect x={realX} y={y} width={realW} height={h} fill="var(--berry)" rx={3} opacity={0.85} />}
                                            {d.price > 0 && <text x={showForecast ? realX + realW/2 : x} y={y - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--berry)">{d.price}</text>}
                                            {fc != null && <rect x={fcX} y={fcY} width={fcW} height={fcH} fill="none" stroke="var(--berry)" strokeWidth={1.5} strokeDasharray="3,2" rx={2} opacity={0.75} />}
                                            {fc != null && <text x={fcX + fcW/2} y={fcY - 3} textAnchor="middle" fontSize={8} fontStyle="italic" fill="#888">{Math.round(fc)}</text>}
                                            <text x={x} y={chartH - 4} textAnchor="middle" fontSize={9} fill="#666">{d.label}</text>
                                        </g>;
                                    })}
                                    {showVolumeLine && chartData.length > 1 && (() => {
                                        // Solide jusqu'à la dernière semaine écoulée, pointillée pour la semaine en cours
                                        const today = new Date();
                                        const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                                        const currentWeek = getWeekNum(todayIso);
                                        const currentYear = today.getFullYear();
                                        const cmp = (y, w) => y * 100 + w;
                                        const currentKey = cmp(currentYear, currentWeek);
                                        const coords = chartData
                                            .map((d, i) => ({
                                                x: padL + i * gap + gap / 2,
                                                y: padT + innerH - (d.kg / maxKg) * innerH,
                                                key: cmp(d.year, d.week),
                                            }))
                                            .filter(c => c.key <= currentKey);
                                        const past = coords.filter(c => c.key < currentKey);
                                        const currentPt = coords.find(c => c.key === currentKey);
                                        const solidPts = past.map(c => `${c.x},${c.y}`).join(' ');
                                        // Dashed = jonction dernière semaine écoulée → semaine en cours
                                        const dashedPts = currentPt
                                            ? (past.length > 0
                                                ? `${past[past.length-1].x},${past[past.length-1].y} ${currentPt.x},${currentPt.y}`
                                                : `${currentPt.x},${currentPt.y}`)
                                            : '';
                                        return <g>
                                            {solidPts && <polyline points={solidPts} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
                                            {dashedPts && <polyline points={dashedPts} fill="none" stroke="var(--blue)" strokeWidth={2} strokeDasharray="6,4" strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />}
                                        </g>;
                                    })()}
                                    {showVolumeLine && (() => {
                                        const today = new Date();
                                        const todayIso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
                                        const currentWeek = getWeekNum(todayIso);
                                        const currentYear = today.getFullYear();
                                        const cmp = (y, w) => y * 100 + w;
                                        const currentKey = cmp(currentYear, currentWeek);
                                        return chartData.map((d, i) => {
                                            if (d.kg === 0 && !d.pending) return null;
                                            const dKey = cmp(d.year, d.week);
                                            if (dKey > currentKey) return null; // pas de point pour les semaines futures
                                            const isCurrent = dKey === currentKey;
                                            const x = padL + i * gap + gap / 2;
                                            const y = padT + innerH - (d.kg / maxKg) * innerH;
                                            return <circle key={'vol-'+i} cx={x} cy={y} r={3} fill="var(--blue)" opacity={isCurrent ? 0.6 : 1} />;
                                        });
                                    })()}
                                    {showVolumeLine && <g>
                                        <rect x={padL+8} y={2} width={10} height={10} fill="var(--berry)" rx={2} opacity={0.85} />
                                        <text x={padL+22} y={11} fontSize={9} fill="#666">Prix (DH/kg)</text>
                                        <line x1={padL+100} y1={7} x2={padL+118} y2={7} stroke="var(--blue)" strokeWidth={2} />
                                        <circle cx={padL+109} cy={7} r={3} fill="var(--blue)" />
                                        <text x={padL+122} y={11} fontSize={9} fill="#666">Volume (kg)</text>
                                        <line x1={padL+200} y1={7} x2={padL+218} y2={7} stroke="var(--blue)" strokeWidth={2} strokeDasharray="6,4" opacity={0.6} />
                                        <text x={padL+222} y={11} fontSize={9} fill="#666">En attente</text>
                                        {showForecast && <g>
                                            <rect x={padL+280} y={2} width={10} height={10} fill="none" stroke="var(--berry)" strokeWidth={1.5} strokeDasharray="3,2" rx={2} opacity={0.75} />
                                            <text x={padL+294} y={11} fontSize={9} fill="#666">
                                                Prévision Driscoll's{forecastUpdatedAt ? ` (maj ${formatForecastDate(forecastUpdatedAt)})` : ''}
                                            </text>
                                        </g>}
                                    </g>}
                                </svg>
                                </div>
                            </Panel>
                        );
                    })()}

                    {/* ===== POPUP DÉTAIL LIQUIDATION SEMAINE ===== */}
                    {forecastModal && (() => {
                        const m = forecastModal;
                        const fruitLabel = m.fruitCode === 'RASP' ? '🍓 Framboise (Raspberries)' : '🫐 Myrtille (Blueberries)';
                        const updateWeek = (idx, field, value) => {
                            setForecastModal(prev => {
                                const next = [...(prev.weeks || [])];
                                next[idx] = { ...next[idx], [field]: value };
                                return { ...prev, weeks: next };
                            });
                        };
                        const removeWeek = (idx) => {
                            setForecastModal(prev => {
                                const next = [...(prev.weeks || [])];
                                next.splice(idx, 1);
                                return { ...prev, weeks: next };
                            });
                        };
                        const addWeek = () => {
                            setForecastModal(prev => ({ ...prev, weeks: [...(prev.weeks || []), { week: '', year: prev.year, minMad: '', maxMad: '' }] }));
                        };
                        return (
                            <div className="modal-overlay" onClick={() => !m.loading && setForecastModal(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:720, maxHeight:'90vh', overflow:'auto'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:'2px solid var(--berry)'}}>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700, color:'var(--dark)'}}>Importer prévisions Driscoll's</div>
                                            <div style={{fontSize:12, color:'var(--gray-400)', marginTop:2}}>{fruitLabel} · année {m.year}</div>
                                        </div>
                                        <button onClick={() => !m.loading && setForecastModal(null)} style={{background:'none', border:'none', fontSize:24, cursor:'pointer', color:'#999'}}>×</button>
                                    </div>

                                    {m.error && <div style={{background:'#ffebee', color:'#c62828', padding:10, borderRadius:8, marginBottom:12, fontSize:12}}>{m.error}</div>}

                                    {/* Step 1: file picker */}
                                    {(m.step === 'pick' || m.step === 'ready') && (
                                        <div>
                                            <p style={{fontSize:13, color:'#555', marginBottom:12}}>
                                                Upload le slide Driscoll's correspondant. On extrait la ligne <strong>"2026 Grower return prices"</strong> et on calcule la moyenne (min+max)/2.
                                            </p>
                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                                onChange={(e) => handleForecastFile(e.target.files[0])}
                                                style={{marginBottom:12}}
                                            />
                                            {m.imageB64 && (
                                                <div style={{marginBottom:12}}>
                                                    <img src={m.imageB64} alt="slide" style={{maxWidth:'100%', maxHeight:260, border:'1px solid var(--gray-200)', borderRadius:6}} />
                                                </div>
                                            )}
                                            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                                <button className="btn-secondary" onClick={() => setForecastModal(null)} disabled={m.loading}>Annuler</button>
                                                <button className="btn-primary" onClick={runForecastExtract} disabled={!m.imageB64 || m.loading}>
                                                    {m.loading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Extraction…</> : 'Extraire les prix'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Step 2: review extracted weeks */}
                                    {m.step === 'review' && (
                                        <div>
                                            <p style={{fontSize:13, color:'#555', marginBottom:12}}>
                                                Vérifie et corrige si besoin avant d'enregistrer. La moyenne (avgMad) est recalculée automatiquement côté serveur.
                                            </p>
                                            <table className="data-table" style={{fontSize:12, width:'100%', marginBottom:12}}>
                                                <thead>
                                                    <tr>
                                                        <th>Semaine</th>
                                                        <th>Année</th>
                                                        <th>Min (MAD/kg)</th>
                                                        <th>Max (MAD/kg)</th>
                                                        <th style={{textAlign:'right'}}>Moy.</th>
                                                        <th></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(m.weeks || []).map((w, i) => {
                                                        const mn = parseFloat(w.minMad);
                                                        const mx = parseFloat(w.maxMad);
                                                        const avg = (Number.isFinite(mn) && Number.isFinite(mx)) ? ((mn + mx) / 2).toFixed(2) : '-';
                                                        return (
                                                            <tr key={i}>
                                                                <td><input type="number" value={w.week} onChange={(e) => updateWeek(i, 'week', e.target.value)} style={{width:60}} /></td>
                                                                <td><input type="number" value={w.year || m.year} onChange={(e) => updateWeek(i, 'year', e.target.value)} style={{width:80}} /></td>
                                                                <td><input type="number" step="0.01" value={w.minMad} onChange={(e) => updateWeek(i, 'minMad', e.target.value)} style={{width:90}} /></td>
                                                                <td><input type="number" step="0.01" value={w.maxMad} onChange={(e) => updateWeek(i, 'maxMad', e.target.value)} style={{width:90}} /></td>
                                                                <td style={{textAlign:'right', fontWeight:600, color:'var(--berry)'}}>{avg}</td>
                                                                <td><button onClick={() => removeWeek(i)} style={{background:'none', border:'none', color:'#c62828', cursor:'pointer'}} title="Supprimer">×</button></td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                            <button className="btn-secondary" onClick={addWeek} style={{fontSize:11, padding:'4px 10px', marginBottom:12}}>+ Ajouter une semaine</button>
                                            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                                <button className="btn-secondary" onClick={() => setForecastModal(m0 => ({ ...m0, step: 'ready' }))} disabled={m.loading}>← Retour</button>
                                                <button className="btn-primary" onClick={saveForecast} disabled={m.loading || (m.weeks || []).length === 0}>
                                                    {m.loading ? <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}></i>Enregistrement…</> : 'Enregistrer'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {popupWeek && (() => {
                        const pw = popupWeek;
                        const weekRows = filtered.filter(r => r.week === pw.week && (r.year || 2025) === pw.year);
                        if (weekRows.length === 0) { setPopupWeek(null); return null; }
                        const wKg = weekRows.reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                        const wGsNet = weekRows.reduce((s, r) => s + (r.gsNet || 0), 0);
                        const wAvgPrice = wKg > 0 ? (wGsNet / wKg).toFixed(2) : '0';
                        // Group by variety
                        const byVar = {};
                        weekRows.forEach(r => {
                            const v = r.variety || '?';
                            if (!byVar[v]) byVar[v] = { kg: 0, gsNet: 0, lots: 0 };
                            byVar[v].kg += r.receiptQtyKg || 0;
                            byVar[v].gsNet += r.gsNet || 0;
                            byVar[v].lots += 1;
                        });
                        return (
                            <div className="modal-overlay" onClick={() => setPopupWeek(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:750, maxHeight:'90vh', overflow:'auto'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:'2px solid var(--berry)'}}>
                                        <div>
                                            <div style={{fontSize:18, fontWeight:700, color:'var(--dark)'}}>Liquidation Semaine W{pw.week}-{String(pw.year).slice(-2)}</div>
                                            <div style={{fontSize:12, color:'var(--gray-400)', marginTop:2}}>{weekRows.length} lot{weekRows.length > 1 ? 's' : ''}</div>
                                        </div>
                                        <div style={{display:'flex', gap:16, fontSize:13}}>
                                            <div style={{textAlign:'center'}}><div style={{fontWeight:700, fontSize:18}}>{Math.round(wKg).toLocaleString('fr-FR')}</div><div style={{fontSize:10, color:'var(--gray-400)'}}>kg</div></div>
                                            <div style={{textAlign:'center'}}><div style={{fontWeight:700, fontSize:18, color:'var(--green)'}}>{Math.round(wGsNet).toLocaleString('fr-FR')}</div><div style={{fontSize:10, color:'var(--gray-400)'}}>DH</div></div>
                                            <div style={{textAlign:'center'}}><div style={{fontWeight:700, fontSize:18, color:'var(--berry)'}}>{wAvgPrice}</div><div style={{fontSize:10, color:'var(--gray-400)'}}>DH/kg</div></div>
                                        </div>
                                    </div>

                                    {/* Résumé par variété */}
                                    <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:16}}>
                                        {Object.entries(byVar).sort((a,b) => b[1].kg - a[1].kg).map(([v, d]) => (
                                            <div key={v} style={{flex:'1 1 140px', padding:'10px', background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:11, fontWeight:600, color:'var(--gray-500)'}}>{v}</div>
                                                <div style={{fontSize:16, fontWeight:700}}>{Math.round(d.kg).toLocaleString('fr-FR')} kg</div>
                                                <div style={{fontSize:11, color:'var(--green)'}}>{d.kg > 0 ? (d.gsNet / d.kg).toFixed(2) : '0'} DH/kg</div>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>{d.lots} lots</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Tableau détail */}
                                    <div style={{overflowX:'auto'}}>
                                        <table className="data-table" style={{fontSize:12}}>
                                            <thead>
                                                <tr>
                                                    <th>Date</th>
                                                    <th>Receipt ID</th>
                                                    <th>Variété</th>
                                                    <th>Colis</th>
                                                    <th>Poids (kg)</th>
                                                    <th>PFQ Score</th>
                                                    <th>PP Fruit</th>
                                                    <th>GS Net</th>
                                                    <th>Prix/kg</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {weekRows.map((r, i) => (
                                                    <tr key={i}>
                                                        <td style={{fontSize:11}}>{r.date || '-'}</td>
                                                        <td style={{fontFamily:'monospace', fontSize:11}}>{r.receiptId || '-'}</td>
                                                        <td style={{fontWeight:500}}>{r.variety || '-'}</td>
                                                        <td>{r.receiptQty || '-'}</td>
                                                        <td style={{fontWeight:600}}>{r.receiptQtyKg ? r.receiptQtyKg.toFixed(1) : '-'}</td>
                                                        <td>{r.pfqScore || '-'}</td>
                                                        <td>{r.ppFruit ? r.ppFruit.toFixed(2) : '-'}</td>
                                                        <td style={{fontWeight:600, color:'var(--green)'}}>{r.gsNet ? Math.round(r.gsNet).toLocaleString('fr-FR') : '-'}</td>
                                                        <td style={{color:'var(--berry)', fontWeight:600}}>{r.pricePerKg || '-'}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                    <td colSpan={4}>TOTAL</td>
                                                    <td>{Math.round(wKg).toLocaleString('fr-FR')}</td>
                                                    <td></td>
                                                    <td></td>
                                                    <td style={{color:'var(--green)'}}>{Math.round(wGsNet).toLocaleString('fr-FR')}</td>
                                                    <td style={{color:'var(--berry)'}}>{wAvgPrice}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <div style={{marginTop:16, textAlign:'center'}}>
                                        <button className="btn-secondary" onClick={() => setPopupWeek(null)}>Fermer</button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {!compactView && (<>
                    {/* ===== SEMAINES NON LIQUIDÉES ===== */}
                    {nonLiquidated.length > 0 && (() => {
                        const allVarsInNonLiq = [...new Set(nonLiquidated.flatMap(d => Object.keys(d.byVariety)))].sort();

                        // Tonnages campagne — Export total, Marché Local, Liquidée
                        let totalExportKg = 0, totalLocalKg = 0, totalLocalCA = 0;
                        bonsApport.filter(b => b.status !== 'rejete_qualite' && b.status !== 'rejete_chef').forEach(b => {
                            const kg = parseFloat(b.poidsLot) || 0;
                            if (kg <= 0) return;
                            const rawType = b.typeVente || '';
                            const typeVente = (rawType === "Driscoll's" || rawType === 'EXP') ? 'Export'
                                : rawType === 'ECRT' ? 'Marché Local' : rawType || '';
                            if (typeVente === 'Export') { totalExportKg += kg; }
                            else if (typeVente === 'Marché Local') {
                                totalLocalKg += kg;
                                const prix = parseFloat(b.prixDH) || 0;
                                totalLocalCA += kg * prix;
                            }
                        });
                        const tonnageLiquidee = totalExportKg - totalNonLiqKg;
                        const tonnageCampagne = totalExportKg + totalLocalKg;

                        return (
                            <Panel title={`Semaines en Attente de Liquidation (${nonLiquidated.length})`} icon="fa-hourglass-half">
                                {/* KPI Tonnages */}
                                {!privateMode && (
                                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:16}}>
                                    <div style={{background:'var(--gray-100)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'var(--gray-400)', fontWeight:600, textTransform:'uppercase'}}>Tonnage Campagne</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'var(--text)'}}>{(tonnageCampagne / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                    </div>
                                    <div style={{background:'rgba(76,175,80,0.08)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'#2e7d32', fontWeight:600, textTransform:'uppercase'}}>Tonnage Liquidée</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'#2e7d32'}}>{(tonnageLiquidee / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                    </div>
                                    <div style={{background:'rgba(255,152,0,0.08)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'#e65100', fontWeight:600, textTransform:'uppercase'}}>Tonnage en Cours</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'#e65100'}}>{(totalNonLiqKg / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>{Math.round(totalNonLiqKg).toLocaleString('fr-FR')} kg</div>
                                    </div>
                                    <div style={{background:'rgba(156,39,176,0.08)', borderRadius:10, padding:'12px 16px', textAlign:'center'}}>
                                        <div style={{fontSize:10, color:'#7b1fa2', fontWeight:600, textTransform:'uppercase'}}>Marché Local</div>
                                        <div style={{fontSize:22, fontWeight:700, color:'#7b1fa2'}}>{(totalLocalKg / 1000).toFixed(1)} <span style={{fontSize:12}}>T</span></div>
                                        <div style={{fontSize:10, color:'var(--gray-400)'}}>CA: {Math.round(totalLocalCA).toLocaleString('fr-FR')} DH</div>
                                    </div>
                                </div>
                                )}
                                {!privateMode && (
                                <div style={{marginBottom:12, display:'flex', gap:8, flexWrap:'wrap'}}>
                                    <span style={{fontSize:11, background:'rgba(76,175,80,0.1)', color:'#2e7d32', padding:'4px 10px', borderRadius:8, fontWeight:600}}>
                                        CA Export estimé: {Math.round(totalEstCA).toLocaleString('fr-FR')} DH
                                    </span>
                                    {Object.entries(totalEstByCulture).sort((a,b) => b[1].ca - a[1].ca).map(([culture, data]) => (
                                        <span key={culture} style={{fontSize:11, background: culture === 'framboise' ? 'rgba(233,30,99,0.08)' : 'rgba(63,81,181,0.08)', color: culture === 'framboise' ? '#c2185b' : '#283593', padding:'4px 10px', borderRadius:8, fontWeight:600}}>
                                            {culture === 'framboise' ? '🍓' : '🫐'} {culture.charAt(0).toUpperCase() + culture.slice(1)}: {Math.round(data.ca).toLocaleString('fr-FR')} DH ({Math.round(data.kg).toLocaleString('fr-FR')} kg)
                                        </span>
                                    ))}
                                </div>
                                )}
                                <div style={{overflowX:'auto'}}>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>Semaine</th>
                                                <th>Lots</th>
                                                <th>Total Kg</th>
                                                {allVarsInNonLiq.map(v => <th key={v} style={{textAlign:'right'}}>{v} (kg)</th>)}
                                                <th style={{textAlign:'right'}}>Prév. Driscoll's<br/><span style={{fontSize:9, fontWeight:400, color:'var(--gray-400)'}}>(DH/kg)</span></th>
                                                {!privateMode && <th style={{textAlign:'right'}}>CA Estimé (DH)</th>}
                                                <th style={{fontSize:10, color:'var(--gray-400)'}}>Base prix</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {nonLiquidated.map(d => {
                                                let rowEstCA = 0;
                                                const usedSources = new Set();
                                                const fcDetails = []; // [{ fruit, minMad, maxMad, avgMad }]
                                                Object.entries(d.byVariety).forEach(([v, kg]) => {
                                                    const est = getEstForWeek(v, d.week);
                                                    rowEstCA += kg * est.price;
                                                    usedSources.add(est.weeks || '?');
                                                });
                                                // Forecast row display: one chip per fruit present in this week
                                                const fruitsInRow = new Set(Object.keys(d.byVariety).map(v => varietyToCulture(v)));
                                                fruitsInRow.forEach(fr => {
                                                    const entry = forecastsByFruit?.[fr]?.[String(d.week)];
                                                    if (entry) fcDetails.push({ fruit: fr, ...entry });
                                                });
                                                return (
                                                    <tr key={d.key}>
                                                        <td><span style={{background:'rgba(255,152,0,0.15)', color:'#e65100', padding:'2px 8px', borderRadius:8, fontWeight:700, fontSize:12}}>W{d.week}-{String(d.year).slice(-2)}</span>{d.culture && <span style={{fontSize:10, marginLeft:4}}>{d.culture === 'framboise' ? '🍓' : '🫐'}</span>}</td>
                                                        <td>{d.lots}</td>
                                                        <td style={{fontWeight:600}}>{Math.round(d.totalKg).toLocaleString('fr-FR')}</td>
                                                        {allVarsInNonLiq.map(v => <td key={v} style={{textAlign:'right'}}>{d.byVariety[v] ? Math.round(d.byVariety[v]).toLocaleString('fr-FR') : '-'}</td>)}
                                                        <td style={{textAlign:'right', fontSize:11}}>
                                                            {fcDetails.length === 0 ? <span style={{color:'var(--gray-400)'}}>-</span> : fcDetails.map((f, i) => (
                                                                <div key={i} title={`Min ${f.minMad?.toFixed(2)} – Max ${f.maxMad?.toFixed(2)} DH/kg`} style={{color:'var(--berry)', fontWeight:600}}>
                                                                    {f.fruit === 'framboise' ? '🍓' : '🫐'} {f.avgMad?.toFixed(2)}
                                                                </div>
                                                            ))}
                                                        </td>
                                                        {!privateMode && <td style={{textAlign:'right', fontWeight:600, color:'var(--green)'}}>{Math.round(rowEstCA).toLocaleString('fr-FR')}</td>}
                                                        <td style={{fontSize:10, color:'var(--gray-400)'}}>{[...usedSources].join(', ')}</td>
                                                    </tr>
                                                );
                                            })}
                                            <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                <td>TOTAL</td>
                                                <td>{nonLiquidated.reduce((s,d) => s+d.lots, 0)}</td>
                                                <td>{Math.round(totalNonLiqKg).toLocaleString('fr-FR')}</td>
                                                {allVarsInNonLiq.map(v => {
                                                    const vTotal = nonLiquidated.reduce((s, d) => s + (d.byVariety[v] || 0), 0);
                                                    return <td key={v} style={{textAlign:'right'}}>{vTotal > 0 ? Math.round(vTotal).toLocaleString('fr-FR') : '-'}</td>;
                                                })}
                                                <td></td>
                                                {!privateMode && <td style={{textAlign:'right', color:'var(--green)'}}>{Math.round(totalEstCA).toLocaleString('fr-FR')}</td>}
                                                <td></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{marginTop:12, padding:'10px 14px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)'}}>
                                    <div style={{fontSize:11, fontWeight:600, color:'#555', marginBottom:6}}>
                                        <i className="fa-solid fa-tag" style={{marginRight:6, color:'var(--berry)'}}></i>
                                        Prix utilisés par culture (moyenne des 2 dernières liquidations)
                                    </div>
                                    <div style={{display:'flex', gap:20, flexWrap:'wrap'}}>
                                        {Object.entries(priceByCulture).sort((a,b) => b[1].price - a[1].price).map(([culture, info]) => (
                                            <div key={culture} style={{fontSize:12, color:'#333'}}>
                                                <strong style={{textTransform:'capitalize'}}>{culture}</strong>: <span style={{color:'var(--green)', fontWeight:600}}>{info.price.toFixed(2)} DH/kg</span>
                                                <span style={{fontSize:10, color:'var(--gray-400)', marginLeft:4}}>({info.detail})</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Panel>
                        );
                    })()}

                    {/* Reconciliation: see QualiteReconciliationTab */}

                    {false && (() => {
                        const normalizeRid = (rid) => {
                            if (!rid) return '';
                            let s = String(rid).trim().toUpperCase();
                            const m = s.match(/^RID-0*(\d+)$/);
                            return m ? m[1] : s;
                        };

                        // 2. Build GLOBAL set of all liquidation receipt IDs (across all weeks)
                        const allLiqRidsNorm = new Map(); // normalizedId -> { originalId, week, year }
                        const liqByWeek = {};
                        liquidations.forEach(l => {
                            if (!l.week) return;
                            const fruit = (l.fruit || l.fruitCode || '').toLowerCase();
                            if (selectedFruit === 'framboise' && /myrtille|blue/i.test(fruit)) return;
                            if (selectedFruit === 'myrtille' && /framboise|rasp/i.test(fruit)) return;
                            const ywMatch = (l.subject || '').match(/week\s*\d+[\/-](\d{4})/i);
                            const year = ywMatch ? parseInt(ywMatch[1]) : 2025;
                            const key = `${year}-W${l.week}`;
                            if (!liqByWeek[key]) liqByWeek[key] = { week: l.week, year, receiptIds: new Set(), receiptIdsNorm: new Set(), rows: [] };
                            (l.rows || []).forEach(r => {
                                if (r.receiptId) {
                                    liqByWeek[key].receiptIds.add(r.receiptId);
                                    const norm = normalizeRid(r.receiptId);
                                    liqByWeek[key].receiptIdsNorm.add(norm);
                                    allLiqRidsNorm.set(norm, { originalId: r.receiptId, week: l.week, year });
                                }
                                liqByWeek[key].rows.push(r);
                            });
                        });

                        // 3. Build GLOBAL set of all expedition receipt IDs + per-week
                        const allExpRidsNorm = new Map(); // normalizedId -> { exp, week, year }
                        const expByWeekRec = {};
                        expeditions.filter(e => e.overallResult !== 'REJECT').forEach(e => {
                            const w = getISOWeek(e.date);
                            const y = getISOYear(e.date);
                            if (!w || !y) return;
                            const key = `${y}-W${w}`;
                            if (!expByWeekRec[key]) expByWeekRec[key] = [];
                            const exp = {
                                receiptId: e.receiptId,
                                receiptIdNorm: normalizeRid(e.receiptId),
                                variety: applyVarietyMapping ? applyVarietyMapping(e.batchNumber, e.variety) : e.variety,
                                kg: e.batchWeight || 0,
                                date: e.date,
                                ferme: e.ranch === '200742' ? 'F1' : e.ranch === '200876' ? 'F5' : e.ranch || '-',
                            };
                            expByWeekRec[key].push(exp);
                            allExpRidsNorm.set(exp.receiptIdNorm, { exp, week: w, year: y });
                        });

                        // 4. Smart matching: same week first, then ±1 week, then global
                        const reconciliation = Object.entries(liqByWeek).map(([key, liq]) => {
                            // Get expeditions from same week AND adjacent weeks
                            const [yearStr, weekStr] = key.split('-W');
                            const yr = parseInt(yearStr);
                            const wk = parseInt(weekStr);
                            const adjacentKeys = [
                                key,
                                `${wk === 1 ? yr - 1 : yr}-W${wk === 1 ? 52 : wk - 1}`,
                                `${wk === 52 ? yr + 1 : yr}-W${wk === 52 ? 1 : wk + 1}`,
                            ];

                            // Pool of candidate expeditions (same + adjacent weeks)
                            const sameWeekExps = expByWeekRec[key] || [];
                            const adjacentExps = adjacentKeys.slice(1).flatMap(k => expByWeekRec[k] || []);

                            // Step A: exact match within same week (normalized)
                            const matchedSameWeek = sameWeekExps.filter(e => liq.receiptIdsNorm.has(e.receiptIdNorm));
                            const matchedSameWeekNorms = new Set(matchedSameWeek.map(e => e.receiptIdNorm));

                            // Step B: for remaining liq RIDs, check adjacent weeks
                            const unmatchedLiqNorms = [...liq.receiptIdsNorm].filter(n => !matchedSameWeekNorms.has(n));
                            const matchedAdjacentLiq = [];
                            unmatchedLiqNorms.forEach(liqNorm => {
                                const adjExp = adjacentExps.find(e => e.receiptIdNorm === liqNorm);
                                if (adjExp) matchedAdjacentLiq.push({ liqNorm, exp: adjExp });
                            });
                            const matchedAdjacentNorms = new Set(matchedAdjacentLiq.map(m => m.liqNorm));

                            // Step C: for remaining unmatched expedition RIDs, check if they exist in ANY liquidation
                            const unmatchedExps = sameWeekExps.filter(e =>
                                !liq.receiptIdsNorm.has(e.receiptIdNorm)
                            );
                            const trulyMissing = unmatchedExps.filter(e => !allLiqRidsNorm.has(e.receiptIdNorm));
                            const matchedElsewhere = unmatchedExps.filter(e => allLiqRidsNorm.has(e.receiptIdNorm));

                            // Step D: extra in liq = liq RIDs with no matching expedition anywhere (with row data for import)
                            const trulyExtraInLiq = [...liq.receiptIdsNorm]
                                .filter(n => !matchedSameWeekNorms.has(n) && !matchedAdjacentNorms.has(n))
                                .filter(n => !allExpRidsNorm.has(n))
                                .map(n => {
                                    const orig = [...liq.receiptIds].find(r => normalizeRid(r) === n);
                                    const row = liq.rows.find(r => normalizeRid(r.receiptId) === n);
                                    return {
                                        receiptId: orig || n,
                                        variety: row ? row.variety : 'Inconnue',
                                        kg: row ? (row.totalKg || row.batchWeight || 0) : 0,
                                        week: liq.week,
                                        year: liq.year,
                                    };
                                });

                            const totalExp = sameWeekExps.length;
                            const totalLiq = liq.receiptIds.size;
                            const totalMatched = matchedSameWeek.length + matchedElsewhere.length;
                            const matchScore = totalExp > 0 ? Math.round(totalMatched / totalExp * 100) : (totalLiq > 0 ? 0 : null);

                            return {
                                key, week: liq.week, year: liq.year,
                                totalExp, totalLiq,
                                matched: totalMatched,
                                matchedSameWeek: matchedSameWeek.length,
                                matchedElsewhere: matchedElsewhere.length,
                                missingFromLiq: trulyMissing,
                                extraInLiq: trulyExtraInLiq,
                                matchScore,
                                missingKg: trulyMissing.reduce((s, e) => s + e.kg, 0),
                            };
                        }).filter(r => r.matchScore !== null).sort((a, b) => {
                            if (b.year !== a.year) return b.year - a.year;
                            return b.week - a.week;
                        });

                        const hasIssues = reconciliation.some(r => r.missingFromLiq.length > 0 || r.extraInLiq.length > 0);
                        const totalMissing = reconciliation.reduce((s, r) => s + r.missingFromLiq.length, 0);

                        return (
                            <Panel title={`Réconciliation Liquidations / Expéditions`} icon="fa-scale-balanced" actions={
                                totalMissing > 0 ? <span style={{background:'#fff3e0', color:'#e65100', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>
                                    {totalMissing} expédition{totalMissing > 1 ? 's' : ''} non liquidée{totalMissing > 1 ? 's' : ''}
                                </span> : <span style={{background:'rgba(76,175,80,0.1)', color:'#2e7d32', padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:700}}>Tout est réconcilié</span>
                            }>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead>
                                        <tr>
                                            <th>Semaine</th>
                                            <th>Expéd.</th>
                                            <th>Liq.</th>
                                            <th>Match</th>
                                            <th>Score</th>
                                            <th>Non liquidées</th>
                                            <th>Détail</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reconciliation.map(r => {
                                            const scoreColor = r.matchScore >= 100 ? '#4caf50' : r.matchScore >= 90 ? '#ff9800' : '#e53935';
                                            return (
                                                <tr key={r.key} style={r.missingFromLiq.length > 0 ? {background:'rgba(255,152,0,0.05)'} : {}}>
                                                    <td><span style={{fontWeight:700}}>W{r.week}-{String(r.year).slice(-2)}</span></td>
                                                    <td>{r.totalExp}</td>
                                                    <td>{r.totalLiq}</td>
                                                    <td>
                                                        {r.matched}/{r.totalExp}
                                                        {r.matchedElsewhere > 0 && <span style={{fontSize:9, color:'#1976d2', marginLeft:3}} title="Matchées dans une autre semaine de liquidation">
                                                            (+{r.matchedElsewhere} autre sem.)
                                                        </span>}
                                                    </td>
                                                    <td>
                                                        <div style={{display:'flex', alignItems:'center', gap:6}}>
                                                            <div style={{width:50, height:6, background:'#e0e0e0', borderRadius:3, overflow:'hidden'}}>
                                                                <div style={{width:`${Math.min(r.matchScore, 100)}%`, height:'100%', background:scoreColor, borderRadius:3}}></div>
                                                            </div>
                                                            <span style={{fontWeight:700, color:scoreColor, fontSize:11}}>{r.matchScore}%</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {r.missingFromLiq.length > 0 ? (
                                                            <span style={{background:'#fff3e0', color:'#e65100', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11}}>
                                                                {r.missingFromLiq.length} ({Math.round(r.missingKg)} kg)
                                                            </span>
                                                        ) : <span style={{color:'#4caf50', fontWeight:600}}>OK</span>}
                                                        {r.extraInLiq.length > 0 && (
                                                            <span style={{background:'rgba(33,150,243,0.1)', color:'#1565c0', padding:'2px 8px', borderRadius:6, fontWeight:600, fontSize:11, marginLeft:4}} title="Receipt IDs dans la liquidation sans expédition correspondante — cliquer Importer dans le détail">
                                                                +{r.extraInLiq.length} sans expéd.
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{fontSize:10, maxWidth:300, overflow:'hidden', textOverflow:'ellipsis'}}>
                                                        {r.missingFromLiq.length > 0 ? r.missingFromLiq.map((e, i) => (
                                                            <span key={i} style={{display:'inline-block', background:'rgba(255,152,0,0.1)', padding:'1px 6px', borderRadius:4, margin:'1px 2px', fontSize:10}}>
                                                                {e.receiptId} ({e.variety}, {Math.round(e.kg)}kg)
                                                            </span>
                                                        )) : ''}
                                                        {r.extraInLiq.length > 0 ? r.extraInLiq.map((extra, i) => (
                                                            <span key={'x'+i} style={{display:'inline-flex', alignItems:'center', gap:4, background:'rgba(33,150,243,0.08)', padding:'1px 6px', borderRadius:4, margin:'1px 2px', fontSize:10, color:'#1565c0'}}>
                                                                {extra.receiptId} ({extra.variety}, {Math.round(extra.kg)}kg)
                                                                <button style={{background:'#1976d2', color:'#fff', border:'none', borderRadius:3, padding:'1px 5px', fontSize:9, cursor:'pointer', fontWeight:600}}
                                                                    title="Créer cette expédition manuellement"
                                                                    onClick={() => {
                                                                        if (!confirm(`Importer l'expédition ${extra.receiptId} (${extra.variety}, ${Math.round(extra.kg)}kg) ?`)) return;
                                                                        fetch('/api/email-analysis?action=create-manual-expedition', {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({
                                                                                receiptId: extra.receiptId,
                                                                                variety: extra.variety,
                                                                                kg: extra.kg,
                                                                                week: extra.week,
                                                                                year: extra.year,
                                                                                fruit: selectedFruit,
                                                                                source: 'import-liquidation',
                                                                            })
                                                                        }).then(r2 => r2.json()).then(json => {
                                                                            if (json.success) {
                                                                                alert(`Expédition ${extra.receiptId} créée !`);
                                                                                window.location.reload();
                                                                            } else {
                                                                                alert('Erreur: ' + (json.error || 'Echec'));
                                                                            }
                                                                        }).catch(err => alert('Erreur: ' + err.message));
                                                                    }}>
                                                                    <i className="fa-solid fa-plus"></i> Importer
                                                                </button>
                                                            </span>
                                                        )) : ''}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                <div style={{marginTop:8, fontSize:10, color:'var(--gray-400)', fontStyle:'italic'}}>
                                    Matching intelligent : comparaison normalisée des Receipt IDs, recherche dans la même semaine + semaines adjacentes + global. Les expéditions REJECT sont exclues.
                                </div>
                            </Panel>
                        );
                    })()}

                    {/* Liquidations by week */}
                    {weekKeys.map(wKey => {
                        const group = byWeek[wKey];
                        const rows = group.rows;
                        const w = group.week;
                        const wFruit = group.fruit;
                        const wKg = rows.reduce((s, r) => s + (r.receiptQtyKg || 0), 0);
                        const wGsNet = rows.reduce((s, r) => s + (r.gsNet || 0), 0);
                        const wAvgPrice = wKg > 0 ? wGsNet / wKg : 0;
                        const wYear = group.year;
                        const yearShort = String(wYear).slice(-2);
                        const wUniqueLots = new Set(rows.map(r => r.receiptId).filter(Boolean)).size || rows.length;
                        const liq = liquidations.find(l => String(l.week) === String(w) && (l.fruit || 'framboise') === wFruit);
                        const fruitIcon = wFruit === 'myrtille' ? '🫐' : '🫐';
                        const fruitBg = wFruit === 'myrtille' ? 'linear-gradient(135deg, #5C6BC0, #3949AB)' : 'linear-gradient(135deg, #9e9e9e, #bdbdbd)';
                        const fruitLabel = wFruit === 'myrtille' ? 'Myrtille' : 'Framboise';
                        return (
                            <div key={wKey} id={`liq-week-${wYear}-${w}`} className="panel" style={{marginBottom:16}}>
                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                                        <span style={{background:fruitBg, color:'#fff', padding:'4px 12px', borderRadius:12, fontWeight:700, fontSize:14}}>{fruitIcon} W{w}-{yearShort}</span>
                                        {fruits.length > 1 && <span style={{fontSize:11, fontWeight:600, color: wFruit === 'myrtille' ? '#5C6BC0' : 'var(--berry)', background: wFruit === 'myrtille' ? 'rgba(92,107,192,0.1)' : 'var(--berry-pale)', padding:'2px 8px', borderRadius:8}}>{fruitLabel}</span>}
                                        <span style={{fontSize:13, color:'var(--gray-500)'}}>{wUniqueLots} lot{wUniqueLots > 1 ? 's' : ''}</span>
                                    </div>
                                    <div style={{display:'flex', gap:16, fontSize:12}}>
                                        <span><strong>{Math.round(wKg)}</strong> kg</span>
                                        <span style={{color:'var(--green)'}}><strong>{Math.round(wGsNet).toLocaleString('fr-FR')}</strong> DH</span>
                                        <span style={{color:'var(--berry)'}}><strong>{wAvgPrice.toFixed(2)}</strong> DH/kg</span>
                                    </div>
                                </div>
                                <div style={{overflowX:'auto'}}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Receipt ID</th>
                                                <th>Variété</th>
                                                <th>Colis</th>
                                                <th>Poids (kg)</th>
                                                <th>PFQ Score</th>
                                                <th>PP Fruit (DH/kg)</th>
                                                <th>GS Net (DH)</th>
                                                <th>Prix/kg (DH)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((r, i) => (
                                                <tr key={i} style={{cursor:'pointer'}} onClick={() => setSelectedLiq({...liq, highlightRow: r.receiptId})}
                                                    onMouseOver={e => e.currentTarget.style.background='rgba(139,34,82,0.04)'}
                                                    onMouseOut={e => e.currentTarget.style.background=''}>
                                                    <td>{r.date}</td>
                                                    <td style={{fontSize:11, fontFamily:'monospace'}}>{r.receiptId}</td>
                                                    <td><strong>{r.variety || r.varietyCode}</strong></td>
                                                    <td style={{textAlign:'center'}}>{r.receiptQty}</td>
                                                    <td style={{textAlign:'center'}}>{r.receiptQtyKg}</td>
                                                    <td style={{textAlign:'center', fontWeight:600}}>{r.pfqScore}</td>
                                                    <td style={{textAlign:'center'}}>{r.ppFruit ? r.ppFruit.toFixed(2) : '-'}</td>
                                                    <td style={{textAlign:'center', color:'var(--green)', fontWeight:600}}>{r.gsNet ? Math.round(r.gsNet).toLocaleString('fr-FR') : '-'}</td>
                                                    <td style={{textAlign:'center', color:'var(--berry)', fontWeight:600}}>{r.pricePerKg ? r.pricePerKg.toFixed(2) : '-'}</td>
                                                </tr>
                                            ))}
                                            <tr style={{background:'#f5f5f5', fontWeight:700}}>
                                                <td colSpan={3}>Total W{w}</td>
                                                <td style={{textAlign:'center'}}>{rows.reduce((s,r) => s + (r.receiptQty || 0), 0)}</td>
                                                <td style={{textAlign:'center'}}>{Math.round(wKg)}</td>
                                                <td></td>
                                                <td></td>
                                                <td style={{textAlign:'center', color:'var(--green)'}}>{Math.round(wGsNet).toLocaleString('fr-FR')}</td>
                                                <td style={{textAlign:'center', color:'var(--berry)'}}>{wAvgPrice.toFixed(2)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Deductions summary if available */}
                                {liq && (liq.fruitAdvance || liq.dedRasp || liq.cropAdvance || liq.netPayable) ? (
                                    <div style={{marginTop:12, padding:'10px 14px', background:'#f9f9f9', borderRadius:8, display:'flex', gap:20, flexWrap:'wrap', fontSize:12}}>
                                        {liq.fruitAdvance ? <span>Fruit Advance: <strong style={{color:'var(--red)'}}>{Math.round(liq.fruitAdvance).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.dedRasp ? <span>DED Rasp: <strong style={{color:'var(--red)'}}>{Math.round(liq.dedRasp).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.cropAdvance ? <span>Crop Advance: <strong style={{color:'var(--red)'}}>{Math.round(liq.cropAdvance).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.dexAdjustment ? <span>DEX Ajust.: <strong>{Math.round(liq.dexAdjustment).toLocaleString('fr-FR')} DH</strong></span> : null}
                                        {liq.netPayable ? <span>Net Payable: <strong style={{color:'var(--green)'}}>{Math.round(liq.netPayable).toLocaleString('fr-FR')} DH</strong></span> : null}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                    {/* Popup modal — PDF mirror */}
                    {selectedLiq && (() => {
                        const rows = selectedLiq.rows || [];
                        const lTotalKg = rows.reduce((s,r) => s + (r.receiptQtyKg || 0), 0);
                        const lTotalGsNet = rows.reduce((s,r) => s + (r.gsNet || 0), 0);
                        const lTotalColis = rows.reduce((s,r) => s + (r.receiptQty || 0), 0);
                        const lAvgPrice = lTotalKg > 0 ? lTotalGsNet / lTotalKg : 0;
                        const totalDeductions = (selectedLiq.fruitAdvance || 0) + (selectedLiq.dedRasp || 0) + (selectedLiq.cropAdvance || 0) + (selectedLiq.dexAdjustment || 0) + (selectedLiq.pkgDeduction || 0);
                        const netPayable = selectedLiq.netPayable || (lTotalGsNet - totalDeductions);
                        // Group rows by variety
                        const byVar = {};
                        rows.forEach(r => { const v = r.variety || r.varietyCode || '?'; if (!byVar[v]) byVar[v] = {kg:0, gs:0, colis:0}; byVar[v].kg += r.receiptQtyKg || 0; byVar[v].gs += r.gsNet || 0; byVar[v].colis += r.receiptQty || 0; });

                        return (
                            <div className="modal-overlay" onClick={() => setSelectedLiq(null)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth:780, maxHeight:'90vh', overflowY:'auto', padding:0}}>
                                    {/* Header Driscoll's */}
                                    <div style={{background:'linear-gradient(135deg, #1a5e1a 0%, #2d8b4e 100%)', padding:'20px 24px', color:'white'}}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                            <div>
                                                <div style={{fontSize:10, textTransform:'uppercase', letterSpacing:2, opacity:0.7}}>Driscoll's Du Maroc SARL</div>
                                                <div style={{fontSize:20, fontWeight:700, marginTop:4}}>Rapport de Liquidation</div>
                                                <div style={{fontSize:12, opacity:0.8, marginTop:2}}>Semaine {selectedLiq.week || '?'} — Raspberries</div>
                                            </div>
                                            <div style={{textAlign:'right'}}>
                                                <div style={{fontSize:28, fontWeight:800, fontFamily:'Georgia, serif'}}>LIQUIDATION</div>
                                                <div style={{fontSize:11, opacity:0.8}}>Only the Finest Berries</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{padding:'20px 24px'}}>
                                        {/* Info Grid */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20}}>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Producteur</div>
                                                <div style={{fontSize:13, fontWeight:600}}>Berry Good Farms SARL</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>Vendor 200741</div>
                                                <div style={{fontSize:11, color:'var(--gray-600)'}}>ICE: 002106859000069</div>
                                            </div>
                                            <div style={{padding:12, background:'var(--gray-100)', borderRadius:8}}>
                                                <div style={{fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', marginBottom:6}}>Période</div>
                                                <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'3px 12px', fontSize:12}}>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Semaine</span><span style={{fontWeight:600}}>W{selectedLiq.week || '?'}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Lots</span><span>{new Set(rows.map(r => r.receiptId).filter(Boolean)).size || rows.length}</span>
                                                    <span style={{fontWeight:600, color:'var(--gray-400)'}}>Date email</span><span>{selectedLiq.date ? new Date(selectedLiq.date).toLocaleDateString('fr-FR') : '-'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Production Summary by Variety */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-boxes-stacked" style={{marginRight:6}}></i>Résumé par Variété
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr>
                                                    <th>Variété</th>
                                                    <th style={{textAlign:'right'}}>Colis</th>
                                                    <th style={{textAlign:'right'}}>Poids (kg)</th>
                                                    <th style={{textAlign:'right'}}>Prix Moy. (DH/kg)</th>
                                                    <th style={{textAlign:'right'}}>GS Net (DH)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.entries(byVar).map(([v, d]) => (
                                                    <tr key={v}>
                                                        <td><strong>{v}</strong></td>
                                                        <td style={{textAlign:'right'}}>{d.colis}</td>
                                                        <td style={{textAlign:'right', fontWeight:600}}>{d.kg}</td>
                                                        <td style={{textAlign:'right'}}>{d.kg > 0 ? (d.gs / d.kg).toFixed(2) : '-'}</td>
                                                        <td style={{textAlign:'right', fontWeight:700, color:'var(--berry)'}}>{Math.round(d.gs).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                    <td>TOTAL</td>
                                                    <td style={{textAlign:'right'}}>{lTotalColis}</td>
                                                    <td style={{textAlign:'right'}}>{lTotalKg}</td>
                                                    <td style={{textAlign:'right'}}>{lAvgPrice.toFixed(2)}</td>
                                                    <td style={{textAlign:'right', color:'var(--berry)'}}>{Math.round(lTotalGsNet).toLocaleString('fr-FR')}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Detail per lot */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-list" style={{marginRight:6}}></i>Détail par Lot
                                        </div>
                                        <div style={{overflowX:'auto'}}>
                                            <table className="data-table" style={{fontSize:11, marginBottom:16}}>
                                                <thead>
                                                    <tr>
                                                        <th>Date</th>
                                                        <th>Receipt ID</th>
                                                        <th>Variété</th>
                                                        <th style={{textAlign:'right'}}>Colis</th>
                                                        <th style={{textAlign:'right'}}>kg</th>
                                                        <th style={{textAlign:'right'}}>PFQ Score</th>
                                                        <th style={{textAlign:'right'}}>PP Fruit (DH/kg)</th>
                                                        <th style={{textAlign:'right'}}>GS Net (DH)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rows.map((r, i) => (
                                                        <tr key={i} style={r.receiptId === selectedLiq.highlightRow ? {background:'rgba(139,34,82,0.08)'} : {}}>
                                                            <td>{r.date}</td>
                                                            <td style={{fontFamily:'monospace'}}>{r.receiptId}</td>
                                                            <td><strong>{r.variety || r.varietyCode}</strong></td>
                                                            <td style={{textAlign:'right'}}>{r.receiptQty}</td>
                                                            <td style={{textAlign:'right'}}>{r.receiptQtyKg}</td>
                                                            <td style={{textAlign:'right', fontWeight:600}}>{r.pfqScore}</td>
                                                            <td style={{textAlign:'right'}}>{r.ppFruit ? r.ppFruit.toFixed(2) : '-'}</td>
                                                            <td style={{textAlign:'right', color:'var(--green)', fontWeight:600}}>{r.gsNet ? Math.round(r.gsNet).toLocaleString('fr-FR') : '-'}</td>
                                                        </tr>
                                                    ))}
                                                    <tr style={{background:'var(--gray-100)', fontWeight:700}}>
                                                        <td colSpan={3}>TOTAL</td>
                                                        <td style={{textAlign:'right'}}>{lTotalColis}</td>
                                                        <td style={{textAlign:'right'}}>{lTotalKg}</td>
                                                        <td></td>
                                                        <td></td>
                                                        <td style={{textAlign:'right', color:'var(--green)'}}>{Math.round(lTotalGsNet).toLocaleString('fr-FR')}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Déductions */}
                                        <div style={{fontSize:13, fontWeight:600, marginBottom:8, color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-scissors" style={{marginRight:6}}></i>Déductions
                                        </div>
                                        <table className="data-table" style={{fontSize:12, marginBottom:16}}>
                                            <thead>
                                                <tr><th>Type</th><th style={{textAlign:'right'}}>Montant (DH)</th></tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>Fruit Advance</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.fruitAdvance ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.fruitAdvance ? `-${Math.round(selectedLiq.fruitAdvance).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>DED Rasp</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.dedRasp ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.dedRasp ? `-${Math.round(selectedLiq.dedRasp).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>Crop Advance</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.cropAdvance ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.cropAdvance ? `-${Math.round(selectedLiq.cropAdvance).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>DEX Ajustement</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.dexAdjustment ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.dexAdjustment ? `-${Math.round(selectedLiq.dexAdjustment).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr>
                                                    <td>Pkg Deduction</td>
                                                    <td style={{textAlign:'right', color: selectedLiq.pkgDeduction ? 'var(--red)' : 'var(--gray-400)', fontWeight:600}}>{selectedLiq.pkgDeduction ? `-${Math.round(selectedLiq.pkgDeduction).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                                <tr style={{background:'rgba(231,76,60,0.05)'}}>
                                                    <td style={{fontWeight:700}}>Total Déductions</td>
                                                    <td style={{textAlign:'right', fontWeight:700, color:'var(--red)'}}>{totalDeductions > 0 ? `-${Math.round(totalDeductions).toLocaleString('fr-FR')}` : '0'}</td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Net Payable */}
                                        <div style={{padding:16, background:'linear-gradient(135deg, #2D8B4E10 0%, #2D8B4E20 100%)', borderRadius:10, border:'2px solid var(--green)', marginBottom:16}}>
                                            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                                                <div>
                                                    <div style={{fontSize:11, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase'}}>Montant Net Payable</div>
                                                    <div style={{fontSize:11, color:'var(--gray-400)'}}>GS Net total - Déductions</div>
                                                </div>
                                                <div style={{fontSize:28, fontWeight:800, color:'var(--green)'}}>{Math.round(netPayable).toLocaleString('fr-FR')} DH</div>
                                            </div>
                                        </div>

                                        {/* Recap KPIs */}
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:16}}>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Prix Moyen</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--berry)'}}>{lAvgPrice.toFixed(2)}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Tonnage</div>
                                                <div style={{fontSize:16, fontWeight:700}}>{lTotalKg}</div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>kg</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>% Retenu</div>
                                                <div style={{fontSize:16, fontWeight:700, color: totalDeductions > 0 ? 'var(--red)' : 'var(--green)'}}>
                                                    {lTotalGsNet > 0 ? (totalDeductions / lTotalGsNet * 100).toFixed(1) : '0'}%
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>déductions</div>
                                            </div>
                                            <div style={{padding:10, background:'var(--gray-100)', borderRadius:8, textAlign:'center'}}>
                                                <div style={{fontSize:10, color:'var(--gray-400)'}}>Net / kg</div>
                                                <div style={{fontSize:16, fontWeight:700, color:'var(--green)'}}>
                                                    {lTotalKg > 0 ? (netPayable / lTotalKg).toFixed(2) : '0'}
                                                </div>
                                                <div style={{fontSize:9, color:'var(--gray-400)'}}>DH / kg</div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div style={{fontSize:10, color:'var(--gray-400)', borderTop:'1px solid var(--gray-200)', paddingTop:10, marginBottom:12}}>
                                            <div>Document généré automatiquement | Berry Good Farms SARL</div>
                                            <div>R.C. 24587 | T.P. 22211020 | IF 04960175 | CNSS 2258053 | ICE 002106859000069</div>
                                        </div>

                                        <button onClick={() => setSelectedLiq(null)} style={{width:'100%', padding:'10px', background:'var(--berry)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer'}}>
                                            <i className="fa-solid fa-xmark" style={{marginRight:6}}></i> Fermer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                    </>)}
                </div>
            );
        }

        // ===================== QUALITÉ ÉCARTS TAB =====================
        function QualiteEcartsTab({ data }) {
            const [expeditions, setExpeditions] = useState([]);
            const [loading, setLoading] = useState(true);
            const [filterVariete, setFilterVariete] = useState('');
            const [filterFerme, setFilterFerme] = useState('');
            const [filterBerry, setFilterBerry] = useState('');
            const today = new Date();
            const defaultFrom = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
            const defaultTo = today.toISOString().slice(0, 10);
            const [dateFrom, setDateFrom] = useState(defaultFrom);
            const [dateTo, setDateTo] = useState(defaultTo);
            const [viewMode, setViewMode] = useState('top');
            const [evolKey, setEvolKey] = useState('avgPfqTotal');

            useEffect(() => {
                cachedFetch('/api/email-analysis?action=expeditions&limit=5000').then(json => {
                    if (json && json.success && Array.isArray(json.expeditions)) {
                        setExpeditions(json.expeditions);
                    } else {
                        setExpeditions([]);
                    }
                }).catch(err => {
                    console.warn('Erreur chargement expeditions:', err);
                    setExpeditions([]);
                }).finally(() => setLoading(false));
            }, []);

            // Helpers
            const getDateISO = (e) => {
                const d = e.dateISO || e.receiptDate || e.date;
                if (!d) return null;
                return String(d).slice(0, 10);
            };

            // Driscoll's Sat-Fri week key — anchor: a known Saturday
            const SAT_ANCHOR = new Date('2024-01-06T00:00:00Z'); // Saturday
            const getSatFriWeekKey = (dateISO) => {
                if (!dateISO) return null;
                const d = new Date(dateISO + 'T00:00:00Z');
                const diffDays = Math.floor((d - SAT_ANCHOR) / 86400000);
                const weekIdx = Math.floor(diffDays / 7);
                const satDate = new Date(SAT_ANCHOR.getTime() + weekIdx * 7 * 86400000);
                const friDate = new Date(satDate.getTime() + 6 * 86400000);
                const year = satDate.getUTCFullYear();
                // Compute week-of-year approx: week number = floor((satDate - firstSatOfYear)/7)+1
                const yearStart = new Date(Date.UTC(year, 0, 1));
                const dayOfWeek = yearStart.getUTCDay();
                const firstSatOffset = (6 - dayOfWeek + 7) % 7;
                const firstSat = new Date(yearStart.getTime() + firstSatOffset * 86400000);
                let weekNum = Math.floor((satDate - firstSat) / (7 * 86400000)) + 1;
                if (weekNum < 1) weekNum = 1;
                const fmt = (dt) => String(dt.getUTCDate()).padStart(2, '0') + '/' + String(dt.getUTCMonth() + 1).padStart(2, '0');
                return {
                    key: year + '-W' + String(weekNum).padStart(2, '0'),
                    label: 'S' + String(weekNum).padStart(2, '0') + ' (' + fmt(satDate) + '-' + fmt(friDate) + ')',
                    weekNum,
                    satDate: satDate.toISOString().slice(0, 10),
                };
            };

            const inferFerme = (e) => {
                if (e.ferme) return e.ferme;
                if (e.ranchName) {
                    if (/200742|F1/i.test(e.ranchName)) return 'F1';
                    if (/200876|F5/i.test(e.ranchName)) return 'F5';
                }
                return '';
            };

            // Filter expéditions
            const filtered = useMemo(() => {
                return expeditions.filter(e => {
                    const d = getDateISO(e);
                    if (!d) return false;
                    if (dateFrom && d < dateFrom) return false;
                    if (dateTo && d > dateTo) return false;
                    if (filterVariete && e.variety !== filterVariete) return false;
                    if (filterBerry && e.berryType !== filterBerry) return false;
                    if (filterFerme && inferFerme(e) !== filterFerme) return false;
                    const hasDefects = (Array.isArray(e.conditionDefects) && e.conditionDefects.length) || (Array.isArray(e.appearanceDefects) && e.appearanceDefects.length);
                    const hasPfq = e.pfqTotal != null || e.pfqCondition != null || e.pfqApparence != null;
                    return hasDefects || hasPfq;
                });
            }, [expeditions, filterVariete, filterFerme, filterBerry, dateFrom, dateTo]);

            // Lists for filter dropdowns
            const varietes = useMemo(() => Array.from(new Set(expeditions.map(e => e.variety).filter(Boolean))).sort(), [expeditions]);
            const fermes = useMemo(() => Array.from(new Set(expeditions.map(inferFerme).filter(Boolean))).sort(), [expeditions]);
            const berryTypes = useMemo(() => Array.from(new Set(expeditions.map(e => e.berryType).filter(Boolean))).sort(), [expeditions]);

            // KPIs
            const kpi = useMemo(() => {
                const n = filtered.length;
                if (n === 0) return { n: 0, avgPfq: 0, avgCond: 0, avgApp: 0, passRate: 0 };
                const sumPfq = filtered.reduce((s, e) => s + (parseFloat(e.pfqTotal) || 0), 0);
                const sumCond = filtered.reduce((s, e) => s + (parseFloat(e.pfqCondition) || 0), 0);
                const sumApp = filtered.reduce((s, e) => s + (parseFloat(e.pfqApparence) || 0), 0);
                const nPass = filtered.filter(e => String(e.overallResult).toUpperCase() === 'PASS').length;
                return {
                    n,
                    avgPfq: Math.round(sumPfq / n * 10) / 10,
                    avgCond: Math.round(sumCond / n * 10) / 10,
                    avgApp: Math.round(sumApp / n * 10) / 10,
                    passRate: Math.round(nPass / n * 100),
                };
            }, [filtered]);

            // Top défauts cumulés
            const topDefauts = useMemo(() => {
                const map = {};
                filtered.forEach(e => {
                    const v = e.variety || '?';
                    (e.conditionDefects || []).forEach(d => {
                        const key = 'C|' + d.name;
                        if (!map[key]) map[key] = { name: d.name, cat: 'Condition', occurrences: 0, sumPct: 0, sumPoints: 0, varieties: new Set() };
                        map[key].occurrences += 1;
                        map[key].sumPct += parseFloat(d.percent) || 0;
                        map[key].sumPoints += parseFloat(d.points) || 0;
                        map[key].varieties.add(v);
                    });
                    (e.appearanceDefects || []).forEach(d => {
                        const key = 'A|' + d.name;
                        if (!map[key]) map[key] = { name: d.name, cat: 'Apparence', occurrences: 0, sumPct: 0, sumPoints: 0, varieties: new Set() };
                        map[key].occurrences += 1;
                        map[key].sumPct += parseFloat(d.percent) || 0;
                        map[key].sumPoints += parseFloat(d.points) || 0;
                        map[key].varieties.add(v);
                    });
                });
                return Object.values(map).map(o => ({
                    name: o.name,
                    cat: o.cat,
                    occurrences: o.occurrences,
                    avgPct: o.occurrences > 0 ? Math.round(o.sumPct / o.occurrences * 10) / 10 : 0,
                    avgPoints: o.occurrences > 0 ? Math.round(o.sumPoints / o.occurrences * 10) / 10 : 0,
                    totalPoints: Math.round(o.sumPoints * 10) / 10,
                    varieties: Array.from(o.varieties).sort(),
                })).sort((a, b) => b.totalPoints - a.totalPoints);
            }, [filtered]);

            // Daily aggregation (for evolution chart + tableau journalier)
            const dailyAgg = useMemo(() => {
                const map = {};
                filtered.forEach(e => {
                    const d = getDateISO(e);
                    if (!map[d]) map[d] = { date: d, sumPfq: 0, sumCond: 0, sumApp: 0, n: 0 };
                    map[d].sumPfq += parseFloat(e.pfqTotal) || 0;
                    map[d].sumCond += parseFloat(e.pfqCondition) || 0;
                    map[d].sumApp += parseFloat(e.pfqApparence) || 0;
                    map[d].n += 1;
                });
                return Object.values(map).map(o => ({
                    date: o.date,
                    avgPfqTotal: Math.round(o.sumPfq / o.n * 10) / 10,
                    avgCondition: Math.round(o.sumCond / o.n * 10) / 10,
                    avgApparence: Math.round(o.sumApp / o.n * 10) / 10,
                    nbLots: o.n,
                })).sort((a, b) => a.date.localeCompare(b.date));
            }, [filtered]);

            // Weekly aggregation per variety
            const weeklyPivot = useMemo(() => {
                const weekSet = {};
                const map = {};
                filtered.forEach(e => {
                    const d = getDateISO(e);
                    const w = getSatFriWeekKey(d);
                    if (!w) return;
                    weekSet[w.key] = w;
                    const v = e.variety || '?';
                    if (!map[v]) map[v] = {};
                    if (!map[v][w.key]) map[v][w.key] = { sumPfq: 0, n: 0 };
                    map[v][w.key].sumPfq += parseFloat(e.pfqTotal) || 0;
                    map[v][w.key].n += 1;
                });
                const weeks = Object.values(weekSet).sort((a, b) => a.satDate.localeCompare(b.satDate));
                const varieties = Object.keys(map).sort();
                return { weeks, varieties, map };
            }, [filtered]);

            // Daily pivot per variety (last 14 days within range)
            const dailyPivot = useMemo(() => {
                const dateSet = {};
                const map = {};
                filtered.forEach(e => {
                    const d = getDateISO(e);
                    dateSet[d] = true;
                    const v = e.variety || '?';
                    if (!map[v]) map[v] = {};
                    if (!map[v][d]) map[v][d] = { sumPfq: 0, n: 0 };
                    map[v][d].sumPfq += parseFloat(e.pfqTotal) || 0;
                    map[v][d].n += 1;
                });
                const dates = Object.keys(dateSet).sort().slice(-14);
                const varieties = Object.keys(map).sort();
                return { dates, varieties, map };
            }, [filtered]);

            // Détail défauts par variété
            const varieteBreakdown = useMemo(() => {
                const map = {};
                filtered.forEach(e => {
                    const v = e.variety || '?';
                    if (!map[v]) map[v] = { variete: v, n: 0, sumPfq: 0, defauts: {} };
                    map[v].n += 1;
                    map[v].sumPfq += parseFloat(e.pfqTotal) || 0;
                    [...(e.conditionDefects || []).map(d => ({ ...d, cat: 'C' })), ...(e.appearanceDefects || []).map(d => ({ ...d, cat: 'A' }))].forEach(d => {
                        const k = d.cat + '|' + d.name;
                        if (!map[v].defauts[k]) map[v].defauts[k] = { name: d.name, cat: d.cat === 'C' ? 'Condition' : 'Apparence', occurrences: 0, sumPct: 0, sumPoints: 0 };
                        map[v].defauts[k].occurrences += 1;
                        map[v].defauts[k].sumPct += parseFloat(d.percent) || 0;
                        map[v].defauts[k].sumPoints += parseFloat(d.points) || 0;
                    });
                });
                return Object.values(map).map(o => ({
                    variete: o.variete,
                    n: o.n,
                    avgPfq: o.n > 0 ? Math.round(o.sumPfq / o.n * 10) / 10 : 0,
                    topDefauts: Object.values(o.defauts).map(d => ({
                        name: d.name,
                        cat: d.cat,
                        occurrences: d.occurrences,
                        avgPct: d.occurrences > 0 ? Math.round(d.sumPct / d.occurrences * 10) / 10 : 0,
                        avgPoints: d.occurrences > 0 ? Math.round(d.sumPoints / d.occurrences * 10) / 10 : 0,
                        totalPoints: Math.round(d.sumPoints * 10) / 10,
                    })).sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 5),
                })).sort((a, b) => a.avgPfq - b.avgPfq); // pires PFQ en premier
            }, [filtered]);

            const pfqColor = (v) => v >= 85 ? 'var(--green)' : v >= 70 ? 'var(--blue)' : v >= 55 ? 'var(--orange)' : 'var(--red)';

            if (loading) {
                return <div className="tab-content fade-in"><Panel title="Écarts & Défauts — DQR Driscoll's" icon="fa-triangle-exclamation"><div style={{padding:40,textAlign:'center',color:'var(--gray-500)'}}>Chargement des DQR…</div></Panel></div>;
            }

            const views = [
                { id: 'top', label: 'Top Défauts', icon: 'fa-ranking-star' },
                { id: 'evolution', label: 'Évolution', icon: 'fa-chart-line' },
                { id: 'weekly', label: 'Hebdo Sat-Fri', icon: 'fa-calendar-week' },
                { id: 'daily', label: 'Journalier', icon: 'fa-calendar-day' },
                { id: 'variete', label: 'Par Variété', icon: 'fa-seedling' },
            ];

            const inputStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--gray-200)', fontSize: 13 };

            return (
                <div className="tab-content fade-in">
                    <Panel title="Écarts & Défauts — DQR Driscoll's" icon="fa-triangle-exclamation">
                        <div style={{padding:16}}>
                            {/* Filtres */}
                            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
                                <select value={filterVariete} onChange={e => setFilterVariete(e.target.value)} style={inputStyle}>
                                    <option value="">Toutes variétés</option>
                                    {varietes.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <select value={filterBerry} onChange={e => setFilterBerry(e.target.value)} style={inputStyle}>
                                    <option value="">Tous types</option>
                                    {berryTypes.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                                <select value={filterFerme} onChange={e => setFilterFerme(e.target.value)} style={inputStyle}>
                                    <option value="">Toutes fermes</option>
                                    {fermes.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
                                <button onClick={() => { setFilterVariete(''); setFilterBerry(''); setFilterFerme(''); setDateFrom(defaultFrom); setDateTo(defaultTo); }} style={{...inputStyle,cursor:'pointer',background:'var(--gray-50)'}}>Réinitialiser</button>
                            </div>

                            {/* KPI */}
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))',gap:12,marginBottom:20}}>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Lots</div>
                                    <div style={{fontSize:26,fontWeight:700,marginTop:4}}>{kpi.n}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>PFQ moyen</div>
                                    <div style={{fontSize:26,fontWeight:700,color:pfqColor(kpi.avgPfq),marginTop:4}}>{kpi.avgPfq}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Condition</div>
                                    <div style={{fontSize:22,fontWeight:700,marginTop:4}}>{kpi.avgCond}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Apparence</div>
                                    <div style={{fontSize:22,fontWeight:700,marginTop:4}}>{kpi.avgApp}</div>
                                </div>
                                <div style={{padding:14,background:'var(--gray-50)',borderRadius:10,textAlign:'center'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:1}}>Pass rate</div>
                                    <div style={{fontSize:22,fontWeight:700,color:kpi.passRate >= 80 ? 'var(--green)' : 'var(--orange)',marginTop:4}}>{kpi.passRate}%</div>
                                </div>
                            </div>

                            {/* Onglets internes */}
                            <div style={{display:'flex',gap:6,marginBottom:16,borderBottom:'1px solid var(--gray-200)',flexWrap:'wrap'}}>
                                {views.map(v => (
                                    <button key={v.id} onClick={() => setViewMode(v.id)} style={{padding:'8px 14px',background:viewMode===v.id?'var(--berry)':'transparent',color:viewMode===v.id?'#fff':'var(--gray-600)',border:'none',borderRadius:'8px 8px 0 0',cursor:'pointer',fontSize:13,fontWeight:600}}>
                                        <i className={'fa-solid '+v.icon} style={{marginRight:6}}></i>{v.label}
                                    </button>
                                ))}
                            </div>

                            {/* Vue Top Défauts */}
                            {viewMode === 'top' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Top défauts cumulés ({topDefauts.length})</h3>
                                    <div style={{maxHeight:600,overflowY:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                        <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
                                            <thead style={{position:'sticky',top:0,background:'var(--gray-50)'}}>
                                                <tr>
                                                    <th style={{textAlign:'left',padding:'8px 10px'}}>Défaut</th>
                                                    <th style={{textAlign:'left',padding:'8px 10px'}}>Catégorie</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>Occurr.</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>% moyen</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>Points moy.</th>
                                                    <th style={{textAlign:'right',padding:'8px 10px'}}>Points cumul.</th>
                                                    <th style={{textAlign:'left',padding:'8px 10px'}}>Variétés</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {topDefauts.map((d, i) => (
                                                    <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:600}}>{d.name}</td>
                                                        <td style={{padding:'6px 10px'}}><span style={{padding:'2px 8px',borderRadius:10,fontSize:11,background:d.cat==='Condition'?'rgba(244,67,54,0.1)':'rgba(33,150,243,0.1)',color:d.cat==='Condition'?'var(--red)':'var(--blue)'}}>{d.cat}</span></td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{d.occurrences}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{d.avgPct}%</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{d.avgPoints}</td>
                                                        <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{d.totalPoints}</td>
                                                        <td style={{padding:'6px 10px',fontSize:11}}>{d.varieties.slice(0, 4).join(', ')}{d.varieties.length > 4 ? '…' : ''}</td>
                                                    </tr>
                                                ))}
                                                {topDefauts.length === 0 && <tr><td colSpan={7} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucun défaut sur la période</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Vue Évolution */}
                            {viewMode === 'evolution' && (
                                <div>
                                    <div style={{display:'flex',gap:6,marginBottom:12}}>
                                        <button onClick={() => setEvolKey('avgPfqTotal')} style={{padding:'6px 12px',background:evolKey==='avgPfqTotal'?'var(--berry)':'var(--gray-50)',color:evolKey==='avgPfqTotal'?'#fff':'var(--gray-600)',border:'1px solid var(--gray-200)',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>PFQ Total</button>
                                        <button onClick={() => setEvolKey('split')} style={{padding:'6px 12px',background:evolKey==='split'?'var(--berry)':'var(--gray-50)',color:evolKey==='split'?'#fff':'var(--gray-600)',border:'1px solid var(--gray-200)',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>Condition vs Apparence</button>
                                    </div>
                                    {dailyAgg.length > 0 ? (
                                        evolKey === 'avgPfqTotal' ? (
                                            <SimpleAreaChart data={dailyAgg} dataKeys={['avgPfqTotal']} colors={['#9C27B0']} xKey="date" height={280} />
                                        ) : (
                                            <SimpleAreaChart data={dailyAgg} dataKeys={['avgCondition','avgApparence']} colors={['#F44336','#2196F3']} xKey="date" height={280} />
                                        )
                                    ) : (
                                        <div style={{padding:40,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée pour la période</div>
                                    )}
                                    <div style={{display:'flex',gap:16,marginTop:12,fontSize:12,color:'var(--gray-600)',justifyContent:'center'}}>
                                        {evolKey === 'split' ? (
                                            <>
                                                <span><span style={{display:'inline-block',width:10,height:10,background:'#F44336',borderRadius:2,marginRight:4}}></span>Condition</span>
                                                <span><span style={{display:'inline-block',width:10,height:10,background:'#2196F3',borderRadius:2,marginRight:4}}></span>Apparence</span>
                                            </>
                                        ) : (
                                            <span><span style={{display:'inline-block',width:10,height:10,background:'#9C27B0',borderRadius:2,marginRight:4}}></span>PFQ Total</span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Vue Hebdo Sat-Fri */}
                            {viewMode === 'weekly' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>PFQ moyen par variété et semaine (Samedi → Vendredi)</h3>
                                    <div style={{overflowX:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                        <table style={{width:'100%',fontSize:12,borderCollapse:'collapse',minWidth:600}}>
                                            <thead style={{background:'var(--gray-50)'}}>
                                                <tr>
                                                    <th style={{textAlign:'left',padding:'8px 10px',position:'sticky',left:0,background:'var(--gray-50)',zIndex:1}}>Variété</th>
                                                    {weeklyPivot.weeks.map(w => <th key={w.key} style={{textAlign:'center',padding:'8px 6px',whiteSpace:'nowrap'}}>{w.label}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {weeklyPivot.varieties.map(v => (
                                                    <tr key={v} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:600,position:'sticky',left:0,background:'#fff',zIndex:1}}>{v}</td>
                                                        {weeklyPivot.weeks.map(w => {
                                                            const cell = weeklyPivot.map[v] && weeklyPivot.map[v][w.key];
                                                            if (!cell) return <td key={w.key} style={{padding:'6px',textAlign:'center',color:'var(--gray-300)'}}>—</td>;
                                                            const avg = Math.round(cell.sumPfq / cell.n * 10) / 10;
                                                            return <td key={w.key} style={{padding:'6px',textAlign:'center'}}>
                                                                <div style={{fontWeight:700,color:pfqColor(avg)}}>{avg}</div>
                                                                <div style={{fontSize:10,color:'var(--gray-400)'}}>{cell.n} lot{cell.n>1?'s':''}</div>
                                                            </td>;
                                                        })}
                                                    </tr>
                                                ))}
                                                {weeklyPivot.varieties.length === 0 && <tr><td colSpan={(weeklyPivot.weeks.length||0)+1} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Vue Journalier */}
                            {viewMode === 'daily' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>PFQ moyen par variété et jour (14 derniers jours dans la plage)</h3>
                                    <div style={{overflowX:'auto',border:'1px solid var(--gray-100)',borderRadius:8}}>
                                        <table style={{width:'100%',fontSize:12,borderCollapse:'collapse',minWidth:600}}>
                                            <thead style={{background:'var(--gray-50)'}}>
                                                <tr>
                                                    <th style={{textAlign:'left',padding:'8px 10px',position:'sticky',left:0,background:'var(--gray-50)',zIndex:1}}>Variété</th>
                                                    {dailyPivot.dates.map(d => <th key={d} style={{textAlign:'center',padding:'8px 6px',whiteSpace:'nowrap'}}>{d.slice(5)}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dailyPivot.varieties.map(v => (
                                                    <tr key={v} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                        <td style={{padding:'6px 10px',fontWeight:600,position:'sticky',left:0,background:'#fff',zIndex:1}}>{v}</td>
                                                        {dailyPivot.dates.map(d => {
                                                            const cell = dailyPivot.map[v] && dailyPivot.map[v][d];
                                                            if (!cell) return <td key={d} style={{padding:'6px',textAlign:'center',color:'var(--gray-300)'}}>—</td>;
                                                            const avg = Math.round(cell.sumPfq / cell.n * 10) / 10;
                                                            return <td key={d} style={{padding:'6px',textAlign:'center'}}>
                                                                <div style={{fontWeight:700,color:pfqColor(avg)}}>{avg}</div>
                                                                <div style={{fontSize:10,color:'var(--gray-400)'}}>{cell.n}</div>
                                                            </td>;
                                                        })}
                                                    </tr>
                                                ))}
                                                {dailyPivot.varieties.length === 0 && <tr><td colSpan={(dailyPivot.dates.length||0)+1} style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune donnée</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Vue Par variété */}
                            {viewMode === 'variete' && (
                                <div>
                                    <h3 style={{fontSize:14,margin:'0 0 8px',color:'var(--gray-700)'}}>Détail par variété (triées du pire PFQ au meilleur)</h3>
                                    <div style={{display:'grid',gap:12}}>
                                        {varieteBreakdown.map(v => (
                                            <div key={v.variete} style={{border:'1px solid var(--gray-200)',borderRadius:10,padding:14,background:'#fff'}}>
                                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                                                    <div style={{fontWeight:700,fontSize:14}}>{v.variete}</div>
                                                    <div style={{display:'flex',gap:14,fontSize:12,color:'var(--gray-600)'}}>
                                                        <div>Lots: <strong>{v.n}</strong></div>
                                                        <div>PFQ moyen: <strong style={{color:pfqColor(v.avgPfq)}}>{v.avgPfq}</strong></div>
                                                    </div>
                                                </div>
                                                {v.topDefauts.length > 0 ? (
                                                    <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                                                        <thead><tr style={{background:'var(--gray-50)'}}>
                                                            <th style={{textAlign:'left',padding:'6px 10px'}}>Défaut</th>
                                                            <th style={{textAlign:'left',padding:'6px 10px'}}>Catégorie</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>Occurr.</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>% moyen</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>Pts moy.</th>
                                                            <th style={{textAlign:'right',padding:'6px 10px'}}>Pts cumul.</th>
                                                        </tr></thead>
                                                        <tbody>
                                                            {v.topDefauts.map((d, i) => (
                                                                <tr key={i} style={{borderBottom:'1px solid var(--gray-100)'}}>
                                                                    <td style={{padding:'5px 10px'}}>{d.name}</td>
                                                                    <td style={{padding:'5px 10px',fontSize:11,color:d.cat==='Condition'?'var(--red)':'var(--blue)'}}>{d.cat}</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{d.occurrences}</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{d.avgPct}%</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right'}}>{d.avgPoints}</td>
                                                                    <td style={{padding:'5px 10px',textAlign:'right',fontWeight:700,color:'var(--berry)'}}>{d.totalPoints}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                ) : (
                                                    <div style={{fontSize:12,color:'var(--gray-400)',padding:8}}>Aucun défaut détaillé</div>
                                                )}
                                            </div>
                                        ))}
                                        {varieteBreakdown.length === 0 && <div style={{padding:20,textAlign:'center',color:'var(--gray-400)'}}>Aucune variété sur la période</div>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </Panel>
                </div>
            );
        }


export {
  QualiteSuiviCalibreTab,
  QualitePFQInterneTab,
  QualiteBonsApportTab,
  QualiteDashboardTab,
  deduplicateExpeditions,
  QualiteInspectionsTab,
  QualiteHistoriqueTab,
  QualiteProductionTab,
  QualiteBrixTab,
  QualiteMarcheLocalTab,
  QualiteExpeditionsTab,
  QualiteReconciliationTab,
  QualiteLiquidationsTab,
  QualiteEcartsTab
};
