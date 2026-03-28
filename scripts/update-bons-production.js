#!/usr/bin/env node
/**
 * Script de mise à jour des bons de production + encaissements + recap solde
 * Lit le fichier "SITUATION DE PRODUCTION 2025-2026.xlsx"
 *
 * Génère 3 fichiers:
 *   - public/bons_apport_export.json  (bons avec prixDH/totalDH)
 *   - public/encaissements_local.json (encaissements par client)
 *   - public/recap_solde_clients.json (recap solde par client depuis Excel)
 *
 * typeVente:
 *   - "Export"        → feuille SITUATION EXPORT (Driscoll's) + LOCAL col Type = EXP
 *   - "Marché Local"  → feuille SITUATION LOCAL, col Type = ECRT
 */

const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', 'functions', 'node_modules', 'xlsx'));

const ROOT = path.join(__dirname, '..');
const EXCEL_PATH = path.join(ROOT, 'SITUATION DE PRODUCTION 2025-2026.xlsx');
const JSON_PATH = path.join(ROOT, 'public', 'bons_apport_export.json');
const ENC_PATH = path.join(ROOT, 'public', 'encaissements_local.json');
const RECAP_PATH = path.join(ROOT, 'public', 'recap_solde_clients.json');

// Sheets to parse for bons
const SHEETS = [
  { name: 'SITUATION EXPORT 2025-2026', defaultTypeVente: "Export" },
  { name: 'SITUATION LOCAL 2025-2026 ', defaultTypeVente: null }, // use col 1 (Type)
];

// Extract variety from designation string
function extractVariety(designation) {
  if (!designation) return '';
  const d = designation.toUpperCase();
  const varieties = [
    'YAZMIN', 'REYNA', 'MARAVILLA', 'AITANA', 'ADELITA', 'ROCIERA',
    'BREEZE', 'CORINA', 'HASS', 'FUERTE', 'CASCADE',
  ];
  for (const v of varieties) {
    if (d.includes(v)) return v.charAt(0) + v.slice(1).toLowerCase();
  }
  const parts = designation.trim().split(/\s+/);
  if (parts.length >= 2) return parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase();
  return designation;
}

// Normalize ferme (F-05 -> F5, F-01 -> F1)
function normalizeFerme(ferme) {
  if (!ferme) return '';
  return String(ferme).replace('F-0', 'F').replace('F-', 'F').trim();
}

// Excel serial date to ISO string
function excelDateToISO(serial) {
  if (!serial) return '';
  if (typeof serial === 'string') return serial;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split('T')[0];
}

// Calculate semaine from date
function getSemaine(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - start) / 86400000);
  const week = Math.ceil((days + start.getDay() + 1) / 7);
  return `SEMAINE ${week}`;
}

