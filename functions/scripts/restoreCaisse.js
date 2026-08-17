'use strict';

/**
 * restoreCaisse.js — Restauration d'un backup produit par purgeCaisse.js.
 *
 * Filet de sécurité de l'opération irréversible de purge. Le script :
 *   1) LIT le fichier de backup, dont le nom dépend du périmètre purgé :
 *        docs/BACKUP-purge-caisse-<stamp>.json           (mode par défaut)
 *        docs/BACKUP-purge-comptes-clients-<stamp>.json  (--comptes-clients)
 *      ou n'importe quel chemin via --file <chemin>.
 *      Fichier absent / JSON invalide / structure incohérente -> STOP, exit 1.
 *   2) RECONSTRUIT les Timestamp Firestore : la sérialisation JSON transforme un
 *      Timestamp en {"_seconds":…,"_nanoseconds":…} ; un set() naïf le réécrirait
 *      en map et corromprait l'historique. La reconstruction est RÉCURSIVE et
 *      traverse maps ET tableaux (ex. le champ `history`, tableau d'objets).
 *   3) CONTRÔLES BLOQUANTS avant tout write : ids uniques, `data` objet, chaque
 *      caisse_id dans purge_caisse_ids du backup, type conforme aux RÈGLES DU
 *      BACKUP (cf. ci-dessous), définitions cibles existantes.
 *      Les règles de type et le périmètre sont lus DANS le fichier, jamais
 *      depuis des constantes en dur — c'est ce qui permet de restaurer aussi
 *      bien un backup du mode par défaut (types `vente`/`encaissement`
 *      interdits) qu'un backup du mode --comptes-clients (type `vente`
 *      EXIGÉ sur chaque document). Un backup antérieur à l'ajout des
 *      métadonnées (`perimetre`/`type_attendu`/`types_interdits` absents) est
 *      traité avec les règles historiques du mode par défaut.
 *   4) RESTAURE les transactions par set() sur les ids d'origine, chunks de 400
 *      (idempotent : un doc déjà présent est réécrit à l'identique).
 *   5) RESTAURE les soldes (solde_initial / solde_actuel) des caisses purgées
 *      via update(). Les autres caisse_definitions ne sont PAS touchées.
 *   6) VÉRIF POST-WRITE (en --apply) : compte par caisse == compte du backup,
 *      soldes restaurés conformes. Échec -> exit 1.
 *
 * Usage :
 *   node functions/scripts/restoreCaisse.js --stamp <nom>
 *        DRY-RUN par défaut : lit, valide, reconstruit, n'écrit RIEN.
 *        Résout docs/BACKUP-purge-caisse-<stamp>.json (mode par défaut).
 *   node functions/scripts/restoreCaisse.js --stamp <nom> --comptes-clients
 *        Résout docs/BACKUP-purge-comptes-clients-<stamp>.json.
 *   node functions/scripts/restoreCaisse.js --file docs/BACKUP-purge-caisse-x.json
 *        Chemin explicite : le mode est alors déduit du contenu du fichier.
 *   node functions/scripts/restoreCaisse.js --stamp <nom> --apply
 *        Réécrit réellement dans Firestore.
 *
 * Auth : ADC (application default credentials), projet berrygood-farms-dashboard.
 */

const path = require('path');
const fs = require('fs');

// firebase-admin est chargé PARESSEUSEMENT : les helpers purs (contrôles du
// backup) doivent rester requérables depuis les tests unitaires de la racine,
// où le SDK n'est pas installé.
let _fb = null;
function fb() {
  if (!_fb) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: 'berrygood-farms-dashboard',
        credential: admin.credential.applicationDefault(),
      });
    }
    _fb = {
      admin,
      db: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      FieldValue: admin.firestore.FieldValue,
    };
  }
  return _fb;
}

const TRANSACTIONS = 'caisse_transactions';
const DEFINITIONS = 'caisse_definitions';
// Règles historiques, appliquées UNIQUEMENT aux backups sans métadonnées de
// périmètre (produits avant l'ajout du mode --comptes-clients).
const LEGACY_FORBIDDEN_TYPES = ['vente', 'encaissement'];
const BATCH_SIZE = 400;
const STAMP_PATTERN = /^[\w.-]+$/;

