/* verify-references — toute référence libre de src/modules doit se résoudre.
 *
 * Pour chaque fichier .js/.jsx de src/modules, on collecte les identifiants
 * libres (non liés dans le module) et on vérifie qu'aucun ne porte le nom
 * d'un export ES du tree : un tel nom libre est un import oublié après un
 * découpage ou un déplacement de fichier. Sortie ≠ 0 si un problème est
 * trouvé — c'est une gate (npm run verify:refs, CI).
 */
const fs = require('fs'), p = require('path');
const R = p.resolve(__dirname, '..');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const OUT = p.join(R, 'src/modules');
const files = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = p.join(d, e.name);
    e.isDirectory() ? w(f) : (/\.jsx?$/.test(e.name) && files.push(f));
  }
})(OUT);

// Noms exportés par le tree : `export { a, b };` et `export function/const/class X`.
const exported = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\nexport \{([^}]*)\};?/g)) {
    m[1].split(',').forEach(s => { const nm = s.trim().split(/\s+as\s+/).pop(); if (nm) exported.add(nm); });
  }
  for (const m of src.matchAll(/\nexport (?:async )?(?:function\*?|const|let|var|class) ([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
}

let problems = 0, totalFree = 0;
const missingByFile = {};
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'objectRestSpread'] });
  const missing = new Set();
  traverse(ast, { Program(path) {
    const g = path.scope.globals; // identifiants libres, non liés dans ce module
    for (const nm of Object.keys(g)) { totalFree++; if (exported.has(nm)) missing.add(nm); }
    path.stop();
  } });
  if (missing.size) { problems++; missingByFile[p.relative(OUT, f)] = [...missing]; }
}
console.log('modules scanned:', files.length);
console.log('files with UNRESOLVED top-level refs:', problems);
const ents = Object.entries(missingByFile);
ents.slice(0, 15).forEach(([f, ns]) => console.log('  ', f, '->', ns.join(', ')));
if (ents.length > 15) console.log('  ... +', ents.length - 15, 'more');
process.exit(problems ? 1 : 0);
