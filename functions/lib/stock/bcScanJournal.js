'use strict'
// @ts-check

/**
 * Module PUR — Journal de précision du scan des bons de consommation (Lot C du
 * spec `docs/spec-scan-apprentissage.md` §4.4).
 *
 * Aucune I/O : ni réseau, ni Firestore, ni DOM. L'écriture Firestore vit dans
 * `functions/index.js` (action `save-bc-scan-journal`), la lecture dans
 * `scripts/scan-precision-report.js`. Tests : `tests/unit/bcScanJournal.test.js`.
 *
 * ── Pourquoi ce module existe ───────────────────────────────────────────────
 * Les seuils du rapprochement (`SIMILARITY_THRESHOLD = 0.75`,
 * `INCLUSION_THRESHOLD = 0.78`) ont été réglés à l'intuition puis corrigés deux
 * fois après confrontation aux vraies photos. On ne sait pas, en production, si
 * une proposition « probable » est habituellement juste ou habituellement
 * corrigée : on règle à l'aveugle. Ce module transforme ce qui se passe
 * réellement en chiffres.
 *
 * ── LE point à ne pas rater ─────────────────────────────────────────────────
 * On journalise CHAQUE ligne enregistrée, pas seulement les corrections. Une
 * ligne où la proposition a été conservée est une CONFIRMATION : c'est le
 * DÉNOMINATEUR. Un journal qui ne consigne que les corrections ne mesure rien —
 * il donnerait 100 % de correction quel que soit le réglage.
 *
 * La métrique qui compte le plus : une proposition sortie en `exact` puis
 * corrigée par le magasinier est un FAUX POSITIF AVÉRÉ. C'est exactement le
 * défaut que tout le chantier cherche à éviter, et on n'a aujourd'hui aucun
 * moyen de l'observer. Elle sort en tête du rapport.
 *
 * ── Ce module ne change RIEN au comportement du scanner ─────────────────────
 * Ni le rapprochement, ni les seuils, ni l'affichage. C'est de l'observation.
 */

const { campagneOf } = require('../mappingConso/campagneUtils')

/** Statuts initiaux connus d'une proposition, dans l'ordre d'affichage du rapport. */
const STATUTS = ['exact', 'probable', 'alias', 'unmatched']

/** Regex stricte d'une date ISO 'YYYY-MM-DD'. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Nombre maximal de lignes acceptées en une écriture de journal. Un bon papier
 * fait une quinzaine de lignes ; ce plafond borne le coût d'un appel abusif
 * sans jamais gêner l'usage réel.
 */
const MAX_LIGNES = 200

/** Taille du palmarès des libellés les plus coûteux en corrections. */
const PALMARES_TAILLE = 10

/**
 * Plafond du nombre de périodes générées d'office.
 *
 * Garde-fou contre une date aberrante : `consumption_vouchers` contient un bon
 * daté 2028-08 (coquille de saisie, mesurée le 2026-08-26). Sans plafond,
 * l'étendue 2026-08 → 2028-08 produirait un tableau de 25 lignes dont 23 vides.
 *
 * Calibré à 18 : une campagne fait 12 mois (juillet → juin), 18 laisse de la
 * marge pour un rapport à cheval sur deux campagnes tout en tranchant net sur
 * une étendue née d'une faute de saisie. Au-delà, on ne masque pas le problème
 * — le rapport DIT qu'il a tronqué et invite à borner avec --depuis/--jusqu-a.
 */
const PERIODES_MAX = 18

// ============================================================================
// NORMALISATION (écriture)
// ============================================================================

/**
 * Chaîne nettoyée, jamais null/undefined.
 * @param {*} v
 * @returns {string}
 */
function str(v) {
  return v == null ? '' : String(v).trim()
}

/**
 * Nombre fini, ou null. Un score absent doit rester ABSENT (null), jamais 0 :
 * 0 est un score légitime (« aucune similarité »), et le confondre avec
 * « non mesuré » fausserait toute moyenne.
 * @param {*} v
 * @returns {number|null}
 */
