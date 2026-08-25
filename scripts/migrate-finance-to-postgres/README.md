# Finance Migration to Postgres Runbook

This guide explains how to execute the migration of the Finance domain from Firestore to Postgres.

## 1. Prerequisites
- **Supabase credentials**: Set `SUPABASE_SERVICE_ROLE_KEY` in your environment.
  ```bash
  export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
  ```
- **Firebase credentials**: If not running in a deployed environment with a service account, set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON file, or ensure you are logged in via Firebase CLI and `admin.initializeApp()` works.
- **Node.js environment**: Run `npm install` to ensure `firebase-admin` and `@supabase/supabase-js` are available.

## 2. Apply the Schema
Run `001_schema.sql` against the Supabase database.
You can do this using `psql`:
```bash
psql "$DATABASE_URL" -f scripts/migrate-finance-to-postgres/001_schema.sql
```
Or simply copy-paste its contents into the Supabase Dashboard SQL Editor and execute it.
The script is idempotent (`CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, etc.).

## 3. Run the Seed (Dry-run mode)
Before inserting data, verify how many documents will be migrated and check a data sample:
```bash
node scripts/migrate-finance-to-postgres/002_seed.js --dry-run
```
You can also run a specific collection:
```bash
node scripts/migrate-finance-to-postgres/002_seed.js --dry-run --collection=invoices
```

## 4. Run the Seed (Live mode)
Once the dry-run looks good, remove the flag to perform the actual migration:
```bash
node scripts/migrate-finance-to-postgres/002_seed.js
```
The script uses upsert logic (`ON CONFLICT (firestore_id) DO UPDATE`), making it idempotent.

## 5. Validate the Migration
Compare Firestore counts and financial totals against Postgres data:
```bash
node scripts/migrate-finance-to-postgres/003_validate.js
```
Ensure it returns `Result: ✅ All checks passed` (Exit code 0).

## 6. Enable Dual-Write Feature Flag
Start writing to both Firestore and Postgres.
Enable the feature flag in your configuration or application settings. Ensure your repository layer writes to both DBs if the flag is on.

## 7. Enable Postgres Reads Feature Flag
After confirming dual-write stability, flip the feature flag to serve reads from Postgres instead of Firestore.

## 8. Rollback Procedure
If issues are detected:
1. Turn off the Postgres reads feature flag (fall back to Firestore reads).
2. Turn off the dual-write feature flag.
3. Investigate data or schema discrepancies. Use `003_validate.js` to isolate missing entries.

## 9. Archive Procedure for Firestore Collections
Once Postgres is the sole source of truth and system stability is confirmed for at least 30 days:
1. Export the Firestore Finance collections (`invoices`, `caisse`, `demandes_virement`, `liquidations`, `ojra_payroll`, etc.) to Google Cloud Storage.
2. Verify the export.
3. Delete the collections from Firestore to save costs and avoid confusion.
4. Remove all dual-write fallback code.
