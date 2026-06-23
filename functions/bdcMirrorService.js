/**
 * bdcMirrorService.js — Service de réplication MIRROR des Bons de Commande (BDC)
 * depuis BEE ONE (BEE_BERRY_GOOD, base PROD tierce) vers Firestore `bdc_mirror`.
 *
 * ⚠️ BEE_BERRY_GOOD = base de PRODUCTION TIERCE → LECTURE SEULE STRICTE.
 *    Uniquement des SELECT one-shot. Aucun write SQL, aucune boucle de polling.
 *
 * Pattern repris de functions/prodSyncService.js (connexion mssql read-only via
 * sqlConfigProd). La logique de transformation pure vit dans
 * functions/lib/bdc/mirrorSync.js (testée en isolation).
 *
 * MODE PAR DÉFAUT = DRY-RUN : on lit BEE ONE, on construit les docs en mémoire,
 * on renvoie un rapport. AUCUN write Firestore.
 * Le write Firestore (upsert idempotent par Num_BC) n'a lieu que si on appelle
 * applyMirror() — gardé derrière le flag --apply du script dry-run. NE PAS
 * exécuter tant qu'Omar n'a pas validé le dry-run.
 *
 * Étape 1 du cycle Achats — MIRROR BDC.
 */
// @ts-check
'use strict';

const sql = require('mssql');
const sqlConfigProd = require('./config/sqlConfigProd');
const { buildMirrorDocs, buildReport } = require('./lib/bdc/mirrorSync');

const MIRROR_COLLECTION = 'bdc_mirror';

/** Bornes par défaut : campagne 25-26. */
const DEFAULT_CAMPAGNE = Object.freeze({
  start: '2025-07-01',
  end: '2026-06-30',
});

/** Filtre fournisseur par défaut : TIMAC (2 fiches, Societe LIKE '%TIMAC%'). */
const DEFAULT_FOURNISSEUR_LIKE = '%TIMAC%';

let poolProd = null;

/**
 * Pool mssql read-only vers BEE ONE. Réutilisé pour éviter les reconnexions.
 * @returns {Promise<import('mssql').ConnectionPool>}
 */
async function getPoolProd() {
  if (!poolProd) {
    poolProd = await sql.connect(sqlConfigProd);
  }
  return poolProd;
}

/**
 * Requête JOINTE one-shot read-only : Bon_Commande × Demande_achat_Bon_Commande
 * × Produit × Fournisseur, filtrée par fournisseur (LIKE) et bornes de campagne.
 *
 * Utilise Produit.Ref (code article stable) — PAS Produit.Reference (vide).
 * Paramétré (inputs) pour éviter toute injection et permettre l'élargissement
 * du périmètre (fournisseur / bornes) sans toucher au SQL.
 *
 * @param {{fournisseurLike?: string, start?: string, end?: string}} [opts]
 * @returns {Promise<import('./lib/bdc/mirrorSync').SqlBdcRow[]>}
 */
async function fetchBdcRows(opts) {
  const o = opts || {};
  const fournisseurLike = o.fournisseurLike || DEFAULT_FOURNISSEUR_LIKE;
  const start = o.start || DEFAULT_CAMPAGNE.start;
  const end = o.end || DEFAULT_CAMPAGNE.end;

  const db = await getPoolProd();
  const result = await db.request()
    .input('fournisseurLike', sql.VarChar, fournisseurLike)
    .input('startDate', sql.Date, start)
    .input('endDate', sql.Date, end)
    .query(`
      SELECT
        bc.IDBon_Commande              AS IDBon_Commande,
        bc.Num_BC                      AS Num_BC,
        bc.IDFournisseur               AS IDFournisseur,
        f.Societe                      AS FournisseurSociete,
        bc.Date_BC                     AS Date_BC,
        bc.Statut                      AS Statut,
        bc.Total_Mnt_net_HT            AS Total_Mnt_net_HT,
        bc.Total_Mnt_TVA               AS Total_Mnt_net_TVA,
        bc.Total_Mnt_net_TTC           AS Total_Mnt_net_TTC,
        d.ID                           AS IDProduit,
        p.Ref                          AS ProduitRef,
        p.Designation                  AS Designation,
        d.Qte                          AS Qte,
        d.Prix_U_HT                    AS Prix_U_HT,
        d.Montant_net_ht               AS Montant_net_ht,
        d.TVA                          AS TVA,
        d.Montant_net_ttc              AS Montant_net_ttc,
        d.Reliquat                     AS Reliquat
      FROM dbo.Bon_Commande bc
      INNER JOIN dbo.Fournisseur f
        ON bc.IDFournisseur = f.ID
      LEFT JOIN dbo.Demande_achat_Bon_Commande d
        ON d.IDBon_Commande = bc.IDBon_Commande
      LEFT JOIN dbo.Produit p
        ON d.ID = p.ID
      WHERE f.Societe LIKE @fournisseurLike
        AND bc.Date_BC >= @startDate
        AND bc.Date_BC <= @endDate
      ORDER BY bc.Date_BC, bc.Num_BC, d.ID
    `);

  return result.recordset;
}

/**
 * DRY-RUN : lit BEE ONE, construit les docs mirror en mémoire, renvoie docs +
 * rapport. AUCUN write Firestore.
 *
 * @param {{fournisseurLike?: string, start?: string, end?: string}} [opts]
 * @returns {Promise<{
 *   docs: import('./lib/bdc/mirrorSync').MirrorDoc[],
 *   report: ReturnType<typeof buildReport>,
 *   scope: {fournisseurLike: string, start: string, end: string},
 *   rawRowCount: number,
 * }>}
 */
async function dryRunMirror(opts) {
  const o = opts || {};
  const scope = {
    fournisseurLike: o.fournisseurLike || DEFAULT_FOURNISSEUR_LIKE,
    start: o.start || DEFAULT_CAMPAGNE.start,
    end: o.end || DEFAULT_CAMPAGNE.end,
  };
  const rows = await fetchBdcRows(scope);
  const docs = buildMirrorDocs(rows);
  const report = buildReport(docs);
  return { docs, report, scope, rawRowCount: rows.length };
}

/**
 * APPLY (GATED) : upsert idempotent des docs mirror dans Firestore, 1 doc par
 * Num_BC (docId = num_bc). Idempotent : un même Num_BC réécrit le même doc.
 *
 * ⚠️ NE PAS APPELER tant que le dry-run n'est pas validé par Omar.
 * Cette fonction n'est invoquée que via le flag --apply du script dry-run.
 *
 * @param {import('./lib/bdc/mirrorSync').MirrorDoc[]} docs
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {*} FieldValue - admin.firestore.FieldValue (pour serverTimestamp)
 * @returns {Promise<{written: number}>}
 */
async function applyMirror(docs, db, FieldValue) {
  const col = db.collection(MIRROR_COLLECTION);
  let written = 0;
  // Batch par 400 (limite Firestore 500/batch, marge 100).
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + CHUNK)) {
      const ref = col.doc(doc.num_bc);
      batch.set(ref, {
        ...doc,
        synced_at: FieldValue.serverTimestamp(),
      });
      written += 1;
    }
    await batch.commit();
  }
  return { written };
}

/** Ferme proprement le pool (utile en fin de script one-shot). */
async function closePool() {
  if (poolProd) {
    await poolProd.close();
    poolProd = null;
  }
}

module.exports = {
  MIRROR_COLLECTION,
  DEFAULT_CAMPAGNE,
  DEFAULT_FOURNISSEUR_LIKE,
  getPoolProd,
  fetchBdcRows,
  dryRunMirror,
  applyMirror,
  closePool,
};
