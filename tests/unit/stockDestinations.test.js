'use strict';

/**
 * Unit tests for public/lib/stockDestinations.js — résolution des options du
 * select « Magasin destination » (réception BDC).
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveDestinationOptions,
  resolveReceptionDestination,
  resolveBdcDestination,
  SD_HORS_CONFIG_SUFFIX,
  SD_NOTE_HORS_CONFIG,
  SD_FERMES_STOCK_NON_MUTUALISE,
} = require('../../public/lib/stockDestinations.js');

const CONFIG = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

test('ferme du BDC présente dans la config → options inchangées, selected = ferme, pas de warning', () => {
  const r = resolveDestinationOptions(CONFIG, 'F5');
  assert.deepEqual(r.options.map(o => o.value), CONFIG);
  assert.equal(r.options.every(o => o.horsConfig === false), true);
  assert.equal(r.selected, 'F5');
  assert.equal(r.warning, null);
});

test('ferme du BDC absente de la config (BAHIA) → option horsConfig en tête + selected + warning', () => {
  const r = resolveDestinationOptions(CONFIG, 'BAHIA');
  assert.equal(r.options.length, CONFIG.length + 1);
  assert.deepEqual(r.options[0], { value: 'BAHIA', label: 'BAHIA' + SD_HORS_CONFIG_SUFFIX, horsConfig: true });
  assert.equal(r.selected, 'BAHIA');
  assert.equal(typeof r.warning, 'string');
  assert.ok(r.warning.includes('BAHIA'));
  assert.ok(r.warning.includes('configuration stock'));
  // les magasins configurés restent proposés, dans l'ordre
  assert.deepEqual(r.options.slice(1).map(o => o.value), CONFIG);
});

test('la valeur hors config conserve la casse fournie par le BDC', () => {
  const r = resolveDestinationOptions(CONFIG, 'Bahia');
  assert.equal(r.options[0].value, 'Bahia');
  assert.equal(r.selected, 'Bahia');
});

test('comparaison insensible à la casse et aux espaces', () => {
  const r = resolveDestinationOptions(['BAHIA', 'F1'], '  bahia ');
  assert.equal(r.options.length, 2, 'aucune option hors config ajoutée');
  assert.equal(r.warning, null);
  // selected doit être une valeur RÉELLEMENT présente dans les options, sinon
  // le select contrôlé se désynchronise à nouveau (c'est le bug d'origine).
  assert.equal(r.selected, 'BAHIA');
  assert.ok(r.options.some(o => o.value === r.selected));
});

test('ferme BDC vide → selected = premier magasin, pas de warning', () => {
  const r = resolveDestinationOptions(CONFIG, '');
  assert.equal(r.selected, 'F1');
  assert.equal(r.warning, null);
  assert.deepEqual(r.options.map(o => o.value), CONFIG);
});

test('ferme BDC absente (undefined/null) → selected = premier magasin', () => {
  assert.equal(resolveDestinationOptions(CONFIG).selected, 'F1');
  assert.equal(resolveDestinationOptions(CONFIG, null).selected, 'F1');
  assert.equal(resolveDestinationOptions(CONFIG, undefined).warning, null);
});

test('magasins vide / non-tableau → ne crashe pas, options vides', () => {
  for (const bad of [[], null, undefined, 'F1', 42, {}]) {
    const r = resolveDestinationOptions(/** @type {any} */ (bad));
    assert.deepEqual(r.options, []);
    assert.equal(r.selected, '');
    assert.equal(r.warning, null);
  }
});

test('magasins vide + ferme BDC → la ferme reste proposée (hors config)', () => {
  const r = resolveDestinationOptions([], 'BAHIA');
  assert.deepEqual(r.options, [{ value: 'BAHIA', label: 'BAHIA' + SD_HORS_CONFIG_SUFFIX, horsConfig: true }]);
  assert.equal(r.selected, 'BAHIA');
  assert.ok(r.warning);
});

test('entrées vides/blanches dans magasins ignorées', () => {
  const r = resolveDestinationOptions(['F1', '', '   ', null], 'F1');
  assert.deepEqual(r.options.map(o => o.value), ['F1']);
  assert.equal(r.selected, 'F1');
});

