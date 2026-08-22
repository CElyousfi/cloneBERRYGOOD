/*
 * coutOuvrierCampagne.test.js — le coût ouvrier CHARGÉ, moyenné sur la campagne.
 *
 * Formule arrêtée avec Omar (2026-08-20) : base BEE ONE + prime de fonction +
 * ancienneté + heures sup + jours fériés = assiette de cotisation ; + charges
 * patronales sur les seuls déclarés ; + primes de terrain (transport, récolte,
 * traitement, conditionnement, chargement), hors assiette.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *  1. le SALAIRE est calculé par le modèle Smart Berry (SMAG daté), BEE ONE ne
 *     fournissant que les JOURNÉES. Le `Cout` BEE ONE reste suivi à part, comme
 *     témoin du rapprochement et pour le facteur de charge ;
 *  2. les CHARGES ne portent QUE sur les déclarés, et QUE sur l'assiette
 *     (jamais sur les primes de terrain) — part patronale ET part salariale,
 *     cette dernière étant un coût entreprise puisqu'elle n'est pas retenue ;
 *  3. le TRANSPORT est dû par JOUR travaillé — l'ajouter une fois par quinzaine
 *     sous-comptait ~28 DH sur ~146, soit 19 % du coût réel ;
 *  4. l'ANCIENNETÉ se cumule d'une quinzaine à l'autre ;
 *  5. une JOURNÉE compte une fois par ouvrier, quel que soit le nombre de lignes ;
 *  6. aucune journée pointée → `null`, jamais 0 : « pas de donnée » n'est pas
 *     « coût nul », et un 0 propagé rendrait tous les budgets DH nuls.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const M = require(path.join(__dirname, '../coutOuvrierCampagne.js'));
const { PAIE_BAREMES_DEFAULT: B } = require(path.join(__dirname, '../paieUtils.js'));

const EQUIPES = [
  { prefix: 'AB', equipe: 'Équipe AB', coutParOuvrier: 20 },
  { prefix: 'HA', equipe: 'Hafid', coutParOuvrier: 15 },
];

/** Une journée BEE ONE type : ~97,44 DH de salaire de base. */
const BASE_JOUR = 97.44;

function quinzaine(periode, dateFin, parOuvrier) {
  return { periode, dateFin, parOuvrier };
}
/** Ouvrier d'une quinzaine : N journées de base BEE ONE, sans HS ni prime. */
function ouvrier(jours, extra) {
  return Object.assign({
    jours: new Set(jours),
    // Par défaut 1 JH par journée calendaire — le cas courant. Les tests qui
    // veulent des demi-journées surchargent `jh`.
    jh: jours.length,
    hs25: 0, hs50: 0, hs100: 0,
    base: BASE_JOUR * jours.length,
  }, extra || {});
}
function campagne(args) {
  return M.coutOuvrierCampagne(Object.assign({ baremes: B, equipesTransport: EQUIPES }, args));
}

test('prefixeEquipe — le préfixe doit désigner une équipe RÉELLE', () => {
  // Le commentaire précédent affirmait « règle reprise à l'identique du front ».
  // C'était faux, et c'était le défaut : un matricule numérique — la majorité de
  // l'effectif — recevait ici l'équipe « BGF » par défaut, alors que l'écran
  // Quinzaine le classe inconnu et ne lui donne aucune prime de transport. Deux
  // écrans, deux transports, pour les mêmes ouvriers.
  //
  // On ne devine plus : sans équipe correspondante, pas d'équipe. C'est aussi ce
  // que fait la feuille TRANSPORT du bulletin, qui ne liste que des équipes
  // nommées.
  assert.strictEqual(M.prefixeEquipe('AB1234', EQUIPES), 'AB');
  assert.strictEqual(M.prefixeEquipe('hafi007', EQUIPES), 'HA');
  assert.strictEqual(M.prefixeEquipe('123456', EQUIPES), null);
  assert.strictEqual(M.prefixeEquipe('', EQUIPES), null);
  // Préfixe alphabétique mais inconnu de la liste : pas d'équipe non plus.
  assert.strictEqual(M.prefixeEquipe('QQ42', EQUIPES), null);
});

