'use strict'
// @ts-check

/**
 * Qualifie chaque fiche de `referentiel_taches` avec sa CLASSE DE RYTHME —
 * `classe_rythme` ∈ continu | saisonnier | recolte.
 *
 * DRY-RUN PAR DÉFAUT. Sans `--apply`, rien n'est écrit nulle part.
 *
 * USAGE
 *   node scripts/set-classe-rythme.js            # simulation + rapport
 *   node scripts/set-classe-rythme.js --verbose  # détaille fiche par fiche
 *   node scripts/set-classe-rythme.js --apply    # ÉCRIT (à ne lancer qu'après GO)
 *   node scripts/set-classe-rythme.js --apply --force   # + les RECLASSEMENTS
 *
 * Sans `--force`, seules les fiches SANS classe sont écrites. Une fiche portant
 * déjà une classe DIFFÉRENTE est listée dans le rapport mais laissée telle
 * quelle : écraser une classification posée à la main est une décision, pas un
 * effet de bord d'un import.
 *
 * ── À QUOI SERT CE CHAMP ─────────────────────────────────────────────────────
 * La grille Campagne projette un « reste au rythme » = moyenne des dernières
 * quinzaines × quinzaines restantes. Cette projection n'a de sens que sur un
 * poste CONTINU. Sur un poste saisonnier non démarré elle vaudrait 0, soit
 * « plus rien à consommer » sur un budget entier restant à dépenser : l'exact
 * inverse de la vérité. D'où trois classes, au grain OPÉRATION (une famille est
 * souvent mixte : GB02 contient l'irrigation, continue, ET l'installation GAG,
 * saisonnière) :
 *   continu    → projeté au rythme
 *   saisonnier → reste au rythme = reste budgété
 *   recolte    → jamais projeté (« — » à l'écran)
 * Une fiche SANS classe reste sans projection : le défaut est posé ICI,
 * explicitement, jamais deviné à l'affichage.
 *
 * ── ÉCRITURE (--apply) ───────────────────────────────────────────────────────
 * firebase-admin (ADC), comme scripts/seeds/import-referentiel-taches.js.
 * ⚠️ EXCEPTION ASSUMÉE, identique à celle de scripts/import-budget-campagne.js :
 * il n'existe AUCUNE Cloud Function d'écriture sur `referentiel_taches`, la
 * collection est peuplée par un seed admin. Créer une action dédiée serait hors
 * périmètre. Le script n'écrit QUE le champ `classe_rythme` (update ciblé,
 * jamais un `set` complet), ne crée aucune fiche, n'en supprime aucune.
 */

const path = require('path')

const PROJECT_DIR = path.resolve(__dirname, '..')
// Même normalisation de libellé que le pivot et que la grille : une clé
// calculée autrement ne joindrait rien et le champ serait posé à côté.
const { opKey } = require(path.join(PROJECT_DIR, 'src/modules/shared/lib/analytiqueUtils.js'))

const CLASSES = { CONTINU: 'continu', SAISONNIER: 'saisonnier', RECOLTE: 'recolte' }

/** Toute la famille Récolte : le rythme de la cueillette suit la maturité des
 *  fruits, pas les deux derniers mois. Jamais de projection. */
const CODES_RECOLTE = ['GB08']

/**
 * Opérations CONTINUES, `CODE::Libellé` du référentiel. Liste VOLONTAIREMENT
 * COURTE : le défaut `saisonnier` est conservateur (il projette le budget
 * restant, pas un rythme extrapolé), alors qu'un `continu` posé à tort
 * extrapole un poste ponctuel sur toute la fin de campagne.
 *
 * ⚠️ Le CODE fait partie de la clé : « Nettoyage » existe sous GB05 (entretien
 * de structure, ponctuel) ET sous GB11 (ménage de ferme, permanent). Les deux
 * n'ont pas la même classe.
 */
