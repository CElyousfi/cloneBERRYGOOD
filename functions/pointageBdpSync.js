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
 * ── DÉCISION DE GRAIN (clé de liaison) — P2b MULTI-PARCELLE ─────────────────
 * Le modèle brut : un Pointage (en-tête) a N Personnel_Pointage ET N
 * Pointage_ParcelleCulturale ET (quasi toujours 1) Pointage_Operation_REF.
 *
 * VÉRITÉ TERRAIN (BR_Pointage mirror figé, validation croisée juin) : quand un
 * ouvrier couvre N parcelles dans un bon, BR_Pointage produit **1 ligne par
 * (ouvrier × parcelle)**, avec `Nombre_Jr` ET `Cout` **splittés au prorata du
 * poids de la parcelle**. Les ratios sont IDENTIQUES pour tous les ouvriers du
 * même bon → le poids est au niveau PARCELLE (Pointage_ParcelleCulturale), pas
 * par ouvrier.
 *
 * Grain retenu — 1 ligne par (Personnel_Pointage × Pointage_ParcelleCulturale
 * du même IDPointage) :
 *   - JOIN pp × ppc ON ppc.IDPointage = pp.IDPointage → cartésien VOULU
 *     (ouvrier × parcelle). Chaque ligne porte SA parcelle (ppc.ParcCul_ID).
 *   - SPLIT proportionnel au poids de la parcelle
 *       w_p = ppc.COUT / SUM(ppc.COUT) OVER (PARTITION BY ppc.IDPointage)
 *     (fraction du coût de la parcelle dans le bon, déjà splitté par BEE ONE).
 *     → Nombre_Jr = pp.Nombre_jour × w_p ; Cout = pp.cout × w_p.
 *     Qte_Unite / HS_* : répartis au même ratio w_p (Cout et Nombre_Jr sont la
 *     clé de validation).
 *   - Cas MONO-PARCELLE (majorité) : une seule ppc → w_p = 1 → Jr=Nombre_jour,
 *     Cout=cout → comportement IDENTIQUE à avant (ne casse pas les 3 jours à
 *     100%).
 *   - Division par zéro : si SUM(ppc.COUT) OVER (...) = 0 (COÛTs nuls/absents),
 *     fallback à parts ÉGALES w_p = 1 / COUNT(ppc) OVER (PARTITION BY IDPointage)
 *     (géré côté SQL via NULLIF + expression de repli).
 *   - HYPOTHÈSE POIDS = ppc.COUT. Si la re-validation juin ne tombe pas à 100%,
 *     alternatives à tester (dans l'ordre) : ppc.Heure_Per, ppc.Poid, ppc.NBr_P.
 *   - Opération : mono-op (multi_operation=0) → on garde la sous-requête
 *     MIN(ID_operation_Ref) de l'en-tête (NE PAS toucher au split opération).
 *   - Parcelle : ppc.ParcCul_ID → ParcelleCulturale (Ref, Ref_parcelle, Variete).
 *     Culture : aucun chemin FK certain BDP → best-effort NULL.
 *
 * Ce choix est une HYPOTHÈSE (poids = ppc.COUT). L'ORACLE = la validation
 * croisée juin contre le mirror figé. On itère le poids dessus AVANT toute
 * bascule live. Diagnostic de grain émis par en-tête.
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
 * P2b MULTI-PARCELLE — grain = 1 ligne par (Personnel_Pointage ×
 * Pointage_ParcelleCulturale du même IDPointage). Le JOIN pp × ppc est un
 * cartésien VOULU (ouvrier × parcelle du bon).
 *
 * SPLIT au prorata du poids de la parcelle. Le poids w_p est calculé côté SQL
 * (fenêtre) et EXPOSÉ dans la colonne `w_p` ; la MULTIPLICATION (× w_p) est
 * appliquée dans le mapper PUR (mapBdpRowToContract) → testable unitairement.
 *   w_p = ppc.COUT / SUM(ppc.COUT) OVER (PARTITION BY ppc.IDPointage)
 * Poids choisi = ppc.COUT (coût parcelle déjà splitté par BEE ONE).
 * Fallback division/0 : si SUM(ppc.COUT) OVER (...) = 0 (COÛTs nuls/absents),
 *   w_p = 1 / COUNT(*) OVER (PARTITION BY ppc.IDPointage) (parts ÉGALES).
 *   Implémenté via NULLIF(...) + COALESCE vers l'expression de repli.
 * Cas mono-parcelle : une seule ppc → w_p = 1 → comportement IDENTIQUE à avant.
 *
 * L'opération reste mono-op (MIN(ID_operation_Ref) de l'en-tête) — pas de split
 * opération. Fenêtre SARGable : WHERE pt.DATE >= @from AND pt.DATE < @toExcl.
 */
