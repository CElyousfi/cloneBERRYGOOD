'use strict'
// @ts-check

/**
 * Parse PUR du classeur « CANEVA STOCK BGF » -> plan en mémoire (aucune écriture).
 * Réutilise la logique du script scripts/import-stock-caneva.js, mais :
 *  - lit depuis un buffer (XLSX.read), pas un fichier ;
 *  - n'utilise AUCUN accumulateur au niveau module (réentrant en CF chaude) ;
 *  - n'estampille ni date/heure ni validations (ajoutées au moment de l'écriture).
 */

const {
  IMPORT_SOURCE,
  NEW_ARTICLES,
  PARCELLE_MAP,
  PARCELLE_TO_CPC,
  normalizeFerme,
  toISO,
  buildLieu,
  mapMotifToSortieType,
  buildArticleMap,
  resolveArticle,
} = require('./mappings')

const SHEETS = {
  inventaire: 'INVENTAIRE AU 30-06-25',
  entrees: 'BONS D ENTREE',
  transferts: 'BONS DE TRANSFERT',
  consommations: 'BONS CONSOMMATION',
  sorties: 'BONS SORTIE',
  stockReel: 'STOCK REEL A 31.03.2026',
}

const REEL_FARM_MAP = { 1: 'F1', 2: 'F2', 3: 'F5' }

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }

/** Classe une catégorie article -> bucket CPC (engrais|pesticides|null) */
function toCPCBucket(categorie) {
  if (!categorie) return null
  const c = String(categorie).toLowerCase()
  if (c.includes('engrais') || c.includes('fertilisant')) return 'engrais'
  if (c.includes('pesticide') || c.includes('phyto')) return 'pesticides'
  return null
}

/**
 * @param {Buffer} buffer  contenu .xlsx
 * @param {*} XLSX  module xlsx injecté
 * @returns {{
 *   articlesToCreate: Array, balancesInit: Array, movements: Array,
 *   costsByVariety: Object, validation: {matches:number, mismatches:Array},
 *   warnings: Array<string>, counts: Object, presentSheets: Array<string>, missingSheets: Array<string>
 * }}
 */
