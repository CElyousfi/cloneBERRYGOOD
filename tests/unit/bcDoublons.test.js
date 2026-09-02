/*
 * bcDoublons.test.js — logique pure de la garde anti-doublon `create-bc`.
 *
 * Le test qui compte est `CAS RÉELS` : il rejoue les deux doublons mesurés en
 * production (BC-2026-0032/0033 et BC-2026-0039/0040), qui partagent leur
 * `scan_url` au caractère près. La garde doit les refuser ET nommer le bon
 * existant.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const bcDoublons = require('../../functions/lib/stock/bcDoublons');

/** Bon minimal réutilisable. */
function bon(over) {
  return Object.assign({
    id: 'x', numero: 'BC-2026-0001', date: '2026-08-25', scan_url: null,
    items: [{ article: 'DAP', quantite: 50, unite: 'kg', parcelle: 'F1-P1', ferme: 'F1' }],
  }, over || {});
}

// ── CAS RÉELS DE PRODUCTION ────────────────────────────────────────────────

test('CAS RÉEL BC-2026-0032/0033 — même scan_url : refusé, et le bon existant est nommé', () => {
  const scan = 'https://storage.googleapis.com/bucket/scans/bons_consommation/1756100000000_bon.jpg';
  const existant = bon({
    id: 'id32', numero: 'BC-2026-0032', date: '2026-08-25', scan_url: scan,
    items: [
      { article: 'DAP', quantite: 50, parcelle: 'F1-P1', ferme: 'F1' },
      { article: 'UREE', quantite: 25, parcelle: 'F1-P2', ferme: 'F1' },
    ],
  });
  // La seconde soumission : le MÊME scan, le même contenu, 23 secondes plus tard.
  const entrant = bon({
    id: undefined, numero: undefined, date: '2026-08-25', scan_url: scan,
    items: existant.items,
  });

  const v = bcDoublons.detecterDoublon(entrant, [existant]);
  assert.equal(v.doublon, true);
  assert.equal(v.motif, bcDoublons.MOTIF_SCAN);
  assert.equal(v.bon_numero, 'BC-2026-0032');
  assert.equal(v.bon_id, 'id32');
  assert.match(v.message, /BC-2026-0032/, 'le message doit NOMMER le bon existant');
  assert.match(v.message, /scan/i, 'le message doit dire lequel des deux cas s\'applique');
});

test('CAS RÉEL BC-2026-0039/0040 — même scan_url sur 10 lignes identiques', () => {
  const scan = 'https://storage.googleapis.com/bucket/scans/bons_consommation/1754600000000_bon39.jpg';
  const items = [];
  for (let i = 0; i < 10; i++) {
    items.push({ article: 'ART-' + i, quantite: i + 1, parcelle: 'F5-P' + i, ferme: 'F5' });
  }
  const existant = bon({ id: 'id39', numero: 'BC-2026-0039', date: '2026-08-08', scan_url: scan, items });
  const entrant = bon({ date: '2026-08-08', scan_url: scan, items });

  const v = bcDoublons.detecterDoublon(entrant, [existant]);
  assert.equal(v.doublon, true);
  assert.equal(v.motif, bcDoublons.MOTIF_SCAN);
  assert.match(v.message, /BC-2026-0039/);
});

// ── NIVEAU 1 : DOUBLON CERTAIN (scan_url) ──────────────────────────────────

test('scan_url différent : le scan seul ne déclenche pas', () => {
  const existant = bon({ numero: 'BC-2026-0010', scan_url: 'https://s/a.jpg', items: [{ article: 'DAP', quantite: 50, parcelle: 'P9', ferme: 'F1' }] });
  const entrant = bon({ scan_url: 'https://s/b.jpg', items: [{ article: 'UREE', quantite: 10, parcelle: 'P8', ferme: 'F1' }] });
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).doublon, false);
});

test('deux bons SANS scan ne sont pas doublons par le scan (signature vide ne matche jamais)', () => {
  const existant = bon({ numero: 'BC-2026-0011', scan_url: null, items: [{ article: 'DAP', quantite: 1, parcelle: 'P1', ferme: 'F1' }] });
  const entrant = bon({ scan_url: null, items: [{ article: 'UREE', quantite: 2, parcelle: 'P2', ferme: 'F1' }] });
  const v = bcDoublons.detecterDoublon(entrant, [existant]);
  assert.equal(v.doublon, false);
});

