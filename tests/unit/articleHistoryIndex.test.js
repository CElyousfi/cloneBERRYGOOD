'use strict';

/**
 * Unit tests for functions/lib/stock/articleHistoryIndex.js
 * Run with: npm run test:unit
 *
 * Garantit que l'index complet + slice reproduit la sémantique de l'ancienne
 * logique inline de get-article-history (exclusions, lieux de stock, cumuls).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArticleHistoryIndex, sliceArticleHistory } = require('../../functions/lib/stock/articleHistoryIndex');

// Guard mock : un mouvement est "deleted" si deleted === true.
const guard = { isDeletedMovement: (m) => m.deleted === true };

function doc(id, data) {
  return { id, data: () => data };
}

const mag1 = { id: 'F1', type: 'magasin' };
const mag2 = { id: 'F2', type: 'magasin' };
const station = { id: 'Station F1', type: 'station' };
const fournisseur = { id: 'FRN', type: 'fournisseur' };

test('reception vers magasin = entrée +qty ; valide_chef requis', () => {
  const docs = [
    doc('m1', {
      type: 'reception', status: 'valide_chef', date: '2026-01-01', numero: 'R1',
      lieu_source: fournisseur, lieu_destination: mag1,
      items: [{ article_ref: 'ART1', article_nom: 'Article Un', quantite: 10, unite: 'kg' }],
    }),
    // reception non valide_chef → exclue
    doc('m2', {
      type: 'reception', status: 'valide_mag', date: '2026-01-02', numero: 'R2',
      lieu_source: fournisseur, lieu_destination: mag1,
      items: [{ article_ref: 'ART1', article_nom: 'Article Un', quantite: 5, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  const slice = sliceArticleHistory(index, 'ART1', null);
  assert.equal(slice.entries.length, 1);
  assert.equal(slice.entries[0].sens, 'entree');
  assert.equal(slice.entries[0].quantite, 10);
  assert.equal(slice.solde_global, 10);
  assert.equal(slice.entries[0].cumul_global_apres, 10);
});

test('matching insensible à la casse sur ref ET nom', () => {
  const docs = [
    doc('m1', {
      type: 'transfert', status: 'valide_chef', date: '2026-01-01', numero: 'T1',
      lieu_source: mag1, lieu_destination: mag2,
      items: [{ article_ref: 'ART1', article_nom: 'Article Un', quantite: 3, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  // par ref (lowercase)
  assert.equal(sliceArticleHistory(index, 'art1', null).entries.length, 2);
  // par nom (lowercase)
  assert.equal(sliceArticleHistory(index, 'article un', null).entries.length, 2);
});

test('transfert mag→mag : sortie source + entrée dest, solde global net 0', () => {
  const docs = [
    doc('m1', {
      type: 'transfert', status: 'valide_chef', date: '2026-01-01', numero: 'T1',
      lieu_source: mag1, lieu_destination: mag2,
      items: [{ article_ref: 'ART1', quantite: 7, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  const slice = sliceArticleHistory(index, 'ART1', null);
  assert.equal(slice.entries.length, 2);
  assert.equal(slice.solde_global, 0);
  // soldes par lieu : F1 = -7, F2 = +7
  const byLieu = Object.fromEntries(slice.soldes_par_lieu.map((s) => [s.lieu_id, s.balance]));
  assert.equal(byLieu.F1, -7);
  assert.equal(byLieu.F2, 7);
});

test('sortie vers lieu non-stock (fournisseur) réduit le stock global', () => {
  const docs = [
    doc('m1', {
      type: 'sortie', status: 'valide_chef', date: '2026-01-01', numero: 'S1',
      lieu_source: mag1, lieu_destination: fournisseur,
      items: [{ article_ref: 'ART1', quantite: 4, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  const slice = sliceArticleHistory(index, 'ART1', null);
  // seul le lieu_source (stock) génère une entrée de grand-livre, sortie -4
  assert.equal(slice.entries.length, 1);
  assert.equal(slice.entries[0].sens, 'sortie');
  assert.equal(slice.solde_global, -4);
});

test('mouvement soft-deleted exclu', () => {
  const docs = [
    doc('m1', {
      type: 'reception', status: 'valide_chef', date: '2026-01-01', numero: 'R1',
      lieu_source: fournisseur, lieu_destination: mag1, deleted: true,
      items: [{ article_ref: 'ART1', quantite: 10, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  assert.equal(sliceArticleHistory(index, 'ART1', null).entries.length, 0);
});

test('qty <= 0 ignorée ; status absent ignoré', () => {
  const docs = [
    doc('m1', {
      type: 'transfert', status: 'valide_chef', date: '2026-01-01', numero: 'T1',
      lieu_source: mag1, lieu_destination: mag2,
      items: [{ article_ref: 'ART1', quantite: 0, unite: 'kg' }],
    }),
    doc('m2', {
      type: 'transfert', status: '', date: '2026-01-02', numero: 'T2',
      lieu_source: mag1, lieu_destination: mag2,
      items: [{ article_ref: 'ART1', quantite: 5, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  assert.equal(sliceArticleHistory(index, 'ART1', null).entries.length, 0);
});

test('filterLieuId restreint les entries mais pas les soldes', () => {
  const docs = [
    doc('m1', {
      type: 'transfert', status: 'valide_chef', date: '2026-01-01', numero: 'T1',
      lieu_source: mag1, lieu_destination: mag2,
      items: [{ article_ref: 'ART1', quantite: 7, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  const slice = sliceArticleHistory(index, 'ART1', 'F2');
  assert.equal(slice.entries.length, 1);
  assert.equal(slice.entries[0].lieu_id, 'F2');
  assert.equal(slice.soldes_par_lieu.length, 2); // soldes inchangés
});

test('station comptée comme lieu de stock', () => {
  const docs = [
    doc('m1', {
      type: 'reception', status: 'valide_chef', date: '2026-01-01', numero: 'R1',
      lieu_source: fournisseur, lieu_destination: station,
      items: [{ article_ref: 'ART1', quantite: 12, unite: 'kg' }],
    }),
  ];
  const index = buildArticleHistoryIndex(docs, guard);
  const slice = sliceArticleHistory(index, 'ART1', null);
  assert.equal(slice.entries.length, 1);
  assert.equal(slice.entries[0].lieu_type, 'station');
  assert.equal(slice.solde_global, 12);
});

test('article inconnu → réponse vide cohérente', () => {
  const index = buildArticleHistoryIndex([], guard);
  const slice = sliceArticleHistory(index, 'INCONNU', null);
  assert.deepEqual(slice.entries, []);
  assert.equal(slice.solde_global, 0);
  assert.deepEqual(slice.soldes_par_lieu, []);
  assert.deepEqual(slice.movements, {});
  assert.equal(slice.article.ref, 'INCONNU');
  assert.equal(slice.article.nom, 'INCONNU');
  assert.equal(slice.article.unite, 'kg');
});
