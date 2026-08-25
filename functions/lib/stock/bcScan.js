'use strict'
// @ts-check

/**
 * Module PUR — Scan des Bons de Consommation Interne (papier) par IA vision.
 *
 * Aucune I/O réseau, aucun accès Firestore : 100 % testable en unitaire
 * (`tests/unit/bcScan.test.js`, `node:test`). L'appel Anthropic et les lectures
 * Firestore vivent dans `functions/index.js` (action `scan-bc`).
 *
 * Le bon papier est une MATRICE : colonnes = « Pile 1 … Pile 7 », chaque pile
 * portant un en-tête MANUSCRIT qui désigne une parcelle (ex. « marvilla S-3 ») ;
 * lignes = article + unité + une quantité par pile. `flattenBcScan` transforme
 * cette matrice en une liste plate d'items (une entrée par cellule non vide).
 *
 * Principe directeur du matching : JAMAIS de match forcé. En cas de doute on
 * renvoie `unmatched` — le front oblige alors l'utilisateur à trancher. Un faux
 * positif silencieux coûte bien plus cher qu'une saisie manuelle.
 */

const { normalizeArticleName } = require('../stockMerge/articleMerge')
// Culture d'une PARCELLE : source de vérité du repo, jamais redevinée ici.
// Copie backend de public/lib/cultureUtils.js (identique sur `resolveCulture`) —
// le front, lui, y accède via window.CultureUtils.
const { resolveCulture } = require('../campagneExport/cultureUtils')

/**
 * @typedef {Object} BcScanColonne
 * @property {number|string} pile Numéro de pile (1..7).
 * @property {string} [entete] En-tête manuscrit au-dessus de la colonne (parcelle).
 */

/**
 * @typedef {Object} BcScanLigne
 * @property {string} [article] Libellé article lu.
 * @property {string} [unite] Unité lue (kg / L).
 * @property {boolean} [barre] true si la ligne est rayée sur le papier.
 * @property {Object<string, *>} [quantites] Quantité par numéro de pile.
 */

/**
 * @typedef {Object} BcScanAnalysis
 * @property {string} [numero_bon]
 * @property {string} [date]
 * @property {string} [ferme]
 * @property {string} [motif]
 * @property {string} [variete]
 * @property {BcScanColonne[]} [colonnes]
 * @property {BcScanLigne[]} [lignes]
 * @property {string} [remarques]
 */

/**
 * @typedef {Object} BcScanItem
 * @property {string} article_lu Libellé article tel que lu sur le papier.
 * @property {string} unite_lue Unité telle que lue.
 * @property {number} quantite Quantité numérique (> 0).
 * @property {number|string} pile Numéro de pile d'origine.
 * @property {string} parcelle_lue En-tête manuscrit de la colonne.
 * @property {boolean} barre true si la ligne est rayée sur le papier (le front grise).
 */

/**
 * @typedef {Object} ArticleMatch
 * @property {string} article Nom du catalogue retenu ('' si non résolu).
 * @property {number} score Score de confiance 0..1.
 * @property {'alias'|'exact'|'probable'|'unmatched'} status
 * @property {number|null} aliasCount Nb de fois que l'alias a été confirmé (null hors alias).
 */

/**
 * @typedef {Object} ScanMedia
 * @property {boolean} ok
 * @property {string} [mediaType] Type MIME réel de l'image (image/jpeg|png|webp).
 * @property {'data-url'|'filename'} [source] D'où vient la déduction.
 * @property {string} [error] Message d'erreur FR si ok=false.
 */

/**
 * @typedef {Object} RefParcelle
 * @property {string} label Libellé BEE ONE (ex. 'F5- CASCADE -S13').
 * @property {string} [nom_sb] Nom d'usage Smart Berry.
 * @property {string} [culture]
 * @property {string} [ferme]
 */

/**
 * @typedef {Object} ParcelleMatch
 * @property {string} label Libellé de parcelle retenu ('' si non résolu).
 * @property {number} score Score de confiance 0..1.
 * @property {'exact'|'probable'|'unmatched'} status
 * @property {string[]} candidats Libellés candidats quand on ne tranche pas.
 */

/** Seuil de similarité (Dice bigrammes) au-dessus duquel on propose `probable`. */
const SIMILARITY_THRESHOLD = 0.75

/**
 * Seuil PROPRE à la branche « inclusion », volontairement plus haut.
 *
 * Le score d'inclusion est un simple RATIO DE LONGUEURS, pas une similarité :
 * il mesure « le libellé lu occupe X % du libellé catalogue », ce qui est un
 * signal structurellement plus faible qu'un Dice. Une inclusion peut être un
 * pur hasard de sous-chaîne. Mesuré sur le catalogue réel (1124 articles) :
 * « Ertiva » est inclus dans « FERTIVAL » et sortait à 6/8 = 0.75 PILE, donc
 * pré-sélectionné alors que ce sont deux produits différents. On demande donc
 * une preuve plus forte ici que sur la branche Dice.
 */
const INCLUSION_THRESHOLD = 0.78

/**
 * Écart minimal entre le meilleur et le second candidat pour considérer que le
 * meilleur est « nettement devant » (sinon : ambigu -> unmatched).
 */
