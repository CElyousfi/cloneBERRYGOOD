/**
 * imageDownscale.js — Réduction d'une photo AVANT envoi au backend.
 *
 * Motivation : le flux « Scanner des Bons d'Apport » envoie les photos brutes
 * en base64 (3–8 Mo par image) → uploads lents et 413 sur mobile. Ce helper
 * ramène le plus grand côté à `maxSide` px et ré-encode en JPEG.
 */
// @ts-check
/** @typedef {{ width: number, height: number, scaled: boolean }} TargetSize */

var IMGDS_DEFAULT_MAX_SIDE = 2000;
var IMGDS_DEFAULT_QUALITY = 0.8;

/**
 * Taille cible d'une image pour un plus grand côté <= maxSide (ratio gardé).
 * Fonction PURE — testée dans tests/unit/imageDownscale.test.js.
 * @param {number} width
 * @param {number} height
 * @param {number} maxSide
 * @returns {TargetSize}
 */
function computeTargetSize(width, height, maxSide) {
  var w = Number(width) || 0;
  var h = Number(height) || 0;
  var max = Number(maxSide) || IMGDS_DEFAULT_MAX_SIDE;
  if (w <= 0 || h <= 0 || max <= 0) return { width: w, height: h, scaled: false };
  var longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h, scaled: false };
  var ratio = max / longest;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}

/**
 * Lit un File/Blob en data URL brute (fallback si le canvas échoue).
 * @param {Blob} file
 * @returns {Promise<string>}
 */
function readAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    try {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(String(e.target.result || '')); };
      reader.onerror = function () { reject(new Error('Lecture du fichier impossible')); };
      reader.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Réduit une image et renvoie une data URL JPEG.
 * Ne redimensionne pas une image déjà plus petite que `maxSide` (mais la
 * ré-encode quand même en JPEG pour normaliser le format et le poids).
 * Tout échec (canvas indisponible, image illisible, toDataURL bloqué) tombe
 * en fallback sur la data URL brute : on n'empêche JAMAIS l'envoi.
 *
 * @param {Blob} file
 * @param {{ maxSide?: number, quality?: number }} [opts]
 * @returns {Promise<string>} data URL (JPEG si le canvas a fonctionné)
 */
function downscaleToDataUrl(file, opts) {
  var options = opts || {};
  var maxSide = options.maxSide || IMGDS_DEFAULT_MAX_SIDE;
  var quality = typeof options.quality === 'number' ? options.quality : IMGDS_DEFAULT_QUALITY;
  if (!file) return Promise.reject(new Error('Aucun fichier'));

  return readAsDataUrl(file).then(function (dataUrl) {
    if (!dataUrl) throw new Error('Fichier vide');
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (value) { if (!done) { done = true; resolve(value); } };
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var target = computeTargetSize(img.naturalWidth || img.width, img.naturalHeight || img.height, maxSide);
            if (!target.width || !target.height) { finish(dataUrl); return; }
            var canvas = document.createElement('canvas');
            canvas.width = target.width;
            canvas.height = target.height;
            var ctx = canvas.getContext('2d');
            if (!ctx) { finish(dataUrl); return; }
            ctx.drawImage(img, 0, 0, target.width, target.height);
            var out = canvas.toDataURL('image/jpeg', quality);
            finish(out && out.indexOf('data:image') === 0 ? out : dataUrl);
          } catch (e) {
            finish(dataUrl);
          }
        };
        img.onerror = function () { finish(dataUrl); };
        img.src = dataUrl;
      } catch (e) {
        finish(dataUrl);
      }
    });
  });
}

export { computeTargetSize, downscaleToDataUrl };
