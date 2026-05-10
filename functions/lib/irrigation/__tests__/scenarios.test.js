/**
 * Scenario-level tests — these are the four cases the spec calls out
 * explicitly:
 *   A. drainage croissant l'après-midi > 30% → recommandation REDUCE_NEXT_PULSE
 *   B. drainage faible + EC drain haute → SALT_ACCUMULATION_RISK
 *   C. journée équilibrée → diagnostic optimal
 *   D. données manquantes → pas de crash
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyseReadings, buildRecommendations } = require('..');
const {
  scenarioOverDrainAfternoon,
  scenarioLowDrainHighEcDrain,
  scenarioOptimal,
  scenarioMissingData,
} = require('./fixtures');

function summaryAndRecos(raws) {
  const { summaries } = analyseReadings(raws);
  assert.equal(summaries.length, 1, 'exactly one (date, parcelle) summary expected');
  const summary = summaries[0];
  const recos = buildRecommendations(summary);
  return { summary, recos };
}

test('A. afternoon over-drain → REDUCE_NEXT_PULSE + STOP_EARLIER', () => {
  const { summary, recos } = summaryAndRecos(scenarioOverDrainAfternoon);

  assert.ok(['over-drain', 'critical'].includes(summary.diagnosis),
    `expected over-drain or critical, got ${summary.diagnosis}`);
  assert.ok(summary.highDrainPulseCount >= 2, 'should flag multiple high-drain pulses');

  const codes = recos.map(r => r.code);
  assert.ok(
    codes.includes('REDUCE_NEXT_PULSE') || codes.includes('REDUCE_NEXT_PULSE_HARD'),
    `expected reduce reco, got: ${codes.join(',')}`,
  );
  assert.ok(codes.includes('STOP_EARLIER'),
    `expected late-day reco, got: ${codes.join(',')}`);

  // Levels are at least warning
  for (const r of recos.filter(r => r.code !== 'OPTIMAL')) {
    assert.ok(['warning', 'critical', 'info'].includes(r.level));
  }
});

test('B. low drain + high EC drain → SALT_ACCUMULATION_RISK', () => {
  const { summary, recos } = summaryAndRecos(scenarioLowDrainHighEcDrain);

  // Diagnosis should not be optimal here
  assert.notEqual(summary.diagnosis, 'optimal');
  // ΔEC should be > 0.4 in fixture
  const ecDelta = summary.avgEcDrain - summary.avgEcPts;
  assert.ok(ecDelta > 0.4, `expected ecDelta > 0.4, got ${ecDelta}`);

  const codes = recos.map(r => r.code);
  assert.ok(codes.includes('SALT_ACCUMULATION_RISK'),
    `expected SALT_ACCUMULATION_RISK, got: ${codes.join(',')}`);
  // Should also recommend more input because drainage is repeatedly low
  assert.ok(codes.includes('INCREASE_INPUT'),
    `expected INCREASE_INPUT, got: ${codes.join(',')}`);
});

test('C. balanced day → diagnosis optimal, single OPTIMAL reco', () => {
  const { summary, recos } = summaryAndRecos(scenarioOptimal);

  assert.equal(summary.diagnosis, 'optimal',
    `expected optimal, got ${summary.diagnosis} — reasons: ${JSON.stringify(summary.diagnosisReasons)}`);
  assert.equal(summary.highDrainPulseCount, 0);
  assert.equal(summary.lowDrainPulseCount, 0);

  assert.equal(recos.length, 1);
  assert.equal(recos[0].code, 'OPTIMAL');
  assert.equal(recos[0].level, 'ok');
});

test('D. missing / malformed data → no crash, returns sane shapes', () => {
  assert.doesNotThrow(() => {
    const out = analyseReadings(scenarioMissingData);
    assert.ok(Array.isArray(out.events));
    assert.ok(Array.isArray(out.enriched));
    assert.ok(Array.isArray(out.summaries));
    assert.ok(out.recommendationsByKey && typeof out.recommendationsByKey === 'object');

    // Recos for any produced summary must still be a valid array
    for (const key of Object.keys(out.recommendationsByKey)) {
      assert.ok(Array.isArray(out.recommendationsByKey[key]));
    }
  });

  // Edge cases
  assert.doesNotThrow(() => analyseReadings([]));
  assert.doesNotThrow(() => analyseReadings(null));
  assert.doesNotThrow(() => analyseReadings(undefined));
  assert.doesNotThrow(() => buildRecommendations(null));
  assert.doesNotThrow(() => buildRecommendations(undefined));
  assert.doesNotThrow(() => buildRecommendations({}));
});
