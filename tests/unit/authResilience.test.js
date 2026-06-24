'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideAuthState, isNewAppVersion, retryDelayMs } = require('../../public/lib/authResilience');

const PROFILE = { uid: 'u1', profileId: 'finance', name: 'Omar' };

test('decideAuthState: no Firebase user → login (real sign-out)', () => {
    const d = decideAuthState({ authUser: null, meResult: null, cachedProfile: PROFILE });
    assert.equal(d.action, 'login');
    assert.equal(d.reason, 'no-firebase-user');
});

test('decideAuthState: me success → enter app with fresh profile', () => {
    const d = decideAuthState({
        authUser: { uid: 'u1' },
        meResult: { ok: true, success: true, user: PROFILE },
        cachedProfile: null
    });
    assert.equal(d.action, 'profile');
    assert.deepEqual(d.profile, PROFILE);
});

test('decideAuthState: disabled account → login even if Firebase connected', () => {
    const d = decideAuthState({
        authUser: { uid: 'u1' },
        meResult: { ok: true, success: false, disabled: true, error: 'disabled' },
        cachedProfile: PROFILE
    });
    assert.equal(d.action, 'login');
    assert.equal(d.reason, 'account-disabled');
});

test('decideAuthState: me network failure + cached profile → retry, stay in app', () => {
    const d = decideAuthState({
        authUser: { uid: 'u1' },
        meResult: { ok: false },
        cachedProfile: PROFILE
    });
    assert.equal(d.action, 'retry');
    assert.deepEqual(d.profile, PROFILE);
    assert.equal(d.reason, 'me-failed-have-cache');
});

test('decideAuthState: me threw (null result) + cached profile → retry', () => {
    const d = decideAuthState({
        authUser: { uid: 'u1' },
        meResult: null,
        cachedProfile: PROFILE
    });
    assert.equal(d.action, 'retry');
    assert.deepEqual(d.profile, PROFILE);
});

test('decideAuthState: success:false non-disabled (transient) + cache → retry', () => {
    const d = decideAuthState({
        authUser: { uid: 'u1' },
        meResult: { ok: true, success: false, error: 'temporarily unavailable' },
        cachedProfile: PROFILE
    });
    assert.equal(d.action, 'retry');
    assert.equal(d.reason, 'me-failed-have-cache');
});

test('decideAuthState: me failure + NO cached profile → error (no fake profile)', () => {
    const d = decideAuthState({
        authUser: { uid: 'u1' },
        meResult: { ok: false },
        cachedProfile: null
    });
    assert.equal(d.action, 'error');
    assert.equal(d.reason, 'me-failed-no-cache');
    assert.equal(d.profile, undefined);
});

test('decideAuthState: empty input is safe → login', () => {
    const d = decideAuthState();
    assert.equal(d.action, 'login');
});

test('decideAuthState: success:false disabled wins over having a cache', () => {
    // A disabled account must NEVER be masked by a cached profile.
    const d = decideAuthState({
        authUser: { uid: 'u1' },
        meResult: { ok: true, success: false, disabled: true },
        cachedProfile: PROFILE
    });
    assert.equal(d.action, 'login');
});

test('isNewAppVersion: different non-empty version → true', () => {
    assert.equal(isNewAppVersion('20260415b', '20260420a'), true);
});

test('isNewAppVersion: same version → false', () => {
    assert.equal(isNewAppVersion('20260415b', '20260415b'), false);
});

test('isNewAppVersion: empty/whitespace server version → false', () => {
    assert.equal(isNewAppVersion('20260415b', ''), false);
    assert.equal(isNewAppVersion('20260415b', '   '), false);
});

test('isNewAppVersion: trims whitespace before comparing', () => {
    assert.equal(isNewAppVersion('20260415b', '  20260415b\n'), false);
    assert.equal(isNewAppVersion('20260415b', '  20260420a\n'), true);
});

test('isNewAppVersion: non-string server version → false', () => {
    assert.equal(isNewAppVersion('20260415b', null), false);
    assert.equal(isNewAppVersion('20260415b', undefined), false);
    assert.equal(isNewAppVersion('20260415b', 42), false);
});

test('retryDelayMs: short then capped, clamps past end', () => {
    assert.equal(retryDelayMs(0), 2000);
    assert.equal(retryDelayMs(1), 5000);
    assert.equal(retryDelayMs(2), 10000);
    assert.equal(retryDelayMs(99), 30000);
    assert.equal(retryDelayMs(-5), 2000);
});
