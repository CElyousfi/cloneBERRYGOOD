'use strict'
// @ts-check

/**
 * CORRECTION D'UNITÉ D'UN ARTICLE — la fiche et ses soldes passent au kg.
 *
 * (Nommé `corriger-unite-acide.js` jusqu'au 2026-09-02 : le premier cas traité
 * était l'acide sulfurique. Les journaux du 2026-09-01 portent l'ancien chemin
 * en `source` — c'est bien ce script.)
 *
 * ── POURQUOI CETTE OPÉRATION EST SÉPARÉE DE LA RE-CLÉ ─────────────────────
 * `scripts/recle-soldes-sous-fiche.js` RANGE les soldes ; il n'arbitre aucun
 * chiffre. Son fail-closed sur les unités divergentes est ce qui le rend sûr :
 * y glisser une table de conversion en ferait un outil qui DÉCIDE, et
 * « fail-closed neutralisé » cesserait d'être une régression détectable.
 * La conversion est un geste d'arbitrage humain : il vit ici, tracé, à part.
 *
 * ⚠️ CHAQUE FACTEUR EST UN ARBITRAGE D'OMAR, propre à UN article, jamais une
 * déduction du code ni une densité physique :
 *   acide sulfurique (`IMP-001`)  : 35 kg = 20 L  → 1,75   kg/L
 *   Rhizo amine      (`Ref-Eng0056`) : 20 kg = 18 L  → 1,1111 kg/L
 * Ils vivent dans la table `CONVERSIONS_ARBITREES` de
 * `functions/lib/stock/correctionUniteStock.js`, sous leur forme d'origine —
 * pour que le SENS ne s'inverse pas en silence : « 20 kg = 18 L » veut dire
 * qu'un litre pèse PLUS d'un kilo. Prendre 18/20 au lieu de 20/18 ferait 23,5 %
 * d'écart, sans la moindre alerte.
 * ⛔ Une fiche absente de la table est REFUSÉE, et il n'existe AUCUN facteur en
 * ligne de commande : un outil qui accepte un facteur au clavier est un outil
 * qui décide.
 *
 * ── TROIS GESTES, UNE SEULE TRANSACTION ───────────────────────────────────
 *   1. la fiche : `unite` → `kg`, `nom` → sans le suffixe d'unité ;
 *   2. chaque solde en litres du lieu : `balance` × 1,75, `unite` → `kg` ;
 *   3. le journal d'audit, écrit AVANT les mutations, dans la même transaction.
 * Tout ou rien : une fiche corrigée sans ses soldes laisserait l'inventaire
 * dans un état pire que celui d'avant.
 *
 * ── DEUX TEMPS, LECTURE SEULE PAR DÉFAUT ──────────────────────────────────
 *   node scripts/corriger-unite-stock.js --fiche <id> --lieu <type/id>       # --report
 *   ACIDE_EXECUTE_CONFIRM=OUI node scripts/…js --fiche … --lieu … --execute # ÉCRIT
 * DOUBLE VERROU : `--execute` sans `ACIDE_EXECUTE_CONFIRM=OUI` est REFUSÉ
 * (sortie 2). `--fiche <id>` et `--lieu <type/id>` sont OBLIGATOIRES : un
 * défaut pointant silencieusement sur un article est un piège. Options :
 * `--nom <libellé>`, `--backup <fichier>`.
 * SAUVEGARDE PRÉALABLE OBLIGATOIRE en exécution, écrite avant la transaction.
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * Refusé si : la fiche est absente ; le renommage déplacerait son identité
 * canonique ; une autre fiche active porte déjà cette identité (on
 * fabriquerait une ambiguïté qui bloquerait la saisie) ; un solde porte une
 * unité pour laquelle aucun facteur n'a été arbitré. La transaction relit
 * fiche et soldes : tout écart avec le rapport la fait échouer sans écrire.
 *
 * ── ACCÈS ─────────────────────────────────────────────────────────────────
 * Admin SDK via ADC. Outil d'administration lancé à la main, jamais appelé par
 * l'application. GATED : exécution sur GO explicite d'Omar uniquement.
 */

const fs = require('fs')
const path = require('path')

const correction = require(path.resolve(__dirname, '../functions/lib/stock/correctionUniteStock'))

/** Accès Firestore résolu à la demande (un `--help` ne doit pas exiger l'ADC). @type {*} */
let _fb = null
function firebase() {
  if (!_fb) _fb = require(path.resolve(__dirname, '../functions/config/firebase'))
  return _fb
}

/**
 * @param {string[]} argv @param {Record<string,string|undefined>} [env]
 * @returns {{mode:('report'|'execute'), refus:boolean, ficheId:string, lieuType:string,
 *            lieuId:string, nouveauNom:(string|null), backup:(string|null)}}
 */
