const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SEUIL_MINUTES,
  parseHHMM,
  computeDurationOvertime,
  formatDuration,
  normalizeFonctionLabel,
  matchesExcludedFonction,
  shouldExcludeWorkerDay,
} = require('../heuresSup');

// ---- parseHHMM ----

test('parseHHMM: "06:53" → 413', () => {
  assert.equal(parseHHMM('06:53'), 6 * 60 + 53);
});

test('parseHHMM: trims and accepts single-digit hour', () => {
  assert.equal(parseHHMM(' 6:05 '), 365);
});

test('parseHHMM: null / empty / garbage → null', () => {
  assert.equal(parseHHMM(null), null);
  assert.equal(parseHHMM(''), null);
  assert.equal(parseHHMM('abc'), null);
  assert.equal(parseHHMM('25:00'), null);
  assert.equal(parseHHMM('12:99'), null);
});

// ---- computeDurationOvertime ----

test('computeDurationOvertime: shift de 9h → dépassement 30 min', () => {
  const r = computeDurationOvertime('07:00', '16:00');
  assert.equal(r.durationMin, 540);
  assert.equal(r.overtimeMin, 30);
  assert.equal(r.clockedIn, false);
});

test('computeDurationOvertime: exactement 8h30 → 0 dépassement', () => {
  const r = computeDurationOvertime('08:00', '16:30');
  assert.equal(r.durationMin, SEUIL_MINUTES);
  assert.equal(r.overtimeMin, 0);
});

test('computeDurationOvertime: moins de 8h30 → 0 dépassement', () => {
  const r = computeDurationOvertime('08:00', '12:00');
  assert.equal(r.durationMin, 240);
  assert.equal(r.overtimeMin, 0);
});

test('computeDurationOvertime: sortie nulle → encore pointé, durée inconnue', () => {
  const r = computeDurationOvertime('06:00', null);
  assert.equal(r.durationMin, null);
  assert.equal(r.overtimeMin, 0);
  assert.equal(r.clockedIn, true);
});

test('computeDurationOvertime: entrée nulle → durée inconnue, pas clockedIn', () => {
  const r = computeDurationOvertime(null, '16:00');
  assert.equal(r.durationMin, null);
  assert.equal(r.clockedIn, false);
});

test('computeDurationOvertime: passage minuit (sortie < entrée) → +24h', () => {
  const r = computeDurationOvertime('20:00', '08:00');
  assert.equal(r.durationMin, 720); // 12h
  assert.equal(r.overtimeMin, 720 - SEUIL_MINUTES);
});

test('computeDurationOvertime: seuil custom respecté', () => {
  const r = computeDurationOvertime('08:00', '17:00', 480); // seuil 8h
  assert.equal(r.durationMin, 540);
  assert.equal(r.overtimeMin, 60);
});

// ---- formatDuration ----

test('formatDuration: 510 → "8h 30"', () => {
  assert.equal(formatDuration(510), '8h 30');
});

test('formatDuration: 60 → "1h 00", 5 → "0h 05"', () => {
  assert.equal(formatDuration(60), '1h 00');
  assert.equal(formatDuration(5), '0h 05');
});

test('formatDuration: null → "—"', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(undefined), '—');
});

// ---- matchesExcludedFonction ----

test('matchesExcludedFonction: match sur famille (insensible casse/espaces)', () => {
  assert.equal(matchesExcludedFonction('12. Gardiennage', 'gardien', ['  gardien ']), true);
  assert.equal(matchesExcludedFonction('12. Gardiennage', 'nuit', ['12. gardiennage']), true);
});

test('matchesExcludedFonction: pas de match → false', () => {
  assert.equal(matchesExcludedFonction('7. Taille', 'taille', ['gardien']), false);
});

test('matchesExcludedFonction: liste vide → false', () => {
  assert.equal(matchesExcludedFonction('x', 'y', []), false);
  assert.equal(matchesExcludedFonction('x', 'y', undefined), false);
});

// ---- shouldExcludeWorkerDay ----

test('shouldExcludeWorkerDay: récolte toujours exclue', () => {
  assert.equal(shouldExcludeWorkerDay({ operationFamille: '8. Récolte', operation: 'caisse 2.4 kg' }, []), true);
});

test('shouldExcludeWorkerDay: gardien exclu via config', () => {
  assert.equal(shouldExcludeWorkerDay({ operationFamille: '12. Gardiennage', operation: 'gardien' }, ['gardien']), true);
});

test('shouldExcludeWorkerDay: hors-récolte standard conservé', () => {
  assert.equal(shouldExcludeWorkerDay({ operationFamille: '7. Taille', operation: 'taille' }, ['gardien']), false);
});

// ---- normalizeFonctionLabel ----

test('normalizeFonctionLabel: minuscule + espaces réduits', () => {
  assert.equal(normalizeFonctionLabel('  12.   Gardiennage  '), '12. gardiennage');
  assert.equal(normalizeFonctionLabel(null), '');
});
