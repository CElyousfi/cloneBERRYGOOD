# Spec — Workflow Achats : paysage des données BEE ONE (exploration)

> **Statut : EXPLORATION CONSIGNÉE (read-only, 2026-06-16).** Mémoire du paysage SQL pour concevoir
> le workflow achats plus tard **sans re-explorer 1004 tables**. Aucune conception de workflow ici
> (Omar doit d'abord trancher des questions métier). Aucun code, aucun import.

## 0. Accès (pour les sessions futures)
- **Serveur SQL BEE ONE** : `105.145.33.128:1433` (config dans `functions/config/sqlConfig.js`, lue
  depuis l'env). **Identifiants en local** : charger `functions/.env` (Desktop, gitignored) +
  `require('mssql')` → `sql.connect(require('./config/sqlConfig'))`. **READ-ONLY uniquement.**
- Canonicalisation des noms d'articles (pour matcher avec les soldes Firestore) : `canon()` identique
  à `scripts/reconstruct-stock.js` (MAJUSCULE, trim, collapse espaces, retrait suffixe unité `(L|KG|G|ML|UNITE|U)`).

## 1. Les 3 bases du serveur
| Base | Tables | Rôle |
|---|---|---|
| **`BEE_BERRY_GOOD`** | **947** | **ERP BEE ONE complet** — achats, stock, paie, production, observations… La vraie base opérationnelle. |
| `BR_BERRY_GOOD` | 45 | Couche **reporting** : tables `BR_*` **plates/dénormalisées** (BR_Achat, BR_Consommation, BR_Cueillette, BR_Pointage…). C'est ce que `sql_mirror_*` Firestore synchronise. |
| `GPW_BEE ONE` | 12 | Utilisateurs / droits (GPU_*). |

> Les `sql_mirror_consommation/cueillette/pointage` (Firestore) viennent de `BR_BERRY_GOOD`. **Les
> achats ne sont PAS mirrorés** → il faut requêter le SQL directement.

## 2. Chaîne d'achat dans `BEE_BERRY_GOOD` (vrai modèle en-tête/lignes/statuts)
```
Demande_achat (242 DA)
   └─ Article_Demande_achat (519 lignes ; Qte, Prix_U_HT)   ← 115 lignes avec prix>0
        └─ Achat_Bon_Commande (490 ; lien DA↔BC : IDDemande_achat, ID, Qantite_commande, Reliquat)
             └─ Bon_Commande (219 BDC en-têtes)
   tables liées : Bon_Commande_validation, Bon_Commande_History, Bon_Commande_Mouvement_stock,
                  Demande_achat_Bon_Commande, devis_fournisseur(_articles), Livraison_Bon_Reception,
                  Bon_Reception_Frais_generaux, Facture (+ Detail_Facture_*)
```

### 2.1 `Bon_Commande` (219 lignes, 2025-07-23 → 2026-05-21)
Colonnes : `IDBon_Commande, IDFournisseur, Date_BC, Adress_Livraison, Delai_Livraison, Num_BC,
TypeArt, Total_Mnt_Brut_HT, Total_Mnt_net_HT, Total_Mnt_net_TTC, Statut, Total_Mnt_TVA, IDSociete,
Conditions_reglement, Informations_complementaire, CreatedBy, DateUpdate, UpdateBy, IDProfilCreate,
IDProfilUpdate, DateCreated, IDconsultation_fournisseurs, Mode_BC, IS_CF, IS_imprime`.
- **Statuts** : `En cours` = 218, `Clôturer` = 1. → workflow BDC peu clôturé en pratique.
- Couvre la campagne 2025-2026. Vrai en-tête : fournisseur, montants HT/TTC/TVA, conditions, statut.

### 2.2 `Demande_achat` (242) — en-tête DA
`IDDemande_achat, Date_DA, Libille, Num_DA, Statut, TypeArt, IDService_demandeur, IDFermes,
niveau_validation, ctr_budget, …`

### 2.3 `Article_Demande_achat` (519 ; 115 avec prix) — lignes DA
`IDDemande_achat, ID (→ Produit.ID), ID_Article_demande_achat, Qte, Prix_U_HT, Reliquat, Nbr_ligne`

### 2.4 `Produit` (946 ; master article BEE ONE)
`ID, Designation, Ref, Reference, PU, PU_HT, Unite, solde, Categorie, Sous_Categorie, TVA,
Peut_etre_achete, DA_obligatoire, BC_obligatoire, …`
- **PU_HT renseigné pour 60 articles seulement.** `solde` = stock BEE ONE.

## 3. Valorisation BEE ONE — structurée mais quasi vide
| Table | Lignes | Champs valo | Constat |
|---|---|---|---|
| `Mouvement_stock` | 13 421 | `PU, PU_HT, CMUP, CMUP_HT_TTC, solde, Montant_brut/net/TTC/TVA`, liens `BC/BL/BR`, `Valide, Statut, IDDepots` | Ledger stock complet, **mais CMUP peuplé à 2 %** (268/13421), PU_HT à 0 % (44). Produits par **ID** (→ `Produit`). |
| `Produit.PU_HT` | 946 | prix de référence | 60 articles avec prix |
| `Facture` | **0** | — | vide (factures dans l'app Firestore `invoices`) |
| `devis_fournisseur_articles` | **0** | Prix_U_HT, PU_TTC | vide |
| `CMUP_cent` / `PMP_cent` / `CMUP_Mensuel` | **0** | CMUP/PMP | **structures présentes, NON utilisées** |

> BEE ONE a les tables pour calculer CMUP/PMP mais ne les remplit pas. `Mouvement_stock.CMUP` n'est
> calculé que sur ~268 mouvements récents.

## 4. Couverture PRIX de TOUTES les sources (vs 96 articles en stock)
| Source | Couverture | Verdict |
|---|---|---|
| `BR_Achat.Cout` (reporting BR_BERRY_GOOD) | ~10 % | dupliqué ×80, Cout épars, récent |
| BEE ONE `Mouvement_stock.CMUP` | 2 % | quasi vide |
| BEE ONE `Produit.PU_HT` (réf) | 15 % | prix de référence partiel |
| App `purchase_orders` (Firestore) | 15 % | BDC récents 2026 |
| App `invoices` (Firestore) | ~1 doc | vide → vraie source future |
| **Grand livre (entrées + inventaire 30/06)** | **100 %** | **seule source complète** |

Les prix BEE ONE présents **concordent** avec le grand livre (Acide Nitrique 7,30 · Rhizo Bore 9,56 ·
Nitrate de Potasse 14,16) → cohérence confirmée, mais couverture trop faible pour servir de source.

## 5. Verdict
1. **`Bon_Commande` (BEE_BERRY_GOOD) = la vraie table BDC** pour un futur **workflow achats** : modèle
   en-tête/lignes/statuts/fournisseur/montants, 219 BDC 2025-2026, avec validation/historique/réception/
   facture. C'est ici qu'il faudra brancher (lecture/sync des BDC, statuts, lien réception).
2. **Aucune source de prix BEE ONE ne dépasse 15 %** : modules achat/valo de l'ERP **structurés mais
   peu utilisés** (BDC « En cours » non clôturés, CMUP/Facture vides). → **Le grand livre reste la
   source PMP** (100 %, en prod, cf. `spec-valorisation-pmp.md`).
3. BEE ONE = **appoint futur** pour le prix quand l'ERP achat sera mieux rempli ; ou source du
   **workflow BDC** (statuts/réceptions) indépendamment du prix.

## 6. Pièges connus (pour ne pas se retromper)
- `BR_Achat` (reporting) : **dupliqué ×80** (60397 → 760 distinctes) → dédupliquer ; exclure lignes
  `Fournisseur IN ('INVENTAIRE','STOCK INITIAL','INV-%','F-0X')` (Cout=0).
- `Mouvement_stock.Produit` = **ID numérique** → joindre `Produit` (ID → Designation) avant tout
  matching par nom.
- **RÈGLE ANTI-DOUBLE-COMPTAGE** (cf. `spec-valorisation-pmp.md` §9.3) : les achats/réceptions BEE ONE
  sont les **mêmes événements** que les bons d'entrée du grand livre → ne jamais les ajouter comme
  quantités ; seulement comme prix sur une acquisition déjà connue.

## 7. Questions métier à trancher (Omar) AVANT toute conception de workflow
*(à compléter — Omar répondra ; ne pas concevoir le workflow avant.)*
