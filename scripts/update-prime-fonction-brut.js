'use strict'
/**
 * update-prime-fonction-brut.js — remplace primeFonctionJournaliere (NET) par les
 * valeurs BRUT du fichier de référence dans ouvriers_registry.
 *
 * Contexte : les primes de fonction ont été peuplées avec les valeurs NET
 * (9.13, 24.13, 34.13…). On les remplace par les valeurs BRUT du fichier
 * "Liste des postes fixes et des primes de fonction fixes.xlsx" (Feuil1).
 *
 * Sécurité :
 *  - DRY-RUN par défaut (aucune écriture). Passer --commit pour écrire.
 *  - GATED : montrer le rapport dry-run à Omar AVANT --commit.
 *  - Ne touche QUE le champ primeFonctionJournaliere (merge). Aucun autre champ,
 *    aucune suppression de doc.
 *  - Backup complet de ouvriers_registry avant toute écriture.
 *
 * Matching matricule : numKey(m) = String(m).toUpperCase().replace(/[^0-9]/g, '')
 * (les lettres sont ignorées — même logique que app.jsx / paieUtils.js).
 *
 * Usage :
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/update-prime-fonction-brut.js [--commit]
 */

const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const admin = require('firebase-admin')

const COMMIT = process.argv.includes('--commit')
const FILE = path.join(__dirname, '..', 'Liste des postes fixes et des primes de fonction fixes.xlsx')
const SHEET = 'Feuil1'

const numKey = (m) => String(m == null ? '' : m).toUpperCase().replace(/[^0-9]/g, '')

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'berrygood-farms-dashboard' })
}
const db = admin.firestore()

function parseBrutFile() {
  if (!fs.existsSync(FILE)) {
    console.error(`Fichier introuvable : ${FILE}`)
    process.exit(1)
  }
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets[SHEET] || wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  // Localiser la ligne d'en-tête (col 0 === "MTR"), données après.
  const headerIdx = rows.findIndex((r) => String(r[0]).trim().toUpperCase() === 'MTR')
  if (headerIdx < 0) {
    console.error('En-tête "MTR" introuvable dans la feuille ' + SHEET)
    process.exit(1)
  }
  const dataRows = rows.slice(headerIdx + 1).filter((r) => String(r[0]).trim() !== '')
  const byKey = {}
  const skipped = []
  for (const r of dataRows) {
    const mtrRaw = r[0]
    const nom = String(r[1] || '').trim()
    const brut = parseFloat(r[2])
    const poste = String(r[3] || '').trim()
    const k = numKey(mtrRaw)
    if (!k || isNaN(brut)) { skipped.push({ mtrRaw, nom, brut: r[2] }); continue }
    // Si collision de numKey, on garde le premier et on signale.
    if (byKey[k] && byKey[k].brut !== brut) {
      console.warn(`⚠️  Collision numKey ${k} : ${byKey[k].brut} vs ${brut} (mtr "${mtrRaw}") — premier conservé`)
    }
    if (!byKey[k]) byKey[k] = { brut, nom, poste, mtrRaw: String(mtrRaw) }
  }
  return { byKey, skipped, count: dataRows.length }
}

async function main() {
  const { byKey, skipped, count } = parseBrutFile()
  const xlsxKeys = Object.keys(byKey)
  console.log(`=== Fichier BRUT : ${count} lignes de données, ${xlsxKeys.length} matricules (numKey) uniques ===`)
  if (skipped.length) console.log(`  ${skipped.length} ligne(s) ignorée(s) (MTR/brut vide) :`, JSON.stringify(skipped))
  const distinctBrut = [...new Set(xlsxKeys.map((k) => byKey[k].brut))].sort((a, b) => a - b)
  console.log('  Valeurs BRUT distinctes :', distinctBrut.join(', '))

  // Charger le registry, indexer par numKey
  const snap = await db.collection('ouvriers_registry').get()
  const regByKey = {}
  snap.forEach((d) => { const k = numKey(d.id); (regByKey[k] = regByKey[k] || []).push(d) })
  console.log(`=== ouvriers_registry : ${snap.size} docs ===`)

  const changes = []
  const noChange = []
  const unmatchedXlsx = []
  for (const k of xlsxKeys) {
    const info = byKey[k]
    const docs = regByKey[k]
    if (!docs || !docs.length) { unmatchedXlsx.push({ numKey: k, mtr: info.mtrRaw, nom: info.nom, brut: info.brut }); continue }
    for (const d of docs) {
      const cur = d.data().primeFonctionJournaliere
      if (typeof cur === 'number' && Math.abs(cur - info.brut) < 1e-6) {
        noChange.push({ docId: d.id, val: cur })
      } else {
        changes.push({ docId: d.id, numKey: k, nom: info.nom, poste: info.poste, old: cur === undefined ? '(absent)' : cur, new: info.brut })
      }
    }
  }

  console.log(`\n=== PLAN ===`)
  console.log(`  À modifier   : ${changes.length}`)
  console.log(`  Déjà à jour  : ${noChange.length}`)
  console.log(`  Matricules du xlsx ABSENTS du registry : ${unmatchedXlsx.length}`)
  console.log(`\n--- Modifications (matricule | ancien → nouveau | poste | nom) ---`)
  changes.forEach((c) => console.log(`  ${c.docId.padEnd(10)} | ${String(c.old).padStart(10)} → ${String(c.new).padStart(11)} | ${(c.poste || '').padEnd(22)} | ${c.nom}`))
  if (unmatchedXlsx.length) {
    console.log(`\n--- Matricules xlsx absents du registry (NON écrits) ---`)
    unmatchedXlsx.forEach((u) => console.log(`  numKey=${u.numKey} mtr="${u.mtr}" brut=${u.brut} ${u.nom}`))
  }

  if (!COMMIT) {
    console.log(`\n*** DRY RUN — aucune écriture. Relancer avec --commit après GO Omar. ***`)
    process.exit(0)
  }

  // Backup avant écriture
  const backupDir = path.join('/tmp', 'ouvriers_registry-backup-' + Date.now())
  fs.mkdirSync(backupDir, { recursive: true })
  const all = []
  snap.forEach((d) => all.push({ _id: d.id, ...d.data() }))
  fs.writeFileSync(path.join(backupDir, 'ouvriers_registry.json'), JSON.stringify(all))
  console.log(`\nBackup : ${backupDir}/ouvriers_registry.json (${all.length} docs)`)

  // Écriture : merge UNIQUEMENT primeFonctionJournaliere
  let written = 0
  for (let i = 0; i < changes.length; i += 400) {
    const batch = db.batch()
    for (const c of changes.slice(i, i + 400)) {
      batch.set(db.collection('ouvriers_registry').doc(c.docId), { primeFonctionJournaliere: c.new }, { merge: true })
    }
    await batch.commit()
    written += Math.min(400, changes.length - i)
  }
  console.log(`✅ Écrit : ${written} docs (primeFonctionJournaliere = BRUT, merge).`)
  changes.forEach((c) => console.log(`  [maj] ${c.docId} : ${c.old} → ${c.new}`))
  process.exit(0)
}

main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1) })
