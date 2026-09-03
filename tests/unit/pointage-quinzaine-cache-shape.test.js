'use strict';

// Régression : le cache-warmer planifié `warmAllPointageCaches` (pubsub, every 10
// minutes) écrit dans la MÊME clé Firestore `pointage_quinzaine_latest` que le
// handler live de l'action "quinzaine" (profils DG/Finance/RH, sans ?periode).
// Bug corrigé le 2026-08-06 : le warmer ne calculait pas `periodeCampagne` (ni
// `parCulture`), donc toutes les 10 minutes il écrasait le cache partagé avec un
// payload INCOMPLET pendant tout son TTL (5 min) — cassant silencieusement le
// sélecteur "Campagne" (Affectation Analytique) qui dépend de periodeCampagne.
//
// Ce test est structurel (lecture du source), pas un test d'intégration Firestore
// (pointageService.js est un monolithe sans DI pour mocker Firestore/SQL — cf.
// TODO_REFACTO.md). Il garantit que les DEUX blocs "quinzaine" (warmer + handler
// live) retournent bien `periodeCampagne` dans leur objet, pour qu'une régression
// future (nouvelle divergence de forme entre les deux) soit détectée avant deploy.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = require('../helpers/backendSource').serviceSource('pointageService');

test('warmAllPointageCaches : le bloc warmer "4. Quinzaine (latest)" calcule periodeCampagne', () => {
  const warmerStart = SRC.indexOf('// 4. Quinzaine (latest)');
  assert.ok(warmerStart !== -1, 'bloc warmer "4. Quinzaine (latest)" introuvable');
  const warmerEnd = SRC.indexOf('// 4b. Quinzaine-analytique', warmerStart);
  assert.ok(warmerEnd !== -1, 'bloc warmer suivant introuvable (borne de fin)');
  const warmerBlock = SRC.slice(warmerStart, warmerEnd);

  assert.match(warmerBlock, /periodeCampagne/, 'le warmer doit calculer periodeCampagne');
  assert.match(
    warmerBlock,
    /return\s*\{[^}]*periodeCampagne[^}]*\}/s,
    'periodeCampagne doit être dans l\'objet retourné par le warmer'
  );
});

test('handler live action=quinzaine (USE_MIRROR) : periodeCampagne présent dans chacune des branches return', () => {
  const idx = SRC.indexOf('if (action === "quinzaine") {');
  assert.ok(idx !== -1, 'handler live action=quinzaine introuvable');
  // Fenêtre couvrant les branches USE_MIRROR (early-return / archive / mirror-direct
  // / SQL-direct-si-non-synced) — s'arrête avant le "=== FALLBACK SQL PATH ===" qui
  // est le chemin legacy non-mirror (USE_MIRROR=false), lequel n'a jamais inclus
  // periodeCampagne (hors scope de ce fix, USE_MIRROR est true en production).
  const fallbackSqlIdx = SRC.indexOf('=== FALLBACK SQL PATH ===', idx);
  assert.ok(fallbackSqlIdx !== -1, 'marqueur "FALLBACK SQL PATH" introuvable (borne de fin)');
  const block = SRC.slice(idx, fallbackSqlIdx);

  const lines = block.split('\n');
  const returnIdxs = lines.reduce((acc, l, i) => { if (/^\s*return \{/.test(l)) acc.push(i); return acc; }, []);
  assert.ok(returnIdxs.length >= 2, `au moins 2 branches "return {" attendues (empty/mirror-direct au minimum), trouvé ${returnIdxs.length}`);
  for (const i of returnIdxs) {
    // Le "return {...}" peut s'étaler sur plusieurs lignes (ex. branche archive) —
    // on regarde une fenêtre de 6 lignes après le début du return.
    const window = lines.slice(i, i + 6).join('\n');
    assert.match(window, /periodeCampagne/, `chaque branche return du handler live doit inclure periodeCampagne : ${lines[i].trim().slice(0, 100)}…`);
  }
});

test('warmer + handler live partagent la même dérivation buildPeriodeCampagne (source unique, pas de duplication ad hoc)', () => {
  // Les deux call sites doivent utiliser le helper pur partagé (déjà testé dans
  // campagnePeriodes.test.js) plutôt qu'une boucle inline dupliquée — garantit
  // qu'ils ne peuvent plus diverger silencieusement.
  const occurrences = SRC.match(/buildPeriodeCampagne\(meta\.periodeMap, campagneOf\)/g) || [];
  assert.strictEqual(
    occurrences.length,
    2,
    'buildPeriodeCampagne(meta.periodeMap, campagneOf) doit être utilisé aux 2 call sites (warmer + handler live)'
  );
});
