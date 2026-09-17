'use strict';

// Pop-ups « Heures Supplémentaires » et « Charges Sociales » de l'écran
// Quinzaine : la colonne Ouvrier affichait le MATRICULE dès que l'ouvrier
// n'avait pas de fiche dans `quinzRegistry`.
//
// `quinzRegistry` vient de `ouvriers_registry`, qui est le registre de PAIE :
// ses documents ne naissent que d'un import de déclarés, d'une baseline ou
// d'une prime. Un saisonnier jamais déclaré ni primé n'y a donc AUCUNE fiche —
// cas normal et fréquent. Le nom, lui, est déjà côté client sur chaque ligne de
// pointage (`nom`, propagé depuis `Personnel_Nom`), et `_moRows` n'est fait que
// de ces lignes-là : tout ouvrier listé dans les pop-ups y a un nom.
//
// `public/app.jsx` est un monolithe non importable (React via CDN, pas de
// bundler) : même approche que campagneAnalytiqueDetailNbOuv.test.js — on lit
// le source, on EXTRAIT les blocs concernés et on les EXÉCUTE dans un vm avec
// des dépendances stubbées. Le comportement est donc prouvé, pas seulement la
// présence d'un identifiant.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { moduleSource } = require('./_sources');
// L'écran Quinzaine : le helper de nommage y est déclaré, puis passé en prop
// aux deux pop-ups, chacune dans son propre fichier.
const SRC = moduleSource('rh/QuinzaineTab.jsx');

/** Découpe [début, fin) du source, bornes vérifiées. */
function slice(startMarker, endMarker, label) {
  const i = SRC.indexOf(startMarker);
  assert.ok(i !== -1, label + ' : borne de début introuvable');
  const j = SRC.indexOf(endMarker, i);
  assert.ok(j !== -1, label + ' : borne de fin introuvable');
  return SRC.slice(i, j + endMarker.length);
}

// Le helper partagé de nommage (registre + repli pointage).
const HELPER = slice(
  'const _nomPointageParMat = {};',
  'return window.nomOuvrier(reg.prenom, reg.nom || _nomPointageParMat[k], mat) || mat;\n            };',
  'helper _nomOuvrierQz'
);

// `nomOuvrier` lui-même, réutilisé tel quel : le test doit voir la vraie règle
// « le nom porte déjà le prénom », pas une réécriture qui divergerait.
const NOM_OUVRIER = (function () {
  const src = moduleSource('rh/nomOuvrier.jsx');
  const start = 'function nomOuvrier(prenom, nom, secours) {';
  const end = 'return dejaDedans ? n : (p + \' \' + n);\n        }';
  const i = src.indexOf(start);
  assert.ok(i !== -1, 'fonction nomOuvrier : borne de début introuvable');
  const j = src.indexOf(end, i);
  assert.ok(j !== -1, 'fonction nomOuvrier : borne de fin introuvable');
  return src.slice(i, j + end.length);
})();

/** Exécute le helper extrait et renvoie sa fonction de nommage. */
function makeNomFn(moRows, registry) {
  const sandbox = {
    _moRows: moRows,
    quinzRegistry: registry,
    numKey: (m) => String(m || '').replace(/\D/g, ''),
    window: {},
    out: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    NOM_OUVRIER + '\nwindow.nomOuvrier = nomOuvrier;\n' +
      '(function () {\n' + HELPER + '\nout = _nomOuvrierQz;\n})();',
    sandbox
  );
  return sandbox.out;
}

const ROWS = [
  { matricule: 'ZZ11451', nom: 'BENALI SAID', jour: '2026-08-01' },
  // Deuxième ligne du même ouvrier, nom vide : ne doit pas écraser le premier.
  { matricule: 'ZZ11451', nom: '', jour: '2026-08-02' },
  { matricule: 'ZY11472', nom: 'EL OUALI LAHSEN', jour: '2026-08-01' },
  { matricule: 'DD11102', nom: '   ', jour: '2026-08-01' },
  { matricule: '', nom: 'SANS MATRICULE', jour: '2026-08-01' },
];

