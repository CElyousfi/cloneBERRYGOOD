'use strict';

// Test de CÂBLAGE (structurel, lecture du source) — même approche et mêmes
// garde-fous que tests/unit/classer-article-cablage.test.js, pour les mêmes
// raisons : `functions/index.js` est un monolithe sans injection de
// dépendances, on ne peut pas l'instancier sans Firestore. Ce n'est pas une
// preuve de comportement (celle-là est dans
// functions/lib/stock/__tests__/identiteArticle.test.js) : c'est un cliquet
// contre le débranchement silencieux du résolveur d'identité.
//
// CE QUE CE FICHIER GARDE (9 pièges, tous vérifiés « rouge » par mutation) :
//
//  1. La formule de l'identifiant de solde n'existe QU'À UN ENDROIT
//     (`identiteArticle.identifiantSoldeCanonique`). Elle en avait TROIS copies
//     — l'écriture, la garde « stock insuffisant », la purge de
//     `rebuildBalances` — et c'est leur divergence qui a permis à la garde
//     d'interroger un seau vide.
//
//  2. `applyStockImpact` / `reverseStockImpact` n'ont plus le repli
//     `item.article_ref || item.article` : c'est lui qui prenait un LIBELLÉ
//     pour une identité.
//
//  3. La garde « stock insuffisant » lit ses clés via
//     `identifiantsGardeStock`, donc à partir des lignes DÉJÀ RÉSOLUES. Le
//     mode de panne est SILENCIEUX : une garde qui lit sous l'ancienne clé
//     laisse sortir du stock inexistant sans la moindre erreur.
//
//  4. Les deux chemins de SAISIE LIBRE (`create-bc`, `create-movement`)
//     résolvent avant d'écrire et REFUSENT (fail-closed, décision d'Omar) —
//     mais le refus OUVRE une demande de création adressée au DG. Sans elle,
//     le magasinier serait enfermé : ces écrans n'ont pas le bouton « Créer
//     cet article » et `public/app.jsx` est gelé.
//
//  5. `create-bl` ne refuse JAMAIS. La ligne vient d'un BDC validé par le DG :
//     la réception est enregistrée, la ligne non résolue est écartée du stock
//     et marquée, une demande part. C'est la décision d'Omar, et c'est ce qui
//     débloque les 16 lignes de BDC en attente.
//
//  6. `create-movement` résout AVANT la garde de stock ET avant la
//     valorisation : résoudre après la garde la ferait lire l'ancienne clé.
//
//  7. `rebuildBalances` génère ET purge par la même règle. Sinon un import
//     supprime des soldes qu'il ne sait pas régénérer — c'est déjà arrivé.
//
//  8. Le DG est réellement prévenu (compteur d'agrégateur + WhatsApp par
//     TEMPLATE approuvé), et l'onglet visé EXISTE dans `public/app.jsx`.
//
//  9. Créer l'article CLÔT la demande : c'est ça, la validation du DG. Sans
//     clôture, le compteur ne redescendrait jamais.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const INDEX_RAW = require('../helpers/backendSource').backendSource();

/**
 * Retire commentaires de ligne et de bloc en respectant les littéraux de
 * chaîne, en PRÉSERVANT les offsets (remplacement par des espaces).
 * Copie volontaire de classer-article-cablage.js : ces tests doivent pouvoir
 * évoluer séparément.
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

const INDEX = stripComments(INDEX_RAW);

/**
 * Offset d'un marqueur ; échoue si absent (jamais de vert sur du vide).
 * @param {string} marker @param {string} quoi
 * @returns {number}
 */
function offset(marker, quoi) {
  const at = INDEX.indexOf(marker);
  assert.notStrictEqual(
    at,
    -1,
    quoi + ' : marqueur `' + marker + '` introuvable dans functions/index.js — '
      + 'code renommé ou supprimé ? Mettre ce test à jour, ne pas le supprimer.'
  );
  return at;
}

/**
 * Corps d'une fonction `async function <nom>(` jusqu'au marqueur de fin donné.
 * @param {string} nom @param {string} fin
 * @returns {string}
 */
