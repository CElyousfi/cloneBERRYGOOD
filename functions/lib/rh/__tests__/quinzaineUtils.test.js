const test = require('node:test');
const assert = require('node:assert');
const { parseQuinzaine, getQuinzaineLabel } = require('../quinzaineUtils');

test('parseQuinzaine', () => {
  const p = parseQuinzaine('2026-08-2');
  assert.strictEqual(p.year, 2026);
  assert.strictEqual(p.half, 2);
  assert.strictEqual(p.dateFrom, '2026-08-16');
  assert.strictEqual(p.dateTo, '2026-08-31');
});
