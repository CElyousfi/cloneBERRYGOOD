'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { computeSoldeDelta, isTypeEditable } = require('../soldeDelta');
const { periodeFromDate, rapprochementDocId, periodesAVerifier } = require('../rapprochementLock');
const { computeChanges } = require('../txDiff');

// ---------------------------------------------------------------- soldeDelta

test('computeSoldeDelta — types qui créditent la caisse', () => {
  assert.strictEqual(computeSoldeDelta({ type: 'alimentation', montant: 1200 }), 1200);
  assert.strictEqual(computeSoldeDelta({ type: 'transfer_in', montant: 500.5 }), 500.5);
});

test('computeSoldeDelta — types qui débitent la caisse', () => {
  for (const type of ['depense', 'sortie', 'transfer_out', 'paie', 'transport']) {
    assert.strictEqual(computeSoldeDelta({ type, montant: 1200 }), -1200, `type ${type}`);
  }
});

test('computeSoldeDelta — type inconnu ou absent → 0', () => {
  assert.strictEqual(computeSoldeDelta({ type: 'vente', montant: 999 }), 0);
  assert.strictEqual(computeSoldeDelta({ type: 'encaissement', montant: 999 }), 0);
  assert.strictEqual(computeSoldeDelta({ montant: 999 }), 0);
  assert.strictEqual(computeSoldeDelta({ type: 'nimporte_quoi', montant: 999 }), 0);
});

test('computeSoldeDelta — montant absent, non numérique ou tx nulle → 0', () => {
  assert.strictEqual(computeSoldeDelta({ type: 'depense' }), 0);
  assert.strictEqual(computeSoldeDelta({ type: 'depense', montant: 'abc' }), 0);
  assert.strictEqual(computeSoldeDelta(null), 0);
});

test('computeSoldeDelta — montant en chaîne (payload HTTP)', () => {
  assert.strictEqual(computeSoldeDelta({ type: 'depense', montant: '1450.25' }), -1450.25);
});

test('computeSoldeDelta — montant zéro reste zéro (pas de -0)', () => {
  assert.ok(Object.is(computeSoldeDelta({ type: 'depense', montant: 0 }), -0)
    || computeSoldeDelta({ type: 'depense', montant: 0 }) === 0);
  assert.strictEqual(computeSoldeDelta({ type: 'depense', montant: 0 }) + 10, 10);
});

test('isTypeEditable — seuls les 5 types saisissables sont modifiables', () => {
  for (const type of ['alimentation', 'depense', 'sortie', 'paie', 'transport']) {
    assert.strictEqual(isTypeEditable(type), true, `type ${type}`);
  }
  for (const type of ['transfer_in', 'transfer_out', 'vente', 'encaissement', undefined, '']) {
    assert.strictEqual(isTypeEditable(type), false, `type ${String(type)}`);
  }
});

// --------------------------------------------------------- rapprochementLock

// Réplique de _periodeBounds (functions/index.js) — le docId DOIT rester aligné.
function _periodeBoundsRef(mois, annee) {
  const m = parseInt(mois, 10);
  const y = parseInt(annee, 10);
  if (!Number.isFinite(m) || m < 1 || m > 12) return null;
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return null;
  return { docId: `${y}-${String(m).padStart(2, '0')}` };
}

test('periodeFromDate — docId aligné sur _periodeBounds', () => {
  assert.strictEqual(periodeFromDate('2026-08-05').docId, _periodeBoundsRef(8, 2026).docId);
  assert.strictEqual(periodeFromDate('2026-01-01').docId, _periodeBoundsRef(1, 2026).docId);
  assert.strictEqual(periodeFromDate('2026-12-31').docId, _periodeBoundsRef(12, 2026).docId);
});

test('periodeFromDate — bascule de mois et d\'année', () => {
  assert.strictEqual(periodeFromDate('2026-07-31').docId, '2026-07');
  assert.strictEqual(periodeFromDate('2026-08-01').docId, '2026-08');
  assert.strictEqual(periodeFromDate('2026-12-31').docId, '2026-12');
  assert.strictEqual(periodeFromDate('2027-01-01').docId, '2027-01');
});

test('periodeFromDate — libellé humain français', () => {
  assert.strictEqual(periodeFromDate('2026-08-05').label, 'Août 2026');
  assert.strictEqual(periodeFromDate('2026-01-15').label, 'Janvier 2026');
  assert.strictEqual(periodeFromDate('2026-12-02').label, 'Décembre 2026');
});

