'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildReferentielDoc,
  decideUnresolvedAlert,
  buildUnresolvedMessage,
  resolveCampagneId,
  ALERT_DEBOUNCE_MS,
} = require('../../functions/lib/pointage/referentielSync');

const ST = () => '__SERVER_TS__';

// ── buildReferentielDoc ──────────────────────────────────────────────────
test('buildReferentielDoc — auto, résolu F5', () => {
  const row = { ref_parcelle: '0041', label: 'F5 YAZMIN MT', variete: 'YAZMIN', idFermes: 1, first_seen: '2026-07-01' };
  const b = buildReferentielDoc(row, '2026-2027', null, ST);
  assert.strictEqual(b.docId, '2026-2027__0041');
  assert.strictEqual(b.data.ferme, 'F5');
  assert.strictEqual(b.data.source, 'auto');
  assert.strictEqual(b.data.confidence, 'high');
  assert.strictEqual(b.unresolved, false);
  assert.deepStrictEqual(b.data.labels, ['F5 YAZMIN MT']);
  assert.strictEqual(b.data.first_seen, '2026-07-01');
});

test('buildReferentielDoc — INCONNU (unresolved)', () => {
  const row = { ref_parcelle: '0044', label: 'PARCELLE NEUVE', variete: '', idFermes: 1 };
  const b = buildReferentielDoc(row, '2026-2027', null, ST);
  assert.strictEqual(b.data.ferme, 'INCONNU');
  assert.strictEqual(b.data.confidence, 'unresolved');
  assert.strictEqual(b.unresolved, true);
});

test('buildReferentielDoc — BAHIA via idFermes=2', () => {
  const row = { ref_parcelle: '0099', label: 'quelque chose', variete: '', idFermes: 2 };
  const b = buildReferentielDoc(row, '2026-2027', null, ST);
  assert.strictEqual(b.data.ferme, 'BAHIA');
});

test('buildReferentielDoc — source manual JAMAIS écrasé par auto', () => {
  const existing = { source: 'manual', ferme: 'Avocatier', first_seen: '2026-06-01', labels: ['ancien'] };
  const row = { ref_parcelle: 'F5', label: 'F5 CORINA', variete: '', idFermes: 1 };
  const b = buildReferentielDoc(row, '2026-2027', existing, ST);
  // La règle auto dirait F5, mais le manual (Avocatier) est préservé.
  assert.strictEqual(b.ferme, 'Avocatier');
  assert.strictEqual(b.data.source, 'manual');
  assert.strictEqual(b.data.ferme, undefined, 'ne réécrit pas ferme sur un manual');
  assert.strictEqual(b.unresolved, false);
  // labels enrichis quand même
  assert.ok(b.data.labels.includes('F5 CORINA'));
  // first_seen préservé
  assert.strictEqual(b.data.first_seen, '2026-06-01');
});

test('buildReferentielDoc — labels union sans doublon, first_seen préservé', () => {
  const existing = { source: 'auto', ferme: 'F5', first_seen: '2026-07-01', labels: ['F5 YAZMIN MT'] };
  const row = { ref_parcelle: '0041', label: 'F5 YAZMIN MT', variete: 'YAZMIN', idFermes: 1, first_seen: '2026-07-05' };
  const b = buildReferentielDoc(row, '2026-2027', existing, ST);
  assert.deepStrictEqual(b.data.labels, ['F5 YAZMIN MT'], 'pas de doublon');
  assert.strictEqual(b.data.first_seen, '2026-07-01', 'first_seen figé au 1er vu');
});

// ── decideUnresolvedAlert (debounce 24h) ─────────────────────────────────
test('decideUnresolvedAlert — aucune parcelle INCONNU → pas d\'alerte', () => {
  const d = decideUnresolvedAlert(null, [], new Date());
  assert.strictEqual(d.shouldAlert, false);
});

test('decideUnresolvedAlert — INCONNU + jamais alerté → alerte', () => {
  const d = decideUnresolvedAlert(null, ['0044'], new Date());
  assert.strictEqual(d.shouldAlert, true);
});

test('decideUnresolvedAlert — debounce dans les 24h → pas d\'alerte', () => {
  const now = new Date('2026-07-09T12:00:00Z');
  const prev = { lastUnresolvedAlertAtMs: now.getTime() - (2 * 60 * 60 * 1000) }; // il y a 2h
  const d = decideUnresolvedAlert(prev, ['0044'], now);
  assert.strictEqual(d.shouldAlert, false);
  assert.strictEqual(d.reason, 'debounced');
});

test('decideUnresolvedAlert — ré-alerte après 24h', () => {
  const now = new Date('2026-07-09T12:00:00Z');
  const prev = { lastUnresolvedAlertAtMs: now.getTime() - (ALERT_DEBOUNCE_MS + 1000) };
  const d = decideUnresolvedAlert(prev, ['0044'], now);
  assert.strictEqual(d.shouldAlert, true);
});

// ── buildUnresolvedMessage (single-line) ─────────────────────────────────
test('buildUnresolvedMessage — single line, contient refs', () => {
  const msg = buildUnresolvedMessage('2026-2027', ['0044', 'B6-AGRUMES']);
  assert.ok(!/\n/.test(msg), 'pas de retour ligne');
  assert.ok(msg.includes('0044'));
  assert.ok(msg.includes('B6-AGRUMES'));
  assert.ok(msg.includes('2026-2027'));
});

test('buildUnresolvedMessage — tronque au-delà de 15', () => {
  const refs = Array.from({ length: 20 }, (_, i) => `R${i}`);
  const msg = buildUnresolvedMessage('2026-2027', refs);
  assert.ok(msg.includes('(+5)'));
});

// ── resolveCampagneId ────────────────────────────────────────────────────
test('resolveCampagneId — matche label normalisé (espaces/slash)', async () => {
  const runner = {
    query: async () => ({ recordset: [
      { ID_compagne: 1, Compagne: '2024 / 2025' },
      { ID_compagne: 3, Compagne: '2026 / 2027' },
    ] }),
  };
  assert.strictEqual(await resolveCampagneId(runner, '2026-2027'), 3);
  assert.strictEqual(await resolveCampagneId(runner, '2024-2025'), 1);
});

test('resolveCampagneId — introuvable → null', async () => {
  const runner = { query: async () => ({ recordset: [{ ID_compagne: 1, Compagne: '2024 / 2025' }] }) };
  assert.strictEqual(await resolveCampagneId(runner, '2030-2031'), null);
});
