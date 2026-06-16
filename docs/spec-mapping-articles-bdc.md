# Spec — Mapping articles (canevas/stock ↔ BEE ONE) pour rapprochement BDC

> **Statut : QUALIFICATION (non codé, 2026-06-16).** Table de correspondance pour rapprocher les
> réceptions (canevas/stock) aux bons de commande (BEE ONE `Bon_Commande` + Smart Berry
> `purchase_orders`). Même pattern que le **mapping parcelles de consommation** (déjà livré).
> NE PAS construire maintenant — la table se validera avec le magasinier. GATED.

## 1. Pourquoi
Le rapprochement Réceptions ↔ BDC bute sur le **nom d'article** : chaque système nomme les articles
différemment. Sans correspondance, le matching automatique (même fuzzy) mélange vrais manquants et
écarts de nom. Exemples réels rencontrés :
- **Typos** : `NITRETE DE POTASSE` ≠ « Nitrate de Potasse » · `ACIDE SULFRIQUE` ≠ « Acide Sulfirique »
- **Suffixes / formulations** : `MAP (GK)` ≠ « MAP » · `SIGNUM WG` · `EXIREL TM` · `RADIANT 120 SC`
- **Romain vs chiffre** : `KSC 3` ≠ « KSC III »
- **Abréviations** : `RHIZO BOR` ≠ « Rhizo Bore »
- **Court vs commercial** : `EXTREME` ≠ « Fertiactyl Green Extreme » · `gz` ≠ « Fertiactyl GZ » ·
  `ECOVIGOR` ≠ « Ecovigor AA » · `DEPTIL PA5` ≠ « Deptil »
- **Noms fournisseurs en arabe** (`صطوف المودن`), variantes (`TIMAC` / `TIMAC AGRO MAROC`).

Mesure : matching naïf → 87 « sans BDC » ; normalisé+fuzzy → 71 ; mais **encore des faux positifs
prouvés** (EXTREME, GZ commandés sous nom Fertiactyl). → **un mapping manuel est nécessaire.**

## 2. Modèle de données proposé (Firestore)
Collection **`mapping_articles_bdc`** (ou réutiliser/étendre la logique de `parcelles_consommation`).
Un doc par **article de référence stock/canevas** :
```
{
  article_stock: "MAP (GK)",                 // libellé canevas/stock (clé d'affichage)
  article_canon: "MAP",                       // canon() pour matching
  aliases_beeone: ["MAP"],                    // Produit.Designation BEE ONE correspondants
  aliases_smartberry: ["MAP"],                // items.article purchase_orders
  fournisseurs: ["TIMAC", "HAROUACH"],        // fournisseurs normalisés observés
  statut: "mappe" | "a_mapper" | "ignore",    // a_mapper = en attente validation magasinier
  source_suggestion: "fuzzy" | "exact" | "manuel",
  updated_at, updated_by
}
```
- **`statut: 'a_mapper'`** = flag pour les couples non résolus automatiquement (comme `parcelles_a_mapper`).
- Le rapprochement lit ce mapping : un article réceptionné est « commandé » si son `article_canon`/
  `aliases` matche un BDC (BEE ONE OU Smart Berry) pour un fournisseur cohérent.

## 3. Normalisation (à coder dans le helper de matching)
Règle `canon()` étendue (au-delà du strip d'unité actuel) :
1. Retirer **toute parenthèse** finale (`(GK)`, `(L)`, `(engrais…)`).
2. Retirer tokens taille/formulation : `\d+ ?(KG|L|ML|G|SC|WG|EC|SL)`, `EN \d+L`.
3. Romain → arabe (`III`→3, `II`→2, `IV`→4).
4. Typos fréquents : `NITRETE`→NITRATE, `SULFRIQUE|SULFIRIQUE`→SULFURIQUE, `BOR`→BORE.
5. Collapse espaces, MAJUSCULE, sans accents.
Puis **fuzzy de secours** (Jaccard tokens ≥ 0.5, scopé par fournisseur) → propose un mapping `a_mapper`.

## 4. Liste des couples à mapper (pré-remplie, à valider magasinier)
Sur les 111 couples (fournisseur, article) du canevas : **35 exacts** + **5 fuzzy confirmés** +
**~71 à trancher**.

### 4.1 Fuzzy confirmés (mapping suggéré fort)
| Canevas | → BEE ONE/Smart Berry | Confiance |
|---|---|---|
| ECOVIGOR (L) | Ecovigor AA | 100 % |
| DEPTIL PA5 (L) | Deptil | 50 % |
| CODACIDE | Codacide Oil | 50 % |
| SIGNUM | Signum WG | 100 % |
| EXIREL | Exirel TM | 100 % |

### 4.2 Faux positifs identifiés (à mapper, NE sont PAS des manquants)
`EXTREME` → Fertiactyl Green Extreme · `gz`/`GZ` → Fertiactyl GZ · `NITRETE DE POTASSE` → Nitrate de
Potasse · `MAP (GK)` → MAP · `KSC 3` → KSC III · `RHIZO BOR` → Rhizo Bore.

### 4.3 Vrais manquants confirmés (deep-dive, AUCUN BDC ni facture — à garder hors mapping, ce sont
des anomalies réelles, pas des écarts de nom)
`HUMOCAL` (TIMAC 30 000) · `BIOACTYL SUPERBE` (TIMAC, inexistant BEE ONE) · `SEACTIV GENAKTIS`
(TIMAC) · `OPAL` (TIMAC) · `MAGICAL` (TIMAC).

> La liste complète des ~71 couples résiduels est régénérable à la demande via le script de
> rapprochement (read-only) — non figée ici car elle évoluera avec le mapping.

## 5. Phases (à l'implémentation, GATED)
- **P0** : cette spec.
- **P1** : helper de normalisation étendu + fuzzy (pur, testé). Réutilisable par le rapprochement.
- **P2** : seed `mapping_articles_bdc` (exacts + fuzzy confirmés), reste en `a_mapper`. Écran de
  validation magasinier (comme mapping parcelles).
- **P3** : rapprochement fiable qui lit le mapping → 🟢/🔴/🟠 propres + écarts qté/prix.

## 6. Liens
- Pattern : `project_mapping_parcelles_conso` (mapping parcelles déjà livré, même logique `a_mapper`).
- Source BDC : `docs/spec-workflow-achats.md` (Bon_Commande BEE ONE + purchase_orders Smart Berry).
- Anti-double-comptage des prix : `docs/spec-valorisation-pmp.md` §9.3.
