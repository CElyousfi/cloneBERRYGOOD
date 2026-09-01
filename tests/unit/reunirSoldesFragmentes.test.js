'use strict';

/*
 * scripts/reunir-soldes-fragmentes.js — LES DEUX TEMPS, ET LE JOURNAL.
 *
 * Le script est exécuté pour de vrai contre un FAUX Firestore qui enregistre
 * toute écriture. Ce qui est verrouillé n'est pas la mise en forme du rapport,
 * mais les garanties : le rapport n'écrit rien, l'exécution journalise avant de
 * supprimer, l'incrément reste relatif, et le premier échec arrête tout.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - le mode rapport écrit en base ;
 *  - l'exécution continue après une anomalie au lieu de s'arrêter ;
 *  - le journal d'audit n'est plus écrit, ou l'est après la suppression ;
 *  - `FieldValue.increment` est remplacé par une valeur absolue ;
 *  - un cas à unités divergentes est exécuté quand même ;
 *  - un solde modifié depuis le rapport est écrasé au lieu de faire échouer.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SCRIPT = require('../../scripts/reunir-soldes-fragmentes');

const INCREMENT = Symbol('increment');
const HORODATAGE = Symbol('serverTimestamp');

/**
 * Faux Firestore : deux collections en mémoire, transactions instrumentées.
 * @param {Object} donnees `stock_balances` et `articles_catalog`
 */
function fauxFirestore(donnees) {
  const journal = { writes: [], deletes: [], transactions: 0 };
  const collections = {
    stock_balances: donnees.stock_balances || {},
    articles_catalog: donnees.articles_catalog || {},
    stock_balance_reunions: {},
  };
  let compteur = 0;

  const collection = (nom) => ({
    get: async () => ({
      docs: Object.keys(collections[nom] || {}).map((id) => ({
        id,
        data: () => collections[nom][id],
      })),
    }),
    doc: (id) => ({ __collection: nom, id: id || 'auto_' + ++compteur }),
  });

  const db = {
    collection,
    runTransaction: async (fn) => {
      journal.transactions++;
      const ops = [];
      const t = {
        getAll: async (...refs) =>
          refs.map((r) => {
            const data = collections[r.__collection][r.id];
            return { exists: data !== undefined, id: r.id, data: () => data };
          }),
        set: (ref, data, options) => {
          ops.push({ type: 'set', collection: ref.__collection, id: ref.id, data, options });
        },
        delete: (ref) => {
          ops.push({ type: 'delete', collection: ref.__collection, id: ref.id });
        },
      };
      await fn(t); // une exception ici = transaction annulée, rien n'est appliqué
      for (const op of ops) {
        if (op.type === 'delete') {
          journal.deletes.push(op);
          delete collections[op.collection][op.id];
        } else {
          journal.writes.push(op);
          const cible = collections[op.collection][op.id] || {};
          const data = Object.assign({}, op.data);
          if (data.balance && data.balance[INCREMENT] !== undefined) {
            data.balance = Math.round(((cible.balance || 0) + data.balance[INCREMENT]) * 100) / 100;
          }
          collections[op.collection][op.id] = Object.assign({}, cible, data);
        }
      }
    },
  };
  const admin = {
    firestore: {
      FieldValue: {
        increment: (n) => ({ [INCREMENT]: n }),
        serverTimestamp: () => ({ [HORODATAGE]: true }),
      },
    },
  };
  return { db, admin, journal, collections };
}

// ── jeu de données : deux cas réels + un cas à unités divergentes ──────────

