'use strict';

/**
 * Unit tests for functions/lib/stock/locationsConfig.js
 * (logique pure de l'action set-locations : rôle + patch ciblé + idempotence)
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorizeSetLocations,
  buildLocationsPatch,
} = require('../../functions/lib/stock/locationsConfig.js');

// ---------- Autorisation par rôle ----------

test('rôle dg → autorisé', () => {
  assert.deepEqual(authorizeSetLocations('dg'), { allowed: true });
});

test('rôle finance → autorisé', () => {
  assert.deepEqual(authorizeSetLocations('finance'), { allowed: true });
});

test('rôle achats → refusé 403', () => {
  const r = authorizeSetLocations('achats');
  assert.equal(r.allowed, false);
  assert.equal(r.status, 403);
  assert.match(r.error, /Finance\/DG/);
});

test('rôle absent (null) → refusé 403', () => {
  const r = authorizeSetLocations(null);
  assert.equal(r.allowed, false);
  assert.equal(r.status, 403);
  assert.match(r.error, /introuvable/);
});

// ---------- Construction du patch ciblé ----------

test('magasins fourni → patch ne contient QUE magasins (pas de stations/parcelles)', () => {
  const r = buildLocationsPatch({ magasins: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.patch), ['magasins']);
  assert.deepEqual(r.patch.magasins, ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  assert.equal('stations' in r.patch, false);
  assert.equal('parcelles' in r.patch, false);
});

test('idempotence : même liste → même patch', () => {
  const body = { magasins: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] };
  const a = buildLocationsPatch(body);
  const b = buildLocationsPatch(body);
  assert.deepEqual(a.patch, b.patch);
});

test('update ciblé multi-champs : seuls les champs fournis sont dans le patch', () => {
  const r = buildLocationsPatch({
    magasins: ['F1', 'F2'],
    parcelles: { F1: ['S1'] },
  });
  assert.equal(r.ok, true);
  assert.equal('magasins' in r.patch, true);
  assert.equal('parcelles' in r.patch, true);
  assert.equal('stations' in r.patch, false);
});

test('body vide → 400 (aucun champ)', () => {
  const r = buildLocationsPatch({});
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /Aucun champ/);
});

test('body null → 400', () => {
  const r = buildLocationsPatch(null);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

// ---------- Validation des types ----------

test('magasins non-tableau → 400', () => {
  const r = buildLocationsPatch({ magasins: 'F1' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /magasins/);
});

test('magasins avec élément non-string → 400', () => {
  const r = buildLocationsPatch({ magasins: ['F1', 3] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('stations non-tableau → 400', () => {
  const r = buildLocationsPatch({ stations: { a: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /stations/);
});

test('parcelles tableau (au lieu objet) → 400', () => {
  const r = buildLocationsPatch({ parcelles: ['x'] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /parcelles/);
});

test('parcelles objet valide → ok', () => {
  const r = buildLocationsPatch({ parcelles: { F1: ['S1', 'S2'] } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.patch.parcelles, { F1: ['S1', 'S2'] });
});
