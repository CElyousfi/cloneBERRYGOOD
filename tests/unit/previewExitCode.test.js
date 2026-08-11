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
 * capture `DEPLOY_OUTPUT=…` ne fait pas rougir les cas où firebase échoue
 * SANS rien imprimer — le script garde une 2e ligne de défense (preview.sh:90-93,
 * « impossible d'extraire l'URL ») qui sort en 1. Le contrat reste donc honoré
 * **tant que l'échec ne laisse pas d'URL dans la sortie**. Si firebase imprime
 * une URL PUIS sort en erreur (deploy partiel), cette 2e ligne de défense ne
 * protège plus : un `|| true` donnerait exit 0 AVEC une PREVIEW_URL, c'est-à-dire
 * exactement le bug d'origine. D'où le cas de test « deploy partiel » ci-dessous,
 * qui est le seul à couvrir cette faille.
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

// URL bidon imprimée par les stubs firebase qui « réussissent » le deploy.
const STUB_URL = 'https://berrygood-farms-dashboard--sb-feature-abc123.web.app';

// Ancre de progression : cette ligne est écrite par preview.sh JUSTE avant
// l'appel firebase (preview.sh:81). L'asserter prouve que le script a bien
// atteint l'étape de deploy — sans elle, un garde-fou ajouté PLUS TÔT ferait
// passer les cas d'échec au vert pour la mauvaise raison (faux vert déjà
// rencontré deux fois sur ce ticket).
const DEPLOY_REACHED = /déploiement hosting sur le canal/;

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
 * @param {import('node:test').TestContext} t   pour le nettoyage automatique du bac à sable
 * @param {object} opts
 * @param {'fail'|'success'|'no-url'|'url-then-fail'} opts.firebase comportement du stub firebase
 * @param {boolean} [opts.withEnvFile=true]          écrire un .env avec FIREBASE_TOKEN
 * @param {boolean} [opts.sabotage=false]            casser la propagation du code de sortie
 * @returns {{root: string, stubs: string}}
 */
function makeSandbox(t, opts) {
  const { firebase, withEnvFile = true, sabotage = false } = opts;
  // Les stubs vivent HORS du faux repo : dans le repo ils seraient untracked
  // et feraient échouer le garde-fou « working tree propre » — les cas
  // d'échec passeraient alors pour la mauvaise raison.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-exit-code-'));
  // Sans ça, chaque `npm run qa` laisse un bac à sable (~170 Ko) derrière lui.
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
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

  const urlLine =
    'echo "✔  hosting:channel: Channel URL (sb-feature): ' +
    `${STUB_URL} [expires 2026-08-12]"\n`;
  const firebaseStub = {
    fail: '#!/bin/sh\necho "Error: HTTP Error: 403, The caller does not have permission" >&2\nexit 2\n',
    success: `#!/bin/sh\n${urlLine}exit 0\n`,
    'no-url': '#!/bin/sh\necho "✔  Deploy complete!"\nexit 0\n',
    // Deploy partiel : firebase annonce une URL PUIS sort en erreur. C'est le
    // seul scénario où la 2e ligne de défense (extraction d'URL) ne protège
    // plus — cf. LIMITE CONNUE en tête de fichier.
    'url-then-fail': `#!/bin/sh\n${urlLine}echo "Error: deploy failed after channel creation" >&2\nexit 2\n`,
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

test('deploy réussi → exit 0 et PREVIEW_URL sur stdout', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { firebase: 'success' });
  const res = runPreview(sandbox);

  assert.strictEqual(res.status, 0, `attendu exit 0, obtenu ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, DEPLOY_REACHED);
  assert.strictEqual(
    res.stdout.includes(`PREVIEW_URL=${STUB_URL}\n`),
    true,
    `stdout ne contient pas la ligne PREVIEW_URL attendue :\n${res.stdout}`
  );
});

// ---------------------------------------------------------------------------
// Le verrou proprement dit : échec du deploy → code de sortie non nul.
// ---------------------------------------------------------------------------

test('deploy firebase en échec → exit non nul', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { firebase: 'fail' });
  const res = runPreview(sandbox);

  // Ancrer la raison AVANT le code de sortie : sinon un garde-fou ajouté plus
  // tôt dans le script ferait passer ce test au vert sans jamais tester la
  // propagation du code de sortie du deploy.
  assert.match(
    res.stdout,
    DEPLOY_REACHED,
    `le script n'a pas atteint l'étape de deploy — ce test ne prouve rien sur ` +
      `la propagation du code de sortie :\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
  );
  assert.notStrictEqual(
    res.status,
    0,
    `preview.sh a rendu 0 alors que firebase a échoué (régression de propagation)\n` +
      `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`
  );
  // Et surtout : pas d'URL annoncée alors que rien n'est déployé.
  assert.doesNotMatch(res.stdout, /PREVIEW_URL=/);
});

test('deploy partiel — firebase imprime une URL PUIS échoue → exit non nul', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { firebase: 'url-then-fail' });
  const res = runPreview(sandbox);

  assert.match(res.stdout, DEPLOY_REACHED);
  assert.notStrictEqual(
    res.status,
    0,
    `preview.sh a rendu 0 sur un deploy partiel : c'est EXACTEMENT le bug qui ` +
      `avait été (à tort) rapporté\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`
  );
  // Le cas critique : ne JAMAIS annoncer une URL de preview issue d'un deploy
  // qui a échoué — l'appelant la publierait comme si tout allait bien.
  assert.doesNotMatch(res.stdout, /PREVIEW_URL=/);
});

test('deploy OK mais aucune URL extractible → exit non nul', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { firebase: 'no-url' });
  const res = runPreview(sandbox);

  assert.match(res.stdout, DEPLOY_REACHED);
  assert.notStrictEqual(res.status, 0, `attendu exit non nul, obtenu ${res.status}`);
  assert.doesNotMatch(res.stdout, /PREVIEW_URL=/);
});

// Ce cas sort VOLONTAIREMENT avant l'étape de deploy : pas d'ancre
// DEPLOY_REACHED ici, on ancre sur le message du garde-fou lui-même.
test('FIREBASE_TOKEN absent → exit non nul avant tout deploy', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { firebase: 'success', withEnvFile: false });
  const res = runPreview(sandbox);

  assert.match(res.stderr, /FIREBASE_TOKEN absent/);
  assert.notStrictEqual(res.status, 0, `attendu exit non nul, obtenu ${res.status}`);
  assert.doesNotMatch(res.stdout, DEPLOY_REACHED);
  assert.doesNotMatch(res.stdout, /PREVIEW_URL=/);
});

// ---------------------------------------------------------------------------
// Méta-test : prouve que le verrou ci-dessus PEUT échouer.
// Un test qui ne peut pas devenir rouge ne vaut rien : on sabote une copie du
// script (trap EXIT → toujours 0, exactement le bug qui avait été rapporté)
// et on vérifie que le harness voit bien ce 0.
// ---------------------------------------------------------------------------

test('méta — script saboté (toujours exit 0) : le harness le détecte', { skip: SKIP }, (t) => {
  const sandbox = makeSandbox(t, { firebase: 'fail', sabotage: true });
  const res = runPreview(sandbox);

  assert.strictEqual(
    res.status,
    0,
    'le sabotage ne produit plus exit 0 : le méta-test ne prouve plus rien, ' +
      'revoir makeSandbox({ sabotage: true })'
  );
});
