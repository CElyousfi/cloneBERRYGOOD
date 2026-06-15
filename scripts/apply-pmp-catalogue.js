/**
 * apply-pmp-catalogue.js — Écrit le PMP (champ prix_pmp) sur articles_catalog.
 * GATED. Réutilise EXACTEMENT le calcul de compute-pmp-apercu.js (zéro divergence).
 *
 * Politique :
 *  - Écrit prix_pmp + prix_pmp_source + prix_pmp_maj_at sur les docs articles_catalog
 *    matchés par canon(nom). NE TOUCHE PAS prix_ttc (FILL-ONLY conservé).
 *  - Article avec PMP mais sans doc catalogue → crée le doc (prix_ttc absent, prix_pmp posé).
 *  - Article sans PMP (ex. SEACTIV GENAKTIS 3) → ignoré (reste sur prix_ttc/0).
 *  - Backup articles_catalog AVANT écriture.
 *
 * Sous-commandes (depuis functions/, ADC requis) :
 *   node ../scripts/apply-pmp-catalogue.js backup
 *   node ../scripts/apply-pmp-catalogue.js apply
 *   node ../scripts/apply-pmp-catalogue.js report
 */
'use strict';
const { db, bucket } = require('../functions/config/firebase');
const { computePMP } = require('../functions/lib/stock/valuationPMP');
const { buildAcquisitionsByArticle, loadSheets, canon, round2 } = require('./compute-pmp-apercu');

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function pmpByArticle() {
  const acq = buildAcquisitionsByArticle(loadSheets());
  const out = {};
  for (const [art, data] of Object.entries(acq)) {
    const r = computePMP(data.acquisitions);
    if (r.pmp == null || !(r.pmp > 0)) continue;
    let dom = null, mx = -1;
    for (const [s, n] of Object.entries(r.sourceBreakdown || {})) if (n > mx) { mx = n; dom = s; }
    out[art] = { pmp: round2(r.pmp), source: dom };
  }
  return out;
}

async function catByCanon() {
  const snap = await db.collection('articles_catalog').get();
  const m = {};
  snap.forEach((d) => { const a = d.data(); if (!a.nom) return; const c = canon(a.nom); if (!m[c] || (parseFloat(a.prix_ttc) || 0) > 0) m[c] = { id: d.id, unite: a.unite }; });
  return { snap, m };
}

async function cmdBackup() {
  const snap = await db.collection('articles_catalog').get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const p = `catalogue_backup/${STAMP}_pmp/articles_catalog.json`;
  await bucket.file(p).save(JSON.stringify(docs), { contentType: 'application/json' });
  const [b] = await bucket.file(p).download();
  const ok = JSON.parse(b.toString()).length === docs.length;
  console.log(JSON.stringify({ ok, count: docs.length, path: `gs://${bucket.name}/${p}` }, null, 2));
  if (!ok) process.exit(1);
}

async function cmdApply() {
  const pmp = pmpByArticle();
  const { m: cat } = await catByCanon();
  let updated = 0, created = 0;
  for (const [art, v] of Object.entries(pmp)) {
    const cd = cat[art];
    if (cd) { await db.collection('articles_catalog').doc(cd.id).update({ prix_pmp: v.pmp, prix_pmp_source: v.source, prix_pmp_maj_at: Date.now() }); updated++; }
    else {
      const ref = art.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || ('PMP_' + created);
      await db.collection('articles_catalog').doc(ref).set({ reference: ref, nom: art, prix_pmp: v.pmp, prix_pmp_source: v.source, prix_pmp_maj_at: Date.now(), categorie: 'autre', active: true }, { merge: true });
      created++;
    }
  }
  console.log(JSON.stringify({ articles_pmp: Object.keys(pmp).length, updated, created }, null, 2));
}

async function cmdReport() {
  const { snap } = await catByCanon();
  let withPmp = 0; snap.forEach((d) => { if (parseFloat(d.data().prix_pmp) > 0) withPmp++; });
  // valorisation stock au prix effectif (prix_pmp sinon prix_ttc)
  const cat = {};
  snap.forEach((d) => { const a = d.data(); if (!a.nom) return; const c = canon(a.nom); const eff = parseFloat(a.prix_pmp) || parseFloat(a.prix_ttc) || 0; const src = parseFloat(a.prix_pmp) > 0 ? (a.prix_pmp_source || 'pmp') : (parseFloat(a.prix_ttc) > 0 ? 'fill_only' : 'aucun'); if (!cat[c] || eff > 0) cat[c] = { eff, src }; });
  const bal = await db.collection('stock_balances').get();
  let val = 0; const srcCount = {};
  bal.forEach((d) => { const b = d.data(); if (!(b.lieu_type === 'magasin' || b.lieu_type === 'station') || !(b.balance > 0)) return; const c = canon(b.article_ref || b.article_nom); const e = cat[c] || { eff: 0, src: 'aucun' }; val += b.balance * e.eff; srcCount[e.src] = (srcCount[e.src] || 0) + 1; });
  console.log(JSON.stringify({ catalogue_avec_prix_pmp: withPmp, valeur_stock_effective_DH: Math.round(val), lignes_par_source: srcCount }, null, 2));
}

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'backup') await cmdBackup();
    else if (cmd === 'apply') await cmdApply();
    else if (cmd === 'report') await cmdReport();
    else { console.error('usage: backup|apply|report'); process.exit(2); }
  } catch (e) { console.error('ERR:', e && e.stack || e); process.exit(1); }
  process.exit(0);
})();
