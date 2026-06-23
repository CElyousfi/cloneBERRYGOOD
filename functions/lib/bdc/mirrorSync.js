/**
 * mirrorSync.js — Logique PURE de transformation pour le mirror BDC
 * (BEE ONE / BEE_BERRY_GOOD → Firestore collection `bdc_mirror`).
 *
 * Ce module ne fait AUCUN I/O : ni SQL, ni Firestore. Il transforme des
 * recordsets bruts (lignes jointes Bon_Commande × Demande_achat_Bon_Commande ×
 * Produit × Fournisseur) en documents `bdc_mirror` prêts à l'upsert.
 *
 * La connexion SQL read-only et l'écriture Firestore (gardée derrière --apply)
 * vivent dans functions/bdcMirrorService.js. Ici, uniquement du pur testable.
 *
 * Étape 1 du cycle Achats — MIRROR BDC (dry-run par défaut).
 */
// @ts-check
'use strict';

/**
 * Valeur sentinelle de prix « placeholder de saisie » côté BEE ONE.
 * Une ligne dont Prix_U_HT vaut exactement 1 est considérée comme non chiffrée
 * (réserve donnée) : on la MARQUE (placeholder_prix=true) sans la masquer.
 */
const PLACEHOLDER_PRICE = 1;

/**
 * @typedef {Object} SqlBdcRow Ligne brute du recordset SQL joint.
 * @property {number} IDBon_Commande
 * @property {string} Num_BC
 * @property {number} IDFournisseur
 * @property {string} FournisseurSociete
 * @property {(Date|string)} Date_BC
 * @property {(string|number|null)} [Statut]
 * @property {(number|null)} [Total_Mnt_net_HT]
 * @property {(number|null)} [Total_Mnt_net_TVA]
 * @property {(number|null)} [Total_Mnt_net_TTC]
 * @property {(number|null)} [IDProduit]
 * @property {(string|null)} [ProduitRef]
 * @property {(string|null)} [Designation]
 * @property {(number|null)} [Qte]
 * @property {(number|null)} [Prix_U_HT]
 * @property {(number|null)} [Montant_net_ht]
 * @property {(number|null)} [TVA]
 * @property {(number|null)} [Montant_net_ttc]
 * @property {(number|null)} [Reliquat]
 */

/**
 * @typedef {Object} MirrorLine Ligne transformée pour le doc mirror.
 * @property {(string|null)} code_article
 * @property {(number|null)} id_produit
 * @property {(string|null)} designation
 * @property {number} qte_commandee
 * @property {number} prix_u_ht
 * @property {number} montant_net_ht
 * @property {number} tva
 * @property {number} montant_net_ttc
 * @property {number} reliquat
 * @property {boolean} placeholder_prix
 */

/**
 * @typedef {Object} MirrorDoc Document mirror (1 par BDC). docId = num_bc.
 * @property {string} num_bc
 * @property {{nom: string, id_source: number}} fournisseur
 * @property {(string|null)} date_bc - ISO date YYYY-MM-DD
 * @property {number} total_ht
 * @property {number} total_tva
 * @property {number} total_ttc
 * @property {(string|number|null)} statut
 * @property {'bee_one'} source
 * @property {MirrorLine[]} lignes
 */

/**
 * Normalise une valeur numérique potentiellement null/undefined/money en Number.
 * @param {*} v
 * @returns {number}
 */
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convertit une Date_BC (Date SQL ou string) en chaîne ISO YYYY-MM-DD.
 * Renvoie null si non parsable.
 * @param {(Date|string|null|undefined)} d
 * @returns {(string|null)}
 */
function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Détermine si une ligne porte un prix « placeholder » (Prix_U_HT == 1).
 * @param {(number|null|undefined)} prixUHt
 * @returns {boolean}
 */
function isPlaceholderPrice(prixUHt) {
  return num(prixUHt) === PLACEHOLDER_PRICE;
}

/**
 * Transforme une ligne SQL brute en ligne mirror.
 * @param {SqlBdcRow} row
 * @returns {MirrorLine}
 */
