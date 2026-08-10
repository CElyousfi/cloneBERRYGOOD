'use strict';

/**
 * Contrat du bash-discipline-gate — v2.
 *
 * CHANGEMENT vs v1 : le gate ne refuse plus les commandes de lecture
 * (grep/cat/ls/find/head/tail/wc/sed -n). La v1 les renvoyait vers les
 * outils natifs Grep/Glob, absents de nos sessions depuis le passage à
 * la recherche via Bash — d'où une boucle deny → impasse. Et elle
 * laissait passer les formes réellement destructrices (sed -i, find -exec,
 * force-push, rm -rf, firebase deploy).
 *
 * v2 : ne se prononce que sur le destructeur et l'exfiltrant.
 * Tout le reste → pas de décision, la couche permission tranche.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GATE = path.join(__dirname, '..', '..', 'scripts', 'bash-discipline-gate.js');
const { evaluate } = require(GATE);

// ---------------------------------------------------------------------------
// A. Non-régression — usage quotidien, aucune décision du gate
// ---------------------------------------------------------------------------

const PASS_CASES = [
  'grep -rn "SMAG" src/',
  'rg --files-with-matches quinzaine functions/',
  'cat package.json',
  'ls -la functions/src',
  'ls',
  'find src -name "*.test.js"',
  'head -50 CLAUDE.md',
  'tail -n 100 logs/deploy.log',
  'wc -l src/modules/paie/index.js',
  "sed -n '120,180p' functions/index.js",
  "sed -i 's/foo/bar/' file",
  'grep -rn TODO src/ | head -20',
  'npm run qa 2>&1 | head -50',
  'git log --oneline | grep pattern',
  'git -C "/path with spaces/repo" status',
  'git status',
  'git log --oneline -20',
  'git add src/file.js',
  'git commit -m "feat: ..."',
  'git push BERRYGOOD main',
  'git ls-files functions/',
  'git worktree list',
  'npm --prefix functions run build',
  'node "/path with spaces/scripts/script.js"',
  'bash scripts/qa.sh',
  'gh pr create --title "..." --body "..."',
  'python3 -m json.tool < file.json',
];

test('v2 — usage quotidien : aucune décision du gate', () => {
  for (const cmd of PASS_CASES) {
    assert.strictEqual(evaluate(cmd), null, `Attendu PASS pour : ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// B. Dangers réels — DENY avec l'identifiant de règle attendu
// ---------------------------------------------------------------------------

const DENY_CASES = [
  ['cd functions && npm run build', 'cd-chain'],
  ['cd /tmp && ls', 'cd-chain'],
  ['cd "$ROOT" && npm run qa', 'cd-chain'],
  ['git push origin main --force', 'force-push'],
  ['git push -f origin main', 'force-push'],
  ['git push --force-with-lease origin sb/feature', 'force-push'],
  ['git reset --hard HEAD~3', 'history-destroy'],
  ['git clean -fdx', 'history-destroy'],
  ['firebase deploy --only functions', 'firebase-direct'],
  ['source .env', 'secret-read'],
  ['cat .env', 'secret-read'],
  ['find . -name "*.js" -exec rm {} \\;', 'find-exec'],
  ['find /var/log -delete', 'find-exec'],
  ['rm -rf build/', 'rm-rf'],
];

test('v2 — dangers canoniques : DENY', () => {
  for (const [cmd, id] of DENY_CASES) {
    const hit = evaluate(cmd);
    assert.ok(hit, `Attendu DENY pour : ${cmd}`);
    assert.strictEqual(hit.id, id, `Mauvaise règle pour : ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// C. Contournements — le nom du binaire ne doit pas suffire à échapper
// ---------------------------------------------------------------------------

const EVASIONS = [
  ['sudo rm -rf /var/www', 'rm-rf'],
  ['/usr/bin/find . -delete', 'find-exec'],
  ['ls -la && rm -rf build', 'rm-rf'],
  ['timeout 30 firebase deploy', 'firebase-direct'],
  ['git status; git push --force origin main', 'force-push'],
  ['FIREBASE_TOKEN=x firebase deploy', 'firebase-direct'],
];

test('v2 — contournements : DENY malgré enveloppe/chemin/chaînage', () => {
  for (const [cmd, id] of EVASIONS) {
    const hit = evaluate(cmd);
    assert.ok(hit, `Attendu DENY pour : ${cmd}`);
    assert.strictEqual(hit.id, id, `Mauvaise règle pour : ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// D. Faux positifs — le piège des motifs trop gourmands
// ---------------------------------------------------------------------------

const FALSE_POSITIVES = [
  'rm -rf /tmp/build-cache',
  'cat .env.example',
  'cp .env.example .env.local',
  'grep -rn "rm -rf" docs/',
  'git log --grep="cd functions && build"',
  'git clean -n',
  'find . -name "*.env.example"',
];

test('v2 — faux positifs : le contenu cité n\'est pas une commande', () => {
  for (const cmd of FALSE_POSITIVES) {
    assert.strictEqual(evaluate(cmd), null, `Attendu PASS pour : ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// E. Robustesse E2E — le hook ne doit jamais planter ni bloquer par accident
// ---------------------------------------------------------------------------

function runHook(payload) {
  const res = spawnSync('node', [GATE], { input: payload, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, 'le hook doit toujours sortir en 0');
  return JSON.parse(res.stdout || '{}');
}

const bashPayload = (command) => JSON.stringify({
  tool_name: 'Bash', hook_event_name: 'PreToolUse', tool_input: { command },
});

test('E2E — cd-chain → permissionDecision deny', () => {
  const out = runHook(bashPayload('cd functions && npm run build'));
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /cd-chain/);
});

test('E2E — commande de lecture → aucune décision', () => {
  assert.deepStrictEqual(runHook(bashPayload('cat public/app.jsx')), {});
  assert.deepStrictEqual(runHook(bashPayload('git status')), {});
  assert.deepStrictEqual(runHook(bashPayload('npm run qa 2>&1 | head -50')), {});
});

test('E2E — entrées dégradées → aucune décision, jamais de crash', () => {
  assert.deepStrictEqual(runHook('{{{invalide'), {});
  assert.deepStrictEqual(runHook(''), {});
  assert.deepStrictEqual(runHook(bashPayload('')), {});
});

test('E2E — garde défensif sur tool_name / hook_event_name', () => {
  assert.deepStrictEqual(runHook(JSON.stringify({
    tool_name: 'Read', hook_event_name: 'PreToolUse', tool_input: { command: 'rm -rf /' },
  })), {});
  assert.deepStrictEqual(runHook(JSON.stringify({
    tool_name: 'Bash', hook_event_name: 'PostToolUse', tool_input: { command: 'rm -rf /' },
  })), {});
});

// --- workflow-dispatch -------------------------------------------------------
// Le déclenchement d'un workflow est refusé par le HOOK, pas seulement par le `ask`
// de settings.json : le matching `Bash(gh workflow run:*)` est un PRÉFIXE, et
// `GH_REPO=x gh workflow run`, un double espace ou `gh workflow --repo X run` y
// échappent. Le deploy prod passe par scripts/deploy.sh (gaté et journalisé).
// L'ordre `workflow` PUIS `run` distingue le déclenchement de la LECTURE
// (`gh run list --workflow X`), qui doit rester libre.

test('workflow-dispatch — route API .../dispatches → deny', () => {
  const hit = evaluate('gh api -X POST repos/o/r/actions/workflows/deploy-prod.yml/dispatches -f ref=main');
  assert.strictEqual(hit && hit.id, 'workflow-dispatch');
});

test('workflow-dispatch — URL entre guillemets → deny (testé sur la commande brute)', () => {
  const hit = evaluate('gh api "repos/o/r/actions/workflows/deploy-prod.yml/dispatches" -f ref=main');
  assert.strictEqual(hit && hit.id, 'workflow-dispatch');
});

test('workflow-dispatch — commande directe et ses contournements de préfixe → deny', () => {
  for (const cmd of [
    'gh workflow run deploy-prod.yml --ref main',
    'GH_REPO=o/r gh workflow run deploy-prod.yml',
    'gh  workflow  run deploy-prod.yml',
    'gh workflow --repo o/r run deploy-prod.yml',
  ]) {
    const hit = evaluate(cmd);
    assert.strictEqual(hit && hit.id, 'workflow-dispatch', `attendu deny pour: ${cmd}`);
  }
});

test('workflow-dispatch — la LECTURE des runs reste libre (pas de faux positif)', () => {
  for (const cmd of [
    'gh run list --workflow deploy-prod.yml',
    'gh run watch --repo o/r',
    'gh run view 123 --log',
    'gh workflow list',
    'gh api repos/o/r/environments/production',
    'gh pr create --draft',
    'gh pr merge 222 --squash',
  ]) {
    assert.strictEqual(evaluate(cmd), null, `attendu pass pour: ${cmd}`);
  }
});

test('workflow-dispatch — scripts/deploy.sh reste le chemin autorisé', () => {
  assert.strictEqual(evaluate('scripts/deploy.sh functions'), null);
  assert.strictEqual(evaluate('scripts/deploy.sh functions --dry-run'), null);
});

// Régression 2026-08-10 : la v1 de la règle testait la commande BRUTE et refusait
// un `gh pr create` dont le CORPS du message contenait les deux mots-clés — ils
// venaient du texte, pas de la commande. Une règle qui bloque des commandes saines
// finit contournée sans qu'on le voie. La v2 teste le scan (contenu cité vidé) et
// borne la distance entre les mots.
// Les mots sont assemblés par concaténation pour que ce fichier de test ne
// déclenche pas lui-même la règle quand il apparaît dans une ligne de commande.

test('workflow-dispatch — un `gh pr create` dont le TEXTE contient les mots passe', () => {
  const W = 'work' + 'flow';
  const R = 'r' + 'un';
  const cmd = 'gh pr create --title t --body "passe par le ' + W + ', puis npm ' + R + ' qa"';
  assert.strictEqual(evaluate(cmd), null, 'faux positif sur : ' + cmd);
});

test('workflow-dispatch — deux mots éloignés dans un texte ne déclenchent pas', () => {
  const W = 'work' + 'flow';
  const R = 'r' + 'un';
  const loin = 'gh pr comment 12 --body "' + W + ' ' + 'x'.repeat(120) + ' ' + R + '"';
  assert.strictEqual(evaluate(loin), null);
});

test('workflow-dispatch — le vrai déclenchement reste bloqué malgré la correction', () => {
  const W = 'work' + 'flow';
  const R = 'r' + 'un';
  const hit = evaluate('gh ' + W + ' ' + R + ' deploy-prod.yml --ref main');
  assert.strictEqual(hit && hit.id, 'workflow-dispatch');
});
