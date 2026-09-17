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
  isGardiennage,
  isSansEquipe,
  GARDIENNAGE_PATTERN,
} = require('../heuresSup');

// Configuration réellement présente en prod dans app_settings/heures_sup.
const PROD_EXCLUDED = ['Gardien de nuit', 'Gardien du jour'];

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

test('normalizeFonctionLabel: minuscule + espaces réduits + préfixe retiré', () => {
  assert.equal(normalizeFonctionLabel('  12.   Gardiennage  '), 'gardiennage');
  assert.equal(normalizeFonctionLabel(null), '');
});

test('normalizeFonctionLabel: accents dépliés et préfixe numérique retiré', () => {
  assert.equal(normalizeFonctionLabel('08. Service Générale'), 'service generale');
  assert.equal(normalizeFonctionLabel('8. Récolte'), 'recolte');
  assert.equal(normalizeFonctionLabel('08. Récolte'), 'recolte');
});

// ---- isGardiennage ----

test('isGardiennage: vrai sur l’opération, quelles que soient les variantes', () => {
  assert.equal(isGardiennage('08. Service générale', 'Gardiennage'), true);
  assert.equal(isGardiennage('08. Service générale', 'Gardien de nuit'), true);
  assert.equal(isGardiennage('08. Service générale', 'Gardien du jour'), true);
  assert.equal(isGardiennage('08. Service générale', 'Gardienne'), true);
});

test('isGardiennage: faux sur les autres opérations de la même famille', () => {
  assert.equal(isGardiennage('08. Service générale', 'Magasinier'), false);
  assert.equal(isGardiennage('08. Service générale', 'Technicien'), false);
  assert.equal(isGardiennage('08. Service générale', 'Conducteur de voiture'), false);
  assert.equal(isGardiennage('08. Service générale', null), false);
});

test('GARDIENNAGE_PATTERN: racine « gardien »', () => {
  assert.equal(GARDIENNAGE_PATTERN.test('gardiennage'), true);
  assert.equal(GARDIENNAGE_PATTERN.test('magasinier'), false);
});

// ---- gardiennage réel (libellés de production) ----

test('shouldExcludeWorkerDay: gardiennage prod exclu SANS config', () => {
  assert.equal(
    shouldExcludeWorkerDay({ operationFamille: '08. Service générale', operation: 'Gardiennage' }, []),
    true
  );
});

test('shouldExcludeWorkerDay: gardiennage prod exclu AVEC la config actuelle', () => {
  assert.equal(
    shouldExcludeWorkerDay({ operationFamille: '08. Service générale', operation: 'Gardiennage' }, PROD_EXCLUDED),
    true
  );
  assert.equal(
    shouldExcludeWorkerDay({ operationFamille: '08. Service générale', operation: 'Gardien de nuit' }, PROD_EXCLUDED),
    true
  );
});

test('shouldExcludeWorkerDay: autres métiers de « Service générale » conservés', () => {
  for (const op of ['Magasinier', 'Technicien', 'Conducteur de voiture']) {
    assert.equal(
      shouldExcludeWorkerDay({ operationFamille: '08. Service générale', operation: op }, PROD_EXCLUDED),
      false,
      `attendu conservé : ${op}`
    );
  }
});

test('shouldExcludeWorkerDay: familles techniques conservées', () => {
  assert.equal(
    shouldExcludeWorkerDay(
      { operationFamille: '11. Ferti-irrigation', operation: 'Irrigation & fertigation' },
      PROD_EXCLUDED
    ),
    false
  );
  assert.equal(
    shouldExcludeWorkerDay(
      { operationFamille: '04. Traitement phyto/Désherbage', operation: 'Traitement phyto' },
      PROD_EXCLUDED
    ),
    false
  );
});

test('shouldExcludeWorkerDay: récolte zéro-padée « 08. Récolte » exclue', () => {
  assert.equal(
    shouldExcludeWorkerDay({ operationFamille: '08. Récolte', operation: 'caisse 2.4 kg' }, []),
    true
  );
});

test('matchesExcludedFonction: inclusion sur l’opération, pas sur la famille', () => {
  // "gardien" configuré attrape la variante longue de l'opération…
  assert.equal(matchesExcludedFonction('08. Service générale', 'Gardien de nuit', ['gardien']), true);
  // …mais pas par inclusion dans la famille (trop large).
  assert.equal(matchesExcludedFonction('08. Service générale', 'Magasinier', ['service']), false);
  // Entrée trop courte : pas d'inclusion accidentelle.
  assert.equal(matchesExcludedFonction('08. Service générale', 'Magasinier', ['ma']), false);
});

// ---- isSansEquipe ----
// Matricules RÉELS relevés dans prod_presence (2026-08-19, 2026-08-22, 2026-09-01).

test('isSansEquipe: matricule purement numérique = sans équipe', () => {
  for (const mat of ['5', '6', '102', '190', '11523', '3397']) {
    assert.equal(isSansEquipe(mat), true, `attendu sans équipe : ${mat}`);
  }
});

// ZU / ZZ / DD ne figurent PAS dans les 13 préfixes de functions/src/modules/rh/equipesConfig.js,
// et sont pourtant bien présents en production : la règle conserve tout matricule
// portant une lettre, qu'il corresponde ou non à un préfixe connu.
test('isSansEquipe: matricule contenant au moins une lettre = conservé', () => {
  for (const mat of ['ZU11501', 'HAFI234', 'ZZ44594', 'MM01', 'AY02', 'DD10502']) {
    assert.equal(isSansEquipe(mat), false, `attendu conservé : ${mat}`);
  }
});

test('isSansEquipe: le prédicat est « aucune lettre », pas « commence par un chiffre »', () => {
  // Chiffre en tête mais lettre présente → conservé (ce cas distingue la
  // sémantique demandée d'un test /^\d/).
  assert.equal(isSansEquipe('1A234'), false);
});

test('isSansEquipe: espaces autour ignorés', () => {
  assert.equal(isSansEquipe('  102  '), true);
  assert.equal(isSansEquipe('  MM01 '), false);
});

test('isSansEquipe: casse indifférente', () => {
  assert.equal(isSansEquipe('zu11501'), false);
});

test('isSansEquipe: matricule vide/absent = sans équipe (ne peut porter aucun préfixe)', () => {
  assert.equal(isSansEquipe(''), true);
  assert.equal(isSansEquipe('   '), true);
  assert.equal(isSansEquipe(null), true);
  assert.equal(isSansEquipe(undefined), true);
});
