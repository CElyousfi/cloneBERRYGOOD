#!/usr/bin/env node
// @ts-check
/**
 * 002_seed.js — Migrate Finance collections from Firestore to Postgres.
 *
 * Usage:
 *   node 002_seed.js [--dry-run] [--collection=invoices]
 *
 * Prerequisites:
 *   - SUPABASE_SERVICE_ROLE_KEY in env
 *   - GOOGLE_APPLICATION_CREDENTIALS or firebase admin initialized
 *   - Run from project root: node scripts/migrate-finance-to-postgres/002_seed.js
 */
'use strict';

const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_COLLECTION = process.argv.find(a => a.startsWith('--collection='))?.split('=')[1];

const SUPABASE_URL = 'https://eqopexrgcottuzfkywgi.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function safeDate(d) {
    if (!d) return null;
    if (d.toDate) return d.toDate().toISOString();
    return new Date(d).toISOString();
}

/** Collections to migrate: [firestoreCollection, postgresTable, transformFn] */
const MIGRATIONS = [
  {
    collection: 'invoices',
    table: 'finance.invoices',
    transform: (doc) => ({
      firestore_id: doc.id,
      numero_facture: doc.numero_facture || doc.reference || null,
      fournisseur: doc.fournisseur || doc.supplier || null,
      montant: parseFloat(doc.montant || doc.amount || 0),
      tva: parseFloat(doc.tva || 0),
      montant_ttc: parseFloat(doc.montant_ttc || doc.total || doc.montant || 0),
      payment_status: doc.payment_status || 'non_payee',
      ferme: doc.ferme || null,
      date_facture: safeDate(doc.date_facture || doc.date),
      date_validation_achats: safeDate(doc.date_validation_achats),
      date_validation_finance: safeDate(doc.date_validation_finance),
      date_validation_dg: safeDate(doc.date_validation_dg),
      validated_by_achats: doc.validated_by_achats || null,
      validated_by_finance: doc.validated_by_finance || null,
      validated_by_dg: doc.validated_by_dg || null,
      notes: doc.notes || null,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'caisse',
    table: 'finance.caisse_transactions',
    transform: (doc) => ({
      firestore_id: doc.id,
      type: doc.type || null,
      montant: parseFloat(doc.montant || 0),
      description: doc.description || doc.motif || null,
      date: safeDate(doc.date),
      ferme: doc.ferme || null,
      categorie: doc.categorie || null,
      justificatif_url: doc.justificatif_url || null,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'demandes_virement',
    table: 'finance.virements',
    transform: (doc) => ({
      firestore_id: doc.id,
      bdc_id: doc.bdc_id || null,
      montant: parseFloat(doc.montant || 0),
      banque: doc.banque || null,
      reference: doc.reference || doc.numero || null,
      status: doc.status || doc.statut || null,
      date_virement: safeDate(doc.date_virement || doc.date),
      ferme: doc.ferme || null,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'ojra_payroll',
    table: 'finance.ojra_payroll',
    transform: (doc) => ({
      firestore_id: doc.id,
      quinzaine: doc.quinzaine || doc.week || null,
      ferme: doc.ferme || null,
      matricule: doc.matricule || null,
      nom: doc.nom || null,
      poste: doc.poste || null,
      jours_travailles: parseFloat(doc.jours_travailles || 0),
      salaire_base: parseFloat(doc.salaire_base || 0),
      primes: parseFloat(doc.primes || 0),
      retenues: parseFloat(doc.retenues || 0),
      net_a_payer: parseFloat(doc.net_a_payer || doc.netPayable || 0),
      statut: doc.statut || doc.status || null,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'liquidations',
    table: 'finance.liquidations',
    transform: (doc) => ({
      firestore_id: doc.id,
      quinzaine: doc.quinzaine || (doc.week ? `W${doc.week}` : null),
      ferme: doc.ferme || null,
      variete: doc.variete || doc.fruit || null,
      kg_total: parseFloat(doc.kg_total || doc.totalKg || doc.summary?.totalKg || 0),
      prix_unitaire: parseFloat(doc.prix_unitaire || doc.netSalesEurKg || 0),
      montant_total: parseFloat(doc.montant_total || doc.netPayable || 0),
      type_expedition: doc.type_expedition || (doc.id.includes('BLUE') ? 'blue' : 'local'),
      statut: doc.statut || doc.status || null,
      date_liquidation: safeDate(doc.date_liquidation || doc.date),
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'encaissements',
    table: 'finance.encaissements',
    transform: (doc) => ({
      firestore_id: doc.id,
      compte_client_id: doc.compte_client_id || doc.client_id || null,
      montant: parseFloat(doc.montant || 0),
      mode_paiement: doc.mode_paiement || null,
      date_encaissement: safeDate(doc.date_encaissement || doc.date),
      reference: doc.reference || null,
      ferme: doc.ferme || null,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'comptes_clients',
    table: 'finance.comptes_clients',
    transform: (doc) => ({
      firestore_id: doc.id,
      nom: doc.nom || null,
      telephone: doc.telephone || doc.phone || null,
      adresse: doc.adresse || doc.address || null,
      solde_initial: parseFloat(doc.solde_initial || 0),
      type: doc.type || (doc.id.includes('LOCAL') ? 'marche_local' : 'exportateur'),
      actif: doc.actif !== false,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'codes_analytiques',
    table: 'finance.codes_analytiques',
    transform: (doc) => ({
      firestore_id: doc.id,
      code: doc.code || doc.id || null,
      libelle: doc.libelle || null,
      domaine: doc.domaine || null,
      ferme: doc.ferme || null,
      actif: doc.actif !== false,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'budget_campagne',
    table: 'finance.budget_campagne',
    transform: (doc) => ({
      firestore_id: doc.id,
      campagne: doc.campagne || null,
      ferme: doc.ferme || null,
      categorie: doc.categorie || null,
      sous_categorie: doc.sous_categorie || null,
      montant_budget: parseFloat(doc.montant_budget || 0),
      montant_reel: parseFloat(doc.montant_reel || 0),
      quinzaine: doc.quinzaine || null,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'fuel_transactions',
    table: 'finance.fuel_transactions',
    transform: (doc) => ({
      firestore_id: doc.id,
      date_transaction: safeDate(doc.date_transaction || doc.date),
      vehicule: doc.vehicule || doc.vehicle || null,
      conducteur: doc.conducteur || doc.driver || null,
      litres: parseFloat(doc.litres || doc.quantity || 0),
      prix_litre: parseFloat(doc.prix_litre || doc.price_per_litre || 0),
      montant: parseFloat(doc.montant || doc.total || 0),
      ferme: doc.ferme || null,
      odometer: parseFloat(doc.odometer || 0),
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  },
  {
    collection: 'telecom_bills',
    table: 'finance.telecom_bills',
    transform: (doc) => ({
      firestore_id: doc.id,
      operateur: doc.operateur || doc.operator || null,
      mois: doc.mois || doc.month || null,
      numero: doc.numero || doc.phone_number || null,
      montant_ht: parseFloat(doc.montant_ht || 0),
      montant_ttc: parseFloat(doc.montant_ttc || doc.total || 0),
      type: doc.type || null,
      statut_paiement: doc.statut_paiement || doc.status || null,
      created_by: doc.created_by?.profileId || doc.created_by || doc.createdBy?.profileId || doc.createdBy || 'migration',
      created_at: safeDate(doc.createdAt || doc.created_at) || new Date().toISOString(),
    }),
  }
];

async function migrateCollection({ collection, table, transform }) {
  if (ONLY_COLLECTION && ONLY_COLLECTION !== collection) return;
  
  console.log(`\n📦 Migrating ${collection} → ${table}...`);
  const snap = await db.collection(collection).get();
  console.log(`   Found ${snap.docs.length} documents`);
  
  if (DRY_RUN) {
    console.log('   [DRY RUN] Would insert', snap.docs.length, 'rows');
    if (snap.docs[0]) console.log('   Sample:', JSON.stringify(transform({ id: snap.docs[0].id, ...snap.docs[0].data() }), null, 2));
    return { collection, inserted: 0, total: snap.docs.length };
  }
  
  const rows = snap.docs.map(d => transform({ id: d.id, ...d.data() }));
  
  // Batch insert in chunks of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase.schema('finance').from(table.replace('finance.', '')).upsert(batch, {
      onConflict: 'firestore_id',
      ignoreDuplicates: false,
    });
    if (error) throw new Error(`Insert error in ${table}: ${error.message}`);
    inserted += batch.length;
    process.stdout.write(`   ${inserted}/${rows.length}\r`);
  }
  console.log(`   ✅ Inserted ${inserted} rows into ${table}`);
  return { collection, inserted, total: rows.length };
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN MODE' : '🚀 LIVE MIGRATION');
  console.log('Target:', SUPABASE_URL);
  
  const results = [];
  for (const migration of MIGRATIONS) {
    try {
      results.push(await migrateCollection(migration));
    } catch (err) {
      console.error(`❌ Failed ${migration.collection}:`, err.message);
      results.push({ collection: migration.collection, error: err.message });
    }
  }
  
  console.log('\n📊 Summary:');
  for (const r of results) {
    if (r.error) console.log(`  ❌ ${r.collection}: ${r.error}`);
    else console.log(`  ✅ ${r.collection}: ${r.inserted}/${r.total} rows`);
  }
  
  const hasErrors = results.some(r => r.error);
  process.exit(hasErrors ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
