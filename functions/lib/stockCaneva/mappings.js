'use strict'
// @ts-check

/**
 * Tables de correspondance et helpers PURS pour l'import du canevas Stock BGF.
 * Extraits de scripts/import-stock-caneva.js — aucune dépendance Firestore/IO.
 * `resolveArticle` prend désormais la map en paramètre (pas d'état module mutable),
 * pour rester réentrant dans une Cloud Function « chaude ».
 */

const IMPORT_SOURCE = 'CANEVA_STOCK_BGF'

/** Excel farm ID -> System farm ID */
function normalizeFerme(raw) {
  if (!raw) return ''
  const s = String(raw).trim().toUpperCase()
  if (s === 'EL BAHIA') return 'BAHIA'
  return s.replace('F-0', 'F').replace('F-', 'F')
}

/** Excel date (serial number or Date object) -> ISO string (YYYY-MM-DD) */
function toISO(val) {
  if (!val) return ''
  if (val instanceof Date) return val.toISOString().split('T')[0]
  if (typeof val === 'string') return val
  // Excel serial
  const d = new Date((val - 25569) * 86400 * 1000)
  return d.toISOString().split('T')[0]
}

/** Build lieu object from raw farm/location name */
function buildLieu(raw) {
  if (!raw) return null
  const norm = normalizeFerme(raw)
  if (['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].includes(norm)) {
    return { type: 'magasin', id: norm }
  }
  if (norm === 'BAHIA') return { type: 'externe', id: 'BAHIA' }
  // Parcelle (from consommation)
  return { type: 'parcelle', id: String(raw).trim() }
}

/** Excel article name -> catalogue reference (mappings connus) */
const ARTICLE_MAP = {
  'ACIDE NITRIQUE (L)': 'Ref-Eng0051',
  'ACIDE PHOSPHORIQUE (L)': 'Ref-Eng0052',
  'AFRO- CUIVRE': 'A00933',
  'AFRO- CUIVRE ': 'A00933',
  'AGROZITE': 'A00936',
  'AGROZITE ': 'A00936',
  'ALPHA': 'Ref-Eng0206',
  'AMMONITRATE (KG)': 'Ref-Eng0113',
  'BACTOSPEINE': 'NALSYABACTOSOEINE',
  'BARBARIAN': 'A00840',
  'BARBARIAN ': 'A00840',
  'BENEVIA (L)': 'ONSSA-0782',
  'BETAMAX': 'A00925',
  'BIOFORGE': 'A00943',
  'BOUST FRUIT': 'A00932',
  'BOUST FRUIT ': 'A00932',
  'CARGO': 'ONSSA-00235',
  'CLOCHE': 'ONSSA-0326',
  'CO-ACTYL-H (KG)': 'Ref-Eng0152',
  'CODACIDE': 'A00912',
  'CODACIDE ': 'A00912',
  'CUAJER': 'A00919',
  'CYTORAD': 'A00949',
  'DECIS expert': 'ONSSA-0105',
  'DECIS expert ': 'ONSSA-0105',
  'DIPEL DF': 'A00931',
  'DIPEL DF ': 'A00931',
  'ECOVIGOR (L)': 'Ref-Eng0200',
  'EKLIPSO': 'A00935',
  'ESCARDIX': 'A00951',
  'EUROFIT MAX': 'ref-Eng0790',
  'EXIREL': 'ONSSA-00302',
  'EXTREME': 'Ref-Eng0027',
  'FERTICOL': 'onSSA-0745',
  'FOLI PLUS': 'A00950',
  'FOLICIST': 'Ref-Eng0158',
  'folicist': 'Ref-Eng0158',
  'GC-MITE': 'ONSSA-0135',
  'GC-MITE ': 'ONSSA-0135',
  'GZ (L)': 'Ref-Eng0028',
  'gz (L)': 'Ref-Eng0028',
  'HUMOCAL (KG)': 'ENG0146',
  'ISABION (L)': 'ENG00522',
  'KALEO L': 'A00924',
  'KALIGREEN': 'ONSSA-0147',
  'KOLATIM (L)': '0096',
  'KSC 1 (KG)': 'eng 456',
  'KSC 2 (KG)': 'enr 14',
  'KSC 7': 'eng 1245',
  'KSC MIX  (KG)': 'Ref-Eng0062',
  'LAREKI': 'ENG 0952',
  'MAGICAL (L)': 'ENG 0150',
  'MAP (GK)': 'Ref-Eng0065',
  'MASAMITE': 'A00909',
  'MAXI FRUIT (L)': 'ref-Eng0780',
  'MEGAFOL': 'A00887',
  'MICRO MIX ORGA': 'A00928',
  'MILBEKNOCK': 'A00923',
  'N-K-P': 'A00921',
  'NATURALIS': 'ONSSA-0171',
  'NITRATE DE CALCIUM  (KG)': 'Ref-Eng0073',
  'NITRATE DE MAGNESIE (KG)': 'Ref-Eng0184',
  'OPAL (L)': 'A00926',
  'ORIS': 'Ref-Eng0203',
  'ORTIVA': 'A00927',
  'PIRIMOR': 'ONSSA-0203',
  'POTABIO': 'A00930',
  'POTABIO ': 'A00930',
  'PRESTIGE (KG)': 'A00774',
  'RADIAN': 'ONSSA-0350',
  'RAIZANTE': 'Ref-Eng0012',
  'RHIZO AMINE (L)': 'Ref-Eng0056',
  'RHIZO BOR (KG)': 'Ref-Eng0044',
  'RHIZO CAL': 'Ref-Eng0045',
  'RHIZO HUMUS (L)': 'Ref-Eng0046',
  'RHIZO hUMUS (L)': 'Ref-Eng0046',
  'SALTRAD': 'Ref-Eng0049',
  'SC CALCUIM': 'A00922',
  'SCORE (L)': 'ONSSA-0322',
  'SERGOMIL': 'A60',
  'SERGOMIL ': 'A60',
  'SIBERIO': 'A2',
  'SIGNUM': 'ONSSA-0221',
  'SMART PH': 'A00911',
  'smart ph': 'A00911',
  'SOLUPOTASSE (Kg)': 'Ref-Eng0101',
  'SULFACIDE (L)': 'Eng0220',
  "Sulfate d'ammoniaque": 'Ref-Eng0103',
  "Sulfate d'ammoniaque ": 'Ref-Eng0103',
  'SULFATE DE MAGNESIE (KG)': 'Ref-Eng0106',
  'SULFATE DE MANGANESE': 'Ref-Eng0107',
  'SULFATE DE ZINC  (KG)': 'Ref-Eng0110',
  'SWITCH (KG)': 'ONSSA-0242',
  'TELDOR (KG)': 'ONSSA-0244',
  'TEPPEKI': 'A00877',
  'TOPAS (L)': 'ONSSA-0200',
  'VERIMARK': 'A00883',
  'VIDISHINE': 'A61',
  'VITAL': 'Ref-Eng0183',
}

/** Articles absents du catalogue → créés avec un ref IMP-NNN stable (index+1). */
const NEW_ARTICLES = [
  { nom: 'ACIDE SULFRIQUE (L)', unite: 'L', categorie: 'Engrais' },
  { nom: 'ACRAMET (KG)', unite: 'L', categorie: 'Pesticides' },
  { nom: 'ALIÉTTE', unite: 'L', categorie: 'Pesticides' },
  { nom: 'APPOLO (L)', unite: 'L', categorie: 'Pesticides' },
  { nom: 'AZO PRO 31 (KG)', unite: 'L', categorie: 'Engrais' },
  { nom: 'Alga 600', unite: 'L', categorie: 'Engrais' },
  { nom: 'BIOACTYL SUPERBE (KG)', unite: 'L', categorie: 'Engrais' },
  { nom: 'BOOM SUPER', unite: 'L', categorie: 'Pesticides' },
  { nom: 'DEPTIL PA5 (L)', unite: 'L', categorie: 'Engrais' },
  { nom: 'GOLD BMO', unite: 'L', categorie: 'Engrais' },
  { nom: 'GREENTON', unite: 'L', categorie: 'Engrais' },
  { nom: 'KELPARK', unite: 'KG', categorie: 'Engrais' },
  { nom: 'KSC 3 (KG)', unite: 'L', categorie: 'Engrais' },
  { nom: 'KSC 5', unite: 'KG', categorie: 'Engrais' },
  { nom: 'M-K-P', unite: 'L', categorie: 'Engrais' },
  { nom: 'MALATHION 50 (L)', unite: 'KG', categorie: 'Pesticides' },
  { nom: 'MERJANE CAPTANE', unite: 'L', categorie: 'Pesticides' },
  { nom: 'MOVINTO', unite: 'L', categorie: 'Pesticides' },
  { nom: 'NITRETE DE POTASSE', unite: 'L', categorie: 'Engrais' },
  { nom: 'PRIORITOP', unite: 'KG', categorie: 'Engrais' },
  { nom: 'PROGIBB', unite: 'L', categorie: 'Engrais' },
  { nom: 'RHIZO MN ZN (KG)', unite: 'L', categorie: 'Engrais' },
  { nom: 'TOUCHDOWN', unite: 'L', categorie: 'Pesticides' },
  { nom: 'UNIFORME', unite: 'KG', categorie: 'Pesticides' },
  { nom: 'URÉE 46%', unite: 'L', categorie: 'Engrais' },
  { nom: 'VERTIMIC', unite: 'KG', categorie: 'Pesticides' },
]

/** Parcelle name mapping (Excel -> system) */
const PARCELLE_MAP = {
  'S3 MARAVILLA MOTTE F1': 'S3 Maravilla Motte',
  'S3 MARAVILLA MOTTE F1 2026': 'S3 Maravilla Motte',
  'S7 MARAVILLA MOTTE F1': 'S7 Maravilla Motte',
  'S1/S4 MARAVILLA MOW DOWN F1': 'S1 Maravilla',
  'S2 YAZMIN MOW DOWN F1': 'S2 Yazmin',
  'S5 YAZMIN MOW DOWN F1': 'S5 Yazmin',
  ' S1.S4 Maravilla green can F1': 'S1 Maravilla',
  'S1.S4 Maravilla green can F1': 'S1 Maravilla',
  'S2.S3.S5.S6.S7 maravilla logn can F1': 'S7 Maravilla Motte',
  'S10 YAZMIN MOTTE F5': 'S10 Yazmin',
  'S10 YAZMIN CUT BACK F5': 'S10 Yazmin',
  'S13 YAZMIN MOW DOWN F5': 'S13 Yazmin',
  'S9 REYNA F5': 'S9 Reyna',
  'S9': 'S9 Reyna',
  'CORINA MYRTILLE S8': 'S8 Corina',
  'BREEZE MYRTILLE S8-2': 'S8 Corina',
  'CASCADE MYRTILLE S8-1': 'S8 Corina',
  '1/Σ AVOCAT': 'Avocat F2',
  'Σ AVOCAT   F-06': 'Avocat F6',
  // Libellés conso « Engrais & Pesticides » non encore normalisés (variantes
  // d'espaces / casse rencontrées dans sql_mirror_consommation).
  'BREEZE S14 F5': 'BREEZE S14 F5',
  'CASCADE S13 F5': 'CASCADE S13 F5',
  'Σ AVOCAT F-06': 'Avocat F6',
  'Σ AVOCAT   F-02': 'Avocat F2',
  'S9 REYNA': 'S9 Reyna',
}

/** Parcelle (system name after PARCELLE_MAP) -> CPC variety */
const PARCELLE_TO_CPC = {
  'S3 Maravilla Motte': { variete: 'Maravilla MT', cpc_code: 'S3S7_MAR_MT', ferme: 'F1' },
  'S7 Maravilla Motte': { variete: 'Maravilla MT', cpc_code: 'S3S7_MAR_MT', ferme: 'F1' },
  'S1 Maravilla': { variete: 'Maravilla MD', cpc_code: 'S1S4_MAR_MD', ferme: 'F1' },
  'S2 Yazmin': { variete: 'Yazmin MD', cpc_code: 'S2S5_YAZ_MD', ferme: 'F1' },
  'S5 Yazmin': { variete: 'Yazmin MD', cpc_code: 'S2S5_YAZ_MD', ferme: 'F1' },
  'S10 Yazmin': { variete: 'Yazmin MT', cpc_code: 'S10_YAZ_MT', ferme: 'F5' },
  'S13 Yazmin': { variete: 'Yazmin MD', cpc_code: 'S13_YAZ_MD', ferme: 'F5' },
  'S9 Reyna': { variete: 'Reyna', cpc_code: 'S9_REYNA', ferme: 'F5' },
  'S8 Corina': { variete: 'Corina', cpc_code: 'CORINA', ferme: 'F5' },
  'Avocat F2': { variete: 'Avocat', cpc_code: 'AVOCAT', ferme: 'Avocatier' },
  'Avocat F6': { variete: 'Avocat', cpc_code: 'AVOCAT', ferme: 'Avocatier' },
  'CASCADE MYRTILLE S8-1': { variete: 'Cascade', cpc_code: 'CASCADE', ferme: 'F1' },
  'CASCADE S13 F5': { variete: 'Cascade', cpc_code: 'CASCADE', ferme: 'F5' },
  'BREEZE MYRTILLE S8-2': { variete: 'Breeze', cpc_code: 'BREEZE', ferme: 'F1' },
  'BREEZE S14 F5': { variete: 'Breeze', cpc_code: 'BREEZE', ferme: 'F5' },
}

/** Sortie motif -> sortie_type */
function mapMotifToSortieType(motif) {
  if (!motif) return 'pret'
  const m = String(motif).toLowerCase()
  if (m.includes('retour')) return 'retour_fournisseur'
  return 'pret'
}

/**
 * Construit la map "nom article du canevas" -> ref catalogue, en intégrant
 * les NEW_ARTICLES sous des refs IMP-NNN stables. Retourne une NOUVELLE map
 * (ne mute jamais ARTICLE_MAP). À appeler une fois par parse.
 * @returns {Record<string,string>}
 */
function buildArticleMap() {
  const map = Object.assign({}, ARTICLE_MAP)
  for (let i = 0; i < NEW_ARTICLES.length; i++) {
    const ref = 'IMP-' + String(i + 1).padStart(3, '0')
    map[NEW_ARTICLES[i].nom] = ref
  }
  return map
}

/**
 * Résout un nom d'article brut -> { ref, nom } via la map fournie.
 * Article inconnu -> ref dérivé `IMP-<SLUG>`.
 * @param {string} rawName
 * @param {Record<string,string>} articleMap
 * @returns {{ ref:string, nom:string }}
 */
function resolveArticle(rawName, articleMap) {
  if (!rawName) return { ref: '', nom: '' }
  const name = String(rawName).trim()
  if (articleMap[name]) return { ref: articleMap[name], nom: name }
  const stripped = name.replace(/\s+$/, '')
  if (articleMap[stripped]) return { ref: articleMap[stripped], nom: stripped }
  for (const k of Object.keys(articleMap)) {
    if (k.trim().toUpperCase() === stripped.toUpperCase()) return { ref: articleMap[k], nom: stripped }
  }
  const ref = 'IMP-' + stripped.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30).toUpperCase()
  return { ref, nom: stripped }
}

module.exports = {
  IMPORT_SOURCE,
  ARTICLE_MAP,
  NEW_ARTICLES,
  PARCELLE_MAP,
  PARCELLE_TO_CPC,
  normalizeFerme,
  toISO,
  buildLieu,
  mapMotifToSortieType,
  buildArticleMap,
  resolveArticle,
}
