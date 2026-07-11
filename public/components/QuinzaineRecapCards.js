/*
 * QuinzaineRecapCards.jsx — Cartes Récap Quinzaine (rendu partagé).
 *
 * Composant de rendu PUR extrait de DashboardTab et QuinzaineTab.
 * Aucune logique de calcul ici — les calculs restent dans chaque écran.
 *
 * Props :
 *   recapItems   {Array}   Tableau de cartes :
 *                            { label, icon, color, montant, popupKey?, subItems? }
 *   totalGlobal  {number}  Somme de tous les montants (pour % et barre).
 *   nbJours      {number}  Nombre de jours de la quinzaine (pour badge Moy/jour).
 *   badges       {Array}   Badges affichés dans l'en-tête (au-dessus de la grille).
 *                            Chaque badge : { bg, color, icon, text }
 *   clickable    {bool}    true → onClick+cursor:pointer sur chaque carte.
 *                          false → hover seul, pas de onClick.
 *   externalPopup {bool}  true → désactive le modal interne ; le parent gère son propre popup.
 *   popup        {object|null}
 *                  Quand clickable=true :
 *                    { current, setCurrent, data }
 *                      data = { quinzaineData, quinzParFerme, moParJour,
 *                               qRecolteRows, recolteTopWorkers,
 *                               tDates, qTransportRows, transportDetail,
 *                               traitWD, traitDetail,
 *                               condDetailQ, chargDetailQ, ferieDetailQ,
 *                               totalTraitement, totalConditionnement,
 *                               totalChargement, totalJourFerie,
 *                               currentQuinz, farmFilter, nbJours,
 *                               openWorkerDetail }
 *                  Quand clickable=false : null.
 *
 * Hypothèses (documentées dans le commit) :
 *  - Le composant ne gère PAS le wrapper extérieur (Panel / quinzaine-card).
 *    Chaque écran conserve son propre wrapper pour éviter toute régression layout.
 *  - Le pop-up est inclus dans ce composant car son state (popup.current) est
 *    étroitement lié aux onClick des cartes.
 *  - Les variables CSS (--berry, --orange, --green, etc.) sont définies globalement
 *    dans index.html et disponibles dans ce scope.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js.
 * IIFE → expose UNIQUEMENT window.QuinzaineRecapCards (pas de collision top-level).
 */
