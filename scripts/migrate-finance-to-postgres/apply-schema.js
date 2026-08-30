#!/usr/bin/env node
// @ts-check
/**
 * apply-schema.js — Apply Finance schema to Supabase via pg pooler (IPv4).
 * Usage: SUPABASE_DB_PASS=<password> node scripts/migrate-finance-to-postgres/apply-schema.js
 */
'use strict';

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const SCHEMA_FILE = path.join(__dirname, '001_schema.sql');
const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');

const client = new Client({
  host: 'aws-0-eu-west-3.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.eqopexrgcottuzfkywgi',
  password: process.env.SUPABASE_DB_PASS,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function main() {
  if (!process.env.SUPABASE_DB_PASS) {
    console.error('ERROR: SUPABASE_DB_PASS not set.');
    console.error('Find it at: https://app.supabase.com/project/eqopexrgcottuzfkywgi/settings/database');
    process.exit(1);
  }
  console.log('Connecting to Supabase pooler...');
  await client.connect();
  console.log('Connected. Applying schema...');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Schema applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

main()
  .catch(err => { console.error('Failed:', err.message); process.exit(1); })
  .finally(() => client.end());
