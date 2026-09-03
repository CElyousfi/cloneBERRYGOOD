# Architecture backend — PROPOSITION (Phase 3)

> **Statut : à approuver. Aucune ligne de code backend n'a été déplacée.**
> Le document de migration ne couvrait que le frontend ; cette architecture est
> proposée ici pour approbation avant tout mouvement.

---

## 1. L'existant, mesuré

| | |
|---|---|
| `functions/index.js` | **19 463 lignes** |
| Exports au runtime | **105** (91 déclarés dans `index.js`, le reste délégué) |
| Surface HTTP | 57 `onRequest` · 10 `pubsub.schedule` · 5 déclencheurs Firestore |
| Actions distinctes | **277** (`?action=…`) |
| `functions/lib/` | **44 sous-domaines** de logique pure, déjà extraite et testée |
| Autres gros fichiers | `pointageService.js` 5 976 · `emailService.js` 5 043 · `sqlSyncService.js` 1 548 |

**Le motif dominant.** Un export = une fonction HTTP par domaine, qui aiguille en
interne sur `?action=`. Le déséquilibre est extrême :

| Export | Lignes | Actions |
|---|---|---|
| `stockManagement` | **6 557** | **119** |
| `caisseManagement` | 1 612 | 31 |
| `validation` | 974 | — |
| `indoorForecast` | 743 | — |
| `horsRecolteService` | 568 | — |

`stockManagement` pèse à lui seul **un tiers** du monolithe.

---

## 2. Structure cible

```
functions/
  index.js                    # barrel de re-export, < 100 lignes, ZÉRO logique
  src/
    modules/
      magasin/
        magasin.routes.js     # l'onRequest + la table d'aiguillage des actions
        actions/              # un fichier par action (ou par famille d'actions)
          createArticle.js
          createMovement.js
          …
        magasin.service.js    # logique métier
        magasin.repository.js # accès Firestore
        magasin.validators.js # validation des entrées
        magasin.triggers.js   # déclencheurs Firestore / planifiés
      caisse/  rh/  agronomie/  qualite/  recolte/
      finance/ achats/ technique/ admin/ securite/
    shared/
      firestore.js  auth.js  errors.js  logger.js  validation.js
    config/
  lib/                        # INCHANGÉ — voir §4
```

Règle de taille identique au frontend : un domaine modeste reste plat, un domaine
lourd prend toutes les couches. **Aucun fichier au-dessus de 2 000 lignes.**

---

## 3. L'invariant qui gouverne tout : les noms d'export

Une Cloud Function est adressée **par son nom d'export**. Le renommer supprime
l'ancienne fonction et en crée une neuve : l'URL HTTP change, le déclencheur
Firestore se détache, la tâche planifiée perd son cron, les clients en vol
cassent.

Donc : `index.js` devient un barrel qui **réexpose exactement les mêmes 105 noms**.

```js
// functions/index.js — barrel, aucune logique
const magasin = require('./src/modules/magasin/magasin.routes');
exports.stockManagement = magasin.stockManagement;
exports.mappingConsoManagement = magasin.mappingConsoManagement;
// …
```

Garde à chaque étape, déjà en place et déjà verte :

```bash
node -e "console.log(Object.keys(require('./functions')).sort().join('\n'))" \
  | diff /tmp/exports-before.txt -    # doit rester vide
```

Référence figée : **105 noms**, `/tmp/exports-before.txt`.

---

## 4. Décision à trancher : que faire de `functions/lib/` ?

`functions/lib/` contient déjà 44 sous-domaines de **logique pure, extraite et
couverte par des tests** (`bcScan`, `campagneBudget`, `paie`, `primes`, `stock`…).
C'est, de fait, la couche « service pure » que la cible réclame — déjà faite.

La cible du brief place tout sous `functions/src/`. Déplacer `lib/` sous `src/`
casserait **plus d'une centaine de chemins `require`** et les tests qui les
suivent, pour un gain purement cosmétique.

**Recommandation : laisser `functions/lib/` où il est.** Les modules de
`src/modules/` le consomment. On documente que `lib/` EST la couche pure du
backend. Si l'uniformité de l'arborescence prime malgré tout, le déplacement se
fait en un commit dédié, purement mécanique, à la toute fin — jamais mélangé à un
portage de fonctionnalité.

---

## 5. Les gros services hors `index.js`

`pointageService.js` (5 976) et `emailService.js` (5 043) dépassent aussi la
limite. Ils suivent la même règle : `pointageService` part dans `modules/rh/`,
`emailService` dans `shared/` ou `modules/admin/`, découpés par responsabilité.
À traiter **après** `index.js` — ils sont moins risqués, personne ne les adresse
par leur nom de fichier.

---

## 6. Séquencement proposé

Un domaine à la fois, du plus petit au plus gros, pour que la méthode soit rodée
avant d'atteindre `stockManagement` :

1. `securite` (1 export) — le patron de référence, sur le plus petit périmètre
2. `caisse` (1 export, 1 612 lignes, 31 actions) — première vraie table d'actions
3. `qualite`, `achats`, `finance`, `recolte`, `agronomie`, `technique`, `rh`
4. `admin` — le fourre-tout, à re-répartir plutôt qu'à reproduire
5. **`magasin` / `stockManagement` en dernier** — 6 557 lignes, 119 actions

Pour chaque domaine, **deux commits séparés**, jamais fusionnés :
d'abord le déplacement structurel à comportement identique, ensuite seulement
tout ajustement. Si quelque chose casse, on sait lequel des deux en est la cause.

Après chaque domaine, les quatre mêmes contrôles :

```
diff exports (vide) · node --test (vert) · parity_check.py backend · emulator démarre
```

---

## 7. Le point de vigilance

`stockManagement` n'est pas gros par accident : 119 actions qui partagent des
caches en mémoire (`_articleHistoryCache`, `_identiteArticleCache`,
`_pmpInvoiceCache`) et des helpers de fermeture. Découper naïvement par action
**dupliquerait ces caches** — chaque module aurait le sien, et deux actions
voisines liraient deux états différents. Ces caches doivent monter dans un
`magasin.repository.js` unique, importé par toutes les actions, avant tout
découpage.

C'est le risque n°1 de cette phase, et la raison pour laquelle ce domaine passe
en dernier.

---

## 8. Ce que je demande

1. **Valider la structure** du §2.
2. **Trancher le §4** — `functions/lib/` reste en place (ma recommandation), ou
   migre sous `src/`.
3. **Valider le séquencement** du §6, `stockManagement` en dernier.

Sans ces réponses, rien ne bouge côté backend.
