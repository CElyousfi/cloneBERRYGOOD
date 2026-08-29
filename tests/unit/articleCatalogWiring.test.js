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
  assert.doesNotMatch(h, /Buffer\.from\([^)]*categorieCanonique/);
  assert.doesNotMatch(h, /Buffer\.from\([^)]*toLowerCase/);
});

test('import-articles-excel — la formule du docId reste sur la catégorie BRUTE', () => {
  const h = handlerSource('import-articles-excel');
  assert.match(h, /Buffer\.from\(`\$\{nom\}\|\$\{art\.categorie \|\| ""\}`\)/);
  assert.doesNotMatch(h, /Buffer\.from\([^)]*categorieCanonique/);
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
  // La catégorie est ramenée à son LIBELLÉ CANONIQUE à l'enregistrement — et
  // par la règle UNIQUE du dépôt. La minuscule d'avant repeuplait le catalogue
  // de `engrais`/`pesticides` à chaque réimport.
  assert.match(h, /categorie: articleCategories\.categorieCanonique\(row\.categorie\)/);
  assert.doesNotMatch(h, /normalizeCategorie/);
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
  assert.match(h, /categorie: articleCategories\.categorieCanonique\(art\.categorie\)/);
  assert.doesNotMatch(h, /normalizeCategorie/);
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
  assert.match(h, /categorie: articleCategories\.categorieCanonique\(categorie\)/);
  assert.doesNotMatch(h, /normalizeCategorie/);
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
  // MISE À JOUR CONSCIENTE (ticket sb/classer-depuis-bandeau) : la garde n'est
  // plus une comparaison de rôle en dur mais la règle PURE
  // `stockRoles.peutModifierArticle(role)`. Le PÉRIMÈTRE est identique —
  // `achats` ou `dg`, accès complet pour les deux : la condition a seulement
  // été sortie du monolithe pour devenir testable. Les deux propriétés qui
  // comptaient restent tenues ici : (a) c'est bien le rôle résolu SERVEUR qui
  // décide, (b) le `return` est DANS la garde, sinon l'update s'exécuterait
  // quand même après la réponse.
  //
  // MISE À JOUR CONSCIENTE n°2 (ticket sb/unite-conversion) : la garde devient
  // `peutModifierChampsArticle(role, updates)`, qui décide AUSSI sur le contenu
  // réel d'`updates` — c'est ce qui ouvre au magasinier les deux seuls champs
  // de conversion d'unité. `achats`/`dg` restent NON bridés (test suivant).
  // L'argument `updates` est verrouillé ici : la décision ne doit jamais se
  // prendre sur une déclaration du client (`req.body.champs`, par exemple).
  assert.match(
    h,
    /const updateArticlePerm = stockRoles\.peutModifierChampsArticle\(updateArticleRole, updates\);\s*\n\s*if \(!updateArticlePerm\.ok\) \{\s*\n\s*return res\.status\(403\)/
  );
  // La garde précède l'écriture.
  const iGarde = h.indexOf('stockRoles.peutModifierChampsArticle');
  const iWrite = h.indexOf('.update(clean)');
  assert.ok(iGarde > -1 && iWrite > -1 && iGarde < iWrite, 'garde avant écriture');
  // Aucun rôle/profil lu depuis le body — c'était la faille de create-article.
  // (`profileId:` posé dans `clean.updated_by` vient du token, pas du body :
  // on cible donc bien une LECTURE `.profileId`, pas une écriture.)
  assert.doesNotMatch(h, /req\.body[^\n]*(profileId|role)\b/);
  assert.doesNotMatch(h, /(updated_by|updates)[^\n]*\.profileId/);
});

test('update-article — un DG envoyant le formulaire COMPLET est accepté', () => {
  // GARDE ANTI-RÉGRESSION EXPLICITE. Stock › Articles (public/app.jsx,
  // `handleUpdate`) envoie TOUJOURS l'intégralité du formulaire, jamais un
  // champ isolé. Toute règle qui trierait les champs pour le `dg` ferait donc
  // tomber cet écran en 403 pour lui — une capacité qu'il a depuis toujours.
  // Une version antérieure de ce ticket avait introduit exactement ce bridage.
  const { peutModifierArticle } = require('../../functions/lib/stockRoles');
  const h = handlerSource('update-article');
  // Les champs REELLEMENT acceptés par l'action, lus dans le source : si la
  // liste évolue, ce test suit sans qu'on ait à la recopier.
  const m = h.match(/const allowed = \[([^\]]+)\]/);
  assert.ok(m, 'liste `allowed` introuvable dans update-article');
  const champs = m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  assert.ok(champs.length >= 10, 'formulaire attendu large, trouvé ' + champs.length + ' champs');
  assert.ok(champs.includes('prix_ht') && champs.includes('categorie'));

  assert.strictEqual(
    peutModifierArticle('dg').ok,
    true,
    'le DG doit pouvoir éditer une fiche COMPLÈTE (' + champs.length + ' champs) : '
      + 'c’est le comportement historique de Stock › Articles.'
  );
  assert.strictEqual(peutModifierArticle('achats').ok, true);
  // …et la garde refuse toujours les autres.
  assert.strictEqual(peutModifierArticle('magasinier').ok, false);
  assert.strictEqual(peutModifierArticle(null).ok, false);

  // Le DG envoyant le formulaire ENTIER passe la garde RÉELLEMENT câblée —
  // celle qui décide sur le contenu d'`updates`. C'est le bridage par champ qui
  // avait été introduit puis retiré : il doit rester impossible de le
  // ré-introduire sans faire rougir ce test.
  const { peutModifierChampsArticle } = require('../../functions/lib/stockRoles');
  const formulaireEntier = {};
  for (const c of champs) formulaireEntier[c] = 'x';
  assert.strictEqual(peutModifierChampsArticle('dg', formulaireEntier).ok, true);
  assert.strictEqual(peutModifierChampsArticle('achats', formulaireEntier).ok, true);

  // …et le bridage ne peut pas non plus revenir PAR UN AUTRE CHEMIN : un
  // second `return res.status(403)` posé après la garde (« si le rôle n'est
  // pas achats et que `updates` contient un prix… ») rebriderait le DG sans
  // qu'aucune règle pure ne bouge. Le handler n'a donc DROIT QU'À UN SEUL 403,
  // celui du module.
  const refus403 = h.match(/return res\.status\(403\)/g) || [];
  assert.strictEqual(refus403.length, 1, 'un seul refus 403, rendu par le module pur');
});

