'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  buildBcScanPrompt,
  parseAiJson,
  flattenBcScan,
  matchArticle,
  matchParcelle,
  extractSecteurs,
  normalizeLabel,
  extractCulture,
  extractVariete,
  resolveScanMedia,
  nextParcelleAliasCount,
  parcelleAliasDocId,
  aliasMatchParcelle,
  sanitizeVocabList,
  buildVocabulaireSection,
  selectVocabArticles,
  VOCAB_MAX_ENTRIES,
  SIMILARITY_THRESHOLD,
  INCLUSION_THRESHOLD,
} = require('../../functions/lib/stock/bcScan')

// ---------------------------------------------------------------------------
// Jeu de données — bon 0005673 (3 piles x 3 lignes)
// ---------------------------------------------------------------------------

const BON_0005673 = {
  numero_bon: 'F1 0005673',
  date: '2026-07-14',
  ferme: 'F1+F5',
  motif: 'Fertigation/Traitement',
  variete: 'Framboise',
  colonnes: [
    { pile: 1, entete: 'marvilla S-3' },
    { pile: 2, entete: 'maravilla S-5' },
    { pile: 3, entete: 'yasmin niyas S-9' },
  ],
  lignes: [
    { article: 'Acide Nitrique', unite: 'L', barre: false, quantites: { 1: 5.25, 2: 2 } },
    { article: 'Yeoutol', unite: 'L', barre: false, quantites: { 3: 3 } },
    { article: 'Oris', unite: 'L', barre: false, quantites: { 3: 4 } },
  ],
  remarques: '',
}

// Catalogue minimal (articles réellement présents au catalogue stock).
const CATALOGUE = [
  { nom: 'Acide Nitrique' },
  { nom: 'Ammonitrate' },
  { nom: 'Nitrate de Potassium' },
  { nom: 'Sulfate de Magnesie' },
  { nom: 'KSC MIX' },
  { nom: 'Decis' },
  { nom: 'Benevia' },
  { nom: 'Switch' },
]

// ---------------------------------------------------------------------------
// FIXTURES DE PROD (extraites en lecture seule, 2026-08) — verrouillent la
// DIVERGENCE entre les deux listes de parcelles. Ne pas « harmoniser ».
// ---------------------------------------------------------------------------

// Les 15 libellés de `sb_parcelle_referentiel` (côté serveur). Ils figurent TOUS
// dans la liste affichée, mais ce n'est qu'un sous-ensemble PARTIEL (15/43) et
// NON FILTRÉ PAR CAMPAGNE : il ne sert qu'à l'affichage du nom SB et aux Ha, il
// n'alimente PAS le <select>. Ne jamais rebrancher matchParcelle dessus.
const SB_PARCELLE_REFERENTIEL = [
  'AVOCAT F5',
  'BREEZE MYRTILLE S8-2',
  'CASCADE MYRTILLE S8-1',
  'F1- S5 MARAVILLA MD',
  'F1-S6.S7 MARAVILLA MOTTE',
  'F2 - HAAS',
  'F3 -HAAS',
  'F4 -HAAS',
  'F5 -BREEZE- S14',
  'F5 CORINA myrtille S8-3',
  'F5 YAZMIN MT',
  'F5- CASCADE -S13',
  'F5- MYA S9',
  'F6-HAAS',
  'S10 YAZMIN cut back F5',
].map((label) => ({ label }))

// LA liste réellement affichée au magasinier : les 43 labels de
// `sql_mirror_pointage_meta/br_parcelle_sup`, source de `parcelles-campagne-list`
// donc du <select>. C'est contre CELLE-CI que le rapprochement doit se faire.
const PARCELLES_SELECT = [
  'AVOCAT F5', 'Avocat AVOCAT F6 AVOCAT', 'B6-AGRUMES', 'B6-HAAS', 'B7-HAAS',
  'BREEZE MYRTILLE S8-2', 'CASCADE MYRTILLE S8-1', 'EL BAHIA',
  'F1- S5 MARAVILLA MD', 'F1-S6.S7 MARAVILLA MOTTE', 'F2 - BACON', 'F2 - HAAS', 'F2 - ZUTANO',
  'F3 -FUERTE', 'F3 -HAAS', 'F3 -ZUTANO', 'F4 -FUERTE', 'F4 -HAAS', 'F4 -ZUTANO',
  'F5 -BREEZE- S14', 'F5 CORINA myrtille S8-3', 'F5 YAZMIN MT', 'F5- CASCADE -S13', 'F5- MYA S9',
  'F6 -BACON', 'F6 -FUERTE', 'F6 -ZUTANO', 'F6-HAAS', 'Parcelle avocat FORTUNA SUPERMOTTE',
  'S1 - MARAVILLA MOW DOWN F1', 'S1.S4 Maravilla green can F1', 'S1/S4 Maravilla mow down F1',
  'S10 - YAZMIN MOTTE F5', 'S10 YAZMIN cut back F5', 'S13 - YAZMIN MOW DOWN F5',
  'S2 -YAZMIN MOW DOWN F1', 'S2.S3.S5.S6.S7 maravilla logn can F1', 'S3 - MARAVILLA MOTTE F1',
  'S4 -MARAVILLA MOW DOWN F1', 'S5 -YAZMIN MOW DOWN F1', 'S6- vide', 'S7 -MARAVILLA MOTTE F1',
  'S9 - REYNA F5',
].map((label) => ({ label }))

// Échantillon des parcelles observées sur les 22 bons de consommation dépouillés
// (sous-ensemble de PARCELLES_SELECT, hors « F5 CORINA myrtille » qui y figure
// sous « F5 CORINA myrtille S8-3 »).
const PARCELLES_REELLES = [
  'S3 - MARAVILLA MOTTE F1',
  'S5 -YAZMIN MOW DOWN F1',
  'F2 - HAAS',
  'F3 -HAAS',
  'F4 -HAAS',
  'S2 -YAZMIN MOW DOWN F1',
  'S9 - REYNA F5',
  'S2.S3.S5.S6.S7 maravilla logn can F1',
  'F5 CORINA myrtille',
].map((label) => ({ label }))

const REF_PARCELLES = [
  { label: 'F1- MARAVILLA -S3', nom_sb: 'Maravilla S3', culture: 'Framboise', ferme: 'F1' },
  { label: 'F1- MARAVILLA -S5', nom_sb: 'Maravilla S5', culture: 'Framboise', ferme: 'F1' },
  { label: 'F5- YASMIN -S9', nom_sb: 'Yasmin S9', culture: 'Framboise', ferme: 'F5' },
  { label: 'F5- MTL -S13', nom_sb: 'MTL S13', culture: 'Framboise', ferme: 'F5' },
  { label: 'F5- MTL -S14', nom_sb: 'MTL S14', culture: 'Framboise', ferme: 'F5' },
  { label: 'F5- CASCADE -S8-1', nom_sb: 'Cascade S8-1', culture: 'Myrtille', ferme: 'F5' },
]

// ---------------------------------------------------------------------------
// flattenBcScan
// ---------------------------------------------------------------------------

test('flattenBcScan — matrice 3 colonnes x 3 lignes -> 4 items', () => {
  const items = flattenBcScan(BON_0005673)
  assert.strictEqual(items.length, 4)
  assert.deepStrictEqual(items[0], {
    article_lu: 'Acide Nitrique',
    unite_lue: 'L',
    quantite: 5.25,
    pile: 1,
    parcelle_lue: 'marvilla S-3',
    barre: false,
  })
  assert.deepStrictEqual(items[1], {
    article_lu: 'Acide Nitrique',
    unite_lue: 'L',
    quantite: 2,
    pile: 2,
    parcelle_lue: 'maravilla S-5',
    barre: false,
  })
  assert.strictEqual(items[2].article_lu, 'Yeoutol')
  assert.strictEqual(items[2].parcelle_lue, 'yasmin niyas S-9')
  assert.strictEqual(items[3].article_lu, 'Oris')
  assert.strictEqual(items[3].quantite, 4)
})

