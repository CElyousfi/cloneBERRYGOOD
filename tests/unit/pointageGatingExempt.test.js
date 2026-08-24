'use strict';

// CONTRAT D'ACCÈS — tables d'exemption du gating paie (Étape 0) de pointageRH.
//
// Ces tests portent sur les VRAIES tables exportées par functions/pointageService.js
// (`GATING_EXEMPT_ACTIONS`, `EXEMPT_BUT_SCOPED`), pas sur des copies recopiées ici :
// dupliquer les listes ne protégerait rien, le test resterait vert pendant que la
// prod dérive.
//
// Ce qu'ils verrouillent :
//  1. les actions NON NOMINATIVES légitimement utilisées par le caporal et le
//     magasinier passent la barrière (sinon 403 avant toute lecture, avalé par le
//     `.catch()` client → écran silencieusement vide ou données périmées) ;
//  2. exempter du 403 ne doit PAS lever le CLOISONNEMENT ferme/culture d'un chef
//     sur les actions listées dans EXEMPT_BUT_SCOPED ;
//  3. les actions NOMINATIVES (matricules, noms, coûts) ne sont JAMAIS exemptées
//     et un profil `magasinier` s'y voit bien refuser l'accès ;
//  4. aucune action d'ÉCRITURE ne se retrouve dans les tables d'exemption.
//
// Régression n°1 couverte : `parcelles-campagne-list` était absente de la table.
// Le magasinier recevait un 403 sur le popup « Nouveau bon de consommation », la
// modale retombait sur /api/parcelles (historique BR_Consommation de la campagne
// PRÉCÉDENTE) et les parcelles de la campagne courante étaient introuvables.
//
// Régression n°2 couverte (introduite par le fix de la n°1, corrigée depuis) :
// une exemption « nue » saute TOUTE la résolution de périmètre, pas seulement le
// 403 → `_fermeFilter`/`_cultureFilter` restent null, les fetchers ne sont plus
// shadowés, et un chef_f5 recevait les parcelles de TOUTES les fermes/cultures.

const test = require('node:test');
const assert = require('node:assert');

const {
  GATING_EXEMPT_ACTIONS,
  EXEMPT_BUT_SCOPED,
  gatingRequiresPerimetre,
  resolveGatingFilters,
} = require('../../functions/pointageService');
const { resolvePerimetre } = require('../../functions/lib/valorisation/accessControl');
const { resolvePointageRHAccess } = require('../../functions/lib/auth/paieAccess');

/**
 * Rejoue le bloc de gating du handler pointageRH en appelant les VRAIES fonctions
 * de décision (`gatingRequiresPerimetre` / `resolveGatingFilters`). Rien n'est
 * réimplémenté ici : ce helper ne fait que câbler resolvePerimetre (qui, dans le
 * handler, est précédé de verifyAuth + resolveCallerProfile — de l'I/O) aux deux
 * fonctions pures. Muter la décision dans pointageService.js casse donc ces tests.
 *
 * @returns {{status:number, fermeFilter:(null|string), cultureFilter:(null|string),
 *            perimeterResolved:boolean}}
 *   perimeterResolved=false ⇒ le bloc entier est sauté (aucun verifyAuth).
 */
function gateDecision(action, callerProfile, fermeDemandee) {
  if (!gatingRequiresPerimetre(action)) {
    return { status: 200, fermeFilter: null, cultureFilter: null, perimeterResolved: false };
  }
  const perim = resolvePerimetre(callerProfile, fermeDemandee);
  const gate = resolveGatingFilters(action, perim);
  if (gate.denied) {
    return { status: 403, fermeFilter: null, cultureFilter: null, perimeterResolved: true };
  }
  return {
    status: 200,
    fermeFilter: gate.fermeFilter,
    cultureFilter: gate.cultureFilter,
    perimeterResolved: true,
  };
}

const MAGASINIER = { profileId: 'magasinier', role: 'user' };
const CHEF_F5 = { profileId: 'chef_f5', role: 'user' };
const CHEF_F1 = { profileId: 'chef_f1', role: 'user' };
const CHEF_BAHIA = { profileId: 'chef_bahia', role: 'user' };
const DG = { profileId: 'dg', role: 'user' };
const FINANCE = { profileId: 'finance', role: 'user' };
const ADMIN = { profileId: '', role: 'admin' };

