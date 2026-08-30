'use strict';
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PASSWORD = process.env.SUPABASE_DB_PASS;
const SCHEMA_FILE = path.join(__dirname, '001_schema.sql');

async function run() {
  const client = new Client({
    host: 'aws-0-eu-west-3.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.eqopexrgcottuzfkywgi',
    password: PASSWORD,
    ssl: { rejectUnauthorized: false, servername: 'eqopexrgcottuzfkywgi.supabase.co' },
    connectionTimeoutMillis: 15000,
  });

  try {
    console.log('Connecting (session mode port 5432)...');
    await client.connect();
    const res = await client.query('SELECT current_database(), version()');
    console.log('Connected! DB:', res.rows[0].current_database);

    if (process.argv.includes('--apply-schema')) {
      const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
      console.log('Applying schema...');
      await client.query(sql);
      console.log('Schema applied successfully!');

      // Verify tables
      const tables = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'finance' ORDER BY table_name"
      );
      console.log('Tables created:', tables.rows.map(r => r.table_name).join(', '));
    }
  } finally {
    await client.end();
  }
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