const AMBIGUITY_MARGIN = 0.08

/**
 * Variétés connues et leurs orthographes manuscrites observées sur les bons.
 * Clé = forme canonique, valeurs = variantes (comparées sans espaces ni points).
 */
const VARIETY_ALIASES = {
  maravilla: ['maravilla', 'marvilla', 'marvila', 'maravila'],
  yasmin: ['yasmin', 'yazmin', 'niyas', 'yasminniyas'],
  // « Mya » / « Miya » : variété du secteur 9, écrite des deux façons par le
  // magasinier (« Miya S-9 » le 09/07, « yassmin niyas S-9 » les 08 et 14/07).
  // Elle coexiste avec `yasmin` : ce sont deux libellés distincts du secteur 9
  // (« F5- MYA S9 » et « F5 YAZMIN MT »), pas des orthographes l'un de l'autre.
  mya: ['mya', 'miya'],
  mtl: ['mtl'],
  reyna: ['reyna', 'reina'],
  corina: ['corina'],
  breeze: ['breeze', 'brezze'],
  cascade: ['cascade'],
  myrtille: ['myrtille', 'myrtile'],
}

/**
 * Normalise un libellé (wrapper explicite sur `normalizeArticleName` : minuscules,
 * sans diacritiques, espaces réduits). Source de vérité unique du repo.
 * @param {*} s Valeur brute.
 * @returns {string} Libellé normalisé.
 */
function normalizeLabel(s) {
  return normalizeArticleName(s)
}

/**
 * Réduit un libellé à ses caractères alphanumériques (sans espaces ni ponctuation).
 * Utilisé pour comparer « M.T.L » et « MTL », « S. Potassium » et « S Potassium ».
 * @param {*} s
 * @returns {string}
 */
function squash(s) {
  return normalizeLabel(s).replace(/[^a-z0-9]/g, '')
}

/**
 * Convertit une valeur de cellule en nombre, en acceptant la virgule décimale
 * française laissée par le modèle (« 5,25 » -> 5.25, « 1 875 » ignoré).
 * @param {*} v Valeur brute (number ou string).
 * @returns {number} Le nombre, ou NaN si non convertible.
 */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  if (typeof v !== 'string') return NaN
  const cleaned = v.trim().replace(/\s/g, '').replace(',', '.')
  if (!cleaned) return NaN
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : NaN
}

/** Types MIME image acceptés par l'appel vision. */
const ALLOWED_SCAN_MIME = ['image/jpeg', 'image/png', 'image/webp']

/** Extensions de fichier acceptées, et leur type MIME réel. */
const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * Détermine le type MIME RÉEL du scan.
 *
 * ⚠️ L'extension du nom de fichier n'est PAS une source fiable : le client
 * redimensionne et ré-encode SYSTÉMATIQUEMENT en JPEG (`public/lib/imageDownscale.js`
 * -> `canvas.toDataURL('image/jpeg')`). Une photo « bon.png » arrive donc avec
 * des octets JPEG. Annoncer `image/png` à l'API vision = 400 sur tous les
 * modèles, et un `contentType` Storage faux (pièce jointe illisible ensuite).
 * On fait donc foi au préfixe `data:<mime>;base64,` réellement présent, et on ne
 * retombe sur l'extension QUE si aucun préfixe n'est fourni.
 *
 * @param {*} scanBase64 Contenu envoyé par le client (avec ou sans préfixe data-url).
 * @param {*} filename Nom de fichier d'origine (repli uniquement).
 * @returns {ScanMedia}
 */
function resolveScanMedia(scanBase64, filename) {
  const raw = typeof scanBase64 === 'string' ? scanBase64 : ''
  const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)\s*;\s*base64,/i.exec(raw)

  if (m) {
    const declared = m[1].toLowerCase()
    if (declared === 'application/pdf') {
      return { ok: false, error: 'PDF non supporté : envoyez une photo (JPG/PNG/WEBP) du bon' }
    }
    const mime = declared === 'image/jpg' ? 'image/jpeg' : declared
    if (ALLOWED_SCAN_MIME.indexOf(mime) < 0) {
      return { ok: false, error: `Format non supporté (${declared}) : attendu JPG, PNG ou WEBP` }
    }
    return { ok: true, mediaType: mime, source: 'data-url' }
  }

  const name = String(filename == null ? '' : filename)
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') {
    return { ok: false, error: 'PDF non supporté : envoyez une photo (JPG/PNG/WEBP) du bon' }
  }
  const byExt = Object.prototype.hasOwnProperty.call(EXT_TO_MIME, ext) ? EXT_TO_MIME[ext] : ''
  if (!byExt) {
    return { ok: false, error: `Format non supporté (${ext || 'inconnu'}) : attendu JPG, PNG ou WEBP` }
  }
  return { ok: true, mediaType: byExt, source: 'filename' }
}

/**
 * Construit le prompt vision envoyé à Claude pour lire un bon de consommation.
 * `today` est INJECTÉ : on n'écrit jamais une année en dur (défaut connu du
 * prompt `scan-bon-apport`, qui force 2026).
 * @param {{today: string}} args today au format YYYY-MM-DD.
 * @returns {string} Le prompt complet.
 */
