/**
 * Pull pointage FACTUEL depuis la BDP prod BEE_BERRY_GOOD → collection TÉMOIN.
 *
 * ⚠️ P2b — PULL DE VALIDATION, ZÉRO ÉCRITURE LIVE.
 * Écrit UNIQUEMENT dans `sql_mirror_pointage_bdp_test/{YYYY-MM-DD}`.
 * NE TOUCHE JAMAIS `sql_mirror_pointage` (mirror live) ni le sync live.
 *
 * BR_Pointage (mirror historique) = 1 ligne par (ouvrier × opération × parcelle
 * × jour). En BDP, BR_Pointage est VIDE → on reconstruit depuis les tables
 * BRUTES : Pointage (en-tête), Personnel_Pointage (1 ligne/ouvrier),
 * Pointage_ParcelleCulturale (parcelles), Pointage_Operation_REF (opérations).
 *
 * ── DÉCISION DE GRAIN (clé de liaison) ─────────────────────────────────────
 * Le modèle brut : un Pointage (en-tête) a N Personnel_Pointage ET N
 * Pointage_ParcelleCulturale ET N Pointage_Operation_REF. Joindre les 3
 * naïvement = PRODUIT CARTÉSIEN parasite.
 *
 * Grain retenu — ANCRAGE SUR Personnel_Pointage (1 ligne/ouvrier) :
 *   - Personnel_Pointage porte DÉJÀ HN, HS_*, Qte_Unite, cout, taux_jour,
 *     IDFonction_personnel → c'est le grain FIN de la paie (par ouvrier).
 *   - Opération : le pointage BEE ONE est saisi par « bon de pointage » (1
 *     en-tête = 1 opération d'une journée sur une ferme). Pointage_Operation_REF
 *     est donc quasi 1:1 avec Pointage. On rattache l'opération PRINCIPALE de
 *     l'en-tête via une sous-requête MIN(ID_operation_Ref) (déterministe, évite
 *     le cartésien si plusieurs opérations existent). Si le grain réel s'avère
 *     N opérations par en-tête, la validation croisée juin le révélera (lignes
 *     en trop/manquantes) et on basculera sur un JOIN + clé opération.
 *   - Parcelle : idem, on rattache la parcelle PRINCIPALE de l'en-tête via
 *     MIN(ParcCul_ID). Pointage_ParcelleCulturale porte Ref_parcelle/variété/
 *     culture par la jointure ParcelleCulturale.
 *
 * => 1 ligne produite = 1 Personnel_Pointage, enrichie de l'opération et de la
 *    parcelle PRINCIPALES de son en-tête Pointage. Pas de cartésien.
 *
 * Ce choix est une HYPOTHÈSE. L'ORACLE = la validation croisée juin
 * (validatePointageBdp) contre le mirror figé. On itère le grain dessus AVANT
 * toute bascule live. Des logs de diagnostic de grain sont émis par en-tête.
 */

const sql = require("mssql");
const { admin, db: db_firestore } = require("./config/firebase");
const sqlConfigProd = require("./config/sqlConfigProd");
const { mapBdpRowToContract } = require("./lib/pointageBdp/mapBdpRow");

let poolProd = null;
async function getPoolProd() {
  if (!poolProd) {
    poolProd = await sql.connect(sqlConfigProd);
  }
  return poolProd;
}

/**
 * Requête de reconstruction du contrat mirror depuis les tables brutes.
 *
 * Ancrage sur Personnel_Pointage. Opération et parcelle principales de l'en-tête
 * via sous-requêtes MIN(...) corrélées (déterministe, pas de cartésien).
 * Fenêtre SARGable : WHERE pt.DATE >= @from AND pt.DATE < @toExcl (pas de CONVERT
 * sur la colonne indexée).
 */
