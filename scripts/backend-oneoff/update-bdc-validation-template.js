/**
 * Synchronise sur Meta les templates de validation BDC (variante texte OK/NON,
 * voir notificationDispatcher.js) :
 *   - bdc_validation_needed       (texte)            → édité si présent, créé sinon
 *   - bdc_validation_needed_doc   (header DOCUMENT)  → édité si présent, créé sinon
 *
 * Le BODY porte la consigne « Répondez OK pour valider, NON pour rejeter ».
 *
 * Le token et le WABA ID sont lus depuis le doc Firestore `config/whatsapp`
 * (déjà enregistré). Surchargeables via variables d'env.
 *
 * Usage:
 *   node update-bdc-validation-template.js              # token depuis Firestore
 *   node update-bdc-validation-template.js --dry-run    # n'envoie rien, affiche le diff
 *   WA_TOKEN="EAA..." node update-bdc-validation-template.js   # override token
 *
 * Variables d'environnement (optionnelles) :
 *   WA_TOKEN              Access Token Meta (sinon: config/whatsapp.access_token)
 *   WA_WABA_ID           WABA ID (sinon: config/whatsapp.waba_id, défaut 1435674314903560)
 *   WA_SAMPLE_PDF_HANDLE Header handle pour le sample DOCUMENT (création _doc).
 *                        Optionnel : si absent, le script upload lui-même un PDF
 *                        sample via l'API resumable upload pour obtenir le handle.
 *
 * IMPORTANT : édition ou création repasse le template en PENDING jusqu'à
 * approbation Meta (15-60 min). Pour l'édition, les composants existants
 * (header, boutons) sont PRÉSERVÉS — seul le texte du BODY est remplacé.
 */

'use strict'

const { db } = require('../../functions/config/firebase')

const DRY_RUN = process.argv.includes('--dry-run')

// Spécifs des templates, à garder synchronisées avec create-whatsapp-templates.js
const TEMPLATES = [
  {
    // v2 : l'ancien "bdc_validation_needed" a été supprimé (Meta limite à 1 edit/24h
    // et bloque la recréation du même nom 4 semaines) → nouveau nom.
    name: 'bdc_validation_needed_v2',
    body: "Bonjour, BDC {{1}} en attente de votre validation.\nFournisseur : {{2}}\nMontant : {{3}}\nArticles : {{4}}\n\nRépondez *OK* pour valider, *NON* pour rejeter.",
    example: ['BDC-2026-0042', 'AGRIDATA', '45000 MAD', 'Engrais NPK ×100 kg, Topas ×20 L'],
  },
  {
    name: 'bdc_validation_needed_doc',
    body: "Bonjour, BDC {{1}} en attente de votre validation.\nFournisseur : {{2}}\nMontant : {{3}}\nArticles : {{4}}\nPDF en pièce jointe.\n\nRépondez *OK* pour valider, *NON* pour rejeter.",
    example: ['BDC-2026-0042', 'AGRIDATA', '45000 MAD', 'Engrais NPK ×100 kg, Topas ×20 L'],
    headerType: 'DOCUMENT',
  },
  {
    // Étape chef → DG (cf. functions/bdcValidationService.js), même consigne OK/NON.
    name: 'bdc_chef_approved_doc',
    body: 'Le BDC {{1}} a été approuvé par le Chef. En attente de votre validation DG.\nPDF en pièce jointe.\n\nRépondez *OK* pour valider, *NON* pour rejeter.',
    example: ['BDC-2026-0042'],
    headerType: 'DOCUMENT',
  },
]

const LANG = 'fr'

async function resolveConfig() {
  let token = process.env.WA_TOKEN
  let wabaId = process.env.WA_WABA_ID
  if (!token || !wabaId) {
    const doc = await db.collection('config').doc('whatsapp').get()
    const cfg = doc.exists ? doc.data() : {}
    token = token || cfg.access_token
    wabaId = wabaId || cfg.waba_id || '1435674314903560'
  }
  if (!token) {
    throw new Error('Aucun access_token : ni WA_TOKEN, ni config/whatsapp.access_token')
  }
  return { token, wabaId }
}