test('periodeFromDate — dates invalides → null', () => {
  for (const bad of ['', '2026-13-01', '2026-00-10', '05/08/2026', '2026-8-5', '2026-02-30',
    'abc', null, undefined, 42, '1999-05-05', '2101-05-05']) {
    assert.strictEqual(periodeFromDate(bad), null, `date ${String(bad)}`);
  }
});

test('periodeFromDate — année bissextile', () => {
  assert.strictEqual(periodeFromDate('2028-02-29').docId, '2028-02');
  assert.strictEqual(periodeFromDate('2026-02-29'), null);
});

test('rapprochementDocId — clé caisse_periode', () => {
  assert.strictEqual(rapprochementDocId('CAISSE-F1', '2026-08-05'), 'CAISSE-F1_2026-08');
  assert.strictEqual(rapprochementDocId('CAISSE-F1', 'nawak'), null);
  assert.strictEqual(rapprochementDocId('', '2026-08-05'), null);
});

test('periodesAVerifier — aucun changement → une seule période', () => {
  const p = periodesAVerifier(
    { caisse_id: 'C1', date: '2026-08-05' },
    { caisse_id: 'C1', date: '2026-08-20' }
  );
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].docId, 'C1_2026-08');
});

test('periodesAVerifier — changement de mois → deux périodes', () => {
  const p = periodesAVerifier(
    { caisse_id: 'C1', date: '2026-08-05' },
    { caisse_id: 'C1', date: '2026-09-02' }
  );
  assert.deepStrictEqual(p.map((x) => x.docId), ['C1_2026-08', 'C1_2026-09']);
});

test('periodesAVerifier — changement de caisse → deux périodes', () => {
  const p = periodesAVerifier(
    { caisse_id: 'C1', date: '2026-08-05' },
    { caisse_id: 'C5', date: '2026-08-05' }
  );
  assert.deepStrictEqual(p.map((x) => x.docId), ['C1_2026-08', 'C5_2026-08']);
});

test('periodesAVerifier — état invalide ignoré sans planter', () => {
  assert.deepStrictEqual(periodesAVerifier(null, null), []);
  const p = periodesAVerifier({ caisse_id: 'C1', date: '2026-08-05' }, { caisse_id: 'C1', date: 'nawak' });
  assert.strictEqual(p.length, 1);
});

// -------------------------------------------------------------------- txDiff

test('computeChanges — aucun changement → tableau vide', () => {
  const before = { date: '2026-08-05', montant: 1200, type: 'depense', description: 'Gasoil' };
  assert.deepStrictEqual(computeChanges(before, { date: '2026-08-05', montant: 1200 }), []);
});

test('computeChanges — montant et date modifiés', () => {
  const before = { date: '2026-08-03', montant: 1200, type: 'depense' };
  const after = { date: '2026-08-05', montant: 1450, type: 'depense' };
  assert.deepStrictEqual(computeChanges(before, after), [
    { field: 'date', from: '2026-08-03', to: '2026-08-05' },
    { field: 'montant', from: 1200, to: 1450 },
  ]);
});

test('computeChanges — montant en chaîne comparé numériquement', () => {
  assert.deepStrictEqual(computeChanges({ montant: 1200 }, { montant: '1200' }), []);
  assert.deepStrictEqual(computeChanges({ montant: 1200 }, { montant: '1200.50' }),
    [{ field: 'montant', from: 1200, to: 1200.5 }]);
});

test('computeChanges — champ absent du patch = inchangé, pas vidé', () => {
  const before = { description: 'Gasoil', montant: 1200 };
  assert.deepStrictEqual(computeChanges(before, { montant: 1300 }),
    [{ field: 'montant', from: 1200, to: 1300 }]);
});

test('computeChanges — null/undefined normalisés en chaîne vide', () => {
  assert.deepStrictEqual(computeChanges({ code_analytique: undefined }, { code_analytique: '' }), []);
  assert.deepStrictEqual(computeChanges({ description: null }, { description: '  ' }), []);
  assert.deepStrictEqual(computeChanges({ code_analytique: '' }, { code_analytique: 'IRRIG' }),
    [{ field: 'code_analytique', from: '', to: 'IRRIG' }]);
});

test('computeChanges — pièces jointes résumées par un compte', () => {
  const before = { files: [{ name: 'a', data: 'data:image/jpeg;base64,AAAA' }] };
  const after = { files: [{ name: 'a', data: 'x' }, { name: 'b', data: 'y' }] };
  const changes = computeChanges(before, after);
  assert.deepStrictEqual(changes, [{ field: 'files', from: 1, to: 2 }]);
  assert.strictEqual(JSON.stringify(changes).indexOf('base64'), -1);
});

