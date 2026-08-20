/**
 * stockDestinations.js — Résolution des options « Magasin destination ».
 *
 * Problème résolu : le select « Magasin destination » de la réception BDC lit
 * la config stock (`stock_config/locations.magasins` = F1..F6). Un BDC porté
 * par une ferme absente de cette config (ex. BAHIA) posait un state
 * `magasin: 'BAHIA'` sans `<option value="BAHIA">` → select contrôlé
 * désynchronisé, silencieux pour le magasinier (imputation au mauvais magasin).
 *
 * `resolveDestinationOptions` réconcilie la liste config avec la ferme du BDC :
 * la ferme est TOUJOURS proposée, marquée « hors config stock » si elle n'est
 * pas déclarée, avec un warning à afficher sous le champ.
 *
 * Loaded twice:
 *   - Navigateur via <script src="lib/stockDestinations.js"> → window.StockDestinations
 *   - node:test via require('./stockDestinations.js') → module.exports
 *
 * ⚠️ Les scripts de public/lib partagent le scope global du navigateur : les
 * noms internes sont préfixés SD_ pour éviter une collision (crash #75). Seule
 * l'API publique `resolveDestinationOptions` n'est pas préfixée — nom unique
 * dans tout le repo, et c'est celui exposé via window.StockDestinations.
 *
 * 2026-08 — sb/magasin-bahia.
 */
// @ts-check
'use strict';

/** Suffixe de libellé pour une destination absente de la config stock. */
var SD_HORS_CONFIG_SUFFIX = ' (hors config stock)';

/**
 * Message affiché sous le select quand la destination n'est pas déclarée dans
 * la configuration stock.
 * @param {string} ferme
 * @returns {string}
 */
function SD_warningFor(ferme) {
  return 'Le magasin « ' + ferme + ' » n\'est pas déclaré dans la configuration stock. '
    + 'Vérifie la destination avant de valider : le stock sera imputé à ce magasin.';
}

/**
 * Clé de comparaison insensible à la casse et aux espaces de bord.
 * @param {*} v
 * @returns {string}
 */
function SD_key(v) {
  return (v === null || v === undefined) ? '' : String(v).trim().toUpperCase();
}

/**
 * Construit les options du select « Magasin destination » à partir de la liste
 * des magasins configurés et (optionnellement) de la ferme portée par le BDC.
 *
 * - `magasins` vide / non-tableau → traité comme `[]` (ne crashe jamais).
 * - `fermeBdc` non vide ET absente de `magasins` (comparaison insensible casse/
 *   espaces) → option `horsConfig` ajoutée EN TÊTE, sélectionnée, + warning.
 * - `fermeBdc` non vide ET présente → options = magasins, selected = fermeBdc
 *   (casse d'origine de `fermeBdc` conservée), warning null.
 * - `fermeBdc` vide/absente → options = magasins, selected = magasins[0] || ''.
 *
 * @param {string[]|null|undefined} magasins
 * @param {string|null|undefined} [fermeBdc]
 * @returns {{options: Array<{value: string, label: string, horsConfig: boolean}>, selected: string, warning: string|null}}
 */
function resolveDestinationOptions(magasins, fermeBdc) {
  var list = Array.isArray(magasins) ? magasins.filter(function (m) { return SD_key(m) !== ''; }) : [];
  var options = list.map(function (m) {
    return { value: String(m), label: String(m), horsConfig: false };
  });

  var ferme = (fermeBdc === null || fermeBdc === undefined) ? '' : String(fermeBdc).trim();
  if (!ferme) {
    return { options: options, selected: options.length ? options[0].value : '', warning: null };
  }

  var fermeKey = SD_key(ferme);
  var match = null;
  for (var i = 0; i < options.length; i++) {
    if (SD_key(options[i].value) === fermeKey) { match = options[i]; break; }
  }
  if (match) {
    // La ferme est bien configurée : on sélectionne la valeur du BDC telle
    // quelle (le select compare par valeur, et la casse config peut différer —
    // on garde donc la valeur de l'option pour rester aligné avec le DOM).
    return { options: options, selected: match.value, warning: null };
  }

  var extra = { value: ferme, label: ferme + SD_HORS_CONFIG_SUFFIX, horsConfig: true };
  return {
    options: [extra].concat(options),
    selected: ferme,
    warning: SD_warningFor(ferme),
  };
}

// ============================================================================
// UMD-style export (browser global + CommonJS pour node:test)
// ============================================================================

var SD_api = {
  resolveDestinationOptions: resolveDestinationOptions,
  SD_HORS_CONFIG_SUFFIX: SD_HORS_CONFIG_SUFFIX,
};

if (typeof module !== 'undefined' && module.exports) module.exports = SD_api;
if (typeof window !== 'undefined') window.StockDestinations = SD_api;
