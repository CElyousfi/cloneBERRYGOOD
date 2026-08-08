'use strict';

/**
 * Unit tests for public/lib/bdcReceptionUtils.js — computeDeliveryData().
 * Run with: npm run test:unit
 *
 * Extrait de AchatsBDCTab.getDeliveryData (public/app.jsx) pour être réutilisé
 * par MagBdcReceptionTab (plafond de réception) et MagBonsCommandeTab (popup
 * lecture seule reçu/reliquat). Ces tests verrouillent le comportement exact
 * (arrondis, statuts, gestion des cas vides) avant/après extraction.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDeliveryData, resolveDeliveryDataOrError, filterReceptionsForBdc, computeReceptionRowsWithReliquat, computeReceptionEcart, clampReceivedQty } = require('../../public/lib/bdcReceptionUtils.js');

test('computeDeliveryData: reproduit BDC-2026-0142 — 100 commandés, 30+25 reçus → reste 45, statut partiel', () => {
  const bdcItems = [{ article: 'TES', quantite: 100, unite: 'ml' }];
  const bls = [
    { items: [{ article: 'TES', quantite_recue: 30 }] },
    { items: [{ article: 'TES', quantite_recue: 25 }] },
  ];
  const result = computeDeliveryData(bdcItems, bls);
  assert.deepEqual(result, [{ article: 'TES', unite: 'ml', qCmd: 100, qLiv: 55, reste: 45, pct: 55, statut: 'partiel' }]);
});

test('computeDeliveryData: aucun BL → reste = quantité commandée, statut en_attente', () => {
  const bdcItems = [{ article: 'A', quantite: 10, unite: 'kg' }];
  const result = computeDeliveryData(bdcItems, []);
  assert.deepEqual(result, [{ article: 'A', unite: 'kg', qCmd: 10, qLiv: 0, reste: 10, pct: 0, statut: 'en_attente' }]);
});

test('computeDeliveryData: article entièrement livré → reste 0, statut livre, pct plafonné à 100', () => {
  const bdcItems = [{ article: 'A', quantite: 10, unite: 'kg' }];
  const bls = [{ items: [{ article: 'A', quantite_recue: 12 }] }]; // sur-livré côté data historique
  const result = computeDeliveryData(bdcItems, bls);
  assert.equal(result[0].reste, 0);
  assert.equal(result[0].statut, 'livre');
  assert.equal(result[0].pct, 100);
});

test('computeDeliveryData: BDC multi-articles — un article soldé, un autre partiel', () => {
  const bdcItems = [
    { article: 'A', quantite: 10, unite: 'kg' },
    { article: 'B', quantite: 20, unite: 'kg' },
  ];
  const bls = [{ items: [{ article: 'A', quantite_recue: 10 }, { article: 'B', quantite_recue: 5 }] }];
  const result = computeDeliveryData(bdcItems, bls);
  const byArticle = Object.fromEntries(result.map((r) => [r.article, r]));
  assert.equal(byArticle.A.reste, 0);
  assert.equal(byArticle.A.statut, 'livre');
  assert.equal(byArticle.B.reste, 15);
  assert.equal(byArticle.B.statut, 'partiel');
});

test('computeDeliveryData: bdcItems/bls vides ou undefined → pas de crash', () => {
  assert.deepEqual(computeDeliveryData([], []), []);
  assert.deepEqual(computeDeliveryData(undefined, undefined), []);
  assert.deepEqual(computeDeliveryData([{ article: 'A', quantite: 5 }], undefined), [
    { article: 'A', unite: 'kg', qCmd: 5, qLiv: 0, reste: 5, pct: 0, statut: 'en_attente' },
  ]);
});

// ============================================================================
// resolveDeliveryDataOrError — décision reliquat fiable vs état d'erreur,
// non-régression du bug BDC-2026-0142 (500 sur list-bl masqué en bls=[] →
// Reçu=0/Reliquat=100% trompeur au lieu d'une erreur explicite).
// ============================================================================

test('resolveDeliveryDataOrError: réponse success → ok avec les bls', () => {
  const json = { success: true, bls: [{ items: [{ article: 'A', quantite_recue: 5 }] }] };
  const result = resolveDeliveryDataOrError(json);
  assert.deepEqual(result, { ok: true, data: json.bls });
});

test('resolveDeliveryDataOrError: success true mais bls absent → ok avec liste vide (cas légitime, pas une erreur)', () => {
  const result = resolveDeliveryDataOrError({ success: true });
  assert.deepEqual(result, { ok: true, data: [] });
});

test('resolveDeliveryDataOrError: success:false (ex. 500 FAILED_PRECONDITION) → erreur explicite, jamais data vide silencieuse', () => {
  const json = { success: false, error: 'The query requires an index...' };
  const result = resolveDeliveryDataOrError(json);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'The query requires an index...');
  assert.equal('data' in result, false);
});

test('resolveDeliveryDataOrError: success:false sans message → message par défaut explicite', () => {
  const result = resolveDeliveryDataOrError({ success: false });
  assert.equal(result.ok, false);
  assert.match(result.error, /reliquat indisponible/i);
});

test('resolveDeliveryDataOrError: json null/undefined (fetch rejeté avant parsing) → erreur, pas de crash', () => {
  assert.equal(resolveDeliveryDataOrError(null).ok, false);
  assert.equal(resolveDeliveryDataOrError(undefined).ok, false);
});

// ============================================================================
// filterReceptionsForBdc — filtre + tri des BR (stock_movements/reception)
// rattachés à un BDC donné, pour la nouvelle section "Bons de Réception" de
// la popup MagBonsCommandeTab.
// ============================================================================

test('filterReceptionsForBdc: ne garde que les mouvements du bdc_id demandé', () => {
  const movements = [
    { numero: 'BR-2026-0001', bdc_id: 'bdcA', date: '2026-08-01', items: [] },
    { numero: 'BR-2026-0002', bdc_id: 'bdcB', date: '2026-08-02', items: [] },
  ];
  const result = filterReceptionsForBdc(movements, 'bdcA');
  assert.deepEqual(result.map((m) => m.numero), ['BR-2026-0001']);
});

test('filterReceptionsForBdc: trie par date décroissante (plus récent en premier)', () => {
  const movements = [
    { numero: 'BR-2026-0001', bdc_id: 'bdcA', date: '2026-08-01', created_at: 100 },
    { numero: 'BR-2026-0003', bdc_id: 'bdcA', date: '2026-08-05', created_at: 300 },
    { numero: 'BR-2026-0002', bdc_id: 'bdcA', date: '2026-08-03', created_at: 200 },
  ];
  const result = filterReceptionsForBdc(movements, 'bdcA');
  assert.deepEqual(result.map((m) => m.numero), ['BR-2026-0003', 'BR-2026-0002', 'BR-2026-0001']);
});

test('filterReceptionsForBdc: même date → départage par created_at décroissant', () => {
  const movements = [
    { numero: 'BR-A', bdc_id: 'bdcA', date: '2026-08-01', created_at: 100 },
    { numero: 'BR-B', bdc_id: 'bdcA', date: '2026-08-01', created_at: 200 },
  ];
  const result = filterReceptionsForBdc(movements, 'bdcA');
  assert.deepEqual(result.map((m) => m.numero), ['BR-B', 'BR-A']);
});

test('filterReceptionsForBdc: liste vide/undefined → tableau vide, pas de crash', () => {
  assert.deepEqual(filterReceptionsForBdc([], 'bdcA'), []);
  assert.deepEqual(filterReceptionsForBdc(undefined, 'bdcA'), []);
});

test('filterReceptionsForBdc: ne mute pas le tableau original', () => {
  const movements = [
    { numero: 'BR-1', bdc_id: 'bdcA', date: '2026-08-01' },
    { numero: 'BR-2', bdc_id: 'bdcA', date: '2026-08-05' },
  ];
  const original = movements.slice();
  filterReceptionsForBdc(movements, 'bdcA');
  assert.deepEqual(movements, original);
});

// ============================================================================
// computeReceptionRowsWithReliquat — un BR = une ligne, reliquat cumulatif
// par article calculé en ordre chronologique ascendant, restitué dans
// l'ordre d'affichage décroissant (le plus récent en premier). Demande Omar
// sur BDC-2026-0142 (capture d'écran) : "met la qte recu sous colonne qte
// recu et le reliquat après chaque BL sous la colonne reliquat, le BR en
// une ligne".
// ============================================================================

test('computeReceptionRowsWithReliquat: scénario exact BDC-2026-0142 — 100 ml commandés, 5 BR (25/30/20/20/5) → reliquats 75/45/25/5/0', () => {
  const bdcItems = [{ article: 'TES', quantite: 100, unite: 'ml' }];
  // Entrée dans un ordre arbitraire (comme filterReceptionsForBdc, décroissant) —
  // la fonction doit re-trier elle-même en chronologique ascendant pour cumuler.
  const receptions = [
    { numero: 'BR-2026-0050', date: '2026-08-05', created_at: 500, items: [{ article_ref: 'TES', article_nom: 'TES', quantite: 5, unite: 'ml' }] },
    { numero: 'BR-2026-0049', date: '2026-08-04', created_at: 400, items: [{ article_ref: 'TES', article_nom: 'TES', quantite: 20, unite: 'ml' }] },
    { numero: 'BR-2026-0048', date: '2026-08-03', created_at: 300, items: [{ article_ref: 'TES', article_nom: 'TES', quantite: 20, unite: 'ml' }] },
    { numero: 'BR-2026-0046', date: '2026-08-02', created_at: 200, items: [{ article_ref: 'TES', article_nom: 'TES', quantite: 30, unite: 'ml' }] },
    { numero: 'BR-2026-0045', date: '2026-08-01', created_at: 100, items: [{ article_ref: 'TES', article_nom: 'TES', quantite: 25, unite: 'ml' }] },
  ];

  const result = computeReceptionRowsWithReliquat(bdcItems, receptions);

  // Affiché du plus récent au plus ancien (cohérent avec filterReceptionsForBdc).
  assert.deepEqual(result.map((r) => r.numero), ['BR-2026-0050', 'BR-2026-0049', 'BR-2026-0048', 'BR-2026-0046', 'BR-2026-0045']);

  const reliquatsAffiches = result.map((r) => r.articles[0].reliquat_apres);
  assert.deepEqual(reliquatsAffiches, [0, 5, 25, 45, 75]);

  const qtesRecues = result.map((r) => r.articles[0].quantite_recue);
  assert.deepEqual(qtesRecues, [5, 20, 20, 30, 25]);

  // Cohérence : le reliquat du BR le plus récent (index 0, BR-2026-0050) doit
  // être égal au reliquat final calculé par computeDeliveryData pour ce BDC
  // (même donnée, exposée progressivement ligne par ligne ici).
  const bls = [{ items: receptions.map((mv) => ({ article: mv.items[0].article_ref, quantite_recue: mv.items[0].quantite })) }];
  const deliveryData = computeDeliveryData(bdcItems, bls);
  assert.equal(result[0].articles[0].reliquat_apres, deliveryData[0].reste);
});

test('computeReceptionRowsWithReliquat: multi-articles — trajectoires de reliquat indépendantes, BR mixte + BR mono-article', () => {
  const bdcItems = [
    { article: 'A', quantite: 50, unite: 'kg' },
    { article: 'B', quantite: 30, unite: 'kg' },
  ];
  const receptions = [
    // BR-1 (le plus ancien) : touche A et B en même temps.
    { numero: 'BR-1', date: '2026-08-01', created_at: 100, items: [
      { article_ref: 'A', article_nom: 'A', quantite: 20, unite: 'kg' },
      { article_ref: 'B', article_nom: 'B', quantite: 10, unite: 'kg' },
    ] },
    // BR-2 (le plus récent) : touche uniquement A.
    { numero: 'BR-2', date: '2026-08-02', created_at: 200, items: [
      { article_ref: 'A', article_nom: 'A', quantite: 15, unite: 'kg' },
    ] },
  ];

  const result = computeReceptionRowsWithReliquat(bdcItems, receptions);
  assert.deepEqual(result.map((r) => r.numero), ['BR-2', 'BR-1']);

  // BR-2 (le plus récent) : seul A est présent, reliquat A = 50 - 20 - 15 = 15.
  assert.deepEqual(result[0].articles, [
    { article: 'A', unite: 'kg', quantite_recue: 15, reliquat_apres: 15 },
  ]);

  // BR-1 (le plus ancien) : A et B, reliquats calculés à cette étape de la
  // trajectoire (A: 50-20=30, B: 30-10=20) — indépendants de ce qui se passe
  // ensuite sur BR-2.
  assert.deepEqual(result[1].articles, [
    { article: 'A', unite: 'kg', quantite_recue: 20, reliquat_apres: 30 },
    { article: 'B', unite: 'kg', quantite_recue: 10, reliquat_apres: 20 },
  ]);
});

test('computeReceptionRowsWithReliquat: un seul BR → une seule ligne', () => {
  const bdcItems = [{ article: 'A', quantite: 10, unite: 'kg' }];
  const receptions = [
    { numero: 'BR-1', date: '2026-08-01', created_at: 100, items: [{ article_ref: 'A', article_nom: 'A', quantite: 4, unite: 'kg' }] },
  ];
  const result = computeReceptionRowsWithReliquat(bdcItems, receptions);
  assert.equal(result.length, 1);
  assert.equal(result[0].numero, 'BR-1');
  assert.deepEqual(result[0].articles, [{ article: 'A', unite: 'kg', quantite_recue: 4, reliquat_apres: 6 }]);
});

test('computeReceptionRowsWithReliquat: aucun BR → tableau vide, pas de crash', () => {
  const bdcItems = [{ article: 'A', quantite: 10, unite: 'kg' }];
  assert.deepEqual(computeReceptionRowsWithReliquat(bdcItems, []), []);
  assert.deepEqual(computeReceptionRowsWithReliquat(bdcItems, undefined), []);
  assert.deepEqual(computeReceptionRowsWithReliquat(undefined, undefined), []);
});

// ============================================================================
// computeReceptionEcart — non-régression du bug BDC-2026-0142 : l'écart doit
// comparer la quantité reçue AU RELIQUAT, pas à la quantité commandée totale.
// ============================================================================

test('computeReceptionEcart: réception exacte du reliquat (100 cmd, 95 déjà reçus, reliquat=5, saisie=5) → écart 0, PAS -95', () => {
  assert.equal(computeReceptionEcart(5, 5, 100), 0);
});

test('computeReceptionEcart: sur-réception au-delà du reliquat → écart positif basé sur le reliquat', () => {
  assert.equal(computeReceptionEcart(7, 5, 100), 2);
});

test('computeReceptionEcart: sous-réception → écart négatif basé sur le reliquat', () => {
  assert.equal(computeReceptionEcart(3, 5, 100), -2);
});

test('computeReceptionEcart: reliquat NaN (donnée indisponible) → fallback sur quantite_commandee', () => {
  assert.equal(computeReceptionEcart(100, NaN, 100), 0);
  assert.equal(computeReceptionEcart(90, undefined, 100), -10);
});

test('computeReceptionEcart: quantite_recue vide/non numérique → traité comme 0', () => {
  assert.equal(computeReceptionEcart('', 5, 100), -5);
  assert.equal(computeReceptionEcart('abc', 5, 100), -5);
});

// ============================================================================
// clampReceivedQty — blocage temps réel de la sur-saisie (pas seulement au
// submit) : une saisie clavier/collage supérieure au reliquat est clampée.
// ============================================================================

test('clampReceivedQty: valeur saisie dépasse le reliquat → clampée au reliquat', () => {
  assert.equal(clampReceivedQty('12', 5), '5');
  assert.equal(clampReceivedQty(100, 5), '5');
});

test('clampReceivedQty: valeur saisie <= reliquat → inchangée', () => {
  assert.equal(clampReceivedQty('5', 5), '5');
  assert.equal(clampReceivedQty('3', 5), '3');
});

test('clampReceivedQty: valeur vide (champ en cours de vidage) → inchangée, pas de crash', () => {
  assert.equal(clampReceivedQty('', 5), '');
});

test('clampReceivedQty: saisie non numérique en cours de frappe → laissée telle quelle', () => {
  assert.equal(clampReceivedQty('1.', 5), '1.');
  assert.equal(clampReceivedQty('abc', 5), 'abc');
});

test('clampReceivedQty: reliquat indisponible (NaN) → ne clampe jamais', () => {
  assert.equal(clampReceivedQty('999', NaN), '999');
  assert.equal(clampReceivedQty('999', undefined), '999');
});
