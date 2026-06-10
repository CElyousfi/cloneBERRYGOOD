'use strict';
// @ts-check

/**
 * Agrège des effectifs d'ouvriers DISTINCTS par (ferme, type) à partir de
 * lignes brutes de pointage (1 ligne par ouvrier × parcelle × opération).
 *
 * Corrige le bug du comptage gonflé : auparavant le backend sommait un
 * COUNT(DISTINCT matricule) GROUP BY parcelle/opération, donc un ouvrier
 * réparti sur N parcelles était compté N fois. Ici on déduplique au niveau
 * (ferme, type) via des Set de matricules.
 *
 * - `recolte` / `horsRecolte` / `postesFixes` = nb de matricules distincts
 *   de la ferme pour ce type.
 * - `total` = nb de matricules distincts de la ferme, TOUS types confondus
 *   (Set ferme global — robuste si un ouvrier a 2 types le même jour).
 * - `cout` = SOMME des coûts (inchangé, le coût n'est pas dédoublonné).
 *
 * @typedef {Object} RawPointageLine
 * @property {string} matricule  Personnel_Matricule (déjà résolu)
 * @property {'F1'|'F5'|'Avocatier'|'BAHIA'|string} ferme  ferme dérivée
 * @property {'recolte'|'horsRecolte'|'postesFixes'} type  type classé
 * @property {number} [cout]  coût de la ligne
 *
 * @typedef {Object} FermeEffectif
 * @property {number} recolte
 * @property {number} horsRecolte
 * @property {number} postesFixes
 * @property {number} total
 * @property {number} cout
 *
 * @param {Array<RawPointageLine>} lines
 * @param {Array<string>} [fermesList] liste de fermes à initialiser (buckets vides)
 * @returns {Record<string, FermeEffectif>}
 */
function countDistinctByFermeType(lines, fermesList) {
  const fermes = {};
  const ensure = (f) => {
    if (!fermes[f]) {
      fermes[f] = {
        recolteSet: new Set(),
        horsRecolteSet: new Set(),
        postesFixesSet: new Set(),
        totalSet: new Set(),
        cout: 0,
      };
    }
    return fermes[f];
  };

  // Initialise les buckets demandés (pour renvoyer des 0 explicites)
  if (Array.isArray(fermesList)) {
    for (const f of fermesList) ensure(f);
  }

  for (const line of lines || []) {
    const ferme = line.ferme;
    if (!ferme) continue;
    // Si une liste de fermes est fournie, on ignore les fermes hors liste
    // (comportement historique : seules F1/F5/Avocatier/BAHIA sont comptées).
    if (Array.isArray(fermesList) && !Object.prototype.hasOwnProperty.call(fermes, ferme)) {
      continue;
    }
    const bucket = ensure(ferme);
    const matricule = line.matricule;
    if (matricule) {
      bucket.totalSet.add(matricule);
      if (line.type === 'recolte') bucket.recolteSet.add(matricule);
      else if (line.type === 'postesFixes') bucket.postesFixesSet.add(matricule);
      else bucket.horsRecolteSet.add(matricule);
    }
    bucket.cout += line.cout || 0;
  }

  const out = {};
  for (const f of Object.keys(fermes)) {
    const b = fermes[f];
    out[f] = {
      recolte: b.recolteSet.size,
      horsRecolte: b.horsRecolteSet.size,
      postesFixes: b.postesFixesSet.size,
      total: b.totalSet.size,
      cout: b.cout,
    };
  }
  return out;
}

module.exports = { countDistinctByFermeType };
