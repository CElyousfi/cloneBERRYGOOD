'use strict'

/**
 * Tests du resolver de mapping parcelles de consommation.
 * GATE QA : test de CONSERVATION bloquant, étendu à la répartition 1:N.
 *
 * RÉALIGNEMENT PARCELLE_TO_CPC : le resolver agrège par `cpc_code` et résout
 * les cibles via un `cpcResolver` injecté (DI). En test, on injecte une fixture
 * (pas la vraie table). On vérifie aussi que le seed branche bien sur des clés
 * PARCELLE_TO_CPC réelles et que Σpct === 100 sur chaque répartition.
 *
 * Lancé par `npm run test:unit` (via tests/unit/mappingConsoResolver.test.js)
 * et par `npm run test:mappingConso` (functions).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  campagneOf,
  aggregatePointages,
  splitMontant,
  makeCpcResolverFromCaneva,
  resolveCharges,
} = require('../resolver.js')
const { PARCELLE_TO_CPC } = require('../../stockCaneva/mappings.js')
const seed = require('../seed.js')

const CAMPAGNE = '2025-2026'

/** Fabrique un mouvement de consommation parcelle. */
function conso(libelle, montantTtc, date) {
  return {
    type: 'consommation',
    date: date || '2025-09-15', // dans la campagne 2025-2026 (Jul→Jun)
    lieu_destination: { type: 'parcelle', id: libelle },
    items: [{ article_ref: 'A1', quantite: 1, unite: 'u', montant_ttc: montantTtc }],
  }
}

// Fixture cpcResolver : cible système → CPC. Injectée (pas la vraie table).
const CPC_FIXTURE = {
  CIB_A: { cpc_code: 'CPC_A', variete: 'Maravilla', ferme: 'F1' },
  CIB_B: { cpc_code: 'CPC_B', variete: 'Corina', ferme: 'F5' },
  CIB_CASCADE: { cpc_code: 'CASCADE', variete: 'Cascade', ferme: 'F5' },
  CIB_BREEZE: { cpc_code: 'BREEZE', variete: 'Breeze', ferme: 'F5' },
}
const cpcResolver = (cible) => CPC_FIXTURE[cible] || null

// Mapping de campagne couvrant les statuts + cas repartition.
const mappingByParcelle = {
  P_matched: { statut: 'matched', cible_parcelle_culturale: 'CIB_A' },
  P_alias_valide: { statut: 'alias_valide', cible_parcelle_culturale: 'CIB_A' },
  P_creee: { statut: 'creee', cible_parcelle_culturale: 'CIB_B' },
  P_alias_propose: { statut: 'alias_propose', cible_parcelle_culturale: 'CIB_A' },
  P_a_creer: { statut: 'a_creer', cible_parcelle_culturale: null },
  P_hors_propose: { statut: 'hors_propose', cible_parcelle_culturale: null },
  P_hors_confirme: { statut: 'hors_confirme', cible_parcelle_culturale: null },
  // Cible COVERED mais inconnue du canevas → cpcResolver renvoie null.
  P_unknown_cpc: { statut: 'matched', cible_parcelle_culturale: 'CIB_INEXISTANTE' },
  // Répartition 50/50 (COVERED via alias_valide pour qu'elle atteigne le CPC).
  P_split5050: {
    statut: 'alias_valide',
    cible_parcelle_culturale: null,
    repartition: [
      { cible: 'CIB_CASCADE', pct: 50 },
      { cible: 'CIB_BREEZE', pct: 50 },
    ],
  },
  // Répartition non ronde 30/70 sur montant impair → test arrondi/zéro fuite.
  P_split3070: {
    statut: 'matched',
    cible_parcelle_culturale: null,
    repartition: [
      { cible: 'CIB_CASCADE', pct: 30 },
      { cible: 'CIB_BREEZE', pct: 70 },
    ],
  },
  // Répartition 33/33/34 sur montant non divisible → arrondi.
  P_split333334: {
    statut: 'creee',
    cible_parcelle_culturale: null,
    repartition: [
      { cible: 'CIB_A', pct: 33 },
      { cible: 'CIB_B', pct: 33 },
      { cible: 'CIB_CASCADE', pct: 34 },
    ],
  },
}

