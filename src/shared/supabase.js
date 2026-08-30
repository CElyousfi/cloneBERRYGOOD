// @ts-check
/**
 * Supabase browser client — safe for frontend (anon key + RLS enforced).
 * Import this in src/features/ components that need direct Supabase access.
 *
 * @module shared/supabase
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://eqopexrgcottuzfkywgi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxb3BleHJnY290dHV6Zmt5d2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NjA4NDYsImV4cCI6MjEwMzIzNjg0Nn0.HVxV5Z-67wxiBUMKk1nxj5GSttQy3itzH2GBYuBHxRQ';

/** @type {import('@supabase/supabase-js').SupabaseClient} */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // We use Firebase Auth — Supabase auth is bypassed via RLS custom claims
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: 'public',
  },
});

/**
 * Set the Firebase user UID as a Supabase request header so RLS policies
 * can identify the caller. Call this after Firebase auth state changes.
 *
 * @param {string|null} uid - Firebase user UID
 * @param {string|null} profile - User profile ID (e.g. 'finance', 'dg', 'chef')
 */
export function setSupabaseAuthContext(uid, profile) {
  // Supabase RLS reads these from request headers set in postgres.conf
  // or via a set_config() wrapper function called at session start.
  // Implementation: Cloud Function sets a signed JWT with uid+profile claims.
  // For now this is a stub — filled in during Step 3 RLS implementation.
  if (process.env.NODE_ENV === 'development') {
    console.debug('[supabase] auth context:', { uid, profile });
  }
}
