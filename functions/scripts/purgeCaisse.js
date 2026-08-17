'use strict';

/**
 * purgeCaisse.js — Remise à zéro one-shot de la Gestion de Caisse (prod).
 *
 * DEUX PÉRIMÈTRES MUTUELLEMENT EXCLUSIFS, sélectionnés par un flag explicite :
 *
 *   - MODE PAR DÉFAUT (aucun flag) — `caisses-operationnelles` :
 *     purge les 4 caisses opérationnelles (dépenses, dépenses Bahia, paie,
 *     marché local F5). `vente` et `encaissement` y sont des types INTERDITS,
 *     et le garde-fou « exactement 485 ventes préservées » reste actif.
 *     Ce mode n'a PAS changé : mêmes constantes, mêmes garde-fous, même nom de
 *     fichier de backup qu'avant l'ajout du second mode.
 *
 *   - MODE `--comptes-clients` — `comptes-clients` :
 *     purge les 485 ventes des 5 comptes clients Marché Local et remet leurs
 *     soldes à 0. Le type ATTENDU est `vente` : tout autre type (encaissement,
 *     dépense…) sur un compte client est bloquant. Les garde-fous « préservé »
 *     deviennent symétriques : après la purge la collection doit être VIDE
 *     (total = 0) et les 4 caisses opérationnelles ne doivent contenir aucun
 *     document (elles sont déjà purgées). Leurs soldes ne sont PAS retouchés.
 *
 * Dans les deux modes, le script, NON idempotent par nature (suppression), enchaîne :
 *   1) LECTURE + BACKUP (toujours, même en dry-run, AVANT tout write) : les
 *      transactions des caisses du périmètre + les 10 caisse_definitions
 *      -> docs/<prefixe-du-mode>-<stamp>.json (le préfixe distingue les deux
 *      modes : un backup d'un mode ne peut jamais être pris pour l'autre).
 *      Le fichier n'est JAMAIS écrasé : si le chemin existe déjà, STOP (exit 1).
 *      Après écriture, le fichier est relu et recompté (backup illisible = STOP).
 *   2) GARDE-FOUS BLOQUANTS (recomptés en direct, avant tout write) :
 *      - écart > ±5 % entre le compte réel et EXPECTED_COUNTS pour une caisse
 *        (avec --resume : seul le dépassement PAR EXCÈS est bloquant) ;
 *      - invariant de préservation propre au mode (cf. ci-dessus) ;
 *      - un doc sélectionné porte un type interdit par le mode (filet absolu) ;
 *      - un doc sélectionné a un caisse_id hors du périmètre du mode.
 *      Si l'un casse : rapport d'écart, AUCUN write, exit 1.
 *   3) SUPPRESSION des transactions PAR IDS issus de la sélection sauvegardée
 *      (db.batch() par chunks de 400). Invariant : supprimé ⊆ sauvegardé ∧
 *      vérifié — un doc créé après la phase de lecture n'est jamais supprimé.
 *   4) RESET des soldes des caisse_definitions du périmètre via update()
 *      (solde_initial: 0, solde_actuel: 0, updated_at: serverTimestamp()).
 *      AUCUN document de caisse_definitions n'est créé ni supprimé, dans aucun
 *      des deux modes : les caisses restent configurées, seules les valeurs
 *      de solde changent.
 *   5) VÉRIF POST-WRITE (en --apply) : 0 transaction restante pour le périmètre,
 *      compteurs de préservation du mode conformes, soldes du périmètre à 0,
 *      soldes des caisses hors périmètre INCHANGÉS (comparés au backup du run).
 *
 * Usage :
 *   node functions/scripts/purgeCaisse.js
 *        DRY-RUN par défaut : n'écrit RIEN en Firestore (mais écrit le backup).
 *   node functions/scripts/purgeCaisse.js --comptes-clients
 *        Bascule sur le périmètre des 5 comptes clients Marché Local.
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
 * (reconstruction des Timestamp) et réécrit transactions + soldes. Il lit le
 * périmètre ET les règles de type DANS le backup, donc restaure indifféremment
 * un backup de l'un ou l'autre mode.
 *
 * GARDE-FOUS : le mode par défaut ne touche JAMAIS aux ventes des comptes
 * clients ni à leurs soldes ; le mode --comptes-clients ne touche JAMAIS aux
 * caisses opérationnelles ni à leurs soldes. Aucun mode ne touche
 * caisse_marche_local_f1. Aucune suppression de collection, aucun
 * recursiveDelete, aucun delete dans caisse_definitions.
 * caisse_rapprochements / caisse_backups sont hors périmètre (vides en prod).
 *
 * Auth : ADC (application default credentials), projet berrygood-farms-dashboard.
 * Le fichier de backup contient des données financières nominatives : il est
 * couvert par .gitignore (docs/BACKUP-*.json) et ne doit JAMAIS être committé.
 */

