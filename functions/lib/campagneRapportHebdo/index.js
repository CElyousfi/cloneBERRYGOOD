/**
 * campagneRapportHebdo — envoi WhatsApp automatique du rapport Campagne, tous
 * les lundis à 16h00 (Africa/Casablanca).
 *
 * Point d'entrée du module : functions/index.js ne require QUE ce fichier et
 * n'y fait que le câblage Firebase (cron + trigger HTTP jumeau). Toute la
 * logique — matrice de diffusion, dédoublonnage, verdict de succès,
 * orchestration — vit ici, pure et testée.
 *
 * N'expose aucune Cloud Function et ne lit rien : tout est injecté.
 */
// @ts-check
'use strict';

const constants = require('./constants');
const envois = require('./envois');
const runJob = require('./runJob');

module.exports = {
  CRON_CONFIG: constants.CRON_CONFIG,
  HTTP_CONFIG: constants.HTTP_CONFIG,
  AUDIENCE: constants.AUDIENCE,
  TEMPLATE_NAME: constants.TEMPLATE_NAME,
  ALERT_TEMPLATE_NAME: constants.ALERT_TEMPLATE_NAME,
  ALERT_PROFILE_ID: constants.ALERT_PROFILE_ID,
  XLSX_MIME: constants.XLSX_MIME,
  TRIGGER_PROFILES: constants.TRIGGER_PROFILES,
  CONFIRM_SEND: constants.CONFIRM_SEND,

  buildEnvois: envois.buildEnvois,
  resumeEnvois: envois.resumeEnvois,
  nbParcellesFromFeuilles: envois.nbParcellesFromFeuilles,
  formatDateLabel: envois.formatDateLabel,
  buildBodyParams: envois.buildBodyParams,

  resolveRecipientsByProfile: runJob.resolveRecipientsByProfile,
  checkRecipients: runJob.checkRecipients,
  dryRun: runJob.dryRun,
  runRapportHebdo: runJob.runRapportHebdo,
  buildHttpHandler: runJob.buildHttpHandler,
};
