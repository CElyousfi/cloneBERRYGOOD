'use strict';

/**
 * Garde-fou « no-undef » sur les scripts de purge/restauration de la caisse.
 *
 * Pourquoi un test dédié : ces deux scripts ont des chemins qui ne s'exécutent
 * qu'en --apply (suppression, restauration, vérif post-write). Une référence à
 * une variable inexistante y reste invisible pour le dry-run ET pour les tests
 * de garde-fous — et ne se révèle qu'au pire moment, en pleine opération
 * irréversible. Régression réellement rencontrée : `db is not defined` dans
 * restoreCaisse.verifyPostWrite après le passage au chargement paresseux de
 * firebase-admin.
 *
 * Le repo n'a pas d'ESLint ; l'analyse s'appuie sur @babel/parser +
 * @babel/traverse, déjà présents (build frontend), donc aucune dépendance
 * nouvelle. `scope.globals` liste toute référence sans binding dans le module :
 * tout ce qui n'est pas un global Node légitime est un bug.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'functions', 'scripts');

// Globals légitimes en CommonJS/Node 20 (le reste doit être déclaré).
const GLOBALS_AUTORISES = new Set([
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'process',
  'console',
  'Buffer',
  'globalThis',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'queueMicrotask',
  'URL',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'structuredClone',
  // Intrinsèques ECMAScript.
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Proxy',
  'Reflect',
  'Error',
  'TypeError',
  'RangeError',
  'Intl',
  'isNaN',
  'isFinite',
  'parseInt',
  'parseFloat',
  'undefined',
  'NaN',
  'Infinity',
]);

function globalsNonDeclares(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(code, { sourceType: 'script', allowReturnOutsideFunction: false });
  let found = [];
  traverse(ast, {
    Program(programPath) {
      found = Object.keys(programPath.scope.globals).filter((n) => !GLOBALS_AUTORISES.has(n));
      programPath.stop();
    },
  });
  return found.sort();
}

for (const fichier of fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.js'))) {
  test(`no-undef : functions/scripts/${fichier} ne référence aucun identifiant non défini`, () => {
    const undef = globalsNonDeclares(path.join(SCRIPTS_DIR, fichier));
    assert.deepStrictEqual(
      undef,
      [],
      `identifiant(s) non défini(s) dans ${fichier} : ${undef.join(', ')}`
    );
  });
}

test('no-undef : le détecteur repère bien une variable fantôme', () => {
  // Contrôle de non-complaisance : sans ce test, un détecteur cassé
  // (allowlist trop large, traverse muet) passerait pour vert.
  const tmp = path.join(
    fs.mkdtempSync(path.join(require('os').tmpdir(), 'noundef-')),
    'fantome.js'
  );
  fs.writeFileSync(tmp, 'function f(){ return db.collection("x"); }\nmodule.exports = f;\n', 'utf8');
  assert.deepStrictEqual(globalsNonDeclares(tmp), ['db']);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});
