'use strict';

/*
 * FUSION EN MASSE des articles en doublon — CÂBLAGE DE L'ÉCRAN (public/app.jsx).
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────
 * La pop-up ne traitait qu'un groupe à la fois. Omar en a fait 20 comme ça, il
 * en reste 85 (mesure production 2026-08-27). Le lot n'est PAS une nouvelle
 * mécanique de fusion : c'est un appel séquentiel à `merge-articles`, la même
 * action qu'à l'unité. Ce qui doit être verrouillé, c'est l'orchestration.
 *
 * ── CE QUI EST RÉELLEMENT TESTÉ ────────────────────────────────────────────
 * Pas un miroir recopié (il dériverait en silence) mais le SOURCE de
 * `public/app.jsx` : les handlers de lot sont EXTRAITS du fichier, babélisés,
 * puis EXÉCUTÉS contre un faux serveur. Même stratégie que
 * articleMergePopupChoix.test.js — le monolithe n'est pas requérable.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - un groupe indécidable devient sélectionnable ;
 *  - l'aperçu global est contourné (fusion possible sans chiffrage) ;
 *  - l'aperçu d'un lot autorise l'exécution d'un AUTRE lot ;
 *  - l'exécution continue après une erreur au lieu de s'arrêter ;
 *  - le master part par `reference` au lieu du docId `id` ;
 *  - la garde de rôle serveur est lue depuis le body au lieu du jeton.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/app.jsx'), 'utf8');
const BACKEND = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
const FM = require('../../public/lib/fusionMasse.js');

// ── extraction depuis le source de prod ────────────────────────────────────

/** Bloc délimité par une ligne d'ouverture et sa fermeture DE MÊME INDENTATION. */
function extraireBloc(ouverture, fermeture) {
  const lignes = SRC.split('\n');
  const iDebut = lignes.findIndex((l) => l.trim() === ouverture);
  assert.notEqual(iDebut, -1, 'ligne d’ouverture introuvable : ' + ouverture);
  const indent = lignes[iDebut].match(/^\s*/)[0];
  let iFin = -1;
  for (let i = iDebut + 1; i < lignes.length; i++) {
    if (lignes[i] === indent + fermeture) { iFin = i; break; }
  }
  assert.notEqual(iFin, -1, 'ligne de fermeture introuvable : ' + fermeture);
  return lignes.slice(iDebut, iFin + 1).join('\n');
}

function babeliser(source) {
  return babel.transformSync(source, {
    presets: [require.resolve('@babel/preset-react')],
    filename: 'extrait-app.jsx',
    babelrc: false,
    configFile: false,
  }).code;
}

// ── faux React (pas de RTL dans ce repo : pas de bundler) ──────────────────

function flatten(children) {
  const out = [];
  const push = (c) => {
    if (Array.isArray(c)) c.forEach(push);
    else if (c != null && c !== false) out.push(c);
  };
  children.forEach(push);
  return out;
}
function createElement(type, props, ...children) {
  const flat = flatten(children);
  const p = Object.assign({}, props || {});
  if (typeof type === 'function') {
    if (flat.length) p.children = flat.length === 1 ? flat[0] : flat;
    return type(p);
  }
  return { type, props: p, children: flat };
}
function collect(node, pred, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, pred, acc)); return acc; }
  if (pred(node)) acc.push(node);
  (node.children || []).forEach((c) => collect(c, pred, acc));
  return acc;
}
function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children || []).map(textOf).join('');
}

// ── fixtures ───────────────────────────────────────────────────────────────
// `id` (docId) et `reference` DIVERGENT partout, comme en production.

function groupe(normalized, ids, decidable) {
  return {
    normalized,
    decidable: decidable !== false,
    master_suggere: decidable === false ? null : ids[0],
    raison: decidable === false ? 'aucune donnée — à choisir manuellement' : 'seule fiche à porter un PMP',
    articles: ids.map((id) => ({ id, reference: id.replace(/(\d)/, ' $1'), nom: normalized })),
  };
}

const G_A = groupe('magical', ['ENG0150', 'ENG0151']);
const G_B = groupe('vertimec', ['PHY0010', 'PHY0011']);
const G_C = groupe('kelpak', ['ENG0300', 'ENG0301']);
const G_IND = groupe('gib 3', ['PHY0020', 'PHY0021'], false);

