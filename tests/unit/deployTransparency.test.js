'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  selectLastSuccessfulRun,
  parseDeployRunName,
  isRealFullFunctionsDeploy,
  shortenSha,
  buildHostingReleaseMessage,
  parseHostingReleaseMessage,
  extractOriginLabel,
  buildDelta,
  formatInstant,
  formatDeployBlock,
} = require('../../scripts/lib/deployTransparency');

// ---------------------------------------------------------------------------
// selectLastSuccessfulRun
// ---------------------------------------------------------------------------

const RUNS = [
  { databaseId: 3, status: 'completed', conclusion: 'success', headSha: 'ccccccc111', createdAt: '2026-08-26T11:54:18Z' },
  { databaseId: 2, status: 'completed', conclusion: 'success', headSha: 'bbbbbbb222', createdAt: '2026-08-26T11:44:34Z' },
  { databaseId: 1, status: 'completed', conclusion: 'failure', headSha: 'aaaaaaa333', createdAt: '2026-08-26T10:41:09Z' },
];

test('selectLastSuccessfulRun retient le run réussi le plus récent', () => {
  const run = selectLastSuccessfulRun(RUNS);
  assert.strictEqual(run.databaseId, 3);
  assert.strictEqual(run.headSha, 'ccccccc111');
});

test('selectLastSuccessfulRun ignore les runs en échec', () => {
  const run = selectLastSuccessfulRun([RUNS[2]]);
  assert.strictEqual(run, null);
});

test('selectLastSuccessfulRun ignore les runs non terminés (in_progress)', () => {
  const runs = [
    { databaseId: 9, status: 'in_progress', conclusion: null, headSha: 'ddddddd', createdAt: '2026-08-26T12:00:00Z' },
    RUNS[1],
  ];
  const run = selectLastSuccessfulRun(runs);
  assert.strictEqual(run.databaseId, 2, 'un run en cours ne prouve rien sur ce qui est live');
});

test('selectLastSuccessfulRun ignore un run non terminé même s\'il s\'annonce success', () => {
  // Garde défensive : une réponse gh incohérente (conclusion posée avant la fin
  // du run) ne doit pas faire passer un déploiement en cours pour du live.
  const runs = [
    { databaseId: 9, status: 'in_progress', conclusion: 'success', headSha: 'ddddddd', createdAt: '2026-08-26T12:00:00Z' },
    RUNS[1],
  ];
  assert.strictEqual(selectLastSuccessfulRun(runs).databaseId, 2);
});

test('selectLastSuccessfulRun exclut le run qu\'on vient de déclencher', () => {
  const run = selectLastSuccessfulRun(RUNS, { excludeRunIds: [3] });
  assert.strictEqual(run.databaseId, 2);
});

test('selectLastSuccessfulRun compare les ids exclus en chaîne (id numérique vs string)', () => {
  const run = selectLastSuccessfulRun(RUNS, { excludeRunIds: ['3'] });
  assert.strictEqual(run.databaseId, 2);
});

test('selectLastSuccessfulRun trie par date, pas par position dans le tableau', () => {
  const desordre = [RUNS[1], RUNS[0]];
  const run = selectLastSuccessfulRun(desordre);
  assert.strictEqual(run.databaseId, 3, 'le plus récent par createdAt doit gagner');
});

test('selectLastSuccessfulRun ignore un run réussi sans headSha (inexploitable)', () => {
  const run = selectLastSuccessfulRun([
    { databaseId: 7, status: 'completed', conclusion: 'success', createdAt: '2026-08-26T12:00:00Z' },
    RUNS[1],
  ]);
  assert.strictEqual(run.databaseId, 2);
});

test('selectLastSuccessfulRun tolère une entrée non exploitable et une entrée non tableau', () => {
  assert.strictEqual(selectLastSuccessfulRun(null), null);
  assert.strictEqual(selectLastSuccessfulRun('boom'), null);
  assert.strictEqual(selectLastSuccessfulRun([]), null);
  assert.strictEqual(selectLastSuccessfulRun([null, undefined, 42]), null);
});

