/**
 * sqlConfig.js — Single source of truth for SQL Server connection config.
 *
 * All credentials come from environment variables (Firebase Functions config or .env).
 * No hardcoded fallbacks — if a variable is missing, the connection fails loudly.
 */

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  port: parseInt(process.env.SQL_PORT || "1433"),
  database: process.env.SQL_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 30000,
    connectionTimeout: 15000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Validate required env vars at module load time
const required = ["SQL_USER", "SQL_PASSWORD", "SQL_SERVER", "SQL_DATABASE"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[sqlConfig] Missing required env vars: ${missing.join(", ")}. SQL connections will fail.`);
}

module.exports = sqlConfig;