function donnees() {
  return {
    articles_catalog: {
      'Ref-Eng0052': { nom: 'Acide Phosphorique', active: true },
      'Ref-Eng0073': { nom: 'Nitrate de Calcium', active: true },
      'Ref-Eng0046': { nom: 'Rhizo Humus', active: true },
    },
    stock_balances: {
      station_Station_F5_Acide_Phosphorique: { lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Acide Phosphorique', balance: -411.85, unite: 'l' },
      'station_Station_F5_Ref-Eng0052': { lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Ref-Eng0052', balance: -59.8, unite: 'l' },
      station_Station_F1_Nitrate_de_Calcium: { lieu_type: 'station', lieu_id: 'Station F1', article_ref: 'Nitrate de Calcium', balance: -23, unite: 'kg' },
      'station_Station_F1_Ref-Eng0073': { lieu_type: 'station', lieu_id: 'Station F1', article_ref: 'Ref-Eng0073', balance: -364.9, unite: 'kg' },
      // unités divergentes : kg contre l — ne doit JAMAIS être sommé
      station_Station_F5_Rhizo_Humus: { lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Rhizo Humus', balance: -48, unite: 'kg' },
      'station_Station_F5_Ref-Eng0046': { lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Ref-Eng0046', balance: -25.3, unite: 'l' },
    },
  };
}

const SILENCE = () => {};

/**
 * Lance le script en capturant sa sortie.
 * Les cas qui veulent réellement EXÉCUTER arment le double verrou : le but de
 * ces tests-là est le comportement d'écriture, pas le garde-fou (qui a ses
 * propres tests, section 0). Sans cela ils testeraient le refus sans le savoir.
 */
async function lancer(argv, fb) {
  const vrai = console.log;
  const vraiErr = console.error;
  const avant = process.env.REUNION_EXECUTE_CONFIRM;
  console.log = SILENCE;
  console.error = SILENCE;
  let args = argv;
  if (argv.includes('--execute')) {
    process.env.REUNION_EXECUTE_CONFIRM = 'OUI';
    // La sauvegarde préalable est OBLIGATOIRE en exécution : sans redirection,
    // chaque test écrirait dans `docs/` du dépôt. On la détourne vers un
    // fichier temporaire — le CONTENU est vérifié par son propre test.
    if (!argv.includes('--backup')) {
      args = argv.concat([
        '--backup',
        path.join(os.tmpdir(), 'reunion-backup-test-' + process.pid + '.json'),
      ]);
    }
  }
  try {
    return await SCRIPT.main(['node', 'script'].concat(args), fb);
  } finally {
    console.log = vrai;
    console.error = vraiErr;
    if (avant === undefined) delete process.env.REUNION_EXECUTE_CONFIRM;
    else process.env.REUNION_EXECUTE_CONFIRM = avant;
  }
}

/** Lance SANS armer le verrou (pour tester le refus). */
async function lancerNu(argv, fb) {
  const vrai = console.log;
  const vraiErr = console.error;
  const avant = process.env.REUNION_EXECUTE_CONFIRM;
  console.log = SILENCE;
  console.error = SILENCE;
  delete process.env.REUNION_EXECUTE_CONFIRM;
  const codeAvant = process.exitCode;
  try {
    const r = await SCRIPT.main(['node', 'script'].concat(argv), fb);
    return { r, exitCode: process.exitCode };
  } finally {
    process.exitCode = codeAvant;
    console.log = vrai;
    console.error = vraiErr;
    if (avant !== undefined) process.env.REUNION_EXECUTE_CONFIRM = avant;
  }
}

// ── 0. DOUBLE VERROU D'ÉCRITURE ────────────────────────────────────────────
// Ce script SUPPRIME des documents de solde de stock — ce que le magasinier
// voit tous les jours. Le flag CLI seul ne doit rien déclencher.

test('--execute SANS la variable est REFUSÉ : aucune lecture, aucune écriture', async () => {
  const fb = fauxFirestore(donnees());
  const { r, exitCode } = await lancerNu(['--execute'], fb);
  assert.strictEqual(exitCode, 2, 'le refus doit sortir en code 2');
  assert.strictEqual(fb.journal.transactions, 0);
  assert.strictEqual(fb.journal.writes.length, 0);
  assert.strictEqual(fb.journal.deletes.length, 0);
  assert.deepStrictEqual(r.cas, [], 'le refus tombe AVANT même de lire la base');
});

test('une confirmation approximative ne suffit pas', () => {
  for (const v of ['oui', 'OUI ', 'yes', '1', 'true', '']) {
    assert.strictEqual(
      SCRIPT.parseArgs(['node', 's', '--execute'], { REUNION_EXECUTE_CONFIRM: v }).mode,
      'report',
      'valeur « ' + v +' » ne doit pas armer l\'exécution'
    );
  }
  assert.strictEqual(
    SCRIPT.parseArgs(['node', 's', '--execute'], { REUNION_EXECUTE_CONFIRM: 'OUI' }).mode,
    'execute'
  );
});

test('la variable seule, sans --execute, reste en rapport', () => {
  const o = SCRIPT.parseArgs(['node', 's'], { REUNION_EXECUTE_CONFIRM: 'OUI' });
  assert.strictEqual(o.mode, 'report');
  assert.strictEqual(o.refus, false);
});

test('l\'exécution écrit une sauvegarde préalable avec l\'état AVANT', async () => {
  // La ceinture, en plus du journal transactionnel : elle doit contenir les
  // soldes d'ORIGINE, y compris ceux des documents que l'exécution supprime.
  const cible = path.join(os.tmpdir(), 'reunion-backup-verif-' + process.pid + '.json');
  if (fs.existsSync(cible)) fs.unlinkSync(cible);
  const fb = fauxFirestore(donnees());
  await lancer(['--execute', '--backup', cible], fb);

  assert.ok(fs.existsSync(cible), 'la sauvegarde doit exister');
  const sauve = JSON.parse(fs.readFileSync(cible, 'utf8'));
  assert.ok(Array.isArray(sauve.cas_documents) && sauve.cas_documents.length >= 3);

  const acide = sauve.cas_documents.find((c) => c.article_id === 'Ref-Eng0052');
  assert.ok(acide, 'le cas Acide Phosphorique doit être sauvegardé');
  // Les DEUX fragments, avec leur solde d'avant — dont celui qui sera supprimé.
  const soldes = acide.docs.map((d) => d.balance).sort((a, b) => a - b);
  assert.deepStrictEqual(soldes, [-411.85, -59.8]);
  // Et le cas bloqué sur les unités y figure aussi, avec son motif.
  const bloque = sauve.cas_documents.find((c) => c.anomalies.length > 0);
  assert.ok(bloque, 'le cas à unités divergentes doit être sauvegardé lui aussi');
  fs.unlinkSync(cible);
});

// ── 1. LE RAPPORT N'ÉCRIT RIEN ─────────────────────────────────────────────

test('le mode par défaut est le RAPPORT, et il n’écrit pas une seule fois', async () => {
  assert.strictEqual(SCRIPT.parseArgs(['node', 's']).mode, 'report');
  const fb = fauxFirestore(donnees());
  const r = await lancer([], fb);
  assert.strictEqual(fb.journal.transactions, 0, 'aucune transaction ne doit être ouverte');
  assert.strictEqual(fb.journal.writes.length, 0);
  assert.strictEqual(fb.journal.deletes.length, 0);
  assert.strictEqual(r.cas.length, 3, 'les 3 cas doivent être vus');
  assert.strictEqual(r.executables.length, 2);
  assert.strictEqual(r.bloques.length, 1, 'le cas à unités divergentes est mis de côté');
});

test('--report explicite n’écrit pas davantage', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--report'], fb);
  assert.strictEqual(fb.journal.writes.length, 0);
});

// ── 2. L'EXÉCUTION RÉUNIT ──────────────────────────────────────────────────

test('--execute laisse UN SEUL solde par article et par lieu, portant la somme', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute'], fb);
  const soldes = fb.collections.stock_balances;
  assert.strictEqual(soldes.station_Station_F5_Acide_Phosphorique, undefined, 'le fragment absorbé est supprimé');
  assert.strictEqual(soldes['station_Station_F5_Ref-Eng0052'].balance, -471.65, 'le conservé porte la somme');
  assert.strictEqual(soldes.station_Station_F1_Nitrate_de_Calcium, undefined);
  assert.strictEqual(soldes['station_Station_F1_Ref-Eng0073'].balance, -387.9);
});

test('le cas à unités divergentes est laissé INTACT', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute'], fb);
  assert.strictEqual(fb.collections.stock_balances.station_Station_F5_Rhizo_Humus.balance, -48);
  assert.strictEqual(fb.collections.stock_balances['station_Station_F5_Ref-Eng0046'].balance, -25.3);
});

test('l’écriture du solde conservé est un INCRÉMENT relatif', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute'], fb);
  const w = fb.journal.writes.filter((o) => o.collection === 'stock_balances');
  assert.strictEqual(w.length, 2);
  for (const op of w) {
    assert.strictEqual(typeof op.data.balance, 'object', 'une valeur absolue écraserait un mouvement concurrent');
    assert.strictEqual(op.options.merge, true);
  }
  assert.strictEqual(w[0].data.balance[INCREMENT], -411.85, 'incrément = somme des ABSORBÉS seuls');
});