test('primeTransport — un matricule numérique ne reçoit RIEN', () => {
  // La régression qu'on corrige : ces ouvriers touchaient la prime de l'équipe
  // BGF côté campagne et rien côté Quinzaine.
  assert.strictEqual(M.primeTransport('123456', EQUIPES), 0);
  assert.strictEqual(M.primeTransport('10502', EQUIPES), 0);
});

test('primeTransport — le tarif vit dans `history`, pas dans le champ plat', () => {
  // LA régression qui amputait le coût de campagne : `transport-config-apply`
  // réécrit chaque équipe modifiée SANS `coutParOuvrier`. Lire le champ plat
  // renvoyait `undefined` → 0 DH de transport pour toute équipe déjà passée par
  // l'écran RH. Ce test tient sur une équipe qui n'a QUE de l'historique.
  const eqHist = [{ prefix: 'AB', equipe: 'Équipe AB', history: [
    { effectiveFrom: '01/07/2026 - 15/07/2026', coutParOuvrier: 20 },
    { effectiveFrom: '16/07/2026 - 31/07/2026', coutParOuvrier: 26 },
  ] }];
  // On compare des DATES ISO, jamais des libellés de quinzaine.
  assert.strictEqual(M.primeTransport('AB1', eqHist, '2026-07-15'), 20);
  assert.strictEqual(M.primeTransport('AB1', eqHist, '2026-07-31'), 26);
  // Sans date : le tarif le plus récent.
  assert.strictEqual(M.primeTransport('AB1', eqHist), 26);
});

test('tarifADate — un libellé « Quinzaine NN » ne doit RIEN écarter', () => {
  // La régression du 2026-08-22 : `effectiveFrom` est une DATE, la quinzaine de
  // campagne un ORDINAL (« Quinzaine 01 »). Les comparer écartait toute
  // l'historique et ramenait le transport à 0, sans erreur ni trace. Le module
  // ne prend donc plus que des dates ISO — et une chaîne qui n'en est pas une
  // ne peut plus faire disparaître un tarif.
  const eq = { history: [{ effectiveFrom: '01/07/2026 - 15/07/2026', coutParOuvrier: 20 }] };
  assert.strictEqual(M.tarifADate(eq, 'Quinzaine 01'), 20);
});

test('tarifADate — historique ORDINAL seul : le dernier tarif saisi, pas 0', () => {
  // DONNÉE RÉELLE (rh_config/transport_primes, 2026-08-22) : `effectiveFrom`
  // mélange deux formats, et les ORDINAUX sont MAJORITAIRES. Aucune équipe ne
  // porte de `coutParOuvrier` plat. Ne retenir que les entrées datées revenait
  // donc à n'en retenir aucune : le tarif tombait à 0 et le transport
  // disparaissait du coût de campagne.
  //
  // Un ordinal ne s'ordonne pas contre une date — « Quinzaine 23 » désigne une
  // quinzaine de la campagne PRÉCÉDENTE, donc antérieure à « Quinzaine 01 » de
  // celle-ci, alors que 23 > 1. On retient la dernière entrée écrite : une
  // valeur mesurée, là où 0 est une valeur inventée.
  const ha = { history: [
    { effectiveFrom: 'Quinzaine 23', coutParOuvrier: 35 },
    { effectiveFrom: 'Quinzaine 24', coutParOuvrier: 30 },
  ] };
  assert.strictEqual(M.tarifADate(ha, '2026-07-15'), 30);
});

test('tarifADate — formats MÉLANGÉS : la date l\'emporte sur l\'ordinal', () => {
  // Équipe MM en production : deux ordinaux et une plage datée. La plage est la
  // seule information ordonnable contre la quinzaine payée, elle décide.
  const mm = { history: [
    { effectiveFrom: 'Quinzaine 23', coutParOuvrier: 35 },
    { effectiveFrom: '16/06/2026 - 30/06/2026', coutParOuvrier: 30 },
    { effectiveFrom: 'Quinzaine 24', coutParOuvrier: 99 },
  ] };
  assert.strictEqual(M.tarifADate(mm, '2026-07-15'), 30);
});

