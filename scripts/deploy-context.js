#!/usr/bin/env node
'use strict';
// @ts-check

/**
 * Transparence de déploiement — collecte (I/O) + affichage.
 *
 * Appelé par scripts/deploy.sh AVANT de déclencher quoi que ce soit, pour
 * répondre à deux questions : qu'est-ce qui est déjà en prod, et qu'est-ce que
 * cette commande y ajoute ?
 *
 *   node scripts/deploy-context.js functions
 *   node scripts/deploy-context.js hosting
 *   node scripts/deploy-context.js hosting --release-message
 *       → imprime UNIQUEMENT le message de release à passer à
 *         `firebase deploy -m` (c'est lui qui rend le prochain deploy lisible).
 *
 * Contrat : ce script ne fait ÉCHOUER aucun deploy. Toute panne (réseau, gh
 * absent, ADC expiré, historique tronqué) se traduit par « information
 * indisponible » et un exit 0.
 *
 * Sources du « dernier déploiement » :
 *   - functions : `gh run list --workflow deploy-prod.yml` (chaque run porte son headSha).
 *   - hosting   : API Firebase Hosting `sites.releases.list`, champ `message`,
 *     qu'on alimente nous-mêmes via `firebase deploy -m "<sha> <sujet>"`.
 *     Il n'existe PAS de commande firebase-tools pour relire les releases du
 *     canal live (seulement hosting:channel:list pour les canaux de preview) :
 *     on passe donc par l'API REST, authentifiée par ADC.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const https = require('node:https');

const lib = require('./lib/deployTransparency');

const ROOT = path.resolve(__dirname, '..');
const GH_REPO = process.env.DEPLOY_GH_REPO || 'omaaouni/BERRYGOOD';
const GH_WORKFLOW = process.env.DEPLOY_GH_WORKFLOW || 'deploy-prod.yml';
const HOSTING_SITE = process.env.DEPLOY_HOSTING_SITE || 'berrygood-farms-dashboard';
const NET_TIMEOUT_MS = 10000;

/**
 * Exécute une commande et rend stdout, ou null en cas d'échec (jamais de throw).
 * @param {string} bin
 * @param {string[]} args
 * @returns {string|null}
 */
