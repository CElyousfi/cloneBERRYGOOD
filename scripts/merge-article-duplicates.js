'use strict'
// @ts-check

/**
 * Fusion EN MASSE des articles en doublon de `articles_catalog`.
 *
 * ── CE QUE CE SCRIPT N'EST PAS ────────────────────────────────────────────
 * Il ne réimplémente AUCUNE logique de fusion. Toute la sûreté (réassignation
 * des seuls mouvements/BDC ouverts, agrégation atomique des soldes par lieu,
 * document d'audit `article_merges` avec snapshot de rollback) vit dans
 * l'action `merge-articles` de functions/index.js, déjà livrée et testée. Ce
 * script ORCHESTRE : il détecte les groupes, applique la règle de choix de la
 * fiche maître, et appelle l'action — en preview d'abord, en execute seulement
 * sur demande explicite.
 *
 * ── UNE SEULE RÈGLE DE CHOIX DANS LE DÉPÔT ────────────────────────────────
 * La règle vit dans `functions/lib/stockMerge/masterSuggestion.js`, module pur
 * partagé avec la pop-up de fusion (`scripts/lib/articleMasterPick.js` n'en
 * est plus qu'un ré-export). Cascade à priorité explicite :
 *   1. une seule fiche avec `prix_pmp > 0`                        -> elle
 *   2. sinon, si AUCUN PMP : une seule avec `prix_ht > 0`         -> elle
 *   3. sinon, si AUCUN prix : une seule avec `nb_achats > 0`      -> elle
 *   4. sinon : NON TRANCHÉ (le script refuse alors d'exécuter).
 * Mesuré sur les 105 groupes de production : 78 tranchés par un prix
 * (niveaux 1 et 2), 27 par `nb_achats`, 0 non tranché.
 *
 * Avant l'unification, ce script portait sa propre règle (`prix_pmp` seul) et
 * désignait une fiche DIFFÉRENTE de l'écran sur 26 groupes, sans que rien ne
 * le signale.
 *
 * ── DEUX TEMPS, LECTURE SEULE PAR DÉFAUT ──────────────────────────────────
 *   node scripts/merge-article-duplicates.js                  # --report (défaut)
 *   node scripts/merge-article-duplicates.js --report
 *   node scripts/merge-article-duplicates.js --execute        # ÉCRIT
 *
 * Sans `--execute`, RIEN n'est écrit : seuls des GET et des POST
 * `mode: "preview"` (qui ne muent rien) sont émis.
 *
 * Options :
 *   --base-url <url>   défaut : https://berrygood-farms-dashboard.web.app
 *   --limit <n>        ne traite que les n premiers groupes (mise au point)
 *   --json <fichier>   écrit le rapport machine (JSON) en plus du texte
 *
 * ── AUTHENTIFICATION ──────────────────────────────────────────────────────
 * `merge-articles` et `suggest-article-duplicates` exigent STRICTEMENT
 * `resolveCallerRole(authUser) === 'achats'`, rôle résolu serveur depuis
 * `users/{uid}.profileId`. Le script ne contourne ni n'élargit cette garde :
 * il faut les identifiants d'un compte dont le profil EST `achats`.
 *
 *   export SB_MERGE_EMAIL='<compte profil achats>'
 *   export SB_MERGE_PASSWORD='<mot de passe>'
 *   node scripts/merge-article-duplicates.js --report
 *
 * (`SB_IMPORT_EMAIL`/`SB_IMPORT_PASSWORD` puis `QA_TEST_EMAIL`/`QA_TEST_PASSWORD`
 * sont acceptés en repli, comme dans scripts/import-budget-campagne.js.)
 * Si le compte d'Omar est en profil `dg`, il faut basculer de profil : élargir
 * la garde serveur est une décision d'architecte, pas de ce script.
 *
 * ── DURÉE ATTENDUE ET RISQUE DE TIMEOUT ───────────────────────────────────
 * Chaque appel `merge-articles` — en preview comme en execute — scanne CINQ
 * collections entières (stock_movements, purchase_orders, stock_balances,
 * delivery_notes, invoices). Un run complet sur les 105 paires en fait donc
 * 105 en `--report`, puis 105 de plus en `--execute` : ~210 balayages.
 * Compter plusieurs minutes, et davantage si les collections ont grossi. Il n'y
 * a aucun risque pour les données (chaque fusion est atomique et auditée), mais
 * la CF est plafonnée à 540 s par appel et un run long peut se heurter à un
 * timeout réseau côté client.
 * Dérisquer avec `--limit <n>` : traiter par lots de 10 à 20 paires, relancer.
 * Le script est idempotent au niveau du lot — les paires déjà fusionnées ne
 * ressortent plus de `suggest-article-duplicates` (le doublon est `active:false`).
 *
 * ── LIMITES CONNUES, HORS PÉRIMÈTRE ───────────────────────────────────────
 * 1. `update-article` (functions/index.js) autorise `nom` dans ses champs
 *    modifiables SANS résolution par nom normalisé : renommer un article vers
 *    un nom déjà porté par un autre recrée un doublon. Comportement
 *    PRÉEXISTANT, hors des trois chemins de création traités par ce lot.
 * 2. `create-article` renvoie `existing_article: true` + un message quand il a
 *    mis à jour une fiche existante au lieu d'en créer une, mais AUCUN des
 *    trois écrans appelants (public/app.jsx) ne lit ce drapeau : l'utilisateur
 *    voit toujours « création réussie ». L'API est correcte, c'est le frontend
 *    qui n'écoute pas. À traiter dans un lot FRONTEND — `public/app.jsx` est
 *    une ressource exclusive, occupée par une autre session.
 *
 * ── ARRÊT À LA PREMIÈRE ANOMALIE ──────────────────────────────────────────
 * `--execute` refuse de démarrer si UN SEUL groupe est non tranché ou
 * incohérent (pré-validation tout-ou-rien), puis s'arrête à la première
 * fusion qui échoue — les fusions déjà passées gardent chacune leur document
 * d'audit avec snapshot de rollback.
 */

