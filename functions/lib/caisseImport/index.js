'use strict'
// @ts-check

const { excelToISO } = require('./excelToISO')
const { detectCols } = require('./detectCols')
const { parseDepensesMonthly, parsePaieRecap, parseBahiaSingle } = require('./parsers')

// Mapping caisse_id → format Excel. Source de vérité partagée avec le frontend (CAISSE_EXCEL_FORMATS).
const CAISSE_FORMATS = {
  caisse_depenses: 'depenses_monthly',
  caisse_paie: 'paie_recap',
  caisse_depenses_bahia: 'bahia_single',
}

const PARSERS = {
  depenses_monthly: parseDepensesMonthly,
  paie_recap: parsePaieRecap,
  bahia_single: parseBahiaSingle,
}

/** Limite d'échantillon renvoyé en preview (dry-run). */
const SAMPLE_LIMIT = 25

/**
 * Parse un classeur déjà chargé (XLSX.read) selon le format de la caisse.
 * @param {*} wb workbook XLSX
 * @param {{ caisse_id:string, format?:string, XLSX:* }} opts
 * @returns {{ transactions:Array, resetSoldeInitial:(number|null), perSheet:Array, warnings:Array, ignoredSheets:Array, format:string }}
 */
function parseWorkbook(wb, { caisse_id, format, XLSX }) {
  const fmt = format || CAISSE_FORMATS[caisse_id]
  const parser = PARSERS[fmt]
  if (!parser) throw new Error(`Format inconnu: ${fmt}`)
  const out = parser(wb, { caisse_id, XLSX })
  return { ...out, format: fmt }
}

/**
 * Construit le résumé de prévisualisation (dry-run) — aucune écriture, projection de solde.
 * @param {{ transactions:Array, perSheet:Array, warnings:Array, ignoredSheets:Array, resetSoldeInitial:(number|null), format:string }} parsed
 * @param {{ caisse_id:string, soldeInitialActuel:number, totalInActuel:number, totalOutActuel:number, existingIds:Set<string>, force_overwrite:boolean }} ctx
 */
function buildDrySummary(parsed, ctx) {
  const { transactions, perSheet, warnings, ignoredSheets, resetSoldeInitial, format } = parsed
  const { caisse_id, soldeInitialActuel, totalInActuel, totalOutActuel, existingIds, force_overwrite } = ctx

  let alimCount = 0, alimMontant = 0, depCount = 0, depMontant = 0
  let willImport = 0, willSkip = 0
  let newIn = 0, newOut = 0
  let overwriteCount = 0
  const sample = []

  for (const tx of transactions) {
    if (tx.type === 'alimentation') { alimCount++; alimMontant += tx.montant }
    else { depCount++; depMontant += tx.montant }

    const exists = existingIds.has(tx.external_id)
    let statusPreview
    if (!exists) { statusPreview = 'nouveau'; willImport++; if (tx.type === 'alimentation') newIn += tx.montant; else newOut += tx.montant }
    else if (force_overwrite) { statusPreview = 'overwrite'; willImport++; overwriteCount++ }
    else { statusPreview = 'skip'; willSkip++ }

    if (sample.length < SAMPLE_LIMIT) {
      const meta = tx._meta || {}
      sample.push({
        sheet: meta.sheet || meta.quinzaine || '',
        row: typeof meta.row === 'number' ? meta.row : null,
        date: tx.date, type: tx.type, montant: tx.montant,
        description: tx.description, code_analytique: tx.code_analytique,
        fournisseur: tx.fournisseur, external_id: tx.external_id,
        status_preview: statusPreview,
      })
    }
  }

  const initialProjete = (typeof resetSoldeInitial === 'number') ? resetSoldeInitial : soldeInitialActuel
  const actuel = soldeInitialActuel + totalInActuel - totalOutActuel
  // Estimation : on projette sur les seules transactions nouvelles ; les overwrite sont supposés
  // inchangés (montant identique) — signalé via "solde_estimation" si overwriteCount > 0.
  const projete = initialProjete + (totalInActuel + newIn) - (totalOutActuel + newOut)

  // perSheet exposé sans le détail interne des warnings dupliqués (déjà dans warnings global) mais on garde le compte
  const per_sheet = perSheet.map(s => ({
    key: s.key, label: s.label, rows_parsed: s.rows_parsed,
    alimentations: s.alimentations, depenses: s.depenses,
    montant_in: s.montant_in, montant_out: s.montant_out,
    warnings: s.warnings.length,
  }))

  return {
    success: true,
    dry_run: true,
    format,
    caisse_id,
    parsed: transactions.length,
    will_import: willImport,
    will_skip: willSkip,
    totals: {
      alimentations: { count: alimCount, montant: round2(alimMontant) },
      depenses: { count: depCount, montant: round2(depMontant) },
    },
    solde: {
      initial_actuel: round2(soldeInitialActuel),
      initial_projete: round2(initialProjete),
      actuel: round2(actuel),
      projete: round2(projete),
      estimation: overwriteCount > 0,
    },
    per_sheet,
    ignored_sheets: ignoredSheets,
    warnings,
    sample,
  }
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }

module.exports = { parseWorkbook, buildDrySummary, excelToISO, detectCols, CAISSE_FORMATS, SAMPLE_LIMIT }
