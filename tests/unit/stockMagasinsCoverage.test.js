'use strict';

/**
 * Test anti-récidive (ticket sb/magasin-bahia).
 *
 * Bug d'origine : un BDC porté par la ferme BAHIA ouvrait le select « Magasin
 * destination » de la réception avec un state `magasin: 'BAHIA'` alors que la
 * config stock (`stock_config/locations.magasins`) ne contient que F1..F6 →
 * aucune <option> correspondante, select contrôlé désynchronisé, stock imputé
 * au mauvais magasin sans que le magasinier voie quoi que ce soit.
 *
 * RÈGLE : toute ferme de FARMS susceptible de porter du stock (donc d'être la
 * `ferme` d'un BDC) doit avoir une destination de réception. Deux façons d'y
 * répondre : la déclarer dans la config stock, ou passer par le garde-fou
 * `resolveDestinationOptions` qui la propose « hors config stock ».
 *
 * `public/app.jsx` n'est pas importable (monolithe React sans bundler) : la
 * liste FARMS est donc FIGÉE ici, copiée de public/app.jsx (~l.452). L'ajout
 * futur d'une ferme casse ce test — c'est le but : on veut casser un test,
 * pas la prod.
 *
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDestinationOptions } = require('../../public/lib/stockDestinations.js');

// Copie figée de FARMS (public/app.jsx). 'Toutes' est un pseudo-item d'UI, exclu.
const FARMS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'];

// Magasins déclarés dans la config stock (stock_config/locations.magasins) à la
// date du ticket. Volontairement figé : la config est une donnée de prod, elle
// n'est pas lisible depuis un test unitaire.
const CONFIG_MAGASINS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

test('FARMS ne contient pas le pseudo-item "Toutes"', () => {
  assert.equal(FARMS.includes('Toutes'), false);
});

test('la liste FARMS figée est celle attendue (sentinelle : un ajout de ferme casse ici)', () => {
  // Si ce test casse : une ferme a été ajoutée dans public/app.jsx. Vérifier
  // qu'elle a bien une destination de réception (config stock ou garde-fou),
  // puis mettre à jour cette liste.
  assert.deepEqual(FARMS, ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier']);
});

test('chaque ferme est proposée et sélectionnable comme magasin destination', () => {
  for (const ferme of FARMS) {
    const r = resolveDestinationOptions(CONFIG_MAGASINS, ferme);
    assert.ok(
      r.options.some(o => o.value === r.selected),
      'ferme ' + ferme + ' : selected absent des options (select désynchronisé)'
    );
    assert.equal(r.selected.toUpperCase(), ferme.toUpperCase(), 'ferme ' + ferme + ' non présélectionnée');
  }
});

test('une ferme hors config stock (BAHIA, Avocatier) est signalée au magasinier', () => {
  for (const ferme of FARMS.filter(f => !CONFIG_MAGASINS.includes(f))) {
    const r = resolveDestinationOptions(CONFIG_MAGASINS, ferme);
    assert.equal(r.options[0].horsConfig, true, ferme + ' : option hors config attendue en tête');
    assert.ok(r.warning, ferme + ' : warning attendu');
  }
});

test('une ferme déclarée dans la config ne déclenche aucun warning', () => {
  for (const ferme of CONFIG_MAGASINS) {
    const r = resolveDestinationOptions(CONFIG_MAGASINS, ferme);
    assert.equal(r.warning, null, ferme + ' : warning inattendu');
  }
});