function num(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/**
 * Entier positif, ou null (même raisonnement que `num` pour les compteurs).
 * @param {*} v
 * @returns {number|null}
 */
function intOrNull(v) {
  const n = num(v)
  if (n == null) return null
  const i = Math.trunc(n)
  return i > 0 ? i : null
}

/**
 * Statut initial normalisé. Un statut inconnu (front plus récent, faute de
 * frappe) est rendu tel quel en minuscules plutôt qu'écrasé : le rapport doit
 * pouvoir SIGNALER un statut qu'il ne connaît pas, pas le faire disparaître
 * dans un fourre-tout.
 * @param {*} v
 * @param {string} propose Proposition ; sans proposition, le statut est `unmatched`.
 * @returns {string}
 */
function statut(v, propose) {
  const s = str(v).toLowerCase()
  if (!s) return propose ? 'probable' : 'unmatched'
  return s
}

/**
 * Normalise UNE ligne du journal telle qu'envoyée par le front.
 *
 * Renvoie null si la ligne ne porte aucune information exploitable (rien lu,
 * rien proposé, rien retenu) : journaliser une ligne vide gonfle la collection
 * sans rien mesurer.
 *
 * @param {Object} raw Ligne brute (champs du front `MagBCScanModal`).
 * @returns {Object|null} Ligne normalisée, ou null si inexploitable.
 */
function normalizeJournalLigne(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}

  const articleLu = str(r.article_lu)
  const articlePropose = str(r.article_propose)
  const articleChoisi = str(r.article_choisi)
  const parcelleLue = str(r.parcelle_lue)
  const parcelleProposee = str(r.parcelle_proposee)
  const parcelleChoisie = str(r.parcelle_choisie)

  if (!articleLu && !articlePropose && !articleChoisi
    && !parcelleLue && !parcelleProposee && !parcelleChoisie) return null

  return {
    article_lu: articleLu,
    article_propose: articlePropose,
    article_choisi: articleChoisi,
    article_status_initial: statut(r.article_status_initial, articlePropose),
    article_score: num(r.article_score),
    article_alias_count: intOrNull(r.article_alias_count),
    parcelle_lue: parcelleLue,
    parcelle_proposee: parcelleProposee,
    parcelle_choisie: parcelleChoisie,
    parcelle_status_initial: statut(r.parcelle_status_initial, parcelleProposee),
    parcelle_score: num(r.parcelle_score),
    parcelle_alias_count: intOrNull(r.parcelle_alias_count),
  }
}

/**
 * Construit les documents `bc_scan_corrections` d'un bon enregistré.
 *
 * La campagne est DÉRIVÉE de la date côté serveur (`campagneUtils.campagneOf`)
 * et non reprise du body : c'est une donnée d'analyse, elle doit être cohérente
 * avec la date du bon quoi qu'envoie le client.
 *
 * @param {Object} args
 * @param {string} args.date Date du bon 'YYYY-MM-DD'.
 * @param {*} [args.bon_numero] Numéro du bon créé.
 * @param {Array<Object>} [args.lignes] Lignes brutes envoyées par le front.
 * @param {Object} [args.corrige_par] `{uid, profileId, name}` résolu SERVEUR.
 * @param {number} [args.now] Horodatage (ms) — injecté pour les tests.
 * @returns {{ok: boolean, error?: string, campagne?: string, docs?: Array<Object>, ignorees?: number}}
 */
function buildJournalDocs(args) {
  const a = args && typeof args === 'object' ? args : {}
  const date = str(a.date)
  if (!ISO_DATE_RE.test(date)) return { ok: false, error: 'date invalide (YYYY-MM-DD attendu)' }

  const campagne = campagneOf(date)
  if (!campagne) return { ok: false, error: 'campagne indéterminable depuis la date' }

  const lignes = Array.isArray(a.lignes) ? a.lignes : []
  if (!lignes.length) return { ok: false, error: 'aucune ligne à journaliser' }
  if (lignes.length > MAX_LIGNES) return { ok: false, error: 'trop de lignes (max ' + MAX_LIGNES + ')' }

  const by = a.corrige_par && typeof a.corrige_par === 'object' ? a.corrige_par : {}
  const corrigePar = {
    uid: str(by.uid),
    profileId: str(by.profileId),
    name: str(by.name),
  }
  const createdAt = Number.isFinite(a.now) ? Number(a.now) : Date.now()
  const bonNumero = str(a.bon_numero)

  const docs = []
  let ignorees = 0
  lignes.forEach((raw) => {
    const ligne = normalizeJournalLigne(raw)
    if (!ligne) { ignorees += 1; return }
    docs.push(Object.assign({
      date,
      bon_numero: bonNumero,
      campagne,
      corrige_par: corrigePar,
      created_at: createdAt,
    }, ligne))
  })

  if (!docs.length) return { ok: false, error: 'aucune ligne exploitable' }
  return { ok: true, campagne, docs, ignorees }
}

