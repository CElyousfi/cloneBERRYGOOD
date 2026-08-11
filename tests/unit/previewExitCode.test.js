'use strict';

/**
 * Verrou de non-régression : scripts/preview.sh doit propager un code de
 * sortie NON NUL quand le deploy Firebase échoue.
 *
 * POURQUOI CE TEST EXISTE (2026-08-11)
 * ------------------------------------
 * Un ticket a été ouvert sur le symptôme « preview.sh rend 0 même quand le
 * deploy Firebase échoue ». Après enquête : le script était CORRECT, et il
 * l'est toujours. Le 0 observé venait de la commande d'OBSERVATION, pas du
 * script :
 *
 *     scripts/preview.sh 2>&1 | tail -50   →  $? est celui de `tail`, pas de preview.sh
 *
 * Preuve obtenue en bac à sable hermétique (stub `firebase` qui `exit 2`) :
 *   - `preview.sh` seul          → EXIT = 2  (correct)
 *   - `preview.sh | tail`        → EXIT = 0  (artefact du pipe)
 *
 * Mécanique côté script : `set -euo pipefail` (preview.sh:14) + capture par
 * substitution de commande `DEPLOY_OUTPUT="$(firebase …)"` (preview.sh:86).
 * Une affectation par substitution propage le code de la commande, donc
 * `set -e` abat le script. Aucun `|| true`, aucun `exit 0` final.
 *
 * AUCUN script de production n'a été modifié pour ce ticket. Ce fichier ne
 * fait que verrouiller le comportement actuel, pour qu'une régression future
 * (`|| true` ajouté, `| tee` autour de l'appel firebase, `trap … EXIT`,
 * `exit 0` de complaisance) soit attrapée par la gate QA.
 *
 * ⚠️ Si tu rouvres ce ticket parce que « preview.sh rend 0 » : commence par
 * relancer le script SANS pipe (`scripts/preview.sh; echo $?`) avant de
 * toucher au script.
 *
 * FORME DU TEST
 * -------------
 * `node:test` natif (convention du repo, cf. tests/unit/*.test.js) qui pilote
 * un vrai shell via `spawnSync`. Chaque cas s'exécute dans un bac à sable
 * `mktemp -d` : copie du VRAI scripts/preview.sh (pas une copie figée),
 * faux repo git, faux `.env`, et des stubs `npm`/`firebase` en tête de PATH.
 * → aucun appel réseau, aucun credential Firebase, aucun accès au vrai repo.
 *
 * HORS PÉRIMÈTRE : le garde-fou « preview interdit depuis main ».
 *
 * LIMITE CONNUE (mesurée, pas supposée) : ajouter `|| true` sur la seule
 * capture `DEPLOY_OUTPUT=…` ne fait PAS rougir ce test — le script garde une
 * seconde ligne de défense (preview.sh:90-93, « impossible d'extraire l'URL »)
 * qui sort en 1. Le contrat testé (« deploy en échec ⇒ exit non nul ») reste
 * donc honoré, seul le message d'erreur devient moins parlant.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REAL_PREVIEW_SH = path.join(__dirname, '..', '..', 'scripts', 'preview.sh');

// Le bac à sable a besoin d'un shell POSIX + git : inutile de faire rougir un
// runner Windows, on skippe proprement.
const GIT_OK =
  process.platform !== 'win32' &&
  spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const SKIP = GIT_OK ? false : 'nécessite git et un shell POSIX';

// Token bidon, jamais une vraie valeur : preview.sh exige seulement qu'il soit
// non vide, et le stub `firebase` ne le lit pas.
const FAKE_TOKEN = 'fake-token-not-a-secret';

const GIT_FLAGS = [
  '-c',
  'user.name=preview-test',
  '-c',
  'user.email=preview-test@example.invalid',
  '-c',
  'commit.gpgsign=false',
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
 * Construit un bac à sable hermétique.
 *
 * @param {object} opts
 * @param {'fail'|'success'|'no-url'} opts.firebase  comportement du stub firebase
 * @param {boolean} [opts.withEnvFile=true]          écrire un .env avec FIREBASE_TOKEN
 * @param {boolean} [opts.sabotage=false]            casser la propagation du code de sortie
 * @returns {{root: string, stubs: string}}
 */
