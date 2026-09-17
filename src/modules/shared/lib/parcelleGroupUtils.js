/**
 * parcelleGroupUtils.js — répartition au prorata des Ha pour les « groupes de
 * parcelles » (aperçu du split dans le popup Bon de Consommation + recalcul
 * live des % dans l'écran Parcelles & Référentiel).
 *
 * ⚠️ COPIE STRICTE de functions/lib/parcelleGroupes/split.js. Duplication
 * VOLONTAIRE : le backend ne doit JAMAIS require('../public/…') (Firebase ne
 * déploie que functions/ → Cannot find module au load de toutes les CF).
 * Les deux copies partagent les MÊMES fixtures de test :
 *   tests/unit/parcelleGroupUtils.test.js
 *   functions/lib/parcelleGroupes/__tests__/split.test.js
 * Le test frontend vérifie en plus l'égalité chiffrée entre les deux copies.
 */
// @ts-check

/** Nombre de décimales conservées sur une quantité éclatée. */
var PGU_QTY_DECIMALS = 3;

/**
 * Arrondi à 3 décimales (neutralise le bruit flottant).
 * @param {number} n
 * @returns {number}
 */
function PGU_round3(n) {
  var f = Math.pow(10, PGU_QTY_DECIMALS);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Valide une liste de membres [{label, ha}] et renvoie Σ des Ha.
 * @param {Array<{label:string, ha:number}>} membres
 * @returns {number}
 */
function PGU_totalHa(membres) {
  if (!Array.isArray(membres) || membres.length === 0) {
    throw new Error('Groupe sans membre : impossible de répartir la quantité');
  }
  var total = 0;
  for (var i = 0; i < membres.length; i++) {
    var m = membres[i];
    var ha = m && typeof m.ha === 'number' ? m.ha : parseFloat(String((m && m.ha) || ''));
    if (!(ha > 0) || !isFinite(ha)) {
      throw new Error(
        'Ha Smart Berry manquant ou nul pour la parcelle « ' + ((m && m.label) || '?') +
        ' » : saisir le Ha dans Parcelles & Référentiel avant de l\'inclure dans un groupe'
      );
    }
    total += ha;
  }
  if (!(total > 0)) throw new Error('Somme des Ha nulle : répartition impossible');
  return total;
}

/**
 * Part de chaque membre (AFFICHAGE : pct arrondi à 1 décimale).
 * @param {Array<{label:string, ha:number}>} membres
 * @returns {Array<{label:string, ha:number, pct:number}>}
 */
function PGU_computeParts(membres) {
  var total = PGU_totalHa(membres);
  return membres.map(function (m) {
    var ha = typeof m.ha === 'number' ? m.ha : parseFloat(String(m.ha));
    return { label: m.label, ha: ha, pct: Math.round((ha / total) * 1000) / 10 };
  });
}

/**
 * Répartit une quantité au prorata des Ha. La DERNIÈRE part absorbe le reste
 * → Σ(parts) === quantite exactement.
 * @param {number} quantite
 * @param {Array<{label:string, ha:number}>} membres
 * @returns {Array<{label:string, quantite:number}>}
 */
function PGU_splitQuantite(quantite, membres) {
  var total = PGU_totalHa(membres);
  var q = typeof quantite === 'number' ? quantite : parseFloat(String(quantite));
  if (!isFinite(q)) throw new Error('Quantité invalide : ' + String(quantite));
  var out = [];
  var cumul = 0;
  for (var i = 0; i < membres.length; i++) {
    var m = membres[i];
    var ha = typeof m.ha === 'number' ? m.ha : parseFloat(String(m.ha));
    var part;
    if (i === membres.length - 1) {
      part = PGU_round3(q - cumul);
    } else {
      part = PGU_round3((q * ha) / total);
      cumul = PGU_round3(cumul + part);
    }
    out.push({ label: m.label, quantite: part });
  }
  return out;
}

/**
 * Aperçu texte du split, prêt à afficher sous la ligne d'article.
 * Renvoie '' si la quantité est vide/nulle ou si le groupe est inexploitable
 * (Ha manquant) — l'aperçu ne doit jamais faire crasher la saisie.
 * @param {number|string} quantite
 * @param {Array<{label:string, ha:number}>} membres
 * @param {string} [unite]
 * @returns {string} ex. « S13 3.9 kg · S14 6.1 kg »
 */
function PGU_formatApercu(quantite, membres, unite) {
  var q = parseFloat(String(quantite));
  if (!isFinite(q) || q <= 0) return '';
  var parts;
  try {
    parts = PGU_splitQuantite(q, membres);
  } catch (e) {
    return '';
  }
  var u = unite ? ' ' + unite : '';
  return parts.map(function (p) {
    return p.label + ' ' + String(p.quantite) + u;
  }).join(' · ');
}

export { PGU_QTY_DECIMALS as QTY_DECIMALS, PGU_round3 as round3, PGU_totalHa as totalHa, PGU_computeParts as computeParts, PGU_splitQuantite as splitQuantite, PGU_formatApercu as formatApercu };
