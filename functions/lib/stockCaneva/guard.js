'use strict'
// @ts-check

/**
 * Garde-fou anti-effacement accidentel. Évalue un plan parsé et bloque les
 * classeurs vides/incomplets ; signale (sans bloquer) une réduction forte
 * du volume de mouvements par rapport à l'import CANEVA courant.
 */

const { SHEETS } = require('./parseWorkbook')

/** Feuilles indispensables : sans elles, l'import n'a aucun sens. */
const REQUIRED_SHEETS = [SHEETS.inventaire, SHEETS.entrees, SHEETS.consommations]

/** Seuil de réduction : un import < 70% du volume courant est signalé. */
const SHRINK_RATIO = 0.7

/**
 * @param {{ movements:Array, counts:Object, missingSheets:Array<string> }} plan
 * @param {{ currentMovementCount?:number }} [currentImportStats]
 * @returns {{ hardBlock:boolean, reasons:Array<string>, shrink:{current:number,new:number,pct:number|null,flagged:boolean} }}
 */
function evaluateGuard(plan, currentImportStats) {
  const reasons = []
  const current = (currentImportStats && currentImportStats.currentMovementCount) || 0
  const next = plan.counts ? plan.counts.movements : (plan.movements || []).length
  const lineItems = plan.counts ? plan.counts.lineItems : 0

  const missingRequired = (plan.missingSheets || []).filter(s => REQUIRED_SHEETS.includes(s))
  if (missingRequired.length > 0) {
    reasons.push(`Feuille(s) requise(s) manquante(s): ${missingRequired.join(', ')}`)
  }
  if (next === 0) reasons.push('Aucun mouvement détecté dans le classeur.')
  if (lineItems === 0) reasons.push('Aucune ligne d\'article détectée dans le classeur.')

  const pct = current > 0 ? Math.round((next / current) * 100) : null
  const flagged = current > 0 && next < current * SHRINK_RATIO

  return {
    hardBlock: reasons.length > 0,
    reasons,
    shrink: { current, new: next, pct, flagged },
  }
}

module.exports = { evaluateGuard, REQUIRED_SHEETS, SHRINK_RATIO }
