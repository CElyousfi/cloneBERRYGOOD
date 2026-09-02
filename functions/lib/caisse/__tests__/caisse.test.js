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

// ---------------------------------------------------------------- parametres

const params = require('../parametres');

test('parametres — les 16 codes analytiques par défaut, dans l\'ordre fourni', () => {
  assert.strictEqual(params.DEFAULT_CODES_ANALYTIQUES.length, 16);
  assert.strictEqual(params.DEFAULT_CODES_ANALYTIQUES[0], 'Plants');
  assert.strictEqual(params.DEFAULT_CODES_ANALYTIQUES[15], 'Administration & Frais Généraux');
  // L'ordre de saisie est l'ordre d'affichage : surtout PAS trié.
  const trie = params.DEFAULT_CODES_ANALYTIQUES.slice().sort((a, b) => a.localeCompare(b, 'fr'));
  assert.notDeepStrictEqual(params.DEFAULT_CODES_ANALYTIQUES.slice(), trie);
});

test('parametres — fermes par défaut, GENERAL inclus', () => {
  assert.deepStrictEqual(params.DEFAULT_FERMES.slice(),
    ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'BGF', 'GENERAL']);
});

test('normalizeListe — trim, vides retirés, ordre préservé', () => {
  assert.deepStrictEqual(params.normalizeListe(['  F1 ', '', '   ', 'F5']), ['F1', 'F5']);
  assert.deepStrictEqual(params.normalizeListe(['Engrais', 'Plants']), ['Engrais', 'Plants']);
});

test('normalizeListe — déduplication insensible à la casse, 1re graphie gardée', () => {
  assert.deepStrictEqual(params.normalizeListe(['Engrais', 'ENGRAIS', 'engrais', 'Plants']), ['Engrais', 'Plants']);
});

test('normalizeListe — entrées non-chaînes ignorées, entrée invalide tolérée', () => {
  assert.deepStrictEqual(params.normalizeListe(['F1', 42, null, undefined, {}, 'F5']), ['F1', 'F5']);
  assert.deepStrictEqual(params.normalizeListe(null), []);
  assert.deepStrictEqual(params.normalizeListe('F1'), []);
});

test('normalizeListe — plafonnée à MAX_ITEMS', () => {
  const grande = Array.from({ length: params.MAX_ITEMS + 50 }, (_, i) => 'C' + i);
  assert.strictEqual(params.normalizeListe(grande).length, params.MAX_ITEMS);
});

test('validateListe — liste vide refusée', () => {
  assert.match(params.validateListe('fermes', []), /ne peut pas être vide/);
  assert.match(params.validateListe('fermes', null), /ne peut pas être vide/);
});

test('validateListe — entrée trop longue refusée', () => {
  const long = 'x'.repeat(params.MAX_LEN + 1);
  assert.match(params.validateListe('codes analytiques', ['OK', long]), /trop longue/);
  assert.strictEqual(params.validateListe('codes analytiques', ['OK', 'x'.repeat(params.MAX_LEN)]), null);
});

test('withDefaults — doc absent ou vide → valeurs par défaut', () => {
  const p1 = params.withDefaults(null);
  assert.deepStrictEqual(p1.fermes, params.DEFAULT_FERMES.slice());
  assert.deepStrictEqual(p1.codes_analytiques, params.DEFAULT_CODES_ANALYTIQUES.slice());
  const p2 = params.withDefaults({ fermes: [], codes_analytiques: [] });
  assert.strictEqual(p2.fermes.length, 9);
  assert.strictEqual(p2.codes_analytiques.length, 16);
});

test('withDefaults — doc partiel : seule la liste vide retombe au défaut', () => {
  const p = params.withDefaults({ fermes: ['F1', 'BAHIA'] });
  assert.deepStrictEqual(p.fermes, ['F1', 'BAHIA']);
  assert.strictEqual(p.codes_analytiques.length, 16);
});

test('withDefaults — ne renvoie jamais une référence aux constantes', () => {
  const p = params.withDefaults(null);
  p.fermes.push('PIRATE');
  assert.strictEqual(params.DEFAULT_FERMES.indexOf('PIRATE'), -1);
});

