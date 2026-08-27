'use strict';

/**
 * ANTI-DIVERGENCE — les DEUX chemins de fusion choisissent la même fiche.
 *
 * ── POURQUOI CE FICHIER EXISTE ─────────────────────────────────────────────
 * Il testait la règle PROPRE à `scripts/lib/articleMasterPick.js` (`prix_pmp`
 * seul, puis `nb_achats`), pendant que la pop-up de fusion en appliquait une
 * autre (cascade `prix_pmp` -> `prix_ht` -> `nb_achats`). Mesuré sur les 105
 * groupes de production : les deux règles désignaient une fiche DIFFÉRENTE sur
 * 26 groupes (MEGAFOL EN 10L, CODACIDE OIL, ALGA600, TOUCHDAWN, SERGOMILE L60
 * EN 5L…), et chacune rendait `decided: true` — la divergence était
 * SILENCIEUSE. Scénario réel : Omar fusionne quelques groupes à l'écran, lance
 * le script pour le reste, et obtient des décisions contradictoires sur le
 * même catalogue.
 *
 * Ce fichier ne teste donc plus une règle (c'est le rôle de
 * articleMasterSuggestion.test.js) mais l'UNICITÉ de la règle : les trois
 * chemins — module pur, écran (via `groupDuplicates`) et script de fusion en
 * masse — désignent le même maître, pour tout groupe.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - `scripts/lib/articleMasterPick.js` reprend une règle locale ;
 *  - `groupDuplicates` cesse d'appeler la règle partagée.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = require('../../scripts/lib/articleMasterPick');
const MODULE = require('../../functions/lib/stockMerge/masterSuggestion');
const articleMerge = require('../../functions/lib/stockMerge/articleMerge');

/**
 * Fiche de test. Le docId (`id`) et le champ `reference` DIVERGENT
 * volontairement (espace inséré), comme sur les 92 fiches de production
 * concernées : c'est la seule façon de voir si un chemin confond les deux.
 */
const A = (id, extra) =>
  Object.assign({ id, reference: id + ' ', nom: 'Acide Phosphorique' }, extra || {});

/**
 * Groupes couvrant les trois niveaux de la cascade ET les refus, dont les 26
 * cas réels de divergence (PMP absent des deux côtés, HT contre nb_achats).
 */
const GROUPES = [
  [A('M', { prix_pmp: 12.5 }), A('D', { nb_achats: 40 })],
  [A('M', { prix_pmp: 12.5 }), A('D', { prix_ht: 74.38 })], // la divergence historique
  [A('HT', { prix_ht: 74.38 }), A('ACH', { nb_achats: 4 })], // MEGAFOL EN 10L
  [A('M', { nb_achats: 17 }), A('D', { nb_achats: 0 })],
  [A('A', { prix_pmp: 10 }), A('B', { prix_pmp: 42 })],
  [A('A', { prix_ht: 10 }), A('B', { prix_ht: 42 })],
  [A('A', { nb_achats: 3 }), A('B', { nb_achats: 9 })],
  [A('A'), A('B')],
  [A('A', { nb_achats: 2 }), A('B', { prix_pmp: 5 }), A('C', { nb_achats: 9 })],
  [A('A', { prix_pmp: 0, nb_achats: 8 }), A('B', { prix_ht: 3.2 })],
];

test('le module du script EST celui des Cloud Functions (ré-export, pas une copie)', () => {
  // Une copie dériverait en silence : c'est exactement ce qui s'est produit.
  assert.equal(SCRIPT, MODULE, 'scripts/lib/articleMasterPick doit ré-exporter le module pur');
  assert.equal(SCRIPT.choisirMaster, MODULE.choisirMaster);
});

test('scripts/lib/articleMasterPick.js ne contient AUCUNE règle locale', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../scripts/lib/articleMasterPick.js'),
    'utf8'
  );
  assert.match(src, /module\.exports = require\('\.\.\/\.\.\/functions\/lib\/stockMerge\/masterSuggestion'\)/);
  // Aucune lecture de champ de décision : la règle ne peut pas repousser ici.
  assert.doesNotMatch(src.replace(/^\s*\*.*$/gm, ''), /prix_pmp|prix_ht|nb_achats/);
});