// Préfixe de fichier par mode — miroir de purgeCaisse.js.
const BACKUP_PREFIXES = {
  'caisses-operationnelles': 'BACKUP-purge-caisse',
  'comptes-clients': 'BACKUP-purge-comptes-clients',
};

const APPLY = process.argv.includes('--apply');
const COMPTES_CLIENTS = process.argv.includes('--comptes-clients');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');
const FILE_ARG = argValue('--file');
const STAMP_ARG = argValue('--stamp');

const PREFIX = APPLY ? '' : '[DRY-RUN] ';

/** Montant numérique tolérant (number, string, absent). */
function toNumber(value) {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Formate un montant MAD pour le rapport. */
function fmt(value) {
  return toNumber(value).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Normalise un `type` de transaction avant toute comparaison de sécurité. */
function normalizeType(value) {
  return value == null ? '' : String(value).trim().toLowerCase();
}

/** Reconnaît la forme JSON d'un Timestamp Firestore sérialisé. */
function isSerializedTimestamp(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes('_seconds') &&
    keys.includes('_nanoseconds') &&
    typeof value._seconds === 'number' &&
    typeof value._nanoseconds === 'number'
  );
}

/**
 * Reconstruit récursivement les Timestamp à travers maps ET tableaux.
 * `stats.timestamps` compte les reconstructions (contrôle de non-régression).
 */
function reviveTimestamps(value, stats) {
  if (value === null || typeof value !== 'object') return value;
  if (isSerializedTimestamp(value)) {
    stats.timestamps += 1;
    const { Timestamp } = fb();
    return new Timestamp(value._seconds, value._nanoseconds);
  }
  if (Array.isArray(value)) return value.map((item) => reviveTimestamps(item, stats));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = reviveTimestamps(item, stats);
  }
  return out;
}

function resolveBackupPath() {
  if (FILE_ARG) return path.isAbsolute(FILE_ARG) ? FILE_ARG : path.resolve(process.cwd(), FILE_ARG);
  if (!STAMP_ARG) {
    throw new Error('STOP : préciser --stamp <nom> ou --file <chemin> du backup à restaurer.');
  }
  if (!STAMP_PATTERN.test(STAMP_ARG)) {
    throw new Error(`STOP : --stamp invalide ("${STAMP_ARG}"). Motif autorisé : ${STAMP_PATTERN}`);
  }
  const prefix = COMPTES_CLIENTS
    ? BACKUP_PREFIXES['comptes-clients']
    : BACKUP_PREFIXES['caisses-operationnelles'];
  return path.join(DOCS_DIR, `${prefix}-${STAMP_ARG}.json`);
}

/** Charge et valide la structure du backup. Lève si incohérent. */
function loadBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`STOP : fichier de backup introuvable -> ${backupPath}`);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  } catch (err) {
    throw new Error(`STOP : backup illisible (JSON invalide) -> ${backupPath}\n  ${err.message}`);
  }

  const transactions = payload.caisse_transactions_a_supprimer;
  const definitions = payload.caisse_definitions;
  if (!Array.isArray(transactions) || !Array.isArray(definitions)) {
    throw new Error(
      'STOP : structure de backup inattendue (caisse_transactions_a_supprimer / ' +
        'caisse_definitions doivent être des tableaux).'
    );
  }
  if (transactions.length === 0) {
    throw new Error('STOP : backup vide (0 transaction), rien à restaurer.');
  }
  if (!Array.isArray(payload.purge_caisse_ids) || payload.purge_caisse_ids.length === 0) {
    throw new Error('STOP : backup sans purge_caisse_ids, périmètre de restauration indéterminable.');
  }
  return payload;
}

/**
 * Règles de contrôle portées PAR LE BACKUP (périmètre + types), avec repli sur
 * les règles historiques quand les métadonnées sont absentes (backups produits
 * avant l'ajout du mode --comptes-clients).
 */