// Les lignes rayées ne sont PLUS supprimées : elles sont émises avec `barre:
// true`, le front les grise. La détection de rature peut se tromper — ce n'est
// pas au parseur de trancher, et une ligne supprimée en silence est une
// consommation qui n'est jamais décomptée.
test('flattenBcScan — lignes barrées ÉMISES et drapeautées (bon 0005672)', () => {
  const items = flattenBcScan({
    colonnes: [
      { pile: 1, entete: 'marvilla S-3' },
      { pile: 2, entete: 'maravilla S-5' },
    ],
    lignes: [
      { article: 'Rombiquel Zn mn', unite: 'kg', barre: true, quantites: { 1: 2 } },
      { article: 'Rombiquel Zn mn', unite: 'kg', barre: false, quantites: { 2: 2 } },
      { article: 'Decis', unite: 'L', barre: true, quantites: { 1: 0.5 } },
      { article: 'Decis', unite: 'L', quantites: { 2: 0.5 } },
    ],
  })
  assert.strictEqual(items.length, 4)
  assert.deepStrictEqual(items.map((i) => i.barre), [true, false, true, false])
  // Aucune quantité lue ne disparaît.
  assert.strictEqual(items.reduce((s, i) => s + i.quantite, 0), 5)
})

// Cas réel du bon F1 0005671 : « MAP 7,2 kg » lue avec barre: true disparaissait
// sans aucune trace. C'était le dernier chemin de perte silencieuse du parseur.
test('flattenBcScan — cas réel MAP barré (bon 0005671) : émis, pas perdu', () => {
  const items = flattenBcScan({
    colonnes: [
      { pile: 1, entete: 'marvilla S-3' },
      { pile: 2, entete: 'maravilla S-5' },
    ],
    lignes: [{ article: 'MAP', unite: 'kg', barre: true, quantites: { 2: '7,2' } }],
  })
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].article_lu, 'MAP')
  assert.strictEqual(items[0].quantite, 7.2)
  assert.strictEqual(items[0].barre, true)
  assert.strictEqual(items[0].pile, 2)
})

// Cas réel du bon 0005672 : article illisible mais quantités bien présentes.
test('flattenBcScan — article non lu : item ÉMIS avec article_lu vide', () => {
  const items = flattenBcScan({
    colonnes: [{ pile: 1, entete: 'marvilla S-3' }],
    lignes: [
      { article: '', unite: 'kg', quantites: { 1: 3 } },
      { article: null, unite: 'L', quantites: { 1: 4 } },
      { unite: 'L', quantites: { 1: 5 } },
    ],
  })
  assert.strictEqual(items.length, 3)
  assert.deepStrictEqual(items.map((i) => i.article_lu), ['', '', ''])
  assert.deepStrictEqual(items.map((i) => i.quantite), [3, 4, 5])
  // ... et ils partent bien en `unmatched` au rapprochement article.
  assert.strictEqual(matchArticle(items[0].article_lu, CATALOGUE, {}).status, 'unmatched')
})

test('flattenBcScan — `barre` est toujours présent, false par défaut', () => {
  const items = flattenBcScan({
    colonnes: [{ pile: 1, entete: 'marvilla S-3' }],
    lignes: [
      { article: 'Oris', unite: 'L', quantites: { 1: 1 } },
      { article: 'Decis', unite: 'L', barre: false, quantites: { 1: 2 } },
      { article: 'MAP', unite: 'kg', barre: 'oui', quantites: { 1: 3 } },
    ],
  })
  assert.deepStrictEqual(items.map((i) => i.barre), [false, false, false])
  assert.ok(items.every((i) => typeof i.barre === 'boolean'))
})

// Une quantité inexploitable est le SEUL motif de filtrage restant.
test('flattenBcScan — quantité invalide = seul motif de filtrage (même barrée)', () => {
  const items = flattenBcScan({
    colonnes: [{ pile: 1, entete: 'marvilla S-3' }],
    lignes: [
      { article: 'MAP', unite: 'kg', barre: true, quantites: { 1: 0 } },
      { article: '', unite: 'kg', quantites: { 1: null } },
      { article: 'Oris', unite: 'L', barre: true, quantites: { 1: 2 } },
    ],
  })
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].article_lu, 'Oris')
  assert.strictEqual(items[0].barre, true)
})

test('flattenBcScan — quantités 0, null, vide et NaN ignorées', () => {
  const items = flattenBcScan({
    colonnes: [{ pile: 1, entete: 'marvilla S-3' }],
    lignes: [
      { article: 'MAP', unite: 'kg', quantites: { 1: 0 } },
      { article: 'Oris', unite: 'L', quantites: { 1: null } },
      { article: 'Switch', unite: 'kg', quantites: { 1: '' } },
      { article: 'Movento', unite: 'L', quantites: { 1: 'illisible' } },
      { article: 'Benevia', unite: 'L', quantites: { 1: 1 } },
    ],
  })
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].article_lu, 'Benevia')
})

test('flattenBcScan — virgule décimale française convertie', () => {
  const items = flattenBcScan({
    colonnes: [{ pile: 1, entete: 'marvilla S-3' }],
    lignes: [
      { article: 'S. Potassium', unite: 'kg', quantites: { 1: '1,875' } },
      { article: 'Acide Nitrique', unite: 'L', quantites: { 1: '5,25' } },
    ],
  })
  assert.strictEqual(items.length, 2)
  assert.strictEqual(items[0].quantite, 1.875)
  assert.strictEqual(items[1].quantite, 5.25)
})

// Une colonne dont l'en-tête n'est pas lu ne doit JAMAIS être supprimée : sinon
// la consommation de cette parcelle disparaît sans trace et le stock reste
// surévalué en silence. On émet l'item avec parcelle_lue vide -> unmatched, et
// le sélecteur obligatoire du front force l'utilisateur à trancher.
test('flattenBcScan — colonne sans en-tête : item ÉMIS avec parcelle_lue vide', () => {
  const items = flattenBcScan({
    colonnes: [
      { pile: 1, entete: 'marvilla S-3' },
      { pile: 2, entete: '   ' },
      { pile: 3 },
    ],
    lignes: [{ article: 'Oris', unite: 'L', quantites: { 1: 1, 2: 2, 3: 3 } }],
  })
  assert.strictEqual(items.length, 3)
  assert.strictEqual(items[0].parcelle_lue, 'marvilla S-3')
  assert.strictEqual(items[1].pile, 2)
  assert.strictEqual(items[1].parcelle_lue, '')
  assert.strictEqual(items[1].quantite, 2)
  assert.strictEqual(items[2].pile, 3)
  assert.strictEqual(items[2].parcelle_lue, '')
  assert.strictEqual(items[2].quantite, 3)
  // ... et ces items partent bien en unmatched au rapprochement.
  const pm = matchParcelle(items[1].parcelle_lue, REF_PARCELLES)
  assert.strictEqual(pm.status, 'unmatched')
  assert.strictEqual(pm.label, '')
})

test('flattenBcScan — en-tête illisible (null) : item ÉMIS, quantité conservée', () => {
  const items = flattenBcScan({
    colonnes: [
      { pile: 1, entete: null },
      { pile: 2, entete: 'maravilla S-5' },
    ],
    lignes: [
      { article: 'Acide Nitrique', unite: 'L', quantites: { 1: 5.25, 2: 2 } },
      { article: 'Ammonitrate', unite: 'kg', quantites: { 1: 10 } },
    ],
  })
  assert.strictEqual(items.length, 3)
  const total = items.reduce((s, i) => s + i.quantite, 0)
  assert.strictEqual(total, 17.25) // aucune quantité perdue
  assert.deepStrictEqual(
    items.filter((i) => i.parcelle_lue === '').map((i) => i.quantite),
    [5.25, 10]
  )
})

test('flattenBcScan — pile absente de colonnes[] : item ÉMIS, pas supprimé', () => {
  const items = flattenBcScan({
    colonnes: [{ pile: 1, entete: 'marvilla S-3' }],
    lignes: [{ article: 'Decis', unite: 'L', quantites: { 1: 1, 4: 2 } }],
  })
  assert.strictEqual(items.length, 2)
  assert.strictEqual(items[1].pile, 4)
  assert.strictEqual(items[1].parcelle_lue, '')
})

