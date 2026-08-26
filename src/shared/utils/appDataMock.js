// @ts-check
/**
 * Shared Default Application Data Mock matching 100% of legacy app.jsx structures.
 * Prevents `TypeError: data.xxx.map is not a function` and missing data property errors.
 */

export const defaultAppData = {
  transportConfig: [
    { prefix: 'SO', equipe: 'Souss Équipe 1', coutParOuvrier: 240 },
    { prefix: 'LK', equipe: 'Loukkos Équipe 2', coutParOuvrier: 240 },
    { prefix: 'HA', equipe: 'Hafida Équipe 3', coutParOuvrier: 240 },
    { prefix: 'BGF', equipe: 'BGF Interne', coutParOuvrier: 0 }
  ],
  ebeParVariete: [
    { variete: 'Fraise Star', ebe: 120000, ca: 320000, kg: 8500 },
    { variete: 'Framboise Diamond', ebe: 180000, ca: 450000, kg: 12000 },
    { variete: 'Myrtille Blue', ebe: 160000, ca: 380000, kg: 9500 }
  ],
  cpcCharges: [
    { poste: 'Engrais & Produits Phytosanitaires', montant: 65400, pct: '28%' },
    { poste: 'Main d\'oeuvre & Paie Ouvriers', montant: 184200, pct: '45%' },
    { poste: 'Transport & Logistique', montant: 24500, pct: '12%' },
    { poste: 'Emballage & Conditionnement', montant: 32000, pct: '15%' }
  ],
  cpcVarietes: [
    { variete: 'Fraise Star', ca: 320000, charges: 200000, ebe: 120000 },
    { variete: 'Framboise Diamond', ca: 450000, charges: 270000, ebe: 180000 },
    { variete: 'Myrtille Blue', ca: 380000, charges: 220000, ebe: 160000 }
  ],
  resultatParMois: [
    { mois: 'Janvier', ca: 420000, charges: 280000, ebe: 140000 },
    { mois: 'Février', ca: 510000, charges: 310000, ebe: 200000 }
  ],
  recolteData: [
    { date: '2026-08-25', kg: 1250, ferme: 'Ferme 1 - Souss', variete: 'Fraise Star' },
    { date: '2026-08-24', kg: 1400, ferme: 'Ferme 2 - Loukkos', variete: 'Framboise' }
  ],
  recolteParJour: [
    { date: '25 Fév', kg: 1250 },
    { date: '24 Fév', kg: 1400 }
  ],
  quinzaineData: [
    { quinzaine: 'Q16', kg: 12450, total: 184200 }
  ],
  weeklyTrend: [
    { semaine: 'S34', kg: 8500 }
  ],
  parcellesMap: {},
  equipes: [
    { prefix: 'SO', nom: 'Souss Équipe 1' },
    { prefix: 'LK', nom: 'Loukkos Équipe 2' }
  ],
  suiviModifs: [],
  qualiteInspections: [
    { id: 'INSP-401', lot: 'Lot Fraise Star B4', date: '2026-08-26', inspecteur: 'K. Reda', brix: 9.4, defectRate: 1.2, status: 'Conforme (Cat A)' },
    { id: 'INSP-402', lot: 'Lot Framboise Diamond A2', date: '2026-08-25', inspecteur: 'M. Alami', brix: 8.8, defectRate: 2.5, status: 'Conforme (Cat A)' }
  ],
  qualiteHistorique: [],
  qualiteBrix: [
    { id: '1', date: '2026-08-25', brix: 9.4, lot: 'B4', conforme: true },
    { id: '2', date: '2026-08-24', brix: 8.8, lot: 'A2', conforme: true }
  ],
  pfqHistory: [],
  weeklyRanking: [],
  expeditions: [
    { id: 'EXP-101', date: '2026-08-25', client: 'Berry Export SA', netKg: 4500, status: 'En Transit' }
  ],
  stockEmballages: [],
  stockIntrants: [],
  parcAuto: [],
  caDetail: [],
  carburant: {
    totalMois: 12500,
    totalCampagne: 45000,
    totalPeages: 3200,
    prixMoyenLitre: 11.80
  },
  liquidations: [],
  horsRecolteParTunnel: [],
  ouvriersMatricule: {},
  meteoData: [],
  agroData: [],
  quinzaineOrder: ['Q16', 'Q15', 'Q14'],
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
  ca: 460000,
  kg: 12450,
  tunnel: {},
  totalCAExport: 350000,
  totalCALocal: 110000,
  totalHa: 100,
  equipe: 'Souss Équipe 1',
  caporal: [],
  totalKgExport: 9800,
  ebeFramboise: 180000,
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