function backupRules(payload) {
  const perimetre =
    typeof payload.perimetre === 'string' && payload.perimetre
      ? payload.perimetre
      : 'caisses-operationnelles';
  const typeAttendu =
    typeof payload.type_attendu === 'string' && payload.type_attendu
      ? normalizeType(payload.type_attendu)
      : null;
  const typesInterdits = Array.isArray(payload.types_interdits)
    ? payload.types_interdits.map(normalizeType)
    : typeAttendu
      ? []
      : LEGACY_FORBIDDEN_TYPES;
  return {
    perimetre,
    typeAttendu,
    typesInterdits,
    scope: payload.purge_caisse_ids,
    metadonnees: typeof payload.perimetre === 'string' && payload.perimetre ? 'backup' : 'héritées',
  };
}

/** Contrôles bloquants sur le contenu du backup. Retourne la liste des problèmes. */
function checkBackup(payload) {
  const problems = [];
  const seen = new Set();
  const rules = backupRules(payload);
  const scope = rules.scope;

  for (const entry of payload.caisse_transactions_a_supprimer) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      problems.push('une entrée de transaction n’a pas d’id exploitable');
      continue;
    }
    if (seen.has(entry.id)) problems.push(`id dupliqué dans le backup : ${entry.id}`);
    seen.add(entry.id);

    if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
      problems.push(`doc ${entry.id} : champ data absent ou non-objet`);
      continue;
    }
    const caisseId = entry.data.caisse_id == null ? '' : String(entry.data.caisse_id);
    if (!scope.includes(caisseId)) {
      problems.push(`doc ${entry.id} : caisse_id='${caisseId}' hors purge_caisse_ids du backup`);
    }
    const type = normalizeType(entry.data.type);
    if (rules.typeAttendu) {
      if (type !== rules.typeAttendu) {
        problems.push(
          `doc ${entry.id} : type='${type}' ≠ '${rules.typeAttendu}' — ` +
            `le backup (périmètre ${rules.perimetre}) n’en contient jamais d’autre`
        );
      }
    } else if (rules.typesInterdits.includes(type)) {
      problems.push(
        `doc ${entry.id} : type='${type}' — un backup de périmètre ${rules.perimetre} n’en contient jamais`
      );
    }
  }

  for (const entry of payload.caisse_definitions) {
    if (!entry || typeof entry.id !== 'string' || !entry.data || typeof entry.data !== 'object') {
      problems.push('une entrée de caisse_definitions est mal formée');
    }
  }

  return problems;
}

/** Ventilation par caisse : nb + somme des montants par type. */
function printPlan(byCaisse, stats, payload) {
  console.log(`\n===== À RESTAURER =====`);
  let totalDocs = 0;
  let totalMontant = 0;
  for (const [caisseId, docs] of [...byCaisse.entries()].sort()) {
    const byType = new Map();
    let sum = 0;
    for (const doc of docs) {
      const type = doc.data.type == null ? '(sans type)' : String(doc.data.type);
      const montant = toNumber(doc.data.montant);
      if (!byType.has(type)) byType.set(type, { count: 0, montant: 0 });
      byType.get(type).count += 1;
      byType.get(type).montant += montant;
      sum += montant;
    }
    console.log(`\n  ${caisseId} : ${docs.length} doc(s)`);
    for (const [type, entry] of [...byType.entries()].sort()) {
      console.log(`      - type=${type} : ${entry.count} doc(s), ${fmt(entry.montant)} MAD`);
    }
    console.log(`      total montants : ${fmt(sum)} MAD`);
    totalDocs += docs.length;
    totalMontant += sum;
  }
  console.log(`\n  TOTAL à restaurer : ${totalDocs} doc(s), ${fmt(totalMontant)} MAD`);
  console.log(`  Timestamp reconstruits : ${stats.timestamps}`);
  const rules = backupRules(payload);
  console.log(`  Backup daté du ${payload.exported_at} (stamp="${payload.stamp}", mode="${payload.mode}")`);
  console.log(
    `  Périmètre du backup : ${rules.perimetre} (métadonnées ${rules.metadonnees}) — ` +
      `${rules.typeAttendu ? `type exigé '${rules.typeAttendu}'` : `types interdits [${rules.typesInterdits.join(', ')}]`}`
  );
  return totalDocs;
}

