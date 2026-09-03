'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeReference,
  buildIdempotencyKey,
  buildDocId,
  planEncaissementWrites,
} = require('../../functions/lib/marcheLocalCaisse/applyEncaissements.js');

// ---------------------------------------------------------------------------
// normalizeReference
// ---------------------------------------------------------------------------
test('normalizeReference : trim + minuscules + collapse espaces', () => {
  assert.equal(normalizeReference('  CHQ-1 '), 'chq-1');
  assert.equal(normalizeReference('CHQ   1'), 'chq 1');
  assert.equal(normalizeReference('  Chq    1  '), 'chq 1');
  assert.equal(normalizeReference(''), '');
  assert.equal(normalizeReference(null), '');
  assert.equal(normalizeReference(undefined), '');
});

test('CHQ-1 et "chq 1" : variations de casse/espaces', () => {
  // "CHQ 1" et "chq   1" normalisent vers la même clé.
  assert.equal(normalizeReference('CHQ 1'), normalizeReference('chq   1'));
});

// ---------------------------------------------------------------------------
// buildIdempotencyKey / buildDocId
// ---------------------------------------------------------------------------
test('buildIdempotencyKey / buildDocId : format stable', () => {
  assert.equal(buildIdempotencyKey('hamdouch_omar', 'chq-1'), 'hamdouch_omar__chq-1');
  assert.equal(buildDocId('hamdouch_omar', 'chq-1'), 'encaissement__hamdouch_omar__chq-1');
});

// ---------------------------------------------------------------------------
// planEncaissementWrites
// ---------------------------------------------------------------------------
const ACTIVE = new Set(['hamdouch_omar', 'iraqi_mohamed', 'mustapha_chafik_a']);

test('cas nominal : 1 ligne valide -> 1 toCreate', () => {
  const lignes = [{ client_id: 'hamdouch_omar', montant: 1500, date: '2026-06-01', mode: 'chèque', reference: 'CHQ-1', motif: 'Acompte' }];
  const res = planEncaissementWrites(lignes, new Set(), { activeClientIds: ACTIVE });
  assert.equal(res.toCreate.length, 1);
  assert.equal(res.duplicates, 0);
  assert.equal(res.errors.length, 0);
  const w = res.toCreate[0];
  assert.equal(w.doc_id, 'encaissement__hamdouch_omar__chq-1');
  assert.equal(w.idempotency_key, 'hamdouch_omar__chq-1');
  assert.equal(w.reference, 'CHQ-1'); // brute conservée
  assert.equal(w.reference_norm, 'chq-1');
  assert.equal(w.montant, 1500);
});

test('idempotence : doublon déjà en base (existingKeys) -> duplicates', () => {
  const lignes = [{ client_id: 'hamdouch_omar', montant: 1500, reference: 'CHQ-1' }];
  const existing = new Set(['hamdouch_omar__chq-1']);
  const res = planEncaissementWrites(lignes, existing, { activeClientIds: ACTIVE });
  assert.equal(res.toCreate.length, 0);
  assert.equal(res.duplicates, 1);
  assert.equal(res.errors.length, 0);
});

test('idempotence : normalisation casse/espaces -> CHQ-1 == "chq 1" forme commune', () => {
  // Deux lignes même client, références qui normalisent identiquement -> 1 create + 1 doublon intra-lot.
  const lignes = [
    { client_id: 'iraqi_mohamed', montant: 100, reference: 'CHQ 1' },
    { client_id: 'iraqi_mohamed', montant: 100, reference: 'chq   1' },
  ];
  const res = planEncaissementWrites(lignes, new Set(), { activeClientIds: ACTIVE });
  assert.equal(res.toCreate.length, 1);
  assert.equal(res.duplicates, 1);
  assert.equal(res.errors.length, 0);
});

