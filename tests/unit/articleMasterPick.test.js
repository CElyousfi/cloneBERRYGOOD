'use strict';

/**
 * Choix de la fiche maître dans un groupe de doublons — tests purs.
 * Les deux règles sont mesurées sur les 105 paires réelles (52 + 53) ; ce
 * fichier verrouille leur ORDRE, leur EXCLUSIVITÉ (« une seule fiche »), et le
 * refus de trancher hors de ces deux cas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../scripts/lib/articleMasterPick');

const A = (id, extra) => Object.assign({ id, nom: 'Acide Phosphorique' }, extra || {});

test('règle 1 — une seule fiche porte un PMP : c’est elle', () => {
  const master = A('M', { prix_pmp: 12.5, nb_achats: 0 });
  const autre = A('D', { nb_achats: 40 });
  const r = P.pickMaster([autre, master]);
  assert.equal(r.decided, true);
  assert.equal(r.rule, P.RULE_PMP);
  assert.equal(r.master.id, 'M');
  assert.deepEqual(r.doublons.map((d) => d.id), ['D']);
  // Le PMP prime sur nb_achats : `conso-valorisee` lit prix_pmp, pas nb_achats.
  assert.match(r.reason, /PMP/);
});

test('règle 2 — aucun PMP, une seule fiche avec des achats : c’est elle', () => {
  const master = A('M', { nb_achats: 17 });
  const autre = A('D', { nb_achats: 0 });
  const r = P.pickMaster([master, autre]);
  assert.equal(r.decided, true);
  assert.equal(r.rule, P.RULE_NB_ACHATS);
  assert.equal(r.master.id, 'M');
  assert.deepEqual(r.doublons.map((d) => d.id), ['D']);
});

test('règle 2 ne s’applique QUE si la règle 1 n’a rien vu passer', () => {
  // Deux PMP identiques : la règle 1 ne départage pas. La règle 2 ne doit PAS
  // prendre le relais — choisir sur nb_achats une fiche SANS PMP casserait la
  // valorisation. On refuse de trancher.
  const r = P.pickMaster([
    A('A', { prix_pmp: 10, nb_achats: 0 }),
    A('B', { prix_pmp: 10, nb_achats: 5 }),
  ]);
  assert.equal(r.decided, false);
  assert.equal(r.master, null);
  assert.equal(r.pmp_divergent, false);
  assert.match(r.reason, /même PMP/);
});

test('PMP divergents : refus de trancher, divergence signalée', () => {
  const r = P.pickMaster([A('A', { prix_pmp: 10 }), A('B', { prix_pmp: 42 })]);
  assert.equal(r.decided, false);
  assert.equal(r.pmp_divergent, true);
  assert.match(r.reason, /DIVERGENT/);
});

test('aucune fiche exploitable : refus de trancher', () => {
  const r = P.pickMaster([A('A'), A('B')]);
  assert.equal(r.decided, false);
  assert.match(r.reason, /ni PMP ni historique/);
});

test('plusieurs fiches avec des achats et aucun PMP : refus de trancher', () => {
  const r = P.pickMaster([A('A', { nb_achats: 3 }), A('B', { nb_achats: 9 })]);
  assert.equal(r.decided, false);
  assert.match(r.reason, /historique d'achats/);
});

test('un PMP à 0, négatif ou non numérique n’est PAS un PMP', () => {
  // Sinon une fiche « valorisée à 0 » gagnerait contre la vraie fiche.
  for (const bidon of [0, '0', -3, null, undefined, '', 'n/a', NaN]) {
    assert.equal(P.pmpOf({ prix_pmp: bidon }), null, 'pmp bidon : ' + String(bidon));
  }
  assert.equal(P.pmpOf({ prix_pmp: '12.5' }), 12.5, 'un PMP en chaîne reste un PMP');
  const r = P.pickMaster([A('A', { prix_pmp: 0, nb_achats: 8 }), A('B', { prix_pmp: 3.2 })]);
  assert.equal(r.master.id, 'B');
});

test('nb_achats : 0, négatif et non numérique valent 0', () => {
  for (const bidon of [0, -1, null, undefined, '', 'x', NaN]) {
    assert.equal(P.nbAchatsOf({ nb_achats: bidon }), 0, 'nb_achats bidon : ' + String(bidon));
  }
  assert.equal(P.nbAchatsOf({ nb_achats: '7' }), 7);
});

test('groupe dégénéré (<2 fiches, null, non-array) : refus, jamais de crash', () => {
  for (const bad of [[], [A('A')], null, undefined, 42]) {
    const r = P.pickMaster(bad);
    assert.equal(r.decided, false);
    assert.deepEqual(r.doublons, []);
  }
  // Les entrées nulles d’un groupe sont ignorées, pas comptées comme fiches.
  assert.equal(P.pickMaster([null, A('A', { prix_pmp: 1 })]).decided, false);
});

test('groupe de 3 fiches : la maîtresse est unique, les 2 autres sont absorbées', () => {
  const r = P.pickMaster([
    A('A', { nb_achats: 2 }),
    A('B', { prix_pmp: 5 }),
    A('C', { nb_achats: 9 }),
  ]);
  assert.equal(r.decided, true);
  assert.equal(r.master.id, 'B');
  assert.deepEqual(r.doublons.map((d) => d.id).sort(), ['A', 'C']);
  // Le maître n’apparaît JAMAIS dans les doublons (merge-articles rend 400).
  assert.equal(r.doublons.includes(r.master), false);
});