test('flattenBcScan — entrées invalides -> []', () => {
  assert.deepStrictEqual(flattenBcScan(null), [])
  assert.deepStrictEqual(flattenBcScan({}), [])
  assert.deepStrictEqual(flattenBcScan({ colonnes: [], lignes: [] }), [])
})

// ---------------------------------------------------------------------------
// matchArticle
// ---------------------------------------------------------------------------

test('matchArticle — alias mémorisé prioritaire', () => {
  const r = matchArticle('Yeoutol', CATALOGUE, { yeoutol: 'Ammonitrate' })
  assert.strictEqual(r.status, 'alias')
  assert.strictEqual(r.article, 'Ammonitrate')
  assert.strictEqual(r.score, 1)
})

test("matchArticle — l'alias prime sur une égalité exacte du catalogue", () => {
  const r = matchArticle('Decis', CATALOGUE, { decis: 'Benevia' })
  assert.strictEqual(r.status, 'alias')
  assert.strictEqual(r.article, 'Benevia')
})

test('matchArticle — exact après normalisation (casse ignorée)', () => {
  const r = matchArticle('KSC Mix', CATALOGUE, {})
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.article, 'KSC MIX')
  assert.strictEqual(r.score, 1)
})

test('matchArticle — "S. Magnesium" ne matche PAS "Sulfate de Magnesie" en exact', () => {
  const r = matchArticle('S. Magnesium', CATALOGUE, {})
  assert.notStrictEqual(r.status, 'exact')
})

test('matchArticle — libellé inconnu -> unmatched, article vide', () => {
  const r = matchArticle('Yeoutol', CATALOGUE, {})
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.article, '')
})

test('matchArticle — libellé vide / catalogue vide -> unmatched', () => {
  assert.strictEqual(matchArticle('', CATALOGUE, {}).status, 'unmatched')
  assert.strictEqual(matchArticle('Oris', [], {}).status, 'unmatched')
})

test('matchArticle — catalogue de strings accepté', () => {
  const r = matchArticle('acide  nitrique', ['Acide Nitrique', 'Decis'], {})
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.article, 'Acide Nitrique')
})

test('matchArticle — faute de frappe légère -> probable', () => {
  const r = matchArticle('Ammonitrat', CATALOGUE, {})
  assert.strictEqual(r.status, 'probable')
  assert.strictEqual(r.article, 'Ammonitrate')
  assert.ok(r.score >= 0.75)
})

// L'inclusion NE court-circuite PAS le seuil : un libellé court inclus dans un
// libellé long n'est pas une preuve. Pré-sélectionner le mauvais article (que le
// magasinier pressé validera) est bien pire qu'un `unmatched` explicite.
test('matchArticle — inclusion sous le seuil -> unmatched ("Nitrate" != Ammonitrate)', () => {
  const r = matchArticle('Nitrate', ['Ammonitrate', 'Decis', 'Switch'], {})
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.article, '')
  assert.ok(r.score < 0.75, `score attendu < 0.75, reçu ${r.score}`)
})

test('matchArticle — inclusion sous le seuil -> unmatched ("Nitrique" != Acide Nitrique)', () => {
  const r = matchArticle('Nitrique', ['Acide Nitrique', 'Decis'], {})
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.article, '')
  assert.ok(r.score < 0.75, `score attendu < 0.75, reçu ${r.score}`)
})

test('matchArticle — inclusion sous le seuil -> unmatched ("Sulfate" != Sulfate de Magnesium)', () => {
  const r = matchArticle('Sulfate', ['Sulfate de Magnesium', 'Decis'], {})
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.article, '')
  assert.ok(r.score < 0.75, `score attendu < 0.75, reçu ${r.score}`)
})

// Mesuré sur le catalogue de prod : « Ertiva » ⊂ « FERTIVAL » sortait à 6/8 =
// 0.75 PILE, donc pré-sélectionné alors que ce sont deux produits différents.
// Le score d'inclusion est un ratio de longueurs, pas une similarité : il lui
// faut une barre plus haute que la branche Dice (INCLUSION_THRESHOLD).
test('matchArticle — "Ertiva" ne pré-sélectionne pas "FERTIVAL" (0.75 pile)', () => {
  const r = matchArticle('Ertiva', ['FERTIVAL', 'Decis', 'Switch'], {})
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.article, '')
  assert.strictEqual(r.score, 0.75)
})

test('matchArticle — INCLUSION_THRESHOLD est plus exigeant que le seuil Dice', () => {
  assert.ok(INCLUSION_THRESHOLD > SIMILARITY_THRESHOLD)
})

test('matchArticle — inclusion AU-DESSUS du seuil -> toujours probable', () => {
  const r = matchArticle('Acide Nitriqu', ['Acide Nitrique', 'Decis'], {})
  assert.strictEqual(r.status, 'probable')
  assert.strictEqual(r.article, 'Acide Nitrique')
  assert.ok(r.score >= 0.75)
})

test('matchArticle — aliasCount remonté depuis la forme objet, null ailleurs', () => {
  const vu1 = matchArticle('Yeoutol', CATALOGUE, { yeoutol: { article_nom: 'Ammonitrate', count: 1 } })
  assert.strictEqual(vu1.status, 'alias')
  assert.strictEqual(vu1.article, 'Ammonitrate')
  assert.strictEqual(vu1.aliasCount, 1)

  const vu7 = matchArticle('Yeoutol', CATALOGUE, { yeoutol: { article_nom: 'Ammonitrate', count: 7 } })
  assert.strictEqual(vu7.aliasCount, 7)

  // Forme string (rétro-compatible) : pas de compteur disponible.
  assert.strictEqual(matchArticle('Yeoutol', CATALOGUE, { yeoutol: 'Ammonitrate' }).aliasCount, null)
  // Hors alias : toujours null.
  assert.strictEqual(matchArticle('KSC Mix', CATALOGUE, {}).aliasCount, null)
  assert.strictEqual(matchArticle('Inconnu XYZ', CATALOGUE, {}).aliasCount, null)
})

test('matchArticle — alias à article_nom vide ignoré (pas de match vide)', () => {
  const r = matchArticle('KSC Mix', CATALOGUE, { 'ksc mix': { article_nom: '', count: 3 } })
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.article, 'KSC MIX')
})

// ---------------------------------------------------------------------------
// extractSecteurs / matchParcelle
// ---------------------------------------------------------------------------

test('extractSecteurs — conventions S-3 / S 5 / S8-2 / S-13-14', () => {
  assert.deepStrictEqual(extractSecteurs('marvilla S-3'), ['s3'])
  assert.deepStrictEqual(extractSecteurs('maravilla S 5'), ['s5'])
  assert.deepStrictEqual(extractSecteurs('breeze S8-2'), ['s8-2'])
  assert.deepStrictEqual(extractSecteurs('M.T.L S-13-14'), ['s13', 's14'])
  assert.deepStrictEqual(extractSecteurs('sans secteur'), [])
})

test('matchParcelle — "marvilla S-3" -> parcelle du secteur 3', () => {
  const r = matchParcelle('marvilla S-3', REF_PARCELLES)
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.label, 'F1- MARAVILLA -S3')
  assert.deepStrictEqual(r.candidats, [])
})

test('matchParcelle — "yasmin niyas S-9" -> parcelle du secteur 9', () => {
  const r = matchParcelle('yasmin niyas S-9', REF_PARCELLES)
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.label, 'F5- YASMIN -S9')
})

test('matchParcelle — "M.T.L S-13-14" -> unmatched + 2 candidats', () => {
  const r = matchParcelle('M.T.L S-13-14', REF_PARCELLES)
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
  assert.deepStrictEqual(r.candidats, ['F5- MTL -S13', 'F5- MTL -S14'])
})

