'use strict'
// @ts-check

const { excelToISO } = require('./excelToISO')
const { detectCols } = require('./detectCols')

// Plage d'années considérée plausible ; hors plage => warning "date_aberrante" (typo source).
const MIN_YEAR = 2020
const MAX_YEAR = 2030

/** Crée une entrée perSheet vierge. */
function newSheetEntry(key, label) {
  return { key, label, rows_parsed: 0, alimentations: 0, depenses: 0, montant_in: 0, montant_out: 0, warnings: [] }
}

/** Accumule une transaction dans son entrée perSheet. */
function accumulate(entry, type, montant) {
  entry.rows_parsed++
  if (type === 'alimentation') { entry.alimentations++; entry.montant_in += montant }
  else { entry.depenses++; entry.montant_out += montant }
}

/** Détecte une date aberrante (hors plage plausible) et renvoie un warning, sinon null. */
function dateWarning(dateISO, sheet, row, raw) {
  const y = parseInt(String(dateISO).slice(0, 4), 10)
  if (y < MIN_YEAR || y > MAX_YEAR) {
    return { type: 'date_aberrante', sheet, row, raw: String(raw), iso: dateISO, message: `Date hors plage ${MIN_YEAR}-${MAX_YEAR} (typo source probable)` }
  }
  return null
}

/**
 * Format caisse_depenses : multi-feuilles mensuelles, entête ligne 7 (index 6),
 * une feuille reconnue si elle contient "désignation" + "débit".
 */
function parseDepensesMonthly(wb, { caisse_id, XLSX }) {
  const HEADER_ROW = 6
  const transactions = []
  const perSheet = []
  const warnings = []
  const ignoredSheets = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (data.length < HEADER_ROW + 2) { ignoredSheets.push({ name: sheetName, reason: 'feuille trop courte' }); continue }
    const header = data[HEADER_ROW] || []
    const hasDesignation = header.some(c => { const s = String(c || '').toLowerCase(); return s.includes('désignation') || s.includes('designation') })
    const hasDebit = header.some(c => { const s = String(c || '').toLowerCase().replace(/\s|\r|\n/g, ''); return s.includes('débit') || s.includes('debit') })
    if (!hasDesignation || !hasDebit) { ignoredSheets.push({ name: sheetName, reason: "pas d'entête 'désignation'+'débit'" }); continue }
    const cols = detectCols(header)
    const sheetKey = sheetName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '')
    const entry = newSheetEntry(sheetKey, sheetName.trim())
    for (let i = HEADER_ROW + 1; i < data.length; i++) {
      const row = data[i]
      const date = row[cols.date]
      const debit = parseFloat(row[cols.debit]) || 0
      const credit = parseFloat(row[cols.credit]) || 0
      if (!date || (debit === 0 && credit === 0)) continue
      const dateISO = excelToISO(date, XLSX)
      if (!dateISO) continue
      const isAlim = debit > 0
      const montant = isAlim ? debit : credit
      if (montant <= 0) continue
      const variete = String(row[0] || '').trim()
      const ferme = String(row[1] || '').trim()
      const type = isAlim ? 'alimentation' : 'depense'
      const w = dateWarning(dateISO, sheetName.trim(), i, date)
      if (w) { warnings.push(w); entry.warnings.push(w) }
      transactions.push({
        external_id: `import_${caisse_id}_${sheetKey}_r${i}`,
        caisse_id, type, montant, date: dateISO,
        description: String(row[cols.desc] || '').trim(),
        reference: String(row[cols.numPiece] || row[cols.numFacture] || `IMPORT-${sheetKey}-${i}`).trim(),
        code_analytique: [variete, ferme].filter(Boolean).join(' - '),
        fournisseur: String(row[cols.fournisseur] || '').trim(),
        _meta: { sheet: sheetName, row: i, debit, credit },
      })
      accumulate(entry, type, montant)
    }
    if (entry.rows_parsed > 0) perSheet.push(entry)
  }
  return { transactions, resetSoldeInitial: null, perSheet, warnings, ignoredSheets }
}

/**
 * Format caisse_paie : feuille "Récap", une ligne par quinzaine à partir de l'index 6,
 * colonnes alim virement / Mr Omar / recettes / payé. Réinitialise solde_initial à 0.
 */