// ---------------------------------------------------------------------------
// parseDeployRunName / isRealFullFunctionsDeploy / option realDeployOnly
//
// POURQUOI : `gh run list --json` n'expose pas les `inputs` d'un
// workflow_dispatch. Un run `dry_run=true` (le DÉFAUT de deploy-prod.yml)
// réussit intégralement sans rien déployer, et `only=functions:<fn>` ne déploie
// qu'une function. Le `run-name` est le seul champ qui les distingue.
// ---------------------------------------------------------------------------

const RUN_REAL = 'Deploy prod functions (dry_run=false, only=functions)';
const RUN_DRY = 'Deploy prod functions (dry_run=true, only=functions)';
const RUN_PARTIAL = 'Deploy prod functions (dry_run=false, only=functions:health)';
const RUN_LEGACY = 'Deploy prod (functions)';

test('parseDeployRunName lit dry_run et only', () => {
  assert.deepStrictEqual(parseDeployRunName(RUN_REAL), { dryRun: false, only: 'functions' });
  assert.deepStrictEqual(parseDeployRunName(RUN_DRY), { dryRun: true, only: 'functions' });
  assert.deepStrictEqual(parseDeployRunName(RUN_PARTIAL), {
    dryRun: false,
    only: 'functions:health',
  });
});

test('parseDeployRunName rend null sur un titre hors convention', () => {
  assert.strictEqual(parseDeployRunName(RUN_LEGACY), null);
  assert.strictEqual(parseDeployRunName(''), null);
  assert.strictEqual(parseDeployRunName(null), null);
  assert.strictEqual(parseDeployRunName(undefined), null);
  assert.strictEqual(parseDeployRunName(42), null);
  // Regex ancrée : pas de match partiel dans une chaîne plus large.
  assert.strictEqual(parseDeployRunName('x ' + RUN_REAL), null);
  assert.strictEqual(parseDeployRunName(RUN_REAL + ' (bis)'), null);
});

test('parseDeployRunName ne se laisse pas fabriquer un faux titre via `only`', () => {
  // `only` est une chaîne libre au dispatch, et le run-name est évalué AVANT le
  // garde-fou de cible du workflow. Un `only` contenant une parenthèse ne doit
  // pas pouvoir produire un nom qui parse.
  assert.strictEqual(
    parseDeployRunName('Deploy prod functions (dry_run=true, only=functions) (dry_run=false, only=functions)'),
    null
  );
  assert.strictEqual(parseDeployRunName('Deploy prod functions (dry_run=false, only=functions))'), null);
});

test('isRealFullFunctionsDeploy : seul un vrai deploy de TOUT functions/ compte', () => {
  const mk = (title) => ({ displayTitle: title });
  assert.strictEqual(isRealFullFunctionsDeploy(mk(RUN_REAL)), true);
  assert.strictEqual(isRealFullFunctionsDeploy(mk(RUN_DRY)), false, 'simulation : rien de déployé');
  assert.strictEqual(isRealFullFunctionsDeploy(mk(RUN_PARTIAL)), false, 'une seule function');
  // Fail-closed : un run antérieur à la convention ne prouve rien.
  assert.strictEqual(isRealFullFunctionsDeploy(mk(RUN_LEGACY)), false);
  assert.strictEqual(isRealFullFunctionsDeploy(null), false);
  assert.strictEqual(isRealFullFunctionsDeploy('boom'), false);
});

