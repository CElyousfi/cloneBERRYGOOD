/*
 * bcSuppression.test.js — logique pure de la suppression d'un bon de
 * consommation (`delete-bc`).
 *
 * L'enjeu métier : `create-bc` décrémente `stock_balances` dès la création.
 * Supprimer le bon sans annuler ses mouvements laisserait la consommation
 * déduite pour toujours. `trierMouvements` est donc le cœur du test : elle
 * décide QUI doit être re-crédité, et une seule fois.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const bcSuppression = require('../../functions/lib/stock/bcSuppression');
const { REFUS_SUPPRESSION_BC, peutSupprimerBonConso } = require('../../functions/lib/stockRoles');

function bon(over) {
  return Object.assign({ numero: 'BC-2026-0033', date: '2026-08-25' }, over || {});
}

// ── VALIDATION : RÔLE ──────────────────────────────────────────────────────

test('rôle : achats, dg ET magasinier peuvent supprimer', () => {
  // Le magasinier a été AJOUTÉ le 2026-08-29 (inversion de la règle PR #353) :
  // c'est lui qui repère son doublon, passer par le DG n'ajoutait qu'un délai.
  // Ce qui compense : motif obligatoire, trace, soft-delete — et une double
  // confirmation d'INTERFACE, dont ce module ne sait volontairement rien.
  for (const role of ['achats', 'dg', 'magasinier']) {
    const v = bcSuppression.validerSuppression({ role, motif: 'doublon', bc: bon() });
    assert.equal(v.ok, true, role + ' doit pouvoir supprimer');
  }
});

test('rôle : aucun drapeau client ne conditionne l\'autorisation', () => {
  // Une « double confirmation » envoyée par le client serait usurpable : le
  // serveur ne doit ni l'exiger, ni la lire. Absente comme présente, le
  // verdict est identique — seul le rôle résolu serveur compte.
  const sans = bcSuppression.validerSuppression({ role: 'magasinier', motif: 'doublon', bc: bon() });
  const avec = bcSuppression.validerSuppression({ role: 'magasinier', motif: 'doublon', bc: bon(), double_confirmation: false });
  assert.equal(sans.ok, true);
  assert.deepEqual(avec, sans);
});

test('rôle : tout autre rôle, rôle absent ou non-chaîne est refusé en 403', () => {
  for (const role of ['chef_f1', 'finance', 'rh', '', null, undefined, 42, { profileId: 'dg' }]) {
    const v = bcSuppression.validerSuppression({ role, motif: 'doublon', bc: bon() });
    assert.equal(v.ok, false, JSON.stringify(role) + ' doit être refusé');
    assert.equal(v.code, 403);
    assert.equal(v.error, REFUS_SUPPRESSION_BC);
  }
});

test('rôle : le message de refus NOMME les trois profils autorisés', () => {
  // Un message qui ne cite qu'« achats ou DG » ferait croire au magasinier
  // qu'il n'a pas le droit — c'est le mensonge déjà corrigé pour le catalogue.
  assert.match(REFUS_SUPPRESSION_BC, /magasinier/i);
  assert.match(REFUS_SUPPRESSION_BC, /achats/i);
  assert.match(REFUS_SUPPRESSION_BC, /DG/);
});

test('rôle : la suppression d\'un bon ne donne PAS accès au catalogue', () => {
  // Le droit est un export DÉDIÉ, pas un alias : le magasinier supprime un bon
  // sans pour autant pouvoir écrire une fiche article.
  const { peutModifierArticle } = require('../../functions/lib/stockRoles');
  assert.equal(peutSupprimerBonConso('magasinier').ok, true);
  assert.equal(peutModifierArticle('magasinier').ok, false);
});

test('rôle : refusé AVANT tout, même sur un bon inexistant (aucune fuite d\'information)', () => {
  const v = bcSuppression.validerSuppression({ role: 'chef_f1', motif: '', bc: null, exists: false });
  assert.equal(v.code, 403);
});

// ── VALIDATION : MOTIF ─────────────────────────────────────────────────────

test('motif : obligatoire (absent, vide, espaces, trop court, non-chaîne)', () => {
  for (const motif of [undefined, null, '', '   ', 'ok', 42, {}]) {
    const v = bcSuppression.validerSuppression({ role: 'dg', motif, bc: bon() });
    assert.equal(v.ok, false, JSON.stringify(motif) + ' doit être refusé');
    assert.equal(v.code, 400);
    assert.equal(v.error, 'Motif de suppression obligatoire');
  }
});

test('motif : trimé et rendu à l\'appelant', () => {
  const v = bcSuppression.validerSuppression({ role: 'dg', motif: '  doublon de BC-2026-0032  ', bc: bon() });
  assert.equal(v.ok, true);
  assert.equal(v.motif, 'doublon de BC-2026-0032');
});

// ── VALIDATION : ÉTAT DU BON ───────────────────────────────────────────────

test('bon inexistant : 404', () => {
  const v = bcSuppression.validerSuppression({ role: 'dg', motif: 'doublon', bc: null, exists: false });
  assert.equal(v.code, 404);
});

test('bon déjà supprimé : 400 (re-supprimer re-créditerait le stock une 2e fois)', () => {
  const v = bcSuppression.validerSuppression({ role: 'dg', motif: 'doublon', bc: bon({ deleted: true }) });
  assert.equal(v.ok, false);
  assert.equal(v.code, 400);
  assert.equal(v.error, 'Bon déjà supprimé');
});

// ── TRI DES MOUVEMENTS ─────────────────────────────────────────────────────

test('les mouvements créés par create-bc (consommation/valide_mag) sont ANNULÉS', () => {
  const movs = [
    { id: 'm1', type: 'consommation', status: 'valide_mag' },
    { id: 'm2', type: 'consommation', status: 'valide_mag' },
  ];
  const t = bcSuppression.trierMouvements(movs);
  assert.deepEqual(t.aAnnuler.map((m) => m.id), ['m1', 'm2']);
  assert.deepEqual(t.aMarquer.map((m) => m.id), ['m1', 'm2']);
});

test('un mouvement sans impact matérialisé est marqué mais PAS annulé', () => {
  const t = bcSuppression.trierMouvements([{ id: 'm1', type: 'consommation', status: 'rejete' }]);
  assert.deepEqual(t.aAnnuler, []);
  assert.deepEqual(t.aMarquer.map((m) => m.id), ['m1']);
});

test('un mouvement DÉJÀ supprimé est ignoré (pas de double crédit)', () => {
  const t = bcSuppression.trierMouvements([
    { id: 'm1', type: 'consommation', status: 'valide_mag', deleted: true },
    { id: 'm2', type: 'consommation', status: 'valide_mag' },
  ]);
  assert.deepEqual(t.aAnnuler.map((m) => m.id), ['m2']);
  assert.deepEqual(t.aMarquer.map((m) => m.id), ['m2']);
  assert.deepEqual(t.ignores.map((m) => m.id), ['m1']);
});

test('liste vide / absente / entrées nulles : aucun mouvement, aucune exception', () => {
  for (const l of [[], null, undefined, [null, undefined]]) {
    const t = bcSuppression.trierMouvements(l);
    assert.deepEqual(t.aAnnuler, []);
    assert.deepEqual(t.aMarquer, []);
  }
});

// ── PATCHS ─────────────────────────────────────────────────────────────────

test('buildSuppressionUpdate : soft-delete tracé (auteur, date, motif) sur le bon', () => {
  const by = { uid: 'u1', profileId: 'dg', name: 'Omar' };
  const p = bcSuppression.buildSuppressionUpdate({ bc: bon(), motif: 'doublon de BC-2026-0032', by, at: 1756000000000 });
  assert.equal(p.bcUpdate.deleted, true);
  assert.deepEqual(p.bcUpdate.deleted_by, by);
  assert.equal(p.bcUpdate.deleted_at, 1756000000000);
  assert.equal(p.bcUpdate.deleted_reason, 'doublon de BC-2026-0032');
  assert.deepEqual(p.bcUpdate.history, [{
    action: 'suppression', by, at: 1756000000000, motif: 'doublon de BC-2026-0032',
  }]);
});

test('buildSuppressionUpdate : l\'historique existant est conservé', () => {
  const p = bcSuppression.buildSuppressionUpdate({
    bc: bon({ history: [{ action: 'modification_date' }] }),
    motif: 'doublon', by: { uid: 'u1' }, at: 1,
  });
  assert.equal(p.bcUpdate.history.length, 2);
  assert.equal(p.bcUpdate.history[0].action, 'modification_date');
});

test('buildSuppressionUpdate : les mouvements portent le même soft-delete', () => {
  const p = bcSuppression.buildSuppressionUpdate({ bc: bon(), motif: 'doublon', by: { uid: 'u1', profileId: 'dg' }, at: 7 });
  assert.equal(p.movementUpdate.deleted, true);
  assert.deepEqual(p.movementUpdate.deleted_by, { userId: 'u1', profileId: 'dg' });
  assert.equal(p.movementUpdate.deleted_reason, 'doublon');
});

test('buildSuppressionUpdate : le bon n\'est PAS détruit, aucun champ métier touché', () => {
  const p = bcSuppression.buildSuppressionUpdate({ bc: bon(), motif: 'doublon', by: {}, at: 1 });
  for (const champ of ['items', 'numero', 'date', 'type', 'parcelle', 'ferme']) {
    assert.equal(Object.prototype.hasOwnProperty.call(p.bcUpdate, champ), false, champ + ' ne doit pas être écrit');
  }
});

test('buildSuppressionUpdate : identité manquante → champs vides, jamais undefined', () => {
  const p = bcSuppression.buildSuppressionUpdate({ bc: bon(), motif: 'doublon', by: null, at: 1 });
  assert.deepEqual(p.bcUpdate.deleted_by, { uid: '', profileId: '', name: '' });
});
