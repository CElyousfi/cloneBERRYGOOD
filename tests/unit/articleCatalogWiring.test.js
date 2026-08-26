/*
 * articleCatalogWiring.test.js — garde-fou STRUCTUREL sur les écritures du
 * catalogue articles dans functions/index.js.
 *
 * ── POURQUOI CE TEST EXISTE ────────────────────────────────────────────────
 * Deux invariants ne peuvent pas être vérifiés par les tests purs :
 *
 *  1. CAUSE RACINE. `articles_catalog` portait 105 noms en double parce que le
 *     docId est calculé sur `row.categorie` BRUTE alors que la catégorie est
 *     enregistrée en minuscules : deux casses en entrée = deux fiches. Le
 *     remède est de résoudre par NOM NORMALISÉ avant d'écrire — et surtout PAS
 *     de « corriger » la formule du docId, ce qui réétiquetterait tout le
 *     catalogue et ferait recréer une vague de doublons au prochain import.
 *     Ce test verrouille les deux faces : la formule intacte ET la résolution.
 *
 *  2. GARDES DE RÔLE. `update-article` et `validate-delete-article` n'avaient
 *     AUCUN contrôle : n'importe quel utilisateur authentifié modifiait ou
 *     désactivait n'importe quel article. `create-article` lisait le rôle
 *     depuis le body (usurpable, et contournable en omettant le champ).
 *
 * La logique pure vit dans functions/lib/stockMerge/articleMerge.js (testée
 * dans articleMerge.test.js) ; le CÂBLAGE vit dans le monolithe, non requérable
 * en test (Firebase Admin au load). Ce fichier confronte donc le source à ses
 * invariants.
 *
 * ── RÈGLE DE RÉDACTION DE CE FICHIER ──────────────────────────────────────
 * Chaque assertion verrouille l'EFFET d'une garde, jamais la simple PRÉSENCE
 * d'un appel : une garde se vérifie sur sa forme complète
 * `if (<condition sur une variable SERVEUR>) { return res.status(<code>) }`.
 * Sinon retirer le `return`, ou rebrancher la condition sur une donnée du body,
 * laisse la suite verte tout en rouvrant le trou que le test prétend fermer.
 * Toute nouvelle assertion ici doit être validée par MUTATION : casser la garde
 * DOIT faire rougir ce fichier.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');

/**
 * Corps d'un handler d'action, de sa garde `if (action === "<nom>"` jusqu'à la
 * garde d'action suivante. Découper sur l'action suivante (et non sur un
 * commentaire de section) garantit qu'aucune assertion ne peut être satisfaite
 * par du code appartenant à un autre handler.
 */
function handlerSource(nom) {
  const start = SRC.indexOf('if (action === "' + nom + '"');
  assert.notEqual(start, -1, 'action ' + nom + ' absente de functions/index.js');
  const next = SRC.indexOf('if (action === "', start + 10);
  assert.notEqual(next, -1, 'fin du handler ' + nom + ' introuvable');
  return SRC.slice(start, next);
}

// ───────────────────────────────────────────────────────────────────────────
// 1. CAUSE RACINE — la formule d'identifiant NE BOUGE PAS
// ───────────────────────────────────────────────────────────────────────────

test('import-articles-sql — la formule du docId reste sur la catégorie BRUTE', () => {
  const h = handlerSource('import-articles-sql');
  // Le piège central du ticket : normaliser la casse DANS le calcul du docId
  // changerait l'identifiant de toutes les fiches existantes, et l'import
  // suivant, ne les retrouvant plus, en créerait une seconde vague.
  assert.match(
    h,
    /const docId = Buffer\.from\(`\$\{nom\}\|\$\{row\.categorie \|\| ""\}`\)/,
    'la formule du docId ne doit pas être normalisée'
  );
  assert.doesNotMatch(h, /Buffer\.from\([^)]*normalizeCategorie/);
  assert.doesNotMatch(h, /Buffer\.from\([^)]*toLowerCase/);
});

