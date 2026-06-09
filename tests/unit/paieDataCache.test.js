'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const cache = require('../../public/lib/paieDataCache.js');

test('pointageKey encode les bornes de façon stable', () => {
  assert.strictEqual(cache.pointageKey('2026-01-01', '2026-06-09'), 'pointage:2026-01-01..2026-06-09');
  assert.strictEqual(cache.pointageKey('', ''), 'pointage:..');
});

test('set/peek retournent la valeur tant que le TTL est valide', () => {
  cache.invalidate();
  cache.set('k', { a: 1 }, 1000);
  assert.deepStrictEqual(cache.peek('k', 5000, 2000), { a: 1 });
  // au-delà du TTL → miss
  assert.strictEqual(cache.peek('k', 5000, 7000), undefined);
});

test('getOrLoad appelle le loader UNE seule fois sur un hit de cache', async () => {
  cache.invalidate();
  let calls = 0;
  const loader = async () => { calls++; return { docs: 42 }; };
  const r1 = await cache.getOrLoad('reg', loader, { now: 0 });
  const r2 = await cache.getOrLoad('reg', loader, { now: 1000 }); // dans le TTL
  assert.deepStrictEqual(r1, { docs: 42 });
  assert.deepStrictEqual(r2, { docs: 42 });
  assert.strictEqual(calls, 1, 'le loader ne doit être appelé qu\'une fois');
});

test('getOrLoad recharge après expiration du TTL', async () => {
  cache.invalidate();
  let calls = 0;
  const loader = async () => { calls++; return calls; };
  await cache.getOrLoad('reg', loader, { now: 0, ttlMs: 1000 });
  await cache.getOrLoad('reg', loader, { now: 5000, ttlMs: 1000 }); // expiré
  assert.strictEqual(calls, 2);
});

test('getOrLoad de-dup les appels concurrents (un seul load)', async () => {
  cache.invalidate();
  let calls = 0;
  const loader = () => new Promise(resolve => { calls++; setTimeout(() => resolve('done'), 10); });
  const [a, b] = await Promise.all([
    cache.getOrLoad('x', loader, { now: 0 }),
    cache.getOrLoad('x', loader, { now: 0 }),
  ]);
  assert.strictEqual(a, 'done');
  assert.strictEqual(b, 'done');
  assert.strictEqual(calls, 1, 'deux appels concurrents = un seul chargement réseau');
});

test('getOrLoad ne met PAS en cache une erreur (retry possible)', async () => {
  cache.invalidate();
  let calls = 0;
  const flaky = async () => { calls++; if (calls === 1) throw new Error('boom'); return 'ok'; };
  await assert.rejects(() => cache.getOrLoad('y', flaky, { now: 0 }), /boom/);
  const r = await cache.getOrLoad('y', flaky, { now: 1 });
  assert.strictEqual(r, 'ok');
  assert.strictEqual(calls, 2);
});

test('invalidate(prefix) ne purge que les clés du préfixe', () => {
  cache.invalidate();
  cache.set('pointage:a..b', 1, 0);
  cache.set('pointage:c..d', 2, 0);
  cache.set('registry', 3, 0);
  cache.invalidate('pointage:');
  assert.strictEqual(cache.peek('pointage:a..b', 99999, 0), undefined);
  assert.strictEqual(cache.peek('pointage:c..d', 99999, 0), undefined);
  assert.strictEqual(cache.peek('registry', 99999, 0), 3);
});

test('invalidate() sans argument purge tout', () => {
  cache.set('a', 1, 0);
  cache.set('b', 2, 0);
  cache.invalidate();
  assert.strictEqual(cache.peek('a', 99999, 0), undefined);
  assert.strictEqual(cache.peek('b', 99999, 0), undefined);
});
