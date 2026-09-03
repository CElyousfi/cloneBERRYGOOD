'use strict';

// Tests des fonctions PURES de scripts/generate-code-index.js.
// Contrainte : ces tests n'écrivent JAMAIS dans docs/ai/ (qa.sh échoue si le
// working tree est sale sur ces fichiers) — la génération complète est testée
// dans un répertoire temporaire.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TARGET_TREES,
  maskComments,
  discoverActionFiles,
  parseExportHandlers,
  findHandlerForLine,
  parseActions,
  parseComponents,
  findBodyEnd,
  looksLikeComponentBody,
  parseRenderTabs,
  extractObjectKeys,
  findVarObjectBody,
  parseModuleExportsKeys,
  parsePublicLibExports,
  parseRelativeRequires,
  resolveRequirePath,
  reachableFrom,
  isTargetFile,
  isInTests,
  buildRequireIndex,
  collectRequireIndexSources,
  renderActionsMap,
  renderComponentsMap,
  renderModulesMap,
  fingerprintFor,
  generate,
} = require('../../scripts/generate-code-index.js');

const ROOT = path.resolve(__dirname, '../..');

// --- 1. Handlers exports.xxx ---

test('parseExportHandlers: capture nom + ligne, ignore les exports indentés', () => {
  const src = [
    'const a = 1;',
    'exports.alpha = functions.https.onRequest(async (req, res) => {',
    '  // ...',
    '});',
    '  exports.indented = 1;',
    'exports.beta = 2;',
  ].join('\n');
  assert.deepStrictEqual(parseExportHandlers(src), [
    { name: 'alpha', line: 2 },
    { name: 'beta', line: 6 },
  ]);
});

test('findHandlerForLine: dernier handler strictement avant la ligne', () => {
  const handlers = [
    { name: 'alpha', line: 10 },
    { name: 'beta', line: 50 },
  ];
  assert.strictEqual(findHandlerForLine(handlers, 20, 'fallback'), 'alpha');
  assert.strictEqual(findHandlerForLine(handlers, 60, 'fallback'), 'beta');
  assert.strictEqual(findHandlerForLine(handlers, 50, 'fallback'), 'alpha');
});

test('findHandlerForLine: fallback si aucun handler avant', () => {
  assert.strictEqual(findHandlerForLine([{ name: 'a', line: 30 }], 5, 'index.js'), 'index.js');
  assert.strictEqual(findHandlerForLine([], 5, 'index.js'), 'index.js');
});

// --- 2. Actions backend ---

test('parseActions: if / else if, méthode optionnelle, lignes distinctes', () => {
  const src = [
    'exports.stockManagement = onRequest(async (req, res) => {',            // 1
    "  if (action === 'list-bl') {",                                        // 2
    '    return listBl(req, res);',                                         // 3
    "  } else if (action === 'create-bl' && req.method === 'POST') {",       // 4
    '    return createBl(req, res);',                                       // 5
    '  }',                                                                  // 6
    '});',                                                                  // 7
  ].join('\n');

  const actions = parseActions(src, 'functions/index.js');
  assert.strictEqual(actions.length, 2);
  assert.deepStrictEqual(actions[0], {
    action: 'list-bl',
    method: null,
    file: 'functions/index.js',
    line: 2,
    handler: 'stockManagement',
  });
  assert.deepStrictEqual(actions[1], {
    action: 'create-bl',
    method: 'POST',
    file: 'functions/index.js',
    line: 4,
    handler: 'stockManagement',
  });
});

test('parseActions: action avec tiret et guillemets doubles', () => {
  const src = 'if (action === "accept-anomalies-batch") { }';
  const actions = parseActions(src, 'functions/index.js');
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, 'accept-anomalies-batch');
});

test('parseActions: fallback basename quand aucun exports. avant', () => {
  const src = "if (action === 'foo') { }\nexports.later = 1;";
  const actions = parseActions(src, 'functions/lib/stock/valuationPMP.js');
  assert.strictEqual(actions[0].handler, 'valuationPMP.js');
});

test('parseActions: rattache chaque action au bon handler multi-exports', () => {
  const src = [
    'exports.first = 1;',            // 1
    "if (action === 'a') {}",        // 2
    'exports.second = 2;',           // 3
    "if (action === 'b') {}",        // 4
  ].join('\n');
  const actions = parseActions(src, 'f.js');
  assert.strictEqual(actions[0].handler, 'first');
  assert.strictEqual(actions[1].handler, 'second');
});

