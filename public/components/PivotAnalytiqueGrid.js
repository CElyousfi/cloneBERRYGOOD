/*
 * PivotAnalytiqueGrid.jsx — GRILLE DE PRÉSENTATION du tableau croisé
 * (groupe M.O → famille GB → opération) × parcelle.
 *
 * Extrait de public/components/AffectationAnalytiqueTable.jsx (LOT 2a) à
 * comportement STRICTEMENT identique : le balisage produit avec une seule série
 * est celui d'avant, à l'octet près. Le filet qui le prouve est
 * tests/unit/affectationAnalytiqueTable.test.js, écrit AVANT l'extraction et
 * resté vert sans modification.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. mémoire projet umd-global-collision-smoke-load — une collision
 * crashe le boot React #200). Les noms internes sont préfixés `_pag_` / `_PAG_`.
 * UN SEUL global exposé, et rien d'autre :
 *   window.PivotAnalytiqueGrid
 *
 * Aucun hook, aucun état, aucun fetch : composant de PRÉSENTATION pur. Le
 * calcul du pivot, la résolution culture/Ha, le carrousel, les sélecteurs et la
 * pop-up de détail restent chez l'appelant.
 *
 * ── Props ──────────────────────────────────────────────────────────────────
 *   parcelles     {Array<[string, number]>}  Colonnes : [clé de parcelle, Ha].
 *   groupedRows   {Array<{type,key,label,pivot}>}  Lignes, telles que produites
 *                 par AnalytiqueUtils.buildAnalytiquePivotByFamille.
 *                 `type` ∈ 'groupe' | 'famille' | 'operation'.
 *                 `pivot` = { [cléParcelle]: cellule }.
 *   metrics       {Array<Metric>}  Séries affichées DANS CHAQUE cellule (voir
 *                 plus bas). Une seule série = rendu historique.
 *   color         {string}  Couleur de la culture (bandeaux, bordures, totaux).
 *   title         {string}  Titre du bandeau (aujourd'hui : la culture).
 *   icon          {string}  Classe Font Awesome du bandeau.
 *   firstColumnLabel {string}  En-tête de la 1re colonne (défaut 'Opération').
 *   parcelleLabel {Function}  (cléParcelle) => libellé affiché (défaut : la clé).
 *   onCellClick   {Function}  ({parcelle, operationFamille, ha, detailRows}) =>
 *                 void. Absent = cellules non cliquables (ni curseur, ni survol).
 *
 * ── Metric ─────────────────────────────────────────────────────────────────
 * Une série = une valeur par cellule. Les séries s'empilent DANS la cellule :
 * c'est ce qui permettra d'afficher réalisé / budget / écart côte à côte sans
 * ré-extraire la grille.
 *
 *   key      {string}    Champ lu dans la cellule du pivot (ex. 'jh', 'cout').
 *   get      {Function}  (cellule) => number|null. Prioritaire sur `key` — c'est
 *                        par là que passe une série CALCULÉE (l'écart,
 *                        typiquement). `null`/`undefined` (par `get` comme par
 *                        `key` absent) = valeur NON RENSEIGNÉE : la cellule
 *                        affiche « — » et ne pèse rien dans les agrégats. À NE
 *                        PAS confondre avec 0 (cf. _pag_raw).
 *   label    {string}    Nom court de la série. Affiché UNIQUEMENT s'il y a
 *                        plusieurs séries (sinon le balisage divergerait du
 *                        rendu historique).
 *   unit     {string}    Unité affichée sous la valeur ('JH/Ha', 'DH emp.', …).
 *   basis    {'total'|'perHa'}  Ce que vaut la valeur BRUTE stockée dans le
 *                        pivot. Le réalisé est un TOTAL par cellule ; le budget
 *                        est déjà en JH/Ha. Défaut 'total'.
 *   display  {'total'|'perHa'}  Ce qu'on veut AFFICHER. Défaut 'total'.
 *   format   {Function}  (nombre) => string, appliqué à la valeur convertie.
 *   summary  {Function}  (total brut de la ligne) => string. Texte discret du
 *                        bandeau de ligne groupe. Seule la PREMIÈRE série en
 *                        pose un. Absent = pas de mention.
 *
 * `basis` et `display` séparés rendent le sens de la conversion EXPLICITE PAR
 * SÉRIE — c'est le point dur : un `_fmt` global divisait par le Ha en supposant
 * que toute valeur brute est un total, ce qui est faux pour le budget (déjà en
 * JH/Ha, donc à MULTIPLIER pour obtenir un total). Règles :
 *   basis === display          → la valeur brute est affichée telle quelle,
 *                                même Ha inconnu.
 *   'total'  → 'perHa'         → valeur / Ha  (Ha inconnu → « — »)
 *   'perHa'  → 'total'         → valeur × Ha  (Ha inconnu → « — »)
 * Les agrégats (total de ligne, de colonne, grand total) somment TOUJOURS la
 * quantité totale de chaque cellule (`basis === 'perHa'` ⇒ valeur × Ha de la
 * colonne), puis appliquent `display` au résultat. Sommer des JH/Ha entre
 * parcelles n'aurait aucun sens.
 *
 * Exemple à trois séries (cible du chantier — réalisé / budget / écart) :
 *   metrics={[
 *     { key: 'jh',     label: 'Réalisé', unit: 'JH/Ha',
 *       basis: 'total', display: 'perHa', format: _un,
 *       summary: (t) => `${Math.round(t)} JH total` },
 *     { key: 'budget', label: 'Budget',  unit: 'JH/Ha',
 *       basis: 'perHa', display: 'perHa', format: _un },
 *     { label: 'Écart', unit: 'JH/Ha',
 *       get: CampagneBudgetPivot.ecartCell,   // null si pas de budget / Ha inconnu
 *       basis: 'total', display: 'perHa', format: _signe },
 *   ]}
 * En basculant l'affichage sur Total, l'appelant passe `display: 'total'` sur
 * les trois : le réalisé cesse d'être divisé, le budget se met à être
 * multiplié, et l'écart suit — sans qu'aucune de ces règles ne soit codée ici.
 */
