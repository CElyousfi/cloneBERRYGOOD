'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { adaptBonsToConsoRows, categorieOf, quantiteOf } = require('../bonsToConsoRows');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Bon minimal valide, surchargeable. */
function bon(over) {
  return Object.assign(
    {
      id: 'bon1',
      numero: 'BC-0001',
      type: 'engrais',
      cpc_categorie: 'Engrais',
      date: '2026-08-10',
      items: [{ article: 'UREE 46', quantite: 10, unite: 'kg', parcelle: 'F1 S1', culture: 'FRAMBOISE', ferme: 'F1' }],
    },
    over
  );
}

const HA = { 'F1 S1': 2.5, 'F5 S8-1': 1.25 };

// ---------------------------------------------------------------------------
// categorieOf
// ---------------------------------------------------------------------------

test('categorieOf : cpc_categorie prioritaire', () => {
  assert.strictEqual(categorieOf({ cpc_categorie: 'Pesticides', type: 'engrais' }), 'Pesticides');
});

test('categorieOf : repli sur type quand cpc_categorie manque', () => {
  assert.strictEqual(categorieOf({ type: 'engrais' }), 'Engrais');
  assert.strictEqual(categorieOf({ type: 'pesticide' }), 'Pesticides');
  assert.strictEqual(categorieOf({ type: 'PESTICIDE' }), 'Pesticides');
});

test('categorieOf : rien d exploitable -> chaine vide (jamais rangé dans Engrais par défaut)', () => {
  assert.strictEqual(categorieOf({}), '');
  assert.strictEqual(categorieOf(null), '');
  assert.strictEqual(categorieOf({ type: 'divers' }), '');
  assert.strictEqual(categorieOf({ cpc_categorie: '   ' }), '');
});

// ---------------------------------------------------------------------------
// quantiteOf
// ---------------------------------------------------------------------------

test('quantiteOf : nombres, chaines, rejets', () => {
  assert.strictEqual(quantiteOf(10), 10);
  assert.strictEqual(quantiteOf('12.5'), 12.5);
  assert.strictEqual(quantiteOf(0), null);
  assert.strictEqual(quantiteOf(-3), null);
  assert.strictEqual(quantiteOf(''), null);
  assert.strictEqual(quantiteOf(null), null);
  assert.strictEqual(quantiteOf(undefined), null);
  assert.strictEqual(quantiteOf('abc'), null);
  assert.strictEqual(quantiteOf(NaN), null);
  assert.strictEqual(quantiteOf(Infinity), null);
});

// ---------------------------------------------------------------------------
// adaptBonsToConsoRows — forme de sortie
// ---------------------------------------------------------------------------

test('mappe un bon simple sur la forme de ligne miroir', () => {
  const rows = adaptBonsToConsoRows([bon()], { haByLabel: HA });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], {
    Date: '2026-08-10',
    Parcelle_Culturale: 'F1 S1',
    Article: 'UREE 46',
    Article_Categorie: 'Engrais',
    Quantite: 10,
    Article_unite: 'kg',
    Culture: 'Framboise',
    Ferme: 'F1',
    Parcelle_sup: 2.5,
    Bon_Id: 'bon1',
    Bon_Numero: 'BC-0001',
  });
});

test('entrées non-tableau / non-objet : aucune ligne, aucun crash', () => {
  assert.deepStrictEqual(adaptBonsToConsoRows(null), []);
  assert.deepStrictEqual(adaptBonsToConsoRows(undefined), []);
  assert.deepStrictEqual(adaptBonsToConsoRows('nope'), []);
  assert.deepStrictEqual(adaptBonsToConsoRows([null, undefined, 42, 'x']), []);
});

test('bon sans items (absent, vide, non-tableau) : aucune ligne', () => {
  assert.strictEqual(adaptBonsToConsoRows([bon({ items: undefined })]).length, 0);
  assert.strictEqual(adaptBonsToConsoRows([bon({ items: [] })]).length, 0);
  assert.strictEqual(adaptBonsToConsoRows([bon({ items: 'x' })]).length, 0);
  assert.strictEqual(adaptBonsToConsoRows([bon({ items: [null, 7] })]).length, 0);
});

