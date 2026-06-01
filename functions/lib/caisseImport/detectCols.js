'use strict'
// @ts-check

/**
 * Détecte les index de colonnes à partir de la ligne d'entête.
 * Logique déplacée bit-identique depuis functions/index.js (action import-excel-file).
 *
 * @param {Array<*>} h ligne d'entête (tableau de cellules)
 * @returns {{date:number,desc:number,debit:number,credit:number,fournisseur:number,numPiece:number,numFacture:number,ana1:number,ana2:number}}
 */
function detectCols(h) {
  const c = { date: 2, desc: 4, debit: 5, credit: 6, fournisseur: 8, numPiece: 9, numFacture: 11, ana1: 11, ana2: 12 }
  for (let j = 0; j < h.length; j++) {
    const cell = String(h[j] || '').toLowerCase().replace(/\s|\r|\n/g, '')
    if (cell.includes('désignation') || cell.includes('designation')) c.desc = j
    else if (cell.includes('débit') || cell === 'montantdebit' || cell.includes('debit')) c.debit = j
    else if (cell.includes('crédit') || cell.includes('credit')) c.credit = j
    else if (cell.includes('fournisseur') || cell.includes('beneficiaire')) c.fournisseur = j
    else if (cell.includes('piéce') || cell.includes('piece')) c.numPiece = j
    else if (cell.includes('facture')) c.numFacture = j
    else if (cell.includes('analytique1') || cell.includes('codeanalytique1')) c.ana1 = j
    else if (cell.includes('analytique2') || cell.includes('codeanalytique2')) c.ana2 = j
  }
  return c
}

module.exports = { detectCols }