const MASTERS = { magical: 'ENG0150', vertimec: 'PHY0010', kelpak: 'ENG0300' };

// ── exécution d'un handler de lot contre un faux serveur ───────────────────

/**
 * Rejoue `apercuLot` ou `executerLot` du source et capture les appels serveur.
 *
 * @param {('apercuLot'|'executerLot')} nom
 * @param {Object} opts
 * @param {Array<*>} opts.groups groupes affichés
 * @param {Object} opts.selection normalized -> coché
 * @param {Object} [opts.masters]
 * @param {*} [opts.apercu] aperçu déjà calculé ({signature, total}) ou null
 * @param {Array<*>} [opts.reponses] réponses successives du faux serveur
 * @param {boolean} [opts.confirme]
 * @returns {Promise<{appels: Array<*>, alerte: string, confirme: string, apercu: *, rapport: *, progress: Array<*>}>}
 */
async function lancerHandler(nom, opts) {
  const masters = opts.masters || MASTERS;
  const { lot, ignores } = FM.construireLot(opts.groups, masters, opts.selection);
  const apercu = opts.apercu === undefined ? null : opts.apercu;
  const aJour = !!(apercu && apercu.signature === FM.signatureLot(lot));

  const source =
    'window.__handler = async function (ctx) {\n' +
    '  var FM = ctx.FM;\n' +
    '  var mergeLot = ctx.mergeLot;\n' +
    '  var mergeIgnores = ctx.mergeIgnores;\n' +
    '  var mergeApercu = ctx.mergeApercu;\n' +
    '  var mergeApercuAJour = ctx.mergeApercuAJour;\n' +
    '  var setMergeBusy = function () {};\n' +
    '  var setMergePreview = function () {};\n' +
    '  var setMergeApercu = function (a) { ctx.sink.apercu = a; };\n' +
    '  var setMergeRapport = function (r) { ctx.sink.rapport = r; };\n' +
    '  var setMergeProgress = function (p) { ctx.sink.progress.push(p); };\n' +
    '  var load = function () { ctx.sink.reload = true; };\n' +
    '  var loadDuplicates = function () { ctx.sink.rapport = null; };\n' +
    '  var actor = function () { return { uid: "dg" }; };\n' +
    '  var alert = function (m) { ctx.sink.alerte = m; };\n' +
    '  var confirm = function (m) { ctx.sink.confirme = m; return ctx.confirme; };\n' +
    '  var fetch = function (url, o) { return ctx.fetch(url, o); };\n' +
    extraireBloc('const ' + nom + ' = async () => {', '};') + '\n' +
    '  return ' + nom + '();\n' +
    '};\n';

  const sink = { progress: [] };
  const appels = [];
  const reponses = (opts.reponses || []).slice();
  const ctx = {
    FM,
    mergeLot: lot,
    mergeIgnores: ignores,
    mergeApercu: apercu,
    mergeApercuAJour: aJour,
    confirme: opts.confirme !== false,
    sink,
    fetch: (url, o) => {
      const corps = JSON.parse(o.body);
      appels.push({ url, corps });
      const r = reponses.length
        ? reponses.shift()
        : { success: true, preview: { open_movements: 1, open_bdc: 1, doublon_balances_count: 1 }, counts: { movements: 1, bdc: 1, balances: 1 } };
      return Promise.resolve({ json: () => Promise.resolve(r) });
    },
  };

  const sandbox = { window: {}, console, Promise, JSON };
  vm.createContext(sandbox);
  vm.runInContext(babeliser(source), sandbox);
  await sandbox.window.__handler(ctx);
  return {
    appels: JSON.parse(JSON.stringify(appels)),
    alerte: sink.alerte,
    confirme: sink.confirme,
    apercu: sink.apercu ? JSON.parse(JSON.stringify(sink.apercu)) : sink.apercu,
    rapport: sink.rapport ? JSON.parse(JSON.stringify(sink.rapport)) : sink.rapport,
    progress: JSON.parse(JSON.stringify(sink.progress)),
    lot,
  };
}

