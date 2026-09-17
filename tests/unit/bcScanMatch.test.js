'use strict';

// Rapprochement en-tête de pile ↔ parcelles du <select> (src/modules/shared/lib/bcScanMatch.js).
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

global.window = { CultureUtils: require('./_esm').loadEsm('src/modules/shared/lib/cultureUtils.js') };
const M = require('./_esm').loadEsm('src/modules/shared/lib/bcScanMatch.js');

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

// ------------------------------------------------- alias de parcelle (lot A)
//
// Un alias = une décision humaine déjà prise sur CE même en-tête lors d'un scan
// précédent (`bc_scan_parcelle_aliases`). Il prime sur la cascade, MAIS il ne
// peut jamais poser une valeur non sélectionnable, ni traverser une campagne.

const CAMPAGNE = '2026-2027';
/** Les 3 en-têtes réellement non résolus sur les 7 bons de référence. */
const ALIASES = {
  'm.t.l s-8': { parcelle: 'CASCADE MYRTILLE S8-1', count: 2, campagne: CAMPAGNE },
  'm.t.l s-13-14': { parcelle: 'F5- CASCADE -S13', count: 1, campagne: CAMPAGNE },
};

test('[alias] un en-tête déjà tranché est pré-rempli, en statut `alias`', () => {
  const r = M.matchParcelle('M.T.L S-8', OPTIONS, ALIASES, CAMPAGNE);
  assert.strictEqual(r.label, 'CASCADE MYRTILLE S8-1');
  assert.strictEqual(r.status, 'alias');
  assert.strictEqual(r.score, 1);
  assert.deepStrictEqual(r.candidats, []);
  assert.strictEqual(r.aliasCount, 2);
});

test('[alias] sans alias, le même en-tête reste non résolu (le gain vient bien de là)', () => {
  const r = M.matchParcelle('M.T.L S-8', OPTIONS);
  assert.strictEqual(r.label, '');
  assert.strictEqual(r.status, 'unmatched');
});

test('[alias] l\'alias prime sur la cascade, même quand elle trancherait', () => {
  // « marvilla S-3 » sort normalement « S3 - MARAVILLA MOTTE F1 » en `exact`.
  const r = M.matchParcelle('marvilla S-3', OPTIONS,
    { 'marvilla s-3': { parcelle: 'S7 -MARAVILLA MOTTE F1', count: 4, campagne: CAMPAGNE } }, CAMPAGNE);
  assert.strictEqual(r.label, 'S7 -MARAVILLA MOTTE F1');
  assert.strictEqual(r.status, 'alias');
});

// RISQUE R1 — le cas le plus grave du chantier. Le secteur 9 portait
// « S9 - REYNA F5 » en 2025-2026 ; l'appliquer en 2026-2027 imputerait la
// consommation à une parcelle qui n'est plus en culture.
test('[alias] un alias d\'une AUTRE campagne est ignoré (R1)', () => {
  const vieux = { 'miya s-9': { parcelle: 'S9 - REYNA F5', count: 9, campagne: '2025-2026' } };
  const r = M.matchParcelle('miya S-9', OPTIONS, vieux, CAMPAGNE);
  assert.notStrictEqual(r.status, 'alias');
  // Et on retombe exactement sur la cascade normale.
  assert.deepStrictEqual(r, M.matchParcelle('miya S-9', OPTIONS));
  assert.strictEqual(r.label, 'F5- MYA S9');
});

test('[alias] le même alias EST appliqué sur sa propre campagne', () => {
  const vieux = { 'miya s-9': { parcelle: 'S9 - REYNA F5', count: 9, campagne: '2025-2026' } };
  const r = M.matchParcelle('miya S-9', OPTIONS, vieux, '2025-2026');
  assert.strictEqual(r.status, 'alias');
  assert.strictEqual(r.label, 'S9 - REYNA F5');
});

// `knownParcelle` a le DERNIER MOT : une valeur non sélectionnable ne doit
// jamais être posée, quelle que soit sa provenance.
test('[alias] un alias pointant une parcelle absente des options est ignoré', () => {
  const perime = { 'm.t.l s-8': { parcelle: 'PARCELLE RETIREE DE LA CAMPAGNE', count: 5, campagne: CAMPAGNE } };
  const r = M.matchParcelle('M.T.L S-8', OPTIONS, perime, CAMPAGNE);
  assert.strictEqual(r.label, '');
  assert.strictEqual(r.status, 'unmatched');
  // Repli intégral sur la cascade, pas une sortie dégradée.
  assert.deepStrictEqual(r, M.matchParcelle('M.T.L S-8', OPTIONS));
});

