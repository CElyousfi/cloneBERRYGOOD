'use strict'
// @ts-check

/**
 * Données de seed du module « Mapping parcelles de consommation »,
 * campagne 2025-2026.
 *
 * RÉALIGNEMENT PARCELLE_TO_CPC (2026-06, décision DG) : la dimension parcelle
 * du Stock existe DÉJÀ dans functions/lib/stockCaneva/mappings.js
 * (`PARCELLE_MAP` raw→nom système, `PARCELLE_TO_CPC` nom système → {variete,
 * cpc_code, ferme}). On NE duplique plus un référentiel parallèle :
 *  - `cible_parcelle_culturale` = une CLÉ EXISTANTE de PARCELLE_TO_CPC
 *    (jamais un nom brut BEE ONE inventé). Le CPC est dérivé en aval par le
 *    resolver via cpcResolver(cible) = PARCELLE_TO_CPC[cible].cpc_code.
 *  - statut `matched` = la cible existe dans PARCELLE_TO_CPC.
 *  - statut `a_creer` = aucune clé PARCELLE_TO_CPC ne correspond (cible null).
 *  - statut `hors_propose` = hors-périmètre proposé (cible null).
 *  - statut `alias_propose` = même parcelle système qu'une autre ligne, stade ≠.
 *
 * RÉPARTITION 1:N : certaines demandes magasinier agrègent plusieurs parcelles
 * système (groupes S8 Cascade+Breeze, S13/S14). Pour celles-là :
 *  - `cible_parcelle_culturale` = null
 *  - `repartition` = [{cible, pct}, ...] où chaque `cible` est une clé
 *    PARCELLE_TO_CPC et Σ(pct) === 100.
 * `cible_parcelle_culturale` et `repartition` sont MUTUELLEMENT EXCLUSIFS :
 * jamais les deux non-null sur une même ligne.
 *
 * Deux collections Firestore sont produites :
 *  - parcelles_consommation : référentiel magasinier STABLE (docId = id).
 *  - mapping_campagne        : le lien VERSIONNÉ (docId = `${campagne}__${id}`).
 *
 * `pointages` N'EST PAS stocké : c'est un agrégat recalculé depuis
 * stock_movements (cf. resolver.aggregatePointages).
 */

const { PARCELLE_TO_CPC } = require('../stockCaneva/mappings')

const CAMPAGNE = '2025-2026'

/**
 * Lignes brutes du SEED, réalignées sur les clés PARCELLE_TO_CPC.
 *
 * Champs :
 *  - `cible` : clé PARCELLE_TO_CPC OU null (si a_creer / hors_propose / repartition).
 *  - `repartition` : [{cible, pct}, ...] OU absent. Mutuellement exclusif avec `cible`.
 *  - `famille` : libellé culture pour l'AFFICHAGE uniquement (la dimension
 *    analytique réelle = cpc_code, dérivé via PARCELLE_TO_CPC).
 */
