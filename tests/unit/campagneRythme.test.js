'use strict';

// LES DEUX RESTES de la grille Campagne (LOT 3a) — public/lib/campagneRythme.js.
//
// Ce que ce fichier protège, dans l'ordre des choses qui se trompent en silence :
//   1. les TROIS CLASSES d'opération. Projeter zéro sur un saisonnier non
//      démarré annoncerait « rien à consommer » sur un budget entier restant :
//      c'est le bug que ces tests rendent impossible ;
//   2. le GRAIN OPÉRATION : une famille mixte (Ferti-irrigation = irrigation
//      continue + installation GAG saisonnière) ne se classe pas en bloc ;
//   3. le MINIMUM D'HISTORIQUE (3 quinzaines) et les quinzaines restantes
//      DÉRIVÉES (jamais un 24 en dur) ;
//   4. le PÉRIMÈTRE COMMUN aux deux séries : pas de budget / Ha inconnu → les
//      DEUX restes valent « — », jamais 0, et jamais l'un sans l'autre ;
//   5. la NON-RÉGRESSION du réalisé et du budget : decoreRestes ne touche ni
//      l'ordre des lignes, ni les valeurs déjà présentes.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const CR = require(path.join(ROOT, 'public/lib/campagneRythme.js'));
const CBP = require(path.join(ROOT, 'public/lib/campagneBudgetPivot.js'));
const AU = require(path.join(ROOT, 'public/lib/analytiqueUtils.js'));
const backend = require(path.join(ROOT, 'functions/lib/campagneBudget/validate.js'));

const REGLES = { familleTotal: backend.familleTotal, splitOpKey: backend.splitOpKey };

// ---------------------------------------------------------------------------
// quinzaineNum / totalQuinzaines / quinzainesInfo
// ---------------------------------------------------------------------------

test('quinzaineNum lit le numéro du libellé', () => {
  assert.strictEqual(CR.quinzaineNum('Quinzaine 01'), 1);
  assert.strictEqual(CR.quinzaineNum('Quinzaine 24'), 24);
  assert.strictEqual(CR.quinzaineNum('n/a'), 0);
  assert.strictEqual(CR.quinzaineNum(null), 0);
});

test('totalQuinzaines est DÉRIVÉ du libellé de campagne, jamais 24 en dur', () => {
  assert.strictEqual(CR.totalQuinzaines('2026/2027'), 24);   // format de l'API
  assert.strictEqual(CR.totalQuinzaines('2026-2027'), 24);   // format campagneUtils
  // Campagne de 2 ans : la règle suit, un 24 en dur aurait menti.
  assert.strictEqual(CR.totalQuinzaines('2026-2028'), 48);
  assert.strictEqual(CR.totalQuinzaines('bizarre'), null);
});

test('quinzainesInfo : restantes = total − DERNIÈRE quinzaine vue (pas leur nombre)', () => {
  // Q03 sans le moindre pointage : elle est écoulée quand même. La compter
  // comme « à venir » gonflerait le reste au rythme d'une quinzaine entière.
  const q = CR.quinzainesInfo({
    periodes: ['Quinzaine 01', 'Quinzaine 02', 'Quinzaine 04'],
    campagne: '2026/2027',
  });
  assert.strictEqual(q.ecoulees, 4);
  assert.strictEqual(q.consommees, 3);
  assert.strictEqual(q.restantes, 20);
  assert.strictEqual(q.projetable, true);
});

test('quinzainesInfo : moins de 3 quinzaines consommées → non projetable', () => {
  const q = CR.quinzainesInfo({ periodes: ['Quinzaine 01', 'Quinzaine 02'], campagne: '2026/2027' });
  assert.strictEqual(q.projetable, false);
});

test('quinzainesInfo : campagne illisible → restantes null, non projetable', () => {
  const q = CR.quinzainesInfo({ periodes: ['Quinzaine 01', 'Quinzaine 02', 'Quinzaine 03'], campagne: '' });
  assert.strictEqual(q.restantes, null);
  assert.strictEqual(q.projetable, false);
});

// ---------------------------------------------------------------------------
// indexClasses / classeOf
// ---------------------------------------------------------------------------

