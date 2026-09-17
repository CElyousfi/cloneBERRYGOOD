/**
 * remapLegacyTab.test.js — sous-lot 4.4 (fallback lastTab).
 *
 * Le tab legacy « Marché Local / Situation Clients » (fin_marche_local) a été
 * retiré du menu et remplacé par la vue read-only Comptes Clients de la Gestion
 * de Caisse. Pour garantir ZÉRO chemin de retour vers le legacy — y compris la
 * restauration du dernier onglet mémorisé (`localStorage.lastTab`) — app.jsx
 * applique un remap centralisé `remapLegacyTab` AVANT d'initialiser le tab :
 *   - fin_marche_local → 'caisse' (+ pose sessionStorage.caisseInitialSubTab =
 *     'caisse_comptes_clients' pour ouvrir directement le sous-onglet).
 *   - tout autre tab → inchangé.
 *
 * Ce test verrouille ce contrat. La logique étant inline dans le monolithe
 * public/app.jsx (pas de nouveau global browser pour éviter la collision de
 * scope — mémoire #75), on re-déclare ici une copie 1:1 de la fonction et on
 * vérifie son comportement + ses effets de bord (sessionStorage).
 *
 * Filet supplémentaire : on parse public/app.jsx pour confirmer que le code
 * embarqué applique bien le même mapping (fin_marche_local → 'caisse' +
 * caisseInitialSubTab) et que c'est branché sur la lecture de lastTab.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ---- Copie 1:1 de la logique inline app.jsx (~ligne du remap savedTab) -------
// sessionStorage minimal pour capter l'effet de bord.
function makeSessionStorage() {
  const store = {};
  return {
    setItem: (k, v) => { store[k] = String(v); },
    getItem: (k) => (k in store ? store[k] : null),
    removeItem: (k) => { delete store[k]; },
    _store: store,
  };
}

function remapLegacyTab(tab, sessionStorage) {
  if (tab === 'fin_marche_local') {
    try { sessionStorage.setItem('caisseInitialSubTab', 'caisse_comptes_clients'); } catch (e) {} // eslint-disable-line no-empty
    return 'caisse';
  }
  return tab;
}

test('remapLegacyTab — fin_marche_local → caisse', () => {
  const ss = makeSessionStorage();
  assert.equal(remapLegacyTab('fin_marche_local', ss), 'caisse');
});

test('remapLegacyTab — pose le hint sous-onglet Comptes Clients', () => {
  const ss = makeSessionStorage();
  remapLegacyTab('fin_marche_local', ss);
  assert.equal(ss.getItem('caisseInitialSubTab'), 'caisse_comptes_clients');
});

test('remapLegacyTab — tab non legacy inchangé, aucun hint posé', () => {
  const ss = makeSessionStorage();
  assert.equal(remapLegacyTab('caisse', ss), 'caisse');
  assert.equal(remapLegacyTab('dashboard', ss), 'dashboard');
  assert.equal(remapLegacyTab('fin_dashboard', ss), 'fin_dashboard');
  assert.equal(ss.getItem('caisseInitialSubTab'), null);
});

test('remapLegacyTab — simulation restauration lastTab=fin_marche_local', () => {
  // Reproduit la séquence d'init de app.jsx : lecture localStorage.lastTab,
  // remap, puis ré-écriture de la valeur persistée pour ne pas re-déclencher.
  const ss = makeSessionStorage();
  const localStore = { lastTab: 'fin_marche_local' };
  let savedTab = localStore.lastTab || 'dashboard';
  const remapped = remapLegacyTab(savedTab, ss);
  if (remapped !== savedTab) {
    savedTab = remapped;
    localStore.lastTab = savedTab; // écrase la valeur persistée
  }
  assert.equal(savedTab, 'caisse');
  assert.equal(localStore.lastTab, 'caisse'); // plus jamais fin_marche_local
  assert.equal(ss.getItem('caisseInitialSubTab'), 'caisse_comptes_clients');
});

// ---- Filet : le mapping est bien embarqué dans le monolithe app.jsx ----------
test('app.jsx embarque le remap fin_marche_local → caisse (+ hint)', () => {
  const src = require('./_sources').modulesSource();
  assert.match(src, /function remapLegacyTab/, 'helper remapLegacyTab présent');
  assert.match(
    src,
    /tab === 'fin_marche_local'/,
    'condition de remap legacy présente'
  );
  assert.match(
    src,
    /caisseInitialSubTab'\s*,\s*'caisse_comptes_clients'/,
    'pose du hint sous-onglet Comptes Clients'
  );
  // Branché sur la restauration du dernier onglet mémorisé.
  assert.match(
    src,
    /remapLegacyTab\(__savedTab\)/,
    'remap appliqué à la restauration de lastTab'
  );
});