test('tarifADate — plusieurs dates applicables : la plus récente', () => {
  // Équipe LG en production.
  const lg = { history: [
    { effectiveFrom: '01/06/2026 - 15/06/2026', coutParOuvrier: 40 },
    { effectiveFrom: 'Quinzaine 24', coutParOuvrier: 35 },
    { effectiveFrom: '01/07/2026 - 15/07/2026', coutParOuvrier: 35 },
  ] };
  assert.strictEqual(M.tarifADate(lg, '2026-07-15'), 35);
  // Avant la seconde prise d'effet, c'est encore la première qui vaut.
  assert.strictEqual(M.tarifADate(lg, '2026-06-20'), 40);
});

test('tarifADate — une équipe explicitement à 0 reste à 0', () => {
  // « BGF » porte un tarif de 0 en production. Le repli ne doit pas lui
  // inventer un montant : 0 est ici une valeur SAISIE, pas une lacune.
  assert.strictEqual(M.tarifADate({ history: [
    { effectiveFrom: 'Quinzaine 23', coutParOuvrier: 0 },
  ] }, '2026-07-15'), 0);
});

test('tarifADate — historique absent : on retombe sur le champ plat', () => {
  // Les équipes jamais modifiées depuis l'écran RH n'ont pas d'historique.
  // Les ignorer les priverait de transport pour la raison inverse.
  assert.strictEqual(M.tarifADate({ coutParOuvrier: 15 }, '2026-07-15'), 15);
  assert.strictEqual(M.tarifADate({}, '2026-07-15'), 0);
});

test('dateEffet — extrait le PREMIER jour de la plage', () => {
  assert.strictEqual(M.dateEffet('01/07/2026 - 15/07/2026'), '2026-07-01');
  assert.strictEqual(M.dateEffet('Quinzaine 01'), '');
  assert.strictEqual(M.dateEffet(''), '');
});

test('primeTransport — équipe inconnue → 0, jamais un montant deviné', () => {
  assert.strictEqual(M.primeTransport('AB1', EQUIPES), 20);
  assert.strictEqual(M.primeTransport('HAFI9', EQUIPES), 15);
  assert.strictEqual(M.primeTransport('ZZ9', EQUIPES), 0);
});

test('cumuleJournee — une journée par ouvrier, base et heures sup sommées', () => {
  const acc = {};
  // Même ouvrier, même jour, trois parcelles : il a travaillé UN jour, mais son
  // coût BEE ONE est bien la somme des trois lignes.
  M.cumuleJournee(acc, [
    { Personnel_Matricule: 'AB1', HS_25: 1, Cout: 40 },
    { Personnel_Matricule: 'AB1', HS_25: 2, Cout: 30 },
    { Personnel_Matricule: 'AB1', HS_50: 1, Cout: 27.44 },
  ], '2026-07-01');
  M.cumuleJournee(acc, [{ Personnel_Matricule: 'AB1', Cout: 97.44 }], '2026-07-02');
  assert.strictEqual(acc.AB1.jours.size, 2);
  assert.strictEqual(acc.AB1.hs25, 3);
  assert.strictEqual(acc.AB1.hs50, 1);
  assert.strictEqual(Math.round(acc.AB1.base * 100) / 100, 194.88);
  // Ligne sans matricule : ignorée, jamais un ouvrier fantôme.
  M.cumuleJournee(acc, [{ Personnel_Matricule: '   ', Cout: 999 }], '2026-07-03');
  assert.deepStrictEqual(Object.keys(acc), ['AB1']);
});

test('paie — le SALAIRE vient du barème Smart Berry, BEE ONE ne donne que les jours', () => {
  // BEE ONE facture ces deux journées 240 DH ; Smart Berry, lui, les paie au
  // SMAG daté (2 × 97,44). C'est le barème maison qui fait foi — celui des
  // fiches de paie réellement éditées. Le `Cout` BEE ONE reste suivi à part.
  const out = campagne({
    registre: { ZZ9: { declare: false } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      ZZ9: { jours: new Set(['2026-07-01', '2026-07-02']), jh: 2,
        hs25: 0, hs50: 0, hs100: 0, base: 240 },
    })],
  });
  assert.strictEqual(out.detail.baseBeeOne, 240, 'témoin BEE ONE conservé');
  assert.strictEqual(Math.round(out.detail.salaire * 100) / 100, 194.88, '2 × SMAG');
  // Non déclaré : il touche le NET, et rien n'est reversé — son coût EST son net.
  assert.strictEqual(Math.round(out.coutTotal * 100) / 100,
    Math.round(194.88 * 0.9326 * 100) / 100,
    'non déclaré, hors équipe : aucun ajout');
  assert.strictEqual(Math.round(out.coutMoyenJour * 100) / 100,
    Math.round(97.44 * 0.9326 * 100) / 100);
});