function parseWorkbook(buffer, XLSX) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  const presentSheets = []
  const missingSheets = []
  for (const name of Object.values(SHEETS)) {
    if (wb.Sheets[name]) presentSheets.push(name)
    else missingSheets.push(name)
  }

  function parseSheet(name) {
    const ws = wb.Sheets[name]
    if (!ws) return []
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  }

  // Map article locale (intègre les NEW_ARTICLES) — jamais partagée entre invocations.
  const articleMap = buildArticleMap()

  // Catégorie par ref (pour l'agrégation des coûts)
  const articleCategoryMap = {}
  for (const art of NEW_ARTICLES) {
    const ref = articleMap[art.nom]
    if (ref && art.categorie) articleCategoryMap[ref] = art.categorie
  }

  // Articles à créer (refs IMP-NNN)
  const articlesToCreate = NEW_ARTICLES.map((art, i) => ({
    reference: 'IMP-' + String(i + 1).padStart(3, '0'),
    nom: art.nom,
    unite: art.unite,
    categorie: art.categorie,
  }))

  const warnings = []
  const articlePriceMap = {} // ref -> { prix_ttc_inventaire, prix_ttc_achat, derniere_date_achat }

  // ---- Inventaire -> balancesInit ----
  const rawInventaire = parseSheet(SHEETS.inventaire).slice(1).filter(r => r[2])
  const balancesInit = []
  for (const row of rawInventaire) {
    const lieu = normalizeFerme(row[1])
    const { ref: artRef, nom: artNom } = resolveArticle(row[2], articleMap)
    const unite = String(row[3] || 'kg').trim()
    const qte = parseFloat(row[4]) || 0
    const prixTTC = parseFloat(row[5]) || 0
    if (!lieu || !artRef || qte === 0) continue
    if (prixTTC > 0) {
      if (!articlePriceMap[artRef]) articlePriceMap[artRef] = {}
      articlePriceMap[artRef].prix_ttc_inventaire = prixTTC
    }
    balancesInit.push({
      lieu_type: 'magasin', lieu_id: lieu,
      article_ref: artRef, article_nom: artNom,
      unite, balance: round2(qte),
    })
  }

  // ---- Bons d'Entrée (receptions) ----
  const rawEntrees = parseSheet(SHEETS.entrees).slice(1).filter(r => r[4] && String(r[4]).trim())
  const entreeGroups = new Map()
  for (const row of rawEntrees) {
    const lieu = normalizeFerme(row[0])
    const date = toISO(row[1])
    const bl = String(row[2] || '').trim()
    const fourn = String(row[3] || '').trim()
    const { ref: artRef, nom: artNom } = resolveArticle(row[4], articleMap)
    const unite = String(row[5] || 'kg').trim()
    const qte = parseFloat(row[6]) || 0
    const prixFourn = parseFloat(row[7]) || 0
    if (!artRef || qte === 0) continue
    if (prixFourn > 0) {
      const existing = articlePriceMap[artRef]
      if (!existing || !existing.derniere_date_achat || date > existing.derniere_date_achat) {
        if (!articlePriceMap[artRef]) articlePriceMap[artRef] = {}
        articlePriceMap[artRef].prix_ttc_achat = prixFourn
        articlePriceMap[artRef].derniere_date_achat = date
      }
    }
    const key = `${date}|${lieu}|${bl}|${fourn}`
    if (!entreeGroups.has(key)) entreeGroups.set(key, { date, lieu, bl, fourn, items: [] })
    entreeGroups.get(key).items.push({
      article_ref: artRef, article_nom: artNom, quantite: qte, unite,
      prix_unitaire_ttc: prixFourn, montant_ttc: round2(qte * prixFourn),
    })
  }

  const movements = []
  for (const group of entreeGroups.values()) {
    movements.push({
      type: 'reception',
      date: group.date,
      lieu_source: null,
      lieu_destination: { type: 'magasin', id: group.lieu },
      ferme: group.lieu,
      items: group.items,
      ref_bl_fournisseur: group.bl,
      fournisseur_nom: group.fourn,
      reception_libre: true,
      reception_libre_motif: 'Import historique CANEVA',
      ref_bon_physique: '',
      sortie_type: null,
      numero_source: group.bl,
    })
  }

  // ---- Bons de Transfert ----
  const rawTransferts = parseSheet(SHEETS.transferts).slice(1).filter(r => r[4] && String(r[4]).trim())
  const transfertGroups = new Map()
  for (const row of rawTransferts) {
    const date = toISO(row[0])
    const bt = String(row[1] || '').trim()
    const depart = String(row[2] || '').trim()
    const arrivee = String(row[3] || '').trim()
    const { ref: artRef, nom: artNom } = resolveArticle(row[4], articleMap)
    const unite = String(row[5] || 'kg').trim()
    const qte = parseFloat(row[6]) || 0
    if (!artRef || qte === 0 || !depart) continue
    const key = `${date}|${bt}|${depart}|${arrivee}`
    if (!transfertGroups.has(key)) transfertGroups.set(key, { date, bt, depart, arrivee, items: [] })
    transfertGroups.get(key).items.push({ article_ref: artRef, article_nom: artNom, quantite: qte, unite })
  }
  for (const group of transfertGroups.values()) {
    movements.push({
      type: 'transfert',
      date: group.date,
      lieu_source: buildLieu(group.depart),
      lieu_destination: buildLieu(group.arrivee),
      ferme: normalizeFerme(group.depart),
      items: group.items,
      ref_bl_fournisseur: '',
      fournisseur_nom: null,
      reception_libre: false,
      reception_libre_motif: '',
      ref_bon_physique: group.bt ? `BT-${group.bt}` : '',
      sortie_type: null,
      numero_source: group.bt,
    })
  }

  // ---- Bons de Consommation ----
  const rawConsommations = parseSheet(SHEETS.consommations).slice(1).filter(r => r[5] && String(r[5]).trim())
  const consoGroups = new Map()
  for (const row of rawConsommations) {
    const date = toISO(row[0])
    const bc = String(row[1] || '').trim()
    const depart = String(row[2] || '').trim()
    const parcelle = String(row[3] || '').trim()
    const { ref: artRef, nom: artNom } = resolveArticle(row[5], articleMap)
    const unite = String(row[6] || 'kg').trim()
    const qte = parseFloat(row[7]) || 0
    if (!artRef || qte === 0 || !depart) continue
    const prices = articlePriceMap[artRef]
    const prix = prices ? (prices.prix_ttc_achat || prices.prix_ttc_inventaire || 0) : 0
    const key = `${date}|${bc}|${depart}|${parcelle}`
    if (!consoGroups.has(key)) consoGroups.set(key, { date, bc, depart, parcelle, items: [] })
    consoGroups.get(key).items.push({
      article_ref: artRef, article_nom: artNom, quantite: qte, unite,
      prix_unitaire_ttc: prix, montant_ttc: round2(qte * prix),
    })
  }
  for (const group of consoGroups.values()) {
    const ferme = normalizeFerme(group.depart)
    const parcelleName = PARCELLE_MAP[group.parcelle] || group.parcelle
    movements.push({
      type: 'consommation',
      date: group.date,
      lieu_source: { type: 'magasin', id: ferme },
      lieu_destination: { type: 'parcelle', id: parcelleName },
      ferme,
      items: group.items,
      ref_bl_fournisseur: '',
      fournisseur_nom: null,
      reception_libre: false,
      reception_libre_motif: '',
      ref_bon_physique: group.bc ? `BC-${group.bc}` : '',
      sortie_type: null,
      numero_source: group.bc,
    })
  }

  // ---- Bons de Sortie ----
  const rawSorties = parseSheet(SHEETS.sorties).slice(1).filter(r => r[5] && String(r[5]).trim())
  const sortieGroups = new Map()
  for (const row of rawSorties) {
    const lieu = normalizeFerme(row[0])
    const date = toISO(row[1])
    const bs = String(row[2] || '').trim()
    const dest = String(row[3] || '').trim()
    const { ref: artRef, nom: artNom } = resolveArticle(row[5], articleMap)
    const unite = String(row[6] || 'kg').trim()
    const qte = parseFloat(row[7]) || 0
    const motif = String(row[8] || '').trim()
    if (!artRef || qte === 0) continue
    const key = `${date}|${bs}|${lieu}|${dest}`
    if (!sortieGroups.has(key)) sortieGroups.set(key, { date, bs, lieu, dest, motif, items: [] })
    sortieGroups.get(key).items.push({ article_ref: artRef, article_nom: artNom, quantite: qte, unite })
  }
  for (const group of sortieGroups.values()) {
    movements.push({
      type: 'sortie',
      date: group.date,
      lieu_source: { type: 'magasin', id: group.lieu },
      lieu_destination: { type: 'externe', id: normalizeFerme(group.dest) },
      ferme: group.lieu,
      items: group.items,
      ref_bl_fournisseur: '',
      fournisseur_nom: null,
      reception_libre: false,
      reception_libre_motif: '',
      ref_bon_physique: group.bs ? `BS-${group.bs}` : '',
      sortie_type: mapMotifToSortieType(group.motif),
      numero_source: group.bs,
    })
  }

  // ---- Numérotation déterministe par (date, type) ----
  assignNumeros(movements)

  // ---- Agrégation des coûts par variété (depuis les consommations) ----
  const costsByVariety = aggregateCosts(consoGroups, articleCategoryMap, warnings)

  // ---- Validation vs Stock Reel ----
  const validation = validateVsStockReel(parseSheet(SHEETS.stockReel), movements, balancesInit, articleMap)

  const counts = {
    receptions: entreeGroups.size,
    transferts: transfertGroups.size,
    consommations: consoGroups.size,
    sorties: sortieGroups.size,
    movements: movements.length,
    lineItems: rawEntrees.length + rawTransferts.length + rawConsommations.length + rawSorties.length,
    balancesInit: balancesInit.length,
    articlesToCreate: articlesToCreate.length,
  }

  return { articlesToCreate, balancesInit, movements, costsByVariety, validation, warnings, counts, presentSheets, missingSheets }
}

