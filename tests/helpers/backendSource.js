'use strict';

/**
 * backendSource.js — le SOURCE du backend, concaténé.
 *
 * Le backend n'est plus un monolithe : `functions/index.js` est devenu un barrel
 * de re-export, et la logique vit dans `functions/src/modules/**`. Les tests qui
 * raisonnent sur le TEXTE du backend — parce qu'une Cloud Function n'est pas
 * importable isolément — lisaient `functions/index.js` ; ils lisent désormais
 * l'ensemble des fichiers backend, concaténés dans un ordre stable.
 *
 * Leurs assertions sont inchangées : c'est la même matière, répartie autrement.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function backendSource() {
  const srcDir = path.join(ROOT, 'functions', 'src');
  // Les MODULES d'abord, le barrel ensuite. Un test qui decoupe le source a
  // partir de `exports.<nom>` doit tomber sur le HANDLER, pas sur la ligne de
  // re-export du barrel — qui n'a pas de corps et donnerait une tranche vide.
  const files = [];
  if (fs.existsSync(srcDir)) files.push(...walk(srcDir));
  files.push(path.join(ROOT, 'functions', 'index.js'));
  return files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
}

/**
 * Le source d'un service backend eclate en plusieurs fichiers.
 *
 * `pointageService.js` etait un monolithe ; il vit maintenant dans
 * pointageService.js + .part*.js + .actions*.js. Les tests qui lisaient le
 * fichier unique lisent cette concatenation — meme matiere, repartie autrement.
 *
 * @param {string} base nom de base, ex. 'pointageService'
 */
function serviceSource(base) {
  const dir = path.join(ROOT, 'functions');
  const files = fs.readdirSync(dir)
    .filter(f => f === base + '.js' || f.startsWith(base + '.'))
    .filter(f => f.endsWith('.js'))
    .sort((a, b) => {
      // le fichier principal en DERNIER : un test qui decoupe a partir de
      // `exports.<nom>` doit tomber sur le handler, pas sur une re-export.
      if (a === base + '.js') return 1;
      if (b === base + '.js') return -1;
      return a.localeCompare(b);
    });
  return files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

module.exports = { backendSource, serviceSource };