const fs = require('fs')
const path = require('path')

const PROJECT_DIR = path.resolve(__dirname, '..')
// Ré-export du module pur partagé avec la pop-up de fusion : une SEULE règle
// de choix du maître dans le dépôt (cf. scripts/lib/articleMasterPick.js).
const {
  choisirMaster,
  pmpArticle,
  prixHtArticle,
  nbAchatsArticle,
  REGLE_PMP,
  REGLE_PRIX_HT,
  REGLE_NB_ACHATS,
} = require('./lib/articleMasterPick')

const BASE_URL_PAR_DEFAUT = 'https://berrygood-farms-dashboard.web.app'

/**
 * Lit les arguments de ligne de commande.
 * @param {string[]} argv
 * @returns {{mode: ('report'|'execute'), baseUrl: string, limit: (number|null), json: (string|null)}}
 */
function parseArgs(argv) {
  const args = argv.slice(2)
  const get = (flag) => {
    const i = args.indexOf(flag)
    return i > -1 && args[i + 1] ? args[i + 1] : null
  }
  const limitRaw = get('--limit')
  return {
    mode: args.includes('--execute') ? 'execute' : 'report',
    baseUrl: (get('--base-url') || BASE_URL_PAR_DEFAUT).replace(/\/+$/, ''),
    limit: limitRaw && /^\d+$/.test(limitRaw) ? parseInt(limitRaw, 10) : null,
    json: get('--json'),
  }
}

/**
 * ID token Firebase d'un compte de profil `achats` (identifiants par variables
 * d'environnement — jamais en dur, jamais committés).
 * @returns {Promise<string>}
 */
