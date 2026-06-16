'use strict';

/**
 * pmpDetail.js — Logique PURE pour le détail du calcul du PMP (popup read-only).
 *
 * AUCUN accès Firestore : toutes les fonctions reçoivent leurs données en
 * argument. Sert la colonne « PMP au prix facturé » de l'écran Inventaire :
 * PMP facturé pondéré + détection de cohérence d'unité (stock vs facture).
 *
 * HONNÊTETÉ DES UNITÉS (rigueur ACIDE PHOSPHORIQUE) :
 *  - Tonne (T / TONNE) est normalisée en KG : PU ÷1000, qté ×1000.
 *  - Si l'unité facture (après normalisation) == unité stock → PMP pondéré direct.
 *  - Si l'unité facture ≠ unité stock (ex. facture KG, stock L) → AUCUNE densité
 *    fabriquée : coherence='divergente', pmp_pondere=null, note explicite.
 *
 * Le PMP grand livre (colonne 1) n'est PAS recalculé ici : il vient de
 * articles_catalog.prix_pmp (source de vérité, cf. valuationPMP.js). Les prix
 * par ligne du grand livre ne sont PAS persistés en Firestore (seul le PMP final
 * l'est), donc ce module ne traite QUE le côté facture.
 */

/**
 * Canonicalisation d'un nom d'article — IDENTIQUE à scripts/reconstruct-stock.js
 * et compute-pmp-apercu.js (MAJUSCULE, espaces normalisés, suffixe d'unité retiré).
 * @param {*} a
 * @returns {string}
 */
function canon(a) {
  let s = (a == null ? '' : String(a)).toUpperCase().trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, '');
  return s.trim();
}

/**
 * Normalise une unité brute vers une forme canonique comparable.
 * Tonne → KG (la conversion quantitative est gérée par normalizeFactureLine).
 * @param {*} u
 * @returns {string} unité en MAJUSCULE, '' si absente
 */
function canonUnite(u) {
  let s = (u == null ? '' : String(u)).toUpperCase().trim();
  if (s === '') return '';
  if (s === 'T' || s === 'TONNE' || s === 'TONNES' || s === 'TN') return 'KG';
  if (s === 'KGS' || s === 'KILO' || s === 'KILOS' || s === 'KILOGRAMME') return 'KG';
  if (s === 'LITRE' || s === 'LITRES' || s === 'LT' || s === 'LTR') return 'L';
  if (s === 'U' || s === 'UNITE' || s === 'UNITÉ' || s === 'UN' || s === 'PCE' || s === 'PIECE') return 'UNITE';
  return s;
}

/**
 * Indique si l'unité brute est une tonne (nécessite conversion ÷1000 / ×1000).
 * @param {*} u
 * @returns {boolean}
 */
function isTonne(u) {
  const s = (u == null ? '' : String(u)).toUpperCase().trim();
  return s === 'T' || s === 'TONNE' || s === 'TONNES' || s === 'TN';
}

/**
 * Normalise une ligne de facture vers l'unité KG si elle est en tonne.
 * Retourne une nouvelle ligne {qte, unite_norm, prix_unitaire, ...} en conservant
 * les champs d'affichage d'origine (designation, numero_facture, date_facture,
 * unite d'origine).
 *
 * @param {{quantite?:*, qte?:*, unite?:*, prix_unitaire?:*}} line
 * @returns {{qte:number, unite_norm:string, unite_origine:string, prix_unitaire:number}}
 */
function normalizeFactureLine(line) {
  const l = line || {};
  let qte = parseFloat(l.qte != null ? l.qte : l.quantite);
  let pu = parseFloat(l.prix_unitaire);
  const uniteOrigine = l.unite == null ? '' : String(l.unite);
  if (!isFinite(qte)) qte = 0;
  if (!isFinite(pu)) pu = 0;
  if (isTonne(uniteOrigine)) {
    qte = qte * 1000; // tonnes → kg
    pu = pu / 1000;   // DH/tonne → DH/kg
  }
  return {
    qte,
    prix_unitaire: pu,
    unite_origine: uniteOrigine,
    unite_norm: canonUnite(uniteOrigine),
  };
}

