'use strict'

/*
 * SOLDES DE LA FICHE MAÎTRE — règle pure (functions/lib/stockMerge/soldesMaster.js).
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - l'appartenance au maître ne cherche plus que par docId (le nom est ignoré) ;
 *  - la cible est prise au hasard / dans l'ordre d'arrivée quand le maître a
 *    plusieurs soldes au même lieu ;
 *  - `total` ne somme que la cible au lieu de tous les fragments ;
 *  - la formule d'identifiant canonique change.
 */

const test = require('node:test')
const assert = require('node:assert')

const SM = require('../soldesMaster')

// ── appartenance ───────────────────────────────────────────────────────────

test('un solde rangé sous le NOM du maître est reconnu comme sien', () => {
  const cles = SM.clesMaster('Ref-Eng0052', 'Acide Phosphorique')
  assert.strictEqual(SM.estSoldeDuMaster('Acide Phosphorique', cles), true)
  assert.strictEqual(SM.estSoldeDuMaster('Ref-Eng0052', cles), true)
})

test('l’appartenance passe la même normalisation que la détection de doublons', () => {
  const cles = SM.clesMaster('Ref-Eng0072', 'Nitrate  de Potasse')
  // double espace, accents et casse : les trois formes du même solde en base
  assert.strictEqual(SM.estSoldeDuMaster('NITRATE DE POTASSE', cles), true)
  assert.strictEqual(SM.estSoldeDuMaster('nitrate  de potasse', cles), true)
  assert.strictEqual(SM.estSoldeDuMaster('Nitrate de Potassé', cles), true)
})

test('un solde étranger n’appartient pas au maître', () => {
  const cles = SM.clesMaster('Ref-Eng0052', 'Acide Phosphorique')
  assert.strictEqual(SM.estSoldeDuMaster('Acide Nitrique', cles), false)
  assert.strictEqual(SM.estSoldeDuMaster('', cles), false)
  assert.strictEqual(SM.estSoldeDuMaster(null, cles), false)
})

test('un maître sans nom ne revendique pas tous les soldes vides', () => {
  const cles = SM.clesMaster('Ref-Eng0052', '')
  assert.strictEqual(cles.has(''), false)
  assert.strictEqual(SM.estSoldeDuMaster('', cles), false)
  assert.strictEqual(SM.estSoldeDuMaster(null, cles), false)
})

// ── identifiant canonique (formule historique, inchangée) ──────────────────

test('l’identifiant canonique reste la formule historique', () => {
  assert.strictEqual(
    SM.identifiantSoldeCanonique('station', 'Station F5', 'Ref-Eng0052'),
    'station_Station_F5_Ref-Eng0052'
  )
  assert.strictEqual(
    SM.identifiantSoldeCanonique('magasin', 'F1', 'Acide Nitrique'),
    'magasin_F1_Acide_Nitrique'
  )
})

// ── choix de la cible ──────────────────────────────────────────────────────

test('le solde unique du maître est la cible, même rangé sous son nom', () => {
  const docs = [
    { docId: 'station_Station_F5_Acide_Phosphorique', article_ref: 'Acide Phosphorique', balance: -411.85 },
  ]
  const cible = SM.choisirSoldeCible(docs, 'Ref-Eng0052', 'station', 'Station F5')
  assert.strictEqual(cible.docId, 'station_Station_F5_Acide_Phosphorique')
})

test('maître DÉJÀ fragmenté : la cible est le solde au docId de la fiche', () => {
  // Cas de production : 29 articles portent deux soldes au même lieu, l'un sous
  // le nom, l'autre sous le docId.
  const docs = [
    { docId: 'station_Station_F5_Acide_Phosphorique', article_ref: 'Acide Phosphorique', balance: -411.85 },
    { docId: 'station_Station_F5_Ref-Eng0052', article_ref: 'Ref-Eng0052', balance: -59.8 },
  ]
  const cible = SM.choisirSoldeCible(docs, 'Ref-Eng0052', 'station', 'Station F5')
  assert.strictEqual(cible.docId, 'station_Station_F5_Ref-Eng0052')
})

test('le choix ne dépend PAS de l’ordre d’arrivée des documents', () => {
  const a = { docId: 'x_zzz', article_ref: 'Acide Phosphorique', balance: 1 }
  const b = { docId: 'station_Station_F5_Ref-Eng0052', article_ref: 'Ref-Eng0052', balance: 2 }
  const un = SM.choisirSoldeCible([a, b], 'Ref-Eng0052', 'station', 'Station F5')
  const deux = SM.choisirSoldeCible([b, a], 'Ref-Eng0052', 'station', 'Station F5')
  assert.strictEqual(un.docId, deux.docId)
  assert.strictEqual(un.docId, 'station_Station_F5_Ref-Eng0052')
})

