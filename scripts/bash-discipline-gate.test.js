'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const GATE = process.argv[2] || path.join(__dirname, 'bash-discipline-gate.js');

function run(command, toolName = 'Bash', evt = 'PreToolUse') {
  const payload = JSON.stringify({
    tool_name: toolName, hook_event_name: evt, tool_input: { command },
  });
  const out = execFileSync('node', [GATE], { input: payload, encoding: 'utf8' });
  const j = JSON.parse(out || '{}');
  const hso = j.hookSpecificOutput;
  return hso ? (hso.permissionDecision + ':' + (hso.permissionDecisionReason || '').match(/\[bash-gate\/([\w-]+)\]/)?.[1]) : 'pass';
}

// A. formes légitimes quotidiennes -> doivent PASSER
const A = [
  'grep -rn "SMAG" src/',
  'rg --files-with-matches quinzaine functions/',
  'cat package.json',
  'ls -la functions/src',
  'find src -name "*.test.js"',
  'head -50 CLAUDE.md',
  'tail -n 100 logs/deploy.log',
  'wc -l src/modules/paie/index.js',
  "sed -n '120,180p' functions/index.js",
  'grep -rn TODO src/ | head -20',
  'git -C ../BERRYGOOD-wt status',
  'git log --oneline -20',
  'npm --prefix functions run build',
  'git worktree list',
];

// B. dangers canoniques -> doivent DENY (id attendu)
const B = [
  ['cd functions && npm run build', 'cd-chain'],
  ['git push origin main --force', 'force-push'],
  ['git push -f origin main', 'force-push'],
  ['git reset --hard HEAD~3', 'history-destroy'],
  ['firebase deploy --only functions', 'firebase-direct'],
  ['source .env', 'secret-read'],
  ['cat .env', 'secret-read'],
  ['find . -name "*.js" -exec rm {} \\;', 'find-exec'],
  ['find /var/log -delete', 'find-exec'],
  ['rm -rf build/', 'rm-rf'],
];

// C. contournements -> doivent DENY aussi
const C = [
  ['sudo rm -rf /var/www', 'rm-rf'],
  ['/usr/bin/find . -delete', 'find-exec'],
  ['ls -la && rm -rf build', 'rm-rf'],
  ['timeout 30 firebase deploy', 'firebase-direct'],
  ['git status; git push --force origin main', 'force-push'],
  ['git push --force-with-lease origin sb/feature', 'force-push'],
  ['FIREBASE_TOKEN=x firebase deploy', 'firebase-direct'],
];

// D. faux positifs -> doivent PASSER
const D = [
  'rm -rf /tmp/build-cache',
  'cat .env.example',
  'cp .env.example .env.local',
  'grep -rn "rm -rf" docs/',
  'git log --grep="cd functions && build"',
  'echo "source .env is forbidden" >> CLAUDE.md',
  'git clean -n',
  'find . -name "*.env.example"',
];

let fail = 0;
const line = (ok, label, got, want) => {
  if (!ok) { fail++; console.log(`   FAIL  ${label}\n         attendu=${want}  obtenu=${got}`); }
};

console.log('\n=== A. non-régression : usage quotidien (attendu: pass) ===');
A.forEach(c => { const g = run(c); line(g === 'pass', c, g, 'pass'); });

console.log('=== B. dangers canoniques (attendu: deny) ===');
B.forEach(([c, id]) => { const g = run(c); line(g === 'deny:' + id, c, g, 'deny:' + id); });

console.log('=== C. contournements (attendu: deny) ===');
C.forEach(([c, id]) => { const g = run(c); line(g === 'deny:' + id, c, g, 'deny:' + id); });

console.log('=== D. faux positifs (attendu: pass) ===');
D.forEach(c => { const g = run(c); line(g === 'pass', c, g, 'pass'); });

console.log('=== E. robustesse ===');
line(run('grep x .', 'Read') === 'pass', 'outil non-Bash', run('grep x .', 'Read'), 'pass');
line(run('') === 'pass', 'commande vide', run(''), 'pass');
try {
  const o = execFileSync('node', [GATE], { input: '{{{invalide', encoding: 'utf8' });
  line(o === '{}', 'JSON invalide', o, '{}');
} catch (e) { line(false, 'JSON invalide -> crash', 'exception', '{}'); }

console.log(fail ? `\n>>> ${fail} ÉCHEC(S)\n` : '\n>>> OK — 0 échec\n');
process.exit(fail ? 1 : 0);
