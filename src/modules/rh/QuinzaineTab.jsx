/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: rh | Déclaration(s): QuinzaineTab */
import { matchCulture } from '../agronomie/matchCulture.jsx';
import { Panel } from '../shared/Panel.jsx';
import { SimpleBarChart } from '../shared/SimpleBarChart.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { deriveSubFerme } from '../shared/deriveSubFerme.jsx';
import { useEffect, useMemo, useState } from '../shared/reactHooks.jsx';
import { WorkerLink } from './WorkerLink.jsx';
import { _openEmargChefsPrintWindow } from './emargementChefsPrintWindow.jsx';
import { QuinzaineSousPopupOuvrier } from './QuinzaineSousPopupOuvrier.jsx';
import { QuinzaineEmargementPopup } from './QuinzaineEmargementPopup.jsx';
import { QuinzaineHeuresSupPopup } from './QuinzaineHeuresSupPopup.jsx';
import { QuinzainePopupGenerique } from './QuinzainePopupGenerique.jsx';
import { QuinzaineDetailParOuvrier } from './QuinzaineDetailParOuvrier.jsx';
import { QuinzaineChargesSocialesPopup } from './QuinzaineChargesSocialesPopup.jsx';

import * as CoutMainOeuvre from '../shared/lib/coutMainOeuvre.js';
import * as PaieUtils from '../shared/lib/paieUtils.js';
import * as PlafondDeclaration from '../shared/lib/plafondDeclaration.js';
import { QuinzaineCampagneSelect } from '../shared/QuinzaineCampagneSelect.jsx';
import { QuinzaineRecapCards } from './QuinzaineRecapCards.jsx';
import { nomOuvrier } from './nomOuvrier.jsx';
import { sbParcelle } from '../shared/sbParcelleState.js';
// ===================== QUINZAINE TAB =====================
        function QuinzaineTab({ data, farmFilter, farmLabel, avoSubFilter, cultureFilter, currentProfile, onNavigateToPrimes }) {
            const [apiData, setApiData] = useState(null);
            const [loading, setLoading] = useState(true);
            const [selectedPeriode, setSelectedPeriode] = useState('');
            const [transportDetail, setTransportDetail] = useState([]);
            const [transportExtras, setTransportExtras] = useState({});
            // Coût ouvrier CHARGÉ (salaire Smart Berry + primes de terrain +
            // charges patronales ET salariales), servi par quinzaine. Même
            // source que le repère de l'écran Campagne : un seul calcul, donc
            // deux écrans qui ne peuvent pas afficher deux coûts différents.
            const [coutOuvrierCampagne, setCoutOuvrierCampagne] = useState(null);
            const [recolteEquipeRows, setRecolteEquipeRows] = useState([]);
            // Heures supplémentaires ACCORDÉES sur la quinzaine — { matricule: montant NET }.
            // Le montant est une décision, pas un calcul : la badgeuse donne des
            // minutes, la paie accorde une somme. Les deux se lisent côte à côte
            // dans l'écran Heures Supplémentaires.
            //
            // ESTAMPILLÉ par sa quinzaine — `{ periode, montants, pret }` et non
            // une map nue. La map seule ne dit pas DE QUELLE quinzaine elle vient :
            // entre le changement de quinzaine et l'arrivée du document, deux
            // `await` s'enchaînent (`getIdToken()`, puis le `fetch`), et pendant
            // cette fenêtre l'ancienne map était appliquée aux ouvriers de la
            // nouvelle. Mesuré sur la Quinzaine 04 : la tuile affichait 950 DH,
            // la popup 450, et le NET À PAYER perdait 500 DH sans qu'on ait rien
            // enregistré. `pret` distingue « pas encore arrivé » de « arrivé
            // vide » — le premier ne doit RIEN publier en base.
            // `emargements` : états d'émargement SIGNÉS déposés, un par ferme.
            // Porté par le MÊME état (et la même réponse) que les montants : ils
            // vivent sur le même document `rh_heures_sup/<periode>`, et une
            // lecture séparée obligerait à l'attendre dans `_coherent`.
            const [hsMontants, setHsMontants] = useState({ periode: '', montants: {}, emargements: {}, pret: false });
            // Minutes de dépassement issues de la badgeuse — pièce justificative
            // affichée en regard du montant accordé. Jamais la source du montant.
            // Lignes BRUTES, toutes quinzaines confondues : l'agrégation par
            // quinzaine est DÉRIVÉE plus bas, jamais figée dans un état.
            const [hsMinutesRows, setHsMinutesRows] = useState([]);
            const [hsSaving, setHsSaving] = useState('');
            // BROUILLON de saisie des heures sup — ce qui est tapé mais pas
            // encore enregistré. ESTAMPILLÉ par sa quinzaine, comme
            // `hsMontants` : un brouillon sans période s'appliquerait aux
            // ouvriers de la quinzaine suivante après un changement de
            // sélection. Les champs sont CONTRÔLÉS par cet état, ce qui rend
            // inutile toute clé périodée sur les lignes : la valeur affichée
            // ne dépend plus du nœud DOM réutilisé par React.
            const [hsDraft, setHsDraft] = useState({ periode: '', valeurs: {} });
            // Ouvriers AJOUTÉS À LA MAIN dans la pop-up heures sup. La badgeuse
            // n'enregistre pas toujours le dépassement : sans ça, un ouvrier qui
            // a bien fait des heures reste invisible, donc non créditable.
            // Uniquement des ouvriers AYANT POINTÉ la quinzaine (présents dans
            // `_chargesSociales.detail`) : hors pointage, le montant serait un
            // fantôme, écrit en base mais absent de `_hsTotal`, de l'assiette de
            // cotisation et du coût employeur, qui itèrent tous sur les pointés.
            // ESTAMPILLÉ par sa quinzaine, comme `hsDraft` et `hsMontants`.
            const [hsAjouts, setHsAjouts] = useState({ periode: '', cles: [] });
            // Saisie du champ de recherche du sélecteur d'ajout, et ouverture de
            // sa liste. État de FRAPPE, pas de donnée : jamais enregistré.
            const [hsAjoutQuery, setHsAjoutQuery] = useState('');
            const [hsAjoutOuvert, setHsAjoutOuvert] = useState(false);
            const [transportPopup, setTransportPopup] = useState(null);
            const [analytiqueData, setAnalytiqueData] = useState([]);
            const [analytiqueFullscreen, setAnalytiqueFullscreen] = useState(false);
            const [analytiqueCultureIdx, setAnalytiqueCultureIdx] = useState(0);
            const [analytiqueTotalMode, setAnalytiqueTotalMode] = useState(false);
            // Sélecteur local (panneau Affectation Analytique uniquement) : permet de
            // consulter une quinzaine différente de la quinzaine globale de l'onglet, ou
            // d'agréger sur une campagne entière. analytiqueScopeData === null → aucun
            // override, le panneau lit analytiqueData (comportement historique inchangé).
            const [analytiqueScopeMode, setAnalytiqueScopeMode] = useState('quinzaine');
            const [analytiqueScopeValue, setAnalytiqueScopeValue] = useState('');
            const [analytiqueScopeData, setAnalytiqueScopeData] = useState(null);
            const [analytiqueScopeLoading, setAnalytiqueScopeLoading] = useState(false);
            const [detailEquipeFilter, setDetailEquipeFilter] = useState('');
            const [detailSearch, setDetailSearch] = useState('');
            useEffect(() => {
                if (!analytiqueFullscreen) return;
                const onKey = (e) => { if (e.key === 'Escape') setAnalytiqueFullscreen(false); };
                window.addEventListener('keydown', onKey);
                const prev = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
            }, [analytiqueFullscreen]);
            const [reposData, setReposData] = useState(null);
            const [alertesData, setAlertesData] = useState(null);
            const [expandedReposEquipe, setExpandedReposEquipe] = useState(null);
            const [quinzPopupKey, setQuinzPopupKey] = useState(null);
            const [quinzGroupBy, setQuinzGroupBy] = useState('equipe');
            const [quinzSubWorker, setQuinzSubWorker] = useState(null);
            const [quinzSearch, setQuinzSearch] = useState('');
            const [quinzPaieBaremes, setQuinzPaieBaremes] = useState((PaieUtils && PaieUtils.PAIE_BAREMES_DEFAULT) || {});
            const [quinzRegistry, setQuinzRegistry] = useState({});
            const [quinzChargesPopup, setQuinzChargesPopup] = useState(null);
            const [analytiqueView, setAnalytiqueView] = useState('jh');
            const [analytiqueDetailCell, setAnalytiqueDetailCell] = useState(null);
            // Toggle Récap (défaut) / Détail du panneau Affectation Analytique. State
            // gardé ICI et non dans AffectationAnalytiqueTable, comme ses 4 voisins :
            // l'early-return `if (loading)` ci-dessous démonte l'enfant à chaque
            // changement de quinzaine globale, ce qui ferait silencieusement retomber
            // le panneau en Récap alors que les pills voisines (Ha/Total, JH/Coût)
            // conservent leur valeur.
            const [analytiqueDetailMode, setAnalytiqueDetailMode] = useState(false);
            const [emargementOpen, setEmargementOpen] = useState(false);
            const [emargementLang, setEmargementLang] = useState('fr'); // 'fr' | 'ar'
            const [emargementLoading, setEmargementLoading] = useState(false);
            const [diversData, setDiversData] = useState(null); // {total, dates, byDate, rows} — Location & Engins
            const [diversPopupOpen, setDiversPopupOpen] = useState(false);
            const [rapprochementOpen, setRapprochementOpen] = useState(false);

            // INSTANTANÉ DU COÛT — cet écran fait foi, il enregistre son chiffre.
            //
            // L'écran Campagne ne le recalcule plus : trois tentatives de le
            // reproduire ont produit trois divergences (transport résolu au
            // mauvais format de date, préfixe d'équipe deviné, part salariale
            // comptée d'un seul côté). Il relit maintenant ce total tel quel, et
            // l'écart qu'il affiche redevient un écart RÉEL entre deux mesures.
            //
            // Le ref est renseigné pendant le rendu (aucun re-rendu déclenché) et
            // lu par l'effet ci-dessous, APRÈS le rendu — les totaux ne sont
            // calculés que dans le corps du composant, hors de portée d'un hook.
            const _snapshotRef = React.useRef(null);
            const _snapshotEnvoye = React.useRef({});
            // ÉTAT VISIBLE de l'enregistrement. Sans lui, un échec est
            // indiscernable d'un succès : l'écran Campagne affiche « — » et
            // personne ne sait s'il faut attendre, changer un filtre, ou
            // signaler un bug. Une opération qui réussit à vide ne prouve rien.
            const [snapEtat, setSnapEtat] = useState({ etat: 'attente', message: 'en attente du calcul' });
            // L'effet ci-dessous n'a PAS de tableau de dépendances : il tourne
            // après chaque rendu, parce que le total n'est calculé que dans le
            // corps du composant, hors de portée d'un hook. Poser un état avec
            // un objet neuf y déclencherait un rendu, donc l'effet, donc un
            // rendu — React ne peut pas court-circuiter, `Object.is` compare
            // deux littéraux distincts. On ne pose donc l'état que s'il CHANGE.
            const _snapEtatRef = React.useRef('attente|en attente du calcul');
            const majEtat = (etat, message) => {
                const cle = etat + '|' + message;
                if (_snapEtatRef.current === cle) return;
                _snapEtatRef.current = cle;
                setSnapEtat({ etat: etat, message: message });
            };
            React.useEffect(() => {
                const snap = _snapshotRef.current;
                if (!snap) { majEtat('attente', 'calcul en cours — écran pas encore complet'); return; }
                if (!snap.pleinPerimetre) {
                    majEtat('refus', 'un filtre est actif — retire ferme / culture / sous-ferme');
                    return;
                }
                if (!(snap.coutEmployeur > 0)) {
                    majEtat('attente', 'coût non encore calculé');
                    return;
                }
                // Dédoublonnage sur la VALEUR, pas sur la période : le total se
                // stabilise après plusieurs rendus (chargements successifs), et
                // republier un chiffre identique à chaque rendu inonderait
                // l'écriture sans rien changer au document.
                // La VERSION entre dans la clé : sans elle, un instantané déjà
                // enregistré ne repartirait pas quand la charge utile s'enrichit
                // (le montant, lui, n'a pas bougé). L'écran Campagne relirait
                // alors indéfiniment un document amputé des nouveaux champs, et
                // afficherait « ? » sans qu'on sache qu'il suffit de rouvrir.
                // À incrémenter à CHAQUE ajout de champ.
                // Le NET À PAYER entre dans la clé : lui seul porte la
                // sous-traitance. Avec le coût employeur seul, un instantané
                // amputé de ses divers ne repartait jamais.
                const cle = 'v4|' + snap.periode + '|' + Math.round(snap.coutEmployeur)
                    + '|' + Math.round(snap.netAPayer || 0);
                if (_snapshotEnvoye.current[cle]) return;
                _snapshotEnvoye.current[cle] = true;
                // Route `/api/pointage-rh` — la SEULE mappée vers `pointageV3` dans
                // firebase.json. `/api/pointage` n'existe pas : elle retombe sur
                // index.html, `r.json()` lève sur du HTML, et le `catch` avalait
                // tout. Aucun instantané n'a jamais été écrit, et rien ne l'a
                // jamais signalé — d'où le voyant d'état ci-dessus.
                fetch('/api/pointage-rh?action=cout-quinzaine-save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(snap),
                }).then(r => r.json()).then(j => {
                    if (j && j.success) {
                        majEtat('ok', 'enregistré pour la Campagne');
                        return;
                    }
                    // On REJOUE en cas de refus : le garder marqué comme
                    // envoyé condamnerait la période pour toute la session.
                    delete _snapshotEnvoye.current[cle];
                    majEtat('erreur', (j && j.error) || 'refus sans motif');
                }).catch(e => {
                    delete _snapshotEnvoye.current[cle];
                    majEtat('erreur', e.message);
                });
            });
            const [syncingBeeOne, setSyncingBeeOne] = useState(false);
            const [syncBeeOneResult, setSyncBeeOneResult] = useState(null);
            const [emargChefs, setEmargChefs] = React.useState({ loading: false, error: null });
            const [detailOuvrierFullscreen, setDetailOuvrierFullscreen] = useState(false);
            useEffect(() => {
                if (!detailOuvrierFullscreen) return;
                const onKey = (e) => { if (e.key === 'Escape') setDetailOuvrierFullscreen(false); };
                window.addEventListener('keydown', onKey);
                const prev = document.body.style.overflow;
                document.body.style.overflow = 'hidden';
                return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
            }, [detailOuvrierFullscreen]);

            const numKey = (m) => String(m || '').toUpperCase().replace(/[^0-9]/g, '');
            const f2 = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');

            async function handleSyncDepuisBeeOne() {
                if (syncingBeeOne) return;
                setSyncingBeeOne(true);
                setSyncBeeOneResult(null);
                try {
                    const token = await firebase.auth().currentUser.getIdToken();
                    const currentPeriode = selectedPeriode || (apiData && (apiData.periodes || [])[0]) || '';
                    const resp = await fetch('/api/pointage-rh?action=force-sync-periode', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ periode: currentPeriode }),
                    });
                    const d = await resp.json();
                    if (d.success) {
                        setSyncBeeOneResult({ ok: true, msg: 'Sync terminée — ' + d.totalRows + ' lignes (' + d.from + ' → ' + d.to + ')' });
                        // Bug fix (2026-08-06) : `setApiData(null)` seul ne déclenche AUCUN
                        // refetch (le useEffect de montage `loadData()` ne dépend pas de
                        // apiData) — la page restait bloquée sur "Erreur chargement" jusqu'à
                        // un F5 manuel. On appelle loadData() directement, comme le fait
                        // déjà handlePeriodeChange, SANS blanchir apiData au préalable (évite
                        // le flash "Erreur chargement" pendant le refetch).
                        setLoading(true);
                        loadData(currentPeriode);
                    } else {
                        setSyncBeeOneResult({ ok: false, msg: d.error || 'Erreur sync' });
                    }
                } catch (e) {
                    setSyncBeeOneResult({ ok: false, msg: e.message });
                } finally {
                    setSyncingBeeOne(false);
                }
            }

            async function handleEmargementChefsFerme() {
              if (emargChefs.loading) return;
              // Ouvrir la fenêtre AVANT tout await — Safari bloque window.open() appelé
              // après une opération async (hors contexte du geste utilisateur).
              var _pw = window.open('', '_blank', 'width=1300,height=900');
              if (!_pw) { setEmargChefs({ loading: false, error: 'Popup bloquée — autorisez les popups pour ce site' }); return; }
              setEmargChefs({ loading: true, error: null });
              try {
                var _token = await firebase.auth().currentUser.getIdToken();
                var _resp = await fetch('/api/pointage-rh?action=emargement-chefs-ferme&periode=' + encodeURIComponent(currentPeriode || selectedPeriode || ''), {
                  headers: { 'Authorization': 'Bearer ' + _token }
                });
                var _data = await _resp.json();
                if (!_data.success) throw new Error(_data.error || 'Erreur génération');
                _openEmargChefsPrintWindow(_data, _pw);
                setEmargChefs({ loading: false, error: null });
              } catch(_e2) {
                _pw.close();
                setEmargChefs({ loading: false, error: _e2.message });
              }
            }


            // Anti-flicker cartes MO : tant que registre + barèmes ne sont pas résolus,
            // les cartes MO affichent un skeleton (montant null) au lieu de l'estimation
            // BDP qui sautait ensuite vers le net Smart Berry (2-3 valeurs successives).
            // En cas d'échec réseau → resolved quand même → fallback BDP (comportement
            // dégradé identique à avant).
            const [quinzBaremesResolved, setQuinzBaremesResolved] = useState(false);
            const [quinzRegistryResolved, setQuinzRegistryResolved] = useState(false);
            // Journées pointées DEPUIS le socle d'ancienneté de chaque ouvrier.
            // Sans elles, l'ancienneté restait figée à la photo du 30/04 et ne
            // progressait jamais — l'écran Campagne, lui, cumulait déjà.
            const [joursDepuisSocle, setJoursDepuisSocle] = useState({});

            React.useEffect(() => {
                const db = firebase.firestore();
                let cancelled = false;
                db.collection('app_settings').doc('paie_baremes').get()
                    .then(doc => { if (!cancelled && doc.exists) setQuinzPaieBaremes(prev => ({ ...prev, ...doc.data() })); })
                    .catch(e => console.warn('quinz paie_baremes:', e))
                    .finally(() => { if (!cancelled) setQuinzBaremesResolved(true); });
                return () => { cancelled = true; };
            }, []);

            React.useEffect(() => {
                let cancelled = false;
                // Arrêté à la FIN de la quinzaine affichée : l'ancienneté d'une
                // quinzaine passée ne doit pas bénéficier des journées
                // travaillées depuis. Sans période, on prend aujourd'hui.
                const _fin = (apiData && apiData.parJour && apiData.parJour.length)
                    ? apiData.parJour.map(d => d && d.jour).filter(Boolean).sort().pop()
                    : '';
                fetch('/api/pointage-rh?action=anciennete-cumul'
                    + (_fin ? '&jusqua=' + encodeURIComponent(_fin) : ''))
                    .then(r => r.json()).then(j => {
                        if (!cancelled && j && j.success) setJoursDepuisSocle(j.cumul || {});
                    }).catch(e => console.warn('anciennete-cumul:', e));
                return () => { cancelled = true; };
            }, [apiData]);

            React.useEffect(() => {
                let cancelled = false;
                fetch('/api/registry?action=get-registry').then(r => r.json()).then(resp => {
                    if (cancelled || !resp || !resp.success) return;
                    const reg = {};
                    (resp.ouvriers || []).forEach(o => { reg[numKey(o.matricule)] = o; });
                    if (!cancelled) setQuinzRegistry(reg);
                }).catch(e => console.warn('quinz registry:', e))
                  .finally(() => { if (!cancelled) setQuinzRegistryResolved(true); });
                return () => { cancelled = true; };
            }, []);

            // Transport config & prefix helper
            const transportConfig = data.transportConfig || [];
            // currentPeriode doit être calculé AVANT coutMap : getCoutTransport est versionné
            // par quinzaine et selectedPeriode reste '' tant que l'user ne change pas la sélection.
            // Utiliser apiData.periodes[0] comme fallback pour obtenir le bon tarif historique.
            const _periodeForCout = selectedPeriode || (apiData ? (apiData.periodes || [])[0] : null) || null;
            const coutMap = {};
            transportConfig.forEach(t => { coutMap[t.prefix] = (data.getCoutTransport ? data.getCoutTransport(t.prefix, _periodeForCout) : t.coutParOuvrier) || t.coutParOuvrier || 0; });
            const getEqPrefix = (mat) => {
                if (!mat) return 'NV';
                const m = mat.toUpperCase().trim();
                const p2 = m.substring(0, 2);
                if (transportConfig.find(t => t.prefix === p2)) return p2;
                if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
                if (m.startsWith('DD')) return 'NV';
                return null;
            };

            // Map prefix to equipe name
            const prefixToName = {};
            transportConfig.forEach(t => { prefixToName[t.prefix] = t.equipe; });

            const calcPrime = (kg, variete, date) => { const k = kg || 0; const isMyr = /corina|corrina|cascade|breeze|myrtille|blue/i.test(variete || ''); if (isMyr) { const seuil = /breeze/i.test(variete || '') ? 25 : /cascade/i.test(variete || '') ? ((date || '') >= '2026-04-25' ? 30 : 25) : 30; return k > seuil ? Math.round((k - seuil) * 2.5 * 10) / 10 : 0; } if (k < 20) return 0; if (k < 25) return 20; if (k < 30) return 40; if (k < 40) return Math.round((60 + (k - 30) * 3) * 10) / 10; return Math.round((90 + (k - 40) * 4) * 10) / 10; };

            const loadData = (periode) => {
                // Reset Phase 2 state to avoid stale data from previous period
                setAnalytiqueData([]);
                setReposData(null);
                setAlertesData(null);

                const pq = periode ? `&periode=${encodeURIComponent(periode)}` : '';
                const fetchFn = periode ? (url) => fetch(url).then(r => r.json()) : cachedFetch;

                // Phase 1: critical data → unblock rendering
                Promise.all([
                    fetchFn(`/api/pointage-rh?action=quinzaine${pq}`),
                    // La période est transmise ici AUSSI : sans elle, le payload
                    // transport ne couvrait que les deux quinzaines les plus
                    // récentes, et les blocs Transport / Autres primes / Jours
                    // fériés se vidaient dès qu'on consultait une quinzaine plus
                    // ancienne — pendant que les KPI du haut, eux, restaient
                    // justes (ils viennent de l'action `quinzaine`, qui reçoit
                    // la période depuis toujours).
                    fetchFn(`/api/pointage-rh?action=transport${pq}`),
                    cachedFetch('/api/pointage-rh?action=recolte-equipes'),
                ]).then(([quinz, trData, recolteEq]) => {
                    if (quinz.success) setApiData(quinz);
                    if (trData.success) {
                        setTransportDetail(trData.rows || []);
                        setTransportExtras({ conditionnementDetail: trData.conditionnementDetail || [], chargementDetail: trData.chargementDetail || [], jourFerieDetail: trData.jourFerieDetail || [] });
                    }
                    if (recolteEq.success) setRecolteEquipeRows(recolteEq.rows || []);
                }).catch(err => console.warn(err)).finally(() => setLoading(false));

                // Minutes badgées, TOUTES quinzaines (action publique, cachée).
                // On ne filtre plus ici : au montage `loadData()` est appelé sans
                // argument, la période était donc vide et le garde-fou
                // `if (per && …)` ne retenait RIEN — la colonne « Badgé » cumulait
                // la campagne entière. Le filtrage vit désormais dans le mémo
                // `hsMinutes`, qui connaît la quinzaine réellement affichée.
                cachedFetch('/api/pointage-rh?action=heures-sup').then(json => {
                    if (!json || !json.success) return;
                    setHsMinutesRows(json.rows || []);
                }).catch(() => {});

                // Phase 2: supplementary data → appears when ready
                // parcelles-campagne-list est fetché en parallèle pour éviter le race condition avec sbLoad.
                // SB_PARCELLE_CAMPAGNE est peuplé avant setAnalytiqueData pour que sbParcelleHa soit correct.
                Promise.all([
                    fetchFn(`/api/pointage-rh?action=quinzaine-analytique${pq}`),
                    fetch('/api/pointage-rh?action=parcelles-campagne-list').then(function(r){return r.json();}).catch(function(){return {};})
                ]).then(function(results) {
                    var d = results[0];
                    var campagne = results[1];
                    if (campagne.success) {
                        var supMap = {};
                        (campagne.campagne_courante || []).concat(campagne.campagne_precedente || []).forEach(function(p) {
                            var key = (p.label || '').toUpperCase().trim();
                            if (key && p.sup > 0) supMap[key] = p.sup;
                        });
                        sbParcelle.CAMPAGNE = supMap;
                    }
                    if (d.success) setAnalytiqueData(d.rows || []);
                }).catch(function(e) { console.warn('quinzaine-analytique:', e); });

                // Coût ouvrier chargé — un seul appel pour toute la campagne
                // (l'action est cachée 30 min côté serveur), la quinzaine
                // affichée est ensuite retrouvée dans `parQuinzaine`.
                fetch('/api/pointage-rh?action=campagne-cout-ouvrier')
                    .then(function(r) { return r.json(); })
                    .then(function(d) { if (d && d.success) setCoutOuvrierCampagne(d); })
                    .catch(function() { /* indisponible → tuiles masquées */ });
                fetchFn(`/api/pointage-rh?action=quinzaine-repos${pq}`)
                    .then(d => { if (d.success) setReposData(d); })
                    .catch(e => console.warn('quinzaine-repos:', e));
                fetchFn(`/api/pointage-rh?action=quinzaine-alertes${pq}`)
                    .then(d => { if (d.success) setAlertesData(d); })
                    .catch(e => console.warn('quinzaine-alertes:', e));
            };

            React.useEffect(() => { loadData(); }, []);

            // Fetch Pointage Divers (Location & Engins) pour la quinzaine affichée.
            // useEffect séparé car loadData() n'est pas async — déclenché par selectedPeriode
            // qui change à chaque changement de quinzaine via handlePeriodeChange.
            // Rules of Hooks : placé avant tout early-return.
            React.useEffect(() => {
                var periode = selectedPeriode;
                // On attend que apiData soit chargé pour connaître la période par défaut.
                if (!periode && !apiData) return;
                var pUrl = '/api/validation?action=divers-entries-range' + (periode ? '&periode=' + encodeURIComponent(periode) : '');
                fetch(pUrl).then(function(r) { return r.json(); }).then(function(j) {
                    if (!j || !j.success) return;
                    var totalDivers = 0;
                    var prestSet = {};
                    var rowsByDate = {};
                    (j.dates || []).forEach(function(d) {
                        var dayData = (j.byDate || {})[d] || { entries: [], totalMontant: 0 };
                        totalDivers += dayData.totalMontant || 0;
                        rowsByDate[d] = dayData;
                        (dayData.entries || []).forEach(function(e) {
                            var key = (e.beneficiaire || e.matricule || '?') + '|' + (e.fonction || '');
                            if (key) prestSet[key] = { beneficiaire: e.beneficiaire || '', matricule: e.matricule || '', fonction: e.fonction || '' };
                        });
                    });
                    // Calcul des agrégats (même logique que DiversQuinzaineSub)
                    var bySt = {};
                    (j.dates || []).forEach(function(d) {
                        ((rowsByDate[d] || {}).entries || []).forEach(function(e) {
                            var key = (e.matricule || e.beneficiaire || '?') + '|' + (e.fonction || '');
                            if (!bySt[key]) bySt[key] = { matricule: e.matricule || '', beneficiaire: e.beneficiaire || '', fonction: e.fonction || '', byDay: {}, totQ: 0, totM: 0 };
                            var cur = bySt[key].byDay[d] || { q: 0, m: 0 };
                            cur.q += Number(e.quantite) || 0; cur.m += Number(e.montant) || 0;
                            bySt[key].byDay[d] = cur;
                            bySt[key].totQ += Number(e.quantite) || 0; bySt[key].totM += Number(e.montant) || 0;
                        });
                    });
                    var rows = Object.values(bySt).sort(function(a, b) { return b.totM - a.totM; });
                    // La PÉRIODE est mémorisée avec la donnée : elle seule permet de
                    // savoir si ces divers correspondent à la quinzaine affichée.
                    // Sans elle, l'instantané pouvait être enregistré avec une
                    // sous-traitance encore à zéro — c'est arrivé sur la
                    // Quinzaine 01 (7 950 DH manquants, 2026-08-22).
                    setDiversData({ total: Math.round(totalDivers), dates: j.dates || [],
                        byDate: rowsByDate, rows: rows,
                        periode: periode || ((apiData && apiData.periode) || '') });
                }).catch(function(e) { console.warn('quinzaine divers:', e); });
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [selectedPeriode, apiData && (apiData.periodes || [])[0]]);

            const handlePeriodeChange = (p) => {
                setSelectedPeriode(p);
                setLoading(true);
                loadData(p);
                // Reset de l'override local du panneau Affectation Analytique : un
                // changement de quinzaine globale invalide toute sélection quinzaine/campagne
                // locale précédente (évite d'afficher des données périmées).
                setAnalytiqueScopeMode('quinzaine');
                setAnalytiqueScopeValue('');
                setAnalytiqueScopeData(null);
            };

            // Ces deux useMemo DOIVENT être placés AVANT les early-returns (rules of hooks).
            // Les variables dérivées (transportRows, parJour, currentPeriode, classifyMO)
            // sont recalculées inline en utilisant uniquement les variables d'état.
            const _parcelleEmpCostMap = useMemo(() => {
                if (!apiData || !quinzBaremesResolved || !quinzRegistryResolved) return { ready: false, byParcelle: {} };
                const _PU2 = PaieUtils;
                if (!_PU2 || !_PU2.computePayslip || Object.keys(quinzRegistry).length === 0) return { ready: false, byParcelle: {} };
                const _cp = selectedPeriode || (apiData.periodes || [])[0] || '';
                const _pj = apiData.parJour || [];
                const _firstDay = _pj.length > 0 ? _pj[0].jour : null;
                const _smag = (_PU2.resolveSmagForDate)
                    ? _PU2.resolveSmagForDate(quinzPaieBaremes, _firstDay)
                    : { smagBrutJournalier: quinzPaieBaremes.smagBrutJournalier || 0, smagNetJournalier: quinzPaieBaremes.smagNetJournalier || 0 };
                const _tRows = transportDetail.filter(r => (r.periode||'').trim() === _cp.trim() && (!farmFilter || r.ferme === farmFilter) && (!avoSubFilter || deriveSubFerme(r.refParcelle, r.parcelle) === avoSubFilter) && matchCulture(r, cultureFilter));
                const _dailyEmpCost = {};
                const allMats = new Set([
                    ..._tRows.map(r => r.matricule),
                    ...recolteEquipeRows.filter(r => (r.periode||'').trim() === _cp.trim() && (!farmFilter || r.ferme === farmFilter) && matchCulture(r, cultureFilter)).map(r => r.matricule),
                ]);
                allMats.forEach(mat => {
                    if (!mat) return;
                    const _rw = quinzRegistry[numKey(mat)] || {};
                    const _isDecl = !!(_rw.declare);
                    if (_isDecl) {
                        const _pfJ = (function(history, currentPrime, dateStr) {
                            if (!dateStr || !Array.isArray(history) || history.length === 0) return Number(currentPrime || 0);
                            var applicable = history.filter(function(h) { return h.effectiveFrom && h.effectiveFrom <= dateStr; });
                            if (applicable.length === 0) { var s = history.slice().sort(function(a,b){return a.effectiveFrom<b.effectiveFrom?-1:1;}); return Number(s[0].previousMontant||0); }
                            var s2 = applicable.slice().sort(function(a,b){return a.effectiveFrom<b.effectiveFrom?1:-1;}); return Number(s2[0].montant||0);
                        })(_rw.prime_history, _rw.primeFonctionJournaliere, _firstDay);
                        const _anc = Number(_rw.baselineJours || 0);
                        const _ancP = (_PU2.trouverPalierAnciennete)
                            ? _PU2.trouverPalierAnciennete(_anc, quinzPaieBaremes.paliers || [])
                            : { pourcentage: 0 };
                        const _ancT = (_ancP.pourcentage || 0) / 100;
                        const _ps = _PU2.computePayslip({
                            declare: true,
                            smagBrut: _smag.smagBrutJournalier, smagNet: _smag.smagNetJournalier,
                            jT: 1, jF: 0,
                            ancienneteTaux: _ancT, primeFonctionJour: _pfJ,
                            primesOptionnelles: [], baremes: quinzPaieBaremes,
                        });
                        _dailyEmpCost[mat] = _ps.coutEmployeur;
                    } else {
                        _dailyEmpCost[mat] = _smag.smagNetJournalier || 0;
                    }
                });
                const byParcelle = {};
                const addRow = (r, parcelle) => {
                    if (!parcelle || !r.matricule) return;
                    if (!byParcelle[parcelle]) byParcelle[parcelle] = 0;
                    byParcelle[parcelle] += (_dailyEmpCost[r.matricule] || 0);
                };
                _tRows.forEach(r => addRow(r, r.parcelle));
                recolteEquipeRows
                    .filter(r => (r.periode||'').trim() === _cp.trim() && (!farmFilter || r.ferme === farmFilter))
                    .forEach(r => addRow(r, r.parcelle || r.refParcelle));
                return { ready: true, byParcelle };
            }, [apiData, quinzRegistry, quinzPaieBaremes, quinzBaremesResolved, quinzRegistryResolved, transportDetail, recolteEquipeRows, selectedPeriode, farmFilter, avoSubFilter, cultureFilter]);

            // Heures sup accordées : lecture GATÉE, déclenchée par la période
            // RÉELLEMENT affichée. Deux pièges évités ici :
            //  - la déclencher depuis `loadData(periode)` ne marche pas : au premier
            //    chargement l'argument est vide, la quinzaine par défaut n'étant
            //    résolue qu'APRÈS la réponse de l'API ;
            //  - ce hook doit rester AU-DESSUS des `return` anticipés ci-dessous,
            //    sinon l'ordre des hooks change quand `loading` bascule et React
            //    casse net.
            const _periodeHS = selectedPeriode || (apiData && (apiData.periodes || [])[0]) || '';
            useEffect(() => {
                let annule = false;
                // L'estampille est posée AVANT les `await`, pas après : sans elle,
                // la map de la quinzaine précédente restait en place pendant toute
                // la durée du jeton + du fetch, et s'appliquait aux ouvriers de la
                // nouvelle quinzaine.
                if (!_periodeHS) { setHsMontants({ periode: '', montants: {}, emargements: {}, pret: true }); return undefined; }
                setHsMontants({ periode: _periodeHS, montants: {}, emargements: {}, pret: false });
                (async () => {
                    try {
                        const tok = (firebaseAuth && firebaseAuth.currentUser)
                            ? await firebaseAuth.currentUser.getIdToken() : null;
                        const r = await fetch('/api/primes?action=heures-sup-montants&periode='
                            + encodeURIComponent(_periodeHS),
                            { headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
                        // INVARIANT : `pret: true` UNIQUEMENT sur une réponse HTTP
                        // OK dont le corps est un JSON `success: true`.
                        //
                        // Un `fetch` qui ne jette pas ne prouve rien : un 500/502
                        // de Cloud Functions (cold start, page HTML d'erreur) ou un
                        // 403 JSON arrive ici sans exception. Le `.catch` du
                        // `r.json()` interceptait même l'échec de parsing AVANT le
                        // `catch` externe. On posait donc `montants: {}` avec
                        // `pret: true` — `_coherent` passait, et l'instantané
                        // partait avec `heuresSup = 0`. Écriture destructrice :
                        // `cout-quinzaine-save` fait un `set(..., { merge: false })`
                        // sur `rh_cout_quinzaine/{periode}`, donc l'instantané juste
                        // était ÉCRASÉ — coût employeur et net à payer amputés des
                        // heures sup, sans le moindre signal.
                        const d = r.ok ? await r.json().catch(() => null) : null;
                        if (annule) return;
                        if (!d || d.success !== true) {
                            setHsMontants({ periode: _periodeHS, montants: {}, emargements: {}, pret: false });
                            return;
                        }
                        setHsMontants({ periode: _periodeHS, montants: d.montants || {}, emargements: d.emargements || {}, pret: true });
                    } catch (e) {
                        // `pret` reste FAUX : une lecture en échec n'est pas une
                        // quinzaine sans heures sup. Publier 0 en base sur cette
                        // base-là inventerait une donnée. L'écran affiche « calcul
                        // en cours » via `snapEtat`, ce qui est la vérité.
                        if (!annule) setHsMontants({ periode: _periodeHS, montants: {}, emargements: {}, pret: false });
                    }
                })();
                return () => { annule = true; };
            }, [_periodeHS]);

            // Map réellement utilisable pour le rendu : celle de la quinzaine
            // AFFICHÉE, jamais celle qui traîne. Une estampille qui ne correspond
            // pas vaut absence de donnée, pas donnée de l'autre quinzaine.
            const hsMontantsCourants = (hsMontants.periode === _periodeHS && hsMontants.montants)
                ? hsMontants.montants : {};
            // Même règle pour les états d'émargement : ceux d'une autre
            // quinzaine feraient passer une ferme pour à jour alors qu'elle n'a
            // rien rendu sur celle-ci.
            const hsEmargementsCourants = (hsMontants.periode === _periodeHS && hsMontants.emargements)
                ? hsMontants.emargements : {};
            // Minutes badgées AGRÉGÉES sur la quinzaine affichée. Dérivées des
            // lignes brutes : l'agrégation figée dans un état cumulait toutes les
            // quinzaines de la campagne, `loadData()` étant appelé sans argument
            // au montage (la période par défaut n'est connue qu'APRÈS la réponse
            // de l'API) — le garde-fou par période ne filtrait alors rien.
            const hsMinutes = React.useMemo(() => {
                const acc = {};
                if (!_periodeHS) return acc;
                (hsMinutesRows || []).forEach((r) => {
                    if (!r || r.periode !== _periodeHS) return;
                    const k = numKey(r.matricule);
                    if (!k) return;
                    acc[k] = (acc[k] || 0) + (Number(r.overtimeMin) || 0);
                });
                return acc;
            }, [hsMinutesRows, _periodeHS]);

            // Le brouillon appartient à UNE quinzaine : changer de quinzaine le
            // vide. Sans ça, un montant tapé sur la Quinzaine 04 puis abandonné
            // resterait affiché — et enregistrable — sur la Quinzaine 05.
            React.useEffect(() => {
                setHsDraft(prev => (prev.periode === _periodeHS ? prev : { periode: _periodeHS, valeurs: {} }));
            }, [_periodeHS]);
            // Même règle pour les ouvriers ajoutés à la main : une ligne ouverte
            // sur la Quinzaine 04 n'a rien à faire sur la 05. La saisie de
            // recherche se vide avec, elle ne désigne plus les mêmes candidats.
            React.useEffect(() => {
                setHsAjouts(prev => (prev.periode === _periodeHS ? prev : { periode: _periodeHS, cles: [] }));
                setHsAjoutQuery('');
                setHsAjoutOuvert(false);
            }, [_periodeHS]);
            // Brouillon RÉELLEMENT applicable : celui de la quinzaine affichée.
            const hsDraftCourant = (hsDraft.periode === _periodeHS && hsDraft.valeurs)
                ? hsDraft.valeurs : {};
            // Ajouts RÉELLEMENT applicables : ceux de la quinzaine affichée.
            const hsAjoutsCourants = (hsAjouts.periode === _periodeHS && Array.isArray(hsAjouts.cles))
                ? hsAjouts.cles : [];

            if (loading) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--gray-400)'}}><div style={{fontSize:36,marginBottom:8}}>🍇</div><i className="fa-solid fa-spinner fa-spin fa-lg" style={{color:'var(--berry)'}}></i><div style={{marginTop:12,color:'var(--berry)',fontWeight:500}}>Chargement quinzaine...</div></div>;
            if (!apiData) return <div className="fade-in" style={{textAlign:'center',padding:40,color:'var(--red)'}}>Erreur chargement</div>;

            const matchSub = (r) => !avoSubFilter || deriveSubFerme(r.refParcelle, r.parcelle) === avoSubFilter;
            const parFerme = apiData.parFerme || [];
            const _apiParCulture = apiData.parCulture || [];
            const displayData = farmFilter ? parFerme.filter(f => f.ferme === farmFilter) : parFerme;
            const parJour = apiData.parJour || [];
            // Totaux : culture-first pour chefs culture-only (Framboise/Myrtille), ferme-based sinon
            const _cultureData = cultureFilter ? _apiParCulture.find(function(c) { return c.culture === cultureFilter; }) : null;
            const hasCultureData = !!_cultureData;
            const totalJournees = _cultureData ? _cultureData.journees
                : farmFilter ? displayData.reduce(function(s, d) { return s + d.journees; }, 0)
                : apiData.totalJournees;
            const totalCout = _cultureData ? _cultureData.cout
                : farmFilter ? displayData.reduce(function(s, d) { return s + d.cout; }, 0)
                : apiData.totalCout;
            // Taux coût journalier moyen par ferme (pour net à payer des ouvriers MO)
            const fermeRateMap = {};
            parFerme.forEach(d => { if (d.journees > 0) fermeRateMap[d.ferme] = d.cout / d.journees; });
            const COLORS = ['#8B2252', '#2D8B4E', '#D4A847'];
            const trendData = parJour.map(d => ({ jour: d.jourLabel || d.jour, F1: d.F1 || 0, F5: d.F5 || 0, Avocatier: d.Avocatier || 0, BAHIA: d.BAHIA || 0 }));

            // Transport cost for quinzaine
            const currentPeriode = selectedPeriode || (apiData.periodes || [])[0] || '';

            const transportRows = transportDetail.filter(r => (r.periode||'').trim() === currentPeriode.trim() && (!farmFilter || r.ferme === farmFilter) && matchSub(r) && matchCulture(r, cultureFilter));
            // Count unique workers per equipe per day
            const transportByDay = {};
            transportRows.forEach(r => {
                const eq = getEqPrefix(r.matricule);
                if (!eq) return; // skip unrecognized workers
                const d = r.jour;
                if (!transportByDay[d]) transportByDay[d] = {};
                if (!transportByDay[d][eq]) transportByDay[d][eq] = new Set();
                transportByDay[d][eq].add(r.matricule);
            });
            const transportCoutTotal = Object.entries(transportByDay).reduce((total, [d, eqs]) => {
                return total + Object.entries(eqs).reduce((s, [eq, workers]) => s + workers.size * (coutMap[eq] || 0), 0);
            }, 0);
            // Build worker-level detail: per equipe, per worker → JH count
            const transportWorkerDetail = {};
            transportRows.forEach(r => {
                const eq = getEqPrefix(r.matricule);
                if (!eq) return; // skip unrecognized workers
                if (!transportWorkerDetail[eq]) transportWorkerDetail[eq] = {};
                const key = r.matricule;
                if (!transportWorkerDetail[eq][key]) transportWorkerDetail[eq][key] = { matricule: r.matricule, nom: r.nom || r.matricule, jh: 0 };
                transportWorkerDetail[eq][key].jh += 1;
            });

            const transportByEquipe = {};
            Object.entries(transportWorkerDetail).forEach(([eq, workers]) => {
                const workerList = Object.values(workers).sort((a, b) => b.jh - a.jh);
                const totalJH = workerList.reduce((s, w) => s + w.jh, 0);
                transportByEquipe[eq] = { workers: totalJH, cout: totalJH * (coutMap[eq] || 0), workerList };
            });

            // ===== PRIMES CALCULATIONS =====
            // Prime Récolte
            const qRecolteRows = recolteEquipeRows.filter(r => r.periode === currentPeriode && (!farmFilter || r.ferme === farmFilter) && matchSub(r) && matchCulture(r, cultureFilter));
            const totalPrimeRecolte = qRecolteRows.reduce((s, r) => s + calcPrime(r.kg || 0, r.variete, r.jour), 0);

            // Classification MO (mirrors backend classifyType)
            // MÊME règle que les totaux : la classification vit dans le module.
            // Deux classifications, c'est une pop-up qui contredit sa tuile —
            // et c'est comme ça que « Caporal hors Récolte » s'est retrouvé
            // compté en récolte.
            const classifyMO = (opFam) => (CoutMainOeuvre
                ? CoutMainOeuvre.categorieMO(opFam)
                : 'horsRecolte');
            // Lignes de RÉCOLTE. Ce tableau était vide EN DUR, au motif que ces
            // ouvriers seraient « comptés dans la carte Récolte » — or aucune
            // carte de ce bloc ne porte leur SALAIRE : « Prime Récolte » n'est
            // que le bonus aux kilos. Leur paie ne pesait donc nulle part, et la
            // pop-up « MO Récolte » s'ouvrait vide. Sans effet visible tant que
            // la récolte n'a pas commencé (0 JH), faux dès le premier jour de
            // cueillette — et faux en silence, puisqu'un total plus petit reste
            // un total plausible.
            const moRecolteRows = transportRows.filter(r => classifyMO(r.operationFamille) === 'recolte');
            const moHorsRecolteRows = transportRows.filter(r => classifyMO(r.operationFamille) === 'horsRecolte');
            const moPostesRows = transportRows.filter(r => classifyMO(r.operationFamille) === 'postes');

            // Jours réellement travaillés : distinct (matricule, jour) — méthode exacte.
            // On agrège les 3 sources MO pour éviter le double-comptage parcelles (un ouvrier
            // affecté à 2 parcelles le même jour = 1 seul JH, pas 2 lignes Nombre_Jr).
            const _recolteRowsQz = recolteEquipeRows.filter(r => (r.periode||'').trim() === currentPeriode.trim() && (!farmFilter || r.ferme === farmFilter) && matchCulture(r, cultureFilter));
            const totalJourneesDistinct = (() => {
                const wDays = {};
                [...moHorsRecolteRows, ...moPostesRows, ..._recolteRowsQz].forEach(function(r) {
                    if (!r.matricule || !r.jour) return;
                    const k = numKey(r.matricule);
                    if (!wDays[k]) wDays[k] = new Set();
                    wDays[k].add(r.jour);
                });
                return Object.values(wDays).reduce(function(s, days) { return s + days.size; }, 0);
            })();

            // Lignes MO servant au COÛT — source unique des tuiles et des charges.
            // Le pointage de la quinzaine, plus les équipes de récolte : leur
            // payload ne porte PAS de famille d'opération, on la leur pose,
            // sinon elles tomberaient en « hors récolte » et gonfleraient la
            // mauvaise tuile. Un même (ouvrier, jour) présent des deux côtés ne
            // compte qu'une fois : le module raisonne en jours distincts.
            const _moRows = [
                ...transportRows,
                ..._recolteRowsQz.map(function(r) {
                    return Object.assign({}, r, { operationFamille: '8. Récolte' });
                }),
            ];

            // Nom BEE ONE par matricule, tiré des lignes de pointage.
            // `quinzRegistry` vient de `ouvriers_registry`, qui est le registre
            // de PAIE : un saisonnier jamais déclaré ni primé n'y a aucune
            // fiche — les pop-ups par ouvrier retombaient alors sur le
            // matricule. Les lignes MO, elles, portent toutes `nom`
            // (Personnel_Nom côté BEE ONE) : on retient le premier non vide par
            // matricule, exactement comme le backend (pointageService.js).
            // Const dérivé et non `useMemo` : une seule passe sur une liste déjà
            // reconstruite à chaque rendu, et ce point du composant est SOUS ses
            // early-returns — un hook ici serait conditionnel et casserait React.
            const _nomPointageParMat = {};
            _moRows.forEach(function(r) {
                if (!r.matricule) return;
                const _n = String(r.nom || '').trim();
                if (!_n) return;
                const k = numKey(r.matricule);
                if (!_nomPointageParMat[k]) _nomPointageParMat[k] = _n;
            });

            // Nom affiché dans les pop-ups par ouvrier. Motif canonique
            // (cf. `_qpNom`) : le nom de pointage REMPLACE un nom de registre
            // absent, sans écraser le prénom du registre quand il existe.
            const _nomOuvrierQz = (mat) => {
                const k = numKey(mat);
                const reg = quinzRegistry[k] || {};
                return nomOuvrier(reg.prenom, reg.nom || _nomPointageParMat[k], mat) || mat;
            };

            // ===== MODÈLE COÛT SMART BERRY (computePayslip) — source unique pour MO =====
            // On N'UTILISE PAS les coûts SQL BDP (parFerme.cout ou r.cout) qui ne sont qu'une
            // estimation comptable. Le net à payer réel est calculé via PaieUtils.computePayslip
            // identiquement à Validation du Pointage. Les totaux cartes = somme des nets par ouvrier.
            const _CMO = CoutMainOeuvre;
            const registryReady = Object.keys(quinzRegistry).length > 0 && !!(PaieUtils && PaieUtils.computePayslip) && !!_CMO;
            // Skeleton tant que les 2 fetch paie ne sont pas résolus (succès OU échec).
            // Résolus mais registry vide/KO → registryReady false → fallback BDP (inchangé).
            const _sbPending = !quinzRegistryResolved || !quinzBaremesResolved;
            const _firstDayQz = parJour.length > 0 ? parJour[0].jour : null;


            // Net à payer d'UN ouvrier — délégué au module. Conservé sous ce nom
            // parce que la pop-up par ouvrier l'appelle ligne à ligne.
            const sbNetForWorker = (mat, journees, firstDay) => {
                if (!registryReady) return null;
                return Math.round(_CMO.paieOuvrier({
                    paie: PaieUtils,
                    fiche: quinzRegistry[numKey(mat)] || {},
                    jours: journees,
                    baremes: quinzPaieBaremes,
                    dateISO: firstDay || _firstDayQz || null,
                }).net);
            };

            // Totaux MO — UNE seule passe du module sur UNE seule liste de
            // lignes, au lieu de trois agrégations parallèles.
            //
            // Plus de repli sur le coût BEE ONE quand le registre n'est pas
            // chargé : ce repli affichait un montant d'une AUTRE nature sous le
            // même libellé, sans que rien ne le dise. Sans registre, `null` —
            // et l'écran montre « — ».
            const _moTotaux = registryReady
                ? _CMO.netParCategorie({
                    paie: PaieUtils, rows: _moRows, registre: quinzRegistry,
                    baremes: quinzPaieBaremes, cleRegistre: numKey,
                    // MÊME ancienneté que `chargesSociales` : sans cette
                    // injection, le net et les charges se calculeraient sur deux
                    // anciennetés différentes pour le même ouvrier, et leur somme
                    // ne serait le total de rien.
                    joursDepuisSocle: joursDepuisSocle,
                })
                : null;
            const totalCoutRecolte = _moTotaux ? _moTotaux.recolte : null;
            const totalCoutHorsRecolte = _moTotaux ? _moTotaux.horsRecolte : null;
            const totalCoutPostes = _moTotaux ? _moTotaux.postes : null;

            // CHARGES SOCIALES — les DEUX composantes. La carte précédente
            // n'affichait que la patronale (19,26 %) et se disait « non incluse
            // dans le total » : le coût employeur n'était donc affiché nulle
            // part. La part salariale (CNSS 4,48 % + AMO 2,26 %) est bien un
            // coût d'entreprise — l'ouvrier est payé sur le brut, sans retenue,
            // donc ce que la loi prélèverait, la société le verse en plus.
            // Jours fériés par ouvrier, pour la quinzaine et le périmètre affichés.
            // On ne garde que le NOMBRE de jours : leur valorisation vient
            // désormais du barème Smart Berry, plus du coût moyen BEE ONE.
            const _feriesParOuvrier = (() => {
                const acc = {};
                ((transportExtras.jourFerieDetail) || []).forEach(w => {
                    if (!w || w.periode !== currentPeriode) return;
                    if (farmFilter && w.ferme !== farmFilter) return;
                    const k = numKey(w.matricule);
                    if (!k) return;
                    acc[k] = (acc[k] || 0) + (Number(w.jh) || 0);
                });
                return acc;
            })();

            const _chargesSociales = registryReady
                ? _CMO.chargesSociales({
                    paie: PaieUtils, rows: _moRows, registre: quinzRegistry,
                    baremes: quinzPaieBaremes, cleRegistre: numKey,
                    joursDepuisSocle: joursDepuisSocle,
                    // Les HS sont DANS l'assiette : le module les remonte au brut
                    // avant d'appliquer les taux.
                    heuresSupNet: hsMontantsCourants,
                    feriesParOuvrier: _feriesParOuvrier,
                    // PLAFOND DE DÉCLARATION — injecté, comme PaieUtils : le
                    // module de coût ne lit jamais une globale. Absent (script
                    // non chargé) → aucune coupure, comportement d'avant.
                    plafond: PlafondDeclaration,
                })
                : null;
            // Total des heures sup accordées sur la quinzaine, restreint aux
            // ouvriers qui y ont POINTÉ : une saisie laissée sur un ouvrier
            // absent ne doit pas gonfler le total de la quinzaine.
            const _hsTotal = (() => {
                if (!_CMO || !_chargesSociales) return 0;
                return _chargesSociales.detail.reduce((s, w) => s + (w.heuresSup || 0), 0);
            })();

            // Traitement (10 DH/ouvrier-jour)
            const traitRows = transportRows.filter(r => (r.operationFamille || '').toLowerCase().includes('traitement'));
            const traitWD = new Set();
            traitRows.forEach(r => traitWD.add(r.matricule + '|' + r.jour));
            const totalTraitement = traitWD.size * 10;

            // Conditionnement (10 DH/ouvrier-jour)
            const condDetailQ = (transportExtras.conditionnementDetail || []).filter(w => w.periode === currentPeriode && (!farmFilter || w.ferme === farmFilter));
            const totalConditionnement = condDetailQ.reduce((s, w) => s + w.jh, 0) * 10;

            // Chargement (configurable DH/jour)
            const chargDetailQ = (transportExtras.chargementDetail || []).filter(w => w.periode === currentPeriode && (!farmFilter || w.ferme === farmFilter));
            const totalChargement = chargDetailQ.reduce((s, w) => s + w.jh, 0) * (data.primesConfig?.primeChargement?.coutParJour || 10);

            // Jour Férié — coût MARGINAL calculé par le modèle Smart Berry :
            // SMAG + prime de fonction + effet sur l'ancienneté, exactement ce
            // que le bulletin verse pour ces journées.
            //
            // Remplace `w.cout`, le coût journalier moyen BEE ONE. Celui-ci
            // donnait 110,6 DH par jour férié là où le bulletin en donne 90,9,
            // TOUT EN PERDANT la prime de fonction et l'ancienneté de ces
            // journées : deux erreurs de sens contraire dont la somme paraissait
            // juste. C'était le dernier endroit où de l'argent BEE ONE entrait
            // dans le calcul de la quinzaine.
            const ferieDetailQ = (transportExtras.jourFerieDetail || []).filter(w => w.periode === currentPeriode && (!farmFilter || w.ferme === farmFilter));
            const totalJourFerie = _chargesSociales
                ? Math.round(_chargesSociales.detail.reduce((s, w) => s + (w.feries || 0), 0))
                : 0;

            const totalAutresPrimes = totalTraitement + totalConditionnement + totalChargement + totalJourFerie;
            const totalDivers = diversData ? diversData.total : 0;
            // COÛT EMPLOYEUR = les 7 postes. Il remplace l'ancien `totalGlobal`,
            // qui partait de `totalCout` — le coût BEE ONE — alors que les
            // tuiles MO affichaient, elles, le modèle Smart Berry. L'en-tête et
            // les cartes ne parlaient donc pas du même argent : sur la
            // Quinzaine 03, un total de 196 618 DH construit sur 153 415 DH de
            // BEE ONE, au-dessus d'une carte MO à 148 667 DH.
            const _primesQz = { recolte: totalPrimeRecolte, transport: transportCoutTotal, autres: totalAutresPrimes };
            // NET À PAYER : tout ce qui sort de la caisse. Sans les charges —
            // elles vont à la CNSS, pas à l'ouvrier — mais AVEC la
            // sous-traitance, qui est payée elle aussi. C'est le chiffre qu'on
            // rapproche d'un décaissement, quand le coût employeur est celui
            // qu'on porte au P&L.
            const _netAPayer = _moTotaux
                ? _CMO.netAPayer({ mo: _moTotaux, primes: _primesQz, heuresSup: _hsTotal,
                    locationEngins: totalDivers })
                : null;
            const _coutEmployeur = (_moTotaux && _chargesSociales)
                ? _CMO.coutEmployeur({ mo: _moTotaux, primes: _primesQz, heuresSup: _hsTotal,
                    charges: _chargesSociales })
                : null;
            // La sous-traitance est un coût de la quinzaine, pas un coût
            // d'EMPLOYÉ : elle s'ajoute au total sans entrer dans le coût
            // employeur, qu'on compare à une masse salariale.
            const totalGlobal = (_coutEmployeur === null) ? null : _coutEmployeur + totalDivers;

            // Instantané destiné à l'écran Campagne. `pleinPerimetre` est la
            // clause décisive : sous filtre (ferme, culture, sous-ferme) ce total
            // est un SOUS-total, et l'enregistrer comme référence empoisonnerait
            // le rapprochement en silence — l'écart paraîtrait énorme et personne
            // ne saurait qu'il vient d'un filtre laissé actif la veille. Le
            // serveur refuse d'ailleurs tout instantané qui ne le déclare pas.
            // COHÉRENCE AVANT TOUT. `apiData` (d'où viennent les journées) et les
            // détails transport/MO (d'où viennent les montants) arrivent par des
            // requêtes distinctes. Entre deux périodes, un rendu intermédiaire
            // porte les NOUVEAUX montants et les ANCIENNES journées.
            //
            // C'est arrivé : les instantanés Q02 et Q03 ont été enregistrés à 5
            // secondes d'intervalle, et la Q03 porte 1 465 journées — celles de
            // la Q02 — avec les montants d'août. Le dédoublonnage n'y voit rien :
            // sa clé est le montant, et le montant, lui, était déjà le bon.
            //
            // `apiData.periode` est la période que le SERVEUR a réellement
            // servie. Tant qu'elle ne correspond pas à celle affichée, l'écran
            // n'est pas cohérent et il n'y a rien à enregistrer.
            // COHÉRENCE : apiData ET les divers. Ce sont DEUX requêtes distinctes,
            // et il ne suffit pas d'attendre la première.
            //
            // Corrigé une première fois pour `apiData` (journées périmées), la
            // garde laissait passer l'autre : la Quinzaine 01 a été enregistrée
            // avec une sous-traitance à 0 alors qu'elle vaut 7 950 DH, et le
            // rapprochement affichait 7 991 DH d'écart au lieu de 41.
            //
            // Le dédoublonnage ne pouvait pas le rattraper : sa clé porte le coût
            // employeur, qui n'inclut PAS la sous-traitance. La clé ne bougeait
            // donc pas quand les divers arrivaient enfin.
            //
            // TROISIÈME requête à attendre : les heures sup accordées. Elles
            // entrent dans `postes.heuresSup` (et, par les cotisations, dans le
            // coût employeur). Sans cette garde, l'instantané partait avec les
            // heures sup de la quinzaine PRÉCÉDENTE — ou avec 0 pendant le
            // chargement — et le dédoublonnage ne le rattrapait pas : sa clé
            // porte le coût employeur, qui bouge alors, mais la première valeur
            // écrite reste celle qui a été publiée en premier.
            // `pret` et pas seulement `periode` : « pas encore arrivé » n'est pas
            // « quinzaine sans heures sup ».
            const _coherent = !!apiData && apiData.periode === currentPeriode
                && !!diversData && diversData.periode === currentPeriode
                && !!hsMontants && hsMontants.periode === currentPeriode && !!hsMontants.pret;
            // Bornes de la quinzaine, lues dans le détail par journée. Elles
            // permettent au rapprochement d'apparier un fichier de paie à la
            // bonne quinzaine par ses DATES — un libellé « Quinzaine 03 » ne dit
            // pas à quelles dates il correspond.
            const _joursQz = ((apiData && apiData.parJour) || [])
                .map((d) => d && d.jour).filter(Boolean).sort();
            _snapshotRef.current = (_coutEmployeur === null || !currentPeriode || !_coherent) ? null : {
                periode: currentPeriode,
                dateDebut: _joursQz[0] || '',
                dateFin: _joursQz[_joursQz.length - 1] || '',
                coutEmployeur: _coutEmployeur,
                netAPayer: _netAPayer,
                masseSalariale: (_netAPayer === null) ? 0 : _netAPayer - totalDivers,
                // Mêmes JH que la bulle « Coût chargé ouvrier / JH » : sans le même
                // dénominateur, les deux écrans afficheraient deux DH/JH pour un
                // total identique.
                jours: totalJournees || totalJourneesDistinct || 0,
                pleinPerimetre: !farmFilter && !cultureFilter && !avoSubFilter,
                // JOURS fériés en NOMBRE : c'est lui qui se compare au fichier
                // de paie, et c'est lui qui a révélé un écart de DONNÉES que les
                // montants masquaient (39 présents au pointage le 14/08 contre
                // 72 à la paie). Un montant seul aurait fait chercher une erreur
                // de valorisation là où il y a un désaccord sur une présence.
                joursFeries: Object.keys(_feriesParOuvrier)
                    .reduce((s, k) => s + (Number(_feriesParOuvrier[k]) || 0), 0),
                population: _chargesSociales ? {
                    declares: _chargesSociales.nbDeclares,
                    nonDeclares: _chargesSociales.nbNonDeclares,
                    brutDeclare: _chargesSociales.brutDeclare,
                } : { declares: 0, nonDeclares: 0, brutDeclare: 0 },
                // Sous-postes d'« Autres Primes » : agrégés, le jour férié y est
                // indiscernable — et c'est justement lui qu'on cherche.
                sousPostes: {
                    traitement: totalTraitement,
                    conditionnement: totalConditionnement,
                    chargement: totalChargement,
                    jourFerie: totalJourFerie,
                },
                postes: {
                    moRecolte: totalCoutRecolte,
                    moHorsRecolte: totalCoutHorsRecolte,
                    postesFixes: totalCoutPostes,
                    primeRecolte: totalPrimeRecolte,
                    primeTransport: transportCoutTotal,
                    autresPrimes: totalAutresPrimes,
                    heuresSup: _hsTotal,
                    chargesSociales: _chargesSociales ? _chargesSociales.total : 0,
                    locationEngins: totalDivers,
                },
            };

            const recapItems = [
                { label: 'MO Récolte', icon: 'fa-seedling', color: 'var(--berry)', montant: _sbPending ? null : totalCoutRecolte, popupKey: 'mo_recolte' },
                { label: 'MO Hors Récolte', icon: 'fa-person-digging', color: '#c0392b', montant: _sbPending ? null : totalCoutHorsRecolte, popupKey: 'mo_horsrecolte' },
                { label: 'Postes Fixes', icon: 'fa-user-tie', color: '#7f8c8d', montant: _sbPending ? null : totalCoutPostes, popupKey: 'mo_postes' },
                { label: 'Prime Récolte', icon: 'fa-coins', color: '#e67e22', montant: totalPrimeRecolte, popupKey: 'recolte' },
                { label: 'Prime Transport', icon: 'fa-bus', color: '#2D8B4E', montant: transportCoutTotal, popupKey: 'transport' },
                { label: 'Autres Primes', icon: 'fa-layer-group', color: '#8e44ad', montant: totalAutresPrimes, popupKey: 'autres_primes',
                  subItems: [
                    { label: 'Traitement', montant: totalTraitement },
                    { label: 'Conditionnement', montant: totalConditionnement },
                    { label: 'Chargement', montant: totalChargement },
                    { label: 'Jour Férié', montant: totalJourFerie },
                  ]
                },
                // Heures supplémentaires : de la masse salariale, pas une prime de
                // terrain — elles vont à l'ouvrier et elles cotisent. D'où leur
                // place AVANT les charges, qui les incluent dans leur assiette.
                { label: 'Heures Sup.', icon: 'fa-clock', color: '#e67e22',
                  montant: _sbPending ? null : _hsTotal, popupKey: 'heures_sup' },
                { label: 'Charges Sociales', icon: 'fa-building-columns', color: '#3949ab',
                  montant: _sbPending ? null : (_chargesSociales ? _chargesSociales.total : null),
                  popupKey: 'charges_sociales',
                  subItems: _chargesSociales ? [
                    { label: 'CNSS salariale', montant: _chargesSociales.cnss },
                    { label: 'AMO salariale', montant: _chargesSociales.amo },
                    { label: 'Charges Patronales', montant: _chargesSociales.patronales },
                  ] : []
                },
                { label: 'Location & Engins', icon: 'fa-truck', color: '#16a085', montant: totalDivers, popupKey: 'location_engins' },
            ];

            return (
                <div className="fade-in">
                    <div style={{marginBottom:12,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{background:'#d4edda',color:'#155724',padding:'4px 12px',borderRadius:12,fontSize:11,fontWeight:600}}>
                            <i className="fa-solid fa-database" style={{marginRight:4}}></i>Firestore — Quinzaine
                        </span>
                        <QuinzaineCampagneSelect periodes={apiData.periodes || []} periodeCampagne={apiData.periodeCampagne} value={selectedPeriode} onChange={v => handlePeriodeChange(v)} includeEmpty={true} label="Dernière quinzaine" />
                        {typeof onNavigateToPrimes === 'function' && (
                            <button onClick={() => onNavigateToPrimes(selectedPeriode)}
                                style={{padding:'4px 12px',borderRadius:8,border:'1px solid var(--berry)',background:'var(--berry)',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-coins"></i>Voir les Primes
                            </button>
                        )}
                        {(currentProfile === 'rh' || currentProfile === 'dg' || currentProfile === 'finance') && (
                        <button
                            onClick={() => setRapprochementOpen(true)}
                            title="Déposer le fichier Excel de la quinzaine et comparer poste par poste"
                            style={{padding:'4px 12px',borderRadius:8,border:'1px solid #1D9E75',background:'#fff',color:'#1D9E75',fontSize:11,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-file-excel"></i>Comparer au fichier de paie
                        </button>
                        )}
                        {(currentProfile === 'chef_rh' || currentProfile === 'rh' || currentProfile === 'dg') && (
                        <button
                            onClick={() => setEmargementOpen(true)}
                            style={{padding:'4px 12px',borderRadius:8,border:'1px solid #3949ab',background:'#3949ab',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-file-signature"></i>États d'émargement
                        </button>
                        )}
                        <button
                            onClick={() => setAnalytiqueFullscreen(true)}
                            style={{padding:'4px 12px',borderRadius:8,border:'1px solid #27ae60',background:'#27ae60',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-chart-area"></i>Affectation Analytique
                        </button>
                        <button
                            onClick={() => setDetailOuvrierFullscreen(true)}
                            style={{padding:'4px 12px',borderRadius:8,border:'1px solid #6366f1',background:'#6366f1',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
                            <i className="fa-solid fa-users"></i>Détail par Ouvrier
                        </button>
                        {(currentProfile === 'dg' || currentProfile === 'rh') && (
                            <button
                                onClick={handleSyncDepuisBeeOne}
                                disabled={syncingBeeOne}
                                style={{padding:'4px 12px',borderRadius:8,border:'none',background:syncingBeeOne ? '#ccc' : '#1565C0',color:'#fff',fontSize:11,fontWeight:600,cursor:syncingBeeOne ? 'wait' : 'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
                                {syncingBeeOne ? '⏳ Synchro en cours…' : '🔄 Sync BEE ONE'}
                            </button>
                        )}
                        {syncBeeOneResult && (
                            <span style={{fontSize:11,color:syncBeeOneResult.ok ? 'green' : 'red',marginLeft:4}}>
                                {syncBeeOneResult.msg}
                            </span>
                        )}
                        {(currentProfile === 'chef_rh' || currentProfile === 'rh' || currentProfile === 'dg') && (
                            <button
                                onClick={handleEmargementChefsFerme}
                                disabled={emargChefs.loading}
                                style={{padding:'4px 12px',borderRadius:8,border:'none',background:emargChefs.loading ? '#ccc' : '#3949ab',color:'#fff',fontSize:11,fontWeight:600,cursor:emargChefs.loading ? 'wait' : 'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
                                {emargChefs.loading ? '⏳ Génération…' : '📋 Émargement Chefs'}
                            </button>
                        )}
                        {emargChefs.error && (
                            <span style={{fontSize:11,color:'red',marginLeft:4}}>{emargChefs.error}</span>
                        )}
                    </div>

                    {cultureFilter && !hasCultureData && (
                        <div style={{background:'#fff3cd',color:'#856404',padding:'8px 16px',borderRadius:6,marginBottom:12,fontSize:13,display:'flex',alignItems:'center',gap:8}}>
                            <i className="fa-solid fa-triangle-exclamation"></i>
                            Totaux culture non disponibles (archive ancienne). Cliquez <strong style={{marginLeft:4}}>Rafraîchir Firestore Cache</strong> pour les recalculer.
                        </div>
                    )}
                    <div className="quinzaine-card">
                        <h3>{selectedPeriode || (apiData.periodes || [])[0] || ''}{(farmLabel || cultureFilter || farmFilter) ? ' — ' + (farmLabel || cultureFilter || farmFilter) : ''}</h3>
                        <QuinzaineRecapCards
                            recapItems={recapItems}
                            totalGlobal={totalGlobal}
                            nbJours={parJour.length}
                            badges={[
                                { bg: 'var(--berry-pale)', color: 'var(--berry)', icon: 'fa-calendar', text: parJour.length + ' jours' },
                                { bg: '#e8f4fd', color: '#1565C0', icon: 'fa-users', text: (totalJournees || totalJourneesDistinct).toLocaleString('fr-FR') + ' JH' },
                                // Coût employeur ET total : deux chiffres, deux
                                // périmètres. Les fondre en un seul obligerait à
                                // choisir si la sous-traitance est de la masse
                                // salariale — elle ne l'est pas.
                                // Trois niveaux, du plus concret au plus complet :
                                // ce qui part vers les ouvriers, ce que coûte
                                // l'employeur, ce que coûte la quinzaine. Les
                                // fondre en un seul chiffre obligerait à choisir
                                // lequel des trois on trahit.
                                ...(_coutEmployeur === null ? [] : [
                                    { bg: '#e8f5e9', color: '#2D8B4E', icon: 'fa-money-bill-wave', text: 'Net à payer: ' + Math.round(_netAPayer).toLocaleString('fr-FR') + ' DH' },
                                    { bg: '#eef0ff', color: '#3949ab', icon: 'fa-building-columns', text: 'Coût employeur: ' + Math.round(_coutEmployeur).toLocaleString('fr-FR') + ' DH' },
                                    { bg: '#e8f4fd', color: '#1565C0', icon: 'fa-calculator', text: 'Total: ' + Math.round(totalGlobal).toLocaleString('fr-FR') + ' DH' },
                                ]),
                                ...((_coutEmployeur !== null && parJour.length > 0) ? [{ bg: '#fff3e0', color: '#e65100', icon: 'fa-chart-simple', text: 'Moy/jour: ' + Math.round(totalGlobal / parJour.length).toLocaleString('fr-FR') + ' DH' }] : []),
                            ]}
                            clickable={true}
                            externalPopup={true}
                            popup={{ current: quinzPopupKey, setCurrent: setQuinzPopupKey }}
                        />
                    </div>

                    {/* COÛT OUVRIER CHARGÉ de la quinzaine affichée.
                        Salaire Smart Berry (BEE ONE ne fournit que les journées)
                        + primes de terrain + charges patronales ET salariales.
                        Même calcul que le repère de l'écran Campagne : un seul
                        chemin, donc deux écrans qui ne peuvent pas afficher deux
                        coûts différents pour la même quinzaine. */}
                    {(() => {
                        // SOURCE UNIQUE : ces bulles lisaient `coutOuvrierCampagne`,
                        // l'autre chemin de calcul, et affichaient donc un coût
                        // DIFFÉRENT de celui du badge d'en-tête, sur le même écran
                        // et pour la même quinzaine — 165 350 contre 202 538 DH sur
                        // la Quinzaine 01. Ce chemin-là ignore la sous-traitance et
                        // les heures sup, et refait sa propre correspondance
                        // d'équipes pour le transport.
                        // Elles consomment désormais le module, comme les tuiles.
                        if (_coutEmployeur === null) return null;
                        var _jhQz = totalJournees || totalJourneesDistinct || 0;
                        if (!(_jhQz > 0)) return null;
                        var _parJh = _coutEmployeur / _jhQz;
                        var _q = { coutTotal: _coutEmployeur, jh: _jhQz };
                        return (
                            <div style={{display:'flex',alignItems:'stretch',gap:12,marginTop:16,marginBottom:4,flexWrap:'wrap'}}>
                                {/* NET À PAYER — ce qui sort de la caisse. Placé en
                                    PREMIER parce que c'est le chiffre le plus concret
                                    des trois : les deux suivants ajoutent ce que
                                    l'entreprise verse en plus, à la CNSS.
                                    Vert et non bordeaux : ce n'est pas un coût, c'est
                                    un décaissement — deux lectures qu'on confond dès
                                    qu'elles se ressemblent. */}
                                {_netAPayer !== null && (
                                <div onClick={() => setQuinzPopupKey('net_a_payer')}
                                    title="Voir le détail du calcul"
                                    style={{border:'2px solid var(--green)',borderRadius:12,padding:'12px 20px',display:'inline-flex',flexDirection:'column',gap:2,background:'var(--green-pale)',minWidth:220,cursor:'pointer'}}>
                                    <span style={{fontSize:12,fontWeight:700,color:'var(--green)',letterSpacing:0.3}}>
                                        NET À PAYER
                                    </span>
                                    <span style={{fontSize:20,fontWeight:800,color:'var(--green)'}}>
                                        {Math.round(_netAPayer).toLocaleString('fr-FR')} DH
                                    </span>
                                    <span style={{fontSize:11,color:'var(--gray-500)'}}>
                                        salaire + primes + heures sup + sous-traitance
                                    </span>
                                </div>
                                )}
                                <div onClick={() => setQuinzPopupKey('cout_employeur')}
                                    title="Voir le détail du calcul"
                                    style={{border:'2px solid var(--berry)',borderRadius:12,padding:'12px 20px',display:'inline-flex',flexDirection:'column',gap:2,background:'var(--berry-pale)',minWidth:220,cursor:'pointer'}}>
                                    <span style={{fontSize:12,fontWeight:700,color:'var(--berry)',letterSpacing:0.3}}>
                                        Coût chargé ouvrier — TOTAL
                                    </span>
                                    <span style={{fontSize:20,fontWeight:800,color:'var(--berry)'}}>
                                        {Math.round(_q.coutTotal).toLocaleString('fr-FR')} DH
                                    </span>
                                    <span style={{fontSize:11,color:'var(--gray-500)'}}>
                                        salaire + primes + heures sup + charges
                                    </span>
                                </div>
                                <div style={{border:'2px solid var(--berry)',borderRadius:12,padding:'12px 20px',display:'inline-flex',flexDirection:'column',gap:2,background:'#fff',minWidth:200}}>
                                    <span style={{fontSize:12,fontWeight:700,color:'var(--berry)',letterSpacing:0.3}}>
                                        Coût chargé ouvrier / JH
                                    </span>
                                    <span style={{fontSize:20,fontWeight:800,color:'var(--berry)'}}>
                                        {Math.round(_parJh).toLocaleString('fr-FR')} DH
                                    </span>
                                    <span style={{fontSize:11,color:'var(--gray-500)'}}>
                                        sur {Math.round(_q.jh).toLocaleString('fr-FR')} JH pointées
                                    </span>
                                </div>
                                {/* ÉTAT DE L'ENREGISTREMENT pour l'écran Campagne.
                                    Cet écran fait foi : c'est SON total que le
                                    rapprochement compare. Tant qu'il n'est pas
                                    enregistré, la Campagne affiche « — » — et sans
                                    ce voyant, rien ne disait pourquoi. */}
                                <div style={{display:'inline-flex',flexDirection:'column',gap:4,justifyContent:'center',minWidth:210}}>
                                    <span style={{fontSize:11,fontWeight:700,letterSpacing:0.3,
                                        color: snapEtat.etat === 'ok' ? 'var(--green)'
                                            : snapEtat.etat === 'attente' ? 'var(--gray-500)' : '#c0392b'}}>
                                        <i className={'fa-solid ' + (snapEtat.etat === 'ok' ? 'fa-circle-check'
                                            : snapEtat.etat === 'attente' ? 'fa-hourglass-half' : 'fa-triangle-exclamation')}
                                            style={{marginRight:5}}></i>
                                        RAPPROCHEMENT CAMPAGNE
                                    </span>
                                    <span style={{fontSize:11,color:'var(--gray-500)'}}>{snapEtat.message}</span>
                                    {snapEtat.etat !== 'ok' && snapEtat.etat !== 'attente' && (
                                    <button onClick={() => {
                                        // Réessai MANUEL : le dédoublonnage porte sur la
                                        // valeur, donc un refus corrigé (filtre retiré)
                                        // ne repartirait pas tout seul si le total n'a
                                        // pas bougé. Le geste doit rester possible.
                                        _snapshotEnvoye.current = {};
                                        majEtat('attente', 'nouvel essai…');
                                    }} style={{padding:'3px 10px',borderRadius:8,border:'1px solid #c0392b',
                                        background:'#fff',color:'#c0392b',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                        Réessayer
                                    </button>
                                    )}
                                </div>
                                {/* Le bouton « Détail du coût » vivait ici. Les bulles
                                    elles-mêmes ouvrent leur détail : un chiffre qu'on
                                    ne peut pas ouvrir n'invite pas à être vérifié. */}
                            </div>
                        );
                    })()}

                    {/* L'ancienne carte « Charges patronales CNSS » vivait ici,
                        hors du total et amputée de sa moitié salariale. Elle est
                        devenue la tuile « Charges Sociales », à deux lignes et
                        DANS le total — un coût employeur affiché à côté du total
                        sans y entrer laissait chacun faire l'addition de tête. */}

                    {quinzPopupKey === 'net_a_payer' && (() => {
                        // Le NET À PAYER, terme par terme. Même forme que le détail
                        // du coût employeur, mais l'inverse en nature : ici on liste
                        // ce qui SORT DE LA CAISSE, là-bas ce que l'entreprise
                        // supporte. Les deux se lisent l'un après l'autre, et leur
                        // écart EST la tuile Charges Sociales.
                        const _np = [
                            { l: 'MO Récolte', v: _moTotaux ? _moTotaux.recolte : 0 },
                            { l: 'MO Hors Récolte', v: _moTotaux ? _moTotaux.horsRecolte : 0 },
                            { l: 'Postes Fixes', v: _moTotaux ? _moTotaux.postes : 0 },
                            { l: 'Prime Récolte', v: totalPrimeRecolte },
                            { l: 'Prime Transport', v: transportCoutTotal },
                            { l: 'Autres Primes', v: totalAutresPrimes, sous: [
                                { l: 'Traitement', v: totalTraitement },
                                { l: 'Conditionnement', v: totalConditionnement },
                                { l: 'Chargement', v: totalChargement },
                                { l: 'Jour Férié', v: totalJourFerie },
                            ] },
                            { l: 'Heures Supplémentaires', v: _hsTotal },
                            { l: 'Location & Engins (sous-traitance)', v: totalDivers },
                        ];
                        const _somNp = _np.reduce((s2, x) => s2 + (x.v || 0), 0);
                        const _td = {padding:'7px 10px',textAlign:'right',fontSize:13};
                        const _tdL = {..._td, textAlign:'left'};
                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
                                onClick={() => setQuinzPopupKey(null)}>
                                <div style={{background:'#fff',borderRadius:16,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                                    onClick={e => e.stopPropagation()}>
                                    <div style={{padding:'20px 24px',background:'linear-gradient(135deg, var(--green) 0%, var(--green-light) 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                        <div>
                                            <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-money-bill-wave" style={{marginRight:8}}></i>Net à payer — {currentPeriode}</div>
                                            <div style={{fontSize:12,opacity:0.85,marginTop:4}}>ce qui sort de la caisse · {Math.round(_netAPayer || 0).toLocaleString('fr-FR')} DH</div>
                                        </div>
                                        <button onClick={() => setQuinzPopupKey(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    <div style={{padding:'16px 24px'}}>
                                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                                            <tbody>
                                                {_np.map((x, i) => [
                                                    <tr key={x.l} style={{borderBottom:'1px solid var(--gray-100)', background: i % 2 ? '#f4faf6' : '#fff'}}>
                                                        <td style={{..._tdL, fontWeight:600}}>{x.l}</td>
                                                        <td style={{..._td, fontWeight:700}}>{Math.round(x.v || 0).toLocaleString('fr-FR')}</td>
                                                    </tr>,
                                                    ...((x.sous || []).map(sx => (
                                                        <tr key={x.l + sx.l} style={{background: i % 2 ? '#f4faf6' : '#fff'}}>
                                                            <td style={{..._tdL, paddingLeft:26, fontSize:11.5, color:'var(--gray-500)'}}>↳ {sx.l}</td>
                                                            <td style={{..._td, fontSize:11.5, color:'var(--gray-500)'}}>{Math.round(sx.v || 0).toLocaleString('fr-FR')}</td>
                                                        </tr>
                                                    ))),
                                                ])}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{background:'var(--green-pale)',fontWeight:800}}>
                                                    <td style={_tdL}>NET À PAYER</td>
                                                    <td style={_td}>{Math.round(_somNp).toLocaleString('fr-FR')} DH</td>
                                                </tr>
                                                {_chargesSociales && (
                                                <tr style={{color:'var(--gray-500)'}}>
                                                    <td style={{..._tdL, fontSize:11.5}}>+ Charges Sociales (versées à la CNSS, pas à l'ouvrier)</td>
                                                    <td style={{..._td, fontSize:11.5}}>{Math.round(_chargesSociales.total).toLocaleString('fr-FR')}</td>
                                                </tr>
                                                )}
                                                <tr style={{fontWeight:700, color:'var(--berry)'}}>
                                                    <td style={_tdL}>= Total quinzaine</td>
                                                    <td style={_td}>{Math.round(totalGlobal || 0).toLocaleString('fr-FR')} DH</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                        <div style={{marginTop:12,fontSize:10.5,color:'var(--gray-500)'}}>
                                            <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                                            Les charges sociales ne figurent PAS ici : elles vont à la CNSS, pas à
                                            l'ouvrier. La sous-traitance, elle, y figure — un prestataire est payé
                                            lui aussi. C'est ce qui distingue ce chiffre du coût employeur, qui
                                            fait l'inverse des deux.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {quinzPopupKey === 'cout_employeur' && (() => {
                        // Le coût employeur, terme par terme. Chaque ligne est un
                        // poste affiché ailleurs sur l'écran : l'addition doit
                        // tomber sur le total à l'œil, sinon le chiffre ne se
                        // vérifie pas — et un coût qu'on ne peut pas vérifier
                        // finit par ne plus être cru.
                        const _ce = [
                            { l: 'MO Récolte', v: _moTotaux ? _moTotaux.recolte : 0 },
                            { l: 'MO Hors Récolte', v: _moTotaux ? _moTotaux.horsRecolte : 0 },
                            { l: 'Postes Fixes', v: _moTotaux ? _moTotaux.postes : 0 },
                            { l: 'Prime Récolte', v: totalPrimeRecolte },
                            { l: 'Prime Transport', v: transportCoutTotal },
                            { l: 'Autres Primes', v: totalAutresPrimes, sous: [
                                { l: 'Traitement', v: totalTraitement },
                                { l: 'Conditionnement', v: totalConditionnement },
                                { l: 'Chargement', v: totalChargement },
                                { l: 'Jour Férié', v: totalJourFerie },
                            ] },
                            { l: 'Heures Supplémentaires', v: _hsTotal },
                            { l: 'Charges Sociales', v: _chargesSociales ? _chargesSociales.total : 0, sous: [
                                { l: 'CNSS salariale (4,48 %)', v: _chargesSociales ? _chargesSociales.cnss : 0 },
                                { l: 'AMO salariale (2,26 %)', v: _chargesSociales ? _chargesSociales.amo : 0 },
                                { l: 'Charges patronales (19,26 %)', v: _chargesSociales ? _chargesSociales.patronales : 0 },
                            ] },
                        ];
                        const _som = _ce.reduce((s2, x) => s2 + (x.v || 0), 0);
                        const _td = {padding:'7px 10px',textAlign:'right',fontSize:13};
                        const _tdL = {..._td, textAlign:'left'};
                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
                                onClick={() => setQuinzPopupKey(null)}>
                                <div style={{background:'#fff',borderRadius:16,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                                    onClick={e => e.stopPropagation()}>
                                    <div style={{padding:'20px 24px',background:'linear-gradient(135deg, var(--berry) 0%, var(--berry-light) 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                        <div>
                                            <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-building-columns" style={{marginRight:8}}></i>Coût employeur — {currentPeriode}</div>
                                            <div style={{fontSize:12,opacity:0.85,marginTop:4}}>{Math.round(_coutEmployeur || 0).toLocaleString('fr-FR')} DH · {Math.round((_coutEmployeur || 0) / (totalJournees || totalJourneesDistinct || 1)).toLocaleString('fr-FR')} DH par JH</div>
                                        </div>
                                        <button onClick={() => setQuinzPopupKey(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    <div style={{padding:'16px 24px'}}>
                                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                                            <tbody>
                                                {_ce.map((x, i) => [
                                                    <tr key={x.l} style={{borderBottom:'1px solid var(--gray-100)', background: i % 2 ? '#fdf7fa' : '#fff'}}>
                                                        <td style={{..._tdL, fontWeight:600}}>{x.l}</td>
                                                        <td style={{..._td, fontWeight:700}}>{Math.round(x.v || 0).toLocaleString('fr-FR')}</td>
                                                    </tr>,
                                                    ...((x.sous || []).map(sx => (
                                                        <tr key={x.l + sx.l} style={{background: i % 2 ? '#fdf7fa' : '#fff'}}>
                                                            <td style={{..._tdL, paddingLeft:26, fontSize:11.5, color:'var(--gray-500)'}}>↳ {sx.l}</td>
                                                            <td style={{..._td, fontSize:11.5, color:'var(--gray-500)'}}>{Math.round(sx.v || 0).toLocaleString('fr-FR')}</td>
                                                        </tr>
                                                    ))),
                                                ])}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{background:'var(--berry-pale)',fontWeight:800}}>
                                                    <td style={_tdL}>COÛT EMPLOYEUR</td>
                                                    <td style={_td}>{Math.round(_som).toLocaleString('fr-FR')} DH</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                        <div style={{marginTop:12,fontSize:10.5,color:'var(--gray-500)'}}>
                                            <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>
                                            La sous-traitance (Location &amp; Engins) n'y figure pas : un prestataire
                                            n'a ni bulletin ni cotisation. Elle s'ajoute au Total de la quinzaine,
                                            jamais au coût employeur — sinon on comparerait à une masse salariale
                                            un chiffre qui n'en est pas une.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {quinzPopupKey === 'heures_sup' && <QuinzaineHeuresSupPopup _chargesSociales={_chargesSociales} _hsTotal={_hsTotal} _moRows={_moRows} _nomOuvrierQz={_nomOuvrierQz} currentPeriode={currentPeriode} firebaseAuth={firebaseAuth} hsAjoutOuvert={hsAjoutOuvert} hsAjoutQuery={hsAjoutQuery} hsAjoutsCourants={hsAjoutsCourants} hsDraftCourant={hsDraftCourant} hsEmargementsCourants={hsEmargementsCourants} hsMinutes={hsMinutes} hsMontantsCourants={hsMontantsCourants} hsSaving={hsSaving} numKey={numKey} setHsAjoutOuvert={setHsAjoutOuvert} setHsAjoutQuery={setHsAjoutQuery} setHsAjouts={setHsAjouts} setHsDraft={setHsDraft} setHsMontants={setHsMontants} setHsSaving={setHsSaving} setQuinzPopupKey={setQuinzPopupKey} />}

                    {quinzPopupKey === 'charges_sociales' && <QuinzaineChargesSocialesPopup _chargesSociales={_chargesSociales} _nomOuvrierQz={_nomOuvrierQz} currentPeriode={currentPeriode} f2={f2} setQuinzPopupKey={setQuinzPopupKey} />}

                    {quinzPopupKey === 'location_engins' && (() => {
                        const _divRows = diversData ? diversData.rows : [];
                        const _divDates = diversData ? diversData.dates : [];
                        const _divByDate = diversData ? diversData.byDate : {};
                        const _divDailyTot = _divDates.map(function(d) { return _divRows.reduce(function(s, r) { return s + ((r.byDay[d] && r.byDay[d].m) || 0); }, 0); });
                        const _divGrandTot = _divRows.reduce(function(s, r) { return s + r.totM; }, 0);
                        return (
                            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
                                onClick={() => setQuinzPopupKey(null)}>
                                <div style={{background:'#fff',borderRadius:16,maxWidth:900,width:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
                                    onClick={e => e.stopPropagation()}>
                                    <div style={{padding:'20px 24px',background:'linear-gradient(135deg, #16a085 0%, #1abc9ccc 100%)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                                        <div>
                                            <div style={{fontSize:18,fontWeight:700}}><i className="fa-solid fa-truck" style={{marginRight:8}}></i>Location & Engins — {currentPeriode}</div>
                                            <div style={{fontSize:12,opacity:0.85,marginTop:4}}>{_divRows.length} prestataire{_divRows.length !== 1 ? 's' : ''} — {Math.round(_divGrandTot).toLocaleString('fr-FR')} DH</div>
                                        </div>
                                        <button onClick={() => setQuinzPopupKey(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    <div style={{padding:'16px 24px'}}>
                                        {!diversData || _divRows.length === 0 ? (
                                            <div style={{color:'var(--gray-400)',fontSize:13,fontStyle:'italic',textAlign:'center',padding:'24px 0'}}>Pas de données Location & Engins pour cette quinzaine.</div>
                                        ) : (
                                        <div className="table-responsive">
                                        <table className="data-table" style={{fontSize:11,margin:0}}>
                                            <thead>
                                                <tr>
                                                    <th>Jour</th>
                                                    {_divRows.map(function(r, i) {
                                                        return (
                                                            <th key={i} style={{textAlign:'center'}}>
                                                                {r.beneficiaire || r.matricule || '—'}
                                                                <div style={{fontSize:9,fontWeight:400,color:'rgba(255,255,255,0.7)'}}>{r.fonction || '—'}{r.matricule ? ' · ' + r.matricule : ''}</div>
                                                            </th>
                                                        );
                                                    })}
                                                    <th style={{textAlign:'center',fontWeight:700}}>Total jour</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {_divDates.map(function(d, di) {
                                                    return (
                                                        <tr key={d}>
                                                            <td style={{fontWeight:600,whiteSpace:'nowrap'}}>{new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})}</td>
                                                            {_divRows.map(function(r, i) {
                                                                var c = r.byDay[d];
                                                                if (!c || (!c.q && !c.m)) return <td key={i} style={{textAlign:'center',color:'var(--gray-200)'}}>-</td>;
                                                                return <td key={i} style={{textAlign:'center',fontSize:10}}><div style={{fontWeight:600}}>{c.q}</div><div style={{fontSize:9,color:'var(--gray-400)'}}>{Math.round(c.m).toLocaleString('fr-FR')} DH</div></td>;
                                                            })}
                                                            <td style={{textAlign:'center',fontWeight:700,color:_divDailyTot[di]>0?'var(--berry)':'var(--gray-300)'}}>{_divDailyTot[di] > 0 ? Math.round(_divDailyTot[di]).toLocaleString('fr-FR') + ' DH' : '—'}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                                    <td style={{textAlign:'right',padding:'6px 10px'}}>Total</td>
                                                    {_divRows.map(function(r, i) {
                                                        return (
                                                            <td key={i} style={{textAlign:'center',fontSize:10,color:'var(--berry)',padding:'6px 10px'}}>
                                                                <div>{Math.round(r.totQ*100)/100}</div>
                                                                <div>{Math.round(r.totM).toLocaleString('fr-FR')} DH</div>
                                                            </td>
                                                        );
                                                    })}
                                                    <td style={{textAlign:'center',color:'var(--berry)',fontSize:13,padding:'6px 10px'}}>{Math.round(_divGrandTot).toLocaleString('fr-FR')} DH</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                        </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Pop-up GÉNÉRIQUE (MO, primes, transport). Elle se déclenche
                        sur toute clé non exclue ici, et sa dernière branche est un
                        `else` qui retombe sur le transport : une clé oubliée dans
                        cette liste n'ouvre donc pas RIEN, elle ouvre une DEUXIÈME
                        pop-up par-dessus la bonne, remplie des mauvaises lignes. */}
                    {quinzPopupKey && quinzPopupKey !== 'location_engins' && quinzPopupKey !== 'charges_sociales' && quinzPopupKey !== 'heures_sup' && quinzPopupKey !== 'cout_employeur' && quinzPopupKey !== 'net_a_payer' && <QuinzainePopupGenerique calcPrime={calcPrime} chargDetailQ={chargDetailQ} condDetailQ={condDetailQ} coutMap={coutMap} currentPeriode={currentPeriode} data={data} f2={f2} ferieDetailQ={ferieDetailQ} fermeRateMap={fermeRateMap} getEqPrefix={getEqPrefix} moHorsRecolteRows={moHorsRecolteRows} moPostesRows={moPostesRows} moRecolteRows={moRecolteRows} numKey={numKey} parJour={parJour} prefixToName={prefixToName} qRecolteRows={qRecolteRows} quinzGroupBy={quinzGroupBy} quinzPaieBaremes={quinzPaieBaremes} quinzPopupKey={quinzPopupKey} quinzRegistry={quinzRegistry} quinzSearch={quinzSearch} sbNetForWorker={sbNetForWorker} setQuinzChargesPopup={setQuinzChargesPopup} setQuinzGroupBy={setQuinzGroupBy} setQuinzPopupKey={setQuinzPopupKey} setQuinzSearch={setQuinzSearch} setQuinzSubWorker={setQuinzSubWorker} traitRows={traitRows} transportRows={transportRows} />}

                    {/* Sous-popup jour par jour ouvrier (toutes cartes) */}
                    {quinzSubWorker && <QuinzaineSousPopupOuvrier f2={f2} numKey={numKey} quinzPaieBaremes={quinzPaieBaremes} quinzRegistry={quinzRegistry} quinzSubWorker={quinzSubWorker} setQuinzSubWorker={setQuinzSubWorker} />}

                    {/* Popup détail charges patronales par ouvrier déclaré */}
                    {quinzChargesPopup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.65)',zIndex:10001,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
                            onClick={() => setQuinzChargesPopup(null)}>
                            <div style={{background:'#fff',borderRadius:16,maxWidth:760,width:'100%',maxHeight:'80vh',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.4)'}}
                                onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 20px',background:'linear-gradient(135deg,#3949ab,#5c6bc0)',borderRadius:'16px 16px 0 0',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
                                    <div>
                                        <div style={{fontSize:16,fontWeight:700}}><i className="fa-solid fa-shield-halved" style={{marginRight:8}}></i>Détail Charges Patronales — Ouvriers Déclarés CNSS</div>
                                        <div style={{fontSize:11,opacity:0.85,marginTop:3}}>{quinzChargesPopup.length} ouvrier{quinzChargesPopup.length !== 1 ? 's' : ''} déclaré{quinzChargesPopup.length !== 1 ? 's' : ''} · Total charges : {f2(quinzChargesPopup.reduce((s,w)=>s+w.chargesPatronales,0))} DH</div>
                                    </div>
                                    <button onClick={() => setQuinzChargesPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',fontSize:16,cursor:'pointer',borderRadius:8,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                                <div style={{padding:'16px 20px'}}>
                                    <table className="data-table" style={{fontSize:12,margin:0}}>
                                        <thead>
                                            <tr style={{background:'var(--gray-50)'}}>
                                                <th style={{padding:'6px 10px'}}>Matricule</th>
                                                <th style={{padding:'6px 10px'}}>Nom</th>
                                                <th style={{padding:'6px 10px',textAlign:'center'}}>Jours</th>
                                                <th style={{padding:'6px 10px',textAlign:'right'}}>Brut (DH)</th>
                                                <th style={{padding:'6px 10px',textAlign:'right'}}>Charges pat. (DH)</th>
                                                <th style={{padding:'6px 10px',textAlign:'right'}}>Coût emp. (DH)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {quinzChargesPopup.map((w, i) => (
                                                <tr key={i} style={{background: i % 2 === 0 ? '#fff' : 'var(--gray-50)'}}>
                                                    <td style={{padding:'6px 10px',fontFamily:'monospace',fontSize:11}}>{w.matricule}</td>
                                                    <td style={{padding:'6px 10px',fontWeight:600}}>{w.nom}</td>
                                                    <td style={{padding:'6px 10px',textAlign:'center'}}>{w.journees}</td>
                                                    <td style={{padding:'6px 10px',textAlign:'right'}}>{f2(w.brut)}</td>
                                                    <td style={{padding:'6px 10px',textAlign:'right',color:'#3949ab',fontWeight:600}}>+{f2(w.chargesPatronales)} <span style={{fontSize:10,opacity:0.7}}>({((w.tauxCharges||0)*100).toFixed(1)}%)</span></td>
                                                    <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700}}>{f2(w.coutEmployeur)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{background:'#eef0fa',fontWeight:700}}>
                                                <td colSpan={3} style={{padding:'8px 10px'}}>TOTAL ({quinzChargesPopup.length} ouvriers)</td>
                                                <td style={{padding:'8px 10px',textAlign:'right'}}>{f2(quinzChargesPopup.reduce((s,w)=>s+w.brut,0))}</td>
                                                <td style={{padding:'8px 10px',textAlign:'right',color:'#3949ab'}}>+{f2(quinzChargesPopup.reduce((s,w)=>s+w.chargesPatronales,0))}</td>
                                                <td style={{padding:'8px 10px',textAlign:'right'}}>{f2(quinzChargesPopup.reduce((s,w)=>s+w.coutEmployeur,0))}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    <Panel title="Répartition par Ferme" icon="fa-chart-bar">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Ferme</th>
                                    <th>Journées</th>
                                    <th>Coût (DH)</th>
                                    <th>Récolte (jr)</th>
                                    <th>Hors Récolte (jr)</th>
                                    <th>Ouvriers Avocatier (jr)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayData.map((d, i) => (
                                    <tr key={i}>
                                        <td style={{fontWeight:600}}>{d.ferme}</td>
                                        <td><strong>{d.journees}</strong></td>
                                        <td>{d.cout.toLocaleString('fr-FR')}</td>
                                        <td>{d.recolte}</td>
                                        <td>{d.horsRecolte}</td>
                                        <td>{d.postesFixes}</td>
                                    </tr>
                                ))}
                                <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                    <td>TOTAL</td>
                                    <td>{totalJourneesDistinct}</td>
                                    <td>{displayData.reduce((s,d)=>s+d.cout,0).toLocaleString('fr-FR')}</td>
                                    <td>{displayData.reduce((s,d)=>s+d.recolte,0)}</td>
                                    <td>{displayData.reduce((s,d)=>s+d.horsRecolte,0)}</td>
                                    <td>{displayData.reduce((s,d)=>s+d.postesFixes,0)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </Panel>

                    {/* Alertes Équipes absentes */}
                    {alertesData && alertesData.alertes && alertesData.alertes.length > 0 && (
                        <div style={{marginBottom:16,padding:'14px 20px',background:'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)',borderRadius:10,color:'white'}}>
                            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                                <i className="fa-solid fa-triangle-exclamation" style={{fontSize:18}}></i>
                                <span style={{fontWeight:700,fontSize:14}}>Alertes Équipes Absentes</span>
                                <span style={{fontSize:10,opacity:0.8,background:'rgba(255,255,255,0.2)',padding:'2px 8px',borderRadius:8}}>{alertesData.alertes.length} alerte{alertesData.alertes.length > 1 ? 's' : ''}</span>
                            </div>
                            {alertesData.alertes.map((a, i) => (
                                <div key={i} style={{background:'rgba(255,255,255,0.15)',borderRadius:8,padding:'8px 14px',marginBottom:i < alertesData.alertes.length - 1 ? 6 : 0,fontSize:12,display:'flex',alignItems:'center',gap:10}}>
                                    <i className="fa-solid fa-users-slash" style={{fontSize:14,opacity:0.8}}></i>
                                    <div>
                                        <strong>{prefixToName[a.equipePrefix] || a.equipePrefix}</strong> — absente depuis {a.joursAbsents} jours consécutifs
                                        <div style={{fontSize:10,opacity:0.8}}>Du {new Date(a.dateDebut).toLocaleDateString('fr-FR')} au {new Date(a.dateFin).toLocaleDateString('fr-FR')}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Repos moyen par équipe */}
                    {reposData && reposData.equipes && reposData.equipes.length > 0 && (() => {
                        const knownPrefixes = transportConfig.map(t => t.prefix);
                        // When farmFilter is set, find equipe prefixes active in this farm from transport data
                        const farmPrefixes = farmFilter
                            ? [...new Set(transportDetail.filter(r => r.ferme === farmFilter && matchSub(r)).map(r => getEqPrefix(r.matricule)).filter(Boolean))]
                            : null;
                        const knownEquipes = reposData.equipes.filter(eq => knownPrefixes.includes(eq.prefix) && (!farmPrefixes || farmPrefixes.includes(eq.prefix)));
                        const unknownEquipes = farmFilter ? [] : reposData.equipes.filter(eq => !knownPrefixes.includes(eq.prefix));
                        // Merge unknown equipes into "Sans Equipe"
                        const displayEquipes = [...knownEquipes];
                        if (unknownEquipes.length > 0) {
                            const allWorkers = unknownEquipes.flatMap(eq => eq.workers || []);
                            const totalNbOuv = unknownEquipes.reduce((s, eq) => s + eq.nbOuvriers, 0);
                            const totalRepos = allWorkers.length > 0 ? Math.round(allWorkers.reduce((s, w) => s + w.nbRepos, 0) / allWorkers.length * 10) / 10 : 0;
                            const nbJQ = unknownEquipes[0]?.nbJoursQuinzaine || 0;
                            displayEquipes.push({ prefix: '__sans_equipe__', nbOuvriers: totalNbOuv, moyRepos: totalRepos, nbJoursQuinzaine: nbJQ, workers: allWorkers });
                        }
                        displayEquipes.sort((a, b) => b.moyRepos - a.moyRepos);
                        const activeEquipes = displayEquipes.filter(eq => eq.nbOuvriers > 0);
                        if (activeEquipes.length === 0) return null;
                        return (
                        <Panel title="Repos par Équipe (Quinzaine)" icon="fa-bed">
                            <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8}}>Nombre moyen de jours de repos par équipe. Cliquez sur une équipe pour voir le détail par ouvrier.</div>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Équipe</th>
                                        <th>Nb Ouvriers</th>
                                        <th style={{textAlign:'center'}}>Moy. Repos</th>
                                        <th style={{textAlign:'center'}}>Jours Quinzaine</th>
                                        <th style={{textAlign:'center'}}>Ratio</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeEquipes.map((eq, i) => {
                                        const isSansEquipe = eq.prefix === '__sans_equipe__';
                                        const eqName = isSansEquipe ? 'Sans Equipe' : (prefixToName[eq.prefix] || eq.prefix);
                                        const eqLabel = isSansEquipe ? 'PJ' : eq.prefix;
                                        const isExpanded = expandedReposEquipe === eq.prefix;
                                        return (
                                            <React.Fragment key={eq.prefix}>
                                                <tr style={{cursor:'pointer',transition:'background 0.15s', background: isSansEquipe ? 'var(--gray-50)' : undefined}}
                                                    onMouseEnter={e => e.currentTarget.style.background='#f0e6ec'}
                                                    onMouseLeave={e => e.currentTarget.style.background= isSansEquipe ? 'var(--gray-50)' : ''}
                                                    onClick={() => setExpandedReposEquipe(isExpanded ? null : eq.prefix)}>
                                                    <td style={{fontWeight:600}}>
                                                        <i className={`fa-solid fa-chevron-${isExpanded ? 'down' : 'right'}`} style={{fontSize:9,marginRight:6,color:'var(--gray-400)'}}></i>
                                                        {eqName} <span style={{fontSize:10,color:'var(--gray-400)',fontWeight:400}}>({eqLabel})</span>
                                                    </td>
                                                    <td style={{textAlign:'center'}}>{eq.nbOuvriers}</td>
                                                    <td style={{textAlign:'center',fontWeight:700,color: eq.moyRepos > eq.nbJoursQuinzaine * 0.3 ? '#e74c3c' : 'var(--green)'}}>{eq.moyRepos}</td>
                                                    <td style={{textAlign:'center'}}>{eq.nbJoursQuinzaine}</td>
                                                    <td style={{textAlign:'center',fontWeight:600}}>
                                                        <span style={{background: eq.moyRepos > eq.nbJoursQuinzaine * 0.3 ? 'rgba(231,76,60,0.1)' : 'rgba(45,139,78,0.1)', color: eq.moyRepos > eq.nbJoursQuinzaine * 0.3 ? '#e74c3c' : 'var(--green)', padding:'2px 8px',borderRadius:8,fontSize:11}}>
                                                            {eq.moyRepos} / {eq.nbJoursQuinzaine}
                                                        </span>
                                                    </td>
                                                </tr>
                                                {isExpanded && eq.workers.map((w, wi) => (
                                                    <tr key={w.matricule} style={{background:'var(--gray-50)',fontSize:11}}>
                                                        <td style={{paddingLeft:32,color:'var(--gray-600)'}}>
                                                            <span style={{fontFamily:'monospace',marginRight:6}}>{w.matricule}</span><WorkerLink matricule={w.matricule} nom={w.nom} />
                                                        </td>
                                                        <td></td>
                                                        <td style={{textAlign:'center',fontWeight:600,color: w.nbRepos > w.nbJoursQuinzaine * 0.3 ? '#e74c3c' : 'var(--gray-700)'}}>{w.nbRepos}</td>
                                                        <td style={{textAlign:'center',color:'var(--gray-400)'}}>{w.nbPresent} présent</td>
                                                        <td style={{textAlign:'center'}}>
                                                            <span style={{fontSize:10}}>{w.nbRepos} / {w.nbJoursQuinzaine}</span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </Panel>
                        );
                    })()}

                    {/* Transport par équipe */}
                    {Object.keys(transportByEquipe).length > 0 && (
                    <Panel title="Coût Transport par Équipe" icon="fa-bus">
                        <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:8}}>Cliquez sur une équipe pour voir le détail des ouvriers.</div>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Équipe</th>
                                    <th>Caporal</th>
                                    <th>Coût/Ouv.</th>
                                    <th>Nb Ouvriers</th>
                                    <th>Nb JH</th>
                                    <th>Coût Transport (DH)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transportConfig.filter(t => transportByEquipe[t.prefix]).map(t => {
                                    const tb = transportByEquipe[t.prefix];
                                    return (
                                        <tr key={t.prefix} style={{cursor:'pointer',transition:'background 0.15s'}}
                                            onMouseEnter={e => e.currentTarget.style.background='#f0e6ec'}
                                            onMouseLeave={e => e.currentTarget.style.background=''}
                                            onClick={() => setTransportPopup({ prefix: t.prefix, equipe: t.equipe, caporal: t.caporal, cout: t.coutParOuvrier, workers: tb.workerList || [] })}>
                                            <td><strong>{t.equipe}</strong></td>
                                            <td style={{fontSize:11,color:'var(--gray-500)'}}>{t.caporal}</td>
                                            <td>{t.coutParOuvrier} DH</td>
                                            <td style={{textAlign:'center',fontWeight:600}}>{(tb.workerList||[]).length}</td>
                                            <td style={{textAlign:'center',color:'var(--blue)',fontWeight:600}}>{tb.workers}</td>
                                            <td style={{fontWeight:700,color:'var(--berry)'}}>{Math.round(tb.cout).toLocaleString('fr-FR')} DH</td>
                                        </tr>
                                    );
                                })}
                                <tr style={{background:'var(--berry-pale)',fontWeight:700}}>
                                    <td>TOTAL</td>
                                    <td></td>
                                    <td></td>
                                    <td style={{textAlign:'center'}}>{Object.values(transportByEquipe).reduce((s,t)=>s+t.workerList.length,0)}</td>
                                    <td style={{textAlign:'center'}}>{Object.values(transportByEquipe).reduce((s,t)=>s+t.workers,0)}</td>
                                    <td style={{color:'var(--berry)'}}>{Math.round(transportCoutTotal).toLocaleString('fr-FR')} DH</td>
                                </tr>
                            </tbody>
                        </table>
                    </Panel>
                    )}

                    {/* Affectation Analytique — extrait dans
                        public/components/AffectationAnalytiqueTable.jsx (iso-comportement).
                        Garde `window.X &&` : une référence nue à un global non posé
                        crashe TOUT le rendu (mémoire projet tab-bare-global-ref-crash).
                        Rendu ici SANS condition sur les lignes : le composant porte
                        lui-même le test `_analytiqueSourceRows.length > 0` (il a besoin
                        d'être monté pour rendre le pop-up de détail). */}
                    {window.AffectationAnalytiqueTable && (
                        <window.AffectationAnalytiqueTable
                            analytiqueData={analytiqueData}
                            apiData={apiData}
                            selectedPeriode={selectedPeriode}
                            farmFilter={farmFilter}
                            avoSubFilter={avoSubFilter}
                            empCostReady={_parcelleEmpCostMap.ready}
                            fullscreen={analytiqueFullscreen}
                            setFullscreen={setAnalytiqueFullscreen}
                            cultureIdx={analytiqueCultureIdx}
                            setCultureIdx={setAnalytiqueCultureIdx}
                            totalMode={analytiqueTotalMode}
                            setTotalMode={setAnalytiqueTotalMode}
                            view={analytiqueView}
                            setView={setAnalytiqueView}
                            detailCell={analytiqueDetailCell}
                            setDetailCell={setAnalytiqueDetailCell}
                            detailMode={analytiqueDetailMode}
                            setDetailMode={setAnalytiqueDetailMode}
                            scopeMode={analytiqueScopeMode}
                            setScopeMode={setAnalytiqueScopeMode}
                            scopeValue={analytiqueScopeValue}
                            setScopeValue={setAnalytiqueScopeValue}
                            scopeData={analytiqueScopeData}
                            setScopeData={setAnalytiqueScopeData}
                            scopeLoading={analytiqueScopeLoading}
                            setScopeLoading={setAnalytiqueScopeLoading}
                        />
                    )}

                    {/* Popup détail ouvriers transport */}
                    {transportPopup && (
                        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={() => setTransportPopup(null)}>
                            <div style={{background:'#fff',borderRadius:12,maxWidth:600,width:'100%',maxHeight:'80vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
                                <div style={{padding:'16px 20px',borderBottom:'2px solid var(--gray-100)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div>
                                        <h3 style={{margin:0,fontSize:16,color:'var(--berry)'}}><i className="fa-solid fa-bus" style={{marginRight:8}}></i>{transportPopup.equipe}</h3>
                                        <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Caporal: {transportPopup.caporal} — {transportPopup.cout} DH/ouvrier</div>
                                    </div>
                                    <button onClick={() => setTransportPopup(null)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--gray-400)',padding:4}}>
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                                <div style={{padding:'12px 20px'}}>
                                    <table className="data-table" style={{fontSize:12}}>
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Matricule</th>
                                                <th>Ouvrier</th>
                                                <th style={{textAlign:'center'}}>JH</th>
                                                <th style={{textAlign:'right'}}>Coût (DH)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {transportPopup.workers.map((w, i) => (
                                                <tr key={i}>
                                                    <td style={{color:'var(--gray-400)',fontSize:10}}>{i + 1}</td>
                                                    <td style={{fontFamily:'monospace',fontSize:11,fontWeight:600}}>{w.matricule}</td>
                                                    <td style={{fontWeight:500}}><WorkerLink matricule={w.matricule} nom={w.nom} /></td>
                                                    <td style={{textAlign:'center',fontWeight:700}}>{w.jh}</td>
                                                    <td style={{textAlign:'right',fontWeight:600,color:'var(--berry)'}}>{(w.jh * transportPopup.cout).toLocaleString('fr-FR')} DH</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{background:'var(--gray-50)',fontWeight:700}}>
                                                <td></td>
                                                <td></td>
                                                <td>TOTAL ({transportPopup.workers.length} ouvriers)</td>
                                                <td style={{textAlign:'center'}}>{transportPopup.workers.reduce((s, w) => s + w.jh, 0)}</td>
                                                <td style={{textAlign:'right',color:'var(--berry)'}}>{(transportPopup.workers.reduce((s, w) => s + w.jh, 0) * transportPopup.cout).toLocaleString('fr-FR')} DH</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {_chargesSociales && _chargesSociales.nbDeclares > 0 && (
                        <div style={{marginBottom:16,background:'#f0f4ff',borderRadius:12,padding:'16px 20px',border:'1px solid #c5d0e6'}}>
                            <div style={{fontSize:12,fontWeight:700,color:'#3949ab',textTransform:'uppercase',letterSpacing:0.5,marginBottom:12}}>
                                <i className="fa-solid fa-shield-halved" style={{marginRight:6}}></i>
                                Charges Sociales MO — Récolte · Hors Récolte · Postes Fixes
                            </div>
                            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                                <div style={{flex:'1 1 120px',textAlign:'center',background:'#fff',borderRadius:8,padding:'10px 14px',border:'1px solid #e8ecf8'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:4}}>Déclarés CNSS</div>
                                    <div style={{fontSize:22,fontWeight:800,color:'#27ae60'}}>{_chargesSociales.nbDeclares}</div>
                                    <div style={{fontSize:10,color:'var(--gray-400)'}}>{_chargesSociales.nbNonDeclares} non déclarés</div>
                                </div>
                                <div style={{flex:'1 1 160px',textAlign:'center',background:'#fff',borderRadius:8,padding:'10px 14px',border:'1px solid #e8ecf8'}}>
                                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:4}}>Brut total déclarés</div>
                                    <div style={{fontSize:16,fontWeight:700,color:'var(--gray-700)'}}>{f2(_chargesSociales.brutDeclare)} DH</div>
                                </div>
                                {/* Les DEUX composantes, côte à côte. La salariale
                                    manquait : l'ouvrier est payé sur le brut sans
                                    retenue, donc ce que la loi prélèverait sur son
                                    salaire, la société le verse en plus. */}
                                <div style={{flex:'1 1 160px',textAlign:'center',background:'#fff',borderRadius:8,padding:'10px 14px',border:'1px solid #e8ecf8'}}>
                                    <div style={{fontSize:11,color:'#3949ab',marginBottom:4,fontWeight:600}}>Charges salariales</div>
                                    <div style={{fontSize:16,fontWeight:700,color:'#3949ab'}}>+{f2(_chargesSociales.salariales)} DH</div>
                                    <div style={{fontSize:10,color:'var(--gray-400)'}}>CNSS 4,48% + AMO 2,26%</div>
                                </div>
                                <div style={{flex:'1 1 160px',textAlign:'center',background:'#fff',borderRadius:8,padding:'10px 14px',border:'2px solid #3949ab'}}>
                                    <div style={{fontSize:11,color:'#3949ab',marginBottom:4,fontWeight:600}}>Charges patronales</div>
                                    <div style={{fontSize:16,fontWeight:700,color:'#3949ab'}}>+{f2(_chargesSociales.patronales)} DH</div>
                                    <div style={{fontSize:10,color:'var(--gray-400)'}}>≈ 19,26% du brut déclaré</div>
                                </div>
                                <div style={{flex:'1 1 160px',textAlign:'center',background:'linear-gradient(135deg,#3949ab,#5c6bc0)',borderRadius:8,padding:'10px 14px',color:'#fff'}}>
                                    <div style={{fontSize:11,opacity:0.85,marginBottom:4}}>Coût employeur MO total</div>
                                    <div style={{fontSize:16,fontWeight:800}}>{f2((_moTotaux ? _moTotaux.total : 0) + _chargesSociales.total)} DH</div>
                                    <div style={{fontSize:10,opacity:0.7}}>Récolte + Hors Récolte + Postes</div>
                                </div>
                            </div>
                        </div>
                    )}

                    <Panel title="Évolution journalière" icon="fa-chart-line">
                        <SimpleBarChart data={trendData} dataKeys={farmFilter ? [farmFilter] : ['F1','F5','Avocatier']} colors={COLORS} xKey="jour" height={250} />
                    </Panel>

                    <Panel title="Détail par Jour" icon="fa-calendar-days">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Jour</th>
                                    <th>Ouvriers</th>
                                    <th>Journées</th>
                                    <th>Coût (DH)</th>
                                    {!farmFilter && <><th>F1</th><th>F5</th><th>Avocatier</th></>}
                                </tr>
                            </thead>
                            <tbody>
                                {parJour.map((d, i) => {
                                    const ouv = farmFilter ? (d[farmFilter] || 0) : d.nbOuv;
                                    const journ = farmFilter ? (d[farmFilter] || 0) : Math.round(d.journees);
                                    const coutJ = farmFilter ? Math.round((d[farmFilter] || 0) / (d.nbOuv || 1) * d.cout) : Math.round(d.cout);
                                    return (
                                    <tr key={i}>
                                        <td style={{fontWeight:500}}>{d.jourLabel || d.jour}</td>
                                        <td>{ouv}</td>
                                        <td><strong>{journ}</strong></td>
                                        <td>{coutJ.toLocaleString('fr-FR')}</td>
                                        {!farmFilter && <><td>{d.F1 || 0}</td><td>{d.F5 || 0}</td><td>{d.Avocatier || 0}</td></>}
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </Panel>

                    {/* ─── Détail par Ouvrier ───────────────────────────────────────────── */}
                    {<QuinzaineDetailParOuvrier cultureFilter={cultureFilter} currentPeriode={currentPeriode} detailEquipeFilter={detailEquipeFilter} detailOuvrierFullscreen={detailOuvrierFullscreen} detailSearch={detailSearch} farmFilter={farmFilter} getEqPrefix={getEqPrefix} matchCulture={matchCulture} moHorsRecolteRows={moHorsRecolteRows} moPostesRows={moPostesRows} numKey={numKey} parJour={parJour} prefixToName={prefixToName} quinzPaieBaremes={quinzPaieBaremes} quinzRegistry={quinzRegistry} recolteEquipeRows={recolteEquipeRows} setDetailEquipeFilter={setDetailEquipeFilter} setDetailOuvrierFullscreen={setDetailOuvrierFullscreen} setDetailSearch={setDetailSearch} />}

                    {/* ─── Popup États d'émargement ─────────────────────────────────────── */}
                    {/* RAPPROCHEMENT AU FICHIER DE PAIE. On passe l'instantané
                        CALCULÉ à l'instant (`_snapshotRef`) plutôt que celui
                        enregistré en base : c'est le même contenu, mais toujours
                        à jour — comparer un fichier frais à un instantané de la
                        veille ferait apparaître un écart qui n'est qu'un décalage
                        d'enregistrement. */}
                    {rapprochementOpen && window.RapprochementPaiePopup && (
                        <window.RapprochementPaiePopup
                            periode={currentPeriode}
                            quinzaine={_snapshotRef.current}
                            baremes={quinzPaieBaremes}
                            onClose={() => setRapprochementOpen(false)}
                        />
                    )}
                    {emargementOpen && <QuinzaineEmargementPopup coutMap={coutMap} cultureFilter={cultureFilter} currentPeriode={currentPeriode} emargementLang={emargementLang} emargementLoading={emargementLoading} farmFilter={farmFilter} getEqPrefix={getEqPrefix} matchCulture={matchCulture} moHorsRecolteRows={moHorsRecolteRows} moPostesRows={moPostesRows} numKey={numKey} parJour={parJour} prefixToName={prefixToName} quinzPaieBaremes={quinzPaieBaremes} quinzRegistry={quinzRegistry} recolteEquipeRows={recolteEquipeRows} setEmargementLang={setEmargementLang} setEmargementLoading={setEmargementLoading} setEmargementOpen={setEmargementOpen} transportByEquipe={transportByEquipe} transportConfig={transportConfig} />}
                </div>
            );
        }

export { QuinzaineTab };
