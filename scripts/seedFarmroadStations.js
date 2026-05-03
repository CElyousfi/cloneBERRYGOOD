#!/usr/bin/env node
/**
 * seedFarmroadStations.js — Seed Firestore farmroad_stations/* collection.
 *
 * Sources :
 *   - Audit P1 du 2026-05-03 (mémoire project_farmroad_stations.md)
 *   - brief-claude-code-addendum-v2.1.md §1.2 (schéma FarmroadStationDocument)
 *
 * Seeds 2 documents :
 *   - farmroad_stations/farmroad_canarienne_main (deviceId 210506929)
 *   - farmroad_stations/farmroad_tunnel_main     (deviceId 210506960)
 *
 * Mapping shelter type figé en dur V1. Évolution multi-stations en V2.
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────
 *   node scripts/seedFarmroadStations.js --dry-run
 *   node scripts/seedFarmroadStations.js
 *   node scripts/seedFarmroadStations.js --force
 *   node scripts/seedFarmroadStations.js --dry-run --force
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Exit codes:
 *   0 — success / 1 — diff or I/O error / 2 — bad CLI args
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_VERSION = '1.0.0';
const SOURCE_FILE = 'audit-farmroad-2026-05-03 + brief-claude-code-addendum-v2.1.md';
const SOURCE_VERSION = '1.0.0';
const PROJECT_ID = 'berrygood-farms-dashboard';
const COLLECTION = 'farmroad_stations';
const SAFETY_PAUSE_MS = 3000;

// =====================================================================
// CLI
// =====================================================================

function parseArgs(argv) {
  const args = { dryRun: false, force: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/seedFarmroadStations.js [--dry-run] [--force]');
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function detectIdentity() {
  try {
    const acct = execSync('gcloud config get-value account 2>/dev/null', { encoding: 'utf8' }).trim();
    if (acct) return acct;
  } catch (_) { /* gcloud unavailable */ }
  return process.env.USER || 'unknown';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================================================================
// Fixtures (2 stations FarmRoad — valeurs confirmées audit P1 2026-05-03)
// =====================================================================

const COMMON_CAPABILITIES = [
  'temperature', 'humidity', 'co2', 'par', 'radiation',
  'vpd', 'dewpoint', 'pressure', 'substrate_vwc',
];

const FIXTURES = [
  {
    id: 'farmroad_canarienne_main',
    body: {
      stationId: 'farmroad_canarienne_main',
      displayName: 'Maravilla Serre canarienne Larache',
      type: 'canarienne',
      location: {
        latitude: 35.08,
        longitude: -6.14,
        description: 'Larache canarienne',
      },
      capabilities: COMMON_CAPABILITIES,
      samplingIntervalMinutes: 2, // observé ~702 samples/jour audit P1
      isDefaultForType: true,
      deviceId: '210506929',
      compartmentId: 4082,
      sectorId: 6807,
      farmId: 3317,
      associatedPlots: [], // peuplé par seedPilotPlots (T8b)
      status: 'active',
      installDate: '2025-01-15',
      metadata: {
        version: '1.0.0',
        notes: 'Station unique canarienne BGF V1. Mapping shelter type figé en dur. Audit P1 2026-05-03.',
        auditDate: '2026-05-03',
      },
    },
  },
  {
    id: 'farmroad_tunnel_main',
    body: {
      stationId: 'farmroad_tunnel_main',
      displayName: 'Maravilla Tunnel Larache',
      type: 'tunnel',
      location: {
        latitude: 35.08,
        longitude: -6.14,
        description: 'Larache tunnel',
      },
      capabilities: COMMON_CAPABILITIES,
      samplingIntervalMinutes: 2,
      isDefaultForType: true,
      deviceId: '210506960',
      compartmentId: 4082,
      sectorId: 6810,
      farmId: 3317,
      associatedPlots: [],
      status: 'active',
      installDate: '2025-01-15',
      metadata: {
        version: '1.0.0',
        notes: 'Station unique tunnel BGF V1. Mapping shelter type figé en dur. Audit P1 2026-05-03.',
        auditDate: '2026-05-03',
      },
    },
  },
];

// =====================================================================
// Diff helper (idem T7 — duplication assumée Sprint 1, refacto possible plus tard)
// =====================================================================

const DIFF_IGNORE_PATHS = new Set(['_meta.seededAt']);

function deepDiff(expected, actual, currentPath = '') {
  const diffs = [];
  if (DIFF_IGNORE_PATHS.has(currentPath)) return diffs;
  if (Object.is(expected, actual)) return diffs;
  if (
    expected === null || actual === null ||
    typeof expected !== 'object' || typeof actual !== 'object'
  ) {
    diffs.push({ path: currentPath || '<root>', expected, actual });
    return diffs;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of keys) {
    const childPath = currentPath ? `${currentPath}.${k}` : k;
    diffs.push(...deepDiff(expected[k], actual[k], childPath));
  }
  return diffs;
}

// =====================================================================
// Seed one
// =====================================================================

