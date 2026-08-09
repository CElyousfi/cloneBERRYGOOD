'use strict';

/**
 * Unit tests for functions/lib/bdc/bdcDigest.js.
 * Run with: npm run test:unit
 *
 * Le module alimente le tool `get_bdc_en_attente_validation` du bot WhatsApp
 * assistant DG. Les chiffres doivent être identiques à l'onglet Achats/BdC, et
 * le ciblage « qui bloque » aligné sur l'action `remind-bdc` (functions/index.js).
 * Aucun accès Firestore ici : docs + date du jour injectés.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { PENDING_STATUSES, blockedBy, summarizePendingValidation } = require('../../functions/lib/bdc/bdcDigest.js');

const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.parse('2026-08-09T12:00:00.000Z');

/**
 * @param {object} over
 * @returns {object} un doc purchase_orders minimal.
 */
function bdc(over) {
  return Object.assign({
    numero: 'BDC-2026-0001',
    status: 'en_attente_dg',
    ferme: 'F1',
    fournisseur: { nom: 'SOMAGRI' },
    total_ttc: 1000,
    created_at: TODAY - DAY,
    updated_at: TODAY - DAY,
  }, over);
}

// ============================================================================
// PENDING_STATUSES
// ============================================================================

test('PENDING_STATUSES: exactement les 3 statuts d\'attente de validation', () => {
  assert.deepEqual(PENDING_STATUSES, ['brouillon', 'en_attente_chef', 'en_attente_dg']);
});

// ============================================================================
// blockedBy — aligné sur la table de ciblage de remind-bdc
// ============================================================================

test('blockedBy: brouillon → achats (pas encore soumis, la balle est chez le saisisseur)', () => {
  const result = blockedBy(bdc({ status: 'brouillon', ferme: 'F1' }));
  assert.equal(result.role, 'achats');
  assert.match(result.label, /pas encore soumis/i);
  assert.equal(result.ferme, 'F1');
});

test('blockedBy: en_attente_chef sur F1 → chef_f1 / "Chef F1"', () => {
  assert.deepEqual(blockedBy(bdc({ status: 'en_attente_chef', ferme: 'F1' })), {
    role: 'chef_f1', label: 'Chef F1', ferme: 'F1',
  });
});

test('blockedBy: en_attente_chef sur F5 → chef_f5 / "Chef F5"', () => {
  assert.deepEqual(blockedBy(bdc({ status: 'en_attente_chef', ferme: 'F5' })), {
    role: 'chef_f5', label: 'Chef F5', ferme: 'F5',
  });
});

test('blockedBy: en_attente_dg → dg, quelle que soit la ferme', () => {
  assert.equal(blockedBy(bdc({ status: 'en_attente_dg', ferme: 'Avocatier' })).role, 'dg');
  assert.equal(blockedBy(bdc({ status: 'en_attente_dg', ferme: 'F1' })).label, 'DG');
});

test('blockedBy: ferme direct-DG (Avocatier) coincée en en_attente_chef → fallback explicite DG, jamais undefined', () => {
  const result = blockedBy(bdc({ status: 'en_attente_chef', ferme: 'Avocatier' }));
  assert.equal(result.role, 'dg');
  assert.match(result.label, /aucun chef/i);
  assert.match(result.label, /Avocatier/);
});

test('blockedBy: ferme absente en en_attente_chef → fallback DG sans crash', () => {
  const result = blockedBy({ status: 'en_attente_chef' });
  assert.equal(result.role, 'dg');
  assert.equal(result.ferme, null);
});

test('blockedBy: statut hors périmètre → rôle "inconnu" explicite', () => {
  assert.equal(blockedBy(bdc({ status: 'valide_dg' })).role, 'inconnu');
});

// ============================================================================
// summarizePendingValidation — agrégats + tri + normalisation
// ============================================================================

test('summarizePendingValidation: liste vide → totaux à zéro, pas de crash', () => {
  assert.deepEqual(summarizePendingValidation([], { today: TODAY }), {
    total: 0, totalTtc: 0, byBlocker: [], items: [],
  });
  assert.deepEqual(summarizePendingValidation(undefined, { today: TODAY }).items, []);
});

test('summarizePendingValidation: ignore les BdC hors statuts d\'attente', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', status: 'valide_dg' }),
    bdc({ numero: 'BDC-2', status: 'en_attente_dg' }),
    bdc({ numero: 'BDC-3', status: 'annule' }),
  ], { today: TODAY });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-2']);
});

