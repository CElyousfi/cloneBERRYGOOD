# Tables de référence phénologie — Smart Berry

> **Document de référence agronomique** — sert de source de vérité pour le module Phenology Engine de Smart Berry.
> Modifications nécessitent validation agronome référent (Omar) et idéalement validation technicien Driscoll's.
> Les valeurs GDD et DLI sont à **calibrer en saison 1** par observations terrain. Cf. section calibration.
>
> **Version 1.1.0** : intégration shelter type (Canarienne/Tunnel), mapping FarmRoad, RADSUM et DLI.

## Sommaire

1. [Paramètres généraux du modèle GDD](#1-paramètres-généraux-du-modèle-gdd)
2. [Paramètres généraux du modèle RADSUM / DLI](#2-paramètres-généraux-du-modèle-radsum--dli)
3. [Type d'abri et stations FarmRoad](#3-type-dabri-et-stations-farmroad)
4. [Profil variétal et coefficients précocité](#4-profil-variétal-et-coefficients-précocité)
5. [Maravilla — Primocane](#5-maravilla--primocane)
6. [Maravilla — Floricane](#6-maravilla--floricane)
7. [Jasmin — Primocane](#7-jasmin--primocane)
8. [Jasmin — Floricane](#8-jasmin--floricane)
9. [Coefficients d'ajustement contextuels (V2)](#9-coefficients-dajustement-contextuels-v2)
10. [Règles de calibration](#10-règles-de-calibration)
11. [Format JSON pour seed Firestore](#11-format-json-pour-seed-firestore)

---

## 1. Paramètres généraux du modèle GDD

| Paramètre | Valeur | Justification |
|---|---|---|
| **T_base** | **5 °C** | Standard Rubus idaeus, validé littérature (Carew, Privé, Sonsteby, Heide) |
| **T_cap (plafond)** | **30 °C** | Au-delà : pas de gain physiologique, risque inverse (avortement floral) |
| **T_optimum** | 18–24 °C | Plage où conversion GDD → développement maximale |
| **Source T° prioritaire** | Sonde air FarmRoad (selon shelter type parcelle) | Cf. section 3 |
| **Source T° fallback 1** | Sonde air ALADINN (si présente) | |
| **Source T° fallback 2** | Meteoblue API (point parcelle) | Si toutes sondes indisponibles > 6h |
| **Pas de calcul** | Journalier | GDD_jour = max(0, ((T_max_capped + T_min) / 2) - T_base) |
| **Démarrage cumul** | Date de plantation (primocane) ou date de débourrement post-taille (floricane) | |

**Formule de calcul :**
```
T_max_capped = min(T_max, T_cap)
GDD_jour = max(0, ((T_max_capped + T_min) / 2) - T_base)
GDD_cumul(j) = GDD_cumul(j-1) + GDD_jour(j)
```

---

## 2. Paramètres généraux du modèle RADSUM / DLI

Le modèle de cumul radiatif complète le GDD : il prédit le **potentiel** (nombre de fleurs, calibre, Brix), tandis que le GDD prédit le **timing** (quand un stade arrive).

### 2.1 Définitions et formules

| Métrique | Unité | Source capteur | Usage |
|---|---|---|---|
| **RADSUM_jour** | MJ/m²/jour | Sonde Radiation (W/m²) FarmRoad | Bilan énergétique global |
| **RADSUM_cumul** | MJ/m² depuis plantation | Cumul calculé | Comparaison saisonnière, performance abris |
| **DLI_jour** (Daily Light Integral) | mol/m²/jour | Sonde PAR (µmol/m²/s) FarmRoad | Photosynthèse réelle, cible variétale |
| **DLI_cumul** | mol/m² depuis plantation | Cumul calculé | Suivi potentiel productif |

**Formules d'intégration :**
```
RADSUM_jour (MJ/m²/j) = ∫ Radiation(W/m²) dt sur 24h × 0,0036
                      ≈ Σ (Rad_i + Rad_i+1)/2 × Δt_i  (méthode trapèzes)
                      ÷ 1 000 000  (conversion W·s → MJ)

DLI_jour (mol/m²/j)  = ∫ PAR(µmol/m²/s) dt sur 24h × 10⁻⁶
                      ≈ Σ (PAR_i + PAR_i+1)/2 × Δt_i
                      ÷ 1 000 000  (conversion µmol → mol)
```

### 2.2 Conversion entre PAR et Radiation totale

Si une sonde manque (PAR seul ou Radiation seule), on peut estimer l'autre :
- **Ratio standard** PAR / Radiation totale ≈ **0,46** (sous lumière solaire naturelle, pondéré par filtre toile abri si applicable)
- **Conversion W/m² PAR ↔ µmol/m²/s** : 1 W/m² PAR ≈ 4,57 µmol/m²/s
- Donc : `Radiation_totale (W/m²) ≈ PAR (µmol/m²/s) / 4,57 / 0,46`

Ce ratio est **paramétrable par parcelle** (`phenology.parToRadiationRatio`) car il varie selon le matériau de couverture (polyéthylène, polycarbonate, voile d'ombrage).

### 2.3 Sources de données

| Source | Priorité | Notes |
|---|---|---|
| Station FarmRoad assignée à la parcelle (selon shelter type) | 1 | Mesure réelle, idéal |
| Station FarmRoad du même type d'abri (proxy) | 2 | Si station propre HS |
| Meteoblue API (radiation horaire) | 3 (fallback) | Estimation extérieure, pondérée par `coverTransmissionPct` du shelter |

### 2.4 Pas d'échantillonnage et qualité

- **Pas standard FarmRoad** : 5 minutes (288 samples/jour attendus)
- **Qualité "good"** : ≥ 240 samples sur la journée (>83 % couverture)
- **Qualité "partial"** : 120-240 samples
- **Qualité "interpolated"** : < 120 samples (interpolation Meteoblue ou journée précédente, alerte data quality)

### 2.5 Cibles DLI par stade — primocane (référence Maravilla)

Les cibles DLI sont **identiques** entre primocane et floricane à stade équivalent (S4 ↔ F3, S5 ↔ F4, etc.). Coefficient précocité Jasmin ne s'applique pas au DLI (qui dépend de l'environnement, pas de la variété).

| Stade | DLI cible min | DLI cible max | Critique min | Critique max | Notes |
|---|---|---|---|---|---|
| S0 | 8 | 15 | 5 | 20 | Plant jeune, sensible excès → risque sunburn jeunes feuilles |
| S1 | 10 | 18 | 6 | 25 | |
| S2 | 15 | 22 | 10 | 30 | |
| S3 | 18 | 25 | 12 | 32 | DLI faible → décale initiation florale |
| S4 | 20 | 28 | 15 | 35 | DLI < 15 = risque pollinisation, < 12 = critique fleurs |
| S5 | 20 | 30 | 15 | 38 | Calibre fruits |
| S6 | 22 | 30 | 16 | 40 | Brix, coloration |
| S7 | 22 | 30 | 16 | 40 | DLI > 35 sur 5j = risque sunburn fruits, déployer ombrage |
| S8 | 15 | 25 | 8 | 35 | |

**Tunnel typique au Maroc en pic estival** : DLI peut atteindre 35-45 mol/m²/j → surveillance sunburn S6-S7.

**Canarienne hiver/automne** : DLI peut tomber à 8-12 mol/m²/j → risque ralentissement S3-S4 si conditions persistent.

---

## 3. Type d'abri et stations FarmRoad

Smart Berry distingue plusieurs types d'abris ayant des microclimats significativement différents. Le mapping `parcelle → type abri → station FarmRoad` est de **première classe** dans le schéma.

### 3.1 Types d'abris reconnus V1

| Code | Label | Caractéristiques typiques | Microclimat |
|---|---|---|---|
| `canarienne` | Serre canarienne | Structure légère, ventilation passive forte, hauteur 4-5m, polyéthylène | T° proche extérieur +2/+3°C jour, hygro modérée, CO₂ ambiant |
| `tunnel` | Tunnel maraîcher | Hauteur 3-4m, ventilation passive latérale, polyéthylène | T° marquée +5/+8°C jour, hygro plus élevée, CO₂ confiné |
| `multispan` | Multi-chapelle (V2) | Pour usage futur (fermes plus modernes) | — |
| `open_field` | Plein champ (V2) | Pour cultures hors framboisier (avocatier, agrumes) | — |

### 3.2 Architecture FarmRoad V1 (BGF)

Configuration actuelle BGF : **2 stations** déployées (cf. screenshots utilisateur).

| Station ID | Type | Capteurs disponibles | Parcelles desservies V1 |
|---|---|---|---|
| `farmroad_canarienne_main` | canarienne | T°, hygro, CO₂, PAR, Radiation, point de rosée, VPD, pression, VWC substrat | Toutes parcelles canarienne BGF (Larache, Sidi Yahia, Kénitra) |
| `farmroad_tunnel_main` | tunnel | T°, hygro, CO₂, PAR, Radiation, point de rosée, VPD, pression, VWC substrat | Toutes parcelles tunnel BGF |

**Évolution V2** : architecture multi-stations (1 par bloc/zone) si déploiement de stations FarmRoad supplémentaires.

### 3.3 Règle de mapping parcelle → station

```
1. Lire plot.shelter.type
2. Si plot.sensors.farmroad.stationId est défini explicitement → utiliser celui-là
3. Sinon : chercher dans farmroad_stations la station avec type === plot.shelter.type 
   et associatedPlots contenant le plotId (ou stationDefault === true pour ce type)
4. Si aucune station trouvée → fallback Meteoblue + alerte admin
```

### 3.4 Cas particulier : parcelle changeant d'abri

Si une parcelle change de couverture en cours de cycle (ex. ouverture tunnel au printemps, ajout filets ombrage), créer un événement `shelter_change` et permettre changement de station/coefficient en cours de saison. Tracé dans historique pour audit.

### 3.5 Capteurs FarmRoad utilisés par module

| Module | Capteurs requis | Capteurs optionnels |
|---|---|---|
| **GDD** | Température (T_min, T_max) | — |
| **RADSUM** | Radiation OU PAR (≥ 1) | Les deux pour qualité optimale |
| **DLI** | PAR | Radiation (estimation si PAR absent) |
| **VPD analyzer (V2)** | Température + Humidité (ou VPD direct) | Point de rosée |
| **Risque Botrytis (V2)** | Humidité + Température | Point de rosée, durée hygro > 80 % |
| **CO₂ pilotage (V3)** | CO₂ | — |

---

## 4. Profil variétal et coefficients précocité

| Variété | Origine | Type principal | Précocité | Vigueur | Coefficient GDD | Notes |
|---|---|---|---|---|---|---|
| **Maravilla** | Driscoll's | Primocane (peut être conduite floricane) | Mi-saison (référence) | Élevée | **1,00** | Variété historique, productive, bon calibre, bonne tenue post-récolte |
| **Jasmin** | Driscoll's | Primocane principalement (floricane possible) | Précoce (~8% plus rapide) | Moyenne-élevée | **0,92** | Profil aromatique premium, calibre légèrement inférieur, sensibilité hygro plus marquée |

**Application du coefficient :**
- Tous les seuils GDD de la table de base (Maravilla = référence) sont **multipliés par le coefficient** de la variété
- Exemple Jasmin : floraison primocane à 1100 × 0,92 = 1012 GDD
- Les **paramètres irrigation** (EC, pH, % drainage) restent **identiques** entre variétés Driscoll's
- Les **cibles DLI** restent **identiques** (dépendent de l'environnement, pas de la variété)

---

## 5. Maravilla — Primocane

**Démarrage cumul :** date de plantation
**Coefficient précocité :** 1,00
**Cycle attendu :** 8–12 mois selon date de plantation et conditions

### 5.1 Jalons GDD + irrigation

| Stade | Code | GDD min | GDD max | Jours indic.* | Description agronomique | EC apport (mS/cm) | pH apport | % drainage cible | min | max | Notes irrigation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Reprise / enracinement | **S0** | 0 | 150 | 0 – 15 j | Émission radicelles, pas de croissance aérienne nette | 1,2 – 1,4 | 5,6 – 5,8 | 12 % | 10 % | 15 % | Petits apports très fréquents, éviter saturation. Surveiller T° substrat ≥ 16 °C |
| Croissance végétative initiale | **S1** | 150 | 400 | 15 – 35 j | 5–10 feuilles vraies, élongation cannes | 1,4 – 1,6 | 5,5 – 5,8 | 18 % | 15 % | 20 % | Augmenter progressivement EC. Surveiller couleur feuillage |
| Croissance végétative active | **S2** | 400 | 800 | 35 – 60 j | Cannes 60–100 cm, ramifications latérales | 1,6 – 1,8 | 5,5 – 5,8 | 22 % | 20 % | 25 % | Pic de demande N. Analyse foliaire recommandée fin S2 |
| Initiation florale | **S3** | 800 | 1100 | 60 – 80 j | Différenciation boutons floraux apex | 1,8 – 2,0 | 5,5 – 5,8 | 28 % | 25 % | 30 % | Glissement progressif N → K |
| Floraison | **S4** | 1100 | 1400 | 80 – 100 j | Anthèse, pollinisation (introduire bourdons) | 2,0 – 2,2 | 5,5 – 5,7 | 30 % | 28 % | 33 % | **STADE CRITIQUE.** pH strict, éviter tout stress hydrique. T° max < 30 °C |
| Nouaison / grossissement | **S5** | 1400 | 1700 | 100 – 120 j | Fruits verts, calibre en formation | 2,0 – 2,2 | 5,5 – 5,8 | 32 % | 30 % | 35 % | K↑, Ca soutenu |
| Véraison / maturation | **S6** | 1700 | 2000 | 120 – 140 j | Fruits rouges, début cueille | 2,2 – 2,4 | 5,5 – 5,8 | 37 % | 35 % | 40 % | Ratio K/N élevé pour Brix |
| Pleine récolte | **S7** | 2000 | 3500 | 140 – 220 j | Récolte continue (vagues successives primocane) | 2,2 – 2,4 | 5,5 – 5,8 | 40 % | 35 % | 45 % | Pilotage Brix, surveiller EC drainage |
| Fin de cycle | **S8** | 3500 | 9999 | > 220 j | Réduction floraison, sénescence | 1,6 – 1,8 | 5,6 – 5,8 | 22 % | 20 % | 25 % | Sevrage progressif |

*Jours indicatifs basés sur plantation mars-avril en serre/tunnel chauffé Larache/Sidi Yahia. Variabilité ±20 j selon conditions et type d'abri.*

### 5.2 Jalons DLI / RADSUM par stade (mêmes pour primocane et floricane équivalents)

| Stade | DLI cible min (mol/m²/j) | DLI cible max | DLI critique min | DLI critique max | Action si hors cible |
|---|---|---|---|---|---|
| S0 | 8 | 15 | 5 | 20 | Si > 20 → ombrage jeunes plants. Si < 5 → vérifier toile/saison |
| S1 | 10 | 18 | 6 | 25 | |
| S2 | 15 | 22 | 10 | 30 | Si < 10 → diagnostic propreté toile, orientation |
| S3 | 18 | 25 | 12 | 32 | Si < 12 → décalage initiation florale probable |
| S4 | 20 | 28 | 15 | 35 | DLI < 15 = risque pollinisation faible. > 35 = stress radiatif |
| S5 | 20 | 30 | 15 | 38 | Influence calibre fruits |
| S6 | 22 | 30 | 16 | 40 | Influence Brix, coloration |
| S7 | 22 | 30 | 16 | 40 | DLI > 35 sur 5j consécutifs → risque sunburn, ombrage 30 % |
| S8 | 15 | 25 | 8 | 35 | |

**Indicateur transversal — Saturation DLI cumulé :**
- Cumul DLI du jour de plantation à fin S7 attendu Maravilla primocane : **3500 – 4500 mol/m²** (selon saison et abri)
- Si cumul < 3000 mol/m² fin S7 → bilan radiatif insuffisant, performance probable -10/-20 %

---

## 6. Maravilla — Floricane

**Démarrage cumul :** date de débourrement post-taille hivernale (déclenché après accumulation chilling > 200–400 h < 7 °C)
**Coefficient précocité :** 1,00
**Cycle attendu :** 4–6 mois (récolte plus concentrée que primocane)

### 6.1 Jalons GDD + irrigation

| Stade | Code | GDD min | GDD max | Jours indic. | Description | EC apport | pH apport | % drainage cible | min | max |
|---|---|---|---|---|---|---|---|---|---|---|
| Débourrement | **F0** | 0 | 150 | 0 – 12 j | Gonflement et éclatement bourgeons | 1,2 – 1,4 | 5,6 – 5,8 | 12 % | 10 % | 15 % |
| Croissance latérale | **F1** | 150 | 450 | 12 – 35 j | Élongation pousses florifères | 1,6 – 1,8 | 5,5 – 5,8 | 22 % | 20 % | 25 % |
| Boutons floraux visibles | **F2** | 450 | 700 | 35 – 50 j | Boutons groupés puis séparés | 1,8 – 2,0 | 5,5 – 5,8 | 28 % | 25 % | 30 % |
| Floraison | **F3** | 700 | 1000 | 50 – 70 j | Anthèse, pollinisation | 2,0 – 2,2 | 5,5 – 5,7 | 30 % | 28 % | 33 % |
| Nouaison / grossissement | **F4** | 1000 | 1300 | 70 – 90 j | Fruits verts | 2,0 – 2,2 | 5,5 – 5,8 | 32 % | 30 % | 35 % |
| Véraison / maturation | **F5** | 1300 | 1600 | 90 – 110 j | Premières cueilles | 2,2 – 2,4 | 5,5 – 5,8 | 37 % | 35 % | 40 % |
| Pleine récolte | **F6** | 1600 | 2400 | 110 – 160 j | Récolte concentrée (4–8 sem) | 2,2 – 2,4 | 5,5 – 5,8 | 40 % | 35 % | 45 % |
| Fin de récolte | **F7** | 2400 | 9999 | > 160 j | Sénescence floricane, transition vers gestion primocane suivante | 1,6 – 1,8 | 5,6 – 5,8 | 22 % | 20 % | 25 % |

### 6.2 Jalons DLI floricane

| Stade floricane | Équivalent primocane | DLI cible (cf. section 5.2) |
|---|---|---|
| F0 | S0 + spécifique | 8 – 15 |
| F1 | S1 + S2 | 12 – 22 |
| F2 | S3 | 18 – 25 |
| F3 | S4 | 20 – 28 |
| F4 | S5 | 20 – 30 |
| F5 | S6 | 22 – 30 |
| F6 | S7 | 22 – 30 |
| F7 | S8 | 15 – 25 |

---

## 7. Jasmin — Primocane

**Démarrage cumul :** date de plantation
**Coefficient précocité :** 0,92 (8 % plus précoce que Maravilla)
**Cycle attendu :** 7–11 mois

| Stade | Code | GDD min | GDD max | Jours indic. | EC apport | pH apport | % drainage cible | min | max |
|---|---|---|---|---|---|---|---|---|---|
| Reprise | **S0** | 0 | 138 | 0 – 14 j | 1,2 – 1,4 | 5,6 – 5,8 | 12 % | 10 % | 15 % |
| Croissance initiale | **S1** | 138 | 368 | 14 – 32 j | 1,4 – 1,6 | 5,5 – 5,8 | 18 % | 15 % | 20 % |
| Croissance active | **S2** | 368 | 736 | 32 – 55 j | 1,6 – 1,8 | 5,5 – 5,8 | 22 % | 20 % | 25 % |
| Initiation florale | **S3** | 736 | 1012 | 55 – 73 j | 1,8 – 2,0 | 5,5 – 5,8 | 28 % | 25 % | 30 % |
| Floraison | **S4** | 1012 | 1288 | 73 – 92 j | 2,0 – 2,2 | 5,5 – 5,7 | 30 % | 28 % | 33 % |
| Nouaison | **S5** | 1288 | 1564 | 92 – 110 j | 2,0 – 2,2 | 5,5 – 5,8 | 32 % | 30 % | 35 % |
| Véraison | **S6** | 1564 | 1840 | 110 – 128 j | 2,2 – 2,4 | 5,5 – 5,8 | 37 % | 35 % | 40 % |
| Pleine récolte | **S7** | 1840 | 3220 | 128 – 200 j | 2,2 – 2,4 | 5,5 – 5,8 | 40 % | 35 % | 45 % |
| Fin de cycle | **S8** | 3220 | 9999 | > 200 j | 1,6 – 1,8 | 5,6 – 5,8 | 22 % | 20 % | 25 % |

**Cibles DLI Jasmin** : identiques à Maravilla (cf. section 5.2). Le coefficient précocité ne s'applique qu'au GDD.

**Notes spécifiques Jasmin :**
- Plus sensible à l'**hygrométrie élevée** que Maravilla → surveiller Botrytis dès S5
- **Brix cible plus élevé** en S7 : > 10 °Brix (vs 9,5 Maravilla)
- Calibre légèrement inférieur, mais qualité aromatique premium → gestion qualité prioritaire sur volume

---

## 8. Jasmin — Floricane

**Démarrage cumul :** date de débourrement post-taille
**Coefficient précocité :** 0,92

| Stade | Code | GDD min | GDD max | Jours indic. | EC apport | pH apport | % drainage cible | min | max |
|---|---|---|---|---|---|---|---|---|---|
| Débourrement | **F0** | 0 | 138 | 0 – 11 j | 1,2 – 1,4 | 5,6 – 5,8 | 12 % | 10 % | 15 % |
| Croissance latérale | **F1** | 138 | 414 | 11 – 32 j | 1,6 – 1,8 | 5,5 – 5,8 | 22 % | 20 % | 25 % |
| Boutons floraux | **F2** | 414 | 644 | 32 – 46 j | 1,8 – 2,0 | 5,5 – 5,8 | 28 % | 25 % | 30 % |
| Floraison | **F3** | 644 | 920 | 46 – 64 j | 2,0 – 2,2 | 5,5 – 5,7 | 30 % | 28 % | 33 % |
| Nouaison | **F4** | 920 | 1196 | 64 – 83 j | 2,0 – 2,2 | 5,5 – 5,8 | 32 % | 30 % | 35 % |
| Véraison | **F5** | 1196 | 1472 | 83 – 101 j | 2,2 – 2,4 | 5,5 – 5,8 | 37 % | 35 % | 40 % |
| Pleine récolte | **F6** | 1472 | 2208 | 101 – 147 j | 2,2 – 2,4 | 5,5 – 5,8 | 40 % | 35 % | 45 % |
| Fin de récolte | **F7** | 2208 | 9999 | > 147 j | 1,6 – 1,8 | 5,6 – 5,8 | 22 % | 20 % | 25 % |

---

## 9. Coefficients d'ajustement contextuels (V2)

Modificateurs activables/désactivables par parcelle dans l'admin Smart Berry. À implémenter en V2 du moteur, après calibration saison 1.

| Facteur | Effet physiologique | Ajustement modèle |
|---|---|---|
| **Stress hydrique cumulé** (jours où ETP non couverte par irrigation) | Ralentit développement | +5 % au seuil GDD du stade suivant par 3 jours de stress consécutifs |
| **Charge en fruits élevée** (primocane vague 2+) | Décale initiation florale suivante | +10 % seuil S3 vague suivante |
| **Photopériode courte** (< 12h, automne) | Ralentit développement primocane | +15 % seuils S3-S4 |
| **T° substrat froide en S0-S1** (< 14 °C) | Ralentit reprise et enracinement | +20 % seuils S0, S1 |
| **Stress thermique** (T_max > 32 °C, > 5 jours) | Avortement floral, risque coup soleil fruits | Reset partiel S4 (à observer cas par cas) |
| **Hygrométrie chronique > 80%** | Risque Botrytis, ralentit transpiration | Pas d'effet phénologique direct, mais augmente vigilance phyto |
| **Déficit DLI cumulé** (DLI cumul < 70 % cible stade) | Ralentit développement, baisse potentiel | +10 % seuil GDD stade suivant si déficit > 14 j consécutifs |

**Implémentation :**
- Champ `phenology.contextModifiers` dans le doc plot
- Toggle par modificateur (booléen)
- Calcul d'ajustement appliqué dans `stageResolver` après détermination du stade brut

---

## 10. Règles de calibration

### Protocole minimum saison 1

**Observations terrain hebdomadaires :**
- Sur 10 plants représentatifs / parcelle (sélection aléatoire stratifiée par secteur)
- Notation date d'entrée dans chaque stade (S0–S8 ou F0–F7)
- Photos d'illustration (apex, fruits, état général)
- Saisie via PWA Smart Berry ou bot WhatsApp

**Comparaison auto GDD/DLI prédit vs observé :**
- Tableau de bord d'écart par parcelle, par stade
- Visualisation graphique : courbe GDD cumul + DLI cumul + jalons théoriques + observations réelles
- Distinction Canarienne vs Tunnel pour identifier biais systématique par type d'abri

**Ajustement automatique du coefficient précocité :**
- Si écart systématique > 10 % sur 3 transitions consécutives observées
- Système propose nouveau coefficient (admin valide ou rejette)
- Historique des ajustements conservé pour audit

### Seuils d'alerte écart prédit vs observé

| Écart en GDD | Alerte | Action |
|---|---|---|
| < 100 GDD | Normal | Aucune |
| 100 – 200 GDD | Yellow | Vérifier observations, source température, station FarmRoad |
| > 200 GDD | Red | Recalibrer modèle (coefficient précocité ou seuils custom) |

### Calibration spécifique RADSUM/DLI

- Vérifier cohérence DLI mesuré vs DLI théorique extérieur (NASA POWER, Meteoblue)
- Si DLI mesuré < 50 % théorique extérieur sur shelter type donné → vérifier propreté sondes, position, ombrages
- Calibration ratio `parToRadiationRatio` par type d'abri en saison 1 (mesure simultanée PAR + Radiation pendant 30 j ensoleillés)

### Fréquence recalibration

- **Saison 1** : ajustement continu si nécessaire (modèle en construction)
- **Saison 2+** : recalibration en fin de saison sur historique complet
- **Major release variété** : si nouvelle variété ou changement source plants → calibration dédiée

---

## 11. Format JSON pour seed Firestore

### 11.1 Document `phenology_references/maravilla_primocane`

```json
{
  "varietyId": "maravilla",
  "cycleType": "primocane",
  "displayName": "Maravilla — Primocane",
  "tBase": 5,
  "tCap": 30,
  "precocityCoefficient": 1.00,
  "stages": [
    {
      "code": "S0",
      "name": "Reprise / enracinement",
      "gddMin": 0,
      "gddMax": 150,
      "estimatedDays": { "min": 0, "max": 15 },
      "irrigation": {
        "ec_min": 1.2, "ec_max": 1.4,
        "ph_min": 5.6, "ph_max": 5.8,
        "drainage_pct_target": 12, "drainage_pct_min": 10, "drainage_pct_max": 15
      },
      "dli": {
        "target_min": 8, "target_max": 15,
        "critical_min": 5, "critical_max": 20,
        "unit": "mol/m²/j"
      },
      "notes": "Petits apports très fréquents, éviter saturation. Surveiller T° substrat ≥ 16 °C"
    },
    {
      "code": "S1",
      "name": "Croissance végétative initiale",
      "gddMin": 150, "gddMax": 400,
      "estimatedDays": { "min": 15, "max": 35 },
      "irrigation": {
        "ec_min": 1.4, "ec_max": 1.6,
        "ph_min": 5.5, "ph_max": 5.8,
        "drainage_pct_target": 18, "drainage_pct_min": 15, "drainage_pct_max": 20
      },
      "dli": {
        "target_min": 10, "target_max": 18,
        "critical_min": 6, "critical_max": 25,
        "unit": "mol/m²/j"
      },
      "notes": "Augmenter progressivement EC. Surveiller couleur feuillage"
    },
    {
      "code": "S2",
      "name": "Croissance végétative active",
      "gddMin": 400, "gddMax": 800,
      "estimatedDays": { "min": 35, "max": 60 },
      "irrigation": {
        "ec_min": 1.6, "ec_max": 1.8,
        "ph_min": 5.5, "ph_max": 5.8,
        "drainage_pct_target": 22, "drainage_pct_min": 20, "drainage_pct_max": 25
      },
      "dli": {
        "target_min": 15, "target_max": 22,
        "critical_min": 10, "critical_max": 30,
        "unit": "mol/m²/j"
      },
      "notes": "Pic de demande N. Analyse foliaire recommandée fin S2"
    },
    {
      "code": "S3",
      "name": "Initiation florale",
      "gddMin": 800, "gddMax": 1100,
      "estimatedDays": { "min": 60, "max": 80 },
      "irrigation": {
        "ec_min": 1.8, "ec_max": 2.0,
        "ph_min": 5.5, "ph_max": 5.8,
        "drainage_pct_target": 28, "drainage_pct_min": 25, "drainage_pct_max": 30
      },
      "dli": {
        "target_min": 18, "target_max": 25,
        "critical_min": 12, "critical_max": 32,
        "unit": "mol/m²/j"
      },
      "notes": "Glissement progressif N → K"
    },
    {
      "code": "S4",
      "name": "Floraison",
      "gddMin": 1100, "gddMax": 1400,
      "estimatedDays": { "min": 80, "max": 100 },
      "irrigation": {
        "ec_min": 2.0, "ec_max": 2.2,
        "ph_min": 5.5, "ph_max": 5.7,
        "drainage_pct_target": 30, "drainage_pct_min": 28, "drainage_pct_max": 33
      },
      "dli": {
        "target_min": 20, "target_max": 28,
        "critical_min": 15, "critical_max": 35,
        "unit": "mol/m²/j"
      },
      "notes": "STADE CRITIQUE. pH strict, éviter tout stress hydrique. T° max < 30 °C",
      "criticalStage": true
    },
    {
      "code": "S5",
      "name": "Nouaison / grossissement",
      "gddMin": 1400, "gddMax": 1700,
      "estimatedDays": { "min": 100, "max": 120 },
      "irrigation": {
        "ec_min": 2.0, "ec_max": 2.2,
        "ph_min": 5.5, "ph_max": 5.8,
        "drainage_pct_target": 32, "drainage_pct_min": 30, "drainage_pct_max": 35
      },
      "dli": {
        "target_min": 20, "target_max": 30,
        "critical_min": 15, "critical_max": 38,
        "unit": "mol/m²/j"
      },
      "notes": "K↑, Ca soutenu. Surveiller apex (tip burn = carence Ca induite)"
    },
    {
      "code": "S6",
      "name": "Véraison / maturation",
      "gddMin": 1700, "gddMax": 2000,
      "estimatedDays": { "min": 120, "max": 140 },
      "irrigation": {
        "ec_min": 2.2, "ec_max": 2.4,
        "ph_min": 5.5, "ph_max": 5.8,
        "drainage_pct_target": 37, "drainage_pct_min": 35, "drainage_pct_max": 40
      },
      "dli": {
        "target_min": 22, "target_max": 30,
        "critical_min": 16, "critical_max": 40,
        "unit": "mol/m²/j"
      },
      "notes": "Ratio K/N élevé pour Brix. Premier suivi qualité (Brix > 9)"
    },
    {
      "code": "S7",
      "name": "Pleine récolte",
      "gddMin": 2000, "gddMax": 3500,
      "estimatedDays": { "min": 140, "max": 220 },
      "irrigation": {
        "ec_min": 2.2, "ec_max": 2.4,
        "ph_min": 5.5, "ph_max": 5.8,
        "drainage_pct_target": 40, "drainage_pct_min": 35, "drainage_pct_max": 45
      },
      "dli": {
        "target_min": 22, "target_max": 30,
        "critical_min": 16, "critical_max": 40,
        "unit": "mol/m²/j"
      },
      "notes": "Pilotage Brix, surveiller EC drainage. Lessivage actif. DLI > 35 sur 5j → ombrage"
    },
    {
      "code": "S8",
      "name": "Fin de cycle",
      "gddMin": 3500, "gddMax": 9999,
      "estimatedDays": { "min": 220, "max": null },
      "irrigation": {
        "ec_min": 1.6, "ec_max": 1.8,
        "ph_min": 5.6, "ph_max": 5.8,
        "drainage_pct_target": 22, "drainage_pct_min": 20, "drainage_pct_max": 25
      },
      "dli": {
        "target_min": 15, "target_max": 25,
        "critical_min": 8, "critical_max": 35,
        "unit": "mol/m²/j"
      },
      "notes": "Sevrage progressif. Préparer arrachage ou conservation"
    }
  ],
  "metadata": {
    "version": "1.1.0",
    "lastUpdated": "2026-05-03",
    "source": "Smart Berry agronomic team + literature (Carew, Privé, Sonsteby)",
    "calibrationStatus": "initial_baseline_to_calibrate"
  }
}
```

### 11.2 Documents à créer dans `phenology_references`

4 documents :
- `maravilla_primocane` (cf. exemple ci-dessus)
- `maravilla_floricane` (8 stades F0-F7, mêmes structures, valeurs section 6)
- `jasmin_primocane` (coefficient 0.92, valeurs section 7)
- `jasmin_floricane` (coefficient 0.92, valeurs section 8)

### 11.3 Document `farmroad_stations/{stationId}` — exemple BGF

```json
{
  "stationId": "farmroad_canarienne_main",
  "displayName": "Canarienne — Station principale BGF",
  "type": "canarienne",
  "location": {
    "latitude": 35.1825,
    "longitude": -6.1542,
    "description": "Centre canarienne BGF Sidi Yahia"
  },
  "apiEndpoint": "https://api.farmroad.com/stations/cana_main/data",
  "apiAuth": { "method": "bearer_token", "secretRef": "FARMROAD_API_KEY" },
  "capabilities": [
    "temperature", "humidity", "co2", "par", "radiation",
    "vpd", "dewpoint", "pressure", "substrate_vwc"
  ],
  "samplingIntervalMinutes": 5,
  "isDefaultForType": true,
  "associatedPlots": [],
  "status": "active",
  "lastDataReceived": null,
  "installDate": "2025-01-15",
  "metadata": {
    "version": "1.0.0",
    "notes": "Station unique pour toutes parcelles canarienne BGF en V1"
  }
}
```

Idem pour `farmroad_tunnel_main` (type tunnel).

### 11.4 Plot étendu — exemple

```json
{
  "name": "SY-A12",
  "area_ha": 0.8,
  "shelter": {
    "type": "tunnel",
    "structure": {
      "orientation": "N-S",
      "ventilationType": "passive",
      "coverMaterial": "polyethylene",
      "coverTransmissionPct": 70,
      "heightM": 3.5,
      "installDate": "2024-09-01"
    }
  },
  "sensors": {
    "farmroad": {
      "stationId": "farmroad_tunnel_main",
      "stationType": "tunnel",
      "lastSync": null
    },
    "aladinn": {
      "sensorIds": ["aladinn_substrat_a12", "aladinn_drainage_a12"]
    }
  },
  "phenology": {
    "enabled": true,
    "variety": "maravilla",
    "cycleType": "primocane",
    "plantingDate": "2026-03-29T00:00:00Z",
    "temperatureSource": {
      "primary": "farmroad",
      "stationId": "farmroad_tunnel_main",
      "fallback": "meteoblue"
    },
    "radiationSource": {
      "primary": "farmroad",
      "stationId": "farmroad_tunnel_main",
      "sensor": "radiation",
      "fallback": "meteoblue"
    },
    "tBase": 5,
    "tCap": 30,
    "radsumEnabled": true,
    "dliEnabled": true,
    "parToRadiationRatio": 0.46,
    "currentStage": "S2",
    "gddCumul": 489.45,
    "gddDayLast": 15.8,
    "radsumCumul": 0,
    "radsumDayLast": 0,
    "dliCumul": 0,
    "dliDayLast": 0,
    "daysInStage": 35,
    "lastCalculation": null,
    "precocityCoefficient": 1.00,
    "customStageThresholds": null,
    "contextModifiers": {
      "hydricStressEnabled": false,
      "photoperiodEnabled": false,
      "heatStressEnabled": false,
      "dliDeficitEnabled": false
    }
  }
}
```

---

## Changelog

- **v1.0.0** (2026-05-03) : Création initiale, baseline pour saison 1.
- **v1.1.0** (2026-05-03) : Ajout shelter type (Canarienne/Tunnel), mapping FarmRoad station, RADSUM, DLI, cibles DLI par stade, schéma plot étendu.