test('selectLastSuccessfulRun({realDeployOnly}) écarte dry-run, partiel et legacy', () => {
  const runs = [
    { databaseId: 4, status: 'completed', conclusion: 'success', headSha: 'ddd', createdAt: '2026-08-27T12:00:00Z', displayTitle: RUN_DRY },
    { databaseId: 3, status: 'completed', conclusion: 'success', headSha: 'ccc', createdAt: '2026-08-27T11:00:00Z', displayTitle: RUN_PARTIAL },
    { databaseId: 2, status: 'completed', conclusion: 'success', headSha: 'bbb', createdAt: '2026-08-27T10:00:00Z', displayTitle: RUN_LEGACY },
    { databaseId: 1, status: 'completed', conclusion: 'success', headSha: 'aaa', createdAt: '2026-08-27T09:00:00Z', displayTitle: RUN_REAL },
  ];
  assert.strictEqual(
    selectLastSuccessfulRun(runs, { realDeployOnly: true }).databaseId,
    1,
    'le seul run qui a réellement déployé tout functions/'
  );
  assert.strictEqual(selectLastSuccessfulRun(runs, { realDeployOnly: true, excludeRunIds: [1] }), null);
});

test('selectLastSuccessfulRun : realDeployOnly est OPT-IN (affichage deploy.sh inchangé)', () => {
  // NON-RÉGRESSION : scripts/deploy.sh appelle sans option et doit continuer à
  // voir le dernier run réussi, run-name ou pas.
  const runs = [
    { databaseId: 4, status: 'completed', conclusion: 'success', headSha: 'ddd', createdAt: '2026-08-27T12:00:00Z', displayTitle: RUN_DRY },
    { databaseId: 1, status: 'completed', conclusion: 'success', headSha: 'aaa', createdAt: '2026-08-27T09:00:00Z', displayTitle: RUN_REAL },
  ];
  assert.strictEqual(selectLastSuccessfulRun(runs).databaseId, 4);
  assert.strictEqual(selectLastSuccessfulRun(runs, {}).databaseId, 4);
  assert.strictEqual(selectLastSuccessfulRun(runs, { realDeployOnly: false }).databaseId, 4);
  // Et les runs SANS displayTitle (jeu RUNS historique) restent sélectionnables.
  assert.strictEqual(selectLastSuccessfulRun(RUNS).databaseId, 3);
});

// ---------------------------------------------------------------------------
// shortenSha / message de release hosting
// ---------------------------------------------------------------------------

test('shortenSha rend 7 caractères', () => {
  assert.strictEqual(shortenSha('0dd5a56bebb5f5a0cda60d6782dae0a6e0836789'), '0dd5a56');
  assert.strictEqual(shortenSha('  0dd5a56  '), '0dd5a56');
  assert.strictEqual(shortenSha(''), '');
  assert.strictEqual(shortenSha(null), '');
  assert.strictEqual(shortenSha(undefined), '');
});

test('buildHostingReleaseMessage encode « <sha> <sujet> »', () => {
  assert.strictEqual(
    buildHostingReleaseMessage('0dd5a56bebb5f5a0', 'feat(caisse): filtres (#321)'),
    '0dd5a56 feat(caisse): filtres (#321)'
  );
});

test('buildHostingReleaseMessage aplatit les retours à la ligne du sujet', () => {
  assert.strictEqual(buildHostingReleaseMessage('abc1234', 'fix:\n  X\ty'), 'abc1234 fix: X y');
});

test('buildHostingReleaseMessage sans sujet ne laisse pas d\'espace parasite', () => {
  assert.strictEqual(buildHostingReleaseMessage('abc1234', ''), 'abc1234');
  assert.strictEqual(buildHostingReleaseMessage('abc1234'), 'abc1234');
});

test('buildHostingReleaseMessage sans sha rend le sujet seul', () => {
  assert.strictEqual(buildHostingReleaseMessage('', 'fix: X'), 'fix: X');
});

test('parseHostingReleaseMessage relit ce que buildHostingReleaseMessage écrit', () => {
  const msg = buildHostingReleaseMessage('0dd5a56bebb', 'feat: X (#12)');
  assert.deepStrictEqual(parseHostingReleaseMessage(msg), {
    sha: '0dd5a56',
    subject: 'feat: X (#12)',
  });
});

