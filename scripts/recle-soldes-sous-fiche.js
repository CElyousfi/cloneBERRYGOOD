'use strict'
// @ts-check

/**
 * RE-CLÉ DES SOLDES SOUS LA FICHE — un solde, un identifiant, celui de la fiche.
 *
 * ── POURQUOI CE SCRIPT DOIT EXISTER AVANT UN DEPLOY ───────────────────────
 * La PR #362 fait de l'identité d'une ligne de stock le DOCID de la fiche. Elle
 * change ce qu'on ÉCRIT et ce qu'on LIT — pas où les documents SONT rangés.
 * Or une bonne partie des `stock_balances` de production est rangée sous le
 * LIBELLÉ tapé par le magasinier. Le jour du deploy, la garde « stock
 * insuffisant » (`identiteArticle.identifiantsGardeStock`) ira lire
 * `magasin_F2_IMP-019` pendant que le stock dort dans
 * `magasin_F2_NITRETE_DE_POTASSE`. Elle lira 0 et refusera la sortie.
 * Du stock réel, invisible, sur les plus gros volumes de F2.
 *
 * Ce script déplace chaque solde vers son identifiant canonique.
 *
 * ── LA MESURE BOUGE : NE PAS SE FIER À UN CHIFFRE FIGÉ ────────────────────
 * La fragmentation est ALIMENTÉE en continu par les écritures courantes
 * (+18 cas en 24 h fin août 2026). Relancer `--report` juste avant toute
 * exécution : un plan de la veille est périmé, et une exécution sur un plan
 * périmé s'arrête d'elle-même (relecture transactionnelle), mais autant ne pas
 * la lancer pour rien.
 *
 * ── DEUX TEMPS, LECTURE SEULE PAR DÉFAUT ──────────────────────────────────
 *   node scripts/recle-soldes-sous-fiche.js                     # --report (défaut)
 *   RECLE_EXECUTE_CONFIRM=OUI node scripts/…js --execute        # ÉCRIT
 *
 * Sans `--execute`, AUCUNE écriture : le mode rapport n'ouvre pas une seule
 * transaction. DOUBLE VERROU : `--execute` sans `RECLE_EXECUTE_CONFIRM=OUI`
 * est REFUSÉ (sortie 2). Ce script supprime des documents de solde ; le flag
 * CLI seul ne suffit pas, une ligne d'historique shell rejouée par réflexe ne
 * doit pas migrer l'inventaire.
 * Options : `--json <fichier>`, `--limit <n>`, `--backup <fichier>`
 * (défaut `docs/BACKUP-recle-soldes-<date>.json`), `--only deplacements|reunions`.
 *
 * ── SAUVEGARDE PRÉALABLE OBLIGATOIRE ──────────────────────────────────────
 * En exécution, l'état AVANT de TOUS les documents concernés est écrit sur
 * disque avant la moindre transaction. Si l'écriture de la sauvegarde échoue,
 * le script s'arrête sans rien migrer. `docs/BACKUP-*.json` est gitignored :
 * aucune donnée de production dans le dépôt.
 *
 * ── CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ────────────────────────────────
 *   DÉPLACEMENT — la cible n'existe pas : le document est recréé à
 *   l'identifiant canonique avec `article_ref` = docId de fiche, `balance` et
 *   `unite` RECOPIÉS, puis la source est supprimée. Aucun recalcul.
 *   RÉUNION — la cible existe (ou plusieurs sources la visent) : les soldes se
 *   SOMMENT. L'exécution est DÉLÉGUÉE à `scripts/reunir-soldes-fragmentes.js`
 *   (`reunirUnCas`) : transaction, relecture anti-concurrence et journal
 *   `stock_balance_reunions` y sont déjà écrits et testés.
 *   ORPHELIN — le libellé ne résout à aucune fiche (ou en désigne deux) : le
 *   document est LAISSÉ EN PLACE et listé. Jamais supprimé : ce serait effacer
 *   du stock réel que plus aucune fiche ne réclame.
 *   UNITÉS DIVERGENTES — jamais sommées. Listées, à trancher à la main.
 *
 * ── ACCÈS ─────────────────────────────────────────────────────────────────
 * Admin SDK via ADC (`gcloud auth application-default login`), comme
 * `scripts/reunir-soldes-fragmentes.js` : outil d'administration lancé à la
 * main, jamais appelé par l'application. Créer une action Cloud Function
 * exposerait une capacité de suppression de soldes à tout appelant authentifié.
 * GATED : l'exécution ne se lance qu'après lecture du rapport par Omar.
 */

