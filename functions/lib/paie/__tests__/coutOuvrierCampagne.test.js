/*
 * coutOuvrierCampagne.test.js — le coût ouvrier CHARGÉ, moyenné sur la campagne.
 *
 * Formule arrêtée avec Omar (2026-08-20) : base BEE ONE + prime de fonction +
 * ancienneté + heures sup + jours fériés = assiette de cotisation ; + charges
 * patronales sur les seuls déclarés ; + primes de terrain (transport, récolte,
 * traitement, conditionnement, chargement), hors assiette.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *  1. la BASE vient de BEE ONE, pas d'un SMAG recalculé — sinon le badge diverge
 *     des DH/Ha de la grille sans qu'on sache lequel croire ;
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
    jours: new Set(jours), hs25: 0, hs50: 0, hs100: 0,
    base: BASE_JOUR * jours.length,
  }, extra || {});
}
function campagne(args) {
  return M.coutOuvrierCampagne(Object.assign({ baremes: B, equipesTransport: EQUIPES }, args));
}

test('prefixeEquipe — deux lettres, HAFI mis à part, BGF par défaut', () => {
  // Règle reprise à l'identique du front : une divergence donnerait deux primes
  // de transport différentes pour le même ouvrier selon l'écran.
  assert.strictEqual(M.prefixeEquipe('AB1234'), 'AB');
  assert.strictEqual(M.prefixeEquipe('hafi007'), 'HA');
  assert.strictEqual(M.prefixeEquipe('123456'), 'BGF');
  assert.strictEqual(M.prefixeEquipe(''), 'BGF');
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

test('paie — la BASE vient de BEE ONE, jamais d\'un SMAG recalculé', () => {
  // Deux journées facturées 120 DH par BEE ONE (heures supplémentaires déjà
  // intégrées côté ERP, prime de poste…) doivent coûter 240 de base, pas
  // 2 × 97,44. Recalculer la base ferait diverger le badge des DH/Ha de la
  // grille, qui viennent eux aussi du Cout BEE ONE.
  const out = campagne({
    registre: { ZZ9: { declare: false } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      ZZ9: { jours: new Set(['2026-07-01', '2026-07-02']), hs25: 0, hs50: 0, hs100: 0, base: 240 },
    })],
  });
  assert.strictEqual(out.detail.base, 240);
  assert.strictEqual(out.coutTotal, 240, 'non déclaré, hors équipe : aucun ajout');
  assert.strictEqual(out.coutMoyenJour, 120);
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
  assert.strictEqual(r(out.detail.base), 97.44);
  assert.strictEqual(r(out.detail.chargesPatronales), 18.77);
  assert.strictEqual(r(out.detail.cotisationsSalariales), 6.57);
  assert.strictEqual(r(out.detail.transport), 20);
  // 142,77 et non 142,78 : les termes sont arrondis pour l'affichage, jamais
  // dans le calcul — c'est la somme non arrondie qui fait foi.
  assert.strictEqual(r(out.coutMoyenJour), 142.77,
    'base 97,44 + patronales 18,77 + salariales 6,57 + transport 20');
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

test('primes de terrain — récolte, traitement, conditionnement, chargement, fériés', () => {
  const out = campagne({
    registre: { AB1: { declare: true } },
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01'], {
        primes: { recolte: 90, traitement: 10, conditionnement: 10, chargement: 10, feries: 97.44 },
      }),
    })],
  });
  assert.strictEqual(out.detail.recolte, 90);
  assert.strictEqual(out.detail.traitement, 10);
  assert.strictEqual(out.detail.conditionnement, 10);
  assert.strictEqual(out.detail.chargement, 10);
  assert.strictEqual(out.detail.feries, 97.44);
  // Le férié entre dans l'ASSIETTE (c'est du salaire), les autres non :
  // charges = (97,44 base + 97,44 férié) × 19,26 %.
  assert.strictEqual(Math.round(out.detail.chargesPatronales * 100) / 100,
    Math.round((97.44 * 2 * 0.1926) * 100) / 100);
  assert.strictEqual(Math.round(out.detail.cotisationsSalariales * 100) / 100,
    Math.round((97.44 * 2 * 0.0674) * 100) / 100);
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
  const somme = d.base + d.primeFonction + d.primeAnciennete + d.heuresSup
    + d.feries + d.chargesPatronales + d.cotisationsSalariales
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
