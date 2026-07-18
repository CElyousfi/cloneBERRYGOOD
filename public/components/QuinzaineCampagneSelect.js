/*
 * QuinzaineCampagneSelect.jsx — <select> partagé de quinzaine groupé par CAMPAGNE.
 *
 * Remplace les ~10 dropdowns de quinzaine dupliqués dans app.jsx (Quinzaine, Coût
 * Récolte, Transport, Traitement, Conditionnement, Heures-sup, Paie, Primes,
 * quinzaine-status…). Rend un <select> avec un <optgroup> par campagne (année
 * fiscale Juillet N → Juin N+1), campagnes triées DESC, quinzaines triées par
 * numéro DESC dans chaque groupe. Corrige la collision de numéros entre campagnes
 * ("Quinzaine 01" juillet 2026-2027 vs "Quinzaine 24" juin 2025-2026) et les
 * collisions de key React (key = campagne+'|'+periode).
 *
 * SOURCE DE VÉRITÉ = le meta backend (periodeCampagne). Ce composant ne fait
 * AUCUN fetch : il ne fait que trier/grouper une liste déjà reçue. Le state et
 * le onChange restent gérés par chaque écran appelant (remplacement du <select>,
 * pas de la logique de fetch).
 *
 * FALLBACK GRACIEUX (période transitoire deploy→1er sync) : si `periodeCampagne`
 * est ABSENT/vide, on dérive la campagne côté client via window.CampagneUtils
 * quand `periodeDates` (map label→dates) est fourni ; à défaut, LISTE PLATE triée
 * comme avant (numéro DESC). Aucun écran vide, aucun crash.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * IIFE + un seul global unique (window.QuinzaineCampagneSelect). Idents internes
 * préfixés QCS_ (cf. crashes #75/#77/#200).
 *
 * Props :
 *   - periodes (string[])                 libellés de quinzaine (ordre indifférent)
 *   - periodeCampagne ({label:campagne})  map optionnelle (source unique backend)
 *   - periodeDates ({label:string[]})     map optionnelle (fallback client campagneOf)
 *   - value (string)                      valeur sélectionnée
 *   - onChange ((value:string)=>void)     handler (reçoit la valeur, pas l'event)
 *   - label (string)                      libellé de l'option vide (défaut: aucune)
 *   - includeEmpty (bool)                 afficher une option vide en tête
 *   - style (object)                      style inline du <select>
 *   - className (string)
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var QCS_DEFAULT_STYLE = {
    padding: '4px 10px',
    borderRadius: 8,
    border: '1px solid var(--gray-200)',
    fontSize: 11,
    fontWeight: 600
  };

  /** "Quinzaine 24" → 24 ; sinon 0. */
  function QCS_num(label) {
    var m = String(label || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  /**
   * Construit la map { label: campagne } : d'abord depuis periodeCampagne (source
   * backend), sinon dérivée client via CampagneUtils.campagneOf(min(periodeDates)).
   * Un label sans campagne connue → non mappé (regroupé plus bas).
   */
  function QCS_resolveCampagnes(periodes, periodeCampagne, periodeDates) {
    var out = {};
    var CU = window.CampagneUtils;
    for (var i = 0; i < periodes.length; i++) {
      var p = periodes[i];
      if (periodeCampagne && periodeCampagne[p]) {
        out[p] = periodeCampagne[p];
        continue;
      }
      if (CU && CU.campagneOf && periodeDates && periodeDates[p] && periodeDates[p].length) {
        var dates = periodeDates[p].filter(Boolean).slice().sort();
        var camp = dates.length ? CU.campagneOf(dates[0]) : null;
        if (camp) out[p] = camp;
      }
    }
    return out;
  }

  /**
   * Groupe les périodes par campagne. Retourne un tableau de groupes
   * [{ campagne, periodes:[...] }] trié campagne DESC (inconnues en fin), et
   * chaque groupe trié numéro DESC.
   */
  function QCS_group(periodes, campMap) {
    var groups = {};
    for (var i = 0; i < periodes.length; i++) {
      var p = periodes[i];
      var c = campMap[p] || '';
      if (!groups[c]) groups[c] = [];
      groups[c].push(p);
    }
    var keys = Object.keys(groups).sort(function (a, b) {
      if (a === b) return 0;
      if (!a) return 1; // inconnues en fin
      if (!b) return -1;
      return b < a ? -1 : 1; // campagne DESC
    });
    return keys.map(function (c) {
      return {
        campagne: c,
        periodes: groups[c].slice().sort(function (a, b) {
          return QCS_num(b) - QCS_num(a);
        })
      };
    });
  }
  function QuinzaineCampagneSelect(props) {
    var periodes = (props.periodes || []).filter(Boolean);
    var value = props.value == null ? '' : props.value;
    var onChange = props.onChange;
    var style = props.style ? Object.assign({}, QCS_DEFAULT_STYLE, props.style) : QCS_DEFAULT_STYLE;
    var campMap = QCS_resolveCampagnes(periodes, props.periodeCampagne, props.periodeDates);
    var hasAnyCampagne = Object.keys(campMap).length > 0;
    var handleChange = function (e) {
      if (typeof onChange === 'function') onChange(e.target.value);
    };
    var children = [];
    if (props.includeEmpty) {
      children.push(React.createElement('option', {
        key: '__empty__',
        value: ''
      }, props.label || ''));
    }
    if (!hasAnyCampagne) {
      // FALLBACK LISTE PLATE : aucune campagne dérivable → tri numéro DESC (ancien
      // comportement). key sur le label seul (pas de collision inter-campagnes ici).
      var flat = periodes.slice().sort(function (a, b) {
        return QCS_num(b) - QCS_num(a);
      });
      for (var i = 0; i < flat.length; i++) {
        children.push(React.createElement('option', {
          key: flat[i],
          value: flat[i]
        }, flat[i]));
      }
    } else {
      var groups = QCS_group(periodes, campMap).filter(function (g) {
        return g.campagne;
      }).slice(0, 1);
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var optChildren = grp.periodes.map(function (p) {
          return React.createElement('option', {
            key: (grp.campagne || '?') + '|' + p,
            value: p
          }, p);
        });
        children.push(React.createElement('optgroup', {
          key: 'grp|' + (grp.campagne || '?'),
          label: grp.campagne || 'Autres'
        }, optChildren));
      }
    }
    return React.createElement('select', {
      value: value,
      onChange: handleChange,
      style: style,
      className: props.className
    }, children);
  }

  // Helpers exposés pour les tests unitaires (node:test) — pas d'accès DOM/global.
  QuinzaineCampagneSelect._QCS_group = QCS_group;
  QuinzaineCampagneSelect._QCS_resolveCampagnes = QCS_resolveCampagnes;
  window.QuinzaineCampagneSelect = QuinzaineCampagneSelect;
})();
