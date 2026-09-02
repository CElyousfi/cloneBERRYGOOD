'use strict'
// @ts-check

/**
 * RÉUNION DES SOLDES FRAGMENTÉS — un article, un lieu, UN seul solde.
 *
 * ── CE QU'IL RÉPARE ───────────────────────────────────────────────────────
 * Des articles portent, en production, DEUX documents `stock_balances` au même
 * lieu : l'un rangé sous leur NOM (« Acide Phosphorique » = −411,85), l'autre
 * sous le docId de leur fiche (« Ref-Eng0052 » = −59,80). Aucune quantité n'est
 * perdue — la somme est juste — mais l'inventaire affiche deux lignes et tout
 * écran qui lit l'une des deux affiche un solde faux.
 *
 * ── LA MESURE BOUGE : NE PAS SE FIER À UN CHIFFRE FIGÉ ─────────────────────
 *   2026-08-30 : 29 cas,  58 documents, tous à exactement 2 fragments.
 *   2026-08-31 : 47 cas,  95 documents — dont UN à 3 fragments, et 3 cas
 *                bloqués sur des unités divergentes (0 la veille).
 * +18 cas en une journée : la fragmentation n'est pas un stock figé à écouler,
 * elle est ALIMENTÉE en continu par les écritures courantes. Relancer le
 * rapport juste avant toute exécution ; un plan de la veille est périmé.
 *
 * ⚠️ CE N'EST PAS LA CAUSE DES SOLDES NÉGATIFS : les fragments sont négatifs et
 * leur somme reste négative (44 cas sur 47 au 2026-08-31). Ce script ne corrige
 * aucun signe, il ne fait que réunir.
 *
 * ── DEUX TEMPS, LECTURE SEULE PAR DÉFAUT ──────────────────────────────────
 *   node scripts/reunir-soldes-fragmentes.js               # --report (défaut)
 *   node scripts/reunir-soldes-fragmentes.js --report
 *   REUNION_EXECUTE_CONFIRM=OUI node scripts/…js --execute # ÉCRIT
 *
 * Sans `--execute`, AUCUNE écriture : le mode rapport n'ouvre pas une seule
 * transaction. DOUBLE VERROU : `--execute` sans `REUNION_EXECUTE_CONFIRM=OUI`
 * est REFUSÉ (sortie 2) — ce script supprime des documents de solde.
 * Options : `--json <fichier>` (rapport machine), `--limit <n>`,
 * `--backup <fichier>` (défaut : `docs/BACKUP-soldes-fragmentes-<date>.json`,
 * écrit dans les DEUX modes, avant toute écriture).
 *
 * ── RÈGLE DE CONSERVATION ─────────────────────────────────────────────────
 * On garde le document que la FUSION CORRIGÉE viserait désormais — la règle
 * pure est partagée (`functions/lib/stockMerge/soldesMaster.choisirSoldeCible`),
 * pour que réparation et fusion ne puissent pas diverger :
 *   1. le solde dont `article_ref` EST le docId de la fiche active ;
 *   2. sinon celui dont le docId est l'identifiant canonique ;
 *   3. sinon le plus petit docId (déterministe).
 * Vérifiée sur les 29 cas réels : chacun a EXACTEMENT un document au docId de
 * la fiche active (0 sans, 0 avec plusieurs) — la règle 1 tranche partout.
 *
 * ── ARRÊT À LA PREMIÈRE ANOMALIE ──────────────────────────────────────────
 * Un cas dont les fragments portent des UNITÉS DIFFÉRENTES (l vs kg) n'est
 * JAMAIS exécuté : sommer des litres et des kilos fabriquerait un chiffre faux,
 * pire que deux lignes. Il est listé « à trancher à la main ».
 * Pendant l'exécution, chaque cas est traité dans UNE transaction qui relit les
 * soldes : si un document a bougé depuis le rapport (validation de mouvement
 * concurrente) ou a disparu, le cas échoue et le script S'ARRÊTE net. Les cas
 * déjà réunis gardent chacun leur journal.
 *
 * ── JOURNAL D'AUDIT / RETOUR EN ARRIÈRE ───────────────────────────────────
 * Chaque cas exécuté écrit, DANS LA MÊME TRANSACTION, un document
 * `stock_balance_reunions` contenant l'état AVANT de chaque fragment (docId,
 * article_ref, lieu, balance, unite), le document conservé, l'incrément
 * appliqué et le total attendu. Revenir en arrière = recréer les documents
 * supprimés avec leur balance d'avant et décrémenter le conservé du même
 * incrément.
 *
 * ── ACCÈS ─────────────────────────────────────────────────────────────────
 * Admin SDK via ADC (`gcloud auth application-default login`), comme
 * `scripts/reconstruct-stock.js` : il n'existe pas d'action Cloud Function de
 * réparation d'inventaire, et en créer une exposerait une capacité de
 * suppression de soldes à tout appelant authentifié. Ce script reste un outil
 * d'administration, lancé à la main, jamais appelé par l'application.
 * GATED : l'exécution ne se lance qu'après lecture du rapport par Omar.
 */

