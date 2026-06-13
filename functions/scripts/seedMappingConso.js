'use strict'

/**
 * seedMappingConso.js — Seed des collections du module « Mapping parcelles de
 * consommation » pour la campagne 2025-2026.
 *
 * Écrit DEUX collections (idempotent, set merge:true) :
 *   - parcelles_consommation  (docId = id)            : référentiel magasinier
 *   - mapping_campagne        (docId = `${campagne}__${id}`) : le lien versionné
 *
 * `pointages` N'EST PAS écrit (agrégat calculé depuis stock_movements).
 *
 * Usage :
 *   node scripts/seedMappingConso.js            # DRY-RUN par défaut (n'écrit rien)
 *   node scripts/seedMappingConso.js --commit   # écrit en prod (ADC requise)
 *
 * GATED : l'écriture prod (--commit) requiert le GO explicite d'Omar.
 * Auth : Application Default Credentials (gcloud auth application-default login).
 */

const admin = require('firebase-admin')
if (!admin.apps.length) admin.initializeApp({ projectId: 'berrygood-farms-dashboard' })
const db = admin.firestore()

const {
  SEED_2025_2026,
  parcellesConsommation,
  mappingCampagne,
} = require('../lib/mappingConso/seed.js')

const COMMIT = process.argv.includes('--commit')

async function main() {
  console.log(`Seed mapping conso — campagne ${SEED_2025_2026.campagne}`)
  console.log(`  parcelles_consommation : ${parcellesConsommation.length} docs`)
  console.log(`  mapping_campagne       : ${mappingCampagne.length} docs`)
  console.log(`  avocatier (info card)  : ${SEED_2025_2026.avocatierParFerme.length} fermes (non écrites)`)

  const statuts = mappingCampagne.reduce((acc, m) => {
    acc[m.statut] = (acc[m.statut] || 0) + 1
    return acc
  }, {})
  console.log('  répartition statuts    :', JSON.stringify(statuts))

  if (!COMMIT) {
    console.log('\n[DRY-RUN] Aucune écriture. Passe --commit pour écrire en prod (GO Omar requis).')
    console.log('\nExemple parcelles_consommation[0] :')
    console.log(JSON.stringify(parcellesConsommation[0], null, 2))
    console.log('\nExemple mapping_campagne[0] :')
    console.log(JSON.stringify(mappingCampagne[0], null, 2))
    return
  }

  console.log('\n[COMMIT] Écriture Firestore (merge:true)…')

  let batch = db.batch()
  let ops = 0
  const flush = async () => {
    if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0 }
  }

  for (const p of parcellesConsommation) {
    batch.set(db.collection('parcelles_consommation').doc(p.id), p, { merge: true })
    ops++
    if (ops >= 400) await flush()
  }
  for (const m of mappingCampagne) {
    const { docId, ...data } = m
    batch.set(db.collection('mapping_campagne').doc(docId), data, { merge: true })
    ops++
    if (ops >= 400) await flush()
  }
  await flush()

  console.log(`  écrit : ${parcellesConsommation.length} parcelles_consommation + ${mappingCampagne.length} mapping_campagne`)
  console.log('Terminé.')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Erreur seed mapping conso :', err)
  process.exit(1)
})