function buildBcScanPrompt(args) {
  const today = (args && args.today) || ''
  return [
    'Tu lis un formulaire papier marocain « BON DE CONSOMMATION INTERNE » de',
    'Berry Good Farms (framboise / myrtille). Le document est manuscrit.',
    '',
    'Date du jour : ' + today + '. Le bon date généralement de ce jour ou des',
    'jours précédents. Déduis l\'année de ce qui est écrit sur le bon ; si',
    'l\'année est absente ou illisible, utilise celle de la date du jour.',
    'N\'invente JAMAIS une année.',
    '',
    'STRUCTURE DU DOCUMENT :',
    '- en-tête : numéro de bon pré-imprimé (ex. « F1 0005673 »), Date (JJ/MM/AAAA),',
    '  Motif (ex. « Fertigation/Traitement »), Ferme (ex. « F1+F5 »), Variétés ;',
    '- un tableau dont les colonnes de QUANTITE sont « Pile 1 » … « Pile 7 » ;',
    '  AU-DESSUS de chaque colonne Pile, une PARCELLE est écrite À LA MAIN',
    '  (ex. « marvilla S-3 », « yasmin niyas S-9 », « M.T.L S-13-14 »).',
    '  Relis attentivement cet en-tête manuscrit : c\'est une donnée essentielle.',
    '- les lignes du tableau : DESIGNATION ARTICLE + UNITE (kg / L) + une',
    '  quantité par pile ;',
    '- un bloc REMARQUES en bas, qui contient PARFOIS une vraie ligne d\'article',
    '  supplémentaire (ex. « Acide Nitrique L 5,25 | 2 »).',
    '',
    'RÈGLES DE LECTURE :',
    '- Décimales à la française : « 5,25 » -> 5.25, « 1,875 » -> 1.875.',
    '- Dates JJ/MM/AAAA -> YYYY-MM-DD.',
    '- Une ligne (ou une valeur) RAYÉE / barrée doit être renvoyée avec',
    '  "barre": true. Ne la supprime pas : marque-la.',
    '- Les lignes d\'article écrites dans le bloc REMARQUES doivent apparaître',
    '  dans "lignes" comme des lignes normales.',
    '- Si une valeur est illisible, mets null. N\'invente JAMAIS une valeur.',
    '- Une cellule vide = pas de clé dans "quantites" (ou null).',
    '',
    'Réponds UNIQUEMENT par un objet JSON strict, sans texte avant ni après,',
    'sans bloc de code markdown, au schéma exact suivant :',
    '{',
    '  "numero_bon": "F1 0005673",',
    '  "date": "YYYY-MM-DD",',
    '  "ferme": "F1+F5",',
    '  "motif": "Fertigation/Traitement",',
    '  "variete": "Framboise",',
    '  "colonnes": [{ "pile": 1, "entete": "marvilla S-3" }],',
    '  "lignes": [{ "article": "Acide Nitrique", "unite": "L", "barre": false,',
    '               "quantites": { "1": 5.25, "2": 2 } }],',
    '  "remarques": "..."',
    '}',
  ].join('\n')
}

/**
 * Extrait et parse le JSON produit par le modèle, même noyé dans du texte.
 * @param {*} text Réponse texte brute du modèle.
 * @returns {BcScanAnalysis|null} L'objet parsé, ou null si impossible.
 */
function parseAiJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(m ? m[0] : text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch (e) {
    return null
  }
}

/**
 * Aplatit la matrice du bon en une liste d'items (une entrée par CELLULE non vide).
 *
 * ⚠️ RÈGLE CARDINALE : **aucune quantité lue ne disparaît**. Le SEUL motif de
 * filtrage est une quantité inexploitable (null/vide/0/non numérique). Tout le
 * reste est émis, éventuellement « non résolu », parce qu'une ligne supprimée en
 * silence donne un tableau d'apparence cohérente que le magasinier valide — et
 * une consommation réelle n'est jamais décomptée (stock surévalué, sans trace).
 * Trois cas autrefois filtrés, désormais émis :
 * - colonne dont l'en-tête manuscrit n'a pas été lu -> `parcelle_lue: ''` ;
 * - ligne RAYÉE sur le papier -> émise avec `barre: true` (le front la grise ;
 *   la détection de rature peut se tromper, ce n'est pas au parseur de trancher) ;
 * - ligne dont l'article n'a pas été lu mais qui porte des quantités ->
 *   `article_lu: ''`.
 * Dans les trois cas le front impose un choix à l'utilisateur au lieu de perdre
 * la donnée.
 * @param {BcScanAnalysis|null} analysis Résultat de `parseAiJson`.
 * @returns {BcScanItem[]} Items à plat, dans l'ordre lignes puis colonnes.
 */
