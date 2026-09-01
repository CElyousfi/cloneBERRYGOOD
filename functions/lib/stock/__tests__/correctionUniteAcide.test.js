'use strict';

const test = require('node:test');
const assert = require('node:assert');

const corr = require('../correctionUniteAcide');

const CATALOGUE = [
  { id: 'IMP-001', nom: 'ACIDE SULFRIQUE (L)', active: true, unite: 'L' },
  { id: 'IMP-005', nom: 'AZO PRO 31', active: true, unite: 'kg' },
];

const SOLDES = [
  { docId: 'magasin_F2_ACIDE_SULFRIQUE', article_ref: 'ACIDE SULFRIQUE', lieu_type: 'magasin', lieu_id: 'F2', balance: 3420, unite: 'kg' },
  { docId: 'magasin_F2_ACIDE_SULFRIQUE_(L)', article_ref: 'ACIDE SULFRIQUE (L)', lieu_type: 'magasin', lieu_id: 'F2', balance: -8, unite: 'l' },
];

// ── LE FACTEUR EST UNE DÉCISION, PAS UN CALCUL ──────────────────────────────

test('le facteur est celui d\'Omar : 35 kg = 20 L', () => {
  assert.strictEqual(corr.FACTEUR_KG_PAR_LITRE, 1.75);
  assert.strictEqual(corr.FACTEUR_KG_PAR_LITRE, 35 / 20);
});

test('conversion litres -> kilos, au centième', () => {
  assert.strictEqual(corr.litresEnKilos(-8), -14);
  assert.strictEqual(corr.litresEnKilos(20), 35);
  assert.strictEqual(corr.litresEnKilos(0), 0);
  assert.strictEqual(corr.litresEnKilos(1), 1.75);
  assert.strictEqual(corr.litresEnKilos(3.33), 5.83);
  assert.strictEqual(corr.litresEnKilos(null), 0);
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
