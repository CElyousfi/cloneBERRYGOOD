'use strict';

/**
 * seedComptesClientsMarcheLocal.js — Étape 2 du câblage « Caisse Marché Local
 * (compte client) ».
 *
 * Dry-run VALIDÉ par le DG ("GO"). Ce script, IDEMPOTENT :
 *   1) BACKUP (toujours, même en dry-run) : clients_marche_local + les
 *      caisse_definitions kind='compte_client_marche_local' -> docs/BACKUP-comptes-clients-<stamp>.json
 *   2) SOURCE DE VÉRITÉ = clients réels des bons d'apport : pfq_interne filtré
 *      typeVente==='Marché Local' + client non vide -> ensemble des slugs réels.
 *      Invariant : EXACTEMENT 5 slugs attendus. Sinon STOP (aucun write).
 *   3) DÉDOUBLONNAGE clients_marche_local (ARCHIVE, jamais delete) :
 *      garde le doc le plus ancien (createdAt asc) de chaque slug RÉEL (+ normalise
 *      client_id), archive tous les autres (doublons + slugs non réels).
 *   4) CRÉATION des 5 caisse_definitions compte_client_marche_local (idempotent :
 *      si l'id existe déjà -> SKIP, jamais d'écrasement). solde_actuel reste 0.
 *   5) VÉRIF POST-WRITE (en --apply) : 5 caisses actives, 5 clients non archivés,
 *      9 archivés.
 *
 * Usage :
 *   node functions/scripts/seedComptesClientsMarcheLocal.js --stamp etape2
 *        DRY-RUN par défaut : n'écrit RIEN en Firestore (mais écrit le backup).
 *   node functions/scripts/seedComptesClientsMarcheLocal.js --stamp etape2 --apply
 *        Écrit en Firestore (write APPROUVÉ pour cette étape précise).
 *
 * GARDE-FOUS : n'écrit RIEN dans caisse_transactions (ventes/encaissements =
 * étapes 3-4). Ne touche PAS caisse_marche_local_f1/f5. Aucun delete nulle part.
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

// SOURCE UNIQUE du slug : module pur étape 1.
const { slugifyClient } = require('../lib/marcheLocalCaisse/index.js');

const TYPE_VENTE_ML = 'Marché Local';
const KIND_COMPTE = 'compte_client_marche_local';
const FERMES_OBSERVEES = ['F1', 'F5'];

// Invariant métier : les 5 clients réels (slugs) issus des BA Marché Local.
const EXPECTED_SLUGS = [
  'mustapha_chafik_a',
  'mr_monaim_local',
  'hamdouch_omar',
  'iraqi_mohamed',
  'fruit_congel_du_nord',
];

const APPLY = process.argv.includes('--apply');
const stampIdx = process.argv.indexOf('--stamp');
const STAMP = stampIdx !== -1 && process.argv[stampIdx + 1] ? process.argv[stampIdx + 1] : 'etape2';

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');
const BACKUP_PATH = path.join(DOCS_DIR, `BACKUP-comptes-clients-${STAMP}.json`);

const seedBy = { profileId: 'system', name: 'seed-etape2' };

/** Normalise createdAt en millis pour le tri (number, ISO string, Firestore Timestamp, ou absent). */
function createdAtMillis(value) {
  if (value == null) return Number.POSITIVE_INFINITY; // sans date -> considéré le plus récent (jamais "le plus ancien")
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value._seconds != null) return value._seconds * 1000;
  return Number.POSITIVE_INFINITY;
}

async function backup() {
  console.log(`\n[BACKUP] -> ${BACKUP_PATH}`);
  const clientsSnap = await db.collection('clients_marche_local').get();
  const caissesSnap = await db
    .collection('caisse_definitions')
    .where('kind', '==', KIND_COMPTE)
    .get();

  const payload = {
    stamp: STAMP,
    exported_at: new Date().toISOString(),
    project: 'berrygood-farms-dashboard',
    clients_marche_local: clientsSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
    caisse_definitions_compte_client: caissesSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
  };

  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `  sauvegardé : ${payload.clients_marche_local.length} clients_marche_local + ${payload.caisse_definitions_compte_client.length} caisses compte_client`
  );
  return { clientsSnap, caissesSnap };
}

