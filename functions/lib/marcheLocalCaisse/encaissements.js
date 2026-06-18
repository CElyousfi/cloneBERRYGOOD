'use strict';
// @ts-check

/**
 * Connecteur d'import du CANEVAS « ENCAISSEMENTS » du compte client Marché Local
 * (FRAMBOISE uniquement). Module PUR : aucune écriture Firestore, aucune I/O.
 *
 * GARDE-FOU : ce connecteur ne produit QUE des enregistrements `type:'encaissement'`.
 * Il ne dérive, ne lit, ni ne touche JAMAIS les ventes/recettes (cf. index.js qui,
 * lui, dérive les recettes). Les deux flux sont strictement disjoints :
 *   - index.js      : ventes -> recettes (débit du compte client)
 *   - encaissements : canevas -> encaissements (crédit du compte client)
 *
 * Le slug client est emprunté à la SOURCE UNIQUE (étape 1) : ../index.js.
 *
 * @typedef {Object} SchemaColumn
 * @property {string} key       Clé interne (ASCII snake-ish) de la colonne.
 * @property {string} header    En-tête affiché dans le canevas (FR).
 * @property {('enum'|'date'|'number'|'text')} type Type logique de la colonne.
 * @property {boolean} [required]
 * @property {number} [min]
 * @property {string} [locale]
 * @property {string[]} [options] Options figées (mode). Pour `client`, injectées.
 *
 * @typedef {Object} EncaissementsSchema
 * @property {string} id
 * @property {string} sheet
 * @property {SchemaColumn[]} columns
 * @property {string[]} idempotency
 *
 * @typedef {Object} ClientRef
 * @property {string} client_id Slug stable (ex: 'hamdouch_omar').
 * @property {string} nom       Nom canonique affiché.
 *
 * @typedef {Object} Encaissement
 * @property {'encaissement'} type
 * @property {'canevas'} source
 * @property {string} caisse_id        'compte_client_' + client_id.
 * @property {string} client_id
 * @property {number} montant          Arrondi 2 décimales.
 * @property {string} date             'YYYY-MM-DD'.
 * @property {string} mode
 * @property {string} reference
 * @property {string} motif
 * @property {string} idempotency_key
 * @property {number} version
 *
 * @typedef {Object} Rejet
 * @property {Object} row
 * @property {string} raison
 *
 * @typedef {Object} ParseResult
 * @property {Encaissement[]} encaissements
 * @property {Rejet[]} rejected
 * @property {{lus:number, retenus:number, rejetes:number, doublons_intra_fichier:number}} stats
 */

const { slugifyClient, round2 } = require('./index.js');

/**
 * SCHÉMA DÉCLARATIF — SOURCE UNIQUE.
 * Sert à la fois au parseur (validation / mapping) et au générateur de modèle vierge.
 * Modifier ce schéma change AUTOMATIQUEMENT le modèle ET le parseur.
 * @type {EncaissementsSchema}
 */
const ENCAISSEMENTS_SCHEMA = {
  id: 'encaissements_marche_local',
  sheet: 'ENCAISSEMENTS',
  columns: [
    { key: 'client', header: 'Client', type: 'enum', required: true }, // options injectées (noms des 5)
    { key: 'date', header: 'Date encaissement', type: 'date', required: true },
    { key: 'montant', header: 'Montant (DH)', type: 'number', required: true, min: 0, locale: 'fr-MA' },
    { key: 'mode', header: 'Mode', type: 'enum', options: ['Espèces', 'Chèque', 'Virement'] },
    { key: 'reference', header: 'Référence', type: 'text' },
    { key: 'motif', header: 'Motif', type: 'text' },
  ],
  idempotency: ['client', 'reference'],
};

/**
 * Parse un nombre au format Marché-marocain ou natif Excel.
 * Accepte : Number natif, '27 445,00', '1.234,56', '300000', '1 234.56'.
 * Règle FR : la virgule est le séparateur décimal ; espaces (y compris insécables)
 * et points sont des séparateurs de milliers SAUF si le point est l'unique séparateur
 * décimal (cas anglo) — on privilégie la virgule décimale quand elle est présente.
 * @param {*} v
 * @returns {number|null} Number, ou null si non interprétable (NaN).
 */
function parseFrNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  let s = String(v).trim();
  if (s === '') return null;

  // Retirer les espaces (normaux + insécables/fine) = séparateurs de milliers.
  s = s.replace(/[\s  ]/g, '');

  const hasComma = s.indexOf(',') !== -1;
  const hasDot = s.indexOf('.') !== -1;

  if (hasComma && hasDot) {
    // Format FR avec milliers : '1.234,56' -> point = milliers, virgule = décimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Virgule seule = séparateur décimal : '27445,00' -> '27445.00'.
    s = s.replace(',', '.');
  }
  // hasDot seul : on garde le point comme décimal (cas anglo / Excel string).

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convertit une date (série Excel / 'JJ/MM/AAAA' / ISO) en 'YYYY-MM-DD'.
 * @param {*} v
 * @returns {string|null} 'YYYY-MM-DD' ou null si invalide.
 */
