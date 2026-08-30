#!/usr/bin/env node
// @ts-check
/**
 * 003_validate.js — Validate Firestore vs Postgres data consistency.
 * Exit 0 = clean, Exit 1 = discrepancies found.
 */
'use strict';

const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://eqopexrgcottuzfkywgi.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CHECKS = [
  { collection: 'invoices', table: 'invoices', montantField: 'montant_ttc', firestoreMontant: 'montant_ttc' },
  { collection: 'caisse', table: 'caisse_transactions', montantField: 'montant', firestoreMontant: 'montant' },
  { collection: 'liquidations', table: 'liquidations', montantField: 'montant_total', firestoreMontant: 'montant_total' },
  { collection: 'demandes_virement', table: 'virements', montantField: 'montant', firestoreMontant: 'montant' },
  { collection: 'ojra_payroll', table: 'ojra_payroll', montantField: 'net_a_payer', firestoreMontant: 'net_a_payer' }
];

async function check({ collection, table, montantField, firestoreMontant }) {
  const [fsSnap, pgResult] = await Promise.all([
    db.collection(collection).get(),
    supabase.schema('finance').from(table).select('id', { count: 'exact', head: true }),
  ]);
  
  const fsCount = fsSnap.docs.length;
  const pgCount = pgResult.count ?? 0;
  
  // Sum montants in Firestore
  const fsTotal = fsSnap.docs.reduce((sum, d) => sum + (parseFloat(d.data()[firestoreMontant] || d.data().netPayable) || 0), 0);
  
  // Sum montants in Postgres
  const { data: pgSumData } = await supabase.schema('finance').from(table).select(montantField);
  const pgTotal = (pgSumData || []).reduce((sum, r) => sum + (parseFloat(r[montantField]) || 0), 0);
  
  const countMatch = fsCount === pgCount;
  const totalMatch = Math.abs(fsTotal - pgTotal) < 0.01; // allow 1 centime rounding
  
  return { collection, fsCount, pgCount, fsTotal, pgTotal, countMatch, totalMatch };
}

async function main() {
  console.log('🔍 Finance Migration Validation');
  console.log('================================');
  
  let allOk = true;
  for (const checkDef of CHECKS) {
    const r = await check(checkDef);
    const status = r.countMatch && r.totalMatch ? '✅' : '❌';
    if (!r.countMatch || !r.totalMatch) allOk = false;
    console.log(`${status} ${r.collection}:`);
    console.log(`   Count: Firestore=${r.fsCount} Postgres=${r.pgCount} ${r.countMatch ? 'MATCH' : 'MISMATCH ⚠️'}`);
    console.log(`   Total: Firestore=${r.fsTotal.toFixed(2)} Postgres=${r.pgTotal.toFixed(2)} ${r.totalMatch ? 'MATCH' : 'MISMATCH ⚠️'}`);
  }
  
  console.log('\nResult:', allOk ? '✅ All checks passed' : '❌ Discrepancies found — do NOT cut over');
  process.exit(allOk ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
