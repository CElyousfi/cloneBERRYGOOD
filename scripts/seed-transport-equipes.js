'use strict';
/**
 * Import du référentiel des équipes transport depuis l'Excel
 *   "Informations sur les véhicules de transport des ouvriers.xlsx" (racine)
 * vers Firestore rh_config/transport_primes (source de vérité des primes).
 *
 * - Préfixe réduit à 2 lettres (HAFI→HA, MMG→MM).
 * - Merge : équipe existante → MAJ nom/caporal, on CONSERVE l'historique des primes
 *   (ne pas écraser AY=50, HA=40, CA=50… déjà saisis).
 * - Équipe nouvelle → ajout avec prime initiale de l'Excel (effectiveFrom = quinzaine baseline).
 * - Ajout équipe BGF (fourre-tout matricules sans préfixe-lettre), prime 0.
 *
 * Usage :
 *   node scripts/seed-transport-equipes.js --dry-run
 *   node scripts/seed-transport-equipes.js            (écriture prod)
 *   BASELINE_QUINZAINE="Quinzaine 23" node scripts/seed-transport-equipes.js
 *
 * Auth : Application Default Credentials (gcloud auth application-default login déjà fait).
 */
const path = require('path');
const XLSX = require('xlsx');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const DRY = process.argv.includes('--dry-run');
const PROJECT = 'berrygood-farms-dashboard';
const BASELINE = process.env.BASELINE_QUINZAINE || 'Quinzaine 23';
const EXCEL = path.join(__dirname, '..', 'Informations sur les véhicules de transport des ouvriers.xlsx');

function prefix2(raw) {
  const m = String(raw || '').toUpperCase().trim();
  if (m.startsWith('HAFI')) return 'HA';
  return m.substring(0, 2);
}

(async () => {
  // 1. Parse Excel
  const wb = XLSX.readFile(EXCEL);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).slice(3); // sauter titre + en-têtes
  const ref = [];
  for (const r of rows) {
    const pref = String(r[0] || '').trim();
    if (!pref) continue;
    ref.push({ prefix: prefix2(pref), equipe: String(r[1] || '').trim(), caporal: String(r[2] || '').trim(), prime: Number(r[3]) || 0 });
  }
  ref.push({ prefix: 'BGF', equipe: 'BGF', caporal: '', prime: 0 });
  console.log(`Référentiel Excel : ${ref.length} équipes (dont BGF).`);

  // 2. Lire rh_config/transport_primes
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const docRef = db.collection('rh_config').doc('transport_primes');
  const snap = await docRef.get();
  const equipes = (snap.exists && Array.isArray(snap.data().equipes)) ? snap.data().equipes.map(e => ({ ...e })) : [];
  const byPrefix = {};
  equipes.forEach(e => { if (e && e.prefix) byPrefix[e.prefix] = e; });

  // 3. Merge
  const now = new Date().toISOString();
  let added = 0, updated = 0;
  for (const e of ref) {
    const ex = byPrefix[e.prefix];
    if (ex) {
      if (e.equipe) ex.equipe = e.equipe;
      if (e.caporal) ex.caporal = e.caporal;
      if (!Array.isArray(ex.history)) ex.history = [];
      updated++;
    } else {
      byPrefix[e.prefix] = {
        prefix: e.prefix, equipe: e.equipe, caporal: e.caporal, ferme: '',
        history: [{ effectiveFrom: BASELINE, coutParOuvrier: e.prime, updatedAt: now, updatedBy: 'import-excel' }],
      };
      added++;
    }
  }
  // Supprimer les équipes seed/test à préfixe non-2-lettres (01, 02…) — leurs ouvriers (matricules
  // numériques) sont de toute façon routés vers BGF. On garde uniquement les codes à 2 lettres + BGF.
  let removed = 0;
  Object.keys(byPrefix).forEach(p => {
    if (p !== 'BGF' && !/^[A-Z]{2}$/.test(p)) { delete byPrefix[p]; removed++; }
  });
  if (removed) console.log(`Équipes legacy supprimées (préfixe non-2-lettres, ex. 01/02) : ${removed}`);

  const nextEquipes = Object.values(byPrefix)
    .sort((a, b) => (a.prefix === 'BGF' ? 1 : b.prefix === 'BGF' ? -1 : String(a.prefix).localeCompare(String(b.prefix))));

  console.log(`Existantes MAJ (nom/caporal, historique conservé) : ${updated} · Nouvelles ajoutées : ${added} · Total : ${nextEquipes.length}\n`);
  nextEquipes.forEach(t => {
    const cur = (t.history && t.history.length) ? t.history[t.history.length - 1].coutParOuvrier : '-';
    console.log(`  ${String(t.prefix).padEnd(4)} | ${String(t.equipe || '').padEnd(22)} | ${String(t.caporal || '').padEnd(24)} | hist:${(t.history || []).length} | cur:${cur}`);
  });

  if (DRY) { console.log('\n[DRY-RUN] aucune écriture effectuée.'); process.exit(0); }
  await docRef.set({ equipes: nextEquipes, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'import-excel' }, { merge: false });
  console.log('\n✅ Écrit dans rh_config/transport_primes');
  process.exit(0);
})().catch(e => { console.error('ERREUR:', e && e.message); process.exit(1); });
