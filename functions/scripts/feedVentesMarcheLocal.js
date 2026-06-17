'use strict';

/**
 * feedVentesMarcheLocal.js — Étape 3 du câblage « Caisse Marché Local
 * (compte client) » : FEED VENTES (BA -> caisse_transactions type='vente').
 *
 * Dry-run VALIDÉ par le DG (485 ventes, total 552 739,28 DH, Fruit congel @14
 * provisoire). WRITE Firestore APPROUVÉ pour cette étape précise.
 *
 * Ce script est IDEMPOTENT et DRY-RUN par défaut (--apply pour écrire) :
 *
 *  1) BACKUP (toujours, même en dry-run, AVANT tout write) :
 *     - caisse_transactions type='vente' source='ba_marche_local' existantes
 *     - les 5 caisse_definitions compte_client_* (soldes)
 *     -> docs/BACKUP-ventes-<stamp>.json
 *
 *  2) DÉRIVATION (SOURCE UNIQUE = module pur étape 1) :
 *     - lire pfq_interne, filtrer typeVente === 'Marché Local'
 *     - R1 : REJETER (ne pas agréger) les lignes au client vide/null (compté + loggé)
 *     - recettes = M.deriveRecettes(lignesRetenues)  (attendu : 485)
 *     - OVERRIDE FRUIT CONGEL (au niveau VENTE, jamais pfq_interne) :
 *       recette client_id==='fruit_congel_du_nord' & montant===0
 *       -> montant = round2(kg*14), prix_applique:14, prix_provisoire:true,
 *          motif:'valorisation provisoire — à confirmer'
 *
 *  3) ÉCRITURE caisse_transactions (idempotent par doc id) :
 *     docId = `vente__${idempotency_key}` où idempotency_key = `${numBA}__${client_id}`.
 *     (Choix documenté : préfixe `vente__` pour réserver l'espace de noms aux
 *      ventes et éviter toute collision avec d'éventuels encaissements futurs
 *      qui partageraient une clé métier ; l'idempotency_key seule reste unique
 *      par (BA, client), le préfixe ne fait que namespacer.)
 *     Idempotence : doc existant & montant identique -> SKIP (pas de version++).
 *     Montant différent -> nouvelle version (version++, remplace_version).
 *     En première passe tout est neuf. Batch par 400.
 *
 *  4) RECALCUL solde_actuel par caisse compte_client_* :
 *     solde = Σ(vente) − Σ(encaissement). 0 encaissement à ce stade -> solde = Σ vente.
 *     ⚠️ NE LIT/ÉCRIT QUE type='vente'. Aucun encaissement. Aucune autre collection.
 *
 *  5) VÉRIF POST-WRITE (read-back) : 485 ventes ; soldes attendus par client ;
 *     total 552 739,28 ; Fruit congel flag prix_provisoire:true.
 *     Tout écart -> ERREUR, STOP.
 *
 * GARDE-FOUS : ne touche AUCUN encaissement, AUCUNE autre collection, ni
 * caisse_marche_local_f1/f5. Aucun delete.
 *
 * Usage :
 *   node functions/scripts/feedVentesMarcheLocal.js --stamp etape3
 *        DRY-RUN par défaut : n'écrit RIEN en Firestore (mais écrit le backup).
 *   node functions/scripts/feedVentesMarcheLocal.js --stamp etape3 --apply
 *        Écrit en Firestore (write APPROUVÉ pour cette étape).
 *
 * Auth : ADC (require absolu du firebase-admin du checkout principal).
 */

const path = require('path');
const fs = require('fs');

