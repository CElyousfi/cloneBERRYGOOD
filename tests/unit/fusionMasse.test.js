'use strict';

/*
 * FUSION EN MASSE — logique pure d'orchestration (public/lib/fusionMasse.js).
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - un groupe sans maître déterminé devient sélectionnable ;
 *  - la sélection est adressée par `reference` au lieu du docId `id` ;
 *  - la signature du lot cesse de dépendre de la sélection (aperçu contourné) ;
 *  - l'aperçu global recalcule au lieu d'additionner les réponses serveur ;
 *  - le compte rendu oublie les groupes restés en attente après une anomalie.
 */

const test = require('node:test');
const assert = require('node:assert');
const FM = require('./_esm').loadEsm('src/modules/shared/lib/fusionMasse.js');

// ── fixtures ───────────────────────────────────────────────────────────────
// `id` (docId) et `reference` DIVERGENT partout, comme sur les 92 fiches de
// production concernées : un fixture où les deux coïncident ne verrait pas
// l'écran adresser la mauvaise clé.

const G_DECIDABLE = {
  normalized: 'magical',
  decidable: true,
  master_suggere: 'ENG0150',
  raison: 'seule fiche à porter un PMP — 107,95 DH',
  articles: [
    { id: 'ENG0151', reference: 'ENG 0151', nom: 'Magical' },
    { id: 'ENG0150', reference: 'ENG 0150', nom: 'MAGICAL' },
  ],
};

const G_INDECIDABLE = {
  normalized: 'gib 3',
  decidable: false,
  master_suggere: null,
  raison: 'aucune fiche ne porte de prix ni d\'historique d\'achats — à choisir manuellement',
  articles: [
    { id: 'PHY0001', reference: 'PHY 0001', nom: 'GIB 3' },
    { id: 'PHY0002', reference: 'PHY 0002', nom: 'gib 3' },
  ],
};

const G_TRIPLE = {
  normalized: 'ksc',
  decidable: true,
  master_suggere: 'KSC1',
  raison: 'seule fiche à porter un PMP — 12,00 DH',
  articles: [
    { id: 'KSC1', reference: 'KSC 1', nom: 'KSC' },
    { id: 'KSC2', reference: 'KSC 2', nom: 'ksc' },
    { id: 'KSC3', reference: 'KSC 3', nom: 'Ksc' },
  ],
};

const MASTERS = { magical: 'ENG0150', ksc: 'KSC1' };

// ── 1. SÉLECTION FAIL-CLOSED ───────────────────────────────────────────────

test('un groupe avec maître déterminé est sélectionnable', () => {
  assert.strictEqual(FM.estSelectionnable(G_DECIDABLE, MASTERS), true);
});

test('un groupe INDÉCIDABLE n\'est PAS sélectionnable', () => {
  // Cœur du fail-closed : une fusion en masse ne devine jamais un maître.
  assert.strictEqual(FM.estSelectionnable(G_INDECIDABLE, MASTERS), false);
  assert.match(FM.raisonNonSelectionnable(G_INDECIDABLE, MASTERS), /aucun article à conserver/);
  assert.match(FM.raisonNonSelectionnable(G_INDECIDABLE, MASTERS), /à choisir manuellement/);
});

test('un groupe indécidable ARBITRÉ à la main redevient sélectionnable', () => {
  const masters = Object.assign({}, MASTERS, { 'gib 3': 'PHY0002' });
  assert.strictEqual(FM.estSelectionnable(G_INDECIDABLE, masters), true);
  assert.strictEqual(FM.raisonNonSelectionnable(G_INDECIDABLE, masters), '');
});

test('un groupe où le maître est la SEULE fiche n\'est pas sélectionnable', () => {
  const solo = { normalized: 'solo', articles: [{ id: 'A', reference: 'A' }] };
  assert.strictEqual(FM.estSelectionnable(solo, { solo: 'A' }), false);
  assert.match(FM.raisonNonSelectionnable(solo, { solo: 'A' }), /aucun doublon/);
});

test('clesSelectionnables écarte les groupes sans maître', () => {
  assert.deepStrictEqual(
    FM.clesSelectionnables([G_DECIDABLE, G_INDECIDABLE, G_TRIPLE], MASTERS),
    ['magical', 'ksc']
  );
});

// ── 2. ADRESSAGE : docId, jamais le champ `reference` ──────────────────────

