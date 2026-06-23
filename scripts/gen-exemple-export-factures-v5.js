#!/usr/bin/env node
'use strict';

/**
 * gen-exemple-export-factures-v5.js — Génère un export Excel exemple à partir des
 * factures réelles (collection `invoices`), campagne juil 2025 → juin 2026.
 *
 * v5 — REVIREMENT de design (validé DG). Le taux de TVA par ligne ne vient PLUS
 * QUE du taux_tva SAISI en base. La devinette par mot-clé est ABANDONNÉE
 * (taxabilité par FACTURE, pas par produit). Trois états :
 *   - réconcilié (toutes lignes saisies, Σ colle) ;
 *   - "Incohérence saisie" (toutes lignes saisies mais Σ ≠ (TTC−HT)) — vraie
 *     anomalie comptable (cas B) ;
 *   - "TVA par ligne non saisie" (≥ 1 ligne sans taux saisi) — INFORMATIF, le
 *     total facture reste exact. Lignes non saisies : taux/TVA = "—".
 *
 * LECTURE SEULE Firestore (aucune écriture). Réutilise EXACTEMENT la logique de
 * public/lib/factureExportUtils.js, et reproduit le formatage (cellules
 * numériques/date + autofilter) de buildFacturesWorkbook côté app.
 *
 * Pré-requis : ADC Firebase (gcloud auth application-default login).
 * Si l'ADC est expirée (invalid_rapt) → le script échoue avec un message clair.
 *
 * Usage :
 *   node scripts/gen-exemple-export-factures-v5.js
 *     → docs/EXEMPLE-Export-Factures-TIMAC-25-26-v5.xlsx (TIMAC)
 *   node scripts/gen-exemple-export-factures-v5.js --fournisseur "NOM" [--out fichier.xlsx]
 *     → exemple sur un autre fournisseur (preuve de réconciliation par taux saisi)
 *   node scripts/gen-exemple-export-factures-v5.js --list-fournisseurs
 *     → liste les fournisseurs de la campagne avec leur nb de factures
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS_DIR = path.join(ROOT, 'functions');
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'berrygood-farms-dashboard';

const admin = require(path.join(FUNCTIONS_DIR, 'node_modules', 'firebase-admin'));
const XLSX = require(path.join(FUNCTIONS_DIR, 'node_modules', 'xlsx'));
const FE = require(path.join(ROOT, 'public', 'lib', 'factureExportUtils.js'));

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'berrygood-farms-dashboard',
    credential: admin.credential.applicationDefault(),
  });
}

// --- CLI ---
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
};
const LIST_ONLY = argv.includes('--list-fournisseurs');
// --all : ignore le filtre campagne ET le filtre fournisseur → export "Toutes"
// (reproduit la vue "Toutes" de l'écran Factures). Sert à prouver la ligne TOTAL.
const ALL_MODE = argv.includes('--all');
const FOURNISSEUR_FILTER = getArg('--fournisseur'); // null → TIMAC par défaut
const FOURNISSEUR_NEEDLE = (FOURNISSEUR_FILTER || 'TIMAC').toUpperCase();
const IS_TIMAC = !FOURNISSEUR_FILTER;
const OUT = path.join(
  ROOT, 'docs',
  getArg('--out') || (ALL_MODE
    ? 'EXEMPLE-Export-Factures-TOUTES-v5fix.xlsx'
    : IS_TIMAC
      ? 'EXEMPLE-Export-Factures-TIMAC-25-26-v5.xlsx'
      : 'EXEMPLE-Export-Factures-NON-TIMAC-v5.xlsx')
);
const CAMPAIGN_START_YEAR = 2025;

const NUM_FMT = '# ##0.00';
const PCT_FMT = '0%';
const DATE_FMT = 'dd/mm/yyyy';
const statusLabels = {
  non_payee: 'Non payée', en_validation: 'En validation', validee_achats: 'Validée Achats',
  validee_finance: 'Validée Finance', validee_dg: 'Validée DG', payee: 'Payée',
};

const txt = (v) => ({ t: 's', v: v == null ? '' : String(v) });
const num = (v, z) => ({ t: 'n', v: Number(v) || 0, z: z || NUM_FMT });
const cnt = (v) => ({ t: 'n', v: Number(v) || 0 });
const dateCell = (dStr) => {
  const d = FE.parseFactureDate(dStr);
  if (!d) return txt(dStr || '');
  return { t: 'd', v: d, z: DATE_FMT };
};

function buildSheet(matrix, cols, autofilterRange) {
  const aoa = matrix.map((row) => row.map((c) => (c && typeof c === 'object' && 't' in c ? c.v : (c == null ? '' : c))));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  matrix.forEach((row, r) => row.forEach((c, k) => {
    if (c && typeof c === 'object' && 't' in c) {
      const ref = XLSX.utils.encode_cell({ r, c: k });
      if (!ws[ref]) ws[ref] = {};
      ws[ref].t = c.t;
      ws[ref].v = c.v;
      if (c.z) ws[ref].z = c.z;
    }
  }));
  if (cols) ws['!cols'] = cols;
  if (autofilterRange) ws['!autofilter'] = { ref: autofilterRange };
  return ws;
}

(async () => {
  const db = admin.firestore();
  let snap;
  try {
    snap = await db.collection('invoices').get();
  } catch (e) {
    if (/invalid_rapt|invalid_grant|reauth|credential/i.test(String(e))) {
      console.error('\n[gen] ADC EXPIRÉE — relance: gcloud auth application-default login');
      console.error('[gen] détail:', String(e.message || e));
      process.exit(2);
    }
    throw e;
  }

  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const { start, end } = FE.campaignBounds(CAMPAIGN_START_YEAR);
  // En mode --all : aucune restriction de période (vue "Toutes").
  const inCampaign = ALL_MODE
    ? all
    : all.filter((f) => FE.isWithinPeriod(f.date_facture, start, end));

  if (LIST_ONLY) {
    const byFour = {};
    inCampaign.forEach((f) => {
      const nom = (f.fournisseur && f.fournisseur.nom) || '(sans fournisseur)';
      byFour[nom] = (byFour[nom] || 0) + 1;
    });
    console.log('[gen] Fournisseurs campagne 25-26 (nb factures) :');
    Object.entries(byFour).sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`   ${c}\t${n}`));
    process.exit(0);
  }

  const matchFournisseur = (f) => {
    const nom = ((f.fournisseur && f.fournisseur.nom) || '').toUpperCase();
    return nom.indexOf(FOURNISSEUR_NEEDLE) !== -1;
  };
  // En mode --all : pas de filtre fournisseur non plus.
  const scoped = (ALL_MODE ? inCampaign : inCampaign.filter(matchFournisseur))
    .sort((a, b) => String(a.date_facture).localeCompare(String(b.date_facture)));

  const scopeLabel = ALL_MODE ? 'TOUTES (sans filtre)' : `"${FOURNISSEUR_NEEDLE}" campagne 25-26`;
  console.log(`[gen] invoices totales: ${all.length} | ${scopeLabel}: ${scoped.length}`);
  if (scoped.length === 0) {
    console.error(`[gen] aucune facture pour ${scopeLabel} — rien à générer.`);
    process.exit(3);
  }

  // --- Onglet Récap ---
  const recapHeader = ['N° Interne', 'N° Facture', 'BDC', 'Fournisseur', 'Date', 'Total HT', 'TVA', 'Total TTC', 'Écarts', 'Anomalie TVA', 'Statut paiement'];
  const recap = [recapHeader.map(txt)];
  let sHt = 0, sTva = 0, sTtc = 0;
  let nbReconcilie = 0, nbInfoNonSaisie = 0, nbIncoherence = 0, nbMulti = 0;
  let nbLignesSaisi = 0, nbLignesNonDet = 0, nbFactToutSaisi = 0;
  const incoherences = [];
  const infos = [];
  const multis = [];
  scoped.forEach((f) => {
    const ht = Number(f.total_ht) || 0, tva = Number(f.total_tva) || 0, ttc = Number(f.total_ttc) || 0;
    sHt += ht; sTva += tva; sTtc += ttc;
    const ecarts = f.has_discrepancies ? ((f.discrepancies || []).length + ' écart(s)') : 'OK';
    const r = FE.buildFactureLines(f);
    const numFac = f.numero_facture || f.numero;
    if (r.anomalieType === 'B') { nbIncoherence++; incoherences.push({ num: numFac, ecart: r.ecartTva, tvaBase: r.tvaBase, tvaClassee: r.tvaClassee }); }
    else if (r.anomalieType === 'info') { nbInfoNonSaisie++; infos.push(numFac); }
    else { nbReconcilie++; }
    if (r.isMultiTaux) { nbMulti++; multis.push(numFac); }
    if (r.allSaisi) nbFactToutSaisi++;
    const nSaisi = r.lines.filter((l) => l.taux_source === 'saisi').length;
    nbLignesSaisi += nSaisi;
    nbLignesNonDet += r.lines.length - nSaisi;
    recap.push([
      txt(f.numero || ''), txt(f.numero_facture || ''), txt(f.bdc_numero || ''),
      txt((f.fournisseur && f.fournisseur.nom) || ''), dateCell(f.date_facture),
      num(ht), num(tva), num(ttc), txt(ecarts),
      txt(r.reconciled ? '' : r.anomalieLabel),
      txt(statusLabels[f.payment_status] || f.payment_status || ''),
    ]);
  });
  recap.push([txt('TOTAL'), txt(''), txt(''), txt(''), txt(''), num(sHt), num(sTva), num(sTtc), txt(''), txt(''), txt('')]);
  const lastDataRow = recap.length;
  // Récap par statut — helper PUR partagé (alignement Nombre/Total TTC, 11 cols).
  const toCell = (d) => (d.kind === 'num' ? num(d.v) : d.kind === 'cnt' ? cnt(d.v) : txt(d.v));
  recap.push([]);
  FE.buildRecapStatutRows(scoped, statusLabels).forEach((r) => recap.push(r.map(toCell)));
  const recapCols = [{ wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 16 }];
  const recapFilterRef = 'A1:' + XLSX.utils.encode_cell({ r: lastDataRow - 1, c: recapHeader.length - 1 });

  // --- Onglet Détail ---
  const detailHeader = ['N° Facture', 'Fournisseur', 'Date', 'Désignation', 'Quantité', 'PU HT', 'Montant HT', 'Taux TVA', 'Source taux', 'Montant TVA', 'Montant TTC', 'Réconciliation'];
  const detail = [detailHeader.map(txt)];
  scoped.forEach((f) => {
    const { lines, anomalieLabel } = FE.buildFactureLines(f);
    lines.forEach((ln) => {
      detail.push([
        txt(f.numero_facture || f.numero || ''),
        txt((f.fournisseur && f.fournisseur.nom) || ''),
        dateCell(f.date_facture),
        txt(ln.designation),
        ln.quantite ? cnt(ln.quantite) : txt(''),
        ln.prix_unitaire ? num(ln.prix_unitaire) : txt(''),
        num(ln.montant_ht),
        ln.taux_tva == null ? txt('—') : num(ln.taux_tva, PCT_FMT),
        txt(ln.taux_source === 'saisi' ? 'Saisi' : 'Non déterminé'),
        ln.montant_tva == null ? txt('—') : num(ln.montant_tva),
        ln.montant_ttc == null ? txt('—') : num(ln.montant_ttc),
        txt(ln.reconciled ? 'OK' : anomalieLabel),
      ]);
    });
  });
  const detailCols = [{ wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 13 }, { wch: 12 }, { wch: 14 }, { wch: 40 }];
  const detailFilterRef = 'A1:' + XLSX.utils.encode_cell({ r: detail.length - 1, c: detailHeader.length - 1 });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(recap, recapCols, recapFilterRef), 'Récap Factures');
  XLSX.utils.book_append_sheet(wb, buildSheet(detail, detailCols, detailFilterRef), 'Détail Articles');
  XLSX.writeFile(wb, OUT);

  const r2 = (n) => Math.round(n * 100) / 100;
  console.log('\n========== RAPPORT v5 (taux SAISI uniquement) ==========');
  console.log(`Fournisseur                : "${FOURNISSEUR_NEEDLE}"`);
  console.log(`Factures campagne 25-26    : ${scoped.length}`);
  console.log(`Lignes : saisies=${nbLignesSaisi} | non déterminées=${nbLignesNonDet} (total ${nbLignesSaisi + nbLignesNonDet})`);
  console.log(`Factures 100% saisies      : ${nbFactToutSaisi}`);
  console.log(`Multi-taux (≥2 taux saisis): ${nbMulti}` + (multis.length ? ` → ${multis.join(', ')}` : ''));
  console.log('--- ÉTATS ---');
  console.log(`Réconciliées               : ${nbReconcilie}`);
  console.log(`"TVA par ligne non saisie" : ${nbInfoNonSaisie} (INFORMATIF, total facture exact)`);
  console.log(`"Incohérence saisie" (B)   : ${nbIncoherence} (VRAIE anomalie comptable)`);
  if (incoherences.length) incoherences.forEach((a) => console.log(`   - [B] ${a.num}: TVA base=${r2(a.tvaBase)} saisie=${r2(a.tvaClassee)} écart=${r2(a.ecart)}`));
  console.log('--- TOTAUX ---');
  console.log(`Σ HT  : ${r2(sHt)}`);
  console.log(`Σ TVA : ${r2(sTva)}`);
  console.log(`Σ TTC : ${r2(sTtc)}`);
  console.log(`Réconciliation TVA = (TTC − HT) ? ${r2(sTtc - sHt) === r2(sTva) ? 'OUI' : 'NON (Σ TVA=' + r2(sTva) + ' vs TTC−HT=' + r2(sTtc - sHt) + ')'}`);
  console.log(`Fichier : ${OUT}`);
  console.log('========================================================');
  process.exit(0);
})().catch((e) => { console.error('[gen] erreur:', e); process.exit(1); });