async function authenticate() {
  const email =
    process.env.SB_MERGE_EMAIL || process.env.SB_IMPORT_EMAIL || process.env.QA_TEST_EMAIL
  const password =
    process.env.SB_MERGE_PASSWORD || process.env.SB_IMPORT_PASSWORD || process.env.QA_TEST_PASSWORD
  if (!email || !password) {
    throw new Error(
      'SB_MERGE_EMAIL / SB_MERGE_PASSWORD absents — un compte de profil `achats` est requis ' +
        '(la garde serveur de merge-articles est stricte, on ne la contourne pas)'
    )
  }
  const html = fs.readFileSync(path.join(PROJECT_DIR, 'public/index.html'), 'utf8')
  const m = html.match(/apiKey:\s*"([^"]+)"/)
  if (!m) throw new Error('apiKey Firebase introuvable dans public/index.html')
  const res = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + m[1],
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  )
  const json = await res.json()
  if (!res.ok || !json.idToken) {
    throw new Error(
      'Authentification échouée : ' + ((json.error && json.error.message) || res.status)
    )
  }
  return json.idToken
}

/**
 * GET authentifié sur /api/stock (LECTURE SEULE).
 * @param {string} baseUrl @param {string} token @param {string} query
 * @returns {Promise<*>}
 */
