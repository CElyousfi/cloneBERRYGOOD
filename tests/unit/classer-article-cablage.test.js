'use strict';

// Test de CÂBLAGE (structurel, lecture du source) — même approche et mêmes
// garde-fous que tests/unit/conso-categorie-cablage.test.js, pour les mêmes
// raisons : `functions/index.js` et `functions/src/modules/rh/pointageService.js` sont des
// monolithes sans injection de dépendances, on ne peut pas les instancier sans
// Firestore. Ce n'est pas une preuve de comportement, c'est un cliquet contre
// le débranchement silencieux.
//
// CE QUE CE FICHIER GARDE (6 pièges, tous vérifiés « rouge » par mutation) :
//
//  1. La règle de rôle passe par le module PUR `lib/stockRoles` — la MÊME sur
//     les deux actions. La règle elle-même (`achats` ou `dg`) est INCHANGÉE :
//     ce ticket ne touche à aucun droit d'accès, il sort la condition du
//     monolithe pour la rendre testable.
//
//  2. Le préfixe de cache purgé par `classer-article` est le MÊME que la clé
//     écrite par `campagne-conso-parcelle`. Une divergence (bump v4 d'un seul
//     côté) ferait taper la purge à côté : l'écran resservirait pendant 30 min
//     une réponse où l'article reste « à classer », et la correction
//     paraîtrait sans effet. C'est le mode de panne le plus vicieux du ticket,
//     parce qu'il ne casse RIEN — il ment.
//
//  3. `classer-article` sélectionne les fiches via `referencesAClasserParNom`
//     (toutes les fiches actives du nom) et non via un `.doc(id)` unique.
//
//  4. Le rôle de `classer-article` vient du TOKEN, jamais du body. Un
//     `(req.body && req.body.profileId) || await resolveCallerRole(...)`
//     laisserait n'importe quel utilisateur authentifié poster
//     `{profileId:"dg"}` et reclasser tout le catalogue. C'est exactement la
//     faille historique de `create-article`, que le dépôt garde déjà par un
//     test explicite dans articleCatalogWiring.test.js — cette action-ci doit
//     avoir le même cliquet.
//
//  5. La catégorie écrite est BORNÉE aux deux familles de l'écran. Sans cette
//     garde, un client hors navigateur poste `categorie:"divers"` : la valeur
//     est écrite telle quelle sur TOUTES les fiches homonymes, l'article reste
//     « à classer » à jamais et le catalogue est pollué — sans erreur.
//
//  6. Un nom sans fiche active répond 404, AVANT toute écriture. Sans ce
//     refus, GENAKTIS rendrait `success:true, fiches_mises_a_jour:0` et le
//     bandeau afficherait « GENAKTIS classé — 0 fiche mise à jour » : un
//     succès qui n'a rien fait, précisément le mode de panne que tout le reste
//     du ticket s'emploie à éviter.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const INDEX_SRC = require('../helpers/backendSource').backendSource();
const POINTAGE_SRC = require('../helpers/backendSource').serviceSource('pointageService');
const { CONSO_PARCELLE_CACHE_PREFIX } = require('../../functions/lib/consoBons/cacheKeys');
const { categorieCanonique } = require('../../functions/lib/stockMerge/articleCategories');
const { familleBucket } = require('../../functions/lib/valorisation/consoValorisation');

/**
 * Retire commentaires de ligne et de bloc en respectant les littéraux de
 * chaîne, en PRÉSERVANT les offsets (remplacement par des espaces).
 * Copie volontaire de conso-categorie-cablage.js : ces deux tests doivent
 * pouvoir évoluer séparément.
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
 * Bloc `if (action === "<nom>") { … }` : du marqueur au `if (action ===`
 * suivant. Échoue si le marqueur est introuvable (jamais de vert sur du vide).
 * @param {string} src source SANS commentaires
 * @param {string} nom nom de l'action
 * @returns {string}
 */
function actionBlock(src, nom) {
  // Sans parenthèse fermante : les deux actions visées sont gardées par
  // `&& req.method === "POST"`.
  const marker = 'if (action === "' + nom + '"';
  const start = src.indexOf(marker);
  assert.notStrictEqual(
    start,
    -1,
    'bloc `' + marker + '` introuvable dans functions/index.js — action renommée ou '
      + 'supprimée : mettre ce test à jour (ne pas le supprimer).'
  );
  let end = src.indexOf('if (action ===', start + marker.length);
  if (end === -1) end = src.length;
  return src.slice(start, end);
}

