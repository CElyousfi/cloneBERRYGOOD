'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  CULTURES,
  normCulture,
  resolveCulture,
  matchesCulture,
} = require('../../public/lib/cultureUtils.js');

// ============================================================================
// CULTURES — mêmes valeurs que CULTURES_SB_VALIDES (functions/pointageService.js)
// ============================================================================
test('CULTURES — les 3 cultures reconnues', () => {
  assert.deepStrictEqual(CULTURES, ['Framboise', 'Myrtille', 'Avocatier']);
});

// ============================================================================
// normCulture — heuristique de repli (consommée par ParcellesReferentielTab)
// ============================================================================
test('normCulture — regex culture puis repli libellé, défaut Framboise', () => {
  assert.strictEqual(normCulture('Myrtille', null), 'Myrtille');
  assert.strictEqual(normCulture('Avocat', null), 'Avocatier');
  assert.strictEqual(normCulture('', 'S8 - CORINA'), 'Myrtille');
  assert.strictEqual(normCulture('', 'S3 - MARAVILLA MOTTE F1'), 'Framboise');
  assert.strictEqual(normCulture('', ''), 'Framboise');
  assert.strictEqual(normCulture(null, null), 'Framboise');
});

test('normCulture — valeurs non-string tolérées, aucun throw', () => {
  assert.strictEqual(normCulture(42, null), 'Framboise');
  assert.strictEqual(normCulture(undefined, 12345), 'Framboise');
});

test('normCulture — variétés d\'avocatier reconnues sur le seul libellé', () => {
  // Bug prod : « F2 ZUTANO » (variété d'avocatier) sortait en Framboise par défaut
  // et polluait l'export Framboise de l'écran Campagne.
  assert.strictEqual(normCulture('', 'F2 ZUTANO'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 FUERTE'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 HASS'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 LAMB HASS'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 ETTINGER'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 PINKERTON'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 REED'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 MEXICOLA'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 NABAL'), 'Avocatier');
  // Historique conservé
  assert.strictEqual(normCulture('', 'BAHIA HAAS'), 'Avocatier');
  assert.strictEqual(normCulture('', 'F2 BACON'), 'Avocatier');
});

test('normCulture — variétés avocatier en MOT ENTIER : pas de faux positif', () => {
  // Les nouveaux termes sont bornés par \b : une séquence incluse dans un mot
  // plus long ne doit pas basculer la parcelle en Avocatier.
  assert.strictEqual(normCulture('', 'S4 BREEDER F1'), 'Framboise');
  assert.strictEqual(normCulture('', 'S4 REEDITION F1'), 'Framboise');
});

test('normCulture — non-régression Framboise / Myrtille', () => {
  assert.strictEqual(normCulture('', 'S02 KWANZA F1'), 'Framboise');
  assert.strictEqual(normCulture('', 'S5 MARAVILLA MD F1'), 'Framboise');
  assert.strictEqual(normCulture('', 'S10 YAZMIN CUT BACK F5'), 'Framboise');
  assert.strictEqual(normCulture('', 'S8 CORINA F5'), 'Myrtille');
  assert.strictEqual(normCulture('', 'S9 CASCADE F5'), 'Myrtille');
  assert.strictEqual(normCulture('', 'S7 BREEZE F5'), 'Myrtille');
  assert.strictEqual(normCulture('Myrtille', 'S7 ZUTANO'), 'Myrtille'); // Myrtille testée en premier
});

// ============================================================================
// resolveCulture — culture_sb prioritaire sur l'heuristique
// ============================================================================
test('resolveCulture — culture_sb du référentiel SB prime sur la regex', () => {
  const sbMap = { 'S12 - YAZMIN': { nom_sb: 'MYRTILLE EXTENSION', culture_sb: 'Myrtille' } };
  // Libellé YAZMIN → la regex dirait Framboise, mais culture_sb fait autorité.
  assert.strictEqual(resolveCulture({ label: 'S12 - YAZMIN' }, sbMap), 'Myrtille');
});

