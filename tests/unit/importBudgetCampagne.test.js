'use strict'

/**
 * Tests de la logique PURE d'import du budget JH/Ha depuis le classeur d'Omar
 * (scripts/lib/importBudgetCampagne.js).
 *
 * Les fixtures reproduisent la forme RÉELLE du fichier source (vérifiée) :
 * 2 lignes de titre, une ligne d'en-têtes, une ligne de total général, puis des
 * blocs « total de famille + opérations ». Le fichier lui-même n'est pas
 * committé (donnée métier) : les cas métier délicats sont donc reproduits ici.
 */

const test = require('node:test')
const assert = require('node:assert')

const lib = require('../../scripts/lib/importBudgetCampagne')

/** Référentiel minimal, même forme que `referentiel_taches`. */
const REFERENTIEL = [
  { code: 'GB01', groupe: 'M.O Hors récolte', famille: 'Travaux du sol', operation: 'Billonage' },
  { code: 'GB01', groupe: 'M.O Hors récolte', famille: 'Travaux du sol', operation: 'Grattage' },
  { code: 'GB02', groupe: 'M.O Hors récolte', famille: 'Ferti-irrigation', operation: 'Responsable irrigation' },
  { code: 'GB02', groupe: 'M.O Hors récolte', famille: 'Ferti-irrigation', operation: 'Nettoyage goutteurs' },
  { code: 'GB03', groupe: 'M.O Hors récolte', famille: ' plantation', operation: 'Lessivage pots' },
  { code: 'GB03', groupe: 'M.O Hors récolte', famille: ' plantation', operation: 'Distribution et remplissage ligne continue' },
  { code: 'LB03', groupe: 'M.O Hors récolte', famille: ' plantation', operation: 'Trempage de racines et plants' },
  { code: 'GB05', groupe: 'M.O Hors récolte', famille: 'Entretien structure', operation: 'Aération serre' },
  { code: 'GB05', groupe: 'M.O Hors récolte', famille: 'Entretien structure', operation: 'Nettoyage' },
  { code: 'GB05', groupe: 'M.O Hors récolte', famille: 'Entretien structure', operation: 'Désherbage Manuelle' },
  { code: 'GB05', groupe: 'M.O Hors récolte', famille: 'Entretien structure', operation: 'Effeuillage' },
  { code: 'GB08', groupe: 'M.O Récolte', famille: 'Récolte', operation: 'Récolte manuelle (kg)' },
  { code: 'GB08', groupe: 'M.O Récolte', famille: 'Récolte', operation: 'Prétriage ' },
  { code: 'GB09', groupe: 'M.O Hors récolte', famille: 'Taille', operation: 'Coupe Cutback' },
  { code: 'GB09', groupe: 'M.O Hors récolte', famille: 'Taille', operation: 'Evacuation bois taille ' },
  { code: 'GB09', groupe: 'M.O Hors récolte', famille: 'Taille', operation: 'Ramassage bois de taille' },
  { code: 'GB11', groupe: 'M.O Service générale', famille: 'Service générale', operation: 'Gardiennage' },
  { code: 'GB11', groupe: 'M.O Service générale', famille: 'Service générale', operation: 'Nettoyage' },
]

/**
 * Fixture : colonnes 3 = MIA, 4 = YASMINE, 5 = colonne hors mapping,
 * 6 = MARAVILLA MD.
 */
