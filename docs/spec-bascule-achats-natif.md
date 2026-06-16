# Spec — Bascule vers les Achats natifs Smart Berry (Option A au 01/07/2026)

> **Statut : DÉCISION DE BASCULE (2026-06-16, doc-only). GATED.** Décision stratégique d'Omar :
> à terme, **tous les achats passent par le module Achats natif Smart Berry** (Option A), avec une
> **bascule à la frontière de campagne 30/06/2026**. Avant cette date = préparation (les 3 manques) ;
> après = le natif devient la source de vérité. Aucune conception technique ici, aucun code.

## 0. La décision en une phrase
**Au 01/07/2026, le module Achats natif (BDC → BL → réception valorisée → stock) devient la source
unique des achats et des prix.** La campagne 2025-2026 reste figée sur le grand livre (historique) ;
la campagne 2026-2027 naît dans le natif. L'inventaire physique au 30/06/2026 fait le **pont** entre
les deux mondes.

## 1. Cible : Option A — tout via Smart Berry
- **Option A retenue** : 100 % des achats saisis/validés/réceptionnés dans le module Achats natif
  (cf. `spec-module-achats-existant.md`). Plus d'import grand livre canevas comme source courante.
- Le grand livre (canevas Excel) **reste consultable** comme **archive** de la campagne 2025-2026,
  mais n'est plus alimenté en campagne 2026-2027.

## 2. Plan par campagne (frontière 30/06/2026)
| Campagne | Période | Source de vérité achats/prix | Statut |
|---|---|---|---|
| **2025-2026** | jusqu'au **30/06/2026** | **Grand livre** (entrées canevas + inventaire 30/06/2025) | **historique FIGÉ** — ne plus modifier |
| **2026-2027** | dès le **01/07/2026** | **Achats natif** (`purchase_orders` → `delivery_notes` → `stock_movements` valorisés) | cible |

- **Frontière 30/06/2026** = **clôture du grand livre** (dernier jour où il fait foi) et **ouverture
  du natif** (premier jour de la nouvelle campagne saisie dans Smart Berry).
- Cohérent avec le modèle campagnes (frontière 30/06, `campagneOf`) et avec le **PMP daté par campagne**
  (`spec-valorisation-pmp.md` §10) : la campagne 25-26 garde son PMP grand livre ; la 26-27 calcule son
  PMP au prix facturé natif.

## 3. L'inventaire physique 30/06/2026 = pont entre les 2 mondes
- À la clôture, l'équipe **compte physiquement** le stock (cf. `spec-reconciliation-inventaire-physique.md`).
- Ce comptage devient l'**inventaire d'ouverture de la campagne 2026-2027** dans le natif — exactement
  comme `INVENTAIRE AU 30-06-25` a amorcé la reconstruction de 25-26.
- Il **réconcilie** le théorique grand livre (fin 25-26) avec le réel physique, et **transfère** les
  soldes valorisés (au PMP 25-26) comme point de départ du natif 26-27.
- C'est le **seul point de contact** entre l'ancien monde (grand livre) et le nouveau (natif). Après,
  les deux ne se mélangent plus.

## 4. Les 3 manques = chantiers de préparation AVANT le 01/07/2026
Pour que le natif soit prêt à porter 100 % des achats au 01/07, les 3 manques identifiés
(`spec-module-achats-existant.md` §10) sont des **prérequis**, par priorité :

1. **Captation email auto** (PRIORITÉ 1) — les factures TIMAC arrivent déjà sur la boîte ; les router
   automatiquement vers le module Achats (filtre `timacmaroc.com` + objet « Facture » →
   `parseTimacInvoicePdf` → facture `invoices` → workflow de validation existant). Calque sur l'archi
   Driscoll's `fetchEmails`/`analyzeEmail`. Détail : `spec-pipeline-factures.md` §4.
2. **Parser TIMAC déterministe branché** — remplacer/compléter l'OCR Claude Vision générique du Scan
   par `parseTimacInvoicePdf` (validé 134/134, `code_article` stable) pour une extraction fiable et une
   clé de mapping stable (`spec-mapping-articles-bdc.md`).
3. **Connexion prix natif ↔ PMP** — faire que la **réception valorisée native** (`prix_unitaire` posé
   à `validate-movement`) alimente le **PMP daté campagne** (`spec-valorisation-pmp.md` §10) au prix
   facturé HT, dans le respect de l'anti-double-comptage (§9.3). C'est ce qui rend le PMP 26-27
   automatique (plus d'import grand livre).

> Ordre logique : (1) capter les factures → (2) les extraire proprement → (3) brancher le prix sur le
> PMP. Les trois doivent être **en prod et rodés avant le 01/07/2026** pour une bascule sans rupture.

## 5. Risques & garde-fous
- **Double saisie transitoire** : tant que le grand livre tourne encore (25-26), ne PAS saisir les
  mêmes achats dans le natif → double-comptage. Règle : un achat appartient à **un seul monde** selon
  sa campagne (`campagneOf`). Anti-double-comptage (`spec-valorisation-pmp.md` §9.3) reste critique.
- **Adoption** : le natif doit être réellement utilisé (aujourd'hui 41 BDC, 1 facture). La bascule
  suppose que les équipes Achats/magasin saisissent **tout** dès le 01/07. Accompagnement à prévoir.
- **Réversibilité** : le grand livre 25-26 reste archivé et consultable ; aucune donnée historique
  n'est migrée ni écrasée par la bascule.

## 6. Liens
- Cartographie du natif : `spec-module-achats-existant.md`.
- PMP daté campagne (frontière 30/06, hiérarchie sources) : `spec-valorisation-pmp.md` §10.
- Inventaire physique (le pont) : `spec-reconciliation-inventaire-physique.md`.
- Pipeline factures (captation email, parser, alimentation prix) : `spec-pipeline-factures.md`.
- Mapping code TIMAC → article stock : `spec-mapping-articles-bdc.md`.
- BDC BEE ONE (système parallèle, hors cible) : `spec-workflow-achats.md`.
