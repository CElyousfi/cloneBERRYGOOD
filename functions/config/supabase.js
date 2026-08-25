// @ts-check
/**
 * Supabase server-side client — uses service_role key.
 * NEVER expose this to the browser. Used in Cloud Functions only.
 *
 * Service role key is read from environment:
 *   - Local dev: SUPABASE_SERVICE_ROLE_KEY in .env.local (gitignored)
 *   - Production: firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
 *
 * @module config/supabase
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://eqopexrgcottuzfkywgi.supabase.co';

// Loaded from Firebase Secret or .env.local — never hardcoded
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV !== 'test') {
  console.warn(
    '[supabase] SUPABASE_SERVICE_ROLE_KEY not set. ' +
    'Set via: firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY'
  );
}

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let _client = null;

/**
 * Returns the Supabase admin client (service_role).
 * Lazily initialized to avoid errors during module load in test environments.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function getSupabaseAdmin() {
  if (!_client) {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
        'Cannot initialize Supabase admin client.'
      );
    }
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}

module.exports = { getSupabaseAdmin, SUPABASE_URL };
