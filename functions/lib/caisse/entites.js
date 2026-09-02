'use strict';
// @ts-check

/**
 * Module pur — rattachement des caisses à une ENTITÉ (Berry Good / Bahia) et
 * comptes clients du Marché Local.
 *
 * Le dashboard présente une entité à la fois : chacune a ses propres caisses,
 * et les additionner n'a aucun sens de gestion. Le rattachement est explicite
 * et modifiable dans l'écran Paramètres — pas déduit du nom, sinon une caisse
 * mal nommée atterrit dans le mauvais bloc et il faut rouvrir le code.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

/** Entités connues. L'ordre est celui d'affichage du sélecteur. */
const ENTITES = [
  { code: 'BGF', label: 'BERRY GOOD FARMS' },
  { code: 'BAHIA', label: 'BAHIA' },
];

/** Entité retenue quand rien ne permet de trancher. */
const ENTITE_DEFAUT = 'BGF';

/** Préfixe des comptes clients Marché Local dans caisse_definitions. */
const COMPTE_CLIENT_PREFIX = 'compte_client_';

/**
 * @param {*} code
 * @returns {boolean}
 */
function estEntiteValide(code) {
  return ENTITES.some((e) => e.code === String(code));
}

/**
 * Une caisse est-elle un compte client Marché Local ?
 * @param {*} caisse
 * @returns {boolean}
 */
function estCompteClient(caisse) {
  if (!caisse) return false;
  return typeof caisse.id === 'string' && caisse.id.indexOf(COMPTE_CLIENT_PREFIX) === 0;
}

/**
 * Identifiant client extrait de l'id de caisse.
 * @param {string} caisseId
 * @returns {string}
 */
function clientIdDepuisCaisse(caisseId) {
  const s = String(caisseId || '');
  return s.indexOf(COMPTE_CLIENT_PREFIX) === 0 ? s.slice(COMPTE_CLIENT_PREFIX.length) : '';
}

/**
 * Nom lisible d'un compte client quand le document n'a pas de champ `nom` —
 * cas de tous les comptes existants, d'où les « bulles anonymes ».
 * `compte_client_mustapha_chafik_a` → `MUSTAPHA CHAFIK A`.
 *
 * @param {string} caisseId
 * @returns {string}
 */
function nomClientDepuisId(caisseId) {
  const brut = clientIdDepuisCaisse(caisseId);
  if (!brut) return '';
  return brut.split('_').filter(Boolean).join(' ').toUpperCase();
}

/**
 * Slug d'un nom de client. DOIT rester identique à `slugifyClient`
 * (functions/lib/marcheLocalCaisse/index.js) : c'est cette règle qui relie un
 * client du référentiel `clients_marche_local` à son compte de suivi
 * `compte_client_<slug>`. Une divergence créerait des comptes orphelins.
 *
 * @param {*} nom
 * @returns {string}
 */
function slugifyClient(nom) {
  if (nom == null) return '';
  return String(nom)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Repli de rattachement : utilisé UNIQUEMENT tant qu'aucune entité n'a été
 * choisie pour cette caisse dans les Paramètres. Permet à l'écran d'être juste
 * dès la première ouverture, sans configuration préalable.
 *
 * @param {{id?: string, nom?: string}} caisse
 * @returns {string} Code d'entité.
 */
function entiteParDefaut(caisse) {
  const source = `${(caisse && caisse.id) || ''} ${(caisse && caisse.nom) || ''}`.toLowerCase();
  return source.indexOf('bahia') !== -1 ? 'BAHIA' : ENTITE_DEFAUT;
}

/**
 * Entité effective d'une caisse : choix explicite s'il existe, repli sinon.
 *
 * @param {{id?: string, nom?: string}} caisse
 * @param {Object<string, string>} [mapping] `{ caisse_id: code_entite }`
 * @returns {string}
 */
function entiteDe(caisse, mapping) {
  const id = (caisse && caisse.id) || '';
  const choisi = mapping && Object.prototype.hasOwnProperty.call(mapping, id) ? mapping[id] : null;
  if (choisi && estEntiteValide(choisi)) return String(choisi);
  return entiteParDefaut(caisse);
}

/**
 * Nettoie un mapping reçu du client : ne garde que les entités valides.
 *
 * @param {*} mapping
 * @returns {Object<string, string>}
 */
function normalizeEntites(mapping) {
  /** @type {Object<string, string>} */
  const out = {};
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return out;
  for (const id of Object.keys(mapping)) {
    const code = String(mapping[id] || '').trim();
    if (!id || !estEntiteValide(code)) continue;
    out[id] = code;
  }
  return out;
}

/**
 * Répartit les caisses d'une entité en deux groupes : les caisses de gestion et
 * les comptes clients du Marché Local, ces derniers n'ayant ni la même nature
 * ni le même usage.
 *
 * @param {Array<Object>} caisses
 * @param {string} entite
 * @param {Object<string, string>} [mapping]
 * @returns {{caisses: Object[], comptesClients: Object[]}}
 */
function repartirParEntite(caisses, entite, mapping) {
  const res = { caisses: [], comptesClients: [] };
  if (!Array.isArray(caisses)) return res;
  for (const c of caisses) {
    if (!c) continue;
    if (entiteDe(c, mapping) !== entite) continue;
    if (estCompteClient(c)) res.comptesClients.push(c);
    else res.caisses.push(c);
  }
  return res;
}

module.exports = {
  ENTITES, ENTITE_DEFAUT, COMPTE_CLIENT_PREFIX,
  estEntiteValide, estCompteClient, clientIdDepuisCaisse, nomClientDepuisId, slugifyClient,
  entiteParDefaut, entiteDe, normalizeEntites, repartirParEntite,
}