function fixtureRows() {
  return [
    ['', "BUDGET   MAIN D'ŒUVRE / en  journées de travail "],
    ['', '', '', 'FRAMBOISE'],
    ['GROUPE/ RUBRIQUES', 'FAMILLE ', 'Nature Opération', 'MIA', 'YASMINE', 'PARCELLE INCONNUE', 'MARAVILLA MD'],
    ['', '', '', 43, 30, 12, 21],
    ['M.O Hors récolte  / TRAVAUX DU SOL ', '', '', 8, 6, 1, 4],
    ['M.O Hors récolte ', 'Travaux du sol', 'Billonage', 6, 6, 1, ''],
    ['M.O Hors récolte ', 'Travaux du sol', 'Grattage,Nvlm', 2, '', '', 4],
    ['M.O Hors récolte  / FERTI-IRRIGATION', '', '', 5, 4, 1, 2],
    ['M.O Hors récolte ', 'Ferti-irrigation', 'Responsable irrigation/Stationaire ', 5, 4, 1, 2],
    ['M.O Hors récolte  / ENTRETIEN CULTURE', '', '', 6, '', '', 3],
    ['Hors récolte', '10. Entretien cultures', 'Désherbage Manuelle', 4, '', '', 3],
    ['Hors récolte', '10. Entretien cultures', 'Chaulage / Déchaulage', 0, '', '', 0],
    ['Hors récolte', '10. Entretien cultures', 'Effeuillage', 2, '', '', ''],
    ['M.O Hors récolte  / ENTRETIEN STRUCTURE', '', '', 4, '', '', 2],
    ['M.O Hors récolte ', 'Entretien structure', 'Aération serre', 3, '', '', 2],
    ['M.O Hors récolte ', 'Entretien structure', 'Nettoyage', 1, '', '', ''],
    ['M.O Récolte  /  RECOLTE', '', '', 18, 18, 8, 10],
    ['M.O Récolte ', 'Récolte', 'Récolte manuelle (kg)', '', '', '', ''],
    ['M.O Récolte ', 'Récolte', 'Prétriage ', '', '', '', ''],
    ['M.O SERVICE GENERALE ', '', '', 2, 2, 1, 0],
    ['M.O Service générale', 'Service générale', 'Gardiennage', '', '', '', ''],
    ['M.O Service générale', 'Service générale', 'Aide caporal', '', '', '', ''],
  ]
}

/** @returns {*} plan calculé sur la fixture. */
function plan() {
  return lib.buildImportPlan({
    budgetRows: fixtureRows(),
    referentiel: REFERENTIEL,
    campagne: '2026-2027',
  })
}

/**
 * @param {*} p
 * @param {string} label
 * @returns {*}
 */
function parcelle(p, label) {
  const hit = p.parcelles.filter((x) => x.label === label)[0]
  assert.ok(hit, 'parcelle absente du plan : ' + label)
  return hit
}

// ── Helpers ─────────────────────────────────────────────────────────────────

test('normText compacte les espaces et ignore la casse, garde les accents', () => {
  assert.strictEqual(lib.normText('  Traitement phyto/ Pulvèrisation  foliaire '), 'traitement phyto/ pulvèrisation foliaire')
  assert.strictEqual(lib.normText(' plantation'), 'plantation')
  assert.strictEqual(lib.normText(null), '')
})

test('parseCell : vide = 0, virgule FR acceptée, texte refusé', () => {
  assert.deepStrictEqual(lib.parseCell(''), { ok: true, value: 0 })
  assert.deepStrictEqual(lib.parseCell(null), { ok: true, value: 0 })
  assert.deepStrictEqual(lib.parseCell(1.234), { ok: true, value: 1.23 })
  assert.deepStrictEqual(lib.parseCell('2,5'), { ok: true, value: 2.5 })
  assert.strictEqual(lib.parseCell('n/a').ok, false)
})

test('indexReferentiel résout la famille DEPUIS LE CODE et la trime', () => {
  const idx = lib.indexReferentiel(REFERENTIEL)
  // ' plantation' (référentiel) → 'plantation' : c'est ce que le backend
  // expose (familleDuCode + trim), donc la seule famille écrivable.
  assert.strictEqual(idx.parFamille['plantation'], 'plantation')
  const lessivage = idx.parCle[lib.cleOperation(' plantation', 'Lessivage pots')]
  assert.strictEqual(lessivage.key, 'GB03::Lessivage pots')
  // LB03 partage la famille ' plantation' : sa propre résolution donne aussi
  // 'plantation' (jamais deux familles pour la même rubrique).
  assert.strictEqual(
    idx.parCle[lib.cleOperation('plantation', 'Trempage de racines et plants')].key,
    'LB03::Trempage de racines et plants'
  )
})

test('indexReferentiel : « Nettoyage » existe sous DEUX codes, jamais confondus', () => {
  const idx = lib.indexReferentiel(REFERENTIEL)
  assert.strictEqual(idx.parCle[lib.cleOperation('Entretien structure', 'Nettoyage')].key, 'GB05::Nettoyage')
  assert.strictEqual(idx.parCle[lib.cleOperation('Service générale', 'Nettoyage')].key, 'GB11::Nettoyage')
})

test('la clé d\'index ne confond pas (« A B », « C ») et (« A », « B C »)', () => {
  assert.notStrictEqual(lib.cleOperation('A B', 'C'), lib.cleOperation('A', 'B C'))
})

// ── Colonnes ────────────────────────────────────────────────────────────────

