'use strict'

/*
 * RÉUNION DES SOLDES FRAGMENTÉS — plan pur (functions/lib/stockMerge/reunionSoldes.js).
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - un article isolé (un seul solde) devient un « cas » à réparer ;
 *  - la règle de conservation cesse d'être celle de la fusion corrigée ;
 *  - des fragments d'unités différentes sont sommés en silence ;
 *  - l'incrément appliqué au document conservé inclut ce document lui-même ;
 *  - un solde inconnu du catalogue est embarqué au lieu d'être laissé intact.
 */

const test = require('node:test')
const assert = require('node:assert')

const R = require('../reunionSoldes')

// Le cas réel « Acide Phosphorique @ Station F5 ».
const CATALOGUE = [
  { id: 'Ref-Eng0052', nom: 'Acide Phosphorique', active: true },
  { id: 'QWNpZGUgUGhvc3Bob3JpcXVlfEVuZ3JhaXM', nom: 'Acide Phosphorique', active: false, merged_into: 'Ref-Eng0052' },
  { id: 'Ref-Eng0051', nom: 'Acide Nitrique', active: true },
]

function solde(docId, articleRef, balance, unite, lieuId) {
  return {
    docId,
    article_ref: articleRef,
    lieu_type: 'station',
    lieu_id: lieuId || 'Station F5',
    balance,
    unite: unite || 'l',
  }
}

// ── détection ──────────────────────────────────────────────────────────────

test('deux soldes du même article au même lieu forment un cas', () => {
  const { cas } = R.planifierReunion(
    [
      solde('station_Station_F5_Acide_Phosphorique', 'Acide Phosphorique', -411.85),
      solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8),
    ],
    CATALOGUE
  )
  assert.strictEqual(cas.length, 1)
  assert.strictEqual(cas[0].article_id, 'Ref-Eng0052')
  assert.strictEqual(cas[0].total, -471.65, 'la somme des deux fragments')
})

test('un solde unique n’est PAS un cas', () => {
  const { cas } = R.planifierReunion(
    [solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8)],
    CATALOGUE
  )
  assert.deepStrictEqual(cas, [])
})

test('le même article à DEUX lieux n’est pas un cas : ce sont deux inventaires', () => {
  const { cas } = R.planifierReunion(
    [
      solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8, 'l', 'Station F5'),
      solde('station_Station_F1_Acide_Phosphorique', 'Acide Phosphorique', -13.8, 'l', 'Station F1'),
    ],
    CATALOGUE
  )
  assert.deepStrictEqual(cas, [])
})

test('un solde rangé sous le docId d’une fiche FUSIONNÉE rejoint son maître', () => {
  const { cas } = R.planifierReunion(
    [
      solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8),
      solde('vieux_doc', 'QWNpZGUgUGhvc3Bob3JpcXVlfEVuZ3JhaXM', -10),
    ],
    CATALOGUE
  )
  assert.strictEqual(cas.length, 1)
  assert.strictEqual(cas[0].article_id, 'Ref-Eng0052')
  assert.strictEqual(cas[0].total, -69.8)
})

test('un solde inconnu du catalogue est laissé INTACT, jamais deviné', () => {
  const { cas, non_resolus } = R.planifierReunion(
    [
      solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8),
      solde('station_Station_F5_Fantome', 'Article Jamais Vu', -3),
    ],
    CATALOGUE
  )
  assert.deepStrictEqual(cas, [])
  assert.deepStrictEqual(non_resolus.map((s) => s.docId), ['station_Station_F5_Fantome'])
})

// ── conservation ───────────────────────────────────────────────────────────

test('on conserve le document que la FUSION CORRIGÉE viserait', () => {
  const { cas } = R.planifierReunion(
    [
      solde('station_Station_F5_Acide_Phosphorique', 'Acide Phosphorique', -411.85),
      solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8),
    ],
    CATALOGUE
  )
  assert.strictEqual(cas[0].conserve, 'station_Station_F5_Ref-Eng0052')
  assert.deepStrictEqual(cas[0].supprimes, ['station_Station_F5_Acide_Phosphorique'])
})

test('le choix ne dépend pas de l’ordre de lecture des documents', () => {
  const docs = [
    solde('station_Station_F5_Acide_Phosphorique', 'Acide Phosphorique', -411.85),
    solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8),
  ]
  const a = R.planifierReunion(docs, CATALOGUE).cas[0]
  const b = R.planifierReunion(docs.slice().reverse(), CATALOGUE).cas[0]
  assert.strictEqual(a.conserve, b.conserve)
  assert.deepStrictEqual(a.supprimes, b.supprimes)
})

test('l’incrément à appliquer est la somme des ABSORBÉS, pas le total', () => {
  const { cas } = R.planifierReunion(
    [
      solde('station_Station_F5_Acide_Phosphorique', 'Acide Phosphorique', -411.85),
      solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -59.8),
    ],
    CATALOGUE
  )
  // le conservé porte déjà -59,80 : on ne lui ajoute que -411,85
  assert.strictEqual(R.incrementConserve(cas[0]), -411.85)
  assert.strictEqual(
    Math.round((cas[0].docs.find((d) => d.docId === cas[0].conserve).balance + R.incrementConserve(cas[0])) * 100) / 100,
    cas[0].total,
    'balance conservée + incrément = total réuni'
  )
})

// ── fail-closed ────────────────────────────────────────────────────────────

test('des fragments d’UNITÉS différentes ne sont jamais sommés en silence', () => {
  const { cas } = R.planifierReunion(
    [
      solde('station_Station_F5_Rhizo_Humus', 'Rhizo Humus', -48, 'kg'),
      solde('station_Station_F5_Ref-Eng0046', 'Ref-Eng0046', -25.3, 'l'),
    ],
    [{ id: 'Ref-Eng0046', nom: 'Rhizo Humus', active: true }]
  )
  assert.strictEqual(cas.length, 1, 'le cas doit être VU')
  assert.strictEqual(cas[0].anomalies.length, 1, 'et signalé')
  assert.match(cas[0].anomalies[0], /unités divergentes/)
  assert.deepStrictEqual(R.casExecutables(cas), [], 'et jamais exécuté')
})

test('« l » et « L » sont la même unité — pas une anomalie', () => {
  const { cas } = R.planifierReunion(
    [
      solde('magasin_F1_Acide_Nitrique', 'Acide Nitrique', -7.25, 'l'),
      solde('magasin_F1_Ref-Eng0051', 'Ref-Eng0051', -13.65, 'L'),
    ],
    CATALOGUE
  )
  assert.deepStrictEqual(cas[0].anomalies, [])
  assert.strictEqual(R.casExecutables(cas).length, 1)
})

test('une unité absente ne bloque pas la réunion', () => {
  const { cas } = R.planifierReunion(
    [
      solde('a_doc', 'Acide Phosphorique', -1, ''),
      solde('station_Station_F5_Ref-Eng0052', 'Ref-Eng0052', -2, 'l'),
    ],
    CATALOGUE
  )
  assert.deepStrictEqual(cas[0].anomalies, [])
})