test('matchParcelle — en-tête vide -> unmatched', () => {
  const r = matchParcelle('', REF_PARCELLES)
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
  assert.deepStrictEqual(r.candidats, [])
})

test('matchParcelle — secteur inconnu du référentiel -> unmatched', () => {
  const r = matchParcelle('corina S-42', REF_PARCELLES)
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
})

test('matchParcelle — 2 parcelles sur le même secteur, variété discriminante -> probable', () => {
  const refs = [
    { label: 'F5- CORINA -S8', culture: 'Myrtille', ferme: 'F5' },
    { label: 'F5- BREEZE -S8', culture: 'Myrtille', ferme: 'F5' },
  ]
  const r = matchParcelle('breeze S-8', refs)
  assert.strictEqual(r.status, 'probable')
  assert.strictEqual(r.label, 'F5- BREEZE -S8')
})

test('matchParcelle — 2 parcelles sur le même secteur, aucune variété -> unmatched + candidats', () => {
  const refs = [
    { label: 'F5- CORINA -S8', culture: 'Myrtille', ferme: 'F5' },
    { label: 'F5- BREEZE -S8', culture: 'Myrtille', ferme: 'F5' },
  ]
  const r = matchParcelle('S-8', refs)
  assert.strictEqual(r.status, 'unmatched')
  assert.deepStrictEqual(r.candidats, ['F5- CORINA -S8', 'F5- BREEZE -S8'])
})

// --- Gardes anti-faux-positif (fixtures de prod) ----------------------------

// Un libellé couvrant 5 secteurs ne doit JAMAIS être proposé pour un en-tête qui
// n'en nomme qu'un : ça imputerait la consommation d'un secteur à un groupe de
// 5 parcelles. Mesuré : sortait en `probable` à 0.9, donc pré-sélectionné.
test('matchParcelle — label multi-secteurs jamais proposé pour un en-tête mono-secteur', () => {
  const r = matchParcelle('marvilla S-5', PARCELLES_REELLES)
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
  assert.ok(
    r.candidats.includes('S2.S3.S5.S6.S7 maravilla logn can F1'),
    'le libellé multi-secteurs doit rester listé en candidat'
  )
})

test('matchParcelle — le multi-secteurs reste un candidat même seul sur le secteur', () => {
  const refs = [{ label: 'S2.S3.S5.S6.S7 maravilla logn can F1' }]
  const r = matchParcelle('maravilla S-6', refs)
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
  assert.deepStrictEqual(r.candidats, ['S2.S3.S5.S6.S7 maravilla logn can F1'])
})

// « marvilla S-5 » vs « S5 -YAZMIN MOW DOWN F1 » : seule parcelle du secteur 5,
// mais variété contradictoire -> ne doit pas être pré-sélectionnée.
test('matchParcelle — variété contradictoire : pas de match même seul sur le secteur', () => {
  const r = matchParcelle('marvilla S-5', [{ label: 'S5 -YAZMIN MOW DOWN F1' }])
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
  assert.deepStrictEqual(r.candidats, ['S5 -YAZMIN MOW DOWN F1'])
})

test('matchParcelle — parcelle sans variété identifiable : pas de contradiction', () => {
  const r = matchParcelle('marvilla S-4', [{ label: 'S4 - PARCELLE F1' }])
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.label, 'S4 - PARCELLE F1')
})

// --- Divergence des deux listes, verrouillée ------------------------------

test('matchParcelle — sur la VRAIE liste, "marvilla S-3" tombe juste', () => {
  const r = matchParcelle('marvilla S-3', PARCELLES_REELLES)
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.label, 'S3 - MARAVILLA MOTTE F1')
})

test('matchParcelle — sur la VRAIE liste, "yasmin niyas S-9" ne force rien de faux', () => {
  const r = matchParcelle('yasmin niyas S-9', PARCELLES_REELLES)
  // S9 - REYNA F5 : variété contradictoire -> pas de pré-sélection.
  assert.notStrictEqual(r.label, 'F5- MYA S9')
  assert.strictEqual(r.status, 'unmatched')
})

// `sb_parcelle_referentiel` n'est PAS une liste concurrente : ses 15 labels sont
// tous dans la liste affichée. Le problème est qu'il n'en couvre que 15 sur 43 et
// qu'il n'est pas filtré par campagne. Ce test verrouille les DEUX faits, pour
// qu'on ne rebranche pas matchParcelle dessus « puisque c'est le même référentiel ».
test('matchParcelle — sb_parcelle_referentiel est un sous-ensemble PARTIEL du select', () => {
  const select = PARCELLES_SELECT.map((p) => p.label)
  const sb = SB_PARCELLE_REFERENTIEL.map((p) => p.label)
  const absents = sb.filter((l) => !select.includes(l))
  assert.deepStrictEqual(absents, [], 'les 15 labels SB doivent tous exister dans le select')
  assert.strictEqual(sb.length, 15)
  assert.strictEqual(select.length, 43)
  // ... donc 28 parcelles du select sont INATTEIGNABLES depuis le référentiel SB.
  assert.strictEqual(select.filter((l) => !sb.includes(l)).length, 28)
})

// Conséquence concrète et mesurable de ce sous-ensemble partiel : sur les en-têtes
// réels, rapprocher contre le référentiel SB ne donne pas la même réponse que
// contre la liste affichée — et c'est cette dernière qui fait foi.
test('matchParcelle — le référentiel SB rate les parcelles les plus utilisées', () => {
  // « S3 - MARAVILLA MOTTE F1 » (89 lignes en prod) n'est pas dans le référentiel SB.
  assert.strictEqual(matchParcelle('marvilla S-3', SB_PARCELLE_REFERENTIEL).status, 'unmatched')
  const surSelect = matchParcelle('marvilla S-3', PARCELLES_SELECT)
  assert.strictEqual(surSelect.status, 'exact')
  assert.strictEqual(surSelect.label, 'S3 - MARAVILLA MOTTE F1')
})

// --- Comportement contre la VRAIE liste affichée (43 labels) -----------------

test('matchParcelle — sur le select réel, "marvilla S-3" -> exact', () => {
  const r = matchParcelle('marvilla S-3', PARCELLES_SELECT)
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.label, 'S3 - MARAVILLA MOTTE F1')
  assert.strictEqual(r.score, 1)
})

// Couvre la branche `probable` / score 0.9 : 2 parcelles mono sur le secteur 5,
// la garde variété écarte YAZMIN et il reste exactement une MARAVILLA.
test('matchParcelle — sur le select réel, "marvilla S-5" -> probable 0.9', () => {
  const r = matchParcelle('marvilla S-5', PARCELLES_SELECT)
  assert.strictEqual(r.status, 'probable')
  assert.strictEqual(r.label, 'F1- S5 MARAVILLA MD')
  assert.strictEqual(r.score, 0.9)
  assert.deepStrictEqual(r.candidats, [])
})

// --- Signaux CULTURE et VARIÉTÉ-SANS-SECTEUR (miroir de bcScanMatch.js) ------

test('extractCulture — « M.T.L » = Myrtille, jamais de culture par défaut', () => {
  assert.strictEqual(extractCulture('M.T.L S-13'), 'Myrtille')
  assert.strictEqual(extractCulture('MTL S-8'), 'Myrtille')
  assert.strictEqual(extractCulture('myrtille S-13'), 'Myrtille')
  assert.strictEqual(extractCulture('framboise S-3'), 'Framboise')
  assert.strictEqual(extractCulture('avocatier F2'), 'Avocatier')
  // Une variété n'est PAS une culture : pas de valeur par défaut.
  assert.strictEqual(extractCulture('marvilla S-3'), '')
  assert.strictEqual(extractCulture(''), '')
})

// La passe 2 trouve les parcelles dont le libellé ne porte AUCUN secteur
// (« F5 YAZMIN MT » porte pourtant le secteur 9) — en `probable`, jamais `exact`.
test('matchParcelle — "yasmin niyas S-9" -> F5 YAZMIN MT (probable 0.9)', () => {
  const r = matchParcelle('yasmin niyas S-9', PARCELLES_SELECT)
  assert.strictEqual(r.label, 'F5 YAZMIN MT')
  assert.strictEqual(r.status, 'probable')
  assert.strictEqual(r.score, 0.9)
})