test('parseHostingReleaseMessage accepte un sha seul', () => {
  assert.deepStrictEqual(parseHostingReleaseMessage('0dd5a56'), { sha: '0dd5a56', subject: null });
});

test('parseHostingReleaseMessage refuse un message sans sha en tête', () => {
  assert.strictEqual(parseHostingReleaseMessage('deploy manuel depuis la console'), null);
  assert.strictEqual(parseHostingReleaseMessage('abc12 trop court'), null);
  assert.strictEqual(parseHostingReleaseMessage(''), null);
  assert.strictEqual(parseHostingReleaseMessage(null), null);
  assert.strictEqual(parseHostingReleaseMessage(undefined), null);
});

test('parseHostingReleaseMessage n\'invente pas un sha trouvé au milieu du message', () => {
  // Un deploy fait à la main (« rollback vers 0dd5a56 ») ne doit pas être lu
  // comme un deploy de ce commit : mieux vaut « indisponible » qu'un faux.
  assert.strictEqual(parseHostingReleaseMessage('rollback vers 0dd5a56'), null);
});

test('parseHostingReleaseMessage normalise le sha en minuscules', () => {
  assert.strictEqual(parseHostingReleaseMessage('0DD5A56 feat: X').sha, '0dd5a56');
});

// ---------------------------------------------------------------------------
// extractOriginLabel
// ---------------------------------------------------------------------------

test('extractOriginLabel lit la branche d\'un merge commit GitHub', () => {
  assert.strictEqual(
    extractOriginLabel('Merge pull request #320 from BERRY-GOOD-FARMS/sb/caisse-filtres'),
    'sb/caisse-filtres (PR #320)'
  );
});

test('extractOriginLabel lit la branche d\'un merge local', () => {
  assert.strictEqual(extractOriginLabel("Merge branch 'sb/jour-ferie' into main"), 'sb/jour-ferie');
});

test('extractOriginLabel rend le numéro de PR d\'un squash-merge', () => {
  assert.strictEqual(
    extractOriginLabel('feat(magasinier): scanner des bons (#320)'),
    'PR #320'
  );
});

test('extractOriginLabel ne confond pas un #NNN au milieu du sujet avec une PR', () => {
  assert.strictEqual(extractOriginLabel('fix: ticket (#320) suite au bug'), null);
});

test('extractOriginLabel rend null quand l\'origine est indéterminable', () => {
  assert.strictEqual(extractOriginLabel('chore: bump deps'), null);
  assert.strictEqual(extractOriginLabel(''), null);
  assert.strictEqual(extractOriginLabel(null), null);
  assert.strictEqual(extractOriginLabel(undefined), null);
});

// ---------------------------------------------------------------------------
// buildDelta
// ---------------------------------------------------------------------------

const LAST_DEPLOY = {
  sha: 'bbbbbbb222',
  shortSha: 'bbbbbbb',
  subject: 'fix(caisse): X (#319)',
  at: '2026-08-26T11:44:34Z',
  source: 'gh-run',
};

test('buildDelta : écart vide quand aucun commit depuis le déploiement', () => {
  const delta = buildDelta({ lastDeploy: LAST_DEPLOY, commits: [], currentBranch: 'main' });
  assert.strictEqual(delta.status, 'empty');
  assert.strictEqual(delta.entries.length, 0);
  assert.strictEqual(delta.foreignCount, 0);
  assert.strictEqual(delta.reason, null);
});

test('buildDelta : information indisponible sans dernier déploiement', () => {
  const delta = buildDelta({ lastDeploy: null, commits: [], currentBranch: 'main' });
  assert.strictEqual(delta.status, 'unavailable');
  assert.strictEqual(delta.reason, 'historique introuvable');
});

test('buildDelta : information indisponible quand les commits sont incalculables', () => {
  const delta = buildDelta({
    lastDeploy: LAST_DEPLOY,
    commits: null,
    currentBranch: 'main',
    unavailableReason: 'sha inconnu localement',
  });
  assert.strictEqual(delta.status, 'unavailable');
  assert.strictEqual(delta.reason, 'sha inconnu localement');
  assert.deepStrictEqual(delta.entries, []);
});

