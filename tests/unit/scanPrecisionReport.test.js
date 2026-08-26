'use strict'

/**
 * Tests du RAPPORT de précision — scripts/scan-precision-report.js.
 *
 * Pourquoi tester le script et pas seulement le module pur : la fonctionnalité
 * « période sans ligne » était implémentée ET testée dans
 * functions/lib/stock/bcScanJournal.js, mais INATTEIGNABLE depuis la ligne de
 * commande (le script appelait computeScanPrecision sans `periodes`). Un mois
 * entier sans donnée s'évaporait du tableau — exactement le défaut que ce lot
 * combat, une absence se lisant tout aussi facilement comme « rien à signaler »
 * que le 0 % qu'on refuse déjà d'afficher.
 *
 * Ces tests verrouillent donc le CHEMIN CLI (`analyser`), pas le module seul.
 *
 * Le script ne s'exécute pas au require (garde `require.main === module`) et ne
 * touche Firestore que dans `readJournal`, jamais appelé ici.
 */

const test = require('node:test')
const assert = require('node:assert')

const { parseArgs, analyser, jeuDemo } = require('../../scripts/scan-precision-report')

/** @param {Object} o */
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
    parcelle_lue: 'marvilla S-3',
    parcelle_proposee: 'F1 MARAVILLA S3',
    parcelle_choisie: 'F1 MARAVILLA S3',
    parcelle_status_initial: 'exact',
    parcelle_score: 1,
  }, o)
}

/** Ligne du tableau « PAR PÉRIODE » correspondant à un mois donné. */
function ligneMois(texte, mois) {
  return texte.split('\n').find((l) => l.trim().indexOf(mois) === 0) || ''
}

// ---------------------------------------------------------------------------

test('parseArgs — options reconnues, défauts sûrs', () => {
  const o = parseArgs(['--campagne', '2026-2027', '--depuis', '2026-08-01', '--jusqu-a', '2026-10-31'])
  assert.strictEqual(o.campagne, '2026-2027')
  assert.strictEqual(o.depuis, '2026-08-01')
  assert.strictEqual(o.jusquA, '2026-10-31')
  assert.strictEqual(o.json, false)
  assert.strictEqual(o.demo, false)
  assert.strictEqual(parseArgs(['--json', '--demo']).json, true)
  assert.strictEqual(parseArgs(['--json', '--demo']).demo, true)
  assert.deepStrictEqual(parseArgs([]).campagne, '')
})

test('CLI — un mois SANS ligne apparaît dans le tableau, en n/a', () => {
  const { texte, rapport } = analyser([
    entree({ date: '2026-08-25' }),
    entree({ date: '2026-10-02', bon_numero: 'BC-2' }),
  ], {})

  // Le module voit bien les trois périodes...
  assert.deepStrictEqual(rapport.periodes.map((p) => p.periode), ['2026-08', '2026-09', '2026-10'])
  // ... et surtout la SORTIE les affiche : c'est ce qui manquait.
  const septembre = ligneMois(texte, '2026-09')
  assert.notStrictEqual(septembre, '', 'le mois vide 2026-09 doit figurer dans la sortie')
  // Un mois vide affiche « n/a », jamais « 0.0 % » : sinon il se lit comme un
  // mois parfait.
  assert.ok(septembre.indexOf('n/a') !== -1, 'le mois vide doit afficher n/a : ' + septembre)
  assert.ok(septembre.indexOf('0.0 %') === -1, 'le mois vide ne doit PAS afficher 0.0 % : ' + septembre)
})

test('CLI — une plage --depuis/--jusqu-a sans aucune donnée s\'affiche quand même', () => {
  const { texte } = analyser([entree({ date: '2026-09-02' })], {
    depuis: '2026-07-01', jusquA: '2026-11-30',
  })
  ;['2026-07', '2026-08', '2026-10', '2026-11'].forEach((m) => {
    assert.notStrictEqual(ligneMois(texte, m), '', 'mois attendu dans la sortie : ' + m)
  })
})

test('CLI — journal vide : le rapport le DIT au lieu d\'afficher un vert trompeur', () => {
  const { texte } = analyser([], {})
  assert.ok(texte.indexOf('Journal vide') !== -1)
  assert.ok(texte.indexOf("0 % d'erreur") !== -1, 'doit avertir contre la lecture « 0 % »')
})

test('CLI — date aberrante : plage tronquée signalée explicitement', () => {
  // Cas réel : consumption_vouchers porte un bon daté 2028-08 (coquille).
  const { texte, rapport } = analyser([
    entree({ date: '2026-08-25' }),
    entree({ date: '2028-08-01', bon_numero: 'BC-9' }),
  ], {})
  assert.ok(texte.indexOf('plage trop large') !== -1, 'la troncature doit être dite')
  assert.deepStrictEqual(rapport.periodes.map((p) => p.periode), ['2026-08', '2028-08'])
})

test('CLI — les faux positifs sortent EN TÊTE, avant les autres blocs', () => {
  const { texte } = analyser([
    entree({ article_status_initial: 'exact', article_choisi: 'AUTRE CHOSE' }),
  ], {})
  const iFaux = texte.indexOf('FAUX POSITIFS AVÉRÉS')
  const iArticles = texte.indexOf('▶ ARTICLES')
  const iPeriodes = texte.indexOf('▶ PAR PÉRIODE')
  assert.ok(iFaux > 0, 'le bloc faux positifs doit exister')
  assert.ok(iFaux < iArticles && iArticles < iPeriodes, 'ordre attendu : faux positifs, articles, périodes')
  assert.ok(texte.indexOf('seuils trop permissifs') !== -1)
})

test('CLI — aucun faux positif : pas d\'alerte de resserrage des seuils', () => {
  const { texte } = analyser([entree({})], {})
  assert.ok(texte.indexOf('seuils trop permissifs') === -1)
})

test('CLI — le jeu de démonstration produit un rapport complet et cohérent', () => {
  // `--demo` doit rester représentatif : c'est l'exemple de sortie montré tant
  // que le journal de production est vide.
  const { rapport, texte } = analyser(jeuDemo(), { demo: true })
  assert.ok(rapport.lignes > 0)
  assert.strictEqual(rapport.faux_positifs.total, 1)
  assert.ok(texte.indexOf('JEU DE DÉMONSTRATION') !== -1)
  assert.ok(texte.indexOf('▶ PARCELLES') !== -1)
})
