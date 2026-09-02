# Spec — Apprentissage progressif du scan des bons de consommation

> Statut : **GATED**, en attente de GO d'Omar.
> Rédigé le 2026-08-25. Autosuffisant : un agent doit pouvoir l'implémenter sans re-analyser.
> Décisions d'Omar déjà actées : **mémoriser les parcelles = OUI**, **écran de relecture des correspondances = NON**.

---

## 1. Contexte

Le scanner de bons de consommation est en production depuis le 2026-08-25 (PR #320, #324).
Le magasinier dépose des photos, une IA (`claude-opus-5`, action `scan-bc`) lit la matrice
`article × colonne « Pile »`, le front propose un article du catalogue et une parcelle du
référentiel pour chaque cellule, il corrige et enregistre.

**Mesure de référence** — pipeline réel de production exécuté sur 7 bons papier photographiés
(F1 0005667 → 0005673), 72 lignes générées :

| Indicateur | Valeur mesurée |
|---|---|
| Bons lus sans échec | 7 / 7 |
| Fidélité de lecture | 100 % des quantités justes (vérifié ligne à ligne contre les photos) |
| Articles pré-remplis | **39 / 72 (54 %)** |
| Parcelles pré-remplies | **56 / 72 (78 %)** |
| Durée | 7,0 s/bon, 3 en parallèle depuis #324 |

La lecture est au plafond : virgules décimales, valeurs raturées mises à `null`, articles écrits
dans la case REMARQUES remontés en lignes, en-tête griffonné hors colonne rattaché à la bonne pile.
**Il n'y a rien à gagner sur l'OCR.** Tout le gain restant est sur le *rapprochement*.

### Ce qui reste non reconnu, et pourquoi

Articles (33 lignes sur 72) — ce sont les abréviations maison du magasinier, et le refus de
trancher est **volontaire** : le catalogue contient plusieurs candidats légitimes.

| Libellé lu | Candidats réels au catalogue |
|---|---|
| `N. calcium` | « Nitrate de Calcium », « Nitrate de calcium Ultrasol » |
| `S. Potassium` | « Sulfate de potasse soluble crist. », « Sulfate de Potasse Granulé », « Sulfat de potasse » |
| `Decis` | « DECIS EXPERT », « DECIS FLUXX », « DECIS PROTECH 015 EW » |
| `N. Potassium`, `S. Magnesium`, `Rovento`, `Yeoutrop`, `Suffacide`, `Biotoroc`, `KSL Mix`, `Sulfocide` | variantes ou orthographes du magasinier |

Parcelles (16 lignes sur 72) — trois en-têtes non résolus, tous légitimement ambigus :
`M.T.L S-8` (la liste a S8-1, S8-2, S8-3, pas de S8 simple), `M.T.L S-13-14` (S13 et S14 sont
deux parcelles distinctes), `miya S-9` (résolu depuis, cf. §4.3).

---

## 2. Ce qui existe déjà — ne pas le réécrire

### 2.1 Apprentissage des articles (livré, en production)

- Collection **`bc_scan_aliases`** : `{ normalise, article_nom, count, updated_at, updated_by }`.
  Clé = libellé lu normalisé.
- Écrit par l'action **`save-bc-scan-alias`** (`functions/index.js`) quand le magasinier corrige
  un article. Rôle résolu SERVEUR (`magasinier | dg`), jamais depuis le body.
- Appliqué côté **serveur** dans `matchArticle` (`functions/lib/stock/bcScan.js`) : un alias rend
  `status: 'alias'` avec `article_alias_count`.
- Affiché en **⚠️ orange « mémorisé — à vérifier »**, jamais en ✅ vert. Décision de conception :
  un alias peut venir d'UNE seule mauvaise sélection.
- `firestore.rules` : `bc_scan_aliases` en `write: if false` (écriture par Cloud Function uniquement).
- Action `list-bc-scan-aliases` : **endpoint mort**, aucun appelant (les alias sont appliqués côté
  serveur). Le §4 le réutilise.

### 2.2 Rapprochement des parcelles (livré, côté CLIENT)

Depuis #320, le rapprochement des parcelles se fait **dans le navigateur**
(`public/lib/bcScanMatch.js`, global `window.BcScanMatch`), contre **exactement les options
rendues dans le `<select>`**. Raison : `sb_parcelle_referentiel` est un sous-ensemble partiel
(15 labels sur les 43 de `sql_mirror_pointage_meta`) et n'est pas filtré par campagne — matcher
contre lui proposerait des parcelles absentes du sélecteur ou d'une autre campagne.

Le module backend `functions/lib/stock/bcScan.js` conserve une copie de `matchParcelle`, **non
appelée par aucune Cloud Function**, maintenue en parité par **3 tests anti-divergence** qui
rejouent les mêmes en-têtes dans les deux implémentations et exigent `label`, `status`, `score`
et `candidats` identiques. Toute évolution ci-dessous doit être portée **des deux côtés**.

Garde-fous en place, à ne casser sous aucun prétexte :
- `knownParcelle` est le **dernier mot** : une valeur non présente dans les options rendues n'est
  jamais posée, quelle que soit sa provenance ;
- un label **multi-secteurs** (`S2.S3.S5.S6.S7 …`) n'est jamais proposé pour un en-tête mono-secteur ;
- une parcelle dont la **variété** contredit l'en-tête n'est jamais proposée, même seule sur son secteur ;
- une parcelle dont la **culture** contredit l'en-tête (Myrtille/Avocatier explicites) est vetoée
  avant le raccourci `exact` ;
- un en-tête nommant un secteur **inconnu de la liste** ne se rabat pas sur un label sans secteur.

### 2.3 Aucune mémorisation des parcelles aujourd'hui

C'était une décision de prudence initiale. Conséquence mesurée : `M.T.L S-8` (8 lignes sur les
7 bons) et `M.T.L S-13-14` (5 lignes) resteront à saisir **à chaque scan, indéfiniment**.
C'est précisément ce que ce spec corrige.

