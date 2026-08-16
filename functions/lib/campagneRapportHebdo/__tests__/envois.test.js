/**
 * buildEnvois / resumeEnvois — qui reçoit quoi, et ce qu'on appelle un succès.
 *
 * Deux invariants gardés ici :
 *   1. dédoublonnage par (culture, téléphone) : une personne dg+rh reçoit
 *      2 fichiers (un par culture), pas 4, et pas 1 ;
 *   2. le succès se mesure aux HUMAINS ATTEINTS : 0 destinataire résolu est un
 *      échec, jamais un succès à vide.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEnvois, resumeEnvois, AUDIENCE, nbParcellesFromFeuilles, buildBodyParams, formatDateLabel } = require('../index');

const OMAR = { uid: 'u-omar', displayName: 'Omar', phone: '+212600000001' };
const CHEF1 = { uid: 'u-c1', displayName: 'Chef F1', phone: '+212600000002' };
const CHEF5 = { uid: 'u-c5', displayName: 'Chef F5', phone: '+212600000003' };
const DT = { uid: 'u-dt', displayName: 'Directeur Technique', phone: '+212600000004' };

test('buildEnvois : la matrice complète produit 4 envois par culture', () => {
  const envois = buildEnvois({
    audience: AUDIENCE,
    recipientsByProfile: {
      chef_f1: [CHEF1],
      chef_f5: [CHEF5],
      dg: [OMAR],
      dt: [DT],
      rh: [{ uid: 'u-rh', displayName: 'RH', phone: '+212600000005' }],
    },
  });
  assert.equal(envois.length, 8);
  assert.equal(envois.filter((e) => e.culture === 'Framboise').length, 4);
  assert.equal(envois.filter((e) => e.culture === 'Myrtille').length, 4);
  // Le chef F1 n'apparaît QUE sur Framboise, le chef F5 QUE sur Myrtille.
  assert.deepEqual(envois.filter((e) => e.phone === CHEF1.phone).map((e) => e.culture), ['Framboise']);
  assert.deepEqual(envois.filter((e) => e.phone === CHEF5.phone).map((e) => e.culture), ['Myrtille']);
});

test('buildEnvois : une personne dg + rh reçoit 2 fichiers (1 par culture), pas 4', () => {
  const envois = buildEnvois({
    audience: AUDIENCE,
    recipientsByProfile: {
      chef_f1: [],
      chef_f5: [],
      dg: [OMAR],
      dt: [],
      rh: [{ uid: 'u-omar-rh', displayName: 'Omar (RH)', phone: OMAR.phone }],
    },
  });
  assert.equal(envois.length, 2, 'dédoublonnage par (culture, téléphone)');
  assert.deepEqual(envois.map((e) => e.culture).sort(), ['Framboise', 'Myrtille']);
  // Le profil retenu est celui qui l'a fait entrer en premier dans la matrice.
  envois.forEach((e) => assert.equal(e.profileId, 'dg'));
});

test('buildEnvois : deux personnes distinctes du même profil sont toutes servies', () => {
  const envois = buildEnvois({
    audience: { Framboise: ['dg'] },
    recipientsByProfile: { dg: [OMAR, DT] },
  });
  assert.equal(envois.length, 2);
});

test('buildEnvois : profil absent, liste vide ou téléphone vide → ignorés sans planter', () => {
  const envois = buildEnvois({
    audience: AUDIENCE,
    recipientsByProfile: { dg: [{ displayName: 'Sans numéro', phone: '' }, OMAR] },
  });
  assert.equal(envois.length, 2);
  assert.equal(buildEnvois({}).length, 0);
  assert.equal(buildEnvois().length, 0);
});

test('resumeEnvois : succès complet → aucune alerte', () => {
  const r = resumeEnvois([
    { culture: 'Framboise', status: 'ok', envois: [{ phone: '+1', profileId: 'dg', success: true }] },
    { culture: 'Myrtille', status: 'ok', envois: [{ phone: '+1', profileId: 'dg', success: true }] },
  ]);
  assert.equal(r.alerte, false);
  assert.equal(r.totalEnvoyes, 2);
  assert.equal(r.totalEchecs, 0);
  assert.match(r.texte, /Framboise 1\/1/);
  assert.match(r.texte, /Myrtille 1\/1/);
});

test('resumeEnvois : 0 destinataire résolu = ÉCHEC, pas un succès à vide', () => {
  const r = resumeEnvois([
    { culture: 'Framboise', status: 'ok', envois: [] },
    { culture: 'Myrtille', status: 'ok', envois: [{ phone: '+1', profileId: 'dg', success: true }] },
  ]);
  assert.equal(r.alerte, true, 'une culture servie à personne doit alerter');
  assert.deepEqual(r.culturesEnEchec, ['Framboise']);
  assert.match(r.texte, /AUCUN destinataire joignable/);
  assert.match(r.texte, /whatsappPhone/, 'l\'alerte dit quoi corriger');
  assert.match(r.texte, /Myrtille 1\/1/, 'ce qui a marché reste visible');
});

test('resumeEnvois : échec partiel → alerte NOMINATIVE (savoir qui n\'a pas été servi)', () => {
  const r = resumeEnvois([
    {
      culture: 'Framboise',
      status: 'ok',
      envois: [
        { phone: '+1', profileId: 'dg', displayName: 'Omar', success: true },
        { phone: '+2', profileId: 'dt', displayName: 'Youssef', success: false, error: 'Numéro invalide' },
      ],
    },
  ]);
  assert.equal(r.alerte, true);
  assert.equal(r.totalEnvoyes, 1);
  assert.equal(r.totalEchecs, 1);
  assert.match(r.texte, /Youssef \(dt\)/);
  assert.match(r.texte, /Numéro invalide/);
  assert.ok(!r.texte.includes('Omar'), 'on ne nomme que ceux en échec');
});

test('resumeEnvois : un profil entier sans destinataire = ÉCHEC, même si tout est parti', () => {
  const r = resumeEnvois([
    {
      culture: 'Framboise',
      status: 'ok',
      envois: [{ phone: '+1', profileId: 'dg', displayName: 'Omar', success: true }],
      profilsManquants: ['chef_f1', 'rh'],
    },
  ]);
  assert.equal(r.alerte, true, 'le chef F1 ne recevra rien : personne ne doit l\'ignorer');
  assert.equal(r.totalEchecs, 0, 'aucun message n\'a raté, c\'est bien un trou de destinataires');
  assert.match(r.texte, /chef_f1\/rh/);
});

test('resumeEnvois : classeur non produit → échec avec la cause, aucun envoi compté', () => {
  const r = resumeEnvois([
    { culture: 'Framboise', status: 'error', error: 'génération: campagne invalide', envois: [] },
  ]);
  assert.equal(r.alerte, true);
  assert.match(r.texte, /rapport non produit/);
  assert.match(r.texte, /campagne invalide/);
  assert.equal(r.totalEnvoyes, 0);
});

test('resumeEnvois : aucune culture traitée → échec (jamais un silence)', () => {
  const r = resumeEnvois([]);
  assert.equal(r.alerte, true);
  assert.match(r.texte, /aucune culture traitée/);
});

test('resumeEnvois : une lecture des destinataires en échec est nommée comme une PANNE', () => {
  const r = resumeEnvois(
    [{ culture: 'Framboise', status: 'ok', envois: [], profilsManquants: ['chef_f1', 'dg'] }],
    { erreursResolution: [{ profileId: 'dg', error: 'DEADLINE_EXCEEDED' }] }
  );
  assert.equal(r.alerte, true);
  assert.match(r.texte, /lecture des destinataires en ÉCHEC pour dg/);
  assert.match(r.texte, /DEADLINE_EXCEEDED/);
  assert.match(r.texte, /PAS une configuration users/,
    'un Firestore injoignable ne doit pas se lire comme « personne n\'a de numéro »');
});

test('resumeEnvois : la panne de lecture survit même quand aucune culture n\'a été traitée', () => {
  const r = resumeEnvois([], { erreursResolution: [{ profileId: 'dt', error: 'UNAVAILABLE' }] });
  assert.equal(r.alerte, true);
  assert.match(r.texte, /UNAVAILABLE/);
  assert.match(r.texte, /aucune culture traitée/);
});

test('resumeEnvois : le texte tient sur une ligne (general_alert rejette les \\n)', () => {
  const r = resumeEnvois([
    { culture: 'Framboise', status: 'error', error: 'boom', envois: [] },
    { culture: 'Myrtille', status: 'ok', envois: [{ phone: '+1', profileId: 'dg', success: false, error: 'x' }] },
  ]);
  assert.ok(!/[\n\t]/.test(r.texte), 'pas de retour ligne dans le texte d\'alerte');
});

test('nbParcelles = nbFeuilles - 1 (feuille Synthèse + 1 feuille par parcelle)', () => {
  assert.equal(nbParcellesFromFeuilles(24), 23);
  assert.equal(nbParcellesFromFeuilles(1), 0);
  assert.equal(nbParcellesFromFeuilles(0), 0);
  assert.equal(nbParcellesFromFeuilles(undefined), 0);
});

test('buildBodyParams : 3 paramètres texte dans l\'ordre du template', () => {
  assert.deepEqual(
    buildBodyParams({ culture: 'Framboise', dateLabel: '18/08/2026', nbParcelles: 23 }),
    ['Framboise', '18/08/2026', '23']
  );
  // Aucun paramètre vide (Meta rejette les chaînes vides, erreur 131008).
  buildBodyParams({}).forEach((p) => assert.equal(typeof p, 'string'));
});

test('formatDateLabel : jj/mm/aaaa dans le fuseau du cron', () => {
  assert.equal(formatDateLabel(new Date('2026-08-17T15:00:00Z'), 'Africa/Casablanca'), '17/08/2026');
});
