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
const { PENDING_STATUSES, blockedBy, summarizePendingValidation, buildDigestPayload } = require('../../functions/lib/bdc/bdcDigest.js');

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

test('blockedBy: ferme direct-DG (Avocatier) coincée en en_attente_chef → rôle aucun_valideur, jamais dg ni undefined', () => {
  const result = blockedBy(bdc({ status: 'en_attente_chef', ferme: 'Avocatier' }));
  assert.equal(result.role, 'aucun_valideur');
  assert.notEqual(result.role, 'dg');
  assert.match(result.label, /aucun chef/i);
  assert.match(result.label, /Avocatier/);
});

test('blockedBy: ferme inconnue (typo) en en_attente_chef → aucun_valideur, pas le DG', () => {
  // requiresChefValidation() est fail-safe true pour une ferme inconnue :
  // une simple typo produit un BdC en_attente_chef sans chef compétent.
  assert.equal(blockedBy(bdc({ status: 'en_attente_chef', ferme: 'F11' })).role, 'aucun_valideur');
});

test('blockedBy: ferme absente en en_attente_chef → aucun_valideur sans crash', () => {
  const result = blockedBy({ status: 'en_attente_chef' });
  assert.equal(result.role, 'aucun_valideur');
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

test('summarizePendingValidation: aucune date exploitable → ageJours null (pas 0 trompeur, pas NaN)', () => {
  const result = summarizePendingValidation([{ numero: 'BDC-Z', status: 'brouillon' }], { today: TODAY });
  assert.equal(result.items[0].ageJours, null);
});

test('summarizePendingValidation: date future → ageJours clampé à 0, jamais négatif', () => {
  const futur = summarizePendingValidation(
    [{ numero: 'BDC-F', status: 'brouillon', updated_at: TODAY + 5 * DAY }],
    { today: TODAY }
  );
  assert.equal(futur.items[0].ageJours, 0);
});

test('summarizePendingValidation: BdC sans date placés en FIN de tri, pas en tête', () => {
  const result = summarizePendingValidation([
    { numero: 'BDC-SANS-DATE', status: 'en_attente_dg' },
    { numero: 'BDC-VIEUX', status: 'en_attente_dg', updated_at: TODAY - 10 * DAY },
    { numero: 'BDC-RECENT', status: 'en_attente_dg', updated_at: TODAY - 1 * DAY },
  ], { today: TODAY });
  assert.deepEqual(result.items.map((i) => i.numero), ['BDC-VIEUX', 'BDC-RECENT', 'BDC-SANS-DATE']);
});

test('summarizePendingValidation: today absent ou invalide → throw bruyant (jamais un fallback silencieux à 0)', () => {
  const docs = [bdc({ numero: 'BDC-1' })];
  assert.throws(() => summarizePendingValidation(docs, {}), /today/i);
  assert.throws(() => summarizePendingValidation(docs, undefined), /today/i);
  assert.throws(() => summarizePendingValidation(docs, { today: 'pas-une-date' }), /today/i);
  assert.throws(() => summarizePendingValidation(docs, { today: NaN }), /today/i);
  assert.throws(() => summarizePendingValidation(docs, { today: new Date('nawak') }), /today/i);
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

test('summarizePendingValidation: un BdC sans chef compétent ne pollue PAS le bucket dg de byBlocker', () => {
  const result = summarizePendingValidation([
    bdc({ numero: 'BDC-DG', status: 'en_attente_dg', ferme: 'F1', total_ttc: 3000, updated_at: TODAY - 2 * DAY }),
    bdc({ numero: 'BDC-ORPHELIN', status: 'en_attente_chef', ferme: 'Avocatier', total_ttc: 9000, updated_at: TODAY - 1 * DAY }),
  ], { today: TODAY });

  const byRole = Object.fromEntries(result.byBlocker.map((b) => [b.role, b]));
  assert.deepEqual(byRole.dg, { role: 'dg', label: 'DG', count: 1, totalTtc: 3000 });
  assert.deepEqual(byRole.aucun_valideur, {
    role: 'aucun_valideur', label: 'Bloqué — aucun chef de ferme', count: 1, totalTtc: 9000,
  });
  // Le total global reste complet : rien n'est perdu, c'est juste imputé au bon bloqueur.
  assert.equal(result.totalTtc, 12000);
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

// ============================================================================
// buildDigestPayload — mise en forme envoyée au modèle. Les totaux doivent
// rester ceux de TOUT le jeu de données, seule la liste est bornée.
// ============================================================================

/**
 * @param {number} n
 * @returns {object} un résumé de n BdC en attente DG à 100 MAD pièce.
 */
function summaryOf(n) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    docs.push(bdc({ numero: `BDC-${String(i).padStart(3, '0')}`, total_ttc: 100, updated_at: TODAY - (n - i) * DAY }));
  }
  return summarizePendingValidation(docs, { today: TODAY });
}

test('buildDigestPayload: limite par défaut à 15 items, totaux calculés sur TOUT le jeu', () => {
  const payload = buildDigestPayload(summaryOf(40), undefined);
  assert.equal(payload.items.length, 15);
  assert.equal(payload.total, 40);
  assert.equal(payload.totalTtc, 4000);
  assert.equal(payload.byBlocker[0].count, 40);
  assert.equal(payload.reste, 25);
});

test('buildDigestPayload: limit explicite respecté, reste recalculé', () => {
  const payload = buildDigestPayload(summaryOf(10), 3);
  assert.equal(payload.items.length, 3);
  assert.equal(payload.reste, 7);
  assert.equal(payload.total, 10);
});

test('buildDigestPayload: pas de champ reste quand tout est détaillé', () => {
  const payload = buildDigestPayload(summaryOf(4), 15);
  assert.equal(payload.items.length, 4);
  assert.equal('reste' in payload, false);
});

test('buildDigestPayload: limit invalide (0, négatif, NaN, string) → défaut 15', () => {
  for (const bad of [0, -5, NaN, 'abc', null, undefined]) {
    assert.equal(buildDigestPayload(summaryOf(20), /** @type {any} */ (bad)).items.length, 15, `limit=${String(bad)}`);
  }
  // string numérique tolérée
  assert.equal(buildDigestPayload(summaryOf(20), '5').items.length, 5);
});

test('buildDigestPayload: items bornés = les plus anciens en premier (ordre du résumé préservé)', () => {
  const payload = buildDigestPayload(summaryOf(5), 2);
  assert.deepEqual(payload.items.map((i) => i.numero), ['BDC-000', 'BDC-001']);
});

test('buildDigestPayload: ferme informative — filtre ou "toutes"', () => {
  assert.equal(buildDigestPayload(summaryOf(1), 15).ferme, 'toutes');
  assert.equal(buildDigestPayload(summaryOf(1), 15, { ferme: '' }).ferme, 'toutes');
  assert.equal(buildDigestPayload(summaryOf(1), 15, { ferme: 'F1' }).ferme, 'F1');
});

test('buildDigestPayload: lectureTronquee posé seulement si la lecture source a atteint son plafond', () => {
  assert.equal('lectureTronquee' in buildDigestPayload(summaryOf(2), 15), false);
  assert.equal('lectureTronquee' in buildDigestPayload(summaryOf(2), 15, { tronque: false }), false);
  assert.equal(buildDigestPayload(summaryOf(2), 15, { tronque: true }).lectureTronquee, true);
});

test('buildDigestPayload: résumé vide → payload cohérent, pas de reste', () => {
  const payload = buildDigestPayload(summarizePendingValidation([], { today: TODAY }), 15);
  assert.deepEqual(payload, { ferme: 'toutes', total: 0, totalTtc: 0, byBlocker: [], items: [] });
});