test('item sans quantité exploitable : ligne NON émise (pas une ligne à zéro)', () => {
  const b = bon({
    items: [
      { article: 'A', quantite: 0, unite: 'kg', parcelle: 'F1 S1' },
      { article: 'B', unite: 'kg', parcelle: 'F1 S1' },
      { article: 'C', quantite: 'abc', unite: 'kg', parcelle: 'F1 S1' },
      { article: 'D', quantite: -5, unite: 'kg', parcelle: 'F1 S1' },
      { article: 'E', quantite: 1, unite: 'kg', parcelle: 'F1 S1' },
    ],
  });
  const rows = adaptBonsToConsoRows([b]);
  assert.deepStrictEqual(rows.map((r) => r.Article), ['E']);
});

test('quantité saisie en CHAÎNE : convertie en nombre', () => {
  const rows = adaptBonsToConsoRows([bon({ items: [{ article: 'A', quantite: '12.5', unite: 'L', parcelle: 'F1 S1' }] })]);
  assert.strictEqual(rows[0].Quantite, 12.5);
  assert.strictEqual(typeof rows[0].Quantite, 'number');
});

test('item sans parcelle : ligne NON émise (rien à joindre en aval)', () => {
  const b = bon({
    items: [
      { article: 'A', quantite: 1, parcelle: '' },
      { article: 'B', quantite: 1, parcelle: '   ' },
      { article: 'C', quantite: 1 },
      { article: 'D', quantite: 1, parcelle: 'F1 S1' },
    ],
  });
  assert.deepStrictEqual(adaptBonsToConsoRows([b]).map((r) => r.Article), ['D']);
});

test('la parcelle est trimée mais jamais réécrite (jointure aval par libellé)', () => {
  const rows = adaptBonsToConsoRows([bon({ items: [{ article: 'A', quantite: 1, parcelle: '  F1 S1  ' }] })], { haByLabel: HA });
  assert.strictEqual(rows[0].Parcelle_Culturale, 'F1 S1');
  assert.strictEqual(rows[0].Parcelle_sup, 2.5, 'le Ha se résout sur le libellé trimé');
});

// ---------------------------------------------------------------------------
// Catégorie sale
// ---------------------------------------------------------------------------

test('catégorie sale : la valeur brute est TRANSMISE telle quelle (classement en aval)', () => {
  const cas = ['Engrais', 'engrais', 'Pesticides', 'pesticides', 'PHYTO-SANITAIRE'];
  for (const c of cas) {
    const rows = adaptBonsToConsoRows([bon({ cpc_categorie: c })]);
    assert.strictEqual(rows[0].Article_Categorie, c, 'catégorie ' + c);
  }
});

test('cpc_categorie absent : la catégorie vient du type du bon', () => {
  const rows = adaptBonsToConsoRows([bon({ cpc_categorie: undefined, type: 'pesticide' })]);
  assert.strictEqual(rows[0].Article_Categorie, 'Pesticides');
});

// ---------------------------------------------------------------------------
// Culture
// ---------------------------------------------------------------------------

test('culture absente : repli sur le libellé de parcelle', () => {
  const b = bon({
    items: [
      { article: 'A', quantite: 1, parcelle: 'F5 S8-1 CORINA', culture: '' },
      { article: 'B', quantite: 1, parcelle: 'HAAS BLOC 3' },
      { article: 'C', quantite: 1, parcelle: 'F1 S1' },
    ],
  });
  const rows = adaptBonsToConsoRows([b]);
  assert.deepStrictEqual(rows.map((r) => r.Culture), ['Myrtille', 'Avocatier', 'Framboise']);
});

