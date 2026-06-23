'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  deriveTauxTva,
  buildFactureLines,
  parseFactureDate,
  campaignBounds,
  isWithinPeriod,
  normalizeDesignation,
  matchProduitTaxable,
  deriveTauxLigne,
  reconciliationEpsilon,
  parseSaisiTaux,
  resolveTauxLigne,
  ANOMALIE_TVA_B,
  INFO_TVA_NON_SAISIE,
} = require('../../public/lib/factureExportUtils.js');

const sumLineTva = (lines) =>
  Math.round(lines.reduce((s, l) => s + (l.montant_tva || 0), 0) * 100) / 100;

// ============================================================================
// deriveTauxTva — snap aux taux standards (conservé pour la ligne globale)
// ============================================================================
test('deriveTauxTva — snap 20%', () => {
  const r = deriveTauxTva(1000, 200);
  assert.strictEqual(r.rate, 0.2);
  assert.strictEqual(r.nonStandard, false);
});

test('deriveTauxTva — snap 0% (pas de TVA)', () => {
  const r = deriveTauxTva(1000, 0);
  assert.strictEqual(r.rate, 0);
  assert.strictEqual(r.nonStandard, false);
});

test('deriveTauxTva — taux non standard flaggé', () => {
  const r = deriveTauxTva(1000, 180);
  assert.strictEqual(r.nonStandard, true);
  assert.ok(Math.abs(r.rate - 0.18) < 1e-9);
});

// ============================================================================
// [CODE MORT] normalizeDesignation / deriveTauxLigne — conservés mais NON
// utilisés dans le calcul du taux ligne (devinette abandonnée v5). On garde
// quelques tests de non-régression de ces helpers archives.
// ============================================================================
test('[archive] normalizeDesignation — accents/casse/AC. (helper conservé)', () => {
  assert.strictEqual(normalizeDesignation('Acide nitrique 60%'), 'ACIDE NITRIQUE 60%');
  assert.strictEqual(normalizeDesignation('AC. NITRIQUE'), 'ACIDE NITRIQUE');
  assert.strictEqual(normalizeDesignation(null), '');
});

test('[archive] deriveTauxLigne — helper conservé mais NON branché', () => {
  // Ces helpers existent encore (référence historique) mais ne pilotent PLUS le
  // taux ligne : voir resolveTauxLigne / buildFactureLines (taux saisi seul).
  assert.strictEqual(deriveTauxLigne('Acide nitrique 60%'), 20);
  assert.strictEqual(matchProduitTaxable('Engrais foliaire'), false);
});

// ============================================================================
// parseSaisiTaux — distingue "saisi" (0 compris) de "non saisi"
// ============================================================================
test('parseSaisiTaux — non saisi (null/undefined/"" / non num)', () => {
  assert.deepStrictEqual(parseSaisiTaux(null), { saisi: false, rate: 0 });
  assert.deepStrictEqual(parseSaisiTaux(undefined), { saisi: false, rate: 0 });
  assert.deepStrictEqual(parseSaisiTaux(''), { saisi: false, rate: 0 });
  assert.deepStrictEqual(parseSaisiTaux('   '), { saisi: false, rate: 0 });
  assert.deepStrictEqual(parseSaisiTaux('abc'), { saisi: false, rate: 0 });
});

test('parseSaisiTaux — taux saisi en pourcentage entier (0/7/10/14/20)', () => {
  assert.deepStrictEqual(parseSaisiTaux(0), { saisi: true, rate: 0 });
  assert.deepStrictEqual(parseSaisiTaux(7), { saisi: true, rate: 0.07 });
  assert.deepStrictEqual(parseSaisiTaux(10), { saisi: true, rate: 0.1 });
  assert.deepStrictEqual(parseSaisiTaux(14), { saisi: true, rate: 0.14 });
  assert.deepStrictEqual(parseSaisiTaux(20), { saisi: true, rate: 0.2 });
});