// --------------------------------------------------------------------------
// 1. La règle de rôle est déléguée au module pur, sur les DEUX actions.
// --------------------------------------------------------------------------

test('update-article : la garde de rôle passe par le module pur, avec le rôle résolu SERVEUR', () => {
  const block = actionBlock(stripComments(INDEX_SRC), 'update-article');
  //
  // ── MODIFICATION CONSCIENTE (2026-08-29, ticket sb/unite-conversion) ──────
  // Ce test exigeait `peutModifierArticle(updateArticleRole)` SANS second
  // argument, précisément pour empêcher un tri de champs qui aurait fait
  // tomber l'édition de fiche du DG en 403.
  //
  // La garde devient `peutModifierChampsArticle(role, updates)`. Ce qui a
  // changé n'est PAS ce que ce test protégeait : `achats`/`dg` ne sont
  // toujours pas triés par champ — la nouvelle fonction délègue d'abord à
  // `peutModifierArticle` et s'arrête là si elle passe. Le contenu d'`updates`
  // ne sert QU'À un rôle qui n'avait AUCUN droit sur le catalogue : le
  // magasinier, à qui l'on ouvre `unite_consommation` et
  // `stock_par_unite_consommation` (il n'a pas accès à Stock › Articles et
  // c'est lui qui connaît le poids d'un fût).
  //
  // L'intention d'origine est donc conservée, mais VÉRIFIÉE PAR EXÉCUTION plus
  // bas plutôt que par l'absence d'un argument : c'est le formulaire complet
  // qui doit passer pour le DG, et cette propriété-là est plus forte.
  assert.match(
    block,
    /stockRoles\.peutModifierChampsArticle\s*\(\s*updateArticleRole\s*,\s*updates\s*\)/,
    'update-article doit appeler le module pur avec le rôle résolu SERVEUR et le contenu réel d\'`updates`.'
  );
  // La décision ne se prend JAMAIS sur une déclaration du client (un champ
  // `req.body.champs` que le client remplirait lui-même).
  assert.ok(
    !/peutModifierChampsArticle\s*\([^)]*req\.body/.test(block),
    'la garde ne doit pas décider sur une valeur lue dans le body.'
  );

  // LA PROPRIÉTÉ PROTÉGÉE, vérifiée sur le code réel : le formulaire ENTIER de
  // Stock › Articles passe pour `dg` et `achats`. Un bridage par champ, même
  // réintroduit ailleurs, fait rougir ici.
  const { peutModifierChampsArticle } = require('../../functions/lib/stockRoles');
  const formulaireEntier = {
    nom: 'x', reference: 'x', reference_technique: 'x', unite: 'KG', prix_ht: 1,
    taux_tva: 20, prix_ttc: 1.2, categorie: 'Engrais', sous_categorie: '', type: 'Stockable', multi_ferme: false,
  };
  assert.strictEqual(peutModifierChampsArticle('dg', formulaireEntier).ok, true);
  assert.strictEqual(peutModifierChampsArticle('achats', formulaireEntier).ok, true);
  // …et le magasinier n'entre QUE par les deux champs de conversion.
  assert.strictEqual(peutModifierChampsArticle('magasinier', formulaireEntier).ok, false);
  assert.strictEqual(peutModifierChampsArticle('magasinier', { unite_consommation: 'L', stock_par_unite_consommation: 1.32 }).ok, true);
});

test('classer-article : MÊME règle de rôle qu\'update-article', () => {
  const block = actionBlock(stripComments(INDEX_SRC), 'classer-article');
  assert.match(
    block,
    /stockRoles\.peutModifierArticle\s*\(\s*classerRole\s*\)/,
    'classer-article doit réutiliser stockRoles.peutModifierArticle : une garde ad hoc '
      + 'divergerait tôt ou tard de celle d\'update-article.'
  );
});

