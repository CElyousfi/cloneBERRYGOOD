'use strict';

/**
 * Non-regression tests for the 3 bugs fixed on "Magasinier — BDC à
 * réceptionner" (commit 178a530, branche fix/magasinier-bdc-reception) :
 *
 *   1. `list-bdc` (functions/index.js ~L6624-6640) : `status` accepte une
 *      liste comma-separated et filtre AVANT troncature (.limit(200)),
 *      via `.where("status","in",statuses)`. Avant le fix, un BDC valide
 *      pouvait disparaître de la liste si plus de 200 BDC d'autres statuts
 *      passaient devant lui dans la collection.
 *   2. `MagBdcReceptionTab.loadData` (public/app.jsx ~L50726-50740) : le
 *      filtre client exclut les BDC `delivery_status === 'complet'` en plus
 *      du filtre de statut.
 *   3. `create-bl` (functions/index.js ~L7298-7388) : refuse (400) une
 *      réception si `bdc.delivery_status === "complet"` (double réception).
 *
 * IMPORTANT — limite de couverture :
 * `functions/index.js` est un monolithe HTTP sans harnais de test
 * (pas d'émulateur Firestore câblé dans `npm run qa`, pas d'injection de
 * dépendance pour `db_firestore`). Il n'existe donc aucun pattern
 * exploitable dans ce repo pour exercer directement le handler HTTP réel
 * via node:test (cf. tests/test-workflows.js, qui cible un émulateur lancé
 * MANUELLEMENT hors du gate `npm run qa` — non utilisable ici).
 *
 * Les fonctions ci-dessous sont donc des MIROIRS fidèles (copie verbatim
 * de la logique de branchement, avec les mêmes lignes de code) des
 * extraits de functions/index.js et public/app.jsx concernés, exercés via
 * un faux client Firestore in-memory qui reproduit la sémantique
 * where()/orderBy()/limit()/get() du SDK Admin. Objectif : verrouiller le
 * COMPORTEMENT (ordre filtre-puis-troncature, garde de double réception)
 * de façon exécutable, pas juste de la doc.
 *
 * Risque de drift documenté : si functions/index.js ou public/app.jsx sont
 * modifiés sur ces blocs sans mettre à jour ce fichier, les tests peuvent
 * rester verts alors que le code source a divergé. Recommandation pour un
 * futur ticket : extraire ces blocs en pure functions partagées dans
 * functions/lib/bdc/ (même pattern que functions/lib/bdc/workflow.js) pour
 * supprimer ce risque — hors scope de cet item (tests uniquement).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ============================================================================
// Fake Firestore query builder — reproduit juste assez de la sémantique du
// SDK Admin (where/orderBy/limit/get) pour exercer l'algorithme de list-bdc.
// ============================================================================

class FakeQuery {
  constructor(docs) {
    this._docs = docs;
  }
  where(field, op, val) {
    let filtered;
    if (op === '==') filtered = this._docs.filter((d) => d[field] === val);
    else if (op === 'in') filtered = this._docs.filter((d) => val.includes(d[field]));
    else throw new Error(`Unsupported op in fake query: ${op}`);
    return new FakeQuery(filtered);
  }
  orderBy(field, dir) {
    const sorted = [...this._docs].sort((a, b) =>
      dir === 'desc' ? (b[field] || 0) - (a[field] || 0) : (a[field] || 0) - (b[field] || 0)
    );
    return new FakeQuery(sorted);
  }
  limit(n) {
    return new FakeQuery(this._docs.slice(0, n));
  }
  async get() {
    return { docs: this._docs.map((d) => ({ id: d.id, data: () => d })) };
  }
}

class FakeFirestore {
  constructor(seedDocs) {
    this._seed = seedDocs;
  }
  collection(name) {
    if (name !== 'purchase_orders') throw new Error(`Unexpected collection in fake db: ${name}`);
    return new FakeQuery(this._seed);
  }
}

/**
 * Miroir verbatim de l'algorithme functions/index.js action "list-bdc"
 * (~L6624-6640), avec db_firestore remplacé par le fake ci-dessus.
 */
async function listBdc(db_firestore, reqQuery) {
  const ferme = reqQuery.ferme;
  const status = reqQuery.status;
  const statuses = status ? String(status).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const limit = parseInt(reqQuery.limit || '200');
  let query = db_firestore.collection('purchase_orders');
  const hasFilter = ferme || statuses.length > 0;
  if (ferme) query = query.where('ferme', '==', ferme);
  if (statuses.length === 1) query = query.where('status', '==', statuses[0]);
  else if (statuses.length > 1) query = query.where('status', 'in', statuses);
  if (!hasFilter) query = query.orderBy('created_at', 'desc');
  query = query.limit(limit);
  const snap = await query.get();
  let bdc = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  if (hasFilter) bdc.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return { success: true, bdc };
}

// ============================================================================
// Scénario 1 — BDC au-delà de la limite de troncature (bug 1)
// ============================================================================

