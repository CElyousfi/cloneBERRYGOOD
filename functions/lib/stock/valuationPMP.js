'use strict';

/**
 * valuationPMP.js — Module PUR de valorisation du stock au PMP (coût moyen
 * pondéré d'acquisition / CMUP).
 *
 * AUCUN accès Firestore ni fichier : toutes les fonctions reçoivent leurs
 * données en argument et retournent des structures simples. La logique de
 * valorisation est ainsi réutilisable côté serveur (Phase 2b) sans divergence,
 * et testable en isolation.
 *
 * Hiérarchie de sources de prix (la plus fiable gagne) :
 *   0. facture        (Phase 3, futur)   — priorité max
 *   1. bon_commande   (purchase_orders, futur)
 *   2. bon_entree     (grand livre, prix fournisseur réel)  ← branché
 *   3. inventaire     (snapshot 30/06)    ← fallback
 *
 * Pour brancher facture/BDC plus tard : ajouter la clé de source dans
 * `pricesBySource` en amont. Ce module n'a RIEN à changer — il pioche
 * automatiquement la source de plus haute priorité disponible.
 */

/**
 * Ordre de priorité des sources de prix. Index = priorité (0 = max).
 * @type {string[]}
 */
const SOURCE_PRIORITY = ['facture', 'bon_commande', 'bon_entree', 'inventaire'];

/**
 * Parse robuste d'un prix brut vers un nombre en DH.
 *
 * Gère :
 *  - nombre direct (`2708.33`)
 *  - double virgule `"2,708,33"` → 2708.33 (dernière virgule = décimale, les
 *    autres = séparateurs de milliers)
 *  - virgule de millier + point décimal `"2,120.00"` → 2120
 *  - virgule décimale simple `"2,7"` → 2.7
 *  - suffixe `" DH"` (insensible casse/espaces)
 *  - texte non numérique signalant un prix nul/absent : `"PERIMI"`, `"PERIME"`,
 *    `"PÉRIMÉ"` → 0
 *  - vide / null / non parsable → null
 *
 * @param {*} raw - valeur brute (nombre, string, null, undefined)
 * @returns {number|null} prix en DH, 0 pour les marqueurs "périmé", null si absent/illisible
 */
