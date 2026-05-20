const test = require('node:test');
const assert = require('node:assert/strict');

const { loadReference, clearReferenceCache } = require('../referenceLoader');
const { MARAVILLA_PRIMOCANE, MARAVILLA_FLORICANE, JASMIN_PRIMOCANE } = require('./fixtures');

function makeReader(map, counter) {
  counter.calls = 0;
  return async (docId) => {
    counter.calls += 1;
    return map[docId] || null;
  };
}

test('referenceLoader #1: cache miss → reads Firestore, returns ref, caches it', async () => {
  clearReferenceCache();
  const counter = {};
  const deps = { readReferenceDoc: makeReader({ maravilla_primocane: MARAVILLA_PRIMOCANE }, counter) };
  const ref = await loadReference('maravilla', 'primocane', deps);
  assert.equal(ref.varietyId, 'maravilla');
  assert.equal(ref.stages.length, 9);
  assert.equal(counter.calls, 1, 'one Firestore read');
});

test('referenceLoader #2: cache hit → no Firestore read on 2nd call', async () => {
  clearReferenceCache();
  const counter = {};
  const deps = { readReferenceDoc: makeReader({ maravilla_primocane: MARAVILLA_PRIMOCANE }, counter) };
  await loadReference('maravilla', 'primocane', deps);
  await loadReference('maravilla', 'primocane', deps);
  await loadReference('maravilla', 'primocane', deps);
  assert.equal(counter.calls, 1, 'still one Firestore read after 3 invocations');
});

test('referenceLoader #3: multiple varieties × cycles loaded independently', async () => {
  clearReferenceCache();
  const counter = {};
  const deps = {
    readReferenceDoc: makeReader({
      maravilla_primocane: MARAVILLA_PRIMOCANE,
      maravilla_floricane: MARAVILLA_FLORICANE,
      jasmin_primocane: JASMIN_PRIMOCANE,
    }, counter),
  };
  const m1 = await loadReference('maravilla', 'primocane', deps);
  const m2 = await loadReference('maravilla', 'floricane', deps);
  const j1 = await loadReference('jasmin', 'primocane', deps);
  assert.equal(m1.cycleType, 'primocane');
  assert.equal(m2.cycleType, 'floricane');
  assert.equal(j1.varietyId, 'jasmin');
  assert.equal(counter.calls, 3, 'one read per distinct (variety,cycle)');
  // Second pass — all cache hits
  await loadReference('maravilla', 'primocane', deps);
  await loadReference('maravilla', 'floricane', deps);
  await loadReference('jasmin', 'primocane', deps);
  assert.equal(counter.calls, 3, 'no additional reads on second pass');
});

test('referenceLoader #4: doc missing → throws clear error with docId', async () => {
  clearReferenceCache();
  const counter = {};
  const deps = { readReferenceDoc: makeReader({}, counter) };
  await assert.rejects(
    () => loadReference('bogus', 'primocane', deps),
    /bogus_primocane/
  );
});

test('referenceLoader #5: malformed ref (no stages) → throws RangeError before consumer sees it', async () => {
  clearReferenceCache();
  const counter = {};
  const deps = { readReferenceDoc: makeReader({
    maravilla_primocane: { varietyId: 'maravilla', cycleType: 'primocane', tBase: 5, tCap: 30 /* stages omitted */ },
  }, counter) };
  await assert.rejects(
    () => loadReference('maravilla', 'primocane', deps),
    RangeError
  );

  // And missing tBase/tCap also throws
  clearReferenceCache();
  const counter2 = {};
  const deps2 = { readReferenceDoc: makeReader({
    maravilla_primocane: { varietyId: 'maravilla', cycleType: 'primocane', stages: [{ code: 'S0' }] /* tBase/tCap omitted */ },
  }, counter2) };
  await assert.rejects(
    () => loadReference('maravilla', 'primocane', deps2),
    RangeError
  );
});

test('referenceLoader: input validation', async () => {
  clearReferenceCache();
  const deps = { readReferenceDoc: async () => null };
  await assert.rejects(() => loadReference('', 'primocane', deps), TypeError);
  await assert.rejects(() => loadReference('maravilla', '', deps), TypeError);
  await assert.rejects(() => loadReference('maravilla', 'primocane', {}), TypeError);
});