test('list-bdc: le filtre status (comma-separated) est appliqué AVANT la troncature limit(200)', async () => {
  // 250 BDC "brouillon" plus récents que les 2 BDC "valide_dg" et "envoye"
  // ciblés : sur une requête tous-statuts + limit(200) naïve, ces 2 BDC
  // seraient hors de la fenêtre. Avec le fix (where("status","in",...)
  // avant limit), ils doivent toujours ressortir.
  const bruitStatuses = [];
  for (let i = 0; i < 250; i++) {
    bruitStatuses.push({ id: `bruit_${i}`, status: 'brouillon', created_at: 100000 - i });
  }
  const cibles = [
    { id: 'cible_valide_dg', status: 'valide_dg', created_at: 1 },
    { id: 'cible_envoye', status: 'envoye', created_at: 2 },
  ];
  const seed = [...bruitStatuses, ...cibles];
  const db = new FakeFirestore(seed);

  const result = await listBdc(db, { status: 'valide_dg,envoye', limit: '200' });

  assert.equal(result.success, true);
  const ids = result.bdc.map((b) => b.id).sort();
  assert.deepEqual(ids, ['cible_envoye', 'cible_valide_dg']);
});

test('list-bdc: statut unique utilise where("status","==",…) (pas "in")', async () => {
  const seed = [
    { id: 'a', status: 'valide_dg', created_at: 1 },
    { id: 'b', status: 'envoye', created_at: 2 },
  ];
  const db = new FakeFirestore(seed);
  const result = await listBdc(db, { status: 'valide_dg', limit: '200' });
  assert.deepEqual(result.bdc.map((b) => b.id), ['a']);
});

test('list-bdc: sans filtre status, comportement inchangé (tous statuts, limité, orderBy created_at desc)', async () => {
  const seed = [
    { id: 'old', status: 'brouillon', created_at: 1 },
    { id: 'new', status: 'valide_dg', created_at: 2 },
  ];
  const db = new FakeFirestore(seed);
  const result = await listBdc(db, { limit: '200' });
  assert.deepEqual(result.bdc.map((b) => b.id), ['new', 'old']);
});

// ============================================================================
// Scénario 2 — filtre client delivery_status === 'complet' (bug 2)
// ============================================================================

/**
 * Miroir verbatim du filtre client de MagBdcReceptionTab.loadData
 * (public/app.jsx ~L50734) :
 *   (bdcJson.bdc || []).filter(b => ['valide_dg', 'envoye', 'virement_lance', 'virement_signe'].includes(b.status) && b.delivery_status !== 'complet')
 *
 * Périmètre étendu (2026-08-04, BDC-2026-0123) : un BDC en mode paiement
 * virement transite par `virement_lance` puis `virement_signe` AVANT
 * d'atteindre `envoye`. Ce sont des états intermédiaires normaux et
 * fréquents du circuit — un BDC dans cet état doit rester réceptionnable
 * (cf. functions/index.js action "request-bdc-change" ~L7014, qui utilise
 * déjà cette liste à 4 statuts comme référence de "validé DG ou plus loin
 * dans le circuit").
 */
function filterBdcForReception(bdcList) {
  return (bdcList || []).filter(
    (b) => ['valide_dg', 'envoye', 'virement_lance', 'virement_signe'].includes(b.status) && b.delivery_status !== 'complet'
  );
}

test('MagBdcReceptionTab filter: exclut les BDC delivery_status="complet" même si status est valide', () => {
  const bdcList = [
    { id: 'ok', status: 'valide_dg', delivery_status: 'non_livre' },
    { id: 'ok_partiel', status: 'envoye', delivery_status: 'partiel' },
    { id: 'deja_recu', status: 'valide_dg', delivery_status: 'complet' },
    { id: 'mauvais_statut', status: 'brouillon', delivery_status: 'non_livre' },
  ];
  const result = filterBdcForReception(bdcList);
  assert.deepEqual(result.map((b) => b.id).sort(), ['ok', 'ok_partiel']);
});

test('MagBdcReceptionTab filter: BDC en circuit virement (virement_lance/virement_signe) restent réceptionnables', () => {
  // Scénario réel signalé par Omar en QA : BDC-2026-0123, status
  // "virement_signe", delivery_status "non_livre" — devait apparaître dans
  // la liste "BDC à réceptionner" et n'y apparaissait pas (bug).
  const bdcList = [
    { id: 'BDC-2026-0123', status: 'virement_signe', delivery_status: 'non_livre' },
    { id: 'virement_lance_ok', status: 'virement_lance', delivery_status: 'partiel' },
    { id: 'virement_signe_complet', status: 'virement_signe', delivery_status: 'complet' },
  ];
  const result = filterBdcForReception(bdcList);
  assert.deepEqual(result.map((b) => b.id).sort(), ['BDC-2026-0123', 'virement_lance_ok']);
});