test('parseSaisiTaux — fraction et strings numériques acceptées', () => {
  assert.deepStrictEqual(parseSaisiTaux(0.2), { saisi: true, rate: 0.2 });
  assert.deepStrictEqual(parseSaisiTaux('20'), { saisi: true, rate: 0.2 });
  assert.deepStrictEqual(parseSaisiTaux('20%'), { saisi: true, rate: 0.2 });
  assert.deepStrictEqual(parseSaisiTaux('0'), { saisi: true, rate: 0 });
});

// ============================================================================
// resolveTauxLigne — v5 : taux SAISI uniquement, sinon NON DÉTERMINÉ (null)
// ============================================================================
test('resolveTauxLigne — taux saisi utilisé tel quel (0/7/10/14/20)', () => {
  assert.deepStrictEqual(resolveTauxLigne({ article: 'X', taux_tva: 0 }), { rate: 0, source: 'saisi' });
  assert.deepStrictEqual(resolveTauxLigne({ article: 'X', taux_tva: 7 }), { rate: 0.07, source: 'saisi' });
  assert.deepStrictEqual(resolveTauxLigne({ article: 'X', taux_tva: 10 }), { rate: 0.1, source: 'saisi' });
  assert.deepStrictEqual(resolveTauxLigne({ article: 'X', taux_tva: 14 }), { rate: 0.14, source: 'saisi' });
  assert.deepStrictEqual(resolveTauxLigne({ article: 'X', taux_tva: 20 }), { rate: 0.2, source: 'saisi' });
});

test('resolveTauxLigne — taux absent/null → NON DÉTERMINÉ (rate null), PLUS de devinette', () => {
  assert.deepStrictEqual(resolveTauxLigne({ article: 'Acide sulfurique', taux_tva: null }), { rate: null, source: 'non_determine' });
  assert.deepStrictEqual(resolveTauxLigne({ article: 'Acide nitrique' }), { rate: null, source: 'non_determine' });
  // PREUVE anti-devinette : un ex-"acide nitrique" sans taux saisi n'est PLUS 20%.
  assert.notStrictEqual(resolveTauxLigne({ article: 'acide nitrique 60%' }).rate, 0.2);
});

// ============================================================================
// buildFactureLines — v5 : taux saisi uniquement, 3 états
// ============================================================================

// --- CAS 1a : toutes lignes saisies, Σ colle → RÉCONCILIÉ ---
test('buildFactureLines — tout saisi qui colle → réconcilié, Σtva=TTC−HT', () => {
  const fac = {
    total_ht: 1800, total_tva: 200, total_ttc: 2000,
    items: [
      { article: 'Engrais NPK', montant_ht: 800, taux_tva: 0 },
      { article: 'Acide sulfurique', montant_ht: 1000, taux_tva: 20 },
    ],
  };
  const r = buildFactureLines(fac);
  assert.strictEqual(r.reconciled, true);
  assert.strictEqual(r.allSaisi, true);
  assert.strictEqual(r.hasUndeterminedLine, false);
  assert.strictEqual(r.anomalieType, null);
  assert.strictEqual(r.anomalieLabel, '');
  assert.strictEqual(r.isMultiTaux, true);
  assert.strictEqual(r.tvaBase, 200);
  assert.strictEqual(sumLineTva(r.lines), 200);
  assert.ok(r.lines.every((l) => l.taux_source === 'saisi'));
});

test('buildFactureLines — taux saisi 0% (exonéré explicite) respecté', () => {
  const fac = {
    total_ht: 1000, total_tva: 0, total_ttc: 1000,
    items: [{ article: 'Acide nitrique 60%', montant_ht: 1000, taux_tva: 0 }],
  };
  const r = buildFactureLines(fac);
  assert.strictEqual(r.reconciled, true);
  assert.strictEqual(r.allSaisi, true);
  assert.strictEqual(r.lines[0].taux_tva, 0);
  assert.strictEqual(r.lines[0].taux_source, 'saisi');
  assert.strictEqual(sumLineTva(r.lines), 0);
});

