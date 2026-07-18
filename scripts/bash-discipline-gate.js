'use strict';

/** Extrait le premier token effectif (ignore les VAR=val en tête). */
function firstToken(cmd) {
  const m = cmd.trimStart().match(/^(?:\S+=\S+\s+)*(\S+)/);
  return m ? m[1] : '';
}

/** Tokenise en respectant les guillemets simples et doubles. */
function tokenize(cmd) {
  return (cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
    .map(t => t.replace(/^["']|["']$/g, ''));
}

/**
 * Pour sed : vérifie qu'un flag -n/--quiet/--silent est présent comme token standalone
 * (évite le faux positif sed -i 's/-n/x/' file).
 */
function hasSedQuietFlag(command) {
  return tokenize(command).slice(1).some(t =>
    t === '-n' || /^-[a-z]*n[a-z]*$/.test(t) || t === '--quiet' || t === '--silent'
  );
}

const RULES = [
  {
    id: 'cd-chain',
    test: (cmd) => /\bcd\s+[^\n;&|]*&&/.test(cmd),
    message: 'Utilise un chemin absolu ou `git -C "<path>" <cmd>` — pas de `cd … &&`'
  },
  {
    id: 'grep-bash',
    test: (cmd, ft) => ft === 'grep' || ft === 'rg',
    message: 'Utilise l\'outil natif Grep (non gatté, pas de prompt permission)'
  },
  {
    id: 'cat-bash',
    test: (cmd, ft) => ft === 'cat',
    message: 'Utilise Read (lecture) ou Write/Edit (écriture)'
  },
  {
    id: 'head-tail-bash',
    test: (cmd, ft) => ft === 'head' || ft === 'tail',
    message: 'Utilise Read avec les paramètres offset et limit'
  },
  {
    id: 'sed-n-bash',
    test: (cmd, ft) => ft === 'sed' && hasSedQuietFlag(cmd),
    message: 'Utilise Read avec les paramètres offset et limit'
  },
  {
    id: 'find-bash',
    test: (cmd, ft) => ft === 'find',
    message: 'Utilise l\'outil natif Glob (non gatté, pas de prompt permission)'
  },
  {
    id: 'wc-bash',
    test: (cmd, ft) => ft === 'wc',
    message: 'Utilise Read ou Grep'
  },
  {
    id: 'ls-bash',
    test: (cmd, ft) => ft === 'ls',
    message: 'Utilise l\'outil natif Glob (non gatté, pas de prompt permission)'
  },
  {
    id: 'pipe-grep-rg',
    test: (cmd) => /\|\s*(?:grep|rg)\b/.test(cmd),
    message: 'Utilise Grep directement (pas de pipeline Bash)'
  },
  {
    id: 'pipe-head-tail',
    test: (cmd) => /\|\s*(?:head|tail)\b/.test(cmd),
    message: 'Utilise Read avec les paramètres offset et limit'
  },
];

/** Évalue la commande. Retourne { id, message } si DENY, null sinon. */
function evaluate(command) {
  const ft = firstToken(command);
  for (const rule of RULES) {
    if (rule.test(command, ft)) return { id: rule.id, message: rule.message };
  }
  return null;
}

function runHook() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(raw);
      // Vérification défensive
      if (data.tool_name !== 'Bash' || data.hook_event_name !== 'PreToolUse') {
        process.stdout.write('{}');
        process.exit(0);
      }
      const command = (data.tool_input && data.tool_input.command) || '';
      const hit = evaluate(command);
      if (hit) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `[bash-gate/${hit.id}] ${hit.message}`
          }
        }));
        process.exit(0);
      }
    } catch (_) { /* fail-open */ }
    process.stdout.write('{}');
    process.exit(0);
  });
}

if (require.main === module) runHook();

module.exports = { evaluate, firstToken, tokenize, hasSedQuietFlag, runHook };
