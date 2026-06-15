/**
 * fix-prix-catalogue.js — Import des prix manquants dans articles_catalog (FILL-ONLY).
 * GATED. Source: docs/Inventaire Stock 300625.xlsx (colonne PRIX TTC AU 30-06-25).
 *
 * Politique (décision Omar):
 *  - Remplir UNIQUEMENT les articles en stock sans prix catalogue, avec le prix 30/06.
 *  - NE PAS écraser un prix catalogue existant (potentiellement plus récent).
 *  - Exception: SULFATE DE MAGNESIE catalogue=2 = erreur -> corriger au PMP d'acquisition.
 *  - 13 articles sans prix nulle part -> restent 0 (non gérés ici).
 *  - Backup articles_catalog AVANT écriture. Aperçu chiffré après.
 *
 * Sous-commandes (depuis functions/, ADC requis):
 *   node ../scripts/fix-prix-catalogue.js analyze   (read-only)
 *   node ../scripts/fix-prix-catalogue.js backup
 *   node ../scripts/fix-prix-catalogue.js apply
 *   node ../scripts/fix-prix-catalogue.js report
 */
'use strict';
const { db, bucket } = require('../functions/config/firebase');
const XLSX = require('../functions/node_modules/xlsx');
const fs = require('fs');
const XLSX_PATH = ['/Users/omarmaaouni/Desktop/berrygood-dashboard/docs/Inventaire Stock 300625.xlsx']
  .find((p) => fs.existsSync(p));
const NOW = new Date();
const STAMP = NOW.toISOString().replace(/[:.]/g, '-');

function canon(a) { let s = (a == null ? '' : String(a)).toUpperCase().trim(); s = s.replace(/\s+/g, ' '); s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, ''); return s.trim(); }
function px(v) { if (v == null || v === '') return null; if (typeof v === 'number') return v; let s = String(v).trim(); if (/perimi/i.test(s)) return 0; let t = s.replace(/dh/ig, '').replace(/\s/g, ''); if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ''); else if (t.indexOf(',') >= 0 && t.indexOf('.') < 0) t = t.replace(',', '.'); else t = t.replace(/,/g, ''); const n = parseFloat(t); return isNaN(n) ? null : n; }
function r2(x) { return Math.round(x * 100) / 100; }

function loadFile() {
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const inv = XLSX.utils.sheet_to_json(wb.Sheets['INVENTAIRE AU 30-06-25'], { header: 1, defval: null });
  const ent = XLSX.utils.sheet_to_json(wb.Sheets['BONS D ENTREE'], { header: 1, defval: null });
  const filePrix = {}, openQ = {}, fileUnite = {};
  for (let i = 1; i < inv.length; i++) { const r = inv[i]; if (!r || r[2] == null) continue; const c = canon(r[2]); const p = px(r[5]); if (p != null && !(c in filePrix)) filePrix[c] = p; if (!fileUnite[c] && r[3]) fileUnite[c] = String(r[3]); const q = parseFloat(r[4]) || 0; if (q > 0) openQ[c] = (openQ[c] || 0) + q; }
  // PMP d'acquisition (ouverture@prix30/06 + bons d'entrée@prix fournisseur)
  const accVal = {}, accQty = {};
  for (const c in openQ) if (filePrix[c] != null) { accVal[c] = (accVal[c] || 0) + openQ[c] * filePrix[c]; accQty[c] = (accQty[c] || 0) + openQ[c]; }
  for (let i = 1; i < ent.length; i++) { const r = ent[i]; if (!r || r[4] == null) continue; const c = canon(r[4]); const q = parseFloat(r[6]) || 0; const p = px(r[7]); if (!fileUnite[c] && r[5]) fileUnite[c] = String(r[5]); if (q > 0 && p != null) { accVal[c] = (accVal[c] || 0) + q * p; accQty[c] = (accQty[c] || 0) + q; } }
  const pmp = {}; for (const c in accQty) if (accQty[c] > 0) pmp[c] = accVal[c] / accQty[c];
  return { filePrix, fileUnite, pmp };
}

async function catalogue() {
  const snap = await db.collection('articles_catalog').get();
  const byCanon = {};
  snap.forEach((d) => { const a = d.data(); if (!a.nom) return; const c = canon(a.nom); const prix = parseFloat(a.prix_ttc) || parseFloat(a.prix_ht) || parseFloat(a.prix_ref) || 0; if (!byCanon[c] || prix > 0) byCanon[c] = { id: d.id, prix, nom: a.nom, unite: a.unite }; });
  return { snap, byCanon };
}

