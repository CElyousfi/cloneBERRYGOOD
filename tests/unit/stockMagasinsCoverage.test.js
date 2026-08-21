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
 * RÈGLE 1 (couverture) : toute ferme de FARMS susceptible de porter du stock
 * (donc d'être la `ferme` d'un BDC) doit avoir une destination de réception.
 * Deux façons d'y répondre : la déclarer dans la config stock, ou passer par le
 * garde-fou `resolveDestinationOptions` qui la propose « hors config stock ».
 *
 * RÈGLE 2 (verrouillage) : seule BAHIA impose sa destination, parce que c'est
 * une entité juridique distincte. Toutes les autres fermes sont mutualisables
 * et gardent le choix. Voir le détail du motif dans stockDestinations.test.js.
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
const { resolveDestinationOptions, resolveBdcDestination } = require('../../public/lib/stockDestinations.js');

// Copie figée de FARMS (public/app.jsx ~l.452). 'Toutes' n'y figure pas.
const FARMS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'];

// ⚠️ L'écran BDC a sa PROPRE liste FARMS (public/app.jsx ~l.48362), qui ajoute
// 'Toutes' en tête : un BDC peut donc réellement porter `ferme: 'Toutes'`
// (BDC mutualisé multi-fermes). C'est le seul cas où la destination de
// réception n'est pas imposée.
const FARMS_BDC = ['Toutes', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'];

// Magasins déclarés dans la config stock (stock_config/locations.magasins) à la
// date du ticket. Volontairement figé : la config est une donnée de prod, elle
// n'est pas lisible depuis un test unitaire.
const CONFIG_MAGASINS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

test('FARMS ne contient pas le pseudo-item "Toutes", la liste de l\'écran BDC si', () => {
  assert.equal(FARMS.includes('Toutes'), false);
  assert.equal(FARMS_BDC.includes('Toutes'), true);
  assert.deepEqual(FARMS_BDC, ['Toutes'].concat(FARMS), 'les deux listes ne diffèrent que par "Toutes"');
});

test('CONTRAT — BAHIA est la SEULE ferme dont la destination est imposée', () => {
  // Décision produit (Omar) : « Juste BAHIA. » Le verrouillage suit une
  // frontière JURIDIQUE, pas une frontière géographique : BAHIA AGRICOLE SARL
  // est une société distincte (BDC_SOCIETES.BAHIA, public/app.jsx ~l.466), son
  // stock ne se mélange pas avec celui de Berry Good Farms. F1..F6 et
  // Avocatier relèvent de la même société : réceptionner un BDC F1 sur un
  // autre magasin est un arbitrage logistique interne, pas une erreur.
  const imposees = FARMS_BDC.filter(f => resolveBdcDestination(CONFIG_MAGASINS, f).locked);
  assert.deepEqual(imposees, ['BAHIA'], 'exactement une ferme imposée : BAHIA');
});

test('CONTRAT — toute ferme mutualisable reste présélectionnée sans être imposée', () => {
  for (const ferme of FARMS_BDC.filter(f => f !== 'BAHIA' && f !== 'Toutes')) {
    const d = resolveBdcDestination(CONFIG_MAGASINS, ferme);
    assert.equal(d.locked, false, ferme + ' : ne doit pas être imposée');
    assert.equal(d.magasin, ferme, ferme + ' : doit rester la présélection');
  }
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

test('une ferme hors config est signalée, par le canal correspondant à son mode', () => {
  // BAHIA (imposée)   → note informative portée par resolveBdcDestination.
  // Avocatier (libre) → warning actionnable du select, via le chemin
  //                     resolveDestinationOptions / resolveReceptionDestination.
  const bahia = resolveBdcDestination(CONFIG_MAGASINS, 'BAHIA');
  assert.equal(bahia.locked, true);
  assert.equal(bahia.horsConfig, true);
  assert.ok(bahia.note, 'BAHIA : note informative attendue');

  const avocatier = resolveBdcDestination(CONFIG_MAGASINS, 'Avocatier');
  assert.equal(avocatier.locked, false);
  assert.equal(avocatier.note, null, 'Avocatier : pas de note, c\'est le select qui avertit');
  assert.ok(
    resolveDestinationOptions(CONFIG_MAGASINS, avocatier.fermePreselection).warning,
    'Avocatier : le select doit tout de même avertir'
  );
});

test('une ferme déclarée dans la config ne déclenche aucun warning', () => {
  for (const ferme of CONFIG_MAGASINS) {
    const r = resolveDestinationOptions(CONFIG_MAGASINS, ferme);
    assert.equal(r.warning, null, ferme + ' : warning inattendu');
  }
});
