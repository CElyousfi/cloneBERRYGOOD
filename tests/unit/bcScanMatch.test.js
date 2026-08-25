'use strict';

// Rapprochement en-tête de pile ↔ parcelles du <select> (public/lib/bcScanMatch.js).
//
// La fixture est la VRAIE liste de production (43 labels de
// `sql_mirror_pointage_meta/br_parcelle_sup`, source de
// `parcelles-campagne-list`), pas un échantillon : c'est elle qui a montré que
// le rapprochement serveur (fait contre `sb_parcelle_referentiel`) ne produisait
// que des propositions non sélectionnables côté client.
//
// `window.CultureUtils` est posé AVANT le chargement du module : c'est la source
// de vérité du repo pour la culture d'une parcelle, la lib n'en redéfinit pas.

const test = require('node:test');
const assert = require('node:assert');

global.window = { CultureUtils: require('../../public/lib/cultureUtils.js') };
const M = require('../../public/lib/bcScanMatch.js');

/** Les 43 parcelles réellement proposées à la saisie d'un BC. */
const OPTIONS = [
  'AVOCAT F5', 'Avocat AVOCAT F6 AVOCAT', 'B6-AGRUMES', 'B6-HAAS', 'B7-HAAS',
  'BREEZE MYRTILLE S8-2', 'CASCADE MYRTILLE S8-1', 'EL BAHIA',
  'F1- S5 MARAVILLA MD', 'F1-S6.S7 MARAVILLA MOTTE', 'F2 - BACON', 'F2 - HAAS', 'F2 - ZUTANO',
  'F3 -FUERTE', 'F3 -HAAS', 'F3 -ZUTANO', 'F4 -FUERTE', 'F4 -HAAS', 'F4 -ZUTANO',
  'F5 -BREEZE- S14', 'F5 CORINA myrtille S8-3', 'F5 YAZMIN MT', 'F5- CASCADE -S13', 'F5- MYA S9',
  'F6 -BACON', 'F6 -FUERTE', 'F6 -ZUTANO', 'F6-HAAS', 'Parcelle avocat FORTUNA SUPERMOTTE',
  'S1 - MARAVILLA MOW DOWN F1', 'S1.S4 Maravilla green can F1', 'S1/S4 Maravilla mow down F1',
  'S10 - YAZMIN MOTTE F5', 'S10 YAZMIN cut back F5', 'S13 - YAZMIN MOW DOWN F5',
  'S2 -YAZMIN MOW DOWN F1', 'S2.S3.S5.S6.S7 maravilla logn can F1', 'S3 - MARAVILLA MOTTE F1',
  'S4 -MARAVILLA MOW DOWN F1', 'S5 -YAZMIN MOW DOWN F1', 'S6- vide', 'S7 -MARAVILLA MOTTE F1',
  'S9 - REYNA F5',
];

// -------------------------------------------------------------- extracteurs

test('extractSecteurs — un libellé multi-secteurs les rend tous', () => {
  assert.deepStrictEqual(M.extractSecteurs('S2.S3.S5.S6.S7 maravilla logn can F1'),
    ['s2', 's3', 's5', 's6', 's7']);
});

test('extractSecteurs — « S-13-14 » = DEUX secteurs, « S8-2 » = un composé', () => {
  assert.deepStrictEqual(M.extractSecteurs('M.T.L S-13-14'), ['s13', 's14']);
  assert.deepStrictEqual(M.extractSecteurs('BREEZE MYRTILLE S8-2'), ['s8-2']);
});

test('extractSecteurs — parcelles sans secteur (avocat, YAZMIN MT)', () => {
  assert.deepStrictEqual(M.extractSecteurs('F2 - HAAS'), []);
  assert.deepStrictEqual(M.extractSecteurs('F5 YAZMIN MT'), []);
  assert.deepStrictEqual(M.extractSecteurs('EL BAHIA'), []);
});

test('extractSecteurs — le S de « yasmin » n\'est pas un secteur', () => {
  assert.deepStrictEqual(M.extractSecteurs('yasmin niyas S-9'), ['s9']);
});

