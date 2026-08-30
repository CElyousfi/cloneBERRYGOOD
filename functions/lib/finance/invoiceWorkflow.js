// @ts-check
'use strict';

/** @typedef {'non_payee'|'en_validation'|'validee_achats'|'validee_finance'|'validee_dg'|'payee'} InvoiceStatus */

/** Role → allowed transition map */
const WORKFLOW_STEPS = {
  achats:  { from: 'en_validation',   to: 'validee_achats' },
  finance: { from: 'validee_achats',  to: 'validee_finance' },
  dg:      { from: 'validee_finance', to: 'validee_dg' },
};

/**
 * Validate and compute the next status for an invoice payment workflow step.
 * Pure function — no side effects, no DB access.
 *
 * @param {InvoiceStatus} currentStatus
 * @param {string} role - 'achats' | 'finance' | 'dg'
 * @returns {{ ok: true, nextStatus: InvoiceStatus } | { ok: false, error: string }}
 */
function computeNextStatus(currentStatus, role) {
  const step = WORKFLOW_STEPS[role];
  if (!step) return { ok: false, error: `Unknown role: ${role}` };
  if (currentStatus !== step.from) {
    return { ok: false, error: `Cannot transition from '${currentStatus}' as role '${role}'. Expected '${step.from}'.` };
  }
  return { ok: true, nextStatus: step.to };
}

/**
 * Check if an invoice can be validated by the given role.
 * @param {InvoiceStatus} status
 * @param {string} role
 * @returns {boolean}
 */
function canValidate(status, role) {
  const step = WORKFLOW_STEPS[role];
  return !!step && status === step.from;
}

module.exports = { computeNextStatus, canValidate, WORKFLOW_STEPS };