function corpsFonction(nom, fin) {
  const start = offset('async function ' + nom + '(', 'fonction ' + nom);
  const end = INDEX.indexOf(fin, start);
  assert.notStrictEqual(end, -1, 'fin de `' + nom + '` introuvable (marqueur `' + fin + '`)');
  return INDEX.slice(start, end);
}

/**
 * Bloc `if (action === "<nom>")` : du marqueur au `if (action ===` suivant.
 * @param {string} nom
 * @returns {string}
 */
function actionBlock(nom) {
  const marker = 'if (action === "' + nom + '"';
  const start = offset(marker, 'action ' + nom);
  let end = INDEX.indexOf('if (action ===', start + marker.length);
  if (end === -1) end = INDEX.length;
  return INDEX.slice(start, end);
}

// --------------------------------------------------------------------------
// 1. UNE seule formule d'identifiant de solde, dans le module pur.
// --------------------------------------------------------------------------

test('aucun accès à stock_balances ne construit son identifiant à la main', () => {
  // Les copies historiques de la formule partageaient ce motif :
  //   `${lieuType}_${lieuId}_${articleRef}`.replace(/\s+/g, '_')
  // Plutôt que de chasser le motif (d'autres domaines ont des clés de cache qui
  // lui ressemblent), on contrôle ce qui compte : l'ARGUMENT passé à
  // `stock_balances.doc(...)`. Un littéral de gabarit y signale une formule
  // recalculée sur place — donc libre de diverger de celle de l'écriture.
  const acces = [...INDEX.matchAll(/collection\("stock_balances"\)\s*\.doc\(([^)]*)\)/g)]
    .map((m) => m[1].trim());
  assert.ok(acces.length >= 3, 'accès à stock_balances introuvables : test à mettre à jour');
  const enDur = acces.filter((a) => a.includes('`'));
  assert.deepStrictEqual(
    enDur,
    [],
    'identifiant de solde construit en ligne : passer par '
      + 'identiteArticle.identifiantSoldeCanonique (source unique du dépôt)'
  );
});

test('updateStockBalance construit son identifiant via le module pur', () => {
  const corps = corpsFonction('updateStockBalance', 'async function applyStockImpact');
  assert.ok(
    corps.includes('identiteArticle.identifiantSoldeCanonique(lieuType, lieuId, ficheId)'),
    'updateStockBalance doit dériver son balanceId du module pur, depuis une identité résolue'
  );
  assert.ok(
    /article_ref:\s*ficheId/.test(corps),
    '`article_ref` du document de solde doit recevoir le docId de fiche, pas un libellé'
  );
  assert.ok(
    /article_nom:\s*articleNom/.test(corps),
    '`article_nom` doit garder le libellé saisi — c\'est ce que le magasinier lit'
  );
});

// --------------------------------------------------------------------------
// 2. Le repli « libellé = identité » a disparu des deux helpers d'impact.
// --------------------------------------------------------------------------

test('applyStockImpact et reverseStockImpact n\'ont plus le repli article_ref || article', () => {
  for (const [nom, fin] of [
    ['applyStockImpact', 'async function reverseStockImpact'],
    ['reverseStockImpact', 'function getChefProfileForFerme'],
  ]) {
    const corps = corpsFonction(nom, fin);
    assert.ok(
      !corps.includes('item.article_ref || item.article'),
      nom + ' : le repli `item.article_ref || item.article` prend un LIBELLÉ pour une '
        + 'identité — c\'est lui qui fabriquait un second document de solde'
    );
    assert.ok(
      corps.includes('identiteArticle.identiteImpact(item, identiteIndex)'),
      nom + ' doit résoudre l\'identité de chaque ligne'
    );
  }
});

test('apply et reverse partagent la MÊME résolution — une annulation vise le même document', () => {
  // Deux résolutions distinctes pourraient diverger : le reverse re-créditerait
  // un seau et en débiterait un autre, en silence. La règle vit dans le module
  // PUR (donc testable par comportement, cf. identiteArticle.test.js) et les
  // deux helpers l'appellent, à l'identique.
  const occurrences = (INDEX.match(/identiteArticle\.identiteImpact\(item, identiteIndex\)/g) || []).length;
  assert.strictEqual(occurrences, 2, 'apply et reverse, et eux seuls, appellent la règle pure');
  assert.ok(
    !INDEX.includes('function identiteLigneImpact'),
    'la règle ne doit plus vivre dans le monolithe : un `return brut` inconditionnel '
      + 'y serait invérifiable par un test de comportement'
  );
});