function makeSandbox(opts) {
  const { firebase, withEnvFile = true, sabotage = false } = opts;
  // Les stubs vivent HORS du faux repo : dans le repo ils seraient untracked
  // et feraient échouer le garde-fou « working tree propre » — les cas
  // d'échec passeraient alors pour la mauvaise raison.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-exit-code-'));
  const root = path.join(base, 'repo');
  fs.mkdirSync(root);

  // 1. Copie du VRAI script (éventuellement sabotée pour le méta-test).
  fs.mkdirSync(path.join(root, 'scripts'));
  let script = fs.readFileSync(REAL_PREVIEW_SH, 'utf8');
  if (sabotage) {
    const anchor = 'set -euo pipefail';
    assert.ok(
      script.includes(anchor),
      `sabotage impossible : "${anchor}" introuvable dans scripts/preview.sh`
    );
    // Simule EXACTEMENT le bug qui avait été rapporté : le script rend 0
    // quoi qu'il arrive. Sert à prouver que le harness observe bien le vrai
    // code de sortie (et ne le perd pas dans un pipe).
    script = script.replace(anchor, `${anchor}\ntrap 'exit 0' EXIT`);
  }
  writeExecutable(path.join(root, 'scripts', 'preview.sh'), script);

  // 2. Faux projet Firebase + .env.
  fs.writeFileSync(path.join(root, 'firebase.json'), '{}\n');
  if (withEnvFile) {
    fs.writeFileSync(path.join(root, '.env'), `FIREBASE_TOKEN=${FAKE_TOKEN}\n`);
  }

  // 3. Faux repo git : main, puis une feature branch non mergée, tree propre.
  //    Nécessaire pour passer les garde-fous (a) branche != main,
  //    (b) branche non mergée dans main, (c) working tree propre.
  git(root, ['init', '-b', 'main', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['checkout', '-q', '-b', 'sb/feature']);
  fs.writeFileSync(path.join(root, 'FEATURE.md'), 'feature\n');
  git(root, ['add', 'FEATURE.md']);
  git(root, ['commit', '-q', '-m', 'feature']);

  // 4. Stubs en tête de PATH : aucun appel réseau, aucun `npm run qa` réel.
  const stubs = path.join(base, 'stubs');
  fs.mkdirSync(stubs);
  writeExecutable(path.join(stubs, 'npm'), '#!/bin/sh\nexit 0\n');

  const firebaseStub = {
    fail: '#!/bin/sh\necho "Error: HTTP Error: 403, The caller does not have permission" >&2\nexit 2\n',
    success:
      '#!/bin/sh\n' +
      'echo "✔  hosting:channel: Channel URL (sb-feature): ' +
      'https://berrygood-farms-dashboard--sb-feature-abc123.web.app [expires 2026-08-12]"\n' +
      'exit 0\n',
    'no-url': '#!/bin/sh\necho "✔  Deploy complete!"\nexit 0\n',
  }[firebase];
  assert.ok(firebaseStub, `stub firebase inconnu : ${firebase}`);
  writeExecutable(path.join(stubs, 'firebase'), firebaseStub);

  return { root, stubs };
}

/**
 * Lance preview.sh SANS AUCUN PIPE — c'est tout l'intérêt de ce test.
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
function runPreview(sandbox) {
  const env = { ...process.env, PATH: `${sandbox.stubs}:${process.env.PATH}` };
  // Ne jamais laisser fuiter un vrai token de la machine dans le bac à sable :
  // le seul token possible est celui du faux .env.
  delete env.FIREBASE_TOKEN;

  const res = spawnSync('bash', [path.join(sandbox.root, 'scripts', 'preview.sh')], {
    cwd: sandbox.root,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// ---------------------------------------------------------------------------
// Cas nominal : le chemin de succès ne doit pas être cassé par le verrou.
// ---------------------------------------------------------------------------

test('deploy réussi → exit 0 et PREVIEW_URL sur stdout', { skip: SKIP }, () => {
  const sandbox = makeSandbox({ firebase: 'success' });
  const res = runPreview(sandbox);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  assert.match(
    res.stdout,
    /^PREVIEW_URL=https:\/\/berrygood-farms-dashboard--sb-feature-abc123\.web\.app$/m,
    `stdout ne contient pas la ligne PREVIEW_URL :\n${res.stdout}`
  );
});

// ---------------------------------------------------------------------------
// Le verrou proprement dit : échec du deploy → code de sortie non nul.
// ---------------------------------------------------------------------------

test('deploy firebase en échec → exit non nul', { skip: SKIP }, () => {
  const sandbox = makeSandbox({ firebase: 'fail' });
  const res = runPreview(sandbox);

  assert.notStrictEqual(
    res.status,
    0,
    `preview.sh a rendu 0 alors que firebase a échoué (régression de propagation)\n` +
      `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`
  );
  // Et surtout : pas d'URL annoncée alors que rien n'est déployé.
  assert.doesNotMatch(res.stdout, /PREVIEW_URL=/);
});

test('deploy OK mais aucune URL extractible → exit non nul', { skip: SKIP }, () => {
  const sandbox = makeSandbox({ firebase: 'no-url' });
  const res = runPreview(sandbox);

  assert.notStrictEqual(res.status, 0, `attendu exit non nul, obtenu ${res.status}`);
  assert.doesNotMatch(res.stdout, /PREVIEW_URL=/);
});

test('FIREBASE_TOKEN absent → exit non nul avant tout deploy', { skip: SKIP }, () => {
  const sandbox = makeSandbox({ firebase: 'success', withEnvFile: false });
  const res = runPreview(sandbox);

  assert.notStrictEqual(res.status, 0, `attendu exit non nul, obtenu ${res.status}`);
  assert.match(res.stderr, /FIREBASE_TOKEN/);
  assert.doesNotMatch(res.stdout, /PREVIEW_URL=/);
});

// ---------------------------------------------------------------------------
// Méta-test : prouve que le verrou ci-dessus PEUT échouer.
// Un test qui ne peut pas devenir rouge ne vaut rien : on sabote une copie du
// script (trap EXIT → toujours 0, exactement le bug qui avait été rapporté)
// et on vérifie que le harness voit bien ce 0.
// ---------------------------------------------------------------------------

test('méta — script saboté (toujours exit 0) : le harness le détecte', { skip: SKIP }, () => {
  const sandbox = makeSandbox({ firebase: 'fail', sabotage: true });
  const res = runPreview(sandbox);

  assert.strictEqual(
    res.status,
    0,
    'le sabotage ne produit plus exit 0 : le méta-test ne prouve plus rien, ' +
      'revoir makeSandbox({ sabotage: true })'
  );
});
