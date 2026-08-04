'use strict';

/**
 * bash-discipline-gate.js — PreToolUse hook (matcher: "Bash")  — v2
 *
 * CHANGEMENT DE PRINCIPE vs v1 :
 *   v1 refusait des commandes SÛRES (grep/cat/ls/find/head/tail/wc/sed -n)
 *       en renvoyant vers les outils natifs Grep/Glob — qui ne sont PAS
 *       disponibles dans nos sessions. D'où la boucle deny -> impasse.
 *       Et elle laissait passer les formes DANGEREUSES (sed -i, find -exec).
 *
 *   v2 ne se prononce que sur ce qui est réellement destructeur ou
 *       exfiltrant. Tout le reste : aucune décision, le flux de permission
 *       normal s'applique (et settings.json l'autorise sans prompt).
 *
 * Le hook est désormais l'UNIQUE couche de sécurité, puisque settings.json
 * autorise Bash largement. Un deny de hook tient même en bypassPermissions
 * et même en headless — c'est ce qui protège le runtime VPS.
 *
 * Sortie : exit 0 + JSON. `{}` = pas de décision.
 */

/** Premier token effectif (ignore VAR=val et les enveloppes usuelles). */
function firstToken(cmd) {
  const WRAP = new Set(['sudo', 'env', 'time', 'timeout', 'nice', 'nohup', 'command', 'xargs']);
  const toks = cmd.trimStart().split(/\s+/);
  for (const t of toks) {
    if (/^\S+=\S+$/.test(t)) continue;
    if (WRAP.has(t)) continue;
    return t.split('/').pop();
  }
  return '';
}

const RULES = [
  {
    id: 'cd-chain',
    test: (c) => /(^|[\s;&|(])cd\s+[^\n;&|]*&&/.test(c),
    msg: 'Pas de `cd … &&` (CLAUDE.md) : ça déplace le cwd de la session. '
       + 'Utilise `git -C "<path>" <cmd>`, `npm --prefix <path> …`, ou un chemin absolu.',
  },
  {
    id: 'force-push',
    test: (c) => /\bgit\b[\s\S]*\bpush\b/.test(c)
              && /(\s-f(\s|$)|--force(-with-lease)?\b)/.test(c),
    msg: "Force-push interdit à l'agent (CLAUDE.md). Y compris --force-with-lease. À faire manuellement si nécessaire.",
  },
  {
    id: 'history-destroy',
    test: (c) => /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|filter-branch|reflog\s+expire)/.test(c),
    msg: "Destruction d'historique interdite à l'agent. À faire manuellement si voulu.",
  },
  {
    id: 'firebase-direct',
    test: (c) => /\bfirebase\s+deploy\b/.test(c),
    msg: 'Passe par `scripts/deploy.sh` (gaté et journalisé), pas `firebase deploy` en direct.',
  },
  {
    id: 'secret-read',
    test: (c) => /(^|[\s;&|])(source|\.)\s+\S*\.env(?!\.(example|sample|template|dist))\b/.test(c)
              || /\b(cat|less|more|head|tail|xxd|base64|printenv)\b[^\n;&|]*\.env(?!\.(example|sample|template|dist))(\b|$)/.test(c),
    msg: 'Lecture directe de .env interdite. Les scripts gatés chargent leurs secrets eux-mêmes.',
  },
  {
    id: 'find-exec',
    test: (c) => /\bfind\b/.test(c) && /\s-(exec|execdir|ok|okdir|delete|fprintf|fls|fprint)\b/.test(c),
    msg: '`find -exec` / `-delete` interdit : exécution et écriture arbitraires.',
  },
  {
    id: 'rm-rf',
    test: (c) => /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/.test(c)
              && !/\s\/tmp\//.test(c),
    msg: '`rm -rf` interdit hors /tmp. Supprime ciblé, ou fais-le manuellement.',
  },
];

/**
 * Neutralise le contenu entre guillemets : une chaîne de recherche n'est pas
 * une commande. Sans ça, `grep -rn "rm -rf" docs/` déclenche la règle rm-rf.
 * La structure est préservée, seul le contenu cité est vidé.
 */
function stripQuoted(cmd) {
  return cmd.replace(/"[^"]*"|'[^']*'/g, '""');
}

/** Retourne { id, msg } si DENY, null sinon. */
function evaluate(command) {
  const scan = stripQuoted(command);
  const ft = firstToken(scan);
  for (const r of RULES) {
    if (r.test(scan, ft)) return { id: r.id, msg: r.msg };
  }
  return null;
}

function runHook() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let out = '{}';
    try {
      const data = JSON.parse(raw);
      if (data.tool_name === 'Bash' && data.hook_event_name === 'PreToolUse') {
        const hit = evaluate((data.tool_input && data.tool_input.command) || '');
        if (hit) {
          out = JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: `[bash-gate/${hit.id}] ${hit.msg}`,
            },
          });
        }
      }
    } catch (_) { /* parse impossible -> pas de décision */ }
    process.stdout.write(out);
    process.exit(0);
  });
}

if (require.main === module) runHook();

module.exports = { evaluate, firstToken, stripQuoted, RULES };
