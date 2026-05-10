# Taxonomie phytosanitaire — Smart Berry

> **Document de référence agronomique** — taxonomie complète des observations phytosanitaires reconnues par le module surveillance Smart Berry (web + WhatsApp bot).
> Source de vérité pour la collection Firestore `phyto_taxonomy`.
> Adapté au contexte framboisier hors-sol méditerranéen (Larache, Sidi Yahia, Kénitra), partenariat Driscoll's.

## Sommaire

1. [Principes directeurs](#1-principes-directeurs)
2. [Structure du document](#2-structure-du-document)
3. [Catégorie : Maladies (disease)](#3-catégorie--maladies-disease)
4. [Catégorie : Ravageurs (pest)](#4-catégorie--ravageurs-pest)
5. [Catégorie : Carences (deficiency)](#5-catégorie--carences-deficiency)
6. [Catégorie : Stress (stress)](#6-catégorie--stress-stress)
7. [Catégorie : Autre (other)](#7-catégorie--autre-other)
8. [Règles de notification automatique](#8-règles-de-notification-automatique)
9. [Format JSON pour seed Firestore](#9-format-json-pour-seed-firestore)

---

## 1. Principes directeurs

**Principe 1 — Conformité Driscoll's**
Tous les traitements listés respectent les listes positives Driscoll's. Aucune molécule non autorisée n'est suggérée par le système. Liste à mettre à jour à chaque révision Driscoll's (annuelle).

**Principe 2 — Hiérarchie diagnostique**
Catégorie > Type > Sous-type. Permet une saisie rapide sans expertise pointue, puis affinement.

**Principe 3 — Multi-langue**
Chaque entrée a labels FR (référence), AR (Darija accessible), EN (technicien Driscoll's).

**Principe 4 — Photos illustratives**
Chaque type doit avoir 2-3 photos de référence stockées dans Firebase Storage pour aide à l'identification (pas inclus dans ce doc, à constituer côté admin web).

**Principe 5 — IA Vision compatible (V2)**
La taxonomie est structurée pour permettre à Claude Vision (V2) de proposer un diagnostic en sélectionnant un type existant.

---

## 2. Structure du document

Chaque type d'observation contient :

- `code` — identifiant unique (snake_case)
- `label_fr`, `label_ar`, `label_en`, `scientific_name`
- `category` — disease | pest | deficiency | stress | other
- `subcategory` — fungal | bacterial | viral | insect | mite | mollusk | macronutrient | micronutrient | abiotic | etc.
- `affected_organs` — fruit, leaf, cane, root, flower, all
- `typical_symptoms` — liste des symptômes diagnostiques
- `differential_diagnoses` — pathologies à différencier
- `typical_stages_affected` — stades phénologiques à risque
- `favorable_conditions` — climat/conditions favorables
- `intervention_thresholds` — seuils d'intervention si applicable
- `prevention_measures` — mesures préventives
- `driscolls_authorized_treatments` — traitements autorisés (avec DAR)
- `notification_severity` — règles de notification
- `economic_impact` — bas/moyen/élevé
- `notes` — notes contextuelles

---

## 3. Catégorie : Maladies (disease)

### 3.1 Maladies fongiques sur fruits

#### Botrytis cinerea (pourriture grise)

| Champ | Valeur |
|---|---|
| **code** | `botrytis_cinerea` |
| **label_fr** | Botrytis (pourriture grise) |
| **label_ar** | البوتريتيس (العفن الرمادي) |
| **label_en** | Gray mold (Botrytis) |
| **scientific_name** | Botrytis cinerea |
| **category** | disease |
| **subcategory** | fungal |
| **affected_organs** | fruit, flower, leaf (rare) |
| **typical_symptoms** | Mycélium gris-brun sur fruits ; pourriture molle ; sporulation poudreuse ; brunissement périanthe ; momies sèches |
| **differential_diagnoses** | Pourriture acide ; Cladosporium ; Rhizopus |
| **typical_stages_affected** | S4, S5, S6, S7 (floraison à récolte) |
| **favorable_conditions** | Hygrométrie > 85 %, T° 15-25 °C, fruits abîmés/mûrs, mauvaise aération, densité plantation forte |
| **intervention_thresholds** | Tout foyer détecté = action |
| **prevention_measures** | Aération maximale, contrôle hygrométrie < 80 %, effeuillage sanitaire, retrait fruits surmûris, espacement plants, arrosage tôt le matin |
| **driscolls_authorized_treatments** | Bacillus subtilis QST 713 (Serenade), Bacillus amyloliquefaciens, Aureobasidium pullulans (Boni-Protect) — biocontrôle priorité ; chimique en dernier recours selon liste Driscoll's en vigueur |
| **notification_severity** | localized → manager + chef culture ; diffuse+ → + Driscoll's référent |
| **economic_impact** | Élevé (déclassement, baisse rendement, qualité shelf-life) |
| **notes** | Maladie n°1 framboisier hors-sol. Inspection systématique en S5+ par hygro > 80 % > 6h. Couplage avec données sondes hygro = alerte préventive forte |

#### Pourriture acide (Acetobacter / levures)

| Champ | Valeur |
|---|---|
| **code** | `acid_rot` |
| **label_fr** | Pourriture acide |
| **label_ar** | العفن الحامض |
| **label_en** | Acid rot |
| **scientific_name** | Acetobacter spp. + levures |
| **category** | disease |
| **subcategory** | bacterial / yeast |
| **affected_organs** | fruit |
| **typical_symptoms** | Suintement fruit, odeur vinaigre/fermentation, attractif drosophiles, fruit liquéfié sans mycélium visible |
| **differential_diagnoses** | Botrytis (avec mycélium) ; dégâts insectes |
| **typical_stages_affected** | S6, S7 |
| **favorable_conditions** | Fruits surmûris, blessures (drosophiles, oiseaux), T° élevée |
| **prevention_measures** | Cueille fréquente, gestion drosophiles, hygiène parcelle |
| **driscolls_authorized_treatments** | Pas de traitement curatif, gestion préventive uniquement |
| **economic_impact** | Moyen-élevé en pic chaleur |

#### Anthracnose

| Champ | Valeur |
|---|---|
| **code** | `anthracnose` |
| **label_fr** | Anthracnose |
| **label_ar** | الأنثراكنوز |
| **label_en** | Anthracnose |
| **scientific_name** | Colletotrichum spp. |
| **category** | disease |
| **subcategory** | fungal |
| **affected_organs** | fruit, cane |
| **typical_symptoms** | Taches noires/brun foncé sur fruit (souvent autour pédoncule), fruits durcis/momifiés ; lésions chancreuses sur cannes |
| **typical_stages_affected** | S5, S6, S7 |
| **favorable_conditions** | Pluie/aspersion + T° 20-28°C, blessures |
| **prevention_measures** | Éviter aspersion foliaire, taille sanitaire cannes infectées, désinfection sécateurs |
| **driscolls_authorized_treatments** | Selon liste Driscoll's en vigueur |

### 3.2 Maladies fongiques sur feuillage

#### Oïdium

| Champ | Valeur |
|---|---|
| **code** | `powdery_mildew` |
| **label_fr** | Oïdium |
| **label_ar** | البياض الدقيقي |
| **label_en** | Powdery mildew |
| **scientific_name** | Sphaerotheca macularis (Podosphaera aphanis) |
| **category** | disease |
| **subcategory** | fungal |
| **affected_organs** | leaf, cane, fruit (sévère) |
| **typical_symptoms** | Poudre blanche farineuse sur face supérieure feuilles, feuilles enroulées, jeunes pousses déformées, fruits avec pellicule blanche |
| **typical_stages_affected** | S2, S3, S4, S5, S6 |
| **favorable_conditions** | T° 20-25°C, hygro modérée 50-70 %, faible ventilation, plants vigoureux excès N |
| **prevention_measures** | Aération, équilibre N (pas d'excès), variétés tolérantes |
| **driscolls_authorized_treatments** | Soufre micronisé (sous T° < 28°C), Bacillus pumilus (Sonata), AQ10, lait écrémé 10% ; chimique selon liste Driscoll's |

#### Rouille (Phragmidium rubi-idaei)

| Champ | Valeur |
|---|---|
| **code** | `rust` |
| **label_fr** | Rouille du framboisier |
| **label_ar** | الصدأ |
| **label_en** | Yellow rust |
| **scientific_name** | Phragmidium rubi-idaei |
| **category** | disease |
| **subcategory** | fungal |
| **affected_organs** | leaf |
| **typical_symptoms** | Pustules orangées face inférieure feuilles, taches jaunes face supérieure, défoliation prématurée |
| **typical_stages_affected** | S2 à S7 (favorisée hygro élevée prolongée) |
| **favorable_conditions** | Hygrométrie > 80 %, T° 15-25°C |
| **prevention_measures** | Aération, retrait feuilles infectées, espacement |

#### Septoriose (taches foliaires)

| Champ | Valeur |
|---|---|
| **code** | `septoria` |
| **label_fr** | Septoriose / Taches foliaires |
| **label_ar** | السيبتوريا |
| **label_en** | Septoria leaf spot |
| **scientific_name** | Sphaerulina rubi (= Septoria rubi) |
| **category** | disease |
| **subcategory** | fungal |
| **affected_organs** | leaf |
| **typical_symptoms** | Taches brun-pourpre cernées de blanc/gris, points noirs centraux (pycnides), défoliation si sévère |

#### Tache pourpre (Didymella)

| Champ | Valeur |
|---|---|
| **code** | `purple_blotch` |
| **label_fr** | Tache pourpre / Didymella |
| **label_ar** | البقعة الأرجوانية |
| **label_en** | Purple blotch / Cane blight |
| **scientific_name** | Didymella applanata |
| **category** | disease |
| **subcategory** | fungal |
| **affected_organs** | cane, leaf |
| **typical_symptoms** | Taches violacées sur cannes (entre-nœuds), cannes affaiblies, lésions élargies en bandes |
| **typical_stages_affected** | Tous |

### 3.3 Maladies racinaires

#### Phytophthora (pourriture racinaire/collet)

| Champ | Valeur |
|---|---|
| **code** | `phytophthora` |
| **label_fr** | Phytophthora (pourriture racinaire) |
| **label_ar** | فيتوفتورا |
| **label_en** | Phytophthora root rot |
| **scientific_name** | Phytophthora fragariae var. rubi, P. cactorum |
| **category** | disease |
| **subcategory** | oomycete |
| **affected_organs** | root, crown, cane base |
| **typical_symptoms** | Flétrissement plant entier sans cause visible, racines brunes/noires/molles, brunissement collet, mort plant rapide |
| **differential_diagnoses** | Verticilliose ; stress hydrique sévère ; asphyxie racinaire pure |
| **typical_stages_affected** | Tous, surtout S0-S2 et après stress |
| **favorable_conditions** | Substrat saturé prolongé, drainage insuffisant, eau de recyclage non désinfectée |
| **prevention_measures** | Drainage soigné, jamais de saturation, désinfection eau si recyclage (UV, ozone), substrat propre, sources eau contrôlées |
| **driscolls_authorized_treatments** | Bacillus subtilis, Trichoderma harzianum, Streptomyces lydicus (Actinovate) ; phosphites K selon liste |
| **economic_impact** | Très élevé (mortalité plants définitive) |

#### Verticilliose

| Champ | Valeur |
|---|---|
| **code** | `verticillium` |
| **label_fr** | Verticilliose |
| **label_ar** | الذبول الفيرتيسيلي |
| **label_en** | Verticillium wilt |
| **scientific_name** | Verticillium dahliae, V. albo-atrum |
| **category** | disease |
| **subcategory** | fungal_vascular |
| **affected_organs** | root, vascular system |
| **typical_symptoms** | Flétrissement progressif (souvent unilatéral), jaunissement et chute feuilles base, brunissement vasculaire visible coupe canne |
| **typical_stages_affected** | S2-S7 |

### 3.4 Maladies virales (mention rapide)

| Code | Label | Notes |
|---|---|---|
| `raspberry_bushy_dwarf_virus` | Virus du nanisme buissonnant (RBDV) | Symptômes : fruits crumbly, baisse vigueur. Pas de traitement, prévention par plants certifiés |
| `tomato_ringspot_virus` | Tomato ringspot virus (ToRSV) | Vecteur nématodes, plants déclassés |

---

## 4. Catégorie : Ravageurs (pest)

### 4.1 Insectes ailés

#### Drosophila suzukii

| Champ | Valeur |
|---|---|
| **code** | `drosophila_suzukii` |
| **label_fr** | Drosophila suzukii (mouche des fruits) |
| **label_ar** | ذبابة الفاكهة المنقطة |
| **label_en** | Spotted-wing drosophila |
| **scientific_name** | Drosophila suzukii |
| **category** | pest |
| **subcategory** | insect |
| **affected_organs** | fruit |
| **typical_symptoms** | Fruits piqués (ovipositeur denté), larves blanches dans pulpe (test salin positif), suintement, accélération maturation, présence adultes (mâle avec point sur ailes) |
| **typical_stages_affected** | S6, S7 |
| **favorable_conditions** | T° 20-28°C, hygro élevée, fruits mûrs en cours de cueille |
| **intervention_thresholds** | > 30 adultes/piège/semaine en S6+ → action obligatoire ; > 5 % fruits piqués = critique |
| **prevention_measures** | Piégeage massif (trap densité 1/100 m²), filets anti-insectes, cueille fréquente J+1, élimination fruits déclassés hors parcelle, hygiène parcelle stricte |
| **driscolls_authorized_treatments** | Spinosad, Cyantraniliprole (selon DAR) ; biocontrôle Trichogramma drosophilae ; pièges à phéromones |
| **monitoring_method** | Pièges Droso-Trap ou DroSCa avec attractif (vinaigre cidre + vin), comptage hebdo |
| **economic_impact** | Très élevé (déclassement massif possible, refus expé) |

#### Pucerons

| Champ | Valeur |
|---|---|
| **code** | `aphids` |
| **label_fr** | Pucerons |
| **label_ar** | المن |
| **label_en** | Aphids |
| **scientific_name** | Amphorophora idaei, Aphis idaei, Macrosiphum euphorbiae |
| **category** | pest |
| **subcategory** | insect |
| **affected_organs** | leaf, young shoot, flower |
| **typical_symptoms** | Colonies sur pousses tendres (face inférieure feuilles), miellat collant + fumagine noire, déformation feuilles, fourmis associées, vecteurs viroses |
| **favorable_conditions** | T° 15-25°C, jeunes pousses, excès N |
| **intervention_thresholds** | > 10 colonies/100 plants ou présence d'auxiliaires absente |
| **prevention_measures** | Lâchers auxiliaires (Aphidius colemani, coccinelles), équilibre N |
| **driscolls_authorized_treatments** | Savon noir, huile de neem (Azadirachtin), Aphidius colemani (lâcher), pyrèthre selon DAR |

#### Aleurodes (mouches blanches)

| Champ | Valeur |
|---|---|
| **code** | `whiteflies` |
| **label_fr** | Aleurodes (mouches blanches) |
| **label_ar** | الذبابة البيضاء |
| **label_en** | Whiteflies |
| **scientific_name** | Trialeurodes vaporariorum, Bemisia tabaci |
| **category** | pest |
| **subcategory** | insect |
| **affected_organs** | leaf (face inférieure) |
| **typical_symptoms** | Adultes blancs s'envolent au contact, larves immobiles face inf., miellat + fumagine, nuage blanc visible secousse plant |
| **prevention_measures** | Pièges chromatiques jaunes, Encarsia formosa, Macrolophus pygmaeus |
| **driscolls_authorized_treatments** | Beauveria bassiana, Encarsia formosa (parasitoïde) |

#### Thrips

| Champ | Valeur |
|---|---|
| **code** | `thrips` |
| **label_fr** | Thrips |
| **label_ar** | التريبس |
| **label_en** | Thrips |
| **scientific_name** | Frankliniella occidentalis (thrips californien) |
| **category** | pest |
| **subcategory** | insect |
| **affected_organs** | flower, fruit, leaf |
| **typical_symptoms** | Fleurs déformées, fruits décolorés ou avortés, taches argentées sur feuilles, ponctuations noires excréments |
| **typical_stages_affected** | S4, S5 (impact direct nouaison) |
| **prevention_measures** | Pièges chromatiques bleus, Amblyseius cucumeris, Orius |
| **driscolls_authorized_treatments** | Spinosad, Beauveria bassiana, prédateurs |

#### Cicadelles

| Champ | Valeur |
|---|---|
| **code** | `leafhoppers` |
| **label_fr** | Cicadelles |
| **label_ar** | نطاطات الأوراق |
| **label_en** | Leafhoppers |
| **affected_organs** | leaf |
| **typical_symptoms** | Pâleur ponctuée feuilles, brunissement bordures, chute si sévère |

### 4.2 Acariens

#### Acarien tétranyque (Tetranychus urticae)

| Champ | Valeur |
|---|---|
| **code** | `tetranychus_urticae` |
| **label_fr** | Acarien tétranyque (araignée rouge) |
| **label_ar** | العنكبوت الأحمر |
| **label_en** | Two-spotted spider mite |
| **scientific_name** | Tetranychus urticae |
| **category** | pest |
| **subcategory** | mite |
| **affected_organs** | leaf |
| **typical_symptoms** | Toiles fines face inférieure feuilles, ponctuations jaunes/blanches sur feuilles, défoliation si sévère, plants poussiéreux |
| **favorable_conditions** | T° > 25°C, hygro faible < 50 %, stress hydrique |
| **intervention_thresholds** | > 5 acariens/feuille moyenne (échantillonnage 30 feuilles) ; absence Phytoseiulus = critique |
| **prevention_measures** | Augmenter hygro, brumisation, lâcher Phytoseiulus persimilis dès détection (1-2/m²) |
| **driscolls_authorized_treatments** | Phytoseiulus persimilis (priorité), huile de neem, savon noir, soufre selon liste |
| **economic_impact** | Élevé (défoliation = perte productive) |

#### Acarien jaune (Tetranychus turkestani)

| Champ | Valeur |
|---|---|
| **code** | `tetranychus_turkestani` |
| **label_fr** | Acarien jaune |
| **scientific_name** | Tetranychus turkestani |
| **category** | pest |
| **subcategory** | mite |
| **typical_symptoms** | Similaires tétranyque, jaunissement plus marqué |

#### Tarsonème (Phytonemus pallidus)

| Champ | Valeur |
|---|---|
| **code** | `tarsonemus` |
| **label_fr** | Tarsonème |
| **label_ar** | التارسونيم |
| **label_en** | Cyclamen mite |
| **scientific_name** | Phytonemus pallidus |
| **category** | pest |
| **subcategory** | mite |
| **affected_organs** | apex, young leaves, flower |
| **typical_symptoms** | Déformation jeunes feuilles (frisée, gaufrée), apex bloqués, fleurs avortées, invisible à l'œil nu |
| **driscolls_authorized_treatments** | Amblyseius swirskii, Neoseiulus cucumeris ; chimique selon liste |

### 4.3 Mollusques

#### Limaces et escargots

| Champ | Valeur |
|---|---|
| **code** | `slugs_snails` |
| **label_fr** | Limaces / escargots |
| **label_ar** | البزاقات والقواقع |
| **label_en** | Slugs / snails |
| **category** | pest |
| **subcategory** | mollusk |
| **affected_organs** | leaf, fruit, young shoot |
| **typical_symptoms** | Trous irréguliers feuilles, fruits rongés, traces mucus (brillantes), dégâts nocturnes/matinaux |
| **favorable_conditions** | Humidité élevée, ombrage, débris végétaux |
| **prevention_measures** | Hygiène parcelle (débris), pièges bière, barrières cuivre, gravier |
| **driscolls_authorized_treatments** | Phosphate ferrique (Sluxx, Ferramol), pas de métaldéhyde |

### 4.4 Lépidoptères et autres

#### Chenilles diverses

| Champ | Valeur |
|---|---|
| **code** | `caterpillars` |
| **label_fr** | Chenilles (lépidoptères) |
| **label_ar** | اليرقات |
| **affected_organs** | leaf, fruit, flower |
| **typical_symptoms** | Trous feuilles, fruits attaqués, présence excréments, chenilles visibles |
| **driscolls_authorized_treatments** | Bacillus thuringiensis (Bt), trichogrammes |

#### Charançons

| Champ | Valeur |
|---|---|
| **code** | `weevils` |
| **label_fr** | Charançons |
| **scientific_name** | Otiorhynchus sulcatus (charançon noir) |
| **affected_organs** | root (larves), leaf (adultes) |
| **typical_symptoms** | Encoches semi-circulaires sur feuilles, larves rongent racines, plants flétris |

### 4.5 Auxiliaires (à confirmer, NE PAS éliminer)

#### Coccinelles, syrphes, chrysopes

| Champ | Valeur |
|---|---|
| **code** | `auxiliary_predators` |
| **label_fr** | Auxiliaires prédateurs (coccinelles, syrphes, chrysopes) |
| **label_ar** | الحشرات النافعة |
| **category** | pest (à confirmer) |
| **typical_symptoms** | Présence prédateurs naturels — UTILE, NE PAS ÉLIMINER |
| **action** | Documenter présence, ajuster traitements pour préserver |

---

## 5. Catégorie : Carences (deficiency)

### 5.1 Macronutriments

#### Carence Azote (N)

| Champ | Valeur |
|---|---|
| **code** | `n_deficiency` |
| **label_fr** | Carence Azote (N) |
| **label_ar** | نقص النيتروجين |
| **label_en** | Nitrogen deficiency |
| **category** | deficiency |
| **subcategory** | macronutrient |
| **affected_organs** | leaf (toutes), cane |
| **typical_symptoms** | Jaunissement uniforme, vieilles feuilles d'abord, plant chétif, croissance bloquée, cannes fines |
| **typical_stages_affected** | S1, S2, S3 |
| **causes** | Sous-dosage formule, lessivage excessif, EC apport trop faible |
| **corrective_actions** | Augmenter N solution apport (+0,5 à 1 mmol/L), apport foliaire urée 0,3-0,5 % en relais |

#### Carence Potassium (K)

| Champ | Valeur |
|---|---|
| **code** | `k_deficiency` |
| **label_fr** | Carence Potassium (K) |
| **label_ar** | نقص البوتاسيوم |
| **affected_organs** | leaf (vieilles d'abord) |
| **typical_symptoms** | Brunissement bordure feuilles vieilles (tip burn), feuilles repliées, fruits petits et peu sucrés, faible Brix |
| **typical_stages_affected** | S5, S6, S7 (demande K maximale) |
| **corrective_actions** | Augmenter K (KNO3 ou K2SO4 selon équilibre), apport foliaire K 0,5 % |

#### Carence Phosphore (P)

| Champ | Valeur |
|---|---|
| **code** | `p_deficiency` |
| **label_fr** | Carence Phosphore (P) |
| **label_ar** | نقص الفوسفور |
| **typical_symptoms** | Coloration violacée feuilles (face inférieure), retard de croissance, racines pauvres |
| **causes** | pH trop élevé bloquant P, sous-dosage |

#### Carence Calcium (Ca)

| Champ | Valeur |
|---|---|
| **code** | `ca_deficiency` |
| **label_fr** | Carence Calcium (Ca) |
| **label_ar** | نقص الكالسيوم |
| **affected_organs** | apex, young leaves, fruit |
| **typical_symptoms** | Apex desséché (tip burn), nécrose bord jeunes feuilles, fruits peu fermes, problèmes shelf-life |
| **typical_stages_affected** | S5, S6 (forte demande Ca lors grossissement) |
| **causes** | EC trop élevée, antagonisme K/Ca, stress hydrique transitoire, faible transpiration nocturne, pH élevé |
| **corrective_actions** | Diluer EC apport, équilibrer K/Ca (ratio < 1,5), apport foliaire Ca(NO3)2 0,5% le soir, vérifier hygro nocturne (transpiration) |
| **economic_impact** | Élevé (qualité fruit, shelf-life, déclassement) |

#### Carence Magnésium (Mg)

| Champ | Valeur |
|---|---|
| **code** | `mg_deficiency` |
| **label_fr** | Carence Magnésium (Mg) |
| **label_ar** | نقص المغنيسيوم |
| **affected_organs** | leaf (vieilles d'abord) |
| **typical_symptoms** | Chlorose internervaire (jaunissement entre nervures qui restent vertes), vieilles feuilles d'abord |
| **causes** | Antagonisme K/Mg (excès K), sous-dosage Mg, pH bas |
| **corrective_actions** | Augmenter Mg (MgSO4), foliaire Epsom 1 %, équilibrer K/Mg |

#### Carence Soufre (S)

| Champ | Valeur |
|---|---|
| **code** | `s_deficiency` |
| **label_fr** | Carence Soufre (S) |
| **typical_symptoms** | Jaunissement uniforme jeunes feuilles (différence avec N qui touche vieilles d'abord) |

### 5.2 Micronutriments

#### Carence Fer (Fe)

| Champ | Valeur |
|---|---|
| **code** | `fe_deficiency` |
| **label_fr** | Carence Fer (Fe) — chlorose ferrique |
| **label_ar** | نقص الحديد (الكلوروز الحديدي) |
| **affected_organs** | leaf (jeunes d'abord) |
| **typical_symptoms** | Chlorose internervaire jeunes feuilles, nervures restent vertes, dans cas sévère feuilles entièrement jaunes/blanches |
| **causes** | pH > 6,5 bloquant Fe, excès bicarbonates, excès P, asphyxie racinaire |
| **corrective_actions** | Acidifier (pH cible 5,7), apport Fe chélaté (Fe-EDDHA pour pH > 6,5, Fe-DTPA pour pH < 6,5), foliaire Fe-EDTA 0,1 % |

#### Carence Bore (B)

| Champ | Valeur |
|---|---|
| **code** | `b_deficiency` |
| **label_fr** | Carence Bore (B) |
| **typical_symptoms** | Avortement floral, déformation fruits (fruits "crumbly"), apex craquelés |
| **typical_stages_affected** | S3, S4 (initiation, floraison) |
| **corrective_actions** | Foliaire Solubor 0,1-0,2 %, ajout B solution nutritive |

#### Carence Zinc (Zn)

| Champ | Valeur |
|---|---|
| **code** | `zn_deficiency` |
| **label_fr** | Carence Zinc (Zn) |
| **typical_symptoms** | Petites feuilles (rosettes), entre-nœuds courts, déformation |

#### Carence Manganèse (Mn)

| Champ | Valeur |
|---|---|
| **code** | `mn_deficiency` |
| **label_fr** | Carence Manganèse (Mn) |
| **typical_symptoms** | Chlorose internervaire jeunes feuilles (similaire Fe mais nervures plus larges vertes) |

#### Carence Cuivre (Cu)

| Champ | Valeur |
|---|---|
| **code** | `cu_deficiency` |
| **label_fr** | Carence Cuivre (Cu) |
| **typical_symptoms** | Apex brunis, déformation jeunes pousses |

### 5.3 Toxicités

#### Toxicité chlorures (Cl)

| Champ | Valeur |
|---|---|
| **code** | `cl_toxicity` |
| **label_fr** | Toxicité chlorures (Cl) |
| **affected_organs** | leaf |
| **typical_symptoms** | Brûlure bordure feuilles (tip burn généralisé), pâleur, défoliation |
| **causes** | Eau brute riche en Cl, EC drainage non contrôlée |
| **corrective_actions** | Osmose inverse partielle, drainage forcé, vérifier source eau |

#### Toxicité sodium (Na)

| Champ | Valeur |
|---|---|
| **code** | `na_toxicity` |
| **label_fr** | Toxicité sodium (Na) |
| **typical_symptoms** | Similaires Cl, brûlure bordure, perturbation absorption K et Ca |

#### Brûlure sels (EC excessive)

| Champ | Valeur |
|---|---|
| **code** | `salt_burn` |
| **label_fr** | Brûlure sels (EC excessive) |
| **typical_symptoms** | Brunissement généralisé bordures, plants flétris malgré substrat humide, EC pour-thru > 4 |
| **corrective_actions** | Lessivage urgent (drainage > 50 %), baisser EC apport |

---

## 6. Catégorie : Stress (stress)

### 6.1 Stress hydrique

#### Stress hydrique (manque d'eau)

| Champ | Valeur |
|---|---|
| **code** | `water_stress_deficit` |
| **label_fr** | Stress hydrique (manque d'eau) |
| **label_ar** | الإجهاد المائي |
| **category** | stress |
| **subcategory** | abiotic_water |
| **typical_symptoms** | Flétrissement matinal puis persistant, enroulement feuilles, sénescence vieilles feuilles, avortement fleurs, ramollissement fruits, croissance bloquée |
| **causes** | Panne irrigation, fréquence/durée insuffisante, ETP non couverte, problème goutteurs |
| **corrective_actions** | Augmenter cycles irrigation, vérifier goutteurs, diagnostic ETP vs apport |

#### Asphyxie racinaire (excès d'eau)

| Champ | Valeur |
|---|---|
| **code** | `water_stress_excess` |
| **label_fr** | Asphyxie racinaire (excès d'eau) |
| **label_ar** | اختناق الجذور |
| **typical_symptoms** | Flétrissement malgré substrat saturé, racines brunes/noires, jaunissement, susceptibilité Phytophthora |
| **causes** | Drainage insuffisant, sur-irrigation, substrat compacté, T° substrat froide |
| **corrective_actions** | Réduire fréquence apports, vérifier drainage bacs, augmenter T° substrat |

### 6.2 Stress thermique

#### Stress thermique chaud (canicule)

| Champ | Valeur |
|---|---|
| **code** | `heat_stress` |
| **label_fr** | Stress thermique chaud |
| **label_ar** | الإجهاد الحراري |
| **category** | stress |
| **subcategory** | abiotic_thermal |
| **typical_symptoms** | Flétrissement aux heures chaudes, avortement floral, brûlure feuilles exposées, coup de soleil fruits, arrêt croissance |
| **causes** | T° abri > 32°C, hygro effondrée, ventilation insuffisante |
| **typical_stages_affected** | S4 (très sensible), S5, S6, S7 |
| **corrective_actions** | Brumisation immédiate, ouverture aération maximale, filets ombrage 30 % si récurrent, augmenter fréquence cycles courts diurnes, K + Ca foliaire pour résilience cellulaire |
| **economic_impact** | Très élevé (avortement floral S4 = -15-25 % calibre vague, sunburn = déclassement) |

#### Stress thermique froid / gel

| Champ | Valeur |
|---|---|
| **code** | `cold_stress` |
| **label_fr** | Stress thermique froid / gel |
| **label_ar** | إجهاد البرد / الصقيع |
| **typical_symptoms** | Brunissement feuilles, dégâts gel sur fleurs/jeunes pousses, croissance bloquée |
| **typical_stages_affected** | F0 (débourrement floricane), S0 |
| **corrective_actions** | Chauffage abri, voile thermique, anticipation par météo |

### 6.3 Stress climatique

#### Coup de soleil sur fruits (sunburn)

| Champ | Valeur |
|---|---|
| **code** | `sunburn` |
| **label_fr** | Coup de soleil (sunburn) sur fruits |
| **label_ar** | حروق الشمس |
| **category** | stress |
| **subcategory** | abiotic_radiation |
| **affected_organs** | fruit |
| **typical_symptoms** | Décoloration blanche/brune côté exposé soleil, fermeté altérée, déclassement |
| **typical_stages_affected** | S6, S7 (fruits exposés) |
| **corrective_actions** | Filets ombrage, gestion feuillage couvrant, éviter pic exposition |

#### Dégâts vent

| Champ | Valeur |
|---|---|
| **code** | `wind_damage` |
| **label_fr** | Dégâts vent |
| **typical_symptoms** | Cannes cassées/inclinées, feuilles déchirées, fruits chutés, dessèchement accéléré |
| **corrective_actions** | Brise-vent, palissage renforcé, fermeture côtés tunnels |

#### Dégâts grêle / pluie violente

| Champ | Valeur |
|---|---|
| **code** | `hail_storm_damage` |
| **label_fr** | Dégâts grêle / pluie violente |
| **typical_symptoms** | Trous feuilles caractéristiques, fruits meurtris/tachés, cannes blessées (entrée pathogènes) |
| **corrective_actions** | Inspection plants, retrait fruits abîmés, protection préventive antifongique post-épisode |

---

## 7. Catégorie : Autre (other)

### 7.1 Anomalies qualité non classées

| Code | Label | Description |
|---|---|---|
| `quality_color_abnormal` | Coloration anormale fruits | Fruits pâles, hétérogènes — investigation K, lumière, variétal |
| `quality_calibre_abnormal` | Calibre anormal | Fruits trop petits ou trop gros pour le stade — investigation charge fruits, irrigation |
| `quality_brix_low` | Brix faible | Brix < cible stade — investigation K, irrigation, charge |
| `quality_firmness_low` | Fermeté faible | Fruits mous — investigation Ca, K, EC |
| `quality_shape_abnormal` | Forme anormale | Fruits déformés, crumbly — investigation pollinisation, B, virus |

### 7.2 Variabilité plants suspecte

| Code | Label | Description |
|---|---|---|
| `plant_variability_unexplained` | Variabilité plants inexpliquée | Hétérogénéité parcelle non corrélée à zone/irrigation — possibles problèmes plants/origine |
| `plant_off_type` | Plant hors-type variétal | Plant ne correspondant pas à variété attendue — erreur pépinière |

### 7.3 Anomalies à investiguer

| Code | Label | Description |
|---|---|---|
| `unknown_to_investigate` | Anomalie inconnue à investiguer | Symptôme non identifié, demande avis expert |
| `multiple_symptoms_complex` | Symptômes multiples complexes | Combinaison symptômes nécessitant analyse approfondie |

---

## 8. Règles de notification automatique

### 8.1 Matrice de notification par catégorie × sévérité

| Catégorie | Sévérité observation | Notifie automatiquement |
|---|---|---|
| **disease** | isolated | Chef culture parcelle |
| **disease** | localized | + Chef exploitation |
| **disease** | diffuse / generalized | + Référent Driscoll's, équipe technique URGENT |
| **pest** | sous seuil | Chef culture parcelle |
| **pest** | seuil dépassé (selon `intervention_thresholds`) | + Chef exploitation, responsable récolte |
| **pest** | très élevé / risque récolte | + Référent Driscoll's URGENT |
| **deficiency** | légère | Chef culture parcelle, responsable fertirrigation |
| **deficiency** | modérée | + Chef exploitation |
| **deficiency** | sévère | + Équipe technique URGENT |
| **stress** | modéré | Chef culture parcelle, chef exploitation |
| **stress** | fort | + Équipe technique URGENT |
| **other** | toujours | Selon assignation manuelle dans observation |

### 8.2 Canaux de notification

| Niveau | Canal |
|---|---|
| Info | Notification push web Smart Berry |
| Yellow / standard | Notification WhatsApp (free-form si fenêtre 24h ouverte, sinon template) |
| Red / URGENT | WhatsApp template + email + push web |

### 8.3 Délais d'attente réponse

| Niveau | Délai max attendu | Action si non répondu |
|---|---|---|
| Yellow | 24h | Rappel automatique aux mêmes destinataires |
| Red | 4h | Escalade niveau supérieur (ex: si chef culture ne répond pas → chef exploitation direct) |

---

## 9. Format JSON pour seed Firestore

Structure des documents `phyto_taxonomy/{categoryCode}` :

### Document : `phyto_taxonomy/disease`

```json
{
  "categoryCode": "disease",
  "categoryLabel": "Maladies",
  "categoryLabelAr": "الأمراض",
  "categoryLabelEn": "Diseases",
  "icon": "🦠",
  "types": [
    {
      "code": "botrytis_cinerea",
      "labelFr": "Botrytis (pourriture grise)",
      "labelAr": "البوتريتيس (العفن الرمادي)",
      "labelEn": "Gray mold (Botrytis)",
      "scientificName": "Botrytis cinerea",
      "subcategory": "fungal",
      "affectedOrgans": ["fruit", "flower"],
      "typicalSymptoms": [
        "Mycélium gris-brun sur fruits",
        "Pourriture molle",
        "Sporulation poudreuse",
        "Brunissement périanthe",
        "Momies sèches"
      ],
      "differentialDiagnoses": ["acid_rot", "anthracnose"],
      "typicalStagesAffected": ["S4", "S5", "S6", "S7", "F3", "F4", "F5", "F6"],
      "favorableConditions": {
        "humidity_pct_min": 85,
        "temp_c_min": 15,
        "temp_c_max": 25,
        "other": ["fruits abîmés/mûrs", "mauvaise aération", "densité plantation forte"]
      },
      "interventionThresholds": "Tout foyer détecté = action",
      "preventionMeasures": [
        "Aération maximale",
        "Contrôle hygrométrie < 80%",
        "Effeuillage sanitaire",
        "Retrait fruits surmûris",
        "Espacement plants",
        "Arrosage tôt le matin"
      ],
      "driscollsAuthorizedTreatments": [
        {
          "name": "Bacillus subtilis QST 713 (Serenade)",
          "type": "biocontrol",
          "dosage": "Selon étiquette",
          "darDays": 0,
          "priority": 1
        },
        {
          "name": "Bacillus amyloliquefaciens",
          "type": "biocontrol",
          "darDays": 0,
          "priority": 1
        },
        {
          "name": "Aureobasidium pullulans (Boni-Protect)",
          "type": "biocontrol",
          "darDays": 0,
          "priority": 2
        }
      ],
      "notificationSeverity": {
        "isolated": ["chef_culture"],
        "localized": ["chef_culture", "chef_exploitation"],
        "diffuse": ["chef_culture", "chef_exploitation", "driscolls_referent"],
        "generalized": ["chef_culture", "chef_exploitation", "driscolls_referent", "technical_team_urgent"]
      },
      "economicImpact": "high",
      "notes": "Maladie n°1 framboisier hors-sol. Inspection systématique en S5+ par hygro > 80% > 6h. Couplage avec données sondes hygro = alerte préventive forte"
    }
    // ... autres types
  ],
  "metadata": {
    "version": "1.0.0",
    "lastUpdated": "2026-05-03",
    "source": "Smart Berry agronomic team + Driscoll's authorized lists"
  }
}
```

### Documents à créer (5)

```
phyto_taxonomy/
├── disease           # Section 3
├── pest              # Section 4
├── deficiency        # Section 5
├── stress            # Section 6
└── other             # Section 7
```

---

## Maintenance et mise à jour

- **Mise à jour Driscoll's** : annuelle (revue liste positive traitements)
- **Mise à jour symptômes/diagnostics** : si nouvelle pathologie détectée terrain
- **Photos référence** : à constituer en V1.1 par admin web (banque photos par type)
- **IA Vision (V2)** : entrainement sur photos validées terrain pour amélioration suggestion automatique
- **Versioning** : chaque modification incrémente `metadata.version`, traçable git

---

## Changelog

- **v1.0.0** (2026-05-03) : Création initiale, baseline pour saison 1.
