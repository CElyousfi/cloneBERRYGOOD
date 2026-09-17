/*
 * CampagneBudgetTab.jsx — Saisie du budget JH / Ha par parcelle × opération
 *
 * Omar saisit un budget de main d'œuvre en JOURS-HOMME PAR HECTARE, pour une
 * parcelle donnée, au niveau NATURE OPÉRATION (≈108 opérations), regroupées par
 * famille (Ferti-irrigation, Taille, Entretien structure…). Ce budget
 * alimentera plus tard l'export Campagne (% consommé, JH/Ha restant, Total JH
 * restant) — LOT suivant, hors de ce fichier.
 *
 * DEUX NIVEAUX DE SAISIE, sans migration des données déjà enregistrées :
 *   - par OPÉRATION : le mode nominal ;
 *   - par FAMILLE : quand aucune opération de la famille n'est budgétée. C'est
 *     le cas réel de « Service générale » dans le fichier d'Omar, et c'est
 *     aussi la forme des documents écrits par le lot précédent.
 * Le niveau famille est le cas NOMINAL, pas un cas limite : dans le fichier
 * d'Omar, « Récolte » (1800 JH/Ha, ~73 % du budget) et « Service générale » ne
 * sont budgétées qu'au total de famille, aucune de leurs 11 + 18 opérations
 * n'est renseignée.
 *
 * Total d'une famille (CBT_familleTotal, PURE) : somme de ses opérations si
 * elle en porte au moins une, SINON sa valeur de famille. Jamais les deux —
 * la ligne « famille » devient donc calculée (non éditable) dès qu'une
 * opération est renseignée, et redevient saisissable si on efface toutes les
 * opérations.
 *
 * CAS MIXTE (total de famille saisi ET quelques opérations renseignées) : les
 * opérations gagnent, la valeur de famille est neutralisée à l'enregistrement.
 * Additionner reviendrait à compter deux fois ce que les opérations détaillent
 * déjà ; garder la valeur de famille en base la ferait ressurgir après
 * effacement des opérations. Comme c'est une perte de saisie, elle est signalée
 * TROIS fois, jamais par un simple `title=` (invisible au doigt) :
 *   1. badge ambre TEXTE sur la ligne, portant la valeur menacée ;
 *   2. confirmation avant l'écriture, listant TOUTES les familles concernées —
 *      le save porte sur la parcelle entière, donc une famille repliée peut
 *      être neutralisée par un enregistrement déclenché pour une autre ;
 *   3. rapport ambre après l'écriture, alimenté par `familles_neutralisees`
 *      renvoyé par le backend (seule source fiable de ce qui a réellement été
 *      remplacé).
 *
 * CLÉ D'UNE OPÉRATION = (CODE GB, LIBELLÉ), jamais (FAMILLE, LIBELLÉ). Le
 * tableau Campagne ne lit pas la famille inscrite sur la fiche d'une opération :
 * il la déduit du code GB porté par chaque ligne de pointage BEE ONE
 * (`resolveFamily` → `_refMap[code].famille`). Deux fiches légitimes portent le
 * même libellé sous deux codes — « Nettoyage » existe en GB05 (Entretien
 * structure) ET en GB11 (Service générale). Cet écran résout donc la famille
 * DEPUIS LE CODE (`familles_par_code`, servi par referentiel-taches-list),
 * identifie chaque opération par la clé `CODE::Libellé`, et AFFICHE le code à
 * côté du libellé : deux lignes distinctes, deux budgets distincts, aucune
 * ambiguïté à l'œil.
 *
 * Sources :
 *   GET  /api/pointage-rh?action=parcelles-campagne-list   (parcelles campagne)
 *   GET  /api/pointage-rh?action=sb-referentiel-list       (nom SB + Ha)
 *   GET  /api/pointage-rh?action=referentiel-taches-list   (familles — jamais figées)
 *   GET  /api/pointage-rh?action=campagne-budget-list      (budgets enregistrés)
 *   POST /api/pointage-rh?action=campagne-budget-save      (upsert, DG/RH/admin)
 *
 * Écriture Firestore : Cloud Function UNIQUEMENT (la collection
 * `sb_campagne_budget_jh` est en deny total côté règles).
 */

import * as CampagneBudgetQuinzaine from '../shared/lib/campagneBudgetQuinzaine.js';
import * as CampagneRythme from '../shared/lib/campagneRythme.js';
import { sbParcelle } from '../shared/sbParcelleState.js';
import { sbParcelleHa } from '../agronomie/sbParcelleHa.jsx';
import { sbParcelleNom } from '../agronomie/sbParcelleNom.jsx';
import { CBT_C, CBT_FAMILLE_ICONS, cbtCulture, cbtHa, cbtNom, CBT_opKey, CBT_splitOpKey, CBT_familleDuCode, CBT_operationLabel, CBT_famillesFromOps, CBT_opsByFamille, CBT_budgetsByLabel, CBT_operationsByLabel, CBT_num, CBT_familleTotal, CBT_famillesNeutralisees, CBT_memeNeutralisations, CBT_CULTURES_QUINZAINE, CBT_quinzaineApplicable, CBT_CULTURES_MASQUEES, CBT_cultureRow, CBT_parcelleAffichable, CBT_PORTEES, CBT_varieteKey, CBT_porteeOptions, CBT_targetLabels, CBT_valeursCommunes, CBT_surfaceCible, CBT_quinzainesSupprimees, CBT_buildSavePayload, CBT_buildFanoutPayload, CBT_saveMessage, CBT_fanoutEcrasements, CBT_signatureFanout, CBT_memeFanout, CBT_fanoutMessage, CBT_totalJH, CBT_CultureBadge } from './campagneBudgetRules.jsx';

var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;