async function realSlugsFromBA() {
  const snap = await db.collection('pfq_interne').get();
  const slugSet = new Set();
  let mlLines = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.typeVente !== TYPE_VENTE_ML) continue;
    const client = (d.client == null ? '' : String(d.client)).trim();
    if (!client) continue;
    mlLines += 1;
    slugSet.add(slugifyClient(client));
  }
  console.log(`\n[SOURCE BA] pfq_interne: ${snap.size} docs, ${mlLines} lignes Marché Local avec client`);
  return { slugs: [...slugSet].sort(), mlLines };
}

function planDedup(clientsSnap, realSlugs) {
  // Regroupe les docs clients par slug.
  const bySlug = new Map();
  for (const doc of clientsSnap.docs) {
    const data = doc.data();
    const slug = slugifyClient(data.nom);
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({ id: doc.id, data });
  }

  const keep = []; // { id, slug, nom, needsClientId }
  const archive = []; // { id, slug, nom, reason }

  for (const slug of realSlugs) {
    const docs = (bySlug.get(slug) || []).slice();
    if (docs.length === 0) continue;
    docs.sort((a, b) => createdAtMillis(a.data.createdAt) - createdAtMillis(b.data.createdAt));
    const kept = docs[0];
    keep.push({
      id: kept.id,
      slug,
      nom: kept.data.nom,
      needsClientId: kept.data.client_id !== slug,
    });
    for (const dup of docs.slice(1)) {
      archive.push({ id: dup.id, slug, nom: dup.data.nom, reason: 'doublon' });
    }
  }

  const realSet = new Set(realSlugs);
  for (const [slug, docs] of bySlug.entries()) {
    if (realSet.has(slug)) continue; // déjà traité ci-dessus
    for (const d of docs) {
      archive.push({ id: d.id, slug, nom: d.data.nom, reason: 'sans_ba_non_reel' });
    }
  }

  // Ne pas réarchiver un doc déjà archivé : log mais on laisse l'update idempotent (mêmes champs).
  return { keep, archive };
}

function planCaisses(keep) {
  // 1 caisse par slug réel, nom canonique = nom du doc gardé.
  const bySlug = new Map();
  for (const k of keep) bySlug.set(k.slug, k.nom);
  const plan = [];
  for (const slug of EXPECTED_SLUGS) {
    const nomCanonique = bySlug.get(slug);
    plan.push({
      id: `compte_client_${slug}`,
      slug,
      client_nom_canonique: nomCanonique || slug,
    });
  }
  return plan;
}

function printPlan(keep, archive, caisses) {
  console.log(`\n===== PLAN =====`);
  console.log(`\nKEEP (${keep.length}) :`);
  for (const k of keep) {
    console.log(`  - ${k.id}  slug=${k.slug}  nom="${k.nom}"${k.needsClientId ? '  [+client_id]' : ''}`);
  }
  console.log(`\nARCHIVE (${archive.length}) :`);
  for (const a of archive) {
    console.log(`  - ${a.id}  slug=${a.slug}  nom="${a.nom}"  reason=${a.reason}`);
  }
  console.log(`\nCREATE caisses (${caisses.length}) :`);
  for (const c of caisses) {
    console.log(`  - ${c.id}  client_id=${c.slug}  nom_canonique="${c.client_nom_canonique}"`);
  }
}

