/*
 * ArticleConversionFields.jsx — les deux champs de conversion d'unité d'une
 * fiche article : « unité de consommation » et le facteur qui la relie à
 * l'unité de stock.
 *
 * POURQUOI UN COMPOSANT PARTAGÉ : ces deux champs sont saisis à DEUX endroits
 * — la fiche article (Stock › Articles, réservée à achats/dg) et l'écran de
 * saisie d'un bon de consommation (le magasinier, qui n'a PAS accès à la
 * fiche mais qui est celui qui connaît le poids d'un fût). Deux formulaires
 * séparés auraient divergé, et le sens du facteur avec eux.
 *
 * ⚠️ LE SENS DU FACTEUR EST LA SEULE CHOSE QUI COMPTE ICI. Un champ « facteur »
 * demandant un nombre nu (1,32) sera inversé par le premier utilisateur, et
 * personne ne le verra : le stock sera simplement faux de 32 %. Le champ est
 * donc encadré par la phrase complète, affichée en direct et avec les vraies
 * unités de l'article :
 *
 *        1 [L] = [ 1,32 ] KG
 *
 * On saisit dans le trou d'une phrase, pas dans un champ abstrait.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE
 * GLOBAL du navigateur : tout est wrappé dans une IIFE, aucun identifiant
 * top-level ne fuite (cf. crashes #75/#77). Un seul global exposé :
 *   window.ArticleConversionFields
 *
 * Props :
 *   - uniteStock          : unité où le solde est tenu (ex. 'KG'). Obligatoire.
 *   - uniteConsommation   : valeur courante ('' = pas de conversion)
 *   - facteur             : valeur courante (string ou number, '' = absent)
 *   - onChange(patch)     : { unite_consommation?, stock_par_unite_consommation? }
 *   - disabled            : lecture seule
 *   - compact             : rendu resserré (fenêtre de saisie)
 */
(function () {
  'use strict';

  var _r = window.React;
  if (!_r) return;
  var React = _r;

  /** Unités proposables en consommation. Liste courte et fermée : le choix
   *  libre est précisément ce qui a produit les 87 lignes divergentes. */
  var UNITES_CONSO = ['L', 'KG', 'Unité', 'Sac', 'Bidon'];
  function ArticleConversionFields(props) {
    var uniteStock = (props.uniteStock || '').trim();
    var uniteConso = (props.uniteConsommation || '').trim();
    var facteurBrut = props.facteur === null || props.facteur === undefined ? '' : String(props.facteur);
    var onChange = props.onChange || function () {};
    var UCU = window.UniteConsoUtils;
    var fieldStyle = {
      padding: props.compact ? '4px 8px' : '8px 12px',
      borderRadius: 8,
      border: '1px solid #ddd',
      fontSize: props.compact ? 12 : 13,
      boxSizing: 'border-box'
    };
    var labelStyle = {
      fontSize: 12,
      fontWeight: 600,
      display: 'block',
      marginBottom: 4,
      color: '#555'
    };

    // Unité de consommation identique à l'unité de stock : il n'y a rien à
    // convertir. On le DIT, au lieu de laisser saisir un facteur qui ne
    // servirait jamais.
    var memeUnite = !!uniteConso && !!UCU && UCU.normaliserUnite(uniteConso) === UCU.normaliserUnite(uniteStock);
    var facteurLu = UCU ? UCU.lireFacteur(facteurBrut) : null;
    var facteurManquant = !!uniteConso && !memeUnite && facteurLu === null;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: props.compact ? 8 : 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: '#555',
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-right-left",
      style: {
        marginRight: 6
      }
    }), "Unit\xE9 de consommation (optionnelle)"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#888',
        marginBottom: 8
      }
    }, "\xC0 renseigner uniquement si l'article est ", /*#__PURE__*/React.createElement("strong", null, "consomm\xE9 dans une autre unit\xE9"), " que celle du stock (", uniteStock || '—', "). Exemple : un acide stock\xE9 au KG et dos\xE9 au litre."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 130
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: labelStyle
    }, "Consomm\xE9 en"), /*#__PURE__*/React.createElement("select", {
      value: uniteConso,
      disabled: props.disabled,
      onChange: function (e) {
        onChange({
          unite_consommation: e.target.value
        });
      },
      style: Object.assign({
        width: '100%'
      }, fieldStyle)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u2014 m\xEAme unit\xE9 que le stock \u2014"), UNITES_CONSO.map(function (u) {
      return /*#__PURE__*/React.createElement("option", {
        key: u,
        value: u
      }, u);
    })))), !!uniteConso && !memeUnite && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        padding: '10px 12px',
        borderRadius: 8,
        background: '#f6f9ff',
        border: '1px solid #cfe0ff'
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: labelStyle
    }, "Conversion"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 14,
        fontWeight: 600,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("span", null, "1 ", uniteConso, " ="), /*#__PURE__*/React.createElement("input", {
      type: "text",
      inputMode: "decimal",
      value: facteurBrut,
      disabled: props.disabled,
      placeholder: "1,32",
      onChange: function (e) {
        onChange({
          stock_par_unite_consommation: e.target.value
        });
      },
      style: Object.assign({
        width: 110,
        fontFamily: 'monospace',
        textAlign: 'right'
      }, fieldStyle)
    }), /*#__PURE__*/React.createElement("span", null, uniteStock || '—')), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#666',
        marginTop: 6
      }
    }, "Combien p\xE8se (ou vaut) ", /*#__PURE__*/React.createElement("strong", null, "UNE unit\xE9 consomm\xE9e"), ", exprim\xE9e dans l'unit\xE9 du stock. Un f\xFBt de 25 ", uniteConso, " qui p\xE8se 33 ", uniteStock || 'KG', " donne 33 \xF7 25 = 1,32."), facteurManquant && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#a01d10',
        marginTop: 6,
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 4
      }
    }), "Sans ce nombre, les consommations en ", uniteConso, " seront d\xE9duites telles quelles du stock en ", uniteStock || '—', " \u2014 et signal\xE9es comme non converties."), !facteurManquant && facteurLu !== null && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--green)',
        marginTop: 6,
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-check",
      style: {
        marginRight: 4
      }
    }), "Consommer 5 ", uniteConso, " d\xE9duira ", Math.round(5 * facteurLu * 1e6) / 1e6, " ", uniteStock, " du stock.")), memeUnite && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#888',
        marginTop: 8
      }
    }, "Cette unit\xE9 est d\xE9j\xE0 celle du stock : aucune conversion n'est n\xE9cessaire."));
  }
  window.ArticleConversionFields = ArticleConversionFields;
})();