test('estAutorisee — vide toujours accepté (axes facultatifs)', () => {
  assert.strictEqual(params.estAutorisee('', ['F1']), true);
  assert.strictEqual(params.estAutorisee(null, ['F1']), true);
  assert.strictEqual(params.estAutorisee('  ', ['F1']), true);
});

test('estAutorisee — appartenance stricte à la liste', () => {
  assert.strictEqual(params.estAutorisee('F1', ['F1', 'F5']), true);
  assert.strictEqual(params.estAutorisee('F9', ['F1', 'F5']), false);
  assert.strictEqual(params.estAutorisee('f1', ['F1', 'F5']), false);
  // Liste absente ou vide = pas de contrainte
  assert.strictEqual(params.estAutorisee('F9', []), true);
  assert.strictEqual(params.estAutorisee('F9', undefined), true);
});

test('validateAxes — accepte une ferme configurée hors liste par défaut', () => {
  assert.match(axes.validateAxes({ ferme: 'SERRE NORD' }), /Ferme invalide/);
  assert.strictEqual(axes.validateAxes({ ferme: 'SERRE NORD' }, { fermes: ['SERRE NORD', 'F1'] }), null);
});

test('validateAxes — refuse une ferme absente de la liste configurée', () => {
  assert.match(axes.validateAxes({ ferme: 'F5' }, { fermes: ['F1', 'BAHIA'] }), /Ferme invalide/);
});

test('validateAxes — liste injectée vide → repli sur les fermes par défaut', () => {
  assert.strictEqual(axes.validateAxes({ ferme: 'F5' }, { fermes: [] }), null);
  assert.match(axes.validateAxes({ ferme: 'INCONNUE' }, { fermes: [] }), /Ferme invalide/);
});

test('normalizeParcelles — champs retenus, label obligatoire', () => {
  const out = params.normalizeParcelles([
    { label: '  F5 CORINA  ', nom: ' CORINA ', culture: 'Myrtille', ferme: 'F5', campagne: '2026-2027' },
    { label: '', culture: 'Myrtille' },
    { culture: 'Myrtille' },
    null, 'F1', 42,
  ]);
  assert.deepStrictEqual(out, [{ label: 'F5 CORINA', nom: 'CORINA', culture: 'Myrtille', ferme: 'F5', campagne: '2026-2027' }]);
});

test('normalizeParcelles — nom absent → repli sur le label', () => {
  const out = params.normalizeParcelles([{ label: 'F1 ADELITA S2' }]);
  assert.deepStrictEqual(out, [{ label: 'F1 ADELITA S2', nom: 'F1 ADELITA S2', culture: '', ferme: '', campagne: '' }]);
});

test('normalizeParcelles — doublons de label écartés, ordre préservé', () => {
  const out = params.normalizeParcelles([
    { label: 'P2' }, { label: 'P1' }, { label: 'p2' }, { label: 'P3' },
  ]);
  assert.deepStrictEqual(out.map(p => p.label), ['P2', 'P1', 'P3']);
});

test('normalizeParcelles — entrées invalides → tableau vide', () => {
  assert.deepStrictEqual(params.normalizeParcelles(null), []);
  assert.deepStrictEqual(params.normalizeParcelles('P1'), []);
  assert.deepStrictEqual(params.normalizeParcelles([]), []);
});

test('withDefaults — parcelles SANS repli : vide reste vide', () => {
  // Contrairement aux fermes et aux codes, aucune valeur par défaut n'est
  // possible : une liste vide signifie « jamais rafraîchie ».
  assert.deepStrictEqual(params.withDefaults(null).parcelles, []);
  assert.deepStrictEqual(params.withDefaults({ parcelles: [] }).parcelles, []);
  assert.strictEqual(params.withDefaults(null).parcelles_maj_at, null);
});

test('withDefaults — parcelles conservées et normalisées', () => {
  const p = params.withDefaults({ parcelles: [{ label: 'P1', culture: 'Myrtille' }], parcelles_maj_at: 1234 });
  assert.strictEqual(p.parcelles.length, 1);
  assert.strictEqual(p.parcelles[0].culture, 'Myrtille');
  assert.strictEqual(p.parcelles_maj_at, 1234);
});

// ------------------------------------------------------------ soldeProvisoire

const sp = require('../soldeProvisoire');

const att = (caisse, status, type, montant) => ({ caisse_id: caisse, status, type, montant });