const path = require('path');
const fs = require('fs');

const TRANSACTIONS = 'caisse_transactions';
const DEFINITIONS = 'caisse_definitions';

// Périmètres EXACTS (inventaire prod vérifié le 2026-08-17).
const CAISSES_OPERATIONNELLES = [
  'caisse_depenses',
  'caisse_depenses_bahia',
  'caisse_paie',
  'caisse_marche_local_f5',
];
const COMPTE_CLIENT_IDS = [
  'compte_client_mustapha_chafik_a',
  'compte_client_mr_monaim_local',
  'compte_client_iraqi_mohamed',
  'compte_client_hamdouch_omar',
  'compte_client_fruit_congel_du_nord',
];

const EXPECTED_VENTES_PRESERVED = 485; // type='vente' sur les 5 compte_client_*

/**
 * Un mode = un périmètre + ses garde-fous + son préfixe de backup.
 * Les deux listes de caisses sont volontairement croisées : le périmètre de
 * purge d'un mode est le périmètre PRÉSERVÉ de l'autre. C'est la seule chose
 * partagée, et elle n'est jamais mutée — les comptages, règles de type,
 * invariants post-purge et préfixes de backup sont, eux, propres à chaque mode :
 * basculer de mode ne peut pas « assouplir » les garde-fous de l'autre.
 */
const MODES = {
  'caisses-operationnelles': {
    key: 'caisses-operationnelles',
    label: '4 caisses opérationnelles',
    caisseIds: CAISSES_OPERATIONNELLES,
    expectedCounts: {
      caisse_depenses: 3456,
      caisse_depenses_bahia: 473,
      caisse_paie: 37,
      caisse_marche_local_f5: 1,
    },
    // Aucun type unique attendu (dépenses, entrées, virements…) mais deux types
    // absolument interdits : c'est le filet de sécurité du mode par défaut.
    typeAttendu: null,
    typesInterdits: ['vente', 'encaissement'],
    // Caisses hors périmètre dont les soldes doivent rester INCHANGÉS.
    caissesPreservees: COMPTE_CLIENT_IDS,
    // Invariant de préservation : exactement 485 ventes survivent, et la
    // collection ne contient plus qu'elles.
    expectedVentesPreserved: EXPECTED_VENTES_PRESERVED,
    expectedTotalApres: EXPECTED_VENTES_PRESERVED,
    backupPrefix: 'BACKUP-purge-caisse',
  },
  'comptes-clients': {
    key: 'comptes-clients',
    label: '5 comptes clients Marché Local',
    caisseIds: COMPTE_CLIENT_IDS,
    expectedCounts: {
      compte_client_mustapha_chafik_a: 273,
      compte_client_mr_monaim_local: 190,
      compte_client_iraqi_mohamed: 17,
      compte_client_hamdouch_omar: 1,
      compte_client_fruit_congel_du_nord: 4,
    },
    // Symétrique du mode par défaut : seul `vente` est admis, tout le reste
    // (encaissement, dépense, type absent…) bloque.
    typeAttendu: 'vente',
    typesInterdits: null,
    caissesPreservees: CAISSES_OPERATIONNELLES,
    // Les 4 caisses opérationnelles sont déjà vides : après cette purge, la
    // collection entière doit être vide.
    expectedVentesPreserved: 0,
    expectedTotalApres: 0,
    backupPrefix: 'BACKUP-purge-comptes-clients',
  },
};

