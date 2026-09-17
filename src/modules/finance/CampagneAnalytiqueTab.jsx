/*
 * CampagneAnalytiqueTab.jsx — Campagne analytique (MO + Engrais + Pesticides)
 *
 * 3 sub-tabs : Main Oeuvre | Engrais | Pesticides
 * 4 culture filters : Toutes | Framboise | Myrtille | Avocatier
 *
 * Sources :
 *   GET /api/pointage-rh?action=campagne-analytique-detail  (MO)
 *   GET /api/pointage-rh?action=campagne-conso-parcelle     (Engrais/Pesticides)
 *   POST /api/stock?action=classer-article                  (bandeau « à classer »)
 */

import * as CampagneBudgetQuinzaine from '../shared/lib/campagneBudgetQuinzaine.js';
import * as CampagneParcelleQuinzaine from '../shared/lib/campagneParcelleQuinzaine.js';
import * as CampagneProduction from '../shared/lib/campagneProduction.js';
import * as CampagneRapprochement from '../shared/lib/campagneRapprochement.js';
import * as CampagneRythme from '../shared/lib/campagneRythme.js';
import * as CampagneUtils from '../shared/lib/campagneUtils.js';
import * as CultureUtils from '../shared/lib/cultureUtils.js';
import { CampagneBudgetTab } from './CampagneBudgetTab.jsx';
import { PivotAnalytiqueGrid } from './PivotAnalytiqueGrid.jsx';
import { loadBonsFromFirestore } from '../shared/loadBonsFromFirestore.jsx';
import { sbParcelle } from '../shared/sbParcelleState.js';
import { C, FAMILLE_ICONS, CAT_CULTURE_INCONNUE, fmtDH, fmtJH, fmtHa, fmtHaLabel, fmtDHPerHa, fmtQty, cultureOf, matchCulture, sbNom, sbHa, CAT_budgetsByLabel, CAT_opBudgetsByLabel, buildVarieteView, CAT_pivotRows, CAT_byCulture } from './campagneAnalytiqueHelpers.jsx';
import { buildCultureWorkbook, exportCulture } from './campagneAnalytiqueExport.jsx';
import { VarieteView } from './CampagneVarieteView.jsx';
import { CAT_pctPartsAnnuel, PivotView } from './CampagnePivotView.jsx';
import { CAT_SANS_FICHE, CAT_peutClasser, CAT_classerArticle, ConsoView } from './CampagneConsoView.jsx';

var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;

