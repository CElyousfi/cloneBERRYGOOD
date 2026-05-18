/**
 * parcellesCulturales.js — Static config for cultivated parcels.
 *
 * Mirrors PARCELLES_CULTURALES in public/app.jsx (~line 2348). Keep in sync
 * if the frontend list changes.
 *
 * Provides helpers: getHaByCycle, getPlantsByCycle, normalizeParcelle, getCycle.
 */

const PARCELLES_CULTURALES = [
  // === CYCLE 1 (Sep-Déc) === F1
  { id: 'C1-S7S3-MOTTE',  cycle: 1, variete: 'Maravilla', sousVariete: 'Long Cane',  ferme: 'F1', ha: 2.6, culture: 'Framboise', nbPlants: 0,
    designations: ['S7-S3 MARAVILLA MOTTE F1', 'S3 - MARAVILLA MOTTE F1', 'S7 -MARAVILLA MOTTE F1'] },
  { id: 'C1-S1S4-MOW',    cycle: 1, variete: 'Maravilla', sousVariete: 'Mow Down',   ferme: 'F1', ha: 2.1, culture: 'Framboise', nbPlants: 0,
    designations: ['S1/S4 MARAVILLA MOW DOWN F1', 'S1/S4 Maravilla mow down F1'] },
  { id: 'C1-S2S5-MOW',    cycle: 1, variete: 'Yazmin',    sousVariete: 'Mow Down',   ferme: 'F1', ha: 2.8, culture: 'Framboise', nbPlants: 0,
    designations: ['S2-S5 YAZMIN MOW DOWN F1', 'S2 -YAZMIN MOW DOWN F1', 'S5 -YAZMIN MOW DOWN F1'] },
  // === CYCLE 1 === F5
  { id: 'C1-S10-MOTTE',   cycle: 1, variete: 'Yazmin',    sousVariete: 'Bi Cycle',   ferme: 'F5', ha: 1.9, culture: 'Framboise', nbPlants: 0,
    designations: ['S10 YAZMIN MOTTE F5', 'S10 - YAZMIN MOTTE F5'] },
  { id: 'C1-S13-MOW',     cycle: 1, variete: 'Yazmin',    sousVariete: 'Mow Down',   ferme: 'F5', ha: 2.8, culture: 'Framboise', nbPlants: 0,
    designations: ['S13 YAZMIN MOW DOWN F5', 'S13 - YAZMIN MOW DOWN F5'], enProduction: false },
  { id: 'C1-S9-REY',      cycle: 1, variete: 'Reyna',     sousVariete: null,         ferme: 'F5', ha: 3.0, culture: 'Framboise', nbPlants: 0,
    designations: ['S9 REYNA F5', 'S9 - REYNA F5'], enProduction: false },
  { id: 'C1-S8-COR',      cycle: 1, variete: 'Corina',    sousVariete: null,         ferme: 'F5', ha: 2.5, culture: 'Myrtille',  nbPlants: 8250,
    designations: ['CORINA MYRTILLE S8', 'F5 CORINA'] },

  // === CYCLE 2 (Jan-Juin) === F1
  { id: 'C2-S1S4-GC',     cycle: 2, variete: 'Maravilla', sousVariete: 'Green Cane', ferme: 'F1', ha: 4.0, culture: 'Framboise', nbPlants: 0,
    designations: ['MARAVILLA GG F1', 'S1.S4 Maravilla green can F1'] },
  { id: 'C2-S2357-LC',    cycle: 2, variete: 'Maravilla', sousVariete: 'Long Cane',  ferme: 'F1', ha: 5.0, culture: 'Framboise', nbPlants: 0,
    designations: ['MARAVILLA LG F1', 'S2.S3.S5.S6.S7 maravilla logn can F1'] },
  // === CYCLE 2 === F5
  { id: 'C2-S10-CB',      cycle: 2, variete: 'Yazmin',    sousVariete: 'Bi Cycle',   ferme: 'F5', ha: 1.9, culture: 'Framboise', nbPlants: 0,
    designations: ['S10 YAZMIN CUT BACK F5', 'S10 YAZMIN cut back F5', 'S10 YAZMIN MOTTE F5'] },
  { id: 'C2-S13-MOW',     cycle: 2, variete: 'Yazmin',    sousVariete: 'Mow Down',   ferme: 'F5', ha: 2.8, culture: 'Framboise', nbPlants: 0,
    designations: ['S13 YAZMIN MOW DOWN F5', 'S13 - YAZMIN MOW DOWN F5'], enProduction: false },
  { id: 'C2-S9-REY',      cycle: 2, variete: 'Reyna',     sousVariete: null,         ferme: 'F5', ha: 3.0, culture: 'Framboise', nbPlants: 0,
    designations: ['S9 REYNA F5', 'S9 - REYNA F5'], enProduction: false },
  { id: 'C2-S8-COR',      cycle: 2, variete: 'Corina',    sousVariete: null,         ferme: 'F5', ha: 2.5, culture: 'Myrtille',  nbPlants: 8250,
    designations: ['CORINA MYRTILLE S8', 'F5 CORINA'] },
  { id: 'C2-S8-BRZ',      cycle: 2, variete: 'Breeze',    sousVariete: null,         ferme: 'F5', ha: 1.0, culture: 'Myrtille',  nbPlants: 3275,
    designations: ['BREEZE MYRTILLE S8-2'] },
  { id: 'C2-S8-CAS',      cycle: 2, variete: 'Cascade',   sousVariete: null,         ferme: 'F5', ha: 1.5, culture: 'Myrtille',  nbPlants: 5028,
    designations: ['CASCADE MYRTILLE S8-1'] },
  { id: 'C2-NP-BRZ',      cycle: 2, variete: 'Breeze',    sousVariete: 'Nouvelle plantation', ferme: 'F5', ha: 0.84, culture: 'Myrtille', nbPlants: 3425,
    designations: ['F5 BREEZE'], enProduction: false },
  { id: 'C2-NP-CAS',      cycle: 2, variete: 'Cascade',   sousVariete: 'Nouvelle plantation', ferme: 'F5', ha: 1.96, culture: 'Myrtille', nbPlants: 8540,
    designations: ['F5 CASCADE'], enProduction: false },
];

