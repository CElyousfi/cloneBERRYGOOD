'use strict';

/**
 * purgeCaisse.js — Remise à zéro one-shot de la Gestion de Caisse (prod).
 *
 * Ce script, NON idempotent par nature (suppression), enchaîne :
 *   1) LECTURE + BACKUP (toujours, même en dry-run, AVANT tout write) : les
 *      transactions des 4 caisses purgées + les 10 caisse_definitions
 *      -> docs/BACKUP-purge-caisse-<stamp>.json
 *      Le fichier n'est JAMAIS écrasé : si le chemin existe déjà, STOP (exit 1).
 *      Après écriture, le fichier est relu et recompté (backup illisible = STOP).
 *   2) GARDE-FOUS BLOQUANTS (recomptés en direct, avant tout write) :
 *      - écart > ±5 % entre le compte réel et EXPECTED_COUNTS pour une caisse
 *        (avec --resume : seul le dépassement PAR EXCÈS est bloquant) ;
 *      - nombre de transactions type='vente' ≠ EXPECTED_VENTES_PRESERVED ;
 *      - un doc sélectionné a type ∈ {vente, encaissement} (filet absolu) ;
 *      - un doc sélectionné a un caisse_id hors de PURGE_CAISSE_IDS.
 *      Si l'un casse : rapport d'écart, AUCUN write, exit 1.
 *   3) SUPPRESSION des transactions PAR IDS issus de la sélection sauvegardée
 *      (db.batch() par chunks de 400). Invariant : supprimé ⊆ sauvegardé ∧
 *      vérifié — un doc créé après la phase de lecture n'est jamais supprimé.
 *   4) RESET des soldes des 4 caisse_definitions correspondantes via update()
 *      (solde_initial: 0, solde_actuel: 0, updated_at: serverTimestamp()).
 *      AUCUN document de caisse_definitions n'est créé ni supprimé.
 *   5) VÉRIF POST-WRITE (en --apply) : 0 transaction restante pour les 4 caisses,
 *      exactement 485 ventes, total collection = 485, soldes des 4 caisses à 0,
 *      soldes des 5 compte_client_* INCHANGÉS (comparés au backup du run).
 *
 * Usage :
 *   node functions/scripts/purgeCaisse.js
 *        DRY-RUN par défaut : n'écrit RIEN en Firestore (mais écrit le backup).
 *   node functions/scripts/purgeCaisse.js --apply
 *        Exécute réellement la purge (write APPROUVÉ pour cette opération précise).
 *   node functions/scripts/purgeCaisse.js --stamp <nom>
 *        Suffixe du fichier de backup (défaut : horodatage ISO). Motif imposé :
 *        /^[\w.-]+$/. Le fichier ne doit pas exister -> un re-run impose un
 *        nouveau stamp, ce qui interdit d'écraser un backup antérieur.
 *   node functions/scripts/purgeCaisse.js --apply --resume
 *        REPRISE après un run interrompu en cours de suppression : le garde-fou
 *        de comptage devient « actual <= expected + tolérance » au lieu d'exiger
 *        |actual - expected| <= tolérance. Ne JAMAIS l'utiliser pour contourner
 *        un écart par excès (plus de docs que prévu = anomalie, toujours bloquante).
 *
 * RESTAURATION : functions/scripts/restoreCaisse.js relit un backup produit ici
 * (reconstruction des Timestamp) et réécrit transactions + soldes.
 *
 * GARDE-FOUS : ne touche JAMAIS aux 485 ventes des comptes clients Marché Local
 * ni à leurs soldes. Ne touche PAS caisse_marche_local_f1. Aucune suppression de
 * collection, aucun recursiveDelete, aucun delete dans caisse_definitions.
 * caisse_rapprochements / caisse_backups sont hors périmètre (vides en prod).
 *
 * Auth : ADC (application default credentials), projet berrygood-farms-dashboard.
 * Le fichier de backup contient des données financières nominatives : il est
 * couvert par .gitignore (docs/BACKUP-*.json) et ne doit JAMAIS être committé.
 */