test('paie — charges patronales : seulement les déclarés, seulement l\'assiette', () => {
  const q = (mat) => quinzaine('Q01', '2026-07-15', {
    [mat]: ouvrier(['2026-07-01'], { primes: { recolte: 50 } }),
  });
  const declare = campagne({ registre: { AB1: { declare: true } }, quinzaines: [q('AB1')] });
  const nonDeclare = campagne({ registre: { AB2: { declare: false } }, quinzaines: [q('AB2')] });

  // Assiette du déclaré = base seule (ni ancienneté ici, ni HS, ni férié).
  // 97,44 × 19,26 % = 18,77 — et surtout PAS (97,44 + 50 + 20) × 19,26 % :
  // les primes de terrain sont hors assiette.
  assert.strictEqual(Math.round(declare.detail.chargesPatronales * 100) / 100, 18.77);
  assert.strictEqual(nonDeclare.detail.chargesPatronales, 0);
  // Cotisations SALARIALES (CNSS 4,48 % + AMO 2,26 %) : comptées elles aussi
  // comme un coût entreprise, parce que l'ouvrier est payé sur le brut SANS
  // retenue — ce que la loi prélèverait, la société le verse en plus.
  assert.strictEqual(Math.round(declare.detail.cotisationsSalariales * 100) / 100,
    Math.round(97.44 * 0.0674 * 100) / 100);
  assert.strictEqual(nonDeclare.detail.cotisationsSalariales, 0);
  // Les deux portent les mêmes primes de terrain (elles ne dépendent pas du statut).
  assert.strictEqual(declare.detail.transport, nonDeclare.detail.transport);
  assert.strictEqual(declare.detail.recolte, 50);
  assert.strictEqual(declare.partDeclares, 1);
  assert.strictEqual(nonDeclare.partDeclares, 0);
});

test('paie — le coût réel d\'une journée type, terme par terme', () => {
  // Le cas de référence, celui qu'Omar recoupera avec une fiche de paie :
  // ouvrier déclaré, une journée, équipe AB (20 DH de transport).
  const out = campagne({
    registre: { AB1: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', { AB1: ouvrier(['2026-07-01']) })],
  });
  const r = (v) => Math.round(v * 100) / 100;
  assert.strictEqual(r(out.detail.salaire), 97.44);
  assert.strictEqual(r(out.detail.chargesPatronales), 18.77);
  assert.strictEqual(r(out.detail.cotisationsSalariales), 6.57);
  assert.strictEqual(r(out.detail.transport), 20);
  // La part salariale (6,57) n'est PLUS un terme du coût : l'ouvrier touche le
  // net et l'entreprise la reverse à la CNSS — elle est donc déjà dans le brut.
  // L'ajouter la comptait deux fois (correction du 2026-08-21).
  // Les termes sont arrondis pour l'affichage, jamais dans le calcul.
  assert.strictEqual(r(out.coutMoyenJour), 136.21,
    'base 97,44 + patronales 18,77 + transport 20');
});

test('transport — la prime est due PAR JOUR TRAVAILLÉ, pas une fois par quinzaine', () => {
  // RÉGRESSION (2026-08-20) : ajoutée une seule fois par quinzaine, la prime
  // était divisée par ~13 et le coût moyen sortait ~19 % trop bas. C'est Omar
  // qui a tiqué sur le chiffre.
  const out = campagne({
    registre: { AB1: { declare: false } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01', '2026-07-02', '2026-07-03']),
    })],
  });
  assert.strictEqual(out.detail.transport, 60, '20 DH × 3 jours');
});