const fs = require('fs')
const path = require('path')

const reunionSoldes = require(path.resolve(__dirname, '../functions/lib/stockMerge/reunionSoldes'))

/**
 * Accès Firestore, résolu À LA DEMANDE : `require`r la config initialise
 * l'Admin SDK et cherche des identifiants. Le faire au chargement rendrait le
 * fichier intestable et ferait dépendre un simple `--help` d'une session ADC.
 * @type {*}
 */
let _fb = null
function firebase() {
  if (!_fb) _fb = require(path.resolve(__dirname, '../functions/config/firebase'))
  return _fb
}

/**
 * @param {string[]} argv
 * @param {Record<string,string|undefined>} [env]
 * @returns {{mode: ('report'|'execute'), limit: (number|null), json: (string|null),
 *            refus: boolean, backup: (string|null)}}
 */
function parseArgs(argv, env) {
  const args = argv.slice(2)
  const get = (flag) => {
    const i = args.indexOf(flag)
    return i > -1 && args[i + 1] ? args[i + 1] : null
  }
  const limitRaw = get('--limit')
  // DOUBLE VERROU, identique à scripts/fusion-doublons-articles.js. Ce script
  // SUPPRIME des documents de solde : le flag CLI seul ne suffit pas. Une
  // réparation d'inventaire ne doit jamais partir d'une ligne d'historique
  // shell rejouée par réflexe.
  const demandeExecute = args.includes('--execute')
  const confirme = (env || {}).REUNION_EXECUTE_CONFIRM === 'OUI'
  return {
    mode: demandeExecute && confirme ? 'execute' : 'report',
    refus: demandeExecute && !confirme,
    limit: limitRaw && /^\d+$/.test(limitRaw) ? parseInt(limitRaw, 10) : null,
    json: get('--json'),
    backup: get('--backup'),
  }
}

/**
 * Lit une collection entière (l'Admin SDK pagine seul).
 * @param {string} nom @param {*} [fb] accès Firestore injectable.
 * @returns {Promise<Array<*>>}
 */
async function lireCollection(nom, fb) {
  const snap = await (fb || firebase()).db.collection(nom).get()
  return snap.docs.map((d) => Object.assign({ docId: d.id, id: d.id }, d.data()))
}

/** @param {number} n @returns {string} */
function fmt(n) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '—'
}

/**
 * Rend le rapport texte d'un cas.
 * @param {*} c @returns {string[]}
 */
function rendreCas(c) {
  const L = []
  L.push('')
  L.push('── ' + c.article_nom + '  @ ' + c.lieu_type + '/' + c.lieu_id + '   (fiche ' + c.article_id + ')')
  for (const d of c.docs) {
    const marque = String(d.docId) === c.conserve ? 'CONSERVÉ ' : 'absorbé  '
    L.push(
      '   ' + marque + d.docId + '   article_ref=« ' + d.article_ref + ' »   ' +
      fmt(Number(d.balance)) + ' ' + (d.unite || '')
    )
  }
  L.push('   somme réunie : ' + fmt(c.total) + '   (incrément appliqué au conservé : ' + fmt(reunionSoldes.incrementConserve(c)) + ')')
  for (const a of c.anomalies) L.push('   ⛔ NON EXÉCUTÉ — ' + a)
  return L
}

/**
 * Réunit UN cas, dans une transaction, avec son journal d'audit.
 * Fail-loud : tout écart avec le plan (document disparu, solde modifié depuis
 * la lecture) fait échouer la transaction sans rien écrire.
 * @param {*} c @param {*} [fb] accès Firestore ({db, admin}) — injectable pour les tests.
 * @returns {Promise<string>} id du document d'audit
 */