---

## 3. Objectif et non-objectifs

**Objectif** : faire monter le taux de pré-remplissage au fil de l'usage, sans jamais augmenter
le risque d'imputation fausse.

**Non-objectifs, explicitement écartés :**
- ❌ **Entraînement d'un modèle (fine-tuning)**. Volume de données trop faible (quelques bons/jour),
  et le problème n'est pas la lecture mais la correspondance de vocabulaire. Un modèle entraîné
  serait opaque, alors qu'une erreur ici signifie une consommation imputée à la mauvaise parcelle.
- ❌ **Changement de fournisseur d'IA**. Mesuré : `claude-sonnet-5` est plus lent (10,8 s vs 7,0 s)
  ET moins fiable (quantités manquées, colonnes inventées). Le mode « fast » d'Opus est refusé par
  le compte (429). Une évaluation de Gemini reste possible mais devrait être **chiffrée sur les
  mêmes 7 bons** avant toute bascule — le module de rapprochement est indépendant du modèle,
  seul l'appel API changerait.
- ❌ **Écran de relecture des correspondances mémorisées** (décision d'Omar, 2026-08-25).

---

## 4. Les leviers, par ordre d'efficacité

### 4.1 LEVIER 1 — Mémoriser les parcelles ⭐ (décidé : OUI)

Le plus rentable : 16 lignes sur 72 concernées, et surtout un gain **permanent** (aujourd'hui,
zéro apprentissage → le magasinier ressaisit à vie).

#### Modèle de données

Nouvelle collection **`bc_scan_parcelle_aliases`**, distincte de celle des articles (règles
Firestore et cycles de vie différents) :

```
bc_scan_parcelle_aliases/{docId}
  normalise    : string   // en-tête lu, normalisé (normalizeLabel)
  campagne     : string   // "2026-2027" — OBLIGATOIRE, cf. risque R1
  parcelle     : string   // libellé BEE ONE exact, tel qu'enregistré dans le bon
  count        : number   // nombre de confirmations
  updated_at   : timestamp
  updated_by   : { uid, profileId, name }
```

`docId = ${campagne}__${normalise}` (déterministe, évite les doublons et rend la purge par
campagne triviale).

> ⚠️ **La clé DOIT inclure la campagne.** Le secteur 9 en est la démonstration : il portait
> `S9 - REYNA F5` (3 ha) en 2025-2026, il porte `F5- MYA S9` (0,7 ha) + `F5 YAZMIN MT` (2,3 ha)
> en 2026-2027. Un alias appris l'an dernier imputerait la consommation à une parcelle qui
> n'existe plus. C'est le risque le plus grave de tout ce spec.

#### Écriture

À l'enregistrement d'un bon (`handleSave` dans `public/components/MagBCScanModal.jsx`), pour
chaque ligne effectivement enregistrée dont la parcelle a été **choisie ou corrigée par
l'utilisateur** (c'est-à-dire : `parcelle_lue` non vide ET parcelle finale ≠ proposition initiale,
ou proposition initiale absente) :