/** Assigne un numero stable `IMP-<PREFIX>-<YYYYMMDD>-<NNN>` par (date,type). */
function assignNumeros(movements) {
  const PREFIX = { reception: 'BR', transfert: 'BT', consommation: 'BCS', sortie: 'BS' }
  const seq = new Map()
  for (const m of movements) {
    const day = (m.date || 'UNDATED').replace(/-/g, '')
    const k = `${m.type}|${day}`
    const n = (seq.get(k) || 0) + 1
    seq.set(k, n)
    m.numero = `IMP-${PREFIX[m.type]}-${day}-${String(n).padStart(3, '0')}`
  }
}

/** Agrège les coûts engrais/pesticides par variété CPC. */
function aggregateCosts(consoGroups, articleCategoryMap, warnings) {
  const costAgg = {}
  const unmappedParcelles = new Set()
  for (const group of consoGroups.values()) {
    const parcelleName = PARCELLE_MAP[group.parcelle] || group.parcelle
    const cpcInfo = PARCELLE_TO_CPC[group.parcelle] || PARCELLE_TO_CPC[parcelleName]
    if (!cpcInfo) { unmappedParcelles.add(parcelleName); continue }
    const month = group.date ? group.date.slice(0, 7) : 'unknown'
    if (!costAgg[cpcInfo.cpc_code]) {
      costAgg[cpcInfo.cpc_code] = {
        variete: cpcInfo.variete, ferme: cpcInfo.ferme, cpc_code: cpcInfo.cpc_code,
        engrais_ttc: 0, pesticides_ttc: 0, total_ttc: 0, par_mois: {}, detail_articles: {},
      }
    }
    const agg = costAgg[cpcInfo.cpc_code]
    for (const item of group.items) {
      const bucket = toCPCBucket(articleCategoryMap[item.article_ref])
      if (!bucket) continue
      const montant = item.montant_ttc || 0
      agg[`${bucket}_ttc`] += montant
      agg.total_ttc += montant
      if (!agg.par_mois[month]) agg.par_mois[month] = { engrais: 0, pesticides: 0 }
      agg.par_mois[month][bucket] += montant
      const detKey = `${item.article_ref}|${bucket}`
      if (!agg.detail_articles[detKey]) {
        agg.detail_articles[detKey] = { article_ref: item.article_ref, article_nom: item.article_nom, categorie: bucket, quantite: 0, montant_ttc: 0 }
      }
      agg.detail_articles[detKey].quantite += item.quantite
      agg.detail_articles[detKey].montant_ttc += montant
    }
  }
  // Arrondis + conversion détail en tableau
  for (const agg of Object.values(costAgg)) {
    agg.engrais_ttc = round2(agg.engrais_ttc)
    agg.pesticides_ttc = round2(agg.pesticides_ttc)
    agg.total_ttc = round2(agg.total_ttc)
    for (const vals of Object.values(agg.par_mois)) {
      vals.engrais = round2(vals.engrais); vals.pesticides = round2(vals.pesticides)
    }
    agg.detail_articles = Object.values(agg.detail_articles)
      .map(d => ({ ...d, quantite: round2(d.quantite), montant_ttc: round2(d.montant_ttc) }))
      .sort((a, b) => b.montant_ttc - a.montant_ttc)
  }
  if (unmappedParcelles.size > 0) {
    warnings.push(`Parcelles non mappées (coûts ignorés): ${[...unmappedParcelles].join(', ')}`)
  }
  return costAgg
}

