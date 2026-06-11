'use strict';
/**
 * Nettoyage CIBLÉ des équipes orphelines (préfixe non-2-lettres, ex. "01".."08")
 * dans rh_config/transport_primes. Conserve TOUTES les vraies équipes (codes 2 lettres)
 * + BGF, avec leur historique intact.
 *
 * Usage :
 *   node scripts/cleanup-orphan-equipes.js --dry-run   (affiche, n'écrit pas)
 *   node scripts/cleanup-orphan-equipes.js             (écriture prod)
 *
 * Auth : Application Default Credentials.
 */
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const DRY = process.argv.includes('--dry-run');
const PROJECT = 'berrygood-farms-dashboard';
const isValid = (p) => p === 'BGF' || /^[A-Z]{2}$/.test(String(p || '').toUpperCase());

(async () => {
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const ref = db.collection('rh_config').doc('transport_primes');
  const snap = await ref.get();
  if (!snap.exists || !Array.isArray(snap.data().equipes)) {
    console.error('Doc rh_config/transport_primes introuvable ou sans tableau equipes.');
    process.exit(1);
  }
  const equipes = snap.data().equipes;
  const cur = (t) => (t.history && t.history.length) ? t.history[t.history.length - 1].coutParOuvrier : '-';

  const toRemove = equipes.filter(e => !isValid(e.prefix));
  const kept = equipes.filter(e => isValid(e.prefix));

  console.log(`Total actuel : ${equipes.length} équipes.`);
  console.log(`\n--- À SUPPRIMER (préfixe non-2-lettres, orphelins) : ${toRemove.length} ---`);
  toRemove.forEach(t => console.log(`  ${String(t.prefix).padEnd(4)} | ${String(t.equipe || '').padEnd(20)} | cur:${cur(t)} | hist:${(t.history || []).length}`));
  console.log(`\n--- CONSERVÉES : ${kept.length} ---`);
  kept.forEach(t => console.log(`  ${String(t.prefix).padEnd(4)} | ${String(t.equipe || '').padEnd(20)} | cur:${cur(t)} | hist:${(t.history || []).length}`));

  if (!toRemove.length) { console.log('\nRien à supprimer.'); process.exit(0); }
  if (DRY) { console.log('\n[DRY-RUN] aucune écriture effectuée.'); process.exit(0); }
  await ref.set({ equipes: kept, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'cleanup-orphan-equipes' }, { merge: true });
  console.log(`\n✅ ${toRemove.length} équipe(s) orpheline(s) supprimée(s). ${kept.length} conservées.`);
  process.exit(0);
})().catch(e => { console.error('ERREUR:', e && e.message); process.exit(1); });