function parseDate(v) {
  if (v == null || v === '') return null;

  // Série Excel (jours depuis 1899-12-30). On accepte Number ou string numérique.
  if (typeof v === 'number' && Number.isFinite(v)) {
    return excelSerialToISO(v);
  }

  const s = String(v).trim();
  if (s === '') return null;

  // String purement numérique = série Excel.
  if (/^\d+(\.\d+)?$/.test(s)) {
    return excelSerialToISO(Number(s));
  }

  // JJ/MM/AAAA (ou JJ-MM-AAAA).
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    return buildISO(y, mo, d);
  }

  // ISO 'YYYY-MM-DD' (éventuellement avec heure).
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return buildISO(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  return null;
}

/**
 * @param {number} serial
 * @returns {string|null}
 */
function excelSerialToISO(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  // Excel epoch : 1899-12-30 (corrige le bug du 1900 bissextile).
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial) * 86400000;
  const d = new Date(ms);
  return buildISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * @param {number} y
 * @param {number} mo
 * @param {number} d
 * @returns {string|null}
 */
function buildISO(y, mo, d) {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n) => String(n).padStart(2, '0');
  // Vérifie la cohérence (ex: 31/02 -> rejet).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * Lit une valeur de cellule par header nommé (objet de ligne).
 * @param {Object} row
 * @param {string} header
 * @returns {*}
 */
function cell(row, header) {
  if (!row || typeof row !== 'object') return undefined;
  return row[header];
}

/**
 * Parse les lignes brutes du canevas en encaissements normalisés.
 *
 * FORMAT D'ENTRÉE (documenté) : `rows` = tableau d'OBJETS indexés par header nommé,
 * tels que produits par `XLSX.utils.sheet_to_json(ws)` (défaut, header par nom).
 * Ex : { 'Client': 'Hamdouch Omar', 'Date encaissement': '15/06/2026',
 *        'Montant (DH)': '27 445,00', 'Mode': 'Espèces', 'Référence': 'CHQ-12',
 *        'Motif': 'acompte' }
 * Choix : objets par header (pas header:1) — robuste au réordonnancement des colonnes
 * et aligné sur le schéma déclaratif (clé = column.header).
 *
 * @param {Object[]} rows
 * @param {{clients: ClientRef[]}} deps Liste des clients autorisés (DI, jamais en dur).
 * @returns {ParseResult}
 */
function parseEncaissements(rows, deps) {
  const clients = (deps && deps.clients) || [];
  /** @type {Map<string, ClientRef>} */
  const byId = new Map();
  for (const c of clients) {
    if (c && c.client_id) byId.set(c.client_id, c);
  }

  const colByKey = {};
  for (const col of ENCAISSEMENTS_SCHEMA.columns) colByKey[col.key] = col.header;

  /** @type {Encaissement[]} */
  const encaissements = [];
  /** @type {Rejet[]} */
  const rejected = [];
  /** @type {Map<string, true>} */
  const seenKeys = new Map();
  let doublons = 0;
  let lus = 0;

  for (const row of rows || []) {
    lus += 1;

    const clientRaw = cell(row, colByKey.client);
    const clientStr = clientRaw == null ? '' : String(clientRaw).trim();

    // R1 — client absent.
    if (clientStr === '') {
      rejected.push({ row, raison: 'client_absent' });
      continue;
    }

    const client_id = slugifyClient(clientStr);
    // R1 — client inconnu (hors des 5 injectés).
    if (!byId.has(client_id)) {
      rejected.push({ row, raison: 'client_inconnu' });
      continue;
    }

    // Montant.
    const montant = parseFrNumber(cell(row, colByKey.montant));
    if (montant == null) {
      rejected.push({ row, raison: 'montant_invalide' });
      continue;
    }
    if (!(montant > 0)) {
      rejected.push({ row, raison: 'montant_non_positif' });
      continue;
    }

    // Date.
    const date = parseDate(cell(row, colByKey.date));
    if (!date) {
      rejected.push({ row, raison: 'date_invalide' });
      continue;
    }

    const modeRaw = cell(row, colByKey.mode);
    const mode = modeRaw == null ? '' : String(modeRaw).trim();
    const refRaw = cell(row, colByKey.reference);
    const reference = refRaw == null ? '' : String(refRaw).trim();
    const motifRaw = cell(row, colByKey.motif);
    const motif = motifRaw == null ? '' : String(motifRaw).trim();

    const montant2 = round2(montant);
    const idempotency_key = reference !== ''
      ? `${client_id}__${reference}`
      : `${client_id}__${date}__${Math.round(montant2 * 100)}`;

    // Doublon intra-fichier : garder la 1ère, signaler.
    if (seenKeys.has(idempotency_key)) {
      doublons += 1;
      rejected.push({ row, raison: 'doublon_intra_fichier' });
      continue;
    }
    seenKeys.set(idempotency_key, true);

    encaissements.push({
      type: 'encaissement',
      source: 'canevas',
      caisse_id: 'compte_client_' + client_id,
      client_id,
      montant: montant2,
      date,
      mode,
      reference,
      motif,
      idempotency_key,
      version: 1,
    });
  }

  return {
    encaissements,
    rejected,
    stats: {
      lus,
      retenus: encaissements.length,
      rejetes: rejected.length,
      doublons_intra_fichier: doublons,
    },
  };
}

module.exports = {
  ENCAISSEMENTS_SCHEMA,
  parseFrNumber,
  parseDate,
  parseEncaissements,
};