const OPERATIONS_CONTINUES = [
  // GB02 — conduite quotidienne de l'irrigation (le reste de GB02 est de
  // l'installation ou de la remise en état : saisonnier).
  'GB02::Irrigation & fertigation',
  'GB02::Responsable irrigation',
  'GB02::Suivi EC et PH',
  'GB02::Entretien GAG',
  'GB02::Entretien réseau',
  'GB02::Entretien Bassin',
  // GB11 — postes permanents de la ferme, présents toutes les quinzaines.
  'GB11::Chef Caporal',
  'GB11::Gardiennage',
  'GB11::Pointeur Occ',
  'GB11::Agent de saisie Occ',
  'GB11::Magasinier Occ',
  'GB11::Technicien Occ',
  'GB11::Ménage',
  'GB11::Nettoyage',
  'GB11::Atelier',
  'GB11::Entretien bâtiments',
  'GB11::Entretien Espace Vert',
  'GB11::Entretien magasin',
]

/** Index `CODE::OPKEY` des opérations continues. */
function indexContinues(liste) {
  const out = {}
  ;(liste || OPERATIONS_CONTINUES).forEach((k) => {
    const i = String(k).indexOf('::')
    if (i < 0) return
    out[String(k).slice(0, i).trim().toUpperCase() + '::' + opKey(String(k).slice(i + 2))] = true
  })
  return out
}

/**
 * Classe cible d'une fiche. PURE.
 * @param {{code?: string, operation?: string}} fiche
 * @param {Object<string, boolean>} continues
 * @returns {string}
 */
function classeCible(fiche, continues) {
  const code = String((fiche && fiche.code) || '').trim().toUpperCase()
  if (CODES_RECOLTE.indexOf(code) >= 0) return CLASSES.RECOLTE
  if (continues[code + '::' + opKey((fiche && fiche.operation) || '')]) return CLASSES.CONTINU
  return CLASSES.SAISONNIER
}

/**
 * Plan d'écriture. PURE — aucun accès Firestore, c'est ce qui rend le dry-run
 * fiable et testable.
 *
 * @param {Array<{id?: string, code?: string, operation?: string, classe_rythme?: string}>} fiches
 * @param {Array<string>} [listeContinues]
 * @returns {{aEcrire: Array<Object>, inchangees: Array<Object>,
 *   ecrasees: Array<Object>, parClasse: Object<string, number>}}
 */
function planClasses(fiches, listeContinues) {
  const continues = indexContinues(listeContinues)
  const plan = { aEcrire: [], inchangees: [], ecrasees: [], parClasse: {} }
  ;(fiches || []).forEach((f) => {
    if (!f || !f.operation) return
    const cible = classeCible(f, continues)
    plan.parClasse[cible] = (plan.parClasse[cible] || 0) + 1
    const actuelle = String(f.classe_rythme == null ? '' : f.classe_rythme).trim().toLowerCase()
    const entree = { id: f.id, code: f.code, operation: f.operation, actuelle, cible }
    if (actuelle === cible) plan.inchangees.push(entree)
    else if (actuelle) plan.ecrasees.push(entree)   // valeur DIFFÉRENTE déjà posée
    else plan.aEcrire.push(entree)
  })
  return plan
}

/** Opérations continues attendues mais ABSENTES du référentiel : une entrée mal
 *  orthographiée ne produirait aucune erreur, juste un poste jamais projeté. */