const HISTORIQUES = ['suivi-tunnels', 'confection-types', 'referentiel-taches-list', 'sb-groupes-list'];
const NOMINATIVES = ['detail', 'postes-fixes', 'heures-sup', 'recolte-equipes', 'worker-detail', 'quinzaine-repos'];

test('les tables exportées sont bien des objets non vides (le test porte sur la vraie source)', () => {
  for (const t of [GATING_EXEMPT_ACTIONS, EXEMPT_BUT_SCOPED]) {
    assert.strictEqual(typeof t, 'object');
    assert.ok(t !== null);
    assert.ok(Object.keys(t).length > 0);
  }
});

// --- Listes blanches exhaustives : toute entrée future casse le test ---------

test('GATING_EXEMPT_ACTIONS : liste blanche exhaustive', () => {
  assert.deepStrictEqual(Object.keys(GATING_EXEMPT_ACTIONS).sort(), [
    'confection-types',
    'parcelles-campagne-list',
    'referentiel-taches-list',
    'sb-groupes-list',
    'suivi-tunnels',
  ]);
});

test('EXEMPT_BUT_SCOPED : liste blanche exhaustive', () => {
  assert.deepStrictEqual(Object.keys(EXEMPT_BUT_SCOPED).sort(), ['parcelles-campagne-list']);
});

test('EXEMPT_BUT_SCOPED est un SOUS-ENSEMBLE de GATING_EXEMPT_ACTIONS', () => {
  // Une action « scoped » mais non exemptée n'aurait aucun sens : elle
  // renverrait 403 avant d'atteindre le cloisonnement.
  for (const action of Object.keys(EXEMPT_BUT_SCOPED)) {
    assert.strictEqual(GATING_EXEMPT_ACTIONS[action], true, `${action} doit aussi être exemptée`);
  }
});

test('les 4 exemptions historiques ne sont PAS scoped (comportement caporal inchangé)', () => {
  for (const action of HISTORIQUES) {
    assert.notStrictEqual(EXEMPT_BUT_SCOPED[action], true, `${action} ne doit pas devenir scoped`);
  }
});

// --- Comportement 1 : magasinier sur parcelles-campagne-list ------------------

test('RÉGRESSION n°1 — magasinier / parcelles-campagne-list : pas de 403, liste complète', () => {
  assert.strictEqual(GATING_EXEMPT_ACTIONS['parcelles-campagne-list'], true);
  const d = gateDecision('parcelles-campagne-list', MAGASINIER);
  assert.strictEqual(d.status, 200, 'le magasinier ne doit plus prendre de 403');
  assert.strictEqual(d.fermeFilter, null, 'aucun filtre ferme → liste complète');
  assert.strictEqual(d.cultureFilter, null, 'aucun filtre culture → liste complète');
});

// --- Comportement 2 : chef_f5 reste cloisonné (le test qui manquait) ---------

test('RÉGRESSION n°2 — chef_f5 / parcelles-campagne-list : cloisonné F5 + Myrtille', () => {
  const d = gateDecision('parcelles-campagne-list', CHEF_F5);
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.fermeFilter, 'F5', 'le chef_f5 doit rester filtré sur SA ferme');
  assert.strictEqual(d.cultureFilter, 'Myrtille', 'le filtre culture du chef_f5 doit rester appliqué');
});

test('RÉGRESSION n°2 — le cloisonnement chef sur une action scoped est IDENTIQUE à une action non exemptée', () => {
  // Garantie centrale : l'exemption lève le 403, PAS le cloisonnement. Pour tout
  // profil autorisé, la décision doit être la même que sur une action nominative.
  for (const profil of [CHEF_F5, CHEF_F1, CHEF_BAHIA, DG, FINANCE, ADMIN]) {
    const scoped = gateDecision('parcelles-campagne-list', profil);
    const nominative = gateDecision('detail', profil);
    assert.deepStrictEqual(
      { f: scoped.fermeFilter, c: scoped.cultureFilter },
      { f: nominative.fermeFilter, c: nominative.cultureFilter },
      `cloisonnement divergent pour ${profil.profileId || profil.role}`,
    );
  }
});

test('chef_f1 (culture-only) / parcelles-campagne-list : fermeFilter null mais culture Framboise', () => {
  const d = gateDecision('parcelles-campagne-list', CHEF_F1);
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.fermeFilter, null);
  assert.strictEqual(d.cultureFilter, 'Framboise');
});

