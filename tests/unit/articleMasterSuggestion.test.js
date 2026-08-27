'use strict';

/**
 * Choix du maître dans un groupe de doublons — tests purs de la CASCADE.
 *
 * Ce que ce fichier verrouille : la PRIORITÉ STRICTE des trois niveaux
 * (`prix_pmp`, puis `prix_ht`, puis `nb_achats`), l'EXCLUSIVITÉ (« une SEULE
 * fiche » à chaque niveau), le fait qu'un niveau n'est consulté QUE si le
 * précédent n'a rien vu du tout, et le FAIL-CLOSED — hors cascade, aucun
 * maître n'est proposé, jamais de repli sur la première fiche du tableau.
 *
 * Pourquoi le PMP n'est PAS au même niveau que le prix HT : la valorisation
 * de la consommation lit `prix_pmp` UNIQUEMENT (action `conso-valorisee`,
 * aucun repli sur `prix_ht`). Une fiche qui ne porte qu'un prix HT n'est donc
 * pas valorisée. Mettre les deux champs au même niveau (« a un prix »)
 * rendrait indécidable le groupe « PMP contre HT », alors que la réponse est
 * évidente : garder celle qui fait fonctionner la valorisation.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - `prix_pmp` et `prix_ht` traités au même niveau ;
 *  - `prix_ht` consulté alors qu'un PMP existe ;
 *  - `nb_achats` consulté alors qu'un prix existe ;
 *  - repli sur `liste[0]` quand rien ne tranche ;
 *  - `=== 1` relâché en `>= 1` à n'importe quel niveau.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../functions/lib/stockMerge/masterSuggestion.js');

/**
 * Fiche de test. Le docId (`id`) diverge VOLONTAIREMENT du champ `reference`
 * (espace inséré), comme sur les 92 fiches de production concernées : un test
 * où les deux coïncident ne verrait pas la confusion des deux clés.
 */
const A = (id, extra) =>
  Object.assign({ id, reference: id.replace(/^(\w{3})/, '$1 '), nom: 'Acide Phosphorique' }, extra || {});

// ── niveau 1 : le PMP ──────────────────────────────────────────────────────

test('niveau 1 — une seule fiche porte un PMP : c’est elle, et la raison le dit', () => {
  const r = S.choisirMaster([A('D', { nb_achats: 40 }), A('M', { prix_pmp: 38.25 })]);
  assert.equal(r.decidable, true);
  assert.equal(r.master_ref, 'M');
  assert.equal(r.regle, S.REGLE_PMP);
  // Le PMP prime sur nb_achats : `conso-valorisee` lit le PMP, pas les achats.
  assert.match(r.raison, /38,25 DH/);
  assert.match(r.raison, /PMP/);
});

test('une fiche à PMP bat une fiche à prix HT — c’est LE point de la cascade', () => {
  // Mutation à surveiller : traiter prix_pmp et prix_ht au même niveau. Le
  // groupe deviendrait indécidable, alors que la réponse est évidente :
  // seule la fiche à PMP est valorisée par `conso-valorisee`.
  const r = S.choisirMaster([A('HT', { prix_ht: 74.38 }), A('PMP', { prix_pmp: 12 })]);
  assert.equal(r.decidable, true);
  assert.equal(r.master_ref, 'PMP');
  assert.equal(r.regle, S.REGLE_PMP);
  assert.match(r.raison, /12,00 DH/);
  // Le montant affiché est celui du PMP, pas celui du HT concurrent.
  assert.doesNotMatch(r.raison, /74,38/);
});

