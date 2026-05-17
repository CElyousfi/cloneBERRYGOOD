/**
 * meteoCalc.js — Pure helpers for the Agronomie > Météo "Prévision extérieure" block.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/meteoCalc.js"> → exposes window.MeteoCalc
 *   - In node:test via require('./meteoCalc.js') → exposes module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore).
 */
// @ts-check
'use strict';

/**
 * Saturation vapor pressure (kPa) at temperature T (°C) — Tetens equation.
 * @param {number} t °C
 * @returns {number} kPa
 */
function saturationVaporPressure(t) {
  return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

/**
 * Vapor Pressure Deficit (kPa) for one (T, RH) pair.
 * @param {number} t °C
 * @param {number} rh % (0–100)
 * @returns {number} kPa, clamped to >= 0
 */
function vpdAt(t, rh) {
  if (t == null || rh == null || isNaN(t) || isNaN(rh)) return 0;
  const es = saturationVaporPressure(t);
  const ea = es * (rh / 100);
  const vpd = es - ea;
  return vpd < 0 ? 0 : vpd;
}

/**
 * Hourly VPD (kPa) from parallel temperature (°C) and relative humidity (%) arrays.
 * @param {number[]} tempArr
 * @param {number[]} rhArr
 * @returns {number[]}
 */
function computeHourlyVPD(tempArr, rhArr) {
  if (!Array.isArray(tempArr) || !Array.isArray(rhArr)) return [];
  const n = Math.min(tempArr.length, rhArr.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = vpdAt(Number(tempArr[i]), Number(rhArr[i]));
  return out;
}

/**
 * Cumulative shortwave radiation expressed in J/cm² from hourly W/m² values.
 *
 * Conversion: 1 W/m² over 1 h = 3600 J/m² = 3600 / 10000 J/cm² = 0.36 J/cm².
 *
 * @param {number[]} swArr Hourly shortwave radiation in W/m²
 * @returns {number[]} Cumulative J/cm² (same length as input)
 */
function computeCumRadiation(swArr) {
  if (!Array.isArray(swArr)) return [];
  const out = new Array(swArr.length);
  let acc = 0;
  for (let i = 0; i < swArr.length; i++) {
    const v = Number(swArr[i]);
    if (!isNaN(v) && v > 0) acc += v * 0.36;
    out[i] = acc;
  }
  return out;
}

/**
 * Index (and value) of the maximum entry in an array. Returns {idx:-1,val:null} if empty.
 * @param {number[]} arr
 * @returns {{idx:number,val:number|null}}
 */
function peakIndex(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return { idx: -1, val: null };
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = Number(arr[i]);
    if (!isNaN(v) && v > bestVal) { bestVal = v; bestIdx = i; }
  }
  return { idx: bestIdx, val: bestVal === -Infinity ? null : bestVal };
}

const __meteoApi = {
  saturationVaporPressure, vpdAt, computeHourlyVPD, computeCumRadiation, peakIndex,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __meteoApi;
if (typeof window !== 'undefined') window.MeteoCalc = __meteoApi;