test('parseActions: disjonction || — les DEUX actions sont extraites', () => {
  // Cas réel functions/index.js:1620 — `update-bug-status` était invisible
  // quand la regex était ancrée sur `if|else if`.
  const src = [
    'exports.bugReports = onRequest(async (req, res) => {',              // 1
    '  if (action === "list-bugs" || action === "update-bug-status") {',  // 2
    '  }',                                                               // 3
    "  if (action === 'divers-entries' || action === 'divers-entries-range') {", // 4
    '  }',                                                               // 5
    '});',                                                               // 6
  ].join('\n');

  const actions = parseActions(src, 'functions/index.js');
  assert.deepStrictEqual(
    actions.map(a => a.action),
    ['list-bugs', 'update-bug-status', 'divers-entries', 'divers-entries-range']
  );
  // les deux membres d'une même disjonction partagent la ligne et le handler
  assert.deepStrictEqual(actions.map(a => a.line), [2, 2, 4, 4]);
  for (const a of actions) assert.strictEqual(a.handler, 'bugReports');
});

test('parseActions: action citée en COMMENTAIRE — ignorée', () => {
  // Cas réel functions/index.js:1692
  const src = [
    'exports.h = 1;',
    '// action === "update-bug-status" : ancien routage, supprimé',
    '/* if (action === "ghost-block") {} */',
    '/**',
    ' * action === "ghost-jsdoc"',
    ' */',
    "if (action === 'vraie-action') {}",
  ].join('\n');
  assert.deepStrictEqual(parseActions(src, 'f.js').map(a => a.action), ['vraie-action']);
});

test('parseActions: accès de propriété obj.action === — ignoré', () => {
  const src = [
    "if (resolved.action === 'suspect') {}",
    "if (p.action === 'validate') {}",
    "if (res.action === 'skip') {}",
    "if (row.action === 'x' && action === 'vraie') {}",
  ].join('\n');
  assert.deepStrictEqual(parseActions(src, 'f.js').map(a => a.action), ['vraie']);
});

test('parseActions: numéros de ligne inchangés malgré le masquage des commentaires', () => {
  const src = [
    '/* bloc',
    '   multi',
    '   ligne */',
    "if (action === 'apres-bloc') {}",
  ].join('\n');
  assert.strictEqual(parseActions(src, 'f.js')[0].line, 4);
});

test('maskComments: neutralise les commentaires, préserve longueur, lignes et chaînes', () => {
  const src = "const url = 'https://x.test/a'; // action === 'ghost'\nif (action === 'reel') {}";
  const masked = maskComments(src);
  assert.strictEqual(masked.length, src.length, 'longueur préservée (index = index source)');
  assert.strictEqual(
    masked.split('\n').length,
    src.split('\n').length,
    'retours à la ligne préservés'
  );
  assert.ok(!masked.includes('ghost'), 'commentaire neutralisé');
  assert.ok(masked.includes("'reel'"), 'code réel intact');
  assert.ok(masked.includes('https://x.test/a'), "le // d'une URL en chaîne n'ouvre pas un commentaire");
});

test('discoverActionFiles: découverte dynamique, modules inclus, tests exclus', () => {
  const files = discoverActionFiles(ROOT);
  // Depuis la modularisation du backend, functions/index.js est un BARREL de
  // re-export : il ne déclare plus aucune action, et n'a donc rien à faire dans
  // cette liste — l'assertion « 0 action interdite » plus bas le rejetterait.
  // Les actions vivent dans functions/src/modules/**, et c'est leur découverte
  // qui compte.
  assert.ok(
    files.some(f => f.startsWith('functions/src/modules/')),
    'les modules de functions/src/modules/ doivent être découverts'
  );
  assert.ok(files.length > 1, 'plusieurs fichiers de service exposent des actions');
  for (const f of files) {
    assert.ok(f.startsWith('functions/'), `${f} sous functions/`);
    assert.ok(f.endsWith('.js'), `${f} est un .js`);
    assert.ok(!isInTests(f), `${f} n'est pas dans __tests__`);
    assert.ok(!f.includes('node_modules/'), `${f} hors node_modules`);
  }
  assert.deepStrictEqual(files, [...files].sort(), 'liste triée (déterminisme du fingerprint)');

  // Critère de découverte == critère d'extraction : aucun fichier retenu ne
  // doit produire 0 action (sinon il pollue le fingerprint pour rien).
  for (const f of files) {
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(
      parseActions(content, f).length > 0,
      `${f} est retenu mais ne produit aucune action — fingerprint pollué`
    );
  }

  // Les fichiers qui ne contiennent QUE des accès de propriété sont exclus
  for (const excluded of [
    'functions/lib/stock/valuationPMP.js',
    'functions/lib/validation/validationAccess.js',
    'functions/update-bdc-validation-template.js',
  ]) {
    assert.ok(
      !files.includes(excluded),
      `${excluded} ne contient que des obj.action === … : ne doit pas être retenu`
    );
  }
});