function continuesIntrouvables(fiches, listeContinues) {
  const vues = {}
  ;(fiches || []).forEach((f) => {
    if (!f || !f.operation) return
    vues[String(f.code || '').trim().toUpperCase() + '::' + opKey(f.operation)] = true
  })
  return Object.keys(indexContinues(listeContinues)).filter((k) => !vues[k])
}

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.indexOf('--apply') >= 0
  const verbose = argv.indexOf('--verbose') >= 0
  const force = argv.indexOf('--force') >= 0
  const connues = ['--apply', '--verbose', '--force']
  const inconnu = argv.filter((a) => a.startsWith('--') && connues.indexOf(a) < 0)
  if (inconnu.length) {
    console.error('Option inconnue : ' + inconnu.join(', '))
    process.exit(1)
  }

  const admin = require(path.join(PROJECT_DIR, 'functions/node_modules/firebase-admin'))
  if (!admin.apps.length) admin.initializeApp({ projectId: 'berrygood-farms-dashboard' })
  const db = admin.firestore()

  const snap = await db.collection('referentiel_taches').get()
  const fiches = []
  snap.forEach((doc) => { fiches.push(Object.assign({ id: doc.id }, doc.data())) })

  const plan = planClasses(fiches)
  const orphelines = continuesIntrouvables(fiches)

  console.log(`\n${fiches.length} fiches lues dans referentiel_taches`)
  console.log('Répartition cible :',
    Object.keys(plan.parClasse).sort().map((c) => `${c}=${plan.parClasse[c]}`).join('  '))
  console.log(`À écrire : ${plan.aEcrire.length}   inchangées : ${plan.inchangees.length}`
    + `   valeurs DIFFÉRENTES déjà posées : ${plan.ecrasees.length}`)
  if (orphelines.length) {
    console.log('\n⚠️ Opérations continues introuvables dans le référentiel '
      + '(libellé à corriger, sinon ces postes ne seront JAMAIS projetés) :')
    orphelines.forEach((k) => console.log('   - ' + k))
  }
  if (plan.ecrasees.length) {
    console.log(`\n⚠️ ${plan.ecrasees.length} fiches portent DÉJÀ une classe DIFFÉRENTE de celle`
      + ' proposée. Une classification posée à la main se change sur décision, pas par'
      + ' effet de bord d\'un import : elles sont EXCLUES sauf --force.')
    plan.ecrasees.forEach((e) => console.log(`   - ${e.code} ${e.operation} : ${e.actuelle} → ${e.cible}`))
  }

  // Lot par défaut : uniquement les fiches SANS classe. `--force` y ajoute les
  // reclassements — jamais implicites, jamais silencieux.
  const aEcrire = force ? plan.aEcrire.concat(plan.ecrasees) : plan.aEcrire
  if (verbose) {
    console.log('\nDétail du lot :')
    aEcrire.forEach((e) => {
      console.log(`   ${e.cible.padEnd(11)} ${e.code} ${e.operation}`
        + (e.actuelle ? `   (écrase « ${e.actuelle} »)` : ''))
    })
  }

  if (!apply) {
    console.log(`\nDRY-RUN — rien n'a été écrit. ${aEcrire.length} fiches seraient mises à jour`
      + (force ? ' (dont ' + plan.ecrasees.length + ' reclassements, --force).' : '.'))
    if (!force && plan.ecrasees.length) {
      console.log(`  ${plan.ecrasees.length} reclassements EXCLUS — les inclure : ajouter --force.`)
    }
    console.log('Pour écrire réellement : node scripts/set-classe-rythme.js --apply')
    return
  }
  if (!aEcrire.length) {
    console.log('\nRien à écrire.')
    return
  }

  let ecrites = 0
  for (let i = 0; i < aEcrire.length; i += 400) {
    const chunk = aEcrire.slice(i, i + 400)
    const batch = db.batch()
    // `update` d'un SEUL champ : les autres champs de la fiche (code, famille,
    // operation, ordre) ne sont jamais réécrits, donc jamais perdus.
    chunk.forEach((e) => batch.update(db.collection('referentiel_taches').doc(e.id),
      { classe_rythme: e.cible }))
    await batch.commit()
    ecrites += chunk.length
    console.log(`  batch ${Math.floor(i / 400) + 1} : ${chunk.length} fiches (total ${ecrites})`)
  }
  console.log(`\n${ecrites} fiches mises à jour.`)
}

module.exports = {
  CLASSES,
  CODES_RECOLTE,
  OPERATIONS_CONTINUES,
  classeCible,
  planClasses,
  continuesIntrouvables,
}

if (require.main === module) {
  main().catch((e) => { console.error('ERREUR:', e); process.exit(1) })
}