// ── 3. LE JOURNAL D'AUDIT ──────────────────────────────────────────────────

test('chaque cas exécuté écrit son journal AVANT de supprimer quoi que ce soit', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute'], fb);
  const journaux = fb.journal.writes.filter((o) => o.collection === 'stock_balance_reunions');
  assert.strictEqual(journaux.length, 2, 'un journal par cas réuni');
  const premierJournal = fb.journal.writes.findIndex((o) => o.collection === 'stock_balance_reunions');
  assert.strictEqual(premierJournal, 0, 'le journal est écrit en premier dans la transaction');
});

test('le journal permet de revenir en arrière : état AVANT de chaque fragment', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute'], fb);
  const j = fb.journal.writes.find((o) => o.collection === 'stock_balance_reunions').data;
  assert.strictEqual(j.conserve, 'station_Station_F5_Ref-Eng0052');
  assert.deepStrictEqual(j.supprimes, ['station_Station_F5_Acide_Phosphorique']);
  assert.strictEqual(j.increment_applique, -411.85);
  assert.strictEqual(j.total_attendu, -471.65);
  const avant = {};
  for (const s of j.soldes_avant) avant[s.docId] = s;
  assert.strictEqual(avant.station_Station_F5_Acide_Phosphorique.balance, -411.85);
  assert.strictEqual(avant.station_Station_F5_Acide_Phosphorique.article_ref, 'Acide Phosphorique');
  assert.strictEqual(avant['station_Station_F5_Ref-Eng0052'].balance, -59.8);
});

