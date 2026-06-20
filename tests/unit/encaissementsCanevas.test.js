'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const EC = require('../../public/lib/encaissementsCanevas.js');

// ---------------------------------------------------------------------------
// Référentiel de test (clients actifs + archivés)
// ---------------------------------------------------------------------------
const ACTIVE = [
  { client_id: 'hamdouch_omar', nom: 'Hamdouch Omar' },
  { client_id: 'iraqi_mohamed', nom: 'IRAQI MOHAMED' },
  { client_id: 'mustapha_chafik_a', nom: 'MUSTAPHA CHAFIK A' },
];
const ARCHIVED = new Set(['IMAD', 'AMIN']);

function deps() {
  return { activeClients: ACTIVE, archivedNames: ARCHIVED };
}

function header(over) {
  return Object.assign({
    Client: 'Hamdouch Omar',
    'Date encaissement': '15/06/2026',
    'Montant (DH)': '27 445,00',
    Mode: 'Espèces',
    'Référence': 'CHQ-12',
    Motif: 'acompte',
  }, over || {});
}

// ---------------------------------------------------------------------------
// parseFrNumber
// ---------------------------------------------------------------------------
test('parseFrNumber : formats variés', () => {
  assert.equal(EC.parseFrNumber('27 445,00'), 27445);
  assert.equal(EC.parseFrNumber('1.234,56'), 1234.56);
  assert.equal(EC.parseFrNumber('300000'), 300000);
  assert.equal(EC.parseFrNumber('1 234.56'), 1234.56);
  assert.equal(EC.parseFrNumber(42), 42);
  assert.equal(EC.parseFrNumber(''), null);
  assert.equal(EC.parseFrNumber('abc'), null);
  assert.equal(EC.parseFrNumber(null), null);
});

// ---------------------------------------------------------------------------
// parseDate
// ---------------------------------------------------------------------------
test('parseDate : Excel serial / JJ-MM-AAAA / ISO', () => {
  // Série Excel : 1899-12-30 + 45000 jours.
  assert.equal(EC.parseDate(45000), '2023-03-15');
  assert.equal(EC.parseDate('15/06/2026'), '2026-06-15');
  assert.equal(EC.parseDate('15-06-2026'), '2026-06-15');
  assert.equal(EC.parseDate('2026-06-15'), '2026-06-15');
  assert.equal(EC.parseDate('2026-06-15T10:00:00'), '2026-06-15');
  assert.equal(EC.parseDate('31/02/2026'), null); // date impossible
  assert.equal(EC.parseDate('pas une date'), null);
  assert.equal(EC.parseDate(''), null);
});

// ---------------------------------------------------------------------------
// normalizeReference
// ---------------------------------------------------------------------------
test('normalizeReference : casse + espaces internes → même clé', () => {
  const a = EC.normalizeReference('CHQ-12');
  const b = EC.normalizeReference('chq-12');
  const c = EC.normalizeReference('CHQ  12'.replace('CHQ  12', 'CHQ  12')); // 'CHQ  12'
  assert.equal(a, 'chq-12');
  assert.equal(b, 'chq-12');
  assert.equal(EC.normalizeReference('  CHQ-12  '), 'chq-12');
  assert.equal(EC.normalizeReference('CHQ  12'), 'chq 12');
  assert.equal(a, b);
  assert.equal(typeof c, 'string');
});

// ---------------------------------------------------------------------------
// parseEncaissements — ligne OK
// ---------------------------------------------------------------------------
test('parseEncaissements : ligne OK produit un encaissement valide', () => {
  const r = EC.parseEncaissements([header()], deps());
  assert.equal(r.stats.lus, 1);
  assert.equal(r.stats.ok, 1);
  assert.equal(r.stats.rejetes, 0);
  assert.equal(r.stats.doublons, 0);
  const e = r.ok[0];
  assert.equal(e.type, 'encaissement');
  assert.equal(e.source, 'canevas');
  assert.equal(e.client_id, 'hamdouch_omar');
  assert.equal(e.caisse_id, 'compte_client_hamdouch_omar');
  assert.equal(e.montant, 27445);
  assert.equal(e.date, '2026-06-15');
  assert.equal(e.reference, 'CHQ-12');
  assert.equal(e.reference_norm, 'chq-12');
  assert.equal(e.idempotency_key, 'hamdouch_omar__chq-12');
  assert.equal(e.version, 1);
});

