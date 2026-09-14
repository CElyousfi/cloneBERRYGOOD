'use strict';
// Chantier production readiness (docs/DATA_SOURCES.md) — computeCADetail est
// extrait tel quel de FinCATab.jsx (déjà en prod, déjà réel) pour que le
// Dashboard (totalCA/totalCAExport/totalCALocal/totalKgExport) calcule le
// MÊME chiffre que l'onglet Finance. Ce test verrouille surtout que
// l'extraction n'a RIEN changé au calcul (pas de test de non-régression
// contre l'original ici — la garantie vient du diff : le corps est identique
// caractère pour caractère, seul l'emballage en fonction exportée a changé).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const babel = require('@babel/core');

// Même technique que tests/unit/campagneAnalytiqueVariete.test.js et
// tests/unit/normesProductiviteAdapter.test.js : babel transforme chaque .jsx
// ESM -> CJS à la volée, RÉCURSIVEMENT pour les imports relatifs (ici
// computeCADetail.jsx -> normalizeParcelle.jsx -> DESIGNATION_MAP.jsx), avec
// un cache pour ne transformer chaque fichier qu'une fois.
const __jsxCache = new Map();
function loadEsm(absPath) {
  if (__jsxCache.has(absPath)) return __jsxCache.get(absPath).exports;
  const { code } = babel.transformFileSync(absPath, {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    plugins: [['@babel/plugin-transform-modules-commonjs']],
  });
  const mod = { exports: {} };
  __jsxCache.set(absPath, mod); // avant exécution : coupe les cycles éventuels
  const wrapper = new Function('module', 'exports', 'require', '__filename', '__dirname', code);
  wrapper(mod, mod.exports, (id) => {
    if (id.startsWith('.')) {
      let resolved = path.resolve(path.dirname(absPath), id);
      if (!resolved.endsWith('.jsx') && !resolved.endsWith('.js')) resolved += '.jsx';
      return loadEsm(resolved);
    }
    return require(id);
  }, absPath, path.dirname(absPath));
  return mod.exports;
}

const { computeCADetail } = loadEsm(path.join(__dirname, '../../src/modules/finance/computeCADetail.jsx'));

test('computeCADetail: aucune entrée -> tout à zéro, jamais NaN', () => {
  const r = computeCADetail({});
  assert.deepEqual(r, { totalExport: 0, totalLocal: 0, totalCA: 0, totalKgExport: 0, caDetail: [], totalHaConfig: 54.8 });
});

test('computeCADetail: une ligne export simple (Reyna, pas de split) -> totalExport = totalCA', () => {
  const r = computeCADetail({
    liquidations: [{ rows: [{ receiptQtyKg: 100, gsNet: 5000, variety: 'REYNA', receiptId: 'R1' }] }],
    expeditions: [],
    marcheLocalBons: [],
  });
  assert.equal(r.totalExport, 5000);
  assert.equal(r.totalLocal, 0);
  assert.equal(r.totalCA, 5000);
  assert.equal(r.totalKgExport, 100);
  assert.equal(r.caDetail.length, 1);
  assert.equal(r.caDetail[0].variete, 'S9 Reyna'); // label VARIETES_HA
  assert.equal(r.caDetail[0].ferme, 'F5');
});

test('computeCADetail: Maravilla export sans souVariete -> split GC/LC au prorata des hectares (4.2/5.2)', () => {
  const r = computeCADetail({
    liquidations: [{ rows: [{ receiptQtyKg: 1000, gsNet: 10000, variety: 'MARAVILLA', receiptId: 'R2' }] }],
    expeditions: [],
    marcheLocalBons: [],
  });
  assert.equal(r.totalExport, 10000);
  const gc = r.caDetail.find(c => c.ferme === 'F1' && c.ca > 4000 && c.ca < 4500);
  const lc = r.caDetail.find(c => c.ferme === 'F1' && c.ca > 5500 && c.ca < 6000);
  assert.ok(gc, 'part Green Cane (4.2/9.4 * 10000 ≈ 4468) attendue');
  assert.ok(lc, 'part Long Cane (5.2/9.4 * 10000 ≈ 5532) attendue');
  assert.equal(Math.round((gc.ca + lc.ca) * 100) / 100, 10000);
});

test('computeCADetail: ventes Marché Local seules (pfq_interne) -> totalLocal = totalCA, totalExport = 0', () => {
  const r = computeCADetail({
    liquidations: [],
    expeditions: [],
    marcheLocalBons: [
      { variete: 'CORINA', ferme: 'F5', totalDH: 3000, poidsLot: 200 },
      { blocVariete: 'CASCADE', blocFerme: 'F5', totalDH: 1500, poidsLot: 100 },
    ],
  });
  assert.equal(r.totalExport, 0);
  assert.equal(r.totalLocal, 4500);
  assert.equal(r.totalCA, 4500);
  assert.equal(r.totalKgExport, 0);
  assert.equal(r.caDetail.length, 2);
});

test('computeCADetail: export + local pour la même variété -> additionnés dans une seule ligne caDetail', () => {
  const r = computeCADetail({
    liquidations: [{ rows: [{ receiptQtyKg: 100, gsNet: 5000, variety: 'REYNA', receiptId: 'R1' }] }],
    expeditions: [],
    marcheLocalBons: [{ variete: 'REYNA', ferme: 'F5', totalDH: 1000, poidsLot: 20 }],
  });
  assert.equal(r.totalExport, 5000);
  assert.equal(r.totalLocal, 1000);
  assert.equal(r.totalCA, 6000);
  assert.equal(r.caDetail.length, 1);
  assert.equal(r.caDetail[0].ca, 6000);
  assert.equal(r.caDetail[0].kg, 120);
});

test('computeCADetail: ligne avec ca <= 0 exclue de caDetail (évite les 0 DH parasites)', () => {
  const r = computeCADetail({
    liquidations: [{ rows: [{ receiptQtyKg: 0, gsNet: 0, variety: 'REYNA', receiptId: 'R1' }] }],
    expeditions: [],
    marcheLocalBons: [],
  });
  assert.equal(r.caDetail.length, 0);
});
