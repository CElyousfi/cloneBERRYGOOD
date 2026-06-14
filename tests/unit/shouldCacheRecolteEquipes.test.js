'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldCacheRecolteEquipes } = require('../../functions/pointageService');

// Garde-fou anti-régression rCbmEuXS : le warm/serving ne doit JAMAIS cacher un payload
// recolte-equipes dégradé (kg=0 sur la majorité des dates → graphe Coût Récolte vide).
// Heuristique : >= 70% des dates doivent avoir au moins une ligne kg>0.

function rowsFor(dateSpecs) {
  // dateSpecs: { '2026-06-01': { total, withKg } }
  const rows = [];
  Object.entries(dateSpecs).forEach(([jour, { total, withKg }]) => {
    for (let i = 0; i < total; i++) {
      rows.push({ jour, kg: i < withKg ? 12.5 : 0 });
    }
  });
  return rows;
}

test('refuse de cacher un payload où toutes les dates ont kg=0', () => {
  const payload = {
    success: true,
    rows: rowsFor({
      '2026-06-01': { total: 10, withKg: 0 },
      '2026-06-02': { total: 10, withKg: 0 },
      '2026-06-03': { total: 10, withKg: 0 },
    }),
  };
  assert.equal(shouldCacheRecolteEquipes(payload), false);
});

test('accepte un payload où 80% des dates ont au moins une ligne kg>0', () => {
  const payload = {
    success: true,
    rows: rowsFor({
      '2026-06-01': { total: 10, withKg: 5 },
      '2026-06-02': { total: 10, withKg: 5 },
      '2026-06-03': { total: 10, withKg: 5 },
      '2026-06-04': { total: 10, withKg: 5 },
      '2026-06-05': { total: 10, withKg: 0 },
    }),
  };
  // 4/5 dates avec kg>0 = 80% >= 70% → cacheable
  assert.equal(shouldCacheRecolteEquipes(payload), true);
});

test('refuse juste sous le seuil (60% des dates avec kg>0)', () => {
  const payload = {
    success: true,
    rows: rowsFor({
      '2026-06-01': { total: 10, withKg: 5 },
      '2026-06-02': { total: 10, withKg: 5 },
      '2026-06-03': { total: 10, withKg: 5 },
      '2026-06-04': { total: 10, withKg: 0 },
      '2026-06-05': { total: 10, withKg: 0 },
    }),
  };
  // 3/5 = 60% < 70% → refus
  assert.equal(shouldCacheRecolteEquipes(payload), false);
});

test('accepte exactement au seuil (70%)', () => {
  const payload = {
    success: true,
    rows: rowsFor({
      d1: { total: 1, withKg: 1 },
      d2: { total: 1, withKg: 1 },
      d3: { total: 1, withKg: 1 },
      d4: { total: 1, withKg: 1 },
      d5: { total: 1, withKg: 1 },
      d6: { total: 1, withKg: 1 },
      d7: { total: 1, withKg: 1 },
      d8: { total: 1, withKg: 0 },
      d9: { total: 1, withKg: 0 },
      d10: { total: 1, withKg: 0 },
    }),
  };
  // 7/10 = 70% >= 70% → cacheable
  assert.equal(shouldCacheRecolteEquipes(payload), true);
});

test('payload vide ou non success → autorise le cache (pas de dégradation détectable)', () => {
  assert.equal(shouldCacheRecolteEquipes(null), true);
  assert.equal(shouldCacheRecolteEquipes({ success: false }), true);
  assert.equal(shouldCacheRecolteEquipes({ success: true, rows: [] }), true);
});