/** Résout l'App ID propriétaire du token (nécessaire pour l'upload resumable). */
async function resolveAppId(token) {
  const r = await fetch(
    `https://graph.facebook.com/v22.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
  )
  const data = await r.json()
  const appId = (data.data || data).app_id
  if (!appId) throw new Error('App ID introuvable via debug_token')
  return appId
}

/**
 * Upload un PDF sample via l'API resumable upload et renvoie le header_handle.
 * Mis en cache pour ne pas réuploader entre plusieurs templates DOCUMENT.
 */
let _sampleHandle = null
async function getSamplePdfHandle(token) {
  if (process.env.WA_SAMPLE_PDF_HANDLE) return process.env.WA_SAMPLE_PDF_HANDLE
  if (_sampleHandle) return _sampleHandle

  const pdf = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<<>>>>endobj\n' +
      'trailer<</Root 1 0 R/Size 4>>\n' +
      '%%EOF\n',
    'latin1'
  )

  const appId = await resolveAppId(token)
  const startUrl = `https://graph.facebook.com/v22.0/${appId}/uploads?file_name=BDC_sample.pdf&file_length=${pdf.length}&file_type=application%2Fpdf`
  const s = await fetch(startUrl, { method: 'POST', headers: { Authorization: `OAuth ${token}` } })
  const sData = await s.json()
  if (!s.ok || !sData.id) throw new Error(`upload start: ${JSON.stringify(sData.error || sData)}`)

  const u = await fetch(`https://graph.facebook.com/v22.0/${sData.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: pdf,
  })
  const uData = await u.json()
  if (!u.ok || !uData.h) throw new Error(`upload bytes: ${JSON.stringify(uData.error || uData)}`)

  _sampleHandle = uData.h
  return _sampleHandle
}

async function listTemplates(token, wabaId) {
  const r = await fetch(
    `https://graph.facebook.com/v22.0/${wabaId}/message_templates?fields=id,name,status,language,components&limit=200`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(data))
  return data.data || []
}

/**
 * Remplace texte + example du BODY (l'example doit matcher le nombre de {{n}}),
 * en préservant les autres composants (header, boutons).
 */
function editedComponents(existing, spec) {
  const components = (existing.components || []).map((c) =>
    c.type === 'BODY' ? { ...c, text: spec.body, example: { body_text: [spec.example] } } : c
  )
  if (!components.some((c) => c.type === 'BODY')) {
    components.push({ type: 'BODY', text: spec.body, example: { body_text: [spec.example] } })
  }
  return components
}

/** Composants pour une création neuve depuis la spec locale. */
async function createComponents(token, spec) {
  const components = []
  if (spec.headerType === 'DOCUMENT') {
    // Meta exige un sample handle pour un header média : on le fournit (env ou upload auto).
    const handle = DRY_RUN
      ? (process.env.WA_SAMPLE_PDF_HANDLE || '<sample-handle-uploadé-au-run>')
      : await getSamplePdfHandle(token)
    components.push({ type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [handle] } })
  }
  components.push({
    type: 'BODY',
    text: spec.body,
    example: { body_text: [spec.example] },
  })
  return components
}

async function editTemplate(token, existing, spec) {
  const bodyComp = (existing.components || []).find((c) => c.type === 'BODY')
  if (bodyComp && bodyComp.text === spec.body) {
    return { action: 'skip' }
  }
  const components = editedComponents(existing, spec)
  if (DRY_RUN) return { action: 'edit', dryRun: true, components }
  const r = await fetch(`https://graph.facebook.com/v22.0/${existing.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ components }),
  })
  const data = await r.json()
  if (!r.ok) return { action: 'edit', error: data.error?.message || JSON.stringify(data) }
  return { action: 'edit', data }
}

async function createTemplate(token, wabaId, spec) {
  const components = await createComponents(token, spec)
  if (DRY_RUN) return { action: 'create', dryRun: true, components }
  const payload = { name: spec.name, language: LANG, category: 'UTILITY', components }
  const r = await fetch(`https://graph.facebook.com/v22.0/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json()
  if (!r.ok) return { action: 'create', error: data.error?.message || JSON.stringify(data) }
  return { action: 'create', data }
}

;(async () => {
  console.log(`\n📝 Sync templates validation BDC${DRY_RUN ? ' (DRY-RUN)' : ''}\n`)

  const { token, wabaId } = await resolveConfig()
  console.log(`   WABA ${wabaId}\n`)

  const all = await listTemplates(token, wabaId)
  const stats = { created: 0, edited: 0, skipped: 0, failed: 0 }

  for (const spec of TEMPLATES) {
    const matches = all.filter((t) => t.name === spec.name)
    process.stdout.write(`  ▸ ${spec.name.padEnd(28)} `)

    let res
    if (matches.length === 0) {
      res = await createTemplate(token, wabaId, spec)
    } else {
      // édite toutes les versions de langue présentes
      res = await editTemplate(token, matches[0], spec)
      for (const extra of matches.slice(1)) {
        await editTemplate(token, extra, spec)
      }
    }

    if (res.action === 'skip') {
      console.log('⏭️  Déjà à jour')
      stats.skipped++
    } else if (res.dryRun) {
      console.log(`🔍 DRY-RUN — ${res.action === 'create' ? 'CRÉATION' : 'ÉDITION'} :`)
      console.log(JSON.stringify(res.components, null, 2))
      res.action === 'create' ? stats.created++ : stats.edited++
    } else if (res.error) {
      console.log(`❌ ${res.error}`)
      stats.failed++
    } else if (res.action === 'create') {
      console.log('✅ Créé (PENDING)')
      stats.created++
    } else {
      console.log('✅ Édité (PENDING)')
      stats.edited++
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`\n📊 Résumé :`)
  console.log(`   ✅ Créés : ${stats.created}`)
  console.log(`   ✅ Édités : ${stats.edited}`)
  console.log(`   ⏭️  Déjà à jour : ${stats.skipped}`)
  console.log(`   ❌ Échoués : ${stats.failed}`)
  if (!DRY_RUN && (stats.created + stats.edited) > 0) {
    console.log(`\n⏱️  Approbation Meta : 15-60 min. Statut :`)
    console.log(`   https://business.facebook.com/wa/manage/message-templates`)
  }
  process.exit(stats.failed > 0 ? 1 : 0)
})().catch((err) => {
  console.error('❌ Erreur :', err.message)
  process.exit(1)
})
