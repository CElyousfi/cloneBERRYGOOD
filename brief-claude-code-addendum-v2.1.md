# Addendum Brief Claude Code — Smart Berry Phenology v2.1

> **Document complémentaire** au brief consolidé v2 (`smart-berry-phenology-v2.md`).
> Intègre les évolutions shelter type Canarienne/Tunnel, mapping FarmRoad station, RADSUM, DLI.
> À lire **conjointement** avec le brief v2 et les 3 documents de référence agronomique.

## Objet de cet addendum

Lors de la review du brief v2, l'utilisateur a identifié que :
1. Le calcul GDD doit s'appuyer sur la **bonne sonde FarmRoad** selon le **type d'abri** (Canarienne vs Tunnel) — sinon erreur de 10-20 % sur le GDD
2. Le moteur doit aussi calculer **RADSUM** (cumul radiation MJ/m²) et **DLI** (Daily Light Integral mol/m²) pour piloter le potentiel productif (calibre, Brix, fleurs)

Cet addendum décrit les modifications à apporter au design avant lancement de l'implémentation.

## Contexte BGF (validations utilisateur)

- **Scope V1** : toutes les parcelles BGF (Larache + Sidi Yahia + Kénitra)
- **Architecture FarmRoad V1** : 2 stations centrales (1 canarienne, 1 tunnel), pas de multi-stations
- **RADSUM ET DLI dès V1** : on calcule les deux (data riche)
- **Variétés cibles V1** : Maravilla et Jasmin (primocane et floricane)

---

## 1. Modifications du schéma Firestore

### 1.1 Document `farms/{farmId}/plots/{plotId}` étendu

Ajouter deux blocs `shelter` et `sensors`, et étendre le bloc `phenology` :

```typescript
interface PlotDocument {
  // ... champs existants Smart Berry (name, area_ha, location, crop, ...)
  
  // NOUVEAU : type d'abri
  shelter: {
    type: "canarienne" | "tunnel" | "multispan" | "open_field";
    structure: {
      orientation: "N-S" | "E-W" | "NE-SW" | "NW-SE";
      ventilationType: "passive" | "active" | "hybrid";
      coverMaterial: "polyethylene" | "polycarbonate" | "glass" | "shade_net";
      coverTransmissionPct: number;  // 0-100
      heightM: number;
      installDate: Timestamp;
    };
  };
  
  // NOUVEAU : capteurs assignés
  sensors: {
    farmroad: {
      stationId: string;          // référence vers farmroad_stations
      stationType: "canarienne" | "tunnel";
      lastSync: Timestamp | null;
    };
    aladinn?: {
      sensorIds: string[];
      lastSync: Timestamp | null;
    };
  };
  
  // ÉTENDU : phenology avec sources et RADSUM/DLI
  phenology: {
    enabled: boolean;
    variety: "maravilla" | "jasmin";
    cycleType: "primocane" | "floricane";
    plantingDate: Timestamp;
    budbreakDate?: Timestamp;     // pour floricane
    
    // Sources hiérarchisées (NOUVEAU)
    temperatureSource: {
      primary: "farmroad" | "aladinn" | "meteoblue";
      stationId: string;
      fallback: "meteoblue";
    };
    radiationSource: {
      primary: "farmroad" | "meteoblue";
      stationId: string;
      sensor: "radiation" | "par" | "both";
      fallback: "meteoblue";
    };
    
    // Paramètres GDD (existant)
    tBase: number;  // 5
    tCap: number;   // 30
    
    // Paramètres RADSUM/DLI (NOUVEAU)
    radsumEnabled: boolean;
    dliEnabled: boolean;
    parToRadiationRatio: number;  // 0.46 par défaut
    
    // États courants (étendu)
    currentStage: string;
    gddCumul: number;
    gddDayLast: number;
    radsumCumul: number;          // NOUVEAU MJ/m²
    radsumDayLast: number;         // NOUVEAU
    dliCumul: number;              // NOUVEAU mol/m²
    dliDayLast: number;            // NOUVEAU
    daysInStage: number;
    lastCalculation: Timestamp | null;
    
    // Coefficients (existant)
    precocityCoefficient: number;
    customStageThresholds: object | null;
    contextModifiers: {
      hydricStressEnabled: boolean;
      photoperiodEnabled: boolean;
      heatStressEnabled: boolean;
      dliDeficitEnabled: boolean;  // NOUVEAU
    };
  };
}
```