test('classer-article : le rôle vient du TOKEN, JAMAIS du body (faille create-article)', () => {
  const block = actionBlock(stripComments(INDEX_SRC), 'classer-article');
  // Même convention que le test `create-article — le rôle ne vient plus du
  // body (il était usurpable)` d'articleCatalogWiring.test.js : la résolution
  // doit être EXACTEMENT celle-ci, sans repli sur une valeur fournie par
  // l'appelant.
  assert.match(
    block,
    /const classerRole = await resolveCallerRole\(authUser\);/,
    'le rôle doit être résolu SERVEUR depuis le token, sans alternative.'
  );
  assert.doesNotMatch(
    block,
    /req\.body[^\n]*(profileId|role)\b/,
    'aucun rôle/profil ne doit être lu dans le body : un `(req.body && req.body.profileId) || …` '
      + 'laisserait n\'importe quel utilisateur authentifié poster {profileId:"dg"} et reclasser '
      + 'tout le catalogue — la faille historique de create-article.'
  );
  // Le `||` de repli est le motif exact du danger : on l'interdit sur la ligne.
  assert.doesNotMatch(
    block,
    /classerRole\s*=[^\n;]*\|\|/,
    'aucun repli sur la résolution du rôle (`… || await resolveCallerRole(…)`).'
  );
  // …et c'est bien CE rôle qui garde l'action, avant toute écriture.
  const iRole = block.indexOf('const classerRole');
  const iPerm = block.indexOf('stockRoles.peutModifierArticle(classerRole)');
  const iCommit = block.indexOf('.commit()');
  assert.ok(iRole > -1 && iPerm > iRole, 'la garde doit consommer le rôle résolu serveur');
  assert.ok(iCommit > -1 && iPerm < iCommit, 'garde avant écriture');
});

// --------------------------------------------------------------------------
// 2. Toutes les fiches du nom, jamais une seule.
// --------------------------------------------------------------------------

