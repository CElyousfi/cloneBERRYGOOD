/*
 * coutQuinzaineSnapshot.test.js
 *
 * Ce module existe parce que RECALCULER le coût de la quinzaine a échoué trois
 * fois de suite. Sa valeur tient donc entièrement à ce qu'il REFUSE : un
 * sous-total filtré enregistré comme référence serait pire que pas de référence
 * du tout — il produirait un écart énorme, plausible, et sans cause visible.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const S = require(path.join(__dirname, '../coutQuinzaineSnapshot.js'));

/** Instantané de plein périmètre, valide. */
function snapOk(extra) {
  return S.normaliser(Object.assign({
    periode: 'Quinzaine 01',
    coutEmployeur: 202528,
    netAPayer: 187737,
    masseSalariale: 158260,
    jours: 1484,
    pleinPerimetre: true,
    postes: { moRecolte: 1000, primeTransport: 26445 },
  }, extra || {}));
}

test('normaliser — ne garde que les champs connus', () => {
  // Le client envoie ce qu'il veut ; le document stocké a une forme fixe. Un
  // champ inattendu qui survivrait finirait par être lu comme s'il faisait
  // autorité quelque part.
  const out = S.normaliser({
    periode: '  Quinzaine 02  ', coutEmployeur: '150', jours: 10,
    pleinPerimetre: true, postes: { moRecolte: 5, inventé: 999 },
    champPirate: 'x',
  });
  assert.strictEqual(out.periode, 'Quinzaine 02');
  assert.strictEqual(out.coutEmployeur, 150);
  assert.strictEqual(out.champPirate, undefined);
  assert.strictEqual(out.postes['inventé'], undefined);
  // Tous les postes connus existent, à zéro par défaut.
  S.POSTES.forEach((k) => { assert.strictEqual(typeof out.postes[k], 'number'); });
});

test('normaliser — un nombre non fini devient 0, jamais NaN ni null', () => {
  // `NaN` sérialisé en JSON devient `null`, et un `null` relu se lit « pas de
  // donnée » alors que c'est un bug de calcul. Un 0 sera rejeté par `valider`.
  const out = S.normaliser({ periode: 'Q1', coutEmployeur: NaN, netAPayer: Infinity,
    jours: 'abc', pleinPerimetre: true });
  assert.strictEqual(out.coutEmployeur, 0);
  assert.strictEqual(out.netAPayer, 0);
  assert.strictEqual(out.jours, 0);
});

test('valider — REFUSE un total calculé sous filtre', () => {
  // Le cœur du module. Un sous-total enregistré comme référence empoisonnerait
  // le rapprochement en silence : l'écart paraîtrait énorme et personne ne
  // saurait qu'il vient d'un filtre laissé actif la veille.
  const v = S.valider(snapOk({ pleinPerimetre: false }));
  assert.strictEqual(v.ok, false);
  assert.match(v.raison, /périmètre/);
});

test('valider — `pleinPerimetre` doit être explicitement true', () => {
  // Absent, « true », 1 : autant de façons de laisser passer un sous-total.
  [undefined, 'true', 1, null].forEach((v) => {
    assert.strictEqual(S.valider(snapOk({ pleinPerimetre: v })).ok, false);
  });
});

test('valider — REFUSE un coût nul (écran en cours de chargement)', () => {
  // Zéro n'est pas « quinzaine vide » : l'écran affiche son total APRÈS
  // chargement. Enregistrer ce zéro écraserait un instantané valide par un
  // artefact de chargement.
  const v = S.valider(snapOk({ coutEmployeur: 0 }));
  assert.strictEqual(v.ok, false);
  assert.match(v.raison, /nul/);
});

test('valider — REFUSE une quinzaine sans journée pointée', () => {
  assert.strictEqual(S.valider(snapOk({ jours: 0 })).ok, false);
});

test('valider — REFUSE une période vide', () => {
  assert.strictEqual(S.valider(snapOk({ periode: '  ' })).ok, false);
});

test('valider — rend la RAISON, jamais un simple booléen', () => {
  // Un enregistrement qui échoue en silence laisse l'écran Campagne afficher
  // « — » sans que personne ne sache qu'il faut ouvrir la Quinzaine, ni pourquoi.
  const v = S.valider(snapOk({ periode: '' }));
  assert.strictEqual(typeof v.raison, 'string');
  assert.ok(v.raison.length > 0);
});

test('valider — accepte un instantané de plein périmètre', () => {
  assert.deepStrictEqual(S.valider(snapOk()), { ok: true, raison: '' });
});

test('versDocument — horodatage et auteur sont INJECTÉS, jamais lus d\'une horloge', () => {
  // C'est ce qui rend la fonction testable et le document reproductible.
  const doc = S.versDocument(snapOk(), '2026-08-22T10:00:00.000Z',
    { uid: 'u1', profileId: 'dg', email: 'a@b.c' });
  assert.strictEqual(doc.enregistre_at, '2026-08-22T10:00:00.000Z');
  assert.strictEqual(doc.enregistre_par.profileId, 'dg');
  assert.strictEqual(doc.coutEmployeur, 202528);
  assert.strictEqual(doc.postes.primeTransport, 26445);
});

test('versDocument — auteur inconnu : des champs vides, jamais `undefined`', () => {
  // Firestore refuse `undefined` et fait échouer l'écriture ENTIÈRE.
  const doc = S.versDocument(snapOk(), '2026-08-22T10:00:00.000Z', null);
  assert.strictEqual(doc.enregistre_par.uid, null);
  assert.strictEqual(doc.enregistre_par.profileId, '');
  assert.strictEqual(doc.enregistre_par.email, '');
});

test('parPeriode — indexe par période et ignore les documents sans période', () => {
  const out = S.parPeriode([
    { periode: 'Q1', coutEmployeur: 10 },
    { periode: 'Q2', coutEmployeur: 20 },
    { coutEmployeur: 30 },
    null,
  ]);
  assert.deepStrictEqual(Object.keys(out).sort(), ['Q1', 'Q2']);
  assert.strictEqual(out.Q1.coutEmployeur, 10);
});
