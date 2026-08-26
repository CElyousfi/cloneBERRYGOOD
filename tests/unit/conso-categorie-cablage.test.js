'use strict';

// Test de CÂBLAGE (structurel, lecture du source).
//
// Contexte : le module pur `functions/lib/consoBons/` est testé en isolation
// (categorieArticle.test.js & co). Ces tests-là restent TOUS VERTS si le module
// est débranché de ses deux appelants — vérifié : en retirant `catByArticle,`
// des deux call sites, `npm run test:all` rendait 2788 pass / 0 fail alors que
// sur les données de prod le résultat repassait de
// {engrais:575, pesticide:26, autre:35} à {engrais:636, pesticide:0, autre:0},
// c'est-à-dire le bug d'origine dans son intégralité (onglet Pesticides vide,
// bandeau « à classer » vide).
//
// `functions/pointageService.js` et `functions/index.js` sont des monolithes
// sans injection de dépendances (cf. TODO_REFACTO.md) : on ne peut pas mocker
// Firestore pour un test d'intégration. Même approche que le précédent maison
// `tests/unit/pointage-quinzaine-cache-shape.test.js` : on lit le source en
// texte. Ce n'est pas une preuve de comportement, c'est un cliquet qui empêche
// le débranchement silencieux.
//
// LIMITE ASSUMÉE : aucun test lisant du texte source ne peut juger d'une
// VALEUR. Un réordonnancement du `Promise.all` sans toucher au destructuring
// (les valeurs se retrouvent croisées) passerait ici au vert. Ce cas-là n'est
// pas silencieux pour autant : `bons` recevrait le référentiel ou l'index de
// catégories, et l'écran se retrouverait entièrement VIDE — visible
// immédiatement, contrairement au débranchement de `catByArticle` qui, lui,
// rend un écran plausible mais faux.
//
// Garde-fous de ce test (pour qu'il ne soit pas cosmétique) :
//  - la recherche est BORNÉE au bloc de l'action concernée — une occurrence de
//    `catByArticle` ailleurs dans le fichier ne peut pas le faire passer ;
//  - les commentaires sont retirés avant matching — une mention en commentaire
//    ne vaut pas un appel ;
//  - si un repère (clé de cache, action, appel) est introuvable, le test
//    ÉCHOUE au lieu de conclure au vert sur un bloc vide.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const POINTAGE_SRC = fs.readFileSync(
  path.join(__dirname, '../../functions/pointageService.js'),
  'utf8'
);
const INDEX_SRC = fs.readFileSync(
  path.join(__dirname, '../../functions/index.js'),
  'utf8'
);

/**
 * Retire commentaires de ligne et de bloc, en respectant les littéraux
 * de chaîne (', ", `) pour ne pas couper au milieu d'une URL ou d'un regex-like.
 * Les caractères retirés sont remplacés par des espaces afin de PRÉSERVER les
 * offsets (les bornes calculées avant/après restent comparables).
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      out[i] = ' '; out[i + 1] = ' ';
      i += 2;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * Extrait le texte délimité par une paire de caractères équilibrés, à partir de
 * l'occurrence de `open` située à `openIdx`.
 * @param {string} src
 * @param {number} openIdx index du caractère ouvrant
 * @param {string} open
 * @param {string} close
 * @returns {string|null} contenu ouvrant/fermant inclus, ou null si non équilibré
 */
