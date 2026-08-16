/**
 * campagneRapportHebdo/constants — configuration FIGÉE du rapport Campagne
 * hebdomadaire envoyé par WhatsApp.
 *
 * Ces constantes sont la SOURCE DE VÉRITÉ consommée par functions/index.js
 * (qui ne fait que le câblage Firebase) et par les tests. Les figer ici évite
 * qu'un horaire ou une liste de destinataires ne dérive silencieusement dans
 * le monolithe.
 */
// @ts-check
'use strict';

/**
 * Cron : tous les lundis à 16h00, heure du Maroc.
 * Timeout/mémoire généreux : ExcelJS produit une feuille par parcelle.
 */
const CRON_CONFIG = Object.freeze({
  schedule: '0 16 * * 1', // minute heure jour-du-mois mois jour-de-semaine(1 = lundi)
  timeZone: 'Africa/Casablanca',
  region: 'europe-west1',
  timeoutSeconds: 540,
  memory: '1GB',
});

/** Trigger HTTP jumeau (convention du repo : cf. dailyProductionReportTrigger). */
const HTTP_CONFIG = Object.freeze({
  region: 'europe-west1',
  timeoutSeconds: 540,
  memory: '1GB',
});

/**
 * Matrice de diffusion validée par Omar. SEULE source de vérité des
 * destinataires : par CULTURE, la liste des profils servis.
 *
 * Périmètre = la culture ENTIÈRE (le chef F1 reçoit toutes les parcelles
 * Framboise, toutes fermes confondues) → un seul classeur par culture, donc
 * `fermeFilter = null` à la génération et `ferme = null` à la résolution des
 * destinataires.
 *
 * DG / DT / RH figurent dans les deux cultures : ils reçoivent 2 messages
 * (un template WhatsApp ne porte qu'un seul document).
 */
const AUDIENCE = Object.freeze({
  Framboise: Object.freeze(['chef_f1', 'dg', 'dt', 'rh']),
  Myrtille: Object.freeze(['chef_f5', 'dg', 'dt', 'rh']),
});

/** Template Meta dédié (header DOCUMENT) — cf. create-whatsapp-templates.js. */
const TEMPLATE_NAME = 'campagne_rapport_hebdo';

/** Template d'alerte historique du repo (1 SEUL paramètre, pas de retour ligne). */
const ALERT_TEMPLATE_NAME = 'general_alert';

/** Profil destinataire des alertes d'échec (canal d'alerte établi du repo). */
const ALERT_PROFILE_ID = 'dg';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Profils autorisés à appeler le trigger HTTP. Une CF gen1 `https.onRequest`
 * est déployée avec l'invoker `allUsers` : l'URL est joignable par n'importe
 * qui. Le trigger DÉCLENCHE des envois réels et SERT le classeur complet
 * (JH par parcelle, budgets, ha) — être authentifié ne suffit donc pas, il
 * faut être dirigeant. `admin` est accepté via le rôle système (resolveProfile
 * rend `role: 'admin'` pour l'accès admin-cli).
 */
const TRIGGER_PROFILES = Object.freeze(['dg', 'dt']);

/**
 * Le chemin d'ENVOI RÉEL exige `?confirm=SEND` (modèle du `confirm=LIVE` des
 * triggers sensibles du repo) : sans ça, ouvrir l'URL nue « pour voir »
 * enverrait immédiatement 8 messages aux dirigeants.
 */
const CONFIRM_SEND = 'SEND';

module.exports = {
  CRON_CONFIG,
  HTTP_CONFIG,
  AUDIENCE,
  TEMPLATE_NAME,
  ALERT_TEMPLATE_NAME,
  ALERT_PROFILE_ID,
  XLSX_MIME,
  TRIGGER_PROFILES,
  CONFIRM_SEND,
};
