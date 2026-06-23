#!/usr/bin/env node
'use strict';

/**
 * gen-exemple-export-factures-v3.js — Génère docs/EXEMPLE-Export-Factures-TIMAC-25-26-v3.xlsx
 * à partir des factures TIMAC réelles (collection `invoices`), campagne juil 2025
 * → juin 2026.
 *
 * v3 — CASCADE TVA : taux SAISI par ligne prioritaire, mot-clé en secours.
 * Distingue les anomalies A (TVA estimée non réconciliée, notre règle) et B
 * (incohérence saisie, donnée source).
 *
 * LECTURE SEULE Firestore (aucune écriture). Réutilise EXACTEMENT la logique de
 * public/lib/factureExportUtils.js (cascade, garde-fou, réconciliation),
 * et reproduit le formatage (cellules numériques/date + autofilter) de
 * buildFacturesWorkbook côté app.
 *
 * Pré-requis : ADC Firebase (gcloud auth application-default login).
 * Si l'ADC est expirée (invalid_rapt) → le script échoue avec un message clair.
 *
 * Usage : node scripts/gen-exemple-export-factures-v3.js
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

const OUT = path.join(ROOT, 'docs', 'EXEMPLE-Export-Factures-TIMAC-25-26-v3.xlsx');
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

  // Fournisseur TIMAC (tolérant à la casse / variantes) + campagne.
  const isTimac = (f) => {
    const nom = ((f.fournisseur && f.fournisseur.nom) || '').toUpperCase();
    return nom.indexOf('TIMAC') !== -1;
  };
  const scoped = all
    .filter(isTimac)
    .filter((f) => FE.isWithinPeriod(f.date_facture, start, end))
    .sort((a, b) => String(a.date_facture).localeCompare(String(b.date_facture)));

  console.log(`[gen] invoices totales: ${all.length} | TIMAC campagne 25-26: ${scoped.length}`);

  // --- Onglet Récap ---
  const recapHeader = ['N° Interne', 'N° Facture', 'BDC', 'Fournisseur', 'Date', 'Total HT', 'TVA', 'Total TTC', 'Écarts', 'Anomalie TVA', 'Statut paiement'];
  const recap = [recapHeader.map(txt)];
  let sHt = 0, sTva = 0, sTtc = 0, nbAnomalies = 0, nbMulti = 0;
  let nbA = 0, nbB = 0, nbFactSaisi = 0, nbLignesSaisi = 0, nbLignesMotcle = 0, nbFactAvecSaisi = 0;
  const anomalies = [];
  const multis = [];
  scoped.forEach((f) => {
    const ht = Number(f.total_ht) || 0, tva = Number(f.total_tva) || 0, ttc = Number(f.total_ttc) || 0;
    sHt += ht; sTva += tva; sTtc += ttc;
    const ecarts = f.has_discrepancies ? ((f.discrepancies || []).length + ' écart(s)') : 'OK';
    const r = FE.buildFactureLines(f);
    if (!r.reconciled) {
      nbAnomalies++;
      if (r.anomalieType === 'A') nbA++; else if (r.anomalieType === 'B') nbB++;
      anomalies.push({ num: f.numero_facture || f.numero, type: r.anomalieType, ecart: r.ecartTva, tvaBase: r.tvaBase, tvaClassee: r.tvaClassee });
    }
    if (r.isMultiTaux) { nbMulti++; multis.push(f.numero_facture || f.numero); }
    if (r.allSaisi) nbFactSaisi++;
    const nSaisi = r.lines.filter((l) => l.taux_source === 'saisi').length;
    nbLignesSaisi += nSaisi;
    nbLignesMotcle += r.lines.length - nSaisi;
    if (nSaisi > 0) nbFactAvecSaisi++;
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
  recap.push([]);
  recap.push([txt('Récapitulatif par statut'), txt(''), txt('Nombre'), txt('Total TTC')]);
  ['non_payee', 'en_validation', 'validee_achats', 'validee_finance', 'validee_dg', 'payee'].forEach((st) => {
    const sub = scoped.filter((f) => f.payment_status === st);
    if (sub.length) recap.push([txt(statusLabels[st]), txt(''), cnt(sub.length), num(sub.reduce((s, f) => s + (Number(f.total_ttc) || 0), 0))]);
  });
  recap.push([txt('Total général'), txt(''), cnt(scoped.length), num(sTtc)]);
  const recapCols = [{ wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
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
        num(ln.taux_tva, PCT_FMT),
        txt(ln.taux_source === 'saisi' ? 'Saisi' : 'Mot-clé'),
        num(ln.montant_tva),
        num(ln.montant_ttc),
        txt(ln.reconciled ? 'OK' : anomalieLabel),
      ]);
    });
  });
  const detailCols = [{ wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 14 }, { wch: 40 }];
  const detailFilterRef = 'A1:' + XLSX.utils.encode_cell({ r: detail.length - 1, c: detailHeader.length - 1 });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(recap, recapCols, recapFilterRef), 'Récap Factures');
  XLSX.utils.book_append_sheet(wb, buildSheet(detail, detailCols, detailFilterRef), 'Détail Articles');
  XLSX.writeFile(wb, OUT);

  const r2 = (n) => Math.round(n * 100) / 100;
  console.log('\n========== RAPPORT v3 (cascade) ==========');
  console.log(`Factures TIMAC 25-26       : ${scoped.length}`);
  console.log(`Lignes : saisies=${nbLignesSaisi} | mot-clé=${nbLignesMotcle} (total ${nbLignesSaisi + nbLignesMotcle})`);
  console.log(`Factures avec ≥1 ligne saisie : ${nbFactAvecSaisi} | factures 100% saisi : ${nbFactSaisi}`);
  console.log(`Multi-taux (0% + 20%)      : ${nbMulti}` + (multis.length ? ` → ${multis.join(', ')}` : ''));
  console.log(`Réconciliées               : ${scoped.length - nbAnomalies} / ${scoped.length}`);
  console.log(`Flaggées (anomalie TVA)    : ${nbAnomalies}  (A=${nbA} estimée non réconciliée | B=${nbB} incohérence saisie)`);
  anomalies.forEach((a) => console.log(`   - [${a.type}] ${a.num}: TVA base=${r2(a.tvaBase)} classée=${r2(a.tvaClassee)} écart=${r2(a.ecart)}`));
  console.log(`Σ HT  : ${r2(sHt)}`);
  console.log(`Σ TVA : ${r2(sTva)}`);
  console.log(`Σ TTC : ${r2(sTtc)}`);
  console.log(`Réconciliation TVA = (TTC − HT) ? ${r2(sTtc - sHt) === r2(sTva) ? 'OUI' : 'NON (Σ TVA=' + r2(sTva) + ' vs TTC−HT=' + r2(sTtc - sHt) + ')'}`);
  console.log(`Fichier : ${OUT}`);
  console.log('==========================================');
  process.exit(0);
})().catch((e) => { console.error('[gen] erreur:', e); process.exit(1); });
