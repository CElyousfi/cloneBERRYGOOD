/*
 * deleteBcWiring.test.js — garde-fou STRUCTUREL sur le câblage de l'action
 * `delete-bc` dans functions/index.js.
 *
 * ── POURQUOI CE TEST EXISTE ────────────────────────────────────────────────
 * `create-bc` décrémente `stock_balances` au moment même de la création. Une
 * suppression qui n'annulerait pas cet impact ne casserait RIEN de visible :
 * le bon disparaît de la liste, et le stock reste amputé pour toujours. C'est
 * exactement le genre de trou qu'un test de logique pure ne voit pas, puisque
 * le reversal vit dans le monolithe (non requérable : Firebase Admin au load).
 *
 * ── RÈGLE DE RÉDACTION DE CE FICHIER ──────────────────────────────────────
 * Chaque assertion verrouille l'EFFET d'une garde, jamais la présence d'un
 * appel. Toute assertion ajoutée ici doit être validée par mutation.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = require('../helpers/backendSource').backendSource();

/** Corps du handler `delete-bc`. */
function handlerSource() {
  const start = SRC.indexOf('if (action === "delete-bc"');
  assert.notEqual(start, -1, 'action delete-bc absente de functions/index.js');
  const next = SRC.indexOf('// ========== STOCK DASHBOARD ==========', start);
  assert.notEqual(next, -1, 'fin du handler introuvable');
  return SRC.slice(start, next);
}

test('delete-bc — rôle résolu SERVEUR, garde effective, jamais depuis le body', () => {
  const h = handlerSource();
  // Le rôle vient du TOKEN…
  assert.match(h, /const bcDelRole = await resolveCallerRole\(authUser\);/);
  // …et c'est CE rôle qui est soumis à stockRoles (via le module pur), pas une
  // valeur du body : un rôle lu du body serait usurpable.
  assert.match(h, /bcSuppression\.validerSuppression\(\{\s*\n\s*role: bcDelRole,/);
  // Le verdict garde réellement la suite, avec `return` : sans lui, n'importe
  // quel utilisateur authentifié supprimerait n'importe quel bon.
  assert.match(h, /if \(!bcDelCheck\.ok\) \{\s*\n\s*return res\.status\(bcDelCheck\.code\)/);
  assert.doesNotMatch(h, /req\.body[^\n]*(profileId|role|uid)/);
});

test('delete-bc — la garde précède TOUTE écriture', () => {
  const h = handlerSource();
  const iRefus = h.indexOf('return res.status(bcDelCheck.code)');
  assert.ok(iRefus > -1);
  assert.doesNotMatch(h.slice(0, iRefus), /\.update\(|\.set\(|\.add\(|reverseStockImpact/);
});

test('delete-bc — le motif obligatoire est bien celui de l\'appelant, tracé', () => {
  const h = handlerSource();
  assert.match(h, /motif: req\.body && req\.body\.motif,/);
  // Le motif VALIDÉ (trimé) est celui qui part dans le patch — pas la valeur brute.
  assert.match(h, /motif: bcDelCheck\.motif,/);
});

test('delete-bc — l\'impact stock est ANNULÉ, sur les seuls mouvements concernés', () => {
  const h = handlerSource();
  // Les mouvements liés sont sélectionnés par bc_id (clé posée par create-bc).
  assert.match(h, /collection\("stock_movements"\)\s*\n?\s*\.where\("bc_id", "==", bcDelId\)\.get\(\);/);
  // Le tri vient du module pur (qui exclut les mouvements déjà supprimés), et
  // le reversal porte sur `aAnnuler` : sans cette boucle, la consommation
  // resterait déduite alors que le bon a disparu.
  assert.match(h, /const bcDelTri = bcSuppression\.trierMouvements\(bcDelMovs\);/);
  assert.match(h, /for \(const mov of bcDelTri\.aAnnuler\) \{\s*\n\s*await reverseStockImpact\(mov\);\s*\n\s*\}/);
});

test('delete-bc — le reversal précède le soft-delete des mouvements', () => {
  const h = handlerSource();
  const iRev = h.indexOf('await reverseStockImpact(mov)');
  const iMark = h.indexOf('await mov.ref.update(bcDelPatch.movementUpdate)');
  const iBon = h.indexOf('await bcDelRef.update(bcDelPatch.bcUpdate)');
  assert.ok(iRev > -1 && iMark > -1 && iBon > -1, 'reversal, marquage et suppression du bon présents');
  // Inverser l'ordre annulerait l'impact d'un mouvement déjà marqué supprimé.
  assert.ok(iRev < iMark, 'reversal AVANT le marquage des mouvements');
  assert.ok(iMark < iBon, 'les mouvements sont traités avant le bon');
});

test('delete-bc — soft-delete : le bon et ses mouvements sont marqués, jamais détruits', () => {
  const h = handlerSource();
  // Aucune destruction réelle : `.delete()` ferait perdre toute trace d'audit.
  assert.doesNotMatch(h, /\.delete\(\)/);
  // Les payloads viennent EXCLUSIVEMENT du module pur.
  const updates = h.match(/\.update\([^)]*\)/g) || [];
  assert.equal(updates.length, 2);
  updates.forEach((u) => assert.match(u, /bcDelPatch\.(bcUpdate|movementUpdate)/));
});

test('list-bc — les bons supprimés sortent de la liste', () => {
  const start = SRC.indexOf('if (action === "list-bc")');
  const h = SRC.slice(start, SRC.indexOf('if (action === "create-bc"', start));
  assert.match(h, /\.filter\(\(bc\) => bc\.deleted !== true\);/);
});
