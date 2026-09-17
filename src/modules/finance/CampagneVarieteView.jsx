/*
 * CampagneVarieteView.jsx — vue « Par Variété / Quinzaine » de l'écran
 * Campagne (CampagneAnalytiqueTab).
 *
 * Extrait de CampagneAnalytiqueTab.jsx (déplacement de code, sans modification).
 */

import * as AnalytiqueUtils from '../shared/lib/analytiqueUtils.js';
import * as CampagneExportUtils from '../shared/lib/campagneExportUtils.js';
import { CampagneBudgetTab } from './CampagneBudgetTab.jsx';
import { C, FAMILLE_ICONS, CAT_CULTURE_INCONNUE, fmtDH, fmtJH, fmtHa, fmtHaLabel, fmtDHPerHa, fmtQty, cultureOf, matchCulture, sbNom, sbHa, CAT_budgetsByLabel, CAT_opBudgetsByLabel, buildVarieteView, CAT_pivotRows, CAT_byCulture } from './campagneAnalytiqueHelpers.jsx';
import { buildCultureWorkbook, exportCulture } from './campagneAnalytiqueExport.jsx';

var useState = React.useState;
var useMemo = React.useMemo;

/* ------------------------------------------------------------------ */
/* Sous-composant : Vue Par Variété / Quinzaine                        */
/* ------------------------------------------------------------------ */
function VarieteView(props) {
  var data = props.data;
  var farmFilter = props.farmFilter;
  var cultureFilter = props.cultureFilter;
  var sbMap = props.sbMap || {};
  var budgetsByLabel = props.budgetsByLabel || {};
  var opBudgetsByLabel = props.opBudgetsByLabel || {};
  var selectedParcelle = props.selectedParcelle;
  var setSelectedParcelle = props.setSelectedParcelle;
  var metric = props.metric;
  var setMetric = props.setMetric;

  // Culture dont l'export est en cours (ExcelJS chargé à la demande) — null
  // quand aucun export ne tourne.
  var _exporting = useState(null);
  var exporting = _exporting[0]; var setExporting = _exporting[1];

  // Liste distincte des parcelles (filtrée par farmFilter + cultureFilter).
  // `value` = libellé BEE ONE brut (clé de jointure de buildVarieteView),
  // affichage = nom Smart Berry ; tri sur le libellé affiché.
  var parcelles = useMemo(function () {
    var seen = {};
    var list = [];
    (data.rows || []).forEach(function (r) {
      var key = r.parcelle || r.refParcelle;
      if (!key || seen[key]) return;
      if (farmFilter && r.ferme !== farmFilter) return;
      if (!matchCulture(key, cultureFilter, sbMap)) return;
      seen[key] = true;
      list.push({ value: key, label: sbNom(key, sbMap) });
    });
    return list.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }, [data, farmFilter, cultureFilter, sbMap]);

  // Superficie de la parcelle sélectionnée
  var selectedHa = useMemo(function () {
    if (!selectedParcelle) return 0;
    return sbHa(selectedParcelle, sbMap, data.haByRef);
  }, [selectedParcelle, sbMap, data]);

  // Quinzaines de la campagne présentes dans les données
  var periodes = data.periodes || [];

  // Lignes du pivot pour la parcelle sélectionnée
  var opRows = useMemo(function () {
    if (!selectedParcelle) return [];
    return buildVarieteView(data.rows, selectedParcelle, periodes);
  }, [data, selectedParcelle, periodes]);

  // Groupes par famille
  var familles = useMemo(function () {
    var order = data.famillesOrdered || [];
    var seen = {};
    opRows.forEach(function (r) { seen[r.famille] = true; });
    var ordered = order.filter(function (f) { return seen[f]; });
    Object.keys(seen).forEach(function (f) {
      if (ordered.indexOf(f) === -1) ordered.push(f);
    });
    return ordered;
  }, [opRows, data.famillesOrdered]);

  // Totaux généraux par période
  var grandTotals = useMemo(function () {
    var byP = {};
    var total = { jh: 0, cout: 0 };
    opRows.forEach(function (r) {
      periodes.forEach(function (p) {
        if (!byP[p]) byP[p] = { jh: 0, cout: 0 };
        var cell = r.byPeriode[p];
        if (cell) { byP[p].jh += cell.jh; byP[p].cout += cell.cout; }
      });
      total.jh  += r.total.jh;
      total.cout += r.total.cout;
    });
    return { byP: byP, total: total };
  }, [opRows, periodes]);

  // ---- Suivi budgétaire : MÊMES helpers purs que la feuille Excel ---------
  //
  // Rien n'est recalculé ici. La grille écran et l'export doivent afficher les
  // MÊMES chiffres : deux implémentations divergeraient au premier changement
  // de règle. Le composant ne fait qu'INJECTER (règle métier + référentiel) et
  // formater.
  //
  // Le budget n'existe qu'en JH/Ha : en mode « Coût DH » les 5 colonnes ne
  // sont pas rendues du tout (une conversion en dirhams serait une invention).
  var CEU = CampagneExportUtils;
  var showBudget = metric === 'jh' && !!(CEU && CEU.buildParcelleBudgetIndex);

  var budgetIndex = useMemo(function () {
    if (!CEU || typeof CEU.buildParcelleBudgetIndex !== 'function') return null;
    // MÊME clé de jointure que l'export et que sbMap : toute autre
    // normalisation raterait tous les budgets, en silence.
    var key = String(selectedParcelle || '').toUpperCase().trim();
    return CEU.buildParcelleBudgetIndex({
      budgets: budgetsByLabel[key] || {},
      budgetsOperations: opBudgetsByLabel[key] || {},
      budgetRules: CampagneBudgetTab,
      analytique: AnalytiqueUtils,
    });
  }, [selectedParcelle, budgetsByLabel, opBudgetsByLabel]);

  // Budgets effectifs par famille + périmètre du TOTAL GÉNÉRAL, résolus en un
  // passage — exactement l'appel que fait buildParcelleSheetRows.
  var budgetFamilles = useMemo(function () {
    if (!budgetIndex) return { parFamille: {}, scope: {} };
    return budgetIndex.resolveFamilles(opRows, data.famillesOrdered);
  }, [budgetIndex, opRows, data.famillesOrdered]);

  var budgetScope = useMemo(function () {
    if (!budgetIndex || !CEU) return null;
    var jhByFamille = {};
    opRows.forEach(function (r) {
      if (!r.famille) return;
      jhByFamille[r.famille] = (jhByFamille[r.famille] || 0) + (r.total.jh || 0);
    });
    return CEU.budgetScope(budgetFamilles.scope, jhByFamille);
  }, [budgetIndex, budgetFamilles, opRows]);

  var thStyle = {
    padding: '8px 10px',
    borderBottom: '2px solid ' + C.border,
    background: C.surface2,
    fontSize: '12px',
    fontWeight: 600,
    color: C.textSec,
    whiteSpace: 'nowrap',
    textAlign: 'right',
  };
  var thFirstStyle = Object.assign({}, thStyle, { textAlign: 'left', minWidth: '200px' });
  var tdStyle = {
    padding: '7px 10px',
    borderBottom: '1px solid ' + C.border,
    fontSize: '13px',
    color: C.text,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  };
  var tdFirstStyle = Object.assign({}, tdStyle, { textAlign: 'left' });
  var tdDashStyle = Object.assign({}, tdStyle, { color: C.textSec });

  function renderVal(cell) {
    if (!cell) return React.createElement('td', { style: tdDashStyle }, '—');
    var v = metric === 'cout' ? cell.cout : cell.jh;
    if (!v || v === 0) return React.createElement('td', { style: tdDashStyle }, '—');
    return React.createElement('td', { style: tdStyle }, metric === 'cout' ? fmtDH(v) : fmtJH(v));
  }

  /**
   * Nombre d'une colonne budgétaire. CONSERVE le zéro (contrairement à fmtJH) :
   * « 0 JH restant » est une information, pas une case vide.
   */
  function fmtBudgetNum(v) {
    return (Math.round(v * 10) / 10).toLocaleString('fr-MA');
  }

  /**
   * Les 5 cellules de droite d'une ligne : « Total JH / Ha » puis les 4 du
   * suivi budgétaire, calculées par les helpers de l'export (CEU.perHa /
   * CEU.budgetCells) — jamais recodées ici.
   *
   * Cellule vide (pas de budget, superficie inconnue) → « — », convention de
   * la table : jamais 0, jamais 100 %. Au-delà de 100 % consommé, même signal
   * que l'export : rouge, sans plafonnement.
   *
   * `jh` (consommé du PÉRIMÈTRE BUDGÉTÉ) et `jhTotal` (volume exhaustif de la
   * ligne) diffèrent sur le TOTAL GÉNÉRAL : la colonne « Total JH / Ha » ne
   * perd aucun JH, les colonnes budgétaires comparent à périmètre égal.
   *
   * @param {{budget:*, jh:number, jhTotal?:number, base:Object, keyPrefix:string}} o
   */
  function budgetTds(o) {
    var base = o.base;
    var jh = o.jh;
    var jhTotal = o.jhTotal === undefined ? jh : o.jhTotal;
    var out = [React.createElement('td', {
      key: o.keyPrefix + '-perha',
      style: base,
    }, (function () {
      var v = CEU.perHa(jhTotal, selectedHa);
      return v === '' ? '—' : fmtBudgetNum(v);
    })())];
    var keyPrefix = o.keyPrefix;
    CEU.budgetCells(o.budget, selectedHa, jh).forEach(function (c, i) {
      if (c === '') {
        out.push(React.createElement('td', {
          key: keyPrefix + '-b' + i,
          style: Object.assign({}, base, { color: base.color || C.textSec }),
        }, '—'));
        return;
      }
      if (i === 1) {
        var pct = Math.round(c * 1000) / 10;
        out.push(React.createElement('td', {
          key: keyPrefix + '-b' + i,
          style: Object.assign({}, base, pct > 100 ? { color: C.berry } : null),
        }, fmtBudgetNum(pct) + ' %'));
        return;
      }
      out.push(React.createElement('td', {
        key: keyPrefix + '-b' + i,
        style: base,
      }, fmtBudgetNum(c)));
    });
    return out;
  }

  return React.createElement('div', null,
    // Barre de contrôle
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }
    },
      React.createElement('label', { style: { fontSize: '13px', color: C.textSec } }, 'Parcelle :'),
      React.createElement('select', {
        value: selectedParcelle,
        onChange: function (e) { setSelectedParcelle(e.target.value); },
        style: {
          padding: '6px 10px',
          borderRadius: '6px',
          border: '1.5px solid ' + C.border,
          fontSize: '13px',
          minWidth: '180px',
        }
      },
        React.createElement('option', { value: '' }, '— Choisir une parcelle —'),
        parcelles.map(function (p) {
          return React.createElement('option', { key: p.value, value: p.value }, p.label);
        })
      ),
      selectedParcelle
        ? React.createElement('span', { style: { fontSize: '13px', color: C.textSec } },
            'Superficie : ' + fmtHaLabel(selectedHa)
          )
        : null,
      React.createElement('span', { style: { marginLeft: '8px' } }),
      ['jh', 'cout'].map(function (m) {
        var label = m === 'cout' ? 'Coût DH' : 'JH';
        return React.createElement('button', {
          key: m,
          onClick: function () { setMetric(m); },
          style: {
            padding: '5px 14px',
            border: '1.5px solid ' + (metric === m ? C.berry : C.border),
            borderRadius: '16px',
            background: metric === m ? C.berry : C.surface,
            color: metric === m ? '#fff' : C.text,
            fontSize: '12px',
            fontWeight: metric === m ? 700 : 400,
            cursor: 'pointer',
          }
        }, label);
      }),
      // Exports Excel — toutes les parcelles de la culture (indépendants du
      // filtre Culture et de la parcelle sélectionnée), périmètre farmFilter.
      ['Framboise', 'Myrtille'].map(function (cult) {
        var busy = exporting === cult;
        var disabled = exporting !== null;
        return React.createElement('button', {
          key: 'export-' + cult,
          disabled: disabled,
          onClick: function () {
            if (exporting !== null) return;
            setExporting(cult);
            // Promise.resolve().then(…) : si exportCulture jette de façon
            // SYNCHRONE, l'erreur devient un rejet capturé et les boutons
            // sont réactivés — sinon ils resteraient grisés « Génération… »
            // jusqu'au remontage de l'onglet.
            Promise.resolve()
              .then(function () {
                return exportCulture(
                  cult, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel
                );
              })
              .catch(function (e) {
                if (window.console) console.error('[Campagne] Export ' + cult + ' échoué :', e);
              })
              .then(function () { setExporting(null); });
          },
          title: 'Exporter toutes les parcelles ' + cult + ' (une feuille par parcelle)',
          style: {
            padding: '5px 14px',
            border: '1.5px solid ' + C.green,
            borderRadius: '16px',
            background: C.surface,
            color: C.green,
            fontSize: '12px',
            fontWeight: 600,
            cursor: disabled ? 'wait' : 'pointer',
            opacity: disabled && !busy ? 0.5 : 1,
          }
        },
          React.createElement('i', {
            className: busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-excel',
            style: { marginRight: '6px' },
          }),
          busy ? 'Génération…' : 'Export ' + cult
        );
      })
    ),
    // Contenu
    !selectedParcelle
      ? React.createElement('div', {
          style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' }
        }, 'Sélectionner une parcelle pour afficher le pivot quinzaines.')
      : opRows.length === 0
        ? React.createElement('div', {
            style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' }
          }, 'Aucune donnée pour cette parcelle.')
        : React.createElement('div', { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' } },
            React.createElement('table', {
              style: { minWidth: '600px', borderCollapse: 'collapse', fontSize: '12px' }
            },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', { style: thFirstStyle }, 'Famille / Opération'),
                  periodes.map(function (p) {
                    return React.createElement('th', { key: p, style: thStyle }, p);
                  }),
                  React.createElement('th', { style: thStyle }, 'Total'),
                  // Colonnes de suivi budgétaire — libellés repris de l'export
                  // (source unique : un libellé dupliqué finirait par diverger).
                  showBudget
                    ? [React.createElement('th', { key: 'perha', style: thStyle }, 'Total JH / Ha')]
                        .concat(CEU.BUDGET_HEADER.map(function (h) {
                          return React.createElement('th', { key: h, style: thStyle }, h);
                        }))
                    : null
                )
              ),
              React.createElement('tbody', null,
                familles.map(function (famille) {
                  var famRows = opRows.filter(function (r) { return r.famille === famille; });
                  if (famRows.length === 0) return null;
                  // Total famille
                  var famTotal = { byP: {}, total: { jh: 0, cout: 0 } };
                  famRows.forEach(function (r) {
                    periodes.forEach(function (p) {
                      if (!famTotal.byP[p]) famTotal.byP[p] = { jh: 0, cout: 0 };
                      var cell = r.byPeriode[p];
                      if (cell) { famTotal.byP[p].jh += cell.jh; famTotal.byP[p].cout += cell.cout; }
                    });
                    famTotal.total.jh  += r.total.jh;
                    famTotal.total.cout += r.total.cout;
                  });
                  var icon = FAMILLE_ICONS[famille];
                  var elems = [];
                  // Header famille
                  elems.push(React.createElement('tr', {
                    key: 'fam-' + famille,
                    style: { background: '#ebeae3' }
                  },
                    React.createElement('td', {
                      // Libellé + quinzaines + Total (+ les 5 colonnes de
                      // droite quand elles sont rendues).
                      colSpan: periodes.length + 2 + (showBudget ? 5 : 0),
                      style: {
                        padding: '6px 10px',
                        fontWeight: 700,
                        fontSize: '12px',
                        color: C.textSec,
                      }
                    },
                      icon ? React.createElement('i', { className: 'fa-solid ' + icon, style: { marginRight: '6px' } }) : null,
                      famille
                    )
                  ));
                  // Lignes opérations
                  famRows.forEach(function (r, ri) {
                    elems.push(React.createElement('tr', {
                      key: 'op-' + famille + '-' + ri,
                      style: { background: ri % 2 === 0 ? C.surface : C.surface2 }
                    },
                      React.createElement('td', { style: Object.assign({}, tdFirstStyle, { paddingLeft: '24px' }) }, r.operation),
                      periodes.map(function (p) {
                        return React.createElement(React.Fragment, { key: p }, renderVal(r.byPeriode[p]));
                      }),
                      React.createElement('td', {
                        style: Object.assign({}, tdStyle, { fontWeight: 600 })
                      },
                        metric === 'cout' ? fmtDH(r.total.cout) : fmtJH(r.total.jh)
                      ),
                      showBudget
                        ? budgetTds({
                            budget: budgetIndex.operation(r.code, r.operation, r.famille),
                            jh: r.total.jh,
                            base: tdStyle,
                            keyPrefix: 'op-' + famille + '-' + ri,
                          })
                        : null
                    ));
                  });
                  // Ligne total famille
                  elems.push(React.createElement('tr', {
                    key: 'famtotal-' + famille,
                    style: { background: '#d4d3cc' }
                  },
                    React.createElement('td', {
                      style: Object.assign({}, tdFirstStyle, { fontWeight: 700, paddingLeft: '16px' })
                    }, 'Total ' + famille),
                    periodes.map(function (p) {
                      var cell = famTotal.byP[p];
                      var v = cell ? (metric === 'cout' ? cell.cout : cell.jh) : 0;
                      return React.createElement('td', { key: p, style: Object.assign({}, tdStyle, { fontWeight: 700 }) },
                        v ? (metric === 'cout' ? fmtDH(v) : fmtJH(v)) : '—'
                      );
                    }),
                    React.createElement('td', {
                      style: Object.assign({}, tdStyle, { fontWeight: 700 })
                    },
                      metric === 'cout' ? fmtDH(famTotal.total.cout) : fmtJH(famTotal.total.jh)
                    ),
                    showBudget
                      ? budgetTds({
                          budget: budgetFamilles.parFamille[famille],
                          jh: famTotal.total.jh,
                          base: Object.assign({}, tdStyle, { fontWeight: 700 }),
                          keyPrefix: 'famtotal-' + famille,
                        })
                      : null
                  ));
                  return elems;
                }),
                // Total général
                React.createElement('tr', {
                  style: { background: C.berry }
                },
                  React.createElement('td', {
                    style: { padding: '8px 10px', fontWeight: 700, fontSize: '13px', color: '#fff', textAlign: 'left' }
                  }, 'TOTAL GÉNÉRAL'),
                  periodes.map(function (p) {
                    var cell = grandTotals.byP[p];
                    var v = cell ? (metric === 'cout' ? cell.cout : cell.jh) : 0;
                    return React.createElement('td', {
                      key: p,
                      style: { padding: '8px 10px', fontWeight: 700, fontSize: '13px', color: '#fff', textAlign: 'right' }
                    }, v ? (metric === 'cout' ? fmtDH(v) : fmtJH(v)) : '—');
                  }),
                  React.createElement('td', {
                    style: { padding: '8px 10px', fontWeight: 700, fontSize: '13px', color: '#fff', textAlign: 'right' }
                  },
                    metric === 'cout' ? fmtDH(grandTotals.total.cout) : fmtJH(grandTotals.total.jh)
                  ),
                  // Suivi budgétaire du TOTAL : comparaison à PÉRIMÈTRE ÉGAL
                  // (budgetScope), identique à la feuille Excel — les JH d'une
                  // famille non budgétée ne consomment aucun budget.
                  showBudget && budgetScope
                    ? budgetTds({
                        budget: budgetScope.budget,
                        jh: budgetScope.jh,
                        jhTotal: grandTotals.total.jh,
                        base: { padding: '8px 10px', fontWeight: 700, fontSize: '13px', color: '#fff', textAlign: 'right' },
                        keyPrefix: 'total-general',
                      })
                    : null
                )
              )
            ),
            // Mention de périmètre — MÊME libellé que sous le tableau Excel.
            showBudget && budgetScope && budgetScope.nFamilles > 0
              ? React.createElement('div', {
                  style: { marginTop: '8px', fontSize: '11px', color: C.textSec, fontStyle: 'italic' }
                }, CEU.scopeNote(budgetScope.nBudgetees, budgetScope.nFamilles, 'familles budgétées'))
              : null
          )
  );
}

export { VarieteView };
