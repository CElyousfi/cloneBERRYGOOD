<!-- GENERATED FILE — ne pas éditer à la main. Régénérer : npm run code-index -->
<!-- sourceFingerprint: sha256:37acc9dc8d10a8af -->
# Code Map — Modules lib (178)

API publique de chaque module public/lib/ (UMD `window.X`) et functions/lib/ (`module.exports`) — pour savoir quel helper existe déjà avant d'en réécrire un.

| Fichier | Export global | Fonctions |
| --- | --- | --- |
| functions/lib/auth/paieAccess.js | — | canAccessDivers, resolvePointageRHAccess |
| functions/lib/auth/registryAccess.js | — | CHEF_FIELDS, FULL_FIELDS, normalizeMatriculeNum, normalizeAllowedSet, projectChefFields, projectRegistryFull, projectRegistryForChef |
| functions/lib/auth/resolveRole.js | — | resolveCallerRole, resolveCallerProfile |
| functions/lib/bdc/bdcDigest.js | — | PENDING_STATUSES, RECEIVABLE_STATUSES, ROLE_LABELS, DEFAULT_ITEMS_LIMIT, MISE_EN_SERVICE_MS, MISE_EN_SERVICE_LABEL, isDepuisMiseEnService, blockedBy, summarizePendingValidation, buildDigestPayload, summarizePendingReception, detailArticles, buildReceptionPayload |
| functions/lib/bdc/blBatch.js | — | IN_MAX_VALUES, chunkIds, groupBlsByBdcId |
| functions/lib/bdc/mirrorSync.js | — | PLACEHOLDER_PRICE, num, toIsoDate, isPlaceholderPrice, mapLine, buildMirrorDocs, buildReport |
| functions/lib/bdc/receptionGuard.js | — | validateReliquat, computeReceivedByArticle, computeOrderedByArticle, deriveDeliveryStatus, RELIQUAT_EPSILON |
| functions/lib/bdc/reminder.js | — | REMINDER_COOLDOWN_MS, resolveReminderTargets, reminderCooldown, formatWaitingDuration |
| functions/lib/bdc/workflow.js | — | DIRECT_DG_FARMS, requiresChefValidation, nextStatusOnSubmit, bypassReason, chefProfileForFerme |
| functions/lib/budgetBgf.js | — | BUDGET_BGF |
| functions/lib/bugReports/bugStatus.js | — | BUG_STATUSES, FILTERABLE_STATUSES, ADMIN_PROFILES, isValidStatus, isFilterableStatus, isAdminProfile, validateStatusUpdate, sortReportsByCreatedDesc |
| functions/lib/bugReports/validateBugReport.js | — | validateBugReport, MAX_DESCRIPTION, MAX_PHOTO_BASE64_CHARS |
| functions/lib/caisseImport/detectCols.js | — | detectCols |
| functions/lib/caisseImport/excelToISO.js | — | excelToISO |
| functions/lib/caisseImport/index.js | — | parseWorkbook, buildDrySummary, excelToISO, detectCols, CAISSE_FORMATS, SAMPLE_LIMIT |
| functions/lib/caisseImport/parsers.js | — | parseDepensesMonthly, parsePaieRecap, parseBahiaSingle |
| functions/lib/campagneBudget/culture.js | — | normCulture, resolveCulture |
| functions/lib/campagneBudget/validate.js | — | MAX_JH_PAR_HA, MAX_FAMILLES, MAX_OPERATIONS, MAX_QUINZAINES, MAX_FANOUT_LABELS, MAX_PURGE_RATIO, CULTURES_BUDGET_QUINZAINE, OP_KEY_SEP, quinzaineKey, quinzaineNum, purgeAutorisee, normCampagne, normLabel, normFanoutLabels, budgetDocId, opKey, splitOpKey, familleDuCode, indexOperations, canonicalizeOperationKeys, operationLabel, parseBudgetValue, validateBudgetSave, mergeBudgets, mergeBudgetsOperations, mergeBudgetsQuinzaine, quinzainesSupprimees, familleTotal, purgeFamillesInconnues, purgeOperationsInconnues, purgeQuinzainesInconnues, writeBudgetInTransaction |
| functions/lib/campagneExport/analytiqueUtils.js | — | opLabel, opKey, buildAnalytiquePivot, resolveGroupeFamille, resolveGbCode, buildAnalytiquePivotByFamille, GB_GROUPE_MAP, GROUPE_ORDER, GB_ORDER |
| functions/lib/campagneExport/buildWorkbook.js | — | refKey, cultureOf, sbNom, sbHa, buildVarieteView, buildCultureWorkbook |
| functions/lib/campagneExport/campagneExportUtils.js | — | SHEET_MAX, ROW_KIND, PERCENT_HEADER, BUDGET_HEADER, scopeNote, perHa, buildParcelleBudgetIndex, haLabel, numFmtFor, percentFmtFor, percentColumns, sumBudget, budgetScope, budgetCells, safeSheetName, buildSyntheseRows, buildSyntheseAoA, syntheseSheetCols, buildParcelleSheetRows, buildParcelleSheetAoA, parcelleSheetCols |
| functions/lib/campagneExport/cultureUtils.js | — | CULTURES, normCulture, resolveCulture, matchesCulture |
| functions/lib/campagneExport/index.js | — | campagneExportUtils, cultureUtils, analytiqueUtils, buildCultureWorkbook, buildVarieteView, renderWorkbookBuffer, generateCampagneWorkbook |
| functions/lib/campagneExport/renderXlsx.js | — | XL, xlFill, styleFullWidth, styleRow, buildExcelWorkbook, renderWorkbookBuffer |
| functions/lib/campagneRapportHebdo/constants.js | — | CRON_CONFIG, HTTP_CONFIG, AUDIENCE, TEMPLATE_NAME, ALERT_TEMPLATE_NAME, ALERT_PROFILE_ID, XLSX_MIME, TRIGGER_PROFILES, CONFIRM_SEND |
| functions/lib/campagneRapportHebdo/envois.js | — | buildEnvois, resumeEnvois, nbParcellesFromFeuilles, formatDateLabel, buildBodyParams |
| functions/lib/campagneRapportHebdo/index.js | — | CRON_CONFIG, HTTP_CONFIG, AUDIENCE, TEMPLATE_NAME, ALERT_TEMPLATE_NAME, ALERT_PROFILE_ID, XLSX_MIME, TRIGGER_PROFILES, CONFIRM_SEND, buildEnvois, resumeEnvois, nbParcellesFromFeuilles, formatDateLabel, buildBodyParams, resolveRecipientsByProfile, checkRecipients, dryRun, runRapportHebdo, buildHttpHandler |
| functions/lib/campagneRapportHebdo/runJob.js | — | resolveRecipientsByProfile, checkRecipients, dryRun, runRapportHebdo, buildHttpHandler, maskPhone |
| functions/lib/fonctions/fonctionsHistory.js | — | buildFonctionUpdate |
| functions/lib/fonctions/fonctionsValidate.js | — | normalizeFonctionSlug, normalizeLibelle, normalizeOrdre |
| functions/lib/forecastConfirmation.js | — | parseForecastConfirmation |
| functions/lib/heuresSup/heuresSup.js | — | SEUIL_MINUTES, RECOLTE_FAMILLE, parseHHMM, computeDurationOvertime, formatDuration, normalizeFonctionLabel, matchesExcludedFonction, shouldExcludeWorkerDay |
| functions/lib/irrigation/crossDayTrends.js | — | detectCrossDayTrends, buildPeriodRecommendations, dayDiff, longestConsecutiveStreak, stddev, regressByDay |
| functions/lib/irrigation/dailySummary.js | — | buildDailySummaries, computeDrainTrend, buildHourlyRadCumulative |
| functions/lib/irrigation/dataAccess.js | — | READINGS_COLLECTION, SNAPSHOTS_COLLECTION, fetchIrrigationReadings, saveSnapshot, fetchSnapshots |
| functions/lib/irrigation/diagnose.js | — | diagnoseDailySummary |
| functions/lib/irrigation/enrich.js | — | enrichEvents, effectiveLateDayMin |
| functions/lib/irrigation/featureRow.js | — | buildFeatureRow, buildFeatureRows |
| functions/lib/irrigation/index.js | — | analyseReadings |
| functions/lib/irrigation/nextPulse.js | — | recommendNextPulse, recommendPulseTrail |
| functions/lib/irrigation/normalize.js | — | normalizeReading, normalizeReadings |
| functions/lib/irrigation/parcelleMeta.js | — | PARCELLE_META, PULSE_VOLUME_TARGETS, FARMROAD_DEVICE_BY_GH_TYPE, FIRESTORE_COLLECTION, getParcelleMeta, getPulseVolumeTarget, getTransmittance, getFarmroadDeviceId, buildParcelleMetaById, loadParcelleMetaFromFirestore, clearParcelleMetaCache |
| functions/lib/irrigation/radiationStrategy.js | — | getRadiationTarget, integrateRadiation, predictNextPulseTime, dailyRadiationTotal, buildRadiationRecommendations |
| functions/lib/irrigation/recommendations.js | — | buildRecommendations |
| functions/lib/irrigation/thresholds.js | — | DEFAULT_THRESHOLDS, getThresholds |
| functions/lib/irrigation/types.js | — | — voir fichier — |
| functions/lib/irrigation/utils.js | — | isPositiveNumber, toNumber, avgPositive, sumPositive, parseHeure, formatMinutes, groupBy |
| functions/lib/irrigation/weatherAdjustments.js | — | buildWeatherRecommendations |
| functions/lib/joursFeries/joursFeries.js | — | classifyNager, mergeHolidays, runSyncJoursFeries, fetchNagerHolidays, fetchHijriToGreg, computeLunarHolidays, fetchLunarHolidays, fetchAllHolidays, addDaysIso, daysBetween, baseLabel, isSecondDay, CRON_CONFIG, HTTP_CONFIG |
| functions/lib/mappingConso/campagneUtils.js | — | campagneOf, campagneCourante, debutCampagne, finCampagne, campagneDeCharge, phaseDeCharge |
| functions/lib/mappingConso/familles.js | — | familleForCulture |
| functions/lib/mappingConso/resolver.js | — | COVERED, NON_TRANCHE, HORS_PERIMETRE, campagneOf, aggregatePointages, splitMontant, makeCpcResolverFromCaneva, resolveCharges |
| functions/lib/mappingConso/seed.js | — | CAMPAGNE, SEED_2025_2026, parcellesConsommation, mappingCampagne, avocatierParFerme, parseLibelle |
| functions/lib/marcheLocalCaisse/applyEncaissements.js | — | normalizeReference, buildIdempotencyKey, buildDocId, planEncaissementWrites |
| functions/lib/marcheLocalCaisse/encaissements.js | — | ENCAISSEMENTS_SCHEMA, parseFrNumber, parseDate, parseEncaissements |
| functions/lib/marcheLocalCaisse/index.js | — | TYPE_VENTE_ML, round2, slugifyClient, deriveRecettes, aggregateByClient, grandTotal |
| functions/lib/marcheLocalCaisse/modeleVierge.js | — | buildModeleAoA, buildModeleWorkbook |
| functions/lib/meteo/meteoAlertes.js | — | TEMPLATE_NAME, IMAGE_TEMPLATE_NAME, METEOGRAM_FILENAME, COLLECTION, FENETRE_JOURS, SEUILS, MARGES_AGGRAVATION, LABELS, detecterAlertes, formatAlertes, filtrerAlertesANotifier, estPerimee, createMeteoAlertesJob |
| functions/lib/meteo/meteoblueProxy.js | — | roundCoord, buildWeatherBasicUrl, buildWeatherAgroUrl, buildSprayUrl, isValidWeatherPayload, isValidSprayPayload, fetchWeather, fetchSpray |
| functions/lib/meteo/meteogram.js | — | METEOGRAM_BASE_URL, PNG_MIME, PNG_SIGNATURE, MIN_PNG_BYTES, DEFAULT_TIMEOUT_MS, DEFAULT_UNITS, buildMeteogramUrl, isValidPng, withTimeout, fetchMeteogram |
| functions/lib/meteo/renderPng.js | — | PNG_MIME, FONT_PATH, DEFAULT_FONT_FAMILY, DEFAULT_WIDTH, buildResvgOptions, renderSvgToPng |
| functions/lib/meteo/sprayChart.js | — | WIDTH, HEIGHT, MARGIN, TITLE_H, PANEL_GAP, WORK_HOUR_START, WORK_HOUR_END, AXIS_HOUR_END, BAND_COLORS, LEGEND_OPACITY, THEME, escapeXml, extractHourlyTemperatures, extractSprayHours, buildSprayChartSvg |
| functions/lib/meteo/sprayDigest.js | — | CRON_CONFIG, HTTP_CONFIG, COORDS, AUDIENCE, TEMPLATE_NAME, IMAGE_TEMPLATE_NAME, CHART_FILENAME, FALLBACK_TEMPLATE_NAME, FALLBACK_ERROR_CODES, TRIGGER_SEND_ROLES, AUDIENCE_PROFILE_IDS, parseOnlyProfile, audienceFor, isRealSend, shouldFallback, todayCasablancaISO, formatDateParam, nextDayISO, scoreLabel, formatNombreFr, formatWindDirection, deltaTZone, formatDeltaT, niveauRisqueMaladie, DELTA_T_LABEL, DELTA_T_IDEAL_MIN, DELTA_T_IDEAL_MAX, RISQUE_MALADIE_SEUIL_MODERE, RISQUE_MALADIE_SEUIL_ELEVE, buildSprayWindows, buildTempSummary, formatDigest, createMeteoDigestJob |
| functions/lib/netafim/auth.js | — | TOKEN_TTL_SAFETY_MS, FALLBACK_TTL_MS, makeGetAccessToken |
| functions/lib/netafim/client.js | — | NetafimError, KIND, classify, postJson |
| functions/lib/netafim/config.js | — | CONFIG_COLLECTION, CONFIG_DOC, CACHE_TTL_MS, DEFAULTS, makeGetConfig |
| functions/lib/netafim/dataAccess.js | — | READINGS_COLLECTION, CURSOR_COLLECTION, CURSOR_DOC, upsertReadings, readSyncCursor, writeSyncCursor |
| functions/lib/netafim/endpoints.js | — | PATH_IRRIGATION_LOGS, PATH_ACCUMULATION_EVENTS, joinUrl, toIso, fetchIrrigationLogsPage, fetchAccumulationEventsPage |
| functions/lib/netafim/index.js | — | syncBahia, NETAFIM_WINDOW_MAX_MS |
| functions/lib/netafim/mapper.js | — | FERME, SOURCE, DOC_ID_PREFIX, buildDocId, toLocalDate, toLocalHour, durationToMinutes, mapNetafimItemToReading |
| functions/lib/netafim/pagination.js | — | HARD_PAGE_CAP, fetchAllPages |
| functions/lib/netafim/parcelles.js | — | COLLECTION, buildParcelleUpserts, persistParcelles |
| functions/lib/netafim/rateLimiter.js | — | todayKey, tryConsume |
| functions/lib/netafim/types.js | — | — voir fichier — |
| functions/lib/paie/coutMainOeuvre.js | — | CATEGORIES, coutFeries, nbJoursDistincts, masseSalarialeNette, netAPayer, categorieMO, primeFonctionADate, joursParOuvrier, paieOuvrier, netParCategorie, chargesSociales, coutEmployeur, totalQuinzaine |
| functions/lib/paie/coutOuvrierCampagne.js | — | prefixeEquipe, primeTransport, tarifADate, dateEffet, primeRecolte, cumuleJournee, paieOuvrierQuinzaine, coutOuvrierCampagne |
| functions/lib/paie/coutQuinzaineSnapshot.js | — | POSTES, nombre, normaliser, valider, versDocument, parPeriode |
| functions/lib/paie/paieUtils.js | — | PAIE_BAREMES_DEFAULT, trouverPalierAnciennete, calculerPaieOuvrier, resolveSmagForDate, computeWorkerPaie, computePayslip |
| functions/lib/parcelleGroupes/seedHa.js | — | MAX_LABELS, RAISON_DEJA_SB, RAISON_SANS_SURFACE, SOURCE_BEE_ONE, normLabel, sanitizeLabels, computeSeedPlan |
| functions/lib/parcelleGroupes/split.js | — | QTY_DECIMALS, round3, totalHa, computeParts, splitQuantite, expandItems |
| functions/lib/parcelleGroupes/validate.js | — | slugGroupeLabel, validateGroupeSave |
| functions/lib/phenology/dailyPhenologyJob.js | — | runDailyPhenologyJob, buildHttpHandler, CRON_CONFIG, HTTP_CONFIG, __internals |
| functions/lib/phenology/farmroadStationResolver.js | — | resolveStation |
| functions/lib/phenology/gddCalculator.js | — | calculateDailyGdd |
| functions/lib/phenology/index.js | — | calculateDailyGdd, calculateDailyRadsum, estimateMissingRadiation, evaluateDliVsTarget, resolveStage, getIrrigationRecipe |
| functions/lib/phenology/irrigationRecipe.js | — | getIrrigationRecipe |
| functions/lib/phenology/outdoorWeatherFallback.js | — | fetchOutdoorDaily, clearOutdoorCache, __internals, _mapResponse, BASE_URL |
| functions/lib/phenology/phenologyDailyWriter.js | — | writePhenologyDaily |
| functions/lib/phenology/radiationFetcher.js | — | fetchRadiationDaily, __internals, FARMROAD_SLOTS_EXPECTED, QUALITY_GOOD_THRESHOLD, QUALITY_PARTIAL_THRESHOLD, SLOT_DURATION_MS, SLOT_CENTER_OFFSET_MS, DEFAULT_SUNRISE_HOUR, DEFAULT_SUNSET_HOUR, W_PAR_TO_UMOL, PAR_TO_RAD_RATIO_DEFAULT, _buildSyntheticSamples, _slotCenterMs, _dateToDayStartMs |
| functions/lib/phenology/radsumCalculator.js | — | calculateDailyRadsum, estimateMissingRadiation, evaluateDliVsTarget, __internals, SAMPLES_EXPECTED_PER_DAY, SAMPLES_GOOD_THRESHOLD, SAMPLES_PARTIAL_THRESHOLD, MAX_GAP_MS, PAR_TO_RAD_RATIO_DEFAULT, W_PAR_TO_UMOL, MAX_RADIATION_WM2, MAX_PAR_UMOL_M2_S |
| functions/lib/phenology/referenceLoader.js | — | loadReference, clearReferenceCache, COLLECTION |
| functions/lib/phenology/stageResolver.js | — | resolveStage |
| functions/lib/phenology/types.js | — | — voir fichier — |
| functions/lib/phone/formatPhoneE164.js | — | formatPhoneE164 |
| functions/lib/pointage/campagnePeriodes.js | — | quinzaineNum, buildPeriodeCampagne, makeCampagneAwareComparator, sortPeriodesByCampagne, defaultPeriodeForCampagne, splitCompositeLabel, filterRowsByExactDates, buildDisambiguatedPeriodeMap |
| functions/lib/pointage/countDistinctByFermeType.js | — | countDistinctByFermeType |
| functions/lib/pointage/dedupeWorkersByMatricule.js | — | dedupeWorkersByMatricule |
| functions/lib/pointage/mirrorWindow.js | — | REBUILD_WINDOW_DAYS, computeWindowCutoffId, filterDateIdsWithinWindow, buildPeriodeMapFromDailyDocs |
| functions/lib/pointage/parcellesParams.js | — | aggregateParcellesFromMirror, mergeReferentiel, isValidCampagneLabel |
| functions/lib/pointage/pullHealth.js | — | computePullHealth, decidePullAlert, buildPullMessage, toMs, ddmm |
| functions/lib/pointage/referentielSync.js | — | syncReferentielParcelleFerme, buildReferentielDoc, decideUnresolvedAlert, buildUnresolvedMessage, resolveCampagneId, REFERENTIEL_SQL, REFERENTIEL_COLLECTION, ALERT_DEBOUNCE_MS |
| functions/lib/pointage/refParcelleFerme.js | — | resolveFermeFromParcelle, F1_NUMERIQUES, F5_NUMERIQUES, AVOCATIER_NUMERIQUES |
| functions/lib/pointage/slidingWindow.js | — | computePointageWindow, todayInCasablanca, addDaysStr, DEFAULT_WINDOW_DAYS |
| functions/lib/pointageBdp/comparePointage.js | — | rowKey, indexByKey, comparePointage, JR_KEYS |
| functions/lib/pointageBdp/mapBdpRow.js | — | s, n, deriveJournees, derivePeriodePaie, mapBdpRowToContract |
| functions/lib/pointageValidation/stateMachine.js | — | CHEF_FERME_BY_PROFILE, SUBMIT_STATES, EQUIPE_STATUSES, DIVERS_STATUSES, normalizeFermeState, isFermeLocked, canValidateEquipe, canSubmitFerme, canChefValidate, canChefReject, canUnlock, nextSubmitState, fermeForChefProfile |
| functions/lib/primes/identiteSync.js | — | buildIdentiteSyncPlan |
| functions/lib/primes/primeHistory.js | — | buildPrimeUpdate |
| functions/lib/primes/primesAccess.js | — | canManagePrimes, forbiddenReason, PRIMES_PROFILES_AUTORISES |
| functions/lib/primes/primesImport.js | — | normalizeMatricule, buildImportPreview |
| functions/lib/probeStaleness/probeStaleness.js | — | normalizeMaxDate, isWorkingDay, lastExpectedWorkingDay, daysBetween, computeStaleness, decideAlert, toIsoDate |
| functions/lib/productionEstimation.js | — | CYCLE2_VARIETIES, splitVariety, applyVarietyMapping, parseExpDateISO, normalizeBon, buildMappedWithEstimation, computeCycle2Stats, formatCycle2Section, getHa, getPlants |
| functions/lib/productivity/constants.js | — | DRISCOLL_GROWER_CODES, FARMS, CATEGORIES, TOP25_PERCENTILE |
| functions/lib/productivity/index.js | — | — voir fichier — |
| functions/lib/productivity/pdfParser.js | — | extractPdfText, extractWeekAndCampaign, parseProductivityPdf, parseWithClaude, buildPrompt |
| functions/lib/productivity/ranker.js | — | percentileThreshold, enrichTreatment, enrichTreatments, buildFarmSummary |
| functions/lib/productivity/refetchPipeline.js | — | refetchProductivityReports |
| functions/lib/sentinel/sentinelRecipients.js | — | filterSentinelRecipients |
| functions/lib/stock/articleHistoryIndex.js | — | buildArticleHistoryIndex, sliceArticleHistory, isStockLieu, STOCK_LIEU_TYPES |
| functions/lib/stock/locationsConfig.js | — | ROLE_CONTROLE, authorizeSetLocations, buildLocationsPatch |
| functions/lib/stock/movementGuard.js | — | IMPORT_CREATED_BY, VALIDATED_STATUS, isImportedMovement, isValidatedMovement, isDeletedMovement, isCreator, evaluateMutable, canEditMovement, canDeleteMovement, ADMIN_DELETE_ROLES, isAdminDeleter, evaluateAdminDelete, canAdminDeleteMovement, refusalMessage |
| functions/lib/stock/movementImpact.js | — | isImpactApplied, IMPACT_STATUS |
| functions/lib/stock/pmpDetail.js | — | canon, canonUnite, isTonne, normalizeFactureLine, dominantUnite, computeFacturePMP |
| functions/lib/stock/scanAttachment.js | — | SIGNED_URL_TTL_MS, MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_MIME, validateAttachmentMetadata, generateSignedUrl, extractPdfText, downloadBuffer, utils |
| functions/lib/stock/scanAttachmentUtils.js | — | ENTITY_MAP, ALLOWED_EXTENSIONS, isValidEntityType, collectionForEntity, folderForEntity, extOf, mimeFromFilename, sanitizeFilename, buildScanPath, isScanPathForEntity, validateUploadAttachmentParams |
| functions/lib/stock/stockGuard.js | — | — voir fichier — |
| functions/lib/stock/valuationPMP.js | — | SOURCE_PRIORITY, parsePrice, normalizePrice, resolveAcquisitionPrice, computePMP |
| functions/lib/stockCaneva/guard.js | — | evaluateGuard, REQUIRED_SHEETS, SHRINK_RATIO |
| functions/lib/stockCaneva/index.js | — | parseWorkbook, evaluateGuard, computeDayDiff, impactedDates, buildDrySummary, movementDelta, movementKey, dayFingerprint, SHEETS, IMPORT_SOURCE, REQUIRED_SHEETS, SHRINK_RATIO, MISMATCH_SAMPLE, mappings |
| functions/lib/stockCaneva/mappings.js | — | IMPORT_SOURCE, ARTICLE_MAP, NEW_ARTICLES, PARCELLE_MAP, PARCELLE_TO_CPC, normalizeFerme, toISO, buildLieu, mapMotifToSortieType, buildArticleMap, resolveArticle |
| functions/lib/stockCaneva/parseWorkbook.js | — | parseWorkbook, SHEETS, IMPORT_SOURCE |
| functions/lib/stockFiles/allowedMime.js | — | STOCK_FILE_ALLOWED_MIME, STOCK_FILE_ALLOWED_FORMATS_LABEL |
| functions/lib/stockFiles/farmDetection.js | — | detectFarmFromCaption |
| functions/lib/stockFiles/recordSubmission.js | — | COLLECTION, VALID_FARMS, FARM_LABELS, isValidFarm, todayInCasablanca, addDaysStr, emptyFarmState, emptySubmissionDoc, recordSubmission |
| functions/lib/stockFiles/reminders.js | — | computeMissingFarms, buildReminderText, buildEscalationText, createStockFileReminders |
| functions/lib/stockMerge/articleMerge.js | — | normalizeArticleName, groupDuplicates, isMovementOpen, isBdcOpen, BDC_CLOSED_STATUSES |
| functions/lib/suppliers/supplierValidation.js | — | validateSupplier, normalizeIf, normalizeIce, normalizePhone, isValidIf, isValidIce, isValidPhone, isNonEmpty |
| functions/lib/triage/bugTriage.js | — | MODULES, SEVERITIES, TRIAGE_MODEL, SYSTEM_PROMPT, TRIAGE_TOOL, shortId, shouldNotifyResolved, buildResolvedMessage, buildResolvedDGMessage, buildRecentBugsBlock, buildSystemPrompt, buildTextBlock, buildUserContent, isValidTriage, parseTriage, callClaude |
| functions/lib/validation/validationAccess.js | — | CAPORAL_FERME_BY_PROFILE, genericRoleFor, fermeForCaporalProfile, authorizeValidationAction |
| functions/lib/valorisation/accessControl.js | — | FULL_ACCESS_PROFILES, CHEF_PROFILE_FERME, CHEF_PROFILE_CULTURE, isChefProfile, resolveChefFerme, resolvePerimetre |
| functions/lib/valorisation/consoValorisation.js | — | canon, canonUnite, isTonne, normalizeQte, familleBucket, resolvePmp, aggregateConsoValorisee, SYNONYMES |
| functions/lib/valorisation/fermeParcelle.js | — | deriveFermeFromParcelle |
| public/lib/analytiqueUtils.js | AnalytiqueUtils | opLabel, opKey, buildAnalytiquePivot, resolveGroupeFamille, resolveGbCode, buildAnalytiquePivotByFamille, GB_GROUPE_MAP, GROUPE_ORDER, GB_ORDER |
| public/lib/authResilience.js | AuthResilience | action, reason, profile, 5000, 10000, 20000, decideAuthState, isNewAppVersion, retryDelayMs |
| public/lib/bdcReceptionUtils.js | BdcReceptionUtils | computeDeliveryData, resolveDeliveryDataOrError, filterReceptionsForBdc, computeReceptionRowsWithReliquat, computeReceptionEcart, clampReceivedQty |
| public/lib/bdcWorkflow.js | BdcWorkflow | DIRECT_DG_FARMS, requiresChefValidation, nextStatusOnSubmit, bypassReason, chefProfileForFerme |
| public/lib/caisseUtils.js | CaisseUtils | EXPENSE_TYPES, INCOME_TYPES, OP_EXPENSE_TYPES, OP_INCOME_TYPES, TRANSFER_TYPES, QUICK_PERIODS, QUICK_TYPES, ANOMALY_CODES, MONTANT_ANOMALY_THRESHOLD, DESCRIPTION_MIN_LENGTH, ANALYTIQUE_PLACEHOLDER, MONTANT_ATYPIQUE_FACTOR, MONTANT_ATYPIQUE_WINDOW_DAYS, MONTANT_ATYPIQUE_MIN_SAMPLE, DOUBLON_MAX_DATE_DELTA_DAYS, DOUBLON_LEVENSHTEIN_THRESHOLD, DOUBLON_DESC_PREFIX_LEN, DESCRIPTION_GENERIC_REGEX, BAHIA_MARKER, AVANCE_KEYWORD_REGEX, detectCaisseAnomalies, computeTotals, quickPeriodToDateRange, searchTransactions, filterByQuickType, detectAnomaliesBatch, extractBeneficiaire, aggregateAvances, COMPTE_CLIENT_PREFIX, isCompteClientCaisse, computeCompteClientTotals |
| public/lib/campagneBudgetPivot.js | CampagneBudgetPivot | indexBudgets, buildBudgetPivot, ecartCell |
| public/lib/campagneBudgetQuinzaine.js | CampagneBudgetQuinzaine | quinzaineKey, quinzaineNum, optionsFromPeriodes, quinzaineCourante, quinzainePrecedente, quinzainesByLabel, trancheQuinzaine, realiseQuinzaine, decoreQuinzaine, pctPartsCellule, resteQuinzaineCellule, noteQuinzaine |
| public/lib/campagneExportUtils.js | CampagneExportUtils | SHEET_MAX, ROW_KIND, PERCENT_HEADER, BUDGET_HEADER, scopeNote, perHa, buildParcelleBudgetIndex, haLabel, numFmtFor, percentFmtFor, percentColumns, sumBudget, budgetScope, budgetCells, safeSheetName, buildSyntheseRows, buildSyntheseAoA, syntheseSheetCols, buildParcelleSheetRows, buildParcelleSheetAoA, parcelleSheetCols |
| public/lib/campagneProduction.js | CampagneProduction | BAREME_KG_PAR_JH, BAREME_DH_PAR_KG, kgParParcelle, vitesseRecolte, effortRecolte |
| public/lib/campagneRapprochement.js | CampagneRapprochement | chargeParQuinzaine, rapprocher |
| public/lib/campagneRythme.js | CampagneRythme | CLASSES, JOURS_CAMPAGNE, QUINZAINES_PAR_MOIS, FENETRE_PAR_DEFAUT, MIN_QUINZAINES_CONSOMMEES, quinzaineNum, totalQuinzaines, quinzainesInfo, indexClasses, classeOf, classeFamille, resteBudgetCellule, moyenneMobile, resteRythmeCellule, decoreRestes, noteRestes, partEcoulee, joursEcoules |
| public/lib/campagneUtils.js | CampagneUtils | campagneOf, campagneCourante, debutCampagne, finCampagne, campagneDeCharge, phaseDeCharge, mostRecentCampagne |
| public/lib/coutMainOeuvre.js | CoutMainOeuvre | CATEGORIES, coutFeries, nbJoursDistincts, masseSalarialeNette, netAPayer, categorieMO, primeFonctionADate, joursParOuvrier, paieOuvrier, netParCategorie, chargesSociales, coutEmployeur, totalQuinzaine |
| public/lib/cultureUtils.js | CultureUtils | CULTURES, normCulture, resolveCulture, matchesCulture |
| public/lib/emargementExcel.js | EmargementExcel | genSansCnssXlsx, genAvecCnssXlsx, genTransporteursXlsx, genBulletinsXlsx |
| public/lib/emargementPdf.js | EmargementPdf | genSansCnss, genAvecCnss, genTransporteurs, genBulletins, genBulletinsAr |
| public/lib/encaissementsCanevas.js | EncaissementsCanevas | ENCAISSEMENTS_SCHEMA, round2, slugifyClient, normalizeReference, parseFrNumber, parseDate, parseEncaissements, buildModeleAoA, buildModeleWorkbook |
| public/lib/factureExportUtils.js | FactureExportUtils | STANDARD_TVA_RATES, TVA_SNAP_EPS, CAMPAIGN_START_MONTH, TAXABLE_TVA_RATE, TAXABLE_PRODUCT_PATTERNS, ANOMALIE_TVA_B, INFO_TVA_NON_SAISIE, fxRound2, parseFactureDate, campaignBounds, isWithinPeriod, campaignYearOf, listAvailableCampaigns, reconciliationEpsilon, normalizeDesignation, matchProduitTaxable, deriveTauxLigne, parseSaisiTaux, resolveTauxLigne, deriveTauxTva, buildFactureLines, RECAP_COL, RECAP_NB_COLS, buildRecapStatutRows |
| public/lib/growthUtils.js | GrowthUtils | rows, error, FRAMBOISE_CULTURE, ALL_VARIETES, MAX_LENGTH_CM, framboiseParcelles, varietesFramboise, buildGrowthSeries, validateMeasurement, normalizeCheckpoints |
| public/lib/inflightDedup.js | InflightDedup | — voir fichier — |
| public/lib/inventaireUtils.js | InventaireUtils | computeInventaireTotals, formatQteParUnite, boundedLedger |
| public/lib/local-test-bypass.js | location | success, caisses, pendingCount, weekAlimentations, weekDepenses, recentTx |
| public/lib/meteoCalc.js | MeteoCalc | saturationVaporPressure, vpdAt, computeHourlyVPD, computeCumRadiation, peakIndex |
| public/lib/paieDataCache.js | PaieDataCache | DEFAULT_TTL_MS, pointageKey, peek, set, getOrLoad, invalidate |
| public/lib/paieUtils.js | PaieUtils | PAIE_BAREMES_DEFAULT, trouverPalierAnciennete, calculerPaieOuvrier, resolveSmagForDate, computeWorkerPaie, computePayslip |
| public/lib/parcelleGroupUtils.js | ParcelleGroupUtils | QTY_DECIMALS, round3, totalHa, computeParts, splitQuantite, formatApercu |
| public/lib/primesImportParse.js | PrimesImportParse | rows, headerIndex, normHeader, MATRICULE_ALIASES, PRIME_ALIASES, findHeaderRow, extractPrimesRows |
| public/lib/primesV2.js | PrimesV2 | norm, matches, searchWorkers, buildHistoryView |
| public/lib/quinzaineUtils.js | QuinzaineUtils | getEqPrefix, computeTransportQuinzaine |
| public/lib/recolteKpiUtils.js | RecolteKpiUtils | aggregatePeriodKpis, computeNetDhParKg, computeNetDhParKgProd, distinctOuvriersFromRows |
| public/lib/scanAttachmentUtils.js | ScanAttachmentUtils | ENTITY_MAP, ALLOWED_EXTENSIONS, isValidEntityType, collectionForEntity, folderForEntity, extOf, mimeFromFilename, sanitizeFilename, buildScanPath, isScanPathForEntity, validateUploadAttachmentParams |
| public/lib/scanClientUpload.js | ScanClientUpload | isStorageAvailable, uploadDirect, recordAttachment, uploadAndRecord, getAttachmentUrl |
| public/lib/scanHistoryDisplay.js | ScanHistoryDisplay | scanFournisseurLabel, scanTtc, scanBdcMatche |
| public/lib/stockDestinations.js | StockDestinations | resolveDestinationOptions, resolveReceptionDestination, resolveBdcDestination, SD_HORS_CONFIG_SUFFIX, SD_NOTE_HORS_CONFIG, SD_FERMES_STOCK_NON_MUTUALISE |
| public/lib/stockMovementGuard.js | StockMovementGuard | IMPORT_CREATED_BY, VALIDATED_STATUS, isImportedMovement, isValidatedMovement, isDeletedMovement, isCreator, evaluateMutable, canEditMovement, canDeleteMovement, ADMIN_DELETE_ROLES, isAdminDeleter, evaluateAdminDelete, canAdminDeleteMovement, refusalMessage |
| public/lib/useStockLocations.js | useStockLocations | magasins, stations, parcelles, loading |
