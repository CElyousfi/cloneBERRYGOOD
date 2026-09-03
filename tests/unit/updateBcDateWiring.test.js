/*
 * updateBcDateWiring.test.js — garde-fou STRUCTUREL sur le câblage de l'action
 * `update-bc-date` dans functions/index.js.
 *
 * ── POURQUOI CE TEST EXISTE ────────────────────────────────────────────────
 * Un bon de consommation porte une `date`, et les `stock_movements` créés par
 * `create-bc` (type consommation, BCS-…) en portent une COPIE. Ce sont ces
 * mouvements — pas le bon — que lisent les analyses par période. Mettre à jour
 * la date du bon SANS celle des mouvements ne casse rien visiblement : le bon
 * affiche la bonne date, et les analyses restent silencieusement fausses.
 *
 * La logique pure est testée dans bcDate.test.js, mais la TRANSACTION vit dans
 * le monolithe (non requérable en test : Firebase Admin au load). Ce test
 * confronte donc le source à ses invariants : rôle résolu serveur, validation
 * de date, requête sur les mouvements liés, et écritures des deux côtés dans
 * UNE SEULE `runTransaction`.
 *
 * ── RÈGLE DE RÉDACTION DE CE FICHIER ──────────────────────────────────────
 * Chaque assertion doit verrouiller l'EFFET d'une garde, jamais la simple
 * PRÉSENCE d'un appel. Une garde se vérifie sur sa forme complète
 * `if (<condition>) { return res.status(<code>) }` : sinon supprimer le
 * `return` (ou déplacer la condition sur une donnée client) laisse la suite
 * verte tout en ouvrant le trou que le test prétend fermer.
 * Toute nouvelle assertion ici doit être validée par mutation : casser la
 * garde DOIT faire rougir ce fichier.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = require('../helpers/backendSource').backendSource();

/** Corps du handler `update-bc-date` (de sa garde d'action au handler suivant). */
function handlerSource() {
  const start = SRC.indexOf('if (action === "update-bc-date"');
  assert.notEqual(start, -1, 'action update-bc-date absente de functions/index.js');
  // Borne = le marqueur de la section SUIVANTE (`delete-bc`, ajouté par le
  // ticket sb/bc-doublons-garde). Élargir cette borne ferait entrer le handler
  // voisin dans les `doesNotMatch` ci-dessous, qui rougiraient sur du code
  // parfaitement légitime — et pousserait à affaiblir les assertions.
  const next = SRC.indexOf('// ========== SUPPRESSION D\'UN BON DE CONSOMMATION ==========', start);
  assert.notEqual(next, -1, 'fin du handler introuvable');
  return SRC.slice(start, next);
}