test('resolveColonnes applique le mapping validé et ignore le reste', () => {
  const r = lib.resolveColonnes(fixtureRows()[lib.LIGNE_ENTETES])
  assert.deepStrictEqual(
    r.colonnes.map((c) => [c.entete, c.label]),
    [
      ['MIA', 'F5- MYA S9'],
      ['YASMINE', 'F5 YAZMIN MT'],
      ['MARAVILLA MD', 'F1- S5 MARAVILLA MD'],
    ]
  )
  assert.strictEqual(r.ignorees.length, 1)
  assert.strictEqual(r.ignorees[0].entete, 'PARCELLE INCONNUE')
  assert.match(r.ignorees[0].raison, /hors mapping/)
})

test('mapping validé : YASMINE ne vise QUE F5 YAZMIN MT', () => {
  assert.strictEqual(lib.PARCELLE_PAR_COLONNE.YASMINE, 'F5 YAZMIN MT')
  const cibles = Object.keys(lib.PARCELLE_PAR_COLONNE).map((k) => lib.PARCELLE_PAR_COLONNE[k])
  assert.strictEqual(cibles.filter((l) => /YAZMIN/i.test(l)).length, 1)
  assert.strictEqual(cibles.length, new Set(cibles).size, 'aucune parcelle ne doit être visée deux fois')
})

// ── Découpage en blocs ──────────────────────────────────────────────────────

test('parseBlocs : la ligne de total général est ignorée, pas importée', () => {
  const cols = lib.resolveColonnes(fixtureRows()[lib.LIGNE_ENTETES]).colonnes
  const r = lib.parseBlocs(fixtureRows(), cols)
  assert.strictEqual(r.totalGeneral.valeurs['F5- MYA S9'], 43)
  assert.ok(r.ignorees.some((l) => l.raison.indexOf('total général') === 0))
  // 6 blocs : travaux du sol, ferti, entretien culture, entretien structure,
  // récolte, service générale.
  assert.strictEqual(r.blocs.length, 6)
  assert.strictEqual(r.blocs[0].familleFichier, 'Travaux du sol')
  assert.strictEqual(r.blocs[0].total.valeurs['F5- MYA S9'], 8)
})

// ── Alias ───────────────────────────────────────────────────────────────────

test('les 8 variantes d\'écriture validées sont bien mappées', () => {
  const attendu = {
    'Coupe Cutback /MD': 'Coupe Cutback',
    'Distribution et remplissage Pots& Ligne continue': 'Distribution et remplissage ligne continue',
    'Responsable irrigation/Stationaire': 'Responsable irrigation',
    'Installation filet couvre sol ( couture y compris)': 'Installation filet couvre sol',
    'Evacuation bois taille /cahrg - déch': 'Evacuation bois taille',
    'Ramassage bois de taille / Vers pistes': 'Ramassage bois de taille',
    Lessivage: 'Lessivage pots',
    'Grattage,Nvlm': 'Grattage',
  }
  const keys = Object.keys(attendu)
  assert.strictEqual(keys.length, 8)
  assert.strictEqual(Object.keys(lib.ALIAS_OPERATIONS).length, 8)
  for (const k of keys) {
    assert.strictEqual(lib.ALIAS_OPERATIONS[lib.normText(k)], attendu[k], 'alias manquant : ' + k)
  }
})

test('un alias résout même avec les espaces parasites du fichier', () => {
  const p = plan()
  const mia = parcelle(p, 'F5- MYA S9')
  // 'Responsable irrigation/Stationaire ' (espace final) → GB02.
  assert.strictEqual(mia.budgets_operations['Ferti-irrigation']['GB02::Responsable irrigation'], 5)
  // 'Grattage,Nvlm' → GB01::Grattage.
  assert.strictEqual(mia.budgets_operations['Travaux du sol']['GB01::Grattage'], 2)
})

// ── Famille « 10. Entretien cultures » ──────────────────────────────────────

test('« 10. Entretien cultures » n\'est PAS créée : fusion dans Entretien structure', () => {
  const p = plan()
  const mia = parcelle(p, 'F5- MYA S9')
  assert.ok(!mia.budgets['10. Entretien cultures'], 'famille du fichier ne doit pas exister')
  assert.ok(!mia.budgets_operations['10. Entretien cultures'])
  const ops = mia.budgets_operations['Entretien structure']
  // 2 blocs fusionnés : Désherbage Manuelle + Effeuillage (bloc « culture »)
  // et Aération serre + Nettoyage (bloc « structure »).
  assert.deepStrictEqual(ops, {
    'GB05::Désherbage Manuelle': 4,
    'GB05::Effeuillage': 2,
    'GB05::Aération serre': 3,
    'GB05::Nettoyage': 1,
  })
  const fam = mia.familles.filter((f) => f.famille === 'Entretien structure')[0]
  // Les totaux des DEUX blocs sont additionnés pour le contrôle (6 + 4 = 10).
  assert.strictEqual(fam.total, 10)
  assert.strictEqual(fam.total_fichier, 10)
  assert.strictEqual(fam.ecart, 0)
})

