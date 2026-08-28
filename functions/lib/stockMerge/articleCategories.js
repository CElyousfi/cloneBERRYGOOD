'use strict'
// @ts-check

/**
 * articleCategories.js (BACKEND) — LIBELLÉ CANONIQUE d'une catégorie d'article,
 * à L'ÉCRITURE du catalogue (`articles_catalog.categorie`).
 *
 * ── POURQUOI CE FICHIER EXISTE EN DOUBLE ───────────────────────────────────
 * La liste canonique de référence est `public/lib/articleCategories.js` (elle
 * pilote le `<select>` de la fiche article). Le backend NE PEUT PAS la
 * requérir : Firebase ne déploie QUE `functions/`, un `require('../public/…')`
 * ferait échouer le chargement du module et TOUTES les Cloud Functions
 * tomberaient — panne invisible en test local, où le fichier existe.
 * C'est donc une COPIE, verrouillée par un test anti-divergence
 * (tests/unit/articleCategorieCanonique.test.js) qui rougit dès que les deux
 * listes cessent de correspondre à l'octet près.
 *
 * ── LE PROBLÈME QUE CE MODULE RÈGLE ────────────────────────────────────────
 * Les chemins d'écriture du catalogue passaient la catégorie par une
 * normalisation en MINUSCULES. Le catalogue portait donc `Engrais` (saisi à
 * l'écran, liste fermée) ET `engrais` (posé par l'import) pour la même famille.
 * Mesure du 2026-08-28 sur les 1019 fiches `active === true` de production :
 * 53 fiches hors liste canonique (`engrais` 18, `pesticides` 12,
 * `IMMOBILISATIONS` 11, `phyto` 8, `PHYTO-SANITAIRE` 2, `emballage` 1,
 * `PESTICIDES` 1). Normaliser ces 53 fiches sans corriger les chemins
 * d'écriture ne servirait à rien : le réimport les recréerait le lendemain.
 *
 * ⚠️ NE PAS CONFONDRE avec les 5 documents SANS champ `categorie` du catalogue
 * (`ENG 0150`, `ENG 0952`, `eng 1245`, `eng 456`, `enr 14`). Ce NE SONT PAS des
 * fiches article : ils n'ont ni `nom`, ni `active`, ni `source` — seulement
 * `prix_ht`, `prix_ttc` et `updated_at`. Ce sont les 5 documents FANTÔMES nés
 * de références espacées (cf. `articleMerge.verifierIntegriteFiche`), et leur
 * sort ne se joue pas ici. La règle 4 ci-dessous ne les vise donc pas : elle
 * protège une catégorie vide en ENTRÉE, quelle qu'en soit l'origine.
 *
 * ── LES QUATRE RÈGLES, DANS CET ORDRE ──────────────────────────────────────
 *  1. Une valeur RECONNUE, quelle que soit sa casse, rend le libellé canonique
 *     (`engrais` / `ENGRAIS` / `Engrais` → `Engrais`).
 *  2. Un SYNONYME connu rend le libellé de sa famille (`phyto`,
 *     `PHYTO-SANITAIRE`, `pesticide` → `Pesticides` ; `IMMOBILISATIONS` →
 *     `IMMOBILISATION`).
 *  3. Une valeur INCONNUE est CONSERVÉE telle quelle. On ne la réécrit jamais,
 *     et surtout on ne la force pas sur un défaut : inventer une catégorie est
 *     pire que d'en garder une inconnue — la valeur bizarre reste visible à
 *     l'écran (« (valeur actuelle) ») et donc corrigeable.
 *  4. Une valeur VIDE reste VIDE — jamais repliée sur `autre`. Une ligne sans
 *     catégorie doit rester repérable comme telle : lui inventer une famille,
 *     c'est le patron « zéro par défaut » appliqué à une donnée qualitative.
 *
 * ⚠️ CE MODULE N'ENTRE JAMAIS DANS LE CALCUL D'UN docId. La formule
 * d'identifiant des imports se calcule sur la catégorie BRUTE, délibérément :
 * la normaliser changerait l'identifiant de toutes les fiches existantes, le
 * prochain import ne les retrouverait plus et en créerait une seconde vague.
 * On change la valeur ENREGISTRÉE, jamais l'identifiant.
 */