// La culture DÉPARTAGE deux parcelles du même secteur : S13 porte une myrtille
// (CASCADE) et une framboise (YAZMIN).
test('matchParcelle — "M.T.L S-13" -> F5- CASCADE -S13 (probable 0.9)', () => {
  const r = matchParcelle('M.T.L S-13', PARCELLES_SELECT)
  assert.strictEqual(r.label, 'F5- CASCADE -S13')
  assert.strictEqual(r.status, 'probable')
  assert.strictEqual(r.score, 0.9)
})

test('matchParcelle — "myrtille S-13" -> même verdict que "M.T.L S-13"', () => {
  assert.deepStrictEqual(
    matchParcelle('myrtille S-13', PARCELLES_SELECT),
    matchParcelle('M.T.L S-13', PARCELLES_SELECT)
  )
})

test('matchParcelle — "M.T.L S-13-14" -> unmatched, candidats réduits aux myrtille', () => {
  const r = matchParcelle('M.T.L S-13-14', PARCELLES_SELECT)
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
  // S13 - YAZMIN MOW DOWN F5 (framboise) est écarté de la liste de suggestions.
  // L'ordre suit celui de la liste affichée, pas celui des secteurs de l'en-tête.
  assert.deepStrictEqual(r.candidats, ['F5 -BREEZE- S14', 'F5- CASCADE -S13'])
  assert.ok(!r.candidats.includes('S13 - YAZMIN MOW DOWN F5'))
})

// Verrou du faux positif inverse : quand le secteur EST déjà couvert par un
// label portant la bonne variété, la passe 2 ne doit pas s'en mêler.
test('matchParcelle — "S10 YAZMIN cut back" ne tombe PAS sur F5 YAZMIN MT', () => {
  const r = matchParcelle('S10 YAZMIN cut back', PARCELLES_SELECT)
  assert.strictEqual(r.status, 'unmatched')
  assert.notStrictEqual(r.label, 'F5 YAZMIN MT')
  assert.ok(!r.candidats.includes('F5 YAZMIN MT'))
})

test('matchParcelle — la culture ne peut pas ÉLARGIR la recherche', () => {
  // « M.T.L S-8 » : aucun label ne porte le secteur « s8 » nu (S8-1/S8-2/S8-3
  // sont des secteurs composés distincts). La culture ne doit rien inventer.
  const r = matchParcelle('M.T.L S-8', PARCELLES_SELECT)
  assert.strictEqual(r.status, 'unmatched')
  assert.strictEqual(r.label, '')
})

// GARDE 3 — la contradiction de culture doit vetoer AVANT le raccourci « seule
// mono-parcelle sur son secteur -> exact ». Sans elle, « M.T.L S-3 » sortait
// « S3 - MARAVILLA MOTTE F1 » (Framboise) en exact score 1, donc pastille ✅
// « Reconnu » : un bon myrtille imputé à une parcelle framboise, sans signal.
test('matchParcelle — un en-tête Myrtille ne prend jamais une parcelle Framboise', () => {
  for (const entete of ['M.T.L S-3', 'M.T.L S-1', 'M.T.L S-4', 'M.T.L S-7', 'myrtille S-3']) {
    const r = matchParcelle(entete, PARCELLES_SELECT)
    assert.strictEqual(r.status, 'unmatched', `${entete} doit rester non résolu`)
    assert.strictEqual(r.label, '', `${entete} ne doit pré-sélectionner aucune parcelle`)
    assert.ok(r.candidats.length > 0, `${entete} doit garder la parcelle contredite en candidat`)
  }
})

test('matchParcelle — le défaut « Framboise » de resolveCulture ne vetoe rien', () => {
  // resolveCulture n'attribue jamais Myrtille/Avocatier par défaut, mais SI
  // Framboise : la garde 3 ne doit donc pas s'appliquer à un en-tête framboise.
  const r = matchParcelle('framboise S-3', PARCELLES_SELECT)
  assert.strictEqual(r.status, 'exact')
  assert.strictEqual(r.label, 'S3 - MARAVILLA MOTTE F1')
})

// La passe variété ne doit pas proposer un label sans secteur quand l'en-tête
// nomme un secteur qu'AUCUNE parcelle ne porte : le papier affirme un secteur
// qu'on ne sait pas rattacher, c'est une incohérence, pas une invitation à deviner.
test('matchParcelle — secteur inconnu : « F5 YAZMIN MT » suggéré, jamais proposé', () => {
  for (const entete of ['yazmin S-11', 'yazmin S-12', 'yazmin S-15', 'yasmin niyas S-20']) {
    const r = matchParcelle(entete, PARCELLES_SELECT)
    assert.strictEqual(r.status, 'unmatched', `${entete} doit rester non résolu`)
    assert.strictEqual(r.label, '', `${entete} ne doit pas proposer une parcelle d'un autre secteur`)
    assert.deepStrictEqual(r.candidats, ['F5 YAZMIN MT'], `${entete} doit la garder en candidat`)
  }
})

test('matchParcelle — les gains du round précédent sont préservés', () => {
  const s9 = matchParcelle('yasmin niyas S-9', PARCELLES_SELECT)
  assert.strictEqual(s9.label, 'F5 YAZMIN MT')
  assert.strictEqual(s9.status, 'probable')
  assert.strictEqual(s9.score, 0.9)

  const s13 = matchParcelle('M.T.L S-13', PARCELLES_SELECT)
  assert.strictEqual(s13.label, 'F5- CASCADE -S13')
  assert.strictEqual(s13.status, 'probable')
  assert.strictEqual(s13.score, 0.9)

  const s3 = matchParcelle('marvilla S-3', PARCELLES_SELECT)
  assert.strictEqual(s3.status, 'exact')
  assert.strictEqual(s3.label, 'S3 - MARAVILLA MOTTE F1')

  const s5 = matchParcelle('marvilla S-5', PARCELLES_SELECT)
  assert.strictEqual(s5.status, 'probable')
  assert.strictEqual(s5.score, 0.9)
  assert.strictEqual(s5.label, 'F1- S5 MARAVILLA MD')
})

// Variété « Mya » / « Miya » : le magasinier écrit « Miya S-9 » le 09/07 et
// « yassmin niyas S-9 » les 08 et 14/07. Les deux libellés du secteur 9
// (« F5- MYA S9 » et « F5 YAZMIN MT ») sont distincts et doivent coexister.
test('matchParcelle — "Miya S-9" -> F5- MYA S9', () => {
  for (const entete of ['Miya S-9', 'miya S-9', 'mya S-9']) {
    const r = matchParcelle(entete, PARCELLES_SELECT)
    assert.strictEqual(r.label, 'F5- MYA S9', entete)
    // `probable` et non `exact` : S9 porte DEUX parcelles mono (F5- MYA S9 et
    // S9 - REYNA F5), c'est la variété qui départage — même règle que
    // « marvilla S-5 ». `exact` est réservé à l'unique parcelle du secteur.
    assert.strictEqual(r.status, 'probable', entete)
    assert.strictEqual(r.score, 0.9, entete)
  }
})

test('matchParcelle — « mya » et « yasmin » coexistent sans se voler le secteur 9', () => {
  assert.strictEqual(extractVariete('F5- MYA S9'), 'mya')
  assert.strictEqual(extractVariete('F5 YAZMIN MT'), 'yasmin')
  // L'ajout de « mya » ne doit RIEN changer aux verdicts yasmin déjà verrouillés.
  for (const entete of ['yasmin niyas S-9', 'yassmin niyas S-9']) {
    const r = matchParcelle(entete, PARCELLES_SELECT)
    assert.strictEqual(r.label, 'F5 YAZMIN MT', entete)
    assert.strictEqual(r.status, 'probable', entete)
    assert.strictEqual(r.score, 0.9, entete)
  }
})

