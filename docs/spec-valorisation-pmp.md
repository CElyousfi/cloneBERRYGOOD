# Spec — Valorisation du stock au PMP (coût d'acquisition réel)

> **Statut : PMP grand-livre LIVRÉ PROD (§8). Architecture « PMP daté par campagne » QUALIFIÉE (§10,
> non codé).** Objectif : remplacer la valorisation par **prix catalogue figé** par le **coût moyen
> pondéré d'acquisition (PMP / CMUP)**, **borné par campagne** et réajusté au **prix facturé**.
> GATED à l'implémentation.

## 1. Pourquoi
Aujourd'hui la Fiche de Stock / Inventaire valorise au **prix catalogue** (`articles_catalog.prix_ttc`),
un prix de référence figé (souvent le dernier connu / coût de remplacement). Pour un inventaire
comptable, la valeur doit refléter le **coût d'acquisition réel** des unités en stock = **PMP/CMUP**
(coût moyen unitaire pondéré), calculé à partir des **prix d'achat effectifs** (bons d'entrée) +
le **solde d'ouverture** valorisé.

Valeur indicative (aperçu 2026-06-15, à fiabiliser) :
- Catalogue (FILL-ONLY 30/06) : **~1 087 k DH** ← état actuel prod
- PMP brut (non normalisé) : **~1 578 k DH** ← **NON FIABLE, voir §3**

## 2. Modèle CMUP
Pour chaque article, en parcourant les mouvements **dans l'ordre chronologique** :
- **Ouverture** : `valeur = qté_ouverture × prix_30/06`, `qté = qté_ouverture`.
- **Entrée** (bon d'entrée) : `CMUP = (valeur + qté_entrée × prix_achat_unitaire) / (qté + qté_entrée)`
  puis `valeur += qté_entrée × prix_achat`, `qté += qté_entrée`.
- **Sortie / consommation / transfert sortant** : valorisées au CMUP courant ; `valeur -= qté × CMUP`,
  `qté -= qté`. (le CMUP ne change pas sur une sortie.)
- **Valeur du stock** à une date = `qté_courante × CMUP_courant`, sommée sur tous les lieux de stock.
- Scope : par **article** et par **campagne** (cf. [spec-gestion-campagnes.md] — un CMUP par campagne).

## 3. ⚠️ BLOQUANT n°1 — incohérences d'unité dans les prix des bons d'entrée
**Découvert le 2026-06-15** en investiguant SULFATE DE MAGNESIE : les prix `PRIX FOURNISSEUR TTC`
des bons d'entrée mélangent **prix/tonne et prix/kg** pour un même article, alors que les quantités
sont en kg.
- Ex. SULFATE DE MAGNESIE : 8 entrées à `2708.33` (= **2 708 DH/tonne = 2,7 DH/kg**) + 1 entrée à
  `2.7` (DH/kg). Le PMP brut ressort à **770 DH/kg** au lieu de **2,7** → **×285**.
- Le prix d'inventaire 30/06 (2,7) est, lui, fiable et cohérent.
- Formats sales additionnels : `"2,708,33"` (double virgule), suffixe `" DH"`, `"PERIMI"` (FERTICOL).

**Conséquence : le PMP NE PEUT PAS être calculé tel quel.** Il faut d'abord **normaliser les prix
d'achat à l'unité du stock (DH/kg ou DH/L)** :
1. Parser proprement (strip `" DH"`, gérer `,` millier ET `,` décimal, `"2,708,33"` → 2708.33).
2. **Détecter les prix aberrants par article** : un prix d'entrée dont l'écart à la **médiane** (ou
   au prix 30/06) de l'article dépasse un seuil (ex. ×10) est suspecté **prix/tonne** → diviser par
   1000, OU exclure, OU flag manuel.
3. Idéalement : récupérer l'**unité du prix** depuis la source (si le bon d'entrée distingue
   DH/kg vs DH/tonne) — sinon heuristique médiane.
4. Ne jamais calculer un PMP sur des prix non normalisés.

## 4. BLOQUANT n°2 — articles sans prix
13 articles en stock n'ont aucun prix (ni fichier ni catalogue) : ACTARA, BIO ENERGY, CODACIDE,
FERTICOL (périmé→0), FOLICIST, JOKER, KRISANT, NATURALIS, SEACTIV GENAKTIS 3, SERGOMIL, SIBERIO…
→ CMUP indéterminé. À fournir manuellement ou valoriser à 0 (signalé).