/** Aperçu « à jour » pour une sélection donnée (comme après un vrai apercuLot). */
function apercuPour(groups, selection, masters) {
  const { lot } = FM.construireLot(groups, masters || MASTERS, selection);
  return {
    signature: FM.signatureLot(lot),
    total: { groupes: lot.length, fiches_desactivees: lot.length, soldes_agreges: 0, mouvements: 0, bdc: 0 },
  };
}

// ── 1. APERÇU GLOBAL ───────────────────────────────────────────────────────

test('l’aperçu appelle merge-articles en mode PREVIEW pour chaque groupe du lot', async () => {
  const r = await lancerHandler('apercuLot', {
    groups: [G_A, G_B, G_C],
    selection: { magical: true, vertimec: true, kelpak: true },
  });
  assert.strictEqual(r.appels.length, 3);
  for (const a of r.appels) {
    assert.match(a.url, /action=merge-articles/);
    assert.strictEqual(a.corps.mode, 'preview', 'l’aperçu ne doit JAMAIS écrire');
  }
});

test('l’aperçu chiffre le lot : groupes, fiches, soldes, mouvements, BDC', async () => {
  const r = await lancerHandler('apercuLot', {
    groups: [G_A, G_B],
    selection: { magical: true, vertimec: true },
    reponses: [
      { success: true, preview: { open_movements: 3, open_bdc: 1, doublon_balances_count: 2 } },
      { success: true, preview: { open_movements: 0, open_bdc: 4, doublon_balances_count: 5 } },
    ],
  });
  assert.deepStrictEqual(r.apercu.total, {
    groupes: 2, fiches_desactivees: 2, soldes_agreges: 7, mouvements: 3, bdc: 5,
  });
});

test('un aperçu qui échoue n’autorise AUCUNE fusion', async () => {
  const r = await lancerHandler('apercuLot', {
    groups: [G_A, G_B],
    selection: { magical: true, vertimec: true },
    reponses: [{ success: false, error: 'Article master introuvable: ENG0150' }],
  });
  assert.strictEqual(r.appels.length, 1, 'l’aperçu s’arrête au premier refus');
  assert.ok(!r.apercu, 'aucun aperçu ne doit être posé (il resterait exécutable)');
  assert.match(r.alerte, /Article master introuvable/);
});

test('la progression de l’aperçu est publiée à chaque groupe', async () => {
  // 85 aperçus séquentiels : un écran figé fait conclure au plantage.
  const r = await lancerHandler('apercuLot', {
    groups: [G_A, G_B, G_C],
    selection: { magical: true, vertimec: true, kelpak: true },
  });
  const etapes = r.progress.filter((p) => p && p.phase === 'apercu');
  assert.ok(etapes.length >= 3, 'la progression doit être publiée : ' + JSON.stringify(r.progress));
  assert.strictEqual(etapes[etapes.length - 1].total, 3);
});

// ── 2. L'APERÇU GLOBAL EST OBLIGATOIRE ─────────────────────────────────────

test('sans aperçu, la fusion du lot REFUSE de partir', async () => {
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B],
    selection: { magical: true, vertimec: true },
    apercu: null,
  });
  assert.strictEqual(r.appels.length, 0, 'aucune écriture ne doit partir');
  assert.strictEqual(r.confirme, undefined, 'pas même une demande de confirmation');
  assert.match(r.alerte, /Prévisualisez le lot/);
});

test('un aperçu fait sur un AUTRE lot n’autorise pas la fusion', async () => {
  // Omar chiffre 1 groupe, coche les 84 autres, et clique : sans le contrôle
  // de signature, il fusionnerait 85 groupes sur la foi d'un aperçu de 1.
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B, G_C],
    selection: { magical: true, vertimec: true, kelpak: true },
    apercu: apercuPour([G_A], { magical: true }),
  });
  assert.strictEqual(r.appels.length, 0);
  assert.match(r.alerte, /la sélection a changé/);
});

test('avec l’aperçu à jour, la fusion demande confirmation puis part', async () => {
  const sel = { magical: true, vertimec: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B],
    selection: sel,
    apercu: apercuPour([G_A, G_B], sel),
  });
  assert.match(r.confirme, /Fusionner 2 groupe\(s\)/);
  assert.strictEqual(r.appels.length, 2);
  for (const a of r.appels) assert.strictEqual(a.corps.mode, 'execute');
});

