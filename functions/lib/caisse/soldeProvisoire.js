'use strict';
// @ts-check

/**
 * Module pur — solde PROVISOIRE d'une caisse.
 *
 * Pourquoi ce concept existe :
 *   `solde_actuel` ne bouge qu'à la VALIDATION d'un bon (cf. soldeDelta.js).
 *   Avec une revue hebdomadaire de la DG, le caissier passe donc la semaine
 *   avec un solde affiché qui ignore tout ce qu'il a déjà dépensé — impossible
 *   de rapprocher son tiroir avant la validation.
 *
 *   Le solde provisoire ajoute les bons DÉJÀ SAISIS mais pas encore validés.
 *   C'est le chiffre qui correspond à l'argent réellement présent en caisse.
 *
 * Les deux soldes coexistent et ne se remplacent PAS :
 *   - `solde_actuel`     → solde comptable, seul utilisé par le rapprochement
 *                          mensuel et la clôture. Ne jamais l'écraser avec le
 *                          provisoire, sous peine de compter deux fois à la
 *                          validation.
 *   - `solde_provisoire` → solde de caisse, affichage uniquement.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

const { computeSoldeDelta } = require('./soldeDelta');

/**
 * Statuts d'un bon déjà engagé : l'argent est sorti (ou entré) physiquement,
 * seule la validation manque.
 *
 * `brouillon` est EXCLU : un brouillon n'a pas été soumis, rien ne garantit que
 * la dépense a eu lieu. `rejete` est exclu : la dépense a été refusée.
 * @type {ReadonlyArray<string>}
 */
const STATUTS_EN_ATTENTE = ['soumis', 'a_revoir'];

/**
 * @typedef {Object} EnAttente
 * @property {number} montant  Delta cumulé, signé (négatif pour des dépenses).
 * @property {number} count    Nombre de bons concernés.
 *
 * @typedef {Object} SoldeCaisse
 * @property {string} caisse_id
 * @property {number} solde_actuel      Solde comptable (validé).
 * @property {number} solde_provisoire  solde_actuel + delta en attente.
 * @property {number} en_attente_montant
 * @property {number} en_attente_count
 */

/**
 * Cumul par caisse des bons en attente de validation.
 *
 * @param {Array<Object>} transactions Bons, tous statuts confondus.
 * @returns {Object<string, EnAttente>} Indexé par `caisse_id`.
 */
function cumulEnAttente(transactions) {
  /** @type {Object<string, EnAttente>} */
  const parCaisse = {};
  if (!Array.isArray(transactions)) return parCaisse;
  for (const tx of transactions) {
    if (!tx || !tx.caisse_id) continue;
    if (STATUTS_EN_ATTENTE.indexOf(tx.status) === -1) continue;
    const cur = parCaisse[tx.caisse_id] || { montant: 0, count: 0 };
    cur.montant += computeSoldeDelta(tx);
    cur.count += 1;
    parCaisse[tx.caisse_id] = cur;
  }
  // Arrondi au centime une seule fois, à la fin (éviter l'accumulation d'erreurs).
  for (const id of Object.keys(parCaisse)) {
    parCaisse[id].montant = Math.round(parCaisse[id].montant * 100) / 100;
  }
  return parCaisse;
}

/**
 * Enrichit une liste de caisses avec leur solde provisoire.
 *
 * @param {Array<Object>} caisses      `{ id, solde_actuel, … }`
 * @param {Array<Object>} enAttenteTx  Bons en attente (filtrage refait ici).
 * @returns {SoldeCaisse[]}
 */
function computeSoldesProvisoires(caisses, enAttenteTx) {
  const cumuls = cumulEnAttente(enAttenteTx);
  if (!Array.isArray(caisses)) return [];
  return caisses.map((c) => {
    const id = (c && c.id) || '';
    const attente = cumuls[id] || { montant: 0, count: 0 };
    const actuel = Number(c && c.solde_actuel) || 0;
    return {
      caisse_id: id,
      solde_actuel: Math.round(actuel * 100) / 100,
      solde_provisoire: Math.round((actuel + attente.montant) * 100) / 100,
      en_attente_montant: attente.montant,
      en_attente_count: attente.count,
    };
  });
}

module.exports = { STATUTS_EN_ATTENTE, cumulEnAttente, computeSoldesProvisoires }
