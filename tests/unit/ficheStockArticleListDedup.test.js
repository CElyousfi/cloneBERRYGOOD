'use strict';

/*
 * ficheStockArticleListDedup.test.js — la liste d'articles de la Fiche de Stock.
 *
 * ── LE DÉFAUT ──────────────────────────────────────────────────────────────
 * Cas de production relevé sur le preview : le sélecteur d'articles affiche
 * « ALGA 600 » en 11/161 et « Alga 600 » en 12/161. Les deux entrées portent le
 * MÊME stock global (9,77 KG), les MÊMES mouvements et les MÊMES soldes par
 * magasin : depuis l'unification de la clé d'article (PR #357), l'historique est
 * résolu par `canon`, qui normalise la casse. La liste, elle, dédupliquait sur le
 * NOM BRUT — sensible à la casse. Résultat : deux entrées jumelles, indiscernables
 * d'un doublon de données pour un magasinier.
 *
 * ── CE QUI EST TESTÉ ───────────────────────────────────────────────────────
 * Le bloc de construction de la liste est EXTRAIT de `public/app.jsx` (monolithe
 * non requérable) puis exécuté — aucun miroir recopié. Sa sortie est confrontée
 * au VRAI index du grand livre (`functions/lib/stock/articleHistoryIndex`) pour
 * prouver que la clé retenue interroge toujours le bon seau.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - déduplication revenue au nom brut (le défaut d'origine) ;
 *  - règle de choix du libellé non déterministe (« première variante
 *    rencontrée » → dépend de l'ordre d'arrivée des soldes) ;
 *  - compteur `n/total` calculé sur les soldes et non sur la liste dédupliquée ;
 *  - `canonArt` dégradée en `toLowerCase()` (le suffixe d'unité n'est plus retiré) ;
 *  - `canonArt` élargie au point de rapprocher `ALGA600` de `ALGA 600` (ce serait
 *    changer la clé de résolution du stock : hors périmètre, et faux).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildArticleHistoryIndex,
  sliceArticleHistory,
} = require('../../functions/lib/stock/articleHistoryIndex');
const { canon } = require('../../functions/lib/stock/articleKey');

const ROOT = path.join(__dirname, '../..');
const SRC = require('./_sources').modulesSource();

// ── extraction depuis le source de prod ────────────────────────────────────

/** La copie front de `canon`, extraite de app.jsx (parité vérifiée par articleKey.test.js). */
function canonArtDuSource() {
  const m = SRC.match(/const canonArt = \(a\) => \{[\s\S]*?\n\s*\};/);
  assert.ok(m, 'canonArt introuvable dans public/app.jsx');
  // eslint-disable-next-line no-new-func
  return new Function('return (' + m[0].replace(/^const canonArt = /, '').replace(/;$/, '') + ')')();
}

/**
 * Le bloc de construction de la liste d'articles de la Fiche de Stock, extrait
 * du source et exécuté avec `canonArt` en contexte.
 * @param {Array<object>} balances lignes de stock_balances telles que get-balances les rend
 * @returns {Array<{ref: string, label: string}>}
 */
function listeFicheStock(balances) {
  const ancre = SRC.indexOf('(json.balances || []).forEach(b => {');
  assert.notEqual(ancre, -1, 'boucle de construction de la liste Fiche de Stock introuvable');
  const debut = SRC.lastIndexOf('const seen = {};', ancre);
  assert.notEqual(debut, -1, 'déclaration `seen` de la Fiche de Stock introuvable');
  const marqueur = 'list.sort((a, b) => a.label.localeCompare(b.label';
  const iSort = SRC.indexOf(marqueur, debut);
  assert.notEqual(iSort, -1, 'fin du bloc Fiche de Stock introuvable');
  const bloc = SRC.slice(debut, SRC.indexOf('\n', iSort));
  assert.match(bloc, /json\.balances/, 'le bloc extrait n’est pas celui de la Fiche de Stock');
  // eslint-disable-next-line no-new-func
  return new Function('json', 'canonArt', bloc + '\nreturn list;')({ balances }, canonArtDuSource());
}

