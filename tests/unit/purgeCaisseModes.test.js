'use strict';

/**
 * Garde-fous des deux périmètres de purge de la Gestion de Caisse.
 *
 * Ces tests protègent le filet de sécurité de l'opération irréversible :
 *   - le mode PAR DÉFAUT (4 caisses opérationnelles) doit rester STRICTEMENT
 *     identique après l'ajout du mode --comptes-clients ;
 *   - le mode --comptes-clients doit exiger type='vente' et une collection
 *     entièrement vide après la purge.
 *
 * Les modules sont requis sans firebase-admin : purgeCaisse.js et
 * restoreCaisse.js chargent le SDK paresseusement, les helpers de contrôle sont
 * purs (aucun accès Firestore ni disque).
 */

const test = require('node:test');
const assert = require('node:assert');

const purge = require('../../functions/scripts/purgeCaisse.js');
const restore = require('../../functions/scripts/restoreCaisse.js');

const MODE_DEFAUT = purge.MODES['caisses-operationnelles'];
const MODE_CLIENTS = purge.MODES['comptes-clients'];

/** Construit une sélection {caisseId: [{id, data}]} conforme au périmètre. */
function buildSelection(mode, type, overrides) {
  const selection = {};
  for (const caisseId of mode.caisseIds) {
    const n = mode.expectedCounts[caisseId];
    selection[caisseId] = [];
    for (let i = 0; i < n; i += 1) {
      selection[caisseId].push({
        id: `${caisseId}_${i}`,
        data: { caisse_id: caisseId, type, montant: 10 },
      });
    }
  }
  if (typeof overrides === 'function') overrides(selection);
  return selection;
}

function totalOf(selection) {
  return Object.values(selection).reduce((acc, docs) => acc + docs.length, 0);
}

// --- Mode par défaut : périmètre et garde-fous historiques inchangés --------

test('mode par défaut : périmètre = les 4 caisses opérationnelles', () => {
  assert.deepStrictEqual(MODE_DEFAUT.caisseIds, [
    'caisse_depenses',
    'caisse_depenses_bahia',
    'caisse_paie',
    'caisse_marche_local_f5',
  ]);
  assert.deepStrictEqual(MODE_DEFAUT.expectedCounts, {
    caisse_depenses: 3456,
    caisse_depenses_bahia: 473,
    caisse_paie: 37,
    caisse_marche_local_f5: 1,
  });
  assert.strictEqual(MODE_DEFAUT.expectedVentesPreserved, 485);
  assert.deepStrictEqual(MODE_DEFAUT.typesInterdits, ['vente', 'encaissement']);
  assert.strictEqual(MODE_DEFAUT.typeAttendu, null);
});

test('resolveMode : sans flag on reste sur le mode par défaut', () => {
  assert.strictEqual(purge.resolveMode(['node', 'purgeCaisse.js']).key, 'caisses-operationnelles');
  assert.strictEqual(
    purge.resolveMode(['node', 'purgeCaisse.js', '--apply', '--stamp', 'x']).key,
    'caisses-operationnelles'
  );
  assert.strictEqual(
    purge.resolveMode(['node', 'purgeCaisse.js', '--comptes-clients']).key,
    'comptes-clients'
  );
});

test('mode par défaut : sélection nominale sans type interdit -> aucun problème', () => {
  const selection = buildSelection(MODE_DEFAUT, 'depense');
  const problems = purge.checkGuards(
    MODE_DEFAUT,
    selection,
    { venteCount: 485, totalCollection: totalOf(selection) + 485, preserveesCount: null },
    { resume: false }
  );
  assert.deepStrictEqual(problems, []);
});

test('mode par défaut : un doc type=vente reste BLOQUANT', () => {
  const selection = buildSelection(MODE_DEFAUT, 'depense', (sel) => {
    sel.caisse_paie[0].data.type = 'Vente';
  });
  const problems = purge.checkGuards(
    MODE_DEFAUT,
    selection,
    { venteCount: 485, totalCollection: totalOf(selection) + 485, preserveesCount: null },
    { resume: false }
  );
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /type='vente' — INTERDIT/);
});

test('mode par défaut : un doc type=encaissement reste BLOQUANT', () => {
  const selection = buildSelection(MODE_DEFAUT, 'depense', (sel) => {
    sel.caisse_depenses[0].data.type = 'encaissement';
  });
  const problems = purge.checkGuards(
    MODE_DEFAUT,
    selection,
    { venteCount: 485, totalCollection: totalOf(selection) + 485, preserveesCount: null },
    { resume: false }
  );
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /type='encaissement' — INTERDIT/);
});

