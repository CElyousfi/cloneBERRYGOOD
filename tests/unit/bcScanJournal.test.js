'use strict'

/**
 * Tests du journal de précision du scan des BC (Lot C, spec §4.4).
 *
 * Le point cardinal de ce lot : le journal enregistre CHAQUE ligne, pas
 * seulement les corrections. Les tests couvrent donc systématiquement le couple
 * confirmation / correction — un test qui ne regarde que le numérateur passerait
 * au vert sur un module qui ne mesure rien.
 */

const test = require('node:test')
const assert = require('node:assert')

const {
  STATUTS,
  MAX_LIGNES,
  PERIODES_MAX,
  normalizeJournalLigne,
  buildJournalDocs,
  computeScanPrecision,
  periodeDe,
  moisDe,
  periodesEntre,
  periodesCouvertes,
} = require('../../functions/lib/stock/bcScanJournal')

// ---------------------------------------------------------------------------
// Fabrique d'entrées — évite de répéter 12 champs à chaque cas.
// ---------------------------------------------------------------------------

/**
 * @param {Object} o
 * @returns {Object} une entrée `bc_scan_corrections`
 */
function entree(o) {
  return Object.assign({
    date: '2026-08-25',
    bon_numero: 'BC-1',
    campagne: '2026-2027',
    article_lu: 'N. calcium',
    article_propose: 'Nitrate de Calcium',
    article_choisi: 'Nitrate de Calcium',
    article_status_initial: 'probable',
    article_score: 0.8,
    article_alias_count: null,
    parcelle_lue: 'marvilla S-3',
    parcelle_proposee: 'F1 MARAVILLA S3',
    parcelle_choisie: 'F1 MARAVILLA S3',
    parcelle_status_initial: 'exact',
    parcelle_score: 1,
    parcelle_alias_count: null,
  }, o)
}

// ===========================================================================
// normalizeJournalLigne
// ===========================================================================

test('normalizeJournalLigne — ligne totalement vide -> null (rien à mesurer)', () => {
  assert.strictEqual(normalizeJournalLigne({}), null)
  assert.strictEqual(normalizeJournalLigne(null), null)
  assert.strictEqual(normalizeJournalLigne({ article_lu: '   ', parcelle_lue: '' }), null)
})

test('normalizeJournalLigne — une seule information suffit à journaliser', () => {
  const l = normalizeJournalLigne({ article_choisi: 'Nitrate de Calcium' })
  assert.ok(l)
  assert.strictEqual(l.article_choisi, 'Nitrate de Calcium')
  // Sans proposition, le statut initial est `unmatched` : c'est une saisie
  // manuelle intégrale, pas une proposition conservée.
  assert.strictEqual(l.article_status_initial, 'unmatched')
})

test('normalizeJournalLigne — score absent reste null, jamais 0', () => {
  const l = normalizeJournalLigne({ article_lu: 'x', article_score: undefined })
  assert.strictEqual(l.article_score, null)
  // ... mais un score RÉELLEMENT nul est conservé tel quel.
  const l0 = normalizeJournalLigne({ article_lu: 'x', article_score: 0 })
  assert.strictEqual(l0.article_score, 0)
})

test('normalizeJournalLigne — statut absent AVEC proposition -> `probable`, pas `unmatched`', () => {
  // Confondre les deux ferait disparaître tout le pré-remplissage dans le
  // fourre-tout `unmatched` : plus aucun taux par statut ne voudrait rien dire.
  const l = normalizeJournalLigne({ article_lu: 'x', article_propose: 'Nitrate de Calcium' })
  assert.strictEqual(l.article_status_initial, 'probable')
  const p = normalizeJournalLigne({ parcelle_lue: 'x', parcelle_proposee: 'F1 MARAVILLA S3' })
  assert.strictEqual(p.parcelle_status_initial, 'probable')
})