### 1.2 Nouvelle collection `farms/{farmId}/farmroad_stations`

```typescript
interface FarmroadStationDocument {
  stationId: string;
  displayName: string;
  type: "canarienne" | "tunnel" | "multispan" | "open_field";
  location: {
    latitude: number;
    longitude: number;
    description: string;
  };
  apiEndpoint: string;
  apiAuth: {
    method: "bearer_token" | "api_key" | "basic";
    secretRef: string;  // référence Firebase Secret
  };
  capabilities: Array<
    "temperature" | "humidity" | "co2" | "par" | "radiation" |
    "vpd" | "dewpoint" | "pressure" | "substrate_vwc"
  >;
  samplingIntervalMinutes: number;
  isDefaultForType: boolean;     // station par défaut pour ce shelter type
  associatedPlots: string[];      // dénormalisation pour requêtes inversées
  status: "active" | "maintenance" | "offline";
  lastDataReceived: Timestamp | null;
  installDate: Timestamp;
  metadata: {
    version: string;
    notes: string;
  };
}
```

### 1.3 Sous-collection `phenology_daily` (renommage de `gdd_daily`)

Renommer pour refléter le scope élargi (GDD + RADSUM + DLI) :

```typescript
// farms/{farmId}/plots/{plotId}/phenology_daily/{YYYY-MM-DD}
interface PhenologyDailyDocument {
  date: Timestamp;
  
  // Sources utilisées (traçabilité)
  dataSources: {
    temperature: {
      source: "farmroad" | "aladinn" | "meteoblue";
      stationId: string;
      quality: "good" | "partial" | "interpolated" | "fallback";
    };
    radiation: {
      source: "farmroad" | "meteoblue";
      stationId: string;
      sensor: "radiation" | "par" | "both";
      quality: "good" | "partial" | "interpolated" | "fallback";
    };
  };
  
  // Données brutes
  tMin: number;
  tMax: number;
  tMaxCapped: number;
  radiationMaxWm2: number | null;
  parMaxUmolM2s: number | null;
  
  // Calculs jour
  gddDay: number;
  radsumDayMjM2: number;
  dliDayMolM2: number;
  
  // Cumuls
  gddCumul: number;
  radsumCumulMjM2: number;
  dliCumulMolM2: number;
  
  // Stage et recettes
  stage: string;
  daysInStage: number;
  irrigationRecipe: object;
  
  // Évaluation DLI vs cible stade (NOUVEAU)
  dliVsTarget: {
    stageMin: number;
    stageMax: number;
    status: "below_critical" | "below_target" | "in_target" | "above_target" | "above_critical";
  };
  
  computedAt: Timestamp;
}
```

---

## 2. Nouveaux modules backend

### 2.1 Module `phenology/core/radsumCalculator.ts`

Pure function, testable sans Firebase :

```typescript
interface RadiationSample {
  timestamp: Date;
  radiationWm2?: number;
  parUmolM2s?: number;
}

interface RadsumDailyResult {
  radsumMjM2: number;
  dliMolM2: number;
  dataQuality: "good" | "partial" | "interpolated";
  samplesUsed: number;
  samplesExpected: number;
}

function calculateDailyRadsum(samples: RadiationSample[]): RadsumDailyResult;
function estimateMissingRadiation(samples: RadiationSample[], parToRadRatio?: number): RadiationSample[];
function evaluateDliVsTarget(dliDay: number, stageDliConfig: DliConfig): DliStatus;
```

**Tests à couvrir :**
- Journée ensoleillée complète (288 samples) → DLI ~25-30 mol/m²/j
- Journée nuageuse (288 samples mais radiation faible) → DLI ~10-15
- Journée avec gaps (200 samples) → quality "partial"
- Journée avec très peu de samples (50) → quality "interpolated"
- Journée avec PAR seul (radiation null) → estimation Radiation via ratio
- Journée avec Radiation seul (PAR null) → estimation PAR
- Bordures : tableau vide, samples non triés, timestamps invalides
- Valeurs négatives ou aberrantes (capteur défaillant) → filtrage

### 2.2 Module `phenology/data/farmroadStationResolver.ts`