async function applyWrites(keep, archive, caisses) {
  console.log(`\n[APPLY] Écriture Firestore…`);

  // 3) Dédoublonnage : normalisation des gardés + archivage des autres.
  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  let normalized = 0;
  for (const k of keep) {
    if (k.needsClientId) {
      batch.set(
        db.collection('clients_marche_local').doc(k.id),
        { client_id: k.slug },
        { merge: true }
      );
      ops += 1;
      normalized += 1;
      if (ops >= 400) await flush();
    }
  }

  for (const a of archive) {
    batch.set(
      db.collection('clients_marche_local').doc(a.id),
      {
        archived: true,
        archived_reason: a.reason,
        archived_at: FieldValue.serverTimestamp(),
        archived_by: seedBy,
      },
      { merge: true }
    );
    ops += 1;
    if (ops >= 400) await flush();
  }
  await flush();
  console.log(`  clients_marche_local : ${normalized} normalisés (client_id), ${archive.length} archivés`);

  // 4) Création des caisses (idempotent : skip si l'id existe déjà).
  let created = 0;
  let skipped = 0;
  for (const c of caisses) {
    const ref = db.collection('caisse_definitions').doc(c.id);
    const existing = await ref.get();
    if (existing.exists) {
      skipped += 1;
      console.log(`  SKIP caisse ${c.id} (déjà existante)`);
      continue;
    }
    await ref.set({
      kind: KIND_COMPTE,
      client_id: c.slug,
      client_nom_canonique: c.client_nom_canonique,
      devise: 'MAD',
      active: true,
      solde_initial: 0,
      solde_actuel: 0,
      fermes_observees: FERMES_OBSERVEES,
      is_default: false,
      created_by: seedBy,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    created += 1;
    console.log(`  CREATE caisse ${c.id}`);
  }
  console.log(`  caisse_definitions : ${created} créées, ${skipped} skippées`);
}

async function verifyPostWrite() {
  console.log(`\n[VÉRIF POST-WRITE]`);
  const caissesSnap = await db
    .collection('caisse_definitions')
    .where('kind', '==', KIND_COMPTE)
    .get();
  const caisses = caissesSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const activeCount = caisses.filter((c) => c.data.active === true).length;

  const clientsSnap = await db.collection('clients_marche_local').get();
  let nonArchived = 0;
  let archived = 0;
  for (const d of clientsSnap.docs) {
    if (d.data().archived === true) archived += 1;
    else nonArchived += 1;
  }

  console.log(`  caisses compte_client_marche_local : ${caisses.length} (actives: ${activeCount})`);
  console.log(`  clients_marche_local non archivés  : ${nonArchived}`);
  console.log(`  clients_marche_local archivés      : ${archived}`);

  const present = new Set(caisses.map((c) => c.data.client_id));
  const missing = EXPECTED_SLUGS.filter((s) => !present.has(s));
  if (missing.length > 0) {
    throw new Error(`ERREUR vérif : comptes attendus manquants -> ${missing.join(', ')}`);
  }

  const problems = [];
  if (caisses.length !== 5 || activeCount !== 5) problems.push(`caisses=${caisses.length} actives=${activeCount} (attendu 5/5)`);
  if (nonArchived !== 5) problems.push(`clients non archivés=${nonArchived} (attendu 5)`);
  if (archived !== 9) problems.push(`clients archivés=${archived} (attendu 9)`);
  if (problems.length > 0) {
    console.log(`  ATTENTION (invariants attendus non vérifiés) : ${problems.join(' ; ')}`);
  } else {
    console.log(`  OK : 5 caisses actives / 5 clients gardés / 9 archivés.`);
  }
}

async function main() {
  console.log(`=== seed comptes clients Marché Local (étape 2) ===`);
  console.log(`Mode    : ${APPLY ? 'APPLY (write Firestore)' : 'DRY-RUN (aucun write Firestore)'}`);
  console.log(`Stamp   : ${STAMP}`);

  // 1) BACKUP (toujours, avant tout write).
  const { clientsSnap } = await backup();

  // 2) Source de vérité = slugs réels des BA.
  const { slugs } = await realSlugsFromBA();
  console.log(`  slugs réels (${slugs.length}) : ${slugs.join(', ')}`);

  if (slugs.length !== EXPECTED_SLUGS.length) {
    throw new Error(
      `STOP : ${slugs.length} slugs réels au lieu de ${EXPECTED_SLUGS.length}. Aucun write. ` +
        `Attendus: [${EXPECTED_SLUGS.join(', ')}]  Trouvés: [${slugs.join(', ')}]`
    );
  }
  const unexpected = slugs.filter((s) => !EXPECTED_SLUGS.includes(s));
  const absent = EXPECTED_SLUGS.filter((s) => !slugs.includes(s));
  if (unexpected.length > 0 || absent.length > 0) {
    throw new Error(
      `STOP : écart sur les slugs réels. Inattendus: [${unexpected.join(', ')}] ` +
        `Manquants: [${absent.join(', ')}]. Aucun write.`
    );
  }

  // 3) Plan dédoublonnage + 4) plan caisses.
  const { keep, archive } = planDedup(clientsSnap, EXPECTED_SLUGS);
  const caisses = planCaisses(keep);

  printPlan(keep, archive, caisses);

  if (keep.length !== 5) {
    throw new Error(`STOP : ${keep.length} docs à garder au lieu de 5. Aucun write.`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Aucune écriture Firestore. Backup écrit. Passe --apply pour écrire.`);
    return;
  }

  await applyWrites(keep, archive, caisses);
  await verifyPostWrite();
  console.log(`\nTerminé.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n${err.message || err}`);
    process.exit(1);
  });