const path = require('path');
const fs = require('fs');

const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'berrygood-farms-dashboard',
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const TRANSACTIONS = 'caisse_transactions';
const DEFINITIONS = 'caisse_definitions';

// Périmètre EXACT (inventaire prod vérifié le 2026-08-17).
const PURGE_CAISSE_IDS = [
  'caisse_depenses',
  'caisse_depenses_bahia',
  'caisse_paie',
  'caisse_marche_local_f5',
];
const EXPECTED_COUNTS = {
  caisse_depenses: 3456,
  caisse_depenses_bahia: 473,
  caisse_paie: 37,
  caisse_marche_local_f5: 1,
};
const EXPECTED_VENTES_PRESERVED = 485; // type='vente' sur les 5 compte_client_* — NE JAMAIS TOUCHER
const COMPTE_CLIENT_IDS = [
  'compte_client_mustapha_chafik_a',
  'compte_client_mr_monaim_local',
  'compte_client_iraqi_mohamed',
  'compte_client_hamdouch_omar',
  'compte_client_fruit_congel_du_nord',
];

// Types (normalisés) qu'un document sélectionné pour suppression ne peut JAMAIS porter.
const FORBIDDEN_TYPES = ['vente', 'encaissement'];

const TOLERANCE = 0.05; // ±5 %
const BATCH_SIZE = 400; // Firestore limite à 500/batch, marge de 100
const PAGE_SIZE = 500;

const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const stampIdx = process.argv.indexOf('--stamp');
const STAMP =
  stampIdx !== -1 && process.argv[stampIdx + 1]
    ? process.argv[stampIdx + 1]
    : new Date().toISOString().replace(/[:.]/g, '-');

// Motif imposé : le stamp finit dans un nom de fichier, aucun caractère de
// chemin ni d'échappement n'est toléré.
const STAMP_PATTERN = /^[\w.-]+$/;

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');
const BACKUP_PATH = path.join(DOCS_DIR, `BACKUP-purge-caisse-${STAMP}.json`);

const PREFIX = APPLY ? '' : '[DRY-RUN] ';

/** Montant numérique tolérant (number, string, absent). */
function toNumber(value) {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Normalise un `type` de transaction avant toute comparaison de sécurité. */
function normalizeType(value) {
  return value == null ? '' : String(value).trim().toLowerCase();
}

/** Formate un montant MAD pour le rapport. */
function fmt(value) {
  return toNumber(value).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Lit tous les documents d'une requête, paginés par curseur sur __name__.
 * Pas d'offset : coût linéaire et pas de doc sauté.
 */
async function fetchAllByCaisse(caisseId) {
  const base = db
    .collection(TRANSACTIONS)
    .where('caisse_id', '==', caisseId)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(PAGE_SIZE);

  const out = [];
  let cursor = null;
  for (;;) {
    const query = cursor ? base.startAfter(cursor) : base;
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) out.push({ id: doc.id, data: doc.data() });
    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < PAGE_SIZE) break;
  }
  return out;
}

/** Compte les documents d'une requête via l'agrégat count(). */
async function countQuery(query) {
  const snap = await query.count().get();
  return snap.data().count;
}

