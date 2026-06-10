const test = require('node:test');
const assert = require('node:assert/strict');

const { countDistinctByFermeType } = require('../../functions/lib/pointage/countDistinctByFermeType');

const FERMES = ['F1', 'F5', 'Avocatier', 'BAHIA'];

test('un ouvrier réparti sur 3 parcelles est compté 1 seule fois', () => {
  // Même matricule, même ferme/type, 3 lignes (3 parcelles) → distinct = 1
  const lines = [
    { matricule: 'A', ferme: 'F5', type: 'postesFixes', cout: 10 },
    { matricule: 'A', ferme: 'F5', type: 'postesFixes', cout: 10 },
    { matricule: 'A', ferme: 'F5', type: 'postesFixes', cout: 10 },
  ];
  const r = countDistinctByFermeType(lines, FERMES);
  assert.equal(r.F5.postesFixes, 1);
  assert.equal(r.F5.total, 1);
  assert.equal(r.F5.cout, 30); // coût = somme, inchangé
});

test('deux ouvriers distincts → compté 2 fois', () => {
  const lines = [
    { matricule: 'A', ferme: 'F5', type: 'postesFixes', cout: 5 },
    { matricule: 'B', ferme: 'F5', type: 'postesFixes', cout: 5 },
  ];
  const r = countDistinctByFermeType(lines, FERMES);
  assert.equal(r.F5.postesFixes, 2);
  assert.equal(r.F5.total, 2);
  assert.equal(r.F5.cout, 10);
});

test('cas du bug : 13 ouvriers sur plusieurs parcelles ne donnent pas 33', () => {
  // 13 ouvriers, chacun réparti sur 2 ou 3 lignes (parcelles) → ancien code aurait
  // sommé > 13 ; le distinct doit rester 13.
  const lines = [];
  for (let i = 0; i < 13; i++) {
    const m = 'OUV' + i;
    lines.push({ matricule: m, ferme: 'F5', type: 'postesFixes', cout: 1 });
    lines.push({ matricule: m, ferme: 'F5', type: 'postesFixes', cout: 1 });
    if (i % 2 === 0) lines.push({ matricule: m, ferme: 'F5', type: 'postesFixes', cout: 1 });
  }
  const r = countDistinctByFermeType(lines, FERMES);
  assert.equal(r.F5.postesFixes, 13);
  assert.equal(r.F5.total, 13);
});

test('total = ouvriers distincts toutes catégories (pas la somme des types)', () => {
  // Un même matricule a 2 types le même jour → recolte=1, horsRecolte=1
  // mais total=1 (Set ferme global), pas 2.
  const lines = [
    { matricule: 'A', ferme: 'F1', type: 'recolte', cout: 0 },
    { matricule: 'A', ferme: 'F1', type: 'horsRecolte', cout: 0 },
    { matricule: 'B', ferme: 'F1', type: 'recolte', cout: 0 },
  ];
  const r = countDistinctByFermeType(lines, FERMES);
  assert.equal(r.F1.recolte, 2);
  assert.equal(r.F1.horsRecolte, 1);
  assert.equal(r.F1.total, 2); // A et B → 2, pas 2+1=3
});

test('buckets initialisés à 0 pour les fermes sans ligne', () => {
  const r = countDistinctByFermeType([], FERMES);
  for (const f of FERMES) {
    assert.deepEqual(r[f], { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0, cout: 0 });
  }
});

test('fermes hors liste sont ignorées', () => {
  const lines = [
    { matricule: 'A', ferme: 'Autre', type: 'horsRecolte', cout: 99 },
    { matricule: 'B', ferme: 'F1', type: 'horsRecolte', cout: 1 },
  ];
  const r = countDistinctByFermeType(lines, FERMES);
  assert.equal(r.Autre, undefined);
  assert.equal(r.F1.horsRecolte, 1);
});

test('répartit correctement recolte / horsRecolte / postesFixes', () => {
  const lines = [
    { matricule: 'A', ferme: 'F1', type: 'recolte', cout: 0 },
    { matricule: 'B', ferme: 'F1', type: 'horsRecolte', cout: 0 },
    { matricule: 'C', ferme: 'F1', type: 'postesFixes', cout: 0 },
  ];
  const r = countDistinctByFermeType(lines, FERMES);
  assert.equal(r.F1.recolte, 1);
  assert.equal(r.F1.horsRecolte, 1);
  assert.equal(r.F1.postesFixes, 1);
  assert.equal(r.F1.total, 3);
});