test('référence vide -> erreur reference_manquante (pas de fallback)', () => {
  const lignes = [
    { client_id: 'hamdouch_omar', montant: 100, reference: '' },
    { client_id: 'hamdouch_omar', montant: 100, reference: '   ' },
    { client_id: 'hamdouch_omar', montant: 100 },
  ];
  const res = planEncaissementWrites(lignes, new Set(), { activeClientIds: ACTIVE });
  assert.equal(res.toCreate.length, 0);
  assert.equal(res.errors.length, 3);
  assert.ok(res.errors.every(e => e.raison === 'reference_manquante'));
});

test('montant <= 0 ou invalide -> erreur montant_invalide', () => {
  const lignes = [
    { client_id: 'hamdouch_omar', montant: 0, reference: 'A' },
    { client_id: 'hamdouch_omar', montant: -5, reference: 'B' },
    { client_id: 'hamdouch_omar', montant: 'abc', reference: 'C' },
  ];
  const res = planEncaissementWrites(lignes, new Set(), { activeClientIds: ACTIVE });
  assert.equal(res.toCreate.length, 0);
  assert.equal(res.errors.length, 3);
  assert.ok(res.errors.every(e => e.raison === 'montant_invalide'));
});

test('client inconnu (absent du set actif) -> erreur client_inconnu', () => {
  const lignes = [{ client_id: 'inconnu_xyz', montant: 100, reference: 'CHQ-9' }];
  const res = planEncaissementWrites(lignes, new Set(), { activeClientIds: ACTIVE });
  assert.equal(res.toCreate.length, 0);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].raison, 'client_inconnu');
});

test('client_id manquant -> erreur client_manquant', () => {
  const lignes = [{ montant: 100, reference: 'CHQ-9' }];
  const res = planEncaissementWrites(lignes, new Set(), { activeClientIds: ACTIVE });
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].raison, 'client_manquant');
});

test('sans activeClientIds : pas de contrôle client (client accepté)', () => {
  const lignes = [{ client_id: 'nimporte', montant: 100, reference: 'CHQ-9' }];
  const res = planEncaissementWrites(lignes, new Set());
  assert.equal(res.toCreate.length, 1);
  assert.equal(res.errors.length, 0);
});

test('lot mixte : create + doublon + erreurs, indices 1-based corrects', () => {
  const lignes = [
    { client_id: 'hamdouch_omar', montant: 1500, reference: 'CHQ-1' },   // 1 -> create
    { client_id: 'iraqi_mohamed', montant: 800, reference: 'VIR-2' },    // 2 -> create
    { client_id: 'mustapha_chafik_a', montant: 200, reference: 'DEJA' }, // 3 -> doublon (en base)
    { client_id: 'hamdouch_omar', montant: -1, reference: 'BAD' },       // 4 -> erreur montant
  ];
  const existing = new Set(['mustapha_chafik_a__deja']);
  const res = planEncaissementWrites(lignes, existing, { activeClientIds: ACTIVE });
  assert.equal(res.toCreate.length, 2);
  assert.equal(res.duplicates, 1);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].ligne, 4);
  assert.equal(res.errors[0].raison, 'montant_invalide');
});

// ---------------------------------------------------------------------------
// NON-RÉGRESSION : la whitelist de create-transaction est INCHANGÉE
// et n'inclut PAS 'encaissement' / 'vente'.
// ---------------------------------------------------------------------------
test('non-régression : whitelist create-transaction inchangée', () => {
  const src = require('../helpers/backendSource').backendSource();
  // La ligne exacte de validation du type dans create-transaction.
  assert.ok(
    src.includes('["alimentation", "depense", "sortie", "paie", "transport"].includes(type)'),
    'La whitelist create-transaction doit rester ["alimentation","depense","sortie","paie","transport"]'
  );
  // 'encaissement' et 'vente' ne doivent PAS être ajoutés à cette whitelist.
  assert.ok(
    !/\[\s*"alimentation"[^\]]*"encaissement"[^\]]*\]\.includes\(type\)/.test(src),
    "'encaissement' ne doit pas figurer dans la whitelist create-transaction"
  );
  assert.ok(
    !/\[\s*"alimentation"[^\]]*"vente"[^\]]*\]\.includes\(type\)/.test(src),
    "'vente' ne doit pas figurer dans la whitelist create-transaction"
  );
});
