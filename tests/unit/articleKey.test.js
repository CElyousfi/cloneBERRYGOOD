'use strict';

/*
 * articleKey.test.js — la clé d'article du domaine stock (source unique).
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────
 * Le dépôt portait quatre canonicalisations concurrentes. Deux d'entre elles
 * (`normalizeArticleName` de stockMerge) ne retirent PAS le suffixe d'unité :
 * avec elle, `ACIDE PHOSPHORIQUE (L)` et `Acide Phosphorique` tombent dans deux
 * seaux distincts et le grand livre d'un article se scinde en deux.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - suffixe d'unité NON retiré (canon dégradé en normalizeArticleName) ;
 *  - priorité de clé remise sur article_ref d'abord ;
 *  - la copie front `canonArt` (public/app.jsx) qui dérive du backend.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { canon, articleHistoryKey } = require('../../functions/lib/stock/articleKey');
const pmpDetail = require('../../functions/lib/stock/pmpDetail');
const articleHistoryIndex = require('../../functions/lib/stock/articleHistoryIndex');

const ROOT = path.join(__dirname, '../..');

test('canon : MAJUSCULE, espaces réduits, suffixe d’unité retiré', () => {
  assert.equal(canon('Acide Phosphorique'), 'ACIDE PHOSPHORIQUE');
  assert.equal(canon('  acide   phosphorique  '), 'ACIDE PHOSPHORIQUE');
  assert.equal(canon('ACIDE PHOSPHORIQUE (L)'), 'ACIDE PHOSPHORIQUE');
  assert.equal(canon('Uree 46 (KG)'), 'UREE 46');
  assert.equal(canon(null), '');
  assert.equal(canon(undefined), '');
});

test('le suffixe d’unité est ce qui réunit les deux écritures du même article', () => {
  // Sans le retrait du suffixe (cas normalizeArticleName), ces deux libellés
  // donnent deux clés → grand livre scindé, écran vide.
  assert.equal(canon('ACIDE PHOSPHORIQUE (L)'), canon('Acide Phosphorique'));
  assert.equal(canon('UREE 46 (KG)'), canon('uree 46'));
  // Un suffixe qui n'est pas une unité reste distinctif.
  assert.notEqual(canon('ACIDE PHOSPHORIQUE (TECH)'), canon('ACIDE PHOSPHORIQUE'));
});

test('source unique : pmpDetail et articleHistoryIndex partagent LA MÊME canon', () => {
  assert.equal(pmpDetail.canon, canon, 'pmpDetail.canon doit être la fonction du module partagé');
  assert.equal(articleHistoryIndex.canon, canon, 'articleHistoryIndex doit indexer avec la même canon');
});

test('parité avec la copie front canonArt (public/app.jsx)', () => {
  // Le backend ne peut pas require('../public/…') : la copie front est assumée,
  // mais sa PARITÉ est vérifiée ici, sinon elle dérive en silence.
  const SRC = fs.readFileSync(path.join(ROOT, 'public/app.jsx'), 'utf8');
  // UNICITÉ d'abord : ce verrou prend le PREMIER littéral du fichier. Si une copie
  // locale de canonArt réapparaissait plus haut dans app.jsx, il verrouillerait
  // silencieusement la mauvaise et la divergence front/back qu'il existe pour
  // empêcher passerait inaperçue. Le verrou doit tenir par PROPRIÉTÉ, pas par
  // position : une seule définition, donc rien à choisir.
  const toutes = SRC.match(/const canonArt = \(a\) => \{[\s\S]*?\n\s*\};/g) || [];
  assert.equal(toutes.length, 1,
    'public/app.jsx doit contenir EXACTEMENT une définition de canonArt (trouvé : ' +
    toutes.length + ') — toute copie locale rouvre la divergence fermée par articleKey.js');
  const m = SRC.match(/const canonArt = \(a\) => \{[\s\S]*?\n\s*\};/);
  assert.ok(m, 'canonArt introuvable dans public/app.jsx');
  // eslint-disable-next-line no-new-func
  const canonArt = new Function('return (' + m[0].replace(/^const canonArt = /, '').replace(/;$/, '') + ')')();
  const echantillons = [
    'Acide Phosphorique', 'ACIDE PHOSPHORIQUE (L)', '  uree   46 (KG) ',
    'Ref-Eng0052', 'NITRATE (ML)', 'Sac (UNITE)', 'Divers (U)', '',
  ];
  for (const s of echantillons) {
    assert.equal(canonArt(s), canon(s), 'divergence front/back sur ' + JSON.stringify(s));
  }
});

test('articleHistoryKey : le NOM prime sur la référence', () => {
  // Cas de production : solde d'un article FUSIONNÉ, porté par le docId de sa
  // fiche maître ; les mouvements, eux, ne portent que le nom.
  assert.equal(
    articleHistoryKey({ article_ref: 'Ref-Eng0052', article_nom: 'ACIDE PHOSPHORIQUE' }),
    'ACIDE PHOSPHORIQUE'
  );
  // Pas de nom → la référence sert de repli.
  assert.equal(articleHistoryKey({ article_ref: 'ART1', article_nom: '' }), 'ART1');
  assert.equal(articleHistoryKey({ article_ref: 'ART1' }), 'ART1');
  assert.equal(articleHistoryKey({}), '');
  assert.equal(articleHistoryKey(null), '');
});
