// JSDoc typedefs only — no runtime code.
// Importable via /** @typedef {import('./types').PhenologyStage} PhenologyStage */
//
// Source de vérité métier :
//   - phenology-tables.md (référentiel GDD/DLI/irrigation par stade × variété)
//   - kpi-tables.md (KPIs par stade)
//   - brief-claude-code-addendum-v2.1.md (schéma Firestore étendu)

// =====================================================================
// Brut capteurs
// =====================================================================

/**
 * @typedef {Object} RadiationSample
 * Un échantillon brut radiatif tel que renvoyé par FarmRoad (pas 5 min en théorie,
 * ~2 min en pratique sur les sondes BGF). Au moins l'un des deux champs
 * radiationWm2 ou parUmolM2s doit être renseigné.
 * @property {Date|number|string} timestamp        Date object, epoch ms, ou ISO string
 * @property {number} [radiationWm2]               Radiation totale (W/m²)
 * @property {number} [parUmolM2s]                 PAR (µmol/m²/s)
 */

// =====================================================================
// Calculs journaliers
// =====================================================================

/**
 * @typedef {Object} GddDailyResult
 * Résultat du calcul GDD pour une journée.
 * @property {number} gddDay         GDD du jour (°Cd), toujours >= 0
 * @property {number} tMaxCapped     T_max après application du cap (= min(tMax, tCap))
 * @property {number} tMinUsed       T_min utilisé (NON capé — voir phenology-tables.md §1)
 */

/**
 * @typedef {"good"|"partial"|"interpolated"|"fallback"} DataQuality
 * Qualité d'une mesure agrégée sur 24h :
 *   - good         : >= 240 samples (>83 % couverture sur pas 5 min)
 *   - partial      : 120-240 samples
 *   - interpolated : < 120 samples (interpolation ou journée précédente)
 *   - fallback     : source secondaire utilisée (ex: Meteoblue au lieu de FarmRoad)
 */

/**
 * @typedef {Object} RadsumDailyResult
 * Résultat du calcul RADSUM + DLI pour une journée.
 * @property {number} radsumMjM2          MJ/m² intégré sur 24h
 * @property {number} dliMolM2            Daily Light Integral (mol/m²/j)
 * @property {DataQuality} dataQuality
 * @property {number} samplesUsed         Nombre de samples valides utilisés
 * @property {number} samplesExpected     Nombre attendu (288 pour pas 5 min standard)
 */

/**
 * @typedef {Object} DliConfig
 * Cibles DLI par stade phénologique (cf. phenology-tables.md §2.5).
 * @property {number} target_min      Cible basse (mol/m²/j)
 * @property {number} target_max      Cible haute
 * @property {number} critical_min    Seuil critique bas
 * @property {number} critical_max    Seuil critique haut
 * @property {string} [unit]          "mol/m²/j" par défaut
 */

/**
 * @typedef {"below_critical"|"below_target"|"in_target"|"above_target"|"above_critical"} DliStatusCode
 */

/**
 * @typedef {Object} DliStatus
 * Évaluation d'un DLI quotidien vs cibles du stade.
 * @property {DliStatusCode} status
 * @property {number} stageMin       target_min du stade
 * @property {number} stageMax       target_max du stade
 */

// =====================================================================
// Référentiel phénologique
// =====================================================================

/**
 * @typedef {Object} IrrigationRecipe
 * Recette d'irrigation prescrite pour un stade donné (phenology-tables.md §5-8).
 * @property {number} ec_min                 mS/cm
 * @property {number} ec_max                 mS/cm
 * @property {number} ph_min
 * @property {number} ph_max
 * @property {number} drainage_pct_target    cible % drainage
 * @property {number} drainage_pct_min
 * @property {number} drainage_pct_max
 */

/**
 * @typedef {Object} StageEstimatedDays
 * @property {number} min
 * @property {number|null} max     null = open-ended (dernier stade)
 */

/**
 * @typedef {Object} PhenologyStage
 * Définition d'un stade phénologique (S0-S8 ou F0-F7).
 * @property {string} code                       "S0", "S1", …, "F0", … "F7"
 * @property {string} name                       Libellé humain ("Reprise / enracinement")
 * @property {number} gddMin                     Seuil bas GDD du stade (avant coef précocité)
 * @property {number} gddMax                     Seuil haut (exclusif sauf dernier)
 * @property {StageEstimatedDays} [estimatedDays]
 * @property {IrrigationRecipe} irrigation
 * @property {DliConfig} dli
 * @property {string} [notes]
 * @property {boolean} [criticalStage]           True pour S4/F3 (floraison)
 */

/**
 * @typedef {"maravilla"|"jasmin"} VarietyId
 */

/**
 * @typedef {"primocane"|"floricane"} CycleType
 */

/**
 * @typedef {Object} PhenologyReferenceMetadata
 * @property {string} version                      ex "1.1.0"
 * @property {string} lastUpdated                  YYYY-MM-DD
 * @property {string} source
 * @property {string} calibrationStatus
 */

/**
 * @typedef {Object} PhenologyReference
 * Document seed `phenology_references/{varietyId}_{cycleType}` (cf. phenology-tables.md §11.1).
 * @property {VarietyId} varietyId
 * @property {CycleType} cycleType
 * @property {string} displayName
 * @property {number} tBase                        °C, standard 5
 * @property {number} tCap                         °C, standard 30
 * @property {number} precocityCoefficient         1.00 maravilla, 0.92 jasmin
 * @property {PhenologyStage[]} stages             ordonnés par gddMin croissant
 * @property {PhenologyReferenceMetadata} metadata
 */

// =====================================================================
// Erreurs typées (usage interne)
// =====================================================================

/**
 * @typedef {Object} StageOverride
 * Permet à une parcelle de surcharger les seuils d'un ou plusieurs stages
 * sans modifier la référence partagée (cf. plot.phenology.customStageThresholds).
 * Forme : { [stageCode]: gddMin } — seul le seuil bas est surchargé, le seuil haut
 * = seuil bas du stade suivant (ou ∞ pour le dernier).
 *
 * Exemple : { "S1": 145, "S2": 380 }
 */

module.exports = {};