function flattenBcScan(analysis) {
  if (!analysis || typeof analysis !== 'object') return []

  /** @type {Map<string, string>} */
  const enteteByPile = new Map()
  const colonnes = Array.isArray(analysis.colonnes) ? analysis.colonnes : []
  for (const col of colonnes) {
    if (!col || col.pile == null) continue
    const entete = String(col.entete == null ? '' : col.entete).trim()
    // Un en-tête vide/illisible est conservé comme '' (pas d'entrée perdue).
    enteteByPile.set(String(col.pile).trim(), entete)
  }

  /** @type {BcScanItem[]} */
  const items = []
  const lignes = Array.isArray(analysis.lignes) ? analysis.lignes : []
  for (const ligne of lignes) {
    if (!ligne) continue
    // Ligne rayée : conservée et DRAPEAUTÉE, jamais supprimée.
    const barre = ligne.barre === true
    // Article non lu : conservé aussi ('' -> l'utilisateur choisira).
    const article = String(ligne.article == null ? '' : ligne.article).trim()
    const unite = String(ligne.unite == null ? '' : ligne.unite).trim()
    const quantites = ligne.quantites
    if (!quantites || typeof quantites !== 'object') continue
    for (const pileKey of Object.keys(quantites)) {
      const key = String(pileKey).trim()
      // Colonne non déclarée dans `colonnes` : même traitement qu'un en-tête
      // illisible -> item émis, parcelle à saisir par l'utilisateur.
      const parcelleLue = enteteByPile.get(key) || ''
      const qte = toNumber(quantites[pileKey])
      if (!Number.isFinite(qte) || qte <= 0) continue
      items.push({
        article_lu: article,
        unite_lue: unite,
        quantite: qte,
        pile: /^\d+$/.test(key) ? Number(key) : key,
        parcelle_lue: parcelleLue,
        barre,
      })
    }
  }
  return items
}

/**
 * Ensemble des bigrammes d'une chaîne normalisée.
 * @param {string} s
 * @returns {string[]}
 */
function bigrams(s) {
  const t = s.replace(/\s+/g, '')
  const out = []
  for (let i = 0; i < t.length - 1; i += 1) out.push(t.slice(i, i + 2))
  return out
}

/**
 * Coefficient de Dice (similarité de bigrammes) entre deux libellés normalisés.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0..1
 */
function diceCoefficient(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const ba = bigrams(a)
  const bb = bigrams(b)
  if (ba.length === 0 || bb.length === 0) return 0
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const g of ba) counts.set(g, (counts.get(g) || 0) + 1)
  let hits = 0
  for (const g of bb) {
    const c = counts.get(g) || 0
    if (c > 0) {
      counts.set(g, c - 1)
      hits += 1
    }
  }
  return (2 * hits) / (ba.length + bb.length)
}

/**
 * Normalise une entrée de catalogue (string ou objet {nom}) en son libellé.
 * @param {*} entry
 * @returns {string}
 */
function catalogueName(entry) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') return String(entry.nom || entry.article || '')
  return ''
}

/**
 * Rapproche un libellé d'article lu sur le bon avec le catalogue.
 *
 * Cascade : (a) alias mémorisé, (b) égalité après normalisation,
 * (c) inclusion bidirectionnelle NON ambiguë, (d) similarité de tokens (Dice).
 * Sous le seuil, ou en cas d'ambiguïté -> `unmatched` (article: '').
 *
 * @param {*} libelleLu Libellé lu sur le papier.
 * @param {Array<string|{nom?: string}>} catalogue Catalogue articles actifs.
 * @param {Object<string, string|{article_nom?: string, count?: number}>} [aliases]
 *   Alias mémorisés {libellé normalisé: nom article} — la forme objet
 *   `{article_nom, count}` est aussi acceptée pour remonter le compteur d'usage.
 * @returns {ArticleMatch}
 */