test('selected est toujours une valeur présente dans options (invariant du select contrôlé)', () => {
  // CONTRAT : l'invariant « selected ∈ options » vaut dès qu'il y a au moins une
  // destination à proposer. Le SEUL cas où il ne tient pas est le cas dégénéré
  // « aucun magasin configuré ET aucune ferme BDC » : options === [] et
  // selected === '' — il n'existe alors rien à sélectionner, et '' est
  // précisément ce qu'un <select> vide rend. Ce cas est traité à part ci-dessous.
  const cases = [
    [CONFIG, 'BAHIA'], [CONFIG, 'F2'], [CONFIG, ''], [CONFIG, undefined],
    [['BAHIA'], 'bahia'], [[], 'BAHIA'],
  ];
  for (const [mags, ferme] of cases) {
    const r = resolveDestinationOptions(/** @type {any} */ (mags), /** @type {any} */ (ferme));
    assert.ok(r.options.length > 0, JSON.stringify([mags, ferme]) + ' : options non vides attendues');
    assert.ok(r.options.some(o => o.value === r.selected), JSON.stringify([mags, ferme]));
  }
});

test('cas dégénéré : aucune destination du tout → options vides ET selected vide', () => {
  for (const ferme of ['', null, undefined]) {
    const r = resolveDestinationOptions([], /** @type {any} */ (ferme));
    assert.deepEqual(r.options, []);
    assert.equal(r.selected, '');
    assert.equal(r.warning, null);
    // Invariant volontairement NON tenu ici : il n'y a rien à sélectionner.
    assert.equal(r.options.some(o => o.value === r.selected), false);
  }
});

// ---------------------------------------------------------------------------
// resolveReceptionDestination — état du select de la réception BDC, où la ferme
// du BDC ET la valeur courante comptent.
// ---------------------------------------------------------------------------

test('réception BDC — scénario complet : BAHIA → F1 → retour BAHIA', () => {
  const ferme = 'BAHIA';

  // 1. À l'ouverture : la ferme hors config est proposée, sélectionnée, avertie.
  const ouverture = resolveReceptionDestination(CONFIG, ferme, ferme);
  assert.equal(ouverture.selected, 'BAHIA');
  assert.equal(ouverture.options[0].horsConfig, true);
  assert.ok(ouverture.warning);
  assert.ok(ouverture.options.some(o => o.value === ouverture.selected));

  // 2. Le magasinier bascule sur F1 : BAHIA RESTE proposée (il doit pouvoir y
  //    revenir sans rouvrir le BDC), le warning disparaît.
  const versF1 = resolveReceptionDestination(CONFIG, ferme, 'F1');
  assert.equal(versF1.selected, 'F1');
  assert.equal(versF1.warning, null);
  assert.ok(versF1.options.some(o => o.value === 'BAHIA'), 'BAHIA doit rester proposée');
  assert.ok(versF1.options.some(o => o.value === 'F1'));
  assert.equal(versF1.options.find(o => o.value === 'BAHIA').label, 'BAHIA' + SD_HORS_CONFIG_SUFFIX);
  assert.ok(versF1.options.some(o => o.value === versF1.selected));

  // 3. Retour sur la ferme du BDC : le warning revient.
  const retour = resolveReceptionDestination(CONFIG, ferme, 'BAHIA');
  assert.equal(retour.selected, 'BAHIA');
  assert.ok(retour.warning);
  assert.deepEqual(retour.options.map(o => o.value).sort(), ouverture.options.map(o => o.value).sort());
});

test('réception BDC — la liste d\'options ne dépend pas de la valeur courante', () => {
  const vals = (d) => d.options.map(o => o.value).sort().join(',');
  const a = resolveReceptionDestination(CONFIG, 'BAHIA', 'BAHIA');
  const b = resolveReceptionDestination(CONFIG, 'BAHIA', 'F3');
  const c = resolveReceptionDestination(CONFIG, 'BAHIA', 'F6');
  assert.equal(vals(a), vals(b));
  assert.equal(vals(b), vals(c));
});

