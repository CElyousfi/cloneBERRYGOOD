'use strict';

/**
 * Sprint 3 — Avances : extractBeneficiaire + aggregateAvances
 * Run with: npm run test:unit
 *
 * TDD: ces tests sont écrits AVANT l'implémentation des fonctions.
 * Ils doivent être ROUGES dans le commit qui les introduit, et VERTS
 * dans le commit suivant qui ajoute la lib.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../public/lib/caisseUtils.js');

const NOW = new Date('2026-05-18T12:00:00Z');

// =============================================================================
// extractBeneficiaire — 16 cas (4 spec + 12 réel/edge)
// =============================================================================

test('extractBeneficiaire — 1. spec : "AVANCE ACHAT AYOUB TITI" → "AYOUB TITI"', () => {
  assert.equal(U.extractBeneficiaire('AVANCE ACHAT AYOUB TITI'), 'AYOUB TITI');
});

test('extractBeneficiaire — 2. spec : "Avance Mr AZZEDINE" → "AZZEDINE"', () => {
  assert.equal(U.extractBeneficiaire('Avance Mr AZZEDINE'), 'AZZEDINE');
});

test('extractBeneficiaire — 3. spec : "AVANCE HAMZA KARA" → "HAMZA KARA"', () => {
  assert.equal(U.extractBeneficiaire('AVANCE HAMZA KARA'), 'HAMZA KARA');
});

test('extractBeneficiaire — 4. spec : "Acompte Mohamed H." → "MOHAMED H."', () => {
  assert.equal(U.extractBeneficiaire('Acompte Mohamed H.'), 'MOHAMED H.');
});

test('extractBeneficiaire — 5. réel : coupe à DEMANDE PAR et strip A leading', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE A MBARKA RFISA "DEMANDE PAR MR OMAR"'),
    'MBARKA RFISA'
  );
});

test('extractBeneficiaire — 6. réel : strip Mr et coupe à DEMANDE PAR', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE Mr DABAZ DEMANDE PAR Mme BOUCHRA'),
    'DABAZ'
  );
});

test('extractBeneficiaire — 7. réel : SUR SALAIRE + Mr + DEMANDE PAR', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE SUR SALAIRE Mr DEBBAZ DEMANDE PAR Mr HASSAN'),
    'DEBBAZ'
  );
});

test('extractBeneficiaire — 8. réel : Sur Salaire (casse mixte)', () => {
  assert.equal(
    U.extractBeneficiaire('Avance Sur Salaire SBAYTRI FATIMA'),
    'SBAYTRI FATIMA'
  );
});

test('extractBeneficiaire — 9. réel : strip A leading + coupe à SUR', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE A KADDOUR DEBBAZ SUR LA LOCATION DE TERRAIN'),
    'KADDOUR DEBBAZ'
  );
});

test('extractBeneficiaire — 10. réel : purpose only "POUR INSTALATION" → null', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE POUR INSTALATION DE PLASTIQUE DES SERRES A F01'),
    null
  );
});

test('extractBeneficiaire — 11. réel : M.O collectif → null', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE M.O Réparation serres canariens'),
    null
  );
});

test('extractBeneficiaire — 12. réel : Vente AVOCAT (no person) → null', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE Vente AVOCAT "BACON/ZUTANO"'),
    null
  );
});

test('extractBeneficiaire — 13. réel : collectif numéroté → null (D1 adjusted)', () => {
  // "8 GARDIENNES D'AGADIR" : pas un bénéficiaire identifiable individuellement,
  // mieux dans le bucket "(Non identifiable)" que comme clé propre.
  assert.equal(
    U.extractBeneficiaire("AVANCE AU 8 GARDIENNES D'AGADIR"),
    null
  );
});

test('extractBeneficiaire — 14. edge : input vide/null/undefined → null', () => {
  assert.equal(U.extractBeneficiaire(''), null);
  assert.equal(U.extractBeneficiaire(null), null);
  assert.equal(U.extractBeneficiaire(undefined), null);
  assert.equal(U.extractBeneficiaire(123), null);
});

test('extractBeneficiaire — 15. edge : pas le mot-clé "avance/acompte" → null', () => {
  assert.equal(U.extractBeneficiaire('Achat de gasoil'), null);
  assert.equal(U.extractBeneficiaire('Paiement salaire'), null);
  assert.equal(U.extractBeneficiaire('40L GASOIL voiture'), null);
});

test('extractBeneficiaire — 16. réel : strip VERSE A + coupe à DEMANDE PAR', () => {
  assert.equal(
    U.extractBeneficiaire('AVANCE VERSE A ACHRAF DEMANDE PAR MME BOUCHRA'),
    'ACHRAF'
  );
});


// =============================================================================
// aggregateAvances
// =============================================================================

// Helper : tx d'avance minimaliste
function avTx(overrides) {
  return Object.assign({
    id: 'av-' + Math.random().toString(36).slice(2, 8),
    caisse_id: 'caisse_depenses',
    type: 'depense',
    montant: 1000,
    date: '2026-05-01',
    description: 'AVANCE HAMZA KARA',
    status: 'valide',
    code_analytique: 'BGF - BGF',
  }, overrides || {});
}

test('aggregateAvances — liste vide / input non-array → Map vide + unidentifiedCount = 0', () => {
  const r1 = U.aggregateAvances([]);
  assert.ok(r1.byBeneficiaire instanceof Map);
  assert.equal(r1.byBeneficiaire.size, 0);
  assert.equal(r1.unidentifiedCount, 0);

  const r2 = U.aggregateAvances(null);
  assert.equal(r2.byBeneficiaire.size, 0);
  assert.equal(r2.unidentifiedCount, 0);
});

test('aggregateAvances — ignore les transactions non-avance (description différente, type différent)', () => {
  const list = [
    avTx({ id: 'ok', description: 'AVANCE HAMZA' }),
    avTx({ id: 'no1', description: 'Achat gasoil' }),                  // pas avance
    avTx({ id: 'no2', description: 'AVANCE HAMZA', type: 'alimentation' }), // pas depense
    avTx({ id: 'no3', description: 'AVANCE HAMZA', status: 'brouillon' }),  // pas valide
  ];
  const r = U.aggregateAvances(list);
  assert.equal(r.byBeneficiaire.size, 1);
  assert.ok(r.byBeneficiaire.has('HAMZA'));
  const h = r.byBeneficiaire.get('HAMZA');
  assert.equal(h.avances.length, 1);
});

test('aggregateAvances — regroupe par bénéficiaire normalisé UPPERCASE', () => {
  const list = [
    avTx({ id: 'a', description: 'Avance Mr Ayoub TITI', montant: 500 }),
    avTx({ id: 'b', description: 'AVANCE AYOUB TITI',    montant: 700 }),
    avTx({ id: 'c', description: 'AVANCE HAMZA KARA',    montant: 1000 }),
  ];
  const r = U.aggregateAvances(list);
  assert.equal(r.byBeneficiaire.size, 2);
  const ayoub = r.byBeneficiaire.get('AYOUB TITI');
  assert.equal(ayoub.avances.length, 2);
  assert.equal(ayoub.totalAvance, 1200);
});

test('aggregateAvances — calcule totalAvance / totalRegularise / soldeDu', () => {
  const list = [
    avTx({ id: 'a', description: 'AVANCE HAMZA KARA', montant: 1000,
      regularisations: [{ montant: 300, ref: 'REG-1', regularise_at: Date.now() }] }),
    avTx({ id: 'b', description: 'AVANCE HAMZA KARA', montant: 500,
      regularisations: [{ montant: 500, ref: 'REG-2', regularise_at: Date.now() }] }), // soldée
    avTx({ id: 'c', description: 'AVANCE HAMZA KARA', montant: 800 }),                  // pas régularisée
  ];
  const r = U.aggregateAvances(list);
  const h = r.byBeneficiaire.get('HAMZA KARA');
  assert.equal(h.totalAvance,      1000 + 500 + 800);  // 2300
  assert.equal(h.totalRegularise,  300 + 500);          // 800
  assert.equal(h.soldeDu,          1500);                // 2300 - 800
});

test('aggregateAvances — ancienneté = date de la PLUS VIEILLE avance avec solde > 0', () => {
  const list = [
    // Plus vieille avance non régularisée
    avTx({ id: 'old', description: 'AVANCE HAMZA',  date: '2026-01-15', montant: 500 }),
    // Avance plus récente soldée → ignorée pour l'ancienneté
    avTx({ id: 'mid', description: 'AVANCE HAMZA',  date: '2026-03-01', montant: 200,
      regularisations: [{ montant: 200 }] }),
    // Plus récente non régularisée
    avTx({ id: 'new', description: 'AVANCE HAMZA',  date: '2026-05-01', montant: 100 }),
  ];
  const r = U.aggregateAvances(list, NOW);
  const h = r.byBeneficiaire.get('HAMZA');
  assert.equal(h.ancienneteDate, '2026-01-15');
  // ancienneté en jours (NOW = 2026-05-18, oldest = 2026-01-15 → ~123 jours)
  assert.ok(h.ancienneteJours >= 120 && h.ancienneteJours <= 125,
    `expected ~123, got ${h.ancienneteJours}`);
});

test('aggregateAvances — ancienneté null quand toutes les avances sont soldées', () => {
  const list = [
    avTx({ id: 'a', description: 'AVANCE HAMZA', montant: 500,
      regularisations: [{ montant: 500 }] }),
    avTx({ id: 'b', description: 'AVANCE HAMZA', montant: 200,
      regularisations: [{ montant: 100 }, { montant: 100 }] }), // soldée en 2 fois
  ];
  const r = U.aggregateAvances(list, NOW);
  const h = r.byBeneficiaire.get('HAMZA');
  assert.equal(h.soldeDu,         0);
  assert.equal(h.ancienneteJours, null);
  assert.equal(h.ancienneteDate,  null);
});

test('aggregateAvances — régularisation partielle (somme < montant)', () => {
  const list = [
    avTx({ id: 'a', description: 'AVANCE AYOUB', montant: 1000,
      regularisations: [{ montant: 300 }, { montant: 200 }] }),
  ];
  const r = U.aggregateAvances(list);
  const a = r.byBeneficiaire.get('AYOUB');
  assert.equal(a.totalRegularise, 500);
  assert.equal(a.soldeDu,         500);
});

test('aggregateAvances — unidentifiedCount compte les avances sans bénéficiaire', () => {
  const list = [
    avTx({ id: 'ok',  description: 'AVANCE HAMZA KARA',         montant: 100 }),
    avTx({ id: 'no1', description: 'AVANCE POUR INSTALATION',   montant: 200 }),
    avTx({ id: 'no2', description: 'AVANCE M.O Réparation',     montant: 150 }),
    avTx({ id: 'no3', description: 'AVANCE AU 8 GARDIENNES',    montant: 80  }),
  ];
  const r = U.aggregateAvances(list);
  assert.equal(r.byBeneficiaire.size, 1);
  assert.equal(r.unidentifiedCount,   3);
});

test('aggregateAvances — nb avances exact par bénéficiaire (count = total)', () => {
  const list = [
    avTx({ id: 'a1', description: 'AVANCE HAMZA', montant: 100 }),
    avTx({ id: 'a2', description: 'AVANCE HAMZA', montant: 200 }),
    avTx({ id: 'a3', description: 'AVANCE HAMZA', montant: 300 }),
  ];
  const r = U.aggregateAvances(list);
  const h = r.byBeneficiaire.get('HAMZA');
  assert.equal(h.avances.length, 3);
  assert.equal(h.totalAvance,    600);
});

test('aggregateAvances — filtre soldées (showSoldees=false par défaut)', () => {
  const list = [
    avTx({ id: 'open',   description: 'AVANCE HAMZA',  montant: 500 }),
    avTx({ id: 'closed', description: 'AVANCE MOHAMED', montant: 200,
      regularisations: [{ montant: 200 }] }),
  ];
  const r1 = U.aggregateAvances(list); // defaults
  // HAMZA: solde > 0 → présent
  // MOHAMED: solde = 0 → caché par défaut
  assert.ok(r1.byBeneficiaire.has('HAMZA'));
  assert.ok(!r1.byBeneficiaire.has('MOHAMED'));

  const r2 = U.aggregateAvances(list, undefined, { showSoldees: true });
  assert.ok(r2.byBeneficiaire.has('HAMZA'));
  assert.ok(r2.byBeneficiaire.has('MOHAMED'));
});

test('aggregateAvances — dataset mock de 10 avances avec régularisations partielles (intégration)', () => {
  const list = [
    avTx({ id: 'a1', description: 'AVANCE HAMZA KARA',  date: '2026-02-01', montant: 1000,
      regularisations: [{ montant: 400 }] }),                                       // solde 600
    avTx({ id: 'a2', description: 'AVANCE HAMZA KARA',  date: '2026-03-15', montant: 500 }), // 500
    avTx({ id: 'a3', description: 'Avance Mr AZZEDINE', date: '2026-04-10', montant: 800,
      regularisations: [{ montant: 800 }] }),                                       // 0 (soldée)
    avTx({ id: 'a4', description: 'AVANCE AYOUB TITI',  date: '2026-04-20', montant: 600 }), // 600
    avTx({ id: 'a5', description: 'AVANCE AYOUB TITI',  date: '2026-05-01', montant: 400,
      regularisations: [{ montant: 200 }, { montant: 100 }] }),                     // solde 100
    avTx({ id: 'a6', description: 'AVANCE HAMZA KARA',  date: '2026-05-05', montant: 300 }), // 300
    avTx({ id: 'a7', description: 'Acompte Mohamed H.', date: '2026-05-10', montant: 200,
      regularisations: [{ montant: 50 }] }),                                        // solde 150
    avTx({ id: 'a8', description: 'AVANCE POUR INSTALATION', date: '2026-05-12', montant: 700 }), // not identified
    avTx({ id: 'a9', description: 'AVANCE M.O',         date: '2026-05-14', montant: 100 }),     // not identified
    avTx({ id: 'a10', description: 'Achat gasoil',      date: '2026-05-15', montant: 200 }),     // pas avance
  ];
  const r = U.aggregateAvances(list, NOW);
  // 4 bénéficiaires identifiés visibles (HAMZA KARA, AYOUB TITI, MOHAMED H.) + AZZEDINE caché (soldé)
  assert.equal(r.byBeneficiaire.size, 3);
  assert.equal(r.unidentifiedCount,   2); // a8 + a9
  // HAMZA KARA : 3 avances (a1+a2+a6) → total 1800, régul 400, solde 1400
  const hk = r.byBeneficiaire.get('HAMZA KARA');
  assert.equal(hk.avances.length, 3);
  assert.equal(hk.totalAvance,    1800);
  assert.equal(hk.totalRegularise, 400);
  assert.equal(hk.soldeDu,        1400);
  // AYOUB TITI : 2 avances → total 1000, régul 300, solde 700
  const at = r.byBeneficiaire.get('AYOUB TITI');
  assert.equal(at.totalAvance, 1000);
  assert.equal(at.soldeDu, 700);
  // MOHAMED H. : 1 avance partielle
  const mh = r.byBeneficiaire.get('MOHAMED H.');
  assert.equal(mh.totalAvance, 200);
  assert.equal(mh.soldeDu, 150);
});