// ============================================================================
// MÉTRIQUES (lecture — script d'analyse)
// ============================================================================

/**
 * Période d'agrégation d'une entrée : le mois ISO 'YYYY-MM'.
 * Une date illisible tombe dans 'inconnue' plutôt que d'être écartée : une
 * entrée sans date est un défaut à VOIR, pas à masquer.
 * @param {Object} e
 * @returns {string}
 */
function periodeDe(e) {
  const d = str(e && e.date)
  return ISO_DATE_RE.test(d) ? d.slice(0, 7) : 'inconnue'
}

/**
 * Mois 'YYYY-MM' d'une valeur, qu'elle soit déjà un mois ou une date ISO.
 * @param {*} v
 * @returns {string} '' si illisible.
 */
function moisDe(v) {
  const s = str(v)
  if (/^\d{4}-\d{2}$/.test(s)) return s
  if (ISO_DATE_RE.test(s)) return s.slice(0, 7)
  return ''
}

/**
 * Suite CONTINUE de mois de `debut` à `fin`, bornes incluses.
 *
 * Le point de la fonction, ce sont les TROUS : les mois intermédiaires sans
 * aucune donnée doivent être générés. Sans eux, un mois entier sans bon
 * disparaît du rapport — et une absence se lit tout aussi facilement comme
 * « rien à signaler » que le 0 % qu'on refuse déjà d'afficher.
 *
 * @param {*} debut Mois ou date ISO.
 * @param {*} fin Mois ou date ISO.
 * @returns {Array<string>} Mois 'YYYY-MM' croissants, [] si bornes invalides ou inversées.
 */