test('import-articles-excel — la formule du docId reste sur la catégorie BRUTE', () => {
  const h = handlerSource('import-articles-excel');
  assert.match(h, /Buffer\.from\(`\$\{nom\}\|\$\{art\.categorie \|\| ""\}`\)/);
  assert.doesNotMatch(h, /Buffer\.from\([^)]*normalizeCategorie/);
  assert.doesNotMatch(h, /Buffer\.from\([^)]*toLowerCase/);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. CAUSE RACINE — la résolution par nom normalisé COMMANDE l'écriture
// ───────────────────────────────────────────────────────────────────────────

test('import-articles-sql — le nom normalisé décide de créer ou de mettre à jour', () => {
  const h = handlerSource('import-articles-sql');
  // L'index est construit UNE FOIS, avant la boucle (l'ancien code faisait un
  // get() par ligne : le reconstruire dans la boucle serait N lectures de
  // collection, un import de 1100 lignes deviendrait inexploitable).
  const iIndex = h.indexOf('articleMerge.buildArticleIndex');
  const iBoucle = h.indexOf('for (const row of rows)');
  assert.ok(iIndex > -1 && iBoucle > -1, 'index et boucle présents');
  assert.ok(iIndex < iBoucle, 'index construit AVANT la boucle');
  assert.equal((h.match(/articleMerge\.buildArticleIndex/g) || []).length, 1);
  assert.doesNotMatch(h.slice(iBoucle), /collection\("articles_catalog"\)\.doc\([^)]*\)\.get\(\)/,
    'aucune lecture unitaire par ligne dans la boucle');

  // La cible est CELLE renvoyée par le module pur…
  assert.match(h, /const target = articleMerge\.resolveArticleTarget\(sqlIndex, docId, nom\);/);
  // …et c'est bien `target.id` qui est écrit, pas `docId` : écrire sur docId
  // recréerait le doublon que la résolution vient d'éviter.
  assert.match(h, /const docRef = db_firestore\.collection\("articles_catalog"\)\.doc\(target\.id\);/);
  assert.doesNotMatch(h, /\.collection\("articles_catalog"\)\.doc\(docId\)/);
  // …et c'est `target.isNew` qui arbitre update vs set (et non `existSnap`).
  assert.match(h, /if \(!target\.isNew \|\| sqlReactivation\) \{ batch\.update\(docRef, data\); updated\+\+; \}/);
  assert.match(h, /batch\.set\(docRef, \{ \.\.\.data, created_at: now \}\)/);
  // Une fiche créée entre dans l'index : sans cela, deux lignes du MÊME import
  // ne différant que par la casse de la catégorie créeraient deux fiches.
  assert.match(h, /if \(target\.isNew\) articleMerge\.rememberArticle\(sqlIndex, target\.id, nom\);/);
  // La catégorie est normalisée À L'ENREGISTREMENT.
  assert.match(h, /categorie: articleMerge\.normalizeCategorie\(row\.categorie\)/);
});

test('import-articles-excel — le nom normalisé décide de créer ou de mettre à jour', () => {
  const h = handlerSource('import-articles-excel');
  const iIndex = h.indexOf('articleMerge.buildArticleIndex');
  const iBoucle = h.indexOf('for (const art of articles)');
  assert.ok(iIndex > -1 && iBoucle > -1 && iIndex < iBoucle, 'index construit avant la boucle');
  assert.match(h, /const target = articleMerge\.resolveArticleTarget\(xlsIndex, docId, nom\);/);
  assert.match(h, /const docRef = db_firestore\.collection\("articles_catalog"\)\.doc\(target\.id\);/);
  assert.doesNotMatch(h, /\.collection\("articles_catalog"\)\.doc\(docId\)/);
  // Le doc existant est relu à `target.id` : le relire à `docId` ferait perdre
  // prix_ref/nb_achats de la fiche réellement mise à jour.
  assert.match(h, /const existing = existingMap\[target\.id\];/);
  assert.match(h, /if \(!target\.isNew \|\| xlsReactivation\) \{/);
  assert.match(h, /if \(target\.isNew\) articleMerge\.rememberArticle\(xlsIndex, target\.id, nom\);/);
  assert.match(h, /categorie: articleMerge\.normalizeCategorie\(art\.categorie\)/);
});

// ───────────────────────────────────────────────────────────────────────────
// 2bis. INVARIANT docId == reference, et non-destruction des fiches inactives
// ───────────────────────────────────────────────────────────────────────────

test('import-articles-excel — n’écrit JAMAIS `reference` sur une fiche résolue par nom', () => {
  const h = handlerSource('import-articles-excel');
  // Une cible résolue par nom (ou par redirection) porte le docId d'une AUTRE
  // fiche. Y écrire la référence de la ligne Excel fabrique un document où
  // `docId !== reference` — et `merge-articles`, qui résout par
  // `doc(master_ref)` alors que `suggest-article-duplicates` renvoie
  // `data.reference || d.id`, répondrait 404 depuis l'écran Catalogue.
  assert.match(
    h,
    /if \(target\.matchedBy === "nom" \|\| target\.matchedBy === "merged_into"\) delete data\.reference;/
  );
  // Le retrait doit précéder l'écriture, sinon il ne sert à rien.
  const iDelete = h.indexOf('delete data.reference');
  const iUpdate = h.indexOf('batch.update(docRef, data)');
  const iSet = h.indexOf('batch.set(docRef,');
  assert.ok(iDelete > -1 && iUpdate > -1 && iSet > -1, 'retrait et écritures présents');
  assert.ok(iDelete < iUpdate && iDelete < iSet, 'retrait avant toute écriture');
  // …et le payload porte bien `reference` par ailleurs (sinon l'assertion
  // ci-dessus serait vraie pour une raison sans rapport).
  assert.match(h, /nom, reference: ref,/);
});

test('import-articles-sql — une fiche inactive est mise à jour, jamais écrasée par set()', () => {
  const h = handlerSource('import-articles-sql');
  // Une fiche désactivée par validate-delete-article n'a ni merged_into ni
  // jumelle active : aucun repli ne la résout, donc isNew=true. Un set() la
  // REMPLACE -> prix_pmp, nb_achats et created_at perdus, valorisation à zéro.
  assert.match(h, /const sqlReactivation = target\.isNew && sqlIndex\.allIds\.has\(target\.id\);/);
  // C'est bien ce drapeau qui bascule vers l'update (et pas un test à côté).
  assert.match(h, /if \(!target\.isNew \|\| sqlReactivation\) \{ batch\.update\(docRef, data\); updated\+\+; \}/);
  // Le set() de création reste réservé au cas où AUCUN document n'existe.
  assert.match(h, /else \{\s*\n\s*batch\.set\(docRef, \{ \.\.\.data, created_at: now \}\);/);
});

test('import-articles-excel — une fiche inactive est mise à jour, jamais écrasée par set()', () => {
  const h = handlerSource('import-articles-excel');
  assert.match(h, /const xlsReactivation = target\.isNew && xlsIndex\.allIds\.has\(target\.id\);/);
  assert.match(h, /if \(!target\.isNew \|\| xlsReactivation\) \{/);
  assert.match(h, /\} else \{\s*\n\s*batch\.set\(docRef, \{ \.\.\.data, nb_achats: 0, created_at: now \}\);/);
});

test('create-article — résout par nom normalisé AVANT de créer une fiche', () => {
  const h = handlerSource('create-article');
  assert.match(h, /const createIndex = articleMerge\.buildArticleIndex\(/);
  assert.match(h, /const createTarget = articleMerge\.resolveArticleTarget\(createIndex, reference, nom\);/);
  // Le repli est LIMITÉ au match par nom. `merged_into` est légitime pour un
  // import (même article, ancien identifiant) mais pas pour une saisie libre :
  // une référence tapée qui tombe sur le docId d'un doublon fusionné enverrait
  // l'update sur le MASTER de la fusion et écraserait son nom.
  assert.match(h, /if \(createTarget\.matchedBy === "nom"\) \{/);
  assert.doesNotMatch(h, /if \(!createTarget\.isNew\)/, 'le repli ne doit pas être ouvert à tous les matchs');
  // La résolution COMMANDE réellement la sortie : sans ce `return`, la fiche
  // existante serait mise à jour PUIS une seconde fiche créée juste après.
  assert.match(
    h,
    /await db_firestore\.collection\("articles_catalog"\)\.doc\(createTarget\.id\)\.update\(createPatch\);\s*\n\s*return res\.json\(/
  );
  // Le `set()` de création est APRÈS ce return, donc inatteignable si la fiche existe.
  const iReturn = h.indexOf('return res.json({');
  const iSet = h.indexOf('.doc(reference).set(');
  assert.ok(iReturn > -1 && iSet > -1 && iReturn < iSet, 'le set de création suit le return');
  assert.match(h, /categorie: articleMerge\.normalizeCategorie\(categorie, ""\)/);
});

test('create-article — la mise à jour d’une fiche existante ne touche NI nom NI reference', () => {
  const h = handlerSource('create-article');
  // Écrire `nom` renommerait silencieusement un AUTRE article ; écrire
  // `reference` casserait l'invariant docId == reference et ferait répondre 404
  // à `merge-articles`. Le tout sous l'apparence d'une création réussie.
  assert.match(h, /const createPatch = \{ \.\.\.createData \};\s*\n\s*delete createPatch\.nom;\s*\n\s*delete createPatch\.reference;/);
  // Les retraits précèdent l'écriture.
  const iDelete = h.indexOf('delete createPatch.reference');
  const iUpdate = h.indexOf('.update(createPatch)');
  assert.ok(iDelete > -1 && iUpdate > -1 && iDelete < iUpdate, 'retraits avant update');
  // C'est bien le patch nettoyé qui est écrit, jamais le payload complet.
  assert.doesNotMatch(h, /\.update\(createData\)/);
  // …et `createData` porte bien nom + reference (sinon les `delete` seraient
  // sans objet et le test passerait pour rien).
  assert.match(h, /const createData = \{\s*\n\s*reference, nom,/);
  // L'UI est informée que la fiche existait déjà (plus de création silencieuse).
  assert.match(h, /existing_article: true/);
});

test('create-article — une référence de doublon fusionné est REFUSÉE, pas écrasée', () => {
  const h = handlerSource('create-article');
  // Un set() sur ce docId remplacerait la pierre tombale (active:false +
  // merged_into) : le pointeur de redirection des imports futurs serait perdu et
  // le doublon RÉAPPARAÎTRAIT ACTIF au catalogue — fusion annulée en silence.
  // (Le rollback, lui, vit dans article_merges et ne dépend pas de cette tombe.)
  //
  // La garde s'indexe sur l'INDEX, pas sur `matchedBy` : resolveArticleTarget
  // n'émet 'merged_into' que si le master est encore actif, donc un master
  // désactivé depuis rouvrirait le trou (résolution en 'none' -> set écrasant).
  assert.match(
    h,
    /if \(createIndex\.mergedInto\.has\(reference\)\) \{\s*\n\s*return res\.status\(400\)/
  );
  assert.doesNotMatch(
    h,
    /createTarget\.matchedBy === "merged_into"/,
    'la garde ne doit pas dépendre de matchedBy : il est conditionné à l’activité du master'
  );
  const iGarde = h.indexOf('createIndex.mergedInto.has(reference)');
  const iSet = h.indexOf('.doc(reference).set(');
  assert.ok(iGarde > -1 && iSet > -1 && iGarde < iSet, 'refus avant le set de création');
});

// ───────────────────────────────────────────────────────────────────────────
// 3. GARDES DE RÔLE — résolues SERVEUR, effet verrouillé
// ───────────────────────────────────────────────────────────────────────────

test('update-article — rôle résolu SERVEUR, 403 avec return, avant toute écriture', () => {
  const h = handlerSource('update-article');
  assert.match(h, /const updateArticleRole = await resolveCallerRole\(authUser\);/);
  // C'est CE rôle qui garde le 403, et le `return` est dans la garde : sans
  // lui, l'update s'exécuterait quand même après la réponse.
  assert.match(
    h,
    /if \(updateArticleRole !== "achats" && updateArticleRole !== "dg"\) \{\s*\n\s*return res\.status\(403\)/
  );
  // La garde précède l'écriture.
  const iGarde = h.indexOf('updateArticleRole !== "achats"');
  const iWrite = h.indexOf('.update(clean)');
  assert.ok(iGarde > -1 && iWrite > -1 && iGarde < iWrite, 'garde avant écriture');
  // Aucun rôle/profil lu depuis le body — c'était la faille de create-article.
  assert.doesNotMatch(h, /req\.body[^\n]*(profileId|role)\b/);
  assert.doesNotMatch(h, /(updated_by|updates)[^\n]*\.profileId/);
});

test('create-article — le rôle ne vient plus du body (il était usurpable)', () => {
  const h = handlerSource('create-article');
  assert.match(h, /const createArticleRole = await resolveCallerRole\(authUser\);/);
  assert.match(
    h,
    /if \(createArticleRole !== "achats" && createArticleRole !== "dg"\) \{\s*\n\s*return res\.status\(403\)/
  );
  // L'ancienne garde `created_by?.profileId && …` se contournait en omettant
  // simplement `created_by` : elle ne doit plus exister sous aucune forme.
  assert.doesNotMatch(h, /created_by\??\.profileId/);
  assert.doesNotMatch(h, /req\.body[^\n]*\.profileId/);
  const iGarde = h.indexOf('createArticleRole !== "achats"');
  const iWrite = h.indexOf('.set({ ...createData');
  assert.ok(iGarde > -1 && iWrite > -1 && iGarde < iWrite, 'garde avant écriture');
});

test('validate-delete-article — rôle résolu SERVEUR avant le active:false', () => {
  const h = handlerSource('validate-delete-article');
  assert.match(h, /const deleteArticleRole = await resolveCallerRole\(authUser\);/);
  // Cette action DÉSACTIVE une fiche du catalogue : la garde doit tenir la
  // séquence complète, condition sur la variable serveur + return.
  //
  // PÉRIMÈTRE VERROUILLÉ : dg | finance | audit_interne — exactement les
  // profils auxquels le menu expose l'écran `fin_delete_articles`
  // (NAV_ITEMS_FINANCE). Le test tient les DEUX bords :
  //  - élargir (retirer un `!==`) rouvre la faille ;
  //  - restreindre (ajouter un `!==`, p. ex. retirer `audit_interne`) retire
  //    une capacité existante, ce qui est une décision PRODUIT et doit donc
  //    faire rougir ici plutôt que de passer inaperçu dans une revue.
  assert.match(
    h,
    /if \(deleteArticleRole !== "dg" && deleteArticleRole !== "finance" && deleteArticleRole !== "audit_interne"\) \{\s*\n\s*return res\.status\(403\)/
  );
  // Aucun profil supplémentaire ne se glisse dans la condition.
  const conditionGarde = h.slice(h.indexOf('if (deleteArticleRole'), h.indexOf('return res.status(403)'));
  assert.equal(
    (conditionGarde.match(/deleteArticleRole !== /g) || []).length,
    3,
    'la garde compare exactement 3 profils : dg, finance, audit_interne'
  );
  const iGarde = h.indexOf('deleteArticleRole !== "dg"');
  const iDesactive = h.indexOf('active: false');
  assert.ok(iGarde > -1 && iDesactive > -1 && iGarde < iDesactive, 'garde avant le active:false');
  // `validated_by` reste un champ d'audit : il ne doit jamais servir de garde.
  assert.doesNotMatch(h, /validated_by[^\n]*\.profileId/);
  assert.doesNotMatch(h, /req\.body[^\n]*(profileId|role)\b/);
});

test('les trois actions gardées appellent resolveCallerRole exactement une fois', () => {
  // Deux appels dans un même handler = deux variables, donc le risque qu'une
  // garde s'appuie sur la mauvaise. Une seule source de vérité par handler.
  for (const nom of ['update-article', 'create-article', 'validate-delete-article']) {
    const h = handlerSource(nom);
    assert.equal(
      (h.match(/resolveCallerRole\(authUser\)/g) || []).length,
      1,
      nom + ' : un seul resolveCallerRole'
    );
  }
});
