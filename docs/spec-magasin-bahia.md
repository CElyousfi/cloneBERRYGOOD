# Spec — Régulariser BAHIA comme magasin de stock (GATED)

> **Statut** : en attente de GO Omar. Deux étapes indépendantes, chacune avec son propre GO.
> Ce document est autosuffisant : une autre session doit pouvoir exécuter sans ré-analyser.
> Ticket lié : branche `sb/magasin-bahia` (Lot 1 code, déjà livré et QA-approuvé).

## 1. Contexte

Bug prod remonté le 2026-08-20 par Hassan (profil Magasinier) : sur le BDC-2026-0160
(TIMAC AGRO, **ferme BAHIA**), le popup « Réception — BDC » ne propose que `F1..F6` en
« Magasin destination ». Impossible de réceptionner dans BAHIA.

Cause racine — deux référentiels désynchronisés et un typage divergent :

1. `FARMS` ([public/app.jsx:452](../public/app.jsx#L452)) autorise 8 fermes sur un BDC, dont BAHIA.
2. `stock_config/locations.magasins` (Firestore) ne contient que `F1..F6` → c'est cette liste
   qui alimente **tous** les dropdowns magasin via `window.useStockLocations()`.
3. Le stock BAHIA existant est typé `lieu_type: 'externe'`, parce que l'import CANEVA le classait
   ainsi ([functions/lib/stockCaneva/mappings.js](../functions/lib/stockCaneva/mappings.js), `buildLieu`).

Or `lieu_type` fait partie de l'identifiant du solde
(`` `${lieu_type}_${lieu_id}_${article_ref}` ``, [functions/index.js:10247](../functions/index.js#L10247)) :
`externe_BAHIA_<ref>` et `magasin_BAHIA_<ref>` sont **deux stocks distincts** pour le même produit
au même endroit physique.

Précédent identique : F3/F4, corrigés par le commit `e64cb5f` en ajoutant les magasins à la config.
BAHIA n'a jamais été traité.

## 2. Ce qui est déjà fait (Lot 1, hors GATE)

Livré sur `sb/magasin-bahia`, `npm run qa` vert :

- Garde-fou UI : la ferme du BDC est toujours proposée dans le select, suffixée
  `(hors config stock)` + avertissement si elle n'est pas déclarée dans la config
  (`public/lib/stockDestinations.js`, `resolveDestinationOptions`).
- Import CANEVA : `buildLieu('BAHIA')` → `{type:'magasin', id:'BAHIA'}`. Les destinations
  **non-ferme** (décharge, client, prestataire) restent `externe` — variante restrictive
  volontaire, verrouillée par un test.
- Filtre « Type lieu » de Soldes Stock dérivé des types réellement présents (union avec
  `magasin`/`station` toujours proposés).

**Effet** : le bug fonctionnel disparaît sans aucune écriture Firestore. BAHIA reste marqué
« hors config stock » tant que l'étape 3 n'est pas faite.

## 3. Étape A — Déclarer BAHIA comme magasin (GATED, réversible)

**Ce que ça change** : BAHIA apparaît dans **tous** les dropdowns magasin (Réception BDC, Bons de
Réception, Transferts, Sorties, Bons de Consommation, filtre Historique) et le suffixe
« hors config stock » disparaît.

**Action** : `POST /api/stock?action=set-locations`, rôle `dg` ou `finance` (dérivé du token),
body :

```json
{ "magasins": ["F1", "F2", "F3", "F4", "F5", "F6", "BAHIA"] }
```

⚠️ **`buildLocationsPatch` REMPLACE le tableau, il ne l'étend pas**
([functions/lib/stock/locationsConfig.js:42-47](../functions/lib/stock/locationsConfig.js#L42-L47)).
Donc : **d'abord lire** `GET /api/stock?action=get-locations`, puis renvoyer la liste complète
existante + `BAHIA`. Ne jamais poster une liste construite de mémoire — on effacerait des magasins.

- Le write est un `set(patch, {merge:true})` : `stations` et `parcelles` ne sont pas touchés.
- Idempotent : rejouer la même liste ne change rien.
- **Réversible** : reposter la liste sans `BAHIA` restaure l'état antérieur.
- Aucune validation de valeur côté serveur : `'BAHIA'` est accepté tel quel.

**Vérification** : `get-locations` renvoie les 7 magasins ; recharger l'app → BAHIA proposé sans
suffixe ni avertissement.

**Décision ouverte pour Omar** : faut-il ajouter `Avocatier` en même temps ? Aujourd'hui aucun
solde ne lui est rattaché, donc la réponse par défaut est **non** — à ajouter le jour où un stock
y sera tenu.

## 4. Étape B — Migrer les soldes orphelins (GATED, irréversible)

**Le problème** : le stock BAHIA déjà en base est sous `externe_BAHIA_*`. Après l'étape A, les
nouvelles réceptions créeront `magasin_BAHIA_*`. Sans migration, **deux lignes BAHIA coexisteront
pour un même article** dans Soldes Stock (une `Externe`, une `Magasin`).

Exemple constaté sur la capture prod du 2026-08-20 : `BAHIA / Externe / AZO PRO 31 / 2 500,0 KG`.

### B.1 — Dry-run obligatoire (lecture seule, autonome)

Script `scripts/migrate-bahia-magasin.js --dry-run`, à écrire. Il doit rapporter, sans rien écrire :

- nombre et liste des docs `stock_balances` dont `lieu_type === 'externe' && lieu_id === 'BAHIA'`,
  avec `article_ref`, `article_nom`, `balance` ;
- pour chacun, si le doc cible `magasin_BAHIA_<ref>` existe déjà (→ cas de **fusion**, additionner
  les balances) ou non (→ simple ré-écriture) ;
- nombre de `stock_movements` dont `lieu_source` ou `lieu_destination` vaut
  `{type:'externe', id:'BAHIA'}`, ventilés par `type` et `status` ;
- le total de stock déplacé, par article.

Ce rapport chiffré est présenté à Omar. **Pas d'écriture avant son GO sur les chiffres.**

### B.2 — Exécution (après GO explicite sur le dry-run)

Ordre impératif :

1. **Backup préalable** des collections `stock_balances` et `stock_movements` (export vers
   Storage, comme le fait `scripts/apply-pmp-catalogue.js` avant écriture). Sans backup, on
   n'exécute pas.
2. Réécrire les `stock_movements` : `lieu_*.type` `externe` → `magasin` quand `id === 'BAHIA'`.
   Batch par chunks de 400 (limite Firestore 500, marge 100 — convention du repo).
3. Reconstruire les soldes plutôt que de bricoler les docs `stock_balances` un par un :
   `rebuildBalances` ([functions/index.js:10402](../functions/index.js#L10402)) recalcule tout
   depuis les mouvements **et supprime les soldes absents du rebuild** — les `externe_BAHIA_*`
   disparaissent donc d'eux-mêmes, sans risque de doublon ni de solde fantôme.
   ⚠️ `rebuildBalances` a besoin des `balancesInit` (inventaire d'ouverture 30/06/2025) : vérifier
   comment ils sont fournis hors contexte d'import CANEVA avant de s'appuyer dessus. Si ce n'est
   pas praticable, replier sur une réécriture doc par doc avec fusion explicite des balances.

### B.3 — Contrôle post-migration

- Aucun doc `stock_balances` avec `lieu_type === 'externe' && lieu_id === 'BAHIA'`.
- Le total par article avant/après est **identique** (c'est le contrôle qui fait foi).
- Soldes Stock : une seule ligne BAHIA par article, typée `Magasin`.
- Fiche de Stock d'un article BAHIA : historique continu, pas de rupture à la date de migration.

## 5. Effet de bord à annoncer avant le premier import CANEVA post-deploy

`movementKey` ([functions/lib/stockCaneva/index.js](../functions/lib/stockCaneva/index.js)) inclut
`lieuKey(lieu_destination)`. Le passage `externe:BAHIA` → `magasin:BAHIA` **change l'empreinte** de
toutes les journées contenant un mouvement BAHIA : au premier import suivant, ces journées
basculeront de « identiques » à « **modifiés** » → `requires_finance: true` et réécriture des
mouvements du jour.

Ce n'est pas une perte de données, mais Finance verra un volume inhabituel de journées à valider.
**À annoncer avant, pas après.**

## 6. Risques et points de vigilance

| Risque | Gravité | Mitigation |
|---|---|---|
| `set-locations` écrase la liste des magasins | élevé | lire `get-locations` d'abord, toujours |
| Migration sans backup | élevé | backup Storage obligatoire, étape 1 non négociable |
| Doublon de soldes si étape A sans étape B | moyen | faire B peu après A ; le filtre « Type lieu » permet de les repérer en attendant |
| Finance surprise par le volume de journées « modifiées » | faible | §5, prévenir avant |
| `Avocatier` oublié | faible | pas de stock aujourd'hui ; même procédure le jour venu |

## 7. Dette de fond constatée (hors périmètre, à arbitrer plus tard)

- **Aucun référentiel unique de lieux** : au moins 17 listes de fermes/lieux coexistent, la
  plupart hardcodées (`DG_FARMS` écrit `'Bahia'`, `MSF_FARMS` écrit `'bahia'`, achats à 3 fermes,
  `METEO_FERMES` à 3, `agqParser` à 7…). Rien ne teste leur cohérence.
- **Aucune UI pour éditer `stock_config/locations`** : `set-locations` n'est appelé nulle part
  dans `public/`. Toute évolution passe par un appel API manuel — c'est précisément ce qui a fait
  oublier BAHIA, puis F3/F4 avant lui.
- **Cinq implémentations parallèles de la règle de delta** (`applyStockImpact`,
  `reverseStockImpact`, `movementDelta`, `get-balances-at-date`, `articleHistoryIndex`) aux
  filtres divergents : une `sortie` en `valide_mag` compte dans le rebuild mais pas dans
  `get-balances-at-date`.
- **`stock_balances.seuil_alerte`** est lu par 3 écrans mais **jamais écrit** → le KPI « En alerte »
  du Dashboard Stock est structurellement toujours à 0.
