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
const sqlConfigProd = require("../../../config/sqlConfigProd");

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

  // ── SECTION 7 : FRAÎCHEUR DES DONNÉES DE POINTAGE (read-only) ────────────
  // Objectif : mesurer jusqu'à quelle date chaque table de pointage est peuplée
  // (MAX date + COUNT) et échantillonner les dernières lignes. Chaque requête est
  // isolée : une erreur (ex. colonne date au nom différent) n'interrompt pas la
  // section, elle est capturée par runQuery et renvoie {ok:false, error}.
  const section7 = {};

  // 7.1 — Pointage (table brute)
  section7.Pointage = {};
  section7.Pointage.stats = await runQuery(
    pool,
    `SELECT MAX(DATE) AS max_date, COUNT(*) AS total FROM Pointage`
  );
  section7.Pointage.derniers = await runQuery(
    pool,
    `SELECT TOP 3 IDPointage, DATE, IDFermes, Periode, Valide_pointage
       FROM Pointage ORDER BY DATE DESC`
  );

  // 7.2 — Personnel_Pointage
  section7.Personnel_Pointage = {};
  section7.Personnel_Pointage.stats = await runQuery(
    pool,
    `SELECT MAX(DATE) AS max_date, COUNT(*) AS total FROM Personnel_Pointage`
  );
  section7.Personnel_Pointage.derniers = await runQuery(
    pool,
    `SELECT TOP 3 IDPointage, Pers_Id, DATE, cout, HN
       FROM Personnel_Pointage ORDER BY DATE DESC`
  );

  // 7.3 — BR_Pointage (confirmation qu'elle est vide)
  section7.BR_Pointage = {};
  section7.BR_Pointage.stats = await runQuery(
    pool,
    `SELECT COUNT(*) AS total, MAX(Periode_Date) AS max_date FROM BR_Pointage`
  );

  // 7.4 — Pointage_ParcelleCulturale
  section7.Pointage_ParcelleCulturale = {};
  section7.Pointage_ParcelleCulturale.stats = await runQuery(
    pool,
    `SELECT MAX(DATE) AS max_date, COUNT(*) AS total FROM Pointage_ParcelleCulturale`
  );

  report.sections["7_fraicheur"] = section7;

  // ── SECTION 8 : TABLES DE RÉFÉRENCE POUR LE MAPPING DU PULL POINTAGE ─────
  // Read-only strict : pour chaque table de référence, colonnes
  // (INFORMATION_SCHEMA.COLUMNS) + échantillon (SELECT TOP N *). Objectif :
  // trouver le label quinzaine + campagne (Periode_paie), les libellés
  // Operation (Operation_REF), le nom de ferme (Fermes) et la fonction
  // (Fonction_Personnel) pour mapper le pull pointage.
  const section8 = {};

  // Helper local : colonnes + échantillon TOP N * d'une table de référence.
  async function refTable(tableName, topN) {
    const detail = {};
    detail.colonnes = await runQuery(
      pool,
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION`,
      { t: tableName }
    );
    if (/^[A-Za-z0-9_]+$/.test(tableName)) {
      const sample = await runQuery(pool, `SELECT TOP ${topN} * FROM [${tableName}]`);
      if (sample.ok) sample.rows = truncateSample(sample.rows);
      detail.echantillon = sample;
    } else {
      detail.echantillon = { ok: false, error: "Nom de table non valide pour interpolation." };
    }
    return detail;
  }

  // 8.1 — Periode_paie (label quinzaine « Quinzaine N » + campagne)
  section8.Periode_paie = await refTable("Periode_paie", 3);
  // Requête ciblée : les périodes récentes (dont la 49), triées par IDPeriode DESC.
  {
    const recentes = await runQuery(
      pool,
      `SELECT TOP 5 * FROM Periode_paie ORDER BY IDPeriode DESC`
    );
    if (recentes.ok) recentes.rows = truncateSample(recentes.rows);
    section8.Periode_paie.recentes = recentes;
  }

  // 8.2 — Operation_REF (libellés Operation / Operation_Famille / Operation_Groupe)
  section8.Operation_REF = await refTable("Operation_REF", 3);

  // 8.3 — Fermes (nom de ferme, mapping F1/F5/Avocatier/BAHIA) — TOP 20
  section8.Fermes = await refTable("Fermes", 20);

  // 8.4 — Fonction_Personnel (jointure Personnel_Pointage.IDFonction_personnel) — TOP 5
  section8.Fonction_Personnel = await refTable("Fonction_Personnel", 5);

  // 8.5 — ParcelleCulturale (parcelles culturales) — TOP 5
  section8.ParcelleCulturale = await refTable("ParcelleCulturale", 5);

  report.sections["8_tables_reference"] = section8;

  // ── SECTION 9 : MAKE-OR-BREAK — Y a-t-il du pointage juillet / campagne 26/27 ?
  // Read-only strict. Les littéraux de date/année sont fixes (issus du prompt,
  // pas d'entrée externe). Chaque requête est isolée via runQuery : une erreur
  // (ex. colonne date au nom différent) renvoie {ok:false, error} sans casser
  // la section.
  const section9 = {};

  // 9.1 — Pointage (table brute) : fraîcheur + volume juillet
  section9.Pointage = {};
  section9.Pointage.stats = await runQuery(
    pool,
    `SELECT MAX(DATE) AS max_date, COUNT(*) AS total FROM Pointage`
  );
  section9.Pointage.derniers = await runQuery(
    pool,
    `SELECT TOP 3 IDPointage, DATE, IDFermes, Periode, Valide_pointage
       FROM Pointage ORDER BY DATE DESC`
  );
  section9.Pointage.juillet = await runQuery(
    pool,
    `SELECT COUNT(*) AS juillet_count FROM Pointage WHERE DATE >= '2026-07-01'`
  );

  // 9.2 — Personnel_Pointage : fraîcheur + volume juillet
  section9.Personnel_Pointage = {};
  section9.Personnel_Pointage.stats = await runQuery(
    pool,
    `SELECT MAX(DATE) AS max_date, COUNT(*) AS total FROM Personnel_Pointage`
  );
  section9.Personnel_Pointage.derniers = await runQuery(
    pool,
    `SELECT TOP 3 IDPointage, Pers_Id, DATE, cout
       FROM Personnel_Pointage ORDER BY DATE DESC`
  );
  section9.Personnel_Pointage.juillet = await runQuery(
    pool,
    `SELECT COUNT(*) AS juillet_count FROM Personnel_Pointage WHERE DATE >= '2026-07-01'`
  );

  // 9.3 — Ventilation par campagne des lignes juillet (jointure Periode_paie)
  section9.ventilation_campagne_juillet = await runQuery(
    pool,
    `SELECT peri.ID_compagne, peri.compagne, MIN(pt.DATE) AS min_date,
            MAX(pt.DATE) AS max_date, COUNT(*) AS nb
       FROM Pointage pt
       LEFT JOIN Periode_paie peri ON pt.Periode = peri.IDPeriode
      WHERE pt.DATE >= '2026-07-01'
      GROUP BY peri.ID_compagne, peri.compagne
      ORDER BY peri.ID_compagne`
  );
  section9.campagnes = await runQuery(
    pool,
    `SELECT DISTINCT TOP 10 peri.ID_compagne, peri.compagne, peri.annee
       FROM Periode_paie peri ORDER BY peri.ID_compagne DESC`
  );

  // 9.4 — Vérif que la campagne 2026/2027 a du pointage
  section9.campagne_2026_2027 = await runQuery(
    pool,
    `SELECT peri.compagne, COUNT(*) AS nb, MIN(pt.DATE) AS min_d, MAX(pt.DATE) AS max_d
       FROM Pointage pt
       JOIN Periode_paie peri ON pt.Periode = peri.IDPeriode
      WHERE peri.annee = 2027 OR peri.compagne LIKE '%2026%2027%'
         OR peri.compagne LIKE '%2026/2027%'
      GROUP BY peri.compagne`
  );

  report.sections["9_make_or_break"] = section9;

  // ── SECTION 10 : STRUCTURE DU GRAIN OUVRIER ↔ PARCELLE ───────────────────
  // Read-only strict. Objectif : comprendre comment un ouvrier est lié à une ou
  // plusieurs parcelles dans un bon de pointage, sur un cas MULTI-parcelle
  // (10/06, celui qui porte les écarts) et un cas MONO-parcelle (12/06, 100%).
  // Les IDPointage sont récupérés dynamiquement puis VALIDÉS entier
  // (Number.isInteger) avant toute réutilisation interpolée. Dates = littéraux
  // fixes. Chaque requête isolée via runQuery.
  const section10 = { multi: {}, mono: {}, pp_parcelle_fk: null };

  // Helper local : dump des 3 tables du bon pour un IDPointage validé entier.
  async function dumpBon(idPointage) {
    const bon = { idPointage };
    bon.personnel_pointage = await runQuery(
      pool,
      `SELECT pp.IDPointage, pp.Pers_Id, per.Mat, pp.Nombre_jour, pp.cout,
              pp.HJ, pp.HN, pp.Unite_Operation, pp.Qte_Unite
         FROM Personnel_Pointage pp
         JOIN Personnel per ON pp.Pers_Id = per.ID
        WHERE pp.IDPointage = ${idPointage}`
    );
    bon.parcelles = await runQuery(
      pool,
      `SELECT * FROM Pointage_ParcelleCulturale WHERE IDPointage = ${idPointage}`
    );
    bon.operations = await runQuery(
      pool,
      `SELECT * FROM Pointage_Operation_REF WHERE IDPointage = ${idPointage}`
    );
    return bon;
  }

  // 10.1 — En-tête MULTI-parcelle le 10/06
  section10.multi.header = await runQuery(
    pool,
    `SELECT TOP 1 ppc.IDPointage, COUNT(*) AS nb_parcelles
       FROM Pointage_ParcelleCulturale ppc
       JOIN Pointage pt ON ppc.IDPointage = pt.IDPointage
      WHERE CONVERT(date, pt.DATE) = '2026-06-10'
      GROUP BY ppc.IDPointage
     HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC`
  );
  if (
    section10.multi.header.ok &&
    section10.multi.header.rows.length > 0 &&
    Number.isInteger(section10.multi.header.rows[0].IDPointage)
  ) {
    const idMulti = section10.multi.header.rows[0].IDPointage;
    section10.multi.nb_parcelles = section10.multi.header.rows[0].nb_parcelles;
    const dump = await dumpBon(idMulti);
    section10.multi.idPointage = dump.idPointage;
    section10.multi.personnel_pointage = dump.personnel_pointage;
    section10.multi.parcelles = dump.parcelles;
    section10.multi.operations = dump.operations;
  } else {
    section10.multi.note =
      "Aucun en-tête MULTI-parcelle valide (IDPointage entier) trouvé le 2026-06-10.";
  }

  // 10.2 — En-tête MONO-parcelle le 12/06
  section10.mono.header = await runQuery(
    pool,
    `SELECT TOP 1 ppc.IDPointage
       FROM Pointage_ParcelleCulturale ppc
       JOIN Pointage pt ON ppc.IDPointage = pt.IDPointage
      WHERE CONVERT(date, pt.DATE) = '2026-06-12'
      GROUP BY ppc.IDPointage
     HAVING COUNT(*) = 1`
  );
  if (
    section10.mono.header.ok &&
    section10.mono.header.rows.length > 0 &&
    Number.isInteger(section10.mono.header.rows[0].IDPointage)
  ) {
    const idMono = section10.mono.header.rows[0].IDPointage;
    const dump = await dumpBon(idMono);
    section10.mono.idPointage = dump.idPointage;
    section10.mono.personnel_pointage = dump.personnel_pointage;
    section10.mono.parcelles = dump.parcelles;
    section10.mono.operations = dump.operations;
  } else {
    section10.mono.note =
      "Aucun en-tête MONO-parcelle valide (IDPointage entier) trouvé le 2026-06-12.";
  }

  // 10.3 — FK parcelle DIRECTE dans Personnel_Pointage ?
  section10.pp_parcelle_fk = await runQuery(
    pool,
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Personnel_Pointage'
        AND (COLUMN_NAME LIKE '%parc%' OR COLUMN_NAME LIKE '%ParcCul%')`
  );

  report.sections["10_structure_grain"] = section10;

  // ── SECTION 11 : PARCELLES DE JUILLET (connues + variété) ────────────────
  // Read-only strict. Les Ref_parcelle du pointage de juillet sont-ils déjà
  // connus dans ParcelleCulturale + leur variété. Date = littéral fixe.
  const section11 = {};
  section11.rows = await runQuery(
    pool,
    `SELECT pc.Ref_parcelle, pc.Ref AS parcelle_label, v.Variete,
            pc.IDFermes, MIN(pt.DATE) AS premiere_date, COUNT(*) AS nb_lignes
       FROM Pointage pt
       JOIN Pointage_ParcelleCulturale ppc ON ppc.IDPointage = pt.IDPointage
       JOIN ParcelleCulturale pc ON ppc.ParcCul_ID = pc.ID
       LEFT JOIN Variete v ON pc.Variete = v.ID
      WHERE pt.DATE >= '2026-07-01'
      GROUP BY pc.Ref_parcelle, pc.Ref, v.Variete, pc.IDFermes
      ORDER BY pc.Ref_parcelle`
  );
  report.sections["11_parcelles_juillet"] = section11;

  report.durationMs = Date.now() - startTime;
  return report;
}

module.exports = { introspect };
