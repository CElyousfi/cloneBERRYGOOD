'use strict';

/*
 * articleHistoryKeyReconciliation.test.js
 *
 * ── LE DÉFAUT ──────────────────────────────────────────────────────────────
 * Cas de production : « Acide Phosphorique · F2 · 10 852,8 kg », 11 réceptions
 * en base, et la pop-up « Détail des mouvements » qui répond « Aucun mouvement ».
 * Le solde vit dans `magasin_F2_Ref-Eng0052` (article_ref = docId de la fiche
 * fusionnée) ; les mouvements portent `article_ref = "ACIDE PHOSPHORIQUE"`.
 * L'écran envoyait `article_ref || article_nom` → « Ref-Eng0052 », que l'index
 * cherchait en minuscules brutes. Aucune correspondance possible.
 *
 * ── CE QUI EST TESTÉ ───────────────────────────────────────────────────────
 * Le chemin ENTIER, du source de prod : les littéraux d'appel sont EXTRAITS de
 * `public/app.jsx` (monolithe non requérable) puis exécutés, et leur résultat
 * est passé au VRAI index du grand livre. Aucun miroir recopié.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - recherche revenue à `articleParam.toLowerCase()` ;
 *  - indexation canonisée d'un SEUL côté (ref ou nom) ;
 *  - priorité de clé remise sur `article_ref` d'abord (3 sites de app.jsx) ;
 *  - les deux pop-ups (mouvements / PMP) interrogeant l'index avec des clés
 *    différentes ;
 *  - `canon` remplacée par une normalisation sans retrait du suffixe d'unité.
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

/** Littéral objet qui suit `<appel>(` dans app.jsx, par équilibrage d'accolades. */
function litteralApres(appel) {
  const i = SRC.indexOf(appel);
  assert.notEqual(i, -1, appel + ' introuvable dans public/app.jsx');
  const debut = SRC.indexOf('{', i + appel.length - 1);
  assert.notEqual(debut, -1, 'littéral objet introuvable après ' + appel);
  let prof = 0;
  for (let k = debut; k < SRC.length; k++) {
    if (SRC[k] === '{') prof++;
    else if (SRC[k] === '}') {
      prof--;
      if (prof === 0) return SRC.slice(debut, k + 1);
    }
  }
  throw new Error('accolade fermante introuvable pour ' + appel);
}

/** Évalue un littéral objet extrait, avec la ligne de solde `b` en contexte. */
function evalLitteral(litteral, b) {
  // eslint-disable-next-line no-new-func
  return new Function('b', 'return (' + litteral + ');')(b);
}

/**
 * Construction de la liste d'articles de la Fiche de Stock, extraite du source.
 * C'est cette clé qui est ensuite envoyée à get-article-history.
 */
function listeFicheStock(balances) {
  const ancre = SRC.indexOf('(json.balances || []).forEach(b => {');
  assert.notEqual(ancre, -1, 'boucle de construction de la liste Fiche de Stock introuvable');
  const debut = SRC.lastIndexOf('const seen = {};', ancre);
  assert.notEqual(debut, -1, 'déclaration `seen` de la Fiche de Stock introuvable');
  const marqueur = 'list.sort((a, b) => a.label.localeCompare(b.label';
  const iSort = SRC.indexOf(marqueur, debut);
  assert.notEqual(iSort, -1, 'fin du bloc Fiche de Stock introuvable');
  const fin = SRC.indexOf('\n', iSort);
  const bloc = SRC.slice(debut, fin);
  assert.match(bloc, /json\.balances/, 'le bloc extrait n’est pas celui de la Fiche de Stock');
  // Le bloc déduplique sur `canonArt` (copie front de `canon`) : on l'extrait lui
  // aussi du source plutôt que d'en recopier un miroir.
  const mCanon = SRC.match(/const canonArt = \(a\) => \{[\s\S]*?\n\s*\};/);
  assert.ok(mCanon, 'canonArt introuvable dans public/app.jsx');
  // eslint-disable-next-line no-new-func
  const canonArt = new Function(
    'return (' + mCanon[0].replace(/^const canonArt = /, '').replace(/;$/, '') + ')'
  )();
  // eslint-disable-next-line no-new-func
  return new Function('json', 'canonArt', bloc + '\nreturn list;')({ balances }, canonArt);
}

// ── données : le cas de production ─────────────────────────────────────────

const guard = { isDeletedMovement: (m) => m.deleted === true };
const F2 = { id: 'F2', type: 'magasin' };
const FRN = { id: 'FRN', type: 'fournisseur' };

/** 11 réceptions, cumul 10 852,8 kg, comme en production. */
function receptionsAcidePhosphorique(refEcrite) {
  const qtes = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 852.8];
  return qtes.map((q, i) => ({
    id: 'r' + i,
    data: () => ({
      type: 'reception', status: 'valide_chef', date: '2026-0' + (1 + (i % 9)) + '-01',
      numero: 'BR-' + (100 + i), lieu_source: FRN, lieu_destination: F2,
      items: [{ article_ref: refEcrite, quantite: q, unite: 'kg' }],
    }),
  }));
}

