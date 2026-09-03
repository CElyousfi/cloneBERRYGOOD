'use strict';

/**
 * Verrou de la cible `scripts/deploy.sh rules`.
 *
 * POURQUOI CETTE CIBLE EXISTE
 * ---------------------------
 * `firebase.json` déclare `firestore.rules` et `storage.rules`, mais aucun
 * chemin sanctionné ne savait les déployer : deploy.sh n'acceptait que
 * `hosting` et `functions`, et `.github/workflows/deploy-prod.yml` refuse
 * explicitement toute cible autre que functions. Toute évolution des règles
 * était donc INDÉPLOYABLE sans sortir du process (firebase deploy à la main,
 * sans garde-fou de branche ni de tree propre).
 *
 * CE QUE CE FICHIER PROUVE
 * ------------------------
 *   1. `rules` hérite des MÊMES garde-fous que l'existant : branche = main,
 *      working tree propre, main == BERRYGOOD/main, FIREBASE_TOKEN présent ;
 *   2. les cibles mixtes `rules,hosting` / `rules,functions` sont refusées, et
 *      la détection de cible n'a pas de recouvrement (rules n'attrape pas
 *      hosting, et inversement) ;
 *   3. le chemin nominal appelle `firebase` avec `--only firestore:rules,storage`,
 *      le bon projet et le `--config` qui scope le déploiement sur le checkout ;
 *   4. `--dry-run` est relayé à firebase, exactement comme sur `hosting` ;
 *   5. NON-RÉGRESSION : `hosting` et `functions` se comportent comme avant.
 *
 * FORME (même modèle que tests/unit/previewPostMerge.test.js)
 * ----------------------------------------------------------
 * `node:test` natif pilotant le VRAI scripts/deploy.sh via bash + spawnSync,
 * dans un bac à sable `mktemp -d` : faux repo git avec un vrai remote bare, faux
 * `.env`, et des stubs `firebase`/`gh`/`sleep` en tête de PATH.
 * → aucun appel réseau, aucun credential, AUCUN deploy réel.
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
const PROJECT = 'berrygood-farms-dashboard';
const RULES_ONLY = 'firestore:rules,storage';

const GIT_FLAGS = [
  '-c', 'user.name=deploy-test',
  '-c', 'user.email=deploy-test@example.invalid',
  '-c', 'commit.gpgsign=false',
];

function git(cwd, args) {
  const res = spawnSync('git', [...GIT_FLAGS, '-C', cwd, ...args], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} a échoué : ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

function writeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

/**
 * Bac à sable hermétique.
 *
 * @param {import('node:test').TestContext} t
 * @param {object} [opts]
 * @param {boolean} [opts.dirty=false]      salir le working tree
 * @param {boolean} [opts.diverged=false]   avancer main localement sans pousser
 * @param {'main'|'feature'} [opts.checkout='main']
 * @param {boolean} [opts.noToken=false]    .env sans FIREBASE_TOKEN
 * @param {boolean} [opts.noRulesFiles=false] checkout sans fichiers de règles
 */
