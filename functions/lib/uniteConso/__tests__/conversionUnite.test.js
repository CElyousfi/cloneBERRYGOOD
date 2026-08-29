'use strict';

/*
 * conversionUnite.test.js — conversion « unité de consommation → unité de
 * stock », module PUR.
 *
 * ── CE QUI EST VERROUILLÉ ICI ──────────────────────────────────────────────
 *  1. le SENS du facteur : `stock_par_unite_consommation` = combien d'unités
 *     de STOCK vaut UNE unité de CONSOMMATION. Consommer 5 L d'Acide Nitrique
 *     (1 L = 1,32 KG) déduit 6,6 KG — et surtout PAS 3,79 KG (facteur inversé) ;
 *  2. le FAIL-CLOSED : facteur absent / nul / négatif / illisible / fiches
 *     homonymes en désaccord → la ligne n'est PAS convertie et PAS devinée,
 *     elle est déclarée non convertible ;
 *  3. unités identiques → AUCUNE conversion (549 lignes sur 648 sont dans ce
 *     cas : leur appliquer un facteur les casserait toutes) ;
 *  4. aucune table de densités par défaut : un article sans conversion n'a
 *     jamais de facteur implicite de 1.
 *
 * FIXTURES RÉELLES — les cinq conversions données par Omar, exprimées en
 * contenants et converties en densité :
 *   ACIDE SULFURIQUE   35 kg = 20 L  → 1 L = 1,75  KG
 *   ACIDE NITRIQUE     33 kg = 25 L  → 1 L = 1,32  KG
 *   ACIDE PHOSPHORIQUE 32 kg = 20 L  → 1 L = 1,60  KG
 *   RHIZO HUMUS        25 kg = 24 L  → 1 L = 1,0416666… KG
 *   RHIZO AMINE        20 kg = 18 L  → 1 L = 1,111… KG
 * Ces 5 articles couvrent 72 des 87 lignes divergentes mesurées en production.
 */

const test = require('node:test');
const assert = require('node:assert');

const UC = require('../index');

