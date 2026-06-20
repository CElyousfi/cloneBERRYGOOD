/**
 * encaissementsCanevas.js — SOURCE UNIQUE (front + tests) du connecteur d'import
 * du CANEVAS « ENCAISSEMENTS » du compte client Marché Local (FRAMBOISE uniquement).
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/encaissementsCanevas.js"> → exposes window.EncaissementsCanevas
 *   - In node:test via require('./encaissementsCanevas.js') → exposes module.exports
 *
 * Toutes les fonctions sont PURES : aucun DOM, aucun réseau, aucune écriture Firestore.
 *
 * GARDE-FOU : ce connecteur ne produit QUE des enregistrements `type:'encaissement'`
 * (crédit du compte client). Il ne dérive, ne lit, ni ne touche JAMAIS les
 * ventes/recettes — les deux flux sont strictement disjoints.
 *
 * Sous-lot 4.2 (2026-06) — porté/adapté de functions/lib/marcheLocalCaisse/
 * encaissements.js + modeleVierge.js, qui devient supersédé au 4.3 (NE PAS y toucher).
 *
 * @typedef {Object} SchemaColumn
 * @property {string} key
 * @property {string} header
 * @property {('enum'|'date'|'number'|'text')} type
 * @property {boolean} [required]
 * @property {number} [min]
 * @property {string} [locale]
 * @property {string[]} [options]
 *
 * @typedef {Object} EncaissementsSchema
 * @property {string} id
 * @property {string} sheet
 * @property {SchemaColumn[]} columns
 * @property {string[]} idempotency
 *
 * @typedef {Object} ClientRef
 * @property {string} client_id
 * @property {string} nom
 *
 * @typedef {Object} Encaissement
 * @property {'encaissement'} type
 * @property {'canevas'} source
 * @property {string} caisse_id
 * @property {string} client_id
 * @property {number} montant
 * @property {string} date
 * @property {string} mode
 * @property {string} reference
 * @property {string} reference_norm
 * @property {string} motif
 * @property {string} idempotency_key
 * @property {number} version
 */
// @ts-check
'use strict';

