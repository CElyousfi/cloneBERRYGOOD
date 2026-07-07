'use strict';

// Tests des helpers PURS de reconstruction du contrat mirror pointage depuis
// les lignes brutes BDP (functions/lib/pointageBdp/mapBdpRow.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  s,
  n,
  deriveJournees,
  derivePeriodePaie,
  mapBdpRowToContract,
} = require('../../functions/lib/pointageBdp/mapBdpRow.js');

// ── helpers de coercition ───────────────────────────────────────────────────
test('s(): null/undefined → chaîne vide, trim', () => {
  assert.equal(s(null), '');
  assert.equal(s(undefined), '');
  assert.equal(s('  X  '), 'X');
  assert.equal(s(42), '42');
});

test('n(): null/undefined/vide → 0, NaN → 0', () => {
  assert.equal(n(null), 0);
  assert.equal(n(''), 0);
  assert.equal(n('abc'), 0);
  assert.equal(n('3.5'), 3.5);
  assert.equal(n(7), 7);
});

// ── deriveJournees ──────────────────────────────────────────────────────────
// SOURCE RÉELLE : Personnel_Pointage.Nombre_jour (valeur DIRECTE : 1 = journée
// complète, 0.5 = demi-journée). Aucun calcul JC/DJ1/DJ2 (ces colonnes sont à 0
// en BDP → l'ancienne formule renvoyait 0).
test('deriveJournees: lit Nombre_jour direct (journée complète = 1)', () => {
  assert.equal(deriveJournees({ Nombre_jour: 1, JC: 0, DJ1: 0, DJ2: 0 }), 1);
});

test('deriveJournees: lit Nombre_jour direct (demi-journée = 0.5)', () => {
  assert.equal(deriveJournees({ Nombre_jour: 0.5 }), 0.5);
});

test('deriveJournees: ignore JC/DJ1/DJ2 (à 0 en BDP)', () => {
  // Même si JC/DJ1/DJ2 sont renseignés, seul Nombre_jour compte.
  assert.equal(deriveJournees({ Nombre_jour: 1, JC: 9, DJ1: 9, DJ2: 9 }), 1);
});

test('deriveJournees: fallback alias SQL Nombre_Jr', () => {
  assert.equal(deriveJournees({ Nombre_Jr: 0.5 }), 0.5);
});

test('deriveJournees: tout absent → 0 (edge)', () => {
  assert.equal(deriveJournees({}), 0);
  assert.equal(deriveJournees(null), 0);
});

// ── derivePeriodePaie ───────────────────────────────────────────────────────
test('derivePeriodePaie: label direct "Quinzaine N"', () => {
  assert.equal(derivePeriodePaie({ Periode_paie: 'Quinzaine 49' }), 'Quinzaine 49');
  assert.equal(derivePeriodePaie({ Periode: '  Quinzaine 13 ' }), 'Quinzaine 13');
});

test('derivePeriodePaie: fabrication depuis numéro', () => {
  assert.equal(derivePeriodePaie({ Quinzaine_Num: 7 }), 'Quinzaine 7');
});

test('derivePeriodePaie: rien → chaîne vide (edge)', () => {
  assert.equal(derivePeriodePaie({}), '');
  assert.equal(derivePeriodePaie(null), '');
});