// ---------------------------------------------------------------------------
// Motifs de rejet distincts
// ---------------------------------------------------------------------------
test('parseEncaissements : client_absent', () => {
  const r = EC.parseEncaissements([header({ Client: '' })], deps());
  assert.equal(r.stats.ok, 0);
  assert.equal(r.rejets[0].raison, 'client_absent');
});

test('parseEncaissements : client_archive (distinct de inconnu)', () => {
  const r = EC.parseEncaissements([header({ Client: 'IMAD' })], deps());
  assert.equal(r.stats.ok, 0);
  assert.equal(r.rejets[0].raison, 'client_archive');
});

test('parseEncaissements : client_inconnu', () => {
  const r = EC.parseEncaissements([header({ Client: 'Inconnu XYZ' })], deps());
  assert.equal(r.stats.ok, 0);
  assert.equal(r.rejets[0].raison, 'client_inconnu');
});

test('parseEncaissements : reference_absente (REQUISE)', () => {
  const r = EC.parseEncaissements([header({ 'Référence': '' })], deps());
  assert.equal(r.stats.ok, 0);
  assert.equal(r.rejets[0].raison, 'reference_absente');
});

test('parseEncaissements : montant_non_positif (0 et négatif)', () => {
  const r0 = EC.parseEncaissements([header({ 'Montant (DH)': '0' })], deps());
  assert.equal(r0.rejets[0].raison, 'montant_non_positif');
  const rNeg = EC.parseEncaissements([header({ 'Montant (DH)': '-100' })], deps());
  assert.equal(rNeg.rejets[0].raison, 'montant_non_positif');
});

test('parseEncaissements : montant_invalide', () => {
  const r = EC.parseEncaissements([header({ 'Montant (DH)': 'abc' })], deps());
  assert.equal(r.rejets[0].raison, 'montant_invalide');
});

test('parseEncaissements : date_invalide', () => {
  const r = EC.parseEncaissements([header({ 'Date encaissement': '31/02/2026' })], deps());
  assert.equal(r.rejets[0].raison, 'date_invalide');
});

// ---------------------------------------------------------------------------
// Doublon intra-fichier — 1er gardé
// ---------------------------------------------------------------------------
test('parseEncaissements : doublon_intra_fichier (1er gardé)', () => {
  const rows = [
    header({ 'Référence': 'CHQ 12' }),
    header({ 'Référence': 'chq  12', 'Montant (DH)': '999' }), // même clé normalisée (casse + espaces)
  ];
  const r = EC.parseEncaissements(rows, deps());
  assert.equal(r.stats.ok, 1);
  assert.equal(r.stats.doublons, 1);
  assert.equal(r.ok[0].montant, 27445); // le 1er est gardé
  assert.equal(r.doublons[0].raison, 'doublon_intra_fichier');
});

// ---------------------------------------------------------------------------
// GARDE-FOU : uniquement type='encaissement'
// ---------------------------------------------------------------------------
test('parseEncaissements : ne produit QUE type=encaissement', () => {
  const rows = [
    header(),
    header({ Client: 'IRAQI MOHAMED', 'Référence': 'VIR-99' }),
    header({ Client: 'MUSTAPHA CHAFIK A', 'Référence': 'ESP-1' }),
  ];
  const r = EC.parseEncaissements(rows, deps());
  const types = Array.from(new Set(r.ok.map((e) => e.type)));
  assert.deepEqual(types, ['encaissement']);
});

// ---------------------------------------------------------------------------
// buildModeleAoA — en-têtes == schema
// ---------------------------------------------------------------------------
test('buildModeleAoA : en-têtes == schema.columns[].header', () => {
  const aoa = EC.buildModeleAoA(EC.ENCAISSEMENTS_SCHEMA, { clients: ACTIVE });
  const expectedHeaders = EC.ENCAISSEMENTS_SCHEMA.columns.map((c) => c.header);
  assert.deepEqual(aoa[0], expectedHeaders);
  assert.equal(aoa.length, 2); // en-têtes + 1 ligne exemple
  assert.equal(aoa[1][0], 'Hamdouch Omar'); // 1er client actif
});