function printSoldesPlan(soldesCibles) {
  console.log(`\n===== SOLDES À RESTAURER (caisse_definitions) =====`);
  for (const [caisseId, soldes] of soldesCibles.entries()) {
    console.log(
      `  ${caisseId} : ${PREFIX}solde_initial=${fmt(soldes.solde_initial)} ` +
        `solde_actuel=${fmt(soldes.solde_actuel)} (valeurs du backup)`
    );
  }
}

async function restoreTransactions(byCaisse) {
  console.log(`\n[APPLY] Restauration des transactions…`);
  let total = 0;
  for (const [caisseId, docs] of [...byCaisse.entries()].sort()) {
    let written = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const chunk = docs.slice(i, i + BATCH_SIZE);
      const batch = fb().db.batch();
      for (const doc of chunk) {
        batch.set(fb().db.collection(TRANSACTIONS).doc(doc.id), doc.data);
      }
      await batch.commit();
      written += chunk.length;
    }
    console.log(`  ${caisseId} : ${written} doc(s) réécrit(s)`);
    total += written;
  }
  console.log(`  TOTAL restauré : ${total} doc(s)`);
  return total;
}

async function restoreSoldes(soldesCibles) {
  console.log(`\n[APPLY] Restauration des soldes caisse_definitions…`);
  const batch = fb().db.batch();
  let ops = 0;
  for (const [caisseId, soldes] of soldesCibles.entries()) {
    // update() : on ne recrée jamais une définition disparue.
    batch.update(fb().db.collection(DEFINITIONS).doc(caisseId), {
      solde_initial: soldes.solde_initial,
      solde_actuel: soldes.solde_actuel,
      updated_at: fb().FieldValue.serverTimestamp(),
    });
    ops += 1;
  }
  if (ops > 0) await batch.commit();
  console.log(`  ${ops} caisse_definitions restaurée(s)`);
}

/**
 * Vérif post-write. `deps` permet d'injecter un double de Firestore ({db}) :
 * ce chemin n'est atteint qu'en --apply, il doit rester testable hors ligne.
 */
