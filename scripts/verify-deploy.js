#!/usr/bin/env node
'use strict';

// Gate G6 — vérifie que les Cloud Functions déployées correspondent au
// commit qu'on croit avoir déployé (updateTime GCP > date du commit HEAD,
// comparé en epoch UTC, jamais en chaîne). Mode avertissement par défaut :
// exit 0 même en KO. DEPLOY_VERIFY_STRICT=1 → exit 1 en KO.
//
// ⚠️ Ne jamais appeler `gcloud functions describe` sans
// --format=value(updateTime) : la sortie complète expose les env vars en
// clair (API keys, mots de passe DB).

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REGION = process.env.DEPLOY_VERIFY_REGION || 'europe-west1';
const PROJECT = process.env.DEPLOY_VERIFY_PROJECT || 'berrygood-farms-dashboard';
const TARGETS_FILE = process.env.DEPLOY_VERIFY_TARGETS_FILE ||
  path.join(ROOT, 'docs/ai/deploy-verify-targets.txt');
const LOG_FILE = path.join(ROOT, 'docs/ai/deploy-verify.log');
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_SECONDS = 20;

function readTargets() {
  const raw = fs.readFileSync(TARGETS_FILE, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function getHeadCommit() {
  const epoch = parseInt(
    execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    10
  );
  const shortSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return { epoch, shortSha };
}

function describeFunction(fn) {
  try {
    const raw = execFileSync(
      'gcloud',
      [
        'functions', 'describe', fn,
        '--region', REGION,
        '--project', PROJECT,
        '--format=value(updateTime)',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (!raw) {
      return { verdict: 'ERREUR', detail: 'updateTime vide (fonction introuvable ?)' };
    }
    const updateEpoch = Math.floor(new Date(raw).getTime() / 1000);
    if (Number.isNaN(updateEpoch)) {
      return { verdict: 'ERREUR', detail: `updateTime illisible: ${raw}` };
    }
    return { updateTime: raw, updateEpoch };
  } catch (err) {
    return { verdict: 'ERREUR', detail: (err.message || String(err)).split('\n')[0] };
  }
}

function sleepSeconds(seconds) {
  execFileSync('sleep', [String(seconds)]);
}

function run() {
  const targets = readTargets();
  const { epoch: commitEpoch, shortSha } = getHeadCommit();
  const commitIso = new Date(commitEpoch * 1000).toISOString();

  const results = {};
  let pending = targets.slice();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt++) {
    for (const fn of pending) {
      const info = describeFunction(fn);
      if (info.updateEpoch !== undefined) {
        results[fn] = {
          updateTime: info.updateTime,
          verdict: info.updateEpoch > commitEpoch ? 'OK' : 'KO',
        };
      } else {
        results[fn] = { verdict: 'ERREUR', detail: info.detail };
      }
    }
    pending = targets.filter((fn) => results[fn].verdict !== 'OK');
    if (pending.length > 0 && attempt < MAX_ATTEMPTS) {
      sleepSeconds(RETRY_DELAY_SECONDS);
    }
  }

  console.log(`Gate G6 — vérification post-déploiement`);
  console.log(`  Commit HEAD : ${shortSha} (${commitIso})`);
  console.log(`  Région/projet : ${REGION} / ${PROJECT}`);
  console.log('');

  const rows = targets.map((fn) => {
    const r = results[fn];
    const updateCol = r.updateTime || (r.detail ? `ERREUR: ${r.detail}` : '—');
    return [fn, updateCol, commitIso, r.verdict];
  });
  const headers = ['Fonction', 'updateTime', 'Date du commit', 'Verdict'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const printRow = (cols) => console.log(cols.map((c, i) => String(c).padEnd(widths[i])).join('  |  '));
  printRow(headers);
  printRow(widths.map((w) => '-'.repeat(w)));
  rows.forEach(printRow);
  console.log('');

  const okCount = targets.filter((fn) => results[fn].verdict === 'OK').length;
  const allError = targets.every((fn) => results[fn].verdict === 'ERREUR');

  if (allError) {
    console.log('⚠️⚠️⚠️  G6 N\'A RIEN VÉRIFIÉ — aucune cible joignable (auth gcloud expirée ? projet inaccessible ?).');
    console.log('⚠️⚠️⚠️  Ce déploiement N\'EST PAS VÉRIFIÉ. Ne pas considérer ce résultat comme une preuve.');
  } else {
    console.log(`Synthèse : ${okCount}/${targets.length} OK`);
  }

  const logLine = `${new Date().toISOString()} sha=${shortSha} ` +
    targets.map((fn) => `${fn}=${results[fn].verdict}`).join(' ') +
    (allError ? ' ALL_ERROR' : '') + '\n';
  fs.appendFileSync(LOG_FILE, logLine);

  const strict = process.env.DEPLOY_VERIFY_STRICT === '1';
  if (strict && okCount < targets.length) {
    process.exit(1);
  }
  process.exit(0);
}

run();
