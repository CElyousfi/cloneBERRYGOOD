'use strict'

/**
 * fixSmagBareme.js — Lot 1 Paie, sous-tâche 1A.
 *
 * Retire l'entrée SMAG parasite 107,22 (dateFrom 2026-06-01) de
 * `app_settings/paie_baremes`. Cette entrée correspond à un barème illégal
 * (aucun décret ne fixe ce SMAG), apparue lors de l'investigation paie du
 * 1er quinzaine de juin. La conséquence est que juin+ repasse au SMAG légal
 * en vigueur : 97,44 (décret 2026-04-01).
 *
 * NO-DELETE : l'entrée n'est pas supprimée mais ARCHIVÉE dans un nouveau champ
 * `smagHistory_archive` (array, append) avec horodatage et raison.
 *
 * Usage :
 *   node scripts/fixSmagBareme.js --stamp lot1-smag            # DRY-RUN (défaut, n'écrit rien)
 *   node scripts/fixSmagBareme.js --stamp lot1-smag --apply    # écrit en prod (ADC requise)
 *
 * Le DRY-RUN affiche l'avant/après de smagHistory + le contenu prévu de
 * smagHistory_archive, SANS aucune écriture.
 *
 * --apply : BACKUP complet du doc AVANT write → docs/BACKUP-paie-baremes-<stamp>.json,
 * puis update (merge) du doc.
 *
 * Write VALIDÉ par le DG (Lot 1 1A).
 * Auth : Application Default Credentials (gcloud auth application-default login).
 */

const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')
if (!admin.apps.length) admin.initializeApp({ projectId: 'berrygood-farms-dashboard' })
const db = admin.firestore()

const APPLY = process.argv.includes('--apply')

function getArg(name, def) {
  const i = process.argv.indexOf(name)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return def
}

const STAMP = getArg('--stamp', 'lot1-smag')

// L'entrée parasite à retirer (identifiée par dateFrom).
const PARASITE_DATE_FROM = '2026-06-01'
const PARASITE_BRUT = 107.22
const ARCHIVE_REASON =
  'barème illégal (aucun décret), parasite — investigation paie 1Q juin'

const DOC_PATH = { collection: 'app_settings', doc: 'paie_baremes' }
const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'docs')

function fmtHistory(arr) {
  return JSON.stringify(arr, null, 2)
}

function isParasite(entry) {
  if (!entry || typeof entry !== 'object') return false
  return (
    entry.dateFrom === PARASITE_DATE_FROM &&
    Number(entry.smagBrutJournalier) === PARASITE_BRUT
  )
}

async function main() {
  console.log('=== fixSmagBareme — Lot 1 Paie 1A ===')
  console.log(`Mode      : ${APPLY ? 'APPLY (écriture)' : 'DRY-RUN (aucune écriture)'}`)
  console.log(`Stamp     : ${STAMP}`)
  console.log(`Doc       : ${DOC_PATH.collection}/${DOC_PATH.doc}`)
  console.log('')

  const ref = db.collection(DOC_PATH.collection).doc(DOC_PATH.doc)
  const snap = await ref.get()
  if (!snap.exists) {
    console.error('ERREUR : document app_settings/paie_baremes introuvable. STOP.')
    process.exit(1)
  }
  const data = snap.data()

  const currentHistory = Array.isArray(data.smagHistory) ? data.smagHistory : []
  console.log('--- smagHistory AVANT ---')
  console.log(fmtHistory(currentHistory))

  const parasites = currentHistory.filter(isParasite)
  const remaining = currentHistory.filter((e) => !isParasite(e))

  if (parasites.length === 0) {
    console.log('\nAucune entrée parasite trouvée (dateFrom=%s, brut=%s). Rien à faire.', PARASITE_DATE_FROM, PARASITE_BRUT)
    if (APPLY) {
      console.log('STOP : pas de write (idempotence).')
    }
    process.exit(0)
  }
  if (parasites.length > 1) {
    console.error('ERREUR : %d entrées parasites trouvées (attendu 1). STOP, vérification manuelle requise.', parasites.length)
    process.exit(1)
  }

  console.log('\n--- smagHistory APRÈS (entrées légales conservées) ---')
  console.log(fmtHistory(remaining))

  // Construction des entrées d'archive (append au champ existant s'il existe).
  const existingArchive = Array.isArray(data.smagHistory_archive)
    ? data.smagHistory_archive
    : []
  // serverTimestamp() est interdit DANS un élément d'array (arrayUnion / array set).
  // On utilise un Timestamp concret côté serveur (Timestamp.now()) à la place.
  const archivedAt = admin.firestore.Timestamp.now()
  const archiveEntriesToAdd = parasites.map((e) => ({
    ...e,
    archived_at: archivedAt,
    archived_reason: ARCHIVE_REASON,
  }))

  console.log('\n--- smagHistory_archive PRÉVU (append) ---')
  console.log(
    fmtHistory(
      parasites.map((e) => ({
        ...e,
        archived_at: '<Timestamp.now()>',
        archived_reason: ARCHIVE_REASON,
      }))
    )
  )
  console.log(`(archive existante : ${existingArchive.length} entrée(s) → total après : ${existingArchive.length + archiveEntriesToAdd.length})`)

  const updatedNote =
    'Retrait entrée SMAG parasite 107,22 (2026-06-01) archivée (no-delete) ; ' +
    'juin+ repasse au SMAG légal 97,44 (décret 2026-04-01). ' +
    '[lot1 1A] Précédent: ' +
    (data.updated_note || '')

  if (!APPLY) {
    console.log('\n[DRY-RUN] Aucune écriture effectuée. Passe --apply pour écrire (backup auto avant write).')
    process.exit(0)
  }

  // ----- APPLY -----
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const backupPath = path.join(BACKUP_DIR, `BACKUP-paie-baremes-${STAMP}.json`)
  const backupPayload = {
    backed_up_at: new Date().toISOString(),
    doc_path: `${DOC_PATH.collection}/${DOC_PATH.doc}`,
    stamp: STAMP,
    data, // doc complet AVANT write
  }
  // serializer pour les Timestamps Firestore
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      backupPayload,
      (k, v) => {
        if (v && typeof v === 'object' && typeof v.toDate === 'function') {
          return { __firestore_timestamp__: v.toDate().toISOString() }
        }
        return v
      },
      2
    )
  )
  console.log(`\n[BACKUP] Doc complet sauvegardé → ${backupPath}`)

  await ref.update({
    smagHistory: remaining,
    smagHistory_archive: admin.firestore.FieldValue.arrayUnion(...archiveEntriesToAdd),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_note: updatedNote,
  })

  console.log('[APPLY] Document mis à jour (merge update).')
  console.log('  smagHistory      : %d entrée(s)', remaining.length)
  console.log('  smagHistory_archive +%d entrée(s)', archiveEntriesToAdd.length)
  console.log('Terminé.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Erreur fixSmagBareme :', err)
  process.exit(1)
})