test('[alias] un alias périmé ne masque pas ce que la cascade sait faire', () => {
  const perime = { 'marvilla s-3': { parcelle: 'PARCELLE INEXISTANTE', count: 3, campagne: CAMPAGNE } };
  const r = M.matchParcelle('marvilla S-3', OPTIONS, perime, CAMPAGNE);
  assert.strictEqual(r.label, 'S3 - MARAVILLA MOTTE F1');
  assert.strictEqual(r.status, 'exact');
});

test('[alias] la clé est l\'en-tête NORMALISÉ (casse, accents, espaces)', () => {
  const a = { 'm.t.l s-8': { parcelle: 'CASCADE MYRTILLE S8-1', count: 1, campagne: CAMPAGNE } };
  for (const e of ['M.T.L S-8', 'm.t.l   s-8', '  M.T.L S-8  ']) {
    assert.strictEqual(M.matchParcelle(e, OPTIONS, a, CAMPAGNE).label, 'CASCADE MYRTILLE S8-1', e);
  }
});

test('[alias] en-tête vide : jamais d\'alias, même si la map porte la clé vide', () => {
  const pollue = { '': { parcelle: 'S3 - MARAVILLA MOTTE F1', count: 1, campagne: CAMPAGNE } };
  for (const e of ['', '   ', null, undefined]) {
    const r = M.matchParcelle(e, OPTIONS, pollue, CAMPAGNE);
    assert.strictEqual(r.label, '', String(e));
    assert.strictEqual(r.status, 'unmatched', String(e));
  }
});

test('[alias] entrée mal formée (parcelle vide / null / non objet) : ignorée', () => {
  const cas = [
    { 'marvilla s-3': { count: 3, campagne: CAMPAGNE } },
    { 'marvilla s-3': { parcelle: '', count: 3, campagne: CAMPAGNE } },
    { 'marvilla s-3': null },
    { 'marvilla s-3': 0 },
  ];
  for (const a of cas) {
    const r = M.matchParcelle('marvilla S-3', OPTIONS, a, CAMPAGNE);
    assert.strictEqual(r.status, 'exact', JSON.stringify(a));
    assert.strictEqual(r.label, 'S3 - MARAVILLA MOTTE F1');
  }
});

test('[alias] aucune map / map vide / map non objet : comportement inchangé', () => {
  const attendu = M.matchParcelle('marvilla S-3', OPTIONS);
  for (const a of [undefined, null, {}, 'nope', 42]) {
    assert.deepStrictEqual(M.matchParcelle('marvilla S-3', OPTIONS, a, CAMPAGNE), attendu, String(a));
  }
});

test('[alias] aucune campagne passée : un alias daté reste appliqué (map déjà filtrée)', () => {
  // La lecture serveur filtre déjà par campagne ; le contrôle de la fonction pure
  // est un filet SUPPLÉMENTAIRE, il ne doit pas rendre la feature inopérante
  // quand l'appelant ne passe pas la campagne.
  const r = M.matchParcelle('M.T.L S-8', OPTIONS, ALIASES);
  assert.strictEqual(r.status, 'alias');
});

test('[alias] un alias n\'est JAMAIS rendu en `exact` (jamais de pastille verte)', () => {
  for (const e of Object.keys(ALIASES)) {
    const r = M.matchParcelle(e, OPTIONS, ALIASES, CAMPAGNE);
    assert.strictEqual(r.status, 'alias', e);
    assert.notStrictEqual(r.status, 'exact', e);
  }
});

// La branche alias testée DIRECTEMENT, garde par garde : passer par
// matchParcelle ne suffit pas — son propre garde-fou « en-tête vide » masque
// celui d'aliasMatch, qui resterait donc non couvert.
test('[alias] aliasMatch — chaque garde vérifiée isolément', () => {
  const opts = [{ label: 'F5- MYA S9' }, { label: 'S9 - REYNA F5' }];
  const ok = { 'miya s-9': { parcelle: 'F5- MYA S9', count: 4, campagne: CAMPAGNE } };
  assert.deepStrictEqual(M.aliasMatch(ok, 'Miya S-9', CAMPAGNE, opts),
    { label: 'F5- MYA S9', score: 1, status: 'alias', candidats: [], aliasCount: 4 });
  // en-tête vide : jamais de clé, même si la map en porte une
  assert.strictEqual(M.aliasMatch({ '': { parcelle: 'F5- MYA S9', count: 1, campagne: CAMPAGNE } }, '', CAMPAGNE, opts), null);
  // campagne étrangère
  assert.strictEqual(M.aliasMatch({ 'miya s-9': { parcelle: 'F5- MYA S9', count: 4, campagne: '2025-2026' } }, 'Miya S-9', CAMPAGNE, opts), null);
  // label hors liste rendue
  assert.strictEqual(M.aliasMatch({ 'miya s-9': { parcelle: 'AUTRE', count: 4, campagne: CAMPAGNE } }, 'Miya S-9', CAMPAGNE, opts), null);
  // entrées mal formées
  assert.strictEqual(M.aliasMatch({ 'miya s-9': { count: 4, campagne: CAMPAGNE } }, 'Miya S-9', CAMPAGNE, opts), null);
  assert.strictEqual(M.aliasMatch({}, 'Miya S-9', CAMPAGNE, opts), null);
  assert.strictEqual(M.aliasMatch(null, 'Miya S-9', CAMPAGNE, opts), null);
});

