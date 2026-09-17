'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTimacInvoice,
  isLiquidationEmail,
  isDailyQualityReport,
  isWeeklyQualityReport,
  createTimacInvoiceFromParsed,
} = require('../../functions/src/modules/finance/emailService');

// =============================================
// isTimacInvoice — strict detection
// =============================================

test('isTimacInvoice: capte un mail TIMAC avec "Facture" dans le sujet', () => {
  assert.equal(
    isTimacInvoice('Facturation TIMAC <facturation@timacmaroc.com>', 'Facture 146075'),
    true
  );
});

test('isTimacInvoice: capte quelle que soit la casse du domaine et du mot facture', () => {
  assert.equal(
    isTimacInvoice('<COMPTA@TIMACMAROC.COM>', 'Votre FACTURE du mois'),
    true
  );
});

test('isTimacInvoice: rejette un objet sans "facture" (Bon de livraison)', () => {
  assert.equal(
    isTimacInvoice('<facturation@timacmaroc.com>', 'Bon de livraison 132253'),
    false
  );
});

test('isTimacInvoice: rejette un expediteur autre que timacmaroc.com', () => {
  assert.equal(
    isTimacInvoice('<facture@autre-fournisseur.com>', 'Facture 146075'),
    false
  );
});

test('isTimacInvoice: rejette Driscoll\'s (qainspectresults@driscolls.com)', () => {
  assert.equal(
    isTimacInvoice('qainspectresults@driscolls.com', 'Quality Inspection Report'),
    false
  );
});

test('isTimacInvoice: rejette une liquidation Driscoll\'s', () => {
  assert.equal(
    isTimacInvoice('reports@driscolls.com', 'Liquidation W6'),
    false
  );
});

test('isTimacInvoice: rejette un Daily Quality Report', () => {
  assert.equal(
    isTimacInvoice('reports@driscolls.com', 'Vendor 200741 - Daily Quality Report'),
    false
  );
});

test('isTimacInvoice: robuste sur from/subject manquants', () => {
  assert.equal(isTimacInvoice(undefined, undefined), false);
  assert.equal(isTimacInvoice(null, null), false);
  assert.equal(isTimacInvoice('', ''), false);
});

// =============================================
// NON-REGRESSION — les classifieurs Driscoll's gardent leur comportement
// et ne sont JAMAIS reclassés TIMAC (et inversement).
// =============================================

test('non-regression: une liquidation reste classee liquidation, pas TIMAC', () => {
  const from = 'reports@driscolls.com';
  const subject = 'Liquidation W6 - Berry Good';
  assert.equal(isLiquidationEmail(from, subject), true);
  assert.equal(isTimacInvoice(from, subject), false);
});

test('non-regression: un Daily Quality Report reste DQR, pas TIMAC', () => {
  const from = 'reports@driscolls.com';
  const subject = 'Vendor 200741 - Daily Quality Report';
  assert.equal(isDailyQualityReport(from, subject), true);
  assert.equal(isTimacInvoice(from, subject), false);
});

test('non-regression: un Weekly Quality Report reste WQR, pas TIMAC', () => {
  const from = 'reports@driscolls.com';
  const subject = 'Weekly Quality Report - Raspberry W6';
  assert.equal(isWeeklyQualityReport(from, subject), true);
  assert.equal(isTimacInvoice(from, subject), false);
});

test('non-regression: un mail TIMAC facture n\'est PAS classe liquidation/DQR/WQR', () => {
  const from = '<facturation@timacmaroc.com>';
  const subject = 'Facture 146075';
  assert.equal(isTimacInvoice(from, subject), true);
  assert.equal(isLiquidationEmail(from, subject), false);
  assert.equal(isDailyQualityReport(from, subject), false);
  assert.equal(isWeeklyQualityReport(from, subject), false);
});

// =============================================
// TÂCHE A — Garde num_facture absent (décision Omar)
// La facture sans numéro n'entre JAMAIS dans le workflow paiement.
// La garde vit dans le helper partagé et retourne 'a_revoir' AVANT
// tout accès Firestore (donc testable sans ADC/emulator).
// =============================================

test('createTimacInvoiceFromParsed: num_facture null → a_revoir, aucune écriture', async () => {
  const parsed = {
    fournisseur: 'TIMAC AGRO MAROC',
    num_facture: null,
    date_facture: '2026-01-15',
    net_a_payer: 12345.67,
    lignes: [{ designation: 'Engrais', quantite: 1, montant: 100 }],
  };
  const res = await createTimacInvoiceFromParsed(parsed, {
    source: 'backfill_timac',
    dryRun: true,
  });
  assert.equal(res.status, 'a_revoir');
  assert.equal(res.reason, 'num_facture absent');
});

test('createTimacInvoiceFromParsed: num_facture vide ("") → a_revoir', async () => {
  const res = await createTimacInvoiceFromParsed(
    { num_facture: '', lignes: [] },
    { source: 'email_timac', dryRun: true }
  );
  assert.equal(res.status, 'a_revoir');
});

test('createTimacInvoiceFromParsed: parsed null/undefined → a_revoir (robuste)', async () => {
  const res1 = await createTimacInvoiceFromParsed(null, { dryRun: true });
  const res2 = await createTimacInvoiceFromParsed(undefined, { dryRun: true });
  assert.equal(res1.status, 'a_revoir');
  assert.equal(res2.status, 'a_revoir');
});

test('createTimacInvoiceFromParsed: est bien exporté (refacto helper partagé)', () => {
  assert.equal(typeof createTimacInvoiceFromParsed, 'function');
});
