'use strict';

// `campagne-analytique-detail` doit renvoyer `nbOuv` par ligne (LOT 2b) — sans
// lui, la colonne « Ouvriers » de la pop-up de détail de la grille afficherait 0
// en silence, alors que la même pop-up est renseignée sur l'écran Quinzaine
// (`quinzaine-analytique` renvoie nbOuv depuis toujours).
//
// pointageService.js est un monolithe sans DI (cf. TODO_REFACTO.md) : on ne peut
// pas appeler le handler. Même approche que
// tests/unit/pointage-quinzaine-cache-shape.test.js — on lit le source — mais on
// va plus loin que le pattern matching : le bloc d'agrégation par jour est
// EXTRAIT et EXÉCUTÉ dans un vm avec des dépendances stubbées, ce qui prouve le
// comportement (matricules DISTINCTS, Set non sérialisé) et pas seulement la
// présence du mot `nbOuv`.
//
// ⚠️ CIBLE = `computeCampagneAnalytiqueDetail`, pas le handler HTTP. Depuis le
// LOT A de l'export serveur, le handler `campagne-analytique-detail` ne fait
// plus que déléguer à cette fonction de module (réutilisée par
// buildCampagneExportXlsx). Le corps agrégatif — et donc `nbOuv` et la clé de
// cache — vit là. Viser le handler laisserait le test vert sur un bloc vide.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../functions/pointageService.js'),
  'utf8'
);

const ACTION_IDX = SRC.indexOf('async function computeCampagneAnalytiqueDetail(');
assert.ok(ACTION_IDX !== -1, 'computeCampagneAnalytiqueDetail introuvable');
const ACTION_END = SRC.indexOf('exports.computeCampagneAnalytiqueDetail', ACTION_IDX);
assert.ok(ACTION_END !== -1, 'borne de fin de la fonction introuvable');
const BLOCK = SRC.slice(ACTION_IDX, ACTION_END);

// Le handler HTTP ne doit garder AUCUN corps agrégatif propre : s'il en
// reprenait un (copier-coller à la place de la délégation), ce fichier
// testerait une version morte pendant que la vivante dériverait.
const HANDLER_IDX = SRC.indexOf('if (action === "campagne-analytique-detail") {');
assert.ok(HANDLER_IDX !== -1, 'handler campagne-analytique-detail introuvable');
const HANDLER_END = SRC.indexOf('if (action === "campagne-conso-parcelle") {', HANDLER_IDX);
const HANDLER_BLOCK = SRC.slice(HANDLER_IDX, HANDLER_END);

/** Le bloc d'agrégation d'une journée, extrait tel quel. */
function aggregateBlock() {
  const start = BLOCK.indexOf('const groups = {};');
  assert.ok(start !== -1, 'bloc d\'agrégation introuvable');
  const endMarker = 'rows.push(g);';
  const end = BLOCK.indexOf(endMarker, start);
  assert.ok(end !== -1, 'fin du bloc d\'agrégation introuvable');
  // Jusqu'à l'accolade fermante de la boucle de push.
  const close = BLOCK.indexOf('}', end + endMarker.length);
  return BLOCK.slice(start, close + 1);
}

/** Exécute le bloc extrait sur un jeu de lignes miroir. */
function runAggregate(dayRows, tauxParOuvrier) {
  const sandbox = {
    dayRows,
    periode: 'Quinzaine 03',
    rows: [],
    resolveFamily: () => 'Taille',
    deriveFerme: () => 'F1',
    _refMap: {},
    // Taux par ouvrier × quinzaine (2026-08-21). Vide par défaut : le bloc doit
    // rester exact sans lui — un ouvrier sans taux ne casse rien, il alimente
    // `jhSansTaux` pour que l'écran puisse le dire.
    tauxParOuvrier: tauxParOuvrier || {},
  };
  vm.createContext(sandbox);
  vm.runInContext('(function () {\n' + aggregateBlock() + '\n})();', sandbox);
  return sandbox.rows;
}

const ROW = {
  Parcelle_Culturale: 'F1- S5 MARAVILLA',
  Ref_parcelle: 'F1S5',
  Operation: 'Taille longue',
  Operation_Groupe: 'GB09',
  Operation_Famille: '9. Taille',
  Nombre_Jr: 1,
  Cout: 100,
};

test('nbOuv = matricules DISTINCTS du groupe, jamais le nombre de lignes', () => {
  const out = runAggregate([
    Object.assign({}, ROW, { Personnel_Matricule: 'M1' }),
    Object.assign({}, ROW, { Personnel_Matricule: 'M2' }),
    // Même ouvrier, deuxième ligne sur la même opération le même jour.
    Object.assign({}, ROW, { Personnel_Matricule: 'M1' }),
  ]);
  assert.strictEqual(out.length, 1, 'une seule ligne agrégée');
  assert.strictEqual(out[0].nbOuv, 2, '3 lignes mais 2 matricules distincts');
  // Les autres agrégats restent inchangés (non-régression de la réponse).
  assert.strictEqual(out[0].jh, 3);
  assert.strictEqual(out[0].cout, 300);
});