test('matchParcelle — un en-tête sans secteur peut toujours proposer par variété', () => {
  // Cas (a) de l'arbitrage : aucun secteur nommé -> la passe variété propose.
  const r = matchParcelle('yasmin niyas', PARCELLES_SELECT)
  assert.strictEqual(r.label, 'F5 YAZMIN MT')
  assert.strictEqual(r.status, 'probable')
  assert.strictEqual(r.score, 0.9)
})

test('matchParcelle — la culture DÉPARTAGE mais n\'oppose jamais de veto total', () => {
  // Deux parcelles sur S30, aucune myrtille : la culture ne doit pas vider la
  // liste de candidats (sinon l'utilisateur perd les suggestions).
  const refs = [{ label: 'S30 - MARAVILLA F1' }, { label: 'S30 - REYNA F1' }]
  const r = matchParcelle('M.T.L S-30', refs)
  assert.strictEqual(r.status, 'unmatched')
  assert.deepStrictEqual(r.candidats, ['S30 - MARAVILLA F1', 'S30 - REYNA F1'])
})

// --- Angles morts signalés par la QA ----------------------------------------

// La variété doit être lue depuis le NOM AFFICHÉ, pas seulement depuis le label.
// Le front passe ce nom sous la clé `nom`, le référentiel serveur sous `nom_sb` :
// les deux clés doivent produire le même verdict, sinon divergence silencieuse.
test('matchParcelle — variété lue depuis `nom` ET depuis `nom_sb` (parité front/back)', () => {
  const viaNom = matchParcelle('marvilla S-5', [
    { label: 'S5 - A', nom: 'MARAVILLA' },
    { label: 'S5 - B', nom: 'YAZMIN' },
  ])
  const viaNomSb = matchParcelle('marvilla S-5', [
    { label: 'S5 - A', nom_sb: 'MARAVILLA' },
    { label: 'S5 - B', nom_sb: 'YAZMIN' },
  ])
  assert.deepStrictEqual(viaNom, viaNomSb)
  assert.strictEqual(viaNom.label, 'S5 - A')
  assert.strictEqual(viaNom.status, 'probable')
  assert.strictEqual(viaNom.score, 0.9)
})

test('matchParcelle — la garde variété fonctionne aussi via le nom affiché seul', () => {
  const r = matchParcelle('marvilla S-5', [{ label: 'S5 - A', nom: 'YAZMIN' }])
  assert.strictEqual(r.status, 'unmatched')
  assert.deepStrictEqual(r.candidats, ['S5 - A'])
})

// Une même parcelle peut apparaître deux fois dans la liste affichée : les
// candidats ne doivent pas la lister en double (aligné sur le front).
test('matchParcelle — candidats dédoublonnés', () => {
  const doublons = [
    { label: 'S8 - CORINA' }, { label: 'S8 - BREEZE' }, { label: 'S8 - CORINA' },
  ]
  const r = matchParcelle('S-8', doublons)
  assert.strictEqual(r.status, 'unmatched')
  assert.deepStrictEqual(r.candidats, ['S8 - CORINA', 'S8 - BREEZE'])
})

test('matchParcelle — candidats dédoublonnés aussi sur un en-tête multi-secteurs', () => {
  const doublons = [
    { label: 'S13.S14 groupe' }, { label: 'S13.S14 groupe' },
  ]
  const r = matchParcelle('M.T.L S-13-14', doublons)
  assert.strictEqual(r.status, 'unmatched')
  assert.deepStrictEqual(r.candidats, ['S13.S14 groupe'])
})

// ---------------------------------------------------------------------------
// parseAiJson / buildBcScanPrompt / normalizeLabel
// ---------------------------------------------------------------------------

test('parseAiJson — préambule bavard, JSON extrait', () => {
  const txt = 'Bien sûr ! Voici le résultat :\n```json\n{"numero_bon":"F1 0005673","lignes":[]}\n```\nJ\'espère que ça aide.'
  const parsed = parseAiJson(txt)
  assert.ok(parsed)
  assert.strictEqual(parsed.numero_bon, 'F1 0005673')
})

test('parseAiJson — texte non JSON -> null', () => {
  assert.strictEqual(parseAiJson('Je ne peux pas lire ce document.'), null)
  assert.strictEqual(parseAiJson(''), null)
  assert.strictEqual(parseAiJson(null), null)
  assert.strictEqual(parseAiJson('{ ceci n\'est pas du json }'), null)
})

test('buildBcScanPrompt — injecte today, aucune année en dur', () => {
  const prompt = buildBcScanPrompt({ today: '2026-07-14' })
  assert.ok(prompt.includes('2026-07-14'))
  assert.ok(prompt.includes('colonnes'))
  assert.ok(prompt.includes('barre'))
  assert.ok(prompt.includes('REMARQUES'))
  // Aucune année codée en dur ailleurs que dans `today`.
  const sansToday = prompt.split('2026-07-14').join('')
  assert.strictEqual(/\b(19|20)\d{2}\b/.test(sansToday), false)
})

// ---------------------------------------------------------------------------
// Vocabulaire injecté dans le prompt (lot B)
// ---------------------------------------------------------------------------

// Extrait du catalogue RÉEL (casse et catégories telles qu'en base, doublons
// compris) — c'est cette saleté-là qui casse un filtre écrit par égalité.
const CATALOGUE_REEL = [
  { nom: 'Nitrate de Calcium', categorie: 'Engrais' },
  { nom: 'Nitrate de Calcium', categorie: 'engrais' },
  { nom: 'Nitrate de calcium Ultrasol', categorie: 'Engrais' },
  { nom: 'Sulfate de Potasse Granulé', categorie: 'Engrais' },
  { nom: 'DECIS EXPERT', categorie: 'Pesticides' },
  { nom: 'DECIS EXPERT', categorie: 'pesticides' },
  { nom: 'DECIS FLUXX', categorie: 'PHYTO-SANITAIRE' },
  { nom: 'HUILE MINERALE', categorie: 'PRODUIT BIO' },
  { nom: 'MEGAFOL', categorie: 'autre' },
  { nom: 'M.K.P' },
  { nom: 'TRACTEUR JOHN DEERE', categorie: 'IMMOBILISATION' },
  { nom: '', categorie: 'Engrais' },
]

test('sanitizeVocabList — dédoublonne (le catalogue réel a des doublons de casse)', () => {
  const out = sanitizeVocabList(['DECIS EXPERT', 'decis expert', ' DECIS  EXPERT ', 'DECIS FLUXX'])
  assert.deepStrictEqual(out, ['DECIS EXPERT', 'DECIS FLUXX'])
})

test('sanitizeVocabList — entrées non exploitables ignorées, jamais de crash', () => {
  assert.deepStrictEqual(sanitizeVocabList(null), [])
  assert.deepStrictEqual(sanitizeVocabList('pas un tableau'), [])
  assert.deepStrictEqual(sanitizeVocabList([null, 42, '', '   ', {}, 'Ammonitrate']), ['Ammonitrate'])
})

test('sanitizeVocabList — borné : un catalogue aberrant ne fait pas exploser le prompt', () => {
  const enorme = Array.from({ length: VOCAB_MAX_ENTRIES + 250 }, (_, i) => 'ARTICLE ' + i)
  assert.strictEqual(sanitizeVocabList(enorme).length, VOCAB_MAX_ENTRIES)
  assert.strictEqual(sanitizeVocabList(enorme, 5).length, 5)
})

test('selectVocabArticles — bon d\'engrais : pas de pesticide, catégories sales absorbées', () => {
  const noms = selectVocabArticles(CATALOGUE_REEL, 'engrais', [])
  assert.ok(noms.includes('Nitrate de Calcium'))
  assert.ok(noms.includes('Nitrate de calcium Ultrasol'))
  assert.ok(!noms.includes('DECIS EXPERT'))
  assert.ok(!noms.includes('TRACTEUR JOHN DEERE'))
  // Doublon de casse du catalogue réel : une seule entrée dans le prompt.
  assert.strictEqual(noms.filter(n => n === 'Nitrate de Calcium').length, 1)
})