const FICHES = [
  { code: 'GB02', operation: 'Irrigation & fertigation', classe_rythme: 'continu' },
  { code: 'GB02', operation: 'Installation GAG', classe_rythme: 'saisonnier' },
  { code: 'GB08', operation: 'Récolte manuelle (kg)', classe_rythme: 'recolte' },
  { code: 'GB09', operation: 'Taille', classe_rythme: 'saisonnier' },
  { code: 'GB09', operation: 'Pincements', classe_rythme: 'saisonnier' },
  // Le MÊME libellé sous deux codes, avec deux classes : « Nettoyage » existe
  // en GB05 (structure) et en GB11 (ménage de ferme) dans le référentiel réel.
  { code: 'GB05', operation: 'Nettoyage', classe_rythme: 'saisonnier' },
  { code: 'GB11', operation: 'Nettoyage', classe_rythme: 'continu' },
  { code: 'GB07', operation: 'Palissage' },   // fiche sans classe → inconnue
];
const CLASSES = CR.indexClasses(FICHES, AU.opKey);

test('classeOf : le CODE départage deux libellés identiques', () => {
  assert.strictEqual(CR.classeOf(CLASSES, 'GB05', 'Nettoyage', AU.opKey), 'saisonnier');
  assert.strictEqual(CR.classeOf(CLASSES, 'GB11', 'Nettoyage', AU.opKey), 'continu');
  // Sans code : libellé ambigu → aucune classe élue (surtout pas la première lue).
  assert.strictEqual(CR.classeOf(CLASSES, '', 'Nettoyage', AU.opKey), null);
});

test('classeOf : fiche sans classe, ou opération absente → null (jamais un défaut deviné)', () => {
  assert.strictEqual(CR.classeOf(CLASSES, 'GB07', 'Palissage', AU.opKey), null);
  assert.strictEqual(CR.classeOf(CLASSES, 'GB01', 'Billonage', AU.opKey), null);
});

test('classeOf normalise comme le pivot (casse, tirets, préfixe numérique)', () => {
  assert.strictEqual(CR.classeOf(CLASSES, 'GB02', '2. irrigation & FERTIGATION', AU.opKey), 'continu');
});

test('classeFamille : uniquement si toutes les fiches du code sont unanimes', () => {
  assert.strictEqual(CR.classeFamille(CLASSES, 'GB09'), 'saisonnier');
  assert.strictEqual(CR.classeFamille(CLASSES, 'GB08'), 'recolte');
  assert.strictEqual(CR.classeFamille(CLASSES, 'GB02'), null);   // mixte
});

// ---------------------------------------------------------------------------
// resteBudgetCellule
// ---------------------------------------------------------------------------

test('resteBudgetCellule = budget × Ha − réalisé, sans plafonnement', () => {
  assert.strictEqual(CR.resteBudgetCellule({ budget: 5, ha: 2, jh: 4 }), 6);
  // Dépassement : négatif, jamais ramené à 0.
  assert.strictEqual(CR.resteBudgetCellule({ budget: 5, ha: 2, jh: 14 }), -4);
});

test('resteBudgetCellule : pas de budget ou Ha inconnu → null (jamais 0)', () => {
  assert.strictEqual(CR.resteBudgetCellule({ ha: 2, jh: 4 }), null);
  assert.strictEqual(CR.resteBudgetCellule({ budget: 5, ha: 0, jh: 4 }), null);
  assert.strictEqual(CR.resteBudgetCellule(null), null);
});

test('resteBudgetCellule est l’opposé exact de ecartCell (d’où une seule des deux séries)', () => {
  const cell = { budget: 5, ha: 2, jh: 14 };
  assert.strictEqual(CR.resteBudgetCellule(cell), -CBP.ecartCell(cell));
});

// ---------------------------------------------------------------------------
// moyenneMobile
// ---------------------------------------------------------------------------

test('moyenneMobile : fenêtre GLISSANTE sur les dernières quinzaines écoulées', () => {
  const rows = [
    { periode: 'Quinzaine 01', jh: 100 },   // hors fenêtre
    { periode: 'Quinzaine 05', jh: 10 },
    { periode: 'Quinzaine 06', jh: 20 },
    { periode: 'Quinzaine 07', jh: 30 },
    { periode: 'Quinzaine 08', jh: 40 },
  ];
  // Fenêtre 4 sur 8 quinzaines écoulées → Q05..Q08 → (10+20+30+40)/4.
  assert.strictEqual(CR.moyenneMobile(rows, { ecoulees: 8, fenetre: 4 }), 25);
  // La Q01 à 100 JH est ignorée : une moyenne depuis le début dirait 40 et
  // masquerait le rythme réel des deux derniers mois.
  assert.notStrictEqual(CR.moyenneMobile(rows, { ecoulees: 8, fenetre: 4 }), 40);
});