/**
 * Catégories canoniques — COPIE EXACTE de `public/lib/articleCategories.js`.
 *
 * ⚠️ Chaque libellé est la forme DOMINANTE réellement présente en base, à
 * l'octet près, pas une jolie orthographe : `autre` en minuscule et
 * `IMMOBILISATION` en capitales sont VOULUS. « Embellir » un libellé
 * fabriquerait une variante de plus au lieu d'en supprimer une.
 *
 * Toute modification ici DOIT être répercutée dans le fichier frontend (le
 * test anti-divergence l'impose).
 *
 * @type {string[]}
 */
const CATEGORIES_ARTICLE = [
  'Engrais',
  'Pesticides',
  'Achats consommés de matières et fournitures',
  'IMMOBILISATION',
  'Fournitures entr. et rép.',
  'Frais généraux',
  'Charges Externes',
  'charges personnel',
  'Carburants et lubrifiants',
  'Emballage',
  'PRODUIT BIO',
  'materiel',
  'Pièces de rechange',
  'Energies',
  'Petit Outillage',
  'Semences',
  'PEPINIERE',
  'BRISE VENT',
  'DESINFECTION SOL',
  'autre',
]

/**
 * Synonymes : orthographe RENCONTRÉE EN BASE (ou envoyée par un écran) →
 * libellé canonique. Clés comparées en minuscules, espaces réduits.
 *
 * N'y mettre QUE des équivalences certaines. `phyto` et `PHYTO-SANITAIRE`
 * désignent sans ambiguïté les produits phytosanitaires, que le catalogue
 * appelle `Pesticides` (262 fiches) — c'est d'ailleurs déjà ce que fait
 * `consoValorisation.familleBucket` à la LECTURE. `pesticide` au singulier est
 * la valeur envoyée par le bandeau « à classer » de l'écran Campagne : sans
 * cette entrée, chaque classement fabriquerait une 21e orthographe.
 *
 * @type {Record<string,string>}
 */
const SYNONYMES_CATEGORIE = {
  phyto: 'Pesticides',
  'phyto-sanitaire': 'Pesticides',
  phytosanitaire: 'Pesticides',
  pesticide: 'Pesticides',
  immobilisations: 'IMMOBILISATION',
}

/**
 * Clé de comparaison : minuscules + espaces réduits + trim. La casse et les
 * espaces sont les SEULES différences qu'on efface — aucun retrait d'accent
 * (`Pièces de rechange` et `Energies` doivent rester distincts de toute
 * variante accentuée qu'on n'a pas mesurée).
 * @param {*} valeur
 * @returns {string}
 */
function cleCategorie(valeur) {
  if (valeur == null) return ''
  return String(valeur).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Index clé → libellé canonique (liste + synonymes). @type {Record<string,string>} */
const INDEX_CANONIQUE = {}
for (const libelle of CATEGORIES_ARTICLE) {
  INDEX_CANONIQUE[cleCategorie(libelle)] = libelle
}
for (const cle of Object.keys(SYNONYMES_CATEGORIE)) {
  INDEX_CANONIQUE[cleCategorie(cle)] = SYNONYMES_CATEGORIE[cle]
}

/**
 * Libellé canonique à ENREGISTRER pour une catégorie brute.
 *
 * Seule règle de normalisation de catégorie du dépôt : les trois chemins
 * d'import (`import-articles-sql`, `import-articles-excel`, `create-article`)
 * et le classement (`classer-article`) l'appellent tous.
 *
 * @param {*} valeur Catégorie brute (source SQL, fichier Excel, formulaire).
 * @returns {string} Libellé canonique ; la valeur d'origine (espaces réduits)
 *   si elle est inconnue ; `''` si elle est vide.
 */
function categorieCanonique(valeur) {
  if (valeur == null) return ''
  // Espaces réduits et bords rognés : c'est du bruit de saisie, jamais une
  // information. La CASSE, elle, n'est touchée que sur une valeur reconnue.
  const brut = String(valeur).replace(/\s+/g, ' ').trim()
  if (!brut) return ''
  const canon = INDEX_CANONIQUE[cleCategorie(brut)]
  return canon === undefined ? brut : canon
}

/**
 * La valeur est-elle EXACTEMENT un libellé canonique ? (comparaison stricte,
 * casse comprise — pendant backend de `estCanonique` côté frontend.)
 * @param {*} valeur
 * @returns {boolean}
 */
function estCategorieCanonique(valeur) {
  return typeof valeur === 'string' && CATEGORIES_ARTICLE.indexOf(valeur) !== -1
}

module.exports = {
  CATEGORIES_ARTICLE,
  SYNONYMES_CATEGORIE,
  categorieCanonique,
  estCategorieCanonique,
}
