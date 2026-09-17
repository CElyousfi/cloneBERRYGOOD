const XLSX = require("xlsx");

// Heuristic Excel parser for OJRA payroll exports.
// We do not yet have a fixed schema (Phase 1 discovery is pending) so the parser
// detects the header row and maps columns by fuzzy keyword match.
// When the real OJRA export format is known, tighten COLUMN_PATTERNS accordingly.

const COLUMN_PATTERNS = [
  { key: "matricule", patterns: [/^matricule$/i, /^mat\.?$/i, /^n[°o]\s*matricule/i, /^code\s*emp/i] },
  { key: "nom", patterns: [/^nom$/i, /^nom\s*&?\s*prenom/i, /^nom\s+et\s+prenom/i, /^employ[ée]/i, /^salari[ée]/i, /^d[eé]signation$/i] },
  { key: "prenom", patterns: [/^pr[ée]nom$/i] },
  { key: "poste", patterns: [/^poste$/i, /^fonction$/i, /^emploi$/i, /^cat[ée]gorie$/i] },
  { key: "service", patterns: [/^service$/i, /^d[ée]partement$/i, /^direction$/i] },
  { key: "ferme", patterns: [/^ferme$/i, /^site$/i, /^chantier$/i] },
  { key: "joursTravailles", patterns: [/jours?\s*travaill/i, /^jt$/i, /^nb\s*jours?$/i] },
  { key: "heuresNormales", patterns: [/heures?\s*norm/i, /^hn$/i] },
  { key: "heuresSupp", patterns: [/heures?\s*sup/i, /^hs$/i] },
  { key: "salaireBase", patterns: [/salaire\s*de?\s*base/i, /^sbr?$/i] },
  { key: "salaireBrut", patterns: [/^salaire\s*brut/i, /^brut\s*global/i, /^brut$/i, /^sbg$/i, /^sbi$/i] },
  { key: "salaireImposable", patterns: [/^(salaire\s*)?imposable/i, /^sni$/i] },
  { key: "salaireNet", patterns: [/^salaire\s*net/i, /^net\s*[àa]\s*payer/i, /^net$/i, /^snt$/i] },
  { key: "cnssEmploye", patterns: [/cnss.*sal/i, /cotis.*cnss.*sal/i, /^cnss$/i] },
  { key: "cnssEmployeur", patterns: [/cnss.*pat/i, /cotis.*cnss.*pat/i, /^cnss\s*emp/i] },
  { key: "amoEmploye", patterns: [/amo.*sal/i, /^amo$/i] },
  { key: "amoEmployeur", patterns: [/amo.*pat/i] },
  { key: "ir", patterns: [/^i\.?r\.?$/i, /^igr$/i, /imp[oô]t/i] },
  { key: "cimr", patterns: [/^cimr$/i, /retraite\s*compl/i] },
  { key: "mutuelle", patterns: [/mutuelle/i, /^assurance$/i] },
  { key: "primes", patterns: [/^primes?$/i, /^bonus$/i, /^indemnit[ée]s?$/i] },
  { key: "avances", patterns: [/^avances?$/i, /^acomptes?$/i] },
  { key: "retenues", patterns: [/^retenues?$/i, /^d[ée]ductions?$/i] },
  { key: "rib", patterns: [/^rib$/i, /^iban$/i, /num[ée]ro\s*compte/i] },
  { key: "modePaiement", patterns: [/mode\s*pa(i|y)ement/i, /paiement/i] },
];