test('moyenneMobile : une quinzaine sans travail est un ZÉRO du rythme, pas une absence', () => {
  const rows = [{ periode: 'Quinzaine 08', jh: 40 }];
  // Diviseur = 4 (la fenêtre), pas 1 (la seule quinzaine travaillée).
  assert.strictEqual(CR.moyenneMobile(rows, { ecoulees: 8, fenetre: 4 }), 10);
});

test('moyenneMobile : fenêtre tronquée en début de campagne', () => {
  const rows = [{ periode: 'Quinzaine 01', jh: 6 }, { periode: 'Quinzaine 03', jh: 6 }];
  assert.strictEqual(CR.moyenneMobile(rows, { ecoulees: 3, fenetre: 4 }), 4);   // 12 / 3
  assert.strictEqual(CR.moyenneMobile(rows, { ecoulees: 0, fenetre: 4 }), null);
});

// ---------------------------------------------------------------------------
// decoreRestes — scénario complet, vérifié à la main
// ---------------------------------------------------------------------------
//
// Une parcelle P (2 Ha), campagne 2026/2027 (24 quinzaines), 8 quinzaines
// écoulées → 16 restantes, fenêtre 4 (Q05..Q08).
//
//  GB02 Ferti-irrigation — MIXTE
//    Irrigation & fertigation (continu)  : 4 JH par quinzaine de Q05 à Q08,
//                                          16 JH cumulés, budget 20 JH/Ha
//    Installation GAG (saisonnier)       : 6 JH cumulés (Q01), budget 5 JH/Ha
//    budget famille = 25 JH/Ha × 2 Ha = 50 JH ; réalisé = 22 JH
//      reste budgété   = 50 − 22 = 28
//      reste au rythme = continu (16/4=4 → 4 × 16 = 64)
//                      + saisonnier (5 × 2 − 6 = 4)  = 68
//      → 68 > 28 : dépassement projeté. C'est LE signal du lot.
//
//  GB09 Taille — SAISONNIER pur, budget 10 JH/Ha, réalisé 0
//      reste budgété = 20 ; reste au rythme = 20 (JAMAIS 0)
//
//  GB08 Récolte — budget 30 JH/Ha, réalisé 12 JH
//      reste budgété = 48 ; reste au rythme = « — » (jamais de projection)