test('discoverActionFiles: un fichier sans vraie action HTTP n\'est pas retenu', () => {
  // Contrat vérifié en isolation : le critère de découverte est le résultat de
  // parseActions, pas la simple présence de la sous-chaîne « action === ».
  const propertyOnly = "if (p.action === 'validate') { return true; }\n";
  const commentOnly = "// action === 'ghost'\n";
  const real = "if (action === 'reel') {}\n";
  assert.strictEqual(parseActions(propertyOnly, 'f.js').length, 0);
  assert.strictEqual(parseActions(commentOnly, 'f.js').length, 0);
  assert.strictEqual(parseActions(real, 'f.js').length, 1);
});

// --- 3. Composants ---

test('parseComponents: PascalCase seulement, avec numéro de ligne', () => {
  const src = [
    'function helper() {}',           // 1 — minuscule, ignoré
    'function MyTab(props) {',        // 2
    '  return null;',                 // 3
    '}',                              // 4
    '  function Nested(a) {}',        // 5 — indenté, accepté
  ].join('\n');
  assert.deepStrictEqual(parseComponents(src, 'public/app.jsx'), [
    { name: 'MyTab', file: 'public/app.jsx', line: 2 },
    { name: 'Nested', file: 'public/app.jsx', line: 5 },
  ]);
});

test('parseComponents: ligne correcte après une ligne vide (^[ \\t]* et non ^\\s*)', () => {
  // `\s` inclut `\n` : `^\s*` démarrait le match sur la ligne vide précédente
  // et décalait 115 lignes sur 279 d'un cran vers le haut.
  const src = '\n\nfunction Foo() {}';
  assert.deepStrictEqual(parseComponents(src, 'public/app.jsx'), [
    { name: 'Foo', file: 'public/app.jsx', line: 3 },
  ]);

  const indented = ['', '', '      function Bar(props) {', '  return null;', '}'].join('\n');
  assert.strictEqual(parseComponents(indented, 'public/app.jsx')[0].line, 3);
});

test('parseComponents: forme `= function(` avec React.createElement', () => {
  const src = [
    'const x = 1;',                                  // 1
    'var Gauge = function(pr) {',                    // 2
    "  return React.createElement('svg', null);",    // 3
    '};',                                            // 4
  ].join('\n');
  assert.deepStrictEqual(parseComponents(src, 'public/app.jsx'), [
    { name: 'Gauge', file: 'public/app.jsx', line: 2 },
  ]);
});

test('parseComponents: forme `= () =>` avec retour JSX (zéro React.createElement)', () => {
  // Cas NotificationPopup (app.jsx:68315) : corps ~110 lignes, rendu 100 % JSX.
  const filler = new Array(60).fill('  // corps long').join('\n');
  const src = [
    'const NotificationPopup = () => {',
    '  const [open, setOpen] = useState(false);',
    filler,
    '  return (',
    '    <div style={{ padding: 8 }}>',
    '      <span>hello</span>',
    '    </div>',
    '  );',
    '};',
  ].join('\n');
  const found = parseComponents(src, 'public/app.jsx');
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].name, 'NotificationPopup');
  assert.strictEqual(found[0].line, 1);
});

test('parseComponents: retour JSX sur la même ligne et JSX implicite `=> (`', () => {
  const sameLine = 'const Badge = (props) => {\n  return <em>{props.v}</em>;\n};';
  assert.deepStrictEqual(parseComponents(sameLine, 'f.jsx').map(c => c.name), ['Badge']);

  const implicit = 'const Chip = props => (\n  <b>{props.v}</b>\n);';
  assert.deepStrictEqual(parseComponents(implicit, 'f.jsx').map(c => c.name), ['Chip']);
});

test('parseComponents: rejette les alias utilitaires window.X (pas des composants)', () => {
  // PU, RK, MC, Guard, EC, CU dans app.jsx — aucun React.createElement ni JSX.
  const src = [
    "const PU = (typeof window !== 'undefined' && window.PaieUtils) ? window.PaieUtils : null;",
    "const Guard = (typeof window !== 'undefined' && window.StockMovementGuard) || null;",
    "const MC = (typeof window !== 'undefined' && window.MagCommon) ? window.MagCommon : null;",
  ].join('\n');
  assert.deepStrictEqual(parseComponents(src, 'public/app.jsx'), []);
});