## 5. Stockage & calcul
- Ne PAS stocker le CMUP sur `stock_balances` (effacé à chaque recompute des soldes).
- Option A (recommandée) : **calcul à la volée** côté serveur, mis en **cache** (même pattern que
  `articleHistoryIndex` : scan unique → index CMUP par article → cache 5 min). Réutilise la
  factorisation existante.
- Option B : collection durable `stock_prix_reference` (article × campagne → CMUP, recalculée par job).
- Source de vérité prix = bons d'entrée **normalisés** + inventaire d'ouverture.

## 6. Garde-fous (à l'implémentation, GATED)
- Backup avant toute écriture (catalogue / collection prix).
- Aperçu chiffré avant/après (valeur par article × magasin), validé par Omar.
- Rapport des prix normalisés (entrée brute → unité retenue) pour audit — surtout les corrections ×1000.
- Aucun PMP servi tant que la normalisation des unités n'est pas validée.

## 7. Phases
- **P0 (qualif)** : ce doc. Décider la stratégie de normalisation d'unité (heuristique médiane vs
  source d'unité fiable).
- **P1** : module pur `cmupIndex` (scan entrées+ouverture, normalisation, CMUP par article) + tests.
- **P2** : endpoint cached + aperçu valeur. Comparaison catalogue vs CMUP, article par article.
- **P3** : bascule de la Fiche de Stock / Inventaire sur la valeur CMUP (après validation Omar).

> Lien : la reconstruction du stock (`spec-reconstruction-stock.md`) a importé les **quantités** ;
> les **prix** ont été ajoutés séparément (FILL-ONLY catalogue, 2026-06-15). Le PMP est la couche
> comptable au-dessus, à fiabiliser une fois les unités des bons d'entrée normalisées.

---

## 8. État réel (mise à jour 2026-06-16)
- **Phase 0 (normalisation)** : LIVRÉE. Bug DH/tonne isolé (SULFATE DE MAGNESIE : 8 entrées à 2708/t,
  ÷1000 → 2,7/kg). Parser robuste (`"2,708,33"`, `" DH"`, `"PERIMI"`→0) + ÷1000 si prix > 100× ancre.
- **Phase 1 (exploration sources)** : LIVRÉE (voir §9).
- **Phase 2 (calcul + écriture)** : LIVRÉE EN PROD. Module pur `functions/lib/stock/valuationPMP.js`
  (parsePrice / normalizePrice / `SOURCE_PRIORITY` / resolveAcquisitionPrice / computePMP pondéré),
  scripts `compute-pmp-apercu.js` + `apply-pmp-catalogue.js`. Champ **`prix_pmp` + `prix_pmp_source`**
  écrit sur `articles_catalog` (sans toucher `prix_ttc` FILL-ONLY). Frontend `InventaireStockView`
  valorise `prix_pmp > prix_ttc` avec **matching canonicalisé** (`canonArt`) + colonne **Source**
  (badge PMP/Catalogue/— + tooltip bon_entree/inventaire). **Valeur stock : 1 113 795 DH**, 2 articles
  sans prix (FERTICOL périmé, SEACTIV GENAKTIS 3 → 0).