test('extractVariete — orthographes manuscrites ramenées à la forme canonique', () => {
  assert.strictEqual(M.extractVariete('marvilla S-3'), 'maravilla');
  assert.strictEqual(M.extractVariete('yasmin niyas S-9'), 'yasmin');
  assert.strictEqual(M.extractVariete('S9 - REYNA F5'), 'reyna');
  assert.strictEqual(M.extractVariete('S-13'), '');
});

test('extractCulture — « M.T.L » = Myrtille, et pas de culture par défaut', () => {
  assert.strictEqual(M.extractCulture('M.T.L S-13'), 'Myrtille');
  assert.strictEqual(M.extractCulture('MTL S-8'), 'Myrtille');
  assert.strictEqual(M.extractCulture('myrtille S-13'), 'Myrtille');
  assert.strictEqual(M.extractCulture('avocatier F2'), 'Avocatier');
  assert.strictEqual(M.extractCulture('framboise S-3'), 'Framboise');
  // Absence de signal = absence de signal (surtout pas « Framboise » par défaut).
  assert.strictEqual(M.extractCulture('marvilla S-3'), '');
  assert.strictEqual(M.extractCulture(''), '');
});

// ------------------------------------------------- les 8 en-têtes de la mesure

test('[mesure] marvilla S-3 → S3 - MARAVILLA MOTTE F1 (exact)', () => {
  const r = M.matchParcelle('marvilla S-3', OPTIONS);
  assert.strictEqual(r.label, 'S3 - MARAVILLA MOTTE F1');
  assert.strictEqual(r.status, 'exact');
});

test('[mesure] marvilla S-5 → F1- S5 MARAVILLA MD (probable, la variété écarte YAZMIN)', () => {
  const r = M.matchParcelle('marvilla S-5', OPTIONS);
  assert.strictEqual(r.label, 'F1- S5 MARAVILLA MD');
  assert.strictEqual(r.status, 'probable');
});

// Passe VARIÉTÉ SANS SECTEUR : le secteur 9 porte aujourd'hui « F5 YAZMIN MT »,
// dont le libellé n'a aucun secteur — introuvable par la passe secteur.
test('[mesure] yasmin niyas S-9 → F5 YAZMIN MT (probable, jamais exact)', () => {
  const r = M.matchParcelle('yasmin niyas S-9', OPTIONS);
  assert.strictEqual(r.label, 'F5 YAZMIN MT');
  assert.strictEqual(r.status, 'probable');
  assert.strictEqual(r.score, 0.9);
});

test('[mesure] M.T.L S-13-14 → prudent : 2 candidats myrtille restants', () => {
  const r = M.matchParcelle('M.T.L S-13-14', OPTIONS);
  assert.strictEqual(r.label, '');
  assert.strictEqual(r.status, 'unmatched');
  assert.deepStrictEqual(r.candidats.slice().sort(), ['F5 -BREEZE- S14', 'F5- CASCADE -S13']);
});

test('[mesure] M.T.L S-13 → F5- CASCADE -S13 (la culture écarte la framboise)', () => {
  const r = M.matchParcelle('M.T.L S-13', OPTIONS);
  assert.strictEqual(r.label, 'F5- CASCADE -S13');
  assert.strictEqual(r.status, 'probable');
});

test('[mesure] myrtille S-13 → F5- CASCADE -S13', () => {
  assert.strictEqual(M.matchParcelle('myrtille S-13', OPTIONS).label, 'F5- CASCADE -S13');
});

test('[mesure] M.T.L S-8 → non résolu (S8-1/S8-2/S8-3 ≠ S8)', () => {
  const r = M.matchParcelle('M.T.L S-8', OPTIONS);
  assert.strictEqual(r.label, '');
  assert.strictEqual(r.status, 'unmatched');
});

// Garde-fou de la passe variété : un secteur déjà couvert par un label dédié de
// la MÊME variété ne doit jamais retomber sur la parcelle sans secteur.
test('[mesure] S10 YAZMIN cut back → PAS F5 YAZMIN MT', () => {
  const r = M.matchParcelle('S10 YAZMIN cut back', OPTIONS);
  assert.notStrictEqual(r.label, 'F5 YAZMIN MT');
  assert.strictEqual(r.status, 'unmatched');
  assert.deepStrictEqual(r.candidats.slice().sort(), ['S10 - YAZMIN MOTTE F5', 'S10 YAZMIN cut back F5']);
});