// IIFE d'isolation : tout le corps du module vit dans cette fonction pour
// qu'AUCUN identifiant top-level (round2, parseDate, slugifyClient, __api, …)
// ne fuie dans le scope lexical global partagé par les <script> classiques.
// Sans ça, `const __api` entre en collision avec caisseUtils.js → erreur
// "Identifier '__api' has already been declared" au boot → React #200
// (cf. incident commit 1754a64). Les exports passent par window/module en fin d'IIFE.
(function () {
// ============================================================================
// HELPERS — nombres / dates / slug / référence
// ============================================================================

/**
 * Arrondit un montant à 2 décimales (centimes), en évitant les dérives float.
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Transforme un nom de client en identifiant stable.
 * minuscules -> accents retirés (NFD) -> non-alphanum en '_' -> trim des '_'.
 * Identique à l'étape 1 (functions/lib/marcheLocalCaisse/index.js).
 * @param {string} nom
 * @returns {string}
 */
function slugifyClient(nom) {
  if (nom == null) return '';
  return String(nom)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Forme canonique d'une référence pour la CLÉ (la référence brute reste affichée).
 * trim + minuscules + collapse des espaces internes (\s+ → un espace).
 * @param {*} ref
 * @returns {string}
 */
function normalizeReference(ref) {
  if (ref == null) return '';
  return String(ref).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parse un nombre au format Marché-marocain ou natif Excel.
 * Accepte : Number natif, '27 445,00', '1.234,56', '300000', '1 234.56'.
 * @param {*} v
 * @returns {number|null}
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
 * @returns {string|null}
 */
function parseDate(v) {
  if (v == null || v === '') return null;

  // Série Excel (jours depuis 1899-12-30).
  if (typeof v === 'number' && Number.isFinite(v)) {
    return excelSerialToISO(v);
  }

  const s = String(v).trim();
  if (s === '') return null;

  // String purement numérique = série Excel.
  if (/^\d+(\.\d+)?$/.test(s)) {
    return excelSerialToISO(Number(s));
  }

  // JJ/MM/AAAA (ou JJ-MM-AAAA, JJ.MM.AAAA).
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    return buildISO(Number(m[3]), Number(m[2]), Number(m[1]));
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

// ============================================================================
// SCHÉMA DÉCLARATIF — SOURCE UNIQUE (parseur + modèle vierge)
// ============================================================================

/** @type {EncaissementsSchema} */
const ENCAISSEMENTS_SCHEMA = {
  id: 'encaissements_marche_local',
  sheet: 'ENCAISSEMENTS',
  columns: [
    { key: 'client', header: 'Client', type: 'enum', required: true }, // options injectées (noms des clients actifs)
    { key: 'date', header: 'Date encaissement', type: 'date', required: true },
    { key: 'montant', header: 'Montant (DH)', type: 'number', required: true, min: 0, locale: 'fr-MA' },
    { key: 'mode', header: 'Mode', type: 'enum', options: ['Espèces', 'Chèque', 'Virement'] },
    { key: 'reference', header: 'Référence', type: 'text', required: true }, // REQUISE (clé d'idempotence)
    { key: 'motif', header: 'Motif', type: 'text' },
  ],
  idempotency: ['client', 'reference'],
};

/**
 * Normalise un en-tête pour un matching tolérant : retire le/les '*' final(aux),
 * collapse les espaces, trim, minuscules. Permet de lire indifféremment
 * « Client » (schéma) ou « Client * » (modèle téléchargé), ainsi que les
 * variantes de casse/espaces saisies par l'utilisateur.
 * @param {*} h
 * @returns {string}
 */
function normHeader(h) {
  return String(h == null ? '' : h)
    .replace(/\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Lit une valeur de cellule par header nommé (objet de ligne).
 * Chemin rapide exact, puis fallback tolérant via normHeader (ignore le
 * suffixe '*' du modèle, la casse et les espaces).
 * @param {Object} row
 * @param {string} header
 * @returns {*}
 */
function cell(row, header) {
  if (!row || typeof row !== 'object') return undefined;
  if (header in row) return row[header]; // chemin rapide exact
  const target = normHeader(header);
  for (const k of Object.keys(row)) {
    if (normHeader(k) === target) return row[k];
  }
  return undefined;
}

// ============================================================================
// PARSEUR
// ============================================================================

/**
 * Parse les lignes brutes du canevas en encaissements normalisés (DRY-RUN).
 *
 * FORMAT D'ENTRÉE : `rows` = tableau d'OBJETS indexés par header nommé, tels que
 * produits par `XLSX.utils.sheet_to_json(ws)` (défaut, header par nom).
 *
 * GARDE-FOU : ne produit QUE type='encaissement'. Aucune notion de vente.
 *
 * @param {Object[]} rows
 * @param {{activeClients: ClientRef[], archivedNames?: Set<string>|string[]}} deps
 *   activeClients = clients ACTIFS [{client_id, nom}].
 *   archivedNames = Set (ou tableau) des NOMS de clients ARCHIVÉS.
 * @returns {{ok:Encaissement[], rejets:Array<{ligne:number, raison:string, donnees:Object, brut:Object}>, doublons:Array<{ligne:number, raison:string, donnees:Object, brut:Object}>, stats:{lus:number, ok:number, rejetes:number, doublons:number}}}
 */
function parseEncaissements(rows, deps) {
  const activeClients = (deps && deps.activeClients) || [];
  // Set des slugs archivés (dérivés des noms) pour distinguer archive vs inconnu.
  const archivedRaw = (deps && deps.archivedNames) || [];
  const archivedSlugs = new Set();
  const archivedIter = archivedRaw instanceof Set ? Array.from(archivedRaw) : archivedRaw;
  for (const nom of archivedIter) {
    if (nom) archivedSlugs.add(slugifyClient(nom));
  }

  /** @type {Map<string, ClientRef>} */
  const byId = new Map();
  for (const c of activeClients) {
    if (c && c.client_id) byId.set(c.client_id, c);
  }

  const colByKey = {};
  for (const col of ENCAISSEMENTS_SCHEMA.columns) colByKey[col.key] = col.header;

  /** @type {Encaissement[]} */
  const ok = [];
  /** @type {Array<{ligne:number, raison:string, donnees:Object, brut:Object}>} */
  const rejets = [];
  /** @type {Array<{ligne:number, raison:string, donnees:Object, brut:Object}>} */
  const doublons = [];
  /** @type {Set<string>} */
  const seenKeys = new Set();
  let lus = 0;

  // Convertit une valeur de cellule brute en chaîne d'affichage (non normalisée).
  // null/undefined -> '' ; tout le reste -> String(...) tel quel.
  const brutStr = (v) => (v == null ? '' : String(v));

  const list = rows || [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    lus += 1;
    const ligne = i + 2; // +1 pour l'en-tête, +1 pour passer en index 1-based humain.

    // Valeurs BRUTES lues AVANT toute validation/normalisation (pour affichage UI
    // des lignes rejetées/doublons : le Resp. Achats doit pouvoir identifier la
    // ligne à corriger dans son fichier source).
    const clientRaw = cell(row, colByKey.client);
    const refRawForBrut = cell(row, colByKey.reference);
    const montantRawForBrut = cell(row, colByKey.montant);
    const dateRawForBrut = cell(row, colByKey.date);
    const modeRawForBrut = cell(row, colByKey.mode);
    const motifRawForBrut = cell(row, colByKey.motif);
    const brut = {
      client: brutStr(clientRaw),
      date: brutStr(dateRawForBrut),
      montant: brutStr(montantRawForBrut),
      reference: brutStr(refRawForBrut),
      mode: brutStr(modeRawForBrut),
      motif: brutStr(motifRawForBrut),
    };

    const clientStr = clientRaw == null ? '' : String(clientRaw).trim();

    // R — client absent.
    if (clientStr === '') {
      rejets.push({ ligne, raison: 'client_absent', donnees: row, brut });
      continue;
    }

    const client_id = slugifyClient(clientStr);
    if (!byId.has(client_id)) {
      // R — client archivé (DISTINCT de inconnu).
      if (archivedSlugs.has(client_id)) {
        rejets.push({ ligne, raison: 'client_archive', donnees: row, brut });
        continue;
      }
      // R — client inconnu (ni actif ni archivé).
      rejets.push({ ligne, raison: 'client_inconnu', donnees: row, brut });
      continue;
    }

    // R — référence REQUISE.
    const refRaw = cell(row, colByKey.reference);
    const reference = refRaw == null ? '' : String(refRaw).trim();
    if (reference === '') {
      rejets.push({ ligne, raison: 'reference_absente', donnees: row, brut });
      continue;
    }

    // R — montant.
    const montant = parseFrNumber(cell(row, colByKey.montant));
    if (montant == null) {
      rejets.push({ ligne, raison: 'montant_invalide', donnees: row, brut });
      continue;
    }
    if (!(montant > 0)) {
      rejets.push({ ligne, raison: 'montant_non_positif', donnees: row, brut });
      continue;
    }

    // R — date.
    const date = parseDate(cell(row, colByKey.date));
    if (!date) {
      rejets.push({ ligne, raison: 'date_invalide', donnees: row, brut });
      continue;
    }

    const modeRaw = cell(row, colByKey.mode);
    const mode = modeRaw == null ? '' : String(modeRaw).trim();
    const motifRaw = cell(row, colByKey.motif);
    const motif = motifRaw == null ? '' : String(motifRaw).trim();

    const reference_norm = normalizeReference(reference);
    const montant2 = round2(montant);
    // Référence REQUISE → PAS de fallback dans la clé.
    const idempotency_key = `${client_id}__${reference_norm}`;

    // R — doublon intra-fichier : garder la 1ère, signaler les suivantes.
    if (seenKeys.has(idempotency_key)) {
      doublons.push({ ligne, raison: 'doublon_intra_fichier', donnees: row, brut });
      continue;
    }
    seenKeys.add(idempotency_key);

    ok.push({
      type: 'encaissement',
      source: 'canevas',
      caisse_id: 'compte_client_' + client_id,
      client_id,
      montant: montant2,
      date,
      mode,
      reference,
      reference_norm,
      motif,
      idempotency_key,
      version: 1,
    });
  }

  return {
    ok,
    rejets,
    doublons,
    stats: {
      lus,
      ok: ok.length,
      rejetes: rejets.length,
      doublons: doublons.length,
    },
  };
}

// ============================================================================
// MODÈLE VIERGE — dérive du schéma déclaratif
// ============================================================================

/**
 * Construit la structure AOA (array of arrays) du modèle :
 *   - ligne 1 : en-têtes (Référence marquée * obligatoire).
 *   - ligne 2 : exemple réaliste.
 * @param {EncaissementsSchema} schema
 * @param {{clients: ClientRef[]}} deps
 * @returns {Array<Array<string>>}
 */
function buildModeleAoA(schema, deps) {
  const clients = (deps && deps.clients) || [];
  const headers = schema.columns.map((c) => c.header);

  const firstClientNom = clients.length ? clients[0].nom : 'Nom du client';

  const example = schema.columns.map((col) => {
    switch (col.key) {
      case 'client':
        return firstClientNom;
      case 'date':
        return '15/06/2026';
      case 'montant':
        return '27 445,00';
      case 'mode':
        return (col.options && col.options[0]) || 'Espèces';
      case 'reference':
        return 'CHQ-000123';
      case 'motif':
        return 'Acompte sur livraisons framboise';
      default:
        return '';
    }
  });

  return [headers, example];
}

/**
 * Construit un workbook XLSX (en mémoire) du modèle vierge.
 *
 * LIMITE CONNUE (SheetJS community) : l'écriture de validations de données
 * (listes déroulantes via `!dataValidation`) n'est PAS supportée. Le modèle inclut
 * donc : feuille ENCAISSEMENTS (en-têtes, Référence marquée * obligatoire, 1 ligne
 * exemple, largeurs de colonnes) + feuille AIDE (clients actifs + modes autorisés).
 *
 * Requiert `XLSX` accessible (global navigateur ou require('xlsx') côté node).
 *
 * @param {EncaissementsSchema} schema
 * @param {{clients: ClientRef[], XLSX?: Object}} deps
 * @returns {Object} workbook XLSX
 */
function buildModeleWorkbook(schema, deps) {
  const clients = (deps && deps.clients) || [];
  const X = (deps && deps.XLSX)
    || (typeof XLSX !== 'undefined' ? XLSX : null)
    || (typeof window !== 'undefined' ? window.XLSX : null);
  if (!X) throw new Error('XLSX indisponible : passez deps.XLSX ou chargez la lib.');

  // Feuille ENCAISSEMENTS — en-têtes avec '*' sur les colonnes requises.
  const headers = schema.columns.map((c) => (c.required ? c.header + ' *' : c.header));
  const aoa = buildModeleAoA(schema, deps);
  aoa[0] = headers; // remplace les en-têtes bruts par les en-têtes annotés '*'.

  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = schema.columns.map((col) => {
    const headerLen = col.header.length + (col.required ? 2 : 0);
    return { wch: Math.max(14, Math.min(40, headerLen + 6)) };
  });

  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, schema.sheet);

  // Feuille AIDE — clients actifs + modes autorisés (les dropdowns n'étant pas
  // sérialisés par SheetJS, on documente les valeurs valides dans cette feuille).
  const modeCol = schema.columns.find((c) => c.key === 'mode');
  const modeOptions = (modeCol && modeCol.options) || [];
  const aideAoa = [
    ['AIDE — valeurs autorisées'],
    [],
    ['Clients (actifs)', 'Modes'],
  ];
  const maxLen = Math.max(clients.length, modeOptions.length);
  for (let i = 0; i < maxLen; i++) {
    aideAoa.push([
      clients[i] ? clients[i].nom : '',
      modeOptions[i] || '',
    ]);
  }
  const wsAide = X.utils.aoa_to_sheet(aideAoa);
  wsAide['!cols'] = [{ wch: 32 }, { wch: 16 }];
  X.utils.book_append_sheet(wb, wsAide, 'AIDE');

  // Métadonnées exploitables côté front.
  wb.MarcheLocal = {
    schemaId: schema.id,
    sheet: schema.sheet,
    headers: schema.columns.map((c) => c.header),
    validations: {
      client: clients.map((c) => c.nom),
      mode: modeOptions,
    },
  };

  return wb;
}

// ============================================================================
// UMD-style export (browser global + CommonJS for node:test)
// ============================================================================

const __api = {
  ENCAISSEMENTS_SCHEMA,
  round2,
  slugifyClient,
  normalizeReference,
  parseFrNumber,
  parseDate,
  parseEncaissements,
  buildModeleAoA,
  buildModeleWorkbook,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __api;
if (typeof window !== 'undefined') window.EncaissementsCanevas = __api;

})();
