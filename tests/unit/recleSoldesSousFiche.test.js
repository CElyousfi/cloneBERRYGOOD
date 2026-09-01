'use strict';

/*
 * scripts/recle-soldes-sous-fiche.js — LES DEUX TEMPS, ET LE JOURNAL.
 *
 * Le script est exécuté pour de vrai contre un FAUX Firestore qui enregistre
 * toute écriture. Ce qui est verrouillé n'est pas la mise en forme du rapport,
 * mais les GARANTIES :
 *   - le rapport n'écrit rien, nulle part ;
 *   - le double verrou refuse `--execute` sans la variable d'environnement ;
 *   - la sauvegarde préalable précède la première écriture ;
 *   - un déplacement conserve le solde à l'unité près et recrée le document
 *     COMPLET (un solde sans lieu_type serait invisible de l'inventaire) ;
 *   - une réunion SOMME, par délégation à `reunir-soldes-fragmentes` ;
 *   - un orphelin n'est ni déplacé ni supprimé ;
 *   - un cas à unités divergentes n'est jamais exécuté ;
 *   - le premier échec arrête tout.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - le mode rapport écrit en base ;
 *  - le double verrou devient contournable (le flag CLI suffit) ;
 *  - la sauvegarde préalable est écrite après l'exécution, ou pas du tout ;
 *  - une réunion garde le plus gros fragment au lieu de sommer ;
 *  - un cas à unités divergentes est exécuté quand même ;
 *  - un orphelin est supprimé ou déplacé sous une clé inventée ;
 *  - un solde modifié depuis le rapport est écrasé au lieu de faire échouer ;
 *  - le journal d'audit n'est plus écrit, ou l'est après la suppression.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SCRIPT = require('../../scripts/recle-soldes-sous-fiche');

const INCREMENT = Symbol('increment');
const HORODATAGE = Symbol('serverTimestamp');

/**
 * Faux Firestore : collections en mémoire, transactions instrumentées.
 * @param {Object} donnees
 */