test('culture sale (casse, pluriel) : canonisée', () => {
  const b = bon({
    items: [
      { article: 'A', quantite: 1, parcelle: 'P1', culture: 'FRAMBOISE' },
      { article: 'B', quantite: 1, parcelle: 'P2', culture: 'Framboise' },
      { article: 'C', quantite: 1, parcelle: 'P3', culture: 'AVOCATIER' },
      { article: 'D', quantite: 1, parcelle: 'P4', culture: 'Avocatier' },
      { article: 'E', quantite: 1, parcelle: 'P5', culture: 'MYRTILLES' },
    ],
  });
  const rows = adaptBonsToConsoRows([b]);
  assert.deepStrictEqual(rows.map((r) => r.Culture), [
    'Framboise', 'Framboise', 'Avocatier', 'Avocatier', 'Myrtille',
  ]);
});

test('le référentiel Smart Berry (culture_sb) prime sur item.culture', () => {
  const sbMap = { 'F1 S1': { culture_sb: 'Myrtille' } };
  const rows = adaptBonsToConsoRows([bon()], { sbMap });
  assert.strictEqual(rows[0].Culture, 'Myrtille');
});

test('culture_sb vide dans le référentiel : repli, pas de culture vide', () => {
  const sbMap = { 'F1 S1': { culture_sb: '   ' } };
  const rows = adaptBonsToConsoRows([bon()], { sbMap });
  assert.strictEqual(rows[0].Culture, 'Framboise');
});

// ---------------------------------------------------------------------------
// Ferme — cloisonnement
// ---------------------------------------------------------------------------

test('Ferme est DÉRIVÉE de la parcelle, jamais reprise de item.ferme', () => {
  const b = bon({
    items: [
      // item.ferme fourre-tout (212/500 items en prod) : doit être ignoré.
      { article: 'A', quantite: 1, parcelle: 'F5 S8-1', ferme: 'BERRY GOOD Farms' },
      // item.ferme contredit la parcelle : la parcelle gagne.
      { article: 'B', quantite: 1, parcelle: 'F1 S1', ferme: 'F5' },
      { article: 'C', quantite: 1, parcelle: 'EL BAHIA P2', ferme: 'F1' },
      { article: 'D', quantite: 1, parcelle: 'HAAS BLOC 3', ferme: 'BERRY GOOD Farms' },
    ],
  });
  const rows = adaptBonsToConsoRows([b]);
  assert.deepStrictEqual(rows.map((r) => r.Ferme), ['F5', 'F1', 'BAHIA', 'Avocatier']);
});

test('parcelle non dérivable : Ferme vide (fail-closed), jamais item.ferme', () => {
  const rows = adaptBonsToConsoRows([
    bon({ items: [{ article: 'A', quantite: 1, parcelle: 'PARCELLE SANS INDICE', ferme: 'F5' }] }),
  ]);
  assert.strictEqual(rows[0].Ferme, '');
});

test('Ferme suit la règle UNIQUE fermeConso (secteur + avocat), pas la seule règle valorisation', () => {
  const b = bon({
    items: [
      // Rattrapées par la règle de SECTEUR : `deriveFermeFromParcelle` seule
      // renvoyait null ici, et chef_f5 perdait ces parcelles.
      { article: 'A', quantite: 1, parcelle: 'CASCADE MYRTILLE S8-1', ferme: 'F5' },
      { article: 'B', quantite: 1, parcelle: 'BREEZE MYRTILLE S8-2' },
      // Rattrapées par la règle AVOCAT : `resolveFermeFromParcelle` seule
      // renvoyait INCONNU ici, et chef_avo voyait un écran vide.
      { article: 'C', quantite: 1, parcelle: 'F2 - HAAS' },
      { article: 'D', quantite: 1, parcelle: 'AVOCAT F5' },
    ],
  });
  assert.deepStrictEqual(
    adaptBonsToConsoRows([b]).map((r) => r.Ferme),
    ['F5', 'F5', 'Avocatier', 'Avocatier']
  );
});

// ---------------------------------------------------------------------------
// Ha
// ---------------------------------------------------------------------------