test('la fusion ne part pas si Omar annule la confirmation', async () => {
  const sel = { magical: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A],
    selection: sel,
    apercu: apercuPour([G_A], sel),
    confirme: false,
  });
  assert.strictEqual(r.appels.length, 0);
});

/**
 * Évalue la LIGNE de `public/app.jsx` qui décide si l'aperçu est encore
 * valable. Les handlers la consomment (`mergeApercuAJour`) : sans ce test, on
 * vérifie qu'ils l'écoutent, jamais qu'elle dit la vérité — et la réduire à
 * `!!mergeApercu` passerait inaperçu.
 * @param {*} mergeApercu @param {Array<*>} mergeLot
 * @returns {boolean}
 */
function apercuEstAJour(mergeApercu, mergeLot) {
  const ligne = (SRC.split('\n').find((l) => l.trim().startsWith('const mergeApercuAJour =')) || '').trim();
  assert.ok(ligne, 'ligne `const mergeApercuAJour =` introuvable dans public/app.jsx');
  const source = 'window.__aJour = function (FM, mergeApercu, mergeLot) {\n  ' + ligne + '\n  return mergeApercuAJour;\n};\n';
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.__aJour(FM, mergeApercu, mergeLot);
}

test('l’aperçu n’est « à jour » que pour le lot dont il porte la signature', () => {
  const sel = { magical: true };
  const lotUn = FM.construireLot([G_A], MASTERS, sel).lot;
  const lotDeux = FM.construireLot([G_A, G_B], MASTERS, { magical: true, vertimec: true }).lot;
  const apercu = apercuPour([G_A], sel);

  assert.strictEqual(apercuEstAJour(apercu, lotUn), true, 'même lot → aperçu valable');
  assert.strictEqual(apercuEstAJour(apercu, lotDeux), false, 'lot élargi → aperçu périmé');
  assert.strictEqual(apercuEstAJour(null, lotUn), false, 'aucun aperçu → jamais à jour');
});

test('changer le MASTER d’un groupe périme l’aperçu', () => {
  // Sinon : Omar chiffre une fusion vers ENG0150, coche une autre fiche, et la
  // fusion part sur un master jamais prévisualisé.
  const sel = { magical: true };
  const apercu = apercuPour([G_A], sel);
  const autreMaster = FM.construireLot([G_A], { magical: 'ENG0151' }, sel).lot;
  assert.strictEqual(apercuEstAJour(apercu, autreMaster), false);
});

// ── 3. ADRESSAGE : docId, jamais le champ `reference` ──────────────────────

test('le lot envoie les docId — master ET doublons', async () => {
  const sel = { magical: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A],
    selection: sel,
    apercu: apercuPour([G_A], sel),
  });
  assert.strictEqual(r.appels[0].corps.master_ref, 'ENG0150');
  assert.deepStrictEqual(r.appels[0].corps.doublon_refs, ['ENG0151']);
  // « ENG 0150 » est un document FANTÔME réel (sans nom ni `active`) : à
  // l'échelle d'un lot de 85, l'erreur n'est plus rattrapable à l'œil.
  for (const ref of [r.appels[0].corps.master_ref].concat(r.appels[0].corps.doublon_refs)) {
    assert.doesNotMatch(ref, /\s/, 'référence espacée envoyée au serveur : ' + ref);
  }
});

test('l’aperçu et l’exécution portent EXACTEMENT les mêmes références', async () => {
  const sel = { magical: true, vertimec: true };
  const p = await lancerHandler('apercuLot', { groups: [G_A, G_B], selection: sel });
  const e = await lancerHandler('executerLot', {
    groups: [G_A, G_B], selection: sel, apercu: apercuPour([G_A, G_B], sel),
  });
  assert.deepStrictEqual(
    e.appels.map((a) => [a.corps.master_ref, a.corps.doublon_refs]),
    p.appels.map((a) => [a.corps.master_ref, a.corps.doublon_refs])
  );
});

// ── 4. ARRÊT À LA PREMIÈRE ANOMALIE ────────────────────────────────────────