(function () {
  'use strict';

  var _PAG_R = window.React;
  if (!_PAG_R) return;
  var _pag_h = _PAG_R.createElement;

  /**
   * Valeur brute d'une série dans une cellule du pivot.
   *
   * `null` = valeur NON RENSEIGNÉE, à distinguer de 0. Le budget en a un besoin
   * structurel : « aucun budget saisi » (l'état de la plupart des parcelles) doit
   * s'afficher « — », jamais « 0.0 » — un budget nul affiché à côté d'un réalisé
   * se lit comme un dépassement total. Même chose pour l'écart, qui n'existe pas
   * sans budget : un 0 s'y lirait « pile dans le budget ».
   * Une valeur non finie (NaN, ±∞ — division par un Ha nul en amont) est traitée
   * de la même façon : indéterminable, jamais affichée.
   */
  function _pag_raw(metric, cell) {
    if (!cell) return null;
    var v = typeof metric.get === 'function' ? metric.get(cell) : cell[metric.key];
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function _pag_basis(metric) {
    return metric.basis === 'perHa' ? 'perHa' : 'total';
  }
  function _pag_disp(metric) {
    return metric.display === 'perHa' ? 'perHa' : 'total';
  }

  /**
   * Quantité TOTALE portée par une cellule — la seule grandeur sommable.
   * Une valeur non renseignée ne pèse rien dans un agrégat (elle ne le rend pas
   * indéterminable pour autant : un total de budget reste la somme des budgets
   * saisis, à périmètre budgété, comme dans l'export Excel).
   */
  function _pag_toTotal(metric, raw, ha) {
    if (raw === null) return 0;
    return _pag_basis(metric) === 'perHa' ? raw * (ha || 0) : raw;
  }
  function _pag_fmt(metric, value) {
    return typeof metric.format === 'function' ? metric.format(value) : String(value);
  }

  /** Rendu d'une cellule. `null` = indéterminable (valeur absente ou Ha inconnu). */
  function _pag_renderCell(metric, raw, ha) {
    if (raw === null) return null;
    var basis = _pag_basis(metric);
    var disp = _pag_disp(metric);
    if (basis === disp) return _pag_fmt(metric, raw);
    if (!(ha > 0)) return null;
    return _pag_fmt(metric, basis === 'total' ? raw / ha : raw * ha);
  }

  /** Rendu d'un agrégat DÉJÀ exprimé en total. `null` = indéterminable. */
  function _pag_renderTotal(metric, total, ha) {
    if (_pag_disp(metric) === 'total') return _pag_fmt(metric, total);
    if (!(ha > 0)) return null;
    return _pag_fmt(metric, total / ha);
  }

  /** Marque d'une valeur non calculable — balisage historique de `_fmt`. */
  function _pag_dash() {
    return _pag_h('span', {
      style: {
        fontSize: 10,
        color: 'var(--gray-400)'
      }
    }, '—');
  }

  /**
   * Empile les séries dans une cellule : une ligne valeur + une ligne unité par
   * série. Avec UNE série, le balisage est exactement celui d'avant
   * l'extraction. Avec plusieurs, la ligne d'unité porte aussi le nom de la
   * série — sans quoi les trois valeurs seraient indiscernables.
   */
  function _pag_stack(metrics, valueOf, valueStyle, unitStyle) {
    var multi = metrics.length > 1;
    var out = [];
    metrics.forEach(function (m, i) {
      var v = valueOf(m);
      out.push(_pag_h('div', {
        key: 'v' + i,
        style: valueStyle
      }, v === null ? _pag_dash() : v));
      var unit = m.unit || '';
      out.push(_pag_h('div', {
        key: 'u' + i,
        style: unitStyle
      }, multi && m.label ? unit ? m.label + ' ' + unit : m.label : unit));
    });
    return out;
  }
  function PivotAnalytiqueGrid(props) {
    var parcelles = props.parcelles || [];
    var groupedRows = props.groupedRows || [];
    var metrics = props.metrics && props.metrics.length ? props.metrics : [{
      key: 'jh'
    }];
    var color = props.color || 'var(--berry)';
    var onCellClick = typeof props.onCellClick === 'function' ? props.onCellClick : null;
    var parcelleLabel = typeof props.parcelleLabel === 'function' ? props.parcelleLabel : null;
    var firstColumnLabel = props.firstColumnLabel || 'Opération';
    var totalHa = parcelles.reduce(function (s, p) {
      return s + p[1];
    }, 0);

    /** Total (sommable) d'une série sur toute une ligne. */
    function rowTotal(metric, row) {
      return parcelles.reduce(function (s, p) {
        return s + _pag_toTotal(metric, _pag_raw(metric, row.pivot[p[0]]), p[1]);
      }, 0);
    }
    var familles = groupedRows.filter(function (r) {
      return r.type === 'famille';
    });

    /** Total d'une série sur une colonne — lignes FAMILLE seules (jamais les
     *  lignes groupe ni opération : elles rejouent les mêmes JH). */
    function colTotal(metric, pKey, ha) {
      return familles.reduce(function (s, r) {
        return s + _pag_toTotal(metric, _pag_raw(metric, r.pivot[pKey]), ha);
      }, 0);
    }
    function grandTotal(metric) {
      return familles.reduce(function (s, r) {
        return s + rowTotal(metric, r);
      }, 0);
    }

    // ── Cellule de parcelle (lignes famille et opération) ───────────────────
    function parcelleCell(row, pKey, ha, opts) {
      var cell = row.pivot[pKey];
      if (!cell) {
        return _pag_h('td', {
          key: pKey,
          style: {
            padding: opts.pad,
            textAlign: 'center',
            color: 'var(--gray-200)',
            borderRight: '1px solid #f5edf4',
            fontSize: opts.emptyFontSize
          }
        }, '—');
      }
      var style = {
        padding: opts.pad,
        textAlign: 'center',
        borderRight: '1px solid #f5edf4',
        transition: 'background 0.12s'
      };
      if (opts.fontSize) style.fontSize = opts.fontSize;
      var attrs = {
        key: pKey,
        style: style
      };
      if (onCellClick) {
        style.cursor = 'pointer';
        attrs.title = 'Voir le détail de ' + row.label + ' sur ' + pKey;
        attrs.onClick = function () {
          onCellClick({
            parcelle: pKey,
            operationFamille: row.label,
            ha: ha,
            detailRows: cell.detailRows
          });
        };
        attrs.onMouseEnter = function (e) {
          e.currentTarget.style.background = '#fdf4f8';
        };
        attrs.onMouseLeave = function (e) {
          e.currentTarget.style.background = '';
        };
      }
      return _pag_h('td', attrs, _pag_stack(metrics, function (m) {
        return _pag_renderCell(m, _pag_raw(m, cell), ha);
      }, opts.valueStyle, opts.unitStyle));
    }

    // ── Lignes ─────────────────────────────────────────────────────────────
    var body = groupedRows.map(function (row) {
      // Ligne groupe (en-tête de section).
      if (row.type === 'groupe') {
        var primaire = metrics[0];
        var resume = typeof primaire.summary === 'function' ? primaire.summary(rowTotal(primaire, row)) : null;
        return _pag_h('tr', {
          key: row.key
        }, _pag_h('td', {
          colSpan: parcelles.length + 2,
          style: {
            padding: '8px 14px',
            fontWeight: 700,
            fontSize: 12,
            background: color,
            color: 'white',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            position: 'sticky',
            left: 0
          }
        }, row.label, resume === null ? null : _pag_h('span', {
          style: {
            fontWeight: 400,
            fontSize: 10,
            opacity: 0.75,
            marginLeft: 8
          }
        }, resume)));
      }

      // Ligne opération (mode Détail) : détail d'une famille, insérée juste
      // sous elle. Ces lignes ne sont JAMAIS de type 'famille', sinon le pied
      // de tableau doublerait les totaux.
      if (row.type === 'operation') {
        return _pag_h('tr', {
          key: row.key,
          style: {
            background: '#fcfafc',
            borderBottom: '1px solid #f7f0f6'
          }
        }, _pag_h('td', {
          style: {
            padding: '6px 14px 6px 44px',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--gray-600)',
            position: 'sticky',
            left: 0,
            background: '#fcfafc',
            borderRight: '2px solid ' + color,
            zIndex: 1,
            borderLeft: '3px solid ' + color + '55'
          }
        }, _pag_h('span', {
          style: {
            color: 'var(--gray-400)',
            marginRight: 6
          }
        }, '↳'), row.label), parcelles.map(function (p) {
          return parcelleCell(row, p[0], p[1], {
            pad: '6px 10px',
            fontSize: 11,
            emptyFontSize: 12,
            valueStyle: {
              fontWeight: 500,
              color: 'var(--gray-600)'
            },
            unitStyle: {
              fontSize: 9,
              color: 'var(--gray-400)'
            }
          });
        }), _pag_h('td', {
          style: {
            padding: '6px 10px',
            textAlign: 'center',
            fontWeight: 600,
            color: 'var(--gray-600)',
            background: '#fcfafc',
            position: 'sticky',
            right: 0,
            borderLeft: '1px solid #f0e6ef',
            fontSize: 11
          }
        }, _pag_stack(metrics, function (m) {
          return _pag_renderTotal(m, rowTotal(m, row), totalHa);
        }, undefined, {
          fontSize: 9,
          color: 'var(--gray-400)',
          fontWeight: 400
        })));
      }

      // Ligne famille.
      return _pag_h('tr', {
        key: row.key,
        style: {
          background: '#fff',
          borderBottom: '1px solid #f0e6ef'
        }
      }, _pag_h('td', {
        style: {
          padding: '9px 14px',
          fontWeight: 600,
          color: color,
          position: 'sticky',
          left: 0,
          background: '#fff',
          borderRight: '2px solid ' + color,
          zIndex: 1,
          borderLeft: '3px solid ' + color
        }
      }, row.label, _pag_h('span', {
        style: {
          fontSize: 10,
          fontWeight: 400,
          color: 'var(--gray-400)',
          marginLeft: 6
        }
      }, row.key)), parcelles.map(function (p) {
        return parcelleCell(row, p[0], p[1], {
          pad: '8px 10px',
          emptyFontSize: 13,
          valueStyle: {
            fontWeight: 700,
            color: 'var(--gray-700)'
          },
          unitStyle: {
            fontSize: 10,
            color: 'var(--gray-400)'
          }
        });
      }), _pag_h('td', {
        style: {
          padding: '8px 10px',
          textAlign: 'center',
          fontWeight: 700,
          color: color,
          background: '#fdf4f8',
          position: 'sticky',
          right: 0,
          borderLeft: '1px solid #f0e6ef'
        }
      }, _pag_stack(metrics, function (m) {
        return _pag_renderTotal(m, rowTotal(m, row), totalHa);
      }, undefined, {
        fontSize: 10,
        color: 'var(--gray-400)',
        fontWeight: 400
      })));
    });
    return _pag_h('div', {
      style: {
        marginBottom: 20,
        background: '#fff',
        borderRadius: 12,
        border: '1px solid var(--gray-200)',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }
    },
    // Bandeau de titre.
    _pag_h('div', {
      style: {
        padding: '10px 16px',
        background: 'linear-gradient(135deg,' + color + '15,' + color + '08)',
        borderBottom: '2px solid ' + color + '30',
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, _pag_h('i', {
      className: 'fa-solid ' + (props.icon || ''),
      style: {
        color: color,
        fontSize: 14
      }
    }), _pag_h('span', {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: color
      }
    }, props.title), _pag_h('span', {
      style: {
        fontSize: 11,
        color: 'var(--gray-500)',
        fontWeight: 400
      }
    }, parcelles.length, ' parcelle', parcelles.length > 1 ? 's' : '', totalHa > 0 ? ' · ' + totalHa.toFixed(2) + ' Ha total' : '')), _pag_h('div', {
      style: {
        overflowX: 'auto'
      }
    }, _pag_h('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 12
      }
    }, _pag_h('thead', null, _pag_h('tr', {
      style: {
        background: 'var(--gray-50)'
      }
    }, _pag_h('th', {
      style: {
        padding: '8px 12px',
        textAlign: 'left',
        fontWeight: 600,
        color: 'var(--gray-600)',
        position: 'sticky',
        left: 0,
        background: 'var(--gray-50)',
        minWidth: 160,
        borderRight: '1px solid var(--gray-200)',
        zIndex: 1
      }
    }, firstColumnLabel), parcelles.map(function (p) {
      return _pag_h('th', {
        key: p[0],
        style: {
          padding: '6px 10px',
          textAlign: 'center',
          fontWeight: 600,
          color: 'var(--gray-600)',
          minWidth: 110,
          borderRight: '1px solid var(--gray-100)'
        }
      }, _pag_h('div', {
        style: {
          color: color,
          fontWeight: 700
        }
      }, (parcelleLabel ? parcelleLabel(p[0]) : p[0]) || p[0]), _pag_h('div', {
        style: {
          fontSize: 10,
          color: 'var(--gray-400)',
          fontWeight: 400
        }
      }, p[1] > 0 ? p[1] + ' Ha' : 'Ha ?'));
    }), _pag_h('th', {
      style: {
        padding: '6px 10px',
        textAlign: 'center',
        fontWeight: 700,
        color: 'var(--gray-700)',
        minWidth: 100,
        background: 'var(--gray-100)',
        position: 'sticky',
        right: 0,
        zIndex: 1
      }
    }, 'Total'))), _pag_h('tbody', null, body), _pag_h('tfoot', null, _pag_h('tr', {
      style: {
        background: color + '18',
        fontWeight: 700
      }
    }, _pag_h('td', {
      style: {
        padding: '8px 12px',
        position: 'sticky',
        left: 0,
        background: color + '18',
        borderRight: '1px solid var(--gray-200)',
        zIndex: 1,
        color: color
      }
    }, 'TOTAL'), parcelles.map(function (p) {
      return _pag_h('td', {
        key: p[0],
        style: {
          padding: '8px 10px',
          textAlign: 'center',
          borderRight: '1px solid var(--gray-100)',
          color: color
        }
      }, _pag_stack(metrics, function (m) {
        return _pag_renderTotal(m, colTotal(m, p[0], p[1]), p[1]);
      }, undefined, {
        fontSize: 10,
        opacity: 0.7
      }));
    }), _pag_h('td', {
      style: {
        padding: '8px 10px',
        textAlign: 'center',
        background: color + '28',
        position: 'sticky',
        right: 0,
        color: color
      }
    }, _pag_stack(metrics, function (m) {
      return _pag_renderTotal(m, grandTotal(m), totalHa);
    }, undefined, {
      fontSize: 10,
      opacity: 0.7
    })))))));
  }
  window.PivotAnalytiqueGrid = PivotAnalytiqueGrid;
})();
