'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  aggregatePeriodKpis,
  computeNetDhParKg,
  distinctOuvriersFromRows,
} = require('../../public/lib/recolteKpiUtils.js');

test('aggregatePeriodKpis somme les coûts/kg sur la plage', () => {
  const series = [
    { salaire: 100, transport: 30, prime: 20, charges: 40, kg: 50, nbOuvJour: 2 },
    { salaire: 200, transport: 60, prime: 0, charges: 80, kg: 100, nbOuvJour: 4 },
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.totalSalaire, 300);
  assert.strictEqual(r.totalTransport, 90);
  assert.strictEqual(r.totalPrime, 20);
  assert.strictEqual(r.totalCharges, 120);
  assert.strictEqual(r.totalCout, 530);
  assert.strictEqual(r.totalKg, 150);
  assert.strictEqual(r.totalOuvrierJours, 6);
});

test('aggregatePeriodKpis dhParKgBrut = coût total / kg total', () => {
  const series = [
    { salaire: 100, transport: 0, prime: 0, charges: 0, kg: 40 },
    { salaire: 60, transport: 0, prime: 0, charges: 0, kg: 60 },
  ];
  const r = aggregatePeriodKpis(series);
  // 160 / 100 = 1.6
  assert.strictEqual(r.dhParKgBrut, 1.6);
});

test('coutMoyenOuvrierJour est une moyenne PONDÉRÉE, pas une moyenne de moyennes', () => {
  // Jour 1 : 600 DH / 2 ouvriers = 300 DH/ouv
  // Jour 2 : 100 DH / 1 ouvrier  = 100 DH/ouv
  // Moyenne de moyennes (faux) = (300+100)/2 = 200
  // Moyenne pondérée (attendu)  = (600+100)/(2+1) = 700/3 ≈ 233
  const series = [
    { salaire: 600, transport: 0, prime: 0, charges: 0, kg: 100, nbOuvJour: 2 },
    { salaire: 100, transport: 0, prime: 0, charges: 0, kg: 10, nbOuvJour: 1 },
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.totalOuvrierJours, 3);
  assert.strictEqual(r.coutMoyenOuvrierJour, Math.round(700 / 3)); // 233
});

test('aggregatePeriodKpis gère série vide / nulls', () => {
  const r = aggregatePeriodKpis([]);
  assert.strictEqual(r.totalCout, 0);
  assert.strictEqual(r.totalKg, 0);
  assert.strictEqual(r.dhParKgBrut, null);
  assert.strictEqual(r.coutMoyenOuvrierJour, 0);
  const r2 = aggregatePeriodKpis(null);
  assert.strictEqual(r2.totalCout, 0);
});

test('computeNetDhParKg additionne récolte + logistique sur kg récolté', () => {
  const r = computeNetDhParKg(160, 40, 100);
  assert.strictEqual(r.dhParKgLog, 0.4);
  assert.strictEqual(r.dhParKgNet, 2); // (160+40)/100
  const empty = computeNetDhParKg(100, 50, 0);
  assert.strictEqual(empty.dhParKgLog, null);
  assert.strictEqual(empty.dhParKgNet, null);
});

test('distinctOuvriersFromRows compte les matricules uniques (case-insensitive)', () => {
  const rows = [
    { matricule: 'MM01' },
    { matricule: 'mm01' }, // doublon (casse)
    { matricule: 'AY02' },
    { matricule: '' }, // ignoré
    { nom: 'Sans matricule' }, // fallback nom
  ];
  assert.strictEqual(distinctOuvriersFromRows(rows), 3);
  assert.strictEqual(distinctOuvriersFromRows([]), 0);
  assert.strictEqual(distinctOuvriersFromRows(null), 0);
});
