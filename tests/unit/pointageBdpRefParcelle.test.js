'use strict';

// Test de COMPATIBILITÉ : le format Ref_parcelle de la BDP ('0031', 4 chiffres,
// relevé en introspection §5) doit être classé par deriveFerme() en une ferme
// réelle (F1/F5/Avocatier/BAHIA), PAS 'Autre'. Le cloisonnement Étape 0
// (filtrage par ferme du chef) en dépend : un Ref_parcelle non reconnu tomberait
// dans 'Autre' et casserait la ventilation par ferme du pull reconstruit.

const { test } = require('node:test');
const assert = require('node:assert');
const { deriveFerme } = require('../../functions/pointageService.js');

// Codes numériques 4 chiffres explicitement mappés dans deriveFerme
// (functions/pointageService.js:311-313).
const BDP_REFS = {
  '0032': 'F1',
  '0035': 'F1',
  '0036': 'F1',
  '0037': 'F5',
  '0038': 'F5',
  '0039': 'F5',
  '0031': 'Avocatier',
  '0033': 'Avocatier',
};

for (const [ref, expected] of Object.entries(BDP_REFS)) {
  test(`Ref_parcelle BDP '${ref}' → ${expected} (pas 'Autre')`, () => {
    const ferme = deriveFerme(ref, '');
    assert.notEqual(ferme, 'Autre', `Ref '${ref}' classé 'Autre' — incompatible cloisonnement`);
    assert.equal(ferme, expected);
  });
}

test('Ref_parcelle BDP inconnu (ex. 0099) → Autre (comportement fail-closed attendu)', () => {
  // Documenté : un code 4 chiffres NON mappé retombe sur 'Autre'. Si la BDP
  // porte d'autres codes numériques (hors 0031-0039), il faudra étendre le
  // mapping deriveFerme OU mapper via IDFermes→Fermes. À surveiller sur le pull réel.
  assert.equal(deriveFerme('0099', ''), 'Autre');
});