const RECONSTRUCTION_SQL = `
  SELECT
    CONVERT(varchar(10), pt.DATE, 23)              AS DateStr,
    per.Mat                                        AS Personnel_Matricule,
    per.Nom                                        AS Personnel_Nom,
    pp.HN                                           AS Nombre_Hr,
    pp.HS_25, pp.HS_50, pp.HS_100,
    pp.JC, pp.DJ1, pp.DJ2,
    pp.Qte_Unite                                    AS Quantite_unite,
    pp.cout                                         AS cout,
    oref.OpeRef_Intitule                            AS Operation,
    fam.Famille_Operation                           AS Operation_Famille,
    grp.Groupe_Operation                            AS Operation_Groupe,
    pc.Parcelle_Culturale                           AS Parcelle_Culturale,
    pc.Ref_parcelle                                 AS Ref_parcelle,
    v.Variete                                       AS Variete,
    cul.Culture                                     AS Culture,
    perp.Periode                                    AS Periode_paie,
    pt.IDPointage                                   AS _IDPointage
  FROM Personnel_Pointage pp
  INNER JOIN Pointage pt        ON pp.IDPointage = pt.IDPointage
  LEFT  JOIN Personnel per      ON pp.Pers_Id = per.ID
  LEFT  JOIN Periode_paie perp  ON pt.Periode = perp.IDPeriode
  -- Opération PRINCIPALE de l'en-tête (déterministe, anti-cartésien)
  LEFT  JOIN Operation_REF oref ON oref.OpeRef_Id = (
    SELECT MIN(por.ID_operation_Ref)
      FROM Pointage_Operation_REF por
     WHERE por.IDPointage = pt.IDPointage
  )
  LEFT  JOIN Famille_Operation fam ON oref.Oper_Famille = fam.ID
  LEFT  JOIN Groupe_Operation  grp ON oref.OpeRef_Gr = grp.ID
  -- Parcelle PRINCIPALE de l'en-tête (déterministe, anti-cartésien)
  LEFT  JOIN ParcelleCulturale pc ON pc.ID = (
    SELECT MIN(ppc.ParcCul_ID)
      FROM Pointage_ParcelleCulturale ppc
     WHERE ppc.IDPointage = pt.IDPointage
  )
  LEFT  JOIN Variete v          ON pc.Variete = v.ID
  LEFT  JOIN Culture cul        ON pc.Culture = cul.ID
  WHERE pt.DATE >= @from AND pt.DATE < @toExcl
  ORDER BY pt.DATE, per.Nom
`;

/**
 * Requête de DIAGNOSTIC DE GRAIN : pour la fenêtre, cardinalités par en-tête
 * (nb Personnel_Pointage vs nb Pointage_ParcelleCulturale vs nb
 * Pointage_Operation_REF). Prouve/réfute l'hypothèse « 1 opération + 1 parcelle
 * par en-tête ». Read-only.
 */
const GRAIN_DIAG_SQL = `
  SELECT
    pt.IDPointage,
    CONVERT(varchar(10), pt.DATE, 23) AS DateStr,
    (SELECT COUNT(*) FROM Personnel_Pointage pp        WHERE pp.IDPointage = pt.IDPointage)  AS nb_ouvriers,
    (SELECT COUNT(*) FROM Pointage_ParcelleCulturale x WHERE x.IDPointage = pt.IDPointage)  AS nb_parcelles,
    (SELECT COUNT(*) FROM Pointage_Operation_REF o     WHERE o.IDPointage = pt.IDPointage)  AS nb_operations
  FROM Pointage pt
  WHERE pt.DATE >= @from AND pt.DATE < @toExcl
  ORDER BY pt.DATE
`;

/**
 * Ajoute des jours à une date YYYY-MM-DD (UTC), renvoie YYYY-MM-DD.
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull du pointage FACTUEL BDP sur la fenêtre [from, to] (inclusive) → collection
 * témoin sql_mirror_pointage_bdp_test/{YYYY-MM-DD}. Upsert par date.
 *
 * @param {import('firebase-admin').firestore.Firestore} db instance Firestore
 * @param {Object} [opts]
 * @param {string} [opts.from] YYYY-MM-DD (défaut : il y a 7 jours)
 * @param {string} [opts.to]   YYYY-MM-DD (défaut : hier)
 * @returns {Promise<Object>}
 */
