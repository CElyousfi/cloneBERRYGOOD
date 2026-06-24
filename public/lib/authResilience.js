/**
 * authResilience.js — Pure decision helpers for auth boot resilience.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/authResilience.js"> → window.AuthResilience
 *   - In node:test via require('./authResilience.js') → module.exports
 *
 * Two concerns, both PURE (no DOM, no network, no Firestore, no localStorage):
 *
 *   1. decideAuthState({ authUser, meResult, cachedProfile }) → decision
 *      Tells the App shell what to do after an onAuthStateChanged + /api/auth?me
 *      cycle. Distinguishes a REAL sign-out (go to login) from a TRANSIENT `me`
 *      failure while Firebase is still authenticated (stay in app + retry).
 *
 *   2. isNewAppVersion(currentVersion, serverVersion) → boolean
 *      Whether the server advertises a different, non-empty app version. Used by
 *      the "soft" checkVersion: show a toast instead of reloading automatically.
 *
 * See MEMORY: umd-global-collision — classic <script> tags share global scope,
 * so everything is wrapped in an IIFE exposing ONLY window.AuthResilience.
 */
// @ts-check
'use strict';

(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.AuthResilience = api;
})(typeof window !== 'undefined' ? window : null, function () {
    /**
     * Decide what the auth gate should do after a `me` attempt.
     *
     * Possible actions:
     *   - 'login'   : show LoginScreen. REAL disconnect — never masked.
     *   - 'profile' : enter the app with a fresh profile from `me`.
     *   - 'retry'   : Firebase still connected but `me` failed transiently. Enter
     *                 the app using the last known profile (live or cached) and
     *                 show a non-blocking "reconnecting" banner + schedule retry.
     *   - 'error'   : Firebase connected but `me` failed AND no known profile to
     *                 fall back on (e.g. first login + network down). Cannot enter;
     *                 show an error/retry screen, NOT a fake profile.
     *
     * @param {Object} input
     * @param {Object|null} input.authUser   Firebase user (null => signed out)
     * @param {Object|null} [input.meResult] result of /api/auth?action=me, shape:
     *        { ok:boolean, success?:boolean, user?:object, disabled?:boolean,
     *          error?:string }. `ok` = HTTP/network succeeded (response parsed).
     *        When the fetch threw (network/5xx unparsable) pass meResult.ok=false.
     * @param {Object|null} [input.cachedProfile] last known profile (from cache)
     * @returns {{ action:'login'|'profile'|'retry'|'error', profile?:object,
     *             reason:string }}
     */
    function decideAuthState(input) {
        input = input || {};
        var authUser = input.authUser || null;
        var meResult = input.meResult || null;
        var cachedProfile = input.cachedProfile || null;

        // REAL disconnect #1: Firebase has no user → login, always.
        if (!authUser) {
            return { action: 'login', reason: 'no-firebase-user' };
        }

        // `me` succeeded with a usable profile → enter the app normally.
        if (meResult && meResult.ok === true && meResult.success === true && meResult.user) {
            return { action: 'profile', profile: meResult.user, reason: 'me-success' };
        }

        // REAL disconnect #2: account disabled. The server explicitly told us this
        // user is no longer allowed. This is NOT transient → login (caller signs out).
        if (meResult && meResult.ok === true && meResult.success === false && meResult.disabled === true) {
            return { action: 'login', reason: 'account-disabled' };
        }

        // From here: Firebase IS connected but `me` did not yield a usable profile.
        // Either the fetch threw (meResult.ok === false / meResult null) or it
        // returned success:false for a NON-disabled reason → treat as TRANSIENT.
        var lastKnown = cachedProfile || null;
        if (lastKnown) {
            return { action: 'retry', profile: lastKnown, reason: 'me-failed-have-cache' };
        }

        // No profile at all to fall back on → cannot enter the app safely.
        return { action: 'error', reason: 'me-failed-no-cache' };
    }

    /**
     * Whether the server advertises a new, non-empty app version.
     * @param {string} currentVersion version baked into the running bundle
     * @param {string} serverVersion  trimmed contents of app-version.txt
     * @returns {boolean}
     */
    function isNewAppVersion(currentVersion, serverVersion) {
        if (typeof serverVersion !== 'string') return false;
        var sv = serverVersion.trim();
        if (!sv) return false;
        return sv !== currentVersion;
    }

    /**
     * Backoff schedule (ms) for the `me` retry loop. Short, then capped.
     * Index past the end clamps to the last value.
     * @param {number} attempt 0-based retry attempt index
     * @returns {number} delay in ms
     */
    function retryDelayMs(attempt) {
        var schedule = [2000, 5000, 10000, 20000, 30000];
        if (attempt < 0) attempt = 0;
        return attempt >= schedule.length ? schedule[schedule.length - 1] : schedule[attempt];
    }

    return {
        decideAuthState: decideAuthState,
        isNewAppVersion: isNewAppVersion,
        retryDelayMs: retryDelayMs
    };
});
