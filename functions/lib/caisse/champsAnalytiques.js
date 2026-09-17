'use strict';
// @ts-check

/**
 * Module pur — axes analytiques d'un bon de caisse : ferme, campagne, culture,
 * parcelle.
 *
 * Les 4 champs sont FACULTATIFS : les bons existants n'en portent aucun, et les
 * rendre obligatoires interdirait de modifier l'historique. Une valeur vide est
 * donc toujours acceptée ; seule une valeur NON vide est validée.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

/** Fermes sélectionnables. @type {ReadonlyArray<string>} */
const FERMES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'BGF'];

/**
 * Cultures — mêmes valeurs que CULTURES_SB_VALIDES
 * (functions/src/modules/rh/pointageService.js) et public/lib/cultureUtils.js.
 * @type {ReadonlyArray<string>}
 */
const CULTURES = ['Framboise', 'Myrtille', 'Avocatier'];

/**
 * Parcelle « fourre-tout » : dépense non rattachable à une parcelle précise.
 * Valeur réservée, jamais un libellé BEE ONE.
 */
const PARCELLE_GENERAL = 'GENERAL';

/**
 * Campagne agricole d'une date — bascule au 1er juillet.
 * Réplique de `campagneOf` (public/lib/campagneUtils.js) côté backend : le
 * backend ne doit JAMAIS require('../public/...') (Firebase ne déploie que
 * functions/ → Cannot find module → toutes les CF crashent au load).
 *
 * @param {string} [dateStr] Date ISO courte `YYYY-MM-DD`.
 * @returns {string} Campagne `AAAA-AAAA`, ou `''` si la date est invalide.
 */
function campagneOf(dateStr) {
  if (typeof dateStr !== 'string') return '';
  const m = /^(\d{4})-(\d{2})/.exec(dateStr.trim());
  if (!m) return '';
  const annee = parseInt(m[1], 10);
  const mois = parseInt(m[2], 10);
  if (!Number.isFinite(annee) || mois < 1 || mois > 12) return '';
  const debut = mois >= 7 ? annee : annee - 1;
  return `${debut}-${debut + 1}`;
}

/**
 * Valide les 4 axes analytiques d'un patch (champs absents = non validés).
 *
 * La liste des fermes est CONFIGURABLE (écran Paramètres de la caisse) : elle
 * est donc injectée. Sans injection, on retombe sur `FERMES` — la liste par
 * défaut — plutôt que de tout accepter, pour ne pas perdre le garde-fou.
 *
 * @param {{ferme?: string, culture?: string, campagne?: string, parcelle?: string}} patch
 * @param {{fermes?: string[]}} [opts] Listes autorisées, issues des paramètres.
 * @returns {string|null} Message d'erreur, ou `null` si tout est valide.
 */
function validateAxes(patch, opts) {
  const p = patch || {};
  const fermesOk = (opts && Array.isArray(opts.fermes) && opts.fermes.length) ? opts.fermes : FERMES;
  if (p.ferme !== undefined && p.ferme !== '' && fermesOk.indexOf(String(p.ferme)) === -1) {
    return `Ferme invalide (attendu : ${fermesOk.join(', ')})`;
  }
  if (p.culture !== undefined && p.culture !== '' && CULTURES.indexOf(String(p.culture)) === -1) {
    return `Culture invalide (attendu : ${CULTURES.join(', ')})`;
  }
  if (p.campagne !== undefined && p.campagne !== '' && !/^\d{4}-\d{4}$/.test(String(p.campagne))) {
    return 'Campagne invalide (format attendu AAAA-AAAA)';
  }
  return null;
}

module.exports = { FERMES, CULTURES, PARCELLE_GENERAL, campagneOf, validateAxes }