async function verifyPostWrite(byCaisse, soldesCibles, deps) {
  console.log(`\n[VÉRIF POST-WRITE]`);
  const problems = [];
  const db = deps && deps.db ? deps.db : fb().db;

  for (const [caisseId, docs] of [...byCaisse.entries()].sort()) {
    const snap = await db
      .collection(TRANSACTIONS)
      .where('caisse_id', '==', caisseId)
      .count()
      .get();
    const actual = snap.data().count;
    console.log(`  ${caisseId} : ${actual} transaction(s) (attendu ${docs.length})`);
    if (actual !== docs.length) {
      problems.push(`${caisseId} : ${actual} transaction(s) au lieu de ${docs.length}`);
    }
  }

  for (const [caisseId, soldes] of soldesCibles.entries()) {
    const doc = await db.collection(DEFINITIONS).doc(caisseId).get();
    if (!doc.exists) {
      problems.push(`${caisseId} : caisse_definitions absente après write`);
      continue;
    }
    const data = doc.data();
    console.log(
      `  ${caisseId} : solde_initial=${fmt(data.solde_initial)} solde_actuel=${fmt(data.solde_actuel)}`
    );
    if (
      toNumber(data.solde_initial) !== toNumber(soldes.solde_initial) ||
      toNumber(data.solde_actuel) !== toNumber(soldes.solde_actuel)
    ) {
      problems.push(`${caisseId} : soldes restaurés non conformes au backup`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`VÉRIF POST-WRITE ÉCHOUÉE :\n  - ${problems.join('\n  - ')}`);
  }
  console.log(`  OK : restauration conforme au backup.`);
}

async function main() {
  const backupPath = resolveBackupPath();
  console.log(`=== restauration Gestion de Caisse ===`);
  console.log(`Mode    : ${APPLY ? 'APPLY (write Firestore)' : 'DRY-RUN (aucun write Firestore)'}`);
  console.log(`Backup  : ${backupPath}`);
  console.log(`Projet  : berrygood-farms-dashboard`);

  // 1) Lecture + validation de structure.
  const payload = loadBackup(backupPath);

  // 2) Reconstruction des Timestamp (récursive, maps + tableaux).
  const stats = { timestamps: 0 };
  const byCaisse = new Map();
  for (const entry of payload.caisse_transactions_a_supprimer) {
    const data = reviveTimestamps(entry.data, stats);
    const caisseId = data && data.caisse_id != null ? String(data.caisse_id) : '(sans caisse_id)';
    if (!byCaisse.has(caisseId)) byCaisse.set(caisseId, []);
    byCaisse.get(caisseId).push({ id: entry.id, data });
  }

  // 3) Contrôles bloquants.
  console.log(`\n===== CONTRÔLES =====`);
  const problems = checkBackup(payload);
  if (problems.length > 0) {
    console.log(`  ${problems.length} problème(s) bloquant(s) :`);
    for (const p of problems.slice(0, 20)) console.log(`    - ${p}`);
    if (problems.length > 20) console.log(`    … (${problems.length - 20} autre(s))`);
    throw new Error('STOP : backup incohérent. AUCUNE écriture Firestore effectuée.');
  }
  console.log(`  OK : ids uniques, périmètre conforme, types conformes aux règles du backup.`);

  // Soldes cibles = valeurs du backup pour les caisses purgées.
  const defsBackup = new Map(payload.caisse_definitions.map((d) => [d.id, d.data]));
  const soldesCibles = new Map();
  for (const caisseId of payload.purge_caisse_ids) {
    const def = defsBackup.get(caisseId);
    if (!def) {
      throw new Error(`STOP : caisse_definitions "${caisseId}" absente du backup, soldes non restaurables.`);
    }
    soldesCibles.set(caisseId, {
      solde_initial: toNumber(def.solde_initial),
      solde_actuel: toNumber(def.solde_actuel),
    });
  }

  const totalDocs = printPlan(byCaisse, stats, payload);
  printSoldesPlan(soldesCibles);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] ${totalDocs} transaction(s) SERAIENT réécrites sur leurs ids d'origine.`);
    console.log(`[DRY-RUN] ${soldesCibles.size} caisse_definitions SERAIENT restaurées aux soldes du backup.`);
    console.log(`[DRY-RUN] ${stats.timestamps} Timestamp reconstruits sans erreur.`);
    console.log(`\n[DRY-RUN] AUCUNE ÉCRITURE FIRESTORE N'A EU LIEU. Passe --apply pour restaurer.`);
    return;
  }

  // Les définitions cibles doivent exister (update() échouerait sinon).
  for (const caisseId of soldesCibles.keys()) {
    const doc = await fb().db.collection(DEFINITIONS).doc(caisseId).get();
    if (!doc.exists) {
      throw new Error(
        `STOP : caisse_definitions "${caisseId}" absente en base. Restauration interrompue ` +
          `avant tout write (aucune définition n'est recréée par ce script).`
      );
    }
  }

  await restoreTransactions(byCaisse);
  await restoreSoldes(soldesCibles);
  await verifyPostWrite(byCaisse, soldesCibles);

  console.log(`\nTerminé. Backup restauré : ${backupPath}`);
}

// Exécution uniquement en CLI : un `require()` (contrôle de non-régression du
// revive) ne doit toucher ni Firestore ni le disque.
if (require.main === module) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(`\n${err.message || err}`);
      process.exitCode = 1;
    })
    .finally(() => fb().db.terminate().catch(() => {}));
}

// Helpers purs exposés pour vérification hors ligne (aucun effet de bord).
module.exports = {
  isSerializedTimestamp,
  reviveTimestamps,
  checkBackup,
  backupRules,
  normalizeType,
  // Exposée pour être testée avec un double de Firestore : c'est le seul
  // chemin --apply que ni le dry-run ni les tests de garde-fous n'exercent.
  verifyPostWrite,
};