async function stockArticles() {
  const bal = await db.collection('stock_balances').get();
  const m = new Map();
  bal.forEach((d) => { const b = d.data(); if (!(b.lieu_type === 'magasin' || b.lieu_type === 'station') || !(b.balance > 0)) return; const c = canon(b.article_ref || b.article_nom); m.set(c, (m.get(c) || 0) + b.balance); });
  return m;
}

// Construit le plan d'écriture (FILL-ONLY + correction SULFATE).
async function plan() {
  const { filePrix, fileUnite, pmp } = loadFile();
  const { byCanon } = await catalogue();
  const stock = await stockArticles();
  const fills = [];
  for (const [c, q] of stock) { const cd = byCanon[c]; const fp = filePrix[c]; if ((!cd || cd.prix === 0) && fp != null) fills.push({ canon: c, prix: r2(fp), unite: fileUnite[c] || 'kg', docId: cd ? cd.id : null, qty: r2(q) }); }
  const corrections = [];
  const sm = byCanon['SULFATE DE MAGNESIE'];
  if (sm && pmp['SULFATE DE MAGNESIE']) corrections.push({ canon: 'SULFATE DE MAGNESIE', docId: sm.id, ancien: sm.prix, nouveau: r2(pmp['SULFATE DE MAGNESIE']) });
  return { fills, corrections };
}

async function cmdAnalyze() {
  const { fills, corrections } = await plan();
  console.log(JSON.stringify({ fills, corrections, nb_fill: fills.length, nb_create: fills.filter((f) => !f.docId).length, nb_update: fills.filter((f) => f.docId).length }, null, 2));
}

async function cmdBackup() {
  const snap = await db.collection('articles_catalog').get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const path = `catalogue_backup/${STAMP}/articles_catalog.json`;
  await bucket.file(path).save(JSON.stringify(docs), { contentType: 'application/json' });
  const [back] = await bucket.file(path).download();
  const ok = JSON.parse(back.toString()).length === docs.length;
  console.log(JSON.stringify({ ok, count: docs.length, path: `gs://${bucket.name}/${path}` }, null, 2));
  if (!ok) { console.error('BACKUP VERIFY FAILED'); process.exit(1); }
}

async function cmdApply() {
  const { fills, corrections } = await plan();
  let created = 0, updated = 0;
  for (const f of fills) {
    if (f.docId) { await db.collection('articles_catalog').doc(f.docId).update({ prix_ttc: f.prix, prix_source: 'inventaire_300625', prix_maj_at: Date.now() }); updated++; }
    else {
      const ref = f.canon.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || ('ART_' + created);
      await db.collection('articles_catalog').doc(ref).set({ reference: ref, nom: f.canon, prix_ttc: f.prix, unite: f.unite, categorie: 'autre', active: true, prix_source: 'inventaire_300625', created_at: Date.now(), updated_at: Date.now() }, { merge: true });
      created++;
    }
  }
  for (const c of corrections) { await db.collection('articles_catalog').doc(c.docId).update({ prix_ttc: c.nouveau, prix_source: 'pmp_acquisition_correction', prix_maj_at: Date.now() }); }
  console.log(JSON.stringify({ created, updated, corrections: corrections.length }, null, 2));
}

async function cmdReport() {
  const { snap, byCanon } = await catalogue();
  const stock = await stockArticles();
  // recompute valuation with current catalogue
  const bal = await db.collection('stock_balances').get();
  let val = 0; const stillNoPrice = new Set();
  bal.forEach((d) => { const b = d.data(); if (!(b.lieu_type === 'magasin' || b.lieu_type === 'station') || !(b.balance > 0)) return; const c = canon(b.article_ref || b.article_nom); const cd = byCanon[c]; const p = cd ? cd.prix : 0; val += b.balance * p; if (!(p > 0)) stillNoPrice.add(c); });
  console.log(JSON.stringify({ valeur_stock_DH: Math.round(val), catalogue_docs: snap.size, articles_encore_sans_prix: [...stillNoPrice].sort() }, null, 2));
}

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'analyze') await cmdAnalyze();
    else if (cmd === 'backup') await cmdBackup();
    else if (cmd === 'apply') await cmdApply();
    else if (cmd === 'report') await cmdReport();
    else { console.error('usage: analyze|backup|apply|report'); process.exit(2); }
  } catch (e) { console.error('ERR:', e && e.stack || e); process.exit(1); }
  process.exit(0);
})();