test('transport — un ouvrier hors équipe listée n\'en porte aucune', () => {
  const out = campagne({
    registre: { ZZ9: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', { ZZ9: ouvrier(['2026-07-01']) })],
  });
  assert.strictEqual(out.detail.transport, 0);
});

test('primes de terrain — récolte, traitement, conditionnement, chargement', () => {
  const out = campagne({
    registre: { AB1: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01'], {
        primes: { recolte: 90, traitement: 10, conditionnement: 10, chargement: 10 },
      }),
    })],
  });
  assert.strictEqual(out.detail.recolte, 90);
  assert.strictEqual(out.detail.traitement, 10);
  assert.strictEqual(out.detail.conditionnement, 10);
  assert.strictEqual(out.detail.chargement, 10);
  // Ces primes-là sont HORS assiette : les charges ne portent que sur le salaire.
  assert.strictEqual(Math.round(out.detail.chargesPatronales * 100) / 100,
    Math.round((97.44 * 0.1926) * 100) / 100);
});

test('jour férié — compté en JOURS, valorisé par le barème, DANS l\'assiette', () => {
  // ARBITRAGE 2026-08-21 : le férié ne vaut plus le coût journalier moyen
  // BEE ONE (110,6 DH) mais ce que le barème lui donne (SMAG + prime de
  // fonction + effet ancienneté), calculé par différence. C'était le dernier
  // endroit où de l'argent BEE ONE entrait dans le coût de campagne.
  const out = campagne({
    registre: { AB1: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01'], { feriesJours: 1 }),
    })],
  });
  // Un ouvrier sans prime de fonction : le férié vaut exactement un SMAG.
  assert.strictEqual(Math.round(out.detail.feries * 100) / 100, 97.44);
  // Et il entre dans l'assiette : charges sur (base + férié).
  assert.strictEqual(Math.round(out.detail.chargesPatronales * 100) / 100,
    Math.round((97.44 * 2 * 0.1926) * 100) / 100);
  assert.strictEqual(Math.round(out.detail.cotisationsSalariales * 100) / 100,
    Math.round((97.44 * 2 * 0.0674) * 100) / 100);
});

test('taux PAR OUVRIER — la grille Campagne valorise au coût de CHAQUE ouvrier', () => {
  // C'est ce que le lot 2 consomme : sans lui, chaque ligne de la grille était
  // valorisée à une moyenne d'établissement, et deux parcelles travaillées par
  // des équipes de coûts différents ressortaient au même prix.
  const out = campagne({
    registre: { AB1: { declare: true }, ZZ9: { declare: false } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01', '2026-07-02']),
      ZZ9: ouvrier(['2026-07-01']),
    })],
  });
  const tauxDeclare = out.tauxParOuvrier['AB1|Q01'];
  const tauxNonDeclare = out.tauxParOuvrier['ZZ9|Q01'];
  assert.ok(tauxDeclare > 0 && tauxNonDeclare > 0);
  // Déclarer coûte plus cher à JH égal : c'est tout l'intérêt d'un taux par
  // ouvrier plutôt que d'une moyenne qui écrase la différence.
  assert.ok(tauxDeclare > tauxNonDeclare,
    'déclaré ' + tauxDeclare.toFixed(2) + ' vs non déclaré ' + tauxNonDeclare.toFixed(2));
  // Le taux se recompose : taux × JH = ce que l'ouvrier coûte.
  const q = out.parQuinzaine[0];
  const somme = tauxDeclare * 2 + tauxNonDeclare * 1;
  assert.strictEqual(Math.round(somme * 1e6) / 1e6, Math.round(q.coutTotal * 1e6) / 1e6);
});

test('coût — l\'ancienneté se CUMULE d\'une quinzaine à l\'autre', () => {
  const registre = { AB1: { declare: true, baselineJours: 623 } };
  const q = (p, f, jours) => quinzaine(p, f, { AB1: ouvrier(jours) });
  // Palier à 624 jours (+5 %) : la 1re quinzaine est sous le seuil, la 2e le
  // franchit GRÂCE aux jours de la 1re. Sans cumul, la prime resterait nulle.
  const out = campagne({
    registre,
    quinzaines: [
      q('Q01', '2026-07-15', ['2026-07-01']),
      q('Q02', '2026-07-31', ['2026-08-01']),
    ],
  });
  assert.strictEqual(Math.round(out.detail.primeAnciennete * 100) / 100,
    Math.round(97.44 * 0.05 * 100) / 100, 'une seule des deux quinzaines primée');
});

