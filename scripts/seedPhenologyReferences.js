#!/usr/bin/env node
/**
 * seedPhenologyReferences.js — Seed Firestore phenology_references/* collection.
 *
 * Source of truth: phenology-tables.md §5-8 (values) + §11.1 (JSON format).
 *
 * Seeds 4 documents:
 *   - phenology_references/maravilla_primocane
 *   - phenology_references/maravilla_floricane
 *   - phenology_references/jasmin_primocane
 *   - phenology_references/jasmin_floricane
 *
 * The 4 fixtures are duplicated in this script (NOT imported from
 * functions/lib/phenology/__tests__/fixtures.js) — separation of test data
 * and production seed. Coherence is guaranteed by stageResolver/recipe tests.
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────
 *   # 1. Always start with a dry run (no writes)
 *   node scripts/seedPhenologyReferences.js --dry-run
 *
 *   # 2. Real run (check-and-skip on existing docs, with 3s safety pause)
 *   node scripts/seedPhenologyReferences.js
 *
 *   # 3. Force overwrite (use with care, log shows existing _meta.seededAt)
 *   node scripts/seedPhenologyReferences.js --force
 *
 *   # Combinable: preview overwrites
 *   node scripts/seedPhenologyReferences.js --dry-run --force
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Exit codes:
 *   0 — success (all docs created/updated/skipped as expected, diff ✅)
 *   1 — diff validation failed OR Firestore I/O error
 *   2 — bad CLI args
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');

const SCRIPT_VERSION = '1.0.0';
const SOURCE_FILE = 'phenology-tables.md';
const SOURCE_VERSION = '1.1.0';
const PROJECT_ID = 'berrygood-farms-dashboard';
const COLLECTION = 'phenology_references';
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
      console.log('Usage: node scripts/seedPhenologyReferences.js [--dry-run] [--force]');
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
// Fixtures (4 phenology references, copied from phenology-tables.md §5-8)
// Maravilla = base values (coef 1.0). Jasmin = same base values + coef 0.92
// (the resolver applies the coefficient at runtime — cf. doc §4).
// =====================================================================

const COMMON_DLI_PER_STAGE = {
  // primocane S0-S8
  S0: { target_min: 8,  target_max: 15, critical_min: 5,  critical_max: 20, unit: 'mol/m²/j' },
  S1: { target_min: 10, target_max: 18, critical_min: 6,  critical_max: 25, unit: 'mol/m²/j' },
  S2: { target_min: 15, target_max: 22, critical_min: 10, critical_max: 30, unit: 'mol/m²/j' },
  S3: { target_min: 18, target_max: 25, critical_min: 12, critical_max: 32, unit: 'mol/m²/j' },
  S4: { target_min: 20, target_max: 28, critical_min: 15, critical_max: 35, unit: 'mol/m²/j' },
  S5: { target_min: 20, target_max: 30, critical_min: 15, critical_max: 38, unit: 'mol/m²/j' },
  S6: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' },
  S7: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' },
  S8: { target_min: 15, target_max: 25, critical_min: 8,  critical_max: 35, unit: 'mol/m²/j' },
  // floricane F0-F7 (cf. §6.2: F0↔S0, F1↔S1+S2, F2↔S3, F3↔S4, F4↔S5, F5↔S6, F6↔S7, F7↔S8)
  F0: { target_min: 8,  target_max: 15, critical_min: 5,  critical_max: 20, unit: 'mol/m²/j' },
  F1: { target_min: 12, target_max: 22, critical_min: 8,  critical_max: 28, unit: 'mol/m²/j' },
  F2: { target_min: 18, target_max: 25, critical_min: 12, critical_max: 32, unit: 'mol/m²/j' },
  F3: { target_min: 20, target_max: 28, critical_min: 15, critical_max: 35, unit: 'mol/m²/j' },
  F4: { target_min: 20, target_max: 30, critical_min: 15, critical_max: 38, unit: 'mol/m²/j' },
  F5: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' },
  F6: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' },
  F7: { target_min: 15, target_max: 25, critical_min: 8,  critical_max: 35, unit: 'mol/m²/j' },
};

// Maravilla primocane stages — phenology-tables.md §5.1
const MARAVILLA_PRIMOCANE_STAGES = [
  { code: 'S0', name: 'Reprise / enracinement', gddMin: 0,    gddMax: 150,  estimatedDays: { min: 0,   max: 15 },
    irrigation: { ec_min: 1.2, ec_max: 1.4, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 12, drainage_pct_min: 10, drainage_pct_max: 15 },
    dli: COMMON_DLI_PER_STAGE.S0,
    notes: 'Petits apports très fréquents, éviter saturation. Surveiller T° substrat ≥ 16 °C' },
  { code: 'S1', name: 'Croissance végétative initiale', gddMin: 150, gddMax: 400, estimatedDays: { min: 15, max: 35 },
    irrigation: { ec_min: 1.4, ec_max: 1.6, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 18, drainage_pct_min: 15, drainage_pct_max: 20 },
    dli: COMMON_DLI_PER_STAGE.S1,
    notes: 'Augmenter progressivement EC. Surveiller couleur feuillage' },
  { code: 'S2', name: 'Croissance végétative active', gddMin: 400, gddMax: 800, estimatedDays: { min: 35, max: 60 },
    irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
    dli: COMMON_DLI_PER_STAGE.S2,
    notes: 'Pic de demande N. Analyse foliaire recommandée fin S2' },
  { code: 'S3', name: 'Initiation florale', gddMin: 800, gddMax: 1100, estimatedDays: { min: 60, max: 80 },
    irrigation: { ec_min: 1.8, ec_max: 2.0, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 28, drainage_pct_min: 25, drainage_pct_max: 30 },
    dli: COMMON_DLI_PER_STAGE.S3,
    notes: 'Glissement progressif N → K' },
  { code: 'S4', name: 'Floraison', gddMin: 1100, gddMax: 1400, estimatedDays: { min: 80, max: 100 }, criticalStage: true,
    irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.7, drainage_pct_target: 30, drainage_pct_min: 28, drainage_pct_max: 33 },
    dli: COMMON_DLI_PER_STAGE.S4,
    notes: 'STADE CRITIQUE. pH strict, éviter tout stress hydrique. T° max < 30 °C' },
  { code: 'S5', name: 'Nouaison / grossissement', gddMin: 1400, gddMax: 1700, estimatedDays: { min: 100, max: 120 },
    irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 32, drainage_pct_min: 30, drainage_pct_max: 35 },
    dli: COMMON_DLI_PER_STAGE.S5,
    notes: 'K↑, Ca soutenu. Surveiller apex (tip burn = carence Ca induite)' },
  { code: 'S6', name: 'Véraison / maturation', gddMin: 1700, gddMax: 2000, estimatedDays: { min: 120, max: 140 },
    irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 37, drainage_pct_min: 35, drainage_pct_max: 40 },
    dli: COMMON_DLI_PER_STAGE.S6,
    notes: 'Ratio K/N élevé pour Brix. Premier suivi qualité (Brix > 9)' },
  { code: 'S7', name: 'Pleine récolte', gddMin: 2000, gddMax: 3500, estimatedDays: { min: 140, max: 220 },
    irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 40, drainage_pct_min: 35, drainage_pct_max: 45 },
    dli: COMMON_DLI_PER_STAGE.S7,
    notes: 'Pilotage Brix, surveiller EC drainage. Lessivage actif. DLI > 35 sur 5j → ombrage' },
  { code: 'S8', name: 'Fin de cycle', gddMin: 3500, gddMax: 9999, estimatedDays: { min: 220, max: null },
    irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
    dli: COMMON_DLI_PER_STAGE.S8,
    notes: 'Sevrage progressif. Préparer arrachage ou conservation' },
];

// Maravilla floricane stages — phenology-tables.md §6.1 + §6.2 for DLI
const MARAVILLA_FLORICANE_STAGES = [
  { code: 'F0', name: 'Débourrement', gddMin: 0,    gddMax: 150,  estimatedDays: { min: 0,   max: 12 },
    irrigation: { ec_min: 1.2, ec_max: 1.4, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 12, drainage_pct_min: 10, drainage_pct_max: 15 },
    dli: COMMON_DLI_PER_STAGE.F0,
    notes: 'Gonflement et éclatement bourgeons' },
  { code: 'F1', name: 'Croissance latérale', gddMin: 150, gddMax: 450, estimatedDays: { min: 12, max: 35 },
    irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
    dli: COMMON_DLI_PER_STAGE.F1,
    notes: 'Élongation pousses florifères' },
  { code: 'F2', name: 'Boutons floraux visibles', gddMin: 450, gddMax: 700, estimatedDays: { min: 35, max: 50 },
    irrigation: { ec_min: 1.8, ec_max: 2.0, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 28, drainage_pct_min: 25, drainage_pct_max: 30 },
    dli: COMMON_DLI_PER_STAGE.F2,
    notes: 'Boutons groupés puis séparés' },
  { code: 'F3', name: 'Floraison', gddMin: 700, gddMax: 1000, estimatedDays: { min: 50, max: 70 }, criticalStage: true,
    irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.7, drainage_pct_target: 30, drainage_pct_min: 28, drainage_pct_max: 33 },
    dli: COMMON_DLI_PER_STAGE.F3,
    notes: 'STADE CRITIQUE. Anthèse, pollinisation' },
  { code: 'F4', name: 'Nouaison / grossissement', gddMin: 1000, gddMax: 1300, estimatedDays: { min: 70, max: 90 },
    irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 32, drainage_pct_min: 30, drainage_pct_max: 35 },
    dli: COMMON_DLI_PER_STAGE.F4,
    notes: 'Fruits verts' },
  { code: 'F5', name: 'Véraison / maturation', gddMin: 1300, gddMax: 1600, estimatedDays: { min: 90, max: 110 },
    irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 37, drainage_pct_min: 35, drainage_pct_max: 40 },
    dli: COMMON_DLI_PER_STAGE.F5,
    notes: 'Premières cueilles' },
  { code: 'F6', name: 'Pleine récolte', gddMin: 1600, gddMax: 2400, estimatedDays: { min: 110, max: 160 },
    irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 40, drainage_pct_min: 35, drainage_pct_max: 45 },
    dli: COMMON_DLI_PER_STAGE.F6,
    notes: 'Récolte concentrée (4-8 sem)' },
  { code: 'F7', name: 'Fin de récolte', gddMin: 2400, gddMax: 9999, estimatedDays: { min: 160, max: null },
    irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
    dli: COMMON_DLI_PER_STAGE.F7,
    notes: 'Sénescence floricane, transition vers gestion primocane suivante' },
];

const METADATA_TEMPLATE = {
  version: '1.1.0',
  lastUpdated: '2026-05-03',
  source: 'phenology-tables.md (sections 5-8 + 11.1)',
  calibrationStatus: 'initial_baseline_to_calibrate',
};

const FIXTURES = [
  {
    id: 'maravilla_primocane',
    body: {
      varietyId: 'maravilla',
      cycleType: 'primocane',
      displayName: 'Maravilla — Primocane',
      tBase: 5,
      tCap: 30,
      precocityCoefficient: 1.0,
      stages: MARAVILLA_PRIMOCANE_STAGES,
      metadata: { ...METADATA_TEMPLATE },
    },
  },
  {
    id: 'maravilla_floricane',
    body: {
      varietyId: 'maravilla',
      cycleType: 'floricane',
      displayName: 'Maravilla — Floricane',
      tBase: 5,
      tCap: 30,
      precocityCoefficient: 1.0,
      stages: MARAVILLA_FLORICANE_STAGES,
      metadata: { ...METADATA_TEMPLATE },
    },
  },
  {
    id: 'jasmin_primocane',
    body: {
      varietyId: 'jasmin',
      cycleType: 'primocane',
      displayName: 'Jasmin — Primocane',
      tBase: 5,
      tCap: 30,
      // Per phenology-tables.md §4: store BASE values + coefficient 0.92.
      // Resolver applies coef at runtime → S1 reached at 138 GDD (150 × 0.92).
      precocityCoefficient: 0.92,
      stages: MARAVILLA_PRIMOCANE_STAGES, // shared structure, irrigation+DLI identical between Driscoll varieties
      metadata: {
        ...METADATA_TEMPLATE,
        notes: [
          'Plus sensible à hygrométrie élevée — surveiller Botrytis dès S5',
          'Brix cible plus élevé en S7 : > 10 °Brix (vs 9.5 Maravilla)',
        ],
      },
    },
  },
  {
    id: 'jasmin_floricane',
    body: {
      varietyId: 'jasmin',
      cycleType: 'floricane',
      displayName: 'Jasmin — Floricane',
      tBase: 5,
      tCap: 30,
      precocityCoefficient: 0.92,
      stages: MARAVILLA_FLORICANE_STAGES,
      metadata: { ...METADATA_TEMPLATE },
    },
  },
];

// =====================================================================
// Diff helper
// =====================================================================

const META_FIELDS_TO_IGNORE = new Set(['_meta']); // _meta differs (timestamp) — compare separately

function deepDiff(expected, actual, currentPath = '') {
  const diffs = [];
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
    if (currentPath === '' && META_FIELDS_TO_IGNORE.has(k)) continue;
    const childPath = currentPath ? `${currentPath}.${k}` : k;
    diffs.push(...deepDiff(expected[k], actual[k], childPath));
  }
  return diffs;
}

// =====================================================================
// Seed one doc
// =====================================================================

async function seedOne(db, fixture, opts, seededAtIso) {
  const { id, body } = fixture;
  const ref = db.collection(COLLECTION).doc(id);
  const stagesCount = body.stages.length;
  const stagesRange = `${body.stages[0].code} → ${body.stages[stagesCount - 1].code}`;

  // Read existing
  const existing = await ref.get();
  const exists = existing.exists;
  const existingMeta = exists ? (existing.data()._meta || {}) : null;

  // Decide action
  let action; // 'create' | 'update' | 'skip'
  if (!exists) action = 'create';
  else if (opts.force) action = 'update';
  else action = 'skip';

  if (opts.dryRun) {
    if (action === 'skip') {
      console.log(`[DRY-RUN] Would skip:   ${COLLECTION}/${id} (already exists, seededAt=${existingMeta.seededAt || '?'})`);
    } else if (action === 'create') {
      console.log(`[DRY-RUN] Would create: ${COLLECTION}/${id}`);
      console.log(`          - precocityCoefficient: ${body.precocityCoefficient}`);
      console.log(`          - ${stagesCount} stages (${stagesRange}), dli config present on all`);
    } else {
      console.log(`[DRY-RUN] Would UPDATE: ${COLLECTION}/${id} (existing seededAt=${existingMeta.seededAt || '?'})`);
      console.log(`          - precocityCoefficient: ${body.precocityCoefficient}, ${stagesCount} stages`);
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

  // Write
  const docToWrite = {
    ...body,
    _meta: {
      seededAt: seededAtIso,
      seededBy: detectIdentity(),
      sourceFile: SOURCE_FILE,
      sourceVersion: SOURCE_VERSION,
      scriptVersion: SCRIPT_VERSION,
      mode: opts.mode,
    },
  };
  await ref.set(docToWrite);

  // Read back and diff
  const written = (await ref.get()).data();
  const diffs = deepDiff(body, written);

  if (diffs.length === 0) {
    console.log(`${action === 'create' ? '✅ Created' : '🔄 Updated'}: ${COLLECTION}/${id} (${stagesCount} stages, coef ${body.precocityCoefficient})`);
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
  const mode = 'production'; // emulator workflow not used for this script (cf. plan §C2-bis)
  const identity = detectIdentity();
  const t0 = Date.now();

  console.log('───────────────────────────────────────');
  console.log(`Seed: ${COLLECTION}`);
  console.log(`Mode: ${mode}${args.dryRun ? ' [DRY-RUN]' : ''}${args.force ? ' [--force]' : ''}`);
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Identity: ${identity}`);
  console.log(`Source: ${SOURCE_FILE} v${SOURCE_VERSION}`);
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

  // Initialize firebase-admin lazily (so --dry-run still works without ADC if needed for the load,
  // but we DO need admin to read existing docs for "would skip" decisions, so still init).
  let admin;
  try {
    admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  } catch (e) {
    admin = require('firebase-admin'); // fallback to root install
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