test('parseComponents: rejette une fonction utilitaire en expression sans rendu React', () => {
  const src = [
    'const FormatMoney = function(v) {',
    '  return String(v) + " DH";',
    '};',
  ].join('\n');
  assert.deepStrictEqual(parseComponents(src, 'public/app.jsx'), []);
});

test('looksLikeComponentBody: les deux styles de rendu, et rien d\'autre', () => {
  assert.ok(looksLikeComponentBody("{ return React.createElement('div'); }"));
  assert.ok(looksLikeComponentBody('{ return <div />; }'));
  assert.ok(looksLikeComponentBody('{ return (\n    <div>\n  ); }'));
  assert.ok(!looksLikeComponentBody('{ return window.X || null; }'));
  assert.ok(!looksLikeComponentBody('{ return a < b; }'));
});

test('findBodyEnd: accolades imbriquées, chaînes et commentaires ignorés', () => {
  const src = '{ const s = "}"; /* } */ // }\n  if (a) { b(); }\n}';
  assert.strictEqual(findBodyEnd(src, 0), src.length - 1);
});

test('parseComponents: sortie triée par ligne, formes mélangées', () => {
  const src = [
    'const Alpha = () => {',                       // 1
    '  return <i />;',                             // 2
    '};',                                          // 3
    'function Beta() {',                           // 4
    '  return null;',                              // 5
    '}',                                           // 6
  ].join('\n');
  assert.deepStrictEqual(parseComponents(src, 'f.jsx').map(c => [c.name, c.line]), [
    ['Alpha', 1],
    ['Beta', 4],
  ]);
});

test('parseRenderTabs: avec et sans window., première occurrence gagne', () => {
  const src = [
    "renderTab('achats_bdc', AchatsBDCTab, props)",
    "renderTab('mag_sortie', window.MagSortieTab, props)",
    "renderTab('autre_tab', AchatsBDCTab, props)",
  ].join('\n');
  assert.deepStrictEqual(parseRenderTabs(src), {
    AchatsBDCTab: 'achats_bdc',
    MagSortieTab: 'mag_sortie',
  });
});

// --- 4. Exports d'objets ---

test('extractObjectKeys: shorthand, key: value, ignore spread et commentaires', () => {
  const body = [
    '  // un commentaire',
    '  alpha,',
    '  beta: betaImpl,',
    '  ...spread,',
    '  gamma',
  ].join('\n');
  assert.deepStrictEqual(extractObjectKeys(body), ['alpha', 'beta', 'gamma']);
});

test('extractObjectKeys: déduplique', () => {
  assert.deepStrictEqual(extractObjectKeys('a,\na,\nb'), ['a', 'b']);
});

test('parseModuleExportsKeys: forme multiligne', () => {
  const src = 'module.exports = {\n  foo,\n  bar: barImpl,\n};\n';
  assert.deepStrictEqual(parseModuleExportsKeys(src), ['foo', 'bar']);
});

test('parseModuleExportsKeys: forme inline', () => {
  const src = 'module.exports = { resolveCallerRole, resolveCallerProfile };\n';
  assert.deepStrictEqual(parseModuleExportsKeys(src), ['resolveCallerRole', 'resolveCallerProfile']);
});

test('parseModuleExportsKeys: indirection par variable', () => {
  const src = [
    'const __api = {',
    '  DIRECT_DG_FARMS,',
    '  requiresChefValidation,',
    '};',
    'module.exports = __api;',
  ].join('\n');
  assert.deepStrictEqual(parseModuleExportsKeys(src), ['DIRECT_DG_FARMS', 'requiresChefValidation']);
});

test('parseModuleExportsKeys: aucun export -> tableau vide', () => {
  assert.deepStrictEqual(parseModuleExportsKeys('// types only\n'), []);
});

test('findVarObjectBody: variable absente -> null', () => {
  assert.strictEqual(findVarObjectBody('const other = {};', 'api'), null);
});

// --- 5. public/lib (UMD bricolé) ---

test('parsePublicLibExports: window.X = apiVar (forme dominante)', () => {
  const src = [
    'const __api = {',
    '  computeTotals,',
    '  formatQte,',
    '};',
    "if (typeof window !== 'undefined') window.InventaireUtils = __api;",
  ].join('\n');
  const parsed = parsePublicLibExports(src);
  assert.strictEqual(parsed.globalName, 'InventaireUtils');
  assert.deepStrictEqual(parsed.functions, ['computeTotals', 'formatQte']);
});

