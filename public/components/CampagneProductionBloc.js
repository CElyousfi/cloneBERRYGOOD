/*
 * CampagneProductionBloc.jsx — bloc PRODUCTION (kg) sous la grille MO de
 * l'écran Campagne, et la VITESSE DE RÉCOLTE qui le relie à cette grille.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. mémoire projet umd-global-collision-smoke-load). Un seul global :
 *   window.CampagneProductionBloc
 *
 * ── D'OÙ VIENNENT LES CHIFFRES ─────────────────────────────────────────────
 * Les kilos viennent de la MÊME source que l'onglet Production : les bons
 * d'apport de la collection `pfq_interne`, lus par `window.loadBonsFromFirestore`
 * (app.jsx, cache mémoire 2 min partagé avec cet onglet). Deux écrans, une
 * seule lecture, donc jamais deux totaux différents pour la même journée.
 *
 * ── DEUX PÉRIMÈTRES, ASSUMÉS ET ÉCRITS À L'ÉCRAN ───────────────────────────
 *  - le tableau par bloc suit l'onglet Production : Export, cycle en cours ;
 *  - la vitesse de récolte suit la CAMPAGNE affichée au-dessus, pour ses DEUX
 *    termes (kilos et JH). Mélanger les deux — des kilos de cycle divisés par
 *    des JH de campagne — donnerait un ratio faux d'un facteur qui dépend du
 *    calendrier, et faux dans le sens rassurant.
 * Tant que la campagne n'a pas de récolte pointée, la vitesse affiche « — » :
 * « pas encore de récolte » n'est pas « récolte improductive ».
 */
