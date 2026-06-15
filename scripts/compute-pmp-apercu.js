/**
 * compute-pmp-apercu.js — APERÇU READ-ONLY de la valorisation du stock au PMP.
 *
 * Aucune écriture Firestore. Lit le grand livre Excel (bons d'entrée + inventaire
 * d'ouverture 30/06), calcule le PMP par article via functions/lib/stock/valuationPMP,
 * puis compare la valeur du stock au catalogue FILL-ONLY actuel vs au PMP.
 *
 * Lancer depuis functions/ avec ADC :
 *   GOOGLE_CLOUD_PROJECT=berrygood-farms-dashboard node ../scripts/compute-pmp-apercu.js
 *
 * Sortie : tableau lisible avant/après + suspects + articles sans PMP + totaux.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('../functions/node_modules/xlsx');
const { db } = require('../functions/config/firebase');
const { computePMP } = require('../functions/lib/stock/valuationPMP');

const XLSX_CANDIDATES = [
  '/Users/omarmaaouni/Desktop/berrygood-dashboard/docs/Inventaire Stock 300625.xlsx',
  path.resolve(__dirname, '../docs/Inventaire Stock 300625.xlsx'),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p)) || XLSX_CANDIDATES[0];

// ---- canon : identique à scripts/reconstruct-stock.js ----
function canon(a) {
  let s = (a == null ? '' : String(a)).toUpperCase().trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, '');
  return s.trim();
}
function num(x) { const n = parseFloat(x); return isNaN(n) ? 0 : n; }
function median(arr) {
  const a = arr.filter((x) => typeof x === 'number' && isFinite(x) && x > 0).sort((p, q) => p - q);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function round2(x) { return Math.round(x * 100) / 100; }

function loadSheets() {
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const out = {};
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
  }
  return out;
}

/**
 * Construit, par article canonique, les acquisitions PMP :
 *  - 1 acquisition « inventaire » (qty=qté ouverture, prix 30/06)
 *  - N acquisitions « bon_entree » (prix fournisseur)
 * anchor = prix 30/06 de l'article (sinon médiane des prix de l'article).
 * Colonnes :
 *  INVENTAIRE : [date, lieu, article(2), unite, qty(4), prix30/06(5)]
 *  BONS D ENTREE : [lieu, date, bl, fournisseur, article(4), unite, qty(6), prixFournisseur(7)]
 */
function buildAcquisitionsByArticle(sheets) {
  const inv = {};   // canon -> {qtyOuv, prix30, unite}
  const entries = {}; // canon -> [{qty, priceRaw}]

  const invRows = sheets['INVENTAIRE AU 30-06-25'] || [];
  for (let i = 1; i < invRows.length; i++) {
    const r = invRows[i]; if (!r) continue;
    const art = canon(r[2]); if (!art) continue;
    const q = num(r[4]);
    if (q <= 0) continue; // ouverture positive seulement
    const cur = inv[art] || { qtyOuv: 0, prix30: null, unite: r[3] || 'kg' };
    cur.qtyOuv += q;
    if (cur.prix30 == null && r[5] != null) cur.prix30 = r[5]; // garde le 1er prix 30/06 vu
    inv[art] = cur;
  }

  const entRows = sheets['BONS D ENTREE'] || [];
  for (let i = 1; i < entRows.length; i++) {
    const r = entRows[i]; if (!r) continue;
    const art = canon(r[4]); if (!art) continue;
    const q = num(r[6]); if (q <= 0) continue;
    (entries[art] = entries[art] || []).push({ qty: q, priceRaw: r[7] });
  }

  const arts = new Set([...Object.keys(inv), ...Object.keys(entries)]);
  const byArticle = {};
  const { parsePrice } = require('../functions/lib/stock/valuationPMP');
  for (const art of arts) {
    const invA = inv[art];
    const entA = entries[art] || [];
    // anchor : prix 30/06 si dispo et lisible, sinon médiane des prix d'entrée parsés.
    let anchor = invA && invA.prix30 != null ? parsePrice(invA.prix30) : null;
    if (!(anchor > 0)) {
      const parsedEntries = entA.map((e) => parsePrice(e.priceRaw)).filter((x) => x != null && x > 0);
      anchor = median(parsedEntries);
    }
    const acquisitions = [];
    if (invA && invA.qtyOuv > 0 && invA.prix30 != null) {
      acquisitions.push({ qty: invA.qtyOuv, pricesBySource: { inventaire: invA.prix30 }, anchor });
    }
    for (const e of entA) {
      acquisitions.push({ qty: e.qty, pricesBySource: { bon_entree: e.priceRaw }, anchor });
    }
    byArticle[art] = { acquisitions, anchor, unite: invA ? invA.unite : 'kg' };
  }
  return byArticle;
}