test('parsePublicLibExports: window.X = { … } inline', () => {
  const src = 'window.EmargementExcel = { genSansCnssXlsx: genSansCnssXlsx, genAvecCnssXlsx: genAvecCnssXlsx };';
  const parsed = parsePublicLibExports(src);
  assert.strictEqual(parsed.globalName, 'EmargementExcel');
  assert.deepStrictEqual(parsed.functions, ['genSansCnssXlsx', 'genAvecCnssXlsx']);
});

test('parsePublicLibExports: UMD root.X = api + return de la factory', () => {
  const src = [
    '(function (root, factory) {',
    '  var api = factory();',
    '  if (root) root.PrimesV2 = api;',
    '})(window, function () {',
    '  return {',
    '    norm: norm,',
    '    searchWorkers: searchWorkers,',
    '  };',
    '});',
  ].join('\n');
  const parsed = parsePublicLibExports(src);
  assert.strictEqual(parsed.globalName, 'PrimesV2');
  assert.deepStrictEqual(parsed.functions, ['norm', 'searchWorkers']);
});

test('parsePublicLibExports: nom global depuis le commentaire d\'en-tête', () => {
  const src = [
    '/**',
    ' * foo.js — exposé en window.FooLib',
    ' */',
    "'use strict';",
  ].join('\n');
  const parsed = parsePublicLibExports(src);
  assert.strictEqual(parsed.globalName, 'FooLib');
  assert.deepStrictEqual(parsed.functions, []);
});

test('parsePublicLibExports: source vide ne plante pas', () => {
  const parsed = parsePublicLibExports('');
  assert.strictEqual(parsed.globalName, null);
  assert.deepStrictEqual(parsed.functions, []);
});

// --- 6. require-index ---

test('parseRelativeRequires: requires relatifs uniquement', () => {
  // NB : les chemins de fixture sont volontairement inexistants — ce fichier de
  // test est lui-même scanné par le générateur, un chemin réel polluerait
  // docs/ai/require-index.json avec une fausse couverture.
  const src = [
    "const a = require('../../public/lib/__fixture__.js');",
    "const b = require('..');",
    "const c = require('./helper');",
    "const fs = require('fs');",
    "const pkg = require('firebase-admin');",
  ].join('\n');
  assert.deepStrictEqual(parseRelativeRequires(src), [
    '../../public/lib/__fixture__.js',
    '..',
    './helper',
  ]);
});

test('resolveRequirePath: ordre littéral > .js > .jsx > /index.js', () => {
  const files = new Set([
    '/repo/functions/lib/irrigation/index.js',
    '/repo/public/lib/bdcWorkflow.js',
    '/repo/public/components/MagSortieTab.jsx',
    '/repo/functions/lib/a/b.json',
  ]);
  const exists = p => files.has(p);

  // 1. chemin littéral (extension déjà présente)
  assert.strictEqual(
    resolveRequirePath('/repo/tests/unit', '../../public/lib/bdcWorkflow.js', exists),
    '/repo/public/lib/bdcWorkflow.js'
  );
  // 2. extension .js implicite
  assert.strictEqual(
    resolveRequirePath('/repo/tests/unit', '../../public/lib/bdcWorkflow', exists),
    '/repo/public/lib/bdcWorkflow.js'
  );
  // 3. extension .jsx implicite
  assert.strictEqual(
    resolveRequirePath('/repo/tests/unit', '../../public/components/MagSortieTab', exists),
    '/repo/public/components/MagSortieTab.jsx'
  );
  // 4. require('..') sur un répertoire → /index.js
  assert.strictEqual(
    resolveRequirePath('/repo/functions/lib/irrigation/__tests__', '..', exists),
    '/repo/functions/lib/irrigation/index.js'
  );
});

test('resolveRequirePath: non résolu -> null', () => {
  assert.strictEqual(resolveRequirePath('/repo/tests/unit', './nope', () => false), null);
});

test('reachableFrom: fermeture transitive, seeds inclus', () => {
  const graph = { a: ['b'], b: ['c'], c: [], d: ['a'] };
  assert.deepStrictEqual(reachableFrom(graph, ['a']), ['a', 'b', 'c']);
  assert.deepStrictEqual(reachableFrom(graph, ['c']), ['c']);
  assert.deepStrictEqual(reachableFrom(graph, []), []);
});

test('reachableFrom: cycle ne provoque pas de boucle infinie', () => {
  const graph = { a: ['b'], b: ['c'], c: ['a'] };
  assert.deepStrictEqual(reachableFrom(graph, ['a']), ['a', 'b', 'c']);

  // auto-référence + cycle croisé
  const selfCycle = { x: ['x', 'y'], y: ['x'] };
  assert.deepStrictEqual(reachableFrom(selfCycle, ['x']), ['x', 'y']);
});

