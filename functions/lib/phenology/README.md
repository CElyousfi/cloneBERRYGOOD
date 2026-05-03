# `lib/phenology/` — Smart Berry Phenology Engine (Sprint 1)

Pure-function backend module for blueberry/raspberry phenology computation:
GDD, RADSUM, DLI, stage resolution, irrigation recipes.

**Sprint 1 scope** : modules purs + tests + seeds Firestore initiaux.
Le câblage runtime (Cloud Function nightly job, frontend) est Sprint 2+.

---

## Sources de vérité métier

| Doc | Rôle |
|---|---|
| [`phenology-tables.md`](../../../phenology-tables.md) | T_base/T_cap, stages, recettes irrigation, cibles DLI par variété × cycle |
| [`kpi-tables.md`](../../../kpi-tables.md) | KPIs par stade (Sprint 2+) |
| [`phyto-taxonomy.md`](../../../phyto-taxonomy.md) | Taxonomie phytosanitaire (Sprint 3-4) |
| [`brief-claude-code-addendum-v2.1.md`](../../../brief-claude-code-addendum-v2.1.md) | Schéma Firestore, RADSUM/DLI, FarmRoad station mapping |

---

## API publique

Tous les modules sont **purs** (aucun I/O Firebase, aucune dépendance d'env). Importer via le barrel :

```js
const phenology = require('./functions/lib/phenology');
```

### `calculateDailyGdd({ tMin, tMax, tBase, tCap }) → GddDailyResult`

Growing Degree Days du jour selon la formule officielle Driscoll's :

```
T_max_capped = min(T_max, T_cap)        // T_min n'est PAS capé (cf. phenology-tables.md §1)
GDD_jour     = max(0, ((T_max_capped + T_min) / 2) - T_base)
```

**Bug legacy corrigé** : la version `functions/index.js:2023-2027` cape aussi `tMin`. Le test `gddCalculator.test.js #5` prouve la divergence sur `tMin > tCap` (extreme heat) ; le test `#5b` prouve la convergence sur tous les cas standard.

### `calculateDailyRadsum(samples) → RadsumDailyResult`

Intégration trapézoïdale 24h des samples FarmRoad → RADSUM (MJ/m²) + DLI (mol/m²) + quality scoring.

- Pas standard FarmRoad : 5 min → **288 samples/jour attendus**
- Quality : `good ≥ 240`, `partial 120-239`, `interpolated < 120`
- Stratégie de gap V1 : intervalle entre 2 samples > 30 min → skipped (ne contribue pas à l'intégrale)
- Sanitization : drop timestamp invalide, drop si rad+par null, drop valeurs négatives, **clamp** valeurs aberrantes (> 1500 W/m² ou > 3000 µmol/m²/s)

### `estimateMissingRadiation(samples, parToRadRatio = 0.46) → RadiationSample[]`

Cross-fill PAR ↔ Radiation au niveau **sample** (avant intégration), pour préserver la résolution temporelle :

```
PAR_µmol → W_PAR (÷ 4.57) → W_total (÷ ratio)
W_total → W_PAR (× ratio) → PAR_µmol (× 4.57)
```

Si les 2 mesures sont déjà présentes, ne touche pas (priorité à la mesure réelle).

### `evaluateDliVsTarget(dliDay, dliConfig) → DliStatus`

Évaluation 4-niveaux du DLI quotidien vs cibles du stade :

```
below_critical < critical_min ≤ below_target < target_min ≤ in_target ≤ target_max < above_target ≤ critical_max < above_critical
```

### `resolveStage(gddCumul, reference, options?) → PhenologyStage`

Résout le stade phénologique courant à partir du GDD cumulé.

- `options.precocityCoefficient` : override le coef de la référence (Maravilla 1.00, Jasmin 0.92).
- `options.customStageThresholds` : `{ S1: 145, S2: 380, ... }` — overrides absolus (NON multipliés par le coef), pour calibration parcelle.
- Cas limite : `gddCumul ≥` seuil du dernier stade → renvoie le dernier stade (end-of-cycle).

### `getIrrigationRecipe(stageCode, reference) → IrrigationRecipe`

Lookup pur de la recette EC/pH/% drainage prescrite pour un stade donné.
Renvoie un objet **`Object.freeze`d** (immutabilité garantie).

> **TODO Sprint 4-5** — Articulation avec `lib/irrigation/` :
> En V1, ce module est strictement **découplé** de `lib/irrigation/`.
> Aucun appel croisé. Sémantique :
>   - `lib/phenology/irrigationRecipe` = prescriptif par stade (cible théorique)
>   - `lib/irrigation/`               = réactif sur saisies réelles (diagnostic)
> Architecture cible : `lib/irrigation/` pourra consommer en lecture la recette
> du stade actuel pour ses comparaisons "réel saisi vs prescriptif".

---

## Quick Start (console Node)

Exemple end-to-end : T° d'une journée → GDD → stage courant → recette irrigation.

```js
const phenology = require('./functions/lib/phenology');

// 1. Calcul GDD du jour
const day = phenology.calculateDailyGdd({
  tMin: 12, tMax: 28, tBase: 5, tCap: 30,
});
console.log('GDD jour :', day.gddDay);              // 15

// 2. Charger la référence Maravilla floricane (en pratique : depuis Firestore)
const reference = require('./functions/lib/phenology/__tests__/fixtures').MARAVILLA_FLORICANE;

// 3. Imaginer 50 jours d'accumulation à 15 GDD/jour → cumul 750
const gddCumul = day.gddDay * 50;

// 4. Stage courant
const stage = phenology.resolveStage(gddCumul, reference);
console.log('Stage :', stage.code, stage.name);     // F3 Floraison
console.log('Critical :', stage.criticalStage);     // true

// 5. Recette irrigation prescrite pour ce stade
const recipe = phenology.getIrrigationRecipe(stage.code, reference);
console.log('EC :', recipe.ec_min, '-', recipe.ec_max);   // 2.0 - 2.2
console.log('pH :', recipe.ph_min, '-', recipe.ph_max);   // 5.5 - 5.7
console.log('Drainage cible :', recipe.drainage_pct_target, '%');  // 30
```

Pipeline RADSUM/DLI sur des samples FarmRoad bruts :

```js
const enriched = phenology.estimateMissingRadiation(rawSamples, 0.46);
const result   = phenology.calculateDailyRadsum(enriched);
const status   = phenology.evaluateDliVsTarget(result.dliMolM2, stage.dli);

console.log('DLI :', result.dliMolM2, 'mol/m²/j');
console.log('Status :', status.status);  // in_target | below_target | …
```

---

## Conventions de code

- **JavaScript pur + JSDoc** strict. Aucun TypeScript (`@typedef`, `@param`, `@returns` obligatoires sur API publique).
- **CommonJS** (`require` / `module.exports`), Node 20.
- **Pure functions** : pas d'I/O, pas de side-effect, pas de globals. L'I/O Firebase vit dans `scripts/seed*.js` (Sprint 1) et `lib/phenology/jobs/*` (Sprint 2+).
- **Validation stricte des inputs** : `TypeError` sur params manquants/non-finis, `RangeError` sur valeurs hors-domaine.
- **Tests** : [`node:test`](https://nodejs.org/api/test.html) natif (pas Jest/Vitest), un fichier `__tests__/<module>.test.js` par module pur.
- **Fixtures partagées** dans `__tests__/fixtures.js` (références phenology, générateurs de samples sinusoïdaux, samples custom).
- **Constantes nommées** plutôt que magic numbers (cf. `radsumCalculator.js` `__internals`).
- **Pattern strict** : copie de [`functions/lib/irrigation/`](../irrigation/).

### Lancer les tests

```bash
cd functions
npm run test:phenology
```

Sortie attendue : **59 tests verts**, ~50 ms.

---

## Comment ajouter…

### …une nouvelle variété

1. Documenter les valeurs (stades, GDD seuils, irrigation, DLI, coef précocité) dans `phenology-tables.md` §X (par analogie avec §5-8).
2. Ajouter un `FIXTURE` dans `scripts/seedPhenologyReferences.js` :
   ```js
   { id: 'newvariety_primocane', body: { varietyId: 'newvariety', cycleType: 'primocane', precocityCoefficient: <X>, stages: [...] , metadata: {...} } }
   ```
3. Si même paramètres irrigation/DLI que Driscoll's : réutiliser `MARAVILLA_PRIMOCANE_STAGES` + override `precocityCoefficient`.
4. Ajouter une fixture symétrique dans `__tests__/fixtures.js` pour les tests.
5. Lancer `node scripts/seedPhenologyReferences.js --dry-run` puis prod.

### …un nouveau stade

1. Modifier la référence concernée (`MARAVILLA_PRIMOCANE_STAGES` etc.) dans le seed script.
2. Ajouter un test dans `stageResolver.test.js` couvrant les transitions vers/depuis le nouveau stade.
3. Ajouter un test dans `irrigationRecipe.test.js` pour la recette du nouveau stade.
4. `--force` re-seed pour propager.

### …un modificateur contextuel (V2)

Sortir le calcul brut du resolver, l'envelopper d'une fonction `applyContextModifiers(stage, plot, recentDailies, modifierFlags)` qui ajuste le seuil GDD du stade suivant selon les règles de `phenology-tables.md` §9 (stress hydrique, photopériode, stress thermique, déficit DLI).

---

## Sprint 1 — Livrables

### Modules purs

| Fichier | Lignes | Fonctions |
|---|---|---|
| `types.js` | 155 | 9 typedefs JSDoc |
| `gddCalculator.js` | 53 | `calculateDailyGdd` |
| `radsumCalculator.js` | 285 | `calculateDailyRadsum`, `estimateMissingRadiation`, `evaluateDliVsTarget` |
| `stageResolver.js` | 87 | `resolveStage` |
| `irrigationRecipe.js` | 68 | `getIrrigationRecipe` |
| `index.js` (barrel) | 34 | re-export 6 fonctions |

### Tests

**59 tests verts** via `npm run test:phenology` :

| Module | Tests |
|---|---|
| gddCalculator | 12 (incl. bug double-cap proof + AJ2 non-régression vs legacy) |
| radsumCalculator | 20 (incl. trapèze validé main, gap skip, PAR↔Radiation cross-fill) |
| stageResolver | 15 (incl. coef précocité Jasmin, customStageThresholds) |
| irrigationRecipe | 9 (incl. cross-cycle parity, Driscoll varieties identical) |
| index (barrel) | 3 (AJ1 tripwire EXPECTED_FUNCTIONS + smoke E2E) |

### Seeds Firestore (3 collections, 7 docs)

| Script | Collection | Docs |
|---|---|---|
| [`scripts/seedPhenologyReferences.js`](../../../scripts/seedPhenologyReferences.js) | `phenology_references/*` | 4 (`maravilla_primocane`, `maravilla_floricane`, `jasmin_primocane`, `jasmin_floricane`) |
| [`scripts/seedFarmroadStations.js`](../../../scripts/seedFarmroadStations.js) | `farmroad_stations/*` | 2 (`farmroad_canarienne_main` deviceId 210506929, `farmroad_tunnel_main` deviceId 210506960) |
| [`scripts/seedPilotPlots.js`](../../../scripts/seedPilotPlots.js) | `plots/*` | 1 (`ML-T-LAR-01` Maravilla tunnel Larache, cycle 2 floricane Long Cane Double Crop) |

Tous les scripts ont la même CLI :
- `--dry-run` : valider + afficher would-create/update/skip, **aucune écriture**
- (default) : check-and-skip + 3 s safety pause + bannière warning prod
- `--force` : overwrite explicite avec log de l'overwrite

Diff validation post-écriture stricte (ignore uniquement `_meta.seededAt`).

---

## Hors scope Sprint 1 (à venir)

- **Sprint 2** :
  - `dailyPhenologyJob.js` — orchestration cron (remplace progressivement `gddNightlyJob` legacy)
  - `farmroadStationResolver.js` — lecture Firestore avec DI
  - `radiationFetcher.js` — wrap cache FarmRoad pour exposer samples bruts (vs slots 15 min) + fallback Meteoblue
  - `radiationAdvisor.js` — analyse tendances DLI (V2 hooks)
  - Migration parcelle pilote depuis `gdd_tracking` legacy (lecture amorce uniquement, sémantique anthèse vs plantation incompatible)
  - Frontend sous-onglet "Phénologie" dans `public/app.jsx`
- **Sprint 2-3** :
  - `kpiAnalyzer.js` + seed `phenology_kpi_definitions/*` (17 docs)
  - Composants frontend (`RadsumChart`, `DliChart`, `DliVsTargetGauge`, `IrrigationRecipeCard`)
- **Sprint 3-4** :
  - Phyto taxonomy (`phenology_taxonomy/*`)
  - Composants surveillance phyto
- **Sprint 4-5** :
  - Articulation `lib/phenology/` ↔ `lib/irrigation/` (lib/irrigation peut consommer en lecture la recette du stade)
- **Plus tard** :
  - `plots/ML-C-LAR-01` (canarienne) — date plantation à vérifier en archives
  - `plots/ML-T-LAR-02` (cycle 3 Green Cane primocane post-mow-down 2026-05-31)
  - Refonte build modulaire `app.jsx` → `/src/modules/phenology/` (chantier dédié)

---

## Discipline et garde-fous

- **Aucune modification** de [`functions/index.js`](../../index.js) — le legacy `gddNightlyJob` (mode anthèse → récolte) reste 100 % intact.
- **Aucune modification** de [`public/app.jsx`](../../../public/app.jsx) — `GDDTrackingTab` legacy reste affiché tel quel.
- **Pattern strict** : copie 1-pour-1 de [`functions/lib/irrigation/`](../irrigation/).
- **Discipline checkpoint** : chaque tâche Sprint 1 a fait l'objet d'un retour utilisateur explicite avant la suivante. Pour les scripts seed, autorisation prod explicite à chaque étape (dry-run → run → idempotence → force).
