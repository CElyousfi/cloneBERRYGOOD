'use strict';

/**
 * Tests de buildReceptionCreatedMessage (public/lib/bdcReceptionUtils.js).
 * Run with: npm run test:unit
 *
 * Ce message est le SEUL endroit où un humain apprend qu'un article vient
 * d'entrer en stock sans prix. S'il ne le dit pas, la quantité devient
 * invisible dans les coûts sans que personne ne l'ait décidé — et le seul
 * moment où quelqu'un connaît la livraison assez bien pour retrouver le prix
 * est passé.
 *
 * Il ne doit plus JAMAIS annoncer une validation Achats : cette étape n'existe
 * plus, et l'annoncer ferait attendre une validation qui ne viendra pas — c'est
 * ce qui a laissé 59 réceptions hors stock du 5 juin au 22 août.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReceptionCreatedMessage } = require('./_esm').loadEsm('src/modules/shared/lib/bdcReceptionUtils.js');

test('toutes les lignes valorisées → message simple, entrée en stock annoncée', () => {
  const msg = buildReceptionCreatedMessage('BR-2026-0084', { total: 3, valorisees: 3, non_valorisees: 0 });
  assert.equal(msg, 'Réception BR-2026-0084 créée. Entrée en stock immédiate.');
});

test('le message n\'annonce JAMAIS une validation Achats', () => {
  const cas = [
    { total: 3, valorisees: 3, non_valorisees: 0 },
    { total: 3, valorisees: 0, non_valorisees: 3 },
    null,
    undefined,
    {},
  ];
  for (const v of cas) {
    const msg = buildReceptionCreatedMessage('BR-1', v);
    assert.ok(!/Achats/i.test(msg), 'annonce une validation Achats : ' + msg);
    assert.ok(!/attente/i.test(msg), 'fait attendre l\'utilisateur : ' + msg);
  }
});

test('une ligne sans prix est SIGNALÉE, avec son compte', () => {
  const msg = buildReceptionCreatedMessage('BR-2026-0084', { total: 3, valorisees: 2, non_valorisees: 1 });
  assert.ok(msg.includes('1 ligne sur 3'), msg);
  assert.ok(msg.includes('NON valorisée'), msg);
  assert.ok(msg.includes('ne compteront pas dans les coûts'), msg);
});

test('plusieurs lignes sans prix → accord au pluriel', () => {
  const msg = buildReceptionCreatedMessage('BR-1', { total: 5, valorisees: 2, non_valorisees: 3 });
  assert.ok(msg.includes('3 lignes sur 5'), msg);
  assert.ok(msg.includes('entrées en stock NON valorisées'), msg);
});

test('réception libre sans BDC : TOUTES les lignes sans prix sont signalées', () => {
  // Cas réel des 2 réceptions de production issues de create-movement.
  const msg = buildReceptionCreatedMessage('BR-2026-0006', { total: 2, valorisees: 0, non_valorisees: 2 });
  assert.ok(msg.includes('2 lignes sur 2'), msg);
});

test('valorisation absente (mouvement non-réception, ancien serveur) → message simple, aucun crash', () => {
  assert.equal(buildReceptionCreatedMessage('BR-1', null), 'Réception BR-1 créée. Entrée en stock immédiate.');
  assert.equal(buildReceptionCreatedMessage('BR-1', undefined), 'Réception BR-1 créée. Entrée en stock immédiate.');
  assert.equal(buildReceptionCreatedMessage('BR-1', {}), 'Réception BR-1 créée. Entrée en stock immédiate.');
});

test('total absent → on signale quand même les lignes sans prix, sans inventer de total', () => {
  const msg = buildReceptionCreatedMessage('BR-1', { non_valorisees: 2 });
  assert.ok(msg.includes('2 lignes'), msg);
  assert.ok(!msg.includes('sur '), 'ne doit pas inventer un total : ' + msg);
});

test('numéro manquant → aucun crash', () => {
  assert.doesNotThrow(() => buildReceptionCreatedMessage(undefined, { total: 1, non_valorisees: 1 }));
});

test('le message nomme le bon de RÉCEPTION, pas le bon de livraison', () => {
  // create-bl crée DEUX documents et renvoie les deux numéros : `numero` est
  // celui du BL, `reception_numero` celui du BR. Annoncer « Réception BL-0042 »
  // enverrait le magasinier chercher un document qui n'existe pas sous ce nom.
  const msg = buildReceptionCreatedMessage('BR-2026-0084', { total: 1, valorisees: 1, non_valorisees: 0 });
  assert.ok(msg.includes('BR-2026-0084'), msg);
  assert.ok(!msg.includes('BL-'), msg);
});

// --------------------------------------------------------------------------
// Unité invérifiable : 86 % du flux porte ce drapeau. L'écrire en base sans
// jamais le dire à personne reviendrait à ne pas l'écrire.
// --------------------------------------------------------------------------

test('les lignes valorisées sans unité au BDC sont SIGNALÉES', () => {
  const msg = buildReceptionCreatedMessage('BR-1', { total: 3, valorisees: 3, non_valorisees: 0, non_verifiees: 3 });
  assert.ok(msg.includes('3 lignes sur 3'), msg);
  assert.ok(msg.includes('sans unité au bon de commande'), msg);
  assert.ok(msg.includes('le prix a été repris tel quel'), msg);
});

test('invérifiable et sans prix sont deux choses DISTINCTES, dites séparément', () => {
  // Les confondre ferait croire soit qu'un prix manque alors qu'il existe,
  // soit qu'un prix est fiable alors que rien ne l'a confirmé.
  const msg = buildReceptionCreatedMessage('BR-1', { total: 5, valorisees: 4, non_valorisees: 1, non_verifiees: 4 });
  assert.ok(msg.includes('1 ligne sur 5'), 'la ligne sans prix doit être annoncée : ' + msg);
  assert.ok(msg.includes('NON valorisée'), msg);
  assert.ok(msg.includes('4 lignes sur 5'), 'les lignes invérifiables aussi : ' + msg);
  assert.ok(msg.includes('sans unité au bon de commande'), msg);
});

test('accord au singulier pour une seule ligne invérifiable', () => {
  const msg = buildReceptionCreatedMessage('BR-1', { total: 2, valorisees: 2, non_valorisees: 0, non_verifiees: 1 });
  assert.ok(msg.includes('1 ligne sur 2'), msg);
  assert.ok(msg.includes('valorisée sans unité'), msg);
});

test('aucune ligne invérifiable → rien n\'est dit à ce sujet', () => {
  const msg = buildReceptionCreatedMessage('BR-1', { total: 2, valorisees: 2, non_valorisees: 0, non_verifiees: 0 });
  assert.equal(msg, 'Réception BR-1 créée. Entrée en stock immédiate.');
  assert.ok(!msg.includes('unité'), msg);
});

test('cas dominant en production : tout valorisé, tout invérifiable', () => {
  // 490 des 571 lignes valorisées sont dans ce cas. Le magasinier ne doit pas
  // lire « tout va bien » sans un mot sur ce qui n'a pas pu être contrôlé.
  const msg = buildReceptionCreatedMessage('BR-2026-0090', { total: 1, valorisees: 1, non_valorisees: 0, non_verifiees: 1 });
  assert.ok(msg.includes('Entrée en stock immédiate'), msg);
  assert.ok(msg.includes('sans qu\'on puisse vérifier'), msg);
});