const mouvements = [
  conso('P_matched', 100.0),
  conso('P_matched', 50.5), // même CPC_A → agrégé
  conso('P_alias_valide', 25.25), // même CPC_A → agrégé
  conso('P_creee', 200.0),
  conso('P_alias_propose', 10.0), // non tranché
  conso('P_a_creer', 5.0), // non tranché
  conso('P_hors_propose', 7.0), // non tranché
  conso('P_hors_confirme', 33.0), // hors-périmètre
  conso('P_sans_mapping', 13.0), // mapping absent → non résolu
  conso('P_unknown_cpc', 17.0), // COVERED mais cible inconnue → non résolu
  conso('P_split5050', 80.0), // 40 Cascade + 40 Breeze
  conso('P_split3070', 33.33), // 9.999→10.0 + reste
  conso('P_split333334', 99.99), // arrondi 33/33/34
  conso('P_matched', 999.0, '2025-06-30'), // HORS campagne → ignoré
]

function run() {
  return resolveCharges({ mouvements, mappingByParcelle, campagne: CAMPAGNE, cpcResolver })
}

test('campagneOf : frontière Juillet→Juin (Jul N → Jun N+1)', () => {
  assert.equal(campagneOf('2025-07-01'), '2025-2026')
  assert.equal(campagneOf('2026-06-30'), '2025-2026')
  assert.equal(campagneOf('2025-06-30'), '2024-2025')
  assert.equal(campagneOf('2025-09-15'), '2025-2026')
  assert.equal(campagneOf('bad'), null)
  assert.equal(campagneOf(''), null)
})

test('aggregatePointages : counts corrects par libellé', () => {
  const counts = aggregatePointages(mouvements, CAMPAGNE)
  assert.equal(counts['P_matched'], 2) // le 3e (hors campagne) exclu
  assert.equal(counts['P_alias_valide'], 1)
  assert.equal(counts['P_hors_confirme'], 1)
  assert.equal(counts['P_sans_mapping'], 1)
})

test('splitMontant : Σ des parts === montant au centime (zéro fuite)', () => {
  const cases = [
    { m: 80.0, r: [{ cible: 'a', pct: 50 }, { cible: 'b', pct: 50 }] },
    { m: 33.33, r: [{ cible: 'a', pct: 30 }, { cible: 'b', pct: 70 }] },
    { m: 99.99, r: [{ cible: 'a', pct: 33 }, { cible: 'b', pct: 33 }, { cible: 'c', pct: 34 }] },
    { m: 0.01, r: [{ cible: 'a', pct: 33 }, { cible: 'b', pct: 67 }] },
    { m: 7.77, r: [{ cible: 'a', pct: 33 }, { cible: 'b', pct: 33 }, { cible: 'c', pct: 34 }] },
  ]
  for (const c of cases) {
    const parts = splitMontant(c.m, c.r)
    const sum = Math.round(parts.reduce((s, p) => s + p.montant, 0) * 100) / 100
    assert.equal(sum, c.m, `Σ parts == ${c.m}`)
    assert.equal(parts.length, c.r.length)
  }
})

test('CONSERVATION (gate) : totalCpc + horsPerimetre + nonResolu === totalSorties (repartition incluse)', () => {
  const r = run()
  const somme = Math.round((r.totalCpc + r.horsPerimetre + r.nonResolu) * 100) / 100
  assert.equal(somme, r.totalSorties)
  // totalSorties (hors mouvement hors-campagne) :
  // 100 + 50.5 + 25.25 + 200 + 10 + 5 + 7 + 33 + 13 + 17 + 80 + 33.33 + 99.99 = 674.07
  assert.equal(r.totalSorties, 674.07)
})

test('aucune charge non tranchée n\'atteint le CPC', () => {
  const r = run()
  // Non tranché : alias_propose(10) + a_creer(5) + hors_propose(7) + absent(13)
  //             + cible inconnue COVERED(17) = 52
  assert.equal(r.nonResolu, 52.0)
})

test('cpcResolver renvoyant null → charge en nonResolu, PAS dans cpc', () => {
  const r = resolveCharges({
    mouvements: [conso('P_unknown_cpc', 17.0)],
    mappingByParcelle,
    campagne: CAMPAGNE,
    cpcResolver,
  })
  assert.equal(r.nonResolu, 17.0)
  assert.equal(r.totalCpc, 0)
  assert.equal(r.cpc.length, 0)
})

test('hors_confirme : compté dans horsPerimetre, PAS dans cpc', () => {
  const r = run()
  assert.equal(r.horsPerimetre, 33.0)
})

