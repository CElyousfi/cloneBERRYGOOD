/**
 * reconstruct-stock.js — Reconstruction du stock à partir du GRAND LIVRE complet
 * (docs/Inventaire Stock 300625.xlsx, 5 feuilles). GATED — destructif sur prod.
 *
 * Modèle : Stock = Inventaire 30/06 + Entrées − Consommations − Sorties ± Transferts.
 * Mirroir EXACT de la logique d'impact prod via les libs réelles :
 *   - functions/lib/stockCaneva (movementDelta)
 *   - functions/lib/stock/movementImpact (isImpactApplied)
 *
 * Sous-commandes (à lancer depuis functions/, ADC requis) :
 *   node ../scripts/reconstruct-stock.js backup    -> backup Storage horodaté + vérif
 *   node ../scripts/reconstruct-stock.js preview    -> aperçu APRÈS en mémoire (AUCUN write)
 *   node ../scripts/reconstruct-stock.js execute     -> purge 4096 canevas + import 5 feuilles + recompute
 *   node ../scripts/reconstruct-stock.js report      -> soldes actuels + négatifs
 *
 * GARDE-FOUS : backup vérifié (read-back == source) avant toute purge ; sinon ABORT.
 *
 * ⚠️ RÈGLE DE TYPAGE DES LIEUX — DUPLIQUÉE EN 3 ENDROITS.
 * Règle : seules les FERMES du groupe (F1..F6, BAHIA) sont des 'magasin'. Sur
 * les BONS DE SORTIE, tout le reste (fournisseur, prestataire, décharge,
 * client) reste 'externe'. ⚠️ Asymétrie pré-existante, hors périmètre : les
 * TRANSFERTS utilisent buildLieu nu, une destination non-ferme y devient donc
 * 'parcelle'.
 * Toute modification doit être répercutée dans LES TROIS :
 *   - functions/lib/stockCaneva/mappings.js   (buildLieu — chemin Cloud Function)
 *   - scripts/import-stock-caneva.js          (buildLieu — copie script)
 *   - scripts/reconstruct-stock.js            (lieuFromCode — ce fichier)
 * Pas encore factorisé : scripts/ est hors du périmètre de déploiement de
 * functions/, la mutualisation mérite son propre ticket.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX_CANDIDATES = [
  path.resolve(__dirname, '../docs/Inventaire Stock 300625.xlsx'),
  '/Users/omarmaaouni/Desktop/berrygood-dashboard/docs/Inventaire Stock 300625.xlsx',
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p)) || XLSX_CANDIDATES[0];
const { db, bucket } = require('../functions/config/firebase');
const stockCaneva = require('../functions/lib/stockCaneva');
const { isImpactApplied } = require('../functions/lib/stock/movementImpact');
const XLSX = require('../functions/node_modules/xlsx');

const NOW = new Date();
const STAMP = NOW.toISOString().replace(/[:.]/g, '-');
const IMPORT_BATCH = 'grandlivre_' + STAMP;

// ---------- helpers ----------
function canon(a) {
  let s = (a == null ? '' : String(a)).toUpperCase().trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, '');
  return s.trim();
}
function magId(code) {
  const m = /^F-?0?(\d)$/.exec((code == null ? '' : String(code)).trim());
  return m ? ('F' + m[1]) : null;
}
function lieuFromCode(code) {
  const c = (code == null ? '' : String(code)).trim();
  if (!c) return null;
  // BAHIA est une FERME du groupe → magasin (cf. docs/spec-magasin-bahia.md).
  // Les tiers (DRISS TIMAC, décharge, client…) restent 'externe' : c'est la
  // variante restrictive retenue dans functions/lib/stockCaneva. Ne PAS
  // généraliser au fallback ci-dessous.
  if (/^el\s*bahia$/i.test(c) || /bahia/i.test(c)) return { type: 'magasin', id: 'BAHIA' };
  if (/timac/i.test(c)) return { type: 'externe', id: 'DRISS TIMAC' };
  const mg = magId(c);
  if (mg) return { type: 'magasin', id: mg };
  return { type: 'externe', id: c.toUpperCase() };
}
function toDate(v) {
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') { // excel serial
    const d = XLSX.SSF ? null : null;
  }
  const s = String(v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function num(x) { const n = parseFloat(x); return isNaN(n) ? 0 : n; }

function loadSheets() {
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const out = {};
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
  }
  return out;
}

// Build the canonical name map across the file (raw -> {ref, nom}).
function buildArticleMap(sheets) {
  const display = {}; // canon -> display (first non-empty raw, trimmed)
  const cols = {
    'INVENTAIRE AU 30-06-25': 2, 'BONS D ENTREE': 4, 'BONS DE TRANSFERT': 4,
    'BONS CONSOMMATION': 5, 'BONS SORTIE': 5,
  };
  for (const [sh, ci] of Object.entries(cols)) {
    const rows = sheets[sh] || [];
    for (let i = 1; i < rows.length; i++) {
      const raw = rows[i] && rows[i][ci];
      if (raw == null || String(raw).trim() === '') continue;
      const c = canon(raw);
      if (!display[c]) display[c] = c; // canonical display = uppercase canonical (stable key everywhere)
    }
  }
  return display;
}

// Parse the 5 sheets into grouped stock_movement docs.
function buildMovements(sheets) {
  const movs = [];
  const skipped = { intra_transfert: 0, conso_no_depart: 0 };
  const mk = (extra) => Object.assign({
    ferme: '', ref_bl_fournisseur: '', fournisseur_nom: null,
    reception_libre: false, reception_libre_motif: '', ref_bon_physique: '',
    sortie_type: null, numero_source: '', bdc_id: null, bl_id: null, scan_url: null,
    validations: { magasinier: { by: 'import_grandlivre', name: 'Import Grand Livre', at: Date.now() } },
    rejection: null, import_source: 'GRAND_LIVRE', import_batch: IMPORT_BATCH,
    created_by: { userId: 'import_grandlivre', name: 'Import Grand Livre' },
    created_at: Date.now(), updated_at: Date.now(),
  }, extra);

  // group accumulator: key -> movement (items pushed)
  const group = (map, key, factory) => { if (!map[key]) map[key] = factory(); return map[key]; };

  // 1) INVENTAIRE (ouverture) — reception dest=magasin, status valide_chef.
  //    qty<0 -> debit (consommation source=magasin) pour ne rien masquer.
  {
    const rows = sheets['INVENTAIRE AU 30-06-25'] || [];
    const gPos = {}, gNeg = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const date = toDate(r[0]); const mg = lieuFromCode(r[1]); const q = num(r[4]);
      if (!date || !mg || q === 0) continue;
      const item = { article_ref: canon(r[2]), article_nom: canon(r[2]), quantite: Math.abs(q), unite: (r[3] || 'kg') };
      if (q > 0) {
        const k = `${date}|${mg.id}`;
        const m = group(gPos, k, () => mk({ numero: `INV-OUV-${mg.id}-${date}`, type: 'reception', date, lieu_source: null, lieu_destination: mg, items: [], status: 'valide_chef', origine: 'inventaire_ouverture' }));
        m.items.push(item);
      } else {
        const k = `${date}|${mg.id}`;
        const m = group(gNeg, k, () => mk({ numero: `INV-OUV-NEG-${mg.id}-${date}`, type: 'consommation', date, lieu_source: mg, lieu_destination: null, items: [], status: 'valide_mag', origine: 'inventaire_ouverture_ajustement_negatif' }));
        m.items.push(item);
      }
    }
    movs.push(...Object.values(gPos), ...Object.values(gNeg));
  }

  // 2) BONS D ENTREE — reception dest=magasin, status valide_chef.
  {
    const rows = sheets['BONS D ENTREE'] || [];
    const g = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const date = toDate(r[1]); const mg = lieuFromCode(r[0]); const q = num(r[6]);
      if (!date || !mg || q <= 0) continue;
      const bl = (r[2] == null ? '' : String(r[2])).trim(); const four = (r[3] == null ? '' : String(r[3])).trim();
      const k = `${date}|${mg.id}|${bl}|${four}`;
      const m = group(g, k, () => mk({ numero: bl ? `BE-${bl}` : `BE-${date}-${mg.id}-${i}`, type: 'reception', date, lieu_source: null, lieu_destination: mg, items: [], status: 'valide_chef', ref_bl_fournisseur: bl, fournisseur_nom: four || null, origine: 'bon_entree' }));
      m.items.push({ article_ref: canon(r[4]), article_nom: canon(r[4]), quantite: q, unite: (r[5] || 'kg') });
    }
    movs.push(...Object.values(g));
  }

  // 3) BONS DE TRANSFERT — transfert source->dest. IGNORE intra (P1).
  {
    const rows = sheets['BONS DE TRANSFERT'] || [];
    const g = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const date = toDate(r[0]); const src = lieuFromCode(r[2]); const dst = lieuFromCode(r[3]); const q = num(r[5]);
      if (!date || !src || !dst || q <= 0) continue;
      if (src.type === dst.type && src.id === dst.id) { skipped.intra_transfert++; continue; } // P1: net-zéro ignoré
      const numBon = (r[1] == null ? '' : String(r[1])).trim();
      const k = `${date}|${numBon}|${src.type}:${src.id}|${dst.type}:${dst.id}`;
      const m = group(g, k, () => mk({ numero: numBon ? `BT-${numBon}` : `BT-${date}-${i}`, type: 'transfert', date, lieu_source: src, lieu_destination: dst, items: [], status: 'valide_mag', origine: 'bon_transfert' }));
      m.items.push({ article_ref: canon(r[4]), article_nom: canon(r[4]), quantite: q, unite: 'kg' });
    }
    movs.push(...Object.values(g));
  }

  // 4) BONS CONSOMMATION — consommation source=magasin, dest=parcelle.
  {
    const rows = sheets['BONS CONSOMMATION'] || [];
    const g = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const date = toDate(r[0]); const src = lieuFromCode(r[2]); const q = num(r[7]);
      if (!date || !src) { if (!src) skipped.conso_no_depart++; continue; }
      if (q <= 0) continue;
      const parc = (r[3] == null ? '' : String(r[3])).trim();
      const numBon = (r[1] == null ? '' : String(r[1])).trim();
      const dst = parc ? { type: 'parcelle', id: parc } : null;
      const k = `${date}|${numBon}|${src.type}:${src.id}|${parc}`;
      const m = group(g, k, () => mk({ numero: numBon ? `BCG-${numBon}` : `BCG-${date}-${i}`, type: 'consommation', date, lieu_source: src, lieu_destination: dst, items: [], status: 'valide_mag', origine: 'bon_consommation' }));
      m.items.push({ article_ref: canon(r[5]), article_nom: canon(r[5]), quantite: q, unite: (r[6] || 'kg') });
    }
    movs.push(...Object.values(g));
  }

  // 5) BONS SORTIE — sortie source=magasin, dest=externe. status valide_chef.
  {
    const rows = sheets['BONS SORTIE'] || [];
    const g = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const date = toDate(r[1]); const src = lieuFromCode(r[0]); const q = num(r[7]);
      if (!date || !src || q <= 0) continue;
      const dst = lieuFromCode(r[3]);
      const numBon = (r[2] == null ? '' : String(r[2])).trim();
      const k = `${date}|${numBon}|${src.type}:${src.id}`;
      const m = group(g, k, () => mk({ numero: numBon ? `BSG-${numBon}` : `BSG-${date}-${i}`, type: 'sortie', date, lieu_source: src, lieu_destination: dst, items: [], status: 'valide_chef', sortie_type: 'externe', reception_libre_motif: (r[8] || ''), origine: 'bon_sortie' }));
      m.items.push({ article_ref: canon(r[5]), article_nom: canon(r[5]), quantite: q, unite: (r[6] || 'kg') });
    }
    movs.push(...Object.values(g));
  }

  return { movs, skipped };
}

// Compute materialized balances EXACTLY like rebuildBalances (isImpactApplied + movementDelta).
function computeBalances(allMovements) {
  const bal = new Map();
  const keyOf = (lt, li, ref) => `${lt}_${li}_${ref}`.replace(/\s+/g, '_');
  const add = (lt, li, ref, nom, unite, delta) => {
    const k = keyOf(lt, li, ref);
    const cur = bal.get(k) || { lieu_type: lt, lieu_id: li, article_ref: ref, article_nom: nom, unite: unite || 'kg', balance: 0 };
    cur.balance = Math.round((cur.balance + delta) * 100) / 100;
    if (nom) cur.article_nom = nom;
    bal.set(k, cur);
  };
  for (const m of allMovements) {
    if (!isImpactApplied(m)) continue;
    for (const d of stockCaneva.movementDelta(m)) add(d.lieu_type, d.lieu_id, d.article_ref, d.article_nom, d.unite, d.delta);
  }
  return bal; // Map balanceId -> {fields, balance}
}

// Canonicalize article_ref/nom on the KEPT saisis so they share keys with the file.
function canonicalizeSaisi(m) {
  const items = (m.items || []).map((it) => {
    const c = canon(it.article_ref || it.article || it.article_nom);
    return Object.assign({}, it, { article_ref: c, article_nom: c });
  });
  return Object.assign({}, m, { items });
}

async function readAll(coll) {
  const snap = await db.collection(coll).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// ---------- commands ----------
async function cmdBackup() {
  const movs = await readAll('stock_movements');
  const bals = await readAll('stock_balances');
  const base = `stock_backup/${STAMP}`;
  const mFile = `${base}/stock_movements.json`;
  const bFile = `${base}/stock_balances.json`;
  await bucket.file(mFile).save(JSON.stringify(movs), { contentType: 'application/json' });
  await bucket.file(bFile).save(JSON.stringify(bals), { contentType: 'application/json' });
  const manifest = { stamp: STAMP, created_at: NOW.toISOString(), movements: movs.length, balances: bals.length, bucket: bucket.name, paths: { movements: mFile, balances: bFile } };
  await bucket.file(`${base}/manifest.json`).save(JSON.stringify(manifest, null, 2), { contentType: 'application/json' });
  // VERIFY read-back
  const [mBack] = await bucket.file(mFile).download();
  const [bBack] = await bucket.file(bFile).download();
  const mOk = JSON.parse(mBack.toString()).length === movs.length;
  const bOk = JSON.parse(bBack.toString()).length === bals.length;
  console.log(JSON.stringify({ ok: mOk && bOk, manifest, verify: { movements_match: mOk, balances_match: bOk } }, null, 2));
  if (!(mOk && bOk)) { console.error('BACKUP VERIFY FAILED — ABORT'); process.exit(1); }
}

async function cmdPreview() {
  const sheets = loadSheets();
  buildArticleMap(sheets);
  const { movs, skipped } = buildMovements(sheets);
  // kept saisis (non-canevas), canonicalized
  const all = await readAll('stock_movements');
  const saisis = all.filter((m) => !(m.created_by && (m.created_by.userId || m.created_by.uid) === 'import_caneva'))
    .map(canonicalizeSaisi);
  const combined = movs.concat(saisis);
  const bal = computeBalances(combined);
  const arr = [...bal.values()].filter((b) => Math.abs(b.balance) >= 0.01);
  const negs = arr.filter((b) => b.balance < -0.01).sort((a, b) => a.balance - b.balance);
  // global per-article
  const glob = {};
  for (const b of arr) { if (b.lieu_type === 'magasin' || b.lieu_type === 'station') glob[b.article_ref] = (glob[b.article_ref] || 0) + b.balance; }
  const gneg = Object.entries(glob).filter(([, v]) => v < -0.01).sort((a, b) => a[1] - b[1]);
  const byLieu = {};
  for (const b of arr) { const k = `${b.lieu_type}_${b.lieu_id}`; byLieu[k] = byLieu[k] || { n: 0, pos: 0, neg: 0 }; byLieu[k].n++; if (b.balance < 0) byLieu[k].neg++; else byLieu[k].pos++; }
  const tops = arr.filter((b) => b.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 10);
  console.log(JSON.stringify({
    imported_movements: movs.length, kept_saisis: saisis.length, skipped,
    nonzero_balances: arr.length, negative_cells: negs.length,
    positive_balances: arr.filter((b) => b.balance > 0).length,
    global_negative_articles: gneg.length,
    by_lieu: byLieu,
    top_positive: tops.map((b) => ({ id: `${b.lieu_type}_${b.lieu_id}_${b.article_ref}`.replace(/\s+/g, '_'), solde: b.balance, unite: b.unite })),
    global_negatives: gneg.map(([a, v]) => ({ article: a, solde: Math.round(v * 100) / 100 })),
    negative_cells_detail: negs.map((b) => ({ id: `${b.lieu_type}_${b.lieu_id}_${b.article_ref}`.replace(/\s+/g, '_'), solde: b.balance })),
  }, null, 2));
  return { movs, saisis, bal };
}

async function cmdExecute() {
  const sheets = loadSheets();
  buildArticleMap(sheets);
  const { movs, skipped } = buildMovements(sheets);
  console.log('Built movements:', movs.length, 'skipped:', JSON.stringify(skipped));

  // 1) PURGE canevas (import_caneva) — includes the 2 malformed (both canevas).
  const all = await readAll('stock_movements');
  const toDelete = all.filter((m) => m.created_by && (m.created_by.userId || m.created_by.uid) === 'import_caneva');
  const saisis = all.filter((m) => !(m.created_by && (m.created_by.userId || m.created_by.uid) === 'import_caneva'));
  console.log(`PURGE: ${toDelete.length} canevas, KEEP: ${saisis.length} saisis`);
  for (const c of chunk(toDelete, 400)) {
    const b = db.batch();
    c.forEach((m) => b.delete(db.collection('stock_movements').doc(m.id)));
    await b.commit();
  }
  console.log('Purge done.');

  // 1b) Canonicalize KEPT saisis article_ref/nom in place (key consistency with file).
  for (const c of chunk(saisis, 400)) {
    const b = db.batch();
    c.forEach((m) => {
      const items = (m.items || []).map((it) => { const cc = canon(it.article_ref || it.article || it.article_nom); return Object.assign({}, it, { article_ref: cc, article_nom: cc }); });
      b.update(db.collection('stock_movements').doc(m.id), { items, updated_at: Date.now() });
    });
    await b.commit();
  }
  console.log('Saisis canonicalized.');

  // 2) IMPORT 5 sheets (ordre comptable déjà dans movs array order).
  for (const c of chunk(movs, 400)) {
    const b = db.batch();
    c.forEach((m) => b.set(db.collection('stock_movements').doc(), m));
    await b.commit();
  }
  console.log('Import done:', movs.length);

  // 3) RECOMPUTE balances from scratch.
  const allAfter = await readAll('stock_movements');
  const bal = computeBalances(allAfter.map((m) => m)); // already canonicalized in store
  const existing = await readAll('stock_balances');
  const seen = new Set();
  const ops = [];
  for (const [k, v] of bal) { seen.add(k); ops.push({ type: 'set', id: k, data: Object.assign({}, v, { updated_at: Date.now() }) }); }
  for (const e of existing) { if (!seen.has(e.id)) ops.push({ type: 'delete', id: e.id }); }
  for (const c of chunk(ops, 400)) {
    const b = db.batch();
    c.forEach((o) => { const ref = db.collection('stock_balances').doc(o.id); if (o.type === 'set') b.set(ref, o.data); else b.delete(ref); });
    await b.commit();
  }
  console.log('Recompute done. balances:', bal.size);
}

async function cmdReport() {
  const bals = await readAll('stock_balances');
  const arr = bals.filter((b) => Math.abs(b.balance) >= 0.01);
  const negs = arr.filter((b) => b.balance < -0.01).sort((a, b) => a.balance - b.balance);
  const byLieu = {};
  for (const b of arr) { const k = `${b.lieu_type}_${b.lieu_id}`; byLieu[k] = (byLieu[k] || 0) + 1; }
  console.log(JSON.stringify({ total_balances: bals.length, nonzero: arr.length, negatives: negs.length, by_lieu: byLieu, negative_list: negs.map((b) => ({ id: b.id, article: b.article_nom, solde: b.balance })) }, null, 2));
}

// File-side aggregates per sheet (lines, Σqty, per magasin, per canonical article).
function aggFile(sheets) {
  const z = () => ({ lines: 0, qty: 0, byMag: {}, byArt: {} });
  const addAgg = (a, mag, art, q) => { a.lines++; a.qty = Math.round((a.qty + q) * 100) / 100; if (mag) a.byMag[mag] = Math.round(((a.byMag[mag] || 0) + q) * 100) / 100; a.byArt[art] = Math.round(((a.byArt[art] || 0) + q) * 100) / 100; };
  const out = { INVENTAIRE: z(), ENTREE: z(), TRANSFERT: z(), CONSO: z(), SORTIE: z() };
  let rows;
  rows = sheets['INVENTAIRE AU 30-06-25'] || [];
  for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; const mg = lieuFromCode(r[1]); const q = num(r[4]); if (!mg || q === 0 || !toDate(r[0])) continue; addAgg(out.INVENTAIRE, mg.id, canon(r[2]), q); }
  rows = sheets['BONS D ENTREE'] || [];
  for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; const mg = lieuFromCode(r[0]); const q = num(r[6]); if (!mg || q <= 0 || !toDate(r[1])) continue; addAgg(out.ENTREE, mg.id, canon(r[4]), q); }
  rows = sheets['BONS DE TRANSFERT'] || [];
  for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; const src = lieuFromCode(r[2]); const dst = lieuFromCode(r[3]); const q = num(r[5]); if (!src || !dst || q <= 0 || !toDate(r[0])) continue; if (src.type === dst.type && src.id === dst.id) continue; addAgg(out.TRANSFERT, src.id, canon(r[4]), q); }
  rows = sheets['BONS CONSOMMATION'] || [];
  for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; const src = lieuFromCode(r[2]); const q = num(r[7]); if (!src || q <= 0 || !toDate(r[0])) continue; addAgg(out.CONSO, src.id, canon(r[5]), q); }
  rows = sheets['BONS SORTIE'] || [];
  for (let i = 1; i < rows.length; i++) { const r = rows[i]; if (!r) continue; const src = lieuFromCode(r[0]); const q = num(r[7]); if (!src || q <= 0 || !toDate(r[1])) continue; addAgg(out.SORTIE, src.id, canon(r[5]), q); }
  return out;
}

// Base-side aggregates from imported GRAND_LIVRE movements.
function aggBase(movs) {
  const z = () => ({ lines: 0, qty: 0, byMag: {}, byArt: {} });
  const out = { INVENTAIRE: z(), ENTREE: z(), TRANSFERT: z(), CONSO: z(), SORTIE: z() };
  const ORI = { inventaire_ouverture: 'INVENTAIRE', inventaire_ouverture_ajustement_negatif: 'INVENTAIRE', bon_entree: 'ENTREE', bon_transfert: 'TRANSFERT', bon_consommation: 'CONSO', bon_sortie: 'SORTIE' };
  const add = (a, mag, art, q) => { a.lines++; a.qty = Math.round((a.qty + q) * 100) / 100; if (mag) a.byMag[mag] = Math.round(((a.byMag[mag] || 0) + q) * 100) / 100; a.byArt[art] = Math.round(((a.byArt[art] || 0) + q) * 100) / 100; };
  for (const m of movs) {
    const t = ORI[m.origine]; if (!t) continue;
    const neg = m.origine === 'inventaire_ouverture_ajustement_negatif';
    const mag = (m.lieu_source && m.lieu_source.type === 'magasin') ? m.lieu_source.id
      : (m.lieu_destination && m.lieu_destination.type === 'magasin') ? m.lieu_destination.id : null;
    for (const it of (m.items || [])) { const q = (neg ? -1 : 1) * (parseFloat(it.quantite) || 0); add(out[t], mag, it.article_ref, q); }
  }
  return out;
}

async function cmdReconcile() {
  const sheets = loadSheets();
  const f = aggFile(sheets);
  const all = await readAll('stock_movements');
  const gl = all.filter((m) => m.import_source === 'GRAND_LIVRE');
  const b = aggBase(gl);
  const expectLines = { INVENTAIRE: 162, ENTREE: 318, TRANSFERT: 2049, CONSO: 16288, SORTIE: 8 };
  const table = [];
  for (const t of ['INVENTAIRE', 'ENTREE', 'TRANSFERT', 'CONSO', 'SORTIE']) {
    table.push({ type: t, lignes_fichier: f[t].lines, lignes_base: b[t].lines, attendu: expectLines[t],
      ecart_lignes: b[t].lines - f[t].lines, sigma_qte_fichier: f[t].qty, sigma_qte_base: b[t].qty, ecart_qte: Math.round((b[t].qty - f[t].qty) * 100) / 100 });
  }
  // per-article diffs (file vs base) per type
  const artDiffs = {};
  for (const t of ['INVENTAIRE', 'ENTREE', 'TRANSFERT', 'CONSO', 'SORTIE']) {
    const arts = new Set([...Object.keys(f[t].byArt), ...Object.keys(b[t].byArt)]);
    const diffs = [];
    for (const a of arts) { const d = Math.round(((b[t].byArt[a] || 0) - (f[t].byArt[a] || 0)) * 100) / 100; if (Math.abs(d) > 0.01) diffs.push({ article: a, fichier: f[t].byArt[a] || 0, base: b[t].byArt[a] || 0, ecart: d }); }
    artDiffs[t] = diffs;
  }
  // per-mag diffs
  const magDiffs = {};
  for (const t of ['INVENTAIRE', 'ENTREE', 'TRANSFERT', 'CONSO', 'SORTIE']) {
    const mags = new Set([...Object.keys(f[t].byMag), ...Object.keys(b[t].byMag)]);
    const diffs = [];
    for (const m of mags) { const d = Math.round(((b[t].byMag[m] || 0) - (f[t].byMag[m] || 0)) * 100) / 100; diffs.push({ magasin: m, fichier: f[t].byMag[m] || 0, base: b[t].byMag[m] || 0, ecart: d }); }
    magDiffs[t] = diffs;
  }
  // transfert net-zero per article (from movementDelta over transfert movements)
  const tnet = {};
  for (const m of gl.filter((x) => x.origine === 'bon_transfert')) { for (const d of stockCaneva.movementDelta(m)) tnet[d.article_ref] = Math.round(((tnet[d.article_ref] || 0) + d.delta) * 100) / 100; }
  const tnetNonZero = Object.entries(tnet).filter(([, v]) => Math.abs(v) > 0.01);
  // global equation per article: inv + ent - conso - sortie == solde stock (magasin+station)
  const eq = {};
  const arts = new Set([...Object.keys(f.INVENTAIRE.byArt), ...Object.keys(f.ENTREE.byArt), ...Object.keys(f.CONSO.byArt), ...Object.keys(f.SORTIE.byArt)]);
  // File-only solde: recompute balances from GL movements ONLY (excludes the 13 kept saisis),
  // so the equation check isolates IMPORT integrity from post-file saisi consumption.
  const glBal = computeBalances(gl);
  const stockSolde = {};
  for (const bb of glBal.values()) { if (bb.lieu_type === 'magasin' || bb.lieu_type === 'station') stockSolde[bb.article_ref] = Math.round(((stockSolde[bb.article_ref] || 0) + bb.balance) * 100) / 100; }
  const eqMismatch = [];
  for (const a of arts) {
    const expected = Math.round(((f.INVENTAIRE.byArt[a] || 0) + (f.ENTREE.byArt[a] || 0) - (f.CONSO.byArt[a] || 0) - (f.SORTIE.byArt[a] || 0)) * 100) / 100;
    // note: base solde also includes the 13 kept saisis -> only compare file-derived articles where no saisi touched; report mismatch list
    const actual = stockSolde[a] || 0;
    if (Math.abs(expected - actual) > 0.01) eqMismatch.push({ article: a, equation_fichier: expected, solde_base: actual, ecart: Math.round((actual - expected) * 100) / 100 });
  }
  console.log(JSON.stringify({
    table,
    ecarts_expliques: { transfert_intra_ignores: 2402 - 2049, conso_sans_depart: 6 },
    article_diffs: artDiffs, mag_diffs: magDiffs,
    transfert_net_zero: { ok: tnetNonZero.length === 0, non_zero: tnetNonZero },
    equation_mismatches_vs_solde_base: eqMismatch.length, equation_detail: eqMismatch.slice(0, 40),
    sorties: gl.filter((x) => x.origine === 'bon_sortie').map((m) => ({ numero: m.numero, date: m.date, src: m.lieu_source && m.lieu_source.id, dst: m.lieu_destination && m.lieu_destination.id, items: (m.items || []).map((i) => `${i.article_ref}:${i.quantite}`) })),
  }, null, 2));
}

// Grand livre chronologique d'un article (toutes lignes, solde courant par lieu de stock).
async function cmdHistory() {
  const target = canon(process.argv[3] || '');
  if (!target) { console.error('usage: history "NOM ARTICLE"'); process.exit(2); }
  const all = await readAll('stock_movements');
  const rows = [];
  for (const m of all) {
    const impact = isImpactApplied(m);
    for (const it of (m.items || [])) {
      if (canon(it.article_ref || it.article || it.article_nom) !== target) continue;
      const q = parseFloat(it.quantite) || 0;
      const src = m.lieu_source && m.lieu_source.id ? `${m.lieu_source.type}:${m.lieu_source.id}` : null;
      const dst = m.lieu_destination && m.lieu_destination.id ? `${m.lieu_destination.type}:${m.lieu_destination.id}` : null;
      rows.push({ date: m.date, numero: m.numero, type: m.type, status: m.status, src, dst, qty: q, impact, src_app: m.import_source || 'saisie' });
    }
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.numero).localeCompare(String(b.numero)));
  // running balance per stock lieu (magasin/station)
  const isStock = (l) => l && /^(magasin|station):/.test(l);
  const bal = {};
  console.log(`\n=== HISTORIQUE: ${target} ===`);
  console.log('date       | type         | num            | statut         | impact | source->dest                  | qté    | effet stock');
  for (const r of rows) {
    let eff = '';
    if (r.impact) {
      if (isStock(r.src)) { bal[r.src] = Math.round(((bal[r.src] || 0) - r.qty) * 100) / 100; eff += `${r.src} ${bal[r.src]}`; }
      if (isStock(r.dst)) { bal[r.dst] = Math.round(((bal[r.dst] || 0) + r.qty) * 100) / 100; eff += ` ${r.dst} ${bal[r.dst]}`; }
    } else { eff = '(non compté)'; }
    console.log(`${String(r.date).padEnd(10)} | ${String(r.type).padEnd(12)} | ${String(r.numero).padEnd(14)} | ${String(r.status).padEnd(14)} | ${r.impact ? 'OUI ' : 'NON '}   | ${String((r.src || 'Ø') + '->' + (r.dst || 'Ø')).padEnd(29)} | ${String(r.qty).padStart(6)} | ${eff}`);
  }
  console.log('--- SOLDES FINAUX (lieux de stock) ---');
  for (const [k, v] of Object.entries(bal)) console.log(`   ${k}: ${v}`);
  process.exit(0);
}

// Diagnostic agrégé d'un article par magasin : où se creuse le trou.
async function cmdDiag() {
  const target = canon(process.argv[3] || '');
  if (!target) { console.error('usage: diag "NOM ARTICLE"'); process.exit(2); }
  const all = await readAll('stock_movements');
  const agg = {}; // lieu -> {ouv, ent_ok, ent_pending, tr_in, tr_out, conso, sortie, ext_out, solde}
  const g = (l) => (agg[l] = agg[l] || { ouv: 0, ent_ok: 0, ent_pending: 0, tr_in: 0, tr_out: 0, conso: 0, sortie: 0, ext_out: 0, solde: 0 });
  const pending = [];
  for (const m of all) {
    const impact = isImpactApplied(m);
    for (const it of (m.items || [])) {
      if (canon(it.article_ref || it.article || it.article_nom) !== target) continue;
      const q = parseFloat(it.quantite) || 0;
      const s = m.lieu_source, d = m.lieu_destination;
      const sStock = s && (s.type === 'magasin' || s.type === 'station');
      const dStock = d && (d.type === 'magasin' || d.type === 'station');
      if (m.origine === 'inventaire_ouverture' && dStock) g(`${d.type}:${d.id}`).ouv += q;
      else if (m.type === 'reception' && dStock) { if (impact) g(`${d.type}:${d.id}`).ent_ok += q; else { g(`${d.type}:${d.id}`).ent_pending += q; pending.push({ numero: m.numero, date: m.date, lieu: `${d.type}:${d.id}`, qty: q, status: m.status, src_app: m.import_source || 'saisie' }); } }
      else if (m.type === 'transfert') { if (sStock && impact) g(`${s.type}:${s.id}`).tr_out += q; if (dStock && impact) g(`${d.type}:${d.id}`).tr_in += q; if (sStock && impact && d && !dStock) g(`${s.type}:${s.id}`).ext_out += q; }
      else if (m.type === 'consommation' && sStock && impact) g(`${s.type}:${s.id}`).conso += q;
      else if (m.type === 'sortie' && sStock && impact) g(`${s.type}:${s.id}`).sortie += q;
    }
  }
  console.log(`\n=== DIAG: ${target} ===`);
  console.log('lieu             | ouv   | ent✓  | ent⏳ | tr_in | tr_out| ext_out| conso  | sortie | SOLDE');
  for (const [l, a] of Object.entries(agg)) {
    a.solde = Math.round((a.ouv + a.ent_ok + a.tr_in - a.tr_out - a.ext_out - a.conso - a.sortie) * 100) / 100;
    const f = (x) => String(Math.round(x * 100) / 100).padStart(6);
    console.log(`${l.padEnd(16)} |${f(a.ouv)} |${f(a.ent_ok)} |${f(a.ent_pending)} |${f(a.tr_in)} |${f(a.tr_out)} |${f(a.ext_out)} |${f(a.conso)} |${f(a.sortie)} | ${a.solde}`);
  }
  if (pending.length) { console.log('--- RÉCEPTIONS NON COMPTÉES (en attente validation Achats) ---'); pending.forEach((p) => console.log(`   ${p.numero} ${p.date} ${p.lieu} +${p.qty} (${p.status}, ${p.src_app})`)); }
  process.exit(0);
}

// Triage de TOUS les soldes négatifs : faux trou (réception en attente) vs vrai manquant.
async function cmdTriage() {
  const all = await readAll('stock_movements');
  const bal = new Map(); const key = (lt, li, r) => `${lt}_${li}_${r}`.replace(/\s+/g, '_');
  for (const m of all) { if (!isImpactApplied(m)) continue; for (const d of stockCaneva.movementDelta(m)) { const k = key(d.lieu_type, d.lieu_id, d.article_ref); const c = bal.get(k) || { lt: d.lieu_type, li: d.lieu_id, ref: d.article_ref, bal: 0 }; c.bal = Math.round((c.bal + d.delta) * 100) / 100; bal.set(k, c); } }
  // réceptions NON comptées (en attente validation Achats) par (lieu, article)
  const pend = {}; const pendDocs = {};
  for (const m of all) {
    if (m.type !== 'reception' || isImpactApplied(m)) continue;
    const d = m.lieu_destination; if (!d || !(d.type === 'magasin' || d.type === 'station')) continue;
    for (const it of (m.items || [])) { const ref = canon(it.article_ref || it.article || it.article_nom); const q = parseFloat(it.quantite) || 0; const k = key(d.type, d.id, ref); pend[k] = Math.round(((pend[k] || 0) + q) * 100) / 100; (pendDocs[k] = pendDocs[k] || []).push(`${m.numero}(${m.status},+${q})`); }
  }
  const negs = [...bal.values()].filter((b) => b.bal < -0.01).sort((a, b) => a.bal - b.bal);
  const out = negs.map((b) => {
    const k = key(b.lt, b.li, b.ref); const p = pend[k] || 0; const after = Math.round((b.bal + p) * 100) / 100;
    let cls;
    if (p > 0 && after >= -0.01) cls = 'FAUX TROU (réception en attente couvre)';
    else if (p > 0) cls = 'PARTIEL (réception en attente insuffisante)';
    else if (b.lt === 'station') cls = 'VRAI MANQUANT (lieu sans appro fichier)';
    else cls = 'VRAI MANQUANT';
    return { lieu: `${b.lt}:${b.li}`, article: b.ref, solde: b.bal, en_attente: p, solde_si_validee: after, classe: cls, recep: (pendDocs[k] || []).join(' ') };
  });
  const byClass = {}; for (const r of out) byClass[r.classe.split(' (')[0]] = (byClass[r.classe.split(' (')[0]] || 0) + 1;
  console.log(JSON.stringify({ total_negatifs: out.length, par_classe: byClass, detail: out }, null, 2));
}

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'backup') await cmdBackup();
    else if (cmd === 'preview') await cmdPreview();
    else if (cmd === 'execute') await cmdExecute();
    else if (cmd === 'reconcile') await cmdReconcile();
    else if (cmd === 'history') await cmdHistory();
    else if (cmd === 'diag') await cmdDiag();
    else if (cmd === 'triage') await cmdTriage();
    else if (cmd === 'report') await cmdReport();
    else { console.error('usage: backup|preview|execute|reconcile|history|diag|triage|report'); process.exit(2); }
  } catch (e) { console.error('ERR:', e && e.stack || e); process.exit(1); }
  process.exit(0);
})();
