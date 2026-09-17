# Plan d'implémentation — Sprint 1 CPC : Dénominateur + Valorisation + Affectation

> **Mode plan — aucun code à exécuter.** Périmètre STRICT Sprint 1 = (1) dénominateur kg réel par parcelle×campagne, (2) valorisation des intrants en DH, (3) affectation parcellaire auditable du « Non classifié ». **Hors périmètre** (sprints suivants, à ne PAS introduire) : entité CPC unifiée, clé de répartition, statut de parcelle/capitalisation, revenu/prix de vente.

---

## Contexte

Le module Campagne réel ([app.jsx:9237-9471](public/app.jsx#L9237)) ne calcule aujourd'hui que la **Main-d'Œuvre** ; les Ha et kg sont **hardcodés** (`CAMPAGNE_PARCELLE_MAP` [app.jsx:9241](public/app.jsx#L9241)) et la « vue CPC » Finance ([app.jsx:1697-1818](public/app.jsx#L1697)) est une **maquette 100 % statique**. Pour bâtir un CPC automatique, il faut d'abord un **dénominateur fiable** (kg produit/exporté/local par parcelle) et la **valorisation réelle des intrants en DH** — les deux briques bloquantes du brief [CG_TRANSFORMATION.md](CG_TRANSFORMATION.md) §S1. Ce sprint pose ces fondations **en parallèle** des vues existantes, sans les casser.

Découvertes qui orientent le design :
- `kgRecolte` (= kg **produit** réel depuis `prod_tracabilite_recolte`) est **déjà agrégé et renvoyé** par l'endpoint `campagne-mo-variete` par variété|ferme×cycle ([pointageService.js:2112-2188](functions/src/modules/rh/pointageService.js#L2112)), mais **non affiché** par le front.
- Les **prix d'intrants** existent sur les mouvements de **réception** (`stock_movements`, `prix_unitaire` hérité du BDC, [index.js:5776-5790](functions/index.js#L5776)) ; **pas** sur les lignes de consommation. → CMP calculable côté réceptions.
- Les **quantités consommées** sont lisibles via `getConsommationRows({weekStart,weekEnd,...})` ([firestoreDataService.js:27-57](functions/src/shared/firestoreDataService.js#L27)), champ date = `r.Date`, parcelle = `r.Parcelle_Culturale` (souvent vide → « Non classifié »).
- L'endpoint `get-consumption-costs` ([index.js:8074](functions/index.js#L8074)) lit une collection pré-calculée `consumption_costs_by_variety` (obsolète/vide) — on **ajoute en parallèle**, on ne le casse pas.

---

## Architecture retenue

Deux modules purs (pattern `functions/lib/irrigation/` : pure functions + DI + `// @ts-check` + `node:test`), exposés par des endpoints fins. Réutilisation maximale des résolveurs existants (`resolveVariete`, `normalizeParcelle`, `deriveFerme`, `getCycle`, `getConsommationRows`) — **sans les modifier**.

### Brique 1 — Dénominateur kg réel (`functions/lib/campagne_recolte/`)

Agrège par **(variété, sousVariété, ferme, cycle)** sur la fenêtre campagne (`{start: YYYY-07-01, end: +1-06-30}`, cycle1End/cycle2Start déjà définis [pointageService.js:2024](functions/src/modules/rh/pointageService.js#L2024)) :

| kg | Source réelle | Résolution |
|---|---|---|
| **kg_produit** | `prod_tracabilite_recolte.rows[].totalKg` | `resolveVariete()` (déjà fait dans `campagne-mo-variete`) |
| **kg_exporté** | `liquidations.rows[].receiptQtyKg` (⚠️ **uniquement le kg**, jamais `gsNet`/prix — hors périmètre) | `varMap`/`variety_mapping` ([emailService.js varMap](functions/src/modules/finance/emailService.js)) → variété ; ferme via `normalizeParcelle` |
| **kg_local** | `pfq_interne.poidsLot` où `typeVente='ECRT'` | `normalizeParcelle(designation/blocVariete)` |
| **taux_tri** (dérivé) | `kg_exporté / kg_produit` | — |
| **kg_écart** (dérivé) | `kg_produit − kg_exporté − kg_local` | — |

Fichiers du module : `types.js`, `denominators.js` (pur : sommes + taux tri + écart), `cycleAttribution.js` (pur : date→cycle via `getCycle` ; mapping **semaine Driscoll's Sat-Fri → date** pour rattacher une liquidation au bon cycle — convention Sat-Fri à respecter, cf. [[feedback_week_calendar]]), `dataAccess.js` (DI : lectures Firestore), `index.js` (orchestrateur), `__tests__/`.

**Décision granularité** : on reste à **variété×sousVariété×ferme** (≈ une parcelle, identique aux lignes Campagne actuelles) — on ne crée **aucune** nouvelle table de mapping variété↔parcelle (réutilise l'existant ; conforme au scope).

**Point de vigilance documenté** : `liquidations.rows[]` est clé par `week` (Sat-Fri), pas par date → rattachement cycle via `weekRange` (logique [app.jsx:14508](public/app.jsx#L14508), à porter en pur backend). Tracer les semaines à cheval (W27+ = nouvelle campagne).

**Endpoint** : `GET /api/pointage-rh?action=campagne-recolte&v=1` (renvoie `{cycle1,cycle2,annuel}` avec `parVariete[]{variete,sousVariete,ferme,kgProduit,kgExporte,kgLocal,kgEcart,tauxTri}`). Cache 30 min comme `campagne-mo-variete`.

> **Alternative écartée** : enrichir `campagne-mo-variete` directement. Rejeté pour non-régression (endpoint caché, consommé tel quel) et séparation des responsabilités.

### Brique 2 — Valorisation intrants DH (`functions/lib/intrants_costing/`)

Pipeline pur :
1. **Quantités** : `getConsommationRows({weekStart: campagne.start, weekEnd: campagne.end})` → lignes `{Article, Parcelle_Culturale, Quantite, Article_unite, Article_Categorie, Date, Parcelle_sup, Ferme}`.
2. **Prix de revient (CMP)** : `priceBook.js` (pur) construit un **coût moyen pondéré par article** = `Σ(quantité_reçue × prix_unitaire) / Σ(quantité_reçue)` à partir des mouvements de **réception** (`stock_movements` items avec `prix_unitaire`). **Repli** documenté : CMP stock → dernier prix BDC (`purchase_orders.items[].prix_unitaire`) → prix facture (`invoices.items[].prix_unitaire`) → `null`.
3. **Jointure** conso × prix par **nom d'article normalisé** (uppercase/trim ; `Article` ↔ `article_nom`). `montant_dh = Quantite × prix_revient`.
4. **Prix manquant → JAMAIS supprimé** : ligne émise avec `montant_dh = null`, `price_missing = true`, quantité conservée ; remontée dans une section « Intrants sans prix » du résultat.
5. **Agrégation** : `montant_dh` par parcelle (résolue) × campagne, ventilé par famille (`Engrais` / `Pesticides`).

Fichiers : `types.js`, `priceBook.js` (CMP+repli, pur), `valuation.js` (conso×prix, pur), `classify.js` (résolution parcelle + détection « Non classifié », pur), `summarize.js` (agrégats parcelle/famille + buckets prix-manquant & non-classifié, pur), `dataAccess.js` (DI : `getConsommationRows`, `getReceptionMovements`, `getOverrides`), `index.js`, `__tests__/`.

**Endpoint** : `GET /api/stock?action=intrants-valorises&campagne=2025` — **nouvelle action en parallèle** de `get-consumption-costs` (laissé intact).

### Brique 3 — Affectation « Non classifié » auditable & réversible

- **Audit (lecture seule)** : le résultat de la Brique 2 expose un bucket **« Non classifié / À valider »** = lignes où `Parcelle_Culturale` vide **ou** `resolveVariete → 'Autre'`. Affiché séparément avec quantité + montant estimé. **Jamais réparti silencieusement** sur les parcelles.
- **Override réversible** : nouvelle collection `intrants_parcelle_overrides` mappant une clé de ligne (`article|date|ferme` ou hash ligne) → `{parcelle, variete, by, at, reason}`. **Écriture via Cloud Function uniquement** (action `assign-intrant-parcelle`, auth + `history[]`), conforme à `firestore.rules` (client read-only). **Réversible** : suppression de l'override → la ligne retombe en « Non classifié » (la source `sql_mirror_consommation` n'est **jamais** mutée).
- **Validation humaine** : tant qu'aucun override n'existe pour une ligne vraiment inconnue, elle reste flaggée « À valider » et **exclue des totaux par parcelle**.

> Saisie obligatoire à la source (BEE ONE/SQL) = hors de portée de cette app (data syncée en miroir) ; l'override est le mécanisme app-side prévu par le brief (S1.3) pour la rétro-affectation.

### Frontend (ajouts parallèles, non destructifs)

- `CampagneSegmentTable` ([app.jsx:9293](public/app.jsx#L9293)) : ajouter colonnes **kg produit / exporté / local / taux tri**, alimentées par un nouvel état (`campagneRecolte`) issu de `campagne-recolte`. Conserver les colonnes M.O et garder `CAMPAGNE_PARCELLE_MAP` comme **fallback** quand la donnée live manque (indicateur de source). Ne rien retirer.
- Nouveau sous-panneau **« Valorisation Intrants »** + **« Non classifié à valider »** dans `CampagneTab` ([app.jsx:9394](public/app.jsx#L9394)), alimenté par `intrants-valorises`, avec action d'affectation (appelle `assign-intrant-parcelle`).

---

## Fichiers à créer / modifier

**Créer**
- `functions/lib/campagne_recolte/` (module + `__tests__/`)
- `functions/lib/intrants_costing/` (module + `__tests__/`)
- `tests/unit/campagneRecolte.test.js`, `tests/unit/intrantsCosting.test.js` (ou tests `node:test` dans les `__tests__/` des modules, cf. irrigation)

**Modifier**
- `functions/src/modules/rh/pointageService.js` : nouvelle action `campagne-recolte` (wiring fin → module).
- `functions/index.js` : nouvelles actions `intrants-valorises` et `assign-intrant-parcelle` (stock service) ; helper `getReceptionMovements` si absent.
- `functions/src/shared/firestoreDataService.js` : éventuel lecteur réceptions/overrides (sinon dans `dataAccess.js`).
- `firestore.rules` : `intrants_parcelle_overrides` en **read auth / write deny** (writes via CF).
- `public/app.jsx` : colonnes kg dans `CampagneSegmentTable` + sous-panneaux Valorisation/Non-classifié + appels API.
- `firebase.json` : vérifier le rewrite des nouvelles actions (réutilise routes `/api/pointage-rh`, `/api/stock` existantes — a priori rien à ajouter).

**Réutilisés sans modification** : `resolveVariete`, `resolveMyrtilleVariete`, `deriveFerme` ([pointageService.js:36-135](functions/src/modules/rh/pointageService.js#L36)), `normalizeParcelle`/`DESIGNATION_MAP`/`getCycle` ([parcellesCulturales.js](functions/src/modules/agronomie/parcellesCulturales.js)), `getConsommationRows` ([firestoreDataService.js:27](functions/src/shared/firestoreDataService.js#L27)), `varMap`/`variety_mapping` ([emailService.js](functions/src/modules/finance/emailService.js)).

---

## Étapes d'exécution (ordre)

1. **Brique 1 backend** : module `campagne_recolte` + action `campagne-recolte` + tests purs (kg produit/exporté/local, taux tri, écart, attribution cycle/semaine Sat-Fri).
2. **Brique 1 frontend** : colonnes kg dans `CampagneSegmentTable` (fallback `CAMPAGNE_PARCELLE_MAP`). `npm run build:frontend`.
3. **Brique 2 backend** : module `intrants_costing` (CMP + repli + prix-manquant) + action `intrants-valorises` + tests purs.
4. **Brique 3 backend** : collection + action `assign-intrant-parcelle` (CF, audit/history) + règle Firestore + intégration overrides dans `summarize`.
5. **Brique 2+3 frontend** : sous-panneaux Valorisation / Non classifié + affectation.
6. **Validation** (ci-dessous).

---

## Vérification

- **Tests unitaires purs** (`node:test`) : CMP pondéré ; valorisation avec prix manquant (ligne conservée, `price_missing`) ; détection « Non classifié » (parcelle vide / `Autre`) ; override applique/retire l'affectation (réversibilité) ; kg dénominateurs + taux tri + écart ; attribution cycle pour une semaine Sat-Fri à cheval. → `npm run test:unit` vert.
- **Build front** : `npm run build:frontend` (sentinelles) vert.
- **Non-régression vue Campagne** : la vue M.O existante est inchangée (mêmes chiffres `campagne-mo-variete`) ; les colonnes kg s'ajoutent sans casser le rendu ; fallback `CAMPAGNE_PARCELLE_MAP` actif si endpoint indisponible.
- **Cohérence métier** (manuel) : comparer les **kg dénominateurs** et les **montants DH d'intrants par parcelle** aux totaux de `SOURCE CPC BGF.xlsx` (réf. canonique du brief) — écarts attendus sur les lignes « Non classifié » (à résorber via overrides), à documenter.
- **Audit overrides** : vérifier qu'aucune ligne n'est réaffectée sans override explicite, et qu'une suppression d'override restaure le bucket « Non classifié ».
- **Workflow** : feature branch dédiée (pas de commit sur `main`), preview channel Firebase pour validation front avant merge (cf. [[feedback_preview_channels]]), PR draft structurée.

---

## Limites assumées (renvoyées aux sprints suivants)

- Pas de CA/revenu/prix de vente (les `gsNet`/forecasts ne sont **pas** utilisés ; seul le **kg** exporté l'est).
- Pas d'entité Campagne/PrixVente/LigneCharge unifiée, pas de clé de répartition, pas de statut de parcelle ni capitalisation.
- Eau/électricité/gasoil/loyer/amortissement/structure : non valorisés ici (Sprint 2-4).
- Saisie obligatoire à la source SQL non couverte (miroir) — résorption via overrides app-side uniquement.