function tryExec(bin, args) {
  try {
    return execFileSync(bin, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: NET_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_err) {
    return null;
  }
}

/** @returns {{sha: string, shortSha: string, subject: string, branch: string}} */
function readHead() {
  const raw = tryExec('git', ['log', '-1', '--format=%H%x1f%h%x1f%s']) || '';
  const [sha, shortSha, subject] = raw.split('\u001f');
  const branch = tryExec('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || '';
  return { sha: sha || '', shortSha: shortSha || '', subject: subject || '', branch: branch };
}

/**
 * Commits de `<sha>..HEAD`, du plus ancien au plus récent.
 * @param {string} sha
 * @returns {{commits: Array<{shortSha: string, subject: string}>|null, reason: string|null}}
 */
function readCommitsSince(sha) {
  if (!sha) return { commits: null, reason: 'commit de référence inconnu' };
  if (tryExec('git', ['cat-file', '-e', sha + '^{commit}']) === null) {
    return { commits: null, reason: 'commit ' + lib.shortenSha(sha) + ' absent du dépôt local (git fetch ?)' };
  }
  const raw = tryExec('git', ['log', '--reverse', '--format=%h%x1f%s', sha + '..HEAD']);
  if (raw === null) return { commits: null, reason: 'git log en échec' };
  if (raw === '') return { commits: [], reason: null };
  const commits = raw.split('\n').map(function (line) {
    const [shortSha, subject] = line.split('\u001f');
    return { shortSha: shortSha || '', subject: subject || '' };
  });
  return { commits: commits, reason: null };
}

/**
 * Dernier déploiement functions = dernier run CI réussi.
 * @returns {{lastDeploy: import('./lib/deployTransparency').LastDeploy|null, reason: string|null}}
 */
function readLastFunctionsDeploy() {
  if (tryExec('gh', ['--version']) === null) {
    return { lastDeploy: null, reason: 'gh indisponible' };
  }
  const raw = tryExec('gh', [
    'run', 'list',
    '--repo', GH_REPO,
    '--workflow', GH_WORKFLOW,
    '--limit', '20',
    '--json', 'databaseId,status,conclusion,headSha,createdAt,displayTitle',
  ]);
  if (raw === null) return { lastDeploy: null, reason: 'gh run list en échec' };
  let runs;
  try {
    runs = JSON.parse(raw);
  } catch (_err) {
    return { lastDeploy: null, reason: 'réponse gh illisible' };
  }
  const excludeRunIds = (process.env.DEPLOY_EXCLUDE_RUN_IDS || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
  const run = lib.selectLastSuccessfulRun(runs, { excludeRunIds: excludeRunIds });
  if (!run) return { lastDeploy: null, reason: 'aucun run réussi trouvé' };
  const subject = tryExec('git', ['log', '-1', '--format=%s', run.headSha]);
  return {
    lastDeploy: {
      sha: String(run.headSha),
      shortSha: lib.shortenSha(run.headSha),
      subject: subject || null,
      at: run.createdAt || null,
      source: 'gh-run',
    },
    reason: null,
  };
}

/**
 * GET JSON avec token bearer. Rend null sur toute erreur.
 * @param {string} url
 * @param {string} token
 * @returns {Promise<any|null>}
 */
function getJson(url, token) {
  return new Promise(function (resolve) {
    const req = https.get(
      url,
      { headers: { Authorization: 'Bearer ' + token }, timeout: NET_TIMEOUT_MS },
      function (res) {
        let body = '';
        res.on('data', function (c) { body += c; });
        res.on('end', function () {
          if (!res.statusCode || res.statusCode >= 300) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch (_err) {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', function () { req.destroy(); });
    req.on('error', function () { resolve(null); });
  });
}

/**
 * Dernier déploiement hosting = dernière release du canal live dont le message
 * porte un SHA (celles d'avant ce ticket n'en ont pas : elles sont ignorées et
 * signalées comme telles).
 * @returns {Promise<{lastDeploy: import('./lib/deployTransparency').LastDeploy|null, reason: string|null}>}
 */
async function readLastHostingDeploy() {
  const token = tryExec('gcloud', ['auth', 'application-default', 'print-access-token']);
  if (!token) {
    return { lastDeploy: null, reason: 'ADC gcloud indisponible (gcloud auth application-default login)' };
  }
  const url = 'https://firebasehosting.googleapis.com/v1beta1/sites/' +
    encodeURIComponent(HOSTING_SITE) + '/releases?pageSize=10';
  const json = await getJson(url, token);
  if (!json || !Array.isArray(json.releases)) {
    return { lastDeploy: null, reason: 'API Hosting injoignable' };
  }
  for (const release of json.releases) {
    if (!release || release.type !== 'DEPLOY') continue;
    const parsed = lib.parseHostingReleaseMessage(release.message);
    if (!parsed) continue;
    const subject = parsed.subject || tryExec('git', ['log', '-1', '--format=%s', parsed.sha]) || null;
    return {
      lastDeploy: {
        sha: parsed.sha,
        shortSha: lib.shortenSha(parsed.sha),
        subject: subject,
        at: release.releaseTime || null,
        source: 'hosting-release',
      },
      reason: null,
    };
  }
  return {
    lastDeploy: null,
    reason: 'aucune release ne porte de commit (releases antérieures à cette convention)',
  };
}

async function main() {
  const target = process.argv[2] || '';
  const head = readHead();

  if (process.argv.includes('--release-message')) {
    process.stdout.write(lib.buildHostingReleaseMessage(head.sha, head.subject));
    return;
  }

  const found = target.indexOf('functions') !== -1
    ? readLastFunctionsDeploy()
    : await readLastHostingDeploy();

  const since = found.lastDeploy
    ? readCommitsSince(found.lastDeploy.sha)
    : { commits: null, reason: found.reason };

  const delta = lib.buildDelta({
    lastDeploy: found.lastDeploy,
    commits: since.commits,
    currentBranch: head.branch,
    unavailableReason: since.reason || found.reason,
  });

  const lines = lib.formatDeployBlock({
    target: target || 'deploy',
    lastDeploy: found.lastDeploy,
    delta: delta,
    headShortSha: head.shortSha,
    currentBranch: head.branch,
  });
  lines.forEach(function (line) {
    console.log('[deploy] ' + line);
  });
}

main().catch(function (err) {
  // Dernier filet : l'affichage ne fait jamais échouer un deploy.
  console.log('[deploy] Transparence : information indisponible (' + (err && err.message) + ').');
});