/**
 * Détermine l'unité dominante (la plus représentée en quantité) parmi des lignes
 * facture déjà normalisées.
 * @param {Array<{qte:number, unite_norm:string}>} normLines
 * @returns {string} unité dominante ('' si aucune)
 */
function dominantUnite(normLines) {
  const byUnit = {};
  for (const l of (normLines || [])) {
    const u = l.unite_norm || '';
    byUnit[u] = (byUnit[u] || 0) + (l.qte > 0 ? l.qte : 0);
  }
  let best = '', max = -1;
  for (const u of Object.keys(byUnit)) {
    if (u === '') continue;
    if (byUnit[u] > max) { max = byUnit[u]; best = u; }
  }
  return best;
}

/**
 * Calcule le PMP facturé pondéré + la cohérence d'unité vs le stock.
 *
 * @param {Array} factureLines - lignes brutes {numero_facture, date_facture,
 *   designation, quantite|qte, unite, prix_unitaire}
 * @param {string} uniteStock - unité de l'article en stock (ex. 'KG', 'L')
 * @returns {{
 *   lignes: Array<{numero_facture:string, date_facture:string, designation:string,
 *                  qte:number, unite:string, prix_unitaire:number, coherente:boolean}>,
 *   unite_dominante: string,
 *   coherence_unite: ('ok'|'divergente'|'inconnue'),
 *   pmp_pondere: (number|null),
 *   note: (string|null)
 * }}
 */
function computeFacturePMP(factureLines, uniteStock) {
  const rawLines = Array.isArray(factureLines) ? factureLines : [];
  const uStock = canonUnite(uniteStock);

  const norm = rawLines.map((l) => {
    const n = normalizeFactureLine(l);
    return {
      numero_facture: l.numero_facture || l.numero || '',
      date_facture: l.date_facture || '',
      designation: l.designation || l.article || '',
      qte: n.qte,
      unite: n.unite_norm || n.unite_origine || '',
      unite_norm: n.unite_norm,
      prix_unitaire: n.prix_unitaire,
    };
  });

  const uDom = dominantUnite(norm);

  // Cohérence : unité dominante facture vs unité stock.
  let coherence;
  let note = null;
  if (!uStock || !uDom) {
    coherence = 'inconnue';
    note = 'Unité indéterminée (stock ou facture) : PMP facturé non calculé.';
  } else if (uStock === uDom) {
    coherence = 'ok';
  } else {
    coherence = 'divergente';
    note = `Unité facture ${uDom} ≠ unité stock ${uStock} : conversion densité requise, non calculée.`;
  }

  // Marque chaque ligne cohérente (unité ligne == unité stock).
  for (const l of norm) {
    l.coherente = !!(uStock && l.unite_norm && l.unite_norm === uStock);
    delete l.unite_norm;
  }

  // PMP pondéré UNIQUEMENT sur lignes cohérentes (unité == stock) avec qté/PU > 0.
  let pmp = null;
  if (coherence === 'ok') {
    let qSum = 0, vSum = 0;
    for (const l of norm) {
      if (!l.coherente) continue;
      if (!(l.qte > 0)) continue;
      qSum += l.qte;
      vSum += l.qte * l.prix_unitaire;
    }
    pmp = qSum > 0 ? vSum / qSum : null;
  }

  return {
    lignes: norm,
    unite_dominante: uDom,
    coherence_unite: coherence,
    pmp_pondere: pmp,
    note,
  };
}

module.exports = {
  canon,
  canonUnite,
  isTonne,
  normalizeFactureLine,
  dominantUnite,
  computeFacturePMP,
};