test('Parcelle_sup : Ha du référentiel, 0 si inconnu ou invalide', () => {
  const b = bon({
    items: [
      { article: 'A', quantite: 1, parcelle: 'F1 S1' },
      { article: 'B', quantite: 1, parcelle: 'INCONNUE' },
      { article: 'C', quantite: 1, parcelle: 'ZERO' },
      { article: 'D', quantite: 1, parcelle: 'NAN' },
    ],
  });
  const rows = adaptBonsToConsoRows([b], { haByLabel: { 'F1 S1': 2.5, ZERO: 0, NAN: 'abc' } });
  assert.deepStrictEqual(rows.map((r) => r.Parcelle_sup), [2.5, 0, 0, 0]);
});

test('Parcelle_sup : un Ha NÉGATIF est ramené à 0, jamais propagé', () => {
  // Sans ce cas, `isFinite(ha) ? ha : 0` (sans le `> 0`) passe inaperçu : la
  // valeur 0 donne le même résultat des deux côtés.
  const rows = adaptBonsToConsoRows([bon({ items: [{ article: 'A', quantite: 1, parcelle: 'NEG' }] })], {
    haByLabel: { NEG: -5 },
  });
  assert.strictEqual(rows[0].Parcelle_sup, 0);
});

test('le lookup Ha est insensible à la casse du libellé', () => {
  const rows = adaptBonsToConsoRows([bon({ items: [{ article: 'A', quantite: 1, parcelle: 'f1 s1' }] })], { haByLabel: HA });
  assert.strictEqual(rows[0].Parcelle_sup, 2.5);
});

// ---------------------------------------------------------------------------
// Dates & campagne
// ---------------------------------------------------------------------------

test('filtre campagne : ne garde que les bons de la campagne demandée', () => {
  const bons = [
    bon({ id: 'a', date: '2026-08-10' }), // 2026-2027
    bon({ id: 'b', date: '2026-06-30' }), // 2025-2026
    bon({ id: 'c', date: '2026-07-01' }), // 2026-2027 (frontière basse)
    bon({ id: 'd', date: '2027-06-30' }), // 2026-2027 (frontière haute)
    bon({ id: 'e', date: '2027-07-01' }), // 2027-2028
  ];
  const rows = adaptBonsToConsoRows(bons, { campagne: '2026-2027' });
  assert.deepStrictEqual(rows.map((r) => r.Bon_Id), ['a', 'c', 'd']);
});

test('sans filtre campagne : toutes les dates passent', () => {
  const bons = [bon({ id: 'a', date: '2025-09-01' }), bon({ id: 'b', date: '2026-08-10' })];
  assert.strictEqual(adaptBonsToConsoRows(bons).length, 2);
});

test('un bon change de campagne quand sa date change (update-bc-date)', () => {
  const avant = bon({ id: 'x', date: '2026-06-15' }); // 2025-2026
  const apres = bon({ id: 'x', date: '2026-07-15' }); // 2026-2027
  assert.strictEqual(adaptBonsToConsoRows([avant], { campagne: '2026-2027' }).length, 0);
  assert.strictEqual(adaptBonsToConsoRows([apres], { campagne: '2026-2027' }).length, 1);
  assert.strictEqual(adaptBonsToConsoRows([avant], { campagne: '2025-2026' }).length, 1);
  assert.strictEqual(adaptBonsToConsoRows([apres], { campagne: '2025-2026' }).length, 0);
});

test('date absente ou non ISO : bon EXCLU (aucune fenêtre ne peut trancher)', () => {
  for (const d of [undefined, '', '10/08/2026', '2026-8-10', '2026-08-10T00:00:00Z', 20260810]) {
    assert.strictEqual(adaptBonsToConsoRows([bon({ date: d })]).length, 0, 'date=' + String(d));
  }
});