test('l’exécution S’ARRÊTE à la première anomalie', async () => {
  const sel = { magical: true, vertimec: true, kelpak: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B, G_C],
    selection: sel,
    apercu: apercuPour([G_A, G_B, G_C], sel),
    reponses: [
      { success: true, counts: { movements: 1, bdc: 0, balances: 2 } },
      { success: false, error: 'Article doublon introuvable: PHY0011' },
      { success: true, counts: {} },
    ],
  });
  assert.strictEqual(r.appels.length, 2, 'le 3e groupe ne doit JAMAIS être tenté');
  assert.strictEqual(r.rapport.arret_anomalie, true);
});

test('le compte rendu dit ce qui est passé ET ce qui reste', async () => {
  const sel = { magical: true, vertimec: true, kelpak: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B, G_C],
    selection: sel,
    apercu: apercuPour([G_A, G_B, G_C], sel),
    reponses: [
      { success: true, counts: { movements: 1, bdc: 0, balances: 2 } },
      { success: false, error: 'Article doublon introuvable: PHY0011' },
    ],
  });
  assert.strictEqual(r.rapport.groupes_fusionnes, 1);
  assert.strictEqual(r.rapport.fiches_desactivees, 1);
  assert.strictEqual(r.rapport.soldes_agreges, 2);
  const parCle = {};
  for (const g of r.rapport.non_fusionnes) parCle[g.normalized] = g.raison;
  assert.match(parCle.vertimec, /PHY0011/, 'le groupe en échec et sa cause');
  assert.match(parCle.kelpak, /lot arrêté/, 'le groupe jamais tenté doit être listé');
});

test('une coupure réseau vaut anomalie : le lot s’arrête, il ne saute pas le groupe', async () => {
  const sel = { magical: true, vertimec: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B],
    selection: sel,
    apercu: apercuPour([G_A, G_B], sel),
    reponses: [null], // json() renvoie null : réponse illisible
  });
  assert.strictEqual(r.appels.length, 1);
  assert.strictEqual(r.rapport.arret_anomalie, true);
  assert.strictEqual(r.rapport.groupes_fusionnes, 0);
});

test('lot entièrement passé : compte rendu sans anomalie', async () => {
  const sel = { magical: true, vertimec: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B],
    selection: sel,
    apercu: apercuPour([G_A, G_B], sel),
  });
  assert.strictEqual(r.rapport.arret_anomalie, false);
  assert.strictEqual(r.rapport.groupes_fusionnes, 2);
  assert.deepStrictEqual(r.rapport.non_fusionnes, []);
});

test('la progression de l’exécution est publiée en « fait / total »', async () => {
  const sel = { magical: true, vertimec: true };
  const r = await lancerHandler('executerLot', {
    groups: [G_A, G_B],
    selection: sel,
    apercu: apercuPour([G_A, G_B], sel),
  });
  const etapes = r.progress.filter((p) => p && p.phase === 'execution');
  assert.ok(etapes.length >= 2, 'progression attendue : ' + JSON.stringify(r.progress));
  assert.strictEqual(etapes[etapes.length - 1].fait, 2);
  assert.strictEqual(etapes[etapes.length - 1].total, 2);
});

// ── 5. SÉLECTION FAIL-CLOSED, DANS L'ÉCRAN ─────────────────────────────────

test('un groupe INDÉCIDABLE ne part jamais dans un lot, même coché', async () => {
  const r = await lancerHandler('apercuLot', {
    groups: [G_A, G_IND],
    selection: { magical: true, 'gib 3': true },
  });
  assert.strictEqual(r.appels.length, 1, 'seul le groupe décidable est chiffré');
  assert.strictEqual(r.appels[0].corps.master_ref, 'ENG0150');
});