test('mode par défaut : un nombre de ventes ≠ 485 est BLOQUANT', () => {
  const selection = buildSelection(MODE_DEFAUT, 'depense');
  const problems = purge.checkGuards(
    MODE_DEFAUT,
    selection,
    { venteCount: 0, totalCollection: totalOf(selection), preserveesCount: null },
    { resume: false }
  );
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /type='vente' : 0 au lieu de 485/);
});

test('mode par défaut : prod déjà purgée (0 doc) -> échec explicite sur les comptages', () => {
  // État prod du 2026-08-17 : les 4 caisses sont vides. Un dry-run doit
  // échouer, sans write, avec un écart par caisse — comportement attendu.
  const selection = {};
  for (const caisseId of MODE_DEFAUT.caisseIds) selection[caisseId] = [];
  const problems = purge.checkGuards(
    MODE_DEFAUT,
    selection,
    { venteCount: 485, totalCollection: 485, preserveesCount: null },
    { resume: false }
  );
  // 3 caisses sur 4 : caisse_marche_local_f5 n'attend qu'1 doc et la tolérance
  // plancher (±1) absorbe l'écart — les 3 autres suffisent à bloquer le run.
  assert.strictEqual(problems.length, 3);
  for (const p of problems) {
    assert.match(p, /doc\(s\) réels vs \d+ attendus/);
    // Périmètre vide : --resume n'aiderait pas (il n'autoriserait qu'un --apply
    // sans effet), le message ne doit donc pas le conseiller.
    assert.match(p, /le périmètre est VIDE/);
    assert.doesNotMatch(p, /relance avec --resume/);
  }
});

// --- Mode --comptes-clients ------------------------------------------------

test('mode comptes-clients : périmètre = les 5 comptes clients, 485 docs attendus', () => {
  assert.deepStrictEqual(MODE_CLIENTS.caisseIds.slice().sort(), [
    'compte_client_fruit_congel_du_nord',
    'compte_client_hamdouch_omar',
    'compte_client_iraqi_mohamed',
    'compte_client_mr_monaim_local',
    'compte_client_mustapha_chafik_a',
  ]);
  const total = Object.values(MODE_CLIENTS.expectedCounts).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 485);
  assert.strictEqual(MODE_CLIENTS.typeAttendu, 'vente');
  assert.strictEqual(MODE_CLIENTS.expectedTotalApres, 0);
  // Les 4 caisses opérationnelles ne sont PAS dans le périmètre de purge.
  assert.deepStrictEqual(MODE_CLIENTS.caissesPreservees, MODE_DEFAUT.caisseIds);
});

test('mode comptes-clients : 485 ventes, collection vide après -> aucun problème', () => {
  const selection = buildSelection(MODE_CLIENTS, 'vente');
  const problems = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: 485, totalCollection: 485, preserveesCount: 0 },
    { resume: false }
  );
  assert.deepStrictEqual(problems, []);
});

test('mode comptes-clients : un encaissement sur un compte client est BLOQUANT', () => {
  const selection = buildSelection(MODE_CLIENTS, 'vente', (sel) => {
    sel.compte_client_iraqi_mohamed[0].data.type = 'encaissement';
  });
  const problems = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: 484, totalCollection: 485, preserveesCount: 0 },
    { resume: false }
  );
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /type='encaissement' ≠ 'vente' attendu — INTERDIT/);
});

test('mode comptes-clients : une dépense ou un type absent est BLOQUANT', () => {
  const selection = buildSelection(MODE_CLIENTS, 'vente', (sel) => {
    sel.compte_client_hamdouch_omar[0].data.type = 'depense';
    delete sel.compte_client_fruit_congel_du_nord[0].data.type;
  });
  const problems = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: 483, totalCollection: 485, preserveesCount: 0 },
    { resume: false }
  );
  assert.strictEqual(problems.length, 2);
  assert.match(problems.join('\n'), /type='depense' ≠ 'vente'/);
  assert.match(problems.join('\n'), /type='' ≠ 'vente'/);
});

test('mode comptes-clients : un reliquat dans la collection est BLOQUANT', () => {
  const selection = buildSelection(MODE_CLIENTS, 'vente');
  const problems = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: 485, totalCollection: 488, preserveesCount: 0 },
    { resume: false }
  );
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /3 transaction\(s\) resteraient dans caisse_transactions/);
});

