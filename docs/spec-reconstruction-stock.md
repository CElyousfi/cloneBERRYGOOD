# Spec — Reconstruction du stock par inventaire d'ouverture

> **Statut : GATED (opération destructive sur données prod).** Qualification pour validation Omar
> AVANT toute écriture. Investigation code faite (main). ⚠️ L'aperçu chiffré (soldes actuels,
> before/after) nécessite l'**ADC** (`gcloud auth application-default login`) — re-expiré au moment
> de la qualif. Les nombres seront ajoutés dès l'ADC restauré.

## 1. Diagnostic — pourquoi l'approche actuelle échoue
- Le stock est aujourd'hui reconstruit par un **ledger complet de mouvements** importé du canevas
  (`import-caneva-stock`, `buildMovementDoc` functions/index.js:9525/9568). Cet import **exclut
  déjà** les entrées d'inventaire SQL (`INVENTAIRE`, `STOCK INITIAL`, `INV-*` — index.js:7532/7781)
  → il n'y a **aucun solde d'ouverture fiable**, tout repose sur la complétude du ledger.
- Les soldes sont maintenus à deux endroits : **matérialisé** `stock_balances` (incrémental via
  `applyStockImpact`, index.js:9476) ET **recalcul** à la volée `get-balances-at-date` (itère
  `stock_movements` : `lieu_source −qty`, `lieu_destination +qty` si type≠parcelle ; exclut
  deleted + reception/sortie non `valide_chef`).
- **Problème** : un ledger incomplet/erroné → soldes faux (et négatifs). Pas de point d'ancrage.

## 2. Nouvelle approche (validée Omar) — inventaire d'ouverture + mouvements en avant
**Stock = inventaire d'ouverture daté (vérité de base) + mouvements appliqués en avant.**
Séquence :
1. **Onglet Importation** sur l'écran Inventaire (`MagInventaireTab`, app.jsx:48845) : importer une
   situation d'inventaire à une date (Excel **article × quantité × magasin/parcelle**). Réutilisable
   (un import par clôture de campagne). Crée un **mouvement d'ouverture daté** type
   **`inventaire_ouverture`**.
2. **Importer la situation au 30/06/2025** = solde de départ campagne 2025-2026 (nouvelle vérité).
3. **Appliquer les bons de consommation en avant** (depuis 01/07/2025) — réduisent le stock.
4. **Retirer les bons de sortie de transfert** — ⚠️ *raison à préciser par Omar (Q1)*.

## 3. Modèle de données proposé
### 3.1 Type de mouvement `inventaire_ouverture`
Un doc `stock_movements` :
```
{ type:'inventaire_ouverture', date:'2025-06-30', numero:'INV-OUV-2025-06-30',
  lieu_destination:{type:'magasin', id:<F1..F6>}, lieu_source:null,
  items:[{article_ref, article_nom, quantite, unite}],
  status:'valide_chef',           // impactant directement
  campagne_cible:'2025-2026',      // info (cf. spec campagnes §10/§11)
  import_batch:<id>, created_by:{userId:'import_inventaire', name:'Import Inventaire'},
  created_at, updated_at }
```
- **Impact** : c'est une **entrée** (`lieu_destination +qty`). Aucune source. Pose le solde de base à
  la date. `applyStockImpact` + `get-balances-at-date` le traitent comme une réception validée
  (type à AJOUTER à la liste des types impactants — cf. movementImpact.js / get-balances-at-date).
- **Une parcelle comme lieu** : si l'inventaire porte sur une parcelle (consommation côté charge),
  voir Q4. Par défaut, l'inventaire d'ouverture = stock **magasin** (point de départ des sorties).

