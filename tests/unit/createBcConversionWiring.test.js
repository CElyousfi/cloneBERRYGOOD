/*
 * createBcConversionWiring.test.js — garde-fou STRUCTUREL sur le câblage de la
 * conversion d'unité dans l'action `create-bc` de functions/index.js.
 *
 * ── POURQUOI CE TEST EXISTE ────────────────────────────────────────────────
 * La conversion est pure et testée dans functions/lib/uniteConso/__tests__ ;
 * elle ne corrige RIEN tant que le handler ne s'en sert pas pour décider de la
 * quantité réellement déduite du stock. Le monolithe n'est pas requérable en
 * test (Firebase Admin au load) : on confronte donc le source à ses invariants.
 *
 * Ce qui est verrouillé :
 *  1. le mouvement de stock (et donc le solde) porte la quantité EN UNITÉ DE
 *     STOCK quand une conversion s'applique — sinon on retire toujours 5 « L »
 *     d'un solde tenu en kilos, et le ticket n'a rien corrigé ;
 *  2. le bon conserve la SAISIE du magasinier : la quantité convertie est
 *     ajoutée à côté, jamais substituée (le bon papier fait foi) ;
 *  3. les lignes NON convertibles sont déduites telles quelles (décision
 *     d'Omar : signaler, ne pas bloquer) ET consignées sur le bon + renvoyées
 *     à l'écran de saisie ;
 *  4. aucun facteur n'est deviné dans le monolithe (pas de `|| 1`, pas de
 *     table de densités écrite sur place).
 *
 * ── RÈGLE DE RÉDACTION ────────────────────────────────────────────────────
 * Chaque assertion verrouille un EFFET, jamais la présence d'un appel. Toute
 * assertion ajoutée ici doit être validée par MUTATION.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');

/** Corps du handler `create-bc` (de sa garde d'action au handler suivant). */
function handlerSource() {
  const start = SRC.indexOf('if (action === "create-bc"');
  assert.notEqual(start, -1, 'action create-bc absente de functions/index.js');
  const next = SRC.indexOf('// ========== MODIFICATION DE LA DATE', start);
  assert.notEqual(next, -1, 'fin du handler introuvable');
  return SRC.slice(start, next);
}

test('create-bc — le module pur est requis, et depuis functions/ (jamais public/)', () => {
  assert.match(SRC, /const uniteConso = require\("\.\/lib\/uniteConso"\);/);
  // Un require('../public/…') déploierait des Cloud Functions qui tombent
  // TOUTES au chargement (Firebase ne package que functions/).
  assert.doesNotMatch(SRC, /require\([^)]*public\/lib\/uniteConsoUtils/);
});