test('cumulEnAttente — seuls soumis et a_revoir comptent', () => {
  const c = sp.cumulEnAttente([
    att('C1', 'soumis', 'depense', 100),
    att('C1', 'a_revoir', 'depense', 50),
    att('C1', 'brouillon', 'depense', 999),
    att('C1', 'valide', 'depense', 999),
    att('C1', 'rejete', 'depense', 999),
  ]);
  assert.deepStrictEqual(c, { C1: { montant: -150, count: 2 } });
});

test('cumulEnAttente — recettes et dépenses se compensent', () => {
  const c = sp.cumulEnAttente([
    att('C1', 'soumis', 'depense', 300),
    att('C1', 'soumis', 'alimentation', 1000),
  ]);
  assert.deepStrictEqual(c, { C1: { montant: 700, count: 2 } });
});

test('cumulEnAttente — séparé par caisse', () => {
  const c = sp.cumulEnAttente([att('C1', 'soumis', 'depense', 100), att('C5', 'soumis', 'depense', 40)]);
  assert.deepStrictEqual(c, { C1: { montant: -100, count: 1 }, C5: { montant: -40, count: 1 } });
});

test('cumulEnAttente — entrées invalides ignorées', () => {
  assert.deepStrictEqual(sp.cumulEnAttente(null), {});
  assert.deepStrictEqual(sp.cumulEnAttente([null, { status: 'soumis' }, {}]), {});
});

test('cumulEnAttente — arrondi au centime, pas d\'accumulation d\'erreur', () => {
  const c = sp.cumulEnAttente([
    att('C1', 'soumis', 'depense', 0.1),
    att('C1', 'soumis', 'depense', 0.2),
  ]);
  assert.strictEqual(c.C1.montant, -0.3);   // et pas -0.30000000000000004
});

test('computeSoldesProvisoires — solde en caisse = validé + en attente', () => {
  const out = sp.computeSoldesProvisoires(
    [{ id: 'C1', solde_actuel: 10000 }, { id: 'C5', solde_actuel: 500 }],
    [att('C1', 'soumis', 'depense', 82), att('C1', 'soumis', 'depense', 50)]
  );
  assert.deepStrictEqual(out[0], { caisse_id: 'C1', solde_actuel: 10000, solde_provisoire: 9868, en_attente_montant: -132, en_attente_count: 2 });
  // Caisse sans bon en attente : les deux soldes sont égaux.
  assert.deepStrictEqual(out[1], { caisse_id: 'C5', solde_actuel: 500, solde_provisoire: 500, en_attente_montant: 0, en_attente_count: 0 });
});

test('computeSoldesProvisoires — le solde comptable n\'est JAMAIS modifié', () => {
  const caisses = [{ id: 'C1', solde_actuel: 10000 }];
  const out = sp.computeSoldesProvisoires(caisses, [att('C1', 'soumis', 'depense', 500)]);
  assert.strictEqual(out[0].solde_actuel, 10000);
  assert.strictEqual(caisses[0].solde_actuel, 10000);
});

test('computeSoldesProvisoires — cohérence avec la validation ultérieure', () => {
  // Après validation, solde_actuel doit valoir exactement le solde en caisse
  // annoncé avant. C'est la promesse faite au caissier.
  const enAttente = [att('C1', 'soumis', 'depense', 82), att('C1', 'soumis', 'alimentation', 1000)];
  const avant = sp.computeSoldesProvisoires([{ id: 'C1', solde_actuel: 10000 }], enAttente)[0];
  const apresValidation = enAttente.reduce((s, t) => s + computeSoldeDelta(t), 10000);
  assert.strictEqual(Math.round(apresValidation * 100) / 100, avant.solde_provisoire);
});

test('computeSoldesProvisoires — entrées absentes', () => {
  assert.deepStrictEqual(sp.computeSoldesProvisoires(null, []), []);
  const out = sp.computeSoldesProvisoires([{ id: 'C1' }], null);
  assert.strictEqual(out[0].solde_actuel, 0);
  assert.strictEqual(out[0].solde_provisoire, 0);
});

// ------------------------------------------------------------------ entites

const ent = require('../entites');

