#!/usr/bin/env node
/**
 * seedPilotPlots.js — Seed Firestore plots/* with the Sprint 1 pilot plot.
 *
 * Sources :
 *   - cadrage CRIT-2 (2026-05-03) — Long Cane Double Crop floricane induit
 *   - mémoire project_long_cane_double_crop.md
 *   - audit P1 (deviceId 210506960 → tunnel)
 *
 * Seeds 1 document V1 :
 *   - plots/ML-T-LAR-01 (Maravilla tunnel Larache, cycle 2 = floricane)
 *
 * NB : ML-C-LAR-01 (canarienne) reportée hors Sprint 1 (date plantation
 * à vérifier en archives). Ce script ne touche PAS farmroad_stations
 * (relation plot↔station unidirectionnelle, le plot pointe vers la station).
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────
 *   node scripts/seedPilotPlots.js --dry-run
 *   node scripts/seedPilotPlots.js
 *   node scripts/seedPilotPlots.js --force
 *   node scripts/seedPilotPlots.js --dry-run --force
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Exit codes:
 *   0 — success / 1 — diff or I/O error / 2 — bad CLI args
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_VERSION = '1.0.0';
const SOURCE_FILE = 'cadrage-2026-05-03 CRIT-2 + project_long_cane_double_crop.md';
const SOURCE_VERSION = 'crit-2-2026-05-03';
const PROJECT_ID = 'berrygood-farms-dashboard';
const COLLECTION = 'plots';
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
      console.log('Usage: node scripts/seedPilotPlots.js [--dry-run] [--force]');
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
// Fixture (1 plot pilote — schéma autoritatif CRIT-2)
// =====================================================================

const FIXTURES = [
  {
    id: 'ML-T-LAR-01',
    body: {
      id: 'ML-T-LAR-01',
      displayName: 'Maravilla Tunnel Larache 01',
      farm: 'larache',

      shelter: {
        type: 'tunnel',
        structure: {
          orientation: 'N-S',
          ventilationType: 'passive',
          coverMaterial: 'polyethylene',
          coverTransmissionPct: 70,
          heightM: 3.5,
        },
      },

      sensors: {
        farmroad: {
          deviceId: '210506960',
          stationId: 'farmroad_tunnel_main',
        },
      },

      phenology: {
        enabled: true,
        variety: 'maravilla',
        cycleType: 'floricane',          // CRIT-2 — floricane induit par cold store
        budbreakDate: '2026-01-10',      // sortie cold store = J0 floricane
        plantingDate: null,              // pas applicable au cycle 2 induit

        temperatureSource: {
          primary: 'farmroad',
          stationId: 'farmroad_tunnel_main',
          fallback: 'meteoblue',
        },
        radiationSource: {
          primary: 'farmroad',
          stationId: 'farmroad_tunnel_main',
          sensor: 'both',
          fallback: 'meteoblue',
        },

        tBase: 5,
        tCap: 30,
        radsumEnabled: true,
        dliEnabled: true,
        parToRadiationRatio: 0.46,

        currentStage: 'F0',              // démarrage à neuf, le job Sprint 2 fait évoluer
        gddCumul: 0,
        gddDayLast: 0,
        radsumCumul: 0,
        radsumDayLast: 0,
        dliCumul: 0,
        dliDayLast: 0,
        daysInStage: 0,
        lastCalculation: null,

        precocityCoefficient: 1.0,
        customStageThresholds: null,
        contextModifiers: {              // V1 tous off, calibration V2
          hydricStressEnabled: false,
          photoperiodEnabled: false,
          heatStressEnabled: false,
          dliDeficitEnabled: false,
        },
      },

      metadata: {
        physicalPlotId: 'TUN-LAR-ZONE1', // clé pour relier les futurs cycles (ML-T-LAR-02 etc.)
        cyclePosition: 2,
        cycleHistory: [
          {
            cycleId: 'ML-T-LAR-01-c1',
            cycleType: 'primocane',
            plantingDate: '2025-05-19',  // W21 2025
            endDate: '2025-11-30',
            notes: 'Primocane W21 2025 → récolte Oct-Nov 2025, suivi cut back + cold store 2°C 5 semaines',
          },
        ],
        productionProtocol: 'long_cane_double_crop_driscolls',
        expectedNextEvent: {
          type: 'mow_down',
          plannedDate: '2026-05-31',
          note: 'Bascule en Green Cane primocane (cycle 3) — nouveau plot ML-T-LAR-02 à créer à ce moment',
        },
      },
    },
  },
];

// =====================================================================
// Diff helper (idem T7/T8)
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
    } else {
      const verb = action === 'create' ? 'create' : 'UPDATE';
      const seededAtNote = action === 'update' ? ` (existing seededAt=${existingMeta.seededAt || '?'})` : '';
      console.log(`[DRY-RUN] Would ${verb}: ${COLLECTION}/${id}${seededAtNote}`);
      console.log(`          - shelter.type: ${body.shelter.type}`);
      console.log(`          - sensors.farmroad: deviceId=${body.sensors.farmroad.deviceId}, stationId=${body.sensors.farmroad.stationId}`);
      console.log(`          - phenology: variety=${body.phenology.variety}, cycleType=${body.phenology.cycleType}, currentStage=${body.phenology.currentStage}`);
      console.log(`          - phenology.budbreakDate=${body.phenology.budbreakDate}, plantingDate=${body.phenology.plantingDate}`);
      console.log(`          - metadata.productionProtocol: ${body.metadata.productionProtocol}, cyclePosition=${body.metadata.cyclePosition}`);
      console.log(`          - metadata.cycleHistory: ${body.metadata.cycleHistory.length} past cycle(s)`);
      console.log(`          - metadata.expectedNextEvent: ${body.metadata.expectedNextEvent.type} @ ${body.metadata.expectedNextEvent.plannedDate}`);
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
    console.log(`${action === 'create' ? '✅ Created' : '🔄 Updated'}: ${COLLECTION}/${id} (cycleType=${body.phenology.cycleType}, currentStage=${body.phenology.currentStage})`);
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
  console.log(`Seed: ${COLLECTION} (Sprint 1 pilot)`);
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