// ── Famille vs opération ────────────────────────────────────────────────────

test('famille avec opérations : niveau opération + valeur de famille remise à 0', () => {
  const p = plan()
  const mia = parcelle(p, 'F5- MYA S9')
  assert.strictEqual(mia.budgets['Travaux du sol'], 0)
  assert.deepStrictEqual(mia.budgets_operations['Travaux du sol'], {
    'GB01::Billonage': 6,
    'GB01::Grattage': 2,
  })
  const fam = mia.familles.filter((f) => f.famille === 'Travaux du sol')[0]
  assert.strictEqual(fam.source, 'operations')
  assert.strictEqual(fam.total, 8)
})

test('famille sans aucune opération renseignée (Récolte, Service générale) : total de famille', () => {
  const p = plan()
  const mia = parcelle(p, 'F5- MYA S9')
  assert.strictEqual(mia.budgets['Récolte'], 18)
  assert.ok(!mia.budgets_operations['Récolte'], 'aucune opération ne doit être écrite')
  assert.strictEqual(mia.budgets['Service générale'], 2)
  assert.ok(!mia.budgets_operations['Service générale'])
  const rec = mia.familles.filter((f) => f.famille === 'Récolte')[0]
  assert.strictEqual(rec.source, 'famille')
})

test('les deux niveaux ne sont JAMAIS renseignés ensemble (pas de neutralisation)', () => {
  const p = plan()
  for (const par of p.parcelles) {
    for (const f of Object.keys(par.budgets_operations)) {
      assert.strictEqual(
        par.budgets[f],
        0,
        par.label + ' / ' + f + ' : une famille détaillée doit avoir sa valeur de famille à 0'
      )
    }
    for (const f of Object.keys(par.budgets)) {
      if (par.budgets[f] > 0) {
        assert.ok(
          !par.budgets_operations[f],
          par.label + ' / ' + f + ' : une famille valorisée ne doit porter aucune opération'
        )
      }
    }
  }
})

test('une famille à 0 partout n\'est pas écrite du tout', () => {
  const p = plan()
  const md = parcelle(p, 'F1- S5 MARAVILLA MD')
  // Service générale vaut 0 pour MARAVILLA MD et n'a aucune opération.
  assert.ok(!('Service générale' in md.budgets))
})

// ── Ignorés ─────────────────────────────────────────────────────────────────

test('opération absente du référentiel : ignorée, avec le nombre de valeurs perdues', () => {
  const p = plan()
  const chaulage = p.operations_ignorees.filter((o) => /Chaulage/.test(o.operation))[0]
  assert.ok(chaulage, 'Chaulage / Déchaulage doit être signalée')
  assert.strictEqual(chaulage.famille, 'Entretien structure')
  assert.strictEqual(chaulage.valeurs_non_nulles, 0, '0 partout → aucune perte')
  const aide = p.operations_ignorees.filter((o) => o.operation === 'Aide caporal')[0]
  assert.ok(aide, 'Aide caporal (absente du référentiel) doit être signalée')
})

test('les 3 opérations manquantes de Service générale sont proposées à la création', () => {
  const p = plan()
  assert.deepStrictEqual(
    p.referentiel_a_creer.map((o) => o.operation).sort(),
    ['Aide caporal', 'Caporal', 'Nettoyage ferme']
  )
  for (const o of p.referentiel_a_creer) {
    assert.strictEqual(o.code, 'GB11')
    assert.strictEqual(o.famille, 'Service générale')
  }
})

test('une opération déjà présente au référentiel n\'est plus proposée (idempotence)', () => {
  const p = lib.buildImportPlan({
    budgetRows: fixtureRows(),
    referentiel: REFERENTIEL.concat([
      { code: 'GB11', groupe: 'M.O Service générale', famille: 'Service générale', operation: 'Aide caporal' },
    ]),
    campagne: '2026-2027',
  })
  assert.deepStrictEqual(
    p.referentiel_a_creer.map((o) => o.operation).sort(),
    ['Caporal', 'Nettoyage ferme']
  )
})

