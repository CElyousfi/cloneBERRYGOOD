'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupInflight } = require('../../public/lib/inflightDedup');

test('concurrent calls on same key trigger fn only once', async () => {
    const registry = {};
    let calls = 0;
    let resolveFn;
    const fn = () => {
        calls += 1;
        return new Promise((resolve) => { resolveFn = resolve; });
    };

    const p1 = dedupInflight(registry, 'k', fn);
    const p2 = dedupInflight(registry, 'k', fn);

    assert.equal(calls, 1, 'fn called exactly once for concurrent same-key calls');
    assert.equal(p1, p2, 'both callers share the same promise');

    resolveFn('value');
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 'value');
    assert.equal(r2, 'value');
});

test('different keys run independently', async () => {
    const registry = {};
    let calls = 0;
    const fn = (v) => () => { calls += 1; return Promise.resolve(v); };

    const pa = dedupInflight(registry, 'a', fn('A'));
    const pb = dedupInflight(registry, 'b', fn('B'));
    assert.equal(calls, 2);
    assert.equal(await pa, 'A');
    assert.equal(await pb, 'B');
});

test('after resolution a new call re-executes fn (no value caching)', async () => {
    const registry = {};
    let calls = 0;
    const fn = () => { calls += 1; return Promise.resolve(calls); };

    const first = await dedupInflight(registry, 'k', fn);
    assert.equal(first, 1);
    assert.deepEqual(registry, {}, 'registry cleared after settle');

    const second = await dedupInflight(registry, 'k', fn);
    assert.equal(second, 2, 'fn re-executed on a fresh call');
});

test('failure clears the entry and is not cached (retry allowed)', async () => {
    const registry = {};
    let calls = 0;
    const fn = () => {
        calls += 1;
        return calls === 1
            ? Promise.reject(new Error('boom'))
            : Promise.resolve('ok');
    };

    await assert.rejects(dedupInflight(registry, 'k', fn), /boom/);
    assert.deepEqual(registry, {}, 'failed entry cleared');

    const retry = await dedupInflight(registry, 'k', fn);
    assert.equal(retry, 'ok', 'retry after failure re-executes fn');
    assert.equal(calls, 2);
});

test('rejection shared by concurrent callers', async () => {
    const registry = {};
    let rejectFn;
    const fn = () => new Promise((_, reject) => { rejectFn = reject; });

    const p1 = dedupInflight(registry, 'k', fn);
    const p2 = dedupInflight(registry, 'k', fn);
    assert.equal(p1, p2);

    rejectFn(new Error('net'));
    await assert.rejects(p1, /net/);
    await assert.rejects(p2, /net/);
    assert.deepEqual(registry, {}, 'registry cleared after rejection');
});
