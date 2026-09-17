/**
 * Audit DQR: Compare XLSX source data from emails with expeditions in Firestore.
 *
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=... node functions/audit-dqr.js
 * Or: cd functions && node audit-dqr.js  (if gcloud auth configured)
 */
const admin = require("firebase-admin");
const XLSX = require("xlsx");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

// --- Copy of parseDailyQualityReportXlsx from emailService.js ---
function parseDailyQualityReportXlsx(xlsxBuffer) {
  const workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find(n => /inspection/i.test(n)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Report sheet names and headers
  console.log(`  Sheets: ${workbook.SheetNames.join(', ')}`);
  console.log(`  Using sheet: "${sheetName}"`);

  // Expand merged cells
  if (sheet['!merges']) {
    console.log(`  Merged cell ranges: ${sheet['!merges'].length}`);
    for (const merge of sheet['!merges']) {
      const origin = sheet[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })];
      if (!origin) continue;
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (r === merge.s.r && c === merge.s.c) continue;
          sheet[XLSX.utils.encode_cell({ r, c })] = { ...origin };
        }
      }
    }
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  // Report actual column headers
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    console.log(`  Columns (${headers.length}): ${headers.join(' | ')}`);
  }
  console.log(`  Total rows (with defval): ${rows.length}`);

  // Check for expected columns
  const expectedCols = ['Batchid', 'BatchId', 'Receipt ID', 'ReceiptID', 'Variety', 'Berry Type', 'BerryType',
    'Weight (KG)', 'Weight(KG)', 'Weight', 'Quantity', 'Brix', 'Brix Points', 'Enriched PQ Score',
    'Inspection Result', 'InspectionResult', 'Inspection Type', 'InspectionType', 'Ranch Name', 'RanchName',
    'Receipt Date', 'ReceiptDate', 'Total Fruit Inspected', 'Product Name', 'ProductName', 'Warehouse',
    'Initial Inspection PQ score', 'Re-Inspection PQ'];
  if (rows.length > 0) {
    const actualHeaders = Object.keys(rows[0]);
    const missing = expectedCols.filter(col => !actualHeaders.includes(col));
    // Group by logical field
    const logicalFields = {
      'batchId': ['Batchid', 'BatchId', 'batchid', 'BatchID', 'BATCHID'],
      'receiptId': ['Receipt ID', 'ReceiptID'],
      'variety': ['Variety'],
      'berryType': ['Berry Type', 'BerryType'],
      'weight': ['Weight (KG)', 'Weight(KG)', 'Weight'],
      'quantity': ['Quantity'],
      'brix': ['Brix'],
      'brixPoints': ['Brix Points'],
      'enrichedPqScore': ['Enriched PQ Score'],
      'inspResult': ['Inspection Result', 'InspectionResult'],
      'inspType': ['Inspection Type', 'InspectionType'],
      'ranchName': ['Ranch Name', 'RanchName'],
      'receiptDate': ['Receipt Date', 'ReceiptDate'],
    };
    console.log(`\n  === COLUMN MAPPING CHECK ===`);
    for (const [field, variants] of Object.entries(logicalFields)) {
      const found = variants.find(v => actualHeaders.includes(v));
      if (found) {
        console.log(`  ✓ ${field} → "${found}"`);
      } else {
        console.log(`  ✗ ${field} → MISSING (tried: ${variants.join(', ')})`);
      }
    }
  }

  const results = [];
  let lastReceiptId = null, lastReceiptDate = null, lastRanchName = null;
  let lastWarehouse = null, lastBerryType = null, lastVariety = null, lastProductName = null;

  for (const row of rows) {
    const batchId = row["Batchid"] || row["BatchId"] || row["batchid"] || row["BatchID"] || row["BATCHID"] || null;
    if (!batchId) continue;

    const currentReceiptId = (row["Receipt ID"] || row["ReceiptID"] || "").toString().replace(/‑/g, "-");
    if (currentReceiptId) lastReceiptId = currentReceiptId;
    const currentReceiptDate = row["Receipt Date"] || row["ReceiptDate"] || null;
    if (currentReceiptDate) lastReceiptDate = currentReceiptDate;
    const currentRanchName = row["Ranch Name"] || row["RanchName"] || null;
    if (currentRanchName) lastRanchName = currentRanchName;
    const currentWarehouse = row["Warehouse"] || null;
    if (currentWarehouse) lastWarehouse = currentWarehouse;
    const currentBerryType = row["Berry Type"] || row["BerryType"] || null;
    if (currentBerryType) lastBerryType = currentBerryType;
    const currentVariety = row["Variety"] || null;
    if (currentVariety) lastVariety = currentVariety;
    const currentProductName = row["Product Name"] || row["ProductName"] || null;
    if (currentProductName) lastProductName = currentProductName;

    const rawInspResult = row["Inspection Result"] || row["InspectionResult"] || null;
    const rawInspType = row["Inspection Type"] || row["InspectionType"] || null;
    const isByPass = (rawInspType || '').toLowerCase().includes('by') && (rawInspType || '').toLowerCase().includes('pass');
    const inspectionResult = (rawInspResult && rawInspResult !== 'Null') ? rawInspResult : (isByPass ? 'Pass' : null);

    results.push({
      receiptId: currentReceiptId || lastReceiptId || "",
      berryType: currentBerryType || lastBerryType || null,
      variety: ((currentVariety || lastVariety || "").toString()).replace(/[™®]/g, ""),
      productName: currentProductName || lastProductName || null,
      inspectionResult,
      inspectionType: rawInspType,
      batchId,
      quantity: parseFloat(row["Quantity"] || 0) || 0,
      weight: parseFloat(row["Weight (KG)"] || row["Weight(KG)"] || row["Weight"] || 0) || 0,
      brix: parseFloat(row["Brix"]) || 0,
      brixPoints: parseFloat(row["Brix Points"]) || 0,
      enrichedPqScore: parseFloat(row["Enriched PQ Score"]) || 0,
      initialPq: parseFloat(row["Initial Inspection PQ score"]) || 0,
      reInspectionPq: parseFloat(row["Re-Inspection PQ"]) || 0,
      totalFruitInspected: parseFloat(row["Total Fruit Inspected"]) || 0,
      ranchName: currentRanchName || lastRanchName || null,
      receiptDate: currentReceiptDate || lastReceiptDate || null,
      warehouse: currentWarehouse || lastWarehouse || null,
    });
  }

  return results;
}

