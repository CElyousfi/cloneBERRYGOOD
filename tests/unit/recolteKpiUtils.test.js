'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  aggregatePeriodKpis,
  computeNetDhParKg,
  computeNetDhParKgProd,
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

test('moyennes/jour = sommes ÷ nbJoursAvecDonnees (2 jours pleins)', () => {
  const series = [
    { salaire: 100, transport: 30, prime: 20, charges: 40, kg: 50, nbOuvJour: 2 },
    { salaire: 200, transport: 60, prime: 0, charges: 80, kg: 100, nbOuvJour: 4 },
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.nbJoursAvecDonnees, 2);
  // coût total = 530 → 265/jour ; kg total = 150 → 75/jour
  assert.strictEqual(r.coutMoyenJour, 265);
  assert.strictEqual(r.kgMoyenJour, 75);
  assert.strictEqual(r.salaireMoyenJour, 150);
  assert.strictEqual(r.transportMoyenJour, 45);
  assert.strictEqual(r.primeMoyenJour, 10);
  assert.strictEqual(r.chargesMoyenJour, 60);
});

test('un jour totalement vide n\'est pas compté dans nbJoursAvecDonnees', () => {
  // 2 jours pleins + 1 jour vide (aujourd'hui sans récolte) : la moyenne/jour
  // ne doit PAS être diluée par le 3e jour à 0.
  const series = [
    { salaire: 100, transport: 0, prime: 0, charges: 0, kg: 40, nbOuvJour: 1 },
    { salaire: 100, transport: 0, prime: 0, charges: 0, kg: 60, nbOuvJour: 1 },
    { salaire: 0, transport: 0, prime: 0, charges: 0, kg: 0, nbOuvJour: 0 }, // jour vide
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.nbJoursAvecDonnees, 2); // pas 3
  assert.strictEqual(r.coutMoyenJour, 100); // 200/2, pas 200/3
  assert.strictEqual(r.kgMoyenJour, 50); // 100/2
});

test('DH/kg pondéré reste correct quand les kg sont déséquilibrés entre jours', () => {
  // Jour 1 : 100 DH / 40 kg ; Jour 2 : 60 DH / 60 kg
  // Pondéré = (100+60)/(40+60) = 160/100 = 1.6 (≠ moyenne des ratios 2.5/1.0)
  const series = [
    { salaire: 100, transport: 0, prime: 0, charges: 0, kg: 40 },
    { salaire: 60, transport: 0, prime: 0, charges: 0, kg: 60 },
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.dhParKgBrut, 1.6);
});

test('série uniquement composée d\'un jour vide → moyennes/jour = 0, dhParKg null', () => {
  const r = aggregatePeriodKpis([{ salaire: 0, transport: 0, prime: 0, charges: 0, kg: 0, nbOuvJour: 0 }]);
  assert.strictEqual(r.nbJoursAvecDonnees, 0);
  assert.strictEqual(r.coutMoyenJour, 0);
  assert.strictEqual(r.kgMoyenJour, 0);
  assert.strictEqual(r.dhParKgBrut, null);
});

test('un jour avec coût mais sans kg compte comme jour-avec-données', () => {
  // Cas data dégradée : cout présent, kg manquant. Le jour doit compter
  // (sinon coutMoyenJour exploserait), mais dhParKg reste null faute de kg.
  const series = [
    { salaire: 100, transport: 0, prime: 0, charges: 0, kg: 0 },
    { salaire: 100, transport: 0, prime: 0, charges: 0, kg: 0 },
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.nbJoursAvecDonnees, 2);
  assert.strictEqual(r.coutMoyenJour, 100);
  assert.strictEqual(r.dhParKgBrut, null);
});

test('computeNetDhParKg additionne récolte + logistique sur kg récolté', () => {
  const r = computeNetDhParKg(160, 40, 100);
  assert.strictEqual(r.dhParKgLog, 0.4);
  assert.strictEqual(r.dhParKgNet, 2); // (160+40)/100
  const empty = computeNetDhParKg(100, 50, 0);
  assert.strictEqual(empty.dhParKgLog, null);
  assert.strictEqual(empty.dhParKgNet, null);
});