/** Fiches catalogue réelles (unités telles qu'écrites au catalogue). */
const ACIDE_NITRIQUE = { nom: 'Acide Nitrique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.32 };
const ACIDE_SULFURIQUE = { nom: 'Acide Sulfurique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.75 };
const ACIDE_PHOSPHORIQUE = { nom: 'Acide Phosphorique', unite: 'Kg', unite_consommation: 'L', stock_par_unite_consommation: 1.6 };
const RHIZO_HUMUS = { nom: 'Rhizo Humus', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 25 / 24 };
const RHIZO_AMINE = { nom: 'Rhizo amine', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 20 / 18 };
/** Article sans conversion : le cas MAJORITAIRE (549 lignes sur 648). */
const UREE = { nom: 'UREE 46', unite: 'KG' };
/** Divergence RÉELLE encore sans conversion renseignée (5 lignes en prod). */
const MKP = { nom: 'M-K-P', unite: 'L' };

// ── 1. LE TEST QUI COMPTE ──────────────────────────────────────────────────

test('Acide Nitrique — 5 L consommés déduisent 6,6 KG du stock', () => {
  const v = UC.convertirQuantite({ article: 'Acide Nitrique', quantite: 5, unite: 'L' }, ACIDE_NITRIQUE);
  assert.equal(v.convertible, true);
  assert.equal(v.converti, true);
  assert.equal(v.quantite_stock, 6.6);
  assert.equal(v.unite_stock, 'KG');
  assert.equal(v.unite_saisie, 'L');
  assert.equal(v.motif, UC.MOTIFS.CONVERTI);
  // Le facteur INVERSÉ donnerait 5 / 1,32 = 3,787… : la valeur interdite.
  assert.notEqual(v.quantite_stock, Math.round((5 / 1.32) * 1e6) / 1e6);
});

test('les cinq conversions réelles d\'Omar, sur un contenant entier', () => {
  // Chaque ligne rejoue l'équivalence de contenant telle qu'Omar l'a donnée :
  // consommer le volume du fût doit déduire son poids.
  const cas = [
    { fiche: ACIDE_SULFURIQUE, litres: 20, kilos: 35 },
    { fiche: ACIDE_NITRIQUE, litres: 25, kilos: 33 },
    { fiche: ACIDE_PHOSPHORIQUE, litres: 20, kilos: 32 },
    { fiche: RHIZO_HUMUS, litres: 24, kilos: 25 },
    { fiche: RHIZO_AMINE, litres: 18, kilos: 20 },
  ];
  for (const c of cas) {
    const v = UC.convertirQuantite({ article: c.fiche.nom, quantite: c.litres, unite: 'L' }, c.fiche);
    assert.equal(v.convertible, true, c.fiche.nom);
    assert.equal(v.quantite_stock, c.kilos, c.fiche.nom + ' : ' + c.litres + ' L doivent faire ' + c.kilos + ' kg');
  }
});

test('un facteur non rond (25/24) survit au calcul sans être arrondi à la source', () => {
  // 1,0416666… : la valeur STOCKÉE n'est jamais tronquée, seul le résultat est
  // arrondi au millionième pour neutraliser le bruit flottant.
  const v = UC.convertirQuantite({ article: 'Rhizo Humus', quantite: 12, unite: 'L' }, RHIZO_HUMUS);
  assert.equal(v.facteur, 25 / 24);
  assert.equal(v.quantite_stock, 12.5);
  const v2 = UC.convertirQuantite({ article: 'Rhizo Humus', quantite: 1, unite: 'L' }, { nom: 'x', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.0416666 });
  assert.equal(v2.quantite_stock, 1.041667, 'arrondi d\'AFFICHAGE au millionième, pas de perte de la valeur saisie');
});

// ── 2. UNITÉS IDENTIQUES : ON NE CONVERTIT RIEN ────────────────────────────

test('unités identiques — quantité inchangée, aucun facteur appliqué', () => {
  const v = UC.convertirQuantite({ article: 'UREE 46', quantite: 10, unite: 'KG' }, UREE);
  assert.equal(v.convertible, true);
  assert.equal(v.converti, false, 'aucune conversion ne doit être appliquée');
  assert.equal(v.quantite_stock, 10);
  assert.equal(v.motif, UC.MOTIFS.IDENTIQUE);
});

test('unités identiques à la CASSE près (kg / KG / Kg) — toujours pas de conversion', () => {
  for (const u of ['kg', 'KG', ' Kg ']) {
    const v = UC.convertirQuantite({ article: 'UREE 46', quantite: 10, unite: u }, UREE);
    assert.equal(v.converti, false, 'unité ' + JSON.stringify(u));
    assert.equal(v.quantite_stock, 10);
  }
});

test('un article AVEC conversion saisi dans son unité de STOCK n\'est pas converti', () => {
  // Acide Nitrique saisi en KG : c'est déjà l'unité du solde, appliquer 1,32
  // le gonflerait de 32 %.
  const v = UC.convertirQuantite({ article: 'Acide Nitrique', quantite: 33, unite: 'KG' }, ACIDE_NITRIQUE);
  assert.equal(v.converti, false);
  assert.equal(v.quantite_stock, 33);
});

test('unité non précisée — traitée comme l\'unité de stock (comportement d\'avant)', () => {
  const v = UC.convertirQuantite({ article: 'UREE 46', quantite: 4, unite: '' }, UREE);
  assert.equal(v.convertible, true);
  assert.equal(v.converti, false);
  assert.equal(v.quantite_stock, 4);
  assert.equal(v.unite_saisie, 'KG');
});

// ── 3. FAIL-CLOSED ─────────────────────────────────────────────────────────

test('facteur ABSENT — ligne NON convertible, aucun repli à 1', () => {
  const v = UC.convertirQuantite({ article: 'M-K-P', quantite: 5, unite: 'kg' }, MKP);
  assert.equal(v.convertible, false);
  assert.equal(v.converti, false);
  assert.equal(v.quantite_stock, null, 'ne JAMAIS renvoyer la quantité comme si elle était convertie');
  assert.equal(v.motif, UC.MOTIFS.FACTEUR_ABSENT);
  // Le message nomme l'article ET les deux unités en cause.
  assert.match(v.message, /M-K-P/);
  assert.match(v.message, /kg/);
  assert.match(v.message, /L/);
});

test('facteur nul, négatif ou illisible — refusé comme un facteur absent', () => {
  for (const f of [0, -1, -0.5, 'abc', '', null, undefined, NaN, true, {}]) {
    const fiche = { nom: 'X', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: f };
    const v = UC.convertirQuantite({ article: 'X', quantite: 5, unite: 'L' }, fiche);
    assert.equal(v.convertible, false, 'facteur ' + JSON.stringify(f));
    assert.equal(v.quantite_stock, null, 'facteur ' + JSON.stringify(f));
    assert.equal(UC.lireFacteur(f), null, 'facteur ' + JSON.stringify(f));
  }
});

test('lireFacteur — accepte la virgule décimale et les chaînes numériques', () => {
  assert.equal(UC.lireFacteur('1,32'), 1.32);
  assert.equal(UC.lireFacteur(' 1.75 '), 1.75);
  assert.equal(UC.lireFacteur(1.0416666), 1.0416666);
});

test('unité saisie ≠ unité de consommation déclarée — non convertible', () => {
  // La fiche sait convertir des L, on lui saisit des « bidon » : le facteur ne
  // s'applique pas à cette unité-là.
  const v = UC.convertirQuantite({ article: 'Acide Nitrique', quantite: 2, unite: 'bidon' }, ACIDE_NITRIQUE);
  assert.equal(v.convertible, false);
  assert.equal(v.quantite_stock, null);
});

test('article inconnu du catalogue — non convertible, unité de stock inconnue', () => {
  const v = UC.convertirQuantite({ article: 'GENAKTIS', quantite: 3, unite: 'L' }, null);
  assert.equal(v.convertible, false);
  assert.equal(v.motif, UC.MOTIFS.ARTICLE_INCONNU);
  assert.equal(v.quantite_stock, null);
});

test('quantité illisible — non convertible', () => {
  const v = UC.convertirQuantite({ article: 'Acide Nitrique', quantite: 'abc', unite: 'L' }, ACIDE_NITRIQUE);
  assert.equal(v.convertible, false);
  assert.equal(v.motif, UC.MOTIFS.QUANTITE_INVALIDE);
});

// ── 4. CATALOGUE À DOUBLONS ────────────────────────────────────────────────

test('deux fiches homonymes D\'ACCORD — traitées comme une seule', () => {
  const index = UC.indexerArticles([ACIDE_NITRIQUE, { ...ACIDE_NITRIQUE, id: 'doublon' }]);
  const a = UC.trouverArticle(index, 'ACIDE NITRIQUE');
  assert.ok(a, 'un doublon strictement identique ne doit pas rendre l\'article ambigu');
  const v = UC.convertirQuantite({ article: 'Acide Nitrique', quantite: 5, unite: 'L' }, a);
  assert.equal(v.quantite_stock, 6.6);
});

test('deux fiches homonymes EN DÉSACCORD — ambigu, donc non convertible', () => {
  const index = UC.indexerArticles([
    ACIDE_NITRIQUE,
    { nom: 'acide nitrique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.4 },
  ]);
  assert.equal(UC.trouverArticle(index, 'Acide Nitrique'), null, 'on n\'élit pas une fiche au hasard');
  const v = UC.convertirQuantite({ article: 'Acide Nitrique', quantite: 5, unite: 'L' }, null);
  assert.equal(v.convertible, false);
});

// ── 5. SIGNALEMENT DES LIGNES NON CONVERTIBLES ─────────────────────────────

test('analyserLignes — sépare le convertible du signalé, sans rien bloquer', () => {
  const index = UC.indexerArticles([ACIDE_NITRIQUE, UREE, MKP]);
  const res = UC.analyserLignes([
    { article: 'Acide Nitrique', quantite: 5, unite: 'L' },
    { article: 'UREE 46', quantite: 10, unite: 'kg' },
    { article: 'M-K-P', quantite: 5, unite: 'kg' },
  ], index);
  assert.equal(res.lignes.length, 3);
  assert.equal(res.lignes[0].quantite_stock, 6.6);
  assert.equal(res.lignes[1].quantite_stock, 10);
  assert.equal(res.non_convertibles.length, 1, 'seule la ligne sans conversion est signalée');
  assert.equal(res.non_convertibles[0].article, 'M-K-P');
  assert.equal(res.non_convertibles[0].unite_saisie, 'kg');
  assert.equal(res.non_convertibles[0].unite_stock, 'L');
  assert.match(res.non_convertibles[0].message, /M-K-P/);
});

// ── 6. FICHE : UNITÉS PROPOSABLES ET PHRASE AFFICHÉE ───────────────────────

test('unitesSaisissables — l\'unité de stock, plus l\'unité de consommation si elle existe', () => {
  assert.deepEqual(UC.unitesSaisissables(ACIDE_NITRIQUE), ['KG', 'L']);
  assert.deepEqual(UC.unitesSaisissables(UREE), ['KG'], 'sans unité de consommation : une seule unité');
  assert.deepEqual(UC.unitesSaisissables({ nom: 'x', unite: 'KG', unite_consommation: 'kg' }), ['KG'], 'même unité écrite autrement : pas de doublon');
  assert.deepEqual(UC.unitesSaisissables(null), [], 'article inconnu : on n\'invente aucune unité');
});

test('phraseConversion — dit le sens en toutes lettres, ou ne dit rien', () => {
  assert.equal(UC.phraseConversion(ACIDE_NITRIQUE), '1 L = 1.32 KG');
  assert.equal(UC.phraseConversion(UREE), '', 'pas de conversion : pas de phrase');
  assert.equal(UC.phraseConversion({ nom: 'x', unite: 'KG', unite_consommation: 'L' }), '', 'facteur manquant : jamais de phrase à moitié vraie');
  assert.equal(UC.phraseConversion({ nom: 'x', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 0 }), '');
});

test('le nom du champ porte le sens du facteur', () => {
  // Verrou de nommage : renommer le champ en `facteur_conversion` (nombre nu,
  // sens perdu) casse ce test AVANT de casser des stocks.
  assert.equal(UC.CHAMP_FACTEUR, 'stock_par_unite_consommation');
  assert.equal(UC.CHAMP_UNITE_CONSOMMATION, 'unite_consommation');
});
