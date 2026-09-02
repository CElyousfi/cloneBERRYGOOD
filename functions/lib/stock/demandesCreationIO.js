'use strict';

// @ts-check

/**
 * demandesCreationIO.js — Écriture des demandes de création d'article et
 * signalement au DG. Dépendances INJECTÉES (patron `lib/irrigation/`).
 *
 * ── POURQUOI CE MODULE EXISTE ─────────────────────────────────────────────
 * Cette fonction vivait dans `functions/index.js`, donc hors de portée d'un
 * test de comportement : elle n'était gardée que par des assertions de SOURCE.
 * Deux mutants l'ont prouvé insuffisante :
 *
 *   R2 — un `throw` avant les notifications ;
 *   R3 — `if (ecarts.length)` devenu `if (ecarts.length && enregistres.length)`.
 *
 * R3 rendait **0 dispatch** sur un article ambigu, laissait le motif affirmer
 * « Le DG a été alerté », et les 35 tests de câblage restaient VERTS. C'était
 * le bloquant d'origine reproduit à l'identique. Un test de source vérifie la
 * forme du code ; seul un test d'exécution vérifie ce qu'il fait.
 *
 * ── L'INVARIANT ───────────────────────────────────────────────────────────
 * Aucune résolution fautive ne traverse cette fonction sans qu'un signal
 * parte : une DEMANDE si l'article est à créer, une ALERTE s'il est en double
 * ou si la ligne n'a pas d'article. Le signal d'écart ne dépend JAMAIS du
 * succès des demandes — ce couplage est exactement le défaut R3.
 *
 * ── ET RIEN D'ICI NE PEUT FAIRE ÉCHOUER UNE RÉCEPTION ─────────────────────
 * L'écriture d'une demande est ACCESSOIRE ; la réception est l'acte
 * principal. Cette fonction est appelée AVANT l'écriture du bon de livraison :
 * une exception ici remonterait au `catch` de `stockManagement`, rendrait 500,
 * et le BL ne serait jamais écrit. Une panne d'écriture accessoire ferait donc
 * perdre une réception RÉELLE — l'inverse exact du contrat « la réception ne
 * bloque jamais ». Chaque effet de bord est donc isolé.
 */

const demandeCreationArticle = require('./demandeCreationArticle');

/**
 * @typedef {Object} DemandesIO
 * @property {*} db Firestore.
 * @property {Function} dispatchNotification
 * @property {Function} increment `admin.firestore.FieldValue.increment`
 * @property {Function} serverTimestamp `admin.firestore.FieldValue.serverTimestamp`
 * @property {Function} [logError] journalisation (injectée pour les tests)
 * @property {Function} [maintenant] horloge injectable
 */

/**
 * Enregistre les demandes de création et émet les signaux au DG.
 *
 * @param {DemandesIO} io
 * @param {Array<Object>} resolutions résolutions fautives
 * @param {*} demandePar {uid, profileId, name}
 * @param {*} contexte {origine, type, numero}
 * @returns {Promise<string[]>} libellés dont la demande a été RÉELLEMENT
 *   écrite — jamais ceux qu'on a seulement tenté d'écrire : le message rendu
 *   au magasinier ne doit promettre que ce qui existe.
 */
async function enregistrerDemandesCreation(io, resolutions, demandePar, contexte) {
  const log = (io && io.logError) || function () {};
  const maintenant = io && io.maintenant ? io.maintenant() : Date.now();

  const libelles = demandeCreationArticle.libellesADemander(resolutions);
  /** @type {string[]} */
  const enregistres = [];

  for (const libelle of libelles) {
    const { id, data } = demandeCreationArticle.construireDemande({
      libelle, demandePar, contexte, maintenant,
    });
    if (!id) continue;
    try {
      // `merge` : une demande déjà ouverte est renforcée, pas écrasée, et
      // `occurrences` compte combien de fois l'article a été réclamé — c'est
      // l'information qui fait agir le DG.
      await io.db.collection(demandeCreationArticle.COLLECTION).doc(id).set(
        Object.assign({}, data, {
          occurrences: io.increment(1),
          created_at: io.serverTimestamp(),
        }),
        { merge: true }
      );
      enregistres.push(libelle);
    } catch (e) {
      // ⚠️ ISOLÉ : cette écriture est ACCESSOIRE. La laisser remonter ferait
      // perdre la réception elle-même (500 avant l'écriture du BL).
      log('demande création article — écriture échouée (' + libelle + '):', e);
    }
  }

  if (enregistres.length) {
    // WhatsApp par TEMPLATE (`general_alert`, approuvé par Meta) : un message
    // free-form serait droppé en silence hors fenêtre de 24 h.
    try {
      await io.dispatchNotification({
        type: 'general_alert',
        profiles: ['dg'],
        channels: ['in_app', 'whatsapp'],
        data: {
          message: demandeCreationArticle.messageWhatsApp(enregistres, demandePar),
          severity: 'warning',
        },
        relatedDoc: demandeCreationArticle.COLLECTION,
      });
    } catch (e) {
      log('demande création article — notification DG échouée:', e);
    }
  }

  // ── ÉCARTS QUI NE SE CRÉENT PAS : article EN DOUBLE, ou ligne sans article.
  // ⚠️ Cette condition ne doit JAMAIS dépendre de `enregistres` : c'est
  // précisément le couplage (R3) qui rendait 0 dispatch sur un article ambigu,
  // pendant que le bon affirmait « Le DG a été alerté ». Un article en double
  // ne produit aucune demande PAR CONSTRUCTION — le lier au succès des
  // demandes revient à le rendre muet.
  const ecarts = demandeCreationArticle.ecartsASignaler(resolutions);
  if (ecarts.length) {
    try {
      await io.dispatchNotification({
        type: 'general_alert',
        profiles: ['dg'],
        channels: ['in_app', 'whatsapp'],
        data: {
          message: demandeCreationArticle.messageSignalement(ecarts, contexte),
          severity: 'warning',
        },
        relatedDoc: demandeCreationArticle.COLLECTION,
      });
    } catch (e) {
      log('écart d\'identité article — alerte DG échouée:', e);
    }
  }

  return enregistres;
}

module.exports = { enregistrerDemandesCreation }
