'use strict';

// Tests du module pur functions/lib/stock/bcDate.js — modification de la DATE
// d'un bon de consommation (action `update-bc-date`).
//
// Ce qui est verrouillé ici :
//   - format strict AAAA-MM-JJ ;
//   - dates inexistantes (31 février, 30 février bissextile, mois 13…) ;
//   - refus d'une date future / acceptation de la date du jour ;
//   - détection de changement de campagne DANS LES DEUX SENS ;
//   - date identique à l'existante : rien ne casse, l'historique est tout de
//     même tracé (changed=false pour l'appelant) ;
//   - le patch des `stock_movements` liés porte bien la NOUVELLE date (c'est
//     ce qui empêche la divergence bon ↔ mouvements).

const test = require('node:test');
const assert = require('node:assert');

const {
  isRealIsoDate,
  validateBcDate,
  campagneChange,
  buildDateUpdate,
  HISTORY_ACTION,
} = require('../../functions/lib/stock/bcDate');

const TODAY = '2026-08-25';

// ---------------------------------------------------------------- format

test('isRealIsoDate — formats acceptés / refusés', () => {
  assert.equal(isRealIsoDate('2026-08-25'), true);
  assert.equal(isRealIsoDate('2026-01-01'), true);
  assert.equal(isRealIsoDate('2026-12-31'), true);
  // Formats non ISO
  assert.equal(isRealIsoDate('25/08/2026'), false);
  assert.equal(isRealIsoDate('2026-8-25'), false);
  assert.equal(isRealIsoDate('2026-08-25T00:00:00Z'), false);
  assert.equal(isRealIsoDate(' 2026-08-25'), false);
  assert.equal(isRealIsoDate('2026-08-25 '), false);
  assert.equal(isRealIsoDate(''), false);
  assert.equal(isRealIsoDate(null), false);
  assert.equal(isRealIsoDate(undefined), false);
  assert.equal(isRealIsoDate(20260825), false);
});

test('isRealIsoDate — dates inexistantes refusées', () => {
  assert.equal(isRealIsoDate('2026-02-31'), false, '31 février');
  assert.equal(isRealIsoDate('2026-02-30'), false);
  assert.equal(isRealIsoDate('2026-02-29'), false, '2026 non bissextile');
  assert.equal(isRealIsoDate('2024-02-29'), true, '2024 bissextile');
  assert.equal(isRealIsoDate('2000-02-29'), true, '2000 bissextile (règle 400)');
  assert.equal(isRealIsoDate('1900-02-29'), false, '1900 NON bissextile (règle 100)');
  assert.equal(isRealIsoDate('2026-04-31'), false, 'avril = 30 jours');
  assert.equal(isRealIsoDate('2026-04-30'), true);
  assert.equal(isRealIsoDate('2026-13-01'), false, 'mois 13');
  assert.equal(isRealIsoDate('2026-00-10'), false, 'mois 0');
  assert.equal(isRealIsoDate('2026-08-00'), false, 'jour 0');
  assert.equal(isRealIsoDate('2026-08-32'), false, 'jour 32');
});

// ------------------------------------------------------------ validation

test('validateBcDate — date passée et date du jour acceptées', () => {
  assert.deepEqual(validateBcDate('2026-08-25', TODAY), { valid: true }, 'aujourd\'hui');
  assert.deepEqual(validateBcDate('2026-08-24', TODAY), { valid: true });
  assert.deepEqual(validateBcDate('2025-07-01', TODAY), { valid: true });
});

test('validateBcDate — date future refusée', () => {
  const r = validateBcDate('2026-08-26', TODAY);
  assert.equal(r.valid, false);
  assert.match(r.error, /future/i);
  assert.equal(validateBcDate('2027-01-01', TODAY).valid, false);
  // Frontière d'année : comparaison lexicographique correcte sur ISO
  assert.equal(validateBcDate('2026-09-01', TODAY).valid, false);
  assert.equal(validateBcDate('2026-07-31', TODAY).valid, true);
});

test('validateBcDate — format invalide refusé avec message explicite', () => {
  const r = validateBcDate('25/08/2026', TODAY);
  assert.equal(r.valid, false);
  assert.match(r.error, /AAAA-MM-JJ/);
  assert.equal(validateBcDate('2026-02-31', TODAY).valid, false);
  assert.equal(validateBcDate(null, TODAY).valid, false);
  assert.equal(validateBcDate(undefined, TODAY).valid, false);
});

test('validateBcDate — date du jour serveur illisible : refus (jamais de laissez-passer)', () => {
  const r = validateBcDate('2026-08-25', 'pas-une-date');
  assert.equal(r.valid, false);
  assert.equal(validateBcDate('2026-08-25', undefined).valid, false);
});

