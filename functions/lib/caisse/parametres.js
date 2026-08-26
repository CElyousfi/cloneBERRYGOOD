'use strict';
// @ts-check

/**
 * Module pur — paramètres de la Gestion de Caisse : liste des fermes et liste
 * des codes analytiques utilisables sur un bon de caisse.
 *
 * Volontairement SÉPARÉ de `config_analytique` (écran Finance) : ce dernier est
 * le plan analytique des ACHATS, avec ferme, catégorie d'achat et nature CPC
 * par code. Ici il s'agit d'une simple liste de natures de dépense propre à la
 * caisse. Mélanger les deux polluerait les écrans Achats.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

/**
 * Fermes proposées par défaut au premier démarrage.
 * `GENERAL` = dépense non rattachable à une ferme.
 * @type {ReadonlyArray<string>}
 */
const DEFAULT_FERMES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'BGF', 'GENERAL'];

/**
 * Codes analytiques proposés au premier démarrage. Liste fournie par Omar
 * (2026-08-26), dans son ordre — l'ordre de saisie est l'ordre d'affichage,
 * il n'est PAS trié alphabétiquement.
 * @type {ReadonlyArray<string>}
 */
const DEFAULT_CODES_ANALYTIQUES = [
  'Plants',
  'Loyer terrains',
  'Engrais',
  'Pesticides',
  'Eau ORMVA',
  'Électricité',
  'Combustibles',
  'Fumier & Taille',
  'Salaires & Encadrement',
  'Quinzaines',
  'CNSS & IR',
  'Irrigation & Brumisation',
  'Entretien & Réparations',
  'Matériels & Équipements',
  'Logistique & Transport',
  'Administration & Frais Généraux',
];

/**
 * Parcelles : aucune valeur par défaut possible — elles viennent du référentiel
 * de campagne (BEE ONE). Elles sont FIGÉES dans les paramètres pour que la
 * saisie d'un bon soit instantanée : l'agrégation source met plusieurs secondes,
 * ce qui est inacceptable au moment de saisir. L'écran Paramètres offre un
 * bouton de rafraîchissement quand la campagne évolue.
 * @type {ReadonlyArray<Object>}
 */
const DEFAULT_PARCELLES = [];

/** Longueur maximale d'une entrée (ferme ou code). */
const MAX_LEN = 60;
/** Nombre maximal d'entrées par liste — garde-fou contre un payload aberrant. */
const MAX_ITEMS = 200;
/** Nombre maximal de parcelles figées (le référentiel en compte ~50). */
const MAX_PARCELLES = 1000;

/**
 * Nettoie une liste saisie : trim, retrait des vides, déduplication
 * insensible à la casse (la PREMIÈRE graphie rencontrée est conservée),
 * ordre de saisie préservé.
 *
 * @param {*} liste
 * @returns {string[]}
 */
function normalizeListe(liste) {
  if (!Array.isArray(liste)) return [];
  /** @type {string[]} */
  const out = [];
  const vus = new Set();
  for (const brut of liste) {
    if (typeof brut !== 'string') continue;
    const v = brut.trim();
    if (!v) continue;
    const cle = v.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push(v);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Valide une liste avant enregistrement.
 *
 * @param {string} nom       Nom lisible de la liste, pour le message d'erreur.
 * @param {string[]} liste   Liste DÉJÀ normalisée.
 * @returns {string|null}    Message d'erreur, ou `null` si valide.
 */
function validateListe(nom, liste) {
  if (!Array.isArray(liste) || liste.length === 0) {
    return `La liste des ${nom} ne peut pas être vide.`;
  }
  const tropLong = liste.find((v) => v.length > MAX_LEN);
  if (tropLong) return `Entrée trop longue dans les ${nom} (max ${MAX_LEN} caractères) : « ${tropLong.slice(0, 30)}… »`;
  return null;
}

/**
 * Nettoie la liste de parcelles figée. Chaque entrée est réduite aux 4 champs
 * utiles à la saisie : `label` (valeur stockée sur le bon, clé de jointure
 * analytique), `nom` (affichage), `culture` (filtre) et `ferme` (déduction).
 * Une entrée sans `label` est ignorée ; doublons de label écartés.
 *
 * Volontairement NON trié : l'ordre reçu du référentiel est conservé.
 *
 * @param {*} liste
 * @returns {Array<{label: string, nom: string, culture: string, ferme: string, campagne: string}>}
 */
function normalizeParcelles(liste) {
  if (!Array.isArray(liste)) return [];
  const out = [];
  const vus = new Set();
  for (const brut of liste) {
    if (!brut || typeof brut !== 'object') continue;
    const label = typeof brut.label === 'string' ? brut.label.trim() : '';
    if (!label) continue;
    const cle = label.toUpperCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push({
      label,
      nom: typeof brut.nom === 'string' && brut.nom.trim() ? brut.nom.trim() : label,
      culture: typeof brut.culture === 'string' ? brut.culture.trim() : '',
      ferme: typeof brut.ferme === 'string' ? brut.ferme.trim() : '',
      campagne: typeof brut.campagne === 'string' ? brut.campagne.trim() : '',
    });
    if (out.length >= MAX_PARCELLES) break;
  }
  return out;
}

/**
 * Paramètres complets à partir d'un document Firestore éventuellement absent
 * ou partiel : une liste vide ou manquante retombe sur les valeurs par défaut,
 * afin que les listes déroulantes ne soient JAMAIS vides.
 *
 * @param {Object} [doc]
 * @returns {{fermes: string[], codes_analytiques: string[]}}
 */
function withDefaults(doc) {
  const d = doc || {};
  const fermes = normalizeListe(d.fermes);
  const codes = normalizeListe(d.codes_analytiques);
  return {
    fermes: fermes.length ? fermes : DEFAULT_FERMES.slice(),
    codes_analytiques: codes.length ? codes : DEFAULT_CODES_ANALYTIQUES.slice(),
    // Pas de repli possible : une liste vide signifie « jamais rafraîchie ».
    parcelles: normalizeParcelles(d.parcelles),
    parcelles_maj_at: d.parcelles_maj_at || null,
  };
}

/**
 * La valeur fait-elle partie de la liste autorisée ? Une valeur vide passe
 * toujours : les axes analytiques d'un bon sont facultatifs.
 *
 * @param {*} valeur
 * @param {string[]} [autorisees]
 * @returns {boolean}
 */
function estAutorisee(valeur, autorisees) {
  if (valeur === undefined || valeur === null || String(valeur).trim() === '') return true;
  if (!Array.isArray(autorisees) || autorisees.length === 0) return true;
  return autorisees.indexOf(String(valeur).trim()) !== -1;
}

module.exports = {
  DEFAULT_FERMES, DEFAULT_CODES_ANALYTIQUES, DEFAULT_PARCELLES, MAX_LEN, MAX_ITEMS, MAX_PARCELLES,
  normalizeListe, normalizeParcelles, validateListe, withDefaults, estAutorisee,
}