test('selectVocabArticles — bon de pesticide : pesticides + phyto + bio, pas d\'engrais', () => {
  const noms = selectVocabArticles(CATALOGUE_REEL, 'pesticide', [])
  assert.ok(noms.includes('DECIS EXPERT'))
  assert.ok(noms.includes('DECIS FLUXX'))
  assert.ok(noms.includes('HUILE MINERALE'))
  assert.ok(!noms.includes('Nitrate de Calcium'))
})

test('selectVocabArticles — type VIDE (onglet « Tous ») : les deux familles, jamais une liste vide', () => {
  const noms = selectVocabArticles(CATALOGUE_REEL, '', [])
  assert.ok(noms.includes('Nitrate de Calcium'))
  assert.ok(noms.includes('DECIS EXPERT'))
  assert.ok(!noms.includes('TRACTEUR JOHN DEERE'))
  assert.deepStrictEqual(selectVocabArticles(CATALOGUE_REEL, undefined, []), noms)
})

test('selectVocabArticles — les articles consommés rattrapent les catégories « autre »/absentes', () => {
  // Mesuré sur les données réelles : 7 des 44 articles réellement consommés
  // (MEGAFOL, M.K.P, …) sont hors des catégories engrais/pesticide et seraient
  // perdus par le seul filtre de catégorie.
  const sans = selectVocabArticles(CATALOGUE_REEL, 'engrais', [])
  assert.ok(!sans.includes('MEGAFOL'))
  assert.ok(!sans.includes('M.K.P'))
  const avec = selectVocabArticles(CATALOGUE_REEL, 'engrais', ['MEGAFOL', 'M.K.P'])
  assert.ok(avec.includes('MEGAFOL'))
  assert.ok(avec.includes('M.K.P'))
  // …et ils passent en tête (les plus probables survivent si le plafond mord).
  assert.deepStrictEqual(avec.slice(0, 2), ['MEGAFOL', 'M.K.P'])
})

test('selectVocabArticles — un consommé absent du catalogue actif n\'est jamais suggéré', () => {
  // Article désactivé depuis : il n'est plus sélectionnable dans le bon, le
  // proposer au modèle ne produirait qu'une valeur rejetée ensuite.
  const noms = selectVocabArticles(CATALOGUE_REEL, 'engrais', ['ARTICLE RETIRE DU CATALOGUE'])
  assert.ok(!noms.includes('ARTICLE RETIRE DU CATALOGUE'))
})

test('buildBcScanPrompt — sans vocabulaire : prompt identique à l\'historique', () => {
  const base = buildBcScanPrompt({ today: '2026-07-14' })
  assert.strictEqual(buildBcScanPrompt({ today: '2026-07-14', articles: [], parcelles: [] }), base)
  assert.ok(!base.includes('VOCABULAIRE DE RÉFÉRENCE'))
})

test('buildBcScanPrompt — le vocabulaire est présent, article ET parcelle', () => {
  const prompt = buildBcScanPrompt({
    today: '2026-07-14',
    articles: ['Nitrate de calcium Ultrasol', 'DECIS FLUXX'],
    parcelles: ['F1- S5 MARAVILLA MD', 'F5- CASCADE -S13'],
  })
  assert.ok(prompt.includes('VOCABULAIRE DE RÉFÉRENCE'))
  assert.ok(prompt.includes('- Nitrate de calcium Ultrasol'))
  assert.ok(prompt.includes('- DECIS FLUXX'))
  assert.ok(prompt.includes('ARTICLES connus (2)'))
  assert.ok(prompt.includes('- F1- S5 MARAVILLA MD'))
  assert.ok(prompt.includes('PARCELLES connues (2)'))
  // Le JSON de sortie reste la DERNIÈRE consigne, jamais noyée par les listes.
  assert.ok(prompt.lastIndexOf('Réponds UNIQUEMENT') > prompt.lastIndexOf('- F5- CASCADE -S13'))
})

test('buildBcScanPrompt — la consigne ANTI-FORÇAGE figure avant les listes', () => {
  // Garde-fou n°1 du lot B : un faux positif fausse le stock en silence, un
  // texte brut fait juste cliquer le magasinier. Une consigne placée APRÈS 600
  // libellés ne pèse plus rien — d'où l'assertion de position.
  const prompt = buildBcScanPrompt({
    today: '2026-07-14',
    articles: ['Nitrate de Calcium', 'Nitrate de calcium Ultrasol'],
    parcelles: ['F1- S5 MARAVILLA MD'],
  })
  assert.ok(prompt.includes('rends le TEXTE BRUT'))
  assert.ok(prompt.includes('Ne choisis pas « la plus probable »'))
  assert.ok(prompt.includes('Dix textes bruts valent mieux qu\'un seul rapprochement faux'))
  assert.ok(prompt.indexOf('RÈGLE DE SUBSTITUTION') < prompt.indexOf('ARTICLES connus'))
  assert.ok(prompt.indexOf('RÈGLE DE SUBSTITUTION') < prompt.indexOf('PARCELLES connues'))
})

test('buildBcScanPrompt — consigne explicite sur le secteur inconnu (cas « marvilla S-3 »)', () => {
  // 29 lignes des bons de référence portent l'en-tête « marvilla S-3 » alors
  // qu'aucune parcelle de secteur 3 n'existe dans la campagne courante.
  const prompt = buildBcScanPrompt({
    today: '2026-07-14',
    parcelles: ['F1- S5 MARAVILLA MD', 'F1-S6.S7 MARAVILLA MOTTE'],
  })
  assert.ok(prompt.includes('secteur ABSENT de la'))
  assert.ok(prompt.includes('Ne le rabats jamais sur un autre secteur'))
})

test('buildVocabulaireSection — aucun vocabulaire exploitable -> section absente', () => {
  assert.deepStrictEqual(buildVocabulaireSection([], []), [])
  assert.deepStrictEqual(buildVocabulaireSection(null, undefined), [])
  assert.deepStrictEqual(buildVocabulaireSection(['  '], [null]), [])
})

test('buildVocabulaireSection — articles seuls : pas de section parcelles fantôme', () => {
  const lines = buildVocabulaireSection(['Ammonitrate'], [])
  const txt = lines.join('\n')
  assert.ok(txt.includes('ARTICLES connus (1)'))
  assert.ok(!txt.includes('PARCELLES connues'))
})

// ---------------------------------------------------------------------------
// resolveScanMedia — le préfixe data-url prime sur l'extension du filename
// ---------------------------------------------------------------------------

test('resolveScanMedia — bon.png ré-encodé en JPEG par le client -> image/jpeg', () => {
  // Cas RÉEL : src/modules/shared/lib/imageDownscale.js ré-encode toujours en JPEG. Se fier
  // à l'extension annoncerait image/png sur des octets JPEG -> 400 côté API.
  const r = resolveScanMedia('data:image/jpeg;base64,/9j/4AAQ', 'bon.png')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.mediaType, 'image/jpeg')
  assert.strictEqual(r.source, 'data-url')
})

test('resolveScanMedia — png réellement png -> image/png', () => {
  const r = resolveScanMedia('data:image/png;base64,iVBORw0KGgo', 'bon.png')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.mediaType, 'image/png')
})

test('resolveScanMedia — image/jpg normalisé en image/jpeg', () => {
  const r = resolveScanMedia('data:image/jpg;base64,/9j/4AAQ', 'bon.jpg')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.mediaType, 'image/jpeg')
})

test('resolveScanMedia — webp accepté', () => {
  assert.strictEqual(resolveScanMedia('data:image/webp;base64,UklGRg', 'x.webp').mediaType, 'image/webp')
})

test('resolveScanMedia — sans préfixe : repli sur l\'extension du filename', () => {
  const r = resolveScanMedia('/9j/4AAQSkZJRg', 'bon.jpg')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.mediaType, 'image/jpeg')
  assert.strictEqual(r.source, 'filename')
  assert.strictEqual(resolveScanMedia('iVBORw0KGgo', 'BON.PNG').mediaType, 'image/png')
  assert.strictEqual(resolveScanMedia('/9j/4AAQ', 'bon.jpeg').mediaType, 'image/jpeg')
})