test('entiteParDefaut — repli sur le nom/id, Bahia détectée', () => {
  assert.strictEqual(ent.entiteParDefaut({ id: 'caisse_depenses_bahia', nom: 'Caisse Dépenses Bahia' }), 'BAHIA');
  assert.strictEqual(ent.entiteParDefaut({ id: 'caisse_paie_bahia', nom: 'Caisse Paie Bahia' }), 'BAHIA');
  assert.strictEqual(ent.entiteParDefaut({ id: 'caisse_depenses', nom: 'Caisse Dépenses' }), 'BGF');
  assert.strictEqual(ent.entiteParDefaut({}), 'BGF');
});

test('entiteDe — le choix explicite prime sur le repli', () => {
  const c = { id: 'caisse_depenses_bahia', nom: 'Caisse Dépenses Bahia' };
  assert.strictEqual(ent.entiteDe(c, {}), 'BAHIA');                       // repli
  assert.strictEqual(ent.entiteDe(c, { caisse_depenses_bahia: 'BGF' }), 'BGF'); // choix
});

test('entiteDe — un code invalide retombe sur le repli', () => {
  const c = { id: 'caisse_depenses', nom: 'Caisse Dépenses' };
  assert.strictEqual(ent.entiteDe(c, { caisse_depenses: 'NIMPORTEQUOI' }), 'BGF');
  assert.strictEqual(ent.entiteDe(c, { caisse_depenses: '' }), 'BGF');
});

test('normalizeEntites — écarte les codes invalides', () => {
  assert.deepStrictEqual(ent.normalizeEntites({ a: 'BGF', b: 'BAHIA', c: 'XX', d: '' }), { a: 'BGF', b: 'BAHIA' });
  assert.deepStrictEqual(ent.normalizeEntites(null), {});
  assert.deepStrictEqual(ent.normalizeEntites(['BGF']), {});
});

test('estCompteClient / nomClientDepuisId', () => {
  assert.strictEqual(ent.estCompteClient({ id: 'compte_client_iraqi_mohamed' }), true);
  assert.strictEqual(ent.estCompteClient({ id: 'caisse_depenses' }), false);
  assert.strictEqual(ent.estCompteClient(null), false);
  assert.strictEqual(ent.nomClientDepuisId('compte_client_mustapha_chafik_a'), 'MUSTAPHA CHAFIK A');
  assert.strictEqual(ent.nomClientDepuisId('compte_client_fruit_congel_du_nord'), 'FRUIT CONGEL DU NORD');
  assert.strictEqual(ent.nomClientDepuisId('caisse_depenses'), '');
});

test('repartirParEntite — sépare caisses de gestion et comptes clients', () => {
  const caisses = [
    { id: 'caisse_depenses', nom: 'Caisse Dépenses' },
    { id: 'caisse_paie', nom: 'Caisse Paie' },
    { id: 'caisse_depenses_bahia', nom: 'Caisse Dépenses Bahia' },
    { id: 'caisse_paie_bahia', nom: 'Caisse Paie Bahia' },
    { id: 'compte_client_iraqi_mohamed' },
  ];
  const bgf = ent.repartirParEntite(caisses, 'BGF', {});
  assert.deepStrictEqual(bgf.caisses.map(c => c.id), ['caisse_depenses', 'caisse_paie']);
  assert.deepStrictEqual(bgf.comptesClients.map(c => c.id), ['compte_client_iraqi_mohamed']);

  const bahia = ent.repartirParEntite(caisses, 'BAHIA', {});
  assert.deepStrictEqual(bahia.caisses.map(c => c.id), ['caisse_depenses_bahia', 'caisse_paie_bahia']);
  assert.deepStrictEqual(bahia.comptesClients, []);
});

test('repartirParEntite — entrées invalides', () => {
  assert.deepStrictEqual(ent.repartirParEntite(null, 'BGF'), { caisses: [], comptesClients: [] });
  assert.deepStrictEqual(ent.repartirParEntite([null], 'BGF'), { caisses: [], comptesClients: [] });
});

test('ENTITES — deux entités, BERRY GOOD FARMS en premier', () => {
  assert.deepStrictEqual(ent.ENTITES.map(e => e.code), ['BGF', 'BAHIA']);
  assert.strictEqual(ent.ENTITES[0].label, 'BERRY GOOD FARMS');
});