const admin = require('/Users/omarmaaouni/Desktop/DESKTOP (OLD)/berrygood-dashboard/functions/node_modules/firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'berrygood-farms-dashboard',
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

// SOURCE UNIQUE de la dérivation : module pur étape 1.
const M = require('../lib/marcheLocalCaisse/index.js');

const TYPE_VENTE_ML = 'Marché Local';
const SOURCE = 'ba_marche_local';
const FRUIT_CONGEL_ID = 'fruit_congel_du_nord';
const PRIX_FRUIT_CONGEL_PROVISOIRE = 14;
const MOTIF_FRUIT_CONGEL = 'valorisation provisoire — à confirmer';

// Invariants métier (dry-run validé DG).
const EXPECTED_VENTES = 485;
const EXPECTED_TOTAL = 552739.28;
const EXPECTED_SOLDES = {
  mustapha_chafik_a: 287694.85,
  mr_monaim_local: 195089.43,
  iraqi_mohamed: 58104,
  hamdouch_omar: 4410,
  fruit_congel_du_nord: 7441,
};

const APPLY = process.argv.includes('--apply');
const stampIdx = process.argv.indexOf('--stamp');
const STAMP = stampIdx !== -1 && process.argv[stampIdx + 1] ? process.argv[stampIdx + 1] : 'etape3';

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');
const BACKUP_PATH = path.join(DOCS_DIR, `BACKUP-ventes-${STAMP}.json`);

const feedBy = { profileId: 'system', name: 'feed-ventes-etape3' };

/** docId stable pour une recette (vente). */
function venteDocId(idempotencyKey) {
  return `vente__${idempotencyKey}`;
}

async function backup() {
  console.log(`\n[BACKUP] -> ${BACKUP_PATH}`);
  const ventesSnap = await db
    .collection('caisse_transactions')
    .where('source', '==', SOURCE)
    .where('type', '==', 'vente')
    .get();
  const caissesSnap = await db
    .collection('caisse_definitions')
    .where('kind', '==', 'compte_client_marche_local')
    .get();

  const payload = {
    stamp: STAMP,
    exported_at: new Date().toISOString(),
    project: 'berrygood-farms-dashboard',
    caisse_transactions_ventes: ventesSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
    caisse_definitions_compte_client: caissesSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
  };

  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `  sauvegardé : ${payload.caisse_transactions_ventes.length} ventes existantes + ` +
      `${payload.caisse_definitions_compte_client.length} caisses compte_client`
  );
}

/** Lit pfq_interne, filtre ML, rejette client vide, mappe vers MlLine du module. */
async function readMlLines() {
  const snap = await db.collection('pfq_interne').get();
  const retained = [];
  let mlTotal = 0;
  let rejected = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.typeVente !== TYPE_VENTE_ML) continue;
    mlTotal += 1;

    // R1 : rejeter les lignes au client vide/null.
    const client = d.client == null ? '' : String(d.client).trim();
    if (!client) {
      rejected += 1;
      continue;
    }

    retained.push({
      bonApport: d.bonApport,
      client,
      blocFerme: d.blocFerme,
      poidsLot: d.poidsLot,
      prixDH: d.prixDH,
      totalDH: d.totalDH,
      typeVente: d.typeVente,
    });
  }

  console.log(`\n[SOURCE] pfq_interne: ${snap.size} docs`);
  console.log(`  lignes Marché Local      : ${mlTotal}`);
  console.log(`  R1 rejets (client vide)  : ${rejected}`);
  console.log(`  lignes retenues          : ${retained.length}`);
  return { retained, mlTotal, rejected };
}

/** Applique l'override Fruit congel sur les recettes dérivées. Mute en place. */
function applyFruitCongelOverride(recettes) {
  let count = 0;
  let kgTotal = 0;
  let montantTotal = 0;
  for (const rec of recettes) {
    if (rec.client_id !== FRUIT_CONGEL_ID) continue;
    if (rec.montant !== 0) continue;
    const montant = M.round2((Number(rec.kg) || 0) * PRIX_FRUIT_CONGEL_PROVISOIRE);
    rec.montant = montant;
    rec.prix_applique = PRIX_FRUIT_CONGEL_PROVISOIRE;
    rec.prix_provisoire = true;
    rec.motif = MOTIF_FRUIT_CONGEL;
    count += 1;
    kgTotal = M.round2(kgTotal + (Number(rec.kg) || 0));
    montantTotal = M.round2(montantTotal + montant);
  }
  console.log(
    `\n[OVERRIDE Fruit congel] ${count} vente(s), ${kgTotal} kg @${PRIX_FRUIT_CONGEL_PROVISOIRE} = ${montantTotal} DH (prix_provisoire)`
  );
  return { count, kgTotal, montantTotal };
}

