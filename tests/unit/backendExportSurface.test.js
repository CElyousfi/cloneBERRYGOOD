/**
 * backendExportSurface.test.js — la surface d'export des Cloud Functions est GELÉE.
 *
 * Une Cloud Function est adressée par son NOM D'EXPORT. Le renommer ne renomme
 * rien : Firebase supprime l'ancienne fonction et en déploie une neuve. L'URL
 * HTTP change, le déclencheur Firestore se détache, la tâche planifiée perd son
 * cron, et les clients qui appelaient l'ancienne URL tombent.
 *
 * Ce test a été écrit pendant la modularisation du backend, quand
 * functions/index.js est passé de 19 463 lignes à un barrel : il verrouille la
 * liste relevée AVANT le découpage. Il échoue sur toute addition, suppression ou
 * renommage — ce qui est le but. Ajouter une Cloud Function est légitime : il
 * faut alors ajouter son nom ici, en connaissance de cause.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

/** Les 105 noms exposés par functions/index.js avant la modularisation. */
const SURFACE_GELEE = [
  'agroSummary',
  'alerts',
  'analyzeEmail',
  'authApi',
  'avancementCulture',
  'backfillPointageBdpLiveTrigger',
  'backfillPresence',
  'backupApi',
  'bdpIntrospect',
  'budgetService',
  'bugReports',
  'caisseManagement',
  'campagneRapportHebdo',
  'campagneRapportHebdoTrigger',
  'checkPresenceSyncHealth',
  'climatProduction',
  'createTimacInvoiceFromParsed',
  'dailyPhenologyJob',
  'dailyProductionDigest',
  'dailyProductionReportTrigger',
  'dashboard',
  'ecarts',
  'emailAnalysis',
  'farmroad',
  'farmroadRefresh',
  'fertigation',
  'fetchEmails',
  'fonctionsManagement',
  'fuel',
  'gddNightlyJob',
  'gddTracking',
  'growthTracking',
  'harvestPrediction',
  'harvestWeather',
  'health',
  'horsRecolteService',
  'indoorForecast',
  'indoorForecastRefresh',
  'isDailyQualityReport',
  'isLiquidationEmail',
  'isTimacInvoice',
  'isWeeklyQualityReport',
  'mappingConsoManagement',
  'meetingCR',
  'meteoSprayDigest',
  'meteoSprayDigestTrigger',
  'meteoblue',
  'netafimSyncDaily',
  'netafimSyncOnce',
  'notifications',
  'notifyNewAgqAnalyses',
  'ojra',
  'onAlertCreated',
  'onAnalyseFoliaireWrite',
  'onBugReportCreate',
  'onBugReportUpdate',
  'onProdRecolteWriteNotify',
  'parcelles',
  'parseLiquidationSummaryPdf',
  'parseLiquidationSummaryText',
  'parseLiquidationXlsx',
  'parseTimacInvoicePdf',
  'parseTimacInvoiceText',
  'phytosanitaire',
  'pointageRH',
  'pointageRH2',
  'pointageV3',
  'pointageValidation',
  'primesManagement',
  'probeAnalysisReport',
  'probeAnalyzer',
  'probeRawData',
  'processWhatsappIncoming',
  'productivityReportsCron',
  'produits',
  'recommandation',
  'registryService',
  'replicationProbe',
  'rh',
  'runDailyPhenologyJobNow',
  'runSyncJoursFeriesNow',
  'scheduledBackup',
  'sentinelRecipients',
  'sqlSyncTrigger',
  'sqlToFirestoreSync',
  'stockFileReminder16h',
  'stockFileReminder17h',
  'stockFileReminder18h',
  'stockManagement',
  'submitProductionDigestTemplate',
  'syncJoursFeries',
  'syncPointageBdpTrigger',
  'syncPresenceEntree',
  'syncPresenceSortie',
  'syncProdTrigger',
  'syncRecolteFromProd',
  'tasks',
  'telecom',
  'uploadEcarts',
  'uploadPhoto',
  'validatePointageBdpTrigger',
  'validation',
  'warmPointageCache',
  'whatsappAdmin',
  'whatsappWebhook',
];

test("la surface d'export des Cloud Functions est inchangée", () => {
  const actuels = Object.keys(require('../../functions')).sort();
  const attendus = [...SURFACE_GELEE].sort();

  const disparus = attendus.filter((n) => !actuels.includes(n));
  const apparus = actuels.filter((n) => !attendus.includes(n));

  assert.deepStrictEqual(
    disparus, [],
    'export(s) DISPARU(S) — la fonction déployée serait supprimée : ' + disparus.join(', ')
  );
  assert.deepStrictEqual(
    apparus, [],
    "export(s) APPARU(S) — si c'est voulu, ajouter le nom à SURFACE_GELEE : " + apparus.join(', ')
  );
  assert.strictEqual(actuels.length, 105);
});

test('chaque export est bien une fonction déployable', () => {
  const mod = require('../../functions');
  const invalides = Object.entries(mod)
    .filter(([, v]) => typeof v !== 'function')
    .map(([k]) => k);
  assert.deepStrictEqual(invalides, [], 'export(s) non appelable(s) : ' + invalides.join(', '));
});