→ appel à une nouvelle action **`save-bc-scan-parcelle-alias`** (`/api/stock`), calquée sur
`save-bc-scan-alias` :
- rôle résolu **serveur** depuis le token, restreint à `magasinier | dg` (jamais depuis le body) ;
- `set(..., { merge: true })` avec `count: FieldValue.increment(1)` ;
- si la parcelle enregistrée diffère de l'alias existant, **écraser** et remettre `count: 1`
  (la dernière décision humaine fait foi) ;
- ne jamais écrire si `parcelle_lue` est vide (rien à apprendre d'un en-tête illisible).

#### Lecture et application

Le rapprochement des parcelles étant **côté client**, les alias doivent y descendre :

- nouvelle action de lecture **`list-bc-scan-parcelle-aliases?campagne=…`** renvoyant une map plate
  `{ normalise: { parcelle, count } }` (même forme que `list-bc-scan-aliases`, qui devient enfin
  utile par symétrie) ;
- chargée **une fois à l'ouverture de la modale** (comme le catalogue et le référentiel), pas par bon ;
- passée à `window.BcScanMatch.matchParcelle(entete, options, aliases)`.

Ordre de résolution dans `matchParcelle` :
1. **alias** (si présent pour cette campagne) → `status: 'alias'`, `score: 1` ;
2. sinon la cascade actuelle inchangée (secteur → culture → variété).

⚠️ **`knownParcelle` reste le dernier mot** : un alias dont le libellé n'est plus dans les options
rendues (parcelle retirée de la campagne) est **ignoré silencieusement** et on retombe sur la
cascade. Sans cette garde, un alias périmé poserait une valeur non sélectionnable.

#### Affichage

Statut `alias` → **⚠️ orange « mémorisé — à vérifier »**, jamais ✅ vert, exactement comme les
articles. `statusDot` gère déjà ce statut : la parité est à préserver.

---

### 4.2 LEVIER 2 — Donner le vocabulaire à l'IA au moment de la lecture

Aujourd'hui l'IA lit **à l'aveugle**, puis on rapproche après coup par similarité. Si elle connaît
les libellés cibles, elle transcrit directement dans les bons termes. C'est le levier le plus
puissant sur les articles — il attaque la cause (l'abréviation), pas le symptôme.

**Implémentation** : injecter dans le prompt de `buildBcScanPrompt` (`functions/lib/stock/bcScan.js`)
la liste des noms d'articles et des libellés de parcelles, avec la consigne de transcrire un libellé
reconnu **tel qu'il figure dans la liste**, et de rendre le texte brut sinon.

**Contrainte de taille** : le catalogue compte **1124 articles actifs**. L'envoyer entier à chaque
image gonflerait le prompt. Deux réductions, cumulables :
- filtrer par `type` du bon (`engrais` / `pesticide`) via `cpc_categorie` ;
- restreindre aux articles **effectivement consommés** sur les N derniers mois (44 articles distincts
  observés sur l'ensemble des `consumption_vouchers` existants — deux ordres de grandeur en moins).

**Mise en cache du prompt** : la liste est identique d'une image à l'autre au sein d'un lot. Placer
la partie stable **en tête** du prompt et activer la mise en cache réduit le coût et la latence.

> ⚠️ **À valider par mesure, pas par intuition.** Sur ce chantier, l'intuition s'est trompée deux
> fois (Sonnet supposé plus rapide, référentiels supposés disjoints). Le banc d'essai existe :
> les 7 photos, le vrai prompt, le vrai modèle. Mesurer avant/après sur les mêmes images, et
> comparer **fidélité ET latence** — un prompt plus gros peut ralentir.

---

### 4.3 LEVIER 3 — Utiliser la variété STRUCTURÉE plutôt que l'expression régulière

Découvert le 2026-08-25 en observant l'écran « Parcelles & Référentiel MO ».

`parcelles-campagne-list` renvoie déjà, par parcelle et **par campagne** :
`{ ref, label, culture, variete, ferme, sup, debut, fin }`.

Or `matchParcelle` extrait aujourd'hui la variété **par regex sur le libellé**
(`VARIETY_ALIASES` : maravilla, yasmin, mya, reyna, corina, breeze, cascade…). C'est fragile et
redondant : la donnée existe en clair dans `variete` (valeurs observées : `YAZMIN`, `CASCADE`,
`MARAVILLA`).

**Amélioration** : quand l'option porte un `variete` non vide, l'utiliser comme source de vérité ;
ne retomber sur l'extraction par libellé que s'il est absent. Idem pour la culture avec `culture`.

> ⚠️ **Ne résout pas tout, et il faut le savoir** : les DEUX parcelles du secteur 9
> (`F5- MYA S9` et `F5 YAZMIN MT`) portent `Variete = YAZMIN` dans BR_Pointage. La variété
> structurée ne les départage donc pas — c'est l'alias du levier 1 qui le fera. Le gain est ailleurs :
> robustesse sur les parcelles dont le libellé ne contient pas sa variété.

---

### 4.4 LEVIER 4 — Journaliser les corrections

Collection **`bc_scan_corrections`**, en écriture seule depuis les Cloud Functions :

```
  date, bon_numero, campagne
  article_lu, article_propose, article_choisi, article_status_initial, article_score
  parcelle_lue, parcelle_proposee, parcelle_choisie, parcelle_status_initial, parcelle_score
  corrige_par : { uid, profileId }
```

Sans écran de relecture (décision d'Omar), ce journal sert à **mesurer** : taux de pré-remplissage
dans le temps, taux de correction par statut, et surtout **taux de correction des propositions
`probable`** — s'il est élevé, les seuils sont trop permissifs ; s'il est nul, ils sont trop stricts
et on fait travailler le magasinier pour rien.

C'est ce qui a manqué tout au long du chantier : les seuils (`SIMILARITY_THRESHOLD = 0.75`,
`INCLUSION_THRESHOLD = 0.78`) ont été réglés à l'intuition, puis corrigés une fois confrontés aux
vraies données. Ce journal permet de les régler sur des faits.

---

## 5. Risques et parades

| # | Risque | Gravité | Parade |
|---|---|---|---|
| **R1** | **Alias de parcelle périmé après changement de campagne** — la consommation part sur une parcelle qui n'existe plus (cas réel : S9 Reyna → Mya + Yazmin MT). | **Critique** | Campagne **dans la clé** du document. Alias absent de la campagne courante → jamais appliqué. Filtrage supplémentaire par `knownParcelle`. |
| **R2** | **Apprendre les erreurs du magasinier** — une mauvaise sélection (ligne du dessus dans un `<select>`) devient permanente et invisible. | Élevée | Statut `alias` toujours en ⚠️ orange, jamais ✅ vert. `count` exposé. Dernière décision humaine écrase et remet `count: 1`. Journal (levier 4) pour retrouver l'origine. |
| **R3** | **Divergence des deux implémentations du matcher** (front vivant / back documentaire). | Élevée | Les 3 tests anti-divergence doivent rester **actifs et verts** (`skipped 0`). Un précédent : un gate de parité se désarmait exactement dans le cas qu'il devait détecter — vérifier par mutation, pas en lisant le vert. |
| **R4** | **Limites de débit** — déjà rencontrées en 429 sur ce compte. | Moyenne | Plafond de concurrence à 3 et reprise avec attente croissante déjà en place (#324). Un prompt plus gros (levier 2) augmente les tokens : mesurer. |
| **R5** | **Prompt trop volumineux** ralentissant la lecture. | Moyenne | Restreindre aux articles réellement consommés, mise en cache du préfixe stable, mesure avant/après sur les 7 bons. |
| **R6** | Alias de parcelle écrit alors que l'en-tête était illisible → clé vide polluante. | Faible | Ne jamais écrire si `parcelle_lue` est vide. |

---

## 6. Plan d'implémentation

Trois lots indépendants, livrables séparément. **Lot A d'abord** : c'est celui qu'Omar a validé et
il apporte le gain permanent.

### Lot A — Mémorisation des parcelles
- `firestore.rules` : `bc_scan_parcelle_aliases` en `write: if false`.
- `functions/index.js` : actions `save-bc-scan-parcelle-alias` et `list-bc-scan-parcelle-aliases`,
  rôle serveur `magasinier | dg`, calquées sur les actions articles existantes.
- `public/lib/bcScanMatch.js` : paramètre `aliases` dans `matchParcelle`, priorité 1, filtré par
  `knownParcelle`.
- `functions/lib/stock/bcScan.js` : **même modification**, pour la parité.
- `public/components/MagBCScanModal.jsx` : chargement des alias à l'ouverture, écriture à
  l'enregistrement d'un bon.
- Tests : alias appliqué / alias d'une autre campagne ignoré / alias pointant une parcelle absente
  des options ignoré / écrasement par la dernière décision / en-tête vide non mémorisé /
  parité front-back étendue aux alias.

### Lot B — Vocabulaire dans le prompt
- `buildBcScanPrompt` : paramètre `vocabulaire`.
- `scan-bc` : construction de la liste réduite (par type, et par articles récemment consommés).
- Mise en cache du préfixe stable du prompt.
- **Mesure obligatoire** avant/après sur les 7 photos : fidélité ET latence.

### Lot C — Journal des corrections
- `firestore.rules` : `bc_scan_corrections` en `write: if false`.
- Écriture à l'enregistrement d'un bon, dans la même transaction que l'alias.
- Aucun écran (décision d'Omar).

---

## 7. Critère de succès

Rejouer le banc d'essai sur les **7 bons de référence**, deux fois de suite (le second passage
bénéficiant des alias appris au premier) :

| Indicateur | Aujourd'hui | Cible après lot A (2ᵉ passage) | Cible après lot B |
|---|---|---|---|
| Articles pré-remplis | 54 % | 54 % (inchangé) | **> 85 %** |
| Parcelles pré-remplies | 78 % | **> 95 %** | > 95 % |
| Faux positifs validés à tort | 0 | **0** (non négociable) | **0** |
| Latence | 7,0 s/bon | inchangée | à mesurer, ne doit pas se dégrader |

Le banc d'essai : script du scratchpad de session, 7 photos, vrai prompt, vrai modèle, comparaison
ligne à ligne contre le papier.

---

## 8. Ce que ce spec ne traite pas

- La saisie des **noms Smart Berry** dans « Parcelles & Référentiel » : 1 parcelle sur 15 renseignée
  au 2026-08-25. C'est de la donnée, pas du code — mais c'est le levier qui rendrait
  `F5 YAZMIN MT` trouvable en le renommant `S9 - YAZMIN MT F5`.
  **Le repli sur le libellé BEE ONE quand aucun nom Smart Berry n'est saisi est le comportement
  VOULU** (confirmé par Omar le 2026-08-25) : `parcelleNom()` affiche `nom_sb` s'il existe, sinon
  le libellé BEE ONE. Ce n'est pas un défaut à corriger, et la valeur ENREGISTRÉE dans le bon
  reste dans tous les cas le libellé BEE ONE — le nom Smart Berry est un habillage d'affichage.
  Corollaire pour le levier 1 : les alias de parcelle mémorisent le **libellé BEE ONE**, jamais le
  nom Smart Berry, sinon un renommage ultérieur invaliderait silencieusement tous les alias appris.
- La **fraîcheur de `parcelles_consommation`** : une seule de ses 19 lignes est en campagne
  2026-2027, les 18 autres sont restées en 2025-2026. Gêne tout ce qui raisonne par campagne.
- L'**indexation positionnelle des `useState`** dans le harnais de test et les **stubs de `Response`
  incomplets** : consignés dans `TODO_REFACTO.md` §5 et §6.
