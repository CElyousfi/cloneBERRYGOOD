# Inventaire des données — `generateMockData` (Phase 3a, production readiness)

> État au 2026-09-14. Un rôle par ligne : chacune des clés retournées par
> `src/modules/shared/generateMockData.jsx` (51 domaines de données ; 2 clés
> supplémentaires, `getCultureForVariete`/`getCoutTransport`, sont des
> fonctions dérivées, pas des données — hors périmètre). Construit par
> investigation directe du code (lecture des écrans, des Cloud Functions, et
> de `generateMockData.jsx` lui-même), pas par supposition. **Conformément à
> la consigne, ceci est livré pour revue avant toute modification de Phase
> 3b — rien n'a encore été câblé.**
>
> Méthode : le drapeau d'inspection `?emptyMockData=1` (ajouté dans
> `generateMockData.jsx`, commit `51261f2`) permet de vérifier ce constat
> écran par écran en le rejouant en conditions réelles.

## À savoir avant de lire le tableau

- **Seuls 4 domaines sur 51 sont aujourd'hui réellement câblés** dans
  `AuthenticatedApp.jsx` : `agroData`, `agroApiStatus`, `weeklyRanking`,
  `transportConfig`. C'est le point de départ énoncé dans le brief, confirmé.
- **`public/app.jsx`** (le monolithe legacy) contient sa **propre copie
  dupliquée** de `generateMockData` et du même bloc de surcharge — pas de
  code partagé. Tout correctif appliqué à la copie modulaire (`src/`) devra
  être répliqué là-bas séparément, sous peine de faire diverger les deux
  frontends.
- **~20 des 51 clés sont mortes** : aucun écran ne lit `data.<clé>`, parce
  que l'écran naturellement consommateur a déjà son **propre fetch live**
  vers une vraie API, sous un nom de variable locale identique qui masque
  `data.<clé>` sans jamais la lire. Câbler `generateMockData` pour ces clés
  n'aurait **aucun effet visible** tant que ce fetch local shadow n'est pas
  aussi retiré — donc pas prioritaire en 3b tant que l'écran fonctionne déjà
  en direct par un autre chemin.
- **Statut `hardcoded` ≠ dangereux en soi** : le brief accepte qu'une
  configuration reste en constante seedée si le client confirme les valeurs
  (primes, parcelles, normes...). Ce qui est dangereux, ce sont les
  **domaines financiers** marqués `hardcoded` ci-dessous **sans aucune
  source réelle trouvée** — ces chiffres ont l'air réels mais sont des
  valeurs figées d'un instantané passé (« Arrêté au 31/12/2025 » en
  commentaire).

## Tableau complet (51 domaines)

