#!/usr/bin/env node
/**
 * migrateStatuts.js — Sprint 2 migration of caisse_transactions.status
 *
 * Brings legacy transactions into the canonical 5-status set:
 *   brouillon | soumis | a_revoir | valide | rejete
 *
 * Rules:
 *   - 'valide' stays 'valide'
 *   - Any other recognized canonical code stays as-is (brouillon, soumis,
 *     a_revoir, rejete)
 *   - Any unrecognized / legacy / missing status → 'soumis' (UI: 'Saisi')
 *
 * Usage:
 *   node scripts/migrateStatuts.js              # dry-run (default), no writes
 *   node scripts/migrateStatuts.js --force      # apply the migration
 *   node scripts/migrateStatuts.js --json       # machine-readable JSON summary
 *
 * Pure migration logic is in planMigration() and can be tested without
 * any Firebase / network access. The default firebase-admin path runs
 * only when the script is invoked from the CLI.
 */
'use strict';

/** Canonical status codes after Sprint 2 migration. */
const CANONICAL_STATUSES = ['brouillon', 'soumis', 'a_revoir', 'valide', 'rejete'];

/** Default fallback status when the current value is unknown / legacy / missing. */
const FALLBACK_STATUS = 'soumis';


/**
 * Plan a migration over a list of transaction docs.
 *
 * Pure function — no side effects. The input is shaped like Firestore docs
 * exposed via { id, data: () => ({...}) } OR a plain { id, status, … } shape.
 *
 * @param {Array<{id:string, status?:string} | {id:string, data:() => any}>} docs
 * @returns {{
 *   toMigrate: Array<{id:string, oldStatus:string, newStatus:string}>,
 *   unchanged: Array<{id:string, status:string}>,
 *   summary: { total:number, toMigrate:number, unchanged:number, byOldStatus: Object }
 * }}
 */
function planMigration(docs) {
  const toMigrate = [];
  const unchanged = [];
  const byOldStatus = {};
  if (!Array.isArray(docs)) {
    return { toMigrate, unchanged, summary: { total: 0, toMigrate: 0, unchanged: 0, byOldStatus } };
  }
  for (const doc of docs) {
    if (!doc || !doc.id) continue;
    const data = (typeof doc.data === 'function') ? doc.data() : doc;
    const current = (data && data.status != null) ? String(data.status) : '';
    const key = current || '(missing)';
    byOldStatus[key] = (byOldStatus[key] || 0) + 1;
    if (CANONICAL_STATUSES.indexOf(current) !== -1) {
      unchanged.push({ id: doc.id, status: current });
    } else {
      toMigrate.push({ id: doc.id, oldStatus: current, newStatus: FALLBACK_STATUS });
    }
  }
  return {
    toMigrate, unchanged,
    summary: {
      total: toMigrate.length + unchanged.length,
      toMigrate: toMigrate.length,
      unchanged: unchanged.length,
      byOldStatus,
    },
  };
}


/**
 * Apply the migration plan via Firestore batched writes.
 * Pure I/O — chunks of 400 to stay under Firestore's 500-op batch limit.
 *
 * @param {Array<{id:string, oldStatus:string, newStatus:string}>} migrations
 * @param {Object} db                        Firestore instance (firebase-admin).
 * @param {string} [collection='caisse_transactions']
 * @returns {Promise<{written:number, chunks:number}>}
 */
async function applyMigration(migrations, db, collection) {
  const coll = collection || 'caisse_transactions';
  let written = 0, chunks = 0;
  const CHUNK = 400;
  for (let i = 0; i < migrations.length; i += CHUNK) {
    const slice = migrations.slice(i, i + CHUNK);
    const wb = db.batch();
    for (const m of slice) {
      wb.update(db.collection(coll).doc(m.id), {
        status: m.newStatus,
        // Audit trail
        status_migrated_from: m.oldStatus || null,
        status_migrated_at: new Date(),
      });
      written++;
    }
    await wb.commit();
    chunks++;
  }
  return { written, chunks };
}


// ============================================================================
// CLI
// ============================================================================

async function _cliMain() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const asJson = args.includes('--json');

  // Lazy require so the test can import the module without firebase-admin installed
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'berrygood-farms-dashboard' });
  }
  const db = admin.firestore();

  const snap = await db.collection('caisse_transactions').get();
  const docs = snap.docs.map(d => ({ id: d.id, data: () => d.data() }));
  const plan = planMigration(docs);

  if (asJson) {
    console.log(JSON.stringify(plan.summary, null, 2));
  } else {
    console.log(`[migrate] total=${plan.summary.total}  toMigrate=${plan.summary.toMigrate}  unchanged=${plan.summary.unchanged}`);
    console.log('[migrate] by old status:', plan.summary.byOldStatus);
    if (plan.toMigrate.length > 0 && plan.toMigrate.length <= 20) {
      console.log('[migrate] sample of migrations:');
      for (const m of plan.toMigrate.slice(0, 20)) {
        console.log(`  ${m.id}  ${JSON.stringify(m.oldStatus)} → ${m.newStatus}`);
      }
    } else if (plan.toMigrate.length > 20) {
      console.log(`[migrate] (${plan.toMigrate.length} migrations — first 5 shown)`);
      for (const m of plan.toMigrate.slice(0, 5)) {
        console.log(`  ${m.id}  ${JSON.stringify(m.oldStatus)} → ${m.newStatus}`);
      }
    }
  }

  if (!force) {
    console.log('[migrate] DRY-RUN — no writes. Pass --force to apply.');
    return;
  }

  if (plan.toMigrate.length === 0) {
    console.log('[migrate] nothing to write.');
    return;
  }

  console.log(`[migrate] APPLYING ${plan.toMigrate.length} updates…`);
  const res = await applyMigration(plan.toMigrate, db, 'caisse_transactions');
  console.log(`[migrate] done — written=${res.written}  chunks=${res.chunks}`);
}


// ============================================================================
// Exports (for tests)
// ============================================================================

module.exports = { planMigration, applyMigration, CANONICAL_STATUSES, FALLBACK_STATUS };

// Run CLI when invoked directly
if (require.main === module) {
  _cliMain().catch(err => {
    console.error('[migrate] FATAL:', err);
    process.exit(1);
  });
}