function parseArgs(argv, env) {
  const args = (argv || []).slice(2)
  const get = (f) => {
    const i = args.indexOf(f)
    return i > -1 && args[i + 1] ? args[i + 1] : null
  }
  const lieu = get('--lieu') || ''
  const sep = lieu.indexOf('/')
  const demandeExecute = args.includes('--execute')
  const confirme = (env || {}).ACIDE_EXECUTE_CONFIRM === 'OUI'
  return {
    mode: demandeExecute && confirme ? 'execute' : 'report',
    refus: demandeExecute && !confirme,
    ficheId: get('--fiche') || '',
    lieuType: sep > -1 ? lieu.slice(0, sep) : lieu,
    lieuId: sep > -1 ? lieu.slice(sep + 1) : '',
    nouveauNom: get('--nom'),
    backup: get('--backup'),
  }
}

/** @param {string} nom @param {*} [fb] @returns {Promise<Array<*>>} */
async function lireCollection(nom, fb) {
  const snap = await (fb || firebase()).db.collection(nom).get()
  return snap.docs.map((d) => Object.assign({ docId: d.id, id: d.id }, d.data()))
}

/**
 * Applique les trois gestes dans UNE transaction, journal en tête.
 * Fail-loud : fiche ou solde modifié depuis le rapport = échec, rien n'est écrit.
 * @param {*} plan @param {{lieu_type:string, lieu_id:string}} lieu @param {*} [fb]
 * @returns {Promise<string>} id du document d'audit
 */
async function appliquerCorrection(plan, lieu, fb) {
  const { db, admin } = fb || firebase()
  const auditRef = db.collection('stock_unite_corrections').doc()
  await db.runTransaction(async (t) => {
    const ficheRef = db.collection('articles_catalog').doc(plan.fiche.id)
    const soldeRefs = plan.conversions.map((c) => db.collection('stock_balances').doc(c.docId))
    const snaps = await t.getAll(ficheRef, ...soldeRefs)
    const ficheSnap = snaps[0]
    if (!ficheSnap.exists) throw new Error('la fiche ' + plan.fiche.id + ' a disparu depuis le rapport')
    const ficheData = ficheSnap.data()
    if (String(ficheData.nom || '') !== plan.fiche.nom_avant) {
      throw new Error(
        'la fiche ' + plan.fiche.id + ' a été renommée depuis le rapport (« ' +
          plan.fiche.nom_avant + ' » -> « ' + String(ficheData.nom || '') + ' ») — relancer --report'
      )
    }
    const soldesAvant = []
    for (let i = 0; i < plan.conversions.length; i++) {
      const s = snaps[i + 1]
      const c = plan.conversions[i]
      if (!s.exists) throw new Error('le solde ' + c.docId + ' a disparu depuis le rapport')
      const data = s.data()
      const balance = Number(data.balance) || 0
      if (Math.round(balance * 100) !== Math.round(c.balance_avant * 100)) {
        throw new Error(
          'le solde ' + c.docId + ' a changé depuis le rapport (' + c.balance_avant +
            ' -> ' + balance + ') — relancer --report'
        )
      }
      soldesAvant.push({
        docId: c.docId,
        article_ref: data.article_ref == null ? '' : String(data.article_ref),
        article_nom: data.article_nom == null ? '' : String(data.article_nom),
        lieu_type: data.lieu_type == null ? '' : String(data.lieu_type),
        lieu_id: data.lieu_id == null ? '' : String(data.lieu_id),
        balance,
        unite: data.unite == null ? '' : String(data.unite),
      })
    }
    // Journal AVANT mutation : aucune correction sans sa trace de retour arrière.
    t.set(auditRef, {
      at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'scripts/corriger-unite-stock.js',
      decision: plan.decision,
      facteur_kg_par_litre: plan.facteur,
      lieu_type: lieu.lieu_type,
      lieu_id: lieu.lieu_id,
      fiche_avant: {
        id: plan.fiche.id,
        nom: plan.fiche.nom_avant,
        unite: plan.fiche.unite_avant,
      },
      fiche_apres: { id: plan.fiche.id, nom: plan.fiche.nom_apres, unite: plan.fiche.unite_apres },
      soldes_avant: soldesAvant,
      soldes_apres: plan.conversions.map((c) => ({
        docId: c.docId,
        balance: c.balance_apres,
        unite: c.unite_apres,
      })),
      soldes_inchanges: plan.inchanges,
    })
    t.set(
      ficheRef,
      { nom: plan.fiche.nom_apres, unite: plan.fiche.unite_apres, updated_at: Date.now() },
      { merge: true }
    )
    for (const c of plan.conversions) {
      // Valeur ABSOLUE ici, et c'est voulu : ce n'est pas un cumul, c'est une
      // RE-EXPRESSION du même stock dans une autre unité. La relecture
      // ci-dessus garantit qu'aucun mouvement n'est passé entre-temps.
      t.set(
        db.collection('stock_balances').doc(c.docId),
        { balance: c.balance_apres, unite: c.unite_apres, updated_at: Date.now() },
        { merge: true }
      )
    }
  })
  return auditRef.id
}

