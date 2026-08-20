'use strict';

/**
 * Unit tests for public/lib/stockDestinations.js — résolution des options du
 * select « Magasin destination » (réception BDC).
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDestinationOptions, SD_HORS_CONFIG_SUFFIX } = require('../../public/lib/stockDestinations.js');

const CONFIG = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

test('ferme du BDC présente dans la config → options inchangées, selected = ferme, pas de warning', () => {
  const r = resolveDestinationOptions(CONFIG, 'F5');
  assert.deepEqual(r.options.map(o => o.value), CONFIG);
  assert.equal(r.options.every(o => o.horsConfig === false), true);
  assert.equal(r.selected, 'F5');
  assert.equal(r.warning, null);
});

test('ferme du BDC absente de la config (BAHIA) → option horsConfig en tête + selected + warning', () => {
  const r = resolveDestinationOptions(CONFIG, 'BAHIA');
  assert.equal(r.options.length, CONFIG.length + 1);
  assert.deepEqual(r.options[0], { value: 'BAHIA', label: 'BAHIA' + SD_HORS_CONFIG_SUFFIX, horsConfig: true });
  assert.equal(r.selected, 'BAHIA');
  assert.equal(typeof r.warning, 'string');
  assert.ok(r.warning.includes('BAHIA'));
  assert.ok(r.warning.includes('configuration stock'));
  // les magasins configurés restent proposés, dans l'ordre
  assert.deepEqual(r.options.slice(1).map(o => o.value), CONFIG);
});

test('la valeur hors config conserve la casse fournie par le BDC', () => {
  const r = resolveDestinationOptions(CONFIG, 'Bahia');
  assert.equal(r.options[0].value, 'Bahia');
  assert.equal(r.selected, 'Bahia');
});

test('comparaison insensible à la casse et aux espaces', () => {
  const r = resolveDestinationOptions(['BAHIA', 'F1'], '  bahia ');
  assert.equal(r.options.length, 2, 'aucune option hors config ajoutée');
  assert.equal(r.warning, null);
  // selected doit être une valeur RÉELLEMENT présente dans les options, sinon
  // le select contrôlé se désynchronise à nouveau (c'est le bug d'origine).
  assert.equal(r.selected, 'BAHIA');
  assert.ok(r.options.some(o => o.value === r.selected));
});

test('ferme BDC vide → selected = premier magasin, pas de warning', () => {
  const r = resolveDestinationOptions(CONFIG, '');
  assert.equal(r.selected, 'F1');
  assert.equal(r.warning, null);
  assert.deepEqual(r.options.map(o => o.value), CONFIG);
});

test('ferme BDC absente (undefined/null) → selected = premier magasin', () => {
  assert.equal(resolveDestinationOptions(CONFIG).selected, 'F1');
  assert.equal(resolveDestinationOptions(CONFIG, null).selected, 'F1');
  assert.equal(resolveDestinationOptions(CONFIG, undefined).warning, null);
});

test('magasins vide / non-tableau → ne crashe pas, options vides', () => {
  for (const bad of [[], null, undefined, 'F1', 42, {}]) {
    const r = resolveDestinationOptions(/** @type {any} */ (bad));
    assert.deepEqual(r.options, []);
    assert.equal(r.selected, '');
    assert.equal(r.warning, null);
  }
});

test('magasins vide + ferme BDC → la ferme reste proposée (hors config)', () => {
  const r = resolveDestinationOptions([], 'BAHIA');
  assert.deepEqual(r.options, [{ value: 'BAHIA', label: 'BAHIA' + SD_HORS_CONFIG_SUFFIX, horsConfig: true }]);
  assert.equal(r.selected, 'BAHIA');
  assert.ok(r.warning);
});

test('entrées vides/blanches dans magasins ignorées', () => {
  const r = resolveDestinationOptions(['F1', '', '   ', null], 'F1');
  assert.deepEqual(r.options.map(o => o.value), ['F1']);
  assert.equal(r.selected, 'F1');
});

test('selected est toujours une valeur présente dans options (invariant du select contrôlé)', () => {
  // CONTRAT : l'invariant « selected ∈ options » vaut dès qu'il y a au moins une
  // destination à proposer. Le SEUL cas où il ne tient pas est le cas dégénéré
  // « aucun magasin configuré ET aucune ferme BDC » : options === [] et
  // selected === '' — il n'existe alors rien à sélectionner, et '' est
  // précisément ce qu'un <select> vide rend. Ce cas est traité à part ci-dessous.
  const cases = [
    [CONFIG, 'BAHIA'], [CONFIG, 'F2'], [CONFIG, ''], [CONFIG, undefined],
    [['BAHIA'], 'bahia'], [[], 'BAHIA'],
  ];
  for (const [mags, ferme] of cases) {
    const r = resolveDestinationOptions(/** @type {any} */ (mags), /** @type {any} */ (ferme));
    assert.ok(r.options.length > 0, JSON.stringify([mags, ferme]) + ' : options non vides attendues');
    assert.ok(r.options.some(o => o.value === r.selected), JSON.stringify([mags, ferme]));
  }
});

test('cas dégénéré : aucune destination du tout → options vides ET selected vide', () => {
  for (const ferme of ['', null, undefined]) {
    const r = resolveDestinationOptions([], /** @type {any} */ (ferme));
    assert.deepEqual(r.options, []);
    assert.equal(r.selected, '');
    assert.equal(r.warning, null);
    // Invariant volontairement NON tenu ici : il n'y a rien à sélectionner.
    assert.equal(r.options.some(o => o.value === r.selected), false);
  }
});
