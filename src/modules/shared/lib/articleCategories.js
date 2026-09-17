// @ts-check

/**
 * articleCategories.js — LISTE CANONIQUE des catégories d'article et options du
 * `<select>` de la fiche article (Stock › Articles, création ET édition).
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────
 * Le champ Catégorie était un texte libre (`<input list>` + `<datalist>`).
 * Résultat mesuré sur les 1130 fiches actives : `Engrais` ET `engrais`,
 * `Pesticides` ET `PESTICIDES` ET `pesticides`, plus `phyto` et
 * `PHYTO-SANITAIRE`, `IMMOBILISATION` et `IMMOBILISATIONS`. Une faute de
 * frappe créait silencieusement une 25e catégorie et l'article sortait des
 * deux onglets de consommation.
 *
 * ── LA RÈGLE QUI COMPTE : NE JAMAIS CHANGER UNE VALEUR EN DOUCE ─────────────
 * `optionsCategorie` compare EXACTEMENT, casse comprise. Une fiche portant
 * `engrais`, `phyto` ou `IMMOBILISATIONS` reçoit son AUTRE valeur en option
 * supplémentaire, sélectionnée telle quelle et marquée « (valeur actuelle) ».
 * Ouvrir une fiche puis « Enregistrer » sans toucher au champ ne modifie donc
 * RIEN.
 *
 * ⚠️ Une comparaison insensible à la casse serait le bug central de ce
 * module : elle ferait silencieusement basculer `engrais` → `Engrais` sur 366
 * fiches au premier enregistrement, et `pesticides` → `Pesticides` sur 326.
 * Une normalisation des valeurs existantes est une décision d'Omar, pas un
 * effet de bord de la saisie.
 *
 * `Engrais` et `Pesticides` sont en tête : ce sont les deux seules familles que
 * `familleBucket` (functions/lib/valorisation/consoValorisation.js) sait
 * classer, donc les deux qui commandent les écrans de consommation. `autre`
 * ferme la liste.
 *
 * SOURCE DE VÉRITÉ UNIQUE : création et édition partagent `renderFormFields`
 * dans AchatsCatalogueTab, qui appelle ce module. Aucune liste en dur ailleurs.
 */

/**
 * Catégories proposées, dans l'ordre d'affichage.
 *
 * ⚠️ CHAQUE LIBELLÉ EST LA FORME DOMINANTE RÉELLEMENT PRÉSENTE EN BASE,
 * À L'OCTET PRÈS (comptage sur les 1125 fiches actives, 2026-08-27) — pas
 * une jolie orthographe. Oui, `autre` est en minuscule et `IMMOBILISATION`
 * en capitales : c'est VOULU.
 *
 * Une première version de cette liste avait « embelli » 10 libellés
 * (`Immobilisation`, `Autre`, `Matériel`…). Effet mesuré : choisir
 * délibérément `Immobilisation` dans la liste sur une fiche `IMMOBILISATION`
 * aurait fabriqué une 25e orthographe à côté des 134 existantes — la liste
 * fermée aurait CRÉÉ du désordre au lieu d'en supprimer. Le nombre de fiches
 * marquées « (valeur actuelle) » tombe de 335 à ~136 grâce à cet alignement.
 *
 * N'ajouter ici AUCUNE variante minoritaire (`IMMOBILISATIONS` 11, `phyto` 8,
 * `PHYTO-SANITAIRE` 2, `engrais` 67, `pesticides` 41, `emballage` 1) : ce
 * sont de vraies anomalies, elles DOIVENT rester visibles en « (valeur
 * actuelle) » pour qu'Omar les repère et les normalise. C'est le signal utile.
 *
 * @type {string[]}
 */
var CATEGORIES_ARTICLE = [
  'Engrais',                                     // 299 fiches
  'Pesticides',                                  // 274
  'Achats consommés de matières et fournitures', // 164
  'IMMOBILISATION',                              // 134 — capitales VOULUES
  'Fournitures entr. et rép.',                   // 22
  'Frais généraux',                              // 19
  'Charges Externes',                            // 7  — « E » majuscule VOULU
  'charges personnel',                           // 6  — minuscules VOULUES
  'Carburants et lubrifiants',                   // 5
  'Emballage',                                   // 4
  'PRODUIT BIO',                                 // 4  — capitales VOULUES
  'materiel',                                    // 3  — sans accent, VOULU
  'Pièces de rechange',                          // 2
  'Energies',                                    // 2  — sans accent, VOULU
  'Petit Outillage',                             // 1  — « O » majuscule VOULU
  'Semences',                                    // 1
  'PEPINIERE',                                   // 1  — capitales VOULUES
  'BRISE VENT',                                  // 1  — capitales VOULUES
  'DESINFECTION SOL',                            // 1  — capitales VOULUES
  'autre',                                       // 44 — minuscule VOULUE, ferme la liste
];

/** Libellé de l'option vide (fiche sans catégorie, ou création). */
var LABEL_VIDE = '— Choisir —';

/** Suffixe signalant une valeur hors liste canonique, à normaliser. */
var SUFFIXE_HORS_LISTE = ' (valeur actuelle)';

/**
 * @typedef {Object} OptionCategorie
 * @property {string} value valeur écrite dans la fiche (JAMAIS retouchée).
 * @property {string} label libellé affiché.
 * @property {boolean} horsListe true si la valeur ne fait pas partie du canon.
 */

/**
 * Options du `<select>` Catégorie pour la valeur ACTUELLE d'une fiche.
 *
 * @param {*} valeurActuelle catégorie enregistrée sur la fiche ('' à la création).
 * @returns {OptionCategorie[]}
 */
function optionsCategorie(valeurActuelle) {
  var actuelle = typeof valeurActuelle === 'string' ? valeurActuelle : '';
  var options = [{ value: '', label: LABEL_VIDE, horsListe: false }];
  for (var i = 0; i < CATEGORIES_ARTICLE.length; i++) {
    options.push({ value: CATEGORIES_ARTICLE[i], label: CATEGORIES_ARTICLE[i], horsListe: false });
  }
  // Comparaison EXACTE (cf. en-tête) : `engrais` n'est PAS `Engrais`.
  if (actuelle !== '' && CATEGORIES_ARTICLE.indexOf(actuelle) === -1) {
    options.push({ value: actuelle, label: actuelle + SUFFIXE_HORS_LISTE, horsListe: true });
  }
  return options;
}

/**
 * La valeur d'une fiche est-elle proposable telle quelle ? (une option
 * existe TOUJOURS pour elle — c'est l'invariant anti-réécriture.)
 * @param {*} valeurActuelle
 * @returns {boolean}
 */
function estCanonique(valeurActuelle) {
  return typeof valeurActuelle === 'string' && CATEGORIES_ARTICLE.indexOf(valeurActuelle) !== -1;
}

export { CATEGORIES_ARTICLE, LABEL_VIDE, SUFFIXE_HORS_LISTE, optionsCategorie, estCanonique };
