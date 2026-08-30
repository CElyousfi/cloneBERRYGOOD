// @ts-check
import { supabase } from '../supabase.js';
import { defaultAppData } from '../utils/appDataMock.js';

/**
 * Live Data Provider — connects frontend views directly to Supabase PostgreSQL.
 * Fetches real records for Invoices, Caisse, Inspections, Brix, Expeditions, Liquidations, OJRA.
 */

export async function fetchLiveDomainData() {
  try {
    const [
      invoicesRes,
      caisseRes,
      inspectionsRes,
      brixRes,
      expeditionsRes,
      liquidationsRes,
      virementsRes,
      codesRes,
      ojraRes,
      bonsRes
    ] = await Promise.all([
      supabase.from('invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('caisse_transactions').select('*').order('date', { ascending: false }),
      supabase.from('inspections').select('*').order('created_at', { ascending: false }),
      supabase.from('brix_readings').select('*').order('date', { ascending: false }),
      supabase.from('expeditions').select('*').order('date', { ascending: false }),
      supabase.from('liquidations').select('*').order('date_liquidation', { ascending: false }),
      supabase.from('virements').select('*').order('date_virement', { ascending: false }),
      supabase.from('codes_analytiques').select('*').order('code', { ascending: true }),
      supabase.from('ojra_payroll').select('*').order('quinzaine', { ascending: false }),
      supabase.from('bons_apport').select('*').order('date_bon', { ascending: false })
    ]);

    const liveData = { ...defaultAppData };

    if (invoicesRes.data && invoicesRes.data.length > 0) {
      liveData.invoices = invoicesRes.data;
    }
    if (caisseRes.data && caisseRes.data.length > 0) {
      liveData.caisseTransactions = caisseRes.data;
    }
    if (inspectionsRes.data && inspectionsRes.data.length > 0) {
      liveData.qualiteInspections = inspectionsRes.data;
    }
    if (brixRes.data && brixRes.data.length > 0) {
      liveData.qualiteBrix = brixRes.data;
    }
    if (expeditionsRes.data && expeditionsRes.data.length > 0) {
      liveData.expeditions = expeditionsRes.data;
    }
    if (liquidationsRes.data && liquidationsRes.data.length > 0) {
      liveData.liquidations = liquidationsRes.data;
    }
    if (virementsRes.data && virementsRes.data.length > 0) {
      liveData.virements = virementsRes.data;
    }
    if (codesRes.data && codesRes.data.length > 0) {
      liveData.codesAnalytiques = codesRes.data;
    }
    if (ojraRes.data && ojraRes.data.length > 0) {
      liveData.ojraPaie = ojraRes.data;
    }
    if (bonsRes.data && bonsRes.data.length > 0) {
      liveData.bonsApport = bonsRes.data;
    }

    return liveData;
  } catch (err) {
    console.warn('[liveDataProvider] Error fetching Supabase live data, using fallbacks:', err);
    return defaultAppData;
  }
}

/**
 * Insert a new record into Supabase PostgreSQL in real time.
 * @param {string} tableName
 * @param {Object} record
 */
export async function createLiveRecord(tableName, record) {
  try {
    const { data, error } = await supabase.from(tableName).insert([record]).select();
    if (error) {
      console.error(`[liveDataProvider] Error inserting into ${tableName}:`, error.message);
      return { success: false, error: error.message };
    }
    console.log(`[liveDataProvider] Live record created in ${tableName}:`, data);
    return { success: true, data: data[0] };
  } catch (err) {
    console.error(`[liveDataProvider] Exception inserting into ${tableName}:`, err);
    return { success: false, error: err.message };
  }
}
