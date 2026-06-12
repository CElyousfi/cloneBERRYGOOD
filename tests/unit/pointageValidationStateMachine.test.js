'use strict';

const test = require('node:test');
const assert = require('node:assert');

const sm = require('../../functions/lib/pointageValidation/stateMachine');

test('isFermeLocked: true si locked ou submitState=valide', () => {
  assert.equal(sm.isFermeLocked(null), false);
  assert.equal(sm.isFermeLocked({ submitState: 'brouillon' }), false);
  assert.equal(sm.isFermeLocked({ submitState: 'soumis' }), false);
  assert.equal(sm.isFermeLocked({ locked: true }), true);
  assert.equal(sm.isFermeLocked({ submitState: 'valide' }), true);
});

test('canValidateEquipe: seulement en brouillon non figé', () => {
  assert.equal(sm.canValidateEquipe(null), true);
  assert.equal(sm.canValidateEquipe({ submitState: 'brouillon' }), true);
  assert.equal(sm.canValidateEquipe({ submitState: 'soumis' }), false);
  assert.equal(sm.canValidateEquipe({ submitState: 'valide' }), false);
  assert.equal(sm.canValidateEquipe({ submitState: 'brouillon', locked: true }), false);
});

test('canSubmitFerme: refuse si aucune équipe ce jour', () => {
  const r = sm.canSubmitFerme({ submitState: 'brouillon' }, []);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'aucune_equipe');
});

test('canSubmitFerme: refuse si une équipe du jour non adressée', () => {
  const state = {
    submitState: 'brouillon',
    equipes: { NA: { status: 'valide' } },
    divers: { status: 'na' },
  };
  const r = sm.canSubmitFerme(state, ['NA', 'RE']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'equipes_non_adressees');
  assert.deepEqual(r.manquantes, ['RE']);
});

test('canSubmitFerme: refuse si divers non adressé', () => {
  const state = {
    submitState: 'brouillon',
    equipes: { NA: { status: 'valide' } },
    divers: { status: 'inconnu' },
  };
  const r = sm.canSubmitFerme(state, ['NA']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'divers_non_adresse');
});

test('canSubmitFerme: OK si toutes équipes + divers adressés', () => {
  const state = {
    submitState: 'brouillon',
    equipes: { NA: { status: 'valide' }, RE: { status: 'rejete' } },
    divers: { status: 'na' },
  };
  const r = sm.canSubmitFerme(state, ['NA', 'RE']);
  assert.equal(r.ok, true);
});

test('canSubmitFerme: refuse si déjà soumis', () => {
  const state = {
    submitState: 'soumis',
    equipes: { NA: { status: 'valide' } },
    divers: { status: 'na' },
  };
  const r = sm.canSubmitFerme(state, ['NA']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'deja_soumis');
});

test('canSubmitFerme: refuse si figée', () => {
  const state = { submitState: 'valide', locked: true, equipes: {}, divers: { status: 'na' } };
  const r = sm.canSubmitFerme(state, ['NA']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ferme_figee');
});

test('canChefValidate: bon chef + soumis = OK', () => {
  const state = { submitState: 'soumis' };
  assert.equal(sm.canChefValidate(state, 'F1', 'chef_f1').ok, true);
  assert.equal(sm.canChefValidate(state, 'BAHIA', 'chef_bahia').ok, true);
  assert.equal(sm.canChefValidate(state, 'Avocatier', 'chef_avo').ok, true);
});

test('canChefValidate: mauvaise ferme = refus', () => {
  const r = sm.canChefValidate({ submitState: 'soumis' }, 'F5', 'chef_f1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mauvaise_ferme');
});

test('canChefValidate: pas un chef = refus', () => {
  const r = sm.canChefValidate({ submitState: 'soumis' }, 'F1', 'rh');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pas_un_chef');
});

test('canChefValidate: pas soumis = refus', () => {
  const r = sm.canChefValidate({ submitState: 'brouillon' }, 'F1', 'chef_f1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pas_soumis');
});

test('canChefReject: bon chef + soumis = OK (les 4 fermes)', () => {
  const state = { submitState: 'soumis' };
  assert.equal(sm.canChefReject(state, 'F1', 'chef_f1').ok, true);
  assert.equal(sm.canChefReject(state, 'F5', 'chef_f5').ok, true);
  assert.equal(sm.canChefReject(state, 'Avocatier', 'chef_avo').ok, true);
  assert.equal(sm.canChefReject(state, 'BAHIA', 'chef_bahia').ok, true);
});

test('canChefReject: mauvaise ferme = refus (chef scopé à sa ferme)', () => {
  const r = sm.canChefReject({ submitState: 'soumis' }, 'F5', 'chef_f1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mauvaise_ferme');
});

test('canChefReject: pas un chef = refus', () => {
  const r = sm.canChefReject({ submitState: 'soumis' }, 'F1', 'rh');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pas_un_chef');
});

test('canChefReject: pas soumis = refus (brouillon ou valide)', () => {
  assert.equal(sm.canChefReject({ submitState: 'brouillon' }, 'F1', 'chef_f1').reason, 'pas_soumis');
  assert.equal(sm.canChefReject({ submitState: 'valide' }, 'F1', 'chef_f1').reason, 'pas_soumis');
});

test('nextSubmitState chef-reject: soumis → brouillon, sinon null', () => {
  assert.equal(sm.nextSubmitState('soumis', 'chef-reject'), 'brouillon');
  assert.equal(sm.nextSubmitState('brouillon', 'chef-reject'), null);
  assert.equal(sm.nextSubmitState('valide', 'chef-reject'), null);
});

test('chef-reject rouvre l\'édition RH: brouillon obtenu après rejet permet canValidateEquipe', () => {
  // Après chef-reject, submitState repasse à 'brouillon' et locked=false.
  const afterReject = { submitState: sm.nextSubmitState('soumis', 'chef-reject'), locked: false };
  assert.equal(afterReject.submitState, 'brouillon');
  assert.equal(sm.canValidateEquipe(afterReject), true);
});

test('canUnlock: seulement si verrouillée', () => {
  assert.equal(sm.canUnlock({ locked: true }).ok, true);
  assert.equal(sm.canUnlock({ locked: false }).ok, false);
  assert.equal(sm.canUnlock({ submitState: 'soumis' }).ok, false);
});

test('nextSubmitState: transitions valides et invalides', () => {
  assert.equal(sm.nextSubmitState('brouillon', 'submit'), 'soumis');
  assert.equal(sm.nextSubmitState('soumis', 'chef'), 'valide');
  assert.equal(sm.nextSubmitState('valide', 'unlock'), 'brouillon');
  assert.equal(sm.nextSubmitState('brouillon', 'chef'), null);
  assert.equal(sm.nextSubmitState('soumis', 'submit'), null);
  assert.equal(sm.nextSubmitState('brouillon', 'unlock'), null);
});

test('fermeForChefProfile: mapping', () => {
  assert.equal(sm.fermeForChefProfile('chef_f1'), 'F1');
  assert.equal(sm.fermeForChefProfile('chef_f5'), 'F5');
  assert.equal(sm.fermeForChefProfile('chef_avo'), 'Avocatier');
  assert.equal(sm.fermeForChefProfile('chef_bahia'), 'BAHIA');
  assert.equal(sm.fermeForChefProfile('rh'), null);
});
