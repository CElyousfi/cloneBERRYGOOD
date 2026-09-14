// @ts-check
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Garde contre la régression trouvée le 2026-09-14 (production readiness) :
 * la refonte de pointageRH en dispatch (commit 8a7284c, "éclater
 * pointageService.js") a laissé le fallback `res.status(400) "Unknown
 * action"` AVANT la boucle de dispatch au lieu d'APRÈS — chaque appel
 * renvoyait donc 400 quelle que soit l'action, le corps des 48 handlers
 * (pointageService.actions1-4.js) étant du code mort inatteignable.
 * Confirmé cassé/réparé en direct via l'émulateur Firebase (pointageRH,
 * actions summary/suivi-tunnels/confection-types/sb-referentiel-list).
 *
 * Ces tests sont statiques (pas d'émulateur, pas de Firestore) : ils
 * verrouillent la FORME du code plutôt que son comportement runtime, pour
 * rester rapides et hors-ligne comme le reste de la suite. Le comportement
 * runtime a été vérifié manuellement avec `firebase emulators:exec`.
 */

const FUNCTIONS_DIR = path.join(__dirname, '..', '..', 'functions');

test('pointageRH : le fallback "Unknown action" est APRÈS la boucle de dispatch, pas avant', () => {
  const src = fs.readFileSync(path.join(FUNCTIONS_DIR, 'pointageService.js'), 'utf8');
  const loopIdx = src.indexOf('for (const __handle of __actions)');
  const fallbackIdx = src.indexOf('res.status(400).json({ success: false, error: "Unknown action: " + action })');
  assert.ok(loopIdx > -1, 'la boucle de dispatch __actions doit exister');
  assert.ok(fallbackIdx > -1, 'le fallback "Unknown action" doit exister');
  assert.ok(
    fallbackIdx > loopIdx,
    'le fallback 400 doit venir APRÈS la boucle de dispatch — sinon TOUTE action renvoie 400 ' +
    'et les handlers de pointageService.actions1-4.js sont du code mort inatteignable (régression du 2026-09-03).'
  );
});

test('pointageRH : aucun `return` (autre que le fallback final) ne précède la boucle de dispatch', () => {
  const src = fs.readFileSync(path.join(FUNCTIONS_DIR, 'pointageService.js'), 'utf8');
  const loopIdx = src.indexOf('for (const __handle of __actions)');
  assert.ok(loopIdx > -1);
  // Zone entre le début du handler HTTPS et la boucle : seuls les `return` de
  // gating (403) sont légitimes ; un `return res.status(...)` inconditionnel
  // supplémentaire y court-circuiterait de nouveau tout le dispatch.
  const handlerStart = src.indexOf('exports.pointageRH = functions');
  const zone = src.slice(handlerStart, loopIdx);
  const returns = zone.match(/\breturn res\.status\(/g) || [];
  assert.strictEqual(
    returns.length, 1,
    `un seul \`return res.status(...)\` est attendu avant la boucle (le 403 de gating) ; ` +
    `trouvé ${returns.length} — un retour inconditionnel supplémentaire rendrait le dispatch mort.`
  );
});

test('pointageService.actions{1..4}.js : les noms partagés (withCache, USE_MIRROR, pointageCacheKey, db_firestore...) sont bien requis, pas des variables libres', () => {
  // Régression trouvée en même temps que la précédente : les corps "verbatim"
  // de pointageService.actions1-4.js utilisent des dizaines de noms qui
  // vivaient dans le scope englobant du monolithe d'origine (withCache,
  // USE_MIRROR, pointageCacheKey, db_firestore, admin, cors, sql, sqlConfig...)
  // mais aucun de ces 4 fichiers ne les importait — ReferenceError au premier
  // appel touchant ces noms (ex. "withCache is not defined", confirmé en
  // direct sur l'action suivi-tunnels avant correctif).
  const criticalNames = ['withCache', 'USE_MIRROR', 'pointageCacheKey', 'db_firestore', 'admin', 'cors'];
  for (let n = 1; n <= 4; n++) {
    const file = `pointageService.actions${n}.js`;
    const src = fs.readFileSync(path.join(FUNCTIONS_DIR, file), 'utf8');
    const usesAny = criticalNames.some((name) => new RegExp(`[^.\\w]${name}\\s*\\(`).test(src) || new RegExp(`[^.\\w]${name}\\b`).test(src));
    if (!usesAny) continue; // ce fichier n'utilise aucun de ces noms, rien à vérifier
    assert.ok(
      /require\(["']\.\/pointageService\.part1["']\)/.test(src),
      `${file} référence des noms partagés (withCache/USE_MIRROR/...) mais ne require() plus ` +
      `"./pointageService.part1" — ils redeviendraient des variables libres (ReferenceError au runtime).`
    );
    // Le require doit être PARESSEUX (dans le corps de la fonction), pas en tête de fichier :
    // pointageService.part1.js require() ces 4 fichiers pour construire __actions, donc un
    // require top-level ici créerait un cycle et recevrait un module.exports encore vide.
    const topOfFile = src.slice(0, src.indexOf('module.exports'));
    assert.ok(
      !/require\(["']\.\/pointageService\.part1["']\)/.test(topOfFile),
      `${file} : le require de "./pointageService.part1" doit être PARESSEUX (à l'intérieur de la ` +
      `fonction exportée), jamais en tête de fichier — pointageService.part1.js require() ce fichier ` +
      `pour construire __actions, un require top-level ici recevrait un exports vide (cycle).`
    );
  }
});