test('ouvrier absent du registre de paie : le nom du pointage est affiché', () => {
  // Le cas signalé : ZZ11451 & co n'ont pas de fiche `ouvriers_registry`.
  const nom = makeNomFn(ROWS, {});
  assert.strictEqual(nom('ZZ11451'), 'BENALI SAID');
});

test('le prénom du registre est CONSERVÉ quand seul son nom manque', () => {
  // Motif canonique `reg.nom || nomPointage` : mettre le nom de pointage en 3e
  // argument (secours) perdrait ce prénom, `nomOuvrier` ne s'y rabattant que
  // lorsque prénom ET nom sont vides.
  const nom = makeNomFn(ROWS, { 11451: { prenom: 'AYOUB' } });
  assert.strictEqual(nom('ZZ11451'), 'AYOUB BENALI SAID');
});

test('fiche de registre complète : elle prime, rien ne change pour les déclarés', () => {
  const nom = makeNomFn(ROWS, { 11472: { prenom: 'LAHSEN', nom: 'EL OUALI LAHSEN' } });
  assert.strictEqual(nom('ZY11472'), 'EL OUALI LAHSEN');
});

test('ni registre ni nom de pointage : repli sur le matricule, jamais vide', () => {
  const nom = makeNomFn(ROWS, {});
  assert.strictEqual(nom('DD11102'), 'DD11102', 'nom blanc = pas de nom');
  assert.strictEqual(nom('ZZ99999'), 'ZZ99999', 'ouvrier inconnu des deux côtés');
});

test('une ligne sans matricule ne pollue pas la map', () => {
  const nom = makeNomFn(ROWS, {});
  assert.strictEqual(nom(''), '');
});

test('le nom retenu est le PREMIER non vide du matricule', () => {
  const nom = makeNomFn(
    [
      { matricule: 'ZZ11485', nom: '' },
      { matricule: 'ZZ11485', nom: 'PREMIER NOM' },
      { matricule: 'ZZ11485', nom: 'AUTRE NOM' },
    ],
    {}
  );
  assert.strictEqual(nom('ZZ11485'), 'PREMIER NOM');
});

// ─────────────────────────────────── câblage dans les deux pop-ups

const HS_POPUP = moduleSource('rh/QuinzaineHeuresSupPopup.jsx');
const CS_POPUP = moduleSource('rh/QuinzaineChargesSocialesPopup.jsx');

test('la pop-up Heures Sup passe par le helper partagé', () => {
  assert.match(HS_POPUP, /_nomOuvrierQz\(w\.matricule\)/);
  assert.doesNotMatch(HS_POPUP, /const _hsNom\s*=/,
    'le helper local dupliqué doit avoir disparu');
});

test('la pop-up Charges Sociales passe par le MÊME helper', () => {
  // Même défaut, dupliqué sur le même écran : le corriger d'un seul côté
  // laisserait deux pop-ups nommer différemment le même ouvrier.
  assert.match(CS_POPUP, /_nomOuvrierQz\(w\.matricule\)/);
  assert.doesNotMatch(CS_POPUP, /const _csNom\s*=/);
});

test('le helper est déclaré avant les pop-ups et n\'est PAS un hook', () => {
  // Ce point du composant est SOUS ses early-returns (`if (loading)`…) : un
  // useMemo posé ici serait un hook conditionnel et casserait tout l'écran.
  assert.ok(
    SRC.indexOf('const _nomOuvrierQz =') < SRC.indexOf('quinzPopupKey === \'heures_sup\''),
    'le helper doit précéder son usage'
  );
  assert.doesNotMatch(HELPER, /useMemo|useState|useEffect/,
    'aucun hook dans ce bloc : il est sous les early-returns du composant');
});
