'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { aggregateConsoParcelle, articlesAClasser } = require('../aggregateParcelle');
const { adaptBonsToConsoRows } = require('../bonsToConsoRows');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(over) {
  return Object.assign(
    {
      Date: '2026-08-10',
      Parcelle_Culturale: 'F1 S1',
      Article: 'UREE 46',
      Article_Categorie: 'Engrais',
      Quantite: 10,
      Article_unite: 'kg',
      Culture: 'Framboise',
      Ferme: 'F1',
      Parcelle_sup: 2.5,
    },
    over
  );
}

/** Dérivation de ferme façon pointageService (fail-closed = 'Autre'). */
function deriveFerme(parcelle) {
  const s = String(parcelle || '').toUpperCase();
  if (s.indexOf('HAAS') !== -1 || s.indexOf('AVOCAT') !== -1) return 'Avocatier';
  if (s.indexOf('BAHIA') !== -1) return 'BAHIA';
  const m = s.match(/\bF([1-6])\b/);
  return m ? 'F' + m[1] : 'Autre';
}

const OPTS = { haByLabel: { 'F1 S1': 2.5, 'F5 S8-1': 1.25 }, deriveFerme };

// ---------------------------------------------------------------------------
// Forme de sortie
// ---------------------------------------------------------------------------

test('agrège une parcelle avec un engrais', () => {
  const out = aggregateConsoParcelle([row()], OPTS);
  assert.deepStrictEqual(out, [
    {
      parcelle: 'F1 S1',
      ferme: 'F1',
      ha: 2.5,
      engrais: [{ article: 'UREE 46', qty: 10, unite: 'kg', coutTotal: 0 }],
      pesticides: [],
      aClasser: [],
      totalEngraisCout: 0,
      totalPesticidesCout: 0,
    },
  ]);
});

test('entrées dégénérées : tableau vide, aucun crash', () => {
  assert.deepStrictEqual(aggregateConsoParcelle(null), []);
  assert.deepStrictEqual(aggregateConsoParcelle(undefined), []);
  assert.deepStrictEqual(aggregateConsoParcelle('x'), []);
  assert.deepStrictEqual(aggregateConsoParcelle([null, 3, 'y']), []);
});

test('sans deriveFerme injecté : ferme vide, pas de crash', () => {
  const out = aggregateConsoParcelle([row()], {});
  assert.strictEqual(out[0].ferme, '');
});

// ---------------------------------------------------------------------------
// Classification TOLÉRANTE (le défaut corrigé)
// ---------------------------------------------------------------------------

test('les variantes de casse d Engrais sont classées en engrais', () => {
  for (const cat of ['Engrais', 'engrais', 'ENGRAIS', 'Engrais foliaire', '  engrais  ']) {
    const out = aggregateConsoParcelle([row({ Article_Categorie: cat })], OPTS);
    assert.strictEqual(out.length, 1, 'catégorie ' + cat + ' : parcelle attendue');
    assert.strictEqual(out[0].engrais.length, 1, 'catégorie ' + cat + ' : classée engrais');
    assert.strictEqual(out[0].pesticides.length, 0);
  }
});

test('Pesticides / pesticides / PHYTO-SANITAIRE sont classés en pesticide', () => {
  for (const cat of ['Pesticides', 'pesticides', 'PESTICIDE', 'PHYTO-SANITAIRE', 'phyto']) {
    const out = aggregateConsoParcelle([row({ Article_Categorie: cat })], OPTS);
    assert.strictEqual(out.length, 1, 'catégorie ' + cat + ' : parcelle attendue');
    assert.strictEqual(out[0].pesticides.length, 1, 'catégorie ' + cat + ' : classée pesticide');
    assert.strictEqual(out[0].engrais.length, 0);
  }
});

test('une catégorie hors engrais/pesticide part dans le seau « à classer »', () => {
  // Régression du défaut central du ticket : ces lignes faisaient `continue`
  // et disparaissaient sans laisser de trace (36 lignes en production).
  for (const cat of ['Divers', '', null, undefined, 'EPI']) {
    const out = aggregateConsoParcelle([row({ Article_Categorie: cat })], OPTS);
    assert.strictEqual(out.length, 1, 'catégorie ' + String(cat) + ' : parcelle attendue');
    assert.deepStrictEqual(out[0].aClasser, [{ article: 'UREE 46', qty: 10, unite: 'kg', coutTotal: 0 }]);
    assert.deepStrictEqual(out[0].engrais, [], 'jamais rangée en engrais par défaut');
    assert.deepStrictEqual(out[0].pesticides, []);
  }
});

