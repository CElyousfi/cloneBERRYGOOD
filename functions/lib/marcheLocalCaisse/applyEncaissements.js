'use strict';
// @ts-check

/**
 * Planificateur PUR des écritures d'encaissements « Marché Local » (compte client).
 *
 * Aucune écriture Firestore ici : la fonction calcule, à partir de lignes
 * validées et d'un ensemble de clés déjà existantes, ce qui doit être créé,
 * ce qui est un doublon (ignoré) et ce qui est en erreur.
 *
 * L'idempotence repose sur la clé `${client_id}__${normRef}` où `normRef` est
 * la référence normalisée côté serveur (trim + minuscules + collapse espaces).
 * La référence est REQUISE, sans fallback : une référence vide -> erreur.
 *
 * @typedef {Object} LigneEncaissement
 * @property {string} client_id  Slug stable du client (compte_client_<client_id>).
 * @property {number} montant    Montant en DH (doit être > 0).
 * @property {string} [date]     Date ISO de l'encaissement.
 * @property {string} [mode]     Mode de règlement (espèces, chèque, virement...).
 * @property {string} reference  Référence (REQUISE).
 * @property {string} [motif]    Motif libre.
 *
 * @typedef {Object} PlannedWrite
 * @property {string} doc_id          `encaissement__${client_id}__${normRef}`.
 * @property {string} client_id
 * @property {number} montant
 * @property {string} date
 * @property {string} mode
 * @property {string} reference       Référence brute (telle que saisie).
 * @property {string} reference_norm  Référence normalisée.
 * @property {string} motif
 * @property {string} idempotency_key `${client_id}__${normRef}`.
 *
 * @typedef {Object} PlanError
 * @property {number} ligne   Index 1-based de la ligne en entrée.
 * @property {string} raison  Code de l'erreur.
 *
 * @typedef {Object} PlanResult
 * @property {PlannedWrite[]} toCreate     Écritures à créer.
 * @property {number} duplicates           Nombre de doublons ignorés.
 * @property {PlanError[]} errors          Lignes en erreur.
 */

/**
 * Normalise une référence côté serveur : trim + minuscules + collapse des
 * espaces internes (toute séquence d'espaces -> un seul espace).
 * @param {*} ref
 * @returns {string}
 */
function normalizeReference(ref) {
  if (ref == null) return '';
  return String(ref)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Construit la clé d'idempotence d'un encaissement.
 * @param {string} clientId
 * @param {string} normRef
 * @returns {string}
 */
function buildIdempotencyKey(clientId, normRef) {
  return `${clientId}__${normRef}`;
}

/**
 * Construit l'identifiant du document Firestore d'un encaissement.
 * @param {string} clientId
 * @param {string} normRef
 * @returns {string}
 */
function buildDocId(clientId, normRef) {
  return `encaissement__${clientId}__${normRef}`;
}

/**
 * Planifie les écritures d'encaissements (pur, sans I/O).
 *
 * @param {LigneEncaissement[]} lignes Lignes validées en entrée.
 * @param {Set<string>|Iterable<string>} existingKeys Clés d'idempotence déjà
 *   présentes en base (`${client_id}__${normRef}`).
 * @param {Object} [opts]
 * @param {Set<string>|Iterable<string>} [opts.activeClientIds] Set des client_id
 *   actifs (compte_client_<id> active). Si fourni, un client absent -> erreur.
 * @returns {PlanResult}
 */
function planEncaissementWrites(lignes, existingKeys, opts) {
  const existing = existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
  const activeSet = opts && opts.activeClientIds
    ? (opts.activeClientIds instanceof Set ? opts.activeClientIds : new Set(opts.activeClientIds))
    : null;

  /** @type {PlannedWrite[]} */
  const toCreate = [];
  /** @type {PlanError[]} */
  const errors = [];
  let duplicates = 0;

  // Clés vues dans CE lot (doublons intra-fichier après normalisation serveur).
  const seenInBatch = new Set();

  (lignes || []).forEach((ligne, idx) => {
    const numLigne = idx + 1;
    const clientId = ligne && ligne.client_id != null ? String(ligne.client_id).trim() : '';

    if (!clientId) {
      errors.push({ ligne: numLigne, raison: 'client_manquant' });
      return;
    }

    const normRef = normalizeReference(ligne && ligne.reference);
    if (normRef === '') {
      errors.push({ ligne: numLigne, raison: 'reference_manquante' });
      return;
    }

    const montant = Number(ligne && ligne.montant);
    if (!(montant > 0) || !Number.isFinite(montant)) {
      errors.push({ ligne: numLigne, raison: 'montant_invalide' });
      return;
    }

    if (activeSet && !activeSet.has(clientId)) {
      errors.push({ ligne: numLigne, raison: 'client_inconnu' });
      return;
    }

    const idempotency_key = buildIdempotencyKey(clientId, normRef);

    // Doublon déjà en base OU déjà planifié dans ce lot -> ignoré.
    if (existing.has(idempotency_key) || seenInBatch.has(idempotency_key)) {
      duplicates += 1;
      return;
    }
    seenInBatch.add(idempotency_key);

    toCreate.push({
      doc_id: buildDocId(clientId, normRef),
      client_id: clientId,
      montant,
      date: ligne && ligne.date != null ? String(ligne.date) : '',
      mode: ligne && ligne.mode != null ? String(ligne.mode) : '',
      reference: ligne && ligne.reference != null ? String(ligne.reference) : '',
      reference_norm: normRef,
      motif: ligne && ligne.motif != null ? String(ligne.motif) : '',
      idempotency_key,
    });
  });

  return { toCreate, duplicates, errors };
}

module.exports = {
  normalizeReference,
  buildIdempotencyKey,
  buildDocId,
  planEncaissementWrites,
};