/** La ligne d'inventaire telle que get-balances la renvoie pour cet article. */
const LIGNE_SOLDE = {
  id: 'magasin_F2_Ref-Eng0052',
  article_ref: 'Ref-Eng0052',
  article_nom: 'ACIDE PHOSPHORIQUE',
  lieu_id: 'F2', lieu_type: 'magasin', unite: 'kg', balance: 10852.8,
};

// ── tests ──────────────────────────────────────────────────────────────────

test('cas de référence : la pop-up Mouvements retrouve les 11 réceptions', () => {
  const index = buildArticleHistoryIndex(receptionsAcidePhosphorique('ACIDE PHOSPHORIQUE'), guard);
  const ligne = evalLitteral(litteralApres('setMvtDetailLine('), LIGNE_SOLDE);

  assert.equal(ligne.article, 'ACIDE PHOSPHORIQUE',
    'la pop-up doit envoyer le NOM ; le docId de la fiche fusionnée n’existe dans aucun mouvement');

  const slice = sliceArticleHistory(index, ligne.article, ligne.lieu_id);
  assert.equal(slice.count, 11, '11 réceptions attendues au lieu F2');
  assert.equal(slice.solde_global, 10852.8);
});

test('la clé docId seule ne trouve rien — c’est bien la priorité de clé qui corrige', () => {
  const index = buildArticleHistoryIndex(receptionsAcidePhosphorique('ACIDE PHOSPHORIQUE'), guard);
  assert.equal(sliceArticleHistory(index, 'Ref-Eng0052', 'F2').count, 0);
});

test('non-divergence : les deux pop-ups de la MÊME ligne interrogent la même clé', () => {
  const mvt = evalLitteral(litteralApres('setMvtDetailLine('), LIGNE_SOLDE);
  const pmp = evalLitteral(litteralApres('setPmpDetailArticle('), LIGNE_SOLDE);

  // Règle backend de get-pmp-detail (functions/index.js) : articleNom || articleRef.
  const clePmp = (pmp.article_nom || '').trim() || (pmp.article_ref || '').trim();
  const cleMvt = (mvt.article || '').trim();

  assert.equal(canon(cleMvt), canon(clePmp),
    'les deux pop-ups d’une même ligne doivent viser le même seau du grand livre');

  const index = buildArticleHistoryIndex(receptionsAcidePhosphorique('ACIDE PHOSPHORIQUE'), guard);
  assert.equal(sliceArticleHistory(index, cleMvt, null).count, 11);
  assert.equal(sliceArticleHistory(index, clePmp, null).count, 11);
});

test('Fiche de Stock : la liste est construite sur la clé que portent les mouvements', () => {
  const liste = listeFicheStock([LIGNE_SOLDE]);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].ref, 'ACIDE PHOSPHORIQUE');
  assert.equal(liste[0].label, 'ACIDE PHOSPHORIQUE');

  const index = buildArticleHistoryIndex(receptionsAcidePhosphorique('ACIDE PHOSPHORIQUE'), guard);
  assert.equal(sliceArticleHistory(index, liste[0].ref, null).count, 11);
});

test('canonicalisation à l’INDEXATION : mouvement écrit en ref mixte + suffixe d’unité', () => {
  // Mouvement indexé par sa REF seule, écrite « Acide Phosphorique (L) ».
  const index = buildArticleHistoryIndex(receptionsAcidePhosphorique('Acide Phosphorique (L)'), guard);
  assert.equal(sliceArticleHistory(index, 'ACIDE PHOSPHORIQUE', 'F2').count, 11,
    'la ref doit être canonisée à l’indexation');
});

test('canonicalisation à l’INDEXATION : mouvement écrit en nom mixte + suffixe d’unité', () => {
  // Mouvement indexé par son NOM seul (ref = code catalogue étranger au solde).
  const docs = receptionsAcidePhosphorique('CAT-778').map((d) => {
    const m = d.data();
    m.items[0].article_nom = 'Acide Phosphorique (L)';
    return { id: d.id, data: () => m };
  });
  const index = buildArticleHistoryIndex(docs, guard);
  assert.equal(sliceArticleHistory(index, 'ACIDE PHOSPHORIQUE', 'F2').count, 11,
    'le nom doit être canonisé à l’indexation');
});

test('canonicalisation à la RECHERCHE : requête mixte + suffixe d’unité', () => {
  const index = buildArticleHistoryIndex(receptionsAcidePhosphorique('ACIDE PHOSPHORIQUE'), guard);
  assert.equal(sliceArticleHistory(index, 'Acide Phosphorique (L)', 'F2').count, 11,
    'la requête doit être canonisée à la recherche');
  assert.equal(sliceArticleHistory(index, '  acide   phosphorique  ', 'F2').count, 11);
});
