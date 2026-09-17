'use strict';
/* _sources — source concaténée de src/modules pour les tests « de contrat ».
 *
 * Plusieurs tests confrontent le source de production à ses invariants
 * (présence d'une garde, d'un câblage, d'un remap…) en cherchant des extraits
 * textuels. Ils lisaient public/app.jsx ; le monolithe n'existe plus et chaque
 * déclaration vit dans son propre fichier sous src/modules/. On leur sert la
 * concaténation de tous ces fichiers, dans un ordre déterministe : les
 * extraits sont inchangés (extraction à l'octet près), seules les bornes de
 * fichier se sont ajoutées entre eux.
 *
 * Pas un test : le script test:unit ne lance que les *.test.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const MODULES = path.join(ROOT, 'src/modules');

/** @type {string[]|null} */
let files = null;
/** @type {string|null} */
let source = null;

/** Tous les fichiers .js/.jsx de src/modules, triés par chemin. */
function listModuleFiles() {
  if (files) return files;
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(e.name)) out.push(full);
    }
  })(MODULES);
  files = out;
  return out;
}

/** Concaténation (fichiers séparés par un saut de ligne) — lue une seule fois. */
function modulesSource() {
  if (source === null) source = listModuleFiles().map(f => fs.readFileSync(f, 'utf8')).join('\n');
  return source;
}

/** Source d'UN fichier de src/modules (chemin relatif à src/modules). */
function moduleSource(rel) {
  return fs.readFileSync(path.join(MODULES, rel), 'utf8');
}

module.exports = { ROOT, MODULES, listModuleFiles, modulesSource, moduleSource };