function mapLine(row) {
  const ref = row.ProduitRef != null ? String(row.ProduitRef).trim() : null;
  return {
    code_article: ref || null,
    id_produit: row.IDProduit != null ? num(row.IDProduit) : null,
    designation: row.Designation != null ? String(row.Designation).trim() : null,
    qte_commandee: num(row.Qte),
    prix_u_ht: num(row.Prix_U_HT),
    montant_net_ht: num(row.Montant_net_ht),
    tva: num(row.TVA),
    montant_net_ttc: num(row.Montant_net_ttc),
    reliquat: num(row.Reliquat),
    placeholder_prix: isPlaceholderPrice(row.Prix_U_HT),
  };
}

/**
 * Regroupe les lignes SQL plates par Num_BC et construit les docs mirror.
 * Une ligne SANS Num_BC est ignorée (impossible de la rattacher à un doc).
 * L'ordre des docs suit l'ordre de première apparition des Num_BC.
 *
 * @param {SqlBdcRow[]} rows
 * @returns {MirrorDoc[]}
 */
function buildMirrorDocs(rows) {
  /** @type {Map<string, MirrorDoc>} */
  const byBc = new Map();

  for (const row of rows || []) {
    const numBc = row.Num_BC != null ? String(row.Num_BC).trim() : '';
    if (!numBc) continue;

    let doc = byBc.get(numBc);
    if (!doc) {
      doc = {
        num_bc: numBc,
        fournisseur: {
          nom: row.FournisseurSociete != null ? String(row.FournisseurSociete).trim() : '',
          id_source: row.IDFournisseur != null ? num(row.IDFournisseur) : 0,
        },
        date_bc: toIsoDate(row.Date_BC),
        total_ht: num(row.Total_Mnt_net_HT),
        total_tva: num(row.Total_Mnt_net_TVA),
        total_ttc: num(row.Total_Mnt_net_TTC),
        statut: row.Statut != null ? row.Statut : null,
        source: 'bee_one',
        lignes: [],
      };
      byBc.set(numBc, doc);
    }

    // Une ligne d'en-tête sans produit (IDProduit null) ne crée pas de ligne.
    if (row.IDProduit != null || row.ProduitRef != null || row.Qte != null) {
      doc.lignes.push(mapLine(row));
    }
  }

  return Array.from(byBc.values());
}

/**
 * Calcule un rapport récapitulatif à partir des docs mirror construits.
 * Sert au DRY-RUN (aucune écriture). Compte placeholders, prix > 0, etc.
 *
 * @param {MirrorDoc[]} docs
 * @returns {{
 *   nbBdc: number,
 *   nbLignes: number,
 *   nbLignesPrixPositif: number,
 *   nbLignesPlaceholder: number,
 *   numBcs: string[],
 *   dateMin: (string|null),
 *   dateMax: (string|null),
 * }}
 */
function buildReport(docs) {
  let nbLignes = 0;
  let nbLignesPrixPositif = 0;
  let nbLignesPlaceholder = 0;
  /** @type {string[]} */
  const numBcs = [];
  const dates = [];

  for (const doc of docs || []) {
    numBcs.push(doc.num_bc);
    if (doc.date_bc) dates.push(doc.date_bc);
    for (const l of doc.lignes) {
      nbLignes += 1;
      if (l.placeholder_prix) {
        nbLignesPlaceholder += 1;
      } else if (l.prix_u_ht > 0) {
        nbLignesPrixPositif += 1;
      }
    }
  }

  dates.sort();
  return {
    nbBdc: (docs || []).length,
    nbLignes,
    nbLignesPrixPositif,
    nbLignesPlaceholder,
    numBcs,
    dateMin: dates.length ? dates[0] : null,
    dateMax: dates.length ? dates[dates.length - 1] : null,
  };
}

module.exports = {
  PLACEHOLDER_PRICE,
  num,
  toIsoDate,
  isPlaceholderPrice,
  mapLine,
  buildMirrorDocs,
  buildReport,
};