test('réception BDC — bascule fallback → config réelle : la valeur courante reste une option', () => {
  // useStockLocations rend d'abord ['F1','F2','F5','F6'] puis la vraie config.
  // Le magasinier a pu sélectionner F2 pendant le fallback ; si la config
  // réelle ne contenait pas F2, l'option doit malgré tout rester rendue.
  const apres = resolveReceptionDestination(['F1', 'F5'], 'BAHIA', 'F2');
  assert.equal(apres.selected, 'F2');
  assert.ok(apres.options.some(o => o.value === 'F2'));
  assert.ok(apres.options.some(o => o.value === 'BAHIA'), 'la ferme du BDC reste proposée');
  assert.ok(apres.warning, 'F2 hors config → averti');
});

test('réception BDC — ferme du BDC déclarée dans la config : aucun warning, aucune option en trop', () => {
  const d = resolveReceptionDestination(CONFIG, 'F5', 'F1');
  assert.deepEqual(d.options.map(o => o.value), CONFIG);
  assert.equal(d.selected, 'F1');
  assert.equal(d.warning, null);
});

test('réception BDC — valeur courante vide → équivaut à resolveDestinationOptions(magasins, ferme)', () => {
  for (const vide of ['', null, undefined]) {
    const d = resolveReceptionDestination(CONFIG, 'BAHIA', vide);
    assert.deepEqual(d, resolveDestinationOptions(CONFIG, 'BAHIA'));
  }
});

test('réception BDC — comparaison insensible à la casse sur la valeur courante', () => {
  const d = resolveReceptionDestination(CONFIG, 'BAHIA', 'f1');
  assert.equal(d.selected, 'F1', 'aligné sur la valeur de l\'option, pas sur la casse saisie');
  assert.equal(d.warning, null);
  assert.ok(d.options.some(o => o.value === d.selected));
  assert.equal(d.options.filter(o => o.value.toUpperCase() === 'F1').length, 1, 'pas de doublon');
});

test('réception BDC — selected est toujours une option rendue (invariant du select contrôlé)', () => {
  const cases = [
    [CONFIG, 'BAHIA', 'BAHIA'], [CONFIG, 'BAHIA', 'F1'], [CONFIG, 'F1', 'F6'],
    [['F1', 'F5'], 'BAHIA', 'F2'], [[], 'BAHIA', 'BAHIA'], [[], 'BAHIA', 'F9'],
    [CONFIG, '', 'F2'], [CONFIG, null, 'BAHIA'],
  ];
  for (const [mags, ferme, courante] of cases) {
    const d = resolveReceptionDestination(mags, ferme, courante);
    assert.ok(d.options.length > 0, JSON.stringify([mags, ferme, courante]));
    assert.ok(d.options.some(o => o.value === d.selected), JSON.stringify([mags, ferme, courante]));
  }
});

// ---------------------------------------------------------------------------
// resolveBdcDestination — CONTRAT PRODUIT (Omar, 2026-08, corrigé).
//
// RÈGLE MÉTIER : le magasin de réception n'est verrouillé QUE pour une ferme
// dont le stock n'est pas mutualisable. Aujourd'hui BAHIA seule, parce que
// c'est une ENTITÉ JURIDIQUE DISTINCTE (BDC_SOCIETES.BAHIA = BAHIA AGRICOLE
// SARL, RC/ICE propres, cf. public/app.jsx ~l.466) : son stock ne doit pas se
// mélanger à celui de Berry Good Farms. F1..F6 et Avocatier relèvent de la même
// société → un BDC F1 peut légitimement être réceptionné ailleurs, c'est un
// arbitrage logistique interne, l'app n'a pas à l'interdire.
// ---------------------------------------------------------------------------

test('CONTRAT — BAHIA impose sa destination', () => {
  const d = resolveBdcDestination(CONFIG, 'BAHIA');
  assert.equal(d.locked, true);
  assert.equal(d.magasin, 'BAHIA');
  assert.equal(d.horsConfig, true, 'BAHIA absente de la config stock du ticket');
  assert.equal(d.note, SD_NOTE_HORS_CONFIG);
  // Note INFORMATIVE : verrouillé, l'utilisateur ne peut rien corriger.
  assert.equal(/vérifi|avant de valider/i.test(d.note), false);
});

test('CONTRAT — BAHIA reste imposée quelle que soit la graphie (Bahia, EL BAHIA)', () => {
  // normalizeFerme (functions/lib/stockCaneva/mappings.js) replie déjà
  // 'EL BAHIA' sur 'BAHIA' : on reste cohérent avec l'import.
  for (const graphie of ['BAHIA', 'Bahia', 'bahia', '  BAHIA ', 'EL BAHIA', 'el bahia', 'EL   BAHIA']) {
    const d = resolveBdcDestination(CONFIG, graphie);
    assert.equal(d.locked, true, graphie + ' : devrait être verrouillée');
  }
});