test('scan_url vide ou espaces : traité comme absent', () => {
  const existant = bon({ numero: 'BC-2026-0012', scan_url: '   ', items: [{ article: 'DAP', quantite: 1, parcelle: 'P1', ferme: 'F1' }] });
  const entrant = bon({ scan_url: '', items: [{ article: 'UREE', quantite: 2, parcelle: 'P2', ferme: 'F1' }] });
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).doublon, false);
});

test('le doublon CERTAIN prime sur le doublon probable', () => {
  const scan = 'https://s/meme.jpg';
  const parContenu = bon({ id: 'idC', numero: 'BC-2026-0020', scan_url: 'https://s/autre.jpg' });
  const parScan = bon({ id: 'idS', numero: 'BC-2026-0021', scan_url: scan, date: '2026-01-01', items: [{ article: 'X', quantite: 9, parcelle: 'Z', ferme: 'F5' }] });
  const entrant = bon({ scan_url: scan });
  const v = bcDoublons.detecterDoublon(entrant, [parContenu, parScan]);
  assert.equal(v.motif, bcDoublons.MOTIF_SCAN);
  assert.equal(v.bon_numero, 'BC-2026-0021');
});

// ── NIVEAU 2 : DOUBLON PROBABLE (contenu) ──────────────────────────────────

test('même contenu, scan différent : doublon PROBABLE, bon nommé', () => {
  const existant = bon({ id: 'idA', numero: 'BC-2026-0030', scan_url: 'https://s/a.jpg' });
  const entrant = bon({ scan_url: 'https://s/b.jpg' });
  const v = bcDoublons.detecterDoublon(entrant, [existant]);
  assert.equal(v.doublon, true);
  assert.equal(v.motif, bcDoublons.MOTIF_CONTENU);
  assert.equal(v.bon_numero, 'BC-2026-0030');
  assert.match(v.message, /BC-2026-0030/);
});

test('contenu : l\'ordre des lignes n\'a aucune influence', () => {
  const a = [{ article: 'DAP', quantite: 5, parcelle: 'P1', ferme: 'F1' }, { article: 'UREE', quantite: 7, parcelle: 'P2', ferme: 'F1' }];
  const b = [a[1], a[0]];
  assert.equal(bcDoublons.signatureContenu(bon({ items: a })), bcDoublons.signatureContenu(bon({ items: b })));
});

test('contenu : casse et espaces normalisés', () => {
  const a = [{ article: '  sulfate  de fer ', quantite: 5, parcelle: 'p1', ferme: 'f1' }];
  const b = [{ article: 'SULFATE DE FER', quantite: 5, parcelle: 'P1', ferme: 'F1' }];
  assert.equal(bcDoublons.signatureContenu(bon({ items: a })), bcDoublons.signatureContenu(bon({ items: b })));
});

test('contenu : une DATE différente sépare deux bons', () => {
  const existant = bon({ numero: 'BC-2026-0031', date: '2026-08-24', scan_url: 'https://s/a.jpg' });
  const entrant = bon({ date: '2026-08-25', scan_url: 'https://s/b.jpg' });
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).doublon, false);
});

test('contenu : une FERME différente sépare deux bons', () => {
  const existant = bon({ numero: 'BC-2026-0032', scan_url: 'https://s/a.jpg', items: [{ article: 'DAP', quantite: 50, parcelle: 'F1-P1', ferme: 'F1' }] });
  const entrant = bon({ scan_url: 'https://s/b.jpg', items: [{ article: 'DAP', quantite: 50, parcelle: 'F1-P1', ferme: 'F5' }] });
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).doublon, false);
});

test('contenu : une PARCELLE différente sépare deux bons', () => {
  const existant = bon({ numero: 'BC-2026-0033', scan_url: 'https://s/a.jpg', items: [{ article: 'DAP', quantite: 50, parcelle: 'F1-P1', ferme: 'F1' }] });
  const entrant = bon({ scan_url: 'https://s/b.jpg', items: [{ article: 'DAP', quantite: 50, parcelle: 'F1-P2', ferme: 'F1' }] });
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).doublon, false);
});