```typescript
/**
 * Détermine la station FarmRoad à utiliser pour une parcelle donnée
 * en respectant la hiérarchie : assignation explicite → station par défaut du shelter type
 */
async function resolveStationForPlot(
  farmId: string,
  plotId: string
): Promise<FarmroadStationDocument | null>;

/**
 * Liste toutes les parcelles desservies par une station
 */
async function getPlotsForStation(
  farmId: string,
  stationId: string
): Promise<string[]>;

/**
 * Met à jour les associations parcelle ↔ station (admin)
 */
async function updatePlotStationMapping(
  farmId: string,
  plotId: string,
  stationId: string
): Promise<void>;
```

### 2.3 Module `phenology/data/radiationFetcher.ts`

```typescript
interface RadiationFetchResult {
  samples: RadiationSample[];
  source: "farmroad" | "meteoblue";
  stationId: string;
  quality: "good" | "partial" | "interpolated" | "fallback";
}

async function fetchDailyRadiation(
  stationId: string,
  date: Date,
  fallbackLocation?: { latitude: number; longitude: number }
): Promise<RadiationFetchResult>;
```

Logique :
1. Tenter fetch depuis API FarmRoad pour la station
2. Si réponse OK avec ≥ 240 samples → quality "good"
3. Si 120-240 samples → quality "partial"
4. Si < 120 samples ou erreur API → fallback Meteoblue
5. Si fallback Meteoblue : appliquer `coverTransmissionPct` du shelter de la parcelle

### 2.4 Module `phenology/core/radiationAdvisor.ts`

```typescript
/**
 * Génère des conseils basés sur DLI vs cibles stade
 */
function analyzeDliTrend(
  recentDailyDli: PhenologyDailyDocument[],
  currentStageDliConfig: DliConfig
): RadiationAdvice[];

interface RadiationAdvice {
  severity: "info" | "yellow" | "red";
  type: "deficit" | "excess" | "trend";
  message: string;
  recommendedActions: string[];
}
```

Règles métier :
- Si DLI quotidien > critical_max sur 5 jours consécutifs en S6-S7 → "Risque sunburn fruits, déployer filets ombrage 30 %"
- Si DLI quotidien < critical_min sur 7 jours consécutifs → "Vérifier propreté toile, ombrages parasites, orientation"
- Si DLI cumul / cible cumul théorique < 0,7 en fin S4 → "Bilan radiatif insuffisant, performance probable -10/-20 %"

### 2.5 Module `phenology/jobs/dailyPhenologyJob.ts` (renommé de `dailyGddJob`)

Mise à jour pour intégrer GDD + RADSUM + DLI :