// ── 4. ARRÊT À LA PREMIÈRE ANOMALIE ────────────────────────────────────────

test('un solde qui a bougé depuis le rapport fait ÉCHOUER le cas, sans rien écrire', async () => {
  const fb = fauxFirestore(donnees());
  const cas = {
    article_id: 'Ref-Eng0052', article_nom: 'Acide Phosphorique',
    lieu_type: 'station', lieu_id: 'Station F5',
    docs: [
      { docId: 'station_Station_F5_Acide_Phosphorique', balance: -400 }, // périmé
      { docId: 'station_Station_F5_Ref-Eng0052', balance: -59.8 },
    ],
    total: -459.8,
    conserve: 'station_Station_F5_Ref-Eng0052',
    supprimes: ['station_Station_F5_Acide_Phosphorique'],
    anomalies: [],
  };
  await assert.rejects(() => SCRIPT.reunirUnCas(cas, fb), /a changé depuis le rapport/);
  assert.strictEqual(fb.journal.writes.length, 0, 'transaction annulée : aucune écriture');
  assert.strictEqual(fb.journal.deletes.length, 0);
  assert.strictEqual(fb.collections.stock_balances.station_Station_F5_Acide_Phosphorique.balance, -411.85);
});

test('un solde disparu fait ÉCHOUER le cas', async () => {
  const fb = fauxFirestore(donnees());
  const cas = {
    article_id: 'Ref-Eng0052', article_nom: 'Acide Phosphorique',
    lieu_type: 'station', lieu_id: 'Station F5',
    docs: [
      { docId: 'jamais_existe', balance: -1 },
      { docId: 'station_Station_F5_Ref-Eng0052', balance: -59.8 },
    ],
    total: -60.8, conserve: 'station_Station_F5_Ref-Eng0052', supprimes: ['jamais_existe'], anomalies: [],
  };
  await assert.rejects(() => SCRIPT.reunirUnCas(cas, fb), /a disparu depuis le rapport/);
  assert.strictEqual(fb.journal.writes.length, 0);
});

test('l’exécution S’ARRÊTE au premier cas en échec : le suivant n’est jamais tenté', async () => {
  const fb = fauxFirestore(donnees());
  const casKo = {
    article_id: 'Ref-Eng0052', article_nom: 'Acide Phosphorique',
    lieu_type: 'station', lieu_id: 'Station F5',
    docs: [
      { docId: 'station_Station_F5_Acide_Phosphorique', balance: -400 }, // périmé
      { docId: 'station_Station_F5_Ref-Eng0052', balance: -59.8 },
    ],
    total: -459.8, conserve: 'station_Station_F5_Ref-Eng0052',
    supprimes: ['station_Station_F5_Acide_Phosphorique'], anomalies: [],
  };
  const casOk = {
    article_id: 'Ref-Eng0073', article_nom: 'Nitrate de Calcium',
    lieu_type: 'station', lieu_id: 'Station F1',
    docs: [
      { docId: 'station_Station_F1_Nitrate_de_Calcium', balance: -23 },
      { docId: 'station_Station_F1_Ref-Eng0073', balance: -364.9 },
    ],
    total: -387.9, conserve: 'station_Station_F1_Ref-Eng0073',
    supprimes: ['station_Station_F1_Nitrate_de_Calcium'], anomalies: [],
  };
  const vrai = console.log;
  console.log = SILENCE;
  let resultats;
  try {
    resultats = await SCRIPT.executerPlan([casKo, casOk], fb);
  } finally {
    console.log = vrai;
  }
  assert.strictEqual(resultats.length, 1, 'le second cas ne doit JAMAIS être tenté');
  assert.strictEqual(resultats[0].ok, false);
  assert.strictEqual(fb.collections.stock_balances.station_Station_F1_Nitrate_de_Calcium.balance, -23, 'intact');
});
