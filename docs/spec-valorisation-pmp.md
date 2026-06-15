# Spec — Valorisation du stock au PMP (coût d'acquisition réel)

> **Statut : QUALIFICATION (non codé).** À traiter après stabilisation du stock. Objectif :
> remplacer la valorisation par **prix catalogue figé** par le **coût moyen pondéré d'acquisition
> (PMP / CMUP)**, comptablement correct. GATED à l'implémentation.

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