test('buildFactureLines — tout saisi 20% (montants non ronds) → résidu logé, Σ exact', () => {
  const fac = {
    total_ht: 1000, total_tva: 200, total_ttc: 1200,
    items: [
      { article: 'A', montant_ht: 333.33, taux_tva: 20 },
      { article: 'B', montant_ht: 333.33, taux_tva: 20 },
      { article: 'C', montant_ht: 333.34, taux_tva: 20 },
    ],
  };
  const r = buildFactureLines(fac);
  assert.strictEqual(r.reconciled, true);
  assert.strictEqual(sumLineTva(r.lines), 200);
});

// --- CAS 1b : toutes lignes saisies mais Σ ne colle pas → FLAG "Incohérence saisie" (B) ---
test('buildFactureLines — tout saisi mais Σ ≠ base → "Incohérence saisie" (B), total préservé', () => {
  const fac = {
    total_ht: 1000, total_tva: 350, total_ttc: 1350,
    items: [
      { article: 'Produit X', montant_ht: 500, taux_tva: 20 },
      { article: 'Produit Y', montant_ht: 500, taux_tva: 20 },
    ],
  };
  const r = buildFactureLines(fac);
  assert.strictEqual(r.reconciled, false);
  assert.strictEqual(r.allSaisi, true);
  assert.strictEqual(r.hasUndeterminedLine, false);
  assert.strictEqual(r.anomalieType, 'B');
  assert.strictEqual(r.anomalieLabel, ANOMALIE_TVA_B);
  assert.ok(r.lines.every((l) => l.reconciled === false));
  // Total facture préservé malgré l'anomalie.
  assert.strictEqual(r.tvaBase, 350);
  assert.strictEqual(sumLineTva(r.lines), 350);
});

// --- CAS 2 : ≥ 1 ligne sans taux saisi → INFORMATIF "TVA par ligne non saisie" ---
test('buildFactureLines — ligne null → "non déterminé" (PAS 0, PAS devinée)', () => {
  const fac = {
    total_ht: 1000, total_tva: 200, total_ttc: 1200,
    items: [{ article: 'Acide nitrique 60%', montant_ht: 1000, taux_tva: null }],
  };
  const r = buildFactureLines(fac);
  assert.strictEqual(r.lines[0].taux_source, 'non_determine');
  assert.strictEqual(r.lines[0].taux_tva, null);
  assert.strictEqual(r.lines[0].montant_tva, null);
  assert.strictEqual(r.lines[0].montant_ttc, null);
  // PREUVE : pas de devinette à 20% pour un ex-"acide".
  assert.notStrictEqual(r.lines[0].taux_tva, 0.2);
  assert.notStrictEqual(r.lines[0].taux_tva, 0);
});

test('buildFactureLines — ≥1 ligne null → INFO "TVA par ligne non saisie", total facture exact', () => {
  const fac = {
    total_ht: 2000, total_tva: 270, total_ttc: 2270,
    items: [
      { article: 'Engrais foliaire', montant_ht: 1000, taux_tva: 7 },
      { article: 'Acide sulfurique', montant_ht: 1000, taux_tva: null },
    ],
  };
  const r = buildFactureLines(fac);
  assert.strictEqual(r.reconciled, false);
  assert.strictEqual(r.hasUndeterminedLine, true);
  assert.strictEqual(r.allSaisi, false);
  assert.strictEqual(r.anomalieType, 'info');
  assert.strictEqual(r.anomalieLabel, INFO_TVA_NON_SAISIE);
  // Distinct d'une vraie anomalie B.
  assert.notStrictEqual(r.anomalieLabel, ANOMALIE_TVA_B);
  // La ligne saisie garde son taux/TVA normalement.
  const saisie = r.lines.find((l) => l.taux_source === 'saisi');
  assert.strictEqual(saisie.taux_tva, 0.07);
  assert.strictEqual(saisie.montant_tva, 70);
  // La ligne non saisie est "—" (null), aucune répartition inventée.
  const nd = r.lines.find((l) => l.taux_source === 'non_determine');
  assert.strictEqual(nd.taux_tva, null);
  assert.strictEqual(nd.montant_tva, null);
  // Le total facture (TTC−HT) reste exact via le récap.
  assert.strictEqual(r.tvaBase, 270);
});