test('[alias] le label rendu est TOUJOURS une option sélectionnable', () => {
  const melange = Object.assign({ 'zzz inconnu': { parcelle: 'PAS DANS LA LISTE', count: 1, campagne: CAMPAGNE } }, ALIASES);
  for (const e of ['M.T.L S-8', 'M.T.L S-13-14', 'zzz inconnu', 'marvilla S-3', 'S-9']) {
    const r = M.matchParcelle(e, OPTIONS, melange, CAMPAGNE);
    if (r.label) assert.ok(OPTIONS.includes(r.label), e + ' → ' + r.label);
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

/**
 * Alias de parcelle joués DANS les tests de parité : sans eux, la branche alias
 * du backend pourrait disparaître sans qu'aucune fixture ne la traverse (la
 * parité serait alors nominale sur cette nouvelle branche — exactement le défaut
 * qu'on a déjà payé une fois sur la branche Avocatier).
 * La map couvre les 4 chemins : appliqué / campagne étrangère / label hors liste
 * / entrée mal formée.
 */
const ALIASES_PARITE = {
  'marvilla s-3': { parcelle: 'S7 -MARAVILLA MOTTE F1', count: 3, campagne: CAMPAGNE },
  'm.t.l s-8': { parcelle: 'CASCADE MYRTILLE S8-1', count: 1, campagne: CAMPAGNE },
  'm.t.l s-3': { parcelle: 'F5- CASCADE -S13', count: 2, campagne: CAMPAGNE },
  'yazmin s-11': { parcelle: 'F5 YAZMIN MT', count: 1, campagne: CAMPAGNE },
  's-9': { parcelle: 'S9 - REYNA F5', count: 6, campagne: '2025-2026' },
  'marvilla s-5': { parcelle: 'PARCELLE HORS LISTE', count: 4, campagne: CAMPAGNE },
  'marvilla s-21': { parcelle: '', count: 1, campagne: CAMPAGNE },
  'avocat f2': 'F2 - HAAS',
};

/**
 * Compare le verdict FRONT et le verdict BACKEND pour un en-tête, D'ABORD sans
 * alias puis avec la map de parité : le verdict complet (label, statut, score,
 * candidats, compteur d'alias) doit être identique dans les deux régimes.
 * @param {string} e
 */
function memeVerdict(e) {
  [[undefined, undefined], [ALIASES_PARITE, CAMPAGNE]].forEach(([al, camp]) => {
    const suffixe = ' pour « ' + e + ' »' + (al ? ' [avec alias]' : '');
    const front = M.matchParcelle(e, OPTS_ELARGIS, al, camp);
    const back = backend.matchParcelle(e, REFS_ELARGIS, al, camp);
    assert.strictEqual(front.label, back.label, 'label' + suffixe);
    assert.strictEqual(front.status, back.status, 'status' + suffixe);
    // Le score fait partie du verdict : un `probable` à 0.8 d'un côté et 0.9 de
    // l'autre est une divergence, même si le label et le statut concordent.
    assert.strictEqual(front.score, back.score, 'score' + suffixe);
    assert.deepStrictEqual(front.candidats, back.candidats, 'candidats' + suffixe);
    assert.strictEqual(front.aliasCount, back.aliasCount, 'aliasCount' + suffixe);
  });
}

/**
 * Le backend applique-t-il la branche ALIAS et ses trois gardes ?
 * ⚠️ ASSERTION, pas configuration (cf. le bloc ci-dessus) : le probe n'interroge
 * PAS le même prédicat que celui qu'il garde — il vérifie un alias appliqué, un
 * alias d'une autre campagne refusé et un alias hors liste refusé.
 */
const BACKEND_ALIAS = (() => {
  try {
    const refs = [{ label: 'S3 - MARAVILLA MOTTE F1' }, { label: 'S7 -MARAVILLA MOTTE F1' }];
    const a = { 'marvilla s-3': { parcelle: 'S7 -MARAVILLA MOTTE F1', count: 3, campagne: CAMPAGNE } };
    const hors = { 'marvilla s-3': { parcelle: 'PARCELLE HORS LISTE', count: 3, campagne: CAMPAGNE } };
    return backend.matchParcelle('marvilla S-3', refs, a, CAMPAGNE).status === 'alias'
      && backend.matchParcelle('marvilla S-3', refs, a, '2025-2026').status === 'exact'
      && backend.matchParcelle('marvilla S-3', refs, hors, CAMPAGNE).status === 'exact';
  } catch (e) {
    return false;
  }
})();

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
  assert.ok(BACKEND_ALIAS,
    'RÉGRESSION BACKEND : functions/lib/stock/bcScan.js n\'applique plus la branche ALIAS '
    + 'et/ou ses gardes (campagne étrangère, label hors liste). La mémorisation des '
    + 'parcelles doit exister DES DEUX CÔTÉS (lot A du spec scan-apprentissage).');
  ENTETES_COMMUNES.forEach(memeVerdict);
});

test('[anti-divergence] culture + variété sans secteur : même verdict que le backend', () => {
  assert.ok(BACKEND_ALIGNE,
    'RÉGRESSION BACKEND : functions/lib/stock/bcScan.js n\'expose plus extractCulture. '
    + 'Le signal culture doit exister DES DEUX CÔTÉS (miroir livré en 6840996).');
  const gates = ['M.T.L S-13', 'myrtille S-13', 'M.T.L S-13-14', 'M.T.L S-8', 'yasmin niyas S-9'];
  gates.forEach(memeVerdict);
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
  gates.forEach(memeVerdict);
});

// La branche ALIAS traversée en parité sur ses QUATRE chemins, avec le détail de
// ce qui est attendu — sans quoi « les deux implémentations sont d'accord »
// pourrait vouloir dire « aucune des deux n'applique l'alias ».
test('[anti-divergence] branche alias : mêmes verdicts ET verdicts attendus', () => {
  ['marvilla S-3', 'M.T.L S-8', 'M.T.L S-3', 'yazmin S-11', 'S-9', 'marvilla S-5',
    'marvilla S-21', 'avocat F2', ''].forEach(memeVerdict);
  const av = (e) => M.matchParcelle(e, OPTS_ELARGIS, ALIASES_PARITE, CAMPAGNE);
  // 1. appliqué, et il PRIME sur une cascade qui trancherait autrement.
  assert.strictEqual(av('marvilla S-3').label, 'S7 -MARAVILLA MOTTE F1');
  assert.strictEqual(av('marvilla S-3').status, 'alias');
  assert.strictEqual(M.matchParcelle('marvilla S-3', OPTS_ELARGIS).label, 'S3 - MARAVILLA MOTTE F1');
  // 2. il résout un en-tête que la cascade laisse ouvert.
  assert.strictEqual(av('M.T.L S-8').status, 'alias');
  assert.strictEqual(M.matchParcelle('M.T.L S-8', OPTS_ELARGIS).status, 'unmatched');
  // 3. campagne étrangère → ignoré, repli sur la cascade.
  assert.deepStrictEqual(av('S-9'), M.matchParcelle('S-9', OPTS_ELARGIS));
  // 4. label hors liste / parcelle vide → ignorés, repli sur la cascade.
  assert.deepStrictEqual(av('marvilla S-5'), M.matchParcelle('marvilla S-5', OPTS_ELARGIS));
  assert.deepStrictEqual(av('marvilla S-21'), M.matchParcelle('marvilla S-21', OPTS_ELARGIS));
});

test('[anti-divergence] aliasMatch front et aliasMatchParcelle backend : mêmes gardes', () => {
  const opts = [{ label: 'F5- MYA S9' }, { label: 'S9 - REYNA F5' }];
  const cas = [
    [{ 'miya s-9': { parcelle: 'F5- MYA S9', count: 4, campagne: CAMPAGNE } }, 'Miya S-9', CAMPAGNE],
    [{ 'miya s-9': { parcelle: 'F5- MYA S9', count: 4, campagne: '2025-2026' } }, 'Miya S-9', CAMPAGNE],
    [{ 'miya s-9': { parcelle: 'HORS LISTE', count: 4, campagne: CAMPAGNE } }, 'Miya S-9', CAMPAGNE],
    [{ 'miya s-9': 'S9 - REYNA F5' }, 'Miya S-9', CAMPAGNE],
    [{ '': { parcelle: 'F5- MYA S9', count: 1, campagne: CAMPAGNE } }, '', CAMPAGNE],
    [{ 'miya s-9': { parcelle: '', count: 1, campagne: CAMPAGNE } }, 'Miya S-9', CAMPAGNE],
    [null, 'Miya S-9', CAMPAGNE],
  ];
  cas.forEach(([map, entete, camp], i) => {
    assert.deepStrictEqual(M.aliasMatch(map, entete, camp, opts),
      backend.aliasMatchParcelle(map, entete, camp, opts), 'cas ' + i);
  });
});

test('module ES : rien n\'est publié sur window', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/modules/shared/lib/bcScanMatch.js'), 'utf8');
  assert.doesNotMatch(src, /window\.[A-Z]\w+\s*=/, 'plus aucune publication globale');
  assert.match(src, /^export \{ /m);
});