test('normalizeJournalLigne — score illisible -> null, jamais 0', () => {
  // 0 est un score LÉGITIME (« aucune similarité ») : le confondre avec
  // « non mesuré » fausserait toute moyenne par statut.
  assert.strictEqual(normalizeJournalLigne({ article_lu: 'x', article_score: 'abc' }).article_score, null)
  assert.strictEqual(normalizeJournalLigne({ article_lu: 'x', article_score: NaN }).article_score, null)
})

test('normalizeJournalLigne — compteur d\'alias 0 ou négatif -> null', () => {
  // « alias confirmé 0 fois » n'existe pas : c'est l'absence d'alias.
  assert.strictEqual(normalizeJournalLigne({ article_lu: 'x', article_alias_count: 0 }).article_alias_count, null)
  assert.strictEqual(normalizeJournalLigne({ article_lu: 'x', article_alias_count: -3 }).article_alias_count, null)
  assert.strictEqual(normalizeJournalLigne({ article_lu: 'x', article_alias_count: '4' }).article_alias_count, 4)
})

test('normalizeJournalLigne — statut inconnu conservé (le rapport doit pouvoir le signaler)', () => {
  const l = normalizeJournalLigne({ article_lu: 'x', article_propose: 'y', article_status_initial: 'MYSTERE' })
  assert.strictEqual(l.article_status_initial, 'mystere')
})

// ===========================================================================
// buildJournalDocs
// ===========================================================================

