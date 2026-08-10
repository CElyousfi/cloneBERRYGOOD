'use strict'
// @ts-check

const test = require('node:test')
const assert = require('node:assert')

const {
  computeSeedPlan,
  sanitizeLabels,
  normLabel,
  MAX_LABELS,
  RAISON_DEJA_SB,
  RAISON_SANS_SURFACE,
  SOURCE_BEE_ONE,
} = require('../seedHa')

/** Labels du tableau affiché (campagne sélectionnée à l'écran). */
const LABELS = ['F5- CASCADE -S13', 'F5 -BREEZE- S14', 'F1- ROUGE -S01', 'F1- ROUGE -S02']

/** Surfaces BR_Parcelle (source authoritative, résolue serveur). */
const SUP = {
  'F5- CASCADE -S13': 2,
  'F5 -BREEZE- S14': 1,
  'F1- ROUGE -S01': 1.5,
  // F1- ROUGE -S02 absente : aucune surface BEE ONE connue
}

function byLabel(list) {
  const m = {}
  list.forEach((e) => {
    m[e.label] = e
  })
  return m
}

test('normLabel — uppercase + trim', () => {
  assert.strictEqual(normLabel('  f5- cascade -s13 '), 'F5- CASCADE -S13')
  assert.strictEqual(normLabel(null), '')
  assert.strictEqual(normLabel(undefined), '')
})

test('sanitizeLabels — rejette les entrées non exploitables', () => {
  assert.strictEqual(sanitizeLabels(undefined).ok, false)
  assert.strictEqual(sanitizeLabels([]).ok, false)
  assert.strictEqual(sanitizeLabels('F1').ok, false)
  assert.strictEqual(sanitizeLabels(['  ', '']).ok, false, 'que du vide → refus')
  // Un ha injecté par le client à la place d'un label = type invalide → refus.
  assert.strictEqual(sanitizeLabels([{ label: 'F1', ha: 999 }]).ok, false)
  assert.strictEqual(sanitizeLabels(['F1', 42]).ok, false)
  const trop = new Array(MAX_LABELS + 1).fill('F1')
  assert.strictEqual(sanitizeLabels(trop).ok, false, 'borne ' + MAX_LABELS + ' respectée')
})

test('sanitizeLabels — trim, dédup, casse préservée', () => {
  const v = sanitizeLabels(['  F5- CASCADE -S13 ', 'f5- cascade -s13', '', 'F1- ROUGE -S01'])
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.labels, ['F5- CASCADE -S13', 'F1- ROUGE -S01'])
})

test('computeSeedPlan — liste vide → plan vide', () => {
  assert.deepStrictEqual(computeSeedPlan({ labels: [], sbMap: {}, supMap: {} }), {
    toCreate: [],
    skipped: [],
  })
  assert.deepStrictEqual(computeSeedPlan({}), { toCreate: [], skipped: [] })
})

test('computeSeedPlan — cas nominal : seules les parcelles affichées sans Ha SB sont créées', () => {
  const sbMap = { 'F5- CASCADE -S13': { ha: 2.4, nom_sb: 'Cascade Sud' } }
  const plan = computeSeedPlan({ labels: LABELS, sbMap, supMap: SUP })

  assert.deepStrictEqual(plan.toCreate, [
    { label: 'F5 -BREEZE- S14', ha: 1, source: SOURCE_BEE_ONE },
    { label: 'F1- ROUGE -S01', ha: 1.5, source: SOURCE_BEE_ONE },
  ])

  const skipped = byLabel(plan.skipped)
  assert.strictEqual(skipped['F5- CASCADE -S13'].raison, RAISON_DEJA_SB)
  assert.strictEqual(skipped['F1- ROUGE -S02'].raison, RAISON_SANS_SURFACE)
  assert.strictEqual(plan.skipped.length, 2)

  // Le total présenté à l'écran = les parcelles du tableau, ni plus ni moins.
  assert.strictEqual(plan.toCreate.length + plan.skipped.length, LABELS.length)
})

test('computeSeedPlan — PÉRIMÈTRE : aucune parcelle hors de la liste fournie ne peut être créée', () => {
  // supMap et sbMap connaissent des parcelles d'AUTRES campagnes (F3 -FUERTE,
  // F6 -ZUTANO…) : elles ne doivent JAMAIS apparaître dans le plan.
  const supLarge = Object.assign({}, SUP, {
    'F3 -FUERTE': 3,
    'F6 -ZUTANO': 4,
    'Avocat AVOCAT F6 AVOCAT': 5,
    'S9 - REYNA F5': 6,
  })
  const affiches = ['F5 -BREEZE- S14', 'F1- ROUGE -S01']
  const plan = computeSeedPlan({ labels: affiches, sbMap: {}, supMap: supLarge })

  const attendus = affiches.map(normLabel)
  plan.toCreate.forEach((c) => {
    assert.ok(attendus.indexOf(normLabel(c.label)) !== -1, 'parcelle hors périmètre créée : ' + c.label)
  })
  plan.skipped.forEach((s) => {
    assert.ok(attendus.indexOf(normLabel(s.label)) !== -1, 'parcelle hors périmètre ignorée : ' + s.label)
  })
  assert.strictEqual(plan.toCreate.length, 2)
  assert.strictEqual(plan.toCreate.length + plan.skipped.length, affiches.length)
})

