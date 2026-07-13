'use strict';

/**
 * import-referentiel-taches.js
 * Importe les 126 opérations du référentiel BEE ONE (Excel) dans Firestore.
 * Collection : referentiel_taches
 * Exécuter depuis le répertoire du projet :
 *   node scripts/seeds/import-referentiel-taches.js
 */

const path = require('path');
const PROJECT_DIR = path.resolve(__dirname, '../../');

// Firebase Admin via Application Default Credentials
const admin = require(path.join(PROJECT_DIR, 'functions/node_modules/firebase-admin'));
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'berrygood-farms-dashboard' });
}
const db = admin.firestore();

// xlsx from functions/node_modules
const XLSX = require(path.join(PROJECT_DIR, 'functions/node_modules/xlsx'));

const EXCEL_PATH = path.join(PROJECT_DIR, 'docs/CAMPAGNE 2026 _REFERENTIEL_ OPERATIONS  MAJ AVRIL.26.xlsx');

function sanitizeDocId(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 80);
}

async function run() {
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  console.log(`Total rows in sheet (including headers): ${rows.length}`);
  console.log('Row 0 (titre):', rows[0]);
  console.log('Row 1 (en-tête):', rows[1]);
  console.log('Row 2 (première donnée):', rows[2]);

  // Skip row 0 (titre) and row 1 (en-tête)
  const dataRows = rows.slice(2).filter(r => r[0] && r[3]); // must have code and operation

  console.log(`\nData rows to import: ${dataRows.length}`);

  const BATCH_SIZE = 400;
  let batchCount = 0;
  let totalWritten = 0;

  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const chunk = dataRows.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j];
      const code = String(row[0] || '').trim();
      const groupe = String(row[1] || '').trim();
      const famille = String(row[2] || '').trim();
      const operation = String(row[3] || '').trim();
      const ordre = i + j; // 0-based index overall

      if (!code || !operation) continue;

      const docId = `${code}_${sanitizeDocId(operation)}`;
      const ref = db.collection('referentiel_taches').doc(docId);

      batch.set(ref, {
        code,
        groupe,
        famille,
        operation,
        ordre,
        actif: true,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    batchCount++;
    totalWritten += chunk.length;
    console.log(`Batch ${batchCount} : ${chunk.length} docs écrits (total: ${totalWritten})`);
  }

  console.log(`\nImport terminé : ${totalWritten} documents dans referentiel_taches`);

  // Verify by reading back 3 docs
  console.log('\n--- Vérification (3 premiers docs) ---');
  const snap = await db.collection('referentiel_taches').orderBy('ordre').limit(3).get();
  snap.forEach(doc => {
    const d = doc.data();
    console.log(`  ${doc.id}: code=${d.code}, famille=${d.famille}, operation=${d.operation}, ordre=${d.ordre}`);
  });
}

run().catch(err => {
  console.error('ERREUR:', err);
  process.exit(1);
});
