# Spec — Supprimer la validation Achats des réceptions, et automatiser le PMP

> Décidé par Omar le 2026-08-27. Ce document est **autosuffisant** : il contient le
> contexte, les mesures de production, les décisions actées et le plan
> d'exécution. Une autre session doit pouvoir l'implémenter sans ré-analyser.

## 1. Le constat qui déclenche le chantier

Omar : « Pourquoi valider une réception par les Achats alors qu'elle est déjà liée
à un bon de commande validé par le DG ? C'est une étape inutile à mon avis. »

Vérification faite, l'étape **n'était pas** un tampon — elle faisait deux choses
réelles (`functions/index.js:11632-11677`) :

1. **Valorisation** : elle exigeait un `prix_unitaire` pour chaque ligne et
   l'écrivait dans le mouvement.
2. **Entrée en stock** : `applyStockImpact` n'est appelé qu'à ce moment. Tant
   qu'une réception n'est pas validée, **la marchandise n'entre pas en stock**.

Mais sa justification historique est morte : le prix arrive désormais
**pré-rempli depuis le bon de commande**, lui-même validé par le DG.

### Mesure décisive (production, 2026-08-27)

| statut | réceptions | lignes avec prix |
|---|---|---|
| `valide_chef` | 11 | **0** — vieux imports (`BE-*`, inventaire d'ouverture) |
| `en_attente_achats` | **62** | **90 lignes, toutes avec un prix** |

> ⚠️ **CORRECTION du 2026-08-27** — une première version de ce spec annonçait
> **4** réceptions bloquées. C'était faux : la mesure ne lisait que la première
> page de 300 mouvements. Le compte réel est **62 au 27/08/2026** (80 documents,
> dont 18 supprimés), du **5 juin au 27 août**, **90 lignes toutes valorisées**.
>
> ⚠️ **Ce compte n'est pas figé** : il augmente à chaque nouvelle réception tant
> que le correctif n'est pas déployé, puisque `create-bl` en produit encore. Les
> mesures antérieures (59 puis 61) n'étaient pas fausses, elles étaient datées.
> Toute reprise (partie D) doit RE-COMPTER au moment de l'exécution, jamais
> reprendre un chiffre écrit ici.
> L'impact stock de la reprise (partie D) est donc bien plus large qu'annoncé.

Extrait des bloquées (les plus récentes) :
`BR-2026-0062` (01/07), `BR-2026-0064` (25/07), `BR-2026-0012` (29/07),
`BR-2026-0075` (22/08).

**Personne n'a validé une seule réception depuis le 1er juillet.** Leur stock
n'est jamais entré, et leurs prix — pourtant saisis — n'ont jamais servi. La
chaîne s'arrête juste après le magasinier.

## 2. Décisions d'Omar — actées, ne pas rediscuter

1. **L'étape de validation Achats est supprimée.** Une réception entre en stock
   directement, valorisée automatiquement.
2. **Le prix vient du bon de commande**, sauf pour **TIMAC** où **la facture
   prime** (leurs factures divergent du BDC).
3. **La réception libre est supprimée.** Toute réception doit être rattachée à un
   bon de commande.
4. **Un tableau de bord périodique** remplace le contrôle humain ponctuel : les
   écarts sont signalés, pas bloqués.

## 3. Hiérarchie des prix — déjà déclarée dans le code

`functions/lib/stock/valuationPMP.js:26` :

```
facture  >  bon_commande  >  bon_entree  >  inventaire
```

C'est **exactement** la règle d'Omar. Rien à inventer : la priorité existe, seul
le branchement sur Firestore manque — le module lit aujourd'hui un classeur Excel
(`docs/Inventaire Stock 300625.xlsx`) **absent du dépôt**.

### Couverture mesurée

| source | couverture |
|---|---|
| Bons de commande (`purchase_orders`) | **625 lignes sur 626 (99,8 %)** portent un `prix_unitaire` |
| Factures TIMAC (`invoices`) | 155 factures, **478 lignes, 100 %** avec prix |
| Lignes de réception | 6 sur 66 seulement — **ne pas s'en servir comme source primaire** |

### L'import de factures TIMAC est SAIN

Vérifié, contrairement à une alerte que j'avais levée à tort : la facture
n°159814 (datée 11/08, 24 344 DH HT) est **arrivée seule par le flux
automatique** le 18/08. Les 20 « rattrapage » datent d'une passe unique du 16/06.
Aucune facture entre le 25/05 et le 11/08 — TIMAC n'a pas facturé de l'été.
`fetchEmails` tourne toutes les minutes et relève une boîte vide, ce n'est pas
une panne.

## 4. Ce qu'il faut construire

### A. Supprimer l'étape de validation

> ⚠️ **CORRECTION du 2026-08-27** — le vrai chemin de création d'une réception
> est **`create-bl` (`functions/index.js:7502-7598`)**, pas `create-movement`
> (`:11540`) que citait la première version. C'est `create-bl` qui produit les
> bons bloqués (`status: "en_attente_achats"`, ligne 7584). Ne traiter que
> `:11540` ne changerait **rien** en pratique.

- **`create-bl` (`:7502`)** : le statut initial passe à `valide_chef`, avec
  `applyStockImpact` appliqué dès la création. `create-movement` (`:11540`) suit
  la même règle pour les réceptions créées par ce chemin.
- **`functions/index.js:7566`** — le défaut le plus grave du chemin actuel :
  `prix_unitaire: bdcItem ? (parseFloat(bdcItem.prix_unitaire) || 0) : 0`,
  soit **deux zéros par défaut** — quand l'article n'est pas retrouvé au BDC, et
  quand le prix est illisible. C'est exactement ce que ce chantier interdit. À
  remplacer par « aucun prix », jamais zéro.
- **Le rapprochement article ↔ BDC (`:7562`)** se fait par égalité exacte du nom
  en minuscules, sans normalisation — fragile aux accents, espaces et
  ponctuation. Réutiliser `articleMerge.normalizeArticleName`, déjà éprouvée ici.
- `functions/index.js:11632-11677` : le bloc de validation Achats disparaît.
  **Conserver un chemin de reprise** tant que des réceptions restent dans
  l'ancien statut (cf. §D).
- Le rôle `achats` n'est plus requis pour qu'une réception entre en stock.

### B. Valoriser automatiquement à la réception

Un module **pur** (pattern `functions/lib/<domaine>/`, `// @ts-check`, DI, aucune
lecture Firestore) qui, pour une ligne de réception, choisit le prix :

1. **facture** du fournisseur pour cet article, si elle existe (cas TIMAC) ;
2. sinon **prix_unitaire du BDC** lié (`bdc_id` est présent sur la réception) ;
3. sinon **rien** — la ligne entre en stock **non valorisée**.

**Jamais de prix à zéro par défaut.** Un stock valorisé à zéro ressemble à un
vrai chiffre ; une absence assumée se voit et se corrige.

**Refus plutôt que devinette** si l'unité du prix diverge de celle du stock.

### C. Recalculer le PMP — jamais à l'incrément

Le PMP est une moyenne pondérée : on ne retire pas une acquisition par
soustraction. **Recalcul complet depuis l'ensemble des acquisitions** à chaque
fois. Une erreur se corrige en relançant.

Écrire `prix_pmp`, `prix_pmp_source` et `prix_pmp_maj_at` — la traçabilité est ce
qui rend un écart explicable au lieu de subi.

**La facture corrige rétroactivement** : elle arrive après la réception, donc le
PMP sera d'abord calculé au prix du BDC puis recalculé à l'arrivée de la facture.
C'est voulu, et c'est pourquoi la source et la date doivent être visibles.

### D. Reprendre les réceptions bloquées (62 au 27/08/2026, compte à revérifier)

Elles sont dans un statut qui n'existera plus. À la bascule, elles doivent être
validées et leur stock appliqué. **Leurs 90 lignes portent déjà un prix** — rien
à ressaisir.

⚠️ **Le stock d'Omar changera ce jour-là, et de façon substantielle** : deux mois
et demi d'entrées (5 juin → 27 août) qui ne sont jamais entrées. Il doit le voir
**avant**, pas le découvrir après : produire l'état avant/après par article et
par lieu, et le lui présenter. **Cette partie est GATED.**

### E. Supprimer la réception libre

**Déjà acquis pour l'essentiel** : `create-bl` **exige déjà** un `bdc_id`
(`:7504`, rejet 400 sinon) et écrit `reception_libre: false` en dur (`:7582`).
Reste à retirer les champs devenus morts et à vérifier qu'aucune réception
existante ne dépend d'un chemin libre avant de le fermer.

### F. Tableau de bord périodique des écarts

Remplace le contrôle humain supprimé. Doit signaler, sans bloquer :

- **écart quantité** commandée / reçue par BDC ;
- **écart prix** facture / BDC (le cas TIMAC) ;
- **articles entrés en stock sans prix** (le même bandeau que côté consommation) ;
- **lignes valorisées à une unité NON VÉRIFIÉE** — champ `prix_unite_verifiee:
  false` sur la ligne, agrégé dans `valorisation.non_verifiees` du mouvement.
  Le prix du BDC a été repris, mais rien n'a pu confirmer qu'il porte sur la
  même unité que le stock, faute d'unité au bon de commande.
  ⚠️ **C'est la famille la plus VOLUMINEUSE : 490 des 571 lignes valorisées
  (86 %).** Elle est déjà écrite en base par le lot A/B/C/E — si le tableau de
  bord est construit sans elle, on aura un aveu d'invérifiabilité stocké sur
  86 % du flux que personne ne lit jamais ;
- **BDC partiellement livrés** ou non livrés au-delà d'un délai.

Envoi WhatsApp : **template obligatoire** (`sendTemplateMessage`, ex.
`general_alert`) — un message libre est droppé silencieusement par Meta hors
fenêtre de 24 h.

> **Cause amont, hors périmètre de ce chantier (décision produit) :** 491 des
> 573 lignes de bons de commande n'ont **aucune unité**. Tracer
> l'invérifiabilité traite le symptôme ; la correction de fond est de rendre
> l'unité obligatoire **à la saisie du BDC**. À arbitrer par Omar.

## 5. Ce qui change dans les chiffres, à annoncer

- **Le stock augmente**, et bien plus qu'annoncé : **62 réceptions** bloquées
  depuis le 5 juin entrent enfin, soit 90 lignes (compte au 27/08/2026, à
  revérifier au moment de la reprise).
- **Le PMP devient vivant** : il bougera à chaque réception, et rétroactivement à
  l'arrivée d'une facture TIMAC.
- **83 lignes de consommation sur 600** sont aujourd'hui non valorisées ; ce
  chantier est ce qui les rattrape.
- Le coût par Ha (ticket suivant) doit afficher **la part non valorisée**, sinon
  il aura l'air complet sans l'être.

## 6. Vérification

1. **Tests purs** sur le choix du prix : facture prioritaire sur BDC ; BDC quand
   pas de facture ; **aucun prix** quand ni l'un ni l'autre (jamais zéro) ; refus
   sur unité divergente.
2. **Validation par mutation obligatoire** — ce dépôt a un historique lourd de
   filets qui mesuraient autre chose que ce qu'ils annonçaient. Pour chaque test :
   appliquer la mutation, vérifier le ROUGE, annuler, vérifier le VERT, et
   confirmer par `node --check` que le code muté restait valide.
3. **Invariante de conservation** : aucune ligne de réception ne disparaît ; elle
   entre en stock valorisée ou non valorisée, jamais rien d'autre.
4. **Contre les données réelles** : rejouer sur les 15 réceptions et les 300 BDC,
   et retrouver des chiffres explicables.
5. `npm run qa` vert, `npm run code-index` si `functions/` bouge.

## 7. Points gated — ne pas franchir sans GO explicite d'Omar

- **Écrire les nouveaux PMP** : change tous les chiffres de coût d'un coup.
- **Reprendre les 4 réceptions bloquées** : modifie le stock réel.
- **Fermer la réception libre** si des réceptions existantes en dépendent.

## 8. Hors périmètre

- Le nettoyage des **92 fiches à référence divergente** et des **5 documents
  fantômes** (dont 3 portent un prix orphelin pour des articles qui n'en ont
  aucun : `ksc 7 perla`, `ksc 1 HW`, `ksc 2 HW`). Ticket séparé.
- La fusion des 105 doublons, en cours côté Omar.
- Le coût DH/Ha, ticket suivant, qui consommera ce chantier.

### ⚠️ Piège à désamorcer AVANT de rendre les réceptions éditables

`edit-movement` (`functions/index.js`, liste blanche `EDITABLE` ~`:11888`)
**re-mappe** les items d'un mouvement. Sa liste blanche ne contient ni
`prix_unitaire`, ni `prix_source`, ni `prix_unite_verifiee` : une édition
**effacerait la valorisation** de la réception, silencieusement. La ligne
resterait en stock, mais sans prix — exactement ce que ce chantier a supprimé.

Aujourd'hui le risque ne se matérialise pas, **mais par effet de bord et non par
décision** : `evaluateMutable` refuse tout mouvement en `valide_chef`, et les
réceptions naissent désormais dans ce statut. Aucune garde ne nomme le prix ;
rien ne dit à un futur ticket que ce statut protège autre chose qu'un workflow.

Donc, si un ticket futur rend les réceptions éditables ou ajoute un
contournement admin :

1. `edit-movement` doit **RE-VALORISER** via
   `receptionValorisation.valoriserItemsReception`, **jamais re-mapper** les
   items à la main — sinon les champs de prix disparaissent ;
2. la protection doit devenir une **garde nommée et testée**, pas la
   conséquence tacite d'un statut ;
3. et la re-valorisation doit refaire tomber `prix_unite_verifiee` quand les
   unités redeviennent comparables (déjà couvert côté module, cf. §C).