const TOLERANCE = 0.05; // ±5 %
const BATCH_SIZE = 400; // Firestore limite à 500/batch, marge de 100
const PAGE_SIZE = 500;

// Motif imposé : le stamp finit dans un nom de fichier, aucun caractère de
// chemin ni d'échappement n'est toléré.
const STAMP_PATTERN = /^[\w.-]+$/;

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');

/** Sélectionne le mode à partir de argv. Sans flag : mode par défaut, inchangé. */
function resolveMode(argv) {
  return argv.includes('--comptes-clients')
    ? MODES['comptes-clients']
    : MODES['caisses-operationnelles'];
}

/** Nom du fichier de backup — distinct par mode, jamais confondable. */
function backupFileName(mode, stamp) {
  return `${mode.backupPrefix}-${stamp}.json`;
}

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

/**
 * Garde-fous bloquants. Fonction PURE : retourne la liste des problèmes
 * (vide = OK). `stats` = compteurs relus en direct dans Firestore.
 *   - stats.venteCount        : nb de transactions type='vente' (collection entière)
 *   - stats.totalCollection   : nb total de documents de la collection
 *   - stats.preserveesCount   : nb de documents portés par les caisses hors
 *                               périmètre (utilisé par le mode comptes-clients)
 */
function checkGuards(mode, selection, stats, opts) {
  const resume = Boolean(opts && opts.resume);
  const problems = [];

  let totalSelection = 0;
  for (const caisseId of mode.caisseIds) {
    const actual = selection[caisseId].length;
    totalSelection += actual;
    const expected = mode.expectedCounts[caisseId];
    const maxDelta = Math.max(1, Math.ceil(expected * TOLERANCE));
    // Mode normal : l'écart absolu doit rester dans la tolérance.
    // Mode --resume (reprise après interruption) : seul l'excès est bloquant,
    // un compte plus faible est le résultat attendu d'une purge partielle.
    const tooMany = actual > expected + maxDelta;
    const tooFew = actual < expected - maxDelta;
    if (tooMany || (tooFew && !resume)) {
      // --resume n'a de sens que sur une purge INTERROMPUE (il en reste une
      // partie). À 0 document, le périmètre est déjà vide : --resume ne ferait
      // qu'autoriser un --apply sans effet, ce qu'il ne faut pas suggérer.
      let conseil = '';
      if (tooFew && !resume) {
        conseil =
          actual === 0
            ? ` — le périmètre est VIDE : cette purge a probablement déjà été exécutée. ` +
              `Vérifier avant toute relance ; --resume n'aiderait pas (il n'autoriserait ` +
              `qu'un --apply sans effet)`
            : ' — si un run précédent a été interrompu en cours de suppression, relance avec --resume';
      }
      problems.push(
        `${caisseId} : ${actual} doc(s) réels vs ${expected} attendus (écart ${actual - expected}, ` +
          `tolérance ±${maxDelta} soit ±${TOLERANCE * 100} %` +
          `${resume ? ', mode --resume : seul l’excès est bloquant' : ''})` +
          conseil
      );
    }
  }

  if (mode.key === 'caisses-operationnelles') {
    // Filet historique : les 485 ventes des comptes clients sont intouchables.
    if (stats.venteCount !== mode.expectedVentesPreserved) {
      problems.push(
        `transactions type='vente' : ${stats.venteCount} au lieu de ${mode.expectedVentesPreserved} exactement`
      );
    }
  } else {
    // Invariant symétrique : après la purge, plus RIEN dans la collection.
    const restant = stats.totalCollection - totalSelection;
    if (restant !== 0) {
      problems.push(
        `${restant} transaction(s) resteraient dans ${TRANSACTIONS} après la purge ` +
          `(total collection ${stats.totalCollection} vs ${totalSelection} sélectionnée(s), attendu 0 restant)`
      );
    }
    // Les 4 caisses opérationnelles sont déjà purgées : un document qui y
    // réapparaît signale une réécriture non prévue -> STOP.
    if (stats.preserveesCount !== 0) {
      problems.push(
        `${stats.preserveesCount} document(s) présent(s) sur les caisses opérationnelles ` +
          `(${mode.caissesPreservees.join(', ')}) alors qu'elles doivent être vides`
      );
    }
  }

  for (const caisseId of mode.caisseIds) {
    for (const doc of selection[caisseId]) {
      const type = normalizeType(doc.data.type);
      if (mode.typeAttendu) {
        if (type !== mode.typeAttendu) {
          problems.push(
            `doc ${doc.id} (caisse ${caisseId}) sélectionné pour suppression avec ` +
              `type='${type}' ≠ '${mode.typeAttendu}' attendu — INTERDIT`
          );
        }
      } else if (mode.typesInterdits.includes(type)) {
        problems.push(
          `doc ${doc.id} (caisse ${caisseId}) sélectionné pour suppression avec type='${type}' — INTERDIT`
        );
      }
      const docCaisse = doc.data.caisse_id == null ? '' : String(doc.data.caisse_id);
      if (!mode.caisseIds.includes(docCaisse)) {
        problems.push(
          `doc ${doc.id} sélectionné avec caisse_id='${docCaisse}' hors périmètre — INTERDIT`
        );
      }
    }
  }

  return problems;
}