- **Source PMP actuelle = grand livre** (bons d'entrée + inventaire 30/06), 100 % de couverture.
- **Hiérarchie de sources** (la plus fiable gagne, déjà codée, extensible sans refactor) :
  `facture (P3) > bon_commande > bee_one_achat (futur) > bon_entree (grand livre) > inventaire`.

## 9. Sources externes explorées (read-only, 2026-06-16) — ne PAS brancher maintenant

### 9.1 Couverture par source (articles en stock = 96)
| Source | Couverture | Verdict |
|---|---|---|
| `purchase_orders` (BDC app Firestore) | 15 % (41 BDC, tous 2026) | trop récent/épars |
| `invoices` (factures app) | ~1 doc | quasi vide → **vraie source future (P3)** |
| **`BR_Achat` (BEE ONE SQL)** | **~10 %** | voir §9.2 |
| **Grand livre (entrées + inventaire)** | **100 %** | **source PMP retenue** |

### 9.2 `BR_Achat` (table achat BEE ONE, `BR_BERRY_GOOD` SQL Server) — slot futur `bee_one_achat`
Colonnes : `Article, Quantite, Cout, Fournisseur, Periode_Date, Periode_Campagne, Article_Categorie, Unite, Ferme`.
Table **plate** (pas d'en-tête/lignes), pas de statut, pas de lien réception/facture.

**PIÈGES IDENTIFIÉS (à connaître avant tout usage futur) :**
1. **Duplication ×80** : 60 397 lignes brutes → **760 distinctes** (sur date+article+qté+cout+fournisseur+ferme).
   → **DÉDUPLIQUER obligatoirement** avant tout calcul (sinon Σcout gonflé : ex. TIMAC AGRO MAROC
   affiche 66 M DH faux).
2. **`Cout` quasi vide** : la plupart des fournisseurs ont Σcout=0 ; seulement **13 / 105 articles** ont
   un Cout>0 ; achats propres = **19 lignes, 11 articles, tous Feb-Avril 2026** (récent). PU réalistes
   là où présents (Nitrate Potasse 14,16 · Acide Nitrique 7,32 · Rhizo Bore 9,56).
3. **Lignes `Fournisseur=INVENTAIRE`/`STOCK INITIAL`/`INV-%`/`F-0X`** : Cout=0, ouverture/interne →
   **EXCLURE** des achats.
4. **Matching faible (2 %)** avec le grand livre (7/318 par article+qté) — variantes de nom + qtés agrégées.

### 9.3 ⚠️ RÈGLE ANTI-DOUBLE-COMPTAGE (CRITIQUE — pour toute session future)
`BR_Achat` enregistre les **MÊMES événements économiques** que les bons d'entrée du grand livre
(= entrées de stock / achats). **NE JAMAIS** ajouter `BR_Achat` comme **acquisitions supplémentaires**
dans le CMUP → cela **double-compterait les quantités** et fausserait le PMP.
**`BR_Achat` ne peut fournir QUE du PRIX** (`Cout/Quantite`), appliqué à une **acquisition DÉJÀ connue**
du grand livre, **matchée** sur `canon(Article)` + `Periode_Date` + `Quantite` (+ Fournisseur). Le slot
`bee_one_achat` de la hiérarchie sert UNIQUEMENT à **raffiner le prix** d'une acquisition existante,
**jamais à créer une acquisition/quantité**.

### 9.4 Verdict
`BR_Achat` = **appoint marginal futur** (~11 articles récents), **PAS prioritaire**. La vraie source de
raffinement comptable = les **FACTURES** (`invoices`/`invoice_scans`, Phase 3), pas `BR_Achat`. On
**ne branche rien** maintenant ; le grand livre suffit (100 %, en prod).

---

## 10. PMP daté par campagne (architecture comptable — QUALIFICATION, GATED)

> **Statut : SPEC (2026-06-16). Aucun code.** Décision d'architecture validée par Omar : le PMP n'est
> **pas un prix unique figé** mais se calcule **par campagne** (frontière 30/06), réajusté à chaque
> nouvelle facture. Mesuré sur les **134 factures TIMAC** réelles (parser `parseTimacInvoiceText`).

### 10.1 Principe
Le PMP est **borné par campagne** : il ne moyenne que les acquisitions **de la campagne courante** +
la **valeur d'ouverture** de cette campagne. Une facture appartient à une campagne selon sa date via
`campagneOf(date_facture)` (frontière 30/06, cohérent avec [spec-gestion-campagnes.md]). Les prix
d'engrais bougent → le PMP d'un article **suit**, campagne après campagne.

### 10.2 Modèle 3 campagnes (mesuré sur les 134 factures)
Les factures TIMAC s'étalent du **12/01/2024 au 05/03/2026** → elles couvrent **3 campagnes**, pas 2 :

| Campagne | Fenêtre `campagneOf` | Factures | Rôle dans le PMP |
|---|---|---|---|
| 2023-2024 | < 01/07/2024 | **40** | valorisent l'ouverture *de* 24-25 (chaînage amont) |
| 2024-2025 | 01/07/2024 → 30/06/2025 | **59** | PMP de clôture 24-25 = **valeur d'ouverture 30/06/2025** |
| **2025-2026 (courante)** | ≥ 01/07/2025 | **35** (Σ **770 226 DH HT**) | entrées courantes au prix facturé |

Split brut au cutoff 30/06/2025 : **99 avant / 35 après**. ⚠️ Les 99 « avant » ne forment **pas une
seule campagne** : elles se scindent en 40 (camp. 23-24) + 59 (camp. 24-25). Ne **jamais** moyenner les
99 ensemble pour l'ouverture — ça mélangerait 18 mois et 2 campagnes.

### 10.3 Inventaire d'ouverture 30/06/2025 — valorisation + hiérarchie de fallback
L'ouverture = stock physique résiduel à la clôture 24-25. Le stock restant à cette date est surtout
composé des **derniers achats** → l'ancre la plus fidèle est la **dernière facture ≤ 30/06 par article**
(et non un PMP lissé sur 18 mois).

**Hiérarchie de fallback (le premier disponible gagne, par article) :**
1. **Dernière facture TIMAC ≤ 30/06/2025** de l'article (ancre fidèle au stock résiduel).
   *Ex. ACIDE PHOSPHORIQUE → 20/06/2025 ; NITRATE DE POTASSE → 11/04/2025.*
2. **PMP de la fenêtre campagne 24-25** (01/07/2024 → 30/06/2025) de l'article — si pas de dernière
   facture exploitable.
3. **Prix grand livre 30/06** (FILL-ONLY, déjà en prod) — **fallback STRUCTUREL**, pas optionnel.

**Pourquoi le fallback grand livre est structurel :**
- **Périmètre TIMAC = 87,6 %** seulement. Les articles d'ouverture **non-TIMAC** (HAROUACH, NALSYA,
  ~21 autres fournisseurs) n'ont **aucune facture** → restent au grand livre.
- **1 code TIMAC sans antériorité** : `0265 SULFATE D'AMMONIAQUE` (1ʳᵉ facture 25/08/2025) → nouvel
  article 25-26, absent de l'ouverture au prix TIMAC → grand livre.

**Couverture TIMAC mesurée : 47 / 48 codes ont ≥ 1 facture avant le 30/06/2025** (22 facturés
uniquement avant cutoff = campagnes passées dont les 8 `hors_campagne` ; 25 continus des deux côtés ;
1 seul — le 0265 — uniquement après). Côté TIMAC, l'ouverture est donc quasi intégralement valorisable.

### 10.4 Entrées campagne courante (≥ 01/07/2025)
Chaque réception facturée de la campagne courante entre au **prix facturé HT** de la campagne ; le PMP
de l'article se recalcule :
```
PMP = (valeur_stock_avant + qté_entrée × prix_facturé) / (qté_stock_avant + qté_entrée)
```
35 factures couvrent la campagne 25-26 (770 226 DH HT). Anti-double-comptage (§9.3) : la facture
fournit **le prix** sur une acquisition **déjà connue** du grand livre (matchée par `num_bl` + mapping
code→article), **jamais une quantité ajoutée**.

### 10.5 Réajustement : batch maintenant → incrémental ensuite
| | Incrémental (par réception) | **Batch par campagne (retenu maintenant)** |
|---|---|---|
| Justesse | exacte, suit chaque mouvement | ≈ correcte si rejoué régulièrement |
| Prérequis | **chaque réception liée à SA facture** (`num_bl`) live | lire toutes les factures de la campagne + ouverture |
| Faisabilité actuelle | ❌ factures arrivent par email **async** (étape 4 non déployée) | ✅ tenable tout de suite (134 factures, BL présents) |

**Décision : démarrer en BATCH** — `computePMP` **scopé par campagne** (filtrer les factures par
`campagneOf(date_facture)`, amorcer avec la valeur d'ouverture §10.3). **Évoluer vers incrémental**
quand l'**étape 4 (captation email)** + le **lien `num_bl` réception↔facture** seront en prod
(cf. `spec-pipeline-factures.md` §4-5). Le module pur `valuationPMP.computePMP` fait déjà la moyenne
pondérée — il suffit de le borner par campagne (pas de réécriture).

### 10.6 Périmètre & question ouverte
- **Périmètre** : TIMAC (87,6 %) au **prix facturé** ; autres fournisseurs au **grand livre**
  (fallback structurel §10.3).
- **Question ouverte (à trancher avant code)** : l'ouverture 30/06/2025 utilise-t-elle la **dernière
  facture ≤ 30/06 par article** (retenu §10.3, fidèle au résiduel) — confirmé comme défaut — ou un
  **PMP de la fenêtre 24-25** (plus lissé) ? Le défaut spec = dernière facture, fallback PMP-fenêtre.

### 10.7 Phases (GATED)
- **P0** : cette section (§10). ✅
- **P1** : `campagneOf` appliqué au calcul PMP + `computePMP` scopé campagne + ancre d'ouverture
  (dernière facture ≤ 30/06 par article) + hiérarchie fallback. Tests purs.
- **P2** : aperçu chiffré before/after **par campagne** (ouverture vs courante), article par article,
  validé par Omar. Distinction prix facturé / grand livre visible.
- **P3** : bascule incrémentale une fois l'étape 4 email + lien BL en prod.

### 10.8 Liens
- Plage/couverture mesurées : parser `functions/emailService.js` `parseTimacInvoiceText` sur les 134
  factures (`docs/factures/TIMAC`).
- Pipeline factures (captation email, rapprochement BL, alimentation prix) : `spec-pipeline-factures.md`.
- Mapping code→article (alimentation par article) : `spec-mapping-articles-bdc.md`.
- Frontière campagne / `campagneOf` : `spec-gestion-campagnes.md`.
