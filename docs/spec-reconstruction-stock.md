# Spec — Reconstruction du stock par le GRAND LIVRE complet (5 feuilles)

> **Statut : GATED (opération destructive sur données prod).** Qualification + aperçu chiffré
> avant/après pour validation Omar **AVANT toute écriture**. Aucune purge, aucun write Firestore
> tant qu'Omar n'a pas donné son GO sur l'aperçu chiffré ci-dessous. **Backup d'abord.**
>
> **Changement d'approche (validé Omar) :** le fichier `docs/Inventaire Stock 300625.xlsx` n'est
> pas un simple inventaire — c'est le **GRAND LIVRE COMPLET en 5 feuilles**. On abandonne la
> reconstruction « inventaire d'ouverture + on garde les consommations canevas » : on **reconstruit
> tout proprement** à partir de ce fichier, qui est bien meilleur que le canevas.

## 1. Diagnostic — pourquoi l'état actuel est faux
- Le stock prod est reconstruit par le **ledger canevas** (`import-caneva-stock`,
  `buildMovementDoc` functions/index.js:9525/9568), qui **exclut** déjà les lignes d'inventaire SQL
  (`INVENTAIRE`/`STOCK INITIAL`/`INV-*`, index.js:7532/7781) → **aucun solde d'ouverture**, tout
  repose sur la complétude du ledger.
- **État prod constaté (ADC, lecture seule) :**
  - `stock_movements` = **4109** docs : **4096** `created_by.userId='import_caneva'` + **13** saisis
    (7 sans créateur tracé + 6 par 2 vrais UID). Types : consommation 3139, transfert 777,
    reception 185, sortie 8.
  - **2 mouvements à date malformée** : `01/19/2026` (MM/DD/YYYY) et `""` (vide).
  - `stock_balances` = **342** soldes ; **64 NÉGATIFS**, dont des gros (`−600` Sulfate d'ammoniaque
    F2, `−600` Sulfate de Magnésie F2, `−285` F1, `−276` Nitrate de Calcium F2, `−244,8`
    Ammonitrate F2…). → **ledger cassé, sans point d'ancrage.**

## 2. Nouvelle approche — reconstruction comptable depuis le grand livre
**Modèle : `Stock = Inventaire 30/06 + Entrées − Consommations − Sorties ± Transferts`.**
On purge le ledger canevas et on **réimporte les 5 feuilles dans l'ordre comptable**, chacune
devenant des `stock_movements` typés. Le solde se recalcule ensuite (`get-balances-at-date` /
recompute matérialisé), sans aucun solde forcé.

### 2.1 Contenu du fichier (lecture seule, vérifié)
| Feuille | Lignes | Rôle | Colonnes utiles |
|---|---|---|---|
| INVENTAIRE AU 30-06-25 | **162** (82 articles, 5 magasins) | solde d'ouverture daté | LA DATE, LIEU DE STOCK, NOM ARTICLE, UNITE, QUNTITE, PRIX TTC |
| BONS D ENTREE | **318** | réceptions fournisseur | LIEU DE STOCK, DATE, N° BL, FOURNISSEUR, NOM ARTICLE, UNITE, QUNTITE, PRIX |
| BONS DE TRANSFERT | **2402** | mouvements inter-magasins | DATE, N° BON, LIEU DEPART, LIEU ARRIVEE, NOM ARTICLE, QUNTITE |
| BONS CONSOMMATION | **16288** | sorties vers parcelles (charge) | DATE, N° BON, LIEU DEPART, PARCELLE ARRIVEE, CODE ARTICLE, NOM ARTICLE, UNITE, QUNTITE |
| BONS SORTIE | **8** | sorties hors-exploitation (EL BAHIA, prêt…) | LIEU DE STOCK, DATE, N° BON, DESTINATION, NOM ARTICLE, UNITE, QUNTITE, MOTIF |

Total ≈ **19 178 lignes-mouvements** source.

### 2.2 Inventaire d'ouverture (162 lignes)
- Dates : 153 au **2025-07-01**, + 6 au 2025-12-30, 2 au 2026-03-31, 1 au 2026-05-31 (réajustements
  d'inventaire datés — à traiter comme mouvements d'ouverture/ajustement à leur date respective).
