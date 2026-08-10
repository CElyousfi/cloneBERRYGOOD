'use strict'
// @ts-check

/**
 * Éclatement d'une ligne de Bon de Consommation saisie sur un « groupe de
 * parcelles » en N lignes de parcelles RÉELLES, au prorata des surfaces (Ha).
 *
 * Fonctions PURES, aucune dépendance Firestore : toutes les données entrent par
 * argument (DI), comme functions/lib/irrigation/.
 *
 * Décisions produit (validées) :
 *  - Le groupe est un RACCOURCI DE SAISIE, jamais une entité persistée comme
 *    parcelle : le backend écrit les vrais libellés → rien ne casse en aval
 *    (analytique, coût/Ha, Mapping Conso joignent par égalité de chaîne).
 *  - Base du prorata = UNIQUEMENT le `ha` de `sb_parcelle_referentiel`. Pas de
 *    fallback sur la surface BEE ONE : une parcelle sans Ha SB > 0 ne peut pas
 *    entrer dans un groupe (garde-fou volontaire, pas un bug).
 *
 * Invariant d'arrondi (repris de `splitMontant`,
 * functions/lib/mappingConso/resolver.js:82) : la DERNIÈRE part absorbe le
 * reste → Σ(parts) === quantite exactement, zéro fuite d'arrondi.
 *
 * ⚠️ Ce fichier a une COPIE frontend volontaire dans
 * `public/lib/parcelleGroupUtils.js` (aperçu du split dans le popup BC). Le
 * backend ne doit JAMAIS `require('../public/…')` : Firebase ne déploie que
 * `functions/`. Les deux copies partagent les mêmes fixtures de test.
 */

/** Nombre de décimales conservées sur une quantité éclatée. */
const QTY_DECIMALS = 3

/**
 * Arrondi à 3 décimales (neutralise le bruit flottant).
 * @param {number} n
 * @returns {number}
 */
function round3(n) {
  const f = Math.pow(10, QTY_DECIMALS)
  return Math.round((n + Number.EPSILON) * f) / f
}

/**
 * @typedef {Object} MembreGroupe
 * @property {string} label libellé BEE ONE de la parcelle réelle.
 * @property {number} ha surface Smart Berry (doit être > 0).
 * @property {string} [ref] réf BEE ONE (facultatif, propagée telle quelle).
 * @property {string} [culture]
 * @property {string} [ferme]
 */

/**
 * @typedef {Object} PartGroupe
 * @property {string} label
 * @property {number} ha
 * @property {number} pct pourcentage (0–100), arrondi à 1 décimale (AFFICHAGE
 *   uniquement — le calcul des quantités repart des Ha bruts).
 */

/**
 * Valide une liste de membres et renvoie le total des Ha.
 *
 * @param {Array<MembreGroupe>} membres
 * @returns {number} Σ des Ha
 * @throws {Error} si la liste est vide, si un membre n'a pas de Ha > 0, ou si
 *   la somme des Ha est nulle.
 */
function totalHa(membres) {
  if (!Array.isArray(membres) || membres.length === 0) {
    throw new Error('Groupe sans membre : impossible de répartir la quantité')
  }
  let total = 0
  for (const m of membres) {
    const ha = m && typeof m.ha === 'number' ? m.ha : parseFloat((m && m.ha) || '')
    if (!(ha > 0) || !isFinite(ha)) {
      throw new Error(
        'Ha Smart Berry manquant ou nul pour la parcelle « ' +
          ((m && m.label) || '?') +
          ' » : saisir le Ha dans Parcelles & Référentiel avant de l\'inclure dans un groupe'
      )
    }
    total += ha
  }
  if (!(total > 0)) {
    throw new Error('Somme des Ha nulle : répartition impossible')
  }
  return total
}

/**
 * Calcule la part de chaque membre (pour l'AFFICHAGE : liste des groupes,
 * aperçu de saisie).
 *
 * @param {Array<MembreGroupe>} membres
 * @returns {Array<PartGroupe>}
 */
