'use strict';

/**
 * featureFlags — la décision de bascule entre les deux frontends.
 *
 * Ce qui compte ici n'est pas qu'un drapeau soit lu, mais l'ORDRE dans lequel
 * les sources se départagent : l'URL doit pouvoir ramener au monolithe quoi
 * qu'en disent le cache et le serveur, et un boot modulaire qui n'a jamais
 * abouti doit se désarmer tout seul — sans quoi l'utilisateur boucle sur une
 * application morte, hors d'atteinte de toute bascule côté serveur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { decideModularFrontend } = require('../../public/lib/featureFlags.js');

test('défaut : sans aucune source, on reste sur le monolithe', () => {
  const d = decideModularFrontend({});
  assert.equal(d.modular, false);
  assert.equal(d.reason, 'defaut');
});

test('cache : la dernière valeur distante connue est appliquée', () => {
  assert.equal(decideModularFrontend({ cached: '1' }).modular, true);
  assert.equal(decideModularFrontend({ cached: '0' }).modular, false);
  assert.equal(decideModularFrontend({ cached: '1' }).reason, 'cache');
});

test('URL : ?modular=1 force le modulaire malgré un cache contraire', () => {
  const d = decideModularFrontend({ param: '1', cached: '0' });
  assert.equal(d.modular, true);
  assert.equal(d.reason, 'url');
});

test("URL : ?modular=0 est l'échappatoire — elle gagne sur tout le reste", () => {
  const d = decideModularFrontend({ param: '0', cached: '1', bootPending: '1699999999999' });
  assert.equal(d.modular, false);
  assert.equal(d.reason, 'url');
  // Elle purge aussi le marqueur : l'opérateur repart d'un état propre.
  assert.equal(d.clearBootPending, true);
});

test('garde-fou : un boot modulaire jamais confirmé ramène au monolithe', () => {
  const d = decideModularFrontend({ cached: '1', bootPending: '1699999999999' });
  assert.equal(d.modular, false, 'un bundle qui plante ne doit pas être retenté en boucle');
  assert.equal(d.reason, 'boot-echec');
});

test('garde-fou : le marqueur est CONSOMMÉ, un incident isolé ne condamne pas la bascule', () => {
  const d = decideModularFrontend({ cached: '1', bootPending: '1699999999999' });
  assert.equal(d.clearBootPending, true);
  // Chargement suivant, marqueur purgé : le cache reprend la main.
  assert.equal(decideModularFrontend({ cached: '1' }).modular, true);
});

test('un ?modular=1 explicite passe outre un échec de boot précédent', () => {
  // Sinon on ne pourrait plus jamais retester le modulaire après un incident.
  const d = decideModularFrontend({ param: '1', bootPending: '1699999999999' });
  assert.equal(d.modular, true);
  assert.equal(d.reason, 'url');
});

test('valeurs inattendues : tout ce qui n\'est ni "1" ni "0" est ignoré', () => {
  for (const bogus of ['true', 'oui', '', 'null', '2']) {
    assert.equal(decideModularFrontend({ cached: bogus }).modular, false, `cache=${bogus}`);
    assert.equal(decideModularFrontend({ param: bogus }).modular, false, `param=${bogus}`);
  }
});

test('entrée absente ou nulle ne lève pas', () => {
  assert.equal(decideModularFrontend(undefined).modular, false);
  assert.equal(decideModularFrontend(null).modular, false);
});
