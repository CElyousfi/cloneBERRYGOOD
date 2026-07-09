'use strict';

/**
 * verify-referentiel-iso.js — GATE MIGRATION 100 % ISO
 * (docs/spec-referentiel-parcelle-ferme.md §7).
 *
 * Compare, ligne par ligne, sur TOUTES les lignes du mirror `sql_mirror_pointage`
 * (juillet + historique dispo) :
 *   - ferme_actuel  : deriveFerme codé en dur ACTUEL (legacy, version sécurité
 *                     pointageService avec BAHIA prioritaire) ;
 *   - ferme_nouveau : la RÈGLE du module pur `resolveFermeFromParcelle`
 *                     (mappée INCONNU → 'Autre' pour comparer au contrat legacy).
 *
 * Sort le compte total, le % d'égalité, et TOUT diff (groupé par
 * ref/label/variété). Objectif : 100 % sur les parcelles actives.
 * Les écarts LÉGITIMES documentés (Autre_legacy → Avocatier_nouveau via variété
 * avocat) sont comptés à part et n'invalident pas le gate.
 *
 * Lancement :
 *   GOOGLE_CLOUD_PROJECT=berrygood-farms-dashboard \
 *   node scripts/verify-referentiel-iso.js
 *
 * (ADC : credentials par défaut, projectId berrygood-farms-dashboard.)
 */

const path = require('path');

// firebase-admin depuis le node_modules du bundle déployé (cf. consigne archi).
let admin;
try {
  admin = require('/private/tmp/deploy-etape0/functions/node_modules/firebase-admin');
} catch (_) {
  admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
}

const { resolveFermeFromParcelle } = require(path.join(
  __dirname, '..', 'functions', 'lib', 'pointage', 'refParcelleFerme'
));

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'berrygood-farms-dashboard' });
}
const db = admin.firestore();

/** deriveFerme LEGACY (copie fidèle de pointageService.js — référence du gate). */
function deriveFermeLegacy(refParcelle, parcelleCulturale) {
  const ref = (refParcelle || '').trim();
  if (/bahia/i.test(ref) || /bahia/i.test(parcelleCulturale || '')) return 'BAHIA';
  if (ref) {
    if (ref.startsWith('F1') || ref === '0032' || ref === '0035' || ref === '0036') return 'F1';
    if (ref.startsWith('F5') || ref === '0037' || ref === '0038' || ref === '0039') return 'F5';
    if (ref.startsWith('F2') || ref.startsWith('F3') || ref.startsWith('F4') || ref.startsWith('F6') || ref === '0031' || ref === '0033') return 'Avocatier';
  }
  if (parcelleCulturale) {
    if (/F1/i.test(parcelleCulturale)) return 'F1';
    if (/F5/i.test(parcelleCulturale)) return 'F5';
    if (/avocat/i.test(parcelleCulturale)) return 'Avocatier';
    const sMatch = parcelleCulturale.match(/\bS(\d{1,2})\b/i);
    if (sMatch) {
      const sNum = parseInt(sMatch[1], 10);
      if (sNum >= 1 && sNum <= 7) return 'F1';
      if (sNum >= 8 && sNum <= 14) return 'F5';
    }
  }
  return 'Autre';
}

/** Règle nouvelle mappée sur le contrat legacy (INCONNU → 'Autre'). */
function fermeNouveau(row) {
  const { ferme } = resolveFermeFromParcelle({
    refParcelle: row.Ref_parcelle,
    label: row.Parcelle_Culturale,
    variete: row.Variete,
    idFermes: undefined, // le mirror ne porte pas IDFermes → non testé ici
  });
  return ferme === 'INCONNU' ? 'Autre' : ferme;
}

