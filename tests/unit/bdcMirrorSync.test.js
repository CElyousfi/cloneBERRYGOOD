'use strict';

/**
 * Unit tests for functions/lib/bdc/mirrorSync.js (pure transform logic).
 * Aucune connexion SQL ni Firestore — fixtures en mémoire uniquement.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../functions/lib/bdc/mirrorSync.js');

// --- Fixtures : lignes SQL plates (jointure Bon_Commande × Demande × Produit × Fournisseur)
function row(over) {
  return Object.assign({
    IDBon_Commande: 100,
    Num_BC: 'BC-000100',
    IDFournisseur: 7,
    FournisseurSociete: 'TIMAC AGRO MAROC',
    Date_BC: new Date('2025-09-15T00:00:00.000Z'),
    Statut: 'Validé',
    Total_Mnt_net_HT: 1000,
    Total_Mnt_net_TVA: 200,
    Total_Mnt_net_TTC: 1200,
    IDProduit: 73,
    ProduitRef: 'Ref-Eng0073',
    Designation: 'Engrais NPK',
    Qte: 10,
    Prix_U_HT: 100,
    Montant_net_ht: 1000,
    TVA: 200,
    Montant_net_ttc: 1200,
    Reliquat: 0,
  }, over);
}

test('num — normalise null/undefined/string/money en Number', () => {
  assert.equal(M.num(null), 0);
  assert.equal(M.num(undefined), 0);
  assert.equal(M.num(''), 0);
  assert.equal(M.num('12.5'), 12.5);
  assert.equal(M.num(42), 42);
  assert.equal(M.num(NaN), 0);
});

test('toIsoDate — Date et string → YYYY-MM-DD ; invalide → null', () => {
  assert.equal(M.toIsoDate(new Date('2025-09-15T10:00:00Z')), '2025-09-15');
  assert.equal(M.toIsoDate('2026-01-02'), '2026-01-02');
  assert.equal(M.toIsoDate(null), null);
  assert.equal(M.toIsoDate('not-a-date'), null);
});

test('isPlaceholderPrice — true uniquement quand Prix_U_HT == 1', () => {
  assert.equal(M.isPlaceholderPrice(1), true);
  assert.equal(M.isPlaceholderPrice('1'), true);
  assert.equal(M.isPlaceholderPrice(0), false);
  assert.equal(M.isPlaceholderPrice(100), false);
  assert.equal(M.isPlaceholderPrice(null), false);
});

test('mapLine — mappe les champs et utilise Produit.Ref comme code_article', () => {
  const l = M.mapLine(row());
  assert.equal(l.code_article, 'Ref-Eng0073');
  assert.equal(l.id_produit, 73);
  assert.equal(l.designation, 'Engrais NPK');
  assert.equal(l.qte_commandee, 10);
  assert.equal(l.prix_u_ht, 100);
  assert.equal(l.montant_net_ht, 1000);
  assert.equal(l.tva, 200);
  assert.equal(l.montant_net_ttc, 1200);
  assert.equal(l.reliquat, 0);
  assert.equal(l.placeholder_prix, false);
});

test('mapLine — marque placeholder_prix quand prix == 1, sans masquer la ligne', () => {
  const l = M.mapLine(row({ Prix_U_HT: 1, Montant_net_ht: 10 }));
  assert.equal(l.placeholder_prix, true);
  assert.equal(l.prix_u_ht, 1);
  assert.equal(l.code_article, 'Ref-Eng0073'); // ligne conservée
});

test('mapLine — Ref vide/null → code_article null', () => {
  assert.equal(M.mapLine(row({ ProduitRef: null })).code_article, null);
  assert.equal(M.mapLine(row({ ProduitRef: '   ' })).code_article, null);
});

test('buildMirrorDocs — regroupe par Num_BC (1 doc par BDC, array lignes)', () => {
  const rows = [
    row({ Num_BC: 'BC-000100', IDProduit: 73, ProduitRef: 'Ref-A', Qte: 10 }),
    row({ Num_BC: 'BC-000100', IDProduit: 74, ProduitRef: 'Ref-B', Qte: 5 }),
    row({ Num_BC: 'BC-000101', IDBon_Commande: 101, IDProduit: 75, ProduitRef: 'Ref-C', Qte: 2 }),
  ];
  const docs = M.buildMirrorDocs(rows);
  assert.equal(docs.length, 2);
  const bc100 = docs.find((d) => d.num_bc === 'BC-000100');
  assert.equal(bc100.lignes.length, 2);
  assert.equal(bc100.source, 'bee_one');
  assert.equal(bc100.fournisseur.nom, 'TIMAC AGRO MAROC');
  assert.equal(bc100.fournisseur.id_source, 7);
  assert.equal(bc100.date_bc, '2025-09-15');
  assert.deepEqual(bc100.lignes.map((l) => l.code_article), ['Ref-A', 'Ref-B']);
  const bc101 = docs.find((d) => d.num_bc === 'BC-000101');
  assert.equal(bc101.lignes.length, 1);
});

test('buildMirrorDocs — préserve l\'ordre de première apparition des Num_BC', () => {
  const rows = [
    row({ Num_BC: 'BC-000200' }),
    row({ Num_BC: 'BC-000100' }),
    row({ Num_BC: 'BC-000200' }),
  ];
  const docs = M.buildMirrorDocs(rows);
  assert.deepEqual(docs.map((d) => d.num_bc), ['BC-000200', 'BC-000100']);
});

test('buildMirrorDocs — ignore les lignes sans Num_BC', () => {
  const rows = [row({ Num_BC: null }), row({ Num_BC: '' }), row({ Num_BC: 'BC-000100' })];
  const docs = M.buildMirrorDocs(rows);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].num_bc, 'BC-000100');
});

test('buildMirrorDocs — en-tête sans produit (IDProduit null) ne crée pas de ligne', () => {
  const rows = [
    row({ Num_BC: 'BC-000300', IDProduit: null, ProduitRef: null, Qte: null }),
  ];
  const docs = M.buildMirrorDocs(rows);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].lignes.length, 0);
});

test('buildMirrorDocs — gère un input vide/null sans crash', () => {
  assert.deepEqual(M.buildMirrorDocs([]), []);
  assert.deepEqual(M.buildMirrorDocs(null), []);
});

test('buildReport — compte BDC, lignes, prix>0, placeholders et plage de dates', () => {
  const rows = [
    row({ Num_BC: 'BC-000100', Date_BC: '2025-08-01', Prix_U_HT: 100 }),
    row({ Num_BC: 'BC-000100', Date_BC: '2025-08-01', Prix_U_HT: 1, IDProduit: 74, ProduitRef: 'Ref-B' }),
    row({ Num_BC: 'BC-000101', IDBon_Commande: 101, Date_BC: '2026-02-10', Prix_U_HT: 50, IDProduit: 75, ProduitRef: 'Ref-C' }),
  ];
  const docs = M.buildMirrorDocs(rows);
  const r = M.buildReport(docs);
  assert.equal(r.nbBdc, 2);
  assert.equal(r.nbLignes, 3);
  assert.equal(r.nbLignesPrixPositif, 2);
  assert.equal(r.nbLignesPlaceholder, 1);
  assert.deepEqual(r.numBcs, ['BC-000100', 'BC-000101']);
  assert.equal(r.dateMin, '2025-08-01');
  assert.equal(r.dateMax, '2026-02-10');
});

test('buildReport — input vide → compteurs à zéro et dates null', () => {
  const r = M.buildReport([]);
  assert.deepEqual(r, {
    nbBdc: 0,
    nbLignes: 0,
    nbLignesPrixPositif: 0,
    nbLignesPlaceholder: 0,
    numBcs: [],
    dateMin: null,
    dateMax: null,
  });
});