// ------------------------------------------- non-régressions du signal culture

// Le raccourci « seule mono-parcelle sur son secteur → exact » ne doit JAMAIS
// s'exécuter avant la contradiction de culture : sinon un bon myrtille part sur
// une parcelle framboise avec une pastille ✅ « Reconnu », sans aucun signal
// invitant le magasinier à vérifier. C'est le pire cas possible de la feature.
test('[non-régression] un en-tête Myrtille ne prend JAMAIS une parcelle Framboise', () => {
  for (const entete of ['M.T.L S-3', 'M.T.L S-1', 'M.T.L S-4', 'M.T.L S-7', 'myrtille S-3']) {
    const r = M.matchParcelle(entete, OPTIONS);
    assert.strictEqual(r.status, 'unmatched', entete + ' → ' + r.label);
    assert.strictEqual(r.label, '', entete);
    assert.notStrictEqual(r.status, 'exact', entete);
  }
});

// Même garde, branche Avocatier — testée à part côté FRONT : le test de parité
// ne prouve rien si les deux implémentations perdent la branche en même temps.
test('[non-régression] un en-tête Avocatier ne prend JAMAIS une parcelle Framboise', () => {
  for (const entete of ['avocatier S-3', 'avocat S-3', 'avocat S-13']) {
    const r = M.matchParcelle(entete, OPTIONS);
    assert.strictEqual(r.label, '', entete + ' → ' + r.label);
    assert.strictEqual(r.status, 'unmatched', entete);
  }
});

test('[non-régression] la parcelle contredite reste offerte en suggestion', () => {
  const r = M.matchParcelle('M.T.L S-3', OPTIONS);
  assert.ok(r.candidats.includes('S3 - MARAVILLA MOTTE F1'));
});

// Une culture Framboise dans l'en-tête ne vetoe rien : `resolveCulture` attribue
// « Framboise » PAR DÉFAUT, donc l'absence de signal ne doit pas se transformer
// en contradiction.
test('[non-régression] le défaut « Framboise » de resolveCulture ne vetoe rien', () => {
  const r = M.matchParcelle('framboise S-3', OPTIONS);
  assert.strictEqual(r.label, 'S3 - MARAVILLA MOTTE F1');
  assert.strictEqual(r.status, 'exact');
});

// L'en-tête affirme un secteur qu'aucune option ne porte : signal d'incohérence,
// pas une invitation à deviner. « F5 YAZMIN MT » est au secteur 9.
test('[non-régression] secteur sans aucune option → rien n\'est proposé', () => {
  for (const entete of ['yazmin S-11', 'yazmin S-12', 'yasmin S-15', 'yasmin niyas S-20']) {
    const r = M.matchParcelle(entete, OPTIONS);
    assert.strictEqual(r.label, '', entete + ' → ' + r.label);
    assert.strictEqual(r.status, 'unmatched', entete);
    // Le label reste à un clic, en suggestion.
    assert.deepStrictEqual(r.candidats, ['F5 YAZMIN MT'], entete);
  }
});

// Deux variétés cohabitent sur le secteur 9 : « F5- MYA S9 » et « F5 YAZMIN MT »
// (sans secteur). Le magasinier écrit « Miya S-9 » le 09/07 et
// « yassmin niyas S-9 » les 08 et 14/07 — les deux doivent tomber juste.
test('[mesure] miya / mya S-9 → F5- MYA S9', () => {
  for (const entete of ['miya S-9', 'mya S-9', 'Miya S-9']) {
    const r = M.matchParcelle(entete, OPTIONS);
    assert.strictEqual(r.label, 'F5- MYA S9', entete);
    assert.notStrictEqual(r.status, 'unmatched', entete);
  }
});

