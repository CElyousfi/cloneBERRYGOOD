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
    completer: args.includes('--completer'),
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
 * Réunit des fragments vers une cible qui N'EXISTE PAS ENCORE.
 *
 * ── LE DÉFAUT QUE CETTE FONCTION FERME (constaté en production) ───────────
 * `reunirUnCas` incrémente le document conservé (`FieldValue.increment`,
 * `merge: true`) : c'est juste quand ce document EXISTE — ses champs de
 * structure sont déjà là. Quand il n'existe pas, `merge` le CRÉE avec les
 * seules clés écrites : `balance` et `updated_at`. Le document naît alors sans
 * `lieu_type`, `lieu_id`, `article_ref` ni `unite` : le solde est juste, mais
 * plus aucun écran ne le voit — il n'appartient à aucun lieu et à aucun article.
 * C'est arrivé une fois, le 2026-09-01, sur `magasin_F2_IMP-001` (3 406 kg
 * d'acide sulfurique). Le montant était bon, le document était mort.
 *
 * Ici, la cible est donc écrite ENTIÈRE, en valeur ABSOLUE (la somme des
 * fragments) — pas en incrément : incrémenter un document qui n'existe pas est
 * précisément ce qui produit le document creux.
 *
 * Les champs de structure viennent de `docs[0]` (le plus petit docId, ordre
 * déterministe) : tous les fragments partagent le même lieu par construction du
 * plan, et la même unité — le fail-closed sur les unités l'a déjà garanti.
 *
 * @param {*} c cas `reunion` dont `cible_existante === false`.
 * @param {*} [fb] accès Firestore ({db, admin}) — injectable pour les tests.
 * @returns {Promise<string>} id du document d'audit
 */