const SEED_ROWS = [
  // ---- Avocatier ----
  { id: 'm1', libelle: 'F2 - HAAS', famille: 'Avocatier', cible: 'Avocat F2', statut: 'matched' },
  { id: 'c5', libelle: 'F3 -HAAS', famille: 'Avocatier', cible: null, statut: 'a_creer', note: 'avocat F3 absent du canevas — créer ou rattacher AVOCAT' },
  { id: 'c6', libelle: 'F4 -HAAS', famille: 'Avocatier', cible: null, statut: 'a_creer', note: 'avocat F4 absent du canevas — créer ou rattacher AVOCAT' },
  { id: 'm4', libelle: 'F6-HAAS', famille: 'Avocatier', cible: 'Avocat F6', statut: 'matched' },

  // ---- Framboise (Maravilla) ----
  { id: 'm5', libelle: 'S1.S4 Maravilla green can F1', famille: 'Framboise', cible: 'S1 Maravilla', statut: 'matched' },
  { id: 'a1', libelle: 'S1.S4 Maravilla mow down F1', famille: 'Framboise', cible: 'S1 Maravilla', statut: 'alias_propose', note: 'même parcelle système S1 Maravilla, stade ≠' },
  { id: 'm9', libelle: 'S3 - MARAVILLA MOTTE F1', famille: 'Framboise', cible: 'S3 Maravilla Motte', statut: 'matched' },
  { id: 'm10', libelle: 'S7 -MARAVILLA MOTTE F1', famille: 'Framboise', cible: 'S7 Maravilla Motte', statut: 'matched' },
  { id: 'm7', libelle: 'S2.S3.S5.S6.S7 maravilla logn can F1', famille: 'Framboise', cible: 'S7 Maravilla Motte', statut: 'matched' },

  // ---- Framboise (Yazmin) ----
  { id: 'm11', libelle: 'S2 -YAZMIN MOW DOWN F1', famille: 'Framboise', cible: 'S2 Yazmin', statut: 'matched' },
  { id: 'm12', libelle: 'S5 -YAZMIN MOW DOWN F1', famille: 'Framboise', cible: 'S5 Yazmin', statut: 'matched' },
  { id: 'a4', libelle: 'S10 - YAZMIN MOTTE F5', famille: 'Framboise', cible: 'S10 Yazmin', statut: 'alias_propose', note: 'même S10 Yazmin, stade ≠' },
  { id: 'm6', libelle: 'S10 YAZMIN cut back F5', famille: 'Framboise', cible: 'S10 Yazmin', statut: 'matched' },
  { id: 'm13', libelle: 'S13 - YAZMIN MOW DOWN F5', famille: 'Framboise', cible: 'S13 Yazmin', statut: 'matched' },

  // ---- Framboise (Reyna / Mia) ----
  { id: 'm8', libelle: 'S9 - REYNA F5', famille: 'Framboise', cible: 'S9 Reyna', statut: 'matched' },
  { id: 'c4', libelle: 'S9 - MIA F5', famille: 'Framboise', cible: null, statut: 'a_creer' },

  // ---- Myrtille (groupes 1:N) ----
  {
    id: 'a5',
    libelle: 'F5 S8-S8.1-S8.2',
    famille: 'Myrtille',
    cible: null,
    repartition: [
      { cible: 'CASCADE MYRTILLE S8-1', pct: 50 },
      { cible: 'BREEZE MYRTILLE S8-2', pct: 50 },
    ],
    statut: 'alias_propose',
    note: 'groupe S8 Cascade+Breeze, % à ajuster',
  },
  {
    id: 'a6',
    libelle: 'S13-S14 CASCADE BREEZE F5',
    famille: 'Myrtille',
    cible: null,
    repartition: [
      { cible: 'CASCADE S13 F5', pct: 50 },
      { cible: 'BREEZE S14 F5', pct: 50 },
    ],
    statut: 'alias_propose',
    note: 'groupe S13/S14, % à ajuster',
  },

  // ---- Hors-périmètre ----
  { id: 'h1', libelle: 'EL BAHIA', famille: 'Myrtille', cible: null, statut: 'hors_propose', note: 'source à confirmer' },
]

/**
 * GARDE-FOU au chargement du module : toute `cible` non-null (et chaque cible
 * de répartition) DOIT être une clé réelle de PARCELLE_TO_CPC. Sinon le seed
 * réintroduirait un nom inventé (le bug que ce réalignement supprime).
 */
for (const row of SEED_ROWS) {
  if (row.cible != null && !(row.cible in PARCELLE_TO_CPC)) {
    throw new Error(
      `seed.js: cible « ${row.cible} » (${row.id}) absente de PARCELLE_TO_CPC`
    )
  }
  if (Array.isArray(row.repartition)) {
    if (row.cible != null) {
      throw new Error(`seed.js: ${row.id} a cible ET repartition (exclusifs)`)
    }
    let sum = 0
    for (const part of row.repartition) {
      if (!(part.cible in PARCELLE_TO_CPC)) {
        throw new Error(
          `seed.js: repartition cible « ${part.cible} » (${row.id}) absente de PARCELLE_TO_CPC`
        )
      }
      sum += part.pct
    }
    if (sum !== 100) {
      throw new Error(`seed.js: Σpct répartition ${row.id} = ${sum} ≠ 100`)
    }
  }
}

/**
 * Parse simple d'un libellé magasinier pour en dériver ferme/secteur/variete/
 * stade. Best-effort, non bloquant : tout champ non dérivable vaut null.
 *
 * Exemples :
 *  - 'S3 - MARAVILLA MOTTE F1' → { secteur:'S3', variete:'Maravilla', stade:'Motte', ferme:'F1' }
 *  - 'F2 - HAAS'               → { ferme:'F2', variete:'Haas', secteur:null, stade:null }
 *  - 'S1.S4 Maravilla green can F1' → { secteur:'S1.S4', variete:'Maravilla', stade:'Green can', ferme:'F1' }
 *
 * @param {string} libelle
 * @returns {{ ferme:string|null, secteur:string|null, variete:string|null, stade:string|null }}
 */