test('CPC : agrégation par cpc_code', () => {
  const r = run()
  // CPC_A = matched(100 + 50.5) + alias_valide(25.25) + part split333334(33% de 99.99)
  const cpcA = r.cpc.find((e) => e.cpc_code === 'CPC_A')
  assert.ok(cpcA, 'bucket CPC_A présent')
  assert.equal(cpcA.variete, 'Maravilla')
  // CASCADE = split5050(40) + split3070(part) + split333334(reste)
  const cascade = r.cpc.find((e) => e.cpc_code === 'CASCADE')
  assert.ok(cascade, 'bucket CASCADE présent')
  const breeze = r.cpc.find((e) => e.cpc_code === 'BREEZE')
  assert.ok(breeze, 'bucket BREEZE présent')
})

test('répartition 50/50 : Σ des parts éclatées == charge d\'origine', () => {
  const r = resolveCharges({
    mouvements: [conso('P_split5050', 80.0)],
    mappingByParcelle,
    campagne: CAMPAGNE,
    cpcResolver,
  })
  const cascade = r.cpc.find((e) => e.cpc_code === 'CASCADE')
  const breeze = r.cpc.find((e) => e.cpc_code === 'BREEZE')
  assert.equal(cascade.montant, 40.0)
  assert.equal(breeze.montant, 40.0)
  assert.equal(r.totalCpc, 80.0)
  assert.equal(r.totalSorties, 80.0)
})

test('répartition non ronde 30/70 montant impair : conservation au centime', () => {
  const r = resolveCharges({
    mouvements: [conso('P_split3070', 33.33)],
    mappingByParcelle,
    campagne: CAMPAGNE,
    cpcResolver,
  })
  assert.equal(r.totalCpc, 33.33)
  assert.equal(r.totalSorties, 33.33)
  const sum = Math.round(r.cpc.reduce((s, e) => s + e.montant, 0) * 100) / 100
  assert.equal(sum, 33.33)
})

test('montant_ttc absent → fallback 0 (conservation préservée)', () => {
  const mov = {
    type: 'consommation',
    date: '2025-09-15',
    lieu_destination: { type: 'parcelle', id: 'P_matched' },
    items: [{ article_ref: 'A1', quantite: 1 }],
  }
  const r = resolveCharges({ mouvements: [mov], mappingByParcelle, campagne: CAMPAGNE, cpcResolver })
  assert.equal(r.totalSorties, 0)
  assert.equal(r.totalCpc, 0)
})

// ---- Tests SEED branché sur PARCELLE_TO_CPC ----

test('SEED : chaque cible non-null est une clé réelle de PARCELLE_TO_CPC', () => {
  for (const m of seed.mappingCampagne) {
    if (m.cible_parcelle_culturale != null) {
      assert.ok(
        m.cible_parcelle_culturale in PARCELLE_TO_CPC,
        `cible ${m.cible_parcelle_culturale} (${m.parcelle_conso_id}) inconnue de PARCELLE_TO_CPC`
      )
    }
  }
})

test('SEED : cible et repartition mutuellement exclusifs', () => {
  for (const m of seed.mappingCampagne) {
    const hasCible = m.cible_parcelle_culturale != null
    const hasRep = Array.isArray(m.repartition) && m.repartition.length > 0
    assert.ok(!(hasCible && hasRep), `${m.parcelle_conso_id} a cible ET repartition`)
  }
})

test('SEED : Σpct === 100 + chaque cible repartition est clé PARCELLE_TO_CPC', () => {
  for (const m of seed.mappingCampagne) {
    if (Array.isArray(m.repartition) && m.repartition.length) {
      let sum = 0
      for (const part of m.repartition) {
        assert.ok(
          part.cible in PARCELLE_TO_CPC,
          `repartition cible ${part.cible} (${m.parcelle_conso_id}) inconnue de PARCELLE_TO_CPC`
        )
        sum += part.pct
      }
      assert.equal(sum, 100, `Σpct ${m.parcelle_conso_id} === 100`)
    }
  }
})

test('makeCpcResolverFromCaneva : résout les cibles réelles du seed, null sinon', () => {
  const resolver = makeCpcResolverFromCaneva()
  assert.deepEqual(resolver('Avocat F2'), PARCELLE_TO_CPC['Avocat F2'])
  assert.equal(resolver('CIBLE_BIDON'), null)
  assert.equal(resolver(null), null)
})