test('summarizePendingValidation: tri par ageJours décroissant (le plus vieux d\'abord)', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-RECENT', updated_at: TODAY - 1 * DAY }),
    bdc({ numero: 'BDC-VIEUX', updated_at: TODAY - 12 * DAY }),
    bdc({ numero: 'BDC-MOYEN', updated_at: TODAY - 6 * DAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-VIEUX', 'BDC-MOYEN', 'BDC-RECENT']);
  assert.deepEqual(result.items.map((i) => i.ageJours), [12, 6, 1]);
});

test('summarizePendingValidation: ageJours calculé sur updated_at, sinon created_at', () => {
  const sansUpdate = summarizePendingValidation(
    [{ numero: 'BDC-X', status: 'en_attente_dg', created_at: TODAY - 4 * DAY }],
    { today: TODAY }
  );
  assert.equal(sansUpdate.items[0].ageJours, 4);

  const avecUpdate = summarizePendingValidation(
    [{ numero: 'BDC-Y', status: 'en_attente_dg', created_at: TODAY - 30 * DAY, updated_at: TODAY - 2 * DAY }],
    { today: TODAY }
  );
  assert.equal(avecUpdate.items[0].ageJours, 2);
});

test('summarizePendingValidation: aucune date → ageJours 0 (pas de NaN, pas de valeur négative)', () => {
  const result = summarizePendingValidation([{ numero: 'BDC-Z', status: 'brouillon' }], { today: TODAY });
  assert.equal(result.items[0].ageJours, 0);

  const futur = summarizePendingValidation(
    [{ numero: 'BDC-F', status: 'brouillon', updated_at: TODAY + 5 * DAY }],
    { today: TODAY }
  );
  assert.equal(futur.items[0].ageJours, 0);
});

test('summarizePendingValidation: fournisseur objet → nom ; manquant ou mal formé → "—"', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-A', fournisseur: { nom: 'SOMAGRI' }, updated_at: TODAY - 3 * DAY }),
    bdc({ numero: 'BDC-B', fournisseur: null, updated_at: TODAY - 2 * DAY }),
    bdc({ numero: 'BDC-C', fournisseur: { id: 'xyz' }, updated_at: TODAY - 1 * DAY }),
    bdc({ numero: 'BDC-D', fournisseur: 'AGRIMAT', updated_at: TODAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.fournisseur), ['SOMAGRI', '—', '—', 'AGRIMAT']);
});

test('summarizePendingValidation: agrégation byBlocker — count + totalTtc par bloqueur', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', status: 'en_attente_chef', ferme: 'F1', total_ttc: 1000, updated_at: TODAY - 5 * DAY }),
    bdc({ numero: 'BDC-2', status: 'en_attente_chef', ferme: 'F1', total_ttc: 400, updated_at: TODAY - 4 * DAY }),
    bdc({ numero: 'BDC-3', status: 'en_attente_dg', ferme: 'Avocatier', total_ttc: 2500, updated_at: TODAY - 3 * DAY }),
    bdc({ numero: 'BDC-4', status: 'brouillon', ferme: 'F5', total_ttc: 100, updated_at: TODAY - 2 * DAY }),
  ], { today: TODAY });

  assert.equal(result.total, 4);
  assert.equal(result.totalTtc, 4000);
  assert.deepEqual(result.byBlocker, [
    { role: 'chef_f1', label: 'Chef F1', count: 2, totalTtc: 1400 },
    { role: 'dg', label: 'DG', count: 1, totalTtc: 2500 },
    { role: 'achats', label: 'Achats', count: 1, totalTtc: 100 },
  ]);
});

test('summarizePendingValidation: total_ttc string ou absent → traité comme nombre, jamais NaN', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', total_ttc: '1200.50', updated_at: TODAY - 2 * DAY }),
    bdc({ numero: 'BDC-2', total_ttc: undefined, updated_at: TODAY - 1 * DAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.totalTtc), [1200.5, 0]);
  assert.equal(result.totalTtc, 1200.5);
});

test('summarizePendingValidation: today accepte Date, epoch ms et string ISO', () => {
  const docs = [bdc({ numero: 'BDC-1', updated_at: TODAY - 7 * DAY })];
  assert.equal(summarizePendingValidation(docs, { today: new Date(TODAY) }).items[0].ageJours, 7);
  assert.equal(summarizePendingValidation(docs, { today: TODAY }).items[0].ageJours, 7);
  assert.equal(summarizePendingValidation(docs, { today: '2026-08-09T12:00:00.000Z' }).items[0].ageJours, 7);
});

test('summarizePendingValidation: chaque item porte son blockedBy détaillé', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-1', status: 'en_attente_chef', ferme: 'F5', updated_at: TODAY - 6 * DAY }),
  ], { today: TODAY });
  assert.deepEqual(result.items[0], {
    numero: 'BDC-1',
    fournisseur: 'SOMAGRI',
    ferme: 'F5',
    totalTtc: 1000,
    status: 'en_attente_chef',
    blockedBy: { role: 'chef_f5', label: 'Chef F5', ferme: 'F5' },
    ageJours: 6,
  });
});