function parsePaieRecap(wb, { caisse_id, XLSX }) {
  const transactions = []
  const perSheet = []
  const warnings = []
  const ignoredSheets = []
  const targetName = wb.Sheets['Récap'] ? 'Récap' : wb.SheetNames[0]
  if (!wb.Sheets['Récap']) warnings.push({ type: 'sheet_fallback', sheet: targetName, message: 'Feuille "Récap" absente — repli sur la première feuille' })
  const ws = wb.Sheets['Récap'] || wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const qzToISO = (label) => {
    const s = String(label).trim()
    let m = s.match(/^([12])\s*Q\s*(\d{1,2})\s*\/\s*(\d{4})$/i)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1] === '1' ? '15' : '28'}`
    m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/)
    if (m) {
      const lastDay = new Date(m[3], parseInt(m[2]), 0).getDate()
      return `${m[3]}-${String(parseInt(m[2])).padStart(2, '0')}-${String(Math.min(parseInt(m[1]), lastDay)).padStart(2, '0')}`
    }
    return null
  }
  for (let i = 6; i < data.length; i++) {
    const row = data[i]
    const label = String(row[0] || '').trim()
    if (!label) continue
    if (label.toLowerCase().startsWith('total')) break
    if (label.toLowerCase().includes('liste') || label.toLowerCase().includes('somme')) break
    const dateISO = qzToISO(label)
    if (!dateISO) continue
    const alimVir = parseFloat(row[2]) || 0
    const alimOmar = parseFloat(row[3]) || 0
    const alimRec = parseFloat(row[4]) || 0
    const paye = parseFloat(row[5]) || 0
    if (alimVir === 0 && alimOmar === 0 && alimRec === 0 && paye === 0) continue
    const qzKey = label.replace(/\s+/g, '').replace(/\//g, '_').replace(/[^A-Za-z0-9_]/g, '')
    const ca = 'Salaires - Paie'
    const entry = newSheetEntry(qzKey, label)
    const w = dateWarning(dateISO, label, i, label)
    if (w) { warnings.push(w); entry.warnings.push(w) }
    if (alimVir > 0) { transactions.push({ external_id: `import_${caisse_id}_${qzKey}_alim_vir`, caisse_id, type: 'alimentation', montant: alimVir, date: dateISO, description: `Alimentation par virement — Quinzaine ${label}`, reference: `PAIE-VIR-${qzKey}`, code_analytique: ca, fournisseur: 'Virement bancaire', _meta: { quinzaine: label, source: 'alim_virement' } }); accumulate(entry, 'alimentation', alimVir) }
    if (alimOmar > 0) { transactions.push({ external_id: `import_${caisse_id}_${qzKey}_alim_omar`, caisse_id, type: 'alimentation', montant: alimOmar, date: dateISO, description: `Alimentation Mr Omar — Quinzaine ${label}`, reference: `PAIE-OMR-${qzKey}`, code_analytique: ca, fournisseur: 'Mr Omar', _meta: { quinzaine: label, source: 'alim_omar' } }); accumulate(entry, 'alimentation', alimOmar) }
    if (alimRec > 0) { transactions.push({ external_id: `import_${caisse_id}_${qzKey}_alim_rec`, caisse_id, type: 'alimentation', montant: alimRec, date: dateISO, description: `Alimentation depuis caisse recettes — Quinzaine ${label}`, reference: `PAIE-REC-${qzKey}`, code_analytique: ca, fournisseur: 'Caisse Recettes', _meta: { quinzaine: label, source: 'alim_recettes' } }); accumulate(entry, 'alimentation', alimRec) }
    if (paye > 0) { transactions.push({ external_id: `import_${caisse_id}_${qzKey}_paye`, caisse_id, type: 'depense', montant: paye, date: dateISO, description: `Paiement salaires ouvriers — Quinzaine ${label}`, reference: `PAIE-OUT-${qzKey}`, code_analytique: ca, fournisseur: 'Ouvriers (paie quinzaine)', _meta: { quinzaine: label, source: 'paye' } }); accumulate(entry, 'depense', paye) }
    if (entry.rows_parsed > 0) perSheet.push(entry)
  }
  return { transactions, resetSoldeInitial: 0, perSheet, warnings, ignoredSheets }
}

/**
 * Format caisse_depenses_bahia : feuille unique "Les dépenses", entête ligne 6 (index 5),
 * codes analytiques 1 et 2.
 */
function parseBahiaSingle(wb, { caisse_id, XLSX }) {
  const transactions = []
  const warnings = []
  const ignoredSheets = []
  const HEADER_ROW = 5
  const targetName = wb.Sheets['Les dépenses'] ? 'Les dépenses' : wb.SheetNames[0]
  if (!wb.Sheets['Les dépenses']) warnings.push({ type: 'sheet_fallback', sheet: targetName, message: 'Feuille "Les dépenses" absente — repli sur la première feuille' })
  const ws = wb.Sheets['Les dépenses'] || wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const cols = detectCols(data[HEADER_ROW] || [])
  const entry = newSheetEntry('les_depenses', targetName)
  for (let i = HEADER_ROW + 1; i < data.length; i++) {
    const row = data[i]
    const date = row[cols.date]
    const debit = parseFloat(row[cols.debit]) || 0
    const credit = parseFloat(row[cols.credit]) || 0
    if (!date || (debit === 0 && credit === 0)) continue
    const dateISO = excelToISO(date, XLSX)
    if (!dateISO) continue
    const isAlim = debit > 0
    const montant = isAlim ? debit : credit
    if (montant <= 0) continue
    const variete = String(row[0] || '').trim()
    const ferme = String(row[1] || '').trim()
    const ana1 = String(row[cols.ana1] || '').trim()
    const ana2 = String(row[cols.ana2] || '').trim()
    const type = isAlim ? 'alimentation' : 'depense'
    const w = dateWarning(dateISO, targetName, i, date)
    if (w) { warnings.push(w); entry.warnings.push(w) }
    transactions.push({
      external_id: `import_${caisse_id}_les_depenses_r${i}`,
      caisse_id, type, montant, date: dateISO,
      description: String(row[cols.desc] || '').trim(),
      reference: String(row[cols.numPiece] || row[cols.numFacture] || `IMPORT-BAHIA-${i}`).trim(),
      code_analytique: [ana1, ana2].filter(Boolean).join(' - ') || [variete, ferme].filter(Boolean).join(' - '),
      fournisseur: String(row[cols.fournisseur] || '').trim(),
      _meta: { row: i, debit, credit, ana1, ana2 },
    })
    accumulate(entry, type, montant)
  }
  const perSheet = entry.rows_parsed > 0 ? [entry] : []
  return { transactions, resetSoldeInitial: null, perSheet, warnings, ignoredSheets }
}

module.exports = { parseDepensesMonthly, parsePaieRecap, parseBahiaSingle }