async function readAll(coll) {
  const snap = await db.collection(coll).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function main() {
  const sheets = loadSheets();
  const acqByArticle = buildAcquisitionsByArticle(sheets);

  // PMP par article
  const pmpByArticle = {}; // canon -> {pmp, source, suspects, ...}
  const suspectsGlobal = [];
  for (const [art, data] of Object.entries(acqByArticle)) {
    const out = computePMP(data.acquisitions);
    // source retenue dominante (par nombre d'acquisitions) pour affichage
    let dominantSource = null, max = -1;
    for (const [s, n] of Object.entries(out.sourceBreakdown)) { if (n > max) { max = n; dominantSource = s; } }
    pmpByArticle[art] = { pmp: out.pmp, source: dominantSource, breakdown: out.sourceBreakdown, ignored: out.ignored, anchor: data.anchor };
    for (const sp of out.suspects) suspectsGlobal.push(Object.assign({ article: art }, sp));
  }

  // Soldes positifs (magasin + station)
  const balances = await readAll('stock_balances');
  const stockByArticle = {}; // canon -> {qty, unite}
  for (const b of balances) {
    if (!(b.lieu_type === 'magasin' || b.lieu_type === 'station')) continue;
    const q = num(b.balance); if (q <= 0) continue;
    const art = canon(b.article_ref || b.article_nom);
    const cur = stockByArticle[art] || { qty: 0, unite: b.unite || 'kg' };
    cur.qty += q;
    stockByArticle[art] = cur;
  }

  // Catalogue FILL-ONLY (prix actuel). Les soldes (stock_balances.article_ref) sont
  // canonicalisés sur le NOM d'article (reconstruct-stock.js), pas la référence SKU.
  // On indexe donc le catalogue par canon(nom). En cas de doublons de nom, on garde
  // le 1er prix_ttc > 0 rencontré.
  const catalog = await readAll('articles_catalog');
  const catByArticle = {}; // canon(nom) -> prix_ttc
  for (const c of catalog) {
    const art = canon(c.nom);
    if (!art) continue;
    const p = num(c.prix_ttc);
    if (catByArticle[art] == null || (catByArticle[art] === 0 && p > 0)) catByArticle[art] = p;
  }

  // Aperçu avant/après par article
  const rows = [];
  let totalCatalogue = 0, totalPMP = 0;
  const noPMP = [];
  for (const [art, st] of Object.entries(stockByArticle)) {
    const prixCat = catByArticle[art] != null ? catByArticle[art] : 0;
    const pmpInfo = pmpByArticle[art];
    const pmp = pmpInfo && pmpInfo.pmp != null ? pmpInfo.pmp : null;
    const valCat = st.qty * prixCat;
    totalCatalogue += valCat;
    if (pmp == null) {
      // fallback catalogue
      totalPMP += valCat;
      noPMP.push({ article: art, qty: round2(st.qty), unite: st.unite, prix_cat: round2(prixCat), val_cat: round2(valCat) });
      continue;
    }
    const valPMP = st.qty * pmp;
    totalPMP += valPMP;
    const ecartVal = valPMP - valCat;
    const ecartPct = prixCat > 0 ? ((pmp - prixCat) / prixCat) * 100 : null;
    rows.push({
      article: art,
      qty: round2(st.qty),
      unite: st.unite,
      prix_cat: round2(prixCat),
      pmp: round2(pmp),
      ecart_pct: ecartPct == null ? null : round2(ecartPct),
      val_cat: round2(valCat),
      val_pmp: round2(valPMP),
      ecart_val: round2(ecartVal),
      source: pmpInfo.source,
    });
  }

  // Tri par |écart valeur| décroissant, top 25
  rows.sort((a, b) => Math.abs(b.ecart_val) - Math.abs(a.ecart_val));
  const top = rows.slice(0, 25);

  // ----- SORTIE -----
  console.log('\n================= APERÇU VALORISATION STOCK — CATALOGUE vs PMP (READ-ONLY) =================\n');
  console.log(`Excel source : ${XLSX_PATH}`);
  console.log(`Articles en stock (solde+ magasin/station) : ${Object.keys(stockByArticle).length}`);
  console.log(`Articles avec PMP calculé : ${rows.length} | sans PMP (fallback catalogue) : ${noPMP.length}\n`);

  console.log('--- TOP 25 par |écart de valeur| (PMP vs catalogue) ---');
  const H = ['ARTICLE', 'QTÉ', 'U', 'PRIX_CAT', 'PMP', 'ÉCART%', 'VAL_CAT', 'VAL_PMP', 'ÉCART_VAL', 'SOURCE'];
  const W = [34, 10, 3, 10, 10, 8, 12, 12, 12, 11];
  const fmt = (cells) => cells.map((c, i) => String(c == null ? '-' : c).padEnd(W[i])).join(' ');
  console.log(fmt(H));
  for (const r of top) {
    console.log(fmt([r.article, r.qty, r.unite, r.prix_cat, r.pmp, r.ecart_pct, r.val_cat, r.val_pmp, r.ecart_val, r.source]));
  }

  console.log('\n--- SUSPECTS de normalisation (ratio 10–100×, NI gardé NI ÷1000, à trancher) ---');
  if (!suspectsGlobal.length) console.log('(aucun)');
  else {
    suspectsGlobal.sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
    for (const s of suspectsGlobal.slice(0, 40)) {
      console.log(`  ${String(s.article).padEnd(34)} prix_brut=${String(s.raw).padEnd(12)} retenu=${round2(s.value)} ratio≈${s.ratio ? round2(s.ratio) : '?'} (qty=${s.qty})`);
    }
    if (suspectsGlobal.length > 40) console.log(`  ... +${suspectsGlobal.length - 40} autres`);
  }

  console.log('\n--- ARTICLES SANS PMP CALCULABLE (fallback catalogue) ---');
  if (!noPMP.length) console.log('(aucun)');
  else {
    noPMP.sort((a, b) => b.val_cat - a.val_cat);
    for (const a of noPMP) {
      console.log(`  ${String(a.article).padEnd(34)} qty=${a.qty} ${a.unite} prix_cat=${a.prix_cat} val_cat=${a.val_cat}`);
    }
  }

  console.log('\n--- TOTAUX ---');
  console.log(`  Valeur stock CATALOGUE (FILL-ONLY actuel) : ${round2(totalCatalogue).toLocaleString('fr-FR')} DH`);
  console.log(`  Valeur stock PMP (acquisition normalisée) : ${round2(totalPMP).toLocaleString('fr-FR')} DH`);
  console.log(`  DELTA (PMP - catalogue)                   : ${round2(totalPMP - totalCatalogue).toLocaleString('fr-FR')} DH`);
  console.log(`  Suspects à trancher : ${suspectsGlobal.length} | Articles sans PMP : ${noPMP.length}\n`);
}

module.exports = { buildAcquisitionsByArticle, loadSheets, canon, round2, num, median };

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e && e.stack || e); process.exit(1); });
}