test('[non-régression] Mya n\'écrase pas Yazmin sur le secteur 9', () => {
  for (const entete of ['yasmin niyas S-9', 'yassmin niyas S-9']) {
    const r = M.matchParcelle(entete, OPTIONS);
    assert.strictEqual(r.label, 'F5 YAZMIN MT', entete);
    assert.strictEqual(r.status, 'probable', entete);
  }
  // Sans variété, S9 reste ambigu : on ne devine toujours pas.
  const r = M.matchParcelle('S-9', OPTIONS);
  assert.strictEqual(r.label, '');
  assert.deepStrictEqual(r.candidats.slice().sort(), ['F5- MYA S9', 'S9 - REYNA F5']);
});

test('la passe variété ne court-circuite pas la passe secteur (S2 -YAZMIN)', () => {
  const r = M.matchParcelle('S2 -YAZMIN MOW DOWN', OPTIONS);
  assert.strictEqual(r.label, 'S2 -YAZMIN MOW DOWN F1');
  assert.strictEqual(r.status, 'exact');
});

// ------------------------------------------------------------ gardes & bords

test('secteur S9 sans variété → ambigu (2 parcelles sur S9), on ne devine pas', () => {
  const r = M.matchParcelle('S-9', OPTIONS);
  assert.strictEqual(r.label, '');
  assert.deepStrictEqual(r.candidats.slice().sort(), ['F5- MYA S9', 'S9 - REYNA F5']);
});

test('un libellé couvrant plus de secteurs que l\'en-tête n\'est jamais posé', () => {
  const r = M.matchParcelle('maravilla S-3', OPTIONS);
  assert.notStrictEqual(r.label, 'S2.S3.S5.S6.S7 maravilla logn can F1');
});

test('en-tête vide / null / sans secteur ni variété → non résolu', () => {
  for (const v of ['', '   ', null, undefined, 'zzz', 'bon du jour']) {
    const r = M.matchParcelle(v, OPTIONS);
    assert.strictEqual(r.status, 'unmatched', String(v));
    assert.strictEqual(r.label, '', String(v));
  }
});

test('aucune option → non résolu (jamais de crash)', () => {
  assert.strictEqual(M.matchParcelle('marvilla S-3', []).status, 'unmatched');
  assert.strictEqual(M.matchParcelle('marvilla S-3', null).status, 'unmatched');
});

test('un label absent des options n\'est JAMAIS renvoyé', () => {
  const entetes = ['marvilla S-3', 'marvilla S-5', 'yasmin niyas S-9', 'M.T.L S-13-14',
    'M.T.L S-13', 'myrtille S-13', 'M.T.L S-8', 'S10 YAZMIN cut back', 'S-9', 'avocat F2'];
  for (const e of entetes) {
    const r = M.matchParcelle(e, OPTIONS);
    if (r.label) assert.ok(OPTIONS.includes(r.label), e + ' → ' + r.label);
    r.candidats.forEach((c) => assert.ok(OPTIONS.includes(c), e + ' → candidat ' + c));
  }
});

// Angle mort mesuré par la QA : la variété portée par le nom affiché (nom_sb)
// et non par le libellé BEE ONE.
test('la variété peut venir du nom affiché (nom_sb) de l\'option', () => {
  const opts = [
    { label: 'BEE-001', nom: 'S5 MARAVILLA MOTTE', culture: 'Framboise' },
    { label: 'BEE-002', nom: 'S5 YAZMIN MOW DOWN', culture: 'Framboise' },
  ];
  // Le secteur se lit sur le LIBELLÉ : BEE-001/002 n'en ont pas. Un en-tête sans
  // secteur passe donc par la passe variété, qui exploite le nom affiché.
  const r = M.matchParcelle('marvilla motte', opts);
  assert.strictEqual(r.label, 'BEE-001');
  assert.strictEqual(r.status, 'probable');
});

test('la culture peut venir du champ culture de l\'option', () => {
  const opts = [
    { label: 'S20 - A', culture: 'Myrtille' },
    { label: 'S20 - B', culture: 'Framboise' },
  ];
  const r = M.matchParcelle('M.T.L S-20', opts);
  assert.strictEqual(r.label, 'S20 - A');
  assert.strictEqual(r.status, 'probable');
});

test('window.CultureUtils absent → signal culture ignoré, aucun crash', () => {
  const saved = global.window;
  global.window = {};
  try {
    const r = M.matchParcelle('M.T.L S-13', OPTIONS);
    assert.strictEqual(r.status, 'unmatched');
    assert.deepStrictEqual(r.candidats.slice().sort(), ['F5- CASCADE -S13', 'S13 - YAZMIN MOW DOWN F5']);
  } finally {
    global.window = saved;
  }
});