test('coût — moyenne par JOURNÉE pointée, pas par ouvrier', () => {
  const out = campagne({
    registre: { AB1: { declare: true }, AB2: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01', '2026-07-02', '2026-07-03']),
      AB2: ouvrier(['2026-07-01']),
    })],
  });
  assert.strictEqual(out.jours, 4);
  assert.strictEqual(out.ouvriers, 2);
  assert.strictEqual(out.coutMoyenJour, out.coutTotal / 4);
  // …et non la moyenne des deux coûts d'ouvrier (qui pèserait AB2 autant qu'AB1).
});

test('coût — aucune journée pointée : `null`, jamais 0', () => {
  const vide = campagne({ registre: {}, quinzaines: [] });
  assert.strictEqual(vide.coutMoyenJour, null, 'un 0 rendrait tous les budgets DH nuls');
  assert.strictEqual(vide.coutTotal, 0);
  assert.strictEqual(vide.partDeclares, null);
  const sansJour = campagne({
    registre: { AB1: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', { AB1: ouvrier([]) })],
  });
  assert.strictEqual(sansJour.coutMoyenJour, null);
  assert.strictEqual(sansJour.ouvriers, 0);
});

test('coût — un ouvrier absent du registre est traité en NON déclaré', () => {
  // Fail-closed : sans fiche, on ne peut pas affirmer qu'il est déclaré. On ne
  // le jette pas pour autant — ses journées sont réelles et sa base aussi.
  const out = campagne({
    registre: {},
    quinzaines: [quinzaine('Q01', '2026-07-15', { AB1: ouvrier(['2026-07-01']) })],
  });
  assert.strictEqual(out.jours, 1);
  assert.strictEqual(out.detail.chargesPatronales, 0);
  assert.strictEqual(out.detail.primeAnciennete, 0);
  assert.ok(out.coutTotal > 0);
});

test('coût — le détail se recompose exactement dans le total', () => {
  const out = campagne({
    registre: { AB1: { declare: true, baselineJours: 1600, primeFonctionJournaliere: 15 },
      ZZ9: { declare: false } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01', '2026-07-02'], {
        hs25: 4, primes: { recolte: 30, chargement: 10, feries: 97.44 },
      }),
      ZZ9: ouvrier(['2026-07-01']),
    })],
  });
  const d = out.detail;
  // La part salariale n'apparaît PLUS comme un terme du total : elle est déjà
  // dans le brut (brut = net + part salariale), et l'entreprise la reverse à la
  // CNSS. L'additionner la comptait deux fois — correction du 2026-08-21.
  const somme = d.salaire + d.primeFonction + d.primeAnciennete + d.heuresSup
    + d.feries + d.heuresSupAccordees + d.chargesPatronales - d.retenueNonDeclares
    + d.transport + d.recolte + d.traitement + d.conditionnement + d.chargement;
  assert.strictEqual(Math.round(somme * 1e6) / 1e6, Math.round(out.coutTotal * 1e6) / 1e6);
});

test('primeRecolte — barème framboise, seuils et bonus au kilo', () => {
  // Barème repris de public/app.jsx : toute divergence donnerait deux primes
  // différentes pour la même cueillette selon l'écran.
  assert.strictEqual(M.primeRecolte(19.9, 'Maravilla', '2026-05-01'), 0);
  assert.strictEqual(M.primeRecolte(20, 'Maravilla', '2026-05-01'), 20);
  assert.strictEqual(M.primeRecolte(25, 'Maravilla', '2026-05-01'), 40);
  assert.strictEqual(M.primeRecolte(30, 'Maravilla', '2026-05-01'), 60);
  assert.strictEqual(M.primeRecolte(35, 'Maravilla', '2026-05-01'), 75);   // 60 + 5×3
  assert.strictEqual(M.primeRecolte(40, 'Maravilla', '2026-05-01'), 90);
  assert.strictEqual(M.primeRecolte(50, 'Maravilla', '2026-05-01'), 130);  // 90 + 10×4
});