/** @param {string[]} [argv] @param {*} [fb] @returns {Promise<*>} */
async function main(argv, fb) {
  const opts = parseArgs(argv || process.argv, process.env)
  if (opts.refus) {
    console.error(
      '[REFUS] --execute MODIFIE une fiche catalogue et des soldes de stock, et exige\n' +
        '        ACIDE_EXECUTE_CONFIRM=OUI dans l\'environnement.\n' +
        '        Sans GO explicite d\'Omar, rester en rapport.'
    )
    process.exitCode = 2
    return { plan: null, audit_id: null }
  }
  if (!opts.ficheId || !opts.lieuType || !opts.lieuId) {
    console.error(
      '[REFUS] --fiche <id> et --lieu <type/id> sont obligatoires.\n' +
        '        Aucun défaut : un article visé par accident est un stock corrompu.'
    )
    process.exitCode = 2
    return { plan: null, audit_id: null }
  }
  console.log(
    'CORRECTION D\'UNITÉ — ' +
      (opts.mode === 'execute' ? 'EXÉCUTION' : 'RAPPORT (lecture seule)')
  )

  const [soldesTous, fiches] = await Promise.all([
    lireCollection('stock_balances', fb),
    lireCollection('articles_catalog', fb),
  ])
  const fiche = fiches.find((f) => String(f.id) === opts.ficheId)
  const nouveauNom =
    opts.nouveauNom || (fiche ? String(fiche.nom || '').replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/i, '').trim() : '')

  // Soldes du LIEU dont l'identité se rattache à cette fiche. On passe par
  // l'identité canonique, pas par une comparaison de libellés : c'est la même
  // règle que la re-clé, sinon les deux outils ne parleraient pas du même stock.
  const identite = require(path.resolve(__dirname, '../functions/lib/stock/identiteArticle'))
  const idx = identite.indexerFiches(fiches)
  const soldes = soldesTous.filter((s) => {
    if (String(s.lieu_type) !== opts.lieuType || String(s.lieu_id) !== opts.lieuId) return false
    const r = identite.resoudreIdentite(s.article_ref, idx)
    return r.issue === identite.ISSUE_RESOLU && r.ficheId === opts.ficheId
  })

  const plan = correction.planifierCorrection({
    ficheId: opts.ficheId,
    nouveauNom,
    soldes,
    fiches,
  })

  console.log('')
  console.log('Décision : ' + (plan.decision || '(aucune conversion arbitrée)'))
  console.log('Facteur retenu  : ' + (plan.facteur || 0) + ' kg/L')
  console.log('Lieu            : ' + opts.lieuType + '/' + opts.lieuId)
  if (plan.fiche) {
    console.log('')
    console.log('FICHE ' + plan.fiche.id)
    console.log('   nom   : « ' + plan.fiche.nom_avant + ' »  ->  « ' + plan.fiche.nom_apres + ' »')
    console.log('   unite : ' + plan.fiche.unite_avant + '  ->  ' + plan.fiche.unite_apres)
  }
  console.log('')
  console.log('SOLDES')
  for (const c of plan.conversions) {
    console.log(
      '   ' + c.docId + '   ' + c.balance_avant + ' ' + c.unite_avant +
        '  ->  ' + c.balance_apres + ' ' + c.unite_apres
    )
  }
  for (const i of plan.inchanges) {
    console.log('   ' + i.docId + '   ' + i.balance + ' ' + i.unite + '   (déjà en ' + correction.UNITE_CIBLE + ', inchangé)')
  }
  const totalApres =
    Math.round(
      (plan.conversions.reduce((n, c) => n + c.balance_apres, 0) +
        plan.inchanges.reduce((n, i) => n + i.balance, 0)) * 100
    ) / 100
  console.log('')
  console.log('Somme après correction (tous soldes du lieu, en ' + correction.UNITE_CIBLE + ') : ' + totalApres)

  if (!plan.ok) {
    console.log('')
    for (const r of plan.refus) console.log('⛔ REFUS — ' + r)
    process.exitCode = 1
    return { plan, audit_id: null }
  }

  // SAUVEGARDE PRÉALABLE — obligatoire en exécution, avant toute écriture.
  const cheminBackup =
    opts.mode === 'execute'
      ? opts.backup ||
        path.resolve(
          __dirname,
          '../docs/BACKUP-unite-' + opts.ficheId + '-' + new Date().toISOString().slice(0, 10) + '.json'
        )
      : opts.backup
  if (cheminBackup) {
    fs.writeFileSync(
      cheminBackup,
      JSON.stringify(
        {
          genere_le: new Date().toISOString(),
          avertissement: 'État AVANT correction d\'unité. Sert à reconstruire l\'état d\'origine.',
          decision: plan.decision,
          facteur_kg_par_litre: plan.facteur,
          fiche: fiche || null,
          soldes: soldes,
          plan,
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
    return { plan, audit_id: null }
  }

  console.log('')
  console.log('═══ EXÉCUTION ═══')
  const auditId = await appliquerCorrection(plan, { lieu_type: opts.lieuType, lieu_id: opts.lieuId }, fb)
  console.log('   ✅ fiche et soldes corrigés  (journal ' + auditId + ')')
  return { plan, audit_id: auditId }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERREUR : ' + e.message)
    process.exitCode = 1
  })
}

module.exports = { parseArgs, appliquerCorrection, main }