async function seedOne(db, fixture, opts, seededAtIso) {
  const { id, body } = fixture;
  const ref = db.collection(COLLECTION).doc(id);

  const existing = await ref.get();
  const exists = existing.exists;
  const existingMeta = exists ? (existing.data()._meta || {}) : null;

  let action;
  if (!exists) action = 'create';
  else if (opts.force) action = 'update';
  else action = 'skip';

  if (opts.dryRun) {
    if (action === 'skip') {
      console.log(`[DRY-RUN] Would skip:   ${COLLECTION}/${id} (already exists, seededAt=${existingMeta.seededAt || '?'})`);
    } else if (action === 'create') {
      console.log(`[DRY-RUN] Would create: ${COLLECTION}/${id}`);
      console.log(`          - type: ${body.type}, deviceId: ${body.deviceId}`);
      console.log(`          - capabilities: ${body.capabilities.length} sensors, samplingIntervalMinutes: ${body.samplingIntervalMinutes}`);
    } else {
      console.log(`[DRY-RUN] Would UPDATE: ${COLLECTION}/${id} (existing seededAt=${existingMeta.seededAt || '?'})`);
      console.log(`          - type: ${body.type}, deviceId: ${body.deviceId}`);
    }
    return { id, action, diffs: [] };
  }

  if (action === 'skip') {
    console.log(`⏭️  Skipped: ${COLLECTION}/${id} (already exists, seededAt=${existingMeta.seededAt || '?'} — use --force to overwrite)`);
    return { id, action, diffs: [] };
  }

  if (action === 'update') {
    console.log(`⚠️  --force mode: about to OVERWRITE ${COLLECTION}/${id} (existing seededAt=${existingMeta.seededAt || '?'})`);
  }

  const meta = {
    seededAt: seededAtIso,
    seededBy: detectIdentity(),
    sourceFile: SOURCE_FILE,
    sourceVersion: SOURCE_VERSION,
    scriptVersion: SCRIPT_VERSION,
    mode: opts.mode,
  };
  const docToWrite = { ...body, _meta: meta };
  await ref.set(docToWrite);

  const written = (await ref.get()).data();
  const expectedFull = { ...body, _meta: meta };
  const diffs = deepDiff(expectedFull, written);

  if (diffs.length === 0) {
    console.log(`${action === 'create' ? '✅ Created' : '🔄 Updated'}: ${COLLECTION}/${id} (type=${body.type}, deviceId=${body.deviceId})`);
  } else {
    console.error(`❌ Diff mismatch on ${COLLECTION}/${id}:`);
    for (const d of diffs) {
      console.error(`   - ${d.path}: expected=${JSON.stringify(d.expected)} actual=${JSON.stringify(d.actual)}`);
    }
  }
  return { id, action, diffs };
}

// =====================================================================
// Main
// =====================================================================

async function main() {
  const args = parseArgs(process.argv);
  const mode = 'production';
  const identity = detectIdentity();
  const t0 = Date.now();

  console.log('───────────────────────────────────────');
  console.log(`Seed: ${COLLECTION}`);
  console.log(`Mode: ${mode}${args.dryRun ? ' [DRY-RUN]' : ''}${args.force ? ' [--force]' : ''}`);
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Identity: ${identity}`);
  console.log(`Source: ${SOURCE_FILE}`);
  console.log(`Script: v${SCRIPT_VERSION}`);
  console.log('───────────────────────────────────────');

  if (!args.dryRun) {
    console.log(`⚠️  This script writes to PRODUCTION Firestore.`);
    console.log(`⚠️  Project: ${PROJECT_ID}`);
    console.log(`⚠️  Identity: ${identity}`);
    console.log(`Press Ctrl+C within 3 seconds to abort, or wait to continue...`);
    await sleep(SAFETY_PAUSE_MS);
  } else {
    console.log('[DRY-RUN MODE — NO CHANGES MADE]');
  }
  console.log('');

  let admin;
  try {
    admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  } catch (e) {
    admin = require('firebase-admin');
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  const seededAtIso = new Date().toISOString();
  const results = [];
  let allOk = true;

  for (const fixture of FIXTURES) {
    try {
      const res = await seedOne(db, fixture, { ...args, mode }, seededAtIso);
      results.push(res);
      if (res.diffs && res.diffs.length > 0) allOk = false;
    } catch (err) {
      console.error(`❌ Error on ${fixture.id}: ${err.message}`);
      results.push({ id: fixture.id, action: 'error', diffs: [], error: err.message });
      allOk = false;
    }
  }

  const created = results.filter((r) => r.action === 'create' && (r.diffs || []).length === 0).length;
  const updated = results.filter((r) => r.action === 'update' && (r.diffs || []).length === 0).length;
  const skipped = results.filter((r) => r.action === 'skip').length;
  const failed = results.filter((r) => r.action === 'error' || (r.diffs || []).length > 0).length;

  console.log('');
  console.log('───────────────────────────────────────');
  console.log(`Seed completed: ${COLLECTION}`);
  console.log(`Mode: ${mode}${args.dryRun ? ' [DRY-RUN]' : ''}${args.force ? ' [--force]' : ''}`);
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Identity: ${identity}`);
  if (args.dryRun) {
    const wouldCreate = results.filter((r) => r.action === 'create').length;
    const wouldUpdate = results.filter((r) => r.action === 'update').length;
    const wouldSkip = results.filter((r) => r.action === 'skip').length;
    console.log(`Would create: ${wouldCreate}`);
    console.log(`Would update: ${wouldUpdate}`);
    console.log(`Would skip:   ${wouldSkip}`);
    console.log(`Diff validation: N/A (dry-run)`);
  } else {
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed:  ${failed}`);
    console.log(`Diff validation: ${allOk ? '✅ all docs match fixture' : '❌ mismatches detected'}`);
  }
  console.log(`Duration: ${Date.now() - t0}ms`);
  console.log('───────────────────────────────────────');

  if (args.dryRun) {
    console.log('[DRY-RUN] No changes made. Run without --dry-run to apply.');
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