// ── BUG #pMBZlx03 : DH/kg période = moyenne sur les jours de production ──────
test('dhParKgBrutProd exclut les journées cost-only (kg=0) du ratio', () => {
  // J1 {cout 1000, kg 100}, J2 {cout 1000, kg 100}, J3 {cout 1000, kg 0}.
  // Avant fix (toutes journées) : dhParKgBrut = 3000/200 = 15.
  // Après fix (jours kg>0 only) : dhParKgBrutProd = 2000/200 = 10.
  const series = [
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 100 },
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 100 },
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 0 }, // jour cost-only
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.dhParKgBrut, 15); // champ historique inchangé
  assert.strictEqual(r.dhParKgBrutProd, 10); // jours de production seulement
  assert.strictEqual(r.totalCoutProd, 2000);
  assert.strictEqual(r.totalKgProd, 200);
});

test('cas extrême : 1 jour productif + N jours cost-only → dh/kg non gonflé', () => {
  const series = [
    { salaire: 500, transport: 0, prime: 0, charges: 0, kg: 50 }, // seul jour productif
    { salaire: 800, transport: 0, prime: 0, charges: 0, kg: 0 },
    { salaire: 800, transport: 0, prime: 0, charges: 0, kg: 0 },
    { salaire: 800, transport: 0, prime: 0, charges: 0, kg: 0 },
  ];
  const r = aggregatePeriodKpis(series);
  // dh/kg = coût du seul jour productif / son kg = 500/50 = 10 (pas 2900/50=58).
  assert.strictEqual(r.dhParKgBrutProd, 10);
});

test('dhParKgBrutProd = null si aucun jour de production', () => {
  const series = [
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 0 },
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 0 },
  ];
  const r = aggregatePeriodKpis(series);
  assert.strictEqual(r.dhParKgBrutProd, null);
  assert.strictEqual(r.totalKgProd, 0);
});

test('computeNetDhParKgProd exclut les journées kg=0 (récolte + log)', () => {
  // J1 récolte {cout 1000, kg 100} + log {cout 200} → jour productif.
  // J2 récolte {cout 1000, kg 100} + log {cout 200} → jour productif.
  // J3 récolte {cout 1000, kg 0}   + log {cout 999} → exclu (kg=0).
  const recSeries = [
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 100 },
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 100 },
    { salaire: 1000, transport: 0, prime: 0, charges: 0, kg: 0 },
  ];
  const logSeries = [
    { salaire: 200, transport: 0, prime: 0, charges: 0, kg: 0 },
    { salaire: 200, transport: 0, prime: 0, charges: 0, kg: 0 },
    { salaire: 999, transport: 0, prime: 0, charges: 0, kg: 0 },
  ];
  const r = computeNetDhParKgProd(recSeries, logSeries);
  // kg prod = 200 ; coût récolte prod = 2000 ; coût log prod = 400 (J3 exclu).
  assert.strictEqual(r.totalKgProd, 200);
  assert.strictEqual(r.totalCoutRecolteProd, 2000);
  assert.strictEqual(r.totalLogCoutProd, 400);
  assert.strictEqual(r.dhParKgLog, 2); // 400/200
  assert.strictEqual(r.dhParKgNet, 12); // (2000+400)/200
});

test('computeNetDhParKgProd → null si aucun jour de production / séries vides', () => {
  const r = computeNetDhParKgProd(
    [{ salaire: 1000, kg: 0 }],
    [{ salaire: 200, kg: 0 }]
  );
  assert.strictEqual(r.dhParKgLog, null);
  assert.strictEqual(r.dhParKgNet, null);
  const empty = computeNetDhParKgProd([], []);
  assert.strictEqual(empty.dhParKgNet, null);
  const nulls = computeNetDhParKgProd(null, null);
  assert.strictEqual(nulls.dhParKgNet, null);
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