test('buildDelta : écart non vide, origine et drapeau « autre branche »', () => {
  const delta = buildDelta({
    lastDeploy: LAST_DEPLOY,
    currentBranch: 'main',
    commits: [
      { shortSha: 'ccc1111', subject: 'Merge pull request #321 from ORG/sb/caisse-pj' },
      { shortSha: 'ddd2222', subject: 'chore: bump deps' },
    ],
  });
  assert.strictEqual(delta.status, 'ahead');
  assert.strictEqual(delta.entries.length, 2);
  assert.strictEqual(delta.entries[0].originLabel, 'sb/caisse-pj (PR #321)');
  assert.strictEqual(delta.entries[0].foreign, true);
  assert.strictEqual(delta.entries[1].originLabel, null);
  assert.strictEqual(delta.entries[1].foreign, false, 'origine inconnue = pas de fausse alerte');
  assert.strictEqual(delta.foreignCount, 1);
});

test('buildDelta : un commit de la branche courante n\'est pas signalé', () => {
  const delta = buildDelta({
    lastDeploy: LAST_DEPLOY,
    currentBranch: 'sb/deploy-transparence',
    commits: [
      { shortSha: 'eee3333', subject: "Merge branch 'sb/deploy-transparence' into main" },
      { shortSha: 'fff4444', subject: 'Merge pull request #9 from ORG/sb/deploy-transparence' },
    ],
  });
  assert.strictEqual(delta.foreignCount, 0);
  assert.strictEqual(delta.entries[0].foreign, false);
  assert.strictEqual(delta.entries[1].foreign, false, 'le suffixe (PR #n) ne doit pas casser la comparaison');
});

test('buildDelta : préserve l\'ordre des commits fourni', () => {
  const delta = buildDelta({
    lastDeploy: LAST_DEPLOY,
    currentBranch: 'main',
    commits: [
      { shortSha: 'aaa0001', subject: 'a' },
      { shortSha: 'bbb0002', subject: 'b' },
      { shortSha: 'ccc0003', subject: 'c' },
    ],
  });
  assert.deepStrictEqual(
    delta.entries.map((e) => e.shortSha),
    ['aaa0001', 'bbb0002', 'ccc0003']
  );
});

test('buildDelta : entrée totalement absente = indisponible, pas de throw', () => {
  const delta = buildDelta(null);
  assert.strictEqual(delta.status, 'unavailable');
  assert.strictEqual(delta.foreignCount, 0);
});

// ---------------------------------------------------------------------------
// formatInstant
// ---------------------------------------------------------------------------

test('formatInstant rend une date UTC lisible', () => {
  assert.strictEqual(formatInstant('2026-08-26T11:54:18Z'), '2026-08-26 11:54 UTC');
  assert.strictEqual(formatInstant('2026-01-02T03:04:05Z'), '2026-01-02 03:04 UTC');
});

test('formatInstant convertit bien un décalage horaire en UTC', () => {
  assert.strictEqual(formatInstant('2026-08-26T13:54:18+02:00'), '2026-08-26 11:54 UTC');
});

test('formatInstant dégrade proprement sur une date absente ou illisible', () => {
  assert.strictEqual(formatInstant(null), 'date inconnue');
  assert.strictEqual(formatInstant(''), 'date inconnue');
  assert.strictEqual(formatInstant('pas-une-date'), 'date inconnue');
});

// ---------------------------------------------------------------------------
// formatDeployBlock
// ---------------------------------------------------------------------------