test('computeSeedPlan — le Ha proposé est celui de la colonne Ha du tableau', () => {
  // Le tableau affiche `sb.ha > 0 ? sb.ha : r.sup` et `r.sup` vient de la MÊME
  // carte BR_Parcelle que supMap → pour toute parcelle éligible (sb.ha == 0),
  // le Ha proposé DOIT valoir r.sup.
  const sbMap = { 'F5- CASCADE -S13': { ha: 2.4 } }
  const plan = computeSeedPlan({ labels: LABELS, sbMap, supMap: SUP })
  plan.toCreate.forEach((c) => {
    const rSup = SUP[c.label]
    assert.strictEqual(c.ha, rSup, 'Ha proposé ≠ Ha affiché pour ' + c.label)
  })
})

test('computeSeedPlan — IDEMPOTENCE : rejouer le plan ne réécrit rien', () => {
  const sbMap = {}
  const plan1 = computeSeedPlan({ labels: LABELS, sbMap, supMap: SUP })
  assert.strictEqual(plan1.toCreate.length, 3)

  // Simule l'écriture du 1er passage dans sb_parcelle_referentiel.
  plan1.toCreate.forEach((c) => {
    sbMap[normLabel(c.label)] = { label_bee_one: c.label, ha: c.ha, seeded_from: c.source }
  })

  const plan2 = computeSeedPlan({ labels: LABELS, sbMap, supMap: SUP })
  assert.deepStrictEqual(plan2.toCreate, [], '2e passage : plus rien à créer')
  assert.strictEqual(plan2.skipped.length, 4)
  assert.strictEqual(
    plan2.skipped.filter((s) => s.raison === RAISON_DEJA_SB).length,
    3,
    'les 3 parcelles seedées sont désormais protégées par deja_sb'
  )
})

test('computeSeedPlan — un Ha SB nul/absent/invalide ne protège pas la parcelle', () => {
  const sbMap = {
    'F5- CASCADE -S13': { ha: 0 },
    'F5 -BREEZE- S14': { nom_sb: 'Breeze Nord' }, // nom saisi, pas de Ha
    'F1- ROUGE -S01': { ha: 'n/a' },
  }
  const plan = computeSeedPlan({ labels: LABELS, sbMap, supMap: SUP })
  assert.deepStrictEqual(
    plan.toCreate.map((c) => c.label),
    ['F5- CASCADE -S13', 'F5 -BREEZE- S14', 'F1- ROUGE -S01']
  )
})

test('computeSeedPlan — nom_sb préservé : jamais présent dans le plan', () => {
  const sbMap = { 'F5 -BREEZE- S14': { nom_sb: 'Breeze Nord', ha: 0 } }
  const plan = computeSeedPlan({ labels: LABELS, sbMap, supMap: SUP })
  const entry = plan.toCreate.find((c) => c.label === 'F5 -BREEZE- S14')
  assert.ok(entry, 'la parcelle est bien à créer (Ha nul)')
  assert.deepStrictEqual(
    Object.keys(entry).sort(),
    ['ha', 'label', 'source'],
    'le plan ne porte que label/ha/source → l écriture merge ne touche pas nom_sb'
  )
  assert.strictEqual(entry.nom_sb, undefined)
})

test('computeSeedPlan — parcelle sans surface serveur : rien créé, raison explicite', () => {
  const plan = computeSeedPlan({
    labels: ['F1- ROUGE -S02', 'F1- ROUGE -S03'],
    sbMap: {},
    supMap: { 'F1- ROUGE -S03': 0 },
  })
  assert.deepStrictEqual(plan.toCreate, [])
  assert.deepStrictEqual(plan.skipped, [
    { label: 'F1- ROUGE -S02', raison: RAISON_SANS_SURFACE },
    { label: 'F1- ROUGE -S03', raison: RAISON_SANS_SURFACE },
  ])
})

test('computeSeedPlan — aucune surface transmise par le client n’est retenue', () => {
  // Anciennement un repli `row.sup` existait : il est supprimé. Même si un
  // appelant bricole un objet, rien ne doit être créé sans surface serveur.
  const plan = computeSeedPlan({
    // @ts-expect-error — entrée volontairement mal typée (simulation d'un client hostile)
    labels: [{ label: 'F9 - PIRATE', sup: 999 }, 'F9 - PIRATE'],
    sbMap: {},
    supMap: {},
  })
  assert.deepStrictEqual(plan.toCreate, [])
})

test('computeSeedPlan — casse et espaces : matching et déduplication', () => {
  const plan = computeSeedPlan({
    labels: ['  f5- cascade -s13  ', 'F5- CASCADE -S13', ' f5 -breeze- s14 ', '   '],
    sbMap: { '  f5 -breeze- s14 ': { ha: 1.2 } },
    supMap: { 'F5- CASCADE -S13': 2 },
  })
  assert.deepStrictEqual(plan.toCreate, [{ label: 'f5- cascade -s13', ha: 2, source: SOURCE_BEE_ONE }])
  assert.deepStrictEqual(plan.skipped, [{ label: 'f5 -breeze- s14', raison: RAISON_DEJA_SB }])
})