test('MagBdcReceptionTab filter: liste vide -> résultat vide (pas de crash)', () => {
  assert.deepEqual(filterBdcForReception([]), []);
  assert.deepEqual(filterBdcForReception(undefined), []);
});

// ============================================================================
// Scénario 3 — double réception rejetée par create-bl (bug 3)
// ============================================================================

/**
 * Miroir verbatim de la garde d'entrée de create-bl (functions/index.js
 * ~L7307-7312) :
 *   if (!["valide_dg", "envoye", "virement_lance", "virement_signe"].includes(bdc.status)) -> 400
 *   if (bdc.delivery_status === "complet") -> 400
 * Retourne null si la réception est autorisée, sinon {status, error}.
 */
function guardCreateBl(bdc) {
  if (!['valide_dg', 'envoye', 'virement_lance', 'virement_signe'].includes(bdc.status)) {
    return { status: 400, error: 'Le BDC doit être validé ou envoyé pour recevoir un BL' };
  }
  if (bdc.delivery_status === 'complet') {
    return { status: 400, error: 'Ce BDC est déjà entièrement réceptionné.' };
  }
  return null;
}

/**
 * Simule le handler create-bl : exécute la garde puis, seulement si elle
 * passe, "écrit" (delivery_note + stock_movement) via les spies fournis.
 * Reproduit fidèlement l'ordre réel : la garde est la toute première chose
 * exécutée après le fetch du BDC, avant toute écriture.
 */
function simulateCreateBl(bdc, writeSpies) {
  const guardResult = guardCreateBl(bdc);
  if (guardResult) {
    return { success: false, ...guardResult };
  }
  writeSpies.createDeliveryNote();
  writeSpies.createStockMovement();
  writeSpies.updateBdcDeliveryStatus();
  return { success: true };
}

test('create-bl: rejette (400) une réception sur un BDC delivery_status="complet"', () => {
  const bdc = { status: 'valide_dg', delivery_status: 'complet' };
  const calls = { deliveryNote: 0, stockMovement: 0, updateBdc: 0 };
  const spies = {
    createDeliveryNote: () => calls.deliveryNote++,
    createStockMovement: () => calls.stockMovement++,
    updateBdcDeliveryStatus: () => calls.updateBdc++,
  };

  const result = simulateCreateBl(bdc, spies);

  assert.equal(result.success, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /entièrement réceptionné/);
  // Aucune écriture ne doit avoir eu lieu : pas de nouveau delivery_note
  // ni stock_movement pour un BDC déjà complet (double réception).
  assert.equal(calls.deliveryNote, 0);
  assert.equal(calls.stockMovement, 0);
  assert.equal(calls.updateBdc, 0);
});

test('create-bl: autorise la réception si status valide et delivery_status != "complet"', () => {
  for (const deliveryStatus of ['non_livre', 'partiel', undefined]) {
    const bdc = { status: 'envoye', delivery_status: deliveryStatus };
    const calls = { deliveryNote: 0, stockMovement: 0, updateBdc: 0 };
    const spies = {
      createDeliveryNote: () => calls.deliveryNote++,
      createStockMovement: () => calls.stockMovement++,
      updateBdcDeliveryStatus: () => calls.updateBdc++,
    };

    const result = simulateCreateBl(bdc, spies);

    assert.equal(result.success, true, `delivery_status=${deliveryStatus} devrait être autorisé`);
    assert.equal(calls.deliveryNote, 1);
    assert.equal(calls.stockMovement, 1);
    assert.equal(calls.updateBdc, 1);
  }
});

test('create-bl: autorise la réception sur un BDC en circuit virement (virement_lance/virement_signe)', () => {
  for (const status of ['virement_lance', 'virement_signe']) {
    const bdc = { status, delivery_status: 'non_livre' };
    const calls = { deliveryNote: 0, stockMovement: 0, updateBdc: 0 };
    const spies = {
      createDeliveryNote: () => calls.deliveryNote++,
      createStockMovement: () => calls.stockMovement++,
      updateBdcDeliveryStatus: () => calls.updateBdc++,
    };

    const result = simulateCreateBl(bdc, spies);

    assert.equal(result.success, true, `status=${status} devrait être autorisé`);
    assert.equal(calls.deliveryNote, 1);
  }
});

test('create-bl: rejette aussi un statut BDC non valide (garde existante, non-régression)', () => {
  const bdc = { status: 'brouillon', delivery_status: 'non_livre' };
  const calls = { deliveryNote: 0, stockMovement: 0, updateBdc: 0 };
  const spies = {
    createDeliveryNote: () => calls.deliveryNote++,
    createStockMovement: () => calls.stockMovement++,
    updateBdcDeliveryStatus: () => calls.updateBdc++,
  };

  const result = simulateCreateBl(bdc, spies);

  assert.equal(result.success, false);
  assert.equal(result.status, 400);
  assert.equal(calls.deliveryNote, 0);
});