// --------------------------------------------------------------------------
// 3. La garde « stock insuffisant » lit la clé RÉSOLUE. Panne silencieuse.
// --------------------------------------------------------------------------

test('la garde de stock dérive ses clés des lignes RÉSOLUES', () => {
  const block = actionBlock('create-movement');
  assert.ok(
    block.includes('identiteArticle.identifiantsGardeStock(lieu_source, movItems)'),
    'la garde doit construire ses clés via identifiantsGardeStock, à partir de movItems '
      + '(lignes résolues) — sinon elle lit un document qui n\'existe pas et laisse '
      + 'sortir du stock inexistant, SANS erreur'
  );
  assert.ok(
    !block.includes('movItems.map((it) => it.article_ref).filter(Boolean)'),
    'la garde ne doit plus se construire ses propres clés'
  );
  // Et elle doit indexer les soldes lus par ficheId, pas par libellé.
  assert.ok(
    /availableByRef\[c\.ficheId\]/.test(block),
    'les soldes lus doivent être indexés par docId de fiche (la même clé que checkStockAvailability lira)'
  );
});

test('la garde de stock lit APRÈS la résolution, jamais avant', () => {
  const block = actionBlock('create-movement');
  const resolution = block.indexOf('const movResolution = await resoudreLignesStock');
  const garde = block.indexOf('identifiantsGardeStock');
  assert.notStrictEqual(resolution, -1, 'résolution introuvable dans create-movement');
  assert.notStrictEqual(garde, -1, 'garde introuvable dans create-movement');
  assert.ok(
    resolution < garde,
    'résoudre APRÈS la garde la ferait lire l\'ancienne clé : le mode de panne le plus vicieux du chantier'
  );
});

test('create-movement résout AVANT la valorisation (qui lit article_nom)', () => {
  const block = actionBlock('create-movement');
  assert.ok(
    block.indexOf('const movResolution = await resoudreLignesStock')
      < block.indexOf('receptionBdc.valoriserItemsReception(movItems'),
    'la valorisation doit recevoir des lignes résolues'
  );
});

// --------------------------------------------------------------------------
// 4. Fail-closed sur les trois chemins de saisie.
// --------------------------------------------------------------------------

test('create-movement UTILISE les lignes résolues, pas les lignes saisies', () => {
  // Sans cette assertion, `const movItems = movItemsSaisis;` court-circuite le
  // résolveur en laissant TOUT le reste du câblage en place : la résolution est
  // calculée, le refus fonctionne, la garde appelle bien `identifiantsGardeStock`
  // — et le libellé repart quand même dans `article_ref`. Mutant survivant
  // constaté le 2026-08-31, d'où ce test.
  const block = actionBlock('create-movement');
  assert.ok(
    block.includes('const movItems = movResolution.lignes;'),
    'movItems doit être LIÉ à la sortie du résolveur'
  );
  // `movItemsSaisis` ne doit vivre que le temps d'être résolu : deux mentions,
  // sa déclaration et son passage au résolveur. Toute autre utilisation
  // remettrait un libellé en circulation.
  const mentions = (block.match(/movItemsSaisis/g) || []).length;
  assert.strictEqual(
    mentions,
    2,
    'les lignes SAISIES ne doivent servir qu\'à alimenter le résolveur '
      + '(déclaration + appel), jamais à alimenter le stock'
  );
});

test('create-movement REFUSE un article non résolu, avec son code', () => {
  const block = actionBlock('create-movement');
  assert.ok(block.includes('if (!movResolution.ok)'), 'refus fail-closed absent');
  assert.ok(
    block.includes('error: demandeCreationArticle.messageRefus(movResolution.refus.details, movDemandes)'),
    'le refus doit NOMMER l\'article et annoncer la demande de création'
  );
  assert.ok(block.includes('code: movResolution.refus.code'));
});