test('buildFactureLines — montant_ht null → quantite × prix_unitaire (taux saisi)', () => {
  const fac = {
    total_ht: 500, total_tva: 100, total_ttc: 600,
    items: [{ article: 'Acide sulfurique', quantite: 5, prix_unitaire: 100, montant_ht: null, taux_tva: 20 }],
  };
  const { lines } = buildFactureLines(fac);
  assert.strictEqual(lines[0].montant_ht, 500);
  assert.strictEqual(lines[0].montant_tva, 100);
});

test('buildFactureLines — sans items → ligne (non détaillé), INFO non saisie, taux/TVA = "—"', () => {
  const fac = { total_ht: 800, total_tva: 160, total_ttc: 960, items: [] };
  const r = buildFactureLines(fac);
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].designation, '(non détaillé)');
  assert.strictEqual(r.lines[0].montant_ht, 800);
  assert.strictEqual(r.lines[0].taux_tva, null);
  assert.strictEqual(r.lines[0].montant_tva, null);
  assert.strictEqual(r.lines[0].montant_ttc, null);
  assert.strictEqual(r.anomalieType, 'info');
  assert.strictEqual(r.anomalieLabel, INFO_TVA_NON_SAISIE);
  // tvaBase connue (TTC−HT) même si non ventilée.
  assert.strictEqual(r.tvaBase, 160);
});

test('reconciliationEpsilon — proportionnel au nb de lignes, plancher 0,02', () => {
  assert.strictEqual(reconciliationEpsilon(1), 0.02);
  assert.strictEqual(reconciliationEpsilon(2), 0.02);
  assert.strictEqual(reconciliationEpsilon(10), 0.05);
});

// ============================================================================
// parseFactureDate — ISO + DD/MM/YYYY
// ============================================================================
test('parseFactureDate — ISO YYYY-MM-DD', () => {
  const d = parseFactureDate('2025-07-15');
  assert.strictEqual(d.getFullYear(), 2025);
  assert.strictEqual(d.getMonth(), 6);
  assert.strictEqual(d.getDate(), 15);
});

test('parseFactureDate — français DD/MM/YYYY', () => {
  const d = parseFactureDate('15/07/2025');
  assert.strictEqual(d.getFullYear(), 2025);
  assert.strictEqual(d.getMonth(), 6);
  assert.strictEqual(d.getDate(), 15);
});

test('parseFactureDate — invalide → null', () => {
  assert.strictEqual(parseFactureDate(''), null);
  assert.strictEqual(parseFactureDate('pas une date'), null);
  assert.strictEqual(parseFactureDate(null), null);
});

// ============================================================================
// campaignBounds + isWithinPeriod — campagne paramétrable
// ============================================================================
test('campaignBounds — 2025 → juil 2025 à juin 2026', () => {
  const { start, end, label } = campaignBounds(2025);
  assert.strictEqual(label, '2025-2026');
  assert.strictEqual(start.getFullYear(), 2025);
  assert.strictEqual(start.getMonth(), 6);
  assert.strictEqual(start.getDate(), 1);
  assert.strictEqual(end.getFullYear(), 2026);
  assert.strictEqual(end.getMonth(), 5);
  assert.strictEqual(end.getDate(), 30);
});

test('isWithinPeriod — bornes campagne 25-26 inclusives', () => {
  const { start, end } = campaignBounds(2025);
  assert.strictEqual(isWithinPeriod('2025-07-01', start, end), true);
  assert.strictEqual(isWithinPeriod('30/06/2026', start, end), true);
  assert.strictEqual(isWithinPeriod('2025-06-30', start, end), false);
  assert.strictEqual(isWithinPeriod('01/07/2026', start, end), false);
  assert.strictEqual(isWithinPeriod('15/12/2025', start, end), true);
  assert.strictEqual(isWithinPeriod('', start, end), false);
});