test('engrais et pesticides coexistent sur la même parcelle', () => {
  const out = aggregateConsoParcelle(
    [
      row({ Article: 'UREE 46', Article_Categorie: 'engrais', Quantite: 10 }),
      row({ Article: 'DECIS', Article_Categorie: 'PHYTO-SANITAIRE', Quantite: 2, Article_unite: 'L' }),
    ],
    OPTS
  );
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].engrais, [{ article: 'UREE 46', qty: 10, unite: 'kg', coutTotal: 0 }]);
  assert.deepStrictEqual(out[0].pesticides, [{ article: 'DECIS', qty: 2, unite: 'L', coutTotal: 0 }]);
});

// ---------------------------------------------------------------------------
// Agrégation
// ---------------------------------------------------------------------------

test('même article, même parcelle : quantités CUMULÉES sur une seule ligne', () => {
  const out = aggregateConsoParcelle(
    [row({ Quantite: 10 }), row({ Quantite: 5 }), row({ Quantite: 2.5 })],
    OPTS
  );
  assert.strictEqual(out[0].engrais.length, 1);
  assert.strictEqual(out[0].engrais[0].qty, 17.5);
});

test('le cumul traverse les variantes de casse de la catégorie', () => {
  const out = aggregateConsoParcelle(
    [row({ Quantite: 10, Article_Categorie: 'Engrais' }), row({ Quantite: 5, Article_Categorie: 'engrais' })],
    OPTS
  );
  assert.strictEqual(out[0].engrais.length, 1, 'une seule ligne article');
  assert.strictEqual(out[0].engrais[0].qty, 15);
});

test('même article dans DEUX familles : deux lignes distinctes', () => {
  const out = aggregateConsoParcelle(
    [row({ Article: 'X', Quantite: 10 }), row({ Article: 'X', Article_Categorie: 'Pesticides', Quantite: 4 })],
    OPTS
  );
  assert.strictEqual(out[0].engrais[0].qty, 10);
  assert.strictEqual(out[0].pesticides[0].qty, 4);
});

test('articles distincts : lignes distinctes, triées par libellé', () => {
  const out = aggregateConsoParcelle(
    [row({ Article: 'ZINC' }), row({ Article: 'AMMONITRATE' }), row({ Article: 'MAP' })],
    OPTS
  );
  assert.deepStrictEqual(out[0].engrais.map((e) => e.article), ['AMMONITRATE', 'MAP', 'ZINC']);
});

test('parcelles distinctes : entrées distinctes, triées par libellé', () => {
  const out = aggregateConsoParcelle(
    [row({ Parcelle_Culturale: 'F5 S8-1' }), row({ Parcelle_Culturale: 'F1 S1' })],
    OPTS
  );
  assert.deepStrictEqual(out.map((p) => p.parcelle), ['F1 S1', 'F5 S8-1']);
});

test("l'unité retenue est celle de la PREMIÈRE occurrence de l'article", () => {
  const out = aggregateConsoParcelle([row({ Article_unite: 'kg' }), row({ Article_unite: 'L' })], OPTS);
  assert.strictEqual(out[0].engrais[0].unite, 'kg');
});

test('quantité en chaîne : additionnée numériquement, jamais concaténée', () => {
  const out = aggregateConsoParcelle([row({ Quantite: '10' }), row({ Quantite: '5' })], OPTS);
  assert.strictEqual(out[0].engrais[0].qty, 15);
});

test('quantité non numérique : ligne ignorée, ne pollue pas le cumul', () => {
  const out = aggregateConsoParcelle([row({ Quantite: 10 }), row({ Quantite: 'abc' })], OPTS);
  assert.strictEqual(out[0].engrais[0].qty, 10);
});

test('parcelle vide : ligne ignorée', () => {
  assert.deepStrictEqual(aggregateConsoParcelle([row({ Parcelle_Culturale: '' })], OPTS), []);
  assert.deepStrictEqual(aggregateConsoParcelle([row({ Parcelle_Culturale: '  ' })], OPTS), []);
  assert.deepStrictEqual(aggregateConsoParcelle([row({ Parcelle_Culturale: null })], OPTS), []);
});