test('la case d’un groupe indécidable est DÉSACTIVÉE à l’écran', () => {
  const source =
    'window.__rendre = function (mergeGroups, mergeMasters, mergeSelection) {\n' +
    '  var mergePreview = null;\n' +
    '  var mergeBusy = false;\n' +
    '  var FM = window.FusionMasse;\n' +
    '  var setMergeMasters = function () {};\n' +
    '  var setMergePreview = function () {};\n' +
    '  var previewMerge = function () {};\n' +
    '  var executeMerge = function () {};\n' +
    '  var basculerSelection = function () {};\n' +
    '  return (<div>' + extraireBloc('{mergeGroups.map(group => {', '})}') + '</div>);\n' +
    '};\n';
  const sandbox = { window: {}, console, isFinite, parseFloat };
  sandbox.window.FusionMasse = FM;
  sandbox.window.React = { createElement, Fragment: 'Fragment' };
  sandbox.React = sandbox.window.React;
  vm.createContext(sandbox);
  vm.runInContext(babeliser(source), sandbox);

  const tree = sandbox.window.__rendre([G_A, G_IND], MASTERS, {});
  const cases = collect(tree, (n) => n.type === 'input' && n.props.type === 'checkbox');
  assert.strictEqual(cases.length, 2, 'une case par groupe');
  assert.strictEqual(cases[0].props.disabled, false, 'un groupe décidable est sélectionnable');
  assert.strictEqual(cases[1].props.disabled, true, 'un groupe indécidable ne l’est PAS');
  assert.match(textOf(tree), /non sélectionnable en masse/);
});

test('un groupe indécidable ARBITRÉ à la main redevient cochable', () => {
  const source =
    'window.__rendre = function (mergeGroups, mergeMasters, mergeSelection) {\n' +
    '  var mergePreview = null; var mergeBusy = false;\n' +
    '  var FM = window.FusionMasse;\n' +
    '  var setMergeMasters = function () {}; var setMergePreview = function () {};\n' +
    '  var previewMerge = function () {}; var executeMerge = function () {};\n' +
    '  var basculerSelection = function () {};\n' +
    '  return (<div>' + extraireBloc('{mergeGroups.map(group => {', '})}') + '</div>);\n' +
    '};\n';
  const sandbox = { window: {}, console, isFinite, parseFloat };
  sandbox.window.FusionMasse = FM;
  sandbox.window.React = { createElement, Fragment: 'Fragment' };
  sandbox.React = sandbox.window.React;
  vm.createContext(sandbox);
  vm.runInContext(babeliser(source), sandbox);

  const masters = Object.assign({}, MASTERS, { 'gib 3': 'PHY0021' });
  const tree = sandbox.window.__rendre([G_IND], masters, {});
  const cases = collect(tree, (n) => n.type === 'input' && n.props.type === 'checkbox');
  assert.strictEqual(cases[0].props.disabled, false);
});

// ── 6. LA BARRE DE LOT ─────────────────────────────────────────────────────

/**
 * Rend la barre de fusion en masse (sélection, aperçu, progression, bilan).
 * @param {Object} etat
 */
function rendreBarre(etat) {
  const source =
    'window.__barre = function (e) {\n' +
    '  var FM = window.FusionMasse;\n' +
    '  var mergeGroups = e.mergeGroups, mergeMasters = e.mergeMasters, mergeLot = e.mergeLot;\n' +
    '  var mergeIgnores = e.mergeIgnores, mergeApercu = e.mergeApercu;\n' +
    '  var mergeApercuAJour = e.mergeApercuAJour, mergeProgress = e.mergeProgress;\n' +
    '  var mergeRapport = e.mergeRapport, mergeBusy = e.mergeBusy;\n' +
    '  var toutSelectionner = function () {}; var apercuLot = function () {}; var executerLot = function () {};\n' +
    '  return (' +
    extraireBloc(
      '<div style={{border:\'1px solid #d5dbe0\',borderRadius:10,padding:\'12px 14px\',background:\'#fbfcfd\'}}>',
      '</div>'
    ) +
    ');\n};\n';
  const sandbox = { window: {}, console, Math };
  sandbox.window.FusionMasse = FM;
  sandbox.window.React = { createElement, Fragment: 'Fragment' };
  sandbox.React = sandbox.window.React;
  vm.createContext(sandbox);
  vm.runInContext(babeliser(source), sandbox);
  return sandbox.window.__barre(Object.assign({
    mergeGroups: [G_A, G_B], mergeMasters: MASTERS, mergeLot: [], mergeIgnores: [],
    mergeApercu: null, mergeApercuAJour: false, mergeProgress: null, mergeRapport: null,
    mergeBusy: false,
  }, etat));
}

