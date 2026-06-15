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
