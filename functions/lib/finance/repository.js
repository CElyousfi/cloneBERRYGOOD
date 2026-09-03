// @ts-check
/**
 * Finance repository — data access layer.
 *
 * This module is the ONLY place in lib/finance/ that touches databases.
 * It implements a dual-write pattern controlled by feature flags:
 *   - FINANCE_DUAL_WRITE=false (default): Firestore only
 *   - FINANCE_DUAL_WRITE=true: write to both Firestore AND Postgres
 *   - FINANCE_READ_POSTGRES=true: reads come from Postgres
 *
 * All other modules in lib/finance/ are pure and database-agnostic.
 *
 * @module finance/repository
 */
'use strict';

/**
 * @typedef {Object} FinanceRepositoryDeps
 * @property {FirebaseFirestore.Firestore} db - Firestore instance (injected)
 * @property {Function} [getSupabaseAdmin] - Supabase admin client getter (injected, optional)
 * @property {Function} [isEnabled] - Feature flag checker (injected)
 */

/**
 * Create a Finance repository with the given dependencies.
 * Called from functions/index.js with the shared db instance.
 *
 * @param {FinanceRepositoryDeps} deps
 */
function createRepository(deps) {
  const { db, getSupabaseAdmin, isEnabled = () => false } = deps;

  return {
    /**
     * Get invoices with optional filters.
     * @param {{ ferme?: string, status?: string, limit?: number }} [filters]
     */
    async getInvoices(filters = {}) {
      // TODO Step 3: if (isEnabled('FINANCE_READ_POSTGRES')) return getInvoicesFromPostgres(filters);
      /** @type {FirebaseFirestore.Query} */ // .where()/.limit() renvoient une Query, pas la collection
      let query = db.collection('invoices');
      if (filters.status) query = query.where('payment_status', '==', filters.status);
      if (filters.ferme) query = query.where('ferme', '==', filters.ferme);
      if (filters.limit) query = query.limit(filters.limit);
      const snap = await query.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /**
     * Update invoice payment status.
     * @param {string} invoiceId
     * @param {string} nextStatus
     * @param {Record<string, any>} updateData
     */
    async updateInvoiceStatus(invoiceId, nextStatus, updateData) {
      const ref = db.collection('invoices').doc(invoiceId);
      await ref.update({ payment_status: nextStatus, ...updateData, updatedAt: Date.now() });
      // TODO Step 3: if (isEnabled('FINANCE_DUAL_WRITE')) await updateInvoiceStatusInPostgres(...);
    },

    /**
     * Get caisse transactions for a given period and ferme.
     * @param {{ ferme?: string, dateFrom?: string, dateTo?: string }} [filters]
     */
    async getCaisseTransactions(filters = {}) {
      // TODO Step 3: if (isEnabled('FINANCE_READ_POSTGRES')) return getCaisseFromPostgres(filters);
      let query = db.collection('caisse_transactions').orderBy('date', 'desc');
      if (filters.ferme) query = query.where('ferme', '==', filters.ferme);
      const snap = await query.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /**
     * Get liquidations for a given quinzaine.
     * @param {{ quinzaine?: string, ferme?: string }} [filters]
     */
    async getLiquidations(filters = {}) {
      // TODO Step 3: if (isEnabled('FINANCE_READ_POSTGRES')) return getLiquidationsFromPostgres(filters);
      let query = db.collection('liquidations').orderBy('date', 'desc');
      if (filters.quinzaine) query = query.where('quinzaine', '==', filters.quinzaine);
      const snap = await query.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
  };
}

module.exports = { createRepository };