test('reachableFrom: noeud inconnu du graphe ne plante pas', () => {
  assert.deepStrictEqual(reachableFrom({ a: ['ghost'] }, ['a']), ['a', 'ghost']);
});

test('isTargetFile: arbres cibles, extensions, exclusion __tests__', () => {
  assert.ok(isTargetFile('functions/lib/irrigation/index.js'));
  assert.ok(isTargetFile('functions/middleware/cors.js'));
  assert.ok(isTargetFile('public/lib/bdcWorkflow.js'));
  assert.ok(isTargetFile('public/components/MagSortieTab.jsx'));

  assert.ok(!isTargetFile('functions/lib/irrigation/__tests__/nextPulse.test.js'));
  assert.ok(!isTargetFile('functions/index.js'));
  assert.ok(!isTargetFile('tests/unit/bdcWorkflow.test.js'));
  assert.ok(!isTargetFile('functions/lib/irrigation'));
  assert.ok(!isTargetFile('public/lib/README.md'));
});

test('isInTests: détecte un segment __tests__', () => {
  assert.ok(isInTests('functions/lib/a/__tests__/b.test.js'));
  assert.ok(!isInTests('functions/lib/a/b.js'));
});

// --- 7. Rendu Markdown ---

test('renderActionsMap: bandeau, fingerprint, titre compté, méthode vide', () => {
  const md = renderActionsMap(
    [
      { action: 'list-bl', method: null, file: 'functions/index.js', line: 42, handler: 'stockManagement' },
      { action: 'create-bl', method: 'POST', file: 'functions/index.js', line: 77, handler: 'stockManagement' },
    ],
    'sha256:deadbeef'
  );
  assert.ok(md.startsWith('<!-- GENERATED FILE'), 'bandeau GENERATED FILE en tête');
  assert.ok(md.includes('<!-- sourceFingerprint: sha256:deadbeef -->'));
  assert.ok(md.includes('# Code Map — Actions backend (2)'));
  assert.ok(md.includes('| Action | Fichier:Ligne | Handler | Méthode |'));
  assert.ok(md.includes('| list-bl | functions/index.js:42 | stockManagement | — |'));
  assert.ok(md.includes('| create-bl | functions/index.js:77 | stockManagement | POST |'));
});

test('renderComponentsMap: tab absent -> tiret', () => {
  const md = renderComponentsMap(
    [{ name: 'MyTab', file: 'public/app.jsx', line: 7, tab: null }],
    'sha256:cafe'
  );
  assert.ok(md.includes('# Code Map — Composants frontend (1)'));
  assert.ok(md.includes('| MyTab | public/app.jsx:7 | — |'));
});

test('renderModulesMap: fonctions vides -> « — voir fichier — »', () => {
  const md = renderModulesMap(
    [
      { file: 'public/lib/x.js', globalName: 'X', functions: [] },
      { file: 'functions/lib/a/b.js', globalName: null, functions: ['foo', 'bar'] },
    ],
    'sha256:beef'
  );
  assert.ok(md.includes('# Code Map — Modules lib (2)'));
  assert.ok(md.includes('| public/lib/x.js | X | — voir fichier — |'));
  assert.ok(md.includes('| functions/lib/a/b.js | — | foo, bar |'));
});

// --- 8. Fingerprints ---

test('fingerprintFor: 4 fingerprints indépendants et stables', () => {
  const names = ['actions', 'components', 'modules', 'require-index'];
  const fps = names.map(n => fingerprintFor(ROOT, n));
  for (const fp of fps) {
    assert.ok(/^sha256:[0-9a-f]{16}$/.test(fp), `format fingerprint: ${fp}`);
  }
  assert.strictEqual(new Set(fps).size, 4, 'les 4 fingerprints sont distincts');
  assert.strictEqual(fingerprintFor(ROOT, 'actions'), fps[0], 'stable entre deux appels');
});

// Le fingerprint require-index porte sur les ARÊTES de l'index, pas sur le
// contenu des fichiers : sans ça la gate rougit à chaque assertion ajoutée dans
// n'importe lequel des ~139 fichiers de test, alors que le payload est
// identique — et une gate qui rougit à tort est une gate qu'on ignore.
// NB : mini-repo temporaire, jamais les vrais fichiers ni docs/ai/.

/**
 * Crée un mini-repo jetable : 2 modules cibles (a → b) + 1 test qui require a.
 * @returns {string} racine temporaire
 */