test('écran et script désignent le MÊME maître, sur tous les cas de la cascade', () => {
  for (const groupe of GROUPES) {
    // Chemin script : appel direct du module ré-exporté.
    const viaScript = SCRIPT.choisirMaster(groupe);
    // Chemin écran : groupDuplicates -> suggest-article-duplicates -> pop-up.
    const groupes = articleMerge.groupDuplicates(groupe.map((a) => Object.assign({}, a, { active: true })));
    assert.equal(groupes.length, 1, 'le groupe doit être détecté comme doublon');
    const viaEcran = groupes[0];

    const quoi = groupe.map((a) => a.id).join('+');
    assert.equal(viaEcran.decidable, viaScript.decidable, 'décidabilité divergente : ' + quoi);
    assert.equal(viaEcran.master_suggere, viaScript.master_ref, 'maître divergent : ' + quoi);
    assert.equal(viaEcran.raison, viaScript.raison, 'raison divergente : ' + quoi);
    // Le script fusionne sur le docId : il doit pointer la même fiche, et
    // l'écran doit envoyer CE docId, jamais le champ `reference`.
    if (viaScript.decidable) {
      assert.equal(viaScript.master.id, viaEcran.master_suggere, 'docId divergent : ' + quoi);
      assert.notEqual(
        viaEcran.master_suggere,
        viaScript.master.reference,
        'l’écran adresse par `reference` : la fusion viserait un autre document (' + quoi + ')'
      );
    }
  }
});

test('le script consomme la NOUVELLE API du module partagé', () => {
  // Sans cela, `pick.decided`/`pick.master` seraient `undefined` : le script
  // sauterait toutes les fusions en silence, ou planterait à l'exécution.
  const src = fs.readFileSync(
    path.join(__dirname, '../../scripts/merge-article-duplicates.js'),
    'utf8'
  );
  assert.match(src, /const pick = choisirMaster\(articles\)/);
  assert.match(src, /if \(pick\.decidable\)/);
  // Master ET doublons adressés par le docId. Les deux appels (preview et
  // execute) sont vérifiés : `merge-articles` résout par `.doc(<clé>)`, et le
  // champ `reference` pointe des documents fantômes sur 5 des 105 groupes.
  assert.equal((src.match(/master_ref: pick\.master\.id/g) || []).length, 1);
  assert.equal((src.match(/master_ref: g\.pick\.master\.id/g) || []).length, 1);
  assert.equal((src.match(/doublon_refs: pick\.doublons\.map\(\(d\) => d\.id\)/g) || []).length, 1);
  assert.equal((src.match(/doublon_refs: g\.pick\.doublons\.map\(\(d\) => d\.id\)/g) || []).length, 1);
  assert.doesNotMatch(src, /master_ref: [\w.]*pick\.master\.reference/);
  assert.doesNotMatch(src, /doublon_refs: [\w.]*pick\.doublons\.map\(\(d\) => d\.reference\)/);
  // Les anciens noms ne doivent subsister nulle part (ils rendraient undefined).
  for (const mort of ['pickMaster(', '.decided', '.pick.rule', '.pick.reason', 'pmpOf(', 'nbAchatsOf(']) {
    assert.equal(src.includes(mort), false, 'API morte encore utilisée : ' + mort);
  }
});

test('les trois niveaux de la cascade sont nommés de la même façon des deux côtés', () => {
  assert.equal(SCRIPT.REGLE_PMP, 'prix_pmp');
  assert.equal(SCRIPT.REGLE_PRIX_HT, 'prix_ht');
  assert.equal(SCRIPT.REGLE_NB_ACHATS, 'nb_achats');
  // La synthèse du script compte les groupes par ces constantes : une valeur
  // qui change sans que le script suive afficherait « 0 groupe tranché ».
  const src = fs.readFileSync(
    path.join(__dirname, '../../scripts/merge-article-duplicates.js'),
    'utf8'
  );
  assert.match(src, /g\.pick\.regle === REGLE_PMP/);
  assert.match(src, /g\.pick\.regle === REGLE_PRIX_HT/);
  assert.match(src, /g\.pick\.regle === REGLE_NB_ACHATS/);
});
