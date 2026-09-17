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

/* Globales d'application que les composants importent désormais : quand un test
 * pose un double sur `sandbox.window.<nom>` (ancien contrat des scripts
 * classiques), loadComponent le sert au module importé, à la place du vrai. */
const APP_GLOBALS = {
  cachedFetch: 'src/modules/shared/cachedFetch.jsx',
  deriveSubFerme: 'src/modules/shared/deriveSubFerme.jsx',
  sbParcelleHa: 'src/modules/agronomie/sbParcelleHa.jsx',
  sbParcelleNom: 'src/modules/agronomie/sbParcelleNom.jsx',
  nomOuvrier: 'src/modules/rh/nomOuvrier.jsx',
  PointageTab: 'src/modules/rh/PointageTab.jsx',
  PARCELLES_CULTURALES: 'src/modules/agronomie/PARCELLES_CULTURALES.jsx',
  TXN_TYPE_LABELS: 'src/modules/caisse/TXN_TYPE_LABELS.jsx',
  loadBonsFromFirestore: 'src/modules/shared/loadBonsFromFirestore.jsx',
  useStockLocations: 'src/modules/shared/lib/useStockLocations.js',
};
const MODULE_DIRS = ['achats', 'admin', 'agronomie', 'caisse', 'finance', 'magasin', 'qualite', 'recolte', 'rh', 'securite', 'shared', 'technique'];

/**
 * Charge un composant (module ES) dans un contexte vm, en servant aux imports
 * les doubles que le test a posés sur `sandbox.window` :
 *   - window.<Helper>   (ex. CampagneUtils, ImageDownscale) → module shared/lib ;
 *   - window.<Composant> (ex. BCDoublonDialog)             → export nommé du composant ;
 *   - window.<globale app> (cachedFetch, useStockLocations…) → export nommé ;
 *   - window.SB_PARCELLE_REF / SB_PARCELLE_CAMPAGNE          → sbParcelleState.
 * `React` doit être une globale du contexte : on le copie depuis window.React.
 * @param {string} rel
 * @param {object} sandbox contexte vm (créé ou non — createContext est appliqué si besoin)
 * @param {Record<string, any>} [extraStubs]
 */
function loadComponent(rel, sandbox, extraStubs) {
  if (!vm.isContext(sandbox)) vm.createContext(sandbox);
  const win = sandbox.window || {};
  if (win.React && !sandbox.React) sandbox.React = win.React;
  const stubs = Object.assign({}, extraStubs || {});
  const add = (p, key, value) => { stubs[p] = Object.assign({}, stubs[p] || {}, { [key]: value }); };
  for (const key of Object.keys(win)) {
    if (key === 'React') continue;
    const v = win[key];
    if (APP_GLOBALS[key]) { add(APP_GLOBALS[key], key, v); continue; }
    if (key === 'SB_PARCELLE_REF' || key === 'SB_PARCELLE_CAMPAGNE') {
      const p = 'src/modules/shared/sbParcelleState.js';
      const cur = (stubs[p] && stubs[p].sbParcelle) || { REF: undefined, CAMPAGNE: undefined };
      cur[key === 'SB_PARCELLE_REF' ? 'REF' : 'CAMPAGNE'] = v;
      stubs[p] = { sbParcelle: cur };
      continue;
    }
    const lib = 'src/modules/shared/lib/' + key[0].toLowerCase() + key.slice(1) + '.js';
    if (fs.existsSync(path.join(ROOT, lib))) { if (!(lib in stubs)) stubs[lib] = v; continue; }
    for (const d of MODULE_DIRS) {
      const comp = 'src/modules/' + d + '/' + key + '.jsx';
      if (fs.existsSync(path.join(ROOT, comp))) { add(comp, key, v); break; }
    }
  }
  return loadEsm(rel, { sandbox, stubs });
}

module.exports = { loadEsm, loadComponent, ROOT };
