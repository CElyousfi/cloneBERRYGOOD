// JSDoc typedefs only — no runtime code.
// Importable via /** @typedef {import('./types').IrrigationEvent} IrrigationEvent */

/**
 * @typedef {Object} RawStation
 * @property {string} [label]
 * @property {number} [ec]
 * @property {number} [ph]
 * @property {number} [volume]
 */

/**
 * @typedef {Object} RawIrrigationReading
 * @property {string} [id]
 * @property {string} date            "YYYY-MM-DD"
 * @property {string} ferme           "F1" | "F5"
 * @property {string} parcelle        PARCELLES_CULTURALES.id
 * @property {string} [parcelleLabel]
 * @property {string} heure           "HH:MM"
 * @property {number} [duree]         minutes
 * @property {RawStation[]} [points]
 * @property {RawStation[]} [drainage]
 * @property {string} [source]        "manual" | "scan_ocr"
 * @property {number} [createdAt]
 * @property {number} [updatedAt]
 */

/**
 * @typedef {Object} IrrigationEvent
 * Domain-canonical pulse: one document of irrigation_readings collapsed
 * into per-event averages/sums across stations. Null when not measurable.
 * @property {string|null} id
 * @property {string|null} date
 * @property {string|null} ferme
 * @property {string|null} parcelle
 * @property {string|null} parcelleLabel
 * @property {string|null} heure        "HH:MM"
 * @property {number} dureeMin
 * @property {number|null} ecPts        average EC over points (mS/cm)
 * @property {number|null} phPts
 * @property {number|null} volumePtsMl  total points volume (mL)
 * @property {number|null} ecDrain
 * @property {number|null} phDrain
 * @property {number|null} volumeDrainMl
 * @property {number} stationCount
 * @property {string} source
 * @property {number|null} createdAt
 */

/**
 * @typedef {IrrigationEvent & {
 *   minutesFromMidnight: number|null,
 *   timeSincePreviousPulseMin: number|null,
 *   cumulativeInputMl: number,
 *   cumulativeDrainMl: number,
 *   cumulativeDrainPct: number|null,
 *   drainPct: number|null,
 *   ecDelta: number|null,
 *   isHighDrain: boolean,
 *   isLowDrain: boolean,
 *   isLateDayPulse: boolean
 * }} EnrichedIrrigationEvent
 */

/**
 * @typedef {Object} DiagnosisReason
 * @property {string} code        machine code, ex: "OVER_DRAIN", "EC_DRIFT"
 * @property {string} message     human-readable
 */

/**
 * @typedef {"optimal"|"under-drain"|"over-drain"|"critical"|"unknown"} Diagnosis
 */

/**
 * @typedef {Object} DailyIrrigationSummary
 * @property {string} date
 * @property {string} parcelle
 * @property {string|null} ferme
 * @property {string|null} parcelleLabel
 * @property {number} totalInputMl
 * @property {number} totalDrainMl
 * @property {number|null} totalDrainPct
 * @property {number|null} avgEcPts
 * @property {number|null} avgEcDrain
 * @property {number|null} avgPhPts
 * @property {number|null} avgPhDrain
 * @property {number} pulseCount
 * @property {number} highDrainPulseCount
 * @property {number} lowDrainPulseCount
 * @property {string|null} irrigationCutoffTime  last pulse "HH:MM"
 * @property {Diagnosis} diagnosis
 * @property {DiagnosisReason[]} diagnosisReasons
 * @property {DrainTrend|null} drainTrend
 * @property {EnrichedIrrigationEvent[]} pulses
 */

/**
 * @typedef {Object} DrainTrend
 * Linear regression of drainPct vs hours-of-day across a day's pulses.
 * @property {number} slopePctPerHour       drain pct points gained per hour
 * @property {number} startPct              predicted drain at first pulse
 * @property {number} endPct                predicted drain at last pulse
 * @property {string|null} firstHighDrainTime  HH:MM of first pulse > highDrainPct
 * @property {number} samples
 */

/**
 * @typedef {"info"|"ok"|"warning"|"critical"} RecommendationLevel
 */

/**
 * @typedef {Object} IrrigationRecommendation
 * @property {RecommendationLevel} level
 * @property {string} code              ex: "REDUCE_NEXT_PULSE"
 * @property {string} title             short human label
 * @property {string} message            metric-bound description
 * @property {string} rationale          agronomic reason
 * @property {string} suggestedAction    actionable step for chef ferme
 */

/**
 * @typedef {Object} IrrigationThresholds
 * @property {number} lowDrainPct
 * @property {number} targetDrainMinPct
 * @property {number} targetDrainMaxPct
 * @property {number} highDrainPct
 * @property {number} severeHighDrainPct
 * @property {number} ecDeltaHigh
 * @property {number} phDrainHigh
 * @property {number} lateDayHour
 * @property {number} phMin
 * @property {number} phMax
 * @property {number} ecRatioHigh
 * @property {number} consecutiveHighDrainCount
 * @property {number} consecutiveLowDrainCount
 * @property {number} drainTrendRisingPctPerHour
 * @property {number} minPulsesForTrend
 * @property {number} ecDrainDriftMsCm
 * @property {number} sustainedOverDrainDays
 * @property {number} sustainedLowDrainDays
 * @property {number} drainInstabilityPct
 * @property {number} minDaysForPeriodTrend
 * @property {number} weatherHeatTmax
 * @property {number} weatherHighEto
 * @property {number} weatherRainMm
 * @property {number} weatherDryHumidity
 */

/**
 * @typedef {Object} StreakInfo
 * @property {number} length
 * @property {string|null} dateFrom
 * @property {string|null} dateTo
 */

/**
 * @typedef {Object} PeriodTrends
 * Cross-day signals for a single parcelle over a date range.
 * @property {number} days                    number of summary points
 * @property {number} spanDays                last - first day
 * @property {string} dateFrom
 * @property {string} dateTo
 * @property {number|null} ecDrainSlopePerDay      mS/cm per day
 * @property {number|null} ecApportSlopePerDay
 * @property {number|null} drainPctSlopePerDay      pp per day
 * @property {number|null} phDrainSlopePerDay
 * @property {number|null} ecDrainDrift              total drift over span
 * @property {number|null} ecApportDrift
 * @property {number|null} drainPctDrift
 * @property {number|null} phDrainDrift
 * @property {StreakInfo} overDrainStreak            longest consecutive over/critical days
 * @property {StreakInfo} underDrainStreak
 * @property {number|null} drainStddev               pp
 * @property {number|null} ecDrainStddev             mS/cm
 * @property {number|null} phDrainStddev
 */

/**
 * @typedef {Object} IrrigationFeatureRow
 * Flat row for a future ML/predictive dataset. One row = (date, parcelle).
 * Prefix `f_` = feature, `label_` = supervised target.
 * @property {string} date
 * @property {string} parcelle
 * @property {string|null} ferme
 * @property {number|null} f_total_input_ml
 * @property {number|null} f_total_drain_ml
 * @property {number|null} f_drain_pct
 * @property {number|null} f_ec_pts
 * @property {number|null} f_ec_drain
 * @property {number|null} f_ec_delta
 * @property {number|null} f_ph_pts
 * @property {number|null} f_ph_drain
 * @property {number} f_pulse_count
 * @property {number} f_high_drain_count
 * @property {number} f_low_drain_count
 * @property {number|null} f_cutoff_min
 * @property {number|null} f_eto
 * @property {number|null} f_t_max
 * @property {number|null} f_t_min
 * @property {number|null} f_humidity
 * @property {number|null} f_precip
 * @property {Diagnosis} label_diagnosis
 */

module.exports = {};