test('resolveCulture — sans entrée SB : repli heuristique', () => {
  assert.strictEqual(resolveCulture({ label: 'S8 - CORINA' }, {}), 'Myrtille');
  assert.strictEqual(resolveCulture({ label: 'P1', culture: 'Avocat' }, {}), 'Avocatier');
  assert.strictEqual(resolveCulture({ label: 'S3 - MARAVILLA MOTTE F1' }, {}), 'Framboise');
});

test('resolveCulture — clé insensible à la casse et aux espaces', () => {
  const sbMap = { 'S12 - YAZMIN': { culture_sb: 'Myrtille' } };
  assert.strictEqual(resolveCulture({ label: ' s12 - yazmin ' }, sbMap), 'Myrtille');
});

test('resolveCulture — nom_sb n est JAMAIS une source de culture (non-régression)', () => {
  // Cas réel prod : parcelle framboise nommée 'MYRTILLE EXTENSION' côté Smart
  // Berry, sans culture_sb → doit rester Framboise.
  const sbMap = { 'S12 - YAZMIN NORD': { nom_sb: 'MYRTILLE EXTENSION' } };
  assert.strictEqual(resolveCulture({ label: 'S12 - YAZMIN NORD' }, sbMap), 'Framboise');
});

test('resolveCulture — culture_sb vide ou espaces → repli sur la regex', () => {
  const sbMapVide = { 'S8 - CORINA': { culture_sb: '' } };
  assert.strictEqual(resolveCulture({ label: 'S8 - CORINA' }, sbMapVide), 'Myrtille');
  const sbMapEspaces = { 'S3 - MARAVILLA': { culture_sb: '   ' } };
  assert.strictEqual(resolveCulture({ label: 'S3 - MARAVILLA' }, sbMapEspaces), 'Framboise');
});

test('resolveCulture — forme de repli { Parcelle_Physique, Culture }', () => {
  const sbMap = { 'S12 - YAZMIN': { culture_sb: 'Myrtille' } };
  assert.strictEqual(resolveCulture({ Parcelle_Physique: 'S12 - YAZMIN' }, sbMap), 'Myrtille');
  assert.strictEqual(
    resolveCulture({ Parcelle_Physique: 'P4', Culture: 'Avocado' }, {}),
    'Avocatier'
  );
});

test('resolveCulture — sbMap absent / entrées vides → aucun throw', () => {
  assert.strictEqual(resolveCulture({ label: 'S8 - CORINA' }), 'Myrtille');
  assert.strictEqual(resolveCulture({ label: 'S8 - CORINA' }, null), 'Myrtille');
  assert.strictEqual(resolveCulture({}, {}), 'Framboise');
  assert.strictEqual(resolveCulture(null, null), 'Framboise');
  assert.strictEqual(resolveCulture(undefined), 'Framboise');
  assert.strictEqual(resolveCulture({ label: 123 }, {}), 'Framboise');
});

// ============================================================================
// matchesCulture — prédicat de filtre
// ============================================================================
test('matchesCulture — filtre vide → tout passe', () => {
  assert.strictEqual(matchesCulture({ label: 'S8 - CORINA' }, '', {}), true);
  assert.strictEqual(matchesCulture({ label: 'P1', culture: 'Avocat' }, null, {}), true);
  assert.strictEqual(matchesCulture(null, undefined), true);
});

test('matchesCulture — filtre actif → compare la culture résolue', () => {
  const sbMap = { 'S12 - YAZMIN': { nom_sb: 'MYRTILLE EXTENSION', culture_sb: 'Myrtille' } };
  assert.strictEqual(matchesCulture({ label: 'S12 - YAZMIN' }, 'Myrtille', sbMap), true);
  assert.strictEqual(matchesCulture({ label: 'S12 - YAZMIN' }, 'Framboise', sbMap), false);
  assert.strictEqual(matchesCulture({ label: 'S3 - MARAVILLA' }, 'Framboise', sbMap), true);
  assert.strictEqual(matchesCulture({ label: 'P1', culture: 'Avocat' }, 'Avocatier'), true);
});
