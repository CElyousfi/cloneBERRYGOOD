# Architecture backend — livrée

> État : **appliquée**. `functions/index.js` est un barrel ; plus aucun fichier
> backend ne dépasse 2 000 lignes. Ce document remplace
> `ARCHITECTURE_BACKEND_PROPOSAL.md`, gardé pour l'historique de la décision.

---

## 1. Avant / après

| | avant | après |
|---|---|---|
| `functions/index.js` | 19 463 lignes | **114 lignes**, zéro logique métier |
| `functions/pointageService.js` | 5 976 | 248 + 6 fichiers |
| `functions/emailService.js` | 5 043 | 1 400 + 5 fichiers |
| plus gros fichier backend | 19 463 | **1 629** |
| exports Cloud Functions | 105 | **105, diff vide** |

---

## 2. La structure

```
functions/
  index.js                       # BARREL : 105 re-exports, aucune logique
  src/
    shared/core.js               # préambule + helpers partagés par ≥2 domaines
    modules/
      magasin/
        magasin.stock.js         # entrée HTTP : prologue + boucle de dispatch
        magasin.stock.actions1..6.js   # les 118 actions, corps verbatim
        magasin.stock.deps.js    # requires et helpers du domaine
        _dispatch.js             # la sentinelle NOT_HANDLED
        magasin.js               # les autres exports du domaine
      caisse/  rh/  agronomie/  recolte/  finance/  technique/  securite/  admin/
  lib/                           # INCHANGÉ — 44 sous-domaines de logique pure
  pointageService.{js,part1,part2,actions1..4,dispatch}.js
  emailService.{js,part1,part2,actions1..3,dispatch}.js
```

**`functions/lib/` n'a pas bougé** — décision assumée. Il contenait déjà 44
sous-domaines de logique pure et testée : c'est, de fait, la couche « service
pure » que la cible réclamait. Le déplacer sous `src/` aurait cassé plus de cent
chemins `require` et les tests qui les suivent, pour un gain purement cosmétique.

---

## 3. Les trois règles qui ont gouverné le découpage

### 3.1 Les corps ne sont pas réécrits

Chaque bloc est recopié **verbatim**. Ce qui est ajouté se limite à :
un préambule de `require`/destructuration calculé depuis les noms libres
réellement référencés, et la réécriture des chemins relatifs, qui ne se
résolvaient plus depuis le nouvel emplacement.

Pour les routeurs d'actions, le contexte du handler (`req`, `res`, `action`,
`authUser`, les helpers hoistés) est passé par un objet `ctx` puis
**re-destructuré** en tête de chaque module : les liaisons d'origine sont
recréées à l'identique, et les corps n'ont pas à être touchés.

### 3.2 Le placement est calculé, pas deviné

Chaque helper va dans la **portée la plus étroite qui le sert** : le fichier
unique qui l'utilise, sinon `shared/core.js`. Pour les modules découpés, le
graphe de dépendances est construit, ses **composantes fortement connexes**
gardées ensemble, puis trié topologiquement — un fichier ne dépend donc que de
fichiers déjà écrits, et aucun `require` circulaire n'est possible.

### 3.3 Le découpage se fait sur l'AST

Une première tentative par comptage d'accolades produisait des fragments : sur
6 300 lignes, une frontière fausse aurait corrompu un handler en silence. Tout
le découpage passe donc par `@babel/parser`.

Et chaque statement emporte **le texte qui le précède** depuis le statement
d'avant : les commentaires et marqueurs de section sont conservés, et chaque
octet du `try` d'origine est attribué à exactement une destination.

---

## 4. Les pièges rencontrés, et leur traitement

**Liaisons mutables.** `sql` et `pool` sont des singletons paresseux réassignés
par `getPool()`. Une destructuration en aurait figé la valeur (`null`) et la
réassignation serait restée invisible au module appelant. Ils sont exposés en
**getters**, et le seul lecteur direct hors module propriétaire
(`harvestPrediction`) passe par `__core.sql`.

**Caches en mémoire.** `_articleHistoryCache`, `_identiteArticleCache`,
`_pmpInvoiceCache`, `_pubsubClient` restent chacun dans **un seul** fichier avec
leurs accesseurs. Les dupliquer aurait donné deux états divergents — c'était le
risque n°1 identifié avant de commencer.

**Sentinelle de dispatch.** Un handler d'action retourne la valeur de
`res.json()` quand il traite. Pour distinguer « je n'ai pas traité » d'un retour
légitime, la sentinelle est un `Symbol` : aucune valeur applicative ne peut lui
être égale, là où `undefined` aurait confondu les deux cas.

**Surface d'export.** Les affectations `exports.*` restent dans le fichier qui
**garde le nom d'origine** : c'est lui que les autres modules `require()`.

---

## 5. Ce qui a été vérifié

| Contrôle | Résultat |
|---|---|
| Noms d'export Cloud Functions | **105, diff vide** |
| Métadonnées de déploiement (région, cron, type de déclencheur, options) | **0/105 différence** |
| Texte des handlers d'action (extraits de l'AST, avant/après) | **0 écart** sur 118 + 48 + 40 |
| Séquence des actions | identique — l'ordre d'essai gouverne le comportement |
| Suite de tests | **4 913 verts**, 21 échecs = baseline exacte |
| `parity_check.py` backend | **162/162**, 0 manquante |
| Émulateur Firebase | 91 fonctions chargées, endpoints HTTP initialisés |
| Dispatch de bout en bout | `OPTIONS` → 204 ; action inconnue → **400** après traversée des 6 modules ; `pointageRH` → 403 (garde de rôle avant dispatch) |

---

## 6. Ce qui reste, et pourquoi

**La séparation service/repository n'a pas été faite à l'intérieur des domaines.**
La cible décrivait `<domaine>.service.js` / `.repository.js` / `.validators.js`.
Les atteindre demanderait de **réécrire le corps** des 206 handlers d'actions
pour en extraire les accès Firestore — exactement ce que le brief interdit
(« ne pas améliorer, simplifier ou refactoriser en portant ») et sans filet :
aucun test ne couvre le comportement de ces handlers un par un.

Le découpage livré atteint les objectifs vérifiables — plus de monolithe, plus
de fichier hors limite, surface et comportement inchangés — et laisse la
séparation en couches comme un travail ultérieur, à mener domaine par domaine
avec des tests de comportement écrits d'abord.
