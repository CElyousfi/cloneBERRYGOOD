/**
 * Tests for the Driscoll's "Golden Rules" alignment:
 *   R13 FIRST_DRIP_RUNOFF       — Rule 4
 *   R14 NO_DRIP_RUNOFF_AT_ALL   — Rule 3 strict
 *   sunset-dynamic late-day cutoff — Rule 1
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyseReadings, buildRecommendations, enrichEvents, normalizeReadings, buildDailySummaries, DEFAULT_THRESHOLDS } = require('..');
const { reading, station } = require('./fixtures');

test('R13 FIRST_DRIP_RUNOFF fires when first morning pulse drains', () => {
  const raws = [
    reading({ heure: '07:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 18)] }), // 18% — too much for first
    reading({ heure: '09:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 20)] }),
    reading({ heure: '11:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 22)] }),
  ];
  const { summaries } = analyseReadings(raws);
  const summary = summaries[0];
  assert.ok(summary.firstPulseDrained);
  const recos = buildRecommendations(summary);
  const reco = recos.find(r => r.code === 'FIRST_DRIP_RUNOFF');
  assert.ok(reco);
  assert.match(reco.suggestedAction, /1er pulse|trop tôt|hier/i);
});

test('R13 does NOT fire when first pulse is dry (Driscoll-compliant)', () => {
  const raws = [
    reading({ heure: '07:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 2)] }),  // 2%, OK
    reading({ heure: '09:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 18)] }),
    reading({ heure: '11:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 22)] }),
  ];
  const { summaries } = analyseReadings(raws);
  assert.equal(summaries[0].firstPulseDrained, false);
  const recos = buildRecommendations(summaries[0]);
  assert.ok(!recos.map(r => r.code).includes('FIRST_DRIP_RUNOFF'));
});

test('R14 NO_DRIP_RUNOFF_AT_ALL fires when no pulse drains all day', () => {
  // 4 pulses, all with drainPct ≈ 0
  const raws = [
    reading({ heure: '07:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
    reading({ heure: '09:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
    reading({ heure: '11:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
    reading({ heure: '13:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
  ];
  const { summaries } = analyseReadings(raws);
  assert.ok(summaries[0].noRunoffAllDay);
  const recos = buildRecommendations(summaries[0]);
  assert.ok(recos.map(r => r.code).includes('NO_DRIP_RUNOFF_AT_ALL'));
});

test('R14 does NOT fire when at least one pulse drains', () => {
  const raws = [
    reading({ heure: '07:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
    reading({ heure: '09:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 18)] }),
    reading({ heure: '11:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
  ];
  const { summaries } = analyseReadings(raws);
  assert.equal(summaries[0].noRunoffAllDay, false);
});

test('R14 needs ≥ minPulses to fire (no false positive on tiny days)', () => {
  // Only 2 pulses, both with no drain → not enough data
  const raws = [
    reading({ heure: '07:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
    reading({ heure: '09:30', points: [station(1.8, 6, 100)], drainage: [station(0, 0, 0)] }),
  ];
  const { summaries } = analyseReadings(raws);
  assert.equal(summaries[0].noRunoffAllDay, false);
});

test('sunset-dynamic cutoff: summer evening pulse not late', () => {
  const weatherByDate = {
    '2026-07-15': { date: '2026-07-15', sunriseMin: 5 * 60 + 30, sunsetMin: 19 * 60 + 30, hourlyRadiation: new Array(24).fill(0) },
  };
  const raws = [
    reading({ date: '2026-07-15', heure: '16:00' }), // 3.5h before sunset → not late
    reading({ date: '2026-07-15', heure: '17:30' }), // exactly sunset-2h → late
  ];
  const enriched = enrichEvents(normalizeReadings(raws), DEFAULT_THRESHOLDS, weatherByDate);
  assert.equal(enriched[0].isLateDayPulse, false);
  assert.equal(enriched[1].isLateDayPulse, true);
});

test('sunset-dynamic cutoff: winter evening pulse late earlier', () => {
  const weatherByDate = {
    '2026-12-15': { date: '2026-12-15', sunriseMin: 7 * 60 + 30, sunsetMin: 17 * 60 + 30, hourlyRadiation: new Array(24).fill(0) },
  };
  // Cutoff = sunset(17:30) - 2h = 15:30, but min clamp at 13:00
  const raws = [
    reading({ date: '2026-12-15', heure: '14:30' }),
    reading({ date: '2026-12-15', heure: '15:30' }),
  ];
  const enriched = enrichEvents(normalizeReadings(raws), DEFAULT_THRESHOLDS, weatherByDate);
  assert.equal(enriched[0].isLateDayPulse, false);
  assert.equal(enriched[1].isLateDayPulse, true);
});

test('fallback to static lateDayHour when no weather provided', () => {
  const raws = [
    reading({ heure: '14:30' }),
    reading({ heure: '15:30' }),
  ];
  const enriched = enrichEvents(normalizeReadings(raws), DEFAULT_THRESHOLDS); // no weatherByDate
  assert.equal(enriched[0].isLateDayPulse, false); // 14:30 < 15:00
  assert.equal(enriched[1].isLateDayPulse, true);  // 15:30 ≥ 15:00
});