const DESIGNATION_MAP = {};
PARCELLES_CULTURALES.forEach(pc => {
  const entry = { variete: pc.variete, sousVariete: pc.sousVariete, ferme: pc.ferme, culture: pc.culture };
  (pc.designations || []).forEach(d => {
    DESIGNATION_MAP[d] = entry;
    DESIGNATION_MAP[d.toUpperCase()] = entry;
  });
});
Object.assign(DESIGNATION_MAP, {
  'Maravilla':    { variete: 'Maravilla', sousVariete: null, ferme: 'F1', culture: 'Framboise' },
  'Maravilla GC': { variete: 'Maravilla', sousVariete: 'Green Cane', ferme: 'F1', culture: 'Framboise' },
  'Yazmin Sol':   { variete: 'Yazmin',    sousVariete: null, ferme: 'F5', culture: 'Framboise' },
  'Yazmin':       { variete: 'Yazmin',    sousVariete: null, ferme: 'F5', culture: 'Framboise' },
  'Reyna':        { variete: 'Reyna',     sousVariete: null, ferme: 'F5', culture: 'Framboise' },
  'Corrina':      { variete: 'Corina',    sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
  'Corina':       { variete: 'Corina',    sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
  'Adelita':      { variete: 'Adelita',   sousVariete: null, ferme: 'F5', culture: 'Framboise' },
  'Breeze':       { variete: 'Breeze',    sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
  'Cascade':      { variete: 'Cascade',   sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
});

function normalizeParcelle(rawName) {
  if (!rawName) return null;
  const trimmed = String(rawName).trim();
  if (DESIGNATION_MAP[trimmed]) return DESIGNATION_MAP[trimmed];
  if (DESIGNATION_MAP[trimmed.toUpperCase()]) return DESIGNATION_MAP[trimmed.toUpperCase()];
  const u = trimmed.toUpperCase();
  const fermeHint = u.includes('F1') ? 'F1' : u.includes('F5') ? 'F5' : null;
  if (u.includes('MARAVILLA')) {
    if (u.includes('GG') || u.includes('GREEN') || /\bGC\b/.test(u)) return { variete:'Maravilla', sousVariete:'Green Cane', ferme: fermeHint||'F1', culture:'Framboise' };
    if (u.includes('MOTTE') || u.includes('LONG') || /\bLG\b/.test(u)) return { variete:'Maravilla', sousVariete:'Long Cane', ferme: fermeHint||'F1', culture:'Framboise' };
    if (u.includes('MOW')) return { variete:'Maravilla', sousVariete:'Mow Down', ferme: fermeHint||'F1', culture:'Framboise' };
    return { variete:'Maravilla', sousVariete:null, ferme: fermeHint||'F1', culture:'Framboise' };
  }
  if (u.includes('YAZMIN') || u.includes('YASMIN')) {
    if (u.includes('MOTTE') || u.includes('BI')) return { variete:'Yazmin', sousVariete:'Bi Cycle', ferme: fermeHint||'F5', culture:'Framboise' };
    if (u.includes('MOW')) return { variete:'Yazmin', sousVariete:'Mow Down', ferme: fermeHint||'F5', culture:'Framboise' };
    if (u.includes('CUT')) return { variete:'Yazmin', sousVariete:'Bi Cycle', ferme: fermeHint||'F5', culture:'Framboise' };
    return { variete:'Yazmin', sousVariete:null, ferme: fermeHint||'F5', culture:'Framboise' };
  }
  if (u.includes('REYNA') || u.includes('REINA')) return { variete:'Reyna', sousVariete:null, ferme:'F5', culture:'Framboise' };
  if (u.includes('CORINA') || u.includes('CORRINA')) return { variete:'Corina', sousVariete:null, ferme:'F5', culture:'Myrtille' };
  if (u.includes('CASCADE')) return { variete:'Cascade', sousVariete:null, ferme:'F5', culture:'Myrtille' };
  if (u.includes('BREEZE')) return { variete:'Breeze', sousVariete:null, ferme:'F5', culture:'Myrtille' };
  if (u.includes('ADELITA')) return { variete:'Adelita', sousVariete:null, ferme:'F5', culture:'Framboise' };
  return null;
}

function getHaByCycle(variete, sousVariete, ferme, cycle) {
  const matches = PARCELLES_CULTURALES.filter(pc =>
    pc.variete === variete && pc.cycle === cycle &&
    pc.enProduction !== false &&
    (!ferme || pc.ferme === ferme) &&
    (sousVariete ? pc.sousVariete === sousVariete : true)
  );
  return matches.reduce((sum, pc) => sum + pc.ha, 0);
}

function getPlantsByCycle(variete, sousVariete, ferme, cycle) {
  const matches = PARCELLES_CULTURALES.filter(pc =>
    pc.variete === variete && pc.cycle === cycle &&
    (!ferme || pc.ferme === ferme) &&
    (sousVariete ? pc.sousVariete === sousVariete : true) &&
    pc.sousVariete !== 'Nouvelle plantation' &&
    pc.nbPlants > 0
  );
  return matches.reduce((sum, pc) => sum + pc.nbPlants, 0);
}

function getCycle(dateStr) {
  if (!dateStr) return 2;
  const m = new Date(dateStr).getMonth();
  return (m >= 8 && m <= 11) ? 1 : 2; // Sep-Déc=1, Jan-Juin=2
}

module.exports = {
  PARCELLES_CULTURALES,
  normalizeParcelle,
  getHaByCycle,
  getPlantsByCycle,
  getCycle,
};