test('le lot porte les docId, jamais les références espacées', () => {
  const { lot } = FM.construireLot([G_DECIDABLE], MASTERS, { magical: true });
  assert.strictEqual(lot.length, 1);
  assert.strictEqual(lot[0].master_ref, 'ENG0150');
  assert.deepStrictEqual(lot[0].doublon_refs, ['ENG0151']);
  // « ENG 0150 » est un document FANTÔME réel, sans nom ni `active`.
  for (const ref of [lot[0].master_ref].concat(lot[0].doublon_refs)) {
    assert.doesNotMatch(ref, /\s/, 'référence espacée dans le lot : ' + ref);
  }
});

test('le maître n\'est jamais dans ses propres doublons', () => {
  const { lot } = FM.construireLot([G_TRIPLE], MASTERS, { ksc: true });
  assert.deepStrictEqual(lot[0].doublon_refs, ['KSC2', 'KSC3']);
  assert.strictEqual(lot[0].doublon_refs.indexOf(lot[0].master_ref), -1);
});

test('une fiche sans docId n\'est jamais adressée par sa référence', () => {
  // Réponse d'un serveur plus ancien : sans `id`, on ne sait pas adresser la
  // fiche. On ne se rabat PAS sur `reference` (le fantôme « ENG 0150 »), donc
  // le groupe se retrouve sans doublon exploitable et sort du lot.
  const g = {
    normalized: 'x',
    articles: [{ id: 'M', reference: 'M' }, { reference: 'SANS_ID' }],
  };
  const { lot, ignores } = FM.construireLot([g], { x: 'M' }, { x: true });
  assert.deepStrictEqual(lot, [], 'aucune fusion ne doit partir sur une fiche non adressable');
  assert.deepStrictEqual(ignores.map((i) => i.normalized), ['x']);
  assert.deepStrictEqual(FM.doublonsDuGroupe(g, 'M'), []);
});

// ── 3. CONSTRUCTION DU LOT ─────────────────────────────────────────────────

test('seuls les groupes COCHÉS entrent dans le lot', () => {
  const { lot, ignores } = FM.construireLot([G_DECIDABLE, G_TRIPLE], MASTERS, { ksc: true });
  assert.deepStrictEqual(lot.map((e) => e.normalized), ['ksc']);
  assert.deepStrictEqual(ignores, [], 'un groupe non coché n\'est pas un « ignoré »');
});

test('un groupe coché mais indécidable est ÉCARTÉ avec sa raison, sans casser le lot', () => {
  const { lot, ignores } = FM.construireLot(
    [G_DECIDABLE, G_INDECIDABLE],
    MASTERS,
    { magical: true, 'gib 3': true }
  );
  assert.deepStrictEqual(lot.map((e) => e.normalized), ['magical']);
  assert.strictEqual(ignores.length, 1);
  assert.strictEqual(ignores[0].normalized, 'gib 3');
  assert.match(ignores[0].raison, /aucun article à conserver/);
});

test('lot vide quand rien n\'est coché', () => {
  const { lot, ignores } = FM.construireLot([G_DECIDABLE, G_TRIPLE], MASTERS, {});
  assert.deepStrictEqual(lot, []);
  assert.deepStrictEqual(ignores, []);
});

// ── 4. SIGNATURE : l'aperçu ne vaut que pour LE lot chiffré ────────────────

test('la signature change quand la sélection change', () => {
  const un = FM.construireLot([G_DECIDABLE, G_TRIPLE], MASTERS, { magical: true }).lot;
  const deux = FM.construireLot([G_DECIDABLE, G_TRIPLE], MASTERS, { magical: true, ksc: true }).lot;
  assert.notStrictEqual(FM.signatureLot(un), FM.signatureLot(deux));
});

test('la signature change quand le MAÎTRE d\'un groupe change', () => {
  // Sinon : Omar chiffre une fusion vers ENG0150, coche une autre fiche, et
  // l'exécution part sur un maître jamais prévisualisé.
  const a = FM.construireLot([G_DECIDABLE], MASTERS, { magical: true }).lot;
  const b = FM.construireLot([G_DECIDABLE], { magical: 'ENG0151' }, { magical: true }).lot;
  assert.notStrictEqual(FM.signatureLot(a), FM.signatureLot(b));
});

test('la signature est stable si le lot est identique, quel que soit l\'ordre', () => {
  const a = FM.construireLot([G_DECIDABLE, G_TRIPLE], MASTERS, { magical: true, ksc: true }).lot;
  const b = FM.construireLot([G_TRIPLE, G_DECIDABLE], MASTERS, { magical: true, ksc: true }).lot;
  assert.strictEqual(FM.signatureLot(a), FM.signatureLot(b));
  assert.notStrictEqual(FM.signatureLot(a), '', 'un lot non vide a une signature non vide');
});