function matchArticle(libelleLu, catalogue, aliases) {
  const norm = normalizeLabel(libelleLu)
  if (!norm) return { article: '', score: 0, status: 'unmatched', aliasCount: null }

  // (a) Alias mémorisé — priorité absolue (correction humaine déjà validée).
  //     `aliasCount` est remonté tel quel : un alias posé UNE seule fois par un
  //     magasinier n'a pas la même valeur de preuve qu'un alias confirmé N fois.
  //     Le statut reste `alias` (jamais `exact`) : c'est au front d'afficher la
  //     nuance « mémorisé — à vérifier ».
  const aliasMap = aliases && typeof aliases === 'object' ? aliases : {}
  if (Object.prototype.hasOwnProperty.call(aliasMap, norm) && aliasMap[norm]) {
    const raw = aliasMap[norm]
    const nom = typeof raw === 'string' ? raw : String(raw.article_nom || '')
    const cnt = typeof raw === 'string' ? null : (parseInt(String(raw.count), 10) || null)
    if (nom) return { article: nom, score: 1, status: 'alias', aliasCount: cnt }
  }

  const names = (Array.isArray(catalogue) ? catalogue : [])
    .map(catalogueName)
    .filter((n) => !!normalizeLabel(n))
  if (names.length === 0) return { article: '', score: 0, status: 'unmatched', aliasCount: null }

  // (b) Égalité après normalisation.
  for (const name of names) {
    if (normalizeLabel(name) === norm) {
      return { article: name, score: 1, status: 'exact', aliasCount: null }
    }
  }
  // (b bis) Égalité une fois la ponctuation retirée (« M.T.L » vs « MTL »).
  const squashed = squash(libelleLu)
  const squashHits = names.filter((n) => squash(n) === squashed)
  if (squashHits.length === 1) {
    return { article: squashHits[0], score: 1, status: 'exact', aliasCount: null }
  }

  // (c) Inclusion bidirectionnelle — seulement sur des libellés assez longs
  //     pour être discriminants (évite « MAP » qui s'inclut partout).
  if (norm.length >= 4) {
    const included = names.filter((n) => {
      const nn = normalizeLabel(n)
      return nn.length >= 4 && (nn.includes(norm) || norm.includes(nn))
    })
    if (included.length === 1) {
      const nn = normalizeLabel(included[0])
      const score = Math.min(norm.length, nn.length) / Math.max(norm.length, nn.length)
      // L'inclusion NE court-circuite PAS le seuil : « Nitrate » est inclus dans
      // « Ammonitrate » (0.636) alors qu'il désigne bien plus souvent un nitrate
      // de calcium, et « Ertiva » dans « FERTIVAL » (0.75). Pré-sélectionner le
      // mauvais article est pire qu'un `unmatched` que l'utilisateur doit
      // trancher — d'où INCLUSION_THRESHOLD, plus exigeant que le seuil Dice.
      if (score >= INCLUSION_THRESHOLD) {
        return { article: included[0], score: Number(score.toFixed(3)), status: 'probable', aliasCount: null }
      }
      return { article: '', score: Number(score.toFixed(3)), status: 'unmatched', aliasCount: null }
    }
    // 2 candidats ou plus : on ne tranche que si le meilleur est nettement devant.
    if (included.length > 1) {
      const scored = included
        .map((n) => ({ n, s: diceCoefficient(norm, normalizeLabel(n)) }))
        .sort((x, y) => y.s - x.s)
      if (scored[0].s - scored[1].s >= AMBIGUITY_MARGIN && scored[0].s >= SIMILARITY_THRESHOLD) {
        return { article: scored[0].n, score: Number(scored[0].s.toFixed(3)), status: 'probable', aliasCount: null }
      }
      return { article: '', score: Number(scored[0].s.toFixed(3)), status: 'unmatched', aliasCount: null }
    }
  }

  // (d) Similarité de tokens (Dice bigrammes).
  const scored = names
    .map((n) => ({ n, s: diceCoefficient(norm, normalizeLabel(n)) }))
    .sort((x, y) => y.s - x.s)
  const best = scored[0]
  const second = scored[1]
  if (best && best.s >= SIMILARITY_THRESHOLD) {
    if (!second || best.s - second.s >= AMBIGUITY_MARGIN) {
      return { article: best.n, score: Number(best.s.toFixed(3)), status: 'probable', aliasCount: null }
    }
  }
  return { article: '', score: best ? Number(best.s.toFixed(3)) : 0, status: 'unmatched', aliasCount: null }
}

/**
 * Extrait les SECTEURS d'un libellé (en-tête manuscrit ou label BEE ONE).
 *
 * Convention (issue des bons réels) :
 * - « S-3 », « S 5 »  -> un secteur : s3, s5 ;
 * - « S8-2 »          -> UN secteur composé : s8-2 (le chiffre colle au S) ;
 * - « S-13-14 »       -> DEUX secteurs : s13 et s14 (tiret juste après le S).
 * @param {*} s Libellé brut.
 * @returns {string[]} Secteurs normalisés, sans doublon, dans l'ordre de lecture.
 */
function extractSecteurs(s) {
  const txt = normalizeLabel(s)
  if (!txt) return []
  /** @type {string[]} */
  const out = []
  const re = /\bs\s*(-?)\s*(\d+)((?:\s*-\s*\d+)*)/g
  let m = re.exec(txt)
  while (m) {
    const dashAfterS = m[1] === '-'
    const head = m[2]
    const tail = (m[3] || '').split('-').map((x) => x.trim()).filter(Boolean)
    if (dashAfterS) {
      // « S-13-14 » : chaque nombre est un secteur distinct.
      out.push('s' + head)
      for (const t of tail) out.push('s' + t)
    } else {
      // « S8-2 » : secteur composé unique.
      out.push('s' + head + (tail.length ? '-' + tail.join('-') : ''))
    }
    m = re.exec(txt)
  }
  return Array.from(new Set(out))
}

/**
 * Marqueurs de CULTURE lisibles dans un en-tête manuscrit.
 * « M.T.L » = Myrtille (confirmé par Omar, et lisible dans l'en-tête
 * « Variétés » des bons). Signal fiable et non ambigu.
 * Table volontairement minimale : elle ne sert qu'à lire l'EN-TÊTE. La culture
 * d'une PARCELLE, elle, n'est jamais redevinée ici — elle vient de
 * `resolveCulture` (cf. cultureOfRef).
 * MIROIR de BCSM_CULTURE_TOKENS (public/lib/bcScanMatch.js).
 */
const CULTURE_TOKENS = [
  { culture: 'Myrtille', variants: ['mtl', 'myrtille', 'myrtile', 'blueberry'] },
  { culture: 'Framboise', variants: ['framboise', 'raspberry'] },
  { culture: 'Avocatier', variants: ['avocatier', 'avocat', 'avocado'] },
]