test('filtres since / until, bornes INCLUSIVES', () => {
  const bons = [
    bon({ id: 'a', date: '2026-07-31' }),
    bon({ id: 'b', date: '2026-08-01' }),
    bon({ id: 'c', date: '2026-08-31' }),
    bon({ id: 'd', date: '2026-09-01' }),
  ];
  assert.deepStrictEqual(
    adaptBonsToConsoRows(bons, { since: '2026-08-01', until: '2026-08-31' }).map((r) => r.Bon_Id),
    ['b', 'c']
  );
  assert.deepStrictEqual(adaptBonsToConsoRows(bons, { since: '2026-08-31' }).map((r) => r.Bon_Id), ['c', 'd']);
  assert.deepStrictEqual(adaptBonsToConsoRows(bons, { until: '2026-08-01' }).map((r) => r.Bon_Id), ['a', 'b']);
});

test('campagne et since se cumulent', () => {
  const bons = [bon({ id: 'a', date: '2026-07-05' }), bon({ id: 'b', date: '2026-12-05' })];
  assert.deepStrictEqual(
    adaptBonsToConsoRows(bons, { campagne: '2026-2027', since: '2026-10-01' }).map((r) => r.Bon_Id),
    ['b']
  );
});

// ---------------------------------------------------------------------------
// Multi-items / multi-bons — l'adaptateur n'agrège PAS
// ---------------------------------------------------------------------------

test('plusieurs items sur le même article et la même parcelle : une ligne CHACUN', () => {
  const b = bon({
    items: [
      { article: 'UREE 46', quantite: 10, unite: 'kg', parcelle: 'F1 S1' },
      { article: 'UREE 46', quantite: 5, unite: 'kg', parcelle: 'F1 S1' },
    ],
  });
  const rows = adaptBonsToConsoRows([b]);
  assert.strictEqual(rows.length, 2, "l'adaptateur ne fusionne pas : l'agrégation est en aval");
  assert.deepStrictEqual(rows.map((r) => r.Quantite), [10, 5]);
});

test("l'ordre des bons et des items est préservé", () => {
  const bons = [
    bon({ id: 'a', items: [{ article: 'A1', quantite: 1, parcelle: 'P' }, { article: 'A2', quantite: 1, parcelle: 'P' }] }),
    bon({ id: 'b', items: [{ article: 'B1', quantite: 1, parcelle: 'P' }] }),
  ];
  assert.deepStrictEqual(adaptBonsToConsoRows(bons).map((r) => r.Article), ['A1', 'A2', 'B1']);
});

test('bon sans numero / id : traçabilité vide, ligne quand même émise', () => {
  const rows = adaptBonsToConsoRows([bon({ id: undefined, numero: undefined })]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].Bon_Id, '');
  assert.strictEqual(rows[0].Bon_Numero, '');
});

test('article / unité manquants : chaînes vides, pas de undefined', () => {
  const rows = adaptBonsToConsoRows([bon({ items: [{ quantite: 1, parcelle: 'P' }] })]);
  assert.strictEqual(rows[0].Article, '');
  assert.strictEqual(rows[0].Article_unite, '');
});

test('aucune mutation des bons ni des items en entrée', () => {
  // Les valeurs sont volontairement « sales » (espaces, champs absents) : avec
  // un fixture déjà propre, une écriture de normalisation dans le bon source
  // serait un no-op et passerait inaperçue.
  const b = bon({
    numero: '  BC-0001  ',
    date: '2026-08-10',
    cpc_categorie: '  Engrais  ',
    type: '  ENGRAIS  ',
    items: [{ article: '  UREE 46  ', quantite: '10', unite: '  kg  ', parcelle: '  F1 S1  ', culture: '  FRAMBOISE  ' }],
  });
  const snapshot = JSON.parse(JSON.stringify(b));
  const rows = adaptBonsToConsoRows([b], { haByLabel: HA });
  assert.strictEqual(rows.length, 1, 'la ligne est bien produite');
  assert.deepStrictEqual(b, snapshot, 'le bon source ne doit pas être modifié');
  assert.deepStrictEqual(b.items[0], snapshot.items[0], "l'item source ne doit pas être modifié");
});