function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-fp-'));
  fs.mkdirSync(path.join(root, 'public/lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests/unit'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'public/lib/a.js'),
    "'use strict';\nconst b = require('./b.js');\nmodule.exports = { a: 1 };\n"
  );
  fs.writeFileSync(path.join(root, 'public/lib/b.js'), "'use strict';\nmodule.exports = { b: 1 };\n");
  fs.writeFileSync(
    path.join(root, 'tests/unit/a.test.js'),
    "const a = require('../../public/lib/a.js');\nassert.ok(a);\n"
  );
  return root;
}

test('fingerprint require-index (a): éditer le contenu NON-require d\'un test ne change RIEN', () => {
  const root = makeTempRepo();
  const before = fingerprintFor(root, 'require-index');

  const testFile = path.join(root, 'tests/unit/a.test.js');
  fs.writeFileSync(
    testFile,
    fs.readFileSync(testFile, 'utf8') + "assert.strictEqual(a.a, 1); // assertion ajoutee\n"
  );

  assert.strictEqual(
    fingerprintFor(root, 'require-index'),
    before,
    'ajouter une assertion ne doit pas périmer require-index'
  );

  // Le payload non plus ne bouge pas — c'est bien le même invariant.
  assert.deepStrictEqual(buildRequireIndex(root).index['public/lib/a.js'].directTests, [
    'tests/unit/a.test.js',
  ]);

  fs.rmSync(root, { recursive: true, force: true });
});

test('fingerprint require-index (b): changer un require() dans un test CHANGE l\'empreinte', () => {
  const root = makeTempRepo();
  const before = fingerprintFor(root, 'require-index');

  fs.writeFileSync(
    path.join(root, 'tests/unit/a.test.js'),
    "const b = require('../../public/lib/b.js');\nassert.ok(b);\n"
  );

  assert.notStrictEqual(fingerprintFor(root, 'require-index'), before);

  fs.rmSync(root, { recursive: true, force: true });
});

test('fingerprint require-index (c): changer un require() dans une source cible CHANGE l\'empreinte', () => {
  const root = makeTempRepo();
  const before = fingerprintFor(root, 'require-index');

  // a.js ne require plus b.js → l'arête source→source disparaît, et avec elle
  // la couverture transitive de b.js.
  fs.writeFileSync(path.join(root, 'public/lib/a.js'), "'use strict';\nmodule.exports = { a: 1 };\n");

  assert.notStrictEqual(fingerprintFor(root, 'require-index'), before);
  assert.deepStrictEqual(buildRequireIndex(root).index['public/lib/b.js'].transitiveTests, []);

  fs.rmSync(root, { recursive: true, force: true });
});

