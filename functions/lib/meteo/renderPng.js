'use strict';
// @ts-check
/**
 * renderPng.js — SVG → PNG. SEUL module du domaine météo à toucher une
 * dépendance native (`@resvg/resvg-js`, binaires Rust précompilés, aucune
 * librairie système requise). Tout le reste (sprayChart, sprayDigest) reste
 * testable sans binaire.
 *
 * ⚠️ PIÈGE MAJEUR — LE RUNTIME CLOUD FUNCTIONS N'A AUCUNE POLICE.
 * Si on ne fournit pas explicitement un fichier de police à resvg, le PNG sort
 * SANS AUCUN TEXTE et SANS LEVER D'ERREUR : le rendu « réussit », le graphique
 * part chaque matin muet, et rien ne le signale. D'où :
 * - une police libre committée dans `functions/assets/` (cf. le fichier de
 *   licence voisin) ;
 * - `loadSystemFonts: false` PAR DÉFAUT, y compris en local : sans ça, macOS
 *   prête ses polices système et les tests passeraient au vert sur une
 *   configuration qui échoue en prod ;
 * - un `throw` explicite si le fichier de police est introuvable ;
 * - un test de non-régression qui compare le rendu d'un SVG avec texte et
 *   d'un SVG sans texte (cf. __tests__/renderPng.test.js).
 */

const fs = require('fs');
const path = require('path');

/** MIME d'un PNG — utilisé pour `uploadMedia` côté WhatsApp. */
const PNG_MIME = 'image/png';

/** Police embarquée. Chemin absolu : le CWD d'une Cloud Function n'est pas garanti. */
const FONT_PATH = path.join(__dirname, '..', '..', 'assets', 'DejaVuSans.ttf');

/** Nom de famille de la police embarquée, tel que resvg le lit dans le .ttf. */
const DEFAULT_FONT_FAMILY = 'DejaVu Sans';

/** Largeur de rendu par défaut : 900 px de viewBox rendus à 1200 px (≈1.33×). */
const DEFAULT_WIDTH = 1200;

/**
 * Options resvg, extraites pour être vérifiables sans binaire natif.
 * @param {{width?: number, fontPath?: string, loadSystemFonts?: boolean}} [opts]
 * @returns {object}
 */
function buildResvgOptions(opts) {
  const o = opts || {};
  const fontPath = o.fontPath || FONT_PATH;
  if (!fs.existsSync(fontPath)) {
    // Sans ce garde-fou, resvg rendrait un PNG parfaitement valide et
    // parfaitement muet. Mieux vaut échouer bruyamment.
    throw new Error('renderPng: police introuvable (' + fontPath + ') — le PNG sortirait sans texte');
  }
  return {
    fitTo: { mode: 'width', value: o.width || DEFAULT_WIDTH },
    font: {
      fontFiles: [fontPath],
      loadSystemFonts: o.loadSystemFonts === true,
      defaultFontFamily: DEFAULT_FONT_FAMILY,
    },
  };
}

/**
 * Rend un SVG en PNG.
 *
 * @param {string} svg Document SVG complet.
 * @param {{width?: number, fontPath?: string, loadSystemFonts?: boolean, Resvg?: Function}} [opts]
 *   `Resvg` permet d'injecter un double dans les tests qui n'ont pas besoin du
 *   binaire ; en prod le module natif est chargé paresseusement ici.
 * @returns {Buffer}
 * @throws {Error} SVG vide, police manquante, ou échec du rendu natif.
 */
function renderSvgToPng(svg, opts) {
  const o = opts || {};
  if (typeof svg !== 'string' || !svg.trim()) {
    throw new Error('renderPng: SVG vide');
  }
  const options = buildResvgOptions(o);
  // Chargement paresseux : `require` en tête de fichier ferait payer le binaire
  // natif à TOUTES les Cloud Functions du monolithe `functions/index.js`.
  const Resvg = o.Resvg || require('@resvg/resvg-js').Resvg;
  const png = new Resvg(svg, options).render().asPng();
  const buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);
  if (!buffer.length) throw new Error('renderPng: PNG vide');
  return buffer;
}

module.exports = {
  PNG_MIME,
  FONT_PATH,
  DEFAULT_FONT_FAMILY,
  DEFAULT_WIDTH,
  buildResvgOptions,
  renderSvgToPng,
};
