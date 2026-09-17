/*
 * CampagnePivotView.jsx — vue « Pivot analytique » de l'écran Campagne
 * (CampagneAnalytiqueTab) : grille partagée (PivotAnalytiqueGrid), % consommé
 * annuel, partition récolte, pastilles de filtre et pop-ups de détail
 * (parcelle × quinzaine, détail d'une cellule).
 *
 * Extrait de CampagneAnalytiqueTab.jsx (déplacement de code, sans modification).
 */

import * as AnalytiqueUtils from '../shared/lib/analytiqueUtils.js';
import * as CampagneBudgetPivot from '../shared/lib/campagneBudgetPivot.js';
import * as CampagneBudgetQuinzaine from '../shared/lib/campagneBudgetQuinzaine.js';
import * as CampagneParcelleQuinzaine from '../shared/lib/campagneParcelleQuinzaine.js';
import * as CampagneProduction from '../shared/lib/campagneProduction.js';
import * as CampagneRapprochement from '../shared/lib/campagneRapprochement.js';
import * as CampagneRythme from '../shared/lib/campagneRythme.js';
import * as CampagneUtils from '../shared/lib/campagneUtils.js';
import * as CultureUtils from '../shared/lib/cultureUtils.js';
import { CampagneBudgetTab } from './CampagneBudgetTab.jsx';
import { PivotAnalytiqueGrid } from './PivotAnalytiqueGrid.jsx';
import { C, FAMILLE_ICONS, CAT_CULTURE_INCONNUE, fmtDH, fmtJH, fmtHa, fmtHaLabel, fmtDHPerHa, fmtQty, cultureOf, matchCulture, sbNom, sbHa, CAT_budgetsByLabel, CAT_opBudgetsByLabel, buildVarieteView, CAT_pivotRows, CAT_byCulture } from './campagneAnalytiqueHelpers.jsx';

var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;

/* ------------------------------------------------------------------ */
/* Sous-composant : Vue Pivot analytique (grille partagée)              */
/* ------------------------------------------------------------------ */

/**
 * Termes {num, den} du « % consommé » ANNUEL d'une cellule de la grille.
 * PURE. Mêmes garde-fous que CampagneBudgetQuinzaine.pctPartsCellule, sur les
 * champs de la vue annuelle : réalisé cumulé (`jh`, un TOTAL) sur budget
 * (`budget`, saisi en JH/Ha → × Ha pour redevenir un total).
 *
 * `null` = taux sans objet (aucun budget saisi, superficie inconnue) : la
 * cellule affiche « — », JAMAIS 0 % — qui se lirait « rien de consommé ».
 *
 * Sert de `ratio.parts` : la grille somme séparément numérateur et
 * dénominateur avant de diviser. Une série ordinaire afficherait une SOMME DE
 * POURCENTAGES en total de ligne et en pied de colonne.
 *
 * @param {{jh?: number, budget?: number, ha?: number}|null|undefined} cell
 * @returns {{num: number, den: number}|null}
 */
function CAT_pctPartsAnnuel(cell) {
  if (!cell) return null;
  var budget = Number(cell.budget);
  if (!isFinite(budget) || !(budget > 0)) return null;
  var ha = Number(cell.ha);
  if (!isFinite(ha) || !(ha > 0)) return null;
  var jh = Number(cell.jh);
  return { num: isFinite(jh) ? jh : 0, den: budget * ha };
}

/**
 * Sépare les lignes du pivot en DEUX jeux : la Récolte d'un côté, tout le
 * reste de l'autre. PURE (aucune ligne recopiée ni mutée : on ne fait que
 * répartir les références).
 *
 * Pourquoi sortir la Récolte du tableau : son budget (1 800 JH/Ha sur
 * certaines parcelles) est consommé à 0 % tant que la saison n'a pas
 * commencé. Laissé dans la même grille, il écrase le TOTAL — « 14.7 %
 * consommé » sur une campagne dont l'effort hors récolte est déjà à 60 %. Une
 * fois la Récolte sortie, le TOTAL du tableau principal EST le total hors
 * récolte, sans ligne supplémentaire à calculer.
 *
 * Le découpage suit l'ordre de lecture : un bandeau `type: 'groupe'` ouvre
 * une section, les lignes qui suivent lui appartiennent jusqu'au bandeau
 * suivant. Une ligne orpheline (aucun bandeau avant elle) reste dans le jeu
 * principal — jamais silencieusement perdue.
 *
 * @param {Array<Object>} rows lignes du pivot, dans l'ordre.
 * @param {string} groupeRecolte nom du groupe Récolte (référentiel).
 * @returns {{principal: Array<Object>, recolte: Array<Object>}}
 */
function CAT_partitionRecolte(rows, groupeRecolte) {
  var principal = [];
  var recolte = [];
  var cible = principal;
  (rows || []).forEach(function (r) {
    if (!r) return;
    if (r.type === 'groupe') cible = (r.key === groupeRecolte) ? recolte : principal;
    cible.push(r);
  });
  return { principal: principal, recolte: recolte };
}

/** Pastille de bascule — même gabarit que les autres bascules de l'écran. */
function CAT_pillStyle(active) {
  return {
    padding: '5px 14px',
    border: '1.5px solid ' + (active ? C.berry : C.border),
    borderRadius: '16px',
    background: active ? C.berry : C.surface,
    color: active ? '#fff' : C.text,
    fontSize: '12px',
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
  };
}

/** Groupe de bascules `[[valeur, libellé], …]`. */
function CAT_pills(options, current, onPick, keyPrefix) {
  return options.map(function (opt) {
    return React.createElement('button', {
      key: keyPrefix + opt[0],
      onClick: function () { onPick(opt[0]); },
      style: CAT_pillStyle(current === opt[0]),
    }, opt[1]);
  });
}

/**
 * Pop-up « une parcelle, quinzaine par quinzaine ».
 *
 * La grille montre une parcelle en UNE colonne : le cumul de la campagne. On
 * y lit COMBIEN, jamais QUAND — trois quinzaines calmes suivies d'une flambée
 * et un rythme régulier s'y affichent exactement pareil. Cette pop-up fait
 * pivoter les MÊMES lignes sur l'axe du temps : parcelle figée, colonnes =
 * quinzaines, TOTAL au bout.
 *
 * Elle n'affiche QUE le réalisé — ni budget ni « % consommé ». Le budget est
 * annuel : le découper en quinzaines demanderait une clé de répartition qui
 * n'existe pas, et tout taux affiché ici serait une invention. Ce qui reste
 * réglable, ce sont les unités (JH ↔ Coût DH, Par Ha ↔ Total), initialisées
 * sur celles de l'écran pour que la pop-up prolonge la lecture en cours.
 *
 * Rien n'est agrégé ici : le pivot est celui de la grille
 * (AnalytiqueUtils.buildAnalytiquePivotByFamille) et le rendu aussi
 * (PivotAnalytiqueGrid) — seul l'axe des colonnes change.
 */
function CAT_ParcelleQuinzainePopup(props) {
  var onClose = props.onClose;
  var ha = Number(props.ha) || 0;
  var coutJour = props.coutJour;
  var _metric = React.useState(props.metric || 'jh');
  var metric = _metric[0]; var setMetric = _metric[1];
  var _totalMode = React.useState(!!props.totalMode);
  var totalMode = _totalMode[0]; var setTotalMode = _totalMode[1];
  var _detailMode = React.useState(false);
  var detailMode = _detailMode[0]; var setDetailMode = _detailMode[1];

  var Grid = PivotAnalytiqueGrid;
  var AU = AnalytiqueUtils;
  var CPQ = CampagneParcelleQuinzaine;
  var isJh = metric === 'jh';

  var contenu;
  if (!Grid || !AU || !CPQ) {
    // Module absent (script non chargé) → on le DIT. Une pop-up vide se
    // lirait « cette parcelle n'a rien consommé ».
    contenu = React.createElement('div', {
      style: { padding: '24px', textAlign: 'center', color: C.textSec, fontSize: '13px' },
    }, 'Détail indisponible : module de ventilation non chargé.');
  } else {
    var lignes = CPQ.lignesParQuinzaine(props.rows, props.parcelle, ha);
    var pivot = AU.buildAnalytiquePivotByFamille(lignes, { detail: detailMode });
    if (!pivot.groupedRows || !pivot.groupedRows.length) {
      contenu = React.createElement('div', {
        style: { padding: '24px', textAlign: 'center', color: C.textSec, fontSize: '13px' },
      }, 'Aucun pointage sur cette parcelle pour la campagne.');
    } else {
      // Coût CHARGÉ quand il est connu, exactement comme dans la grille :
      // JH × coût ouvrier. Sans coût connu, le `Cout` BEE ONE brut — et le
      // libellé de la série le dit.
      var getValeur = (!isJh && coutJour !== null && coutJour !== undefined)
        ? function (cell) {
          if (!cell) return null;
          var j = Number(cell.jh);
          return isFinite(j) ? j * coutJour : null;
        }
        : undefined;
      contenu = React.createElement(Grid, {
        parcelles: pivot.parcelles,
        groupedRows: pivot.groupedRows,
        color: props.color || C.berry,
        firstColumnLabel: 'Opération',
        // Les colonnes sont des QUINZAINES qui partagent la même surface :
        // la somme des colonnes vaudrait 4 × la parcelle sur 4 quinzaines,
        // et « JH/Ha » au TOTAL serait divisé par quatre.
        totalHa: ha,
        chiffresGroupe: true,
        largeursFixes: true,
        metrics: [{
          key: isJh ? 'jh' : 'cout',
          get: getValeur,
          label: isJh ? 'Réalisé' : ((coutJour === null || coutJour === undefined) ? 'Coût' : 'Coût chargé'),
          unit: isJh ? (totalMode ? 'JH' : 'JH/Ha') : (totalMode ? 'DH' : 'DH/Ha'),
          basis: 'total',
          display: totalMode ? 'total' : 'perHa',
          format: isJh
            ? function (v) { return (Math.round(v * 10) / 10).toFixed(1); }
            : function (v) { return Math.round(v).toLocaleString('fr-MA'); },
          summary: isJh
            ? function (t) { return Math.round(t).toLocaleString('fr-MA') + ' JH total'; }
            : function (t) { return Math.round(t).toLocaleString('fr-MA') + ' DH'; },
        }],
      });
    }
  }

  return React.createElement('div', {
    style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
    onClick: onClose,
  },
    React.createElement('div', {
      style: { background: '#fff', borderRadius: '16px', maxWidth: '1100px', width: '100%',
        maxHeight: '86vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' },
      onClick: function (e) { e.stopPropagation(); },
    },
      React.createElement('div', {
        style: { padding: '16px 20px', background: props.color || C.berry, borderRadius: '16px 16px 0 0',
          color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: '15px', fontWeight: 700 } },
            props.label || props.parcelle),
          React.createElement('div', { style: { fontSize: '11px', opacity: 0.85, marginTop: '2px' } },
            'Réalisé quinzaine par quinzaine · ' + (ha > 0 ? fmtHaLabel(ha) : 'Ha inconnu'))
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: '16px',
            cursor: 'pointer', borderRadius: '8px', width: '32px', height: '32px' },
        }, React.createElement('i', { className: 'fa-solid fa-xmark' }))
      ),
      React.createElement('div', {
        style: { padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      },
        React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Afficher :'),
        CAT_pills([['jh', 'JH'], ['cout', 'Coût DH']], metric, setMetric, 'pm-'),
        React.createElement('span', { style: { width: '8px' } }),
        CAT_pills([['ha', 'Par Ha'], ['total', 'Total']], totalMode ? 'total' : 'ha',
          function (v) { setTotalMode(v === 'total'); }, 'pt-'),
        React.createElement('span', { style: { width: '8px' } }),
        CAT_pills([['recap', 'Récap'], ['detail', 'Détail']], detailMode ? 'detail' : 'recap',
          function (v) { setDetailMode(v === 'detail'); }, 'pd-')
      ),
      React.createElement('div', { style: { padding: '0 20px 20px' } }, contenu)
    )
  );
}