```typescript
async function processPlotDaily(farmId: string, plotId: string, date: Date): Promise<void> {
  const plot = await getPlot(farmId, plotId);
  if (!plot.phenology?.enabled) return;
  
  // 1. Résoudre stations selon shelter type
  const station = await resolveStationForPlot(farmId, plotId);
  if (!station) {
    logger.warn("No station resolved for plot", { plotId });
    // → fallback Meteoblue exclusif
  }
  
  // 2. Fetch températures (24h)
  const tempData = await fetchDailyTemperature(
    plot.phenology.temperatureSource.stationId,
    date,
    plot.location  // pour fallback Meteoblue
  );
  
  // 3. Fetch radiation (24h) — NOUVEAU
  const radData = await fetchDailyRadiation(
    plot.phenology.radiationSource.stationId,
    date,
    plot.location
  );
  
  // 4. Calculs purs
  const gddResult = calculateDailyGdd(
    tempData.tMin, tempData.tMax,
    plot.phenology.tBase, plot.phenology.tCap
  );
  
  const radSamples = estimateMissingRadiation(
    radData.samples,
    plot.phenology.parToRadiationRatio
  );
  const radsumResult = calculateDailyRadsum(radSamples);
  
  // 5. Cumuls
  const newGddCumul = plot.phenology.gddCumul + gddResult.gddDay;
  const newRadsumCumul = plot.phenology.radsumCumul + radsumResult.radsumMjM2;
  const newDliCumul = plot.phenology.dliCumul + radsumResult.dliMolM2;
  
  // 6. Stage
  const reference = await loadPhenologyReference(plot.phenology.variety, plot.phenology.cycleType);
  const stage = resolveStage(newGddCumul, reference.stages, plot.phenology.precocityCoefficient);
  
  // 7. Évaluation DLI vs cible — NOUVEAU
  const dliStatus = evaluateDliVsTarget(radsumResult.dliMolM2, stage.dli);
  
  // 8. Recette irrigation
  const recipe = getIrrigationRecipe(stage, plot.phenology.variety, plot.phenology.cycleType);
  
  // 9. Écriture phenology_daily
  await writePhenologyDaily(farmId, plotId, date, {
    dataSources: { temperature: tempData.metadata, radiation: radData.metadata },
    tMin: tempData.tMin, tMax: tempData.tMax, tMaxCapped: gddResult.tMaxCapped,
    radiationMaxWm2: Math.max(...radSamples.map(s => s.radiationWm2 ?? 0)),
    parMaxUmolM2s: Math.max(...radSamples.map(s => s.parUmolM2s ?? 0)),
    gddDay: gddResult.gddDay,
    radsumDayMjM2: radsumResult.radsumMjM2,
    dliDayMolM2: radsumResult.dliMolM2,
    gddCumul: newGddCumul,
    radsumCumulMjM2: newRadsumCumul,
    dliCumulMolM2: newDliCumul,
    stage: stage.code,
    daysInStage: ...,
    irrigationRecipe: recipe,
    dliVsTarget: dliStatus,
    computedAt: new Date()
  });
  
  // 10. Update plot phenology
  await updatePlotPhenology(farmId, plotId, {
    currentStage: stage.code,
    gddCumul: newGddCumul, gddDayLast: gddResult.gddDay,
    radsumCumul: newRadsumCumul, radsumDayLast: radsumResult.radsumMjM2,
    dliCumul: newDliCumul, dliDayLast: radsumResult.dliMolM2,
    lastCalculation: new Date()
  });
  
  // 11. Conseils radiation (V2 mais hooks prêts)
  if (plot.phenology.dliEnabled) {
    const recentDaily = await getRecentPhenologyDaily(farmId, plotId, 7);
    const advices = analyzeDliTrend(recentDaily, stage.dli);
    if (advices.length > 0) {
      await createRadiationAdvices(farmId, plotId, advices);
    }
  }
}
```

---

## 3. Nouveaux composants frontend

```
/src/modules/phenology/
  ├── pages/
  │   └── FarmroadStationsAdminPage.tsx     # NOUVEAU : admin stations
  ├── components/
  │   ├── ShelterTypeSelector.tsx            # NOUVEAU : sélection canarienne/tunnel
  │   ├── FarmroadStationManager.tsx         # NOUVEAU : éditeur stations
  │   ├── PlotStationAssignmentCard.tsx      # NOUVEAU : voir/changer station d'une parcelle
  │   ├── RadsumChart.tsx                    # NOUVEAU : courbe RADSUM cumul
  │   ├── DliChart.tsx                       # NOUVEAU : courbe DLI quotidien + cibles stade
  │   ├── DliCumulVsTargetGauge.tsx         # NOUVEAU : jauge bilan radiatif
  │   └── ShelterComparisonChart.tsx        # NOUVEAU (V2) : comparaison perf canarienne vs tunnel
```

### 3.1 Page admin stations FarmRoad

Liste les stations, leur statut, capacités, parcelles desservies. Permet d'éditer manuellement le mapping si besoin.

### 3.2 Composant DliChart

Affiche le DLI quotidien sur 30/60/90 jours, avec :
- Bande verte = cible stade actuel (target_min à target_max)
- Bande rouge = zones critiques (< critical_min ou > critical_max)
- Tooltip hover : valeur exacte, source données, qualité
- Marker stages successifs

### 3.3 Composant DliCumulVsTargetGauge

Jauge "carburant" pour montrer où on en est sur le bilan radiatif :
- 0 → 100 % de la cible cumul théorique du stade actuel
- Couleur : rouge < 70 %, jaune 70-90 %, vert 90-110 %, jaune > 110 %, rouge > 130 %

---

## 4. Tables de référence à seeder (mises à jour)

### 4.1 phenology_references (4 docs — étendus)

Chaque doc doit maintenant inclure pour **chaque stade** la sous-clé `dli` :

```json
{
  "code": "S4",
  "gddMin": 1100, "gddMax": 1400,
  "irrigation": { ... },
  "dli": {
    "target_min": 20,
    "target_max": 28,
    "critical_min": 15,
    "critical_max": 35,
    "unit": "mol/m²/j"
  },
  "notes": "..."
}
```