/* ------------------------------------------------------------------ */
/* Composant principal                                                  */
/* ------------------------------------------------------------------ */
function CampagneAnalytiqueTab(props) {
  var farmFilter = props.farmFilter || null;

  var _subTab = useState('mo');
  var subTab = _subTab[0]; var setSubTab = _subTab[1];

  var _view = useState('ha');
  var view = _view[0]; var setView = _view[1];

  var _cultureFilter = useState('Toutes');
  var cultureFilter = _cultureFilter[0]; var setCultureFilter = _cultureFilter[1];

  var _data = useState(null);
  var data = _data[0]; var setData = _data[1];

  var _loading = useState(true);
  var loading = _loading[0]; var setLoading = _loading[1];

  var _err = useState(null);
  var err = _err[0]; var setErr = _err[1];

  var _selectedParcelle = useState('');
  var selectedParcelle = _selectedParcelle[0]; var setSelectedParcelle = _selectedParcelle[1];

  // Métrique partagée entre les 2 vues MO
  var _metric = useState('cout');
  var metric = _metric[0]; var setMetric = _metric[1];

  // Données conso (lazy — chargées à la première activation engrais/pesticides)
  var _consoData = useState(null);
  var consoData = _consoData[0]; var setConsoData = _consoData[1];

  var _consoLoading = useState(false);
  var consoLoading = _consoLoading[0]; var setConsoLoading = _consoLoading[1];

  var _consoErr = useState(null);
  var consoErr = _consoErr[0]; var setConsoErr = _consoErr[1];

  // Suivi du premier chargement conso
  var _consoFetched = useState(false);
  var consoFetched = _consoFetched[0]; var setConsoFetched = _consoFetched[1];

  // Référentiel parcelles Smart Berry (culture_sb, nom_sb, ha) — en state :
  // sbParcelle.REF est peuplé de façon asynchrone par sbLoad sans
  // re-render, il ne sert donc que de valeur initiale.
  var _sbMap = useState(sbParcelle.REF || {});
  var sbMap = _sbMap[0]; var setSbMap = _sbMap[1];

  // Budgets JH/Ha de la campagne courante : { LABEL_BEE_ONE_MAJ: { famille:
  // jhParHa } }. Alimente les colonnes de suivi budgétaire de l'export Excel
  // ET les séries Budget/Écart de la grille (PivotView).
  // Un échec de chargement n'est PAS bloquant : l'export part sans budget
  // (colonnes vides) et la grille n'affiche que le réalisé, exactement comme
  // avant toute saisie.
  var _budgets = useState({});
  var budgetsByLabel = _budgets[0]; var setBudgetsByLabel = _budgets[1];

  // Même source, même fetch : le détail par opération du MÊME appel
  // `campagne-budget-list` (jamais un second aller-retour). Il sert la maille
  // fine de la grille en mode Détail, et la règle « les opérations écrasent la
  // famille » a besoin des deux niveaux.
  var _opBudgets = useState({});
  var opBudgetsByLabel = _opBudgets[0]; var setOpBudgetsByLabel = _opBudgets[1];

  // Budgets DE QUINZAINE (LOT 3b), même source et même fetch : { LABEL_MAJ:
  // { Q07: { famille: jhParHa } } }. Absent des documents antérieurs → map
  // vide, aucune migration. Alimente la vue Quinzaine de la grille.
  var _quinzBudgets = useState({});
  var quinzainesByLabel = _quinzBudgets[0]; var setQuinzainesByLabel = _quinzBudgets[1];

  // Opérations du référentiel des tâches — utilisées UNIQUEMENT pour leur
  // `classe_rythme` (continu / saisonnier / recolte), qui décide si une
  // opération se projette. Liste vide ou champ absent = aucune classe connue
  // → la grille affiche « — » sur le reste au rythme, jamais une projection
  // devinée.
  var _refOps = useState([]);
  var refOperations = _refOps[0]; var setRefOperations = _refOps[1];

  // BONS D'APPORT (kilos) — chargés ICI, une seule fois, et descendus en prop
  // à la grille (ligne « Kg / JH ») comme au bloc production. Même source que
  // l'onglet Production (`loadBonsFromFirestore`, cache mémoire partagé) :
  // deux écrans, une lecture, donc jamais deux totaux différents pour la même
  // journée. `null` = pas encore chargé, à distinguer de `[]` (aucun bon).
  var _bons = useState(null);
  var bons = _bons[0]; var setBons = _bons[1];

  useEffect(function () {
    // Garde anti-crash : une référence à un global absent fait planter TOUT
    // le rendu React (mémoire projet « tab bare global ref »).
    if (typeof loadBonsFromFirestore !== 'function') return undefined;
    var cancelled = false;
    loadBonsFromFirestore()
      .then(function (b) { if (!cancelled) setBons(b || []); })
      .catch(function () { if (!cancelled) setBons([]); });
    return function () { cancelled = true; };
  }, []);

  // COÛT OUVRIER CHARGÉ (DH par journée pointée, moyenné sur la campagne) —
  // brut + CNSS patronale des déclarés + prime de transport. C'est ce qui
  // permet de valoriser en dirhams un budget saisi en JH/Ha.
  // `null` = indisponible (action en erreur, ou aucune journée pointée) : le
  // budget en DH n'est alors PAS affiché, jamais un budget nul.
  var _coutOuvrier = useState(null);
  var coutOuvrier = _coutOuvrier[0]; var setCoutOuvrier = _coutOuvrier[1];

  useEffect(function () {
    var cancelled = false;
    fetch('/api/pointage-rh?action=campagne-cout-ouvrier')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (cancelled || !d || !d.success) return;
        setCoutOuvrier(d);
      })
      .catch(function () { /* indisponible → pas de budget en DH, cf. plus bas */ });
    return function () { cancelled = true; };
  }, []);

  // INSTANTANÉS DE L'ÉCRAN QUINZAINE — la référence du rapprochement.
  //
  // Ce panneau ne RECALCULE plus le coût de la quinzaine : trois tentatives de
  // le reproduire ont produit trois divergences. L'écran Quinzaine enregistre
  // son propre total, on le relit ici tel quel. L'écart affiché redevient donc
  // un écart RÉEL entre deux mesures, et non entre deux implémentations.
  //
  // Absent = personne n'a ouvert la Quinzaine depuis la mise en service. Le
  // panneau le DIT au lieu de retomber sur un calcul local : un chiffre de
  // repli s'y lirait comme la référence, et on aurait reconstruit exactement
  // le problème qu'on vient de supprimer.
  var _snapQuinz = useState(null);
  var snapQuinz = _snapQuinz[0]; var setSnapQuinz = _snapQuinz[1];

  useEffect(function () {
    var cancelled = false;
    // `/api/pointage-rh` : seule route mappée vers `pointageV3`. `/api/pointage`
    // n'existe pas et rend index.html — un 200 qui n'est pas du JSON.
    fetch('/api/pointage-rh?action=cout-quinzaine')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (cancelled || !d || !d.success) return;
        setSnapQuinz(d.parPeriode || {});
      })
      .catch(function () { /* indisponible → le panneau affiche « — » */ });
    return function () { cancelled = true; };
  }, []);

  // Rechargé à CHAQUE retour sur le sous-onglet « Main Oeuvre » (d'où part
  // l'export), et pas seulement au montage : sinon un budget saisi dans le
  // sous-onglet Budget puis exporté sans recharger la page produirait un
  // fichier périmé, silencieusement.
  useEffect(function () {
    if (subTab !== 'mo') return;
    var cancelled = false;
    fetch('/api/pointage-rh?action=campagne-budget-list')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (cancelled || !d || !d.success) return;
        setBudgetsByLabel(CAT_budgetsByLabel(d.budgets || []));
        setOpBudgetsByLabel(CAT_opBudgetsByLabel(d.budgets || []));
        var _cbq = CampagneBudgetQuinzaine;
        setQuinzainesByLabel(_cbq ? _cbq.quinzainesByLabel(d.budgets || []) : {});
      })
      .catch(function () {});
    return function () { cancelled = true; };
  }, [subTab]);

  // Chargé une seule fois : le référentiel des tâches ne bouge pas pendant
  // une session (contrairement aux budgets, saisissables dans l'onglet voisin).
  useEffect(function () {
    fetch('/api/pointage-rh?action=referentiel-taches-list')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) return;
        setRefOperations(d.operations || []);
      })
      .catch(function () {});
  }, []);

  useEffect(function () {
    fetch('/api/pointage-rh?action=sb-referentiel-list')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success) return;
        var map = {};
        (d.parcelles || []).forEach(function (p) {
          map[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
        });
        sbParcelle.REF = map;
        setSbMap(map);
      })
      .catch(function () {});
  }, []);

  useEffect(function () {
    setLoading(true);
    setErr(null);
    fetch('/api/pointage-rh?action=campagne-analytique-detail')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) {
          setData(d);
        } else {
          setErr((d && d.error) || 'Erreur lors du chargement.');
        }
      })
      .catch(function (e) { setErr(e.message || 'Erreur réseau.'); })
      .finally(function () { setLoading(false); });
  }, []);

  /**
   * Charge (ou recharge) la consommation par parcelle.
   * Extrait de l'effet ci-dessous pour être RAPPELABLE après un classement
   * d'article : la catégorie engrais/pesticide est résolue côté serveur à la
   * lecture, donc une fiche reclassée change cette réponse. Le backend purge
   * son cache 30 min avant de répondre au classement — ce rechargement repart
   * donc bien d'un recalcul, pas de l'entrée périmée.
   */
  var loadConso = function () {
    setConsoLoading(true);
    setConsoErr(null);
    return fetch('/api/pointage-rh?action=campagne-conso-parcelle')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) {
          setConsoData(d);
        } else {
          setConsoErr((d && d.error) || 'Erreur lors du chargement de la consommation.');
        }
      })
      .catch(function (e) { setConsoErr(e.message || 'Erreur réseau.'); })
      .finally(function () { setConsoLoading(false); });
  };

  // Chargement conso (paresseux — uniquement à la première transition vers engrais/pesticides)
  useEffect(function () {
    // 'budget' n'utilise PAS campagne-conso-parcelle (saisie, pas conso) :
    // l'exclure évite un fetch inutile à l'ouverture de l'onglet.
    if (subTab === 'mo' || subTab === 'budget' || consoFetched) return;
    setConsoFetched(true);
    loadConso();
  }, [subTab]);

  // Styles communs
  var containerStyle = {
    padding: '16px',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
  };

  var toggleBtnStyle = function (active) {
    return {
      padding: '8px 20px',
      border: '1.5px solid ' + (active ? C.berry : C.border),
      borderRadius: '20px',
      background: active ? C.berry : C.surface,
      color: active ? '#fff' : C.text,
      fontSize: '13px',
      fontWeight: active ? 700 : 400,
      cursor: 'pointer',
      transition: 'all .15s',
    };
  };

  if (loading) {
    return React.createElement('div', {
      style: Object.assign({}, containerStyle, { display: 'flex', alignItems: 'center', gap: '10px', color: C.textSec })
    },
      React.createElement('i', { className: 'fa-solid fa-spinner fa-spin' }),
      'Chargement de la campagne analytique…'
    );
  }

  if (err) {
    return React.createElement('div', {
      style: Object.assign({}, containerStyle, { color: '#c0392b', padding: '24px' })
    },
      React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { marginRight: '8px' } }),
      err
    );
  }

  if (!data) {
    return React.createElement('div', { style: containerStyle }, 'Aucune donnée disponible.');
  }

  // Sous-tabs definition
  // 'budget' n'est proposé que si le composant est réellement chargé : une
  // référence nue à un global absent crashe GLOBALEMENT (piège projet
  // « tab bare global ref »), on garde donc l'onglet ET son rendu.
  var subTabs = [
    { id: 'mo',         label: 'Main Oeuvre',  icon: 'fa-person-digging' },
    { id: 'engrais',    label: 'Engrais',       icon: 'fa-flask' },
    { id: 'pesticides', label: 'Pesticides',    icon: 'fa-spray-can' },
  ];
  if (CampagneBudgetTab) {
    subTabs.push({ id: 'budget', label: 'Budget', icon: 'fa-bullseye' });
  }

  var cultures = ['Toutes', 'Framboise', 'Myrtille', 'Avocatier'];

  return React.createElement('div', { style: containerStyle },
    // En-tête : info campagne
    React.createElement('div', { style: { marginBottom: '12px' } },
      React.createElement('p', {
        style: { margin: 0, fontSize: '13px', color: C.textSec }
      }, 'Campagne ' + data.campagne + ' — ' + (data.rows || []).length + ' lignes MO')
    ),

    // Ligne 1 : Sub-tabs (MO | Engrais | Pesticides) + toggle vue (si MO)
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '12px' }
    },
      // Sub-tab buttons
      React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        subTabs.map(function (st) {
          return React.createElement('button', {
            key: st.id,
            onClick: function () { setSubTab(st.id); },
            style: toggleBtnStyle(subTab === st.id),
          },
            React.createElement('i', { className: 'fa-solid ' + st.icon, style: { marginRight: '6px' } }),
            st.label
          );
        })
      ),
      // Vue toggle (uniquement en MO)
      subTab === 'mo'
        ? React.createElement('div', { style: { display: 'flex', gap: '8px' } },
            React.createElement('button', {
              onClick: function () { setView('ha'); },
              style: toggleBtnStyle(view === 'ha'),
            },
              React.createElement('i', { className: 'fa-solid fa-table-cells-large', style: { marginRight: '6px' } }),
              'Affectation par Ha'
            ),
            React.createElement('button', {
              onClick: function () { setView('variete'); },
              style: toggleBtnStyle(view === 'variete'),
            },
              React.createElement('i', { className: 'fa-solid fa-table', style: { marginRight: '6px' } }),
              'Par Variété / Quinzaine'
            )
          )
        : null
    ),

    // Ligne 2 : Filtre culture (masqué sur 'budget' : la saisie porte sur UNE
    // parcelle choisie explicitement, un filtre culture sans effet mentirait).
    subTab !== 'budget' && React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }
    },
      React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Culture :'),
      cultures.map(function (c) {
        return React.createElement('button', {
          key: c,
          onClick: function () { setCultureFilter(c); },
          style: {
            padding: '5px 14px',
            border: '1.5px solid ' + (cultureFilter === c ? C.berry : C.border),
            borderRadius: '16px',
            background: cultureFilter === c ? C.berry : C.surface,
            color: cultureFilter === c ? '#fff' : C.text,
            fontSize: '12px',
            fontWeight: cultureFilter === c ? 700 : 400,
            cursor: 'pointer',
          }
        }, c);
      })
    ),

    // Contenu
    subTab === 'budget'
      ? (CampagneBudgetTab
          ? React.createElement(CampagneBudgetTab, { userRole: props.userRole })
          : null)
    : subTab === 'mo'
      // Vue « Affectation par Ha » = la grille partagée (PivotView). L'ancienne
      // vue tabulaire parcelle × famille a été RETIRÉE : deux présentations du
      // même chiffre entretiennent une redondance que personne ne saura
      // départager plus tard (décision Omar, LOT 2b).
      ? (view === 'ha'
          ? React.createElement(PivotView, {
              data: data,
              farmFilter: farmFilter,
              cultureFilter: cultureFilter,
              sbMap: sbMap,
              budgetsByLabel: budgetsByLabel,
              opBudgetsByLabel: opBudgetsByLabel,
              quinzainesByLabel: quinzainesByLabel,
              refOperations: refOperations,
              bons: bons,
              coutOuvrier: coutOuvrier,
              snapQuinz: snapQuinz,
              metric: metric,
              setMetric: setMetric,
            })
          : React.createElement(VarieteView, {
              data: data,
              farmFilter: farmFilter,
              cultureFilter: cultureFilter,
              sbMap: sbMap,
              budgetsByLabel: budgetsByLabel,
              opBudgetsByLabel: opBudgetsByLabel,
              selectedParcelle: selectedParcelle,
              setSelectedParcelle: setSelectedParcelle,
              metric: metric,
              setMetric: setMetric,
            })
        )
      : (consoLoading
          ? React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: '10px', color: C.textSec, padding: '24px' }
            },
              React.createElement('i', { className: 'fa-solid fa-spinner fa-spin' }),
              'Chargement de la consommation…'
            )
          : consoErr
            ? React.createElement('div', {
                style: { color: '#c0392b', padding: '24px' }
              },
                React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { marginRight: '8px' } }),
                consoErr
              )
            : React.createElement(ConsoView, {
                consoData: consoData,
                subTab: subTab,
                farmFilter: farmFilter,
                cultureFilter: cultureFilter,
                sbMap: sbMap,
                // Profil courant : décide si le contrôle de classement du
                // bandeau est PROPOSÉ. La vraie garde est serveur.
                userRole: props.userRole,
                onClassed: loadConso,
              })
        )
  );
}

// Exposés pour les tests unitaires (node:test + vm), comme CampagneBudgetTab.
CampagneAnalytiqueTab.budgetsByLabel = CAT_budgetsByLabel;
CampagneAnalytiqueTab.opBudgetsByLabel = CAT_opBudgetsByLabel;
CampagneAnalytiqueTab.buildCultureWorkbook = buildCultureWorkbook;
CampagneAnalytiqueTab.CULTURE_INCONNUE = CAT_CULTURE_INCONNUE;
CampagneAnalytiqueTab.pivotRows = CAT_pivotRows;
CampagneAnalytiqueTab.pctPartsAnnuel = CAT_pctPartsAnnuel;
CampagneAnalytiqueTab.byCulture = CAT_byCulture;
CampagneAnalytiqueTab.PivotView = PivotView;
CampagneAnalytiqueTab.VarieteView = VarieteView;
CampagneAnalytiqueTab.ConsoView = ConsoView;
CampagneAnalytiqueTab.peutClasser = CAT_peutClasser;
CampagneAnalytiqueTab.classerArticle = CAT_classerArticle;
CampagneAnalytiqueTab.CAT_SANS_FICHE = CAT_SANS_FICHE;

export { CampagneAnalytiqueTab };