/** Construit le doc caisse_transactions à partir d'une recette. */
function buildVenteDoc(rec) {
  const docData = {
    caisse_id: `compte_client_${rec.client_id}`,
    type: 'vente',
    source: SOURCE,
    client_id: rec.client_id,
    source_ba: rec.source_ba,
    idempotency_key: rec.idempotency_key,
    montant: rec.montant,
    kg: rec.kg,
    fermes: rec.fermes,
    nb_lignes: rec.nb_lignes,
    status: 'valide',
    version: 1,
    remplace_version: null,
    created_by: feedBy,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (rec.prix_provisoire) {
    docData.prix_applique = rec.prix_applique;
    docData.prix_provisoire = true;
    docData.motif = rec.motif;
  }
  return docData;
}

/** Écrit les ventes de manière idempotente. Renvoie un rapport. */
async function writeVentes(recettes) {
  console.log(`\n[APPLY] Écriture caisse_transactions (ventes)…`);
  let created = 0;
  let skipped = 0;
  let versioned = 0;

  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const rec of recettes) {
    const docId = venteDocId(rec.idempotency_key);
    const ref = db.collection('caisse_transactions').doc(docId);
    const existing = await ref.get();

    if (!existing.exists) {
      batch.set(ref, buildVenteDoc(rec));
      ops += 1;
      created += 1;
      if (ops >= 400) await flush();
      continue;
    }

    const ex = existing.data();
    if (Number(ex.montant) === Number(rec.montant)) {
      skipped += 1; // idempotent : même montant -> aucune modification.
      continue;
    }

    // Montant différent -> nouvelle version (remplace l'ancienne valeur).
    const nextVersion = (Number(ex.version) || 1) + 1;
    const updated = buildVenteDoc(rec);
    updated.version = nextVersion;
    updated.remplace_version = Number(ex.version) || 1;
    updated.created_at = ex.created_at || FieldValue.serverTimestamp();
    batch.set(ref, updated, { merge: false });
    ops += 1;
    versioned += 1;
    if (ops >= 400) await flush();
  }
  await flush();

  console.log(`  ventes : ${created} créées, ${skipped} skippées (idempotent), ${versioned} re-versionnées`);
  return { created, skipped, versioned };
}

/** Recalcule et écrit solde_actuel = Σ(vente) par caisse compte_client_*. */
async function recomputeSoldes() {
  console.log(`\n[SOLDES] Recalcul solde_actuel = Σ(vente) par caisse compte_client_*`);
  // ⚠️ NE LIT QUE type='vente'. Aucun encaissement.
  const ventesSnap = await db
    .collection('caisse_transactions')
    .where('source', '==', SOURCE)
    .where('type', '==', 'vente')
    .get();

  const sumByClient = new Map();
  for (const doc of ventesSnap.docs) {
    const d = doc.data();
    const prev = sumByClient.get(d.client_id) || 0;
    sumByClient.set(d.client_id, M.round2(prev + (Number(d.montant) || 0)));
  }

  const caissesSnap = await db
    .collection('caisse_definitions')
    .where('kind', '==', 'compte_client_marche_local')
    .get();

  let batch = db.batch();
  let ops = 0;
  for (const doc of caissesSnap.docs) {
    const clientId = doc.data().client_id;
    const solde = M.round2(sumByClient.get(clientId) || 0);
    console.log(`  ${doc.id} (client=${clientId}) -> solde_actuel = ${solde}`);
    if (APPLY) {
      batch.set(
        doc.ref,
        { solde_actuel: solde, updated_at: FieldValue.serverTimestamp() },
        { merge: true }
      );
      ops += 1;
    }
  }
  if (APPLY && ops > 0) await batch.commit();
  return sumByClient;
}