test('update-article — le magasinier n\'entre QUE par les deux champs de conversion', () => {
  // Droit NOUVEAU (2026-08-29) pour un rôle qui n'avait AUCUN accès au
  // catalogue : il n'a pas l'écran Stock › Articles, mais c'est lui qui sait
  // qu'un fût d'acide nitrique de 25 L pèse 33 kg.
  const { peutModifierChampsArticle } = require('../../functions/lib/stockRoles');
  const h = handlerSource('update-article');
  const m = h.match(/const allowed = \[([^\]]+)\]/);
  const champs = m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  // Les deux champs doivent être RÉELLEMENT écrits par l'action, sinon le
  // magasinier reçoit un 200 sans que rien ne change.
  assert.ok(champs.includes('unite_consommation'), 'unite_consommation absente de `allowed`');
  assert.ok(champs.includes('stock_par_unite_consommation'), 'facteur absent de `allowed`');
  assert.strictEqual(peutModifierChampsArticle('magasinier', { unite_consommation: 'L', stock_par_unite_consommation: 1.32 }).ok, true);
  // …et un champ de plus fait tomber TOUTE la requête.
  assert.strictEqual(peutModifierChampsArticle('magasinier', { unite_consommation: 'L', prix_ht: 0 }).ok, false);
  assert.strictEqual(peutModifierChampsArticle('magasinier', { prix_ht: 0 }).ok, false);
  // Le facteur écrit est NORMALISÉ par le module pur : un facteur illisible
  // devient `null`, jamais une chaîne stockée telle quelle.
  assert.match(h, /clean\.stock_par_unite_consommation = uniteConso\.lireFacteur\(clean\.stock_par_unite_consommation\);/);
});