const fs = require('fs')
const path = require('path')

const recleSoldes = require(path.resolve(__dirname, '../functions/lib/stock/recleSoldes'))
// DÉLÉGATION : la réunion de fragments est déjà écrite, testée et journalisée.
const reunion = require(path.resolve(__dirname, './reunir-soldes-fragmentes'))

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
 *            refus: boolean, backup: (string|null), only: (string|null)}}
 */
function parseArgs(argv, env) {
  const args = (argv || []).slice(2)
  const get = (flag) => {
    const i = args.indexOf(flag)
    return i > -1 && args[i + 1] ? args[i + 1] : null
  }
  const limitRaw = get('--limit')
  // DOUBLE VERROU, même convention que scripts/reunir-soldes-fragmentes.js.
  const demandeExecute = args.includes('--execute')
  const confirme = (env || {}).RECLE_EXECUTE_CONFIRM === 'OUI'
  return {
    mode: demandeExecute && confirme ? 'execute' : 'report',
    refus: demandeExecute && !confirme,
    limit: limitRaw && /^\d+$/.test(limitRaw) ? parseInt(limitRaw, 10) : null,
    json: get('--json'),
    backup: get('--backup'),
    only: get('--only'),
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

/** @param {*} n @returns {string} */
function fmt(n) {
  const v = Number(n)
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—'
}

/**
 * Rend un cas en texte.
 * @param {*} c @returns {string[]}
 */
function rendreCas(c) {
  const L = []
  L.push('')
  L.push(
    '── [' + c.issue.toUpperCase() + '] ' + (c.article_nom || '(sans fiche)') +
      '  @ ' + c.lieu_type + '/' + c.lieu_id +
      (c.article_id ? '   (fiche ' + c.article_id + ')' : '')
  )
  for (const d of c.docs) {
    const marque = String(d.docId) === c.conserve ? 'CIBLE    ' : 'source   '
    L.push(
      '   ' + marque + d.docId + '   article_ref=« ' + d.article_ref + ' »   ' +
        fmt(d.balance) + ' ' + (d.unite || '')
    )
  }
  if (c.issue !== recleSoldes.ISSUE_ORPHELIN) {
    L.push('   → ' + c.conserve + '   solde après : ' + fmt(c.total))
  }
  L.push('   ' + c.motif)
  for (const a of c.anomalies) {
    if (c.issue === recleSoldes.ISSUE_REUNION) L.push('   ⛔ NON EXÉCUTÉ — ' + a)
  }
  return L
}

/**
 * Exécute UN déplacement : la cible n'existe pas encore.
 *
 * Fail-loud : la transaction relit la source ET la cible. Si la source a bougé
 * depuis le rapport (validation de mouvement concurrente) ou a disparu, ou si
 * la cible est APPARUE entre-temps (le cas n'est alors plus un déplacement mais
 * une réunion), on échoue sans rien écrire — jamais d'écrasement silencieux.
 *
 * @param {*} c cas `deplacement`.
 * @param {*} [fb] accès Firestore ({db, admin}) — injectable pour les tests.
 * @returns {Promise<string>} id du document d'audit
 */
async function deplacerUnCas(c, fb) {
  const { db, admin } = fb || firebase()
  const auditRef = db.collection('stock_balance_recles').doc()
  const source = c.docs[0]
  await db.runTransaction(async (t) => {
    const srcRef = db.collection('stock_balances').doc(String(source.docId))
    const cibleRef = db.collection('stock_balances').doc(String(c.conserve))
    const [srcSnap, cibleSnap] = await t.getAll(srcRef, cibleRef)
    if (!srcSnap.exists) throw new Error('le solde ' + source.docId + ' a disparu depuis le rapport')
    const data = srcSnap.data()
    const balance = Number(data.balance) || 0
    if (Math.round(balance * 100) !== Math.round((Number(source.balance) || 0) * 100)) {
      throw new Error(
        'le solde ' + source.docId + ' a changé depuis le rapport (' +
          fmt(source.balance) + ' -> ' + fmt(balance) + ') — relancer --report'
      )
    }
    if (cibleSnap.exists) {
      throw new Error(
        'la cible ' + c.conserve + ' est apparue depuis le rapport : ce cas est devenu une ' +
          'RÉUNION (il faudrait sommer, pas écraser) — relancer --report'
      )
    }
    const cible = recleSoldes.documentCible(
      Object.assign({}, data, { docId: source.docId }),
      { ficheId: c.article_id, nom: c.article_nom }
    )
    // Journal AVANT mutation, dans la MÊME transaction : pas de suppression
    // sans sa trace de retour en arrière.
    t.set(auditRef, {
      at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'scripts/recle-soldes-sous-fiche.js',
      issue: c.issue,
      article_id: c.article_id,
      article_nom: c.article_nom,
      lieu_type: c.lieu_type,
      lieu_id: c.lieu_id,
      ancien_doc_id: String(source.docId),
      nouveau_doc_id: String(c.conserve),
      solde_avant: {
        docId: String(source.docId),
        article_ref: data.article_ref == null ? '' : String(data.article_ref),
        article_nom: data.article_nom == null ? '' : String(data.article_nom),
        lieu_type: data.lieu_type == null ? '' : String(data.lieu_type),
        lieu_id: data.lieu_id == null ? '' : String(data.lieu_id),
        balance,
        unite: data.unite == null ? '' : String(data.unite),
      },
      solde_apres: cible,
    })
    // Le document complet est recréé (pas un simple increment) : un solde sans
    // lieu_type / article_ref / unite serait invisible de l'inventaire.
    t.set(cibleRef, Object.assign({}, data, cible, { updated_at: Date.now() }))
    t.delete(srcRef)
  })
  return auditRef.id
}

/**
 * Exécute le plan, cas par cas, en S'ARRÊTANT à la première anomalie.
 * Les déplacements d'abord (sans risque de somme), les réunions ensuite.
 * @param {Array<*>} cas @param {*} [fb] accès Firestore injectable.
 * @returns {Promise<Array<*>>}
 */
async function executerPlan(cas, fb) {
  const resultats = []
  for (const c of cas) {
    const etiquette = (c.article_nom || '(sans fiche)') + ' @ ' + c.lieu_type + '/' + c.lieu_id
    try {
      const auditId =
        c.issue === recleSoldes.ISSUE_REUNION
          ? await reunion.reunirUnCas(c, fb) // délégation : somme + journal
          : await deplacerUnCas(c, fb)
      resultats.push({ cas: etiquette, issue: c.issue, ok: true, audit_id: auditId })
      console.log('   ✅ [' + c.issue + '] ' + etiquette + '  → ' + c.conserve + '  (journal ' + auditId + ')')
    } catch (e) {
      resultats.push({ cas: etiquette, issue: c.issue, ok: false, error: e.message })
      console.log('   ⛔ [' + c.issue + '] ' + etiquette + ' : ' + e.message)
      console.log('')
      console.log('ARRÊT à la première anomalie. Les cas déjà traités sont acquis :')
      console.log('chacun a son document d\'audit avec l\'état AVANT.')
      return resultats
    }
  }
  return resultats
}

/**
 * @param {string[]} [argv] @param {*} [fb] accès Firestore injectable (tests).
 * @returns {Promise<*>}
 */
async function main(argv, fb) {
  const opts = parseArgs(argv || process.argv, process.env)
  if (opts.refus) {
    console.error(
      '[REFUS] --execute DÉPLACE et SUPPRIME des documents stock_balances et exige\n' +
        '        RECLE_EXECUTE_CONFIRM=OUI dans l\'environnement.\n' +
        '        Sans GO explicite d\'Omar, rester en rapport.'
    )
    process.exitCode = 2
    return { cas: [], executables: [], bloques: [], orphelins: [], resultats: [] }
  }
  console.log(
    'RE-CLÉ DES SOLDES SOUS LA FICHE — ' +
      (opts.mode === 'execute' ? 'EXÉCUTION' : 'RAPPORT (lecture seule)')
  )

  const [soldes, articles] = await Promise.all([
    lireCollection('stock_balances', fb),
    lireCollection('articles_catalog', fb),
  ])
  const plan = recleSoldes.planifierRecle(soldes, articles)

  let deplacements = plan.deplacements
  let reunions = plan.reunions
  if (opts.only === 'deplacements') reunions = []
  if (opts.only === 'reunions') deplacements = []
  if (opts.limit) {
    deplacements = deplacements.slice(0, opts.limit)
    reunions = reunions.slice(0, opts.limit)
  }
  const executables = deplacements.concat(reunions)

  const lignes = []
  for (const c of executables) lignes.push(...rendreCas(c))
  for (const c of plan.bloques) lignes.push(...rendreCas(c))
  console.log(lignes.join('\n'))

  const somme = (l) => Math.round(l.reduce((n, c) => n + Math.abs(Number(c.total) || 0), 0) * 100) / 100
  console.log('')
  console.log('═══ SYNTHÈSE ═══')
  console.log('Documents stock_balances lus       : ' + plan.total_documents)
  console.log('  déjà rangés sous la fiche        : ' + plan.deja_canoniques.length)
  console.log('  DÉPLACEMENTS simples             : ' + plan.deplacements.length +
    '   (' + somme(plan.deplacements) + ' unités déplacées)')
  console.log('  RÉUNIONS (cible existante, somme): ' + plan.reunions.length +
    '   (' + plan.reunions.reduce((n, c) => n + c.docs.length, 0) + ' documents)')
  console.log('  BLOQUÉS unités divergentes       : ' + plan.bloques.length + '   (à trancher à la main)')
  console.log('  ORPHELINS sans fiche cible       : ' + plan.orphelins.length +
    '   (LAISSÉS INTACTS, ' + somme(plan.orphelins) + ' unités)')
  console.log('Documents qui seraient supprimés   : ' +
    executables.reduce((n, c) => n + c.supprimes.length, 0))

  if (opts.json) {
    fs.writeFileSync(
      opts.json,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          deplacements: plan.deplacements,
          reunions: plan.reunions,
          bloques: plan.bloques,
          orphelins: plan.orphelins,
        },
        null,
        2
      )
    )
    console.log('Rapport JSON écrit : ' + opts.json)
  }

  // SAUVEGARDE PRÉALABLE — état AVANT de TOUS les documents concernés, écrit
  // sur disque avant la moindre écriture. Le journal Firestore reste la source
  // de vérité du retour en arrière (transactionnel) ; ce fichier est la
  // ceinture : il survit à un arrêt en plein milieu et se lit sans Firestore.
  // OBLIGATOIRE en exécution ; en rapport, seulement sur `--backup` explicite.
  const cheminBackup =
    opts.mode === 'execute'
      ? opts.backup ||
        path.resolve(
          __dirname,
          '../docs/BACKUP-recle-soldes-' + new Date().toISOString().slice(0, 10) + '.json'
        )
      : opts.backup
  if (cheminBackup) {
    fs.writeFileSync(
      cheminBackup,
      JSON.stringify(
        {
          genere_le: new Date().toISOString(),
          avertissement: 'État AVANT re-clé. Sert à constater/reconstruire l\'état d\'origine.',
          cas: executables.map((c) => ({
            issue: c.issue,
            article_id: c.article_id,
            article_nom: c.article_nom,
            lieu_type: c.lieu_type,
            lieu_id: c.lieu_id,
            conserve: c.conserve,
            supprimes: c.supprimes,
            total_attendu: c.total,
            docs: c.docs,
          })),
          bloques: plan.bloques,
          orphelins: plan.orphelins,
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
    return { cas: plan.cas, executables, bloques: plan.bloques, orphelins: plan.orphelins, resultats: [] }
  }

  console.log('')
  console.log('═══ EXÉCUTION ═══')
  const resultats = await executerPlan(executables, fb)
  const ok = resultats.filter((r) => r.ok).length
  console.log('')
  console.log('Cas re-clés : ' + ok + ' / ' + executables.length)
  if (plan.bloques.length) {
    console.log('Cas laissés en l\'état (unités divergentes) : ' + plan.bloques.length)
  }
  if (plan.orphelins.length) {
    console.log('Orphelins laissés intacts : ' + plan.orphelins.length)
  }
  if (ok !== executables.length) process.exitCode = 1
  return { cas: plan.cas, executables, bloques: plan.bloques, orphelins: plan.orphelins, resultats }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERREUR : ' + e.message)
    process.exitCode = 1
  })
}

module.exports = { parseArgs, rendreCas, deplacerUnCas, executerPlan, main }