test('le prix HT n’est JAMAIS consulté tant qu’un PMP existe quelque part', () => {
  // Deux PMP concurrents : indécidable. Un repli sur le prix HT désignerait
  // une fiche contre un PMP concurrent — c'est un arbitrage humain.
  const r = S.choisirMaster([
    A('A', { prix_pmp: 10 }),
    A('B', { prix_pmp: 20, prix_ht: 5 }),
    A('C', { prix_ht: 99 }),
  ]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
  assert.match(r.raison, /2 fiches portent un PMP/);
});

// ── niveau 2 : le prix HT, à défaut de tout PMP ────────────────────────────

test('niveau 2 — aucun PMP, une seule fiche à prix HT : c’est elle', () => {
  const r = S.choisirMaster([A('D', {}), A('M', { prix_ht: 74.38 })]);
  assert.equal(r.decidable, true);
  assert.equal(r.master_ref, 'M');
  assert.equal(r.regle, S.REGLE_PRIX_HT);
  assert.match(r.raison, /74,38 DH/);
  assert.match(r.raison, /prix HT/);
  // Omar doit savoir que l'article restera NON VALORISÉ : la fusion ne répare
  // pas l'absence de PMP. C'est le cas des 26 groupes type MEGAFOL EN 10L.
  assert.match(r.raison, /n'est valorisé ni avant ni après/);
});

test('niveau 2 — le prix HT bat un historique d’achats', () => {
  // Cas MEGAFOL EN 10L : ht 74,38 contre 4 achats.
  const r = S.choisirMaster([A('ACHATS', { nb_achats: 4 }), A('HT', { prix_ht: 74.38 })]);
  assert.equal(r.master_ref, 'HT');
  assert.equal(r.regle, S.REGLE_PRIX_HT);
});

test('deux prix HT et aucun PMP -> indécidable', () => {
  const r = S.choisirMaster([A('A', { prix_ht: 10 }), A('B', { prix_ht: 42, nb_achats: 9 })]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
  assert.match(r.raison, /2 fiches portent un prix HT/);
});

test('un prix à 0, négatif ou non numérique n’est PAS un prix', () => {
  for (const bidon of [0, '0', -3, null, undefined, '', 'n/a', NaN, {}]) {
    assert.equal(S.pmpArticle({ prix_pmp: bidon }), null, 'pmp bidon : ' + String(bidon));
    assert.equal(S.prixHtArticle({ prix_ht: bidon }), null, 'ht bidon : ' + String(bidon));
  }
  assert.equal(S.pmpArticle({ prix_pmp: '12.5' }), 12.5, 'un prix en chaîne reste un prix');
  // Une fiche « valorisée à 0 » ne doit pas gagner contre la vraie fiche.
  const r = S.choisirMaster([A('A', { prix_pmp: 0, nb_achats: 8 }), A('B', { prix_ht: 3.2 })]);
  assert.equal(r.master_ref, 'B');
});

test('prixArticle (helper d’AFFICHAGE) : PMP prioritaire, HT en repli', () => {
  // Sert la pop-up, pas la décision : afficher le HT quand un PMP existe
  // montrerait un montant faux à Omar.
  assert.equal(S.prixArticle({ prix_pmp: 7.5, prix_ht: 99 }).champ, 'prix_pmp');
  assert.equal(S.prixArticle({ prix_pmp: 7.5, prix_ht: 99 }).valeur, 7.5);
  assert.equal(S.prixArticle({ prix_pmp: 0, prix_ht: 4 }).champ, 'prix_ht');
  assert.equal(S.prixArticle({}), null);
});

// ── niveau 3 : l'historique d'achats ───────────────────────────────────────

test('niveau 3 — aucun prix, une seule fiche avec des achats : c’est elle', () => {
  const r = S.choisirMaster([A('M', { nb_achats: 17 }), A('D', { nb_achats: 0 })]);
  assert.equal(r.decidable, true);
  assert.equal(r.master_ref, 'M');
  assert.equal(r.regle, S.REGLE_NB_ACHATS);
  assert.match(r.raison, /17 achats/);
});

test('nb_achats : 0, négatif et non numérique valent 0', () => {
  for (const bidon of [0, -1, null, undefined, '', 'x', NaN]) {
    assert.equal(S.nbAchatsArticle({ nb_achats: bidon }), 0, 'nb_achats bidon : ' + String(bidon));
  }
  assert.equal(S.nbAchatsArticle({ nb_achats: '7' }), 7);
});

test('le niveau 3 n’est PAS consulté quand un PMP existe', () => {
  // Deux PMP concurrents : le niveau 1 ne départage pas. Retenir sur nb_achats
  // une fiche contre un PMP concurrent casserait la valorisation -> refus.
  const r = S.choisirMaster([
    A('A', { prix_pmp: 10, nb_achats: 0 }),
    A('B', { prix_pmp: 10, nb_achats: 5 }),
  ]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
});

test('le niveau 3 n’est PAS consulté quand un prix HT existe', () => {
  // Deux prix HT, une seule fiche avec des achats : on ne trancherait sur les
  // achats que si AUCUN prix n'existait nulle part.
  const r = S.choisirMaster([
    A('A', { prix_ht: 10 }),
    A('B', { prix_ht: 42 }),
    A('C', { nb_achats: 7 }),
  ]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
});

// ── fail-closed ────────────────────────────────────────────────────────────

test('deux fiches portent un PMP -> NON décidable, aucun maître', () => {
  const r = S.choisirMaster([A('A', { prix_pmp: 10 }), A('B', { prix_pmp: 42 })]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
  assert.equal(r.regle, null);
  assert.match(r.raison, /2 fiches portent un PMP/);
});

test('aucune donnée exploitable -> NON décidable, aucun maître', () => {
  const r = S.choisirMaster([A('A'), A('B')]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
  assert.match(r.raison, /ni d'historique d'achats/);
});

test('plusieurs historiques d’achats et aucun prix -> NON décidable', () => {
  const r = S.choisirMaster([A('A', { nb_achats: 3 }), A('B', { nb_achats: 9 })]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
  assert.match(r.raison, /2 fiches portent un historique/);
});

test('JAMAIS de repli sur la première fiche du tableau', () => {
  // Le bug d'origine : m[g.normalized] = g.articles[0].reference. Si un jour
  // un repli revenait, `master_ref` cesserait d'être null ici.
  const groupes = [
    [A('PREMIERE'), A('SECONDE')],
    [A('PREMIERE', { nb_achats: 2 }), A('SECONDE', { nb_achats: 9 })],
    [A('PREMIERE', { prix_pmp: 1 }), A('SECONDE', { prix_pmp: 2 })],
    [A('PREMIERE', { prix_ht: 1 }), A('SECONDE', { prix_ht: 2 })],
  ];
  for (const g of groupes) {
    const r = S.choisirMaster(g);
    assert.equal(r.decidable, false);
    assert.equal(r.master_ref, null, 'aucun maître ne doit être proposé');
    assert.notEqual(r.master_ref, 'PREMIERE');
  }
});

test('une fiche sans référence exploitable ne peut pas être présélectionnée', () => {
  const r = S.choisirMaster([A('', { prix_pmp: 5 }), A('D')]);
  assert.equal(r.decidable, false);
  assert.equal(r.master_ref, null);
});

test('groupe dégénéré (<2 fiches, null, non-array) : refus, jamais de crash', () => {
  for (const mauvais of [[], [A('A', { prix_pmp: 5 })], null, undefined, 42, 'x']) {
    const r = S.choisirMaster(mauvais);
    assert.equal(r.decidable, false, 'entrée : ' + JSON.stringify(mauvais));
    assert.equal(r.master_ref, null);
    assert.equal(typeof r.raison, 'string');
  }
  // Les entrées nulles d'un groupe sont ignorées, pas comptées comme fiches.
  assert.equal(S.choisirMaster([null, A('A', { prix_pmp: 1 })]).decidable, false);
});

test('groupe de 3 fiches : le maître reste unique', () => {
  const r = S.choisirMaster([
    A('A', { nb_achats: 2 }),
    A('B', { prix_pmp: 5 }),
    A('C', { nb_achats: 9 }),
  ]);
  assert.equal(r.decidable, true);
  assert.equal(r.master_ref, 'B');
});

test('la fiche retenue et les fiches absorbées sont rendues (chemin script)', () => {
  // Le script de fusion en masse fusionne sur le docId : il a besoin des
  // OBJETS, pas seulement de la référence.
  const pmp = A('B', { prix_pmp: 5 });
  const r = S.choisirMaster([A('A', { nb_achats: 2 }), pmp, A('C', { nb_achats: 9 })]);
  assert.equal(r.master, pmp);
  assert.deepEqual(r.doublons.map((d) => d.reference).sort(), ['A', 'C']);
  // Le maître n'apparaît JAMAIS dans les doublons (merge-articles rend 400).
  assert.equal(r.doublons.includes(r.master), false);
  // Et un refus ne propose ni maître ni doublons.
  const refus = S.choisirMaster([A('A'), A('B')]);
  assert.equal(refus.master, null);
  assert.deepEqual(refus.doublons, []);
});

test('la clé de fusion est le docId `id`, JAMAIS le champ `reference`', () => {
  // `merge-articles` résout par `.doc(<clé>)`. 92 fiches de production ont un
  // `reference` espacé que le docId n'a pas, et des documents FANTÔMES sans
  // nom existent à ces références-là : rendre `reference` comme master_ref
  // ferait fusionner vers le fantôme.
  assert.equal(S.cleDocument({ reference: 'ENG 0150', id: 'ENG0150' }), 'ENG0150');
  assert.equal(S.cleDocument({ id: 'DOC' }), 'DOC');
  assert.equal(S.cleDocument({ reference: 'REF' }), 'REF', 'repli pour les appelants sans docId');
  assert.equal(S.cleDocument({}), '');
  assert.equal(S.cleDocument(null), '');
});

test('cas « magical » : le maître rendu est le docId, pas la référence espacée', () => {
  // Fiche réelle ENG0150 (prix_pmp 107,95) + fantôme homonyme « ENG 0150 »
  // sans nom ni active, ne portant qu'un prix_ht.
  const reelle = { id: 'ENG0150', reference: 'ENG 0150', nom: 'MAGICAL', prix_pmp: 107.95, active: true };
  const jumelle = { id: 'ENG0151', reference: 'ENG 0151', nom: 'Magical', nb_achats: 5, active: true };
  const r = S.choisirMaster([jumelle, reelle]);
  assert.equal(r.decidable, true);
  assert.equal(r.master_ref, 'ENG0150', 'le docId, pas « ENG 0150 »');
  assert.notEqual(r.master_ref, 'ENG 0150', 'la référence espacée adresse un document FANTÔME');
  assert.equal(r.master.id, r.master_ref);
});

test('la raison est une phrase française affichable telle quelle', () => {
  for (const g of [
    [A('A', { prix_pmp: 3 }), A('B')],
    [A('A', { prix_ht: 3 }), A('B')],
    [A('A', { nb_achats: 3 }), A('B')],
    [A('A'), A('B')],
    [A('A', { prix_pmp: 1 }), A('B', { prix_pmp: 2 })],
    [A('A', { prix_ht: 1 }), A('B', { prix_ht: 2 })],
    [A('A', { nb_achats: 1 }), A('B', { nb_achats: 2 })],
  ]) {
    const r = S.choisirMaster(g);
    assert.equal(typeof r.raison, 'string');
    assert.ok(r.raison.length > 10, 'raison trop courte : ' + r.raison);
    assert.doesNotMatch(r.raison, /undefined|NaN|\[object/);
  }
});

test('formatDh : virgule décimale française et unité', () => {
  assert.equal(S.formatDh(38.25), '38,25 DH');
  assert.equal(S.formatDh(12), '12,00 DH');
});
