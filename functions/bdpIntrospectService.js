/**
 * BDP Introspection Service — DIAGNOSTIC READ-ONLY.
 *
 * Outil temporaire pour lever le schéma brut de la BDP production BEE_BERRY_GOOD
 * (tables pointage / opération / culture, source du taux de coût, présence de
 * BR_Pointage comme vue/proc, graphe de FK, format Ref_parcelle) AVANT d'écrire
 * le pull pointage.
 *
 * ⚠️ READ-ONLY STRICT : uniquement des SELECT / INFORMATION_SCHEMA / sys.*.
 * AUCUN INSERT / UPDATE / DELETE / DDL. À retirer après usage.
 *
 * Connexion : réutilise le pattern du pull récolte (sqlConfigProd → BEE_BERRY_GOOD,
 * pool mssql max 5). Ne crée PAS de nouvelle config.
 */

const sql = require("mssql");
const sqlConfigProd = require("./config/sqlConfigProd");

let poolProd = null;
async function getPoolProd() {
  if (!poolProd) {
    poolProd = await sql.connect(sqlConfigProd);
  }
  return poolProd;
}

// Sécurité anti-écriture : on refuse toute requête qui ne serait pas un pur SELECT.
const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|SET\s|INTO)\b/i;
function assertReadOnly(query) {
  if (WRITE_KEYWORDS.test(query)) {
    throw new Error("Requête refusée : contient un mot-clé non read-only.");
  }
}

/**
 * Exécute une requête read-only et retourne {ok, rows} ou {ok:false, error}.
 * N'interrompt jamais le reste de l'introspection.
 */