(function () {
  'use strict';

  var useState = React.useState;
  function QuinzaineRecapCards(props) {
    var recapItems = props.recapItems || [];
    var totalGlobal = props.totalGlobal || 0;
    var nbJours = props.nbJours || 0;
    var badges = props.badges || [];
    var clickable = !!props.clickable;
    var popup = props.popup || null; // { current, setCurrent, data }
    var externalPopup = !!props.externalPopup; // true → skip built-in modal, caller renders its own

    // ── Grille de cartes ──────────────────────────────────────────────────────

    var cards = recapItems.map(function (item, i) {
      var cardStyle = {
        background: '#fff',
        borderRadius: 12,
        padding: 16,
        border: '2px solid ' + item.color,
        boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
        transition: 'all 0.2s'
      };
      if (clickable) {
        cardStyle.cursor = 'pointer';
      }
      var handleClick = clickable && popup ? function () {
        popup.setCurrent(item.popupKey);
      } : undefined;
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        style: cardStyle,
        onClick: handleClick,
        onMouseEnter: function (e) {
          e.currentTarget.style.transform = 'translateY(-3px)';
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
        },
        onMouseLeave: function (e) {
          e.currentTarget.style.transform = '';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)';
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: 36,
          height: 36,
          borderRadius: 10,
          background: item.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 14
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: 'fa-solid ' + item.icon
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--gray-600)'
        }
      }, item.label)), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 22,
          fontWeight: 800,
          color: item.color
        }
      }, Math.round(item.montant).toLocaleString('fr-FR'), " DH"), totalGlobal > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 10,
          color: 'var(--gray-400)'
        }
      }, Math.round(item.montant / totalGlobal * 100), "% du total"), clickable && /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 9,
          color: item.color
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-up-right-from-square",
        style: {
          marginRight: 3
        }
      }), "D\xE9tail")), item.subItems && /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: 8,
          borderTop: '1px solid var(--gray-100)',
          paddingTop: 8
        }
      }, item.subItems.map(function (sub, j) {
        return /*#__PURE__*/React.createElement("div", {
          key: j,
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'var(--gray-500)',
            marginBottom: 2
          }
        }, /*#__PURE__*/React.createElement("span", null, sub.label), /*#__PURE__*/React.createElement("span", {
          style: {
            fontWeight: 600
          }
        }, Math.round(sub.montant).toLocaleString('fr-FR'), " DH"));
      })));
    });

    // ── Barre de répartition ─────────────────────────────────────────────────

    var repartition = null;
    if (totalGlobal > 0) {
      var barSegments = recapItems.filter(function (it) {
        return it.montant > 0;
      }).map(function (item, i) {
        return /*#__PURE__*/React.createElement("div", {
          key: i,
          style: {
            width: item.montant / totalGlobal * 100 + '%',
            background: item.color,
            borderRadius: 2
          },
          title: item.label + ': ' + Math.round(item.montant / totalGlobal * 100) + '%'
        });
      });
      var legendItems = recapItems.filter(function (it) {
        return it.montant > 0;
      }).map(function (item, i) {
        return /*#__PURE__*/React.createElement("span", {
          key: i,
          style: {
            fontSize: 10,
            color: 'var(--gray-500)',
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            width: 8,
            height: 8,
            borderRadius: 2,
            background: item.color,
            display: 'inline-block'
          }
        }), item.label, " (", Math.round(item.montant / totalGlobal * 100), "%)");
      });
      repartition = /*#__PURE__*/React.createElement("div", {
        style: {
          background: 'var(--gray-50)',
          borderRadius: 10,
          padding: 12
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--gray-500)',
          marginBottom: 8
        }
      }, "R\xE9partition des co\xFBts"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          gap: 1
        }
      }, barSegments), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: 12,
          marginTop: 6,
          flexWrap: 'wrap'
        }
      }, legendItems));
    }

    // ── Note "Cliquez" (DashboardTab seulement) ──────────────────────────────

    var clickHint = clickable ? /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: 'var(--gray-400)',
        textAlign: 'center',
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-hand-pointer",
      style: {
        marginRight: 4
      }
    }), "Cliquez sur une cat\xE9gorie pour voir le d\xE9tail") : null;

    // ── Pop-up détail (DashboardTab seulement) ────────────────────────────────

    var modal = null;
    if (clickable && popup && popup.current && !externalPopup) {
      var d = popup.data || {};
      var currentQuinz = d.currentQuinz || '';
      var farmFilter = d.farmFilter || '';
      var quinzainePopup = popup.current;
      var setQuinzainePopup = popup.setCurrent;

      // Couleur et icône de la catégorie active
      var popupColor = quinzainePopup === 'mo' ? 'var(--berry)' : quinzainePopup === 'recolte' ? 'var(--orange)' : quinzainePopup === 'transport' ? 'var(--green)' : 'var(--blue)';
      var popupIcon = quinzainePopup === 'mo' ? 'fa-users' : quinzainePopup === 'recolte' ? 'fa-coins' : quinzainePopup === 'transport' ? 'fa-bus' : 'fa-spray-can-sparkles';
      var popupTitle = quinzainePopup === 'mo' ? "Main d'Oeuvre" : quinzainePopup === 'recolte' ? 'Prime Récolte' : quinzainePopup === 'transport' ? 'Prime Transport' : 'Prime Traitement';

      // ── Sections de contenu du pop-up ────────────────────────────────────

      var popupBody = null;
      if (quinzainePopup === 'mo') {
        var quinzaineData = d.quinzaineData || null;
        var quinzParFerme = d.quinzParFerme || [];
        var moParJour = d.moParJour || [];
        var totalMainOeuvre = (recapItems.find(function (it) {
          return it.popupKey === 'mo';
        }) || {}).montant || 0;
        popupBody = /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(3,1fr)',
            gap: 12,
            marginBottom: 20
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--berry-pale)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--berry)'
          }
        }, Math.round(totalMainOeuvre).toLocaleString('fr-FR'), " DH"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Co\xFBt total M.O")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, quinzaineData && quinzaineData.totalJournees ? quinzaineData.totalJournees : '-'), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Journ\xE9es ouvri\xE8res")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, nbJours > 0 ? Math.round(totalMainOeuvre / nbJours).toLocaleString('fr-FR') : '-', " DH"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Moyenne / jour"))), !farmFilter && quinzParFerme.length > 0 && /*#__PURE__*/React.createElement("div", {
          style: {
            marginBottom: 16
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--gray-600)',
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-building",
          style: {
            marginRight: 6,
            color: 'var(--berry)'
          }
        }), "Par Ferme"), /*#__PURE__*/React.createElement("table", {
          className: "data-table",
          style: {
            fontSize: 11
          }
        }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Ferme"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Journ\xE9es"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "R\xE9colte"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Hors R\xE9colte"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Ouvriers Avocatier"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Co\xFBt (DH)"))), /*#__PURE__*/React.createElement("tbody", null, quinzParFerme.map(function (f, i) {
          return /*#__PURE__*/React.createElement("tr", {
            key: i
          }, /*#__PURE__*/React.createElement("td", {
            style: {
              fontWeight: 600
            }
          }, f.ferme), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, f.journees), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, f.recolte), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, f.horsRecolte), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, f.postesFixes), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right',
              fontWeight: 700,
              color: 'var(--berry)'
            }
          }, Math.round(f.cout).toLocaleString('fr-FR')));
        })))), moParJour.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--gray-600)',
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-calendar-days",
          style: {
            marginRight: 6,
            color: 'var(--berry)'
          }
        }), "Par Jour"), /*#__PURE__*/React.createElement("table", {
          className: "data-table",
          style: {
            fontSize: 11
          }
        }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Jour"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Nb Ouvriers"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Journ\xE9es"), !farmFilter && /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "F1"), !farmFilter && /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "F5"), !farmFilter && /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Avo"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Co\xFBt (DH)"))), /*#__PURE__*/React.createElement("tbody", null, moParJour.map(function (j, i) {
          return /*#__PURE__*/React.createElement("tr", {
            key: i
          }, /*#__PURE__*/React.createElement("td", {
            style: {
              fontWeight: 500
            }
          }, j.jourLabel), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, j.nbOuv), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, Math.round(j.journees * 100) / 100), !farmFilter && /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, j.F1 || 0), !farmFilter && /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, j.F5 || 0), !farmFilter && /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, j.Avocatier || 0), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right',
              fontWeight: 700,
              color: 'var(--berry)'
            }
          }, Math.round(j.cout).toLocaleString('fr-FR')));
        })))));
      } else if (quinzainePopup === 'recolte') {
        var qRecolteRows = d.qRecolteRows || [];
        var recolteByWorker = d.recolteByWorker || {};
        var recolteTopWorkers = d.recolteTopWorkers || [];
        var totalPrimeRecolte = (recapItems.find(function (it) {
          return it.popupKey === 'recolte';
        }) || {}).montant || 0;
        var openWorkerDetail = d.openWorkerDetail || null;
        popupBody = /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(3,1fr)',
            gap: 12,
            marginBottom: 20
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'rgba(243,156,18,0.1)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--orange)'
          }
        }, Math.round(totalPrimeRecolte).toLocaleString('fr-FR'), " DH"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Total primes r\xE9colte")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, qRecolteRows.length), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Lignes pointage")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, Object.keys(recolteByWorker).length), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Ouvriers avec prime"))), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 11,
            color: 'var(--gray-500)',
            marginBottom: 8,
            padding: '8px 12px',
            background: 'var(--gray-50)',
            borderRadius: 8
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-info-circle",
          style: {
            marginRight: 4,
            color: 'var(--orange)'
          }
        }), "Bar\xE8me: <20kg = 0 DH | 20-24kg = 20 DH | 25-29kg = 40 DH | 30-39kg = 60+3/kg | 40+kg = 100+4/kg"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--gray-600)',
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-ranking-star",
          style: {
            marginRight: 6,
            color: 'var(--orange)'
          }
        }), "Top 20 Ouvriers"), /*#__PURE__*/React.createElement("table", {
          className: "data-table",
          style: {
            fontSize: 11
          }
        }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "#"), /*#__PURE__*/React.createElement("th", null, "Matricule"), /*#__PURE__*/React.createElement("th", null, "Nom"), /*#__PURE__*/React.createElement("th", null, "Ferme"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Jours"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Total Kg"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Moy/jour"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Prime (DH)"))), /*#__PURE__*/React.createElement("tbody", null, recolteTopWorkers.map(function (w, i) {
          return /*#__PURE__*/React.createElement("tr", {
            key: i,
            style: {
              cursor: 'pointer'
            },
            onClick: function () {
              setQuinzainePopup(null);
              if (openWorkerDetail) openWorkerDetail(w.matricule);
            }
          }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
            className: 'rank ' + (i < 3 ? 'rank-' + (i + 1) : 'rank-other')
          }, i + 1)), /*#__PURE__*/React.createElement("td", {
            style: {
              fontFamily: 'monospace',
              fontWeight: 600
            }
          }, w.matricule), /*#__PURE__*/React.createElement("td", {
            style: {
              fontWeight: 500
            }
          }, w.nom), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
            className: "status-badge",
            style: {
              background: 'var(--berry-pale)',
              color: 'var(--berry)',
              fontSize: 10
            }
          }, w.ferme)), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, w.jours), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right',
              fontWeight: 600
            }
          }, Math.round(w.totalKg)), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right',
              color: 'var(--gray-500)'
            }
          }, w.jours > 0 ? Math.round(w.totalKg / w.jours) : 0, " kg"), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right',
              fontWeight: 700,
              color: 'var(--orange)'
            }
          }, Math.round(w.prime).toLocaleString('fr-FR')));
        }))));
      } else if (quinzainePopup === 'transport') {
        var tDates = d.tDates || [];
        var qTransportRows = d.qTransportRows || [];
        var transportDetail = d.transportDetail || [];
        var totalTransport = (recapItems.find(function (it) {
          return it.popupKey === 'transport';
        }) || {}).montant || 0;
        popupBody = /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(3,1fr)',
            gap: 12,
            marginBottom: 20
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'rgba(39,174,96,0.1)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--green)'
          }
        }, Math.round(totalTransport).toLocaleString('fr-FR'), " DH"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Total prime transport")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, tDates.length), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Jours travaill\xE9s")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, qTransportRows.length), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Ouvriers-jours transport\xE9s"))), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--gray-600)',
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-bus",
          style: {
            marginRight: 6,
            color: 'var(--green)'
          }
        }), "Par \xC9quipe de Transport"), /*#__PURE__*/React.createElement("table", {
          className: "data-table",
          style: {
            fontSize: 11
          }
        }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "\xC9quipe"), /*#__PURE__*/React.createElement("th", null, "Caporal"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Co\xFBt/ouv"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Total ouv-jours"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Total (DH)"))), /*#__PURE__*/React.createElement("tbody", null, transportDetail.map(function (t, i) {
          return /*#__PURE__*/React.createElement("tr", {
            key: i
          }, /*#__PURE__*/React.createElement("td", {
            style: {
              fontWeight: 600
            }
          }, /*#__PURE__*/React.createElement("span", {
            style: {
              background: 'var(--green-pale)',
              color: 'var(--green)',
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              marginRight: 4
            }
          }, t.prefix), t.equipe), /*#__PURE__*/React.createElement("td", {
            style: {
              color: 'var(--gray-500)'
            }
          }, t.caporal), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, t.cout, " DH"), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, t.totalWorkers), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right',
              fontWeight: 700,
              color: 'var(--green)'
            }
          }, Math.round(t.total).toLocaleString('fr-FR')));
        }), /*#__PURE__*/React.createElement("tr", {
          style: {
            fontWeight: 700,
            borderTop: '2px solid var(--gray-200)'
          }
        }, /*#__PURE__*/React.createElement("td", {
          colSpan: "3"
        }, "Total"), /*#__PURE__*/React.createElement("td", {
          style: {
            textAlign: 'right'
          }
        }, transportDetail.reduce(function (s, t) {
          return s + t.totalWorkers;
        }, 0)), /*#__PURE__*/React.createElement("td", {
          style: {
            textAlign: 'right',
            color: 'var(--green)'
          }
        }, Math.round(totalTransport).toLocaleString('fr-FR'), " DH")))));
      } else if (quinzainePopup === 'traitement') {
        var traitWD = d.traitWD || {
          size: 0
        };
        var traitDetail = d.traitDetail || [];
        var totalTraitement = d.totalTraitement || 0;
        popupBody = /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(3,1fr)',
            gap: 12,
            marginBottom: 20
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'rgba(52,152,219,0.1)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--blue)'
          }
        }, Math.round(totalTraitement).toLocaleString('fr-FR'), " DH"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Total prime traitement")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, traitWD.size), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Ouvriers-jours traitement")), /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 14,
            background: 'var(--gray-50)',
            borderRadius: 10
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--dark)'
          }
        }, "10 DH"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Prime / ouvrier / jour"))), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--gray-600)',
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-calendar-days",
          style: {
            marginRight: 6,
            color: 'var(--blue)'
          }
        }), "Par Jour"), traitDetail.length > 0 ? /*#__PURE__*/React.createElement("table", {
          className: "data-table",
          style: {
            fontSize: 11
          }
        }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Jour"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Nb Ouvriers"), /*#__PURE__*/React.createElement("th", {
          style: {
            textAlign: 'right'
          }
        }, "Montant (DH)"))), /*#__PURE__*/React.createElement("tbody", null, traitDetail.map(function (t, i) {
          return /*#__PURE__*/React.createElement("tr", {
            key: i
          }, /*#__PURE__*/React.createElement("td", {
            style: {
              fontWeight: 500
            }
          }, t.jourLabel), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right'
            }
          }, t.nb), /*#__PURE__*/React.createElement("td", {
            style: {
              textAlign: 'right',
              fontWeight: 700,
              color: 'var(--blue)'
            }
          }, t.montant.toLocaleString('fr-FR')));
        }), /*#__PURE__*/React.createElement("tr", {
          style: {
            fontWeight: 700,
            borderTop: '2px solid var(--gray-200)'
          }
        }, /*#__PURE__*/React.createElement("td", null, "Total"), /*#__PURE__*/React.createElement("td", {
          style: {
            textAlign: 'right'
          }
        }, traitWD.size), /*#__PURE__*/React.createElement("td", {
          style: {
            textAlign: 'right',
            color: 'var(--blue)'
          }
        }, Math.round(totalTraitement).toLocaleString('fr-FR'), " DH")))) : /*#__PURE__*/React.createElement("div", {
          style: {
            textAlign: 'center',
            padding: 30,
            color: 'var(--gray-400)'
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-info-circle",
          style: {
            fontSize: 24,
            marginBottom: 8,
            display: 'block'
          }
        }), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 12
          }
        }, "Aucun jour de traitement phyto enregistr\xE9 cette quinzaine"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            marginTop: 4
          }
        }, "Les op\xE9rations \"Traitement\" dans BEE ONE g\xE9n\xE8rent une prime de 10 DH/ouvrier/jour")));
      } else if (quinzainePopup === 'autres_primes') {
        var traitWD2 = d.traitWD || {
          size: 0
        };
        var condDetailQ = d.condDetailQ || [];
        var chargDetailQ = d.chargDetailQ || [];
        var ferieDetailQ = d.ferieDetailQ || [];
        var totalTraitement2 = d.totalTraitement || 0;
        var totalConditionnement = d.totalConditionnement || 0;
        var totalChargement = d.totalChargement || 0;
        var totalJourFerie = d.totalJourFerie || 0;
        var totalAutresPrimes = (recapItems.find(function (it) {
          return it.popupKey === 'autres_primes';
        }) || {}).montant || 0;
        var autresList = [{
          label: 'Traitement',
          icon: 'fa-spray-can-sparkles',
          color: 'var(--blue)',
          montant: totalTraitement2,
          jh: traitWD2.size
        }, {
          label: 'Conditionnement',
          icon: 'fa-box-open',
          color: '#e67e22',
          montant: totalConditionnement,
          jh: condDetailQ.reduce(function (s, w) {
            return s + w.jh;
          }, 0)
        }, {
          label: 'Chargement',
          icon: 'fa-truck-loading',
          color: '#8e44ad',
          montant: totalChargement,
          jh: chargDetailQ.reduce(function (s, w) {
            return s + w.jh;
          }, 0)
        }, {
          label: 'Jour Férié',
          icon: 'fa-star',
          color: '#c0392b',
          montant: totalJourFerie,
          jh: ferieDetailQ.reduce(function (s, w) {
            return s + w.jh;
          }, 0)
        }];
        popupBody = /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(2,1fr)',
            gap: 12,
            marginBottom: 20
          }
        }, autresList.map(function (p, i) {
          return /*#__PURE__*/React.createElement("div", {
            key: i,
            style: {
              padding: 14,
              background: p.color + '11',
              borderRadius: 10,
              borderLeft: '3px solid ' + p.color
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }
          }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("i", {
            className: 'fa-solid ' + p.icon,
            style: {
              color: p.color,
              marginRight: 6
            }
          }), /*#__PURE__*/React.createElement("span", {
            style: {
              fontWeight: 600,
              fontSize: 12
            }
          }, p.label)), /*#__PURE__*/React.createElement("span", {
            style: {
              fontSize: 10,
              color: 'var(--gray-500)'
            }
          }, p.jh, " JH")), /*#__PURE__*/React.createElement("div", {
            style: {
              fontSize: 20,
              fontWeight: 800,
              color: p.color,
              marginTop: 6
            }
          }, Math.round(p.montant).toLocaleString('fr-FR'), " DH"));
        })), /*#__PURE__*/React.createElement("div", {
          style: {
            padding: 12,
            background: 'rgba(142,68,173,0.06)',
            borderRadius: 10,
            textAlign: 'center'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: 'var(--gray-500)'
          }
        }, "Total Autres Primes"), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 28,
            fontWeight: 800,
            color: '#8e44ad'
          }
        }, Math.round(totalAutresPrimes).toLocaleString('fr-FR'), " DH")));
      }
      modal = /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        },
        onClick: function () {
          setQuinzainePopup(null);
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#fff',
          borderRadius: 16,
          maxWidth: 900,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
        },
        onClick: function (e) {
          e.stopPropagation();
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          padding: '16px 24px',
          borderBottom: '2px solid var(--gray-100)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: 40,
          height: 40,
          borderRadius: 10,
          background: popupColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 16
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: 'fa-solid ' + popupIcon
      })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
        style: {
          margin: 0,
          fontSize: 17,
          color: 'var(--berry)'
        }
      }, popupTitle), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          color: 'var(--gray-500)',
          marginTop: 2
        }
      }, currentQuinz, farmFilter ? ' — ' + farmFilter : ''))), /*#__PURE__*/React.createElement("button", {
        onClick: function () {
          setQuinzainePopup(null);
        },
        style: {
          background: 'none',
          border: 'none',
          fontSize: 22,
          cursor: 'pointer',
          color: 'var(--gray-400)',
          padding: 4
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-xmark"
      }))), /*#__PURE__*/React.createElement("div", {
        style: {
          padding: '20px 24px'
        }
      }, popupBody)));
    }

    // ── Rendu final ───────────────────────────────────────────────────────────

    return /*#__PURE__*/React.createElement(React.Fragment, null, badges.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        marginBottom: 16,
        alignItems: 'center',
        flexWrap: 'wrap'
      }
    }, badges.map(function (b, i) {
      return /*#__PURE__*/React.createElement("span", {
        key: i,
        style: {
          background: b.bg,
          color: b.color,
          padding: '4px 12px',
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 600
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: 'fa-solid ' + b.icon,
        style: {
          marginRight: 4
        }
      }), b.text);
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
        marginBottom: 16
      }
    }, cards), repartition, clickHint, modal);
  }
  window.QuinzaineRecapCards = QuinzaineRecapCards;
})();