// ── 5. APERÇU GLOBAL ───────────────────────────────────────────────────────

test('l\'aperçu global additionne les chiffres RENVOYÉS par le serveur', () => {
  const total = FM.agregerApercu([
    { doublon_refs: ['A'], preview: { open_movements: 3, open_bdc: 1, doublon_balances_count: 2 } },
    { doublon_refs: ['B', 'C'], preview: { open_movements: 0, open_bdc: 4, doublon_balances_count: 5 } },
  ]);
  assert.deepStrictEqual(total, {
    groupes: 2,
    fiches_desactivees: 3,
    soldes_agreges: 7,
    mouvements: 3,
    bdc: 5,
  });
});

test('l\'aperçu d\'un lot vide est à zéro partout', () => {
  assert.deepStrictEqual(FM.agregerApercu([]), {
    groupes: 0, fiches_desactivees: 0, soldes_agreges: 0, mouvements: 0, bdc: 0,
  });
});

test('une preview incomplète ne fait pas exploser le total en NaN', () => {
  const total = FM.agregerApercu([{ doublon_refs: ['A'], preview: {} }]);
  assert.strictEqual(total.mouvements, 0);
  assert.strictEqual(total.soldes_agreges, 0);
  assert.strictEqual(Number.isNaN(total.bdc), false);
});

// ── 6. COMPTE RENDU FINAL ──────────────────────────────────────────────────

const LOT_3 = [
  { normalized: 'a', master_ref: 'A1', doublon_refs: ['A2'] },
  { normalized: 'b', master_ref: 'B1', doublon_refs: ['B2', 'B3'] },
  { normalized: 'c', master_ref: 'C1', doublon_refs: ['C2'] },
];

test('lot entièrement passé : compte rendu complet, aucune anomalie', () => {
  const r = FM.resumerExecution(LOT_3, [
    { normalized: 'a', ok: true, doublon_refs: ['A2'], counts: { movements: 1, balances: 2, bdc: 0 } },
    { normalized: 'b', ok: true, doublon_refs: ['B2', 'B3'], counts: { movements: 0, balances: 1, bdc: 3 } },
    { normalized: 'c', ok: true, doublon_refs: ['C2'], counts: { movements: 4, balances: 0, bdc: 0 } },
  ], []);
  assert.strictEqual(r.groupes_fusionnes, 3);
  assert.strictEqual(r.fiches_desactivees, 4);
  assert.strictEqual(r.soldes_agreges, 3);
  assert.strictEqual(r.mouvements, 5);
  assert.strictEqual(r.bdc, 3);
  assert.deepStrictEqual(r.non_fusionnes, []);
  assert.strictEqual(r.arret_anomalie, false);
});

test('arrêt à la première anomalie : on sait CE QUI est passé et CE QUI RESTE', () => {
  // Le pire scénario n'est pas l'échec, c'est l'échec muet à mi-parcours.
  const r = FM.resumerExecution(LOT_3, [
    { normalized: 'a', ok: true, doublon_refs: ['A2'], counts: { movements: 1, balances: 1, bdc: 0 } },
    { normalized: 'b', ok: false, error: 'Article doublon introuvable: B2' },
  ], []);
  assert.strictEqual(r.groupes_fusionnes, 1);
  assert.strictEqual(r.fiches_desactivees, 1);
  assert.strictEqual(r.arret_anomalie, true);
  const parCle = {};
  for (const g of r.non_fusionnes) parCle[g.normalized] = g.raison;
  assert.match(parCle.b, /Article doublon introuvable: B2/);
  assert.match(parCle.c, /lot arrêté/, 'le groupe jamais tenté doit être listé lui aussi');
  assert.strictEqual(Object.keys(parCle).length, 2);
});

test('les groupes écartés AVANT exécution figurent aussi au compte rendu', () => {
  const r = FM.resumerExecution(
    LOT_3.slice(0, 1),
    [{ normalized: 'a', ok: true, doublon_refs: ['A2'], counts: {} }],
    [{ normalized: 'gib 3', raison: 'aucun article à conserver n\'est déterminé' }]
  );
  assert.strictEqual(r.groupes_fusionnes, 1);
  assert.strictEqual(r.arret_anomalie, false);
  assert.deepStrictEqual(r.non_fusionnes.map((g) => g.normalized), ['gib 3']);
});

test('sans arrêt, les groupes non traités ne sont pas inventés comme non fusionnés', () => {
  const r = FM.resumerExecution(LOT_3, [
    { normalized: 'a', ok: true, doublon_refs: ['A2'], counts: {} },
  ], []);
  assert.deepStrictEqual(r.non_fusionnes, []);
});
