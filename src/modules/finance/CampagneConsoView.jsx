/*
 * CampagneConsoView.jsx — vue « Consommations » (intrants) de l'écran
 * Campagne (CampagneAnalytiqueTab) : buckets de consommation, classement
 * d'un article au catalogue par la DG.
 *
 * Extrait de CampagneAnalytiqueTab.jsx (déplacement de code, sans modification).
 */

import { C, FAMILLE_ICONS, CAT_CULTURE_INCONNUE, fmtDH, fmtJH, fmtHa, fmtHaLabel, fmtDHPerHa, fmtQty, cultureOf, matchCulture, sbNom, sbHa, CAT_budgetsByLabel, CAT_opBudgetsByLabel, buildVarieteView, CAT_pivotRows, CAT_byCulture } from './campagneAnalytiqueHelpers.jsx';

var useState = React.useState;
var useMemo = React.useMemo;

/* ------------------------------------------------------------------ */
/* Sous-composant : Vue Conso (Engrais / Pesticides)                   */
/* ------------------------------------------------------------------ */

/**
 * Seau de données par sous-onglet. LOOKUP, pas ternaire : le payload porte
 * désormais un TROISIÈME seau (`aClasser`), et un
 * `subTab === 'engrais' ? … : …` rangeait tout ce qui n'est pas 'engrais'
 * dans les pesticides — exactement le genre de repli muet que ce ticket
 * supprime. Une clé inconnue ne montre RIEN plutôt que n'importe quoi.
 */
var CONSO_BUCKETS = {
  engrais:    { items: 'engrais',    cout: 'totalEngraisCout' },
  pesticides: { items: 'pesticides', cout: 'totalPesticidesCout' },
};

/* ------------------------------------------------------------------ */
/* Classement d'un article depuis le bandeau « à classer »             */
/* ------------------------------------------------------------------ */

/**
 * Marqueur posé par le backend (`articlesAClasser`) quand l'article n'a
 * AUCUNE fiche exploitable au catalogue. Ces articles-là ne sont pas
 * classables : il n'y a rien à mettre à jour. On ne crée rien depuis cet
 * écran (décision Omar : l'orthographe des deux cas connus — GENAKTIS,
 * Maspilan — est à vérifier sur le bon papier d'abord).
 */
var CAT_SANS_FICHE = 'absent du catalogue';

/**
 * Le profil courant peut-il classer un article ?
 * Le contrôle n'est affiché QUE dans ce cas : montrer un bouton qui rendra
 * 403 est pire que ne rien montrer. C'est du confort d'affichage — la
 * décision qui compte est prise SERVEUR (lib/stockRoles).
 * @param {*} role profil courant (via props.userRole)
 * @returns {boolean}
 */
function CAT_peutClasser(role) {
  return role === 'achats' || role === 'dg';
}

/**
 * Classe un article PAR SON NOM (toutes ses fiches actives homonymes).
 * Écriture Firestore via Cloud Function uniquement, idToken en Bearer.
 * @param {string} article nom de l'article tel qu'affiché au bandeau
 * @param {string} categorie 'engrais' | 'pesticide'
 * @returns {Promise<{fiches_mises_a_jour: number}>}
 */
function CAT_classerArticle(article, categorie) {
  if (typeof firebase === 'undefined' || !firebase.auth) {
    return Promise.reject(new Error('Authentification indisponible'));
  }
  var user = firebase.auth().currentUser;
  if (!user) return Promise.reject(new Error('Non authentifié'));
  return user.getIdToken().then(function (token) {
    return fetch('/api/stock?action=classer-article', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ article: article, categorie: categorie }),
    });
  }).then(function (resp) {
    return resp.json().catch(function () {
      return { success: false, error: 'Réponse serveur invalide' };
    });
  }).then(function (json) {
    if (!json || !json.success) {
      throw new Error((json && json.error) || 'Échec du classement');
    }
    return json;
  });
}