// ----------------------------------------------------------- anti-divergence

// La duplication front/back est imposée (le backend n'est pas servi au
// navigateur) : c'est au test de surveiller qu'elle ne DIVERGE pas, comme le
// fait déjà campagneBudgetTab.test.js pour le budget de campagne.
const backend = require('../../functions/lib/stock/bcScan');

// ⚠️ CES CONDITIONS SONT DES ASSERTIONS, PAS DES CONFIGURATIONS.
//
// Elles ont d'abord été des `t.skip()` conditionnels, le temps que le miroir
// backend soit porté. C'était un filet qui s'annulait exactement dans le cas
// qu'il devait détecter : le probe interrogeait LE MÊME prédicat que celui
// qu'il gardait, donc un backend PERDANT la garde rendait le probe faux, le
// test se skippait, et la suite restait verte (trouvé par mutation testing).
// Le miroir étant livré dans cette branche, l'absence d'un de ces signaux
// côté backend est désormais une RÉGRESSION, et doit faire échouer.
/** Le backend expose-t-il les signaux culture / variété-sans-secteur ? */
const BACKEND_ALIGNE = typeof backend.extractCulture === 'function';

/**
 * Le backend applique-t-il l'arbitrage « culture contredite » (garde 3) et
 * « passe variété bridée quand le secteur n'a aucune option » ?
 */
const BACKEND_ARBITRAGE_CULTURE = (() => {
  try {
    const vetoCulture = backend.matchParcelle('M.T.L S-3', [{ label: 'S3 - MARAVILLA MOTTE F1' }]);
    const secteurInconnu = backend.matchParcelle('yazmin S-11', [{ label: 'F5 YAZMIN MT' }]);
    return vetoCulture.label === '' && secteurInconnu.label === '';
  } catch (e) {
    return false;
  }
})();

/**
 * Fixture élargie demandée par la QA :
 *  - S21 : DEUX parcelles mono-secteur de variétés différentes ;
 *  - BEE-777 : la variété n'est portée QUE par le nom affiché (nom / nom_sb),
 *    pas par le libellé — angle mort mesuré.
 */
const EXTRAS = ['S21 - MARAVILLA MOTTE F1', 'S21 - YAZMIN MOW DOWN F1'];
const REFS_ELARGIS = OPTIONS.concat(EXTRAS).map((label) => ({ label }))
  .concat([{ label: 'BEE-777', nom_sb: 'S22 MARAVILLA MOTTE', culture: 'Framboise' }]);
const OPTS_ELARGIS = OPTIONS.concat(EXTRAS).map((label) => ({ label }))
  .concat([{ label: 'BEE-777', nom: 'S22 MARAVILLA MOTTE', culture: 'Framboise' }]);

/** En-têtes dont le verdict ne dépend QUE du secteur et de la variété. */
const ENTETES_COMMUNES = [
  'marvilla S-3', 'marvilla S-5', 'S2 -YAZMIN MOW DOWN', 'S-9', 'maravilla S-6',
  'S10 YAZMIN cut back', 'marvilla S-21', 'yasmin S-21', '', 'zzz',
];

test('[fixture élargie] deux mono-parcelles de variétés différentes sur S21', () => {
  assert.strictEqual(M.matchParcelle('marvilla S-21', OPTS_ELARGIS).label, 'S21 - MARAVILLA MOTTE F1');
  assert.strictEqual(M.matchParcelle('yasmin S-21', OPTS_ELARGIS).label, 'S21 - YAZMIN MOW DOWN F1');
  assert.strictEqual(M.matchParcelle('marvilla S-21', OPTS_ELARGIS).status, 'probable');
});

