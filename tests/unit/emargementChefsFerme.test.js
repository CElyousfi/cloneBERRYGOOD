'use strict';

// Tests unitaires pour la logique de l'action emargement-chefs-ferme.
// On teste la transformation des lignes mirror (rows) → structure ferme/equipe/parcelle/byDay
// sans dépendre de Firestore (logique pure extraite ici).

const { test } = require('node:test');
const assert = require('node:assert');

// ── Logique de groupement extraite de pointageService.js ────────────────────

function buildEmargementFermes(dates, rowsByDate, resolveFerme) {
  var fermeMap = {
    F1: { label: 'Framboise', equipeMap: {} },
    F5: { label: 'Myrtille', equipeMap: {} },
    Avocatier: { label: 'Avocatier', equipeMap: {} }
  };

  for (var i = 0; i < dates.length; i++) {
    var date = dates[i];
    var rows = rowsByDate[date] || [];
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      var res = resolveFerme({ refParcelle: r.Ref_parcelle, label: r.Parcelle_Culturale, variete: r.Variete });
      var ferme = res && res.ferme;
      if (!fermeMap[ferme]) continue;
      var eq = r.Operation_Groupe || r.Operation_Famille || 'Divers';
      var pl = r.Parcelle_Culturale || r.Ref_parcelle || '?';
      var jh = Number(r.Nombre_Jr || 0);
      var mat = r.Personnel_Matricule || '';
      var fm = fermeMap[ferme];
      if (!fm.equipeMap[eq]) fm.equipeMap[eq] = { nom: eq, parcelleMap: {} };
      var em = fm.equipeMap[eq];
      if (!em.parcelleMap[pl]) em.parcelleMap[pl] = { label: pl, byDay: {}, totalJH: 0 };
      var pm = em.parcelleMap[pl];
      if (!pm.byDay[date]) pm.byDay[date] = { jh: 0, ouvriers: 0, _set: [] };
      pm.byDay[date]._set.push(mat);
      pm.byDay[date].jh += jh;
      pm.totalJH += jh;
    }
  }

  // Sérialiser _set → ouvriers (distinct)
  var FERME_ORDER = ['F1', 'F5', 'Avocatier'];
  var fermes = {};
  for (var fi = 0; fi < FERME_ORDER.length; fi++) {
    var fk = FERME_ORDER[fi];
    var fm2 = fermeMap[fk];
    var eqs = Object.values(fm2.equipeMap).sort(function(a, b) {
      var ra = /r.colte/i.test(a.nom) ? 0 : 1;
      var rb = /r.colte/i.test(b.nom) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.nom.localeCompare(b.nom);
    });
    for (var ei = 0; ei < eqs.length; ei++) {
      var eq2 = eqs[ei];
      var parcelles = Object.values(eq2.parcelleMap).sort(function(a, b) { return a.label.localeCompare(b.label); });
      for (var pi = 0; pi < parcelles.length; pi++) {
        var p = parcelles[pi];
        for (var dk in p.byDay) {
          var day = p.byDay[dk];
          day.ouvriers = new Set(day._set).size;
          delete day._set;
        }
      }
      eq2.parcelles = parcelles;
      delete eq2.parcelleMap;
    }
    fermes[fk] = {
      label: fm2.label,
      equipes: eqs,
      totalJH: eqs.reduce(function(s, e) {
        return s + e.parcelles.reduce(function(s2, p2) { return s2 + p2.totalJH; }, 0);
      }, 0)
    };
  }
  return fermes;
}

// ── Logique divers extraite ──────────────────────────────────────────────────

function buildDiversLignes(dates, entriesByDate) {
  var diversMap = {};
  for (var di = 0; di < dates.length; di++) {
    var ddate = dates[di];
    var entries = entriesByDate[ddate] || [];
    for (var eni = 0; eni < entries.length; eni++) {
      var e = entries[eni];
      var key = (e.beneficiaire || '') + '|' + (e.fonction || '');
      if (!diversMap[key]) diversMap[key] = { key: key, beneficiaire: e.beneficiaire || '', fonction: e.fonction || '', byDay: {}, totQ: 0, totM: 0 };
      if (!diversMap[key].byDay[ddate]) diversMap[key].byDay[ddate] = { q: 0, m: 0 };
      diversMap[key].byDay[ddate].q += Number(e.quantite || 0);
      diversMap[key].byDay[ddate].m += Number(e.montant || 0);
      diversMap[key].totQ += Number(e.quantite || 0);
      diversMap[key].totM += Number(e.montant || 0);
    }
  }
  var lignes = Object.values(diversMap).sort(function(a, b) { return a.beneficiaire.localeCompare(b.beneficiaire); });
  var totalMontant = lignes.reduce(function(s, l) { return s + l.totM; }, 0);
  return { lignes: lignes, totalMontant: totalMontant };
}

// ── Stub resolveFerme ────────────────────────────────────────────────────────