test('mode comptes-clients : un doc réapparu sur une caisse opérationnelle est BLOQUANT', () => {
  const selection = buildSelection(MODE_CLIENTS, 'vente');
  const problems = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: 485, totalCollection: 486, preserveesCount: 1 },
    { resume: false }
  );
  assert.strictEqual(problems.length, 2);
  assert.match(problems.join('\n'), /présent\(s\) sur les caisses opérationnelles/);
});

test('mode comptes-clients : un caisse_id hors périmètre est BLOQUANT', () => {
  const selection = buildSelection(MODE_CLIENTS, 'vente', (sel) => {
    sel.compte_client_mr_monaim_local[0].data.caisse_id = 'caisse_marche_local_f1';
  });
  const problems = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: 485, totalCollection: 485, preserveesCount: 0 },
    { resume: false }
  );
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /hors périmètre — INTERDIT/);
});

test('--resume : seul l’excès de documents reste bloquant', () => {
  const selection = buildSelection(MODE_CLIENTS, 'vente');
  selection.compte_client_mustapha_chafik_a = selection.compte_client_mustapha_chafik_a.slice(0, 10);
  const total = totalOf(selection);
  const sansResume = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: total, totalCollection: total, preserveesCount: 0 },
    { resume: false }
  );
  assert.strictEqual(sansResume.length, 1);
  // Purge partiellement exécutée (il reste des docs) : là, --resume est le bon
  // conseil et doit être proposé.
  assert.match(sansResume[0], /relance avec --resume/);
  const avecResume = purge.checkGuards(
    MODE_CLIENTS,
    selection,
    { venteCount: total, totalCollection: total, preserveesCount: 0 },
    { resume: true }
  );
  assert.deepStrictEqual(avecResume, []);
});

// --- Backup : nom de fichier + métadonnées de périmètre --------------------

test('le nom du backup distingue les deux modes', () => {
  assert.strictEqual(
    purge.backupFileName(MODE_DEFAUT, '2026-08-17'),
    'BACKUP-purge-caisse-2026-08-17.json'
  );
  assert.strictEqual(
    purge.backupFileName(MODE_CLIENTS, '2026-08-17'),
    'BACKUP-purge-comptes-clients-2026-08-17.json'
  );
});

test('le backup porte le périmètre et les règles de type', () => {
  const payloadClients = purge.buildBackupPayload(MODE_CLIENTS, 's', false, [], []);
  assert.strictEqual(payloadClients.perimetre, 'comptes-clients');
  assert.strictEqual(payloadClients.type_attendu, 'vente');
  assert.deepStrictEqual(payloadClients.purge_caisse_ids, MODE_CLIENTS.caisseIds);

  const payloadDefaut = purge.buildBackupPayload(MODE_DEFAUT, 's', false, [], []);
  assert.strictEqual(payloadDefaut.perimetre, 'caisses-operationnelles');
  assert.strictEqual(payloadDefaut.type_attendu, null);
  assert.deepStrictEqual(payloadDefaut.types_interdits, ['vente', 'encaissement']);
});

// --- restoreCaisse : contrôles pilotés par le backup ------------------------

function backupOf(mode, docs) {
  const payload = purge.buildBackupPayload(
    mode,
    's',
    false,
    docs,
    mode.caisseIds.map((id) => ({ id, data: { solde_initial: 0, solde_actuel: 0 } }))
  );
  return payload;
}

test('restore : un backup comptes-clients (ventes) passe les contrôles', () => {
  const payload = backupOf(MODE_CLIENTS, [
    { id: 'a', caisse_id: 'compte_client_iraqi_mohamed', data: { caisse_id: 'compte_client_iraqi_mohamed', type: 'vente', montant: 1 } },
  ]);
  assert.deepStrictEqual(restore.checkBackup(payload), []);
});

test('restore : un backup comptes-clients contenant un encaissement est refusé', () => {
  const payload = backupOf(MODE_CLIENTS, [
    { id: 'a', caisse_id: 'compte_client_iraqi_mohamed', data: { caisse_id: 'compte_client_iraqi_mohamed', type: 'encaissement', montant: 1 } },
  ]);
  const problems = restore.checkBackup(payload);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /≠ 'vente'/);
});

test('restore : un backup du mode par défaut refuse toujours vente/encaissement', () => {
  const payload = backupOf(MODE_DEFAUT, [
    { id: 'a', caisse_id: 'caisse_depenses', data: { caisse_id: 'caisse_depenses', type: 'vente', montant: 1 } },
  ]);
  const problems = restore.checkBackup(payload);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /n’en contient jamais/);
});

