/**
 * scanHistoryDisplay.js — Pure display helpers for the "Scan Factures → Historique"
 * table (AchatsScanFacturesTab in public/app.jsx).
 *
 * Context: invoice_scans documents come in TWO `analysis` shapes:
 *   - SCAN-IA format (live AI scans): analysis.fournisseur is an OBJECT {nom, ice},
 *     analysis.total_ttc is the TTC amount, matched BDC in s.matched_bdc_numero.
 *   - TIMAC backfill (createTimacInvoiceFromParsed, 154 docs): analysis.fournisseur is
 *     a STRING "TIMAC AGRO MAROC", the TTC value lives in analysis.net_a_payer, and
 *     the matched BDC is never written to matched_bdc_numero (may be in s.bdc_numero).
 *
 * These helpers normalise both shapes for DISPLAY ONLY. No writes, no backend change.
 * The SCAN-IA fields stay PRIORITY so live scans render exactly as before.
 *
 * 2026-06 — initial creation (fix/scan-history-timac-display).
 */
// @ts-check

/**
 * Resolve the supplier label for a scan history row.
 * Priority: SCAN-IA object → TIMAC string → top-level fournisseur object.
 * @param {any} s invoice_scan document
 * @returns {string} supplier name or '—'
 */
function scanFournisseurLabel(s) {
  if (!s) return '—';
  const a = s.analysis;
  if (a && a.fournisseur && typeof a.fournisseur === 'object' && a.fournisseur.nom) {
    return a.fournisseur.nom;
  }
  if (a && typeof a.fournisseur === 'string' && a.fournisseur.trim()) {
    return a.fournisseur;
  }
  if (s.fournisseur && typeof s.fournisseur === 'object' && s.fournisseur.nom) {
    return s.fournisseur.nom;
  }
  return '—';
}

/**
 * Resolve the TTC amount for a scan history row, as a raw number (or null).
 * Priority: SCAN-IA analysis.total_ttc → TIMAC analysis.net_a_payer → top-level total_ttc.
 * Uses `?? ` so that 0 is a valid value but null/undefined fall through.
 * @param {any} s invoice_scan document
 * @returns {number|null} TTC amount or null when no value is present
 */
function scanTtc(s) {
  if (!s) return null;
  const a = s.analysis || {};
  const ttc = a.total_ttc != null ? a.total_ttc
    : (a.net_a_payer != null ? a.net_a_payer
      : (s.total_ttc != null ? s.total_ttc : null));
  if (ttc == null) return null;
  const n = typeof ttc === 'number' ? ttc : Number(ttc);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the matched-BDC number for a scan history row.
 * Priority: SCAN-IA matched_bdc_numero → TIMAC bdc_numero → matched_bdc.numero.
 * @param {any} s invoice_scan document
 * @returns {string} BDC number or '—'
 */
function scanBdcMatche(s) {
  if (!s) return '—';
  if (s.matched_bdc_numero) return String(s.matched_bdc_numero);
  if (s.bdc_numero) return String(s.bdc_numero);
  if (s.matched_bdc && s.matched_bdc.numero) return String(s.matched_bdc.numero);
  return '—';
}

export { scanFournisseurLabel, scanTtc, scanBdcMatche };
