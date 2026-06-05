'use strict'
// @ts-check

/**
 * Point d'entrée du module d'import canevas Stock.
 * Expose le parsing pur, le garde-fou, le diff par jour, le calcul des soldes
 * et la construction du résumé de prévisualisation (dry-run).
 */

const mappings = require('./mappings')
const { parseWorkbook, SHEETS, IMPORT_SOURCE } = require('./parseWorkbook')
const { evaluateGuard, REQUIRED_SHEETS, SHRINK_RATIO } = require('./guard')

/** Échantillon d'écarts renvoyé en preview. */
const MISMATCH_SAMPLE = 40

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }

/**
 * Contributions de solde d'un mouvement — réplique EXACTE de applyStockImpact
 * (functions/index.js) : −source (tout lieu avec id), +destination (sauf parcelle).
 * Garantit qu'un recalcul depuis le grand livre reproduit les soldes des
 * mouvements saisis manuellement comme des mouvements CANEVA.
 * @returns {Array<{lieu_type:string, lieu_id:string, article_ref:string, article_nom:string, unite:string, delta:number}>}
 */
function movementDelta(mov) {
  const out = []
  for (const it of mov.items || []) {
    const ref = it.article_ref || it.article || ''
    const qte = Number(it.quantite) || 0
    if (!ref || qte <= 0) continue
    const nom = it.article_nom || it.article || ''
    const unite = it.unite || 'kg'
    if (mov.lieu_source && mov.lieu_source.id) {
      out.push({ lieu_type: mov.lieu_source.type, lieu_id: mov.lieu_source.id, article_ref: ref, article_nom: nom, unite, delta: -qte })
    }
    if (mov.lieu_destination && mov.lieu_destination.id && mov.lieu_destination.type !== 'parcelle') {
      out.push({ lieu_type: mov.lieu_destination.type, lieu_id: mov.lieu_destination.id, article_ref: ref, article_nom: nom, unite, delta: qte })
    }
  }
  return out
}

function lieuKey(lieu) {
  if (!lieu || !lieu.id) return ''
  return `${lieu.type || ''}:${lieu.id}`
}

/**
 * Clé canonique d'un mouvement, calculable identiquement depuis le plan parsé
 * ET depuis un mouvement stocké en Firestore (mêmes champs présents des deux côtés).
 */
function movementKey(mov) {
  const items = (mov.items || [])
    .map(it => `${it.article_ref}#${round2(Number(it.quantite) || 0)}#${(it.unite || '').trim().toLowerCase()}`)
    .sort()
  const ref = (mov.ref_bon_physique || mov.ref_bl_fournisseur || '').trim()
  return JSON.stringify([mov.type, lieuKey(mov.lieu_source), lieuKey(mov.lieu_destination), ref, items])
}

/** Empreinte stable d'un jour = clés de mouvements triées. */
function dayFingerprint(movs) {
  return (movs || []).map(movementKey).sort().join('||')
}

function groupByDate(movs) {
  const m = new Map()
  for (const mv of movs || []) {
    const d = mv.date || ''
    if (!m.has(d)) m.set(d, [])
    m.get(d).push(mv)
  }
  return m
}

/**
 * Diff par jour entre le plan entrant et les mouvements CANEVA déjà stockés.
 * @param {{movements:Array}} plan
 * @param {Array} existingCanevaMovements  mouvements Firestore (import_source CANEVA) couvrant les dates du plan
 * @returns {{ jours_nouveaux:Array<string>, jours_identiques:Array<string>, jours_modifies:Array<{date:string, nb_bons_existants:number}> }}
 */
function computeDayDiff(plan, existingCanevaMovements) {
  const incoming = groupByDate(plan.movements)
  const existing = groupByDate(existingCanevaMovements)
  const jours_nouveaux = []
  const jours_identiques = []
  const jours_modifies = []
  for (const [date, movs] of incoming) {
    const ex = existing.get(date)
    if (!ex || ex.length === 0) { jours_nouveaux.push(date); continue }
    if (dayFingerprint(movs) === dayFingerprint(ex)) jours_identiques.push(date)
    else jours_modifies.push({ date, nb_bons_existants: ex.length })
  }
  jours_nouveaux.sort()
  jours_identiques.sort()
  jours_modifies.sort((a, b) => a.date.localeCompare(b.date))
  return { jours_nouveaux, jours_identiques, jours_modifies }
}

/** Dates réellement impactées (nouveaux + modifiés) — les identiques sont ignorés. */
function impactedDates(diff) {
  return new Set([...diff.jours_nouveaux, ...diff.jours_modifies.map(d => d.date)])
}

/**
 * Résumé de prévisualisation (aucune écriture).
 * @param {*} plan résultat de parseWorkbook
 * @param {*} guard résultat de evaluateGuard
 * @param {*} diff résultat de computeDayDiff
 */
function buildDrySummary(plan, guard, diff) {
  return {
    counts: plan.counts,
    jours_nouveaux: diff.jours_nouveaux,
    jours_identiques: diff.jours_identiques,
    jours_modifies: diff.jours_modifies,
    requires_finance: diff.jours_modifies.length > 0,
    validation: {
      matches: plan.validation.matches,
      mismatch_count: plan.validation.mismatches.length,
      mismatches: plan.validation.mismatches.slice(0, MISMATCH_SAMPLE),
    },
    warnings: plan.warnings,
    guard: { hardBlock: guard.hardBlock, reasons: guard.reasons, shrink: guard.shrink },
    articles_to_create: plan.counts.articlesToCreate,
    balances_init: plan.counts.balancesInit,
    present_sheets: plan.presentSheets,
    missing_sheets: plan.missingSheets,
  }
}

module.exports = {
  parseWorkbook,
  evaluateGuard,
  computeDayDiff,
  impactedDates,
  buildDrySummary,
  movementDelta,
  movementKey,
  dayFingerprint,
  SHEETS,
  IMPORT_SOURCE,
  REQUIRED_SHEETS,
  SHRINK_RATIO,
  MISMATCH_SAMPLE,
  // helpers de mapping ré-exposés (utiles côté CF pour les articles)
  mappings,
}