test('computeChanges — changement de caisse et de type tracé', () => {
  const changes = computeChanges(
    { caisse_id: 'C1', type: 'depense' },
    { caisse_id: 'C5', type: 'alimentation' }
  );
  assert.deepStrictEqual(changes, [
    { field: 'type', from: 'depense', to: 'alimentation' },
    { field: 'caisse_id', from: 'C1', to: 'C5' },
  ]);
});

test('computeChanges — entrées vides ne plantent pas', () => {
  assert.deepStrictEqual(computeChanges(null, null), []);
  assert.deepStrictEqual(computeChanges(undefined, { montant: 10 }),
    [{ field: 'montant', from: 0, to: 10 }]);
});

// -------------------------------------------------------- champsAnalytiques

const axes = require('../champsAnalytiques');

test('campagneOf — bascule au 1er juillet', () => {
  assert.strictEqual(axes.campagneOf('2026-06-30'), '2025-2026');
  assert.strictEqual(axes.campagneOf('2026-07-01'), '2026-2027');
  assert.strictEqual(axes.campagneOf('2026-08-26'), '2026-2027');
  assert.strictEqual(axes.campagneOf('2026-12-31'), '2026-2027');
  assert.strictEqual(axes.campagneOf('2027-01-01'), '2026-2027');
});

test('campagneOf — aligné sur public/lib/campagneUtils.js (même règle juillet)', () => {
  const ref = (d) => { const m = d.match(/^(\d{4})-(\d{2})/); const y = +m[1], mo = +m[2]; const s = mo >= 7 ? y : y - 1; return s + '-' + (s + 1); };
  for (const d of ['2025-07-01', '2026-01-15', '2026-06-30', '2026-07-01', '2027-03-09']) {
    assert.strictEqual(axes.campagneOf(d), ref(d), `date ${d}`);
  }
});

test('campagneOf — entrées invalides → chaîne vide', () => {
  for (const bad of ['', 'nawak', '26-07-01', null, undefined, 42, '2026-13-01']) {
    assert.strictEqual(axes.campagneOf(bad), '', `entrée ${String(bad)}`);
  }
});

test('validateAxes — les 4 axes sont facultatifs', () => {
  assert.strictEqual(axes.validateAxes({}), null);
  assert.strictEqual(axes.validateAxes({ ferme: '', culture: '', campagne: '' }), null);
  assert.strictEqual(axes.validateAxes(null), null);
});

test('validateAxes — fermes acceptées et refusées', () => {
  for (const f of axes.FERMES) assert.strictEqual(axes.validateAxes({ ferme: f }), null, `ferme ${f}`);
  assert.match(axes.validateAxes({ ferme: 'F7' }), /Ferme invalide/);
  assert.match(axes.validateAxes({ ferme: 'f1' }), /Ferme invalide/);
});

test('validateAxes — cultures acceptées et refusées', () => {
  for (const v of axes.CULTURES) assert.strictEqual(axes.validateAxes({ culture: v }), null, `culture ${v}`);
  assert.match(axes.validateAxes({ culture: 'Fraise' }), /Culture invalide/);
});

test('validateAxes — format de campagne', () => {
  assert.strictEqual(axes.validateAxes({ campagne: '2026-2027' }), null);
  assert.match(axes.validateAxes({ campagne: '2026' }), /Campagne invalide/);
  assert.match(axes.validateAxes({ campagne: '2026-07' }), /Campagne invalide/);
});

test('validateAxes — la parcelle est libre (libellé BEE ONE ou GENERAL)', () => {
  assert.strictEqual(axes.validateAxes({ parcelle: 'F5 CORINA myrtille S8-3' }), null);
  assert.strictEqual(axes.validateAxes({ parcelle: axes.PARCELLE_GENERAL }), null);
});

test('computeChanges — les 4 axes analytiques sont tracés', () => {
  const changes = computeChanges(
    { ferme: '', campagne: '', culture: '', parcelle: '' },
    { ferme: 'F5', campagne: '2026-2027', culture: 'Myrtille', parcelle: 'GENERAL' }
  );
  assert.deepStrictEqual(changes.map((c) => c.field), ['ferme', 'campagne', 'culture', 'parcelle']);
});

// ----------------------------------------------------------- batchValidation

const { planBatchValidation, applyDelta } = require('../batchValidation');

