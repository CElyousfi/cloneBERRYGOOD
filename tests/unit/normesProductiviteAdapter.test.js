'use strict';
// Chantier production readiness (docs/DATA_SOURCES.md) — normesProductivite
// est le premier domaine câblé sur sa vraie source
// (/api/hors-recolte-suivi?action=get-normes). Ce test couvre l'adapter pur
// (src/modules/agronomie/normesProductiviteAdapter.jsx) : la règle centrale
// du brief est qu'une source qui ne renvoie rien donne un ÉCRAN VIDE, jamais
// un nombre fabriqué côté front.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const babel = require('@babel/core');

function loadAdapter() {
  const file = path.join(__dirname, '../../src/modules/agronomie/normesProductiviteAdapter.jsx');
  const { code } = babel.transformFileSync(file, {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    plugins: [
      // ESM -> CJS minimal, juste pour ce fichier (pas d'autres imports à résoudre).
      ['@babel/plugin-transform-modules-commonjs'],
    ],
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'exports', 'require', code);
  fn(mod, mod.exports, require);
  return mod.exports;
}

const { adaptNormesProductivite } = loadAdapter();

test('adaptNormesProductivite: pas de réponse (null) -> état vide, pas de repli fabriqué', () => {
  const result = adaptNormesProductivite(null);
  assert.deepStrictEqual(result, { normesProductivite: [], source: null });
});

test('adaptNormesProductivite: réponse absente (undefined, fetch pas encore résolu) -> état vide', () => {
  const result = adaptNormesProductivite(undefined);
  assert.deepStrictEqual(result, { normesProductivite: [], source: null });
});

test('adaptNormesProductivite: success=false (erreur serveur) -> état vide', () => {
  const result = adaptNormesProductivite({ success: false, error: 'boom' });
  assert.deepStrictEqual(result, { normesProductivite: [], source: null });
});

test('adaptNormesProductivite: normes absent du payload -> état vide, ne plante pas', () => {
  const result = adaptNormesProductivite({ success: true });
  assert.deepStrictEqual(result, { normesProductivite: [], source: null });
});

test('adaptNormesProductivite: source firestore réelle -> mappe normeParJourParOuvrier vers normeTunnelsParJourParOuvrier', () => {
  const result = adaptNormesProductivite({
    success: true,
    source: 'firestore',
    normes: [
      { id: 'Desherbage_F1', tache: 'Désherbage', ferme: 'F1', normeParJourParOuvrier: 4.5, unite: 'tunnels/jour/ouvrier' },
    ],
  });
  assert.strictEqual(result.source, 'firestore');
  assert.strictEqual(result.normesProductivite.length, 1);
  assert.strictEqual(result.normesProductivite[0].normeTunnelsParJourParOuvrier, 4.5);
  assert.strictEqual(result.normesProductivite[0].tache, 'Désherbage');
  assert.strictEqual(result.normesProductivite[0].ferme, 'F1');
  assert.strictEqual(result.normesProductivite[0].id, 'Desherbage_F1');
});

test('adaptNormesProductivite: repli serveur hardcoded -> source propagée telle quelle (pour le badge UI)', () => {
  const result = adaptNormesProductivite({
    success: true,
    source: 'hardcoded',
    normes: [{ tache: 'Désherbage', normeParJourParOuvrier: 4, unite: 'tunnels' }],
  });
  assert.strictEqual(result.source, 'hardcoded');
  assert.strictEqual(result.normesProductivite.length, 1);
});

test('adaptNormesProductivite: valeur non numérique -> 0, jamais NaN affiché', () => {
  const result = adaptNormesProductivite({
    success: true, source: 'firestore',
    normes: [{ tache: 'X', normeParJourParOuvrier: 'oops', unite: 'tunnels' }],
  });
  assert.strictEqual(result.normesProductivite[0].normeTunnelsParJourParOuvrier, 0);
  assert.ok(!Number.isNaN(result.normesProductivite[0].normeTunnelsParJourParOuvrier));
});

test('adaptNormesProductivite: unite absente -> repli sur la même unité par défaut que l\'ancien mock', () => {
  const result = adaptNormesProductivite({
    success: true, source: 'firestore',
    normes: [{ tache: 'X', normeParJourParOuvrier: 3 }],
  });
  assert.strictEqual(result.normesProductivite[0].unite, 'tunnels/jour/ouvrier');
});

test('adaptNormesProductivite: liste réelle vide (collection existe mais 0 doc actif) -> écran vide, pas hardcoded', () => {
  const result = adaptNormesProductivite({ success: true, source: 'firestore', normes: [] });
  assert.deepStrictEqual(result, { normesProductivite: [], source: 'firestore' });
});
