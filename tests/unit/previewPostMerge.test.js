'use strict';

/**
 * Verrou du mode `scripts/preview.sh --post-merge`.
 *
 * POURQUOI CE MODE EXISTE
 * -----------------------
 * Un canal de preview sert le nouveau FRONTEND mais appelle les Cloud Functions
 * de PRODUCTION. Sur un lot mixte back+front, l'ordre correct est donc :
 * merge → `scripts/deploy.sh functions` → canal QA → validation visuelle →
 * `scripts/deploy.sh hosting`. Le merge PRÉCÈDE le preview, et le mode normal de
 * preview.sh refuse exactement ça (branche = main, branche déjà mergée).
 *
 * CE QUE CE FICHIER PROUVE
 * ------------------------
 *   1. les 4 refus du mode --post-merge (branche ≠ main, tree sale, main en
 *      retard sur le remote, functions de prod en retard sur HEAD) — plus les
 *      runs qui NE PROUVENT RIEN (`--dry-run`, deploy partiel, run antérieur à
 *      la convention `run-name`), et sa mutation ;
 *   2. le chemin nominal : canal `qa-test`, surchargeable, projet correct —
 *      vérifié sur les ARGUMENTS réellement passés à `firebase` ;
 *   3. la NON-RÉGRESSION du mode normal : il refuse toujours main et une
 *      branche déjà mergée, et déploie toujours le canal = branche slugifiée.
 *
 * FORME (même modèle que tests/unit/previewExitCode.test.js)
 * ---------------------------------------------------------
 * `node:test` natif pilotant un vrai bash via `spawnSync`, dans un bac à sable
 * `mktemp -d` : copie du VRAI scripts/preview.sh (+ deploy-context.js et sa lib,
 * puisque le garde-fou « functions à jour » s'appuie dessus), faux repo git avec
 * un vrai remote bare, faux `.env`, et des stubs `npm`/`firebase`/`gh` en tête de
 * PATH. → aucun appel réseau, aucun credential, AUCUN deploy réel.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');

const GIT_OK =
  process.platform !== 'win32' &&
  spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const SKIP = GIT_OK ? false : 'nécessite git et un shell POSIX';

const FAKE_TOKEN = 'fake-token-not-a-secret';
const STUB_URL = 'https://berrygood-farms-dashboard--qa-test-abc123.web.app';
const PROJECT = 'berrygood-farms-dashboard';

// Ancre de progression : écrite par preview.sh juste avant l'appel firebase.
// Sans elle, un refus ajouté plus tôt ferait passer un cas au vert pour la
// mauvaise raison.
const DEPLOY_REACHED = /déploiement hosting sur le canal/;

const GIT_FLAGS = [
  '-c', 'user.name=preview-test',
  '-c', 'user.email=preview-test@example.invalid',
  '-c', 'commit.gpgsign=false',
];

function git(cwd, args) {
  const res = spawnSync('git', [...GIT_FLAGS, '-C', cwd, ...args], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} a échoué : ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

function sha(root, rev) {
  return git(root, ['rev-parse', rev]).trim();
}

function writeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

/**
 * Bac à sable hermétique.
 *
 * Historique du faux repo (main) :
 *   C1 init             → base
 *   C2 touche functions/ → SHA_FUNCTIONS
 *   C3 touche public/    → HEAD
 * Ces trois commits suffisent à distinguer « prod en retard sur HEAD » (le
 * dernier deploy pointe sur C1, donc functions/ a bougé depuis) de « prod
 * différente de HEAD mais fonctionnellement à jour » (deploy sur C2 : seul le
 * frontend a bougé depuis).
 *
 * @param {import('node:test').TestContext} t
 * @param {object} [opts]
 * @param {'head'|'functions'|'base'|'unknown'|'unavailable'} [opts.ghDeploy='head']
 *        ce que le stub `gh` désigne comme dernier deploy functions réussi
 * @param {'real'|'dry'|'partial'|'legacy'} [opts.ghRunName='real']
 *        nature du run, lisible UNIQUEMENT dans le `run-name` (les inputs d'un
 *        workflow_dispatch ne sont pas exposés par `gh run list --json`)
 * @param {boolean} [opts.dirty=false]        salir le working tree
 * @param {boolean} [opts.diverged=false]     avancer main localement sans pousser
 * @param {'main'|'feature'|'merged'} [opts.checkout='main']
 * @param {boolean} [opts.qaFails=false]      stub `npm` en échec (npm run qa rouge)
 * @param {boolean} [opts.sabotageDryRunGuard=false]
 *        neutralise le filtre realDeployOnly dans la copie de deployTransparency.js
 *        (méta-test : prouve que le verrou dry-run PEUT rougir)
 */