### 3.2 Onglet Importation (Inventaire)
- Sous-onglet « Importer » dans `MagInventaireTab` : upload Excel, parse (XLSX dispo front),
  mapping colonnes **Article | Quantité | Unité | Magasin (lieu)** (+ Date d'inventaire).
- Aperçu du parse (lignes lues, articles inconnus, lieux inconnus) AVANT écriture.
- Écriture via **Cloud Function** (gouvernance : pas d'écriture client) `action=import-inventaire-ouverture` :
  crée 1 mouvement `inventaire_ouverture` par (date, magasin) regroupant ses items, idempotent par
  `import_batch`/date.

## 4. Séquence de reconstruction (destructive — chaque étape GATED)
1. **BACKUP complet horodaté** : copier `stock_movements` + `stock_balances` dans
   `stock_backup/<timestamp>/...` (ou export JSON Storage). AUCUNE purge avant backup confirmé.
2. **Définir le périmètre de PURGE** (Q2) : quels mouvements retirer ?
   - Hypothèse : les mouvements du **ledger canevas** (`created_by.userId==='import_caneva'` /
     `numero` `IMP-*`) qui ont échoué + les **bons de transfert** (point 4, Q1) + tout mouvement
     **antérieur au 30/06/2025** (remplacé par l'inventaire d'ouverture).
   - **À CADRER précisément avec Omar** (ne pas purger au jugé).
3. **Importer l'inventaire d'ouverture 30/06/2025** (mouvements `inventaire_ouverture`).
4. **Conserver les bons de consommation** (et réceptions/sorties légitimes ?) depuis 01/07/2025 →
   appliqués en avant.
5. **APERÇU AVANT/APRÈS** (read-only) : soldes par article × magasin **avant** (état actuel) vs
   **après** (inventaire + mouvements conservés). Présenté à Omar pour validation.
6. **GO Omar sur l'aperçu** → exécution de la purge + recompute `stock_balances`.
7. **Soldes négatifs après reconstruction = signal d'un mouvement manquant** → liste les articles
   négatifs pour investigation (NE PAS masquer / forcer à 0).

## 5. Garde-fous (non négociables)
- **Backup complet horodaté** avant toute purge. Réversible.
- **Aperçu avant/après** obligatoire, validé par Omar, jamais de purge silencieuse.
- **Rien purgé en prod sans GO explicite d'Omar sur l'aperçu.**
- Négatifs conservés et signalés (pas masqués).
- Écritures via Cloud Function (transaction/batch chunké 400), pas de client direct.

## 6. Questions ouvertes (à trancher avant code)
- **Q1** : pourquoi retirer les bons de **sortie de transfert** ? (point 4 — raison à préciser).
  Les transferts entre magasins sont net-zéro sur le stock global ; les retirer changerait le détail
  par magasin. Préciser l'intention.
- **Q2** : périmètre exact de la **purge** — uniquement les mouvements canevas `import_caneva` ?
  + tout mouvement antérieur au 30/06/2025 ? Garde-t-on les réceptions/sorties **saisies** après ?
- **Q3** : **consommations à conserver** — celles saisies (BC) ET celles importées du canevas ?
  ou seulement les saisies ?
- **Q4** : l'inventaire d'ouverture porte-t-il aussi sur des **parcelles** (stock côté charge) ou
  uniquement **magasins** ? (le modèle stock = magasin/station ; parcelle = consommation).
- **Q5** : périmètre = campagne 2025-2026 (30/06/2025). Comment s'articule avec la **clôture
  campagne** (un import par clôture) et les **cutoffs** (spec campagnes) ?

## 7. Plan d'implémentation (par phases, chaque phase GATED)
- **Phase A (read-only, AUCUNE écriture)** : aperçu de l'état actuel (soldes, négatifs, stats
  mouvements par type/source/date) — *nécessite ADC*. Livré à Omar pour cadrer Q1-Q5.
- **Phase B** : onglet Importation Inventaire + CF `import-inventaire-ouverture` + type
  `inventaire_ouverture` reconnu par l'impact. Testé. Preview. (N'écrit que le mouvement d'ouverture,
  pas de purge.)
- **Phase C (destructive, GATED)** : backup horodaté → aperçu avant/après → **GO Omar** → purge
  ciblée + recompute → rapport (dont négatifs à investiguer).

> Aucune écriture tant que (a) l'aperçu Phase A n'est pas validé et (b) Q1-Q5 ne sont pas tranchées.