const ROWS = [
  { parcelle: 'P', ha: 2, jh: 4, cout: 0, periode: 'Quinzaine 05',
    operation: 'Irrigation & fertigation', operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation' },
  { parcelle: 'P', ha: 2, jh: 4, cout: 0, periode: 'Quinzaine 06',
    operation: 'Irrigation & fertigation', operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation' },
  { parcelle: 'P', ha: 2, jh: 4, cout: 0, periode: 'Quinzaine 07',
    operation: 'Irrigation & fertigation', operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation' },
  { parcelle: 'P', ha: 2, jh: 4, cout: 0, periode: 'Quinzaine 08',
    operation: 'Irrigation & fertigation', operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation' },
  { parcelle: 'P', ha: 2, jh: 6, cout: 0, periode: 'Quinzaine 01',
    operation: 'Installation GAG', operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation' },
  { parcelle: 'P', ha: 2, jh: 12, cout: 0, periode: 'Quinzaine 07',
    operation: 'Récolte manuelle (kg)', operationGroupe: 'GB08', operationFamille: 'Récolte' },
];

const OP_BUDGETS = {
  P: { 'Ferti-irrigation': { 'GB02::Irrigation & fertigation': 20, 'GB02::Installation GAG': 5 } },
};
const BUDGETS = { P: { Taille: 10, 'Récolte': 30 } };

const QUINZ = CR.quinzainesInfo({
  periodes: ['Quinzaine 01', 'Quinzaine 05', 'Quinzaine 06', 'Quinzaine 07', 'Quinzaine 08'],
  campagne: '2026/2027',
});

function construire(detail) {
  const pivot = AU.buildAnalytiquePivotByFamille(ROWS, { detail: !!detail });
  const budgetIndex = CBP.indexBudgets({
    parcelles: pivot.parcelles,
    budgetsByLabel: BUDGETS,
    opBudgetsByLabel: OP_BUDGETS,
    analytique: AU,
    budgetRules: REGLES,
  });
  const sup = CBP.buildBudgetPivot({
    groupedRows: pivot.groupedRows,
    parcelles: pivot.parcelles,
    budgetsByLabel: BUDGETS,
    opBudgetsByLabel: OP_BUDGETS,
    analytique: AU,
    budgetRules: REGLES,
    detail: !!detail,
  });
  return CR.decoreRestes({
    groupedRows: sup.groupedRows,
    classes: CLASSES,
    quinzaines: QUINZ,
    budgetIndex: budgetIndex,
    analytique: AU,
    fenetre: 4,
  });
}

function ligne(res, key) {
  return res.groupedRows.filter((r) => r.key === key && r.type !== 'groupe')[0];
}

test('famille MIXTE : chaque opération selon SA classe (continu projeté + saisonnier budgété)', () => {
  const cell = ligne(construire(), 'GB02').pivot.P;
  assert.strictEqual(cell.resteBudget, 28);
  assert.strictEqual(cell.resteRythme, 68);
  // La divergence est l'alerte : la fusionner en un chiffre la ferait disparaître.
  assert.ok(cell.resteRythme > cell.resteBudget);
});

test('famille SAISONNIÈRE non démarrée : reste au rythme = reste budgété, JAMAIS 0', () => {
  const cell = ligne(construire(), 'GB09').pivot.P;   // ligne ajoutée par le budget
  assert.strictEqual(cell.jh, 0);
  assert.strictEqual(cell.resteBudget, 20);
  assert.strictEqual(cell.resteRythme, 20);
});

test('RÉCOLTE : jamais de projection, même budgétée et travaillée', () => {
  const cell = ligne(construire(), 'GB08').pivot.P;
  assert.strictEqual(cell.resteBudget, 48);
  assert.strictEqual(cell.resteRythme, undefined);   // « — » à l'affichage
});

test('mode Détail : la ligne opération continue porte sa propre projection', () => {
  const res = construire(true);
  const irrig = res.groupedRows.filter(
    (r) => r.type === 'operation' && r.key === 'GB02::' + AU.opKey('Irrigation & fertigation'))[0];
  // budget 20 JH/Ha × 2 Ha − 16 JH = 24 ; rythme 4 JH/quinzaine × 16 = 64.
  assert.strictEqual(irrig.pivot.P.resteBudget, 24);
  assert.strictEqual(irrig.pivot.P.resteRythme, 64);
  const gag = res.groupedRows.filter(
    (r) => r.type === 'operation' && r.key === 'GB02::' + AU.opKey('Installation GAG'))[0];
  assert.strictEqual(gag.pivot.P.resteBudget, 4);
  assert.strictEqual(gag.pivot.P.resteRythme, 4);    // saisonnier → son reste budgété
});

test('périmètre : compte des familles projetées + familles écartées nommées', () => {
  const res = construire();
  assert.strictEqual(res.perimetre.famillesBudgetees, 3);
  assert.strictEqual(res.perimetre.famillesProjetees, 2);
  assert.deepStrictEqual(res.perimetre.nonProjetees, ['Récolte']);
  const note = CR.noteRestes(res.perimetre, QUINZ, 4);
  assert.match(note, /2 familles budgétées sur 3/);
  assert.match(note, /Récolte/);
  assert.match(note, /16 quinzaines restantes/);
});

test('PÉRIMÈTRE COMMUN : pas de budget → les DEUX restes absents (jamais l’un sans l’autre)', () => {
  const rows = [{ parcelle: 'P', ha: 2, jh: 4, periode: 'Quinzaine 08',
    operation: 'Irrigation & fertigation', operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation' }];
  const pivot = AU.buildAnalytiquePivotByFamille(rows, {});
  const res = CR.decoreRestes({
    groupedRows: pivot.groupedRows, classes: CLASSES, quinzaines: QUINZ, analytique: AU, fenetre: 4,
  });
  const cell = ligne(res, 'GB02').pivot.P;
  assert.strictEqual(cell.resteBudget, undefined);
  assert.strictEqual(cell.resteRythme, undefined);
  assert.strictEqual(res.perimetre.famillesBudgetees, 0);
});

test('Ha inconnu (F2 - ZUTANO en production) : les deux restes restent « — »', () => {
  const rows = [{ parcelle: 'P0', ha: 0, jh: 4, periode: 'Quinzaine 08',
    operation: 'Irrigation & fertigation', operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation' }];
  const pivot = AU.buildAnalytiquePivotByFamille(rows, {});
  const sup = CBP.buildBudgetPivot({
    groupedRows: pivot.groupedRows, parcelles: pivot.parcelles,
    budgetsByLabel: { P0: { 'Ferti-irrigation': 20 } }, opBudgetsByLabel: {},
    analytique: AU, budgetRules: REGLES,
  });
  const res = CR.decoreRestes({
    groupedRows: sup.groupedRows, classes: CLASSES, quinzaines: QUINZ, analytique: AU, fenetre: 4,
  });
  const cell = ligne(res, 'GB02').pivot.P0;
  assert.strictEqual(cell.budget, 20);          // le budget JH/Ha reste lisible
  assert.strictEqual(cell.resteBudget, undefined);
  assert.strictEqual(cell.resteRythme, undefined);
});

test('minimum d’historique : 2 quinzaines consommées → aucune projection, budget inchangé', () => {
  const q = CR.quinzainesInfo({ periodes: ['Quinzaine 01', 'Quinzaine 02'], campagne: '2026/2027' });
  const res = CR.decoreRestes({
    groupedRows: CBP.buildBudgetPivot({
      groupedRows: AU.buildAnalytiquePivotByFamille(ROWS, {}).groupedRows,
      parcelles: AU.buildAnalytiquePivotByFamille(ROWS, {}).parcelles,
      budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS, analytique: AU, budgetRules: REGLES,
    }).groupedRows,
    classes: CLASSES, quinzaines: q, analytique: AU, fenetre: 4,
  });
  const cell = ligne(res, 'GB02').pivot.P;
  assert.strictEqual(cell.resteBudget, 28);        // le reste budgété, lui, existe
  assert.strictEqual(cell.resteRythme, undefined); // « — » : pas assez d'historique
  assert.match(CR.noteRestes(res.perimetre, q, 4), /Aucune projection/);
});

test('classe INCONNUE sur une opération → la famille entière passe à « — »', () => {
  const rows = [{ parcelle: 'P', ha: 2, jh: 4, periode: 'Quinzaine 08',
    operation: 'Palissage', operationGroupe: 'GB07', operationFamille: 'Tuteurage & palissage' }];
  const pivot = AU.buildAnalytiquePivotByFamille(rows, {});
  const sup = CBP.buildBudgetPivot({
    groupedRows: pivot.groupedRows, parcelles: pivot.parcelles,
    budgetsByLabel: { P: { 'Tuteurage & palissage': 10 } }, opBudgetsByLabel: {},
    analytique: AU, budgetRules: REGLES,
  });
  const res = CR.decoreRestes({
    groupedRows: sup.groupedRows, classes: CLASSES, quinzaines: QUINZ, analytique: AU, fenetre: 4,
  });
  const cell = ligne(res, 'GB07').pivot.P;
  assert.strictEqual(cell.resteBudget, 16);
  assert.strictEqual(cell.resteRythme, undefined);
  assert.deepStrictEqual(res.perimetre.nonProjetees, ['Tuteurage & palissage']);
});

test('NON-RÉGRESSION : ni l’ordre des lignes, ni le réalisé, ni le budget ne bougent', () => {
  const pivot = AU.buildAnalytiquePivotByFamille(ROWS, { detail: true });
  const sup = CBP.buildBudgetPivot({
    groupedRows: pivot.groupedRows, parcelles: pivot.parcelles,
    budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS,
    analytique: AU, budgetRules: REGLES, detail: true,
  });
  const avant = JSON.parse(JSON.stringify(sup.groupedRows.map((r) => ({
    key: r.key, type: r.type, cells: Object.keys(r.pivot || {}).map((p) => ({
      p: p, jh: r.pivot[p].jh, cout: r.pivot[p].cout,
      // `?? null` : JSON.stringify efface les clés `undefined`, la comparaison
      // ne verrait pas un budget qui DISPARAÎT.
      budget: r.pivot[p].budget === undefined ? null : r.pivot[p].budget,
    })),
  }))));
  const res = CR.decoreRestes({
    groupedRows: sup.groupedRows, classes: CLASSES, quinzaines: QUINZ,
    budgetIndex: CBP.indexBudgets({
      parcelles: pivot.parcelles, budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS,
      analytique: AU, budgetRules: REGLES,
    }),
    analytique: AU, fenetre: 4,
  });
  const apres = res.groupedRows.map((r) => ({
    key: r.key, type: r.type, cells: Object.keys(r.pivot || {}).map((p) => ({
      p: p, jh: r.pivot[p].jh, cout: r.pivot[p].cout,
      // `?? null` : JSON.stringify efface les clés `undefined`, la comparaison
      // ne verrait pas un budget qui DISPARAÎT.
      budget: r.pivot[p].budget === undefined ? null : r.pivot[p].budget,
    })),
  }));
  assert.deepStrictEqual(apres, avant);
  // Et les lignes SOURCE n'ont pas été mutées.
  assert.strictEqual(sup.groupedRows[1].pivot.P.resteBudget, undefined);
});