const soumis = (caisse, type, montant) => ({ status: 'soumis', caisse_id: caisse, type, montant });

test('planBatchValidation — cumule le delta par caisse', () => {
  const plan = planBatchValidation([
    { id: 'a', data: soumis('C1', 'depense', 100) },
    { id: 'b', data: soumis('C1', 'depense', 50) },
    { id: 'c', data: soumis('C1', 'alimentation', 500) },
    { id: 'd', data: soumis('C5', 'depense', 200) },
  ]);
  assert.deepStrictEqual(plan.eligibles, ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(plan.deltaParCaisse, { C1: 350, C5: -200 });
  assert.deepStrictEqual(plan.errors, []);
});

test('planBatchValidation — seul un bon « soumis » est validable', () => {
  const plan = planBatchValidation([
    { id: 'a', data: soumis('C1', 'depense', 100) },
    { id: 'b', data: { status: 'brouillon', caisse_id: 'C1', type: 'depense', montant: 999 } },
    { id: 'c', data: { status: 'valide', caisse_id: 'C1', type: 'depense', montant: 999 } },
    { id: 'd', data: { status: 'rejete', caisse_id: 'C1', type: 'depense', montant: 999 } },
  ]);
  assert.deepStrictEqual(plan.eligibles, ['a']);
  // Le montant des non-soumis ne doit JAMAIS entrer dans le delta.
  assert.deepStrictEqual(plan.deltaParCaisse, { C1: -100 });
  assert.deepStrictEqual(plan.errors.map((e) => [e.id, e.reason, e.status]), [
    ['b', 'statut_non_soumis', 'brouillon'],
    ['c', 'statut_non_soumis', 'valide'],
    ['d', 'statut_non_soumis', 'rejete'],
  ]);
});

test('planBatchValidation — un bon déjà validé ne crédite pas deux fois', () => {
  const plan = planBatchValidation([{ id: 'a', data: { status: 'valide', caisse_id: 'C1', type: 'alimentation', montant: 1000 } }]);
  assert.deepStrictEqual(plan.eligibles, []);
  assert.deepStrictEqual(plan.deltaParCaisse, {});
});

test('planBatchValidation — document absent ou caisse manquante écartés', () => {
  const plan = planBatchValidation([
    { id: 'a', data: null },
    { id: 'b', data: { status: 'soumis', type: 'depense', montant: 100 } },
    { id: 'c', data: soumis('C1', 'depense', 100) },
  ]);
  assert.deepStrictEqual(plan.eligibles, ['c']);
  assert.deepStrictEqual(plan.errors.map((e) => [e.id, e.reason]), [['a', 'not_found'], ['b', 'caisse_absente']]);
});

test('planBatchValidation — delta cohérent avec la validation unitaire', () => {
  for (const type of ['alimentation', 'depense', 'sortie', 'paie', 'transport']) {
    const plan = planBatchValidation([{ id: 'x', data: soumis('C1', type, 1000) }]);
    assert.strictEqual(plan.deltaParCaisse.C1, computeSoldeDelta({ type, montant: 1000 }), `type ${type}`);
  }
});

test('planBatchValidation — entrées vides ou invalides ne plantent pas', () => {
  assert.deepStrictEqual(planBatchValidation([]), { eligibles: [], deltaParCaisse: {}, errors: [] });
  assert.deepStrictEqual(planBatchValidation(null), { eligibles: [], deltaParCaisse: {}, errors: [] });
  assert.deepStrictEqual(planBatchValidation([null, undefined]), { eligibles: [], deltaParCaisse: {}, errors: [] });
});

test('applyDelta — arrondi au centime, tolérant aux valeurs absentes', () => {
  assert.strictEqual(applyDelta(10000, -1450.25), 8549.75);
  assert.strictEqual(applyDelta(0.1, 0.2), 0.3);              // pas de 0.30000000000000004
  assert.strictEqual(applyDelta(undefined, -100), -100);
  assert.strictEqual(applyDelta(500, undefined), 500);
  assert.strictEqual(applyDelta('abc', 100), 100);
});

test('applyDelta — scénario complet : 3 dépenses validées en masse', () => {
  const plan = planBatchValidation([
    { id: 'a', data: soumis('C1', 'depense', 82) },
    { id: 'b', data: soumis('C1', 'depense', 50) },
    { id: 'c', data: soumis('C1', 'depense', 60) },
  ]);
  assert.strictEqual(applyDelta(10000, plan.deltaParCaisse.C1), 9808);
});
