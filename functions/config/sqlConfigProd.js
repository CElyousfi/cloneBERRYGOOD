/**
 * SQL Server configuration for BEE ONE Production database.
 * Used for: Tracabilite_recolte (kg par ouvrier), Presence (heures entrée/sortie)
 */

const sqlConfigProd = {
  user: process.env.SQL_USER_PROD,
  password: process.env.SQL_PASSWORD_PROD,
  server: process.env.SQL_SERVER_PROD,
  port: parseInt(process.env.SQL_PORT_PROD || "1433"),
  database: process.env.SQL_DATABASE_PROD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 30000,
    connectionTimeout: 15000,
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Validate required environment variables
const requiredVars = ["SQL_USER_PROD", "SQL_PASSWORD_PROD", "SQL_SERVER_PROD", "SQL_DATABASE_PROD"];
const missing = requiredVars.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.warn(`[sqlConfigProd] Missing env vars: ${missing.join(", ")}. Prod DB connections will fail.`);
}

module.exports = sqlConfigProd;