async function reunirEnCreant(c, fb) {
  const { db, admin } = fb || firebase()
  const auditRef = db.collection('stock_balance_recles').doc()
  const cibleRef = db.collection('stock_balances').doc(String(c.conserve))
  await db.runTransaction(async (t) => {
    const refs = c.docs.map((d) => db.collection('stock_balances').doc(String(d.docId)))
    const snaps = await t.getAll(cibleRef, ...refs)
    if (snaps[0].exists) {
      throw new Error(
        'la cible ' + c.conserve + ' est apparue depuis le rapport : la somme écraserait ' +
          'un solde existant — relancer --report'
      )
    }
    const avant = []
    for (let i = 0; i < c.docs.length; i++) {
      const s = snaps[i + 1]
      const attendu = c.docs[i]
      if (!s.exists) throw new Error('le solde ' + attendu.docId + ' a disparu depuis le rapport')
      const data = s.data()
      const balance = Number(data.balance) || 0
      if (Math.round(balance * 100) !== Math.round((Number(attendu.balance) || 0) * 100)) {
        throw new Error(
          'le solde ' + attendu.docId + ' a changé depuis le rapport (' +
            fmt(attendu.balance) + ' -> ' + fmt(balance) + ') — relancer --report'
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
    const cible = Object.assign(
      recleSoldes.documentCible(avant[0], { ficheId: c.article_id, nom: c.article_nom }),
      { balance: c.total }
    )
    // Journal AVANT mutation, dans la MÊME transaction.
    t.set(auditRef, {
      at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'scripts/recle-soldes-sous-fiche.js',
      issue: c.issue,
      cible_creee: true,
      article_id: c.article_id,
      article_nom: c.article_nom,
      lieu_type: c.lieu_type,
      lieu_id: c.lieu_id,
      ancien_doc_id: avant.map((a) => a.docId).join(' + '),
      nouveau_doc_id: String(c.conserve),
      soldes_avant: avant,
      solde_apres: cible,
      total_attendu: c.total,
    })
    t.set(cibleRef, Object.assign({}, cible, { updated_at: Date.now() }))
    for (const d of c.docs) t.delete(db.collection('stock_balances').doc(String(d.docId)))
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
      let auditId
      if (c.issue !== recleSoldes.ISSUE_REUNION) {
        auditId = await deplacerUnCas(c, fb)
      } else if (c.cible_existante) {
        // Délégation : somme, incrément RELATIF et journal `stock_balance_reunions`
        // sont déjà écrits et testés dans `reunir-soldes-fragmentes`.
        auditId = await reunion.reunirUnCas(c, fb)
      } else {
        // La cible n'existe pas : l'incrémenter la créerait CREUSE (sans lieu ni
        // article). Elle est écrite entière. Cf. `reunirEnCreant`.
        auditId = await reunirEnCreant(c, fb)
      }
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

/** Champs de structure sans lesquels un solde n'est visible d'aucun écran. */
const CHAMPS_STRUCTURE = ['lieu_type', 'lieu_id', 'article_ref', 'unite']

/**
 * Soldes CREUX : un `balance` juste, mais amputés d'au moins un champ de
 * structure. Ils n'appartiennent à aucun lieu et à aucun article — invisibles.
 * @param {Array<*>} soldes @returns {Array<*>}
 */
function soldesIncomplets(soldes) {
  return (Array.isArray(soldes) ? soldes : []).filter((s) => {
    if (!s || !s.docId) return false
    return CHAMPS_STRUCTURE.some((k) => s[k] === undefined || s[k] === null || s[k] === '')
  })
}

/**
 * Reconstruit les champs manquants d'un solde creux À PARTIR DU JOURNAL D'AUDIT.
 *
 * ⚠️ La reconstruction ne DÉDUIT rien du docId. Découper
 * `magasin_F2_IMP-001` pour en tirer un lieu et un article fabriquerait une
 * SIXIÈME règle d'identité, celle-là implicite et fausse dès qu'un identifiant
 * de lieu contient un « _ ». La seule source légitime est le journal écrit au
 * moment où le document a été créé : il porte l'état AVANT de chaque fragment.
 *
 * FAIL-CLOSED : sans journal, ou si les fragments d'origine ne s'accordent pas
 * sur le lieu ou l'unité, on REFUSE — on ne devine pas un lieu de stock.
 *
 * @param {*} solde Document creux.
 * @param {Array<*>} journaux Documents `stock_balance_reunions` + `stock_balance_recles`.
 * @returns {{ok: boolean, motif: string, champs: (Object|null), journal_id: string}}
 */
function reconstruireDepuisJournal(solde, journaux) {
  const cible = String(solde.docId)
  const j = (Array.isArray(journaux) ? journaux : []).filter(
    (x) => String(x.conserve || x.nouveau_doc_id || '') === cible
  )
  if (!j.length) return { ok: false, motif: 'aucun journal d\'audit ne mentionne ' + cible, champs: null, journal_id: '' }
  if (j.length > 1) {
    return {
      ok: false,
      motif: j.length + ' journaux mentionnent ' + cible + ' — lequel décrit l\'état d\'origine ?',
      champs: null,
      journal_id: '',
    }
  }
  const avant = Array.isArray(j[0].soldes_avant) ? j[0].soldes_avant : []
  if (!avant.length) return { ok: false, motif: 'le journal de ' + cible + ' ne porte aucun état AVANT', champs: null, journal_id: String(j[0].docId || '') }
  const lieux = new Set(avant.map((a) => String(a.lieu_type) + '|' + String(a.lieu_id)))
  if (lieux.size !== 1) {
    return { ok: false, motif: 'les fragments d\'origine de ' + cible + ' ne s\'accordent pas sur le lieu', champs: null, journal_id: String(j[0].docId || '') }
  }
  const unites = new Set(avant.map((a) => (a.unite == null ? '' : String(a.unite).trim().toLowerCase())).filter(Boolean))
  if (unites.size > 1) {
    return { ok: false, motif: 'les fragments d\'origine de ' + cible + ' ne s\'accordent pas sur l\'unité (' + Array.from(unites).join(' / ') + ')', champs: null, journal_id: String(j[0].docId || '') }
  }
  const ficheId = String(j[0].article_id || '')
  if (!ficheId) return { ok: false, motif: 'le journal de ' + cible + ' ne nomme pas la fiche', champs: null, journal_id: String(j[0].docId || '') }
  const ref = avant[0]
  return {
    ok: true,
    motif: '',
    journal_id: String(j[0].docId || ''),
    champs: {
      lieu_type: String(ref.lieu_type),
      lieu_id: String(ref.lieu_id),
      article_ref: ficheId,
      article_nom: String(ref.article_nom || ref.article_ref || j[0].article_nom || ''),
      unite: Array.from(unites)[0] || String(ref.unite || ''),
    },
  }
}

/**
 * Écrit les champs reconstruits, sans jamais toucher au `balance`.
 * @param {*} solde @param {Object} champs @param {string} journalId @param {*} [fb]
 * @returns {Promise<string>} id du document d'audit
 */
async function completerUnSolde(solde, champs, journalId, fb) {
  const { db, admin } = fb || firebase()
  const auditRef = db.collection('stock_balance_recles').doc()
  const ref = db.collection('stock_balances').doc(String(solde.docId))
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new Error('le solde ' + solde.docId + ' a disparu depuis le rapport')
    const data = snap.data()
    const balance = Number(data.balance) || 0
    if (Math.round(balance * 100) !== Math.round((Number(solde.balance) || 0) * 100)) {
      throw new Error(
        'le solde ' + solde.docId + ' a changé depuis le rapport (' + fmt(solde.balance) +
          ' -> ' + fmt(balance) + ') — relancer --report'
      )
    }
    t.set(auditRef, {
      at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'scripts/recle-soldes-sous-fiche.js --completer',
      issue: 'completion',
      motif:
        'document créé creux par une réunion vers une cible absente ; champs de ' +
        'structure reconstruits depuis le journal d\'origine ' + journalId,
      journal_origine: journalId,
      nouveau_doc_id: String(solde.docId),
      champs_avant: data,
      champs_ajoutes: champs,
      balance_inchangee: balance,
    })
    // `balance` n'est PAS réécrit : la complétion répare la structure, elle ne
    // touche pas au chiffre — qui est juste, et peut avoir bougé légitimement.
    t.set(ref, Object.assign({}, champs, { updated_at: Date.now() }), { merge: true })
  })
  return auditRef.id
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

  // ── MODE COMPLÉTION ─────────────────────────────────────────────────────
  // Répare les soldes CREUX laissés par une réunion vers une cible absente
  // (défaut fermé par `reunirEnCreant`). Mode à part : il ne déplace rien et
  // ne touche jamais à un `balance`.
  if (opts.completer) {
    const creux = soldesIncomplets(soldes)
    const journaux = (await lireCollection('stock_balance_reunions', fb)).concat(
      await lireCollection('stock_balance_recles', fb)
    )
    console.log('')
    console.log('═══ COMPLÉTION DES SOLDES CREUX ═══')
    console.log('Documents incomplets : ' + creux.length + ' / ' + soldes.length)
    const aFaire = []
    for (const s of creux) {
      const r = reconstruireDepuisJournal(s, journaux)
      const manque = CHAMPS_STRUCTURE.filter((k) => s[k] === undefined || s[k] === null || s[k] === '')
      console.log('')
      console.log('── ' + s.docId + '   balance=' + fmt(s.balance) + '   manque=[' + manque.join(', ') + ']')
      if (!r.ok) {
        console.log('   ⛔ NON RÉPARABLE — ' + r.motif)
        continue
      }
      console.log('   journal d\'origine : ' + r.journal_id)
      for (const k of Object.keys(r.champs)) console.log('      ' + k + ' = « ' + r.champs[k] + ' »')
      console.log('   balance INCHANGÉE : ' + fmt(s.balance))
      aFaire.push({ solde: s, champs: r.champs, journal_id: r.journal_id })
    }
    if (opts.mode !== 'execute') {
      console.log('')
      console.log('Mode RAPPORT : aucune écriture. Relire ci-dessus, puis --execute --completer.')
      return { completions: aFaire, resultats: [] }
    }
    console.log('')
    console.log('═══ EXÉCUTION ═══')
    const resultats = []
    for (const a of aFaire) {
      try {
        const id = await completerUnSolde(a.solde, a.champs, a.journal_id, fb)
        resultats.push({ docId: a.solde.docId, ok: true, audit_id: id })
        console.log('   ✅ ' + a.solde.docId + '  (journal ' + id + ')')
      } catch (e) {
        resultats.push({ docId: a.solde.docId, ok: false, error: e.message })
        console.log('   ⛔ ' + a.solde.docId + ' : ' + e.message)
        console.log('ARRÊT à la première anomalie.')
        process.exitCode = 1
        break
      }
    }
    return { completions: aFaire, resultats }
  }

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

module.exports = {
  parseArgs,
  rendreCas,
  deplacerUnCas,
  reunirEnCreant,
  executerPlan,
  soldesIncomplets,
  reconstruireDepuisJournal,
  completerUnSolde,
  CHAMPS_STRUCTURE,
  main,
}
