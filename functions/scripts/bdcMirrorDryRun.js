'use strict';

/**
 * bdcMirrorDryRun.js — Étape 1 du cycle Achats : MIRROR BDC (BEE ONE → Firestore).
 *
 * DRY-RUN PAR DÉFAUT : lit BEE ONE (LECTURE SEULE), construit les docs mirror en
 * mémoire, imprime un rapport et écrit un récap dans /tmp (JSON + XLSX). AUCUN
 * write Firestore.
 *
 * --apply (GATED) : effectue l'upsert idempotent dans Firestore `bdc_mirror`
 * (1 doc par Num_BC) via ADC applicationDefault. NE PAS lancer tant qu'Omar n'a
 * pas validé le dry-run.
 *
 * Lancer le DRY-RUN :
 *   cd functions && node scripts/bdcMirrorDryRun.js
 *
 * Élargir le périmètre (optionnel) :
 *   node scripts/bdcMirrorDryRun.js --fournisseur "%TIMAC%" --start 2025-07-01 --end 2026-06-30
 *
 * Lancer l'APPLY (UNIQUEMENT après validation Omar) :
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/bdcMirrorDryRun.js --apply
 *
 * Les credentials SQL viennent de functions/.env (SQL_*_PROD). Le script charge
 * dotenv depuis functions/.env (jamais loggé en clair).
 */

const path = require('path');
const fs = require('fs');

// Checkout principal (où vivent .env et les node_modules complets, partagés via
// worktree). functions/.env porte les credentials SQL_*_PROD ; dotenv et xlsx
// sont résolus depuis le node_modules racine du repo (pas functions/).
const REPO_ROOT = '/Users/omarmaaouni/Desktop/DESKTOP (OLD)/berrygood-dashboard';
const FUNCTIONS_ROOT = path.join(REPO_ROOT, 'functions');
require(path.join(REPO_ROOT, 'node_modules', 'dotenv')).config({
  path: path.join(FUNCTIONS_ROOT, '.env'),
});

const XLSX = require(path.join(REPO_ROOT, 'node_modules', 'xlsx'));

const svc = require('../bdcMirrorService');

// ---- Args ---------------------------------------------------------------
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
function argVal(name, def) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}
const fournisseurLike = argVal('--fournisseur', svc.DEFAULT_FOURNISSEUR_LIKE);
const start = argVal('--start', svc.DEFAULT_CAMPAGNE.start);
const end = argVal('--end', svc.DEFAULT_CAMPAGNE.end);

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const TMP_JSON = `/tmp/bdc-mirror-dryrun-${STAMP}.json`;
const TMP_XLSX = `/tmp/bdc-mirror-dryrun-${STAMP}.xlsx`;

function writeRecap(result) {
  // JSON complet (docs + rapport).
  fs.writeFileSync(TMP_JSON, JSON.stringify(result, null, 2), 'utf8');

  // XLSX : feuille « BDC » (1 ligne/BDC) + feuille « Lignes » (1 ligne/ligne).
  const bdcSheet = result.docs.map((d) => ({
    num_bc: d.num_bc,
    fournisseur: d.fournisseur.nom,
    id_fournisseur: d.fournisseur.id_source,
    date_bc: d.date_bc,
    nb_lignes: d.lignes.length,
    total_ht: d.total_ht,
    total_tva: d.total_tva,
    total_ttc: d.total_ttc,
    statut: d.statut,
  }));
  const lignesSheet = [];
  for (const d of result.docs) {
    for (const l of d.lignes) {
      lignesSheet.push({
        num_bc: d.num_bc,
        code_article: l.code_article,
        id_produit: l.id_produit,
        designation: l.designation,
        qte_commandee: l.qte_commandee,
        prix_u_ht: l.prix_u_ht,
        montant_net_ht: l.montant_net_ht,
        tva: l.tva,
        montant_net_ttc: l.montant_net_ttc,
        reliquat: l.reliquat,
        placeholder_prix: l.placeholder_prix,
      });
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bdcSheet), 'BDC');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignesSheet), 'Lignes');
  XLSX.writeFile(wb, TMP_XLSX);
}

function printReport(result) {
  const { report, scope, rawRowCount } = result;
  console.log('\n========== DRY-RUN MIRROR BDC (BEE ONE → bdc_mirror) ==========');
  console.log(`Périmètre : fournisseur LIKE ${scope.fournisseurLike} | campagne ${scope.start} → ${scope.end}`);
  console.log(`Lignes SQL brutes lues       : ${rawRowCount}`);
  console.log(`BDC reflétés (docs mirror)   : ${report.nbBdc}`);
  console.log(`Lignes totales               : ${report.nbLignes}`);
  console.log(`  · avec prix > 0 (réel)     : ${report.nbLignesPrixPositif}`);
  console.log(`  · placeholder (prix == 1)  : ${report.nbLignesPlaceholder}`);
  console.log(`Plage de dates BDC           : ${report.dateMin} → ${report.dateMax}`);

  console.log('\n--- Échantillon (jusqu\'à 5 BDC) ---');
  for (const d of result.docs.slice(0, 5)) {
    console.log(`\n  ${d.num_bc} | ${d.fournisseur.nom} | ${d.date_bc} | ${d.lignes.length} ligne(s) | HT=${d.total_ht} TTC=${d.total_ttc} | statut=${d.statut}`);
    for (const l of d.lignes.slice(0, 3)) {
      const ph = l.placeholder_prix ? ' [PLACEHOLDER prix==1]' : '';
      console.log(`      - ${l.code_article} | ${l.designation} | qte=${l.qte_commandee} | PU_HT=${l.prix_u_ht}${ph}`);
    }
  }

  console.log('\n--- Num_BC reflétés ---');
  console.log('  ' + report.numBcs.join(', '));
}

(async () => {
  try {
    console.log('[bdcMirror] Lecture BEE ONE (read-only)…');
    const result = await svc.dryRunMirror({ fournisseurLike, start, end });

    printReport(result);
    writeRecap(result);
    console.log(`\n[bdcMirror] Récap écrit :\n  JSON : ${TMP_JSON}\n  XLSX : ${TMP_XLSX}`);

    if (APPLY) {
      console.log('\n[bdcMirror] --apply détecté → WRITE Firestore (GATED)…');
      const admin = require(path.join(FUNCTIONS_ROOT, 'node_modules', 'firebase-admin'));
      if (!admin.apps.length) {
        admin.initializeApp({
          projectId: 'berrygood-farms-dashboard',
          credential: admin.credential.applicationDefault(),
        });
      }
      const db = admin.firestore();
      const { written } = await svc.applyMirror(result.docs, db, admin.firestore.FieldValue);
      console.log(`[bdcMirror] APPLY terminé : ${written} doc(s) upsert dans bdc_mirror.`);
    } else {
      console.log('\n[DRY-RUN] Aucune écriture Firestore. Passe --apply (après validation Omar) pour écrire.');
    }

    await svc.closePool();
    process.exit(0);
  } catch (err) {
    console.error('\n[bdcMirror] ERREUR :', err.message);
    console.error('Requête SQL one-shot prévue (read-only) : voir fetchBdcRows() dans functions/bdcMirrorService.js');
    try { await svc.closePool(); } catch (_) { /* noop */ }
    process.exit(1);
  }
})();