test('chef_bahia / parcelles-campagne-list : cloisonné BAHIA, sans filtre culture', () => {
  const d = gateDecision('parcelles-campagne-list', CHEF_BAHIA);
  assert.deepStrictEqual([d.fermeFilter, d.cultureFilter], ['BAHIA', null]);
});

test('un chef ne peut pas élargir son périmètre via ?ferme= sur une action scoped', () => {
  const d = gateDecision('parcelles-campagne-list', CHEF_F5, 'F1');
  assert.strictEqual(d.fermeFilter, 'F5', 'le ?ferme= du client est ignoré pour un chef');
});

// --- Comportement 3 : DG / finance / admin inchangés ------------------------

test('DG / finance / admin : aucun filtre sur parcelles-campagne-list (inchangé)', () => {
  for (const profil of [DG, FINANCE, ADMIN]) {
    const d = gateDecision('parcelles-campagne-list', profil);
    assert.strictEqual(d.status, 200);
    assert.strictEqual(d.fermeFilter, null);
    assert.strictEqual(d.cultureFilter, null);
  }
});

test('le DG garde l\'accès aux actions nominatives (aucune régression sur les profils légitimes)', () => {
  const d = gateDecision('detail', DG);
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.fermeFilter, null);
});

// --- Comportement 4 : exemptions historiques = bloc entièrement sauté --------

test('les 4 exemptions historiques ne passent PAS par la résolution de périmètre', () => {
  for (const action of HISTORIQUES) {
    assert.strictEqual(GATING_EXEMPT_ACTIONS[action], true, `${action} doit rester exemptée`);
    for (const profil of [MAGASINIER, CHEF_F5, DG]) {
      const d = gateDecision(action, profil);
      assert.strictEqual(d.perimeterResolved, false,
        `${action} ne doit pas réintroduire verifyAuth/resolvePerimetre pour ${profil.profileId || profil.role}`);
      assert.strictEqual(d.status, 200);
      assert.strictEqual(d.fermeFilter, null, `${action} : comportement caporal inchangé (aucun filtre)`);
      assert.strictEqual(d.cultureFilter, null);
    }
  }
});

// --- Comportement 5 : actions nominatives → 403 inchangé --------------------

test('les actions NOMINATIVES ne sont pas exemptées et renvoient 403 à un magasinier', () => {
  for (const action of NOMINATIVES) {
    assert.notStrictEqual(GATING_EXEMPT_ACTIONS[action], true, `${action} ne doit JAMAIS être exemptée`);
    assert.strictEqual(gateDecision(action, MAGASINIER).status, 403, `${action} doit rester refusée au magasinier`);
  }
});

test('les actions NOMINATIVES restent cloisonnées pour un chef_f5', () => {
  const d = gateDecision('detail', CHEF_F5);
  assert.deepStrictEqual([d.status, d.fermeFilter, d.cultureFilter], [200, 'F5', 'Myrtille']);
});

test('resolvePointageRHAccess refuse explicitement un profil magasinier', () => {
  const perim = resolvePerimetre(MAGASINIER);
  assert.strictEqual(perim.autorise, false);
  assert.deepStrictEqual(resolvePointageRHAccess(perim), { allowed: false, fermeFilter: null });
});

test('une action inconnue n\'est pas exemptée par accident (fail-closed, 403)', () => {
  assert.notStrictEqual(GATING_EXEMPT_ACTIONS['action-qui-nexiste-pas'], true);
  assert.strictEqual(gateDecision('action-qui-nexiste-pas', MAGASINIER).status, 403);
});

// --- Écritures ---------------------------------------------------------------

test('aucune action d\'ÉCRITURE n\'est exemptée (les writes gardent leur gate DG/RH)', () => {
  for (const action of [...Object.keys(GATING_EXEMPT_ACTIONS), ...Object.keys(EXEMPT_BUT_SCOPED)]) {
    assert.ok(
      !/-(save|delete|seed-ha|sync)/.test(action),
      `${action} ressemble à une écriture et ne doit pas être exemptée`,
    );
  }
  for (const write of ['sb-referentiel-save', 'sb-groupe-save', 'sb-groupe-delete', 'cout-quinzaine-save']) {
    assert.notStrictEqual(GATING_EXEMPT_ACTIONS[write], true, `${write} ne doit pas être exemptée`);
    assert.strictEqual(gateDecision(write, MAGASINIER).status, 403, `${write} doit rester refusée`);
  }
});
