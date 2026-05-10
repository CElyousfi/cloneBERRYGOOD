/**
 * Test fixtures shaped exactly like irrigation_readings documents in
 * Firestore (see public/app.jsx:22434 for the writer).
 */

function station(ec, ph, volume, label) {
  return { label: label || 'Point', ec, ph, volume };
}

function reading(overrides) {
  return {
    id: 'fake_' + Math.random().toString(36).slice(2, 8),
    date: '2026-05-01',
    ferme: 'F5',
    parcelle: 'C2-S8-COR',
    parcelleLabel: 'Corina Myrtille S8',
    heure: '08:00',
    duree: 5,
    points: [station(1.8, 6.0, 100, 'Point 1')],
    drainage: [station(2.0, 5.8, 20, 'Drainage 1')],
    source: 'manual',
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Scenario A: drainage croissant l'après-midi, plusieurs pulses > 30%
 *   Three morning pulses balanced (~20%), three afternoon pulses high (~33%, 36%, 40%).
 */
const scenarioOverDrainAfternoon = [
  reading({ heure: '08:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 20)] }),
  reading({ heure: '10:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
  reading({ heure: '12:00', points: [station(1.9, 6.0, 100)], drainage: [station(2.1, 5.9, 24)] }),
  reading({ heure: '15:30', points: [station(1.9, 6.0, 100)], drainage: [station(2.2, 5.9, 33)] }),
  reading({ heure: '17:00', points: [station(2.0, 6.0, 100)], drainage: [station(2.3, 5.9, 36)] }),
  reading({ heure: '18:30', points: [station(2.0, 6.0, 100)], drainage: [station(2.4, 5.9, 40)] }),
];

/**
 * Scenario B: drainage faible (<15%) répété + EC drainage nettement plus haute
 */
const scenarioLowDrainHighEcDrain = [
  reading({ heure: '07:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.5, 5.8, 10)] }),
  reading({ heure: '09:30', points: [station(1.8, 6.0, 100)], drainage: [station(2.6, 5.8, 8)] }),
  reading({ heure: '11:30', points: [station(1.8, 6.0, 100)], drainage: [station(2.7, 5.8, 12)] }),
  reading({ heure: '13:30', points: [station(1.9, 6.0, 100)], drainage: [station(2.7, 5.8, 14)] }),
];

/**
 * Scenario C: balanced day per Driscoll's golden rules — first drip dry,
 * then 18-23% drain, EC delta small, pH ok.
 */
const scenarioOptimal = [
  reading({ heure: '07:30', points: [station(1.8, 6.0, 100)], drainage: [station(1.9, 5.8, 2)] }),   // first drip: ~2% (dry-back respected)
  reading({ heure: '09:30', points: [station(1.8, 6.0, 100)], drainage: [station(1.9, 5.9, 18)] }),
  reading({ heure: '11:30', points: [station(1.9, 6.0, 100)], drainage: [station(2.0, 5.9, 21)] }),
  reading({ heure: '13:00', points: [station(1.9, 6.0, 100)], drainage: [station(2.0, 5.9, 23)] }),
  reading({ heure: '14:30', points: [station(1.9, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
];

/**
 * Scenario E: flat drain — same drainage all day. Should NOT trigger
 * the rising-trend rule even if the level is borderline.
 */
const scenarioFlatDrain = [
  reading({ heure: '07:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
  reading({ heure: '09:30', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
  reading({ heure: '12:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
  reading({ heure: '14:30', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
  reading({ heure: '17:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
];

/**
 * Scenario F: falling drain — drainage starts high, ends low.
 * Slope is negative → DRAIN_TREND_RISING must NOT fire.
 */
const scenarioFallingDrain = [
  reading({ heure: '07:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 33)] }),
  reading({ heure: '10:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 28)] }),
  reading({ heure: '13:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
  reading({ heure: '16:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 18)] }),
];

/**
 * Scenario D: missing/garbage data — should not crash anything.
 */
const scenarioMissingData = [
  // entirely empty
  {},
  // null arrays
  reading({ points: null, drainage: null, heure: null, duree: null, date: null }),
  // strings instead of numbers
  reading({ heure: 'not-a-time', points: [{ ec: 'NaN', ph: '', volume: '-1' }], drainage: [] }),
  // empty arrays
  reading({ points: [], drainage: [] }),
  // undefined
  undefined,
  null,
  // mostly valid but one bad station
  reading({
    heure: '10:00',
    points: [station(1.8, 6.0, 100), { ec: null, ph: undefined, volume: 'abc' }],
    drainage: [station(2.0, 5.9, 22)],
  }),
];

module.exports = {
  station,
  reading,
  scenarioOverDrainAfternoon,
  scenarioLowDrainHighEcDrain,
  scenarioOptimal,
  scenarioMissingData,
  scenarioFlatDrain,
  scenarioFallingDrain,
};