test('create-bc résout depuis le catalogue déjà chargé, et REFUSE', () => {
  const block = actionBlock('create-bc');
  assert.ok(
    block.includes('identiteArticle.indexerFiches(bcCatalogDocs)'),
    'create-bc doit bâtir son index sur le catalogue COMPLET (les fiches fusionnées '
      + 'sont nécessaires pour suivre merged_into)'
  );
  assert.ok(
    !block.includes('collection("articles_catalog").where("active", "==", true)'),
    'le catalogue doit être lu entier : un `where active == true` masque les fiches fusionnées'
  );
  assert.ok(
    block.includes('bcCatalogDocs.filter((a) => a.active === true)'),
    'la conversion d\'unité doit continuer de ne voir QUE les fiches actives (comportement inchangé)'
  );
  assert.ok(block.includes('if (!bcResolution.ok)'), 'refus fail-closed absent');
  assert.ok(
    block.includes('error: demandeCreationArticle.messageRefus(bcResolution.refus.details, bcDemandes)'),
    'le refus doit NOMMER l\'article et annoncer la demande de création'
  );
});

test('create-bc écrit le docId de fiche dans les lignes de stock, le libellé dans article_nom', () => {
  const block = actionBlock('create-bc');
  assert.ok(
    /article_ref:\s*bcFicheParArticle\.get\(it\.article \|\| ""\) \|\| "",/.test(block),
    'les lignes du mouvement de consommation doivent porter l\'identité résolue'
  );
  assert.ok(
    /article_nom:\s*it\.article \|\| "",/.test(block),
    'le libellé saisi reste dans article_nom'
  );
});

test('create-bc refuse AVANT getNextNumber : un bon refusé ne consomme pas de numéro', () => {
  const block = actionBlock('create-bc');
  assert.ok(
    block.indexOf('if (!bcResolution.ok)')
      < block.indexOf('await getNextNumber("consumption_voucher"'),
    'la résolution doit précéder l\'allocation du numéro de bon'
  );
});

// --------------------------------------------------------------------------
// 5. create-bl : refuser AVANT d'écrire le BL.
// --------------------------------------------------------------------------

test('create-bl NE REFUSE JAMAIS une réception — décision d\'Omar', () => {
  const block = actionBlock('create-bl');
  // La ligne vient d'un BDC validé par le DG : le magasinier n'a pas choisi ce
  // libellé. Un refus le punirait pour une décision d'achat et retiendrait une
  // marchandise physiquement livrée (16 lignes de BDC réellement bloquées).
  assert.ok(
    !block.includes('blResolution'),
    'create-bl ne doit plus porter de refus fail-closed : la réception est TOUJOURS enregistrée'
  );
  assert.ok(
    block.includes('demandeCreationArticle.partitionnerLignesReception('),
    'create-bl doit PARTITIONNER (ce qui entre en stock / ce qui est écarté), pas refuser'
  );
  // ⚠️ L'assertion qui MORD réellement. Les deux précédentes se contentent de
  // constater des noms : un `return res.status(400)` réinséré après la
  // partition les laisse toutes les deux vertes tout en rétablissant le blocage
  // que la décision d'Omar supprime. Mutant survivant constaté le 2026-09-01.
  // Invariant : une fois la partition faite, PLUS RIEN n'interrompt la requête
  // avant que le bon de livraison ne soit écrit.
  const partition = block.indexOf('demandeCreationArticle.partitionnerLignesReception(');
  const ecritureBl = block.indexOf('collection("delivery_notes").add(blData)');
  assert.ok(partition > -1 && ecritureBl > partition, 'ordre partition → écriture attendu');
  const entreDeux = block.slice(partition, ecritureBl);
  assert.ok(
    !entreDeux.includes('return res.status('),
    'AUCUN refus ne doit s\'intercaler entre la partition et l\'écriture du BL : '
      + 'la marchandise est livrée, la réception doit être enregistrée'
  );
});

test('create-bl : une ligne non résolue ne produit AUCUN mouvement de stock', () => {
  const block = actionBlock('create-bl');
  // Le point qui compte : ce sont les lignes RETENUES qui construisent le
  // mouvement. Passer `blItems` (toutes les lignes) ferait entrer en stock un
  // article sans fiche — le solde orphelin que tout ce lot supprime.
  assert.match(
    block,
    /blItems: blPartition\.retenues,/,
    'le mouvement de réception doit être bâti sur les seules lignes retenues'
  );
  assert.ok(
    block.includes('const brMovement = brNumero ? receptionBdc.construireMouvementReception('),
    'sans ligne retenue, aucun mouvement ne doit être construit'
  );
});

