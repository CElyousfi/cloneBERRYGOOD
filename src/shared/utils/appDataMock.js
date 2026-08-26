// @ts-check
/**
 * Shared Default Application Data Mock.
 * Provides complete default data structures and helper stubs for all domain components,
 * preventing `TypeError: Cannot read properties of undefined` crashes.
 */

export const defaultAppData = {
  transportConfig: [
    { prefix: 'SO', equipe: 'Souss Équipe 1', coutParOuvrier: 240 },
    { prefix: 'LK', equipe: 'Loukkos Équipe 2', coutParOuvrier: 240 },
    { prefix: 'HA', equipe: 'Hafida Équipe 3', coutParOuvrier: 240 },
    { prefix: 'BGF', equipe: 'BGF Interne', coutParOuvrier: 0 }
  ],
  entries: [],
  primesConfig: { baseKg: 50, ratePerKg: 2.5 },
  getCoutTransport: (prefix, defaultVal) => defaultVal || 240,
  calcPrime: () => 0,
  parcelleConfig: [
    { id: 'P1', nom: 'Parcelle Souss A1', variete: 'Star', ha: 12.5 },
    { id: 'P2', nom: 'Parcelle Loukkos B2', variete: 'Diamond', ha: 18.0 }
  ],
  getCultureForVariete: (variete) => variete || 'Framboise',
  normesProductivite: { fraise: 12.5, framboise: 8.0, myrtille: 10.0 },
  avocatierConfig: {},
  blocIds: ['B1', 'B2', 'B3', 'B4', 'A1', 'A2'],
  qualiteBrix: [
    { id: '1', date: '2026-08-25', brix: 9.4, lot: 'B4', conforme: true },
    { id: '2', date: '2026-08-24', brix: 8.8, lot: 'A2', conforme: true }
  ],
  pfqHistory: [],
  weeklyRanking: [],
  expeditions: [],
  ca: 460000,
  kg: 12450,
  tunnel: {},
  cpcCharges: [],
  cpcVarietes: [],
  totalCAExport: 350000,
  totalCALocal: 110000,
  totalHa: 100,
  equipe: 'Souss Équipe 1',
  caporal: [],
  totalKgExport: 9800,
  ebeParVariete: { Fraise: 120000, Framboise: 180000, Myrtille: 160000 },
  ebeFramboise: 180000,
  resultatParMois: {},
  cfDea: 0,
  resultatAvantImpot: 240000,
  sheets: [],
  finStock: [],
  fruitAdvance: {},
  framboise: {},
  myrtille: {},
  cropAdvance: {},
  analyses: [],
  counts: {}
};

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.defaultAppData = defaultAppData;
}
