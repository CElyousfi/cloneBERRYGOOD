'use strict'
// @ts-check

/**
 * Convertit une valeur de cellule date Excel (serial number ou string) en ISO YYYY-MM-DD.
 * Logique déplacée bit-identique depuis functions/index.js (action import-excel-file).
 * XLSX est injecté en paramètre pour rester pur et testable.
 *
 * @param {number|string|Date|null|undefined} serial
 * @param {{ SSF: { parse_date_code: function(number): ({y:number,m:number,d:number}|null) } }} XLSX
 * @returns {string|null} date ISO YYYY-MM-DD, ou null si non parsable
 */
function excelToISO(serial, XLSX) {
  if (!serial && serial !== 0) return null
  if (typeof serial === 'string') {
    const d = new Date(serial)
    return isNaN(d) ? null : d.toISOString().slice(0, 10)
  }
  const p = XLSX.SSF.parse_date_code(serial)
  if (!p) return null
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

module.exports = { excelToISO }