/** Métadonnées de périmètre écrites dans le backup et relues par restoreCaisse.js. */
function buildBackupPayload(mode, stamp, apply, transactions, definitions) {
  return {
    stamp,
    exported_at: new Date().toISOString(),
    project: 'berrygood-farms-dashboard',
    mode: apply ? 'apply' : 'dry-run',
    // Métadonnées de périmètre : restoreCaisse.js applique SES contrôles à
    // partir d'elles, jamais à partir de constantes en dur.
    perimetre: mode.key,
    type_attendu: mode.typeAttendu,
    types_interdits: mode.typesInterdits,
    purge_caisse_ids: mode.caisseIds,
    caisse_transactions_a_supprimer: transactions,
    caisse_definitions: definitions,
  };
}

// ---------------------------------------------------------------------------
// Tout ce qui suit touche Firestore / le disque : chargé uniquement en CLI.
// ---------------------------------------------------------------------------

function runCli() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: 'berrygood-farms-dashboard',
      credential: admin.credential.applicationDefault(),
    });
  }
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  const APPLY = process.argv.includes('--apply');
  const RESUME = process.argv.includes('--resume');
  const MODE = resolveMode(process.argv);
  const stampIdx = process.argv.indexOf('--stamp');
  const STAMP =
    stampIdx !== -1 && process.argv[stampIdx + 1]
      ? process.argv[stampIdx + 1]
      : new Date().toISOString().replace(/[:.]/g, '-');

  const BACKUP_PATH = path.join(DOCS_DIR, backupFileName(MODE, STAMP));
  const PREFIX = APPLY ? '' : '[DRY-RUN] ';

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
    for (const caisseId of MODE.caisseIds) {
      for (const doc of selection[caisseId]) {
        transactions.push({ id: doc.id, caisse_id: caisseId, data: doc.data });
      }
    }

    const payload = buildBackupPayload(
      MODE,
      STAMP,
      APPLY,
      transactions,
      defsSnap.docs.map((d) => ({ id: d.id, data: d.data() }))
    );

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

  function printSelection(selection) {
    console.log(`\n===== À SUPPRIMER =====`);
    let grandTotalDocs = 0;
    let grandTotalMontant = 0;
    for (const caisseId of MODE.caisseIds) {
      const docs = selection[caisseId];
      const { byType, total } = ventilation(docs);
      const expected = MODE.expectedCounts[caisseId];
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
    console.log(`\n  TOTAL à supprimer : ${grandTotalDocs} doc(s), ${fmt(grandTotalMontant)} MAD`);
    return grandTotalDocs;
  }

  function printPreserved(stats, defsById, totalSelection) {
    console.log(`\n===== PRÉSERVÉ =====`);
    if (MODE.key === 'caisses-operationnelles') {
      console.log(
        `  transactions type='vente' : ${stats.venteCount} (attendu ${MODE.expectedVentesPreserved})`
      );
      console.log(`  total collection ${TRANSACTIONS} : ${stats.totalCollection}`);
    } else {
      // Recoupement : la sélection doit être exactement l'ensemble des ventes
      // de la collection — sinon une vente traîne hors périmètre.
      console.log(
        `  recoupement type='vente' : ${stats.venteCount} vente(s) dans la collection pour ` +
          `${totalSelection} sélectionnée(s) — ` +
          `${stats.venteCount === totalSelection ? '100 % de la sélection' : 'ÉCART, à investiguer'}`
      );
      console.log(
        `  documents sur les caisses opérationnelles : ${stats.preserveesCount} (attendu 0, déjà purgées)`
      );
      console.log(`  total collection ${TRANSACTIONS} : ${stats.totalCollection} (avant purge)`);
      console.log(`  total ${TRANSACTIONS} après purge : ${PREFIX}0 (attendu 0)`);
    }
    console.log(`  caisse_definitions : ${defsById.size} doc(s), AUCUNE suppression`);
    console.log(`  caisse_marche_local_f1 : non touchée`);
    for (const id of MODE.caissesPreservees) {
      const def = defsById.get(id);
      const solde = def ? def.solde_actuel : '(absente)';
      console.log(
        `    - ${id} : solde_actuel ${typeof solde === 'number' ? fmt(solde) : solde} (inchangé)`
      );
    }
  }

  function printSoldes(defsById) {
    console.log(`\n===== SOLDES DES CAISSES PURGÉES =====`);
    for (const caisseId of MODE.caisseIds) {
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
   * Suppression PAR IDS issus de `selection` — jamais par re-requête.
   * Invariant : tout document supprimé a été sauvegardé dans le backup ET a passé
   * les garde-fous. Un document créé entre la lecture et la suppression n'est donc
   * pas touché (il restera visible en vérif post-write, ce qui est le bon signal).
   */
  async function deleteTransactions(selection) {
    console.log(`\n[APPLY] Suppression des transactions (par ids sauvegardés)…`);
    let deletedTotal = 0;

    for (const caisseId of MODE.caisseIds) {
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
    for (const caisseId of MODE.caisseIds) {
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

    for (const caisseId of MODE.caisseIds) {
      const remaining = await countQuery(
        db.collection(TRANSACTIONS).where('caisse_id', '==', caisseId)
      );
      console.log(`  ${caisseId} : ${remaining} transaction(s) restante(s) (attendu 0)`);
      if (remaining !== 0) problems.push(`${caisseId} : ${remaining} transaction(s) restante(s)`);
    }

    const venteCount = await countQuery(db.collection(TRANSACTIONS).where('type', '==', 'vente'));
    console.log(`  transactions type='vente' : ${venteCount} (attendu ${MODE.expectedVentesPreserved})`);
    if (venteCount !== MODE.expectedVentesPreserved) {
      problems.push(`ventes = ${venteCount} au lieu de ${MODE.expectedVentesPreserved}`);
    }

    const total = await countQuery(db.collection(TRANSACTIONS));
    console.log(`  total ${TRANSACTIONS} : ${total} (attendu ${MODE.expectedTotalApres})`);
    if (total !== MODE.expectedTotalApres) {
      problems.push(`total collection = ${total} au lieu de ${MODE.expectedTotalApres}`);
    }

    const defsSnap = await db.collection(DEFINITIONS).get();
    const defsById = new Map(defsSnap.docs.map((d) => [d.id, d.data()]));

    for (const caisseId of MODE.caisseIds) {
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

    for (const id of MODE.caissesPreservees) {
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
    console.log(`Périmètre : ${MODE.key} (${MODE.label})`);
    console.log(`Stamp   : ${STAMP}`);
    console.log(
      `Reprise : ${RESUME ? 'OUI (--resume : garde-fou de comptage borné par excès seulement)' : 'non'}`
    );
    console.log(`Projet  : berrygood-farms-dashboard`);

    if (!STAMP_PATTERN.test(STAMP)) {
      throw new Error(
        `STOP : --stamp invalide ("${STAMP}"). Motif autorisé : ${STAMP_PATTERN} ` +
          `(lettres, chiffres, _, . et -). Aucun accès Firestore.`
      );
    }

    // Lecture : sélection des transactions à supprimer + définitions + comptages.
    const selection = {};
    for (const caisseId of MODE.caisseIds) {
      selection[caisseId] = await fetchAllByCaisse(caisseId);
    }
    const defsSnap = await db.collection(DEFINITIONS).get();
    const defsById = new Map(defsSnap.docs.map((d) => [d.id, d.data()]));

    const stats = {
      venteCount: await countQuery(db.collection(TRANSACTIONS).where('type', '==', 'vente')),
      totalCollection: await countQuery(db.collection(TRANSACTIONS)),
      preserveesCount: null,
    };
    // Comptage des caisses hors périmètre : utile seulement au mode
    // comptes-clients (le mode par défaut se repose sur le compte des ventes,
    // et ne fait donc aucune lecture supplémentaire par rapport à avant).
    if (MODE.key === 'comptes-clients') {
      stats.preserveesCount = 0;
      for (const caisseId of MODE.caissesPreservees) {
        stats.preserveesCount += await countQuery(
          db.collection(TRANSACTIONS).where('caisse_id', '==', caisseId)
        );
      }
    }

    // 1) BACKUP systématique, AVANT tout write (y compris en dry-run).
    await backup(selection, defsSnap);

    // Soldes des caisses hors périmètre tels que lus au début du run (référence
    // de vérif : ils doivent être strictement inchangés après la purge).
    const soldesAvant = new Map(
      MODE.caissesPreservees.map((id) => [
        id,
        defsById.has(id) ? toNumber(defsById.get(id).solde_actuel) : null,
      ])
    );

    // Rapport.
    const totalASupprimer = printSelection(selection);
    printPreserved(stats, defsById, totalASupprimer);
    printSoldes(defsById);

    // 2) GARDE-FOUS BLOQUANTS — avant tout write.
    console.log(`\n===== GARDE-FOUS =====`);
    const problems = checkGuards(MODE, selection, stats, { resume: RESUME });
    if (problems.length > 0) {
      console.log(`  ${problems.length} problème(s) bloquant(s) :`);
      for (const p of problems.slice(0, 20)) console.log(`    - ${p}`);
      if (problems.length > 20) console.log(`    … (${problems.length - 20} autre(s))`);
      throw new Error('STOP : garde-fous non satisfaits. AUCUNE écriture Firestore effectuée.');
    }
    if (MODE.key === 'caisses-operationnelles') {
      console.log(
        `  OK : comptes dans la tolérance, ${stats.venteCount} ventes intactes, aucun doc interdit sélectionné.`
      );
    } else {
      console.log(
        `  OK : comptes dans la tolérance, 100 % de type='vente', aucun doc résiduel hors périmètre ` +
          `(la collection sera vide après la purge).`
      );
    }

    if (!APPLY) {
      console.log(`\n[DRY-RUN] ${totalASupprimer} transaction(s) SERAIENT supprimées.`);
      console.log(
        `[DRY-RUN] Les ${MODE.caisseIds.length} caisse_definitions du périmètre SERAIENT remises à ` +
          `solde_initial=0 / solde_actuel=0.`
      );
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
}

// Exécution uniquement en CLI : un `require()` (tests des garde-fous) ne doit
// toucher ni Firestore ni le disque.
if (require.main === module) {
  runCli();
}

// Helpers purs exposés pour vérification hors ligne (aucun effet de bord).
module.exports = {
  MODES,
  resolveMode,
  backupFileName,
  buildBackupPayload,
  checkGuards,
  normalizeType,
  toNumber,
  ventilation,
};