async function backup(selection, defsSnap) {
  console.log(`\n[BACKUP] -> ${BACKUP_PATH}`);
  const transactions = [];
  for (const caisseId of PURGE_CAISSE_IDS) {
    for (const doc of selection[caisseId]) {
      transactions.push({ id: doc.id, caisse_id: caisseId, data: doc.data });
    }
  }

  const payload = {
    stamp: STAMP,
    exported_at: new Date().toISOString(),
    project: 'berrygood-farms-dashboard',
    mode: APPLY ? 'apply' : 'dry-run',
    purge_caisse_ids: PURGE_CAISSE_IDS,
    caisse_transactions_a_supprimer: transactions,
    caisse_definitions: defsSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
  };

  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

  // JAMAIS d'écrasement : après une purge partielle, un re-run avec le même
  // stamp remplacerait le backup complet par la sélection résiduelle et
  // perdrait définitivement les documents déjà supprimés.
  if (fs.existsSync(BACKUP_PATH)) {
    throw new Error(
      `STOP : le fichier de backup existe déjà -> ${BACKUP_PATH}\n` +
        `  Il ne sera JAMAIS écrasé (il contient peut-être la seule copie de documents\n` +
        `  déjà supprimés). Relance avec un --stamp différent.`
    );
  }

  fs.writeFileSync(BACKUP_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `  sauvegardé : ${transactions.length} transactions + ${payload.caisse_definitions.length} caisse_definitions`
  );

  // Relecture immédiate : un backup illisible ou tronqué interdit la suppression.
  const reread = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  const rereadTx = Array.isArray(reread.caisse_transactions_a_supprimer)
    ? reread.caisse_transactions_a_supprimer.length
    : -1;
  const rereadDefs = Array.isArray(reread.caisse_definitions)
    ? reread.caisse_definitions.length
    : -1;
  if (rereadTx !== transactions.length || rereadDefs !== payload.caisse_definitions.length) {
    throw new Error(
      `STOP : backup relu incohérent (${rereadTx} transactions / ${rereadDefs} définitions ` +
        `au lieu de ${transactions.length} / ${payload.caisse_definitions.length}). Aucune suppression.`
    );
  }
  console.log(`  relecture OK : ${rereadTx} transactions + ${rereadDefs} définitions relues du fichier`);

  return payload;
}

/** Ventilation par caisse : nb + somme des montants par type. */
function ventilation(docs) {
  const byType = new Map();
  let total = 0;
  for (const doc of docs) {
    const type = doc.data.type == null ? '(sans type)' : String(doc.data.type);
    const montant = toNumber(doc.data.montant);
    if (!byType.has(type)) byType.set(type, { count: 0, montant: 0 });
    const entry = byType.get(type);
    entry.count += 1;
    entry.montant += montant;
    total += montant;
  }
  return { byType, total };
}

function printSelection(selection) {
  console.log(`\n===== À SUPPRIMER =====`);
  let grandTotalDocs = 0;
  let grandTotalMontant = 0;
  for (const caisseId of PURGE_CAISSE_IDS) {
    const docs = selection[caisseId];
    const { byType, total } = ventilation(docs);
    const expected = EXPECTED_COUNTS[caisseId];
    console.log(
      `\n  ${caisseId} : ${docs.length} doc(s) (attendu ${expected}, écart ${docs.length - expected})`
    );
    for (const [type, entry] of [...byType.entries()].sort()) {
      console.log(`      - type=${type} : ${entry.count} doc(s), ${fmt(entry.montant)} MAD`);
    }
    console.log(`      total montants : ${fmt(total)} MAD`);
    grandTotalDocs += docs.length;
    grandTotalMontant += total;
  }
  console.log(
    `\n  TOTAL à supprimer : ${grandTotalDocs} doc(s), ${fmt(grandTotalMontant)} MAD`
  );
  return grandTotalDocs;
}

function printPreserved(venteCount, totalCollection, defsById) {
  console.log(`\n===== PRÉSERVÉ =====`);
  console.log(`  transactions type='vente' : ${venteCount} (attendu ${EXPECTED_VENTES_PRESERVED})`);
  console.log(`  total collection ${TRANSACTIONS} : ${totalCollection}`);
  console.log(`  caisse_definitions : ${defsById.size} doc(s), AUCUNE suppression`);
  console.log(`  caisse_marche_local_f1 : non touchée`);
  for (const id of COMPTE_CLIENT_IDS) {
    const def = defsById.get(id);
    const solde = def ? def.solde_actuel : '(absente)';
    console.log(`    - ${id} : solde_actuel ${typeof solde === 'number' ? fmt(solde) : solde} (inchangé)`);
  }
}

