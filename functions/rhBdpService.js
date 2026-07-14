/**
 * rhBdpService.js — Référentiel personnel RH depuis BEE ONE (BEE_BERRY_GOOD).
 *
 * READ-ONLY STRICT : uniquement des SELECT sur la table Personnel.
 *
 * Colonnes BEE ONE confirmées par introspection INFORMATION_SCHEMA (2026-07-14) :
 *   - Mat      varchar(50) — matricule (clé côté dashboard)
 *   - Nom      varchar(50)
 *   - Prenom   varchar(50)
 *   - CIN      varchar(50) — numéro CIN (peut être NULL)
 *   - CNSS     varchar(50) — numéro CNSS (peut être NULL)
 *
 * Connexion : réutilise sqlConfigProd (BEE_BERRY_GOOD, pool mssql max 5).
 * Pattern identique à prodSyncService.js / pointageBdpSync.js.
 */

'use strict';

const sql = require('mssql');
const sqlConfigProd = require('./config/sqlConfigProd');

let poolProd = null;
async function getPoolProd() {
  if (!poolProd) {
    poolProd = new sql.ConnectionPool(sqlConfigProd);
    await poolProd.connect();
  }
  return poolProd;
}

/**
 * Mappe un tableau de lignes SQL Personnel vers le contrat de sortie.
 * Fonction PURE — aucun I/O. Testable unitairement.
 *
 * @param {Array<{Mat:string, Nom:string, Prenom:string, CIN:string|null, CNSS:string|null}>} rows
 * @returns {{ [matricule: string]: { cin: string|null, cnss: string|null, nom: string|null, prenom: string|null } }}
 */
function mapPersonnelRows(rows) {
  const data = {};
  for (const row of rows) {
    const mat = (row.Mat || '').trim();
    if (!mat) continue;
    data[mat] = {
      cin:    row.CIN    ? String(row.CIN).trim()    : null,
      cnss:   row.CNSS   ? String(row.CNSS).trim()   : null,
      nom:    row.Nom    ? String(row.Nom).trim()    : null,
      prenom: row.Prenom ? String(row.Prenom).trim() : null,
    };
  }
  return data;
}

/**
 * Récupère le référentiel personnel depuis BEE ONE.
 *
 * @returns {Promise<{success: boolean, data?: Object, count?: number, error?: string}>}
 *   data = { [matricule]: { cin, cnss, nom, prenom } }
 */
async function getPersonnelRef() {
  let pool;
  try {
    pool = await getPoolProd();
  } catch (err) {
    return { success: false, error: `Connexion BDP échouée : ${err.message || String(err)}` };
  }

  try {
    const result = await pool.request().query(
      `SELECT Mat, Nom, Prenom, CIN, CNSS
         FROM Personnel
        WHERE Mat IS NOT NULL AND Mat <> ''
        ORDER BY Mat`
    );

    const data = mapPersonnelRows(result.recordset);
    return { success: true, data, count: Object.keys(data).length };
  } catch (err) {
    return { success: false, error: `Requête Personnel échouée : ${err.message || String(err)}` };
  }
}

module.exports = { getPersonnelRef, mapPersonnelRows };