function CampagneBudgetTab(props) {
  var userRole = String((props && props.userRole) || '').toLowerCase();
  var canEdit = userRole === 'dg' || userRole === 'rh' || userRole === 'admin';

  var _rows = useState([]);
  var rows = _rows[0]; var setRows = _rows[1];
  var _familles = useState([]);
  var familles = _familles[0]; var setFamilles = _familles[1];
  var _budgets = useState({});
  var budgetsByLabel = _budgets[0]; var setBudgetsByLabel = _budgets[1];
  var _campagne = useState('');
  var campagne = _campagne[0]; var setCampagne = _campagne[1];
  var _sel = useState('');
  var selected = _sel[0]; var setSelected = _sel[1];
  var _values = useState({});
  var values = _values[0]; var setValues = _values[1];
  var _loading = useState(true);
  var loading = _loading[0]; var setLoading = _loading[1];
  var _err = useState(null);
  var err = _err[0]; var setErr = _err[1];
  var _saving = useState(false);
  var saving = _saving[0]; var setSaving = _saving[1];
  var _msg = useState(null);
  var msg = _msg[0]; var setMsg = _msg[1]; // { type: 'ok'|'ko', text }
  var _tick = useState(0);
  var tick = _tick[0]; var setTick = _tick[1];
  // États du niveau OPÉRATION — ajoutés APRÈS les précédents à dessein :
  // l'ordre des useState est l'index de state de React, le décaler
  // renumérote tout (et casse le harnais de test qui indexe par position).
  var _opsByFamille = useState({});
  var opsByFamille = _opsByFamille[0]; var setOpsByFamille = _opsByFamille[1];
  var _opBudgets = useState({});
  var opBudgetsByLabel = _opBudgets[0]; var setOpBudgetsByLabel = _opBudgets[1];
  var _opValues = useState({});
  var opValues = _opValues[0]; var setOpValues = _opValues[1];
  // Repliage par famille : ~108 opérations, tout déplier d'emblée noierait
  // l'écran. Persiste d'une parcelle à l'autre (on compare souvent la même
  // famille sur plusieurs parcelles).
  var _open = useState({});
  var openFamilles = _open[0]; var setOpenFamilles = _open[1];
  // Familles dont la valeur de famille va être remplacée : null = pas de
  // confirmation en attente.
  var _confirm = useState(null);
  var confirmList = _confirm[0]; var setConfirmList = _confirm[1];
  // États du BUDGET DE QUINZAINE — ajoutés APRÈS les précédents à dessein
  // (l'ordre des useState est l'index de state de React).
  // Quinzaines de la campagne, DÉRIVÉES des `periodes` de
  // `campagne-analytique-detail` : jamais un calendrier local, jamais « 24 ».
  var _quinzOpts = useState([]);
  var quinzOptions = _quinzOpts[0]; var setQuinzOptions = _quinzOpts[1];
  var _quinzCour = useState('');
  var quinzCourante = _quinzCour[0]; var setQuinzCourante = _quinzCour[1];
  // '' = suivre la quinzaine en cours ; une valeur = consultation/correction
  // d'une quinzaine passée.
  var _quinzSel = useState('');
  var quinzSel = _quinzSel[0]; var setQuinzSel = _quinzSel[1];
  var _quinzBudgets = useState({});
  var quinzByLabel = _quinzBudgets[0]; var setQuinzByLabel = _quinzBudgets[1];
  var _quinzValues = useState({});
  var quinzValues = _quinzValues[0]; var setQuinzValues = _quinzValues[1];
  // Engagements qui vont être effacés — confirmés séparément des
  // neutralisations de famille, mais dans le même panneau.
  var _confirmQuinz = useState(null);
  var confirmQuinz = _confirmQuinz[0]; var setConfirmQuinz = _confirmQuinz[1];
  // États de la PORTÉE DE SAISIE — APPENDUS après les précédents à dessein :
  // l'ordre des useState EST l'index de state de React, et le harnais de test
  // (tests/unit/campagneBudgetTab.test.js) indexe par position. Insérer un
  // state au milieu renumérote tout et fait basculer silencieusement les tests
  // de rendu existants sur les mauvais états.
  //
  // `selected` (index 4) n'est PAS réutilisé pour porter la cible multiple :
  // trois effets en dépendent et la portée Parcelle doit rester bit pour bit
  // identique à ce qu'elle est aujourd'hui.
  var _portee = useState('parcelle');
  var portee = _portee[0]; var setPortee = _portee[1];
  var _varieteSel = useState('');
  var varieteSel = _varieteSel[0]; var setVarieteSel = _varieteSel[1];
  var _cultureSel = useState('');
  var cultureSel = _cultureSel[0]; var setCultureSel = _cultureSel[1];
  // Déclarés MAINTENANT pour figer l'ordre des states une fois pour toutes ;
  // ils ne seront consommés qu'au lot « confirmation et remontée » (fan-out) :
  // périmètre confirmé avant écriture, et résultat par parcelle après.
  var _confirmFanout = useState(null);
  var confirmFanout = _confirmFanout[0]; var setConfirmFanout = _confirmFanout[1];
  var _fanoutResults = useState(null);
  var fanoutResults = _fanoutResults[0]; var setFanoutResults = _fanoutResults[1];
  // Familles TOUCHÉES depuis le dernier changement de portée / de cible /
  // rafraîchissement. Clé = FAMILLE et non le champ : c'est l'unité d'envoi du
  // fan-out (cf. CBT_buildFanoutPayload). Alimenté aussi en portée Parcelle —
  // c'est sans effet là-bas (CBT_buildSavePayload envoie tout), et une garde
  // conditionnelle sur un `onChange` serait une source de bug muet.
  var _touched = useState({});
  var touched = _touched[0]; var setTouched = _touched[1];

  useEffect(function () {
    var cancelled = false;
    setLoading(true);
    setErr(null);
    Promise.all([
      fetch('/api/pointage-rh?action=parcelles-campagne-list').then(function (r) { return r.json(); }),
      fetch('/api/pointage-rh?action=sb-referentiel-list').then(function (r) { return r.json(); }),
      fetch('/api/pointage-rh?action=referentiel-taches-list').then(function (r) { return r.json(); }),
      fetch('/api/pointage-rh?action=campagne-budget-list').then(function (r) { return r.json(); }),
      // MÊME source que le réalisé affiché sur l'écran Campagne : la liste des
      // quinzaines et la quinzaine en cours en sont dérivées, elles ne peuvent
      // donc pas diverger de lui. Réponse mise en cache 30 min côté serveur.
      // Échec ISOLÉ (`catch` local) : le budget annuel doit rester saisissable
      // même si cet appel tombe — on perd alors le seul suivi court terme.
      fetch('/api/pointage-rh?action=campagne-analytique-detail')
        .then(function (r) { return r.json(); })
        .catch(function () { return null; }),
    ])
      .then(function (res) {
        if (cancelled) return;
        var parc = res[0]; var sb = res[1]; var taches = res[2]; var buds = res[3];
        var detail = res[4];
        if (!parc || !parc.success) throw new Error((parc && parc.error) || 'Erreur parcelles');
        if (!taches || !taches.success) throw new Error((taches && taches.error) || 'Erreur référentiel tâches');
        if (!buds || !buds.success) throw new Error((buds && buds.error) || 'Erreur budgets');
        // Référentiel SB : alimente SB_PARCELLE_REF, consommé par les
        // helpers globaux sbParcelleHa / sbParcelleNom (pas de duplication).
        if (sb && sb.success) {
          var map = {};
          (sb.parcelles || []).forEach(function (p) {
            map[String(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
          });
          sbParcelle.REF = map;
        }
        setRows(parc.campagne_courante || []);
        // `familles_par_code` = la table de résolution du tableau Campagne.
        // Absente (backend antérieur) → repli sur la famille de la fiche, comme
        // avant : l'écran reste utilisable, il perd seulement l'alignement.
        var famillesParCode = taches.familles_par_code || {};
        setFamilles(CBT_famillesFromOps(taches.operations || [], famillesParCode));
        setOpsByFamille(CBT_opsByFamille(taches.operations || [], famillesParCode));
        // Les budgets sont indexés TELS QUELS, sans retirer les documents des
        // cultures masquées : `budgetsByLabel` n'est jamais parcouru, il n'est
        // lu que PAR LABEL, et tous les labels lus dérivent de
        // `rowsAffichables` → les documents avocatier sont inertes.
        // RÉSERVE : le jour où cet écran affichera un total « toutes
        // parcelles », c'est ICI qu'il faudra filtrer.
        setBudgetsByLabel(CBT_budgetsByLabel(buds.budgets || []));
        setOpBudgetsByLabel(CBT_operationsByLabel(buds.budgets || []));
        setCampagne(buds.campagne || '');
        // Budget de quinzaine : mêmes documents, même appel. Les modules purs
        // sont chargés en <script> séparés — absents (404, déploiement
        // partiel), l'écran perd la section quinzaine et rien d'autre.
        var CBQ = CampagneBudgetQuinzaine;
        var CR = CampagneRythme;
        setQuinzByLabel(CBQ ? CBQ.quinzainesByLabel(buds.budgets || []) : {});
        if (CBQ && CR && detail && detail.success) {
          setQuinzOptions(CBQ.optionsFromPeriodes(detail.periodes));
          setQuinzCourante(CBQ.quinzaineCourante(
            CR.quinzainesInfo({ periodes: detail.periodes, campagne: detail.campagne })
          ));
        } else {
          setQuinzOptions([]);
          setQuinzCourante('');
        }
      })
      .catch(function (e) { if (!cancelled) setErr(e.message); })
      .finally(function () { if (!cancelled) setLoading(false); });
    return function () { cancelled = true; };
  }, [tick]);

  // Parcelles PROPOSABLES à la saisie — dérivé, jamais un filtre sur le state
  // `rows` : `selectedRow` (plus bas) doit continuer de retrouver une parcelle
  // masquée, sinon une sélection héritée cesse d'être identifiable (Ha, badge,
  // culture) au lieu d'être simplement désélectionnée.
  // Ce dérivé n'est utilisé que là où l'écran peut ÉCRIRE : le sélecteur, les
  // buckets de portée et les cibles d'enregistrement.
  // Deps `[rows]` VOLONTAIRES : `SB_PARCELLE_REF` est posé dans le MÊME
  // `.then()` que `setRows` (cf. le chargement ci-dessus), la map est donc
  // présente dès que ce memo recalcule. Ne pas ajouter de dépendance
  // supplémentaire ni d'effet séparé qui lirait la map avant qu'elle existe.
  // Déclaré AVANT les effets de synchronisation des champs : ceux-ci en
  // dérivent leurs dépendances, et un `var` encore `undefined` au moment où le
  // tableau de deps est évalué (au rendu) figerait l'effet à jamais.
  var rowsAffichables = useMemo(function () {
    var sbMap = sbParcelle.REF || {};
    return (rows || []).filter(function (r) { return CBT_parcelleAffichable(r, sbMap); });
  }, [rows]);

  var options = useMemo(function () {
    return (rowsAffichables || []).slice().sort(function (a, b) {
      return cbtNom(a.label).localeCompare(cbtNom(b.label));
    });
  }, [rowsAffichables]);

  // PORTÉE : buckets proposables (variétés et cultures réellement présentes),
  // jamais une liste figée. Un bucket vide n'existe pas — il n'y a donc rien à
  // choisir qui ne désigne aucune parcelle.
  var porteeOpts = useMemo(function () {
    return CBT_porteeOptions({ rows: rowsAffichables, sbMap: sbParcelle.REF || {} });
  }, [rowsAffichables]);

  var porteeMulti = portee === 'variete' || portee === 'culture';
  var cible = portee === 'variete' ? varieteSel : (portee === 'culture' ? cultureSel : '');

  // Parcelles réellement visées par un enregistrement. Portée Parcelle : la
  // seule parcelle sélectionnée — le chemin d'aujourd'hui, inchangé.
  var targetLabels = useMemo(function () {
    return CBT_targetLabels({
      portee: portee, rows: rowsAffichables, label: selected, cible: cible,
      sbMap: sbParcelle.REF || {},
    });
  }, [portee, rowsAffichables, selected, cible]);

  // Une parcelle sélectionnée peut cesser d'être proposable (référentiel SB
  // rechargé, `culture_sb` corrigée en cours de session) : on désélectionne
  // plutôt que de laisser une saisie ouverte sur une parcelle que le sélecteur
  // n'affiche plus. Les effets ci-dessous vident alors `values` / `opValues` /
  // `msg`.
  useEffect(function () {
    if (!selected) return;
    var key = String(selected).toUpperCase().trim();
    var present = (rowsAffichables || []).some(function (r) {
      return String((r && r.label) || '').toUpperCase().trim() === key;
    });
    if (!present) setSelected('');
  }, [selected, rowsAffichables]);

  // Une cible de portée multiple peut disparaître elle aussi (rechargement,
  // dernière parcelle de la variété reclassée) : même traitement, on retombe
  // sur « aucune cible » plutôt que d'afficher une grille qui n'écrirait nulle
  // part. Le rendu gère `targetLabels.length === 0` explicitement.
  useEffect(function () {
    if (varieteSel && !porteeOpts.varietes.some(function (v) { return v.key === varieteSel; })) {
      setVarieteSel('');
    }
    if (cultureSel && !porteeOpts.cultures.some(function (c) { return c.key === cultureSel; })) {
      setCultureSel('');
    }
  }, [porteeOpts, varieteSel, cultureSel]);

  // Le suivi des champs touchés est LOCAL à une portée et à une cible : garder
  // « Récolte touchée » après un changement de variété propagerait à la variété
  // B une saisie faite pour la A. Même raison pour `tick` (tout est relu).
  useEffect(function () {
    setTouched({});
  }, [portee, cible, tick]);

  /** Marque une famille comme touchée — unité d'envoi du fan-out. */
  function marquerTouchee(famille) {
    setTouched(function (prev) {
      if (prev && prev[famille]) return prev;
      var next = Object.assign({}, prev);
      next[famille] = true;
      return next;
    });
  }

  // Le message (succès/erreur) n'est effacé QUE par un changement de PÉRIMÈTRE
  // de saisie : parcelle, portée, cible. Effet séparé À DESSEIN : la synchro
  // des champs ci-dessous dépend aussi de `budgetsByLabel`, que le save met à
  // jour — regrouper les deux effaçait « Budget enregistré » dans le même rendu
  // (React 18 batche les setState), l'utilisateur ne voyait jamais un succès,
  // seulement les erreurs. Ne JAMAIS ajouter `budgetsByLabel` ici.
  useEffect(function () {
    setMsg(null);
  }, [selected, portee, cible]);

  // Une confirmation en attente devient CADUQUE dès que l'état qui l'a
  // produite change. Le panneau vit dans le tableau, sous un sélecteur de
  // parcelle resté actif : sans ce reset, on pouvait changer de parcelle puis
  // confirmer — le panneau affichant les chiffres de la parcelle A pendant que
  // l'écriture portait sur B, dont les valeurs de famille n'ont jamais été
  // confirmées. Même mécanisme via « Rafraîchir » (tick), qui recharge tout.
  // Le changement de QUINZAINE invalide la confirmation au même titre que le
  // changement de parcelle : le panneau afficherait les engagements de la
  // quinzaine A pendant que l'écriture porterait sur la B.
  // Le changement de PORTÉE ou de CIBLE l'invalide pour la même raison, en
  // pire : une confirmation posée en portée Parcelle survivait au passage en
  // portée Variété, et son « Confirmer et enregistrer » repartait sur le
  // chemin mono-parcelle avec la grille COMMUNE de N parcelles — donc à 0 les
  // lignes divergentes que l'écran venait d'annoncer comme non modifiées.
  // Ce reset est la CEINTURE ; la bretelle est la garde en tête de handleSave
  // (et le panneau masqué en portée multiple) : on ne confie pas 23 budgets à
  // un tableau de dépendances.
  useEffect(function () {
    setConfirmList(null);
    setConfirmQuinz(null);
    setConfirmFanout(null);
    setFanoutResults(null);
  }, [selected, tick, quinzSel, portee, cible]);

  // Valeurs COMMUNES aux parcelles cibles, en portée multiple : ce qui est
  // identique partout est pré-rempli, ce qui diverge reste vide et est SIGNALÉ.
  // null en portée Parcelle — c'est la garde qui garantit que le chemin
  // historique ne change pas d'un octet.
  var communCibles = useMemo(function () {
    if (!porteeMulti) return null;
    return CBT_valeursCommunes({
      labels: targetLabels, familles: familles, opsByFamille: opsByFamille,
      budgetsByLabel: budgetsByLabel, opBudgetsByLabel: opBudgetsByLabel,
    });
  }, [porteeMulti, targetLabels, familles, opsByFamille, budgetsByLabel, opBudgetsByLabel]);

  // Lignes divergentes entre les parcelles cibles. ⚠️ Un champ vide a DEUX
  // causes (tout à 0, ou divergence) : ces deux maps sont le SEUL porteur de la
  // distinction, cf. CBT_valeursCommunes.
  var divergentes = (communCibles && communCibles.divergentes) || {};
  var divergentesOps = (communCibles && communCibles.divergentesOps) || {};

  // Changement de parcelle, de portée, de cible (ou de budgets connus) →
  // recharger les champs. UNE SEULE source de `setValues` / `setOpValues`,
  // guardée par la portée : deux effets en course sur les mêmes champs
  // produiraient une grille dont la valeur dépend de l'ordre de résolution.
  useEffect(function () {
    if (porteeMulti) {
      setValues(communCibles ? communCibles.values : {});
      setOpValues(communCibles ? communCibles.opValues : {});
      return;
    }
    if (!selected) { setValues({}); setOpValues({}); return; }
    var key = selected.toUpperCase();
    var saved = budgetsByLabel[key] || {};
    var savedOps = opBudgetsByLabel[key] || {};
    var next = {};
    var nextOps = {};
    familles.forEach(function (f) {
      next[f] = saved[f] != null ? String(saved[f]) : '';
      var famSaved = savedOps[f] || {};
      var famNext = {};
      (opsByFamille[f] || []).forEach(function (op) {
        famNext[op] = famSaved[op] != null ? String(famSaved[op]) : '';
      });
      nextOps[f] = famNext;
    });
    setValues(next);
    setOpValues(nextOps);
  }, [porteeMulti, communCibles, selected, familles, opsByFamille,
    budgetsByLabel, opBudgetsByLabel]);

  // Quinzaine éditée : la quinzaine en cours par défaut ; un choix explicite
  // devenu invalide (rechargement, campagne changée) y retombe plutôt que
  // d'écrire dans une quinzaine que l'écran n'affiche plus.
  var quinzaineActive = (quinzSel && (quinzOptions || []).some(function (o) {
    return o.key === quinzSel;
  })) ? quinzSel : quinzCourante;

  // Valeurs enregistrées pour la parcelle et la quinzaine éditées.
  var quinzEnregistrees = useMemo(function () {
    var key = String(selected || '').toUpperCase().trim();
    if (!key || !quinzaineActive) return {};
    return ((quinzByLabel[key] || {})[quinzaineActive]) || {};
  }, [quinzByLabel, selected, quinzaineActive]);

  // Champs de saisie de la quinzaine : rechargés à chaque changement de
  // parcelle OU de quinzaine (jamais de report implicite d'une quinzaine sur
  // l'autre — le report est un geste explicite, cf. le bouton dédié).
  useEffect(function () {
    if (!selected || !quinzaineActive) { setQuinzValues({}); return; }
    var next = {};
    familles.forEach(function (f) {
      next[f] = quinzEnregistrees[f] != null ? String(quinzEnregistrees[f]) : '';
    });
    setQuinzValues(next);
  }, [selected, quinzaineActive, familles, quinzEnregistrees]);

  var selectedRow = useMemo(function () {
    var key = String(selected || '').toUpperCase().trim();
    if (!key) return null;
    var hit = null;
    (rows || []).forEach(function (r) {
      if (String(r.label || '').toUpperCase().trim() === key) hit = r;
    });
    return hit;
  }, [rows, selected]);

  // Surface CUMULÉE des parcelles cibles en portée multiple.
  // `Total JH = JH/Ha × Σ ha` est EXACT, et non une approximation : le fan-out
  // écrit la MÊME valeur de JH/Ha sur chaque parcelle, donc
  // Σ(jhHa × ha_i) = jhHa × Σha_i. Ne pas « corriger » ce calcul.
  // Les parcelles sans Ha reçoivent bien le budget, elles ne contribuent
  // simplement pas au Total JH — l'entête le dit explicitement.
  var surfaceCible = useMemo(function () {
    return CBT_surfaceCible(targetLabels, cbtHa);
  }, [targetLabels]);

  var ha = porteeMulti ? surfaceCible.ha : (selectedRow ? cbtHa(selectedRow.label) : 0);
  // Bucket de variété sélectionné (portée Variété) — porte la culture du bucket.
  var varieteBucket = null;
  porteeOpts.varietes.forEach(function (v) { if (v.key === varieteSel) varieteBucket = v; });
  // Culture : dérivée du BUCKET en portée multiple (`selectedRow` y est null).
  // Sans ça le badge disparaîtrait et CBT_quinzaineApplicable recevrait ''.
  var culture = porteeMulti
    ? (portee === 'culture' ? cultureSel : (varieteBucket ? varieteBucket.culture : ''))
    : (selectedRow ? cbtCulture(selectedRow.culture, selectedRow.label) : '');
  // Section quinzaine affichée seulement si : module chargé, quinzaine connue,
  // culture budgétée (l'avocatier ne l'est pas — refus miroir côté serveur) ET
  // portée Parcelle. L'engagement est une décision à 15 jours prise parcelle
  // par parcelle ; comme `CBT_buildSavePayload` n'ajoute `budgets_quinzaine`
  // que si une quinzaine est éditée, le masquage est le seul choix qui
  // PRÉSERVE PROUVABLEMENT les engagements déjà en base.
  var quinzaineSaisissable = !!(quinzaineActive && CBT_quinzaineApplicable(culture))
    && !porteeMulti;
  // Clé envoyée au backend : '' = aucun engagement dans ce save (le champ n'est
  // alors pas transmis du tout, cf. CBT_buildSavePayload).
  var quinzaineAEnvoyer = quinzaineSaisissable ? quinzaineActive : '';
  var quinzaineLabel = '';
  (quinzOptions || []).forEach(function (o) {
    if (o.key === quinzaineActive) quinzaineLabel = o.label;
  });
  // Quinzaine précédente RÉELLEMENT présente dans la campagne (jamais num − 1
  // en aveugle) — source du report en un clic.
  var quinzPrecedente = (function () {
    var CBQ = CampagneBudgetQuinzaine;
    return CBQ ? CBQ.quinzainePrecedente(quinzaineActive, quinzOptions || []) : '';
  })();
  var quinzPrecedenteValeurs = (function () {
    var key = String(selected || '').toUpperCase().trim();
    if (!key || !quinzPrecedente) return {};
    return ((quinzByLabel[key] || {})[quinzPrecedente]) || {};
  })();
  var quinzPrecedenteLabel = '';
  (quinzOptions || []).forEach(function (o) {
    if (o.key === quinzPrecedente) quinzPrecedenteLabel = o.label;
  });

  /**
   * Report des valeurs de la quinzaine précédente dans les champs de la
   * quinzaine éditée. Sans ce geste, la saisie repart de zéro tous les quinze
   * jours et l'écran ne sert pas.
   *
   * Il ne REMPLIT que les champs — rien n'est écrit tant que « Enregistrer »
   * n'a pas été cliqué, et les suppressions qui en découleraient passent par la
   * même confirmation que les autres.
   */
  function reporterQuinzainePrecedente() {
    var next = {};
    familles.forEach(function (f) {
      var v = quinzPrecedenteValeurs[f];
      next[f] = v != null ? String(v) : '';
    });
    setQuinzValues(next);
  }

  /**
   * @param {boolean} [confirme] true = l'utilisateur a validé la liste des
   *   valeurs de famille qui vont être remplacées.
   */
  /**
   * Familles réellement candidates à l'écriture. En portée multiple, seules
   * les familles TOUCHÉES partent (cf. CBT_buildFanoutPayload) : calculer les
   * neutralisations sur toutes les familles affichées y produirait de fausses
   * alertes sur des familles auxquelles personne n'a touché.
   */
  function famillesEnJeu() {
    if (!porteeMulti) return familles;
    return familles.filter(function (f) { return !!touched[f]; });
  }

  /**
   * Enregistrement en portée MULTIPLE (fan-out). Chemin SÉPARÉ du chemin
   * mono-parcelle : payload partiel (`CBT_buildFanoutPayload`), confirmation
   * TOUJOURS requise, et remontée par parcelle.
   *
   * @param {boolean} [confirme]
   */
  function handleSaveFanout(confirme) {
    var built = CBT_buildFanoutPayload({
      campagne: campagne, labels: targetLabels, familles: familles,
      opsByFamille: opsByFamille, values: values, opValues: opValues,
      touched: touched, divergentes: divergentes, divergentesOps: divergentesOps,
    });
    if (!built.ok) {
      setConfirmFanout(null);
      setMsg({ type: 'ko', text: built.error });
      return;
    }
    var ecrasements = CBT_fanoutEcrasements({
      labels: targetLabels, payload: built.payload,
      budgetsByLabel: budgetsByLabel, opBudgetsByLabel: opBudgetsByLabel,
    });
    var menacees = CBT_famillesNeutralisees({
      familles: famillesEnJeu(), values: values, opValues: opValues,
    });
    // Confirmation TOUJOURS requise, même sans écrasement ni neutralisation :
    // écrire N parcelles d'un seul geste n'est jamais un geste ordinaire.
    var signature = CBT_signatureFanout(built.payload);
    if (!confirme) {
      setConfirmFanout({
        labels: targetLabels, ecrasements: ecrasements, signature: signature,
      });
      setConfirmList(menacees);
      setMsg(null);
      return;
    }
    // Bretelles : ce qui a été confirmé doit être EXACTEMENT ce qui va être
    // écrit. La SIGNATURE du payload est le juge — elle couvre la cible, les
    // familles envoyées ET leurs valeurs, donc aussi les deux cas qu'une
    // comparaison d'écrasements laissait passer : une valeur corrigée sans que
    // le nombre d'écrasements bouge (le panneau est juste sous la grille, les
    // champs sont à portée de pouce), et une famille ajoutée après coup.
    // `CBT_memeFanout` reste comme second juge, sur ce qui a été AFFICHÉ.
    if (signature !== (confirmFanout && confirmFanout.signature)
      || !CBT_memeFanout(confirmFanout && confirmFanout.ecrasements, ecrasements)
      || !CBT_memeNeutralisations(confirmList, menacees)) {
      setConfirmFanout({
        labels: targetLabels, ecrasements: ecrasements, signature: signature,
      });
      setConfirmList(menacees.length > 0 ? menacees : null);
      setMsg({
        type: 'ko',
        text: 'La saisie a changé depuis la confirmation — vérifiez, puis enregistrez à nouveau.',
      });
      return;
    }
    var nbDemandes = targetLabels.length;
    setConfirmFanout(null);
    setConfirmList(null);
    setFanoutResults(null);
    setSaving(true);
    setMsg(null);
    fetch('/api/pointage-rh?action=campagne-budget-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(built.payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) throw new Error((d && d.error) || 'Erreur serveur');
        var results = Array.isArray(d.results) ? d.results : [];
        var oks = results.filter(function (r) { return r && r.ok && r.label_bee_one; });
        // RÉALIGNEMENT depuis CHAQUE relecture serveur, jamais depuis ce qu'on
        // croyait envoyer : une parcelle en échec ne doit pas être affichée
        // comme si elle avait été écrite.
        if (oks.length > 0) {
          setBudgetsByLabel(function (prev) {
            var next = Object.assign({}, prev);
            oks.forEach(function (r) {
              next[String(r.label_bee_one).toUpperCase().trim()] = r.budgets || {};
            });
            return next;
          });
          setOpBudgetsByLabel(function (prev) {
            var next = Object.assign({}, prev);
            oks.forEach(function (r) {
              next[String(r.label_bee_one).toUpperCase().trim()] = r.budgets_operations || {};
            });
            return next;
          });
          setQuinzByLabel(function (prev) {
            var next = Object.assign({}, prev);
            var CBQ = CampagneBudgetQuinzaine;
            oks.forEach(function (r) {
              var key = String(r.label_bee_one).toUpperCase().trim();
              next[key] = CBQ
                ? (CBQ.quinzainesByLabel([{
                  label_bee_one: key, budgets_quinzaine: r.budgets_quinzaine || {},
                }])[key] || {})
                : (r.budgets_quinzaine || {});
            });
            return next;
          });
        }
        // Les familles envoyées ne sont plus « touchées » : sans ce reset, un
        // second clic renverrait les mêmes familles alors que l'écran affiche
        // désormais les valeurs relues.
        setTouched({});
        // Rapport par parcelle affiché SEULEMENT s'il y a au moins un échec.
        setFanoutResults(results.some(function (r) { return !(r && r.ok); }) ? results : null);
        setMsg(CBT_fanoutMessage(d, nbDemandes, cbtNom));
        // SKEW DE DÉPLOIEMENT (`results` absent alors qu'on visait plusieurs
        // parcelles) : le backend antérieur A écrit une parcelle, mais on ne
        // sait pas laquelle porte quoi et le réalignement ci-dessus n'a rien eu
        // à consommer. On relit la base plutôt que de laisser l'écran mentir
        // jusqu'au prochain Rafraîchir manuel.
        if (!Array.isArray(d.results) && nbDemandes > 1) {
          setTick(function (t) { return t + 1; });
        }
      })
      .catch(function (e) {
        // On ne sait pas ce qui a été écrit : on ne l'invente pas, on le dit et
        // on relit la base (tick) — le seul état digne de confiance.
        setMsg({
          type: 'ko',
          text: 'Enregistrement interrompu (' + e.message + ') — des parcelles ont'
            + ' peut-être été enregistrées, état inconnu. L\'écran est rechargé.',
        });
        setTick(function (t) { return t + 1; });
      })
      .finally(function () { setSaving(false); });
  }

  function handleSave(confirme) {
    // DISPATCH — deux chemins d'écriture aux sémantiques OPPOSÉES, et cette
    // fonction est celle du chemin MONO-PARCELLE : elle construit son body avec
    // `CBT_buildSavePayload`, qui envoie toutes les familles affichées et
    // EFFACE celles laissées vides. En portée multiple, la grille est la grille
    // COMMUNE de N parcelles : ses champs vides signifient « divergent, ne pas
    // toucher », pas « mettre à 0 ». La séparation est structurelle et pas
    // seulement un `if` de rendu : aucun appelant ne peut se tromper de chemin.
    if (porteeMulti) { handleSaveFanout(confirme); return; }
    // Le save porte sur TOUTE la parcelle, pas sur la famille éditée : une
    // famille repliée peut être neutralisée sans que rien ne l'ait montré.
    // C'est la seule protection possible pour ce cas — on demande donc une
    // confirmation explicite, avec la liste et les valeurs concernées.
    var menacees = CBT_famillesNeutralisees({
      familles: familles, values: values, opValues: opValues,
    });
    // Engagements de quinzaine qui vont disparaître : même exigence de
    // confirmation explicite. Ils ne sont visibles nulle part ailleurs une
    // fois le champ vidé.
    var quinzMenacees = quinzaineAEnvoyer
      ? CBT_quinzainesSupprimees({
        familles: familles, enregistrees: quinzEnregistrees, values: quinzValues,
      })
      : [];
    if (!confirme) {
      if (menacees.length > 0 || quinzMenacees.length > 0) {
        setConfirmList(menacees);
        setConfirmQuinz(quinzMenacees);
        setMsg(null);
        return;
      }
    } else if (!CBT_memeNeutralisations(confirmList, menacees)
      || !CBT_memeNeutralisations(confirmQuinz, quinzMenacees)) {
      // Bretelles : on ne se fie pas au seul reset de `confirmList` par les
      // effets. Ce qui a été confirmé doit être EXACTEMENT ce qui va être
      // écrit, sinon on refuse et on re-demande. Ferme aussi tout chemin
      // futur qui rendrait la confirmation obsolète autrement.
      setConfirmList(menacees.length > 0 ? menacees : null);
      setMsg({
        type: 'ko',
        text: 'La saisie a changé depuis la confirmation — vérifiez, puis enregistrez à nouveau.',
      });
      return;
    }
    setConfirmList(null);
    setConfirmQuinz(null);
    var built = CBT_buildSavePayload({
      campagne: campagne, label: selected, familles: familles,
      opsByFamille: opsByFamille, values: values, opValues: opValues,
      quinzaine: quinzaineAEnvoyer, quinzValues: quinzValues,
    });
    if (!built.ok) { setMsg({ type: 'ko', text: built.error }); return; }
    setSaving(true);
    setMsg(null);
    fetch('/api/pointage-rh?action=campagne-budget-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(built.payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) throw new Error((d && d.error) || 'Erreur serveur');
        var savedKey = String(d.label_bee_one || selected).toUpperCase().trim();
        setBudgetsByLabel(function (prev) {
          var next = Object.assign({}, prev);
          next[savedKey] = d.budgets || {};
          return next;
        });
        setOpBudgetsByLabel(function (prev) {
          var next = Object.assign({}, prev);
          next[savedKey] = d.budgets_operations || {};
          return next;
        });
        // Réponse RELUE en base par le backend : on réaligne l'écran sur ce
        // qui est persisté, jamais sur ce qu'on croyait envoyer.
        setQuinzByLabel(function (prev) {
          var next = Object.assign({}, prev);
          var CBQ = CampagneBudgetQuinzaine;
          next[savedKey] = CBQ
            ? (CBQ.quinzainesByLabel([{
              label_bee_one: savedKey, budgets_quinzaine: d.budgets_quinzaine || {},
            }])[savedKey] || {})
            : (d.budgets_quinzaine || {});
          return next;
        });
        // Les champs touchés le sont pour CETTE saisie : après un save réussi,
        // repartir de zéro (sans effet sur ce chemin, qui envoie tout — mais un
        // état résiduel n'a aucune raison de survivre à l'écriture).
        setTouched({});
        // Message posé APRÈS setBudgetsByLabel : l'effet de reset du message
        // ne dépend pas de `budgetsByLabel` (cf. plus haut), la mise à jour des
        // budgets ne l'efface donc pas.
        setMsg(CBT_saveMessage(d));
      })
      .catch(function (e) { setMsg({ type: 'ko', text: e.message }); })
      .finally(function () { setSaving(false); });
  }

  // Libellé de la cible et parcelles sans Ha, pour l'entête de portée.
  var porteeCibleLabel = portee === 'culture'
    ? cultureSel
    : (varieteBucket ? varieteBucket.label : '');
  var porteeSansHaReste = surfaceCible.sansHa.length - 3;
  var porteeSansHaNoms = surfaceCible.sansHa.slice(0, 3).map(cbtNom).join(', ')
    + (porteeSansHaReste > 0
      ? ' et ' + porteeSansHaReste + (porteeSansHaReste > 1 ? ' autres' : ' autre')
      : '');
  // La grille n'a de sens que si l'enregistrement porterait sur au moins une
  // parcelle. En portée multiple, une cible non choisie donne 0 cible.
  var grilleVisible = porteeMulti ? targetLabels.length > 0 : !!selected;

  var inputStyle = {
    border: '1px solid ' + CBT_C.border, borderRadius: 6, padding: '5px 8px',
    fontSize: 12, outline: 'none', width: 90, textAlign: 'right',
    boxSizing: 'border-box',
  };
  // Badge ambre — style PARTAGÉ par l'avertissement de neutralisation de
  // famille et par le signalement de divergence entre parcelles cibles. Extrait
  // une fois : deux copies divergeraient à la première retouche visuelle.
  var badgeAmbre = {
    display: 'inline-block', marginLeft: 8, padding: '1px 7px',
    borderRadius: 9, fontSize: 10.5, fontWeight: 700,
    background: '#fef3c7', color: CBT_C.amber, whiteSpace: 'nowrap',
  };

  /**
   * Libellé d'une divergence. La conséquence dépend de l'état de la famille :
   * non touchée, la ligne n'est pas envoyée (donc pas modifiée) ; touchée, la
   * famille part ENTIÈRE et l'enregistrement sera REFUSÉ tant que ce champ
   * reste vide (cf. CBT_buildFanoutPayload). Dire l'un dans le cas de l'autre
   * serait faux.
   *
   * @param {{nb: number, min: number, max: number}} d
   * @param {boolean} toucheeFamille
   * @returns {string}
   */
  function libelleDivergence(d, toucheeFamille) {
    return d.nb + ' valeurs différentes (' + d.min + ' → ' + d.max + ') — '
      + (toucheeFamille
        ? 'à saisir avant d\'enregistrer'
        : 'non modifiée à l\'enregistrement');
  }
  var thStyle = {
    textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700,
    color: CBT_C.textSec, borderBottom: '2px solid ' + CBT_C.border,
    whiteSpace: 'nowrap', background: CBT_C.surface2,
  };
  var tdStyle = {
    padding: '8px 10px', fontSize: 12, color: CBT_C.text,
    borderBottom: '1px solid ' + CBT_C.border, verticalAlign: 'middle',
  };

  // Total de la parcelle = somme des totaux de famille (règle métier), donc
  // jamais un double comptage famille + opérations.
  var totalJH = 0;
  var totalJhHa = 0;
  familles.forEach(function (f) {
    var t = CBT_familleTotal(f, values, opValues);
    totalJhHa += t.total;
    totalJH += CBT_totalJH(t.total, ha);
  });
  totalJhHa = Math.round(totalJhHa * 100) / 100;

  // Total ENGAGÉ sur la quinzaine éditée. Somme simple des familles : aucune
  // règle « opérations > famille » ici, l'engagement n'a qu'un seul niveau.
  var totalQuinzJhHa = 0;
  familles.forEach(function (f) { totalQuinzJhHa += CBT_num(quinzValues[f]); });
  totalQuinzJhHa = Math.round(totalQuinzJhHa * 100) / 100;

  function setOpValue(famille, operation, v) {
    // Toucher une opération touche SA FAMILLE : c'est la famille entière qui
    // partira (cf. CBT_buildFanoutPayload).
    marquerTouchee(famille);
    setOpValues(function (prev) {
      var next = Object.assign({}, prev);
      next[famille] = Object.assign({}, next[famille] || {});
      next[famille][operation] = v;
      return next;
    });
  }

  function toggleFamille(famille) {
    setOpenFamilles(function (prev) {
      var next = Object.assign({}, prev);
      if (next[famille]) delete next[famille];
      else next[famille] = true;
      return next;
    });
  }

  return React.createElement('div', { style: { padding: '20px 24px', maxWidth: 900 } },

    React.createElement('div', { style: { marginBottom: 16 } },
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 800, color: CBT_C.text, margin: 0 } },
        React.createElement('i', { className: 'fa-solid fa-bullseye', style: { marginRight: 10, color: CBT_C.berry } }),
        'Budget JH / Ha'
      ),
      React.createElement('p', { style: { margin: '4px 0 0', fontSize: 12, color: CBT_C.textTer } },
        'Budget de main d\'œuvre par parcelle et par nature d\'opération'
          + (campagne ? ' — campagne ' + campagne : '')
          + (canEdit ? '.' : ' (lecture seule — saisie réservée DG/RH).')
      )
    ),

    loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: CBT_C.textTer } },
      React.createElement('i', { className: 'fa-solid fa-circle-notch fa-spin', style: { fontSize: 22 } })
    ),

    err && React.createElement('div', {
      style: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#991b1b', fontSize: 13 },
    }, React.createElement('i', { className: 'fa-solid fa-circle-exclamation', style: { marginRight: 8 } }), err),

    !loading && !err && React.createElement(React.Fragment, null,

      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
      },
        // SÉLECTEUR DE PORTÉE. Un budget est en pratique identique pour toutes
        // les parcelles d'une même variété : le saisir 23 fois est le vrai coût
        // d'usage de l'écran. Boutons segmentés (et non un <select>) : la cible
        // est visible d'un coup d'œil et atteignable au doigt — la validation
        // se fait au téléphone. VISIBLE en lecture seule : consulter le budget
        // d'une variété est légitime, seul « Enregistrer » disparaît.
        React.createElement('div', {
          style: {
            display: 'flex', border: '1px solid ' + CBT_C.border,
            borderRadius: 8, overflow: 'hidden',
          },
        },
          CBT_PORTEES.map(function (p, i) {
            var actif = portee === p.key;
            return React.createElement('button', {
              key: p.key,
              onClick: function () { setPortee(p.key); },
              title: p.aide,
              style: {
                padding: '9px 14px', border: 'none',
                borderLeft: i === 0 ? 'none' : '1px solid ' + CBT_C.border,
                background: actif ? CBT_C.berry : CBT_C.surface,
                color: actif ? '#fff' : CBT_C.textSec,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              },
            }, p.label);
          })
        ),
        portee === 'parcelle' && React.createElement('select', {
          value: selected,
          onChange: function (e) { setSelected(e.target.value); },
          style: {
            border: '1px solid ' + CBT_C.border, borderRadius: 8,
            padding: '7px 10px', fontSize: 12, outline: 'none',
            minWidth: 280, background: CBT_C.surface,
          },
        },
          React.createElement('option', { value: '' }, '— Choisir une parcelle —'),
          options.map(function (r) {
            return React.createElement('option', { key: r.label, value: r.label }, cbtNom(r.label));
          })
        ),
        // Cible de portée VARIÉTÉ : chaque bucket porte son nombre de
        // parcelles, pour qu'on sache combien on est en train d'engager.
        portee === 'variete' && React.createElement('select', {
          value: varieteSel,
          onChange: function (e) { setVarieteSel(e.target.value); },
          style: {
            border: '1px solid ' + CBT_C.border, borderRadius: 8,
            padding: '7px 10px', fontSize: 12, outline: 'none',
            minWidth: 280, background: CBT_C.surface,
          },
        },
          React.createElement('option', { value: '' }, '— Choisir une variété —'),
          porteeOpts.varietes.map(function (v) {
            return React.createElement('option', { key: v.key, value: v.key },
              v.label + ' (' + v.nb + (v.nb > 1 ? ' parcelles)' : ' parcelle)'));
          })
        ),
        portee === 'culture' && React.createElement('select', {
          value: cultureSel,
          onChange: function (e) { setCultureSel(e.target.value); },
          style: {
            border: '1px solid ' + CBT_C.border, borderRadius: 8,
            padding: '7px 10px', fontSize: 12, outline: 'none',
            minWidth: 280, background: CBT_C.surface,
          },
        },
          React.createElement('option', { value: '' }, '— Choisir une culture —'),
          porteeOpts.cultures.map(function (c) {
            return React.createElement('option', { key: c.key, value: c.key },
              c.label + ' (' + c.nb + (c.nb > 1 ? ' parcelles)' : ' parcelle)'));
          })
        ),
        culture && React.createElement(CBT_CultureBadge, { culture: culture }),
        !porteeMulti && selectedRow && React.createElement('span', { style: { fontSize: 12, color: CBT_C.textSec } },
          ha > 0 ? ha.toFixed(2) + ' ha' : 'Ha non saisi — voir Parcelles & Référentiel'
        ),
        // Sélecteur de QUINZAINE : la quinzaine en cours par défaut, une
        // quinzaine passée reste consultable et corrigeable. Masqué quand la
        // parcelle n'est pas budgétable (avocatier) ou qu'aucune quinzaine
        // n'est connue — proposer un champ qui ne s'enregistrerait nulle part
        // serait pire que ne rien afficher.
        selectedRow && quinzaineSaisissable && React.createElement('select', {
          value: quinzaineActive,
          onChange: function (e) { setQuinzSel(e.target.value); },
          title: 'Quinzaine dont on saisit l\'engagement',
          style: {
            border: '1px solid ' + CBT_C.border, borderRadius: 8,
            padding: '7px 10px', fontSize: 12, outline: 'none',
            background: CBT_C.surface,
          },
        }, (quinzOptions || []).map(function (o) {
          return React.createElement('option', { key: o.key, value: o.key },
            o.label + (o.key === quinzCourante ? ' (en cours)' : ''));
        })),
        React.createElement('button', {
          onClick: function () { setTick(function (t) { return t + 1; }); },
          title: 'Rafraîchir',
          style: {
            padding: '6px 10px', borderRadius: 8, border: '1px solid ' + CBT_C.border,
            background: CBT_C.surface, color: CBT_C.textSec, fontSize: 12, cursor: 'pointer',
          },
        }, React.createElement('i', { className: 'fa-solid fa-rotate' }))
      ),

      // ENTÊTE DE PORTÉE MULTIPLE : combien de parcelles, quelle surface, et ce
      // que la portée retire (l'engagement de quinzaine). Un champ qui
      // disparaît sans explication se lit comme un bug.
      porteeMulti && React.createElement('div', {
        style: {
          marginBottom: 16, padding: '10px 12px', borderRadius: 10,
          background: CBT_C.surface2, border: '1px solid ' + CBT_C.border,
          fontSize: 12, color: CBT_C.textSec, lineHeight: 1.6,
        },
      },
        React.createElement('div', null,
          React.createElement('strong', null, 'Portée : ' + (porteeCibleLabel || '—')),
          targetLabels.length === 0
            ? ' — aucune parcelle : choisir une cible ci-dessus.'
            : ' — ' + targetLabels.length
              + (targetLabels.length > 1 ? ' parcelles' : ' parcelle')
              + ' — ' + surfaceCible.ha.toFixed(2) + ' ha'
              + (surfaceCible.sansHa.length > 0
                ? ' (' + surfaceCible.sansHa.length + ' sans Ha : ' + porteeSansHaNoms
                  + ' — leur Total JH n\'est pas compté, leur budget l\'est)'
                : '')
        ),
        React.createElement('div', { style: { color: CBT_C.textTer } },
          'Engagement quinzaine : saisie par parcelle uniquement.')
      ),

      !grilleVisible && React.createElement('div', {
        style: { padding: '28px 0', textAlign: 'center', color: CBT_C.textTer, fontSize: 13 },
      }, porteeMulti
        ? (portee === 'variete'
          ? 'Choisir une variété pour saisir son budget.'
          : 'Choisir une culture pour saisir son budget.')
        : 'Sélectionner une parcelle pour saisir son budget.'),

      grilleVisible && React.createElement('div', {
        style: { background: CBT_C.surface, border: '1px solid ' + CBT_C.border, borderRadius: 12, overflow: 'hidden' },
      },
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', { style: thStyle }, 'Famille / opération'),
              React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Budget JH / Ha'),
              React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Total JH'),
              // Colonne d'ENGAGEMENT court terme. Volontairement à droite du
              // budget annuel et non entre ses deux colonnes : les deux ne se
              // comparent pas terme à terme (l'un couvre la campagne, l'autre
              // 15 jours) et rien ne doit inviter à les soustraire.
              quinzaineSaisissable && React.createElement('th', {
                style: { ...thStyle, textAlign: 'right', color: CBT_C.berry },
                title: 'Engagement de la quinzaine, indépendant du budget annuel',
              }, 'Engagé ' + (quinzaineLabel || quinzaineActive) + ' JH / Ha')
            )
          ),
          React.createElement('tbody', null,
            // Une ligne « famille » (repliable) + une ligne par opération
            // quand la famille est dépliée. Le tableau reste utilisable avec
            // ~108 opérations parce que tout est replié par défaut.
            familles.map(function (f, i) {
              var icon = CBT_FAMILLE_ICONS[f];
              var ops = opsByFamille[f] || [];
              var tot = CBT_familleTotal(f, values, opValues);
              var calcule = tot.source === 'operations';
              // Cas MIXTE : total de famille saisi ET opérations renseignées.
              // En portée multiple, seules les familles TOUCHÉES sont envoyées :
              // avertir sur une famille intacte serait une fausse alerte (rien
              // ne sera remplacé), et une fausse alerte décrédibilise les vraies.
              var ecrase = calcule && CBT_num(values[f]) > 0
                && (!porteeMulti || !!touched[f]);
              var isOpen = !!openFamilles[f];
              var famRows = [
                React.createElement('tr', {
                  key: f,
                  style: { background: i % 2 === 0 ? CBT_C.surface : CBT_C.surface2 },
                },
                  React.createElement('td', { style: { ...tdStyle, fontWeight: 700 } },
                    React.createElement('button', {
                      onClick: function () { toggleFamille(f); },
                      title: ops.length === 0 ? 'Aucune opération au référentiel'
                        : (isOpen ? 'Replier' : 'Déplier ' + ops.length + ' opérations'),
                      disabled: ops.length === 0,
                      style: {
                        border: 'none', background: 'transparent', cursor: ops.length === 0 ? 'default' : 'pointer',
                        color: CBT_C.textSec, fontSize: 11, width: 20, padding: 0,
                        marginRight: 4, opacity: ops.length === 0 ? 0.25 : 1,
                      },
                    }, React.createElement('i', {
                      className: 'fa-solid ' + (isOpen ? 'fa-chevron-down' : 'fa-chevron-right'),
                    })),
                    icon && React.createElement('i', {
                      className: 'fa-solid ' + icon,
                      style: { color: CBT_C.berry, fontSize: 12, width: 18 },
                    }),
                    f,
                    ops.length > 0 && React.createElement('span', {
                      style: { marginLeft: 8, fontSize: 11, fontWeight: 500, color: CBT_C.textTer },
                    }, ops.length + ' op.'),
                    // CAS MIXTE : la famille avait un total saisi ET porte
                    // maintenant des opérations. Le total bascule sur les
                    // opérations et la valeur de famille sera remplacée à
                    // l'enregistrement. Badge TEXTE (pas un `title=` : illisible
                    // au doigt, or la validation se fait au téléphone), portant
                    // la valeur menacée — sans quoi elle a déjà disparu de
                    // l'écran (la cellule affiche la somme des opérations).
                    ecrase && React.createElement('span', { style: badgeAmbre },
                      React.createElement('i', {
                        className: 'fa-solid fa-triangle-exclamation',
                        style: { marginRight: 5 },
                      }),
                      'famille ' + CBT_num(values[f]) + ' → remplacée par les opérations'
                    ),
                    // DIVERGENCE entre les parcelles cibles (portée multiple) :
                    // le champ est vide, mais pas parce que rien n'est budgété.
                    // Annoncée EN TEXTE, jamais dans un seul `title=` : la
                    // validation se fait au téléphone, un survol n'existe pas.
                    divergentes[f] && React.createElement('span', { style: badgeAmbre },
                      React.createElement('i', {
                        className: 'fa-solid fa-triangle-exclamation',
                        style: { marginRight: 5 },
                      }),
                      libelleDivergence(divergentes[f], !!touched[f])
                    )
                  ),
                  React.createElement('td', { style: { ...tdStyle, textAlign: 'right' } },
                    // Dès qu'une opération est budgétée, le total de famille
                    // est CALCULÉ : le champ devient non éditable, sinon la
                    // saisie laisserait croire à une addition des deux niveaux.
                    (canEdit && !calcule)
                      ? React.createElement('input', {
                        type: 'number', min: 0, step: 0.1,
                        value: values[f] == null ? '' : values[f],
                        placeholder: '0',
                        title: 'Budget de la famille, à défaut de détail par opération',
                        onChange: function (e) {
                          var v = e.target.value;
                          marquerTouchee(f);
                          setValues(function (prev) {
                            var next = Object.assign({}, prev);
                            next[f] = v;
                            return next;
                          });
                        },
                        style: inputStyle,
                      })
                      : React.createElement('span', {
                        style: { fontFamily: 'monospace', fontWeight: 700 },
                        title: calcule ? 'Somme des opérations de la famille' : undefined,
                      },
                        tot.total > 0 ? tot.total.toFixed(2) : '—')
                  ),
                  React.createElement('td', {
                    style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: CBT_C.textSec },
                  }, CBT_totalJH(tot.total, ha) > 0 ? CBT_totalJH(tot.total, ha).toFixed(2) : '—'),
                  // Engagement de la quinzaine : saisi au niveau FAMILLE
                  // uniquement — c'est la maille de l'engagement, le détail par
                  // opération reste annuel.
                  quinzaineSaisissable && React.createElement('td', {
                    style: { ...tdStyle, textAlign: 'right' },
                  },
                    canEdit
                      ? React.createElement('input', {
                        type: 'number', min: 0, step: 0.1,
                        value: quinzValues[f] == null ? '' : quinzValues[f],
                        placeholder: '0',
                        title: 'JH/Ha engagés sur ' + (quinzaineLabel || quinzaineActive),
                        onChange: function (e) {
                          var v = e.target.value;
                          setQuinzValues(function (prev) {
                            var next = Object.assign({}, prev);
                            next[f] = v;
                            return next;
                          });
                        },
                        style: inputStyle,
                      })
                      : React.createElement('span', { style: { fontFamily: 'monospace' } },
                        quinzValues[f] ? quinzValues[f] : '—')
                  )
                ),
              ];
              if (isOpen) {
                ops.forEach(function (op) {
                  var vOp = (opValues[f] || {})[op];
                  var opInfo = CBT_splitOpKey(op);
                  famRows.push(React.createElement('tr', {
                    key: f + '||' + op,
                    style: { background: CBT_C.surface },
                  },
                    React.createElement('td', { style: { ...tdStyle, paddingLeft: 46, color: CBT_C.textSec } },
                      opInfo.operation,
                      // CODE GB affiché : c'est LUI la clé du budget, et le même
                      // libellé peut exister sous deux codes (« Nettoyage » =
                      // GB05 Entretien structure ET GB11 Service générale). Sans
                      // le code, deux lignes légitimes seraient indiscernables.
                      opInfo.code && React.createElement('span', {
                        style: {
                          marginLeft: 8, padding: '1px 6px', borderRadius: 6,
                          fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                          background: CBT_C.surface2, color: CBT_C.textTer,
                        },
                        title: 'Code référentiel BEE ONE — clé de rapprochement avec le réalisé',
                      }, opInfo.code),
                      // Divergence au niveau OPÉRATION — indépendante de celle
                      // de la famille (une famille en accord peut porter une
                      // opération divergente).
                      (divergentesOps[f] || {})[op] && React.createElement('span', {
                        style: badgeAmbre,
                      },
                        React.createElement('i', {
                          className: 'fa-solid fa-triangle-exclamation',
                          style: { marginRight: 5 },
                        }),
                        libelleDivergence(divergentesOps[f][op], !!touched[f])
                      )
                    ),
                    React.createElement('td', { style: { ...tdStyle, textAlign: 'right' } },
                      canEdit
                        ? React.createElement('input', {
                          type: 'number', min: 0, step: 0.1,
                          value: vOp == null ? '' : vOp,
                          placeholder: '0',
                          onChange: function (e) { setOpValue(f, op, e.target.value); },
                          style: inputStyle,
                        })
                        : React.createElement('span', { style: { fontFamily: 'monospace' } },
                          vOp ? vOp : '—')
                    ),
                    React.createElement('td', {
                      style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: CBT_C.textTer },
                    }, CBT_totalJH(vOp, ha) > 0 ? CBT_totalJH(vOp, ha).toFixed(2) : '—'),
                    // Pas d'engagement au niveau opération : cellule vide, et
                    // non un champ qui ne s'enregistrerait nulle part.
                    quinzaineSaisissable && React.createElement('td', {
                      style: { ...tdStyle, textAlign: 'right', color: CBT_C.textTer },
                    }, '')
                  ));
                });
              }
              return famRows;
            })
          ),
          React.createElement('tfoot', null,
            React.createElement('tr', null,
              React.createElement('td', { style: { ...tdStyle, fontWeight: 700 } }, 'Total'),
              React.createElement('td', {
                style: { ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' },
              }, totalJhHa > 0 ? totalJhHa.toFixed(2) : '—'),
              React.createElement('td', {
                style: { ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' },
              }, totalJH > 0 ? totalJH.toFixed(2) : '—'),
              // Total ENGAGÉ sur la quinzaine. Aucune comparaison n'est
              // affichée avec le total annuel : leur écart est légitime (un
              // engagement de 15 jours n'est pas une tranche du budget annuel),
              // le signaler comme une anomalie serait faux.
              quinzaineSaisissable && React.createElement('td', {
                style: { ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: CBT_C.berry },
              }, totalQuinzJhHa > 0 ? totalQuinzJhHa.toFixed(2) : '—')
            )
          )
        ),

        // CONFIRMATION : le save étant global à la parcelle, une famille
        // repliée peut voir sa valeur de famille remplacée sans que rien ne
        // l'ait signalé à l'écran. On liste explicitement les familles
        // concernées AVANT d'écrire, avec la valeur perdue et son
        // remplacement.
        // ⚠️ `confirmFanout` DOIT figurer dans cette condition : en portée
        // multiple la confirmation est toujours requise, même sans
        // neutralisation ni écrasement. Sans lui, le panneau ne s'afficherait
        // pas et le bouton « Enregistrer » paraîtrait mort.
        canEdit && ((confirmList && confirmList.length > 0)
          || (confirmQuinz && confirmQuinz.length > 0)
          || confirmFanout) && React.createElement('div', {
          style: {
            padding: '12px 14px', borderTop: '1px solid ' + CBT_C.border,
            background: '#fffbeb', color: CBT_C.amber, fontSize: 12,
          },
        },
          // PÉRIMÈTRE DU FAN-OUT, listé PAR NOM et jamais réduit à un
          // compteur. Deux raisons : écrire N parcelles d'un geste mérite
          // qu'on les regarde une par une ; et le repli de résolution de
          // culture retombe par défaut sur « Framboise » (normCulture), donc
          // une parcelle mal classée peut se retrouver dans une cible — seule
          // la liste nominative permet de le voir avant d'écrire.
          confirmFanout && React.createElement('div', { style: { fontWeight: 700, marginBottom: 6 } },
            React.createElement('i', {
              className: 'fa-solid fa-triangle-exclamation', style: { marginRight: 8 },
            }),
            'Enregistrer la même grille sur ' + confirmFanout.labels.length
              + (confirmFanout.labels.length > 1 ? ' parcelles' : ' parcelle')
              + (confirmFanout.ecrasements.length > 0
                ? ' — ' + confirmFanout.ecrasements.length
                  + (confirmFanout.ecrasements.length > 1
                    ? ' ont des valeurs qui seront remplacées :'
                    : ' a des valeurs qui seront remplacées :')
                : ' (aucune valeur existante remplacée) :')
          ),
          confirmFanout && React.createElement('ul', { style: { margin: '0 0 10px', paddingLeft: 26 } },
            confirmFanout.labels.map(function (lbl) {
              var hit = null;
              confirmFanout.ecrasements.forEach(function (e) { if (e.label === lbl) hit = e; });
              return React.createElement('li', { key: 'fo-' + lbl, style: { marginBottom: 2 } },
                cbtNom(lbl),
                hit && React.createElement('span', { style: { fontWeight: 700 } },
                  ' — ' + hit.nb + (hit.nb > 1 ? ' valeurs remplacées' : ' valeur remplacée')
                    + ' : ' + hit.exemples.map(function (x) {
                      return x.champ + ' ' + x.avant + ' → '
                        + (x.apres > 0 ? String(x.apres) : '0 (supprimé)');
                    }).join(', ')
                    + (hit.nb > hit.exemples.length ? '…' : '')
                )
              );
            })
          ),
          confirmList && confirmList.length > 0 && React.createElement('div', { style: { fontWeight: 700, marginBottom: 6 } },
            React.createElement('i', {
              className: 'fa-solid fa-triangle-exclamation', style: { marginRight: 8 },
            }),
            confirmList.length > 1
              ? confirmList.length + ' valeurs de famille vont être remplacées par le détail'
                + ' de leurs opérations :'
              : 'Une valeur de famille va être remplacée par le détail de ses opérations :'
          ),
          confirmList && confirmList.length > 0 && React.createElement('ul', { style: { margin: '0 0 10px', paddingLeft: 26 } },
            confirmList.map(function (n) {
              return React.createElement('li', { key: n.famille, style: { marginBottom: 2 } },
                n.famille + ' : ' + n.valeur + ' JH/Ha → ' + n.total + ' JH/Ha');
            })
          ),
          // Engagements de quinzaine effacés : même traitement que les
          // neutralisations — annoncés AVANT l'écriture, avec la valeur perdue.
          confirmQuinz && confirmQuinz.length > 0 && React.createElement('div', { style: { fontWeight: 700, marginBottom: 6 } },
            React.createElement('i', {
              className: 'fa-solid fa-triangle-exclamation', style: { marginRight: 8 },
            }),
            (confirmQuinz.length > 1
              ? confirmQuinz.length + ' engagements de ' : 'Un engagement de ')
              + (quinzaineLabel || quinzaineActive) + ' vont être supprimés :'
          ),
          confirmQuinz && confirmQuinz.length > 0 && React.createElement('ul', { style: { margin: '0 0 10px', paddingLeft: 26 } },
            confirmQuinz.map(function (n) {
              return React.createElement('li', { key: 'q-' + n.famille, style: { marginBottom: 2 } },
                n.famille + ' : ' + n.valeur + ' JH/Ha → supprimé');
            })
          ),
          React.createElement('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
            React.createElement('button', {
              onClick: function () { handleSave(true); },
              disabled: saving,
              style: {
                padding: '6px 16px', borderRadius: 8, border: 'none',
                background: CBT_C.amber, color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
              },
            }, 'Confirmer et enregistrer'),
            React.createElement('button', {
              onClick: function () {
                setConfirmList(null); setConfirmQuinz(null); setConfirmFanout(null);
              },
              style: {
                padding: '6px 16px', borderRadius: 8,
                border: '1px solid ' + CBT_C.border, background: CBT_C.surface,
                color: CBT_C.textSec, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              },
            }, 'Annuler')
          )
        ),

        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
            borderTop: '1px solid ' + CBT_C.border, flexWrap: 'wrap',
          },
        },
          // En portée multiple, ce bouton n'écrit RIEN directement : il ouvre la
          // confirmation, toujours (cf. handleSaveFanout).
          canEdit && React.createElement('button', {
            onClick: function () { handleSave(false); },
            disabled: saving,
            style: {
              padding: '7px 18px', borderRadius: 8, border: 'none',
              background: CBT_C.green, color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            },
          }, saving ? 'Enregistrement…' : 'Enregistrer'),
          // REPORT EN UN CLIC : sans lui, 12 valeurs se re-saisissent tous les
          // quinze jours et l'écran n'est pas utilisé. Il ne fait que REMPLIR
          // les champs — rien n'est écrit avant « Enregistrer ».
          canEdit && quinzaineSaisissable && quinzPrecedente && React.createElement('button', {
            onClick: reporterQuinzainePrecedente,
            title: 'Recopier les engagements de ' + (quinzPrecedenteLabel || quinzPrecedente)
              + ' dans les champs de ' + (quinzaineLabel || quinzaineActive)
              + ' (rien n\'est enregistré avant de cliquer sur Enregistrer)',
            style: {
              padding: '7px 14px', borderRadius: 8, border: '1px solid ' + CBT_C.border,
              background: CBT_C.surface, color: CBT_C.textSec, fontSize: 12,
              fontWeight: 700, cursor: 'pointer',
            },
          },
            React.createElement('i', { className: 'fa-solid fa-copy', style: { marginRight: 6 } }),
            'Reporter ' + (quinzPrecedenteLabel || quinzPrecedente)
          ),
          // Succès, succès-avec-purge, erreur : même niveau visuel (une ligne
          // à côté du bouton). La purge est un succès, mais elle SUPPRIME des
          // données : ambre + icône d'avertissement pour qu'elle se remarque.
          msg && React.createElement('span', {
            style: {
              fontSize: 12, fontWeight: 600,
              color: msg.type !== 'ok' ? '#dc2626' : (msg.purge ? CBT_C.amber : CBT_C.green),
            },
          },
            React.createElement('i', {
              className: 'fa-solid ' + (msg.type !== 'ok'
                ? 'fa-circle-exclamation'
                : (msg.purge ? 'fa-triangle-exclamation' : 'fa-circle-check')),
              style: { marginRight: 6 },
            }),
            msg.text
          ),
          React.createElement('span', { style: { fontSize: 11, color: CBT_C.textTer } },
            !canEdit
              ? 'Saisie réservée aux profils DG/RH.'
              : (porteeMulti
                ? 'Grille commune aux parcelles de la portée : ce qui concorde est'
                  + ' pré-rempli, ce qui diverge reste vide et est signalé.'
                  + ' Seules les lignes que vous modifiez sont propagées ; les autres'
                  + ' restent inchangées sur chaque parcelle.'
                : 'Déplier une famille pour saisir ses opérations. Le total de famille'
                  + ' devient calculé dès qu\'une opération est budgétée ; sinon il reste'
                  + ' saisissable. Un champ vide (ou 0) supprime la ligne.')
          )
        ),

        // RAPPORT PAR PARCELLE — affiché UNIQUEMENT s'il y a au moins un échec.
        // Un fan-out entièrement réussi n'a pas besoin de 23 lignes de coches ;
        // un fan-out partiel, si : il faut pouvoir nommer ce qui n'est pas passé.
        fanoutResults && React.createElement('div', {
          style: {
            padding: '10px 14px', borderTop: '1px solid ' + CBT_C.border,
            background: CBT_C.surface2, fontSize: 12,
          },
        },
          React.createElement('div', {
            style: { fontWeight: 700, marginBottom: 6, color: CBT_C.textSec },
          }, 'Résultat par parcelle'),
          React.createElement('ul', { style: { margin: 0, paddingLeft: 20 } },
            fanoutResults.map(function (r, i) {
              var lbl = String((r && r.label_bee_one) || '?');
              return React.createElement('li', {
                key: 'res-' + lbl + '-' + i,
                style: { marginBottom: 2, color: r && r.ok ? CBT_C.green : '#dc2626' },
              },
                (r && r.ok ? '✓ ' : '✗ ') + cbtNom(lbl)
                  + (r && r.ok ? '' : ' — ' + String((r && r.error) || 'échec'))
              );
            })
          )
        )
      )
    )
  );
}