function fauxFirestore(donnees) {
  const journal = { writes: [], deletes: [], transactions: 0, ordre: [] };
  const collections = {
    stock_balances: donnees.stock_balances || {},
    articles_catalog: donnees.articles_catalog || {},
    stock_balance_recles: {},
    stock_balance_reunions: {},
  };
  let compteur = 0;

  const collection = (nom) => ({
    get: async () => ({
      docs: Object.keys(collections[nom] || {}).map((id) => ({ id, data: () => collections[nom][id] })),
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
            const data = (collections[r.__collection] || {})[r.id];
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
        journal.ordre.push(op.type + ':' + op.collection + ':' + op.id);
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

/**
 * Jeu de données inspiré de la production :
 *   - un déplacement simple (la cible n'existe pas) : NITRETE DE POTASSE 9 754 ;
 *   - une réunion (la cible existe déjà) : AZO PRO 31 ;
 *   - un orphelin sans fiche : TES ;
 *   - un cas à unités divergentes : KELPAK.
 */
function donnees() {
  return {
    articles_catalog: {
      'IMP-019': { nom: 'NITRETE DE POTASSE', active: true },
      'IMP-005': { nom: 'AZO PRO 31', active: true },
      'IMP-042': { nom: 'KELPAK', active: true },
    },
    stock_balances: {
      magasin_F2_NITRETE_DE_POTASSE: { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'NITRETE DE POTASSE', article_nom: 'NITRETE DE POTASSE', balance: 9754, unite: 'kg' },
      magasin_F2_AZO_PRO_31: { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'AZO PRO 31', balance: 3770, unite: 'kg' },
      'magasin_F2_IMP-005': { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'IMP-005', balance: 230, unite: 'kg' },
      magasin_F2_TES: { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'TES', balance: 6, unite: 'kg' },
      magasin_F2_KELPAK: { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'KELPAK', balance: 12, unite: 'l' },
      'magasin_F2_IMP-042': { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'IMP-042', balance: 3, unite: 'kg' },
    },
  };
}

const SILENCE = () => {};

/** Lance le script en capturant sa sortie ; arme le double verrou si `--execute`. */
async function lancer(argv, fb, opts) {
  const vrai = console.log;
  const vraiErr = console.error;
  const avant = process.env.RECLE_EXECUTE_CONFIRM;
  console.log = SILENCE;
  console.error = SILENCE;
  let args = argv;
  let backup = null;
  if (argv.includes('--execute') && !(opts && opts.sansVerrou)) {
    process.env.RECLE_EXECUTE_CONFIRM = 'OUI';
    // La sauvegarde préalable est OBLIGATOIRE en exécution : sans redirection,
    // chaque test écrirait dans `docs/` du dépôt.
    if (!argv.includes('--backup')) {
      backup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'recle-')), 'backup.json');
      args = argv.concat(['--backup', backup]);
    }
  } else {
    delete process.env.RECLE_EXECUTE_CONFIRM;
  }
  const codeAvant = process.exitCode;
  try {
    const r = await SCRIPT.main(['node', 'script'].concat(args), fb);
    return Object.assign({ exitCode: process.exitCode, backup }, r);
  } finally {
    process.exitCode = codeAvant;
    console.log = vrai;
    console.error = vraiErr;
    if (avant === undefined) delete process.env.RECLE_EXECUTE_CONFIRM;
    else process.env.RECLE_EXECUTE_CONFIRM = avant;
  }
}

// ── 0. DOUBLE VERROU ────────────────────────────────────────────────────────

test('parseArgs — rapport par défaut', () => {
  const o = SCRIPT.parseArgs(['node', 's'], {});
  assert.strictEqual(o.mode, 'report');
  assert.strictEqual(o.refus, false);
});

test('parseArgs — --execute SANS la variable = REFUS, jamais exécution', () => {
  const o = SCRIPT.parseArgs(['node', 's', '--execute'], {});
  assert.strictEqual(o.mode, 'report');
  assert.strictEqual(o.refus, true);
});

test('parseArgs — la variable SEULE ne suffit pas non plus', () => {
  const o = SCRIPT.parseArgs(['node', 's'], { RECLE_EXECUTE_CONFIRM: 'OUI' });
  assert.strictEqual(o.mode, 'report');
});

test('parseArgs — une valeur approchante ne déverrouille pas', () => {
  for (const v of ['oui', 'OUI ', 'yes', '1', 'true', '']) {
    const o = SCRIPT.parseArgs(['node', 's', '--execute'], { RECLE_EXECUTE_CONFIRM: v });
    assert.strictEqual(o.mode, 'report', 'déverrouillé par « ' + v + ' »');
    assert.strictEqual(o.refus, true);
  }
});

test('parseArgs — les deux ensemble = exécution', () => {
  const o = SCRIPT.parseArgs(['node', 's', '--execute'], { RECLE_EXECUTE_CONFIRM: 'OUI' });
  assert.strictEqual(o.mode, 'execute');
  assert.strictEqual(o.refus, false);
});

test('--execute sans la variable : AUCUNE lecture, AUCUNE écriture, sortie 2', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer(['--execute'], fb, { sansVerrou: true });
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(fb.journal.transactions, 0);
  assert.strictEqual(fb.journal.writes.length, 0);
  assert.strictEqual(fb.journal.deletes.length, 0);
  assert.strictEqual(Object.keys(fb.collections.stock_balances).length, 6, 'rien n\'a bougé');
});

// ── 1. MODE RAPPORT : LECTURE SEULE ─────────────────────────────────────────

test('rapport — aucune transaction, aucune écriture, aucune suppression', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer([], fb);
  assert.strictEqual(fb.journal.transactions, 0);
  assert.strictEqual(fb.journal.writes.length, 0);
  assert.strictEqual(fb.journal.deletes.length, 0);
  assert.strictEqual(r.resultats.length, 0);
  assert.strictEqual(Object.keys(fb.collections.stock_balances).length, 6);
});

test('rapport — le plan sépare déplacements, réunions, bloqués et orphelins', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer([], fb);
  const issues = r.executables.map((c) => c.issue).sort();
  assert.deepStrictEqual(issues, ['deplacement', 'reunion']);
  assert.strictEqual(r.bloques.length, 1, 'KELPAK kg vs l');
  assert.strictEqual(r.orphelins.length, 1, 'TES');
  assert.strictEqual(r.orphelins[0].docs[0].docId, 'magasin_F2_TES');
});