test('formatDeployBlock : écart vide → le dit explicitement', () => {
  const delta = buildDelta({ lastDeploy: LAST_DEPLOY, commits: [], currentBranch: 'main' });
  const out = formatDeployBlock({
    target: 'functions',
    lastDeploy: LAST_DEPLOY,
    delta,
    headShortSha: 'bbbbbbb',
    currentBranch: 'main',
  }).join('\n');
  assert.match(out, /Dernier déploiement functions : bbbbbbb « fix\(caisse\): X \(#319\) » \(2026-08-26 11:44 UTC\)/);
  assert.match(out, /rien de nouveau depuis le dernier déploiement/);
  assert.doesNotMatch(out, /commit\(s\) non déployé/);
});

test('formatDeployBlock : écart non vide → liste sujets, origines et compte', () => {
  const delta = buildDelta({
    lastDeploy: LAST_DEPLOY,
    currentBranch: 'main',
    commits: [
      { shortSha: 'ccc1111', subject: 'Merge pull request #321 from ORG/sb/caisse-pj' },
      { shortSha: 'ddd2222', subject: 'chore: bump deps' },
    ],
  });
  const lines = formatDeployBlock({
    target: 'hosting',
    lastDeploy: LAST_DEPLOY,
    delta,
    headShortSha: 'ddd2222',
    currentBranch: 'main',
  });
  const out = lines.join('\n');
  assert.match(out, /2 commit\(s\) non déployé\(s\)/);
  assert.match(out, /ccc1111 {2}Merge pull request #321 from ORG\/sb\/caisse-pj {3}\[sb\/caisse-pj \(PR #321\)\]/);
  assert.match(out, /ddd2222 {2}chore: bump deps$/m);
  assert.match(out, /⚠ 1 commit\(s\) proviennent d'une autre branche que 'main'/);
  const flagged = lines.filter((l) => l.startsWith('  ⚠ '));
  assert.strictEqual(flagged.length, 1, 'seul le commit d\'une autre branche porte le marqueur');
});

test('formatDeployBlock : aucun commit étranger → pas de ligne d\'avertissement', () => {
  const delta = buildDelta({
    lastDeploy: LAST_DEPLOY,
    currentBranch: 'main',
    commits: [{ shortSha: 'ddd2222', subject: 'chore: bump deps' }],
  });
  const out = formatDeployBlock({
    target: 'functions',
    lastDeploy: LAST_DEPLOY,
    delta,
    headShortSha: 'ddd2222',
    currentBranch: 'main',
  }).join('\n');
  assert.match(out, /1 commit\(s\) non déployé\(s\)/);
  assert.doesNotMatch(out, /proviennent d'une autre branche/);
});

test('formatDeployBlock : dernier déploiement inconnu → « information indisponible » + deploy continue', () => {
  const delta = buildDelta({
    lastDeploy: null,
    commits: null,
    currentBranch: 'main',
    unavailableReason: 'gh indisponible',
  });
  const out = formatDeployBlock({
    target: 'functions',
    lastDeploy: null,
    delta,
    headShortSha: '0dd5a56',
    currentBranch: 'main',
  }).join('\n');
  assert.match(out, /Dernier déploiement functions : information indisponible \(gh indisponible\)/);
  assert.match(out, /le deploy continue/);
  assert.match(out, /Écart avec HEAD \(0dd5a56\) : information indisponible/);
});

test('formatDeployBlock : dernier déploiement connu sans sujet ne rend pas de guillemets vides', () => {
  const ld = { sha: 'abc1234', shortSha: 'abc1234', subject: null, at: '2026-08-26T11:44:34Z', source: 'hosting-release' };
  const delta = buildDelta({ lastDeploy: ld, commits: [], currentBranch: 'main' });
  const out = formatDeployBlock({
    target: 'hosting',
    lastDeploy: ld,
    delta,
    headShortSha: 'abc1234',
    currentBranch: 'main',
  }).join('\n');
  assert.match(out, /Dernier déploiement hosting : abc1234 \(2026-08-26 11:44 UTC\)/);
  assert.doesNotMatch(out, /« »/);
});

test('formatDeployBlock : entrée vide ne throw pas et reste informative', () => {
  const out = formatDeployBlock({}).join('\n');
  assert.match(out, /Transparence/);
  assert.match(out, /information indisponible/);
});