/**
 * Pop-up de détail d'une cellule de la grille : opérations fines de la
 * famille sur la parcelle.
 *
 * La colonne s'appelle « Présences » et NON « Ouvriers » (comme sur l'écran
 * Quinzaine) : `campagne-analytique-detail` agrège jour par jour, donc
 * `nbOuv` compte les ouvriers distincts D'UNE JOURNÉE. Additionné sur toute
 * la campagne, il vaut un cumul de présences — un ouvrier venu 10 jours pèse
 * 10. Le lire « Ouvriers » ferait croire à un effectif.
 */
function CAT_DetailPopup(props) {
  var cell = props.cell;
  var onClose = props.onClose;
  var ha = cell.ha || 0;
  var byOp = {};
  (cell.detailRows || []).forEach(function (r) {
    var k = r.operation || '—';
    if (!byOp[k]) byOp[k] = { operation: k, jh: 0, cout: 0, nbOuv: 0 };
    byOp[k].jh += r.jh || 0;
    byOp[k].cout += r.cout || 0;
    byOp[k].nbOuv += r.nbOuv || 0;
  });
  var opRows = Object.keys(byOp).map(function (k) { return byOp[k]; })
    .sort(function (a, b) { return b.jh - a.jh; });
  var totals = opRows.reduce(function (t, r) {
    t.jh += r.jh; t.cout += r.cout; t.nbOuv += r.nbOuv; return t;
  }, { jh: 0, cout: 0, nbOuv: 0 });

  function perHa(v) { return ha > 0 ? (Math.round(v / ha * 10) / 10).toLocaleString('fr-MA') : '—'; }
  function jhTxt(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function dhTxt(v) { return Math.round(v).toLocaleString('fr-MA'); }

  var th = { padding: '6px 10px', textAlign: 'right', fontSize: '11px', color: C.textSec, borderBottom: '1px solid ' + C.border };
  var thL = Object.assign({}, th, { textAlign: 'left' });
  var td = { padding: '6px 10px', textAlign: 'right', fontSize: '12px' };
  var tdL = Object.assign({}, td, { textAlign: 'left', fontWeight: 500 });
  var tdT = Object.assign({}, td, { fontWeight: 700 });

  return React.createElement('div', {
    style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
    onClick: onClose,
  },
    React.createElement('div', {
      style: { background: '#fff', borderRadius: '16px', maxWidth: '680px', width: '100%',
        maxHeight: '80vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' },
      onClick: function (e) { e.stopPropagation(); },
    },
      React.createElement('div', {
        style: { padding: '16px 20px', background: C.berry, borderRadius: '16px 16px 0 0', color: '#fff',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: '15px', fontWeight: 700 } }, cell.parcelleLabel || cell.parcelle),
          React.createElement('div', { style: { fontSize: '11px', opacity: 0.85, marginTop: '2px' } },
            (cell.operationFamille || '') + ' · ' + (ha > 0 ? fmtHaLabel(ha) : 'Ha inconnu'))
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: '16px',
            cursor: 'pointer', borderRadius: '8px', width: '32px', height: '32px' },
        }, React.createElement('i', { className: 'fa-solid fa-xmark' }))
      ),
      React.createElement('div', { style: { padding: '16px 20px' } },
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', { style: thL }, 'Opération'),
              React.createElement('th', {
                style: th,
                title: 'Cumul des présences sur la campagne : un ouvrier présent 10 jours compte 10. Ce n\'est pas un effectif.',
              }, 'Présences'),
              React.createElement('th', { style: th }, 'JH'),
              React.createElement('th', { style: th }, 'JH / Ha'),
              React.createElement('th', { style: th }, 'Coût (DH)'),
              React.createElement('th', { style: th }, 'DH / Ha')
            )
          ),
          React.createElement('tbody', null,
            opRows.map(function (r, i) {
              return React.createElement('tr', { key: i, style: { background: i % 2 === 0 ? C.surface : C.surface2 } },
                React.createElement('td', { style: tdL }, r.operation),
                React.createElement('td', { style: td }, r.nbOuv),
                React.createElement('td', { style: td }, jhTxt(r.jh)),
                React.createElement('td', { style: td }, perHa(r.jh)),
                React.createElement('td', { style: td }, dhTxt(r.cout)),
                React.createElement('td', { style: td }, ha > 0 ? dhTxt(r.cout / ha) : '—')
              );
            })
          ),
          React.createElement('tfoot', null,
            React.createElement('tr', { style: { background: C.surface3 } },
              React.createElement('td', { style: Object.assign({}, tdT, { textAlign: 'left' }) }, 'TOTAL'),
              React.createElement('td', { style: tdT }, totals.nbOuv),
              React.createElement('td', { style: tdT }, jhTxt(totals.jh)),
              React.createElement('td', { style: tdT }, perHa(totals.jh)),
              React.createElement('td', { style: tdT }, dhTxt(totals.cout)),
              React.createElement('td', { style: tdT }, ha > 0 ? dhTxt(totals.cout / ha) : '—')
            )
          )
        )
      )
    )
  );
}

/**
 * Vue « Pivot analytique » : la MÊME grille que l'écran Quinzaine
 * (PivotAnalytiqueGrid), alimentée par les lignes de la campagne.
 * Lignes = groupe M.O → famille (code GB) → opération, colonnes = parcelles
 * avec leur Ha, une grille par culture.
 *
 * Cette vue ne calcule RIEN elle-même : le pivot vient de
 * AnalytiqueUtils.buildAnalytiquePivotByFamille (lib partagée, inchangée), la
 * superposition du budget de CampagneBudgetPivot.buildBudgetPivot (qui
 * applique la règle métier `familleTotal`), et la présentation de
 * PivotAnalytiqueGrid. Elle ne fait que mapper les champs (CAT_pivotRows) et
 * traduire ses bascules en séries `metrics`.
 *
 * Bascules : JH ↔ Coût DH (état partagé avec les autres vues MO, prop
 * `metric`), Ha ↔ Total et Récap ↔ Détail (locaux à la vue).
 *
 * ── BUDGET ET % CONSOMMÉ ──────────────────────────────────────────────────
 * Deux SOUS-COLONNES s'ajoutent au réalisé sous chaque parcelle (Budget et
 * % consommé), seulement quand :
 *   - la métrique est JH : le budget est saisi en JH/Ha, il n'a aucune
 *     traduction en DH — afficher un « budget » sous un coût serait faux ;
 *   - la culture affichée porte au moins un budget : sinon la grille se
 *     remplirait de deux lignes de « — » (état nominal de l'avocatier).
 * Le budget est en JH/Ha (`basis: 'perHa'`), le réalisé en JH total
 * (`basis: 'total'`) : la conversion est portée PAR SÉRIE par la grille, elle
 * n'est jamais faite ici — et ses agrégats reconvertissent en total avant de
 * sommer (sommer des JH/Ha entre parcelles n'aurait aucun sens).
 */