→ Cf. `docs/phenology-tables.md` v1.1.0 pour valeurs complètes.

### 4.2 phenology_kpi_definitions (17 docs + 1 — étendus)

Le doc `all_stages` doit inclure les nouveaux KPIs auto-calculés :
- `radiation_daily_mj`
- `dli_daily`
- `radsum_cumul`
- `dli_cumul`

Chaque doc stade `S0..S8`, `F0..F7` doit inclure le KPI mandatory `dli_daily_sX` (ou `dli_daily_fX`) avec les seuils cible/critique du stade.

→ Cf. `docs/kpi-tables.md` v1.1.0 pour valeurs complètes.

### 4.3 NOUVEAU : seed `farmroad_stations` pour BGF

```typescript
// /scripts/seedFarmroadStations.ts

const BGF_STATIONS = [
  {
    stationId: "farmroad_canarienne_main",
    displayName: "Canarienne — Station principale BGF",
    type: "canarienne",
    location: { latitude: 35.1825, longitude: -6.1542, description: "Centre canarienne BGF Sidi Yahia" },
    apiEndpoint: "https://api.farmroad.com/stations/cana_main/data",
    apiAuth: { method: "bearer_token", secretRef: "FARMROAD_API_KEY" },
    capabilities: ["temperature", "humidity", "co2", "par", "radiation", "vpd", "dewpoint", "pressure", "substrate_vwc"],
    samplingIntervalMinutes: 5,
    isDefaultForType: true,
    associatedPlots: [],
    status: "active",
    installDate: new Date("2025-01-15")
  },
  {
    stationId: "farmroad_tunnel_main",
    displayName: "Tunnel — Station principale BGF",
    type: "tunnel",
    location: { latitude: 35.1830, longitude: -6.1535, description: "Centre tunnels BGF Sidi Yahia" },
    apiEndpoint: "https://api.farmroad.com/stations/tunnel_main/data",
    apiAuth: { method: "bearer_token", secretRef: "FARMROAD_API_KEY" },
    capabilities: ["temperature", "humidity", "co2", "par", "radiation", "vpd", "dewpoint", "pressure", "substrate_vwc"],
    samplingIntervalMinutes: 5,
    isDefaultForType: true,
    associatedPlots: [],
    status: "active",
    installDate: new Date("2025-01-15")
  }
];
```

---

## 5. Phasage révisé

Mise à jour du phasage du brief v2 pour intégrer les nouveaux modules.

### Bloc A — Foundation (5 sem au lieu de 4)

- **S1** : Phenology core
  - `gddCalculator.ts` + tests
  - `radsumCalculator.ts` + tests (NOUVEAU)
  - `stageResolver.ts` + tests
  - `irrigationRecipe.ts` + tests
  - `radiationAdvisor.ts` + tests (NOUVEAU)
- **S2** : KPI core + données
  - `kpiAnalyzer.ts` + définitions étendues (avec DLI mandatory par stade)
  - Seed `phenology_kpi_definitions` avec KPIs RADSUM/DLI
- **S3** : Phyto core (inchangé)
- **S4** : Data layer + seeds
  - `temperatureFetcher.ts`
  - `radiationFetcher.ts` (NOUVEAU)
  - `farmroadStationResolver.ts` (NOUVEAU)
  - `referenceLoader.ts`
  - Seed `phenology_references` avec DLI configs
  - Seed `farmroad_stations` BGF (NOUVEAU)
- **S5** (NOUVEAU) : Cloud Functions backend jobs
  - `dailyPhenologyJob.ts` (renommé de dailyGddJob, intègre RADSUM/DLI)
  - `driftCheckJob.ts`
  - Tests intégration émulateur Firebase

### Bloc B — Frontend web (4 sem)

- **S6** : Pages phenology dashboard + plot detail
  - Inclure GddChart + RadsumChart + DliChart côte à côte
- **S7** : KPI dashboard + saisies
- **S8** : Phyto map (inchangé)
- **S9** : Pages admin
  - References, KPI defs, taxonomy
  - **FarmroadStationsAdminPage** (NOUVEAU)
  - **ShelterTypeSelector** dans création/édition parcelle (NOUVEAU)