function makeSandbox(t, opts) {
  const {
    dirty = false,
    diverged = false,
    checkout = 'main',
    noToken = false,
    noRulesFiles = false,
  } = opts || {};

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-rules-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo');
  fs.mkdirSync(root);

  // 1. Copie des VRAIS scripts (pas de copie figée : une régression doit rougir).
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'));
  fs.copyFileSync(path.join(SCRIPTS, 'deploy.sh'), path.join(root, 'scripts', 'deploy.sh'));
  fs.chmodSync(path.join(root, 'scripts', 'deploy.sh'), 0o755);
  fs.copyFileSync(
    path.join(SCRIPTS, 'deploy-context.js'),
    path.join(root, 'scripts', 'deploy-context.js')
  );
  fs.copyFileSync(
    path.join(SCRIPTS, 'lib', 'deployTransparency.js'),
    path.join(root, 'scripts', 'lib', 'deployTransparency.js')
  );

  // 2. Faux projet + .env (committés : sinon le garde-fou « tree propre » les voit).
  fs.writeFileSync(
    path.join(root, 'firebase.json'),
    JSON.stringify({ firestore: { rules: 'firestore.rules' }, storage: { rules: 'storage.rules' } }) + '\n'
  );
  fs.writeFileSync(path.join(root, '.env'), noToken ? '\n' : `FIREBASE_TOKEN=${FAKE_TOKEN}\n`);
  if (!noRulesFiles) {
    fs.writeFileSync(path.join(root, 'firestore.rules'), "rules_version = '2';\n// v1\n");
    fs.writeFileSync(path.join(root, 'storage.rules'), "rules_version = '2';\n// v1\n");
  }
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'app.js'), 'v1\n');
  // Le chemin hosting lance tests/smoke-test.js après le deploy : version inerte.
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'tests', 'smoke-test.js'), 'console.log("smoke stub OK");\n');

  // 3. Historique + remote bare « BERRYGOOD » (le garde-fou (c) fetch dessus).
  git(root, ['init', '-b', 'main', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  if (!noRulesFiles) {
    fs.writeFileSync(path.join(root, 'firestore.rules'), "rules_version = '2';\n// v2\n");
    git(root, ['add', 'firestore.rules']);
    git(root, ['commit', '-q', '-m', 'feat(rules): pièce jointe émargement']);
  }
  const remote = path.join(base, 'remote.git');
  git(root, ['init', '--bare', '-q', '--', remote]);
  git(root, ['remote', 'add', 'BERRYGOOD', remote]);
  git(root, ['push', '-q', 'BERRYGOOD', 'main']);

  git(root, ['branch', 'sb/feature-rules']);

  if (diverged) {
    // main avance localement APRÈS le push → local ≠ BERRYGOOD/main.
    fs.writeFileSync(path.join(root, 'public', 'app.js'), 'v3\n');
    git(root, ['add', 'public/app.js']);
    git(root, ['commit', '-q', '-m', 'non pousse']);
  }
  if (checkout === 'feature') git(root, ['checkout', '-q', 'sb/feature-rules']);

  const headSha = git(root, ['rev-parse', 'HEAD']).trim();

  if (dirty) fs.writeFileSync(path.join(root, 'public', 'app.js'), 'sale\n');

  // 4. Stubs en tête de PATH.
  const stubs = path.join(base, 'stubs');
  fs.mkdirSync(stubs);

  // firebase : journalise ses arguments — c'est la preuve de ce qui aurait été déployé.
  const argsLog = path.join(base, 'firebase-args.txt');
  writeExecutable(
    path.join(stubs, 'firebase'),
    '#!/bin/sh\n' +
      `printf '%s\\n' "$@" > ${JSON.stringify(argsLog)}\n` +
      'echo "✔  Deploy complete!"\n' +
      'exit 0\n'
  );

  // gh : --version / auth status / run list (transparence) / workflow run (dispatch).
  const ghLog = path.join(base, 'gh-args.txt');
  const runJson = JSON.stringify([
    {
      databaseId: 1,
      status: 'completed',
      conclusion: 'success',
      headSha: headSha,
      createdAt: '2026-09-01T10:00:00Z',
      displayTitle: 'Deploy prod functions (dry_run=false, only=functions)',
    },
  ]);
  writeExecutable(
    path.join(stubs, 'gh'),
    '#!/bin/sh\n' +
      'case "$1" in\n' +
      '  --version) echo "gh version 2.0.0"; exit 0 ;;\n' +
      '  auth) exit 0 ;;\n' +
      `  run) cat <<'JSON'\n${runJson}\nJSON\n  exit 0 ;;\n` +
      `  workflow) printf '%s\\n' "$@" > ${JSON.stringify(ghLog)}; exit 0 ;;\n` +
      'esac\nexit 0\n'
  );

  // sleep : le smoke post-deploy hosting attend 15 s de propagation — inutile ici.
  writeExecutable(path.join(stubs, 'sleep'), '#!/bin/sh\nexit 0\n');

  return { root, stubs, argsLog, ghLog, headSha };
}

/** Lance deploy.sh SANS PIPE (cf. previewExitCode.test.js : un pipe masque le code de sortie). */
function runDeploy(sandbox, args) {
  const env = { ...process.env, PATH: `${sandbox.stubs}:${process.env.PATH}` };
  delete env.FIREBASE_TOKEN; // jamais le vrai token de la machine dans le bac à sable
  const res = spawnSync('bash', [path.join(sandbox.root, 'scripts', 'deploy.sh'), ...(args || [])], {
    cwd: sandbox.root,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function readLog(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim().split('\n');
}

const firebaseArgs = (s) => readLog(s.argsLog);
const ghArgs = (s) => readLog(s.ghLog);

// ---------------------------------------------------------------------------
// rules — garde-fous anti-divergence (mêmes que hosting/functions)
// ---------------------------------------------------------------------------

test('rules depuis une feature branch → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { checkout: 'feature' });
  const res = runDeploy(sandbox, ['rules']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /RÈGLE 1.*deploy autorisé UNIQUEMENT depuis 'main'/s);
  assert.match(res.stderr, /sb\/feature-rules/);
  assert.strictEqual(firebaseArgs(sandbox), null, 'firebase ne doit PAS être appelé');
});

test('rules avec un working tree sale → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { dirty: true });
  const res = runDeploy(sandbox, ['rules']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /working tree NON propre/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('rules avec main en retard sur le remote → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { diverged: true });
  const res = runDeploy(sandbox, ['rules']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /main local .* ≠ BERRYGOOD\/main/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('rules sans FIREBASE_TOKEN → refus (comme hosting)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { noToken: true });
  const res = runDeploy(sandbox, ['rules']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /FIREBASE_TOKEN absent de \.env/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

// ---------------------------------------------------------------------------
// Cibles mixtes : refus, et pas de recouvrement entre les motifs de détection
// ---------------------------------------------------------------------------

test('cible mixte rules,hosting → refus', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['rules,hosting']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /cible mixte 'rules,hosting' refusée/);
  assert.match(res.stderr, /'rules' se déploie SEUL/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('cible mixte rules,functions → refus (et aucun run CI déclenché)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['rules,functions']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /cible mixte 'rules,functions' refusée/);
  assert.strictEqual(firebaseArgs(sandbox), null);
  assert.strictEqual(ghArgs(sandbox), null, 'aucun workflow ne doit être déclenché');
});

test('cible inconnue → refus, et le message cite les trois cibles', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['firestore']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /cible 'firestore' non reconnue/);
  assert.match(res.stderr, /'rules'/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('functions:rulesEngine passe par le chemin functions (pas de match sur « rules »)', { skip: SKIP }, (t) => {
  // Une détection par sous-chaîne posait R=1 ici et sortait sur « rules se déploie
  // SEUL » : un refus abusif au message trompeur. La reconnaissance se fait sur le
  // SEGMENT entier, pas sur ce qu'il contient.
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['functions:rulesEngine']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  assert.doesNotMatch(res.stderr, /se déploie SEUL/);
  const gh = ghArgs(sandbox);
  assert.ok(gh, 'gh workflow run aurait dû être appelé');
  assert.ok(gh.includes('only=functions:rulesEngine'), `args gh : ${JSON.stringify(gh)}`);
  assert.strictEqual(firebaseArgs(sandbox), null, 'aucun deploy local sur le chemin functions');
});

test('hosting:mon-site passe par le chemin hosting (préfixe explicite)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['hosting:mon-site']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  const args = firebaseArgs(sandbox);
  assert.strictEqual(args[args.indexOf('--only') + 1], 'hosting:mon-site');
});

test('la casse compte : « Rules » et « RULES » sont des cibles inconnues', { skip: SKIP }, (t) => {
  for (const target of ['Rules', 'RULES']) {
    const sandbox = makeSandbox(t, {});
    const res = runDeploy(sandbox, [target]);

    assert.notStrictEqual(res.status, 0, `'${target}' aurait dû être refusé`);
    assert.match(res.stderr, new RegExp(`cible '${target}' non reconnue`));
    assert.strictEqual(firebaseArgs(sandbox), null);
  }
});

test('firestore:rules n\'est PAS un alias : refus + renvoi vers la cible rules', { skip: SKIP }, (t) => {
  // Refusé délibérément : la cible `rules` envoie firestore:rules ET storage, donc
  // plus large que ce que `firestore:rules` demande. Accepter l'alias ferait partir
  // les règles Storage à l'insu de l'opérateur.
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['firestore:rules']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /cible 'firestore:rules' non reconnue/);
  assert.match(res.stderr, /les règles se déploient avec la cible 'rules'/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('un segment inconnu dans une liste fait échouer toute la commande', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['rules,storage']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /cible 'storage' non reconnue/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('cible manquante → usage citant hosting, functions et rules', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, []);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /cible manquante/);
  assert.match(res.stderr, /deploy\.sh rules/);
});

// ---------------------------------------------------------------------------
// rules — chemin nominal
// ---------------------------------------------------------------------------

test('rules nominal → firebase deploy --only firestore:rules,storage sur le bon projet', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['rules']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  const args = firebaseArgs(sandbox);
  assert.ok(args, 'firebase aurait dû être appelé');
  assert.ok(args.includes('deploy'), `args : ${JSON.stringify(args)}`);
  assert.strictEqual(
    args[args.indexOf('--only') + 1],
    RULES_ONLY,
    `--only attendu '${RULES_ONLY}', args : ${JSON.stringify(args)}`
  );
  assert.strictEqual(args[args.indexOf('--project') + 1], PROJECT);
  assert.ok(args.includes('--non-interactive'));
  // Sans --config, firebase résout firebase.json (et donc les chemins de règles)
  // depuis le cwd de l'appelant, pas depuis le checkout vérifié par les garde-fous.
  assert.ok(args.includes('--config'), `--config absent : ${JSON.stringify(args)}`);
  assert.match(args[args.indexOf('--config') + 1], /firebase\.json$/);
});

test('rules nominal → la sortie dit ce qui part et que c\'est irréversible', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['rules']);

  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /firestore\.rules/);
  assert.match(res.stdout, /storage\.rules/);
  assert.match(res.stdout, /partent ENSEMBLE/);
  assert.match(res.stdout, /REMPLACE les règles en vigueur/);
  // La justification doit être EXACTE : Firebase conserve bien les rulesets publiés,
  // ce qui manque c'est le lien ruleset ↔ commit. Un avertissement qui dit du faux
  // perd sa crédibilité sur le reste.
  assert.match(res.stdout, /Firebase CONSERVE les rulesets publiés/);
  assert.match(res.stdout, /sans lien avec le commit d'origine/);
  assert.doesNotMatch(res.stdout, /Aucun historique côté Firebase/);
  // Le dernier commit de chaque fichier situe la version envoyée dans l'historique.
  assert.match(res.stdout, /dernier commit :/);
  // Aucun faux repère : la transparence hosting/functions ne doit pas fuiter ici.
  assert.doesNotMatch(res.stdout, /Dernier déploiement (hosting|functions)/);
});

test('rules avec un fichier de règles absent → le signale explicitement', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { noRulesFiles: true });
  const res = runDeploy(sandbox, ['rules']);

  assert.match(res.stdout, /firestore\.rules {2}⚠️ {2}ABSENT du checkout/);
  assert.match(res.stdout, /storage\.rules {2}⚠️ {2}ABSENT du checkout/);
});

test('rules --dry-run → l\'option est relayée à firebase (validation, pas de publication)', { skip: SKIP }, (t) => {
  // Même contrat que `hosting --dry-run` : la simulation est déléguée à
  // firebase-tools, qui valide les règles sans les publier. Ce que le test peut
  // prouver, c'est que l'option arrive bien jusqu'à la commande — un stub ne peut
  // pas prouver ce que ferait le vrai firebase.
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['rules', '--dry-run']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  const args = firebaseArgs(sandbox);
  assert.ok(args.includes('--dry-run'), `--dry-run non relayé : ${JSON.stringify(args)}`);
  assert.strictEqual(args[args.indexOf('--only') + 1], RULES_ONLY);
  assert.strictEqual(ghArgs(sandbox), null, 'aucun run CI ne doit être déclenché');
});

// ---------------------------------------------------------------------------
// NON-RÉGRESSION — hosting et functions, les deux cibles utilisées tous les jours
// ---------------------------------------------------------------------------

test('hosting nominal → --only hosting, projet correct, smoke lancé (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['hosting']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  const args = firebaseArgs(sandbox);
  assert.ok(args, 'firebase aurait dû être appelé');
  assert.strictEqual(args[args.indexOf('--only') + 1], 'hosting');
  assert.strictEqual(args[args.indexOf('--project') + 1], PROJECT);
  assert.ok(args.includes('--config'));
  // Message de release « <sha> <sujet> » : seule trace consultable d'un deploy front.
  assert.ok(args.includes('-m'), `-m absent : ${JSON.stringify(args)}`);
  assert.match(args[args.indexOf('-m') + 1], new RegExp('^' + sandbox.headSha.slice(0, 7)));
  assert.match(res.stdout, /Smoke test post-déploiement/);
});

test('hosting depuis une feature branch → refus (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { checkout: 'feature' });
  const res = runDeploy(sandbox, ['hosting']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /RÈGLE 1/);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('functions → déclenche le workflow CI, jamais firebase en local (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['functions']);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  const gh = ghArgs(sandbox);
  assert.ok(gh, 'gh workflow run aurait dû être appelé');
  assert.ok(gh.includes('deploy-prod.yml'), `args gh : ${JSON.stringify(gh)}`);
  assert.ok(gh.includes('dry_run=false'), `args gh : ${JSON.stringify(gh)}`);
  assert.ok(gh.includes('only=functions'), `args gh : ${JSON.stringify(gh)}`);
  assert.strictEqual(firebaseArgs(sandbox), null, 'aucun deploy local sur le chemin functions');
});

test('functions --dry-run → dispatch dry_run=true (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['functions', '--dry-run']);

  assert.strictEqual(res.status, 0, res.stderr);
  const gh = ghArgs(sandbox);
  assert.ok(gh.includes('dry_run=true'), `args gh : ${JSON.stringify(gh)}`);
  assert.strictEqual(firebaseArgs(sandbox), null);
});

test('cible mixte hosting,functions → refus (inchangé)', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, {});
  const res = runDeploy(sandbox, ['hosting,functions']);

  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /cible mixte 'hosting,functions' refusée/);
  assert.match(res.stderr, /run GitHub asynchrone/);
  assert.strictEqual(firebaseArgs(sandbox), null);
  assert.strictEqual(ghArgs(sandbox), null);
});