test('primeRecolte — myrtille : seuil par variété, et le changement Cascade', () => {
  assert.strictEqual(M.primeRecolte(30, 'Breeze', '2026-05-01'), 12.5);    // 2,5 × 5
  assert.strictEqual(M.primeRecolte(30, 'Corina', '2026-05-01'), 0);       // seuil 30
  assert.strictEqual(M.primeRecolte(35, 'Corina', '2026-05-01'), 12.5);
  // Cascade : seuil 25 avant le 25/04/2026, 30 après — un test par période,
  // sinon la bascule passerait inaperçue.
  assert.strictEqual(M.primeRecolte(30, 'Cascade', '2026-04-24'), 12.5);
  assert.strictEqual(M.primeRecolte(30, 'Cascade', '2026-04-25'), 0);
});

test('facteurCharge — combien coûte réellement un dirham de salaire de base', () => {
  // C'est lui qui rend comparables les deux côtés de la grille Campagne : le
  // réalisé y vient du Cout BEE ONE (base nue), le budget est valorisé au coût
  // chargé. Journée type déclarée : 142,77 pour 97,44 de base → ×1,465.
  const out = campagne({
    registre: { AB1: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', { AB1: ouvrier(['2026-07-01']) })],
  });
  // Rapporté au Cout BEE ONE, puisque c'est LUI que la grille Campagne affiche.
  assert.strictEqual(Math.round(out.facteurCharge * 1000) / 1000,
    Math.round((out.coutTotal / out.detail.baseBeeOne) * 1000) / 1000);
  // La fourchette descend : le coût ne porte plus deux fois la part salariale.
  assert.ok(out.facteurCharge > 1.3 && out.facteurCharge < 1.45);
  // Sans base : `null` et non 1 — un facteur neutre ferait passer un coût nu
  // pour un coût complet, ce qui est l'erreur qu'on corrige.
  assert.strictEqual(campagne({ registre: {}, quinzaines: [] }).facteurCharge, null);
});

test('parQuinzaine — le détail se recompose quinzaine par quinzaine', () => {
  // C'est ce détail qui rend le rapprochement avec l'écran Quinzaine
  // vérifiable sans ressaisir un chiffre à la main.
  const out = campagne({
    registre: { AB1: { declare: true } },
    quinzaines: [
      quinzaine('Quinzaine 01', '2026-07-15', { AB1: ouvrier(['2026-07-01', '2026-07-02']) }),
      quinzaine('Quinzaine 02', '2026-07-31', { AB1: ouvrier(['2026-07-20']) }),
    ],
  });
  assert.deepStrictEqual(out.parQuinzaine.map((q) => q.periode),
    ['Quinzaine 01', 'Quinzaine 02']);
  assert.deepStrictEqual(out.parQuinzaine.map((q) => q.jours), [2, 1]);
  // La somme des quinzaines EST le total : sans ça, le rapprochement compare
  // deux chiffres qui ne parlent pas du même périmètre.
  const somme = out.parQuinzaine.reduce((s, q) => s + q.coutTotal, 0);
  assert.strictEqual(Math.round(somme * 1e6) / 1e6, Math.round(out.coutTotal * 1e6) / 1e6);
  const sommeBase = out.parQuinzaine.reduce((s, q) => s + q.base, 0);
  assert.strictEqual(Math.round(sommeBase * 1e6) / 1e6,
    Math.round(out.detail.baseBeeOne * 1e6) / 1e6);
  // Et chaque quinzaine se recompose elle aussi — sur le SALAIRE calculé, pas
  // sur le témoin BEE ONE.
  out.parQuinzaine.forEach((q) => {
    assert.strictEqual(Math.round((q.salaire + q.primes + q.charges) * 1e6) / 1e6,
      Math.round(q.coutTotal * 1e6) / 1e6, q.periode);
  });
});

test('unité — le coût moyen se divise par les JH, pas par les journées', () => {
  // Le piège : `Nombre_Jr` (les JH de BEE ONE) n'est PAS le nombre de journées
  // calendaires. Il peut être fractionnaire (demi-journée) ou dépasser 1
  // (heures converties). Le salaire se calcule sur les JOURNÉES — une fiche de
  // paie paie des jours — mais ce coût sert à valoriser des budgets en JH.
  // Diviser par les journées donnait un coût trop bas de plusieurs pour cent,
  // et toute la grille Campagne s'en trouvait sous-valorisée.
  const out = campagne({
    registre: { AB1: { declare: false } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      // 2 journées calendaires, mais seulement 1,5 JH (une demi-journée).
      AB1: ouvrier(['2026-07-01', '2026-07-02'], { jh: 1.5 }),
    })],
  });
  assert.strictEqual(out.jours, 2, 'la paie compte 2 journées');
  assert.strictEqual(out.jh, 1.5, '…mais BEE ONE ne compte que 1,5 JH');
  assert.strictEqual(out.coutMoyenJour, out.coutTotal / 1.5);
  // Et surtout : valoriser les JH au coût moyen doit REDONNER le coût total.
  // C'est l'invariant qui garantit que la grille Campagne ne ment pas.
  assert.strictEqual(Math.round(out.jh * out.coutMoyenJour * 1e6) / 1e6,
    Math.round(out.coutTotal * 1e6) / 1e6);
});