async function reunirUnCas(c, fb) {
  const { db, admin } = fb || firebase()
  const auditRef = db.collection('stock_balance_reunions').doc()
  const increment = reunionSoldes.incrementConserve(c)
  await db.runTransaction(async (t) => {
    const refs = c.docs.map((d) => db.collection('stock_balances').doc(String(d.docId)))
    const snaps = await t.getAll(...refs)
    const avant = []
    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i]
      const attendu = c.docs[i]
      if (!s.exists) throw new Error('le solde ' + attendu.docId + ' a disparu depuis le rapport')
      const data = s.data()
      const balance = Number(data.balance) || 0
      if (Math.round(balance * 100) !== Math.round((Number(attendu.balance) || 0) * 100)) {
        throw new Error(
          'le solde ' + attendu.docId + ' a changé depuis le rapport (' +
            fmt(Number(attendu.balance)) + ' -> ' + fmt(balance) + ') — relancer --report'
        )
      }
      avant.push({
        docId: String(attendu.docId),
        article_ref: data.article_ref == null ? '' : String(data.article_ref),
        article_nom: data.article_nom == null ? '' : String(data.article_nom),
        lieu_type: data.lieu_type == null ? '' : String(data.lieu_type),
        lieu_id: data.lieu_id == null ? '' : String(data.lieu_id),
        balance,
        unite: data.unite == null ? '' : String(data.unite),
      })
    }
    // Journal AVANT mutation, dans la même transaction : pas de suppression
    // sans sa trace de retour en arrière.
    t.set(auditRef, {
      at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'scripts/reunir-soldes-fragmentes.js',
      article_id: c.article_id,
      article_nom: c.article_nom,
      lieu_type: c.lieu_type,
      lieu_id: c.lieu_id,
      conserve: c.conserve,
      supprimes: c.supprimes,
      increment_applique: increment,
      total_attendu: c.total,
      soldes_avant: avant,
    })
    // Incrément RELATIF (jamais une valeur absolue) : une validation de
    // mouvement concurrente sur le document conservé n'est pas écrasée.
    t.set(
      db.collection('stock_balances').doc(c.conserve),
      {
        balance: admin.firestore.FieldValue.increment(increment),
        updated_at: Date.now(),
      },
      { merge: true }
    )
    for (const docId of c.supprimes) {
      t.delete(db.collection('stock_balances').doc(String(docId)))
    }
  })
  return auditRef.id
}

/**
 * Exécute le plan, cas par cas, en S'ARRÊTANT à la première anomalie.
 * @param {Array<*>} cas @param {*} [fb] accès Firestore injectable.
 * @returns {Promise<Array<*>>}
 */
async function executerPlan(cas, fb) {
  const resultats = []
  for (const c of cas) {
    try {
      const auditId = await reunirUnCas(c, fb)
      resultats.push({ cas: c.article_nom + ' @ ' + c.lieu_id, ok: true, audit_id: auditId })
      console.log('   ✅ ' + c.article_nom + ' @ ' + c.lieu_type + '/' + c.lieu_id + '  → ' + c.conserve + '  (journal ' + auditId + ')')
    } catch (e) {
      resultats.push({ cas: c.article_nom + ' @ ' + c.lieu_id, ok: false, error: e.message })
      console.log('   ⛔ ' + c.article_nom + ' @ ' + c.lieu_type + '/' + c.lieu_id + ' : ' + e.message)
      console.log('')
      console.log('ARRÊT à la première anomalie. Les cas déjà réunis sont acquis :')
      console.log('chacun a son document `stock_balance_reunions` avec l\'état AVANT.')
      return resultats
    }
  }
  return resultats
}

/**
 * @param {string[]} [argv] @param {*} [fb] accès Firestore injectable (tests).
 * @returns {Promise<{cas: Array<*>, executables: Array<*>, bloques: Array<*>, resultats: Array<*>}>}
 */
