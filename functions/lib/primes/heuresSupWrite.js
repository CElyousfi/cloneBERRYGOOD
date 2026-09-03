'use strict';
// @ts-check

/**
 * heuresSupWrite.js — Forme PURE de l'écriture d'un montant d'heures sup.
 *
 * Le document `rh_heures_sup/<periode>` porte UNE map `montants` keyée par
 * matricule numérique, partagée par TOUS les ouvriers de la quinzaine. La
 * saisie, elle, est unitaire : un ouvrier à la fois. L'écriture doit donc
 * viser le CHEMIN du seul matricule saisi, jamais la map entière.
 *
 * PIÈGE HISTORIQUE (corrigé) : `set({ montants: {} }, { merge: true })` ne
 * préserve rien. Firestore dérive le masque de champs des FEUILLES de l'objet
 * fourni ; une map vide n'a aucune feuille, le masque porte donc `montants`
 * lui-même et la map est REMPLACÉE par une map vide. Le document ne gardait
 * plus que le dernier montant saisi. D'où l'invariant testé ici :
 * `data.montants` n'est JAMAIS un objet vide.
 *
 * Module PUR : aucune dépendance Firestore. Retourne la paire exacte passée
 * à `ref.set(data, options)`.
 */

const { normalizeMatricule } = require('./primesImport');

/**
 * @typedef {Object} HeuresSupWriteMeta
 * @property {*} [now]     Horodatage (serverTimestamp côté appelant).
 * @property {*} [actor]   Auteur de la saisie.
 */

/**
 * @typedef {Object} HeuresSupWrite
 * @property {Object} data       Payload à passer à ref.set().
 * @property {{merge: true}} options  Options du set : merge TOUJOURS actif.
 */

/**
 * Construit l'écriture mergée du montant d'heures sup d'UN ouvrier.
 *
 * @param {unknown} periode    Quinzaine (id du document).
 * @param {unknown} matricule  Matricule brut ou normalisé (ZZ11424 -> 11424).
 * @param {unknown} montant    Montant NET accordé, en DH. 0 est légitime
 *                             (remise à zéro), ce n'est pas un no-op.
 * @param {HeuresSupWriteMeta} [meta]
 * @returns {HeuresSupWrite}
 * @throws {Error} si la période ou le matricule normalisé est vide : sans eux
 *   l'écriture viserait un chemin indéterminé.
 */
function buildHeuresSupWrite(periode, matricule, montant, meta) {
  const per = String(periode == null ? '' : periode).trim();
  if (!per) throw new Error('periode requise');
  const mat = normalizeMatricule(matricule);
  if (!mat) throw new Error('matricule requis');
  const value = Number(montant) || 0;
  const m = meta || {};

  /** @type {Object} */
  const data = { periode: per, montants: { [mat]: value } };
  if (m.now !== undefined) data.updatedAt = m.now;
  if (m.actor !== undefined) data.updatedBy = m.actor;

  // merge sur le chemin `montants.<matricule>` : le document est créé s'il
  // n'existe pas, les montants des AUTRES ouvriers sont préservés, et deux
  // saisies concurrentes sur deux ouvriers différents ne s'écrasent pas.
  return { data: data, options: { merge: true } };
}

/**
 * Construit l'entrée d'AUDIT d'une saisie de montant, destinée à la
 * SOUS-COLLECTION `rh_heures_sup/<periode>/history/<autoId>`.
 *
 * Pourquoi une sous-collection et pas un tableau sur le document :
 *   - `updatedAt`/`updatedBy` sont GLOBAUX au document. Sur douze ouvriers
 *     saisis, seule la douzième saisie laisse une trace ; ramener un montant de
 *     800 à 0 n'en laisse aucune. Insuffisant sur de la paie.
 *   - concaténer un tableau imposerait de LIRE le document avant d'écrire.
 *     `save-heures-sup` est délibérément conçu pour ne pas le faire (cf. l'en-tête
 *     de ce module) : deux saisies simultanées se courseraient, et la seconde
 *     écraserait l'historique lu par la première. Un `add()` en sous-collection
 *     est indépendant, sans lecture, sans course.
 *
 * `previousMontant` n'y figure PAS : l'ancienne valeur ne s'obtient que par un
 * `get()` du document — exactement la lecture que l'écriture principale évite.
 * L'audit ne doit pas dégrader l'écriture qu'il observe ; la valeur précédente
 * se reconstitue en lisant l'entrée d'historique antérieure du même matricule.
 *
 * @param {unknown} periode
 * @param {unknown} matricule
 * @param {unknown} montant
 * @param {HeuresSupWriteMeta} [meta] `now` = horodatage, `actor` = auteur
 *   résolu SERVEUR (jamais depuis le body de la requête).
 * @returns {Object} le document à passer à `collection('history').add(...)`.
 * @throws {Error} si la période ou le matricule normalisé est vide.
 */
function buildHeuresSupHistoryEntry(periode, matricule, montant, meta) {
  const per = String(periode == null ? '' : periode).trim();
  if (!per) throw new Error('periode requise');
  const mat = normalizeMatricule(matricule);
  if (!mat) throw new Error('matricule requis');
  const m = meta || {};

  /** @type {Object} */
  const entry = { periode: per, matricule: mat, montant: Number(montant) || 0 };
  if (m.actor !== undefined) entry.changedBy = m.actor;
  if (m.now !== undefined) entry.changedAt = m.now;
  return entry;
}

module.exports = { buildHeuresSupWrite, buildHeuresSupHistoryEntry }
