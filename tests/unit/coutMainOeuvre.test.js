/*
 * coutMainOeuvre.test.js — LE modèle de coût main d'œuvre.
 *
 * Ce module remplace deux calculs qui coexistaient et se contredisaient (~11 %
 * d'écart sur la Quinzaine 03). Ce que ce fichier verrouille :
 *   1. l'ARITHMÉTIQUE net → coût employeur : net + salariales + patronales, et
 *      pas seulement la patronale — c'est le défaut exact de la carte
 *      « Charges patronales CNSS » qu'on corrige ;
 *   2. la LINÉARITÉ du brut, qui rend la ventilation par catégorie EXACTE et
 *      non approchée. Si un barème devenait progressif, la ventilation
 *      cesserait d'être juste en silence — ce test le ferait tomber ;
 *   3. le comptage en JOURS DISTINCTS et non en lignes ;
 *   4. le non déclaré : ni salariale, ni patronale, ni ancienneté ;
 *   5. la prime de fonction DATÉE : une quinzaine passée reste payée au montant
 *      de l'époque, sinon revaloriser une prime réécrit l'historique des coûts.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const CMO = require(path.join(ROOT, 'public/lib/coutMainOeuvre.js'));
// PaieUtils RÉEL, injecté : c'est le modèle de paie de la production, pas un
// stub — un stub validerait le câblage et laisserait passer une erreur de taux.
const paie = require(path.join(ROOT, 'public/lib/paieUtils.js'));

const BAREMES = paie.PAIE_BAREMES_DEFAULT;
const DECLARE = { declare: true, baselineJours: 0, primeFonctionJournaliere: 0 };
const NON_DECLARE = { declare: false, baselineJours: 0, primeFonctionJournaliere: 0 };

function rows(list) {
  return list.map(([matricule, jour, operationFamille]) => ({ matricule, jour, operationFamille }));
}

// ─────────────────────────────────────────────────────── classification

test('categorieMO — récolte, postes fixes, et TOUT le reste en hors récolte', () => {
  assert.strictEqual(CMO.categorieMO('8. Récolte'), 'recolte');
  assert.strictEqual(CMO.categorieMO('Recolte myrtille'), 'recolte');
  assert.strictEqual(CMO.categorieMO('11. Postes fixes'), 'postes');
  assert.strictEqual(CMO.categorieMO('2. Ferti-irrigation'), 'horsRecolte');
  // Famille vide : du travail réel, qui doit peser quelque part. Une catégorie
  // « inconnue » le ferait disparaître du total sans rien lever.
  assert.strictEqual(CMO.categorieMO(''), 'horsRecolte');
  assert.strictEqual(CMO.categorieMO(undefined), 'horsRecolte');
});

// ─────────────────────────────────────────────────────── comptage des jours

test('joursParOuvrier — un JOUR compte une fois, même pointé trois fois', () => {
  const j = CMO.joursParOuvrier(rows([
    ['A', '2026-08-01', 'Taille'],
    ['A', '2026-08-01', 'Ferti-irrigation'],
    ['A', '2026-08-01', 'Taille'],
    ['A', '2026-08-02', 'Taille'],
  ]));
  // 3 lignes le 01/08, toutes hors récolte → UN jour.
  assert.strictEqual(Object.keys(j.A.jours.horsRecolte).length, 2);
});

test('joursParOuvrier — le premier jour est le plus ANCIEN, pas le premier lu', () => {
  const j = CMO.joursParOuvrier(rows([
    ['A', '2026-08-10', 'Taille'],
    ['A', '2026-08-01', 'Taille'],
  ]));
  // C'est lui qui date le SMAG et la prime de fonction : prendre l'ordre de
  // lecture ferait dépendre le coût de l'ordre des lignes de l'API.
  assert.strictEqual(j.A.premierJour, '2026-08-01');
});

test('joursParOuvrier — lignes inexploitables ignorées, jamais un ouvrier fantôme', () => {
  const j = CMO.joursParOuvrier([
    { matricule: '', jour: '2026-08-01' },
    { matricule: 'A', jour: '' },
    null,
  ]);
  assert.deepStrictEqual(Object.keys(j), []);
});

// ─────────────────────────────────────── l'arithmétique qu'on vient corriger

test('net + salariales + patronales = coût employeur', () => {
  // C'est LE point du chantier. La carte de l'écran Quinzaine n'ajoutait que la
  // patronale : elle sous-estimait le coût de 6,74 % du brut déclaré.
  const p = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 15, baremes: BAREMES,
    dateISO: '2026-08-01' });
  assert.ok(p.brut > 0);
  const reconstitue = p.net + p.cotisationsSalariales + p.chargesPatronales;
  assert.strictEqual(Math.round(reconstitue * 100) / 100,
    Math.round(p.coutEmployeur * 100) / 100);
  // Et la patronale SEULE ne suffit pas : c'est l'écart que la carte actuelle
  // laisse sur la table.
  assert.ok(p.net + p.chargesPatronales < p.coutEmployeur);
});

test('les taux appliqués sont ceux du barème : 6,74 % salarial, 19,26 % patronal', () => {
  const p = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 15, baremes: BAREMES,
    dateISO: '2026-08-01' });
  const tauxSal = p.cotisationsSalariales / p.brut;
  const tauxPat = p.chargesPatronales / p.brut;
  assert.strictEqual(Math.round(tauxSal * 10000) / 10000, 0.0674); // CNSS 4,48 + AMO 2,26
  assert.strictEqual(Math.round(tauxPat * 10000) / 10000, 0.1926);
});

test('non déclaré — ni salariale, ni patronale : le net EST le coût', () => {
  const p = CMO.paieOuvrier({ paie, fiche: NON_DECLARE, jours: 15, baremes: BAREMES,
    dateISO: '2026-08-01' });
  assert.strictEqual(p.cotisationsSalariales, 0);
  assert.strictEqual(p.chargesPatronales, 0);
  assert.strictEqual(p.net, p.coutEmployeur);
});

test('zéro jour — zéro partout, jamais un salaire pour une absence', () => {
  const p = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 0, baremes: BAREMES,
    dateISO: '2026-08-01' });
  assert.strictEqual(p.brut, 0);
  assert.strictEqual(p.coutEmployeur, 0);
});

// ─────────────────────────────── linéarité : la ventilation est EXACTE

test('LINÉARITÉ — le brut est proportionnel aux jours', () => {
  // Propriété qui rend exacte la ventilation d'un ouvrier entre plusieurs
  // catégories. Si un barème devenait progressif, ce test tomberait AVANT que
  // les tuiles ne se mettent à mentir.
  const un = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 1, baremes: BAREMES, dateISO: '2026-08-01' });
  const dix = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 10, baremes: BAREMES, dateISO: '2026-08-01' });
  assert.strictEqual(Math.round(dix.brut * 100) / 100, Math.round(un.brut * 10 * 100) / 100);
});

test('ventilation — un ouvrier partagé entre catégories = son total, au centime', () => {
  const registre = { A: DECLARE };
  const mixte = CMO.netParCategorie({ paie, baremes: BAREMES, registre, rows: rows([
    ['A', '2026-08-01', 'Taille'],
    ['A', '2026-08-02', 'Taille'],
    ['A', '2026-08-03', '8. Récolte'],
    ['A', '2026-08-04', '11. Postes fixes'],
  ]) });
  const entier = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 4, baremes: BAREMES,
    dateISO: '2026-08-01' });
  assert.strictEqual(Math.round(mixte.total * 100) / 100, Math.round(entier.net * 100) / 100);
  // Et chaque catégorie porte sa part réelle, pas un prorata inventé.
  assert.ok(mixte.horsRecolte > mixte.recolte);
  assert.strictEqual(Math.round(mixte.recolte * 100) / 100, Math.round(mixte.postes * 100) / 100);
});

// ─────────────────────────────────────────────────────── charges sociales

test('chargesSociales — seuls les déclarés cotisent, et on COMPTE les autres', () => {
  const registre = { A: DECLARE, B: NON_DECLARE };
  const c = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: rows([
    ['A', '2026-08-01', 'Taille'],
    ['B', '2026-08-01', 'Taille'],
  ]) });
  assert.strictEqual(c.nbDeclares, 1);
  // Le compteur existe pour que l'écran puisse EXPLIQUER des charges basses au
  // lieu de les laisser passer pour une anomalie de calcul.
  assert.strictEqual(c.nbNonDeclares, 1);
  const seulA = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 1, baremes: BAREMES,
    dateISO: '2026-08-01' });
  assert.strictEqual(Math.round(c.brutDeclare * 100) / 100, Math.round(seulA.brut * 100) / 100);
  assert.strictEqual(Math.round(c.total * 100) / 100,
    Math.round((seulA.chargesPatronales + seulA.cotisationsSalariales) * 100) / 100);
});

test('INVARIANT — Σ nets + charges sociales = Σ coûts employeur', () => {
  // L'égalité que l'écran doit pouvoir montrer à l'œil : l'addition des tuiles
  // tombe sur le coût employeur, au dirham.
  const registre = { A: DECLARE, B: NON_DECLARE,
    C: { declare: true, baselineJours: 700, primeFonctionJournaliere: 12 } };
  const lignes = rows([
    ['A', '2026-08-01', 'Taille'], ['A', '2026-08-02', '8. Récolte'],
    ['B', '2026-08-01', 'Taille'], ['B', '2026-08-03', 'Taille'],
    ['C', '2026-08-01', '11. Postes fixes'], ['C', '2026-08-02', 'Taille'],
  ]);
  const mo = CMO.netParCategorie({ paie, baremes: BAREMES, registre, rows: lignes });
  const charges = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes });

  const parOuvrier = CMO.joursParOuvrier(lignes);
  let attendu = 0;
  Object.keys(parOuvrier).forEach((mat) => {
    CMO.CATEGORIES.forEach((cat) => {
      const j = Object.keys(parOuvrier[mat].jours[cat] || {}).length;
      if (!j) return;
      attendu += CMO.paieOuvrier({ paie, fiche: registre[mat], jours: j,
        baremes: BAREMES, dateISO: parOuvrier[mat].premierJour }).coutEmployeur;
    });
  });
  assert.strictEqual(Math.round((mo.total + charges.total) * 100) / 100,
    Math.round(attendu * 100) / 100);
});

// ─────────────────────────────────────────────────────── prime de fonction datée

test('primeFonctionADate — la quinzaine est payée au montant de SON époque', () => {
  const hist = [{ effectiveFrom: '2026-07-01', montant: 20, previousMontant: 10 }];
  assert.strictEqual(CMO.primeFonctionADate(hist, 30, '2026-08-01'), 20);
  // Avant toute révision connue : le montant d'AVANT, pas le courant. Sinon
  // revaloriser une prime réécrit rétroactivement tous les coûts passés.
  assert.strictEqual(CMO.primeFonctionADate(hist, 30, '2026-06-01'), 10);
  // Pas d'historique → le montant courant, faute de mieux.
  assert.strictEqual(CMO.primeFonctionADate([], 30, '2026-08-01'), 30);
  assert.strictEqual(CMO.primeFonctionADate(null, 30, null), 30);
});

// ─────────────────────────────────────────────────────── totaux d'écran

test('coutEmployeur — les 7 postes, et RIEN de la sous-traitance', () => {
  const total = CMO.coutEmployeur({
    mo: { recolte: 0, horsRecolte: 148667, postes: 0 },
    primes: { recolte: 0, transport: 29330, autres: 8673 },
    charges: { total: 16256 },
  });
  assert.strictEqual(total, 202926);
  // Location & Engins est un coût de la quinzaine, pas un coût d'EMPLOYÉ : il
  // ne doit pas se glisser dans un chiffre qu'on compare à une masse salariale.
  assert.strictEqual(CMO.totalQuinzaine({
    mo: { recolte: 0, horsRecolte: 148667, postes: 0 },
    primes: { recolte: 0, transport: 29330, autres: 8673 },
    charges: { total: 16256 },
    locationEngins: 5200,
  }), 208126);
});

test('modèle absent — zéro, jamais un coût inventé', () => {
  // PaieUtils non chargé (script en 404 après un déploiement partiel) : le
  // module rend 0 et l'écran affichera « — ». Il ne doit surtout pas retomber
  // sur une autre source de coût.
  const p = CMO.paieOuvrier({ paie: null, fiche: DECLARE, jours: 15, baremes: BAREMES });
  assert.strictEqual(p.coutEmployeur, 0);
});

test('« Caporal hors Récolte » est du HORS récolte, malgré le mot « Récolte »', () => {
  // Le libellé contient la chose qu'il nie. Une recherche naïve du mot le
  // rangeait dans la récolte : sans effet tant que les lignes de récolte
  // étaient jetées, faux dès qu'on les rétablit — 5 caporaux et 3 463 DH
  // apparus dans la mauvaise tuile.
  assert.strictEqual(CMO.categorieMO('Caporal hors Récolte'), 'horsRecolte');
  assert.strictEqual(CMO.categorieMO('Caporal hors recolte'), 'horsRecolte');
  assert.strictEqual(CMO.categorieMO('CAPORAL HORS RÉCOLTE'), 'horsRecolte');
  // Et le caporal DE récolte, lui, reste en récolte : la négation ne doit pas
  // avaler le cas nominal.
  assert.strictEqual(CMO.categorieMO('Caporal Récolte'), 'recolte');
  // « hors » comme mot entier, pas comme fragment : « horsain », « dehors »…
  assert.strictEqual(CMO.categorieMO('Récolte dehors'), 'recolte');
});

test('accents — « Recolte » sans accent est reconnu comme « Récolte »', () => {
  // BEE ONE écrit les deux. Deux orthographes qui tombent dans deux catégories
  // différentes couperaient un total en deux sans rien lever.
  assert.strictEqual(CMO.categorieMO('8. Recolte'), CMO.categorieMO('8. Récolte'));
});

test('netAPayer — sortie de caisse : sans les charges, AVEC la sous-traitance', () => {
  const mo = { recolte: 0, horsRecolte: 148667, postes: 0 };
  const primes = { recolte: 0, transport: 29330, autres: 8673 };
  const charges = { total: 16256 };
  const loc = 5200;
  // Les charges vont à la CNSS, pas à l'ouvrier. Les prestataires, eux, sont
  // bien payés : c'est un décaissement de la quinzaine.
  assert.strictEqual(CMO.masseSalarialeNette({ mo, primes }), 186670);
  assert.strictEqual(CMO.netAPayer({ mo, primes, locationEngins: loc }), 191870);

  // Le coût employeur, LUI, exclut la sous-traitance : un prestataire n'a ni
  // bulletin ni cotisation. L'y mettre ferait comparer à une masse salariale un
  // chiffre qui n'en est pas une.
  assert.strictEqual(CMO.coutEmployeur({ mo, primes, charges, locationEngins: loc }), 202926);

  // LES DEUX CHEMINS TOMBENT SUR LE MÊME TOTAL — c'est ce qui rend les trois
  // chiffres de l'écran vérifiables l'un par l'autre :
  //   coût employeur + sous-traitance  =  net à payer + charges
  const total = CMO.totalQuinzaine({ mo, primes, charges, locationEngins: loc });
  assert.strictEqual(total, CMO.coutEmployeur({ mo, primes, charges }) + loc);
  assert.strictEqual(total, CMO.netAPayer({ mo, primes, locationEngins: loc }) + charges.total);
  assert.strictEqual(total, 208126);
});

test('CNSS et AMO restent séparées — recoupées sur un bulletin réel', () => {
  // ABDELLAY ABDELHAMID, Quinzaine 01 : 13 jours, déclaré, prime de fonction
  // 25,872 DH/j. Les montants sont ceux de la pop-up ouvrier en production —
  // c'est le contrôle qui dit que le module calcule LA paie, et pas une paie.
  const p = CMO.paieOuvrier({
    paie,
    fiche: { declare: true, baselineJours: 65, primeFonctionJournaliere: 25.872307692 },
    jours: 13,
    baremes: BAREMES,
    dateISO: '2026-07-01',
  });
  assert.strictEqual(Math.round(p.brut * 100) / 100, 1603.06);
  assert.strictEqual(Math.round(p.cnss * 100) / 100, 71.82);
  assert.strictEqual(Math.round(p.amo * 100) / 100, 36.23);
  assert.strictEqual(Math.round(p.chargesPatronales * 100) / 100, 308.75);
  assert.strictEqual(Math.round(p.net * 100) / 100, 1495.01);
  assert.strictEqual(Math.round(p.coutEmployeur * 100) / 100, 1911.81);
  // Les deux cotisations se recomposent en une part salariale, jamais l'inverse.
  assert.strictEqual(Math.round((p.cnss + p.amo) * 100) / 100,
    Math.round(p.cotisationsSalariales * 100) / 100);
});

test('chargesSociales — les agrégats CNSS et AMO suivent le détail', () => {
  const registre = { A: DECLARE, B: NON_DECLARE };
  const c = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: rows([
    ['A', '2026-08-01', 'Taille'],
    ['B', '2026-08-01', 'Taille'],
  ]) });
  assert.strictEqual(Math.round((c.cnss + c.amo) * 100) / 100,
    Math.round(c.salariales * 100) / 100);
  // Un non déclaré ne cotise pas : ses colonnes sont à zéro, mais il FIGURE au
  // détail avec ses jours et son brut.
  const nonDecl = c.detail.filter((w) => !w.declare)[0];
  assert.strictEqual(nonDecl.cnss, 0);
  assert.strictEqual(nonDecl.amo, 0);
  assert.ok(nonDecl.brut > 0);
});

// ─────────────────────────────────────────────── heures supplémentaires

test('HS — saisies au NET, remontées au brut pour cotiser', () => {
  // Le bulletin range les heures sup dans le brut : elles cotisent. Le montant
  // saisi est celui qui est ACCORDÉ (net, comme la colonne « Prime heure sup »),
  // donc il faut remonter au brut avant d'appliquer les taux — sinon on
  // sous-évalue les charges de 6,74 % de chaque montant accordé.
  const registre = { A: DECLARE };
  const lignes = rows([['A', '2026-08-01', 'Taille']]);
  const sans = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes });
  const avec = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes,
    heuresSupNet: { A: 420 } });

  const brutHS = 420 / (1 - 0.0674);
  assert.strictEqual(Math.round((avec.brutDeclare - sans.brutDeclare) * 100) / 100,
    Math.round(brutHS * 100) / 100);
  // Les charges suivent l'assiette, patronale comprise.
  assert.strictEqual(Math.round((avec.patronales - sans.patronales) * 100) / 100,
    Math.round(brutHS * 0.1926 * 100) / 100);
  // Et le net de l'ouvrier monte exactement du montant accordé.
  assert.strictEqual(Math.round((avec.detail[0].net - sans.detail[0].net) * 100) / 100, 420);
  assert.strictEqual(avec.detail[0].heuresSup, 420);
});

test('HS — un non déclaré ne cotise pas dessus', () => {
  const registre = { B: NON_DECLARE };
  const c = CMO.chargesSociales({ paie, baremes: BAREMES, registre,
    rows: rows([['B', '2026-08-01', 'Taille']]), heuresSupNet: { B: 300 } });
  assert.strictEqual(c.patronales, 0);
  assert.strictEqual(c.salariales, 0);
  // Il les touche quand même : elles pèsent dans son coût.
  assert.strictEqual(c.detail[0].heuresSup, 300);
});

test('HS — dans le net à payer ET dans le coût employeur', () => {
  const mo = { recolte: 0, horsRecolte: 100000, postes: 0 };
  const primes = { recolte: 0, transport: 20000, autres: 5000 };
  const charges = { total: 15000 };
  const base = { mo, primes, charges, locationEngins: 3000 };
  const avecHS = Object.assign({}, base, { heuresSup: 6045 });

  assert.strictEqual(CMO.netAPayer(avecHS) - CMO.netAPayer(base), 6045);
  assert.strictEqual(CMO.coutEmployeur(avecHS) - CMO.coutEmployeur(base), 6045);
  // La chaîne reste fermée : les deux chemins vers le total concordent.
  assert.strictEqual(CMO.totalQuinzaine(avecHS),
    CMO.coutEmployeur(avecHS) + 3000);
  assert.strictEqual(CMO.totalQuinzaine(avecHS),
    CMO.netAPayer(avecHS) + charges.total);
});

test('HS — aucune saisie : rien ne bouge', () => {
  const registre = { A: DECLARE };
  const lignes = rows([['A', '2026-08-01', 'Taille']]);
  const a = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes });
  const b = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes, heuresSupNet: {} });
  assert.deepStrictEqual(a.detail[0], b.detail[0]);
  assert.strictEqual(a.detail[0].heuresSup, 0);
});

// ─────────────────────── non déclaré : le MÊME net qu'un déclaré

test('NON DÉCLARÉ — même net qu\'un déclaré à situation égale', () => {
  // Arbitrage d'Omar 2026-08-21, vérifié sur les bulletins : la feuille
  // « SANS CNSS » affiche net/brut = 0,9333 sur les trois quinzaines. La
  // retenue s'applique donc aussi au non-déclaré ; elle n'est simplement
  // versée à personne. Auparavant sa prime de fonction échappait à la
  // retenue — 6,74 % de prime de plus que son collègue déclaré.
  const fiche = { baselineJours: 0, primeFonctionJournaliere: 25.874 };
  const d = CMO.paieOuvrier({ paie, fiche: { ...fiche, declare: true }, jours: 13,
    baremes: BAREMES, dateISO: '2026-08-01' });
  const n = CMO.paieOuvrier({ paie, fiche: { ...fiche, declare: false }, jours: 13,
    baremes: BAREMES, dateISO: '2026-08-01' });
  // Écart résiduel : le barème porte un SMAG net arrondi (90,88 contre 90,873).
  assert.ok(Math.abs(n.net - d.net) < 0.2,
    'nets attendus égaux, obtenus ' + n.net.toFixed(2) + ' vs ' + d.net.toFixed(2));
});

test('NON DÉCLARÉ — son coût pour l\'entreprise est son NET', () => {
  // Ni charge patronale, ni cotisation reversée : l'entreprise ne décaisse que
  // ce qu'elle lui remet.
  const n = CMO.paieOuvrier({ paie, fiche: NON_DECLARE, jours: 13,
    baremes: BAREMES, dateISO: '2026-08-01' });
  assert.strictEqual(n.chargesPatronales, 0);
  assert.strictEqual(n.cotisationsSalariales, 0);
  assert.strictEqual(n.net, n.coutEmployeur);
});

// ─────────────────────────────────────────────────── jours fériés

test('FÉRIÉ — un jour férié vaut une journée travaillée, prime comprise', () => {
  // Le bulletin paie le férié comme un jour normal : SMAG, prime de fonction, et
  // il compte dans l'assiette de l'ancienneté (sa colonne « nbr jour » du bloc
  // primes vaut jours travaillés + fériés). Avant, on le sortait du salaire pour
  // le remettre en prime valorisée au coût moyen BEE ONE : 110,6 DH au lieu de
  // 90,9, tout en PERDANT la prime de fonction et l'ancienneté de ce jour-là.
  const fiche = { declare: true, baselineJours: 0, primeFonctionJournaliere: 25.874 };
  const jour = CMO.paieOuvrier({ paie, fiche, jours: 1, baremes: BAREMES, dateISO: '2026-08-01' });
  const ferie = CMO.coutFeries({ paie, fiche, jours: 13, feries: 1,
    baremes: BAREMES, dateISO: '2026-08-01' });
  assert.strictEqual(Math.round(ferie.net * 100) / 100, Math.round(jour.net * 100) / 100);
  // Et il vaut PLUS que le SMAG net seul : la prime du jour s'y ajoute.
  assert.ok(ferie.net > BAREMES.smagNetJournalier);
});

test('FÉRIÉ — calculé par différence, donc juste quel que soit le barème', () => {
  // Le coût marginal est `paie(jours + fériés) − paie(jours)` : réimplémenter la
  // règle du férié la laisserait diverger du modèle le jour où un palier bouge.
  const fiche = { declare: true, baselineJours: 700, primeFonctionJournaliere: 10 };
  const a = CMO.paieOuvrier({ paie, fiche, jours: 12, feries: 3, baremes: BAREMES, dateISO: '2026-08-01' });
  const b = CMO.paieOuvrier({ paie, fiche, jours: 12, feries: 0, baremes: BAREMES, dateISO: '2026-08-01' });
  const cf = CMO.coutFeries({ paie, fiche, jours: 12, feries: 3, baremes: BAREMES, dateISO: '2026-08-01' });
  assert.strictEqual(Math.round(cf.net * 1e6) / 1e6, Math.round((a.net - b.net) * 1e6) / 1e6);
  // L'ancienneté de cet ouvrier (palier 5 %) s'applique AUSSI aux fériés.
  assert.ok(cf.net > 3 * BAREMES.smagNetJournalier);
});

test('FÉRIÉ — dans l\'assiette : les charges le portent', () => {
  const registre = { A: DECLARE };
  const lignes = rows([['A', '2026-08-01', 'Taille']]);
  const sans = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes });
  const avec = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes,
    feriesParOuvrier: { A: 2 } });
  assert.ok(avec.patronales > sans.patronales);
  assert.strictEqual(Math.round(avec.detail[0].feries * 100) / 100,
    Math.round((avec.detail[0].net - sans.detail[0].net) * 100) / 100);
});

test('FÉRIÉ — aucun jour férié : rien ne change, et zéro n\'est pas « inconnu »', () => {
  const registre = { A: DECLARE };
  const lignes = rows([['A', '2026-08-01', 'Taille']]);
  const a = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes });
  const b = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes,
    feriesParOuvrier: { A: 0 } });
  assert.deepStrictEqual(a.detail[0], b.detail[0]);
  assert.strictEqual(a.detail[0].feries, 0);
  assert.deepStrictEqual(CMO.coutFeries({ paie, fiche: DECLARE, jours: 10, feries: 0,
    baremes: BAREMES }), { net: 0, brut: 0 });
});

// ───────────── journées partagées entre catégories (récolte + hors récolte)

test('JOURNÉE PARTAGÉE — un ouvrier n\'est payé qu\'une fois ce jour-là', () => {
  // Récolte le matin, taille l'après-midi : DEUX catégories, UNE journée. Le
  // calcul faisait une paie par catégorie puis les additionnait — l'ouvrier
  // était payé deux fois. Le défaut dormait tant que la récolte n'avait pas
  // commencé (MO Récolte à 0 sur toute la campagne) ; il aurait mordu au
  // premier jour de cueillette, sur l'écran qui sert à préparer la paie.
  const registre = { A: NON_DECLARE };
  const t = CMO.netParCategorie({ paie, baremes: BAREMES, registre, rows: rows([
    ['A', '2026-07-01', 'Taille'],
    ['A', '2026-07-01', '8. Récolte'],
    ['A', '2026-07-02', 'Taille'],
  ]) });
  const reel = CMO.paieOuvrier({ paie, fiche: NON_DECLARE, jours: 2,
    baremes: BAREMES, dateISO: '2026-07-01' });
  assert.strictEqual(Math.round(t.total * 100) / 100, Math.round(reel.net * 100) / 100);
  // La paie se RÉPARTIT au prorata des jours de chaque catégorie : 2 jours
  // « hors récolte » contre 1 de récolte → deux tiers, un tiers.
  assert.strictEqual(Math.round(t.horsRecolte * 100) / 100,
    Math.round(reel.net * 2 / 3 * 100) / 100);
  assert.strictEqual(Math.round(t.recolte * 100) / 100,
    Math.round(reel.net / 3 * 100) / 100);
});

test('JOURNÉE PARTAGÉE — les charges non plus ne doublent pas', () => {
  const registre = { A: DECLARE };
  const lignes = rows([
    ['A', '2026-07-01', 'Taille'],
    ['A', '2026-07-01', '8. Récolte'],
  ]);
  const c = CMO.chargesSociales({ paie, baremes: BAREMES, registre, rows: lignes });
  const reel = CMO.paieOuvrier({ paie, fiche: DECLARE, jours: 1,
    baremes: BAREMES, dateISO: '2026-07-01' });
  assert.strictEqual(c.detail[0].jours, 1, 'une journée, pas deux');
  assert.strictEqual(Math.round(c.brutDeclare * 100) / 100,
    Math.round(reel.brut * 100) / 100);
});

test('nbJoursDistincts — ce n\'est PAS la somme des jours par catégorie', () => {
  const j = CMO.joursParOuvrier(rows([
    ['A', '2026-07-01', 'Taille'],
    ['A', '2026-07-01', '8. Récolte'],
    ['A', '2026-07-01', '11. Postes fixes'],
  ]));
  // Trois catégories, un seul jour.
  assert.strictEqual(CMO.nbJoursDistincts(j.A), 1);
  assert.strictEqual(CMO.CATEGORIES.reduce((s, c) =>
    s + Object.keys(j.A.jours[c] || {}).length, 0), 3);
});

test('ancienneté — elle CUMULE les journées depuis le socle, elle ne fige plus', () => {
  // LE défaut du 2026-08-22 : `paieOuvrier` appliquait `baselineJours` SEUL — une
  // photo datée du 30/04/2026 — si bien que l'ancienneté ne progressait jamais
  // sur l'écran Quinzaine. L'écran Campagne, lui, cumulait déjà : deux écrans,
  // deux anciennetés pour le même ouvrier.
  //
  // Cas RÉEL, matricule 3607 : socle 606 jours, 111 journées pointées depuis. À
  // 717 il franchit le seuil des 624 (5 %) — ce que la paie lui verse et que cet
  // écran lui refusait.
  const baremes = { smagBrutJournalier: 97.44, smagNetJournalier: 90.88,
    tauxCnssSalariale: 0.0448, tauxAmo: 0.0226, tauxChargesPatronales: 0.1926,
    paliers: [{ seuilJours: 624, pourcentage: 5 }, { seuilJours: 1560, pourcentage: 10 }] };
  const fiche = { declare: true, baselineJours: 606 };
  const commun = { paie: paie, fiche, jours: 10, baremes, dateISO: '2026-07-15' };

  const fige = CMO.paieOuvrier(commun);
  const cumule = CMO.paieOuvrier(Object.assign({}, commun, { joursDepuisSocle: 111 }));
  assert.ok(cumule.brut > fige.brut,
    'à 717 jours l\'ouvrier doit toucher 5 % que le socle seul lui refuse');
  // 5 % de la base, exactement.
  assert.strictEqual(Math.round((cumule.brut - fige.brut) * 100) / 100,
    Math.round(97.44 * 10 * 0.05 * 100) / 100);
});

test('ancienneté — cumul ABSENT : on retombe sur le socle, jamais sur une valeur inventée', () => {
  // Mieux vaut une ancienneté sous-estimée qu'une ancienneté inventée : la
  // seconde ferait franchir des seuils à des ouvriers qui n'y sont pas.
  const baremes = { smagBrutJournalier: 97.44, smagNetJournalier: 90.88,
    tauxCnssSalariale: 0.0448, tauxAmo: 0.0226, tauxChargesPatronales: 0.1926,
    paliers: [{ seuilJours: 624, pourcentage: 5 }] };
  const args = { paie: paie, fiche: { declare: true, baselineJours: 606 },
    jours: 10, baremes, dateISO: '2026-07-15' };
  const sans = CMO.paieOuvrier(args);
  const zero = CMO.paieOuvrier(Object.assign({}, args, { joursDepuisSocle: 0 }));
  assert.strictEqual(sans.brut, zero.brut);
});

test('ancienneté — un cumul insuffisant ne fait PAS franchir le seuil', () => {
  // Matricule 2296 : socle 599, et 18 journées seulement depuis le début de
  // campagne. À 617 il reste sous les 624 — c'est en partant du SOCLE (50
  // journées) qu'il franchit. Le point de départ du cumul compte.
  const baremes = { smagBrutJournalier: 97.44, smagNetJournalier: 90.88,
    tauxCnssSalariale: 0.0448, tauxAmo: 0.0226, tauxChargesPatronales: 0.1926,
    paliers: [{ seuilJours: 624, pourcentage: 5 }] };
  const args = { paie: paie, fiche: { declare: true, baselineJours: 599 },
    jours: 10, baremes, dateISO: '2026-07-15' };
  const court = CMO.paieOuvrier(Object.assign({}, args, { joursDepuisSocle: 18 }));
  const complet = CMO.paieOuvrier(Object.assign({}, args, { joursDepuisSocle: 50 }));
  assert.strictEqual(court.brut, CMO.paieOuvrier(args).brut, '617 < 624');
  assert.ok(complet.brut > court.brut, '649 ≥ 624');
});