// --------------------------------------------------------------- campagne

test('campagneChange — bascule 2025-2026 → 2026-2027 (sens avant)', () => {
  const r = campagneChange('2026-06-30', '2026-07-01');
  assert.equal(r.changed, true);
  assert.equal(r.from, '2025-2026');
  assert.equal(r.to, '2026-2027');
});

test('campagneChange — bascule 2026-2027 → 2025-2026 (sens arrière)', () => {
  const r = campagneChange('2026-07-01', '2026-06-30');
  assert.equal(r.changed, true);
  assert.equal(r.from, '2026-2027');
  assert.equal(r.to, '2025-2026');
});

test('campagneChange — même campagne : pas de changement', () => {
  assert.equal(campagneChange('2026-07-02', '2026-12-31').changed, false);
  assert.equal(campagneChange('2026-08-25', '2026-08-25').changed, false);
  assert.equal(campagneChange('2025-08-01', '2026-06-30').changed, false);
});

test('campagneChange — dates illisibles : campagne null des deux côtés = pas de changement', () => {
  const r = campagneChange('', null);
  assert.equal(r.changed, false);
  assert.equal(r.from, null);
  assert.equal(r.to, null);
  // Une seule date lisible = changement (le front doit avertir)
  assert.equal(campagneChange('', '2026-08-25').changed, true);
});

// ----------------------------------------------------------------- patch

test('buildDateUpdate — patch du bon + patch des mouvements liés', () => {
  const bc = { date: '2026-08-01', history: [{ action: 'creation', at: 1 }] };
  const r = buildDateUpdate({ bc, date: '2026-08-20', by: { uid: 'u1', profileId: 'magasinier', name: 'Ali' }, at: 1234 });

  assert.equal(r.changed, true);
  assert.equal(r.bcUpdate.date, '2026-08-20');
  assert.equal(r.bcUpdate.updated_at, 1234);
  // Le patch des mouvements porte la MÊME nouvelle date — sinon le bon et les
  // stock_movements divergent et les analyses par période restent fausses.
  assert.equal(r.movementUpdate.date, '2026-08-20');
  assert.equal(r.movementUpdate.updated_at, 1234);

  // History : append (jamais d'écrasement), format {action, by, at, date_avant, date_apres}
  assert.equal(r.bcUpdate.history.length, 2);
  assert.deepEqual(r.bcUpdate.history[0], { action: 'creation', at: 1 });
  assert.deepEqual(r.bcUpdate.history[1], {
    action: HISTORY_ACTION,
    by: { uid: 'u1', profileId: 'magasinier', name: 'Ali' },
    at: 1234,
    date_avant: '2026-08-01',
    date_apres: '2026-08-20',
  });
});

test('buildDateUpdate — bon sans history : création du tableau', () => {
  const r = buildDateUpdate({ bc: { date: '2026-08-01' }, date: '2026-08-02', by: {}, at: 9 });
  assert.equal(r.bcUpdate.history.length, 1);
  assert.deepEqual(r.bcUpdate.history[0].by, { uid: '', profileId: '', name: '' });
  assert.equal(r.bcUpdate.history[0].date_avant, '2026-08-01');
});

test('buildDateUpdate — history non-tableau (donnée corrompue) : ignorée, pas de crash', () => {
  const r = buildDateUpdate({ bc: { date: '2026-08-01', history: 'nope' }, date: '2026-08-02', by: {}, at: 9 });
  assert.equal(Array.isArray(r.bcUpdate.history), true);
  assert.equal(r.bcUpdate.history.length, 1);
});

test('buildDateUpdate — date identique à l\'existante : changed=false, patch cohérent', () => {
  const r = buildDateUpdate({ bc: { date: '2026-08-01', history: [] }, date: '2026-08-01', by: { uid: 'u' }, at: 7 });
  assert.equal(r.changed, false);
  assert.equal(r.bcUpdate.date, '2026-08-01');
  assert.equal(r.movementUpdate.date, '2026-08-01');
  assert.equal(r.bcUpdate.history[0].date_avant, '2026-08-01');
  assert.equal(r.bcUpdate.history[0].date_apres, '2026-08-01');
});

test('buildDateUpdate — bon sans date (donnée ancienne) : date_avant vide, changed=true', () => {
  const r = buildDateUpdate({ bc: {}, date: '2026-08-01', by: {}, at: 3 });
  assert.equal(r.changed, true);
  assert.equal(r.bcUpdate.history[0].date_avant, '');
});