async function runQuery(pool, query, inputs) {
  try {
    assertReadOnly(query);
    const request = pool.request();
    if (inputs) {
      for (const [key, val] of Object.entries(inputs)) request.input(key, val);
    }
    const result = await request.query(query);
    return { ok: true, rows: result.recordset || [] };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Tronque les valeurs énormes dans les échantillons TOP 5 pour garder le JSON lisible.
function truncateSample(rows, maxLen) {
  const limit = maxLen || 300;
  return (rows || []).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "string" && v.length > limit) {
        out[k] = v.slice(0, limit) + `…[+${v.length - limit} chars]`;
      } else if (v instanceof Buffer) {
        out[k] = `<binary ${v.length} bytes>`;
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

/**
 * Introspection complète, structurée par section 1..6.
 * @returns {Promise<Object>} JSON de diagnostic.
 */
async function introspect() {
  const startTime = Date.now();
  const report = {
    success: true,
    database: sqlConfigProd.database || "(SQL_DATABASE_PROD)",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    sections: {},
  };

  let pool;
  try {
    pool = await getPoolProd();
  } catch (e) {
    return { success: false, error: `Connexion BDP échouée : ${e.message || e}` };
  }

  // ── SECTION 1 : SOURCE DU TAUX DE COÛT ──────────────────────────────────
  report.sections["1_source_taux_cout"] = {};
  report.sections["1_source_taux_cout"].colonnes_candidates = await runQuery(
    pool,
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE COLUMN_NAME LIKE '%cout%' OR COLUMN_NAME LIKE '%tarif%'
         OR COLUMN_NAME LIKE '%taux%' OR COLUMN_NAME LIKE '%prix%'
         OR COLUMN_NAME LIKE '%salaire%' OR COLUMN_NAME LIKE '%smag%'
         OR COLUMN_NAME LIKE '%journ%' OR COLUMN_NAME LIKE '%rate%'
      ORDER BY TABLE_NAME, COLUMN_NAME`
  );
  report.sections["1_source_taux_cout"].colonnes_Personnel = await runQuery(
    pool,
    `SELECT COLUMN_NAME, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Personnel'
      ORDER BY ORDINAL_POSITION`
  );

  // ── SECTION 2 : BR_Pointage EXISTE-T-IL COMME VUE / PROC ? ───────────────
  report.sections["2_br_pointage_objets"] = {};
  report.sections["2_br_pointage_objets"].objets = await runQuery(
    pool,
    `SELECT name, type_desc FROM sys.objects
      WHERE name LIKE '%BR_Pointage%' OR name LIKE '%Pointage%'`
  );
  report.sections["2_br_pointage_objets"].definitions = await runQuery(
    pool,
    `SELECT o.name, m.definition
       FROM sys.sql_modules m
       JOIN sys.objects o ON m.object_id = o.object_id
      WHERE o.name LIKE '%Pointage%'`
  );
  report.sections["2_br_pointage_objets"].vues = await runQuery(
    pool,
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_NAME LIKE '%Pointage%'`
  );

  // ── SECTION 3 : TABLES POINTAGE / OPÉRATION / CULTURE (schéma brut) ──────
  const section3 = { tables: null, details: {} };
  section3.tables = await runQuery(
    pool,
    `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%ointage%' OR TABLE_NAME LIKE '%perati%'
         OR TABLE_NAME LIKE '%ulture%' OR TABLE_NAME LIKE '%ravail%'
         OR TABLE_NAME LIKE '%ache%' OR TABLE_NAME LIKE '%resence%'
      ORDER BY TABLE_NAME`
  );

  if (section3.tables.ok) {
    for (const t of section3.tables.rows) {
      const tableName = t.TABLE_NAME;
      const schema = t.TABLE_SCHEMA || "dbo";
      const detail = {};
      // Colonnes (paramétré, safe)
      detail.colonnes = await runQuery(
        pool,
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION`,
        { t: tableName }
      );
      // Échantillon TOP 5. Le nom de table ne peut pas être paramétré → on le
      // valide (identifiant SQL simple) avant interpolation pour rester safe.
      if (/^[A-Za-z0-9_]+$/.test(tableName) && /^[A-Za-z0-9_]+$/.test(schema)) {
        const sample = await runQuery(pool, `SELECT TOP 5 * FROM [${schema}].[${tableName}]`);
        if (sample.ok) sample.rows = truncateSample(sample.rows);
        detail.echantillon = sample;
      } else {
        detail.echantillon = { ok: false, error: "Nom de table non valide pour interpolation." };
      }
      section3.details[tableName] = detail;
    }
  }
  report.sections["3_tables_pointage"] = section3;

  // ── SECTION 4 : GRAPHE DE JOINTURES (FK) ────────────────────────────────
  report.sections["4_foreign_keys"] = await runQuery(
    pool,
    `SELECT fk.name AS fk, tp.name AS parent_table, cp.name AS parent_col,
            tr.name AS ref_table, cr.name AS ref_col
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
       JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
       JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id
             AND fkc.parent_column_id = cp.column_id
       JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
       JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id
             AND fkc.referenced_column_id = cr.column_id
      ORDER BY tp.name`
  );

  // ── SECTION 5 : FORMAT Ref_parcelle ─────────────────────────────────────
  report.sections["5_format_ref_parcelle"] = await runQuery(
    pool,
    `SELECT DISTINCT TOP 30 Ref_parcelle FROM ParcelleCulturale ORDER BY Ref_parcelle`
  );

  // ── SECTION 6 : ANCRAGE QUINZAINE (Periode_paie / Quinzaine) ────────────
  const section6 = {};
  section6.colonnes_candidates = await runQuery(
    pool,
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE COLUMN_NAME LIKE '%eriode%' OR COLUMN_NAME LIKE '%uinzaine%'
         OR COLUMN_NAME LIKE '%paie%'
      ORDER BY TABLE_NAME, COLUMN_NAME`
  );
  // Échantillon des colonnes candidates trouvées (paramétrable → interpolation validée).
  section6.echantillons = {};
  if (section6.colonnes_candidates.ok) {
    const seen = new Set();
    for (const c of section6.colonnes_candidates.rows) {
      const tbl = c.TABLE_NAME;
      const col = c.COLUMN_NAME;
      const key = `${tbl}.${col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (/^[A-Za-z0-9_]+$/.test(tbl) && /^[A-Za-z0-9_]+$/.test(col)) {
        const sample = await runQuery(
          pool,
          `SELECT DISTINCT TOP 10 [${col}] FROM [${tbl}] ORDER BY [${col}]`
        );
        section6.echantillons[key] = sample;
      }
    }
  }
  if (!section6.colonnes_candidates.ok || section6.colonnes_candidates.rows.length === 0) {
    section6.note = "Aucune colonne Periode_paie / Quinzaine trouvée en BDP → ancrage quinzaine manuel requis.";
  }
  report.sections["6_ancrage_quinzaine"] = section6;

  report.durationMs = Date.now() - startTime;
  return report;
}

module.exports = { introspect };