function balancedFrom(src, openIdx, open, close) {
  if (src[openIdx] !== open) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Découpe le bloc `if (action === "<x>") { … }` qui ENTOURE l'offset donné :
 * on remonte au `if (action ===` précédent, on descend au suivant.
 * @param {string} src source SANS commentaires
 * @param {number} anchorIdx offset d'un repère situé dans le bloc
 * @returns {{block: string, action: string}}
 */
function enclosingActionBlock(src, anchorIdx) {
  const before = src.slice(0, anchorIdx);
  const start = before.lastIndexOf('if (action ===');
  assert.ok(start !== -1, 'aucun `if (action === …)` englobant le repère');
  let end = src.indexOf('if (action ===', anchorIdx);
  if (end === -1) end = src.length;
  const block = src.slice(start, end);
  const m = block.match(/if \(action ===\s*["']([^"']+)["']/);
  assert.ok(m, 'nom de l\'action illisible sur le bloc englobant');
  return { block, action: m[1] };
}

/**
 * Retourne la liste des arguments (texte brut) de chaque appel `fn(...)`
 * trouvé dans `block`.
 * @param {string} block source SANS commentaires
 * @param {string} fnName ex. 'consoBons.adaptBonsToConsoRows'
 * @returns {string[]}
 */
function callArgs(block, fnName) {
  const needle = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(needle + '\\s*\\(', 'g');
  const found = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const args = balancedFrom(block, openIdx, '(', ')');
    if (args) found.push(args);
  }
  return found;
}

// --------------------------------------------------------------------------
// 1. pointageService.js — action `campagne-conso-parcelle` (écran Campagne)
// --------------------------------------------------------------------------

test('campagne-conso-parcelle : le module consoBons est CÂBLÉ (catégorie par article + articles à classer)', () => {
  const src = stripComments(POINTAGE_SRC);

  // Repère = la clé de cache versionnée. Si elle est renommée (bump v4, action
  // renommée), ce test ÉCHOUE volontairement : il faudra le mettre à jour en
  // conscience plutôt que de le laisser pointer dans le vide.
  const CACHE_KEY = 'campagne_conso_parcelle_v3_';
  const anchor = src.indexOf(CACHE_KEY);
  assert.notStrictEqual(
    anchor,
    -1,
    `clé de cache "${CACHE_KEY}" introuvable dans functions/pointageService.js — ` +
      'action renommée ou cache bumpé : mettre ce test à jour (ne pas le supprimer).'
  );

  const { block, action } = enclosingActionBlock(src, anchor);
  assert.strictEqual(
    action,
    'campagne-conso-parcelle',
    `la clé de cache doit vivre dans le bloc de l'action campagne-conso-parcelle (trouvé: ${action})`
  );

  // (a) la catégorie vient bien du CATALOGUE d'articles, pas du type du bon.
  assert.match(
    block,
    /consoBons\.fetchArticleCategories\s*\(/,
    'consoBons.fetchArticleCategories doit être APPELÉ dans le bloc campagne-conso-parcelle : ' +
      'sans lui, la catégorie retombe sur le type déclaré du bon (48/48 bons en "engrais" en prod).'
  );

  // (b) l'index est bien TRANSMIS à l'adaptateur.
  const calls = callArgs(block, 'consoBons.adaptBonsToConsoRows');
  assert.strictEqual(
    calls.length,
    1,
    `exactement 1 appel à consoBons.adaptBonsToConsoRows attendu dans le bloc, trouvé ${calls.length}`
  );
  // FORME RACCOURCIE EXIGÉE (`catByArticle,`), la forme explicite
  // `catByArticle: <expr>` est volontairement REFUSÉE : accepter `:` laissait
  // passer `catByArticle: null` (l'adaptateur retombe sur `categorieBon` →
  // 636/0/0 en prod, le bug d'origine intact) et `catByArticle: {}` (index vide
  // → tout part « à classer », les deux onglets vides). Un test vert dans les
  // deux cas, donc inutile. Passer un jour à une forme explicite légitime doit
  // coûter une mise à jour CONSCIENTE de ce test, pas glisser en silence.
  assert.match(
    calls[0],
    /(^|[\s,{])catByArticle\s*(,|\})/,
    'catByArticle doit être passé à consoBons.adaptBonsToConsoRows sous sa forme ' +
      'raccourcie : sans cette option l\'adaptateur retombe sur la catégorie du bon ' +
      'et le résultat prod repasse de {engrais:575, pesticide:26, autre:35} à ' +
      '{engrais:636, pesticide:0, autre:0}.'
  );

  // (c) le seau « à classer » est bien exposé dans la réponse.
  const returnIdx = block.indexOf('return {');
  assert.notStrictEqual(returnIdx, -1, 'aucun objet retourné trouvé dans le bloc campagne-conso-parcelle');
  const payload = balancedFrom(block, block.indexOf('{', returnIdx), '{', '}');
  assert.ok(payload, 'objet de réponse non équilibré (parsing) dans campagne-conso-parcelle');
  assert.match(
    payload,
    /articles_a_classer\s*:/,
    'articles_a_classer doit figurer dans l\'objet retourné : c\'est la source du bandeau ' +
      '« articles à classer » de l\'écran Campagne.'
  );
});

// --------------------------------------------------------------------------
// 2. index.js — action `conso-valorisee` (écran Conso valorisée)
// --------------------------------------------------------------------------

test('conso-valorisee : catByArticle est CÂBLÉ dans adaptBonsToConsoRows', () => {
  const src = stripComments(INDEX_SRC);

  const MARKER = 'if (action === "conso-valorisee")';
  const anchor = src.indexOf(MARKER);
  assert.notStrictEqual(
    anchor,
    -1,
    'bloc `if (action === "conso-valorisee")` introuvable dans functions/index.js — ' +
      'action renommée : mettre ce test à jour (ne pas le supprimer).'
  );

  // On ancre APRÈS le marqueur pour que la remontée `lastIndexOf` retombe bien
  // sur ce `if (action === …)`-ci et non sur le précédent.
  const { block, action } = enclosingActionBlock(src, anchor + MARKER.length);
  assert.strictEqual(action, 'conso-valorisee', `bloc englobant inattendu: ${action}`);

  // L'index de catégories est ici construit depuis la lecture `articles_catalog`
  // déjà présente (mutualisée avec le PMP) — d'où buildArticleCategoryIndex et
  // non fetchArticleCategories. Les deux points sont vérifiés.
  assert.match(
    block,
    /consoBons\.buildArticleCategoryIndex\s*\(/,
    'consoBons.buildArticleCategoryIndex doit être appelé dans le bloc conso-valorisee'
  );

  const calls = callArgs(block, 'consoBons.adaptBonsToConsoRows');
  assert.strictEqual(
    calls.length,
    1,
    `exactement 1 appel à consoBons.adaptBonsToConsoRows attendu dans le bloc, trouvé ${calls.length}`
  );
  // Forme raccourcie exigée, même raison qu'au call site campagne ci-dessus :
  // `catByArticle: null` / `catByArticle: {}` restaurent le bug tout en
  // satisfaisant une regex qui accepterait `:`.
  assert.match(
    calls[0],
    /(^|[\s,{])catByArticle\s*(,|\})/,
    'catByArticle doit être passé à consoBons.adaptBonsToConsoRows dans conso-valorisee ' +
      'sous sa forme raccourcie : sans cette option, Article_Categorie retombe sur la ' +
      'catégorie du BON ENTIER (BENEVIA compté en engrais).'
  );
});