/**
 * Formes qui dénotent une CULTURE et non une variété : présentes dans
 * VARIETY_ALIASES mais qu'aucune parcelle ne porte comme variété. Les laisser
 * passer pour une variété ferait vetoer à tort tous les candidats d'un en-tête
 * « M.T.L S-13 », et le signal culture ne serait jamais atteint.
 * MIROIR de BCSM_VARIETE_EST_CULTURE.
 */
const VARIETE_EST_CULTURE = ['mtl', 'myrtille']

/**
 * Culture explicitement nommée dans un libellé ('' si aucune — surtout PAS de
 * valeur par défaut : l'absence de signal doit rester l'absence de signal).
 * @param {*} s
 * @returns {string} 'Framboise' | 'Myrtille' | 'Avocatier' | ''
 */
function extractCulture(s) {
  const sq = squash(s)
  if (!sq) return ''
  for (const t of CULTURE_TOKENS) {
    for (const variant of t.variants) {
      if (sq.includes(variant)) return t.culture
    }
  }
  return ''
}

/**
 * Forme canonique de variété détectée dans un libellé (ou '' si aucune).
 * @param {*} s
 * @returns {string}
 */
function extractVariete(s) {
  const sq = squash(s)
  if (!sq) return ''
  for (const canon of Object.keys(VARIETY_ALIASES)) {
    for (const variant of VARIETY_ALIASES[canon]) {
      if (sq.includes(variant)) return canon
    }
  }
  return ''
}

/**
 * Rapproche l'en-tête manuscrit d'une colonne « Pile » avec une liste de parcelles.
 *
 * ⚠️ N'EST PLUS APPELÉE PAR LA CLOUD FUNCTION `scan-bc` (voir functions/index.js).
 *
 * Le seul référentiel disponible côté serveur, `sb_parcelle_referentiel`
 * (15 entrées), est un SOUS-ENSEMBLE des 43 labels de
 * `sql_mirror_pointage_meta/br_parcelle_sup` qui alimentent `parcelles-campagne-list`,
 * donc le `<select>` du magasinier — ses 15 labels y figurent bien tous. Mais
 * c'est un sous-ensemble PARTIEL (15/43) et NON FILTRÉ PAR CAMPAGNE : rapprocher
 * contre lui revient à ne jamais pouvoir proposer les 28 autres parcelles (dont
 * « S3 - MARAVILLA MOTTE F1 », la plus utilisée des bons), et à pouvoir proposer
 * une parcelle hors campagne courante, absente du select, donc rejetée.
 * Le backend ne peut pas non plus savoir quelle liste le front affiche (mode
 * `useConsoSelector` -> `refForCampagne`, sinon `/api/parcelles`, plus les
 * groupes) : le rapprochement doit se faire LÀ OÙ la liste est connue.
 * La fonction est donc CONSERVÉE et exportée pour être appelée par le front avec
 * la liste RÉELLEMENT AFFICHÉE. Ne pas la re-brancher sur `sb_parcelle_referentiel`.
 *
 * Miroir front : `public/lib/bcScanMatch.js` (le backend n'est pas servi au
 * navigateur). Les deux doivent rendre le MÊME verdict — c'est le test
 * `[anti-divergence]` de tests/unit/bcScanMatch.test.js qui le garantit.
 *
 * Signal le plus fort = le SECTEUR (regex). Puis la variété. Toute ambiguïté
 * -> `unmatched` + `candidats[]` : l'utilisateur tranche.
 *
 * @param {*} enteteLu En-tête manuscrit (ex. 'marvilla S-3').
 * @param {RefParcelle[]} refParcelles Liste des parcelles RÉELLEMENT proposées à l'utilisateur.
 * @returns {ParcelleMatch}
 */
