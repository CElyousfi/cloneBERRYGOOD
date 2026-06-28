'use strict';

/**
 * Consommation valorisée au PMP — tests purs.
 * Couvre resolvePmp (synonyme, canon, placeholder<=1) et aggregateConsoValorisee
 * (cout_ligne, séparation engrais/pest, cout_ha, articles non valorisés,
 * couverture %, parcelle sans surface → cout_ha null, tonne → KG).
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../functions/lib/valorisation/consoValorisation.js');

const pmpMap = {
  'MAP': { pmp: 10, source: 'pmp' },
  'KSC 1': { pmp: 5, source: 'pmp' },
  'VERTIMIC': { pmp: 200, source: 'pmp' },
  'HUMOCAL': { pmp: 1, source: 'pmp' },      // placeholder <= 1
  'ACIDE SULFRIQUE': { pmp: 0.5, source: 'pmp' }, // placeholder <= 1
};

test('resolvePmp: match direct par canon', () => {
  const r = V.resolvePmp('MAP', pmpMap);
  assert.equal(r.matched, true);
  assert.equal(r.pmp, 10);
  assert.equal(r.source, 'pmp');
});

test('resolvePmp: suffixe unité retiré par canon', () => {
  const r = V.resolvePmp('MAP (KG)', pmpMap);
  assert.equal(r.matched, true);
  assert.equal(r.pmp, 10);
});

test('resolvePmp: synonyme conso -> catalogue (KSC I -> KSC 1)', () => {
  const r = V.resolvePmp('KSC I', pmpMap);
  assert.equal(r.matched, true);
  assert.equal(r.pmp, 5);
});

test('resolvePmp: synonyme VERTIMEC -> VERTIMIC', () => {
  const r = V.resolvePmp('VERTIMEC', pmpMap);
  assert.equal(r.matched, true);
  assert.equal(r.pmp, 200);
});

test('resolvePmp: placeholder pmp<=1 -> non valorisé', () => {
  const r = V.resolvePmp('HUMOCAL', pmpMap);
  assert.equal(r.matched, false);
  assert.equal(r.pmp, 0);
  assert.equal(r.source, 'placeholder');
  const r2 = V.resolvePmp('Acide Sulfirique', pmpMap); // synonyme + placeholder
  assert.equal(r2.matched, false);
  assert.equal(r2.source, 'placeholder');
});

test('resolvePmp: article absent du catalogue -> non valorisé', () => {
  const r = V.resolvePmp('INCONNU XYZ', pmpMap);
  assert.equal(r.matched, false);
  assert.equal(r.pmp, 0);
  assert.equal(r.source, 'absent');
});

test('aggregate: cout_ligne, séparation engrais/pest, cout_ha', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 100, Culture: 'Myrtille', Ferme: 'F1', Parcelle_Culturale: 'P1', Parcelle_sup: 2 },
    { Article: 'VERTIMEC', Article_Categorie: 'Pesticides', Article_unite: 'L', Quantite: 3, Culture: 'Myrtille', Ferme: 'F1', Parcelle_Culturale: 'P1', Parcelle_sup: 2 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  assert.equal(out.parcelles.length, 1);
  const p = out.parcelles[0];
  assert.equal(p.engrais.length, 1);
  assert.equal(p.pesticides.length, 1);
  assert.equal(p.engrais[0].cout_ligne, 1000); // 100 * 10
  assert.equal(p.pesticides[0].cout_ligne, 600); // 3 * 200
  assert.equal(p.total_engrais_mad, 1000);
  assert.equal(p.total_pest_mad, 600);
  assert.equal(p.total_mad, 1600);
  assert.equal(p.cout_ha_engrais, 500); // 1000 / 2
  assert.equal(p.cout_ha_pest, 300);    // 600 / 2
  assert.equal(p.cout_ha_total, 800);   // 1600 / 2
  assert.equal(p.eng_kg_ha, 50);        // 100 / 2
  assert.equal(p.pest_l_ha, 1.5);       // 3 / 2
});

test('aggregate: tonne normalisée en KG (×1000)', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'TONNE', Quantite: 1, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  const ln = out.parcelles[0].engrais[0];
  assert.equal(ln.quantite, 1000); // 1 tonne -> 1000 kg
  assert.equal(ln.unite, 'KG');
  assert.equal(ln.cout_ligne, 10000); // 1000 * 10
});

test('aggregate: articles non valorisés listés en quantité seule', () => {
  const rows = [
    { Article: 'HUMOCAL', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 50, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
    { Article: 'INCONNU', Article_Categorie: 'Pesticides', Article_unite: 'L', Quantite: 10, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  const p = out.parcelles[0];
  assert.equal(p.total_mad, 0); // rien de valorisé
  assert.equal(p.articles_non_valorises.length, 2);
  const humo = p.articles_non_valorises.find((a) => a.article === 'HUMOCAL');
  assert.equal(humo.quantite, 50);
  assert.equal(humo.source_prix, 'placeholder');
  const inc = p.articles_non_valorises.find((a) => a.article === 'INCONNU');
  assert.equal(inc.source_prix, 'absent');
});

test('aggregate: parcelle sans surface -> cout_ha null', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 100, Parcelle_Culturale: 'P1' },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  const p = out.parcelles[0];
  assert.equal(p.sup_ha, null);
  assert.equal(p.cout_ha_total, null);
  assert.equal(p.cout_ha_engrais, null);
  assert.equal(p.eng_kg_ha, null);
  assert.equal(p.total_mad, 1000); // total reste calculé
});

test('aggregate: couverture % articles et quantité', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 100, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
    { Article: 'HUMOCAL', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 100, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  assert.equal(out.couverture.nb_articles_total, 2);
  assert.equal(out.couverture.nb_valorises, 1);
  assert.equal(out.couverture.pct_articles, 50);
  assert.equal(out.couverture.qte_totale, 200);
  assert.equal(out.couverture.qte_valorisee, 100);
  assert.equal(out.couverture.pct_quantite, 50);
});

test('aggregate: sous-totaux par ferme et par culture', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 100, Culture: 'Myrtille', Ferme: 'F1', Parcelle_Culturale: 'P1', Parcelle_sup: 2 },
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 50, Culture: 'Framboise', Ferme: 'F1', Parcelle_Culturale: 'P2', Parcelle_sup: 1 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  assert.equal(out.par_ferme.length, 1);
  assert.equal(out.par_ferme[0].total_mad, 1500); // 1000 + 500
  assert.equal(out.par_ferme[0].sup_ha, 3);
  assert.equal(out.par_ferme[0].cout_ha_total, 500);
  assert.equal(out.par_culture.length, 2);
  assert.equal(out.total.total_mad, 1500);
  assert.equal(out.total.nb_parcelles, 2);
});

test('synthèse: 1 ligne par parcelle avec coûts engrais/pest séparés et coût/Ha', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 100, Culture: 'Myrtille', Ferme: 'F1', Parcelle_Culturale: 'P1', Parcelle_sup: 2 },
    { Article: 'VERTIMEC', Article_Categorie: 'Pesticides', Article_unite: 'L', Quantite: 3, Culture: 'Myrtille', Ferme: 'F1', Parcelle_Culturale: 'P1', Parcelle_sup: 2 },
    { Article: 'KSC 1', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 20, Culture: 'Framboise', Ferme: 'F5', Parcelle_Culturale: 'P2', Parcelle_sup: 1 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  // Une ligne de synthèse par parcelle.
  assert.equal(out.parcelles.length, 2);
  const p1 = out.parcelles.find((p) => p.parcelle === 'P1');
  // Coûts engrais / pesticide séparés + coût/Ha disponibles pour la vue synthèse.
  assert.equal(p1.total_engrais_mad, 1000);
  assert.equal(p1.total_pest_mad, 600);
  assert.equal(p1.cout_ha_engrais, 500);
  assert.equal(p1.cout_ha_pest, 300);
  assert.equal(p1.cout_ha_total, 800);
  assert.equal(p1.ferme, 'F1');
  assert.equal(p1.culture, 'Myrtille');
  const p2 = out.parcelles.find((p) => p.parcelle === 'P2');
  assert.equal(p2.total_pest_mad, 0);
  assert.equal(p2.cout_ha_pest, 0);
});

test('synthèse: articles non valorisés exposés par parcelle (quantité conservée, coût 0)', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 100, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
    { Article: 'HUMOCAL', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 30, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  const p = out.parcelles[0];
  assert.equal(p.total_engrais_mad, 1000); // seul MAP valorisé
  assert.equal(p.articles_non_valorises.length, 1);
  assert.equal(p.articles_non_valorises[0].article, 'HUMOCAL');
  assert.equal(p.articles_non_valorises[0].quantite, 30); // quantité conservée
  // La ligne engrais HUMOCAL existe en quantité, coût 0.
  const humoLn = p.engrais.find((l) => l.article === 'HUMOCAL');
  assert.equal(humoLn.cout_ligne, 0);
  assert.equal(humoLn.valorise, false);
});

test('aggregate: même article + même unité fusionné dans la parcelle', () => {
  const rows = [
    { Article: 'MAP', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 40, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
    { Article: 'MAP (KG)', Article_Categorie: 'Engrais', Article_unite: 'KG', Quantite: 60, Parcelle_Culturale: 'P1', Parcelle_sup: 1 },
  ];
  const out = V.aggregateConsoValorisee(rows, pmpMap);
  assert.equal(out.parcelles[0].engrais.length, 1);
  assert.equal(out.parcelles[0].engrais[0].quantite, 100);
  assert.equal(out.parcelles[0].engrais[0].cout_ligne, 1000);
});