async function verifyPostWrite() {
  console.log(`\n[VÉRIF POST-WRITE]`);
  const ventesSnap = await db
    .collection('caisse_transactions')
    .where('source', '==', SOURCE)
    .where('type', '==', 'vente')
    .get();

  const nbVentes = ventesSnap.size;
  const sumByClient = new Map();
  let total = 0;
  let fruitCongelProvisoire = 0;
  let fruitCongelDocs = 0;
  for (const doc of ventesSnap.docs) {
    const d = doc.data();
    sumByClient.set(d.client_id, M.round2((sumByClient.get(d.client_id) || 0) + (Number(d.montant) || 0)));
    total = M.round2(total + (Number(d.montant) || 0));
    if (d.client_id === FRUIT_CONGEL_ID) {
      fruitCongelDocs += 1;
      if (d.prix_provisoire === true) fruitCongelProvisoire += 1;
    }
  }

  console.log(`  ventes écrites : ${nbVentes} (attendu ${EXPECTED_VENTES})`);
  console.log(`  total          : ${total} (attendu ${EXPECTED_TOTAL})`);
  console.log(`  soldes par client :`);
  for (const [clientId, expected] of Object.entries(EXPECTED_SOLDES)) {
    const got = M.round2(sumByClient.get(clientId) || 0);
    const ok = got === expected ? 'OK' : 'DIVERGENT';
    console.log(`    ${clientId.padEnd(22)} ${String(got).padStart(12)} (attendu ${expected}) [${ok}]`);
  }
  console.log(`  Fruit congel : ${fruitCongelDocs} ventes, ${fruitCongelProvisoire} avec prix_provisoire:true`);

  // Invariants -> STOP si écart.
  const problems = [];
  if (nbVentes !== EXPECTED_VENTES) problems.push(`nb ventes=${nbVentes} (attendu ${EXPECTED_VENTES})`);
  if (total !== EXPECTED_TOTAL) problems.push(`total=${total} (attendu ${EXPECTED_TOTAL})`);
  for (const [clientId, expected] of Object.entries(EXPECTED_SOLDES)) {
    const got = M.round2(sumByClient.get(clientId) || 0);
    if (got !== expected) problems.push(`solde ${clientId}=${got} (attendu ${expected})`);
  }
  if (fruitCongelDocs > 0 && fruitCongelProvisoire !== fruitCongelDocs) {
    problems.push(`Fruit congel prix_provisoire=${fruitCongelProvisoire}/${fruitCongelDocs}`);
  }
  if (problems.length > 0) {
    throw new Error(`ERREUR vérif post-write -> ${problems.join(' ; ')}. STOP.`);
  }
  console.log(`  OK : tous les invariants vérifiés.`);
}

/** Vérification "à blanc" des invariants dérivés (sans read-back DB), pour le dry-run. */
function verifyDerivation(recettes) {
  console.log(`\n[VÉRIF DÉRIVATION]`);
  const nb = recettes.length;
  const total = M.grandTotal(recettes);
  const sumByClient = new Map();
  for (const r of recettes) {
    sumByClient.set(r.client_id, M.round2((sumByClient.get(r.client_id) || 0) + (Number(r.montant) || 0)));
  }
  console.log(`  recettes dérivées : ${nb} (attendu ${EXPECTED_VENTES})`);
  console.log(`  total dérivé      : ${total} (attendu ${EXPECTED_TOTAL})`);
  for (const [clientId, expected] of Object.entries(EXPECTED_SOLDES)) {
    const got = M.round2(sumByClient.get(clientId) || 0);
    const ok = got === expected ? 'OK' : 'DIVERGENT';
    console.log(`    ${clientId.padEnd(22)} ${String(got).padStart(12)} (attendu ${expected}) [${ok}]`);
  }

  const problems = [];
  if (nb !== EXPECTED_VENTES) problems.push(`nb=${nb} (attendu ${EXPECTED_VENTES})`);
  if (total !== EXPECTED_TOTAL) problems.push(`total=${total} (attendu ${EXPECTED_TOTAL})`);
  for (const [clientId, expected] of Object.entries(EXPECTED_SOLDES)) {
    const got = M.round2(sumByClient.get(clientId) || 0);
    if (got !== expected) problems.push(`solde ${clientId}=${got} (attendu ${expected})`);
  }
  if (problems.length > 0) {
    throw new Error(`STOP : dérivation hors invariants -> ${problems.join(' ; ')}. Aucun write.`);
  }
  console.log(`  OK : dérivation conforme aux invariants validés DG.`);
}

async function main() {
  console.log(`=== feed ventes Marché Local (étape 3) ===`);
  console.log(`Mode    : ${APPLY ? 'APPLY (write Firestore)' : 'DRY-RUN (aucun write Firestore)'}`);
  console.log(`Stamp   : ${STAMP}`);

  // 1) BACKUP (toujours, avant tout write).
  await backup();

  // 2) Dérivation + override Fruit congel.
  const { retained } = await readMlLines();
  const recettes = M.deriveRecettes(retained);
  applyFruitCongelOverride(recettes);

  // Vérif dérivation (invariants) AVANT d'écrire quoi que ce soit.
  verifyDerivation(recettes);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Aucune écriture Firestore. Backup écrit. Passe --apply pour écrire.`);
    return;
  }

  // 3) Écriture idempotente des ventes.
  await writeVentes(recettes);

  // 4) Recalcul des soldes.
  await recomputeSoldes();

  // 5) Vérif post-write (read-back).
  await verifyPostWrite();

  console.log(`\nTerminé.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n${err.message || err}`);
    process.exit(1);
  });