async function syncPointageFromProd(db, opts) {
  const firestore = db || db_firestore;
  const o = opts || {};
  const to = o.to || new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10);
  const from = o.from || addDaysStr(to, -6); // fenêtre défaut ~7 jours
  // Borne haute exclusive (jour suivant) pour rester SARGable et inclure le jour `to`.
  const toExcl = addDaysStr(to, 1);
  const startTime = Date.now();
  console.log(`[BdpPointage] Pull FACTUEL ${from} → ${to} (témoin, zéro live)...`);

  try {
    const pool = await getPoolProd();

    // 1) Diagnostic de grain (avant le pull) — prouve/réfute le grain choisi.
    let grainDiag = { echantillon: [], resume: {} };
    try {
      const gr = await pool.request().input("from", from).input("toExcl", toExcl).query(GRAIN_DIAG_SQL);
      const gRows = gr.recordset || [];
      let carto = 0, multiOp = 0, multiParc = 0;
      for (const g of gRows) {
        // Nb de lignes qu'un JOIN NAÏF produirait vs ancrage ouvrier.
        if ((g.nb_operations || 0) > 1) multiOp++;
        if ((g.nb_parcelles || 0) > 1) multiParc++;
        if ((g.nb_operations || 0) > 1 || (g.nb_parcelles || 0) > 1) carto++;
      }
      grainDiag = {
        echantillon: gRows.slice(0, 20),
        resume: {
          entetes: gRows.length,
          entetes_multi_operation: multiOp,
          entetes_multi_parcelle: multiParc,
          entetes_a_risque_cartesien: carto,
          note:
            "Ancrage Personnel_Pointage : 1 ligne/ouvrier + opération & parcelle PRINCIPALES (MIN) de l'en-tête. " +
            "Si entetes_multi_operation/parcelle > 0, la validation croisée juin dira si des lignes manquent.",
        },
      };
      console.log(`[BdpPointage] Diag grain: ${gRows.length} en-têtes, ${multiOp} multi-op, ${multiParc} multi-parcelle`);
    } catch (e) {
      grainDiag = { error: e.message };
      console.warn("[BdpPointage] Diag grain échoué (non bloquant):", e.message);
    }

    // 2) Pull de reconstruction.
    const result = await pool.request().input("from", from).input("toExcl", toExcl).query(RECONSTRUCTION_SQL);
    const rawRows = result.recordset || [];
    console.log(`[BdpPointage] ${rawRows.length} lignes brutes reconstruites`);

    // Garde-fou 0-ligne : NE JAMAIS écrire de doc vide (n'efface rien de live,
    // mais éviter d'écraser un témoin déjà peuplé par une lecture transitoire).
    if (rawRows.length === 0) {
      console.warn("[BdpPointage] 0 ligne sur la fenêtre — aucune écriture témoin.");
      await firestore.collection("sql_mirror_pointage_bdp_test").doc("_status").set({
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        from, to, jours: 0, lignes: 0, empty: true,
        diagnostic_grain: grainDiag,
      }, { merge: true });
      return { success: true, from, to, jours: 0, lignes: 0, empty: true, diagnostic_grain: grainDiag, durationMs: Date.now() - startTime };
    }

    // 3) Mapping contrat + regroupement par date.
    const byDate = {};
    for (const raw of rawRows) {
      const contract = mapBdpRowToContract(raw);
      const date = contract.DateStr;
      if (!date) continue;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(contract);
    }

    // 4) Écriture témoin (upsert par date), batch chunks de 400.
    const dates = Object.keys(byDate).sort();
    let jours = 0, lignes = 0;
    let batch = firestore.batch();
    let ops = 0;
    for (const date of dates) {
      const rows = byDate[date];
      const ref = firestore.collection("sql_mirror_pointage_bdp_test").doc(date);
      batch.set(ref, {
        rows,
        rowCount: rows.length,
        source: "bdp_reconstruction_temoin",
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      jours++;
      lignes += rows.length;
      ops++;
      if (ops >= 400) {
        await batch.commit();
        batch = firestore.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();

    await firestore.collection("sql_mirror_pointage_bdp_test").doc("_status").set({
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      from, to, jours, lignes, empty: false,
      diagnostic_grain: grainDiag,
    }, { merge: true });

    const durationMs = Date.now() - startTime;
    console.log(`[BdpPointage] Témoin écrit: ${jours} jours, ${lignes} lignes en ${durationMs}ms`);
    return { success: true, from, to, jours, lignes, diagnostic_grain: grainDiag, durationMs };
  } catch (err) {
    console.error("[BdpPointage] Erreur pull:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { syncPointageFromProd, addDaysStr, RECONSTRUCTION_SQL, GRAIN_DIAG_SQL };