// --- restore : vérif post-write (chemin --apply, double de Firestore) ------

/**
 * Double minimal de Firestore : compte les transactions par caisse et sert les
 * caisse_definitions. Seul moyen d'exercer verifyPostWrite hors ligne — c'est
 * le chemin où s'est glissé un `db is not defined` invisible en dry-run.
 */
function fakeDb(countsByCaisse, definitions) {
  return {
    collection(name) {
      if (name === 'caisse_transactions') {
        return {
          where(field, op, value) {
            assert.strictEqual(field, 'caisse_id');
            assert.strictEqual(op, '==');
            return {
              count: () => ({
                get: async () => ({ data: () => ({ count: countsByCaisse[value] || 0 }) }),
              }),
            };
          },
        };
      }
      assert.strictEqual(name, 'caisse_definitions');
      return {
        doc(id) {
          return {
            get: async () => ({
              exists: Object.prototype.hasOwnProperty.call(definitions, id),
              data: () => definitions[id],
            }),
          };
        },
      };
    },
  };
}

test('restore/verifyPostWrite : restauration conforme -> aucune erreur', async () => {
  const byCaisse = new Map([
    ['compte_client_iraqi_mohamed', [{ id: 'a' }, { id: 'b' }]],
    ['compte_client_hamdouch_omar', [{ id: 'c' }]],
  ]);
  const soldesCibles = new Map([
    ['compte_client_iraqi_mohamed', { solde_initial: 0, solde_actuel: 58104 }],
    ['compte_client_hamdouch_omar', { solde_initial: 0, solde_actuel: 4410 }],
  ]);
  const db = fakeDb(
    { compte_client_iraqi_mohamed: 2, compte_client_hamdouch_omar: 1 },
    {
      compte_client_iraqi_mohamed: { solde_initial: 0, solde_actuel: 58104 },
      compte_client_hamdouch_omar: { solde_initial: 0, solde_actuel: 4410 },
    }
  );
  await restore.verifyPostWrite(byCaisse, soldesCibles, { db });
});

test('restore/verifyPostWrite : compte ou solde non conforme -> échec bloquant', async () => {
  const byCaisse = new Map([['compte_client_iraqi_mohamed', [{ id: 'a' }, { id: 'b' }]]]);
  const soldesCibles = new Map([
    ['compte_client_iraqi_mohamed', { solde_initial: 0, solde_actuel: 58104 }],
  ]);
  const db = fakeDb(
    { compte_client_iraqi_mohamed: 1 },
    { compte_client_iraqi_mohamed: { solde_initial: 0, solde_actuel: 42 } }
  );
  await assert.rejects(
    () => restore.verifyPostWrite(byCaisse, soldesCibles, { db }),
    /VÉRIF POST-WRITE ÉCHOUÉE/
  );
});

test('restore/verifyPostWrite : caisse_definitions disparue -> échec bloquant', async () => {
  const byCaisse = new Map([['compte_client_iraqi_mohamed', [{ id: 'a' }]]]);
  const soldesCibles = new Map([
    ['compte_client_iraqi_mohamed', { solde_initial: 0, solde_actuel: 58104 }],
  ]);
  const db = fakeDb({ compte_client_iraqi_mohamed: 1 }, {});
  await assert.rejects(
    () => restore.verifyPostWrite(byCaisse, soldesCibles, { db }),
    /caisse_definitions absente après write/
  );
});

test('restore : un backup HÉRITÉ (sans métadonnées) garde les règles historiques', () => {
  const legacy = {
    purge_caisse_ids: ['caisse_depenses'],
    caisse_transactions_a_supprimer: [
      { id: 'a', data: { caisse_id: 'caisse_depenses', type: 'depense', montant: 1 } },
    ],
    caisse_definitions: [{ id: 'caisse_depenses', data: { solde_initial: 0, solde_actuel: 0 } }],
  };
  const rules = restore.backupRules(legacy);
  assert.strictEqual(rules.perimetre, 'caisses-operationnelles');
  assert.strictEqual(rules.typeAttendu, null);
  assert.deepStrictEqual(rules.typesInterdits, ['vente', 'encaissement']);
  assert.deepStrictEqual(restore.checkBackup(legacy), []);

  legacy.caisse_transactions_a_supprimer[0].data.type = 'vente';
  assert.strictEqual(restore.checkBackup(legacy).length, 1);
});
