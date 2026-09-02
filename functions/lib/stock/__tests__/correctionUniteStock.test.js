'use strict';

const test = require('node:test');
const assert = require('node:assert');

const corr = require('../correctionUniteStock');

const CATALOGUE = [
  { id: 'IMP-001', nom: 'ACIDE SULFRIQUE (L)', active: true, unite: 'L' },
  { id: 'IMP-005', nom: 'AZO PRO 31', active: true, unite: 'kg' },
  { id: 'Ref-Eng0056', nom: 'Rhizo amine', active: true, unite: 'KG' },
];

const SOLDES = [
  { docId: 'magasin_F2_ACIDE_SULFRIQUE', article_ref: 'ACIDE SULFRIQUE', lieu_type: 'magasin', lieu_id: 'F2', balance: 3420, unite: 'kg' },
  { docId: 'magasin_F2_ACIDE_SULFRIQUE_(L)', article_ref: 'ACIDE SULFRIQUE (L)', lieu_type: 'magasin', lieu_id: 'F2', balance: -8, unite: 'l' },
];

// ── LE FACTEUR EST UNE DÉCISION, PAS UN CALCUL ──────────────────────────────

test('chaque facteur est celui d\'Omar, article par article', () => {
  const acide = corr.conversionArbitree('IMP-001');
  assert.strictEqual(acide.kg, 35);
  assert.strictEqual(acide.litres, 20);
  assert.strictEqual(acide.facteur, 1.75);
  const rhizo = corr.conversionArbitree('Ref-Eng0056');
  assert.strictEqual(rhizo.kg, 20);
  assert.strictEqual(rhizo.litres, 18);
  assert.strictEqual(rhizo.facteur, 20 / 18);
});

test('LE SENS du facteur : 20 kg = 18 L => un litre pèse PLUS d\'un kilo', () => {
  // L'inversion (18/20 au lieu de 20/18) est silencieuse et coûte 23,5 %.
  // Elle doit être impossible à commettre sans faire rougir ce test.
  const r = corr.conversionArbitree('Ref-Eng0056');
  assert.ok(r.facteur > 1, 'facteur inversé : ' + r.facteur);
  assert.strictEqual(Math.round(r.facteur * 1e6) / 1e6, 1.111111);
  assert.notStrictEqual(Math.round(r.facteur * 100) / 100, 0.9);
});

test('aucune conversion par défaut — une fiche hors table est refusée', () => {
  assert.strictEqual(corr.conversionArbitree('IMP-999'), null);
  assert.strictEqual(corr.conversionArbitree(''), null);
  assert.strictEqual(corr.conversionArbitree(null), null);
});

test('conversion litres -> kilos, au centième, avec le facteur ARBITRÉ', () => {
  const acide = corr.conversionArbitree('IMP-001').facteur;
  assert.strictEqual(corr.litresEnKilos(-8, acide), -14);
  assert.strictEqual(corr.litresEnKilos(20, acide), 35);
  assert.strictEqual(corr.litresEnKilos(0, acide), 0);
  assert.strictEqual(corr.litresEnKilos(3.33, acide), 5.83);
  assert.strictEqual(corr.litresEnKilos(null, acide), 0);
  const rhizo = corr.conversionArbitree('Ref-Eng0056').facteur;
  assert.strictEqual(corr.litresEnKilos(-25.1, rhizo), -27.89, 'le cas réel de Station F5');
  assert.strictEqual(corr.litresEnKilos(18, rhizo), 20, 'la table d\'Omar, telle quelle');
});

test('litresEnKilos sans facteur — lève, ne convertit pas au hasard', () => {
  assert.throws(() => corr.litresEnKilos(10), /facteur/);
  assert.throws(() => corr.litresEnKilos(10, 0), /facteur/);
  assert.throws(() => corr.litresEnKilos(10, -1), /facteur/);
});

test('les facteurs ne se contaminent PAS d\'un article à l\'autre', () => {
  const a = corr.conversionArbitree('IMP-001').facteur;
  const r = corr.conversionArbitree('Ref-Eng0056').facteur;
  assert.notStrictEqual(a, r);
  assert.strictEqual(corr.litresEnKilos(-25.1, a), -43.92, 'le facteur acide sur la Rhizo serait faux');
  assert.strictEqual(corr.litresEnKilos(-25.1, r), -27.89);
});

// ── LE CAS RÉEL ─────────────────────────────────────────────────────────────

test('plan complet — la fiche passe au kg, le fragment litres devient -14 kg', () => {
  const p = corr.planifierCorrection({
    ficheId: 'IMP-001',
    nouveauNom: 'ACIDE SULFRIQUE',
    soldes: SOLDES,
    fiches: CATALOGUE,
  });
  assert.strictEqual(p.ok, true, p.refus.join(' | '));
  assert.strictEqual(p.fiche.unite_avant, 'L');
  assert.strictEqual(p.fiche.unite_apres, 'kg');
  assert.strictEqual(p.fiche.nom_apres, 'ACIDE SULFRIQUE');
  assert.strictEqual(p.conversions.length, 1);
  assert.strictEqual(p.conversions[0].docId, 'magasin_F2_ACIDE_SULFRIQUE_(L)');
  assert.strictEqual(p.conversions[0].balance_avant, -8);
  assert.strictEqual(p.conversions[0].balance_apres, -14);
  assert.strictEqual(p.conversions[0].unite_apres, 'kg');
  assert.strictEqual(p.facteur, 1.75);
  assert.match(p.decision, /35 kg = 20 L/);
  assert.strictEqual(p.inchanges.length, 1, 'le solde déjà en kg n\'est pas touché');
  assert.strictEqual(p.inchanges[0].balance, 3420);
});