test('rapport — sans --backup, aucun fichier n\'est laissé derrière', async () => {
  const fb = fauxFirestore(donnees());
  const avant = fs.readdirSync(path.resolve(__dirname, '../../docs'));
  await lancer([], fb);
  const apres = fs.readdirSync(path.resolve(__dirname, '../../docs'));
  assert.deepStrictEqual(apres, avant);
});

// ── 2. DÉPLACEMENT ──────────────────────────────────────────────────────────

test('déplacement — le solde est conservé à l\'unité près, sous la clé de fiche', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute', '--only', 'deplacements'], fb);
  const cible = fb.collections.stock_balances['magasin_F2_IMP-019'];
  assert.ok(cible, 'le document canonique existe');
  assert.strictEqual(cible.balance, 9754, 'aucune quantité perdue ni recalculée');
  assert.strictEqual(cible.article_ref, 'IMP-019', 'l\'identité est le docId de la fiche');
  assert.strictEqual(cible.article_nom, 'NITRETE DE POTASSE', 'le libellé lu est conservé');
  assert.strictEqual(cible.lieu_type, 'magasin');
  assert.strictEqual(cible.lieu_id, 'F2');
  assert.strictEqual(cible.unite, 'kg');
  assert.strictEqual(
    fb.collections.stock_balances.magasin_F2_NITRETE_DE_POTASSE,
    undefined,
    'la source est supprimée'
  );
});

test('déplacement — journal d\'audit écrit AVANT la suppression, dans la même transaction', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute', '--only', 'deplacements'], fb);
  const audits = Object.values(fb.collections.stock_balance_recles);
  assert.strictEqual(audits.length, 1);
  const a = audits[0];
  assert.strictEqual(a.ancien_doc_id, 'magasin_F2_NITRETE_DE_POTASSE');
  assert.strictEqual(a.nouveau_doc_id, 'magasin_F2_IMP-019');
  assert.strictEqual(a.solde_avant.balance, 9754);
  assert.strictEqual(a.solde_avant.article_ref, 'NITRETE DE POTASSE');
  const iAudit = fb.journal.ordre.findIndex((o) => o.startsWith('set:stock_balance_recles'));
  const iSuppr = fb.journal.ordre.findIndex((o) => o === 'delete:stock_balances:magasin_F2_NITRETE_DE_POTASSE');
  assert.ok(iAudit > -1 && iSuppr > -1 && iAudit < iSuppr, 'pas de suppression sans sa trace');
});

test('déplacement — un solde modifié depuis le rapport fait ÉCHOUER, il n\'est pas écrasé', async () => {
  const fb = fauxFirestore(donnees());
  const c = {
    issue: 'deplacement',
    article_id: 'IMP-019',
    article_nom: 'NITRETE DE POTASSE',
    lieu_type: 'magasin',
    lieu_id: 'F2',
    conserve: 'magasin_F2_IMP-019',
    supprimes: ['magasin_F2_NITRETE_DE_POTASSE'],
    total: 9754,
    anomalies: [],
    docs: [{ docId: 'magasin_F2_NITRETE_DE_POTASSE', balance: 111 }], // plan périmé
  };
  await assert.rejects(() => SCRIPT.deplacerUnCas(c, fb), /a changé depuis le rapport/);
  assert.ok(fb.collections.stock_balances.magasin_F2_NITRETE_DE_POTASSE, 'source intacte');
  assert.strictEqual(fb.collections.stock_balances['magasin_F2_IMP-019'], undefined);
});

test('déplacement — une cible apparue entre-temps fait ÉCHOUER (ce serait une somme)', async () => {
  const d = donnees();
  d.stock_balances['magasin_F2_IMP-019'] = { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'IMP-019', balance: 5, unite: 'kg' };
  const fb = fauxFirestore(d);
  const c = {
    issue: 'deplacement',
    article_id: 'IMP-019',
    article_nom: 'NITRETE DE POTASSE',
    lieu_type: 'magasin',
    lieu_id: 'F2',
    conserve: 'magasin_F2_IMP-019',
    supprimes: ['magasin_F2_NITRETE_DE_POTASSE'],
    total: 9754,
    anomalies: [],
    docs: [{ docId: 'magasin_F2_NITRETE_DE_POTASSE', balance: 9754 }],
  };
  await assert.rejects(() => SCRIPT.deplacerUnCas(c, fb), /RÉUNION/);
  assert.strictEqual(fb.collections.stock_balances['magasin_F2_IMP-019'].balance, 5, 'cible non écrasée');
});