test('une parcelle dont TOUTES les lignes sont à classer ressort quand même', () => {
  // Changement assumé : avant, cette parcelle disparaissait de l'écran avec ses
  // lignes. Elle ressort désormais, colonnes engrais/pesticides vides, et ses
  // lignes sont comptées dans `aClasser`.
  const out = aggregateConsoParcelle(
    [row({ Parcelle_Culturale: 'F1 S1' }), row({ Parcelle_Culturale: 'F1 S2', Article_Categorie: 'Divers' })],
    OPTS
  );
  assert.deepStrictEqual(out.map((p) => p.parcelle), ['F1 S1', 'F1 S2']);
  assert.strictEqual(out[1].engrais.length, 0);
  assert.strictEqual(out[1].pesticides.length, 0);
  assert.strictEqual(out[1].aClasser.length, 1);
});

// ---------------------------------------------------------------------------
// INVARIANTE DE CONSERVATION — rien ne disparaît en silence
// ---------------------------------------------------------------------------

test('conservation : Σ entrée == Σ engrais + Σ pesticides + Σ à classer', () => {
  const rows = [
    row({ Article: 'UREE 46', Article_Categorie: 'Engrais', Quantite: 10 }),
    row({ Article: 'MAP', Article_Categorie: 'engrais', Quantite: 5 }),
    row({ Article: 'DECIS', Article_Categorie: 'PHYTO-SANITAIRE', Quantite: 2 }),
    row({ Article: 'EXTREME', Article_Categorie: 'autre', Quantite: 17.5 }),
    row({ Article: 'GENAKTIS', Article_Categorie: '', Quantite: 8 }),
    row({ Article: 'JOKER', Article_Categorie: 'Divers', Quantite: 1, Parcelle_Culturale: 'F5 S8-1' }),
  ];
  const out = aggregateConsoParcelle(rows, OPTS);

  const nbSortie = out.reduce((n, p) => n + p.engrais.length + p.pesticides.length + p.aClasser.length, 0);
  assert.strictEqual(nbSortie, rows.length, 'aucune ligne perdue');

  const somme = (list) => list.reduce((s, a) => s + a.qty, 0);
  const qteSortie = out.reduce(
    (s, p) => s + somme(p.engrais) + somme(p.pesticides) + somme(p.aClasser),
    0
  );
  const qteEntree = rows.reduce((s, r) => s + r.Quantite, 0);
  assert.strictEqual(qteSortie, qteEntree, 'aucune quantité perdue');

  // Et le détail : 3 lignes tombent bien dans le seau « à classer ».
  const nbAClasser = out.reduce((n, p) => n + p.aClasser.length, 0);
  assert.strictEqual(nbAClasser, 3);
});

test('conservation : le récapitulatif couvre EXACTEMENT le seau à classer', () => {
  const rows = [
    row({ Article: 'UREE 46', Article_Categorie: 'Engrais', Quantite: 10 }),
    row({ Article: 'EXTREME', Article_Categorie: 'autre', Quantite: 10 }),
    row({ Article: 'EXTREME', Article_Categorie: 'autre', Quantite: 7.5, Parcelle_Culturale: 'F5 S8-1' }),
  ];
  const out = aggregateConsoParcelle(rows, OPTS);
  const recap = articlesAClasser(rows);

  const lignesSeau = out.reduce((n, p) => n + p.aClasser.length, 0);
  const lignesRecap = recap.reduce((n, a) => n + a.lignes, 0);
  assert.strictEqual(lignesRecap, lignesSeau);
  assert.strictEqual(recap[0].quantite, 17.5);
});

// ---------------------------------------------------------------------------
// Ha
// ---------------------------------------------------------------------------

test('ha : un Ha NÉGATIF est ramené à 0, jamais propagé', () => {
  const opts = { haByLabel: { NEG: -5 }, deriveFerme };
  const out = aggregateConsoParcelle([row({ Parcelle_Culturale: 'NEG' })], opts);
  assert.strictEqual(out[0].ha, 0);
});