test('unité — sans JH, pas de coût moyen (jamais une division par les journées)', () => {
  const out = campagne({
    registre: { AB1: { declare: false } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01'], { jh: 0 }),
    })],
  });
  assert.strictEqual(out.coutMoyenJour, null);
});

test('cleRegistre — le registre est keyé NUMÉRIQUE, comme l\'écran Quinzaine', () => {
  // LE défaut du 2026-08-22 : le coût de campagne lisait `registre[matricule]`
  // avec le matricule BRUT du pointage. Or `ouvriers_registry` ne connaît que
  // des clés numériques, et le pointage sert des matricules alphanumériques.
  // Résultat : aucune fiche trouvée → l'ouvrier passait pour un non-déclaré,
  // sans ancienneté ni prime de fonction ni charges.
  //
  // Rien ne le signalait : un ouvrier SANS fiche est un cas légitime (nouvelle
  // embauche). Le bug se confondait avec un cas normal.
  assert.strictEqual(M.cleRegistre('CA10563'), '10563');
  assert.strictEqual(M.cleRegistre('HT4204'), '4204');
  assert.strictEqual(M.cleRegistre('10563'), '10563');
  assert.strictEqual(M.cleRegistre(''), '');
});

test('un matricule ALPHANUMÉRIQUE retrouve sa fiche de déclaré', () => {
  // Le test qui aurait attrapé le bug : même ouvrier, matricule préfixé par son
  // équipe, fiche keyée numérique. Sans normalisation il coûte le net d'un
  // non-déclaré ; avec, il porte ses charges patronales.
  const q = (mat) => ({
    periode: 'Q1', dateFin: '2026-07-15',
    parOuvrier: { [mat]: { jours: new Set(['2026-07-01']), jh: 1, base: 97.44 } },
  });
  const out = M.coutOuvrierCampagne({
    quinzaines: [q('CA10563')],
    registre: { 10563: { declare: true, primeFonctionJournaliere: 20 } },
    baremes: {}, equipesTransport: [],
  });
  const p = out.parQuinzaine[0].postes;
  assert.ok(p.chargesPatronales > 0, 'un déclaré doit porter des charges patronales');
  assert.strictEqual(Math.round(p.primeFonction), 20);
});

test('sans fiche, l\'ouvrier reste traité comme non-déclaré', () => {
  // La normalisation ne doit pas INVENTER de fiche : une nouvelle embauche
  // absente du registre reste un non-déclaré, sans charges.
  const out = M.coutOuvrierCampagne({
    quinzaines: [{ periode: 'Q1', dateFin: '2026-07-15',
      parOuvrier: { 'ZZ9999': { jours: new Set(['2026-07-01']), jh: 1, base: 97.44 } } }],
    registre: {}, baremes: {}, equipesTransport: [],
  });
  assert.strictEqual(out.parQuinzaine[0].postes.chargesPatronales, 0);
});