// Helpers purs exposés pour les tests unitaires — accrochés au composant déjà
// exposé, pas de nouvel export.
CampagneBudgetTab.famillesFromOps = CBT_famillesFromOps;
CampagneBudgetTab.opsByFamille = CBT_opsByFamille;
CampagneBudgetTab.opKey = CBT_opKey;
CampagneBudgetTab.splitOpKey = CBT_splitOpKey;
CampagneBudgetTab.familleDuCode = CBT_familleDuCode;
CampagneBudgetTab.operationLabel = CBT_operationLabel;
CampagneBudgetTab.saveMessage = CBT_saveMessage;
CampagneBudgetTab.budgetsByLabel = CBT_budgetsByLabel;
CampagneBudgetTab.operationsByLabel = CBT_operationsByLabel;
CampagneBudgetTab.buildSavePayload = CBT_buildSavePayload;
CampagneBudgetTab.buildFanoutPayload = CBT_buildFanoutPayload;
CampagneBudgetTab.familleTotal = CBT_familleTotal;
CampagneBudgetTab.famillesNeutralisees = CBT_famillesNeutralisees;
CampagneBudgetTab.memeNeutralisations = CBT_memeNeutralisations;
CampagneBudgetTab.fanoutEcrasements = CBT_fanoutEcrasements;
CampagneBudgetTab.memeFanout = CBT_memeFanout;
CampagneBudgetTab.signatureFanout = CBT_signatureFanout;
CampagneBudgetTab.fanoutMessage = CBT_fanoutMessage;
CampagneBudgetTab.totalJH = CBT_totalJH;
CampagneBudgetTab.quinzaineApplicable = CBT_quinzaineApplicable;
CampagneBudgetTab.quinzainesSupprimees = CBT_quinzainesSupprimees;
CampagneBudgetTab.CULTURES_QUINZAINE = CBT_CULTURES_QUINZAINE;
CampagneBudgetTab.cultureRow = CBT_cultureRow;
CampagneBudgetTab.parcelleAffichable = CBT_parcelleAffichable;
CampagneBudgetTab.CULTURES_MASQUEES = CBT_CULTURES_MASQUEES;
CampagneBudgetTab.varieteKey = CBT_varieteKey;
CampagneBudgetTab.porteeOptions = CBT_porteeOptions;
CampagneBudgetTab.targetLabels = CBT_targetLabels;
CampagneBudgetTab.valeursCommunes = CBT_valeursCommunes;
CampagneBudgetTab.surfaceCible = CBT_surfaceCible;

export { CampagneBudgetTab };