function makeSandbox(t, opts) {
  const {
    ghDeploy = 'head',
    ghRunName = 'real',
    dirty = false,
    diverged = false,
    checkout = 'main',
    qaFails = false,
    sabotageDryRunGuard = false,
  } = opts || {};

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-post-merge-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo');
  fs.mkdirSync(root);

  // 1. Copie des VRAIS scripts (pas de copie figée : une régression doit rougir).
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'));
  fs.copyFileSync(path.join(SCRIPTS, 'preview.sh'), path.join(root, 'scripts', 'preview.sh'));
  fs.chmodSync(path.join(root, 'scripts', 'preview.sh'), 0o755);
  fs.copyFileSync(
    path.join(SCRIPTS, 'deploy-context.js'),
    path.join(root, 'scripts', 'deploy-context.js')
  );
  let libSrc = fs.readFileSync(path.join(SCRIPTS, 'lib', 'deployTransparency.js'), 'utf8');
  if (sabotageDryRunGuard) {
    const anchor = 'if (realDeployOnly && !isRealFullFunctionsDeploy(run)) return false;';
    assert.ok(
      libSrc.includes(anchor),
      `sabotage impossible : "${anchor}" introuvable dans scripts/lib/deployTransparency.js`
    );
    libSrc = libSrc.replace(anchor, '// [mutation] filtre realDeployOnly neutralisé');
  }
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'deployTransparency.js'), libSrc);

  // 2. Faux projet + .env (committés : sinon le garde-fou « tree propre » les voit).
  fs.writeFileSync(path.join(root, 'firebase.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.env'), `FIREBASE_TOKEN=${FAKE_TOKEN}\n`);
  fs.mkdirSync(path.join(root, 'functions'));
  fs.writeFileSync(path.join(root, 'functions', 'index.js'), 'v1\n');
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'app.js'), 'v1\n');

  // 3. Historique.
  git(root, ['init', '-b', 'main', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const shaBase = sha(root, 'HEAD');

  fs.writeFileSync(path.join(root, 'functions', 'index.js'), 'v2\n');
  git(root, ['add', 'functions/index.js']);
  git(root, ['commit', '-q', '-m', 'backend']);
  const shaFunctions = sha(root, 'HEAD');

  fs.writeFileSync(path.join(root, 'public', 'app.js'), 'v2\n');
  git(root, ['add', 'public/app.js']);
  git(root, ['commit', '-q', '-m', 'frontend']);

  // 4. Remote bare « BERRYGOOD » + push de main : le mode --post-merge fetch.
  const remote = path.join(base, 'remote.git');
  git(root, ['init', '--bare', '-q', '--', remote]);
  git(root, ['remote', 'add', 'BERRYGOOD', remote]);
  git(root, ['push', '-q', 'BERRYGOOD', 'main']);

  // 5. Branches annexes pour la non-régression du mode normal.
  //    « non mergée » exige un commit PROPRE à la branche : une branche posée sur
  //    un ancêtre de main est vue comme déjà mergée par `git branch --merged`.
  git(root, ['checkout', '-q', '-b', 'sb/feature-non-mergee', shaBase]);
  fs.writeFileSync(path.join(root, 'FEATURE.md'), 'feature\n');
  git(root, ['add', 'FEATURE.md']);
  git(root, ['commit', '-q', '-m', 'feature']);
  git(root, ['checkout', '-q', 'main']);
  git(root, ['branch', 'sb/deja-mergee', shaFunctions]); // ancêtre de main = mergée

  if (diverged) {
    // main avance localement APRÈS le push → local ≠ BERRYGOOD/main.
    fs.writeFileSync(path.join(root, 'public', 'app.js'), 'v3\n');
    git(root, ['add', 'public/app.js']);
    git(root, ['commit', '-q', '-m', 'non pousse']);
  }

  if (checkout === 'feature') git(root, ['checkout', '-q', 'sb/feature-non-mergee']);
  if (checkout === 'merged') git(root, ['checkout', '-q', 'sb/deja-mergee']);

  const shaHead = sha(root, 'main');

  if (dirty) fs.writeFileSync(path.join(root, 'public', 'app.js'), 'sale\n');

  // 6. Stubs en tête de PATH.
  const stubs = path.join(base, 'stubs');
  fs.mkdirSync(stubs);
  writeExecutable(
    path.join(stubs, 'npm'),
    qaFails ? '#!/bin/sh\necho "QA GATE: KO" >&2\nexit 1\n' : '#!/bin/sh\nexit 0\n'
  );

  // firebase : journalise ses arguments pour qu'on prouve canal + projet.
  const argsLog = path.join(base, 'firebase-args.txt');
  writeExecutable(
    path.join(stubs, 'firebase'),
    '#!/bin/sh\n' +
      `printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}\n` +
      `echo "✔  hosting:channel: Channel URL: ${STUB_URL} [expires 2026-09-01]"\n` +
      'exit 0\n'
  );

  // gh : `--version` + `run list --json …`. Le SHA rendu pilote le garde-fou.
  const ghSha = {
    head: shaHead,
    functions: shaFunctions,
    base: shaBase,
    unknown: 'ffffffffffffffffffffffffffffffffffffffff',
  }[ghDeploy];
  if (ghDeploy === 'unavailable') {
    writeExecutable(path.join(stubs, 'gh'), '#!/bin/sh\necho "gh: not available" >&2\nexit 1\n');
  } else {
    assert.ok(ghSha, `ghDeploy inconnu : ${ghDeploy}`);
    // Le `run-name` est le SEUL champ qui distingue un vrai deploy d'une
    // simulation : `gh run list --json` n'expose pas les inputs du dispatch, et
    // un run --dry-run réussit intégralement, tous les steps verts.
    const displayTitle = {
      real: 'Deploy prod functions (dry_run=false, only=functions)',
      dry: 'Deploy prod functions (dry_run=true, only=functions)',
      partial: 'Deploy prod functions (dry_run=false, only=functions:health)',
      legacy: 'Deploy prod (functions)', // runs antérieurs à la convention run-name
    }[ghRunName];
    assert.ok(displayTitle, `ghRunName inconnu : ${ghRunName}`);
    const runJson = JSON.stringify([
      {
        databaseId: 1,
        status: 'completed',
        conclusion: 'success',
        headSha: ghSha,
        createdAt: '2026-08-27T10:00:00Z',
        displayTitle: displayTitle,
      },
    ]);
    writeExecutable(
      path.join(stubs, 'gh'),
      '#!/bin/sh\n' +
        'case "$1" in\n' +
        '  --version) echo "gh version 2.0.0"; exit 0 ;;\n' +
        `  run) cat <<'JSON'\n${runJson}\nJSON\n  exit 0 ;;\n` +
        'esac\nexit 0\n'
    );
  }

  return { root, stubs, argsLog, shaBase, shaFunctions, shaHead };
}

/** Lance preview.sh SANS PIPE (cf. previewExitCode.test.js). */
function runPreview(sandbox, args) {
  const env = { ...process.env, PATH: `${sandbox.stubs}:${process.env.PATH}` };
  delete env.FIREBASE_TOKEN; // jamais le vrai token de la machine dans le bac à sable
  const res = spawnSync('bash', [path.join(sandbox.root, 'scripts', 'preview.sh'), ...(args || [])], {
    cwd: sandbox.root,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function firebaseArgs(sandbox) {
  if (!fs.existsSync(sandbox.argsLog)) return null;
  return fs.readFileSync(sandbox.argsLog, 'utf8').trim().split('\n');
}

// ---------------------------------------------------------------------------
// Les 4 refus du mode --post-merge
// ---------------------------------------------------------------------------

test('--post-merge depuis une feature branch → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { checkout: 'feature' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /--post-merge.*depuis 'main'|ce mode déploie le canal QA depuis 'main'/);
  assert.match(res.stderr, /sb\/feature-non-mergee/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null, 'firebase ne doit PAS être appelé');
});

test('--post-merge avec un working tree sale → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { dirty: true });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /working tree NON propre/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('--post-merge avec main en retard sur le remote → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { diverged: true });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /main local .* ≠ BERRYGOOD\/main/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('--post-merge avec les functions de prod en retard sur HEAD → refus', { skip: SKIP }, (t) => {
  // Le dernier deploy functions pointe sur C1 ; functions/ a bougé en C2.
  const sandbox = makeSandbox(t, { ghDeploy: 'base' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /functions déployées en prod sont EN RETARD sur HEAD/);
  assert.match(res.stderr, /scripts\/deploy\.sh functions/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null, 'firebase ne doit PAS être appelé');
});

// ---------------------------------------------------------------------------
// Le run --dry-run : le faux vert le plus dangereux.
// `scripts/deploy.sh functions --dry-run` produit un run qui RÉUSSIT
// intégralement (tous les steps verts) sans rien déployer, avec headSha = HEAD.
// Sans lecture du run-name, le garde-fou afficherait « ✓ functions prod == HEAD »
// et cautionnerait un frontend neuf validé contre l'ANCIEN backend.
// ---------------------------------------------------------------------------

test('--post-merge : un run --dry-run ne compte PAS comme un deploy → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { ghDeploy: 'head', ghRunName: 'dry' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assert.match(res.stderr, /dernier deploy functions RÉEL/);
  assert.match(res.stderr, /dry-run/);
  // Le pire symptôme : ne JAMAIS affirmer que le backend est à HEAD.
  assert.doesNotMatch(res.stdout, /functions prod == HEAD/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null, 'firebase ne doit PAS être appelé');
});

test('--post-merge : un deploy partiel functions:<fn> ne compte pas → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { ghDeploy: 'head', ghRunName: 'partial' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /dernier deploy functions RÉEL/);
  assert.doesNotMatch(res.stdout, /functions prod == HEAD/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('--post-merge : un run antérieur à la convention run-name ne compte pas → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { ghDeploy: 'head', ghRunName: 'legacy' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /dernier deploy functions RÉEL/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

// Méta-test : un verrou qui ne peut pas rougir ne vaut rien. On neutralise le
// filtre `realDeployOnly` dans la copie de la lib et on vérifie que le cas
// dry-run ci-dessus passe alors — c'est-à-dire que le test le détecterait.
test('méta — filtre dry-run neutralisé : le run --dry-run passe pour un deploy', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {
    ghDeploy: 'head',
    ghRunName: 'dry',
    sabotageDryRunGuard: true,
  });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.strictEqual(
    res.status,
    0,
    'la mutation ne rend plus le dry-run acceptable : le méta-test ne prouve plus ' +
      `rien, revoir makeSandbox({ sabotageDryRunGuard: true })\n${res.stderr}`
  );
  // Exactement le faux vert que le garde-fou empêche en temps normal.
  assert.match(res.stdout, /functions prod == HEAD/);
  assert.match(res.stdout, DEPLOY_REACHED);
});

// ---------------------------------------------------------------------------
// Refus adjacents : fail-closed
// ---------------------------------------------------------------------------

test('npm run qa rouge → refus avant tout deploy', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { qaFails: true });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /npm run qa a échoué/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null);
});


test('--post-merge sans information sur le dernier deploy (gh KO) → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { ghDeploy: 'unavailable' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /impossible de déterminer le dernier deploy functions/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('--post-merge avec un commit déployé absent du dépôt local → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { ghDeploy: 'unknown' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /absent du dépôt local/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

// ---------------------------------------------------------------------------
// Chemin nominal
// ---------------------------------------------------------------------------

test('--post-merge nominal → canal qa-test, projet correct, PREVIEW_URL', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { ghDeploy: 'head' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, DEPLOY_REACHED);
  assert.ok(res.stdout.includes(`PREVIEW_URL=${STUB_URL}\n`), `stdout :\n${res.stdout}`);

  const args = firebaseArgs(sandbox);
  assert.ok(args, 'firebase aurait dû être appelé');
  assert.ok(args.includes('hosting:channel:deploy'), `args : ${JSON.stringify(args)}`);
  assert.strictEqual(
    args[args.indexOf('hosting:channel:deploy') + 1],
    'qa-test',
    `canal attendu 'qa-test', args : ${JSON.stringify(args)}`
  );
  assert.strictEqual(args[args.indexOf('--project') + 1], PROJECT);
  assert.ok(args.includes('--non-interactive'));
  // Le --config doit rester : sans lui firebase résout firebase.json depuis le
  // cwd de l'appelant, pas depuis le checkout vérifié par les garde-fous.
  assert.ok(args.includes('--config'), `--config absent : ${JSON.stringify(args)}`);
});

test('--post-merge accepte un backend différent de HEAD si functions/ est inchangé', { skip: SKIP }, (t) => {
  // Dernier deploy sur C2 ; seul le frontend (C3) a bougé depuis → backend bon.
  const sandbox = makeSandbox(t, { ghDeploy: 'functions' });
  const res = runPreview(sandbox, ['--post-merge']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, /functions\/ inchangé jusqu'à HEAD/);
  assert.ok(res.stdout.includes(`PREVIEW_URL=${STUB_URL}\n`));
});

test('--post-merge accepte un nom de canal en argument (slugifié)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { ghDeploy: 'head' });
  const res = runPreview(sandbox, ['--post-merge', 'QA_Lot Mixte']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  const args = firebaseArgs(sandbox);
  assert.strictEqual(args[args.indexOf('hosting:channel:deploy') + 1], 'qa-lot-mixte');
});

// ---------------------------------------------------------------------------
// NON-RÉGRESSION du mode normal (sans --post-merge)
// ---------------------------------------------------------------------------

test('mode normal depuis main → refus (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runPreview(sandbox, []);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /preview interdit depuis main/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('mode normal depuis une branche déjà mergée → refus (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { checkout: 'merged' });
  const res = runPreview(sandbox, []);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /est déjà mergée dans main/);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('mode normal sur feature branch → canal = branche slugifiée (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { checkout: 'feature' });
  const res = runPreview(sandbox, []);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  const args = firebaseArgs(sandbox);
  assert.strictEqual(args[args.indexOf('hosting:channel:deploy') + 1], 'sb-feature-non-mergee');
  assert.ok(res.stdout.includes(`PREVIEW_URL=${STUB_URL}\n`));
});

test('mode normal : un nom de canal en argument est refusé', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { checkout: 'feature' });
  const res = runPreview(sandbox, ['mon-canal']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /n'est acceptable qu'en mode --post-merge/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('option inconnue → refus avant tout deploy', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runPreview(sandbox, ['--postmerge']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /option inconnue/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});