test('la ligne renvoyée est sérialisable : le Set de matricules est retiré', () => {
  // Un Set sérialise en `{}` : laissé dans la réponse JSON, il gonflerait le
  // payload sans rien apporter et masquerait l'absence de nbOuv.
  const out = runAggregate([Object.assign({}, ROW, { Personnel_Matricule: 'M1' })]);
  assert.ok(!('workers' in out[0]), 'le Set `workers` ne doit pas sortir du handler');
  assert.deepStrictEqual(
    Object.keys(JSON.parse(JSON.stringify(out[0]))).sort(),
    ['code', 'cout', 'coutCharge', 'famille', 'ferme', 'groupe', 'jh', 'jhSansTaux',
      'nbOuv', 'operation', 'parcelle', 'periode', 'refParcelle'].sort()
  );
});

test('lignes sans matricule : nbOuv = 0, aucune exception', () => {
  const out = runAggregate([Object.assign({}, ROW, { Personnel_Matricule: null })]);
  assert.strictEqual(out[0].nbOuv, 0);
});

test('la clé de cache est bumpée : une réponse v1 (sans nbOuv) ne peut plus être servie', () => {
  // v3 : ajout de `coutCharge` et `jhSansTaux` par ligne (2026-08-21). Chaque
  // enrichissement du payload DOIT bumper la clé — une réponse d'une version
  // antérieure encore en cache servirait des lignes sans le nouveau champ, et
  // la grille afficherait 0 sans lever la moindre erreur.
  assert.match(BLOCK, /campagne_analytique_detail_v3_/, 'clé de cache non bumpée');
  assert.doesNotMatch(BLOCK, /campagne_analytique_detail_v[12]_/);
});

test('le handler HTTP délègue et ne réagrège rien lui-même', () => {
  assert.match(HANDLER_BLOCK, /computeCampagneAnalytiqueDetail\(_fermeFilter, _cultureFilter\)/);
  assert.doesNotMatch(HANDLER_BLOCK, /const groups = \{\};/,
    'le handler a récupéré un corps agrégatif : il doit déléguer');
});


// ─────────────────────────────────── coût chargé par ouvrier (lot 2)

test('coutCharge — chaque ligne vaut ses JH × le taux de SON ouvrier', () => {
  // C'est tout l'objet du lot 2 : deux ouvriers sur la même parcelle et la même
  // opération, à des coûts différents, ne doivent plus ressortir au même prix.
  const rows = runAggregate([
    { ...ROW, Personnel_Matricule: 'A1', Nombre_Jr: 2 },
    { ...ROW, Personnel_Matricule: 'B2', Nombre_Jr: 1 },
  ], { 'A1|Quinzaine 03': 150, 'B2|Quinzaine 03': 90 });
  assert.strictEqual(rows.length, 1, 'même parcelle + même opération = un groupe');
  assert.strictEqual(rows[0].coutCharge, 2 * 150 + 1 * 90);
  assert.strictEqual(rows[0].jhSansTaux, 0);
});

test('coutCharge — ouvrier sans taux : ses JH sont SIGNALÉS, pas devinés', () => {
  // Un coût partiel affiché sans mention se lit comme un coût complet. On ne
  // retombe surtout pas sur le `Cout` BEE ONE, qui ferait passer un coût nu
  // pour un coût chargé.
  const rows = runAggregate([
    { ...ROW, Personnel_Matricule: 'A1', Nombre_Jr: 2 },
    { ...ROW, Personnel_Matricule: 'INCONNU', Nombre_Jr: 3 },
  ], { 'A1|Quinzaine 03': 150 });
  assert.strictEqual(rows[0].coutCharge, 300);
  assert.strictEqual(rows[0].jhSansTaux, 3);
});

test('coutCharge — aucun taux fourni : zéro partout, et rien ne casse', () => {
  const rows = runAggregate([{ ...ROW, Personnel_Matricule: 'A1', Nombre_Jr: 2 }]);
  assert.strictEqual(rows[0].coutCharge, 0);
  assert.strictEqual(rows[0].jhSansTaux, 2);
  // Le témoin BEE ONE reste servi : il alimente le panneau de rapprochement,
  // qui mesure ce que la grille ne rattache à aucune parcelle.
  assert.ok(Object.prototype.hasOwnProperty.call(rows[0], 'cout'));
});

test('PORTÉE — `tauxParOuvrier` est déclaré DANS computeCampagneAnalytiqueDetail', () => {
  // Le bloc d'agrégation est exécuté ici dans un bac à sable où la variable est
  // fournie : aucun test de comportement ne peut donc voir une erreur de PORTÉE.
  // Elle s'est produite — la déclaration avait atterri dans la fonction voisine
  // (`computeCampagneCoutOuvrier`, qui contient elle aussi un
  // `const meta = await getPointageMeta();`, sur lequel la réécriture s'était
  // ancrée). Résultat : « tauxParOuvrier is not defined » sur l'onglet Campagne,
  // en production, sans qu'aucun test ne bronche.
  //
  // Ce contrôle est STATIQUE à dessein : il lit la source de la fonction.
  assert.match(BLOCK, /let tauxParOuvrier = \{\};/,
    'la déclaration doit vivre dans computeCampagneAnalytiqueDetail, pas ailleurs');
  const iDecl = BLOCK.indexOf('let tauxParOuvrier');
  const iUsage = BLOCK.indexOf('tauxParOuvrier[');
  assert.ok(iUsage > iDecl && iDecl !== -1,
    'la déclaration doit précéder l\'usage dans la même fonction');
});
