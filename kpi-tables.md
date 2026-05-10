# Tables de référence KPIs par stade — Smart Berry

> **Document de référence agronomique** — définit pour chaque stade phénologique du framboisier hors-sol les KPIs à suivre, leurs cibles, méthodes de mesure, fréquences et actions correctives.
> Source de vérité pour la collection Firestore `phenology_kpi_definitions`.
> S'applique aux variétés Maravilla et Jasmin (paramètres irrigation identiques entre variétés Driscoll's).
>
> **Version 1.1.0** : ajout KPIs RADSUM/DLI, intégration sources FarmRoad selon shelter type.

## Sommaire

1. [Principes directeurs](#1-principes-directeurs)
2. [Catégories de KPIs](#2-catégories-de-kpis)
3. [Sources de données capteurs](#3-sources-de-données-capteurs)
4. [KPIs transversaux (tous stades)](#4-kpis-transversaux-tous-stades)
5. [Stade S0 — Reprise / Enracinement](#5-stade-s0--reprise--enracinement)
6. [Stade S1 — Croissance végétative initiale](#6-stade-s1--croissance-végétative-initiale)
7. [Stade S2 — Croissance végétative active](#7-stade-s2--croissance-végétative-active)
8. [Stade S3 — Initiation florale](#8-stade-s3--initiation-florale)
9. [Stade S4 — Floraison (CRITIQUE)](#9-stade-s4--floraison-critique)
10. [Stade S5 — Nouaison / grossissement](#10-stade-s5--nouaison--grossissement)
11. [Stade S6 — Véraison / maturation](#11-stade-s6--véraison--maturation)
12. [Stade S7 — Pleine récolte](#12-stade-s7--pleine-récolte)
13. [Stade S8 — Fin de cycle](#13-stade-s8--fin-de-cycle)
14. [Stades floricane F0-F7](#14-stades-floricane-f0-f7)
15. [Recommandations d'usage](#15-recommandations-dusage)
16. [Format JSON pour seed Firestore](#16-format-json-pour-seed-firestore)

---

## 1. Principes directeurs

**Principe 1 — Mesurabilité simple**
Chaque KPI doit être réalisable par un chef de culture en moins de 5 minutes, avec un équipement standard, OU être calculé automatiquement depuis les sondes FarmRoad/ALADINN.

**Principe 2 — Cibles contextualisées**
Chaque KPI a 4 seuils : `criticalMin` < `targetMin` < `targetMax` < `criticalMax`.

**Principe 3 — Action corrective explicite**
Chaque KPI a au minimum une condition d'alerte et une action recommandée associée.

**Principe 4 — Stratification mandatory / optional**
Pour ne pas saturer l'équipe terrain, chaque stade a 5–7 KPIs `mandatory` (saisie obligatoire) et le reste en `optional`. Les KPIs auto-calculés depuis sondes ne nécessitent aucune saisie.

**Principe 5 — Tendance > valeur ponctuelle**
Le système analyse les 3-5 dernières mesures et détecte les tendances. Une dérive lente est souvent plus diagnostique qu'une valeur isolée.

**Principe 6 — Sources hiérarchisées**
Pour chaque KPI auto-calculé, hiérarchie : sonde dédiée parcelle → sonde station FarmRoad du shelter type → fallback API externe (Meteoblue).

---

## 2. Catégories de KPIs

| Catégorie | Description | Exemples |
|---|---|---|
| **phenologique** | Mesure le développement du plant | Hauteur canne, nombre feuilles, % nouaison |
| **agronomique_substrat** | Mesure l'état du substrat / fertirrigation | EC drainage, pH drainage, % drainage, EC pour-thru |
| **agronomique_plant** | Mesure l'état physiologique du plant | Couleur feuillage, stress visuel, analyse foliaire |
| **environnement** | Mesure les conditions climatiques sous abri | T° air, hygrométrie, T° substrat, lumière, DLI, RADSUM |
| **production** | Mesure les sorties (S5+) | Rendement, calibre, Brix, % cat 1 |
| **operationnel** | Mesure l'efficacité opérationnelle | Conso eau/plant, productivité main-d'œuvre |

---

## 3. Sources de données capteurs

### 3.1 Hiérarchie des sources

| Type de mesure | Source primaire | Source secondaire | Fallback |
|---|---|---|---|
| Température air | Sonde air FarmRoad (station du shelter type) | Sonde air ALADINN parcelle | Meteoblue API |
| Humidité air | Sonde hygro FarmRoad | — | Meteoblue API |
| CO₂ | Sonde CO₂ FarmRoad | — | — (non substituable) |
| PAR | Sonde PAR FarmRoad | Sonde Radiation × 0.46/4.57 | Meteoblue × coverTransmission |
| Radiation totale | Sonde Radiation FarmRoad | Sonde PAR / 0.46 × 4.57 | Meteoblue × coverTransmission |
| VPD | Calculé depuis T° + Hygro OU sonde VPD FarmRoad | — | Meteoblue |
| Point de rosée | Sonde FarmRoad | Calculé depuis T° + Hygro | — |
| T° substrat | Sonde Teros ALADINN | Estimation (T° air - 2°C) | — |
| VWC substrat | Sonde WET FarmRoad OU Teros ALADINN | — | — |
| EC drainage | Sonde drainage ALADINN | Saisie manuelle bac collecteur | — |
| pH drainage | Sonde drainage ALADINN | Saisie manuelle pH-mètre | — |

### 3.2 Mapping shelter type → station FarmRoad

Pour chaque parcelle, la station FarmRoad utilisée est déterminée par :
```
plot.shelter.type === "canarienne" → farmroad_canarienne_main (V1)
plot.shelter.type === "tunnel"     → farmroad_tunnel_main (V1)
```

V2 : architecture multi-stations avec mapping fin parcelle → station par bloc/zone.

### 3.3 Fréquence de capture sondes

| Source | Pas standard | Volume jour | Stockage |
|---|---|---|---|
| Sondes FarmRoad | 5 min | 288 samples | Firestore time-series ou TimescaleDB (V2) |
| Sondes ALADINN | 5-15 min | 96-288 samples | Selon module ALADINN |
| Saisies manuelles | Variable selon KPI | — | Firestore directement |

---

## 4. KPIs transversaux (tous stades)

Stockés dans `phenology_kpi_definitions/all_stages`.

### 4.1 KPIs auto-calculés depuis sondes FarmRoad/ALADINN

| Code | Label | Catégorie | Unité | Fréquence | Source | Notes |
|---|---|---|---|---|---|---|
| `temp_air_min` | T° air min sous abri | environnement | °C | Continue | FarmRoad (selon shelter) | Sert calcul GDD |
| `temp_air_max` | T° air max sous abri | environnement | °C | Continue | FarmRoad (selon shelter) | Sert calcul GDD |
| `temp_substrat` | T° substrat moyenne | environnement | °C | Continue | Sonde Teros ALADINN | Cible 16–24 °C |
| `humidity_air_avg` | Hygrométrie moyenne 24h | environnement | % | Continue | FarmRoad | Cible 60–75 % |
| `humidity_air_max` | Hygrométrie max 24h | environnement | % | Continue | FarmRoad | Alerte > 85 % (risque Botrytis) |
| `co2_avg` | CO₂ moyen | environnement | ppm | Continue | FarmRoad | Tunnel : 800-1500, canarienne : 400-800 |
| `vpd_avg` | VPD moyen 24h | environnement | kPa | Continue | FarmRoad | Cible 0,4-1,0 kPa |
| `vwc_substrat` | VWC substrat | agronomique_substrat | % | Continue | Sonde WET / Teros | Cible 55–70 % selon coco |
| `dewpoint_avg` | Point de rosée | environnement | °C | Continue | FarmRoad | Surveille condensation |
| `gdd_day` | GDD du jour | environnement | °Cd | Quotidien (calculé) | Calcul depuis T_min/T_max | — |
| `gdd_cumul` | GDD cumul depuis plantation | environnement | °Cd | Quotidien (calculé) | Cumul | Pilote phenology |
| **`radiation_daily_mj`** | **Radiation cumulée jour** | **environnement** | **MJ/m²/j** | **Quotidien (calculé)** | **Sonde Radiation FarmRoad** | **NOUVEAU v1.1** |
| **`dli_daily`** | **DLI (Daily Light Integral)** | **environnement** | **mol/m²/j** | **Quotidien (calculé)** | **Sonde PAR FarmRoad** | **NOUVEAU v1.1, KPI lumière clé** |
| **`radsum_cumul`** | **RADSUM cumul depuis plantation** | **environnement** | **MJ/m²** | **Quotidien (calculé)** | **Cumul** | **NOUVEAU v1.1, bilan énergétique** |
| **`dli_cumul`** | **DLI cumul depuis plantation** | **environnement** | **mol/m²** | **Quotidien (calculé)** | **Cumul** | **NOUVEAU v1.1, suivi potentiel productif** |

### 4.2 KPIs saisis (apport / drainage)

| Code | Label | Catégorie | Unité | Fréquence | Source | Notes |
|---|---|---|---|---|---|---|
| `ec_apport` | EC solution apport | agronomique_substrat | mS/cm | Quotidien | Sonde tête / saisie | Cible varie selon stade |
| `ph_apport` | pH solution apport | agronomique_substrat | — | Quotidien | Sonde tête / saisie | Cible 5,5–5,8 |
| `ec_drainage` | EC drainage | agronomique_substrat | mS/cm | 2-7×/sem | Bac collecteur / sonde | Cible = apport + 0,3 à 0,8 |
| `ph_drainage` | pH drainage | agronomique_substrat | — | 2-7×/sem | Bac collecteur / sonde | Cible 5,8–6,3 |
| `volume_apport` | Volume apport jour | operationnel | L/plant ou L/m² | Quotidien | Compteur | Variable |
| `volume_drainage` | Volume drainage jour | operationnel | L | Quotidien | Compteur | Sert au calcul % drainage |
| `pct_drainage` | % drainage réel | agronomique_substrat | % | Quotidien (calculé) | Vol_drainage / Vol_apport | Cible varie selon stade |

---

## 5. Stade S0 — Reprise / Enracinement

**Objectif :** assurer une reprise homogène avec émission de racines blanches saines.

### KPIs S0

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Méthode | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `pct_reprise` | % plants vivants | phenologique | % | J+15, J+30 | 95 | 100 | 90 | 100 | ✅ | Comptage plants vivants/plantés | Si < 90 % → audit qualité plants, T° substrat, EC choc |
| `presence_racines_blanches` | Émergence racinaire | phenologique | bool | Hebdo | 1 | 1 | 1 | 1 | ✅ | Inspection visuelle | Si absent J+15 → vérifier T°, EC, oxygénation |
| `temp_substrat_moy` | T° substrat moyenne | environnement | °C | Continue | 16 | 22 | 14 | 26 | ✅ | Sonde Teros (auto) | Si < 14 → cycles diurnes ; si > 26 → ombrage |
| `dli_daily_s0` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 8 | 15 | 5 | 20 | ✅ | Sonde PAR FarmRoad (auto) | Si > 20 → ombrage jeunes plants |
| `ec_drainage_s0` | EC drainage | agronomique_substrat | mS/cm | 2×/sem | 1,4 | 1,8 | 1,0 | 2,5 | ✅ | Bac collecteur | Si > 2,2 → drainage forcé |
| `ph_drainage_s0` | pH drainage | agronomique_substrat | — | 2×/sem | 5,8 | 6,3 | 5,2 | 6,8 | ✅ | pH-mètre | Ajuster acidification |
| `pct_drainage_s0` | % drainage réel | operationnel | % | Quotidien | 10 | 15 | 5 | 25 | ✅ | Calcul | Ajuster cycles |
| `vwc_substrat_s0` | Humidité substrat (VWC) | agronomique_substrat | % | Continue | 55 | 65 | 45 | 75 | optional | Sonde WET (auto) | Ajuster nb cycles |
| `homogeneite_visuelle` | Homogénéité parcelle | phenologique | échelle 1-5 | Hebdo | 4 | 5 | 3 | 5 | optional | Visuel global | Si < 4 → identifier bacs problématiques |

---

## 6. Stade S1 — Croissance végétative initiale

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `hauteur_canne` | Hauteur moyenne canne | phenologique | cm | Hebdo | (croissance +5/sem) | — | < +3 cm/sem | — | ✅ | Si < 3 cm/sem → vérifier N, T°, lumière |
| `nb_feuilles_vraies` | Nombre feuilles vraies | phenologique | nb | Hebdo | 5 | 10 | 3 | 15 | ✅ | Si < 5 → vérifier nutrition, EC |
| `couleur_feuillage` | Couleur feuillage (SPAD) | agronomique_plant | unités SPAD | Hebdo | 38 | 45 | 32 | 50 | ✅ | Si pâle → +N ; si foncé → +P, -N |
| `dli_daily_s1` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 10 | 18 | 6 | 25 | ✅ | Si < 10 sur 7j → diagnostic toile/orientation |
| `ec_drainage_s1` | EC drainage | agronomique_substrat | mS/cm | 2×/sem | 1,8 | 2,2 | 1,4 | 2,7 | ✅ | Standard |
| `ph_drainage_s1` | pH drainage | agronomique_substrat | — | 2×/sem | 5,8 | 6,3 | 5,2 | 6,8 | ✅ | Standard |
| `pct_drainage_s1` | % drainage | operationnel | % | Quotidien | 15 | 20 | 10 | 30 | ✅ | Standard |
| `diametre_canne_base` | Diamètre canne base | phenologique | mm | Bi-mensuel | 4 | 7 | 3 | 10 | optional | Si fin → augmenter EC apport |
| `stress_hydrique_visuel` | Stress hydrique visuel | agronomique_plant | échelle 0-3 | Quotidien | 0 | 0 | 0 | 1 | optional | Si ≥ 1 → augmenter apports |

---

## 7. Stade S2 — Croissance végétative active

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `hauteur_canne_s2` | Hauteur canne fin S2 | phenologique | cm | Hebdo | 60 | 100 | 40 | 130 | ✅ | Ajuster N |
| `nb_cannes_par_plant` | Nombre cannes vigoureuses/plant | phenologique | nb | Hebdo | 3 | 5 | 2 | 7 | ✅ | Si > 6 → effeuillage |
| `dli_daily_s2` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 15 | 22 | 10 | 30 | ✅ | Si < 10 → propreté toile, orientation |
| `ec_drainage_s2` | EC drainage | agronomique_substrat | mS/cm | 2×/sem | 1,9 | 2,4 | 1,5 | 2,9 | ✅ | Surveillance accrue |
| `ec_pourthru_s2` | EC pour-thru substrat | agronomique_substrat | mS/cm | Hebdo | 2,0 | 2,5 | 1,5 | 3,0 | ✅ | Si > 3,0 → drainage forcé |
| `conso_eau_plant_jour` | Conso eau / plant / jour | operationnel | L/plant | Quotidien | 0,3 | 0,6 | 0,2 | 0,8 | ✅ | Ajuster cycles selon ETP |
| `diametre_canne_30cm` | Diamètre canne à 30 cm | phenologique | mm | Bi-mensuel | 6 | 9 | 4 | 12 | optional | Indicateur vigueur |
| `apparition_ramifications` | Émission ramifications latérales | phenologique | bool | Hebdo | 1 (fin S2) | 1 | 1 | 1 | optional | Si absent → vérifier T°, photopériode |
| `analyse_foliaire_n` | N foliaire | agronomique_plant | % MS | 1×/stade | 2,8 | 3,2 | 2,4 | 3,6 | optional | Labo (AGQ) |
| `analyse_foliaire_k` | K foliaire | agronomique_plant | % MS | 1×/stade | 1,8 | 2,2 | 1,5 | 2,5 | optional | Labo |
| `analyse_foliaire_ca` | Ca foliaire | agronomique_plant | % MS | 1×/stade | 0,8 | 1,2 | 0,6 | 1,5 | optional | Labo |

---

## 8. Stade S3 — Initiation florale

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `apparition_boutons_floraux` | Boutons floraux visibles fin S3 | phenologique | bool | 2×/sem | 1 (fin S3) | 1 | 1 | 1 | ✅ | Si retard > 100 GDD → recalibrer |
| `nb_boutons_par_canne` | Nombre boutons/canne | phenologique | nb | Hebdo | 8 | 15 | 5 | 25 | ✅ | Indicateur potentiel rendement |
| `vigueur_apicale` | Vigueur apicale | agronomique_plant | échelle 1-5 | Hebdo | 4 | 5 | 3 | 5 | ✅ | Si faible → revoir N/K |
| `dli_daily_s3` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 18 | 25 | 12 | 32 | ✅ | Si < 12 → décalage initiation florale probable |
| `ratio_k_n_apport` | Ratio K/N solution apport | agronomique_substrat | ratio | Permanent | 1,2 | 1,5 | 1,0 | 2,0 | ✅ | Glissement vers 1,5 |
| `ec_drainage_s3` | EC drainage | agronomique_substrat | mS/cm | 2×/sem | 2,1 | 2,6 | 1,7 | 3,1 | ✅ | Standard |
| `ph_drainage_s3` | pH drainage | agronomique_substrat | — | 2×/sem | 5,8 | 6,3 | 5,2 | 6,8 | ✅ | Strict |
| `analyse_foliaire_s3` | Analyse foliaire complète | agronomique_plant | — | 1× en S3 | (rapport labo) | — | — | — | optional | K montant, N stable |

---

## 9. Stade S4 — Floraison (CRITIQUE)

**Stade le plus sensible** : tous les KPIs passent en quotidien.

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `pct_fleurs_ouvertes` | % fleurs ouvertes | phenologique | % | 2×/sem | (suivi pic) | — | — | — | ✅ | Synchroniser bourdons |
| `activite_bourdons` | Activité bourdons | environnement | mvts/min | 2×/sem | 50 | 200 | 20 | 300 | ✅ | Si faible → vérifier ruche, T° |
| `pct_avortement_floral` | % avortement floral | phenologique | % | Hebdo | 0 | 10 | 0 | 20 | ✅ | Si > 15 % → audit T°, B, Ca |
| `temp_max_abri_s4` | T° max sous abri | environnement | °C | Continue (auto) | 18 | 28 | 12 | 32 | ✅ | Brumisation/aération si > 30 |
| `humidity_avg_s4` | Hygrométrie moyenne | environnement | % | Continue (auto) | 60 | 75 | 50 | 85 | ✅ | Si > 80 → aération + risque Botrytis |
| `dli_daily_s4` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 20 | 28 | 15 | 35 | ✅ | DLI < 15 = pollinisation faible. > 35 = stress radiatif |
| `vpd_avg_s4` | VPD moyen | environnement | kPa | Continue (auto) | 0,5 | 1,2 | 0,3 | 1,8 | optional | Pilotage transpiration |
| `stress_hydrique_s4` | Stress hydrique visuel | agronomique_plant | échelle 0-3 | Quotidien | 0 | 0 | 0 | 0 | ✅ | TOLÉRANCE ZÉRO |
| `ec_drainage_s4` | EC drainage | agronomique_substrat | mS/cm | Quotidien | 2,2 | 2,7 | 1,8 | 3,2 | ✅ | Surveillance |
| `ph_drainage_s4` | pH drainage | agronomique_substrat | — | Quotidien | 5,8 | 6,2 | 5,4 | 6,5 | ✅ | Très strict |
| `pct_drainage_s4` | % drainage | operationnel | % | Quotidien | 28 | 33 | 25 | 38 | ✅ | ±2 pts cible 30 % |

---

## 10. Stade S5 — Nouaison / grossissement

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `pct_nouaison` | % nouaison | phenologique | % | Hebdo | 80 | 95 | 65 | 100 | ✅ | Si < 70 % → audit S4 |
| `calibre_fruits_verts` | Calibre fruits verts | phenologique | mm | Hebdo | (croissance régulière) | — | — | — | ✅ | Indicateur précocité |
| `nb_fruits_par_canne` | Nb fruits/canne | phenologique | nb | Hebdo | 25 (Mar) / 20 (Jas) | 40 / 35 | 15 / 12 | 50 / 45 | ✅ | Charge potentielle |
| `symptomes_carence_ca` | Symptômes carence Ca apex | agronomique_plant | bool | Hebdo | 0 | 0 | 0 | 0 | ✅ | Si présent → +Ca foliaire |
| `dli_daily_s5` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 20 | 30 | 15 | 38 | ✅ | Influence calibre fruits |
| `ec_drainage_s5` | EC drainage | agronomique_substrat | mS/cm | 2×/sem | 2,2 | 2,7 | 1,8 | 3,2 | ✅ | Standard |
| `ph_drainage_s5` | pH drainage | agronomique_substrat | — | 2×/sem | 5,8 | 6,3 | 5,2 | 6,8 | ✅ | Standard |
| `pct_drainage_s5` | % drainage | operationnel | % | Quotidien | 30 | 35 | 25 | 42 | ✅ | Augmenter avec ETP |
| `conso_eau_s5` | Consommation eau/plant/jour | operationnel | L/plant | Quotidien | 0,6 | 1,0 | 0,4 | 1,3 | ✅ | Pic de demande |
| `symptomes_carence_mg` | Symptômes carence Mg | agronomique_plant | bool | Hebdo | 0 | 0 | 0 | 0 | optional | Ajuster Mg |

---

## 11. Stade S6 — Véraison / maturation

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `pct_fruits_virant` | % fruits en virage couleur | phenologique | % | 2×/sem | (suivi vague) | — | — | — | ✅ | Démarrer logistique récolte |
| `brix_premiers_fruits` | Brix premiers fruits | production | °Brix | 2×/sem | 9,0 (Mar) / 9,5 (Jas) | 12 | 7,5 | 14 | ✅ | Si < 8 → +K, réduire eau |
| `calibre_moyen_fruit` | Calibre moyen fruit | production | g/fruit | 2×/sem | 4,0 (Mar) / 3,5 (Jas) | 6,5 | 2,8 | 8,0 | ✅ | Indicateur cat. commerciale |
| `couleur_homogeneite` | Homogénéité couleur | production | échelle 1-5 | 2×/sem | 4 | 5 | 3 | 5 | ✅ | Si terne → +K, vérifier lumière |
| `dli_daily_s6` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 22 | 30 | 16 | 40 | ✅ | Influence Brix, coloration |
| `ec_drainage_s6` | EC drainage | agronomique_substrat | mS/cm | 2×/sem | 2,4 | 2,8 | 2,0 | 3,3 | ✅ | Tolérance haute pour qualité |
| `conso_eau_s6` | Consommation eau/plant/jour | operationnel | L/plant | Quotidien | 0,8 | 1,2 | 0,5 | 1,5 | ✅ | Pic |
| `fermete_fruit` | Fermeté fruit | production | échelle 1-5 ou pénétro | Hebdo | 4 | 5 | 3 | 5 | optional | Ajuster Ca, K, EC |
| `ratio_kn_drainage` | Ratio K/N drainage | agronomique_substrat | ratio | 1×/sem | 2,0 | 2,5 | 1,5 | 3,0 | optional | Ajuster formule |

---

## 12. Stade S7 — Pleine récolte

C'est ici que tu accumules le plus de data business.

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `rendement_passage` | Rendement / passage | production | kg/parcelle | Chaque cueille | (variable selon vague) | — | — | — | ✅ | Tracker cumul saison |
| `rendement_cumule_kg_plant` | Cumul kg/plant saison | production | kg/plant | Hebdo (calculé) | 0,8 (Mar) / 0,7 (Jas) | 1,5 | 0,5 | 2,0 | ✅ | Comparer obj Driscoll |
| `pct_categorie_1` | % catégorie 1 (calibre commercial) | production | % poids | Chaque cueille | 75 | 95 | 60 | 100 | ✅ | Si < 70 % → audit calibre |
| `pct_ecarts_tri` | % écarts de tri | production | % poids | Chaque cueille | 0 | 15 | 0 | 25 | ✅ | Causes : maturité, calibre, défauts |
| `brix_moyen` | Brix moyen | production | °Brix | Chaque cueille | 9,5 (Mar) / 10,0 (Jas) | 13 | 8,0 | 15 | ✅ | Ajuster EC, K |
| `calibre_moyen_recolte` | Calibre moyen | production | g/fruit | Chaque cueille | 4,0 (Mar) / 3,5 (Jas) | 6,5 | 2,8 | 8,0 | ✅ | Ajuster charge fruits |
| `pct_pourriture` | % pourriture (Botrytis) | production | % | Hebdo (post-récolte) | 0 | 3 | 0 | 8 | ✅ | Aération, fongicides, hygro |
| `productivite_main_oeuvre` | kg cueillis / heure cueilleur | operationnel | kg/h | Chaque cueille | 4 | 8 | 2 | 12 | ✅ | Indicateur opé |
| `dli_daily_s7` | DLI journalier | environnement | mol/m²/j | Continue (auto) | 22 | 30 | 16 | 40 | ✅ | DLI > 35 sur 5j → ombrage 30 % |
| `ec_drainage_s7` | EC drainage | agronomique_substrat | mS/cm | Quotidien | 2,4 | 2,8 | 2,0 | 3,3 | ✅ | Critique |
| `ph_drainage_s7` | pH drainage | agronomique_substrat | — | Quotidien | 5,8 | 6,3 | 5,2 | 6,8 | ✅ | Critique |
| `pct_drainage_s7` | % drainage | operationnel | % | Quotidien | 35 | 45 | 30 | 50 | ✅ | Lessivage actif |
| `ec_pourthru_s7` | EC pour-thru | agronomique_substrat | mS/cm | Hebdo | 2,5 | 3,5 | 1,8 | 4,5 | ✅ | Si > 4 → drainage forcé URGENT |
| `pct_fruits_casses` | % fruits cassés/déformés | production | % | Chaque cueille | 0 | 5 | 0 | 12 | optional | Audit pollinisation |
| `fermete_fruit_s7` | Fermeté fruit | production | échelle 1-5 | Hebdo | 4 | 5 | 3 | 5 | optional | Ajuster Ca |
| `vitesse_maturation` | Vitesse maturation (j fleur→fruit) | phenologique | jours | Bi-mensuel | 30 | 40 | 25 | 50 | optional | Indicateur conduite |

---

## 13. Stade S8 — Fin de cycle

| Code | Label | Cat. | Unité | Fréq. | targetMin | targetMax | criticalMin | criticalMax | Mandatory | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `cumul_rendement_final` | Cumul rendement final | production | kg total parcelle | En fin | (objectif) | — | — | — | ✅ | Bilan campagne |
| `pct_cat1_final` | % cat 1 cumul saison | production | % | En fin | 70 | 90 | 55 | 100 | ✅ | Bilan qualité |
| `dli_cumul_final` | DLI cumul final | environnement | mol/m² | En fin | 3500 | 4500 | 2500 | 5500 | ✅ | Bilan radiatif vs cible |
| `radsum_cumul_final` | RADSUM cumul final | environnement | MJ/m² | En fin | 1800 | 2400 | 1200 | 3000 | ✅ | Bilan énergétique vs cible |
| `etat_sanitaire_plants` | État sanitaire plants | agronomique_plant | échelle 1-5 | Hebdo | 4 | 5 | 2 | 5 | optional | Décision arrachage/conservation |
| `ec_pourthru_lessivage` | EC pour-thru après lessivage final | agronomique_substrat | mS/cm | Avant fin | 0 | 1,5 | 0 | 2,5 | ✅ | Préparer cycle suivant |

---

## 14. Stades floricane F0-F7

Les KPIs floricane sont **structurellement identiques** aux primocane équivalents :

| Floricane | Équivalent primocane | KPIs spécifiques additionnels | Cible DLI |
|---|---|---|---|
| F0 (Débourrement) | S0 + spécifique | `etat_bourgeons` (échelle gonflement) | 8-15 |
| F1 (Croissance latérale) | S1+S2 fusionnés | — | 12-22 |
| F2 (Boutons floraux) | S3 | — | 18-25 |
| F3 (Floraison) | S4 — CRITIQUE | KPIs identiques S4 | 20-28 |
| F4 (Nouaison) | S5 | KPIs identiques S5 | 20-30 |
| F5 (Véraison) | S6 | KPIs identiques S6 | 22-30 |
| F6 (Pleine récolte) | S7 | KPIs identiques S7, **plus concentré dans le temps** | 22-30 |
| F7 (Fin récolte) | S8 + transition | `transition_primocane_active` | 15-25 |

---

## 15. Recommandations d'usage

### 15.1 Volumétrie et organisation équipe

Sur 17 stades × ~10-15 KPIs = ~200 KPI-stages potentiels. La majorité sont **auto-calculés** depuis les sondes FarmRoad/ALADINN, ne nécessitant aucune saisie. Pour les KPIs à saisir :

- **Saison 1** : activer uniquement les KPIs `mandatory` (5–7 par stade)
- **Saison 2** : ajouter les KPIs `optional` selon disponibilité technicien
- **Saison 3+** : suivi exhaustif possible si équipe dimensionnée

### 15.2 Répartition par rôle

| Rôle | KPIs prioritaires (à saisir) | KPIs consultés (auto) |
|---|---|---|
| **Chef de culture** (quotidien) | EC drainage, pH drainage, % drainage, stress visuel, conso eau | T° substrat, DLI, hygro, GDD |
| **Technicien / agronome** (hebdo) | Hauteur, nb feuilles/cannes, couleur, % nouaison, calibre, symptômes carences, analyses foliaires | Tous environnement |
| **Lead cueille** (récolte S6+) | Rendement, calibre, Brix, % cat 1, % écarts, productivité | DLI cumul, conditions récolte |
| **Chef exploitation (Omar)** | Tous KPIs en consultation | Toutes alertes critiques + DLI cumul vs cible |

### 15.3 Workflow type d'une journée (S5)

| Heure | Acteur | KPIs saisis ou calculés |
|---|---|---|
| 6h00 | Sondes FarmRoad/ALADINN (auto) | T°, hygro, CO₂, PAR, Radiation, VWC, EC drainage |
| 7h30 | Chef culture (tour parcelle) | EC drainage manuel (vérif sonde), pH drainage, stress visuel |
| 8h00 | Chef culture (WhatsApp) | Saisie 3 KPIs critiques |
| 10h00 | Technicien (tournée hebdo) | % nouaison, calibre, symptômes carences |
| 14h00 | Système (calculé) | % drainage réel, conso eau/plant/jour |
| 23h59 | Job nightly | GDD, RADSUM, DLI du jour + cumuls + résolution stage |
| 00h05 lendemain | Système | Digest J-1 envoyé Omar |

### 15.4 Qualité de la donnée

- **Calibration équipement saisie** : EC-mètre et pH-mètre calibrés hebdo
- **Calibration sondes FarmRoad** : maintenance trimestrielle (validation ratio PAR/Radiation, T° de référence)
- **Photos systématiques** sur observations visuelles
- **Saisie en temps réel** (sur place) pour éviter biais mémoire

---

## 16. Format JSON pour seed Firestore

Structure des documents `phenology_kpi_definitions/{stageCode}` :

### Exemple : `phenology_kpi_definitions/S4`

```json
{
  "stage": "S4",
  "stageName": "Floraison",
  "cycleType": "primocane",
  "criticalStage": true,
  "kpis": [
    {
      "code": "pct_avortement_floral",
      "label": "% avortement floral",
      "labelAr": "نسبة إجهاض الأزهار",
      "category": "phenologique",
      "unit": "%",
      "frequency": "weekly",
      "targetMin": 0, "targetMax": 10,
      "criticalMin": 0, "criticalMax": 20,
      "mandatory": true,
      "source": "manual",
      "measurementMethod": "Compter fleurs sénescentes sans nouaison sur 10 cannes représentatives",
      "correctiveActions": [
        {
          "condition": "value > targetMax",
          "severity": "yellow",
          "action": "Vérifier T° abri (< 30°C), activité bourdons, Ca foliaire"
        },
        {
          "condition": "value > criticalMax",
          "severity": "red",
          "action": "Audit complet : T°, pollinisation, hygrométrie, B, Ca. Considérer apport B + Ca foliaire 0,2%"
        }
      ]
    },
    {
      "code": "dli_daily_s4",
      "label": "DLI journalier",
      "labelAr": "مؤشر الضوء اليومي",
      "category": "environnement",
      "unit": "mol/m²/j",
      "frequency": "continuous",
      "targetMin": 20, "targetMax": 28,
      "criticalMin": 15, "criticalMax": 35,
      "mandatory": true,
      "source": "auto_farmroad_par",
      "measurementMethod": "Calcul automatique depuis sonde PAR FarmRoad de la station du shelter type",
      "correctiveActions": [
        {
          "condition": "value < criticalMin",
          "severity": "red",
          "action": "Risque pollinisation faible. Vérifier propreté toile, ombrages parasites. Considérer éclairage d'appoint si chronique"
        },
        {
          "condition": "value > criticalMax",
          "severity": "yellow",
          "action": "Stress radiatif. Surveiller flétrissement, brumiser si nécessaire. Si récurrent, déployer filet ombrage 30%"
        }
      ],
      "trendAnalysis": {
        "windowDays": 7,
        "alertOnDecrease": true,
        "decreaseThreshold": 5
      }
    },
    {
      "code": "ec_drainage_s4",
      "label": "EC drainage",
      "labelAr": "EC التصريف",
      "category": "agronomique_substrat",
      "unit": "mS/cm",
      "frequency": "daily",
      "targetMin": 2.2, "targetMax": 2.7,
      "criticalMin": 1.8, "criticalMax": 3.2,
      "mandatory": true,
      "source": "manual_or_aladinn_sensor",
      "measurementMethod": "Mesure EC-mètre sur bac collecteur représentatif OU sonde drainage ALADINN",
      "correctiveActions": [
        {
          "condition": "value > targetMax",
          "severity": "yellow",
          "action": "Augmenter % drainage de 3-5 pts, vérifier EC apport"
        },
        {
          "condition": "value > criticalMax",
          "severity": "red",
          "action": "Drainage forcé urgent, baisser EC apport de 0,3, vérifier qualité eau brute"
        },
        {
          "condition": "value < criticalMin",
          "severity": "red",
          "action": "Réduire % drainage, augmenter EC apport"
        }
      ],
      "trendAnalysis": {
        "windowDays": 7,
        "alertOnIncrease": true,
        "increaseThreshold": 0.4
      }
    }
  ],
  "metadata": {
    "version": "1.1.0",
    "lastUpdated": "2026-05-03",
    "source": "Smart Berry agronomic team",
    "notes": "Stade critique : tous KPIs en quotidien. DLI auto-calculé depuis FarmRoad."
  }
}
```

### Documents à créer (17 + 1)

```
phenology_kpi_definitions/
├── all_stages          # KPIs transversaux (section 4)
├── S0                  # Reprise primocane
├── S1, S2, S3
├── S4                  # criticalStage: true
├── S5, S6, S7, S8
├── F0                  # Débourrement floricane
├── F1, F2
├── F3                  # criticalStage: true
└── F4, F5, F6, F7
```

---

## Changelog

- **v1.0.0** (2026-05-03) : Création initiale, baseline pour saison 1.
- **v1.1.0** (2026-05-03) : Ajout KPIs RADSUM/DLI auto-calculés (`dli_daily_sX` mandatory par stade, `dli_cumul`, `radsum_cumul` transversaux). Hiérarchie sources capteurs FarmRoad selon shelter type. KPIs bilan radiatif S8.
