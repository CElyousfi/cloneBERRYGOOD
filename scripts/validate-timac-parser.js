#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY ops script: validate the TIMAC invoice parser against the full
 * corpus of native-text PDFs. No Firestore, no writes, no email.
 *
 * Run from functions/:  node ../scripts/validate-timac-parser.js
 */

const fs = require('fs');
const path = require('path');
const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');
const { PDFParse } = require(path.join(FUNCTIONS_DIR, 'node_modules', 'pdf-parse'));
const { parseTimacInvoiceText } = require(path.join(FUNCTIONS_DIR, 'emailService'));

const DIR = '/Users/omarmaaouni/Desktop/berrygood-dashboard/docs/FACTURES/TIMAC/';

function fmt(n) {
  return (Math.round(n * 100) / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

(async () => {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();

  let nbNatives = 0;
  let nbHeaderComplete = 0;
  let nbReconcOk = 0;
  let totalLignes = 0;
  const sansLigne = [];
  const reconcFail = [];
  const codeDict = {};

  for (const f of files) {
    const buf = fs.readFileSync(path.join(DIR, f));
    let text = '';
    try {
      text = (await new PDFParse({ data: buf }).getText()).text || '';
    } catch (e) {
      text = '';
    }
    if (text && text.trim().length > 50) nbNatives++;

    const inv = parseTimacInvoiceText(text);

    if (inv.num_facture && inv.date_facture && inv.num_bcde) nbHeaderComplete++;

    if (!inv.lignes.length) {
      sansLigne.push(f);
    } else {
      totalLignes += inv.lignes.length;
    }

    for (const lg of inv.lignes) {
      if (lg.code_article && !codeDict[lg.code_article]) {
        codeDict[lg.code_article] = lg.designation;
      }
    }

    if (inv.reconciliation && inv.reconciliation.ok) {
      nbReconcOk++;
    } else {
      reconcFail.push({
        file: f,
        num_facture: inv.num_facture,
        somme_lignes: inv.reconciliation ? inv.reconciliation.somme_lignes : null,
        total_ht: inv.reconciliation ? inv.reconciliation.total_ht : null,
        ecart: inv.reconciliation ? inv.reconciliation.ecart : null,
      });
    }
  }

  const N = files.length;
  const pct = (x) => (N ? ((x / N) * 100).toFixed(1) : '0.0') + '%';

  console.log('========== BILAN PARSER TIMAC ==========');
  console.log('Factures PDF                 :', N);
  console.log('Natives texte                :', nbNatives, `(${pct(nbNatives)})`);
  console.log('En-têtes complets (fac+date+bcde):', nbHeaderComplete, `(${pct(nbHeaderComplete)})`);
  console.log('Total lignes extraites       :', totalLignes);
  console.log('Factures sans ligne (échec)  :', sansLigne.length);
  if (sansLigne.length) sansLigne.forEach((f) => console.log('    -', f));
  console.log('Réconciliation Σlignes==ΣHT  :', `${nbReconcOk}/${N}`, `(${pct(nbReconcOk)})`);
  console.log('Codes articles distincts     :', Object.keys(codeDict).length);
  console.log('');

  if (reconcFail.length) {
    console.log('--- Factures où la réconciliation échoue ---');
    for (const r of reconcFail) {
      console.log(
        `  ${r.file} | fac=${r.num_facture} | Σlignes=${r.somme_lignes != null ? fmt(r.somme_lignes) : 'n/a'} | ΣHT=${r.total_ht != null ? fmt(r.total_ht) : 'n/a'} | écart=${r.ecart != null ? fmt(r.ecart) : 'n/a'}`
      );
    }
    console.log('');
  }

  console.log('--- Dictionnaire code_article -> designation ---');
  Object.keys(codeDict)
    .sort()
    .forEach((c) => console.log(`  ${c}  ${codeDict[c]}`));
})();
