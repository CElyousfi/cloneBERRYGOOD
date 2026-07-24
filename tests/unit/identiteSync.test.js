'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildIdentiteSyncPlan } = require('../../functions/lib/primes/identiteSync.js');

// ---------------------------------------------------------------------------
// buildIdentiteSyncPlan — backfill AUTO prenom/nom depuis BEE ONE
// ---------------------------------------------------------------------------

test('backfill le prenom manquant quand présent côté BEE ONE (matricule alpha-préfixé)', () => {
  const registryDocs = [{ id: '10502', data: { nom: 'ALAMI', prenom: '' } }];
  const bdpData = { 'DD10502': { nom: 'Alami', prenom: 'Hassan', cin: 'AB1', cnss: '123' } };
  const plan = buildIdentiteSyncPlan(registryDocs, bdpData);

  assert.equal(plan.toUpdate.length, 1);
  assert.equal(plan.toUpdate[0].id, '10502');
  assert.equal(plan.toUpdate[0].update.prenom, 'Hassan');
  // nom Firestore déjà rempli → ne doit JAMAIS être touché.
  assert.equal(Object.prototype.hasOwnProperty.call(plan.toUpdate[0].update, 'nom'), false);
  assert.equal(plan.notFoundInBdp.length, 0);
  assert.equal(plan.totalScanned, 1);
});

test('backfill nom ET prenom quand les deux sont vides côté Firestore', () => {
  const registryDocs = [{ id: '3439', data: {} }];
  const bdpData = { '3439': { nom: 'Bennani', prenom: 'Yassine' } };
  const plan = buildIdentiteSyncPlan(registryDocs, bdpData);

  assert.equal(plan.toUpdate.length, 1);
  assert.equal(plan.toUpdate[0].update.prenom, 'Yassine');
  assert.equal(plan.toUpdate[0].update.nom, 'Bennani');
});

test('ne touche jamais un prenom Firestore déjà renseigné, même si BEE ONE diffère', () => {
  const registryDocs = [{ id: '10502', data: { nom: 'ALAMI', prenom: 'Hassane' } }];
  const bdpData = { '10502': { nom: 'Alami', prenom: 'Hassan' } };
  const plan = buildIdentiteSyncPlan(registryDocs, bdpData);

  assert.equal(plan.toUpdate.length, 0);
  assert.equal(plan.notFoundInBdp.length, 0);
});

test('ne touche jamais un nom Firestore déjà renseigné, même partiellement incohérent', () => {
  const registryDocs = [{ id: '10502', data: { nom: 'ALAMI (ancien)', prenom: '' } }];
  const bdpData = { '10502': { nom: 'Alami Nouveau', prenom: 'Hassan' } };
  const plan = buildIdentiteSyncPlan(registryDocs, bdpData);

  assert.equal(plan.toUpdate.length, 1);
  assert.equal(plan.toUpdate[0].update.prenom, 'Hassan');
  assert.equal(Object.prototype.hasOwnProperty.call(plan.toUpdate[0].update, 'nom'), false);
});

test('liste notFoundInBdp quand prenom Firestore vide ET absent/vide côté BEE ONE', () => {
  const registryDocs = [
    { id: '111', data: { prenom: '' } },
    { id: '222', data: {} },
    { id: '333', data: { prenom: '' } },
  ];
  const bdpData = { '222': { nom: 'X', prenom: '' } }; // prenom vide côté BEE ONE aussi.
  const plan = buildIdentiteSyncPlan(registryDocs, bdpData);

  assert.equal(plan.toUpdate.length, 0);
  assert.deepEqual(plan.notFoundInBdp.sort(), ['111', '222', '333']);
  assert.equal(plan.totalScanned, 3);
});

test('idempotent : relancer le plan sur un registry déjà backfillé ne produit plus de mise à jour', () => {
  const registryDocs = [{ id: '10502', data: { prenom: '' } }];
  const bdpData = { '10502': { nom: 'Alami', prenom: 'Hassan' } };
  const plan1 = buildIdentiteSyncPlan(registryDocs, bdpData);
  assert.equal(plan1.toUpdate.length, 1);

  // Applique le résultat du premier plan puis relance.
  const afterUpdate = { id: '10502', data: { prenom: plan1.toUpdate[0].update.prenom, nom: plan1.toUpdate[0].update.nom } };
  const plan2 = buildIdentiteSyncPlan([afterUpdate], bdpData);
  assert.equal(plan2.toUpdate.length, 0);
});

test('respecte notFoundLimit pour ne pas surcharger la réponse', () => {
  const registryDocs = Array.from({ length: 10 }, (_, i) => ({ id: String(i), data: { prenom: '' } }));
  const plan = buildIdentiteSyncPlan(registryDocs, {}, 3);
  assert.equal(plan.notFoundInBdp.length, 3);
  assert.equal(plan.totalScanned, 10);
});

test('gère bdpData vide/absent sans crasher', () => {
  const registryDocs = [{ id: '10502', data: { prenom: '' } }];
  const plan = buildIdentiteSyncPlan(registryDocs, undefined);
  assert.equal(plan.toUpdate.length, 0);
  assert.deepEqual(plan.notFoundInBdp, ['10502']);
});

test('registryDocs vide/absent retourne un plan vide', () => {
  const plan = buildIdentiteSyncPlan(undefined, { '10502': { prenom: 'Hassan' } });
  assert.equal(plan.toUpdate.length, 0);
  assert.equal(plan.notFoundInBdp.length, 0);
  assert.equal(plan.totalScanned, 0);
});