function printSoldes(defsById) {
  console.log(`\n===== SOLDES DES CAISSES PURGÉES =====`);
  for (const caisseId of PURGE_CAISSE_IDS) {
    const def = defsById.get(caisseId);
    if (!def) {
      console.log(`  ${caisseId} : caisse_definitions ABSENTE`);
      continue;
    }
    console.log(
      `  ${caisseId} : avant solde_initial=${fmt(def.solde_initial)} solde_actuel=${fmt(def.solde_actuel)}` +
        `  ->  ${PREFIX}après 0.00 / 0.00`
    );
  }
}

/**
 * Garde-fous bloquants. Retourne la liste des problèmes (vide = OK).
 */
function checkGuards(selection, venteCount) {
  const problems = [];

  for (const caisseId of PURGE_CAISSE_IDS) {
    const actual = selection[caisseId].length;
    const expected = EXPECTED_COUNTS[caisseId];
    const maxDelta = Math.max(1, Math.ceil(expected * TOLERANCE));
    // Mode normal : l'écart absolu doit rester dans la tolérance.
    // Mode --resume (reprise après interruption) : seul l'excès est bloquant,
    // un compte plus faible est le résultat attendu d'une purge partielle.
    const tooMany = actual > expected + maxDelta;
    const tooFew = actual < expected - maxDelta;
    if (tooMany || (tooFew && !RESUME)) {
      problems.push(
        `${caisseId} : ${actual} doc(s) réels vs ${expected} attendus (écart ${actual - expected}, ` +
          `tolérance ±${maxDelta} soit ±${TOLERANCE * 100} %` +
          `${RESUME ? ', mode --resume : seul l’excès est bloquant' : ''})` +
          `${tooFew && !RESUME ? ' — si un run précédent a été interrompu, relance avec --resume' : ''}`
      );
    }
  }

  if (venteCount !== EXPECTED_VENTES_PRESERVED) {
    problems.push(
      `transactions type='vente' : ${venteCount} au lieu de ${EXPECTED_VENTES_PRESERVED} exactement`
    );
  }

  for (const caisseId of PURGE_CAISSE_IDS) {
    for (const doc of selection[caisseId]) {
      const type = normalizeType(doc.data.type);
      if (FORBIDDEN_TYPES.includes(type)) {
        problems.push(
          `doc ${doc.id} (caisse ${caisseId}) sélectionné pour suppression avec type='${type}' — INTERDIT`
        );
      }
      const docCaisse = doc.data.caisse_id == null ? '' : String(doc.data.caisse_id);
      if (!PURGE_CAISSE_IDS.includes(docCaisse)) {
        problems.push(
          `doc ${doc.id} sélectionné avec caisse_id='${docCaisse}' hors périmètre — INTERDIT`
        );
      }
    }
  }

  return problems;
}

/**
 * Suppression PAR IDS issus de `selection` — jamais par re-requête.
 * Invariant : tout document supprimé a été sauvegardé dans le backup ET a passé
 * les garde-fous. Un document créé entre la lecture et la suppression n'est donc
 * pas touché (il restera visible en vérif post-write, ce qui est le bon signal).
 */
async function deleteTransactions(selection) {
  console.log(`\n[APPLY] Suppression des transactions (par ids sauvegardés)…`);
  let deletedTotal = 0;

  for (const caisseId of PURGE_CAISSE_IDS) {
    const ids = selection[caisseId].map((doc) => doc.id);
    let deleted = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const id of chunk) batch.delete(db.collection(TRANSACTIONS).doc(id));
      await batch.commit();
      deleted += chunk.length;
    }
    console.log(`  ${caisseId} : ${deleted} doc(s) supprimé(s) sur ${ids.length} sauvegardé(s)`);
    deletedTotal += deleted;
  }

  console.log(`  TOTAL supprimé : ${deletedTotal} doc(s)`);
  return deletedTotal;
}