function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return isFinite(raw) ? raw : null;
  }
  let s = String(raw).trim();
  if (s === '') return null;

  // Strip suffixe monétaire " DH" / "DH"
  s = s.replace(/\s*dh\s*$/i, '').trim();
  if (s === '') return null;

  // Marqueurs explicites de prix nul (article périmé)
  if (/p[eé]rim/i.test(s)) return 0;

  // Si après nettoyage il reste des lettres (ex. "besoin prix facture") → illisible
  if (/[a-zA-Z]/.test(s)) return null;

  // Normalisation des séparateurs numériques.
  const hasDot = s.indexOf('.') !== -1;
  const commaCount = (s.match(/,/g) || []).length;

  if (commaCount === 0) {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  if (hasDot) {
    // Le point est le séparateur décimal → les virgules sont des milliers.
    s = s.replace(/,/g, '');
  } else if (commaCount === 1) {
    // Virgule unique = séparateur décimal.
    s = s.replace(',', '.');
  } else {
    // Plusieurs virgules, pas de point : dernière virgule = décimale,
    // les autres = milliers. Ex "2,708,33" → "2708.33".
    const lastComma = s.lastIndexOf(',');
    const intPart = s.slice(0, lastComma).replace(/,/g, '');
    const decPart = s.slice(lastComma + 1);
    s = intPart + '.' + decPart;
  }

  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Normalise un prix parsé vers l'unité de stock (DH/kg ou DH/L), en corrigeant
 * les prix saisis par tonne.
 *
 * Heuristique basée sur une ancre fiable (prix 30/06 de l'article ou médiane) :
 *  - ratio = parsed / anchor
 *  - ratio > 100  → prix/tonne quasi certain → ÷1000 (action 'div1000')
 *  - 10 < ratio <= 100 → suspect, NON auto-corrigé (action 'suspect')
 *  - sinon → conservé tel quel (action 'keep')
 *
 * Si `anchor` <= 0 ou absent, on ne peut pas juger → 'keep'.
 *
 * @param {number} parsed - prix déjà parsé (nombre)
 * @param {number} [anchor] - prix d'ancrage fiable pour l'article (DH/unité-stock)
 * @returns {{value:number, action:('keep'|'div1000'|'suspect'), suspect?:boolean, ratio?:number}}
 */
function normalizePrice(parsed, anchor) {
  if (typeof parsed !== 'number' || !isFinite(parsed)) {
    return { value: parsed, action: 'keep' };
  }
  if (typeof anchor !== 'number' || !(anchor > 0) || parsed <= 0) {
    return { value: parsed, action: 'keep' };
  }
  const ratio = parsed / anchor;
  if (ratio > 100) {
    return { value: parsed / 1000, action: 'div1000', ratio };
  }
  if (ratio > 10) {
    return { value: parsed, action: 'suspect', suspect: true, ratio };
  }
  return { value: parsed, action: 'keep', ratio };
}

/**
 * Résout le prix d'acquisition d'une réception en choisissant la source de plus
 * haute priorité disponible (non null après parsing), puis en normalisant.
 *
 * @param {Object<string, *>} pricesBySource - ex `{bon_entree: 2708.33, inventaire: 2.7}`
 * @param {number} [anchor] - prix d'ancrage de l'article pour la normalisation
 * @returns {{value:(number|null), source:(string|null), action:string, raw?:*}}
 *   value/source null si aucune source n'a de prix lisible.
 */
function resolveAcquisitionPrice(pricesBySource, anchor) {
  if (!pricesBySource || typeof pricesBySource !== 'object') {
    return { value: null, source: null, action: 'none' };
  }
  for (const source of SOURCE_PRIORITY) {
    if (!(source in pricesBySource)) continue;
    const raw = pricesBySource[source];
    const parsed = parsePrice(raw);
    if (parsed == null) continue; // source présente mais illisible → on descend
    const norm = normalizePrice(parsed, anchor);
    return { value: norm.value, source, action: norm.action, raw };
  }
  return { value: null, source: null, action: 'none' };
}

/**
 * Calcule le PMP (coût moyen pondéré) d'UN article à partir de ses acquisitions.
 *
 * Chaque acquisition = `{ qty, pricesBySource, anchor }`. Pour chacune on
 * résout le prix via la hiérarchie de sources puis on calcule :
 *   PMP = Σ(qty × prix_normalisé) / Σ(qty)
 *
 * Les acquisitions sans prix résolu (illisible/absent) ou sans qty positive
 * sont ignorées du calcul et comptées à part.
 *
 * @param {Array<{qty:number, pricesBySource:Object, anchor?:number}>} acquisitions
 * @returns {{
 *   pmp:(number|null),
 *   qtyTotal:number,
 *   valueTotal:number,
 *   sourceBreakdown:Object<string,number>,
 *   suspects:Array<{qty:number, value:number, source:string, ratio?:number, raw?:*}>,
 *   ignored:number
 * }}
 */
function computePMP(acquisitions) {
  let qtyTotal = 0;
  let valueTotal = 0;
  let ignored = 0;
  const sourceBreakdown = {};
  const suspects = [];

  const list = Array.isArray(acquisitions) ? acquisitions : [];
  for (const acq of list) {
    const qty = acq && typeof acq.qty === 'number' ? acq.qty : parseFloat(acq && acq.qty);
    const resolved = resolveAcquisitionPrice(acq && acq.pricesBySource, acq && acq.anchor);
    if (resolved.value == null || !(qty > 0)) {
      ignored++;
      continue;
    }
    qtyTotal += qty;
    valueTotal += qty * resolved.value;
    sourceBreakdown[resolved.source] = (sourceBreakdown[resolved.source] || 0) + 1;
    if (resolved.action === 'suspect') {
      suspects.push({
        qty,
        value: resolved.value,
        source: resolved.source,
        ratio: acq && acq.anchor ? resolved.value / acq.anchor : undefined,
        raw: resolved.raw,
      });
    }
  }

  const pmp = qtyTotal > 0 ? valueTotal / qtyTotal : null;
  return { pmp, qtyTotal, valueTotal, sourceBreakdown, suspects, ignored };
}

module.exports = {
  SOURCE_PRIORITY,
  parsePrice,
  normalizePrice,
  resolveAcquisitionPrice,
  computePMP,
};
