/*
 * createBcDoublonsWiring.test.js — garde-fou STRUCTUREL sur le câblage de la
 * garde anti-doublon dans l'action `create-bc` de functions/index.js.
 *
 * ── POURQUOI CE TEST EXISTE ────────────────────────────────────────────────
 * La logique de détection est pure et testée dans bcDoublons.test.js, mais elle
 * ne protège rien tant que le handler ne s'en sert pas POUR REFUSER. Le
 * monolithe n'est pas requérable en test (Firebase Admin au load) : on confronte
 * donc le source à ses invariants.
 *
 * ── RÈGLE DE RÉDACTION DE CE FICHIER ──────────────────────────────────────
 * Chaque assertion verrouille l'EFFET d'une garde, jamais la présence d'un
 * appel : une garde se vérifie sur sa forme complète
 * `if (<condition>) { return res.status(<code>) }`. Toute assertion ajoutée ici
 * doit être validée par mutation — casser la garde DOIT faire rougir ce fichier.
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

test('create-bc — le module pur est requis et utilisé (aucune détection réécrite sur place)', () => {
  assert.match(SRC, /const bcDoublons = require\("\.\/lib\/stock\/bcDoublons"\);/);
  const h = handlerSource();
  assert.match(h, /bcDoublons\.detecterDoublon\(/);
});

test('create-bc — un doublon détecté BLOQUE réellement la création (409 + return)', () => {
  const h = handlerSource();
  // Le verdict vient du module pur, sur les items TELS QUE PERSISTÉS…
  assert.match(h, /const bcVerdict = bcDoublons\.detecterDoublon\(\s*\n\s*\{ scan_url: scan_url \|\| null, date: bcDateValue, items: bcItems \},/);
  // …et c'est CE verdict qui garde le refus, avec `return` : sans le return, le
  // bon serait créé quand même et la garde ne serait qu'un message.
  assert.match(h, /if \(bcVerdict\.doublon && !bcForceDemande\) \{\s*\n\s*return res\.status\(409\)/);
  // Le message renvoyé est celui du module pur — il NOMME le bon existant ;
  // un message reconstruit sur place perdrait le numéro.
  assert.match(h, /error: bcVerdict\.message/);
  assert.match(h, /bon_numero: bcVerdict\.bon_numero/);
});

test('create-bc — la garde précède TOUTE écriture et la prise de numéro', () => {
  const h = handlerSource();
  const iDetect = h.indexOf('bcDoublons.detecterDoublon');
  const iRefus = h.indexOf('return res.status(409)');
  const iNumero = h.indexOf('getNextNumber("consumption_voucher"');
  const iAdd = h.indexOf('collection("consumption_vouchers").add(');
  assert.ok(iDetect > -1 && iRefus > -1 && iNumero > -1 && iAdd > -1);
  // Un bon refusé ne doit consommer ni numéro de séquence…
  assert.ok(iRefus < iNumero, 'le refus doit précéder getNextNumber');
  // …ni produire la moindre écriture.
  assert.ok(iRefus < iAdd, 'le refus doit précéder la création du document');
  assert.doesNotMatch(h.slice(0, iRefus), /\.add\(|\.update\(|\.set\(/);
});

test('create-bc — la fenêtre de comparaison est BORNÉE (pas tout l\'historique)', () => {
  const h = handlerSource();
  assert.match(h, /collection\("consumption_vouchers"\)\s*\n?\s*\.orderBy\("created_at", "desc"\)\.limit\(200\)\.get\(\);/);
});

test('create-bc — le forçage est un drapeau EXPLICITE passé au module pur', () => {
  const h = handlerSource();
  // Le drapeau vient du body (assumé : garde-fou de saisie, pas de sécurité),
  // mais il est normalisé par le module pur — jamais un simple test truthy,
  // qui laisserait n'importe quelle valeur parasite neutraliser la garde.
  assert.match(h, /const bcForceDemande = bcDoublons\.forcageDemande\(req\.body && req\.body\.force_doublon\);/);
  assert.doesNotMatch(h, /if \(req\.body\.force_doublon\)/);
});

test('create-bc — forcer SANS trace est impossible : la trace est écrite sur le bon', () => {
  const h = handlerSource();
  // La trace est construite dès qu'un doublon est forcé…
  assert.match(h, /if \(bcVerdict\.doublon && bcForceDemande\) \{\s*\n\s*const bcForceRole = await resolveCallerRole\(authUser\);\s*\n\s*bcForceTrace = bcDoublons\.construireTraceForcage\(\{/);
  // …et elle est réellement PERSISTÉE sur le document créé (sans cette ligne,
  // le forçage passerait sans laisser aucune trace).
  const bcData = h.slice(h.indexOf('const bcData = {'), h.indexOf('collection("consumption_vouchers").add('));
  assert.match(bcData, /doublon_force: bcForceTrace,/);
  assert.match(bcData, /action: bcDoublons\.HISTORY_ACTION_FORCAGE/);
});

test('create-bc — la trace du forçage vient du TOKEN, jamais du body', () => {
  const h = handlerSource();
  const trace = h.slice(h.indexOf('bcForceTrace = bcDoublons.construireTraceForcage('), h.indexOf('const numero = await getNextNumber'));
  // uid du token, profileId résolu serveur : aucune identité lue du body.
  assert.match(trace, /uid: \(authUser && authUser\.uid\) \|\| ""/);
  assert.match(trace, /profileId: bcForceRole \|\| ""/);
  assert.doesNotMatch(trace, /req\.body/);
  assert.doesNotMatch(trace, /created_by/);
});
