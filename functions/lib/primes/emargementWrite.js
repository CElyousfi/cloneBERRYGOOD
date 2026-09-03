'use strict';
// @ts-check

/**
 * emargementWrite.js — Forme PURE de l'enregistrement d'un état d'émargement
 * SIGNÉ (heures supplémentaires), une pièce jointe par FERME et par quinzaine.
 *
 * Le document `rh_heures_sup/<periode>` porte une map `emargements` keyée par
 * ferme normalisée, partagée par TOUTES les fermes de la quinzaine. Le dépôt,
 * lui, est unitaire : une ferme à la fois. L'écriture doit donc viser le CHEMIN
 * de la seule ferme déposée, jamais la map entière.
 *
 * PIÈGE HISTORIQUE (déjà payé sur `montants`, cf. heuresSupWrite.js) :
 * `set({ emargements: {} }, { merge: true })` ne préserve rien. Firestore dérive
 * le masque de champs des FEUILLES de l'objet fourni ; une map vide n'a aucune
 * feuille, le masque porte donc `emargements` lui-même et la map est REMPLACÉE
 * par une map vide — les états déposés par les autres fermes disparaissent.
 * D'où l'invariant testé : `data.emargements` n'est JAMAIS un objet vide.
 *
 * Le même document porte les MONTANTS d'heures sup : une écriture non mergée,
 * ou un masque trop large, détruirait de la paie. Toutes les écritures d'ici
 * sont donc mergées et ne portent que la feuille de la ferme concernée.
 *
 * Module PUR : aucune dépendance Firestore. Retourne la paire exacte passée à
 * `ref.set(data, options)`.
 */

const { sanitizeFilename } = require('../stock/scanAttachmentUtils');

/** Préfixe imposé aux objets Storage des états d'émargement. */
const EMARGEMENT_PREFIX = 'rh_emargements/';

/**
 * Clé de map Firestore pour une ferme. Sans accent, sans espace, en capitales :
 * « Avocatier », « AVOCATIER » et « avocatier » désignent la même ferme et
 * doivent donc désigner la même entrée — sinon un dépôt écraserait un état
 * pendant qu'un autre resterait affiché comme manquant.
 *
 * Firestore interdit par ailleurs `.`, `/`, `[`, `]`, `*`, `` ` `` dans une clé
 * de map : tout caractère non alphanumérique est réduit à `_`.
 *
 * @param {unknown} ferme
 * @returns {string} la clé normalisée, ou '' si la ferme est vide/inexploitable.
 */
function normalizeFermeKey(ferme) {
  const raw = String(ferme == null ? '' : ferme).trim();
  if (!raw) return '';
  const noAccent = raw.normalize ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : raw;
  return noAccent
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Chemin Storage canonique d'un état d'émargement :
 *   rh_emargements/<periode>/<FERME>_<timestamp>_<safeFilename>
 * Construit côté client AVANT l'upload direct, revalidé côté serveur par
 * `isEmargementPath` (un client altéré ne doit pas pouvoir faire enregistrer un
 * objet situé ailleurs dans le bucket).
 *
 * @param {unknown} periode
 * @param {unknown} ferme
 * @param {unknown} filename
 * @param {number} [timestamp] epoch ms ; défaut Date.now().
 * @returns {string}
 * @throws {Error} si la période ou la ferme est vide.
 */
function buildEmargementPath(periode, ferme, filename, timestamp) {
  const per = normalizeFermeKey(periode);
  if (!per) throw new Error('periode requise');
  const key = normalizeFermeKey(ferme);
  if (!key) throw new Error('ferme requise');
  const ts = typeof timestamp === 'number' && isFinite(timestamp) ? timestamp : Date.now();
  return EMARGEMENT_PREFIX + per + '/' + key + '_' + ts + '_' + sanitizeFilename(filename);
}

/**
 * Vrai si le chemin appartient bien au dossier de CETTE quinzaine.
 *
 * La période est OBLIGATOIRE, et pas seulement le préfixe : sans elle, un
 * appelant autorisé peut faire enregistrer sur la quinzaine 05 un objet déposé
 * dans le dossier de la quinzaine 04 — le lien enregistré désignerait alors un
 * état signé pour une autre paie. La contrainte est gratuite (le chemin est
 * construit par `buildEmargementPath`, qui produit exactement ce dossier), donc
 * on la pose. Un argument `periode` manquant fait échouer la validation plutôt
 * que de la relâcher : aucun futur appelant ne peut sauter la vérification par
 * omission.
 *
 * @param {unknown} storagePath
 * @param {unknown} periode
 * @returns {boolean}
 */
function isEmargementPath(storagePath, periode) {
  if (typeof storagePath !== 'string') return false;
  const dossier = normalizeFermeKey(periode);
  if (!dossier) return false;
  const prefix = EMARGEMENT_PREFIX + dossier + '/';
  return storagePath.indexOf(prefix) === 0
    && storagePath.length > prefix.length
    && storagePath.indexOf('..') === -1;
}

/**
 * @typedef {Object} EmargementMeta
 * @property {string} path        Chemin Storage de l'objet déjà uploadé.
 * @property {string} [filename]  Nom d'origine (affiché à la RH).
 * @property {*} [now]            Horodatage (serverTimestamp côté appelant).
 * @property {*} [actor]          Auteur du dépôt, résolu SERVEUR.
 */

/**
 * @typedef {Object} EmargementWrite
 * @property {Object} data              Payload à passer à ref.set().
 * @property {{merge: true}} options    Options du set : merge TOUJOURS actif.
 * @property {string} fermeKey          Clé de map réellement écrite.
 */

/**
 * Construit l'écriture mergée de l'état d'émargement signé d'UNE ferme.
 *
 * @param {unknown} periode  Quinzaine (id du document).
 * @param {unknown} ferme    Ferme (label affiché : F1, F5, BAHIA, Avocatier…).
 * @param {EmargementMeta} meta
 * @returns {EmargementWrite}
 * @throws {Error} si période, ferme ou chemin est vide : sans eux l'écriture
 *   viserait un chemin indéterminé, ou enregistrerait un lien mort.
 */
function buildEmargementWrite(periode, ferme, meta) {
  const per = String(periode == null ? '' : periode).trim();
  if (!per) throw new Error('periode requise');
  const key = normalizeFermeKey(ferme);
  if (!key) throw new Error('ferme requise');
  const m = meta || {};
  const path = String(m.path == null ? '' : m.path).trim();
  if (!path) throw new Error('path requis');

  /** @type {Object} */
  const entry = {
    // Le LABEL d'origine est conservé à côté de la clé normalisée : l'écran
    // affiche « Avocatier », pas « AVOCATIER ».
    ferme: String(ferme).trim(),
    path: path,
    filename: sanitizeFilename(m.filename),
  };
  if (m.now !== undefined) entry.uploaded_at = m.now;
  if (m.actor !== undefined) entry.uploaded_by = m.actor;

  // merge sur le chemin `emargements.<FERME>` : le document est créé s'il
  // n'existe pas, les états des AUTRES fermes sont préservés, et surtout la map
  // `montants` (la paie) du même document n'est jamais touchée.
  const data = { periode: per, emargements: { [key]: entry } };

  return { data: data, options: { merge: true }, fermeKey: key };
}

module.exports = {
  EMARGEMENT_PREFIX,
  normalizeFermeKey,
  buildEmargementPath,
  isEmargementPath,
  buildEmargementWrite,
}
