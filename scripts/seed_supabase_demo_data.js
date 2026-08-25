// @ts-check
/**
 * Smart BERRY — Supabase Live Seed Script
 * Inserts realistic demonstration data for Finance and Qualité into Supabase REST API.
 */
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const SUPABASE_URL = 'https://eqopexrgcottuzfkywgi.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxb3BleHJnY290dHV6Zmt5d2dpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY2MDg0NiwiZXhwIjoyMTAzMjM2ODQ2fQ.WLGypXzTcRl5qDxYPFxL3-HD7NTNUvx_Mn4Cf3xed4A';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket }
});

async function runSeed() {
  console.log('🌱 Populating Supabase Demo Data...');

  // 1. Seed Invoices
  const invoices = [
    { firestore_id: 'inv_demo_1', numero_facture: 'FACT-2026-001', fournisseur: 'Agro Chem Maghreb', montant: 40000, tva: 5200, montant_ttc: 45200, payment_status: 'validee_finance', ferme: 'Ferme 1 - Souss', date_facture: new Date().toISOString() },
    { firestore_id: 'inv_demo_2', numero_facture: 'FACT-2026-002', fournisseur: 'Plastiques du Sud SA', montant: 16000, tva: 2750, montant_ttc: 18750, payment_status: 'validee_achats', ferme: 'Ferme 2 - Loukkos', date_facture: new Date().toISOString() },
    { firestore_id: 'inv_demo_3', numero_facture: 'FACT-2026-003', fournisseur: 'Irrigation Maroc SARL', montant: 80000, tva: 9400, montant_ttc: 89400, payment_status: 'payee', ferme: 'Ferme 1 - Souss', date_facture: new Date().toISOString() }
  ];

  const invRes = await supabase.from('invoices').upsert(invoices, { onConflict: 'firestore_id' });
  console.log('Invoices Seed Result:', invRes.error ? '❌ ' + invRes.error.message : '✅ Success');

  // 2. Seed Caisse Transactions
  const caisse = [
    { firestore_id: 'caisse_demo_1', type: 'recette', montant: 8500, description: 'Vente Marché Local Caisses', date: new Date().toISOString(), ferme: 'Ferme 1 - Souss', categorie: 'Ventes' },
    { firestore_id: 'caisse_demo_2', type: 'depense', montant: 1200, description: 'Achat Gasoil Tracteur #4', date: new Date().toISOString(), ferme: 'Ferme 1 - Souss', categorie: 'Carburant' }
  ];

  const caisseRes = await supabase.from('caisse_transactions').upsert(caisse, { onConflict: 'firestore_id' });
  console.log('Caisse Seed Result:', caisseRes.error ? '❌ ' + caisseRes.error.message : '✅ Success');

  // 3. Seed Inspections
  const inspections = [
    { firestore_id: 'insp_demo_1', ferme: 'Ferme 1 - Souss', variete: 'Fraise Star', date_inspection: new Date().toISOString(), inspecteur: 'K. Reda', defaut_type: 'Coloration', defaut_pct: 1.2, classification: 'Conforme (Cat A)' },
    { firestore_id: 'insp_demo_2', ferme: 'Ferme 2 - Loukkos', variete: 'Framboise Diamond', date_inspection: new Date().toISOString(), inspecteur: 'M. Alami', defaut_type: 'Calibre', defaut_pct: 2.5, classification: 'Conforme (Cat A)' }
  ];

  const inspRes = await supabase.from('inspections').upsert(inspections, { onConflict: 'firestore_id' });
  console.log('Inspections Seed Result:', inspRes.error ? '❌ ' + inspRes.error.message : '✅ Success');

  console.log('✨ Seed Process Complete!');
}

runSeed();