test('create-bl : la ligne écartée reste sur le BL, marquée', () => {
  const block = actionBlock('create-bl');
  assert.ok(
    block.includes('demandeCreationArticle.marquerLignesEcartees('),
    'le BL garde toutes ses lignes ; l\'écart doit être VISIBLE, sinon il passe pour une perte'
  );
  assert.match(block, /items: blItems,/, 'le BL persiste les lignes marquées');
});

test('create-bl enregistre une demande de création pour chaque ligne écartée', () => {
  const block = actionBlock('create-bl');
  assert.match(
    block,
    /const blDemandes = blPartition\.ecartees\.length\s*\n\s*\? await enregistrerDemandesCreation\(/,
    'une ligne écartée sans demande laisserait l\'article introuvable pour toujours'
  );
});

test('create-bl n\'alloue ses numéros de séquence qu\'après tous les refus (N4)', () => {
  const block = actionBlock('create-bl');
  // L'invariant n'est pas « le numéro est pris tard » — c'est « une fois le
  // numéro pris, plus aucun refus ». Formulé autrement, le test se laissait
  // berner par un déplacement du `getNextNumber` qui ne change rien.
  const numeroBl = block.indexOf('getNextNumber("delivery_note", "BL")');
  const ecritureBl = block.indexOf('collection("delivery_notes").add(blData)');
  assert.notStrictEqual(numeroBl, -1, 'allocation du numéro BL introuvable');
  assert.ok(ecritureBl > numeroBl, 'ordre numéro → écriture attendu');
  assert.ok(
    !block.slice(numeroBl, ecritureBl).includes('return res.status('),
    'un refus après l\'allocation ferait consommer un numéro de séquence à une '
      + 'réception qui n\'existera jamais'
  );
  assert.match(
    block,
    /const brNumero = blPartition\.retenues\.length\s*\n\s*\? await getNextNumber\("stock_reception", "BR"\)/,
    'le numéro BR ne doit être pris que s\'il y a réellement une réception à créer'
  );
});

test('create-bl substitue le docId de fiche dans les lignes du mouvement de réception', () => {
  const block = actionBlock('create-bl');
  assert.ok(
    block.includes('article_ref: blIdentites.get('),
    'le mouvement de réception doit porter l\'identité résolue, pas le libellé du BL'
  );
  assert.ok(
    block.indexOf('article_ref: blIdentites.get(')
      < block.indexOf('collection("stock_movements").add(brMovement)'),
    'la substitution doit précéder l\'écriture du mouvement'
  );
});

test('create-bl ne contrôle que les lignes RÉELLEMENT reçues', () => {
  const block = actionBlock('create-bl');
  assert.ok(
    block.includes('blItemsSaisis.filter((it) => it.quantite_recue > 0)'),
    'une ligne commandée mais non livrée n\'entre pas en stock : elle n\'a pas besoin d\'identité, '
      + 'et l\'écarter produirait une demande de création parasite'
  );
});

// --------------------------------------------------------------------------
// 8. Le magasinier demande, le DG crée (décision d'Omar).
// --------------------------------------------------------------------------

test('un refus de saisie OUVRE une demande de création — le magasinier n\'est pas enfermé', () => {
  for (const [action, prefixe] of [['create-movement', 'mov'], ['create-bc', 'bc']]) {
    const block = actionBlock(action);
    assert.ok(
      block.includes('await enregistrerDemandesCreation('),
      action + ' : un refus sans demande enferme le magasinier — ces écrans n\'ont pas '
        + 'le bouton « Créer cet article » et public/app.jsx est gelé'
    );
    assert.ok(
      block.includes('error: demandeCreationArticle.messageRefus(' + prefixe + 'Resolution.refus.details, ' + prefixe + 'Demandes)'),
      action + ' : le message doit annoncer que la demande est partie, et ne le promettre '
        + 'que pour les demandes RÉELLEMENT enregistrées'
    );
  }
});

test('la demande est enregistrée AVANT que le refus ne parte', () => {
  // Un `return` avant l'enregistrement rendrait le message menteur : il
  // annoncerait une demande qui n'existe pas.
  const block = actionBlock('create-movement');
  assert.ok(
    block.indexOf('await enregistrerDemandesCreation(') < block.indexOf('code: movResolution.refus.code'),
    'ordre inversé : le message promettrait une demande jamais écrite'
  );
});

test('index.js DÉLÈGUE l\'écriture des demandes au module injectable', () => {
  // La logique a quitté le monolithe pour `lib/stock/demandesCreationIO`, où
  // elle est testée par COMPORTEMENT (dépendances injectées). Deux mutants
  // avaient survécu aux assertions de source d'ici — R2 (`throw` avant les
  // notifications) et R3 (`if (ecarts.length && enregistres.length)`, qui
  // rendait 0 dispatch sur un article ambigu). On ne garde donc ici que le
  // CÂBLAGE ; le contrat est vérifié dans
  // functions/lib/stock/__tests__/demandesCreationIO.test.js.
  const corps = corpsFonction('enregistrerDemandesCreation', 'async function cloturerDemandesCreationSatisfaites');
  assert.ok(
    corps.includes('demandesCreationIO.enregistrerDemandesCreation('),
    'l\'écriture des demandes doit passer par le module injectable'
  );
  assert.ok(
    corps.includes('dispatchNotification,'),
    'le dispatch réel doit être injecté, sinon le module ne prévient personne en production'
  );
  assert.ok(
    !corps.includes('.set('),
    'plus aucune écriture directe ici : elle redeviendrait invérifiable par un test de comportement'
  );
});



test('le motif porté par la ligne est DÉRIVÉ de son issue, jamais constant', () => {
  const block = actionBlock('create-bl');
  assert.match(
    block,
    /marquerLignesEcartees\(\s*\n\s*blItemsSaisis,\s*\n\s*blPartition\.ecartees,[\s\S]*?blPartition\.resolutions\s*\n\s*\)/,
    'sans les résolutions, le motif redevient une constante — et il MENT sur un '
      + 'article en double (« absent du catalogue », « demande envoyée » : faux deux fois)'
  );
});

test('le compteur DG existe dans l\'agrégateur, et pointe un onglet RÉEL', () => {
  const dgBloc = INDEX.slice(offset('if (profile === "dg")', 'bloc DG des notifications'));
  const fin = dgBloc.indexOf('if (profile === "finance")');
  const bloc = dgBloc.slice(0, fin === -1 ? dgBloc.length : fin);
  assert.ok(
    bloc.includes('key: "articles_a_creer"'),
    'sans compteur, la demande vit dans une collection que personne n\'ouvre'
  );
  assert.ok(
    bloc.includes('tab: "achats_catalogue"'),
    'l\'onglet visé doit exister : achats_catalogue est l\'écran Catalogue, '
      + 'celui qui porte le bouton « Nouvel article »'
  );
  // L'onglet nommé doit réellement être rendu par le front.
  const APP = require('./_sources').modulesSource();
  assert.ok(
    APP.includes("renderTab('achats_catalogue'"),
    'l\'onglet achats_catalogue doit être rendu par public/app.jsx'
  );
});

test('créer l\'article CLÔT la demande — c\'est ça, la validation du DG', () => {
  const block = actionBlock('create-article');
  assert.ok(
    block.includes('await cloturerDemandesCreationSatisfaites(db_firestore)'),
    'sans clôture, le compteur DG ne redescendrait jamais et la demande resterait ouverte '
      + 'sur un article qui existe'
  );
  assert.ok(
    block.indexOf('collection("articles_catalog").doc(reference).set(')
      < block.indexOf('await cloturerDemandesCreationSatisfaites('),
    'la clôture doit suivre la création, pas la précéder'
  );
});

test('la clôture utilise la règle canon du module pur, pas une comparaison réécrite', () => {
  const corps = corpsFonction('cloturerDemandesCreationSatisfaites', 'exports.');
  assert.ok(
    corps.includes('demandeCreationArticle.demandesAClore('),
    'la correspondance libellé/fiche doit être la MÊME que celle de l\'identité'
  );
  assert.ok(
    corps.includes('getIdentiteArticleIndex(db_firestore, { force: true })'),
    'clôturer sur un catalogue périmé de 5 min laisserait la demande ouverte '
      + 'juste après que le DG a créé la fiche'
  );
});

test('les trois actions de demande ont une garde de rôle SERVEUR', () => {
  // `article_delete_requests`, dont ce flux reprend le patron, n'en a AUCUNE
  // sur ses actions `request-*` / `list-*`. Ne pas reproduire le défaut.
  for (const action of [
    'request-article-creation',
    'list-article-creation-requests',
    'close-article-creation-requests',
  ]) {
    const block = actionBlock(action);
    assert.ok(
      block.includes('await resolveCallerRole(authUser)'),
      action + ' : rôle résolu SERVEUR obligatoire'
    );
    assert.ok(
      block.includes('return res.status(403)'),
      action + ' : la garde doit REFUSER, pas seulement calculer un rôle'
    );
    assert.ok(
      !block.includes('req.body.profileId'),
      action + ' : le rôle ne doit jamais venir du body'
    );
  }
});

test('demander un article DÉJÀ au catalogue n\'ouvre pas de demande', () => {
  const block = actionBlock('request-article-creation');
  assert.ok(
    block.indexOf('if (dejaLa.issue === identiteArticle.ISSUE_RESOLU)')
      < block.indexOf('await enregistrerDemandesCreation('),
    'le contrôle d\'existence doit précéder l\'enregistrement'
  );
});

// --------------------------------------------------------------------------
// 6. rebuildBalances : générer ET purger avec la même règle.
// --------------------------------------------------------------------------

test('rebuildBalances génère et purge par le module pur, sans formule locale', () => {
  const corps = corpsFonction('rebuildBalances', 'async function executeImport');
  assert.ok(
    !corps.includes('const keyOf ='),
    'rebuildBalances ne doit plus porter sa propre formule de clé'
  );
  assert.ok(
    corps.includes('identiteArticle.agregerSoldes(deltas, identiteIndex)'),
    'la génération doit passer par le module pur (identité résolue)'
  );
  assert.ok(
    corps.includes('identiteArticle.docsAPurger(soldes,'),
    'la purge doit être DÉRIVÉE des clés générées — sinon un import supprime des soldes '
      + 'qu\'il ne sait pas régénérer'
  );
  assert.ok(
    !corps.includes('const seen = new Set()'),
    'l\'ancien ensemble `seen` recalculait la règle de purge à côté de la génération'
  );
});

test('rebuildBalances travaille sur un index FRAIS', () => {
  const corps = corpsFonction('rebuildBalances', 'async function executeImport');
  assert.ok(
    corps.includes('getIdentiteArticleIndex(db_firestore, { force: true })'),
    'un import recalcule TOUT l\'inventaire : il ne doit pas le faire sur un catalogue '
      + 'vieux de 5 minutes, l\'import venant lui-même de créer des fiches'
  );
});

// --------------------------------------------------------------------------
// 7. Le cache d'identité est purgé quand le catalogue change.
// --------------------------------------------------------------------------

test('la création d\'un article purge l\'index : la sortie « créer au catalogue » est immédiate', () => {
  const block = actionBlock('create-article');
  assert.ok(
    block.includes('invalidateIdentiteArticleIndex()'),
    'sans purge, le magasinier qui crée l\'article se voit refuser son bon pendant 5 min — '
      + 'le refus fail-closed l\'enfermerait'
  );
});

test('fusion et suppression d\'article purgent aussi l\'index', () => {
  assert.ok(
    actionBlock('merge-articles').includes('invalidateIdentiteArticleIndex()'),
    'une fusion change merged_into : la résolution doit le voir tout de suite'
  );
  assert.ok(
    actionBlock('validate-delete-article').includes('invalidateIdentiteArticleIndex()'),
    'une fiche supprimée ne doit plus servir d\'identité'
  );
});

test('un refus déclenche UNE relecture forcée du catalogue avant de conclure', () => {
  // Marqueur de fin = du CODE, pas un commentaire : les commentaires sont
  // effacés par stripComments.
  const corps = corpsFonction('resoudreLignesStock', 'const PMP_INVOICE_CACHE_TTL_MS');
  assert.ok(
    corps.includes('{ force: true }'),
    'sans relecture, un article créé par une AUTRE instance de la function resterait '
      + 'inconnu pendant 5 minutes — et le bon serait refusé à tort'
  );
});
