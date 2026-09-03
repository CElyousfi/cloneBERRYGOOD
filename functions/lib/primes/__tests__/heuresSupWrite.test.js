'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildHeuresSupWrite, buildHeuresSupHistoryEntry } = require('../heuresSupWrite');

const META = { now: 'SERVER_TS', actor: { uid: 'u1', name: 'Omar' } };

test('buildHeuresSupWrite : merge TOUJOURS actif', () => {
  const w = buildHeuresSupWrite('Quinzaine 04', '11485', 700, META);
  assert.strictEqual(w.options.merge, true);
});

test('buildHeuresSupWrite : montants porte EXACTEMENT la clé du matricule', () => {
  const w = buildHeuresSupWrite('Quinzaine 04', '11485', 700, META);
  assert.deepStrictEqual(Object.keys(w.data.montants), ['11485']);
  assert.strictEqual(w.data.montants['11485'], 700);
});

// L'INVARIANT CENTRAL. `set({ montants: {} }, {merge:true})` remplace la map
// par une map vide (aucune feuille -> le masque porte `montants`), ce qui
// effaçait les montants des autres ouvriers de la quinzaine.
test('buildHeuresSupWrite : montants n\'est JAMAIS un objet vide', () => {
  const cas = [
    ['Quinzaine 04', '11485', 700],
    ['Quinzaine 04', 'ZZ11424', 450],
    ['Quinzaine 03', '10502', 0],
  ];
  for (const [per, mat, montant] of cas) {
    const w = buildHeuresSupWrite(per, mat, montant, META);
    assert.ok(w.data.montants && typeof w.data.montants === 'object',
      'montants doit être un objet');
    assert.ok(Object.keys(w.data.montants).length > 0,
      'montants vide = la map de la quinzaine serait écrasée (' + mat + ')');
  }
});

test('buildHeuresSupWrite : le montant 0 est TRANSMIS (remise à zéro légitime)', () => {
  const w = buildHeuresSupWrite('Quinzaine 04', '11485', 0, META);
  assert.deepStrictEqual(Object.keys(w.data.montants), ['11485']);
  assert.strictEqual(w.data.montants['11485'], 0);
});

test('buildHeuresSupWrite : le matricule est normalisé (ZZ11424 -> 11424)', () => {
  const w = buildHeuresSupWrite('Quinzaine 04', 'ZZ11424', 450, META);
  assert.deepStrictEqual(Object.keys(w.data.montants), ['11424']);
  assert.strictEqual(w.data.montants['11424'], 450);
});

test('buildHeuresSupWrite : aucun chemin de haut niveau `montants` dans le payload', () => {
  // Un champ à plat 'montants.11485' passerait le masque MAIS pas via set() :
  // on vérifie que la forme est bien imbriquée, seule acceptée par set/merge.
  const w = buildHeuresSupWrite('Quinzaine 04', '11485', 700, META);
  assert.ok(!Object.prototype.hasOwnProperty.call(w.data, 'montants.11485'));
});

test('buildHeuresSupWrite : periode, updatedAt et updatedBy sont portés', () => {
  const w = buildHeuresSupWrite('Quinzaine 04', '11485', 700, META);
  assert.strictEqual(w.data.periode, 'Quinzaine 04');
  assert.strictEqual(w.data.updatedAt, 'SERVER_TS');
  assert.deepStrictEqual(w.data.updatedBy, META.actor);
});

test('buildHeuresSupWrite : montant non numérique retombe à 0, pas à NaN', () => {
  const w = buildHeuresSupWrite('Quinzaine 04', '11485', 'abc', META);
  assert.strictEqual(w.data.montants['11485'], 0);
});

test('buildHeuresSupWrite : periode ou matricule vide refusé', () => {
  assert.throws(() => buildHeuresSupWrite('', '11485', 700, META), /periode/);
  assert.throws(() => buildHeuresSupWrite('Quinzaine 04', 'ZZ', 700, META), /matricule/);
});

test('buildHeuresSupWrite : meta absent ne pose pas updatedAt/updatedBy', () => {
  const w = buildHeuresSupWrite('Quinzaine 04', '11485', 700);
  assert.ok(!Object.prototype.hasOwnProperty.call(w.data, 'updatedAt'));
  assert.ok(!Object.prototype.hasOwnProperty.call(w.data, 'updatedBy'));
  assert.deepStrictEqual(Object.keys(w.data.montants), ['11485']);
});

// ─────────────────── AUDIT : rh_heures_sup/<periode>/history ────────────────
// `updatedAt`/`updatedBy` sont globaux au document : sur douze saisies, une
// seule laisse une trace. L'entrée d'historique est donc PAR SAISIE.

test('buildHeuresSupHistoryEntry : porte matricule, montant, auteur et date', () => {
  const e = buildHeuresSupHistoryEntry('Quinzaine 04', 'ZZ11424', 450, META);
  assert.strictEqual(e.periode, 'Quinzaine 04');
  assert.strictEqual(e.matricule, '11424');
  assert.strictEqual(e.montant, 450);
  assert.deepStrictEqual(e.changedBy, META.actor);
  assert.strictEqual(e.changedAt, 'SERVER_TS');
});

test('buildHeuresSupHistoryEntry : une remise à ZÉRO laisse bien une trace', () => {
  // Le cas qui ne laissait AUCUNE trace avant : 800 -> 0.
  const e = buildHeuresSupHistoryEntry('Quinzaine 04', '11485', 0, META);
  assert.strictEqual(e.montant, 0);
  assert.strictEqual(e.matricule, '11485');
});

test('buildHeuresSupHistoryEntry : pas de previousMontant (exigerait un get())', () => {
  const e = buildHeuresSupHistoryEntry('Quinzaine 04', '11485', 700, META);
  assert.ok(!Object.prototype.hasOwnProperty.call(e, 'previousMontant'));
});

test('buildHeuresSupHistoryEntry : montant non numérique retombe à 0', () => {
  assert.strictEqual(buildHeuresSupHistoryEntry('Quinzaine 04', '11485', 'abc', META).montant, 0);
});

test('buildHeuresSupHistoryEntry : periode ou matricule vide refusé', () => {
  assert.throws(() => buildHeuresSupHistoryEntry('', '11485', 700, META), /periode/);
  assert.throws(() => buildHeuresSupHistoryEntry('Quinzaine 04', 'ZZ', 700, META), /matricule/);
});