// ── mapBdpRowToContract : cas nominal ───────────────────────────────────────
test('mapBdpRowToContract: cas nominal complet (19 champs + cout_beeone_ref)', () => {
  const raw = {
    DateStr: '2026-06-15',
    Personnel_Matricule: ' M123 ',
    Personnel_Nom: ' DUPONT ',
    // Colonnes RÉELLES BDP : HJ (heures journée = 8), Nombre_jour (1 = complète).
    HJ: 8,
    Nombre_jour: 1,
    HS_25: 1, HS_50: 0.5, HS_100: 0,
    Quantite_unite: 12,
    cout: 87.5,
    Operation: 'Cueillette',
    Operation_Famille: 'Récolte',
    Operation_Groupe: 'Production',
    Parcelle_Culturale: 'S1 Corina',
    Ref_parcelle: '0032',
    Variete: 'Myrtille',
    Culture: 'Myrtille',
    Periode_paie: 'Quinzaine 49',
  };
  const c = mapBdpRowToContract(raw);
  assert.equal(c.Personnel_Matricule, 'M123');
  assert.equal(c.Personnel_Nom, 'DUPONT');
  assert.equal(c.Operation, 'Cueillette');
  assert.equal(c.Operation_Famille, 'Récolte');
  assert.equal(c.Operation_Groupe, 'Production');
  assert.equal(c.Nombre_Jr, 1);
  assert.equal(c.Nombre_Hr, 8);
  assert.equal(c.Quantite_unite, 12);
  // Cout = référence BEE ONE ; cout_beeone_ref = même valeur (colonne séparée).
  assert.equal(c.Cout, 87.5);
  assert.equal(c.cout_beeone_ref, 87.5);
  assert.equal(c.Parcelle_Culturale, 'S1 Corina');
  assert.equal(c.Ref_parcelle, '0032');
  assert.equal(c.Variete, 'Myrtille');
  assert.equal(c.Culture, 'Myrtille');
  assert.equal(c.Periode_paie, 'Quinzaine 49');
  assert.equal(c.DateStr, '2026-06-15');
  assert.equal(c.HS_25, 1);
  assert.equal(c.HS_50, 0.5);
  assert.equal(c.HS_100, 0);
  // HS_NM toujours 0 (décision DG, inutilisé).
  assert.equal(c.HS_NM, 0);
});

test('mapBdpRowToContract: alias colonnes brutes (Mat/Nom/HJ/Qte_Unite/OpeRef_Intitule)', () => {
  const raw = {
    DateStr: '2026-06-15',
    Mat: 'M9',
    Nom: 'ALAOUI',
    HJ: 8,
    Nombre_jour: 0.5,
    Qte_Unite: 4,
    OpeRef_Intitule: 'Taille',
    Cout: 60,
  };
  const c = mapBdpRowToContract(raw);
  assert.equal(c.Personnel_Matricule, 'M9');
  assert.equal(c.Personnel_Nom, 'ALAOUI');
  assert.equal(c.Nombre_Hr, 8);
  assert.equal(c.Nombre_Jr, 0.5);
  assert.equal(c.Quantite_unite, 4);
  assert.equal(c.Operation, 'Taille');
  assert.equal(c.Cout, 60);
  assert.equal(c.cout_beeone_ref, 60);
});

test('mapBdpRowToContract: edge nulls / HS absents / quantité 0', () => {
  const c = mapBdpRowToContract({ DateStr: '2026-06-01' });
  assert.equal(c.Personnel_Matricule, '');
  assert.equal(c.Personnel_Nom, '');
  assert.equal(c.Operation, '');
  assert.equal(c.Nombre_Jr, 0);
  assert.equal(c.Nombre_Hr, 0);
  assert.equal(c.Quantite_unite, 0);
  assert.equal(c.Cout, 0);
  assert.equal(c.cout_beeone_ref, 0);
  assert.equal(c.HS_25, 0);
  assert.equal(c.HS_50, 0);
  assert.equal(c.HS_100, 0);
  assert.equal(c.HS_NM, 0);
});

test('mapBdpRowToContract: Nombre_Hr fallback seuil_horaire si HJ absent', () => {
  const c = mapBdpRowToContract({ DateStr: '2026-06-01', seuil_horaire: 8 });
  assert.equal(c.Nombre_Hr, 8);
});

test('mapBdpRowToContract: HS_NM ignoré même si fourni', () => {
  const c = mapBdpRowToContract({ DateStr: '2026-06-01', HS_NM: 99 });
  assert.equal(c.HS_NM, 0);
});

// Culture best-effort NULL (P2b) : aucun chemin FK certain BDP → la requête
// renvoie Culture = NULL. Le helper coerce en '' (champ d'affichage, hors clé
// de validation croisée et hors paie). Ne casse jamais le mapping.
test('mapBdpRowToContract: Culture NULL (best-effort BDP) → chaîne vide', () => {
  const c = mapBdpRowToContract({
    DateStr: '2026-06-15',
    Parcelle_Culturale: 'S10 YAZMIN cut back F5',
    Ref_parcelle: 'F5',
    Variete: 'Yazmin',
    Culture: null,
  });
  assert.equal(c.Parcelle_Culturale, 'S10 YAZMIN cut back F5');
  assert.equal(c.Ref_parcelle, 'F5');
  assert.equal(c.Variete, 'Yazmin');
  assert.equal(c.Culture, '');
});