function parseLibelle(libelle) {
  const result = { ferme: null, secteur: null, variete: null, stade: null }
  if (!libelle || typeof libelle !== 'string') return result
  const raw = libelle.trim()

  // Ferme : token Fx (F1..F9) où qu'il soit dans le libellé.
  const fermeMatch = raw.match(/\bF(\d{1,2})\b/) || raw.match(/F(\d{1,2})\b/)
  if (fermeMatch) result.ferme = 'F' + fermeMatch[1]

  // Secteur : suite de tokens Sx (éventuellement joints par '.' ou '-').
  const secteurMatch = raw.match(/\bS\d+(?:[.\-]S?\d+)*\b/)
  if (secteurMatch) result.secteur = secteurMatch[0]

  // Variété : dictionnaire des variétés connues (insensible casse).
  const VARIETES = ['Maravilla', 'Yazmin', 'Reyna', 'Mia', 'Cascade', 'Breeze', 'Haas']
  const upper = raw.toUpperCase()
  for (const v of VARIETES) {
    if (upper.includes(v.toUpperCase())) { result.variete = v; break }
  }

  // Stade : dictionnaire des stades connus (insensible casse).
  const STADES = [
    { rx: /MOW\s*DOWN/i, label: 'Mow down' },
    { rx: /GREEN\s*CAN/i, label: 'Green can' },
    { rx: /LO?GN?\s*CAN|LONG\s*CAN/i, label: 'Long can' },
    { rx: /CUT\s*BACK/i, label: 'Cut back' },
    { rx: /MOTTE/i, label: 'Motte' },
  ]
  for (const s of STADES) {
    if (s.rx.test(raw)) { result.stade = s.label; break }
  }

  return result
}

/**
 * @typedef {Object} ParcelleConso
 * @property {string} id
 * @property {string} libelle
 * @property {string|null} ferme
 * @property {string|null} secteur
 * @property {string|null} variete
 * @property {string|null} stade
 * @property {string} famille
 */

/** @type {ParcelleConso[]} */
const parcellesConsommation = SEED_ROWS.map((row) => {
  const parsed = parseLibelle(row.libelle)
  return {
    id: row.id,
    libelle: row.libelle,
    ferme: parsed.ferme,
    secteur: parsed.secteur,
    variete: parsed.variete,
    stade: parsed.stade,
    famille: row.famille,
  }
})

/**
 * @typedef {Object} RepartitionPart
 * @property {string} cible  clé PARCELLE_TO_CPC
 * @property {number} pct    pourcentage (Σ === 100)
 */

/**
 * @typedef {Object} MappingCampagne
 * @property {string} docId
 * @property {string} campagne
 * @property {string} parcelle_conso_id
 * @property {string|null} cible_parcelle_culturale  clé PARCELLE_TO_CPC ou null
 * @property {RepartitionPart[]|null} repartition  1:N ou null (exclusif avec cible)
 * @property {string} statut
 * @property {number|null} confiance
 * @property {string|null} note
 * @property {Object|null} valide_par
 * @property {string|null} valide_le
 */

/** @type {MappingCampagne[]} */
const mappingCampagne = SEED_ROWS.map((row) => {
  return {
    docId: `${CAMPAGNE}__${row.id}`,
    campagne: CAMPAGNE,
    parcelle_conso_id: row.id,
    cible_parcelle_culturale: row.cible != null ? row.cible : null,
    repartition: Array.isArray(row.repartition) ? row.repartition : null,
    statut: row.statut,
    confiance: null,
    note: row.note || null,
    valide_par: null,
    valide_le: null,
  }
})

/**
 * Regroupements avocatier par ferme — info card, AUCUN mapping.
 */
const avocatierParFerme = [
  { ferme: 'F2', varietes: 'Haas · Bacon · Zutano' },
  { ferme: 'F3', varietes: 'Haas · Fuerte · Zutano' },
  { ferme: 'F4', varietes: 'Haas · Fuerte · Zutano' },
  { ferme: 'F6', varietes: 'Haas · Bacon · Fuerte · Zutano' },
]

const SEED_2025_2026 = {
  campagne: CAMPAGNE,
  parcellesConsommation,
  mappingCampagne,
  avocatierParFerme,
}

module.exports = {
  CAMPAGNE,
  SEED_2025_2026,
  parcellesConsommation,
  mappingCampagne,
  avocatierParFerme,
  parseLibelle,
}