async function main(argv, fb) {
  const opts = parseArgs(argv || process.argv, process.env)
  if (opts.refus) {
    console.error(
      '[REFUS] --execute SUPPRIME des documents stock_balances et exige\n' +
        '        REUNION_EXECUTE_CONFIRM=OUI dans l\'environnement.\n' +
        '        Sans GO explicite d\'Omar, rester en rapport.'
    )
    process.exitCode = 2
    return { cas: [], executables: [], bloques: [], resultats: [] }
  }
  console.log(
    'RÉUNION DES SOLDES FRAGMENTÉS — ' +
      (opts.mode === 'execute' ? 'EXÉCUTION' : 'RAPPORT (lecture seule)')
  )

  const [soldes, articles] = await Promise.all([
    lireCollection('stock_balances', fb),
    lireCollection('articles_catalog', fb),
  ])
  const plan = reunionSoldes.planifierReunion(soldes, articles)
  let cas = plan.cas
  if (opts.limit) cas = cas.slice(0, opts.limit)
  const executables = reunionSoldes.casExecutables(cas)
  const bloques = cas.filter((c) => c.anomalies.length > 0)

  const lignes = []
  for (const c of cas) lignes.push(...rendreCas(c))
  console.log(lignes.join('\n'))

  console.log('')
  console.log('═══ SYNTHÈSE ═══')
  console.log('Documents stock_balances lus     : ' + soldes.length)
  console.log('Soldes non rattachés au catalogue: ' + plan.non_resolus.length + '  (laissés INTACTS)')
  console.log('Cas fragmentés                   : ' + cas.length)
  console.log('  documents impliqués            : ' + cas.reduce((n, c) => n + c.docs.length, 0))
  console.log('  documents qui seraient supprimés: ' + executables.reduce((n, c) => n + c.supprimes.length, 0))
  console.log('  cas à trancher à la main       : ' + bloques.length)

  if (opts.json) {
    fs.writeFileSync(
      opts.json,
      JSON.stringify({ generated_at: new Date().toISOString(), cas, non_resolus: plan.non_resolus }, null, 2)
    )
    console.log('Rapport JSON écrit : ' + opts.json)
  }

  // SAUVEGARDE PRÉALABLE — l'état AVANT de TOUS les documents impliqués, écrit
  // sur disque avant la moindre écriture. Le journal `stock_balance_reunions`
  // reste la source de vérité du retour en arrière (il est transactionnel) ;
  // ce fichier est la ceinture : il survit même si l'exécution s'arrête au
  // milieu, et il se lit sans ouvrir Firestore.
  // `docs/BACKUP-*.json` est gitignored : aucune donnée de production dans le dépôt.
  // OBLIGATOIRE en exécution ; en rapport, seulement sur `--backup` explicite
  // (sinon un simple rapport laisserait un fichier derrière lui à chaque appel).
  const cheminBackup =
    opts.mode === 'execute'
      ? opts.backup ||
        path.resolve(
          __dirname,
          '../docs/BACKUP-soldes-fragmentes-' + new Date().toISOString().slice(0, 10) + '.json'
        )
      : opts.backup
  if (cheminBackup) {
    fs.writeFileSync(
      cheminBackup,
      JSON.stringify(
      {
        genere_le: new Date().toISOString(),
        avertissement: 'État AVANT réunion. Sert à constater/reconstruire l\'état d\'origine.',
        cas_documents: cas.map((c) => ({
          article_id: c.article_id, article_nom: c.article_nom,
          lieu_type: c.lieu_type, lieu_id: c.lieu_id,
          conserve: c.conserve, supprimes: c.supprimes,
          total_attendu: c.total, anomalies: c.anomalies,
          docs: c.docs,
        })),
          non_resolus: plan.non_resolus,
        },
        null,
        2
      ),
      'utf8'
    )
    console.log('Sauvegarde préalable écrite : ' + cheminBackup)
  }

  if (opts.mode !== 'execute') {
    console.log('')
    console.log('Mode RAPPORT : aucune écriture. Relire ci-dessus, puis --execute pour appliquer.')
    return { cas, executables, bloques, resultats: [] }
  }

  console.log('')
  console.log('═══ EXÉCUTION ═══')
  const resultats = await executerPlan(executables, fb)
  const ok = resultats.filter((r) => r.ok).length
  console.log('')
  console.log('Cas réunis : ' + ok + ' / ' + executables.length)
  if (bloques.length) {
    console.log('Cas laissés en l\'état (à trancher à la main) : ' + bloques.length)
  }
  if (ok !== executables.length) process.exitCode = 1
  return { cas, executables, bloques, resultats }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERREUR : ' + e.message)
    process.exitCode = 1
  })
}

module.exports = { parseArgs, rendreCas, reunirUnCas, executerPlan, main }