// ── 3. RÉUNION : ON SOMME ───────────────────────────────────────────────────

test('réunion — la cible reçoit la SOMME, pas le plus gros fragment', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute', '--only', 'reunions'], fb);
  const cible = fb.collections.stock_balances['magasin_F2_IMP-005'];
  assert.strictEqual(cible.balance, 4000, '3770 + 230');
  assert.notStrictEqual(cible.balance, 3770);
  assert.strictEqual(fb.collections.stock_balances.magasin_F2_AZO_PRO_31, undefined);
});

test('réunion — l\'incrément est RELATIF (FieldValue.increment), jamais absolu', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute', '--only', 'reunions'], fb);
  const op = fb.journal.writes.find(
    (w) => w.collection === 'stock_balances' && w.id === 'magasin_F2_IMP-005'
  );
  assert.ok(op, 'la cible est bien écrite');
  assert.strictEqual(typeof op.data.balance, 'object', 'une valeur absolue écraserait un mouvement concurrent');
  assert.strictEqual(op.data.balance[INCREMENT], 3770);
});

test('réunion — journalisée dans stock_balance_reunions (délégation, pas duplication)', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute', '--only', 'reunions'], fb);
  const audits = Object.values(fb.collections.stock_balance_reunions);
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].source, 'scripts/reunir-soldes-fragmentes.js');
  assert.strictEqual(audits[0].total_attendu, 4000);
});

// ── 4. FAIL-CLOSED UNITÉS ───────────────────────────────────────────────────

test('unités divergentes — jamais exécuté, les deux documents restent en place', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer(['--execute'], fb);
  assert.strictEqual(r.bloques.length, 1);
  assert.ok(fb.collections.stock_balances.magasin_F2_KELPAK, 'kg intact');
  assert.ok(fb.collections.stock_balances['magasin_F2_IMP-042'], 'l intact');
  assert.strictEqual(fb.collections.stock_balances['magasin_F2_IMP-042'].balance, 3, 'aucune somme');
  const touches = fb.journal.writes.concat(fb.journal.deletes).map((o) => o.id);
  assert.ok(!touches.includes('magasin_F2_KELPAK'), 'aucun document du cas bloqué n\'est touché');
  assert.ok(!touches.includes('magasin_F2_IMP-042'));
});

// ── 5. ORPHELINS ────────────────────────────────────────────────────────────

test('orphelin — ni déplacé, ni supprimé, ni re-clé sous une identité inventée', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute'], fb);
  assert.ok(fb.collections.stock_balances.magasin_F2_TES, 'TES est toujours là');
  assert.strictEqual(fb.collections.stock_balances.magasin_F2_TES.balance, 6);
  const ids = Object.keys(fb.collections.stock_balances);
  assert.ok(!ids.some((id) => id !== 'magasin_F2_TES' && id.includes('TES')), 'aucune copie créée');
  const supprimes = fb.journal.deletes.map((o) => o.id);
  assert.ok(!supprimes.includes('magasin_F2_TES'));
});

// ── 6. SAUVEGARDE PRÉALABLE ─────────────────────────────────────────────────

test('exécution — la sauvegarde est écrite AVANT la première transaction', async () => {
  const fb = fauxFirestore(donnees());
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'recle-'));
  const chemin = path.join(dossier, 'backup.json');
  let transactionsQuandSauvegarde = null;
  const vrai = fs.writeFileSync;
  fs.writeFileSync = function (f, ...rest) {
    if (String(f) === chemin) transactionsQuandSauvegarde = fb.journal.transactions;
    return vrai.call(fs, f, ...rest);
  };
  try {
    await lancer(['--execute', '--backup', chemin], fb);
  } finally {
    fs.writeFileSync = vrai;
  }
  assert.strictEqual(transactionsQuandSauvegarde, 0, 'sauvegarde après écriture = filet inutile');
  const sauve = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  assert.ok(sauve.cas.length >= 2);
  assert.ok(sauve.orphelins.length >= 1, 'les orphelins figurent dans la sauvegarde');
  const dep = sauve.cas.find((c) => c.issue === 'deplacement');
  assert.strictEqual(dep.docs[0].balance, 9754, 'l\'état AVANT est bien celui d\'avant');
});