/**
 * Le DÉNOMINATEUR du compteur « n/161 », extrait du JSX, évalué sur la liste.
 * Si le compteur venait à être calculé sur autre chose que la liste dédupliquée
 * (les soldes bruts, un état parallèle), l'expression extraite ne s'évalue plus
 * dans ce contexte et le test rougit.
 * @param {Array<object>} articles
 * @returns {number}
 */
function totalDuCompteur(articles) {
  const m = SRC.match(/\{curIdx \+ 1\}\/\{([^}]+)\}/);
  assert.ok(m, 'compteur « n/total » introuvable dans la Fiche de Stock');
  // eslint-disable-next-line no-new-func
  return new Function('articles', 'return (' + m[1] + ');')(articles);
}

// ── données : le cas de production ─────────────────────────────────────────

const F2 = { id: 'F2', type: 'magasin' };
const F3 = { id: 'F3', type: 'magasin' };
const FRN = { id: 'FRN', type: 'fournisseur' };
const guard = { isDeletedMovement: (m) => m.deleted === true };

/** Ligne de solde telle que get-balances la rend. */
function solde(lieu, nom, balance) {
  return {
    id: 'magasin_' + lieu + '_' + nom,
    article_ref: nom, article_nom: nom,
    lieu_id: lieu, lieu_type: 'magasin', unite: 'KG', balance,
  };
}

/**
 * Le cas d'Omar : le même article écrit de deux façons dans stock_balances,
 * 9,77 KG au total, un seul mouvement de réception.
 */
const SOLDES_ALGA = [
  solde('F2', 'ALGA 600', 5.77),
  solde('F3', 'Alga 600', 4),
];