test('ha : référentiel, insensible à la casse, 0 si absent ou <= 0', () => {
  const opts = { haByLabel: { 'F1 S1': 2.5, ZZ: 0 }, deriveFerme };
  const out = aggregateConsoParcelle(
    [row({ Parcelle_Culturale: 'f1 s1' }), row({ Parcelle_Culturale: 'ZZ' }), row({ Parcelle_Culturale: 'QQ' })],
    opts
  );
  const byP = {};
  out.forEach((p) => { byP[p.parcelle] = p.ha; });
  assert.deepStrictEqual(byP, { 'f1 s1': 2.5, ZZ: 0, QQ: 0 });
});

// ---------------------------------------------------------------------------
// Cloisonnement ferme — FAIL-CLOSED
// ---------------------------------------------------------------------------

test('sans fermeFilter : toutes les fermes sont visibles', () => {
  const out = aggregateConsoParcelle(
    [row({ Parcelle_Culturale: 'F1 S1' }), row({ Parcelle_Culturale: 'F5 S8-1' }), row({ Parcelle_Culturale: 'EL BAHIA P2' })],
    OPTS
  );
  assert.strictEqual(out.length, 3);
});

test('fermeFilter : un chef ne voit QUE sa ferme', () => {
  const rows = [
    row({ Parcelle_Culturale: 'F1 S1' }),
    row({ Parcelle_Culturale: 'F5 S8-1' }),
    row({ Parcelle_Culturale: 'EL BAHIA P2' }),
    row({ Parcelle_Culturale: 'HAAS BLOC 3' }),
  ];
  const only = (f) => aggregateConsoParcelle(rows, Object.assign({}, OPTS, { fermeFilter: f })).map((p) => p.parcelle);
  assert.deepStrictEqual(only('F1'), ['F1 S1']);
  assert.deepStrictEqual(only('F5'), ['F5 S8-1']);
  assert.deepStrictEqual(only('BAHIA'), ['EL BAHIA P2']);
  assert.deepStrictEqual(only('Avocatier'), ['HAAS BLOC 3']);
});

test('fermeFilter : parcelle non dérivable EXCLUE (jamais attribuée à un chef)', () => {
  const rows = [row({ Parcelle_Culturale: 'CASCADE MYRTILLE S8-1' })];
  assert.strictEqual(aggregateConsoParcelle(rows, Object.assign({}, OPTS, { fermeFilter: 'F5' })).length, 0);
  // ... mais bien visible pour un profil global.
  assert.strictEqual(aggregateConsoParcelle(rows, OPTS).length, 1);
});

test('fermeFilter : le rejet tient sur TOUTES les lignes de la parcelle', () => {
  // Régression : un rejet mémorisé à la 1re ligne ne doit pas être « oublié »
  // par une ligne suivante de la même parcelle.
  const rows = [
    row({ Parcelle_Culturale: 'F5 S8-1', Article: 'A' }),
    row({ Parcelle_Culturale: 'F5 S8-1', Article: 'B' }),
    row({ Parcelle_Culturale: 'F5 S8-1', Article: 'C', Article_Categorie: 'Pesticides' }),
    row({ Parcelle_Culturale: 'F1 S1', Article: 'D' }),
  ];
  const out = aggregateConsoParcelle(rows, Object.assign({}, OPTS, { fermeFilter: 'F1' }));
  assert.deepStrictEqual(out.map((p) => p.parcelle), ['F1 S1']);
  assert.strictEqual(out[0].engrais.length, 1);
  assert.strictEqual(out[0].pesticides.length, 0);
});

test('fermeFilter + deriveFerme PAR DÉFAUT : tout est exclu (contrat fail-closed)', () => {
  // `deriveFerme` est optionnel et vaut `() => ''` par défaut. Le contrat annoncé
  // en en-tête est que '' n'est JAMAIS admis dans le périmètre d'un chef : sans
  // ce test, un `ferme && ferme !== fermeFilter` (fail-OPEN) passerait inaperçu.
  assert.deepStrictEqual(aggregateConsoParcelle([row()], { fermeFilter: 'F1' }), []);
  assert.deepStrictEqual(aggregateConsoParcelle([row()], { haByLabel: OPTS.haByLabel, fermeFilter: 'F1' }), []);
  // ... et sans fermeFilter, la même entrée ressort bien (le test ne passe donc
  // pas « par accident » sur une agrégation vide).
  assert.strictEqual(aggregateConsoParcelle([row()], {}).length, 1);
});

