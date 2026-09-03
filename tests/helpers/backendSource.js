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

module.exports = { backendSource };