const ranchNameToCode = (name) => {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('r-berry') || n.includes('r berry') || n.includes('200742')) return '200742';
  if (n.includes('sarl 3') || n.includes('berry good farms sarl') || n.includes('berry good farms') || n.includes('200876')) return '200876';
  return null;
};

async function main() {
  console.log("=== DQR AUDIT: Comparing XLSX source vs Firestore expeditions ===\n");

  // 1. Fetch recent DQR emails with xlsxBase64
  const emailsSnap = await db.collection("emails")
    .where("isDailyQualityReport", "==", true)
    .orderBy("date", "desc")
    .limit(10)
    .get();

  console.log(`Found ${emailsSnap.size} recent DQR emails\n`);

  let totalIssues = 0;

  for (const emailDoc of emailsSnap.docs) {
    const email = emailDoc.data();
    const emailId = emailDoc.id;
    const subject = email.subject || '(no subject)';
    const emailDate = email.date || '';

    console.log(`\n${'='.repeat(80)}`);
    console.log(`EMAIL: ${emailId}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Date: ${emailDate}`);
    console.log(`  Has xlsxBase64: ${!!email.xlsxBase64}`);
    console.log(`  Attachments: ${(email.attachments || []).map(a => a.filename).join(', ') || 'none'}`);

    if (!email.xlsxBase64) {
      console.log(`  ⚠ NO XLSX DATA — cannot audit`);
      totalIssues++;
      continue;
    }

    // 2. Re-parse XLSX
    const xlsxBuffer = Buffer.from(email.xlsxBase64, "base64");
    const brixRows = parseDailyQualityReportXlsx(xlsxBuffer);
    console.log(`\n  Parsed ${brixRows.length} brixRows from XLSX`);

    // Rows with valid inspection result (same filter as expedition creation)
    const validRows = brixRows.filter(r => {
      const isByPass = (r.inspectionType || '').toLowerCase().includes('by') && (r.inspectionType || '').toLowerCase().includes('pass');
      const effectiveResult = (r.inspectionResult && r.inspectionResult !== 'Null') ? r.inspectionResult : (isByPass ? 'Pass' : null);
      return !!effectiveResult;
    });
    const skippedRows = brixRows.length - validRows.length;
    console.log(`  Valid rows (with result): ${validRows.length}`);
    console.log(`  Skipped rows (no result): ${skippedRows}`);

    // 3. Calculate expected dateISO (J-1)
    const dqrEmailDate = email.date ? new Date(email.date) : new Date();
    const dqrVeille = new Date(dqrEmailDate);
    dqrVeille.setDate(dqrVeille.getDate() - 1);
    const dqrVeilleISO = dqrVeille.toISOString().split('T')[0];
    console.log(`  Expected dateISO (J-1): ${dqrVeilleISO}`);

    // Check receiptDate from XLSX vs computed dateISO
    const xlsxDates = [...new Set(brixRows.map(r => r.receiptDate).filter(Boolean))];
    console.log(`  Receipt dates in XLSX: ${xlsxDates.join(', ') || '(none)'}`);
    if (xlsxDates.length > 0) {
      const mismatch = xlsxDates.some(d => {
        // Try to parse the receipt date to compare
        const parsed = new Date(d);
        if (isNaN(parsed)) return false;
        const parsedISO = parsed.toISOString().split('T')[0];
        return parsedISO !== dqrVeilleISO;
      });
      if (mismatch) {
        console.log(`  ⚠ DATE MISMATCH: XLSX receiptDate doesn't match J-1 (${dqrVeilleISO})`);
        totalIssues++;
      } else {
        console.log(`  ✓ Dates consistent`);
      }
    }

    // 4. Fetch expeditions for this date
    const expSnap = await db.collection("expeditions")
      .where("source", "==", "dqr-auto-created")
      .where("dateISO", "==", dqrVeilleISO)
      .get();

    const expeditions = [];
    expSnap.forEach(doc => expeditions.push({ id: doc.id, ...doc.data() }));
    console.log(`\n  Expeditions in Firestore for ${dqrVeilleISO}: ${expeditions.length}`);

    // 5. Compare counts
    if (validRows.length !== expeditions.length) {
      console.log(`  ⚠ COUNT MISMATCH: ${validRows.length} valid XLSX rows vs ${expeditions.length} expeditions`);
      totalIssues++;
    } else {
      console.log(`  ✓ Count matches: ${validRows.length}`);
    }

    // 6. Match by batchId and compare fields
    const expByBatch = {};
    for (const exp of expeditions) {
      const key = exp.batchNumber || exp.batchId;
      if (key) expByBatch[key] = exp;
    }

    let fieldMismatches = 0;
    const unmatchedXlsx = [];
    const ranchIssues = [];

    for (const row of validRows) {
      const exp = expByBatch[row.batchId];
      if (!exp) {
        unmatchedXlsx.push(row.batchId);
        continue;
      }

      // Compare key fields
      const checks = [
        { field: 'variety', xlsx: (row.variety || '').trim(), fs: (exp.variety || '').trim() },
        { field: 'batchWeight', xlsx: row.weight, fs: parseFloat(exp.batchWeight) || 0 },
        { field: 'batchQuantity', xlsx: row.quantity, fs: parseFloat(exp.batchQuantity) || 0 },
        { field: 'brix/brixFromDQR', xlsx: row.brix, fs: parseFloat(exp.brixFromDQR || exp.brix) || 0 },
        { field: 'overallResult', xlsx: row.inspectionResult, fs: exp.overallResult },
        { field: 'enrichedPqScore', xlsx: row.enrichedPqScore, fs: parseFloat(exp.enrichedPqScore) || 0 },
        { field: 'receiptId', xlsx: (row.receiptId || '').trim(), fs: (exp.receiptId || '').trim() },
      ];

      for (const chk of checks) {
        const xlsxVal = typeof chk.xlsx === 'number' ? chk.xlsx : (chk.xlsx || '');
        const fsVal = typeof chk.fs === 'number' ? chk.fs : (chk.fs || '');
        if (String(xlsxVal) !== String(fsVal)) {
          if (fieldMismatches < 20) {
            console.log(`  ⚠ FIELD MISMATCH [${row.batchId}] ${chk.field}: XLSX="${xlsxVal}" vs FS="${fsVal}"`);
          }
          fieldMismatches++;
        }
      }

      // Check ranch mapping
      const expectedRanch = ranchNameToCode(row.ranchName);
      if (expectedRanch && exp.ranch && expectedRanch !== exp.ranch) {
        ranchIssues.push({ batchId: row.batchId, xlsx: row.ranchName, expected: expectedRanch, actual: exp.ranch });
      }
      if (!expectedRanch && row.ranchName) {
        ranchIssues.push({ batchId: row.batchId, xlsx: row.ranchName, expected: 'UNMAPPED', actual: exp.ranch });
      }
    }

    if (unmatchedXlsx.length > 0) {
      console.log(`  ⚠ ${unmatchedXlsx.length} XLSX rows NOT found in expeditions: ${unmatchedXlsx.slice(0, 10).join(', ')}${unmatchedXlsx.length > 10 ? '...' : ''}`);
      totalIssues++;
    }

    // Check expeditions not in XLSX
    const xlsxBatchIds = new Set(validRows.map(r => r.batchId));
    const unmatchedExp = expeditions.filter(e => !xlsxBatchIds.has(e.batchNumber));
    if (unmatchedExp.length > 0) {
      console.log(`  ⚠ ${unmatchedExp.length} expeditions NOT found in XLSX: ${unmatchedExp.slice(0, 10).map(e => e.batchNumber).join(', ')}`);
      totalIssues++;
    }

    if (fieldMismatches > 0) {
      console.log(`  ⚠ Total field mismatches: ${fieldMismatches}`);
      totalIssues++;
    } else if (unmatchedXlsx.length === 0 && unmatchedExp.length === 0) {
      console.log(`  ✓ All fields match perfectly`);
    }

    if (ranchIssues.length > 0) {
      console.log(`  ⚠ Ranch mapping issues:`);
      for (const ri of ranchIssues.slice(0, 5)) {
        console.log(`    ${ri.batchId}: "${ri.xlsx}" → expected ${ri.expected}, got ${ri.actual}`);
      }
      totalIssues++;
    }

    // Summary per ranch
    const byRanch = {};
    for (const row of validRows) {
      const ranch = ranchNameToCode(row.ranchName) || 'unknown';
      if (!byRanch[ranch]) byRanch[ranch] = { count: 0, kg: 0, pass: 0, fail: 0 };
      byRanch[ranch].count++;
      byRanch[ranch].kg += row.weight;
      if ((row.inspectionResult || '').toLowerCase() === 'pass') byRanch[ranch].pass++;
      else byRanch[ranch].fail++;
    }
    console.log(`\n  Summary by ranch (from XLSX):`);
    for (const [ranch, stats] of Object.entries(byRanch)) {
      const ferme = ranch === '200742' ? 'F1' : ranch === '200876' ? 'F5' : ranch;
      console.log(`    ${ferme}: ${stats.count} lots, ${stats.kg.toFixed(1)} kg, ${stats.pass} pass, ${stats.fail} fail`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`AUDIT COMPLETE: ${totalIssues} issue(s) found`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