test('le solde AU DOCID du maître prime sur celui qui porte l’identifiant canonique', () => {
  // Les deux règles divergent quand un solde ancien porte le docId de la fiche
  // sous un identifiant de document non canonique : c'est LUI la cible, sinon
  // la fusion irait grossir un second document.
  const docs = [
    { docId: 'ancien_doc_2024', article_ref: 'Ref-Eng0052', balance: -59.8 },
    { docId: 'station_Station_F5_Ref-Eng0052', article_ref: 'Acide Phosphorique', balance: -411.85 },
  ]
  const cible = SM.choisirSoldeCible(docs, 'Ref-Eng0052', 'station', 'Station F5')
  assert.strictEqual(cible.docId, 'ancien_doc_2024')
})

test('sans solde au docId, la cible est celle qui porte l’identifiant canonique', () => {
  const docs = [
    { docId: 'legacy_doc', article_ref: 'Acide Phosphorique', balance: -1 },
    { docId: 'station_Station_F5_Ref-Eng0052', article_ref: 'Acide Phosphorique', balance: -2 },
  ]
  const cible = SM.choisirSoldeCible(docs, 'Ref-Eng0052', 'station', 'Station F5')
  assert.strictEqual(cible.docId, 'station_Station_F5_Ref-Eng0052')
})

test('deux soldes également légitimes : le plus petit docId, de façon stable', () => {
  const docs = [
    { docId: 'b_doc', article_ref: 'Acide Phosphorique', balance: -1 },
    { docId: 'a_doc', article_ref: 'Acide Phosphorique', balance: -2 },
  ]
  const cible = SM.choisirSoldeCible(docs, 'Ref-Eng0052', 'station', 'Station F5')
  assert.strictEqual(cible.docId, 'a_doc')
  assert.strictEqual(
    SM.choisirSoldeCible(docs.slice().reverse(), 'Ref-Eng0052', 'station', 'Station F5').docId,
    'a_doc'
  )
})

test('aucun solde : aucune cible (l’appelant devra créer le document)', () => {
  assert.strictEqual(SM.choisirSoldeCible([], 'Ref-Eng0052', 'station', 'Station F5'), null)
})

// ── index par lieu ─────────────────────────────────────────────────────────

test('le solde courant est la SOMME de tous les fragments du lieu', () => {
  const idx = SM.indexerSoldesMaster(
    [
      { docId: 'station_Station_F5_Acide_Phosphorique', lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Acide Phosphorique', balance: -411.85 },
      { docId: 'station_Station_F5_Ref-Eng0052', lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Ref-Eng0052', balance: -59.8 },
    ],
    'Ref-Eng0052',
    'Acide Phosphorique'
  )
  const e = idx['station|Station F5']
  assert.strictEqual(e.total, -471.65, 'un solde partiel ferait mentir l’aperçu')
  assert.strictEqual(e.fragments, 2, 'la fragmentation antérieure doit être visible')
  assert.strictEqual(e.cible.docId, 'station_Station_F5_Ref-Eng0052')
})

test('les lieux sont indexés séparément', () => {
  const idx = SM.indexerSoldesMaster(
    [
      { docId: 'd1', lieu_type: 'station', lieu_id: 'Station F1', article_ref: 'Acide Phosphorique', balance: -10 },
      { docId: 'd2', lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Acide Phosphorique', balance: -20 },
      { docId: 'd3', lieu_type: 'magasin', lieu_id: 'F1', article_ref: 'Ref-Eng0052', balance: 5 },
    ],
    'Ref-Eng0052',
    'Acide Phosphorique'
  )
  assert.deepStrictEqual(Object.keys(idx).sort(), ['magasin|F1', 'station|Station F1', 'station|Station F5'])
  assert.strictEqual(idx['station|Station F5'].total, -20)
  assert.strictEqual(idx['magasin|F1'].fragments, 1)
})

test('un solde sans balance vaut 0, pas NaN', () => {
  const idx = SM.indexerSoldesMaster(
    [{ docId: 'd1', lieu_type: 'station', lieu_id: 'Station F5', article_ref: 'Ref-Eng0052' }],
    'Ref-Eng0052',
    'Acide Phosphorique'
  )
  assert.strictEqual(idx['station|Station F5'].total, 0)
})

test('l’index ignore les entrées sans identifiant de document', () => {
  const idx = SM.indexerSoldesMaster(
    [null, { lieu_type: 'station', lieu_id: 'Station F5', balance: -5 }],
    'Ref-Eng0052',
    'Acide Phosphorique'
  )
  assert.deepStrictEqual(idx, {})
})