// Échantillon OFFLINE représentatif (mode --offline, sans credentials Firestore) :
// reprend les parcelles réelles documentées dans le spec (§1, §3) pour prouver
// la logique de comparaison quand l'ADC n'est pas dispo. NON exhaustif du mirror.
const OFFLINE_SAMPLE = [
  { Ref_parcelle: '0031', Parcelle_Culturale: 'AVOCAT HAAS', Variete: 'HAAS' },
  { Ref_parcelle: '0032', Parcelle_Culturale: 'F1 MARAVILLA', Variete: 'MARAVILLA' },
  { Ref_parcelle: '0033', Parcelle_Culturale: 'AVOCAT', Variete: 'HAAS' },
  { Ref_parcelle: '0035', Parcelle_Culturale: 'F1 S2', Variete: 'MARAVILLA' },
  { Ref_parcelle: '0036', Parcelle_Culturale: 'F1 S3', Variete: 'MARAVILLA' },
  { Ref_parcelle: '0037', Parcelle_Culturale: 'F5 CORINA S8-3', Variete: 'CORINA' },
  { Ref_parcelle: '0038', Parcelle_Culturale: 'F5 BREEZE S8-2', Variete: 'BREEZE' },
  { Ref_parcelle: '0039', Parcelle_Culturale: 'F5 CASCADE S8-1', Variete: 'CASCADE' },
  { Ref_parcelle: '0040', Parcelle_Culturale: 'F1-S6.S7 MARAVILLA MOTTE', Variete: 'MARAVILLA' },
  { Ref_parcelle: '0041', Parcelle_Culturale: 'F5 YAZMIN MT', Variete: 'YAZMIN' },
  { Ref_parcelle: '0042', Parcelle_Culturale: 'F1- S5 MARAVILLA', Variete: 'MARAVILLA' },
  { Ref_parcelle: '0043', Parcelle_Culturale: 'F5- MYA S9', Variete: 'YAZMIN' },
  { Ref_parcelle: 'F2', Parcelle_Culturale: 'F2 - HAAS', Variete: 'HAAS' },
  { Ref_parcelle: 'F3', Parcelle_Culturale: 'F3 AVOCAT', Variete: 'HAAS' },
  { Ref_parcelle: 'F4', Parcelle_Culturale: 'F4 AVOCAT', Variete: 'HAAS' },
  { Ref_parcelle: 'F5', Parcelle_Culturale: 'F5 CORINA myrtille S8-3', Variete: 'CORINA' },
  { Ref_parcelle: 'F5', Parcelle_Culturale: 'AVOCAT F5', Variete: 'AVOCAT' }, // AVOCAT-F5 → F5 (§8.2)
  { Ref_parcelle: 'F6', Parcelle_Culturale: 'F6 AVOCAT', Variete: 'HAAS' },
  { Ref_parcelle: 'B6-AGRUMES', Parcelle_Culturale: 'B6-AGRUMES', Variete: 'AGRUMES' },
  { Ref_parcelle: 'B7-AVOCAT', Parcelle_Culturale: 'B7-AVOCAT', Variete: 'AVOCAT' },
  { Ref_parcelle: 'BAHIA-1', Parcelle_Culturale: 'EL BAHIA', Variete: '' },
];

async function loadRows() {
  if (process.argv.includes('--offline')) {
    console.log('[iso] MODE OFFLINE — échantillon spec (pas de lecture Firestore)');
    return [{ id: 'offline-sample', rows: OFFLINE_SAMPLE }];
  }
  console.log('[iso] lecture du mirror sql_mirror_pointage...');
  const snap = await db.collection('sql_mirror_pointage').get();
  console.log(`[iso] ${snap.size} docs journaliers`);
  const out = [];
  snap.forEach((doc) => out.push({ id: doc.id, rows: (doc.data() && doc.data().rows) || [] }));
  return out;
}

async function main() {
  const docs = await loadRows();

  let total = 0;
  let equal = 0;
  const hardDiffs = [];      // divergences NON expliquées (bloquantes)
  const legitDiffs = new Map(); // Autre_legacy → Avocatier_nouveau (rescue variété)

  for (const doc of docs) {
    for (const r of doc.rows) {
      total += 1;
      const legacy = deriveFermeLegacy(r.Ref_parcelle, r.Parcelle_Culturale);
      const next = fermeNouveau(r);
      if (legacy === next) { equal += 1; continue; }

      // Écart légitime documenté : legacy 'Autre' rescapé en Avocatier via variété.
      if (legacy === 'Autre' && next === 'Avocatier' && /haas|avocat/i.test(String(r.Variete || ''))) {
        const key = `${r.Ref_parcelle}|${r.Parcelle_Culturale}|${r.Variete}`;
        legitDiffs.set(key, (legitDiffs.get(key) || 0) + 1);
        continue;
      }

      hardDiffs.push({
        date: doc.id,
        ref: r.Ref_parcelle,
        label: r.Parcelle_Culturale,
        variete: r.Variete,
        legacy,
        next,
      });
    }
  }

  const pct = total ? ((equal / total) * 100) : 100;
  console.log('\n========== RÉSULTAT GATE ISO ==========');
  console.log(`Lignes comparées : ${total}`);
  console.log(`Égalités strictes : ${equal} (${pct.toFixed(4)} %)`);
  console.log(`Écarts LÉGITIMES (Autre→Avocatier via variété) : ${legitDiffs.size} parcelle(s) distinctes`);
  for (const [k, n] of legitDiffs) console.log(`   • ${k}  (${n} lignes)`);
  console.log(`Écarts BLOQUANTS (non expliqués) : ${hardDiffs.length}`);

  if (hardDiffs.length) {
    console.log('\n--- DÉTAIL DES ÉCARTS BLOQUANTS (uniques) ---');
    const uniq = new Map();
    for (const d of hardDiffs) {
      const key = `${d.ref}|${d.label}|${d.variete}|${d.legacy}→${d.next}`;
      if (!uniq.has(key)) uniq.set(key, { ...d, count: 0 });
      uniq.get(key).count += 1;
    }
    for (const d of uniq.values()) {
      console.log(`   ✗ ref=${d.ref} label="${d.label}" var=${d.variete} : legacy=${d.legacy} nouveau=${d.next} (${d.count} lignes)`);
    }
  }

  const gate100 = hardDiffs.length === 0;
  console.log('\n========================================');
  console.log(gate100
    ? '✅ GATE ISO PASSÉ : 100 % iso (hors écarts légitimes documentés).'
    : `🔴 GATE ISO ÉCHOUÉ : ${hardDiffs.length} écart(s) bloquant(s) — corriger la RÈGLE.`);
  process.exit(gate100 ? 0 : 1);
}

main().catch((e) => {
  console.error('[iso] erreur:', e);
  process.exit(2);
});