test('aucune suppression n\'est jamais planifiée sur le référentiel', () => {
  const p = plan()
  assert.ok(!('referentiel_a_supprimer' in p), 'le plan ne doit comporter aucune suppression')
})

// ── Contrôle de cohérence ───────────────────────────────────────────────────

test('le total du plan est rapproché du total général du fichier', () => {
  const p = plan()
  const mia = parcelle(p, 'F5- MYA S9')
  // 8 (sol) + 5 (ferti) + 10 (entretien) + 18 (récolte) + 2 (service) = 43.
  assert.strictEqual(mia.total_jh_ha, 43)
  assert.strictEqual(mia.total_fichier, 43)
  assert.strictEqual(mia.ecart_total, 0)
})

test('un écart entre somme des opérations et total de famille est signalé, pas masqué', () => {
  const rows = fixtureRows()
  rows[4][3] = 99 // total « TRAVAUX DU SOL » incohérent avec 6 + 2
  const p = lib.buildImportPlan({ budgetRows: rows, referentiel: REFERENTIEL, campagne: '2026-2027' })
  const fam = parcelle(p, 'F5- MYA S9').familles.filter((f) => f.famille === 'Travaux du sol')[0]
  assert.strictEqual(fam.total, 8, 'le détail par opération reste autoritaire')
  assert.strictEqual(fam.total_fichier, 99)
  assert.strictEqual(fam.ecart, -91)
})

// ── Payload / idempotence ───────────────────────────────────────────────────

test('buildSavePayload produit exactement le body de campagne-budget-save', () => {
  const p = plan()
  const mia = parcelle(p, 'F5- MYA S9')
  const payload = lib.buildSavePayload(p, mia)
  assert.deepStrictEqual(Object.keys(payload).sort(), [
    'budgets',
    'budgets_operations',
    'campagne',
    'label_bee_one',
  ])
  assert.strictEqual(payload.campagne, '2026-2027')
  assert.strictEqual(payload.label_bee_one, 'F5- MYA S9')
})

test('idempotence : deux exécutions produisent des payloads identiques', () => {
  const a = plan()
  const b = plan()
  assert.deepStrictEqual(
    a.parcelles.map((p) => lib.buildSavePayload(a, p)),
    b.parcelles.map((p) => lib.buildSavePayload(b, p))
  )
})

// ── Rapport ─────────────────────────────────────────────────────────────────

test('le rapport de dry-run cite chaque parcelle, ses totaux et les ignorés', () => {
  const p = plan()
  const txt = lib.formatDryRunReport(p, { verbose: true }).join('\n')
  assert.match(txt, /F5- MYA S9/)
  assert.match(txt, /F5 YAZMIN MT/)
  assert.match(txt, /F1- S5 MARAVILLA MD/)
  assert.match(txt, /\[famille\] {4}Récolte = 18 JH\/Ha/)
  assert.match(txt, /\[opérations\] Travaux du sol = 8 JH\/Ha sur 2 opération\(s\)/)
  assert.match(txt, /GB01::Grattage = 2 {3}\(fichier : « Grattage,Nvlm »\)/)
  assert.match(txt, /PARCELLE INCONNUE .*hors mapping/)
  assert.match(txt, /Chaulage \/ Déchaulage .*aucune valeur > 0/)
  assert.match(txt, /\+ GB11 · Service générale · Caporal/)
})

// ── Arguments du script ─────────────────────────────────────────────────────

test('le script est en dry-run par défaut et exige un chemin de fichier', () => {
  const shell = require('../../scripts/import-budget-campagne')
  const sans = shell.parseArgs([])
  assert.strictEqual(sans.ok, false)
  const avec = shell.parseArgs(['/tmp/budget.xlsx'])
  assert.strictEqual(avec.ok, true)
  assert.strictEqual(avec.options.apply, false, 'DRY-RUN par défaut')
  assert.strictEqual(avec.options.budget, '/tmp/budget.xlsx')
  const applique = shell.parseArgs(['/tmp/budget.xlsx', '--apply', '--campagne', '2027-2028'])
  assert.strictEqual(applique.options.apply, true)
  assert.strictEqual(applique.options.campagne, '2027-2028')
  assert.strictEqual(shell.parseArgs(['/tmp/b.xlsx', '--oups']).ok, false)
})
