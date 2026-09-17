/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: recolte | Déclaration(s): CoutRecolteTab */
import { getCycle } from '../agronomie/getCycle.jsx';
import { getHaByCycle } from '../agronomie/getHaByCycle.jsx';
import { normalizeParcelle } from '../agronomie/normalizeParcelle.jsx';
import { KPICard } from '../shared/KPICard.jsx';
import { Panel } from '../shared/Panel.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { deriveSubFerme } from '../shared/deriveSubFerme.jsx';
import { invalidateCache } from '../shared/invalidateCache.jsx';
import { useState } from '../shared/reactHooks.jsx';

import * as RecolteKpiUtils from '../shared/lib/recolteKpiUtils.js';
import * as PaieUtils from '../shared/lib/paieUtils.js';
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
            // (brut + 26% charges patronales pour les déclarés) via PaieUtils.computePayslip.
            const [ouvriersRegistry, setOuvriersRegistry] = useState({}); // numKey(matricule) → {declare, baselineJours, primeFonctionJournaliere, ...}
            const [paieBaremes, setPaieBaremes] = useState((PaieUtils && PaieUtils.PAIE_BAREMES_DEFAULT) || {});
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
            // dérivée du modèle unifié PaieUtils.computePayslip. r.cout (BEE ONE) n'est PLUS la base
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
                const PU = (typeof window !== 'undefined' && PaieUtils) ? PaieUtils : null;
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
            const nbOuvriers = RecolteKpiUtils
                ? RecolteKpiUtils.distinctOuvriersFromRows(allFiltered)
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
                const RK = (typeof window !== 'undefined' && RecolteKpiUtils) ? RecolteKpiUtils : null;
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

export { CoutRecolteTab };