function ConsoView(props) {
  var consoData = props.consoData;
  var subTab = props.subTab; // 'engrais' | 'pesticides'
  var farmFilter = props.farmFilter;
  var cultureFilter = props.cultureFilter;
  var sbMap = props.sbMap || {};

  var _metric = useState('perha');
  var metric = _metric[0]; var setMetric = _metric[1];

  // Classement en cours : nom de l'article verrouillé (double-clic, et le
  // reste du bandeau reste utilisable).
  var _classing = useState('');
  var classing = _classing[0]; var setClassing = _classing[1];

  // Compte rendu du dernier classement : { article, fiches, erreur }.
  var _classMsg = useState(null);
  var classMsg = _classMsg[0]; var setClassMsg = _classMsg[1];

  var bucket = CONSO_BUCKETS[subTab] || { items: '', cout: '' };
  /** Articles de la parcelle pour le sous-onglet courant. */
  var itemsOf = function (p) {
    if (!p || !bucket.items) return [];
    return p[bucket.items] || [];
  };
  /** Coût total de la parcelle pour le sous-onglet courant. */
  var coutOf = function (p) {
    if (!p || !bucket.cout) return 0;
    return p[bucket.cout] || 0;
  };

  // Articles que le catalogue ne classe ni en engrais ni en pesticide (ou
  // qui n'ont pas de fiche). Ils ne sont dans AUCUN des deux onglets : sans
  // ce bandeau, leurs quantités disparaîtraient de l'écran sans un mot.
  var aClasser = (props.consoData && props.consoData.articles_a_classer) || [];

  // Le contrôle de classement n'est proposé qu'aux profils qui peuvent
  // réellement écrire (cf. CAT_peutClasser). `onClassed` recharge la conso :
  // le backend a purgé son cache 30 min juste avant de répondre, le rechargement
  // repart donc d'un vrai recalcul — sans quoi l'article reclassé resterait
  // affiché « à classer » et la correction paraîtrait sans effet.
  var peutClasser = CAT_peutClasser(props.userRole);
  var onClassed = props.onClassed;

  /**
   * Classe un article, puis recharge les données de conso.
   * @param {string} article
   * @param {string} categorie 'engrais' | 'pesticide'
   */
  var classer = function (article, categorie) {
    if (classing) return;
    setClassing(article);
    setClassMsg(null);
    CAT_classerArticle(article, categorie).then(function (json) {
      setClassMsg({ article: article, fiches: json.fiches_mises_a_jour || 0, erreur: '' });
      setClassing('');
      if (typeof onClassed === 'function') onClassed();
    }).catch(function (e) {
      setClassMsg({ article: article, fiches: 0, erreur: e.message || 'Échec du classement' });
      setClassing('');
    });
  };

  var classBtnStyle = function (disabled) {
    return {
      padding: '3px 10px',
      border: '1px solid ' + C.border,
      borderRadius: '12px',
      background: disabled ? C.surface3 : C.surface,
      color: disabled ? C.textSec : C.text,
      fontSize: '11px',
      fontWeight: 600,
      cursor: disabled ? 'default' : 'pointer',
      marginLeft: '6px',
      whiteSpace: 'nowrap',
    };
  };

  // Parcelles filtrées
  var parcelles = useMemo(function () {
    if (!consoData) return [];
    return (consoData.parcelles || []).filter(function (p) {
      if (farmFilter && p.ferme !== farmFilter) return false;
      if (!matchCulture(p.parcelle, cultureFilter, sbMap)) return false;
      return true;
    });
  }, [consoData, farmFilter, cultureFilter, sbMap]);

  // Articles dynamiques selon le sub-tab
  var articles = useMemo(function () {
    var seen = {};
    var list = [];
    parcelles.forEach(function (p) {
      var items = itemsOf(p);
      items.forEach(function (item) {
        if (!seen[item.article]) {
          seen[item.article] = { unite: item.unite };
          list.push(item.article);
        }
      });
    });
    return list.sort();
  }, [parcelles, subTab]);

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
  var thFirstStyle = Object.assign({}, thStyle, { textAlign: 'left' });
  var tdStyle = {
    padding: '7px 10px',
    borderBottom: '1px solid ' + C.border,
    fontSize: '13px',
    color: C.text,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  };
  var tdFirstStyle = Object.assign({}, tdStyle, { textAlign: 'left', fontWeight: 500 });
  var tdDashStyle = Object.assign({}, tdStyle, { color: C.textSec });
  var totalCellStyle = {
    padding: '8px 10px',
    fontSize: '13px',
    fontWeight: 700,
    textAlign: 'right',
    whiteSpace: 'nowrap',
    color: '#fff',
  };

  // Totaux colonnes
  var colTotals = useMemo(function () {
    var byArticle = {};
    var totalDH = 0;
    parcelles.forEach(function (p) {
      var items = itemsOf(p);
      items.forEach(function (item) {
        if (!byArticle[item.article]) byArticle[item.article] = { qty: 0, cout: 0 };
        byArticle[item.article].qty += item.qty || 0;
        byArticle[item.article].cout += item.coutTotal || 0;
      });
      totalDH += coutOf(p);
    });
    return { byArticle: byArticle, totalDH: totalDH };
  }, [parcelles, subTab]);

  // Ha total (pour DH/Ha colonne totaux)
  var totalHa = useMemo(function () {
    return parcelles.reduce(function (sum, p) { return sum + (p.ha || 0); }, 0);
  }, [parcelles]);

  return React.createElement('div', null,
    // Bandeau « à classer » — affiché UNIQUEMENT s'il y a quelque chose à
    // dire. Ces articles ne sont ni dans l'onglet Engrais ni dans l'onglet
    // Pesticides : la seule correction possible est au CATALOGUE, pas ici.
    aClasser.length === 0 ? null : React.createElement('div', {
      style: {
        border: '1px solid ' + C.berry,
        borderLeft: '4px solid ' + C.berry,
        borderRadius: '6px',
        background: C.surface2,
        padding: '12px 14px',
        marginBottom: '16px',
        fontSize: '13px',
        color: C.text,
      }
    },
      React.createElement('div', { style: { fontWeight: 700, color: C.berry, marginBottom: '6px' } },
        aClasser.length + (aClasser.length > 1 ? ' articles ne sont ni engrais ni pesticide au catalogue'
                                              : ' article n\'est ni engrais ni pesticide au catalogue')
      ),
      React.createElement('div', { style: { color: C.textSec, marginBottom: '8px' } },
        peutClasser
          ? 'Leurs quantités ne sont comptées dans AUCUN des deux onglets. '
            + 'Classez-les ici : la correction porte sur la fiche catalogue, donc sur '
            + 'tout l\'historique, sans ressaisir les bons.'
          : 'Leurs quantités ne sont comptées dans AUCUN des deux onglets. '
            + 'Corrigez la catégorie de ces articles dans le catalogue (Stock › Articles) : '
            + 'la correction vaut pour tout l\'historique, sans ressaisir les bons.'
      ),
      // Compte rendu du dernier classement. Le nombre de fiches est AFFICHÉ :
      // un même nom porte souvent deux fiches au catalogue (doublons), et
      // toutes sont reclassées — le dire évite de croire à une écriture
      // partielle.
      classMsg ? React.createElement('div', {
        style: {
          marginBottom: '8px',
          padding: '6px 8px',
          borderRadius: '4px',
          background: classMsg.erreur ? '#fdecea' : '#e8f5ef',
          color: classMsg.erreur ? '#c0392b' : '#12724f',
        }
      },
        classMsg.erreur
          ? classMsg.article + ' : ' + classMsg.erreur
          : classMsg.article + ' classé — ' + classMsg.fiches
            + (classMsg.fiches > 1 ? ' fiches mises à jour' : ' fiche mise à jour')
      ) : null,
      React.createElement('ul', { style: { margin: 0, paddingLeft: '18px' } },
        aClasser.map(function (a) {
          // Article SANS fiche : rien à mettre à jour, donc aucun contrôle —
          // un bouton rendrait un 404 « aucune fiche active ». On dit quoi
          // faire à la place.
          var sansFiche = a.categorie_actuelle === CAT_SANS_FICHE;
          var enCours = classing === a.article;
          return React.createElement('li', { key: a.article, style: { marginBottom: '4px' } },
            React.createElement('strong', null, a.article),
            ' — ' + a.lignes + (a.lignes > 1 ? ' lignes' : ' ligne')
            + ', ' + fmtQty(a.quantite) + (a.unite ? ' ' + a.unite : ''),
            React.createElement('span', { style: { color: C.textSec } },
              ' (catégorie actuelle : ' + a.categorie_actuelle + ')'
            ),
            !peutClasser ? null
              : sansFiche
                ? React.createElement('span', {
                    style: { color: C.textSec, marginLeft: '6px', fontStyle: 'italic' }
                  }, '— créez d\'abord sa fiche dans Stock › Articles')
                : React.createElement('span', { style: { whiteSpace: 'nowrap' } },
                    React.createElement('button', {
                      onClick: function () { classer(a.article, 'engrais'); },
                      disabled: !!classing,
                      title: 'Classer « ' + a.article + ' » en engrais',
                      style: classBtnStyle(!!classing),
                    }, enCours ? '…' : 'Engrais'),
                    React.createElement('button', {
                      onClick: function () { classer(a.article, 'pesticide'); },
                      disabled: !!classing,
                      title: 'Classer « ' + a.article + ' » en pesticide',
                      style: classBtnStyle(!!classing),
                    }, enCours ? '…' : 'Pesticide')
                  )
          );
        })
      )
    ),
    // Barre de contrôle (métrique)
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }
    },
      React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Afficher :'),
      ['perha', 'total'].map(function (m) {
        var label = m === 'perha' ? 'Par Ha' : 'Total';
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
      })
    ),
    parcelles.length === 0
      ? React.createElement('div', {
          style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' }
        }, 'Aucune donnée pour cette sélection.')
      : React.createElement('div', { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' } },
          React.createElement('table', {
            style: { minWidth: '600px', borderCollapse: 'collapse', fontSize: '13px' }
          },
            React.createElement('thead', null,
              React.createElement('tr', null,
                React.createElement('th', { style: thFirstStyle }, 'Parcelle'),
                React.createElement('th', { style: thStyle }, 'Ferme'),
                React.createElement('th', { style: thStyle }, 'Ha'),
                articles.map(function (art) {
                  // Trouver l'unité dans les données
                  var unite = '';
                  for (var pi = 0; pi < parcelles.length; pi++) {
                    var items = itemsOf(parcelles[pi]);
                    for (var ii = 0; ii < items.length; ii++) {
                      if (items[ii].article === art) { unite = items[ii].unite || ''; break; }
                    }
                    if (unite) break;
                  }
                  return React.createElement('th', { key: art, style: thStyle },
                    art + (unite ? ' (' + unite + ')' : '')
                  );
                }),
                React.createElement('th', { style: thStyle }, 'Total DH'),
                React.createElement('th', { style: thStyle }, 'DH/Ha')
              )
            ),
            React.createElement('tbody', null,
              parcelles.map(function (p, idx) {
                var itemMap = {};
                var items = itemsOf(p);
                items.forEach(function (item) { itemMap[item.article] = item; });
                var totalParcelle = coutOf(p);
                return React.createElement('tr', {
                  key: p.parcelle,
                  style: { background: idx % 2 === 0 ? C.surface : C.surface2 }
                },
                  React.createElement('td', { style: tdFirstStyle }, p.parcelle),
                  React.createElement('td', { style: tdStyle }, p.ferme || '—'),
                  React.createElement('td', { style: tdStyle }, fmtHa(p.ha)),
                  articles.map(function (art) {
                    var item = itemMap[art];
                    if (!item || !item.qty) return React.createElement('td', { key: art, style: tdDashStyle }, '—');
                    if (metric === 'perha') {
                      var ha = p.ha || 0;
                      if (!ha) return React.createElement('td', { key: art, style: tdDashStyle }, '—');
                      return React.createElement('td', { key: art, style: tdStyle },
                        fmtQty(item.qty / ha)
                      );
                    }
                    return React.createElement('td', { key: art, style: tdStyle }, fmtQty(item.qty));
                  }),
                  React.createElement('td', { style: Object.assign({}, tdStyle, { fontWeight: 700 }) },
                    fmtDH(totalParcelle)
                  ),
                  React.createElement('td', { style: tdStyle },
                    fmtDHPerHa(totalParcelle, p.ha)
                  )
                );
              }),
              // Ligne de total
              React.createElement('tr', { style: { background: C.berry } },
                React.createElement('td', { style: Object.assign({}, totalCellStyle, { textAlign: 'left' }) }, 'TOTAL'),
                React.createElement('td', { style: totalCellStyle }, ''),
                React.createElement('td', { style: totalCellStyle }, fmtHa(totalHa)),
                articles.map(function (art) {
                  var cell = colTotals.byArticle[art];
                  if (!cell || !cell.qty) return React.createElement('td', { key: art, style: totalCellStyle }, '—');
                  if (metric === 'perha') {
                    return React.createElement('td', { key: art, style: totalCellStyle },
                      totalHa ? fmtQty(cell.qty / totalHa) : '—'
                    );
                  }
                  return React.createElement('td', { key: art, style: totalCellStyle }, fmtQty(cell.qty));
                }),
                React.createElement('td', { style: totalCellStyle }, fmtDH(colTotals.totalDH)),
                React.createElement('td', { style: totalCellStyle },
                  fmtDHPerHa(colTotals.totalDH, totalHa)
                )
              )
            )
          )
        )
  );
}

export { CONSO_BUCKETS, CAT_SANS_FICHE, CAT_peutClasser, CAT_classerArticle, ConsoView };