test('le solde en kg n\'est JAMAIS reconverti', () => {
  const p = corr.planifierCorrection({ ficheId: 'IMP-001', nouveauNom: 'ACIDE SULFRIQUE', soldes: SOLDES, fiches: CATALOGUE });
  const ids = p.conversions.map((c) => c.docId);
  assert.ok(!ids.includes('magasin_F2_ACIDE_SULFRIQUE'), '3 420 kg × 1,75 serait une catastrophe');
});

test('la somme résultante vaut 3 406 kg', () => {
  const p = corr.planifierCorrection({ ficheId: 'IMP-001', nouveauNom: 'ACIDE SULFRIQUE', soldes: SOLDES, fiches: CATALOGUE });
  const total = p.conversions.reduce((n, c) => n + c.balance_apres, 0) + p.inchanges.reduce((n, i) => n + i.balance, 0);
  assert.strictEqual(total, 3406);
});

// ── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test('fiche absente — REFUS', () => {
  const p = corr.planifierCorrection({ ficheId: 'INEXISTANT', nouveauNom: 'X', soldes: [], fiches: CATALOGUE });
  assert.strictEqual(p.ok, false);
  assert.match(p.refus[0], /introuvable/);
});

test('renommage qui déplace l\'identité canonique — REFUS', () => {
  const v = corr.verifierRenommage('IMP-001', 'ACIDE SULFRIQUE (L)', 'ACIDE CHLORHYDRIQUE', CATALOGUE);
  assert.strictEqual(v.ok, false);
  assert.match(v.motif, /déplacerait l'identité/);
  const p = corr.planifierCorrection({ ficheId: 'IMP-001', nouveauNom: 'ACIDE CHLORHYDRIQUE', soldes: SOLDES, fiches: CATALOGUE });
  assert.strictEqual(p.ok, false);
});

test('renommage qui fabriquerait une AMBIGUÏTÉ — REFUS', () => {
  const cat = CATALOGUE.concat([{ id: 'IMP-999', nom: 'Acide  Sulfrique', active: true }]);
  const v = corr.verifierRenommage('IMP-001', 'ACIDE SULFRIQUE (L)', 'ACIDE SULFRIQUE', cat);
  assert.strictEqual(v.ok, false);
  assert.match(v.motif, /ambiguïté/);
});

test('renommage sûr — canon identique avant et après', () => {
  const v = corr.verifierRenommage('IMP-001', 'ACIDE SULFRIQUE (L)', 'ACIDE SULFRIQUE', CATALOGUE);
  assert.strictEqual(v.ok, true);
});

test('nouveau nom vide — REFUS', () => {
  assert.strictEqual(corr.verifierRenommage('IMP-001', 'ACIDE SULFRIQUE (L)', '   ', CATALOGUE).ok, false);
});

test('fiche sans conversion arbitree — REFUS, un facteur ne s\'invente pas', () => {
  const p = corr.planifierCorrection({
    ficheId: 'IMP-005',
    nouveauNom: 'AZO PRO 31',
    soldes: [{ docId: 'x', balance: 5, unite: 'l' }],
    fiches: CATALOGUE,
  });
  assert.strictEqual(p.ok, false);
  assert.match(p.refus[0], /aucune conversion/);
  assert.strictEqual(p.conversions.length, 0);
});

test('le cas réel Rhizo amine — -25,1 l devient -27,89 kg', () => {
  const p = corr.planifierCorrection({
    ficheId: 'Ref-Eng0056',
    nouveauNom: 'Rhizo amine',
    soldes: [
      { docId: 'station_Station_F5_Ref-Eng0056', balance: -25.1, unite: 'l' },
      { docId: 'station_Station_F5_Rhizo_amine', balance: -82.55, unite: 'kg' },
    ],
    fiches: CATALOGUE,
  });
  assert.strictEqual(p.ok, true, p.refus.join(' | '));
  assert.strictEqual(p.conversions.length, 1);
  assert.strictEqual(p.conversions[0].balance_apres, -27.89);
  assert.strictEqual(p.inchanges[0].balance, -82.55, 'le fragment kg n\'est pas retouche');
  const total = p.conversions[0].balance_apres + p.inchanges[0].balance;
  assert.strictEqual(Math.round(total * 100) / 100, -110.44);
});

test('unité sans facteur arbitré — REFUS, on ne convertit pas au jugé', () => {
  const p = corr.planifierCorrection({
    ficheId: 'IMP-001',
    nouveauNom: 'ACIDE SULFRIQUE',
    soldes: [{ docId: 'x', balance: 5, unite: 'sac' }],
    fiches: CATALOGUE,
  });
  assert.strictEqual(p.ok, false);
  assert.match(p.refus[0], /aucun facteur de conversion n'a été arbitré/);
});

test('unités écrites autrement (L majuscule, espaces) — reconnues', () => {
  const p = corr.planifierCorrection({
    ficheId: 'IMP-001',
    nouveauNom: 'ACIDE SULFRIQUE',
    soldes: [{ docId: 'a', balance: -8, unite: ' L ' }, { docId: 'b', balance: 10, unite: 'KG' }],
    fiches: CATALOGUE,
  });
  assert.strictEqual(p.ok, true, p.refus.join(' | '));
  assert.strictEqual(p.conversions.length, 1);
  assert.strictEqual(p.conversions[0].balance_apres, -14);
  assert.strictEqual(p.inchanges.length, 1);
});