test('classer-article : les cibles viennent de referencesAClasserParNom (doublons compris)', () => {
  const block = actionBlock(stripComments(INDEX_SRC), 'classer-article');
  assert.match(
    block,
    /stockRoles\.referencesAClasserParNom\s*\(/,
    'classer-article doit résoudre ses cibles via stockRoles.referencesAClasserParNom : '
      + 'le catalogue porte ~105 paires de doublons, ne reclasser qu\'une fiche rend la clé '
      + 'ambiguë en amont et l\'article RESTE « à classer ».'
  );
  assert.match(
    block,
    /fiches_mises_a_jour\s*:/,
    'la réponse doit dire combien de fiches ont été mises à jour (le front l\'affiche).'
  );
});

test('classer-article : la catégorie est BORNÉE, et la borne précède la lecture du catalogue', () => {
  const block = actionBlock(stripComments(INDEX_SRC), 'classer-article');
  assert.match(
    block,
    /if \(consoValorisationLib\.familleBucket\(classerCat\) === "autre"\) \{\s*\n\s*return res\.status\(400\)/,
    'sans cette borne, un client hors navigateur poste categorie:"divers" : la valeur est écrite '
      + 'telle quelle sur TOUTES les fiches homonymes, l\'article reste « à classer » à jamais et '
      + 'le catalogue est pollué — sans la moindre erreur.'
  );
  // Elle doit trancher AVANT le `.get()` du catalogue : refuser après aurait
  // déjà coûté la lecture, et surtout la garde se retrouverait à un endroit où
  // un `return` oublié laisserait passer l'écriture.
  const iBorne = block.indexOf('familleBucket(classerCat)');
  const iGet = block.indexOf('.collection("articles_catalog").get()');
  const iCommit = block.indexOf('.commit()');
  assert.ok(iBorne > -1 && iGet > -1, 'borne ou lecture catalogue introuvable');
  assert.ok(iBorne < iGet, 'la borne de catégorie doit précéder la lecture du catalogue');
  assert.ok(iCommit > -1 && iBorne < iCommit, 'la borne doit précéder l\'écriture');
});

test('la borne de catégorie mesure le bon EFFET (test pur, pas une ligne de source)', () => {
  // Le test ci-dessus vérifie qu'une ligne est là ; celui-ci vérifie qu'elle
  // fait ce qu'on croit — sur les DEUX fonctions réellement composées par
  // l'action : categorieCanonique (règle d'écriture) puis familleBucket.
  assert.strictEqual(familleBucket(categorieCanonique('divers')), 'autre', 'divers → refusé');
  assert.strictEqual(familleBucket(categorieCanonique('amendement')), 'autre');
  assert.strictEqual(familleBucket(categorieCanonique('')), 'autre', 'catégorie vide → refusée');
  assert.strictEqual(familleBucket(categorieCanonique(null)), 'autre');
  // …et les deux familles de l'écran passent, quelle que soit la casse saisie.
  for (const v of ['engrais', 'Engrais', 'ENGRAIS']) {
    assert.strictEqual(familleBucket(categorieCanonique(v)), 'engrais', v);
  }
  for (const v of ['pesticide', 'Pesticides', 'PESTICIDE']) {
    assert.strictEqual(familleBucket(categorieCanonique(v)), 'pesticide', v);
  }

  // Ce qui est ÉCRIT est le libellé canonique, pas la valeur reçue du bandeau :
  // `engrais` / `pesticide` écrits tels quels fabriquaient une orthographe de
  // plus à chaque classement (sb/categorie-canonique-import).
  assert.strictEqual(categorieCanonique('engrais'), 'Engrais');
  assert.strictEqual(categorieCanonique('pesticide'), 'Pesticides');
});

test('classer-article : nom sans fiche → 404 AVEC return, AVANT toute écriture', () => {
  const block = actionBlock(stripComments(INDEX_SRC), 'classer-article');
  assert.match(
    block,
    /if \(classerCibles\.length === 0\) \{\s*\n\s*return res\.status\(404\)/,
    'sans ce refus, GENAKTIS rendrait success:true / fiches_mises_a_jour:0 et le bandeau '
      + 'afficherait « GENAKTIS classé — 0 fiche mise à jour » : un succès qui n\'a rien fait.'
  );
  // Le `return` est DANS la garde (sans lui, la boucle d'écriture s'exécuterait
  // après la réponse) et il précède le premier commit.
  const iGarde = block.indexOf('classerCibles.length === 0');
  const iCommit = block.indexOf('.commit()');
  assert.ok(iGarde > -1 && iCommit > -1, 'garde 404 ou commit introuvable');
  assert.ok(iGarde < iCommit, 'le 404 doit précéder le premier batch.commit()');
  // Aucune création de fiche ne doit exister dans ce bloc : on ne crée rien
  // depuis le bandeau (décision Omar — orthographe à vérifier sur le bon).
  assert.doesNotMatch(
    block,
    /articles_catalog"\)\.doc\([^)]*\)\.set\(/,
    'classer-article ne doit JAMAIS créer de fiche'
  );
});

// --------------------------------------------------------------------------
// 3. Le cache purgé est bien celui qui est écrit.
// --------------------------------------------------------------------------

test('classer-article : le cache de campagne-conso-parcelle est PURGÉ après écriture', () => {
  const block = actionBlock(stripComments(INDEX_SRC), 'classer-article');
  assert.match(
    block,
    /invalidateApiCachePrefix\s*\(\s*consoBons\.CONSO_PARCELLE_CACHE_PREFIX\s*\)/,
    'sans purge, la réponse `campagne-conso-parcelle` (cachée 30 min, catégorie résolue à la '
      + 'LECTURE) resservirait l\'article comme « à classer » : on classe, on recharge, rien ne '
      + 'change, et la fonctionnalité paraît cassée.'
  );
});

test('le préfixe purgé est EXACTEMENT la clé écrite par campagne-conso-parcelle', () => {
  // Le préfixe est dupliqué : constante côté purge, littéral de template côté
  // producteur (monolithe). C'est CE test qui interdit la divergence.
  const src = stripComments(POINTAGE_SRC);
  const idx = src.indexOf(CONSO_PARCELLE_CACHE_PREFIX);
  assert.notStrictEqual(
    idx,
    -1,
    'le préfixe « ' + CONSO_PARCELLE_CACHE_PREFIX + ' » (functions/lib/consoBons/cacheKeys.js) '
      + 'est introuvable dans functions/src/modules/rh/pointageService.js : la clé de cache a été bumpée d\'un '
      + 'seul côté — la purge d\'un classement taperait à côté et l\'écran resservirait 30 min '
      + 'une réponse périmée, SANS erreur visible.'
  );
  // Le préfixe doit être suivi de l'interpolation de campagne, pas d'autre
  // chose : `campagne_conso_parcelle_v3_bis_…` contiendrait le préfixe sans
  // être la même clé.
  assert.ok(
    src.slice(idx + CONSO_PARCELLE_CACHE_PREFIX.length).startsWith('${campagneLabel}'),
    'le préfixe doit être immédiatement suivi de `${campagneLabel}` dans la clé de cache.'
  );
});