test('exécution — SANS --backup, la sauvegarde par défaut est écrite quand même', async () => {
  // Le filet ne doit pas dépendre d'une option que l'opérateur peut oublier :
  // en exécution, la sauvegarde est OBLIGATOIRE. Le chemin par défaut est
  // intercepté (et non écrit) pour ne rien laisser dans docs/.
  const fb = fauxFirestore(donnees());
  const vues = [];
  const vraiWrite = fs.writeFileSync;
  fs.writeFileSync = function (f, ...rest) {
    const p = String(f);
    if (/BACKUP-recle-soldes-\d{4}-\d{2}-\d{2}\.json$/.test(p)) {
      vues.push({ chemin: p, transactions: fb.journal.transactions });
      return undefined; // intercepté : rien n'est écrit dans le dépôt
    }
    return vraiWrite.call(fs, f, ...rest);
  };
  const vrai = console.log;
  const avant = process.env.RECLE_EXECUTE_CONFIRM;
  console.log = SILENCE;
  process.env.RECLE_EXECUTE_CONFIRM = 'OUI';
  const codeAvant = process.exitCode;
  try {
    await SCRIPT.main(['node', 'script', '--execute'], fb);
  } finally {
    process.exitCode = codeAvant;
    fs.writeFileSync = vraiWrite;
    console.log = vrai;
    if (avant === undefined) delete process.env.RECLE_EXECUTE_CONFIRM;
    else process.env.RECLE_EXECUTE_CONFIRM = avant;
  }
  assert.strictEqual(vues.length, 1, 'aucune sauvegarde écrite sans --backup');
  assert.strictEqual(vues[0].transactions, 0, 'sauvegarde après écriture = filet inutile');
  assert.ok(vues[0].chemin.includes(path.sep + 'docs' + path.sep), 'chemin par défaut sous docs/');
});

// ── 7. ARRÊT À LA PREMIÈRE ANOMALIE ─────────────────────────────────────────

test('exécution — le premier échec arrête tout, les suivants ne sont pas tentés', async () => {
  const fb = fauxFirestore(donnees());
  const casKO = {
    issue: 'deplacement', article_id: 'IMP-019', article_nom: 'X', lieu_type: 'magasin', lieu_id: 'F2',
    conserve: 'magasin_F2_IMP-019', supprimes: ['absent'], total: 1, anomalies: [],
    docs: [{ docId: 'absent', balance: 1 }],
  };
  const casOK = {
    issue: 'deplacement', article_id: 'IMP-019', article_nom: 'NITRETE DE POTASSE',
    lieu_type: 'magasin', lieu_id: 'F2', conserve: 'magasin_F2_IMP-019',
    supprimes: ['magasin_F2_NITRETE_DE_POTASSE'], total: 9754, anomalies: [],
    docs: [{ docId: 'magasin_F2_NITRETE_DE_POTASSE', balance: 9754 }],
  };
  const vrai = console.log;
  console.log = SILENCE;
  let res;
  try {
    res = await SCRIPT.executerPlan([casKO, casOK], fb);
  } finally {
    console.log = vrai;
  }
  assert.strictEqual(res.length, 1, 'le second cas n\'est pas tenté');
  assert.strictEqual(res[0].ok, false);
  assert.ok(fb.collections.stock_balances.magasin_F2_NITRETE_DE_POTASSE, 'intact');
});

// ── 8. IDEMPOTENCE ──────────────────────────────────────────────────────────

test('exécution — un second passage ne trouve plus rien à faire', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(['--execute'], fb);
  const apres = await lancer([], fb);
  assert.strictEqual(apres.executables.length, 0, 'la re-clé est idempotente');
  assert.strictEqual(apres.bloques.length, 1, 'sauf les cas bloqués, qui restent à trancher');
  assert.strictEqual(apres.orphelins.length, 1, 'et les orphelins, qui restent en place');
});