function stubResolve(parcelleFermeMap) {
  return function(opts) {
    var ferme = parcelleFermeMap[opts.refParcelle] || null;
    return ferme ? { ferme: ferme } : null;
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('groupement simple : 1 ouvrier F1, 1 jour', function() {
  var dates = ['2026-07-01'];
  var rows = [{ Ref_parcelle: 'P1', Parcelle_Culturale: 'Parcelle A', Operation_Groupe: 'Récolte', Nombre_Jr: '1', Personnel_Matricule: 'M001', Variete: '' }];
  var resolve = stubResolve({ P1: 'F1' });
  var fermes = buildEmargementFermes(dates, { '2026-07-01': rows }, resolve);

  assert.strictEqual(fermes.F1.equipes.length, 1);
  assert.strictEqual(fermes.F1.equipes[0].nom, 'Récolte');
  assert.strictEqual(fermes.F1.equipes[0].parcelles.length, 1);
  assert.strictEqual(fermes.F1.equipes[0].parcelles[0].label, 'Parcelle A');
  assert.strictEqual(fermes.F1.equipes[0].parcelles[0].byDay['2026-07-01'].ouvriers, 1);
  assert.strictEqual(fermes.F1.equipes[0].parcelles[0].byDay['2026-07-01'].jh, 1);
  assert.strictEqual(fermes.F1.totalJH, 1);
  assert.strictEqual(fermes.F5.equipes.length, 0);
  assert.strictEqual(fermes.Avocatier.equipes.length, 0);
});

test('déduplication ouvriers : même matricule = 1 ouvrier distinct', function() {
  var dates = ['2026-07-01'];
  var rows = [
    { Ref_parcelle: 'P1', Parcelle_Culturale: 'Parcelle A', Operation_Groupe: 'Récolte', Nombre_Jr: '1', Personnel_Matricule: 'M001', Variete: '' },
    { Ref_parcelle: 'P1', Parcelle_Culturale: 'Parcelle A', Operation_Groupe: 'Récolte', Nombre_Jr: '0.5', Personnel_Matricule: 'M001', Variete: '' },
  ];
  var resolve = stubResolve({ P1: 'F1' });
  var fermes = buildEmargementFermes(dates, { '2026-07-01': rows }, resolve);

  var day = fermes.F1.equipes[0].parcelles[0].byDay['2026-07-01'];
  assert.strictEqual(day.ouvriers, 1, 'M001 dupliqué → 1 ouvrier distinct');
  assert.strictEqual(day.jh, 1.5, 'JH cumulé = 1 + 0.5');
});

test('2 ouvriers distincts sur même parcelle même jour', function() {
  var dates = ['2026-07-01'];
  var rows = [
    { Ref_parcelle: 'P1', Parcelle_Culturale: 'Parcelle A', Operation_Groupe: 'Récolte', Nombre_Jr: '1', Personnel_Matricule: 'M001', Variete: '' },
    { Ref_parcelle: 'P1', Parcelle_Culturale: 'Parcelle A', Operation_Groupe: 'Récolte', Nombre_Jr: '1', Personnel_Matricule: 'M002', Variete: '' },
  ];
  var resolve = stubResolve({ P1: 'F1' });
  var fermes = buildEmargementFermes(dates, { '2026-07-01': rows }, resolve);

  var day = fermes.F1.equipes[0].parcelles[0].byDay['2026-07-01'];
  assert.strictEqual(day.ouvriers, 2);
  assert.strictEqual(day.jh, 2);
});

test('rows sur ferme inconnue sont ignorés', function() {
  var dates = ['2026-07-01'];
  var rows = [
    { Ref_parcelle: 'PINCONNU', Parcelle_Culturale: 'Parcelle X', Operation_Groupe: 'Travaux', Nombre_Jr: '1', Personnel_Matricule: 'M001', Variete: '' },
  ];
  var resolve = stubResolve({}); // rien résolu
  var fermes = buildEmargementFermes(dates, { '2026-07-01': rows }, resolve);

  assert.strictEqual(fermes.F1.equipes.length, 0);
  assert.strictEqual(fermes.F5.equipes.length, 0);
  assert.strictEqual(fermes.Avocatier.equipes.length, 0);
  assert.strictEqual(fermes.F1.totalJH, 0);
});

test('tri équipes : Récolte en premier', function() {
  var dates = ['2026-07-01'];
  var rows = [
    { Ref_parcelle: 'P1', Parcelle_Culturale: 'P', Operation_Groupe: 'Entretien', Nombre_Jr: '1', Personnel_Matricule: 'M1', Variete: '' },
    { Ref_parcelle: 'P1', Parcelle_Culturale: 'P', Operation_Groupe: 'Récolte', Nombre_Jr: '1', Personnel_Matricule: 'M2', Variete: '' },
    { Ref_parcelle: 'P1', Parcelle_Culturale: 'P', Operation_Groupe: 'Arrosage', Nombre_Jr: '1', Personnel_Matricule: 'M3', Variete: '' },
  ];
  var resolve = stubResolve({ P1: 'F1' });
  var fermes = buildEmargementFermes(dates, { '2026-07-01': rows }, resolve);

  assert.strictEqual(fermes.F1.equipes[0].nom, 'Récolte', 'Récolte doit être en premier');
});

test('multi-dates : totalJH cumulé sur la période', function() {
  var dates = ['2026-07-01', '2026-07-02'];
  var rowsByDate = {
    '2026-07-01': [{ Ref_parcelle: 'P1', Parcelle_Culturale: 'PA', Operation_Groupe: 'Récolte', Nombre_Jr: '2', Personnel_Matricule: 'M1', Variete: '' }],
    '2026-07-02': [{ Ref_parcelle: 'P1', Parcelle_Culturale: 'PA', Operation_Groupe: 'Récolte', Nombre_Jr: '3', Personnel_Matricule: 'M2', Variete: '' }],
  };
  var resolve = stubResolve({ P1: 'F5' });
  var fermes = buildEmargementFermes(dates, rowsByDate, resolve);

  assert.strictEqual(fermes.F5.totalJH, 5);
  var p = fermes.F5.equipes[0].parcelles[0];
  assert.strictEqual(p.totalJH, 5);
  assert.strictEqual(p.byDay['2026-07-01'].jh, 2);
  assert.strictEqual(p.byDay['2026-07-02'].jh, 3);
});

test('Operation_Famille utilisé si Operation_Groupe absent', function() {
  var dates = ['2026-07-01'];
  var rows = [{ Ref_parcelle: 'P1', Parcelle_Culturale: 'PA', Operation_Groupe: '', Operation_Famille: 'Irrigation', Nombre_Jr: '1', Personnel_Matricule: 'M1', Variete: '' }];
  var resolve = stubResolve({ P1: 'Avocatier' });
  var fermes = buildEmargementFermes(dates, { '2026-07-01': rows }, resolve);

  assert.strictEqual(fermes.Avocatier.equipes[0].nom, 'Irrigation');
});

test('fallback équipe "Divers" si Operation_Groupe et Operation_Famille absents', function() {
  var dates = ['2026-07-01'];
  var rows = [{ Ref_parcelle: 'P1', Parcelle_Culturale: 'PA', Nombre_Jr: '1', Personnel_Matricule: 'M1', Variete: '' }];
  var resolve = stubResolve({ P1: 'F1' });
  var fermes = buildEmargementFermes(dates, { '2026-07-01': rows }, resolve);

  assert.strictEqual(fermes.F1.equipes[0].nom, 'Divers');
});

// ── Tests divers ─────────────────────────────────────────────────────────────

test('divers : groupement par beneficiaire|fonction, cumul q et m', function() {
  var dates = ['2026-07-01', '2026-07-02'];
  var entriesByDate = {
    '2026-07-01': [{ beneficiaire: 'Sté Alpha', fonction: 'Tracteur', quantite: '2', montant: '600' }],
    '2026-07-02': [{ beneficiaire: 'Sté Alpha', fonction: 'Tracteur', quantite: '1', montant: '300' }],
  };
  var result = buildDiversLignes(dates, entriesByDate);

  assert.strictEqual(result.lignes.length, 1);
  assert.strictEqual(result.lignes[0].totQ, 3);
  assert.strictEqual(result.lignes[0].totM, 900);
  assert.strictEqual(result.totalMontant, 900);
});

test('divers : 2 bénéficiaires distincts', function() {
  var dates = ['2026-07-01'];
  var entriesByDate = {
    '2026-07-01': [
      { beneficiaire: 'Sté Alpha', fonction: 'Tracteur', quantite: '1', montant: '300' },
      { beneficiaire: 'Sté Beta', fonction: 'Camion', quantite: '2', montant: '800' },
    ],
  };
  var result = buildDiversLignes(dates, entriesByDate);

  assert.strictEqual(result.lignes.length, 2);
  assert.strictEqual(result.totalMontant, 1100);
});

test('divers : aucune entrée → lignes vides, total 0', function() {
  var result = buildDiversLignes(['2026-07-01'], {});
  assert.strictEqual(result.lignes.length, 0);
  assert.strictEqual(result.totalMontant, 0);
});

test('divers : même bénéficiaire, fonctions différentes = 2 lignes', function() {
  var dates = ['2026-07-01'];
  var entriesByDate = {
    '2026-07-01': [
      { beneficiaire: 'Sté Alpha', fonction: 'Tracteur', quantite: '1', montant: '300' },
      { beneficiaire: 'Sté Alpha', fonction: 'Camion', quantite: '1', montant: '200' },
    ],
  };
  var result = buildDiversLignes(dates, entriesByDate);
  assert.strictEqual(result.lignes.length, 2);
});
