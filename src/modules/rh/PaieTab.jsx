/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): PaieTab */
import { PAIE_BAREMES_DEFAULT } from '../admin/PAIE_BAREMES_DEFAULT.jsx';
import { Panel } from '../shared/Panel.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';
import { __PaieDataCache } from './__PaieDataCache.jsx';
import { calculerPaieOuvrier } from './calculerPaieOuvrier.jsx';
import { loadPointageDistinctDays } from './loadPointageDistinctDays.jsx';

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

export { PaieTab };
