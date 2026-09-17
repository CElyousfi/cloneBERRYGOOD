/*
 * api-routes-declarees.test.js — toute route `/api/…` appelée par le front DOIT
 * exister dans les rewrites de firebase.json.
 *
 * ── POURQUOI CE TEST EXISTE ────────────────────────────────────────────────
 * Le 2026-08-22, l'enregistrement du coût de quinzaine appelait
 * `/api/pointage?action=cout-quinzaine-save`. Cette route n'existe pas : la
 * seule mappée vers `pointageV3` est `/api/pointage-rh`.
 *
 * Firebase ne rend pas 404 pour autant. Une URL non mappée retombe sur le SPA :
 * elle répond **200, avec index.html**. Côté client, `r.json()` lève sur du
 * HTML, le `catch` avale l'erreur, et il ne se passe strictement rien —
 * l'écran Campagne affichait « — » sans que rien, nulle part, ne signale que
 * l'appel partait dans le vide.
 *
 * C'est la pire forme d'échec : un 200 qui ne fait rien. Aucun test
 * fonctionnel ne l'attrape, puisque le code s'exécute sans erreur. Seule la
 * confrontation du code aux rewrites le voit.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '../..');

/** Toutes les `source` déclarées dans les rewrites de firebase.json. */
function routesDeclarees() {
  const conf = JSON.parse(fs.readFileSync(path.join(RACINE, 'firebase.json'), 'utf8'));
  const hostings = Array.isArray(conf.hosting) ? conf.hosting : [conf.hosting];
  const out = new Set();
  hostings.forEach((h) => {
    ((h && h.rewrites) || []).forEach((r) => { if (r && r.source) out.add(r.source); });
  });
  return out;
}

/** Fichiers SOURCE du front : tout src/modules (jamais le bundle, qui les dupliquerait). */
function fichiersFront() {
  return require('./_sources').listModuleFiles().slice();
}

test('toute route /api/ appelée par le front est déclarée dans firebase.json', () => {
  const declarees = routesDeclarees();
  const manquantes = new Map();

  fichiersFront().forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    // Les appels sont écrits en littéral : '/api/xxx?action=…'. On ne capture
    // que le segment de route, la query n'entre pas dans le rewrite.
    const re = /['"](\/api\/[a-zA-Z0-9_-]+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const route = m[1];
      if (declarees.has(route)) continue;
      if (!manquantes.has(route)) manquantes.set(route, new Set());
      manquantes.get(route).add(path.relative(RACINE, f));
    }
  });

  if (manquantes.size > 0) {
    // Message ACTIONNABLE : la route fautive et le fichier qui l'appelle. Sans
    // eux, on relit 68 000 lignes à la main.
    const lignes = [...manquantes.entries()].map(
      ([r, fs_]) => '  ' + r + '  ← ' + [...fs_].sort().join(', ')
    );
    assert.fail(
      'Route(s) /api/ appelée(s) mais NON déclarée(s) dans firebase.json :\n'
      + lignes.join('\n')
      + '\n\nUne route non mappée ne rend pas 404 : elle rend index.html avec un 200.\n'
      + '`r.json()` lève alors sur du HTML et l\'appel échoue en silence.\n'
      + 'Corriger la route côté front, ou ajouter le rewrite dans firebase.json.'
    );
  }
});

test('le garde-fou détecte bien une route inventée', () => {
  // Un test qui ne peut pas échouer ne protège rien. On vérifie que la
  // comparaison mord, plutôt que de faire confiance au fait qu'elle passe.
  const declarees = routesDeclarees();
  assert.ok(declarees.size > 0, 'aucun rewrite lu — le test ne vérifierait rien');
  assert.ok(!declarees.has('/api/route-qui-nexiste-pas'));
  // Et que la route réellement en cause ce jour-là serait bien refusée.
  assert.ok(!declarees.has('/api/pointage'), '/api/pointage n\'est pas mappée');
  assert.ok(declarees.has('/api/pointage-rh'), '/api/pointage-rh est la bonne route');
});
