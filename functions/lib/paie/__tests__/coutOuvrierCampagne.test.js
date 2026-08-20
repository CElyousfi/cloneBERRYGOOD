/*
 * coutOuvrierCampagne.test.js — le coût ouvrier chargé, moyenné sur la campagne.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *  1. les CHARGES PATRONALES ne sont comptées QUE sur les déclarés — un écart de
 *     19 % sur le coût de toute la campagne se voit à peine à l'écran mais fausse
 *     tous les budgets en DH qu'on en dérive ;
 *  2. l'ANCIENNETÉ se cumule d'une quinzaine à l'autre — sinon la prime
 *     d'ancienneté de tout le monde est sous-estimée, silencieusement ;
 *  3. une JOURNÉE compte une fois par ouvrier, quel que soit le nombre de lignes
 *     de pointage (trois parcelles le même jour = un jour) ;
 *  4. aucune journée pointée → `null`, jamais 0 : « pas de donnée » n'est pas
 *     « coût nul », et un 0 propagé rendrait tous les budgets DH nuls.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const M = require(path.join(__dirname, '../coutOuvrierCampagne.js'));
const { PAIE_BAREMES_DEFAULT, computeWorkerPaie } = require(path.join(__dirname, '../paieUtils.js'));

const EQUIPES = [
  { prefix: 'AB', equipe: 'Équipe AB', coutParOuvrier: 20 },
  { prefix: 'HA', equipe: 'Hafid', coutParOuvrier: 15 },
];

function quinzaine(periode, dateFin, parOuvrier) {
  return { periode, dateFin, parOuvrier };
}
function ouvrier(jours, hs) {
  return Object.assign({ jours: new Set(jours), hs25: 0, hs50: 0, hs100: 0 }, hs || {});
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

test('cumuleJournee — une journée par ouvrier, les heures sup se somment', () => {
  const acc = {};
  // Même ouvrier, même jour, trois parcelles : il a travaillé UN jour.
  M.cumuleJournee(acc, [
    { Personnel_Matricule: 'AB1', HS_25: 1 },
    { Personnel_Matricule: 'AB1', HS_25: 2 },
    { Personnel_Matricule: 'AB1', HS_50: 1 },
  ], '2026-07-01');
  M.cumuleJournee(acc, [{ Personnel_Matricule: 'AB1' }], '2026-07-02');
  assert.strictEqual(acc.AB1.jours.size, 2);
  assert.strictEqual(acc.AB1.hs25, 3);
  assert.strictEqual(acc.AB1.hs50, 1);
  // Ligne sans matricule : ignorée, jamais un ouvrier fantôme.
  M.cumuleJournee(acc, [{ Personnel_Matricule: '   ' }], '2026-07-03');
  assert.deepStrictEqual(Object.keys(acc), ['AB1']);
});

test('coût — les charges patronales ne pèsent QUE sur les déclarés', () => {
  const base = {
    baremes: PAIE_BAREMES_DEFAULT,
    equipesTransport: EQUIPES,
    quinzaines: [quinzaine('Q01', '2026-07-15', { AB1: ouvrier(['2026-07-01', '2026-07-02']) })],
  };
  const declare = M.coutOuvrierCampagne(Object.assign({}, base, {
    registre: { AB1: { declare: true, baselineJours: 0 } },
  }));
  const nonDeclare = M.coutOuvrierCampagne(Object.assign({}, base, {
    registre: { AB1: { declare: false, baselineJours: 0 } },
  }));
  assert.ok(declare.detail.chargesPatronales > 0);
  assert.strictEqual(nonDeclare.detail.chargesPatronales, 0);
  assert.ok(declare.coutMoyenJour > nonDeclare.coutMoyenJour, 'le déclaré coûte plus cher');
  // Les deux portent la même prime de transport (elle ne dépend pas du statut).
  assert.strictEqual(declare.detail.transport, nonDeclare.detail.transport);
  // Part de journées déclarées : sert à lire la moyenne.
  assert.strictEqual(declare.partDeclares, 1);
  assert.strictEqual(nonDeclare.partDeclares, 0);
});

test('coût — l\'ancienneté se CUMULE d\'une quinzaine à l\'autre', () => {
  const registre = { AB1: { declare: true, baselineJours: 700 } };
  const q = (p, f, jours) => quinzaine(p, f, { AB1: ouvrier(jours) });
  const uneSeule = M.coutOuvrierCampagne({
    registre, baremes: PAIE_BAREMES_DEFAULT, equipesTransport: EQUIPES,
    quinzaines: [q('Q01', '2026-07-15', ['2026-07-01'])],
  });
  const deux = M.coutOuvrierCampagne({
    registre, baremes: PAIE_BAREMES_DEFAULT, equipesTransport: EQUIPES,
    quinzaines: [
      q('Q01', '2026-07-15', ['2026-07-01']),
      // 400 jours pointés dans la 1re quinzaine, de quoi franchir un palier.
      q('Q02', '2026-07-31', ['2026-08-01']),
    ],
  });
  // La 2e quinzaine part d'une ancienneté de 701 jours, pas de 700 : le coût
  // moyen ne peut donc pas être identique au cas d'une seule quinzaine.
  assert.ok(deux.jours === 2 && uneSeule.jours === 1);
  const paie701 = computeWorkerPaie({
    declare: true, joursTravailles: 1, anciennete: 701,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-07-31', primeTransport: 20,
  });
  const paie700 = computeWorkerPaie({
    declare: true, joursTravailles: 1, anciennete: 700,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-07-15', primeTransport: 20,
  });
  assert.strictEqual(
    Math.round(deux.coutTotal * 1e6) / 1e6,
    Math.round((paie700.coutTotalEmployeur + paie701.coutTotalEmployeur) * 1e6) / 1e6
  );
});

test('coût — moyenne par JOURNÉE pointée, pas par ouvrier', () => {
  const out = M.coutOuvrierCampagne({
    registre: { AB1: { declare: true }, AB2: { declare: true } },
    baremes: PAIE_BAREMES_DEFAULT,
    equipesTransport: EQUIPES,
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
  const vide = M.coutOuvrierCampagne({
    registre: {}, baremes: PAIE_BAREMES_DEFAULT, equipesTransport: EQUIPES, quinzaines: [],
  });
  assert.strictEqual(vide.coutMoyenJour, null, 'un 0 rendrait tous les budgets DH nuls');
  assert.strictEqual(vide.coutTotal, 0);
  assert.strictEqual(vide.partDeclares, null);
  // Une quinzaine présente mais sans aucune journée : même verdict.
  const sansJour = M.coutOuvrierCampagne({
    registre: { AB1: { declare: true } }, baremes: PAIE_BAREMES_DEFAULT,
    equipesTransport: EQUIPES,
    quinzaines: [quinzaine('Q01', '2026-07-15', { AB1: ouvrier([]) })],
  });
  assert.strictEqual(sansJour.coutMoyenJour, null);
  assert.strictEqual(sansJour.ouvriers, 0);
});

test('coût — un ouvrier absent du registre est traité en NON déclaré', () => {
  // Fail-closed : sans fiche, on ne peut pas affirmer qu'il est déclaré. On ne
  // le jette pas pour autant — ses journées sont réelles et son brut aussi.
  const out = M.coutOuvrierCampagne({
    registre: {},
    baremes: PAIE_BAREMES_DEFAULT,
    equipesTransport: EQUIPES,
    quinzaines: [quinzaine('Q01', '2026-07-15', { AB1: ouvrier(['2026-07-01']) })],
  });
  assert.strictEqual(out.jours, 1);
  assert.ok(out.coutTotal > 0);
  assert.strictEqual(out.detail.chargesPatronales, 0);
});

test('coût — le détail se recompose exactement dans le total', () => {
  const out = M.coutOuvrierCampagne({
    registre: { AB1: { declare: true, baselineJours: 100 }, ZZ9: { declare: false } },
    baremes: PAIE_BAREMES_DEFAULT,
    equipesTransport: EQUIPES,
    quinzaines: [quinzaine('Q01', '2026-07-15', {
      AB1: ouvrier(['2026-07-01', '2026-07-02'], { hs25: 4 }),
      ZZ9: ouvrier(['2026-07-01']),
    })],
  });
  const somme = out.detail.brut + out.detail.chargesPatronales + out.detail.transport;
  assert.strictEqual(Math.round(somme * 1e6) / 1e6, Math.round(out.coutTotal * 1e6) / 1e6);
});