function PivotView(props) {
  var data = props.data || {};
  var sbMap = props.sbMap || {};
  var metric = props.metric;          // 'cout' | 'jh'
  var setMetric = props.setMetric;

  var _totalMode = useState(false);
  var totalMode = _totalMode[0]; var setTotalMode = _totalMode[1];

  var _detailMode = useState(false);
  var detailMode = _detailMode[0]; var setDetailMode = _detailMode[1];

  var _detailCell = useState(null);
  var detailCell = _detailCell[0]; var setDetailCell = _detailCell[1];

  // États de la VUE QUINZAINE — ajoutés APRÈS les précédents à dessein :
  // l'ordre des useState est l'index de state de React, le décaler renumérote
  // tout (et casse le harnais de test qui injecte les états par position).
  var _vueQuinzaine = useState(false);
  var vueQuinzaine = _vueQuinzaine[0]; var setVueQuinzaine = _vueQuinzaine[1];
  // '' = suivre la quinzaine EN COURS (défaut). Une valeur explicite = l'
  // utilisateur consulte/corrige une quinzaine passée, et ce choix ne doit pas
  // sauter au prochain rendu.
  var _quinzaineSel = useState('');
  var quinzaineSel = _quinzaineSel[0]; var setQuinzaineSel = _quinzaineSel[1];

  // ── PLEIN ÉCRAN ────────────────────────────────────────────────────────
  // Ajoutés EN DERNIER, pour la même raison que les deux précédents : l'ordre
  // des useState est l'index de state de React, et le harnais de test injecte
  // les états par position.
  //
  // ⚠️ État LOCAL, contrairement à AffectationAnalytiqueTable dont TOUT
  // l'état vit chez QuinzaineTab : là-bas l'early-return `if (loading)` du
  // parent démonte le panneau à chaque changement de quinzaine, et un plein
  // écran qui se referme tout seul serait un bug. Ici le parent
  // (CampagneAnalytiqueTab) ne repasse plus par ses early-returns une fois
  // les données chargées — `setLoading(true)` n'est appelé que dans l'effet
  // de MONTAGE, et aucun changement de filtre/bascule ne le rejoue. PivotView
  // n'est donc démonté que par une vraie navigation (changement de
  // sous-onglet ou de vue), où repartir hors plein écran est attendu.
  var _fullscreen = useState(false);
  var fullscreen = _fullscreen[0]; var setFullscreen = _fullscreen[1];
  // Index de la culture affichée EN PLEIN ÉCRAN (le carrousel ‹ › ).
  var _cultureIdx = useState(0);
  var cultureIdx = _cultureIdx[0]; var setCultureIdx = _cultureIdx[1];
  // Parcelle ouverte en ventilation par quinzaine (clic sur son en-tête).
  // Déclaré EN DERNIER : l'ordre des useState est l'index de state de React,
  // l'insérer plus haut renumérote tous les suivants.
  var _parcelleZoom = useState(null);
  var parcelleZoom = _parcelleZoom[0]; var setParcelleZoom = _parcelleZoom[1];

  // Sortie au clavier + gel du défilement de la page derrière l'overlay :
  // même mécanisme que l'écran Quinzaine (où il vit chez QuinzaineTab, parce
  // que le panneau y est démonté trop souvent pour le porter).
  useEffect(function () {
    if (typeof document === 'undefined' || !document.body) return undefined;
    if (!fullscreen) return undefined;
    var onKey = function (e) { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    var prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return function () {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  var Grid = PivotAnalytiqueGrid;
  var AU = AnalytiqueUtils;
  // Nom du groupe Récolte pris dans le RÉFÉRENTIEL (jamais une chaîne
  // réécrite à la main) : c'est lui qui décide quelles lignes sortent du
  // tableau principal. Repli sur le libellé connu si le module est absent.
  var GROUPE_RECOLTE = (AU && AU.GB_GROUPE_MAP && AU.GB_GROUPE_MAP.GB08) || 'M.O Récolte';

  var CR = CampagneRythme;
  var CBQ = CampagneBudgetQuinzaine;

  // Avancement de la campagne, lu sur la MÊME réponse que le réalisé affiché
  // (`periodes` + `campagne` de campagne-analytique-detail) : les quinzaines
  // restantes ne peuvent donc pas diverger des quinzaines réalisées.
  var quinzaines = useMemo(function () {
    if (!CR) return null;
    return CR.quinzainesInfo({ periodes: data.periodes, campagne: data.campagne });
  }, [CR, data.periodes, data.campagne]);

  // BUDGET IDÉAL — part de la campagne écoulée à ce jour (repère de rythme
  // LINÉAIRE, à comparer au % consommé). Calculée sur la campagne AFFICHÉE,
  // pas sur la date du jour seule : consulter une campagne passée doit donner
  // 100 %, pas la position du calendrier dans la campagne en cours.
  // `null` = indéterminable (campagne illisible, module absent) → la
  // sous-colonne n'est pas proposée du tout, jamais un 0 % trompeur.
  var partIdeale = useMemo(function () {
    if (!CR || typeof CR.partEcoulee !== 'function') return null;
    return CR.partEcoulee({ campagne: data.campagne, utils: CampagneUtils });
  }, [CR, data.campagne]);

  // NB : les classes de rythme (CR.indexClasses) ne sont plus indexées ici —
  // les séries « reste budgété » / « reste au rythme » ont quitté la grille
  // (cf. metricsBudget). `shared/lib/campagneRythme.js` reste chargé et
  // utilisé pour l'avancement de la campagne ci-dessus.

  var groups = useMemo(function () {
    var rows = CAT_pivotRows(data.rows, sbMap, data.haByRef || {}, {
      farmFilter: props.farmFilter,
      cultureFilter: props.cultureFilter,
    });
    return CAT_byCulture(rows, sbMap);
  }, [data, sbMap, props.farmFilter, props.cultureFilter]);

  var isJh = metric === 'jh';
  var uniteJh = totalMode ? 'JH' : 'JH/Ha';
  var fmtJh1 = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };

  // Quinzaines de la campagne, DÉRIVÉES des mêmes `periodes` que le réalisé
  // (jamais un calendrier local, jamais un « 24 » en dur).
  var quinzaineOptions = useMemo(function () {
    if (!CBQ) return [];
    return CBQ.optionsFromPeriodes(data.periodes);
  }, [CBQ, data.periodes]);

  // Quinzaine EN COURS = dernière vue dans les `periodes` (celle qu'on est en
  // train de pointer). C'est le défaut du sélecteur.
  var quinzaineCourante = CBQ && quinzaines ? CBQ.quinzaineCourante(quinzaines) : '';
  // Un choix explicite disparu des options (rechargement, changement de
  // campagne) retombe sur la quinzaine en cours plutôt que d'afficher une vue
  // vide sans explication.
  var quinzaineActive = (quinzaineSel && quinzaineOptions.some(function (o) {
    return o.key === quinzaineSel;
  })) ? quinzaineSel : quinzaineCourante;
  var quinzaineInfoSel = null;
  quinzaineOptions.forEach(function (o) { if (o.key === quinzaineActive) quinzaineInfoSel = o; });

  var quinzainesByLabel = props.quinzainesByLabel || {};
  // Y a-t-il un engagement saisi, quelque part, sur la quinzaine affichée ?
  // Sinon la bascule ne mènerait qu'à des « — » : on ne la propose pas.
  var hasQuinzaineBudget = !!(CBQ && quinzaineActive
    && Object.keys(CBQ.trancheQuinzaine(quinzainesByLabel, quinzaineActive)).some(function (l) {
      return Object.keys(CBQ.trancheQuinzaine(quinzainesByLabel, quinzaineActive)[l] || {}).length > 0;
    }));
  // La vue quinzaine n'a de sens qu'en JH (un engagement est saisi en JH/Ha,
  // il n'a aucune traduction en DH) et seulement s'il y a un engagement.
  var quinzaineDispo = !!(CBQ && Grid && isJh && hasQuinzaineBudget);
  var enQuinzaine = vueQuinzaine && quinzaineDispo;

  var coutJour = (props.coutOuvrier && Number(props.coutOuvrier.coutMoyenJour) > 0)
    ? Number(props.coutOuvrier.coutMoyenJour)
    : null;
  /**
   * FACTEUR DE CHARGE — ce que coûte réellement un dirham de salaire de base.
   *
   * Le réalisé de la grille vient du `Cout` BEE ONE : une base NUE, sans
   * primes ni charges. Le budget, lui, est valorisé au coût CHARGÉ. Comparer
   * les deux tels quels sous-estimait le « % consommé » d'un quart : sur
   * MARAVILLA MD, 44,5 % en DH contre 59,2 % en JH pour le même effort et le
   * même budget. Majorer le réalisé du même facteur remet les deux côtés dans
   * la même unité — et le taux en DH redevient celui en JH.
   *
   * La variation entre parcelles est préservée : c'est le `Cout` réel de
   * chaque cellule qui est majoré, pas une moyenne qui l'écraserait.
   */
  /**
   * Le COÛT RÉALISÉ d'une cellule se calcule depuis ses JOURNÉES, jamais
   * depuis le `Cout` de BEE ONE.
   *
   * « BEE ONE ne doit donner que les jours de pointage, le calcul de la paie
   * est erroné dessus » (Omar, 2026-08-20). Majorer ce coût d'un facteur ne
   * suffisait pas : cela propageait une base fausse, simplement mise à
   * l'échelle. On valorise donc les JH — la seule donnée fiable de BEE ONE —
   * au coût ouvrier chargé calculé par Smart Berry.
   *
   * Effet secondaire recherché : le « % consommé » en dirhams devient
   * IDENTIQUE à celui en JH, puisque les deux côtés sont le même volume
   * multiplié par la même constante. Deux vues du même écran ne peuvent plus
   * se contredire.
   */
  // COÛT CHARGÉ — lu tel quel dans la cellule. Le backend l'a calculé au taux
  // de CHAQUE ouvrier (Σ JH × taux(ouvrier, quinzaine)).
  //
  // Il valait auparavant `JH × coutMoyenJour`, une moyenne d'établissement
  // appliquée à tout le monde : deux parcelles travaillées par des équipes de
  // coûts différents ressortaient au même prix, ce qu'un écran de coût par
  // parcelle est précisément censé distinguer.
  //
  // `null` quand la cellule n'a aucun coût chargé mais des JH : le taux de ces
  // ouvriers est inconnu (absents du registre de paie). On affiche « — »,
  // jamais le `Cout` BEE ONE — qui ferait passer un coût nu pour un coût
  // chargé, et jamais 0, qui se lirait « gratuit ».
  var coutCharge = function (cell) {
    if (!cell) return null;
    var c = Number(cell.coutCharge);
    if (isFinite(c) && c > 0) return c;
    return (Number(cell.jh) > 0) ? null : 0;
  };

  var metrics = [{
    key: isJh ? 'jh' : 'cout',
    // En Coût DH, le réalisé est le coût CHARGÉ calculé par ouvrier. Plus
    // aucun repli sur le `Cout` BEE ONE : il n'est pas un coût, et l'afficher
    // sous ce libellé était la dernière façon d'en voir dans cet écran.
    get: isJh ? undefined : coutCharge,
    label: isJh ? 'Réalisé' : 'Coût chargé',
    unit: isJh ? uniteJh : (totalMode ? 'DH' : 'DH/Ha'),
    // Le pivot stocke des TOTAUX par cellule ; seul `display` bouge avec la
    // bascule Ha/Total. Le budget, lui, est déjà en JH/Ha (`basis: 'perHa'`)
    // — d'où le sens de conversion porté par série.
    basis: 'total',
    display: totalMode ? 'total' : 'perHa',
    format: isJh
      ? fmtJh1
      : function (v) { return Math.round(v).toLocaleString('fr-MA'); },
    summary: isJh
      ? function (t) { return Math.round(t).toLocaleString('fr-MA') + ' JH total'; }
      : function (t) { return Math.round(t).toLocaleString('fr-MA') + ' DH'; },
  }];

  /**
   * Format d'un POURCENTAGE consommé.
   *
   * Le suffixe « % » et l'italique sont portés par la VALEUR, jamais par
   * `unit` : entre deux colonnes de JH, un « 51.6 » nu se lit comme un
   * troisième volume. Passer par `unit` les afficherait bien dans les
   * sous-colonnes, mais donnerait « % consommé % » dans la colonne Total
   * (seule colonne où la grille accole le libellé de série à son unité) et
   * ne toucherait ni le pied de tableau ni le grand total.
   * Ici, la grille applique `format` à TOUS les rendus du taux (cellule,
   * total de ligne, total de colonne, grand total) : un seul endroit à
   * changer, quatre emplacements couverts.
   *
   * Au-delà de 100 %, le budget est dépassé : signalé en rouge, JAMAIS
   * plafonné — un taux ramené à 100 % masquerait ce qu'on vient lire.
   */
  function fmtPct(v) {
    var pct = Math.round(v * 1000) / 10;
    var style = { fontStyle: 'italic' };
    if (pct > 100) style.color = C.berry;
    return React.createElement('span', { style: style }, pct.toFixed(1) + ' %');
  }

  // Coût CHARGÉ d'une journée d'ouvrier, servi par l'action backend
  // `campagne-cout-ouvrier` (brut + CNSS patronale des déclarés + transport,
  // moyenné sur la campagne). `null` = indisponible : le budget en DH n'est
  // alors pas proposé du tout — surtout pas un budget nul, qui afficherait un
  // dépassement infini sur chaque ligne.
  /**
   * Le BUDGET est saisi en JH/Ha. En Coût DH, on le valorise au coût chargé
   * d'une journée : `budget DH/Ha = budget JH/Ha × coût ouvrier DH/jour`.
   *
   * Cette conversion est portée par la SÉRIE (via `get`), et pas par une
   * transformation des cellules : la grille applique ensuite ses propres
   * règles `basis`/`display` (× Ha en mode Total), et le « % consommé »
   * réutilise le même chemin. Convertir les cellules en amont obligerait à
   * refaire ces deux règles à la main, et à les maintenir en double.
   */
  function budgetDhCell(cell) {
    if (!cell || coutJour === null) return null;
    var b = Number(cell.budget);
    return (isFinite(b) && b > 0) ? b * coutJour : null;
  }

  /**
   * Termes du « % consommé » en dirhams : coût réalisé / budget valorisé.
   * Même forme que `CAT_pctPartsAnnuel` (série RATIO, cf. plus haut) — les
   * deux termes en quantité TOTALE, jamais un pourcentage sommé.
   */
  function pctPartsDh(cell) {
    if (!cell || coutJour === null) return null;
    // Réalisé et budget sont le MÊME volume de JH multiplié par la MÊME
    // constante : le taux se simplifie en celui des JH. On le calcule donc
    // par le même chemin, plutôt que d'écrire une seconde formule qui
    // pourrait en diverger à l'arrondi près.
    return CAT_pctPartsAnnuel(cell);
  }

  var fmtDh0 = function (v) { return Math.round(v).toLocaleString('fr-MA'); };

  // Séries Budget + % consommé — sur une culture budgétée (cf. en-tête), en JH
  // comme en Coût DH (le budget y est valorisé au coût ouvrier chargé).
  //
  // ⚠️ TROIS SOUS-COLONNES, PAS CINQ. « Reste budgété » et « reste au rythme »
  // (LOT 3a) ont QUITTÉ la grille : avec 9 parcelles, cinq séries font 45
  // colonnes, illisibles même en défilant. Le module de calcul
  // (shared/lib/campagneRythme.js) et le champ `classe_rythme` en base sont
  // CONSERVÉS tels quels — seul leur affichage ici est retiré, leur sort est
  // une décision séparée. `CampagneRythme` reste d'ailleurs utilisé plus haut
  // pour l'avancement de la campagne (quinzainesInfo).
  var metricsBudget = metrics.concat([
    isJh ? {
      key: 'budget',
      label: 'Budget',
      unit: uniteJh,
      basis: 'perHa',
      display: totalMode ? 'total' : 'perHa',
      format: fmtJh1,
    } : {
      // Budget VALORISÉ : la même série, exprimée au coût chargé du jour.
      get: budgetDhCell,
      label: 'Budget',
      unit: totalMode ? 'DH' : 'DH/Ha',
      basis: 'perHa',
      display: totalMode ? 'total' : 'perHa',
      format: fmtDh0,
    },
    {
      label: '% consommé',
      // Pas d'`unit` : le « % » est dans la valeur (cf. fmtPct). Le remettre
      // ici donnerait « % consommé % » dans la colonne Total.
      // Série RATIO : réalisé cumulé / budget, sommés séparément avant
      // division (cf. PivotAnalytiqueGrid, section « ratio »). `basis` et
      // `display` ne s'y appliquent pas : un taux est invariant par
      // changement d'unité, la bascule Ha/Total ne le touche pas.
      ratio: { parts: isJh ? CAT_pctPartsAnnuel : pctPartsDh },
      format: fmtPct,
    },
  ]);

  /**
   * VUE QUINZAINE — les MÊMES trois sous-colonnes que la vue annuelle, mais
   * sur le périmètre d'une seule quinzaine : réalisé, engagé, % consommé.
   *
   * ── POURQUOI UNE BASCULE ET NON TROIS SOUS-COLONNES DE PLUS ───────────────
   * Six sous-colonnes par parcelle (18 colonnes pour 3 parcelles, 54 pour 9)
   * ne se lisent pas, et se lisent encore moins au téléphone (c'est là que la
   * validation se fait). Mais la raison n'est pas que cosmétique : les deux
   * vues répondent à DEUX
   * questions différentes, et leurs chiffres ne se comparent pas.
   *   - annuelle  : « où en est la campagne, va-t-on tenir le budget ? »
   *     (cumul depuis juillet, projection jusqu'en juin) ;
   *   - quinzaine : « ce que j'ai engagé il y a 15 jours, l'ai-je consommé ? »
   *     (une seule période, aucun lien de somme avec l'annuel).
   * Les afficher ensemble inviterait à comparer un chiffre de quinzaine à un
   * cumul annuel — l'erreur de lecture qu'on ne pourrait plus rattraper.
   * La bascule garde chaque vue à trois sous-colonnes et rend le périmètre
   * explicite dans la légende.
   */
  var metricsQuinzaine = [
    {
      key: 'jhQuinzaine',
      label: 'Réalisé quinz.',
      unit: uniteJh,
      basis: 'total',
      display: totalMode ? 'total' : 'perHa',
      format: fmtJh1,
      summary: function (t) { return Math.round(t).toLocaleString('fr-MA') + ' JH sur la quinzaine'; },
    },
    {
      key: 'budgetQuinzaine',
      label: 'Engagé quinz.',
      unit: uniteJh,
      basis: 'perHa',
      display: totalMode ? 'total' : 'perHa',
      format: fmtJh1,
    },
    {
      label: '% consommé',
      // Pas d'`unit` : le « % » est dans la valeur (cf. fmtPct). Le remettre
      // ici donnerait « % consommé % » dans la colonne Total.
      // Série RATIO : les totaux somment numérateur et dénominateur puis
      // divisent. Une série ordinaire afficherait une SOMME de pourcentages
      // en pied de colonne (cf. PivotAnalytiqueGrid, section « ratio »).
      ratio: { parts: CBQ ? CBQ.pctPartsCellule : function () { return null; } },
      format: fmtPct,
    },
  ];

  // Périmètre de la vue annuelle : non déductible des chiffres affichés.
  // Le RÉALISÉ et le BUDGET ne sont plus valorisés de la même façon — et le
  // dire est indispensable : le « % consommé » n'est donc plus identique à
  // celui affiché en JH, contrairement à ce que cette note promettait.
  var noteCoutCharge = isJh ? '' :
    ' Coût CHARGÉ : chaque journée pointée est valorisée au coût de '
    + 'L\'OUVRIER qui l\'a faite (salaire Smart Berry, primes et charges '
    + 'comprises) — une parcelle travaillée par une équipe chère coûte donc '
    + 'plus qu\'une autre à JH égal.'
    + (coutJour === null ? ''
      : ' Le BUDGET, lui, n\'a pas d\'ouvrier : il est converti au coût moyen '
        + 'de la campagne (' + fmtDh0(coutJour) + ' DH/JH).')
    + ' Le « % consommé » reste calculé sur les JOURNÉES, pas sur les dirhams : '
    + 'il est donc identique à celui affiché en JH.'
    + ' BEE ONE ne fournit que les journées : son calcul de paie n\'est pas repris.';

  var noteBudgetSeul = 'Budget : périmètre budgété uniquement (les familles et '
    + 'parcelles sans budget saisi en sont exclues, mais restent comptées dans '
    + 'le Réalisé). « % consommé » = Réalisé / Budget sur ce seul périmètre. '
    + '« — » = aucun budget saisi, ou superficie inconnue.' + noteCoutCharge;

  // Garde anti-crash : une référence à un global absent fait planter TOUT le
  // rendu React (mémoire projet « tab bare global ref »).
  //
  // CultureUtils est dans la MÊME garde que la grille et le pivot, et pas
  // seulement pour éviter un crash : sans lui, aucune parcelle n'est
  // rattachable à sa culture. Afficher quand même la grille produirait des
  // tableaux dont le titre ment sur leur contenu — un écran faux est pire
  // qu'un écran absent, personne ne peut le détecter à la lecture.
  var CU = CultureUtils;
  if (!Grid || !AU || typeof AU.buildAnalytiquePivotByFamille !== 'function'
    || !CU || typeof CU.resolveCulture !== 'function') {
    return React.createElement('div', {
      style: { padding: '40px', textAlign: 'center', color: '#c0392b', fontSize: '14px' },
    },
      React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { marginRight: '8px' } }),
      'Affectation par Ha indisponible : un module de calcul n\'a pas été chargé '
        + '(grille, pivot analytique ou référentiel des cultures). Rechargez la page.'
    );
  }

  // ── PLEIN ÉCRAN : quelles grilles sont rendues ? ────────────────────────
  // Une seule à la fois — c'est tout l'intérêt : la grille éclatée en
  // sous-colonnes a besoin de toute la largeur ET de toute la hauteur. Le
  // carrousel ‹ › remplace le défilement entre cultures.
  // Un index devenu hors bornes (filtre culture changé pendant le plein
  // écran) retombe sur la première grille plutôt que sur un écran blanc.
  var idxCulture = (cultureIdx >= 0 && cultureIdx < groups.length) ? cultureIdx : 0;
  var enPlein = !!fullscreen && groups.length > 0;
  var groupesAffiches = enPlein ? [groups[idxCulture]] : groups;

  // ── BUDGET IDÉAL : UN REPÈRE DE PAGE, PAS UNE COLONNE ──────────────────
  // La part de campagne écoulée est la MÊME valeur dans toutes les cellules :
  // en faire une sous-colonne coûtait une colonne par parcelle pour répéter
  // un seul chiffre. Elle est donc affichée une fois, en haut à droite, où
  // elle se lit comme ce qu'elle est — la position du CALENDRIER, à comparer
  // de tête au « % consommé » de n'importe quelle ligne.
  // Garde anti-crash sur `CR` : une référence à un global absent fait planter
  // TOUT le rendu React (mémoire projet « tab bare global ref »).
  var joursIdeal = (CR && typeof CR.joursEcoules === 'function')
    ? CR.joursEcoules({ campagne: data.campagne, utils: CampagneUtils })
    : null;
  // `null` = indéterminable (campagne illisible, module absent) : on n'affiche
  // RIEN plutôt qu'un 0 % qui se lirait « campagne pas commencée ».
  /**
   * Repère « COÛT OUVRIER — DH / jour », à côté du budget idéal.
   *
   * C'est le CHIFFRE QUI VALORISE la grille en Coût DH : sans lui, aucun
   * budget en dirhams. L'afficher, c'est permettre de le contester — d'où le
   * détail complet en infobulle (brut, charges patronales, transport, nombre
   * de journées et d'ouvriers), et non un nombre tombé du ciel.
   *
   * Absent tant que le calcul n'a pas répondu, ou qu'aucune journée n'est
   * pointée : « pas de donnée » n'est pas « coût nul ».
   */
  var repereCout = (coutJour === null) ? null : (function () {
    var d = props.coutOuvrier || {};
    var det = d.detail || {};
    var part = (typeof d.partDeclares === 'number')
      ? Math.round(d.partDeclares * 100) + ' % de journées déclarées'
      : null;
    // Le détail EST l'argument : un coût moyen sans sa décomposition ne se
    // conteste pas, il se croit. Chaque terme est nommé dans l'ordre de la
    // formule validée.
    var ligne = function (label, v) {
      return (Number(v) > 0) ? ('\n· ' + label + ' ' + fmtDh0(v) + ' DH') : '';
    };
    var aide = 'Coût CHARGÉ d\'une journée-homme (JH), moyenné sur la campagne '
      + (d.campagne || '') + '.'
      + '\nSalaire soumis à cotisation (barème Smart Berry) :'
      + ligne('salaire de base', det.salaire)
      + ligne('prime de fonction', det.primeFonction)
      + ligne('ancienneté', det.primeAnciennete)
      + ligne('heures sup', det.heuresSup)
      + ligne('jours fériés', det.feries)
      + '\nCharges sociales (déclarés) :'
      + ligne('patronales', det.chargesPatronales)
      // Part salariale : l'ouvrier étant payé sur le brut SANS retenue, ce que
      // la loi prélèverait sur son salaire est versé par la société.
      + ligne('CNSS + AMO salariales', det.cotisationsSalariales)
      + '\nPrimes de terrain (hors assiette) :'
      + ligne('transport', det.transport)
      + ligne('récolte', det.recolte)
      + ligne('traitement', det.traitement)
      + ligne('conditionnement', det.conditionnement)
      + ligne('chargement', det.chargement)
      + '\n\n' + fmtDh0(d.jh || 0) + ' JH (au sens BEE ONE, `Nombre_Jr`) — '
      + 'c\'est le dénominateur, celui qui valorise les budgets exprimés en JH.'
      + '\n' + fmtDh0(d.jours || 0) + ' journées calendaires pointées, sur '
      + 'lesquelles se calcule le salaire (un ouvrier pointé trois fois le '
      + 'même jour touche un jour).'
      + '\n' + (d.ouvriers || 0) + ' ouvriers, ' + (d.quinzaines || 0) + ' quinzaines'
      + (part ? ' · ' + part : '')
      + '\nHors pointage divers (sous-traitants).'
      + (Number(det.baseBeeOne) > 0
        ? '\nTémoin : ' + fmtDh0(det.baseBeeOne) + ' DH de coût BEE ONE sur la '
          + 'même période — BEE ONE ne fournit que les journées, le salaire '
          + 'vient du barème Smart Berry.'
        : '');
    return React.createElement('div', {
      title: aide,
      style: {
        display: 'flex', alignItems: 'baseline', gap: '8px',
        padding: '5px 14px', borderRadius: '16px',
        border: '1.5px solid ' + C.border, background: C.surface,
      },
    },
      React.createElement('span', {
        style: { fontSize: '11px', color: C.textSec, letterSpacing: '0.04em',
          textTransform: 'uppercase', fontWeight: 600 },
      }, 'Coût ouvrier chargé'),
      React.createElement('span', {
        style: { fontSize: '15px', fontWeight: 700, color: C.berry },
      }, fmtDh0(coutJour) + ' DH'),
      React.createElement('span', {
        style: { fontSize: '10px', color: C.textSec },
      }, '/ JH')
    );
  }());

  var repereIdeal = (partIdeale === null) ? null : React.createElement('div', {
    title: joursIdeal === null
      ? 'Part de la campagne écoulée depuis le 1er juillet.'
      : joursIdeal + ' jours écoulés depuis le 1er juillet, sur 365. Repère de '
        + 'rythme linéaire : à comparer au « % consommé » de chaque ligne.',
    style: {
      display: 'flex', alignItems: 'baseline', gap: '8px',
      padding: '5px 14px', borderRadius: '16px',
      border: '1.5px solid ' + C.border, background: C.surface,
    },
  },
    React.createElement('span', {
      style: { fontSize: '11px', color: C.textSec, letterSpacing: '0.04em',
        textTransform: 'uppercase', fontWeight: 600 },
    }, '% Budget idéal à ce jour'),
    React.createElement('span', {
      style: { fontSize: '15px', fontWeight: 700, color: C.berry },
    }, (Math.round(partIdeale * 1000) / 10).toFixed(1) + ' %'),
    joursIdeal === null ? null : React.createElement('span', {
      style: { fontSize: '10px', color: C.textSec },
    }, joursIdeal + ' j / 365')
  );

  /**
   * 1er juillet de la campagne affichée, ou `null`. La frontière a UNE source
   * (`CampagneUtils`) ; le libellé servi par le backend porte un slash, d'où
   * la normalisation du séparateur avant de l'interroger.
   */
  function debutCampagneISO() {
    var CU2 = CampagneUtils;
    if (!CU2 || typeof CU2.debutCampagne !== 'function' || !data.campagne) return null;
    var m = /^(\d{4})\D+(\d{4})$/.exec(String(data.campagne).trim());
    return m ? CU2.debutCampagne(m[1] + '-' + m[2]) : null;
  }

  /**
   * Référentiel BLOC ID (celui du DQR), tel que l'écran Qualité le configure.
   * Absent ou illisible → liste vide : les kilos ne seront simplement pas
   * rattachés à une parcelle, jamais rattachés au hasard.
   */
  function blocIdsRef() {
    try {
      var s = window.localStorage && window.localStorage.getItem('blocIdsConfig');
      var v = s ? JSON.parse(s) : null;
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  /**
   * Format d'un taux dont DÉPASSER LE BUDGET EST UNE BONNE NOUVELLE.
   *
   * Le « % consommé » d'un budget de JH vire au rouge au-delà de 100 % : on a
   * dépensé plus que prévu. La cadence de récolte, elle, se lit à l'envers —
   * 120 % du barème, c'est 120 % de la cadence attendue, donc une équipe qui
   * ramasse vite. Réutiliser `fmtPct` ici afficherait une alerte rouge sur la
   * meilleure nouvelle de l'écran.
   */
  /** Un montant en DH par kilo : deux décimales, comme un prix. */
  function fmtDh2(v) {
    return (Math.round(v * 100) / 100).toLocaleString('fr-MA', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  function fmtPctCadence(v) {
    var pct = Math.round(v * 1000) / 10;
    var style = { fontStyle: 'italic' };
    if (pct >= 100) style.color = '#2e7d32';
    return React.createElement('span', { style: style }, pct.toFixed(1) + ' %');
  }

  /**
   * Ligne de RENDEMENT en pied du bloc récolte, dans l'unité de la métrique
   * affichée : « Kg / JH » en JH (la cadence, barème 18 framboise / 30
   * myrtille), « DH / kg » en Coût DH (le coût au kilo, barème 7,50 / 4,50).
   *
   * Ce n'est ni une série ni une ligne famille : c'est un RAPPORT entre deux
   * grandeurs de nature différente (des kilos, des journées), qu'aucun total
   * de colonne ne doit sommer. D'où le passage par `piedsSupplementaires`,
   * avec des valeurs déjà formatées.
   *
   * PÉRIMÈTRE : les deux termes portent sur la CAMPAGNE affichée. Les kilos
   * d'un cycle divisés par les JH d'une campagne donneraient une cadence
   * fausse, et fausse dans le sens flatteur.
   *
   * Par parcelle, la valeur n'apparaît que si le bon porte sa parcelle (le
   * DQR porte le BLOC ID depuis cette campagne) ; sinon « — » et la cadence
   * est servie au niveau CULTURE, dans la colonne TOTAL — jamais un prorata
   * inventé sur les parcelles.
   */
  function lignesRendementRecolte(culture, rowsRecolte, parcellesGrille) {
    var CP = CampagneProduction;
    if (!CP || typeof CP.kgParParcelle !== 'function' || !props.bons) return [];
    var bareme = (CP.BAREME_KG_PAR_JH || {})[culture];
    if (!(bareme > 0)) return [];
    var debut = debutCampagneISO();
    if (!debut) return [];

    var cles = (parcellesGrille || []).map(function (p) { return p[0]; });
    var kg = CP.kgParParcelle({ bons: props.bons, blocIds: blocIdsRef(), cles: cles, debut: debut });
    // Total de la culture = somme des kilos RATTACHÉS à ses parcelles. Surtout
    // pas un total pris dans un autre référentiel (les blocs de production
    // portent encore le découpage de la campagne précédente) : la colonne
    // TOTAL doit être la somme des colonnes qu'elle coiffe, sinon elle les
    // contredit.
    var kgCulture = Object.keys(kg.parParcelle).reduce(function (s, c) {
      return s + kg.parParcelle[c];
    }, 0);

    var jhParParcelle = {};
    (rowsRecolte || []).forEach(function (row) {
      if (!row || row.type !== 'famille') return;
      Object.keys(row.pivot || {}).forEach(function (p) {
        var j = Number((row.pivot[p] || {}).jh);
        if (isFinite(j)) jhParParcelle[p] = (jhParParcelle[p] || 0) + j;
      });
    });
    var effort = CP.effortRecolte(rowsRecolte);
    var jhTotal = effort.jh;

    // ── EN COÛT DH, L'INDICATEUR N'EST PAS LE MÊME ────────────────────────
    // La cadence (kg/JH) répond à « à quelle vitesse récolte-t-on ? », le
    // coût au kilo à « combien nous coûte ce kilo ? ». Afficher une cadence
    // sous une colonne de dirhams n'aurait aucun sens, et le SENS DU TAUX
    // s'inverse avec elle : dépasser le barème de cadence est une bonne
    // nouvelle, dépasser le coût au kilo une mauvaise.
    if (!isJh) {
      var baremeDh = (CP.BAREME_DH_PAR_KG || {})[culture];
      if (!(baremeDh > 0)) return [];
      var coutParParcelle = {};
      (rowsRecolte || []).forEach(function (row) {
        if (!row || row.type !== 'famille') return;
        Object.keys(row.pivot || {}).forEach(function (p) {
          // Coût de récolte = JH de récolte × coût ouvrier chargé (cf. plus
          // haut : le `Cout` BEE ONE n'est pas une base de paie fiable).
          var j = Number((row.pivot[p] || {}).jh);
          if (isFinite(j)) coutParParcelle[p] = (coutParParcelle[p] || 0) + j * (coutJour || 0);
        });
      });
      // Le coût de récolte au kilo est lui aussi CHARGÉ : un DH/kg calculé sur
      // une base nue se comparerait à un barème qui, lui, couvre le coût réel.
      var coutRecolteCharge = effort.jh * (coutJour || 0);
      var trioDh = function (coutVal, kgVal) {
        // Pas de kilo rattaché → pas de coût au kilo. Un « 0 » y serait faux
        // dans les deux sens : ni gratuit, ni infiniment cher.
        if (!(kgVal > 0)) return [null, fmtDh2(baremeDh), null];
        var dhKg = coutVal / kgVal;
        return [fmtDh2(dhKg), fmtDh2(baremeDh), fmtPct(dhKg / baremeDh)];
      };
      var valeursDh = {};
      cles.forEach(function (c) {
        valeursDh[c] = trioDh(coutParParcelle[c] || 0, kg.parParcelle[c] || 0);
      });
      return [{
        key: 'dh-par-kg',
        label: 'DH / kg',
        aide: 'Coût de récolte au kilo sur la campagne, en regard du barème de '
          + baremeDh + ' DH/kg pour la ' + culture.toLowerCase()
          + '. Au-delà de 100 %, le kilo coûte plus cher que prévu. Par parcelle,'
          + ' la valeur n\'apparaît que là où le bon d\'apport porte sa parcelle.',
        valeurs: valeursDh,
        total: trioDh(coutRecolteCharge, kgCulture),
      }];
    }

    function trio(kgVal, jhVal) {
      // Deux « — » distincts, et aucun 0.0 :
      //  - pas de JH de récolte → la cadence n'existe pas encore ;
      //  - pas de kilo RATTACHÉ à cette parcelle → on ne sait pas ce qu'elle
      //    a ramené, ce n'est pas la même chose que « elle n'a rien ramené ».
      //    Un 0.0 kg/JH accuserait une équipe d'un défaut de rattachement.
      if (!(jhVal > 0) || !(kgVal > 0)) return [null, fmtJh1(bareme), null];
      var cadence = kgVal / jhVal;
      return [fmtJh1(cadence), fmtJh1(bareme), fmtPctCadence(cadence / bareme)];
    }

    var valeurs = {};
    cles.forEach(function (c) {
      valeurs[c] = trio(kg.parParcelle[c] || 0, jhParParcelle[c] || 0);
    });
    return [{
      key: 'kg-par-jh',
      label: 'Kg / JH',
      aide: 'Cadence de récolte sur la campagne : kilos récoltés par journée-homme'
        + ' de récolte, en regard du barème de ' + bareme + ' kg/JH pour la '
        + culture.toLowerCase() + '. Au-delà de 100 %, on récolte plus vite que'
        + ' prévu. Par parcelle, la cadence n\'apparaît que là où le bon d\'apport'
        + ' porte sa parcelle.',
      valeurs: valeurs,
      total: trio(kgCulture, jhTotal),
    }];
  }

  /**
   * PANNEAU DE RAPPROCHEMENT — écran Quinzaine ↔ écran Campagne.
   *
   * Deux chemins additionnent la même main d'œuvre : la grille agrège le
   * pointage PAR PARCELLE (une ligne dont la parcelle ou la culture ne se
   * résout pas n'y entre pas), le coût ouvrier part du pointage BRUT. Leur
   * écart mesure donc exactement ce que la grille NE VOIT PAS — un trou qui
   * ne se signale jamais tout seul, parce qu'un total plus petit reste un
   * total plausible.
   *
   * Affiché sous les grilles, toutes cultures confondues : c'est un contrôle
   * de couverture, pas une lecture par culture.
   */
  /**
   * Ventilation POSTE PAR POSTE du coût chargé, quinzaine par quinzaine.
   *
   * Le tableau principal dit COMBIEN manque ; celui-ci dit OÙ. Sans lui, un
   * poste absent ne se lit que comme un ratio par JH trop bas — 117 DH contre
   * 136 sur la Quinzaine 01 — et il faut ouvrir le code pour savoir lequel.
   * Chaque ligne se compare directement à la tuile de même nom sur l'écran
   * Quinzaine : un zéro en face d'une tuile non nulle est la réponse.
   */
  function tableauPostes(rap) {
    var avec = rap.lignes.filter(function (l) { return l.ecartPostes; });
    if (!avec.length) return null;

    var dh = function (v) { return Math.round(v).toLocaleString('fr-MA'); };
    var th = { padding: '5px 10px', textAlign: 'right', fontSize: '10px',
      color: C.textSec, fontWeight: 600, borderBottom: '1px solid ' + C.border };
    var thL = Object.assign({}, th, { textAlign: 'left' });
    var td = { padding: '5px 10px', textAlign: 'right', fontSize: '11px' };
    var tdL = Object.assign({}, td, { textAlign: 'left', color: C.textSec });

    // Les postes sont les mêmes d'une quinzaine à l'autre : on prend l'ordre
    // de la première ligne comme référence.
    var cles = avec[0].ecartPostes.map(function (p) { return p.cle; });
    var libelles = {};
    avec[0].ecartPostes.forEach(function (p) { libelles[p.cle] = p.libelle; });

    function poste(l, cle) {
      var p = (l.ecartPostes || []).filter(function (x) { return x.cle === cle; })[0];
      return p || { campagne: 0, quinzaine: 0, ecart: 0 };
    }

    return React.createElement('div', { style: { overflowX: 'auto',
      borderTop: '1px solid ' + C.border } },
      React.createElement('div', { style: { padding: '8px 16px 2px',
        fontSize: '11px', fontWeight: 700, color: C.textSec } },
        'D\'OÙ VIENT L\'ÉCART — par poste, quinzaine par quinzaine'),
      React.createElement('div', { style: { padding: '0 16px 6px',
        fontSize: '10px', color: C.textSec } },
        'Les deux ventilations ne se correspondent pas terme à terme : la '
          + 'campagne décompose en salaire / prime de fonction / ancienneté, '
          + 'l\'écran Quinzaine en MO Récolte / Hors Récolte / Postes Fixes. '
          + 'Aligner ces lignes-là serait inventer une correspondance. Seules '
          + 'les primes de terrain et les heures sup ont la même définition '
          + 'des deux côtés ; tout le reste se déduit par différence des '
          + 'totaux — ce qui garantit que la ventilation boucle exactement '
          + 'sur l\'écart affiché.'),
      React.createElement('table', {
        style: { width: '100%', borderCollapse: 'collapse', fontSize: '11px' },
      },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', { style: thL }, 'Poste'),
            avec.map(function (l) {
              return React.createElement('th', { key: l.periode, style: th,
                colSpan: 3 }, l.periode);
            })
          ),
          React.createElement('tr', null,
            React.createElement('th', { style: thL }, ''),
            avec.map(function (l) {
              return [
                React.createElement('th', { key: l.periode + 'c', style: th }, 'campagne'),
                React.createElement('th', { key: l.periode + 'q', style: th }, 'quinzaine'),
                React.createElement('th', { key: l.periode + 'e', style: th }, 'écart'),
              ];
            })
          )
        ),
        React.createElement('tbody', null, cles.map(function (cle, i) {
          var estReste = cle === 'salaires';
          return React.createElement('tr', { key: cle,
            style: { background: i % 2 ? C.surface2 : C.surface,
              borderTop: estReste ? '1px solid ' + C.border : 'none' } },
            React.createElement('td', { style: Object.assign({}, tdL,
              estReste ? { fontWeight: 700, color: C.text } : {}) }, libelles[cle]),
            avec.map(function (l) {
              var p = poste(l, cle);
              // Un écart nul se met en retrait : ce sont les lignes NON nulles
              // qu'on cherche, et les faire ressortir évite de relire douze
              // nombres pour trouver le seul qui compte.
              var nul = Math.abs(p.ecart) < 1;
              return [
                React.createElement('td', { key: l.periode + 'c',
                  style: Object.assign({}, td, { color: C.textSec }) }, dh(p.campagne)),
                React.createElement('td', { key: l.periode + 'q',
                  style: Object.assign({}, td, { color: C.textSec }) }, dh(p.quinzaine)),
                React.createElement('td', { key: l.periode + 'e',
                  style: Object.assign({}, td, nul
                    ? { color: C.textSec, opacity: 0.4 }
                    : { color: '#c0392b', fontWeight: 700 }) },
                  nul ? '0' : dh(p.ecart)),
              ];
            })
          );
        }))
      )
    );
  }

  function panneauRapprochement() {
    var CRap = CampagneRapprochement;
    var pq = props.coutOuvrier && props.coutOuvrier.parQuinzaine;
    if (!CRap || typeof CRap.rapprocher !== 'function' || !pq || !pq.length) return null;
    var rap = CRap.rapprocher({ parQuinzaine: pq, rows: data.rows,
      snapshots: props.snapQuinz });
    if (!rap.lignes.length) return null;

    var dh = function (v) { return Math.round(v).toLocaleString('fr-MA'); };
    var pct = function (v) {
      return v === null ? '—' : (Math.round(v * 1000) / 10).toFixed(1) + ' %';
    };
    // Seuil de tolérance : sous 0,5 %, l'écart relève de l'arrondi et du
    // décalage de synchronisation, pas d'un trou de périmètre.
    var alerte = function (v) { return v !== null && Math.abs(v) >= 0.005; };

    var th = { padding: '6px 10px', textAlign: 'right', fontSize: '10px',
      color: C.textSec, fontWeight: 600, borderBottom: '1px solid ' + C.border };
    var thL = Object.assign({}, th, { textAlign: 'left' });
    var td = { padding: '6px 10px', textAlign: 'right', fontSize: '12px' };
    var tdL = Object.assign({}, td, { textAlign: 'left', fontWeight: 600 });

    return React.createElement('div', {
      style: { marginBottom: '20px', background: C.surface, borderRadius: '12px',
        border: '1px solid ' + C.border, overflow: 'hidden' },
    },
      React.createElement('div', {
        style: { padding: '10px 16px', background: C.surface2,
          borderBottom: '1px solid ' + C.border, display: 'flex',
          alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      },
        React.createElement('i', { className: 'fa-solid fa-scale-balanced',
          style: { color: C.textSec, fontSize: '13px' } }),
        React.createElement('span', { style: { fontSize: '13px', fontWeight: 700 } },
          'Rapprochement pointage ↔ grille'),
        React.createElement('span', {
          style: { fontSize: '11px', color: alerte(rap.ecartPct) ? '#c0392b' : C.textSec,
            fontWeight: alerte(rap.ecartPct) ? 700 : 400 },
        }, 'écart total ' + dh(rap.ecart) + ' DH (' + pct(rap.ecartPct) + ')'),
        // Dire ce qui n'est PAS comparé. Un total qui paraît complet alors
        // qu'il laisse des quinzaines de côté est pire qu'un total absent.
        (rap.sansSnapshot && rap.sansSnapshot.length)
          ? React.createElement('span', {
            style: { fontSize: '11px', color: '#c0392b', fontWeight: 600 },
            title: 'Ouvrir l\'écran Quinzaine sur ces périodes enregistre leur '
              + 'coût et les fait entrer dans le rapprochement.',
          }, rap.sansSnapshot.length + ' quinzaine(s) hors comparaison — '
            + rap.sansSnapshot.join(', '))
          : null
      ),
      React.createElement('div', { style: { overflowX: 'auto' } },
        React.createElement('table', {
          style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
        },
          React.createElement('thead', null,
            React.createElement('tr', { style: { background: C.surface2 } },
              React.createElement('th', { style: thL }, 'Quinzaine'),
              React.createElement('th', { style: th, title: 'Journées-homme du pointage (les demi-journées comptent 0,5).' }, 'JH'),
              React.createElement('th', { style: th, title: 'JH de l\'écran Quinzaine. Un écart ici est un écart de PÉRIMÈTRE — à régler avant de regarder les dirhams.' }, 'JH Quinz.'),
              React.createElement('th', { style: th, title: 'Coût CHARGÉ agrégé par parcelle : Σ (JH × taux de l\'ouvrier), tel que la grille ci-dessus l\'additionne.' }, 'Grille chargée'),
              React.createElement('th', { style: th, title: 'Coût chargé ouvrier ENREGISTRÉ PAR l\'écran Quinzaine — pas recalculé ici. « — » signifie que personne n\'a ouvert cette quinzaine depuis la mise en service.' }, 'Quinzaine chargée'),
              React.createElement('th', { style: th }, 'Écart'),
              React.createElement('th', { style: th }, '%'),
              React.createElement('th', { style: Object.assign({}, th, { color: C.textSec }),
                title: 'Net à payer de l\'écran Quinzaine — À NE PAS rapprocher du coût chargé : '
                  + 'il exclut les charges sociales (qui vont à la CNSS) et inclut la sous-traitance. '
                  + 'Affiché ici parce que c\'est le chiffre qu\'on lit spontanément sur la Quinzaine.',
              }, 'Net à payer (info)'),
              React.createElement('th', { style: th, title: 'JH pointés dont l\'ouvrier n\'a pas de fiche de paie : ils comptent en volume, mais à coût nul.' }, 'JH sans taux'),
              React.createElement('th', { style: th, title: 'Total du calcul CAMPAGNE, avant passage par la parcelle. Son écart avec la « Grille chargée » mesure ce que la grille ne rattache pas.' }, 'Campagne (calc.)')
            )
          ),
          React.createElement('tbody', null, rap.lignes.map(function (l, i) {
            return React.createElement('tr', { key: l.periode,
              style: { background: i % 2 ? C.surface2 : C.surface,
                borderBottom: '1px solid var(--gray-100)' } },
              React.createElement('td', { style: tdL }, l.periode),
              React.createElement('td', { style: Object.assign({}, td, { color: C.textSec }) },
                (Math.round(l.jh * 10) / 10).toLocaleString('fr-MA')),
              React.createElement('td', {
                style: Object.assign({}, td, {
                  // Un écart de PÉRIMÈTRE se règle avant de discuter des
                  // dirhams : comparer deux totaux qui ne portent pas sur les
                  // mêmes journées ne veut rien dire.
                  color: (l.joursQuinzaine !== null && Math.abs(l.joursQuinzaine - l.jh) > 0.5)
                    ? '#c0392b' : C.textSec,
                  fontWeight: (l.joursQuinzaine !== null && Math.abs(l.joursQuinzaine - l.jh) > 0.5)
                    ? 700 : 400,
                }),
              }, l.joursQuinzaine === null ? '—'
                : (Math.round(l.joursQuinzaine * 10) / 10).toLocaleString('fr-MA')),
              React.createElement('td', { style: td }, dh(l.grille)),
              React.createElement('td', { style: Object.assign({}, td, { fontWeight: 700 },
                l.quinzaine === null ? { color: C.textSec, fontWeight: 400 } : {}) },
                l.quinzaine === null ? '—' : dh(l.quinzaine)),
              React.createElement('td', {
                style: Object.assign({}, td, {
                  color: alerte(l.ecartPct) ? '#c0392b' : C.textSec,
                  fontWeight: alerte(l.ecartPct) ? 700 : 400,
                }),
              }, l.ecart === null ? '—' : dh(l.ecart)),
              React.createElement('td', {
                style: Object.assign({}, td, {
                  color: alerte(l.ecartPct) ? '#c0392b' : C.textSec,
                }),
              }, pct(l.ecartPct)),
              React.createElement('td', { style: Object.assign({}, td, {
                color: C.textSec, fontStyle: 'italic' }) },
                l.netQuinzaine === null ? '—' : dh(l.netQuinzaine)),
              React.createElement('td', {
                style: Object.assign({}, td, {
                  color: l.jhSansTaux > 0 ? '#c0392b' : C.textSec,
                  fontWeight: l.jhSansTaux > 0 ? 700 : 400,
                }),
              }, l.jhSansTaux > 0
                ? (Math.round(l.jhSansTaux * 10) / 10).toLocaleString('fr-MA') : '—'),
              React.createElement('td', { style: Object.assign({}, td, { color: C.textSec }) },
                dh(l.campagne))
            );
          })),
          React.createElement('tfoot', null,
            React.createElement('tr', { style: { background: C.surface2, fontWeight: 700 } },
              React.createElement('td', { style: tdL }, 'TOTAL'),
              React.createElement('td', { style: td }, ''),
              React.createElement('td', { style: td }, ''),
              React.createElement('td', { style: td }, dh(rap.totalGrilleComparable)),
              React.createElement('td', { style: td }, dh(rap.totalQuinzaine)),
              React.createElement('td', { style: td }, dh(rap.ecart)),
              React.createElement('td', { style: td }, pct(rap.ecartPct)),
              React.createElement('td', { style: td }, ''),
              React.createElement('td', { style: td },
                rap.totalJhSansTaux > 0
                  ? (Math.round(rap.totalJhSansTaux * 10) / 10).toLocaleString('fr-MA') : '—'),
              React.createElement('td', { style: td }, dh(rap.lignes.reduce(
                function (s, l) { return s + l.campagne; }, 0)))
            )
          )
        )
      ),
      tableauPostes(rap),
      React.createElement('div', {
        style: { padding: '6px 14px 10px', fontSize: '10px', color: C.textSec,
          borderTop: '1px solid var(--gray-100)' },
      },
        React.createElement('i', { className: 'fa-solid fa-circle-info',
          style: { marginRight: '6px' } }),
        'La colonne « Quinzaine chargée » est le total ENREGISTRÉ par l\'écran '
          + 'Quinzaine — il n\'est pas recalculé ici. C\'est délibéré : trois '
          + 'tentatives de le reproduire ont produit trois divergences, et un '
          + 'écart entre deux implémentations ne dit rien. « — » signifie que '
          + 'personne n\'a ouvert cette quinzaine depuis la mise en service : '
          + 'ouvrir l\'écran Quinzaine sur cette période suffit à l\'enregistrer. '
          + 'La grille, elle, agrège le pointage PAR PARCELLE : une ligne dont la '
          + 'parcelle ou la culture ne se résout pas n\'y entre pas. L\'écart est '
          + 'donc en dirhams réels — à zéro, la grille montre tout l\'argent. Les '
          + '« JH sans taux » (ouvriers sans fiche de paie) en sont la première '
          + 'cause : ils pèsent en volume, rien en coût. Le pointage divers '
          + '(sous-traitants) reste hors des deux chemins.'
      )
    );
  }

  /** Bouton plein écran d'UNE grille de culture (posé sur son bandeau). */
  function boutonPlein(i) {
    return React.createElement('button', {
      onClick: function () {
        if (enPlein) { setFullscreen(false); return; }
        setCultureIdx(i);
        setFullscreen(true);
      },
      title: enPlein ? 'Quitter le plein écran' : 'Plein écran',
      style: {
        position: 'absolute', top: '8px', right: '10px', zIndex: 2,
        padding: '4px 10px', borderRadius: '6px', border: '1px solid ' + C.border,
        background: C.surface, cursor: 'pointer', fontSize: '12px', color: C.textSec,
      },
    }, React.createElement('i', { className: enPlein ? 'fa-solid fa-compress' : 'fa-solid fa-expand' }));
  }

  return React.createElement('div', {
    // L'overlay porte la barre de bascules ET la grille : en plein écran, on
    // doit pouvoir basculer Ha/Total ou Récap/Détail sans en ressortir.
    style: enPlein
      ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: '#fff', overflowY: 'auto', padding: '16px' }
      : null,
  },
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' },
    },
      React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Afficher :'),
      CAT_pills([['jh', 'JH'], ['cout', 'Coût DH']], metric, setMetric, 'm-'),
      React.createElement('span', { style: { width: '8px' } }),
      CAT_pills([['ha', 'Par Ha'], ['total', 'Total']], totalMode ? 'total' : 'ha',
        function (v) { setTotalMode(v === 'total'); }, 't-'),
      React.createElement('span', { style: { width: '8px' } }),
      CAT_pills([['recap', 'Récap'], ['detail', 'Détail']], detailMode ? 'detail' : 'recap',
        function (v) { setDetailMode(v === 'detail'); }, 'd-'),
      // Poussés à droite par `marginLeft: auto` : les repères ne sont pas des
      // bascules, ils ne se rangent pas avec elles.
      (repereCout || repereIdeal) ? React.createElement('div', {
        style: { marginLeft: 'auto', display: 'flex', alignItems: 'center',
          gap: '8px', flexWrap: 'wrap' },
      }, repereCout, repereIdeal) : null,
      // Bascule ANNUEL ↔ QUINZAINE : proposée seulement quand elle mène
      // quelque part (JH + au moins un engagement saisi sur la quinzaine
      // affichée). Sinon elle n'ouvrirait qu'une grille de « — ».
      quinzaineDispo ? React.createElement(React.Fragment, null,
        React.createElement('span', { style: { width: '8px' } }),
        CAT_pills([['annuel', 'Annuel'], ['quinzaine', 'Quinzaine']],
          enQuinzaine ? 'quinzaine' : 'annuel',
          function (v) { setVueQuinzaine(v === 'quinzaine'); }, 'q-')
      ) : null,
      // Sélecteur de quinzaine : la quinzaine en cours par défaut, mais une
      // quinzaine passée doit rester consultable (c'est le seul moyen de
      // relire un engagement tenu ou raté).
      enQuinzaine ? React.createElement('select', {
        value: quinzaineActive,
        onChange: function (e) { setQuinzaineSel(e.target.value); },
        style: {
          border: '1px solid var(--gray-200)', borderRadius: '8px',
          padding: '5px 8px', fontSize: '12px', outline: 'none',
        },
      }, quinzaineOptions.map(function (o) {
        return React.createElement('option', { key: o.key, value: o.key },
          o.label + (o.key === quinzaineCourante ? ' (en cours)' : ''));
      })) : null
    ),
    detailCell
      ? React.createElement(CAT_DetailPopup, { cell: detailCell, onClose: function () { setDetailCell(null); } })
      : null,
    parcelleZoom
      ? React.createElement(CAT_ParcelleQuinzainePopup, {
        parcelle: parcelleZoom.parcelle,
        label: parcelleZoom.label,
        ha: parcelleZoom.ha,
        color: parcelleZoom.color,
        rows: data.rows,
        // Unités de l'écran : la pop-up prolonge la lecture en cours plutôt
        // que de repartir d'un défaut.
        metric: metric,
        totalMode: totalMode,
        coutJour: coutJour,
        onClose: function () { setParcelleZoom(null); },
      })
      : null,
    // Carrousel de cultures — MÊME geste que le panneau Affectation
    // Analytique de l'écran Quinzaine : deux chevrons qui bouclent, et une
    // pastille par culture (aux couleurs de la culture) pour y aller
    // directement. Affiché en plein écran seulement : hors plein écran,
    // toutes les grilles sont déjà là, naviguer n'aurait aucun sens.
    (enPlein && groups.length > 1) ? React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '12px', marginBottom: '12px', flexWrap: 'wrap' },
    },
      React.createElement('button', {
        onClick: function () { setCultureIdx((idxCulture - 1 + groups.length) % groups.length); },
        title: 'Culture précédente',
        style: { padding: '6px 14px', borderRadius: '8px', border: '1px solid ' + C.border,
          background: C.surface, cursor: 'pointer', fontSize: '14px' },
      }, React.createElement('i', { className: 'fa-solid fa-chevron-left' })),
      groups.map(function (g, i) {
        return React.createElement('button', {
          key: g.culture,
          onClick: function () { setCultureIdx(i); },
          style: {
            padding: '5px 14px', borderRadius: '8px',
            border: '1.5px solid ' + (i === idxCulture ? g.color : C.border),
            background: i === idxCulture ? g.color : C.surface,
            color: i === idxCulture ? '#fff' : C.textSec,
            fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          },
        },
          React.createElement('i', { className: 'fa-solid ' + g.icon, style: { marginRight: '5px' } }),
          g.culture
        );
      }),
      React.createElement('button', {
        onClick: function () { setCultureIdx((idxCulture + 1) % groups.length); },
        title: 'Culture suivante',
        style: { padding: '6px 14px', borderRadius: '8px', border: '1px solid ' + C.border,
          background: C.surface, cursor: 'pointer', fontSize: '14px' },
      }, React.createElement('i', { className: 'fa-solid fa-chevron-right' }))
    ) : null,
    // Contrôle de couverture, affiché sous les grilles — jamais en plein
    // écran, où l'on vient lire une culture, pas auditer un périmètre.
    enPlein ? null : panneauRapprochement(),
    groups.length === 0
      ? React.createElement('div', {
          style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' },
        }, 'Aucune donnée pour cette sélection.')
      : groupesAffiches.map(function (g) {
          var pivot = AU.buildAnalytiquePivotByFamille(g.rows, { detail: detailMode });
          if (!pivot.groupedRows || pivot.groupedRows.length === 0) return null;
          // Superposition du budget : lignes IDENTIQUES (mêmes clés, même
          // ordre), plus les familles/opérations budgétées mais jamais
          // travaillées — un budget non consommé doit rester visible.
          // Modules absents (script non chargé) → réalisé seul, jamais un
          // budget deviné.
          var CBP = CampagneBudgetPivot;
          var rules = CampagneBudgetTab;
          var budgetArgs = {
            parcelles: pivot.parcelles,
            budgetsByLabel: props.budgetsByLabel || {},
            opBudgetsByLabel: props.opBudgetsByLabel || {},
            analytique: AU,
            budgetRules: rules,
          };
          // Superposition du budget construite dans LES DEUX métriques, alors
          // que les sous-colonnes de budget, elles, restent réservées au JH.
          // Ce ne sont pas les mêmes choses : la superposition ajoute les
          // LIGNES budgétées mais jamais travaillées, et en Coût DH la Récolte
          // n'en a pas d'autre (son réalisé est nul tant que la saison n'a pas
          // commencé, et le backend ne sert que les lignes ayant du réalisé).
          // Sans elle, le bloc récolte disparaissait purement et simplement en
          // Coût DH — alors qu'il est là en JH.
          var sup = (CBP && typeof CBP.buildBudgetPivot === 'function' && rules)
            ? CBP.buildBudgetPivot(Object.assign({
                groupedRows: pivot.groupedRows,
                detail: detailMode,
              }, budgetArgs))
            : null;
          // VUE QUINZAINE : mêmes lignes, mêmes clés, mêmes colonnes — seules
          // les séries changent. Le budget de quinzaine passe par le MÊME
          // indexeur que le budget annuel (résolution famille → code GB), avec
          // la tranche de la quinzaine affichée : aucune jointure parallèle.
          // `rules` (CampagneBudgetTab) porte la règle métier injectée dans
          // l'indexeur : sans elle, pas d'index — jamais un budget deviné.
          var quinz = (enQuinzaine && CBQ && rules
            && CBP && typeof CBP.indexBudgets === 'function')
            ? CBQ.decoreQuinzaine({
                groupedRows: sup ? sup.groupedRows : pivot.groupedRows,
                parcelles: pivot.parcelles,
                num: CBQ.quinzaineNum(quinzaineActive),
                budgetIndex: CBP.indexBudgets(Object.assign({}, budgetArgs, {
                  budgetsByLabel: CBQ.trancheQuinzaine(quinzainesByLabel, quinzaineActive),
                  opBudgetsByLabel: {},
                })),
              })
            : null;
          // Séries réellement affichées : elles décident AUSSI de la colonne
          // Total (cf. `showTotal` plus bas), d'où l'extraction en variable.
          // Sous-colonnes de budget : en JH toujours, en Coût DH seulement
          // quand le coût ouvrier chargé est connu (sinon le budget n'a pas
          // de traduction en dirhams, et un budget nul afficherait un
          // dépassement infini sur chaque ligne).
          var metricsAffichees = quinz
            ? metricsQuinzaine
            : (((isJh || coutJour !== null) && sup && sup.hasBudget) ? metricsBudget : metrics);
          var rowsAffichees = quinz
            ? quinz.groupedRows
            : (sup ? sup.groupedRows : pivot.groupedRows);
          // ── RÉCOLTE À PART ──────────────────────────────────────────
          // Partout, plein écran ou non : la récolte sortie du tableau change
          // le sens de son TOTAL (qui devient le total HORS récolte), et ce
          // sens ne peut pas dépendre d'un bouton d'affichage.
          // Les DEUX grilles reçoivent les mêmes `parcelles`, les mêmes
          // `metrics` et les mêmes largeurs de colonnes : c'est ce qui permet
          // de lire le bloc Récolte en vis-à-vis du principal, colonne par
          // colonne.
          var partition = CAT_partitionRecolte(rowsAffichees, GROUPE_RECOLTE);
          function _aDesFamilles(rows) {
            return rows.some(function (r) { return r && r.type === 'famille'; });
          }
          var aRecolte = _aDesFamilles(partition.recolte);
          // Une culture qui n'a QUE de la récolte (l'avocatier, la myrtille en
          // début de campagne) ne doit pas hériter d'un tableau principal vide
          // au-dessus de son bloc récolte : un tableau sans une seule ligne se
          // lit comme des données manquantes.
          var aPrincipal = _aDesFamilles(partition.principal);
          var propsCommunes = {
            parcelles: pivot.parcelles,
            metrics: metricsAffichees,
            color: g.color,
            // Totaux dans les bandeaux de section : même arbitrage de largeur
            // que la colonne Total et que la colonne « Budget idéal ».
            chiffresGroupe: enPlein,
            // Deux grilles empilées par culture (hors récolte / récolte) :
            // sans largeurs déterministes, chacune se dimensionne sur SON
            // contenu et les colonnes ne tombent plus en face. Vrai dans
            // toutes les vues, y compris en Coût DH où il n'y a qu'une série.
            largeursFixes: true,
            // …et elles coulissent ensemble : deux tableaux de mêmes colonnes
            // qui défilent séparément font lire une parcelle pour une autre.
            scrollGroup: 'campagne-' + g.culture,
            // Colonne TOTAL en plein écran, quel que soit le nombre de séries.
            // Elle était conditionnée à « plusieurs séries » : l'Avocatier,
            // jamais budgété, n'en a qu'une et se retrouvait donc SANS total
            // là où la Framboise et la Myrtille en avaient un — une culture
            // dont on ne peut pas lire le cumul alors que ses voisines si.
            // À une seule série, la colonne reprend son rendu historique
            // (empilé, collé à droite), celui de l'écran Quinzaine.
            showTotal: enPlein,
            parcelleLabel: function (k) { return sbNom(k, sbMap); },
            onCellClick: function (c) {
              setDetailCell(Object.assign({ parcelleLabel: sbNom(c.parcelle, sbMap) }, c));
            },
            // Clic sur l'en-tête d'une parcelle → sa ventilation par
            // quinzaine. La couleur de la culture voyage avec, pour que la
            // pop-up se rattache visuellement à la grille d'où elle sort.
            onParcelleClick: function (cle, haCol) {
              setParcelleZoom({ parcelle: cle, ha: haCol, color: g.color,
                label: sbNom(cle, sbMap) });
            },
          };
          // Chaque grille est encapsulée pour porter SON bouton plein écran,
          // posé sur son bandeau de titre (position absolue) : c'est la
          // culture qu'on regarde qu'on veut agrandir, pas « la première ».
          return React.createElement('div', {
            key: g.culture,
            style: { position: 'relative' },
          },
            boutonPlein(groups.indexOf(g)),
            aPrincipal ? React.createElement(Grid, Object.assign({}, propsCommunes, {
            groupedRows: partition.principal,
            // Le périmètre du budget n'est PAS déductible des chiffres
            // affichés (un « % consommé » à 130 % sur une ligne dont la
            // moitié des familles n'est pas budgétée se lit comme une erreur
            // de calcul) : il reste énoncé sous la grille.
            note: quinz
              ? CBQ.noteQuinzaine(quinzaineInfoSel || { key: quinzaineActive },
                  quinzaineActive === quinzaineCourante)
              : ((sup && sup.hasBudget) ? noteBudgetSeul : null),
            title: aRecolte ? g.culture + ' — hors récolte' : g.culture,
            icon: g.icon,
            })) : null,
            aRecolte ? React.createElement(Grid, Object.assign({}, propsCommunes, {
              groupedRows: partition.recolte,
              title: g.culture + ' — récolte',
              icon: g.icon,
              // Un second « TOTAL » sous celui du tableau du dessus se lirait
              // comme le total général de l'écran.
              labelPied: 'TOTAL RÉCOLTE',
              piedsSupplementaires: lignesRendementRecolte(g.culture, partition.recolte,
                pivot.parcelles),
              // Le lecteur doit savoir POURQUOI ce bloc est à part, sinon il
              // le lit comme un oubli du tableau du dessus.
              note: 'Récolte présentée à part : son budget n\'est consommé qu\'en '
                + 'saison, le laisser dans le tableau ci-dessus écrasait le TOTAL '
                + '(le « % consommé » global tombait à quelques pour cent). Le TOTAL '
                + 'du tableau ci-dessus est donc le total HORS récolte.',
            })) : null,
          );
        })
  );
}

export { CAT_pctPartsAnnuel, CAT_partitionRecolte, CAT_pillStyle, CAT_pills, CAT_ParcelleQuinzainePopup, CAT_DetailPopup, PivotView };