test('fingerprint require-index (d): ajouter puis retirer une cible CHANGE l\'empreinte', () => {
  const root = makeTempRepo();
  const before = fingerprintFor(root, 'require-index');

  const added = path.join(root, 'public/lib/c.js');
  fs.writeFileSync(added, "'use strict';\nmodule.exports = {};\n");
  const withAdded = fingerprintFor(root, 'require-index');
  assert.notStrictEqual(withAdded, before, 'ajout d\'une cible détecté');

  fs.rmSync(added);
  assert.strictEqual(
    fingerprintFor(root, 'require-index'),
    before,
    'retrait de la cible : retour à l\'empreinte initiale'
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('fingerprint require-index: aucun contenu de fichier dans les sources', () => {
  const root = makeTempRepo();
  const sources = collectRequireIndexSources(root);
  assert.deepStrictEqual(
    sources.map(s => s.path),
    ['__target_files__', '__source_graph__', '__direct_edges__']
  );
  for (const s of sources) {
    assert.ok(!s.content.includes('use strict'), `${s.path} ne doit contenir aucun code source`);
    assert.ok(!s.content.includes('module.exports'), `${s.path} ne doit contenir aucun code source`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('fingerprint require-index: CLI et fichier généré partagent le même calcul', () => {
  const root = makeTempRepo();
  const outDir = path.join(root, 'out');
  generate(root, { outDir });
  const written = JSON.parse(fs.readFileSync(path.join(outDir, 'require-index.json'), 'utf8'));
  assert.strictEqual(
    written._meta.sourceFingerprint,
    fingerprintFor(root, 'require-index'),
    'le --fingerprint-only ne doit pas diverger du fichier écrit'
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('fingerprintFor: nom inconnu -> erreur explicite', () => {
  assert.throws(() => fingerprintFor(ROOT, /** @type {any} */ ('nope')), /fingerprint inconnu/);
});

// --- 9. Génération complète (répertoire TEMPORAIRE, jamais docs/ai/) ---

test('generate: écrit les 4 sorties dans un répertoire temporaire', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-test-'));

  const stats = generate(ROOT, { outDir });

  assert.ok(stats.actions > 0, 'au moins une action détectée');
  assert.ok(stats.actionFiles > 0, 'au moins un fichier d\'actions découvert');
  assert.ok(stats.components > 0, 'au moins un composant détecté');
  assert.ok(stats.modules > 0, 'au moins un module détecté');
  assert.ok(stats.requireStats.targetFiles > 0, 'au moins un fichier cible indexé');

  const actionsMd = fs.readFileSync(path.join(outDir, 'code-map-actions.md'), 'utf8');
  assert.ok(actionsMd.includes('# Code Map — Actions backend ('));
  // create-bl et list-bl : deux lignes DISTINCTES (le bug qui motive l'item)
  const createBl = actionsMd.split('\n').filter(l => l.startsWith('| create-bl |'));
  const listBl = actionsMd.split('\n').filter(l => l.startsWith('| list-bl |'));
  assert.ok(createBl.length > 0, 'create-bl présent');
  assert.ok(listBl.length > 0, 'list-bl présent');
  assert.notDeepStrictEqual(createBl, listBl, 'create-bl et list-bl sont deux lignes distinctes');

  const componentsMd = fs.readFileSync(path.join(outDir, 'code-map-components.md'), 'utf8');
  assert.ok(componentsMd.includes('# Code Map — Composants frontend ('));

  const modulesMd = fs.readFileSync(path.join(outDir, 'code-map-modules.md'), 'utf8');
  assert.ok(modulesMd.includes('# Code Map — Modules lib ('));

  for (const name of ['code-map-actions.md', 'code-map-components.md', 'code-map-modules.md']) {
    const content = fs.readFileSync(path.join(outDir, name), 'utf8');
    assert.ok(content.startsWith('<!-- GENERATED FILE'), `${name}: bandeau GENERATED`);
    assert.ok(/<!-- sourceFingerprint: sha256:[0-9a-f]{16} -->/.test(content), `${name}: fingerprint`);
  }

  const json = JSON.parse(fs.readFileSync(path.join(outDir, 'require-index.json'), 'utf8'));
  assert.strictEqual(json._meta.schemaVersion, 1);
  assert.ok(/^sha256:[0-9a-f]{16}$/.test(json._meta.sourceFingerprint));

  // Cas de validation 1 — require relatif explicite depuis tests/unit
  assert.ok(
    json.index['public/lib/bdcWorkflow.js'].directTests.includes('tests/unit/bdcWorkflow.test.js'),
    'bdcWorkflow.js couvert par son test unitaire'
  );
  // Cas de validation 2 — require('../cors') sans extension
  assert.ok(
    json.index['functions/middleware/cors.js'].directTests.includes(
      'functions/middleware/__tests__/cors.test.js'
    ),
    'cors.js via require(\'../cors\')'
  );
  // Cas de validation 3 — require('..') → index.js
  assert.ok(
    json.index['functions/lib/irrigation/index.js'].directTests.length > 0,
    'irrigation/index.js via require(\'..\')'
  );
  // Cas de validation 4 — transitif seul : atteint via le barrel index.js
  const transitiveOnly = Object.entries(json.index).filter(
    ([, v]) => v.directTests.length === 0 && v.transitiveTests.length > 0
  );
  assert.ok(transitiveOnly.length > 0, 'au moins une cible atteinte uniquement en transitif');

  // transitiveTests est un SURENSEMBLE de directTests, les deux triés
  for (const [target, entry] of Object.entries(json.index)) {
    for (const t of entry.directTests) {
      assert.ok(entry.transitiveTests.includes(t), `${target}: ${t} manquant en transitif`);
    }
    assert.deepStrictEqual(entry.directTests, [...entry.directTests].sort(), `${target}: direct trié`);
    assert.deepStrictEqual(
      entry.transitiveTests,
      [...entry.transitiveTests].sort(),
      `${target}: transitif trié`
    );
  }

  // Les cibles sans aucun test sont présentes avec deux tableaux vides
  assert.strictEqual(
    Object.keys(json.index).length,
    json._meta.stats.targetFiles,
    'toutes les cibles sont indexées, y compris celles sans test'
  );
  assert.ok(
    json._meta.stats.targetFilesWithTransitiveTests >= json._meta.stats.targetFilesWithDirectTests,
    'stats transitives >= stats directes'
  );

  fs.rmSync(outDir, { recursive: true, force: true });
});

test('TARGET_TREES existent sur disque', () => {
  for (const tree of TARGET_TREES) {
    assert.ok(fs.existsSync(path.join(ROOT, tree)), `${tree} doit exister`);
  }
});
