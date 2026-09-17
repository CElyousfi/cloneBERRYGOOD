/**
 * reminder.js — Logique PURE du rappel BDC (action `remind-bdc`).
 *
 * Ce module ne fait AUCUN I/O : ni Firestore, ni WhatsApp. Il contient les trois
 * décisions pures extraites de l'action HTTP historique :
 *   - le ciblage des profils destinataires selon le statut du BDC,
 *   - le cooldown de 4 h entre deux rappels,
 *   - le calcul de la durée d'attente lisible (paramètre 3 du template
 *     WhatsApp `bdc_reminder`).
 *
 * Les I/O (lecture du BDC, dispatchNotification, écriture history /
 * last_reminded_at / reminder_count) vivent dans functions/src/modules/magasin/bdcReminderService.js.
 * Même découpage que lib/bdc/mirrorSync.js (pur) vs bdcMirrorService.js (I/O).
 *
 * ⚠️ Comportement strictement identique à l'action HTTP d'origine — toute
 * modification ici change ce que voit l'utilisateur (messages d'erreur affichés
 * dans le dashboard) ou ce que reçoit Meta (paramètres du template).
 */
// @ts-check
'use strict';

const bdcWorkflow = require('./workflow');

/** Délai minimal entre deux rappels sur un même BDC (4 h). */
const REMINDER_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * @typedef {Object} ReminderTargets
 * @property {string[]} profiles - Profils destinataires du rappel.
 * @property {(string|null|undefined)} ferme - Ferme de ciblage (chef uniquement), sinon null.
 */

/**
 * Résout les destinataires d'un rappel selon le statut (et le mode de paiement)
 * du BDC. Retourne `null` quand aucun rappel n'est possible dans ce statut.
 *
 * Table de ciblage (inchangée depuis l'action HTTP d'origine) :
 *   en_attente_chef              → chef de la ferme (filtré si inconnu), ferme ciblée
 *   en_attente_dg                → ["dg"]
 *   valide_dg + mode virement    → ["finance"]
 *   valide_dg + autre mode       → ["achats"]
 *   virement_lance               → ["dg"]
 *   virement_signe               → ["achats"]
 *   tout autre statut            → null (aucun rappel possible)
 *
 * @param {{status?: string, ferme?: string, mode_paiement?: string}} bdc
 * @returns {ReminderTargets|null}
 */
function resolveReminderTargets(bdc) {
  const status = bdc && bdc.status;
  const isVirementMode =
    bdc && (bdc.mode_paiement === 'comptant_virement' || bdc.mode_paiement === 'virement_bancaire');

  if (status === 'en_attente_chef') {
    return {
      profiles: [bdcWorkflow.chefProfileForFerme(bdc.ferme)].filter(Boolean),
      ferme: bdc.ferme,
    };
  }
  if (status === 'en_attente_dg') return { profiles: ['dg'], ferme: null };
  if (status === 'valide_dg' && isVirementMode) return { profiles: ['finance'], ferme: null };
  if (status === 'valide_dg' && !isVirementMode) return { profiles: ['achats'], ferme: null };
  if (status === 'virement_lance') return { profiles: ['dg'], ferme: null };
  if (status === 'virement_signe') return { profiles: ['achats'], ferme: null };
  return null;
}

/**
 * Décision de cooldown : un rappel est bloqué tant que 4 h ne se sont pas
 * écoulées depuis `last_reminded_at`. `hoursLeft` est arrondi au supérieur et
 * n'a de sens que lorsque `blocked` est vrai.
 *
 * @param {(number|null|undefined)} lastRemindedAt - Timestamp ms du dernier rappel (0/absent = jamais).
 * @param {number} now - Timestamp ms courant.
 * @returns {{blocked: boolean, hoursLeft: number}}
 */
function reminderCooldown(lastRemindedAt, now) {
  const lastReminded = lastRemindedAt || 0;
  const elapsed = now - lastReminded;
  return {
    blocked: elapsed < REMINDER_COOLDOWN_MS,
    hoursLeft: Math.ceil((REMINDER_COOLDOWN_MS - elapsed) / (60 * 60 * 1000)),
  };
}

/**
 * Durée d'attente lisible depuis la dernière mise à jour du BDC.
 * Au-delà de 24 h on exprime en jours, sinon en heures avec un plancher à
 * « 1 heure » (jamais « 0 heure »).
 *
 * @param {number} lastUpdate - Timestamp ms de updated_at / created_at.
 * @param {number} now - Timestamp ms courant.
 * @returns {string} ex. "3 jours", "1 jour", "5 heures", "1 heure"
 */
function formatWaitingDuration(lastUpdate, now) {
  const ageMs = now - lastUpdate;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
  return ageDays > 0
    ? `${ageDays} jour${ageDays > 1 ? 's' : ''}`
    : `${Math.max(1, ageHours)} heure${ageHours > 1 ? 's' : ''}`;
}

module.exports = {
  REMINDER_COOLDOWN_MS,
  resolveReminderTargets,
  reminderCooldown,
  formatWaitingDuration,
};