function run() {
  const forceReimport = process.argv.includes('--force');

  // Parse Excel
  const wb = XLSX.readFile(EXCEL_PATH);
  const allParsed = [];

  // ===== 1. Parse BONS from EXPORT + LOCAL sheets =====
  for (const sheet of SHEETS) {
    const ws = wb.Sheets[sheet.name];
    if (!ws) { console.warn(`Sheet "${sheet.name}" introuvable`); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    for (const row of rows) {
      const bonNum = String(row[6] || '').trim();
      if (!bonNum || isNaN(parseInt(bonNum))) continue;

      const rowType = String(row[1] || '').trim();  // col 1 = Type (EXP, ECRT, DÉC, ENC)
      // Skip encaissement/décompte rows in LOCAL sheet
      if (rowType === 'ENC' || rowType === 'DÉC') continue;

      const semaine = String(row[0] || '').trim();
      const sousType = String(row[2] || '').trim();
      const client = String(row[3] || '').trim();
      const ferme = normalizeFerme(row[4]);
      const dateISO = excelDateToISO(row[5]);
      const designation = String(row[7] || '').trim();
      const poids = parseFloat(row[8]) || 0;
      const prixDH = parseFloat(row[9]) || 0;
      const totalDH = parseFloat(row[10]) || 0;
      const variete = extractVariety(designation);

      // Determine typeVente: Export (Driscoll's + EXP) or Marché Local (ECRT)
      let typeVente;
      if (sheet.defaultTypeVente) {
        typeVente = sheet.defaultTypeVente; // "Export" for export sheet
      } else {
        typeVente = rowType === 'ECRT' ? 'Marché Local' : rowType === 'EXP' ? 'Export' : rowType || 'LOCAL';
      }

      allParsed.push({
        bonApport: bonNum,
        date: dateISO,
        blocVariete: variete,
        blocFerme: ferme,
        blocLabel: designation,
        poidsLot: poids,
        prixDH: prixDH,
        totalDH: totalDH,
        sousType: sousType,
        confection: '',
        controleur: '',
        bloc: '',
        semaine: semaine || getSemaine(dateISO),
        client: client,
        designation: designation,
        typeVente: typeVente,
        pfqGlobal: null,
        barquettes: [],
        totalFruits: 0,
        source: 'bulk_upload',
        createdBy: 'Import Situation Production',
      });
    }
  }

  console.log(`Bons trouvés dans Excel: ${allParsed.length}`);

  // Count by typeVente
  const byType = {};
  allParsed.forEach(b => {
    if (!byType[b.typeVente]) byType[b.typeVente] = { count: 0, kg: 0, dh: 0 };
    byType[b.typeVente].count++;
    byType[b.typeVente].kg += b.poidsLot;
    byType[b.typeVente].dh += b.totalDH;
  });
  Object.entries(byType).forEach(([t, v]) =>
    console.log(`  ${t}: ${v.count} bons, ${Math.round(v.kg)} kg, ${Math.round(v.dh)} DH`)
  );

  // ===== 2. Parse ENCAISSEMENTS =====
  const encaissements = [];
  const encSheet = wb.Sheets['ENCAISEMENT'];
  if (encSheet) {
    const encRows = XLSX.utils.sheet_to_json(encSheet, { header: 1, defval: '' });
    let encIdx = 0;
    for (const row of encRows) {
      const rowType = String(row[1] || '').trim();
      if (rowType !== 'ENC') continue;
      const client = String(row[3] || '').trim();
      if (!client) continue;

      const semaine = String(row[0] || '').trim();
      const ferme = normalizeFerme(row[4]);
      const dateISO = excelDateToISO(row[5]);
      const bonNum = String(row[6] || '').trim();
      // Mouvement Des Soldes is in col 11
      const montant = parseFloat(row[11]) || 0;

      if (montant <= 0) continue;
      encIdx++;
      encaissements.push({
        id: `enc_${encIdx}`,
        client: client,
        date: dateISO,
        montant: montant,
        semaine: semaine,
        bonNum: bonNum,
        ferme: ferme,
        source: 'excel_import',
      });
    }
    console.log(`\nEncaissements trouvés: ${encaissements.length}`);
    const byClient = {};
    encaissements.forEach(e => {
      if (!byClient[e.client]) byClient[e.client] = 0;
      byClient[e.client] += e.montant;
    });
    Object.entries(byClient).forEach(([c, m]) => console.log(`  ${c}: ${Math.round(m)} DH`));
  } else {
    console.warn('Sheet "ENCAISEMENT" introuvable');
  }

  // ===== 3. Parse RECAP SOLDE PAR CLIENT =====
  const recapClients = [];
  const recapSheet = wb.Sheets['RECAP DE SOLDE PAR CLIENT '] || wb.Sheets['RECAP DE SOLDE PAR CLIENT'];
  if (recapSheet) {
    const recapRows = XLSX.utils.sheet_to_json(recapSheet, { header: 1, defval: '' });
    // Row 0 = title, Row 2 = headers (Clients, CA Cumulé, _, Enc Cumulé, _, Solde, Catégorie)
    // Data rows start at row 3, cols: 0=Client, 1=CA, 3=Enc, 5=Solde, 6=Catégorie
    for (const row of recapRows) {
      const client = String(row[0] || '').trim();
      if (!client || client === 'Clients' || client.startsWith('Récap')) continue;
      const caCumule = parseFloat(row[1]) || 0;
      const encCumule = parseFloat(row[3]) || 0;
      const solde = parseFloat(row[5]) || 0;
      const categorie = String(row[6] || '').trim();
      if (caCumule === 0 && encCumule === 0 && solde === 0) continue;
      recapClients.push({
        client: client,
        caCumule: Math.round(caCumule * 100) / 100,
        encaissementsCumule: Math.round(encCumule * 100) / 100,
        solde: Math.round(solde * 100) / 100,
        categorie: categorie,
      });
    }
    console.log(`\nRecap Solde par Client: ${recapClients.length} clients`);
    recapClients.forEach(c => console.log(`  ${c.client}: CA=${c.caCumule} DH, Enc=${c.encaissementsCumule} DH, Solde=${c.solde} DH`));
  } else {
    console.warn('Sheet "RECAP DE SOLDE PAR CLIENT" introuvable');
  }

  // ===== Write encaissements + recap (always, regardless of --force) =====
  encaissements.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  fs.writeFileSync(ENC_PATH, JSON.stringify(encaissements, null, 2));
  console.log(`\nEncaissements écrits: ${ENC_PATH} (${encaissements.length} entrées)`);

  fs.writeFileSync(RECAP_PATH, JSON.stringify(recapClients, null, 2));
  console.log(`Recap écrits: ${RECAP_PATH} (${recapClients.length} clients)`);

  // ===== Write bons =====
  if (forceReimport) {
    console.log('\n--force: Réimportation complète (remplacement du JSON)');
    const seen = new Set();
    const deduped = [];
    let idx = 0;
    for (const bon of allParsed) {
      const key = `${bon.bonApport}_${bon.designation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      idx++;
      deduped.push({
        id: `bulk_prod_${bon.bonApport}_${idx}`,
        ...bon,
        createdAt: new Date().toISOString(),
      });
    }
    deduped.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : (a.date || '') > (b.date || '') ? -1 : 0);
    fs.writeFileSync(JSON_PATH, JSON.stringify(deduped, null, 2));
    console.log(`\nFichier réécrit: ${JSON_PATH}`);
    console.log(`Total bons: ${deduped.length}`);
    return;
  }

  // Incremental mode
  let existing = [];
  if (fs.existsSync(JSON_PATH)) {
    existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  }
  console.log(`Bons existants: ${existing.length}`);

  const existingCompositeKeys = new Set(existing.map(b => `${b.bonApport}_${b.designation}`));
  const newBonsFinal = [];
  const seenComposite = new Set();
  let nextIdx = existing.length;

  for (const bon of allParsed) {
    const compositeKey = `${bon.bonApport}_${bon.designation}`;
    if (existingCompositeKeys.has(compositeKey)) continue;
    if (seenComposite.has(compositeKey)) continue;
    seenComposite.add(compositeKey);

    nextIdx++;
    newBonsFinal.push({
      id: `bulk_prod_${bon.bonApport}_${nextIdx}`,
      ...bon,
      createdAt: new Date().toISOString(),
    });
  }

  console.log(`Nouveaux bons à ajouter: ${newBonsFinal.length}`);

  if (newBonsFinal.length === 0) {
    console.log('Aucun nouveau bon à importer. Le fichier JSON est déjà à jour.');
    return;
  }

  const merged = [...existing, ...newBonsFinal];
  merged.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : (a.date || '') > (b.date || '') ? -1 : 0);

  fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2));
  console.log(`\nFichier mis à jour: ${JSON_PATH}`);
  console.log(`Total bons: ${merged.length} (${newBonsFinal.length} nouveaux ajoutés)`);
}

run();
