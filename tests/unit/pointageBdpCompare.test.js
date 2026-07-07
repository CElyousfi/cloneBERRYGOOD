'use strict';

// Tests du comparateur PUR de validation croisée pointage BDP vs mirror figé
// (functions/lib/pointageBdp/comparePointage.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { rowKey, comparePointage } = require('../../functions/lib/pointageBdp/comparePointage.js');

function row(mat, date, op, ref, jr, cout) {
  return {
    Personnel_Matricule: mat,
    DateStr: date,
    Operation: op,
    Ref_parcelle: ref,
    Nombre_Jr: jr,
    Cout: cout,
    cout_beeone_ref: cout,
  };
}

test('rowKey: clé = matricule||date||operation||ref', () => {
  assert.equal(rowKey(row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)), 'M1||2026-06-15||Cueillette||0032');
});

test('comparePointage: lignes strictement identiques', () => {
  const a = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)];
  const b = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)];
  const r = comparePointage(a, b);
  assert.equal(r.resume.identiques, 1);
  assert.equal(r.resume.diff_jr, 0);
  assert.equal(r.resume.diff_cout, 0);
  assert.equal(r.resume.manquantes_temoin, 0);
  assert.equal(r.resume.manquantes_mirror, 0);
});

test('comparePointage: écart Nombre_Jr détecté (égalité stricte)', () => {
  const a = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)];
  const b = [row('M1', '2026-06-15', 'Cueillette', '0032', 0.5, 80)];
  const r = comparePointage(a, b);
  assert.equal(r.resume.diff_jr, 1);
  assert.equal(r.resume.identiques, 0);
  assert.equal(r.details.diff_jr[0].ecart, 0.5);
});

test('comparePointage: coût dans la tolérance ±1 MAD → identique', () => {
  const a = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80.4)];
  const b = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 81.0)];
  const r = comparePointage(a, b);
  assert.equal(r.resume.diff_cout, 0);
  assert.equal(r.resume.identiques, 1);
});

test('comparePointage: coût hors tolérance → diff_cout', () => {
  const a = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)];
  const b = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 85)];
  const r = comparePointage(a, b);
  assert.equal(r.resume.diff_cout, 1);
  assert.equal(r.resume.identiques, 0);
  assert.equal(r.details.diff_cout[0].ecart, -5);
});

test('comparePointage: ligne présente témoin, absente mirror', () => {
  const a = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)];
  const b = [];
  const r = comparePointage(a, b);
  assert.equal(r.resume.manquantes_mirror, 1);
  assert.equal(r.resume.manquantes_temoin, 0);
});

test('comparePointage: ligne présente mirror, absente témoin', () => {
  const a = [];
  const b = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)];
  const r = comparePointage(a, b);
  assert.equal(r.resume.manquantes_temoin, 1);
  assert.equal(r.resume.manquantes_mirror, 0);
});

test('comparePointage: doublons même clé agrégés (grain non atomique)', () => {
  // Deux lignes témoin même clé (cartésien potentiel) vs une ligne mirror.
  const a = [
    row('M1', '2026-06-15', 'Cueillette', '0032', 0.5, 40),
    row('M1', '2026-06-15', 'Cueillette', '0032', 0.5, 40),
  ];
  const b = [row('M1', '2026-06-15', 'Cueillette', '0032', 1, 80)];
  const r = comparePointage(a, b);
  // Agrégat témoin = 1 jr / 80 MAD → identique au mirror.
  assert.equal(r.resume.identiques, 1);
  assert.equal(r.resume.doublons_temoin, 1);
  assert.equal(r.resume.diff_jr, 0);
});

test('comparePointage: compte lignes/clés des deux côtés', () => {
  const a = [row('M1', 'd', 'o', 'r', 1, 10), row('M2', 'd', 'o', 'r', 1, 10)];
  const b = [row('M1', 'd', 'o', 'r', 1, 10)];
  const r = comparePointage(a, b);
  assert.equal(r.lignes_temoin, 2);
  assert.equal(r.lignes_mirror, 1);
  assert.equal(r.cles_temoin, 2);
  assert.equal(r.cles_mirror, 1);
  assert.equal(r.communes, 1);
});
