'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ENCAISSEMENTS_SCHEMA,
  parseFrNumber,
  parseDate,
  parseEncaissements,
} = require('../encaissements.js');
const { buildModeleAoA } = require('../modeleVierge.js');

// Les 5 clients FRAMBOISE (injectés, jamais en dur dans la logique).
const CLIENTS = [
  { client_id: 'mustapha_chafik_a', nom: 'Mustapha Chafik A' },
  { client_id: 'mr_monaim_local', nom: 'Mr Monaim Local' },
  { client_id: 'iraqi_mohamed', nom: 'Iraqi Mohamed' },
  { client_id: 'hamdouch_omar', nom: 'Hamdouch Omar' },
  { client_id: 'fruit_congel_du_nord', nom: 'Fruit Congel Du Nord' },
];

const H = {};
for (const c of ENCAISSEMENTS_SCHEMA.columns) H[c.key] = c.header;

function makeRow(o) {
  return {
    [H.client]: o.client,
    [H.date]: o.date,
    [H.montant]: o.montant,
    [H.mode]: o.mode,
    [H.reference]: o.reference,
    [H.motif]: o.motif,
  };
}

test('parseFrNumber : formats MA et natif', () => {
  assert.equal(parseFrNumber('27 445,00'), 27445);
  assert.equal(parseFrNumber('300000'), 300000);
  assert.equal(parseFrNumber('1.234,56'), 1234.56);
  assert.equal(parseFrNumber(''), null);
  assert.equal(parseFrNumber(null), null);
  assert.equal(parseFrNumber(1234.56), 1234.56);
  assert.equal(parseFrNumber('abc'), null);
  assert.equal(parseFrNumber('27 445,00'), 27445); // espace insécable
});

test('parseDate : série Excel, JJ/MM/AAAA, ISO', () => {
  // 45824 = 2025-06-16 (série Excel, epoch 1899-12-30).
  assert.equal(parseDate(45824), '2025-06-16');
  assert.equal(parseDate('15/06/2026'), '2026-06-15');
  assert.equal(parseDate('2026-06-15'), '2026-06-15');
  assert.equal(parseDate('2026-6-5'), '2026-06-05');
  assert.equal(parseDate('31/02/2026'), null); // date impossible
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('pas une date'), null);
});

test('parseEncaissements : ligne valide AVEC référence', () => {
  const rows = [
    makeRow({ client: 'Hamdouch Omar', date: '15/06/2026', montant: '27 445,00', mode: 'Chèque', reference: 'CHQ-12', motif: 'acompte' }),
  ];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.equal(res.encaissements.length, 1);
  const e = res.encaissements[0];
  assert.equal(e.type, 'encaissement');
  assert.equal(e.source, 'canevas');
  assert.equal(e.client_id, 'hamdouch_omar');
  assert.equal(e.caisse_id, 'compte_client_hamdouch_omar');
  assert.equal(e.montant, 27445);
  assert.equal(e.date, '2026-06-15');
  assert.equal(e.idempotency_key, 'hamdouch_omar__CHQ-12');
  assert.equal(e.version, 1);
  assert.equal(res.stats.retenus, 1);
});

test('parseEncaissements : ligne valide SANS référence -> clé dérivée date+montant', () => {
  const rows = [
    makeRow({ client: 'Iraqi Mohamed', date: '01/06/2026', montant: '300000', mode: 'Virement', reference: '', motif: '' }),
  ];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.equal(res.encaissements.length, 1);
  assert.equal(res.encaissements[0].idempotency_key, 'iraqi_mohamed__2026-06-01__30000000');
});

test('parseEncaissements : client absent -> rejet R1', () => {
  const rows = [makeRow({ client: '', date: '15/06/2026', montant: '100', mode: 'Espèces' })];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.equal(res.encaissements.length, 0);
  assert.equal(res.rejected.length, 1);
  assert.equal(res.rejected[0].raison, 'client_absent');
});

test('parseEncaissements : client hors des 5 -> rejet', () => {
  const rows = [makeRow({ client: 'Client Inconnu SARL', date: '15/06/2026', montant: '100', mode: 'Espèces' })];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.equal(res.encaissements.length, 0);
  assert.equal(res.rejected[0].raison, 'client_inconnu');
});

test('parseEncaissements : montant <= 0 -> rejet', () => {
  const rows = [
    makeRow({ client: 'Hamdouch Omar', date: '15/06/2026', montant: '0', mode: 'Espèces' }),
    makeRow({ client: 'Hamdouch Omar', date: '15/06/2026', montant: '-50', mode: 'Espèces' }),
  ];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.equal(res.encaissements.length, 0);
  assert.equal(res.rejected.length, 2);
  assert.ok(res.rejected.every((r) => r.raison === 'montant_non_positif'));
});

test('parseEncaissements : 2 lignes même clé -> 1 retenu + doublon signalé', () => {
  const rows = [
    makeRow({ client: 'Hamdouch Omar', date: '15/06/2026', montant: '100', mode: 'Espèces', reference: 'DUP-1' }),
    makeRow({ client: 'Hamdouch Omar', date: '20/06/2026', montant: '999', mode: 'Chèque', reference: 'DUP-1' }),
  ];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.equal(res.encaissements.length, 1);
  assert.equal(res.encaissements[0].montant, 100); // la 1ère est gardée
  assert.equal(res.stats.doublons_intra_fichier, 1);
  assert.equal(res.rejected.filter((r) => r.raison === 'doublon_intra_fichier').length, 1);
});

test('parseEncaissements : ne produit JAMAIS de type != encaissement', () => {
  const rows = [
    makeRow({ client: 'Hamdouch Omar', date: '15/06/2026', montant: '100', mode: 'Espèces', reference: 'R1' }),
    makeRow({ client: 'Iraqi Mohamed', date: '16/06/2026', montant: '200', mode: 'Virement', reference: 'R2' }),
  ];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.ok(res.encaissements.length > 0);
  assert.ok(res.encaissements.every((e) => e.type === 'encaissement'));
  assert.ok(res.encaissements.every((e) => e.source === 'canevas'));
});

test('parseEncaissements : stats cohérentes', () => {
  const rows = [
    makeRow({ client: 'Hamdouch Omar', date: '15/06/2026', montant: '100', mode: 'Espèces', reference: 'A' }),
    makeRow({ client: '', date: '15/06/2026', montant: '100' }),
    makeRow({ client: 'Hamdouch Omar', date: '15/06/2026', montant: '100', mode: 'Espèces', reference: 'A' }),
  ];
  const res = parseEncaissements(rows, { clients: CLIENTS });
  assert.equal(res.stats.lus, 3);
  assert.equal(res.stats.retenus, 1);
  assert.equal(res.stats.rejetes, 2); // 1 client_absent + 1 doublon
  assert.equal(res.stats.doublons_intra_fichier, 1);
});

test('modèle : buildModeleAoA renvoie headers == schema.columns[].header dans l ordre', () => {
  const aoa = buildModeleAoA(ENCAISSEMENTS_SCHEMA, { clients: CLIENTS });
  assert.deepEqual(aoa[0], ENCAISSEMENTS_SCHEMA.columns.map((c) => c.header));
  assert.equal(aoa.length, 2); // headers + exemple
  assert.equal(aoa[1].length, ENCAISSEMENTS_SCHEMA.columns.length);
});