function matchParcelle(enteteLu, refParcelles) {
  const entete = String(enteteLu == null ? '' : enteteLu).trim()
  const refs = (Array.isArray(refParcelles) ? refParcelles : []).filter(
    (p) => p && String(p.label || '').trim()
  )
  const empty = { label: '', score: 0, status: /** @type {'unmatched'} */ ('unmatched'), candidats: [] }
  if (!entete || refs.length === 0) return empty

  // Chaque parcelle avec les secteurs que SON libellé couvre, et le texte fouillé
  // pour la variété. `nom` ET `nom_sb` sont lus : le front passe le nom affiché
  // sous la clé `nom`, le référentiel serveur sous `nom_sb` — accepter les deux
  // évite une divergence silencieuse entre les deux implémentations miroir.
  const scanned = refs.map((p) => ({
    p,
    sect: extractSecteurs(p.label),
    hay: [p.label, p.nom, p.nom_sb, p.culture].filter(Boolean).join(' '),
    culture: p.culture || '',
  }))
  /**
   * Parcelles dont les secteurs recoupent `list`.
   * @param {string[]} list
   * @returns {Array<{p: RefParcelle, sect: string[], hay: string, culture: string}>}
   */
  const overlapping = (list) => scanned.filter((x) => x.sect.some((s) => list.indexOf(s) >= 0))
  /**
   * Dédoublonne une liste de libellés en conservant l'ordre (une même parcelle
   * peut apparaître deux fois dans la liste affichée). Aligné sur le front.
   * @param {string[]} arr
   * @returns {string[]}
   */
  const dedupe = (arr) => arr.filter((v, i) => arr.indexOf(v) === i)
  /**
   * @param {Array<{p: RefParcelle}>} list
   * @returns {string[]}
   */
  const labelsOf = (list) => dedupe(list.map((x) => x.p.label))
  /**
   * Culture d'une PARCELLE, déléguée à `resolveCulture` (culture_sb prioritaire,
   * puis heuristique sur le libellé) — jamais redevinée localement.
   * @param {{hay: string, culture: string}} x
   * @returns {string}
   */
  const cultureOfRef = (x) => resolveCulture({ label: x.hay, culture: x.culture }, null) || ''
  /**
   * Restreint une liste à la culture demandée — UNIQUEMENT si ça laisse au moins
   * une option. La culture DÉPARTAGE, elle n'oppose jamais un veto total (une
   * parcelle sans marqueur lisible est classée « Framboise » par défaut par
   * resolveCulture : en faire un veto dur supprimerait des candidats légitimes).
   * @param {Array<*>} list
   * @param {string} cult
   * @returns {Array<*>}
   */
  const narrowByCulture = (list, cult) => {
    if (!cult || list.length === 0) return list
    const kept = list.filter((x) => cultureOfRef(x) === cult)
    return kept.length ? kept : list
  }

  const culture = extractCulture(entete)
  let variete = extractVariete(entete)
  // « M.T.L » / « myrtille » désignent la CULTURE, pas une variété : les garder
  // comme variété ferait vetoer tous les candidats d'un « M.T.L S-13 » (aucune
  // parcelle n'est nommée « MTL »), et le signal culture ne serait jamais atteint.
  if (variete && VARIETE_EST_CULTURE.indexOf(variete) >= 0) variete = ''

  const secteurs = extractSecteurs(entete)
  const hits = secteurs.length ? overlapping(secteurs) : []

  /**
   * PASSE 2 — VARIÉTÉ SANS SECTEUR. Certaines parcelles n'ont aucun secteur dans
   * leur libellé (cas réel : « F5 YAZMIN MT », qui porte aujourd'hui le secteur
   * 9) : le rapprochement par secteur ne peut structurellement jamais les
   * trouver. Si l'en-tête nomme une variété et qu'exactement UNE parcelle sans
   * secteur la porte, on la propose — en `probable` seulement, jamais en `exact`.
   * ARBITRAGE PRODUIT — elle ne peut PROPOSER un label que dans deux cas :
   *   (a) l'en-tête ne nomme aucun secteur ;
   *   (b) l'en-tête nomme un secteur qui a au moins une option, mais dont aucune
   *       ne porte la variété (cas réel « yasmin niyas S-9 » : S9 porte
   *       « F5- MYA S9 » et « S9 - REYNA F5 », aucune n'est Yazmin).
   * Si l'en-tête nomme un secteur et que ZÉRO parcelle ne lui correspond, on ne
   * propose rien : le papier affirme un secteur qu'on ne sait pas rattacher,
   * c'est un signal d'incohérence, pas une invitation à deviner (« yazmin S-11 »
   * ne doit pas sortir « F5 YAZMIN MT », qui est au secteur 9). Le label reste
   * offert en `candidats`, à un clic.
   *
   * @param {string[]} candidatsSecteur candidats déjà connus de la passe 1
   * @param {boolean} peutProposer false -> suggestion seulement
   * @returns {ParcelleMatch}
   */
  const passeVariete = (candidatsSecteur, peutProposer) => {
    const base = { label: '', score: 0, status: /** @type {'unmatched'} */ ('unmatched'), candidats: candidatsSecteur }
    if (!variete) return base
    const sansSecteur = scanned.filter((x) => {
      if (x.sect.length) return false
      if (extractVariete(x.hay) !== variete) return false
      // Ne jamais proposer une parcelle dont la culture contredit l'en-tête.
      const c = cultureOfRef(x)
      return !(culture && c && c !== culture)
    })
    if (sansSecteur.length === 0) return base
    if (peutProposer && sansSecteur.length === 1) {
      return { label: sansSecteur[0].p.label, score: 0.9, status: 'probable', candidats: [] }
    }
    return { label: '', score: 0, status: 'unmatched', candidats: dedupe(candidatsSecteur.concat(labelsOf(sansSecteur))) }
  }

  /**
   * Sortie « non résolu » de la passe secteur. La passe variété prend le relais
   * SAUF si un candidat du secteur porte déjà la variété de l'en-tête : dans ce
   * cas le secteur est bien couvert par un label dédié et proposer une parcelle
   * sans secteur serait un faux positif (cas réel : « S10 YAZMIN cut back » ne
   * doit PAS tomber sur « F5 YAZMIN MT »).
   * @param {Array<*>} restants
   * @returns {ParcelleMatch}
   */
  const nonResolu = (restants) => {
    const candidats = labelsOf(narrowByCulture(restants, culture))
    const couvertParLeSecteur = !!variete && hits.some((x) => extractVariete(x.hay) === variete)
    if (couvertParLeSecteur) return { label: '', score: 0, status: 'unmatched', candidats }
    // Cas (b) : le secteur existe dans la liste mais aucune parcelle ne porte la
    // variété — la passe variété peut proposer.
    return passeVariete(candidats, true)
  }

  // Cas (a) : aucun secteur nommé — la passe variété peut proposer.
  if (secteurs.length === 0) return passeVariete([], true)

  // En-tête couvrant 2 secteurs (ex. « M.T.L S-13-14 ») : on ne devine pas. Le
  // signal culture affine quand même la liste de suggestions.
  if (secteurs.length > 1) {
    return { label: '', score: 0, status: 'unmatched', candidats: labelsOf(narrowByCulture(hits, culture)) }
  }
  // L'en-tête nomme un secteur inconnu de la liste : on ne propose rien, la
  // variété ne sert qu'à suggérer (cf. arbitrage dans passeVariete).
  if (hits.length === 0) return passeVariete([], false)

  // GARDE ANTI-FAUX-POSITIF (1) — une parcelle dont le libellé couvre PLUSIEURS
  // secteurs n'est jamais proposée pour un en-tête qui n'en nomme qu'un.
  // Cas réel : « marvilla S-5 » -> « S2.S3.S5.S6.S7 maravilla logn can F1 »,
  // qui imputerait la consommation d'un secteur à un groupe de 5 parcelles.
  // Elle reste listée en `candidats` : c'est à l'utilisateur de trancher.
  const mono = hits.filter((x) => x.sect.length === 1)
  const multi = hits.filter((x) => x.sect.length > 1)
  const tous = mono.concat(multi)
  if (mono.length === 0) return nonResolu(tous)

  // GARDE ANTI-FAUX-POSITIF (2) — une parcelle qui nomme une AUTRE variété que
  // l'en-tête n'est jamais proposée, même si elle est seule sur le secteur.
  // Cas réel : « marvilla S-5 » vs « S5 -YAZMIN MOW DOWN F1 » (seule sur S5).
  // Une parcelle sans variété identifiable ne contredit rien : elle reste éligible.
  let eligibles = mono

  // GARDE ANTI-FAUX-POSITIF (3) — une parcelle dont la CULTURE contredit
  // l'en-tête n'est jamais proposée. Doit passer AVANT le raccourci « seule sur
  // son secteur -> exact » : sans elle, « M.T.L S-3 » (Myrtille) sortait
  // « S3 - MARAVILLA MOTTE F1 » (Framboise) en `exact` score 1, donc avec une
  // pastille ✅ « Reconnu » — un bon myrtille parti sur une parcelle framboise,
  // sans aucun signal invitant à vérifier.
  // Limitée au sens SÛR : seules « Myrtille » et « Avocatier » sont considérées,
  // car `resolveCulture` ne les attribue jamais par défaut (son défaut est
  // « Framboise »). Une parcelle dont la culture n'est pas résolue ne contredit
  // rien et reste éligible.
  if (culture === 'Myrtille' || culture === 'Avocatier') {
    eligibles = eligibles.filter((x) => {
      const c = cultureOfRef(x)
      return !c || c === culture
    })
    if (eligibles.length === 0) return nonResolu(tous)
  }

  if (variete) {
    eligibles = eligibles.filter((x) => {
      const v = extractVariete(x.hay)
      return !v || v === variete
    })
    if (eligibles.length === 0) return nonResolu(tous)
    // Variété explicitement concordante : signal fort de désambiguïsation.
    const exacts = eligibles.filter((x) => extractVariete(x.hay) === variete)
    if (exacts.length === 1) {
      const seuleSurSecteur = mono.length === 1
      return {
        label: exacts[0].p.label,
        score: seuleSurSecteur ? 1 : 0.9,
        status: seuleSurSecteur ? 'exact' : 'probable',
        candidats: [],
      }
    }
  }

  if (eligibles.length === 1 && mono.length === 1) {
    return { label: eligibles[0].p.label, score: 1, status: 'exact', candidats: [] }
  }

  // SIGNAL CULTURE — dernier recours avant d'abandonner : il DÉPARTAGE des
  // candidats déjà retenus par le secteur, il n'élargit jamais la recherche.
  // Cas réel : « M.T.L S-13 » (Myrtille) entre « F5- CASCADE -S13 » (myrtille)
  // et « S13 - YAZMIN MOW DOWN F5 » (framboise).
  if (culture) {
    const byCulture = eligibles.filter((x) => cultureOfRef(x) === culture)
    if (byCulture.length === 1) {
      return { label: byCulture[0].p.label, score: 0.9, status: 'probable', candidats: [] }
    }
  }

  return nonResolu(tous)
}

module.exports = {
  SIMILARITY_THRESHOLD,
  INCLUSION_THRESHOLD,
  AMBIGUITY_MARGIN,
  VARIETY_ALIASES,
  CULTURE_TOKENS,
  VARIETE_EST_CULTURE,
  extractCulture,
  ALLOWED_SCAN_MIME,
  EXT_TO_MIME,
  resolveScanMedia,
  normalizeLabel,
  toNumber,
  buildBcScanPrompt,
  parseAiJson,
  flattenBcScan,
  diceCoefficient,
  matchArticle,
  extractSecteurs,
  extractVariete,
  matchParcelle,
}