test('update-article — l’identité de `updated_by` vient du TOKEN, pas du body', () => {
  const h = handlerSource('update-article');
  // Sans cette imposition, un `updated_by: {}` envoyé par le client rendait la
  // modification ANONYME — y compris un changement de catégorie fait par le DG,
  // qui est précisément la nouvelle capacité ouverte par ce ticket.
  assert.match(
    h,
    /clean\.updated_by = Object\.assign\(\{\}, updated_by \|\| \{\}, \{[\s\S]*?uid: \(authUser && authUser\.uid\)/,
    'les champs d’identité doivent être écrasés APRÈS le `updated_by` client (Object.assign)'
  );
  assert.match(h, /profileId: updateArticleRole \|\| null/);
});

test('update-article — une catégorie modifiée PURGE le cache de la conso par parcelle', () => {
  const h = handlerSource('update-article');
  // `campagne-conso-parcelle` cache sa réponse 30 min et y résout la catégorie
  // à la LECTURE : sans purge, corriger une fiche ne change rien à l'écran
  // pendant une demi-heure, sans la moindre erreur visible.
  assert.match(
    h,
    /if \(clean\.categorie !== undefined\) \{\s*\n\s*await invalidateApiCachePrefix\(consoBons\.CONSO_PARCELLE_CACHE_PREFIX\);/
  );
  const iWrite = h.indexOf('.update(clean)');
  const iPurge = h.indexOf('invalidateApiCachePrefix');
  assert.ok(iWrite > -1 && iPurge > -1 && iWrite < iPurge, 'purge APRÈS l’écriture');
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

// ───────────────────────────────────────────────────────────────────────────
// 3bis. FUSION DE DOUBLONS — garde élargie au DG (2026-08-27)
// ───────────────────────────────────────────────────────────────────────────
//
// Les deux actions de fusion étaient verrouillées en dur sur `achats`, profil
// qu'aucun humain n'utilise : l'outil, pourtant livré et testé, n'a JAMAIS pu
// être exécuté en production. Ces tests tiennent les deux bords :
//  - la garde existe toujours et refuse les autres profils (l'élargissement
//    n'est pas une ouverture) ;
//  - elle passe par la règle PURE, donc retirer `dg` fait rougir le module.

for (const nomAction of ['suggest-article-duplicates', 'merge-articles']) {
  test(nomAction + ' — rôle résolu SERVEUR, garde pure, 403 avec return', () => {
    const h = handlerSource(nomAction);
    assert.match(h, /const callerRole = await resolveCallerRole\(authUser\);/);
    // La séquence COMPLÈTE : la règle pure décide, et le `return` est DANS la
    // garde. Sans le `return`, la fusion s'exécuterait après la réponse 403.
    assert.match(
      h,
      /stockRoles\.peutFusionnerArticles\(callerRole\);\s*\n\s*if \(![A-Za-z]+Perm\.ok\) \{\s*\n\s*return res\.status\(403\)/,
      'la garde doit déléguer à la règle pure et retourner immédiatement'
    );
    // Le message rendu à l'appelant EST celui de la règle (« …achats ou au
    // DG ») : un message en dur redeviendrait faux au premier changement de
    // périmètre, et c'est exactement ce mensonge qui a coûté ce ticket.
    assert.doesNotMatch(h, /Seul le responsable achats peut fusionner/);
    assert.doesNotMatch(h, /error: "Réservé au responsable achats"/);
    assert.match(h, /return res\.status\(403\)\.json\(\{ success: false, error: [A-Za-z]+Perm\.raison \}\)/);
    // Aucune comparaison de rôle en dur ne subsiste à côté de la règle pure :
    // elle rouvrirait le verrou `achats` sans faire rougir le module.
    assert.doesNotMatch(h, /callerRole !== "/);
    // Le rôle ne vient JAMAIS du body (faille historique de create-article).
    assert.doesNotMatch(h, /req\.body[^\n]*(profileId|role)\b/);
    // Un seul resolveCallerRole : deux variables = risque que la garde
    // s'appuie sur la mauvaise.
    assert.equal((h.match(/resolveCallerRole\(authUser\)/g) || []).length, 1);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 3ter. FUSION DE DOUBLONS — les DONNÉES DE DÉCISION remontent à l'écran
// ───────────────────────────────────────────────────────────────────────────
//
// La projection ne gardait que {reference, nom, categorie, unite} : la pop-up
// affichait deux fiches jumelles indiscernables, et présélectionnait
// `articles[0]`. Comme `merge-articles` ne transfère NI prix NI nb_achats vers
// le maître, un maître choisi au hasard laisse un article actif NON
// VALORISABLE. Ces trois champs sont donc la condition même d'un choix éclairé.

test('suggest-article-duplicates — la projection remonte le docId, clé de fusion', () => {
  const h = handlerSource('suggest-article-duplicates');
  // `merge-articles` résout par `.doc(<clé>)`. Sans `id`, l'écran n'a que le
  // champ `reference`, qui diverge du docId sur 92 fiches et pointe des
  // documents FANTÔMES sans nom — la fusion s'y exécuterait.
  assert.match(h, /\n\s*id: d\.id,/, 'le docId doit être projeté');
  // …et il reste distinct de `reference`, qui garde son repli d'affichage.
  assert.match(h, /reference: data\.reference \|\| d\.id,/);
});

test('suggest-article-duplicates — la projection remonte prix_pmp, prix_ht et nb_achats', () => {
  const h = handlerSource('suggest-article-duplicates');
  for (const champ of ['prix_pmp', 'prix_ht', 'nb_achats']) {
    assert.match(
      h,
      new RegExp(champ + ': data\\.' + champ + ' === undefined \\? null : data\\.' + champ),
      champ + ' absent de la projection : l’écran ne peut plus décider'
    );
  }
  // …et la projection reste bien celle des articles envoyés à groupDuplicates
  // (sinon les assertions ci-dessus pourraient viser un objet sans rapport).
  const iMap = h.indexOf('snap.docs.map(d => {');
  const iGroup = h.indexOf('articleMerge.groupDuplicates(articles)');
  assert.ok(iMap > -1 && iGroup > -1 && iMap < iGroup, 'projection puis groupement');
});

test('suggest-article-duplicates — la suggestion vient du module pur, pas du handler', () => {
  const h = handlerSource('suggest-article-duplicates');
  // Le handler renvoie TEL QUEL ce que rend groupDuplicates : la règle de
  // choix ne doit avoir qu'une seule implémentation, dans lib/stockMerge.
  assert.match(h, /const groups = articleMerge\.groupDuplicates\(articles\);/);
  assert.match(h, /return res\.json\(\{ success: true, groups \}\);/);
  assert.doesNotMatch(h, /prix_pmp\s*>\s*0/, 'la règle de choix ne doit pas être recopiée ici');
});

test('la réponse de suggest-article-duplicates porte un maître suggéré exploitable', () => {
  // Contrepartie EXÉCUTABLE : on rejoue la projection du handler sur des
  // documents et on vérifie la forme réellement servie à l'écran.
  const articleMerge = require('../../functions/lib/stockMerge/articleMerge');
  const docs = [
    { reference: 'AVEC_PRIX', nom: 'VERTIMEC', categorie: 'Phyto', unite: 'L', prix_pmp: 38.25, prix_ht: null, nb_achats: 0 },
    { reference: 'SANS_PRIX', nom: 'Vertimec', categorie: 'phyto', unite: 'L', prix_pmp: null, prix_ht: null, nb_achats: 4 },
  ];
  const [g] = articleMerge.groupDuplicates(docs);
  assert.equal(g.decidable, true);
  assert.equal(g.master_suggere, 'AVEC_PRIX');
  assert.match(g.raison, /38,25 DH/);
  assert.equal(g.articles.find((a) => a.reference === 'SANS_PRIX').nb_achats, 4);
});

// ───────────────────────────────────────────────────────────────────────────
// 3quater. FUSION — refus des fiches FANTÔMES, en entrée de merge-articles
// ───────────────────────────────────────────────────────────────────────────
//
// La garde ne testait que `masterSnap.data().active === false` : un document
// sans champ `active` donnait `undefined !== false` et passait. Il existe en
// production 5 documents fantômes (`ENG 0150`, `ENG 0952`, `eng 1245`,
// `eng 456`, `enr 14`) sans `nom` ni `active`. Fusionner vers l'un d'eux
// réécrit `article_nom: ""` sur les mouvements ouverts, `article: ""` sur les
// lignes de BDC ouverts, pose les soldes sous un nom vide et désactive le vrai
// doublon — pendant que la vraie fiche reste active. Rien ne prévient : la
// prévisualisation n'affiche que des compteurs.

test('merge-articles — master ET doublons passent par la garde d’intégrité PURE', () => {
  const h = handlerSource('merge-articles');
  // Master : la garde délègue à la règle pure et retourne immédiatement.
  assert.match(
    h,
    /const masterIntegrite = articleMerge\.verifierIntegriteFiche\(masterData, master_ref, "master"\);\s*\n\s*if \(!masterIntegrite\.ok\) \{\s*\n\s*return res\.status\(400\)\.json\(\{ success: false, error: masterIntegrite\.erreur \}\);/,
    'la garde du master doit déléguer à la règle pure et retourner'
  );
  // Doublons : MÊME garde, dans la boucle de validation.
  assert.match(
    h,
    /const doublonIntegrite = articleMerge\.verifierIntegriteFiche\(doublonData, doublonRefs\[i\], "doublon"\);\s*\n\s*if \(!doublonIntegrite\.ok\) \{\s*\n\s*return res\.status\(400\)\.json\(\{ success: false, error: doublonIntegrite\.erreur \}\);/,
    'la garde des doublons doit déléguer à la règle pure et retourner'
  );
  // L'ancienne garde négative ne subsiste dans AUCUNE ligne de code (les
  // commentaires, eux, ont le droit de la citer) : elle laissait passer tout
  // document sans champ `active`.
  const codeSeul = h.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(codeSeul, /active === false/, 'garde négative encore présente');
  assert.doesNotMatch(codeSeul, /masterSnap\.data\(\)\.active/);
});

test('merge-articles — la garde d’intégrité précède toute lecture opérationnelle', () => {
  const h = handlerSource('merge-articles');
  const iMaster = h.indexOf('masterIntegrite');
  const iDoublon = h.indexOf('doublonIntegrite');
  const iMouvements = h.indexOf('collection("stock_movements")');
  assert.ok(iMaster > -1 && iDoublon > -1 && iMouvements > -1, 'gardes et collecte présentes');
  assert.ok(iMaster < iMouvements, 'master validé avant la collecte');
  assert.ok(iDoublon < iMouvements, 'doublons validés avant la collecte');
  // `masterNom` — qui sert à réécrire les libellés — n'est lu qu'APRÈS la garde.
  const iNom = h.indexOf('const masterNom =');
  assert.ok(iNom > -1 && iMaster < iNom, 'le nom du master est lu après sa validation');
});

test('merge-articles — la garde d’intégrité est bien la règle pure testée', () => {
  // Contrepartie EXÉCUTABLE des assertions de source : la fonction pointée par
  // le câblage refuse réellement le fantôme « magical ».
  const { verifierIntegriteFiche } = require('../../functions/lib/stockMerge/articleMerge');
  assert.equal(verifierIntegriteFiche({ prix_ht: 42 }, 'ENG 0150', 'master').ok, false);
  assert.equal(verifierIntegriteFiche({ active: true, nom: 'MAGICAL' }, 'ENG0150', 'master').ok, true);
});

test('merge-articles — la garde précède TOUTE écriture de fusion', () => {
  const h = handlerSource('merge-articles');
  const iGarde = h.indexOf('stockRoles.peutFusionnerArticles');
  const iExecute = h.indexOf('mode === "execute"');
  assert.ok(iGarde > -1 && iExecute > -1 && iGarde < iExecute, 'garde avant le mode execute');
  // Aucun écrit Firestore avant la garde.
  assert.doesNotMatch(h.slice(0, iGarde), /\.(set|update|delete|add|commit)\(/);
});

test('la règle de fusion autorise exactement achats + dg', () => {
  // Contrepartie EXÉCUTABLE des assertions de source ci-dessus : le câblage
  // pointe la bonne fonction, et cette fonction a le bon périmètre.
  const { peutFusionnerArticles } = require('../../functions/lib/stockRoles');
  assert.strictEqual(peutFusionnerArticles('dg').ok, true, 'le DG doit pouvoir fusionner');
  assert.strictEqual(peutFusionnerArticles('achats').ok, true);
  for (const r of ['magasinier', 'finance', 'audit_interne', null, undefined]) {
    assert.strictEqual(peutFusionnerArticles(r).ok, false, 'profil ' + String(r));
  }
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

// ───────────────────────────────────────────────────────────────────────────
// 4. UNE SEULE RÈGLE DE CATÉGORIE DANS LE DÉPÔT
// ───────────────────────────────────────────────────────────────────────────
//
// Deux règles concurrentes (`normalizeCategorie` en minuscules d'un côté, la
// liste canonique de l'autre) sont exactement ce qui a produit `Engrais` ET
// `engrais` au catalogue. `normalizeCategorie` a donc été RETIRÉE : tous les
// chemins d'écriture passent par `articleCategories.categorieCanonique`.
//
// ── PORTÉE EXACTE DE CES ASSERTIONS, ET SA LIMITE ─────────────────────────
// Ce fichier lit un SOURCE : il prouve qu'une ligne est écrite, pas qu'elle
// s'exécute. Mesuré : insérer `delete data.categorie;` avant l'écriture de
// `import-articles-sql` laisse la suite ENTIÈREMENT VERTE — l'import
// n'écrirait plus aucune catégorie alors que la ligne
// `categorie: articleCategories.categorieCanonique(row.categorie)` reste bien
// présente et satisfait l'assertion. Fermer ce trou demande un test contre
// l'emulator Firestore, hors périmètre de ce lot et sciemment non fait.
// La leçon opérationnelle est celle du test `classer-article` plus bas :
// ancrer chaque assertion sur le BLOC qui écrit, jamais sur le handler entier.

test('functions/index.js n’appelle plus AUCUNE normalisation de catégorie concurrente', () => {
  assert.doesNotMatch(
    SRC,
    /normalizeCategorie/,
    'normalizeCategorie a été retirée : une seule règle de catégorie (categorieCanonique)'
  );
  // …et le module qui la portait ne l'exporte plus.
  const articleMerge = require('../../functions/lib/stockMerge/articleMerge');
  assert.equal(articleMerge.normalizeCategorie, undefined);
});

test('les QUATRE chemins d’écriture du catalogue posent le libellé CANONIQUE', () => {
  // Trois imports/créations + le classement depuis le bandeau Campagne. En
  // oublier un suffit à repeupler le catalogue de variantes.
  for (const nomAction of ['import-articles-sql', 'import-articles-excel', 'create-article']) {
    const h = handlerSource(nomAction);
    assert.match(
      h,
      /categorie: articleCategories\.categorieCanonique\(/,
      nomAction + ' : la catégorie écrite doit être canonique'
    );
  }
  const classer = handlerSource('classer-article');
  assert.match(classer, /const classerCat = articleCategories\.categorieCanonique\(categorie\);/);

  // ⚠️ ANCRAGE SUR LE BLOC D'ÉCRITURE, JAMAIS SUR LE HANDLER ENTIER.
  // `categorie: classerCat,` apparaît DEUX fois dans ce handler : dans le
  // `classerBatch.update(...)` (ce qui part réellement en base) et dans l'écho
  // de la réponse HTTP. Une assertion posée sur tout le handler est satisfaite
  // par l'un OU par l'autre — chacun couvre l'autre, et elle ne peut donc plus
  // échouer sur l'écriture. Mesuré : remplacer la valeur ÉCRITE par
  // `String(categorie || '')` laissait la suite entièrement VERTE, alors que le
  // DG classant un article depuis le bandeau posait `pesticide` au singulier
  // (la 21e orthographe que ce lot supprime) sur TOUTES ses fiches homonymes,
  // en silence — la borne `familleBucket`, elle, est calculée sur `classerCat`
  // et continuait de passer.
  const iBoucle = classer.indexOf('for (let i = 0; i < classerCibles.length');
  const iCommit = classer.indexOf('await classerBatch.commit()');
  assert.ok(iBoucle > -1 && iCommit > -1 && iBoucle < iCommit, 'boucle d’écriture par chunks introuvable');
  const ecriture = classer.slice(iBoucle, iCommit);

  // La cible de l'update est bien une fiche du catalogue…
  assert.match(
    ecriture,
    /classerBatch\.update\(db_firestore\.collection\("articles_catalog"\)\.doc\(refId\), \{/,
    'écriture catalogue introuvable dans la boucle'
  );
  // …et la SEULE catégorie écrite est `classerCat`, la valeur canonique qui a
  // franchi la borne. `deepEqual` sur la liste complète des clés `categorie:`
  // du bloc tient les deux bords : substituer la valeur ET en ajouter une
  // seconde font rougir.
  assert.deepEqual(
    ecriture.match(/categorie: [^,\n]+/g) || [],
    ['categorie: classerCat'],
    'la valeur ÉCRITE doit être `classerCat`, jamais la valeur brute du body'
  );

  // NOTE : l'écho de la réponse HTTP (`categorie: classerCat` dans le
  // `res.json`) n'est DÉLIBÉRÉMENT pas asserté ici. L'asserter recouplerait les
  // deux occurrences et ce test redeviendrait satisfiable sans l'écriture —
  // exactement le défaut qu'on vient de corriger. L'écho est cosmétique :
  // l'écran recharge la conso après le classement.

  // Le module est bien requis (sinon les assertions ci-dessus viseraient une
  // référence indéfinie, et TOUTES les Cloud Functions tomberaient au runtime).
  assert.match(SRC, /const articleCategories = require\("\.\/lib\/stockMerge\/articleCategories"\);/);
});

test('la règle de catégorie backend est bien celle testée, et ne requiert JAMAIS public/', () => {
  // Contrepartie EXÉCUTABLE + garde anti-crash : `require('../public/…')`
  // depuis functions/ ferait échouer le chargement de TOUTES les Cloud
  // Functions en production (Firebase ne déploie que functions/), sans qu'aucun
  // test local ne le voie.
  const fsMod = require('node:fs');
  const src = fsMod.readFileSync(
    path.join(__dirname, '../../functions/lib/stockMerge/articleCategories.js'),
    'utf8'
  );
  // Assertion sur le CODE seul : l'en-tête du module cite volontairement le
  // `require('../public/…')` interdit pour expliquer pourquoi il l'est.
  const codeSeul = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(codeSeul, /require\(/, 'le backend ne doit requérir NI public/ ni quoi que ce soit');

  const { categorieCanonique } = require('../../functions/lib/stockMerge/articleCategories');
  assert.equal(categorieCanonique('engrais'), 'Engrais');
  assert.equal(categorieCanonique('Divers'), 'Divers');
  assert.equal(categorieCanonique(''), '');
});
