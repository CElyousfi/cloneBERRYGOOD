'use strict';
// @ts-check

/**
 * recordSubmission.js — Écriture Firestore PARTAGÉE pour la soumission
 * quotidienne des fichiers stock (Berry Good / Bahia).
 *
 * Source de vérité UNIQUE pour l'upsert Firestore — utilisée par les 2
 * canaux de soumission (onglet magasinier ET bot WhatsApp `magasinierBot.js`)
 * pour qu'aucune divergence ne soit possible entre ce que voit le tableau
 * historique selon le canal utilisé. Voir
 * docs/spec-collecte-stock-magasinier.md §3 (modèle de données) et §4.2.
 *
 * Doc Firestore : `stock_file_submissions/{YYYY-MM-DD}` (1 doc/jour).
 *
 * Module PUR + DI (pas d'accès direct à `firebase-admin`) : le caller
 * injecte `db` (Firestore) et une factory `serverTimestamp()` — permet un
 * test `node:test` avec un faux Firestore, sans emulator.
 */

/** Collection Firestore des soumissions quotidiennes de fichiers stock. */
const COLLECTION = 'stock_file_submissions';

/** Fermes valides pour la soumission (clés snake_case ASCII, cf. CLAUDE.md). */
const VALID_FARMS = ['berry_good', 'bahia'];

/** Libellés d'affichage des fermes (messages WhatsApp, UI). */
const FARM_LABELS = { berry_good: 'Berry Good', bahia: 'Bahia' };

const { isoDateInTz } = require('../dates/isoDateInTz');

const CASABLANCA_TZ = 'Africa/Casablanca';

/**
 * @param {string} farm
 * @returns {boolean}
 */
function isValidFarm(farm) {
  return VALID_FARMS.indexOf(farm) >= 0;
}

/**
 * Date locale Africa/Casablanca (YYYY-MM-DD) pour un instant donné. Toujours
 * calculée CÔTÉ SERVEUR — jamais depuis l'horloge/le body client (cf.
 * CLAUDE.md, mémoire `gate-fresh-go-each-write` et consorts sur la confiance
 * serveur uniquement).
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD
 */
function todayInCasablanca(now) {
  return isoDateInTz(now || new Date(), CASABLANCA_TZ);
}

/**
 * Ajoute (ou retranche) des jours à une date YYYY-MM-DD (arithmétique en
 * UTC), renvoie YYYY-MM-DD. Utilisé pour construire l'historique N derniers
 * jours (§4.1 GET stock-file-history).
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} days
 * @returns {string} YYYY-MM-DD
 */
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * État vide (non soumis) pour une ferme.
 * @returns {{submitted: boolean, submitted_at: null, submitted_by: null, file_path: null, file_name: null}}
 */
function emptyFarmState() {
  return { submitted: false, submitted_at: null, submitted_by: null, file_path: null, file_name: null };
}

/**
 * Squelette d'un doc `stock_file_submissions` vide pour une date donnée
 * (jour sans aucune soumission — ne DOIT PAS être exclu du tableau
 * historique, cf. spec §4.1 : "Jours sans document = submitted: false pour
 * les deux fermes").
 * @param {string} date YYYY-MM-DD
 */
function emptySubmissionDoc(date) {
  return {
    date,
    berry_good: emptyFarmState(),
    bahia: emptyFarmState(),
    reminders_sent: { '16h': false, '17h': false, '18h': false },
    missing_alert_sent_at: null,
  };
}

/**
 * Upsert de la soumission d'un fichier stock pour une ferme, un jour donné.
 * Fonction PARTAGÉE par les 2 canaux (app + WhatsApp) — jamais dupliquée
 * (spec §4.2). Ne touche QUE la clé de la ferme soumise — `merge: true` +
 * objet imbriqué laisse l'autre ferme intacte (deep-merge Firestore des
 * champs map imbriqués).
 *
 * @param {{db: Object, serverTimestamp?: () => any}} deps
 *   - db : Firestore (admin ou compat), doit exposer `.collection(name).doc(id).get()/.set()`.
 *   - serverTimestamp : factory du timestamp à écrire (défaut : `Date.now()`,
 *     l'appelant réel injecte `() => admin.firestore.FieldValue.serverTimestamp()`).
 * @param {{date: string, farm: string, storagePath: string, filename?: string, submittedBy?: {uid?: string, name?: string, email?: string, source?: string}}} params
 * @returns {Promise<{success: boolean, submitted_at?: any, error?: string}>}
 */
async function recordSubmission(deps, params) {
  const db = deps && deps.db;
  const serverTimestamp = (deps && deps.serverTimestamp) || (() => Date.now());
  if (!db) throw new Error('recordSubmission: db requis');

  const p = params || {};
  const { date, farm, storagePath, filename, submittedBy } = p;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { success: false, error: 'date invalide (YYYY-MM-DD requis)' };
  }
  if (!isValidFarm(farm)) {
    return { success: false, error: 'farm invalide (attendu: berry_good|bahia)' };
  }
  if (!storagePath) {
    return { success: false, error: 'storagePath requis' };
  }

  const docRef = db.collection(COLLECTION).doc(date);
  const snap = await docRef.get();
  const isNew = !snap.exists;
  const now = serverTimestamp();

  const sb = submittedBy || {};
  /** @type {Record<string, any>} */
  const payload = {
    [farm]: {
      submitted: true,
      submitted_at: now,
      submitted_by: {
        uid: sb.uid || null,
        name: sb.name || null,
        email: sb.email || null,
        source: sb.source === 'whatsapp' ? 'whatsapp' : 'app',
      },
      file_path: storagePath,
      file_name: filename || null,
    },
    updated_at: now,
  };
  if (isNew) payload.created_at = now;

  await docRef.set(payload, { merge: true });

  return { success: true, submitted_at: now };
}

module.exports = {
  COLLECTION,
  VALID_FARMS,
  FARM_LABELS,
  isValidFarm,
  todayInCasablanca,
  addDaysStr,
  emptyFarmState,
  emptySubmissionDoc,
  recordSubmission,
};
