'use strict';

/*
 * scripts/corriger-unite-stock.js — LES TROIS GESTES, ET LE JOURNAL.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - le mode rapport écrit en base ;
 *  - le double verrou devient contournable ;
 *  - le solde DÉJÀ en kg est reconverti (3 420 × 1,75) ;
 *  - le facteur change de valeur ;
 *  - la fiche est corrigée sans ses soldes, ou l'inverse (pas atomique) ;
 *  - le journal d'audit n'est plus écrit, ou perd l'état AVANT ;
 *  - un document modifié depuis le rapport est écrasé au lieu de faire échouer ;
 *  - la sauvegarde préalable n'est plus obligatoire.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SCRIPT = require('../../scripts/corriger-unite-stock');

const HORODATAGE = Symbol('serverTimestamp');

function fauxFirestore(donnees) {
  const journal = { writes: [], transactions: 0, ordre: [] };
  const collections = {
    stock_balances: donnees.stock_balances || {},
    articles_catalog: donnees.articles_catalog || {},
    stock_unite_corrections: {},
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
        set: (ref, data, options) => ops.push({ type: 'set', collection: ref.__collection, id: ref.id, data, options }),
        delete: (ref) => ops.push({ type: 'delete', collection: ref.__collection, id: ref.id }),
      };
      await fn(t); // exception ici = transaction annulée, rien n'est appliqué
      for (const op of ops) {
        journal.ordre.push(op.type + ':' + op.collection + ':' + op.id);
        journal.writes.push(op);
        collections[op.collection][op.id] = Object.assign({}, collections[op.collection][op.id] || {}, op.data);
      }
    },
  };
  const admin = { firestore: { FieldValue: { serverTimestamp: () => ({ [HORODATAGE]: true }) } } };
  return { db, admin, journal, collections };
}

function donnees() {
  return {
    articles_catalog: {
      'IMP-001': { nom: 'ACIDE SULFRIQUE (L)', unite: 'L', active: true },
      'IMP-005': { nom: 'AZO PRO 31', unite: 'kg', active: true },
    },
    stock_balances: {
      magasin_F2_ACIDE_SULFRIQUE: { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'ACIDE SULFRIQUE', article_nom: 'ACIDE SULFRIQUE', balance: 3420, unite: 'kg' },
      'magasin_F2_ACIDE_SULFRIQUE_(L)': { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'ACIDE SULFRIQUE (L)', article_nom: 'ACIDE SULFRIQUE (L)', balance: -8, unite: 'l' },
      // même article, AUTRE lieu : ne doit pas être touché
      'magasin_F5_ACIDE_SULFRIQUE_(L)': { lieu_type: 'magasin', lieu_id: 'F5', article_ref: 'ACIDE SULFRIQUE (L)', balance: -4, unite: 'l' },
      // autre article, même lieu : ne doit pas être touché
      magasin_F2_AZO_PRO_31: { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'AZO PRO 31', balance: 100, unite: 'kg' },
    },
  };
}

const SILENCE = () => {};

const CIBLE_ACIDE = ['--fiche', 'IMP-001', '--lieu', 'magasin/F2'];

async function lancer(argv, fb, opts) {
  const vrai = console.log;
  const vraiErr = console.error;
  const avant = process.env.ACIDE_EXECUTE_CONFIRM;
  const codeAvant = process.exitCode;
  console.log = SILENCE;
  console.error = SILENCE;
  let args = argv;
  if (argv.includes('--execute') && !(opts && opts.sansVerrou)) {
    process.env.ACIDE_EXECUTE_CONFIRM = 'OUI';
    if (!argv.includes('--backup')) {
      const b = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acide-')), 'backup.json');
      args = argv.concat(['--backup', b]);
    }
  } else {
    delete process.env.ACIDE_EXECUTE_CONFIRM;
  }
  try {
    const r = await SCRIPT.main(['node', 'script'].concat(args), fb);
    return Object.assign({ exitCode: process.exitCode }, r);
  } finally {
    process.exitCode = codeAvant;
    console.log = vrai;
    console.error = vraiErr;
    if (avant === undefined) delete process.env.ACIDE_EXECUTE_CONFIRM;
    else process.env.ACIDE_EXECUTE_CONFIRM = avant;
  }
}

// ── DOUBLE VERROU ───────────────────────────────────────────────────────────

test('parseArgs — rapport par défaut, AUCUNE cible par défaut', () => {
  const o = SCRIPT.parseArgs(['node', 's'], {});
  assert.strictEqual(o.mode, 'report');
  assert.strictEqual(o.ficheId, '', 'un article visé par défaut est un piège');
  assert.strictEqual(o.lieuType, '');
  assert.strictEqual(o.lieuId, '');
});

test('sans --fiche/--lieu : REFUS, aucune lecture, aucune écriture, sortie 2', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer(['--execute'], fb);
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(fb.journal.transactions, 0);
  assert.strictEqual(fb.collections.articles_catalog['IMP-001'].unite, 'L');
});

test('le journal porte la décision de CET article, pas une phrase figée', async () => {
  const d = donnees();
  d.articles_catalog['Ref-Eng0056'] = { nom: 'Rhizo amine', unite: 'KG', active: true };
  d.stock_balances.station_Station_F5_Ref_Eng0056 = { lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Ref-Eng0056', article_nom: 'Rhizo amine', balance: -25.1, unite: 'l' };
  const fb = fauxFirestore(d);
  await lancer(['--fiche', 'Ref-Eng0056', '--lieu', 'station/Station F5', '--execute'], fb);
  const a = Object.values(fb.collections.stock_unite_corrections)[0];
  assert.match(a.decision, /20 kg = 18 L/);
  assert.strictEqual(Math.round(a.facteur_kg_par_litre * 1e6) / 1e6, 1.111111);
  assert.strictEqual(fb.collections.stock_balances.station_Station_F5_Ref_Eng0056.balance, -27.89);
  assert.strictEqual(fb.collections.stock_balances.station_Station_F5_Ref_Eng0056.unite, 'kg');
});

test('une fiche hors table arbitrée — REFUS, aucune écriture', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer(['--fiche', 'IMP-005', '--lieu', 'magasin/F2', '--execute'], fb);
  assert.strictEqual(r.plan.ok, false);
  assert.strictEqual(fb.journal.transactions, 0);
});

test('parseArgs — --execute sans la variable = REFUS', () => {
  const o = SCRIPT.parseArgs(['node', 's', '--execute'], {});
  assert.strictEqual(o.mode, 'report');
  assert.strictEqual(o.refus, true);
});

test('parseArgs — une valeur approchante ne déverrouille pas', () => {
  for (const v of ['oui', 'OUI ', 'yes', '1', '']) {
    assert.strictEqual(SCRIPT.parseArgs(['node', 's', '--execute'], { ACIDE_EXECUTE_CONFIRM: v }).mode, 'report');
  }
});

test('--execute sans la variable : AUCUNE écriture, sortie 2', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer(CIBLE_ACIDE.concat(['--execute']), fb, { sansVerrou: true });
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(fb.journal.transactions, 0);
  assert.strictEqual(fb.collections.articles_catalog['IMP-001'].unite, 'L');
});

// ── RAPPORT ─────────────────────────────────────────────────────────────────

test('rapport — aucune transaction, aucune écriture', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer(CIBLE_ACIDE, fb);
  assert.strictEqual(fb.journal.transactions, 0);
  assert.strictEqual(fb.journal.writes.length, 0);
  assert.strictEqual(r.plan.ok, true, (r.plan.refus || []).join(' | '));
  assert.strictEqual(r.audit_id, null);
});

test('rapport — le nom cible est déduit en retirant le suffixe d\'unité', async () => {
  const fb = fauxFirestore(donnees());
  const r = await lancer(CIBLE_ACIDE, fb);
  assert.strictEqual(r.plan.fiche.nom_apres, 'ACIDE SULFRIQUE');
});

// ── EXÉCUTION ───────────────────────────────────────────────────────────────

test('exécution — fiche au kg, nom sans suffixe', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  const f = fb.collections.articles_catalog['IMP-001'];
  assert.strictEqual(f.unite, 'kg');
  assert.strictEqual(f.nom, 'ACIDE SULFRIQUE');
  assert.strictEqual(f.active, true, 'les autres champs sont préservés (merge)');
});

test('exécution — le fragment litres devient -14 kg, le solde kg est INTACT', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  const l = fb.collections.stock_balances['magasin_F2_ACIDE_SULFRIQUE_(L)'];
  assert.strictEqual(l.balance, -14);
  assert.strictEqual(l.unite, 'kg');
  const kg = fb.collections.stock_balances.magasin_F2_ACIDE_SULFRIQUE;
  assert.strictEqual(kg.balance, 3420, '3 420 × 1,75 serait une catastrophe silencieuse');
  assert.strictEqual(kg.unite, 'kg');
});

test('exécution — somme des deux soldes du lieu = 3 406 kg', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  const b = fb.collections.stock_balances;
  const total = b.magasin_F2_ACIDE_SULFRIQUE.balance + b['magasin_F2_ACIDE_SULFRIQUE_(L)'].balance;
  assert.strictEqual(total, 3406);
});

test('exécution — les autres lieux et les autres articles ne bougent pas', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  assert.strictEqual(fb.collections.stock_balances['magasin_F5_ACIDE_SULFRIQUE_(L)'].balance, -4);
  assert.strictEqual(fb.collections.stock_balances['magasin_F5_ACIDE_SULFRIQUE_(L)'].unite, 'l');
  assert.strictEqual(fb.collections.stock_balances.magasin_F2_AZO_PRO_31.balance, 100);
});

test('exécution — UNE seule transaction : fiche et soldes, tout ou rien', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  assert.strictEqual(fb.journal.transactions, 1);
  const cibles = fb.journal.ordre;
  assert.ok(cibles.includes('set:articles_catalog:IMP-001'));
  assert.ok(cibles.includes('set:stock_balances:magasin_F2_ACIDE_SULFRIQUE_(L)'));
});

test('exécution — journal écrit AVANT les mutations, avec l\'état AVANT et la décision', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  const audits = Object.values(fb.collections.stock_unite_corrections);
  assert.strictEqual(audits.length, 1);
  const a = audits[0];
  assert.strictEqual(a.facteur_kg_par_litre, 1.75);
  assert.match(a.decision, /Omar/);
  assert.match(a.decision, /35 kg = 20 L/);
  assert.strictEqual(a.fiche_avant.unite, 'L');
  assert.strictEqual(a.fiche_avant.nom, 'ACIDE SULFRIQUE (L)');
  assert.strictEqual(a.fiche_apres.unite, 'kg');
  assert.strictEqual(a.soldes_avant[0].balance, -8);
  assert.strictEqual(a.soldes_avant[0].unite, 'l');
  assert.strictEqual(a.soldes_apres[0].balance, -14);
  const iAudit = fb.journal.ordre.findIndex((o) => o.startsWith('set:stock_unite_corrections'));
  const iFiche = fb.journal.ordre.indexOf('set:articles_catalog:IMP-001');
  assert.ok(iAudit > -1 && iAudit < iFiche, 'aucune mutation sans sa trace de retour arrière');
});

// ── FAIL-LOUD ───────────────────────────────────────────────────────────────

test('un solde modifié depuis le rapport fait ÉCHOUER, rien n\'est écrit', async () => {
  const fb = fauxFirestore(donnees());
  const plan = {
    facteur: 1.75,
    fiche: { id: 'IMP-001', nom_avant: 'ACIDE SULFRIQUE (L)', nom_apres: 'ACIDE SULFRIQUE', unite_avant: 'L', unite_apres: 'kg' },
    conversions: [{ docId: 'magasin_F2_ACIDE_SULFRIQUE_(L)', balance_avant: -999, unite_avant: 'l', balance_apres: -1748.25, unite_apres: 'kg' }],
    inchanges: [],
  };
  await assert.rejects(
    () => SCRIPT.appliquerCorrection(plan, { lieu_type: 'magasin', lieu_id: 'F2' }, fb),
    /a changé depuis le rapport/
  );
  assert.strictEqual(fb.collections.articles_catalog['IMP-001'].unite, 'L', 'la fiche n\'a pas bougé');
  assert.strictEqual(fb.collections.stock_balances['magasin_F2_ACIDE_SULFRIQUE_(L)'].balance, -8);
});

test('une fiche renommée depuis le rapport fait ÉCHOUER', async () => {
  const fb = fauxFirestore(donnees());
  const plan = {
    facteur: 1.75,
    fiche: { id: 'IMP-001', nom_avant: 'AUTRE CHOSE', nom_apres: 'ACIDE SULFRIQUE', unite_avant: 'L', unite_apres: 'kg' },
    conversions: [],
    inchanges: [],
  };
  await assert.rejects(
    () => SCRIPT.appliquerCorrection(plan, { lieu_type: 'magasin', lieu_id: 'F2' }, fb),
    /renommée depuis le rapport/
  );
  assert.strictEqual(fb.collections.articles_catalog['IMP-001'].nom, 'ACIDE SULFRIQUE (L)');
});

test('renommage ambigu — REFUS, aucune écriture, sortie 1', async () => {
  const d = donnees();
  d.articles_catalog['IMP-998'] = { nom: 'Acide  Sulfrique', unite: 'kg', active: true };
  const fb = fauxFirestore(d);
  const r = await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  assert.strictEqual(r.plan.ok, false);
  assert.strictEqual(fb.journal.transactions, 0);
  assert.strictEqual(fb.collections.articles_catalog['IMP-001'].unite, 'L');
});

// ── SAUVEGARDE PRÉALABLE ────────────────────────────────────────────────────

test('exécution — SANS --backup, la sauvegarde par défaut est écrite AVANT la transaction', async () => {
  const fb = fauxFirestore(donnees());
  const vues = [];
  const vraiWrite = fs.writeFileSync;
  fs.writeFileSync = function (f, ...rest) {
    const p = String(f);
    if (/BACKUP-unite-.*\.json$/.test(p)) {
      vues.push({ chemin: p, transactions: fb.journal.transactions });
      return undefined; // intercepté : rien n'est écrit dans le dépôt
    }
    return vraiWrite.call(fs, f, ...rest);
  };
  const vrai = console.log;
  const avant = process.env.ACIDE_EXECUTE_CONFIRM;
  const codeAvant = process.exitCode;
  console.log = SILENCE;
  process.env.ACIDE_EXECUTE_CONFIRM = 'OUI';
  try {
    await SCRIPT.main(['node', 'script'].concat(CIBLE_ACIDE, ['--execute']), fb);
  } finally {
    process.exitCode = codeAvant;
    fs.writeFileSync = vraiWrite;
    console.log = vrai;
    if (avant === undefined) delete process.env.ACIDE_EXECUTE_CONFIRM;
    else process.env.ACIDE_EXECUTE_CONFIRM = avant;
  }
  assert.strictEqual(vues.length, 1, 'aucune sauvegarde écrite sans --backup');
  assert.strictEqual(vues[0].transactions, 0, 'sauvegarde après écriture = filet inutile');
});

test('rapport — sans --backup, aucun fichier laissé derrière', async () => {
  const fb = fauxFirestore(donnees());
  const avant = fs.readdirSync(path.resolve(__dirname, '../../docs'));
  await lancer(CIBLE_ACIDE, fb);
  assert.deepStrictEqual(fs.readdirSync(path.resolve(__dirname, '../../docs')), avant);
});

// ── IDEMPOTENCE ─────────────────────────────────────────────────────────────

test('un second passage ne reconvertit rien', async () => {
  const fb = fauxFirestore(donnees());
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  await lancer(CIBLE_ACIDE.concat(['--execute']), fb);
  const b = fb.collections.stock_balances;
  assert.strictEqual(b['magasin_F2_ACIDE_SULFRIQUE_(L)'].balance, -14, 'jamais -24,5');
  assert.strictEqual(b.magasin_F2_ACIDE_SULFRIQUE.balance, 3420);
});
