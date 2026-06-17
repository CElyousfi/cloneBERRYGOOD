'use strict';
// @ts-check

/**
 * Module pur de dérivation des recettes « Marché Local » (compte client).
 *
 * À partir des lignes de `pfq_interne` (typeVente === 'Marché Local'), on dérive :
 *  - des recettes groupées par (bonApport, client) — la ferme N'entre PAS dans la clé,
 *    donc les lignes F1/F5 d'un même BA pour un même client sont fusionnées.
 *  - une agrégation par client (débit du compte client).
 *  - un grand total.
 *
 * Aucune écriture Firestore. Fonctions pures uniquement.
 *
 * @typedef {Object} MlLine
 * @property {string} bonApport   Numéro de bon d'apport (clé métier stable).
 * @property {string} client      Nom du client tel que saisi.
 * @property {string} [blocFerme] Ferme / bloc d'origine (ex: 'F1', 'F5').
 * @property {number} [poidsLot]  Poids du lot en kg.
 * @property {number} [prixDH]    Prix unitaire en DH.
 * @property {number} [totalDH]   Montant total de la ligne en DH.
 * @property {string} [typeVente] Type de vente (filtre sur 'Marché Local').
 *
 * @typedef {Object} Recette
 * @property {string} idempotency_key Clé stable `${source_ba}__${client_id}`.
 * @property {string} source_ba       Bon d'apport source.
 * @property {string} client_id       Slug stable du client.
 * @property {string} client_nom      Nom canonique du client (premier rencontré).
 * @property {number} montant         Σ totalDH des lignes (BA, client), arrondi 2 déc.
 * @property {number} kg              Σ poidsLot des lignes.
 * @property {number} nb_lignes       Nombre de lignes agrégées.
 * @property {string[]} fermes        Fermes distinctes (ordre d'apparition).
 *
 * @typedef {Object} ClientAggregate
 * @property {string} client_id
 * @property {string} client_nom
 * @property {number} nb_ba        Nombre de BA distincts pour ce client.
 * @property {number} nb_recettes  Nombre de recettes pour ce client.
 * @property {number} kg           Σ kg.
 * @property {number} debit        Σ montant, arrondi 2 déc.
 */

const TYPE_VENTE_ML = 'Marché Local';

/**
 * Arrondit un montant à 2 décimales (centimes), en évitant les dérives float.
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Transforme un nom de client en identifiant stable.
 * minuscules -> accents retirés (NFD) -> non-alphanum en '_' -> trim des '_'.
 * @param {string} nom
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
 * Dérive les recettes à partir des lignes brutes.
 * Filtre typeVente === 'Marché Local'. Groupe par `${bonApport}__${client_id}`.
 * @param {MlLine[]} lines
 * @returns {Recette[]}
 */
function deriveRecettes(lines) {
  /** @type {Map<string, Recette & {_fermesSet: Set<string>, _montantBrut: number}>} */
  const byKey = new Map();

  for (const line of lines || []) {
    if (!line || line.typeVente !== TYPE_VENTE_ML) continue;

    const source_ba = line.bonApport;
    const client_nom = line.client;
    const client_id = slugifyClient(client_nom);
    const key = `${source_ba}__${client_id}`;

    let rec = byKey.get(key);
    if (!rec) {
      rec = /** @type {any} */ ({
        idempotency_key: key,
        source_ba,
        client_id,
        client_nom,
        montant: 0,
        kg: 0,
        nb_lignes: 0,
        fermes: [],
        _fermesSet: new Set(),
        _montantBrut: 0,
      });
      byKey.set(key, rec);
    }

    rec._montantBrut += Number(line.totalDH) || 0;
    rec.kg += Number(line.poidsLot) || 0;
    rec.nb_lignes += 1;

    const ferme = line.blocFerme;
    if (ferme != null && ferme !== '' && !rec._fermesSet.has(ferme)) {
      rec._fermesSet.add(ferme);
      rec.fermes.push(ferme);
    }
  }

  const out = [];
  for (const rec of byKey.values()) {
    rec.montant = round2(rec._montantBrut);
    rec.kg = round2(rec.kg);
    delete rec._fermesSet;
    delete rec._montantBrut;
    out.push(rec);
  }
  return out;
}

/**
 * Agrège les recettes par client.
 * @param {Recette[]} recettes
 * @returns {ClientAggregate[]}
 */
function aggregateByClient(recettes) {
  /** @type {Map<string, ClientAggregate & {_baSet: Set<string>, _debitBrut: number}>} */
  const byClient = new Map();

  for (const rec of recettes || []) {
    let agg = byClient.get(rec.client_id);
    if (!agg) {
      agg = /** @type {any} */ ({
        client_id: rec.client_id,
        client_nom: rec.client_nom,
        nb_ba: 0,
        nb_recettes: 0,
        kg: 0,
        debit: 0,
        _baSet: new Set(),
        _debitBrut: 0,
      });
      byClient.set(rec.client_id, agg);
    }
    agg.nb_recettes += 1;
    agg.kg += Number(rec.kg) || 0;
    agg._debitBrut += Number(rec.montant) || 0;
    agg._baSet.add(rec.source_ba);
  }

  const out = [];
  for (const agg of byClient.values()) {
    agg.nb_ba = agg._baSet.size;
    agg.debit = round2(agg._debitBrut);
    agg.kg = round2(agg.kg);
    delete agg._baSet;
    delete agg._debitBrut;
    out.push(agg);
  }
  return out;
}

/**
 * Grand total des montants de recettes.
 * @param {Recette[]} recettes
 * @returns {number}
 */
function grandTotal(recettes) {
  const sum = (recettes || []).reduce((s, r) => s + (Number(r.montant) || 0), 0);
  return round2(sum);
}

module.exports = {
  TYPE_VENTE_ML,
  round2,
  slugifyClient,
  deriveRecettes,
  aggregateByClient,
  grandTotal,
};