### Bloc C — WhatsApp (4 sem, inchangé sauf addition KPIs DLI dans Mode 1)

### Bloc D — Polish & V2 (3 sem)

Total : **15 sprints d'1 semaine** (inchangé), juste réorganisation interne du Bloc A.

---

## 6. Critères d'acceptance complémentaires Phase A

À ajouter aux critères du brief v2 :

- ✅ `radsumCalculator` testé sur ≥ 8 cas dont edge cases (gaps, données manquantes, valeurs aberrantes)
- ✅ `farmroadStationResolver` retourne la bonne station pour parcelle canarienne vs tunnel
- ✅ Seed `farmroad_stations` créé pour les 2 stations BGF
- ✅ Schéma Plot accepte les nouveaux blocs `shelter` et `sensors` (validation Zod/Yup)
- ✅ Migration documentée pour parcelles existantes (assignation `shelter.type` par admin avant activation phenology)
- ✅ Documentation `/docs/phenology-engine.md` mise à jour avec sections RADSUM/DLI/FarmRoad

---

## 7. Questions à poser à l'admin avant déploiement données

Avant d'activer le module sur une parcelle, l'admin Smart Berry doit renseigner :

1. **Type d'abri** (canarienne / tunnel)
2. **Caractéristiques structure** (orientation, hauteur, matériau couverture)
3. **% transmission lumière** de la couverture (info documentaire ou estimation : polyéthylène neuf ~70%, vieillissant ~50-60%)
4. **Variété** (Maravilla / Jasmin)
5. **Type de cycle** (primocane / floricane)
6. **Date de plantation** (ou débourrement pour floricane)
7. **Station FarmRoad assignée** : auto-détectée selon shelter type, modifiable
8. **Sondes ALADINN assignées** (substrat, drainage)
9. **Activation des modules** : GDD ✅, RADSUM ✅, DLI ✅, contextModifiers (off par défaut V1)

→ Workflow d'activation par parcelle à implémenter : **wizard 9 étapes** dans le frontend.

---

## 8. Migration des parcelles existantes

Si Smart Berry a déjà des parcelles en base :

1. Script de migration pour ajouter champs `shelter` et `sensors` avec valeurs par défaut (`shelter.type = "tunnel"`, `sensors.farmroad.stationId = null`)
2. Marquer toutes les parcelles existantes avec `phenology.enabled = false`
3. Workflow admin : passer parcelle par parcelle, compléter via wizard, activer

---

## 9. Tests d'acceptance utilisateur (UAT) Phase A

Critères pour validation par Omar avant passage Phase B :

| Test | Attendu |
|---|---|
| Créer parcelle "TEST-CANA-01" type canarienne, variété Maravilla, plantation 1er mars | Affectation auto à `farmroad_canarienne_main`, GDD démarre à 0 |
| Lancer job manuellement avec données simulées (T_min=12, T_max=28) | GDD_jour = 15, RADSUM/DLI calculés depuis samples FarmRoad |
| Créer parcelle "TEST-TUN-01" type tunnel | Affectation auto à `farmroad_tunnel_main`, GDD différent même date |
| Désactiver station tunnel | Job log warning + fallback Meteoblue |
| Saisir variété Jasmin | Coefficient 0.92 appliqué, seuils stages décalés |
| DLI 5 jours consécutifs > critical_max en S6 | Conseil radiation "déployer ombrage 30%" généré |

---

## Synthèse

Cet addendum v2.1 ajoute **3 dimensions structurelles** au module phenology :

1. **Distinction shelter type Canarienne/Tunnel** → précision GDD (+10-20 %)
2. **Mapping plot ↔ FarmRoad station** → architecture data centralisée et évolutive
3. **RADSUM + DLI calculés en parallèle du GDD** → pilotage potentiel productif (calibre, Brix, alertes sunburn)

Le coût additionnel est **modéré** : ~1 sprint supplémentaire en Phase A (5 au lieu de 4), pas de changement majeur sur les Blocs B/C/D. La valeur agronomique est **élevée** : c'est ce qui distingue un système basique GDD d'un vrai outil de pilotage agronomique data-driven.

---

## Changelog

- **v2.1.0** (2026-05-03) : Ajout shelter type, mapping FarmRoad station, RADSUM, DLI. Phasage Bloc A étendu à 5 sprints.
