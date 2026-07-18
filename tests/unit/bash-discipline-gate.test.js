'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { evaluate } = require('../../scripts/bash-discipline-gate.js');

const SCRIPT = path.resolve(__dirname, '../../scripts/bash-discipline-gate.js');

// ---------------------------------------------------------------------------
// Partie A — tests unitaires directs sur evaluate()
// ---------------------------------------------------------------------------

describe('bash-discipline-gate — evaluate() DENY cases', () => {
  const denyCases = [
    { cmd: 'cd /tmp && ls',                       id: 'cd-chain' },
    { cmd: 'cd "$ROOT" && npm run qa',            id: 'cd-chain' },
    { cmd: 'grep -n foo src/file.js',             id: 'grep-bash' },
    { cmd: 'rg "pattern" .',                      id: 'grep-bash' },
    { cmd: 'NODE_ENV=test grep foo .',            id: 'grep-bash' },
    { cmd: 'cat public/app.jsx',                  id: 'cat-bash' },
    { cmd: 'cat "/path with spaces/file.js"',     id: 'cat-bash' },
    { cmd: 'head -20 file.js',                    id: 'head-tail-bash' },
    { cmd: 'tail -f server.log',                  id: 'head-tail-bash' },
    { cmd: "sed -n '1,10p' file",                 id: 'sed-n-bash' },
    { cmd: "sed --quiet '/pattern/p' file",       id: 'sed-n-bash' },
    { cmd: 'find . -name "*.js"',                 id: 'find-bash' },
    { cmd: 'wc -l file.js',                       id: 'wc-bash' },
    { cmd: 'ls -la docs/',                        id: 'ls-bash' },
    { cmd: 'ls',                                  id: 'ls-bash' },
    { cmd: 'npm run qa 2>&1 | head -50',          id: 'pipe-head-tail' },
    { cmd: 'git log --oneline | head -10',        id: 'pipe-head-tail' },
    { cmd: 'git log --oneline | grep pattern',    id: 'pipe-grep-rg' },
    { cmd: 'something | rg pattern',              id: 'pipe-grep-rg' },
  ];

  for (const { cmd, id } of denyCases) {
    test(`DENY ${id}: ${cmd}`, () => {
      const result = evaluate(cmd);
      assert.ok(result !== null, `Expected DENY for: ${cmd}`);
      assert.equal(result.id, id, `Expected rule id "${id}" but got "${result && result.id}"`);
    });
  }
});

describe('bash-discipline-gate — evaluate() ALLOW cases', () => {
  const allowCases = [
    'git status',
    'git log --oneline -5',
    'git diff HEAD',
    'git add src/file.js',
    'git commit -m "feat: ..."',
    'git push BERRYGOOD main',
    'git push --force',
    'gh pr create --title "..." --body "..."',
    'npm run qa',
    'npm run test:unit',
    'node scripts/generate-module-graph.js --fingerprint-only',
    'node "/path with spaces/scripts/script.js"',
    'bash scripts/qa.sh',
    'python3 -m json.tool < file.json',
    'git -C "/path with spaces/repo" status',
    'git ls-files functions/',
    "sed -i 's/foo/bar/' file",
    "sed -i 's/-n/x/' file",
    'git status && cat file.js',
  ];

  for (const cmd of allowCases) {
    test(`ALLOW: ${cmd}`, () => {
      const result = evaluate(cmd);
      assert.equal(result, null, `Expected ALLOW for: ${cmd} — got rule "${result && result.id}"`);
    });
  }
});

// ---------------------------------------------------------------------------
// Partie B — tests E2E via spawnSync (stdin JSON → stdout JSON)
// ---------------------------------------------------------------------------

/**
 * Appelle le script avec un JSON en stdin.
 * Retourne l'objet parsé depuis stdout.
 */
function callHook(payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [SCRIPT], {
    input,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error) throw result.error;
  const out = result.stdout.trim();
  return out ? JSON.parse(out) : {};
}

function makeBashPayload(command) {
  return {
    tool_name: 'Bash',
    hook_event_name: 'PreToolUse',
    tool_input: { command },
  };
}

describe('bash-discipline-gate — E2E via spawnSync', () => {
  test('cd-chain → permissionDecision deny', () => {
    const out = callHook(makeBashPayload('cd /tmp && ls'));
    assert.equal(
      out.hookSpecificOutput.permissionDecision,
      'deny'
    );
    assert.ok(
      out.hookSpecificOutput.permissionDecisionReason.includes('bash-gate/cd-chain'),
      `reason should include bash-gate/cd-chain, got: ${out.hookSpecificOutput.permissionDecisionReason}`
    );
  });

  test('git status → pass-through (empty object)', () => {
    const out = callHook(makeBashPayload('git status'));
    assert.deepEqual(out, {});
  });

  test('JSON invalide en stdin → fail-open (empty object)', () => {
    const out = callHook('this is not json at all }{');
    assert.deepEqual(out, {});
  });

  test('stdin vide → fail-open (empty object)', () => {
    const out = callHook('');
    assert.deepEqual(out, {});
  });

  test('tool_name Read (pas Bash) → guard défensif (empty object)', () => {
    const out = callHook({
      tool_name: 'Read',
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'cat file.js' },
    });
    assert.deepEqual(out, {});
  });

  test('hook_event_name PostToolUse → guard défensif (empty object)', () => {
    const out = callHook({
      tool_name: 'Bash',
      hook_event_name: 'PostToolUse',
      tool_input: { command: 'cat file.js' },
    });
    assert.deepEqual(out, {});
  });

  test('cat avec chemin à espaces → deny cat-bash', () => {
    const out = callHook(makeBashPayload('cat "/path with spaces/file.js"'));
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('node avec chemin à espaces → pass-through (empty object)', () => {
    const out = callHook(makeBashPayload('node "/path with spaces/script.js"'));
    assert.deepEqual(out, {});
  });

  test('pipe-head-tail → deny avec reason pipe-head-tail', () => {
    const out = callHook(makeBashPayload('npm run qa 2>&1 | head -50'));
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(
      out.hookSpecificOutput.permissionDecisionReason.includes('pipe-head-tail'),
      `reason should include pipe-head-tail, got: ${out.hookSpecificOutput.permissionDecisionReason}`
    );
  });
});