test('resolveScanMedia — PDF refusé (data-url comme extension)', () => {
  const viaPrefix = resolveScanMedia('data:application/pdf;base64,JVBERi0', 'bon.jpg')
  assert.strictEqual(viaPrefix.ok, false)
  assert.match(viaPrefix.error, /PDF non support/)
  const viaExt = resolveScanMedia('JVBERi0', 'bon.pdf')
  assert.strictEqual(viaExt.ok, false)
  assert.match(viaExt.error, /PDF non support/)
})

test('resolveScanMedia — format non supporté refusé', () => {
  const gif = resolveScanMedia('data:image/gif;base64,R0lGOD', 'bon.gif')
  assert.strictEqual(gif.ok, false)
  assert.match(gif.error, /Format non support/)
  const heic = resolveScanMedia('AAAA', 'photo.heic')
  assert.strictEqual(heic.ok, false)
  assert.match(heic.error, /Format non support/)
  const rien = resolveScanMedia('AAAA', 'sansextension')
  assert.strictEqual(rien.ok, false)
  assert.match(rien.error, /Format non support/)
})

test('normalizeLabel — minuscules, sans accents, espaces réduits', () => {
  assert.strictEqual(normalizeLabel('  Sulfate  de   MAGNÉSIE '), 'sulfate de magnesie')
  assert.strictEqual(normalizeLabel(null), '')
})

// ---------------------------------------------------------------------------
// Alias de PARCELLE (lot A — mémorisation des en-têtes de pile)
// ---------------------------------------------------------------------------

const CAMPAGNE_AL = '2026-2027'
const REFS_AL = [{ label: 'F5- MYA S9' }, { label: 'S9 - REYNA F5' }, { label: 'CASCADE MYRTILLE S8-1' }]

// La campagne est dans la CLÉ, ce n'est pas cosmétique : c'est la parade au
// risque R1 (secteur 9 renouvelé entre 2025-2026 et 2026-2027).
test('parcelleAliasDocId — la campagne préfixe la clé', () => {
  assert.strictEqual(parcelleAliasDocId('2026-2027', 'M.T.L S-8'), '2026-2027__m.t.l%20s-8')
  // Deux campagnes = deux documents, jamais un seul.
  assert.notStrictEqual(parcelleAliasDocId('2026-2027', 'M.T.L S-8'), parcelleAliasDocId('2025-2026', 'M.T.L S-8'))
})

test('parcelleAliasDocId — clé stable quelles que soient casse et espaces', () => {
  const attendu = parcelleAliasDocId(CAMPAGNE_AL, 'M.T.L S-8')
  for (const e of ['m.t.l s-8', '  M.T.L   S-8 ', 'M.T.L S-8']) {
    assert.strictEqual(parcelleAliasDocId(CAMPAGNE_AL, e), attendu, e)
  }
})

// Un id Firestore ne peut pas contenir « / » : « S1/S4 Maravilla » est un
// libellé RÉEL de la liste de production.
test('parcelleAliasDocId — aucun « / » dans l\'id, et pas de collision', () => {
  const id = parcelleAliasDocId(CAMPAGNE_AL, 'S1/S4 Maravilla')
  assert.ok(!id.slice(CAMPAGNE_AL.length + 2).includes('/'), id)
  assert.notStrictEqual(id, parcelleAliasDocId(CAMPAGNE_AL, 'S1 S4 Maravilla'))
})

test('parcelleAliasDocId — campagne ou en-tête invalide → \'\' (rien à mémoriser)', () => {
  for (const c of ['', null, undefined, '2026', '2026/2027', 'courante', '26-27']) {
    assert.strictEqual(parcelleAliasDocId(c, 'M.T.L S-8'), '', String(c))
  }
  for (const e of ['', '   ', null, undefined]) {
    assert.strictEqual(parcelleAliasDocId(CAMPAGNE_AL, e), '', String(e))
  }
})

test('aliasMatchParcelle — alias appliqué, statut `alias` et compteur remonté', () => {
  const r = aliasMatchParcelle({ 'miya s-9': { parcelle: 'F5- MYA S9', count: 4, campagne: CAMPAGNE_AL } },
    'Miya S-9', CAMPAGNE_AL, REFS_AL)
  assert.deepStrictEqual(r, { label: 'F5- MYA S9', score: 1, status: 'alias', candidats: [], aliasCount: 4 })
})

test('aliasMatchParcelle — campagne étrangère, label hors liste, en-tête vide → null', () => {
  const a = { 'miya s-9': { parcelle: 'F5- MYA S9', count: 4, campagne: '2025-2026' } }
  assert.strictEqual(aliasMatchParcelle(a, 'Miya S-9', CAMPAGNE_AL, REFS_AL), null)
  const hors = { 'miya s-9': { parcelle: 'PARCELLE RETIREE', count: 4, campagne: CAMPAGNE_AL } }
  assert.strictEqual(aliasMatchParcelle(hors, 'Miya S-9', CAMPAGNE_AL, REFS_AL), null)
  const vide = { '': { parcelle: 'F5- MYA S9', count: 1, campagne: CAMPAGNE_AL } }
  assert.strictEqual(aliasMatchParcelle(vide, '', CAMPAGNE_AL, REFS_AL), null)
  assert.strictEqual(aliasMatchParcelle(null, 'Miya S-9', CAMPAGNE_AL, REFS_AL), null)
})

test('matchParcelle — l\'alias prime sur la cascade, sans jamais sortir de la liste', () => {
  const a = { 's-9': { parcelle: 'S9 - REYNA F5', count: 2, campagne: CAMPAGNE_AL } }
  // Sans alias, S9 est ambigu (2 parcelles) : on ne devine pas.
  assert.strictEqual(matchParcelle('S-9', REFS_AL).status, 'unmatched')
  const r = matchParcelle('S-9', REFS_AL, a, CAMPAGNE_AL)
  assert.strictEqual(r.label, 'S9 - REYNA F5')
  assert.strictEqual(r.status, 'alias')
  // Campagne suivante : l'alias tombe, l'ambiguïté revient (R1).
  assert.strictEqual(matchParcelle('S-9', REFS_AL, a, '2027-2028').status, 'unmatched')
})

test('nextParcelleAliasCount — même parcelle : le compteur monte', () => {
  assert.strictEqual(nextParcelleAliasCount(undefined, 'F5- MYA S9'), 1)
  assert.strictEqual(nextParcelleAliasCount({}, 'F5- MYA S9'), 1)
  assert.strictEqual(nextParcelleAliasCount({ parcelle: 'F5- MYA S9', count: 1 }, 'F5- MYA S9'), 2)
  assert.strictEqual(nextParcelleAliasCount({ parcelle: 'F5- MYA S9', count: 6 }, 'F5- MYA S9'), 7)
})

// La dernière décision humaine fait foi : un alias contredit ne garde pas la
// valeur de preuve de ses N confirmations précédentes.
test('nextParcelleAliasCount — parcelle DIFFÉRENTE : le compteur repart à 1', () => {
  assert.strictEqual(nextParcelleAliasCount({ parcelle: 'S9 - REYNA F5', count: 12 }, 'F5- MYA S9'), 1)
  assert.strictEqual(nextParcelleAliasCount({ parcelle: 'S9 - REYNA F5', count: 1 }, 'F5- MYA S9'), 1)
})

test('nextParcelleAliasCount — compteur illisible/absent traité comme 0', () => {
  assert.strictEqual(nextParcelleAliasCount({ parcelle: 'F5- MYA S9' }, 'F5- MYA S9'), 1)
  assert.strictEqual(nextParcelleAliasCount({ parcelle: 'F5- MYA S9', count: 'douze' }, 'F5- MYA S9'), 1)
  assert.strictEqual(nextParcelleAliasCount({ parcelle: 'F5- MYA S9', count: -3 }, 'F5- MYA S9'), 1)
})
