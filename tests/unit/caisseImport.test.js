'use strict';

/**
 * Unit tests for functions/lib/caisseImport/*
 * Run with: npm run test:unit
 *
 * Les fixtures sont des classeurs XLSX synthétiques générés en mémoire (déterministes,
 * aucun fichier disque) via XLSX.utils.aoa_to_sheet / book_new.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('../../functions/node_modules/xlsx');

const { parseWorkbook, buildDrySummary } = require('../../functions/lib/caisseImport');
const { excelToISO } = require('../../functions/lib/caisseImport/excelToISO');
const { detectCols } = require('../../functions/lib/caisseImport/detectCols');

// --- helpers fixtures ---
const dateToSerial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

function wbFromSheets(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return wb;
}

// Entête dépenses/bahia : VARIété, Ferme, Date, Désignation, Classe, Débit, Crédit, Solde, Fournisseur, ...
const DEP_HEADER = ['VARIété', 'Ferme', 'Date', 'Désignation', 'Classe', 'Montant Débit', 'Montant Crédit', 'Solde', 'Fournisseur/Beneficiaire'];

function depRow(variete, ferme, y, m, d, designation, debit, credit, fournisseur) {
  return [variete, ferme, dateToSerial(y, m, d), designation, '', debit, credit, 0, fournisseur];
}

function depensesSheet(name, rows) {
  // 6 lignes de bloc avant l'entête en index 6. La 1re ligne porte une cellule non vide
  // sinon aoa_to_sheet réduit la plage et supprime les lignes de tête.
  const aoa = [['SITUATION'], [], [], [], [], [], DEP_HEADER, ...rows];
  return { name, aoa };
}

// ---------- excelToISO ----------
test('excelToISO — serial numérique → ISO', () => {
  assert.equal(excelToISO(dateToSerial(2025, 1, 5), XLSX), '2025-01-05');
  assert.equal(excelToISO(dateToSerial(2026, 12, 31), XLSX), '2026-12-31');
});

test('excelToISO — string parsable et null', () => {
  assert.equal(excelToISO('2025-03-15', XLSX), '2025-03-15');
  assert.equal(excelToISO(null, XLSX), null);
  assert.equal(excelToISO('', XLSX), null);
  assert.equal(excelToISO('pas une date', XLSX), null);
});

// ---------- detectCols ----------
test('detectCols — accents/casse/retours-ligne', () => {
  const c = detectCols(['VARIété', 'Ferme', 'Date', 'Désignation', 'Classe', 'Montant\r\n Débit', 'Montant\r\n Crédit', 'Solde', 'Fournisseur', 'N° Piéce', 'Facture', 'CODE ANALYTIQUE 1', 'CODE ANALYTIQUE 2']);
  assert.equal(c.desc, 3);
  assert.equal(c.debit, 5);
  assert.equal(c.credit, 6);
  assert.equal(c.fournisseur, 8);
  assert.equal(c.ana1, 11);
  assert.equal(c.ana2, 12);
});

// ---------- parseDepensesMonthly ----------
test('parseDepensesMonthly — débit⇒alimentation, crédit⇒dépense, feuille ignorée, external_id stable', () => {
  const wb = wbFromSheets([
    depensesSheet('JANVIER 2025', [
      depRow('FRAMBOISE', 'F1', 2025, 1, 5, 'Achat gasoil', 0, 1200, 'TOTAL'),
      depRow('AVOCAT', 'F2', 2025, 1, 6, 'Virement reçu', 5000, 0, 'BGF'),
    ]),
    { name: 'Base', aoa: [['rien'], ['ici']] }, // pas d'entête → ignorée
  ]);
  const r = parseWorkbook(wb, { caisse_id: 'caisse_depenses', XLSX });
  assert.equal(r.format, 'depenses_monthly');
  assert.equal(r.transactions.length, 2);

  const dep = r.transactions.find(t => t.description === 'Achat gasoil');
  assert.equal(dep.type, 'depense');
  assert.equal(dep.montant, 1200);
  assert.equal(dep.date, '2025-01-05');
  assert.equal(dep.code_analytique, 'FRAMBOISE - F1');
  assert.equal(dep.external_id, 'import_caisse_depenses_JANVIER_2025_r7');

  const alim = r.transactions.find(t => t.description === 'Virement reçu');
  assert.equal(alim.type, 'alimentation');
  assert.equal(alim.montant, 5000);

  // feuille ignorée signalée
  assert.ok(r.ignoredSheets.some(s => s.name === 'Base'));
  // perSheet
  const ps = r.perSheet.find(s => s.label === 'JANVIER 2025');
  assert.equal(ps.rows_parsed, 2);
  assert.equal(ps.alimentations, 1);
  assert.equal(ps.depenses, 1);
  assert.equal(ps.montant_in, 5000);
  assert.equal(ps.montant_out, 1200);
});

test('parseDepensesMonthly — date aberrante → warning, ligne conservée', () => {
  const wb = wbFromSheets([
    depensesSheet('MARS 2025', [
      depRow('FRAMBOISE', 'F1', 1902, 3, 4, 'Achat clous', 0, 150, 'Droguerie'),
    ]),
  ]);
  const r = parseWorkbook(wb, { caisse_id: 'caisse_depenses', XLSX });
  assert.equal(r.transactions.length, 1); // conservée
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].type, 'date_aberrante');
  assert.equal(r.warnings[0].sheet, 'MARS 2025');
});

// ---------- parsePaieRecap ----------
test('parsePaieRecap — quinzaines, resetSoldeInitial=0, break sur total', () => {
  const recap = [
    ['LES SOLDES'], [], [], [], [],
    ['Quinzaine', 'POINTAGE', 'Alim VIR', 'Alim OMAR', 'Alim REC', 'Payé'],
    ['1Q07/2025', '147000', 150000, 0, 0, 146551],
    ['2Q07/2025', '102000', 103000, 0, 0, 102761.5],
    ['TOTAL', '', 999, 0, 0, 999], // doit casser la boucle
    ['1Q08/2025', '', 1, 0, 0, 1], // ne doit PAS être lu (après break)
  ];
  const wb = wbFromSheets([{ name: 'Récap', aoa: recap }]);
  const r = parseWorkbook(wb, { caisse_id: 'caisse_paie', XLSX });
  assert.equal(r.format, 'paie_recap');
  assert.equal(r.resetSoldeInitial, 0);
  // 2 quinzaines × (1 alim + 1 paye) = 4 tx
  assert.equal(r.transactions.length, 4);
  assert.ok(r.transactions.every(t => t.code_analytique === 'Salaires - Paie'));
  const vir = r.transactions.find(t => t.external_id === 'import_caisse_paie_1Q07_2025_alim_vir');
  assert.equal(vir.type, 'alimentation');
  assert.equal(vir.montant, 150000);
  const paye = r.transactions.find(t => t.external_id === 'import_caisse_paie_1Q07_2025_paye');
  assert.equal(paye.type, 'depense');
  assert.equal(paye.montant, 146551);
});

test('parsePaieRecap — qzToISO formats quinzaine et jj/mm/aaaa', () => {
  const recap = [
    ['LES SOLDES'], [], [], [], [],
    ['Quinzaine', 'P', 'VIR', 'OMAR', 'REC', 'Payé'],
    ['2Q07/2025', '', 100, 0, 0, 90],   // → 2025-07-28
    ['15/03/2025', '', 50, 0, 0, 40],   // → 2025-03-15
  ];
  const wb = wbFromSheets([{ name: 'Récap', aoa: recap }]);
  const r = parseWorkbook(wb, { caisse_id: 'caisse_paie', XLSX });
  const dates = [...new Set(r.transactions.map(t => t.date))].sort();
  assert.deepEqual(dates, ['2025-03-15', '2025-07-28']);
});

test('parsePaieRecap — feuille Récap absente → fallback + warning', () => {
  const wb = wbFromSheets([{ name: 'Autre', aoa: [['LES SOLDES'], [], [], [], [], ['Quinzaine', 'P', 'VIR', 'OMAR', 'REC', 'Payé'], ['1Q07/2025', '', 100, 0, 0, 90]] }]);
  const r = parseWorkbook(wb, { caisse_id: 'caisse_paie', XLSX });
  assert.ok(r.warnings.some(w => w.type === 'sheet_fallback'));
  assert.equal(r.transactions.length, 2);
});

// ---------- parseBahiaSingle ----------
test('parseBahiaSingle — codes analytiques 1/2', () => {
  const header = ['VARIété', 'Ferme / Ha', 'Date', 'N° PIECE', 'Désignation', 'Montant\r\n Débit', 'Montant\r\n Crédit', 'Solde', 'Fournisseur/Beneficiaire', 'N° de Piéce', 'N° de la Facture', 'CODE ANALYTIQUE 1', 'CODE ANALYTIQUE 2', 'Remarque'];
  const row = ['AVOCAT', 'B7-36Ha', dateToSerial(2025, 5, 4), '1', '9 kg graisse', 0, 165, 0, 'Droguerie', '', '', 'Préparation', 'Labour', ''];
  const aoa = [['BAHIA'], [], [], [], [], header, row];
  const wb = wbFromSheets([{ name: 'Les dépenses', aoa }]);
  const r = parseWorkbook(wb, { caisse_id: 'caisse_depenses_bahia', XLSX });
  assert.equal(r.format, 'bahia_single');
  assert.equal(r.transactions.length, 1);
  const t = r.transactions[0];
  assert.equal(t.type, 'depense');
  assert.equal(t.montant, 165);
  assert.equal(t.code_analytique, 'Préparation - Labour');
  assert.equal(t.external_id, 'import_caisse_depenses_bahia_les_depenses_r6');
});

// ---------- format inconnu ----------
test('parseWorkbook — format inconnu lève une erreur', () => {
  const wb = wbFromSheets([{ name: 'X', aoa: [[1]] }]);
  assert.throws(() => parseWorkbook(wb, { caisse_id: 'caisse_inconnue', XLSX }), /Format inconnu/);
});

// ---------- buildDrySummary ----------
test('buildDrySummary — totaux, will_import/will_skip, solde projeté', () => {
  const wb = wbFromSheets([
    depensesSheet('JANVIER 2025', [
      depRow('FRAMBOISE', 'F1', 2025, 1, 5, 'Achat gasoil', 0, 1200, 'TOTAL'),
      depRow('AVOCAT', 'F2', 2025, 1, 6, 'Virement reçu', 5000, 0, 'BGF'),
    ]),
  ]);
  const parsed = parseWorkbook(wb, { caisse_id: 'caisse_depenses', XLSX });

  // aucune tx existante, pas d'overwrite
  const sum = buildDrySummary(parsed, {
    caisse_id: 'caisse_depenses', soldeInitialActuel: 1000,
    totalInActuel: 0, totalOutActuel: 0, existingIds: new Set(), force_overwrite: false,
  });
  assert.equal(sum.success, true);
  assert.equal(sum.dry_run, true);
  assert.equal(sum.parsed, 2);
  assert.equal(sum.will_import, 2);
  assert.equal(sum.will_skip, 0);
  assert.equal(sum.totals.alimentations.montant, 5000);
  assert.equal(sum.totals.depenses.montant, 1200);
  // projeté = 1000 + 5000 - 1200 = 4800
  assert.equal(sum.solde.projete, 4800);
  assert.equal(sum.solde.estimation, false);
  assert.equal(sum.sample.length, 2);
  assert.ok(sum.sample.every(s => s.status_preview === 'nouveau'));
});

test('buildDrySummary — tx existante sans overwrite → skip', () => {
  const wb = wbFromSheets([
    depensesSheet('JANVIER 2025', [
      depRow('FRAMBOISE', 'F1', 2025, 1, 5, 'Achat gasoil', 0, 1200, 'TOTAL'),
    ]),
  ]);
  const parsed = parseWorkbook(wb, { caisse_id: 'caisse_depenses', XLSX });
  const existing = new Set(parsed.transactions.map(t => t.external_id));

  const skipSum = buildDrySummary(parsed, { caisse_id: 'caisse_depenses', soldeInitialActuel: 0, totalInActuel: 0, totalOutActuel: 1200, existingIds: existing, force_overwrite: false });
  assert.equal(skipSum.will_skip, 1);
  assert.equal(skipSum.will_import, 0);
  // pas de nouvelle tx → projeté = actuel
  assert.equal(skipSum.solde.projete, skipSum.solde.actuel);

  const owSum = buildDrySummary(parsed, { caisse_id: 'caisse_depenses', soldeInitialActuel: 0, totalInActuel: 0, totalOutActuel: 1200, existingIds: existing, force_overwrite: true });
  assert.equal(owSum.will_import, 1);
  assert.equal(owSum.solde.estimation, true);
});