test('buildJournalDocs — dérive la campagne de la DATE (jamais du body)', () => {
  const r = buildJournalDocs({
    date: '2026-08-25',
    bon_numero: 'BC-42',
    lignes: [{ article_lu: 'N. calcium', article_choisi: 'Nitrate de Calcium' }],
    corrige_par: { uid: 'u1', profileId: 'magasinier', name: 'Ali' },
    now: 1000,
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.campagne, '2026-2027')
  assert.strictEqual(r.docs.length, 1)
  assert.strictEqual(r.docs[0].campagne, '2026-2027')
  assert.strictEqual(r.docs[0].bon_numero, 'BC-42')
  assert.strictEqual(r.docs[0].created_at, 1000)
  assert.deepStrictEqual(r.docs[0].corrige_par, { uid: 'u1', profileId: 'magasinier', name: 'Ali' })
})

test('buildJournalDocs — une campagne envoyée par le CLIENT est ignorée', () => {
  // La campagne est une donnée d'analyse : elle doit rester cohérente avec la
  // date du bon quoi qu'envoie le client. La reprendre du body permettrait de
  // ranger des lignes dans n'importe quelle campagne.
  const r = buildJournalDocs({
    date: '2026-08-25', campagne: '2099-2100', lignes: [{ article_lu: 'x' }],
  })
  assert.strictEqual(r.campagne, '2026-2027')
  assert.strictEqual(r.docs[0].campagne, '2026-2027')
})

test('buildJournalDocs — une date de juin appartient à la campagne précédente', () => {
  const r = buildJournalDocs({ date: '2026-06-30', lignes: [{ article_lu: 'x' }] })
  assert.strictEqual(r.campagne, '2025-2026')
})

test('buildJournalDocs — refus sur date invalide / aucune ligne / trop de lignes', () => {
  assert.strictEqual(buildJournalDocs({ date: '25/08/2026', lignes: [{ article_lu: 'x' }] }).ok, false)
  assert.strictEqual(buildJournalDocs({ date: '2026-08-25', lignes: [] }).ok, false)
  const trop = new Array(MAX_LIGNES + 1).fill({ article_lu: 'x' })
  assert.strictEqual(buildJournalDocs({ date: '2026-08-25', lignes: trop }).ok, false)
  // Exactement au plafond : accepté.
  const pile = new Array(MAX_LIGNES).fill({ article_lu: 'x' })
  assert.strictEqual(buildJournalDocs({ date: '2026-08-25', lignes: pile }).ok, true)
})

test('buildJournalDocs — les lignes vides sont comptées, pas silencieusement perdues', () => {
  const r = buildJournalDocs({
    date: '2026-08-25',
    lignes: [{ article_lu: 'x' }, {}, { }],
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.docs.length, 1)
  assert.strictEqual(r.ignorees, 2)
})

test('buildJournalDocs — que des lignes vides -> échec explicite', () => {
  const r = buildJournalDocs({ date: '2026-08-25', lignes: [{}, {}] })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /exploitable/)
})

test('buildJournalDocs — corrige_par absent -> objet vide, jamais undefined (Firestore refuse)', () => {
  const r = buildJournalDocs({ date: '2026-08-25', lignes: [{ article_lu: 'x' }] })
  assert.deepStrictEqual(r.docs[0].corrige_par, { uid: '', profileId: '', name: '' })
})

// ===========================================================================
// computeScanPrecision — cas nominal du ticket
// ===========================================================================

test('computeScanPrecision — aucune donnée : tout à null, jamais 0 %', () => {
  const r = computeScanPrecision([])
  assert.strictEqual(r.lignes, 0)
  assert.strictEqual(r.bons, 0)
  assert.strictEqual(r.faux_positifs.total, 0)
  // Le piège : « 0 correction sur 0 ligne » n'est pas « 0 % de correction ».
  assert.strictEqual(r.article.taux_prefill, null)
  assert.strictEqual(r.article.taux_correction, null)
  assert.strictEqual(r.parcelle.taux_prefill, null)
  assert.strictEqual(r.parcelle.taux_correction, null)
  assert.deepStrictEqual(r.periodes, [])
  assert.deepStrictEqual(r.article.palmares, [])
})

test('computeScanPrecision — entrées non-objets ignorées sans crash', () => {
  const r = computeScanPrecision([null, undefined, 'x', 42, entree({})])
  assert.strictEqual(r.lignes, 1)
})

test('computeScanPrecision — proposition CONSERVÉE = confirmation (le dénominateur)', () => {
  const r = computeScanPrecision([entree({})])
  assert.strictEqual(r.article.lignes, 1)
  assert.strictEqual(r.article.proposees, 1)
  assert.strictEqual(r.article.conservees, 1)
  assert.strictEqual(r.article.corrigees, 0)
  assert.strictEqual(r.article.taux_prefill, 1)
  assert.strictEqual(r.article.taux_correction, 0)
  assert.strictEqual(r.article.par_statut.probable.lignes, 1)
  assert.strictEqual(r.article.par_statut.probable.conservees, 1)
  assert.strictEqual(r.article.par_statut.probable.taux_correction, 0)
  // Une confirmation ne figure PAS au palmarès des libellés coûteux.
  assert.deepStrictEqual(r.article.palmares, [])
})

test('computeScanPrecision — proposition CORRIGÉE', () => {
  const r = computeScanPrecision([entree({
    article_choisi: 'Nitrate de calcium Ultrasol',
    article_status_initial: 'probable',
  })])
  assert.strictEqual(r.article.corrigees, 1)
  assert.strictEqual(r.article.conservees, 0)
  assert.strictEqual(r.article.taux_correction, 1)
  assert.strictEqual(r.article.par_statut.probable.corrigees, 1)
  assert.deepStrictEqual(r.article.palmares, [
    { libelle: 'N. calcium', lignes: 1, corrigees: 1, taux_correction: 1 },
  ])
})

test('computeScanPrecision — un `exact` corrigé est un FAUX POSITIF avéré', () => {
  const r = computeScanPrecision([
    // Article : proposé `exact`, corrigé -> faux positif.
    entree({ article_status_initial: 'exact', article_choisi: 'Nitrate de calcium Ultrasol' }),
    // Parcelle : proposée `exact` et conservée -> PAS un faux positif.
    entree({}),
  ])
  assert.strictEqual(r.faux_positifs.article, 1)
  assert.strictEqual(r.faux_positifs.parcelle, 0)
  assert.strictEqual(r.faux_positifs.total, 1)
  assert.strictEqual(r.article.par_statut.exact.corrigees, 1)
  assert.strictEqual(r.parcelle.par_statut.exact.corrigees, 0)
  assert.strictEqual(r.parcelle.par_statut.exact.conservees, 2)
})

test('computeScanPrecision — un `exact` corrigé côté PARCELLE compte aussi', () => {
  const r = computeScanPrecision([entree({ parcelle_choisie: 'F1 MARAVILLA S4' })])
  assert.strictEqual(r.faux_positifs.parcelle, 1)
  assert.strictEqual(r.faux_positifs.total, 1)
})

test('computeScanPrecision — `unmatched` complété à la main : correction, hors pré-remplissage', () => {
  const r = computeScanPrecision([entree({
    article_propose: '',
    article_status_initial: 'unmatched',
    article_score: null,
    article_choisi: 'Sulfate de potasse soluble crist.',
  })])
  assert.strictEqual(r.article.proposees, 0)
  assert.strictEqual(r.article.taux_prefill, 0) // 0 proposée sur 1 ligne : un vrai 0 %
  assert.strictEqual(r.article.renseignees, 1)
  assert.strictEqual(r.article.corrigees, 1)
  assert.strictEqual(r.article.par_statut.unmatched.corrigees, 1)
  assert.strictEqual(r.article.par_statut.unmatched.score_moyen, null)
  assert.strictEqual(r.faux_positifs.total, 0)
})

test('computeScanPrecision — ligne sans valeur retenue : ni confirmation ni correction', () => {
  // Un enregistrement où rien n'est retenu ne prouve rien. Le compter comme
  // correction gonflerait le numérateur ; le compter comme confirmation
  // gonflerait le dénominateur. Il ne compte NULLE PART.
  const r = computeScanPrecision([entree({ article_choisi: '', parcelle_choisie: '' })])
  assert.strictEqual(r.article.lignes, 1)
  assert.strictEqual(r.article.proposees, 1) // une proposition A bien été faite
  assert.strictEqual(r.article.renseignees, 0)
  assert.strictEqual(r.article.corrigees, 0)
  assert.strictEqual(r.article.conservees, 0)
  assert.strictEqual(r.article.taux_correction, null)
  assert.deepStrictEqual(r.article.par_statut, {})
  assert.strictEqual(r.parcelle.renseignees, 0)
})

test('computeScanPrecision — alias conservé vs alias re-corrigé (taux ASYMÉTRIQUE)', () => {
  const r = computeScanPrecision([
    entree({ article_status_initial: 'alias', article_alias_count: 3 }), // conservé
    entree({ article_status_initial: 'alias', article_alias_count: 3 }), // conservé
    entree({
      article_lu: 'S. Potassium',
      article_propose: 'Sulfat de potasse',
      article_choisi: 'Sulfate de potasse soluble crist.',
      article_status_initial: 'alias',
      article_alias_count: 1,
    }), // re-corrigé
  ])
  assert.strictEqual(r.article.alias.lignes, 3)
  assert.strictEqual(r.article.alias.conservees, 2)
  assert.strictEqual(r.article.alias.corrigees, 1)
  // 2/3 et non 1/3 : le rapport parle de CONSERVATION, pas de correction.
  assert.ok(Math.abs(r.article.alias.taux_conservation - 2 / 3) < 1e-9)
  // Un alias re-corrigé n'est PAS un faux positif `exact` : il est affiché en
  // orange « à vérifier », le magasinier est censé le relire.
  assert.strictEqual(r.faux_positifs.total, 0)
})

test('computeScanPrecision — sans aucun alias, le bloc alias est neutre (0/null), pas absent', () => {
  const r = computeScanPrecision([entree({})])
  assert.deepStrictEqual(r.article.alias, {
    lignes: 0, conservees: 0, corrigees: 0, taux_conservation: null,
  })
})

test('computeScanPrecision — palmarès trié par corrections décroissantes puis alphabétique', () => {
  const corrige = (lu) => entree({
    article_lu: lu, article_choisi: 'AUTRE CHOSE', article_status_initial: 'probable',
  })
  const r = computeScanPrecision([
    corrige('Decis'), corrige('Decis'), corrige('Decis'),
    corrige('Zeta'), corrige('Alpha'),
    entree({ article_lu: 'Alpha' }), // confirmation : baisse le taux d'Alpha
  ])
  assert.deepStrictEqual(r.article.palmares.map((p) => p.libelle), ['Decis', 'Alpha', 'Zeta'])
  assert.strictEqual(r.article.palmares[0].corrigees, 3)
  assert.strictEqual(r.article.palmares[1].taux_correction, 0.5)
})

test('computeScanPrecision — score moyen par statut', () => {
  const r = computeScanPrecision([
    entree({ article_score: 0.8 }),
    entree({ article_score: 0.9 }),
  ])
  assert.ok(Math.abs(r.article.par_statut.probable.score_moyen - 0.85) < 1e-9)
})

// ===========================================================================
// Périodes
// ===========================================================================

test('periodeDe — mois ISO, ou "inconnue" pour une date illisible', () => {
  assert.strictEqual(periodeDe({ date: '2026-08-25' }), '2026-08')
  assert.strictEqual(periodeDe({ date: '' }), 'inconnue')
  assert.strictEqual(periodeDe({}), 'inconnue')
})

test('computeScanPrecision — découpage par période, ordre chronologique', () => {
  const r = computeScanPrecision([
    entree({ date: '2026-09-02', bon_numero: 'BC-2' }),
    entree({ date: '2026-08-25', bon_numero: 'BC-1', article_choisi: 'AUTRE', article_status_initial: 'exact' }),
  ])
  assert.deepStrictEqual(r.periodes.map((p) => p.periode), ['2026-08', '2026-09'])
  assert.strictEqual(r.periodes[0].article.faux_positifs, 1)
  assert.strictEqual(r.periodes[1].article.faux_positifs, 0)
  assert.strictEqual(r.bons, 2)
})

test('computeScanPrecision — une période SANS ligne apparaît avec des taux null', () => {
  const r = computeScanPrecision([entree({ date: '2026-08-25' })], {
    periodes: ['2026-07', '2026-08', '2026-09'],
  })
  assert.deepStrictEqual(r.periodes.map((p) => p.periode), ['2026-07', '2026-08', '2026-09'])
  const juillet = r.periodes[0]
  assert.strictEqual(juillet.lignes, 0)
  // Ne JAMAIS lire une période vide comme une période parfaite.
  assert.strictEqual(juillet.article.taux_correction, null)
  assert.strictEqual(juillet.article.taux_prefill, null)
  assert.strictEqual(juillet.parcelle.taux_correction, null)
  assert.strictEqual(r.periodes[1].lignes, 1)
})

test('computeScanPrecision — les bons sans numéro ne sont pas comptés', () => {
  // Le journal peut recevoir un bon_numero vide (create-bc n'a pas renvoyé de
  // numéro). Le compter gonflerait l'en-tête « N bon(s) ».
  const r = computeScanPrecision([
    entree({ bon_numero: 'BC-1' }),
    entree({ bon_numero: 'BC-1' }), // même bon : compté une fois
    entree({ bon_numero: '' }),
    entree({ bon_numero: '   ' }),
    entree({ bon_numero: null }),
  ])
  assert.strictEqual(r.lignes, 5)
  assert.strictEqual(r.bons, 1)
})

// ===========================================================================
// Couverture des périodes (ce que la CLI doit afficher, trous compris)
// ===========================================================================

test('moisDe — accepte un mois, une date ISO, rejette le reste', () => {
  assert.strictEqual(moisDe('2026-08'), '2026-08')
  assert.strictEqual(moisDe('2026-08-25'), '2026-08')
  assert.strictEqual(moisDe('25/08/2026'), '')
  assert.strictEqual(moisDe(''), '')
  assert.strictEqual(moisDe(null), '')
})

test('periodesEntre — suite CONTINUE, les trous sont générés', () => {
  assert.deepStrictEqual(periodesEntre('2026-08', '2026-11'),
    ['2026-08', '2026-09', '2026-10', '2026-11'])
  // Une seule borne : un mois.
  assert.deepStrictEqual(periodesEntre('2026-08', '2026-08'), ['2026-08'])
  // Passage d'année.
  assert.deepStrictEqual(periodesEntre('2026-11-03', '2027-02-28'),
    ['2026-11', '2026-12', '2027-01', '2027-02'])
})

test('periodesEntre — bornes inversées ou invalides -> [] (jamais de boucle infinie)', () => {
  assert.deepStrictEqual(periodesEntre('2026-11', '2026-08'), [])
  assert.deepStrictEqual(periodesEntre('', '2026-08'), [])
  assert.deepStrictEqual(periodesEntre('2026-08', 'nawak'), [])
})

test('periodesCouvertes — un mois SANS donnée entre deux mois pleins est généré', () => {
  const c = periodesCouvertes([
    entree({ date: '2026-08-25' }),
    entree({ date: '2026-10-02' }),
  ])
  // Septembre n'a aucune ligne : il doit tout de même figurer.
  assert.deepStrictEqual(c.periodes, ['2026-08', '2026-09', '2026-10'])
  assert.strictEqual(c.tronquee, false)
})

test('periodesCouvertes — --depuis/--jusqu-a bornent, même si la plage est vide', () => {
  const c = periodesCouvertes([entree({ date: '2026-09-02' })], {
    depuis: '2026-07-01', jusqu_a: '2026-11-30',
  })
  assert.deepStrictEqual(c.periodes, ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
  // Une plage demandée SANS aucune donnée doit se voir, pas disparaître.
  const vide = periodesCouvertes([], { depuis: '2026-07', jusqu_a: '2026-09' })
  assert.deepStrictEqual(vide.periodes, ['2026-07', '2026-08', '2026-09'])
})

test('periodesCouvertes — journal vide et sans bornes -> aucune période', () => {
  assert.deepStrictEqual(periodesCouvertes([]), { periodes: [], tronquee: false })
})

test('periodesCouvertes — date aberrante : plage tronquée, et ça se DIT', () => {
  // Cas réel : consumption_vouchers contient un bon daté 2028-08 (coquille).
  const c = periodesCouvertes([
    entree({ date: '2026-08-25' }),
    entree({ date: '2028-08-01' }),
  ])
  assert.strictEqual(c.tronquee, true)
  // On retombe sur les mois RÉELLEMENT observés, sans les 23 mois vides.
  assert.deepStrictEqual(c.periodes, ['2026-08', '2028-08'])
  // Le plafond doit trancher SOUS l'étendue de ce cas réel (25 mois), tout en
  // laissant passer une campagne entière (12 mois).
  assert.ok(PERIODES_MAX >= 12 && PERIODES_MAX < 25,
    'PERIODES_MAX doit couvrir une campagne sans laisser passer 2026-08 -> 2028-08')
})

test('periodesCouvertes — une campagne ENTIÈRE passe sans troncature', () => {
  const c = periodesCouvertes([
    entree({ date: '2026-07-01' }),
    entree({ date: '2027-06-30' }),
  ])
  assert.strictEqual(c.tronquee, false)
  assert.strictEqual(c.periodes.length, 12)
  assert.strictEqual(c.periodes[0], '2026-07')
  assert.strictEqual(c.periodes[11], '2027-06')
})

test('periodesCouvertes — le plafond est paramétrable et strictement supérieur', () => {
  const rows = [entree({ date: '2026-08-25' }), entree({ date: '2026-10-02' })]
  // 3 périodes, plafond 3 : accepté (pas de troncature à égalité).
  assert.strictEqual(periodesCouvertes(rows, { max: 3 }).tronquee, false)
  assert.strictEqual(periodesCouvertes(rows, { max: 2 }).tronquee, true)
})

test('STATUTS — contrat figé (le rapport et le front en dépendent)', () => {
  assert.deepStrictEqual(STATUTS, ['exact', 'probable', 'alias', 'unmatched'])
})