/** Compare les soldes calculés (inventaire + mouvements) au Stock Réel du classeur. */
function validateVsStockReel(rawStockReelRows, movements, balancesInit, articleMap) {
  // Solde calculé par magasin (inventaire + deltas mouvements)
  const computed = {}
  for (const b of balancesInit) {
    computed[`${b.lieu_id}|${b.article_ref}`] = b.balance
  }
  for (const m of movements) {
    for (const it of m.items) {
      if (m.lieu_source && m.lieu_source.type === 'magasin') {
        const k = `${m.lieu_source.id}|${it.article_ref}`
        computed[k] = round2((computed[k] || 0) - it.quantite)
      }
      if (m.lieu_destination && m.lieu_destination.type === 'magasin') {
        const k = `${m.lieu_destination.id}|${it.article_ref}`
        computed[k] = round2((computed[k] || 0) + it.quantite)
      }
    }
  }
  const rawStockReel = (rawStockReelRows || []).slice(3).filter(r => r[0] && String(r[0]).trim())
  let matches = 0
  const mismatches = []
  for (const row of rawStockReel) {
    const articleName = String(row[0] || '').trim()
    if (!articleName || articleName === 'ARTICLE') continue
    const { ref: artRef } = resolveArticle(articleName, articleMap)
    for (const [col, farmId] of Object.entries(REEL_FARM_MAP)) {
      const reelQty = round2(parseFloat(row[col]) || 0)
      if (Math.abs(reelQty) < 0.01) continue
      const compQty = computed[`${farmId}|${artRef}`] || 0
      const delta = round2(compQty - reelQty)
      if (Math.abs(delta) < 0.5) matches++
      else mismatches.push({ article: articleName, farm: farmId, computed: compQty, reel: reelQty, delta })
    }
  }
  return { matches, mismatches }
}

module.exports = { parseWorkbook, SHEETS, IMPORT_SOURCE }