async function resetSoldes() {
  console.log(`\n[APPLY] Reset des soldes caisse_definitions…`);
  const batch = db.batch();
  let ops = 0;
  for (const caisseId of PURGE_CAISSE_IDS) {
    // update() et pas set({merge:true}) : si la définition n'existe pas, on veut
    // un échec bruyant, pas la création silencieuse d'une caisse fantôme.
    batch.update(db.collection(DEFINITIONS).doc(caisseId), {
      solde_initial: 0,
      solde_actuel: 0,
      updated_at: FieldValue.serverTimestamp(),
    });
    ops += 1;
  }
  if (ops > 0) await batch.commit();
  console.log(`  ${ops} caisse_definitions remises à 0 / 0`);
}

async function verifyPostWrite(soldesAvant) {
  console.log(`\n[VÉRIF POST-WRITE]`);
  const problems = [];

  for (const caisseId of PURGE_CAISSE_IDS) {
    const remaining = await countQuery(
      db.collection(TRANSACTIONS).where('caisse_id', '==', caisseId)
    );
    console.log(`  ${caisseId} : ${remaining} transaction(s) restante(s) (attendu 0)`);
    if (remaining !== 0) problems.push(`${caisseId} : ${remaining} transaction(s) restante(s)`);
  }

  const venteCount = await countQuery(
    db.collection(TRANSACTIONS).where('type', '==', 'vente')
  );
  console.log(`  transactions type='vente' : ${venteCount} (attendu ${EXPECTED_VENTES_PRESERVED})`);
  if (venteCount !== EXPECTED_VENTES_PRESERVED) {
    problems.push(`ventes = ${venteCount} au lieu de ${EXPECTED_VENTES_PRESERVED}`);
  }

  const total = await countQuery(db.collection(TRANSACTIONS));
  console.log(`  total ${TRANSACTIONS} : ${total} (attendu ${EXPECTED_VENTES_PRESERVED})`);
  if (total !== EXPECTED_VENTES_PRESERVED) {
    problems.push(`total collection = ${total} au lieu de ${EXPECTED_VENTES_PRESERVED}`);
  }

  const defsSnap = await db.collection(DEFINITIONS).get();
  const defsById = new Map(defsSnap.docs.map((d) => [d.id, d.data()]));

  for (const caisseId of PURGE_CAISSE_IDS) {
    const def = defsById.get(caisseId);
    if (!def) {
      problems.push(`${caisseId} : caisse_definitions absente après write`);
      continue;
    }
    console.log(
      `  ${caisseId} : solde_initial=${fmt(def.solde_initial)} solde_actuel=${fmt(def.solde_actuel)}`
    );
    if (toNumber(def.solde_initial) !== 0 || toNumber(def.solde_actuel) !== 0) {
      problems.push(
        `${caisseId} : soldes non nuls (initial=${def.solde_initial}, actuel=${def.solde_actuel})`
      );
    }
  }

  for (const id of COMPTE_CLIENT_IDS) {
    const def = defsById.get(id);
    const avant = soldesAvant.get(id);
    const apres = def ? toNumber(def.solde_actuel) : null;
    console.log(`  ${id} : solde_actuel avant=${fmt(avant)} après=${fmt(apres)}`);
    if (!def) {
      problems.push(`${id} : caisse_definitions absente après write`);
    } else if (apres !== toNumber(avant)) {
      problems.push(`${id} : solde_actuel MODIFIÉ (${avant} -> ${apres})`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`VÉRIF POST-WRITE ÉCHOUÉE :\n  - ${problems.join('\n  - ')}`);
  }
  console.log(`  OK : tous les invariants post-purge sont vérifiés.`);
}

async function main() {
  console.log(`=== purge Gestion de Caisse ===`);
  console.log(`Mode    : ${APPLY ? 'APPLY (write Firestore)' : 'DRY-RUN (aucun write Firestore)'}`);
  console.log(`Stamp   : ${STAMP}`);
  console.log(`Reprise : ${RESUME ? 'OUI (--resume : garde-fou de comptage borné par excès seulement)' : 'non'}`);
  console.log(`Projet  : berrygood-farms-dashboard`);

  if (!STAMP_PATTERN.test(STAMP)) {
    throw new Error(
      `STOP : --stamp invalide ("${STAMP}"). Motif autorisé : ${STAMP_PATTERN} ` +
        `(lettres, chiffres, _, . et -). Aucun accès Firestore.`
    );
  }

  // Lecture : sélection des transactions à supprimer + définitions + comptages.
  const selection = {};
  for (const caisseId of PURGE_CAISSE_IDS) {
    selection[caisseId] = await fetchAllByCaisse(caisseId);
  }
  const defsSnap = await db.collection(DEFINITIONS).get();
  const defsById = new Map(defsSnap.docs.map((d) => [d.id, d.data()]));
  const venteCount = await countQuery(
    db.collection(TRANSACTIONS).where('type', '==', 'vente')
  );
  const totalCollection = await countQuery(db.collection(TRANSACTIONS));

  // 1) BACKUP systématique, AVANT tout write (y compris en dry-run).
  await backup(selection, defsSnap);

  // Soldes des comptes clients tels que lus au début du run (référence de vérif).
  const soldesAvant = new Map(
    COMPTE_CLIENT_IDS.map((id) => [id, defsById.has(id) ? toNumber(defsById.get(id).solde_actuel) : null])
  );

  // Rapport.
  const totalASupprimer = printSelection(selection);
  printPreserved(venteCount, totalCollection, defsById);
  printSoldes(defsById);

  // 2) GARDE-FOUS BLOQUANTS — avant tout write.
  console.log(`\n===== GARDE-FOUS =====`);
  const problems = checkGuards(selection, venteCount);
  if (problems.length > 0) {
    console.log(`  ${problems.length} problème(s) bloquant(s) :`);
    for (const p of problems) console.log(`    - ${p}`);
    throw new Error('STOP : garde-fous non satisfaits. AUCUNE écriture Firestore effectuée.');
  }
  console.log(`  OK : comptes dans la tolérance, ${venteCount} ventes intactes, aucun doc interdit sélectionné.`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] ${totalASupprimer} transaction(s) SERAIENT supprimées.`);
    console.log(`[DRY-RUN] Les 4 caisse_definitions SERAIENT remises à solde_initial=0 / solde_actuel=0.`);
    console.log(`[DRY-RUN] Backup écrit : ${BACKUP_PATH}`);
    console.log(`\n[DRY-RUN] AUCUNE ÉCRITURE FIRESTORE N'A EU LIEU. Passe --apply pour exécuter.`);
    return;
  }

  // 3) SUPPRESSION + 4) RESET DES SOLDES.
  const deleted = await deleteTransactions(selection);
  if (deleted !== totalASupprimer) {
    // Ne peut arriver que si un batch a échoué : la suppression porte sur des
    // ids figés, jamais sur une re-requête.
    throw new Error(
      `STOP : ${deleted} doc(s) supprimé(s) vs ${totalASupprimer} planifié(s). ` +
        `Soldes NON remis à zéro. Relance avec --resume et un nouveau --stamp.`
    );
  }
  await resetSoldes();

  // 5) VÉRIF POST-WRITE.
  await verifyPostWrite(soldesAvant);

  console.log(`\nTerminé. Backup : ${BACKUP_PATH}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error(`\n${err.message || err}`);
    process.exitCode = 1;
  })
  // Libère le client gRPC pour que le process se termine naturellement
  // (sans process.exit(), qui tronquerait une sortie redirigée).
  .finally(() => db.terminate().catch(() => {}));