test('[fixture élargie] variété portée seulement par le nom affiché', () => {
  // Le SECTEUR se lit sur le libellé (BEE-777 n'en a pas) : sans secteur dans
  // l'en-tête, la passe variété propose — en `probable`.
  const r = M.matchParcelle('marvilla motte', OPTS_ELARGIS);
  assert.strictEqual(r.label, 'BEE-777');
  assert.strictEqual(r.status, 'probable');
  // Mais si l'en-tête affirme un secteur qu'aucune option ne porte, on ne
  // propose plus rien : suggestion seulement.
  const r2 = M.matchParcelle('marvilla S-22', OPTS_ELARGIS);
  assert.strictEqual(r2.label, '');
  assert.deepStrictEqual(r2.candidats, ['BEE-777']);
});

test('[anti-divergence] secteur + variété : même verdict que le backend', () => {
  for (const e of ENTETES_COMMUNES) {
    const front = M.matchParcelle(e, OPTS_ELARGIS);
    const back = backend.matchParcelle(e, REFS_ELARGIS);
    assert.strictEqual(front.label, back.label, 'label pour « ' + e + ' »');
    assert.strictEqual(front.status, back.status, 'status pour « ' + e + ' »');
    assert.strictEqual(front.score, back.score, 'score pour « ' + e + ' »');
    assert.deepStrictEqual(front.candidats, back.candidats, 'candidats pour « ' + e + ' »');
  }
});

test('[anti-divergence] culture + variété sans secteur : même verdict que le backend', () => {
  assert.ok(BACKEND_ALIGNE,
    'RÉGRESSION BACKEND : functions/lib/stock/bcScan.js n\'expose plus extractCulture. '
    + 'Le signal culture doit exister DES DEUX CÔTÉS (miroir livré en 6840996).');
  const gates = ['M.T.L S-13', 'myrtille S-13', 'M.T.L S-13-14', 'M.T.L S-8', 'yasmin niyas S-9'];
  for (const e of gates) {
    const front = M.matchParcelle(e, OPTS_ELARGIS);
    const back = backend.matchParcelle(e, REFS_ELARGIS);
    assert.strictEqual(front.label, back.label, 'label pour « ' + e + ' »');
    assert.strictEqual(front.status, back.status, 'status pour « ' + e + ' »');
    // Le score fait partie du verdict : un `probable` à 0.8 d'un côté et 0.9 de
    // l'autre est une divergence, même si le label et le statut concordent.
    assert.strictEqual(front.score, back.score, 'score pour « ' + e + ' »');
    assert.deepStrictEqual(front.candidats, back.candidats, 'candidats pour « ' + e + ' »');
  }
});

test('[anti-divergence] gardes culture contredite / secteur inconnu : même verdict que le backend', () => {
  assert.ok(BACKEND_ARBITRAGE_CULTURE,
    'RÉGRESSION BACKEND : functions/lib/stock/bcScan.js n\'applique plus la garde 3 '
    + '(culture contredite) et/ou le bridage de la passe variété sur un secteur sans option. '
    + 'Attendu : « M.T.L S-3 » et « yazmin S-11 » renvoient label:\'\' (miroir livré en 6840996).');
  // « avocat F2 » couvre la branche Avocatier de la garde 3 : sans elle, aucune
  // fixture de parité ne la testait (mutation « Avocatier retiré » passait sans
  // même produire de skip).
  const gates = ['M.T.L S-3', 'M.T.L S-1', 'M.T.L S-4', 'M.T.L S-7', 'myrtille S-3',
    'framboise S-3', 'yazmin S-11', 'yasmin niyas S-20', 'marvilla S-22', 'marvilla motte',
    'avocat F2', 'avocatier S-3', 'avocat S-13'];
  for (const e of gates) {
    const front = M.matchParcelle(e, OPTS_ELARGIS);
    const back = backend.matchParcelle(e, REFS_ELARGIS);
    assert.strictEqual(front.label, back.label, 'label pour « ' + e + ' »');
    assert.strictEqual(front.status, back.status, 'status pour « ' + e + ' »');
    assert.strictEqual(front.score, back.score, 'score pour « ' + e + ' »');
    assert.deepStrictEqual(front.candidats, back.candidats, 'candidats pour « ' + e + ' »');
  }
});

test('un seul global exposé, aucun identifiant top-level', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(__dirname, '../../public/lib/bcScanMatch.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.deepStrictEqual(Object.keys(sandbox.window), ['BcScanMatch']);
});