async function apiGet(baseUrl, token, query) {
  const res = await fetch(baseUrl + '/api/stock?' + query, {
    headers: { Authorization: 'Bearer ' + token },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || !json.success) {
    throw new Error('Lecture « ' + query + ' » échouée : ' + ((json && json.error) || res.status))
  }
  return json
}

/**
 * POST authentifié sur /api/stock. Retourne la réponse SANS lever, pour que
 * l'appelant décide (le rapport veut voir l'erreur d'un groupe, pas mourir).
 * @param {string} baseUrl @param {string} token @param {string} action @param {*} body
 * @returns {Promise<{ok: boolean, status: number, json: *}>}
 */
async function apiPost(baseUrl, token, action, body) {
  const res = await fetch(baseUrl + '/api/stock?action=' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { ok: res.ok && !!json && json.success === true, status: res.status, json }
}

/**
 * Rattache chaque article d'un groupe à sa fiche COMPLÈTE du catalogue.
 *
 * `suggest-article-duplicates` renvoie `reference: data.reference || d.id`,
 * alors que `merge-articles` résout par `doc(<id>)`. Quand les deux diffèrent,
 * la fusion partirait en 404 : on résout donc explicitement l'id de document,
 * et on signale l'écart.
 *
 * @param {Array<{reference: string, nom: string}>} groupArticles
 * @param {Map<string,*>} byId @param {Map<string,*>} byReference
 * @returns {{articles: Array<*>, incoherences: string[]}}
 */
function hydrateGroup(groupArticles, byId, byReference) {
  const articles = []
  const incoherences = []
  for (const a of groupArticles) {
    const full = byId.get(a.reference) || byReference.get(a.reference)
    if (!full) {
      incoherences.push('fiche introuvable dans list-articles : ' + a.reference)
      continue
    }
    if (full.id !== a.reference) {
      incoherences.push(
        'docId (' + full.id + ') != champ reference (' + a.reference + ') — fusion faite sur le docId'
      )
    }
    articles.push(full)
  }
  return { articles, incoherences }
}

/** @param {number} n @returns {string} */
function fmt(n) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '—'
}

/**
 * Rend le rapport texte d'un groupe.
 * @param {*} g entrée du plan
 * @returns {string[]} lignes
 */
function renderGroup(g) {
  const L = []
  L.push('')
  L.push('── ' + g.normalized.toUpperCase())
  if (!g.pick.decidable) {
    L.push('   ⛔ NON TRANCHÉ : ' + g.pick.raison)
    for (const a of g.articles) {
      L.push(
        '      · ' + a.id + '  | cat=' + (a.categorie || '—') +
        ' | pmp=' + fmt(pmpArticle(a)) + ' | ht=' + fmt(prixHtArticle(a)) +
        ' | nb_achats=' + nbAchatsArticle(a)
      )
    }
    return L
  }
  const m = g.pick.master
  L.push(
    '   MAÎTRE   ' + m.id + '  (règle « ' + g.pick.regle +' » : ' + g.pick.raison + ')'
  )
  for (const d of g.pick.doublons) {
    L.push(
      '   ABSORBÉE ' + d.id + '  | cat=' + (d.categorie || '—') +
      ' | pmp=' + fmt(pmpArticle(d)) + ' | ht=' + fmt(prixHtArticle(d)) +
      ' | nb_achats=' + nbAchatsArticle(d)
    )
  }
  for (const i of g.incoherences) L.push('   ⚠️  ' + i)
  if (g.previewError) {
    L.push('   ⛔ preview refusée : ' + g.previewError)
    return L
  }
  const p = g.preview
  L.push(
    '   À réassigner : ' + p.open_movements + ' mouvement(s) ouvert(s), ' +
    p.open_bdc + ' BDC ouvert(s)'
  )
  if (!p.aggregated_balances.length) {
    L.push('   Soldes       : aucun solde porté par la fiche absorbée')
  }
  for (const b of p.aggregated_balances) {
    L.push(
      '   Solde ' + b.lieu_type + '/' + b.lieu_id + ' : maître ' + fmt(b.master_current) +
      ' + doublon ' + fmt(b.doublon_sum) + ' = ' + fmt(b.resulting) + ' ' + (b.unite || '')
    )
  }
  const u = p.untouched
  L.push(
    '   INTACT       : ' + u.historical_movements + ' mouvement(s) historique(s) (dont ' +
    u.validated_movements + ' validé(s)), ' + u.closed_bdc + ' BDC clôturé(s), ' +
    u.delivery_notes + ' BL, ' + u.invoices + ' facture(s)'
  )
  return L
}

/**
 * Construit le plan de fusion : détection, choix du maître, preview par groupe.
 * @param {string} baseUrl @param {string} token @param {number|null} limit
 * @returns {Promise<{plan: Array<*>, catalogue: number}>}
 */
async function buildPlan(baseUrl, token, limit) {
  const sugg = await apiGet(baseUrl, token, 'action=suggest-article-duplicates')
  const list = await apiGet(baseUrl, token, 'action=list-articles')
  const byId = new Map()
  const byReference = new Map()
  for (const a of list.articles || []) {
    byId.set(a.id, a)
    if (a.reference && !byReference.has(a.reference)) byReference.set(a.reference, a)
  }

  let groups = sugg.groups || []
  if (limit) groups = groups.slice(0, limit)

  const plan = []
  for (const grp of groups) {
    const { articles, incoherences } = hydrateGroup(grp.articles || [], byId, byReference)
    const pick = choisirMaster(articles)
    const entry = {
      normalized: grp.normalized,
      articles,
      incoherences,
      pick,
      preview: null,
      previewError: null,
    }
    if (pick.decidable) {
      const r = await apiPost(baseUrl, token, 'merge-articles', {
        master_ref: pick.master.id,
        doublon_refs: pick.doublons.map((d) => d.id),
        mode: 'preview',
      })
      if (r.ok) entry.preview = r.json.preview
      else entry.previewError = (r.json && r.json.error) || 'HTTP ' + r.status
    }
    plan.push(entry)
  }
  return { plan, catalogue: (list.articles || []).length }
}

/**
 * Exécute le plan, groupe par groupe, en s'arrêtant à la première anomalie.
 * @param {string} baseUrl @param {string} token @param {Array<*>} plan
 * @returns {Promise<Array<*>>} résultats par groupe
 */
async function executePlan(baseUrl, token, plan) {
  const resultats = []
  for (const g of plan) {
    const r = await apiPost(baseUrl, token, 'merge-articles', {
      master_ref: g.pick.master.id,
      doublon_refs: g.pick.doublons.map((d) => d.id),
      mode: 'execute',
    })
    if (!r.ok) {
      resultats.push({
        normalized: g.normalized,
        ok: false,
        error: (r.json && r.json.error) || 'HTTP ' + r.status,
      })
      console.log('   ⛔ ' + g.normalized + ' : ' + resultats[resultats.length - 1].error)
      console.log('\nARRÊT à la première anomalie. Les fusions précédentes sont acquises')
      console.log('(chacune a son document d\'audit `article_merges` avec snapshot de rollback).')
      return resultats
    }
    resultats.push({
      normalized: g.normalized,
      ok: true,
      audit_id: r.json.audit_id,
      counts: r.json.counts,
    })
    console.log(
      '   ✅ ' + g.normalized + '  → maître ' + g.pick.master.id + '  (audit ' + r.json.audit_id + ')'
    )
  }
  return resultats
}

async function main() {
  const opts = parseArgs(process.argv)
  const token = await authenticate()

  console.log('FUSION DES ARTICLES EN DOUBLON — ' + (opts.mode === 'execute' ? 'EXÉCUTION' : 'RAPPORT (lecture seule)'))
  console.log('API : ' + opts.baseUrl + '/api/stock')

  const { plan, catalogue } = await buildPlan(opts.baseUrl, token, opts.limit)

  const decides = plan.filter((g) => g.pick.decidable && !g.previewError)
  const bloques = plan.filter((g) => !g.pick.decidable || g.previewError)
  const parPmp = decides.filter((g) => g.pick.regle === REGLE_PMP)
  const parPrixHt = decides.filter((g) => g.pick.regle === REGLE_PRIX_HT)
  const parAchats = decides.filter((g) => g.pick.regle === REGLE_NB_ACHATS)

  const lignes = []
  for (const g of plan) lignes.push(...renderGroup(g))
  console.log(lignes.join('\n'))

  console.log('')
  console.log('═══ SYNTHÈSE ═══')
  console.log('Fiches actives au catalogue      : ' + catalogue)
  console.log('Groupes de doublons détectés     : ' + plan.length)
  console.log('  tranchés par « prix_pmp »      : ' + parPmp.length)
  console.log('  tranchés par « prix_ht »       : ' + parPrixHt.length + '  (non valorisés : pas de PMP)')
  console.log('  tranchés par « nb_achats »     : ' + parAchats.length)
  console.log('  NON tranchés / en erreur       : ' + bloques.length)
  const aDesactiver = decides.reduce((n, g) => n + g.pick.doublons.length, 0)
  console.log('Fiches qui seraient désactivées  : ' + aDesactiver)
  console.log('Catalogue actif après fusion     : ' + (catalogue - aDesactiver))

  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify({ generated_at: new Date().toISOString(), catalogue, plan }, null, 2))
    console.log('Rapport JSON écrit : ' + opts.json)
  }

  if (opts.mode !== 'execute') {
    console.log('')
    console.log('Mode RAPPORT : aucune écriture. Relire ci-dessus, puis --execute pour appliquer.')
    return
  }

  // Pré-validation TOUT-OU-RIEN : un seul groupe douteux et on n'écrit rien.
  if (bloques.length) {
    console.error('')
    console.error(
      '⛔ ' + bloques.length + ' groupe(s) non tranché(s) ou en erreur — AUCUNE écriture.'
    )
    console.error('   Traiter ces groupes à la main dans l\'écran Catalogue, puis relancer.')
    process.exitCode = 1
    return
  }

  console.log('')
  console.log('═══ EXÉCUTION ═══')
  const resultats = await executePlan(opts.baseUrl, token, plan)
  const ok = resultats.filter((r) => r.ok).length
  console.log('')
  console.log('Fusions exécutées : ' + ok + ' / ' + plan.length)
  if (ok !== plan.length) process.exitCode = 1
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERREUR : ' + e.message)
    process.exitCode = 1
  })
}

module.exports = { parseArgs, hydrateGroup, renderGroup }
