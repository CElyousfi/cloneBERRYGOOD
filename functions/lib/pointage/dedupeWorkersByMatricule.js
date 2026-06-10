'use strict';
// @ts-check

/**
 * Déduplique une liste de workers récolte par matricule.
 *
 * Source : action `recolte` de pointageService. Les lignes BR_Pointage sont
 * 1 par (ouvrier × parcelle × opération). Un ouvrier réparti sur N parcelles
 * apparaît donc N fois → le compteur d'effectif (count) est gonflé.
 *
 * Ce helper regroupe par matricule (clé normalisée UPPER/trim) en :
 *  - SOMMANT heures et coût (on ne perd rien : la somme totale est identique),
 *  - SOMMANT la quantité (kg) — légitime car un ouvrier peut récolter sur
 *    plusieurs parcelles le même jour. (La branche prod écrase ensuite la
 *    quantité par le scan, donc cette somme ne fausse pas le kg quand un scan
 *    existe.)
 *  - conservant la 1re occurrence pour les champs descriptifs (nom, opération,
 *    parcelle, ferme, variété).
 *
 * Idempotent : re-dédupliquer une liste déjà dédupliquée renvoie la même chose.
 *
 * @typedef {Object} RecolteWorker
 * @property {string} matricule
 * @property {string} [nom]
 * @property {string} [operation]
 * @property {number} [quantite]
 * @property {number} [heures]
 * @property {number} [cout]
 * @property {string} [parcelle]
 * @property {string} [ferme]
 * @property {string} [variete]
 *
 * @param {Array<RecolteWorker>} workers
 * @returns {Array<RecolteWorker>}
 */
function dedupeWorkersByMatricule(workers) {
  const list = Array.isArray(workers) ? workers : [];
  const byMat = {};
  const order = [];
  for (const w of list) {
    const key = (w.matricule || '').toString().toUpperCase().trim();
    if (!key) {
      // Ligne sans matricule : on la garde telle quelle (pas de dédup possible).
      order.push({ _orphan: true, w: { ...w } });
      continue;
    }
    if (!byMat[key]) {
      byMat[key] = { ...w };
      order.push({ key: key });
    } else {
      byMat[key].heures = (byMat[key].heures || 0) + (w.heures || 0);
      byMat[key].cout = (byMat[key].cout || 0) + (w.cout || 0);
      byMat[key].quantite = (byMat[key].quantite || 0) + (w.quantite || 0);
    }
  }
  return order.map((o) => (o._orphan ? o.w : byMat[o.key]));
}

module.exports = { dedupeWorkersByMatricule };