function periodesEntre(debut, fin) {
  const a = moisDe(debut)
  const b = moisDe(fin)
  if (!a || !b) return []
  // Bornes inversées : pas de garde explicite, la condition de boucle ci-dessous
  // ne s'exécute simplement jamais (vérifié par mutation — une garde `a > b`
  // supplémentaire était du code mort, aucun test ne pouvait la distinguer).
  const out = []
  let y = parseInt(a.slice(0, 4), 10)
  let m = parseInt(a.slice(5, 7), 10)
  const yb = parseInt(b.slice(0, 4), 10)
  const mb = parseInt(b.slice(5, 7), 10)
  while (y < yb || (y === yb && m <= mb)) {
    out.push(String(y) + '-' + String(m).padStart(2, '0'))
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/**
 * Périodes à faire figurer dans le rapport, MÊME sans aucune ligne.
 *
 * Bornes : `depuis` / `jusqu_a` s'ils sont fournis (une plage demandée mais
 * vide doit se voir), sinon l'étendue réellement observée dans les données.
 *
 * @param {Array<Object>} entries Documents du journal.
 * @param {Object} [options]
 * @param {*} [options.depuis] Borne basse (mois ou date ISO).
 * @param {*} [options.jusqu_a] Borne haute (mois ou date ISO).
 * @param {number} [options.max] Plafond de périodes générées (défaut PERIODES_MAX).
 * @returns {{periodes: Array<string>, tronquee: boolean}} `tronquee` = plage trop
 *   large (date aberrante) : on retombe sur les seuls mois observés, et le
 *   rapport DOIT le dire plutôt que de laisser croire à une couverture complète.
 */
function periodesCouvertes(entries, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : []
  const observees = list.map((e) => moisDe(e.date)).filter(Boolean).sort()

  const debut = moisDe(opts.depuis) || observees[0] || ''
  const fin = moisDe(opts.jusqu_a) || observees[observees.length - 1] || ''
  const max = Number.isFinite(opts.max) ? Number(opts.max) : PERIODES_MAX

  const plage = periodesEntre(debut, fin)
  if (!plage.length) return { periodes: [], tronquee: false }
  if (plage.length > max) {
    return { periodes: Array.from(new Set(observees)), tronquee: true }
  }
  return { periodes: plage, tronquee: false }
}

/**
 * Taux borné à [0,1], ou null si le dénominateur est nul.
 *
 * ⚠️ null, JAMAIS 0. « 0 correction sur 0 ligne » n'est pas « 0 % de
 * correction » : c'est « on ne sait pas ». Rendre 0 ferait passer une période
 * sans donnée pour une période parfaite — exactement le faux vert que ce lot
 * existe pour éviter.
 * @param {number} n
 * @param {number} d
 * @returns {number|null}
 */
function taux(n, d) {
  if (!d) return null
  return n / d
}

/**
 * Lecture d'un côté (article ou parcelle) d'une entrée, sous une forme unique.
 * @param {Object} e Entrée du journal.
 * @param {'article'|'parcelle'} cote
 * @returns {{lu: string, propose: string, choisi: string, status: string, score: number|null, aliasCount: number|null}}
 */
function coteDe(e, cote) {
  const suffixeLu = cote === 'article' ? 'article_lu' : 'parcelle_lue'
  const suffixeProp = cote === 'article' ? 'article_propose' : 'parcelle_proposee'
  const suffixeChoisi = cote === 'article' ? 'article_choisi' : 'parcelle_choisie'
  const propose = str(e[suffixeProp])
  return {
    lu: str(e[suffixeLu]),
    propose,
    choisi: str(e[suffixeChoisi]),
    status: statut(e[cote + '_status_initial'], propose),
    score: num(e[cote + '_score']),
    aliasCount: intOrNull(e[cote + '_alias_count']),
  }
}

/**
 * Accumulateur vide pour un côté.
 * @returns {Object}
 */
function videCote() {
  return {
    lignes: 0,
    proposees: 0,
    renseignees: 0,
    conservees: 0,
    corrigees: 0,
    par_statut: {},
    palmares: {},
  }
}

/**
 * Accumulateur vide pour un statut initial.
 * @returns {{lignes: number, conservees: number, corrigees: number, scores: number[]}}
 */
function videStatut() {
  return { lignes: 0, conservees: 0, corrigees: 0, scores: [] }
}

/**
 * Intègre une entrée dans un accumulateur de côté.
 * @param {Object} acc
 * @param {Object} e Entrée du journal.
 * @param {'article'|'parcelle'} cote
 */
function accumule(acc, e, cote) {
  const c = coteDe(e, cote)
  acc.lignes += 1
  if (c.propose) acc.proposees += 1
  if (!c.choisi) return // rien de retenu : ni confirmation ni correction

  acc.renseignees += 1
  const corrige = c.choisi !== c.propose
  if (corrige) acc.corrigees += 1
  else acc.conservees += 1

  if (!acc.par_statut[c.status]) acc.par_statut[c.status] = videStatut()
  const s = acc.par_statut[c.status]
  s.lignes += 1
  if (corrige) s.corrigees += 1
  else s.conservees += 1
  if (c.score != null) s.scores.push(c.score)

  // Palmarès : ce qui a été LU. C'est le libellé du magasinier qu'on cherche à
  // enseigner ou à nettoyer, pas la valeur du catalogue.
  const cle = c.lu
  if (!cle) return
  if (!acc.palmares[cle]) acc.palmares[cle] = { libelle: cle, lignes: 0, corrigees: 0 }
  acc.palmares[cle].lignes += 1
  if (corrige) acc.palmares[cle].corrigees += 1
}

/**
 * Fige un accumulateur de côté en rapport lisible.
 * @param {Object} acc
 * @returns {Object}
 */
function figeCote(acc) {
  const parStatut = {}
  const noms = Object.keys(acc.par_statut)
  // Statuts connus d'abord (ordre stable du rapport), puis les inattendus,
  // triés — un rapport dont l'ordre bouge d'un run à l'autre est illisible.
  const inattendus = noms.filter((n) => STATUTS.indexOf(n) === -1).sort()
  STATUTS.concat(inattendus).forEach((nom) => {
    const s = acc.par_statut[nom]
    if (!s) return
    parStatut[nom] = {
      lignes: s.lignes,
      conservees: s.conservees,
      corrigees: s.corrigees,
      taux_correction: taux(s.corrigees, s.lignes),
      score_moyen: s.scores.length
        ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length
        : null,
    }
  })

  const palmares = Object.keys(acc.palmares)
    .map((k) => {
      const p = acc.palmares[k]
      return {
        libelle: p.libelle,
        lignes: p.lignes,
        corrigees: p.corrigees,
        taux_correction: taux(p.corrigees, p.lignes),
      }
    })
    .filter((p) => p.corrigees > 0)
    // Tri déterministe : corrections décroissantes, puis libellé alphabétique.
    .sort((a, b) => (b.corrigees - a.corrigees) || (a.libelle < b.libelle ? -1 : a.libelle > b.libelle ? 1 : 0))
    .slice(0, PALMARES_TAILLE)

  const alias = parStatut.alias || null
  const exact = parStatut.exact || null

  return {
    lignes: acc.lignes,
    proposees: acc.proposees,
    taux_prefill: taux(acc.proposees, acc.lignes),
    renseignees: acc.renseignees,
    conservees: acc.conservees,
    corrigees: acc.corrigees,
    taux_correction: taux(acc.corrigees, acc.renseignees),
    par_statut: parStatut,
    // FAUX POSITIFS AVÉRÉS : une proposition `exact` que l'humain a corrigée.
    faux_positifs: exact ? exact.corrigees : 0,
    // Efficacité des alias : un alias mémorisé est-il conservé, ou re-corrigé ?
    alias: alias
      ? {
        lignes: alias.lignes,
        conservees: alias.conservees,
        corrigees: alias.corrigees,
        taux_conservation: taux(alias.conservees, alias.lignes),
      }
      : { lignes: 0, conservees: 0, corrigees: 0, taux_conservation: null },
    palmares,
  }
}

/**
 * Calcule le rapport de précision d'un jeu d'entrées du journal.
 *
 * @param {Array<Object>} entries Documents `bc_scan_corrections`.
 * @param {Object} [options]
 * @param {Array<string>} [options.periodes] Périodes 'YYYY-MM' à faire figurer
 *   MÊME si aucune ligne ne s'y rattache. Une période vide doit apparaître avec
 *   des taux `null` : son absence du rapport se lirait à tort comme « rien à
 *   signaler » alors que c'est « rien à mesurer ».
 * @returns {Object} Rapport global + par période.
 */
function computeScanPrecision(entries, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : []

  const globalAcc = { article: videCote(), parcelle: videCote() }
  /** @type {Object<string, {article: Object, parcelle: Object}>} */
  const parPeriode = {}

  const forcees = Array.isArray(opts.periodes) ? opts.periodes.map(str).filter(Boolean) : []
  forcees.forEach((p) => { parPeriode[p] = { article: videCote(), parcelle: videCote() } })

  list.forEach((e) => {
    const p = periodeDe(e)
    if (!parPeriode[p]) parPeriode[p] = { article: videCote(), parcelle: videCote() }
    accumule(globalAcc.article, e, 'article')
    accumule(globalAcc.parcelle, e, 'parcelle')
    accumule(parPeriode[p].article, e, 'article')
    accumule(parPeriode[p].parcelle, e, 'parcelle')
  })

  const article = figeCote(globalAcc.article)
  const parcelle = figeCote(globalAcc.parcelle)

  const periodes = Object.keys(parPeriode).sort().map((p) => ({
    periode: p,
    lignes: parPeriode[p].article.lignes,
    article: figeCote(parPeriode[p].article),
    parcelle: figeCote(parPeriode[p].parcelle),
  }))

  return {
    lignes: list.length,
    bons: new Set(list.map((e) => str(e.bon_numero)).filter(Boolean)).size,
    // En TÊTE du rapport : c'est le chiffre qui décide s'il faut resserrer les
    // seuils. Tout le reste est du réglage de confort.
    faux_positifs: {
      article: article.faux_positifs,
      parcelle: parcelle.faux_positifs,
      total: article.faux_positifs + parcelle.faux_positifs,
    },
    article,
    parcelle,
    periodes,
  }
}

module.exports = {
  STATUTS,
  MAX_LIGNES,
  PALMARES_TAILLE,
  PERIODES_MAX,
  normalizeJournalLigne,
  buildJournalDocs,
  computeScanPrecision,
  periodeDe,
  moisDe,
  periodesEntre,
  periodesCouvertes,
}
