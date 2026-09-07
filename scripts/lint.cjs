#!/usr/bin/env node
/* lint — garde de syntaxe du dépôt.
 *
 * Il n'y a jamais eu d'ESLint ici, et en brancher un sur ~70 000 lignes gelées
 * pour non-régression produirait des milliers d'avertissements de style sans
 * rapport avec le travail en cours. Ce que cette garde vérifie est plus étroit
 * mais réellement utile : TOUT fichier JS/JSX versionné doit être analysable.
 *
 * `node --check` ne convenait pas : il suppose du CommonJS et rejette les
 * modules ES (src/modules/**, les configs Vite). On analyse donc chaque fichier
 * avec @babel/parser, dans le dialecte qui lui correspond — module s'il porte
 * import/export, script sinon, plus le plugin JSX pour les .jsx.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const parser = require('@babel/parser');

const ROOT = path.join(__dirname, '..');
const SKIP = /^(node_modules|dist|dist-migrated|dist-vercel|\.vercel)\//;

const files = cp.execSync("git ls-files '*.js' '*.cjs' '*.mjs' '*.jsx'", { cwd: ROOT, maxBuffer: 1e8 })
  .toString().split('\n').filter(f => f && !SKIP.test(f));

/* Défauts PRÉEXISTANTS, hérités de l'amont : signalés à chaque exécution, mais
 * non bloquants. Le brief demande de signaler un bug amont, pas de le corriger.
 * Retirer une entrée d'ici est une décision volontaire, pas un nettoyage. */
const KNOWN = {
  'scriptable/BGF-PFQ.js':
    "chemin de capture d'écran macOS collé par accident dans le source (l.117) — " +
    'le fichier ne peut pas être analysé. Présent en amont depuis 9dfc88a (2026-03-28).',
};

const PLUGINS = ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread'];
let bad = 0;
const known = [];
for (const f of files) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  const isModule = f.endsWith('.mjs') || /^\s*(import|export)\s/m.test(src);
  const OPTS = {
    allowReturnOutsideFunction: true,
    // Les widgets scriptable/ tournent dans l'app iOS
    // Scriptable, qui autorise l'await de premier niveau.
    allowAwaitOutsideFunction: true,
    plugins: PLUGINS,
  };
  try {
    try {
      parser.parse(src, Object.assign({ sourceType: isModule ? 'module' : 'script' }, OPTS));
    } catch (premier) {
      // L'heuristique ci-dessus cherche `import`/`export` en DÉBUT de ligne :
      // vraie sur du source, fausse sur un bundle minifié où tout tient sur
      // quelques lignes (`export{a as b}`, `import("./chunks/X.js")`). Le
      // linter ne juge que la validité syntaxique — un fichier qui parse dans
      // l'un des deux modes est valide. On retente donc en module avant de
      // conclure, plutôt que d'exclure les artefacts générés de l'analyse.
      if (isModule) throw premier;
      parser.parse(src, Object.assign({ sourceType: 'module' }, OPTS));
    }
  } catch (e) {
    const where = `${f}:${e.loc ? e.loc.line : '?'}`;
    if (KNOWN[f]) { known.push(`${where} — ${KNOWN[f]}`); continue; }
    bad++;
    console.log(`SYNTAXE ${where} — ${e.message.split('\n')[0]}`);
  }
}
if (known.length) {
  console.log('\nDéfauts amont connus (signalés, non corrigés) :');
  known.forEach(k => console.log(`  - ${k}`));
  console.log('');
}
console.log(`${files.length} fichiers analysés, ${bad} en erreur, ${known.length} défaut(s) amont connu(s)`);
if (bad) { console.log('✘ lint'); process.exit(1); }
console.log('✔ syntaxe OK');
