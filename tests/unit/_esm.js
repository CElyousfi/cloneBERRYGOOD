'use strict';
/* _esm — charge un module ES de src/ depuis un test node:test (CommonJS).
 *
 * Les helpers et composants du frontend sont des modules ES (.js/.jsx sous
 * src/modules). Les tests restent en CommonJS et Node 20 (CI) ne sait pas
 * les `require()` : on les transforme à la volée avec Babel (JSX → React.createElement,
 * ESM → CJS), récursivement pour les imports relatifs, avec un cache pour ne
 * transformer chaque fichier qu'une fois par contexte.
 *
 * Deux modes :
 *   loadEsm(rel)                    → exécute dans le contexte Node courant ;
 *   loadEsm(rel, { sandbox })       → exécute DANS un contexte vm (window, React
 *                                     factices…) — l'équivalent de l'ancien
 *                                     vm.runInContext(script IIFE, sandbox).
 * `stubs` : { 'src/modules/x/y.js': objet } remplace un module importé par un
 * double, sans le charger (chemin relatif à la racine du dépôt).
 *
 * Pas un test : le script test:unit ne lance que les *.test.js.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');
const EXTS = ['.js', '.jsx', '/index.js', '/index.jsx'];

function resolveRel(fromAbs, id) {
  const base = path.resolve(path.dirname(fromAbs), id);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTS) if (fs.existsSync(base + ext)) return base + ext;
  throw new Error('_esm : import introuvable ' + id + ' depuis ' + path.relative(ROOT, fromAbs));
}

function transform(absPath) {
  return babel.transformFileSync(absPath, {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    plugins: [['@babel/plugin-transform-modules-commonjs']],
    babelrc: false, configFile: false, sourceType: 'module', compact: false,
  }).code;
}

/** cache par contexte (WeakMap sandbox → Map chemin → module), + contexte courant */
const caches = new WeakMap();
const mainCache = new Map();
function cacheFor(sandbox) {
  if (!sandbox) return mainCache;
  if (!caches.has(sandbox)) caches.set(sandbox, new Map());
  return caches.get(sandbox);
}

/**
 * @param {string} rel chemin relatif à la racine du dépôt (ou absolu)
 * @param {{ sandbox?: object, stubs?: Record<string, any> }} [opts]
 * @returns {any} l'espace de noms du module (exports nommés)
 */
function loadEsm(rel, opts) {
  opts = opts || {};
  const absPath = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  const cache = cacheFor(opts.sandbox);
  if (cache.has(absPath)) return cache.get(absPath).exports;
  const relRoot = path.relative(ROOT, absPath).split(path.sep).join('/');
  if (opts.stubs && Object.prototype.hasOwnProperty.call(opts.stubs, relRoot)) {
    const mod = { exports: opts.stubs[relRoot] };
    cache.set(absPath, mod);
    return mod.exports;
  }
  const code = transform(absPath);
  const mod = { exports: {} };
  cache.set(absPath, mod); // avant exécution : coupe les cycles éventuels
  const wrapperSrc = '(function (module, exports, require, __filename, __dirname) {' + code + '\n})';
  const wrapper = opts.sandbox
    ? vm.runInContext(wrapperSrc, opts.sandbox, { filename: absPath })
    : vm.runInThisContext(wrapperSrc, { filename: absPath });
  const requireFn = (id) => {
    if (id.startsWith('.')) return loadEsm(resolveRel(absPath, id), opts);
    return require(id);
  };
  wrapper(mod, mod.exports, requireFn, absPath, path.dirname(absPath));
  return mod.exports;
}

module.exports = { loadEsm, ROOT };