test('create-bc — la conversion est calculée par le module pur, sur les items persistés', () => {
  const h = handlerSource();
  assert.match(h, /const bcIndexUnites = uniteConso\.indexerArticles\(/);
  assert.match(h, /const bcConversion = uniteConso\.analyserLignes\(bcItemsSaisis, bcIndexUnites\);/);
  // Le facteur n'est jamais relu ni recalculé sur place : aucune arithmétique
  // de conversion dans le monolithe.
  assert.doesNotMatch(h, /stock_par_unite_consommation\s*\|\|\s*1/);
  assert.doesNotMatch(h, /\*\s*\(?\s*facteur/);
});

test('create-bc — le MOUVEMENT de stock porte la quantité convertie', () => {
  const h = handlerSource();
  // C'est l'assertion centrale du ticket : la ligne du mouvement (celle qui
  // alimente updateStockBalance) prend `quantite_stock` dès qu'une conversion
  // a été appliquée, et l'unité de stock avec.
  assert.match(h, /quantite: it\.conversion_appliquee \? it\.quantite_stock : \(it\.quantite \|\| 0\)/);
  assert.match(h, /unite: it\.conversion_appliquee \? it\.unite_stock : \(it\.unite \|\| "kg"\)/);
  // Le solde est mis à jour à partir de CES lignes-là.
  assert.match(h, /updateStockBalance\(lieuSource\.type, lieuSource\.id, it\.article_ref, it\.article_nom, it\.unite, -it\.quantite\)/);
  const iItems = h.indexOf('const bcsItems = parcItems.map');
  const iBal = h.indexOf('updateStockBalance(lieuSource.type');
  assert.ok(iItems > -1 && iBal > -1 && iItems < iBal, 'le solde doit être calculé sur les lignes converties');
});

test('create-bc — le bon CONSERVE la saisie du magasinier', () => {
  const h = handlerSource();
  // `quantite` / `unite` du bon restent ceux du bon papier ; la conversion est
  // ajoutée à côté. Substituer la valeur convertie ferait mentir le document.
  assert.match(h, /return Object\.assign\(\{\}, it, \{/);
  assert.match(h, /unite_stock: v\.converti \? v\.unite_stock : it\.unite/);
  assert.match(h, /quantite_stock: v\.converti \? v\.quantite_stock : it\.quantite/);
  // La trace de conversion est portée par la ligne du mouvement aussi, sinon
  // une correction d'inventaire ne saurait pas ce qui a été appliqué.
  assert.match(h, /quantite_saisie: it\.quantite \|\| 0/);
  assert.match(h, /unite_saisie: it\.unite \|\| "kg"/);

  // ⚠️ ASSERTION D'ABSENCE, et c'est elle qui protège vraiment. Vérifier la
  // seule PRÉSENCE de `quantite_stock:` laisse passer l'ajout d'un
  // `quantite: v.converti ? …` dans le même Object.assign : le bon porterait
  // alors 6,6 KG au lieu du 5 L écrit sur le papier, et la saisie du
  // magasinier serait perdue IRRÉVERSIBLEMENT (aucune trace ailleurs).
  const iAssign = h.indexOf('return Object.assign({}, it, {');
  const iFin = h.indexOf('});', iAssign);
  const bloc = h.slice(iAssign, iFin);
  assert.doesNotMatch(bloc, /(^|[^_])\bquantite:/, 'le bon ne doit JAMAIS réécrire `quantite`');
  assert.doesNotMatch(bloc, /(^|[^_])\bunite:/, 'le bon ne doit JAMAIS réécrire `unite`');
  // …et l'objet de départ est bien la ligne SAISIE, pas une reconstruction.
  assert.match(h, /const bcItems = bcItemsSaisis\.map\(/);
  // Le document écrit en base est celui-là, pas une variante recalculée.
  assert.match(h, /\n\s*items: bcItems,/);
});

test('create-bc — une ligne non convertible est SIGNALÉE, jamais bloquée', () => {
  const h = handlerSource();
  // Aucun refus n'est ajouté sur la conversion : le seul 4xx du handler qui
  // parle de conversion serait un blocage, contraire à la décision d'Omar.
  assert.doesNotMatch(h, /return res\.status\(4\d\d\)[^\n]*conversion/i);
  assert.doesNotMatch(h, /non_convertibles\.length[^\n]*\n?[^\n]*return res\.status/);
  // Elle est consignée sur le bon…
  assert.match(h, /lignes_non_convertibles: bcConversion\.non_convertibles,\s*\n\s*doublon_force/);
  // …et renvoyée à l'écran de saisie, qui doit pouvoir le dire tout de suite.
  assert.match(h, /return res\.json\(\{\s*\n\s*success: true, id: docRef\.id, numero,\s*\n\s*lignes_non_convertibles: bcConversion\.non_convertibles,/);
  // …et la ligne elle-même reste marquée dans le mouvement.
  assert.match(h, /conversion_manquante: !!it\.conversion_manquante/);
});

test('create-bc — la conversion se calcule AVANT la création du bon et des mouvements', () => {
  const h = handlerSource();
  const iConv = h.indexOf('uniteConso.analyserLignes');
  const iAdd = h.indexOf('collection("consumption_vouchers").add(');
  const iMov = h.indexOf('collection("stock_movements").add(');
  assert.ok(iConv > -1 && iAdd > -1 && iMov > -1);
  assert.ok(iConv < iAdd, 'conversion avant l\'écriture du bon');
  assert.ok(iConv < iMov, 'conversion avant l\'écriture des mouvements');
});