(function () {
  'use strict';

  var _cpb_R = window.React;
  if (!_cpb_R) return;
  var _cpb_h = _cpb_R.createElement;
  var _cpb_useState = _cpb_R.useState;
  var _cpb_useEffect = _cpb_R.useEffect;
  var _CPB_C = {
    border: 'var(--gray-200)',
    surface: '#fff',
    surface2: 'var(--gray-50)',
    text: 'var(--gray-700)',
    textSec: 'var(--gray-500)'
  };
  function _cpb_nb(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)).toLocaleString('fr-MA', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec
    });
  }

  /** Tuile d'un indicateur de vitesse. `null` → « — » et une raison en survol. */
  function _cpb_tuile(label, valeur, unite, aide, couleur) {
    return _cpb_h('div', {
      key: label,
      title: aide,
      style: {
        flex: '1 1 160px',
        padding: '10px 14px',
        borderRadius: 10,
        border: '1px solid ' + _CPB_C.border,
        background: _CPB_C.surface2
      }
    }, _cpb_h('div', {
      style: {
        fontSize: 10,
        color: _CPB_C.textSec,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em'
      }
    }, label), _cpb_h('div', {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        marginTop: 2
      }
    }, _cpb_h('span', {
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: couleur
      }
    }, valeur === null ? '—' : valeur), _cpb_h('span', {
      style: {
        fontSize: 10,
        color: _CPB_C.textSec
      }
    }, unite)));
  }

  /**
   * @param {Object} props
   * @param {string} props.culture culture de la grille au-dessus (filtre les blocs).
   * @param {string} props.color couleur de la culture.
   * @param {Array<Object>} props.rowsRecolte lignes du pivot du bloc Récolte —
   *        source des JH et du coût de récolte de la campagne affichée.
   * @param {string} props.campagne libellé de la campagne affichée.
   */
  function CampagneProductionBloc(props) {
    var culture = props.culture || '';
    var color = props.color || 'var(--berry)';
    var _bons = _cpb_useState(null);
    var bons = _bons[0];
    var setBons = _bons[1];
    var _erreur = _cpb_useState(null);
    var erreur = _erreur[0];
    var setErreur = _erreur[1];
    _cpb_useEffect(function () {
      var vivant = true;
      // Garde anti-crash : une référence à un global absent fait planter TOUT
      // le rendu React (mémoire projet « tab bare global ref »).
      if (typeof window.loadBonsFromFirestore !== 'function') {
        setErreur('module de lecture des bons d\'apport indisponible');
        return undefined;
      }
      window.loadBonsFromFirestore().then(function (b) {
        if (vivant) setBons(b || []);
      }).catch(function (e) {
        if (vivant) setErreur(String(e && e.message || e));
      });
      return function () {
        vivant = false;
      };
    }, []);
    var CP = window.CampagneProduction;
    if (!CP || typeof CP.agregeBlocs !== 'function') return null;
    var blocs = (window.PARCELLES_CULTURALES || []).filter(function (pc) {
      return pc && (!culture || pc.culture === culture);
    });

    // TABLEAU — périmètre de l'onglet Production : export, cycle en cours.
    var cycleOf = window.getCycle;
    var cycle = typeof cycleOf === 'function' ? cycleOf(new Date().toISOString()) : null;
    var agg = bons && cycle !== null ? CP.agregeBlocs({
      bons: bons,
      blocs: blocs,
      cycle: cycle,
      cycleOf: cycleOf
    }) : null;

    // VITESSE — périmètre de la CAMPAGNE affichée, pour ses deux termes. Le
    // 1er juillet vient de CampagneUtils (source unique de la frontière) ; sans
    // lui, pas de fenêtre, donc pas de kilos de campagne — jamais une fenêtre
    // devinée qui ferait passer les kilos de la saison précédente pour ceux
    // d'aujourd'hui.
    var CU = window.CampagneUtils;
    var debut = CU && typeof CU.debutCampagne === 'function' && props.campagne ? CU.debutCampagne(String(props.campagne).replace(/[^0-9]+/, '-')) : null;
    var aggCampagne = bons && debut ? CP.agregeBlocs({
      bons: bons,
      blocs: blocs,
      debut: debut
    }) : null;
    var effort = CP.effortRecolte(props.rowsRecolte);
    var vitesse = CP.vitesseRecolte({
      kg: aggCampagne ? aggCampagne.kgTotal : 0,
      jh: effort.jh,
      cout: effort.cout
    });
    var th = {
      padding: '6px 10px',
      textAlign: 'right',
      fontSize: 10,
      color: _CPB_C.textSec,
      fontWeight: 600,
      borderBottom: '1px solid ' + _CPB_C.border
    };
    var thL = Object.assign({}, th, {
      textAlign: 'left'
    });
    var td = {
      padding: '6px 10px',
      textAlign: 'right',
      fontSize: 12
    };
    var tdL = Object.assign({}, td, {
      textAlign: 'left',
      fontWeight: 600,
      color: color
    });
    var lignes = agg ? agg.lignes : [];
    var totalKg = lignes.reduce(function (s, l) {
      return s + l.kg;
    }, 0);
    var totalHa = lignes.reduce(function (s, l) {
      return s + l.ha;
    }, 0);
    return _cpb_h('div', {
      style: {
        marginBottom: 20,
        background: _CPB_C.surface,
        borderRadius: 12,
        border: '1px solid ' + _CPB_C.border,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }
    }, _cpb_h('div', {
      style: {
        padding: '10px 16px',
        background: 'linear-gradient(135deg,' + color + '15,' + color + '08)',
        borderBottom: '2px solid ' + color + '30',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, _cpb_h('i', {
      className: 'fa-solid fa-weight-scale',
      style: {
        color: color,
        fontSize: 14
      }
    }), _cpb_h('span', {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: color
      }
    }, culture + ' — production (kg)'), _cpb_h('span', {
      style: {
        fontSize: 11,
        color: _CPB_C.textSec
      }
    }, 'bons d\'apport, export, cycle en cours')),
    // ── Vitesse de récolte : le lien entre les kilos et la grille MO ──────
    _cpb_h('div', {
      style: {
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        padding: '12px 16px',
        borderBottom: '1px solid ' + _CPB_C.border
      }
    }, _cpb_tuile('Vitesse de récolte', _cpb_nb(vitesse.kgParJh, 1), 'kg / JH', vitesse.kgParJh === null ? 'Aucune journée-homme de récolte pointée sur la campagne ' + (props.campagne || '') + ' : le ratio n\'existe pas encore.' : 'Kilos récoltés par journée-homme de récolte, sur la campagne ' + (props.campagne || '') + '.', color), _cpb_tuile('Rendement du dirham', _cpb_nb(vitesse.kgParDh, 2), 'kg / DH', vitesse.dhParKg === null ? 'Aucun coût de récolte pointé sur la campagne ' + (props.campagne || '') + '.' : 'Soit ' + _cpb_nb(vitesse.dhParKg, 2) + ' DH de main d\'œuvre par kilo récolté.', color), _cpb_tuile('Effort de récolte', _cpb_nb(effort.jh, 1), 'JH pointés', 'Journées-homme de récolte (GB08) de la campagne affichée — le dénominateur ' + 'des deux indicateurs ci-contre.', _CPB_C.text)), erreur ? _cpb_h('div', {
      style: {
        padding: '14px 16px',
        fontSize: 12,
        color: '#c0392b'
      }
    }, 'Production indisponible : ' + erreur) : bons === null ? _cpb_h('div', {
      style: {
        padding: '14px 16px',
        fontSize: 12,
        color: _CPB_C.textSec
      }
    }, 'Chargement des bons d\'apport…') : _cpb_h('div', {
      style: {
        overflowX: 'auto'
      }
    }, _cpb_h('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 12
      }
    }, _cpb_h('thead', null, _cpb_h('tr', {
      style: {
        background: _CPB_C.surface2
      }
    }, _cpb_h('th', {
      style: thL
    }, 'Bloc de production'), _cpb_h('th', {
      style: thL
    }, 'Ferme'), _cpb_h('th', {
      style: th
    }, 'Ha'), _cpb_h('th', {
      style: th
    }, 'Kg'), _cpb_h('th', {
      style: th
    }, 'Kg / Ha'), _cpb_h('th', {
      style: th
    }, 'Kg / plant'), _cpb_h('th', {
      style: th
    }, 'Bons'))), _cpb_h('tbody', null, lignes.map(function (l, i) {
      var r = CP.rendements(l);
      return _cpb_h('tr', {
        key: l.id,
        style: {
          background: i % 2 ? _CPB_C.surface2 : _CPB_C.surface,
          borderBottom: '1px solid var(--gray-100)'
        }
      }, _cpb_h('td', {
        style: tdL
      }, l.label), _cpb_h('td', {
        style: Object.assign({}, td, {
          textAlign: 'left',
          color: _CPB_C.textSec
        })
      }, l.ferme), _cpb_h('td', {
        style: td
      }, _cpb_nb(l.ha, 2)), _cpb_h('td', {
        style: Object.assign({}, td, {
          fontWeight: 700
        })
      }, _cpb_nb(l.kg, 0)), _cpb_h('td', {
        style: td
      }, _cpb_nb(r.kgHa, 0)), _cpb_h('td', {
        style: td
      }, _cpb_nb(r.kgPlant, 2)), _cpb_h('td', {
        style: Object.assign({}, td, {
          color: _CPB_C.textSec
        })
      }, l.bons));
    })), _cpb_h('tfoot', null, _cpb_h('tr', {
      style: {
        background: color + '18',
        fontWeight: 700,
        color: color
      }
    }, _cpb_h('td', {
      style: Object.assign({}, td, {
        textAlign: 'left'
      })
    }, 'TOTAL'), _cpb_h('td', {
      style: td
    }, ''), _cpb_h('td', {
      style: td
    }, _cpb_nb(totalHa, 2)), _cpb_h('td', {
      style: td
    }, _cpb_nb(totalKg, 0)), _cpb_h('td', {
      style: td
    }, _cpb_nb(totalHa > 0 ? totalKg / totalHa : null, 0)), _cpb_h('td', {
      style: td
    }, ''), _cpb_h('td', {
      style: td
    }, ''))))),
    // Périmètre + rapprochement dégradé : jamais silencieux.
    _cpb_h('div', {
      style: {
        padding: '6px 14px 10px',
        fontSize: 10,
        color: _CPB_C.textSec,
        borderTop: '1px solid var(--gray-100)'
      }
    }, _cpb_h('i', {
      className: 'fa-solid fa-circle-info',
      style: {
        marginRight: 6
      }
    }), 'Kilos issus des bons d\'apport (même source que l\'onglet Production) : export, ' + 'cycle en cours, à la maille du BLOC DE PRODUCTION — le référentiel des ' + 'parcelles BEE ONE de la grille ci-dessus ne porte pas la variété, il n\'y a ' + 'donc pas de rattachement parcelle par parcelle. La vitesse de récolte, elle, ' + 'porte sur la campagne affichée (ses deux termes).', agg && agg.kgNonRattaches > 0 ? _cpb_h('span', {
      style: {
        color: '#c0392b'
      }
    }, ' ' + _cpb_nb(agg.kgNonRattaches, 0) + ' kg sur ' + agg.bonsNonRattaches + ' bon(s) ne sont rattachés à aucun bloc connu (désignation inconnue du référentiel).') : null));
  }
  window.CampagneProductionBloc = CampagneProductionBloc;
})();