- **5 lignes à quantité négative** dans l'inventaire = ajustements signés réels (conserver tels
  quels, ne pas masquer).
- Magasins : F-01 (67), F-05 (41), F-02 (40), F-06 (13), F-03 (1). F-04 absent de l'inventaire =
  magasin pass-through (alimenté par transfert puis consommé).

## 3. Mapping & normalisation (résolus)
### 3.1 Lieux de stock `F-0X` → magasins prod `FX` (tiret → sans tiret)
`F-01→F1, F-02→F2, F-03→F3, F-04→F4, F-05→F5, F-06→F6`. **Les 6 existent déjà en prod**
(`magasin_F1..F6`, dont `magasin_F3`=30 soldes, `magasin_F4`=23). Aucune ambiguïté. (Légende du
fichier : « Magasins : F1, F2, F5, F6 » + « Stations : Station F1 à Station F6 » — mais la colonne
LIEU DE STOCK n'utilise que F-01..F-06, tous mappés en magasins.)

### 3.2 Article = clé par NOM normalisé (point critique)
L'import canevas pose `article_ref = article_nom = <NOM ARTICLE>` (index.js:5877/6154) ; le
`balanceId = lieu_type_lieu_id_article_ref` (espaces→`_`). **Il n'y a pas de catalogue d'articles
séparé** (collection `articles` inexistante) : le nom EST la clé. La colonne `CODE ARTICLE`
(conso/sortie) est **vide** dans tout le fichier → inutilisable.
→ **L'importateur DOIT normaliser le nom de façon identique partout** (MAJUSCULES, trim, espaces
collapsés, suffixe d'unité `(L)/(KG)/…` retiré). Sans ça, une même substance écrite `ksc 5` vs
`KSC 5` ou `RHIZO hUMUS (L)` crée 2 clés de solde dont une part en négatif.
**Impact mesuré : la normalisation fait passer les articles globalement négatifs de 15 → 11.**

### 3.3 PARCELLE ARRIVEE (consommations) → bucket CPC
20 libellés distincts de PARCELLE ARRIVEE (ex. « S3 MARAVILLA MOTTE F1 », « S1/S4 MARAVILLA MOW
DOWN F1 »). Ce sont les **destinations de charge** → reliées au module **Mapping parcelles de
consommation** (`PARCELLE_TO_CPC`). Côté stock global, une consommation **réduit** le magasin de
départ ; la parcelle d'arrivée est une dimension de charge (pas un lieu de stock), conforme au
modèle Fiche de Stock déjà livré.

### 3.4 Transferts intra-magasin (353)
353 transferts ont **LIEU DEPART == LIEU ARRIVEE** (352 F-02→F-02, 1 F-01→F-01) → **net-zéro** sur
le solde (même lieu des deux côtés). Probablement des re-saisies / sous-emplacements non modélisés.
**Décision proposée : les importer tels quels (impact nul) OU les ignorer** — aucun effet sur les
soldes dans les deux cas. À confirmer par Omar (défaut : ignorer, pour ne pas polluer l'historique).

## 4. Séquence de reconstruction (chaque étape GATED, dans cet ordre)
1. **BACKUP complet horodaté** : `stock_movements` (4109) + `stock_balances` (342) → JSON Storage
   `stock_backup/<ts>/`. **Aucune purge avant backup confirmé.**
2. **PURGE** : supprimer les **4096** mouvements `import_caneva` + les **2** dates malformées si
   elles en font partie. **GARDER les 13 saisis** (vrais utilisateurs). (Q : les 2 malformés
   sont-ils dans les 4096 canevas ou dans les 13 saisis ? → vérifié à l'exécution ; si saisis, on
   corrige la date au lieu de purger.)
3. **IMPORT des 5 feuilles dans l'ordre comptable**, via Cloud Function (gouvernance : pas
   d'écriture client), idempotent par `import_batch` :
   `inventaire (ouverture) → entrées (reception) → transferts → consommations → sorties`.
4. **RECALCUL** des soldes matérialisés (`stock_balances`) + cohérence avec `get-balances-at-date`.
5. **APERÇU AVANT/APRÈS chiffré** (déjà calculé en read-only ci-dessous, §6) → **GO Omar**.
6. **Investigation des négatifs résiduels** = manquants réels (NE PAS forcer à 0).

## 5. Onglet Importation (réutilisable, par clôture)
- Nouveau sous-onglet « Importer » dans `MagInventaireTab` (app.jsx:48845) : upload Excel 5 feuilles,
  parse front (XLSX dispo), **aperçu du parse** (lignes lues par feuille, lieux/articles inconnus,
  négatifs) AVANT écriture.
- Écriture via CF `action=import-grand-livre` (ou réutilise/étend `import-caneva-stock`) :
  crée les `stock_movements` typés, batch chunké 400, idempotent par `import_batch`/date.
- Réutilisable à chaque clôture de campagne (un grand livre par campagne — cf. spec campagnes §10/§11).

## 6. APERÇU AVANT / APRÈS (read-only — chiffres réels)
> Calcul « après » = reconstruction du grand livre seul (Inv+Entrées−Conso−Sorties±Transferts),
> clé = nom d'article normalisé. Aucun write effectué.

| | **AVANT (prod, ledger canevas)** | **APRÈS (grand livre reconstruit)** |
|---|---|---|
| Mouvements | 4109 (4096 canevas + 13 saisis) | ≈19 178 lignes (162+318+2402+16288+8) |
| Soldes (lieu×article) non-nuls | 342 | 203 |
| **Soldes négatifs** | **64** (gros : −600, −600, −285, −276, −244,8…) | **~11 articles** (petits : −15 max) |
| Nature des négatifs | ledger cassé (bruit) | sur-consommation réelle mineure à investiguer |

**Articles globalement négatifs après reconstruction (11, normalisés)** — *manquants réels à
investiguer, pas un bug d'import* :
`N-K-P −15 · KELPARK −10 · SC CALCIUM −9 · KALIGREEN −6 · RADIAN −4,6 · SCORE −4,1 · ORTIVA −2,9 ·
MEGAFOL −2 · MILBEKNOCK −1,3 · TOPAS −1,1 · CODACIDE −0,4`.
**0 article consommé sans jamais avoir été stocké** (inv+entrées couvrent 100 % des articles
consommés) → la base d'articles du fichier est complète.

**Lecture :** on passe de **64 négatifs aberrants** (jusqu'à −600) à **~11 négatifs mineurs** (≤15),
tous explicables par une légère sur-consommation — exactement le résultat attendu d'un ledger sain.

## 7. Garde-fous (non négociables)
- **Backup complet horodaté** avant toute purge. Réversible.
- **Aperçu avant/après** (ce §6) validé par Omar — jamais de purge silencieuse.
- **Rien purgé/écrit en prod sans GO explicite d'Omar.**
- Négatifs **conservés et signalés** (pas masqués, pas forcés à 0).
- Écritures via Cloud Function (batch chunké 400), pas de client direct.
- Normalisation de nom d'article **identique** entre toutes les feuilles (sinon faux négatifs).

## 8. Points à confirmer par Omar avant code
- **P1 — Transferts intra-magasin (353)** : ignorer (défaut, recommandé) ou importer en net-zéro ?
- **P2 — Dates d'inventaire multiples** : les 9 lignes d'inventaire datées après le 01/07 (30/12,
  31/03, 31/05) = ajustements à leur date (recommandé) ou tout ramener au 30/06 ?
- **P3 — 2 mouvements malformés** prod : si dans les 13 saisis, on corrige la date ; si dans les
  4096 canevas, purgés avec le lot. (tranché à l'exécution, signalé.)
- **P4 — Transferts vers EL BAHIA (8 dans la feuille transfert) + 8 bons de sortie EL BAHIA** :
  EL BAHIA = lieu `externe` (déjà en prod). Conserver comme sorties externes (recommandé).

> **Aucune écriture tant qu'Omar n'a pas validé l'aperçu §6.** Backup d'abord, puis purge ciblée,
> puis import des 5 feuilles, puis recalcul, puis investigation des 11 négatifs.