test('contenu : une QUANTITÉ différente sépare deux bons', () => {
  const existant = bon({ numero: 'BC-2026-0034', scan_url: 'https://s/a.jpg', items: [{ article: 'DAP', quantite: 50, parcelle: 'P1', ferme: 'F1' }] });
  const entrant = bon({ scan_url: 'https://s/b.jpg', items: [{ article: 'DAP', quantite: 51, parcelle: 'P1', ferme: 'F1' }] });
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).doublon, false);
});

test('contenu : les lignes à quantité nulle sont ignorées (aucun mouvement de stock)', () => {
  const existant = bon({ numero: 'BC-2026-0035', scan_url: 'https://s/a.jpg', items: [{ article: 'DAP', quantite: 50, parcelle: 'P1', ferme: 'F1' }] });
  const entrant = bon({
    scan_url: 'https://s/b.jpg',
    items: [{ article: 'DAP', quantite: 50, parcelle: 'P1', ferme: 'F1' }, { article: 'UREE', quantite: 0, parcelle: 'P2', ferme: 'F1' }],
  });
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).motif, bcDoublons.MOTIF_CONTENU);
});

test('contenu vide des deux côtés : aucun doublon (signature vide ne matche jamais)', () => {
  const existant = bon({ numero: 'BC-2026-0036', scan_url: null, items: [] });
  const entrant = bon({ scan_url: null, items: [] });
  assert.equal(bcDoublons.signatureContenu(entrant), '');
  assert.equal(bcDoublons.detecterDoublon(entrant, [existant]).doublon, false);
});

// ── BONS SUPPRIMÉS / ENTRÉES DÉGRADÉES ─────────────────────────────────────

test('un bon SUPPRIMÉ ne bloque pas la ressaisie', () => {
  const scan = 'https://s/a.jpg';
  const supprime = bon({ numero: 'BC-2026-0040', scan_url: scan, deleted: true });
  assert.equal(bcDoublons.detecterDoublon(bon({ scan_url: scan }), [supprime]).doublon, false);
});

test('liste vide / absente : aucun doublon, aucune exception', () => {
  assert.equal(bcDoublons.detecterDoublon(bon({}), []).doublon, false);
  assert.equal(bcDoublons.detecterDoublon(bon({}), null).doublon, false);
  assert.equal(bcDoublons.detecterDoublon(bon({}), [null, undefined]).doublon, false);
});

// ── FORÇAGE ────────────────────────────────────────────────────────────────

test('forcageDemande : drapeau EXPLICITE seulement', () => {
  assert.equal(bcDoublons.forcageDemande(true), true);
  assert.equal(bcDoublons.forcageDemande('true'), true);
  assert.equal(bcDoublons.forcageDemande(false), false);
  assert.equal(bcDoublons.forcageDemande(undefined), false);
  assert.equal(bcDoublons.forcageDemande(1), false);
  assert.equal(bcDoublons.forcageDemande('oui'), false);
  assert.equal(bcDoublons.forcageDemande({}), false);
});

test('construireTraceForcage : qui, quand, quel doublon, quel motif', () => {
  const verdict = { doublon: true, motif: bcDoublons.MOTIF_SCAN, bon_id: 'id32', bon_numero: 'BC-2026-0032' };
  const t = bcDoublons.construireTraceForcage({
    verdict, by: { uid: 'u1', profileId: 'magasinier', name: 'Ali' }, at: 1756000000000,
  });
  assert.deepEqual(t, {
    forced: true,
    by: { uid: 'u1', profileId: 'magasinier', name: 'Ali' },
    at: 1756000000000,
    motif: bcDoublons.MOTIF_SCAN,
    bon_doublon_id: 'id32',
    bon_doublon_numero: 'BC-2026-0032',
  });
});

test('construireTraceForcage : identité manquante → champs vides, jamais undefined', () => {
  const t = bcDoublons.construireTraceForcage({ verdict: { motif: null, bon_id: '', bon_numero: '' }, by: null, at: 1 });
  assert.deepEqual(t.by, { uid: '', profileId: '', name: '' });
  assert.equal(t.motif, '');
});