function receptionAlga(refEcrite, qte) {
  return {
    id: 'r-' + refEcrite + '-' + qte,
    data: () => ({
      type: 'reception', status: 'valide_chef', date: '2026-03-01',
      numero: 'BR-900', lieu_source: FRN, lieu_destination: F2,
      items: [{ article_ref: refEcrite, quantite: qte, unite: 'KG' }],
    }),
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

test('le cas d’Omar : ALGA 600 / Alga 600 ne font qu’UNE entrée', () => {
  const liste = listeFicheStock(SOLDES_ALGA);
  assert.equal(liste.length, 1, 'deux écritures du même article = une seule entrée dans la liste');
  assert.equal(liste[0].ref, 'ALGA 600');
  assert.equal(liste[0].label, 'ALGA 600');
});

test('libellé déterministe : l’ordre d’arrivée des soldes ne change RIEN', () => {
  const direct = listeFicheStock(SOLDES_ALGA);
  const inverse = listeFicheStock(SOLDES_ALGA.slice().reverse());
  assert.deepEqual(inverse, direct,
    'une règle « première variante rencontrée » ferait sauter l’article de libellé d’un chargement à l’autre');

  // Aucune écriture canonique parmi les variantes → la plus petite en binaire,
  // toujours indépendamment de l'ordre.
  const mixte = [solde('F2', 'Alga 600', 1), solde('F3', 'alga 600', 2)];
  assert.equal(listeFicheStock(mixte)[0].label, 'Alga 600');
  assert.equal(listeFicheStock(mixte.slice().reverse())[0].label, 'Alga 600');
});

test('ORDRE stable sur des libellés accentués (le tiebreak binaire du tri)', () => {
  // `UREE 46` et `URÉE 46` sont deux clés canon DISTINCTES (canon ne touche pas
  // aux accents) mais ÉGALES sous localeCompare(sensitivity:'base'). Sans
  // tiebreak, Array.sort étant stable, leur ordre d'affichage retombe sur
  // l'ordre d'arrivée des soldes — donc sur l'ordre d'itération Firestore :
  // deux articles voisins qui permutent d'un chargement à l'autre.
  // Le catalogue porte réellement ce cas (« Urea Phosphaté » / « Urée Phosphaté »).
  const accents = [solde('F2', 'UREE 46', 1), solde('F3', 'URÉE 46', 2)];
  const attendu = ['UREE 46', 'URÉE 46'];
  assert.deepEqual(listeFicheStock(accents).map((a) => a.label), attendu);
  assert.deepEqual(listeFicheStock(accents.slice().reverse()).map((a) => a.label), attendu,
    'l’ordre d’affichage ne doit pas dépendre de l’ordre d’arrivée des soldes');
});

test('la déduplication est bien celle de canon, pas un toLowerCase()', () => {
  // Le suffixe d'unité est ce que `canon` retire et qu'aucune normalisation de
  // casse ne retire : sans lui, ces deux lignes redeviennent deux entrées.
  const liste = listeFicheStock([
    solde('F2', 'ACIDE PHOSPHORIQUE (L)', 10),
    solde('F3', 'Acide Phosphorique', 2),
  ]);
  assert.equal(liste.length, 1);
  // Aucune variante n'est l'écriture canonique (« ACIDE PHOSPHORIQUE ») : on garde
  // la plus petite en binaire, donc un libellé RÉELLEMENT observé, jamais fabriqué.
  assert.equal(liste[0].label, 'ACIDE PHOSPHORIQUE (L)');
  assert.equal(canon(liste[0].ref), canon('Acide Phosphorique'));
});

test('canon ne rapproche PAS ALGA600 de ALGA 600 — deux articles distincts', () => {
  const liste = listeFicheStock([solde('F2', 'ALGA600', 1), solde('F2', 'ALGA 600', 2)]);
  assert.equal(liste.length, 2, 'l’espace manquant fait deux clés : élargir canon serait changer la clé du stock');
});

test('le compteur n/total compte les ARTICLES, pas les lignes de soldes', () => {
  const liste = listeFicheStock(SOLDES_ALGA);
  assert.equal(SOLDES_ALGA.length, 2, 'deux lignes de soldes en entrée');
  assert.equal(totalDuCompteur(liste), 1, 'le compteur doit refléter la liste dédupliquée');
});

test('la clé retenue interroge toujours le bon seau du grand livre', () => {
  const index = buildArticleHistoryIndex(
    [receptionAlga('Alga 600 (KG)', 5.77), receptionAlga('ALGA 600', 4)],
    guard
  );
  const liste = listeFicheStock(SOLDES_ALGA);
  const slice = sliceArticleHistory(index, liste[0].ref, null);
  assert.equal(slice.count, 2, 'les deux mouvements du même article, quelle que soit leur écriture');
  assert.equal(slice.solde_global, 9.77);
});

test('les autres articles ne sont pas absorbés : une entrée par clé distincte', () => {
  const liste = listeFicheStock([
    solde('F2', 'ALGA 600', 1),
    solde('F2', 'Alga 600', 1),
    solde('F2', 'UREE 46 (KG)', 1),
    solde('F3', 'uree 46', 1),
    solde('F3', 'KELPAK', 1),
  ]);
  assert.deepEqual(liste.map((a) => a.label), ['ALGA 600', 'KELPAK', 'UREE 46 (KG)']);
});

test('lignes vides : ni entrée fantôme, ni plantage', () => {
  const liste = listeFicheStock([
    { id: 'x', article_ref: '', article_nom: '', lieu_id: 'F2' },
    { id: 'y', lieu_id: 'F2' },
    { id: 'z', article_ref: '   ', article_nom: '', lieu_id: 'F2' },
    solde('F2', 'ALGA 600', 1),
  ]);
  assert.deepEqual(liste.map((a) => a.label), ['ALGA 600']);
});
