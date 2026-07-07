'use strict';

/**
 * campagneUtilsBackend.test.js — vérifie la COPIE BACKEND
 * (functions/lib/mappingConso/campagneUtils.js).
 *
 * Cette copie existe car le package déployé des Cloud Functions n'embarque QUE
 * functions/ ; le backend ne doit JAMAIS require('../public/lib/...') (throw
 * "Cannot find module .../public/..." au runtime — hotfix fix/campagne-backend-require).
 *
 * On garantit ici : (1) campagneCourante existe côté backend, (2) la copie
 * backend reste équivalente à la source de vérité front sur les fonctions pures.
 */

const test = require('node:test');
const assert = require('node:assert');

const back = require('../../functions/lib/mappingConso/campagneUtils.js');
const front = require('../../public/lib/campagneUtils.js');

// ============================================================================
// campagneCourante (ajouté par le hotfix) — backend
// ============================================================================
test('backend campagneCourante — date explicite dérive comme campagneOf', () => {
  assert.strictEqual(back.campagneCourante('2026-07-01'), '2026-2027');
  assert.strictEqual(back.campagneCourante('2026-06-30'), '2025-2026');
  assert.strictEqual(back.campagneCourante('2025-06-30'), '2024-2025');
});

test('backend campagneCourante — sans argument = campagne du jour, non null', () => {
  const c = back.campagneCourante();
  assert.match(c, /^\d{4}-\d{4}$/);
});

test('backend campagneCourante — date garbage → null', () => {
  assert.strictEqual(back.campagneCourante('not-a-date'), null);
  assert.strictEqual(back.campagneCourante('2026/07/01'), null);
});

// ============================================================================
// Parité front / backend (le front est la spec)
// ============================================================================
test('parité front/backend — même surface d’API', () => {
  assert.strictEqual(typeof back.campagneOf, 'function');
  assert.strictEqual(typeof back.campagneCourante, 'function');
  assert.strictEqual(typeof back.debutCampagne, 'function');
  assert.strictEqual(typeof back.finCampagne, 'function');
  assert.strictEqual(typeof back.campagneDeCharge, 'function');
  assert.strictEqual(typeof back.phaseDeCharge, 'function');
});

test('parité front/backend — résultats identiques', () => {
  const dates = [
    '2026-07-01', '2026-06-30', '2025-06-30', '2027-01-15',
    '2025-12-31', '2026-06-20', 'bad', '', '2026/07/01',
  ];
  for (const d of dates) {
    assert.strictEqual(back.campagneOf(d), front.campagneOf(d), `campagneOf(${d})`);
    assert.strictEqual(
      back.campagneCourante(d), front.campagneCourante(d), `campagneCourante(${d})`
    );
  }
  const camps = ['2026-2027', '2024-2025', 'x', ''];
  for (const c of camps) {
    assert.strictEqual(back.debutCampagne(c), front.debutCampagne(c), `debutCampagne(${c})`);
    assert.strictEqual(back.finCampagne(c), front.finCampagne(c), `finCampagne(${c})`);
  }
});