test('CONTRAT — la casse du BDC est conservée dans la destination imposée', () => {
  assert.equal(resolveBdcDestination(CONFIG, 'Bahia').magasin, 'Bahia');
  // ... sauf si la config déclare la ferme : sa casse fait alors foi (soldes existants).
  assert.equal(resolveBdcDestination(['BAHIA', 'F1'], 'bahia').magasin, 'BAHIA');
});

test('CONTRAT — toutes les autres fermes laissent le CHOIX, présélectionné sur la ferme du BDC', () => {
  for (const ferme of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'Avocatier']) {
    const d = resolveBdcDestination(CONFIG, ferme);
    assert.equal(d.locked, false, ferme + ' : ne doit PAS être imposée (même société)');
    assert.equal(d.magasin, ferme, ferme + ' : présélection attendue sur la ferme du BDC');
    assert.equal(d.fermePreselection, ferme);
    assert.equal(d.note, null);
  }
});

test('CONTRAT — Avocatier (hors config stock) laisse le choix malgré tout', () => {
  // Hors config comme BAHIA, mais MÊME société : pas de verrouillage.
  const d = resolveBdcDestination(CONFIG, 'Avocatier');
  assert.equal(d.locked, false);
  assert.equal(d.magasin, 'Avocatier', 'reste présélectionnée et proposée');
});

test('BDC mutualisé (ferme "Toutes") → choix libre, aucune présélection de ferme', () => {
  for (const t of ['Toutes', 'TOUTES', ' toutes ']) {
    const d = resolveBdcDestination(CONFIG, t);
    assert.equal(d.locked, false);
    assert.equal(d.fermePreselection, '', t + ' : le fourre-tout ne doit pas devenir une option');
    assert.equal(d.magasin, 'F1', 'présélection = 1er magasin de la config');
  }
});

test('BDC sans ferme (vide/null/undefined) → choix libre, 1er magasin', () => {
  for (const vide of ['', null, undefined, '   ']) {
    const d = resolveBdcDestination(CONFIG, vide);
    assert.equal(d.locked, false);
    assert.equal(d.fermePreselection, '');
    assert.equal(d.magasin, 'F1');
  }
});

test('la liste des fermes à stock non mutualisé est explicite et réduite à BAHIA', () => {
  // Sentinelle : si une entité juridique s'ajoute, ce test casse et oblige à
  // documenter le motif dans le module plutôt qu'à l'enfouir dans la logique.
  assert.deepEqual(SD_FERMES_STOCK_NON_MUTUALISE, ['BAHIA']);
});

test('resolveBdcDestination ne crashe jamais sur une config absente', () => {
  for (const bad of [null, undefined, 'F1', 42, {}]) {
    const impose = resolveBdcDestination(/** @type {any} */ (bad), 'BAHIA');
    assert.equal(impose.locked, true);
    assert.equal(impose.magasin, 'BAHIA');
    const libre = resolveBdcDestination(/** @type {any} */ (bad), 'F1');
    assert.equal(libre.locked, false);
    assert.equal(libre.magasin, 'F1', 'la ferme du BDC reste la présélection');
  }
});

test('la branche libre alimente correctement resolveReceptionDestination', () => {
  // Composition réelle du composant : bdcDest.fermePreselection est passée en
  // 2e argument. Un BDC F2 doit garder F2 dans les options même après bascule
  // sur un autre magasin ; un BDC 'Toutes' ne doit jamais fabriquer d'option.
  const f2 = resolveBdcDestination(CONFIG, 'F2');
  const optF2 = resolveReceptionDestination(CONFIG, f2.fermePreselection, 'F5');
  assert.equal(optF2.selected, 'F5');
  assert.ok(optF2.options.some(o => o.value === 'F2'));

  const tout = resolveBdcDestination(CONFIG, 'Toutes');
  const optTout = resolveReceptionDestination(CONFIG, tout.fermePreselection, 'F1');
  assert.equal(optTout.options.some(o => /toutes/i.test(o.value)), false);
});