function computeParts(membres) {
  const total = totalHa(membres)
  return membres.map(function (m) {
    const ha = typeof m.ha === 'number' ? m.ha : parseFloat(String(m.ha))
    return {
      label: m.label,
      ha: ha,
      pct: Math.round((ha / total) * 1000) / 10,
    }
  })
}

/**
 * Répartit une quantité entre les membres au prorata de leurs Ha.
 *
 * Σ(parts) === `quantite` EXACTEMENT : les N−1 premières parts sont arrondies à
 * 3 décimales, la dernière absorbe le reste.
 *
 * @param {number} quantite quantité saisie (> 0 attendu ; 0 → parts nulles).
 * @param {Array<MembreGroupe>} membres
 * @returns {Array<{label:string, quantite:number}>}
 */
function splitQuantite(quantite, membres) {
  const total = totalHa(membres)
  const q = typeof quantite === 'number' ? quantite : parseFloat(String(quantite))
  if (!isFinite(q)) {
    throw new Error('Quantité invalide : ' + String(quantite))
  }
  const out = []
  let cumul = 0
  for (let i = 0; i < membres.length; i++) {
    const m = membres[i]
    const ha = typeof m.ha === 'number' ? m.ha : parseFloat(String(m.ha))
    let part
    if (i === membres.length - 1) {
      // Dernière part = reste exact → Σ parts === quantite.
      part = round3(q - cumul)
    } else {
      part = round3((q * ha) / total)
      cumul = round3(cumul + part)
    }
    out.push({ label: m.label, quantite: part })
  }
  return out
}

/**
 * @typedef {Object} GroupeResolu
 * @property {string} id
 * @property {string} label libellé du groupe (jamais écrit comme parcelle).
 * @property {Array<MembreGroupe>} membres membres avec leur Ha DÉJÀ résolu
 *   depuis `sb_parcelle_referentiel` (les Ha ne sont pas figés dans le groupe).
 */

/**
 * Remplace chaque item porteur d'un `groupe_id` par ses N lignes de parcelles
 * réelles. Les items sans `groupe_id` sont laissés strictement inchangés
 * (non-régression de la saisie parcelle simple).
 *
 * Chaque ligne éclatée porte `groupe_id` + `groupe_label` pour la traçabilité,
 * et hérite de `culture` / `ferme` / `parcelle_ref` du membre quand ils sont
 * connus (sinon on garde ceux de l'item d'origine).
 *
 * @param {Array<*>} items items de BC entrants.
 * @param {Object<string, GroupeResolu>} groupesById groupes ACTIFS indexés par id.
 * @returns {Array<*>} items éclatés.
 * @throws {Error} groupe inconnu / inactif, membre sans Ha, Σha nulle.
 */
function expandItems(items, groupesById) {
  const out = []
  for (const item of items || []) {
    const gid = item && item.groupe_id ? String(item.groupe_id) : ''
    if (!gid) {
      out.push(item)
      continue
    }
    const groupe = groupesById && groupesById[gid]
    if (!groupe) {
      throw new Error('Groupe de parcelles inconnu ou inactif : ' + gid)
    }
    const parts = splitQuantite(parseFloat(item.quantite) || 0, groupe.membres)
    for (let i = 0; i < parts.length; i++) {
      const membre = groupe.membres[i]
      out.push(
        Object.assign({}, item, {
          parcelle: membre.label,
          parcelle_ref: membre.ref != null && membre.ref !== '' ? membre.ref : item.parcelle_ref || '',
          culture: membre.culture != null && membre.culture !== '' ? membre.culture : item.culture || '',
          ferme: membre.ferme != null && membre.ferme !== '' ? membre.ferme : item.ferme || '',
          quantite: parts[i].quantite,
          groupe_id: groupe.id,
          groupe_label: groupe.label || '',
        })
      )
    }
  }
  return out
}

module.exports = {
  QTY_DECIMALS,
  round3,
  totalHa,
  computeParts,
  splitQuantite,
  expandItems,
}