test('deriveFerme qui renvoie une valeur vide/nulle : exclu pour un chef', () => {
  for (const vide of ['', '   ', null, undefined]) {
    const opts = Object.assign({}, OPTS, { deriveFerme: () => vide, fermeFilter: 'F1' });
    assert.deepStrictEqual(aggregateConsoParcelle([row()], opts), [], 'deriveFerme -> ' + JSON.stringify(vide));
  }
});

test('la ferme est TRIMÉE avant comparaison au périmètre', () => {
  // Un deriveFerme qui renvoie un libellé entouré d'espaces ne doit pas faire
  // rater le périmètre du chef — ni ressortir non trimé dans le payload.
  const opts = Object.assign({}, OPTS, { deriveFerme: () => '  F1  ' });
  const out = aggregateConsoParcelle([row()], Object.assign({}, opts, { fermeFilter: 'F1' }));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].ferme, 'F1');
});

test('deriveFerme appelé UNE SEULE FOIS par parcelle (le rejet est tranché une fois)', () => {
  let appels = 0;
  const opts = Object.assign({}, OPTS, {
    deriveFerme: (p) => { appels++; return deriveFerme(p); },
    fermeFilter: 'F1',
  });
  aggregateConsoParcelle(
    [
      row({ Parcelle_Culturale: 'F5 S8-1', Article: 'A' }),
      row({ Parcelle_Culturale: 'F5 S8-1', Article: 'B' }),
      row({ Parcelle_Culturale: 'F5 S8-1', Article: 'C' }),
      row({ Parcelle_Culturale: 'F1 S1', Article: 'D' }),
      row({ Parcelle_Culturale: 'F1 S1', Article: 'E' }),
    ],
    opts
  );
  assert.strictEqual(appels, 2, 'une évaluation par parcelle distincte, rejetée ou non');
});

test("fermeFilter n'accepte pas une correspondance approximative", () => {
  const rows = [row({ Parcelle_Culturale: 'F1 S1' })];
  assert.strictEqual(aggregateConsoParcelle(rows, Object.assign({}, OPTS, { fermeFilter: 'f1' })).length, 0);
  assert.strictEqual(aggregateConsoParcelle(rows, Object.assign({}, OPTS, { fermeFilter: 'F' })).length, 0);
});

// ---------------------------------------------------------------------------
// Cloisonnement culture (chef_f1 : périmètre ferme 'all', cloisonné par culture)
// ---------------------------------------------------------------------------

test('cultureFilter : ne garde que les parcelles de la culture du chef', () => {
  const rows = [
    row({ Parcelle_Culturale: 'F1 S1' }),            // Framboise (défaut)
    row({ Parcelle_Culturale: 'F5 S8-1 CORINA' }),   // Myrtille
    row({ Parcelle_Culturale: 'HAAS BLOC 3' }),      // Avocatier
  ];
  const only = (c) => aggregateConsoParcelle(rows, Object.assign({}, OPTS, { cultureFilter: c })).map((p) => p.parcelle);
  assert.deepStrictEqual(only('Framboise'), ['F1 S1']);
  assert.deepStrictEqual(only('Myrtille'), ['F5 S8-1 CORINA']);
  assert.deepStrictEqual(only('Avocatier'), ['HAAS BLOC 3']);
});

test('cultureFilter : le référentiel Smart Berry (culture_sb) prime', () => {
  const rows = [row({ Parcelle_Culturale: 'F1 S1' })];
  const opts = Object.assign({}, OPTS, { sbMap: { 'F1 S1': { culture_sb: 'Myrtille' } } });
  assert.strictEqual(aggregateConsoParcelle(rows, Object.assign({}, opts, { cultureFilter: 'Myrtille' })).length, 1);
  assert.strictEqual(aggregateConsoParcelle(rows, Object.assign({}, opts, { cultureFilter: 'Framboise' })).length, 0);
});

test('cultureFilter ignore le champ Culture de la LIGNE (source non fiable)', () => {
  // Le champ Culture d'une ligne vient d'un item de bon, sale et souvent vide :
  // le cloisonnement se décide sur la parcelle + le référentiel, jamais dessus.
  const rows = [row({ Parcelle_Culturale: 'F1 S1', Culture: 'Myrtille' })];
  assert.strictEqual(aggregateConsoParcelle(rows, Object.assign({}, OPTS, { cultureFilter: 'Myrtille' })).length, 0);
  assert.strictEqual(aggregateConsoParcelle(rows, Object.assign({}, OPTS, { cultureFilter: 'Framboise' })).length, 1);
});

