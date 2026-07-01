'use strict';
// @ts-check

/**
 * paieAccess.js — Décisions d'accès PURES pour le gating des lectures paie
 * nominatives (Étape 0 sécurité).
 *
 * Deux surfaces protégées :
 *  1. Sous-traitance nominative (`pointage_divers`) via les actions
 *     `divers-entries` / `divers-entries-range`. Ces données n'ont PAS de champ
 *     ferme → NON cloisonnables par ferme. Accès réservé aux profils full-access
 *     (dg / finance / rh / admin). Un chef (périmètre = une ferme) est REFUSÉ.
 *  2. Agrégats pointage RH nominatifs (`sql_mirror_pointage`) via pointageRH.
 *     full-access → toutes fermes ; chef → filtré sur SA ferme ; autres → 403.
 *
 * Toutes les fonctions sont PURES : elles reçoivent un objet `perim`
 * (sortie de resolvePerimetre) et renvoient une décision. Aucun accès I/O.
 */

/**
 * @typedef {Object} Perimetre
 * @property {boolean} autorise
 * @property {('all'|string)} perimetre_ferme
 */

/**
 * Accès aux données de sous-traitance nominative (pointage_divers).
 * Autorisé UNIQUEMENT si périmètre global ('all' : dg/finance/rh/admin).
 * Un chef (ferme spécifique) ou un profil non autorisé → refusé (fail-closed).
 *
 * @param {Perimetre|null|undefined} perim - sortie de resolvePerimetre.
 * @returns {boolean}
 */
function canAccessDivers(perim) {
  return !!(perim && perim.autorise === true && perim.perimetre_ferme === 'all');
}

/**
 * Décide du mode d'accès pointage RH pour l'appelant.
 *  - !autorise                       → { allowed:false }                 (403)
 *  - perimetre_ferme === 'all'       → { allowed:true, fermeFilter:null } (toutes fermes)
 *  - perimetre_ferme === une ferme   → { allowed:true, fermeFilter:'<ferme>' } (chef résolu)
 *  - perimetre_ferme vide/falsy      → { allowed:false }                 (403, chef cassé)
 *
 * SÉCURITÉ (fail-closed strict) : la valeur retour `fermeFilter` est consommée
 * côté handler par un test de vérité (`_fermeFilter ? filtre : passthrough`) où
 * `null` == full-access légitime (RH/DG/Finance) = passthrough toutes fermes.
 * Un chef sans ferme résolue arrive ici avec `perimetre_ferme === ''` (falsy) :
 * on NE PEUT PAS le renvoyer comme fermeFilter '' car '' est FALSY → le handler
 * le confondrait avec un full-access et ferait un passthrough TOUTES FERMES
 * (fuite nominative cross-ferme). On REFUSE donc explicitement (403) : un chef
 * dont le périmètre ferme n'est pas résoluble n'a aucun périmètre légitime.
 *
 * On distingue "full-access" ('all') de "chef cassé" ('' / falsy) : seul le
 * périmètre exact 'all' donne fermeFilter null ; toute autre valeur doit être
 * une ferme non vide, sinon 403. Aucune ambiguïté falsy ne remonte au handler.
 *
 * @param {Perimetre|null|undefined} perim
 * @returns {{allowed: boolean, fermeFilter: (null|string)}}
 */
function resolvePointageRHAccess(perim) {
  if (!perim || perim.autorise !== true) return { allowed: false, fermeFilter: null };
  if (perim.perimetre_ferme === 'all') return { allowed: true, fermeFilter: null };
  // Chef (ou tout périmètre non-'all') : la ferme DOIT être une string non vide.
  // Périmètre ferme vide/falsy (chef non résolu : chef_agronomie, chef_da, chef_f3…)
  // → 403. Jamais de fermeFilter falsy qui deviendrait un passthrough côté handler.
  const ferme = perim.perimetre_ferme;
  if (typeof ferme === 'string' && ferme.trim() !== '') {
    return { allowed: true, fermeFilter: ferme };
  }
  return { allowed: false, fermeFilter: null };
}

module.exports = { canAccessDivers, resolvePointageRHAccess };