const RECONSTRUCTION_SQL = `
  SELECT
    CONVERT(varchar(10), pt.DATE, 23)              AS DateStr,
    per.Mat                                        AS Personnel_Matricule,
    per.Nom                                        AS Personnel_Nom,
    -- Nombre_Hr : HJ = heures journée standard (=8). HN est NULL en BDP.
    -- NON splitté (heure journée standard, pas un cumul du bon).
    pp.HJ                                           AS Nombre_Hr,
    -- Valeurs BRUTES au niveau OUVRIER (le split × w_p est fait dans le mapper).
    pp.Nombre_jour                                  AS Nombre_jour_raw,
    pp.cout                                         AS cout_raw,
    pp.Qte_Unite                                    AS Qte_Unite_raw,
    pp.HS_25 AS HS_25_raw, pp.HS_50 AS HS_50_raw, pp.HS_100 AS HS_100_raw,
    -- Poids de la parcelle dans le bon (fraction du coût parcelle). Fallback
    -- parts égales si somme des coûts nulle (évite division par zéro).
    COALESCE(
      1.0 * ppc.COUT / NULLIF(SUM(ppc.COUT) OVER (PARTITION BY ppc.IDPointage), 0),
      1.0 / COUNT(*) OVER (PARTITION BY ppc.IDPointage)
    )                                               AS w_p,
    oref.OpeRef_Intitule                            AS Operation,
    fam.Famille                                     AS Operation_Famille,
    grp.Groupe                                      AS Operation_Groupe,
    pc.Ref                                           AS Parcelle_Culturale,
    pc.Ref_parcelle                                 AS Ref_parcelle,
    v.Variete                                       AS Variete,
    -- Culture : aucun chemin FK CERTAIN depuis ParcelleCulturale ni Variete
    -- (Variete = {ID, Variete} sans FK culture). Best-effort NULL : champ
    -- d'affichage uniquement, HORS clé de validation croisée et HORS paie.
    CAST(NULL AS varchar(100))                       AS Culture,
    perp.Periode                                    AS Periode_paie,
    pt.IDPointage                                   AS _IDPointage
  FROM Personnel_Pointage pp
  INNER JOIN Pointage pt        ON pp.IDPointage = pt.IDPointage
  -- Cartésien VOULU : 1 ligne par (ouvrier × parcelle) du même bon.
  INNER JOIN Pointage_ParcelleCulturale ppc ON ppc.IDPointage = pt.IDPointage
  LEFT  JOIN Personnel per      ON pp.Pers_Id = per.ID
  LEFT  JOIN Periode_paie perp  ON pt.Periode = perp.IDPeriode
  -- Opération PRINCIPALE de l'en-tête (mono-op, déterministe, anti-cartésien)
  LEFT  JOIN Operation_REF oref ON oref.OpeRef_Id = (
    SELECT MIN(por.ID_operation_Ref)
      FROM Pointage_Operation_REF por
     WHERE por.IDPointage = pt.IDPointage
  )
  LEFT  JOIN Famille_Operation fam ON oref.Oper_Famille = fam.ID
  LEFT  JOIN Groupe_Operation  grp ON oref.OpeRef_Gr = grp.ID
  -- Parcelle de CETTE ligne (celle de la jointure ppc, pas MIN de l'en-tête)
  LEFT  JOIN ParcelleCulturale pc ON pc.ID = ppc.ParcCul_ID
  LEFT  JOIN Variete v          ON pc.Variete = v.ID
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
            "P2b grain = 1 ligne par (ouvrier × parcelle) ; Nombre_Jr & Cout splittés au poids parcelle " +
            "w_p = ppc.COUT / SUM(ppc.COUT) OVER (bon), fallback parts égales si somme nulle. " +
            "Opération mono-op (MIN de l'en-tête). entetes_multi_parcelle = bons concernés par le split.",
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