test('fermeFilter et cultureFilter se CUMULENT', () => {
  const rows = [
    row({ Parcelle_Culturale: 'F5 S8-1 CORINA' }), // F5 / Myrtille
    row({ Parcelle_Culturale: 'F5 S9' }),          // F5 / Framboise
    row({ Parcelle_Culturale: 'F1 S1' }),          // F1 / Framboise
  ];
  const out = aggregateConsoParcelle(rows, Object.assign({}, OPTS, { fermeFilter: 'F5', cultureFilter: 'Myrtille' }));
  assert.deepStrictEqual(out.map((p) => p.parcelle), ['F5 S8-1 CORINA']);
});

// ---------------------------------------------------------------------------
// Hors périmètre : les coûts restent à 0
// ---------------------------------------------------------------------------

test('les totaux de coût restent à 0 (décision produit séparée)', () => {
  const out = aggregateConsoParcelle([row(), row({ Article_Categorie: 'Pesticides' })], OPTS);
  assert.strictEqual(out[0].totalEngraisCout, 0);
  assert.strictEqual(out[0].totalPesticidesCout, 0);
  assert.strictEqual(out[0].engrais[0].coutTotal, 0);
  assert.strictEqual(out[0].pesticides[0].coutTotal, 0);
});

// ---------------------------------------------------------------------------
// Chaîne complète adaptateur -> agrégation
// ---------------------------------------------------------------------------

test('bout en bout : deux bons de la campagne, cumul par article et parcelle', () => {
  const bons = [
    {
      id: 'b1', numero: 'BC-1', type: 'engrais', cpc_categorie: 'Engrais', date: '2026-08-01',
      items: [
        { article: 'UREE 46', quantite: 10, unite: 'kg', parcelle: 'F1 S1', ferme: 'BERRY GOOD Farms' },
        { article: 'UREE 46', quantite: '5', unite: 'kg', parcelle: 'F1 S1' },
        { article: 'MAP', quantite: 3, unite: 'kg', parcelle: 'F5 S8-1' },
        { article: 'IGNORE', quantite: 0, unite: 'kg', parcelle: 'F1 S1' },
      ],
    },
    {
      id: 'b2', numero: 'BC-2', type: 'pesticide', cpc_categorie: 'pesticides', date: '2026-09-15',
      items: [{ article: 'DECIS', quantite: 2, unite: 'L', parcelle: 'F1 S1' }],
    },
    // Hors campagne courante : ne doit rien produire.
    {
      id: 'b3', numero: 'BC-3', type: 'engrais', cpc_categorie: 'Engrais', date: '2026-05-01',
      items: [{ article: 'HORS CAMPAGNE', quantite: 99, unite: 'kg', parcelle: 'F1 S1' }],
    },
  ];
  const rows = adaptBonsToConsoRows(bons, { campagne: '2026-2027', haByLabel: OPTS.haByLabel });
  const out = aggregateConsoParcelle(rows, OPTS);

  assert.deepStrictEqual(out.map((p) => p.parcelle), ['F1 S1', 'F5 S8-1']);
  assert.deepStrictEqual(out[0].engrais, [{ article: 'UREE 46', qty: 15, unite: 'kg', coutTotal: 0 }]);
  assert.deepStrictEqual(out[0].pesticides, [{ article: 'DECIS', qty: 2, unite: 'L', coutTotal: 0 }]);
  assert.strictEqual(out[0].ferme, 'F1');
  assert.strictEqual(out[0].ha, 2.5);
  assert.deepStrictEqual(out[1].engrais, [{ article: 'MAP', qty: 3, unite: 'kg', coutTotal: 0 }]);
});

test('bout en bout : campagne sans aucun bon -> écran vide, pas de crash', () => {
  const bons = [{ id: 'b', numero: 'BC-1', cpc_categorie: 'Engrais', date: '2025-09-01', items: [{ article: 'A', quantite: 1, parcelle: 'F1 S1' }] }];
  const rows = adaptBonsToConsoRows(bons, { campagne: '2026-2027' });
  assert.deepStrictEqual(aggregateConsoParcelle(rows, OPTS), []);
});