| Clé | Écrans (lecture réelle de `data.<clé>`) | Source réelle trouvée ? | Statut | Notes |
|---|---|---|---|---|
| effectif | *aucun* | Oui — `/api/pointage-rh?action=summary` (`sql_mirror_pointage`) | generated | Clé morte : `DashboardTab.jsx` calcule son propre `effectif` depuis un fetch live, masque `data.effectif`. |
| topOps | *aucun* | Oui (même backend pointage, ventilation par opération) | generated | Clé morte, aucun consommateur trouvé. |
| recolteData | EquipesTab.jsx | Oui — `/api/pointage-rh?action=recolte` | generated | Usage réel mais trivial (liste de périodes seulement). |
| recolteParJour | *aucun* | Oui — même `action=recolte` | generated | Clé morte. |
| horsRecolteDetail | *aucun* | Oui — `/api/pointage-rh?action=hors-recolte` | generated | Clé morte : `HorsRecolteTab.jsx` fetch live à la place. |
| pointageJour | EquipesTab.jsx | Oui — `action=summary` | generated | Usage réel mais trivial. Dashboard/PointageTab utilisent leur propre fetch live du même nom. |
| quinzaineData | *aucun* | Oui — `/api/pointage-rh?action=quinzaine` | generated | Clé morte : Dashboard garde son propre state live du même nom. |
| weeklyTrend | *aucun* | Oui — inclus dans `action=summary` | generated | Clé morte, masquée par fetch live homonyme. |
| parcellesMap | *aucun* | Non trouvée | generated | Totalement morte. |
| parcelleDetail | *aucun* | Non trouvée | generated | Totalement morte. |
| equipes | *aucun* | Oui — `/api/pointage-rh?action=recolte-equipes` | generated | Tous les écrans qui semblent l'utiliser (Equipes/Quinzaine/Pointage/Dashboard/Recolte/CoutRecolte/PrimesRecolte) ont en fait leur propre `equipes` live, homonyme. |
| suiviModifs | SuiviTab.jsx | Non trouvée | generated | Seul consommateur réel confirmé. Pas de collection Firestore de journal d'audit identifiée pour ce concept. |
| qualiteInspections | *aucun* | Oui — collection `expeditions` (`/api/email-analysis?action=expeditions`) | hardcoded | Clé morte : `QualiteInspectionsTab.jsx` fetch `expeditions` en direct. Les valeurs de base sont de vrais chiffres Driscoll's recopiés à la main, pas du `Math.random()`. |
| blocIds | ParametresTab.jsx, QualiteBonsApportTab.jsx, QualiteDashboardTab.jsx, QualitePFQInterneTab.jsx | Non trouvée comme collection Firestore | hardcoded | Persisté seulement côté client (`localStorage.blocIdsConfig`), pas de sync serveur. |
| qualiteHistorique | *aucun* | Oui — collection `expeditions` | generated | Clé morte : `QualiteHistoriqueTab.jsx` reconstruit son propre historique depuis `expeditions` live. |
| qualiteBrix | QualiteDashboardTab.jsx | Non — brix brut existe par expédition dans `expeditions`, mais rien n'agrège dans cette forme (par variété, 14 jours) | generated | Usage réel confirmé, lecture directe de `data.qualiteBrix`. |
| pfqHistory | QualiteDashboardTab.jsx | Non — `pqScore`/blocId existent par expédition, pas agrégés dans cette forme | generated | Usage réel confirmé. |
| weeklyRanking | QualiteDashboardTab.jsx | Oui — collection `weekly_quality_reports` | **réel** | Déjà câblé (`AuthenticatedApp.jsx:610-666`). L'un des 4 domaines déjà réels. |
| expeditions | QualiteExpeditionsTab.jsx | Oui — collection `expeditions` | hardcoded | Mock forcé à `[]` (commentaire dans le code : « loaded from Firebase »). L'écran merge déjà les vraies données via un fetch séparé, pas via `AuthenticatedApp`. |
| stockEmballages | *aucun* | Non trouvée sous cette forme (existe un `stock_balances`/`stock_movements` générique côté magasin, pas branché à cette clé) | hardcoded | Clé morte ; les sous-écrans Magasin ne reçoivent même pas de prop `data`. |
| stockIntrants | *aucun* | Non trouvée | hardcoded | Idem — clé morte. |
| parcAuto | MagParcTab.jsx | Non trouvée | hardcoded | Seul consommateur réel. |
| cpcData | *aucun* | Non trouvée | hardcoded | Clé morte. |
| cpcVarietes | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** Instantané figé « au 31/12/2025 ». |
| cpcCharges | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** |
| totalHa | FinDashboardTab.jsx | Non trouvée | hardcoded | Littéral `54.8`. |
| totalCA | *aucun* | n/a — réimplémenté ailleurs en vrai | hardcoded | Clé morte : `FinCATab.jsx`/`FinanceMarcheLocalTab.jsx` calculent déjà leur **propre** `totalCA` réel depuis les liquidations/marché local live — implémentation réelle déjà existante, sous un autre nom de variable. |
| totalCAExport | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** Littéral `3 937 610`. |
| totalCALocal | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** Littéral `142 466`. |
| totalKgExport | FinDashboardTab.jsx | Non trouvée | hardcoded | Littéral `59 451`. |
| totalChargesGlobales | *aucun* | Non trouvée | hardcoded | Clé morte. Littéral `9 684 565`. |
| cfDea | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent** (amortissement). Littéral `1 669 000`. |
| ebeParVariete | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** |
| ebeFramboise | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** Littéral `-1 423 086`. |
| resultatAvantImpot | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** Littéral `-1 671 304`. |
| resultatParMois | FinDashboardTab.jsx | Non trouvée | hardcoded | **Domaine argent.** |
| caDetail | *aucun* | n/a — réimplémenté ailleurs en vrai | hardcoded | Clé morte : `FinCATab.jsx` calcule son **propre** `caDetail` réel depuis liquidations + marché local live. |
| carburant | *aucun* | Oui — Cloud Function `exports.fuel`, collection `fuel_transactions` | hardcoded | Mock forcé à `null` par design (commentaire : « Loaded from API in FinCarburantTab »). Déjà fetché en live par l'écran, hors `AuthenticatedApp`. |
| finStock | FinStockTab.jsx | Non trouvée sous cette forme agrégée (le magasin a du stock par article, granularité différente) | hardcoded | Seul consommateur réel. |
| liquidations | *aucun* | Oui — collections `liquidations` + `liquidation_forecasts` | hardcoded | Clé morte, mais avec un remplacement **déjà réel et déjà en production** : `QualiteLiquidationsTab.jsx` et `FinLiquidationsTab.jsx` maintiennent leur propre state `liquidations` depuis l'API live. **Domaine argent**, gros historique littéral. |
| parcelleConfig | ParametresTab.jsx, PlanificationTab.jsx, ChefHorsRecoltePanel.jsx, CaporalSaisieTab.jsx, CoutRecolteTab.jsx, HorsRecolteSuiviTab.jsx, RecolteTab.jsx, DashboardTab.jsx | Partielle — une collection Firestore `parcelles-config` existe mais de forme différente, utilisée seulement par `HorsRecolteSuiviTab.jsx` (comptage tunnels) | hardcoded | **Signalé explicitement dans le brief** : `generateMockData.jsx` importe `parcelleConfig` depuis `src/modules/agronomie/parcelleConfig.jsx`, lui-même construit depuis le littéral statique `PARCELLES_CULTURALES` — **pas une source live**, malgré 8 écrans qui en dépendent. Cette même donnée statique est **triplée** : `src/` modulaire, `public/app.jsx` monolithe, et `functions/parcellesCulturales.js` (qui dit explicitement « Mirrors PARCELLES_CULTURALES in public/app.jsx »). |
| normesProductivite | ParametresTab.jsx, PlanificationTab.jsx, CaporalSaisieTab.jsx, DashboardTab.jsx | **Oui** — collection Firestore live `normes-productivite`, CRUD complet déjà exposé (`/api/hors-recolte-suivi?action=get-normes`) | hardcoded | **Meilleur candidat de câblage 3b** : la vraie source existe déjà et est déjà utilisée ailleurs dans l'app (`HorsRecolteSuiviTab.jsx`), il ne manque que le branchement dans `AuthenticatedApp.jsx`. |
| horsRecolteParTunnel | *aucun* | **Oui** — collections live `suivi-hors-recolte`, `suivi-hors-recolte-cumul`, `parcelles-config` | hardcoded | Clé morte : l'écran naturel (`HorsRecolteSuiviTab.jsx`) fetch déjà cette donnée en live, sans passer par `data.horsRecolteParTunnel`. |
| ouvriersMatricule | *aucun* | Non trouvée comme collection dédiée (l'identité matricule existe en général via `Personnel_Matricule` dans `sql_mirror_pointage`) | generated | Totalement morte. |
| primesConfig | ParametresTab.jsx, ChargementSub.jsx, PrimesRecapSub.jsx, JourFerieSub.jsx, PaieTab.jsx, PointageTab.jsx, QuinzainePopupGenerique.jsx, QuinzaineTab.jsx, DashboardTab.jsx | Partielle — `primesConfig.joursFeries` a un vrai repli Firestore (`app_settings/jours_feries`), déjà consulté en priorité par `JourFerieSub.jsx`. Le reste (tranches de primes, `primeCaporal`, `primeChargement`) : pas de source Firestore trouvée. | hardcoded | **Plus large impact** (9 écrans) si un jour câblé — domaine RH/argent. |
| meteoData | *aucun* | Oui — Cloud Function météo avec cache Firestore `meteoblue_cache` | hardcoded | Clé morte : `MeteoTab.jsx` fetch en live directement, ignore `data.meteoData`. |
| agroData | AgroAvancementTab.jsx, AgroDashboardTab.jsx, AgroFertilisationTab.jsx, AgroIrrigationTab.jsx, AgroParcellesTab.jsx, AgroPhytoTab.jsx | Oui — `/api/agro-summary` | **réel** | Déjà câblé (`AuthenticatedApp.jsx:591-607`). |
| agroApiStatus | AgroDashboardTab.jsx, AgroFertilisationTab.jsx | Oui — statut du même fetch `/api/agro-summary` | **réel** | Déjà câblé (`AuthenticatedApp.jsx:608`). |
| transportConfig | FinDashboardTab.jsx, CoutRecolteTab.jsx, PrimesRecapSub.jsx, PrimesRecolteTab.jsx, RecolteTab.jsx, EquipesTab.jsx, PointageTab.jsx, QuinzaineTab.jsx, TransportSub.jsx, DashboardTab.jsx | Oui — doc `rh_config/transport_primes` (source de la surcharge) **et** une collection `transport_config` distincte et plus riche, utilisée directement par `TransportSub.jsx` | **réel** | Déjà câblé (`AuthenticatedApp.jsx:564-588`). Les deux sources réelles existantes ne sont pas réconciliées entre elles — à noter, pas forcément à corriger ici. |
| avocatierConfig | ParametresTab.jsx, CaporalSaisieTab.jsx, HorsRecolteSuiviTab.jsx | Non trouvée | hardcoded | — |
| varieteCultureMap | *aucun* | n/a — dérivée en interne de `parcelleConfig` (lui-même hardcoded) | hardcoded | Totalement morte ; seule la fonction interne `getCultureForVariete` (hors périmètre) la consomme. |

## Synthèse

- **Réel, déjà câblé** : `agroData`, `agroApiStatus`, `weeklyRanking`,
  `transportConfig` — 4, comme annoncé.
- **Generated (`Math.random()`)** : `effectif`, `topOps`, `recolteData`,
  `recolteParJour`, `horsRecolteDetail`, `pointageJour`, `quinzaineData`,
  `weeklyTrend`, `parcellesMap`, `parcelleDetail`, `equipes`, `suiviModifs`,
  `qualiteHistorique`, `qualiteBrix`, `pfqHistory`, `ouvriersMatricule` — 16.
- **Hardcoded (littéral/seed fixe)** : les 31 restants.
- **Aucun domaine marqué `unknown`** — chaque clé a pu être classée
  formellement (source trouvée ou recherche négative documentée).

### Pistes de câblage 3b, par facilité/impact

**Gains rapides, source déjà prête** (juste brancher, comme `transportConfig`
l'a été) :
- `normesProductivite` → `normes-productivite` (CRUD déjà exposé ailleurs)
- `horsRecolteParTunnel` → `suivi-hors-recolte*` + `parcelles-config`
- `carburant`, `meteoData`, `expeditions`, `liquidations`, `qualiteInspections`,
  `qualiteHistorique` → sources réelles trouvées, mais **déjà consommées
  correctement par un fetch local dans l'écran naturel** ; câbler
  `generateMockData` n'a d'effet que sur d'éventuels AUTRES écrans qui
  liraient encore `data.<clé>` sans fetch propre — à vérifier au cas par cas
  avant de le faire, ce tableau ne garantit pas l'exhaustivité des lecteurs
  indirects (composants enfants, popups).

**Aucune source trouvée — à trancher avec vous avant tout calcul de
remplacement**, notamment tout le bloc finance (`cpcData`, `cpcVarietes`,
`cpcCharges`, `totalHa`, `totalCA*`, `totalChargesGlobales`, `cfDea`,
`ebeParVariete`, `ebeFramboise`, `resultatAvantImpot`, `resultatParMois`),
`finStock`, `parcellesMap`, `parcelleDetail`, `suiviModifs`, `stockEmballages`,
`stockIntrants`, `parcAuto`, `ouvriersMatricule`, `avocatierConfig`. Conforme
à la consigne « ne jamais inventer une source » — ces domaines restent
`hardcoded`/`generated` jusqu'à ce qu'une vraie source soit identifiée ou
confirmée par vous comme configuration volontairement figée.

**`parcelleConfig`** mérite une décision séparée : c'est la donnée la plus
largement lue (8 écrans) de tout le tableau, elle est triplée dans le repo
(src/, public/app.jsx, functions/), et aucune des trois copies n'est une
source live — à traiter comme un chantier à part plutôt que noyé dans 3b.