test('update-bc-date — rôle résolu SERVEUR, jamais depuis le body', () => {
  const h = handlerSource();
  // Le rôle vient du TOKEN…
  assert.match(h, /const bcDateRole = await resolveCallerRole\(authUser\);/);
  // …et c'est bien CE rôle qui garde le 403, avec `return` : brancher la garde
  // sur une donnée du body (req.body.role) ou retirer le return laisserait
  // n'importe quel utilisateur authentifié redater n'importe quel bon.
  assert.match(h, /if \(bcDateRole !== "magasinier" && bcDateRole !== "dg"\) \{\s*\n\s*return res\.status\(403\)/);
  // Aucune identité/rôle lu depuis le body, sous quelque nom que ce soit.
  assert.doesNotMatch(h, /req\.body[^\n]*(profileId|role|uid)/);
});

test('update-bc-date — bc_id manquant : 400 avant toute écriture', () => {
  const h = handlerSource();
  assert.match(h, /if \(!bcDateId \|\| typeof bcDateId !== "string"\) \{\s*\n\s*return res\.status\(400\)/);
});

test('update-bc-date — la date est validée par le module pur avant toute écriture', () => {
  const h = handlerSource();
  // La date du jour passée au validateur est calculée SERVEUR (Africa/Casablanca),
  // jamais reçue du client : la vérifier dans l'appel lui-même, pas à côté.
  assert.match(h, /bcDate\.validateBcDate\(bcNewDate, stockFilesRecord\.todayInCasablanca\(\)\)/);
  // Le RÉSULTAT de la validation conditionne réellement la suite (400 + return).
  // Sans ce `return`, une date au format libre ou dans le futur serait écrite
  // dans le bon ET dans tous ses mouvements de stock, sans erreur.
  assert.match(h, /if \(!bcDateCheck\.valid\) \{\s*\n\s*return res\.status\(400\)/);
  // Et la validation précède la transaction.
  const iValidate = h.indexOf('validateBcDate');
  const iTx = h.indexOf('runTransaction');
  assert.ok(iValidate > -1 && iTx > -1 && iValidate < iTx, 'validation avant transaction');
});

test('update-bc-date — bon inexistant : 404, aucune écriture', () => {
  const h = handlerSource();
  assert.match(h, /if \(!bcSnap\.exists\) return \{ notFound: true \};/);
  // Le 404 doit être GARDÉ par le drapeau notFound (et pas seulement présent
  // quelque part dans le handler) : sinon un bon inexistant répondrait 200.
  assert.match(h, /if \(bcDateResult\.notFound\) \{\s*\n\s*return res\.status\(404\)/);
});

test('update-bc-date — bon ET stock_movements liés mis à jour dans LA MÊME transaction', () => {
  const h = handlerSource();
  // Une seule transaction dans tout le handler.
  assert.equal((h.match(/runTransaction/g) || []).length, 1);

  const tx = h.slice(h.indexOf('runTransaction'));
  // Les mouvements liés sont sélectionnés par bc_id (pas bc_numero, qui n'est
  // pas la clé de jointure posée par create-bc).
  assert.match(h, /collection\("stock_movements"\)\.where\("bc_id", "==", bcDateId\)/);
  // Lectures avant écritures (contrainte Firestore), puis les DEUX updates,
  // toutes deux via le handle `tx` (une écriture via `d.ref.update(...)`
  // sortirait de la transaction sans que rien ne le signale).
  const iGetBc = tx.indexOf('tx.get(bcDateRef)');
  const iGetMov = tx.indexOf('tx.get(bcDateMovQuery)');
  const iUpdBc = tx.indexOf('tx.update(bcDateRef, patch.bcUpdate)');
  const iUpdMov = tx.indexOf('tx.update(d.ref, patch.movementUpdate)');
  assert.ok(iGetBc > -1 && iGetMov > -1 && iUpdBc > -1 && iUpdMov > -1, 'lectures et écritures présentes');
  assert.ok(iGetBc < iUpdBc && iGetMov < iUpdBc, 'toutes les lectures avant les écritures');
  assert.ok(iUpdMov > iUpdBc, 'les mouvements sont mis à jour dans la même transaction');
  // Aucune écriture hors transaction, ni avant…
  assert.doesNotMatch(h.slice(0, h.indexOf('runTransaction')), /\.update\(|\.set\(|\.add\(/);
  // …ni après (la réponse HTTP ne doit rien réécrire).
  assert.doesNotMatch(h.slice(h.indexOf('if (bcDateResult.notFound)')), /\.update\(|\.set\(|\.add\(/);
});

test('update-bc-date — seule la date est modifiée (aucun autre champ métier touché)', () => {
  const h = handlerSource();
  // Les payloads d'écriture viennent EXCLUSIVEMENT du module pur (patch.*),
  // jamais d'un objet construit à la volée dans le handler.
  const updates = h.match(/tx\.update\([^)]*\)/g) || [];
  assert.equal(updates.length, 2);
  updates.forEach((u) => assert.match(u, /patch\.(bcUpdate|movementUpdate)/));
  // Aucun recopiage du body dans une écriture (spread ou Object.assign).
  assert.doesNotMatch(h, /\.\.\.req\.body|Object\.assign\([^)]*req\.body/);
  for (const champ of ['items', 'quantite', 'parcelle', 'ferme', 'type', 'numero']) {
    assert.doesNotMatch(h, new RegExp('\\b' + champ + ':'), 'le handler ne doit pas écrire ' + champ);
  }
});