function normalizeHeader(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

function matchColumn(headerCell) {
  const h = normalizeHeader(headerCell);
  if (!h) return null;
  for (const col of COLUMN_PATTERNS) {
    for (const pat of col.patterns) {
      if (pat.test(h)) return col.key;
    }
  }
  return null;
}

// Find the row that maximizes the number of recognized column names.
// Scans the first 25 rows of a sheet (headers can be preceded by a title block).
function findHeaderRow(rows) {
  let bestIdx = -1;
  let bestScore = 0;
  let bestMap = null;
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    const map = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const key = matchColumn(row[c]);
      if (key && map[key] === undefined) {
        map[key] = c;
        score++;
      }
    }
    // Need at least an identifier (matricule or nom) and one money column to count.
    const hasIdentifier = map.matricule !== undefined || map.nom !== undefined;
    const hasMoney = map.salaireBrut !== undefined || map.salaireNet !== undefined ||
                     map.salaireBase !== undefined || map.cnssEmploye !== undefined;
    if (score > bestScore && hasIdentifier && hasMoney) {
      bestScore = score;
      bestIdx = i;
      bestMap = map;
    }
  }
  return bestIdx >= 0 ? { headerRow: bestIdx, columnMap: bestMap, score: bestScore } : null;
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  // Strip thousands separators (space, non-breaking space, comma, apostrophe)
  // and accept comma as decimal separator (FR locale).
  const cleaned = String(v).replace(/[\s ']/g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function toString(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// Heuristic: skip rows that are blank or look like totals.
function isDataRow(row, columnMap) {
  if (!row || row.length === 0) return false;
  const matCell = columnMap.matricule !== undefined ? row[columnMap.matricule] : null;
  const nomCell = columnMap.nom !== undefined ? row[columnMap.nom] : null;
  const matStr = toString(matCell);
  const nomStr = toString(nomCell);
  if (!matStr && !nomStr) return false;
  // Row labelled "TOTAL" / "TOTAUX" in the name column → aggregate, skip.
  if (/^total/i.test(nomStr) || /^totaux/i.test(nomStr)) return false;
  return true;
}

function extractRecords(rows, columnMap, headerRowIdx) {
  const records = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!isDataRow(row, columnMap)) continue;

    const rec = { _rowIndex: r };
    for (const [key, colIdx] of Object.entries(columnMap)) {
      const cell = row[colIdx];
      // String fields vs numeric fields
      if (["matricule", "nom", "prenom", "poste", "service", "ferme", "rib", "modePaiement"].includes(key)) {
        rec[key] = toString(cell);
      } else {
        rec[key] = toNumber(cell);
      }
    }
    // Combine nom + prenom if both present and nom doesn't already contain prenom
    if (rec.prenom && rec.nom && !rec.nom.toLowerCase().includes(rec.prenom.toLowerCase())) {
      rec.nomComplet = `${rec.nom} ${rec.prenom}`.trim();
    } else {
      rec.nomComplet = rec.nom || rec.prenom || "";
    }
    records.push(rec);
  }
  return records;
}

function aggregateTotals(records) {
  const totals = {
    nbEmployes: records.length,
    salaireBrut: 0,
    salaireNet: 0,
    cnssEmploye: 0,
    cnssEmployeur: 0,
    amoEmploye: 0,
    amoEmployeur: 0,
    ir: 0,
    cimr: 0,
    primes: 0,
    avances: 0,
    chargesSocialesTotal: 0,
  };
  for (const r of records) {
    totals.salaireBrut += r.salaireBrut || 0;
    totals.salaireNet += r.salaireNet || 0;
    totals.cnssEmploye += r.cnssEmploye || 0;
    totals.cnssEmployeur += r.cnssEmployeur || 0;
    totals.amoEmploye += r.amoEmploye || 0;
    totals.amoEmployeur += r.amoEmployeur || 0;
    totals.ir += r.ir || 0;
    totals.cimr += r.cimr || 0;
    totals.primes += r.primes || 0;
    totals.avances += r.avances || 0;
  }
  totals.chargesSocialesTotal = totals.cnssEmploye + totals.cnssEmployeur +
                                totals.amoEmploye + totals.amoEmployeur + totals.cimr;
  // Round to 2 decimals to avoid floating point noise.
  for (const k of Object.keys(totals)) {
    if (typeof totals[k] === "number" && k !== "nbEmployes") totals[k] = Math.round(totals[k] * 100) / 100;
  }
  return totals;
}

// Parse a base64-encoded xlsx buffer. Returns { sheets: [...], totals, meta }.
// Each sheet entry: { name, headerRow, columnMap, records, totals }.
function parseOjraExcel(base64Buffer) {
  const buffer = Buffer.from(base64Buffer, "base64");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheets = [];
  const overall = {
    nbEmployes: 0, salaireBrut: 0, salaireNet: 0,
    cnssEmploye: 0, cnssEmployeur: 0, amoEmploye: 0, amoEmployeur: 0,
    ir: 0, cimr: 0, primes: 0, avances: 0, chargesSocialesTotal: 0,
  };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    if (!rows.length) continue;

    const detected = findHeaderRow(rows);
    if (!detected) {
      sheets.push({ name: sheetName, skipped: true, reason: "Aucun en-tête de paie reconnu" });
      continue;
    }
    const records = extractRecords(rows, detected.columnMap, detected.headerRow);
    const totals = aggregateTotals(records);

    sheets.push({
      name: sheetName,
      headerRow: detected.headerRow,
      detectedColumns: Object.keys(detected.columnMap),
      records,
      totals,
    });

    for (const k of Object.keys(overall)) overall[k] += totals[k] || 0;
  }

  // Round overall
  for (const k of Object.keys(overall)) {
    if (k !== "nbEmployes") overall[k] = Math.round(overall[k] * 100) / 100;
  }

  return {
    sheets,
    totals: overall,
    meta: {
      sheetCount: wb.SheetNames.length,
      parsedSheets: sheets.filter(s => !s.skipped).length,
    },
  };
}

module.exports = {
  parseOjraExcel,
  // Exposed for tests / future tightening once OJRA schema is fixed.
  COLUMN_PATTERNS,
  findHeaderRow,
  matchColumn,
};