/** Le bouton d'exécution du lot. */
function boutonLot(tree) {
  return collect(tree, (n) => n.type === 'button' && /Fusionner le lot/.test(textOf(n)))[0];
}

test('le bouton « Fusionner le lot » est DÉSACTIVÉ tant que l’aperçu n’est pas fait', () => {
  const sel = { magical: true };
  const lot = FM.construireLot([G_A], MASTERS, sel).lot;
  const sansApercu = boutonLot(rendreBarre({ mergeLot: lot, mergeApercuAJour: false }));
  assert.strictEqual(sansApercu.props.disabled, true, 'l’aperçu global est obligatoire');
  const avecApercu = boutonLot(rendreBarre({
    mergeLot: lot, mergeApercu: apercuPour([G_A], sel), mergeApercuAJour: true,
  }));
  assert.strictEqual(avecApercu.props.disabled, false);
});

test('la barre affiche le chiffrage global avant d’écrire', () => {
  const texte = textOf(rendreBarre({
    mergeLot: FM.construireLot([G_A, G_B], MASTERS, { magical: true, vertimec: true }).lot,
    mergeApercuAJour: true,
    mergeApercu: { signature: 'x', total: { groupes: 85, fiches_desactivees: 86, soldes_agreges: 189, mouvements: 12, bdc: 7 } },
  }));
  for (const n of ['85', '86', '189', '12', '7']) {
    assert.ok(texte.includes(n), 'chiffre absent de l’aperçu global : ' + n + ' dans ' + texte);
  }
  assert.match(texte, /fiche\(s\) désactivée\(s\)/);
  assert.match(texte, /solde\(s\) agrégé\(s\)/);
});

test('la progression s’affiche en « fait / total »', () => {
  const texte = textOf(rendreBarre({
    mergeLot: [], mergeProgress: { phase: 'execution', fait: 12, total: 85, courant: 'magical' },
  }));
  assert.match(texte, /12/);
  assert.match(texte, /85/);
  assert.match(texte, /Fusion en cours/);
});

test('le compte rendu final liste les groupes non fusionnés et leur raison', () => {
  const texte = textOf(rendreBarre({
    mergeLot: [],
    mergeRapport: {
      groupes_fusionnes: 40, fiches_desactivees: 41, soldes_agreges: 12, mouvements: 3, bdc: 1,
      arret_anomalie: true,
      non_fusionnes: [{ normalized: 'kelpak', raison: 'non traité — lot arrêté à la première anomalie' }],
    },
  }));
  assert.match(texte, /interrompu/);
  assert.match(texte, /kelpak/);
  assert.match(texte, /lot arrêté/);
  assert.ok(texte.includes('40'), 'le nombre de groupes fusionnés doit être affiché');
});

// ── 7. GARDE DE RÔLE : SERVEUR, DEPUIS LE JETON ────────────────────────────

test('merge-articles résout le rôle depuis le JETON, jamais depuis le body', () => {
  // Le lot n'ajoute aucune action backend : il rejoue `merge-articles`. Si la
  // garde retombait sur `req.body`, n'importe quel appelant fusionnerait 85
  // groupes en se déclarant `dg`.
  const i = BACKEND.indexOf('if (action === "merge-articles"');
  assert.notStrictEqual(i, -1, 'action merge-articles introuvable');
  const bloc = BACKEND.slice(i, i + 1600);
  assert.match(bloc, /resolveCallerRole\(authUser\)/, 'le rôle doit venir du jeton');
  assert.match(bloc, /stockRoles\.peutFusionnerArticles\(callerRole\)/, 'règle pure partagée');
  const garde = bloc.slice(0, bloc.indexOf('peutFusionnerArticles'));
  assert.doesNotMatch(garde, /req\.body[\s\S]*profileId/, 'aucun rôle lu depuis le body');
});

test('l’écran n’a pas ajouté d’action backend d’orchestration', () => {
  // Une deuxième mécanique de fusion dans le dépôt serait la divergence
  // silencieuse qu'on a passé la journée à éliminer.
  assert.doesNotMatch(BACKEND, /action === "merge-articles-bulk"/);
  assert.doesNotMatch(SRC, /action=merge-articles-bulk/);
});
